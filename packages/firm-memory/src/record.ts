/**
 * @tradrl/firm-memory — THE FIRM-KNOWLEDGE RECORD: the promoted,
 * deduplicated learning unit — the tenant-isolated organizational
 * memory's primary contract (Work Order T034: "the FirmKnowledgeRecord
 * (a promoted, deduplicated learning unit with provenance refs back to
 * its supporting post-mortems/outcomes/experiments, confidence,
 * validity window, and content address)").
 *
 * THE CONTENT (every field typed, never prose):
 *   - `claim`         — WHAT the firm knows (the closed-vocabulary
 *                       KnowledgeClaim; claim.ts);
 *   - `confidence`    — the aggregate degree, a canonical unit-interval
 *                       decimal — the declared aggregation is the
 *                       EXACT MINIMUM over the supporting hypotheses'
 *                       confidences (the weakest evidence bounds the
 *                       firm's claim; min is associative, so revisions
 *                       fold exactly: min(min(A), min(B)));
 *   - `evidenceCount` — how many DISTINCT learned outcomes support the
 *                       claim (>= 1 — the promotion policy's bar);
 *   - `provenance`    — the evidence chain (L9): the supporting
 *                       post-mortem refs (pmr:), outcome refs (out:),
 *                       the T011 experiment/trial/trajectory bindings
 *                       and the T030 session refs — every ref opaque,
 *                       prefix-checked, sorted-unique;
 *   - `validity`      — the decay window `[from, to)` (L4: from = the
 *                       promotion instant; the window is the policy's
 *                       declared freshness horizon — a decayed entry is
 *                       history, not active knowledge);
 *   - the chain witness fields (`ordinal`, `priorChainHead`) and the
 *     content-addressed identity (`fkr:` + digest of the canonical
 *     content tree).
 *
 * THE LAWS ENFORCED AT THE MINT ({@link mintFirmKnowledgeRecord}):
 * exact decimals (`decimal_imprecision` on a JS number on a confidence
 * path); the closed vocabularies (`unknown_knowledge_kind`,
 * `unknown_polarity`, `unknown_lag_band` via the claim mint); the
 * unit-interval law (`confidence_incoherent`); the L12 scope law
 * (tenant/project present on every record); the provenance law
 * (`lineage_gap` on zero post-mortem/outcome refs — knowledge without
 * its evidence chain dangles); the evidence-count coherence law
 * (`invalid_state` when evidenceCount exceeds the distinct outcome
 * refs); the validity law (`invalid_state` when to <= from, or when
 * from != asOf — the window opens exactly at the promotion instant);
 * the chain-witness law (`invalid_field` on a missing prior head).
 */

import { mintKnowledgeClaim, type KnowledgeClaim } from './claim';
import { fail, ok, type FirmMemoryResult } from './errors';
import { mintFirmKnowledgeId } from './ids';
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

// ---------------------------------------------------------------------------
// The provenance block (L9 — the evidence chain)
// ---------------------------------------------------------------------------

/**
 * The evidence chain of one firm-knowledge unit: the refs back to the
 * T033 post-mortems/outcomes that grounded it, plus the T011
 * experiment/trial/trajectory bindings and the T030 sessions the
 * evidence came from. Every list sorted-unique (determinism is a
 * construction law); every ref opaque, prefix-checked.
 */
export interface KnowledgeProvenance {
  /** The supporting T033 post-mortem refs (`pmr:`, sorted unique, >= 1). */
  readonly postMortemRefs: readonly string[];
  /** The supporting T033 outcome-record refs (`out:`, sorted unique, >= 1). */
  readonly outcomeRefs: readonly string[];
  /** The T011 experiment refs bound to the evidence (opaque, sorted unique; may be empty). */
  readonly experimentRefs: readonly string[];
  /** The T011 trial refs bound to the evidence (opaque, sorted unique; may be empty). */
  readonly trialRefs: readonly string[];
  /** The T011 trajectory refs bound to the evidence (opaque, sorted unique; may be empty). */
  readonly trajectoryRefs: readonly string[];
  /** The T030 shadow session refs the evidence came from (`shs:`, sorted unique, >= 1). */
  readonly sessionRefs: readonly string[];
}

