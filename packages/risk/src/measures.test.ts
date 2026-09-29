/**
 * @tradrl/risk — the RiskMeasureRecord tests: the L7 law made structural
 * (risk-adjusted figures as OPAQUE refs, never naked numbers pretending
 * to be acceptance), the drawdown series and the exposure wrap.
 */

import { describe, expect, it } from 'vitest';

import {
  drawdownSeriesMeasure,
  exposureMeasureOf,
  isRiskMeasureRecord,
  mintRiskFigure,
  riskAdjustedMeasure,
  validateRiskMeasureRecord,
} from './measures';
import { evaluateLimits } from './limits';
import { computeExposure } from './exposure';
import { deriveMarketState } from './market-mirror';
import { isDeeplyFrozen } from './primitives';
import { SEED, T0, fixtureFill, fixtureMarketEvents, fixturePolicy, fixturePortfolio, fixtureStandingSwitch, unwrap } from './test-fixtures';

/** The golden evaluation (the lineage source for the measures). */
function goldenEvaluation() {
  const market = unwrap(deriveMarketState(fixtureMarketEvents(), T0 as never, 8));
  const exposure = unwrap(computeExposure({ portfolio: fixturePortfolio(), marketState: market, fills: [fixtureFill()], priorPeakEquity: null, seed: SEED }));
  const evaluation = unwrap(evaluateLimits({ exposure, policy: fixturePolicy(), killSwitch: fixtureStandingSwitch() }));
  return { exposure, evaluation };
}

describe('exposureMeasureOf — the exposure wrap', () => {
  it('wraps the measured exposure with the evaluation\'s full lineage (L9/L12)', () => {
    const { exposure, evaluation } = goldenEvaluation();
    const measure = unwrap(exposureMeasureOf(evaluation, exposure));
    expect(measure.kind).toBe('exposure');
    if (measure.kind !== 'exposure') return;
    expect(measure.exposureRef).toBe(exposure.exposureId);
    expect(measure.tenant).toBe(evaluation.lineage.tenant);
    expect(measure.project).toBe(evaluation.lineage.project);
    expect(measure.asOf).toBe(exposure.asOf);
    expect(measure.measureId.startsWith('rmr:')).toBe(true);
    expect(isRiskMeasureRecord(measure)).toBe(true);
    expect(isDeeplyFrozen(measure)).toBe(true);
  });

  it('rejects an exposure the evaluation did not measure (incoherent lineage is a gap)', () => {
    const { exposure, evaluation } = goldenEvaluation();
    const other = unwrap(computeExposure({ portfolio: fixturePortfolio(), marketState: unwrap(deriveMarketState(fixtureMarketEvents(), T0 as never, 8)), fills: [fixtureFill({ quantity: '0.21' })], priorPeakEquity: null, seed: SEED }));
    const result = exposureMeasureOf(evaluation, other);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('lineage_gap');
  });
});

describe('drawdownSeriesMeasure — the drawdown tracking', () => {
  it('carries the exact-decimal equity/peak/drawdown series', () => {
    const { evaluation } = goldenEvaluation();
    const measure = unwrap(
      drawdownSeriesMeasure({
        entries: [
          { asOf: (T0 - 2000) as never, equity: '146000', peakEquity: '146000', drawdown: '0' },
          { asOf: (T0 - 1000) as never, equity: '145000', peakEquity: '146000', drawdown: '1000' },
          { asOf: T0 as never, equity: '145978', peakEquity: '146000', drawdown: '22' },
        ],
        lineage: evaluation.lineage,
        asOf: T0 as never,
      }),
    );
    expect(measure.kind).toBe('drawdown_series');
    if (measure.kind !== 'drawdown_series') return;
    expect(measure.entries).toHaveLength(3);
    expect(measure.entries[2]?.drawdown).toBe('22');
    expect(isRiskMeasureRecord(measure)).toBe(true);
  });

  it('rejects an unordered or empty series', () => {
    const { evaluation } = goldenEvaluation();
    const unordered = drawdownSeriesMeasure({
      entries: [
        { asOf: T0 as never, equity: '1', peakEquity: '1', drawdown: '0' },
        { asOf: (T0 - 1000) as never, equity: '1', peakEquity: '1', drawdown: '0' },
      ],
      lineage: evaluation.lineage,
      asOf: T0 as never,
    });
    expect(unordered.ok).toBe(false);

    const empty = drawdownSeriesMeasure({ entries: [], lineage: evaluation.lineage, asOf: T0 as never });
    expect(empty.ok).toBe(false);
  });
});

