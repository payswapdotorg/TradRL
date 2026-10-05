/**
 * @tradrl/autonomous-learning — the AUTONOMOUS-LEARNING service (Work
 * Order T035): the continuous self-improvement loop that closes the
 * Learning from reality section — it consumes T033's evaluation hooks
 * (the typed per-outcome learning signals) and T034's served firm
 * knowledge, and turns realized outcomes into the three improvement
 * products: improved curricula (T015-shaped capability gaps + the revised
 * plan input), refined skills (T017-shaped forge commissions,
 * adoption-gated), and updated firm memory (T034-shaped ingestion feeds)
 * — with T031's integrity guarantees.
 *
 * Public API:
 *   - `createAutonomousLearningState` / `runImprovementCycle` — the loop:
 *     ONE scope per cycle (L12), ONE injected instant (no ambient clock),
 *     fail-closed gates (the mirrors, the scope coherence, the L4
 *     instants, the idempotence ledger, the three chain-verified
 *     histories — the improvement log, the curriculum trail, the search
 *     record), the T031 adoption gate (`hidden_trials` fail-closed;
 *     `selected_without_holdout` withholds in-search-only commissions as
 *     retained refusal data), and the deterministic agenda (the DECLARED
 *     decision table): failure hooks -> typed capability gaps -> the
 *     revised plan input annotated with the brain's active knowledge; the
 *     commissioning focuses -> the body-forge bundle (gaps + evidence +
 *     seed); every cycle with records -> the Firm-Brain feed. Every
 *     revision and every RELEASED commission mints its in-search trial
 *     bundle for the retained search record (L11).
 *   - `evaluateAdoptionGate` / `mintImprovementSearchTrial` — the T031
 *     integrity surface, exported for the loop's consumers and tests.
 *   - `validateImprovementPolicy` / `DEFAULT_IMPROVEMENT_POLICY` — the
 *     versioned decision table (the declared focus->action mapping).
 *   - `autonomousLearningStateDigest` / `verifyImprovementLog` — the
 *     determinism comparator + the chain gate.
 *
 * Package laws (mirroring the merged lanes):
 * - Zero runtime dependencies; NO workspace source imports at all (this
 *   lane owns no contract package — the services/api precedent): every
 *   consumed lane's shapes (T033's hooks/records, T034's served
 *   knowledge, T015/T016's gaps + trail, T012/T031's evidence + search
 *   record) are STRUCTURAL MIRRORS inside src/mirrors.ts (D-003/D-004).
 *   interop.test.ts drives the REAL pipelines (T030's golden session ->
 *   T033's hooks; T034's ingestion; T015's planner; T031's record; T017's
 *   forge) through the mirrors — test-only imports, the drift trip wires.
 * - No ambient clock (`Date.now()` never appears) and no ambient
 *   randomness; every instant is an injected parameter; every id is
 *   content-addressed.
 * - L12 tenant scoping on every record and every gate; L4 at every
 *   evidence boundary; append-only + chain-verified wherever history is
 *   retained (the improvement log; rewriting or HIDING a cycle is the
 *   typed `chain_mismatch`); the consumed-hooks ledger makes every
 *   product idempotent (a hook contributes EXACTLY ONCE).
 * - SAFETY: the loop never supplies the stage-9 live-permission record;
 *   the loop never writes the curriculum trail; the loop never runs the
 *   body forge — it proposes, the owning lanes decide.
 */

// The typed error family + the primitives (the lane's single discipline)
export type { ImprovementErrorCode, ImprovementError, ImprovementResult, TimestampMs, JsonValue, JsonObject } from './primitives';
export { fail, failures, ok, missingField, invalidField, invalidType } from './primitives';
export { canonicalJson, fnv1a32Hex, stableDigest, stableDigestJson, deepFreeze, isRecord, isNonEmptyString, isTimestampMs, isDigest8 } from './primitives';

// The identity spaces (owned + the cross-lane opaque mirrors)
export type {
  ImprovementCycleId,
  ImprovementGapId,
  CurriculumRevisionId,
  SkillCommissionId,
  MemoryFeedId,
  ImprovementTrialId,
  TenantId,
  ProjectId,
  GoalRef,
  ConstraintSetRef,
  OrganizationId,
  Seed,
  CapabilityGapId,
  CapabilityKey,
  VerdictId,
  TrialId,
  ArmId,
  TrajectoryRef,
  ExperimentRef,
  SplitPolicyRef,
  EvaluatorVersionRef,
  DataRef,
  SearchRecordId,
  ConfigSnapshotId,
  KnowledgeId,
  HookRef,
  OutcomeRecordRef,
  PostMortemRef,
  SessionRef,
} from './ids';
export {
  isImprovementCycleId,
  isImprovementGapId,
  isCurriculumRevisionId,
  isSkillCommissionId,
  isMemoryFeedId,
  isImprovementTrialId,
  isIdentifierString,
} from './ids';

