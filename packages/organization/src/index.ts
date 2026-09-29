/**
 * @tradrl/organization — the organization compiler contracts (T016).
 *
 * Public API:
 *   - Structural primitives — the shared contract vocabulary (branding,
 *     guards, deep-freeze discipline, JSON model, canonical JSON, stable
 *     digests, seeded draws) and the `TimestampMs` mirror of
 *     @tradrl/time-engine via the control plane.
 *   - Ids — the organization-lane identity spaces (`CandidateId`,
 *     `SearchRunId`, `SearchSeed`, `CompilerVersionRef`,
 *     `CapabilityGapId`, `AdversaryBlueprintRef`) plus the opaque
 *     cross-lane mirrors (`GoalRef`, `ConstraintSetRef`, `ProjectId`,
 *     `OrganizationRef`, `TenantId` — control-domain; `TrialId`, `ArmId`,
 *     `TrajectoryId`, `ExperimentId` — evaluation; `CapabilityKey`,
 *     `CapabilityRecordId`, `RegistryDigest` — agent-body registry;
 *     `BodyVersionRef`, `SubstrateRef`, `TopicName` — agent-os parity).
 *   - Control mirrors — `GoalStatementMirror` /
 *     `ConstraintSetStatementMirror` (the compile inputs) + the predicate
 *     evaluator mirror.
 *   - Capability mirrors — `CapabilityRecordMirror` /
 *     `RegistrySnapshotMirror` with this package's TYPED L16a validation,
 *     query-by-capability, measured-value extraction.
 *   - Gaps — `CapabilityGap` (typed failure classes: regime,
 *     sentiment/event, liquidity, execution, risk, coordination).
 *   - Discovery — the ten-step discovery-loop protocol as a closed step
 *     union with sequence-ordering laws (CAPABILITY-DISCOVERY.md).
 *   - Blueprint — `OrganizationBlueprint`: the SEVEN search-space axes
 *     (agent count, specializations, assignments, topology, training
 *     allocation, cadence, adversarial population) with axis-completeness,
 *     L16a and authority-embedding trip-wires.
 *   - Objective — the DECLARED, versioned objective model: seven measured
 *     components, weighted-sum-v1 aggregation (pure, no hidden weights),
 *     declared tie-break rule.
 *   - Budgets — `CompileBudgets` (resource budgets + search bounds).
 *   - Candidate/log — `OrganizationCandidate` with the full L9 lineage
 *     block; the APPEND-ONLY `SearchLog` (L11: rejected candidates are
 *     retained records with structured reasons; hiding/rewriting is a
 *     typed error; derived deterministic run id).
 *   - Compiler — `CompilerContract` + `compileOrganization` (the
 *     enforcement point: input validation, pure dispatch, full log
 *     validation).
 *   - Search integrity — the bridge onto the evaluation lane's input
 *     shape (`BridgeTrialEntry`/`BridgeTrialStatistic`/
 *     `BridgeSelectionClaim` + `toSearchIntegrityInput`).
 *
 * Zero runtime dependencies; types, guards and pure functions only. No
 * ambient clock anywhere (`Date.now()` never appears) and no ambient
 * randomness (seeded generators only) — the search is a pure function of
 * its explicit inputs, so the same (goal, constraints, budgets, registry
 * snapshot, seed, compiler version) always yields a byte-identical
 * candidate log. Cross-lane shapes are STRUCTURAL MIRRORS (D-003/D-004)
 * — never imports; src/interop.test.ts is the drift trip wire.
 */

// Errors and results
export type { OrgErrorCode, OrgError, OrgResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives
export type { Brand, Mutable, JsonValue, JsonObject } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isUnitInterval,
  isNonNegativeInteger,
  isPositiveInteger,
  isArrayOf,
  isIdentifierPath,
  deepFreeze,
  isDeeplyFrozen,
  isJsonValue,
  isJsonObject,
  canonicalJson,
  stableDigest,
  stableDigestJson,
  isDigest,
} from './primitives';

// Timestamp mirror (canonical owner: @tradrl/time-engine via control-domain)
export type { TimestampMs } from './primitives';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs } from './primitives';

