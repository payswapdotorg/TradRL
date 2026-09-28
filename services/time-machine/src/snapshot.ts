/**
 * @tradrl/time-machine — snapshot/restore (Work Order T029).
 *
 * An AsOf-state snapshot with a LINEAGE HASH: the whole machine state as
 * pure, deeply-frozen data — the rolling window (arrival order), the
 * availability frontier, the admission counters, the declared exception
 * queues (quarantine/rejections — T008 DLQ-shaped), every consumer cursor
 * position and the ingest-clock state — sealed with a deterministic
 * dual-lane FNV-1a checksum over the lineage-bearing content.
 *
 * RESTORE CONTRACT: restoring a snapshot and feeding the identical
 * subsequent event sequence reproduces identical as-of views, cursor
 * positions and hashes (proven by the behavioral suite). The built-in
 * deterministic stepping clock transfers its (base, step, consumed) state;
 * an injected clock must be re-supplied by the restorer (typed
 * `clock_required` otherwise) — L9: the runtime owns clocks, the snapshot
 * owns lineage.
 *
 * TAMPER DETECTION: {@link validateTimeMachineSnapshot} recomputes the
 * lineage hash over the snapshot's own content and rejects any divergence
 * with a typed `snapshot_mismatch`.
 */

import { hashOf } from './hash';
import { deepFreeze } from './freeze';
import { fail, ok, type TimeMachineResult } from './errors';
import { isDatasetRef, isLineageHash, isTenantId, type DatasetRef, type SnapshotHash, type TenantId } from './ids';
import { isTimeMachineRecord, type TimeMachineRecord } from './record';
import { isDeterministicClockState, type DeterministicClockState } from './clock';
import { validateProjectionSelector, type KnowledgeQueryFilter } from './firewall';
import { isNonNegativeSafeInteger, isRecord } from './canonical-event';
import { isTimestampMs, type TimestampMs } from './timestamp';
import { isEventOrigin } from './provenance';

/** Snapshot discriminator + format version. */
export const SNAPSHOT_KIND = 'tradrl.time-machine.snapshot/v1' as const;

/** How the ingest clock is carried by a snapshot. */
export type IngestClockDescriptor =
  | { readonly kind: 'injected' }
  | { readonly kind: 'builtin-stepping'; readonly base: TimestampMs; readonly step_ms: number };

/** One serialized consumer cursor position. */
export interface CursorSnapshotEntry {
  readonly cursor_id: string;
  readonly position: number;
  readonly last_drain_at: TimestampMs | null;
  readonly selector: KnowledgeQueryFilter;
}

/**
 * The serialized as-of state of one rolling time machine. `window` is in
 * ARRIVAL order; `lineage_hash` seals the whole content (everything except
 * the hash itself). Deeply frozen — a snapshot is evidence.
 */
export interface TimeMachineSnapshot {
  readonly kind: typeof SNAPSHOT_KIND;
  readonly dataset: DatasetRef;
  readonly tenant: TenantId;
  readonly horizon_ms: number;
  readonly max_records: number;
  readonly late_arrival: 'recompute' | 'quarantine';
  readonly ingest_clock: IngestClockDescriptor;
  /** The rolling window in arrival order (admitted records only). */
  readonly window: readonly TimeMachineRecord[];
  /** The availability frontier after the last ingest (null when nothing was ever admitted). */
  readonly frontier: TimestampMs | null;
  /** Total records ever admitted (the arrival/stamp counter). */
  readonly ingest_count: number;
  /** Every record id ever admitted (append-only identity outlives the window — exact restore). */
  readonly admitted_ids: readonly string[];
  /** The 1-based ordinal the NEXT ingest batch will receive. */
  readonly batch_ordinal: number;
  /** The 1-based ordinal the NEXT opened cursor will receive (cursor ids are deterministic). */
  readonly cursor_ordinal: number;
  readonly quarantine: readonly unknown[];
  readonly rejections: readonly unknown[];
  readonly cursors: readonly CursorSnapshotEntry[];
  readonly lineage_hash: SnapshotHash;
}

