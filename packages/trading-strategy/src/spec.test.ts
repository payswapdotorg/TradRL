/**
 * Behavioral tests for the strategy spec: the versioning/universe/
 * generator laws, the L8 authority trip wire, and the allocation
 * policy's target-weight derivation (weights from observations).
 */

import { describe, expect, it } from 'vitest';

import {
  isStrategySpec,
  targetWeights,
  validateStrategySpec,
  type StrategySpec,
} from './index';

const T0 = 1_700_000_000_000;

function spec(overrides?: Record<string, unknown>): StrategySpec {
  const base = {
    specId: 'spec-1',
    version: 1,
    tenant: 'tenant-alpha',
    project: 'project-one',
    goal: 'goal-1',
    name: 'reference',
    universe: [
      { instrumentId: 'BTC-USD', venueId: 'SIM', lotSize: '0.001', tickSize: '0.01' },
      { instrumentId: 'ETH-USD', venueId: 'SIM', lotSize: '0.01', tickSize: '0.01' },
      { instrumentId: 'SOL-USD', venueId: 'SIM', lotSize: '0.1', tickSize: '0.001' },
    ],
    allocation: { kind: 'equal_weight' },
    rebalancing: { trigger: 'drift_band', band: '0.05', cadenceMs: 86_400_000 },
    priceDiscipline: { kind: 'limit', anchor: 'last_trade' },
    riskPolicyRefs: ['risk-policy:core@1'],
    generators: [],
    decimalPrecision: 8,
    organization: null,
    createdAt: T0 - 1000,
  } as unknown as Record<string, unknown>;
  return { ...base, ...overrides } as unknown as StrategySpec;
}

describe('StrategySpec validation', () => {
  it('a well-formed spec validates and deeply freezes', () => {
    const result = validateStrategySpec(spec());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isStrategySpec(result.value)).toBe(true);
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.universe)).toBe(true);
    }
  });

  it('a duplicate (instrument, venue) universe entry is the typed universe_violation', () => {
    const result = validateStrategySpec(
      spec({
        universe: [
          { instrumentId: 'BTC-USD', venueId: 'SIM', lotSize: '0.001', tickSize: '0.01' },
          { instrumentId: 'BTC-USD', venueId: 'SIM', lotSize: '0.001', tickSize: '0.01' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'universe_violation')).toBe(true);
  });

  it('the same instrument on two venues is legal (venue-scoped netting)', () => {
    const result = validateStrategySpec(
      spec({
        universe: [
          { instrumentId: 'BTC-USD', venueId: 'SIM', lotSize: '0.001', tickSize: '0.01' },
          { instrumentId: 'BTC-USD', venueId: 'OTHER', lotSize: '0.001', tickSize: '0.01' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('a fixed-weight allocation must cover exactly the universe (universe_violation otherwise)', () => {
    const under = validateStrategySpec(
      spec({
        allocation: {
          kind: 'fixed_weights',
          weights: [
            { instrumentId: 'BTC-USD', weight: '0.5' },
            { instrumentId: 'ETH-USD', weight: '0.5' },
          ],
        },
      }),
    );
    expect(under.ok).toBe(false);
    if (!under.ok) expect(under.errors.some((error) => error.code === 'universe_violation')).toBe(true);

    const foreign = validateStrategySpec(
      spec({
        allocation: {
          kind: 'fixed_weights',
          weights: [
            { instrumentId: 'BTC-USD', weight: '0.4' },
            { instrumentId: 'ETH-USD', weight: '0.3' },
            { instrumentId: 'SOL-USD', weight: '0.2' },
            { instrumentId: 'DOGE-USD', weight: '0.1' },
          ],
        },
      }),
    );
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors.some((error) => error.code === 'universe_violation')).toBe(true);
  });

  it('the drift-band presence matrix is enforced (band iff drift_band trigger)', () => {
    const noBand = validateStrategySpec(spec({ rebalancing: { trigger: 'drift_band', cadenceMs: 1000 } }));
    expect(noBand.ok).toBe(false);
    const bandOnScheduled = validateStrategySpec(spec({ rebalancing: { trigger: 'scheduled', band: '0.05', cadenceMs: 1000 } }));
    expect(bandOnScheduled.ok).toBe(false);
  });

  it('duplicate generator names are rejected (the stochasticity discipline)', () => {
    const result = validateStrategySpec(
      spec({
        generators: [
          { name: 'entry-jitter', algorithm: 'mulberry32' },
          { name: 'entry-jitter', algorithm: 'mulberry32' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('a decimal precision outside 1..18 is rejected', () => {
    expect(validateStrategySpec(spec({ decimalPrecision: 0 })).ok).toBe(false);
    expect(validateStrategySpec(spec({ decimalPrecision: 19 })).ok).toBe(false);
  });

  it('an authority-embedding spec fails with the typed authority_in_strategy (L8)', () => {
    const criminal = { ...spec(), venuePermissions: ['BINANCE:trade'] } as never;
    const result = validateStrategySpec(criminal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'authority_in_strategy')).toBe(true);
    // And the structural guard fails too.
    expect(isStrategySpec(criminal)).toBe(false);
  });

  it('a missing tenant or project fails validation (L12)', () => {
    const anonymous = { ...spec(), tenant: undefined } as never;
    const result = validateStrategySpec(anonymous);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.path === 'spec.tenant')).toBe(true);
  });
});

describe('targetWeights (weights from observations — the declared pure-function shape)', () => {
  it('equal_weight derives 1/N at the declared precision for every universe entry', () => {
    const targets = targetWeights(spec());
    expect(targets.map((target) => target.weight)).toEqual(['0.33333333', '0.33333333', '0.33333333']);
    expect(targets.map((target) => target.instrumentId)).toEqual(['BTC-USD', 'ETH-USD', 'SOL-USD']);
  });

  it('fixed_weights returns the declared weights over the universe order', () => {
    const targets = targetWeights(
      spec({
        allocation: {
          kind: 'fixed_weights',
          weights: [
            { instrumentId: 'BTC-USD', weight: '0.5' },
            { instrumentId: 'ETH-USD', weight: '0.3' },
            { instrumentId: 'SOL-USD', weight: '0.2' },
          ],
        },
      }),
    );
    expect(targets.map((target) => target.weight)).toEqual(['0.5', '0.3', '0.2']);
  });
});