// The structural mirrors (the consumed lanes' shapes — D-003/D-004)
export type {
  LearningFocus,
  OutcomeClass,
  AttributionClass,
  DominantAttributionMirror,
  OutcomeLearningHookMirror,
  OutcomeEnvelopeMirror,
  PostMortemEnvelopeMirror,
  KnowledgeKind,
  ServedKnowledgeEnvelopeMirror,
  CapabilityGapKind,
  CapabilityGapMirror,
  CurriculumStageKind,
  EvidenceCitationMirror,
  TransitionLineageMirror,
  StageTransitionMirror,
  CurriculumTrailMirror,
  EvaluatedEvidenceMirror,
  SearchClassification,
  SearchTrialEntryMirror,
  SearchRecordMirror,
  SearchTrialInputMirror,
} from './mirrors';
export {
  LEARNING_FOCUS,
  OUTCOME_CLASSES,
  ATTRIBUTION_CLASSES,
  KNOWLEDGE_KINDS,
  CAPABILITY_GAP_KINDS,
  CURRICULUM_STAGES,
  SEARCH_CLASSIFICATIONS,
  isLearningFocus,
  isOutcomeClass,
  isAttributionClass,
  isDominantAttributionMirror,
  isOutcomeLearningHookMirror,
  isOutcomeEnvelopeMirror,
  isPostMortemEnvelopeMirror,
  isKnowledgeKind,
  isServedKnowledgeEnvelopeMirror,
  isCapabilityGapKind,
  isCapabilityGapMirror,
  isCurriculumStageKind,
  stagePosition,
  isEvidenceCitationMirror,
  isTransitionLineageMirror,
  isStageTransitionMirror,
  isCurriculumTrailMirror,
  trailChainSeedMirror,
  trailChainStepMirror,
  trailRecordDigestMirror,
  verifyCurriculumTrailMirror,
  trailPositionMirror,
  isEvaluatedEvidenceMirror,
  isSearchClassification,
  isSearchTrialEntryMirror,
  isSearchRecordMirror,
  searchChainGenesisMirror,
  searchChainFoldMirror,
  verifySearchRecordMirror,
  isSearchTrialInputMirror,
} from './mirrors';

// The improvement policy (the DECLARED decision table)
export type { FocusAction, ImprovementPolicy } from './policy';
export { validateImprovementPolicy, improvementPolicyDigest, DEFAULT_IMPROVEMENT_POLICY, VALIDATED_DEFAULT_POLICY } from './policy';

// The state machine (the improvement log + the consumed-hooks ledger)
export type { CommissionRefusalReason, CommissionStatus, ImprovementCycleRecord, ImprovementLog, ConsumedHookEntry, AutonomousLearningState } from './state';
export {
  isCommissionRefusalReason,
  isCommissionStatus,
  isImprovementCycleRecord,
  IMPROVEMENT_CHAIN_SEED,
  improvementChainStep,
  improvementLogHead,
  verifyImprovementLog,
  isConsumedHookEntry,
  createAutonomousLearningState,
  isAutonomousLearningState,
  appendImprovementCycle,
  autonomousLearningStateDigest,
  cycleRecordContentDigest,
} from './state';

// The T031 integrity surface (the adoption gate + the search-trial mint)
export type { GroundingEvidence, AdoptionVerdict, ImprovementProductKind, SearchPolicyBlock, TrialMintInput } from './integrity';
export {
  isGroundingEvidence,
  isAdoptionVerdict,
  isImprovementProductKind,
  isSearchPolicyBlock,
  evaluateAdoptionGate,
  mintImprovementSearchTrial,
} from './integrity';

// The cycle (the loop itself)
export type {
  PlanningContext,
  ImprovementCycleInputs,
  CurriculumPlanInputMirror,
  GapAnnotation,
  CurriculumRevision,
  CommissionEvidence,
  SkillCommission,
  MemoryFeed,
  ImprovementProducts,
  ImprovementCycleResult,
} from './cycle';
export {
  isPlanningContext,
  isCurriculumPlanInputMirror,
  isCommissionEvidence,
  capabilityKeyOf,
  runImprovementCycle,
} from './cycle';

// The golden determinism constants (the pinned literals the determinism tests compare against)
export {
  GOLDEN_CYCLE_ID,
  GOLDEN_STATE_DIGEST,
  GOLDEN_GAP_IDS,
  GOLDEN_REVISION_ID,
  GOLDEN_COMMISSION_ID,
  GOLDEN_MEMORY_FEED_ID,
  GOLDEN_REVISION_TRIAL,
  GOLDEN_COMMISSION_TRIAL,
  GOLDEN_CONSUMED_HOOKS,
  GOLDEN_EXECUTION_ANNOTATION,
} from './golden';

// The deterministic scenario fixtures (test-support only — the firm-memory/outcome-learning precedent)
export {
  AUTO_T0,
  AUTO_T1,
  AUTO_T2,
  AUTO_TENANT,
  AUTO_PROJECT,
  AUTO_TENANT_B,
  AUTO_PROJECT_B,
  AUTO_GOAL,
  AUTO_CONSTRAINTS,
  AUTO_CANDIDATE,
  AUTO_SEED,
  AUTO_CURRICULUM_VERSION,
  AUTO_SESSION,
  AUTO_EXPERIMENT,
  AUTO_EVALUATOR,
  AUTO_SPLIT,
  AUTO_DATASET,
  AUTO_KNOWLEDGE_HEAD,
  AUTO_TRAJECTORY,
  AUTO_IN_SEARCH_TRIAL,
  AUTO_HOLDOUT_TRIAL,
  scenarioHooks,
  scenarioOutcomes,
  scenarioPostMortems,
  scenarioKnowledge,
  scenarioTrail,
  scenarioSearchRecord,
  scenarioEvaluations,
  scenarioPlanning,
  scenarioSearchPolicy,
  scenarioCycleInputs,
  scenarioPolicy,
  scenarioExpectedGapKinds,
} from './fixtures';
export type { OutcomeRecordFixture, PostMortemRecordFixture } from './fixtures';
