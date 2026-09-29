/**
 * @tradrl/learning (service) — the population evolution tests (T015).
 *
 * Behavioral law coverage:
 *   - the golden evolution: the declared algorithm's every decision (who
 *     is retained, who retires, who is born — acceptance #8's golden
 *     evolution, byte-stable across runs);
 *   - DETERMINISM: same (population, selection function, operator, seed)
 *     -> byte-identical next generation, TWICE; a different seed changes
 *     the outcome (the seed is load-bearing);
 *   - the DECLARED-selection laws: an infeasible retain count
 *     (`selection_infeasible`), an operator mismatch
 *     (`lineage_mismatch`), malformed selection/operator records
 *     (`invalid_field`) — "no fitness hidden in closures: the selection
 *     function is a declared, versioned record";
 *   - the mutants' lineage: born under the declared operator, of a
 *     fieldable parent, in the successor's generation;
 *   - the successor record validates (members + retained retired).
 */

import { describe, expect, it } from 'vitest';

import { evolvePopulation, seededDigestFitness } from './evolution';
import type { AdversaryDescriptor, PopulationRecord } from './population';
import {
  GOLDEN_POPULATION_SEED,
  goldenEvolution,
  goldenMutationOperator,
  goldenPopulation,
  goldenPopulationLiteral,
  goldenSelectionFunction,
} from './fixtures';

describe('the golden evolution (the pure seeded engine)', () => {
  it('retains, retires and births per the declared selection function', () => {
    const outcome = goldenEvolution();
    // The declared selection function: retain 2, mutate 2, over 3 founders.
    expect(outcome.retained.length).toBe(2);
    expect(outcome.retired.length).toBe(1 + 0); // 1 newly retired + 0 prior
    expect(outcome.born.length).toBe(2);
    // The successor: 2 retained + 2 born = 4 fieldable members.
    expect(outcome.successor.generation).toBe(1);
    expect(outcome.successor.members.length).toBe(4);
    expect(outcome.successor.retired.length).toBe(1);
    // WHO is retained is the declared derivation's ranking, not arrival
    // order: rank by seeded-digest-v1 fitness, tie-break by id.
    const population: PopulationRecord = goldenPopulation();
    const ranked = [...population.members].sort((left: AdversaryDescriptor, right: AdversaryDescriptor) => {
      const leftFitness = seededDigestFitness(left.adversary, GOLDEN_POPULATION_SEED);
      const rightFitness = seededDigestFitness(right.adversary, GOLDEN_POPULATION_SEED);
      if (leftFitness !== rightFitness) return rightFitness - leftFitness;
      return left.adversary < right.adversary ? -1 : 1;
    });
    expect(outcome.retained).toEqual([ranked[0]?.adversary, ranked[1]?.adversary]);
    expect(outcome.successor.retired.map((member) => member.adversary)).toEqual([ranked[2]?.adversary]);
  });

  it('births mutants under the declared operator, of fieldable parents, in the successor generation', () => {
    const outcome = goldenEvolution();
    for (const mutant of outcome.born) {
      expect(mutant.lineage.generation).toBe(1);
      expect(mutant.lineage.operator).toBe(goldenMutationOperator().operator_id);
      expect(mutant.lineage.parent).not.toBeNull();
      // The parent was a fieldable member of the founder generation.
      expect(outcome.retained).toContain(mutant.lineage.parent);
      // The mutant's strategy ref is a fresh derivation (parameter-jitter).
      expect(mutant.strategy.startsWith('strat-mut-')).toBe(true);
      // The blueprint ref is inherited (parameter-jitter inherits it).
      const parent = goldenPopulation().members.find((member) => member.adversary === mutant.lineage.parent);
      expect(mutant.blueprint).toBe(parent?.blueprint);
    }
    // Two mutants from two distinct proto parents (cycling retained order).
    const parents = outcome.born.map((mutant) => mutant.lineage.parent);
    expect(new Set(parents).size).toBe(2);
  });

  it('keeps the population identity and lineage (L9/L12) across the generation', () => {
    const outcome = goldenEvolution();
    const parent = goldenPopulation();
    expect(outcome.successor.population).toBe(parent.population);
    expect(outcome.successor.lineage).toEqual(parent.lineage);
    expect(outcome.successor.lineage.tenant).toBe('tenant-golden');
  });
});

describe('determinism (the same inputs -> the byte-identical next generation, twice)', () => {
  it('produces the identical successor and ledger on every run', () => {
    const first = goldenEvolution();
    const second = goldenEvolution();
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    // And through the pure engine directly (untrusted-form input).
    const third = evolvePopulation(goldenPopulationLiteral(), goldenSelectionFunction(), goldenMutationOperator(), GOLDEN_POPULATION_SEED);
    const fourth = evolvePopulation(goldenPopulationLiteral(), goldenSelectionFunction(), goldenMutationOperator(), GOLDEN_POPULATION_SEED);
    if (!third.ok) throw new Error(JSON.stringify(third.errors));
    if (!fourth.ok) throw new Error(JSON.stringify(fourth.errors));
    expect(third.value).toEqual(fourth.value);
    expect(third.value).toEqual(first);
  });

  it('varies with the seed (the seed is load-bearing, not decorative)', () => {
    const other = evolvePopulation(goldenPopulation(), goldenSelectionFunction(), goldenMutationOperator(), 'seed-other');
    if (!other.ok) throw new Error(JSON.stringify(other.errors));
    expect(other.value.successor).not.toEqual(goldenEvolution().successor);
  });

  it('derives the fitness deterministically (seeded-digest-v1)', () => {
    expect(seededDigestFitness('adv-x' as never, 'seed-1')).toBe(seededDigestFitness('adv-x' as never, 'seed-1'));
    expect(seededDigestFitness('adv-x' as never, 'seed-1')).not.toBe(seededDigestFitness('adv-x' as never, 'seed-2'));
    expect(seededDigestFitness('adv-x' as never, 'seed-1')).not.toBe(seededDigestFitness('adv-y' as never, 'seed-1'));
  });
});

