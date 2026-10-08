// @tradrl/web-console — the Time Machine (UX.md + R7).
//
// THE LAW (Work Order T042): "Time Machine controls (UX.md): T-x,
// explicit timestamp and controlled playback; every visible datum
// passes an availability projection (L4 at the interface...)". This
// module is the PURE view-time state machine: four modes (live,
// t-minus, timestamp, playback), every transition pure and
// total, every view instant derived from an ANCHOR that arrives
// from the app's injected instant source (never the wall clock).
//
// Playback is controlled: `startPlayback` arms it at an anchor with
// a step; `tickPlayback` advances it (the app schedules ticks —
// injected, deterministic in tests); the projection consumes
// `viewAt` from wherever the mode points. A view instant may never
// point after the anchor (you cannot inspect the future); a past
// view hides post-availability facts (core/availability.ts).
//
// THE PAUSE (R10, W-25C): the same control that arms playback pauses
// it. Pause FREEZES the view instant — a tick arriving while paused
// advances NOTHING (the freeze is this machine's own law, so every
// scheduler inherits it), the anchor never regresses, and resume
// continues from exactly the frozen instant (fromAt/ticks are
// untouched; the next tick steps from where the view stopped).
//
// Spec anchors: R7 (first-class Time Machine), L4, UX.md "Support
// T-x, explicit timestamp and controlled playback. Visible
// information must respect simulated availability."

/** The four Time Machine modes (UX.md's three controls + the live default). */
export type TimeMachineMode = 'live' | 't-minus' | 'timestamp' | 'playback';

/**
 * FW-32-B (Round A blocker 4) — THE DISCLOSED STEP GRANULARITY: the
 * one controlled step the Step / Step back controls move the SELECTED
 * view instant by (inside AND outside playback), and the step a fresh
 * playback arm ticks at. Disclosed in the controls' own titles (the
 * D-18 law: the meaning exists before the click) — the pre-fix Step
 * back outside playback nudged a t-minus OFFSET, which re-anchored
 * toward now as the live anchor advanced and moved the selected
 * instant FORWARD (M5's finding: 04:25:04 -> 04:28:58 -> 04:29:05 —
 * the incident instant lost). One constant, one meaning, stated.
 */
export const TIME_MACHINE_STEP_MS = 500;

/** The playback control state. */
export interface PlaybackState {
  /** The instant playback started from. */
  readonly fromAt: number;
  /** The controlled step (ms per tick). */
  readonly stepMs: number;
  /** The number of elapsed ticks. */
  readonly ticks: number;
  /** True while PAUSED: the view instant is frozen (ticks stop advancing it) until resume (R10). */
  readonly paused: boolean;
}

/**
 * FW-33-B (Round B blocker 5, ~5 personas) — THE DISCLOSED PLAYBACK
 * SPEEDS: the one controlled step a playback tick advances the view
 * instant by, per scheduler beat (~1s). 1x is the pre-FW-33-B step
 * (TIME_MACHINE_STEP_MS — 500ms/beat, the knowable-then granularity
 * the Step controls disclose); 10x and 100x step 5s and 50s per beat
 * so a multi-year history is traversable in a session. The speed NEVER
 * changes what playback IS: each tick still renders only what was
 * knowable then (L4) and never passes the anchor (the machine's own
 * typed law) — the caption in the render says exactly that.
 */
export type PlaybackSpeedKey = '1x' | '10x' | '100x';

/** The speed key -> step-per-tick mapping (one closed set, disclosed in the control). */
export const PLAYBACK_SPEED_STEPS: Readonly<Record<PlaybackSpeedKey, number>> = Object.freeze({
  '1x': TIME_MACHINE_STEP_MS,
  '10x': 5_000,
  '100x': 50_000,
});

/** The speed keys in render order (the select's own order). */
export const PLAYBACK_SPEED_KEYS: readonly PlaybackSpeedKey[] = ['1x', '10x', '100x'];

/** The step of one speed key (the closed set's own lookup — never a fabricated step). */
export function playbackStepMsOf(speed: PlaybackSpeedKey): number {
  return PLAYBACK_SPEED_STEPS[speed];
}

/** True when a string is one of the disclosed speed keys (the change-handler's guard). */
export function isPlaybackSpeedKey(value: unknown): value is PlaybackSpeedKey {
  return typeof value === 'string' && (PLAYBACK_SPEED_KEYS as readonly string[]).includes(value);
}

