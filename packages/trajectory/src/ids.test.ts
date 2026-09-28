/**
 * @tradrl/trajectory — guard totality for ids, timestamps and clock samples.
 *
 * Negative paths are the point: every guard must reject every malformed
 * shape without throwing, and accept every well-formed one.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_TIMESTAMP_MS,
  MIN_TIMESTAMP_MS,
  isCausalityId,
  isClockSample,
  isFidelityMode,
  isStepId,
  isTimestampMs,
  isTrajectoryId,
  requireTimestampMs,
  timestampMs,
} from './index';
import { validStep } from './fixtures';

const NOT_IDS = [undefined, null, 42, true, '', '   ', {}, [], Symbol('x')];

describe('branded id guards', () => {
  it('accept non-empty strings', () => {
    for (const guard of [isTrajectoryId, isStepId, isCausalityId]) {
      expect(guard('traj-1')).toBe(true);
      expect(guard('x')).toBe(true);
    }
  });

  it('reject every non-string and empty/whitespace string, without throwing', () => {
    for (const guard of [isTrajectoryId, isStepId, isCausalityId]) {
      for (const bad of NOT_IDS) {
        expect(guard(bad)).toBe(false);
      }
    }
  });
});

describe('TimestampMs mirror', () => {
  it('accepts integers within the representable range', () => {
    expect(isTimestampMs(0)).toBe(true);
    expect(isTimestampMs(1)).toBe(true);
    expect(isTimestampMs(MAX_TIMESTAMP_MS)).toBe(true);
    expect(isTimestampMs(MIN_TIMESTAMP_MS)).toBe(true);
  });

  it('rejects non-integers, non-finite, out-of-range and non-number values', () => {
    for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_TIMESTAMP_MS + 1, '0', null, {}]) {
      expect(isTimestampMs(bad)).toBe(false);
    }
  });

  it('timestampMs returns typed errors for the same value set', () => {
    for (const bad of [1.5, -1, Number.NaN, MAX_TIMESTAMP_MS + 1]) {
      const result = timestampMs(bad as number);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_timestamp');
    }
    const good = timestampMs(42);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value).toBe(42);
  });

  it('requireTimestampMs throws for invalid literals and passes valid ones through', () => {
    expect(requireTimestampMs(42)).toBe(42);
    expect(() => requireTimestampMs(1.5)).toThrow(RangeError);
  });
});

describe('ClockSample', () => {
  it('accepts a sample with now <= asOf', () => {
    expect(isClockSample(validStep().clock)).toBe(true);
    expect(isClockSample({ now: 100, asOf: 100 })).toBe(true);
  });

  it('rejects now > asOf, invalid timestamps and malformed shapes', () => {
    expect(isClockSample({ now: 101, asOf: 100 })).toBe(false);
    expect(isClockSample({ now: 1.5, asOf: 100 })).toBe(false);
    expect(isClockSample({ now: 100 })).toBe(false);
    expect(isClockSample(null)).toBe(false);
    expect(isClockSample([100, 200])).toBe(false);
  });
});

describe('FidelityMode vocabulary (L5)', () => {
  it('accepts exactly the three distinct modes', () => {
    expect(isFidelityMode('exact_replay')).toBe(true);
    expect(isFidelityMode('reactive_replay')).toBe(true);
    expect(isFidelityMode('generative')).toBe(true);
  });

  it('rejects everything else — the modes are never aliased', () => {
    for (const bad of ['replay', 'exact', 'EXACT_REPLAY', 'reactive', '', 42, null]) {
      expect(isFidelityMode(bad)).toBe(false);
    }
  });
});
