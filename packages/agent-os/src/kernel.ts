// @tradrl/agent-os — the kernel reducer.
//
// Spec anchors: spec/ARCHITECTURE.md ("Agent OS: Stable kernel … Higher-level
// organization is adaptive."); spec/ARCHITECTURE-LOCK.md L8 (EXECUTE is
// authority-neutral: the kernel transports an intent to an execution gate;
// it never grants authority — authorization/limits/kill-switch semantics are
// enforced outside), L9 (replayable operation logs), L12 (tenant isolation —
// every record, message and effect is tenant-scoped), L20 (safety outside
// prompts).
//
// THE KERNEL IS A REDUCER:
//   applyOperation(state, op) -> { state', effects }
// - No wall clocks: operations carry their own timestamps.
// - No randomness: message ids and sequences are derived deterministically.
// - No mutation: transitions are pure; the input state is never touched
//   (transitions work on a JSON clone and return a deeply frozen result).
// - Rejected operations leave NO state trace and are never logged; the
//   rejection itself is returned as data (`KernelError`).
//
// Validation order (deterministic, documented for replay forensics):
//   1. structural guard (`isKernelOperation`)
//   2. duplicate op id
//   3. actor resolution (live in the op's tenant — or the tenant-bootstrap
//      window, which ONLY SPAWN may use)
//   4. action authority (declarative whitelist over the fourteen verbs)
//   5. monotonicity (per-actor, per-tenant: timestamps never go backwards)
//   6. op-specific semantics (targets, chains, subscriptions, scopes)
//   7. transition
//
// Supervision laws implemented here:
// - Manager-chain enforcement: TERMINATE may only be issued by the target
//   itself or one of the target's ancestor managers.
// - ESCALATE routing: to the nearest manager (the actor's direct manager;
//   management links are always live, so "nearest manager with authority"
//   resolves to the first live ancestor — deeper authority-scoped routing is
//   adaptive structure owned by the organization compiler, T016).
// - Termination cascade policy: terminating a manager re-parents each of
//   its reports to the terminated manager's own manager and spawns an
//   ESCALATE effect (plus a cascade mailbox message) for every report.

import {
  type AgentInstanceId,
  type KernelOpId,
  type MessageId,
  type MessagePayload,
  type TenantId,
  type TopicName,
  deepFreeze,
  isKernelOpId,
  isNonEmptyString,
  isRecord,
} from './primitives';
import { type ReasonText } from './actions';
import { type KernelAuthority, isActionAllowed } from './authority';
import { type KernelError, type KernelErrorCode, kernelError } from './errors';
import {
  type MessageEnvelope,
  KERNEL_TOPICS,
  isKernelTopic,
  isMessageEnvelope,
} from './envelope';
import {
  type KernelOperation,
  type ReportSummary,
  isKernelOperation,
} from './operations';
import {
  type InstanceRecord,
  type KernelState,
  createInitialKernelState,
  existsInAnotherTenant,
  instanceOf,
  managerChainOf,
  reportsOf,
  subscribersOf,
} from './state';
import { type TimestampMs } from './timestamp';

const [
  TOPIC_REQUEST,
  TOPIC_DELEGATE,
  TOPIC_CHALLENGE,
  TOPIC_PROPOSE,
  TOPIC_APPROVE,
  TOPIC_ESCALATE,
  TOPIC_CASCADE_ESCALATE,
] = KERNEL_TOPICS.map((topic) => topic as TopicName) as readonly TopicName[];

// ---------------------------------------------------------------------------
// Effects — intents for the world OUTSIDE the kernel's pure state
// ---------------------------------------------------------------------------

/** SPAWN succeeded: the runtime may provision resources for the instance. */
export interface InstanceSpawnedEffect {
  readonly kind: 'instance-spawned';
  readonly tenantId: TenantId;
  readonly instanceId: AgentInstanceId;
  readonly managerId: AgentInstanceId | null;
  readonly causalityId: KernelOpId;
}

/** TERMINATE succeeded: the runtime may release the instance's resources. */
export interface InstanceTerminatedEffect {
  readonly kind: 'instance-terminated';
  readonly tenantId: TenantId;
  readonly instanceId: AgentInstanceId;
  readonly reason: ReasonText;
  readonly causalityId: KernelOpId;
}

/** A message was deposited into a live instance's mailbox. */
export interface MessageDeliveredEffect {
  readonly kind: 'message-delivered';
  readonly tenantId: TenantId;
  readonly to: AgentInstanceId;
  readonly envelope: MessageEnvelope;
  readonly causalityId: KernelOpId;
}

/**
 * An escalation was raised (directly via ESCALATE, or as a termination
 * cascade). `to` is `null` when no manager exists — the runtime surfaces
 * unhandled escalations to the control plane.
 */
export interface EscalatedEffect {
  readonly kind: 'escalated';
  readonly tenantId: TenantId;
  readonly from: AgentInstanceId;
  readonly to: AgentInstanceId | null;
  readonly reason: ReasonText;
  readonly chain: readonly AgentInstanceId[];
  readonly causalityId: KernelOpId;
}

/**
 * EXECUTE was accepted and transported. L8/L20: `authorityTokenRef` is
 * carried VERBATIM and is NEVER evaluated by the kernel — the execution
 * gate (T019/T020/T034 lane) alone decides.
 */
