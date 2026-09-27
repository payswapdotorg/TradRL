import { describe, expect, it } from 'vitest';

import {
  advanceClockBy,
  advanceClockTo,
  createSimulationClock,
  isFidelityMode,
  isSimulationClock,
  pauseClock,
  requireTimestampMs,
  resumeClock,
  withPlaybackSpeed,
  type SimulationClock,
  type TimeResult,
} from './index';

function unwrap<T>(result: TimeResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${result.error.code}: ${result.error.message}`);
}

function mkClock(now: number, asOf: number, fidelity: 'exact_replay' | 'reactive_replay' | 'generative' = 'exact_replay'): SimulationClock {
  return unwrap(
    createSimulationClock({
      asOf: requireTimestampMs(asOf),
      now: requireTimestampMs(now),
      fidelity,
    }),
  );
}

describe('createSimulationClock', () => {
  it('constructs a clock with explicit fields', () => {
    const clock = unwrap(
      createSimulationClock({
        asOf: requireTimestampMs(10_000),
        now: requireTimestampMs(4_000),
        playbackSpeed: 2.5,
        paused: true,
        fidelity: 'reactive_replay',
      }),
    );
    expect(clock.now).toBe(4_000);
    expect(clock.asOf).toBe(10_000);
    expect(clock.playbackSpeed).toBe(2.5);
    expect(clock.paused).toBe(true);
    expect(clock.fidelity).toBe('reactive_replay');
    expect(clock.informationPolicy).toBe('point-in-time');
  });

  it('defaults now to asOf, speed to 1, paused to false', () => {
    const clock = unwrap(
      createSimulationClock({ asOf: requireTimestampMs(10_000), fidelity: 'exact_replay' }),
    );
    expect(clock.now).toBe(10_000);
    expect(clock.playbackSpeed).toBe(1);
    expect(clock.paused).toBe(false);
  });

  it('rejects now beyond asOf — a simulation may never outrun its information anchor', () => {
    const result = createSimulationClock({
      asOf: requireTimestampMs(10_000),
      now: requireTimestampMs(10_001),
      fidelity: 'exact_replay',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('beyond_as_of');
  });

  it('rejects non-positive or non-finite playback speeds', () => {
    for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = createSimulationClock({
        asOf: requireTimestampMs(10_000),
        fidelity: 'exact_replay',
        playbackSpeed: speed,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_playback_speed');
    }
  });

  it('rejects an unknown fidelity mode', () => {
    const result = createSimulationClock({
      asOf: requireTimestampMs(10_000),
      fidelity: 'fast_forward' as unknown as 'exact_replay',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_clock');
  });

  it('treats the three L5 fidelity modes as distinct values', () => {
    const exact = mkClock(0, 100, 'exact_replay');
    const reactive = mkClock(0, 100, 'reactive_replay');
    const generative = mkClock(0, 100, 'generative');
    const modes = [exact.fidelity, reactive.fidelity, generative.fidelity];
    expect(new Set(modes).size).toBe(3);
    expect(isFidelityMode('exact_replay')).toBe(true);
    expect(isFidelityMode('reactive_replay')).toBe(true);
    expect(isFidelityMode('generative')).toBe(true);
    expect(isFidelityMode('realtime')).toBe(false);
  });
});

describe('clock transitions', () => {
  it('advanceClockTo moves now forward and preserves everything else', () => {
    const clock = mkClock(4_000, 10_000);
    const advanced = unwrap(advanceClockTo(clock, requireTimestampMs(6_000)));
    expect(advanced.now).toBe(6_000);
    expect(advanced.asOf).toBe(10_000);
    expect(advanced.playbackSpeed).toBe(clock.playbackSpeed);
    expect(advanced.fidelity).toBe(clock.fidelity);
    expect(advanceClockTo(clock, requireTimestampMs(4_000)).ok).toBe(true); // idempotent
  });

  it('advanceClockTo refuses to move backwards (monotonic discipline)', () => {
    const result = advanceClockTo(mkClock(4_000, 10_000), requireTimestampMs(3_999));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('clock_regression');
  });

  it('advanceClockTo refuses to move past asOf', () => {
    const result = advanceClockTo(mkClock(4_000, 10_000), requireTimestampMs(10_001));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('beyond_as_of');
  });

  it('advanceClockBy adds a duration (T + x minutes) and enforces the same bounds', () => {
    const clock = mkClock(Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 1, 1));
    const plus5m = unwrap(advanceClockBy(clock, { minutes: 5 }));
    expect(plus5m.now).toBe(Date.UTC(2024, 0, 1, 0, 5));
    const plus90s = unwrap(advanceClockBy(clock, { seconds: 90 }));
    expect(plus90s.now).toBe(Date.UTC(2024, 0, 1, 0, 1, 30));

    const beyond = advanceClockBy(mkClock(0, 10_000), { minutes: 1 }); // 60_000 > 10_000
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(beyond.error.code).toBe('beyond_as_of');

    const badDuration = advanceClockBy(clock, { minutes: -5 });
    expect(badDuration.ok).toBe(false);
    if (!badDuration.ok) expect(badDuration.error.code).toBe('invalid_duration');
  });

  it('withPlaybackSpeed validates the multiplier', () => {
    const clock = mkClock(0, 100);
    expect(unwrap(withPlaybackSpeed(clock, 10)).playbackSpeed).toBe(10);
    for (const bad of [0, -2, Number.NaN]) {
      const result = withPlaybackSpeed(clock, bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_playback_speed');
    }
  });

  it('pause and resume toggle the flag, never move now, and are idempotent', () => {
    const clock = mkClock(4_000, 10_000);
    const paused = pauseClock(clock);
    expect(paused.paused).toBe(true);
    expect(paused.now).toBe(4_000);
    expect(pauseClock(paused)).toBe(paused); // idempotent
    const resumed = resumeClock(paused);
    expect(resumed.paused).toBe(false);
    expect(resumed.now).toBe(4_000);
    expect(resumeClock(resumed)).toBe(resumed); // idempotent
  });
});

describe('isSimulationClock guard', () => {
  it('accepts a valid clock', () => {
    expect(isSimulationClock(mkClock(1, 2))).toBe(true);
  });

  it('rejects structural and invariant violations', () => {
    const good = mkClock(1, 2);
    expect(isSimulationClock({ ...good, now: 3 })).toBe(false); // now > asOf
    expect(isSimulationClock({ ...good, now: 1.5 })).toBe(false); // non-integer
    expect(isSimulationClock({ ...good, playbackSpeed: 0 })).toBe(false);
    expect(isSimulationClock({ ...good, paused: 'yes' })).toBe(false);
    expect(isSimulationClock({ ...good, fidelity: 'warp' })).toBe(false);
    expect(isSimulationClock({ ...good, informationPolicy: 'anything-goes' })).toBe(false);
    expect(isSimulationClock(null)).toBe(false);
    expect(isSimulationClock(42)).toBe(false);
  });
});