// Ids and opaque cross-lane references
export type {
  GoalRef,
  ConstraintSetRef,
  ProjectId,
  OrganizationRef,
  TenantId,
  TrialId,
  ArmId,
  TrajectoryId,
  ExperimentId,
  CapabilityKey,
  CapabilityRecordId,
  RegistryDigest,
  CandidateId,
  SearchRunId,
  SearchSeed,
  CompilerVersionRef,
  CapabilityGapId,
  BodyVersionRef,
  SubstrateRef,
  TopicName,
  AttainmentEvidenceRef,
  RiskPolicyRef,
  AdversaryBlueprintRef,
} from './primitives';
export {
  isGoalRef,
  isConstraintSetRef,
  isProjectId,
  isOrganizationRef,
  isTenantId,
  isTrialId,
  isArmId,
  isTrajectoryId,
  isExperimentId,
  isCapabilityKey,
  isCapabilityRecordId,
  isRegistryDigest,
  isCandidateId,
  isSearchRunId,
  isSearchSeed,
  isCompilerVersionRef,
  isCapabilityGapId,
  isBodyVersionRef,
  isSubstrateRef,
  isTopicName,
  isAttainmentEvidenceRef,
  isRiskPolicyRef,
  isAdversaryBlueprintRef,
  goalRef,
  constraintSetRef,
  projectId,
  organizationRef,
  tenantId,
  capabilityKey,
  capabilityRecordId,
  candidateId,
  searchSeed,
  compilerVersionRef,
  capabilityGapId,
  bodyVersionRef,
  substrateRef,
  topicName,
  attainmentEvidenceRef,
  riskPolicyRef,
  adversaryBlueprintRef,
  createSeededRandom,
  seededDraw,
} from './primitives';

// Control-plane mirrors (compile inputs)
export type {
  CriterionValueMirror,
  CriterionPredicateMirror,
  SuccessCriterionMirror,
  GoalSuccessCriteriaMirror,
  GoalHorizonMirror,
  GoalEvaluationPolicyMirror,
  GoalStatementMirror,
  ConstraintDomainMirror,
  ConstraintSeverityMirror,
  ConstraintStatementMirror,
  ConstraintSetStatementMirror,
} from './control-mirror';
export {
  CRITERION_PREDICATE_KINDS_MIRROR,
  isCriterionValueMirror,
  isCriterionPredicateMirror,
  evaluateCriterionPredicateMirror,
  isSuccessCriterionMirror,
  isGoalSuccessCriteriaMirror,
  isGoalHorizonMirror,
  isGoalEvaluationPolicyMirror,
  isGoalStatementMirror,
  CONSTRAINT_DOMAINS_MIRROR,
  isConstraintDomainMirror,
  CONSTRAINT_SEVERITIES_MIRROR,
  isConstraintSeverityMirror,
  isConstraintStatementMirror,
  isConstraintSetStatementMirror,
} from './control-mirror';

// Capability registry mirrors (the evidence base)
export type {
  CapabilityEvidenceKindMirror,
  MeasurementMetricMirror,
  BenchmarkEvidenceMirror,
  MeasurementRecordEvidenceMirror,
  ResultRefEvidenceMirror,
  MeasuredEvidenceMirror,
  CapabilityDescriptorMirror,
  RegistrySubjectKindMirror,
  RegistrySubjectMirror,
  CapabilityRecordMirror,
  RegistrySnapshotMirror,
  CapabilityQueryMirror,
} from './capability-mirror';
export {
  CAPABILITY_EVIDENCE_KINDS_MIRROR,
  isCapabilityEvidenceKindMirror,
  MEASUREMENT_METRICS_MIRROR,
  isMeasurementMetricMirror,
  LABEL_EVIDENCE_KEYS_MIRROR,
  labelKeyPathsMirror,
  isMeasuredEvidenceMirror,
  isCapabilityDescriptorMirror,
  REGISTRY_SUBJECT_KINDS_MIRROR,
  isRegistrySubjectKindMirror,
  isCanonicalBodyVersionRefMirror,
  isCanonicalSubstrateRefMirror,
  isRegistrySubjectMirror,
  isCapabilityRecordMirror,
  isRegistrySnapshotMirror,
  registrySnapshotDigestMirror,
  validateRegistrySnapshotMirror,
  isCapabilityQueryMirror,
  queryByCapabilityMirror,
  measuredValueOf,
} from './capability-mirror';

// Capability gaps (failure-driven learning)
export type { CapabilityGapKind, CapabilityGap } from './gap';
export { CAPABILITY_GAP_KINDS, isCapabilityGapKind, isCapabilityGap, createCapabilityGap } from './gap';