/** The hashable content of a snapshot (everything except the hash itself). */
function snapshotContent(snapshot: Omit<TimeMachineSnapshot, 'lineage_hash'>): unknown {
  return {
    kind: snapshot.kind,
    dataset: snapshot.dataset,
    tenant: snapshot.tenant,
    horizon_ms: snapshot.horizon_ms,
    max_records: snapshot.max_records,
    late_arrival: snapshot.late_arrival,
    ingest_clock: snapshot.ingest_clock,
    window: snapshot.window.map((record) => record),
    frontier: snapshot.frontier,
    ingest_count: snapshot.ingest_count,
    admitted_ids: snapshot.admitted_ids,
    batch_ordinal: snapshot.batch_ordinal,
    cursor_ordinal: snapshot.cursor_ordinal,
    quarantine: snapshot.quarantine,
    rejections: snapshot.rejections,
    cursors: snapshot.cursors,
  };
}

/**
 * Seal a snapshot: compute the lineage hash over the content and freeze the
 * whole structure. Used by the machine's `snapshot()`; pure.
 */
export function sealSnapshot(content: Omit<TimeMachineSnapshot, 'lineage_hash'>): TimeMachineSnapshot {
  const hash = hashOf(snapshotContent(content)) as SnapshotHash;
  const snapshot: TimeMachineSnapshot = { ...content, lineage_hash: hash };
  return deepFreezeSnapshot(snapshot);
}

/** Deeply freeze a snapshot in place (records already frozen stay shared). */
function deepFreezeSnapshot(snapshot: TimeMachineSnapshot): TimeMachineSnapshot {
  return deepFreeze(snapshot);
}

/** Guard for a cursor snapshot entry. */
function isCursorSnapshotEntry(value: unknown): value is CursorSnapshotEntry {
  if (!isRecord(value)) return false;
  if (typeof value.cursor_id !== 'string' || value.cursor_id.length === 0) return false;
  if (!isNonNegativeSafeInteger(value.position)) return false;
  if (value.last_drain_at !== null && !isTimestampMs(value.last_drain_at)) return false;
  return validateProjectionSelector(value.selector).ok;
}

/** Guard for the ingest-clock descriptor. */
function isIngestClockDescriptor(value: unknown): value is IngestClockDescriptor {
  if (!isRecord(value)) return false;
  if (value.kind === 'injected') return true;
  if (value.kind !== 'builtin-stepping') return false;
  return isTimestampMs(value.base) && typeof value.step_ms === 'number' && Number.isSafeInteger(value.step_ms) && value.step_ms >= 1;
}

/** Guard for a quarantined-event entry (machine-domain shape). */
export function isQuarantinedEventEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.reason !== 'late_arrival') return false;
  if (!isNonNegativeSafeInteger(value.late_by)) return false;
  if (!isTimestampMs(value.frontier_at_quarantine)) return false;
  if (typeof value.batch_id !== 'string' || value.batch_id.length === 0) return false;
  if (!isNonNegativeSafeInteger(value.batch_ordinal)) return false;
  const event = value.event;
  if (!isRecord(event)) return false;
  if (typeof event.event_id !== 'string' || event.event_id.length === 0) return false;
  if (!isTimestampMs(event.event_time)) return false;
  if (event.source_time !== null && !isTimestampMs(event.source_time)) return false;
  if (!isTimestampMs(event.available_time)) return false;
  if (!isTimestampMs(event.ingestion_time)) return false;
  if (!isNonNegativeSafeInteger(event.sequence)) return false;
  const provenance = event.provenance;
  if (!isRecord(provenance) || !isEventOrigin(provenance.origin)) return false;
  return true;
}

/** Guard for a rejection-record entry (machine-domain shape). */
export function isRejectionRecordEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.event_id !== null && typeof value.event_id !== 'string') return false;
  if (typeof value.batch_id !== 'string' || value.batch_id.length === 0) return false;
  if (!isNonNegativeSafeInteger(value.batch_ordinal)) return false;
  if (typeof value.code !== 'string' || value.code.length === 0) return false;
  if (typeof value.message !== 'string' || value.message.length === 0) return false;
  if (value.errors !== undefined && !Array.isArray(value.errors)) return false;
  return true;
}

/** The validated, hash-checked parts of a snapshot, ready for machine reconstruction. */
export interface ValidatedSnapshot {
  readonly content: Omit<TimeMachineSnapshot, 'lineage_hash'>;
  readonly lineage_hash: SnapshotHash;
  /** The full built-in clock state when the snapshot carries one (consumed pre-checked). */
  readonly builtinClock: DeterministicClockState | null;
}

