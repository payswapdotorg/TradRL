/**
 * @tradrl/learning (service) — the replayable run-state serialization.
 *
 * {@link serializeTrainingRunState} projects the run state to canonical
 * JSON (`tradrl/training-run-state@1`): the state is JSON-shaped by
 * construction (every constituent is a protocol record), so a JSON
 * round-trip guarded by `isJsonValue` yields the tree, and canonicalJson
 * (recursively sorted keys) makes equal states byte-identical — "same
 * record, same bytes" (L9).
 *
 * {@link resumeTrainingRunState} is the resume gate: parse, enforce the
 * schema marker, re-validate the whole state through the protocol's
 * structural guard (declaration + every episode + every step + chain
 * shape), re-freeze, and VERIFY THE STEP CHAIN — a tampered or partial
 * payload fails with typed errors (`invalid_serialization` /
 * `chain_mismatch`), never silently. A resumed run provably consumed the
 * same experience and continues appending onto the verified log.
 */

import {
  canonicalJson,
  deepFreeze,
  fail,
  isJsonValue,
  isRecord,
  isTrainingRunState,
  ok,
  verifyRunChain,
  type JsonValue,
  type RLResult,
  type TrainingRunState,
} from '../../../../packages/rl-protocol/src/index';

/** The run-state serialization schema marker (versioned with the driver protocol). */
export const TRAINING_RUN_STATE_SCHEMA = 'tradrl/training-run-state@1';

/**
 * Serialize a training run state to canonical JSON bytes. Deterministic:
 * equal states produce identical bytes (the resume artifact is portable
 * across processes — T014 ships them).
 */
export function serializeTrainingRunState(run: TrainingRunState): RLResult<string> {
  if (!isTrainingRunState(run)) {
    return fail('invalid_run_state', 'serializeTrainingRunState requires a valid training run state');
  }
  // The state is JSON-shaped by construction; the round-trip yields a fresh
  // tree the guard narrows (no casts) and canonicalJson orders.
  const roundTrip: unknown = JSON.parse(JSON.stringify(run));
  if (!isJsonValue(roundTrip)) {
    return fail('invalid_serialization', 'the run state did not survive the JSON round-trip (impossible by construction)');
  }
  const envelope: JsonValue = { schema: TRAINING_RUN_STATE_SCHEMA, run: roundTrip };
  return ok(canonicalJson(envelope));
}

/**
 * Resume a training run state from serialized bytes: parse, enforce the
 * schema, structurally re-validate (the protocol guard: declaration,
 * episodes, steps, chain shape, termination coherence), re-freeze, and
 * verify the step chain. Failures are typed:
 *   - `invalid_json` — unparseable bytes;
 *   - `invalid_serialization` — wrong schema marker or a structurally
 *     invalid state;
 *   - `chain_mismatch` — the recorded steps do not fold onto the recorded
 *     chain (tampered content — the resume gate's whole point).
 */
export function resumeTrainingRunState(bytes: string): RLResult<TrainingRunState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse failure';
    return fail('invalid_json', `the run state bytes are not valid JSON: ${message}`);
  }
  if (!isRecord(parsed)) {
    return fail('invalid_serialization', 'the run state envelope must be an object');
  }
  if (parsed.schema !== TRAINING_RUN_STATE_SCHEMA) {
    return fail(
      'invalid_serialization',
      `expected schema "${TRAINING_RUN_STATE_SCHEMA}", got ${JSON.stringify(parsed.schema)}`,
    );
  }
  const state: unknown = parsed.run;
  if (!isTrainingRunState(state)) {
    return fail('invalid_serialization', 'the parsed value fails the training run state guard (declaration, episodes, steps or chain shape)');
  }
  const verified = verifyRunChain(state);
  if (!verified.ok) return verified;
  // Re-freeze after the JSON thaw (the resume artifact re-enters the
  // frozen world).
  return ok(deepFreeze(state));
}
