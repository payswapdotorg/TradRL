/**
 * @tradrl/learning (service) — the golden curriculum fixtures (T015).
 *
 * The canonical universe the tests and the acceptance criteria reference:
 * the golden curriculum version (all nine stages declared honestly —
 * L6 — with all six gap remediations), the golden plan input, the golden
 * plan, and the golden trails (an evidenced advancement, a regression, a
 * staged-9 refusal).
 *
 * Everything is deterministic: the golden version validates on every
 * construction, the golden plan is the pure function of (input, version),
 * and the golden bytes are byte-identical across runs (the tests prove
 * it, twice — the determinism law).
 *
 * The fixture universe deliberately mirrors T014's golden compute
 * universe's SHAPE (tenant-golden / prj-golden scope, scripted driver
 * configuration) while remaining self-contained: the environment config
 * refs are OPAQUE references to world-lane configs (T027/T028 own the
 * reactive/generative world implementations — the curriculum references
 * them by config, it never builds them).
 */

import { deepFreeze } from './primitives';
import type { CapabilityGapMirror } from './gaps';
import { type CurriculumVersion, validateCurriculumVersion } from './version';
import { type CurriculumPlan, type CurriculumPlanInput, planCurriculum } from './plan';
import {
  type CurriculumTrail,
  type StageTransition,
  appendTransition,
  evidencedAdvance,
  enterCurriculum,
  openCurriculumTrail,
  recordedRefusal,
  recordedRegression,
  serializeCurriculumTrail,
} from './trail';
import type { CriteriaRef } from './ids';
import type { CurriculumStageKind } from './ladder';

// ---------------------------------------------------------------------------
// The golden scope (L12/L15/L9)
// ---------------------------------------------------------------------------

/** The golden tenant (L12 — one scope). */
export const GOLDEN_TENANT = 'tenant-golden';
/** The golden project (L15 — continuity root). */
export const GOLDEN_PROJECT = 'prj-golden';
/** The golden goal ref (L15). */
export const GOLDEN_GOAL = 'goal-golden';
/** The golden constraint-set ref (L7 — constraints are part of plan lineage). */
export const GOLDEN_CONSTRAINTS = 'constraints-golden';
/** The golden candidate organization under training. */
export const GOLDEN_CANDIDATE = 'org-golden-candidate';
/** The golden master seed (every commissioned batch derives from it). */
export const GOLDEN_SEED = 'seed-golden-curriculum';
/** The golden curriculum version ref (the declared ladder table's identity). */
export const GOLDEN_CURRICULUM_VERSION = 'curriculum@1.0.0';
/** The golden stage-9 permission record (only supplied when live is permitted). */
export const GOLDEN_LIVE_PERMISSION = 'live-permission-golden';
/** The golden evaluation refs (T012 citations). */
export const GOLDEN_EVALUATOR = 'evaluator-golden@1';
export const GOLDEN_SPLIT = 'split-walk-forward-golden';
export const GOLDEN_CRITERIA_SET = 'criteria-golden@1';
/** The golden driver refs (T013 mirrors). */
export const GOLDEN_ACTOR = 'agent-golden-curriculum';
export const GOLDEN_RUNTIME = '@tradrl/learning/curriculum@1';
export const GOLDEN_BODY = 'body-golden@1';
export const GOLDEN_SUBSTRATE = 'substrate-golden@1';
export const GOLDEN_POLICY = 'policy:golden-curriculum@1';
/** The golden instants (explicit — no ambient clock; branded for the record builders). */
export const GOLDEN_T0 = 1_700_000_000_000 as import('./primitives').TimestampMs;
export const GOLDEN_T1 = 1_700_000_100_000 as import('./primitives').TimestampMs;
export const GOLDEN_T2 = 1_700_000_200_000 as import('./primitives').TimestampMs;
export const GOLDEN_T3 = 1_700_000_300_000 as import('./primitives').TimestampMs;

// ---------------------------------------------------------------------------
// The golden curriculum version
// ---------------------------------------------------------------------------

