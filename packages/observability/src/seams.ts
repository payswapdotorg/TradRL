// @tradrl/observability — the structural mirrors of the four merged
// seams this layer OBSERVES (D-003/D-004: mirror, NEVER import).
//
// THE OBSERVED SEAMS (the Work Order): agent-os `MessageEnvelope` /
// `KernelOperation` (T006 — the agent plane), execution-authority
// `GatewayAuditRecord` (T040 — the execution plane's chain-verified
// audit trail), control-plane `ProjectAuditEntry` (T007 — the control
// plane's replayable journal) and event-store `StorableEvent` (the
// data plane). Every telemetry record carries an
// {@link ObservedSeamRef} pointing at the seam record it observes —
// by IDENTITY, never by copying payload (the complement law).
//
// THE MIRROR DISCIPLINE: each mirror re-declares the owner's shape
// law-for-law (field names, vocabularies, prefixes, patterns, ranges,
// coherence laws) so a REAL record minted by the REAL package is
// accepted VERBATIM by the mirror guard and is assignable to the
// mirror type with ZERO CASTS. src/interop.test.ts is the drift trip
// wire: if an owner package changes shape, the mirror guard rejects
// the real record and the test fails loudly.
//
// Brand note: the owners use two branding mechanics — string-keyed
// brands (`__brand`, shared program-wide tags: TenantId, ProjectId,
// GatewayAuditRecordId, TimestampMs) and agent-os's symbol-keyed
// brands. Mirror fields over string-keyed-brand spaces re-declare the
// SAME tag (mutually assignable); mirror fields over agent-os's
// symbol-keyed spaces use plain `string` (a branded string is always
// assignable to its underlying primitive) — the mirror is the WIDENED
// structural view.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L4 (the availability
// quartet), L8/L20 (the execution audit trail this layer observes,
// never alters), L12 (every seam record is tenant-scoped), L15 (the
// lineage blocks), spec/SECURITY.md Audit (the observed contents).

import {
  isNonEmptyString,
  isPositiveSafeInteger,
  isNonNegativeSafeInteger,
  isRecord,
  isTimestampMs,
  type TimestampMs,
} from './primitives';
import { credentialValueViolations } from './credentials';
import type { GatewayAuditRecordId, ProjectId, TenantId } from './ids';
import { isGatewayAuditRecordId, isProjectId, isTenantId } from './ids';

// ---------------------------------------------------------------------------
// The agent plane (T006 @tradrl/agent-os) — MessageEnvelope
// ---------------------------------------------------------------------------

/**
 * The agent-os identifier grammar (mirror of T006's `ID_PATTERN`):
 * 1..256 chars, starts alphanumeric, then alphanumerics/`.`/`_`/`:`/`-`.
 */
const AGENT_OS_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

/**
 * The agent-os opaque-ref grammar (mirror of T006's
 * `OPAQUE_REF_PATTERN`): 1..1024 chars, trimmed, no control characters.
 */
const AGENT_OS_OPAQUE_REF_PATTERN = /^[^\s](.{0,1022}[^\s])?$/u;

/** Mirror guard: an agent-os identifier (MessageId/TopicName/TenantId/AgentInstanceId/KernelOpId). */
function isAgentOsIdentifier(v: unknown): v is string {
  return typeof v === 'string' && AGENT_OS_ID_PATTERN.test(v);
}

/** Mirror guard: an agent-os opaque reference (payloads and cross-lane refs). */
function isAgentOsOpaqueRef(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 1024 && AGENT_OS_OPAQUE_REF_PATTERN.test(v) && !/[\u0000-\u001f]/.test(v);
}

/**
 * The agent-os message envelope — the TRANSPORT record the
 * observability layer observes on the kernel's topic fabric (mirror of
 * T006's `MessageEnvelope`; payload stays OPAQUE here exactly as it is
 * opaque to the kernel).
 */
export interface MessageEnvelopeMirror {
  /** Message identity (globally unique; derived from the producing op). */
  readonly id: string;
  /** Topic address (kernel topics for directed mail; organization topics for PUBLISH). */
  readonly topic: string;
  /** Tenant scope (L12). */
  readonly tenantId: string;
  /** Sending instance. */
  readonly sender: string;
  /** Opaque payload — never interpreted here either. */
  readonly payload: string;
  /** Per-sender sequence (strictly increasing per sender, 1-based). */
  readonly sequence: number;
  /** The kernel operation that produced this message (null only for forensic copies). */
  readonly causalityId: string | null;
  /** When the producing operation was accepted (op timestamp, not a wall clock). */
  readonly publishedAt: TimestampMs;
}

/** Mirror guard: `MessageEnvelopeMirror` (T006's `isMessageEnvelope`, law for law). */
export function isMessageEnvelopeMirror(v: unknown): v is MessageEnvelopeMirror {
  if (!isRecord(v)) return false;
  return (
    isAgentOsIdentifier(v.id) &&
    isAgentOsIdentifier(v.topic) &&
    isAgentOsIdentifier(v.tenantId) &&
    isAgentOsIdentifier(v.sender) &&
    isAgentOsOpaqueRef(v.payload) &&
    typeof v.sequence === 'number' &&
    Number.isInteger(v.sequence) &&
    v.sequence >= 1 &&
    (v.causalityId === null || isAgentOsIdentifier(v.causalityId)) &&
    isTimestampMs(v.publishedAt)
  );
}

