/**
 * @tradrl/compute — the EpisodeJob: the unit of distributed work.
 *
 * Curriculum and population search (T015) need MANY episodes — far more
 * than one sequential loop can generate (spec/LEARNING-LOOP.md: steps 1-4
 * of the Curriculum need many episodes; spec/ARCHITECTURE.md Learning
 * plane: "population search and curriculum"). The job is the unit those
 * consumers spawn: ONE job declares ONE episode batch of ONE experiment arm
 * — the lineage block (L9/L12), the seed range the batch draws from, the
 * per-episode step budget, and the DECLARED driver configuration (the T013
 * trainer mirrors — distributed generation DRIVES the T013 contracts per
 * worker; this package scales the loop, it does not replace it).
 *
 * Laws enforced here:
 *   - L9 (reproducible lineage): every job carries the experiment ref, the
 *     environment config ref, the policy ref and the reward-model refs —
 *     a missing field is a typed `lineage_gap`, never a default.
 *   - L12 (tenant isolation) / L15 (project continuity): tenant and
 *     project are REQUIRED — a missing scope is a typed `tenant_missing`.
 *   - Seed discipline: the seed RANGE is [start, end) over episode
 *     ordinals; every episode's seed derives deterministically from
 *     (seed_base, job id, ordinal) — see partition.ts. No ambient
 *     randomness anywhere.
 *   - The driver config mirrors T013's reference trainer options
 *     field-for-field (the five-operation loop parameters: actor, step
 *     cadence, runtime, producer sets, datasets) — proven by
 *     src/interop.test.ts against the REAL rl-protocol/service shapes.
 */

import { deepFreeze, isNonNegativeSafeInteger, isPositiveSafeInteger, isRecord } from './primitives';
import type { JsonObject } from './primitives';
import { invalidField, invalidType, missingField, ok, type ComputeError, type ComputeResult } from './errors';
import type {
  AgentInstanceId,
  ArmId,
  BodyVersionRef,
  DataRef,
  EnvironmentConfigRef,
  ExperimentId,
  JobId,
  PolicyRef,
  ProjectId,
  RewardModelRef,
  RuntimeRef,
  Seed,
  SubstrateRef,
  TenantId,
} from './ids';
import {
  isAgentInstanceId,
  isArmId,
  isBodyVersionRef,
  isDataRef,
  isEnvironmentConfigRef,
  isExperimentId,
  isJobId,
  isPolicyRef,
  isProjectId,
  isRewardModelRef,
  isRuntimeRef,
  isSeed,
  isSubstrateRef,
  isTenantId,
} from './ids';

// ---------------------------------------------------------------------------
// The seed range (the ordinals a batch generates)
// ---------------------------------------------------------------------------

/**
 * A half-open range of episode ordinals `[start, end)`. Well-formed ranges
 * satisfy `0 <= start <= end` (an EMPTY range is well-formed — a worker
 * slot's partition may be empty when workers outnumber ordinals — but a
 * JOB's range must be non-empty and a TASK's range must be non-empty).
 */
export interface SeedRange {
  readonly start: number;
  readonly end: number;
}

/** Runtime guard for a well-formed seed range. */
export function isSeedRange(value: unknown): value is SeedRange {
  if (!isRecord(value)) return false;
  if (!isNonNegativeSafeInteger(value.start)) return false;
  if (!isNonNegativeSafeInteger(value.end)) return false;
  return (value.end as number) >= (value.start as number);
}

/** Runtime guard for a NON-EMPTY seed range (jobs and tasks carry work). */
export function isNonEmptySeedRange(value: unknown): value is SeedRange {
  return isSeedRange(value) && (value.end as number) > (value.start as number);
}

// ---------------------------------------------------------------------------
// The L9/L12 lineage block (carried by every job, result and failure)
// ---------------------------------------------------------------------------

/**
 * The lineage block every job record carries (L9), and every result and
 * failure record carries with it (the work order's lineage law): the
 * experiment this batch belongs to, the versioned environment config the
 * episodes drive, the versioned policy script the workers run, the
 * declared reward models (L7 — the refs whose models attach post-hoc; may
 * be empty for non-reward methods), and the tenant/project scope (L12/L15).
 */
