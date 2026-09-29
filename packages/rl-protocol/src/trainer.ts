/**
 * @tradrl/rl-protocol — the TrainerContract and the injected ports.
 *
 * THE BRIDGE IS A PROTOCOL BRIDGE: pure data + pure functions over INJECTED
 * PORTS. This package ships NO world implementation and NO policy
 * implementation (the reference scripted fixtures live in
 * services/learning); concrete learning algorithms belong to external
 * engines behind these interfaces, and T014 (distributed episode
 * generation) / T015 (curriculum, self-play, populations) scale and
 * specialize on top.
 *
 * The contract (the work order's surface):
 *
 *   - `prepareRun(declaration)` — validate the declaration, open the
 *     append-only run state.
 *   - `driveEpisode(run, environment, policy)` — drive ONE episode through
 *     the deterministic EpisodeDriver over the five environment
 *     operations, recording the canonical step log into the run (the
 *     generic deterministic loop — NO method-specific gradient/math
 *     optimization anywhere: "drive -> record" is all a protocol bridge
 *     owns).
 *   - `collectTrial(run, evidence)` — bind the L9 lineage (including the
 *     world's run record) and emit the experiments-lane trial record
 *     ("reward -> bind lineage -> emit trial": reward attachment happens
 *     post-hoc through reward.ts, evaluation decides acceptance — L7).
 *
 * The POLICY port is deliberately narrow: `propose(input) -> proposals`,
 * where the input carries ONLY the cumulative delivered observation refs
 * (id + available_time — the L4 law again: a learner conditions on
 * references and availability, never on payloads it was not handed) plus
 * the driving instant. The ENVIRONMENT port is env-mirror's
 * {@link EnvironmentPort}.
 */

import { isRecord } from './primitives';
import type { JsonObject } from './primitives';
import { fail, ok, type RLResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { ArmId, EpisodeId, TrajectoryId, TrialId } from './ids';
import { isArmId, isEpisodeId, isTrajectoryId, isTrialId } from './ids';
import type { EnvironmentPort } from './env-mirror';
import { isEnvironmentPort } from './env-mirror';
import type { ObservationRef } from './traj-mirror';
import { isObservationRef } from './traj-mirror';
import type { PolicyProposal } from './driver';
import { isPolicyProposal } from './driver';
import type { TrainingRunState } from './run';
import { isTrainingRunState } from './run';
import type { TrainerTrial } from './trial';

// ---------------------------------------------------------------------------
// The Policy PORT (injected — the learner's decision surface)
// ---------------------------------------------------------------------------

/**
 * Everything a policy may condition on — its whole legitimate information
 * set: the episode, the 1-based step ordinal, the driving instant, and the
 * CUMULATIVE delivered observation refs (first-delivery only; each carries
 * its own `available_time` — the L4 forensic input). Payloads are
 * structurally absent: the policy sees the world through the same boundary
 * everyone else does.
 */
export interface PolicyInput {
  readonly episode_id: EpisodeId;
  /** The 1-based step number the proposals will be recorded under. */
  readonly step: number;
  /** The instant the step observes at (the episode clock's `now`). */
  readonly now: TimestampMs;
  /** The cumulative delivered observation refs (the agent's information set). */
  readonly observations: readonly ObservationRef[];
}

/** Runtime guard for a policy input. */
export function isPolicyInput(value: unknown): value is PolicyInput {
  if (!isRecord(value)) return false;
  if (!isEpisodeId(value.episode_id)) return false;
  if (typeof value.step !== 'number' || !Number.isSafeInteger(value.step) || value.step < 1) return false;
  if (!isTimestampMs(value.now)) return false;
  if (!Array.isArray(value.observations)) return false;
  if (!(value.observations as readonly unknown[]).every((observation) => isObservationRef(observation))) return false;
  return true;
}

/**
 * The policy PORT: `propose(input) -> proposals`. Contract: PURE (the same
 * input yields the same proposals — the driver's determinism guarantee,
 * L9) and total (a throwing or shape-invalid proposal is a typed
 * `invalid_policy` failure). The trainer calls it once per step, AFTER the
 * observe; the driver mints and submits the envelopes.
 */
export interface PolicyPort {
  propose(input: PolicyInput): readonly PolicyProposal[];
}

/** Runtime guard for the PolicyPort surface. */
export function isPolicyPort(value: unknown): value is PolicyPort {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>).propose === 'function';
}

