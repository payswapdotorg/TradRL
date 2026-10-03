/**
 * @tradrl/firm-memory — THE MEMORY CHAINS: the two append-only,
 * chain-verified logs of the firm-memory lane (Work Order T034: "the
 * memory CHAIN (append-only, hash-chained like T030/T031 precedents —
 * rewriting or hiding a knowledge entry is a typed error)").
 *
 * THE FOLD LAW (T030's, mirrored exactly — the T031 search-lineage and
 * T033 outcome logs take the same law): every append folds the
 * record's canonical content onto the chain head —
 * `fnv1a32(priorHead + canonicalJson(contentTree))` — from the seed
 * `00000000`. A rewrite (an out-of-order ordinal, a spliced record, a
 * foreign chain head, a non-monotonic per-family supersession, a
 * same-family polarity flip without dominating evidence) is the TYPED
 * crime — `firm_log_rewrite` for the knowledge chain,
 * `contradiction_log_rewrite` for the contradiction register — never a
 * silent edit. Verification ({@link verifyFirmKnowledgeChain} /
 * {@link verifyContradictionChain}) re-derives the whole fold: a
 * tampered record, a removed record (HIDING a knowledge entry or a
 * contradiction) or a reordered log fails — the serving surface refuses
 * to serve from a tampered brain (the typed `chain_mismatch`).
 *
 * THE APPEND LAWS (the knowledge chain):
 *   1. the record's ordinal is exactly the next position (a splice, a
 *      reorder or a truncation is the crime);
 *   2. the record's `priorChainHead` is the chain's head (the record
 *      was minted against THIS history);
 *   3. PER-FAMILY MONOTONICITY: within one (scope, family) the
 *      appends are strictly forward in time — a record whose asOf is
 *      not strictly later than every same-family entry is the rewrite
 *      crime (same-instant re-decision is the crime);
 *   4. THE DOMINATION LAW: a same-family record with the OPPOSITE
 *      polarity to an existing entry (a supersession attempt — the
 *      firm changing its position) must carry a STRICTLY greater
 *      evidenceCount than EVERY opposing entry — otherwise the typed
 *      `contradiction_detected` (a polarity flip without dominating
 *      evidence; the contradiction register is the only path). A
 *      same-polarity record is a REVISION (evidence accumulation —
 *      always legal, the dedupe fold's whole point).
 *
 * THE APPEND LAWS (the contradiction register): the ordinal is exactly
 * the next position; the priorChainHead is the register's head. Every
 * contradiction is a first-class record; hiding one is the crime.
 */

import { claimFamilyKey, type KnowledgeClaim } from './claim';
import { mintContradictionRecord, type ContradictionRecord } from './contradiction';
import { fail, ok, type FirmMemoryResult } from './errors';
import { mintFirmKnowledgeRecord, type FirmKnowledgeRecord } from './record';
import { canonicalJson, deepFreeze, fnv1a32Hex, isDigest, isRecord } from './primitives';

// ---------------------------------------------------------------------------
// The firm-knowledge chain
// ---------------------------------------------------------------------------

/** The chain seed of a fresh knowledge chain (T030's seed, mirrored). */
export const FIRM_MEMORY_CHAIN_SEED = '00000000';

/** The append-only, chain-verified firm-knowledge chain (the organizational memory). */
export interface FirmKnowledgeLog {
  readonly records: readonly FirmKnowledgeRecord[];
  /** The chain head (the fold over every record's canonical content; the seed before any record). */
  readonly head: string;
}

/** Start a fresh knowledge chain (no records; head = the seed). */
export function startFirmKnowledgeLog(): FirmKnowledgeLog {
  return deepFreeze({ records: [], head: FIRM_MEMORY_CHAIN_SEED });
}

