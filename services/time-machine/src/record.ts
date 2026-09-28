/**
 * @tradrl/time-machine — the rolling-window record (Work Order T029).
 *
 * The T026 `KnowledgeRecord` contract, STRUCTURALLY MIRRORED (law D-004;
 * vendored trip-wire in `src/t026-reference/mirrors.ts`), EXTENDED with the
 * rolling-window bookkeeping this lane owns:
 *
 *   THE AVAILABILITY QUARTET (mirrors the market-protocol envelope contract):
 *   - `event_time`      — when the knowledge came to be in the world.
 *   - `source_time`     — when the source says it happened (null when the
 *                         source does not say). ADVISORY: no ordering enforced.
 *   - `available_time`  — the earliest an agent may legitimately observe it.
 *                         THE information-boundary input (L4). Enforced:
 *                         `available_time >= event_time` — D-003 quartet
 *                         ordering (the ONLY enforced ordering; ingestion_time
 *                         is deliberately unordered: embargo before, backfill
 *                         after are both legitimate).
 *   - `ingestion_time`  — when the machine admitted it — the STAMPED
 *                         admission time from the injected ingest clock
 *                         (never earlier; never rewrites available_time).
 *
 *   THE KNOWLEDGE GRAPH: `inputs` (parent RECORD ids; empty for primitive
 *   knowledge) and `computation` ({transform_id, delay} REQUIRED iff inputs
 *   non-empty — the delay is declared ZERO at this layer: availability
 *   propagation happened upstream, enforced by the T008 store before the
 *   event reached this machine; the quartet is authoritative).
 *
 *   THE ISOLATION + LINEAGE: `tenant` (L12) and `provenance` (the T008-shaped
 *   stored block with custody stamped at admission).
 *
 *   THE ROLLING EXTENSION (additive, firewall-transparent — the T026 guard
 *   tolerates extra fields by design, "the contract is a floor"):
 *   - `arrival_sequence` — the 0-based admission ordinal (ingestion order;
 *     the deterministic position axis for cursors).
 *
 * Records are immutable: the admission builder validates and deeply freezes.
 */

import { isTimestampMs, type TimestampMs } from './timestamp';
import { isDuration } from './duration';
import type { ComputationPolicy } from './computation';
import { deepFreeze } from './freeze';
import { fail, ok, type TimeMachineResult } from './errors';
import { isKnowledgeRecordId, isTenantId, type KnowledgeRecordId, type TenantId } from './ids';
import { isMachineProvenance, validateIngestionProvenance, type MachineProvenance } from './provenance';
import { isCanonicalEvent, isNonNegativeSafeInteger, isRecord, type CanonicalEvent } from './canonical-event';

/**
 * One unit of rolling knowledge policed by the firewall. The payload is
 * opaque and JSON-representable (carried verbatim, never interpreted here);
 * the firewall polices the quartet, the lineage, the policy and the tenant.
 */
export interface TimeMachineRecord {
  /** Opaque identity (the canonical event's event_id; append-only identity). */
  readonly record_id: KnowledgeRecordId;
  /** Owning tenant (L12 — cross-tenant reads and derivations are rejected). */
  readonly tenant: TenantId;
  /** Opaque JSON-representable payload. Never interpreted by the machine. */
  readonly payload: unknown;
  /** When the knowledge came to be in the world. */
  readonly event_time: TimestampMs;
  /** When the source says it happened, when the source says. Advisory. */
  readonly source_time: TimestampMs | null;
  /** Earliest legitimate observation — THE L4 boundary input. */
  readonly available_time: TimestampMs;
  /** When the machine admitted it (stamped from the injected ingest clock). */
  readonly ingestion_time: TimestampMs;
  /** Knowledge-graph parents. Empty for primitive knowledge. */
  readonly inputs: readonly KnowledgeRecordId[];
  /** Computation policy. REQUIRED non-null iff `inputs` is non-empty. */
  readonly computation: ComputationPolicy | null;
  /** T008-shaped stored provenance (custody stamped at admission). */
  readonly provenance: MachineProvenance;
  /** 0-based admission ordinal — the deterministic ingestion-order axis. */
  readonly arrival_sequence: number;
}

/** A payload is opaque but must be JSON-representable (records are serializable). */
function isOpaquePayload(value: unknown): boolean {
  if (value === null) return true;
  const kind = typeof value;
  return kind === 'object' || kind === 'boolean' || kind === 'number' || kind === 'string';
}

/**
 * Structural runtime guard for a single TimeMachineRecord (quartet ordering,
 * lineage self-consistency, computation-iff-inputs, provenance shape,
 * arrival shape). Cross-record invariants (parent resolution, propagation
 * floor, duplicate identity) are enforced at admission time by the machine.
 */
export function isTimeMachineRecord(value: unknown): value is TimeMachineRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (!isKnowledgeRecordId(candidate.record_id)) return false;
  if (!isTenantId(candidate.tenant)) return false;
  if (!isOpaquePayload(candidate.payload)) return false;

  if (!isTimestampMs(candidate.event_time)) return false;
  if (candidate.source_time !== null && !isTimestampMs(candidate.source_time)) return false;
  if (!isTimestampMs(candidate.available_time)) return false;
  if (!isTimestampMs(candidate.ingestion_time)) return false;
  // D-003 quartet ordering: the one enforced ordering.
  if ((candidate.available_time as number) < (candidate.event_time as number)) return false;

  if (!Array.isArray(candidate.inputs)) return false;
  const seen = new Set<string>();
  for (const input of candidate.inputs) {
    if (!isKnowledgeRecordId(input)) return false;
    if (input === candidate.record_id) return false; // no self-reference
    if (seen.has(input)) return false; // no duplicate parents
    seen.add(input);
  }

  const derived = candidate.inputs.length > 0;
  if (derived && !isComputationPolicy(candidate.computation)) return false;
  if (!derived && candidate.computation !== null) return false;

  if (!isMachineProvenance(candidate.provenance)) return false;

  if (!isNonNegativeSafeInteger(candidate.arrival_sequence)) return false;

  return true;
}

