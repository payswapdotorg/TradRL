/**
 * @tradrl/learning (service) — the curriculum plan (T015).
 *
 * THE SCHEDULER: `CurriculumPlan` answers "which world to train in next"
 * (Work Order T015, section 4). Given (goal, constraints, gap records,
 * seed, curriculum version) the planner emits the ORDERED stage plan — a
 * deterministic, pure derivation:
 *
 *   - CLIMB: the plan schedules the ladder FROM THE BOTTOM (spec/
 *     LEARNING-LOOP.md's ladder is ordered; `ENTRY_STAGE` is rung 1) up to
 *     the rung the evidence-gated trail has REACHED (the `current`
 *     parameter — the plan never schedules rungs the trail has not
 *     earned, and never re-schedules passed rungs below it).
 *   - GAP-DRIVEN INSERTION (failure-driven learning): for every typed gap
 *     whose tenant/project scope matches the plan's scope, the version's
 *     gap table selects the stage + method declared for that gap kind; the
 *     plan RECORDS the selection (the stage's motivation cites the gap id
 *     and the declared remediation). A foreign-scope gap is refused typed
 *     (`tenant_scope_mismatch`, L12) — a curriculum does not train on
 *     another tenant's failures.
 *   - STAGE-9 GATE: `controlled_live` is scheduled ONLY when the caller
 *     supplies the declared permission record (`live_permission`); without
 *     it the plan STOPS at `shadow_trading` — scheduling stage 9 is the
 *     typed `live_permission_missing` error (Work Order ladder law: live
 *     execution is permitted-only, never default). The planner returns the
 *     gated plan (every rung up to and including stage 8) plus, when the
 *     trail has earned stage 9, a typed REFUSAL record citing the missing
 *     permission — the refusal is data (L11), not an exception.
 *   - COMMISSIONS: every planned stage carries its commissioned batch
 *     (commission.ts — the T011 experiment design + the T014 episode job
 *     specs). Stages SPAWN experiments; they never run them.
 *
 * DETERMINISM (the work order's determinism law): the plan is a pure
 * function of its explicit inputs — same (goal, constraint set, gaps,
 * seed, version, current rung, permission) -> byte-identical plan, twice.
 * The plan id and the plan digest are FNV-1a derivations over the
 * canonical JSON of the plan's identity inputs (no ambient randomness, no
 * ambient clock).
 *
 * L9 lineage: the plan cites the goal ref, the constraint-set ref, the
 * curriculum version ref, the seed, the motivating gap/experiment refs
 * per stage, and the tenant/project scope (L12).
 */

import {
  type CurriculumError,
  type CurriculumResult,
  type JsonObject,
  canonicalJson,
  deepFreeze,
  fail,
  fnv1a32Hex,
  isNonEmptyString,
  isRecord,
} from './primitives';
import type {
  CapabilityGapId,
  ConstraintSetRef,
  CurriculumPlanId,
  CurriculumVersionRef,
  ExperimentId,
  GoalRef,
  LivePermissionRef,
  OrganizationId,
  ProjectId,
  Seed,
  TenantId,
} from './ids';
import {
  isConstraintSetRef,
  isGoalRef,
  isLivePermissionRef,
  isOrganizationId,
  isProjectId,
  isSeed,
  isTenantId,
} from './ids';
import {
  CURRICULUM_STAGES,
  type CurriculumStageKind,
  ENTRY_STAGE,
  advanceTarget,
  isCurriculumStageKind,
  isLiveGatedStage,
  stagePosition,
} from './ladder';
import {
  type CapabilityGapKind,
  type CapabilityGapMirror,
  type GapRemediation,
  isGapList,
  selectRemediation,
} from './gaps';
import {
  type CommissionedBatch,
  type StageCommissionContext,
  commissionStageBatch,
} from './commission';
import { type CurriculumVersion, stageRuleOf } from './version';

