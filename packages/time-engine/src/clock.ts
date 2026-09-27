/**
 * @tradrl/time-engine — the SimulationClock value object.
 *
 * The clock is an IMMUTABLE value: every transition returns a new clock and
 * this package contains no wall-clock coupling (no `Date.now()`), so runs are
 * reproducible. Runtime services drive progression; contract code only
 * validates and transforms.
 *
 * Invariants (enforced on construction, on every transition, and by the
 * runtime guard `isSimulationClock`):
 *   1. `now <= asOf` — a simulation may never run past its information
 *      anchor. `asOf` is the historical instant the run claims to reconstruct
 *      ("the world as of T"); `now` is the current simulated instant.
 *   2. `now` is monotonic within a run — transitions may only move it
 *      forward (`advanceClockTo` rejects regressions).
 *   3. `playbackSpeed` is a positive finite multiplier (1 = real time).
 *
 * Fidelity modes (ARCHITECTURE-LOCK L5 — these are DISTINCT, never aliased):
 *   - `exact_replay`: deterministic replay of historical events only.
 *   - `reactive_replay`: historical events plus endogenous simulated
 *     participants reacting to them.
 *   - `generative`: counterfactual/synthetic worlds — exploration
 *     instruments, never historical truth.
 */

import { isDuration, durationToMs, type Duration } from './duration';
import { fail, ok, type TimeResult } from './errors';
import { isTimestampMs, timestampMs, MAX_TIMESTAMP_MS, type TimestampMs } from './timestamp';

/** The three distinct world-fidelity modes (L5). */
export type FidelityMode = 'exact_replay' | 'reactive_replay' | 'generative';

/** Runtime-checkable list of fidelity modes, for guards and diagnostics. */
export const FIDELITY_MODES: readonly FidelityMode[] = ['exact_replay', 'reactive_replay', 'generative'];

/**
 * The information policy governing what the clock's `now` admits.
 * `point-in-time`: an observation is visible iff `available_time <= now`
 * (inclusive). There is deliberately a single policy today — the boundary is
 * the law (L4), not a dial — but the field makes the policy explicit and
 * auditable on every clock and leaves room for named variants should the
 * architecture ever ratify one.
 */
export type InformationPolicy = 'point-in-time';

/** The SimulationClock value object (spec/DOMAIN-MODEL.md: "SimulationClock"). */
export interface SimulationClock {
  /** Current simulated instant. Monotonic within a run; never past `asOf`. */
  readonly now: TimestampMs;
  /** Historical anchor: the latest instant this run's information set covers. */
  readonly asOf: TimestampMs;
  /** Positive finite playback-speed multiplier. 1 = real time. */
  readonly playbackSpeed: number;
  /** Whether automatic progression is suspended. Explicit transitions still work. */
  readonly paused: boolean;
  /** World fidelity mode — one of the three distinct L5 modes. */
  readonly fidelity: FidelityMode;
  /** Information policy in force (see {@link InformationPolicy}). */
  readonly informationPolicy: InformationPolicy;
}

/** Construction spec for {@link createSimulationClock}. */
export interface SimulationClockSpec {
  readonly asOf: TimestampMs;
  /** Defaults to `asOf` (the clock starts standing at its anchor). */
  readonly now?: TimestampMs;
  /** Defaults to 1. */
  readonly playbackSpeed?: number;
  /** Defaults to false. */
  readonly paused?: boolean;
  readonly fidelity: FidelityMode;
}

/** Runtime type guard for a fidelity mode. */
export function isFidelityMode(value: unknown): value is FidelityMode {
  return typeof value === 'string' && (FIDELITY_MODES as readonly string[]).includes(value);
}

/** Runtime type guard for a structurally valid and invariant-abiding clock. */
export function isSimulationClock(value: unknown): value is SimulationClock {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isTimestampMs(candidate.now) || !isTimestampMs(candidate.asOf)) return false;
  if ((candidate.now as number) > (candidate.asOf as number)) return false;
  if (typeof candidate.playbackSpeed !== 'number' || !Number.isFinite(candidate.playbackSpeed) || candidate.playbackSpeed <= 0)
    return false;
  if (typeof candidate.paused !== 'boolean') return false;
  if (!isFidelityMode(candidate.fidelity)) return false;
  if (candidate.informationPolicy !== 'point-in-time') return false;
  return true;
}

