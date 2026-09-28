/**
 * @tradrl/provenance — the custody chain.
 *
 * Every store-level record answers "who had custody of this datum, in
 * order": the adapter that produced it outside TradRL, the ingestion batch
 * that carried it in, and the store commit that accepted it (with the
 * ingestion timestamp stamped at commit). This is the L9 (reproducible
 * lineage) backbone for the data plane: an auditor walks the chain from any
 * stored event back to the exact commit — and the exact adapter — that
 * delivered it.
 *
 * STRUCTURAL MIRROR: `AdapterRef` and the origin trichotomy mirror
 * @tradrl/market-protocol/src/provenance.ts (law D-004 — this package
 * extends that discipline for the STORE layer, never imports it). The
 * `packages/provenance/src/interop.test.ts` trip wire fails if the shapes
 * drift.
 */

import { invalidField, isNonEmptyString, isNonNegativeSafeInteger, isRecord, missingField } from './fields';
import type { ProvenanceError } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { AdapterId, AdapterVersion, BatchId, CommitId, EventId } from './fields';

/** Reference to the producing adapter (or generator component). Mirror of market-protocol's AdapterRef. */
export interface AdapterRef {
  /** Adapter id (e.g. "binance-adapter", "synthetic-tick-adapter"). */
  readonly id: AdapterId;
  /** Adapter version (e.g. "1.4.0"). */
  readonly version: AdapterVersion;
}

/** The ingestion batch that carried the record into the store. */
export interface BatchRef {
  /** Opaque batch id assigned by the ingestion pipeline. */
  readonly batch_id: BatchId;
}

/** The store commit that accepted the record — stamped at commit time. */
export interface CommitRef {
  /** Opaque commit id (deterministic given the store config). */
  readonly commit_id: CommitId;
  /** Monotonic commit ordinal within the store (first commit = 1). */
  readonly commit_sequence: number;
  /** Ingestion timestamp stamped at commit — never earlier (L4). */
  readonly ingestion_time: TimestampMs;
}

/**
 * The custody chain of a stored record:
 *
 *     adapter  ->  ingestion batch  ->  store commit
 *
 * `adapter` mirrors the event's provenance adapter (null for simulated/
 * generated records that name no producer) so the chain is self-contained;
 * `batch` and `commit` are stamped by the data plane at commit.
 */
export interface CustodyChain {
  readonly adapter: AdapterRef | null;
  readonly batch: BatchRef;
  readonly commit: CommitRef;
}

/** Runtime guard for an AdapterRef. */
export function isAdapterRef(value: unknown): value is AdapterRef {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.version)
  );
}

/** Runtime guard for a BatchRef. */
export function isBatchRef(value: unknown): value is BatchRef {
  return isRecord(value) && isNonEmptyString(value.batch_id);
}

/** Runtime guard for a CommitRef (commit sequences are positive: the first commit is 1). */
export function isCommitRef(value: unknown): value is CommitRef {
  return (
    isRecord(value) &&
    isNonEmptyString(value.commit_id) &&
    isNonNegativeSafeInteger(value.commit_sequence) &&
    value.commit_sequence >= 1 &&
    isTimestampMs(value.ingestion_time)
  );
}

/** Runtime guard for a CustodyChain. */
export function isCustodyChain(value: unknown): value is CustodyChain {
  if (!isRecord(value)) return false;
  if (value.adapter !== null && !isAdapterRef(value.adapter)) return false;
  return isBatchRef(value.batch) && isCommitRef(value.commit);
}

/** Validate an untrusted AdapterRef. Collects every violation. */
export function validateAdapterRef(value: unknown): ProvenanceError[] {
  const errors: ProvenanceError[] = [];
  if (!isRecord(value)) {
    return [invalidField('adapter', 'must be an object with id and version')];
  }
  if (value.id === undefined) errors.push(missingField('adapter.id'));
  else if (!isNonEmptyString(value.id)) errors.push(invalidField('adapter.id', 'must be a non-empty string'));
  if (value.version === undefined) errors.push(missingField('adapter.version'));
  else if (!isNonEmptyString(value.version)) errors.push(invalidField('adapter.version', 'must be a non-empty string'));
  return errors;
}

/** Validate an untrusted CustodyChain. Collects every violation. */
export function validateCustodyChain(value: unknown): ProvenanceError[] {
  if (value === undefined) return [missingField('custody')];
  if (!isRecord(value)) {
    return [invalidField('custody', 'must be an object: adapter -> batch -> commit')];
  }
  const errors: ProvenanceError[] = [];

  if (value.adapter === undefined) {
    errors.push(missingField('custody.adapter'));
  } else if (value.adapter !== null) {
    errors.push(...validateAdapterRef(value.adapter).map((error) => ({ ...error, path: `custody.${error.path}` })));
  }

  if (value.batch === undefined) {
    errors.push(missingField('custody.batch'));
  } else if (!isBatchRef(value.batch)) {
    errors.push(invalidField('custody.batch.batch_id', 'must be a non-empty string'));
  }

  if (value.commit === undefined) {
    errors.push(missingField('custody.commit'));
  } else if (isRecord(value.commit)) {
    if (value.commit.commit_id === undefined) errors.push(missingField('custody.commit.commit_id'));
    else if (!isNonEmptyString(value.commit.commit_id))
      errors.push(invalidField('custody.commit.commit_id', 'must be a non-empty string'));
    if (value.commit.commit_sequence === undefined) errors.push(missingField('custody.commit.commit_sequence'));
    else if (!isNonNegativeSafeInteger(value.commit.commit_sequence) || value.commit.commit_sequence < 1)
      errors.push(invalidField('custody.commit.commit_sequence', 'must be a positive safe integer (the first commit is 1)'));
    if (value.commit.ingestion_time === undefined) errors.push(missingField('custody.commit.ingestion_time'));
    else if (!isTimestampMs(value.commit.ingestion_time))
      errors.push(invalidField('custody.commit.ingestion_time', 'must be a valid epoch-millisecond timestamp'));
  } else {
    errors.push(invalidField('custody.commit', 'must be an object with commit_id, commit_sequence and ingestion_time'));
  }

  return errors;
}

/** Structural: a record carrying a custody chain. */
interface HasCustody {
  readonly custody: CustodyChain;
}

/** The commit reference of a custody-carrier (the last custody hop). */
export function commitRefOf(record: HasCustody): CommitRef {
  return record.custody.commit;
}

/** The batch reference of a custody-carrier (the middle custody hop). */
export function batchRefOf(record: HasCustody): BatchRef {
  return record.custody.batch;
}

/** The adapter reference of a custody-carrier (the first custody hop; null when none). */
export function adapterRefOf(record: HasCustody): AdapterRef | null {
  return record.custody.adapter;
}

/** Opaque event id carried alongside custody (for documentation completeness). */
export type CustodyEventId = EventId;
