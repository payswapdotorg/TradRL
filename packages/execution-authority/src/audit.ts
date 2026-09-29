// @tradrl/execution-authority — the GatewayAuditRecord and the
// append-only, chain-verified gateway audit trail.
//
// THE LAW (spec/SECURITY.md Audit — VERBATIM: "Record who/what acted,
// BodyVersion, substrate, policy, visible market/data state, risk
// checks, order, execution and outcome for consequential actions.").
// Every gateway submission — routed or refused — emits EXACTLY ONE
// {@link GatewayAuditRecord} carrying the full sentence as typed data:
//
//   who/what acted  -> { tenant, project, principal (specId+version),
//                        intentRef, clientOrderId, decisionId, decisionKind }
//   BodyVersion     -> { specId, version } (the strategy version that
//                        computed the gated intent — the body lineage)
//   substrate       -> the opaque substrate ref that computed it
//   policy          -> the execution policy version + the risk policy
//                        version (the T020 lane's refinement, D-014)
//   visible state   -> the venue-instrument facts the gate reasoned
//                        over (class, reference price, rate-window
//                        count) + the risk exposure ref
//   risk checks     -> the T020 evaluation summary (evaluation id +
//                        within/breaching/blocked counts)
//   order           -> the translated order (adapter ref, channel
//                        ref, credential ref, client order id, the
//                        request digest) — null iff refused
//   execution       -> the submission outcome facts (routed flag,
//                        submission instant, the routed-message digest)
//   outcome         -> 'routed' | 'refused' + the structured refusal
//                        summary (stage + code + detail)
//
// plus the full L9 lineage block (lineage-complete for the consumers:
// T041's SDK/API and T043's observability lane keep these records
// JSON-serializable and tenant-scoped).
//
// THE TRAIL (L9 + the T019 AuditLog discipline, mirrored): the
// {@link GatewayAuditTrail} is append-only with contiguous sequences
// and an FNV-1a digest CHAIN — each record's `chainHead` folds
// `fnv(prevHead + canonical(record content))`, seeded from the trail's
// identity skeleton `{ tenant, project, records: 0 }`. A tampered,
// truncated or reordered trail fails {@link verifyGatewayAuditChain}
// with the typed `audit_rewrite`; appending a record whose decision was
// already audited fails with `audit_rewrite` too (one decision, one
// audit record — re-auditing is rewriting). There is no removal or
// update API.
//
// THE OPACITY LAW: the guard runs the credential-value trip wire over
// every record — an audit trail carrying credential material is
// inexpressible (the trip wire runs over the whole request bundle, and
// the audit record is part of that bundle's downstream).

import { deepFreeze, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, fnv1a32Hex } from './primitives';
import { credentialValueViolations } from './credentials';
import type { ExecutionLineageRecord } from './decision-mirror';
import { isExecutionLineageRecord } from './decision-mirror';
import type { AdapterDescriptorRef, ChannelRef, CredentialRef, GatewayAuditRecordId, ProjectId, TenantId } from './ids';
import { isAdapterDescriptorRef, isChannelRef, isCredentialRef, isProjectId, isTenantId, mintGatewayAuditRecordId } from './ids';
import { type ExecutionAuthorityResult, fail, invalidType, ok } from './errors';

// ---------------------------------------------------------------------------
// The audit record
// ---------------------------------------------------------------------------

/** The WHO/WHAT block: the acting scope, the principal, the decision and the order identities. */
export interface AuditWhoWhat {
  /** The strategy version that computed the gated intent (the BodyVersion mirror — the body lineage). */
  readonly bodyVersion: { readonly specId: string; readonly version: number };
  /** The gated strategy intent's identity ('si:'-prefixed). */
  readonly intentRef: string;
  /** The audited decision's identity ('xd:'-prefixed) — null only for pre-decision refusals. */
  readonly decisionId: string | null;
  /** The decision's outcome as the gate recorded it. */
  readonly decisionKind: 'approve' | 'refuse' | null;
  /** The submitted order's idempotency key. */
  readonly clientOrderId: string;
}