/**
 * The advancement criteria refs of one stage: `criteria-<stage>@1` — one
 * declared criterion per stage, deterministic (the evidence gate cites
 * these; the golden advancement's citation covers them).
 */
export function goldenStageCriteria(stage: CurriculumStageKind): readonly CriteriaRef[] {
  return [`criteria-${stage}@1` as CriteriaRef];
}

/**
 * The golden curriculum version literal (untrusted form, like the tests'
 * input literals): the nine stage rules — each world mode HONEST for its
 * stage (L6: synthetic_regimes declares generative; historical_replay and
 * rolling_time_machine declare exact_replay; reactive_market and
 * adversarial_population declare reactive_replay; shadow_trading and
 * controlled_live declare exact_replay; the two any-mode stages declare
 * exact_replay) — and the six-kind gap table (failure-driven learning).
 */
export function goldenCurriculumVersionLiteral(): Record<string, unknown> {
  const stageRule = (stage: CurriculumStageKind, worldMode: string, method: string): Record<string, unknown> => ({
    stage,
    method,
    config: {
      world_mode: worldMode,
      environment_config: `envcfg-golden-${stage}`,
      advancement_criteria: goldenStageCriteria(stage),
      evaluator_version: GOLDEN_EVALUATOR,
      splits: [GOLDEN_SPLIT],
      policy: GOLDEN_POLICY,
      reward_models: ['reward-model:obs-count@1'],
      driver: {
        actor: GOLDEN_ACTOR,
        step_ms: 100,
        runtime: GOLDEN_RUNTIME,
        body_versions: [GOLDEN_BODY],
        substrates: [GOLDEN_SUBSTRATE],
      },
      step_budget: 12,
      episodes_per_arm: 3,
    },
  });

  return {
    version: GOLDEN_CURRICULUM_VERSION,
    sequence: 1,
    tenant: GOLDEN_TENANT,
    project: GOLDEN_PROJECT,
    stages: {
      synthetic_regimes: stageRule('synthetic_regimes', 'generative', 'rl'),
      historical_replay: stageRule('historical_replay', 'exact_replay', 'supervised'),
      microstructure_friction: stageRule('microstructure_friction', 'exact_replay', 'rl'),
      reactive_market: stageRule('reactive_market', 'reactive_replay', 'self_play'),
      adversarial_population: stageRule('adversarial_population', 'reactive_replay', 'adversarial'),
      unseen_multi_regime: stageRule('unseen_multi_regime', 'exact_replay', 'bandits'),
      rolling_time_machine: stageRule('rolling_time_machine', 'exact_replay', 'offline_rl'),
      shadow_trading: stageRule('shadow_trading', 'exact_replay', 'imitation'),
      controlled_live: stageRule('controlled_live', 'exact_replay', 'preference_optimization'),
    },
    gap_table: [
      { kind: 'regime', stage: 'synthetic_regimes', method: 'rl' },
      { kind: 'sentiment-event', stage: 'historical_replay', method: 'supervised' },
      { kind: 'liquidity', stage: 'microstructure_friction', method: 'rl' },
      { kind: 'execution', stage: 'microstructure_friction', method: 'offline_rl' },
      { kind: 'risk', stage: 'historical_replay', method: 'offline_rl' },
      { kind: 'coordination', stage: 'reactive_market', method: 'self_play' },
    ],
  };
}

/** The golden curriculum version, validated and deeply frozen. */
export function goldenCurriculumVersion(): CurriculumVersion {
  const result = validateCurriculumVersion(goldenCurriculumVersionLiteral());
  if (!result.ok) throw new Error(`golden fixture bug: ${JSON.stringify(result.errors)}`);
  return result.value;
}

// ---------------------------------------------------------------------------
// The golden gaps (failure-driven learning inputs)
// ---------------------------------------------------------------------------

/**
 * The golden capability-gap mirrors: three in-scope typed failures (a
 * regime failure, an execution failure and a coordination failure —
 * LEARNING-LOOP's failure classes), detected at explicit instants. The
 * literals carry the mirror brands directly (the planner re-validates
 * every field at runtime — the collect-all discipline).
 */
