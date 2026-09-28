/**
 * @tradrl/knowledge-firewall — the FirewallService (Work Order T026,
 * reference implementation).
 *
 * The L4 enforcement plane at the KNOWLEDGE layer, bound to a simulation
 * clock. Every read is policed:
 *
 *   1. TENANT scope first (L12): records of other tenants are excluded and
 *      the audit NEVER discloses their availability timing (null timestamps
 *      on boundary entries) — the log is safe to hand to the querying
 *      tenant's operator.
 *   2. The INCLUSIVE point-in-time boundary: a record is visible iff
 *      `available_time <= clock.now` — visible EXACTLY at its availability
 *      instant, never one millisecond earlier. Origin-blind: simulated and
 *      generated knowledge is withheld exactly like historical.
 *   3. The data-shaped filter narrows the visible slice further.
 *
 * DECISIONS ARE PURE FUNCTIONS of (record, clock, tenant, filter) — the
 * same query over the same base always produces the same audit log
 * (determinism law), and the audit log is REPLAYABLE: every entry records
 * the inputs of its decision, so {@link replayFirewallAudit} re-derives
 * each decision from the log alone and flags any tampering;
 * {@link verifyFirewallAudit} re-runs the whole query against the base and
 * compares. Zero runtime dependencies; mirrors only (see mirrors.ts).
 */

import {
  deepFreeze,
  fail,
  isFirewallClock,
  isFirewallRecord,
  isKnowledgeBaseView,
  isKnowledgeRecordId,
  isTenantId,
  ok,
  validateKnowledgeQueryFilter,
  type FirewallClock,
  type FirewallResult,
  type KnowledgeBaseView,
  type KnowledgeQueryFilter,
  type KnowledgeRecord,
  type KnowledgeRecordId,
  type TenantId,
  type TimestampMs,
} from './mirrors';

/** Why a record was included or excluded. */
export type KnowledgeDecisionReason = 'visible' | 'not_yet_available' | 'tenant_boundary' | 'filtered_out';

/** The decision for ONE scanned record: included or excluded, and why. */
export interface FirewallDecision {
  readonly record_id: KnowledgeRecordId;
  readonly decision: 'included' | 'excluded';
  readonly reason: KnowledgeDecisionReason;
  /**
   * The record's available_time — recorded for every NON-boundary entry so
   * the replay pass can re-derive the decision. NULL iff the reason is
   * `tenant_boundary` (L12: another tenant's timing is never disclosed).
   */
  readonly available_time: TimestampMs | null;
  /** The clock instant the decision was made at. */
  readonly now: TimestampMs;
}

/**
 * The replayable decision audit log: the query's (tenant, clock instant,
 * filter) plus one decision per scanned record, in base order. Deeply
 * frozen — audit logs are evidence, not scratch space.
 */
export interface FirewallAuditLog {
  readonly tenant: TenantId;
  readonly at: TimestampMs;
  readonly filter: KnowledgeQueryFilter;
  readonly scanned: number;
  readonly decisions: readonly FirewallDecision[];
}

/** The query outcome: the visible+tenant-scoped records plus the audit log. */
export interface FirewallQueryResult {
  readonly records: readonly KnowledgeRecord[];
  readonly audit: FirewallAuditLog;
}

/** One replay mismatch: the recorded decision versus the re-derived one. */
export interface FirewallReplayMismatch {
  readonly index: number;
  readonly recorded: FirewallDecision;
  readonly replayed: FirewallDecision;
}

/** The replay/verify outcome: clean iff every decision reproduced identically. */
export interface FirewallReplayReport {
  readonly clean: boolean;
  readonly mismatches: readonly FirewallReplayMismatch[];
  readonly entriesChecked: number;
}

// ---------------------------------------------------------------------------
// The pure decision predicate.
// ---------------------------------------------------------------------------

/** Does the record pass the data-shaped filter? (Assumes visibility passed.) */
function passesFilter(record: KnowledgeRecord, filter: KnowledgeQueryFilter): boolean {
  if (filter.ids !== undefined && filter.ids.length > 0) {
    const allowed = new Set<string>(filter.ids);
    if (!allowed.has(record.record_id)) return false;
  }
  if (filter.availableFrom !== undefined && record.available_time < filter.availableFrom) return false;
  if (filter.availableTo !== undefined && record.available_time > filter.availableTo) return false;
  return true;
}

/**
 * The firewall decision for one record — a PURE function of
 * (record, clock.now, tenant, filter). Check order is the law: tenant
 * boundary first (L12, disclosing nothing), then the inclusive point-in-time
 * boundary (L4), then the filter.
 */
function decide(record: KnowledgeRecord, now: TimestampMs, tenant: TenantId, filter: KnowledgeQueryFilter): FirewallDecision {
  if (record.tenant !== tenant) {
    return { record_id: record.record_id, decision: 'excluded', reason: 'tenant_boundary', available_time: null, now };
  }
  if (record.available_time > now) {
    return { record_id: record.record_id, decision: 'excluded', reason: 'not_yet_available', available_time: record.available_time, now };
  }
  if (!passesFilter(record, filter)) {
    return { record_id: record.record_id, decision: 'excluded', reason: 'filtered_out', available_time: record.available_time, now };
  }
  return { record_id: record.record_id, decision: 'included', reason: 'visible', available_time: record.available_time, now };
}

