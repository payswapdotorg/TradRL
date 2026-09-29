/**
 * @tradrl/learning (service) — the self-play matchup tests (T015).
 *
 * Behavioral law coverage:
 *   - the golden matchup: the candidate vs the fielded adversary set,
 *     with its commissioned evidence batch (acceptance #8's matchup
 *     commissioning);
 *   - DETERMINISM: same inputs -> byte-identical matchup, twice;
 *   - THE FIELDABILITY LAW: a retired adversary is
 *     `adversary_not_fieldable`; an unknown adversary is too;
 *   - an empty adversary set is `population_missing` (L10);
 *   - L12: a scope mismatch between the matchup and the population is
 *     `tenant_scope_mismatch`;
 *   - malformed inputs are refused typed (candidate, stage, config,
 *     lineage, seed);
 *   - the commissioned design/jobs satisfy the commission batch laws
 *     (the matchup's evidence is spawnable).
 */

import { describe, expect, it } from 'vitest';

import { fieldMatchup } from './matchup';
import { goldenEvolvedPopulation, goldenMatchup, goldenMatchupConfig, goldenMatchupLineage, goldenPopulation } from './fixtures';
import { GOLDEN_CANDIDATE, GOLDEN_SEED } from '../curriculum/fixtures';

describe('the golden matchup', () => {
  it('pairs the candidate against the fielded adversary set with a commissioned batch', () => {
    const matchup = goldenMatchup();
    expect(matchup.matchup).toBe(goldenMatchup().matchup); // deterministic identity
    expect(matchup.candidate).toBe(GOLDEN_CANDIDATE);
    expect(matchup.stage).toBe('adversarial_population');
    expect(matchup.adversaries.length).toBe(2);
    expect(matchup.adversaries).toEqual(['adv-golden-mm-alpha', 'adv-golden-momentum-beta']);
    // The population is carried whole (fieldability evidence, L9).
    expect(matchup.population.population).toBe('pop-golden-adversaries');
    // The commissioned batch: one experiment, two arms (control + the
    // adversarial treatment), the pairing named in the intervention.
    expect(matchup.commission.jobs.length).toBe(2);
    expect(matchup.commission.design.intervention.kind).toBe('self-play-matchup');
    const parameters = matchup.commission.design.intervention.parameters as { adversaries?: readonly string[]; population?: string };
    expect(parameters.adversaries).toEqual(['adv-golden-mm-alpha', 'adv-golden-momentum-beta']);
    expect(parameters.population).toBe('pop-golden-adversaries');
    // The treatment arm names the adversary stress (L10).
    const treatment = matchup.commission.design.comparison.find((arm) => arm.role === 'treatment');
    expect(treatment?.description).toContain('fielded adversary');
  });

  it('is deterministic: the same inputs yield the byte-identical matchup, twice', () => {
    const first = goldenMatchup();
    const second = goldenMatchup();
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
  });
});

describe('the fieldability law (stage 5 and adversarial evaluation field current members)', () => {
  it('refuses a RETIRED adversary (a retained historical record, never an opponent)', () => {
    const evolved = goldenEvolvedPopulation(); // generation 1: 1 retired
    const retiredId = evolved.retired[0]?.adversary;
    if (retiredId === undefined) throw new Error('fixture bug: the golden evolution retires one adversary');
    const result = fieldMatchup(
      GOLDEN_CANDIDATE,
      evolved,
      [retiredId],
      'adversarial_population',
      goldenMatchupConfig(),
      goldenMatchupLineage(),
      GOLDEN_SEED,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('adversary_not_fieldable');
      expect(result.errors[0]?.message).toContain('RETIRED');
    }
  });

  it('refuses an UNKNOWN adversary', () => {
    const result = fieldMatchup(
      GOLDEN_CANDIDATE,
      goldenPopulation(),
      ['adv-never-existed' as never],
      'adversarial_population',
      goldenMatchupConfig(),
      goldenMatchupLineage(),
      GOLDEN_SEED,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('adversary_not_fieldable');
      expect(result.errors[0]?.message).toContain('unknown');
    }
  });

  it('refuses a duplicate fielded adversary (one adversary, one slot)', () => {
    const population = goldenPopulation();
    const first = population.members[0]?.adversary;
    if (first === undefined) throw new Error('fixture bug');
    const result = fieldMatchup(
      GOLDEN_CANDIDATE,
      population,
      [first, first],
      'adversarial_population',
      goldenMatchupConfig(),
      goldenMatchupLineage(),
      GOLDEN_SEED,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toContain('fielded twice');
    }
  });

  it('fields a retired-adversary-free set from the EVOLVED population (members field)', () => {
    const evolved = goldenEvolvedPopulation();
    const fielded = evolved.members.slice(0, 2).map((member) => member.adversary);
    const result = fieldMatchup(
      GOLDEN_CANDIDATE,
      evolved,
      fielded,
      'adversarial_population',
      goldenMatchupConfig(),
      goldenMatchupLineage(),
      GOLDEN_SEED,
    );
    expect(result.ok).toBe(true);
  });
});

