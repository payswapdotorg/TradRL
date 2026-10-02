/**
 * @tradrl/outcomes — the ATTRIBUTION CONTRACTS: the four attribution
 * classes and their typed payloads (Work Order T033: "attribution
 * (decision, market-move, model-error, data-lag classes — each a typed
 * record, never prose-only)").
 *
 * EVERY hypothesis is a typed record: the class (a member of the
 * closed four-member vocabulary — a fifth is the typed
 * `unknown_attribution_class`), the confidence (a canonical unit-
 * interval decimal — outside it is the typed
 * `confidence_incoherent`), a class-specific TYPED payload (never a
 * prose blob), and the evidence references that ground it. An optional
 * human-facing note may ACCOMPANY the typed payload, never replace it.
 *
 * THE FOUR CLASSES AND THEIR TYPED FACTS:
 *   - `decision`     — the decision's own parameters plausibly caused
 *                      the gap. Payload: the implicated dimension
 *                      (timing / sizing / selection / price /
 *                      risk_calibration — `unresolved` while the
 *                      evidence does not yet discriminate; drafts mint
 *                      `unresolved` and downstream refinement narrows).
 *   - `market_move`  — the market moved between the decision instant
 *                      and the outcome window. Payload: the mark at
 *                      decision, the mark at window close, and the
 *                      direction RELATIVE TO THE POSITION THE DECISION
 *                      BUILT (adverse / favorable / flat — exact
 *                      decimals, never adjectives about prices alone).
 *   - `model_error`  — the projecting model missed. Payload: the
 *                      projected value, the realized value, and the
 *                      error kind (projection_bias / calibration_stale
 *                      / regime_miss / feature_gap — `unresolved`
 *                      while single-sample evidence cannot
 *                      discriminate).
 *   - `data_lag`     — information arrived after the decision. Payload
 *                      the L4 facts: the decision instant, the
 *                      evidence's availability instant, and the exact
 *                      lag in milliseconds (availability AFTER
 *                      decision — the point-in-time boundary's own
 *                      evidence).
 *
 * THE ORDERING LAW: a hypothesis list is emitted in the canonical
 * order (confidence descending, then class ascending) — determinism is
 * a construction law, enforced at the mint (`invalid_state` on an
 * unsorted list). Confidence values are the drafter's honest degrees;
 * co-occurrence is legal (several causes may have contributed — the
 * confidences are NOT forced to sum to 1; mutual exclusivity would be
 * a false constraint, documented here as the declared interpretation).
 */

import { fail, ok, type OutcomesResult } from './errors';
import { isNonEmptyString, isRecord, isTimestampMs, isUnitIntervalDecimal, type TimestampMs } from './primitives';
import type { EvidenceRef } from './evidence';

// ---------------------------------------------------------------------------
// The closed attribution-class vocabulary
// ---------------------------------------------------------------------------

/** The closed attribution-class vocabulary (four members; a fifth is an architecture change). */
export const ATTRIBUTION_CLASSES = ['decision', 'market_move', 'model_error', 'data_lag'] as const;

/** One attribution class. */
export type AttributionClass = (typeof ATTRIBUTION_CLASSES)[number];

/** Guard: an attribution class. */
export function isAttributionClass(v: unknown): v is AttributionClass {
  return typeof v === 'string' && (ATTRIBUTION_CLASSES as readonly string[]).includes(v);
}

/**
 * Require an attribution class — the closed-vocabulary enforcement
 * site: an unknown class string is the typed
 * `unknown_attribution_class`, never a silent coercion.
 */
export function requireAttributionClass(v: unknown): OutcomesResult<AttributionClass> {
  if (!isAttributionClass(v)) {
    return fail(
      'unknown_attribution_class',
      `${JSON.stringify(v)} is not an attribution class — the vocabulary is closed: ${ATTRIBUTION_CLASSES.join(' | ')} (decision, market-move, model-error, data-lag are the whole space)`,
    );
  }
  return ok(v);
}

// ---------------------------------------------------------------------------
// The typed payloads
// ---------------------------------------------------------------------------

/** The decision dimensions (what about the decision may have caused the gap; `unresolved` while evidence does not discriminate). */
export const DECISION_DIMENSIONS = ['timing', 'sizing', 'selection', 'price', 'risk_calibration', 'unresolved'] as const;

/** One decision dimension. */
export type DecisionDimension = (typeof DECISION_DIMENSIONS)[number];

/** Guard: a decision dimension. */
export function isDecisionDimension(v: unknown): v is DecisionDimension {
  return typeof v === 'string' && (DECISION_DIMENSIONS as readonly string[]).includes(v);
}

/** The model-error kinds (how the projecting model missed; `unresolved` while single-sample evidence cannot discriminate). */
export const MODEL_ERROR_KINDS = ['projection_bias', 'calibration_stale', 'regime_miss', 'feature_gap', 'unresolved'] as const;