/** Guard: the provenance block (structural; the mint enforces the non-emptiness laws). */
export function isKnowledgeProvenance(v: unknown): v is KnowledgeProvenance {
  if (!isRecord(v)) return false;
  const lists: readonly unknown[] = [v.postMortemRefs, v.outcomeRefs, v.experimentRefs, v.trialRefs, v.trajectoryRefs, v.sessionRefs];
  if (!lists.every((list) => Array.isArray(list) && list.every((x) => isNonEmptyString(x)))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The validity window (L4 — the decay horizon)
// ---------------------------------------------------------------------------

/** The validity window `[from, to)` — the knowledge's freshness horizon (from = the promotion instant). */
export interface ValidityWindow {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** Guard: the validity window (structural; the mint enforces to > from and from == asOf). */
export function isValidityWindow(v: unknown): v is ValidityWindow {
  if (!isRecord(v)) return false;
  return isTimestampMs(v.from) && isTimestampMs(v.to);
}

/** `true` iff the window covers the instant T (`from <= T < to`). */
export function windowCovers(window: ValidityWindow, at: TimestampMs): boolean {
  return (at as number) >= (window.from as number) && (at as number) < (window.to as number);
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * One firm-knowledge record — THE PRIMARY CONTRACT (see module
 * header). JSON-serializable, deeply frozen, lineage-complete,
 * content-addressed; promoted (never hand-authored: the service mints
 * these through the promotion pipeline; the mint below re-validates
 * every law so a forged record is inexpressible).
 */
export interface FirmKnowledgeRecord {
  /** Content-addressed identity: `fkr:` + digest of the canonical content. */
  readonly knowledgeId: string;
  /** 1-based position in the knowledge chain's sequence (append-only). */
  readonly ordinal: number;
  /** The tenant scope (L12 — the isolation root). */
  readonly tenant: string;
  /** The project scope (L12/L15 — the continuity root). */
  readonly project: string;
  /** WHAT the firm knows (the typed claim). */
  readonly claim: KnowledgeClaim;
  /** The aggregate confidence (unit-interval decimal; the MIN over the supporting confidences). */
  readonly confidence: string;
  /** The number of DISTINCT supporting outcome records (>= 1). */
  readonly evidenceCount: number;
  /** The evidence chain (L9). */
  readonly provenance: KnowledgeProvenance;
  /** The decay window `[from, to)`. */
  readonly validity: ValidityWindow;
  /** The promotion instant (injected; the validity window opens exactly here). */
  readonly asOf: TimestampMs;
  /** The knowledge chain's head BEFORE this record was folded (the chain-continuity witness). */
  readonly priorChainHead: string;
}

/** Guard: a firm-knowledge record (structural; the mint enforces the coherence laws). */
export function isFirmKnowledgeRecord(v: unknown): v is FirmKnowledgeRecord {
  if (!isRecord(v)) return false;
  if (typeof v.knowledgeId !== 'string' || !v.knowledgeId.startsWith('fkr:')) return false;
  if (!isPositiveSafeInteger(v.ordinal)) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  if (!isKnowledgeProvenance(v.provenance)) return false;
  if (!isValidityWindow(v.validity)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (typeof v.priorChainHead !== 'string' || v.priorChainHead === '') return false;
  return true;
}

/** The canonical content tree of a firm-knowledge record (everything except the content-addressed id). */
export function firmKnowledgeContentTree(record: Omit<FirmKnowledgeRecord, 'knowledgeId'>): JsonValue {
  return {
    ordinal: record.ordinal,
    tenant: record.tenant,
    project: record.project,
    claim: record.claim as unknown as JsonValue,
    confidence: record.confidence,
    evidenceCount: record.evidenceCount,
    provenance: record.provenance as unknown as JsonValue,
    validity: record.validity as unknown as JsonValue,
    asOf: record.asOf,
    priorChainHead: record.priorChainHead,
  };
}

// ---------------------------------------------------------------------------
// The sorted-unique discipline (determinism is a construction law)
// ---------------------------------------------------------------------------

/** Sort + deduplicate a ref list (the provenance mint's normalization — byte-stable). */
export function sortedUniqueRefs(refs: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(refs)].sort());
}

// ---------------------------------------------------------------------------
// The mint
// ---------------------------------------------------------------------------

/**
 * Mint a firm-knowledge record (content-addressed id; deeply frozen).
 * The coherence laws fire HERE, before any chain append:
 *   - the claim's closed vocabularies + coherence (via the claim mint);
 *   - `decimal_imprecision` — a JS number on the confidence path;
 *   - `confidence_incoherent` — a confidence outside the unit interval;
 *   - `lineage_gap` — provenance without post-mortem refs, without
 *     outcome refs, or without session refs (knowledge without its
 *     evidence chain dangles);
 *   - `invalid_field` — missing scope, ordinal, prior head, or
 *     malformed timestamps;
 *   - `invalid_state` — evidenceCount below 1 or exceeding the
 *     distinct outcome refs; a non-positive validity window; a window
 *     that does not open exactly at the promotion instant; ref-lists
 *     that are not sorted-unique; prefix-discipline violations on the
 *     provenance refs.
 */
export function mintFirmKnowledgeRecord(record: Omit<FirmKnowledgeRecord, 'knowledgeId'>): FirmMemoryResult<FirmKnowledgeRecord> {
  if (!isPositiveSafeInteger(record.ordinal)) {
    return fail('invalid_field', 'the firm-knowledge record ordinal must be a positive safe integer (the 1-based chain position)', 'ordinal');
  }
  if (!isNonEmptyString(record.tenant) || !isNonEmptyString(record.project)) {
    return fail('invalid_field', 'the firm-knowledge record carries its tenant and project scopes (L12)', 'tenant');
  }
  if (!isTimestampMs(record.asOf)) {
    return fail('invalid_field', 'asOf must be an epoch-ms instant (injected — no ambient clock)', 'asOf');
  }
  if (typeof record.priorChainHead !== 'string' || record.priorChainHead === '') {
    return fail('invalid_field', 'priorChainHead must be a non-empty chain head (the chain supplies it)', 'priorChainHead');
  }
  const claimResult = mintKnowledgeClaim(record.claim);
  if (!claimResult.ok) return claimResult;

  // --- The exact-decimal trip wires (a JS number on a confidence path) ---------
  if (typeof record.confidence === 'number') {
    return fail('decimal_imprecision', `the confidence field carries a JS number (${String(record.confidence)}) — confidences are canonical unit-interval decimal STRINGs (float mediation is inexpressible)`, 'confidence');
  }
  if (typeof record.confidence !== 'string' || !isUnitIntervalDecimal(record.confidence)) {
    return fail('confidence_incoherent', `confidence ${JSON.stringify(record.confidence)} is not a canonical unit-interval decimal (0 <= c <= 1) — the firm's aggregate degree is exact, never rounded`, 'confidence');
  }
  if (!isPositiveSafeInteger(record.evidenceCount)) {
    return fail('invalid_field', 'evidenceCount must be a positive safe integer (>= 1 distinct supporting outcomes)', 'evidenceCount');
  }

  // --- The provenance laws (L9) -------------------------------------------------
  if (!isKnowledgeProvenance(record.provenance)) {
    return fail('invalid_field', 'the provenance block must carry its six ref lists (post-mortems, outcomes, experiments, trials, trajectories, sessions)', 'provenance');
  }
  const provenance = record.provenance;
  if (provenance.postMortemRefs.length === 0) {
    return fail('lineage_gap', 'the provenance carries no post-mortem refs — firm knowledge without the post-mortems that grounded it dangles (L9)', 'provenance.postMortemRefs');
  }
  if (provenance.outcomeRefs.length === 0) {
    return fail('lineage_gap', 'the provenance carries no outcome refs — firm knowledge without the learned outcomes that evidence it dangles (L9)', 'provenance.outcomeRefs');
  }
  if (provenance.sessionRefs.length === 0) {
    return fail('lineage_gap', 'the provenance carries no session refs — firm knowledge without the shadow sessions its evidence came from dangles (L9)', 'provenance.sessionRefs');
  }
  const refChecks: readonly [readonly string[], string, string | null][] = [
    [provenance.postMortemRefs, 'provenance.postMortemRefs', 'pmr:'],
    [provenance.outcomeRefs, 'provenance.outcomeRefs', 'out:'],
    [provenance.sessionRefs, 'provenance.sessionRefs', 'shs:'],
    [provenance.experimentRefs, 'provenance.experimentRefs', null],
    [provenance.trialRefs, 'provenance.trialRefs', null],
    [provenance.trajectoryRefs, 'provenance.trajectoryRefs', null],
  ];
  for (const [refs, path, prefix] of refChecks) {
    for (const ref of refs) {
      if (prefix !== null && !ref.startsWith(prefix)) {
        return fail('invalid_field', `${path} ref ${JSON.stringify(ref)} violates the owning lane's ${JSON.stringify(prefix)} prefix grammar`, path);
      }
    }
    const sorted = [...refs].sort();
    for (let index = 1; index < sorted.length; index++) {
      if (sorted[index - 1] === sorted[index]) {
        return fail('invalid_state', `${path} carries duplicate refs — provenance lists are sorted-unique (determinism is a construction law)`, path);
      }
    }
  }
  if (record.evidenceCount > provenance.outcomeRefs.length) {
    return fail('invalid_state', `evidenceCount ${record.evidenceCount} exceeds the ${provenance.outcomeRefs.length} distinct outcome refs — the count is the distinct-outcome count (the coherence law)`, 'evidenceCount');
  }
  if (record.evidenceCount < 1) {
    return fail('invalid_state', 'evidenceCount must be >= 1 (a promoted claim is evidence-grounded by construction)', 'evidenceCount');
  }

  // --- The validity laws (L4) -----------------------------------------------------
  if (!isValidityWindow(record.validity)) {
    return fail('invalid_field', 'the validity window must carry two epoch-ms instants { from, to }', 'validity');
  }
  if ((record.validity.to as number) <= (record.validity.from as number)) {
    return fail('invalid_state', `the validity window [${String(record.validity.from)}, ${String(record.validity.to)}) is non-positive — knowledge cannot decay before it is promoted`, 'validity.to');
  }
  if ((record.validity.from as number) !== (record.asOf as number)) {
    return fail('invalid_state', `the validity window opens at ${String(record.validity.from)} but the record is promoted at ${String(record.asOf)} — the window opens exactly at the promotion instant (the coherence law)`, 'validity.from');
  }

  const minted: Omit<FirmKnowledgeRecord, 'knowledgeId'> = {
    ...record,
    claim: claimResult.value,
  };
  return ok(deepFreeze({ ...minted, knowledgeId: mintFirmKnowledgeId(fnv1a32Hex(canonicalJson(firmKnowledgeContentTree(minted)))) }));
}
