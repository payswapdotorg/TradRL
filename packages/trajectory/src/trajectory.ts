/**
 * @tradrl/trajectory — the trajectory record: ordered, append-only, frozen.
 *
 * A {@link Trajectory} is the complete, ordered, lineage-bound experience
 * stream of one episode (spec/DOMAIN-MODEL.md). It is an append-only value
 * object: {@link appendTrajectoryStep} returns a NEW record and the original
 * is untouched; there is no mutation, removal or reordering API anywhere in
 * this package (immutability discipline of ARCHITECTURE-LOCK L3/L9 — history
 * is never rewritten).
 *
 * Append laws (mirroring T005's episode protocol, where they exist there):
 *   1. the appended step must be guard-valid (collect-all);
 *   2. its ordinal is exactly `steps.length + 1` (`step_out_of_order`);
 *   3. its step id, causality id, observation ids, action ids and reward ids
 *      must be unique across the whole trajectory (ids name experience
 *      events; a repeat is a corruption, not an update);
 *   4. its clock's `now` is `>=` the previous step's `now` (`clock_regression`)
 *      — episode time is monotonic. FUTURE-DATED `available_time` on an
 *      observation is deliberately LEGAL: it is the recorded fact the leakage
 *      forensics (leakage.ts) flag — validity is timeless, exactly as in
 *      T005's validators.
 *
 * Replay: {@link replayTrajectory} returns the step sequence in recorded
 * order — the identity function over the log, made explicit so consumers
 * (T013 RL, T012 evaluation) never re-derive ordering themselves.
 */

import { deepFreeze } from './primitives';
import { fail, ok, type TrajResult } from './errors';
import type { TrajectoryMetadata } from './metadata';
import { isTrajectoryMetadata, validateTrajectoryMetadata } from './metadata';
import type { TrajectoryStep } from './step';
import { isTrajectoryStep, validateTrajectoryStep } from './step';

/** The trajectory record: metadata (L9 lineage block) + ordered step log. */
export interface Trajectory {
  readonly metadata: TrajectoryMetadata;
  readonly steps: readonly TrajectoryStep[];
}

/** Runtime guard for a structurally valid trajectory. */
export function isTrajectory(value: unknown): value is Trajectory {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isTrajectoryMetadata(candidate.metadata)) return false;
  if (!Array.isArray(candidate.steps)) return false;
  return (candidate.steps as readonly unknown[]).every((step) => isTrajectoryStep(step));
}

/**
 * Collect-all validation of an untrusted trajectory. Validates metadata and
 * every step, then the cross-step laws (sequential ordinals, id uniqueness,
 * clock monotonicity). On success the value is returned narrowed, deeply
 * frozen. Field-order at input is irrelevant — canonical serialization
 * (serialize.ts) is what makes equal records byte-identical.
 */
export function validateTrajectory(value: unknown, path = 'trajectory'): TrajResult<Trajectory> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: [{ code: 'invalid_type', path, message: `${path} must be an object` }] };
  }
  const candidate = value as Record<string, unknown>;

  let metadata: TrajectoryMetadata | undefined;
  if (candidate.metadata === undefined) {
    return { ok: false, errors: [{ code: 'missing_field', path: `${path}.metadata`, message: 'required field "metadata" is missing' }] };
  }
  const metadataResult = validateTrajectoryMetadata(candidate.metadata, `${path}.metadata`);
  if (metadataResult.ok) {
    metadata = metadataResult.value;
  } else {
    return metadataResult;
  }

  if (!Array.isArray(candidate.steps)) {
    return { ok: false, errors: [{ code: 'invalid_field', path: `${path}.steps`, message: 'must be an array of steps' }] };
  }

  const steps: TrajectoryStep[] = [];
  const seenStepIds = new Set<string>();
  const seenCausalityIds = new Set<string>();
  const seenObservationIds = new Set<string>();
  const seenActionIds = new Set<string>();
  const seenRewardIds = new Set<string>();
  let previousNow: number | undefined;

  for (let index = 0; index < candidate.steps.length; index++) {
    const stepResult = validateTrajectoryStep(candidate.steps[index], `${path}.steps[${index}]`);
    if (!stepResult.ok) return stepResult;
    const step = stepResult.value;

    if (step.step !== index + 1) {
      return fail(
        'step_out_of_order',
        `step at index ${index} carries ordinal ${step.step}; expected ${index + 1} (steps are strictly sequential from 1)`,
        `${path}.steps[${index}].step`,
      );
    }
    if (seenStepIds.has(step.step_id)) {
      return fail('duplicate_step', `step id "${step.step_id}" is already recorded in this trajectory`, `${path}.steps[${index}].step_id`);
    }
    if (seenCausalityIds.has(step.causality_id)) {
      return fail(
        'duplicate_causality',
        `causality id "${step.causality_id}" is already recorded in this trajectory`,
        `${path}.steps[${index}].causality_id`,
      );
    }
    if (previousNow !== undefined && step.clock.now < previousNow) {
      return fail(
        'clock_regression',
        `step ${step.step} clock.now (${step.clock.now}) precedes the previous step's now (${previousNow}) — episode time is monotonic`,
        `${path}.steps[${index}].clock.now`,
      );
    }
    previousNow = step.clock.now;

    for (const observation of step.observations) {
      if (seenObservationIds.has(observation.observation_id)) {
        return fail(
          'duplicate_observation',
          `observation id "${observation.observation_id}" is already recorded in this trajectory`,
          `${path}.steps[${index}].observations`,
        );
      }
      seenObservationIds.add(observation.observation_id);
    }
    for (const action of step.actions) {
      if (seenActionIds.has(action.action_id)) {
        return fail('duplicate_action', `action id "${action.action_id}" is already recorded in this trajectory`, `${path}.steps[${index}].actions`);
      }
      seenActionIds.add(action.action_id);
    }
    for (const rejection of step.rejections) {
      if (seenActionIds.has(rejection.action.action_id)) {
        return fail(
          'duplicate_action',
          `action id "${rejection.action.action_id}" appears twice (accepted and/or rejected) — ids name experience events uniquely`,
          `${path}.steps[${index}].rejections`,
        );
      }
      seenActionIds.add(rejection.action.action_id);
    }
    for (const reward of step.rewards) {
      if (seenRewardIds.has(reward.reward_id)) {
        return fail('duplicate_reward', `reward id "${reward.reward_id}" is already recorded in this trajectory`, `${path}.steps[${index}].rewards`);
      }
      seenRewardIds.add(reward.reward_id);
    }

    seenStepIds.add(step.step_id);
    seenCausalityIds.add(step.causality_id);
    steps.push(step);
  }

  return ok(deepFreeze({ metadata: metadata as TrajectoryMetadata, steps }));
}