/** Guard: `AuditWhoWhat`. */
export function isAuditWhoWhat(v: unknown): v is AuditWhoWhat {
  if (!isRecord(v)) return false;
  const bodyVersion = v.bodyVersion;
  if (!isRecord(bodyVersion) || !isNonEmptyString(bodyVersion.specId) || !isPositiveSafeInteger(bodyVersion.version)) return false;
  if (!isNonEmptyString(v.intentRef)) return false;
  if (v.decisionId !== null && !isNonEmptyString(v.decisionId)) return false;
  if (v.decisionKind !== null && v.decisionKind !== 'approve' && v.decisionKind !== 'refuse') return false;
  if (!isNonEmptyString(v.clientOrderId)) return false;
  return true;
}

/** The visible market/data state the gate reasoned over (SECURITY.md's audit contents). */
export interface AuditVisibleState {
  readonly venue: string;
  readonly instrument: string;
  readonly instrumentClass: string;
  /** The reference price the notional checks used (a canonical decimal string). */
  readonly referencePrice: string;
  /** The venue's in-window order count the rate checks observed. */
  readonly rateWindowOrderCount: number;
  /** The risk exposure record the T020 evaluation measured ('exp:'-prefixed). */
  readonly riskExposureRef: string | null;
}

/** Guard: `AuditVisibleState`. */
export function isAuditVisibleState(v: unknown): v is AuditVisibleState {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.venue)) return false;
  if (!isNonEmptyString(v.instrument)) return false;
  if (!isNonEmptyString(v.instrumentClass)) return false;
  if (!isNonEmptyString(v.referencePrice)) return false;
  if (typeof v.rateWindowOrderCount !== 'number' || !Number.isSafeInteger(v.rateWindowOrderCount) || v.rateWindowOrderCount < 0) return false;
  if (v.riskExposureRef !== null && !isNonEmptyString(v.riskExposureRef)) return false;
  return true;
}

/** The risk-checks summary (the T020 evaluation's identity + the state counts; the id is null when the risk stage never ran — pre-risk refusals). */
export interface AuditRiskChecks {
  /** The limit evaluation's identity ('rls:'-prefixed), or null when the risk stage never ran. */
  readonly evaluationId: string | null;
  /** The risk policy version that evaluated (or would have). */
  readonly riskPolicy: { readonly policyId: string; readonly version: number };
  readonly within: number;
  readonly breaching: number;
  readonly blocked: number;
}

/** Guard: `AuditRiskChecks`. */
export function isAuditRiskChecks(v: unknown): v is AuditRiskChecks {
  if (!isRecord(v)) return false;
  if (v.evaluationId !== null && !isNonEmptyString(v.evaluationId)) return false;
  const riskPolicy = v.riskPolicy;
  if (!isRecord(riskPolicy) || !isNonEmptyString(riskPolicy.policyId) || !isPositiveSafeInteger(riskPolicy.version)) return false;
  for (const count of [v.within, v.breaching, v.blocked]) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return false;
  }
  return true;
}

/** The ORDER block: the translated order's routing identity (null iff the submission was refused before translation). */
export interface AuditOrderBlock {
  readonly adapterRef: AdapterDescriptorRef;
  readonly channelRef: ChannelRef;
  readonly credentialRef: CredentialRef;
  readonly clientOrderId: string;
  /** The gateway order request's identity ('gor:'-prefixed). */
  readonly requestRef: string;
}

/** Guard: `AuditOrderBlock`. */
export function isAuditOrderBlock(v: unknown): v is AuditOrderBlock {
  if (!isRecord(v)) return false;
  if (!isAdapterDescriptorRef(v.adapterRef)) return false;
  if (!isChannelRef(v.channelRef)) return false;
  if (!isCredentialRef(v.credentialRef)) return false;
  if (!isNonEmptyString(v.clientOrderId)) return false;
  if (typeof v.requestRef !== 'string' || !v.requestRef.startsWith('gor:')) return false;
  return true;
}

/** The EXECUTION block: the submission outcome's operational facts (null iff refused before the adapter call). */
export interface AuditExecutionBlock {
  /** Whether the routed message was sent to the injected adapter transport. */
  readonly routed: boolean;
  /** The submission instant (epoch ms). */
  readonly submissionAt: TimestampMs;
  /** The routed message's stable digest (null iff nothing was sent). */
  readonly messageDigest: string | null;
}