/** Re-derive the decision from an audit entry's own recorded inputs. */
function replayDecision(entry: FirewallDecision, at: TimestampMs, filter: KnowledgeQueryFilter): FirewallDecision {
  if (entry.available_time === null) {
    // Boundary entries record no timestamp (L12: another tenant's timing is
    // never disclosed); the tenant mismatch is the only legitimate cause.
    return { record_id: entry.record_id, decision: 'excluded', reason: 'tenant_boundary', available_time: null, now: at };
  }
  if (entry.available_time > at) {
    return { record_id: entry.record_id, decision: 'excluded', reason: 'not_yet_available', available_time: entry.available_time, now: at };
  }
  const passes = (filter.ids === undefined || filter.ids.length === 0 || filter.ids.some((id) => id === entry.record_id)) &&
    (filter.availableFrom === undefined || entry.available_time >= filter.availableFrom) &&
    (filter.availableTo === undefined || entry.available_time <= filter.availableTo);
  if (!passes) {
    return { record_id: entry.record_id, decision: 'excluded', reason: 'filtered_out', available_time: entry.available_time, now: at };
  }
  return { record_id: entry.record_id, decision: 'included', reason: 'visible', available_time: entry.available_time, now: at };
}

// ---------------------------------------------------------------------------
// The query.
// ---------------------------------------------------------------------------

/**
 * Query a knowledge base through the firewall: returns ONLY the
 * visible + tenant-scoped records (further narrowed by the filter) together
 * with the decision audit log explaining, for every scanned record, why it
 * was included or excluded. Pure; deterministic; the log is replayable.
 */
export function firewallQuery(
  kb: KnowledgeBaseView,
  clock: FirewallClock,
  tenant: TenantId,
  filter: KnowledgeQueryFilter,
): FirewallResult<FirewallQueryResult> {
  if (!isKnowledgeBaseView(kb)) {
    return fail('invalid_base', 'the knowledge base is structurally invalid');
  }
  if (!isFirewallClock(clock)) {
    return fail('invalid_clock', 'the firewall clock must carry a valid now instant');
  }
  if (!isTenantId(tenant)) {
    return fail('invalid_tenant', 'the reading tenant must be a non-empty tenant id');
  }
  const filterResult = validateKnowledgeQueryFilter(filter);
  if (!filterResult.ok) return filterResult;

  const now = clock.now;
  const decisions: FirewallDecision[] = [];
  const included: KnowledgeRecord[] = [];
  for (const record of kb.records) {
    // Total guards: the view guard validated every record; re-assert per
    // record so hand-built views cannot slip a malformed entry through.
    if (!isFirewallRecord(record)) {
      return fail('invalid_base', `record at index ${decisions.length} is structurally invalid`);
    }
    const decision = decide(record, now, tenant, filterResult.value);
    decisions.push(decision);
    if (decision.decision === 'included') included.push(record);
  }

  // Copy the filter into the audit (the log must not alias — and thereby
  // freeze — the caller's input object).
  const auditFilter: KnowledgeQueryFilter =
    filterResult.value.ids === undefined
      ? { ...filterResult.value }
      : { ...filterResult.value, ids: [...filterResult.value.ids] };

  return ok(
    deepFreeze({
      records: Object.freeze(included),
      audit: {
        tenant,
        at: now,
        filter: auditFilter,
        scanned: kb.records.length,
        decisions,
      },
    }),
  );
}

/**
 * Tenant-scoped, clock-policed single-record read with TYPED rejections:
 * `unknown_record`, `tenant_isolation` (L12 — cross-tenant reads are
 * rejected, not silently empty) and `not_yet_available` (the record exists,
 * belongs to the tenant, but the firewall withholds it until its
 * availability instant).
 */
export function firewallGetRecord(
  kb: KnowledgeBaseView,
  clock: FirewallClock,
  tenant: TenantId,
  recordId: KnowledgeRecordId,
): FirewallResult<KnowledgeRecord> {
  if (!isKnowledgeBaseView(kb)) {
    return fail('invalid_base', 'the knowledge base is structurally invalid');
  }
  if (!isFirewallClock(clock)) {
    return fail('invalid_clock', 'the firewall clock must carry a valid now instant');
  }
  if (!isTenantId(tenant)) {
    return fail('invalid_tenant', 'the reading tenant must be a non-empty tenant id');
  }
  if (!isKnowledgeRecordId(recordId)) {
    return fail('invalid_filter', 'the requested record id must be a non-empty string');
  }
  for (const record of kb.records) {
    if (record.record_id !== recordId) continue;
    if (record.tenant !== tenant) {
      return fail('tenant_isolation', `record "${recordId}" belongs to another tenant and may not be read — L12`);
    }
    if (record.available_time > clock.now) {
      return fail(
        'not_yet_available',
        `record "${recordId}" is withheld until its availability instant ${record.available_time} (now ${clock.now})`,
      );
    }
    return ok(record);
  }
  return fail('unknown_record', `record "${recordId}" is not present in the knowledge base`);
}

