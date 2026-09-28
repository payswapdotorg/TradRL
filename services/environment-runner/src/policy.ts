/**
 * @tradrl/environment-runner — the pluggable Policy.
 *
 * A Policy is a PURE function from the agent's current information set to
 * action proposals: `observations -> actions` (the work order's contract).
 * Purity is the runner's determinism guarantee (L9): the same spec + seed +
 * policy produces a byte-identical step trace, twice.
 *
 * The policy receives the FULL visible observation set at the step's `now`
 * (the agent's information set, point-in-time policed by the environment).
 * Policies that want a window or a projection filter it themselves — the
 * runner never filters on the policy's behalf, because filtering IS a
 * policy decision.
 *
 * The policy proposes; the RUNNER mints the action envelopes (deterministic
 * ids, sequences, submitted_at = now) and the ENVIRONMENT decides. Nothing
 * here grants execution authority (L8).
 */

import { isJsonValue, isNonEmptyString, isRecord } from '../../../packages/environment-protocol/src/index';
import type { EpisodeId, JsonValue, Observation, TimestampMs } from '../../../packages/environment-protocol/src/index';

/** Everything a policy may condition on — its whole legitimate information set. */
export interface PolicyInput {
  /** The episode being driven. */
  readonly episode_id: EpisodeId;
  /** The 1-based step number. */
  readonly step: number;
  /** The instant the step observes at (the episode clock's `now`). */
  readonly now: TimestampMs;
  /** The observations visible at `now` (inclusive L4 boundary, environment-policed). */
  readonly observations: readonly Observation[];
}

/**
 * One action proposal: an opaque label plus an opaque JSON payload. The
 * reference runner mints the action envelope as
 * `payload = { kind, body }` — a documented convention world implementers
 * (T009/T010) match when they decode action requests.
 */
export interface PolicyProposal {
  readonly kind: string;
  readonly payload: JsonValue;
}

/**
 * A pure policy: `PolicyInput -> proposals`. Must be side-effect free; the
 * runner calls it once per step.
 */
export type Policy = (input: PolicyInput) => readonly PolicyProposal[];

/** Runtime guard for a policy input record. */
export function isPolicyInput(value: unknown): value is PolicyInput {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.episode_id)) return false;
  if (typeof value.step !== 'number' || !Number.isSafeInteger(value.step) || value.step < 1) return false;
  if (typeof value.now !== 'number' || !Number.isInteger(value.now) || value.now < 0) return false;
  if (!Array.isArray(value.observations)) return false;
  return true;
}

/** Runtime guard for a policy proposal. */
export function isPolicyProposal(value: unknown): value is PolicyProposal {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.kind) && isJsonValue(value.payload);
}

/** Runtime guard for a policy (any function with the policy signature). */
export function isPolicy(value: unknown): value is Policy {
  return typeof value === 'function';
}
