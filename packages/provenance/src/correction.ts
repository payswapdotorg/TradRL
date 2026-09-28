/**
 * @tradrl/provenance — correction records (append-only amendments).
 *
 * A correction is an AMENDMENT issued against a committed event: it
 * references the corrected event, states a reason and carries an opaque
 * JSON amendment payload. Corrections NEVER mutate history — they are
 * appended to a correction log, and queries return the LATEST correction
 * status per event (the newest amendment wins; superseded amendments remain
 * visible as history). This is the append-only discipline applied to the
 * truth-maintenance problem: the store's answer to "what do we now believe
 * about event X" is a VIEW over immutable history, never a rewrite.
 *
 * The store stamps a custody chain on each stored correction (it knows the
 * batch and the commit that accepted it), so amendments are as auditable as
 * the events they amend.
 */

import { invalidField, isNonEmptyString, isRecord, missingField, type CorrectionId, type CorrectionReason, type EventId } from './fields';
import type { ProvenanceError } from './errors';
import { isJsonObject, type JsonObject } from './json';
import { isCustodyChain, validateCustodyChain, type CustodyChain } from './custody';

/**
 * A correction as it ENTERS the store (pre-custody): the amendment content.
 * The store validates it and stamps custody at append time.
 */
export interface CorrectionInput {
  readonly correction_id: CorrectionId;
  readonly corrected_event_id: EventId;
  readonly reason: CorrectionReason;
  readonly amendment: JsonObject;
}

/**
 * A stored correction: the input amendment plus the custody chain stamped
 * at append. Structurally, a full store-level record.
 */
export interface CorrectionRecord extends CorrectionInput {
  /** adapter -> ingestion batch -> store commit (stamped at append). */
  readonly custody: CustodyChain;
}

/** Runtime guard for the correction id (opaque non-empty string). */
export function isCorrectionId(value: unknown): value is CorrectionId {
  return isNonEmptyString(value);
}

/** Validate an untrusted CorrectionInput. Collects every violation. */
export function validateCorrectionInput(value: unknown): ProvenanceError[] {
  const errors: ProvenanceError[] = [];
  if (!isRecord(value)) {
    return [invalidField('correction', 'must be an object')];
  }
  if (value.correction_id === undefined) errors.push(missingField('correction.correction_id'));
  else if (!isNonEmptyString(value.correction_id))
    errors.push(invalidField('correction.correction_id', 'must be a non-empty string'));

  if (value.corrected_event_id === undefined) errors.push(missingField('correction.corrected_event_id'));
  else if (!isNonEmptyString(value.corrected_event_id))
    errors.push(invalidField('correction.corrected_event_id', 'must be a non-empty string'));

  if (value.reason === undefined) errors.push(missingField('correction.reason'));
  else if (!isNonEmptyString(value.reason))
    errors.push(invalidField('correction.reason', 'must be a non-empty string'));

  if (value.amendment === undefined) errors.push(missingField('correction.amendment'));
  else if (!isJsonObject(value.amendment))
    errors.push(invalidField('correction.amendment', 'must be a JSON object (finite numbers, no undefined)'));

  return errors;
}

/** Validate an untrusted (stored) CorrectionRecord. Collects every violation. */
export function validateCorrectionRecord(value: unknown): ProvenanceError[] {
  const errors = validateCorrectionInput(value);
  if (!isRecord(value)) return errors;
  errors.push(...validateCustodyChain(value.custody));
  return errors;
}

/** Structural guard for a stored CorrectionRecord (total, no event context). */
export function isCorrectionRecord(value: unknown): value is CorrectionRecord {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.correction_id)) return false;
  if (!isNonEmptyString(value.corrected_event_id)) return false;
  if (!isNonEmptyString(value.reason)) return false;
  if (!isJsonObject(value.amendment)) return false;
  return isCustodyChain(value.custody);
}

/** Structural guard for a CorrectionInput. */
export function isCorrectionInput(value: unknown): value is CorrectionInput {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.correction_id)) return false;
  if (!isNonEmptyString(value.corrected_event_id)) return false;
  if (!isNonEmptyString(value.reason)) return false;
  return isJsonObject(value.amendment);
}

/**
 * The latest correction status of one event, computed from the correction
 * log slice for that event (in APPEND order — the pipeline's order of
 * arrival). Pure: never mutates the input list.
 *
 *   - `uncorrected` — no amendment has ever been issued against the event.
 *   - `corrected`   — `latest` is the most recent amendment; `history`
 *                     carries every amendment in append order (latest last).
 */
export type CorrectionStatus =
  | { readonly status: 'uncorrected'; readonly event_id: EventId }
  | {
      readonly status: 'corrected';
      readonly event_id: EventId;
      readonly count: number;
      /** The newest amendment (the current belief about the event). */
      readonly latest: CorrectionRecord;
      /** Every amendment in append order, oldest first (latest last). */
      readonly history: readonly CorrectionRecord[];
    };

/**
 * Compute the latest correction status of `eventId` from the corrections
 * issued against it (append order). Deterministic and pure.
 */
export function latestCorrectionStatus(
  eventId: EventId,
  corrections: readonly CorrectionRecord[],
): CorrectionStatus {
  const relevant = corrections.filter((correction) => correction.corrected_event_id === eventId);
  if (relevant.length === 0) {
    return { status: 'uncorrected', event_id: eventId };
  }
  return {
    status: 'corrected',
    event_id: eventId,
    count: relevant.length,
    latest: relevant[relevant.length - 1] as CorrectionRecord,
    history: [...relevant],
  };
}

/** All correction ids referenced by a correction list (deterministic order). */
export function correctionIds(corrections: readonly CorrectionRecord[]): readonly CorrectionId[] {
  return corrections.map((correction) => correction.correction_id);
}

/** Whether a correction list contains a given correction id. */
export function hasCorrectionId(corrections: readonly CorrectionRecord[], id: CorrectionId): boolean {
  return corrections.some((correction) => correction.correction_id === id);
}
