/**
 * The market-impact policy: the DEFAULT is the explicit declared-absence
 * record (acceptance criterion 6), and the engine fail-closes on kinds
 * it does not implement (the T027 extension point).
 */

import { describe, expect, it } from 'vitest';

import { ENGINE_IMPACT_KINDS, IMPACT_FIDELITY, NO_MARKET_IMPACT, isMarketImpactPolicy } from './impact';
import { validateExchangeConfig } from './config';

function configFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    tick_size: '0.01',
    lot_size: '0.001',
    max_book_depth: 10,
    seed: 'seed-alpha',
    fidelity: 'reactive_replay',
    fees: { tiers: [{ up_to_notional: null, maker_bps: '1', taker_bps: '2' }], fee_decimals: 8 },
    latency: { kind: 'fixed', fixed_ms: 250 },
    slippage: { kind: 'book_walk' },
    impact: { ...NO_MARKET_IMPACT },
    ...overrides,
  };
}

describe('NO_MARKET_IMPACT (the explicit declared-absence record)', () => {
  it('is an explicit record: kind none, non-empty declaration AND limitation', () => {
    expect(NO_MARKET_IMPACT.kind).toBe('none');
    expect(NO_MARKET_IMPACT.declaration.length).toBeGreaterThan(0);
    expect(NO_MARKET_IMPACT.limitation.length).toBeGreaterThan(0);
    expect(NO_MARKET_IMPACT.limitation).toMatch(/T027/);
    expect(Object.isFrozen(NO_MARKET_IMPACT)).toBe(true);
    expect(isMarketImpactPolicy(NO_MARKET_IMPACT)).toBe(true);
  });

  it('is the engine default: a config without an impact policy fails closed, with it passes', () => {
    const withoutImpact = { ...configFixture() };
    delete (withoutImpact as Record<string, unknown>).impact;
    expect(validateExchangeConfig(withoutImpact).ok).toBe(false);
    expect(validateExchangeConfig(configFixture()).ok).toBe(true);
  });
});

describe('the extension contract (fail-closed, never silently guessed)', () => {
  it('the engine implements exactly the none kind', () => {
    expect(ENGINE_IMPACT_KINDS).toEqual(['none']);
  });

  it('rejects any other impact kind with the typed unsupported_impact_policy error (T027 territory)', () => {
    const synthetic = validateExchangeConfig(
      configFixture({
        impact: { kind: 'synthetic-liquidity-fade', declaration: 'T027 style fade', limitation: 'approximate' },
      }),
    );
    expect(synthetic.ok).toBe(false);
    if (synthetic.ok) return;
    expect(synthetic.errors[0]?.code).toBe('unsupported_impact_policy');
    expect(synthetic.errors[0]?.message).toMatch(/T027/);
  });

  it('rejects malformed policy records (empty declaration/limitation)', () => {
    expect(
      validateExchangeConfig(configFixture({ impact: { kind: 'none', declaration: '', limitation: 'x' } })).ok,
    ).toBe(false);
    expect(
      validateExchangeConfig(configFixture({ impact: { kind: 'none', declaration: 'x', limitation: '' } })).ok,
    ).toBe(false);
    expect(isMarketImpactPolicy({ kind: 'none' })).toBe(false);
    expect(isMarketImpactPolicy('none')).toBe(false);
  });
});

describe('L6 fidelity declaration', () => {
  it('the impact lane declaration exists and names the declared absence', () => {
    expect(IMPACT_FIDELITY).toBeDefined();
    expect(Object.isFrozen(IMPACT_FIDELITY)).toBe(true);
    expect(IMPACT_FIDELITY.modeled.join(' ')).toMatch(/visible-book/);
    expect(IMPACT_FIDELITY.declared_limitations.join(' ')).toMatch(/T027/);
  });
});
