/**
 * @tradrl/firm-memory — THE POLICIES: the versioned, validated, frozen
 * policy records the firm-memory stages consume.
 *
 * - `PromotionPolicy` — what elevates a post-mortem hypothesis into
 *   firm knowledge (Work Order T034: "the promotion policy shapes
 *   (what elevates a post-mortem hypothesis into firm knowledge:
 *   evidence count, non-contradiction, window stability)"): the
 *   minimum DISTINCT-outcome count, the minimum aggregate confidence
 *   (the exact MIN fold must clear it), the window-stability count
 *   (the minimum DISTINCT supporting-outcome instants — the
 *   anti-cluster bar), and the validity window length (the decay
 *   horizon `[asOf, asOf + validityWindowMs)`). Non-contradiction is
 *   not a policy switch: it is the lane's LAW (the contradiction
 *   register + the domination rule — a challenger flips the firm's
 *   position only through strictly more evidence, never by fiat).
 * - `ServingPolicy` — the retention/decay horizon the serving surface
 *   applies over injected instants (the HISTORY window: how far back
 *   beyond the active/decayed boundary a query may still see entries;
 *   plus the L4 law: a record stamped after the query instant is
 *   invisible — the future is never returned). Retention NEVER
 *   deletes: the logs are append-only.
 *
 * Every policy is validated (typed errors, deeply frozen). Thresholds
 * are exact decimals/instants — never ambient, never per-record
 * inventions.
 */

import { fail, ok, type FirmMemoryResult } from './errors';
import { deepFreeze, isNonNegativeSafeInteger, isPositiveSafeInteger, isRecord, isUnitIntervalDecimal, unitIntervalCompare, type TimestampMs } from './primitives';

// ---------------------------------------------------------------------------
// The promotion policy
// ---------------------------------------------------------------------------

/** The promotion policy: the evidence bar + the decay horizon. */
export interface PromotionPolicy {
  /** The minimum DISTINCT supporting-outcome count (>= 1 — one post-mortem is never firm knowledge). */
  readonly minEvidenceCount: number;
  /**
   * The minimum aggregate confidence, canonical unit-interval decimal.
   * The aggregate is the EXACT MIN over the supporting confidences —
   * promotion requires min(confidences) >= this threshold.
   */
  readonly minAggregateConfidence: string;
  /**
   * The window-stability bar: the minimum DISTINCT supporting-outcome
   * INSTANTS (the anti-cluster law — a single-instant cluster of
   * outcomes is one event, not a pattern).
   */
  readonly windowStabilityCount: number;
  /** The validity window length in milliseconds (> 0): the decay horizon `[asOf, asOf + validityWindowMs)`. */
  readonly validityWindowMs: number;
}

/**
 * Validate a promotion policy: `invalid_field` on non-integer /
 * non-positive bars; `decimal_imprecision` on a JS number threshold;
 * `confidence_incoherent` on a threshold outside the unit interval.
 * Deeply frozen on success.
 */