// ---------------------------------------------------------------------------
// The plan input (everything explicit — no ambient state)
// ---------------------------------------------------------------------------

/**
 * The plan's input set: the goal (mirror of the control plane's goal
 * statement identity — opaque ref here), the constraint-set ref (L7: the
 * constraints the plan must respect are part of its lineage), the typed
 * gap records (failure-driven learning's inputs), the master seed, the
 * candidate organization the plan trains, the trail's CURRENT rung (the
 * evidence gate's earned position), and — only when live execution is
 * permitted — the permission record for stage 9.
 */
export interface CurriculumPlanInput {
  /** The goal the curriculum serves (opaque ref — L15). */
  readonly goal: GoalRef;
  /** The constraint set the plan respects (opaque ref — L7). */
  readonly constraints: ConstraintSetRef;
  /** The candidate organization under training. */
  readonly candidate: OrganizationId;
  /** The master seed: every commissioned batch derives from it. */
  readonly seed: Seed;
  /** The trail's earned rung (what the evidence gate has advanced to). */
  readonly current: CurriculumStageKind;
  /** The failure-driven-learning inputs (scope must match tenant/project). */
  readonly gaps: readonly CapabilityGapMirror[];
  /** The stage-9 permission record — OPTIONAL and load-bearing (the gate). */
  readonly live_permission?: LivePermissionRef;
  /** Owning tenant (L12). */
  readonly tenant: TenantId;
  /** Owning project (L12/L15). */
  readonly project: ProjectId;
}