export interface JobLineage {
  readonly experiment: ExperimentId;
  readonly environment_config: EnvironmentConfigRef;
  readonly policy: PolicyRef;
  readonly reward_models: readonly RewardModelRef[];
  /** Tenant scope (L12 — tenant isolation). */
  readonly tenant: TenantId;
  /** Project continuity root (L15). */
  readonly project: ProjectId;
}

/** Runtime guard for a job lineage block. */
export function isJobLineage(value: unknown): value is JobLineage {
  if (!isRecord(value)) return false;
  if (!isExperimentId(value.experiment)) return false;
  if (!isEnvironmentConfigRef(value.environment_config)) return false;
  if (!isPolicyRef(value.policy)) return false;
  if (!Array.isArray(value.reward_models)) return false;
  if (!(value.reward_models as readonly unknown[]).every((ref) => isRewardModelRef(ref))) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  return true;
}

/**
 * Collect-all validation of a job lineage block. L9 gaps (experiment,
 * environment config, policy, reward models) are typed `lineage_gap`; the
 * L12 tenant / L15 project scope is typed `tenant_missing` — the two
 * negative paths the work order names separately. On success the value is
 * returned narrowed, deeply frozen.
 */
export function validateJobLineage(value: unknown, path = 'lineage'): ComputeResult<JobLineage> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ComputeError[] = [];

  if (value.experiment === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.experiment`, message: 'the lineage experiment ref is missing (L9 — the batch belongs to an experiment)' });
  } else if (!isExperimentId(value.experiment)) {
    errors.push(invalidField(`${path}.experiment`, 'must be a non-empty experiment id (L9)'));
  }

  if (value.environment_config === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.environment_config`, message: 'the lineage environment config ref is missing (L9 — episodes drive a declared config)' });
  } else if (!isEnvironmentConfigRef(value.environment_config)) {
    errors.push(invalidField(`${path}.environment_config`, 'must be a non-empty versioned environment config ref (L9)'));
  }

  if (value.policy === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.policy`, message: 'the lineage policy ref is missing (L9 — the workers run a declared policy script)' });
  } else if (!isPolicyRef(value.policy)) {
    errors.push(invalidField(`${path}.policy`, 'must be a non-empty versioned policy ref (L9)'));
  }

  if (value.reward_models === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.reward_models`, message: 'the lineage reward-model refs are missing (L9 — the L7 declarations bound to this batch; may be empty)' });
  } else if (!Array.isArray(value.reward_models)) {
    errors.push(invalidField(`${path}.reward_models`, 'must be an array of versioned reward model refs (may be empty — L7)'));
  } else {
    const refs = value.reward_models as readonly unknown[];
    refs.forEach((ref, index) => {
      if (!isRewardModelRef(ref)) {
        errors.push(invalidField(`${path}.reward_models[${index}]`, 'must be a non-empty versioned reward model ref'));
      }
    });
    if (refs.some((ref, index) => refs.indexOf(ref) !== index)) {
      errors.push(invalidField(`${path}.reward_models`, 'must be duplicate-free — one model, one ref'));
    }
  }

  if (value.tenant === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the lineage tenant is missing (L12 — tenant isolation)' });
  } else if (!isTenantId(value.tenant)) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'must be a non-empty tenant id (L12 — tenant isolation)' });
  }

  if (value.project === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the lineage project is missing (L15 — project continuity)' });
  } else if (!isProjectId(value.project)) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'must be a non-empty project id (L15 — project continuity)' });
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      experiment: value.experiment as ExperimentId,
      environment_config: value.environment_config as EnvironmentConfigRef,
      policy: value.policy as PolicyRef,
      reward_models: (value.reward_models as readonly RewardModelRef[]).slice(),
      tenant: value.tenant as TenantId,
      project: value.project as ProjectId,
    }),
  );
}

// ---------------------------------------------------------------------------
// The declared driver configuration (T013 trainer mirrors)
// ---------------------------------------------------------------------------

