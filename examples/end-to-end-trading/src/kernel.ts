// @tradrl/example-e2e-trading — THE AGENT OS SLICE (T006 pattern).
//
// A compact, deterministic kernel reducer over the operations the slice
// exercises: SPAWN, SUBSCRIBE, PUBLISH, OBSERVE, EXECUTE, REPORT. The
// laws mirror the real kernel: no wall clock (ops carry their own
// timestamps), no randomness (ids derived from the op content), rejected
// ops leave no state trace (the typed error is the record), tenant
// isolation on every record (L12), per-sender monotonic message
// sequences, and — THE L8 LAW — EXECUTE is AUTHORITY-NEUTRAL: the kernel
// transports an intent ref and an authority token ref it NEVER evaluates;
// consequential authority lives in the execution gateway, never here.

import { deepFreeze, isNonEmptyString, stableDigest8Json, type JsonValue } from './primitives';
import { fail, ok, type ExampleResult, type ExampleError } from './errors';
import type {
  MessageEnvelopeMirror, SliceKernelOperationMirror,
} from './mirrors/agent';
import type { TopicName, AgentInstanceId, TenantId } from './ids';

export const KERNEL_TOPICS = [
  'kernel.request', 'kernel.delegate', 'kernel.challenge', 'kernel.propose',
  'kernel.approve', 'kernel.escalate', 'kernel.cascade-escalate',
] as const;

export interface KernelInstanceRecord {
  readonly instance: AgentInstanceId;
  readonly bodyVersion: string;
  readonly substrate: string;
  readonly manager: AgentInstanceId | null;
  readonly spawnedAt: number;
  readonly live: boolean;
}

export interface KernelSubscriptionRecord {
  readonly subscriber: AgentInstanceId;
  readonly topic: TopicName;
  readonly subscribedAt: number;
}

/** The kernel state — a pure value object. */
export interface KernelState {
  readonly tenant: TenantId;
  readonly instances: readonly KernelInstanceRecord[];
  readonly subscriptions: readonly KernelSubscriptionRecord[];
  readonly operations: readonly SliceKernelOperationMirror[];
  readonly envelopes: readonly MessageEnvelopeMirror[];
  /** Per-sender message sequence counters (strictly increasing, 1-based). */
  readonly sequences: ReadonlyMap<string, number>;
  /** Per-actor monotonic op timestamps. */
  readonly lastOpAt: ReadonlyMap<string, number>;
}

export function initialKernelState(tenant: TenantId): KernelState {
  return {
    tenant,
    instances: [],
    subscriptions: [],
    operations: [],
    envelopes: [],
    sequences: new Map<string, number>(),
    lastOpAt: new Map<string, number>(),
  };
}

export interface KernelTransition {
  readonly state: KernelState;
  /** EXECUTE effects: the runtime hands the intent to the GATE — never to a venue. */
  readonly executeIntents: readonly { readonly intentRef: string; readonly authorityTokenRef: string; readonly actor: AgentInstanceId }[];
}

function instanceOf(state: KernelState, instance: AgentInstanceId): KernelInstanceRecord | undefined {
  return state.instances.find((record) => record.instance === instance);
}