// Discovery-loop protocol
export type {
  DiscoveryStepKind,
  DiscoveryRejectionCode,
  DiscoveryStep,
} from './discovery';
export {
  DISCOVERY_STEP_KINDS,
  isDiscoveryStepKind,
  DISCOVERY_REJECTION_CODES,
  isDiscoveryRejectionCode,
  isDiscoveryStep,
  isDiscoveryStepArray,
  createDiscoveryStep,
  validateDiscoverySequence,
} from './discovery';

// The seven-axis blueprint
export type {
  OrganizationAxis,
  AuthorityEmbeddingKey,
  SpecializationRequest,
  AgentAssignment,
  TopicWire,
  CommunicationTopology,
  TrainingMethod,
  TrainingAllocationEntry,
  TrainingAllocation,
  DecisionCadenceEntry,
  DecisionCadence,
  AdversarialPopulation,
  OrganizationBlueprint,
} from './blueprint';
export {
  ORGANIZATION_AXES,
  isOrganizationAxis,
  AUTHORITY_EMBEDDING_KEYS,
  isAuthorityEmbeddingKey,
  authorityKeyPaths,
  isSpecializationRequest,
  isAgentAssignment,
  isOrganizationTopic,
  isTopicWire,
  isCommunicationTopology,
  countTopologyWires,
  TRAINING_METHODS,
  isTrainingMethod,
  isTrainingAllocationEntry,
  isTrainingAllocation,
  isDecisionCadenceEntry,
  isDecisionCadence,
  isAdversarialPopulation,
  isOrganizationBlueprint,
  validateOrganizationBlueprint,
  createOrganizationBlueprint,
} from './blueprint';

// The declared objective model
export type {
  ObjectiveComponent,
  ObjectiveMeasurements,
  AggregationStrategyVersion,
  TieBreakRule,
  ObjectiveWeights,
  NormalizationCaps,
  AggregationStrategy,
  ObjectiveComponents,
  ObjectiveAggregate,
} from './objective';
export {
  OBJECTIVE_COMPONENTS,
  isObjectiveComponent,
  isObjectiveMeasurements,
  AGGREGATION_STRATEGY_VERSIONS,
  isAggregationStrategyVersion,
  TIE_BREAK_RULES,
  isTieBreakRule,
  isObjectiveWeights,
  isNormalizationCaps,
  isAggregationStrategy,
  isObjectiveComponents,
  isObjectiveAggregate,
  aggregateOrganizationObjective,
  compareByTieBreakRule,
} from './objective';

// Resource budgets
export type { CompileBudgets } from './budgets';
export { isCompileBudgets, validateCompileBudgets } from './budgets';

// Candidates, lineage, the append-only search log
export type {
  CandidateDisposition,
  CandidateRejectionCode,
  RejectionBudgetAxis,
  CandidateRejectionReason,
  CandidateLineage,
  OrganizationCandidate,
  SearchLog,
} from './candidate';
export {
  CANDIDATE_DISPOSITIONS,
  isCandidateDisposition,
  CANDIDATE_REJECTION_CODES,
  isCandidateRejectionCode,
  REJECTION_BUDGET_AXES,
  isRejectionBudgetAxis,
  isCandidateRejectionReason,
  isCandidateLineage,
  isOrganizationCandidate,
  searchRunIdOf,
  isSearchLog,
  validateSearchLog,
  createOrganizationCandidate,
  appendOrganizationCandidate,
} from './candidate';

// The compiler contract + the deterministic search entry point
export type { CompileInput, CompilerContract } from './compiler';
export { validateCompileInput, isCompilerContract, compileOrganization } from './compiler';

// The search-integrity bridge (evaluation-lane input shape)
export type {
  BridgeTrialStatus,
  BridgeTrialEntry,
  BridgeTrialStatistic,
  BridgeSelectionClaim,
  BridgeExperiment,
  SearchIntegrityInput,
} from './search-integrity';
export {
  BRIDGE_TRIAL_STATUSES,
  isBridgeTrialStatus,
  isBridgeTrialEntry,
  isBridgeTrialStatistic,
  isBridgeSelectionClaim,
  isBridgeExperiment,
  isSearchIntegrityInput,
  BRIDGE_ARM,
  toSearchIntegrityInput,
} from './search-integrity';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/organization',
  owner: 'T016',
  status: 'implemented',
  concepts: [
    'OrganizationBlueprint',
    'OrganizationCandidate',
    'SearchLog',
    'CompilerContract',
    'compileOrganization',
    'AggregationStrategy',
    'CapabilityGap',
    'DiscoveryStep',
    'toSearchIntegrityInput',
  ],
} as const;
