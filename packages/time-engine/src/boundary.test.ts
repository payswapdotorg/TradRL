import { describe, expect, it } from 'vitest';

import {
  advanceClockTo,
  createSimulationClock,
  createVisibilityFilter,
  isVisibleAt,
  observableAt,
  requireTimestampMs,
  type Observable,
  type SimulationClock,
  type TimeResult,
} from './index';

function unwrap<T>(result: TimeResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${result.error.code}: ${result.error.message}`);
}

function mkClock(now: number, asOf: number): SimulationClock {
  return unwrap(
    createSimulationClock({ asOf: requireTimestampMs(asOf), now: requireTimestampMs(now), fidelity: 'exact_replay' }),
  );
}

interface StubObservation extends Observable {
  readonly id: string;
  readonly available_time: number & { readonly __brand: 'TradRL.TimestampMs' };
}

function obs(id: string, availableTime: number): StubObservation {
  return { id, available_time: requireTimestampMs(availableTime) };
}

describe('isVisibleAt — the boundary predicate', () => {
  it('an observation becomes visible EXACTLY at its available_time, never before', () => {
    const observation = obs('e1', 1_000);
    expect(isVisibleAt(observation, requireTimestampMs(998))).toBe(false); // 2 ms early
    expect(isVisibleAt(observation, requireTimestampMs(999))).toBe(false); // 1 ms early
    expect(isVisibleAt(observation, requireTimestampMs(1_000))).toBe(true); // exact instant — INCLUSIVE
    expect(isVisibleAt(observation, requireTimestampMs(1_001))).toBe(true); // 1 ms late
    expect(isVisibleAt(observation, requireTimestampMs(1_002))).toBe(true); // 2 ms late
  });
});

describe('observableAt', () => {
  it('yields the observable subset at an instant, preserving order', () => {
    const events = [obs('a', 100), obs('b', 300), obs('c', 200), obs('d', 50)];
    const visible = observableAt(events, requireTimestampMs(200));
    expect(visible.map((e) => e.id)).toEqual(['a', 'c', 'd']);
  });
});

describe('createVisibilityFilter', () => {
  const events = [obs('a', 100), obs('b', 300), obs('c', 200)];

  it('filters and withholds complementary subsets at the clock now', () => {
    const filter = createVisibilityFilter<StubObservation>(mkClock(200, 1_000));
    expect(filter.isVisible(obs('x', 199))).toBe(true);
    expect(filter.isVisible(obs('y', 201))).toBe(false);
    expect(filter.filter(events).map((e) => e.id)).toEqual(['a', 'c']);
    expect(filter.withheld(events).map((e) => e.id)).toEqual(['b']);
    const union = [...filter.filter(events), ...filter.withheld(events)].map((e) => e.id).sort();
    expect(union).toEqual(['a', 'b', 'c']);
  });

  it('events become observable exactly as the clock advances to their available_time', () => {
    let clock = mkClock(0, 10_000);
    expect(createVisibilityFilter<StubObservation>(clock).filter(events)).toEqual([]);

    clock = unwrap(advanceClockTo(clock, requireTimestampMs(99)));
    expect(createVisibilityFilter<StubObservation>(clock).filter(events)).toEqual([]);

    clock = unwrap(advanceClockTo(clock, requireTimestampMs(100))); // 'a' releases exactly here
    expect(createVisibilityFilter<StubObservation>(clock).filter(events).map((e) => e.id)).toEqual(['a']);

    clock = unwrap(advanceClockTo(clock, requireTimestampMs(199)));
    expect(createVisibilityFilter<StubObservation>(clock).filter(events).map((e) => e.id)).toEqual(['a']);

    clock = unwrap(advanceClockTo(clock, requireTimestampMs(200))); // 'c' releases exactly here
    expect(createVisibilityFilter<StubObservation>(clock).filter(events).map((e) => e.id)).toEqual(['a', 'c']);

    clock = unwrap(advanceClockTo(clock, requireTimestampMs(299)));
    expect(createVisibilityFilter<StubObservation>(clock).filter(events).map((e) => e.id)).toEqual(['a', 'c']);

    clock = unwrap(advanceClockTo(clock, requireTimestampMs(300))); // 'b' releases exactly here
    expect(createVisibilityFilter<StubObservation>(clock).filter(events).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});
