// @tradrl/agent-os — the fourteen kernel operations.
//
// Spec anchors: spec/ARCHITECTURE.md ("Agent OS: Stable kernel: SPAWN,
// TERMINATE, DELEGATE, REQUEST, PUBLISH, SUBSCRIBE, CHALLENGE, PROPOSE,
// APPROVE, EXECUTE, ESCALATE, OBSERVE, LEARN, REPORT."); spec/ARCHITECTURE
// -LOCK.md L2 (bodies/substrates referenced through opaque ids only), L8
// (EXECUTE is authority-neutral: it carries an opaque intent ref and an
// opaque authority token ref and NEVER evaluates them), L12 (every op is
// tenant-scoped), L9 (replayable operation logs — ops are pure value
// objects).
//
// Every operation carries the common quartet — op id, timestamp, actor
// (AgentInstanceId), tenant id — plus its addressing field(s) ("target(s)",
// interpreted per op: the instance acted upon, the topic addressed, or the
// opaque reference transported) and op-specific fields exactly as frozen in
// the T006 Work Order scope.
//
// Determinism law: operations carry their OWN timestamps. The kernel never
// reads a wall clock and never generates randomness; replaying the same log
// in the same order yields the same state.

import {
  type KernelActionName,
  type ProposalVerdict,
  type ReasonText,
  isKernelActionName,
  isProposalVerdict,
  isReasonText,
} from './actions';
import {
  type AgentInstanceId,
  type AuthorityTokenRef,
  type BodyVersionRef,
  type IntentRef,
  type KernelOpId,
  type LessonRef,
  type MessagePayload,
  type ProposalRef,
  type QueryRef,
  type SubstrateRef,
  type TaskRef,
  type TenantId,
  type TopicName,
  deepFreeze,
  isAgentInstanceId,
  isAuthorityTokenRef,
  isBodyVersionRef,
  isIntentRef,
  isKernelOpId,
  isLessonRef,
  isMessagePayload,
  isProposalRef,
  isQueryRef,
  isSubstrateRef,
  isTaskRef,
  isTenantId,
  isTopicName,
} from './primitives';
import { type KernelAuthority, isKernelAuthority } from './authority';
import { type TimestampMs, isTimestampMs } from './timestamp';

// ---------------------------------------------------------------------------
// Report summary (REPORT op-specific record)
// ---------------------------------------------------------------------------

/**
 * The summary record carried by REPORT. Deliberately minimal and
 * self-describing: who the report is about, a one-line headline, and an
 * opaque reference to the full report document owned by the reporting/
 * observability lane (T043). The kernel transports it verbatim.
 */
export interface ReportSummary {
  /** The instance the report is about (must be live in the op's tenant). */
  readonly subject: AgentInstanceId;
  /** One-line headline (non-empty, bounded). */
  readonly headline: string;
  /** Opaque reference to the full report document (reporting lane). */
  readonly detailRef: string;
}

const HEADLINE_MAX_LENGTH = 256;

/** Guard: `ReportSummary`. */
export function isReportSummary(v: unknown): v is ReportSummary {
  if (!isPlainRecord(v)) return false;
  return (
    isAgentInstanceId(v.subject) &&
    typeof v.headline === 'string' &&
    v.headline.trim().length > 0 &&
    v.headline.length <= HEADLINE_MAX_LENGTH &&
    !/[\u0000-\u001f]/.test(v.headline) &&
    typeof v.detailRef === 'string' &&
    v.detailRef.trim().length > 0 &&
    v.detailRef.length <= 1024 &&
    !/[\u0000-\u001f]/.test(v.detailRef)
  );
}

// ---------------------------------------------------------------------------
// The operation union
// ---------------------------------------------------------------------------

/** Fields common to all fourteen operations. */
export interface KernelOperationBase {
  /** Operation identity — globally unique across tenants. */
  readonly opId: KernelOpId;
  /** The kernel verb (discriminator). */
  readonly type: KernelActionName;
  /** When the op was issued (carried by the op — the kernel has no clock). */
  readonly timestamp: TimestampMs;
  /** The issuing instance (externally vouched only for tenant bootstrap). */
  readonly actor: AgentInstanceId;
  /** Tenant scope (L12). */
  readonly tenantId: TenantId;
}

