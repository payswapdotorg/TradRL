/**
 * @tradrl/trajectory — the trajectory record (append-only experience log).
 *
 * A `Trajectory` is the complete, ordered, lineage-bound experience stream
 * of an agent or organization during an episode: the metadata lineage block
 * plus an append-only log of {@link TrajectoryStep}s.
 *
 * Immutability law (T011): trajectories are deeply-frozen value objects.
 * "Append" is copy-on-write — {@link appendStep} returns a NEW record and
 * leaves the original untouched. There is no mutation or removal API, and
 * none can exist: the record type is pure data with `readonly` fields and a
 * `readonly` step array (the structural compile-time guarantee, asserted by
 * record.test.ts).
 *
 * Construction policy (mirrors the time-engine split between structure and
 * behavior): the guards validate STRUCTURE — every step field, unique step
 * ids, valid clock samples. They deliberately do NOT enforce cross-step
 * clock monotonicity or availability discipline: an honest RECORDING of a
 * broken (leaky, regressed) run must be expressible, because forensics
 * (sample.ts) exists precisely to detect those violations after the fact.
 */

import { deepFreeze } from './primitives';
import { fail, ok, type TrajectoryResult } from './errors';
import { isTrajectoryId, type TrajectoryId } from './ids';
import { isTrajectoryMetadata, type TrajectoryMetadata } from './metadata';
import { isTrajectoryStep, type TrajectoryStep } from './step';

/**
 * The trajectory record: lineage metadata + the ordered, append-only step
 * log. Replay is deterministic: {@link replay} yields the steps in exactly
 * the order they were appended, and the canonical serialization
 * (serialize.ts) of a replayed record is byte-identical to the original's.
 */
export interface Trajectory {
  /** Opaque identity of this trajectory record. */
  readonly id: TrajectoryId;
  /** The full L9 lineage block. */
  readonly metadata: TrajectoryMetadata;
  /** The ordered step log. Empty until steps are appended. */
  readonly steps: readonly TrajectoryStep[];
}

/** Spec for {@link createTrajectory}. */
export interface TrajectorySpec {
  readonly id: TrajectoryId;
  readonly metadata: TrajectoryMetadata;
  /** Initial steps, appended in order (defaults to none). */
  readonly steps?: readonly TrajectoryStep[];
}

/** Construct a validated, deeply-frozen trajectory. */
export function createTrajectory(spec: TrajectorySpec): TrajectoryResult<Trajectory> {
  if (!isTrajectoryId(spec.id)) {
    return fail('invalid_id', 'Trajectory.id must be a non-empty string');
  }
  if (!isTrajectoryMetadata(spec.metadata)) {
    return fail('invalid_metadata', 'trajectory metadata failed the lineage guard (L9 block incomplete or invalid)');
  }
  const steps = spec.steps ?? [];
  if (!Array.isArray(steps) || !steps.every(isTrajectoryStep)) {
    return fail('invalid_step', 'every initial step must be a valid TrajectoryStep');
  }
  const ids = steps.map((step) => step.id);
  if (new Set(ids).size !== ids.length) {
    return fail('duplicate_step', 'initial steps contain duplicate step ids');
  }
  return ok(
    deepFreeze({
      id: spec.id,
      metadata: deepFreeze({ ...spec.metadata }),
      steps: steps.map((step) => deepFreeze({ ...step })),
    }),
  );
}

/**
 * Append one step, copy-on-write. The original record is untouched; the
 * returned record carries the step at the end of the log. The step id must
 * be unique within the trajectory.
 */
export function appendStep(trajectory: Trajectory, step: TrajectoryStep): TrajectoryResult<Trajectory> {
  if (!isTrajectoryStep(step)) {
    return fail('invalid_step', 'appended step failed the structural guard');
  }
  if (trajectory.steps.some((existing) => existing.id === step.id)) {
    return fail('duplicate_step', `step id already present in trajectory: ${step.id}`);
  }
  return ok(
    deepFreeze({
      ...trajectory,
      steps: [...trajectory.steps, deepFreeze({ ...step })],
    }),
  );
}

/**
 * Deterministic replay: the steps in exactly the order they were appended.
 * Equal by deep-equality to the recorded log — and to the replay of any
 * serialization round-trip of the same record.
 */
export function replay(trajectory: Trajectory): readonly TrajectoryStep[] {
  return trajectory.steps;
}

/** Number of steps recorded so far. */
export function stepCount(trajectory: Trajectory): number {
  return trajectory.steps.length;
}
