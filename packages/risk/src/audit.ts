// @tradrl/risk — the RiskAuditTrail: the append-only record of every
// limit evaluation.
//
// THE AUDIT LAW (spec/ARCHITECTURE.md Execution — "...and audit"; spec/
// SECURITY.md Audit: "Record who/what acted, ... risk checks, ... for
// consequential actions"; the Work Order's scope: "RiskAuditTrail —
// append-only records of every evaluation (policy version, inputs'
// lineage refs, states, reasons)"): one record per evaluation, carrying
// the policy version, the evaluation's and exposure's lineage refs,
// the state summary and every structured breach reason. T030 (shadow
// trading) consumes this trail downstream.
//
// THE CHAIN (the rewrite trip wire — the same discipline as T019's
// audit trail and the kill-switch log): every record carries an FNV-1a
// chain head binding its content to everything before it, and
// `verifyRiskAuditTrail` recomputes the chain from the records
// themselves. A trail whose history was spliced, edited, truncated or
// duplicated fails with the typed `risk_audit_rewrite`.
//
// L9/L12: every record carries the full risk lineage (policy version,
// constraint-set ref, goal ref, portfolio-state ref, market-state ref,
// seed, tenant, project) and the tenant/project scope; cross-tenant
// auditing is inexpressible.
//
// Spec anchors: spec/ARCHITECTURE.md (Execution), spec/ARCHITECTURE-
// LOCK.md L9, L12, spec/SECURITY.md (Audit).