describe('riskAdjustedMeasure — the L7 law (opaque refs, never naked figures)', () => {
  it('carries the figure as an OPAQUE ref with declared method + version + limitation — the value appears NOWHERE', () => {
    const { evaluation } = goldenEvaluation();
    const measure = unwrap(
      riskAdjustedMeasure({
        figureKind: 'var',
        method: 'historical-simulation',
        methodVersion: 3,
        value: '4821.15',
        declaredLimitation: 'one-day 99% VaR from the observed window; no tail extrapolation beyond it',
        lineage: evaluation.lineage,
        asOf: T0 as never,
      }),
    );
    expect(measure.kind).toBe('risk_adjusted');
    if (measure.kind !== 'risk_adjusted') return;
    expect(measure.figureRef.startsWith('rfig:')).toBe(true);
    expect(measure.method).toBe('historical-simulation');
    expect(measure.methodVersion).toBe(3);
    expect(measure.figureKind).toBe('var');
    // The value never rides the record.
    expect(JSON.stringify(measure)).not.toContain('4821.15');
    expect(isRiskMeasureRecord(measure)).toBe(true);
  });

  it('mints the figure deterministically: the same (method, version, value) is the same ref', () => {
    expect(mintRiskFigure('historical-simulation', 3, '4821.15')).toBe(mintRiskFigure('historical-simulation', 3, '4821.15'));
    expect(mintRiskFigure('historical-simulation', 3, '4821.15')).not.toBe(mintRiskFigure('historical-simulation', 4, '4821.15'));
    expect(mintRiskFigure('historical-simulation', 3, '4821.15')).not.toBe(mintRiskFigure('cornish-fisher', 3, '4821.15'));
    expect(mintRiskFigure('historical-simulation', 3, '4821.15')).not.toBe(mintRiskFigure('historical-simulation', 3, '9999'));
  });

  it('is deterministic: the same inputs produce the byte-identical measure id (L9)', () => {
    const { evaluation } = goldenEvaluation();
    const run = () =>
      unwrap(
        riskAdjustedMeasure({
          figureKind: 'var',
          method: 'historical-simulation',
          methodVersion: 3,
          value: '4821.15',
          declaredLimitation: 'one-day 99% VaR from the observed window; no tail extrapolation beyond it',
          lineage: evaluation.lineage,
          asOf: T0 as never,
        }),
      );
    expect(run().measureId).toBe(run().measureId);
  });

  it('rejects an inexact or missing value (the only door a value takes is the minting site)', () => {
    const { evaluation } = goldenEvaluation();
    const numbered = riskAdjustedMeasure({
      figureKind: 'var',
      method: 'historical-simulation',
      methodVersion: 3,
      value: 4821.15 as unknown as string,
      declaredLimitation: 'x',
      lineage: evaluation.lineage,
      asOf: T0 as never,
    });
    expect(numbered.ok).toBe(false);
    if (!numbered.ok) expect(numbered.errors[0]?.code).toBe('invalid_decimal');
  });
});

describe('validateRiskMeasureRecord — the L7 trip wires at validation time', () => {
  const { evaluation } = goldenEvaluation();
  const clean = unwrap(
    riskAdjustedMeasure({
      figureKind: 'var',
      method: 'historical-simulation',
      methodVersion: 3,
      value: '4821.15',
      declaredLimitation: 'one-day 99% VaR from the observed window',
      lineage: evaluation.lineage,
      asOf: T0 as never,
    }),
  );

  it('accepts the clean record and re-derives its content-addressed id', () => {
    const result = validateRiskMeasureRecord(clean);
    expect(result.ok).toBe(true);
  });

  it('a NAKED figure value fails with acceptance_threshold_embedded (the L7 crime)', () => {
    for (const key of ['value', 'figureValue', 'result']) {
      const crime = { ...clean, [key]: '4821.15' };
      const result = validateRiskMeasureRecord(crime);
      expect(result.ok, key).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((error) => error.code === 'acceptance_threshold_embedded'), key).toBe(true);
      }
    }
  });

  it('acceptance vocabulary anywhere in the record fails (score, verdict, acceptance)', () => {
    const crimes: readonly Record<string, unknown>[] = [
      { ...clean, score: 1 },
      { ...clean, verdict: 'pass' },
      { ...clean, acceptance: 'good-enough' },
    ];
    for (const crime of crimes) {
      const result = validateRiskMeasureRecord(crime);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((error) => error.code === 'acceptance_threshold_embedded')).toBe(true);
      }
    }
  });

  it('a supplied measure id that disagrees with the content fails (identity is content-addressed)', () => {
    const forged = { ...clean, declaredLimitation: 'a different honesty statement' };
    const result = validateRiskMeasureRecord(forged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_state');
  });

  it('a missing lineage or scope fails with the typed gaps', () => {
    const noLineage = validateRiskMeasureRecord({ ...clean, lineage: undefined });
    expect(noLineage.ok).toBe(false);
    if (!noLineage.ok) expect(noLineage.errors.some((error) => error.code === 'lineage_gap')).toBe(true);

    const noTenant = validateRiskMeasureRecord({ ...clean, tenant: undefined });
    expect(noTenant.ok).toBe(false);
    if (!noTenant.ok) expect(noTenant.errors.some((error) => error.code === 'tenant_missing')).toBe(true);
  });
});
