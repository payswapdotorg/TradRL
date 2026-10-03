/**
 * @tradrl/research-benchmarks — the STRESS VARIATION laws (Work Order T032;
 * spec/EVALUATION-PROTOCOL.md "Stress: Perturb fees, slippage, latency,
 * fill probability").
 *
 * Laws under test:
 * - the closed axis vocabulary and magnitude domains (`invalid_stress` via
 *   the definition's stress validation);
 * - the one-variation-per-axis law;
 * - EXACT application: every burden is a scaled-bigint decimal identity —
 *   no float ever appears, and the arithmetic is pinned to hand-computed
 *   exact values;
 * - composition order and additivity.
 */

import { describe, expect, it } from 'vitest';

import { applyStressVariations, validateStressVariations } from './index';
import type { StressSensitivity } from './index';

const BASE: StressSensitivity = {
  pnl: '1000.00',
  notional: '1000000.00',
  trades: 40,
  fill_value: '500.00',
};

describe('the stress vocabulary', () => {
  it('accepts the four EVALUATION-PROTOCOL axes with exact decimal magnitudes', () => {
    const validated = validateStressVariations([
      { axis: 'fees', magnitude: '2' },
      { axis: 'slippage', magnitude: '1.5' },
      { axis: 'latency', magnitude: '0.25' },
      { axis: 'fill-probability', magnitude: '0.95' },
    ]);
    expect(validated.ok).toBe(true);
  });

  it('rejects an unknown axis', () => {
    const validated = validateStressVariations([{ axis: 'impact', magnitude: '1' }]);
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.errors[0]?.code).toBe('invalid_stress');
  });

  it('rejects a fill probability outside [0, 1]', () => {
    for (const magnitude of ['1.5', '-0.1']) {
      const validated = validateStressVariations([{ axis: 'fill-probability', magnitude }]);
      expect(validated.ok).toBe(false);
      if (validated.ok) return;
      expect(validated.errors[0]?.code).toBe('invalid_stress');
    }
  });

  it('rejects two variations on one axis (a declared perturbation is closed)', () => {
    const validated = validateStressVariations([
      { axis: 'fees', magnitude: '1' },
      { axis: 'fees', magnitude: '2' },
    ]);
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.errors[0]?.code).toBe('invalid_stress');
    expect(validated.errors[0]?.message).toContain('at most one variation per axis');
  });
});

describe('exact application', () => {
  it('fees: notional * bps / 10^4 subtracted exactly (scale widens exactly)', () => {
    // 1000000.00 * 2 / 10^4 = 200 exactly; the exact lane renders at the
    // widened scale — the DRIVER rounds once, later, at the declared score
    // scale.
    expect(applyStressVariations(BASE, [{ axis: 'fees', magnitude: '2' }])).toBe('800.000000');
  });

  it('slippage: notional * bps / 10^4 subtracted exactly (fractional bps)', () => {
    // 1000000.00 * 1.5 / 10^4 = 150 exactly.
    expect(applyStressVariations(BASE, [{ axis: 'slippage', magnitude: '1.5' }])).toBe('850.0000000');
  });

  it('latency: trades * per-trade penalty subtracted exactly', () => {
    // 40 * 0.25 = 10 exactly.
    expect(applyStressVariations(BASE, [{ axis: 'latency', magnitude: '0.25' }])).toBe('990.00');
  });

  it('fill-probability: the missed fill value subtracted exactly', () => {
    // 500.00 * (1 - 0.95) = 25 exactly.
    expect(applyStressVariations(BASE, [{ axis: 'fill-probability', magnitude: '0.95' }])).toBe('975.0000');
  });

  it('composes additively in declaration order', () => {
    // 200 + 150 + 10 + 25 = 385 -> 615 exactly (at the widened scale).
    expect(
      applyStressVariations(BASE, [
        { axis: 'fees', magnitude: '2' },
        { axis: 'slippage', magnitude: '1.5' },
        { axis: 'latency', magnitude: '0.25' },
        { axis: 'fill-probability', magnitude: '0.95' },
      ]),
    ).toBe('615.0000000');
  });

  it('is exact where binary floating point is not (the 0.1 + 0.2 trap)', () => {
    // notional 0.3, bps 1 -> 0.3 * 1 / 10^4 = 0.00003 exactly.
    const result = applyStressVariations({ pnl: '0.3', notional: '0.3', trades: 0, fill_value: '0' }, [{ axis: 'fees', magnitude: '1' }]);
    expect(result).toBe('0.29997');
  });

  it('drives the pnl negative exactly', () => {
    // 1000000.00 * 2000 / 10^4 = 200000 exactly; 1000.00 - 200000 = -199000.
    expect(applyStressVariations(BASE, [{ axis: 'fees', magnitude: '2000' }])).toBe('-199000.000000');
  });
});