/** Guard: `CurriculumPlanInput` (structural; scope coherence in the planner). */
export function isCurriculumPlanInput(v: unknown): v is CurriculumPlanInput {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.goal)) return false;
  if (!isConstraintSetRef(v.constraints)) return false;
  if (!isOrganizationId(v.candidate)) return false;
  if (!isSeed(v.seed)) return false;
  if (!isCurriculumStageKind(v.current)) return false;
  if (!isGapList(v.gaps)) return false;
  if (v.live_permission !== undefined && !isLivePermissionRef(v.live_permission)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The planned stage (one rung + its motivations + its commission)
// ---------------------------------------------------------------------------

/** Why a planned stage is in the plan: the ladder climb or a typed gap. */
export interface StageMotivation {
  /** `ladder` — the ordered climb; `gap` — failure-driven-learning insertion. */
  readonly kind: 'ladder' | 'gap';
  /** The motivating gap id (gap-driven stages only). */
  readonly gapId?: CapabilityGapId;
  /** The declared remediation the gap selected (gap-driven stages only). */
  readonly remediation?: GapRemediation;
  /** The experiment the stage commissions (spawned, never run). */
  readonly experiment: ExperimentId;
}

/** Guard: `StageMotivation`. */
export function isStageMotivation(v: unknown): v is StageMotivation {
  if (!isRecord(v)) return false;
  if (v.kind !== 'ladder' && v.kind !== 'gap') return false;
  if (!isNonEmptyString(v.experiment)) return false;
  if (v.kind === 'ladder') return v.gapId === undefined && v.remediation === undefined;
  return isNonEmptyString(v.gapId) && isRecord(v.remediation);
}

/**
 * One planned rung: the stage kind, its motivation (the climb or the gap),
 * its commission (the experiment + episode batches — T011/T014 mirrors)
 * and the planned trials the commission schedules.
 */
export interface PlannedStage {
  readonly stage: CurriculumStageKind;
  readonly motivation: StageMotivation;
  readonly commission: CommissionedBatch;
}

/** Guard: `PlannedStage`. */
export function isPlannedStage(v: unknown): v is PlannedStage {
  if (!isRecord(v)) return false;
  if (!isCurriculumStageKind(v.stage)) return false;
  if (!isStageMotivation(v.motivation)) return false;
  // The commission guard is structural; deep validation is the planner's.
  return isRecord(v.commission) && isNonEmptyString(v.commission.experiment) && Array.isArray(v.commission.jobs);
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** The plan-level lineage block (L9/L12): goal, constraints, version, seed, scope. */
export interface PlanLineage {
  readonly goal: GoalRef;
  readonly constraints: ConstraintSetRef;
  readonly curriculum_version: CurriculumVersionRef;
  readonly seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: `PlanLineage`. */
export function isPlanLineage(v: unknown): v is PlanLineage {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.goal)) return false;
  if (!isConstraintSetRef(v.constraints)) return false;
  if (!isNonEmptyString(v.curriculum_version)) return false;
  if (!isSeed(v.seed)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  return true;
}

/**
 * A typed stage-9 REFUSAL: the trail has earned `controlled_live` but the
 * caller supplied no permission record. The refusal is RETAINED DATA
 * (L11): the plan records that live execution was withheld and why —
 * "live execution is permitted-only, never default" is a law, and the
 * plan's answer to an unpermitted stage-9 request is a schedule that
 * stops at shadow trading plus this record.
 */
export interface LiveGateRefusal {
  readonly kind: 'live_gate_refusal';
  readonly reason: 'live_permission_missing';
  /** The rung the plan stopped at (always shadow_trading when refused). */
  readonly stopped_at: CurriculumStageKind;
}

/** Guard: `LiveGateRefusal`. */
export function isLiveGateRefusal(v: unknown): v is LiveGateRefusal {
  if (!isRecord(v)) return false;
  return v.kind === 'live_gate_refusal' && v.reason === 'live_permission_missing' && isCurriculumStageKind(v.stopped_at);
}

/**
 * The curriculum plan: the ordered stage plan (ladder rungs from the
 * entry rung up to the earned rung, gap-driven stages appended), each
 * with its motivation and commission; the full L9/L12 lineage; the plan
 * digest (FNV-1a over the canonical identity inputs — byte-determinism
 * witness); and the stage-9 refusal record when applicable (null when
 * stage 9 is not yet earned or is permitted).
 */
export interface CurriculumPlan {
  readonly plan_id: CurriculumPlanId;
  readonly lineage: PlanLineage;
  /** The planned stages in LADDER ORDER (gap-driven stages deduped against the climb). */
  readonly stages: readonly PlannedStage[];
  /** The rung the plan climbs to (inclusive). */
  readonly target: CurriculumStageKind;
  /** The stage-9 gate's retained refusal (null when no refusal occurred). */
  readonly live_gate: LiveGateRefusal | null;
  /** FNV-1a over the canonical JSON of the identity inputs (byte-determinism witness). */
  readonly plan_digest: string;
}

/** Guard: `CurriculumPlan` (structural; determinism is the planner's law). */
export function isCurriculumPlan(v: unknown): v is CurriculumPlan {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.plan_id)) return false;
  if (!isPlanLineage(v.lineage)) return false;
  if (!Array.isArray(v.stages)) return false;
  if (!(v.stages as readonly unknown[]).every((stage) => isPlannedStage(stage))) return false;
  if (!isCurriculumStageKind(v.target)) return false;
  if (v.live_gate !== null && !isLiveGateRefusal(v.live_gate)) return false;
  return typeof v.plan_digest === 'string' && /^[0-9a-f]{8}$/.test(v.plan_digest);
}

// ---------------------------------------------------------------------------
// The plan id + digest derivations (pure, FNV-1a)
// ---------------------------------------------------------------------------

/**
 * The declared derivation of the plan id:
 * `plan-<fnv1a32(goal|constraints|version|seed|current|permission|gaps)>`
 * — the identity inputs only; the same inputs always derive the same plan
 * id, so the plan is addressable before it is built (L9).
 */
export function derivePlanId(input: CurriculumPlanInput, version: CurriculumVersionRef): CurriculumPlanId {
  const gapIds = input.gaps.map((gap) => gap.gapId).sort().join(',');
  const permission = input.live_permission ?? '';
  return `plan-${fnv1a32Hex(`${input.goal}|${input.constraints}|${version}|${input.seed}|${input.current}|${permission}|${gapIds}`)}` as CurriculumPlanId;
}