export interface ExecutionTransportedEffect {
  readonly kind: 'execution-transported';
  readonly tenantId: TenantId;
  readonly actor: AgentInstanceId;
  readonly intentRef: string;
  readonly authorityTokenRef: string;
  readonly causalityId: KernelOpId;
}

/** OBSERVE was accepted and transported to the observation lanes. */
export interface ObservationTransportedEffect {
  readonly kind: 'observation-transported';
  readonly tenantId: TenantId;
  readonly actor: AgentInstanceId;
  readonly queryRef: string;
  readonly causalityId: KernelOpId;
}

/** LEARN was accepted and transported to the learning lanes. */
export interface LearningTransportedEffect {
  readonly kind: 'learning-transported';
  readonly tenantId: TenantId;
  readonly actor: AgentInstanceId;
  readonly lessonRef: string;
  readonly causalityId: KernelOpId;
}

/** REPORT was accepted and transported to the reporting lane. */
export interface ReportTransportedEffect {
  readonly kind: 'report-transported';
  readonly tenantId: TenantId;
  readonly actor: AgentInstanceId;
  readonly summary: ReportSummary;
  readonly causalityId: KernelOpId;
}

/**
 * The kernel effect union. Effects are pure value objects describing what
 * the RUNTIME should do outside the kernel state; every effect is
 * tenant-scoped (L12) and carries the causality id of the operation that
 * produced it.
 */
export type KernelEffect =
  | InstanceSpawnedEffect
  | InstanceTerminatedEffect
  | MessageDeliveredEffect
  | EscalatedEffect
  | ExecutionTransportedEffect
  | ObservationTransportedEffect
  | LearningTransportedEffect
  | ReportTransportedEffect;

function isEffectBase(v: Record<string, unknown>, kind: string): boolean {
  return (
    v.kind === kind &&
    typeof v.tenantId === 'string' &&
    isKernelOpId(v.causalityId)
  );
}

/** Guard: `InstanceSpawnedEffect`. */
export function isInstanceSpawnedEffect(v: unknown): v is InstanceSpawnedEffect {
  return (
    isRecord(v) &&
    isEffectBase(v, 'instance-spawned') &&
    typeof v.instanceId === 'string' &&
    (v.managerId === null || typeof v.managerId === 'string')
  );
}

/** Guard: `InstanceTerminatedEffect`. */
export function isInstanceTerminatedEffect(v: unknown): v is InstanceTerminatedEffect {
  return (
    isRecord(v) &&
    isEffectBase(v, 'instance-terminated') &&
    typeof v.instanceId === 'string' &&
    isNonEmptyString(v.reason)
  );
}

/** Guard: `MessageDeliveredEffect`. */
export function isMessageDeliveredEffect(v: unknown): v is MessageDeliveredEffect {
  return (
    isRecord(v) &&
    isEffectBase(v, 'message-delivered') &&
    typeof v.to === 'string' &&
    isMessageEnvelope(v.envelope)
  );
}

/** Guard: `EscalatedEffect`. */
export function isEscalatedEffect(v: unknown): v is EscalatedEffect {
  return (
    isRecord(v) &&
    isEffectBase(v, 'escalated') &&
    typeof v.from === 'string' &&
    (v.to === null || typeof v.to === 'string') &&
    isNonEmptyString(v.reason) &&
    Array.isArray(v.chain) &&
    v.chain.every((id) => typeof id === 'string')
  );
}

/** Guard: `ExecutionTransportedEffect`. */
export function isExecutionTransportedEffect(v: unknown): v is ExecutionTransportedEffect {
  return (
    isRecord(v) &&
    isEffectBase(v, 'execution-transported') &&
    typeof v.actor === 'string' &&
    isNonEmptyString(v.intentRef) &&
    isNonEmptyString(v.authorityTokenRef)
  );
}

/** Guard: `ObservationTransportedEffect`. */
export function isObservationTransportedEffect(v: unknown): v is ObservationTransportedEffect {
  return (
    isRecord(v) &&
    isEffectBase(v, 'observation-transported') &&
    typeof v.actor === 'string' &&
    isNonEmptyString(v.queryRef)
  );
}

/** Guard: `LearningTransportedEffect`. */
export function isLearningTransportedEffect(v: unknown): v is LearningTransportedEffect {
  return (
    isRecord(v) &&
    isEffectBase(v, 'learning-transported') &&
    typeof v.actor === 'string' &&
    isNonEmptyString(v.lessonRef)
  );
}

/** Guard: `ReportTransportedEffect`. */
export function isReportTransportedEffect(v: unknown): v is ReportTransportedEffect {
  return (
    isRecord(v) &&
    isEffectBase(v, 'report-transported') &&
    typeof v.actor === 'string' &&
    isRecord(v.summary)
  );
}