/**
 * The declared driver configuration a job's workers run — STRUCTURAL MIRROR
 * of T013's `ReferenceTrainerOptions` (services/learning/src/rl/trainer.ts):
 * the acting agent instance, the step cadence (epoch-ms per driving step),
 * the runtime ref, the producer sets the trajectory metadata law requires
 * (non-empty body versions and substrates — an experience stream has
 * producers) and the dataset refs (may be empty for generative worlds).
 * The five-operation deterministic EpisodeDriver consumes exactly these
 * parameters; workers drive the T013 contracts, they do not replace them.
 */
export interface DriverConfig {
  readonly actor: AgentInstanceId;
  /** Positive safe integer of epoch milliseconds per driving step. */
  readonly step_ms: number;
  readonly runtime: RuntimeRef;
  /** Non-empty: an experience stream has producers (the trajectory law). */
  readonly body_versions: readonly BodyVersionRef[];
  /** Non-empty: bodies run on substrates (the trajectory law). */
  readonly substrates: readonly SubstrateRef[];
  /** Dataset refs the runs consume (may be empty). */
  readonly data?: readonly DataRef[];
}

/** Runtime guard for a driver configuration. */
export function isDriverConfig(value: unknown): value is DriverConfig {
  if (!isRecord(value)) return false;
  if (!isAgentInstanceId(value.actor)) return false;
  if (!isPositiveSafeInteger(value.step_ms)) return false;
  if (!isRuntimeRef(value.runtime)) return false;
  if (!Array.isArray(value.body_versions) || value.body_versions.length === 0) return false;
  if (!(value.body_versions as readonly unknown[]).every((ref) => isBodyVersionRef(ref))) return false;
  if (!Array.isArray(value.substrates) || value.substrates.length === 0) return false;
  if (!(value.substrates as readonly unknown[]).every((ref) => isSubstrateRef(ref))) return false;
  if (value.data !== undefined && !Array.isArray(value.data)) return false;
  if (value.data !== undefined && !(value.data as readonly unknown[]).every((ref) => isDataRef(ref))) return false;
  return true;
}