/**
 * FW-34-B (Round C register §3.2 — the closed-set residual, L3/L1/M5/S5):
 * THE FREE SPEED INPUT's own validated grammar. The disclosed set stays
 * (1x/10x/100x — one select, the honest caption beside it); the FREE input
 * accepts any POSITIVE multiple of the 1x step (0.5x … 10000x), so an
 * analyst can traverse an incident at exactly the rate their review needs
 * (L3: "the speed set is CLOSED (no 0.5x/2x/custom)"). The multiplier maps
 * to the same per-beat advance every speed key maps to —
 * `multiplier × TIME_MACHINE_STEP_MS` ms per scheduler beat — and the
 * bounds are the input's own honest law: a multiple below 0.5x or above
 * 10000x (or a non-number, an empty string, an infinity, a NaN) is
 * REFUSED with the reason named (never clamped silently — a speed the
 * user did not type is a speed the caption must not claim).
 */
export const PLAYBACK_CUSTOM_SPEED_MIN = 0.5;

/** The free speed's upper bound (10000x = 5,000,000ms per beat — an honest ceiling, refused beyond). */
export const PLAYBACK_CUSTOM_SPEED_MAX = 10_000;

/** The parsed outcome of one free-speed input: either the validated step or the named refusal. */
export type PlaybackCustomSpeed = { readonly ok: true; readonly multiplier: number; readonly stepMs: number } | { readonly ok: false; readonly reason: string };

/**
 * Parse the free speed input's committed text (the change/Enter commit).
 * The grammar: a positive decimal multiple of the 1x step, e.g. "2" or
 * "0.5" or "12.5". The step is ALWAYS an integer of milliseconds (the
 * machine's own law — startPlayback/retunePlayback refuse a fractional
 * step), so a multiplier whose step rounds to 0 is refused (0.5x = 250ms
 * is the floor by construction).
 */
export function parsePlaybackCustomSpeed(text: string): PlaybackCustomSpeed {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'enter a speed as a multiple of the 1x step, e.g. 2 or 0.5' };
  const multiplier = Number(trimmed);
  if (!Number.isFinite(multiplier)) return { ok: false, reason: `"${trimmed}" is not a number — enter a speed as a multiple of the 1x step, e.g. 2 or 0.5` };
  if (multiplier <= 0) return { ok: false, reason: 'the speed must be a positive multiple of the 1x step' };
  if (multiplier < PLAYBACK_CUSTOM_SPEED_MIN) return { ok: false, reason: `the slowest free speed is ${PLAYBACK_CUSTOM_SPEED_MIN}x (${PLAYBACK_CUSTOM_SPEED_MIN * TIME_MACHINE_STEP_MS}ms per beat)` };
  if (multiplier > PLAYBACK_CUSTOM_SPEED_MAX) return { ok: false, reason: `the fastest free speed is ${PLAYBACK_CUSTOM_SPEED_MAX}x (${PLAYBACK_CUSTOM_SPEED_MAX * TIME_MACHINE_STEP_MS}ms per beat)` };
  const stepMs = Math.round(multiplier * TIME_MACHINE_STEP_MS);
  if (stepMs < 1) return { ok: false, reason: `the slowest free speed is ${PLAYBACK_CUSTOM_SPEED_MIN}x (${PLAYBACK_CUSTOM_SPEED_MIN * TIME_MACHINE_STEP_MS}ms per beat)` };
  return { ok: true, multiplier, stepMs };
}

/** The Time Machine state (pure — transitions below). */
export interface TimeMachineState {
  readonly mode: TimeMachineMode;
  /** The injected anchor (the live instant the app last observed — never a wall-clock read). */
  readonly anchorAt: number;
  /** The T-x offset (t-minus mode). */
  readonly tMinusMs: number;
  /** The explicit view timestamp (timestamp mode). */
  readonly timestamp: number;
  /** The playback control state (playback mode). */
  readonly playback: PlaybackState | null;
}

/** The initial state: live at the anchor. */
export function liveTimeMachine(anchorAt: number): TimeMachineState {
  return { mode: 'live', anchorAt, tMinusMs: 0, timestamp: anchorAt, playback: null };
}

/** The projected view instant of a state (the instant the availability projection consumes). */
export function viewAtOf(state: TimeMachineState): number {
  // if/else over the mode union (the erasable-subset law: no switch/case).
  if (state.mode === 'live') return state.anchorAt;
  if (state.mode === 't-minus') return state.anchorAt - state.tMinusMs;
  if (state.mode === 'timestamp') return state.timestamp;
  if (state.playback === null) return state.anchorAt;
  return state.playback.fromAt + state.playback.ticks * state.playback.stepMs;
}

