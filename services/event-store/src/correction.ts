/**
 * @tradrl/event-store — corrections at the store boundary.
 *
 * STRUCTURAL MIRRORS of @tradrl/provenance's `CorrectionInput` /
 * `CorrectionRecord` (law D-004: never imports; trip-wired in
 * `packages/provenance/src/interop.test.ts`). A correction ENTERS the store
 * as a `StorableCorrection` (amendment content); the store validates it and
 * stamps custody at append, producing a `StoredCorrection`.
 *
 * Append-only: corrections never rewrite the corrected event; the
 * correction log grows monotonically and queries compute the latest
 * correction status per event as a VIEW (see store.ts).
 */

import { invalidField, isNonEmptyString, isRecord, missingField, type CorrectionId, type EventId } from './fields';
import type { StoreError } from './fields';
import { isJsonObject, type JsonObject } from './json';
import { validateCustodyChain, type CustodyChain } from './provenance';

/** A correction as it ENTERS the store (pre-custody). Mirror of provenance's CorrectionInput. */
export interface StorableCorrection {
  readonly correction_id: CorrectionId;
  readonly corrected_event_id: EventId;
  readonly reason: string;
  readonly amendment: JsonObject;
}

/** A stored correction: the input amendment plus the custody chain stamped at append. */
export interface StoredCorrection extends StorableCorrection {
  readonly custody: CustodyChain;
}

/** Validate an untrusted StorableCorrection. Collects every violation. */
export function validateStorableCorrection(value: unknown): { readonly ok: boolean; readonly errors: readonly StoreError[] } {
  const errors: StoreError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'invalid_type', path: '', message: 'a correction must be an object' }] };
  }
  if (value.correction_id === undefined) errors.push(missingField('correction_id'));
  else if (!isNonEmptyString(value.correction_id))
    errors.push(invalidField('correction_id', 'must be a non-empty string'));

  if (value.corrected_event_id === undefined) errors.push(missingField('corrected_event_id'));
  else if (!isNonEmptyString(value.corrected_event_id))
    errors.push(invalidField('corrected_event_id', 'must be a non-empty string'));

  if (value.reason === undefined) errors.push(missingField('reason'));
  else if (!isNonEmptyString(value.reason))
    errors.push(invalidField('reason', 'must be a non-empty string'));

  if (value.amendment === undefined) errors.push(missingField('amendment'));
  else if (!isJsonObject(value.amendment))
    errors.push(invalidField('amendment', 'must be a JSON object (finite numbers, no undefined)'));

  return { ok: errors.length === 0, errors };
}

/** Narrowing guard for untrusted input. */
export function isStorableCorrection(value: unknown): value is StorableCorrection {
  return validateStorableCorrection(value).ok;
}

/** Validate a (stored) correction against both the amendment content and its custody chain. */
export function validateStoredCorrection(value: unknown): { readonly ok: boolean; readonly errors: readonly StoreError[] } {
  const base = validateStorableCorrection(value);
  const errors = [...base.errors];
  if (isRecord(value)) {
    errors.push(...validateCustodyChain(value.custody).map((error) => ({ ...error, path: `custody${error.path === '' ? '' : `.${error.path}`}` })));
  }
  return { ok: errors.length === 0, errors };
}

/** Runtime guard for a stored correction. */
export function isStoredCorrection(value: unknown): value is StoredCorrection {
  return validateStoredCorrection(value).ok;
}
