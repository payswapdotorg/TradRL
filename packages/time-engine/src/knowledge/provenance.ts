/**
 * @tradrl/time-engine/knowledge — provenance reference for knowledge records.
 *
 * Every knowledge record carries a provenance block describing where the
 * knowledge CAME FROM, structurally mirroring the T008 store-level provenance
 * contract `@tradrl/provenance`'s `ProvenanceRecord` — VERBATIM SHAPE MIRROR,
 * trip-wired by interop.test.ts against the vendored reference copy in
 * ./t008-reference/ (byte-identical to the Lead's T008 reference bundle,
 * sha256 cb5bd0c1...). The T008 record is itself the market-protocol
 * `Provenance` block (T004, merged) EXTENDED with the store layer:
 *
 * THE MARKET-PROTOCOL BLOCK (T004 / the input layer of the T008 lane):
 *   - `origin`: the historical/simulated/generated trichotomy (the
 *     anti-poisoning foundation, L5-adjacent).
 *   - `adapter`: REQUIRED non-null when origin is `historical` — no orphan
 *     history.
 *   - `derived_from`: event-level lineage — parent event/artifact ids in the
 *     T008 event-store id space (opaque strings here; cross-lane rule:
 *     referents are referenced by id only).
 *   - `transform`: REQUIRED (non-empty) iff `derived_from` is non-empty.
 *
 * THE STORE-LAYER EXTENSION (T008):
 *   - `corrections`: amendment refs issued against this record (id + reason),
 *     materialized from the append-only correction log. Corrections NEVER
 *     mutate the committed record — this list is a query-time view.
 *   - `custody`: the adapter -> ingestion batch -> store commit chain, with
 *     the ingestion timestamp stamped at commit (L9: reproducible lineage).
 *
 * WIDTH SUBTYPING is preserved exactly as in T008: a KnowledgeProvenance IS
 * a market-protocol `Provenance` (the extension is backward compatible), and
 * it is mutually structurally assignable with T008's `ProvenanceRecord`.
 * The full record is a STRICTER contract than the bare market-protocol
 * block: bare 4-field provenance lacks corrections/custody and is rejected
 * here (mirroring `validateProvenanceRecord`'s discipline).
 *
 * The knowledge layer keeps its own lineage field (`KnowledgeRecord.inputs`,
 * parent RECORD ids) for availability propagation; the provenance block's
 * `derived_from` is the event-level lineage in the T008 id space.
 *
 * L4 law: provenance NEVER affects visibility. The boundary is origin-blind —
 * simulated and generated knowledge is withheld exactly like historical
 * knowledge (no origin-based exemptions).
 *
 * Identifier discipline (mirrors T008 fields.ts): identifiers are
 * deliberately PLAIN (unbranded) non-empty strings, so knowledge provenance
 * remains mutually structurally assignable with the T008 and market-protocol
 * records. `TimestampMs` is the one branded type (the canonical time-engine
 * declaration, brand 'TradRL.TimestampMs' — identical to T008's mirror).
 */

import { isTimestampMs, type TimestampMs } from '../timestamp';
import { fail, ok, type KnowledgeResult } from './errors';

// ---------------------------------------------------------------------------
// Identifier aliases (T008 fields discipline: plain non-empty strings).
// ---------------------------------------------------------------------------

/** Opaque identifier of a parent event/artifact (lineage) in the T008 id space. */
export type LineageId = string;
/** Stable identifier of a transform that produced a derivation. */
export type TransformId = string;
/** Opaque identifier of an adapter (producer of external observations). */
export type AdapterId = string;
/** Opaque version string of an adapter. */
export type AdapterVersion = string;
/** Opaque identifier of a correction record. */
export type CorrectionId = string;
/** Free-form reason a correction was issued. */
export type CorrectionReason = string;
/** Opaque identifier of an ingestion batch. */
export type BatchId = string;
/** Opaque identifier of a store commit. */
export type CommitId = string;

// ---------------------------------------------------------------------------
// The origin trichotomy (mirror of T008 / market-protocol EventOrigin).
// ---------------------------------------------------------------------------

/** Where knowledge came from. The syntheticity discriminator. */
export type KnowledgeOrigin = 'historical' | 'simulated' | 'generated';

/** Runtime list of origins, for guards and diagnostics. */
export const KNOWLEDGE_ORIGINS: readonly KnowledgeOrigin[] = ['historical', 'simulated', 'generated'];

