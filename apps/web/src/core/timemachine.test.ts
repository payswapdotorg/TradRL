// Tests for the Time Machine — T-x, explicit timestamp, controlled playback.
//
// Laws pinned here (timemachine.ts header):
//   - four modes (live, t-minus, timestamp, playback); every transition pure;
//   - the view instant derives from an INJECTED anchor (never a wall clock);
//   - a view instant may never point AFTER the anchor (no inspecting the future);
//   - playback is controlled: armed with a step, advanced by ticks;
//   - THE PAUSE (R10, W-25C): pause FREEZES the view instant (a tick
//     while paused advances nothing; the anchor never regresses) and
//     resume continues from exactly the frozen instant;
//   - L4 interaction: the projection + render gate consume viewAt — a
//     post-availability fact at a view time is the typed
//     AvailabilityViolationError.

import { describe, expect, it } from 'vitest';
import { assertVisible, projectToView } from './availability';
import { AvailabilityViolationError } from './errors';
import {
  advanceAnchor,
  backToLive,
  isPlaybackSpeedKey,
  liveTimeMachine,
  pausePlayback,
  parsePlaybackCustomSpeed,
  playbackProgressOf,
  playbackStepMsOf,
  PLAYBACK_CUSTOM_SPEED_MAX,
  PLAYBACK_CUSTOM_SPEED_MIN,
  PLAYBACK_SPEED_KEYS,
  resumePlayback,
  retunePlayback,
  setTimestamp,
  setTMinus,
  startPlayback,
  stopPlaybackAtAnchor,
  stepBackPlayback,
  stepForwardPlayback,
  tickPlayback,
  viewAtOf,
  TIME_MACHINE_STEP_MS,
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

describe('timemachine: THE PAUSE (R10, W-25C — pause freezes the view, resume continues from the frozen instant)', () => {
  it('pause FREEZES the view instant: fromAt/ticks untouched (no jump-back), a tick while paused advances NOTHING', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 1_000);
    state = tickPlayback(state);
    state = tickPlayback(state);
    state = tickPlayback(state);
    const frozenAt = viewAtOf(state); // ANCHOR - 7_000
    expect(frozenAt).toBe(ANCHOR - 7_000);
    const paused = pausePlayback(state);
    expect(paused.mode).toBe('playback');
    expect(paused.playback?.paused).toBe(true);
    expect(paused.playback?.fromAt).toBe(state.playback?.fromAt); // no re-arm at the opened instant (the R10 defect)
    expect(paused.playback?.ticks).toBe(3); // no tick reset
    expect(viewAtOf(paused)).toBe(frozenAt); // NO JUMP-BACK — the exact J5 symptom
    // The scheduled beat keeps arriving while paused — every tick is a no-op.
    let still = paused;
    for (let beat = 0; beat < 5; beat += 1) still = tickPlayback(still);
    expect(viewAtOf(still)).toBe(frozenAt); // frozen — playback does NOT keep advancing
    expect(still.playback?.ticks).toBe(3);
    expect(pausePlayback(paused)).toEqual(paused); // idempotent
  });

  it('the anchor keeps following the observed now while paused (the anchor never regresses; the VIEW does not follow it)', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 1_000);
    state = tickPlayback(state);
    const paused = pausePlayback(advanceAnchor(state, ANCHOR + 60_000));
    expect(paused.anchorAt).toBe(ANCHOR + 60_000);
    expect(viewAtOf(paused)).toBe(ANCHOR - 9_000); // the view stays at the frozen instant
  });

  it('resume continues from EXACTLY the frozen instant (the next tick steps from where pause left the view)', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 1_000);
    state = tickPlayback(state);
    state = tickPlayback(state);
    const paused = pausePlayback(state);
    const frozenAt = viewAtOf(paused); // ANCHOR - 8_000
    const resumed = resumePlayback(paused);
    expect(resumed.playback?.paused).toBe(false);
    expect(viewAtOf(resumed)).toBe(frozenAt); // still the frozen instant at the resume boundary
    const stepped = tickPlayback(resumed);
    expect(viewAtOf(stepped)).toBe(frozenAt + 1_000); // continues from the frozen instant
    expect(resumePlayback(resumed)).toEqual(resumed); // idempotent
  });

  it('pause/resume with playback not armed are typed input errors', () => {
    expect(() => pausePlayback(liveTimeMachine(ANCHOR))).toThrow(/not armed/);
    expect(() => resumePlayback(liveTimeMachine(ANCHOR))).toThrow(/not armed/);
    expect(() => pausePlayback(setTMinus(liveTimeMachine(ANCHOR), 5))).toThrow(/not armed/);
  });

  it('a fresh arm is never paused (startPlayback resets the control to playing)', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 1_000);
    state = pausePlayback(state);
    const reArmed = startPlayback(state, ANCHOR - 4_000, 500);
    expect(reArmed.playback?.paused).toBe(false);
    expect(viewAtOf(reArmed)).toBe(ANCHOR - 4_000);
    expect(tickPlayback(reArmed).playback?.ticks).toBe(1); // an armed (unpaused) machine ticks
  });

  it('the frozen progress renders while paused (the % readout holds its position)', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 2_500);
    state = tickPlayback(state);
    const paused = pausePlayback(state);
    expect(playbackProgressOf(paused)).toBe(0.25);
  });
});