/** One model-error kind. */
export type ModelErrorKind = (typeof MODEL_ERROR_KINDS)[number];

/** Guard: a model-error kind. */
export function isModelErrorKind(v: unknown): v is ModelErrorKind {
  return typeof v === 'string' && (MODEL_ERROR_KINDS as readonly string[]).includes(v);
}

/** The market-move direction RELATIVE TO THE POSITION THE DECISION BUILT. */
export type MarketMoveDirection = 'adverse' | 'favorable' | 'flat';

/** Guard: a market-move direction. */
export function isMarketMoveDirection(v: unknown): v is MarketMoveDirection {
  return v === 'adverse' || v === 'favorable' || v === 'flat';
}

/** The `decision` payload: the implicated dimension of the decision itself. */
export interface DecisionAttribution {
  readonly dimension: DecisionDimension;
}

/** Guard: the decision payload. */
export function isDecisionAttribution(v: unknown): v is DecisionAttribution {
  return isRecord(v) && isDecisionDimension(v.dimension);
}

/** The `market_move` payload: the two marks and the position-relative direction (exact decimals). */
export interface MarketMoveAttribution {
  /** The reference price at the decision instant, canonical unsigned decimal. */
  readonly markAtDecision: string;
  /** The reference price at the outcome window's close, canonical unsigned decimal. */
  readonly markAtWindow: string;
  /** The move's direction relative to the position the decision built. */
  readonly direction: MarketMoveDirection;
}

/** Guard: the market-move payload. */
export function isMarketMoveAttribution(v: unknown): v is MarketMoveAttribution {
  if (!isRecord(v)) return false;
  if (typeof v.markAtDecision === 'number' || typeof v.markAtWindow === 'number') return false;
  if (typeof v.markAtDecision !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(v.markAtDecision)) return false;
  if (typeof v.markAtWindow !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(v.markAtWindow)) return false;
  return isMarketMoveDirection(v.direction);
}

/** The `model_error` payload: the projected value, the realized value, and the error kind. */
export interface ModelErrorAttribution {
  /** The model's projected value, canonical signed decimal. */
  readonly projected: string;
  /** The realized value, canonical signed decimal. */
  readonly realized: string;
  readonly kind: ModelErrorKind;
}

/** Guard: the model-error payload. */
export function isModelErrorAttribution(v: unknown): v is ModelErrorAttribution {
  if (!isRecord(v)) return false;
  if (typeof v.projected === 'number' || typeof v.realized === 'number') return false;
  if (typeof v.projected !== 'string' || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.projected)) return false;
  if (typeof v.realized !== 'string' || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.realized)) return false;
  return isModelErrorKind(v.kind);
}

/** The `data_lag` payload: the L4 facts (decision instant, availability instant, exact lag). */
export interface DataLagAttribution {
  /** The decision instant. */
  readonly decisionAt: TimestampMs;
  /** The evidence's availability instant (the point-in-time boundary). */
  readonly availableAt: TimestampMs;
  /** The exact lag in milliseconds (>= 0; availability strictly after the decision is the lag fact). */
  readonly lagMs: number;
}

/** Guard: the data-lag payload (availability at-or-after the decision; the lag is their exact difference). */
export function isDataLagAttribution(v: unknown): v is DataLagAttribution {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.decisionAt) || !isTimestampMs(v.availableAt)) return false;
  if (typeof v.lagMs !== 'number' || !Number.isSafeInteger(v.lagMs) || v.lagMs < 0) return false;
  return (v.availableAt as number) - (v.decisionAt as number) === v.lagMs;
}

// ---------------------------------------------------------------------------
// The hypothesis record
// ---------------------------------------------------------------------------

/** One attribution hypothesis: the class, the confidence, the typed payload, the evidence. */
export interface AttributionHypothesis {
  readonly class: AttributionClass;
  /** The drafter's honest degree, canonical unit-interval decimal (co-occurrence legal; no forced sum). */
  readonly confidence: string;
  /** The class-specific TYPED payload (never prose-only). */
  readonly detail: DecisionAttribution | MarketMoveAttribution | ModelErrorAttribution | DataLagAttribution;
  /** The evidence references that ground the hypothesis. */
  readonly evidence: readonly EvidenceRef[];
  /** An optional human-facing note (ACCOMPANIES the typed payload, never replaces it). */
  readonly note: string | null;
}

/** The payload guard per class (the typed union check). */
function detailMatchesClass(cls: AttributionClass, detail: unknown): boolean {
  switch (cls) {
    case 'decision':
      return isDecisionAttribution(detail);
    case 'market_move':
      return isMarketMoveAttribution(detail);
    case 'model_error':
      return isModelErrorAttribution(detail);
    case 'data_lag':
      return isDataLagAttribution(detail);
  }
}