/** Construct a SimulationClock from a validated spec. */
export function createSimulationClock(spec: SimulationClockSpec): TimeResult<SimulationClock> {
  if (!isTimestampMs(spec.asOf)) {
    return fail('invalid_timestamp', 'SimulationClock.asOf must be a valid TimestampMs');
  }
  const now = spec.now ?? spec.asOf;
  if (!isTimestampMs(now)) {
    return fail('invalid_timestamp', 'SimulationClock.now must be a valid TimestampMs');
  }
  if (now > spec.asOf) {
    return fail('beyond_as_of', `SimulationClock.now (${now}) may not exceed asOf (${spec.asOf})`);
  }
  const playbackSpeed = spec.playbackSpeed ?? 1;
  if (typeof playbackSpeed !== 'number' || !Number.isFinite(playbackSpeed) || playbackSpeed <= 0) {
    return fail('invalid_playback_speed', `playbackSpeed must be a positive finite number, got ${String(playbackSpeed)}`);
  }
  if (!isFidelityMode(spec.fidelity)) {
    return fail('invalid_clock', `fidelity must be one of ${FIDELITY_MODES.join(' | ')}`);
  }
  return ok({
    now,
    asOf: spec.asOf,
    playbackSpeed,
    paused: spec.paused ?? false,
    fidelity: spec.fidelity,
    informationPolicy: 'point-in-time',
  });
}

/** Move `now` to an explicit later instant. Rejects regression and `beyond asOf`. */
export function advanceClockTo(clock: SimulationClock, to: TimestampMs): TimeResult<SimulationClock> {
  if (!isTimestampMs(to)) {
    return fail('invalid_timestamp', 'advanceClockTo target must be a valid TimestampMs');
  }
  if (to < clock.now) {
    return fail('clock_regression', `clock may not move backwards: now=${clock.now}, target=${to}`);
  }
  if (to > clock.asOf) {
    return fail('beyond_as_of', `clock may not advance past asOf: asOf=${clock.asOf}, target=${to}`);
  }
  return ok({ ...clock, now: to });
}

/** Move `now` forward by a non-negative duration. */
export function advanceClockBy(clock: SimulationClock, duration: Duration): TimeResult<SimulationClock> {
  if (!isDuration(duration)) {
    return fail('invalid_duration', 'advanceClockBy requires a valid Duration');
  }
  const msResult = durationToMs(duration);
  if (!msResult.ok) return msResult;
  const target = clock.now + msResult.value;
  if (target > MAX_TIMESTAMP_MS) {
    return fail('out_of_range', 'advanceClockBy overflows the representable timestamp range');
  }
  const advanced = timestampMs(target);
  if (!advanced.ok) return advanced;
  if (advanced.value > clock.asOf) {
    return fail('beyond_as_of', `clock may not advance past asOf: asOf=${clock.asOf}, target=${advanced.value}`);
  }
  return ok({ ...clock, now: advanced.value });
}

/** Set the playback-speed multiplier (positive finite). */
export function withPlaybackSpeed(clock: SimulationClock, speed: number): TimeResult<SimulationClock> {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) {
    return fail('invalid_playback_speed', `playbackSpeed must be a positive finite number, got ${String(speed)}`);
  }
  return ok({ ...clock, playbackSpeed: speed });
}

/** Suspend automatic progression (idempotent; explicit transitions still work). */
export function pauseClock(clock: SimulationClock): SimulationClock {
  return clock.paused ? clock : { ...clock, paused: true };
}

/** Resume automatic progression (idempotent; `now` is unchanged — the runtime drives it). */
export function resumeClock(clock: SimulationClock): SimulationClock {
  return clock.paused ? { ...clock, paused: false } : clock;
}