describe('timemachine: THE MANUAL STEPPING LAW (MI-D9 — Step back / Step while paused)', () => {
  // The defect (6/9 professionals, MI wave 1): "Step back" while PAUSED
  // jumped FORWARD to the wall-clock end, flipped the mode
  // playback -> t-minus, and left the banner reading "Viewing a past
  // instant" at 100% (M2 paused at 02:35:53.575Z -> jumped to the
  // 02:41:42.529Z end; L4, M1, S2, S5 reproduced variants). Root cause:
  // the app layer wired the control to view-tminus with tMinusMs + 500 —
  // in a session that never armed T-x that offset is 500ms before the
  // ANCHOR, which follows the observed now: the end-jump. The fix is
  // this machine's own law: Step back steps the view instant BACK one
  // controlled step and STAYS paused, in the playback mode; Step
  // forward is the user's own step (the freeze stops the beat's ticks,
  // never the user's steps).

  it('Step back while PAUSED steps the view BACK one step and STAYS paused, in the playback mode (no mode flip, no end-jump)', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 1_000);
    state = tickPlayback(state);
    state = tickPlayback(state);
    state = tickPlayback(state); // viewAt = ANCHOR - 7_000
    const paused = pausePlayback(state);
    const steppedBack = stepBackPlayback(paused);
    expect(steppedBack.mode).toBe('playback');            // STILL the playback mode (was flipping to t-minus)
    expect(steppedBack.playback?.paused).toBe(true);      // STILL paused
    expect(steppedBack.playback?.ticks).toBe(2);          // one controlled step back
    expect(viewAtOf(steppedBack)).toBe(ANCHOR - 8_000);   // the view moved BACK, toward the past (was jumping to anchor-500ms)
    expect(playbackProgressOf(steppedBack)).toBeLessThan(1); // the % follows the stepped-back view (was stuck at 100%)
  });

  it('Step back floors at the arm instant (ticks 0 — the view never passes the playback\'s own start) and is idempotent there', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 1_000);
    state = tickPlayback(state); // ticks 1
    const paused = pausePlayback(state);
    const once = stepBackPlayback(paused);
    expect(once.playback?.ticks).toBe(0);
    expect(viewAtOf(once)).toBe(ANCHOR - 10_000); // the arm instant
    const twice = stepBackPlayback(once);
    expect(twice).toEqual(once);                  // the floor no-ops, never before the arm
    expect(viewAtOf(twice)).toBe(ANCHOR - 10_000);
  });

  it('Step back works while PLAYING too (a manual nudge back — the step never passes the future, so no guard is needed)', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 1_000);
    state = tickPlayback(state);
    state = tickPlayback(state);
    const steppedBack = stepBackPlayback(state);
    expect(steppedBack.playback?.paused).toBe(false);     // still playing
    expect(steppedBack.playback?.ticks).toBe(1);
    expect(viewAtOf(steppedBack)).toBe(ANCHOR - 9_000);
  });

  it('Step FORWARD while paused is the user\'s own step: one controlled step forward, STAYING paused (the freeze stops the beat\'s ticks, never the Step control)', () => {
    let state = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, 1_000);
    state = tickPlayback(state);
    const paused = pausePlayback(state);
    const steppedForward = stepForwardPlayback(paused);
    expect(steppedForward.mode).toBe('playback');
    expect(steppedForward.playback?.paused).toBe(true);   // still paused — a manual step is not a resume
    expect(steppedForward.playback?.ticks).toBe(2);
    expect(viewAtOf(steppedForward)).toBe(ANCHOR - 8_000);
    // a manual step past the anchor is refused exactly like an auto tick
    let atTheEnd = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 1_000, 1_000);
    atTheEnd = tickPlayback(atTheEnd); // viewAt = ANCHOR, the boundary
    const pausedAtTheEnd = pausePlayback(atTheEnd);
    expect(() => stepForwardPlayback(pausedAtTheEnd)).toThrow(/after the anchor/);
  });

  it('stepping with playback not armed is a typed input error (the same law as tick/pause/resume)', () => {
    expect(() => stepBackPlayback(liveTimeMachine(ANCHOR))).toThrow(/not armed/);
    expect(() => stepForwardPlayback(liveTimeMachine(ANCHOR))).toThrow(/not armed/);
    expect(() => stepBackPlayback(setTMinus(liveTimeMachine(ANCHOR), 5))).toThrow(/not armed/);
    expect(() => stepForwardPlayback(setTimestamp(liveTimeMachine(ANCHOR), ANCHOR - 5))).toThrow(/not armed/);
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

// ---------------------------------------------------------------------------
// FW-33-B (Round B blocker 5) — THE DISCLOSED PLAYBACK SPEEDS + THE RETUNE.
// ---------------------------------------------------------------------------

describe('FW-33-B: the disclosed playback speeds', () => {
  it('the closed set: 1x is the pre-FW-33-B knowable-then step; 10x/100x step 5s/50s per beat', () => {
    expect(PLAYBACK_SPEED_KEYS).toEqual(['1x', '10x', '100x']);
    expect(playbackStepMsOf('1x')).toBe(TIME_MACHINE_STEP_MS);
    expect(playbackStepMsOf('10x')).toBe(5_000);
    expect(playbackStepMsOf('100x')).toBe(50_000);
    expect(isPlaybackSpeedKey('10x')).toBe(true);
    expect(isPlaybackSpeedKey('1000x')).toBe(false); // a speed outside the disclosed set is never accepted
    expect(isPlaybackSpeedKey(10)).toBe(false);
  });

  it('retunePlayback re-arms the ARMED playback at its CURRENT view instant with the new step — no view jump, paused preserved', () => {
    let machine = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, TIME_MACHINE_STEP_MS);
    machine = tickPlayback(machine);
    machine = tickPlayback(machine);
    const viewBefore = viewAtOf(machine); // ANCHOR - 9000
    const retuned = retunePlayback(machine, 5_000);
    expect(viewAtOf(retuned)).toBe(viewBefore); // the view does not move
    expect(retuned.playback?.stepMs).toBe(5_000);
    expect(retuned.playback?.fromAt).toBe(viewBefore); // re-armed AT the current view
    expect(retuned.playback?.ticks).toBe(0);
    expect(retuned.playback?.paused).toBe(false);
    // the next tick advances by the NEW step
    expect(viewAtOf(tickPlayback(retuned))).toBe(viewBefore + 5_000);
  });

  it("retunePlayback preserves a PAUSED playback's freeze (only the next tick's step changes)", () => {
    // armed 60s back so the 100x step's first resumed leap (50s) stays
    // inside the anchor — the pure machine's own typed law (the test
    // below) is never excused by the retune
    let machine = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 60_000, TIME_MACHINE_STEP_MS);
    machine = tickPlayback(machine);
    machine = pausePlayback(machine);
    const frozenAt = viewAtOf(machine);
    const retuned = retunePlayback(machine, 50_000);
    expect(retuned.playback?.paused).toBe(true); // still frozen
    expect(viewAtOf(retuned)).toBe(frozenAt);
    expect(tickPlayback(retuned)).toBe(retuned); // the freeze law holds under the new step too
    // resume steps forward by the NEW step from exactly the frozen instant
    const resumed = resumePlayback(retuned);
    expect(viewAtOf(tickPlayback(resumed))).toBe(frozenAt + 50_000);
  });

  it("retunePlayback is the siblings' own typed error when playback is not armed (never a silent no-op)", () => {
    const live = liveTimeMachine(ANCHOR);
    expect(() => retunePlayback(live, 5_000)).toThrow(/playback not armed/);
    const badStep = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 100, TIME_MACHINE_STEP_MS);
    expect(() => retunePlayback(badStep, -1)).toThrow(/non-negative integer of milliseconds/);
  });

  it('the retune never breaks the anchor law (the view was already legal; the ceiling still holds)', () => {
    let machine = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 10_000, TIME_MACHINE_STEP_MS);
    machine = tickPlayback(machine);
    machine = retunePlayback(machine, 50_000);
    // a tick beyond the anchor stays the machine's own typed error — speed never licenses the future
    let current = machine;
    for (let tick = 0; tick < 300; tick += 1) {
      const nextView = current.playback === null ? null : current.playback.fromAt + (current.playback.ticks + 1) * current.playback.stepMs;
      if (nextView === null || nextView > current.anchorAt) break;
      current = tickPlayback(current);
    }
    expect(viewAtOf(current)).toBeLessThanOrEqual(current.anchorAt);
    expect(() => {
      let hot = current;
      while (hot.playback !== null && hot.playback.fromAt + (hot.playback.ticks + 1) * hot.playback.stepMs <= hot.anchorAt) hot = tickPlayback(hot);
      tickPlayback(hot); // the one step past the anchor — the typed law
    }).toThrow(/never the future/);
  });

  it('stopPlaybackAtAnchor — the seam\'s clamp: a tick whose step would pass the anchor LANDS AT it and stops (paused, the disclosed step preserved) — the workspace event layer\'s graceful form of the same law', () => {
    // armed 6s back with a 5s step: the first step lands 1s before
    // "now"; the NEXT 5s step would pass it — the one the seam clamps
    let machine = startPlayback(liveTimeMachine(ANCHOR), ANCHOR - 6_000, 5_000);
    machine = tickPlayback(machine);
    expect(viewAtOf(machine)).toBe(ANCHOR - 1_000);         // the first step: a full 5s leap, 1s before "now"
    const clamped = stopPlaybackAtAnchor(machine);
    expect(viewAtOf(clamped)).toBe(ANCHOR);                 // landed AT "now" — the final partial step (1s), never past it
    expect(clamped.playback?.fromAt).toBe(ANCHOR);          // re-armed at "now"
    expect(clamped.playback?.ticks).toBe(0);
    expect(clamped.playback?.stepMs).toBe(5_000);           // the disclosed step survives the clamp
    expect(clamped.playback?.paused).toBe(true);            // stopped there, as a pause would
    expect(playbackProgressOf(clamped)).toBe(1);            // the progress readout: caught up (100%)
    // a resumed playback at "now" clamps again on its next tick — the view never moves past the anchor, whatever the speed
    const resumed = resumePlayback(clamped);
    const reclamped = stopPlaybackAtAnchor(resumed);
    expect(viewAtOf(reclamped)).toBe(ANCHOR);
    expect(reclamped.playback?.paused).toBe(true);
    // the PURE tick keeps its typed law — the clamp is the seam's form of it, never the machine's
    expect(() => tickPlayback(resumed)).toThrow(/never the future/);
    // a disarmed machine is the siblings' own typed error, never a silent no-op
    expect(() => stopPlaybackAtAnchor(liveTimeMachine(ANCHOR))).toThrow(/playback not armed/);
  });
});

