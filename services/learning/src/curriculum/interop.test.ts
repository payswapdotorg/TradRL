/**
 * Cross-package interoperability trip wires for the curriculum lane (T015).
 *
 * The curriculum lane's mirrors are proven against the REAL canonical
 * packages PRESENT on this branch (static relative imports — the
 * compute/rl-protocol interop precedent; the frozen write surface permits
 * test-only imports):
 *
 *   - @tradrl/experiments (T011): the ExperimentDesign / ArmDescriptor /
 *     InterventionDescriptor / TrialRecord EXACT mirror equalities, and
 *     the runtime proof that every GOLDEN PLAN commission (designs AND
 *     planned trials) passes the REAL experiments validators — the
 *     curriculum's spawned experiments ARE experiments-lane evidence.
 *   - @tradrl/compute (T014): the EpisodeJob / JobLineage / DriverConfig
 *     mirrors, the trial-id derivation parity
 *     (`commissionedTrialId` === `deriveJobTrialId`), and the runtime
 *     proof that every golden job spec passes the REAL
 *     `validateEpisodeJob` and the golden batch plans a REAL
 *     `planComputeSchedule` — the compute layer can execute what the
 *     curriculum commissions.
 *   - @tradrl/rl-protocol (T013): the LearningMethod taxonomy parity
 *     (LEARNING-LOOP.md "Method selection"), the WorldMode/FidelityMode
 *     parity (L5/L6), the Seed brand parity, TimestampMs parity.
 *   - @tradrl/organization (T016): the CapabilityGap EXACT mirror
 *     equality (both directions), the six-kind vocabulary parity
 *     (LEARNING-LOOP.md "Failure-driven learning"), the runtime proof
 *     that a REAL organization gap record satisfies this lane's mirror
 *     guard and vice versa, and the Goal/Constraint/Tenant/Project
 *     reference parities.
 *   - @tradrl/evaluation (T012): the VerdictId / AcceptanceCriteriaId /
 *     CriteriaRef brand parities — the evidence gate cites evaluation
 *     verdicts through the same identity spaces.
 *
 * Type-level assertions fail `pnpm typecheck`; runtime assertions fail
 * `pnpm test`. Either way, a mirror can never drift silently (D-003/D-004).
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as curriculumGaps from './gaps';
import * as ladder from './ladder';
import * as primitives from './primitives';
import * as mirrorGuards from './commission';
import { commissionedTrialId } from './commission';
import { GOLDEN_TENANT, goldenPlan } from './fixtures';
import type { CapabilityGapMirror } from './gaps';

import * as experiments from '../../../../packages/experiments/src/index';
import * as compute from '../../../../packages/compute/src/index';
import * as rl from '../../../../packages/rl-protocol/src/index';
import * as organization from '../../../../packages/organization/src/index';
import * as evaluation from '../../../../packages/evaluation/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the curriculum lane's ExperimentDesign IS the experiments-lane design. */
function designIsCanonical(design: import('./commission').ExperimentDesignMirror): experiments.ExperimentDesign {
  return design;
}

/** Compiles iff a REAL experiments design satisfies the curriculum mirror. */
function canonicalDesignIsMirror(design: experiments.ExperimentDesign): import('./commission').ExperimentDesignMirror {
  return design;
}

/** Compiles iff the curriculum lane's TrialRecord IS the experiments-lane record. */
function trialIsCanonical(trial: import('./commission').TrialRecordMirror): experiments.TrialRecord {
  return trial;
}

/** Compiles iff a REAL experiments trial satisfies the curriculum mirror. */
function canonicalTrialIsMirror(trial: experiments.TrialRecord): import('./commission').TrialRecordMirror {
  return trial;
}

/** Compiles iff the curriculum lane's job spec IS the compute-lane EpisodeJob. */
function jobIsCanonical(job: import('./commission').EpisodeJobSpecMirror): compute.EpisodeJob {
  return job;
}

/** Compiles iff a REAL compute EpisodeJob satisfies the curriculum mirror. */
function canonicalJobIsMirror(job: compute.EpisodeJob): import('./commission').EpisodeJobSpecMirror {
  return job;
}

