/**
 * Cross-package interoperability trip wires for the populations lane
 * (T015).
 *
 * The populations lane's mirrors and commissions are proven against the
 * REAL canonical packages PRESENT on this branch (static relative
 * imports — the curriculum interop precedent; the frozen write surface
 * permits test-only imports):
 *
 *   - @tradrl/organization (T016): the AdversaryBlueprintRef EXACT mirror
 *     equality (the blueprint refs adversaries cite are the organization
 *     lane's `AdversaryBlueprintRef` brand — the populations/organization
 *     interlock is opaque refs, never imports), and the runtime proof
 *     that the golden population's blueprint refs satisfy the REAL
 *     organization guard.
 *   - @tradrl/experiments (T011): the runtime proof that the GOLDEN
 *     MATCHUP's commissioned design passes the REAL
 *     `validateExperimentDesign` — a self-play matchup's evidence batch
 *     IS experiments-lane evidence.
 *   - @tradrl/compute (T014): the runtime proof that the matchup's job
 *     specs pass the REAL `validateEpisodeJob` and plan a REAL
 *     `planComputeSchedule` — the compute layer can execute what a
 *     matchup commissions.
 *
 * Type-level assertions fail `pnpm typecheck`; runtime assertions fail
 * `pnpm test`. Either way, a mirror can never drift silently
 * (D-003/D-004).
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { AdversaryBlueprintRef } from '../curriculum/ids';
import { goldenMatchup, goldenPopulation } from './fixtures';

import * as experiments from '../../../../packages/experiments/src/index';
import * as compute from '../../../../packages/compute/src/index';
import * as organization from '../../../../packages/organization/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS
// ---------------------------------------------------------------------------

/** Compiles iff this lane's AdversaryBlueprintRef IS the organization lane's brand. */
function blueprintRefIsCanonical(ref: AdversaryBlueprintRef): organization.AdversaryBlueprintRef {
  return ref;
}

/** Compiles iff a REAL organization blueprint ref satisfies this lane's mirror. */
function canonicalBlueprintRefIsMirror(ref: organization.AdversaryBlueprintRef): AdversaryBlueprintRef {
  return ref;
}

// ---------------------------------------------------------------------------
// The organization lane (T016) — the blueprint interlock
// ---------------------------------------------------------------------------

describe('the organization lane (T016) — the adversary-blueprint interlock', () => {
  it('AdversaryBlueprintRef is EXACTLY the organization-lane brand (mutually assignable)', () => {
    expectTypeOf<AdversaryBlueprintRef>().toEqualTypeOf<organization.AdversaryBlueprintRef>();
  });

  it('the golden population\'s blueprint refs satisfy the REAL organization guard', () => {
    const population = goldenPopulation();
    for (const member of population.members) {
      expect(organization.isAdversaryBlueprintRef(member.blueprint)).toBe(true);
      expect(blueprintRefIsCanonical(member.blueprint)).toBe(member.blueprint);
      expect(canonicalBlueprintRefIsMirror(member.blueprint)).toBe(member.blueprint);
    }
    // And the organization guard's refusals are shared (the opaque-ref
    // discipline: no edge whitespace, no control characters).
    expect(organization.isAdversaryBlueprintRef(' leading-space')).toBe(false);
    expect(organization.isAdversaryBlueprintRef('trailing-space ')).toBe(false);
    expect(organization.isAdversaryBlueprintRef('')).toBe(false);
  });

  it('the goal/scope reference brands are mutually assignable with the organization lane', () => {
    expectTypeOf<import('./ids').PopulationId>().not.toEqualTypeOf<organization.GoalRef>(); // distinct identity spaces stay distinct
    expectTypeOf<import('../curriculum/ids').GoalRef>().toEqualTypeOf<organization.GoalRef>();
    expectTypeOf<import('../curriculum/ids').TenantId>().toEqualTypeOf<organization.TenantId>();
    expectTypeOf<import('../curriculum/ids').ProjectId>().toEqualTypeOf<organization.ProjectId>();
  });
});

// ---------------------------------------------------------------------------
// The experiments lane (T011) — the matchup commission
// ---------------------------------------------------------------------------

describe('the experiments lane (T011) — the matchup commission', () => {
  it('the golden matchup\'s commissioned design passes the REAL experiments validator', () => {
    const matchup = goldenMatchup();
    const validated = experiments.validateExperimentDesign(matchup.commission.design);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.value.intervention.kind).toBe('self-play-matchup');
      expect(validated.value.comparison.length).toBe(2);
      expect(validated.value.candidate_organization).toBe(matchup.candidate);
    }
  });

  it('the matchup\'s commission satisfies this lane\'s own batch validation (defense in depth)', async () => {
    const { validateCommissionedBatch } = await import('../curriculum/commission');
    const matchup = goldenMatchup();
    const validated = validateCommissionedBatch(matchup.commission);
    expect(validated.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The compute lane (T014) — the matchup's executable commissions
// ---------------------------------------------------------------------------

describe('the compute lane (T014) — the matchup\'s executable commissions', () => {
  it('every matchup job spec passes the REAL compute validator', () => {
    const matchup = goldenMatchup();
    for (const job of matchup.commission.jobs) {
      const validated = compute.validateEpisodeJob(job);
      expect(validated.ok).toBe(true);
      if (validated.ok) {
        expect(validated.value.lineage.tenant).toBe(matchup.lineage.tenant);
        expect(validated.value.lineage.experiment).toBe(matchup.commission.experiment);
      }
    }
  });

  it("the matchup's batch plans a REAL compute schedule", () => {
    const matchup = goldenMatchup();
    const literals = matchup.commission.jobs.map((job) => JSON.parse(JSON.stringify(job)) as Record<string, unknown>);
    const schedule = compute.planComputeSchedule('run-matchup-interop' as compute.ComputeRunId, literals, 1);
    expect(schedule.ok).toBe(true);
    if (schedule.ok) {
      expect(schedule.value.tasks.length).toBe(2); // one task per job at worker count 1
      const ordinals = schedule.value.tasks.flatMap((task) => {
        const range: number[] = [];
        for (let ordinal = task.seed_range.start; ordinal < task.seed_range.end; ordinal++) range.push(ordinal);
        return range;
      });
      expect(ordinals).toEqual([0, 1, 2, 3, 4, 5]); // 3 episodes per arm, zero overlap
    }
  });
});