/** SPAWN — bring a new instance live: body version ref, substrate ref, authority scope, parent. */
export interface SpawnOperation extends KernelOperationBase {
  readonly type: 'SPAWN';
  /** The new instance being spawned (must not already exist in the tenant). */
  readonly target: AgentInstanceId;
  /** Parent/manager of the new instance (`null` = root; required `null` on tenant bootstrap). */
  readonly managerId: AgentInstanceId | null;
  /** Opaque immutable body-version reference (T003 lane). */
  readonly bodyVersionRef: BodyVersionRef;
  /** Opaque substrate reference (T003 lane). */
  readonly substrateRef: SubstrateRef;
  /** Runtime-granted authority scope for the new instance. */
  readonly authority: KernelAuthority;
}

/** TERMINATE — remove an instance: reason. */
export interface TerminateOperation extends KernelOperationBase {
  readonly type: 'TERMINATE';
  /** The instance being terminated (may be the actor itself). */
  readonly target: AgentInstanceId;
  /** Why the instance is being terminated. */
  readonly reason: ReasonText;
}

/** DELEGATE — hand a task down the supervision structure: task ref + manager chain. */
export interface DelegateOperation extends KernelOperationBase {
  readonly type: 'DELEGATE';
  /** The delegatee receiving the task. */
  readonly target: AgentInstanceId;
  /** Opaque task reference (organization lane, T016). */
  readonly taskRef: TaskRef;
  /**
   * The accumulated delegation chain for this task, oldest delegator first,
   * ending with the ACTOR (the current delegator). The kernel rejects
   * duplicate entries (circular delegation chains), requires every member
   * to be live in the op's tenant, and enforces each member's
   * `maxDelegationDepth` over the resulting chain.
   */
  readonly managerChain: readonly AgentInstanceId[];
}

/** REQUEST — point-to-point message to one instance. */
export interface RequestOperation extends KernelOperationBase {
  readonly type: 'REQUEST';
  /** The recipient. */
  readonly target: AgentInstanceId;
  /** Opaque message payload. */
  readonly payload: MessagePayload;
}

/** PUBLISH — topic-addressed message to all subscribers (actor must be subscribed). */
export interface PublishOperation extends KernelOperationBase {
  readonly type: 'PUBLISH';
  /** The topic being published to (the op's target). */
  readonly topic: TopicName;
  /** Opaque message payload. */
  readonly payload: MessagePayload;
}

/** SUBSCRIBE — join a topic (idempotent). */
export interface SubscribeOperation extends KernelOperationBase {
  readonly type: 'SUBSCRIBE';
  /** The topic being joined (the op's target). */
  readonly topic: TopicName;
  /** Opaque subscription-interest payload (retained in the op log for consumers). */
  readonly payload: MessagePayload;
}

/** CHALLENGE — transport a challenge verdict for a proposal. */
export interface ChallengeOperation extends KernelOperationBase {
  readonly type: 'CHALLENGE';
  /** The counterpart receiving the challenge. */
  readonly target: AgentInstanceId;
  /** Opaque proposal reference. */
  readonly proposalRef: ProposalRef;
  /** Fixed verdict literal for CHALLENGE. */
  readonly verdict: 'challenged';
}

/** PROPOSE — introduce a proposal to a counterpart. */
export interface ProposeOperation extends KernelOperationBase {
  readonly type: 'PROPOSE';
  /** The counterpart receiving the proposal. */
  readonly target: AgentInstanceId;
  /** Opaque proposal reference. */
  readonly proposalRef: ProposalRef;
  /** Fixed verdict literal for PROPOSE. */
  readonly verdict: 'proposed';
}

/** APPROVE — transport an approval or rejection verdict for a proposal. */
export interface ApproveOperation extends KernelOperationBase {
  readonly type: 'APPROVE';
  /** The counterpart receiving the verdict. */
  readonly target: AgentInstanceId;
  /** Opaque proposal reference. */
  readonly proposalRef: ProposalRef;
  /** APPROVE carries `approved` or `rejected`. */
  readonly verdict: 'approved' | 'rejected';
}

/**
 * EXECUTE — transport an intent to the external execution gate.
 *
 * L8/L20 (authority neutrality): `authorityTokenRef` is OPAQUE. The kernel
 * carries it, verbatim, into the `execution-transported` effect and performs
 * exactly ONE authority check — the declarative whitelist ("is EXECUTE in
 * the actor's allowedActions?"). Authorization, limits and kill-switch
 * semantics are enforced OUTSIDE the kernel by the gate (T019/T020/T034).
 */