/** Guard: `AuditExecutionBlock`. */
export function isAuditExecutionBlock(v: unknown): v is AuditExecutionBlock {
  if (!isRecord(v)) return false;
  if (typeof v.routed !== 'boolean') return false;
  if (!isTimestampMs(v.submissionAt)) return false;
  if (v.messageDigest !== null && (typeof v.messageDigest !== 'string' || !/^[0-9a-f]{8}$/.test(v.messageDigest))) return false;
  return true;
}

/** The OUTCOME block's refusal summary: the lane-agnostic structured fact of WHY a submission refused. */
export interface AuditRefusalSummary {
  /** The pipeline stage that refused (the gateway's stage vocabulary). */
  readonly stage: string;
  /** The refusal's code (the stage's discriminator). */
  readonly code: string;
  /** The refusal's structured detail (JSON-serializable, opaque to this contract). */
  readonly detail: JsonValue | null;
}

/** Guard: `AuditRefusalSummary`. */
export function isAuditRefusalSummary(v: unknown): v is AuditRefusalSummary {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.stage)) return false;
  if (!isNonEmptyString(v.code)) return false;
  if (v.detail !== null && typeof v.detail !== 'object' && typeof v.detail !== 'string' && typeof v.detail !== 'number' && typeof v.detail !== 'boolean') return false;
  return true;
}

/**
 * The gateway audit record of one submission — SECURITY.md's audit
 * sentence as typed data (see the module header for the field-by-field
 * mapping), plus the full L9 lineage block and the chain head binding
 * the record to everything before it.
 */
export interface GatewayAuditRecord {
  /** Content-addressed identity: `xga:` + digest of the record's canonical content. */
  readonly auditId: GatewayAuditRecordId;
  /** 1-based position in the trail (contiguous — append-only). */
  readonly sequence: number;
  // WHO/WHAT acted (SECURITY.md).
  readonly who: AuditWhoWhat;
  /** The opaque substrate ref of the cognitive substrate that computed the intent. */
  readonly substrate: string;
  /** The execution policy version that gated the submission. */
  readonly policy: { readonly policyId: string; readonly version: number };
  /** The visible market/data state the gate reasoned over. */
  readonly visibleState: AuditVisibleState;
  /** The T020 risk-check summary. */
  readonly riskChecks: AuditRiskChecks;
  /** The ORDER block — the translated order's routing identity (null iff refused). */
  readonly order: AuditOrderBlock | null;
  /** The EXECUTION block — the submission's operational outcome facts (null iff refused pre-adapter). */
  readonly execution: AuditExecutionBlock | null;
  /** The OUTCOME: routed or refused. */
  readonly outcome: 'routed' | 'refused';
  /** The structured refusal summary (iff outcome is 'refused'). */
  readonly refusal: AuditRefusalSummary | null;
  /** The full L9 lineage block (lineage-complete for T041/T043). */
  readonly lineage: ExecutionLineageRecord;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The submission instant (epoch ms; the injected instant — no ambient clock). */
  readonly asOf: TimestampMs;
  /** The chain head binding this record to everything before it: `fnv(prev + canonical(content))`. */
  readonly chainHead: string;
}

