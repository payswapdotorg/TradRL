/**
 * @tradrl/time-engine/knowledge — the KnowledgeBase (Work Order T026).
 *
 * A PURE, IN-MEMORY, APPEND-ONLY record store. Appending returns a NEW frozen
 * base (copy-on-append; the original is never mutated — L9 lineage is stable
 * by construction) and enforces every invariant:
 *
 *   - structural validity (record.ts guards),
 *   - append-only identity (duplicate record ids rejected),
 *   - parent resolution (every input id already present; cycles and
 *     self-reference are therefore inexpressible — append order is a
 *     topological order of the knowledge graph),
 *   - derivation tenant isolation (L12),
 *   - availability propagation (L4: available_time >= max(input times)).
 *
 * CLOCK-POLICED QUERIES: {@link visible} / {@link visibleSlice} implement the
 * L4 boundary at the knowledge layer — INCLUSIVE:
 *
 *     visible(record, at)  <=>  record.available_time <= at
 *
 * with NO origin-based exemptions (simulated knowledge is withheld exactly
 * like historical — provenance never influences visibility) and NO
 * ingestion_time consultation (embargo and backfill are both legitimate).
 * Decisions are pure functions of (record, at).
 *
 * CROSS-TENANT READS ARE REJECTED: {@link getKnowledgeRecord} takes the
 * reading tenant and returns a typed `tenant_isolation` error when the
 * record belongs to another tenant; {@link visibleKnowledgeSlice} scopes a
 * whole slice to one tenant.
 *
 * {@link loadKnowledgeRecords} is the FORENSIC/LOADING path: structural
 * validation only, NO graph invariants — the leakage scan (scan.ts) exists
 * precisely to audit such bases (a base delivered from outside the guarded
 * append path may be leaky; the scan reports it).
 */

import { isTimestampMs, type TimestampMs } from '../timestamp';
import { deepFreeze, isDeeplyFrozen } from './freeze';
import { fail, ok, type KnowledgeResult } from './errors';
import type { KnowledgeRecordId, TenantId } from './ids';
import { isKnowledgeRecord, type KnowledgeRecord } from './record';
import { validateKnowledgeRecord } from './propagation';

/**
 * The append-only knowledge base. `records` is in APPEND ORDER (the
 * topological order of the knowledge graph — also the deterministic scan
 * order). Deeply frozen on every construction.
 */
export interface KnowledgeBase {
  readonly records: readonly KnowledgeRecord[];
  readonly size: number;
}

/** Runtime type guard for a structurally valid KnowledgeBase. */
export function isKnowledgeBase(value: unknown): value is KnowledgeBase {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.records)) return false;
  if (typeof candidate.size !== 'number' || !Number.isSafeInteger(candidate.size) || candidate.size < 0) return false;
  if (candidate.size !== candidate.records.length) return false;
  for (const record of candidate.records) {
    if (!isKnowledgeRecord(record)) return false;
  }
  return true;
}

/** The empty knowledge base. */
export function createKnowledgeBase(): KnowledgeBase {
  return deepFreeze({ records: Object.freeze([]), size: 0 }) as KnowledgeBase;
}

/** Internal: resolve a record id within a base (append-order scan). */
function findById(base: KnowledgeBase, recordId: KnowledgeRecordId): KnowledgeRecord | undefined {
  for (const record of base.records) {
    if (record.record_id === recordId) return record;
  }
  return undefined;
}

/**
 * Append one record. Enforces the full write contract (structure, identity,
 * parent resolution, tenant isolation of derivations, availability
 * propagation) and returns a NEW frozen base; the input base is unchanged.
 */
export function appendKnowledgeRecord(base: KnowledgeBase, record: KnowledgeRecord): KnowledgeResult<KnowledgeBase> {
  if (!isKnowledgeBase(base)) {
    return fail('invalid_record', 'the knowledge base is structurally invalid');
  }
  if (!isKnowledgeRecord(record)) {
    return fail('invalid_record', 'the appended record is structurally invalid');
  }

  if (findById(base, record.record_id) !== undefined) {
    return fail('duplicate_record', `record "${record.record_id}" is already present — the base is append-only`);
  }

  const parents = new Map<KnowledgeRecordId, KnowledgeRecord>();
  for (const inputId of record.inputs) {
    const parent = findById(base, inputId);
    if (parent === undefined) {
      return fail('unknown_input', `input "${inputId}" of record "${record.record_id}" does not resolve in the knowledge base`);
    }
    parents.set(inputId, parent);
  }

  const validation = validateKnowledgeRecord(record, parents);
  if (!validation.ok) return validation;

  const appended: KnowledgeBase = {
    records: Object.freeze([...base.records, isDeeplyFrozen(record) ? record : deepFreeze(record)]),
    size: base.size + 1,
  };
  return ok(deepFreeze(appended));
}

