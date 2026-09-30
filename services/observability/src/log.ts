// @tradrl/observability_service — the TelemetryLog: the append-only,
// chain-verified log of one tenant/project scope's telemetry records.
//
// THE LAW (the Work Order, mirroring T040's `audit.ts` append-only
// discipline law-for-law — the `startGatewayAuditTrail(tenant,
// project)` law): the log is created EMPTY per tenant/project scope;
// grown ONLY through {@link appendTelemetryRecord}; verified through
// {@link verifyTelemetryLog}. A scope-mismatched append is the typed
// `tenant_missing` error (L12 — cross-tenant telemetry is
// inexpressible). Records carry 1-based CONTIGUOUS sequences, an
// FNV-1a chain head folding `fnv(prevHead + canonical(content))`
// seeded from the log's identity skeleton `{ tenant, project,
// records: 0 }`, and a content-addressed id `tel:` + digest over the
// chain-bound content. A spliced, edited, truncated, reordered or
// duplicated log fails verification with the typed `audit_rewrite`.
// There is NO removal, update or reordering entry point anywhere in
// this module.
//
// Every append validates the record through the contract package's
// collect-all guard (the mirror-guard chain — the opacity trip wire
// included: a credential VALUE anywhere in the record is the typed
// `credential_value_present` rejection).
//
// REPLAY (the determinism proof, mirroring the control plane's
// `replayAuditLog` discipline): {@link replayTelemetryLog} re-appends
// every record onto a fresh empty log of the same scope — the full
// law fold — and returns the rebuilt log, which is byte-identical to
// the original (canonical JSON parity; the tests prove it).
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L4 (recordedAt — the
// explicit instant), L9 (byte-determinism + chain), L12 (per-scope
// logs), spec/SECURITY.md (opacity over every record).

import {
  canonicalJson,
  canonicalTelemetryContentJson,
  deepFreeze,
  fail,
  fnv1a32Hex,
  isRecord,
  isTelemetryRecord,
  mintTelemetryRecordId,
  ok,
  telemetryRecordContentTree,
  validateTelemetryRecord,
  type JsonObject,
  type JsonValue,
  type ObservabilityError,
  type ObservabilityResult,
  type ProjectId,
  type TelemetryRecord,
  type TelemetryRecordContent,
  type TelemetryRecordId,
  type TenantId,
  type TimestampMs,
} from '../../../packages/observability/src/index';
import { isProjectId, isTenantId } from '../../../packages/observability/src/index';

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

/**
 * The append-only telemetry log of one tenant/project scope. Created
 * empty through {@link startTelemetryLog}; grown ONLY through
 * {@link appendTelemetryRecord}; verified through
 * {@link verifyTelemetryLog}; rebuilt through
 * {@link replayTelemetryLog}. The chain seed derives from the log's
 * identity skeleton `{ tenant, project, records: 0 }` — recoverable
 * from the log itself so verification is total.
 */
export interface TelemetryLog {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly records: readonly TelemetryRecord[];
}

/** Guard: `TelemetryLog` (structural — scope + a record list of valid telemetry records). */
export function isTelemetryLog(value: unknown): value is TelemetryLog {
  if (!isRecord(value)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!Array.isArray(value.records) || !value.records.every((record) => isTelemetryRecord(record))) return false;
  return true;
}

/** The chain seed of a log: `fnv(canonical({ tenant, project, records: 0 }))` (recoverable from the log — the identity skeleton). */
function telemetryChainSeed(log: TelemetryLog): string {
  return fnv1a32Hex(canonicalJson({ tenant: log.tenant, project: log.project, records: 0 }));
}

/** The expected chain head of a record: `fnv(prevHead + canonical(content))`. */
function expectedTelemetryChainHead(previousHead: string, content: TelemetryRecordContent): string {
  return fnv1a32Hex(`${previousHead}${canonicalTelemetryContentJson(content)}`);
}

/** The expected record id: `tel:` + digest over (chainHead + canonical content) — the T040 minting law, mirrored. */
function expectedTelemetryRecordId(chainHead: string, content: TelemetryRecordContent): TelemetryRecordId {
  return mintTelemetryRecordId(fnv1a32Hex(`${chainHead}${canonicalTelemetryContentJson(content)}`));
}

/** Strip the minted fields off a full record (the fold's content view). */
function contentOf(record: TelemetryRecord): TelemetryRecordContent {
  const { recordId, chainHead, ...content } = record;
  void recordId;
  void chainHead;
  return content;
}

/** Distributive `Omit` (plain `Omit` over a union collapses to the common keys — the variant fields must survive). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A record's content minus the log position (the caller-supplied half the log mints `sequence` onto). */
export type TelemetryRecordDraft = DistributiveOmit<TelemetryRecordContent, 'sequence'>;

/** A record's content minus the position AND the instant (the observation half; the collector stamps `recordedAt` from the injected instant source). */
export type TelemetryObservationDraft = DistributiveOmit<TelemetryRecordContent, 'sequence' | 'recordedAt'>;

/** The canonical JSON tree of a FULL record (id + content + chain head — the byte-identical replay proof's unit). */
export function telemetryRecordTree(record: TelemetryRecord): JsonValue {
  const tree = telemetryRecordContentTree(contentOf(record)) as JsonObject;
  const full: Record<string, JsonValue> = { ...tree, recordId: record.recordId, chainHead: record.chainHead };
  return full;
}

/** The canonical JSON of a whole log (byte-deterministic — the replay parity unit). */
export function canonicalTelemetryLogJson(log: TelemetryLog): string {
  return canonicalJson({
    tenant: log.tenant,
    project: log.project,
    records: log.records.map((record) => telemetryRecordTree(record)),
  });
}

// ---------------------------------------------------------------------------
// Construction and growth (append-only — the ONLY growth path)
// ---------------------------------------------------------------------------

/** Create an empty telemetry log for one tenant/project scope (the `startGatewayAuditTrail` law, mirrored). */
export function startTelemetryLog(tenant: TenantId, project: ProjectId): ObservabilityResult<TelemetryLog> {
  if (!isTenantId(tenant)) return fail('tenant_missing', 'startTelemetryLog requires a tenant scope (L12)');
  if (!isProjectId(project)) return fail('tenant_missing', 'startTelemetryLog requires a project scope (L12/L15)');
  return ok(deepFreeze({ tenant, project, records: [] }));
}

/**
 * Mint one telemetry record at the log's next position (the
 * collector's emission site): the record is built from the draft
 * content, its chain head folds the previous head, and its id is
 * content-addressed from the chain-bound content. Pure; does NOT
 * append (the caller appends through {@link appendTelemetryRecord}).
 */
export function telemetryRecordAt(log: TelemetryLog, draft: TelemetryRecordDraft): ObservabilityResult<TelemetryRecord> {
  if (!isTelemetryLog(log)) {
    return fail('invalid_type', 'telemetryRecordAt requires a valid telemetry log');
  }
  const sequence = log.records.length + 1;
  const previousHead = log.records.length === 0 ? telemetryChainSeed(log) : (log.records[log.records.length - 1] as TelemetryRecord).chainHead;
  const atPosition: TelemetryRecordContent = { ...draft, sequence };
  const chainHead = expectedTelemetryChainHead(previousHead, atPosition);
  const recordId = expectedTelemetryRecordId(chainHead, atPosition);
  const record: TelemetryRecord = deepFreeze({ ...atPosition, recordId, chainHead }) as TelemetryRecord;
  if (!isTelemetryRecord(record)) {
    // Surface the COLLECTED typed errors (the opacity trip wire's
    // credential_value_present included) — never a generic rejection.
    const collected = validateTelemetryRecord(record);
    if (!collected.ok) {
      return { ok: false, errors: collected.errors };
    }
    return fail('invalid_type', 'the minted telemetry record fails its own guard — the observation facts are malformed');
  }
  return ok(record);
}

/**
 * Append one pre-built telemetry record — the log's ONLY growth path.
 * Rules (the append-only law, T040's discipline mirrored):
 *   1. the record is guard-valid (the opacity trip wire included);
 *   2. the record's scope matches the log's tenant/project (L12 —
 *      cross-tenant telemetry is inexpressible);
 *   3. the record's sequence is the next contiguous position;
 *   4. the record was not already recorded (a duplicate recordId is
 *      the typed `audit_rewrite` — one observation, one record);
 *   5. the record's chain head folds onto the log, and its id is the
 *      content-addressed derivation of that fold.
 * Returns a NEW log; the original is untouched. There is no removal,
 * update or reordering entry point anywhere in this module.
 */
export function appendTelemetryRecord(log: TelemetryLog, record: TelemetryRecord): ObservabilityResult<TelemetryLog> {
  if (!isTelemetryLog(log)) {
    return fail('invalid_type', 'appendTelemetryRecord requires a valid telemetry log');
  }
  if (!isTelemetryRecord(record)) {
    return fail('invalid_type', 'appendTelemetryRecord requires a structurally valid telemetry record');
  }
  if (record.tenant !== log.tenant || record.project !== log.project) {
    return fail('tenant_missing', `the record's scope (${record.tenant}/${record.project}) does not match the log's (${log.tenant}/${log.project}) — telemetry logs are tenant-isolated (L12)`);
  }
  if (record.sequence !== log.records.length + 1) {
    return fail(
      'audit_rewrite',
      `record ${record.recordId} claims sequence ${record.sequence} but the log's next position is ${log.records.length + 1} — the log is append-only with contiguous sequences`,
      'sequence',
    );
  }
  if (log.records.some((existing) => existing.recordId === record.recordId)) {
    return fail('audit_rewrite', `record ${record.recordId} is already in the log — one observation, one record (re-recording is rewriting)`, 'recordId');
  }
  const previousHead = log.records.length === 0 ? telemetryChainSeed(log) : (log.records[log.records.length - 1] as TelemetryRecord).chainHead;
  const content = contentOf(record);
  const expectedHead = expectedTelemetryChainHead(previousHead, content);
  if (record.chainHead !== expectedHead) {
    return fail('audit_rewrite', `record ${record.recordId}'s chain head does not fold onto the log — the record was forged or belongs to another log`, 'chainHead');
  }
  if (record.recordId !== expectedTelemetryRecordId(record.chainHead, content)) {
    return fail('audit_rewrite', `record ${record.recordId}'s id does not match its chain-bound content — the record was edited after recording`, 'recordId');
  }
  return ok(deepFreeze({ tenant: log.tenant, project: log.project, records: [...log.records, record] }));
}

// ---------------------------------------------------------------------------
// Verification (the chain fold — tamper/truncate/reorder detection)
// ---------------------------------------------------------------------------

/**
 * Verify the telemetry log's chain: recompute every record's chain
 * head and id from the records themselves and check the sequences,
 * the scope continuity and the one-observation-one-record law. A log
 * whose history was spliced, edited, truncated, reordered or
 * duplicated fails with the typed `audit_rewrite`.
 */
export function verifyTelemetryLog(log: TelemetryLog): ObservabilityResult<TelemetryLog> {
  if (!isTelemetryLog(log)) {
    return fail('invalid_type', 'verifyTelemetryLog requires a structurally valid telemetry log');
  }
  let previousHead = telemetryChainSeed(log);
  const seenIds = new Set<string>();
  for (let index = 0; index < log.records.length; index++) {
    const record = log.records[index] as TelemetryRecord;
    if (record.sequence !== index + 1) {
      return fail('audit_rewrite', `record ${index} carries sequence ${record.sequence} — the log is append-only with contiguous sequences (a splice is a rewrite)`, `records[${index}].sequence`);
    }
    const content = contentOf(record);
    const expectedHead = expectedTelemetryChainHead(previousHead, content);
    if (record.chainHead !== expectedHead) {
      return fail('audit_rewrite', `record ${index}'s chain head does not fold onto its content — the record (or something before it) was edited, removed or reordered`, `records[${index}].chainHead`);
    }
    if (record.recordId !== expectedTelemetryRecordId(record.chainHead, content)) {
      return fail('audit_rewrite', `record ${index}'s id does not match its chain-bound content — the record was edited after recording`, `records[${index}].recordId`);
    }
    if (record.tenant !== log.tenant || record.project !== log.project) {
      return fail('audit_rewrite', `record ${index} changes the log's tenant/project scope — scope continuity is part of the chain`, `records[${index}]`);
    }
    if (seenIds.has(record.recordId)) {
      return fail('audit_rewrite', `record ${record.recordId} appears twice — one observation, one record`, `records[${index}].recordId`);
    }
    seenIds.add(record.recordId);
    previousHead = record.chainHead;
  }
  return ok(log);
}

/**
 * Collect-all validation of an untrusted telemetry log: every
 * structural violation of the log shape and of EACH record is
 * reported (typed errors, dotted paths), then the full chain
 * verification runs. On success the log is returned narrowed, deeply
 * frozen.
 */
export function validateTelemetryLog(value: unknown, path = 'telemetryLog'): ObservabilityResult<TelemetryLog> {
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'invalid_type', message: `${path} must be an object`, path }] };
  }
  const errors: ObservabilityError[] = [];
  if (value.tenant === undefined) errors.push({ code: 'missing_field' as const, message: 'this field is required', path: `${path}.tenant` });
  else if (!isTenantId(value.tenant)) errors.push({ code: 'invalid_field' as const, message: 'must be a non-empty tenant id (L12)', path: `${path}.tenant` });
  if (value.project === undefined) errors.push({ code: 'missing_field' as const, message: 'this field is required', path: `${path}.project` });
  else if (!isProjectId(value.project)) errors.push({ code: 'invalid_field' as const, message: 'must be a non-empty project id (L15)', path: `${path}.project` });
  if (value.records === undefined) {
    errors.push({ code: 'missing_field' as const, message: 'this field is required', path: `${path}.records` });
  } else if (!Array.isArray(value.records)) {
    errors.push({ code: 'invalid_field' as const, message: 'must be an array of telemetry records', path: `${path}.records` });
  } else {
    for (let index = 0; index < value.records.length; index++) {
      const recordErrors = validateTelemetryRecord(value.records[index], `${path}.records[${index}]`);
      errors.push(...recordErrors.errors);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors: Object.freeze(errors) };
  }
  const log = value as unknown as TelemetryLog;
  const verified = verifyTelemetryLog(log);
  if (!verified.ok) return verified;
  return ok(deepFreeze(log));
}

