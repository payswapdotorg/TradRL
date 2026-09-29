/**
 * @tradrl/learning (service) — the selection-integrity tests (T015).
 *
 * Behavioral law coverage (acceptance #8 — the population laws):
 *   - the golden succession validates (parent -> child);
 *   - HIDING A RETIRED ADVERSARY IS A TYPED ERROR: a successor whose
 *     retained history drops a parent-retired record fails
 *     `hidden_adversary` (the work order's named negative);
 *   - a VANISHING member (neither fielded nor retired in the child)
 *     fails `hidden_adversary`;
 *   - a RESURRECTED adversary (fielded AND retired) fails
 *     `hidden_adversary`;
 *   - the succession invariants: generation jumps, foreign population
 *     ids, redeclared lineage blocks fail `lineage_mismatch`;
 *   - a mutant of a retired adversary fails `lineage_mismatch` (retired
 *     adversaries do not breed);
 *   - the history digest is deterministic; the full-history projection
 *     keeps every adversary visible (L11).
 */

import { describe, expect, it } from 'vitest';

import { evolvePopulation } from './evolution';
import { fullHistory, populationHistoryDigest, validatePopulationSuccession } from './integrity';
import type { AdversaryDescriptor, PopulationRecord } from './population';
import {
  GOLDEN_POPULATION_SEED,
  goldenEvolvedPopulation,
  goldenEvolution,
  goldenMutationOperator,
  goldenPopulation,
  goldenSelectionFunction,
} from './fixtures';

/** Evolve one more generation (the two-generation-history helper). */
function nextGeneration(record: PopulationRecord): PopulationRecord {
  const result = evolvePopulation(record, goldenSelectionFunction(), goldenMutationOperator(), `${GOLDEN_POPULATION_SEED}:${record.generation + 1}`);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value.successor;
}

describe('the golden succession (parent -> child)', () => {
  it('validates: the evolved generation is a legal successor of the founders', () => {
    const parent = goldenPopulation();
    const child = goldenEvolvedPopulation();
    const result = validatePopulationSuccession(parent, child);
    expect(result).toEqual({ ok: true, value: true });
  });

  it('retains every retired record and keeps the full history visible (L11)', () => {
    const child = goldenEvolvedPopulation();
    const history = fullHistory(child);
    // 4 fieldable + 1 retired = the 3 founders + 2 born: nothing vanished.
    expect(history.length).toBe(5);
    expect(new Set(history).size).toBe(5);
  });
});

describe('hiding is a typed error (L11 — the named negatives)', () => {
  it('refuses a successor that DROPS a retired adversary from the retained history', () => {
    // A TWO-generation history, so a genuinely-retired record exists in
    // the parent: gen0 -> gen1 (retires one) -> gen2 (must retain it).
    const gen0 = goldenPopulation();
    const gen1 = goldenEvolvedPopulation();
    const gen2 = nextGeneration(gen1);
    // The legal succession first (the control):
    expect(validatePopulationSuccession(gen1, gen2)).toEqual({ ok: true, value: true });
    // The successor hides the history (both retired records dropped):
    const hidden = { ...gen2, retired: gen2.retired.slice(0, 0) };
    const result = validatePopulationSuccession(gen1, hidden);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('hidden_adversary');
      expect(result.errors[0]?.message).toContain('retired adversary');
      expect(result.errors[0]?.message).toContain('hiding one is a typed error');
    }
  });

  it('refuses a founder-succession that hides its newly-retired record as a VANISHED member', () => {
    const parent = goldenPopulation();
    const child = goldenEvolvedPopulation();
    // Dropping the child's retired list at the FOUNDER succession: the
    // retired founder member neither fields nor retires — it vanished.
    const hidden = { ...child, retired: child.retired.slice(0, 0) };
    const result = validatePopulationSuccession(parent, hidden);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('hidden_adversary');
      expect(result.errors[0]?.message).toContain('vanished');
    }
  });

  it('refuses a successor where a parent member VANISHES (neither fielded nor retired)', () => {
    const parent = goldenPopulation();
    const child = goldenEvolvedPopulation();
    // Drop one member from the successor's fieldable set WITHOUT retiring
    // it into the history:
    const members = child.members.slice(1); // the first member vanishes
    const vanished = { ...child, members };
    const result = validatePopulationSuccession(parent, vanished);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('hidden_adversary');
      expect(result.errors[0]?.message).toContain('vanished');
    }
  });

  it('refuses a RESURRECTED adversary (a parent-retired record fielding again)', () => {
    // Two generations again: gen1 retired an adversary; gen2 must not
    // field it (the cross-generation resurrection).
    const gen1 = goldenEvolvedPopulation();
    const gen2 = nextGeneration(gen1);
    const retiredId = gen1.retired[0]?.adversary;
    if (retiredId === undefined) throw new Error('fixture bug: gen1 retires one adversary');
    const resurrectedRecord = gen1.retired[0] as AdversaryDescriptor;
    const members: readonly AdversaryDescriptor[] = [...gen2.members, resurrectedRecord];
    const retired = gen2.retired.filter((member) => member.adversary !== retiredId);
    const resurrected = { ...gen2, members, retired };
    const result = validatePopulationSuccession(gen1, resurrected);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The resurrection is a DOUBLE crime (hidden from the history AND
      // fielded): the retention check names the hiding half first; both
      // halves are the same typed error.
      expect(result.errors[0]?.code).toBe('hidden_adversary');
      expect(result.errors[0]?.message).toContain(retiredId);
      expect(result.errors[0]?.message).toContain('L11');
    }
  });
});

