// Tests for the Time Machine — T-x, explicit timestamp, controlled playback.
//
// Laws pinned here (timemachine.ts header):
//   - four modes (live, t-minus, timestamp, playback); every transition pure;
//   - the view instant derives from an INJECTED anchor (never a wall clock);
//   - a view instant may never point AFTER the anchor (no inspecting the future);
//   - playback is controlled: armed with a step, advanced by ticks;
//   - L4 interaction: the projection + render gate consume viewAt — a
//     post-availability fact at a view time is the typed
//     AvailabilityViolationError.

import { describe, expect, it } from 'vitest';
import { assertVisible, projectToView } from './availability';
import { AvailabilityViolationError } from './errors';
import {
  advanceAnchor,
  backToLive,
  liveTimeMachine,
  playbackProgressOf,
  setTimestamp,
  setTMinus,
  startPlayback,
  tickPlayback,
  viewAtOf,
} from './timemachine';

const ANCHOR = 1_700_000_000_000;

describe('timemachine: the live default + anchor following', () => {
  it('opens live at the injected anchor', () => {
    const state = liveTimeMachine(ANCHOR);
    expect(state.mode).toBe('live');
    expect(viewAtOf(state)).toBe(ANCHOR);
    expect(state.playback).toBeNull();
  });

  it('advanceAnchor follows the injected instant in every mode', () => {
    const live = advanceAnchor(liveTimeMachine(ANCHOR), ANCHOR + 5_000);
    expect(viewAtOf(live)).toBe(ANCHOR + 5_000);
    const tminus = advanceAnchor(setTMinus(liveTimeMachine(ANCHOR), 1_000), ANCHOR + 5_000);
    expect(viewAtOf(tminus)).toBe(ANCHOR + 4_000); // the T-x offset rides the new anchor
  });
});

describe('timemachine: T-x', () => {
  it('views the world x ms before the anchor', () => {
    const state = setTMinus(liveTimeMachine(ANCHOR), 86_400_000);
    expect(state.mode).toBe('t-minus');
    expect(viewAtOf(state)).toBe(ANCHOR - 86_400_000);
  });

  it('T-0 is the anchor itself (no negative offsets, no fractionals)', () => {
    expect(viewAtOf(setTMinus(liveTimeMachine(ANCHOR), 0))).toBe(ANCHOR);
    expect(() => setTMinus(liveTimeMachine(ANCHOR), -1)).toThrow(/non-negative integer/);
    expect(() => setTMinus(liveTimeMachine(ANCHOR), 1.5)).toThrow(/non-negative integer/);
  });

  it('re-setting T-x replaces the offset (not stacking)', () => {
    const once = setTMinus(liveTimeMachine(ANCHOR), 1_000);
    const twice = setTMinus(once, 3_000);
    expect(viewAtOf(twice)).toBe(ANCHOR - 3_000);
  });
});

describe('timemachine: the explicit timestamp', () => {
  it('views exactly the stamped instant', () => {
    const state = setTimestamp(liveTimeMachine(ANCHOR), ANCHOR - 10_000);
    expect(state.mode).toBe('timestamp');
    expect(viewAtOf(state)).toBe(ANCHOR - 10_000);
  });

  it('a timestamp AFTER the anchor is refused — the Time Machine inspects the past, never the future', () => {
    expect(() => setTimestamp(liveTimeMachine(ANCHOR), ANCHOR + 1)).toThrow(/after the anchor/);
    expect(() => setTimestamp(liveTimeMachine(ANCHOR), ANCHOR)).not.toThrow(); // exactly the anchor is fine
    expect(() => setTimestamp(liveTimeMachine(ANCHOR), 1.5)).toThrow(/integer/);
  });
});

