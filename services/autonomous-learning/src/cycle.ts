/**
 * @tradrl/autonomous-learning (service) — THE IMPROVEMENT CYCLE (Work
 * Order T035): the continuous loop that closes the Learning from reality
 * section — "outcome -> next experiment" (spec/LEARNING-LOOP.md).
 *
 * THE LOOP ({@link runImprovementCycle}): ONE scope per cycle (L12), ONE
 * injected instant (no ambient clock), pure + deterministic over its
 * explicit inputs (same inputs -> byte-identical products and cycle
 * record, twice). Every cycle:
 *
 *   1. VERIFIES its world (fail-closed, typed): the mirrors, the scope
 *      coherence of every consumed record, the L4 instants (the loop
 *      never improves on future evidence), the idempotence ledger (a
 *      hook contributes EXACTLY ONCE — `duplicate_evidence`), and the
 *      three chain-verified histories it stands on — the improvement log
 *      itself, the curriculum trail (T015) and the search record (T031):
 *      a tampered history never drives improvement (`chain_mismatch`).
 *
 *   2. GATES THE ADOPTION (T031, integrity.ts): the evaluated evidence is
 *      claimed against the RETAINED search record (`hidden_trials`
 *      fail-closed) and the holdout distinction decides the skill
 *      commission (in-search-only attained evidence withholds it as the
 *      typed refusal data `selected_without_holdout` — the best-of-N
 *      trap refused by construction).
 *
 *   3. DERIVES the improvement agenda (the DECLARED decision table — the
 *      improvement policy, never a mood): every failure hook grounds a
 *      typed capability gap (T016-shaped, T015-consumable) through its
 *      focus's declared gap kind; the gaps + the trail's earned rung
 *      assemble the CURRICULUM REVISION (the revised plan-input bundle,
 *      annotated with the Firm Brain's active knowledge — T034's served
 *      entries joined by the focus's declared knowledge kind); the
 *      commissioning focuses assemble the SKILL COMMISSION (the
 *      body-forge input bundle: gaps + evidence + seed — T017-consumable,
 *      adoption-gated); and EVERY cycle with records assembles the
 *      MEMORY FEED (the T034 `ingestFirmLearning` bundle: the outcome +
 *      post-mortem snapshot at the cycle instant — the brain keeps
 *      learning continuously).
 *
 *   4. MINTS the search trials (L11): the revision and every RELEASED
 *      commission are in-search trials on the retained search record —
 *      the loop emits their append bundles (`alt:` ids, parent edges from
 *      the improvement log's own prior trials of the same product kind);
 *      nothing about the improvement search is forgotten.
 *
 *   5. APPENDS the cycle record (`alc:`, content-addressed, chain-folded)
 *      onto the improvement log and extends the consumed-hooks ledger —
 *      atomically (every gate passes and every product mints, or the
 *      state is untouched).
 *
 * SAFETY LAWS: the loop NEVER supplies the stage-9 live-permission record
 * (live execution is permitted-only by the control plane — the plan input
 * deliberately omits it and T015's planner records the refusal); the loop
 * never writes the curriculum trail (advancement stays T015's
 * evidence-gated surface — the loop PROPOSES plans, the trail's own gate
 * advances); the loop never runs the body forge (T017 owns forging — the
 * commission is a bundle, the caller forges).
 */

import { canonicalJson, deepFreeze, fail, fnv1a32Hex, isNonEmptyString, isRecord, isTimestampMs, ok, type ImprovementResult, type JsonObject, type TimestampMs } from './primitives';
import type { AttainmentEvidenceRef, CapabilityGapId, CapabilityKey, ConstraintSetRef, ExperimentRef, GoalRef, ImprovementCycleId, OrganizationId, OutcomeRecordRef, PostMortemRef, Seed, SessionRef, TrajectoryRef, TrialId } from './ids';
import { isConstraintSetRef, isGoalRef, isOrganizationId, isSeed } from './ids';
import type {
  CapabilityGapKind,
  CapabilityGapMirror,
  CurriculumTrailMirror,
  EvaluatedEvidenceMirror,
  LearningFocus,
  OutcomeEnvelopeMirror,
  OutcomeLearningHookMirror,
  PostMortemEnvelopeMirror,
  SearchRecordMirror,
  SearchTrialInputMirror,
  ServedKnowledgeEnvelopeMirror,
} from './mirrors';
import {
  LEARNING_FOCUS,
  isCapabilityGapMirror,
  isCurriculumStageKind,
  isCurriculumTrailMirror,
  isEvaluatedEvidenceMirror,
  isOutcomeEnvelopeMirror,
  isOutcomeLearningHookMirror,
  isPostMortemEnvelopeMirror,
  isSearchRecordMirror,
  isServedKnowledgeEnvelopeMirror,
  trailPositionMirror,
  verifyCurriculumTrailMirror,
  verifySearchRecordMirror,
} from './mirrors';
import type { AdoptionVerdict, GroundingEvidence, SearchPolicyBlock } from './integrity';
import { evaluateAdoptionGate, mintImprovementSearchTrial } from './integrity';
import { isSearchPolicyBlock } from './integrity';
import type { FocusAction, ImprovementPolicy } from './policy';
import { improvementPolicyDigest, validateImprovementPolicy } from './policy';
import type { AutonomousLearningState, CommissionRefusalReason, ImprovementCycleRecord } from './state';
import {
  appendImprovementCycle,
  cycleRecordContentDigest,
  isAutonomousLearningState,
  verifyImprovementLog,
} from './state';