describe('the declared-selection laws (no hidden fitness)', () => {
  it('refuses an infeasible retain count (selection_infeasible)', () => {
    const selection = { ...goldenSelectionFunction(), retain_count: 99 };
    const result = evolvePopulation(goldenPopulation(), selection, goldenMutationOperator(), GOLDEN_POPULATION_SEED);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('selection_infeasible');
      expect(result.errors[0]?.message).toContain('not a selection');
    }
  });

  it('refuses a selection function naming a different operator (lineage_mismatch)', () => {
    const selection = { ...goldenSelectionFunction(), operator: 'mutation-other@1' as never };
    const result = evolvePopulation(goldenPopulation(), selection, goldenMutationOperator(), GOLDEN_POPULATION_SEED);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('lineage_mismatch');
      expect(result.errors[0]?.message).toContain('declared operator');
    }
  });

  it('refuses malformed selection functions and operators (invalid_field)', () => {
    const badFitness = { ...goldenSelectionFunction(), fitness_derivation: 'secret-closure' as never };
    const fitnessResult = evolvePopulation(goldenPopulation(), badFitness, goldenMutationOperator(), GOLDEN_POPULATION_SEED);
    expect(fitnessResult.ok).toBe(false);
    if (!fitnessResult.ok) expect(fitnessResult.errors[0]?.code).toBe('invalid_field');

    const noVersion = { ...goldenSelectionFunction(), version: 0 };
    const versionResult = evolvePopulation(goldenPopulation(), noVersion, goldenMutationOperator(), GOLDEN_POPULATION_SEED);
    expect(versionResult.ok).toBe(false);

    const badOperator = { ...goldenMutationOperator(), kind: 'black-box-magic' as never };
    const operatorResult = evolvePopulation(goldenPopulation(), goldenSelectionFunction(), badOperator, GOLDEN_POPULATION_SEED);
    expect(operatorResult.ok).toBe(false);
    if (!operatorResult.ok) expect(operatorResult.errors[0]?.code).toBe('invalid_field');

    const emptySeed = evolvePopulation(goldenPopulation(), goldenSelectionFunction(), goldenMutationOperator(), '');
    expect(emptySeed.ok).toBe(false);
    if (!emptySeed.ok) expect(emptySeed.errors[0]?.message).toContain('no ambient randomness');
  });

  it('refuses an invalid population record (the untrusted form is deep-validated)', () => {
    const broken = goldenPopulationLiteral();
    (broken as { generation?: number }).generation = -1;
    const result = evolvePopulation(broken, goldenSelectionFunction(), goldenMutationOperator(), GOLDEN_POPULATION_SEED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');

    expect(evolvePopulation(null, goldenSelectionFunction(), goldenMutationOperator(), GOLDEN_POPULATION_SEED).ok).toBe(false);
    expect(evolvePopulation('population', goldenSelectionFunction(), goldenMutationOperator(), GOLDEN_POPULATION_SEED).ok).toBe(false);
  });
});

describe('the other operator kinds (the declared derivations)', () => {
  it('strategy-swap draws from the declared pool deterministically', () => {
    const operator = {
      operator_id: 'mutation-swap@1' as never,
      version: 1,
      kind: 'strategy-swap' as const,
      strategy_pool: ['strat-pool-a@1' as never, 'strat-pool-b@1' as never],
    };
    const selection = { ...goldenSelectionFunction(), operator: operator.operator_id };
    const result = evolvePopulation(goldenPopulation(), selection, operator, GOLDEN_POPULATION_SEED);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.value.born.length).toBe(2);
    const strategies = result.value.born.map((mutant) => mutant.strategy);
    // Generation 1: picks (1+0)%2 and (1+1)%2 -> both pool entries.
    expect(strategies).toEqual(['strat-pool-b@1', 'strat-pool-a@1']);
    // The blueprint is inherited under a strategy swap.
    for (const mutant of result.value.born) {
      const parent = goldenPopulation().members.find((member) => member.adversary === mutant.lineage.parent);
      expect(mutant.blueprint).toBe(parent?.blueprint);
    }
  });

  it('blueprint-recombination recombines the declared pair deterministically', () => {
    const operator = {
      operator_id: 'mutation-recombine@1' as never,
      version: 1,
      kind: 'blueprint-recombination' as const,
      strategy_pool: [],
    };
    const selection = { ...goldenSelectionFunction(), operator: operator.operator_id };
    const result = evolvePopulation(goldenPopulation(), selection, operator, GOLDEN_POPULATION_SEED);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    for (const mutant of result.value.born) {
      expect(mutant.strategy.startsWith('bp-')).toBe(false); // strategy inherited, not mutated
      expect(mutant.blueprint.startsWith('bp-mut-')).toBe(true); // the recombined blueprint
      const parent = goldenPopulation().members.find((member) => member.adversary === mutant.lineage.parent);
      expect(mutant.strategy).toBe(parent?.strategy);
    }
  });
});