/** Fold one firm-knowledge record onto the chain head. */
function foldFirmKnowledgeRecord(previousHead: string, record: FirmKnowledgeRecord): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson({
    ordinal: record.ordinal,
    tenant: record.tenant,
    project: record.project,
    claim: record.claim,
    confidence: record.confidence,
    evidenceCount: record.evidenceCount,
    provenance: record.provenance,
    validity: record.validity,
    asOf: record.asOf,
    priorChainHead: record.priorChainHead,
  })}`);
}

/** The family key of a record (scope + claim discriminating fields — polarity excluded). */
function familyKeyOf(record: FirmKnowledgeRecord): string {
  return claimFamilyKey(record.claim, { tenant: record.tenant, project: record.project });
}

/**
 * Append ONE firm-knowledge record — the append-only law's enforcement
 * site (the four laws of the module header). Fails with the typed
 * `firm_log_rewrite` on an ordinal splice, a foreign chain head or a
 * non-monotonic same-family append; with the typed
 * `contradiction_detected` on a same-family polarity flip that does
 * not strictly dominate the opposing evidence (the register is the
 * only path); with the record mint's own typed errors on a malformed
 * record.
 */
export function appendFirmKnowledge(log: FirmKnowledgeLog, record: unknown): FirmMemoryResult<FirmKnowledgeLog> {
  if (!isRecord(log) || !Array.isArray(log.records) || typeof log.head !== 'string' || !isDigest(log.head)) {
    return fail('invalid_type', 'appendFirmKnowledge requires a valid firm-knowledge chain');
  }
  if (!isRecord(record)) {
    return fail('invalid_type', 'appendFirmKnowledge requires a firm-knowledge record');
  }
  const ordinal = (record as { ordinal?: unknown }).ordinal;
  if (typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal) || ordinal !== log.records.length + 1) {
    return fail(
      'firm_log_rewrite',
      `the firm-knowledge record claims ordinal ${JSON.stringify(ordinal)}, but the chain's next position is ${log.records.length + 1} — the knowledge chain is append-only; splicing, reordering and truncation are the typed rewrite crime`,
    );
  }
  const priorChainHead = (record as { priorChainHead?: unknown }).priorChainHead;
  if (typeof priorChainHead !== 'string' || priorChainHead !== log.head) {
    return fail(
      'firm_log_rewrite',
      `the firm-knowledge record was minted against chain head ${JSON.stringify(priorChainHead)}, but the chain's head is ${log.head} — the record belongs to a different history (rewrite)`,
    );
  }
  // Mint AFTER the chain-witness checks so the mint's content address covers the true prior head (the mint re-derives the same id).
  const minted = mintFirmKnowledgeRecord(record as Omit<FirmKnowledgeRecord, 'knowledgeId'>);
  if (!minted.ok) return minted;
  const next = minted.value;

  // --- The per-family laws (3 + 4) -------------------------------------------------
  const family = familyKeyOf(next);
  const familyEntries = log.records.filter((existing) => familyKeyOf(existing) === family);
  for (const existing of familyEntries) {
    if ((next.asOf as number) <= (existing.asOf as number)) {
      return fail(
        'firm_log_rewrite',
        `firm-knowledge record ${next.knowledgeId} appends into family ${family} at instant ${String(next.asOf)}, not strictly later than the existing entry ${existing.knowledgeId} at ${String(existing.asOf)} — per-family supersession is by STRICTLY forward append only (same-instant re-decision is the rewrite crime)`,
      );
    }
    if (existing.claim.polarity !== next.claim.polarity && next.evidenceCount <= existing.evidenceCount) {
      return fail(
        'contradiction_detected',
        `firm-knowledge record ${next.knowledgeId} flips family ${family} from ${existing.claim.polarity} to ${next.claim.polarity} with evidenceCount ${next.evidenceCount}, not strictly greater than the incumbent's ${existing.evidenceCount} — a polarity flip must DOMINATE through evidence; the contradiction register is the only path (never a silent overwrite)`,
      );
    }
  }

  const head = foldFirmKnowledgeRecord(log.head, next);
  return ok(deepFreeze({ records: [...log.records, next], head }));
}

/**
 * Re-derive the knowledge chain's fold from its records. `true` iff
 * the recorded head folds identically — a tampered record, a REMOVED
 * record (hiding a knowledge entry) or a reordered chain fails (the
 * verification gate's tamper anchor).
 */
export function verifyFirmKnowledgeChain(log: unknown): boolean {
  if (!isRecord(log) || !Array.isArray(log.records) || typeof log.head !== 'string') return false;
  let head = FIRM_MEMORY_CHAIN_SEED;
  for (let index = 0; index < log.records.length; index++) {
    const record = log.records[index];
    if (!isRecord(record) || typeof (record as { knowledgeId?: unknown }).knowledgeId !== 'string') return false;
    if ((record as { ordinal?: unknown }).ordinal !== index + 1) return false;
    head = foldFirmKnowledgeRecord(head, record as unknown as FirmKnowledgeRecord);
  }
  return head === log.head;
}

/** Guard: a firm-knowledge chain (structural; the chain law is {@link verifyFirmKnowledgeChain}). */
export function isFirmKnowledgeLog(v: unknown): v is FirmKnowledgeLog {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.records) || !v.records.every((x) => isRecord(x) && typeof (x as { knowledgeId?: unknown }).knowledgeId === 'string' && (x as { knowledgeId: string }).knowledgeId.startsWith('fkr:'))) return false;
  if (typeof v.head !== 'string' || !isDigest(v.head)) return false;
  return true;
}

/** The digest of a knowledge chain's records (the determinism comparator's basis). */
export function firmKnowledgeLogDigest(log: FirmKnowledgeLog): string {
  return fnv1a32Hex(canonicalJson({
    records: log.records.map((record) => ({
      knowledgeId: record.knowledgeId,
      family: familyKeyOf(record),
      polarity: record.claim.polarity,
      confidence: record.confidence,
      evidenceCount: record.evidenceCount,
    })),
    head: log.head,
  }));
}