/** Guard: `GatewayAuditRecord` (structural; the outcome invariants included). */
export function isGatewayAuditRecord(value: unknown): value is GatewayAuditRecord {
  if (!isRecord(value)) return false;
  if (typeof value.auditId !== 'string' || !value.auditId.startsWith('xga:')) return false;
  if (!isPositiveSafeInteger(value.sequence)) return false;
  if (!isAuditWhoWhat(value.who)) return false;
  if (!isNonEmptyString(value.substrate)) return false;
  const policy = value.policy;
  if (!isRecord(policy) || !isNonEmptyString(policy.policyId) || !isPositiveSafeInteger(policy.version)) return false;
  if (!isAuditVisibleState(value.visibleState)) return false;
  if (!isAuditRiskChecks(value.riskChecks)) return false;
  if (value.order !== null && !isAuditOrderBlock(value.order)) return false;
  if (value.execution !== null && !isAuditExecutionBlock(value.execution)) return false;
  if (value.outcome !== 'routed' && value.outcome !== 'refused') return false;
  if (value.outcome === 'refused') {
    if (!isAuditRefusalSummary(value.refusal)) return false;
  } else if (value.refusal !== null) return false;
  if (!isExecutionLineageRecord(value.lineage)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!isTimestampMs(value.asOf)) return false;
  if (typeof value.chainHead !== 'string' || !/^[0-9a-f]{8}$/.test(value.chainHead)) return false;
  // The opacity trip wire (the guard half).
  if (credentialValueViolations(value).length > 0) return false;
  // The outcome-coherence laws: a routed record carries both blocks; a
  // refused record carries the refusal summary.
  if (value.outcome === 'routed' && (value.order === null || value.execution === null)) return false;
  if (value.outcome === 'refused' && value.execution !== null && value.execution.routed) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The chain (append-only history verification — the T019 discipline, mirrored)
// ---------------------------------------------------------------------------

/** The lineage's canonical JSON tree (explicit — JSON shape proven by construction, never cast). */
function auditLineageTree(lineage: ExecutionLineageRecord): JsonValue {
  return {
    intentRef: lineage.intentRef,
    strategy: { specId: lineage.strategy.specId, version: lineage.strategy.version },
    goal: { goalId: lineage.goal.goalId, version: lineage.goal.version },
    policy: { policyId: lineage.policy.policyId, version: lineage.policy.version },
    venues: [...lineage.venues],
    seed: lineage.seed,
    tenant: lineage.tenant,
    project: lineage.project,
  };
}

/** The who/what block's canonical JSON tree. */
function whoTree(who: AuditWhoWhat): JsonValue {
  return {
    bodyVersion: { specId: who.bodyVersion.specId, version: who.bodyVersion.version },
    intentRef: who.intentRef,
    decisionId: who.decisionId,
    decisionKind: who.decisionKind,
    clientOrderId: who.clientOrderId,
  };
}

/** The visible-state block's canonical JSON tree. */
function visibleStateTree(visibleState: AuditVisibleState): JsonValue {
  return {
    venue: visibleState.venue,
    instrument: visibleState.instrument,
    instrumentClass: visibleState.instrumentClass,
    referencePrice: visibleState.referencePrice,
    rateWindowOrderCount: visibleState.rateWindowOrderCount,
    riskExposureRef: visibleState.riskExposureRef,
  };
}

/** The risk-checks block's canonical JSON tree. */
function riskChecksTree(riskChecks: AuditRiskChecks): JsonValue {
  return {
    evaluationId: riskChecks.evaluationId,
    riskPolicy: { policyId: riskChecks.riskPolicy.policyId, version: riskChecks.riskPolicy.version },
    within: riskChecks.within,
    breaching: riskChecks.breaching,
    blocked: riskChecks.blocked,
  };
}

/** The order block's canonical JSON tree. */
function orderTree(order: AuditOrderBlock): JsonValue {
  return {
    adapterRef: order.adapterRef,
    channelRef: order.channelRef,
    credentialRef: order.credentialRef,
    clientOrderId: order.clientOrderId,
    requestRef: order.requestRef,
  };
}

/** The execution block's canonical JSON tree. */
function executionTree(execution: AuditExecutionBlock): JsonValue {
  return {
    routed: execution.routed,
    submissionAt: execution.submissionAt,
    messageDigest: execution.messageDigest,
  };
}

/** The refusal summary's canonical JSON tree. */
function refusalTree(refusal: AuditRefusalSummary): JsonValue {
  return { stage: refusal.stage, code: refusal.code, detail: refusal.detail };
}

/** The canonical JSON tree of a record's CONTENT (everything except `auditId` and `chainHead`). */
function auditContentTree(record: Omit<GatewayAuditRecord, 'auditId' | 'chainHead'>): JsonValue {
  return {
    sequence: record.sequence,
    who: whoTree(record.who),
    substrate: record.substrate,
    policy: { policyId: record.policy.policyId, version: record.policy.version },
    visibleState: visibleStateTree(record.visibleState),
    riskChecks: riskChecksTree(record.riskChecks),
    order: record.order === null ? null : orderTree(record.order),
    execution: record.execution === null ? null : executionTree(record.execution),
    outcome: record.outcome,
    refusal: record.refusal === null ? null : refusalTree(record.refusal),
    lineage: auditLineageTree(record.lineage),
    tenant: record.tenant,
    project: record.project,
    asOf: record.asOf,
  };
}

/** The expected chain head of a record: `fnv(prevHead + canonical(content))`. */
function expectedAuditChainHead(previousHead: string, record: Omit<GatewayAuditRecord, 'auditId' | 'chainHead'>): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(auditContentTree(record))}`);
}

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

/**
 * The append-only gateway audit trail. Created empty per
 * tenant/project scope; grown ONLY through {@link appendGatewayAuditRecord};
 * verified through {@link verifyGatewayAuditChain}. The chain seed
 * derives from the trail's identity skeleton `{ tenant, project,
 * records: 0 }` — recoverable from the log itself so verification is
 * total.
 */
export interface GatewayAuditTrail {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly records: readonly GatewayAuditRecord[];
}

/** Guard: `GatewayAuditTrail` (structural). */
export function isGatewayAuditTrail(value: unknown): value is GatewayAuditTrail {
  if (!isRecord(value)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!Array.isArray(value.records) || !value.records.every((record) => isGatewayAuditRecord(record))) return false;
  return true;
}

/** The chain seed of a trail: `fnv(canonical({ tenant, project, records: 0 }))` (recoverable from the log). */
function auditChainSeed(trail: GatewayAuditTrail): string {
  return fnv1a32Hex(canonicalJson({ tenant: trail.tenant, project: trail.project, records: 0 }));
}

/** Create an empty gateway audit trail for one tenant/project scope. */
export function startGatewayAuditTrail(tenant: TenantId, project: ProjectId): ExecutionAuthorityResult<GatewayAuditTrail> {
  if (!isTenantId(tenant)) return fail('tenant_missing', 'startGatewayAuditTrail requires a tenant scope (L12)');
  if (!isProjectId(project)) return fail('tenant_missing', 'startGatewayAuditTrail requires a project scope (L12/L15)');
  return ok(deepFreeze({ tenant, project, records: [] }));
}

/**
 * Append one pre-built audit record — the trail's ONLY growth path.
 * Rules (the append-only law, T019's discipline mirrored):
 *   1. the record is guard-valid (the opacity trip wire included);
 *   2. the record's scope matches the trail's tenant/project (L12 —
 *      cross-tenant auditing is inexpressible);
 *   3. the record was not already audited (a duplicate decisionId is
 *      the typed `audit_rewrite` — one decision, one audit record);
 *   4. the record's sequence is the next contiguous position;
 *   5. the record's chain head folds onto the trail.
 * Returns a NEW trail; the original is untouched. There is no removal,
 * update or reordering entry point anywhere in this module.
 */
export function appendGatewayAuditRecord(trail: GatewayAuditTrail, record: GatewayAuditRecord): ExecutionAuthorityResult<GatewayAuditTrail> {
  if (!isGatewayAuditTrail(trail)) {
    return fail('invalid_type', 'appendGatewayAuditRecord requires a valid gateway audit trail');
  }
  if (!isGatewayAuditRecord(record)) {
    return fail('invalid_type', 'appendGatewayAuditRecord requires a structurally valid gateway audit record');
  }
  if (record.tenant !== trail.tenant || record.project !== trail.project) {
    return fail('tenant_missing', `the record's scope (${record.tenant}/${record.project}) does not match the trail's (${trail.tenant}/${trail.project}) — trails are tenant-isolated (L12)`);
  }
  if (record.sequence !== trail.records.length + 1) {
    return fail(
      'audit_rewrite',
      `record ${record.auditId} claims sequence ${record.sequence} but the trail's next position is ${trail.records.length + 1} — the trail is append-only with contiguous sequences`,
      'sequence',
    );
  }
  if (record.who.decisionId !== null && trail.records.some((existing) => existing.who.decisionId === record.who.decisionId)) {
    return fail('audit_rewrite', `decision ${record.who.decisionId} is already audited — one decision, one audit record (re-auditing is rewriting)`, 'who.decisionId');
  }
  const previousHead = trail.records.length === 0 ? auditChainSeed(trail) : (trail.records[trail.records.length - 1] as GatewayAuditRecord).chainHead;
  const expectedHead = expectedAuditChainHead(previousHead, record);
  if (record.chainHead !== expectedHead) {
    return fail('audit_rewrite', `record ${record.auditId}'s chain head does not fold onto the trail — the record was forged or belongs to another trail`, 'chainHead');
  }
  return ok(deepFreeze({ tenant: trail.tenant, project: trail.project, records: [...trail.records, record] }));
}