export function validatePromotionPolicy(v: unknown): FirmMemoryResult<PromotionPolicy> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail('invalid_type', 'the promotion policy must be an object { minEvidenceCount, minAggregateConfidence, windowStabilityCount, validityWindowMs }');
  const candidate = v as { minEvidenceCount?: unknown; minAggregateConfidence?: unknown; windowStabilityCount?: unknown; validityWindowMs?: unknown };
  if (!isPositiveSafeInteger(candidate.minEvidenceCount)) {
    return fail('invalid_field', 'minEvidenceCount must be a positive safe integer (>= 1 — one post-mortem is never firm knowledge)', 'minEvidenceCount');
  }
  if (typeof candidate.minAggregateConfidence === 'number') {
    return fail('decimal_imprecision', 'minAggregateConfidence carries a JS number — confidence thresholds are canonical unit-interval decimal STRINGs', 'minAggregateConfidence');
  }
  if (typeof candidate.minAggregateConfidence !== 'string' || !isUnitIntervalDecimal(candidate.minAggregateConfidence)) {
    return fail('confidence_incoherent', `minAggregateConfidence ${JSON.stringify(candidate.minAggregateConfidence)} is not a canonical unit-interval decimal (0 <= c <= 1)`, 'minAggregateConfidence');
  }
  if (!isPositiveSafeInteger(candidate.windowStabilityCount)) {
    return fail('invalid_field', 'windowStabilityCount must be a positive safe integer (>= 1 distinct instants)', 'windowStabilityCount');
  }
  if (!isPositiveSafeInteger(candidate.validityWindowMs)) {
    return fail('invalid_field', 'validityWindowMs must be a positive safe integer (milliseconds — the decay horizon)', 'validityWindowMs');
  }
  // The coherence law: windowStabilityCount <= minEvidenceCount is implied only when instants are distinct per outcome; the policy may demand MORE instants than evidence? No: distinct instants <= distinct outcomes, so stability > evidence is unsatisfiable.
  if (candidate.windowStabilityCount > candidate.minEvidenceCount) {
    return fail('invalid_state', `windowStabilityCount (${candidate.windowStabilityCount}) exceeds minEvidenceCount (${candidate.minEvidenceCount}) — distinct instants never exceed distinct outcomes, so the bar is unsatisfiable`, 'windowStabilityCount');
  }
  return ok(deepFreeze({
    minEvidenceCount: candidate.minEvidenceCount,
    minAggregateConfidence: candidate.minAggregateConfidence,
    windowStabilityCount: candidate.windowStabilityCount,
    validityWindowMs: candidate.validityWindowMs,
  }));
}

/** The default promotion policy (the declared interpretation: recurrence across at least two distinct outcomes at two distinct instants, weakest-evidence confidence at least 0.3, a 30-day decay horizon). */
export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = deepFreeze({
  minEvidenceCount: 2,
  minAggregateConfidence: '0.3',
  windowStabilityCount: 2,
  validityWindowMs: 2_592_000_000,
});

/**
 * Evaluate the evidence bar (pure, deterministic): `true` iff the
 * candidate's distinct-outcome count, aggregate (MIN) confidence and
 * distinct-instant count clear the policy's bars.
 */
export function meetsPromotionBar(policy: PromotionPolicy, evidence: { readonly distinctOutcomes: number; readonly aggregateConfidence: string; readonly distinctInstants: number }): boolean {
  if (evidence.distinctOutcomes < policy.minEvidenceCount) return false;
  if (unitIntervalCompare(evidence.aggregateConfidence, policy.minAggregateConfidence) < 0) return false;
  if (evidence.distinctInstants < policy.windowStabilityCount) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The serving policy
// ---------------------------------------------------------------------------

/** The serving policy: the retention/decay horizon. */
export interface ServingPolicy {
  /**
   * The history horizon in milliseconds (>= 0): a query at instant T
   * sees entries stamped within `[T - historyWindowMs, T]` (the age
   * side + the L4 side). `Number.MAX_SAFE_INTEGER` serves the whole
   * append-only history. NEVER a deletion — the logs are append-only.
   */
  readonly historyWindowMs: number;
}

/** Validate a serving policy (typed errors; deeply frozen on success). */
export function validateServingPolicy(v: unknown): FirmMemoryResult<ServingPolicy> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail('invalid_type', 'the serving policy must be an object { historyWindowMs }');
  const candidate = v as { historyWindowMs?: unknown };
  if (!isNonNegativeSafeInteger(candidate.historyWindowMs)) {
    return fail('invalid_field', 'historyWindowMs must be a non-negative safe integer (milliseconds)', 'historyWindowMs');
  }
  return ok(deepFreeze({ historyWindowMs: candidate.historyWindowMs }));
}

/** The default serving policy: the whole append-only history (the research bodies' full-fidelity lookups). */
export const DEFAULT_SERVING_POLICY: ServingPolicy = deepFreeze({
  historyWindowMs: Number.MAX_SAFE_INTEGER,
});

/** The retention/visibility window derivation: `[at - historyWindowMs, at]` (both sides inclusive). */
export function servingVisibilityWindow(policy: ServingPolicy, at: number): { readonly from: number; readonly to: number } {
  return { from: at - policy.historyWindowMs, to: at };
}

/** `true` iff a record stamped `asOf` is within the visibility window at the injected instant (the age side + the L4 side). */
export function withinServingWindow(asOf: TimestampMs, window: { readonly from: number; readonly to: number }): boolean {
  return (asOf as number) >= window.from && (asOf as number) <= window.to;
}
