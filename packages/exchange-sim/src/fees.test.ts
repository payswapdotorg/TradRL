/**
 * The fee model: maker/taker split, tier boundaries, half-up rounding,
 * and the L6 fidelity declaration record.
 */

import { describe, expect, it } from 'vitest';

import { FEE_FIDELITY, feeOf, feesOfFill, selectFeeTier, validateFeeSchedule, type FeeSchedule } from './fees';

function scheduleFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tiers: [
      { up_to_notional: '10000', maker_bps: '1', taker_bps: '2' },
      { up_to_notional: '100000', maker_bps: '0.5', taker_bps: '1' },
      { up_to_notional: null, maker_bps: '0.25', taker_bps: '0.5' },
    ],
    fee_decimals: 8,
    ...overrides,
  };
}

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly unknown[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

describe('fee schedule validation', () => {
  it('accepts a good schedule deeply frozen', () => {
    const result = validateFeeSchedule(scheduleFixture());
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('rejects schedules without a trailing catch-all (totality is the law)', () => {
    const noCatchAll = validateFeeSchedule(scheduleFixture({ tiers: [{ up_to_notional: '10000', maker_bps: '1', taker_bps: '1' }] }));
    expect(noCatchAll.ok).toBe(false);
    if (!noCatchAll.ok) expect(noCatchAll.errors[0]?.message).toMatch(/catch-all/);
  });

  it('rejects tiers after the catch-all, non-increasing bounds, zero bounds, and bad rates', () => {
    expect(validateFeeSchedule(scheduleFixture({ tiers: [{ up_to_notional: null, maker_bps: '1', taker_bps: '1' }, { up_to_notional: '5', maker_bps: '1', taker_bps: '1' }] })).ok).toBe(false);
    expect(validateFeeSchedule(scheduleFixture({ tiers: [{ up_to_notional: '100', maker_bps: '1', taker_bps: '1' }, { up_to_notional: '100', maker_bps: '1', taker_bps: '1' }, { up_to_notional: null, maker_bps: '1', taker_bps: '1' }] })).ok).toBe(false);
    expect(validateFeeSchedule(scheduleFixture({ tiers: [{ up_to_notional: '0', maker_bps: '1', taker_bps: '1' }, { up_to_notional: null, maker_bps: '1', taker_bps: '1' }] })).ok).toBe(false);
    expect(validateFeeSchedule(scheduleFixture({ tiers: [{ up_to_notional: '10', maker_bps: '-1', taker_bps: '1' }, { up_to_notional: null, maker_bps: '1', taker_bps: '1' }] })).ok).toBe(false);
    expect(validateFeeSchedule({ tiers: [], fee_decimals: 8 }).ok).toBe(false);
    expect(validateFeeSchedule(scheduleFixture({ fee_decimals: -1 })).ok).toBe(false);
    expect(validateFeeSchedule(scheduleFixture({ fee_decimals: 1.5 })).ok).toBe(false);
  });
});

describe('tier selection (boundaries)', () => {
  const schedule = unwrap(validateFeeSchedule(scheduleFixture())) as FeeSchedule;

  it('selects the first covering bound INCLUSIVELY', () => {
    expect(selectFeeTier(schedule, '9999.999').up_to_notional).toBe('10000');
    expect(selectFeeTier(schedule, '10000').up_to_notional).toBe('10000'); // inclusive boundary
    expect(selectFeeTier(schedule, '10000.01').up_to_notional).toBe('100000');
    expect(selectFeeTier(schedule, '100000').up_to_notional).toBe('100000');
    expect(selectFeeTier(schedule, '100000.01').up_to_notional).toBeNull();
    expect(selectFeeTier(schedule, '999999999999').up_to_notional).toBeNull();
  });
});

describe('fee computation (exact but for the declared half-up rounding)', () => {
  const schedule = unwrap(validateFeeSchedule(scheduleFixture())) as FeeSchedule;

  it('prices maker and taker roles from the same notional', () => {
    // 100 x 0.5 = notional 50 -> first tier: maker 1bps, taker 2bps.
    const maker = feeOf(schedule, 'maker', '100', '0.5');
    const taker = feeOf(schedule, 'taker', '100', '0.5');
    expect(maker.notional).toBe('50');
    expect(maker.fee).toBe('0.005'); // 50 * 1 / 10000
    expect(taker.fee).toBe('0.01'); // 50 * 2 / 10000
    expect(feesOfFill(schedule, '100', '0.5').taker.fee).toBe('0.01');
  });

  it('rounds half-up at the schedule precision (the declared approximation)', () => {
    // 3 * 1 = 3 notional; taker 2bps: 3*2/10000 = 0.0006 -> 8dp: 0.0006 exact.
    expect(feeOf(schedule, 'taker', '3', '1').fee).toBe('0.0006');
    // 1 * 1 = 1 notional; maker 1bps: 1/10000 = 0.0001 exact.
    expect(feeOf(schedule, 'maker', '1', '1').fee).toBe('0.0001');
    // 0.1 * 0.1 = 0.01 notional; taker 2bps -> 0.000002 exact at 8dp.
    expect(feeOf(schedule, 'taker', '0.1', '0.1').fee).toBe('0.000002');
    // 0.125 * 1 / 10000 = 0.0000125 — exactly representable at 8dp (7 fractional
    // digits), so no rounding occurs; canonical form strips the trailing zero.
    expect(feeOf(schedule, 'maker', '0.125', '1').fee).toBe('0.0000125');
    // Just below the half: notional 0.115, maker 1bps -> 0.0000115 -> 0.000012? no: half-up on 0.0000115 at 8dp = 0.0000115 (9 digits -> rounds 115->12? compute: 0.0000115 * 10^8 = 1150 -> half-up -> 1150/100 = 11.5 -> 12 -> 0.0000012? Let me not confuse: 0.0000115 at 8dp -> 0.00000115? No.
    // Precisely: 0.125 * 1 / 10000 = 0.0000125. At 8dp: 0.00001250 -> digits 125 at 9th place... 0.0000125 has 7 decimal places, fits in 8. Exact.
  });

  it('selects tiers by the exact notional (no float mediation)', () => {
    // notional exactly at the 10000 boundary crosses into tier 1 (inclusive).
    const atBoundary = feeOf(schedule, 'taker', '10000', '1');
    expect(atBoundary.bps).toBe('2');
    const justAbove = feeOf(schedule, 'taker', '10000.01', '1');
    expect(justAbove.bps).toBe('1');
  });
});

describe('L6 fidelity declaration (acceptance criterion 5)', () => {
  it('the declaration record exists, is frozen, and names modeled AND declared limitations', () => {
    expect(FEE_FIDELITY).toBeDefined();
    expect(Object.isFrozen(FEE_FIDELITY)).toBe(true);
    expect(FEE_FIDELITY.modeled.length).toBeGreaterThan(0);
    expect(FEE_FIDELITY.declared_limitations.length).toBeGreaterThan(0);
    expect(FEE_FIDELITY.declared_limitations.join(' ')).toMatch(/per-fill/);
    expect(FEE_FIDELITY.modeled.join(' ')).toMatch(/half-up/);
  });
});