/** Guard re-export (the computation policy lives in its own module). */
import { isComputationPolicy } from './computation';

/** Deterministic admission commit id from the admission batch ordinal (mirror of T008's commitIdFor). */
export function admissionCommitIdFor(batchOrdinal: number): string {
  return `tmc-${String(batchOrdinal).padStart(8, '0')}`;
}

/** The stamped facts the machine contributes at admission. */
export interface AdmissionStamp {
  /** The admission batch's ordinal (1-based, monotone per ingestBatch call). */
  readonly batch_ordinal: number;
  /** The ingest-batch id declared by the ingestor. */
  readonly batch_id: string;
  /** The definitive ingestion timestamp stamped from the injected clock. */
  readonly ingestion_time: TimestampMs;
  /** The 0-based admission ordinal of this record. */
  readonly arrival_sequence: number;
}

/** Runtime guard for an admission stamp. */
export function isAdmissionStamp(value: unknown): value is AdmissionStamp {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.batch_ordinal !== 'number' ||
    !Number.isSafeInteger(candidate.batch_ordinal) ||
    candidate.batch_ordinal < 1
  ) {
    return false;
  }
  if (typeof candidate.batch_id !== 'string' || candidate.batch_id.length === 0) return false;
  if (!isTimestampMs(candidate.ingestion_time)) return false;
  if (!isNonNegativeSafeInteger(candidate.arrival_sequence)) return false;
  return true;
}

/**
 * Admit one canonical event as a TimeMachineRecord: stamps the quartet's
 * ingestion_time, stamps custody (adapter -> batch -> commit), mirrors the
 * knowledge-graph edges, declares the zero computation delay for derived
 * knowledge, and deeply freezes the result. The event's own quartet fields
 * (event_time, source_time, available_time) are carried VERBATIM — admission
 * never rewrites them.
 *
 * The input must ALREADY be a validated CanonicalEvent (the machine's ingest
 * path validates first; this builder asserts the shape defensively anyway).
 */
export function admitCanonicalEvent(
  event: CanonicalEvent,
  tenant: TenantId,
  stamp: AdmissionStamp,
): TimeMachineResult<TimeMachineRecord> {
  if (!isCanonicalEvent(event)) {
    return fail('invalid_event', 'admission requires a validated canonical event');
  }
  if (!isTenantId(tenant)) {
    return fail('invalid_config', 'admission requires a valid tenant id');
  }
  if (!isRecord(event)) {
    return fail('invalid_event', 'admission requires a validated canonical event');
  }
  if (typeof stamp.batch_ordinal !== 'number' || !Number.isSafeInteger(stamp.batch_ordinal) || stamp.batch_ordinal < 1) {
    return fail('invalid_event', 'the admission stamp batch ordinal must be a positive safe integer');
  }
  if (!isNonNegativeSafeInteger(stamp.arrival_sequence)) {
    return fail('invalid_event', 'the admission stamp arrival sequence must be a non-negative safe integer');
  }
  if (typeof stamp.batch_id !== 'string' || stamp.batch_id.length === 0) {
    return fail('invalid_event', 'the admission stamp batch id must be a non-empty string');
  }
  if (!isTimestampMs(stamp.ingestion_time)) {
    return fail('invalid_ingest_clock', 'the ingest clock produced an invalid admission stamp');
  }

  const derived = event.provenance.derived_from.length > 0;
  const provenance: MachineProvenance = {
    origin: event.provenance.origin,
    adapter: event.provenance.adapter,
    derived_from: Object.freeze([...event.provenance.derived_from]),
    transform: event.provenance.transform,
    corrections: Object.freeze([]),
    custody: deepFreeze({
      adapter: event.provenance.adapter,
      batch: { batch_id: stamp.batch_id },
      commit: {
        commit_id: admissionCommitIdFor(stamp.batch_ordinal),
        commit_sequence: stamp.batch_ordinal,
        ingestion_time: stamp.ingestion_time,
      },
    }),
  };

  const record: TimeMachineRecord = {
    record_id: event.event_id as KnowledgeRecordId,
    tenant,
    payload: event.payload,
    event_time: event.event_time,
    source_time: event.source_time,
    available_time: event.available_time,
    ingestion_time: stamp.ingestion_time,
    inputs: Object.freeze([...(event.provenance.derived_from as readonly KnowledgeRecordId[])]),
    computation: derived
      ? Object.freeze({ transform_id: event.provenance.transform as string, delay: Object.freeze({}) })
      : null,
    provenance: deepFreeze(provenance),
    arrival_sequence: stamp.arrival_sequence,
  };
  return ok(deepFreeze(record) as TimeMachineRecord);
}

/** Re-validate a record's provenance block against the ingestion rules (forensic use). */
export function recordProvenanceErrors(record: TimeMachineRecord): readonly import('./canonical-event').ValidationFailure[] {
  return validateIngestionProvenance(
    {
      origin: record.provenance.origin,
      adapter: record.provenance.adapter,
      derived_from: record.provenance.derived_from,
      transform: record.provenance.transform,
    },
    record.record_id,
  );
}
