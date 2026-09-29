/**
 * @tradrl/learning (service) — the population record tests (T015).
 *
 * Behavioral law coverage:
 *   - the golden founder population validates (immutable, versioned);
 *   - L9 lineage negatives: a member whose lineage names a foreign
 *     population, a member born in a future generation;
 *   - L12 negatives: a missing tenant/project on the record, a member
 *     whose scope disagrees with the population's;
 *   - the uniqueness laws: duplicate member ids, a member in both lists;
 *   - the fieldability projections (members vs retired; isFieldable);
 *   - determinism of validation and deep-freeze of the validated record.
 */

import { describe, expect, it } from 'vitest';

import {
  fieldableAdversaries,
  generationKind,
  isFieldable,
  isPopulationRecord,
  retiredAdversaries,
  validatePopulationRecord,
} from './population';
import { GOLDEN_POPULATION, goldenPopulation, goldenPopulationLiteral } from './fixtures';

describe('the golden founder population', () => {
  it('validates with three founders over the golden scope', () => {
    const population = goldenPopulation();
    expect(isPopulationRecord(population)).toBe(true);
    expect(population.population).toBe(GOLDEN_POPULATION);
    expect(population.generation).toBe(0);
    expect(generationKind(population)).toBe('founders');
    expect(population.members.length).toBe(3);
    expect(population.retired).toEqual([]);
    expect(fieldableAdversaries(population)).toEqual([
      'adv-golden-mm-alpha',
      'adv-golden-momentum-beta',
      'adv-golden-liquidity-gamma',
    ]);
    // The lineage block (L9/L12).
    expect(population.lineage.goal).toBe('goal-golden');
    expect(population.lineage.tenant).toBe('tenant-golden');
    expect(population.lineage.project).toBe('prj-golden');
    // Founders carry no parent and no operator.
    for (const member of population.members) {
      expect(member.lineage.parent).toBeNull();
      expect(member.lineage.operator).toBeNull();
      expect(member.lineage.generation).toBe(0);
      expect(member.blueprint.length).toBeGreaterThan(0); // the T016 interlock ref
    }
  });

  it('is deterministic and deeply frozen', () => {
    const first = goldenPopulation();
    const second = goldenPopulation();
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.members)).toBe(true);
    expect(() => {
      (first.members as unknown as unknown[]).push(first.members[0] as never);
    }).toThrow();
  });

  it('projects fieldability: members field, retired do not', () => {
    const population = goldenPopulation();
    expect(isFieldable(population, 'adv-golden-mm-alpha' as never)).toBe(true);
    expect(isFieldable(population, 'adv-golden-momentum-beta' as never)).toBe(true);
    expect(isFieldable(population, 'adv-golden-liquidity-gamma' as never)).toBe(true);
    expect(isFieldable(population, 'adv-unknown' as never)).toBe(false);
    expect(retiredAdversaries(population)).toEqual([]);
  });
});

describe('population validation negatives', () => {
  it('refuses a member whose lineage names a foreign population (L9)', () => {
    const literal = goldenPopulationLiteral();
    const members = (literal.members as Record<string, unknown>[]).map((member, index) =>
      index === 0
        ? { ...member, lineage: { ...(member.lineage as Record<string, unknown>), population: 'pop-other' } }
        : member,
    );
    (literal as { members?: unknown }).members = members;
    const result = validatePopulationRecord(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain('lineage_mismatch');
    }
  });

  it('refuses a member born in a future generation (L9)', () => {
    const literal = goldenPopulationLiteral();
    const members = (literal.members as Record<string, unknown>[]).map((member, index) =>
      index === 1
        ? { ...member, lineage: { ...(member.lineage as Record<string, unknown>), generation: 7 } } // the record is generation 0
        : member,
    );
    (literal as { members?: unknown }).members = members;
    const result = validatePopulationRecord(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain('lineage_mismatch');
    }
  });

  it('refuses a missing or malformed tenant/project (L12 negatives)', () => {
    const noTenant = goldenPopulationLiteral();
    (noTenant.lineage as { tenant?: string }).tenant = '';
    const tenantResult = validatePopulationRecord(noTenant);
    expect(tenantResult.ok).toBe(false);
    if (!tenantResult.ok) expect(tenantResult.errors.map((error) => error.code)).toContain('lineage_gap');

    const noProject = goldenPopulationLiteral();
    delete (noProject.lineage as { project?: string }).project;
    const projectResult = validatePopulationRecord(noProject);
    expect(projectResult.ok).toBe(false);
    if (!projectResult.ok) expect(projectResult.errors.map((error) => error.code)).toContain('lineage_gap');
  });

  it('refuses a member whose scope disagrees with the population (L12)', () => {
    const literal = goldenPopulationLiteral();
    const members = literal.members as { tenantId: string }[];
    members[2].tenantId = 'tenant-other';
    const result = validatePopulationRecord(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain('tenant_scope_mismatch');
    }
  });

  it('refuses duplicate member ids (one identity, one adversary, forever)', () => {
    const literal = goldenPopulationLiteral();
    const members = literal.members as unknown[];
    members.push({ ...(members[0] as object) }); // duplicate id
    const result = validatePopulationRecord(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.message.includes('duplicate adversary id'))).toBe(true);
    }
  });

  it('refuses a member in both lists (retained, not duplicated)', () => {
    const literal = goldenPopulationLiteral();
    const retired = literal.retired as { adversary: string }[];
    retired.push((literal.members as { adversary: string }[])[0] as { adversary: string }); // a member cannot also be retired
    const result = validatePopulationRecord(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.message.includes('appears twice'))).toBe(true);
    }
  });

  it('refuses an empty member list (a population of nothing fields nothing, L10)', () => {
    const literal = goldenPopulationLiteral();
    (literal as { members?: unknown }).members = [];
    const result = validatePopulationRecord(literal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.message.includes('fields nothing'))).toBe(true);
    }
  });

  it('refuses non-objects at the root', () => {
    expect(validatePopulationRecord(null).ok).toBe(false);
    expect(validatePopulationRecord('population').ok).toBe(false);
    expect(validatePopulationRecord([]).ok).toBe(false);
    expect(validatePopulationRecord(42).ok).toBe(false);
  });

  it('is pure: an untrusted input is never mutated', () => {
    const literal = JSON.parse(JSON.stringify(goldenPopulationLiteral())) as Record<string, unknown>;
    const snapshot = JSON.parse(JSON.stringify(literal)) as unknown;
    validatePopulationRecord(literal);
    expect(literal).toEqual(snapshot);
  });
});