export interface ExecuteOperation extends KernelOperationBase {
  readonly type: 'EXECUTE';
  /** Opaque execution-intent reference (execution lane). */
  readonly intentRef: IntentRef;
  /** Opaque authority-token reference (authorization gate lane) — NEVER evaluated here. */
  readonly authorityTokenRef: AuthorityTokenRef;
}

/** ESCALATE — raise an issue up the management chain: reason + chain. */
export interface EscalateOperation extends KernelOperationBase {
  readonly type: 'ESCALATE';
  /** Why the escalation is raised. */
  readonly reason: ReasonText;
  /**
   * The actor's full management chain, `[actor, manager, …, root]`, as
   * claimed by the issuer. The kernel validates it against the live
   * registry (mismatch = rejection) and routes to the nearest manager.
   */
  readonly chain: readonly AgentInstanceId[];
}

/** OBSERVE — transport an observation query to the observation lanes. */
export interface ObserveOperation extends KernelOperationBase {
  readonly type: 'OBSERVE';
  /** Opaque query reference (observation lanes: T005/T008). */
  readonly queryRef: QueryRef;
}

/** LEARN — transport a lesson to the learning lanes. */
export interface LearnOperation extends KernelOperationBase {
  readonly type: 'LEARN';
  /** Opaque lesson reference (learning lanes: T002/T011). */
  readonly lessonRef: LessonRef;
}

/** REPORT — transport a summary record to the reporting lane. */
export interface ReportOperation extends KernelOperationBase {
  readonly type: 'REPORT';
  /** The summary record being reported. */
  readonly summary: ReportSummary;
}

/**
 * The kernel operation union — EXACTLY the fourteen frozen operations.
 * `type` is the discriminator. This union plus its guard
 * (`isKernelOperation`) is the machine-checkable schema of the kernel's
 * entire operation surface.
 */
export type KernelOperation =
  | SpawnOperation
  | TerminateOperation
  | DelegateOperation
  | RequestOperation
  | PublishOperation
  | SubscribeOperation
  | ChallengeOperation
  | ProposeOperation
  | ApproveOperation
  | ExecuteOperation
  | EscalateOperation
  | ObserveOperation
  | LearnOperation
  | ReportOperation;

// ---------------------------------------------------------------------------
// Guard plumbing
// ---------------------------------------------------------------------------

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function hasValidBase(v: Record<string, unknown>, type: string): boolean {
  return (
    isKernelOpId(v.opId) &&
    v.type === type &&
    isTimestampMs(v.timestamp) &&
    isAgentInstanceId(v.actor) &&
    isTenantId(v.tenantId)
  );
}

function isIdList(v: unknown): v is readonly AgentInstanceId[] {
  return (
    Array.isArray(v) &&
    v.every((item) => isAgentInstanceId(item))
  );
}

/** Guard: `SpawnOperation`. */
export function isSpawnOperation(v: unknown): v is SpawnOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'SPAWN')) return false;
  return (
    isAgentInstanceId(v.target) &&
    (v.managerId === null || isAgentInstanceId(v.managerId)) &&
    isBodyVersionRef(v.bodyVersionRef) &&
    isSubstrateRef(v.substrateRef) &&
    isKernelAuthority(v.authority)
  );
}

/** Guard: `TerminateOperation`. */
export function isTerminateOperation(v: unknown): v is TerminateOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'TERMINATE')) return false;
  return isAgentInstanceId(v.target) && isReasonText(v.reason);
}

/** Guard: `DelegateOperation`. */
export function isDelegateOperation(v: unknown): v is DelegateOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'DELEGATE')) return false;
  return isAgentInstanceId(v.target) && isTaskRef(v.taskRef) && isIdList(v.managerChain);
}

/** Guard: `RequestOperation`. */
export function isRequestOperation(v: unknown): v is RequestOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'REQUEST')) return false;
  return isAgentInstanceId(v.target) && isMessagePayload(v.payload);
}

/** Guard: `PublishOperation`. */
export function isPublishOperation(v: unknown): v is PublishOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'PUBLISH')) return false;
  return isTopicName(v.topic) && isMessagePayload(v.payload);
}

/** Guard: `SubscribeOperation`. */
export function isSubscribeOperation(v: unknown): v is SubscribeOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'SUBSCRIBE')) return false;
  return isTopicName(v.topic) && isMessagePayload(v.payload);
}

/** Guard: `ChallengeOperation`. */
export function isChallengeOperation(v: unknown): v is ChallengeOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'CHALLENGE')) return false;
  return (
    isAgentInstanceId(v.target) &&
    isProposalRef(v.proposalRef) &&
    v.verdict === 'challenged'
  );
}