// ---------------------------------------------------------------------------
// The agent plane (T006 @tradrl/agent-os) — KernelOperation
// ---------------------------------------------------------------------------

/** The fourteen kernel verbs (mirror of T006's `KERNEL_ACTION_NAMES` — EXACTLY the frozen vocabulary). */
export const KERNEL_ACTION_NAMES_MIRROR: readonly string[] = [
  'SPAWN',
  'TERMINATE',
  'DELEGATE',
  'REQUEST',
  'PUBLISH',
  'SUBSCRIBE',
  'CHALLENGE',
  'PROPOSE',
  'APPROVE',
  'EXECUTE',
  'ESCALATE',
  'OBSERVE',
  'LEARN',
  'REPORT',
] as const;

/** A kernel verb (mirror of T006's `KernelActionName`). */
export type KernelActionNameMirror = (typeof KERNEL_ACTION_NAMES_MIRROR)[number];

/** Mirror guard: a kernel verb. */
export function isKernelActionNameMirror(v: unknown): v is KernelActionNameMirror {
  return typeof v === 'string' && KERNEL_ACTION_NAMES_MIRROR.includes(v);
}

/** The kernel authority block (mirror of T006's `KernelAuthority`). */
export interface KernelAuthorityMirror {
  readonly allowedActions: readonly KernelActionNameMirror[];
  readonly deniedActions: readonly KernelActionNameMirror[];
  readonly maxDelegationDepth: number;
}

/** Mirror guard: `KernelAuthorityMirror` (T006's `isKernelAuthority`, law for law). */
export function isKernelAuthorityMirror(v: unknown): v is KernelAuthorityMirror {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.allowedActions) || !v.allowedActions.every(isKernelActionNameMirror)) return false;
  if (!Array.isArray(v.deniedActions) || !v.deniedActions.every(isKernelActionNameMirror)) return false;
  return typeof v.maxDelegationDepth === 'number' && Number.isInteger(v.maxDelegationDepth) && v.maxDelegationDepth >= 0;
}

/** The REPORT summary block (mirror of T006's `ReportSummary` — the reporting lane's transport record). */
export interface ReportSummaryMirror {
  readonly subject: string;
  readonly headline: string;
  readonly detailRef: string;
}

/** Mirror guard: `ReportSummaryMirror` (T006's `isReportSummary`, law for law: bounded, trimmed, control-free). */
export function isReportSummaryMirror(v: unknown): v is ReportSummaryMirror {
  if (!isRecord(v)) return false;
  return (
    isAgentOsIdentifier(v.subject) &&
    typeof v.headline === 'string' &&
    v.headline.trim().length > 0 &&
    v.headline.length <= 256 &&
    !/[\u0000-\u001f]/.test(v.headline) &&
    typeof v.detailRef === 'string' &&
    v.detailRef.trim().length > 0 &&
    v.detailRef.length <= 1024 &&
    !/[\u0000-\u001f]/.test(v.detailRef)
  );
}

/** Mirror guard: a TERMINATE/ESCALATE reason (T006's `isReasonText`, law for law). */
function isReasonTextMirror(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.trim().length > 0 &&
    v.length <= 512 &&
    !/[\u0000-\u001f]/.test(v)
  );
}

/** The common quartet of every kernel operation (mirror of T006's `KernelOperationBase`). */
export interface KernelOperationBaseMirror {
  readonly opId: string;
  readonly type: KernelActionNameMirror;
  readonly timestamp: TimestampMs;
  readonly actor: string;
  readonly tenantId: string;
}

/** Mirror of T006's `SpawnOperation`. */
export interface SpawnOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'SPAWN';
  readonly target: string;
  readonly managerId: string | null;
  readonly bodyVersionRef: string;
  readonly substrateRef: string;
  readonly authority: KernelAuthorityMirror;
}

/** Mirror of T006's `TerminateOperation`. */
export interface TerminateOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'TERMINATE';
  readonly target: string;
  readonly reason: string;
}

/** Mirror of T006's `DelegateOperation`. */
export interface DelegateOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'DELEGATE';
  readonly target: string;
  readonly taskRef: string;
  readonly managerChain: readonly string[];
}

/** Mirror of T006's `RequestOperation`. */
export interface RequestOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'REQUEST';
  readonly target: string;
  readonly payload: string;
}

/** Mirror of T006's `PublishOperation`. */
export interface PublishOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'PUBLISH';
  readonly topic: string;
  readonly payload: string;
}

/** Mirror of T006's `SubscribeOperation`. */
export interface SubscribeOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'SUBSCRIBE';
  readonly topic: string;
  readonly payload: string;
}

/** Mirror of T006's `ChallengeOperation`. */
export interface ChallengeOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'CHALLENGE';
  readonly target: string;
  readonly proposalRef: string;
  readonly verdict: 'challenged';
}

/** Mirror of T006's `ProposeOperation`. */
export interface ProposeOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'PROPOSE';
  readonly target: string;
  readonly proposalRef: string;
  readonly verdict: 'proposed';
}

/** Mirror of T006's `ApproveOperation`. */
export interface ApproveOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'APPROVE';
  readonly target: string;
  readonly proposalRef: string;
  readonly verdict: 'approved' | 'rejected';
}

