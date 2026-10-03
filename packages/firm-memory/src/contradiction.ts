/**
 * @tradrl/firm-memory — THE CONTRADICTION RECORD: the typed record of
 * one contested knowledge family (Work Order T034: "reconcile + dedupe
 * against existing knowledge (contradiction detection is a typed
 * record, never silent overwrite)").
 *
 * THE LAW: when a promotable candidate OPPOSES an existing (or
 * fellow-batch) claim in the same family — same (scope, kind,
 * discriminator), opposite polarity — the contest is APPENDED to the
 * contradiction register as one of these records. The incumbent is
 * never modified (the knowledge chain is append-only); the challenger
 * is only promoted when it STRICTLY DOMINATES (a strictly greater
 * distinct-outcome count than every opposing entry — the domination
 * rule, enforced again by the chain's append law). Hiding or rewriting
 * a contradiction is the typed `contradiction_log_rewrite` (the
 * register is its own hash-chained log — hiding the evidence that the
 * firm's knowledge is contested is as much a crime as hiding the
 * knowledge itself).
 *
 * THE TWO SIDES (exactly two, deterministically ordered):
 *   - `sides[0]` — the INCUMBENT side when one exists (carries its
 *     `fkr:` ref); for batch-internal contests, the
 *     lexicographically-smaller polarity side;
 *   - `sides[1]` — the other side (the challenger / the
 *     lexicographically-larger polarity).
 * Each side snapshots the contest-time facts: the knowledge ref (null
 * for batch candidates), the polarity, the aggregate confidence, the
 * distinct-outcome count, and the supporting outcome refs.
 */

import { fail, ok, type FirmMemoryResult } from './errors';
import { mintContradictionId } from './ids';
import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
  isTimestampMs,
  isUnitIntervalDecimal,
  type JsonValue,
  type TimestampMs,
} from './primitives';
import { isClaimPolarity, type ClaimPolarity } from './vocabulary';

// ---------------------------------------------------------------------------
// The sides
// ---------------------------------------------------------------------------

/** One side of a contradiction: the contest-time snapshot of one opposing claim. */
export interface ContradictionSide {
  /** The side's firm-knowledge ref (`fkr:`) when it is an existing entry; null when it is a batch candidate. */
  readonly knowledgeRef: string | null;
  readonly polarity: ClaimPolarity;
  /** The side's aggregate confidence (unit-interval decimal). */
  readonly confidence: string;
  /** The side's distinct-outcome count (>= 1). */
  readonly evidenceCount: number;
  /** The side's supporting outcome refs (`out:`, sorted unique). */
  readonly outcomeRefs: readonly string[];
}

