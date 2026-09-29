/**
 * @tradrl/learning (service) — the curriculum plan tests (T015).
 *
 * Behavioral law coverage:
 *   - the golden plan: the ordered climb (entry rung .. earned rung) plus
 *     the gap-driven stages, each stage citing its motivating gap or the
 *     ladder (acceptance #3's golden plan);
 *   - DETERMINISM: same inputs -> byte-identical plan, deep-equal, TWICE
 *     (acceptance #3);
 *   - the STAGE-9 GATE: a plan whose earned rung is `controlled_live`
 *     without the permission record STOPS at shadow_trading and records
 *     the typed refusal; with the permission it schedules all nine rungs
 *     (acceptance #5);
 *   - GAP-DRIVEN REPLANNING: each CapabilityGap kind selects the declared
 *     stage + method (table-driven over all six kinds — acceptance #9);
 *   - L12: a foreign-scope gap is a typed `tenant_scope_mismatch`;
 *   - the plan never schedules unearned rungs (the ladder order);
 *   - immutability: the returned plan is deeply frozen.
 */

import { describe, expect, it } from 'vitest';

import { CURRICULUM_STAGES, stagePosition } from './ladder';
import { CAPABILITY_GAP_KINDS } from './gaps';
import { gapDrivenSelections, isCurriculumPlan, planCurriculum } from './plan';
import {
  GOLDEN_LIVE_PERMISSION,
  GOLDEN_T0,
  goldenCurriculumVersion,
  goldenGaps,
  goldenPlan,
  goldenPlanInput,
} from './fixtures';

describe('the golden plan', () => {
  it('climbs from the entry rung to the earned rung, then appends gap-driven stages', () => {
    const plan = goldenPlan();
    expect(isCurriculumPlan(plan)).toBe(true);
    const stages = plan.stages.map((stage) => stage.stage);
    // The climb: only the entry rung is earned.
    expect(stages[0]).toBe('synthetic_regimes');
    // Gap-driven insertions: execution -> microstructure_friction,
    // coordination -> reactive_market (regime's synthetic_regimes is
    // already on the climb — deduped by stage kind).
    expect(stages).toEqual(['synthetic_regimes', 'microstructure_friction', 'reactive_market']);
    // Every climb stage is motivated by the ladder; every appended stage
    // by a gap (the plan cites which gap motivated the stage).
    expect(plan.stages[0]?.motivation.kind).toBe('ladder');
    expect(plan.stages[1]?.motivation.kind).toBe('gap');
    expect(plan.stages[1]?.motivation.gapId).toBe('gap-golden-execution');
    expect(plan.stages[2]?.motivation.kind).toBe('gap');
    expect(plan.stages[2]?.motivation.gapId).toBe('gap-golden-coordination');
    // Every stage carries its commission (the spawned experiment).
    for (const stage of plan.stages) {
      expect(stage.commission.jobs.length).toBe(2); // control + treatment
      expect(stage.motivation.experiment).toBe(stage.commission.experiment);
    }
    // The target is the earned rung; no refusal.
    expect(plan.target).toBe('synthetic_regimes');
    expect(plan.live_gate).toBeNull();
    // L9/L12 lineage.
    expect(plan.lineage.goal).toBe('goal-golden');
    expect(plan.lineage.curriculum_version).toBe('curriculum@1.0.0');
    expect(plan.lineage.tenant).toBe('tenant-golden');
    expect(plan.lineage.project).toBe('prj-golden');
  });

  it('never schedules rungs the trail has not earned (the ladder order)', () => {
    const input = { ...goldenPlanInput(), current: 'reactive_market' as const };
    const plan = planCurriculum(input, goldenCurriculumVersion());
    if (!plan.ok) throw new Error(JSON.stringify(plan.errors));
    const positions = plan.value.stages.filter((stage) => stage.motivation.kind === 'ladder').map((stage) => stagePosition(stage.stage));
    expect(positions).toEqual([0, 1, 2, 3]); // synthetic_regimes .. reactive_market
    // No gap-driven stage may exceed the earned rung either (the gap
    // table's stages for the golden gaps are all <= reactive_market).
    for (const stage of plan.value.stages) {
      expect(stagePosition(stage.stage)).toBeLessThanOrEqual(stagePosition('reactive_market'));
    }
  });

  it('is deterministic: the same inputs yield the byte-identical plan, twice', () => {
    const first = goldenPlan();
    const second = goldenPlan();
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.plan_id).toBe(second.plan_id);
    expect(first.plan_digest).toBe(second.plan_digest);
    // And the digest is the FNV-1a canonical form (8 lowercase hex).
    expect(first.plan_digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deeply frozen (immutable value)', () => {
    const plan = goldenPlan();
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.stages)).toBe(true);
    expect(() => {
      (plan.stages as unknown as unknown[]).push(plan.stages[0] as never);
    }).toThrow();
  });

  it('varies with the seed (the derivation is load-bearing, not decorative)', () => {
    const input = { ...goldenPlanInput(), seed: 'seed-other' as never };
    const other = planCurriculum(input, goldenCurriculumVersion());
    if (!other.ok) throw new Error(JSON.stringify(other.errors));
    expect(other.value.plan_id).not.toBe(goldenPlan().plan_id);
  });
});