/**
 * Validate a snapshot end-to-end: structural guards over every field and
 * entry, cross-field invariants (window bounds, arrival-sequence
 * monotonicity, cursor positions), and the recomputed lineage hash. Typed
 * failures: `invalid_snapshot` (shape) and `snapshot_mismatch` (hash).
 */
export function validateTimeMachineSnapshot(value: unknown): TimeMachineResult<ValidatedSnapshot> {
  if (!isRecord(value)) {
    return fail('invalid_snapshot', 'a time-machine snapshot must be an object');
  }
  if (value.kind !== SNAPSHOT_KIND) {
    return fail('invalid_snapshot', `the snapshot discriminator must be "${SNAPSHOT_KIND}"`);
  }
  if (!isDatasetRef(value.dataset)) {
    return fail('invalid_snapshot', 'snapshot.dataset must be a non-empty dataset reference');
  }
  if (!isTenantId(value.tenant)) {
    return fail('invalid_snapshot', 'snapshot.tenant must be a non-empty tenant id');
  }
  if (typeof value.horizon_ms !== 'number' || !Number.isSafeInteger(value.horizon_ms) || value.horizon_ms < 0) {
    return fail('invalid_snapshot', 'snapshot.horizon_ms must be a non-negative safe integer');
  }
  if (typeof value.max_records !== 'number' || !Number.isSafeInteger(value.max_records) || value.max_records < 1) {
    return fail('invalid_snapshot', 'snapshot.max_records must be a positive safe integer');
  }
  if (value.late_arrival !== 'recompute' && value.late_arrival !== 'quarantine') {
    return fail('invalid_snapshot', 'snapshot.late_arrival must be "recompute" or "quarantine"');
  }
  if (!isIngestClockDescriptor(value.ingest_clock)) {
    return fail('invalid_snapshot', 'snapshot.ingest_clock must be a valid clock descriptor');
  }
  if (!Array.isArray(value.window)) {
    return fail('invalid_snapshot', 'snapshot.window must be an array of records');
  }
  if (value.frontier !== null && !isTimestampMs(value.frontier)) {
    return fail('invalid_snapshot', 'snapshot.frontier must be a valid timestamp or null');
  }
  if (!isNonNegativeSafeInteger(value.ingest_count)) {
    return fail('invalid_snapshot', 'snapshot.ingest_count must be a non-negative safe integer');
  }
  if (!Array.isArray(value.admitted_ids)) {
    return fail('invalid_snapshot', 'snapshot.admitted_ids must be an array of record ids');
  }
  const admittedIds = new Set<string>();
  for (const id of value.admitted_ids) {
    if (typeof id !== 'string' || id.length === 0) {
      return fail('invalid_snapshot', 'every snapshot.admitted_ids entry must be a non-empty record id');
    }
    if (admittedIds.has(id)) {
      return fail('invalid_snapshot', `duplicate admitted id "${id}"`);
    }
    admittedIds.add(id);
  }
  if (admittedIds.size !== value.ingest_count) {
    return fail('invalid_snapshot', 'snapshot.admitted_ids must contain exactly one id per admitted record (ingest_count)');
  }
  if (!isNonNegativeSafeInteger(value.batch_ordinal)) {
    return fail('invalid_snapshot', 'snapshot.batch_ordinal must be a non-negative safe integer');
  }
  if (!isNonNegativeSafeInteger(value.cursor_ordinal)) {
    return fail('invalid_snapshot', 'snapshot.cursor_ordinal must be a non-negative safe integer');
  }
  if (!Array.isArray(value.quarantine)) {
    return fail('invalid_snapshot', 'snapshot.quarantine must be an array');
  }
  if (!Array.isArray(value.rejections)) {
    return fail('invalid_snapshot', 'snapshot.rejections must be an array');
  }
  if (!Array.isArray(value.cursors)) {
    return fail('invalid_snapshot', 'snapshot.cursors must be an array');
  }
  if (!isLineageHash(value.lineage_hash)) {
    return fail('invalid_snapshot', 'snapshot.lineage_hash must be an 8-8 dashed lowercase-hex checksum');
  }

  // Window: record guards + arrival-sequence monotonicity + identity + bounds.
  let previousArrival = -1;
  const seenIds = new Set<string>();
  for (const record of value.window) {
    if (!isTimeMachineRecord(record)) {
      return fail('invalid_snapshot', 'every snapshot.window entry must be a structurally valid record');
    }
    if (record.arrival_sequence <= previousArrival) {
      return fail('invalid_snapshot', 'snapshot.window arrival sequences must be strictly increasing');
    }
    previousArrival = record.arrival_sequence;
    if (seenIds.has(record.record_id)) {
      return fail('invalid_snapshot', `duplicate record id "${record.record_id}" in snapshot.window`);
    }
    seenIds.add(record.record_id);
    if (!admittedIds.has(record.record_id)) {
      return fail('invalid_snapshot', `window record "${record.record_id}" is not in admitted_ids`);
    }
    if (record.arrival_sequence >= value.ingest_count) {
      return fail('invalid_snapshot', 'a window record arrival sequence exceeds ingest_count');
    }
    if (record.tenant !== value.tenant) {
      return fail('invalid_snapshot', `record "${record.record_id}" tenant does not match the snapshot tenant (L12)`);
    }
  }
  if (value.window.length > value.max_records) {
    return fail('invalid_snapshot', 'snapshot.window exceeds max_records (the memory bound is invariant)');
  }
  if (value.frontier !== null && value.window.length > 0) {
    // The horizon invariant: after eviction, every retained record has
    // available_time >= frontier - horizon (inclusive floor).
    const floor = Math.max(0, value.frontier - value.horizon_ms);
    for (const record of value.window) {
      if (record.available_time < floor) {
        return fail('invalid_snapshot', `record "${record.record_id}" predates the horizon floor (the rolling invariant)`);
      }
    }
  }

  // Exception queues + cursors.
  if (!value.quarantine.every((entry) => isQuarantinedEventEntry(entry))) {
    return fail('invalid_snapshot', 'every snapshot.quarantine entry must be a declared quarantined event');
  }
  if (!value.rejections.every((entry) => isRejectionRecordEntry(entry))) {
    return fail('invalid_snapshot', 'every snapshot.rejections entry must be a declared rejection record');
  }
  const cursorIds = new Set<string>();
  for (const entry of value.cursors) {
    if (!isCursorSnapshotEntry(entry)) {
      return fail('invalid_snapshot', 'every snapshot.cursors entry must be a valid cursor position');
    }
    if (cursorIds.has(entry.cursor_id)) {
      return fail('invalid_snapshot', `duplicate cursor id "${entry.cursor_id}"`);
    }
    cursorIds.add(entry.cursor_id);
    if (entry.position > value.ingest_count) {
      return fail('invalid_snapshot', `cursor "${entry.cursor_id}" position exceeds ingest_count`);
    }
  }

  // The builtin clock state consistency (stamps consumed == admitted count).
  let builtinClock: DeterministicClockState | null = null;
  if (value.ingest_clock.kind === 'builtin-stepping') {
    builtinClock = {
      kind: 'builtin-stepping',
      base: value.ingest_clock.base,
      step_ms: value.ingest_clock.step_ms,
      consumed: value.ingest_count,
    };
    if (!isDeterministicClockState(builtinClock)) {
      return fail('invalid_snapshot', 'the builtin clock descriptor is not a valid deterministic clock state');
    }
  }

  // The lineage hash: recompute over the content and compare.
  const content: Omit<TimeMachineSnapshot, 'lineage_hash'> = {
    kind: value.kind,
    dataset: value.dataset,
    tenant: value.tenant,
    horizon_ms: value.horizon_ms,
    max_records: value.max_records,
    late_arrival: value.late_arrival,
    ingest_clock: value.ingest_clock,
    window: Object.freeze([...value.window]),
    frontier: value.frontier,
    ingest_count: value.ingest_count,
    admitted_ids: Object.freeze([...(value.admitted_ids as readonly string[])]),
    batch_ordinal: value.batch_ordinal,
    cursor_ordinal: value.cursor_ordinal,
    quarantine: Object.freeze([...value.quarantine]),
    rejections: Object.freeze([...value.rejections]),
    cursors: Object.freeze([...(value.cursors as CursorSnapshotEntry[])]),
  };
  const recomputed = hashOf(snapshotContent(content)) as SnapshotHash;
  if (recomputed !== value.lineage_hash) {
    return fail(
      'snapshot_mismatch',
      `the recomputed lineage hash ${recomputed} does not match the recorded ${value.lineage_hash} — the snapshot is tampered or corrupt`,
    );
  }

  return ok({ content, lineage_hash: value.lineage_hash, builtinClock });
}