/** Guard: a non-negative millisecond offset. */
function requireNonNegativeMs(value: number, what: string): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`time machine: ${what} must be a non-negative integer of milliseconds`);
  }
}

/** A view instant may never point after the anchor (you cannot inspect the future). */
function requireNotAfterAnchor(viewAt: number, anchorAt: number): void {
  if (viewAt > anchorAt) {
    throw new Error(`time machine: the view instant ${viewAt} is after the anchor ${anchorAt} — the Time Machine inspects the past, never the future`);
  }
}

/** Transition: follow the live anchor (the app observes a fresh injected instant). */
export function advanceAnchor(state: TimeMachineState, anchorAt: number): TimeMachineState {
  if (state.mode === 'live') return { ...state, anchorAt };
  return { ...state, anchorAt };
}

/** Transition: T-x — view the world x milliseconds before the anchor. */
export function setTMinus(state: TimeMachineState, tMinusMs: number): TimeMachineState {
  requireNonNegativeMs(tMinusMs, 'the T-x offset');
  const next: TimeMachineState = { ...state, mode: 't-minus', tMinusMs };
  requireNotAfterAnchor(viewAtOf(next), next.anchorAt);
  return next;
}

/** Transition: an explicit timestamp — view the world at exactly that instant. */
export function setTimestamp(state: TimeMachineState, timestamp: number): TimeMachineState {
  if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp)) {
    throw new Error('time machine: the view timestamp must be an integer of epoch milliseconds');
  }
  const next: TimeMachineState = { ...state, mode: 'timestamp', timestamp };
  requireNotAfterAnchor(viewAtOf(next), next.anchorAt);
  return next;
}

/** Transition: arm controlled playback at an anchor with a step (never paused — a fresh arm is playing). */
export function startPlayback(state: TimeMachineState, fromAt: number, stepMs: number): TimeMachineState {
  requireNonNegativeMs(stepMs, 'the playback step');
  if (!Number.isFinite(fromAt) || !Number.isInteger(fromAt)) {
    throw new Error('time machine: the playback start instant must be an integer of epoch milliseconds');
  }
  const next: TimeMachineState = { ...state, mode: 'playback', playback: { fromAt, stepMs, ticks: 0, paused: false } };
  requireNotAfterAnchor(viewAtOf(next), next.anchorAt);
  return next;
}

/**
 * Transition: ONE controlled playback tick (the app schedules these
 * — injected, deterministic in tests). THE PAUSE FREEZE (R10): a tick
 * arriving while paused advances NOTHING — the view instant stays at
 * `fromAt + ticks * stepMs` until resume. (The app's beat also stops
 * dispatching ticks while paused so the history chain carries no
 * no-op entries; the freeze itself lives HERE so every caller
 * inherits it.)
 */
export function tickPlayback(state: TimeMachineState): TimeMachineState {
  if (state.mode !== 'playback' || state.playback === null) {
    throw new Error('time machine: a playback tick with playback not armed is a typed input error');
  }
  if (state.playback.paused) return state; // frozen — the tick stops advancing the view
  const next: TimeMachineState = { ...state, playback: { ...state.playback, ticks: state.playback.ticks + 1 } };
  requireNotAfterAnchor(viewAtOf(next), next.anchorAt);
  return next;
}

/** Transition: pause — FREEZE the view instant (no jump-back: fromAt/ticks untouched; the anchor never regresses). Idempotent. */
export function pausePlayback(state: TimeMachineState): TimeMachineState {
  if (state.mode !== 'playback' || state.playback === null) {
    throw new Error('time machine: pausing with playback not armed is a typed input error');
  }
  if (state.playback.paused) return state;
  return { ...state, playback: { ...state.playback, paused: true } };
}

/** Transition: resume — continue from the frozen instant (the next tick steps from exactly where pause left the view). Idempotent. */
export function resumePlayback(state: TimeMachineState): TimeMachineState {
  if (state.mode !== 'playback' || state.playback === null) {
    throw new Error('time machine: resuming with playback not armed is a typed input error');
  }
  if (!state.playback.paused) return state;
  return { ...state, playback: { ...state.playback, paused: false } };
}

/**
 * Transition: ONE MANUAL STEP BACK (MI-D9 — the manual stepping law):
 * ticks - 1, floored at the arm instant (ticks 0 — the view never
 * passes the playback's own start; earlier instants belong to a fresh
 * arm). The paused flag is UNTOUCHED — a paused playback steps back and
 * STAYS paused (the freeze stops the beat's AUTO ticks, never the
 * user's own steps) — and the mode is untouched too: Step back is a
 * PLAYBACK control, never a mode flip. (The pre-MI-D9 app wiring sent
 * this control to view-tminus with tMinusMs + 500, which in a paused
 * session jumped the view FORWARD to the wall-clock end and flipped
 * the mode — 6/9 professionals' finding.) The view only moves BACK,
 * so the never-after-the-anchor law cannot be violated.
 */