// ---------------------------------------------------------------------------
// The market-protocol block (T004 / the T008 input layer).
// ---------------------------------------------------------------------------

/**
 * Reference to the producing adapter (or generator/world component).
 * Structurally identical to T008's and market-protocol's `AdapterRef`.
 */
export interface AdapterRef {
  /** Adapter id (e.g. "binance-adapter", "replay-file-adapter"). */
  readonly id: AdapterId;
  /** Adapter version (e.g. "1.4.0"). */
  readonly version: AdapterVersion;
}

// ---------------------------------------------------------------------------
// The store-layer extension (T008): corrections + custody.
// ---------------------------------------------------------------------------

/**
 * A reference to an amendment issued against a record. The full amendment
 * lives in the append-only correction log; the record carries the reference
 * and the reason so lineage queries can explain without dereferencing.
 * Mirror of T008's `CorrectionRef`.
 */
export interface CorrectionRef {
  readonly correction_id: CorrectionId;
  readonly reason: CorrectionReason;
}

/** The ingestion batch hop of the custody chain. Mirror of T008's `BatchRef`. */
export interface BatchRef {
  /** Opaque batch id assigned by the ingestion pipeline. */
  readonly batch_id: BatchId;
}

/**
 * The store-commit hop of the custody chain. Mirror of T008's `CommitRef`:
 * commit sequences are positive (the first commit is 1); the ingestion
 * timestamp is stamped at commit — never earlier (L4).
 */
export interface CommitRef {
  /** Opaque commit id (deterministic given the store config). */
  readonly commit_id: CommitId;
  /** Monotonic commit ordinal within the store (first commit = 1). */
  readonly commit_sequence: number;
  /** Ingestion timestamp stamped at commit. */
  readonly ingestion_time: TimestampMs;
}

/**
 * The custody chain of a knowledge record:
 *
 *     adapter  ->  ingestion batch  ->  store commit
 *
 * `adapter` mirrors the provenance adapter (null when the producer names
 * none) so the chain is self-contained. Mirror of T008's `CustodyChain`.
 */
export interface CustodyChain {
  readonly adapter: AdapterRef | null;
  readonly batch: BatchRef;
  readonly commit: CommitRef;
}

/**
 * Provenance block carried by every knowledge record. Structurally identical
 * to T008's `ProvenanceRecord` (origin, adapter, derived_from, transform,
 * corrections, custody) and — by width subtyping — a market-protocol
 * `Provenance`. The full 6-field contract; the bare 4-field
 * market-protocol block does NOT satisfy it (the store-layer extension is
 * required, exactly as in T008's `validateProvenanceRecord`).
 */
export interface KnowledgeProvenance {
  readonly origin: KnowledgeOrigin;
  readonly adapter: AdapterRef | null;
  readonly derived_from: readonly LineageId[];
  readonly transform: TransformId | null;
  /** Amendment refs issued against this record (append-only; a query-time view). */
  readonly corrections: readonly CorrectionRef[];
  /** adapter -> ingestion batch -> store commit. */
  readonly custody: CustodyChain;
}

// ---------------------------------------------------------------------------
// Runtime guards (mirror T008's guards field-for-field).
// ---------------------------------------------------------------------------

/** Runtime type guard for the origin discriminator. */
export function isKnowledgeOrigin(value: unknown): value is KnowledgeOrigin {
  return typeof value === 'string' && (KNOWLEDGE_ORIGINS as readonly string[]).includes(value);
}

/** Runtime type guard for an adapter reference (mirror of T008's isAdapterRef). */
export function isAdapterRef(value: unknown): value is AdapterRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.version === 'string' &&
    candidate.version.length > 0
  );
}

/** Runtime type guard for a correction reference. */
export function isCorrectionRef(value: unknown): value is CorrectionRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.correction_id === 'string' &&
    candidate.correction_id.length > 0 &&
    typeof candidate.reason === 'string' &&
    candidate.reason.length > 0
  );
}

/** Runtime type guard for a batch reference (mirror of T008's isBatchRef). */
export function isBatchRef(value: unknown): value is BatchRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).batch_id === 'string' &&
    ((value as Record<string, unknown>).batch_id as string).length > 0
  );
}

/**
 * Runtime type guard for a commit reference (mirror of T008's isCommitRef):
 * commit sequences are positive safe integers — the first commit is 1.
 */