export function goldenGaps(): readonly CapabilityGapMirror[] {
  return deepFreeze([
    {
      gapId: 'gap-golden-regime' as import('./ids').CapabilityGapId,
      kind: 'regime',
      capabilityKey: 'market-regime-classification' as import('./ids').CapabilityKey,
      evidenceRef: 'evidence-golden-regime-failure' as import('./ids').AttainmentEvidenceRef,
      detectedAt: GOLDEN_T0,
      tenantId: GOLDEN_TENANT as import('./ids').TenantId,
      projectId: GOLDEN_PROJECT as import('./ids').ProjectId,
    },
    {
      gapId: 'gap-golden-execution' as import('./ids').CapabilityGapId,
      kind: 'execution',
      capabilityKey: 'order-execution-under-friction' as import('./ids').CapabilityKey,
      evidenceRef: 'evidence-golden-execution-failure' as import('./ids').AttainmentEvidenceRef,
      detectedAt: GOLDEN_T0,
      tenantId: GOLDEN_TENANT as import('./ids').TenantId,
      projectId: GOLDEN_PROJECT as import('./ids').ProjectId,
    },
    {
      gapId: 'gap-golden-coordination' as import('./ids').CapabilityGapId,
      kind: 'coordination',
      capabilityKey: 'multi-agent-order-coordination' as import('./ids').CapabilityKey,
      evidenceRef: 'evidence-golden-coordination-failure' as import('./ids').AttainmentEvidenceRef,
      detectedAt: GOLDEN_T0,
      tenantId: GOLDEN_TENANT as import('./ids').TenantId,
      projectId: GOLDEN_PROJECT as import('./ids').ProjectId,
    },
  ]);
}

// ---------------------------------------------------------------------------
// The golden plan
// ---------------------------------------------------------------------------

/**
 * The golden plan input: the golden scope, the trail at the bottom rung
 * (nothing earned yet), the three golden gaps, no stage-9 permission.
 * The planner re-validates every field (the collect-all discipline).
 */
export function goldenPlanInput(): CurriculumPlanInput {
  return deepFreeze({
    goal: GOLDEN_GOAL as import('./ids').GoalRef,
    constraints: GOLDEN_CONSTRAINTS as import('./ids').ConstraintSetRef,
    candidate: GOLDEN_CANDIDATE as import('./ids').OrganizationId,
    seed: GOLDEN_SEED as import('./ids').Seed,
    current: 'synthetic_regimes',
    gaps: goldenGaps(),
    tenant: GOLDEN_TENANT as import('./ids').TenantId,
    project: GOLDEN_PROJECT as import('./ids').ProjectId,
  });
}

/**
 * The golden plan: the ordered stage plan over (golden input, golden
 * version) — the entry rung (gaps 1's regime failure selects
 * synthetic_regimes, already scheduled by the climb) plus the gap-driven
 * stages not on the climb's path (execution -> microstructure_friction,
 * coordination -> reactive_market).
 */
export function goldenPlan(): CurriculumPlan {
  const result = planCurriculum(goldenPlanInput(), goldenCurriculumVersion());
  if (!result.ok) throw new Error(`golden fixture bug: ${JSON.stringify(result.errors)}`);
  return result.value;
}

// ---------------------------------------------------------------------------
// The golden trails
// ---------------------------------------------------------------------------

/** The golden trail lineage block (shared by every golden trail). */
export function goldenTrailLineage(): Record<string, unknown> {
  return {
    goal: GOLDEN_GOAL,
    curriculum_version: GOLDEN_CURRICULUM_VERSION,
    tenant: GOLDEN_TENANT,
    project: GOLDEN_PROJECT,
  };
}

/** The golden attainment citation covering `stage`'s advancement criteria (attained). */
export function goldenCitation(stage: CurriculumStageKind): Record<string, unknown> {
  return {
    verdict: `verdict-golden-${stage}`,
    criteria: GOLDEN_CRITERIA_SET,
    criteria_refs: goldenStageCriteria(stage),
    attained: true,
    evidence_ref: `evidence-golden-${stage}-attainment`,
  };
}