/**
 * The plan digest: FNV-1a over the canonical JSON of the plan's identity
 * envelope (lineage + target + stage ids + experiments + refusal kind).
 * Equal plans always digest equally (the byte-determinism witness the
 * golden-fixture test asserts, twice).
 */
export function derivePlanDigest(plan: Omit<CurriculumPlan, 'plan_digest'>): string {
  const envelope: JsonObject = {
    plan_id: plan.plan_id,
    lineage: {
      goal: plan.lineage.goal,
      constraints: plan.lineage.constraints,
      curriculum_version: plan.lineage.curriculum_version,
      seed: plan.lineage.seed,
      tenant: plan.lineage.tenant,
      project: plan.lineage.project,
    },
    target: plan.target,
    stages: plan.stages.map((stage) => ({
      stage: stage.stage,
      motivation_kind: stage.motivation.kind,
      gap: stage.motivation.gapId ?? '',
      experiment: stage.motivation.experiment,
    })),
    live_gate: plan.live_gate === null ? 'permitted-or-unearned' : plan.live_gate.reason,
  };
  return fnv1a32Hex(canonicalJson(envelope));
}

// ---------------------------------------------------------------------------
// The planner (pure, deterministic)
// ---------------------------------------------------------------------------

/**
 * Plan the curriculum: the ordered stage plan for (input, version).
 *
 * The climb: from {@link ENTRY_STAGE} through the trail's earned `current`
 * rung IN LADDER ORDER — the plan never schedules unearned rungs and never
 * re-schedules passed ones. The gap-driven pass: every in-scope gap
 * selects its declared stage + method (the version's gap table); a
 * selected stage ALREADY in the climb keeps its ladder motivation and
 * GAINS nothing (dedup by stage kind — the plan is a schedule, not a
 * wish list; the gap's selection is still recorded via
 * {@link gapDrivenSelections}).
 *
 * The stage-9 gate: when the earned rung IS `controlled_live` and no
 * `live_permission` is supplied, the plan STOPS at `shadow_trading` and
 * records the {@link LiveGateRefusal} (typed refusal data, L11) — the
 * function does not throw; the refusal is the answer.
 *
 * Failures are typed: malformed input (`invalid_field` et al.), an
 * out-of-scope gap (`tenant_scope_mismatch`), an unknown stage
 * (`stage_unknown`), a version-stage rule gap (`stage_unknown`), a
 * commission failure (the commission's own codes).
 */