/**
 * Construct a trajectory from a metadata block and an (possibly empty) step
 * log. Both are validated; the append laws above are enforced across the
 * whole log. Returns the new record deeply frozen.
 */
export function createTrajectory(metadata: unknown, steps: readonly unknown[]): TrajResult<Trajectory> {
  const metadataResult = validateTrajectoryMetadata(metadata);
  if (!metadataResult.ok) return metadataResult;
  const validated = validateTrajectory({ metadata: metadataResult.value, steps });
  if (!validated.ok) return validated;
  return ok(validated.value);
}

/**
 * Append one step to a trajectory. Returns a NEW record (the original is
 * untouched — append-only discipline); enforces the four append laws from the
 * module header. The appended step's ordinal is taken as given and must equal
 * `steps.length + 1`.
 */
export function appendTrajectoryStep(trajectory: Trajectory, step: unknown): TrajResult<Trajectory> {
  const stepResult = validateTrajectoryStep(step);
  if (!stepResult.ok) return stepResult;
  const validStep = stepResult.value;

  if (!isTrajectory(trajectory)) {
    return fail('invalid_trajectory', 'appendTrajectoryStep requires a valid trajectory record');
  }

  const expectedOrdinal = trajectory.steps.length + 1;
  if (validStep.step !== expectedOrdinal) {
    return fail(
      'step_out_of_order',
      `appended step carries ordinal ${validStep.step}; expected ${expectedOrdinal} (the next step ordinal)`,
      'step.step',
    );
  }

  const lastStep: TrajectoryStep | undefined = trajectory.steps[trajectory.steps.length - 1];
  if (lastStep !== undefined && validStep.clock.now < lastStep.clock.now) {
    return fail(
      'clock_regression',
      `appended step clock.now (${validStep.clock.now}) precedes the previous step's now (${lastStep.clock.now}) — episode time is monotonic`,
      'step.clock.now',
    );
  }

  const observationIds = new Set<string>(trajectory.steps.flatMap((existing) => existing.observations.map((observation) => observation.observation_id)));
  for (const observation of validStep.observations) {
    if (observationIds.has(observation.observation_id)) {
      return fail(
        'duplicate_observation',
        `observation id "${observation.observation_id}" is already recorded in this trajectory`,
        'step.observations',
      );
    }
  }

  const actionIds = new Set<string>(
    trajectory.steps.flatMap((existing) => [
      ...existing.actions.map((action) => action.action_id),
      ...existing.rejections.map((rejection) => rejection.action.action_id),
    ]),
  );
  for (const action of validStep.actions) {
    if (actionIds.has(action.action_id)) {
      return fail('duplicate_action', `action id "${action.action_id}" is already recorded in this trajectory`, 'step.actions');
    }
  }
  for (const rejection of validStep.rejections) {
    if (actionIds.has(rejection.action.action_id)) {
      return fail(
        'duplicate_action',
        `action id "${rejection.action.action_id}" appears twice (accepted and/or rejected) — ids name experience events uniquely`,
        'step.rejections',
      );
    }
  }

  const rewardIds = new Set<string>(trajectory.steps.flatMap((existing) => existing.rewards.map((reward) => reward.reward_id)));
  for (const reward of validStep.rewards) {
    if (rewardIds.has(reward.reward_id)) {
      return fail('duplicate_reward', `reward id "${reward.reward_id}" is already recorded in this trajectory`, 'step.rewards');
    }
  }

  return ok(deepFreeze({ metadata: trajectory.metadata, steps: [...trajectory.steps, validStep] }));
}

/**
 * Replay the trajectory: the step sequence in recorded order. The identity
 * over the log, made an explicit operation so replay semantics (round-trips
 * through serialization, distributed hand-off in T014) have one canonical
 * entry point. The returned array is the record's own frozen log — a
 * trajectory's steps ARE its replay.
 */
export function replayTrajectory(trajectory: Trajectory): readonly TrajectoryStep[] {
  return trajectory.steps;
}
