// @tradrl/agent-os — kernel state: the pure value object the reducer folds.
//
// Spec anchors: spec/ARCHITECTURE.md ("Agent OS" — stable kernel);
// spec/ARCHITECTURE-LOCK.md L2 (instances are opaque possession handles +
// authority scope + parent), L9 (replayable operation logs — state is a pure
// fold over the log), L12 (tenant isolation — every registry is
// tenant-scoped; cross-tenant references are not expressible through the
// lookup helpers).
//
// The kernel state is EXACTLY the frozen T006 scope enumeration:
//   mailbox registry + live instance registry (opaque refs + authority
//   scope + parent) + topic subscriptions + operation log,
// plus the two bookkeeping indexes those components need to enforce their
// invariants in O(1): per-actor timestamp baselines (monotonicity) and
// per-sender message sequence counters, and the accepted-op-id index
// (duplicate rejection). All state is JSON-serializable (no Maps/Sets —
// the guard is the machine-checkable schema).
//
// Determinism law: state transitions happen ONLY through
// `applyOperation(state, op) -> {state', effects}` (kernel.ts). There is no
// wall clock and no randomness anywhere in this module.

import {
  type AgentInstanceId,
  type BodyVersionRef,
  type KernelOpId,
  type SubstrateRef,
  type TenantId,
  type TopicName,
  isAgentInstanceId,
  isBodyVersionRef,
  isKernelOpId,
  isSubstrateRef,
  isTenantId,
  isTopicName,
  deepFreeze,
  isRecord,
} from './primitives';
import { type KernelAuthority, isKernelAuthority } from './authority';
import { type MessageEnvelope, isMessageEnvelope } from './envelope';
import { type KernelOperation, isKernelOperation } from './operations';
import { type TimestampMs, isTimestampMs } from './timestamp';

// ---------------------------------------------------------------------------
// Instance registry entry
// ---------------------------------------------------------------------------

/**
 * One LIVE instance inside the kernel. Carries the opaque refs the T006
 * scope freezes (body version ref, substrate ref), the runtime-granted
 * authority scope, and the parent/manager reference. The AgentInstance
 * RECORD itself (possession binding, project, lifecycle) is owned by
 * `@tradrl/agent-body` (T003); this entry is the kernel's live registry row
 * keyed by the shared opaque `AgentInstanceId`.
 */
export interface InstanceRecord {
  /** Instance identity (opaque handle shared with the agent-body lane). */
  readonly id: AgentInstanceId;
  /** Tenant scope (L12). */
  readonly tenantId: TenantId;
  /** Parent/manager (`null` = root). Always a LIVE instance or `null` — the
   *  termination cascade re-parents reports, so dangling parents never form. */
  readonly managerId: AgentInstanceId | null;
  /** Opaque immutable body-version reference (T003 lane). */
  readonly bodyVersionRef: BodyVersionRef;
  /** Opaque substrate reference (T003 lane). */
  readonly substrateRef: SubstrateRef;
  /** Runtime-granted authority scope (mirrors agent-body's AuthorityScope). */
  readonly authority: KernelAuthority;
  /** When the SPAWN op that created this instance was accepted. */
  readonly spawnedAt: TimestampMs;
  /** The actor of the SPAWN op (`null` only for tenant bootstrap spawns). */
  readonly spawnedBy: AgentInstanceId | null;
}

/** Guard: `InstanceRecord`. */
export function isInstanceRecord(v: unknown): v is InstanceRecord {
  if (!isRecord(v)) return false;
  return (
    isAgentInstanceId(v.id) &&
    isTenantId(v.tenantId) &&
    (v.managerId === null || isAgentInstanceId(v.managerId)) &&
    isBodyVersionRef(v.bodyVersionRef) &&
    isSubstrateRef(v.substrateRef) &&
    isKernelAuthority(v.authority) &&
    isTimestampMs(v.spawnedAt) &&
    (v.spawnedBy === null || isAgentInstanceId(v.spawnedBy))
  );
}

// ---------------------------------------------------------------------------
// Kernel state
// ---------------------------------------------------------------------------

/**
 * The kernel state — a pure value object, deeply frozen at every
 * transition. Tenant-scoped registries nest by tenant so that cross-tenant
 * lookups are not expressible through any exported helper: every lookup
 * takes the tenant id FIRST and never searches across tenants.
 */