export function isCommitRef(value: unknown): value is CommitRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.commit_id !== 'string' || candidate.commit_id.length === 0) return false;
  if (typeof candidate.commit_sequence !== 'number' || !Number.isSafeInteger(candidate.commit_sequence) || candidate.commit_sequence < 1) {
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

// ---------------------------------------------------------------------------
// Validation (the knowledge module's single-typed-error discipline over the
// T008 rule set; T008's validator collects every violation — parity with it
// is asserted on accept/reject in interop.test.ts, not on error style).
// ---------------------------------------------------------------------------

/** Validate one custody chain (rules mirror T008's validateCustodyChain). */
function validateCustody(value: unknown): KnowledgeResult<true> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('invalid_provenance', 'provenance.custody must be an object: adapter -> batch -> commit');
  }
  const custody = value as Record<string, unknown>;

  if (custody.adapter === undefined) {
    return fail('invalid_provenance', 'provenance.custody.adapter is required (null when the producer names none)');
  }
  if (custody.adapter !== null && !isAdapterRef(custody.adapter)) {
    return fail('invalid_provenance', 'provenance.custody.adapter must be an object with non-empty id and version, or null');
  }

  if (custody.batch === undefined) {
    return fail('invalid_provenance', 'provenance.custody.batch is required');
  }
  if (!isBatchRef(custody.batch)) {
    return fail('invalid_provenance', 'provenance.custody.batch.batch_id must be a non-empty string');
  }

  if (custody.commit === undefined) {
    return fail('invalid_provenance', 'provenance.custody.commit is required');
  }
  if (typeof custody.commit !== 'object' || custody.commit === null || Array.isArray(custody.commit)) {
    return fail('invalid_provenance', 'provenance.custody.commit must be an object with commit_id, commit_sequence and ingestion_time');
  }
  const commit = custody.commit as Record<string, unknown>;
  if (commit.commit_id === undefined) {
    return fail('invalid_provenance', 'provenance.custody.commit.commit_id is required');
  }
  if (typeof commit.commit_id !== 'string' || commit.commit_id.length === 0) {
    return fail('invalid_provenance', 'provenance.custody.commit.commit_id must be a non-empty string');
  }
  if (commit.commit_sequence === undefined) {
    return fail('invalid_provenance', 'provenance.custody.commit.commit_sequence is required');
  }
  if (typeof commit.commit_sequence !== 'number' || !Number.isSafeInteger(commit.commit_sequence) || commit.commit_sequence < 1) {
    return fail('invalid_provenance', 'provenance.custody.commit.commit_sequence must be a positive safe integer (the first commit is 1)');
  }
  if (commit.ingestion_time === undefined) {
    return fail('invalid_provenance', 'provenance.custody.commit.ingestion_time is required');
  }
  if (!isTimestampMs(commit.ingestion_time)) {
    return fail('invalid_provenance', 'provenance.custody.commit.ingestion_time must be a valid epoch-millisecond timestamp');
  }
  return ok(true);
}

/**
 * Validate a provenance block. `recordId` is the enclosing record's id,
 * needed for the self-reference rule. The rule set mirrors T008's
 * `validateProvenanceRecord` (first violation reported, time-engine
 * discipline):
 *
 *  1. `origin` must be one of the trichotomy.
 *  2. `adapter` must be a valid `{id, version}` when present and non-null,
 *     and MUST be non-null when origin is `historical`.
 *  3. `derived_from` must be an array of non-empty parent event ids, without
 *     duplicates and without the enclosing record's own id.
 *  4. `transform` must be non-empty iff `derived_from` is non-empty.
 *  5. `corrections` must be an array of `{correction_id, reason}` refs with
 *     non-empty strings.
 *  6. `custody` must be a valid chain: adapter (null or valid ref), batch
 *     (non-empty batch_id), commit (non-empty commit_id, positive safe
 *     commit_sequence >= 1, valid ingestion_time timestamp).
 */