describe('the succession invariants (lineage_mismatch negatives)', () => {
  it('refuses a generation jump (succession increments by exactly one)', () => {
    const parent = goldenPopulation();
    const child = { ...goldenEvolvedPopulation(), generation: 5 };
    const result = validatePopulationSuccession(parent, child);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('lineage_mismatch');
      expect(result.errors[0]?.message).toContain('exactly one');
    }
  });

  it('refuses a foreign population id in the successor', () => {
    const parent = goldenPopulation();
    const child = { ...goldenEvolvedPopulation(), population: 'pop-other' as never };
    const result = validatePopulationSuccession(parent, child);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('lineage_mismatch');
    }
  });

  it('refuses a redeclared lineage block (the lineage is inherited)', () => {
    const parent = goldenPopulation();
    const child = { ...goldenEvolvedPopulation(), lineage: { ...goldenEvolvedPopulation().lineage, goal: 'goal-other' as never } };
    const result = validatePopulationSuccession(parent, child);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('lineage_mismatch');
      expect(result.errors[0]?.message).toContain('inherited');
    }
  });

  it('refuses a mutant whose parent was not fieldable (retired adversaries do not breed)', () => {
    // Two generations: gen1 retired an adversary; a gen2 mutant naming IT
    // as parent names an adversary that was NOT fieldable in gen1.
    const gen1 = goldenEvolvedPopulation();
    const gen2 = nextGeneration(gen1);
    const retiredId = gen1.retired[0]?.adversary;
    if (retiredId === undefined) throw new Error('fixture bug');
    const members: readonly AdversaryDescriptor[] = (gen2.members as readonly AdversaryDescriptor[]).map((member) =>
      member.lineage.generation === 2 ? { ...member, lineage: { ...member.lineage, parent: retiredId } } : member,
    );
    const forged = { ...gen2, members };
    const result = validatePopulationSuccession(gen1, forged);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('lineage_mismatch');
      expect(result.errors[0]?.message).toContain('do not breed');
    }
  });

  it('refuses a mutant with no operator or no parent (declared, versioned operators)', () => {
    const parent = goldenPopulation();
    const child = goldenEvolvedPopulation();
    const noOperator = {
      ...child,
      members: child.members.map((member) =>
        member.lineage.generation === 1 ? { ...member, lineage: { ...member.lineage, operator: null } } : member,
      ),
    };
    const operatorResult = validatePopulationSuccession(parent, noOperator);
    expect(operatorResult.ok).toBe(false);
    if (!operatorResult.ok) {
      expect(operatorResult.errors[0]?.message).toContain('mutation operator');
    }

    const noParent = {
      ...child,
      members: child.members.map((member) =>
        member.lineage.generation === 1 ? { ...member, lineage: { ...member.lineage, parent: null } } : member,
      ),
    };
    const parentResult = validatePopulationSuccession(parent, noParent);
    expect(parentResult.ok).toBe(false);
    if (!parentResult.ok) {
      expect(parentResult.errors[0]?.message).toContain('no parent');
    }
  });

  it('refuses invalid parent/child records at the root', () => {
    expect(validatePopulationSuccession(null, goldenEvolvedPopulation()).ok).toBe(false);
    expect(validatePopulationSuccession(goldenPopulation(), null).ok).toBe(false);
    expect(validatePopulationSuccession('population', 'population').ok).toBe(false);
  });
});

describe('the history digest (deterministic, byte-bound)', () => {
  it('digests the same record to the same value, twice', () => {
    const child = goldenEvolvedPopulation();
    expect(populationHistoryDigest(child)).toBe(populationHistoryDigest(child));
    expect(populationHistoryDigest(child)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('digests different generations differently (the digest binds the record)', () => {
    expect(populationHistoryDigest(goldenPopulation())).not.toBe(populationHistoryDigest(goldenEvolvedPopulation()));
  });

  it('digests the golden evolution stably across runs (byte-stable fixture)', () => {
    const first = populationHistoryDigest(goldenEvolution().successor);
    const second = populationHistoryDigest(goldenEvolution().successor);
    expect(first).toBe(second);
  });
});
