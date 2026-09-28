/**
 * @tradrl/data-ingestion — provenance at the ingest boundary.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's `Provenance` block (the
 * INPUT shape; law D-004: never imports; trip-wired by
 * `packages/provenance/src/interop.test.ts`). An adapter's normalized
 * events carry exactly this block; the store stamps custody on top of it
 * at commit.
 *
 * Validation mirrors market-protocol's `validateProvenance` discipline
 * exactly (same codes, same rules): origin trichotomy; adapter REQUIRED
 * non-null for historical events (no orphan history); derived events
 * REQUIRE a non-empty transform; a transform without parents is
 * meaningless; no self-reference; no duplicate parents.
 */

import {
  invalidField,
  isNonEmptyString,
  isRecord,
  missingField,
  type AdapterId,
  type AdapterVersion,
  type EventId,
  type LineageId,
} from './fields';
import type { ValidationFailure } from './fields';

/** Where an event came from. Mirror of market-protocol's EventOrigin. */
export type EventOrigin = 'historical' | 'simulated' | 'generated';

/** Runtime list of origins. Mirror of market-protocol's EVENT_ORIGINS. */
export const EVENT_ORIGINS: readonly EventOrigin[] = ['historical', 'simulated', 'generated'];

/** Runtime guard for the origin discriminator. */
export function isEventOrigin(value: unknown): value is EventOrigin {
  return typeof value === 'string' && (EVENT_ORIGINS as readonly string[]).includes(value);
}

/** Reference to the producing adapter. Mirror of market-protocol's AdapterRef. */
export interface AdapterRef {
  /** Adapter id (e.g. "synthetic-tick-adapter"). */
  readonly id: AdapterId;
  /** Adapter version (e.g. "1.0.0"). */
  readonly version: AdapterVersion;
}

/** The provenance block a normalized event carries into the pipeline. Mirror of market-protocol's Provenance. */
export interface IngestionProvenance {
  readonly origin: EventOrigin;
  readonly adapter: AdapterRef | null;
  readonly derived_from: readonly LineageId[];
  readonly transform: string | null;
}

/** Runtime guard for an AdapterRef. */
export function isAdapterRef(value: unknown): value is AdapterRef {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.version);
}

/** Structural guard for the input provenance block (no event context — use validate for the self-reference rule). */
export function isIngestionProvenance(value: unknown): value is IngestionProvenance {
  if (!isRecord(value)) return false;
  if (!isEventOrigin(value.origin)) return false;
  if (value.adapter !== null && !isAdapterRef(value.adapter)) return false;
  if (!Array.isArray(value.derived_from)) return false;
  if (!value.derived_from.every((parent) => isNonEmptyString(parent))) return false;
  if (typeof value.transform !== 'string' || value.transform.length === 0) {
    if (value.transform !== null) return false;
  }
  if (value.origin === 'historical' && value.adapter === null) return false;
  const derived = value.derived_from.length > 0;
  if (derived && (typeof value.transform !== 'string' || value.transform.length === 0)) return false;
  if (!derived && value.transform !== null) return false;
  return true;
}

/** Validate the adapter sub-record. */
function validateAdapterRef(value: unknown, errors: ValidationFailure[]): void {
  if (!isRecord(value)) {
    errors.push(invalidField('provenance.adapter', 'must be an object with id and version'));
    return;
  }
  if (value.id === undefined) errors.push(missingField('provenance.adapter.id'));
  else if (!isNonEmptyString(value.id)) errors.push(invalidField('provenance.adapter.id', 'must be a non-empty string'));
  if (value.version === undefined) errors.push(missingField('provenance.adapter.version'));
  else if (!isNonEmptyString(value.version))
    errors.push(invalidField('provenance.adapter.version', 'must be a non-empty string'));
}

/**
 * Validate a normalized event's provenance block. `eventId` is the
 * enclosing event's id (self-reference rule). Collects every violation;
 * never throws; mirrors market-protocol's `validateProvenance`.
 */
export function validateIngestionProvenance(value: unknown, eventId: EventId): ValidationFailure[] {
  const errors: ValidationFailure[] = [];
  if (!isRecord(value)) {
    return [invalidField('provenance', 'must be an object')];
  }

  if (value.origin === undefined) errors.push(missingField('provenance.origin'));
  else if (!isEventOrigin(value.origin))
    errors.push(invalidField('provenance.origin', `must be one of ${EVENT_ORIGINS.join(' | ')}`));

  const origin = isEventOrigin(value.origin) ? value.origin : undefined;
  if (value.adapter === undefined) {
    errors.push(missingField('provenance.adapter'));
  } else if (value.adapter !== null) {
    validateAdapterRef(value.adapter, errors);
  } else if (origin === 'historical') {
    errors.push({
      code: 'provenance_adapter_required',
      path: 'provenance.adapter',
      message: 'historical events must reference the adapter that delivered them (id and version)',
    });
  }

  if (value.derived_from === undefined) {
    errors.push(missingField('provenance.derived_from'));
  } else if (!Array.isArray(value.derived_from)) {
    errors.push(invalidField('provenance.derived_from', 'must be an array of parent event ids'));
  } else {
    const seen = new Set<string>();
    for (const parent of value.derived_from) {
      if (!isNonEmptyString(parent)) {
        errors.push(invalidField('provenance.derived_from', 'every parent id must be a non-empty string'));
        break;
      }
      if (parent === eventId) {
        errors.push({
          code: 'provenance_self_reference',
          path: 'provenance.derived_from',
          message: 'an event may not list itself in its own lineage',
        });
        break;
      }
      if (seen.has(parent)) {
        errors.push({
          code: 'provenance_duplicate_parent',
          path: 'provenance.derived_from',
          message: `duplicate parent id "${parent}" in lineage`,
        });
        break;
      }
      seen.add(parent);
    }
  }

  const isDerived = Array.isArray(value.derived_from) && value.derived_from.length > 0;
  if (value.transform === undefined) {
    errors.push(missingField('provenance.transform'));
  } else if (value.transform !== null) {
    if (!isNonEmptyString(value.transform))
      errors.push(invalidField('provenance.transform', 'must be a non-empty string or null'));
    if (!isDerived) {
      errors.push({
        code: 'provenance_transform_without_parents',
        path: 'provenance.transform',
        message: 'a transform is only meaningful for derived events (non-empty derived_from)',
      });
    }
  } else if (isDerived) {
    errors.push({
      code: 'provenance_transform_required',
      path: 'provenance.transform',
      message: 'derived events must declare the transform that produced them',
    });
  }

  return errors;
}

/** The syntheticity predicate (mirror of market-protocol's isSyntheticEvent). */
export function isSyntheticEvent(event: { readonly provenance: IngestionProvenance }): boolean {
  return event.provenance.origin !== 'historical';
}
