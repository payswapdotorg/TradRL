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
// Spec anchors: R7 (first-class Time Machine), L4, UX.md "Support
// T-x, explicit timestamp and controlled playback. Visible
// information must respect simulated availability."

/** The four Time Machine modes (UX.md's three controls + the live default). */
export type TimeMachineMode = 'live' | 't-minus' | 'timestamp' | 'playback';

/** The playback control state. */
export interface PlaybackState {
  /** The instant playback started from. */
  readonly fromAt: number;
  /** The controlled step (ms per tick). */
  readonly stepMs: number;
  /** The number of elapsed ticks. */
  readonly ticks: number;
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
  switch (state.mode) {
    case 'live':
      return state.anchorAt;
    case 't-minus':
      return state.anchorAt - state.tMinusMs;
    case 'timestamp':
      return state.timestamp;
    case 'playback':
      return state.playback === null ? state.anchorAt : state.playback.fromAt + state.playback.ticks * state.playback.stepMs;
  }
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

/** Transition: arm controlled playback at an anchor with a step. */
export function startPlayback(state: TimeMachineState, fromAt: number, stepMs: number): TimeMachineState {
  requireNonNegativeMs(stepMs, 'the playback step');
  if (!Number.isFinite(fromAt) || !Number.isInteger(fromAt)) {
    throw new Error('time machine: the playback start instant must be an integer of epoch milliseconds');
  }
  const next: TimeMachineState = { ...state, mode: 'playback', playback: { fromAt, stepMs, ticks: 0 } };
  requireNotAfterAnchor(viewAtOf(next), next.anchorAt);
  return next;
}

/** Transition: one controlled playback tick (the app schedules these — injected, deterministic in tests). */
export function tickPlayback(state: TimeMachineState): TimeMachineState {
  if (state.mode !== 'playback' || state.playback === null) {
    throw new Error('time machine: a playback tick with playback not armed is a typed input error');
  }
  const next: TimeMachineState = { ...state, playback: { ...state.playback, ticks: state.playback.ticks + 1 } };
  requireNotAfterAnchor(viewAtOf(next), next.anchorAt);
  return next;
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
