/**
 * @tradrl/rl-protocol — the RewardModel discipline (ARCHITECTURE-LOCK L7).
 *
 * L7 ("constraint-aware evaluation: raw PnL is insufficient") has TWO halves
 * in TradRL, and this module is the bridge's half:
 *
 *   1. The Environment/World emits ZERO reward signals by design (the replay
 *      world never emits any — spec/ARCHITECTURE.md Evaluation: "Acceptance
 *      is objective-and-constraint based"; services/market-world/README.md
 *      T013 row). The world channel is never touched here.
 *   2. The bridge's OWN rewards are EXPLICIT DECLARATIONS: a pure, versioned
 *      function record — {@link RewardModel} = RewardModelRef + declared
 *      inputs + deterministic transform + metadata — applied POST-HOC to the
 *      RECORDED trajectory (T011's canonical step shapes). Every signal the
 *      bridge emits carries its {@link RewardModelRef}; a signal without a
 *      declared model is a TYPED ERROR (`reward_model_mismatch` /
 *      `invalid_reward`), never a silent default. Fabrication is
 *      inexpressible in the type.
 *
 * Rewards are DATA, never verdicts: this module computes and annotates
 * nothing but scalar records. Acceptance belongs to evaluation (T012) —
 * rewards are never the sole criterion (L7), and nothing here interprets a
 * value as PnL.
 *
 * Determinism (L9): the same trajectory + the same models produce the
 * byte-identical annotated stream — reward ids are minted from
 * (model_ref, trajectory_id, step ordinal, claim index) and every iteration
 * order is fixed. The transform is a PURE function by contract; the
 * reference models (services/learning) demonstrate the discipline.
 *
 * Input discipline: a model DECLARES which trajectory-step fields it
 * consumes (the closed {@link RewardInputKey} union — exactly the fields of
 * the canonical TrajectoryStep). The attach machinery builds each scope
 * from the declared fields ONLY, and every reward CLAIM self-reports the
 * inputs it derived from (`input_keys`): a claim reporting an input the
 * model did not declare fails with `undeclared_reward_input` (typed,
 * negative-tested). The declaration is the boundary; the bridge polices it.
 */

