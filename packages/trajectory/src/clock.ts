/**
 * @tradrl/trajectory — the clock sample and fidelity vocabulary.
 *
 * `ClockSample` is the per-step time record a trajectory carries: the
 * simulated instant (`now`) and the information anchor (`asOf`) at which the
 * step was taken. It is a MINIMAL structural mirror of `@tradrl/time-engine`'s
 * `SimulationClock` (T004, merged — the canonical owner): the two fields the
 * learning record needs. The full clock shape (playback speed, pause state,
 * fidelity, information policy) is reconstructed by the sample converter
 * (sample.ts) when producing time-engine-shaped `TrajectorySample`s.
 *
 * The `FidelityMode` vocabulary is a mirror of time-engine's L5 trio:
 * `exact_replay`, `reactive_replay` and `generative` are DISTINCT world
 * fidelities and never aliased. A trajectory RECORDS which fidelity it ran
 * under — that is lineage (L9), because a generative-world trajectory is
 * evidence of a different epistemic kind than an exact replay.
 *
 * Laws honored here:
 * - L4 point-in-time truth: the per-sample invariant `now <= asOf` holds for
 *   every structurally valid clock sample (a record violating it is corrupt
 *   data and fails the guard). Cross-step monotonicity is NOT enforced here:
 *   a recording of a broken run is still an honest record — regressions are
 *   DETECTED by the leakage forensics (sample.ts), mirroring time-engine's
 *   `leakageCheck` reporting `clock_regression` as a finding.
 */

import { isEnum, isRecord } from './primitives';
import { isTimestampMs, type TimestampMs } from './timestamp';

/** Mirror of the three distinct world-fidelity modes (ARCHITECTURE-LOCK L5). */
export type FidelityMode = 'exact_replay' | 'reactive_replay' | 'generative';

/** Runtime-checkable mirror of the fidelity vocabulary, for guards and docs. */
export const FIDELITY_MODES: readonly FidelityMode[] = ['exact_replay', 'reactive_replay', 'generative'];

/** Guard: a fidelity mode. */
export const isFidelityMode = isEnum(FIDELITY_MODES);

/**
 * The per-step time record: the simulated instant and the information anchor
 * the step was taken at. Invariants (both enforced by {@link isClockSample}):
 *   1. `now` and `asOf` are valid `TimestampMs`.
 *   2. `now <= asOf` — a step may never claim information past the anchor.
 */
export interface ClockSample {
  /** Current simulated instant when the step was taken. */
  readonly now: TimestampMs;
  /** Historical anchor: the latest instant the run's information set covers. */
  readonly asOf: TimestampMs;
}

/** Guard: a structurally valid clock sample abiding both invariants. */
export function isClockSample(value: unknown): value is ClockSample {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.now) || !isTimestampMs(value.asOf)) return false;
  return (value.now as number) <= (value.asOf as number);
}
