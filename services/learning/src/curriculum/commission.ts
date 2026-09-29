/**
 * @tradrl/learning (service) — the commission records (T015).
 *
 * THE LAW THIS MODULE SERVES: Work Order T015 — "your stages emit the
 * COMMISSION records (experiment designs, episode job specs) — never run
 * them." Curriculum stages and self-play matchups SCHEDULE the native
 * learning loop (spec/ARCHITECTURE.md: "training -> trajectory ->
 * evaluation -> verification -> ... -> next experiment"): every planned
 * stage spawns ONE experiment (T011) whose episode batches run on the
 * compute layer (T014) driving the T013 trainer. This module builds those
 * commission records as PURE deterministic derivations — the curriculum
 * lane plans work, it never executes it (no network, no training).
 *
 * MIRROR DISCIPLINE (D-003/D-004) — the three mirrors this module owns:
 *
 *   - {@link ExperimentDesignMirror} — STRUCTURAL MIRROR of
 *     @tradrl/experiments' `ExperimentDesign` (T011): field-for-field,
 *     same brand tags, mutually assignable at compile time. The interop
 *     trip-wire test feeds this lane's golden commission through the REAL
 *     `validateExperimentDesign` and asserts it passes.
 *   - {@link EpisodeJobSpecMirror} (+ `JobLineageMirror`,
 *     `DriverConfigMirror`, `SeedRangeMirror`) — STRUCTURAL MIRROR of
 *     @tradrl/compute's `EpisodeJob` (T014): the L9/L12 lineage block
 *     (experiment, environment config, policy, reward models, tenant,
 *     project), the seed range, the arm, the step budget, the declared
 *     driver configuration (itself the T013 trainer-options mirror). The
 *     interop trip-wire feeds the golden job specs through the REAL
 *     `validateEpisodeJob`.
 *   - {@link TrialRecordMirror} (+ `TrialStatusMirror`) — STRUCTURAL
 *     MIRROR of @tradrl/experiments' `TrialRecord` (T011), status
 *     invariants included: a commission plans TRIALS (status `planned`,
 *     no evidence yet — a success without evidence is inexpressible).
 *     The interop trip-wire feeds the planned trials through the REAL
 *     `validateTrialRecord`.
 *
 * DETERMINISM (the work order's determinism law): every derived identity
 * is a pure FNV-1a function of the DECLARED identity sources —
 * experiment id from (goal, stage, curriculum version), job id from
 * (experiment, arm), seed base from (plan seed, experiment, arm), trial
 * id from (job, ordinal) — mirroring the compute lane's derivation
 * discipline (`deriveJobTrialId`). Same inputs -> byte-identical
 * commission records, twice, forever.
 *
 * L9 (reproducible lineage): the batch's jobs bind the experiment,
 * environment config, policy, reward models, tenant and project; the
 * design binds bodies, substrates, datasets, splits and the evaluator
 * version. L12: the lineage block carries tenant + project on every job.
 */

import {
  type CurriculumError,
  type CurriculumResult,
  type JsonObject,
  type TimestampMs,
  deepFreeze,
  fail,
  fnv1a32Hex,
  isJsonObject,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
} from './primitives';
import type {
  AgentInstanceId,
  ArmId,
  BodyVersionRef,
  CriteriaRef,
  CurriculumVersionRef,
  DataRef,
  EnvironmentConfigRef,
  EvaluatorVersionRef,
  ExperimentId,
  GoalRef,
  JobId,
  OrganizationId,
  PolicyRef,
  ProjectId,
  RewardModelRef,
  RuntimeRef,
  Seed,
  SplitPolicyRef,
  SubstrateRef,
  TenantId,
  TrajectoryId,
  TrialId,
} from './ids';
import {
  isAgentInstanceId,
  isArmId,
  isBodyVersionRef,
  isCriteriaRef,
  isDataRef,
  isEnvironmentConfigRef,
  isEvaluatorVersionRef,
  isExperimentId,
  isJobId,
  isOrganizationId,
  isPolicyRef,
  isProjectId,
  isRewardModelRef,
  isRuntimeRef,
  isSeed,
  isSplitPolicyRef,
  isSubstrateRef,
  isTenantId,
  isTrajectoryId,
  isTrialId,
} from './ids';
import {
  type CurriculumStageKind,
  type WorldMode,
  isCurriculumStageKind,
  isWorldMode,
  stagePosition,
} from './ladder';
import { type LearningMethodMirror, isLearningMethodMirror } from './gaps';