import { deepFreeze, isFiniteNumber, isJsonObject, isNonEmptyString, isRecord } from './primitives';
import type { JsonObject } from './primitives';
import { fnv1a32Hex } from './primitives';
import { fail, invalidField, invalidType, missingField, ok, type RLError, type RLResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { CausalityId, EnvironmentResultRef, RewardModelRef, RewardId, StepId, ToolOutcomeRef, TrajectoryId } from './ids';
import { isCausalityId, isEnvironmentResultRef, isRewardModelRef, isRewardId, isToolOutcomeRef, isTrajectoryId } from './ids';
import type {
  ActionRecord,
  ClockSample,
  ObservationRef,
  RejectionRecord,
  RewardSignalRecord,
  Trajectory,
  TrajectoryMetadata,
  TrajectoryStep,
} from './traj-mirror';
import {
  isActionRecord,
  isClockSample,
  isObservationRef,
  isRejectionRecord,
  isRewardSignalRecord,
  isTrajectoryMetadata,
  isTrajectoryStep,
  validateTrajectory,
} from './traj-mirror';

// ---------------------------------------------------------------------------
// The closed input-key union (exactly the canonical TrajectoryStep fields)
// ---------------------------------------------------------------------------

/**
 * One consumable field of the canonical trajectory step. The union is
 * CLOSED: it enumerates the fields of `@tradrl/trajectory`'s `TrajectoryStep`
 * (mirrored in traj-mirror.ts) — a model that needs anything else needs a
 * taxonomy change, not a string typo.
 */
export type RewardInputKey =
  | 'step_id'
  | 'observations'
  | 'actions'
  | 'rejections'
  | 'rewards'
  | 'tool_outcomes'
  | 'environment_result'
  | 'clock'
  | 'causality_id';

/** Runtime-checkable list of reward input keys, for guards and diagnostics. */
export const REWARD_INPUT_KEYS: readonly RewardInputKey[] = [
  'step_id',
  'observations',
  'actions',
  'rejections',
  'rewards',
  'tool_outcomes',
  'environment_result',
  'clock',
  'causality_id',
];

/** Runtime guard for a reward input key. */
export function isRewardInputKey(value: unknown): value is RewardInputKey {
  return typeof value === 'string' && (REWARD_INPUT_KEYS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The reward scope (the declared-inputs view over one mirrored step)
// ---------------------------------------------------------------------------

/**
 * Everything a reward transform may condition on: the record identity plus
 * EXACTLY the declared inputs (a field is present iff its key was declared —
 * the declaration is the boundary, the attach machinery enforces it). The
 * scope is deeply frozen before the transform runs.
 */
export interface RewardScope {
  /** The trajectory the annotation runs over. */
  readonly trajectory_id: TrajectoryId;
  /** The step ordinal (1-based) the scope projects. */
  readonly step: number;
  /** Present iff 'step_id' declared. */
  readonly step_id?: StepId;
  /** Present iff 'observations' declared. */
  readonly observations?: readonly ObservationRef[];
  /** Present iff 'actions' declared. */
  readonly actions?: readonly ActionRecord[];
  /** Present iff 'rejections' declared. */
  readonly rejections?: readonly RejectionRecord[];
  /** Present iff 'rewards' declared (the WORLD-emitted channel). */
  readonly rewards?: readonly RewardSignalRecord[];
  /** Present iff 'tool_outcomes' declared. */
  readonly tool_outcomes?: readonly ToolOutcomeRef[];
  /** Present iff 'environment_result' declared (may be null — the step's field is nullable). */
  readonly environment_result?: EnvironmentResultRef | null;
  /** Present iff 'clock' declared. */
  readonly clock?: ClockSample;
  /** Present iff 'causality_id' declared. */
  readonly causality_id?: CausalityId;
}

/** Runtime guard for a reward scope (identity always; present fields valid). */
export function isRewardScope(value: unknown): value is RewardScope {
  if (!isRecord(value)) return false;
  if (!isTrajectoryId(value.trajectory_id)) return false;
  if (typeof value.step !== 'number' || !Number.isSafeInteger(value.step) || value.step < 1) return false;
  if (value.step_id !== undefined && typeof value.step_id !== 'string') return false;
  if (value.observations !== undefined) {
    if (!Array.isArray(value.observations) || !value.observations.every((observation) => isObservationRef(observation))) return false;
  }
  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions) || !value.actions.every((action) => isActionRecord(action))) return false;
  }
  if (value.rejections !== undefined) {
    if (!Array.isArray(value.rejections) || !value.rejections.every((rejection) => isRejectionRecord(rejection))) return false;
  }
  if (value.rewards !== undefined) {
    if (!Array.isArray(value.rewards) || !value.rewards.every((reward) => isRewardSignalRecord(reward))) return false;
  }
  if (value.tool_outcomes !== undefined) {
    if (!Array.isArray(value.tool_outcomes) || !value.tool_outcomes.every((ref) => isToolOutcomeRef(ref))) return false;
  }
  if (value.environment_result !== undefined && value.environment_result !== null && !isEnvironmentResultRef(value.environment_result))
    return false;
  if (value.clock !== undefined && !isClockSample(value.clock)) return false;
  if (value.causality_id !== undefined && typeof value.causality_id !== 'string') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Reward claims (the transform's output — self-reporting its inputs)
// ---------------------------------------------------------------------------

/**
 * One reward computation RESULT, as declared by the transform: the instants
 * the reward pertains to and may be observed at, the finite scalar, an
 * opaque metric label, optional structured detail, and the INPUT KEYS the
 * claim derived from (policed against the model's declared inputs —
 * `undeclared_reward_input` on violation). The bridge mints the durable
 * {@link RewardModelSignal} from the claim; the claim itself is data.
 */
export interface RewardClaim {
  /** The instant the reward pertains to (the effect instant). */
  readonly at: TimestampMs;
  /** Earliest instant the signal may legitimately be observed (L4, inclusive; `>= at`). */
  readonly available_time: TimestampMs;
  /** Finite scalar; may be negative or zero. */
  readonly value: number;
  /** Opaque metric label. */
  readonly metric: string;
  /** Optional structured detail. */
  readonly detail: JsonObject | null;
  /** Non-empty; every member must be among the model's declared inputs. */
  readonly input_keys: readonly RewardInputKey[];
}

/** Runtime guard for a reward claim. */
export function isRewardClaim(value: unknown): value is RewardClaim {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.at) || !isTimestampMs(value.available_time)) return false;
  if (!isFiniteNumber(value.value)) return false;
  if (!isNonEmptyString(value.metric)) return false;
  if (value.detail !== null && !isJsonObject(value.detail)) return false;
  if (!Array.isArray(value.input_keys) || value.input_keys.length === 0) return false;
  if (!value.input_keys.every((key) => isRewardInputKey(key))) return false;
  if ((value.available_time as number) < (value.at as number)) return false;
  return true;
}