/** Mirror of T006's `ExecuteOperation` (the intent/authority-token transport — L8 authority-neutral here too). */
export interface ExecuteOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'EXECUTE';
  readonly intentRef: string;
  readonly authorityTokenRef: string;
}

/** Mirror of T006's `EscalateOperation`. */
export interface EscalateOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'ESCALATE';
  readonly reason: string;
  readonly chain: readonly string[];
}

/** Mirror of T006's `ObserveOperation`. */
export interface ObserveOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'OBSERVE';
  readonly queryRef: string;
}

/** Mirror of T006's `LearnOperation`. */
export interface LearnOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'LEARN';
  readonly lessonRef: string;
}

/** Mirror of T006's `ReportOperation`. */
export interface ReportOperationMirror extends KernelOperationBaseMirror {
  readonly type: 'REPORT';
  readonly summary: ReportSummaryMirror;
}

/**
 * The kernel operation union — mirror of T006's `KernelOperation`
 * (EXACTLY the fourteen frozen operations; `type` is the
 * discriminator).
 */
export type KernelOperationMirror =
  | SpawnOperationMirror
  | TerminateOperationMirror
  | DelegateOperationMirror
  | RequestOperationMirror
  | PublishOperationMirror
  | SubscribeOperationMirror
  | ChallengeOperationMirror
  | ProposeOperationMirror
  | ApproveOperationMirror
  | ExecuteOperationMirror
  | EscalateOperationMirror
  | ObserveOperationMirror
  | LearnOperationMirror
  | ReportOperationMirror;

function hasValidOpBaseMirror(v: Record<string, unknown>, type: string): boolean {
  return (
    isAgentOsIdentifier(v.opId) &&
    v.type === type &&
    isTimestampMs(v.timestamp) &&
    isAgentOsIdentifier(v.actor) &&
    isAgentOsIdentifier(v.tenantId)
  );
}

function isIdListMirror(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((item) => isAgentOsIdentifier(item));
}

/** Mirror guard: the kernel operation union (T006's `isKernelOperation`, law for law). */
export function isKernelOperationMirror(v: unknown): v is KernelOperationMirror {
  if (!isRecord(v)) return false;
  if (!isKernelActionNameMirror(v.type)) return false;
  switch (v.type) {
    case 'SPAWN':
      return (
        hasValidOpBaseMirror(v, 'SPAWN') &&
        isAgentOsIdentifier(v.target) &&
        (v.managerId === null || isAgentOsIdentifier(v.managerId)) &&
        isAgentOsOpaqueRef(v.bodyVersionRef) &&
        isAgentOsOpaqueRef(v.substrateRef) &&
        isKernelAuthorityMirror(v.authority)
      );
    case 'TERMINATE':
      return hasValidOpBaseMirror(v, 'TERMINATE') && isAgentOsIdentifier(v.target) && isReasonTextMirror(v.reason);
    case 'DELEGATE':
      return (
        hasValidOpBaseMirror(v, 'DELEGATE') &&
        isAgentOsIdentifier(v.target) &&
        isAgentOsOpaqueRef(v.taskRef) &&
        isIdListMirror(v.managerChain)
      );
    case 'REQUEST':
      return hasValidOpBaseMirror(v, 'REQUEST') && isAgentOsIdentifier(v.target) && isAgentOsOpaqueRef(v.payload);
    case 'PUBLISH':
      return hasValidOpBaseMirror(v, 'PUBLISH') && isAgentOsIdentifier(v.topic) && isAgentOsOpaqueRef(v.payload);
    case 'SUBSCRIBE':
      return hasValidOpBaseMirror(v, 'SUBSCRIBE') && isAgentOsIdentifier(v.topic) && isAgentOsOpaqueRef(v.payload);
    case 'CHALLENGE':
      return (
        hasValidOpBaseMirror(v, 'CHALLENGE') &&
        isAgentOsIdentifier(v.target) &&
        isAgentOsOpaqueRef(v.proposalRef) &&
        v.verdict === 'challenged'
      );
    case 'PROPOSE':
      return (
        hasValidOpBaseMirror(v, 'PROPOSE') &&
        isAgentOsIdentifier(v.target) &&
        isAgentOsOpaqueRef(v.proposalRef) &&
        v.verdict === 'proposed'
      );
    case 'APPROVE':
      return (
        hasValidOpBaseMirror(v, 'APPROVE') &&
        isAgentOsIdentifier(v.target) &&
        isAgentOsOpaqueRef(v.proposalRef) &&
        (v.verdict === 'approved' || v.verdict === 'rejected')
      );
    case 'EXECUTE':
      return (
        hasValidOpBaseMirror(v, 'EXECUTE') &&
        isAgentOsOpaqueRef(v.intentRef) &&
        isAgentOsOpaqueRef(v.authorityTokenRef)
      );
    case 'ESCALATE':
      return hasValidOpBaseMirror(v, 'ESCALATE') && isReasonTextMirror(v.reason) && isIdListMirror(v.chain);
    case 'OBSERVE':
      return hasValidOpBaseMirror(v, 'OBSERVE') && isAgentOsOpaqueRef(v.queryRef);
    case 'LEARN':
      return hasValidOpBaseMirror(v, 'LEARN') && isAgentOsOpaqueRef(v.lessonRef);
    case 'REPORT':
      return hasValidOpBaseMirror(v, 'REPORT') && isReportSummaryMirror(v.summary);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// The execution plane (T040 @tradrl/execution-authority) — GatewayAuditRecord
// ---------------------------------------------------------------------------

/** Mirror of T040's `AuditWhoWhat` (the WHO/WHAT block of the gateway audit sentence). */
export interface AuditWhoWhatMirror {
  readonly bodyVersion: { readonly specId: string; readonly version: number };
  readonly intentRef: string;
  readonly decisionId: string | null;
  readonly decisionKind: 'approve' | 'refuse' | null;
  readonly clientOrderId: string;
}

/** Mirror guard: `AuditWhoWhatMirror` (T040's `isAuditWhoWhat`, law for law). */
export function isAuditWhoWhatMirror(v: unknown): v is AuditWhoWhatMirror {
  if (!isRecord(v)) return false;
  const bodyVersion = v.bodyVersion;
  if (!isRecord(bodyVersion) || !isNonEmptyString(bodyVersion.specId) || !isPositiveSafeInteger(bodyVersion.version)) return false;
  if (!isNonEmptyString(v.intentRef)) return false;
  if (v.decisionId !== null && !isNonEmptyString(v.decisionId)) return false;
  if (v.decisionKind !== null && v.decisionKind !== 'approve' && v.decisionKind !== 'refuse') return false;
  if (!isNonEmptyString(v.clientOrderId)) return false;
  return true;
}

/** Mirror of T040's `AuditVisibleState` (the visible market/data state the gate reasoned over). */
export interface AuditVisibleStateMirror {
  readonly venue: string;
  readonly instrument: string;
  readonly instrumentClass: string;
  readonly referencePrice: string;
  readonly rateWindowOrderCount: number;
  readonly riskExposureRef: string | null;
}

/** Mirror guard: `AuditVisibleStateMirror` (T040's `isAuditVisibleState`, law for law). */
export function isAuditVisibleStateMirror(v: unknown): v is AuditVisibleStateMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.venue)) return false;
  if (!isNonEmptyString(v.instrument)) return false;
  if (!isNonEmptyString(v.instrumentClass)) return false;
  if (!isNonEmptyString(v.referencePrice)) return false;
  if (typeof v.rateWindowOrderCount !== 'number' || !Number.isSafeInteger(v.rateWindowOrderCount) || v.rateWindowOrderCount < 0) return false;
  if (v.riskExposureRef !== null && !isNonEmptyString(v.riskExposureRef)) return false;
  return true;
}

