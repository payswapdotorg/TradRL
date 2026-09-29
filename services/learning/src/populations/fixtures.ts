/**
 * @tradrl/learning (service) — the golden population fixtures (T015).
 *
 * The canonical adversarial universe the tests and acceptance criteria
 * reference: the golden founder population (three adversaries over the
 * golden scope), the golden declared selection function + mutation
 * operator (the declared, versioned records — no hidden fitness), the
 * golden evolution (byte-stable across runs), and the golden self-play
 * matchup (the candidate against two fielded adversaries, stage 5).
 *
 * Everything is deterministic: the golden evolution is the pure function
 * of (golden population, golden selection function, golden operator,
 * golden seed), and the golden matchup is the pure function of its
 * declared inputs — the same values on every construction (the tests
 * prove it, twice).
 */

import { deepFreeze } from '../curriculum/primitives';
import type { AdversaryDescriptor, PopulationRecord } from './population';
import { validatePopulationRecord } from './population';
import { type EvolutionOutcome, type MutationOperator, type SelectionFunction, evolvePopulation } from './evolution';
import { type SelfPlayMatchup, fieldMatchup } from './matchup';
import type { AdversaryId, MatchupId, PopulationId, StrategyRef } from './ids';
import type { AdversaryBlueprintRef, GoalRef, Seed, TenantId, ProjectId } from '../curriculum/ids';
import { GOLDEN_CANDIDATE, GOLDEN_GOAL, GOLDEN_PROJECT, GOLDEN_SEED, GOLDEN_TENANT, GOLDEN_CURRICULUM_VERSION } from '../curriculum/fixtures';

// ---------------------------------------------------------------------------
// The golden scope (mirrors the curriculum fixtures' universe)
// ---------------------------------------------------------------------------

/** The golden population identity (stable across generations). */
export const GOLDEN_POPULATION = 'pop-golden-adversaries';
/** The golden evolution seed (the pure engine's explicit randomness). */
export const GOLDEN_POPULATION_SEED = 'seed-golden-population';
/** The golden selection function identity (declared, versioned). */
export const GOLDEN_SELECTION_FUNCTION = 'selection-golden-top2-jitter@1';
/** The golden mutation operator identity (declared, versioned). */
export const GOLDEN_MUTATION_OPERATOR = 'mutation-golden-jitter@1';
/** The golden adversary-blueprint refs (the organization-lane interlock, opaque). */
export const GOLDEN_BLUEPRINT_A = 'bp-golden-mm-alpha@1';
export const GOLDEN_BLUEPRINT_B = 'bp-golden-mm-beta@1';
export const GOLDEN_BLUEPRINT_C = 'bp-golden-mm-gamma@1';

// ---------------------------------------------------------------------------
// The golden founder population
// ---------------------------------------------------------------------------

/** The golden adversary literal builder (founders: generation 0, no parent, no operator). */
function goldenFounder(
  adversary: string,
  strategy: string,
  blueprint: string,
): AdversaryDescriptor {
  return {
    adversary: adversary as AdversaryId,
    strategy: strategy as StrategyRef,
    blueprint: blueprint as AdversaryBlueprintRef,
    lineage: deepFreeze({
      population: GOLDEN_POPULATION as PopulationId,
      generation: 0,
      parent: null,
      operator: null,
    }),
    tenantId: GOLDEN_TENANT as TenantId,
    projectId: GOLDEN_PROJECT as ProjectId,
  };
}

/**
 * The golden founder population literal (untrusted form): three founders
 * — a market-maker alpha, a momentum chaser beta and a liquidity taker
 * gamma — over the golden scope.
 */
export function goldenPopulationLiteral(): Record<string, unknown> {
  return {
    population: GOLDEN_POPULATION,
    generation: 0,
    members: [
      goldenFounder('adv-golden-mm-alpha', 'strat-golden-mm@1', GOLDEN_BLUEPRINT_A),
      goldenFounder('adv-golden-momentum-beta', 'strat-golden-momentum@1', GOLDEN_BLUEPRINT_B),
      goldenFounder('adv-golden-liquidity-gamma', 'strat-golden-liquidity@1', GOLDEN_BLUEPRINT_C),
    ],
    retired: [],
    lineage: {
      goal: GOLDEN_GOAL,
      seed: GOLDEN_SEED,
      tenant: GOLDEN_TENANT,
      project: GOLDEN_PROJECT,
    },
  };
}