/** Collect-all validation of an untrusted reward claim. */
export function validateRewardClaim(value: unknown, path = 'claim'): RLResult<RewardClaim> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RLError[] = [];
  if (value.at === undefined) {
    errors.push(missingField(`${path}.at`));
  } else if (!isTimestampMs(value.at)) {
    errors.push(invalidField(`${path}.at`, 'must be a valid TimestampMs'));
  }
  if (value.available_time === undefined) {
    errors.push(missingField(`${path}.available_time`));
  } else if (!isTimestampMs(value.available_time)) {
    errors.push(invalidField(`${path}.available_time`, 'must be a valid TimestampMs'));
  }
  if (value.value === undefined) {
    errors.push(missingField(`${path}.value`));
  } else if (!isFiniteNumber(value.value)) {
    errors.push(invalidField(`${path}.value`, 'must be a finite number'));
  }
  if (value.metric === undefined) {
    errors.push(missingField(`${path}.metric`));
  } else if (!isNonEmptyString(value.metric)) {
    errors.push(invalidField(`${path}.metric`, 'must be a non-empty string'));
  }
  if (value.detail === undefined) {
    errors.push(missingField(`${path}.detail`));
  } else if (value.detail !== null && !isJsonObject(value.detail)) {
    errors.push(invalidField(`${path}.detail`, 'must be a JSON object or null'));
  }
  if (value.input_keys === undefined) {
    errors.push(missingField(`${path}.input_keys`));
  } else if (!Array.isArray(value.input_keys) || value.input_keys.length === 0) {
    errors.push(invalidField(`${path}.input_keys`, 'must be a non-empty array of reward input keys'));
  } else {
    (value.input_keys as readonly unknown[]).forEach((key, index) => {
      if (!isRewardInputKey(key)) {
        errors.push(invalidField(`${path}.input_keys[${index}]`, `must be one of ${REWARD_INPUT_KEYS.join(' | ')}`));
      }
    });
  }
  if (
    errors.length === 0 &&
    isTimestampMs(value.at) &&
    isTimestampMs(value.available_time) &&
    (value.available_time as number) < (value.at as number)
  ) {
    errors.push(
      invalidField(
        `${path}.available_time`,
        `available_time (${String(value.available_time)}) may not precede at (${String(value.at)}) — a reward about an instant cannot be observed before that instant`,
      ),
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return ok(
    deepFreeze({
      at: value.at as TimestampMs,
      available_time: value.available_time as TimestampMs,
      value: value.value as number,
      metric: value.metric as string,
      detail: value.detail as JsonObject | null,
      input_keys: (value.input_keys as readonly RewardInputKey[]).slice(),
    }),
  );
}

// ---------------------------------------------------------------------------
// The RewardModel declaration
// ---------------------------------------------------------------------------

/**
 * A PURE reward transform: `RewardScope -> claims`. Contract: total (never
 * throws — a throwing or non-array-returning transform is a typed
 * `invalid_reward_model` failure), side-effect free, deterministic (the same
 * scope yields the same claims — L9 byte-determinism). The reference models
 * in services/learning demonstrate the discipline.
 */
export type RewardTransform = (scope: RewardScope) => readonly RewardClaim[];

/**
 * An explicit, versioned, pure reward model declaration (the bridge's half
 * of L7 — see module header). `model_ref` is the versioned identity every
 * emitted signal carries; `declared_inputs` is the closed set of
 * trajectory-step fields the transform consumes; `metadata` is opaque,
 * JSON-safe provenance for the declaration.
 */
export interface RewardModel {
  readonly model_ref: RewardModelRef;
  /** Non-empty, duplicate-free list of trajectory-step input keys. */
  readonly declared_inputs: readonly RewardInputKey[];
  readonly transform: RewardTransform;
  readonly metadata: JsonObject;
}

/** Runtime guard for a RewardModel declaration (shape-level). */
export function isRewardModel(value: unknown): value is RewardModel {
  if (!isRecord(value)) return false;
  if (!isRewardModelRef(value.model_ref)) return false;
  if (!Array.isArray(value.declared_inputs) || value.declared_inputs.length === 0) return false;
  if (!(value.declared_inputs as readonly unknown[]).every((key) => isRewardInputKey(key))) return false;
  if (typeof value.transform !== 'function') return false;
  if (!isJsonObject(value.metadata)) return false;
  return true;
}

/**
 * Collect-all validation of a RewardModel declaration. On success the value
 * is returned narrowed (the transform function is carried as-is; deepFreeze
 * passes functions through untouched).
 */
export function validateRewardModel(value: unknown, path = 'reward_model'): RLResult<RewardModel> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RLError[] = [];
  if (value.model_ref === undefined) {
    errors.push(missingField(`${path}.model_ref`));
  } else if (!isRewardModelRef(value.model_ref)) {
    errors.push(invalidField(`${path}.model_ref`, 'must be a non-empty versioned reward model ref'));
  }
  if (value.declared_inputs === undefined) {
    errors.push(missingField(`${path}.declared_inputs`));
  } else if (!Array.isArray(value.declared_inputs) || value.declared_inputs.length === 0) {
    errors.push(invalidField(`${path}.declared_inputs`, 'must be a non-empty array of reward input keys'));
  } else {
    const keys = value.declared_inputs as readonly unknown[];
    keys.forEach((key, index) => {
      if (!isRewardInputKey(key)) {
        errors.push(invalidField(`${path}.declared_inputs[${index}]`, `must be one of ${REWARD_INPUT_KEYS.join(' | ')}`));
      }
    });
    if (keys.some((key, index) => keys.indexOf(key) !== index)) {
      errors.push(invalidField(`${path}.declared_inputs`, 'must be duplicate-free — an input is declared once'));
    }
  }
  if (value.transform === undefined) {
    errors.push(missingField(`${path}.transform`));
  } else if (typeof value.transform !== 'function') {
    errors.push(invalidField(`${path}.transform`, 'must be a pure function (RewardScope -> claims)'));
  }
  if (value.metadata === undefined) {
    errors.push(missingField(`${path}.metadata`));
  } else if (!isJsonObject(value.metadata)) {
    errors.push(invalidField(`${path}.metadata`, 'must be a JSON object'));
  }
  if (errors.length > 0) return { ok: false, errors };
  return ok(
    deepFreeze({
      model_ref: value.model_ref as RewardModelRef,
      declared_inputs: (value.declared_inputs as readonly RewardInputKey[]).slice(),
      transform: value.transform as RewardTransform,
      metadata: value.metadata as JsonObject,
    }),
  );
}