// ---------------------------------------------------------------------------
// The experiments-lane ExperimentDesign mirror (T011 — DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/** The role of a comparison arm — mirror of experiments' `ArmRole`. */
export type ArmRoleMirror = 'control' | 'treatment';

/** Runtime-checkable list of arm roles (mirror). */
export const ARM_ROLES_MIRROR: readonly ArmRoleMirror[] = deepFreeze(['control', 'treatment'] as const);

/** Guard: `ArmRoleMirror`. */
export function isArmRoleMirror(v: unknown): v is ArmRoleMirror {
  return typeof v === 'string' && (ARM_ROLES_MIRROR as readonly string[]).includes(v);
}

/** One comparison arm of the design — mirror of experiments' `ArmDescriptor`. */
export interface ArmDescriptorMirror {
  readonly arm: ArmId;
  readonly role: ArmRoleMirror;
  /** Human-readable statement of what this arm runs. */
  readonly description: string;
}

/** Guard: `ArmDescriptorMirror`. */
export function isArmDescriptorMirror(v: unknown): v is ArmDescriptorMirror {
  if (!isRecord(v)) return false;
  return isArmId(v.arm) && isArmRoleMirror(v.role) && isNonEmptyString(v.description);
}

/** The intervention under study — mirror of experiments' `InterventionDescriptor` (opaque kind + JSON parameters). */
export interface InterventionDescriptorMirror {
  /** Opaque intervention kind (this lane's: `curriculum-stage`, `self-play-matchup`). */
  readonly kind: string;
  /** Human-readable statement of the intervention. */
  readonly description: string;
  /** The intervention's configuration (JSON object; may be empty). */
  readonly parameters: JsonObject;
}

/** Guard: `InterventionDescriptorMirror`. */
export function isInterventionDescriptorMirror(v: unknown): v is InterventionDescriptorMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.kind) && isNonEmptyString(v.description) && isJsonObject(v.parameters);
}

/**
 * The experiment design — STRUCTURAL MIRROR of @tradrl/experiments'
 * `ExperimentDesign` (T011): hypothesis, intervention, comparison (>= 1
 * treatment arm, unique arm ids), splits, candidate organization,
 * producers, datasets, environment config and evaluator version (L9 —
 * the experiment binds its whole lineage before its first trial runs).
 */
export interface ExperimentDesignMirror {
  /** The falsifiable statement under test. Non-empty. */
  readonly hypothesis: string;
  /** What is being manipulated. */
  readonly intervention: InterventionDescriptorMirror;
  /** The comparison arms. Non-empty; at least one `treatment` arm; unique arm ids. */
  readonly comparison: readonly ArmDescriptorMirror[];
  /** Split policy refs (L11's in-search vs holdout discriminator). Non-empty. */
  readonly splits: readonly SplitPolicyRef[];
  /** The candidate organization under study (opaque). */
  readonly candidate_organization: OrganizationId;
  /** Body versions in play (non-empty — the experiment has producers). */
  readonly body_versions: readonly BodyVersionRef[];
  /** Substrates those bodies run on (non-empty). */
  readonly substrates: readonly SubstrateRef[];
  /** Datasets the design consumes (may be empty for generative-world experiments). */
  readonly datasets: readonly DataRef[];
  /** Versioned environment configuration. */
  readonly environment_config: EnvironmentConfigRef;
  /** Versioned evaluator that will score the trials (L9 — evaluation is part of lineage). */
  readonly evaluator_version: EvaluatorVersionRef;
}