/** Mirror of T040's `AuditRiskChecks` (the T020 evaluation summary). */
export interface AuditRiskChecksMirror {
  readonly evaluationId: string | null;
  readonly riskPolicy: { readonly policyId: string; readonly version: number };
  readonly within: number;
  readonly breaching: number;
  readonly blocked: number;
}

/** Mirror guard: `AuditRiskChecksMirror` (T040's `isAuditRiskChecks`, law for law). */
export function isAuditRiskChecksMirror(v: unknown): v is AuditRiskChecksMirror {
  if (!isRecord(v)) return false;
  if (v.evaluationId !== null && !isNonEmptyString(v.evaluationId)) return false;
  const riskPolicy = v.riskPolicy;
  if (!isRecord(riskPolicy) || !isNonEmptyString(riskPolicy.policyId) || !isPositiveSafeInteger(riskPolicy.version)) return false;
  for (const count of [v.within, v.breaching, v.blocked]) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return false;
  }
  return true;
}

/** Mirror of T040's `AuditOrderBlock` (the translated order's routing identity). */
export interface AuditOrderBlockMirror {
  /** Opaque 'adapter:' + id + '@' + version ref (T039 descriptor identity). */
  readonly adapterRef: string;
  /** Opaque 'chan:'-prefixed channel ref. */
  readonly channelRef: string;
  /** Opaque 'cred:'-prefixed credential ref (NEVER a value — the opacity law). */
  readonly credentialRef: string;
  readonly clientOrderId: string;
  /** The gateway order request's identity ('gor:'-prefixed). */
  readonly requestRef: string;
}

/** Mirror guard: `AuditOrderBlockMirror` (T040's `isAuditOrderBlock`, law for law). */
export function isAuditOrderBlockMirror(v: unknown): v is AuditOrderBlockMirror {
  if (!isRecord(v)) return false;
  if (typeof v.adapterRef !== 'string' || !v.adapterRef.startsWith('adapter:') || v.adapterRef.split('@').length !== 2 || !isNonEmptyString(v.adapterRef.split('@')[0]) || !isNonEmptyString(v.adapterRef.split('@')[1])) return false;
  if (typeof v.channelRef !== 'string' || !v.channelRef.startsWith('chan:')) return false;
  if (typeof v.credentialRef !== 'string' || !v.credentialRef.startsWith('cred:')) return false;
  if (!isNonEmptyString(v.clientOrderId)) return false;
  if (typeof v.requestRef !== 'string' || !v.requestRef.startsWith('gor:')) return false;
  return true;
}

/** Mirror of T040's `AuditExecutionBlock` (the submission's operational outcome facts). */
export interface AuditExecutionBlockMirror {
  readonly routed: boolean;
  readonly submissionAt: TimestampMs;
  readonly messageDigest: string | null;
}