/** The golden founder population, validated and deeply frozen. */
export function goldenPopulation(): PopulationRecord {
  const result = validatePopulationRecord(goldenPopulationLiteral());
  if (!result.ok) throw new Error(`golden fixture bug: ${JSON.stringify(result.errors)}`);
  return result.value;
}

// ---------------------------------------------------------------------------
// The golden declared selection function + mutation operator
// ---------------------------------------------------------------------------

/** The golden selection function: retain top 2, mutate 2, seeded-digest-v1 fitness. */
export function goldenSelectionFunction(): SelectionFunction {
  return deepFreeze({
    function_id: GOLDEN_SELECTION_FUNCTION as never,
    version: 1,
    fitness_derivation: 'seeded-digest-v1',
    retain_count: 2,
    mutate_count: 2,
    operator: GOLDEN_MUTATION_OPERATOR as never,
  });
}

/** The golden mutation operator: parameter jitter over the founder strategy families. */
export function goldenMutationOperator(): MutationOperator {
  return deepFreeze({
    operator_id: GOLDEN_MUTATION_OPERATOR as never,
    version: 1,
    kind: 'parameter-jitter',
    strategy_pool: [],
  });
}

// ---------------------------------------------------------------------------
// The golden evolution
// ---------------------------------------------------------------------------

/**
 * The golden evolution outcome: one generation of the pure engine over
 * (golden population, golden selection function, golden operator, golden
 * seed). Byte-stable across runs — the same retained/retired/born ledger
 * on every construction.
 */
export function goldenEvolution(): EvolutionOutcome {
  const result = evolvePopulation(goldenPopulation(), goldenSelectionFunction(), goldenMutationOperator(), GOLDEN_POPULATION_SEED);
  if (!result.ok) throw new Error(`golden fixture bug: ${JSON.stringify(result.errors)}`);
  return result.value;
}

/** The golden evolved population (generation 1) — the golden evolution's successor. */
export function goldenEvolvedPopulation(): PopulationRecord {
  return goldenEvolution().successor;
}

// ---------------------------------------------------------------------------
// The golden matchup
// ---------------------------------------------------------------------------

/** The golden matchup lineage (the golden scope + the golden curriculum version). */
export function goldenMatchupLineage(): Record<string, unknown> {
  return {
    goal: GOLDEN_GOAL,
    curriculum_version: GOLDEN_CURRICULUM_VERSION,
    tenant: GOLDEN_TENANT,
    project: GOLDEN_PROJECT,
  };
}

/** The golden matchup commission config (the stage-5-shaped declaration). */
export function goldenMatchupConfig(): Record<string, unknown> {
  return {
    method: 'adversarial',
    environment_config: 'envcfg-golden-adversarial_population',
    evaluator_version: 'evaluator-golden@1',
    splits: ['split-walk-forward-golden'],
    driver: {
      actor: 'agent-golden-curriculum',
      step_ms: 100,
      runtime: '@tradrl/learning/curriculum@1',
      body_versions: ['body-golden@1'],
      substrates: ['substrate-golden@1'],
    },
    episodes_per_arm: 3,
    step_budget: 12,
  };
}

/**
 * The golden self-play matchup: the golden candidate against the golden
 * population's FIRST TWO founders, under stage 5 (adversarial_population).
 */
export function goldenMatchup(): SelfPlayMatchup {
  const population = goldenPopulation();
  const fielded = population.members.slice(0, 2).map((member) => member.adversary);
  const result = fieldMatchup(
    GOLDEN_CANDIDATE,
    population,
    fielded,
    'adversarial_population',
    goldenMatchupConfig(),
    goldenMatchupLineage(),
    GOLDEN_SEED,
  );
  if (!result.ok) throw new Error(`golden fixture bug: ${JSON.stringify(result.errors)}`);
  return result.value;
}

/** The golden matchup's identity (the deterministic derivation, exposed for tests). */
export function goldenMatchupId(): MatchupId {
  return goldenMatchup().matchup;
}

/** The golden goal ref re-exported for the population-side tests (one scope, one universe). */
export const GOLDEN_POPULATION_GOAL: GoalRef = GOLDEN_GOAL as GoalRef;
export const GOLDEN_POPULATION_SEED_REF: Seed = GOLDEN_SEED as Seed;
