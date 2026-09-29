/**
 * @tradrl/learning (service) — the self-play matchup (T015).
 *
 * THE PAIRING RECORD: a {@link SelfPlayMatchup} fields a CANDIDATE
 * organization against a SET of adversaries from an adversarial
 * population — for curriculum stage 5 ("Adversarial population",
 * spec/LEARNING-LOOP.md) and every adversarial evaluation
 * (ARCHITECTURE-LOCK L10: "friendly replay alone does not release a
 * strategy" — the matchup is what L10 fields).
 *
 * The matchup COMMISSIONS its evidence: the record carries the
 * commissioned batch (the T011 experiment-design mirror + the T014
 * episode-job-spec mirrors — commission.ts) whose treatment arm runs the
 * candidate against the fielded adversary set. The matchup never runs
 * anything: stages emit COMMISSION records, the compute layer (T014)
 * executes them, the evaluation lane (T012) decides them.
 *
 * FIELDABILITY LAW: every named adversary must be a FIELDABLE member of
 * the cited population (`adversary_not_fieldable` otherwise) — a retired
 * adversary is a historical record, never an opponent; an unknown one is
 * a lineage forgery. The population record is carried whole (immutable,
 * frozen) so the matchup is SELF-CONTAINING evidence of fieldability
 * (L9).
 *
 * Determinism: the matchup id and its experiment id are FNV-1a
 * derivations over the declared identity inputs (goal, population, sorted
 * adversary set, curriculum version, stage); the commissioned batch is
 * the pure commission builder's output. Same inputs -> byte-identical
 * matchup, twice.
 *
 * L9/L12: full lineage (goal, curriculum version, stage, tenant, project,
 * population, adversaries); the population's scope must match the
 * matchup's (`tenant_scope_mismatch`).
 */

import {
  type CurriculumError,
  type CurriculumResult,
  deepFreeze,
  fail,
  fnv1a32Hex,
  isRecord,
} from '../curriculum/primitives';
import type {
  ArmId,
  CurriculumVersionRef,
  EnvironmentConfigRef,
  EvaluatorVersionRef,
  ExperimentId,
  GoalRef,
  MatchupId,
  OrganizationId,
  ProjectId,
  SplitPolicyRef,
  TenantId,
} from './ids';
import type { AdversaryId, PopulationId } from './ids';
import {
  isCurriculumVersionRef,
  isEnvironmentConfigRef,
  isEvaluatorVersionRef,
  isGoalRef,
  isOrganizationId,
  isProjectId,
  isTenantId,
} from './ids';
import type { CurriculumStageKind } from '../curriculum/ladder';
import { isCurriculumStageKind } from '../curriculum/ladder';
import {
  type CommissionedBatch,
  type DriverConfigMirror,
  type ExperimentDesignMirror,
  type EpisodeJobSpecMirror,
  type JobLineageMirror,
  deriveJobId,
  deriveJobSeedBase,
  validateCommissionedBatch,
} from '../curriculum/commission';
import type { LearningMethodMirror } from '../curriculum/gaps';
import { isLearningMethodMirror } from '../curriculum/gaps';
import { type PopulationRecord, isFieldable, validatePopulationRecord } from './population';

// ---------------------------------------------------------------------------
// The matchup record
// ---------------------------------------------------------------------------

/**
 * One self-play matchup: the candidate organization, the population
 * fielded against it, the adversary set (a fieldable subset), the
 * curriculum stage the matchup serves (stage 5 or an adversarial
 * evaluation), the commissioned evidence batch, and the full L9/L12
 * lineage.
 */
export interface SelfPlayMatchup {
  /** The matchup identity (deterministic derivation — see deriveMatchupId). */
  readonly matchup: MatchupId;
  /** The candidate organization under adversarial stress. */
  readonly candidate: OrganizationId;
  /** The adversarial population the opponents come from (carried for fieldability evidence, L9). */
  readonly population: PopulationRecord;
  /** The fielded adversary set (each a fieldable member of the population). */
  readonly adversaries: readonly AdversaryId[];
  /** The curriculum stage this matchup serves (stage 5 or adversarial evaluation). */
  readonly stage: CurriculumStageKind;
  /** The commissioned evidence batch (the T011 design + T014 job specs; spawned, never run). */
  readonly commission: CommissionedBatch;
  /** The L9/L12 lineage block. */
  readonly lineage: MatchupLineage;
}