// ---------------------------------------------------------------------------
// The RewardModelSignal (the L7 record — every signal carries its ref)
// ---------------------------------------------------------------------------

/**
 * A bridge-emitted reward signal: the canonical world-channel record
 * EXTENDED with `model_ref` (extension only, never mutation — the record
 * still satisfies the canonical `RewardSignalRecord` guard, so annotated
 * steps satisfy the REAL trajectory mirrors; proven in interop tests).
 * `source` is minted as `reward-model:<ref>` — no orphan rewards: the
 * producing component is always named (L7 + the envelope's source law).
 */
export interface RewardModelSignal extends RewardSignalRecord {
  /** The declared RewardModel that produced this signal (REQUIRED — L7). */
  readonly model_ref: RewardModelRef;
}

/**
 * Runtime guard for a reward model signal. THE L7 TRIP WIRE: a signal
 * without a declared {@link RewardModelRef} fails this guard — fabricating a
 * reward with no declared model is inexpressible.
 */
export function isRewardModelSignal(value: unknown): value is RewardModelSignal {
  if (!isRewardSignalRecord(value)) return false;
  if (!isRecord(value)) return false;
  return isRewardModelRef(value.model_ref);
}

/**
 * Collect-all validation of an untrusted reward model signal. The L7 law is
 * enforced field-by-field: a missing or empty `model_ref` is a typed
 * `reward_model_mismatch` failure, never a silent default.
 */
