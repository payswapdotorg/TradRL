/**
 * @tradrl/trajectory — leakage forensics and time-engine sample compatibility.
 *
 * This module is the L4 instrument of the trajectory protocol. It does two
 * things:
 *
 * 1. {@link toTrajectorySamples} converts a trajectory into
 *    time-engine-SHAPED samples (`TrajectorySample<Observable>` structure:
 *    one clock + observed-pairs sample per step) so the canonical
 *    `@tradrl/time-engine` `leakageCheck` can scan it directly. The shapes
 *    here are STRUCTURAL MIRRORS of time-engine's `SimulationClock` /
 *    `Observable` / `TrajectorySample` (the package dependency is forbidden
 *    by the lockfile); interop.test.ts is the trip wire asserting mutual
 *    assignability AND behavioral agreement with the real `leakageCheck`.
 *
 * 2. {@link auditTrajectory} applies the MIRRORED leakage rules directly to
 *    the trajectory record: an observation whose `availableTime` exceeds its
 *    step's clock `now` is a future observation (the leak); a step clock
 *    that moves backwards is a clock regression (which would invalidate any
 *    exoneration). Findings mirror time-engine's `LeakageFinding` kinds.
 *
 * Reconstruction policy for the full clock shape: a recorded step carries
 * only `now`/`asOf` (what the record needs); playback speed, pause state and
 * information policy are runtime concerns, not record concerns. The
 * converter therefore emits neutral values — `playbackSpeed: 1`, `paused:
 * true` (a record is a frozen instant, not a running clock), `fidelity`
 * from the trajectory lineage (L5) and the single ratified policy
 * `'point-in-time'`. These choices do not affect leakage semantics: the
 * rule reads only `now` and `available_time`.
 */

import { isRecord } from './primitives';
import { isTimestampMs, type TimestampMs } from './timestamp';
import { isFidelityMode, type ClockSample } from './clock';
import type { FidelityMode } from './clock';
import type { Trajectory, TrajectoryStep } from './record';
import type { ObservationRef } from './step';

// ---------------------------------------------------------------------------
// Structural mirrors of the time-engine sample shapes
// ---------------------------------------------------------------------------

/**
 * Full structural mirror of time-engine's `SimulationClock`. The converter
 * emits this shape so its output is assignable to
 * `TrajectorySample<T extends Observable>` without a package dependency.
 */
export interface SampleClock {
  readonly now: TimestampMs;
  readonly asOf: TimestampMs;
  readonly playbackSpeed: number;
  readonly paused: boolean;
  readonly fidelity: FidelityMode;
  readonly informationPolicy: 'point-in-time';
}

/** Guard: a structurally valid sample clock (mirrors the engine invariants). */
export function isSampleClock(value: unknown): value is SampleClock {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.now) || !isTimestampMs(value.asOf)) return false;
  if ((value.now as number) > (value.asOf as number)) return false;
  if (typeof value.playbackSpeed !== 'number' || !Number.isFinite(value.playbackSpeed) || value.playbackSpeed <= 0)
    return false;
  if (typeof value.paused !== 'boolean') return false;
  if (!isFidelityMode(value.fidelity)) return false;
  return value.informationPolicy === 'point-in-time';
}

/**
 * One observation in converter output: the availability instant (the
 * `Observable` structural contract — snake_case `available_time`, exactly as
 * time-engine spells it) plus the opaque observation reference it points at.
 */
export interface SampledObservation {
  readonly available_time: TimestampMs;
  readonly ref: string;
}

/** One converted sample: the step's clock and observed pairs. */
export interface TrajectorySampleRecord {
  readonly clock: SampleClock;
  readonly observed: readonly SampledObservation[];
  readonly label?: string;
}

/** Reconstruct the full clock shape for one recorded step. */
function sampleClock(step: TrajectoryStep, fidelity: FidelityMode): SampleClock {
  return {
    now: step.clock.now,
    asOf: step.clock.asOf,
    playbackSpeed: 1,
    paused: true,
    fidelity,
    informationPolicy: 'point-in-time',
  };
}

/**
 * Convert a trajectory into time-engine-shaped samples: one sample per step,
 * in recorded order, each carrying the step's reconstructed clock, its
 * observations (availability instant + opaque reference) and the step id as
 * label. The output feeds the canonical `leakageCheck` unchanged.
 */
export function toTrajectorySamples(trajectory: Trajectory): readonly TrajectorySampleRecord[] {
  const fidelity = trajectory.metadata.fidelity;
  return trajectory.steps.map((step) => ({
    clock: sampleClock(step, fidelity),
    observed: step.observations.map((observation) => ({
      available_time: observation.availableTime,
      ref: observation.ref,
    })),
    label: step.id,
  }));
}

// ---------------------------------------------------------------------------
// Mirrored leakage forensics (over the trajectory record directly)
// ---------------------------------------------------------------------------

/** An observation made before its `availableTime` — the actual leak. */
export interface FutureObservationFinding {
  readonly kind: 'future_observation';
  /** Index of the offending step. */
  readonly stepIndex: number;
  /** Index of the offending observation within the step. */
  readonly observationIndex: number;
  /** Id of the offending step (the sample label). */
  readonly stepId: string;
  readonly clockNow: number;
  readonly availableTime: number;
  /** How far into the future the observation was, in milliseconds (> 0). */
  readonly leadMs: number;
}

/** The trajectory recording itself moved backwards in time. */
export interface ClockRegressionFinding {
  readonly kind: 'clock_regression';
  /** Index of the step whose `now` regressed. */
  readonly stepIndex: number;
  readonly stepId: string;
  readonly fromNow: number;
  readonly toNow: number;
}

export type TrajectoryFinding = FutureObservationFinding | ClockRegressionFinding;

/** Mirror of time-engine's `LeakageReport` shape (camelCase step identity). */
export interface TrajectoryLeakageReport {
  /** True iff no findings — the trajectory respected the information boundary. */
  readonly clean: boolean;
  readonly findings: readonly TrajectoryFinding[];
  readonly stepsChecked: number;
  readonly observationsChecked: number;
}

/**
 * Scan a trajectory for boundary violations using the MIRRORED rules:
 * - future observation: `availableTime > clock.now` at the same step;
 * - clock regression: a step's `now` earlier than its predecessor's.
 *
 * Findings are reported in scan order. A clean report is positive evidence
 * the recorded actor never saw the future (L4).
 */
export function auditTrajectory(trajectory: Trajectory): TrajectoryLeakageReport {
  const findings: TrajectoryFinding[] = [];
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
        stepId: step.id,
        fromNow: previousNow,
        toNow: now,
      });
    }
    previousNow = now;
    observationsChecked += step.observations.length;
    for (let observationIndex = 0; observationIndex < step.observations.length; observationIndex++) {
      const observation: ObservationRef | undefined = step.observations[observationIndex];
      if (observation === undefined) continue;
      if (observation.availableTime > now) {
        findings.push({
          kind: 'future_observation',
          stepIndex,
          observationIndex,
          stepId: step.id,
          clockNow: now,
          availableTime: observation.availableTime,
          leadMs: observation.availableTime - now,
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