/** Mirror guard: `AuditExecutionBlockMirror` (T040's `isAuditExecutionBlock`, law for law). */
export function isAuditExecutionBlockMirror(v: unknown): v is AuditExecutionBlockMirror {
  if (!isRecord(v)) return false;
  if (typeof v.routed !== 'boolean') return false;
  if (!isTimestampMs(v.submissionAt)) return false;
  if (v.messageDigest !== null && (typeof v.messageDigest !== 'string' || !/^[0-9a-f]{8}$/.test(v.messageDigest))) return false;
  return true;
}

/** Mirror of T040's `AuditRefusalSummary` (the structured refusal fact). */
export interface AuditRefusalSummaryMirror {
  readonly stage: string;
  readonly code: string;
  readonly detail: unknown;
}

/** Mirror guard: `AuditRefusalSummaryMirror` (T040's `isAuditRefusalSummary`, law for law). */
export function isAuditRefusalSummaryMirror(v: unknown): v is AuditRefusalSummaryMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.stage)) return false;
  if (!isNonEmptyString(v.code)) return false;
  if (v.detail !== null && typeof v.detail !== 'object' && typeof v.detail !== 'string' && typeof v.detail !== 'number' && typeof v.detail !== 'boolean') return false;
  return true;
}

/** Mirror of T040's `ExecutionLineageRecord` (the L9 execution lineage block). */
export interface ExecutionLineageRecordMirror {
  readonly intentRef: string;
  readonly strategy: { readonly specId: string; readonly version: number };
  readonly goal: { readonly goalId: string; readonly version: number };
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly venues: readonly string[];
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

/** Mirror guard: `ExecutionLineageRecordMirror` (T040's `isExecutionLineageRecord`, law for law). */
export function isExecutionLineageRecordMirror(value: unknown): value is ExecutionLineageRecordMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.intentRef)) return false;
  const strategy = value.strategy;
  if (!isRecord(strategy) || !isNonEmptyString(strategy.specId) || !isPositiveSafeInteger(strategy.version)) return false;
  const goal = value.goal;
  if (!isRecord(goal) || !isNonEmptyString(goal.goalId) || !isPositiveSafeInteger(goal.version)) return false;
  const policy = value.policy;
  if (!isRecord(policy) || !isNonEmptyString(policy.policyId) || !isPositiveSafeInteger(policy.version)) return false;
  if (!Array.isArray(value.venues) || value.venues.length === 0 || !value.venues.every(isNonEmptyString)) return false;
  if (!isNonEmptyString(value.seed)) return false;
  if (!isNonEmptyString(value.tenant)) return false;
  if (!isNonEmptyString(value.project)) return false;
  return true;
}

/**
 * The gateway audit record — mirror of T040's `GatewayAuditRecord`
 * (SECURITY.md's audit sentence as typed data: who/what, BodyVersion,
 * substrate, policy, visible state, risk checks, order, execution and
 * outcome, plus the L9 lineage block and the chain head). The
 * observability layer observes these records BY IDENTITY; the platform
 * audit chain references them through the opaque
 * `{ kind, auditId, tenant, project }` ref — never by copying this
 * payload.
 */
export interface GatewayAuditRecordMirror {
  /** Content-addressed identity: `xga:` + digest of the record's canonical content. */
  readonly auditId: GatewayAuditRecordId;
  /** 1-based position in the trail (contiguous — append-only). */
  readonly sequence: number;
  readonly who: AuditWhoWhatMirror;
  readonly substrate: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly visibleState: AuditVisibleStateMirror;
  readonly riskChecks: AuditRiskChecksMirror;
  readonly order: AuditOrderBlockMirror | null;
  readonly execution: AuditExecutionBlockMirror | null;
  readonly outcome: 'routed' | 'refused';
  readonly refusal: AuditRefusalSummaryMirror | null;
  readonly lineage: ExecutionLineageRecordMirror;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly asOf: TimestampMs;
  readonly chainHead: string;
}