/** Validate a policy port's answer (shape-level; used by the reference trainer). */
export function validateProposals(value: unknown): RLResult<readonly PolicyProposal[]> {
  if (!Array.isArray(value)) {
    return fail('invalid_policy', 'the policy port must return an array of proposals');
  }
  for (const proposal of value) {
    if (!isPolicyProposal(proposal)) {
      return fail('invalid_policy', 'every proposal must be { kind: non-empty string, payload: JSON value }');
    }
  }
  return ok(value as readonly PolicyProposal[]);
}

// ---------------------------------------------------------------------------
// The trial evidence (collectTrial's input — every instant explicit)
// ---------------------------------------------------------------------------

/**
 * The evidence a caller hands `collectTrial`. Every instant is an explicit
 * parameter (no ambient clock); the `world_record` is the world's
 * ReplayRunRecord-SHAPED value (untrusted — the lineage extractor guards
 * it); exactly one of `outcome` (succeeded) / `failure_reason` (failed)
 * must be present.
 */
export interface TrialEvidence {
  readonly trial_id: TrialId;
  /** The comparison arm this trial executed. */
  readonly arm: ArmId;
  /** The episode of the run whose experience this trial records. */
  readonly episode: EpisodeId;
  /** The trajectory ref (must equal the run's derived ref for that episode — L9 coherence). */
  readonly trajectory: TrajectoryId;
  /** REQUIRED for a succeeded trial (opaque — produced by evaluation, never fabricated here). */
  readonly outcome: JsonObject | null;
  /** REQUIRED for a failed trial — an unexplained failure is not auditable. */
  readonly failure_reason: string | null;
  readonly started_at: TimestampMs;
  readonly ended_at: TimestampMs;
  /** The world's run record (ReplayRunRecord-shaped, untrusted). */
  readonly world_record: unknown;
}

/** Runtime guard for trial evidence (shape-level). */
export function isTrialEvidence(value: unknown): value is TrialEvidence {
  if (!isRecord(value)) return false;
  if (!isTrialId(value.trial_id)) return false;
  if (!isArmId(value.arm)) return false;
  if (!isEpisodeId(value.episode)) return false;
  if (!isTrajectoryId(value.trajectory)) return false;
  if (!isTimestampMs(value.started_at) || !isTimestampMs(value.ended_at)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The TrainerContract
// ---------------------------------------------------------------------------

/**
 * The interface a concrete trainer implements (the reference trainer in
 * services/learning; external engines and T014/T015 specializations behind
 * the same three operations). Implementations MUST:
 *   - keep `driveEpisode` deterministic given (run, environment, policy) —
 *     the driver owns that if the implementation composes it honestly;
 *   - keep the run state append-only (episodes append; nothing rewrites);
 *   - refuse to collect a trial from an unfinished run (`run_not_finished`)
 *     and to bind an incoherent lineage (`invalid_lineage`).
 */
export interface TrainerContract {
  /** Validate a declaration and open the append-only run state. */
  prepareRun(declaration: unknown): RLResult<TrainingRunState>;
  /** Drive ONE episode through the environment port under the policy port; record its steps. */
  driveEpisode(run: TrainingRunState, environment: EnvironmentPort, policy: PolicyPort): RLResult<TrainingRunState>;
  /** Bind the L9 lineage (world record included) and emit the experiments-lane trial. */
  collectTrial(run: TrainingRunState, evidence: TrialEvidence): RLResult<TrainerTrial>;
}

/** Runtime guard for the TrainerContract surface. */
export function isTrainerContract(value: unknown): value is TrainerContract {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.prepareRun === 'function' &&
    typeof candidate.driveEpisode === 'function' &&
    typeof candidate.collectTrial === 'function'
  );
}

/** Guard helper shared by contract implementations: environment + policy port shape. */
export function requirePorts(environment: unknown, policy: unknown): RLResult<true> {
  if (!isEnvironmentPort(environment)) {
    return fail('invalid_environment', 'driveEpisode requires a structurally valid EnvironmentPort (five operations)');
  }
  if (!isPolicyPort(policy)) {
    return fail('invalid_policy', 'driveEpisode requires a structurally valid PolicyPort (propose function)');
  }
  return ok(true);
}
