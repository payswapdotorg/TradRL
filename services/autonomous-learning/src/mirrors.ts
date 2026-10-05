/**
 * @tradrl/autonomous-learning (service) — THE STRUCTURAL MIRRORS of the
 * composed lanes (Work Order T035).
 *
 * This service owns NO contract package among the frozen siblings (the
 * services/api precedent: "Study the merged surfaces you compose —
 * mirrors only, never imports"). Every cross-lane shape this loop
 * consumes is re-declared here BY STRUCTURE (the D-003/D-004 law), and
 * src/interop.test.ts — which imports the REAL packages test-only — is
 * the drift trip wire: a REAL record that fails these mirrors is a loud
 * test failure, never a silent coercion.
 *
 * The mirrored lanes and what this loop uses them for:
 *   - T033 (packages/outcomes + services/outcome-learning): the
 *     OUTCOME-LEARNING HOOKS — the typed per-outcome learning signals the
 *     loop consumes (`queryLearningHooks`' output: the hook with its
 *     closed focus/outcome-class/attribution vocabularies, its realized
 *     gaps and its evidence refs) — plus the OUTCOME/POST-MORTEM
 *     ENVELOPES the memory feed forwards to the Firm Brain (T034's
 *     `ingestFirmLearning` owns the full record validation; this lane
 *     validates the envelope — identity prefix, scope, instant — and
 *     forwards the payload verbatim, the api-service mirrors precedent:
 *     "the boundary validates structure and forwards semantics").
 *   - T034 (packages/firm-memory + services/firm-memory): the SERVED
 *     FIRM-KNOWLEDGE ENVELOPES — the active knowledge the loop's
 *     improvement agenda reads and annotates its revisions with (the
 *     brain's full claim/provenance validation stays with T034).
 *   - T015/T016 (services/learning + packages/organization): the
 *     CAPABILITY-GAP MIRROR (field-for-field — a REAL organization-lane
 *     gap record IS a loop gap record, mutually assignable), the
 *     CURRICULUM STAGE vocabulary and the CURRICULUM TRAIL mirror with
 *     its CHAIN VERIFICATION (the FNV-1a fold, re-derived law-for-law so
 *     the loop never improves on a tampered trail).
 *   - T012/T031 (packages/evaluation + packages/search-lineage): the
 *     EVALUATED EVIDENCE binding (a T012 attainment verdict's essentials
 *     + the T031 trial it ran under — the adoption gate's input) and the
 *     SEARCH RECORD mirror with its CHAIN VERIFICATION (the dual-lane
 *     stableDigest fold, re-derived law-for-law so the loop never adopts
 *     on a tampered search history) plus the SEARCH TRIAL INPUT mirror
 *     (the append bundle this loop emits for every improvement product —
 *     the improvement loop IS a search).
 *
 * Guard discipline: the guards check STRUCTURAL presence, the closed
 * vocabularies, the prefix disciplines and the chain folds; the owning
 * lanes' COHERENCE laws were enforced at their own mints and are NOT
 * re-derived here — this loop validates structure, verifies chains, and
 * forwards semantics.
 */

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  stableDigest,
  stableDigestJson,
  type JsonObject,
  type JsonValue,
  type TimestampMs,
} from './primitives';
import { isMemberOf } from './primitives';
import type {
  ArmId,
  AttainmentEvidenceRef,
  CapabilityGapId,
  CapabilityKey,
  ConfigSnapshotId,
  CurriculumVersionRef,
  DataRef,
  EvaluatorVersionRef,
  ExperimentId,
  GoalRef,
  ProjectId,
  SearchRecordId,
  SessionRef,
  SplitPolicyRef,
  TenantId,
  TrialId,
} from './ids';
import {
  isArmId,
  isAttainmentEvidenceRef,
  isCapabilityGapId,
  isCapabilityKey,
  isConfigSnapshotId,
  isCurriculumVersionRef,
  isDataRef,
  isEvaluatorVersionRef,
  isExperimentId,
  isGoalRef,
  isHookRef,
  isKnowledgeId,
  isOutcomeRecordRef,
  isPostMortemRef,
  isProjectId,
  isSearchRecordId,
  isSessionRef,
  isSplitPolicyRef,
  isTenantId,
  isTrialId,
  isVerdictId,
} from './ids';

// ---------------------------------------------------------------------------
// T033 — the learning-focus, outcome-class and attribution vocabularies
// ---------------------------------------------------------------------------

/**
 * The closed learning-focus vocabulary — mirror of @tradrl/outcomes'
 * `LEARNING_FOCUS` (T033): what the hook SUGGESTS the improver look at (a
 * suggestion, never a command — the R27 boundary: hooks inform, the
 * improver decides).
 */