/**
 * FORENSIC/LOADING path: build a base from records WITHOUT graph-invariant
 * enforcement. Each record is structurally validated and frozen, and record
 * ids must be unique, but missing parents, leaky availability and cross-tenant
 * derivation edges are PERMITTED here — {@link knowledgeLeakageScan} is the
 * instrument that audits such bases. The guarded path is
 * {@link appendKnowledgeRecord}.
 */
export function loadKnowledgeRecords(records: readonly unknown[]): KnowledgeResult<KnowledgeBase> {
  const loaded: KnowledgeRecord[] = [];
  const seen = new Set<string>();
  for (const candidate of records) {
    if (!isKnowledgeRecord(candidate)) {
      return fail('invalid_record', 'every loaded record must be structurally valid (forensic loading still enforces the record contract)');
    }
    if (seen.has(candidate.record_id)) {
      return fail('duplicate_record', `record "${candidate.record_id}" appears twice — record identity is unique`);
    }
    seen.add(candidate.record_id);
    loaded.push(isDeeplyFrozen(candidate) ? candidate : deepFreeze(candidate));
  }
  const base: KnowledgeBase = { records: Object.freeze(loaded), size: loaded.length };
  return ok(deepFreeze(base));
}

/**
 * The L4 boundary predicate at the knowledge layer: is `record` legitimately
 * observable at instant `at`? INCLUSIVE at `available_time` — knowledge
 * becomes visible EXACTLY at its availability instant, never before.
 * Pure; origin-blind; never consults ingestion_time.
 */
export function visible(record: KnowledgeRecord, at: TimestampMs): boolean {
  return record.available_time <= at;
}

/**
 * All members of `records` observable at instant `at` (preserves input
 * order). The clock-policed slice primitive. Mirrors `observableAt` from
 * src/boundary.ts: `at` carries the validated TimestampMs type.
 */
export function visibleSlice(records: readonly KnowledgeRecord[], at: TimestampMs): KnowledgeRecord[] {
  return records.filter((record) => visible(record, at));
}

/**
 * Tenant-scoped point-in-time lookup. Rejections are TYPED:
 *  - `unknown_record` when the id is absent,
 *  - `tenant_isolation` when the record belongs to another tenant (L12 —
 *    cross-tenant reads are rejected, not silently empty).
 */
export function getKnowledgeRecord(
  base: KnowledgeBase,
  tenant: TenantId,
  recordId: KnowledgeRecordId,
): KnowledgeResult<KnowledgeRecord> {
  const record = findById(base, recordId);
  if (record === undefined) {
    return fail('unknown_record', `record "${recordId}" is not present in the knowledge base`);
  }
  if (record.tenant !== tenant) {
    return fail(
      'tenant_isolation',
      `record "${recordId}" belongs to tenant "${record.tenant}" and may not be read by tenant "${tenant}" — L12`,
    );
  }
  return ok(record);
}

/**
 * The tenant-scoped, clock-policed slice of a base: records of `tenant` whose
 * `available_time <= at`, in append order. Other tenants' records are simply
 * out of scope for the slice (the REJECTION semantics for cross-tenant access
 * live in {@link getKnowledgeRecord} and the firewall service audit).
 */
export function visibleKnowledgeSlice(
  base: KnowledgeBase,
  tenant: TenantId,
  at: TimestampMs,
): KnowledgeResult<readonly KnowledgeRecord[]> {
  if (!isTimestampMs(at)) {
    return fail('invalid_timestamp', 'visibleKnowledgeSlice requires a valid at instant');
  }
  return ok(
    Object.freeze(
      base.records.filter((record) => record.tenant === tenant && visible(record, at)),
    ),
  );
}