export function planCurriculum(
  input: unknown,
  version: CurriculumVersion,
): CurriculumResult<CurriculumPlan> {
  // --- input validation (collect-all) -------------------------------------
  if (!isRecord(input)) {
    return fail('invalid_type', 'the curriculum plan input must be an object');
  }
  const errors: CurriculumError[] = [];
  if (!isGoalRef(input.goal)) errors.push({ code: 'lineage_gap', path: 'goal', message: 'the plan input must cite the goal ref (L15)' });
  if (!isConstraintSetRef(input.constraints)) errors.push({ code: 'lineage_gap', path: 'constraints', message: 'the plan input must cite the constraint-set ref (L7)' });
  if (!isOrganizationId(input.candidate)) errors.push({ code: 'invalid_field', path: 'candidate', message: 'the plan input must name the candidate organization' });
  if (!isSeed(input.seed)) errors.push({ code: 'invalid_field', path: 'seed', message: 'the plan input must carry the master seed' });
  if (!isCurriculumStageKind(input.current)) {
    errors.push({ code: 'stage_unknown', path: 'current', message: 'the earned rung must be a ladder stage' });
  }
  if (input.live_permission !== undefined && !isLivePermissionRef(input.live_permission)) {
    errors.push({ code: 'invalid_field', path: 'live_permission', message: 'the stage-9 permission record must be a non-empty reference' });
  }
  if (!isTenantId(input.tenant)) errors.push({ code: 'tenant_missing', path: 'tenant', message: 'the plan input must carry the tenant (L12)' });
  if (!isProjectId(input.project)) errors.push({ code: 'tenant_missing', path: 'project', message: 'the plan input must carry the project (L15)' });
  if (input.gaps !== undefined && !isGapList(input.gaps)) {
    errors.push({ code: 'invalid_field', path: 'gaps', message: 'the gap list must be an array of valid, id-unique capability-gap mirrors' });
  }
  if (errors.length > 0) return { ok: false, errors };
  if (!isCurriculumPlanInput(input)) {
    return fail('invalid_field', 'the plan input failed its guard after field validation (impossible by construction)');
  }

  // --- scope coherence (L12): gaps must share the plan's scope ------------
  for (let index = 0; index < input.gaps.length; index++) {
    const gap = input.gaps[index];
    if (gap.tenantId !== input.tenant || gap.projectId !== input.project) {
      return fail(
        'tenant_scope_mismatch',
        `gap "${gap.gapId}" (index ${index}) belongs to tenant "${gap.tenantId}"/project "${gap.projectId}" but the plan serves "${input.tenant}"/"${input.project}" — a curriculum does not train on another scope's failures (L12)`,
        `gaps[${index}]`,
      );
    }
    // The version must share the scope too: one curriculum, one tenant.
    if (version.tenant !== input.tenant || version.project !== input.project) {
      return fail(
        'tenant_scope_mismatch',
        `curriculum version "${version.version}" belongs to tenant "${version.tenant}"/project "${version.project}" but the plan serves "${input.tenant}"/"${input.project}" (L12)`,
        'version',
      );
    }
  }

  // --- the stage-9 gate (permitted-only, never default) --------------------
  const earned = input.current;
  const permission = input.live_permission ?? null;
  const liveEarned = isLiveGatedStage(earned);
  if (liveEarned && permission === null) {
    // The typed refusal: the plan stops at shadow_trading and RECORDS the
    // withheld stage-9 request (L11 — the refusal is retained data).
    return planWithRefusal(input, version);
  }

  // --- the climb (ladder order, entry rung .. earned rung) -----------------
  const target = earned;
  const planned: PlannedStage[] = [];
  const scheduled = new Set<CurriculumStageKind>();
  for (const stage of CURRICULUM_STAGES) {
    if (stagePosition(stage) > stagePosition(target)) break;
    const commissionResult = commissionStage(stage, input, version, 'ladder');
    if (!commissionResult.ok) return commissionResult;
    planned.push(commissionResult.value);
    scheduled.add(stage);
  }

  // --- the gap-driven pass (failure-driven learning) ------------------------
  for (let index = 0; index < input.gaps.length; index++) {
    const gap = input.gaps[index];
    const remediation = selectRemediation(version.gap_table, gap.kind);
    if (!remediation.ok) return remediation;
    if (scheduled.has(remediation.value.stage)) continue; // dedup by stage kind
    const commissionResult = commissionStage(remediation.value.stage, input, version, 'gap', gap.gapId, remediation.value);
    if (!commissionResult.ok) return commissionResult;
    planned.push(commissionResult.value);
    scheduled.add(remediation.value.stage);
  }

  // --- assemble --------------------------------------------------------------
  return assemblePlan(input, version, planned, target, null);
}

/**
 * The gated-planning path: the trail has earned `controlled_live` without
 * the permission record. The plan stops at `shadow_trading` (the last
 * un-gated rung) and records the {@link LiveGateRefusal}.
 */