export interface KernelState {
  /** Live instance registry, nested by tenant (L12). */
  readonly instances: Readonly<Record<string, Readonly<Record<string, InstanceRecord>>>>;
  /** Mailbox registry: per tenant, per instance, ordered envelopes. */
  readonly mailboxes: Readonly<Record<string, Readonly<Record<string, readonly MessageEnvelope[]>>>>;
  /** Topic subscriptions: per tenant, per topic, subscriber instance ids. */
  readonly subscriptions: Readonly<
    Record<string, Readonly<Record<string, readonly AgentInstanceId[]>>>
  >;
  /** The accepted operation log — replayable (L9). Rejected ops never appear. */
  readonly operationLog: readonly KernelOperation[];
  /** Accepted op ids (global) — the duplicate-rejection index. */
  readonly processedOpIds: Readonly<Record<string, true>>;
  /** Per tenant, per actor: timestamp of the last accepted op (monotonicity). */
  readonly lastOpAt: Readonly<Record<string, Readonly<Record<string, TimestampMs>>>>;
  /** Per tenant, per sender: last assigned message sequence (per-sender ordering). */
  readonly sequenceCounters: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

// --- Nested-record guard helpers (hand-rolled, `any`-free) -------------------

function isRecordOfRecords<V>(
  v: unknown,
  valueGuard: (inner: unknown) => boolean,
): v is Record<string, Record<string, unknown>> {
  if (!isRecord(v)) return false;
  for (const key of Object.keys(v)) {
    const inner: unknown = v[key];
    if (!isRecord(inner)) return false;
    for (const innerKey of Object.keys(inner)) {
      if (!valueGuard((inner as Record<string, unknown>)[innerKey])) return false;
    }
  }
  return true;
}

function isInstanceRegistry(v: unknown): v is Record<string, Record<string, InstanceRecord>> {
  return isRecordOfRecords(v, isInstanceRecord);
}

function isMailboxRegistry(
  v: unknown,
): v is Record<string, Record<string, readonly MessageEnvelope[]>> {
  if (!isRecord(v)) return false;
  for (const tenantKey of Object.keys(v)) {
    const perTenant: unknown = v[tenantKey];
    if (!isRecord(perTenant)) return false;
    for (const boxKey of Object.keys(perTenant)) {
      const box: unknown = (perTenant as Record<string, unknown>)[boxKey];
      if (!Array.isArray(box)) return false;
      if (!box.every((envelope) => isMessageEnvelope(envelope))) return false;
    }
  }
  return true;
}

function isSubscriptionRegistry(
  v: unknown,
): v is Record<string, Record<string, readonly AgentInstanceId[]>> {
  if (!isRecord(v)) return false;
  for (const tenantKey of Object.keys(v)) {
    const perTenant: unknown = v[tenantKey];
    if (!isRecord(perTenant)) return false;
    for (const topicKey of Object.keys(perTenant)) {
      const subscribers: unknown = (perTenant as Record<string, unknown>)[topicKey];
      if (!Array.isArray(subscribers)) return false;
      if (!subscribers.every((id) => isAgentInstanceId(id))) return false;
    }
  }
  return true;
}

function isTimestampMatrix(v: unknown): v is Record<string, Record<string, TimestampMs>> {
  return isRecordOfRecords(v, isTimestampMs);
}

function isCounterMatrix(v: unknown): v is Record<string, Record<string, number>> {
  return isRecordOfRecords(v, (inner): boolean =>
    typeof inner === 'number' && Number.isInteger(inner) && inner >= 0,
  );
}

function isOpIdIndex(v: unknown): v is Record<string, true> {
  if (!isRecord(v)) return false;
  for (const key of Object.keys(v)) {
    const flag: unknown = v[key];
    if (flag !== true) return false;
    if (!isKernelOpId(key)) return false;
  }
  return true;
}

/** Guard: `KernelState` (structural — the machine-checkable state schema). */
export function isKernelState(v: unknown): v is KernelState {
  if (!isRecord(v)) return false;
  return (
    isInstanceRegistry(v.instances) &&
    isMailboxRegistry(v.mailboxes) &&
    isSubscriptionRegistry(v.subscriptions) &&
    Array.isArray(v.operationLog) &&
    v.operationLog.every((op) => isKernelOperation(op)) &&
    isOpIdIndex(v.processedOpIds) &&
    isTimestampMatrix(v.lastOpAt) &&
    isCounterMatrix(v.sequenceCounters)
  );
}

/**
 * The empty kernel state — the single root of every fold. Deeply frozen.
 */
export function createInitialKernelState(): KernelState {
  return deepFreeze({
    instances: {},
    mailboxes: {},
    subscriptions: {},
    operationLog: [],
    processedOpIds: {},
    lastOpAt: {},
    sequenceCounters: {},
  });
}

// ---------------------------------------------------------------------------
// Tenant-scoped lookup helpers (cross-tenant lookups are not expressible)
// ---------------------------------------------------------------------------

/** The live instance with `id` in `tenant`, or `null` — never searches other tenants. */
export function instanceOf(
  state: KernelState,
  tenant: TenantId,
  id: AgentInstanceId,
): InstanceRecord | null {
  const perTenant = state.instances[tenant];
  if (perTenant === undefined) return null;
  const record = perTenant[id];
  return record === undefined ? null : record;
}

/**
 * `true` when `id` is registered in SOME OTHER tenant — used by the reducer
 * to distinguish `cross-tenant` (exists elsewhere) from `unknown-instance`
 * (exists nowhere). This is the ONLY exported function that looks across
 * tenants, and it exists solely to REJECT cross-tenant references (L12).
 */
export function existsInAnotherTenant(
  state: KernelState,
  tenant: TenantId,
  id: AgentInstanceId,
): boolean {
  for (const tenantKey of Object.keys(state.instances)) {
    if (tenantKey === tenant) continue;
    const perTenant: unknown = state.instances[tenantKey];
    if (!isRecord(perTenant)) continue;
    if (id in perTenant) return true;
  }
  return false;
}

/** The mailbox of `id` in `tenant` (empty when absent) — never searches other tenants. */
export function mailboxOf(
  state: KernelState,
  tenant: TenantId,
  id: AgentInstanceId,
): readonly MessageEnvelope[] {
  const perTenant = state.mailboxes[tenant];
  if (perTenant === undefined) return [];
  const box = perTenant[id];
  return box === undefined ? [] : box;
}

/** Subscribers of `topic` in `tenant` (empty when absent) — never searches other tenants. */
export function subscribersOf(
  state: KernelState,
  tenant: TenantId,
  topic: TopicName,
): readonly AgentInstanceId[] {
  const perTenant = state.subscriptions[tenant];
  if (perTenant === undefined) return [];
  const subscribers = perTenant[topic];
  return subscribers === undefined ? [] : subscribers;
}

/**
 * The full management chain of `id` in `tenant`, `[id, manager, …, root]`.
 * `null` when `id` is not live. Under the kernel's invariants every link is
 * a live instance, so the walk always terminates at a root.
 */
export function managerChainOf(
  state: KernelState,
  tenant: TenantId,
  id: AgentInstanceId,
): readonly AgentInstanceId[] | null {
  const chain: AgentInstanceId[] = [];
  let current: InstanceRecord | null = instanceOf(state, tenant, id);
  while (current !== null) {
    chain.push(current.id);
    if (current.managerId === null) return chain;
    current = instanceOf(state, tenant, current.managerId);
  }
  return chain.length > 0 ? chain : null;
}

/**
 * `true` when `candidate` is `id` itself or an ancestor manager of `id`
 * (the manager-chain authority for TERMINATE).
 */
export function isSelfOrAncestor(
  state: KernelState,
  tenant: TenantId,
  id: AgentInstanceId,
  candidate: AgentInstanceId,
): boolean {
  const chain = managerChainOf(state, tenant, id);
  return chain !== null && chain.includes(candidate);
}

/**
 * Direct reports of `id` in `tenant` — instances whose `managerId` is `id`.
 */
export function reportsOf(
  state: KernelState,
  tenant: TenantId,
  id: AgentInstanceId,
): readonly AgentInstanceId[] {
  const perTenant = state.instances[tenant];
  if (perTenant === undefined) return [];
  const reports: AgentInstanceId[] = [];
  for (const key of Object.keys(perTenant)) {
    const record: unknown = perTenant[key];
    if (!isInstanceRecord(record)) continue;
    if (record.managerId === id) reports.push(record.id);
  }
  return reports;
}

/**
 * Walks the manager chain of every live instance in `tenant` and returns
 * the first management cycle found (e.g. `[a, b, a]`), or `null`. Mirrors
 * `detectManagementCycle` from `@tradrl/agent-body`'s instance module
 * (defense in depth for hand-crafted state; the SPAWN reducer prevents
 * cycles structurally — a freshly spawned node has no inbound edges).
 */
export function detectManagementCycle(
  state: KernelState,
  tenant: TenantId,
): readonly AgentInstanceId[] | null {
  const perTenant = state.instances[tenant];
  if (perTenant === undefined) return null;
  const instances: InstanceRecord[] = [];
  for (const key of Object.keys(perTenant)) {
    const record: unknown = perTenant[key];
    if (isInstanceRecord(record)) instances.push(record);
  }
  const byId = new Map<AgentInstanceId, InstanceRecord>();
  for (const instance of instances) byId.set(instance.id, instance);
  for (const start of instances) {
    const seen = new Set<AgentInstanceId>();
    const path: AgentInstanceId[] = [];
    let current: InstanceRecord | null = start;
    while (current !== null && current.managerId !== null) {
      if (seen.has(current.id)) {
        const from = path.indexOf(current.id);
        return [...path.slice(from), current.id];
      }
      seen.add(current.id);
      path.push(current.id);
      const next: InstanceRecord | undefined = byId.get(current.managerId);
      current = next === undefined ? null : next;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Semantic state validation (defense in depth for parsed/hand-crafted state)
// ---------------------------------------------------------------------------

/** Why a structurally valid `KernelState` is still semantically invalid. */
export const STATE_VIOLATION_CODES = [
  'management-cycle',
  'mailbox-without-instance',
  'subscriber-without-instance',
  'tenant-scope-leak',
] as const;

/** A semantic kernel-state violation. */
export interface StateViolation {
  readonly code: (typeof STATE_VIOLATION_CODES)[number];
  readonly message: string;
}

/** Result of `validateKernelState`. */
export interface KernelStateValidation {
  readonly valid: boolean;
  readonly violations: readonly StateViolation[];
}

/**
 * Validates semantic invariants a structural guard cannot express:
 * - management graphs are acyclic per tenant (mirrors agent-body law);
 * - mailboxes only exist for live instances;
 * - subscriptions only reference live subscribers;
 * - every instance's `tenantId` matches its registry key (no tenant leaks).
 */
export function validateKernelState(state: KernelState): KernelStateValidation {
  const violations: StateViolation[] = [];
  for (const tenantKey of Object.keys(state.instances)) {
    const cycle = detectManagementCycle(state, tenantKey as TenantId);
    if (cycle !== null) {
      violations.push({
        code: 'management-cycle',
        message: `management cycle in tenant ${tenantKey}: ${cycle.join(' -> ')}`,
      });
    }
    const perTenant = state.instances[tenantKey];
    if (perTenant !== undefined) {
      for (const instanceKey of Object.keys(perTenant)) {
        const record: unknown = perTenant[instanceKey];
        if (isInstanceRecord(record) && record.tenantId !== tenantKey) {
          violations.push({
            code: 'tenant-scope-leak',
            message: `instance ${instanceKey} carries tenantId ${record.tenantId} but is registered under ${tenantKey}`,
          });
        }
      }
    }
  }
  for (const tenantKey of Object.keys(state.mailboxes)) {
    const perTenant = state.mailboxes[tenantKey];
    if (perTenant === undefined) continue;
    const registry = state.instances[tenantKey];
    for (const boxKey of Object.keys(perTenant)) {
      if (registry === undefined || !(boxKey in registry)) {
        violations.push({
          code: 'mailbox-without-instance',
          message: `mailbox ${boxKey} exists in tenant ${tenantKey} but the instance is not live`,
        });
      }
    }
  }
  for (const tenantKey of Object.keys(state.subscriptions)) {
    const perTenant = state.subscriptions[tenantKey];
    if (perTenant === undefined) continue;
    const registry = state.instances[tenantKey];
    for (const topicKey of Object.keys(perTenant)) {
      const subscribers: unknown = perTenant[topicKey];
      if (!Array.isArray(subscribers)) continue;
      for (const subscriber of subscribers) {
        if (!isAgentInstanceId(subscriber)) continue;
        if (registry === undefined || !(subscriber in registry)) {
          violations.push({
            code: 'subscriber-without-instance',
            message: `subscriber ${subscriber} of topic ${topicKey} in tenant ${tenantKey} is not a live instance`,
          });
        }
      }
    }
  }
  return { valid: violations.length === 0, violations };
}