/**
 * Mint one audit record at the trail's next position (the gateway's
 * emission site): the record is built from the submission facts, its
 * chain head folds the previous head, and its id is content-addressed
 * from the chain-bound content. Pure; does NOT append (the caller
 * appends through {@link appendGatewayAuditRecord}).
 */
export function gatewayAuditRecordAt(
  trail: GatewayAuditTrail,
  content: Omit<GatewayAuditRecord, 'auditId' | 'chainHead' | 'sequence'>,
): ExecutionAuthorityResult<GatewayAuditRecord> {
  const sequence = trail.records.length + 1;
  const previousHead = trail.records.length === 0 ? auditChainSeed(trail) : (trail.records[trail.records.length - 1] as GatewayAuditRecord).chainHead;
  const atPosition: Omit<GatewayAuditRecord, 'auditId' | 'chainHead'> = { ...content, sequence };
  const chainHead = expectedAuditChainHead(previousHead, atPosition);
  const auditId = mintGatewayAuditRecordId(fnv1a32Hex(`${chainHead}${canonicalJson(auditContentTree(atPosition))}`));
  const record: GatewayAuditRecord = deepFreeze({ ...atPosition, auditId, chainHead });
  if (!isGatewayAuditRecord(record)) {
    return fail('invalid_type', 'the minted audit record fails its own guard — the submission facts are malformed');
  }
  return ok(record);
}

