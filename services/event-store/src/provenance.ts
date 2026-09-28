/**
 * @tradrl/event-store — provenance at the store boundary.
 *
 * Three shapes, one discipline (law D-004 — STRUCTURAL MIRRORS of
 * @tradrl/market-protocol's `Provenance` and @tradrl/provenance's
 * `ProvenanceRecord`/`CustodyChain`; never imports; trip-wired by
 * `packages/provenance/src/interop.test.ts`):
 *
 *   - `StorableProvenance` — the INPUT block an event carries when
 *     submitted for commit: the market-protocol Provenance mirror
 *     (origin trichotomy, adapter, `derived_from`, `transform`).
 *   - `StoredProvenance` — the stored block: input + the CUSTODY chain
 *     stamped at commit (adapter -> ingestion batch -> store commit).
 *   - `EventProvenanceRecord` — the full query VIEW: stored block + the
 *     correction refs materialized from the append-only correction log.
 *     Structurally mirrors @tradrl/provenance's `ProvenanceRecord`.
 *
 * Validation mirrors market-protocol's `validateProvenance` discipline
 * exactly (same codes, same rules): origin trichotomy; adapter REQUIRED
 * non-null for historical; derived events REQUIRE a non-empty transform;
 * a transform without parents is meaningless; no self-reference; no
 * duplicate parents.
 */

import {
  invalidField,
  isNonEmptyString,
  isRecord,
  missingField,
  type BatchId,
  type CommitId,
  type EventId,
  type LineageId,
} from './fields';
import type { StoreError } from './fields';
import { isTimestampMs, type TimestampMs } from './timestamp';

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
  /** Adapter id (e.g. "binance-adapter", "synthetic-tick-adapter"). */
  readonly id: string;
  /** Adapter version (e.g. "1.4.0"). */
  readonly version: string;
}

/** The ingestion batch hop of the custody chain. Mirror of provenance's BatchRef. */
export interface BatchRef {
  readonly batch_id: BatchId;
}

/** The store-commit hop of the custody chain. Mirror of provenance's CommitRef. */
export interface CommitRef {
  readonly commit_id: CommitId;
  readonly commit_sequence: number;
  readonly ingestion_time: TimestampMs;
}

/** The custody chain: adapter -> ingestion batch -> store commit. Mirror of provenance's CustodyChain. */
export interface CustodyChain {
  readonly adapter: AdapterRef | null;
  readonly batch: BatchRef;
  readonly commit: CommitRef;
}

/** The INPUT provenance block of an event submitted for commit. Mirror of market-protocol's Provenance. */
export interface StorableProvenance {
  readonly origin: EventOrigin;
  readonly adapter: AdapterRef | null;
  readonly derived_from: readonly LineageId[];
  readonly transform: string | null;
}

/** The stored provenance block: input + custody stamped at commit. */
export interface StoredProvenance extends StorableProvenance {
  readonly custody: CustodyChain;
}

/** A correction reference materialized onto the query view. Mirror of provenance's CorrectionRef. */
export interface CorrectionRef {
  readonly correction_id: string;
  readonly reason: string;
}

/** The full provenance record returned by lineage queries. Mirror of provenance's ProvenanceRecord. */
export interface EventProvenanceRecord extends StoredProvenance {
  readonly corrections: readonly CorrectionRef[];
}

/** Runtime guard for an AdapterRef. */
export function isAdapterRef(value: unknown): value is AdapterRef {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.version);
}

/** Runtime guard for the input provenance block (no event context — use validate for the self-reference rule). */
export function isStorableProvenance(value: unknown): value is StorableProvenance {
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
function validateAdapterRef(value: unknown, errors: StoreError[]): void {
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
 * Validate an event's INPUT provenance block. `eventId` is the enclosing
 * event's id (self-reference rule). Collects every violation; mirrors
 * market-protocol's `validateProvenance` codes and messages.
 */
export function validateStorableProvenance(value: unknown, eventId: EventId): StoreError[] {
  const errors: StoreError[] = [];
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

/** Validate a custody chain (store-produced; used when restoring from a commit log). */
export function validateCustodyChain(value: unknown): StoreError[] {
  if (!isRecord(value)) {
    return [invalidField('custody', 'must be an object: adapter -> batch -> commit')];
  }
  const errors: StoreError[] = [];
  if (value.adapter === undefined) {
    errors.push(missingField('custody.adapter'));
  } else if (value.adapter !== null && !isAdapterRef(value.adapter)) {
    errors.push(invalidField('custody.adapter', 'must be an adapter reference {id, version} or null'));
  }
  if (value.batch === undefined) {
    errors.push(missingField('custody.batch'));
  } else if (!isRecord(value.batch) || !isNonEmptyString(value.batch.batch_id)) {
    errors.push(invalidField('custody.batch.batch_id', 'must be a non-empty string'));
  }
  if (value.commit === undefined) {
    errors.push(missingField('custody.commit'));
  } else if (!isRecord(value.commit)) {
    errors.push(invalidField('custody.commit', 'must be an object with commit_id, commit_sequence and ingestion_time'));
  } else {
    if (value.commit.commit_id === undefined) errors.push(missingField('custody.commit.commit_id'));
    else if (!isNonEmptyString(value.commit.commit_id))
      errors.push(invalidField('custody.commit.commit_id', 'must be a non-empty string'));
    if (value.commit.commit_sequence === undefined) errors.push(missingField('custody.commit.commit_sequence'));
    else if (!isNonNegativeSafeInteger(value.commit.commit_sequence) || value.commit.commit_sequence < 1)
      errors.push(invalidField('custody.commit.commit_sequence', 'must be a positive safe integer'));
    if (value.commit.ingestion_time === undefined) errors.push(missingField('custody.commit.ingestion_time'));
    else if (!isTimestampMs(value.commit.ingestion_time))
      errors.push(invalidField('custody.commit.ingestion_time', 'must be a valid epoch-millisecond timestamp'));
  }
  return errors;
}

/** The syntheticity predicate (mirror of market-protocol's isSyntheticEvent). */
export function isSyntheticEvent(event: { readonly provenance: StorableProvenance }): boolean {
  return event.provenance.origin !== 'historical';
}

/** The origin of an event (structural accessor). */
export function eventOrigin(event: { readonly provenance: StorableProvenance }): EventOrigin {
  return event.provenance.origin;
}