/** Applies one operation (pure; rejected ops leave NO state trace). */
export function applyKernelOperation(state: KernelState, op: SliceKernelOperationMirror): ExampleResult<KernelTransition> {
  const errors: ExampleError[] = [];
  if (op.tenantId !== state.tenant) {
    return fail('tenant_mismatch', `op ${op.opId} tenant "${op.tenantId}" != kernel tenant "${state.tenant}" (L12)`, 'op.tenantId');
  }
  const lastAt = state.lastOpAt.get(op.actor) ?? -1;
  if (op.timestamp < lastAt) {
    return fail('clock_not_monotonic', `op ${op.opId} timestamp ${op.timestamp} precedes actor's last op at ${lastAt}`, 'op.timestamp');
  }
  // Tenant bootstrap: the first op in an empty kernel may spawn without being live.
  const actorLive = state.instances.length === 0 || instanceOf(state, op.actor)?.live === true;
  if (!actorLive) {
    return fail('invalid_state', `op ${op.opId} actor ${op.actor} is not a live instance in tenant ${state.tenant}`, 'op.actor');
  }

  switch (op.type) {
    case 'SPAWN': {
      if (instanceOf(state, op.instance)) {
        return fail('invalid_state', `instance ${op.instance} already exists`, 'op.instance');
      }
      const next: KernelState = {
        ...state,
        instances: [
          ...state.instances,
          { instance: op.instance, bodyVersion: op.bodyVersion, substrate: op.substrate, manager: op.manager, spawnedAt: op.timestamp, live: true },
        ],
        operations: [...state.operations, op],
        lastOpAt: new Map(state.lastOpAt).set(op.actor, op.timestamp),
      };
      return ok({ state: next, executeIntents: [] });
    }
    case 'SUBSCRIBE': {
      if (KERNEL_TOPICS.includes(op.topic as (typeof KERNEL_TOPICS)[number])) {
        return fail('invalid_state', `topic ${op.topic} is kernel-reserved`, 'op.topic');
      }
      const existing = state.subscriptions.some((sub) => sub.subscriber === op.actor && sub.topic === op.topic);
      const next: KernelState = {
        ...state,
        subscriptions: existing
          ? state.subscriptions
          : [...state.subscriptions, { subscriber: op.actor, topic: op.topic, subscribedAt: op.timestamp }],
        operations: [...state.operations, op],
        lastOpAt: new Map(state.lastOpAt).set(op.actor, op.timestamp),
      };
      return ok({ state: next, executeIntents: [] });
    }
    case 'PUBLISH': {
      if (KERNEL_TOPICS.includes(op.topic as (typeof KERNEL_TOPICS)[number])) {
        return fail('invalid_state', `topic ${op.topic} is kernel-reserved`, 'op.topic');
      }
      const sequence = (state.sequences.get(op.actor) ?? 0) + 1;
      const envelope: MessageEnvelopeMirror = deepFreeze({
        id: `msg:${op.opId}:${op.actor}:${sequence}`,
        topic: op.topic,
        tenantId: op.tenantId,
        sender: op.actor,
        payload: op.payloadRef,
        sequence,
        causalityId: op.opId,
        publishedAt: op.timestamp,
      });
      const next: KernelState = {
        ...state,
        operations: [...state.operations, op],
        envelopes: [...state.envelopes, envelope],
        sequences: new Map(state.sequences).set(op.actor, sequence),
        lastOpAt: new Map(state.lastOpAt).set(op.actor, op.timestamp),
      };
      return ok({ state: next, executeIntents: [] });
    }
    case 'OBSERVE': {
      const next: KernelState = {
        ...state,
        operations: [...state.operations, op],
        lastOpAt: new Map(state.lastOpAt).set(op.actor, op.timestamp),
      };
      return ok({ state: next, executeIntents: [] });
    }
    case 'EXECUTE': {
      // L8: the kernel transports the intent + authority refs WITHOUT
      // evaluating them. The effect hands them to the execution gate.
      if (!isNonEmptyString(op.intentRef) || !isNonEmptyString(op.authorityTokenRef)) {
        return fail('invalid_state', 'EXECUTE carries opaque intent/authority refs — both required', 'op');
      }
      const next: KernelState = {
        ...state,
        operations: [...state.operations, op],
        lastOpAt: new Map(state.lastOpAt).set(op.actor, op.timestamp),
      };
      return ok({
        state: next,
        executeIntents: [{ intentRef: op.intentRef, authorityTokenRef: op.authorityTokenRef, actor: op.actor }],
      });
    }
    case 'REPORT': {
      if (!isNonEmptyString(op.headline) || !isNonEmptyString(op.detailRef)) {
        errors.push({ code: 'missing_field', path: 'op.headline', message: 'REPORT requires headline + detailRef' });
      }
      if (errors.length > 0) return { ok: false, errors };
      const next: KernelState = {
        ...state,
        operations: [...state.operations, op],
        lastOpAt: new Map(state.lastOpAt).set(op.actor, op.timestamp),
      };
      return ok({ state: next, executeIntents: [] });
    }
  }
}

/** Derives an op id deterministically from the op content. */
export function deriveOpId(op: Omit<SliceKernelOperationMirror, 'opId'>): string {
  return `kop-${stableDigest8Json(op as unknown as JsonValue)}`;
}

/** The kernel's run digest (the L9 anchor of this stage). */
export function kernelDigest(state: KernelState): string {
  return stableDigest8Json({
    instances: state.instances.length,
    subscriptions: state.subscriptions.length,
    operations: state.operations.length,
    envelopes: state.envelopes.map((envelope) => envelope.id),
  } as JsonValue);
}
