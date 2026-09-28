/**
 * @tradrl/data-ingestion — the ingestion pipeline.
 *
 * adapter -> validate (quartet + sequence + provenance) -> batch -> commit
 * to the event store, with a dead-letter queue for rejected events with
 * typed reasons — NOTHING IS SILENTLY DROPPED.
 *
 * The pipeline is provider-neutral (L13/L14): it works against the
 * {@link ProviderAdapter} interface and an {@link EventCommitPort} — a
 * STRUCTURAL port that `@tradrl/event-store`'s `EventStore` satisfies
 * without any package dependency (law D-004: the mirror discipline; the
 * wiring is proven by the behavioral suite in
 * `packages/provenance/src/data-ingestion.test.ts`).
 *
 * Per batch, in order (deterministic):
 *   1. `adapter.fetch(batch)` — raw records.
 *   2. `adapter.normalize(raw)` per record — normalization errors go to
 *      the DLQ; normalized events are validated (quartet + ids + taxonomy
 *      + provenance) — invalid events go to the DLQ.
 *   3. Within-batch sequence pre-check (mirror of T004's array
 *      semantics) — violators go to the DLQ.
 *   4. Commit the survivors to the store as ONE batch. A commit is atomic:
 *      on rejection the named offenders go to the DLQ and the remainder is
 *      re-committed (bounded loop — every iteration removes at least one
 *      event or stops); a rejection that names no specific event dead-
 *      letters everything remaining from that batch.
 */

import type { AdapterDescriptor, FetchBatch, ProviderAdapter } from './adapter';
import { validateCanonicalEvent, type CanonicalEvent } from './canonical-event';
import { validateBatchSequences } from './sequence';
import { isNonEmptyString, isRecord, sequenceViolation, type ValidationFailure } from './fields';
import { deadLetterReportOf, type DeadLetter, type DeadLetterReport, type StoreRejectionError } from './dlq';

// ---------------------------------------------------------------------------
// The commit port (structural — @tradrl/event-store satisfies it).
// ---------------------------------------------------------------------------

/** A successful commit as seen through the port. */
export interface CommitPortReceipt {
  readonly commit_id: string;
  readonly commit_sequence: number;
  readonly batch_id: string;
  readonly committed_event_ids: readonly string[];
}

/** A store rejection error as seen through the port. */
export interface CommitPortError {
  readonly code: string;
  readonly event_id: string | null;
  readonly index: number;
  readonly message: string;
  readonly details: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}

/** The commit outcome as seen through the port. */
export type CommitPortResult =
  | { readonly ok: true; readonly receipt: CommitPortReceipt }
  | { readonly ok: false; readonly rejection: { readonly errors: readonly CommitPortError[] } };

/** The batch metadata the port accepts. */
export interface CommitPortBatch {
  readonly batch_id: string;
  readonly source?: string;
}

/**
 * The structural port the pipeline commits through. `@tradrl/event-store`'s
 * `EventStore` (or any append-only store with the same commit surface)
 * satisfies this interface structurally — no import, no dependency.
 */
export interface EventCommitPort {
  commit(events: readonly CanonicalEvent[], batch: CommitPortBatch): CommitPortResult;
}

// ---------------------------------------------------------------------------
// Reports.
// ---------------------------------------------------------------------------

/** The ingestion outcome of one batch. */
export interface BatchIngestionReport {
  readonly batch_id: string;
  readonly adapter_id: string;
  readonly raw_records: number;
  /** Events that survived normalization + envelope validation. */
  readonly normalized_events: number;
  readonly events_committed: number;
  readonly events_rejected: number;
  /** The receipt of the (final, successful) commit; null when nothing was committable. */
  readonly receipt: CommitPortReceipt | null;
}

/** The ingestion outcome of the whole discovery. */
export interface IngestionSummary {
  readonly batches: readonly BatchIngestionReport[];
  readonly total_committed: number;
  readonly total_rejected: number;
  readonly receipts: readonly CommitPortReceipt[];
}

/** The pipeline. */
export interface IngestionPipeline<Raw = unknown> {
  /** Ingest one discovered batch (deterministic). */
  ingestBatch(batch: FetchBatch): BatchIngestionReport;
  /** Discover and ingest every batch, in discovery order. */
  ingestAll(): IngestionSummary;
  /** Every dead letter so far, in rejection order (defensive copy, frozen). */
  deadLetters(): readonly DeadLetter[];
  /** An exact report of the DLQ contents — matches exactly what was rejected. */
  deadLetterReport(): DeadLetterReport;
  /** The adapter this pipeline ingests from. */
  adapter(): AdapterDescriptor;
}

/** Pipeline configuration. */
export interface IngestionPipelineConfig<Raw> {
  readonly adapter: ProviderAdapter<Raw>;
  readonly store: EventCommitPort;
}

/** Read an event_id off an untrusted candidate event (null when unreadable). */
function eventIdOf(candidate: unknown): string | null {
  return isRecord(candidate) && isNonEmptyString(candidate.event_id) ? candidate.event_id : null;
}

/** Deep-freeze helper for the pipeline's defensive copies. */
function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