import { deepFreeze, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, fnv1a32Hex } from './primitives';
import type { LimitEvaluationRecord, LimitState, RiskLineage } from './limits';
import { isLimitEvaluationRecord } from './limits';
import type { ProjectId, RiskAuditRecordId, TenantId } from './ids';
import { isProjectId, isTenantId, mintRiskAuditRecordId } from './ids';
import {
  type RiskResult,
  fail,
  invalidType,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The audit record
// ---------------------------------------------------------------------------

/**
 * One structured breach as the audit trail records it: the limit kind,
 * the scope, and the exact-evidence triple (bound, observed, excess) —
 * "which limit, the current value, the bound, by how much" as
 * attributable data, never prose.
 */
export interface AuditBreachRecord {
  readonly kind: LimitState['kind'];
  /** The breach's instrument scope, or null for the portfolio scope. */
  readonly venue: string | null;
  readonly instrument: string | null;
  readonly instrumentClass: string | null;
  readonly bound: string;
  readonly observed: string;
  readonly excess: string;
}

/** Guard: `AuditBreachRecord`. */
export function isAuditBreachRecord(v: unknown): v is AuditBreachRecord {
  if (!isRecord(v)) return false;
  if (typeof v.kind !== 'string' || !( ['order_size', 'order_notional', 'position_size', 'position_notional', 'concentration', 'drawdown', 'leverage'] as readonly string[]).includes(v.kind)) return false;
  if (v.venue !== null && !isNonEmptyString(v.venue)) return false;
  if (v.instrument !== null && !isNonEmptyString(v.instrument)) return false;
  if (v.instrumentClass !== null && !isNonEmptyString(v.instrumentClass)) return false;
  if (!isNonEmptyString(v.bound) || !isNonEmptyString(v.observed) || !isNonEmptyString(v.excess)) return false;
  return true;
}

/**
 * One append-only audit record: the evaluation's identity, the policy
// version that produced it, the exposure it measured, the state counts,
// every structured breach reason, and the full lineage block. The
 * record's identity is content-addressed (`xra:` + digest over the
 * chain head and the canonical content).
 */
export interface RiskAuditRecord {
  /** Content-addressed identity: `xra:` + digest over (chainHead + canonical content). */
  readonly auditId: RiskAuditRecordId;
  /** 1-based position in the trail (contiguous — append-only). */
  readonly sequence: number;
  /** The audited evaluation's identity (`rls:`-prefixed). */
  readonly evaluationRef: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  /** The measured exposure's identity (`exp:`-prefixed). */
  readonly exposureRef: string;
  /** The honored switch log's state at evaluation time. */
  readonly killSwitchState: 'standing' | 'thrown';
  /** The state counts (within / breaching / blocked). */
  readonly withinCount: number;
  readonly breachingCount: number;
  readonly blockedCount: number;
  /** Every structured breach reason, in evaluation order. */
  readonly breaches: readonly AuditBreachRecord[];
  /** The full L9 lineage block (policy, constraint set, goal, states, seed, tenant, project). */
  readonly lineage: RiskLineage;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The evaluation instant. */
  readonly asOf: TimestampMs;
  /** The chain head binding this record to everything before it. */
  readonly chainHead: string;
}

/** Guard: `RiskAuditRecord` (structural). */
export function isRiskAuditRecord(v: unknown): v is RiskAuditRecord {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.auditId) || !v.auditId.startsWith('xra:')) return false;
  if (!isPositiveSafeInteger(v.sequence)) return false;
  if (!isNonEmptyString(v.evaluationRef) || !v.evaluationRef.startsWith('rls:')) return false;
  const policy = v.policy;
  if (!isRecord(policy) || typeof policy.policyId !== 'string' || !policy.policyId.startsWith('rpol:') || typeof policy.version !== 'number' || !Number.isSafeInteger(policy.version) || policy.version < 1) return false;
  if (!isNonEmptyString(v.exposureRef) || !v.exposureRef.startsWith('exp:')) return false;
  if (v.killSwitchState !== 'standing' && v.killSwitchState !== 'thrown') return false;
  if (!Number.isSafeInteger(v.withinCount) || typeof v.withinCount !== 'number' || v.withinCount < 0) return false;
  if (!Number.isSafeInteger(v.breachingCount) || typeof v.breachingCount !== 'number' || v.breachingCount < 0) return false;
  if (!Number.isSafeInteger(v.blockedCount) || typeof v.blockedCount !== 'number' || v.blockedCount < 0) return false;
  if (!Array.isArray(v.breaches) || !v.breaches.every((breach) => isAuditBreachRecord(breach))) return false;
  const lineage = v.lineage;
  if (!isRecord(lineage) || !isRecord(lineage.policy) || !isRecord(lineage.constraintSet) || !isRecord(lineage.goal)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (typeof v.chainHead !== 'string' || !/^[0-9a-f]{8}$/.test(v.chainHead)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The trail
// ---------------------------------------------------------------------------

/**
 * The append-only risk audit trail. Created empty per (tenant, project)
 * scope; grown ONLY through {@link appendEvaluation} (and its
 * resume-time sibling {@link appendAuditRecord}); verified through
 * {@link verifyRiskAuditTrail}.
 */
export interface RiskAuditTrail {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly records: readonly RiskAuditRecord[];
}

/** Guard: `RiskAuditTrail` (structural). */
export function isRiskAuditTrail(v: unknown): v is RiskAuditTrail {
  if (!isRecord(v)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!Array.isArray(v.records) || !v.records.every((record) => isRiskAuditRecord(record))) return false;
  return true;
}

/** The chain seed of a trail: `fnv(canonical({ tenant, project, records: 0 }))` (recoverable from the trail). */
function auditChainSeed(trail: RiskAuditTrail): string {
  return fnv1a32Hex(canonicalJson({ tenant: trail.tenant, project: trail.project, records: 0 }));
}

/** The canonical JSON tree of a record's CONTENT (everything except `auditId` and `chainHead`). */
function auditContentTree(record: Omit<RiskAuditRecord, 'auditId' | 'chainHead'>): JsonValue {
  return {
    sequence: record.sequence,
    evaluationRef: record.evaluationRef,
    policy: { policyId: record.policy.policyId, version: record.policy.version },
    exposureRef: record.exposureRef,
    killSwitchState: record.killSwitchState,
    withinCount: record.withinCount,
    breachingCount: record.breachingCount,
    blockedCount: record.blockedCount,
    breaches: record.breaches.map((breach) => ({
      kind: breach.kind,
      venue: breach.venue,
      instrument: breach.instrument,
      instrumentClass: breach.instrumentClass,
      bound: breach.bound,
      observed: breach.observed,
      excess: breach.excess,
    })),
    lineage: {
      policy: { policyId: record.lineage.policy.policyId, version: record.lineage.policy.version },
      constraintSet: { id: record.lineage.constraintSet.id, version: record.lineage.constraintSet.version },
      goal: { goalId: record.lineage.goal.goalId, version: record.lineage.goal.version },
      portfolioState: record.lineage.portfolioState,
      marketState: record.lineage.marketState,
      seed: record.lineage.seed,
      tenant: record.lineage.tenant,
      project: record.lineage.project,
    },
    tenant: record.tenant,
    project: record.project,
    asOf: record.asOf,
  };
}

/** The expected chain head of a record: `fnv(prevHead + canonical(content))`. */
function expectedAuditChainHead(previousHead: string, record: Omit<RiskAuditRecord, 'auditId' | 'chainHead'>): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(auditContentTree(record))}`);
}

/** The expected record id: `xra:` + digest over (chainHead + canonical content). */
function expectedAuditRecordId(record: Omit<RiskAuditRecord, 'auditId'>): RiskAuditRecordId {
  return mintRiskAuditRecordId(fnv1a32Hex(`${record.chainHead}${canonicalJson(auditContentTree(record))}`));
}

/** Create an empty audit trail for one tenant/project scope. */
export function startRiskAuditTrail(tenant: TenantId, project: ProjectId): RiskResult<RiskAuditTrail> {
  if (!isTenantId(tenant)) return fail('tenant_missing', 'startRiskAuditTrail requires a tenant scope (L12)');
  if (!isProjectId(project)) return fail('tenant_missing', 'startRiskAuditTrail requires a project scope (L12/L15)');
  return ok(deepFreeze({ tenant, project, records: [] }));
}

/**
 * Convert one limit evaluation into its audit record (the emission
 * every evaluation produces). Pure: the record's identity is
 * content-addressed from the evaluation and the trail position.
 */
export function riskAuditRecordOf(evaluation: LimitEvaluationRecord, sequence: number, previousChainHead: string): RiskResult<RiskAuditRecord> {
  if (!isLimitEvaluationRecord(evaluation)) {
    return { ok: false, errors: [invalidType('riskAuditRecordOf requires a structurally valid limit evaluation')] };
  }
  if (!isPositiveSafeInteger(sequence)) {
    return { ok: false, errors: [{ code: 'invalid_field', path: 'sequence', message: 'riskAuditRecordOf requires a positive trail position' }] };
  }
  const breaches: AuditBreachRecord[] = evaluation.states
    .filter((state) => state.state === 'breaching' && state.reason !== null && state.reason.cause === 'breach')
    .map((state) => {
      const reason = state.reason as { cause: 'breach'; bound: string; observed: string; excess: string };
      return deepFreeze({
        kind: state.kind,
        venue: state.scope.kind === 'instrument' ? state.scope.venue : null,
        instrument: state.scope.kind === 'instrument' ? state.scope.instrument : null,
        instrumentClass: state.scope.kind === 'instrument' ? state.scope.instrumentClass : null,
        bound: reason.bound,
        observed: reason.observed,
        excess: reason.excess,
      });
    });
  const content: Omit<RiskAuditRecord, 'auditId' | 'chainHead'> = {
    sequence,
    evaluationRef: evaluation.evaluationId,
    policy: { policyId: evaluation.policy.policyId, version: evaluation.policy.version },
    exposureRef: evaluation.exposureRef,
    killSwitchState: evaluation.killSwitchState,
    withinCount: evaluation.states.filter((state) => state.state === 'within').length,
    breachingCount: evaluation.states.filter((state) => state.state === 'breaching').length,
    blockedCount: evaluation.states.filter((state) => state.state === 'blocked').length,
    breaches,
    lineage: evaluation.lineage,
    tenant: evaluation.lineage.tenant,
    project: evaluation.lineage.project,
    asOf: evaluation.asOf,
  };
  const chainHead = expectedAuditChainHead(previousChainHead, content);
  const record: RiskAuditRecord = deepFreeze({
    ...content,
    auditId: expectedAuditRecordId({ ...content, chainHead }),
    chainHead,
  });
  return ok(record);
}

/**
 * Append one evaluation's audit record to the trail — the trail's ONLY
 * growth path from evaluations. Rules (the append-only law):
 *   1. the evaluation is guard-valid;
 *   2. the evaluation's lineage scope matches the trail's tenant/
 *      project (L12 — cross-tenant auditing is inexpressible);
 *   3. the evaluation was not already audited (a duplicate
 *      evaluationId is the typed `risk_audit_rewrite` — one
 *      evaluation, one audit record);
 *   4. the record's sequence is the next contiguous position.
 * Returns a NEW trail; the original is untouched. There is no removal,
 * update or reordering entry point anywhere in this module.
 */
export function appendEvaluation(trail: RiskAuditTrail, evaluation: LimitEvaluationRecord): RiskResult<RiskAuditTrail> {
  if (!isRiskAuditTrail(trail)) {
    return { ok: false, errors: [invalidType('appendEvaluation requires a valid risk audit trail')] };
  }
  if (!isLimitEvaluationRecord(evaluation)) {
    return { ok: false, errors: [invalidType('appendEvaluation requires a structurally valid limit evaluation')] };
  }
  if (evaluation.lineage.tenant !== trail.tenant || evaluation.lineage.project !== trail.project) {
    return fail('tenant_missing', `the evaluation's scope (${evaluation.lineage.tenant}/${evaluation.lineage.project}) does not match the trail's (${trail.tenant}/${trail.project}) — trails are tenant-isolated (L12)`);
  }
  if (trail.records.some((record) => record.evaluationRef === evaluation.evaluationId)) {
    return fail(
      'risk_audit_rewrite',
      `evaluation ${evaluation.evaluationId} is already audited — one evaluation, one audit record (re-auditing is rewriting; the trail is append-only)`,
      'evaluationRef',
    );
  }
  const previousHead = trail.records.length === 0 ? auditChainSeed(trail) : (trail.records[trail.records.length - 1] as RiskAuditRecord).chainHead;
  const recordResult = riskAuditRecordOf(evaluation, trail.records.length + 1, previousHead);
  if (!recordResult.ok) return recordResult;
  return ok(deepFreeze({ tenant: trail.tenant, project: trail.project, records: [...trail.records, recordResult.value] }));
}

/**
 * Append a pre-built audit record (the resume path — a serialized
 * trail's records re-enter through validation, not through
 * evaluations). Enforces the same laws as {@link appendEvaluation}
 * plus the record's own chain-head derivation.
 */
export function appendAuditRecord(trail: RiskAuditTrail, record: RiskAuditRecord): RiskResult<RiskAuditTrail> {
  if (!isRiskAuditTrail(trail)) {
    return { ok: false, errors: [invalidType('appendAuditRecord requires a valid risk audit trail')] };
  }
  if (!isRiskAuditRecord(record)) {
    return { ok: false, errors: [invalidType('appendAuditRecord requires a structurally valid audit record')] };
  }
  if (record.tenant !== trail.tenant || record.project !== trail.project) {
    return fail('tenant_missing', `the record's scope (${record.tenant}/${record.project}) does not match the trail's (${trail.tenant}/${trail.project}) — trails are tenant-isolated (L12)`);
  }
  if (record.sequence !== trail.records.length + 1) {
    return fail(
      'risk_audit_rewrite',
      `record ${record.auditId} claims sequence ${record.sequence} but the trail's next position is ${trail.records.length + 1} — the trail is append-only with contiguous sequences`,
      'sequence',
    );
  }
  if (trail.records.some((existing) => existing.evaluationRef === record.evaluationRef)) {
    return fail('risk_audit_rewrite', `evaluation ${record.evaluationRef} is already audited — one evaluation, one audit record`, 'evaluationRef');
  }
  const previousHead = trail.records.length === 0 ? auditChainSeed(trail) : (trail.records[trail.records.length - 1] as RiskAuditRecord).chainHead;
  const expectedHead = expectedAuditChainHead(previousHead, record);
  if (record.chainHead !== expectedHead) {
    return fail('risk_audit_rewrite', `record ${record.auditId}'s chain head does not fold onto the trail — the record was forged or belongs to another trail`, 'chainHead');
  }
  if (record.auditId !== expectedAuditRecordId(record)) {
    return fail('risk_audit_rewrite', `record ${record.auditId}'s id does not match its content — the record was edited after recording`, 'auditId');
  }
  return ok(deepFreeze({ tenant: trail.tenant, project: trail.project, records: [...trail.records, record] }));
}

