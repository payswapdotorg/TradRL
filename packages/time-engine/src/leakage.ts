/**
 * @tradrl/time-engine — trajectory leakage detection.
 *
 * The {@link leakageCheck} audits a RECORDED trajectory of
 * (clock, observed events) samples and reports every observation that
 * violated the point-in-time boundary, plus any clock regression in the
 * recording itself. It is the forensic instrument behind L4: a clean report
 * is positive evidence that an agent (or a feature pipeline, or a cache)
 * never saw the future.
 */

import type { SimulationClock } from './clock';
import type { Observable } from './boundary';

/** One recorded sample: the clock state and the observations made at it. */
export interface TrajectorySample<T extends Observable> {
  readonly clock: SimulationClock;
  readonly observed: readonly T[];
  /** Optional human-readable label (step id, agent id, feature name). */
  readonly label?: string;
}

/** An observation made before its `available_time` — the actual leak. */
export interface FutureObservationFinding {
  readonly kind: 'future_observation';
  /** Index of the trajectory sample. */
  readonly sampleIndex: number;
  /** Index of the offending observation within the sample. */
  readonly observationIndex: number;
  /** Label of the sample, if recorded. */
  readonly label?: string;
  readonly clockNow: number;
  readonly available_time: number;
  /** How far into the future the observation was, in milliseconds (always > 0). */
  readonly leadMs: number;
}

/** The trajectory recording itself moved backwards in time. */
export interface ClockRegressionFinding {
  readonly kind: 'clock_regression';
  /** Index of the sample whose `now` regressed. */
  readonly sampleIndex: number;
  readonly label?: string;
  readonly fromNow: number;
  readonly toNow: number;
}

export type LeakageFinding = FutureObservationFinding | ClockRegressionFinding;

export interface LeakageReport {
  /** True iff no findings — the trajectory respected the information boundary. */
  readonly clean: boolean;
  readonly findings: readonly LeakageFinding[];
  readonly samplesChecked: number;
  readonly observationsChecked: number;
}

/**
 * Scan a trajectory of (clock, observed) samples for boundary violations.
 *
 * Findings are reported in scan order. A `future_observation` finding means an
 * observation with `available_time > clock.now` was present in the sample's
 * observed set. A `clock_regression` finding means sample ordering moved
 * backwards, which would itself invalidate any leakage exoneration.
 */
export function leakageCheck<T extends Observable>(trajectory: readonly TrajectorySample<T>[]): LeakageReport {
  const findings: LeakageFinding[] = [];
  let observationsChecked = 0;
  let previousNow: number | undefined;

  for (let sampleIndex = 0; sampleIndex < trajectory.length; sampleIndex++) {
    const sample = trajectory[sampleIndex];
    if (sample === undefined) continue;
    const now = sample.clock.now;
    if (previousNow !== undefined && now < previousNow) {
      findings.push({
        kind: 'clock_regression',
        sampleIndex,
        label: sample.label,
        fromNow: previousNow,
        toNow: now,
      });
    }
    previousNow = now;
    observationsChecked += sample.observed.length;
    for (let observationIndex = 0; observationIndex < sample.observed.length; observationIndex++) {
      const observation = sample.observed[observationIndex];
      if (observation === undefined) continue;
      if (observation.available_time > now) {
        findings.push({
          kind: 'future_observation',
          sampleIndex,
          observationIndex,
          label: sample.label,
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
    samplesChecked: trajectory.length,
    observationsChecked,
  };
}