/** Mirror guard: `GatewayAuditRecordMirror` (T040's `isGatewayAuditRecord`, law for law — opacity trip wire and outcome-coherence laws included). */
export function isGatewayAuditRecordMirror(value: unknown): value is GatewayAuditRecordMirror {
  if (!isRecord(value)) return false;
  if (!isGatewayAuditRecordId(value.auditId)) return false;
  if (!isPositiveSafeInteger(value.sequence)) return false;
  if (!isAuditWhoWhatMirror(value.who)) return false;
  if (!isNonEmptyString(value.substrate)) return false;
  const policy = value.policy;
  if (!isRecord(policy) || !isNonEmptyString(policy.policyId) || !isPositiveSafeInteger(policy.version)) return false;
  if (!isAuditVisibleStateMirror(value.visibleState)) return false;
  if (!isAuditRiskChecksMirror(value.riskChecks)) return false;
  if (value.order !== null && !isAuditOrderBlockMirror(value.order)) return false;
  if (value.execution !== null && !isAuditExecutionBlockMirror(value.execution)) return false;
  if (value.outcome !== 'routed' && value.outcome !== 'refused') return false;
  if (value.outcome === 'refused') {
    if (!isAuditRefusalSummaryMirror(value.refusal)) return false;
  } else if (value.refusal !== null) return false;
  if (!isExecutionLineageRecordMirror(value.lineage)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!isTimestampMs(value.asOf)) return false;
  if (typeof value.chainHead !== 'string' || !/^[0-9a-f]{8}$/.test(value.chainHead)) return false;
  // The opacity trip wire (the T040 guard's own half — same law here).
  if (credentialValueViolations(value).length > 0) return false;
  // The outcome-coherence laws (T040's, verbatim).
  if (value.outcome === 'routed' && (value.order === null || value.execution === null)) return false;
  if (value.outcome === 'refused' && value.execution !== null && value.execution.routed) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The control plane (T007 services/control-plane) — ProjectAuditEntry
// ---------------------------------------------------------------------------

/** The control-plane audit operation vocabulary (mirror of T007's `PROJECT_AUDIT_OPERATION_KINDS`). */
export const PROJECT_AUDIT_OPERATION_KINDS_MIRROR: readonly string[] = [
  'acceptance.compiled',
  'project.created',
  'organization.bound',
  'project.transitioned',
] as const;

/** A control-plane audit operation kind (mirror of T007's `ProjectAuditOperationKind`). */
export type ProjectAuditOperationKindMirror = (typeof PROJECT_AUDIT_OPERATION_KINDS_MIRROR)[number];

/** Mirror guard: a control-plane audit operation kind. */
export function isProjectAuditOperationKindMirror(v: unknown): v is ProjectAuditOperationKindMirror {
  return typeof v === 'string' && PROJECT_AUDIT_OPERATION_KINDS_MIRROR.includes(v);
}

/**
 * The control-plane audit operation — mirror of T007's
 * `ProjectAuditOperation` with OPAQUE payloads (the goal/constraint
 * statements, the project draft, the organization ref and the
 * lifecycle event are the control plane's own contracts; this layer
 * observes the JOURNAL ENTRY, not the domain payloads).
 */
export type ProjectAuditOperationMirror =
  | {
      readonly kind: 'acceptance.compiled';
      readonly goal: unknown;
      readonly constraintSet: unknown;
    }
  | {
      readonly kind: 'project.created';
      readonly draft: unknown;
    }
  | {
      readonly kind: 'organization.bound';
      readonly organizationRef: string;
    }
  | {
      readonly kind: 'project.transitioned';
      readonly event: string;
    };

/** Mirror of T007's `ProjectLineage` (the L15 lineage block of the control plane). */
export interface ProjectLineageMirror {
  readonly projectId: ProjectId;
  readonly goal: { readonly goalId: string; readonly version: number };
  readonly constraintSet: { readonly id: string; readonly version: number };
}

/** Mirror guard: `ProjectLineageMirror` (T007's `isProjectLineage`, law for law). */
export function isProjectLineageMirror(v: unknown): v is ProjectLineageMirror {
  if (!isRecord(v)) return false;
  if (!isProjectId(v.projectId)) return false;
  const goal = v.goal;
  if (!isRecord(goal) || !isNonEmptyString(goal.goalId) || !isPositiveSafeInteger(goal.version)) return false;
  const constraintSet = v.constraintSet;
  if (!isRecord(constraintSet) || !isNonEmptyString(constraintSet.id) || !isPositiveSafeInteger(constraintSet.version)) return false;
  return true;
}

/**
 * One control-plane journal entry — mirror of T007's
 * `ProjectAuditEntry` (the append-only, replayable operation journal;
 * the state-replay artifact whose ACCESS counterpart this lane owns).
 */
export interface ProjectAuditEntryMirror {
  readonly sequence: number;
  readonly at: TimestampMs;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly lineage: ProjectLineageMirror;
  readonly operation: ProjectAuditOperationMirror;
}

/** Mirror guard: the control-plane operation (T007's `isProjectAuditOperation`, law for law). */
function isProjectAuditOperationMirror(v: unknown): v is ProjectAuditOperationMirror {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'acceptance.compiled':
      return typeof v.goal === 'object' && v.goal !== null && !Array.isArray(v.goal)
        && typeof v.constraintSet === 'object' && v.constraintSet !== null && !Array.isArray(v.constraintSet);
    case 'project.created':
      return typeof v.draft === 'object' && v.draft !== null && !Array.isArray(v.draft);
    case 'organization.bound':
      return typeof v.organizationRef === 'string' && v.organizationRef.trim().length > 0;
    case 'project.transitioned':
      return typeof v.event === 'string' && v.event.trim().length > 0;
    default:
      return false;
  }
}