/** The ladder rung type (the mirrors' closed stage union, used by the plan input). */
type StageKind = import('./mirrors').CurriculumStageKind;

// ---------------------------------------------------------------------------
// The cycle inputs
// ---------------------------------------------------------------------------

/** The planning context every cycle carries (the T015 plan-input lineage — L9/L15). */
export interface PlanningContext {
  /** The goal the curriculum serves (T007 — opaque ref). */
  readonly goal: GoalRef;
  /** The constraint set the plan respects (T007/L7 — opaque ref). */
  readonly constraints: ConstraintSetRef;
  /** The candidate organization under training (T016 — opaque ref). */
  readonly candidate: OrganizationId;
  /** The master seed every commissioned batch derives from (T015). */
  readonly seed: Seed;
}

/** Guard: `PlanningContext`. */
export function isPlanningContext(v: unknown): v is PlanningContext {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.goal)) return false;
  if (!isConstraintSetRef(v.constraints)) return false;
  if (!isOrganizationId(v.candidate)) return false;
  return isSeed(v.seed);
}

/**
 * One cycle's whole world — everything explicit, nothing ambient: the
 * injected instant, the ONE scope (L12), T033's windowed learning hooks +
 * the outcome/post-mortem records the memory feed carries, T034's served
 * knowledge envelopes + the brain-state digest, T015's chain-verified
 * curriculum trail, T031's chain-verified search record + the search
 * policy block, the evaluated evidence (T012 verdict essentials bound to
 * T031 trials), the planning context and the improvement policy.
 */
export interface ImprovementCycleInputs {
  readonly at: TimestampMs;
  readonly tenant: string;
  readonly project: string;
  /** T033's windowed learning hooks (the typed per-outcome signals — R27: they inform, the policy decides). */
  readonly hooks: readonly OutcomeLearningHookMirror[];
  /** T033's outcome records (envelope-validated; forwarded VERBATIM in the memory feed). */
  readonly outcomes: readonly unknown[];
  /** T033's post-mortem records (envelope-validated; forwarded VERBATIM in the memory feed). */
  readonly postMortems: readonly unknown[];
  /** T034's served firm-knowledge envelopes (the brain the cycle improves upon). */
  readonly knowledge: readonly ServedKnowledgeEnvelopeMirror[];
  /** The Firm-Brain state digest at read time (opaque; the L9 binding). */
  readonly knowledgeHead: string;
  /** T015's chain-verified curriculum trail (the earned rung the revision plans from). */
  readonly trail: CurriculumTrailMirror;
  /** T031's chain-verified search record (the retained search history the gate reads). */
  readonly search: SearchRecordMirror;
  /** The search discipline the minted trials carry. */
  readonly searchPolicy: SearchPolicyBlock;
  /** The evaluated evidence: T012 verdict essentials bound to T031 trials. */
  readonly evaluations: readonly EvaluatedEvidenceMirror[];
  /** The planning context (the T015 plan-input lineage). */
  readonly planning: PlanningContext;
  /** The improvement policy (the DECLARED decision table). */
  readonly policy: ImprovementPolicy;
}

// ---------------------------------------------------------------------------
// The products
// ---------------------------------------------------------------------------

/**
 * The revised curriculum plan-input bundle — field-for-field T015's
 * `CurriculumPlanInput` (goal, constraints, candidate, seed, the earned
 * rung, the minted gaps, the scope) — the exact shape the REAL
 * `planCurriculum` consumes (the interop test drives it green). The
 * `live_permission` field is DELIBERATELY absent: the loop never grants
 * live execution (the planner records its typed refusal).
 */
export interface CurriculumPlanInputMirror {
  readonly goal: GoalRef;
  readonly constraints: ConstraintSetRef;
  readonly candidate: OrganizationId;
  readonly seed: Seed;
  readonly current: StageKind;
  readonly gaps: readonly CapabilityGapMirror[];
  readonly tenant: string;
  readonly project: string;
}

/** Guard: `CurriculumPlanInputMirror`. */
export function isCurriculumPlanInputMirror(v: unknown): v is CurriculumPlanInputMirror {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.goal)) return false;
  if (!isConstraintSetRef(v.constraints)) return false;
  if (!isOrganizationId(v.candidate)) return false;
  if (!isSeed(v.seed)) return false;
  if (!isCurriculumStageKind(v.current)) return false;
  if (!Array.isArray(v.gaps)) return false;
  if (!(v.gaps as readonly unknown[]).every((gap) => isCapabilityGapMirror(gap))) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  return true;
}

/** The revision's knowledge annotation: one minted gap's brain-informed context (T034's active entries the focus relates to). */
export interface GapAnnotation {
  readonly gapId: CapabilityGapId;
  /** The focus that grounded the gap (the annotation's join key). */
  readonly focus: LearningFocus;
  /** The active firm-knowledge refs of the focus's declared knowledge kind (`fkr:` ids). */
  readonly relatedKnowledge: readonly string[];
}

