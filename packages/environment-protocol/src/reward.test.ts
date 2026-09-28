/**
 * Reward signals: optional, explicit, never fabricated. Validation rules,
 * the `available_time >= at` order law, and the inclusive visibility
 * predicate.
 */

import { describe, expect, it } from 'vitest';

import { isRewardSignal, isRewardVisible, validateRewardSignal, type RewardSignal } from './index';
import { requireTimestampMs } from './index';

function reward(overrides: Record<string, unknown> = {}): RewardSignal {
  const result = validateRewardSignal({
    reward_id: 'rw-1',
    episode_id: 'ep-01234567',
    at: requireTimestampMs(1_000),
    available_time: requireTimestampMs(1_000),
    value: 0.5,
    metric: 'stub-tick',
    source: 'stub-world',
    detail: null,
    ...overrides,
  });
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('reward validation', () => {
  it('accepts a well-formed signal and freezes it deeply', () => {
    const signal = reward();
    expect(isRewardSignal(signal)).toBe(true);
    expect(Object.isFrozen(signal)).toBe(true);
  });

  it('value may be negative, zero, or fractional (the protocol never interprets it)', () => {
    for (const value of [-1.25, 0, 3]) {
      expect(validateRewardSignal({ ...reward(), value, reward_id: `rw-${value}` }).ok).toBe(true);
    }
  });

  it('rejects non-finite values', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(validateRewardSignal({ ...reward(), value, reward_id: `rw-${value}` }).ok).toBe(false);
    }
  });

  it('collects every violation together (missing + invalid)', () => {
    const result = validateRewardSignal({
      reward_id: '',
      episode_id: 3,
      at: 'x',
      available_time: -1,
      value: Number.NaN,
      metric: ' ',
      source: '',
      detail: 7,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBe(8);
    }
  });

  it('enforces available_time >= at (a reward about an instant cannot be observed before it)', () => {
    const result = validateRewardSignal({
      ...reward(),
      at: requireTimestampMs(2_000),
      available_time: requireTimestampMs(1_999),
      reward_id: 'rw-order',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe('invalid_field');
      expect(result.errors[0].path).toBe('reward.available_time');
    }
    // Equality is legal: available exactly when the effect instant arrives.
    expect(
      validateRewardSignal({ ...reward(), at: requireTimestampMs(2_000), available_time: requireTimestampMs(2_000), reward_id: 'rw-eq' }).ok,
    ).toBe(true);
  });

  it('detail must be a JSON object or null', () => {
    expect(validateRewardSignal({ ...reward(), detail: [1] }).ok).toBe(false);
    expect(validateRewardSignal({ ...reward(), detail: 'text' }).ok).toBe(false);
    expect(validateRewardSignal({ ...reward(), detail: { note: 'partial fill' } }).ok).toBe(true);
  });
});

describe('reward visibility (L4 applies to rewards identically)', () => {
  it('a signal is visible iff available_time <= at (inclusive)', () => {
    const signal = reward({ available_time: requireTimestampMs(5_000), at: requireTimestampMs(5_000), reward_id: 'rw-vis' });
    expect(isRewardVisible(signal, requireTimestampMs(4_999))).toBe(false);
    expect(isRewardVisible(signal, requireTimestampMs(5_000))).toBe(true);
    expect(isRewardVisible(signal, requireTimestampMs(5_001))).toBe(true);
  });
});