/**
 * Verify the gateway audit trail's chain: recompute every record's
 * chain head from the records themselves and check the sequences, the
 * id derivations, the scope continuity and the one-decision-one-record
 * law. A trail whose history was spliced, edited, truncated or
 * duplicated fails with the typed `audit_rewrite`.
 */
export function verifyGatewayAuditChain(trail: GatewayAuditTrail): ExecutionAuthorityResult<GatewayAuditTrail> {
  if (!isGatewayAuditTrail(trail)) {
    return fail('invalid_type', 'verifyGatewayAuditChain requires a structurally valid gateway audit trail');
  }
  let previousHead = auditChainSeed(trail);
  const seenDecisions = new Set<string>();
  for (let index = 0; index < trail.records.length; index++) {
    const record = trail.records[index] as GatewayAuditRecord;
    if (record.sequence !== index + 1) {
      return fail('audit_rewrite', `record ${index} carries sequence ${record.sequence} — the trail is append-only with contiguous sequences (a splice is a rewrite)`, `records[${index}].sequence`);
    }
    const expectedHead = expectedAuditChainHead(previousHead, record);
    if (record.chainHead !== expectedHead) {
      return fail('audit_rewrite', `record ${index}'s chain head does not fold onto its content — the record (or something before it) was edited, removed or reordered`, `records[${index}].chainHead`);
    }
    const expectedId = mintGatewayAuditRecordId(fnv1a32Hex(`${record.chainHead}${canonicalJson(auditContentTree(record))}`));
    if (record.auditId !== expectedId) {
      return fail('audit_rewrite', `record ${index}'s id does not match its content — the record was edited after recording`, `records[${index}].auditId`);
    }
    if (record.tenant !== trail.tenant || record.project !== trail.project) {
      return fail('audit_rewrite', `record ${index} changes the trail's tenant/project scope — scope continuity is part of the chain`, `records[${index}]`);
    }
    if (record.who.decisionId !== null) {
      if (seenDecisions.has(record.who.decisionId)) {
        return fail('audit_rewrite', `decision ${record.who.decisionId} is audited twice — one decision, one audit record`, `records[${index}].who.decisionId`);
      }
      seenDecisions.add(record.who.decisionId);
    }
    previousHead = record.chainHead;
  }
  return ok(trail);
}

/**
 * Collect-all validation of an untrusted gateway audit trail: the
 * structural guard (the opacity trip wire included), then the full
 * chain verification. On success the trail is returned narrowed,
 * deeply frozen.
 */
export function validateGatewayAuditTrail(value: unknown, path = 'gatewayAuditTrail'): ExecutionAuthorityResult<GatewayAuditTrail> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  if (!isGatewayAuditTrail(value)) {
    return fail('invalid_type', `${path} fails the audit-trail guard (tenant/project scope + a record list of valid gateway audit records)`);
  }
  const verified = verifyGatewayAuditChain(value);
  if (!verified.ok) return verified;
  return ok(deepFreeze(value));
}