/** Guard: a hypothesis (structural; the typed-error sites are the validators). */
export function isAttributionHypothesis(v: unknown): v is AttributionHypothesis {
  if (!isRecord(v)) return false;
  if (!isAttributionClass(v.class)) return false;
  if (typeof v.confidence === 'number') return false;
  if (typeof v.confidence !== 'string' || !isUnitIntervalDecimal(v.confidence)) return false;
  if (!detailMatchesClass(v.class, v.detail)) return false;
  if (!Array.isArray(v.evidence) || !v.evidence.every((x) => isRecord(x) && typeof (x as { kind?: unknown }).kind === 'string')) return false;
  if (v.note !== null && !isNonEmptyString(v.note)) return false;
  return true;
}

/** Validate the typed payload for a KNOWN class (narrowing per branch). */
function requireDetailForClass(cls: AttributionClass, detail: unknown, path: string): OutcomesResult<DecisionAttribution | MarketMoveAttribution | ModelErrorAttribution | DataLagAttribution> {
  switch (cls) {
    case 'decision':
      if (!isDecisionAttribution(detail)) return fail('invalid_field', `${path}.detail does not match the decision attribution class's typed payload shape (a dimension)`, path);
      return ok(detail);
    case 'market_move':
      if (!isMarketMoveAttribution(detail)) return fail('invalid_field', `${path}.detail does not match the market_move attribution class's typed payload shape (two canonical marks + a position-relative direction)`, path);
      return ok(detail);
    case 'model_error':
      if (!isModelErrorAttribution(detail)) return fail('invalid_field', `${path}.detail does not match the model_error attribution class's typed payload shape (projected + realized + kind)`, path);
      return ok(detail);
    case 'data_lag':
      if (!isDataLagAttribution(detail)) return fail('invalid_field', `${path}.detail does not match the data_lag attribution class's typed payload shape (decisionAt + availableAt + the exact lag)`, path);
      return ok(detail);
  }
}

/**
 * Validate one hypothesis (collect-first, typed errors):
 * `unknown_attribution_class` on a foreign class string;
 * `confidence_incoherent` on a confidence outside the canonical unit
 * interval; `decimal_imprecision` on a JS number in a money/confidence
 * path; `invalid_field` on a payload that does not match its class.
 */
export function validateAttributionHypothesis(v: unknown, path = 'hypothesis'): OutcomesResult<AttributionHypothesis> {
  if (!isRecord(v)) return fail('invalid_type', `${path} must be an object`, path);
  const classResult = requireAttributionClass(v.class);
  if (!classResult.ok) return fail(classResult.errors[0].code, classResult.errors[0].message, `${path}.class`);
  if (typeof v.confidence === 'number') {
    return fail('decimal_imprecision', `${path}.confidence carries a JS number (${String(v.confidence)}) — confidences are canonical unit-interval decimal STRINGs`, `${path}.confidence`);
  }
  if (typeof v.confidence !== 'string' || !isUnitIntervalDecimal(v.confidence)) {
    return fail('confidence_incoherent', `${path}.confidence ${JSON.stringify(v.confidence)} is not a canonical unit-interval decimal (0 <= c <= 1) — an incoherent degree is a typed crime, never rounded`, `${path}.confidence`);
  }
  const detailResult = requireDetailForClass(classResult.value, v.detail, path);
  if (!detailResult.ok) return detailResult;
  if (!Array.isArray(v.evidence)) return fail('invalid_field', `${path}.evidence must be an array of evidence refs`, `${path}.evidence`);
  if (v.note !== null && v.note !== undefined && typeof v.note !== 'string') return fail('invalid_field', `${path}.note must be a non-empty string or null`, `${path}.note`);
  if (typeof v.note === 'string' && v.note === '') return fail('invalid_field', `${path}.note must be a non-empty string or null`, `${path}.note`);
  return ok({
    class: classResult.value,
    confidence: v.confidence,
    detail: detailResult.value,
    evidence: v.evidence,
    note: v.note === undefined ? null : v.note,
  });
}

/**
 * The canonical hypothesis ordering: confidence DESCENDING, then class
 * ASCENDING (lexicographic) — the determinism law's tie-break. The
 * post-mortem mint rejects an unsorted list (`invalid_state`).
 */
export function hypothesisOrder(a: AttributionHypothesis, b: AttributionHypothesis): number {
  // Exact comparison over the canonical unit-interval grammar.
  const scale = Math.max(a.confidence.split('.')[1]?.length ?? 0, b.confidence.split('.')[1]?.length ?? 0);
  const unitsOf = (c: string): bigint => {
    const [intPart, fracPart = ''] = c.split('.');
    return BigInt(intPart + fracPart.padEnd(scale, '0'));
  };
  const byConfidence = unitsOf(b.confidence) - unitsOf(a.confidence);
  if (byConfidence !== 0n) return byConfidence < 0n ? -1 : 1;
  return a.class < b.class ? -1 : a.class > b.class ? 1 : 0;
}
