/**
 * The exchange config: collect-all validation, the L5 mode discipline,
 * canonical serialization (field-order-insensitive) and the deterministic
 * digest (L9).
 */

import { describe, expect, it } from 'vitest';

import { canonicalConfigJson, configHash, isExchangeConfig, validateExchangeConfig, type ExchangeConfig } from './config';
import { NO_MARKET_IMPACT } from './impact';

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

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly unknown[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

describe('validateExchangeConfig (collect-all)', () => {
  it('accepts a good config deeply frozen, with tick/lot normalized to canonical decimals', () => {
    const result = validateExchangeConfig(configFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value.tick_size).toBe('0.01');
    const normalized = unwrap(validateExchangeConfig(configFixture({ tick_size: '0.010' })));
    expect(normalized.tick_size).toBe('0.01');
  });

  it('collects every violation with dotted paths (negative paths)', () => {
    const result = validateExchangeConfig({ tick_size: '0', lot_size: '0', max_book_depth: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.errors.map((error) => error.path);
    expect(paths).toContain('config.venue');
    expect(paths).toContain('config.instrument');
    expect(paths).toContain('config.asset_class');
    expect(paths).toContain('config.tick_size');
    expect(paths).toContain('config.lot_size');
    expect(paths).toContain('config.max_book_depth');
    expect(paths).toContain('config.seed');
    expect(paths).toContain('config.fidelity');
    expect(paths).toContain('config.fees');
    expect(paths).toContain('config.latency');
    expect(paths).toContain('config.slippage');
    expect(paths).toContain('config.impact');
  });

  it('enforces the L5 mode discipline: exact_replay is unsupported (typed), unknown modes invalid', () => {
    const exact = validateExchangeConfig(configFixture({ fidelity: 'exact_replay' }));
    expect(exact.ok).toBe(false);
    if (exact.ok) return;
    expect(exact.errors[0]?.code).toBe('unsupported_fidelity');
    expect(exact.errors[0]?.message).toMatch(/never matches/);
    expect(validateExchangeConfig(configFixture({ fidelity: 'daydream' })).ok).toBe(false);
    expect(validateExchangeConfig(configFixture({ fidelity: 'generative' })).ok).toBe(true);
  });

  it('enforces the asset-class taxonomy (market-protocol mirror)', () => {
    expect(validateExchangeConfig(configFixture({ asset_class: 'potato' })).ok).toBe(false);
    expect(validateExchangeConfig(configFixture({ asset_class: 'equity' })).ok).toBe(true);
  });

  it('isExchangeConfig is the cheap structural check', () => {
    expect(isExchangeConfig(unwrap(validateExchangeConfig(configFixture())))).toBe(true);
    expect(isExchangeConfig(configFixture())).toBe(true);
    expect(isExchangeConfig({ venue: 'X' })).toBe(false);
    expect(isExchangeConfig(null)).toBe(false);
  });
});

describe('canonical serialization and digest (L9)', () => {
  it('equal configs serialize byte-identically regardless of field order', () => {
    const a = unwrap(validateExchangeConfig(configFixture()));
    const b = unwrap(
      validateExchangeConfig({
        impact: { ...NO_MARKET_IMPACT },
        slippage: { kind: 'book_walk' },
        latency: { kind: 'fixed', fixed_ms: 250 },
        fees: { fee_decimals: 8, tiers: [{ up_to_notional: null, taker_bps: '2', maker_bps: '1' }] },
        fidelity: 'reactive_replay',
        seed: 'seed-alpha',
        max_book_depth: 10,
        lot_size: '0.001',
        tick_size: '0.01',
        asset_class: 'crypto',
        instrument: 'BTC-USDT',
        venue: 'BINANCE',
      }),
    );
    expect(canonicalConfigJson(a)).toBe(canonicalConfigJson(b));
    expect(configHash(a)).toBe(configHash(b));
  });

  it('the digest is deterministic and sensitive to EVERY determining field (seed, tick, fees, latency, slippage, fidelity)', () => {
    const base = unwrap(validateExchangeConfig(configFixture()));
    const variants = [
      configFixture({ seed: 'seed-beta' }),
      configFixture({ tick_size: '0.02' }),
      configFixture({ lot_size: '0.01' }),
      configFixture({ max_book_depth: 11 }),
      configFixture({ fidelity: 'generative' }),
      configFixture({ fees: { tiers: [{ up_to_notional: null, maker_bps: '2', taker_bps: '2' }], fee_decimals: 8 } }),
      configFixture({ latency: { kind: 'fixed', fixed_ms: 251 } }),
      configFixture({ slippage: { kind: 'fixed_bps', bps: '5' } }),
      configFixture({ asset_class: 'equity' }),
      configFixture({ instrument: 'ETH-USDT' }),
    ];
    const baseHash = configHash(base);
    for (const variant of variants) {
      const validated = unwrap(validateExchangeConfig(variant));
      expect(configHash(validated), canonicalConfigJson(validated).slice(0, 120)).not.toBe(baseHash);
    }
    // Identical re-validation: same hash, twice.
    expect(configHash(unwrap(validateExchangeConfig(configFixture())))).toBe(baseHash);
    expect(configHash(unwrap(validateExchangeConfig(configFixture())))).toBe(baseHash);
  });

  it('the digest is 8 lowercase hex chars (the FNV-1a construction)', () => {
    const config: ExchangeConfig = unwrap(validateExchangeConfig(configFixture()));
    expect(configHash(config)).toMatch(/^[0-9a-f]{8}$/);
  });
});