export const LEARNING_FOCUS = [
  'strategy_revision',
  'model_recalibration',
  'data_pipeline',
  'risk_policy',
  'execution_quality',
  'none',
] as const;

/** One learning focus (mirror of T033's closed vocabulary). */
export type LearningFocus = (typeof LEARNING_FOCUS)[number];

/** Guard: a learning focus. */
export function isLearningFocus(v: unknown): v is LearningFocus {
  return isMemberOf(LEARNING_FOCUS, v);
}

/**
 * The closed outcome-class vocabulary — mirror of @tradrl/outcomes'
 * `OUTCOME_CLASSES` (T033): the seven derived classes of a learned
 * outcome.
 */
export const OUTCOME_CLASSES = [
  'averted',
  'no_execution',
  'execution_shortfall',
  'as_expected',
  'adverse_gap',
  'favorable_gap',
  'unbenchmarked_fill',
] as const;

/** One outcome class (mirror of T033's closed vocabulary). */
export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];

/** Guard: an outcome class. */
export function isOutcomeClass(v: unknown): v is OutcomeClass {
  return isMemberOf(OUTCOME_CLASSES, v);
}

/**
 * The closed attribution-class vocabulary — mirror of @tradrl/outcomes'
 * attribution surface (T033): the four typed post-mortem hypothesis
 * classes.
 */
export const ATTRIBUTION_CLASSES = ['decision', 'market_move', 'model_error', 'data_lag'] as const;

/** One attribution class (mirror of T033's closed vocabulary). */
export type AttributionClass = (typeof ATTRIBUTION_CLASSES)[number];

/** Guard: an attribution class. */
export function isAttributionClass(v: unknown): v is AttributionClass {
  return isMemberOf(ATTRIBUTION_CLASSES, v);
}

// ---------------------------------------------------------------------------
// T033 — the outcome-learning hook (field-for-field)
// ---------------------------------------------------------------------------

/** The dominant-attribution snapshot a hook carries (mirror of T033's shape). */
export interface DominantAttributionMirror {
  readonly class: AttributionClass;
  readonly confidence: string;
}

/** Guard: the dominant-attribution snapshot. */
export function isDominantAttributionMirror(v: unknown): v is DominantAttributionMirror {
  if (!isRecord(v)) return false;
  return isAttributionClass(v.class) && isNonEmptyString(v.confidence);
}

/**
 * One outcome-learning hook — STRUCTURAL MIRROR of @tradrl/outcomes'
 * `OutcomeLearningHook` (T033): the typed per-outcome learning signal the
 * loop consumes (R27: it informs, never decides — no acceptance verdict,
 * no body-version proposal, no capability change; only the typed facts).
 * Field-for-field with the owning lane: the content-addressed identity,
 * the subject refs, the scope, the class, the realized gaps, the dominant
 * attribution, the focus suggestion, the evidence and the instant.
 */
export interface OutcomeLearningHookMirror {
  readonly hookId: string;
  readonly outcomeRecordRef: string;
  readonly decisionRef: string;
  readonly intentRef: string;
  readonly tenant: string;
  readonly project: string;
  readonly outcomeClass: OutcomeClass;
  readonly realizedGap: string | null;
  readonly quantityShortfall: string | null;
  readonly dominantAttribution: DominantAttributionMirror | null;
  readonly suggestedFocus: LearningFocus;
  readonly evidence: readonly { readonly kind: string; readonly ref: string }[];
  readonly asOf: TimestampMs;
}

/** Guard: `OutcomeLearningHookMirror` (total, hand-rolled; mirrors the owner's guard). */
export function isOutcomeLearningHookMirror(v: unknown): v is OutcomeLearningHookMirror {
  if (!isRecord(v)) return false;
  if (!isHookRef(v.hookId)) return false;
  if (!isOutcomeRecordRef(v.outcomeRecordRef)) return false;
  if (!isNonEmptyString(v.decisionRef) || !isNonEmptyString(v.intentRef)) return false;
  if (!isTenantId(v.tenant) || !isProjectId(v.project)) return false;
  if (!isOutcomeClass(v.outcomeClass)) return false;
  if (v.realizedGap !== null && !isNonEmptyString(v.realizedGap)) return false;
  if (v.quantityShortfall !== null && !isNonEmptyString(v.quantityShortfall)) return false;
  if (v.dominantAttribution !== null && !isDominantAttributionMirror(v.dominantAttribution)) return false;
  if (!isLearningFocus(v.suggestedFocus)) return false;
  if (!Array.isArray(v.evidence)) return false;
  for (const entry of v.evidence as readonly unknown[]) {
    if (!isRecord(entry) || !isNonEmptyString(entry.kind) || !isNonEmptyString(entry.ref)) return false;
  }
  return isTimestampMs(v.asOf);
}

