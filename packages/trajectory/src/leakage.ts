/**
 * @tradrl/trajectory — leakage forensics over the trajectory format.
 *
 * MIRROR of @tradrl/time-engine's leakage contract (src/leakage.ts). The
 * canonical `leakageCheck` audits a trajectory of (clock, observed) samples
 * and reports every observation that violated the point-in-time boundary,
 * plus any clock regression in the recording itself. This module mirrors that
 * contract OPERATING DIRECTLY on this package's record:
 *
 *   - {@link checkTrajectoryLeakage} — the mirrored rules over a
 *     {@link Trajectory}: a `future_observation` finding means an observation
 *     with `available_time > step.clock.now` was DELIVERED in that step (the
 *     recorded fact of a leak — L4 forensics); a `clock_regression` finding
 *     means the step clocks moved backwards (which would invalidate any
 *     exoneration). Construction REJECTS clock regressions (trajectory.ts),
 *     so a finding here means the record was smuggled in through
 *     `validateTrajectory` of untrusted data — defense in depth, exactly the
 *     posture of time-engine's own check.
 *   - {@link toTrajectorySamples} — the converter producing time-engine-shaped
 *     samples (`{ clock, observed, label? }`) so consumers can run the
 *     CANONICAL `leakageCheck` from `@tradrl/time-engine` over trajectory
 *     data. The clock sample is the full SimulationClock mirror (step.ts) and
 *     the observation refs satisfy time-engine's `Observable`
 *     (`available_time`) — the samples are structurally assignable with zero
 *     adaptation (interop.test.ts is the trip wire).
 */

import type { Trajectory } from './trajectory';
import type { ClockSample, ObservationRef } from './step';

/**
 * One recorded sample: the clock state and the observations made at it.
 * STRUCTURAL MIRROR of time-engine's `TrajectorySample<T>` — same fields,
 * same semantics; the generic is closed over this package's observation ref
 * because the converter always produces refs.
 */
export interface TrajectorySample {
  readonly clock: ClockSample;
  readonly observed: readonly ObservationRef[];
  /** Human-readable label (the step id). */
  readonly label?: string;
}

/** An observation delivered before its `available_time` — the actual leak. */
export interface FutureObservationFinding {
  readonly kind: 'future_observation';
  /** Index of the trajectory step. */
  readonly stepIndex: number;
  /** Index of the offending observation within the step. */
  readonly observationIndex: number;
  /** Step id of the sample. */
  readonly label?: string;
  readonly clockNow: number;
  readonly available_time: number;
  /** How far into the future the observation was, in milliseconds (always > 0). */
  readonly leadMs: number;
}

/** The trajectory recording itself moved backwards in time. */
export interface ClockRegressionFinding {
  readonly kind: 'clock_regression';
  /** Index of the step whose `now` regressed. */
  readonly stepIndex: number;
  readonly label?: string;
  readonly fromNow: number;
  readonly toNow: number;
}

export type LeakageFinding = FutureObservationFinding | ClockRegressionFinding;

export interface LeakageReport {
  /** True iff no findings — the trajectory respected the information boundary. */
  readonly clean: boolean;
  readonly findings: readonly LeakageFinding[];
  readonly stepsChecked: number;
  readonly observationsChecked: number;
}

/**
 * Scan a trajectory for boundary violations (the mirrored leakage rules).
 *
 * Findings are reported in scan order. A `future_observation` finding means
 * an observation with `available_time > clock.now` was delivered in that
 * step; a `clock_regression` finding means step ordering moved backwards.
 */
export function checkTrajectoryLeakage(trajectory: Trajectory): LeakageReport {
  const findings: LeakageFinding[] = [];
  let observationsChecked = 0;
  let previousNow: number | undefined;

  for (let stepIndex = 0; stepIndex < trajectory.steps.length; stepIndex++) {
    const step = trajectory.steps[stepIndex];
    if (step === undefined) continue;
    const now = step.clock.now;
    if (previousNow !== undefined && now < previousNow) {
      findings.push({
        kind: 'clock_regression',
        stepIndex,
        label: step.step_id,
        fromNow: previousNow,
        toNow: now,
      });
    }
    previousNow = now;
    observationsChecked += step.observations.length;
    for (let observationIndex = 0; observationIndex < step.observations.length; observationIndex++) {
      const observation = step.observations[observationIndex];
      if (observation === undefined) continue;
      if (observation.available_time > now) {
        findings.push({
          kind: 'future_observation',
          stepIndex,
          observationIndex,
          label: step.step_id,
          clockNow: now,
          available_time: observation.available_time,
          leadMs: observation.available_time - now,
        });
      }
    }
  }

  return {
    clean: findings.length === 0,
    findings,
    stepsChecked: trajectory.steps.length,
    observationsChecked,
  };
}

/**
 * Convert a trajectory into time-engine-shaped samples: one
 * `{ clock, observed, label }` per step, in step order. The clocks are the
 * steps' own samples (full SimulationClock mirror) and the observed sets are
 * the delivered observation refs (which satisfy time-engine's `Observable`).
 * Feeding the result to `@tradrl/time-engine`'s canonical `leakageCheck`
 * yields the canonical verdict over the same recorded facts — the format-
 * compatibility trip wire (interop.test.ts proves both engines agree).
 */
export function toTrajectorySamples(trajectory: Trajectory): readonly TrajectorySample[] {
  return trajectory.steps.map((step) => ({
    clock: step.clock,
    observed: step.observations,
    label: step.step_id,
  }));
}