// ---------------------------------------------------------------------------
// Replay (the determinism proof)
// ---------------------------------------------------------------------------

/**
 * Replay a telemetry log: re-append every record, in sequence order,
 * onto a fresh empty log of the same scope — the full law fold
 * (scope, contiguity, one-observation-one-record, chain head, id
 * derivation). A log that cannot replay is corrupt by definition
 * (typed `audit_rewrite`/`tenant_missing`/`invalid_type`). The
 * rebuilt log is byte-identical to the original (canonical JSON
 * parity — the tests prove it).
 */
export function replayTelemetryLog(log: TelemetryLog): ObservabilityResult<TelemetryLog> {
  if (!isTelemetryLog(log)) {
    return fail('invalid_type', 'replayTelemetryLog requires a structurally valid telemetry log');
  }
  let replayed = startTelemetryLog(log.tenant, log.project);
  if (!replayed.ok) return replayed;
  for (const record of log.records) {
    const appended = appendTelemetryRecord(replayed.value, record);
    if (!appended.ok) return appended;
    replayed = appended;
  }
  return replayed;
}

// ---------------------------------------------------------------------------
// The recordedAt fold helper (used by the query's L4 discipline)
// ---------------------------------------------------------------------------

/** The latest recordedAt of a log's records (null for an empty log) — the natural asOf bound. */
export function latestRecordedAt(log: TelemetryLog): TimestampMs | null {
  if (log.records.length === 0) return null;
  const last = log.records[log.records.length - 1] as TelemetryRecord;
  return last.recordedAt;
}