// ---------------------------------------------------------------------------
// The contradiction register
// ---------------------------------------------------------------------------

/** The chain seed of a fresh contradiction register (the same fold law). */
export const CONTRADICTION_CHAIN_SEED = '00000000';

/** The append-only, chain-verified contradiction register (the contested-knowledge evidence). */
export interface ContradictionLog {
  readonly records: readonly ContradictionRecord[];
  readonly head: string;
}

/** Start a fresh contradiction register (no records; head = the seed). */
export function startContradictionLog(): ContradictionLog {
  return deepFreeze({ records: [], head: CONTRADICTION_CHAIN_SEED });
}

/** Fold one contradiction record onto the register head. */
function foldContradictionRecord(previousHead: string, record: ContradictionRecord): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson({
    ordinal: record.ordinal,
    tenant: record.tenant,
    project: record.project,
    claimKey: record.claimKey,
    sides: record.sides,
    asOf: record.asOf,
    priorChainHead: record.priorChainHead,
  })}`);
}

/**
 * Append ONE contradiction record — the append-only law's enforcement
 * site: the typed `contradiction_log_rewrite` on an ordinal splice or
 * a foreign register head; the mint's own typed errors on a malformed
 * record. Hiding a contradiction is exactly the truncation this
 * rejects (and `verifyContradictionChain` re-derives).
 */
export function appendContradiction(log: ContradictionLog, record: unknown): FirmMemoryResult<ContradictionLog> {
  if (!isRecord(log) || !Array.isArray(log.records) || typeof log.head !== 'string' || !isDigest(log.head)) {
    return fail('invalid_type', 'appendContradiction requires a valid contradiction register');
  }
  if (!isRecord(record)) {
    return fail('invalid_type', 'appendContradiction requires a contradiction record');
  }
  const ordinal = (record as { ordinal?: unknown }).ordinal;
  if (typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal) || ordinal !== log.records.length + 1) {
    return fail(
      'contradiction_log_rewrite',
      `the contradiction record claims ordinal ${JSON.stringify(ordinal)}, but the register's next position is ${log.records.length + 1} — the contradiction register is append-only; splicing, reordering and truncation (hiding a contradiction) are the typed rewrite crime`,
    );
  }
  const priorChainHead = (record as { priorChainHead?: unknown }).priorChainHead;
  if (typeof priorChainHead !== 'string' || priorChainHead !== log.head) {
    return fail(
      'contradiction_log_rewrite',
      `the contradiction record was minted against register head ${JSON.stringify(priorChainHead)}, but the register's head is ${log.head} — the record belongs to a different history (rewrite)`,
    );
  }
  const minted = mintContradictionRecord(record as Omit<ContradictionRecord, 'contradictionId'>);
  if (!minted.ok) return minted;
  const head = foldContradictionRecord(log.head, minted.value);
  return ok(deepFreeze({ records: [...log.records, minted.value], head }));
}

/**
 * Re-derive the contradiction register's fold from its records —
 * `true` iff the recorded head folds identically (hiding or editing a
 * contradiction fails).
 */
export function verifyContradictionChain(log: unknown): boolean {
  if (!isRecord(log) || !Array.isArray(log.records) || typeof log.head !== 'string') return false;
  let head = CONTRADICTION_CHAIN_SEED;
  for (let index = 0; index < log.records.length; index++) {
    const record = log.records[index];
    if (!isRecord(record) || typeof (record as { contradictionId?: unknown }).contradictionId !== 'string') return false;
    if ((record as { ordinal?: unknown }).ordinal !== index + 1) return false;
    head = foldContradictionRecord(head, record as unknown as ContradictionRecord);
  }
  return head === log.head;
}

/** Guard: a contradiction register (structural; the chain law is {@link verifyContradictionChain}). */
export function isContradictionLog(v: unknown): v is ContradictionLog {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.records) || !v.records.every((x) => isRecord(x) && typeof (x as { contradictionId?: unknown }).contradictionId === 'string' && (x as { contradictionId: string }).contradictionId.startsWith('fkc:'))) return false;
  if (typeof v.head !== 'string' || !isDigest(v.head)) return false;
  return true;
}

/** The digest of a contradiction register's records (the determinism comparator's basis). */
export function contradictionLogDigest(log: ContradictionLog): string {
  return fnv1a32Hex(canonicalJson({
    records: log.records.map((record) => ({
      contradictionId: record.contradictionId,
      claimKey: record.claimKey,
      sides: record.sides.map((side) => ({ polarity: side.polarity, evidenceCount: side.evidenceCount, ref: side.knowledgeRef })),
    })),
    head: log.head,
  }));
}

/** Re-export for the family-key derivation's consumers (the serving projection). */
export { claimFamilyKey as knowledgeFamilyKey };
export type { KnowledgeClaim };