describe('the stage-9 gate (live execution is permitted-only, never default)', () => {
  it('stops at shadow_trading and records the typed refusal when the permission is missing', () => {
    const input = { ...goldenPlanInput(), current: 'controlled_live' as const };
    const plan = planCurriculum(input, goldenCurriculumVersion());
    if (!plan.ok) throw new Error(JSON.stringify(plan.errors));
    // The plan NEVER schedules controlled_live without permission.
    const scheduled = plan.value.stages.map((stage) => stage.stage);
    expect(scheduled).not.toContain('controlled_live');
    expect(plan.value.target).toBe('shadow_trading');
    expect(plan.value.live_gate).not.toBeNull();
    expect(plan.value.live_gate?.kind).toBe('live_gate_refusal');
    expect(plan.value.live_gate?.reason).toBe('live_permission_missing');
    expect(plan.value.live_gate?.stopped_at).toBe('shadow_trading');
    // Every un-gated rung is still scheduled (the climb to shadow).
    expect(scheduled.length).toBe(8);
    expect(scheduled[7]).toBe('shadow_trading');
  });

  it('schedules all nine rungs when the permission record is supplied', () => {
    const input = { ...goldenPlanInput(), current: 'controlled_live' as const, live_permission: GOLDEN_LIVE_PERMISSION as never };
    const plan = planCurriculum(input, goldenCurriculumVersion());
    if (!plan.ok) throw new Error(JSON.stringify(plan.errors));
    const scheduled = plan.value.stages.map((stage) => stage.stage);
    expect(scheduled).toContain('controlled_live');
    expect(plan.value.target).toBe('controlled_live');
    expect(plan.value.live_gate).toBeNull();
  });

  it('refuses a malformed permission record (typed)', () => {
    const input = { ...goldenPlanInput(), current: 'controlled_live' as const, live_permission: '' as never };
    const plan = planCurriculum(input, goldenCurriculumVersion());
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.errors.map((error) => error.code)).toContain('invalid_field');
    }
  });
});