// ---------------------------------------------------------------------------
// T033 — the outcome / post-mortem envelopes (the memory feed's payload)
// ---------------------------------------------------------------------------

/**
 * One OUTCOME RECORD ENVELOPE — the memory feed's validated envelope over
 * T033's `OutcomeRecord` (the full record validation is the Firm Brain's
 * own at `ingestFirmLearning`; this lane checks the identity prefix, the
 * scope, the L9 bindings the feed cites and the L4 instant, then
 * forwards the payload VERBATIM — never transformed, never re-derived).
 */
export interface OutcomeEnvelopeMirror {
  /** The content-addressed outcome identity (`out:` + digest). */
  readonly outcomeId: string;
  readonly tenant: string;
  readonly project: string;
  /** The T011 trajectory binding (NULL = unbound) — the skill commission's evidence source. */
  readonly trajectoryRef: string | null;
  /** The T011 experiment/trial binding (NULL when the decision ran outside an experiment). */
  readonly experiment: { readonly experimentRef: string; readonly trialRef: string } | null;
  /** The T030 shadow session the record learned from (`shs:`) — the loop's L15 lineage root. */
  readonly shadowSessionRef: SessionRef;
  /** The learning instant (injected; L4-anchored). */
  readonly asOf: TimestampMs;
}

/** Guard: `OutcomeEnvelopeMirror`. */
export function isOutcomeEnvelopeMirror(v: unknown): v is OutcomeEnvelopeMirror {
  if (!isRecord(v)) return false;
  if (!isOutcomeRecordRef(v.outcomeId)) return false;
  if (!isTenantId(v.tenant) || !isProjectId(v.project)) return false;
  if (v.trajectoryRef !== null && !isNonEmptyString(v.trajectoryRef)) return false;
  if (v.experiment !== null) {
    const experiment = v.experiment as { experimentRef?: unknown; trialRef?: unknown };
    if (!isRecord(experiment) || !isNonEmptyString(experiment.experimentRef) || !isNonEmptyString(experiment.trialRef)) return false;
  }
  if (!isSessionRef(v.shadowSessionRef)) return false;
  return isTimestampMs(v.asOf);
}



/**
 * One POST-MORTEM ENVELOPE — the memory feed's validated envelope over
 * T033's `PostMortemRecord` (the same envelope law: identity prefix,
 * scope, the shadow session, the instant; the payload forwards VERBATIM).
 */
export interface PostMortemEnvelopeMirror {
  /** The content-addressed post-mortem identity (`pmr:` + digest). */
  readonly postMortemId: string;
  readonly tenant: string;
  readonly project: string;
  /** The T030 shadow session the subject's evidence came from (`shs:`). */
  readonly shadowSessionRef: SessionRef;
  /** The post-mortem instant (injected; strictly later than what it supersedes). */
  readonly asOf: TimestampMs;
}

/** Guard: `PostMortemEnvelopeMirror`. */
export function isPostMortemEnvelopeMirror(v: unknown): v is PostMortemEnvelopeMirror {
  if (!isRecord(v)) return false;
  if (!isPostMortemRef(v.postMortemId)) return false;
  if (!isTenantId(v.tenant) || !isProjectId(v.project)) return false;
  if (!isSessionRef(v.shadowSessionRef)) return false;
  return isTimestampMs(v.asOf);
}

// ---------------------------------------------------------------------------
// T034 — the served firm-knowledge envelope (the agenda's input)
// ---------------------------------------------------------------------------

/** The knowledge-kind vocabulary — mirror of @tradrl/firm-memory (T034). */
export const KNOWLEDGE_KINDS = ['decision_pattern', 'market_behavior', 'model_calibration', 'data_latency'] as const;

/** One knowledge kind (mirror of T034's closed vocabulary). */
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** Guard: a knowledge kind. */
export function isKnowledgeKind(v: unknown): v is KnowledgeKind {
  return isMemberOf(KNOWLEDGE_KINDS, v);
}

/**
 * One SERVED FIRM-KNOWLEDGE ENVELOPE — the active-knowledge surface the
 * loop's agenda reads (T034's `queryFirmKnowledge` output; the brain's
 * own chain gate and full claim validation stay with the serving lane —
 * this lane checks the identity prefix, the scope, the claim kind, the
 * status and the instant, and cites the entry).
 */
export interface ServedKnowledgeEnvelopeMirror {
  /** The content-addressed firm-knowledge identity (`fkr:` + digest). */
  readonly knowledgeId: string;
  readonly tenant: string;
  readonly project: string;
  /** WHAT the firm knows (the typed claim — the kind is the annotation join key). */
  readonly kind: KnowledgeKind;
  /** The entry's serving status (the loop reads ACTIVE knowledge as the brain's current position). */
  readonly status: 'active' | 'superseded' | 'decayed';
  /** The promotion instant (L4 — a future entry never annotates). */
  readonly asOf: TimestampMs;
}

