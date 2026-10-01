/**
 * @tradrl/evaluation-integrity — LEAKAGE DETECTION ACROSS THE LINEAGE
 * (Work Order T031).
 *
 * Spec anchors: the work order's own law — "any evaluation whose data
 * window overlaps the trial's optimization window WITHOUT EMBARGO is a
 * typed error"; spec/EVALUATION-PROTOCOL.md lines 21-24 ("Use unseen
 * periods ... not optimized against. ... Use walk-forward and purged/
 * embargoed designs where appropriate."); ARCHITECTURE-LOCK L4 (the data
 * windows are TimestampMs geometry), L11 (the lineage is the thing leaked
 * across).
 *
 * THE LEAKAGE LAW, precisely: a HOLDOUT-classified evaluation over a trial
 * is honest only when its data window is EMBARGO-SEPARATED from EVERY
 * in-search optimization window of the search record — no overlap, and a
 * gap of at least the demanded embargo. The embargo is resolved from the
 * SPLIT REGISTRY (the embargo authority — the registered purged/embargoed
 * or blind-holdout definition of the evaluation's split policy) or
 * declared explicitly; both paths are typed and fail-closed:
 *
 * - `leakage_without_embargo` — the evaluation window overlaps an
 *   optimization window, or the gap is narrower than the embargo. The data
 *   was (or could have been) optimized on; it is not unseen.
 * - `synthetic_holdout` — the evaluation claims holdout evidence over data
 *   of SYNTHETIC origin. The origin vocabulary ('historical' |
 *   'simulated' | 'generated') mirrors the market-protocol/T028
 *   provenance law: generative worlds are EXPLORATION instruments, not
 *   historical truth — T028 forbids generated data CLAIMING to be
 *   historical; this service forbids synthetic data SERVING as unseen
 *   holdout evidence. The two laws are complementary halves of L5 honesty.
 * - `classification_mismatch` — the claim's classification disagrees with
 *   the search record's (the record is the authority; claims do not
 *   reclassify trials).
 * - `unknown_trial` — the claim names a trial the record never logged.
 *
 * In-search evaluations overlapping their trial's optimization window are
 * CORRECT (in-search performance is measured on the optimization material
 * — that is the point of the in-search/holdout distinction).
 */

import { deepFreeze, isRecord, isTimestampMs, windowGap, windowsOverlap } from './primitives';
import type { TimestampMs } from './primitives';
import { isTrialId } from './ids';
import type { TrialId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type IntegrityError, type IntegrityResult } from './errors';
import { verifySearchLineage } from './search-mirror';
import type { SearchRecordMirror } from './search-mirror';
import { embargoOfPolicy, isSplitRegistry } from './splits';
import type { SplitRegistry } from './splits';

// ---------------------------------------------------------------------------
// The origin vocabulary — STRUCTURAL MIRROR of market-protocol/T028
// ---------------------------------------------------------------------------

/**
 * The data-origin vocabulary — STRUCTURAL MIRROR of @tradrl/market-protocol's
 * `EventOrigin` (T004) and the T028 generative records' provenance block:
 * 'historical' (recorded reality) | 'simulated' (engine-modeled) |
 * 'generated' (stochastic process). The interop trip-wires prove the
 * vocabulary against the real T028 lane.
 */
export type DataOriginMirror = 'historical' | 'simulated' | 'generated';

/** Runtime-checkable list (mirror of the program-wide origin vocabulary). */
export const DATA_ORIGINS_MIRROR: readonly DataOriginMirror[] = ['historical', 'simulated', 'generated'] as const;