export function stepBackPlayback(state: TimeMachineState): TimeMachineState {
  if (state.mode !== 'playback' || state.playback === null) {
    throw new Error('time machine: stepping back with playback not armed is a typed input error');
  }
  if (state.playback.ticks === 0) return state; // the floor: at the arm instant, stepping back no-ops
  return { ...state, playback: { ...state.playback, ticks: state.playback.ticks - 1 } };
}

/**
 * Transition: ONE MANUAL STEP FORWARD (MI-D9): ticks + 1 EVEN WHILE
 * PAUSED — the user's own Step is not an auto tick (the freeze law
 * above stops the beat's scheduled ticks, never the Step control), and
 * a manual step never resumes playback (paused stays paused). A step
 * that would pass the anchor is the same typed input error an auto
 * tick raises — the app layer guards the click path the way it guards
 * the beat.
 */
export function stepForwardPlayback(state: TimeMachineState): TimeMachineState {
  if (state.mode !== 'playback' || state.playback === null) {
    throw new Error('time machine: stepping forward with playback not armed is a typed input error');
  }
  const next: TimeMachineState = { ...state, playback: { ...state.playback, ticks: state.playback.ticks + 1 } };
  requireNotAfterAnchor(viewAtOf(next), next.anchorAt);
  return next;
}

/**
 * Transition: FW-33-B (Round B blocker 5) — RETUNE the ARMED playback's
 * speed (the disclosed select's committed change). The playback
 * RE-ARMS AT THE CURRENT VIEW INSTANT with the new step: the view does
 * not jump (fromAt = the view this instant, ticks = 0) and the paused
 * flag is PRESERVED (a paused playback stays paused — the freeze law;
 * only the next tick's step changes). The anchor law holds by
 * construction (the view instant was already legal). Playback not
 * armed is the same typed input error the sibling controls raise —
 * the speed of a DISARMED machine is the app layer's next-arm choice,
 * never a machine transition.
 */
export function retunePlayback(state: TimeMachineState, stepMs: number): TimeMachineState {
  requireNonNegativeMs(stepMs, 'the playback step');
  if (state.mode !== 'playback' || state.playback === null) {
    throw new Error('time machine: retuning the speed with playback not armed is a typed input error');
  }
  return { ...state, playback: { fromAt: viewAtOf(state), stepMs, ticks: 0, paused: state.playback.paused } };
}

/**
 * Transition: FW-33-B (Round B blocker 5) — THE ANCHOR CLAMP for a tick
 * whose step would PASS the anchor (the workspace seam's own guard —
 * see reduceWorkspace's playback-tick). Playback LANDS AT the anchor:
 * a final partial step (never a jump past "now", never the pure tick's
 * typed future-inspection error) that re-arms the view AT "now" with
 * ticks 0, and then STOPS — paused, exactly as if the user had paused
 * there: playback has caught up with the present. The disclosed step
 * is PRESERVED (a resumed playback at "now" clamps again on its next
 * tick — the view never moves past the anchor, whatever the speed).
 * The pure tickPlayback KEEPS its typed law (a direct machine tick
 * past the anchor is still the future-inspection error); this
 * transition is the seam's graceful total form of the same law.
 */
export function stopPlaybackAtAnchor(state: TimeMachineState): TimeMachineState {
  if (state.mode !== 'playback' || state.playback === null) {
    throw new Error('time machine: stopping at the anchor with playback not armed is a typed input error');
  }
  return { ...state, playback: { fromAt: state.anchorAt, stepMs: state.playback.stepMs, ticks: 0, paused: true } };
}

/** Transition: return to the live view. */
export function backToLive(state: TimeMachineState): TimeMachineState {
  return { ...state, mode: 'live', playback: null };
}

/** The playback progress as a fraction [0,1] of the anchor (rendered progress; pure). */
export function playbackProgressOf(state: TimeMachineState): number | null {
  if (state.playback === null) return null;
  const span = state.anchorAt - state.playback.fromAt;
  if (state.playback.stepMs <= 0 || span <= 0) return 1;
  const reached = viewAtOf(state) - state.playback.fromAt;
  return Math.min(1, reached / span);
}