/** Guard: `ExperimentDesignMirror` (the comparison invariants included). */
export function isExperimentDesignMirror(v: unknown): v is ExperimentDesignMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.hypothesis)) return false;
  if (!isInterventionDescriptorMirror(v.intervention)) return false;
  if (!Array.isArray(v.comparison) || v.comparison.length === 0) return false;
  const comparison = v.comparison as readonly unknown[];
  if (!comparison.every((arm) => isArmDescriptorMirror(arm))) return false;
  const arms = comparison.filter(isArmDescriptorMirror);
  if (!arms.some((arm) => arm.role === 'treatment')) return false;
  const armIds = arms.map((arm) => arm.arm);
  if (armIds.some((arm, index) => armIds.indexOf(arm) !== index)) return false;
  if (!Array.isArray(v.splits) || v.splits.length === 0) return false;
  if (!(v.splits as readonly unknown[]).every((ref) => isSplitPolicyRef(ref))) return false;
  if (!isOrganizationId(v.candidate_organization)) return false;
  if (!Array.isArray(v.body_versions) || v.body_versions.length === 0) return false;
  if (!(v.body_versions as readonly unknown[]).every((ref) => isBodyVersionRef(ref))) return false;
  if (!Array.isArray(v.substrates) || v.substrates.length === 0) return false;
  if (!(v.substrates as readonly unknown[]).every((ref) => isSubstrateRef(ref))) return false;
  if (!Array.isArray(v.datasets)) return false;
  if (!(v.datasets as readonly unknown[]).every((ref) => isDataRef(ref))) return false;
  if (!isEnvironmentConfigRef(v.environment_config)) return false;
  if (!isEvaluatorVersionRef(v.evaluator_version)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The compute-lane EpisodeJob mirror (T014 — DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/** A half-open range of episode ordinals `[start, end)` — mirror of compute's `SeedRange`. */
export interface SeedRangeMirror {
  readonly start: number;
  readonly end: number;
}

/** Guard: a well-formed, NON-EMPTY seed range (jobs carry work). */
export function isNonEmptySeedRangeMirror(v: unknown): v is SeedRangeMirror {
  if (!isRecord(v)) return false;
  const start = v.start;
  const end = v.end;
  if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0) return false;
  if (typeof end !== 'number' || !Number.isSafeInteger(end) || end < 0) return false;
  return end > start;
}

/**
 * The L9/L12 lineage block every commissioned job carries — mirror of
 * compute's `JobLineage`: the experiment this batch belongs to, the
 * versioned environment config the episodes drive, the versioned policy
 * script the workers run, the declared reward models (may be empty — L7),
 * and the tenant/project scope.
 */
export interface JobLineageMirror {
  readonly experiment: ExperimentId;
  readonly environment_config: EnvironmentConfigRef;
  readonly policy: PolicyRef;
  readonly reward_models: readonly RewardModelRef[];
  /** Tenant scope (L12 — tenant isolation). */
  readonly tenant: TenantId;
  /** Project continuity root (L15). */
  readonly project: ProjectId;
}

/** Guard: `JobLineageMirror` (reward-model refs duplicate-free — one model, one ref). */
export function isJobLineageMirror(v: unknown): v is JobLineageMirror {
  if (!isRecord(v)) return false;
  if (!isExperimentId(v.experiment)) return false;
  if (!isEnvironmentConfigRef(v.environment_config)) return false;
  if (!isPolicyRef(v.policy)) return false;
  if (!Array.isArray(v.reward_models)) return false;
  if (!(v.reward_models as readonly unknown[]).every((ref) => isRewardModelRef(ref))) return false;
  if ((v.reward_models as readonly unknown[]).some((ref, index, all) => all.indexOf(ref) !== index)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  return true;
}

/**
 * The declared driver configuration — mirror of compute's `DriverConfig`,
 * itself the T013 `ReferenceTrainerOptions` mirror: the acting agent
 * instance, the step cadence, the runtime ref, the producer sets the
 * trajectory metadata law requires, and the dataset refs.
 */
export interface DriverConfigMirror {
  readonly actor: AgentInstanceId;
  /** Positive safe integer of epoch milliseconds per driving step. */
  readonly step_ms: number;
  readonly runtime: RuntimeRef;
  /** Non-empty: an experience stream has producers. */
  readonly body_versions: readonly BodyVersionRef[];
  /** Non-empty: bodies run on substrates. */
  readonly substrates: readonly SubstrateRef[];
  /** Dataset refs the runs consume (may be empty). */
  readonly data?: readonly DataRef[];
}

/** Guard: `DriverConfigMirror`. */
export function isDriverConfigMirror(v: unknown): v is DriverConfigMirror {
  if (!isRecord(v)) return false;
  if (!isAgentInstanceId(v.actor)) return false;
  if (typeof v.step_ms !== 'number' || !Number.isSafeInteger(v.step_ms) || v.step_ms < 1) return false;
  if (!isRuntimeRef(v.runtime)) return false;
  if (!Array.isArray(v.body_versions) || v.body_versions.length === 0) return false;
  if (!(v.body_versions as readonly unknown[]).every((ref) => isBodyVersionRef(ref))) return false;
  if (!Array.isArray(v.substrates) || v.substrates.length === 0) return false;
  if (!(v.substrates as readonly unknown[]).every((ref) => isSubstrateRef(ref))) return false;
  if (v.data !== undefined && !Array.isArray(v.data)) return false;
  if (v.data !== undefined && !(v.data as readonly unknown[]).every((ref) => isDataRef(ref))) return false;
  return true;
}

/**
 * The commissioned episode batch — STRUCTURAL MIRROR of @tradrl/compute's
 * `EpisodeJob` (T014): one declared batch of one experiment arm. The
 * compute layer executes these; the curriculum lane only emits them.
 */
export interface EpisodeJobSpecMirror {
  readonly job_id: JobId;
  /** The L9/L12 lineage block. */
  readonly lineage: JobLineageMirror;
  /** The comparison arm this batch's trials execute. */
  readonly arm: ArmId;
  /** The master seed: every episode seed derives from (seed_base, job id, ordinal). */
  readonly seed_base: Seed;
  /** The episode ordinals this job generates: non-empty `[start, end)`. */
  readonly seed_range: SeedRangeMirror;
  /** The per-episode step budget (the T013 driver budget law). */
  readonly step_budget: number;
  /** The declared driver configuration (T013 trainer mirrors). */
  readonly driver: DriverConfigMirror;
}

/** Guard: `EpisodeJobSpecMirror`. */
export function isEpisodeJobSpecMirror(v: unknown): v is EpisodeJobSpecMirror {
  if (!isRecord(v)) return false;
  if (!isJobId(v.job_id)) return false;
  if (!isJobLineageMirror(v.lineage)) return false;
  if (!isArmId(v.arm)) return false;
  if (!isSeed(v.seed_base)) return false;
  if (!isNonEmptySeedRangeMirror(v.seed_range)) return false;
  if (typeof v.step_budget !== 'number' || !Number.isSafeInteger(v.step_budget) || v.step_budget < 1) return false;
  if (!isDriverConfigMirror(v.driver)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The experiments-lane TrialRecord mirror (T011 — DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/** The closed trial status vocabulary — mirror of experiments' `TrialStatus`. */
export type TrialStatusMirror = 'planned' | 'running' | 'succeeded' | 'failed' | 'rejected';

/** Runtime-checkable list of trial statuses (mirror). */
export const TRIAL_STATUSES_MIRROR: readonly TrialStatusMirror[] = deepFreeze(['planned', 'running', 'succeeded', 'failed', 'rejected'] as const);

/** Guard: a trial status (mirror). */
export function isTrialStatusMirror(v: unknown): v is TrialStatusMirror {
  return typeof v === 'string' && (TRIAL_STATUSES_MIRROR as readonly string[]).includes(v);
}

/**
 * One trial of an experiment — STRUCTURAL MIRROR of experiments'
 * `TrialRecord` (T011), status invariants included: a success without
 * evidence is inexpressible; an unexplained failure is not auditable; a
 * rejected trial never ran. A COMMISSION plans trials (`planned` — no
 * evidence yet); the compute layer's execution and the evaluator's
 * verdicts progress them (never this lane).
 */
export interface TrialRecordMirror {
  readonly trial_id: TrialId;
  readonly arm: ArmId;
  readonly status: TrialStatusMirror;
  /** The trajectory this trial produced (REQUIRED for `succeeded`). */
  readonly trajectory: TrajectoryId | null;
  /** Opaque outcome summary (REQUIRED for `succeeded`). */
  readonly outcome: JsonObject | null;
  readonly started_at: TimestampMs | null;
  readonly ended_at: TimestampMs | null;
  /** REQUIRED for `failed` and `rejected` — an unexplained failure is not auditable. */
  readonly failure_reason: string | null;
}

/** Guard: `TrialRecordMirror` (the full status-invariant law mirrored). */
export function isTrialRecordMirror(v: unknown): v is TrialRecordMirror {
  if (!isRecord(v)) return false;
  if (!isTrialId(v.trial_id)) return false;
  if (!isArmId(v.arm)) return false;
  if (!isTrialStatusMirror(v.status)) return false;
  if (v.trajectory !== null && !isTrajectoryId(v.trajectory)) return false;
  if (v.outcome !== null && !isJsonObject(v.outcome)) return false;
  if (v.started_at !== null && !isTimestampMs(v.started_at)) return false;
  if (v.ended_at !== null && !isTimestampMs(v.ended_at)) return false;
  if (v.failure_reason !== null && !isNonEmptyString(v.failure_reason)) return false;

  switch (v.status) {
    case 'planned':
      return v.started_at === null && v.ended_at === null && v.failure_reason === null;
    case 'running':
      return v.started_at !== null && v.ended_at === null && v.failure_reason === null;
    case 'succeeded':
      return (
        v.started_at !== null &&
        v.ended_at !== null &&
        v.ended_at >= v.started_at &&
        v.failure_reason === null &&
        v.trajectory !== null &&
        v.outcome !== null
      );
    case 'failed':
      return (
        v.ended_at !== null &&
        v.failure_reason !== null &&
        (v.started_at === null || v.ended_at >= v.started_at)
      );
    case 'rejected':
      return v.ended_at !== null && v.failure_reason !== null && v.started_at === null && v.trajectory === null;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Deterministic identity derivations (the FNV-1a discipline)
// ---------------------------------------------------------------------------

/**
 * The declared derivation of a stage's experiment id:
 * `exp-<fnv1a32(goal|stage|curriculum_version)>` — deterministic, so the
 * experiment a stage spawns is a pure function of (goal, stage, version):
 * the same plan commissions the same experiment, byte-identically (L9).
 */
export function deriveStageExperimentId(goal: GoalRef, stage: CurriculumStageKind, version: CurriculumVersionRef): ExperimentId {
  return `exp-${fnv1a32Hex(`${goal}|${stage}|${version}`)}` as ExperimentId;
}

/**
 * The declared derivation of a commissioned job id:
 * `job-<fnv1a32(experiment|arm)>` — one job per (experiment, arm), the
 * compute lane's work-unit identity discipline.
 */
export function deriveJobId(experiment: ExperimentId, arm: ArmId): JobId {
  return `job-${fnv1a32Hex(`${experiment}|${arm}`)}` as JobId;
}

/**
 * The declared derivation of a job's seed base:
 * `seedcur-<fnv1a32(plan_seed|experiment|arm)>` — the plan's master seed
 * flows into every commissioned batch deterministically (no ambient
 * randomness anywhere).
 */
export function deriveJobSeedBase(planSeed: Seed, experiment: ExperimentId, arm: ArmId): Seed {
  return `seedcur-${fnv1a32Hex(`${planSeed}|${experiment}|${arm}`)}` as Seed;
}

/**
 * The declared derivation of one commissioned trial's id:
 * `trial-<fnv1a32(job|ordinal)>` — mirrors the compute lane's
 * `deriveJobTrialId` discipline exactly (distributed identity source:
 * job + ordinal), so the trials this commission PLANS are the same
 * identities the compute layer's aggregate will fold (L9 — identities
 * agree by construction).
 */
export function commissionedTrialId(job: JobId, ordinal: number): TrialId {
  return `trial-${fnv1a32Hex(`${job}|${ordinal}`)}` as TrialId;
}

// ---------------------------------------------------------------------------
// The stage commission configuration (what a version declares per stage)
// ---------------------------------------------------------------------------

/**
 * The commission parameters a curriculum version declares for one stage:
 * the L6 world mode, the versioned environment config ref, the
 * advancement criteria refs (T012 — the evidence gate cites these), the
 * evaluator version and splits (L9 — evaluation is part of lineage), the
 * policy and reward models the batch declares, the driver configuration
 * (T013 mirrors), and the batch shape (episodes per arm, step budget).
 */
export interface StageCommissionConfig {
  /** The L6 world-mode declaration (must satisfy the stage's fidelity claim — ladder.ts). */
  readonly world_mode: WorldMode;
  /** Versioned environment configuration the stage's episodes drive. */
  readonly environment_config: EnvironmentConfigRef;
  /** The advancement criteria refs the stage's attainment verdict must satisfy (T012 citations). */
  readonly advancement_criteria: readonly CriteriaRef[];
  /** Versioned evaluator that scores the stage's trials (L9). */
  readonly evaluator_version: EvaluatorVersionRef;
  /** Split policy refs of the stage's experiment design (non-empty). */
  readonly splits: readonly SplitPolicyRef[];
  /** The versioned policy script the stage's workers run. */
  readonly policy: PolicyRef;
  /** The declared reward models (L7 — may be empty). */
  readonly reward_models: readonly RewardModelRef[];
  /** The declared driver configuration (T013 trainer mirrors). */
  readonly driver: DriverConfigMirror;
  /** The per-episode step budget (positive safe integer). */
  readonly step_budget: number;
  /** The episode batch size per arm (positive safe integer). */
  readonly episodes_per_arm: number;
}

/** Guard: `StageCommissionConfig`. */
export function isStageCommissionConfig(v: unknown): v is StageCommissionConfig {
  if (!isRecord(v)) return false;
  if (!isWorldMode(v.world_mode)) return false;
  if (!isEnvironmentConfigRef(v.environment_config)) return false;
  if (!Array.isArray(v.advancement_criteria) || v.advancement_criteria.length === 0) return false;
  if (!(v.advancement_criteria as readonly unknown[]).every((ref) => isCriteriaRef(ref))) return false;
  if (!isEvaluatorVersionRef(v.evaluator_version)) return false;
  if (!Array.isArray(v.splits) || v.splits.length === 0) return false;
  if (!(v.splits as readonly unknown[]).every((ref) => isSplitPolicyRef(ref))) return false;
  if (!isPolicyRef(v.policy)) return false;
  if (!Array.isArray(v.reward_models)) return false;
  if (!(v.reward_models as readonly unknown[]).every((ref) => isRewardModelRef(ref))) return false;
  if ((v.reward_models as readonly unknown[]).some((ref, index, all) => all.indexOf(ref) !== index)) return false;
  if (!isDriverConfigMirror(v.driver)) return false;
  if (typeof v.step_budget !== 'number' || !Number.isSafeInteger(v.step_budget) || v.step_budget < 1) return false;
  if (typeof v.episodes_per_arm !== 'number' || !Number.isSafeInteger(v.episodes_per_arm) || v.episodes_per_arm < 1) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The commissioned batch (one experiment + its job specs)
// ---------------------------------------------------------------------------

/**
 * One stage's (or matchup's) commission: the experiment id, the experiment
 * design mirror (T011), and the episode job specs (T014) that run its
 * arms. The commission is a VALUE: deeply frozen, byte-deterministic,
 * never executed here.
 */
export interface CommissionedBatch {
  readonly experiment: ExperimentId;
  readonly design: ExperimentDesignMirror;
  readonly jobs: readonly EpisodeJobSpecMirror[];
}

/** Guard: `CommissionedBatch`. */
export function isCommissionedBatch(v: unknown): v is CommissionedBatch {
  if (!isRecord(v)) return false;
  if (!isExperimentId(v.experiment)) return false;
  if (!isExperimentDesignMirror(v.design)) return false;
  if (!Array.isArray(v.jobs) || v.jobs.length === 0) return false;
  if (!(v.jobs as readonly unknown[]).every((job) => isEpisodeJobSpecMirror(job))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The stage commission builder (pure, deterministic)
// ---------------------------------------------------------------------------

/** The context a stage commission derives from (all explicit — no ambient state). */
export interface StageCommissionContext {
  readonly goal: GoalRef;
  readonly stage: CurriculumStageKind;
  readonly version: CurriculumVersionRef;
  readonly method: LearningMethodMirror;
  readonly config: StageCommissionConfig;
  readonly candidate: OrganizationId;
  readonly plan_seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/**
 * Commission one stage's experiment + episode batches — the pure
 * derivation the planner calls per planned stage:
 *
 *   - experiment id: `deriveStageExperimentId(goal, stage, version)`;
 *   - design: the falsifiable hypothesis ("the candidate organization
 *     attains the stage's advancement criteria in the declared world"),
 *     a `curriculum-stage` intervention carrying (stage, world mode,
 *     method, curriculum version) as STRUCTURED parameters, a
 *     control/treatment comparison, the version-declared splits and the
 *     L9 producer/evaluator lineage;
 *   - jobs: one batch per arm — control ordinals `[0, N)`, treatment
 *     ordinals `[N, 2N)` (one experiment's batch, zero overlap — the
 *     compute lane's law), seed bases derived from the plan seed.
 *
 * Same context -> byte-identical batch (the determinism law). The batch
 * is validated before it is returned (a commission that could not run is
 * not a commission).
 */
export function commissionStageBatch(context: StageCommissionContext): CurriculumResult<CommissionedBatch> {
  const errors: CurriculumError[] = [];
  if (!isRecord(context)) {
    return fail('invalid_type', 'the stage commission context must be an object');
  }
  const goal = context.goal;
  const stage = context.stage;
  const version = context.version;
  const method = context.method;
  const config = context.config;
  const candidate = context.candidate;
  const planSeed = context.plan_seed;
  const tenant = context.tenant;
  const project = context.project;

  if (!isNonEmptyString(goal)) errors.push({ code: 'lineage_gap', path: 'goal', message: 'the commission context must cite the goal ref (L15)' });
  if (!isCurriculumStageKind(stage)) {
    errors.push({ code: 'stage_unknown', path: 'stage', message: 'the commission context must name a ladder stage' });
  }
  if (!isNonEmptyString(version)) errors.push({ code: 'lineage_gap', path: 'version', message: 'the commission context must cite the curriculum version ref (L9)' });
  if (!isLearningMethodMirror(method)) errors.push({ code: 'method_unknown', path: 'method', message: 'the commission context must name a LEARNING-LOOP method' });
  if (!isStageCommissionConfig(config)) {
    errors.push({ code: 'invalid_field', path: 'config', message: 'the stage commission configuration failed its guard' });
  }
  if (!isOrganizationId(candidate)) errors.push({ code: 'invalid_field', path: 'candidate', message: 'the commission context must name the candidate organization' });
  if (!isSeed(planSeed)) errors.push({ code: 'invalid_field', path: 'plan_seed', message: 'the commission context must carry the plan seed' });
  if (!isTenantId(tenant)) errors.push({ code: 'tenant_missing', path: 'tenant', message: 'the commission context must carry the tenant (L12)' });
  if (!isProjectId(project)) errors.push({ code: 'tenant_missing', path: 'project', message: 'the commission context must carry the project (L15)' });
  if (errors.length > 0) return { ok: false, errors };
  if (!isCurriculumStageKind(stage) || !isStageCommissionConfig(config)) {
    return { ok: false, errors: [{ code: 'invalid_field', path: 'context', message: 'the commission context is not validatable (stage or config malformed)' }] };
  }

  const experiment = deriveStageExperimentId(goal, stage, version);
  const episodes = config.episodes_per_arm;
  const controlArm = 'arm-control' as ArmId;
  const treatmentArm = 'arm-treatment' as ArmId;
  const position = stagePosition(stage);

  const design: ExperimentDesignMirror = {
    hypothesis: `Curriculum stage "${stage}" (rung ${position + 1} of 9, ${version}): the candidate organization attains the stage's advancement criteria in an honestly-declared "${config.world_mode}" world under method "${method}".`,
    intervention: {
      kind: 'curriculum-stage',
      description: `Training under curriculum stage "${stage}" of ${version} (ladder rung ${position + 1}).`,
      parameters: {
        stage,
        world_mode: config.world_mode,
        method,
        curriculum_version: version,
      },
    },
    comparison: [
      { arm: controlArm, role: 'control', description: `The candidate organization in the "${stage}" world without the stage's training intervention.` },
      { arm: treatmentArm, role: 'treatment', description: `The candidate organization trained under the stage's "${method}" intervention in the "${stage}" world.` },
    ],
    splits: [...config.splits],
    candidate_organization: candidate,
    body_versions: [...config.driver.body_versions],
    substrates: [...config.driver.substrates],
    datasets: config.driver.data === undefined ? [] : [...config.driver.data],
    environment_config: config.environment_config,
    evaluator_version: config.evaluator_version,
  };

  const lineage: JobLineageMirror = {
    experiment,
    environment_config: config.environment_config,
    policy: config.policy,
    reward_models: [...config.reward_models],
    tenant,
    project,
  };

  const controlJob: EpisodeJobSpecMirror = {
    job_id: deriveJobId(experiment, controlArm),
    lineage,
    arm: controlArm,
    seed_base: deriveJobSeedBase(planSeed, experiment, controlArm),
    seed_range: { start: 0, end: episodes },
    step_budget: config.step_budget,
    driver: config.driver,
  };
  const treatmentJob: EpisodeJobSpecMirror = {
    job_id: deriveJobId(experiment, treatmentArm),
    lineage,
    arm: treatmentArm,
    seed_base: deriveJobSeedBase(planSeed, experiment, treatmentArm),
    seed_range: { start: episodes, end: episodes * 2 },
    step_budget: config.step_budget,
    driver: config.driver,
  };

  const batch: CommissionedBatch = deepFreeze({
    experiment,
    design: deepFreeze(design),
    jobs: deepFreeze([controlJob, treatmentJob]),
  });
  const validated = validateCommissionedBatch(batch);
  if (!validated.ok) return validated;
  return { ok: true, value: batch };
}

// ---------------------------------------------------------------------------
// Commission validation (defense in depth — the trip-wire tests re-run the
// REAL experiments/compute validators over the same records)
// ---------------------------------------------------------------------------

/**
 * Deep validation of a commissioned batch: the design guard, every job
 * guard, and the CROSS-RECORD laws — every job's lineage names THIS
 * experiment, every job's arm exists in the design's comparison, every
 * job's environment config is the design's, and the jobs' seed ranges
 * never overlap (one experiment's batch — the compute lane's law).
 */
export function validateCommissionedBatch(v: unknown, path = 'commission'): CurriculumResult<CommissionedBatch> {
  if (!isRecord(v)) {
    return fail('invalid_type', `${path} must be an object`, path);
  }
  const errors: CurriculumError[] = [];
  if (!isExperimentId(v.experiment)) {
    errors.push({ code: 'invalid_id', path: `${path}.experiment`, message: 'the commissioned experiment id must be a non-empty string' });
  }
  if (!isExperimentDesignMirror(v.design)) {
    errors.push({ code: 'invalid_field', path: `${path}.design`, message: 'the commissioned experiment design failed the experiments-lane mirror guard' });
  }
  if (!Array.isArray(v.jobs) || v.jobs.length === 0) {
    errors.push({ code: 'invalid_field', path: `${path}.jobs`, message: 'a commission plans at least one episode batch' });
    return { ok: false, errors };
  }

  const jobs: EpisodeJobSpecMirror[] = [];
  const seenJobs = new Set<string>();
  (v.jobs as readonly unknown[]).forEach((entry, index) => {
    if (!isEpisodeJobSpecMirror(entry)) {
      errors.push({ code: 'invalid_field', path: `${path}.jobs[${index}]`, message: 'the episode job spec failed the compute-lane mirror guard' });
      return;
    }
    const job = entry;
    if (seenJobs.has(job.job_id)) {
      errors.push({ code: 'invalid_field', path: `${path}.jobs[${index}].job_id`, message: `duplicate job id "${job.job_id}"` });
      return;
    }
    seenJobs.add(job.job_id);
    if (isExperimentId(v.experiment) && job.lineage.experiment !== v.experiment) {
      errors.push({
        code: 'lineage_mismatch',
        path: `${path}.jobs[${index}].lineage.experiment`,
        message: `job "${job.job_id}" names experiment "${job.lineage.experiment}" but the commission is experiment "${v.experiment}"`,
      });
    }
    const designConfig = isExperimentDesignMirror(v.design) ? v.design.environment_config : null;
    if (designConfig !== null && job.lineage.environment_config !== designConfig) {
      errors.push({
        code: 'lineage_mismatch',
        path: `${path}.jobs[${index}].lineage.environment_config`,
        message: `job "${job.job_id}" declares a different environment config than the design it belongs to (L9)`,
      });
    }
    if (isExperimentDesignMirror(v.design)) {
      const design = v.design;
      const armKnown = design.comparison.some((arm) => arm.arm === job.arm);
      if (!armKnown) {
        errors.push({
          code: 'lineage_mismatch',
          path: `${path}.jobs[${index}].arm`,
          message: `job "${job.job_id}" executes arm "${job.arm}" which is not in the design's comparison`,
        });
      }
    }
    jobs.push(job);
  });

  // Seed ranges of one experiment's batch never overlap (the compute law).
  const byRange: { job: EpisodeJobSpecMirror; index: number }[] = jobs.map((job, index) => ({ job, index }));
  for (let left = 0; left < byRange.length; left++) {
    for (let right = left + 1; right < byRange.length; right++) {
      const a = byRange[left].job.seed_range;
      const b = byRange[right].job.seed_range;
      if (a.start < b.end && b.start < a.end) {
        errors.push({
          code: 'invalid_field',
          path: `${path}.jobs[${byRange[right].index}].seed_range`,
          message: `job "${byRange[right].job.job_id}" overlaps job "${byRange[left].job.job_id}" — one experiment's episode ordinals never overlap`,
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze({ experiment: v.experiment as ExperimentId, design: v.design as ExperimentDesignMirror, jobs }) };
}

// ---------------------------------------------------------------------------
// The planned trials of a commissioned job
// ---------------------------------------------------------------------------

/**
 * The trials a commissioned job PLANS: one `planned` {@link
 * TrialRecordMirror} per episode ordinal of the job's seed range, trial
 * ids derived by the compute lane's discipline (job + ordinal). A
 * commission plans evidence slots — it never fabricates outcomes (L7:
 * acceptance is the evaluation lane's business; a planned trial carries
 * no evidence at all).
 */
export function commissionedTrials(job: EpisodeJobSpecMirror): readonly TrialRecordMirror[] {
  const trials: TrialRecordMirror[] = [];
  for (let ordinal = job.seed_range.start; ordinal < job.seed_range.end; ordinal++) {
    trials.push({
      trial_id: commissionedTrialId(job.job_id, ordinal),
      arm: job.arm,
      status: 'planned',
      trajectory: null,
      outcome: null,
      started_at: null,
      ended_at: null,
      failure_reason: null,
    });
  }
  return deepFreeze(trials);
}
