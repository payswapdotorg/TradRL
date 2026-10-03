/**
 * @tradrl/firm-memory — the policies' laws: the promotion policy's
 * validation (typed errors on malformed bars, the unsatisfiability
 * law) and the evidence-bar evaluation (exact, deterministic); the
 * serving policy's validation + the visibility-window derivation (the
 * age side and the L4 side).
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMOTION_POLICY,
  DEFAULT_SERVING_POLICY,
  meetsPromotionBar,
  servingVisibilityWindow,
  validatePromotionPolicy,
  validateServingPolicy,
  withinServingWindow,
} from './policy';

const T0 = 1_700_000_000_000;

describe('the promotion policy validation', () => {
  it('the default policy is valid and frozen', () => {
    const result = validatePromotionPolicy(DEFAULT_PROMOTION_POLICY);
    expect(result.ok).toBe(true);
    expect(Object.isFrozen(DEFAULT_PROMOTION_POLICY)).toBe(true);
  });

  it('malformed bars are typed invalid_field / invalid_type', () => {
    const zeroEvidence = validatePromotionPolicy({ minEvidenceCount: 0, minAggregateConfidence: '0.3', windowStabilityCount: 1, validityWindowMs: 1000 });
    if (zeroEvidence.ok) throw new Error('must fail');
    expect(zeroEvidence.errors[0]?.code).toBe('invalid_field');

    const noWindow = validatePromotionPolicy({ minEvidenceCount: 1, minAggregateConfidence: '0.3', windowStabilityCount: 1, validityWindowMs: 0 });
    if (noWindow.ok) throw new Error('must fail');
    expect(noWindow.errors[0]?.code).toBe('invalid_field');

    const notAnObject = validatePromotionPolicy(null);
    if (notAnObject.ok) throw new Error('must fail');
    expect(notAnObject.errors[0]?.code).toBe('invalid_type');
  });

  it('a JS-number confidence threshold is decimal_imprecision; an out-of-interval one is confidence_incoherent', () => {
    const numeric = validatePromotionPolicy({ minEvidenceCount: 2, minAggregateConfidence: 0.3, windowStabilityCount: 2, validityWindowMs: 1000 });
    if (numeric.ok) throw new Error('must fail');
    expect(numeric.errors[0]?.code).toBe('decimal_imprecision');

    const incoherent = validatePromotionPolicy({ minEvidenceCount: 2, minAggregateConfidence: '1.5', windowStabilityCount: 2, validityWindowMs: 1000 });
    if (incoherent.ok) throw new Error('must fail');
    expect(incoherent.errors[0]?.code).toBe('confidence_incoherent');
  });

  it('windowStabilityCount > minEvidenceCount is the unsatisfiability crime (invalid_state)', () => {
    const result = validatePromotionPolicy({ minEvidenceCount: 2, minAggregateConfidence: '0.3', windowStabilityCount: 3, validityWindowMs: 1000 });
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_state');
  });
});

describe('the evidence-bar evaluation (meetsPromotionBar)', () => {
  it('clears exactly when count, confidence and instants all clear (the exact fold: aggregate = MIN)', () => {
    const policy = { minEvidenceCount: 2, minAggregateConfidence: '0.3', windowStabilityCount: 2, validityWindowMs: 1000 };
    expect(meetsPromotionBar(policy, { distinctOutcomes: 2, aggregateConfidence: '0.3', distinctInstants: 2 })).toBe(true);
    expect(meetsPromotionBar(policy, { distinctOutcomes: 1, aggregateConfidence: '0.9', distinctInstants: 1 })).toBe(false);
    expect(meetsPromotionBar(policy, { distinctOutcomes: 5, aggregateConfidence: '0.29', distinctInstants: 5 })).toBe(false);
    expect(meetsPromotionBar(policy, { distinctOutcomes: 5, aggregateConfidence: '0.9', distinctInstants: 1 })).toBe(false);
    // Boundary: confidence exactly at the bar passes (>=).
    expect(meetsPromotionBar({ ...policy, minAggregateConfidence: '0.30' }, { distinctOutcomes: 2, aggregateConfidence: '0.3', distinctInstants: 2 })).toBe(true);
  });
});

describe('the serving policy', () => {
  it('the default serves the whole append-only history', () => {
    const result = validateServingPolicy(DEFAULT_SERVING_POLICY);
    expect(result.ok).toBe(true);
    expect(DEFAULT_SERVING_POLICY.historyWindowMs).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('validation: non-negative integer ms only; the visibility window is two-sided', () => {
    const bad = validateServingPolicy({ historyWindowMs: -1 });
    if (bad.ok) throw new Error('must fail');
    expect(bad.errors[0]?.code).toBe('invalid_field');
    const good = validateServingPolicy({ historyWindowMs: 1000 });
    expect(good.ok).toBe(true);

    const window = servingVisibilityWindow({ historyWindowMs: 1000 }, T0);
    expect(window.from).toBe(T0 - 1000);
    expect(window.to).toBe(T0);
    expect(withinServingWindow(T0 as never, window)).toBe(true); // at the instant — inclusive
    expect(withinServingWindow((T0 - 1000) as never, window)).toBe(true); // the age boundary — inclusive
    expect(withinServingWindow((T0 + 1) as never, window)).toBe(false); // the future — the L4 side
    expect(withinServingWindow((T0 - 1001) as never, window)).toBe(false); // beyond the horizon
  });
});