function planWithRefusal(
  input: CurriculumPlanInput,
  version: CurriculumVersion,
): CurriculumResult<CurriculumPlan> {
  const planned: PlannedStage[] = [];
  for (const stage of CURRICULUM_STAGES) {
    if (isLiveGatedStage(stage)) break; // the gate: stage 9 is never scheduled without permission
    const commissionResult = commissionStage(stage, input, version, 'ladder');
    if (!commissionResult.ok) return commissionResult;
    planned.push(commissionResult.value);
  }
  const refusal: LiveGateRefusal = { kind: 'live_gate_refusal', reason: 'live_permission_missing', stopped_at: 'shadow_trading' };
  return assemblePlan(input, version, planned, 'shadow_trading', refusal);
}

/** Commission one stage (the shared derivation for climb and gap passes). */
function commissionStage(
  stage: CurriculumStageKind,
  input: CurriculumPlanInput,
  version: CurriculumVersion,
  motivationKind: 'ladder' | 'gap',
  gapId?: CapabilityGapId,
  remediation?: GapRemediation,
): CurriculumResult<PlannedStage> {
  const rule = stageRuleOf(version, stage);
  if (!rule.ok) return rule;
  const context: StageCommissionContext = {
    goal: input.goal,
    stage,
    version: version.version,
    method: rule.value.method,
    config: rule.value.config,
    candidate: input.candidate,
    plan_seed: input.seed,
    tenant: input.tenant,
    project: input.project,
  };
  const batch = commissionStageBatch(context);
  if (!batch.ok) return batch;
  const motivation: StageMotivation =
    motivationKind === 'ladder'
      ? { kind: 'ladder', experiment: batch.value.experiment }
      : { kind: 'gap', gapId: gapId as CapabilityGapId, remediation: remediation as GapRemediation, experiment: batch.value.experiment };
  return { ok: true, value: deepFreeze({ stage, motivation, commission: batch.value }) };
}

/** Assemble + self-check the plan (the determinism witness rides along). */
function assemblePlan(
  input: CurriculumPlanInput,
  version: CurriculumVersion,
  stages: readonly PlannedStage[],
  target: CurriculumStageKind,
  refusal: LiveGateRefusal | null,
): CurriculumResult<CurriculumPlan> {
  const planId = derivePlanId(input, version.version);
  const draft: Omit<CurriculumPlan, 'plan_digest'> = deepFreeze({
    plan_id: planId,
    lineage: deepFreeze({
      goal: input.goal,
      constraints: input.constraints,
      curriculum_version: version.version,
      seed: input.seed,
      tenant: input.tenant,
      project: input.project,
    }),
    stages: deepFreeze([...stages]),
    target,
    live_gate: refusal,
  });
  const digest = derivePlanDigest(draft);
  const plan: CurriculumPlan = deepFreeze({ ...draft, plan_digest: digest });
  if (!isCurriculumPlan(plan)) {
    return fail('invalid_field', 'the assembled plan failed its own guard (impossible by construction)');
  }
  return { ok: true, value: plan };
}

// ---------------------------------------------------------------------------
// Gap-driven selection projection (failure-driven learning, exposed)
// ---------------------------------------------------------------------------

/**
 * The gap-driven selection table of one planning: for every in-scope gap,
 * the stage + method the version declares for its kind. This is the
 * failure-driven-learning projection the work order's table-driven test
 * walks — each CapabilityGap kind selects the declared stage + method.
 */
export function gapDrivenSelections(
  gaps: readonly CapabilityGapMirror[],
  version: CurriculumVersion,
): CurriculumResult<readonly { readonly gapId: CapabilityGapId; readonly kind: CapabilityGapKind; readonly remediation: GapRemediation }[]> {
  const selections: { gapId: CapabilityGapId; kind: CapabilityGapKind; remediation: GapRemediation }[] = [];
  for (const gap of gaps) {
    const remediation = selectRemediation(version.gap_table, gap.kind);
    if (!remediation.ok) return remediation;
    selections.push({ gapId: gap.gapId, kind: gap.kind, remediation: remediation.value });
  }
  return { ok: true, value: deepFreeze(selections) };
}