/** Guard: `ServedKnowledgeEnvelopeMirror`. */
export function isServedKnowledgeEnvelopeMirror(v: unknown): v is ServedKnowledgeEnvelopeMirror {
  if (!isRecord(v)) return false;
  if (!isKnowledgeId(v.knowledgeId)) return false;
  if (!isTenantId(v.tenant) || !isProjectId(v.project)) return false;
  if (!isKnowledgeKind(v.kind)) return false;
  if (v.status !== 'active' && v.status !== 'superseded' && v.status !== 'decayed') return false;
  return isTimestampMs(v.asOf);
}

// ---------------------------------------------------------------------------
// T015/T016 — the capability-gap mirror (field-for-field)
// ---------------------------------------------------------------------------

/**
 * The closed capability-gap kind vocabulary — mirror of the organization
 * lane's six failure classes (T016, spec/LEARNING-LOOP.md: "regime,
 * sentiment/event, liquidity, execution, risk or coordination failure"),
 * spelled exactly as the organization and curriculum lanes spell them.
 */
export const CAPABILITY_GAP_KINDS = ['regime', 'sentiment-event', 'liquidity', 'execution', 'risk', 'coordination'] as const;

/** One failure class (mirror of the organization lane's closed vocabulary). */
export type CapabilityGapKind = (typeof CAPABILITY_GAP_KINDS)[number];

/** Guard: a capability-gap kind. */
export function isCapabilityGapKind(v: unknown): v is CapabilityGapKind {
  return isMemberOf(CAPABILITY_GAP_KINDS, v);
}

/**
 * One typed capability gap — STRUCTURAL MIRROR of the organization lane's
 * `CapabilityGap` (T016) and the curriculum lane's `CapabilityGapMirror`
 * (T015): field-for-field with the SAME brand tags, so a REAL
 * organization gap record IS a loop gap record (mutually assignable — the
 * compile-time trip wire) and satisfies this guard (the runtime trip
 * wire). The loop MINTS gap records in this shape (the failure-driven
 * learning inputs the revised curriculum plan consumes).
 */
export interface CapabilityGapMirror {
  /** Gap identity (unique within the consuming plan input's gap list). */
  readonly gapId: CapabilityGapId;
  /** The failure class (closed six-kind vocabulary above). */
  readonly kind: CapabilityGapKind;
  /** The capability contract whose absence the failure evidences (never a profession label — L16a). */
  readonly capabilityKey: CapabilityKey;
  /** Opaque reference to the failure evidence that detected the deficit. */
  readonly evidenceRef: AttainmentEvidenceRef;
  /** Explicit detection instant (epoch ms — carried, never read from a clock). */
  readonly detectedAt: TimestampMs;
  /** Owning tenant (L12 — plain string, mirroring the organization lane's exact field type). */
  readonly tenantId: string;
  /** Owning project (L12 — plain string, mirroring the organization lane's exact field type). */
  readonly projectId: string;
}

/** Guard: `CapabilityGapMirror` (total, hand-rolled; mirrors the organization guard). */
export function isCapabilityGapMirror(v: unknown): v is CapabilityGapMirror {
  if (!isRecord(v)) return false;
  return (
    isCapabilityGapId(v.gapId) &&
    isCapabilityGapKind(v.kind) &&
    isCapabilityKey(v.capabilityKey) &&
    isAttainmentEvidenceRef(v.evidenceRef) &&
    isTimestampMs(v.detectedAt) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId)
  );
}

// ---------------------------------------------------------------------------
// T015 — the curriculum ladder + trail (the chain-verified input)
// ---------------------------------------------------------------------------

/**
 * The closed curriculum-stage union — mirror of the curriculum lane's
 * nine rungs (T015), in ladder order. The array order IS the ladder
 * order — the frozen program-wide schedule of the learning loop.
 */
export const CURRICULUM_STAGES = [
  'synthetic_regimes',
  'historical_replay',
  'microstructure_friction',
  'reactive_market',
  'adversarial_population',
  'unseen_multi_regime',
  'rolling_time_machine',
  'shadow_trading',
  'controlled_live',
] as const;

/** One ladder rung (mirror of the curriculum lane's closed union). */
export type CurriculumStageKind = (typeof CURRICULUM_STAGES)[number];

/** Guard: a curriculum stage kind. */
export function isCurriculumStageKind(v: unknown): v is CurriculumStageKind {
  return isMemberOf(CURRICULUM_STAGES, v);
}

