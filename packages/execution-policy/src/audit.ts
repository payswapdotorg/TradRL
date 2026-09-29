// @tradrl/execution-policy — the AuditRecord and the append-only audit
// trail.
//
// THE LAW (spec/ARCHITECTURE.md Execution: "... and audit"; the Work
// Order: "audit (every decision emits an audit record)" and
// "AuditRecord — every decision (approve or refuse) emits one: full
// lineage chain (intent -> strategy -> goal), policy version, check
// results (enumerated), tenant/project; append-only audit log").
//
// Every decision — approve or refuse — emits EXACTLY ONE
// {@link AuditRecord}: the decision's identity, its outcome, the full
// L9 lineage chain (intent -> strategy -> goal, policy version, venue
// refs, seed), the policy's declared check order, the ENUMERATED check
// results, the structured refusal reason (when refused), and the
// tenant/project scope. Approvals and refusals are audited
// identically: a refusal is evidence of the gate working, never a
// second-class event.
//
// THE TRAIL (L9 + L11's append-only discipline): the {@link AuditLog}
// is append-only with contiguous sequences and an FNV-1a digest CHAIN
// — each record's `chainHead` folds `fnv(prevHead + canonical(record
// content))`, seeded from the log's identity skeleton. A tampered,
// truncated or reordered trail fails `verifyAuditChain` with the typed
// `audit_rewrite`; appending a record whose intent was already decided
// fails with `audit_rewrite` too (one decision, one audit record —
// re-auditing is rewriting). There is no removal or update API.
//
// DOWNSTREAM: the shadow-trading lane (T030) consumes this trail; the
// observability lane (T043) mirrors it. This module is the contract
// layer they consume.
//
// Spec anchors: spec/ARCHITECTURE.md (Execution), spec/ARCHITECTURE-
// LOCK.md L8, L9, L12, L20.