/** Mirror guard: `ProjectAuditEntryMirror` (T007's `isProjectAuditEntry`, law for law — lineage identity consistency included). */
export function isProjectAuditEntryMirror(v: unknown): v is ProjectAuditEntryMirror {
  if (!isRecord(v)) return false;
  if (typeof v.sequence !== 'number' || !Number.isInteger(v.sequence) || v.sequence < 1) return false;
  if (!isTimestampMs(v.at)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (!isProjectLineageMirror(v.lineage)) return false;
  if ((v.lineage as ProjectLineageMirror).projectId !== v.projectId) return false;
  if (!isProjectAuditOperationMirror(v.operation)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The data plane (services/event-store) — StorableEvent
// ---------------------------------------------------------------------------

/** The canonical event-type taxonomy (mirror of the event store's `EVENT_TYPES`, itself the market-protocol mirror). */
export const EVENT_TYPES_MIRROR: readonly string[] = [
  'trade',
  'quote',
  'book_snapshot',
  'book_delta',
  'ohlcv',
  'news',
  'macro_release',
  'social_signal',
  'fundamental',
  'option_chain_mark',
  'other',
] as const;

/** A canonical event type (mirror of the store's `EventType`). */
export type EventTypeMirror = (typeof EVENT_TYPES_MIRROR)[number];

/** Mirror guard: a canonical event type. */
export function isEventTypeMirror(v: unknown): v is EventTypeMirror {
  return typeof v === 'string' && EVENT_TYPES_MIRROR.includes(v);
}

/** The canonical asset classes (mirror of the store's `ASSET_CLASSES`). */
export const ASSET_CLASSES_MIRROR: readonly string[] = [
  'crypto',
  'equity',
  'index',
  'future',
  'option',
  'forex',
  'commodity',
  'macro',
  'other',
] as const;

/** A canonical asset class (mirror of the store's `AssetClass`). */
export type AssetClassMirror = (typeof ASSET_CLASSES_MIRROR)[number];

/** Mirror guard: a canonical asset class. */
export function isAssetClassMirror(v: unknown): v is AssetClassMirror {
  return typeof v === 'string' && ASSET_CLASSES_MIRROR.includes(v);
}

/** The event origin trichotomy (mirror of the store's `EventOrigin`). */
export type EventOriginMirror = 'historical' | 'simulated' | 'generated';

/** The input provenance block (mirror of the store's `StorableProvenance`). */
export interface StorableProvenanceMirror {
  readonly origin: EventOriginMirror;
  readonly adapter: { readonly id: string; readonly version: string } | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
}

/** Mirror guard: the provenance block (the store's `isStorableProvenance` laws + the self-reference rule, in event context). */
function isStorableProvenanceMirror(v: unknown, eventId: string): v is StorableProvenanceMirror {
  if (!isRecord(v)) return false;
  if (v.origin !== 'historical' && v.origin !== 'simulated' && v.origin !== 'generated') return false;
  if (v.adapter !== null) {
    const adapter = v.adapter;
    if (!isRecord(adapter) || !isNonEmptyString(adapter.id) || !isNonEmptyString(adapter.version)) return false;
  }
  if (!Array.isArray(v.derived_from)) return false;
  if (!v.derived_from.every((parent) => isNonEmptyString(parent))) return false;
  if (typeof v.transform !== 'string' || v.transform.length === 0) {
    if (v.transform !== null) return false;
  }
  if (v.origin === 'historical' && v.adapter === null) return false;
  const derived = v.derived_from.length > 0;
  if (derived && (typeof v.transform !== 'string' || v.transform.length === 0)) return false;
  if (!derived && v.transform !== null) return false;
  // The self-reference and duplicate-parent rules (the store's commit-time laws).
  if (v.derived_from.some((parent) => parent === eventId)) return false;
  if (new Set(v.derived_from).size !== v.derived_from.length) return false;
  return true;
}

/**
 * The storable market event — mirror of the event store's
 * `StorableEvent` (the availability quartet, the taxonomy, the
 * sequence, the provenance discipline and the opaque payload; the ONE
 * enforced quartet ordering `available_time >= event_time` included —
 * L4's data-plane half, observed here, never altered).
 */
export interface StorableEventMirror {
  readonly event_id: string;
  readonly venue: string;
  readonly instrument: string;
  readonly asset_class: AssetClassMirror;
  readonly event_type: EventTypeMirror;
  readonly event_time: TimestampMs;
  readonly source_time: TimestampMs | null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
  readonly sequence: number;
  readonly provider: string;
  readonly provenance: StorableProvenanceMirror;
  /** Opaque payload record — semantics owned by @tradrl/market-protocol. */
  readonly payload: object;
}

/** Mirror guard: `StorableEventMirror` (the store's `validateStorableEvent` laws as a boolean). */
export function isStorableEventMirror(value: unknown): value is StorableEventMirror {
  if (!isRecord(value)) return false;
  if (!isEventTypeMirror(value.event_type)) return false;
  for (const field of ['event_id', 'venue', 'instrument', 'provider'] as const) {
    if (!isNonEmptyString(value[field])) return false;
  }
  if (!isAssetClassMirror(value.asset_class)) return false;
  if (!isTimestampMs(value.event_time)) return false;
  if (value.source_time !== null && !isTimestampMs(value.source_time)) return false;
  if (!isTimestampMs(value.available_time)) return false;
  if (!isTimestampMs(value.ingestion_time)) return false;
  // The ONE enforced quartet ordering (T004's ratified D-003).
  if (isTimestampMs(value.event_time) && isTimestampMs(value.available_time) && value.available_time < value.event_time) return false;
  if (!isNonNegativeSafeInteger(value.sequence)) return false;
  if (!isStorableProvenanceMirror(value.provenance, typeof value.event_id === 'string' ? value.event_id : '')) return false;
  if (!isRecord(value.payload)) return false;
  // The other-kind rule (the sequence discipline's scoping law).
  if (value.event_type === 'other') {
    const payload = value.payload as Record<string, unknown>;
    const kind = payloadKindOfMirror(payload);
    if (kind === null) return false;
  }
  return true;
}

/** Mirror of the store's `payloadKindOf`: the non-empty string `kind` of an `other` payload, or null. */
function payloadKindOfMirror(payload: Record<string, unknown>): string | null {
  const kind = payload.kind;
  if (typeof kind === 'string' && kind.length > 0) return kind;
  return null;
}

// ---------------------------------------------------------------------------
// The observed-seam reference (the telemetry record's seam pointer)
// ---------------------------------------------------------------------------

/** The closed vocabulary of observed seams (the four merged seams; the agent plane contributes two record shapes). */
export const OBSERVED_SEAM_KINDS: readonly string[] = [
  'agent-envelope',
  'kernel-operation',
  'gateway-audit',
  'control-plane-audit',
  'event-store',
] as const;

/** An observed seam kind. */
export type ObservedSeamKind = (typeof OBSERVED_SEAM_KINDS)[number];

/** Mirror guard: an observed seam kind. */
export function isObservedSeamKind(v: unknown): v is ObservedSeamKind {
  return typeof v === 'string' && OBSERVED_SEAM_KINDS.includes(v);
}

/**
 * The reference to the seam record a telemetry record observes — by
 * IDENTITY, never by payload. The `gateway-audit` variant is THE
 * complement join key onto T040's audit trail: `{ kind, auditId,
 * tenant, project }` and nothing else.
 */
export type ObservedSeamRef =
  | { readonly kind: 'agent-envelope'; readonly messageId: string; readonly topic: string; readonly tenant: string }
  | { readonly kind: 'kernel-operation'; readonly opId: string; readonly type: string; readonly tenant: string }
  | { readonly kind: 'gateway-audit'; readonly auditId: string; readonly tenant: string; readonly project: string }
  | { readonly kind: 'control-plane-audit'; readonly sequence: number; readonly tenant: string; readonly project: string }
  | { readonly kind: 'event-store'; readonly eventId: string; readonly venue: string };

/** Guard: `ObservedSeamRef` (per-kind field laws; every identity field non-empty). */
export function isObservedSeamRef(v: unknown): v is ObservedSeamRef {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'agent-envelope':
      return isNonEmptyString(v.messageId) && isNonEmptyString(v.topic) && isNonEmptyString(v.tenant);
    case 'kernel-operation':
      return isNonEmptyString(v.opId) && isNonEmptyString(v.type) && isNonEmptyString(v.tenant);
    case 'gateway-audit':
      return isNonEmptyString(v.auditId) && v.auditId.startsWith('xga:') && isNonEmptyString(v.tenant) && isNonEmptyString(v.project);
    case 'control-plane-audit':
      return isPositiveSafeInteger(v.sequence) && isNonEmptyString(v.tenant) && isNonEmptyString(v.project);
    case 'event-store':
      return isNonEmptyString(v.eventId) && isNonEmptyString(v.venue);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Seam-ref derivation (the identity projection of an observed record)
// ---------------------------------------------------------------------------

/**
 * Derive the {@link ObservedSeamRef} of a mirror-guard-valid agent-os
 * message envelope. Pure; the mirror guard runs first.
 */
export function seamRefOfEnvelope(envelope: MessageEnvelopeMirror): ObservedSeamRef {
  if (!isMessageEnvelopeMirror(envelope)) throw new Error('seamRefOfEnvelope: invalid MessageEnvelope mirror');
  return { kind: 'agent-envelope', messageId: envelope.id, topic: envelope.topic, tenant: envelope.tenantId };
}

/**
 * Derive the {@link ObservedSeamRef} of a mirror-guard-valid kernel
 * operation. Pure; the mirror guard runs first.
 */
export function seamRefOfOperation(operation: KernelOperationMirror): ObservedSeamRef {
  if (!isKernelOperationMirror(operation)) throw new Error('seamRefOfOperation: invalid KernelOperation mirror');
  return { kind: 'kernel-operation', opId: operation.opId, type: operation.type, tenant: operation.tenantId };
}

/**
 * Derive the {@link ObservedSeamRef} of a mirror-guard-valid T040
 * gateway audit record — the opaque complement join key.
 */
export function seamRefOfGatewayAudit(record: GatewayAuditRecordMirror): ObservedSeamRef {
  if (!isGatewayAuditRecordMirror(record)) throw new Error('seamRefOfGatewayAudit: invalid GatewayAuditRecord mirror');
  return { kind: 'gateway-audit', auditId: record.auditId, tenant: record.tenant, project: record.project };
}

/**
 * Derive the {@link ObservedSeamRef} of a mirror-guard-valid
 * control-plane journal entry (identified by its sequence within its
 * tenant/project scope — the journal has no id field; the position IS
 * the identity).
 */
export function seamRefOfProjectAuditEntry(entry: ProjectAuditEntryMirror): ObservedSeamRef {
  if (!isProjectAuditEntryMirror(entry)) throw new Error('seamRefOfProjectAuditEntry: invalid ProjectAuditEntry mirror');
  return { kind: 'control-plane-audit', sequence: entry.sequence, tenant: entry.tenantId, project: entry.projectId };
}

/**
 * Derive the {@link ObservedSeamRef} of a mirror-guard-valid storable
 * event (identity = event_id; the venue scopes the stream).
 */
export function seamRefOfStorableEvent(event: StorableEventMirror): ObservedSeamRef {
  if (!isStorableEventMirror(event)) throw new Error('seamRefOfStorableEvent: invalid StorableEvent mirror');
  return { kind: 'event-store', eventId: event.event_id, venue: event.venue };
}