/** A rung's 0-based position in the ladder (mirror of the curriculum lane's order law). */
export function stagePosition(stage: CurriculumStageKind): number {
  return (CURRICULUM_STAGES as readonly string[]).indexOf(stage);
}

/** The evidence-citation mirror (field-for-field of the curriculum lane's `EvidenceCitation`). */
export interface EvidenceCitationMirror {
  readonly verdict: string;
  readonly criteria: string;
  readonly criteria_refs: readonly string[];
  readonly attained: boolean;
  readonly evidence_ref: AttainmentEvidenceRef;
}

/** Guard: `EvidenceCitationMirror`. */
export function isEvidenceCitationMirror(v: unknown): v is EvidenceCitationMirror {
  if (!isRecord(v)) return false;
  if (!isVerdictId(v.verdict)) return false;
  if (!isNonEmptyString(v.criteria)) return false;
  if (!Array.isArray(v.criteria_refs) || (v.criteria_refs as readonly unknown[]).length === 0) return false;
  if (!(v.criteria_refs as readonly unknown[]).every((ref) => isNonEmptyString(ref))) return false;
  if (typeof v.attained !== 'boolean') return false;
  return isAttainmentEvidenceRef(v.evidence_ref);
}

/** The transition-lineage mirror (field-for-field of the curriculum lane's `TransitionLineage`). */
export interface TransitionLineageMirror {
  readonly goal: string;
  readonly curriculum_version: string;
  readonly tenant: string;
  readonly project: string;
}

/** Guard: `TransitionLineageMirror`. */
export function isTransitionLineageMirror(v: unknown): v is TransitionLineageMirror {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.goal)) return false;
  if (!isCurriculumVersionRef(v.curriculum_version)) return false;
  if (!isTenantId(v.tenant) || !isProjectId(v.project)) return false;
  return true;
}

/**
 * One stage transition — mirror of the curriculum lane's `StageTransition`
 * (T015): the kind, the rungs, the evidence citation, the reason, the
 * explicit recorded instant, the lineage block and the stage-9 permission
 * record. The chain fold below re-derives the trail's record chain over
 * EXACTLY these fields (law-for-law with the owning lane).
 */
export interface StageTransitionMirror {
  readonly kind: 'entry' | 'advance' | 'regress' | 'refusal';
  readonly from: CurriculumStageKind | null;
  readonly to: CurriculumStageKind | null;
  readonly evidence: EvidenceCitationMirror | null;
  readonly reason: 'ladder_entry' | 'evidenced_advance' | 'evidenced_regression' | 'evidence_missing' | 'evidence_insufficient' | 'live_permission_missing';
  readonly recordedAt: TimestampMs;
  readonly lineage: TransitionLineageMirror;
  readonly live_permission: string | null;
}

/** Guard: `StageTransitionMirror`. */
export function isStageTransitionMirror(v: unknown): v is StageTransitionMirror {
  if (!isRecord(v)) return false;
  if (v.kind !== 'entry' && v.kind !== 'advance' && v.kind !== 'regress' && v.kind !== 'refusal') return false;
  if (v.from !== null && !isCurriculumStageKind(v.from)) return false;
  if (v.to !== null && !isCurriculumStageKind(v.to)) return false;
  if (v.evidence !== null && !isEvidenceCitationMirror(v.evidence)) return false;
  if (typeof v.reason !== 'string') return false;
  if (!isTimestampMs(v.recordedAt)) return false;
  if (!isTransitionLineageMirror(v.lineage)) return false;
  if (v.live_permission !== null && !isNonEmptyString(v.live_permission)) return false;
  return true;
}

/**
 * The curriculum trail — mirror of the curriculum lane's `CurriculumTrail`
 * (T015): the lineage block, the transition records in append order, and
 * the record chain (the fold after each appended record, in order).
 */
export interface CurriculumTrailMirror {
  readonly lineage: TransitionLineageMirror;
  readonly records: readonly StageTransitionMirror[];
  readonly record_chain: readonly string[];
}

/** Guard: `CurriculumTrailMirror` (shape + chain-length + scope coherence, mirroring the owning lane's guard). */
export function isCurriculumTrailMirror(v: unknown): v is CurriculumTrailMirror {
  if (!isRecord(v)) return false;
  if (!isTransitionLineageMirror(v.lineage)) return false;
  if (!Array.isArray(v.records)) return false;
  if (!(v.records as readonly unknown[]).every((record) => isStageTransitionMirror(record))) return false;
  if (!Array.isArray(v.record_chain)) return false;
  if ((v.record_chain as readonly unknown[]).length !== (v.records as readonly unknown[]).length) return false;
  const records = v.records as readonly StageTransitionMirror[];
  const lineage = v.lineage as TransitionLineageMirror;
  return records.every(
    (record) =>
      record.lineage.goal === lineage.goal &&
      record.lineage.curriculum_version === lineage.curriculum_version &&
      record.lineage.tenant === lineage.tenant &&
      record.lineage.project === lineage.project,
  );
}

