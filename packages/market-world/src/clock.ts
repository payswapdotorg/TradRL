/**
 * @tradrl/market-world — clock state: structural mirror of
 * @tradrl/time-engine's `SimulationClock` (and therefore of
 * @tradrl/environment-protocol's `ClockConfig`).
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE.
 *
 * The canonical `SimulationClock` value object (and the canonical
 * `FidelityMode` / `InformationPolicy` types) live in `@tradrl/time-engine`
 * (packages/time-engine/src/clock.ts). The frozen workspace lockfile forbids
 * a package dependency between contract packages, so this package
 * re-declares the IDENTICAL structural shape as {@link ClockState} plus the
 * same string-literal unions. TypeScript's structural typing makes a
 * time-engine `SimulationClock` assignable to `ClockState` and vice versa;
 * `packages/market-world/src/interop.test.ts` is the trip wire.
 *
 * Invariants (mirrored, enforced on construction and every transition):
 *   1. `now <= asOf` — a replay may never run past its information anchor.
 *   2. `now` is monotonic within a run (`advanceClockStateTo` rejects
 *      regressions).
 *   3. `playbackSpeed` is a positive finite multiplier.
 *
 * Fidelity modes (ARCHITECTURE-LOCK L5 — three DISTINCT modes, never aliased):
 *   - `exact_replay`: deterministic replay of historical events only — the
 *     ONLY mode this package implements (see config.ts for the discipline).
 *   - `reactive_replay`: historical events plus endogenous simulated
 *     participants (T027).
 *   - `generative`: counterfactual/synthetic worlds (T028) — exploration
 *     instruments, never historical truth.
 */

import { deepFreeze, isFiniteNumber, isRecord } from './primitives';
import { fail, ok, type WorldResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';

/** The three distinct world-fidelity modes (L5). Mirror of time-engine. */
export type FidelityMode = 'exact_replay' | 'reactive_replay' | 'generative';

/** Runtime-checkable list of fidelity modes, for guards and diagnostics. */
export const FIDELITY_MODES: readonly FidelityMode[] = ['exact_replay', 'reactive_replay', 'generative'];

/**
 * The information policy governing what the clock's `now` admits.
 * `point-in-time`: an observation is visible iff `available_time <= now`
 * (inclusive). There is deliberately a single policy today — the boundary is
 * the law (L4), not a dial. Mirror of time-engine.
 */
export type InformationPolicy = 'point-in-time';

/**
 * The clock of a replay world state — a structural mirror of time-engine's
 * `SimulationClock` (see module header). The world is the L4 enforcement
 * point: `observe` polices `available_time <= now` (inclusive) against this
 * clock, delegating nothing.
 */
export interface ClockState {
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

/** Runtime guard for a fidelity mode. Mirror of time-engine's `isFidelityMode`. */
export function isFidelityMode(value: unknown): value is FidelityMode {
  return typeof value === 'string' && (FIDELITY_MODES as readonly string[]).includes(value);
}

/** Runtime guard for the (currently single) information policy. */
export function isInformationPolicy(value: unknown): value is InformationPolicy {
  return value === 'point-in-time';
}

/** Runtime guard for a structurally valid and invariant-abiding clock state. */
export function isClockState(value: unknown): value is ClockState {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.now) || !isTimestampMs(value.asOf)) return false;
  if (value.now > value.asOf) return false;
  if (!isFiniteNumber(value.playbackSpeed) || value.playbackSpeed <= 0) return false;
  if (typeof value.paused !== 'boolean') return false;
  if (!isFidelityMode(value.fidelity)) return false;
  if (value.informationPolicy !== 'point-in-time') return false;
  return true;
}

/**
 * Construct a {@link ClockState} from validated spec-shaped input. `now`
 * defaults to `asOf` (the clock starts standing at its anchor — time-engine's
 * default); `playbackSpeed` defaults to 1; `paused` defaults to false.
 */