/** Guard: a data origin (mirror). */
export function isDataOriginMirror(v: unknown): v is DataOriginMirror {
  return typeof v === 'string' && (DATA_ORIGINS_MIRROR as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The evaluation claim
// ---------------------------------------------------------------------------

/**
 * One evaluation claim against the lineage: the trial evaluated, the
 * asserted classification, the data window evaluated over, the origin of
 * that data, and the split policy the evaluation ran under.
 */
export interface EvaluationClaim {
  readonly trial: TrialId;
  /** What the claim asserts (must agree with the record — the record is the authority). */
  readonly classification: 'in-search' | 'holdout';
  /** The data window the evaluation covered ([start, end); null = non-windowed material). */
  readonly window: { readonly start: TimestampMs; readonly end: TimestampMs } | null;
  /** The origin of the evaluated data (the T028/market-protocol vocabulary mirror). */
  readonly origin: DataOriginMirror;
  /** The split policy the evaluation ran under (the registry resolves its embargo). */
  readonly policy: string;
}

/** Guard: `EvaluationClaim`. */
export function isEvaluationClaim(v: unknown): v is EvaluationClaim {
  if (!isRecord(v)) return false;
  if (!isTrialId(v.trial)) return false;
  if (v.classification !== 'in-search' && v.classification !== 'holdout') return false;
  if (v.window !== null) {
    if (!isRecord(v.window)) return false;
    if (!isTimestampMs(v.window.start) || !isTimestampMs(v.window.end)) return false;
    if (v.window.end <= v.window.start) return false;
  }
  if (!isDataOriginMirror(v.origin)) return false;
  return typeof v.policy === 'string' && v.policy.trim().length > 0;
}

/** Collect-all validation of an untrusted evaluation claim. */
export function validateEvaluationClaim(value: unknown, path = 'claim'): IntegrityResult<EvaluationClaim> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: IntegrityError[] = [];
  if (value.trial === undefined) errors.push(missingField(`${path}.trial`));
  else if (!isTrialId(value.trial)) errors.push(invalidField(`${path}.trial`, 'must be a non-empty trial id'));
  if (value.classification === undefined) errors.push(missingField(`${path}.classification`));
  else if (value.classification !== 'in-search' && value.classification !== 'holdout') {
    errors.push(invalidField(`${path}.classification`, "must be 'in-search' or 'holdout'"));
  }
  if (value.window === undefined) errors.push(missingField(`${path}.window`));
  else if (value.window !== null) {
    if (!isRecord(value.window)) {
      errors.push(invalidField(`${path}.window`, 'must be { start, end } or null'));
    } else {
      if (!isTimestampMs(value.window.start) || !isTimestampMs(value.window.end) || value.window.end <= value.window.start) {
        errors.push(invalidField(`${path}.window`, 'must be { start, end } with end > start (TimestampMs), or null'));
      }
    }
  }
  if (value.origin === undefined) errors.push(missingField(`${path}.origin`));
  else if (!isDataOriginMirror(value.origin)) {
    errors.push(invalidField(`${path}.origin`, `must be one of ${DATA_ORIGINS_MIRROR.join(' | ')}`));
  }
  if (value.policy === undefined) errors.push(missingField(`${path}.policy`));
  else if (typeof value.policy !== 'string' || value.policy.trim().length === 0) {
    errors.push(invalidField(`${path}.policy`, 'must be a non-empty split policy ref'));
  }
  if (errors.length > 0) return { ok: false, errors };
  return ok(deepFreeze({ ...(value as object) } as EvaluationClaim));
}

// ---------------------------------------------------------------------------
// The embargo resolution
// ---------------------------------------------------------------------------

/**
 * The embargo source: either the SPLIT REGISTRY (resolve the embargo from
 * the evaluation policy's registered definition — the authority path) or
 * an EXPLICIT declaration (the caller states the separation demanded).
 * Exactly one source; the resolution is typed and fail-closed.
 */
export type EmbargoSource =
  | { readonly source: 'registry'; readonly registry: SplitRegistry }
  | { readonly source: 'declared'; readonly embargoMs: number };

/** Guard: `EmbargoSource`. */
export function isEmbargoSource(v: unknown): v is EmbargoSource {
  if (!isRecord(v)) return false;
  if (v.source === 'registry') return isSplitRegistry(v.registry);
  if (v.source === 'declared') return typeof v.embargoMs === 'number' && Number.isInteger(v.embargoMs) && v.embargoMs >= 0;
  return false;
}

function resolveEmbargo(embargo: EmbargoSource, policy: string): IntegrityResult<number> {
  if (embargo.source === 'declared') return ok(embargo.embargoMs);
  return embargoOfPolicy(embargo.registry, policy);
}

// ---------------------------------------------------------------------------
// The leakage check
// ---------------------------------------------------------------------------

/** The result of a clean leakage check over one evaluation claim. */
export interface LeakageCheck {
  readonly trial: string;
  /** The resolved embargo (ms) the claim's policy demanded. */
  readonly embargoMs: number;
  /** The minimal gap found between the claim's window and any in-search optimization window. */
  readonly minGap: number | null;
  /** The number of in-search optimization windows the claim was checked against. */
  readonly checkedAgainst: number;
}

/**
 * The WINDOW LAW for one holdout trial of a VERIFIED record: the entry must
 * carry a data window, and that window must be embargo-separated from EVERY
 * in-search optimization window. Exposed separately so the selection audit
 * can run the window law over EVERY holdout entry of the record — a holdout
 * window overlapping optimization material is a leak in the record whether
 * or not a statistic was ever supplied for it.
 */
export function checkHoldoutWindowSeparation(
  record: SearchRecordMirror,
  trial: TrialId,
  embargo: EmbargoSource,
): IntegrityResult<{ readonly embargoMs: number; readonly minGap: number | null; readonly checkedAgainst: number }> {
  const entry = record.entries.find((candidate) => candidate.trial === trial);
  if (entry === undefined) {
    return fail('unknown_trial', `holdout window check names trial "${trial}" which the search record does not contain`, 'trial');
  }
  if (entry.classification !== 'holdout') {
    return fail('classification_mismatch', `holdout window check names trial "${trial}" which the record classified as "${entry.classification}"`, 'trial');
  }
  if (entry.window === null) {
    return fail('invalid_field', `holdout trial "${trial}" carries no data window — a holdout evaluation attests a window, and the leakage law needs its geometry`, 'window');
  }
  const embargoResult = resolveEmbargo(embargo, entry.evaluation_policy);
  if (!embargoResult.ok) return embargoResult;
  const embargoMs = embargoResult.value;

  const evaluationWindow = { start: entry.window.start, end: entry.window.end };
  let minGap: number | null = null;
  let checkedAgainst = 0;
  for (const candidate of record.entries) {
    if (candidate.classification !== 'in-search') continue;
    if (candidate.window === null) continue; // non-windowed optimization material has no geometry to leak
    checkedAgainst += 1;
    const gap = windowGap(evaluationWindow, candidate.window);
    if (minGap === null || gap < minGap) minGap = gap;
    if (windowsOverlap(evaluationWindow, candidate.window) || gap < embargoMs) {
      const overlap = windowsOverlap(evaluationWindow, candidate.window);
      return fail(
        'leakage_without_embargo',
        `holdout evaluation of trial "${trial}" over [${evaluationWindow.start}, ${evaluationWindow.end}) ${overlap ? 'OVERLAPS' : `is only ${gap} ms from`} the optimization window of in-search trial "${candidate.trial}" [${candidate.window.start}, ${candidate.window.end}) — the demanded embargo is ${embargoMs} ms (R20/R21)`,
        'window',
      );
    }
  }
  return ok({ embargoMs, minGap, checkedAgainst });
}

/**
 * Detect leakage for ONE evaluation claim against the search lineage.
 *
 * Laws (each typed, fail-closed; see the module header):
 * 1. The record verifies (`chain_mismatch` propagates).
 * 2. The claim is structurally valid; its trial exists (`unknown_trial`)
 *    and its classification agrees with the record's
 *    (`classification_mismatch`).
 * 3. HOLDOUT claims: origin must be 'historical' (`synthetic_holdout`);
 *    the claim must carry a data window (a windowless holdout attests
 *    nothing geometric — `invalid_field`); the window must be
 *    embargo-separated from EVERY in-search optimization window
 *    (`leakage_without_embargo`).
 * 4. IN-SEARCH claims: no window law (in-search performance is measured on
 *    the optimization material — that is the distinction the protocol
 *    demands be drawn).
 */
export function detectLeakage(search: unknown, claim: unknown, embargo: unknown): IntegrityResult<LeakageCheck> {
  const verified = verifySearchLineage(search);
  if (!verified.ok) return verified;
  const record = verified.value;

  const claimResult = validateEvaluationClaim(claim);
  if (!claimResult.ok) return claimResult;
  const value = claimResult.value;

  if (!isEmbargoSource(embargo)) {
    return { ok: false, errors: [invalidField('embargo', "must be { source: 'registry', registry } or { source: 'declared', embargoMs >= 0 }")] };
  }
  const embargoSource = embargo as EmbargoSource;

  const entry = record.entries.find((candidate) => candidate.trial === value.trial);
  if (entry === undefined) {
    return fail('unknown_trial', `claim names trial "${value.trial}" which the search record does not contain`, 'claim.trial');
  }
  if (entry.classification !== value.classification) {
    return fail(
      'classification_mismatch',
      `claim asserts "${value.classification}" but the search record classified trial "${value.trial}" as "${entry.classification}" — the record is the authority`,
      'claim.classification',
    );
  }

  const embargoResult = resolveEmbargo(embargoSource, value.policy);
  if (!embargoResult.ok) return embargoResult;
  const embargoMs = embargoResult.value;

  if (value.classification !== 'holdout') {
    // In-search: the optimization material IS the evaluation material.
    return ok(deepFreeze({ trial: value.trial, embargoMs, minGap: null, checkedAgainst: 0 } satisfies LeakageCheck));
  }

  if (value.origin !== 'historical') {
    return fail(
      'synthetic_holdout',
      `holdout claim over trial "${value.trial}" declares origin "${value.origin}" — synthetic worlds are exploration instruments, not unseen historical truth (L5)`,
      'claim.origin',
    );
  }
  if (value.window === null) {
    // The record is the authority on holdout windows: the window law runs
    // over the ENTRY's own window (and demands it exist).
    const separation = checkHoldoutWindowSeparation(record, value.trial, embargoSource);
    if (!separation.ok) return separation;
    return ok(deepFreeze({ trial: value.trial, embargoMs: separation.value.embargoMs, minGap: separation.value.minGap, checkedAgainst: separation.value.checkedAgainst } satisfies LeakageCheck));
  }

  const embargoResult2 = resolveEmbargo(embargoSource, value.policy);
  if (!embargoResult2.ok) return embargoResult2;
  const claimedEmbargoMs = embargoResult2.value;
  const evaluationWindow = { start: value.window.start, end: value.window.end };
  let minGap: number | null = null;
  let checkedAgainst = 0;
  for (const candidate of record.entries) {
    if (candidate.classification !== 'in-search') continue;
    if (candidate.window === null) continue; // non-windowed optimization material has no geometry to leak
    checkedAgainst += 1;
    const gap = windowGap(evaluationWindow, candidate.window);
    if (minGap === null || gap < minGap) minGap = gap;
    if (windowsOverlap(evaluationWindow, candidate.window) || gap < claimedEmbargoMs) {
      const overlap = windowsOverlap(evaluationWindow, candidate.window);
      return fail(
        'leakage_without_embargo',
        `holdout evaluation of trial "${value.trial}" over [${evaluationWindow.start}, ${evaluationWindow.end}) ${overlap ? 'OVERLAPS' : `is only ${gap} ms from`} the optimization window of in-search trial "${candidate.trial}" [${candidate.window.start}, ${candidate.window.end}) — the demanded embargo is ${claimedEmbargoMs} ms (R20/R21)`,
        'claim.window',
      );
    }
  }

  return ok(deepFreeze({ trial: value.trial, embargoMs: claimedEmbargoMs, minGap, checkedAgainst } satisfies LeakageCheck));
}