/** The chain seed of the mirrored fold: `trail-<fnv1a32(canonical lineage)>` (the owning lane's exact law). */
export function trailChainSeedMirror(lineage: TransitionLineageMirror): string {
  return `trail-${fnv1a32Hex(canonicalJson({
    goal: lineage.goal,
    curriculum_version: lineage.curriculum_version,
    tenant: lineage.tenant,
    project: lineage.project,
  } satisfies JsonObject))}`;
}

/** One chain fold step (the owning lane's exact `fnv1a32(prev + ':' + digest)` law). */
export function trailChainStepMirror(previous: string, record: StageTransitionMirror): string {
  return fnv1a32Hex(`${previous}:${trailRecordDigestMirror(record)}`);
}

/** The canonical bytes of one transition record (the owning lane's exact fold input). */
export function trailRecordDigestMirror(record: StageTransitionMirror): string {
  return fnv1a32Hex(
    canonicalJson({
      kind: record.kind,
      from: record.from,
      to: record.to,
      evidence: record.evidence === null ? null : {
        verdict: record.evidence.verdict,
        criteria: record.evidence.criteria,
        criteria_refs: [...record.evidence.criteria_refs],
        attained: record.evidence.attained,
        evidence_ref: record.evidence.evidence_ref,
      },
      reason: record.reason,
      recordedAt: record.recordedAt,
      lineage: {
        goal: record.lineage.goal,
        curriculum_version: record.lineage.curriculum_version,
        tenant: record.lineage.tenant,
        project: record.lineage.project,
      },
      live_permission: record.live_permission,
    } satisfies JsonObject),
  );
}

/**
 * Verify the trail's record chain: recompute the lineage seed and fold
 * every record in order. A tampered, truncated or reordered trail fails
 * (`chain_mismatch` at the caller) — the loop never improves on a
 * tampered history.
 */
export function verifyCurriculumTrailMirror(trail: CurriculumTrailMirror): boolean {
  let head = trailChainSeedMirror(trail.lineage);
  const records = trail.records as readonly StageTransitionMirror[];
  for (let index = 0; index < records.length; index++) {
    head = trailChainStepMirror(head, records[index] as StageTransitionMirror);
    if (head !== trail.record_chain[index]) return false;
  }
  return true;
}

/**
 * The trail's current rung: the last non-refusal record's `to` (or null
 * before entry) — the owning lane's exact projection law.
 */
export function trailPositionMirror(trail: CurriculumTrailMirror): CurriculumStageKind | null {
  for (let index = trail.records.length - 1; index >= 0; index--) {
    const record = trail.records[index] as StageTransitionMirror;
    if (record.kind !== 'refusal') return record.to;
  }
  return null;
}

// ---------------------------------------------------------------------------
// T012/T031 — the evaluated evidence (the adoption gate's input)
// ---------------------------------------------------------------------------

/**
 * One EVALUATED EVIDENCE binding — this loop's own input contract: the
 * T012 attainment verdict's essentials (the verdict id and whether every
 * criterion attained in every split — the owning lane's `AttainmentVerdict`
 * essentials; the full record stays with the evaluation lane) plus the
 * T031 trial the evaluation ran under (the search classification the
 * adoption gate reads). The interop test proves REAL verdict identities
 * flow byte-exact through the binding.
 */
export interface EvaluatedEvidenceMirror {
  /** The T012 attainment verdict's id (opaque — the evaluation lane's identity space). */
  readonly verdict: string;
  /** Mirrored from the verdict: every criterion attained in every split. */
  readonly attained: boolean;
  /** The T011/T031 trial the evaluation ran under (the search record must hold it). */
  readonly trial: string;
  /** The compiled criteria record the verdict decided (the citation's anchor). */
  readonly criteria: string;
  /** Opaque reference to the evaluation run's evidence record. */
  readonly evidenceRef: string;
}

/** Guard: `EvaluatedEvidenceMirror`. */
export function isEvaluatedEvidenceMirror(v: unknown): v is EvaluatedEvidenceMirror {
  if (!isRecord(v)) return false;
  if (!isVerdictId(v.verdict)) return false;
  if (typeof v.attained !== 'boolean') return false;
  if (!isTrialId(v.trial)) return false;
  if (!isNonEmptyString(v.criteria)) return false;
  return isAttainmentEvidenceRef(v.evidenceRef);
}