describe('gap-driven replanning (failure-driven learning)', () => {
  it('selects the declared stage + method for EVERY gap kind (table-driven, all six)', () => {
    const version = goldenCurriculumVersion();
    for (const kind of CAPABILITY_GAP_KINDS) {
      const gap = {
        gapId: `gap-td-${kind}` as never,
        kind,
        capabilityKey: `capability-${kind}` as never,
        evidenceRef: `evidence-td-${kind}` as never,
        detectedAt: GOLDEN_T0,
        tenantId: 'tenant-golden',
        projectId: 'prj-golden',
      };
      const selections = gapDrivenSelections([gap], version);
      expect(selections.ok).toBe(true);
      if (!selections.ok) throw new Error(JSON.stringify(selections.errors));
      const selection = selections.value[0];
      expect(selection.kind).toBe(kind);
      // The declared remediation for the kind — the version's table row.
      const declared = version.gap_table.find((rule) => rule.kind === kind);
      expect(declared).toBeDefined();
      expect(selection.remediation.stage).toBe(declared?.stage);
      expect(selection.remediation.method).toBe(declared?.method);
    }
    // The golden version's full mapping (the declared table itself).
    const all = gapDrivenSelections(goldenGaps(), version);
    if (!all.ok) throw new Error(JSON.stringify(all.errors));
    expect(all.value.length).toBe(3);
    expect(all.value.map((entry) => entry.gapId)).toEqual([
      'gap-golden-regime',
      'gap-golden-execution',
      'gap-golden-coordination',
    ]);
  });

  it('plans a gap-driven stage for a fresh failure class the climb has not scheduled', () => {
    // A liquidity failure at the entry rung: liquidity ->
    // microstructure_friction (the declared remediation), appended.
    const liquidityGap = {
      gapId: 'gap-liquidity-fresh' as never,
      kind: 'liquidity' as const,
      capabilityKey: 'liquidity-provision-modeling' as never,
      evidenceRef: 'evidence-liquidity-fresh' as never,
      detectedAt: GOLDEN_T0,
      tenantId: 'tenant-golden',
      projectId: 'prj-golden',
    };
    const input = { ...goldenPlanInput(), gaps: [liquidityGap] };
    const plan = planCurriculum(input, goldenCurriculumVersion());
    if (!plan.ok) throw new Error(JSON.stringify(plan.errors));
    const gapStages = plan.value.stages.filter((stage) => stage.motivation.kind === 'gap');
    expect(gapStages.map((stage) => stage.stage)).toEqual(['microstructure_friction']);
    expect(gapStages[0]?.motivation.gapId).toBe('gap-liquidity-fresh');
  });
});

describe('plan input validation (the negative paths)', () => {
  it('refuses a foreign-scope gap (L12)', () => {
    const foreignGap = {
      gapId: 'gap-foreign' as never,
      kind: 'regime' as const,
      capabilityKey: 'market-regime-classification' as never,
      evidenceRef: 'evidence-foreign' as never,
      detectedAt: GOLDEN_T0,
      tenantId: 'tenant-other', // foreign scope
      projectId: 'prj-golden',
    };
    const plan = planCurriculum({ ...goldenPlanInput(), gaps: [foreignGap] }, goldenCurriculumVersion());
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.errors.map((error) => error.code)).toContain('tenant_scope_mismatch');
      expect(plan.errors[0]?.message).toContain('L12');
    }
  });

  it('refuses malformed inputs (missing goal, unknown stage, missing tenant)', () => {
    const noGoal = planCurriculum({ ...goldenPlanInput(), goal: '' }, goldenCurriculumVersion());
    expect(noGoal.ok).toBe(false);
    if (!noGoal.ok) expect(noGoal.errors.map((error) => error.code)).toContain('lineage_gap');

    const badStage = planCurriculum({ ...goldenPlanInput(), current: 'tenth_stage' }, goldenCurriculumVersion());
    expect(badStage.ok).toBe(false);
    if (!badStage.ok) expect(badStage.errors.map((error) => error.code)).toContain('stage_unknown');

    const noTenant = planCurriculum({ ...goldenPlanInput(), tenant: '' }, goldenCurriculumVersion());
    expect(noTenant.ok).toBe(false);
    if (!noTenant.ok) expect(noTenant.errors.map((error) => error.code)).toContain('tenant_missing');

    expect(planCurriculum(null, goldenCurriculumVersion()).ok).toBe(false);
    expect(planCurriculum('plan', goldenCurriculumVersion()).ok).toBe(false);
  });

  it('refuses duplicate gap ids in the input (one gap, one record)', () => {
    const gaps = [...goldenGaps(), goldenGaps()[0]];
    const plan = planCurriculum({ ...goldenPlanInput(), gaps }, goldenCurriculumVersion());
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.errors.map((error) => error.code)).toContain('invalid_field');
    }
  });

  it('schedules the whole earned ladder when no gaps exist (the pure climb)', () => {
    const input = { ...goldenPlanInput(), current: 'adversarial_population' as const, gaps: [] };
    const plan = planCurriculum(input, goldenCurriculumVersion());
    if (!plan.ok) throw new Error(JSON.stringify(plan.errors));
    expect(plan.value.stages.map((stage) => stage.stage)).toEqual(CURRICULUM_STAGES.slice(0, 5));
  });
});
