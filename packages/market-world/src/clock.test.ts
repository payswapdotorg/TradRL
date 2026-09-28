/**
 * @tradrl/market-world — ClockState (mirror of time-engine's
 * SimulationClock) behavioral tests.
 *
 * Covers: construction defaults and invariants, the advance law (monotonic,
 * anchored, no-op legal), guard totality, and deep freezing.
 */

import type { TimestampMs } from './index';
import { describe, expect, it } from 'vitest';

import {
  advanceClockStateTo,
  createClockState,
  isClockState,
  isFidelityMode,
  FIDELITY_MODES,
  isDeeplyFrozen,
} from './index';

const T0 = 1_700_000_000_000;

describe('createClockState', () => {
  it('defaults: now = asOf, playbackSpeed = 1, paused = false, point-in-time policy', () => {
    const result = createClockState({ asOf:(T0) as TimestampMs, fidelity: 'exact_replay' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.now).toBe(T0);
    expect(result.value.asOf).toBe(T0);
    expect(result.value.playbackSpeed).toBe(1);
    expect(result.value.paused).toBe(false);
    expect(result.value.fidelity).toBe('exact_replay');
    expect(result.value.informationPolicy).toBe('point-in-time');
  });

  it('rejects now > asOf (beyond_as_of)', () => {
    const result = createClockState({ asOf:(T0) as TimestampMs, now:(T0 + 1) as TimestampMs, fidelity: 'exact_replay' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('beyond_as_of');
  });

  it('rejects a non-positive playback speed', () => {
    expect(createClockState({ asOf:(T0) as TimestampMs, playbackSpeed: 0, fidelity: 'exact_replay' }).ok).toBe(false);
    expect(createClockState({ asOf:(T0) as TimestampMs, playbackSpeed: Number.POSITIVE_INFINITY, fidelity: 'exact_replay' }).ok).toBe(false);
  });

  it('accepts all three L5 fidelity modes at the SHAPE level (the runtime world gate is separate)', () => {
    for (const fidelity of FIDELITY_MODES) {
      expect(isFidelityMode(fidelity)).toBe(true);
      expect(createClockState({ asOf:(T0) as TimestampMs, fidelity }).ok).toBe(true);
    }
    expect(isFidelityMode('replay')).toBe(false); // no aliasing (L5)
    expect(isFidelityMode('exact')).toBe(false);
  });
});

describe('advanceClockStateTo (the mirrored advance law)', () => {
  it('advances forward within the anchor', () => {
    const clock = createClockState({ asOf:(T0 + 1000) as TimestampMs, now:(T0) as TimestampMs, fidelity: 'exact_replay' });
    if (!clock.ok) throw new Error('fixture');
    const advanced = advanceClockStateTo(clock.value, (T0 + 500) as TimestampMs);
    expect(advanced.ok).toBe(true);
    if (advanced.ok) expect(advanced.value.now).toBe(T0 + 500);
  });

  it('rejects regression (clock_regression)', () => {
    const clock = createClockState({ asOf:(T0 + 1000) as TimestampMs, now:(T0 + 500) as TimestampMs, fidelity: 'exact_replay' });
    if (!clock.ok) throw new Error('fixture');
    const regressed = advanceClockStateTo(clock.value, (T0 + 499) as TimestampMs);
    expect(regressed.ok).toBe(false);
    if (regressed.ok) return;
    expect(regressed.errors[0]?.code).toBe('clock_regression');
  });

  it('rejects advancing past asOf (beyond_as_of)', () => {
    const clock = createClockState({ asOf:(T0 + 1000) as TimestampMs, now:(T0) as TimestampMs, fidelity: 'exact_replay' });
    if (!clock.ok) throw new Error('fixture');
    const beyond = advanceClockStateTo(clock.value, (T0 + 1001) as TimestampMs);
    expect(beyond.ok).toBe(false);
    if (beyond.ok) return;
    expect(beyond.errors[0]?.code).toBe('beyond_as_of');
  });

  it('treats to == now as a legal no-op and to == asOf as the final legal step', () => {
    const clock = createClockState({ asOf:(T0 + 1000) as TimestampMs, now:(T0 + 500) as TimestampMs, fidelity: 'exact_replay' });
    if (!clock.ok) throw new Error('fixture');
    expect(advanceClockStateTo(clock.value, (T0 + 500) as TimestampMs).ok).toBe(true);
    expect(advanceClockStateTo(clock.value, (T0 + 1000) as TimestampMs).ok).toBe(true);
  });
});

describe('guards and immutability', () => {
  it('isClockState rejects malformed values totally', () => {
    const good = createClockState({ asOf:(T0) as TimestampMs, fidelity: 'exact_replay' });
    if (!good.ok) throw new Error('fixture');
    expect(isClockState(good.value)).toBe(true);
    expect(isClockState(null)).toBe(false);
    expect(isClockState({ now: T0, asOf: T0, playbackSpeed: 1, paused: false, fidelity: 'daydream', informationPolicy: 'point-in-time' })).toBe(false);
    expect(isClockState({ now: T0 + 1, asOf: T0, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' })).toBe(false);
    expect(isClockState({ now: T0, asOf: T0, playbackSpeed: -1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' })).toBe(false);
    expect(isClockState({ now: T0, asOf: T0, playbackSpeed: 1, paused: 'no', fidelity: 'exact_replay', informationPolicy: 'point-in-time' })).toBe(false);
    expect(isClockState({ now: T0, asOf: T0, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'realtime' })).toBe(false);
  });

  it('constructed clocks are deeply frozen', () => {
    const good = createClockState({ asOf:(T0) as TimestampMs, fidelity: 'exact_replay' });
    if (!good.ok) throw new Error('fixture');
    expect(isDeeplyFrozen(good.value)).toBe(true);
  });
});