/** Compiles iff the curriculum lane's CapabilityGap IS the organization-lane gap (BOTH directions). */
function gapIsCanonical(gap: CapabilityGapMirror): organization.CapabilityGap {
  return gap;
}

function canonicalGapIsMirror(gap: organization.CapabilityGap): CapabilityGapMirror {
  return gap;
}

// ---------------------------------------------------------------------------
// The experiments lane (T011)
// ---------------------------------------------------------------------------

describe('the experiments lane (T011) — the commission mirrors', () => {
  it('ExperimentDesign is EXACTLY the experiments-lane design (mutually assignable)', () => {
    expectTypeOf<import('./commission').ExperimentDesignMirror>().toEqualTypeOf<experiments.ExperimentDesign>();
    expectTypeOf<import('./commission').ArmDescriptorMirror>().toEqualTypeOf<experiments.ArmDescriptor>();
    expectTypeOf<import('./commission').InterventionDescriptorMirror>().toEqualTypeOf<import('../../../../packages/experiments/src/design').InterventionDescriptor>();
    expectTypeOf<import('./commission').ArmRoleMirror>().toEqualTypeOf<experiments.ArmRole>();
    // The identity spaces are the same brands.
    expectTypeOf<import('./ids').ExperimentId>().toEqualTypeOf<experiments.ExperimentId>();
    expectTypeOf<import('./ids').TrialId>().toEqualTypeOf<experiments.TrialId>();
    expectTypeOf<import('./ids').ArmId>().toEqualTypeOf<experiments.ArmId>();
    expectTypeOf<import('./ids').TrajectoryId>().toEqualTypeOf<experiments.TrajectoryId>();
    expectTypeOf<import('./ids').EnvironmentConfigRef>().toEqualTypeOf<experiments.EnvironmentConfigRef>();
    expectTypeOf<import('./ids').EvaluatorVersionRef>().toEqualTypeOf<experiments.EvaluatorVersionRef>();
    expectTypeOf<import('./ids').SplitPolicyRef>().toEqualTypeOf<experiments.SplitPolicyRef>();
    expectTypeOf<import('./ids').DataRef>().toEqualTypeOf<experiments.DataRef>();
    expectTypeOf<import('./ids').CriteriaRef>().toEqualTypeOf<experiments.CriteriaRef>();
  });

  it('every golden-plan commission design passes the REAL experiments validator', () => {
    const plan = goldenPlan();
    for (const stage of plan.stages) {
      const validated = experiments.validateExperimentDesign(stage.commission.design);
      expect(validated.ok).toBe(true);
      if (validated.ok) {
        // The round-trip witness (mutual assignability at runtime).
        expect(designIsCanonical(stage.commission.design)).toEqual(validated.value);
        expect(canonicalDesignIsMirror(validated.value)).toEqual(stage.commission.design);
      }
    }
  });

  it('TrialRecord is EXACTLY the experiments-lane record and planned trials pass the REAL validator', () => {
    expectTypeOf<import('./commission').TrialRecordMirror>().toEqualTypeOf<experiments.TrialRecord>();
    expectTypeOf<import('./commission').TrialStatusMirror>().toEqualTypeOf<experiments.TrialStatus>();
    const plan = goldenPlan();
    for (const stage of plan.stages) {
      for (const job of stage.commission.jobs) {
        // The planned trials of the commission (one per episode ordinal).
        const trials = [
          ...Array.from({ length: job.seed_range.end - job.seed_range.start }, (_, index) => ({
            trial_id: commissionedTrialId(job.job_id, job.seed_range.start + index),
            arm: job.arm,
            status: 'planned' as const,
            trajectory: null,
            outcome: null,
            started_at: null,
            ended_at: null,
            failure_reason: null,
          })),
        ];
        for (const trial of trials) {
          const validated = experiments.validateTrialRecord(trial);
          expect(validated.ok).toBe(true);
          if (validated.ok) {
            expect(trialIsCanonical(trial)).toEqual(validated.value);
            expect(canonicalTrialIsMirror(validated.value)).toEqual(trial);
          }
        }
      }
    }
  });

  it('a REAL experiments record satisfies the mirror guards (the runtime half)', () => {
    const plan = goldenPlan();
    const design = plan.stages[0]?.commission.design;
    if (design === undefined) throw new Error('fixture bug');
    const validated = experiments.validateExperimentDesign(design);
    if (!validated.ok) throw new Error(JSON.stringify(validated.errors));
    // The canonical record satisfies this lane's mirror guard.
    const mirrorGuard = mirrorGuards.isExperimentDesignMirror;
    expect(mirrorGuard(validated.value)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The compute lane (T014)
// ---------------------------------------------------------------------------

describe('the compute lane (T014) — the episode job mirrors', () => {
  it('EpisodeJobSpec is EXACTLY the compute-lane EpisodeJob (mutually assignable)', () => {
    expectTypeOf<import('./commission').EpisodeJobSpecMirror>().toEqualTypeOf<compute.EpisodeJob>();
    expectTypeOf<import('./commission').JobLineageMirror>().toEqualTypeOf<compute.JobLineage>();
    expectTypeOf<import('./commission').DriverConfigMirror>().toEqualTypeOf<compute.DriverConfig>();
    expectTypeOf<import('./commission').SeedRangeMirror>().toEqualTypeOf<compute.SeedRange>();
    expectTypeOf<import('./ids').JobId>().toEqualTypeOf<compute.JobId>();
    expectTypeOf<import('./ids').PolicyRef>().toEqualTypeOf<compute.PolicyRef>();
    expectTypeOf<import('./ids').Seed>().toEqualTypeOf<compute.Seed>();
  });

  it('every golden job spec passes the REAL compute validator', () => {
    const plan = goldenPlan();
    for (const stage of plan.stages) {
      for (const job of stage.commission.jobs) {
        const validated = compute.validateEpisodeJob(job);
        expect(validated.ok).toBe(true);
        if (validated.ok) {
          expect(jobIsCanonical(job)).toEqual(validated.value);
          expect(canonicalJobIsMirror(validated.value)).toEqual(job);
        }
      }
    }
  });

  it("the golden batch plans a REAL compute schedule (the compute layer can execute what we commission)", () => {
    const plan = goldenPlan();
    const stage = plan.stages[0];
    if (stage === undefined) throw new Error('fixture bug');
    const literals = stage.commission.jobs.map((job) => JSON.parse(JSON.stringify(job)) as Record<string, unknown>);
    const schedule = compute.planComputeSchedule('run-curriculum-interop' as compute.ComputeRunId, literals, 2);
    expect(schedule.ok).toBe(true);
    if (schedule.ok) {
      // One experiment's batch: every task's job names the commissioned
      // experiment; the partition covers both arms' ordinals.
      const jobs = schedule.value.tasks.map((task) => task.job);
      expect(new Set(jobs.map((job) => job.job_id)).size).toBe(2);
      expect(jobs.every((job) => job.lineage.experiment === stage.commission.experiment)).toBe(true);
      expect(schedule.value.tasks.length).toBeGreaterThan(0);
    }
  });

  it("the trial-id derivation parity: commissionedTrialId === the compute lane's deriveJobTrialId", () => {
    for (const [jobId, ordinal] of [
      ['job-golden-control', 0],
      ['job-golden-control', 5],
      ['job-golden-treatment', 12],
      ['job-anything', 999],
    ] as const) {
      expect(commissionedTrialId(jobId as never, ordinal)).toBe(compute.deriveJobTrialId(jobId as never, ordinal));
    }
  });

  it('the shared digest discipline: fnv1a32Hex parity with the compute lane', () => {
    for (const sample of ['', 'a', 'curriculum|stage|seed', 'Ünicode ✓ text']) {
      expect(primitives.fnv1a32Hex(sample)).toBe(compute.fnv1a32Hex(sample));
    }
    expect(primitives.canonicalJson({ b: 2, a: [1, { z: null, y: 'x' }] })).toBe(
      compute.canonicalJson({ b: 2, a: [1, { z: null, y: 'x' }] }),
    );
  });
});

// ---------------------------------------------------------------------------
// The rl-protocol lane (T013)
// ---------------------------------------------------------------------------

describe('the rl-protocol lane (T013) — the taxonomy and fidelity mirrors', () => {
  it('LearningMethodMirror is the protocol taxonomy (the LEARNING-LOOP method union)', () => {
    expectTypeOf<curriculumGaps.LearningMethodMirror>().toEqualTypeOf<rl.LearningMethod>();
    expect([...curriculumGaps.LEARNING_METHODS_MIRROR]).toEqual([...rl.LEARNING_METHODS]);
    for (const method of rl.LEARNING_METHODS) {
      expect(curriculumGaps.isLearningMethodMirror(method)).toBe(true);
    }
    expect(curriculumGaps.isLearningMethodMirror('statistical-causal')).toBe(false); // deliberately not a member
    expect(curriculumGaps.isLearningMethodMirror('vibes')).toBe(false);
  });

  it('WorldMode is the protocol FidelityMode (L5/L6)', () => {
    expectTypeOf<ladder.WorldMode>().toEqualTypeOf<rl.FidelityMode>();
    expect([...ladder.WORLD_MODES]).toEqual([...rl.FIDELITY_MODES]);
    expect(ladder.isWorldMode('exact_replay')).toBe(rl.isFidelityMode('exact_replay'));
    expect(ladder.isWorldMode('simulation')).toBe(false);
  });

  it('TimestampMs and the reference brands are mutually assignable', () => {
    expectTypeOf<import('./primitives').TimestampMs>().toEqualTypeOf<rl.TimestampMs>();
    expectTypeOf<import('./primitives').TimestampMs>().toEqualTypeOf<experiments.TimestampMs>();
    expectTypeOf<import('./primitives').TimestampMs>().toEqualTypeOf<compute.TimestampMs>();
    expectTypeOf<import('./primitives').TimestampMs>().toEqualTypeOf<organization.TimestampMs>();
    expectTypeOf<import('./primitives').TimestampMs>().toEqualTypeOf<evaluation.TimestampMs>();
    expectTypeOf<import('./ids').RewardModelRef>().toEqualTypeOf<compute.RewardModelRef>();
    expectTypeOf<import('./ids').AgentInstanceId>().toEqualTypeOf<compute.AgentInstanceId>();
    expectTypeOf<import('./ids').RuntimeRef>().toEqualTypeOf<compute.RuntimeRef>();
    expectTypeOf<import('./ids').BodyVersionRef>().toEqualTypeOf<compute.BodyVersionRef>();
    expectTypeOf<import('./ids').SubstrateRef>().toEqualTypeOf<compute.SubstrateRef>();
    expectTypeOf<import('./ids').TenantId>().toEqualTypeOf<compute.TenantId>();
    expectTypeOf<import('./ids').ProjectId>().toEqualTypeOf<compute.ProjectId>();
    expectTypeOf<import('./ids').OrganizationId>().toEqualTypeOf<experiments.OrganizationId>();
  });
});

// ---------------------------------------------------------------------------
// The organization lane (T016) — the CapabilityGap interlock
// ---------------------------------------------------------------------------

describe('the organization lane (T016) — the CapabilityGap interlock', () => {
  it('CapabilityGapMirror is EXACTLY the organization-lane gap (mutually assignable, both directions)', () => {
    expectTypeOf<CapabilityGapMirror>().toEqualTypeOf<organization.CapabilityGap>();
    expectTypeOf<curriculumGaps.CapabilityGapKind>().toEqualTypeOf<organization.CapabilityGapKind>();
    expectTypeOf<import('./ids').CapabilityGapId>().toEqualTypeOf<organization.CapabilityGapId>();
    expectTypeOf<import('./ids').CapabilityKey>().toEqualTypeOf<organization.CapabilityKey>();
    expectTypeOf<import('./ids').AttainmentEvidenceRef>().toEqualTypeOf<organization.AttainmentEvidenceRef>();
  });

  it('the six failure classes are the same vocabulary (LEARNING-LOOP.md, kind for kind)', () => {
    expect([...curriculumGaps.CAPABILITY_GAP_KINDS]).toEqual([...organization.CAPABILITY_GAP_KINDS]);
    for (const kind of organization.CAPABILITY_GAP_KINDS) {
      expect(curriculumGaps.isCapabilityGapKind(kind)).toBe(true);
    }
    for (const kind of curriculumGaps.CAPABILITY_GAP_KINDS) {
      expect(organization.isCapabilityGapKind(kind)).toBe(true);
    }
  });

  it('a REAL organization gap record satisfies this lane\'s mirror guard, and vice versa', () => {
    // A record the ORGANIZATION lane accepts (built through its guard).
    const realGap = {
      gapId: 'gap-interop-real',
      kind: 'liquidity',
      capabilityKey: 'liquidity-provision-modeling',
      evidenceRef: 'evidence-interop-real-failure',
      detectedAt: 1_700_000_000_000,
      tenantId: GOLDEN_TENANT,
      projectId: 'prj-golden',
    };
    // The literal is untrusted-shaped (plain strings); the guards are the
    // runtime proof, and the witnesses are fed the narrowed record.
    const asMirror: CapabilityGapMirror = curriculumGaps.isCapabilityGapMirror(realGap) ? (realGap as CapabilityGapMirror) : undefined as never;
    const asCanonical: organization.CapabilityGap = organization.isCapabilityGap(realGap) ? (realGap as organization.CapabilityGap) : undefined as never;
    expect(gapIsCanonical(asMirror)).toEqual(realGap);
    expect(canonicalGapIsMirror(asCanonical)).toEqual(realGap);
    // And this lane's guard REFUSES what the organization guard refuses.
    const brokenGap = { ...realGap, kind: 'vibes' };
    expect(organization.isCapabilityGap(brokenGap)).toBe(false);
    expect(curriculumGaps.isCapabilityGapMirror(brokenGap)).toBe(false);
    const labelGap = { ...realGap, capabilityKey: 'is-a-professional-label' };
    expect(organization.isCapabilityGap(labelGap)).toBe(true); // the org guard checks the pattern, not the semantics
    expect(curriculumGaps.isCapabilityGapMirror(labelGap)).toBe(true); // mirror parity: same pattern discipline
  });

  it('the goal/constraint/scope reference brands are mutually assignable', () => {
    expectTypeOf<import('./ids').GoalRef>().toEqualTypeOf<organization.GoalRef>();
    expectTypeOf<import('./ids').ConstraintSetRef>().toEqualTypeOf<organization.ConstraintSetRef>();
    expectTypeOf<import('./ids').TenantId>().toEqualTypeOf<organization.TenantId>();
    expectTypeOf<import('./ids').ProjectId>().toEqualTypeOf<organization.ProjectId>();
  });
});

// ---------------------------------------------------------------------------
// The evaluation lane (T012) — the evidence-citation identity spaces
// ---------------------------------------------------------------------------

describe('the evaluation lane (T012) — the evidence-citation identities', () => {
  it('VerdictId / AcceptanceCriteriaId / CriteriaRef are the evaluation-lane brands', () => {
    expectTypeOf<import('./ids').VerdictId>().toEqualTypeOf<evaluation.VerdictId>();
    expectTypeOf<import('./ids').AcceptanceCriteriaId>().toEqualTypeOf<evaluation.AcceptanceCriteriaId>();
    expectTypeOf<import('./ids').CriteriaRef>().toEqualTypeOf<evaluation.CriteriaRef>();
    // The runtime guards agree.
    expect(evaluation.isVerdictId('verdict-golden-historical_replay')).toBe(true);
    expect(evaluation.isAcceptanceCriteriaId('criteria-golden@1')).toBe(true);
    expect(evaluation.isCriteriaRef('criteria-historical_replay@1')).toBe(true);
  });
});