export function createIngestionPipeline<Raw>(config: IngestionPipelineConfig<Raw>): IngestionPipeline<Raw> {
  const adapter = config.adapter;
  const store = config.store;
  const letters: DeadLetter[] = [];

  const ingestBatch = (batch: FetchBatch): BatchIngestionReport => {
    const batchId = batch.batch_id;
    const adapterId = adapter.descriptor.id;
    const rejectedBefore = letters.length;

    // 1. Fetch.
    const fetched = adapter.fetch(batch);
    const rawRecords = fetched.records;

    // 2. Normalize + validate per raw record.
    const valid: CanonicalEvent[] = [];
    for (const raw of rawRecords) {
      const normalized = adapter.normalize(raw);
      for (const error of normalized.errors) {
        letters.push({
          kind: 'normalization_error',
          batch_id: batchId,
          adapter_id: adapterId,
          raw_id: error.raw_id,
          errors: [error],
        });
      }
      for (const candidate of normalized.events) {
        const validation = validateCanonicalEvent(candidate);
        if (validation.ok) {
          valid.push(candidate);
        } else {
          letters.push({
            kind: 'validation_error',
            batch_id: batchId,
            adapter_id: adapterId,
            event_id: eventIdOf(candidate),
            errors: validation.errors,
          });
        }
      }
    }

    // 3. Within-batch sequence pre-check (T004 array semantics).
    const sequenceValidation = validateBatchSequences(valid);
    const violationsByEvent = new Map<string, ValidationFailure[]>();
    for (const violation of sequenceValidation.violations) {
      const existing = violationsByEvent.get(violation.eventId) ?? [];
      existing.push(
        sequenceViolation(
          violation.kind,
          violation.key,
          `sequence ${violation.sequence} at index ${violation.index} (${violation.kind === 'duplicate_sequence' ? 'duplicate' : 'regression'} vs index ${violation.previousIndex})`,
        ),
      );
      violationsByEvent.set(violation.eventId, existing);
    }
    const survivors: CanonicalEvent[] = [];
    for (const event of valid) {
      const failures = violationsByEvent.get(event.event_id);
      if (failures === undefined) {
        survivors.push(event);
      } else {
        letters.push({
          kind: 'validation_error',
          batch_id: batchId,
          adapter_id: adapterId,
          event_id: event.event_id,
          errors: failures,
        });
      }
    }

    // 4. Commit loop (atomic batches; named offenders dead-lettered; retry the rest).
    let toCommit: CanonicalEvent[] = survivors;
    let receipt: CommitPortReceipt | null = null;
    const commitBatch: CommitPortBatch = {
      batch_id: batchId,
      source: `${adapter.descriptor.id}@${adapter.descriptor.version}`,
    };
    let guard = 0;
    const guardLimit = survivors.length + 1;
    while (toCommit.length > 0 && guard <= guardLimit) {
      guard += 1;
      const result = store.commit(toCommit, commitBatch);
      if (result.ok) {
        receipt = result.receipt;
        break;
      }

      // Group the rejection errors by the event they name.
      const errorsByEvent = new Map<string, StoreRejectionError[]>();
      const unattributed: StoreRejectionError[] = [];
      for (const error of result.rejection.errors) {
        let eventId = error.event_id;
        if (eventId === null && error.index >= 0) {
          const indexed = toCommit[error.index];
          if (indexed !== undefined) eventId = indexed.event_id;
        }
        if (eventId !== null) {
          const existing = errorsByEvent.get(eventId) ?? [];
          existing.push(error as StoreRejectionError);
          errorsByEvent.set(eventId, existing);
        } else {
          unattributed.push(error as StoreRejectionError);
        }
      }

      const offenderIds = new Set<string>();
      for (const [eventId, errors] of errorsByEvent) {
        letters.push({
          kind: 'store_rejection',
          batch_id: batchId,
          adapter_id: adapterId,
          event_id: eventId,
          errors,
        });
        offenderIds.add(eventId);
      }
      if (unattributed.length > 0) {
        // A rejection that names no specific event dead-letters everything
        // remaining from this batch — nothing is silently dropped.
        for (const event of toCommit) {
          if (offenderIds.has(event.event_id)) continue;
          letters.push({
            kind: 'store_rejection',
            batch_id: batchId,
            adapter_id: adapterId,
            event_id: event.event_id,
            errors: unattributed,
          });
          offenderIds.add(event.event_id);
        }
      }
      toCommit = toCommit.filter((event) => !offenderIds.has(event.event_id));
    }

    const rejectedThisBatch = letters.length - rejectedBefore;
    return {
      batch_id: batchId,
      adapter_id: adapterId,
      raw_records: rawRecords.length,
      normalized_events: valid.length,
      events_committed: receipt !== null ? receipt.committed_event_ids.length : 0,
      events_rejected: rejectedThisBatch,
      receipt,
    };
  };

  const ingestAll = (): IngestionSummary => {
    const discovery = adapter.discover();
    const batches: BatchIngestionReport[] = [];
    const receipts: CommitPortReceipt[] = [];
    let totalCommitted = 0;
    let totalRejected = 0;
    for (const batch of discovery.batches) {
      const report = ingestBatch(batch);
      batches.push(report);
      if (report.receipt !== null) receipts.push(report.receipt);
      totalCommitted += report.events_committed;
      totalRejected += report.events_rejected;
    }
    return {
      batches: freezeArray(batches),
      total_committed: totalCommitted,
      total_rejected: totalRejected,
      receipts: freezeArray(receipts),
    };
  };

  return {
    ingestBatch,
    ingestAll,
    deadLetters: () => freezeArray(letters),
    deadLetterReport: () => deadLetterReportOf(letters),
    adapter: () => adapter.descriptor,
  };
}