/** The curriculum revision product: the revised plan-input bundle + the brain-informed annotations. */
export interface CurriculumRevision {
  readonly kind: 'curriculum-revision';
  /** Content-addressed identity: `alv:` + digest of the canonical content. */
  readonly revisionId: string;
  readonly planInput: CurriculumPlanInputMirror;
  /** The brain-state digest the revision cites (the L9 binding — the improvement names the brain it improved upon). */
  readonly knowledgeHead: string;
  readonly annotations: readonly GapAnnotation[];
  readonly tenant: string;
  readonly project: string;
  readonly at: TimestampMs;
}

/** The skill commission's evidence block — field-for-field T017's `ForgeEvidence` shape (trajectory/trial/verdict refs). */
export interface CommissionEvidence {
  readonly trajectoryRefs: readonly string[];
  readonly trialRefs: readonly string[];
  readonly verdictRefs: readonly string[];
}

/** Guard: `CommissionEvidence`. */
export function isCommissionEvidence(v: unknown): v is CommissionEvidence {
  if (!isRecord(v)) return false;
  for (const field of ['trajectoryRefs', 'trialRefs', 'verdictRefs'] as const) {
    const list = (v as Record<string, unknown>)[field];
    if (!Array.isArray(list)) return false;
    if (!(list as readonly unknown[]).every((ref) => isNonEmptyString(ref))) return false;
  }
  return true;
}

/** The skill commission product: the body-forge input bundle (gaps + evidence + seed), with the adoption gate's verdict. */
export interface SkillCommission {
  readonly kind: 'skill-commission';
  /** Content-addressed identity: `als:` + digest of the canonical content. */
  readonly commissionId: string;
  /** The adoption gate's verdict: released to the forge, or withheld with the typed refusal. */
  readonly status: 'commissioned' | 'withheld';
  readonly refusal: CommissionRefusalReason | null;
  /** The commissioning focuses, in the closed focus order (the declared decision table's commissioning rows). */
  readonly focuses: readonly LearningFocus[];
  /** The motivating gap records (T017 `ForgeInput.gaps`-consumable). */
  readonly gaps: readonly CapabilityGapMirror[];
  /** The evidence block (T017 `ForgeInput.evidence`-consumable). */
  readonly evidence: CommissionEvidence;
  readonly seed: Seed;
  /** The evidence that released the commission (empty when withheld). */
  readonly grounding: readonly GroundingEvidence[];
  readonly tenant: string;
  readonly project: string;
  readonly at: TimestampMs;
}

/** The memory feed product: the T034 `ingestFirmLearning`-consumable snapshot bundle. */
export interface MemoryFeed {
  readonly kind: 'memory-feed';
  /** Content-addressed identity: `alm:` + digest of the canonical content. */
  readonly feedId: string;
  /** The learning snapshot: the outcome + post-mortem records, VERBATIM (T034's mirrors own the full validation). */
  readonly snapshot: { readonly outcomes: readonly unknown[]; readonly postMortems: readonly unknown[] };
  readonly at: TimestampMs;
}

/** One cycle's whole product set. */
export interface ImprovementProducts {
  /** The minted capability gaps (T016-shaped; the revision + the commission carry them). */
  readonly gaps: readonly CapabilityGapMirror[];
  readonly revision: CurriculumRevision | null;
  readonly commission: SkillCommission | null;
  readonly memory: MemoryFeed | null;
  /** The emitted search-trial append bundles (T031 `appendSearchTrial`-consumable; revision first, commission second). */
  readonly searchTrials: readonly SearchTrialInputMirror[];
}

/** One cycle's complete result: the new state, the appended record, and the products. */
export interface ImprovementCycleResult {
  readonly state: AutonomousLearningState;
  readonly cycle: ImprovementCycleRecord;
  readonly products: ImprovementProducts;
}

// ---------------------------------------------------------------------------
// The envelope extractions (T033 records -> the validated envelopes)
// ---------------------------------------------------------------------------

/** Extract + validate the outcome envelope of one T033 outcome record (the payload forwards verbatim). */
function outcomeEnvelopeOf(record: unknown, path: string): ImprovementResult<OutcomeEnvelopeMirror> {
  if (!isRecord(record)) return fail('invalid_type', `${path} must be an object (a T033 outcome record)`, path);
  const lineage = record.lineage;
  if (!isRecord(lineage)) return fail('invalid_field', `${path}.lineage is absent — an outcome record carries the T030/T011 lineage block`, `${path}.lineage`);
  const shadow = lineage.shadow;
  if (!isRecord(shadow) || !isNonEmptyString(shadow.sessionId)) {
    return fail('invalid_field', `${path}.lineage.shadow.sessionId is absent — the memory feed cites the T030 shadow session (L15)`, `${path}.lineage.shadow.sessionId`);
  }
  const experiment = lineage.experiment;
  let experimentBinding: { experimentRef: string; trialRef: string } | null = null;
  if (experiment !== null && experiment !== undefined) {
    if (!isRecord(experiment) || !isNonEmptyString(experiment.experimentRef) || !isNonEmptyString(experiment.trialRef)) {
      return fail('invalid_field', `${path}.lineage.experiment must be null or { experimentRef, trialRef }`, `${path}.lineage.experiment`);
    }
    experimentBinding = { experimentRef: experiment.experimentRef, trialRef: experiment.trialRef };
  }
  const envelope: OutcomeEnvelopeMirror = {
    outcomeId: record.outcomeId as OutcomeRecordRef,
    tenant: record.tenant as string,
    project: record.project as string,
    trajectoryRef: lineage.trajectoryRef === null || lineage.trajectoryRef === undefined ? null : (lineage.trajectoryRef as TrajectoryRef),
    experiment: experimentBinding === null ? null : { experimentRef: experimentBinding.experimentRef as ExperimentRef, trialRef: experimentBinding.trialRef as TrialId },
    shadowSessionRef: shadow.sessionId as SessionRef,
    asOf: record.asOf as TimestampMs,
  };
  if (!isOutcomeEnvelopeMirror(envelope)) {
    return fail('invalid_field', `${path} fails the outcome envelope mirror (identity prefix, scope, shadow session, instant)`, path);
  }
  return ok(envelope);
}