// ---------------------------------------------------------------------------
// FW-34-B (Round C register §3.2 — the closed-set residual): THE FREE SPEED
// INPUT's own grammar. The disclosed set (1x/10x/100x) stays; the free input
// accepts any POSITIVE multiple of the 1x step between the honest bounds
// (0.5x … 10000x) and REFUSES everything else with the reason named — never
// a silent clamp.
// ---------------------------------------------------------------------------

describe('FW-34-B: the free speed input grammar (parsePlaybackCustomSpeed)', () => {
  it('valid multiples map to exact integer step milliseconds (the multiplier x the 1x step)', () => {
    expect(parsePlaybackCustomSpeed('2')).toEqual({ ok: true, multiplier: 2, stepMs: 2 * TIME_MACHINE_STEP_MS });
    expect(parsePlaybackCustomSpeed('10')).toEqual({ ok: true, multiplier: 10, stepMs: 10 * TIME_MACHINE_STEP_MS });
    expect(parsePlaybackCustomSpeed(' 0.5 ')).toEqual({ ok: true, multiplier: 0.5, stepMs: Math.round(0.5 * TIME_MACHINE_STEP_MS) });
    expect(parsePlaybackCustomSpeed('12.5')).toEqual({ ok: true, multiplier: 12.5, stepMs: Math.round(12.5 * TIME_MACHINE_STEP_MS) });
    expect(parsePlaybackCustomSpeed('1')).toEqual({ ok: true, multiplier: 1, stepMs: TIME_MACHINE_STEP_MS }); // the 1x step itself
  });

  it('the honest bounds are inclusive: 0.5x is the floor, 10000x is the ceiling', () => {
    expect(parsePlaybackCustomSpeed('0.5')).toEqual({ ok: true, multiplier: 0.5, stepMs: Math.round(0.5 * TIME_MACHINE_STEP_MS) });
    expect(parsePlaybackCustomSpeed(String(PLAYBACK_CUSTOM_SPEED_MIN))).toEqual({ ok: true, multiplier: PLAYBACK_CUSTOM_SPEED_MIN, stepMs: Math.round(PLAYBACK_CUSTOM_SPEED_MIN * TIME_MACHINE_STEP_MS) });
    expect(parsePlaybackCustomSpeed(String(PLAYBACK_CUSTOM_SPEED_MAX))).toEqual({ ok: true, multiplier: PLAYBACK_CUSTOM_SPEED_MAX, stepMs: PLAYBACK_CUSTOM_SPEED_MAX * TIME_MACHINE_STEP_MS });
  });

  it('refusals NAME their reason — never a silent clamp (empty, non-numbers, zero/negative, out of bounds)', () => {
    const empty = parsePlaybackCustomSpeed('');
    expect(empty.ok).toBe(false);
    if (empty.ok === false) expect(empty.reason).toContain('multiple of the 1x step');
    const notANumber = parsePlaybackCustomSpeed('fast');
    expect(notANumber.ok).toBe(false);
    if (notANumber.ok === false) expect(notANumber.reason).toContain('is not a number');
    const nan = parsePlaybackCustomSpeed('NaN');
    expect(nan.ok).toBe(false);
    const zero = parsePlaybackCustomSpeed('0');
    expect(zero.ok).toBe(false);
    if (zero.ok === false) expect(zero.reason).toContain('positive');
    const negative = parsePlaybackCustomSpeed('-2');
    expect(negative.ok).toBe(false);
    const tooSlow = parsePlaybackCustomSpeed('0.25');
    expect(tooSlow.ok).toBe(false);
    if (tooSlow.ok === false) expect(tooSlow.reason).toContain(`slowest free speed is ${PLAYBACK_CUSTOM_SPEED_MIN}x`);
    const tooFast = parsePlaybackCustomSpeed('20000');
    expect(tooFast.ok).toBe(false);
    if (tooFast.ok === false) expect(tooFast.reason).toContain(`fastest free speed is ${PLAYBACK_CUSTOM_SPEED_MAX}x`);
    const infinity = parsePlaybackCustomSpeed('Infinity');
    expect(infinity.ok).toBe(false);
  });
});