/** The golden entry record (entering the ladder at the bottom rung). */
export function goldenEntry(): StageTransition {
  const result = enterCurriculum(goldenTrailLineage(), GOLDEN_T0);
  if (!result.ok) throw new Error(`golden fixture bug: ${JSON.stringify(result.errors)}`);
  return result.value;
}

/**
 * The golden advancement trail: entry (T0) + one evidenced advance
 * (synthetic_regimes -> historical_replay at T1, citing the golden
 * attained verdict covering historical_replay's advancement criteria).
 */
export function goldenAdvancementTrail(): CurriculumTrail {
  let trail = openCurriculumTrail(goldenEntry());
  if (!trail.ok) throw new Error(`golden fixture bug: ${JSON.stringify(trail.errors)}`);
  const advance = evidencedAdvance(
    'synthetic_regimes',
    goldenCitation('historical_replay'),
    goldenStageCriteria('historical_replay'),
    GOLDEN_T1,
    goldenTrailLineage(),
    null,
  );
  if (!advance.ok) throw new Error(`golden fixture bug: ${JSON.stringify(advance.errors)}`);
  const appended = appendTransition(trail.value, advance.value, goldenCurriculumVersion());
  if (!appended.ok) throw new Error(`golden fixture bug: ${JSON.stringify(appended.errors)}`);
  return appended.value;
}

/**
 * The golden regression trail: the advancement trail, then a LEGAL
 * REGRESSION (historical_replay -> synthetic_regimes at T2 — the stage
 * failed; the curriculum goes back; the record is retained, never
 * dropped), then a fresh evidenced advance at T3.
 */
export function goldenRegressionTrail(): CurriculumTrail {
  let trail: CurriculumTrail = goldenAdvancementTrail();
  const regression = recordedRegression('historical_replay', 'synthetic_regimes', GOLDEN_T2, goldenTrailLineage());
  if (!regression.ok) throw new Error(`golden fixture bug: ${JSON.stringify(regression.errors)}`);
  const appendedRegression = appendTransition(trail, regression.value);
  if (!appendedRegression.ok) throw new Error(`golden fixture bug: ${JSON.stringify(appendedRegression.errors)}`);
  trail = appendedRegression.value;
  const advance = evidencedAdvance(
    'synthetic_regimes',
    goldenCitation('historical_replay'),
    goldenStageCriteria('historical_replay'),
    GOLDEN_T3,
    goldenTrailLineage(),
    null,
  );
  if (!advance.ok) throw new Error(`golden fixture bug: ${JSON.stringify(advance.errors)}`);
  const appendedAdvance = appendTransition(trail, advance.value, goldenCurriculumVersion());
  if (!appendedAdvance.ok) throw new Error(`golden fixture bug: ${JSON.stringify(appendedAdvance.errors)}`);
  return appendedAdvance.value;
}

/**
 * The golden refusal trail: the advancement trail plus a typed REFUSAL
 * record (an advancement attempted without evidence — refused and
 * retained, L11).
 */
export function goldenRefusalTrail(): CurriculumTrail {
  const trail = goldenAdvancementTrail();
  const refusal = recordedRefusal('historical_replay', 'evidence_missing', GOLDEN_T2, goldenTrailLineage());
  if (!refusal.ok) throw new Error(`golden fixture bug: ${JSON.stringify(refusal.errors)}`);
  const appended = appendTransition(trail, refusal.value);
  if (!appended.ok) throw new Error(`golden fixture bug: ${JSON.stringify(appended.errors)}`);
  return appended.value;
}

/** The golden trail's canonical serialization bytes (byte-stable across runs). */
export function goldenTrailBytes(): string {
  const bytes = serializeCurriculumTrail(goldenAdvancementTrail());
  if (!bytes.ok) throw new Error(`golden fixture bug: ${JSON.stringify(bytes.errors)}`);
  return bytes.value;
}