/** Extract + validate the post-mortem envelope of one T033 post-mortem record (the payload forwards verbatim). */
function postMortemEnvelopeOf(record: unknown, path: string): ImprovementResult<PostMortemEnvelopeMirror> {
  if (!isRecord(record)) return fail('invalid_type', `${path} must be an object (a T033 post-mortem record)`, path);
  const lineage = record.lineage;
  if (!isRecord(lineage)) return fail('invalid_field', `${path}.lineage is absent — a post-mortem record carries its lineage block`, `${path}.lineage`);
  const envelope: PostMortemEnvelopeMirror = {
    postMortemId: record.postMortemId as PostMortemRef,
    tenant: lineage.tenant as string,
    project: lineage.project as string,
    shadowSessionRef: lineage.shadowSessionRef as SessionRef,
    asOf: record.asOf as TimestampMs,
  };
  if (!isPostMortemEnvelopeMirror(envelope)) {
    return fail('invalid_field', `${path} fails the post-mortem envelope mirror (identity prefix, scope, shadow session, instant)`, path);
  }
  return ok(envelope);
}

// ---------------------------------------------------------------------------
// Deterministic derivations (pure)
// ---------------------------------------------------------------------------

/** The capability key a focus's gap grounds: `improvement:<kind>:<focus>` (the capability CONTRACT the failure evidences — L16a). */
export function capabilityKeyOf(kind: CapabilityGapKind, focus: LearningFocus): string {
  return `improvement:${kind}:${focus}`;
}

/** The sorted-deduped union of a string list (the deterministic evidence fold). */
function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

// ---------------------------------------------------------------------------
// The cycle
// ---------------------------------------------------------------------------

/**
 * Run ONE improvement cycle (see module header). Fail-closed at every
 * gate: the returned state is untouched unless every gate passed and
 * every product minted. Deterministic: the same (state, inputs) pair
 * yields byte-identical products and the same appended record, twice.
 */