// ---------------------------------------------------------------------------
// T031 — the search record (the chain-verified input) + the append bundle
// ---------------------------------------------------------------------------

/** The search classification vocabulary — mirror of @tradrl/search-lineage (T031). */
export const SEARCH_CLASSIFICATIONS = ['in-search', 'holdout'] as const;

/** One search classification (in-search vs holdout — the evaluation protocol's discriminator). */
export type SearchClassification = (typeof SEARCH_CLASSIFICATIONS)[number];

/** Guard: a search classification. */
export function isSearchClassification(v: unknown): v is SearchClassification {
  return isMemberOf(SEARCH_CLASSIFICATIONS, v);
}

/**
 * One search trial entry — STRUCTURAL MIRROR of @tradrl/search-lineage's
 * `SearchTrialEntry` (T031), field-for-field: the trial, the arm, the
 * in-search/holdout classification, the content-addressed config
 * snapshot, the parent edges, the splits, the datasets, the optimization
 * window, the evaluation policy, the injected instant, the scope. The
 * chain fold below re-derives the record's chain over EXACTLY these
 * fields (the dual-lane stableDigest, law-for-law with the owning lane).
 */
export interface SearchTrialEntryMirror {
  readonly trial: TrialId;
  readonly arm: ArmId | null;
  readonly classification: SearchClassification;
  readonly config: ConfigSnapshotId;
  readonly parents: readonly TrialId[];
  readonly splits: readonly SplitPolicyRef[];
  readonly datasets: readonly DataRef[];
  readonly window: { readonly start: TimestampMs; readonly end: TimestampMs } | null;
  readonly evaluation_policy: SplitPolicyRef;
  readonly recorded_at: TimestampMs;
  readonly tenant: string;
  readonly project: string;
}

/** Guard: `SearchTrialEntryMirror` (mirrors the owning lane's guard, the holdout leaf laws included). */
export function isSearchTrialEntryMirror(v: unknown): v is SearchTrialEntryMirror {
  if (!isRecord(v)) return false;
  if (!isTrialId(v.trial)) return false;
  if (v.arm !== null && !isArmId(v.arm)) return false;
  if (!isSearchClassification(v.classification)) return false;
  if (!isConfigSnapshotId(v.config)) return false;
  if (!Array.isArray(v.parents)) return false;
  if (!(v.parents as readonly unknown[]).every((p) => isTrialId(p))) return false;
  if (new Set(v.parents as readonly string[]).size !== (v.parents as readonly unknown[]).length) return false;
  if (!Array.isArray(v.splits) || (v.splits as readonly unknown[]).length === 0) return false;
  if (!(v.splits as readonly unknown[]).every((s) => isSplitPolicyRef(s))) return false;
  if (new Set(v.splits as readonly string[]).size !== (v.splits as readonly string[]).length) return false;
  if (!Array.isArray(v.datasets)) return false;
  if (!(v.datasets as readonly unknown[]).every((d) => isDataRef(d))) return false;
  if (new Set(v.datasets as readonly string[]).size !== (v.datasets as readonly string[]).length) return false;
  if (v.window !== null) {
    const window = v.window as { start?: unknown; end?: unknown };
    if (!isRecord(window) || !isTimestampMs(window.start) || !isTimestampMs(window.end)) return false;
    if (!((window.end as number) > (window.start as number))) return false;
  }
  if (!isSplitPolicyRef(v.evaluation_policy)) return false;
  if (!isTimestampMs(v.recorded_at)) return false;
  if (!isTenantId(v.tenant) || !isProjectId(v.project)) return false;
  // The holdout leaf laws (the owning lane's structural cross-fields).
  if (v.classification === 'holdout') {
    if ((v.parents as readonly unknown[]).length > 0) return false;
    if ((v.splits as readonly unknown[]).length !== 1) return false;
    if ((v.splits as readonly SplitPolicyRef[])[0] !== v.evaluation_policy) return false;
  }
  return true;
}

/**
 * The search record — STRUCTURAL MIRROR of @tradrl/search-lineage's
 * `SearchRecord` (T031): the binding block, the append-only entry log and
 * the chain head that binds all of it.
 */
export interface SearchRecordMirror {
  readonly search_id: SearchRecordId;
  readonly experiment: ExperimentId;
  readonly evaluator: EvaluatorVersionRef;
  readonly tenant: string;
  readonly project: string;
  readonly entries: readonly SearchTrialEntryMirror[];
  readonly chain_head: string;
}