export function validateRewardModelSignal(value: unknown, path = 'model_reward'): RLResult<RewardModelSignal> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RLError[] = [];
  if (value.reward_id === undefined) {
    errors.push(missingField(`${path}.reward_id`));
  } else if (!isRewardId(value.reward_id)) {
    errors.push(invalidField(`${path}.reward_id`, 'must be a non-empty string'));
  }
  if (value.at === undefined) {
    errors.push(missingField(`${path}.at`));
  } else if (!isTimestampMs(value.at)) {
    errors.push(invalidField(`${path}.at`, 'must be a valid TimestampMs'));
  }
  if (value.available_time === undefined) {
    errors.push(missingField(`${path}.available_time`));
  } else if (!isTimestampMs(value.available_time)) {
    errors.push(invalidField(`${path}.available_time`, 'must be a valid TimestampMs'));
  }
  if (value.value === undefined) {
    errors.push(missingField(`${path}.value`));
  } else if (!isFiniteNumber(value.value)) {
    errors.push(invalidField(`${path}.value`, 'must be a finite number'));
  }
  if (value.metric === undefined) {
    errors.push(missingField(`${path}.metric`));
  } else if (!isNonEmptyString(value.metric)) {
    errors.push(invalidField(`${path}.metric`, 'must be a non-empty string'));
  }
  if (value.source === undefined) {
    errors.push(missingField(`${path}.source`));
  } else if (!isNonEmptyString(value.source)) {
    errors.push(invalidField(`${path}.source`, 'must be a non-empty string — no orphan rewards'));
  }
  if (value.detail === undefined) {
    errors.push(missingField(`${path}.detail`));
  } else if (value.detail !== null && !isJsonObject(value.detail)) {
    errors.push(invalidField(`${path}.detail`, 'must be a JSON object or null'));
  }
  if (value.model_ref === undefined) {
    errors.push({
      code: 'reward_model_mismatch',
      path: `${path}.model_ref`,
      message: 'a reward signal without a declared RewardModelRef is inexpressible (L7 — rewards are never fabricated)',
    });
  } else if (!isRewardModelRef(value.model_ref)) {
    errors.push({
      code: 'reward_model_mismatch',
      path: `${path}.model_ref`,
      message: 'must be a non-empty versioned reward model ref (L7 — every signal names its declared model)',
    });
  }
  if (
    errors.length === 0 &&
    isTimestampMs(value.at) &&
    isTimestampMs(value.available_time) &&
    (value.available_time as number) < (value.at as number)
  ) {
    errors.push(
      invalidField(
        `${path}.available_time`,
        `available_time (${String(value.available_time)}) may not precede at (${String(value.at)}) — a reward about an instant cannot be observed before that instant`,
      ),
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return ok(
    deepFreeze({
      reward_id: value.reward_id as RewardId,
      at: value.at as TimestampMs,
      available_time: value.available_time as TimestampMs,
      value: value.value as number,
      metric: value.metric as string,
      source: value.source as string,
      detail: value.detail as JsonObject | null,
      model_ref: value.model_ref as RewardModelRef,
    }),
  );
}

// ---------------------------------------------------------------------------
// The annotated stream
// ---------------------------------------------------------------------------

/**
 * One step of the reward-annotated stream: the canonical step record
 * EXTENDED with `model_rewards` — the bridge-emitted signals for this step,
 * each carrying its {@link RewardModelRef}. The world channel (`rewards`)
 * and the model channel (`model_rewards`) stay SEPARATE: world-emitted
 * rewards are never rewritten, bridge rewards are never smuggled into the
 * world channel (L7's two halves never mix).
 */
export interface RewardAnnotatedStep extends TrajectoryStep {
  readonly model_rewards: readonly RewardModelSignal[];
}

/** Runtime guard for a reward-annotated step. */
export function isRewardAnnotatedStep(value: unknown): value is RewardAnnotatedStep {
  if (!isRecord(value)) return false;
  if (!isTrajectoryStep(value)) return false;
  if (!Array.isArray(value.model_rewards)) return false;
  if (!(value.model_rewards as readonly unknown[]).every((reward) => isRewardModelSignal(reward))) return false;
  return true;
}

/**
 * The reward-annotated trajectory: the canonical record's metadata and steps
 * (world channel untouched) plus the model channel and the list of applied
 * model refs. Deeply frozen; deterministically constructed (same inputs,
 * same bytes).
 */
export interface RewardAnnotatedTrajectory {
  readonly metadata: TrajectoryMetadata;
  readonly steps: readonly RewardAnnotatedStep[];
  /** The model refs whose transforms ran over this stream, in application order. */
  readonly applied_models: readonly RewardModelRef[];
}

/** Runtime guard for a reward-annotated trajectory. */
export function isRewardAnnotatedTrajectory(value: unknown): value is RewardAnnotatedTrajectory {
  if (!isRecord(value)) return false;
  if (!isTrajectoryMetadata(value.metadata)) return false;
  if (!Array.isArray(value.steps)) return false;
  if (!(value.steps as readonly unknown[]).every((step) => isRewardAnnotatedStep(step))) return false;
  if (!Array.isArray(value.applied_models)) return false;
  if (!(value.applied_models as readonly unknown[]).every((ref) => isRewardModelRef(ref))) return false;
  return true;
}

/**
 * The L7 predicate: every model-channel signal in the stream carries a
 * declared RewardModelRef. Consumers (and tests) assert this over any
 * annotated stream — a single orphan fails the whole predicate.
 */
export function everySignalCarriesModelRef(stream: RewardAnnotatedTrajectory): boolean {
  return stream.steps.every((step) => step.model_rewards.every((reward) => isRewardModelSignal(reward)));
}

// ---------------------------------------------------------------------------
// attachRewardSignals — the post-hoc annotation
// ---------------------------------------------------------------------------

/** Build the declared-inputs scope over one mirrored step (pure). */
function scopeFor(trajectoryId: TrajectoryId, step: TrajectoryStep, declared: ReadonlySet<RewardInputKey>): RewardScope {
  const scope: RewardScope = {
    trajectory_id: trajectoryId,
    step: step.step,
    ...(declared.has('step_id') ? { step_id: step.step_id } : {}),
    ...(declared.has('observations') ? { observations: step.observations } : {}),
    ...(declared.has('actions') ? { actions: step.actions } : {}),
    ...(declared.has('rejections') ? { rejections: step.rejections } : {}),
    ...(declared.has('rewards') ? { rewards: step.rewards } : {}),
    ...(declared.has('tool_outcomes') ? { tool_outcomes: step.tool_outcomes } : {}),
    ...(declared.has('environment_result') ? { environment_result: step.environment_result } : {}),
    ...(declared.has('clock') ? { clock: step.clock } : {}),
    ...(declared.has('causality_id') ? { causality_id: step.causality_id } : {}),
  };
  return deepFreeze(scope);
}

/**
 * Attach reward models to a RECORDED trajectory (post-hoc — L7: the bridge
 * never touches the world channel). For every step, in recorded order, every
 * model's transform runs over a scope built from EXACTLY its declared
 * inputs; every claim is validated (shape + the `undeclared_reward_input`
 * boundary law) and minted into a {@link RewardModelSignal} with a
 * deterministic id.
 *
 * Failures are typed and atomic: an invalid trajectory, an invalid model,
 * duplicate model refs, a throwing/shape-invalid transform output, an
 * undeclared claim input or a duplicate minted reward id all fail the whole
 * annotation with a single precise cause — partial annotation is never
 * returned (a reward stream that lies about its coverage is worse than no
 * stream).
 */
export function attachRewardSignals(trajectory: unknown, models: readonly unknown[]): RLResult<RewardAnnotatedTrajectory> {
  const recordResult = validateTrajectory(trajectory);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;

  const validatedModels: RewardModel[] = [];
  const seenRefs = new Set<string>();
  for (let index = 0; index < models.length; index++) {
    const modelResult = validateRewardModel(models[index], `models[${index}]`);
    if (!modelResult.ok) return modelResult;
    const model = modelResult.value;
    if (seenRefs.has(model.model_ref)) {
      return fail(
        'invalid_reward_model',
        `reward model "${model.model_ref}" is declared twice — one model, one ref, one pass over the stream`,
        `models[${index}].model_ref`,
      );
    }
    seenRefs.add(model.model_ref);
    validatedModels.push(model);
  }

  const applied: RewardModelRef[] = validatedModels.map((model) => model.model_ref);
  const seenRewardIds = new Set<string>();
  const annotatedSteps: RewardAnnotatedStep[] = [];

  for (const step of record.steps) {
    const modelRewards: RewardModelSignal[] = [];
    for (const model of validatedModels) {
      const declared = new Set<RewardInputKey>(model.declared_inputs);
      const scope = scopeFor(record.metadata.trajectory_id, step, declared);

      let claims: unknown;
      try {
        claims = model.transform(scope);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown transform failure';
        return fail(
          'invalid_reward_model',
          `reward model "${model.model_ref}" threw on step ${step.step} (transforms are pure and total by contract): ${message}`,
          `models.applied.${model.model_ref}`,
        );
      }
      if (!Array.isArray(claims)) {
        return fail(
          'invalid_reward_model',
          `reward model "${model.model_ref}" returned a non-array on step ${step.step} (transforms return readonly RewardClaim[])`,
          `models.applied.${model.model_ref}`,
        );
      }

      for (let claimIndex = 0; claimIndex < claims.length; claimIndex++) {
        const claimResult = validateRewardClaim(claims[claimIndex], `models.applied.${model.model_ref}.claims[${claimIndex}]`);
        if (!claimResult.ok) return claimResult;
        const claim = claimResult.value;

        // The declaration boundary: a claim may derive only from declared inputs.
        for (const key of claim.input_keys) {
          if (!declared.has(key)) {
            return fail(
              'undeclared_reward_input',
              `reward model "${model.model_ref}" claims input "${key}" on step ${step.step} but declared only [${model.declared_inputs.join(', ')}] — the declaration is the boundary`,
              `models.applied.${model.model_ref}.claims[${claimIndex}].input_keys`,
            );
          }
        }

        const rewardId = `rm-${fnv1a32Hex(`${model.model_ref}|${record.metadata.trajectory_id}|${step.step}|${claimIndex}`)}` as RewardId;
        if (seenRewardIds.has(rewardId)) {
          return fail(
            'duplicate_reward',
            `reward id "${rewardId}" is already present in the annotated stream — ids name reward events uniquely`,
            `models.applied.${model.model_ref}.claims[${claimIndex}]`,
          );
        }
        seenRewardIds.add(rewardId);

        const signal: RewardModelSignal = deepFreeze({
          reward_id: rewardId,
          at: claim.at,
          available_time: claim.available_time,
          value: claim.value,
          metric: claim.metric,
          source: `reward-model:${model.model_ref}`,
          detail: claim.detail,
          model_ref: model.model_ref,
        });
        // Total self-check: the minted signal must satisfy the L7 guard.
        const signalResult = validateRewardModelSignal(signal);
        if (!signalResult.ok) return signalResult;
        modelRewards.push(signalResult.value);
      }
    }
    annotatedSteps.push(deepFreeze({ ...step, model_rewards: modelRewards }));
  }

  return ok(deepFreeze({ metadata: record.metadata, steps: annotatedSteps, applied_models: applied }));
}