/** Guard: `ProposeOperation`. */
export function isProposeOperation(v: unknown): v is ProposeOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'PROPOSE')) return false;
  return (
    isAgentInstanceId(v.target) &&
    isProposalRef(v.proposalRef) &&
    v.verdict === 'proposed'
  );
}

/** Guard: `ApproveOperation`. */
export function isApproveOperation(v: unknown): v is ApproveOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'APPROVE')) return false;
  return (
    isAgentInstanceId(v.target) &&
    isProposalRef(v.proposalRef) &&
    (v.verdict === 'approved' || v.verdict === 'rejected')
  );
}

/** Guard: `ExecuteOperation`. */
export function isExecuteOperation(v: unknown): v is ExecuteOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'EXECUTE')) return false;
  return isIntentRef(v.intentRef) && isAuthorityTokenRef(v.authorityTokenRef);
}

/** Guard: `EscalateOperation`. */
export function isEscalateOperation(v: unknown): v is EscalateOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'ESCALATE')) return false;
  return isReasonText(v.reason) && isIdList(v.chain);
}

/** Guard: `ObserveOperation`. */
export function isObserveOperation(v: unknown): v is ObserveOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'OBSERVE')) return false;
  return isQueryRef(v.queryRef);
}

/** Guard: `LearnOperation`. */
export function isLearnOperation(v: unknown): v is LearnOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'LEARN')) return false;
  return isLessonRef(v.lessonRef);
}

/** Guard: `ReportOperation`. */
export function isReportOperation(v: unknown): v is ReportOperation {
  if (!isPlainRecord(v)) return false;
  if (!hasValidBase(v, 'REPORT')) return false;
  return isReportSummary(v.summary);
}

/**
 * Total guard over the fourteen-operation union. Discriminates on `type`
 * and validates every member's fields; `false` for anything else — including
 * well-formed records with an unknown verb (the vocabulary is closed).
 */
export function isKernelOperation(v: unknown): v is KernelOperation {
  if (!isPlainRecord(v)) return false;
  if (!isKernelActionName(v.type)) return false;
  switch (v.type) {
    case 'SPAWN':
      return isSpawnOperation(v);
    case 'TERMINATE':
      return isTerminateOperation(v);
    case 'DELEGATE':
      return isDelegateOperation(v);
    case 'REQUEST':
      return isRequestOperation(v);
    case 'PUBLISH':
      return isPublishOperation(v);
    case 'SUBSCRIBE':
      return isSubscribeOperation(v);
    case 'CHALLENGE':
      return isChallengeOperation(v);
    case 'PROPOSE':
      return isProposeOperation(v);
    case 'APPROVE':
      return isApproveOperation(v);
    case 'EXECUTE':
      return isExecuteOperation(v);
    case 'ESCALATE':
      return isEscalateOperation(v);
    case 'OBSERVE':
      return isObserveOperation(v);
    case 'LEARN':
      return isLearnOperation(v);
    case 'REPORT':
      return isReportOperation(v);
    default:
      return false;
  }
}

/**
 * Constructs a deeply frozen `KernelOperation` — validity by construction,
 * mirroring agent-body's factory discipline. Accepts any member of the
 * union (TypeScript checks the discriminator at compile time; the guard
 * re-checks at runtime, e.g. for parsed JSON). Throws `TypeError`
 * (field-prefixed) on invalid input.
 */
export function createKernelOperation(op: KernelOperation): KernelOperation {
  const problems: string[] = [];
  if (!isPlainRecord(op)) {
    throw new TypeError('createKernelOperation: operation must be a plain record');
  }
  if (!isKernelOpId(op.opId)) problems.push('opId: invalid KernelOpId');
  if (!isKernelActionName(op.type)) problems.push('type: unknown kernel action');
  if (!isTimestampMs(op.timestamp)) problems.push('timestamp: invalid TimestampMs');
  if (!isAgentInstanceId(op.actor)) problems.push('actor: invalid AgentInstanceId');
  if (!isTenantId(op.tenantId)) problems.push('tenantId: invalid TenantId');
  if (!isKernelOperation(op)) {
    problems.push(`type-specific fields: invalid ${typeof op.type === 'string' ? op.type : 'unknown'} operation payload`);
  }
  if (problems.length > 0) {
    throw new TypeError(`createKernelOperation: ${problems.join('; ')}`);
  }
  return deepFreeze({ ...op });
}