/** Guard: the `KernelEffect` union. */
export function isKernelEffect(v: unknown): v is KernelEffect {
  if (!isRecord(v) || typeof v.kind !== 'string') return false;
  switch (v.kind) {
    case 'instance-spawned':
      return isInstanceSpawnedEffect(v);
    case 'instance-terminated':
      return isInstanceTerminatedEffect(v);
    case 'message-delivered':
      return isMessageDeliveredEffect(v);
    case 'escalated':
      return isEscalatedEffect(v);
    case 'execution-transported':
      return isExecutionTransportedEffect(v);
    case 'observation-transported':
      return isObservationTransportedEffect(v);
    case 'learning-transported':
      return isLearningTransportedEffect(v);
    case 'report-transported':
      return isReportTransportedEffect(v);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// The apply result
// ---------------------------------------------------------------------------

/**
 * The result of `applyOperation`. On success: the NEXT deeply frozen state
 * plus the effects the runtime should perform. On failure: the INPUT state
 * (unchanged, same reference) plus a `KernelError` from the taxonomy.
 */
export type KernelApplyResult =
  | { readonly ok: true; readonly state: KernelState; readonly effects: readonly KernelEffect[] }
  | { readonly ok: false; readonly state: KernelState; readonly error: KernelError };

// ---------------------------------------------------------------------------
// Reducer internals
// ---------------------------------------------------------------------------

/**
 * Mutable working copy of `KernelState`. Transitions deep-clone the frozen
 * input into this shape, mutate the clone, and re-freeze — the input is
 * never aliased, which is the mechanical half of the purity law.
 */
interface KernelStateDraft {
  instances: Record<string, Record<string, InstanceRecord>>;
  mailboxes: Record<string, Record<string, MessageEnvelope[]>>;
  subscriptions: Record<string, Record<string, AgentInstanceId[]>>;
  operationLog: KernelOperation[];
  processedOpIds: Record<string, true>;
  lastOpAt: Record<string, Record<string, TimestampMs>>;
  sequenceCounters: Record<string, Record<string, number>>;
}

function toDraft(state: KernelState): KernelStateDraft {
  return JSON.parse(JSON.stringify(state)) as KernelStateDraft;
}

function toState(draft: KernelStateDraft): KernelState {
  return deepFreeze(draft as unknown as KernelState);
}

function fail(state: KernelState, code: KernelErrorCode, message: string): KernelApplyResult {
  return { ok: false, state, error: kernelError(code, message) };
}

/** Actor resolution outcome: live instance, tenant-bootstrap window, or rejection. */
type ActorResolution =
  | { readonly status: 'live'; readonly instance: InstanceRecord }
  | { readonly status: 'bootstrap' }
  | { readonly status: 'rejected'; readonly error: KernelError };

function resolveActor(state: KernelState, op: KernelOperation): ActorResolution {
  const live = instanceOf(state, op.tenantId, op.actor);
  if (live !== null) return { status: 'live', instance: live };
  if (existsInAnotherTenant(state, op.tenantId, op.actor)) {
    return {
      status: 'rejected',
      error: kernelError(
        'cross-tenant',
        `actor ${op.actor} is not an instance of tenant ${op.tenantId} (it exists in another tenant)`,
      ),
    };
  }
  const perTenant = state.instances[op.tenantId];
  const tenantEmpty = perTenant === undefined || Object.keys(perTenant).length === 0;
  if (tenantEmpty) return { status: 'bootstrap' };
  return {
    status: 'rejected',
    error: kernelError(
      'unknown-instance',
      `actor ${op.actor} is not a live instance of tenant ${op.tenantId}`,
    ),
  };
}

/** An id that must resolve to a LIVE instance of the op's tenant, or a rejection. */
type TargetResolution = InstanceRecord | KernelError;

function resolveTarget(
  state: KernelState,
  op: KernelOperation,
  id: AgentInstanceId,
  role: string,
): TargetResolution {
  const live = instanceOf(state, op.tenantId, id);
  if (live !== null) return live;
  if (existsInAnotherTenant(state, op.tenantId, id)) {
    return kernelError(
      'cross-tenant',
      `${role} ${id} is not an instance of tenant ${op.tenantId} (it exists in another tenant)`,
    );
  }
  return kernelError('unknown-instance', `${role} ${id} is not a live instance of tenant ${op.tenantId}`);
}

function isTargetError(value: TargetResolution): value is KernelError {
  return typeof value === 'object' && value !== null && 'code' in value;
}

function checkMonotonicity(state: KernelState, op: KernelOperation): KernelError | null {
  const perTenant = state.lastOpAt[op.tenantId];
  if (perTenant === undefined) return null;
  const last = perTenant[op.actor];
  if (last === undefined) return null;
  if (op.timestamp < last) {
    return kernelError(
      'monotonicity-violation',
      `actor ${op.actor} timestamp ${op.timestamp} precedes its last accepted operation at ${last}`,
    );
  }
  return null;
}

/** Next per-sender message sequence (1-based, strictly increasing per sender id). */
function nextSequence(state: KernelState, tenant: TenantId, sender: AgentInstanceId): number {
  const perTenant = state.sequenceCounters[tenant];
  if (perTenant === undefined) return 1;
  const last = perTenant[sender];
  return last === undefined ? 1 : last + 1;
}

/** Rebrands an opaque string as an envelope payload (payloads are opaque to the kernel). */
function asPayload(value: string): MessagePayload {
  return value as MessagePayload;
}

interface EnvelopeParams {
  readonly opId: KernelOpId;
  readonly topic: TopicName;
  readonly tenantId: TenantId;
  readonly sender: AgentInstanceId;
  readonly payload: MessagePayload;
  readonly sequence: number;
  readonly publishedAt: TimestampMs;
}

/**
 * Builds the deterministic, deeply frozen envelope for a kernel-produced
 * message. The id is derived (`msg:${opId}:${sender}:${sequence}`) — no
 * randomness, no clock.
 */
function buildEnvelope(params: EnvelopeParams): MessageEnvelope {
  const id = `msg:${params.opId}:${params.sender}:${params.sequence}` as MessageId;
  return deepFreeze({
    id,
    topic: params.topic,
    tenantId: params.tenantId,
    sender: params.sender,
    payload: params.payload,
    sequence: params.sequence,
    causalityId: params.opId,
    publishedAt: params.publishedAt,
  });
}

function delivered(
  tenantId: TenantId,
  to: AgentInstanceId,
  envelope: MessageEnvelope,
  causalityId: KernelOpId,
): MessageDeliveredEffect {
  return { kind: 'message-delivered', tenantId, to, envelope, causalityId };
}

function enqueue(
  draft: KernelStateDraft,
  tenant: TenantId,
  recipient: AgentInstanceId,
  envelope: MessageEnvelope,
): void {
  const perTenant = draft.mailboxes[tenant] ?? {};
  const box = perTenant[recipient] ?? [];
  box.push(envelope);
  perTenant[recipient] = box;
  draft.mailboxes[tenant] = perTenant;
}

function bumpSequence(
  draft: KernelStateDraft,
  tenant: TenantId,
  sender: AgentInstanceId,
): void {
  const perTenant = draft.sequenceCounters[tenant] ?? {};
  perTenant[sender] = (perTenant[sender] ?? 0) + 1;
  draft.sequenceCounters[tenant] = perTenant;
}

function recordAcceptance(
  draft: KernelStateDraft,
  op: KernelOperation,
  actorStillLive: boolean,
): void {
  draft.operationLog.push(op);
  draft.processedOpIds[op.opId] = true;
  if (actorStillLive) {
    const perTenant = draft.lastOpAt[op.tenantId] ?? {};
    perTenant[op.actor] = op.timestamp;
    draft.lastOpAt[op.tenantId] = perTenant;
  }
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/**
 * Applies one kernel operation to the state — the ENTIRE transition surface
 * of the Agent OS. Pure: no clocks, no randomness, no input mutation. See
 * the module header for the frozen validation order and the supervision
 * laws. Always returns a deeply frozen next state on success; on failure
 * returns the input state reference unchanged.
 */
export function applyOperation(state: KernelState, op: KernelOperation): KernelApplyResult {
  // 1. Structural guard — the reducer never trusts its input.
  if (!isKernelOperation(op)) {
    return fail(state, 'invalid-operation', 'operation failed the structural guard (isKernelOperation)');
  }
  // 2. Duplicate op id — the log is append-only and idempotent-keyed.
  if (state.processedOpIds[op.opId] === true) {
    return fail(state, 'duplicate-op-id', `operation id ${op.opId} has already been accepted`);
  }
  // 3. Actor resolution.
  const actor = resolveActor(state, op);
  if (actor.status === 'rejected') return { ok: false, state, error: actor.error };
  if (actor.status === 'bootstrap' && op.type !== 'SPAWN') {
    return fail(
      state,
      'unknown-instance',
      `actor ${op.actor} is not a live instance of tenant ${op.tenantId} (only the first SPAWN of a tenant may be externally vouched)`,
    );
  }
  // 4. Action authority — the declarative whitelist check, and NOTHING more
  //    (L8/L20: no token, limit or kill-switch evaluation ever happens here).
  if (actor.status === 'live' && !isActionAllowed(actor.instance.authority, op.type)) {
    return fail(
      state,
      'action-not-allowed',
      `actor ${op.actor} is not allowed to perform ${op.type} (authority scope)`,
    );
  }
  // 5. Monotonicity (per tenant, per actor).
  const monotonicity = checkMonotonicity(state, op);
  if (monotonicity !== null) return { ok: false, state, error: monotonicity };

  // 6–7. Op-specific semantics and transition.
  switch (op.type) {
    case 'SPAWN':
      return applySpawn(state, op, actor);
    case 'TERMINATE':
      return applyTerminate(state, op);
    case 'DELEGATE':
      return applyDelegate(state, op);
    case 'REQUEST':
      return applyDirectedMessage(state, op, TOPIC_REQUEST, op.payload);
    case 'PUBLISH':
      return applyPublish(state, op);
    case 'SUBSCRIBE':
      return applySubscribe(state, op);
    case 'CHALLENGE':
      return applyProposalTransport(state, op, TOPIC_CHALLENGE);
    case 'PROPOSE':
      return applyProposalTransport(state, op, TOPIC_PROPOSE);
    case 'APPROVE':
      return applyProposalTransport(state, op, TOPIC_APPROVE);
    case 'EXECUTE':
      return applyExecute(state, op);
    case 'ESCALATE':
      return applyEscalate(state, op);
    case 'OBSERVE':
      return applyObserve(state, op);
    case 'LEARN':
      return applyLearn(state, op);
    case 'REPORT':
      return applyReport(state, op);
  }
}

// --- SPAWN -------------------------------------------------------------------

function applySpawn(
  state: KernelState,
  op: Extract<KernelOperation, { type: 'SPAWN' }>,
  actor: ActorResolution,
): KernelApplyResult {
  const bootstrap = actor.status === 'bootstrap';
  // Target must be free in this tenant.
  if (instanceOf(state, op.tenantId, op.target) !== null) {
    return fail(state, 'duplicate-instance', `instance ${op.target} already exists in tenant ${op.tenantId}`);
  }
  if (op.managerId === op.target) {
    return fail(state, 'invalid-operation', `spawn target ${op.target} cannot be its own manager`);
  }
  if (bootstrap && op.managerId !== null) {
    return fail(
      state,
      'invalid-operation',
      `tenant bootstrap spawn of ${op.target} must be a root instance (managerId null)`,
    );
  }
  if (op.managerId !== null) {
    const resolved = resolveTarget(state, op, op.managerId, 'manager');
    if (isTargetError(resolved)) return { ok: false, state, error: resolved };
  }
  // The structural SPAWN guard already validated the authority record's
  // shape; semantics: allowed/denied disjoint, no duplicate entries.
  const authorityProblems = describeAuthorityProblems(op.authority);
  if (authorityProblems !== null) {
    return fail(state, 'invalid-operation', `spawn of ${op.target}: ${authorityProblems}`);
  }

  const draft = toDraft(state);
  const perTenant = draft.instances[op.tenantId] ?? {};
  const record: InstanceRecord = {
    id: op.target,
    tenantId: op.tenantId,
    managerId: op.managerId,
    bodyVersionRef: op.bodyVersionRef,
    substrateRef: op.substrateRef,
    authority: op.authority,
    spawnedAt: op.timestamp,
    spawnedBy: bootstrap ? null : op.actor,
  };
  perTenant[op.target] = record;
  draft.instances[op.tenantId] = perTenant;
  // The spawned instance's own op timeline starts at its spawn time; the
  // bootstrap actor's baseline is also recorded (monotonicity holds across
  // the externally-vouched boundary).
  const baselines = draft.lastOpAt[op.tenantId] ?? {};
  baselines[op.target] = op.timestamp;
  draft.lastOpAt[op.tenantId] = baselines;
  recordAcceptance(draft, op, true);

  const effects: KernelEffect[] = [
    {
      kind: 'instance-spawned',
      tenantId: op.tenantId,
      instanceId: op.target,
      managerId: op.managerId,
      causalityId: op.opId,
    },
  ];
  return { ok: true, state: toState(draft), effects: deepFreeze(effects) };
}

function describeAuthorityProblems(authority: KernelAuthority): string | null {
  const allowed = new Set<string>(authority.allowedActions);
  const denied = new Set<string>(authority.deniedActions);
  for (const action of authority.allowedActions) {
    if (denied.has(action)) {
      return `authority allows and denies ${action}`;
    }
  }
  if (allowed.size !== authority.allowedActions.length) return 'authority.allowedActions has duplicates';
  if (denied.size !== authority.deniedActions.length) return 'authority.deniedActions has duplicates';
  return null;
}

// --- TERMINATE -----------------------------------------------------------------

function applyTerminate(
  state: KernelState,
  op: Extract<KernelOperation, { type: 'TERMINATE' }>,
): KernelApplyResult {
  const resolved = resolveTarget(state, op, op.target, 'terminate target');
  if (isTargetError(resolved)) return { ok: false, state, error: resolved };
  const target = resolved;
  // Manager-chain enforcement: the target itself or an ancestor manager.
  const chain = managerChainOf(state, op.tenantId, target.id);
  if (chain === null || !chain.includes(op.actor)) {
    return fail(
      state,
      'manager-chain-violation',
      `actor ${op.actor} may not terminate ${target.id} (not the target itself and not one of its managers)`,
    );
  }

  const draft = toDraft(state);
  const effects: KernelEffect[] = [
    {
      kind: 'instance-terminated',
      tenantId: op.tenantId,
      instanceId: target.id,
      reason: op.reason,
      causalityId: op.opId,
    },
  ];

  // Remove the instance, its mailbox and its monotonicity baseline; keep its
  // sequence counters (the per-sender-id sequence never resets across
  // instance lives — total per-sender order across the whole log).
  const instancesPerTenant = draft.instances[op.tenantId] ?? {};
  delete instancesPerTenant[target.id];
  const mailboxesPerTenant = draft.mailboxes[op.tenantId] ?? {};
  delete mailboxesPerTenant[target.id];
  draft.mailboxes[op.tenantId] = mailboxesPerTenant;
  const baselines = draft.lastOpAt[op.tenantId] ?? {};
  delete baselines[target.id];
  draft.lastOpAt[op.tenantId] = baselines;
  // Unsubscribe from every topic in this tenant.
  const subscriptionsPerTenant = draft.subscriptions[op.tenantId] ?? {};
  for (const topicKey of Object.keys(subscriptionsPerTenant)) {
    const subscribers = subscriptionsPerTenant[topicKey] ?? [];
    const filtered = subscribers.filter((id) => id !== target.id);
    if (filtered.length !== subscribers.length) {
      subscriptionsPerTenant[topicKey] = filtered;
    }
  }
  draft.subscriptions[op.tenantId] = subscriptionsPerTenant;

  // Termination cascade policy: re-parent each report to the terminated
  // manager's own manager, and spawn an ESCALATE effect (+ cascade message)
  // for every report. Management links stay live, so dangling parents never
  // form; if the terminated instance was a root, its reports become roots
  // and the escalations are surfaced to the control plane (to = null).
  const newManager = target.managerId;
  const reports = reportsOf(state, op.tenantId, target.id);
  const newManagerChain =
    newManager === null ? [] : (managerChainOf(state, op.tenantId, newManager) ?? []);
  for (const report of reports) {
    const reportRecord = instancesPerTenant[report];
    if (reportRecord === undefined) continue;
    instancesPerTenant[report] = { ...reportRecord, managerId: newManager };
    const cascadeChain: AgentInstanceId[] = [report, target.id, ...newManagerChain];
    const reason = `manager-terminated: ${op.reason}` as ReasonText;
    effects.push({
      kind: 'escalated',
      tenantId: op.tenantId,
      from: report,
      to: newManager,
      reason,
      chain: cascadeChain,
      causalityId: op.opId,
    });
    if (newManager !== null) {
      const sequence = nextSequence(state, op.tenantId, report);
      const envelope = buildEnvelope({
        opId: op.opId,
        topic: TOPIC_CASCADE_ESCALATE,
        tenantId: op.tenantId,
        sender: report,
        payload: asPayload(reason),
        sequence,
        publishedAt: op.timestamp,
      });
      enqueue(draft, op.tenantId, newManager, envelope);
      bumpSequence(draft, op.tenantId, report);
      effects.push(delivered(op.tenantId, newManager, envelope, op.opId));
    }
  }
  draft.instances[op.tenantId] = instancesPerTenant;

  recordAcceptance(draft, op, op.actor !== target.id);
  return { ok: true, state: toState(draft), effects: deepFreeze(effects) };
}

// --- DELEGATE --------------------------------------------------------------------

function applyDelegate(
  state: KernelState,
  op: Extract<KernelOperation, { type: 'DELEGATE' }>,
): KernelApplyResult {
  const resolved = resolveTarget(state, op, op.target, 'delegate target');
  if (isTargetError(resolved)) return { ok: false, state, error: resolved };
  // Chain structure: non-empty, ends with the actor.
  const lastIndex = op.managerChain.length - 1;
  if (op.managerChain.length === 0 || op.managerChain[lastIndex] !== op.actor) {
    return fail(
      state,
      'invalid-delegation-chain',
      'managerChain must be non-empty and end with the delegating actor',
    );
  }
  // Circularity: no duplicate members, and the delegatee must not already be
  // in the chain (a task may not return to a prior delegator — including the
  // actor itself).
  const seen = new Set<AgentInstanceId>();
  for (const member of op.managerChain) {
    if (seen.has(member)) {
      return fail(
        state,
        'circular-delegation-chain',
        `managerChain contains ${member} more than once (circular delegation)`,
      );
    }
    seen.add(member);
  }
  if (seen.has(op.target)) {
    return fail(
      state,
      'circular-delegation-chain',
      `delegate target ${op.target} already appears in the managerChain (circular delegation)`,
    );
  }
  // Every chain member must be live in the op's tenant.
  const members: InstanceRecord[] = [];
  for (const member of op.managerChain) {
    const resolvedMember = resolveTarget(state, op, member, 'managerChain member');
    if (isTargetError(resolvedMember)) return { ok: false, state, error: resolvedMember };
    members.push(resolvedMember);
  }
  // Delegation depth: after this op the chain is [...members, target]; every
  // member must permit the hops that will then exist below it.
  const resultingLength = members.length + 1;
  for (let i = 0; i < members.length; i += 1) {
    const member = members[i] as InstanceRecord;
    const hopsBelow = resultingLength - 1 - i;
    if (member.authority.maxDelegationDepth < hopsBelow) {
      return fail(
        state,
        'delegation-depth-exceeded',
        `managerChain member ${member.id} allows delegation depth ${member.authority.maxDelegationDepth} but the resulting chain has ${hopsBelow} hops below it`,
      );
    }
  }

  const draft = toDraft(state);
  const sequence = nextSequence(state, op.tenantId, op.actor);
  const envelope = buildEnvelope({
    opId: op.opId,
    topic: TOPIC_DELEGATE,
    tenantId: op.tenantId,
    sender: op.actor,
    payload: asPayload(op.taskRef),
    sequence,
    publishedAt: op.timestamp,
  });
  enqueue(draft, op.tenantId, op.target, envelope);
  bumpSequence(draft, op.tenantId, op.actor);
  recordAcceptance(draft, op, true);
  const effects: KernelEffect[] = [delivered(op.tenantId, op.target, envelope, op.opId)];
  return { ok: true, state: toState(draft), effects: deepFreeze(effects) };
}

// --- REQUEST ----------------------------------------------------------------------

function applyDirectedMessage(
  state: KernelState,
  op: Extract<KernelOperation, { type: 'REQUEST' }>,
  topic: TopicName,
  payload: MessagePayload,
): KernelApplyResult {
  const resolved = resolveTarget(state, op, op.target, 'request target');
  if (isTargetError(resolved)) return { ok: false, state, error: resolved };

  const draft = toDraft(state);
  const sequence = nextSequence(state, op.tenantId, op.actor);
  const envelope = buildEnvelope({
    opId: op.opId,
    topic,
    tenantId: op.tenantId,
    sender: op.actor,
    payload,
    sequence,
    publishedAt: op.timestamp,
  });
  enqueue(draft, op.tenantId, op.target, envelope);
  bumpSequence(draft, op.tenantId, op.actor);
  recordAcceptance(draft, op, true);
  const effects: KernelEffect[] = [delivered(op.tenantId, op.target, envelope, op.opId)];
  return { ok: true, state: toState(draft), effects: deepFreeze(effects) };
}

// --- PUBLISH / SUBSCRIBE -------------------------------------------------------------

function applyPublish(
  state: KernelState,
  op: Extract<KernelOperation, { type: 'PUBLISH' }>,
): KernelApplyResult {
  if (isKernelTopic(op.topic)) {
    return fail(state, 'invalid-operation', `topic ${op.topic} is a reserved kernel topic`);
  }
  // Membership-to-post: the actor must be subscribed to the topic. This is
  // the kernel's minimal communication firewall (the trigger for the frozen
  // 'not-subscribed' taxonomy entry); richer communication topology is
  // adaptive policy owned by the organization compiler (T016).
  const subscribers = subscribersOf(state, op.tenantId, op.topic);
  if (!subscribers.includes(op.actor)) {
    return fail(
      state,
      'not-subscribed',
      `actor ${op.actor} is not subscribed to topic ${op.topic} (membership is required to publish)`,
    );
  }

  const draft = toDraft(state);
  const sequence = nextSequence(state, op.tenantId, op.actor);
  const envelope = buildEnvelope({
    opId: op.opId,
    topic: op.topic,
    tenantId: op.tenantId,
    sender: op.actor,
    payload: op.payload,
    sequence,
    publishedAt: op.timestamp,
  });
  const effects: KernelEffect[] = [];
  for (const subscriber of subscribers) {
    enqueue(draft, op.tenantId, subscriber, envelope);
    effects.push(delivered(op.tenantId, subscriber, envelope, op.opId));
  }
  bumpSequence(draft, op.tenantId, op.actor);
  recordAcceptance(draft, op, true);
  return { ok: true, state: toState(draft), effects: deepFreeze(effects) };
}

function applySubscribe(
  state: KernelState,
  op: Extract<KernelOperation, { type: 'SUBSCRIBE' }>,
): KernelApplyResult {
  if (isKernelTopic(op.topic)) {
    return fail(state, 'invalid-operation', `topic ${op.topic} is a reserved kernel topic`);
  }
  const draft = toDraft(state);
  const perTenant = draft.subscriptions[op.tenantId] ?? {};
  const subscribers = perTenant[op.topic] ?? [];
  // Idempotent: subscribing twice converges (no error, no duplicate entry).
  if (!subscribers.includes(op.actor)) {
    perTenant[op.topic] = [...subscribers, op.actor];
    draft.subscriptions[op.tenantId] = perTenant;
  }
  recordAcceptance(draft, op, true);
  return { ok: true, state: toState(draft), effects: deepFreeze([]) };
}

// --- CHALLENGE / PROPOSE / APPROVE -----------------------------------------------------

function applyProposalTransport(
  state: KernelState,
  op:
    | Extract<KernelOperation, { type: 'CHALLENGE' }>
    | Extract<KernelOperation, { type: 'PROPOSE' }>
    | Extract<KernelOperation, { type: 'APPROVE' }>,
  topic: TopicName,
): KernelApplyResult {
  const resolved = resolveTarget(state, op, op.target, 'proposal counterpart');
  if (isTargetError(resolved)) return { ok: false, state, error: resolved };

  const draft = toDraft(state);
  const sequence = nextSequence(state, op.tenantId, op.actor);
  // The payload composes the opaque proposal ref with the verdict so the
  // recipient can correlate without log access. The kernel CONSTRUCTS this
  // string but never interprets payloads.
  const payload = asPayload(`${op.proposalRef}::${op.verdict}`);
  const envelope = buildEnvelope({
    opId: op.opId,
    topic,
    tenantId: op.tenantId,
    sender: op.actor,
    payload,
    sequence,
    publishedAt: op.timestamp,
  });
  enqueue(draft, op.tenantId, op.target, envelope);
  bumpSequence(draft, op.tenantId, op.actor);
  recordAcceptance(draft, op, true);
  const effects: KernelEffect[] = [delivered(op.tenantId, op.target, envelope, op.opId)];
  return { ok: true, state: toState(draft), effects: deepFreeze(effects) };
}

// --- EXECUTE -----------------------------------------------------------------------------

function applyExecute(
  state: KernelState,
  op: Extract<KernelOperation, { type: 'EXECUTE' }>,
): KernelApplyResult {
  // L8/L20 — authority neutrality, in full: the kernel performs NO authority
  // evaluation for EXECUTE beyond the uniform declarative whitelist already
  // checked in applyOperation. The intent ref and the authority token ref
  // are transported VERBATIM to the execution gate, which alone decides.
  const draft = toDraft(state);
  recordAcceptance(draft, op, true);
  const effects: KernelEffect[] = [
    {
      kind: 'execution-transported',
      tenantId: op.tenantId,
      actor: op.actor,
      intentRef: op.intentRef,
      authorityTokenRef: op.authorityTokenRef,
      causalityId: op.opId,
    },
  ];
  return { ok: true, state: toState(draft), effects: deepFreeze(effects) };
}

// --- ESCALATE ------------------------------------------------------------------------------

function applyEscalate(
  state: KernelState,
  op: Extract<KernelOperation, { type: 'ESCALATE' }>,
): KernelApplyResult {
  // The claimed chain must match the live registry exactly.
  const expected = managerChainOf(state, op.tenantId, op.actor);
  if (expected === null) {
    return fail(state, 'unknown-instance', `actor ${op.actor} is not a live instance of tenant ${op.tenantId}`);
  }
  if (
    op.chain.length !== expected.length ||
    op.chain.some((id, index) => id !== expected[index])
  ) {
    return fail(
      state,
      'escalation-chain-mismatch',
      `escalation chain ${op.chain.join(' -> ')} does not match the live management chain ${expected.join(' -> ')}`,
    );
  }
  // Route to the nearest manager (the actor's direct manager — always live
  // under the kernel's invariants). Root escalations surface to the control
  // plane with to = null.
  const route = expected.length > 1 ? expected[1] : null;

  const draft = toDraft(state);
  const effects: KernelEffect[] = [
    {
      kind: 'escalated',
      tenantId: op.tenantId,
      from: op.actor,
      to: route,
      reason: op.reason,
      chain: op.chain,
      causalityId: op.opId,
    },
  ];
  if (route !== null) {
    const sequence = nextSequence(state, op.tenantId, op.actor);
    const envelope = buildEnvelope({
      opId: op.opId,
      topic: TOPIC_ESCALATE,
      tenantId: op.tenantId,
      sender: op.actor,
      payload: asPayload(op.reason),
      sequence,
      publishedAt: op.timestamp,
    });
    enqueue(draft, op.tenantId, route, envelope);
    bumpSequence(draft, op.tenantId, op.actor);
    effects.push(delivered(op.tenantId, route, envelope, op.opId));
  }
  recordAcceptance(draft, op, true);
  return { ok: true, state: toState(draft), effects: deepFreeze(effects) };
}

// --- OBSERVE / LEARN / REPORT -----------------------------------------------------------------

function applyObserve(
  state: KernelState,
  op: Extract<KernelOperation, { type: 'OBSERVE' }>,
): KernelApplyResult {
  const draft = toDraft(state);
  recordAcceptance(draft, op, true);
  const effects: KernelEffect[] = [
    {
      kind: 'observation-transported',
      tenantId: op.tenantId,
      actor: op.actor,
      queryRef: op.queryRef,
      causalityId: op.opId,
    },
  ];
  return { ok: true, state: toState(draft), effects: deepFreeze(effects) };
}

function applyLearn(
  state: KernelState,
  op: Extract<KernelOperation, { type: 'LEARN' }>,
): KernelApplyResult {
  const draft = toDraft(state);
  recordAcceptance(draft, op, true);
  const effects: KernelEffect[] = [
    {
      kind: 'learning-transported',
      tenantId: op.tenantId,
      actor: op.actor,
      lessonRef: op.lessonRef,
      causalityId: op.opId,
    },
  ];
  return { ok: true, state: toState(draft), effects: deepFreeze(effects) };
}

function applyReport(
  state: KernelState,
  op: Extract<KernelOperation, { type: 'REPORT' }>,
): KernelApplyResult {
  const resolved = resolveTarget(state, op, op.summary.subject, 'report subject');
  if (isTargetError(resolved)) return { ok: false, state, error: resolved };

  const draft = toDraft(state);
  recordAcceptance(draft, op, true);
  const effects: KernelEffect[] = [
    {
      kind: 'report-transported',
      tenantId: op.tenantId,
      actor: op.actor,
      summary: op.summary,
      causalityId: op.opId,
    },
  ];
  return { ok: true, state: toState(draft), effects: deepFreeze(effects) };
}

// ---------------------------------------------------------------------------
// Folding helpers
// ---------------------------------------------------------------------------

/** Result of folding a batch of operations with `applyOperations`. */
export interface KernelFoldResult {
  /** The final state (input state when the first op failed). */
  readonly state: KernelState;
  /** All effects produced before (and excluding) the first failure. */
  readonly effects: readonly KernelEffect[];
  /** The first rejection, or `null` when every op was accepted. */
  readonly error: KernelError | null;
}

/**
 * Folds `ops` over `state` in order, stopping at the first rejection.
 * Deterministic by construction: same state + same ops -> same result.
 */
export function applyOperations(
  state: KernelState,
  ops: readonly KernelOperation[],
): KernelFoldResult {
  let current = state;
  const effects: KernelEffect[] = [];
  for (const op of ops) {
    const result = applyOperation(current, op);
    if (result.ok) {
      current = result.state;
      effects.push(...result.effects);
    } else {
      return { state: current, effects: deepFreeze(effects), error: result.error };
    }
  }
  return { state: current, effects: deepFreeze(effects), error: null };
}

/**
 * Determinism proof helper: re-folds `state.operationLog` from the initial
 * state. The result must be deeply equal to `state` — the invariant the
 * runtime's replay check asserts.
 */
export function replayOperationLog(state: KernelState): KernelFoldResult {
  return applyOperations(createInitialKernelState(), state.operationLog);
}
