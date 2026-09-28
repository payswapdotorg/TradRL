/**
 * The slippage model: book_walk passthrough, fixed_bps exact adversarial
 * quantization (boundaries: tick grid, one-tick floor, huge bps), and
 * the L6 fidelity declaration record.
 */

import { describe, expect, it } from 'vitest';

import { SLIPPAGE_FIDELITY, aggressorPrice, isSlippageConfig, validateSlippageConfig, type SlippageConfig } from './slippage';

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly unknown[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

describe('slippage config validation', () => {
  it('accepts book_walk and positive fixed_bps, rejects the rest', () => {
    expect(validateSlippageConfig({ kind: 'book_walk' }).ok).toBe(true);
    expect(validateSlippageConfig({ kind: 'fixed_bps', bps: '10' }).ok).toBe(true);
    expect(validateSlippageConfig({ kind: 'fixed_bps', bps: '0' }).ok).toBe(false); // name it book_walk honestly
    expect(validateSlippageConfig({ kind: 'fixed_bps' }).ok).toBe(false);
    expect(validateSlippageConfig({ kind: 'fixed_bps', bps: '-5' }).ok).toBe(false);
    expect(validateSlippageConfig({ kind: 'fixed_bps', bps: 'ten' }).ok).toBe(false);
    expect(validateSlippageConfig({ kind: 'volatility' }).ok).toBe(false);
    expect(isSlippageConfig({ kind: 'book_walk' })).toBe(true);
    expect(isSlippageConfig({ kind: 'fixed_bps', bps: '1' })).toBe(true);
    expect(isSlippageConfig(7)).toBe(false);
  });
});

describe('book_walk (the honest default)', () => {
  const config = unwrap(validateSlippageConfig({ kind: 'book_walk' })) as SlippageConfig;

  it('passes the book price through unchanged for both sides (the walk IS the slippage)', () => {
    expect(aggressorPrice(config, 'buy', '43100.00', '0.01')).toBe('43100'); // canonical form
    expect(aggressorPrice(config, 'sell', '43100.00', '0.01')).toBe('43100'); // canonical form
    expect(aggressorPrice(config, 'buy', '43100.50', '0.01')).toBe('43100.5'); // canonicalized
  });
});

describe('fixed_bps (the declared approximation — exact quantization)', () => {
  const config = unwrap(validateSlippageConfig({ kind: 'fixed_bps', bps: '10' })) as SlippageConfig; // 10 bps = 0.1%

  it('degrades a buy aggressor UP and a sell aggressor DOWN (adversarial quantization)', () => {
    // 100 * 1.001 = 100.1 -> on the 0.01 grid: ceil = 100.10 (pay at least).
    expect(aggressorPrice(config, 'buy', '100', '0.01')).toBe('100.1');
    // 100 * 0.999 = 99.9 -> on the 0.01 grid: floor = 99.90 (receive at most).
    expect(aggressorPrice(config, 'sell', '100', '0.01')).toBe('99.9');
  });

  it('never lets rounding IMPROVE the aggressor price (buy floors up via ceil, sell via floor)', () => {
    // 100.05 * 1.001 = 100.15005 -> ceil to 0.1 grid = 100.2.
    expect(aggressorPrice(config, 'buy', '100.05', '0.1')).toBe('100.2');
    // 100.05 * 0.999 = 99.94995 -> floor to 0.1 grid = 99.9.
    expect(aggressorPrice(config, 'sell', '100.05', '0.1')).toBe('99.9');
  });

  it('quantizes exactly — no float mediation at the boundary', () => {
    // 0.1 * 1.001 = 0.1001 -> ceil to 0.01 grid = 0.11.
    expect(aggressorPrice(config, 'buy', '0.1', '0.01')).toBe('0.11');
    // 0.1 * 0.999 = 0.0999 -> floor to 0.01 grid = 0.09.
    expect(aggressorPrice(config, 'sell', '0.1', '0.01')).toBe('0.09');
  });

  it('floors a degraded price to one tick so prices stay strictly positive', () => {
    // 0.01 * 0.999 = 0.009999 -> floor to 0.01 grid = 0 -> one-tick floor.
    expect(aggressorPrice(config, 'sell', '0.01', '0.01')).toBe('0.01');
    // A >= 10_000 bps sell slip drives the factor non-positive: one tick.
    const crushing = unwrap(validateSlippageConfig({ kind: 'fixed_bps', bps: '20000' })) as SlippageConfig;
    expect(aggressorPrice(crushing, 'sell', '100', '0.01')).toBe('0.01');
    // Buy with a crushing slip still pays a (large) price: 100 * 3 = 300.
    expect(aggressorPrice(crushing, 'buy', '100', '0.01')).toBe('300');
  });

  it('fractional bps degrade exactly', () => {
    const fine = unwrap(validateSlippageConfig({ kind: 'fixed_bps', bps: '0.5' })) as SlippageConfig; // 0.5 bps
    // 1_000_000 * (1 + 0.00005) = 1_000_050 -> exact on the 0.01 grid.
    expect(aggressorPrice(fine, 'buy', '1000000', '0.01')).toBe('1000050');
    expect(aggressorPrice(fine, 'sell', '1000000', '0.01')).toBe('999950');
  });

  it('is deterministic: identical inputs, identical outputs, twice', () => {
    const first = aggressorPrice(config, 'buy', '43125.10', '0.01');
    const second = aggressorPrice(config, 'buy', '43125.10', '0.01');
    expect(second).toBe(first);
  });
});

describe('L6 fidelity declaration (acceptance criterion 5)', () => {
  it('the declaration record exists, is frozen, and names the declared shapes and limitations', () => {
    expect(SLIPPAGE_FIDELITY).toBeDefined();
    expect(Object.isFrozen(SLIPPAGE_FIDELITY)).toBe(true);
    expect(SLIPPAGE_FIDELITY.modeled.join(' ')).toMatch(/book_walk/);
    expect(SLIPPAGE_FIDELITY.modeled.join(' ')).toMatch(/fixed_bps/);
    expect(SLIPPAGE_FIDELITY.declared_limitations.join(' ')).toMatch(/hidden liquidity/);
    expect(SLIPPAGE_FIDELITY.declared_limitations.join(' ')).toMatch(/calibration approximation/);
  });
});