describe('timemachine: controlled playback', () => {
  it('arms at a start instant with a step; ticks advance by exactly one step', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 1_000);
    expect(state.mode).toBe('playback');
    expect(state.playback?.ticks).toBe(0);
    expect(viewAtOf(state)).toBe(ANCHOR - 10_000);
    state = tickPlayback(state);
    expect(viewAtOf(state)).toBe(ANCHOR - 9_000);
    state = tickPlayback(state);
    state = tickPlayback(state);
    expect(viewAtOf(state)).toBe(ANCHOR - 7_000);
    expect(state.playback?.ticks).toBe(3);
  });

  it('a tick past the anchor is refused (playback cannot run into the future)', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 2_000, 1_000);
    state = tickPlayback(state); // ANCHOR - 1000
    state = tickPlayback(state); // ANCHOR — the boundary is inclusive
    expect(() => tickPlayback(state)).toThrow(/after the anchor/);
  });

  it('a tick with playback not armed is a typed input error', () => {
    expect(() => tickPlayback(liveTimeMachine(ANCHOR))).toThrow(/not armed/);
    expect(() => tickPlayback(setTMinus(liveTimeMachine(ANCHOR), 5))).toThrow(/not armed/);
  });

  it('arming requires an integer start and a non-negative integer step', () => {
    expect(() => startPlayback(liveTimeMachine(ANCHOR), 1.5, 1)).toThrow(/integer/);
    expect(() => startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10, -1)).toThrow(/non-negative integer/);
    expect(() => startPlayback(liveTimeMachine(ANCHOR), ANCHOR + 10, 1)).toThrow(/after the anchor/);
  });

  it('backToLive returns to the live view and disarms playback', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 1_000);
    state = tickPlayback(state);
    const live = backToLive(state);
    expect(live.mode).toBe('live');
    expect(live.playback).toBeNull();
    expect(viewAtOf(live)).toBe(ANCHOR);
  });

  it('playbackProgressOf renders the pure progress fraction', () => {
    expect(playbackProgressOf(liveTimeMachine(ANCHOR))).toBeNull();
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 2_500);
    expect(playbackProgressOf(state)).toBe(0);
    state = tickPlayback(state);
    expect(playbackProgressOf(state)).toBe(0.25);
    state = tickPlayback(state);
    state = tickPlayback(state);
    state = tickPlayback(state);
    expect(playbackProgressOf(state)).toBe(1); // clamped at the anchor
  });
});

describe('timemachine: THE L4 INTERACTION (the demanded pin)', () => {
  // A record whose facts became knowable at ANCHOR - 500 (inside the
  // viewed window) and one knowable only at ANCHOR + 500 (the future).
  const records = [
    { datumRef: 'outcome/early', availableAt: ANCHOR - 5_000 },
    { datumRef: 'outcome/late', availableAt: ANCHOR + 500 },
  ];

  it('the projection at a T-x view hides what was not yet knowable', () => {
    const view = setTMinus(liveTimeMachine(ANCHOR), 1_000); // viewAt = ANCHOR - 1000
    const visible = projectToView(records, viewAtOf(view), (r) => r.availableAt);
    expect(visible.map((r) => r.datumRef)).toEqual(['outcome/early']);
  });

  it('rendering a post-availability datum at the view time is the typed AvailabilityViolationError', () => {
    const view = setTMinus(liveTimeMachine(ANCHOR), 1_000);
    const viewAt = viewAtOf(view);
    expect(() => assertVisible(records[1] as never, viewAt)).toThrow(AvailabilityViolationError);
    expect(() => assertVisible(records[0] as never, viewAt)).not.toThrow();
  });

  it('a timestamp view at the exact availability instant shows the datum (the boundary is inclusive)', () => {
    const view = setTimestamp(liveTimeMachine(ANCHOR), ANCHOR - 5_000);
    expect(projectToView(records, viewAtOf(view), (r) => r.availableAt).map((r) => r.datumRef)).toEqual(['outcome/early']);
    expect(() => assertVisible(records[0] as never, viewAtOf(view))).not.toThrow();
  });

  it('live view at the anchor: the late datum still hidden (its availability is after the anchor)', () => {
    const live = liveTimeMachine(ANCHOR);
    expect(projectToView(records, viewAtOf(live), (r) => r.availableAt)).toHaveLength(1);
  });
});
