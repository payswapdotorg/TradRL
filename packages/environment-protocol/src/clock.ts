/**
 * @tradrl/environment-protocol — clock config mirror of @tradrl/time-engine.
 *
 * STRUCTURAL MIRROR — DO NOT DIVERGE.
 *
 * The canonical `SimulationClock` value object (and the canonical
 * `FidelityMode` / `InformationPolicy` types) live in `@tradrl/time-engine`
 * (packages/time-engine/src/clock.ts). The frozen workspace lockfile forbids
 * a package dependency between contract packages, so this package
 * re-declares the IDENTICAL structural shape as {@link ClockConfig} plus the
 * same string-literal unions. TypeScript's structural typing makes a
 * time-engine `SimulationClock` assignable to `ClockConfig` and vice versa;
 * `packages/environment-protocol/src/interop.test.ts` is the trip wire.
 *
 * Semantic difference (the ONLY one, and it is deliberate):
 * `ClockConfig` is the INITIAL clock state recorded in an
 * {@link EnvironmentProfile} — configuration, not a live clock. It fully
 * determines the episode's time behavior together with the profile seed
 * (L9). Episode progression is explicit (`advanceEpisode`); `paused` governs
 * any runtime auto-driver, exactly as in time-engine.
 *
 * Any change here MUST be mirrored in time-engine and vice versa.
 */

import { deepFreeze, isFiniteNumber, isRecord } from './primitives';
import { fail, ok, type EnvResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';

/** The three distinct world-fidelity modes (L5). Mirror of time-engine. */
export type FidelityMode = 'exact_replay' | 'reactive_replay' | 'generative';

/** Runtime-checkable list of fidelity modes, for guards and diagnostics. */
export const FIDELITY_MODES: readonly FidelityMode[] = ['exact_replay', 'reactive_replay', 'generative'];

/**
 * The information policy governing what the episode's `now` admits.
 * `point-in-time`: an observation is visible iff `available_time <= now`
 * (inclusive). There is deliberately a single policy today — the boundary is
 * the law (L4), not a dial. Mirror of time-engine.
 */
export type InformationPolicy = 'point-in-time';

/**
 * The clock configuration of an environment profile — a structural mirror
 * of time-engine's `SimulationClock` (see module header).
 */
export interface ClockConfig {
  /** Initial/current simulated instant. Monotonic within an episode; never past `asOf`. */
  readonly now: TimestampMs;
  /** Historical anchor: the latest instant this episode's information set covers. */
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

/** Runtime guard for a structurally valid and invariant-abiding clock config. */
export function isClockConfig(value: unknown): value is ClockConfig {
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
 * Construct a `ClockConfig` from a validated spec-shaped input.
 * `now` defaults to `asOf`; `playbackSpeed` defaults to 1; `paused`
 * defaults to false — the same defaults as time-engine's
 * `createSimulationClock`.
 */
export function createClockConfig(input: {
  readonly asOf: TimestampMs;
  readonly now?: TimestampMs;
  readonly playbackSpeed?: number;
  readonly paused?: boolean;
  readonly fidelity: FidelityMode;
  readonly informationPolicy?: InformationPolicy;
}): EnvResult<ClockConfig> {
  if (!isTimestampMs(input.asOf)) {
    return fail('invalid_timestamp', 'ClockConfig.asOf must be a valid TimestampMs', 'asOf');
  }
  const now = input.now ?? input.asOf;
  if (!isTimestampMs(now)) {
    return fail('invalid_timestamp', 'ClockConfig.now must be a valid TimestampMs', 'now');
  }
  if (now > input.asOf) {
    return fail('beyond_as_of', `ClockConfig.now (${now}) may not exceed asOf (${input.asOf})`, 'now');
  }
  const playbackSpeed = input.playbackSpeed ?? 1;
  if (!isFiniteNumber(playbackSpeed) || playbackSpeed <= 0) {
    return fail(
      'invalid_field',
      `playbackSpeed must be a positive finite number, got ${String(playbackSpeed)}`,
      'playbackSpeed',
    );
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
 * Validate an untrusted `ClockConfig`-shaped value and return it frozen.
 * Collect-all: every field violation is reported (dotted paths rooted at
 * the caller-supplied prefix, e.g. `profile.clock`).
 */
export function validateClockConfig(value: unknown, path = 'clock'): EnvResult<ClockConfig> {
  if (!isRecord(value)) {
    return fail('invalid_type', `${path} must be an object`, path);
  }
  if (!isTimestampMs(value.now)) {
    return fail('invalid_timestamp', `${path}.now must be a valid TimestampMs (integer epoch ms in range)`, `${path}.now`);
  }
  if (!isTimestampMs(value.asOf)) {
    return fail('invalid_timestamp', `${path}.asOf must be a valid TimestampMs (integer epoch ms in range)`, `${path}.asOf`);
  }
  if (value.now > value.asOf) {
    return fail('beyond_as_of', `${path}.now (${String(value.now)}) may not exceed ${path}.asOf (${String(value.asOf)})`, `${path}.now`);
  }
  if (!isFiniteNumber(value.playbackSpeed) || value.playbackSpeed <= 0) {
    return fail('invalid_field', `${path}.playbackSpeed must be a positive finite number`, `${path}.playbackSpeed`);
  }
  if (typeof value.paused !== 'boolean') {
    return fail('invalid_field', `${path}.paused must be a boolean`, `${path}.paused`);
  }
  if (!isFidelityMode(value.fidelity)) {
    return fail('invalid_field', `${path}.fidelity must be one of ${FIDELITY_MODES.join(' | ')}`, `${path}.fidelity`);
  }
  if (value.informationPolicy !== 'point-in-time') {
    return fail('invalid_field', `${path}.informationPolicy must be 'point-in-time'`, `${path}.informationPolicy`);
  }
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