export function runImprovementCycle(state: unknown, inputs: ImprovementCycleInputs): ImprovementResult<ImprovementCycleResult> {
  // --- GATE 0: the state + the improvement log's own chain -------------------
  if (!isAutonomousLearningState(state)) {
    return fail('invalid_type', 'runImprovementCycle requires a valid autonomous-learning state');
  }
  const brain0 = state as AutonomousLearningState;
  if (!verifyImprovementLog(brain0.log)) {
    return fail('chain_mismatch', 'the improvement log fails chain verification — a record was edited, removed (hidden), spliced or reordered; a tampered improvement history never drives the next cycle');
  }

  // --- GATE 1: the scope + the instant + the policy --------------------------
  if (!isRecord(inputs)) return fail('invalid_type', 'the cycle inputs must be an object');
  const tenant = inputs.tenant as unknown;
  const project = inputs.project as unknown;
  if (!isNonEmptyString(tenant)) return fail('tenant_missing', 'the cycle declares its tenant scope (L12 — an unscoped cycle is inexpressible)', 'tenant');
  if (!isNonEmptyString(project)) return fail('tenant_missing', 'the cycle declares its project scope (L15 — an unscoped cycle is inexpressible)', 'project');
  const at = inputs.at as unknown;
  if (!isTimestampMs(at)) return fail('invalid_timestamp', 'the cycle carries its injected instant (at) — no ambient clock', 'at');
  const policyResult = validateImprovementPolicy(inputs.policy);
  if (!policyResult.ok) return policyResult;
  const policy = policyResult.value;
  const policyDigest = improvementPolicyDigest(policy);

  // --- GATE 2: the hooks (mirrors, duplicates, scope, L4) --------------------
  if (!Array.isArray(inputs.hooks)) return fail('invalid_field', 'the cycle carries its T033 learning hooks as an array', 'hooks');
  const hooks: OutcomeLearningHookMirror[] = [];
  const seenHookIds = new Set<string>();
  for (let index = 0; index < (inputs.hooks as readonly unknown[]).length; index++) {
    const hook = (inputs.hooks as readonly unknown[])[index];
    if (!isOutcomeLearningHookMirror(hook)) {
      return fail('invalid_field', `hooks[${index}] fails the outcome-learning hook mirror (T033's shape: the closed vocabularies, the content-addressed olh: id, the evidence, the instant)`, `hooks[${index}]`);
    }
    if (seenHookIds.has(hook.hookId)) {
      return fail('duplicate_evidence', `hooks[${index}] re-supplies hook ${hook.hookId} — evidence contributes EXACTLY ONCE within a cycle`, `hooks[${index}].hookId`);
    }
    seenHookIds.add(hook.hookId);
    if (hook.tenant !== tenant || hook.project !== project) {
      return fail('tenant_scope_mismatch', `hooks[${index}] (${hook.hookId}) belongs to tenant ${JSON.stringify(hook.tenant)}/project ${JSON.stringify(hook.project)} but the cycle serves ${JSON.stringify(tenant)}/${JSON.stringify(project)} — a curriculum never trains on another scope's failures (L12)`, `hooks[${index}]`);
    }
    if ((hook.asOf as number) > (at as number)) {
      return fail('l4_boundary_violation', `hooks[${index}] (${hook.hookId}) is stamped ${String(hook.asOf)}, AFTER the cycle instant ${String(at)} — the loop never improves on future evidence (L4)`, `hooks[${index}].asOf`);
    }
    hooks.push(hook);
  }
  // The ledger: no hook consumed by an EARLIER cycle may re-enter.
  const ledger = new Set(brain0.consumedHooks.map((entry) => entry.hookId));
  for (const hook of hooks) {
    if (ledger.has(hook.hookId)) {
      return fail('duplicate_evidence', `hook ${hook.hookId} was already consumed by an earlier cycle — evidence contributes EXACTLY ONCE (the consumed-hooks ledger); re-feeding the same outcomes through a second cycle is inexpressible`, 'hooks');
    }
  }

  // --- GATE 3: the outcome + post-mortem records (envelopes, scope, L4) -------
  if (!Array.isArray(inputs.outcomes)) return fail('invalid_field', 'the cycle carries its T033 outcome records as an array', 'outcomes');
  if (!Array.isArray(inputs.postMortems)) return fail('invalid_field', 'the cycle carries its T033 post-mortem records as an array', 'postMortems');
  const outcomeEnvelopes: OutcomeEnvelopeMirror[] = [];
  const seenOutcomeIds = new Set<string>();
  for (let index = 0; index < (inputs.outcomes as readonly unknown[]).length; index++) {
    const envelope = outcomeEnvelopeOf((inputs.outcomes as readonly unknown[])[index], `outcomes[${index}]`);
    if (!envelope.ok) return envelope;
    const value = envelope.value;
    if (seenOutcomeIds.has(value.outcomeId)) {
      return fail('duplicate_evidence', `outcomes[${index}] re-supplies outcome ${value.outcomeId} — a memory feed carries every record exactly once`, `outcomes[${index}]`);
    }
    seenOutcomeIds.add(value.outcomeId);
    if (value.tenant !== tenant || value.project !== project) {
      return fail('tenant_scope_mismatch', `outcomes[${index}] (${value.outcomeId}) belongs to tenant ${JSON.stringify(value.tenant)}/project ${JSON.stringify(value.project)} but the cycle serves ${JSON.stringify(tenant)}/${JSON.stringify(project)} — the Firm Brain never learns another scope's records (L12)`, `outcomes[${index}]`);
    }
    if ((value.asOf as number) > (at as number)) {
      return fail('l4_boundary_violation', `outcomes[${index}] (${value.outcomeId}) is stamped ${String(value.asOf)}, AFTER the cycle instant ${String(at)} (L4)`, `outcomes[${index}]`);
    }
    outcomeEnvelopes.push(value);
  }
  const postMortemEnvelopes: PostMortemEnvelopeMirror[] = [];
  const seenPostMortemIds = new Set<string>();
  for (let index = 0; index < (inputs.postMortems as readonly unknown[]).length; index++) {
    const envelope = postMortemEnvelopeOf((inputs.postMortems as readonly unknown[])[index], `postMortems[${index}]`);
    if (!envelope.ok) return envelope;
    const value = envelope.value;
    if (seenPostMortemIds.has(value.postMortemId)) {
      return fail('duplicate_evidence', `postMortems[${index}] re-supplies post-mortem ${value.postMortemId} — a memory feed carries every record exactly once`, `postMortems[${index}]`);
    }
    seenPostMortemIds.add(value.postMortemId);
    if (value.tenant !== tenant || value.project !== project) {
      return fail('tenant_scope_mismatch', `postMortems[${index}] (${value.postMortemId}) belongs to tenant ${JSON.stringify(value.tenant)}/project ${JSON.stringify(value.project)} but the cycle serves ${JSON.stringify(tenant)}/${JSON.stringify(project)} (L12)`, `postMortems[${index}]`);
    }
    if ((value.asOf as number) > (at as number)) {
      return fail('l4_boundary_violation', `postMortems[${index}] (${value.postMortemId}) is stamped ${String(value.asOf)}, AFTER the cycle instant ${String(at)} (L4)`, `postMortems[${index}]`);
    }
    postMortemEnvelopes.push(value);
  }

  // --- GATE 4: the served knowledge (envelopes, scope, L4) --------------------
  if (!Array.isArray(inputs.knowledge)) return fail('invalid_field', 'the cycle carries its T034 served-knowledge envelopes as an array', 'knowledge');
  if (!isNonEmptyString(inputs.knowledgeHead)) {
    return fail('invalid_field', 'the cycle carries the Firm-Brain state digest it read (the L9 binding — the improvement names the brain it improved upon)', 'knowledgeHead');
  }
  const knowledge: ServedKnowledgeEnvelopeMirror[] = [];
  for (let index = 0; index < (inputs.knowledge as readonly unknown[]).length; index++) {
    const envelope = (inputs.knowledge as readonly unknown[])[index];
    if (!isServedKnowledgeEnvelopeMirror(envelope)) {
      return fail('invalid_field', `knowledge[${index}] fails the served-knowledge envelope mirror (the fkr: identity, the scope, the claim kind, the status, the instant)`, `knowledge[${index}]`);
    }
    if (envelope.tenant !== tenant || envelope.project !== project) {
      return fail('tenant_scope_mismatch', `knowledge[${index}] (${envelope.knowledgeId}) belongs to tenant ${JSON.stringify(envelope.tenant)}/project ${JSON.stringify(envelope.project)} but the cycle serves ${JSON.stringify(tenant)}/${JSON.stringify(project)} — the agenda never reads another scope's brain (L12)`, `knowledge[${index}]`);
    }
    if ((envelope.asOf as number) > (at as number)) {
      return fail('l4_boundary_violation', `knowledge[${index}] (${envelope.knowledgeId}) was promoted at ${String(envelope.asOf)}, AFTER the cycle instant ${String(at)} — the agenda never annotates with future knowledge (L4)`, `knowledge[${index}]`);
    }
    knowledge.push(envelope);
  }

  // --- GATE 5: the curriculum trail (mirror, chain, scope, L4, position) ------
  const trail = inputs.trail;
  if (!isCurriculumTrailMirror(trail)) {
    return fail('invalid_field', 'the curriculum trail fails its mirror (the lineage block, the transition records, the chain array, the scope coherence)', 'trail');
  }
  if (!verifyCurriculumTrailMirror(trail)) {
    return fail('chain_mismatch', 'the curriculum trail fails chain verification — a transition was edited, removed, spliced or reordered; the loop never plans from a tampered trail (L11)', 'trail');
  }
  if (trail.lineage.tenant !== tenant || trail.lineage.project !== project) {
    return fail('tenant_scope_mismatch', `the curriculum trail belongs to tenant ${JSON.stringify(trail.lineage.tenant)}/project ${JSON.stringify(trail.lineage.project)} but the cycle serves ${JSON.stringify(tenant)}/${JSON.stringify(project)} (L12)`, 'trail');
  }
  for (let index = 0; index < trail.records.length; index++) {
    const record = trail.records[index] as { recordedAt: number };
    if (record.recordedAt > (at as number)) {
      return fail('l4_boundary_violation', `the curriculum trail's record ${index} was recorded at ${String(record.recordedAt)}, AFTER the cycle instant ${String(at)} — the earned rung must be knowable at T (L4)`, `trail.records[${index}].recordedAt`);
    }
  }
  const current = trailPositionMirror(trail);
  if (current === null) {
    return fail('lineage_gap', 'the curriculum trail has not entered the ladder — there is no earned rung to improve from (open the trail with T015\'s entry record first)', 'trail');
  }

  // --- GATE 6: the search record (mirror, chain, scope, L4) ------------------
  const search = inputs.search;
  if (!isSearchRecordMirror(search)) {
    return fail('invalid_field', 'the search record fails its mirror (the srch: identity, the binding block, the entries, the chain head)', 'search');
  }
  if (!verifySearchRecordMirror(search)) {
    return fail('chain_mismatch', 'the search record fails chain verification — a trial was edited, removed (hidden), spliced or reordered; the loop never adopts on a tampered search history (T031/L11)', 'search');
  }
  if (search.tenant !== tenant || search.project !== project) {
    return fail('tenant_scope_mismatch', `the search record belongs to tenant ${JSON.stringify(search.tenant)}/project ${JSON.stringify(search.project)} but the cycle serves ${JSON.stringify(tenant)}/${JSON.stringify(project)} (L12)`, 'search');
  }
  for (let index = 0; index < search.entries.length; index++) {
    const entry = search.entries[index] as { recorded_at: number };
    if (entry.recorded_at > (at as number)) {
      return fail('l4_boundary_violation', `the search record's entry ${index} was recorded at ${String(entry.recorded_at)}, AFTER the cycle instant ${String(at)} (L4)`, `search.entries[${index}].recorded_at`);
    }
  }
  if (!isSearchPolicyBlock(inputs.searchPolicy)) {
    return fail('invalid_field', 'the cycle carries its search policy block { evaluationPolicy, splits, datasets } — the minted trials cite the evaluation discipline', 'searchPolicy');
  }
  const searchPolicy = inputs.searchPolicy;

  // --- GATE 7: the evaluated evidence + THE ADOPTION GATE (T031) -------------
  if (!Array.isArray(inputs.evaluations)) return fail('invalid_field', 'the cycle carries its evaluated evidence as an array', 'evaluations');
  const evaluations: EvaluatedEvidenceMirror[] = [];
  for (let index = 0; index < (inputs.evaluations as readonly unknown[]).length; index++) {
    const evaluation = (inputs.evaluations as readonly unknown[])[index];
    if (!isEvaluatedEvidenceMirror(evaluation)) {
      return fail('invalid_field', `evaluations[${index}] fails the evaluated-evidence mirror (the T012 verdict essentials + the T031 trial binding)`, `evaluations[${index}]`);
    }
    evaluations.push(evaluation);
  }
  // The gate runs ALWAYS: the hidden-trials law is fail-closed over every
  // claimed evaluation, whether or not a commission is attempted this cycle.
  const gate = evaluateAdoptionGate(search, evaluations, policy.requiresHoldout);
  if (!gate.ok) return gate;
  const adoption: AdoptionVerdict = gate.value;

  // --- GATE 8: the planning context ------------------------------------------
  if (!isPlanningContext(inputs.planning)) {
    return fail('lineage_gap', 'the cycle carries its planning context { goal, constraints, candidate, seed } — the revised plan input cites them (L9/L15)', 'planning');
  }
  const planning = inputs.planning;

  // ---------------------------------------------------------------------------
  // THE AGENDA (deterministic, the DECLARED decision table)
  // ---------------------------------------------------------------------------

  // 1. THE GAPS: every failure hook whose focus grounds a gap kind mints one
  //    capability gap (T016-shaped; the hook IS the failure evidence).
  const gaps: CapabilityGapMirror[] = [];
  const gapFocuses: LearningFocus[] = [];
  const focusOfGap = new Map<string, LearningFocus>();
  for (const hook of hooks) {
    const action: FocusAction = policy.focusTable[hook.suggestedFocus];
    if (action.gapKind === null) continue; // the honest no-gap row (e.g. data_pipeline)
    const capabilityKey = capabilityKeyOf(action.gapKind, hook.suggestedFocus);
    const content = {
      kind: action.gapKind,
      capabilityKey,
      evidenceRef: hook.hookId,
      detectedAt: hook.asOf,
      tenantId: tenant,
      projectId: project,
    };
    const gapId = `alg:${fnv1a32Hex(canonicalJson(content as never))}`;
    const gap: CapabilityGapMirror = deepFreeze({
      gapId: gapId as CapabilityGapId,
      kind: action.gapKind,
      capabilityKey: capabilityKey as CapabilityKey,
      evidenceRef: hook.hookId as unknown as AttainmentEvidenceRef,
      detectedAt: hook.asOf,
      tenantId: tenant,
      projectId: project,
    });
    gaps.push(gap);
    gapFocuses.push(hook.suggestedFocus);
    focusOfGap.set(gapId, hook.suggestedFocus);
  }

  // 2. THE ACTIVE-KNOWLEDGE INDEX (the brain-informed annotation join).
  const activeByKind = new Map<string, readonly string[]>();
  for (const entry of knowledge) {
    if (entry.status !== 'active') continue;
    const list = [...(activeByKind.get(entry.kind) ?? []), entry.knowledgeId];
    activeByKind.set(entry.kind, list);
  }
  for (const [kind, list] of activeByKind) activeByKind.set(kind, sortedUnique(list));

  // 3. THE CURRICULUM REVISION (gaps + the earned rung + the brain's context).
  let revision: CurriculumRevision | null = null;
  if (gaps.length > 0) {
    const planInput: CurriculumPlanInputMirror = deepFreeze({
      goal: planning.goal,
      constraints: planning.constraints,
      candidate: planning.candidate,
      seed: planning.seed,
      current,
      gaps: [...gaps],
      tenant,
      project,
    });
    const annotations: GapAnnotation[] = gaps.map((gap) => {
      const focus = focusOfGap.get(gap.gapId) as LearningFocus;
      const row = policy.focusTable[focus];
      const related = row.knowledgeKind === null ? [] : (activeByKind.get(row.knowledgeKind) ?? []);
      return deepFreeze({ gapId: gap.gapId, focus, relatedKnowledge: related } satisfies GapAnnotation);
    });
    const revisionContent = {
      planInput: {
        goal: planInput.goal,
        constraints: planInput.constraints,
        candidate: planInput.candidate,
        seed: planInput.seed,
        current: planInput.current,
        gaps: planInput.gaps.map((gap) => gap.gapId),
        tenant: planInput.tenant,
        project: planInput.project,
      },
      knowledgeHead: inputs.knowledgeHead,
      annotations: annotations.map((annotation) => ({ gapId: annotation.gapId, relatedKnowledge: [...annotation.relatedKnowledge] })),
      tenant,
      project,
      at,
    };
    revision = deepFreeze({
      kind: 'curriculum-revision',
      revisionId: `alv:${fnv1a32Hex(canonicalJson(revisionContent as never))}`,
      planInput,
      knowledgeHead: inputs.knowledgeHead,
      annotations,
      tenant,
      project,
      at,
    } satisfies CurriculumRevision);
  }

  // 4. THE SKILL COMMISSION (the commissioning focuses' bundle, adoption-gated).
  const commissioningFocuses = LEARNING_FOCUS.filter(
    (focus) => policy.focusTable[focus].commission && hooks.some((hook) => hook.suggestedFocus === focus),
  );
  let commission: SkillCommission | null = null;
  if (commissioningFocuses.length > 0) {
    const commissionGaps = gaps.filter((gap) => {
      const focus = focusOfGap.get(gap.gapId) as LearningFocus;
      return policy.focusTable[focus].commission;
    });
    const trajectoryRefs = sortedUnique(
      outcomeEnvelopes.map((envelope) => envelope.trajectoryRef).filter((ref): ref is TrajectoryRef => ref !== null),
    );
    const trialRefs = sortedUnique([
      ...evaluations.map((evaluation) => evaluation.trial),
      ...outcomeEnvelopes.flatMap((envelope) => (envelope.experiment === null ? [] : [envelope.experiment.trialRef])),
    ]);
    const verdictRefs = sortedUnique(evaluations.map((evaluation) => evaluation.verdict));
    const evidence: CommissionEvidence = deepFreeze({ trajectoryRefs, trialRefs, verdictRefs });
    const status: 'commissioned' | 'withheld' = adoption.decision;
    const refusal = adoption.decision === 'withheld' ? adoption.refusal : null;
    const commissionContent = {
      status,
      refusal,
      focuses: [...commissioningFocuses],
      gaps: commissionGaps.map((gap) => gap.gapId),
      evidence,
      seed: planning.seed,
      grounding: adoption.grounding.map((entry) => ({ verdict: entry.verdict, trial: entry.trial, classification: entry.classification })),
      tenant,
      project,
      at,
    };
    commission = deepFreeze({
      kind: 'skill-commission',
      commissionId: `als:${fnv1a32Hex(canonicalJson(commissionContent as never))}`,
      status,
      refusal,
      focuses: [...commissioningFocuses],
      gaps: [...commissionGaps],
      evidence,
      seed: planning.seed,
      grounding: adoption.grounding,
      tenant,
      project,
      at,
    } satisfies SkillCommission);
  }

  // 5. THE MEMORY FEED (every cycle with records feeds the brain).
  let memory: MemoryFeed | null = null;
  if ((inputs.outcomes as readonly unknown[]).length > 0 || (inputs.postMortems as readonly unknown[]).length > 0) {
    const feedContent = {
      outcomes: [...seenOutcomeIds],
      postMortems: [...seenPostMortemIds],
      at,
    };
    memory = deepFreeze({
      kind: 'memory-feed',
      feedId: `alm:${fnv1a32Hex(canonicalJson(feedContent as never))}`,
      snapshot: deepFreeze({ outcomes: [...(inputs.outcomes as readonly unknown[])], postMortems: [...(inputs.postMortems as readonly unknown[])] }),
      at,
    } satisfies MemoryFeed);
  }

  // 6. THE SEARCH TRIALS (L11 — the improvement search is retained).
  const priorRevisionTrials = brain0.log.cycles
    .map((record) => record.revisionTrial)
    .filter((trial): trial is string => trial !== null);
  const priorCommissionTrials = brain0.log.cycles
    .map((record) => record.commissionTrial)
    .filter((trial): trial is string => trial !== null);
  const searchTrials: SearchTrialInputMirror[] = [];
  let revisionTrialId: string | null = null;
  let commissionTrialId: string | null = null;
  if (revision !== null) {
    const parents = priorRevisionTrials.length === 0 ? [] : [priorRevisionTrials[priorRevisionTrials.length - 1] as string];
    const config: JsonObject = deepFreeze({
      product: 'curriculum_revision',
      revision: revision.revisionId,
      gaps: [...revision.planInput.gaps.map((gap) => gap.gapId)],
      current: revision.planInput.current,
      knowledge_head: revision.knowledgeHead,
    });
    const minted = mintImprovementSearchTrial({
      kind: 'curriculum_revision',
      productId: revision.revisionId,
      config,
      parents,
      policy: searchPolicy,
      at,
      tenant,
      project,
    });
    if (!minted.ok) return minted;
    searchTrials.push(minted.value);
    revisionTrialId = minted.value.trial;
  }
  if (commission !== null && commission.status === 'commissioned') {
    // A WITHHELD commission never enters the search — it never ran.
    const parents = priorCommissionTrials.length === 0 ? [] : [priorCommissionTrials[priorCommissionTrials.length - 1] as string];
    const config: JsonObject = deepFreeze({
      product: 'skill_commission',
      commission: commission.commissionId,
      gaps: [...commission.gaps.map((gap) => gap.gapId)],
      grounding: commission.grounding.map((entry) => entry.verdict),
    });
    const minted = mintImprovementSearchTrial({
      kind: 'skill_commission',
      productId: commission.commissionId,
      config,
      parents,
      policy: searchPolicy,
      at,
      tenant,
      project,
    });
    if (!minted.ok) return minted;
    searchTrials.push(minted.value);
    commissionTrialId = minted.value.trial;
  }

  // ---------------------------------------------------------------------------
  // THE CYCLE RECORD + THE ATOMIC APPEND
  // ---------------------------------------------------------------------------

  const commissionStatus = commission === null ? 'none' : commission.status;
  const record: Omit<ImprovementCycleRecord, 'cycleId'> = {
    ordinal: brain0.log.cycles.length + 1,
    tenant,
    project,
    at,
    policyDigest,
    knowledgeHead: inputs.knowledgeHead,
    consumedHooks: hooks.map((hook) => hook.hookId),
    gaps: gaps.map((gap) => gap.gapId),
    revision: revision?.revisionId ?? null,
    commission: commission?.commissionId ?? null,
    commissionStatus,
    commissionRefusal: commission?.refusal ?? null,
    memoryFeed: memory?.feedId ?? null,
    revisionTrial: revisionTrialId,
    commissionTrial: commissionTrialId,
  };
  const cycleRecord: ImprovementCycleRecord = deepFreeze({
    ...record,
    cycleId: `alc:${cycleRecordContentDigest(record)}` as ImprovementCycleId,
  });
  const appended = appendImprovementCycle(brain0, cycleRecord);
  if (!appended.ok) return appended;

  const products: ImprovementProducts = deepFreeze({
    gaps: [...gaps],
    revision,
    commission,
    memory,
    searchTrials: [...searchTrials],
  });

  return ok({ state: appended.value, cycle: cycleRecord, products });
}
