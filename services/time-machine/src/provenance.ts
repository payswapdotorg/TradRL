/**
 * @tradrl/time-machine — provenance mirrors at the rolling boundary
 * (Work Order T029).
 *
 * STRUCTURAL MIRRORS (law D-004 — never imports; the vendored T026
 * reference copy `src/t026-reference/mirrors.ts` is the trip-wire target):
 *
 *   - `IngestionProvenance` — the INPUT block a canonical event carries
 *     (mirror of @tradrl/data-ingestion's `IngestionProvenance`, itself the
 *     mirror of market-protocol's `Provenance`): origin trichotomy, adapter,
 *     `derived_from`, `transform`.
 *   - `AdapterRef` / `BatchRef` / `CommitRef` / `CustodyChain` — the T008
 *     custody chain (adapter -> ingestion batch -> admission commit).
 *   - `MachineProvenance` — the STORED block: input + custody stamped at
 *     admission + the (always empty at this layer) corrections view — the
 *     verbatim `KnowledgeProvenance` shape the T026 firewall polices.
 *
 * Validation mirrors market-protocol/data-ingestion's discipline exactly
 * (same codes, same rules): origin trichotomy; adapter REQUIRED non-null
 * for historical; derived events REQUIRE a non-empty transform; a transform
 * without parents is meaningless; no self-reference; no duplicate parents.
 */

import { invalidField, isNonEmptyString, isRecord, missingField, type ValidationFailure } from './canonical-event';
import { isTimestampMs, type TimestampMs } from './timestamp';

/** Where an event came from. Mirror of market-protocol's EventOrigin. */
export type EventOrigin = 'historical' | 'simulated' | 'generated';

/** Runtime list of origins, for guards and diagnostics. Mirror of market-protocol's EVENT_ORIGINS. */
export const EVENT_ORIGINS: readonly EventOrigin[] = ['historical', 'simulated', 'generated'];

/** Runtime guard for the origin discriminator. */
export function isEventOrigin(value: unknown): value is EventOrigin {
  return typeof value === 'string' && (EVENT_ORIGINS as readonly string[]).includes(value);
}

/** Reference to the producing adapter. Mirror of market-protocol's AdapterRef. */
export interface AdapterRef {
  /** Adapter id (e.g. "binance-adapter", "replay-file-adapter"). */
  readonly id: string;
  /** Adapter version (e.g. "1.4.0"). */
  readonly version: string;
}

/** The ingestion-batch hop of the custody chain (mirror of T008's BatchRef). */
export interface BatchRef {
  readonly batch_id: string;
}

/**
 * The admission-commit hop of the custody chain (mirror of T008's CommitRef):
 * commit sequences are positive (the first commit is 1); the ingestion
 * timestamp is stamped at commit.
 */
export interface CommitRef {
  readonly commit_id: string;
  readonly commit_sequence: number;
  readonly ingestion_time: TimestampMs;
}

/** The custody chain: adapter -> ingestion batch -> admission commit (mirror of T008's CustodyChain). */
export interface CustodyChain {
  readonly adapter: AdapterRef | null;
  readonly batch: BatchRef;
  readonly commit: CommitRef;
}

/** An amendment reference issued against a record (mirror of T008's CorrectionRef). */
export interface CorrectionRef {
  readonly correction_id: string;
  readonly reason: string;
}

/** The INPUT provenance block a canonical event carries (mirror of data-ingestion's IngestionProvenance). */
export interface IngestionProvenance {
  readonly origin: EventOrigin;
  readonly adapter: AdapterRef | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
}

/**
 * The STORED provenance block of a time-machine record: input + custody
 * stamped at admission + the corrections view (always empty at this layer —
 * corrections are the T008 store's append-only plane; the time machine
 * carries the shape so the firewall contract is complete). Structural
 * mirror of the T026 `KnowledgeProvenance` (the verbatim T008
 * `ProvenanceRecord` shape).
 */
export interface MachineProvenance {
  readonly origin: EventOrigin;
  readonly adapter: AdapterRef | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
  /** Amendment refs issued against this record (append-only; a query-time view). Empty at this layer. */
  readonly corrections: readonly CorrectionRef[];
  /** adapter -> ingestion batch -> admission commit. */
  readonly custody: CustodyChain;
}

// ---------------------------------------------------------------------------
// Runtime guards.
// ---------------------------------------------------------------------------

/** Runtime type guard for an adapter reference (mirror of the lanes' isAdapterRef). */
export function isAdapterRef(value: unknown): value is AdapterRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isNonEmptyString(candidate.id) && isNonEmptyString(candidate.version);
}

/** Runtime type guard for a batch reference (mirror of T008's isBatchRef). */
export function isBatchRef(value: unknown): value is BatchRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isNonEmptyString(candidate.batch_id);
}

/**
 * Runtime type guard for a commit reference (mirror of T008's isCommitRef):
 * commit sequences are positive safe integers — the first commit is 1.
 */
export function isCommitRef(value: unknown): value is CommitRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!isNonEmptyString(candidate.commit_id)) return false;
  if (
    typeof candidate.commit_sequence !== 'number' ||
    !Number.isSafeInteger(candidate.commit_sequence) ||
    candidate.commit_sequence < 1
  ) {
    return false;
  }
  return isTimestampMs(candidate.ingestion_time);
}

/** Runtime type guard for a custody chain (mirror of T008's isCustodyChain). */
export function isCustodyChain(value: unknown): value is CustodyChain {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.adapter !== null && !isAdapterRef(candidate.adapter)) return false;
  return isBatchRef(candidate.batch) && isCommitRef(candidate.commit);
}

/** Runtime type guard for a correction reference (mirror of the lanes' isCorrectionRef). */
export function isCorrectionRef(value: unknown): value is CorrectionRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isNonEmptyString(candidate.correction_id) && isNonEmptyString(candidate.reason);
}

/** Runtime type guard for the INPUT provenance block. */
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

/** Runtime type guard for the STORED provenance block (the T026 KnowledgeProvenance shape). */
export function isMachineProvenance(value: unknown): value is MachineProvenance {
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
  if (!value.corrections.every((ref) => isCorrectionRef(ref))) return false;
  return isCustodyChain(value.custody);
}

// ---------------------------------------------------------------------------
// Validation (collect-every-violation; never throws).
// ---------------------------------------------------------------------------

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
 * Validate an event's INPUT provenance block. `eventId` is the enclosing
 * event's id (self-reference rule). Collects every violation; mirrors the
 * market-protocol / data-ingestion codes and messages.
 */
export function validateIngestionProvenance(value: unknown, eventId: string): ValidationFailure[] {
  const errors: ValidationFailure[] = [];
  if (!isRecord(value)) {
    return [invalidField('provenance', 'must be an object')];
  }

  if (value.origin === undefined) {
    errors.push(missingField('provenance.origin'));
  } else if (!isEventOrigin(value.origin)) {
    errors.push(invalidField('provenance.origin', `must be one of ${EVENT_ORIGINS.join(' | ')}`));
  }

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
    if (!isDerived)
      errors.push({
        code: 'provenance_transform_without_parents',
        path: 'provenance.transform',
        message: 'a transform is only meaningful for derived events (non-empty derived_from)',
      });
  } else if (isDerived) {
    errors.push({
      code: 'provenance_transform_required',
      path: 'provenance.transform',
      message: 'derived events must declare the transform that produced them',
    });
  }

  return errors;
}