/** Guard: `SearchRecordMirror`. */
export function isSearchRecordMirror(v: unknown): v is SearchRecordMirror {
  if (!isRecord(v)) return false;
  if (!isSearchRecordId(v.search_id)) return false;
  if (!isExperimentId(v.experiment) || !isEvaluatorVersionRef(v.evaluator)) return false;
  if (!isTenantId(v.tenant) || !isProjectId(v.project)) return false;
  if (!Array.isArray(v.entries)) return false;
  if (!(v.entries as readonly unknown[]).every((entry) => isSearchTrialEntryMirror(entry))) return false;
  return isNonEmptyString(v.chain_head);
}



/** The canonical binding JSON of a search record (the owning lane's exact digest input). */
export function searchBindingJsonMirror(record: Pick<SearchRecordMirror, 'experiment' | 'evaluator' | 'tenant' | 'project'>): JsonObject {
  return {
    experiment: record.experiment,
    evaluator: record.evaluator,
    tenant: record.tenant,
    project: record.project,
  };
}

/** The chain genesis: the dual-lane digest of the canonical binding block (the owning lane's exact law). */
export function searchChainGenesisMirror(record: Pick<SearchRecordMirror, 'experiment' | 'evaluator' | 'tenant' | 'project'>): string {
  return stableDigestJson(searchBindingJsonMirror(record));
}

/** One chain fold step: `stableDigest(previousHead + ':' + stableDigestJson(entry))` (the owning lane's exact law). */
export function searchChainFoldMirror(previousHead: string, entry: SearchTrialEntryMirror): string {
  return stableDigest(`${previousHead}:${stableDigestJson(entry as unknown as JsonValue)}`);
}

/**
 * Verify the search record's chain: the binding genesis plus one fold per
 * entry, in order. A tampered, truncated, reordered or hidden-trial record
 * fails (`chain_mismatch` at the caller) — the loop never adopts on a
 * tampered search history (T031's platform law, mirrored).
 */
export function verifySearchRecordMirror(record: SearchRecordMirror): boolean {
  let head = searchChainGenesisMirror(record);
  const entries = record.entries as readonly SearchTrialEntryMirror[];
  for (let index = 0; index < entries.length; index++) {
    head = searchChainFoldMirror(head, entries[index] as SearchTrialEntryMirror);
  }
  return head === record.chain_head;
}

/**
 * The search-trial APPEND bundle — mirror of @tradrl/search-lineage's
 * `SearchTrialInput` (T031): the trial's fields with the config as an
 * opaque JSON VALUE (the owning record mints the content-addressed
 * snapshot id on append — content and address cannot disagree by
 * construction). The loop emits one bundle per improvement product; the
 * caller appends through the REAL `appendSearchTrial` (the interop test
 * proves it green).
 */
export interface SearchTrialInputMirror {
  readonly trial: TrialId;
  readonly arm: ArmId | null;
  readonly classification: SearchClassification;
  readonly config: JsonObject;
  readonly parents: readonly TrialId[];
  readonly splits: readonly SplitPolicyRef[];
  readonly datasets: readonly DataRef[];
  readonly window: { readonly start: TimestampMs; readonly end: TimestampMs } | null;
  readonly evaluation_policy: SplitPolicyRef;
  readonly recorded_at: TimestampMs;
  readonly tenant: string;
  readonly project: string;
}

/** Guard: `SearchTrialInputMirror` (the value-side twin of the entry guard). */
export function isSearchTrialInputMirror(v: unknown): v is SearchTrialInputMirror {
  if (!isRecord(v)) return false;
  if (!isTrialId(v.trial)) return false;
  if (v.arm !== null && !isArmId(v.arm)) return false;
  if (!isSearchClassification(v.classification)) return false;
  if (!isRecord(v.config)) return false;
  if (!Array.isArray(v.parents)) return false;
  if (!(v.parents as readonly unknown[]).every((p) => isTrialId(p))) return false;
  if (!Array.isArray(v.splits) || (v.splits as readonly unknown[]).length === 0) return false;
  if (!(v.splits as readonly unknown[]).every((s) => isSplitPolicyRef(s))) return false;
  if (!Array.isArray(v.datasets)) return false;
  if (!(v.datasets as readonly unknown[]).every((d) => isDataRef(d))) return false;
  if (v.window !== null) {
    const window = v.window as { start?: unknown; end?: unknown };
    if (!isRecord(window) || !isTimestampMs(window.start) || !isTimestampMs(window.end)) return false;
    if (!((window.end as number) > (window.start as number))) return false;
  }
  if (!isSplitPolicyRef(v.evaluation_policy)) return false;
  if (!isTimestampMs(v.recorded_at)) return false;
  if (!isTenantId(v.tenant) || !isProjectId(v.project)) return false;
  return true;
}

/** A frozen mirror bundle helper (the deep-freeze discipline on every emitted product). */
export function freezeSearchTrialInputMirror(input: SearchTrialInputMirror): SearchTrialInputMirror {
  return deepFreeze(input);
}
