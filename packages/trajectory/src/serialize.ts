/**
 * @tradrl/trajectory — deterministic canonical serialization.
 *
 * Reproducibility (L9) needs a canonical form: {@link serializeTrajectory}
 * serializes a validated trajectory with recursively sorted object keys, so
 * equal records always produce byte-identical canonical JSON regardless of
 * field order at construction — "same record, same bytes". The canonical
 * JSON rules are the mirror of T005's `canonicalJson` (spec.ts):
 *
 *   - object keys recursively sorted (code-unit order);
 *   - arrays in order (order is MEANING in a trajectory — steps, and the
 *     within-step orders, are never sorted);
 *   - strings via `JSON.stringify`, finite numbers via `String`.
 *
 * {@link parseTrajectory} is the inverse: parse, then full validation
 * (metadata lineage completeness + every step + cross-step laws), returning
 * the deeply frozen record. `serialize(parse(serialize(t))) === serialize(t)`
 * for every valid record (round-trip property, tested).
 */

import type { JsonValue } from './primitives';
import { fail, ok, type TrajResult } from './errors';
import type { Trajectory } from './trajectory';
import { validateTrajectory } from './trajectory';
import type { TrajectoryMetadata } from './metadata';
import type { ActionRecord, ClockSample, ObservationRef, RejectionRecord, RewardSignalRecord, TrajectoryStep } from './step';

/**
 * Canonical JSON serialization of any JSON value: object keys recursively
 * sorted (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values always serialize
 * byte-identically. Mirror of T005's canonicalJson (same rules — the
 * canonical form is a program-wide law, not a package choice).
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value); // finite by the JSON model
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const object = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

/** JSON-tree projection of a clock sample (compile-proven JSON safety). */
function clockTree(clock: ClockSample): JsonValue {
  return {
    now: clock.now,
    asOf: clock.asOf,
    playbackSpeed: clock.playbackSpeed,
    paused: clock.paused,
    fidelity: clock.fidelity,
    informationPolicy: clock.informationPolicy,
  };
}

/** JSON-tree projection of a step (compile-proven JSON safety, no casts). */
function stepTree(step: TrajectoryStep): JsonValue {
  const observations: JsonValue[] = step.observations.map((observation: ObservationRef): JsonValue => ({
    observation_id: observation.observation_id,
    available_time: observation.available_time,
  }));
  const actions: JsonValue[] = step.actions.map((action: ActionRecord): JsonValue => ({
    action_id: action.action_id,
    actor: action.actor,
    submitted_at: action.submitted_at,
    client_sequence: action.client_sequence,
    payload: action.payload,
  }));
  const rejections: JsonValue[] = step.rejections.map((rejection: RejectionRecord): JsonValue => ({
    action: {
      action_id: rejection.action.action_id,
      actor: rejection.action.actor,
      submitted_at: rejection.action.submitted_at,
      client_sequence: rejection.action.client_sequence,
      payload: rejection.action.payload,
    },
    errors: rejection.errors.map((error): JsonValue => ({ code: error.code, path: error.path, message: error.message })),
  }));
  const rewards: JsonValue[] = step.rewards.map((reward: RewardSignalRecord): JsonValue => ({
    reward_id: reward.reward_id,
    at: reward.at,
    available_time: reward.available_time,
    value: reward.value,
    metric: reward.metric,
    source: reward.source,
    detail: reward.detail,
  }));
  return {
    step: step.step,
    step_id: step.step_id,
    observations,
    actions,
    rejections,
    rewards,
    tool_outcomes: [...step.tool_outcomes],
    environment_result: step.environment_result,
    clock: clockTree(step.clock),
    causality_id: step.causality_id,
  };
}

/** JSON-tree projection of the metadata block (compile-proven JSON safety). */
function metadataTree(metadata: TrajectoryMetadata): JsonValue {
  return {
    trajectory_id: metadata.trajectory_id,
    tenant: metadata.tenant,
    project: metadata.project,
    episode: metadata.episode,
    environment_config: metadata.environment_config,
    runtime: metadata.runtime,
    data: [...metadata.data],
    body_versions: [...metadata.body_versions],
    substrates: [...metadata.substrates],
  };
}

/**
 * Canonical JSON of a validated trajectory. Equal records produce identical
 * bytes — the serialization anchor for L9 (T014 ships trajectories across
 * processes; T034 persists them; both need byte-stable identity).
 */
export function serializeTrajectory(trajectory: Trajectory): string {
  const tree: JsonValue = {
    metadata: metadataTree(trajectory.metadata),
    steps: trajectory.steps.map((step) => stepTree(step)),
  };
  return canonicalJson(tree);
}

/**
 * Parse and validate serialized trajectory JSON. Full validation runs on the
 * parsed value (untrusted input law): a syntactically valid but
 * lineage-incomplete or law-violating payload is rejected with typed errors.
 */
export function parseTrajectory(json: string): TrajResult<Trajectory> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse failure';
    return fail('invalid_json', `input is not valid JSON: ${message}`);
  }
  return validateTrajectory(parsed);
}
