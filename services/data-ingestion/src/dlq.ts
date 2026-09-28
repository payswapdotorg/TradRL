/**
 * @tradrl/data-ingestion — the dead-letter queue.
 *
 * NOTHING IS SILENTLY DROPPED: every record an adapter delivers either
 * lands in the event store or in the dead-letter queue with a TYPED
 * reason. A dead letter records WHERE the rejection happened:
 *
 *   - `normalization_error` — the adapter could not translate the raw
 *     record (typed adapter errors).
 *   - `validation_error`    — the normalized event failed the ingestion
 *     plane's envelope validation (quartet/ids/taxonomy/provenance) or
 *     the within-batch sequence pre-check.
 *   - `store_rejection`     — the event store rejected the event at
 *     commit (duplicate id, sequence violation vs committed state, cyclic
 *     lineage, derived-before-parents, ...).
 *
 * The report is exact: `deadLetterReport().letters` matches one-to-one
 * the rejected records, in rejection order.
 */

import type { NormalizationError } from './adapter';
import type { ValidationFailure } from './fields';

/** A field-level error as reported by the store's rejection (opaque at the port). */
export interface StoreRejectionDetail {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** A store commit rejection as seen through the commit port. */
export interface StoreRejectionError {
  readonly code: string;
  readonly event_id: string | null;
  readonly index: number;
  readonly message: string;
  readonly details: readonly StoreRejectionDetail[];
}

/** One dead letter: a rejected record with its typed reason. */
export type DeadLetter =
  | {
      readonly kind: 'normalization_error';
      readonly batch_id: string;
      readonly adapter_id: string;
      readonly raw_id: string;
      readonly errors: readonly NormalizationError[];
    }
  | {
      readonly kind: 'validation_error';
      readonly batch_id: string;
      readonly adapter_id: string;
      readonly event_id: string | null;
      readonly errors: readonly ValidationFailure[];
    }
  | {
      readonly kind: 'store_rejection';
      readonly batch_id: string;
      readonly adapter_id: string;
      readonly event_id: string | null;
      readonly errors: readonly StoreRejectionError[];
    };

/** The kinds of dead letters, keyed for the report. */
export type DeadLetterKind = DeadLetter['kind'];

/** An exact report of the DLQ contents. */
export interface DeadLetterReport {
  readonly total: number;
  readonly by_kind: Readonly<Record<DeadLetterKind, number>>;
  /** Every dead letter in rejection order — matches exactly what was rejected. */
  readonly letters: readonly DeadLetter[];
}

/** Build a report over a dead-letter list (pure). */
export function deadLetterReportOf(letters: readonly DeadLetter[]): DeadLetterReport {
  const byKind: Record<DeadLetterKind, number> = {
    normalization_error: 0,
    validation_error: 0,
    store_rejection: 0,
  };
  for (const letter of letters) byKind[letter.kind] += 1;
  return { total: letters.length, by_kind: byKind, letters: Object.freeze([...letters]) };
}