export function createClockState(input: {
  readonly asOf: TimestampMs;
  readonly now?: TimestampMs;
  readonly playbackSpeed?: number;
  readonly paused?: boolean;
  readonly fidelity: FidelityMode;
  readonly informationPolicy?: InformationPolicy;
}): WorldResult<ClockState> {
  if (!isTimestampMs(input.asOf)) {
    return fail('invalid_timestamp', 'ClockState.asOf must be a valid TimestampMs', 'asOf');
  }
  const now = input.now ?? input.asOf;
  if (!isTimestampMs(now)) {
    return fail('invalid_timestamp', 'ClockState.now must be a valid TimestampMs', 'now');
  }
  if (now > input.asOf) {
    return fail('beyond_as_of', `ClockState.now (${now}) may not exceed asOf (${input.asOf})`, 'now');
  }
  const playbackSpeed = input.playbackSpeed ?? 1;
  if (!isFiniteNumber(playbackSpeed) || playbackSpeed <= 0) {
    return fail('invalid_field', `playbackSpeed must be a positive finite number, got ${String(playbackSpeed)}`, 'playbackSpeed');
  }
  if (!isFidelityMode(input.fidelity)) {
    return fail('invalid_field', `fidelity must be one of ${FIDELITY_MODES.join(' | ')}`, 'fidelity');
  }
  return ok(
    deepFreeze({
      now,
      asOf: input.asOf,
      playbackSpeed,
      paused: input.paused ?? false,
      fidelity: input.fidelity,
      informationPolicy: input.informationPolicy ?? 'point-in-time',
    }),
  );
}

/**
 * Validate an untrusted `ClockState`-shaped value and return it narrowed,
 * deeply frozen. Collect-all with dotted paths rooted at the caller-supplied
 * prefix (e.g. `spec.profile.clock`).
 */
export function validateClockState(value: unknown, path = 'clock'): WorldResult<ClockState> {
  if (!isRecord(value)) {
    return fail('invalid_type', `${path} must be an object`, path);
  }
  const errors = [];
  if (!isTimestampMs(value.now)) {
    errors.push({ code: 'invalid_timestamp' as const, path: `${path}.now`, message: `${path}.now must be a valid TimestampMs (integer epoch ms in range)` });
  }
  if (!isTimestampMs(value.asOf)) {
    errors.push({ code: 'invalid_timestamp' as const, path: `${path}.asOf`, message: `${path}.asOf must be a valid TimestampMs (integer epoch ms in range)` });
  }
  if (isTimestampMs(value.now) && isTimestampMs(value.asOf) && value.now > value.asOf) {
    errors.push({ code: 'beyond_as_of' as const, path: `${path}.now`, message: `${path}.now (${String(value.now)}) may not exceed ${path}.asOf (${String(value.asOf)})` });
  }
  if (!isFiniteNumber(value.playbackSpeed) || value.playbackSpeed <= 0) {
    errors.push({ code: 'invalid_field' as const, path: `${path}.playbackSpeed`, message: `${path}.playbackSpeed must be a positive finite number` });
  }
  if (typeof value.paused !== 'boolean') {
    errors.push({ code: 'invalid_field' as const, path: `${path}.paused`, message: `${path}.paused must be a boolean` });
  }
  if (!isFidelityMode(value.fidelity)) {
    errors.push({ code: 'invalid_field' as const, path: `${path}.fidelity`, message: `${path}.fidelity must be one of ${FIDELITY_MODES.join(' | ')}` });
  }
  if (value.informationPolicy !== 'point-in-time') {
    errors.push({ code: 'invalid_field' as const, path: `${path}.informationPolicy`, message: `${path}.informationPolicy must be 'point-in-time'` });
  }
  if (errors.length > 0) return { ok: false, errors };
  return ok(
    deepFreeze({
      now: value.now as TimestampMs,
      asOf: value.asOf as TimestampMs,
      playbackSpeed: value.playbackSpeed as number,
      paused: value.paused as boolean,
      fidelity: value.fidelity as FidelityMode,
      informationPolicy: 'point-in-time',
    }),
  );
}

/**
 * Move `now` to an explicit later instant. Rejects regression
 * (`clock_regression`) and `beyond asOf` — the exact law of time-engine's
 * `advanceClockTo`, mirrored. `to == now` is a legal no-op advance.
 */
export function advanceClockStateTo(clock: ClockState, to: TimestampMs): WorldResult<ClockState> {
  if (!isTimestampMs(to)) {
    return fail('invalid_timestamp', 'advanceClockStateTo target must be a valid TimestampMs');
  }
  if (to < clock.now) {
    return fail('clock_regression', `the clock may not move backwards: now=${clock.now}, target=${to}`);
  }
  if (to > clock.asOf) {
    return fail('beyond_as_of', `the clock may not advance past asOf: asOf=${clock.asOf}, target=${to}`);
  }
  return ok(deepFreeze({ ...clock, now: to }));
}