describe('matchup negatives (the typed refusal paths)', () => {
  it('refuses an empty adversary set (population_missing — L10)', () => {
    const result = fieldMatchup(GOLDEN_CANDIDATE, goldenPopulation(), [], 'adversarial_population', goldenMatchupConfig(), goldenMatchupLineage(), GOLDEN_SEED);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain('population_missing');
      expect(result.errors[0]?.message).toContain('not adversarial');
    }
  });

  it('refuses a scope mismatch between the matchup and the population (L12)', () => {
    const result = fieldMatchup(
      GOLDEN_CANDIDATE,
      goldenPopulation(),
      ['adv-golden-mm-alpha' as never],
      'adversarial_population',
      goldenMatchupConfig(),
      { ...goldenMatchupLineage(), tenant: 'tenant-other' },
      GOLDEN_SEED,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain('tenant_scope_mismatch');
    }
  });

  it('refuses malformed inputs (candidate, stage, config, seed)', () => {
    const badCandidate = fieldMatchup('', goldenPopulation(), ['adv-golden-mm-alpha' as never], 'adversarial_population', goldenMatchupConfig(), goldenMatchupLineage(), GOLDEN_SEED);
    expect(badCandidate.ok).toBe(false);

    const badStage = fieldMatchup(GOLDEN_CANDIDATE, goldenPopulation(), ['adv-golden-mm-alpha' as never], 'stage-ten', goldenMatchupConfig(), goldenMatchupLineage(), GOLDEN_SEED);
    expect(badStage.ok).toBe(false);
    if (!badStage.ok) expect(badStage.errors.map((error) => error.code)).toContain('stage_unknown');

    const badConfig = fieldMatchup(GOLDEN_CANDIDATE, goldenPopulation(), ['adv-golden-mm-alpha' as never], 'adversarial_population', { ...goldenMatchupConfig(), method: 'vibes' }, goldenMatchupLineage(), GOLDEN_SEED);
    expect(badConfig.ok).toBe(false);

    const badLineage = fieldMatchup(GOLDEN_CANDIDATE, goldenPopulation(), ['adv-golden-mm-alpha' as never], 'adversarial_population', goldenMatchupConfig(), { ...goldenMatchupLineage(), goal: '' }, GOLDEN_SEED);
    expect(badLineage.ok).toBe(false);

    const badSeed = fieldMatchup(GOLDEN_CANDIDATE, goldenPopulation(), ['adv-golden-mm-alpha' as never], 'adversarial_population', goldenMatchupConfig(), goldenMatchupLineage(), '');
    expect(badSeed.ok).toBe(false);
  });

  it('refuses an invalid population record (deep validation)', () => {
    const broken = { ...goldenMatchupConfig() };
    const result = fieldMatchup(GOLDEN_CANDIDATE, { population: 'pop-x' }, ['adv-golden-mm-alpha' as never], 'adversarial_population', broken, goldenMatchupLineage(), GOLDEN_SEED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');
  });
});