/** Guard: one side (structural; the mint enforces the coherence laws). */
export function isContradictionSide(v: unknown): v is ContradictionSide {
  if (!isRecord(v)) return false;
  if (v.knowledgeRef !== null && !(isNonEmptyString(v.knowledgeRef) && (v.knowledgeRef as string).startsWith('fkr:'))) return false;
  if (!isClaimPolarity(v.polarity)) return false;
  if (typeof v.confidence !== 'string' || !isUnitIntervalDecimal(v.confidence)) return false;
  if (!isPositiveSafeInteger(v.evidenceCount)) return false;
  return Array.isArray(v.outcomeRefs) && v.outcomeRefs.every((x) => isNonEmptyString(x));
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * One contradiction record — the typed evidence that a knowledge
 * family is contested (see module header). JSON-serializable, deeply
 * frozen, content-addressed, chain-witnessed.
 */
export interface ContradictionRecord {
  /** Content-addressed identity: `fkc:` + digest of the canonical content. */
  readonly contradictionId: string;
  /** 1-based position in the contradiction register's sequence (append-only). */
  readonly ordinal: number;
  /** The tenant scope (L12). */
  readonly tenant: string;
  /** The project scope (L12/L15). */
  readonly project: string;
  /** The contested family's key (the canonical JSON of the discriminating fields — claim.ts). */
  readonly claimKey: string;
  /** The two opposing sides, deterministically ordered (see module header). */
  readonly sides: readonly [ContradictionSide, ContradictionSide];
  /** The contest instant (injected). */
  readonly asOf: TimestampMs;
  /** The contradiction register's head BEFORE this record was folded (the chain-continuity witness). */
  readonly priorChainHead: string;
}

/** Guard: a contradiction record (structural; the mint enforces the coherence laws). */
export function isContradictionRecord(v: unknown): v is ContradictionRecord {
  if (!isRecord(v)) return false;
  if (typeof v.contradictionId !== 'string' || !v.contradictionId.startsWith('fkc:')) return false;
  if (!isPositiveSafeInteger(v.ordinal)) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  if (typeof v.claimKey !== 'string' || v.claimKey === '') return false;
  if (!Array.isArray(v.sides) || v.sides.length !== 2 || !v.sides.every((x) => isContradictionSide(x))) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (typeof v.priorChainHead !== 'string' || v.priorChainHead === '') return false;
  return true;
}

/** The canonical content tree of a contradiction record (everything except the content-addressed id). */
export function contradictionContentTree(record: Omit<ContradictionRecord, 'contradictionId'>): JsonValue {
  return {
    ordinal: record.ordinal,
    tenant: record.tenant,
    project: record.project,
    claimKey: record.claimKey,
    sides: record.sides as unknown as JsonValue,
    asOf: record.asOf,
    priorChainHead: record.priorChainHead,
  };
}

// ---------------------------------------------------------------------------
// The mint
// ---------------------------------------------------------------------------

/**
 * Mint a contradiction record (content-addressed id; deeply frozen).
 * The coherence laws fire HERE, before any register append:
 *   - the two sides must carry OPPOSING polarities (`invalid_state` —
 *     a "contradiction" whose sides agree is not a contradiction);
 *   - each side's confidence must be a canonical unit-interval decimal
 *     (`confidence_incoherent` / `decimal_imprecision`);
 *   - each side's evidenceCount must be >= 1 and not exceed its
 *     outcome refs (`invalid_state`);
 *   - each side's outcome refs must be `out:`-prefixed and
 *     sorted-unique (`invalid_field` / `invalid_state`);
 *   - the incumbent side (when one exists) must be `sides[0]` and
 *     carry its `fkr:` ref (`invalid_state` — the deterministic
 *     ordering law);
 *   - the scope, ordinal, instant and prior head laws (`invalid_field`).
 */
export function mintContradictionRecord(record: Omit<ContradictionRecord, 'contradictionId'>): FirmMemoryResult<ContradictionRecord> {
  if (!isPositiveSafeInteger(record.ordinal)) {
    return fail('invalid_field', 'the contradiction record ordinal must be a positive safe integer (the 1-based register position)', 'ordinal');
  }
  if (!isNonEmptyString(record.tenant) || !isNonEmptyString(record.project)) {
    return fail('invalid_field', 'the contradiction record carries its tenant and project scopes (L12)', 'tenant');
  }
  if (typeof record.claimKey !== 'string' || record.claimKey === '') {
    return fail('invalid_field', 'the contradiction record carries the contested family key (claim.ts claimFamilyKey)', 'claimKey');
  }
  if (!Array.isArray(record.sides) || record.sides.length !== 2) {
    return fail('invalid_field', 'the contradiction record carries exactly two sides', 'sides');
  }
  if (!isTimestampMs(record.asOf)) {
    return fail('invalid_field', 'asOf must be an epoch-ms instant (injected — no ambient clock)', 'asOf');
  }
  if (typeof record.priorChainHead !== 'string' || record.priorChainHead === '') {
    return fail('invalid_field', 'priorChainHead must be a non-empty chain head (the register supplies it)', 'priorChainHead');
  }

  const sides: ContradictionSide[] = [];
  for (let index = 0; index < 2; index++) {
    const side = record.sides[index];
    // The exact-decimal trip wires fire BEFORE the structural guard (the T033 check-first pattern).
    if (isRecord(side) && typeof (side as { confidence?: unknown }).confidence === 'number') {
      return fail('decimal_imprecision', `sides[${index}].confidence carries a JS number — confidences are canonical unit-interval decimal STRINGs (float mediation is inexpressible)`, `sides[${index}].confidence`);
    }
    if (isRecord(side) && (typeof (side as { confidence?: unknown }).confidence === 'string' && !isUnitIntervalDecimal((side as { confidence: string }).confidence))) {
      return fail('confidence_incoherent', `sides[${index}].confidence ${JSON.stringify((side as { confidence?: unknown }).confidence)} is not a canonical unit-interval decimal (0 <= c <= 1)`, `sides[${index}].confidence`);
    }
    if (!isContradictionSide(side)) {
      return fail('invalid_field', `sides[${index}] fails the side guard (knowledgeRef, polarity, confidence, evidenceCount, outcomeRefs)`, `sides[${index}]`);
    }
    if (typeof side.confidence !== 'string' || !isUnitIntervalDecimal(side.confidence)) {
      return fail('confidence_incoherent', `sides[${index}].confidence ${JSON.stringify(side.confidence)} is not a canonical unit-interval decimal`, `sides[${index}].confidence`);
    }
    if (!isPositiveSafeInteger(side.evidenceCount)) {
      return fail('invalid_field', `sides[${index}].evidenceCount must be a positive safe integer`, `sides[${index}].evidenceCount`);
    }
    if (side.evidenceCount > side.outcomeRefs.length) {
      return fail('invalid_state', `sides[${index}].evidenceCount ${side.evidenceCount} exceeds its ${side.outcomeRefs.length} outcome refs (the coherence law)`, `sides[${index}].evidenceCount`);
    }
    for (const ref of side.outcomeRefs) {
      if (!ref.startsWith('out:')) {
        return fail('invalid_field', `sides[${index}].outcomeRefs ref ${JSON.stringify(ref)} violates the out: prefix grammar`, `sides[${index}].outcomeRefs`);
      }
    }
    const sorted = [...side.outcomeRefs].sort();
    for (let j = 1; j < sorted.length; j++) {
      if (sorted[j - 1] === sorted[j]) {
        return fail('invalid_state', `sides[${index}].outcomeRefs carries duplicate refs — side outcome lists are sorted-unique`, `sides[${index}].outcomeRefs`);
      }
    }
    sides.push(side);
  }

  // --- The opposition law ------------------------------------------------------
  const [first, second] = sides as [ContradictionSide, ContradictionSide];
  if (first.polarity === second.polarity) {
    return fail('invalid_state', `both sides carry polarity ${first.polarity} — a contradiction's sides must oppose (the same family, opposite polarities)`, 'sides');
  }

  // --- The deterministic ordering law --------------------------------------------
  const firstHasRef = first.knowledgeRef !== null;
  const secondHasRef = second.knowledgeRef !== null;
  if (firstHasRef && secondHasRef) {
    return fail('invalid_state', 'both sides carry fkr: refs — a contradiction contests a batch candidate against at most one existing entry (the ordering law)', 'sides');
  }
  if (secondHasRef && !firstHasRef) {
    return fail('invalid_state', 'the incumbent side (the fkr:-ref side) must be sides[0] — the deterministic ordering law', 'sides');
  }
  if (!firstHasRef && !secondHasRef && !(first.polarity < second.polarity)) {
    return fail('invalid_state', `batch-internal contest sides must be ordered by polarity lexicographic ascending (got ${first.polarity}, ${second.polarity}) — the deterministic ordering law`, 'sides');
  }

  const minted: Omit<ContradictionRecord, 'contradictionId'> = { ...record, sides: [first, second] };
  return ok(deepFreeze({ ...minted, contradictionId: mintContradictionId(fnv1a32Hex(canonicalJson(contradictionContentTree(minted)))) }));
}