export function validateKnowledgeProvenance(value: unknown, recordId: string): KnowledgeResult<true> {
  if (typeof value !== 'object' || value === null) {
    return fail('invalid_provenance', 'provenance must be an object');
  }
  const candidate = value as Record<string, unknown>;

  if (!isKnowledgeOrigin(candidate.origin)) {
    return fail('invalid_provenance', `provenance.origin must be one of ${KNOWLEDGE_ORIGINS.join(' | ')}`);
  }

  const origin = candidate.origin;
  if (candidate.adapter === undefined) {
    return fail('invalid_provenance', 'provenance.adapter is required (null when absent)');
  }
  if (candidate.adapter !== null) {
    if (!isAdapterRef(candidate.adapter)) {
      return fail('invalid_provenance', 'provenance.adapter must be an object with non-empty id and version');
    }
  } else if (origin === 'historical') {
    return fail(
      'invalid_provenance',
      'historical knowledge must reference the adapter that delivered it (id and version)',
    );
  }

  if (!Array.isArray(candidate.derived_from)) {
    return fail('invalid_provenance', 'provenance.derived_from must be an array of parent event ids');
  }
  const seen = new Set<string>();
  for (const parent of candidate.derived_from) {
    if (typeof parent !== 'string' || parent.length === 0) {
      return fail('invalid_provenance', 'every provenance.derived_from parent id must be a non-empty string');
    }
    if (parent === recordId) {
      return fail('invalid_provenance', 'a knowledge record may not list itself in its own event lineage');
    }
    if (seen.has(parent)) {
      return fail('invalid_provenance', `duplicate parent event id "${parent}" in provenance.derived_from`);
    }
    seen.add(parent);
  }

  const isDerived = candidate.derived_from.length > 0;
  if (candidate.transform === undefined) {
    return fail('invalid_provenance', 'provenance.transform is required (null when primitive)');
  }
  if (candidate.transform !== null) {
    if (typeof candidate.transform !== 'string' || candidate.transform.length === 0) {
      return fail('invalid_provenance', 'provenance.transform must be a non-empty string or null');
    }
    if (!isDerived) {
      return fail('invalid_provenance', 'a transform is only meaningful for derived knowledge (non-empty derived_from)');
    }
  } else if (isDerived) {
    return fail('invalid_provenance', 'derived knowledge must declare the transform that produced it');
  }

  if (candidate.corrections === undefined) {
    return fail('invalid_provenance', 'provenance.corrections is required (empty when no amendments were issued)');
  }
  if (!Array.isArray(candidate.corrections)) {
    return fail('invalid_provenance', 'provenance.corrections must be an array of amendment refs');
  }
  for (const ref of candidate.corrections) {
    if (!isCorrectionRef(ref)) {
      return fail('invalid_provenance', 'every provenance.corrections entry must be an object with non-empty correction_id and reason');
    }
  }

  if (candidate.custody === undefined) {
    return fail('invalid_provenance', 'provenance.custody is required');
  }
  const custodyResult = validateCustody(candidate.custody);
  if (!custodyResult.ok) return custodyResult;

  return ok(true);
}

/**
 * Structural guard without the enclosing record context (no self-reference
 * check). Mirrors T008's `isProvenanceRecord` field-for-field: the guard
 * checks the block's full SHAPE (origin, adapter validity, per-parent
 * non-emptiness, transform discipline, correction refs, custody chain);
 * the self-reference rule is the VALIDATOR's job
 * ({@link validateKnowledgeProvenance}). Use the validator for full
 * validation.
 */
export function isKnowledgeProvenance(value: unknown): value is KnowledgeProvenance {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isKnowledgeOrigin(candidate.origin)) return false;
  if (candidate.adapter !== null && !isAdapterRef(candidate.adapter)) return false;
  if (!Array.isArray(candidate.derived_from)) return false;
  if (!candidate.derived_from.every((parent) => typeof parent === 'string' && parent.length > 0)) return false;
  if (typeof candidate.transform !== 'string' || candidate.transform.length === 0) {
    if (candidate.transform !== null) return false;
  }
  if (candidate.origin === 'historical' && candidate.adapter === null) return false;
  const derived = candidate.derived_from.length > 0;
  if (derived && (typeof candidate.transform !== 'string' || candidate.transform.length === 0)) return false;
  if (!derived && candidate.transform !== null) return false;
  if (!Array.isArray(candidate.corrections)) return false;
  if (!candidate.corrections.every((ref) => isCorrectionRef(ref))) return false;
  return isCustodyChain(candidate.custody);
}

/**
 * The syntheticity predicate, mirrored from the event lane: knowledge is
 * synthetic iff its origin is not `historical`. Simulated and generated
 * knowledge is ALWAYS distinguishable from historical — the anti-poisoning
 * foundation (L5). Syntheticity never influences visibility (L4 origin-blind).
 */
export function isSyntheticKnowledge(provenance: KnowledgeProvenance): boolean {
  return provenance.origin !== 'historical';
}
