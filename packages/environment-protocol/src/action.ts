/**
 * @tradrl/environment-protocol — the action envelope.
 *
 * An Action is a REQUEST, never a command (L8: execution authority lives
 * outside model prompts — and outside this envelope). The actor asks the
 * environment to do something; the environment records the request and, in
 * a later step, hands back RESULTS as observations (fills, acks, rejections
 * ride the observation channel with their own `available_time`). The
 * environment NEVER grants authority through this type: `submitAction`
 * performs envelope validation and per-actor ordering only — authorization,
 * limits and venue permissions are hard controls owned elsewhere (L20).
 *
 * The action-side time law (the causal mirror of L4's inclusive boundary):
 * `submitted_at <= episode.now` — an action may not claim to have been
 * submitted after the episode's current simulated instant. `submitted_at ==
 * now` is legal (inclusive). Enforcement lives in the `submitAction`
 * transition (episode.ts), not in the envelope validator — the validator is
 * timeless, exactly like the observation validator.
 *
 * `client_sequence` is the per-actor, per-episode request ordinal. It must
 * be strictly increasing across ACCEPTED actions of the same actor: the
 * environment rejects a sequence that is not greater than the actor's last
 * accepted one (`stale_sequence`). This gives request ordering and replay
 * ordering without the protocol endorsing any payload semantics.
 */

import { deepFreeze, isNonNegativeSafeInteger, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type EnvError, type EnvResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { ActionId, AgentInstanceId } from './ids';
import { isJsonValue, type JsonValue } from './json';

/**
 * The action request envelope (spec/DOMAIN-MODEL.md: Trajectory's "actions";
 * the request twin of {@link Observation}).
 */
export interface Action {
  /** Opaque unique identifier within the episode. */
  readonly action_id: ActionId;
  /** The acting agent instance (opaque cross-lane reference — the environment never models the actor's internals). */
  readonly actor: AgentInstanceId;
  /** The instant the action claims submission at. MUST be `<= episode.now` at accept time (causal law). */
  readonly submitted_at: TimestampMs;
  /** Per-actor request ordinal; strictly increasing across the actor's accepted actions in this episode. */
  readonly client_sequence: number;
  /** The opaque request payload. JSON-safe by contract; semantics owned by the world (T009/T010). */
  readonly payload: JsonValue;
}

/** Runtime type guard for a structurally valid action envelope. */
export function isAction(value: unknown): value is Action {
  if (!isRecord(value)) return false;
  if (typeof value.action_id !== 'string' || value.action_id.length === 0) return false;
  if (typeof value.actor !== 'string' || value.actor.length === 0) return false;
  if (!isTimestampMs(value.submitted_at)) return false;
  if (!isNonNegativeSafeInteger(value.client_sequence)) return false;
  if (!isJsonValue(value.payload)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted action envelope. Every violation is
 * reported with a dotted path; on success the value is returned narrowed,
 * deeply frozen. Timeless: no comparison against "now" happens here.
 */
export function validateAction(value: unknown, path = 'action'): EnvResult<Action> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: EnvError[] = [];

  if (value.action_id === undefined) {
    errors.push(missingField(`${path}.action_id`));
  } else if (typeof value.action_id !== 'string' || value.action_id.length === 0) {
    errors.push(invalidField(`${path}.action_id`, 'must be a non-empty string'));
  }

  if (value.actor === undefined) {
    errors.push(missingField(`${path}.actor`));
  } else if (typeof value.actor !== 'string' || value.actor.length === 0) {
    errors.push(invalidField(`${path}.actor`, 'must be a non-empty string'));
  }

  if (value.submitted_at === undefined) {
    errors.push(missingField(`${path}.submitted_at`));
  } else if (!isTimestampMs(value.submitted_at)) {
    errors.push(
      invalidField(`${path}.submitted_at`, 'must be an integer epoch-ms number within the representable range'),
    );
  }

  if (value.client_sequence === undefined) {
    errors.push(missingField(`${path}.client_sequence`));
  } else if (!isNonNegativeSafeInteger(value.client_sequence)) {
    errors.push(invalidField(`${path}.client_sequence`, 'must be a non-negative safe integer'));
  }

  if (value.payload === undefined) {
    errors.push(missingField(`${path}.payload`));
  } else if (!isJsonValue(value.payload)) {
    errors.push(invalidField(`${path}.payload`, 'must be a JSON value (finite numbers only, no undefined/functions)'));
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      action_id: value.action_id as ActionId,
      actor: value.actor as AgentInstanceId,
      submitted_at: value.submitted_at as TimestampMs,
      client_sequence: value.client_sequence as number,
      payload: value.payload as JsonValue,
    }),
  );
}
