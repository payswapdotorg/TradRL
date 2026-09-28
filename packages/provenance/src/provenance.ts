/**
 * @tradrl/provenance — the store-level provenance record.
 *
 * MIRROR + EXTENSION of @tradrl/market-protocol's `Provenance` block (law
 * D-004: structural mirror, never an import). The market-protocol block is:
 *
 *   - `origin`: the historical/simulated/generated trichotomy (the
 *     anti-poisoning foundation, L5-adjacent).
 *   - `adapter`: REQUIRED non-null when origin is `historical` — no orphan
 *     history.
 *   - `derived_from`: lineage — the parent event/artifact ids.
 *   - `transform`: REQUIRED (non-empty) iff `derived_from` is non-empty.
 *
 * The STORE-layer extension adds:
 *
 *   - `corrections`: amendment refs (id + reason) issued against this event,
 *     materialized from the append-only correction log. Corrections NEVER
 *     mutate the committed event — this list is a query-time view, and its
 *     members are appended records, never rewrites.
 *   - `custody`: the adapter -> ingestion batch -> store commit chain (see
 *     custody.ts), stamped at commit.
 *
 * The extension is structurally backward-compatible: a `ProvenanceRecord`
 * IS a market-protocol `Provenance` (width subtyping) — asserted by the
 * type-level trip wire in interop.test.ts.
 */

import { invalidField, isNonEmptyString, isRecord, missingField, type CorrectionId, type CorrectionReason, type EventId, type LineageId, type TransformId } from './fields';
import type { ProvenanceError } from './errors';
import { isCustodyChain, isAdapterRef, validateCustodyChain, type AdapterRef, type CustodyChain } from './custody';

/** Where a record came from. The syntheticity discriminator. Mirror of market-protocol's EventOrigin. */
export type EventOrigin = 'historical' | 'simulated' | 'generated';

/** Runtime list of origins, for guards and diagnostics. Mirror of market-protocol's EVENT_ORIGINS. */
export const EVENT_ORIGINS: readonly EventOrigin[] = ['historical', 'simulated', 'generated'];

/** Runtime guard for the origin discriminator. */
export function isEventOrigin(value: unknown): value is EventOrigin {
  return typeof value === 'string' && (EVENT_ORIGINS as readonly string[]).includes(value);
}

/**
 * A reference to an amendment issued against an event. The full amendment
 * lives in the append-only correction log (see correction.ts); the record
 * carries the reference and the reason so lineage queries can explain
 * without dereferencing.
 */
export interface CorrectionRef {
  readonly correction_id: CorrectionId;
  readonly reason: CorrectionReason;
}

/**
 * The full store-level provenance record: market-protocol's Provenance
 * block, extended with corrections and custody.
 */
export interface ProvenanceRecord {
  readonly origin: EventOrigin;
  readonly adapter: AdapterRef | null;
  readonly derived_from: readonly LineageId[];
  readonly transform: TransformId | null;
  /** Amendment refs issued against this record (append-only; a query-time view). */
  readonly corrections: readonly CorrectionRef[];
  /** adapter -> ingestion batch -> store commit. */
  readonly custody: CustodyChain;
}

/** Validate one correction ref. */
function validateCorrectionRef(value: unknown, errors: ProvenanceError[]): void {
  if (!isRecord(value)) {
    errors.push(invalidField('provenance.corrections', 'each entry must be an object with correction_id and reason'));
    return;
  }
  if (value.correction_id === undefined) errors.push(missingField('provenance.corrections.correction_id'));
  else if (!isNonEmptyString(value.correction_id))
    errors.push(invalidField('provenance.corrections.correction_id', 'must be a non-empty string'));
  if (value.reason === undefined) errors.push(missingField('provenance.corrections.reason'));
  else if (!isNonEmptyString(value.reason))
    errors.push(invalidField('provenance.corrections.reason', 'must be a non-empty string'));
}

/**
 * Full store-level provenance validation. `eventId` is the enclosing event's
 * id, needed for the self-reference rule (mirror of market-protocol's
 * `validateProvenance(value, eventId)` discipline). Collects EVERY
 * violation; never throws.
 */
export function validateProvenanceRecord(value: unknown, eventId: EventId): ProvenanceError[] {
  const errors: ProvenanceError[] = [];
  if (!isRecord(value)) {
    return [invalidField('provenance', 'must be an object')];
  }

  // --- Mirror of the market-protocol block ----------------------------------
  if (value.origin === undefined) errors.push(missingField('provenance.origin'));
  else if (!isEventOrigin(value.origin))
    errors.push(invalidField('provenance.origin', `must be one of ${EVENT_ORIGINS.join(' | ')}`));

  const origin = isEventOrigin(value.origin) ? value.origin : undefined;
  if (value.adapter === undefined) {
    errors.push(missingField('provenance.adapter'));
  } else if (value.adapter !== null) {
    if (!isAdapterRef(value.adapter)) {
      errors.push(invalidField('provenance.adapter', 'must be an object with non-empty id and version, or null'));
    }
  } else if (origin === 'historical') {
    errors.push({
      code: 'provenance_adapter_required',
      path: 'provenance.adapter',
      message: 'historical records must reference the adapter that delivered them (id and version)',
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
          message: 'a record may not list itself in its own lineage',
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
        message: 'a transform is only meaningful for derived records (non-empty derived_from)',
      });
    }
  } else if (isDerived) {
    errors.push({
      code: 'provenance_transform_required',
      path: 'provenance.transform',
      message: 'derived records must declare the transform that produced them',
    });
  }

  // --- Store-layer extension -------------------------------------------------
  if (value.corrections === undefined) {
    errors.push(missingField('provenance.corrections'));
  } else if (!Array.isArray(value.corrections)) {
    errors.push(invalidField('provenance.corrections', 'must be an array of amendment refs'));
  } else {
    for (const ref of value.corrections) validateCorrectionRef(ref, errors);
  }

  errors.push(...validateCustodyChain(value.custody));

  return errors;
}

/** Structural requirement for a record carrying a store-level provenance record. */
interface HasProvenanceRecord {
  readonly provenance: ProvenanceRecord;
}

/**
 * The syntheticity predicate (mirror of market-protocol's
 * `isSyntheticEvent`): a record is synthetic iff its origin is not
 * `historical`. Simulated and generated records are ALWAYS distinguishable
 * from historical ones — the anti-poisoning foundation.
 */
export function isSyntheticRecord(event: HasProvenanceRecord): boolean {
  return event.provenance.origin !== 'historical';
}

/** The origin of a record (structural: works on any provenance-carrier). */
export function recordOrigin(event: HasProvenanceRecord): EventOrigin {
  return event.provenance.origin;
}

/**
 * Structural guard WITHOUT the enclosing event context (no self-reference
 * check — use {@link validateProvenanceRecord} for full validation).
 * Mirrors the totality discipline of market-protocol's `isProvenance`.
 */
export function isProvenanceRecord(value: unknown): value is ProvenanceRecord {
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
  if (!Array.isArray(value.corrections)) return false;
  if (
    !value.corrections.every(
      (ref) => isRecord(ref) && isNonEmptyString(ref.correction_id) && isNonEmptyString(ref.reason),
    )
  ) {
    return false;
  }
  return isCustodyChain(value.custody);
}