import { deepFreeze, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, fnv1a32Hex } from './primitives';
import type { AuditRecordId, ProjectId, TenantId } from './ids';
import { isAuditRecordId, isProjectId, isTenantId, mintAuditRecordId } from './ids';
import type { CheckResult, ExecutionDecision, ExecutionLineage, RefusalReason } from './check-machine';
import type { PreTradeCheckKind } from './policy';
import { isCheckResult, isExecutionLineage, isExecutionDecision, isRefusalReason } from './check-machine';
import {
  type ExecutionPolicyResult,
  fail,
  invalidType,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The audit record
// ---------------------------------------------------------------------------

/**
 * The audit record of one gate decision: the decision's identity and
 * outcome, the full lineage chain, the policy version, the declared
 * check order, the enumerated check results, the structured refusal
 * reason (iff refused), the tenant/project scope, the record's
 * position in the trail, and the chain head binding it to everything
 * before it.
 */
export interface AuditRecord {
  /** Content-addressed identity: `xa:` + digest of the record's canonical content. */
  readonly auditId: AuditRecordId;
  /** 1-based position in the trail (contiguous — append-only). */
  readonly sequence: number;
  /** The audited decision's identity (`xd:`-prefixed). */
  readonly decisionId: string;
  /** The decision's outcome. */
  readonly outcome: 'approve' | 'refuse';
  /** The gated strategy intent's identity (lineage chain: intent -> strategy -> goal). */
  readonly intentRef: string;
  /** The policy version that gated the decision. */
  readonly policy: { readonly policyId: string; readonly version: number };
  /** The declared check order the decision's checks ran in. */
  readonly checkOrder: readonly PreTradeCheckKind[];
  /** The enumerated check results (all passed for approvals; up to and including the failure for refusals). */
  readonly checks: readonly CheckResult[];
  /** The structured refusal reason (iff outcome is 'refuse'). */
  readonly refusal: RefusalReason | null;
  /** The full L9 lineage block. */
  readonly lineage: ExecutionLineage;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The decision instant (the intent's asOf — no ambient clock). */
  readonly asOf: TimestampMs;
  /** The chain head binding this record to everything before it: `fnv(prev + canonical(content))`. */
  readonly chainHead: string;
}

/** Guard: `AuditRecord` (structural; the outcome invariants included). */
export function isAuditRecord(value: unknown): value is AuditRecord {
  if (!isRecord(value)) return false;
  if (!isAuditRecordId(value.auditId)) return false;
  if (!isPositiveSafeInteger(value.sequence)) return false;
  if (!isNonEmptyString(value.decisionId) || !value.decisionId.startsWith('xd:')) return false;
  if (value.outcome !== 'approve' && value.outcome !== 'refuse') return false;
  if (!isNonEmptyString(value.intentRef)) return false;
  if (!isRecord(value.policy) || !isNonEmptyString((value.policy as Record<string, unknown>).policyId)) return false;
  if (!Array.isArray(value.checkOrder) || !value.checkOrder.every((x) => typeof x === 'string' && x !== '')) return false;
  if (!Array.isArray(value.checks) || !value.checks.every((x) => isCheckResult(x))) return false;
  if (value.outcome === 'refuse') {
    if (!isRefusalReason(value.refusal)) return false;
  } else if (value.refusal !== null) return false;
  if (!isExecutionLineage(value.lineage)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!isTimestampMs(value.asOf)) return false;
  if (typeof value.chainHead !== 'string' || !/^[0-9a-f]{8}$/.test(value.chainHead)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The chain (append-only history verification)
// ---------------------------------------------------------------------------

/** The lineage's canonical JSON tree (explicit — JSON shape proven by construction, never cast). */
function auditLineageTree(lineage: ExecutionLineage): JsonValue {
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

/** The refusal reason's canonical JSON tree (explicit — never the typed record). */
function auditRefusalTree(reason: RefusalReason): JsonValue {
  return { ...reason } as { readonly [key: string]: JsonValue };
}

/** The canonical JSON tree of a record's CONTENT (everything except `auditId` and `chainHead`). */
function auditContentTree(record: Omit<AuditRecord, 'auditId' | 'chainHead'>): JsonValue {
  return {
    sequence: record.sequence,
    decisionId: record.decisionId,
    outcome: record.outcome,
    intentRef: record.intentRef,
    policy: { policyId: record.policy.policyId, version: record.policy.version },
    checkOrder: [...record.checkOrder],
    checks: record.checks.map((check) => ({ dimension: check.dimension, ordinal: check.ordinal, outcome: check.outcome })),
    refusal: record.refusal === null ? null : auditRefusalTree(record.refusal),
    lineage: auditLineageTree(record.lineage),
    tenant: record.tenant,
    project: record.project,
    asOf: record.asOf,
  };
}

/** The expected chain head of a record: `fnv(prevHead + canonical(content))`. */
function expectedAuditChainHead(previousHead: string, record: Omit<AuditRecord, 'auditId' | 'chainHead'>): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(auditContentTree(record))}`);
}

// ---------------------------------------------------------------------------
// The audit log
// ---------------------------------------------------------------------------

/**
 * The append-only audit trail. Created empty per (policy, session)
 * scope; grown ONLY through {@link appendDecision} (and its resume-time
 * sibling {@link appendAuditRecord}); verified through
 * {@link verifyAuditChain}. The chain seed derives from the trail's
 * identity skeleton `{ tenant, project, records: 0 }` — recoverable
 * from the log itself so verification is total.
 */
export interface AuditLog {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly records: readonly AuditRecord[];
}

/** Guard: `AuditLog` (structural). */
export function isAuditLog(value: unknown): value is AuditLog {
  if (!isRecord(value)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!Array.isArray(value.records) || !value.records.every((record) => isAuditRecord(record))) return false;
  return true;
}

/** The chain seed of a trail: `fnv(canonical({ tenant, project, records: 0 }))` (recoverable from the log). */
function auditChainSeed(log: AuditLog): string {
  return fnv1a32Hex(canonicalJson({ tenant: log.tenant, project: log.project, records: 0 }));
}

/** Create an empty audit trail for one tenant/project scope. */
export function startAuditLog(tenant: TenantId, project: ProjectId): ExecutionPolicyResult<AuditLog> {
  if (!isTenantId(tenant)) return fail('tenant_missing', 'startAuditLog requires a tenant scope (L12)');
  if (!isProjectId(project)) return fail('tenant_missing', 'startAuditLog requires a project scope (L12/L15)');
  return ok(deepFreeze({ tenant, project, records: [] }));
}

/**
 * Convert one gate decision into its audit record (the emission every
 * decision produces — the policy's `audit.emission` discipline made
 * structural). Pure: the record's identity is content-addressed from
 * the decision and the trail position.
 */
export function auditRecordOf(decision: ExecutionDecision, sequence: number, previousChainHead: string): ExecutionPolicyResult<AuditRecord> {
  if (!isExecutionDecision(decision)) {
    return fail('invalid_decision', 'auditRecordOf requires a structurally valid gate decision');
  }
  if (!isPositiveSafeInteger(sequence)) {
    return fail('invalid_decision', 'auditRecordOf requires a positive trail position');
  }
  const content: Omit<AuditRecord, 'auditId' | 'chainHead'> = {
    sequence,
    decisionId: decision.decisionId,
    outcome: decision.kind,
    intentRef: decision.intentRef,
    policy: { policyId: decision.policy.policyId, version: decision.policy.version },
    checkOrder: [...decision.checkOrder],
    checks: [...decision.checks],
    refusal: decision.kind === 'refuse' ? decision.failure.reason : null,
    lineage: decision.lineage,
    tenant: decision.lineage.tenant as TenantId,
    project: decision.lineage.project as ProjectId,
    asOf: decision.asOf,
  };
  if (content.tenant !== content.lineage.tenant || content.project !== content.lineage.project) {
    return fail('invalid_decision', 'the decision lineage\'s tenant/project must match the audit trail scope (L12)');
  }
  const chainHead = expectedAuditChainHead(previousChainHead, content);
  const record: AuditRecord = deepFreeze({
    ...content,
    auditId: mintAuditRecordId(fnv1a32Hex(`${chainHead}${canonicalJson(auditContentTree(content))}`)),
    chainHead,
  });
  return ok(record);
}

/**
 * Append one gate decision's audit record to the trail — the trail's
 * ONLY growth path. Rules (the append-only law):
 *   1. the decision is guard-valid;
 *   2. the decision's lineage scope matches the trail's tenant/project
 *      (L12 — cross-tenant auditing is inexpressible);
 *   3. the decision was not already audited (a duplicate decisionId is
 *      the typed `audit_rewrite` — one decision, one audit record);
 *   4. the record's sequence is the next contiguous position.
 * Returns a NEW trail; the original is untouched. There is no removal,
 * update or reordering entry point anywhere in this module.
 */
export function appendDecision(log: AuditLog, decision: ExecutionDecision): ExecutionPolicyResult<AuditLog> {
  if (!isAuditLog(log)) {
    return fail('invalid_type', 'appendDecision requires a valid audit log');
  }
  if (decision.lineage.tenant !== log.tenant || decision.lineage.project !== log.project) {
    return fail('tenant_missing', `the decision's scope (${decision.lineage.tenant}/${decision.lineage.project}) does not match the trail's (${log.tenant}/${log.project}) — trails are tenant-isolated (L12)`);
  }
  if (log.records.some((record) => record.decisionId === decision.decisionId)) {
    return fail(
      'audit_rewrite',
      `decision ${decision.decisionId} is already audited — one decision, one audit record (re-auditing is rewriting; the trail is append-only)`,
      'decisionId',
    );
  }
  const previousHead = log.records.length === 0 ? auditChainSeed(log) : (log.records[log.records.length - 1] as AuditRecord).chainHead;
  const recordResult = auditRecordOf(decision, log.records.length + 1, previousHead);
  if (!recordResult.ok) return recordResult;
  return ok(deepFreeze({ tenant: log.tenant, project: log.project, records: [...log.records, recordResult.value] }));
}

/**
 * Append a pre-built audit record (the resume path — a serialized
 * trail's records re-enter through validation, not through decisions).
 * Enforces the same laws as {@link appendDecision} plus the record's
 * own chain-head derivation.
 */
export function appendAuditRecord(log: AuditLog, record: AuditRecord): ExecutionPolicyResult<AuditLog> {
  if (!isAuditLog(log)) {
    return fail('invalid_type', 'appendAuditRecord requires a valid audit log');
  }
  if (!isAuditRecord(record)) {
    return fail('invalid_type', 'appendAuditRecord requires a structurally valid audit record');
  }
  if (record.tenant !== log.tenant || record.project !== log.project) {
    return fail('tenant_missing', `the record's scope (${record.tenant}/${record.project}) does not match the trail's (${log.tenant}/${log.project}) — trails are tenant-isolated (L12)`);
  }
  if (record.sequence !== log.records.length + 1) {
    return fail(
      'audit_rewrite',
      `record ${record.auditId} claims sequence ${record.sequence} but the trail's next position is ${log.records.length + 1} — the trail is append-only with contiguous sequences`,
      'sequence',
    );
  }
  if (log.records.some((existing) => existing.decisionId === record.decisionId)) {
    return fail('audit_rewrite', `decision ${record.decisionId} is already audited — one decision, one audit record`, 'decisionId');
  }
  const previousHead = log.records.length === 0 ? auditChainSeed(log) : (log.records[log.records.length - 1] as AuditRecord).chainHead;
  const expectedHead = expectedAuditChainHead(previousHead, record);
  if (record.chainHead !== expectedHead) {
    return fail('audit_rewrite', `record ${record.auditId}'s chain head does not fold onto the trail — the record was forged or belongs to another trail`, 'chainHead');
  }
  return ok(deepFreeze({ tenant: log.tenant, project: log.project, records: [...log.records, record] }));
}

/**
 * Verify the audit trail's chain: recompute every record's chain head
 * from the records themselves and check the sequences, the id
 * derivations, the scope continuity and the one-decision-one-record
 * law. A trail whose history was spliced, edited, truncated or
 * duplicated fails with the typed `audit_rewrite`.
 */
export function verifyAuditChain(log: AuditLog): ExecutionPolicyResult<AuditLog> {
  if (!isAuditLog(log)) {
    return fail('invalid_type', 'verifyAuditChain requires a structurally valid audit log');
  }
  let previousHead = auditChainSeed(log);
  const seenDecisions = new Set<string>();
  for (let index = 0; index < log.records.length; index++) {
    const record = log.records[index] as AuditRecord;
    if (record.sequence !== index + 1) {
      return fail('audit_rewrite', `record ${index} carries sequence ${record.sequence} — the trail is append-only with contiguous sequences (a splice is a rewrite)`, `records[${index}].sequence`);
    }
    const expectedHead = expectedAuditChainHead(previousHead, record);
    if (record.chainHead !== expectedHead) {
      return fail('audit_rewrite', `record ${index}'s chain head does not fold onto its content — the record (or something before it) was edited, removed or reordered`, `records[${index}].chainHead`);
    }
    const expectedId = mintAuditRecordId(fnv1a32Hex(`${record.chainHead}${canonicalJson(auditContentTree(record))}`));
    if (record.auditId !== expectedId) {
      return fail('audit_rewrite', `record ${index}'s id does not match its content — the record was edited after recording`, `records[${index}].auditId`);
    }
    if (record.tenant !== log.tenant || record.project !== log.project) {
      return fail('audit_rewrite', `record ${index} changes the trail's tenant/project scope — scope continuity is part of the chain`, `records[${index}]`);
    }
    if (seenDecisions.has(record.decisionId)) {
      return fail('audit_rewrite', `decision ${record.decisionId} is audited twice — one decision, one audit record`, `records[${index}].decisionId`);
    }
    seenDecisions.add(record.decisionId);
    previousHead = record.chainHead;
  }
  return ok(log);
}

/**
 * Collect-all validation of an untrusted audit trail: the structural
 * guard, then the full chain verification. On success the trail is
 * returned narrowed, deeply frozen.
 */
export function validateAuditLog(value: unknown, path = 'auditLog'): ExecutionPolicyResult<AuditLog> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  if (!isAuditLog(value)) {
    return fail('invalid_type', `${path} fails the audit-log guard (tenant/project scope + a record list of valid audit records)`);
  }
  const verified = verifyAuditChain(value);
  if (!verified.ok) return verified;
  return ok(deepFreeze(value));
}