/**
 * Verify the audit trail's chain: recompute every record's chain head
 * and id from the records themselves and check the sequences, the
 * scope continuity and the one-evaluation-one-record law. A trail
 * whose history was spliced, edited, truncated or duplicated fails
 * with the typed `risk_audit_rewrite`.
 */
export function verifyRiskAuditTrail(trail: RiskAuditTrail): RiskResult<RiskAuditTrail> {
  if (!isRiskAuditTrail(trail)) {
    return { ok: false, errors: [invalidType('verifyRiskAuditTrail requires a structurally valid audit trail')] };
  }
  let previousHead = auditChainSeed(trail);
  const seenEvaluations = new Set<string>();
  for (let index = 0; index < trail.records.length; index++) {
    const record = trail.records[index] as RiskAuditRecord;
    if (record.sequence !== index + 1) {
      return fail('risk_audit_rewrite', `record ${index} carries sequence ${record.sequence} — the trail is append-only with contiguous sequences (a splice is a rewrite)`, `records[${index}].sequence`);
    }
    const expectedHead = expectedAuditChainHead(previousHead, record);
    if (record.chainHead !== expectedHead) {
      return fail('risk_audit_rewrite', `record ${index}'s chain head does not fold onto its content — the record (or something before it) was edited, removed or reordered`, `records[${index}].chainHead`);
    }
    if (record.auditId !== expectedAuditRecordId(record)) {
      return fail('risk_audit_rewrite', `record ${index}'s id does not match its content — the record was edited after recording`, `records[${index}].auditId`);
    }
    if (record.tenant !== trail.tenant || record.project !== trail.project) {
      return fail('risk_audit_rewrite', `record ${index} changes the trail's tenant/project scope — scope continuity is part of the chain`, `records[${index}]`);
    }
    if (seenEvaluations.has(record.evaluationRef)) {
      return fail('risk_audit_rewrite', `evaluation ${record.evaluationRef} is audited twice — one evaluation, one audit record`, `records[${index}].evaluationRef`);
    }
    seenEvaluations.add(record.evaluationRef);
    previousHead = record.chainHead;
  }
  return ok(trail);
}

/**
 * Collect-all validation of an untrusted audit trail: the structural
 * guard, then the full chain verification. On success the trail is
 * returned narrowed, deeply frozen.
 */
export function validateRiskAuditTrail(value: unknown, path = 'auditTrail'): RiskResult<RiskAuditTrail> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  if (!isRiskAuditTrail(value)) {
    return fail('invalid_type', `${path} fails the audit-trail guard (tenant/project scope + a record list of valid audit records)`);
  }
  const verified = verifyRiskAuditTrail(value);
  if (!verified.ok) return verified;
  return ok(deepFreeze(value));
}
