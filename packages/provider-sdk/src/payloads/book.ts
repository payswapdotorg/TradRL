/**
 * @tradrl/provider-sdk — order book payloads (snapshot and delta).
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's book payloads (law D-004:
 * never imports). A `book_snapshot` replaces the visible book for the
 * instrument; a `book_delta` applies an incremental change. Level ordering
 * (bids descending, asks ascending) is NOT enforced by the contract —
 * vendors differ and the world engine sorts — but levels themselves are
 * validated.
 */

import { isPositiveDecimal, isUnsignedDecimal } from '../decimals';
import { invalidField, isNonEmptyString, isNonNegativeSafeInteger, missingField } from '../fields';
import type { SdkFieldError } from '../errors';

/** One price level. `size` semantics: absolute quantity at the price. */
export interface BookLevel {
  readonly price: string;
  readonly size: string;
}

export type BookDeltaAction = 'add' | 'update' | 'remove' | 'clear';

export interface BookSnapshotPayload {
  /** Full visible bid side. May be empty (no bids). */
  readonly bids: readonly BookLevel[];
  /** Full visible ask side. May be empty (no asks). */
  readonly asks: readonly BookLevel[];
  /** Number of levels the venue exposes, when known. */
  readonly depth?: number;
  /** Venue book-state identifier for continuity checks, when provided. */
  readonly last_update_id?: string;
}

export interface BookDeltaPayload {
  /** The kind of change. `clear` empties the book and must carry no levels. */
  readonly action: BookDeltaAction;
  /** Levels the action applies to. `add`/`update` require size > 0; `remove` allows size 0 (delete-by-price). */
  readonly levels: readonly BookLevel[];
  /** Venue book-state identifier for continuity checks, when provided. */
  readonly last_update_id?: string;
}

function validateLevel(
  level: unknown,
  path: string,
  requirePositiveSize: boolean,
  errors: SdkFieldError[],
): void {
  if (typeof level !== 'object' || level === null || Array.isArray(level)) {
    errors.push(invalidField(path, 'must be an object with price and size'));
    return;
  }
  const candidate = level as Record<string, unknown>;
  if (candidate.price === undefined) errors.push(missingField(`${path}.price`));
  else if (!isPositiveDecimal(candidate.price))
    errors.push(invalidField(`${path}.price`, 'must be a decimal string greater than zero'));
  if (candidate.size === undefined) errors.push(missingField(`${path}.size`));
  else if (requirePositiveSize && !isPositiveDecimal(candidate.size))
    errors.push(invalidField(`${path}.size`, 'must be a decimal string greater than zero for this action'));
  else if (!requirePositiveSize && !isUnsignedDecimal(candidate.size))
    errors.push(invalidField(`${path}.size`, 'must be a decimal string'));
}

function validateLevels(
  value: unknown,
  path: string,
  requirePositiveSize: boolean,
  errors: SdkFieldError[],
): void {
  if (!Array.isArray(value)) {
    errors.push(invalidField(path, 'must be an array of levels'));
    return;
  }
  value.forEach((level, index) => validateLevel(level, `${path}[${index}]`, requirePositiveSize, errors));
}

export function validateBookSnapshotPayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'book_snapshot payload must be an object')];
  }
  const payload = value as Record<string, unknown>;
  if (payload.bids === undefined) errors.push(missingField('bids'));
  else validateLevels(payload.bids, 'bids', true, errors);
  if (payload.asks === undefined) errors.push(missingField('asks'));
  else validateLevels(payload.asks, 'asks', true, errors);
  if (payload.depth !== undefined && !isNonNegativeSafeInteger(payload.depth))
    errors.push(invalidField('depth', 'must be a non-negative integer when present'));
  if (payload.last_update_id !== undefined && !isNonEmptyString(payload.last_update_id))
    errors.push(invalidField('last_update_id', 'must be a non-empty string when present'));
  return errors;
}

export function isBookSnapshotPayload(value: unknown): value is BookSnapshotPayload {
  return validateBookSnapshotPayload(value).length === 0;
}

export function validateBookDeltaPayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'book_delta payload must be an object')];
  }
  const payload = value as Record<string, unknown>;
  const ACTIONS: readonly BookDeltaAction[] = ['add', 'update', 'remove', 'clear'];
  if (payload.action === undefined) errors.push(missingField('action'));
  else if (typeof payload.action !== 'string' || !(ACTIONS as readonly string[]).includes(payload.action))
    errors.push(invalidField('action', 'must be one of add | update | remove | clear'));

  const action = payload.action;
  if (payload.levels === undefined) errors.push(missingField('levels'));
  else if (!Array.isArray(payload.levels)) errors.push(invalidField('levels', 'must be an array of levels'));
  else if (action === 'clear') {
    if (payload.levels.length > 0)
      errors.push(invalidField('levels', 'must be empty for action "clear" — clear empties the whole book'));
  } else {
    if (payload.levels.length === 0)
      errors.push(invalidField('levels', 'must not be empty for add | update | remove'));
    validateLevels(payload.levels, 'levels', action === 'add' || action === 'update', errors);
  }

  if (payload.last_update_id !== undefined && !isNonEmptyString(payload.last_update_id))
    errors.push(invalidField('last_update_id', 'must be a non-empty string when present'));
  return errors;
}

export function isBookDeltaPayload(value: unknown): value is BookDeltaPayload {
  return validateBookDeltaPayload(value).length === 0;
}