/** Collect-all validation of an untrusted driver configuration. */
export function validateDriverConfig(value: unknown, path = 'driver'): ComputeResult<DriverConfig> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ComputeError[] = [];

  if (value.actor === undefined) {
    errors.push(missingField(`${path}.actor`));
  } else if (!isAgentInstanceId(value.actor)) {
    errors.push(invalidField(`${path}.actor`, 'must be a non-empty agent instance id (the T013 driver actor)'));
  }

  if (value.step_ms === undefined) {
    errors.push(missingField(`${path}.step_ms`));
  } else if (!isPositiveSafeInteger(value.step_ms)) {
    errors.push(invalidField(`${path}.step_ms`, 'must be a positive safe integer of epoch milliseconds per driving step'));
  }

  if (value.runtime === undefined) {
    errors.push(missingField(`${path}.runtime`));
  } else if (!isRuntimeRef(value.runtime)) {
    errors.push(invalidField(`${path}.runtime`, 'must be a non-empty versioned runtime ref (L9)'));
  }

  if (value.body_versions === undefined) {
    errors.push(missingField(`${path}.body_versions`));
  } else if (!Array.isArray(value.body_versions)) {
    errors.push(invalidField(`${path}.body_versions`, 'must be an array of body version refs'));
  } else if (value.body_versions.length === 0) {
    errors.push(invalidField(`${path}.body_versions`, 'must be non-empty — an experience stream has producers (L9 lineage completeness)'));
  } else {
    (value.body_versions as readonly unknown[]).forEach((ref, index) => {
      if (!isBodyVersionRef(ref)) {
        errors.push(invalidField(`${path}.body_versions[${index}]`, 'must be a non-empty body version ref'));
      }
    });
  }

  if (value.substrates === undefined) {
    errors.push(missingField(`${path}.substrates`));
  } else if (!Array.isArray(value.substrates)) {
    errors.push(invalidField(`${path}.substrates`, 'must be an array of substrate refs'));
  } else if (value.substrates.length === 0) {
    errors.push(invalidField(`${path}.substrates`, 'must be non-empty — bodies run on substrates (L9 lineage completeness)'));
  } else {
    (value.substrates as readonly unknown[]).forEach((ref, index) => {
      if (!isSubstrateRef(ref)) {
        errors.push(invalidField(`${path}.substrates[${index}]`, 'must be a non-empty substrate ref'));
      }
    });
  }

  if (value.data !== undefined) {
    if (!Array.isArray(value.data)) {
      errors.push(invalidField(`${path}.data`, 'must be an array of dataset refs (may be empty for generative worlds)'));
    } else {
      (value.data as readonly unknown[]).forEach((ref, index) => {
        if (!isDataRef(ref)) {
          errors.push(invalidField(`${path}.data[${index}]`, 'must be a non-empty dataset ref'));
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const data = value.data === undefined ? undefined : (value.data as readonly DataRef[]).slice();
  return ok(
    deepFreeze({
      actor: value.actor as AgentInstanceId,
      step_ms: value.step_ms as number,
      runtime: value.runtime as RuntimeRef,
      body_versions: (value.body_versions as readonly BodyVersionRef[]).slice(),
      substrates: (value.substrates as readonly SubstrateRef[]).slice(),
      ...(data === undefined ? {} : { data }),
    }),
  );
}

// ---------------------------------------------------------------------------
// The EpisodeJob
// ---------------------------------------------------------------------------

/**
 * The unit of distributed episode generation: one declared batch of one
 * experiment arm. The seed range names the episode ordinals the batch
 * generates (partitioned across workers by the declared function in
 * partition.ts); `seed_base` + the ordinal derive every episode's seed;
 * `step_budget` bounds each episode's recorded steps (the T013 budget law);
 * `driver` declares the five-operation loop configuration; `lineage` binds
 * the L9/L12 provenance; `arm` names the comparison arm the emitted trials
 * execute.
 */
export interface EpisodeJob {
  readonly job_id: JobId;
  /** The L9/L12 lineage block (experiment, env config, policy, reward models, tenant, project). */
  readonly lineage: JobLineage;
  /** The comparison arm this batch's trials execute (the experiments lane's arm). */
  readonly arm: ArmId;
  /** The master seed: every episode seed derives from (seed_base, job id, ordinal). */
  readonly seed_base: Seed;
  /** The episode ordinals this job generates: non-empty `[start, end)`. */
  readonly seed_range: SeedRange;
  /** The per-episode step budget (the T013 driver budget law). */
  readonly step_budget: number;
  /** The declared driver configuration (T013 trainer mirrors). */
  readonly driver: DriverConfig;
}

/** Runtime guard for a structurally valid episode job. */
export function isEpisodeJob(value: unknown): value is EpisodeJob {
  if (!isRecord(value)) return false;
  if (!isJobId(value.job_id)) return false;
  if (!isJobLineage(value.lineage)) return false;
  if (!isArmId(value.arm)) return false;
  if (!isSeed(value.seed_base)) return false;
  if (!isNonEmptySeedRange(value.seed_range)) return false;
  if (!isPositiveSafeInteger(value.step_budget)) return false;
  if (!isDriverConfig(value.driver)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted episode job (`job_invalid`-class
 * envelope errors; lineage gaps and tenant gaps carry their dedicated
 * codes). On success the value is returned narrowed, deeply frozen.
 */
export function validateEpisodeJob(value: unknown, path = 'job'): ComputeResult<EpisodeJob> {
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'job_invalid', path, message: `${path} must be an object` }] };
  }
  const errors: ComputeError[] = [];

  if (value.job_id === undefined) {
    errors.push({ code: 'job_invalid', path: `${path}.job_id`, message: 'the job id is missing' });
  } else if (!isJobId(value.job_id)) {
    errors.push({ code: 'job_invalid', path: `${path}.job_id`, message: 'must be a non-empty job id' });
  }

  let lineage: JobLineage | undefined;
  if (value.lineage === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.lineage`, message: 'the job lineage block is missing (L9 — experiment, env config, policy, reward models, tenant, project)' });
  } else {
    const lineageResult = validateJobLineage(value.lineage, `${path}.lineage`);
    if (lineageResult.ok) {
      lineage = lineageResult.value;
    } else {
      errors.push(...lineageResult.errors);
    }
  }

  if (value.arm === undefined) {
    errors.push({ code: 'job_invalid', path: `${path}.arm`, message: 'the job arm is missing (the batch executes one comparison arm)' });
  } else if (!isArmId(value.arm)) {
    errors.push({ code: 'job_invalid', path: `${path}.arm`, message: 'must be a non-empty arm id' });
  }

  if (value.seed_base === undefined) {
    errors.push({ code: 'job_invalid', path: `${path}.seed_base`, message: 'the job seed base is missing (L9 — every episode seed derives from it)' });
  } else if (!isSeed(value.seed_base)) {
    errors.push({ code: 'job_invalid', path: `${path}.seed_base`, message: 'must be a non-empty deterministic seed base' });
  }

  if (value.seed_range === undefined) {
    errors.push({ code: 'job_invalid', path: `${path}.seed_range`, message: 'the job seed range is missing (the episode ordinals the batch generates)' });
  } else if (!isNonEmptySeedRange(value.seed_range)) {
    errors.push({ code: 'job_invalid', path: `${path}.seed_range`, message: 'must be a non-empty [start, end) range of non-negative safe integers — a job carries work' });
  }

  if (value.step_budget === undefined) {
    errors.push({ code: 'job_invalid', path: `${path}.step_budget`, message: 'the job step budget is missing (the per-episode T013 budget law)' });
  } else if (!isPositiveSafeInteger(value.step_budget)) {
    errors.push({ code: 'job_invalid', path: `${path}.step_budget`, message: 'must be a positive safe integer (per episode)' });
  }

  let driver: DriverConfig | undefined;
  if (value.driver === undefined) {
    errors.push({ code: 'job_invalid', path: `${path}.driver`, message: 'the declared driver configuration is missing (the T013 trainer mirrors)' });
  } else {
    const driverResult = validateDriverConfig(value.driver, `${path}.driver`);
    if (driverResult.ok) {
      driver = driverResult.value;
    } else {
      errors.push(...driverResult.errors);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      job_id: value.job_id as JobId,
      lineage: lineage as JobLineage,
      arm: value.arm as ArmId,
      seed_base: value.seed_base as Seed,
      seed_range: deepFreeze({ start: (value.seed_range as SeedRange).start, end: (value.seed_range as SeedRange).end }),
      step_budget: value.step_budget as number,
      driver: driver as DriverConfig,
    }),
  );
}

// ---------------------------------------------------------------------------
// Canonical JSON trees (byte-determinism law)
// ---------------------------------------------------------------------------

/** JSON-tree projection of a lineage block (compile-proven JSON safety, no casts). */
export function lineageTree(lineage: JobLineage): JsonObject {
  return {
    experiment: lineage.experiment,
    environment_config: lineage.environment_config,
    policy: lineage.policy,
    reward_models: [...lineage.reward_models],
    tenant: lineage.tenant,
    project: lineage.project,
  };
}

/** JSON-tree projection of a driver configuration (compile-proven JSON safety, no casts). */
export function driverTree(driver: DriverConfig): JsonObject {
  const tree: JsonObject = {
    actor: driver.actor,
    step_ms: driver.step_ms,
    runtime: driver.runtime,
    body_versions: [...driver.body_versions],
    substrates: [...driver.substrates],
  };
  // Optional `data` is present in the tree only when the source carries it
  // (mirror discipline: the T013 options treat `data` the same way).
  if (driver.data !== undefined) {
    return { ...tree, data: [...driver.data] };
  }
  return tree;
}

/** JSON-tree projection of an episode job (compile-proven JSON safety, no casts). */
export function jobTree(job: EpisodeJob): JsonObject {
  return {
    job_id: job.job_id,
    lineage: lineageTree(job.lineage),
    arm: job.arm,
    seed_base: job.seed_base,
    seed_range: { start: job.seed_range.start, end: job.seed_range.end },
    step_budget: job.step_budget,
    driver: driverTree(job.driver),
  };
}