/** The matchup's L9/L12 lineage block. */
export interface MatchupLineage {
  readonly goal: GoalRef;
  readonly curriculum_version: CurriculumVersionRef;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: `MatchupLineage`. */
export function isMatchupLineage(v: unknown): v is MatchupLineage {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.goal)) return false;
  if (!isCurriculumVersionRef(v.curriculum_version)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  return true;
}

/** Guard: `SelfPlayMatchup` (structural; fieldability and scope in the builder). */
export function isSelfPlayMatchup(v: unknown): v is SelfPlayMatchup {
  if (!isRecord(v)) return false;
  if (typeof v.matchup !== 'string' || (v.matchup as string).length === 0) return false;
  if (!isOrganizationId(v.candidate)) return false;
  if (v.population === undefined || !isRecord(v.population)) return false;
  if (!Array.isArray(v.adversaries) || v.adversaries.length === 0) return false;
  if (!(v.adversaries as readonly unknown[]).every((id) => typeof id === 'string' && (id as string).length > 0)) return false;
  if (!isCurriculumStageKind(v.stage)) return false;
  if (v.commission === undefined || !isRecord(v.commission)) return false;
  if (!isMatchupLineage(v.lineage)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Deterministic identity derivations
// ---------------------------------------------------------------------------

/**
 * The declared derivation of a matchup's id:
 * `matchup-<fnv1a32(goal|population|adversaries|version|stage)>` — the
 * adversary set is CANONICALIZED (sorted, deduped) so the same fielded
 * set always derives the same id, whatever its input order (L9).
 */
export function deriveMatchupId(
  goal: GoalRef,
  population: PopulationId,
  adversaries: readonly AdversaryId[],
  version: CurriculumVersionRef,
  stage: CurriculumStageKind,
): MatchupId {
  const canonical = [...new Set(adversaries)].sort().join(',');
  return `matchup-${fnv1a32Hex(`${goal}|${population}|${canonical}|${version}|${stage}`)}` as MatchupId;
}

/**
 * The declared derivation of a matchup's experiment id:
 * `exp-sp-<fnv1a32(goal|population|adversaries|version|stage)>` — the
 * self-play experiment is a pure function of the pairing (distinct from
 * the stage-commission derivation: a matchup is not a ladder rung, it is
 * a pairing).
 */
export function deriveMatchupExperimentId(
  goal: GoalRef,
  population: PopulationId,
  adversaries: readonly AdversaryId[],
  version: CurriculumVersionRef,
  stage: CurriculumStageKind,
): ExperimentId {
  const canonical = [...new Set(adversaries)].sort().join(',');
  return `exp-sp-${fnv1a32Hex(`${goal}|${population}|${canonical}|${version}|${stage}`)}` as ExperimentId;
}

// ---------------------------------------------------------------------------
// The matchup commission builder
// ---------------------------------------------------------------------------

/** The matchup commission's declared parameters (the caller supplies the stage-5-shaped config). */
export interface MatchupCommissionConfig {
  readonly method: LearningMethodMirror;
  readonly environment_config: EnvironmentConfigRef;
  readonly evaluator_version: EvaluatorVersionRef;
  readonly splits: readonly SplitPolicyRef[];
  readonly driver: DriverConfigMirror;
  readonly episodes_per_arm: number;
  readonly step_budget: number;
}

/** Guard: `MatchupCommissionConfig`. */
export function isMatchupCommissionConfig(v: unknown): v is MatchupCommissionConfig {
  if (!isRecord(v)) return false;
  if (!isLearningMethodMirror(v.method)) return false;
  if (!isEnvironmentConfigRef(v.environment_config)) return false;
  if (!isEvaluatorVersionRef(v.evaluator_version)) return false;
  if (!Array.isArray(v.splits) || v.splits.length === 0) return false;
  if (typeof v.episodes_per_arm !== 'number' || !Number.isSafeInteger(v.episodes_per_arm) || v.episodes_per_arm < 1) return false;
  if (typeof v.step_budget !== 'number' || !Number.isSafeInteger(v.step_budget) || v.step_budget < 1) return false;
  if (v.driver === undefined || !isRecord(v.driver)) return false;
  return true;
}

/**
 * Build the matchup's commissioned batch: the experiment design (T011
 * mirror) whose intervention is the PAIRING itself (`self-play-matchup`,
 * parameters carrying the population, the adversary set, the stage and
 * the method), and one episode batch per arm (control: the candidate in
 * the world alone; treatment: the candidate against the fielded
 * adversaries — the parameters name them; the world lane resolves the
 * refs). Pure and deterministic given (goal, population, adversaries,
 * version, stage, config, seed).
 */
export function commissionMatchupBatch(
  candidate: OrganizationId,
  goal: GoalRef,
  population: PopulationRecord,
  adversaries: readonly AdversaryId[],
  stage: CurriculumStageKind,
  config: MatchupCommissionConfig,
  lineage: MatchupLineage,
  seed: string,
): CurriculumResult<CommissionedBatch> {
  const version = lineage.curriculum_version;
  const experiment = deriveMatchupExperimentId(goal, population.population, adversaries, version, stage);
  const episodes = config.episodes_per_arm;
  const controlArm = 'arm-control' as ArmId;
  const treatmentArm = 'arm-treatment' as ArmId;
  const canonicalAdversaries = [...new Set(adversaries)].sort();

  const design: ExperimentDesignMirror = {
    hypothesis: `Self-play matchup (stage "${stage}", ${version}): the candidate organization attains the stage's criteria under adversarial stress from ${canonicalAdversaries.length} fielded adversary(ies) of population "${population.population}".`,
    intervention: {
      kind: 'self-play-matchup',
      description: `The candidate organization against the fielded adversary set of population "${population.population}" (stage "${stage}").`,
      parameters: {
        population: population.population,
        adversaries: [...canonicalAdversaries],
        stage,
        method: config.method,
        curriculum_version: version,
      },
    },
    comparison: [
      { arm: controlArm, role: 'control', description: 'The candidate organization in the declared world without the adversarial population.' },
      { arm: treatmentArm, role: 'treatment', description: `The candidate organization against ${canonicalAdversaries.length} fielded adversary(ies) of population "${population.population}" (L10).` },
    ],
    splits: [...config.splits],
    candidate_organization: candidate,
    body_versions: [...config.driver.body_versions],
    substrates: [...config.driver.substrates],
    datasets: config.driver.data === undefined ? [] : [...config.driver.data],
    environment_config: config.environment_config,
    evaluator_version: config.evaluator_version,
  };

  const jobLineage: JobLineageMirror = {
    experiment,
    environment_config: config.environment_config,
    // The matchup's jobs run under the population's fielded adversaries —
    // the policy ref names the ADVERSARIAL arena policy (opaque; the world
    // lane resolves it against the population's strategy refs).
    policy: `policy:matchup-${population.population}@1` as import('../curriculum/ids').PolicyRef,
    reward_models: [],
    tenant: lineage.tenant,
    project: lineage.project,
  };

  const controlJob: EpisodeJobSpecMirror = {
    job_id: deriveJobId(experiment, controlArm),
    lineage: jobLineage,
    arm: controlArm,
    seed_base: deriveJobSeedBase(seed as import('../curriculum/ids').Seed, experiment, controlArm),
    seed_range: { start: 0, end: episodes },
    step_budget: config.step_budget,
    driver: config.driver,
  };
  const treatmentJob: EpisodeJobSpecMirror = {
    job_id: deriveJobId(experiment, treatmentArm),
    lineage: jobLineage,
    arm: treatmentArm,
    seed_base: deriveJobSeedBase(seed as import('../curriculum/ids').Seed, experiment, treatmentArm),
    seed_range: { start: episodes, end: episodes * 2 },
    step_budget: config.step_budget,
    driver: config.driver,
  };

  const batch = deepFreeze({
    experiment,
    design: deepFreeze(design),
    jobs: deepFreeze([controlJob, treatmentJob]),
  });
  return validateCommissionedBatch(batch);
}

// ---------------------------------------------------------------------------
// The matchup builder (fieldability + scope + commission, all typed)
// ---------------------------------------------------------------------------

/**
 * Field a self-play matchup: pair `candidate` against the named
 * `adversaries` of `population`, under the stage and config declared,
 * commissioning the evidence batch.
 *
 * Typed failures:
 *   - `invalid_field` — malformed inputs (candidate, adversaries, stage,
 *     config, lineage);
 *   - `invalid_field` — the population record itself fails deep
 *     validation;
 *   - `adversary_not_fieldable` — a named adversary is not a fieldable
 *     member (unknown or retired — retired adversaries are historical
 *     records, never opponents);
 *   - `tenant_scope_mismatch` — the matchup's scope disagrees with the
 *     population's (L12);
 *   - `population_missing` — an empty adversary set (a matchup against
 *     nothing is not adversarial, L10).
 *
 * Deterministic: same inputs -> byte-identical matchup, twice.
 */
export function fieldMatchup(
  candidate: unknown,
  population: unknown,
  adversaries: unknown,
  stage: unknown,
  config: unknown,
  lineage: unknown,
  seed: string,
): CurriculumResult<SelfPlayMatchup> {
  const errors: CurriculumError[] = [];
  if (typeof seed !== 'string' || seed.length === 0) {
    errors.push({ code: 'invalid_field', path: 'seed', message: 'the matchup seed must be a non-empty string' });
  }
  if (!isOrganizationId(candidate)) {
    errors.push({ code: 'invalid_field', path: 'candidate', message: 'the matchup must name the candidate organization' });
  }
  if (!isCurriculumStageKind(stage)) {
    errors.push({ code: 'stage_unknown', path: 'stage', message: 'the matchup must name the curriculum stage it serves' });
  }
  if (!isMatchupCommissionConfig(config)) {
    errors.push({ code: 'invalid_field', path: 'config', message: 'the matchup commission configuration failed its guard (method, environment, evaluator, splits, driver, batch shape)' });
  }
  if (!isMatchupLineage(lineage)) {
    errors.push({ code: 'lineage_gap', path: 'lineage', message: 'the matchup must carry goal, curriculum version, tenant and project (L9/L12)' });
  }
  if (!Array.isArray(adversaries) || adversaries.length === 0) {
    errors.push({ code: 'population_missing', path: 'adversaries', message: 'the matchup must field at least one adversary — a matchup against nothing is not adversarial (L10)' });
  } else if (!(adversaries as readonly unknown[]).every((id) => typeof id === 'string' && (id as string).length > 0)) {
    errors.push({ code: 'invalid_field', path: 'adversaries', message: 'every fielded adversary must be a non-empty adversary id' });
  }
  if (errors.length > 0) return { ok: false, errors };

  // The population is deep-validated (the matchup carries it whole — L9).
  const populationResult = validatePopulationRecord(population);
  if (!populationResult.ok) {
    return { ok: false, errors: [{ code: 'invalid_field', path: 'population', message: `the cited population failed validation: ${populationResult.errors.map((error) => error.message).join('; ')}` }] };
  }
  const validPopulation = populationResult.value;

  // L12: the matchup's scope IS the population's scope.
  if (validPopulation.lineage.tenant !== (lineage as MatchupLineage).tenant || validPopulation.lineage.project !== (lineage as MatchupLineage).project) {
    return fail(
      'tenant_scope_mismatch',
      `the matchup serves tenant "${(lineage as MatchupLineage).tenant}"/project "${(lineage as MatchupLineage).project}" but the population belongs to "${validPopulation.lineage.tenant}"/"${validPopulation.lineage.project}" (L12)`,
      'lineage',
    );
  }

  // The fieldability law: every named adversary is a fieldable member.
  const fielded = adversaries as readonly AdversaryId[];
  const seen = new Set<string>();
  for (let index = 0; index < fielded.length; index++) {
    const adversary = fielded[index];
    if (seen.has(adversary)) {
      return fail('invalid_field', `adversary "${adversary}" is fielded twice — one adversary, one slot`, `adversaries[${index}]`);
    }
    seen.add(adversary);
    if (!isFieldable(validPopulation, adversary)) {
      const retired = validPopulation.retired.some((member) => member.adversary === adversary);
      return fail(
        'adversary_not_fieldable',
        `adversary "${adversary}" is ${retired ? 'RETIRED (a retained historical record, never an opponent)' : 'unknown to the population'} — stage 5 and adversarial evaluation field only current members (L10/L11)`,
        `adversaries[${index}]`,
      );
    }
  }

  // The commission (pure derivation; failures are the commission's own codes).
  const commission = commissionMatchupBatch(
    candidate as OrganizationId,
    (lineage as MatchupLineage).goal,
    validPopulation,
    fielded,
    stage as CurriculumStageKind,
    config as MatchupCommissionConfig,
    lineage as MatchupLineage,
    seed,
  );
  if (!commission.ok) return commission;

  const matchup: SelfPlayMatchup = deepFreeze({
    matchup: deriveMatchupId((lineage as MatchupLineage).goal, validPopulation.population, fielded, (lineage as MatchupLineage).curriculum_version, stage as CurriculumStageKind),
    candidate: candidate as OrganizationId,
    population: validPopulation,
    adversaries: deepFreeze([...fielded]),
    stage: stage as CurriculumStageKind,
    commission: commission.value,
    lineage: lineage as MatchupLineage,
  });
  if (!isSelfPlayMatchup(matchup)) {
    return fail('invalid_field', 'the assembled matchup failed its own guard (impossible by construction)');
  }
  return { ok: true, value: matchup };
}