// ---------------------------------------------------------------------------
// Replay and verification.
// ---------------------------------------------------------------------------

/**
 * Replay an audit log: re-derive every decision from the log's OWN recorded
 * inputs (tenant, instant, filter, per-entry availability) and report every
 * entry whose recorded decision does not reproduce. A clean replay is
 * evidence that the log is internally consistent and untampered; a mismatch
 * proves tampering (or a non-deterministic decision function, which would
 * itself violate the determinism law).
 */
export function replayFirewallAudit(audit: FirewallAuditLog): FirewallReplayReport {
  const filterResult = validateKnowledgeQueryFilter(audit.filter);
  if (!filterResult.ok) {
    return deepFreeze({ clean: false, mismatches: [], entriesChecked: audit.decisions.length });
  }
  const mismatches: FirewallReplayMismatch[] = [];
  for (let index = 0; index < audit.decisions.length; index++) {
    const entry = audit.decisions[index];
    if (entry === undefined) continue;
    const replayed = replayDecision(entry, audit.at, filterResult.value);
    if (entry.decision !== replayed.decision || entry.reason !== replayed.reason || entry.available_time !== replayed.available_time) {
      mismatches.push({ index, recorded: entry, replayed });
    }
  }
  return deepFreeze({ clean: mismatches.length === 0, mismatches, entriesChecked: audit.decisions.length });
}

/**
 * Verify an audit log against the source of truth: re-run the whole query
 * over the base and compare every decision. Detects tampering that a
 * self-replay cannot (e.g. an entry whose recorded inputs were themselves
 * rewritten consistently with the decision).
 */
export function verifyFirewallAudit(
  kb: KnowledgeBaseView,
  clock: FirewallClock,
  tenant: TenantId,
  filter: KnowledgeQueryFilter,
  audit: FirewallAuditLog,
): FirewallReplayReport {
  const queryResult = firewallQuery(kb, clock, tenant, filter);
  if (!queryResult.ok) {
    return deepFreeze({ clean: false, mismatches: [], entriesChecked: audit.decisions.length });
  }
  const expected = queryResult.value.audit.decisions;
  const mismatches: FirewallReplayMismatch[] = [];
  const length = Math.max(expected.length, audit.decisions.length);
  for (let index = 0; index < length; index++) {
    const recorded = audit.decisions[index];
    const replayed = expected[index];
    if (recorded === undefined || replayed === undefined) {
      // Length mismatch: one side has an entry the other lacks.
      const existing = recorded ?? replayed;
      if (existing !== undefined) mismatches.push({ index, recorded: existing, replayed: existing });
      continue;
    }
    if (recorded.decision !== replayed.decision || recorded.reason !== replayed.reason || recorded.available_time !== replayed.available_time) {
      mismatches.push({ index, recorded, replayed });
    }
  }
  return deepFreeze({ clean: mismatches.length === 0, mismatches, entriesChecked: audit.decisions.length });
}

// ---------------------------------------------------------------------------
// The service wrapper.
// ---------------------------------------------------------------------------

/** A FirewallService bound to one knowledge base ("wraps a KnowledgeBase"). */
export interface FirewallService {
  /** The wrapped base (frozen view; validated at construction). */
  readonly base: KnowledgeBaseView;
  /** Clock-policed, tenant-scoped query with the decision audit log. */
  query(clock: FirewallClock, tenant: TenantId, filter: KnowledgeQueryFilter): FirewallResult<FirewallQueryResult>;
  /** Tenant-scoped, clock-policed single-record read with typed rejections. */
  getRecord(clock: FirewallClock, tenant: TenantId, recordId: KnowledgeRecordId): FirewallResult<KnowledgeRecord>;
  /** Re-verify a previously produced audit log against this base. */
  verify(clock: FirewallClock, tenant: TenantId, filter: KnowledgeQueryFilter, audit: FirewallAuditLog): FirewallReplayReport;
}

/**
 * Create a FirewallService wrapping one knowledge base. The base is
 * validated once (total guards); queries remain pure functions.
 */
export function createFirewallService(kb: KnowledgeBaseView): FirewallResult<FirewallService> {
  if (!isKnowledgeBaseView(kb)) {
    return fail('invalid_base', 'the knowledge base is structurally invalid');
  }
  return ok(
    deepFreeze({
      base: kb,
      query: (clock: FirewallClock, tenant: TenantId, filter: KnowledgeQueryFilter) => firewallQuery(kb, clock, tenant, filter),
      getRecord: (clock: FirewallClock, tenant: TenantId, recordId: KnowledgeRecordId) => firewallGetRecord(kb, clock, tenant, recordId),
      verify: (clock: FirewallClock, tenant: TenantId, filter: KnowledgeQueryFilter, audit: FirewallAuditLog) =>
        verifyFirewallAudit(kb, clock, tenant, filter, audit),
    }),
  );
}
