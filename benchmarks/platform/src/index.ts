/**
 * @tradrl/benchmarks-platform — the PLATFORM BENCHMARK MACHINERY (Work
 * Order T049, benchmarks/): the benchmark/measurement runners — the
 * platform machinery that T045's verification seam explicitly does not
 * own ("the verdict is the pure fold over the outcomes the platform's
 * verification machinery supplies" — THIS lane supplies them).
 *
 * THE LANE'S CHARTER (the Work Order): "reproducible benchmark suites
 * over the merged evaluation surfaces, with the T048 reference slice as
 * the natural live input (its SliceReport/lineage records), the T032
 * walk-forward suite's split discipline, the T028 counterfactual
 * populations, and the T035 improvement loop's evidence gates."
 *
 * Public API (one module per law):
 *   - `primitives.ts` — the shared contract discipline (Brand, guards,
 *     deep-freeze, canonical JSON, the program-wide dual-lane FNV-1a
 *     stable digest, the TimestampMs mirror).
 *   - `decimals.ts` — the exact-decimal comparison subset (attainment
 *     bounds never float).
 *   - `errors.ts` — the typed error taxonomy (every law below has its
 *     code, each negative-tested).
 *   - `ids.ts` — this lane's identity spaces (`cbms:` suites, `cbmm:`
 *     measurements, `cbml:` logs) + the opaque cross-lane refs.
 *   - `axis.ts` — the dataset axis (T012/T031/T032 structural mirror).
 *   - `slice-mirror.ts` — the T048 SliceReport/lineage mirror + the
 *     pipeline-coherence invariants.
 *   - `search-mirror.ts` — the T031 search-record mirror + the mirrored
 *     chain verifier (a REAL record verifies here byte-for-byte).
 *   - `split-mirror.ts` — the T032 split-plan mirror + the mirrored
 *     content-address verifier (a REAL plan verifies with the identical
 *     `splan:` id).
 *   - `material.ts` — the material sources (T009 replay, T028 generative
 *     populations, live sessions) + the evidence-class law.
 *   - `provider-mirror.ts` — the T045 verification-contract mirror (the
 *     benchmark requirement + the outcome shape this lane supplies).
 *   - `metrics.ts` — the closed measurable vocabulary + the structured
 *     metric vocabulary (L16a) + the pure extraction.
 *   - `suite.ts` — the capability-suite definition (content-addressed,
 *     axis laws, the L9 subject binding).
 *   - `measurement.ts` — `runSuiteMeasurement` (the runner) + the
 *     content-addressed measurement record + its verifier.
 *   - `log.ts` — the append-only, chain-verified measurement log (L11).
 *   - `adoption.ts` — the T035 adoption gate over measured evidence.
 *   - `discharge.ts` — the T045 discharge seam (benchmark requirements ->
 *     verification outcomes).
 *   - `fixtures.ts` — deterministic trusted-literal builders.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md (the layers, the stress/
 * generalization/selection-integrity laws, "Simulation evidence and live
 * evidence are never conflated"), spec/CAPABILITY-DISCOVERY.md (step 6 —
 * benchmark candidates; the reproducibility section), ARCHITECTURE-LOCK
 * L4/L5/L7/L9/L10/L11/L12/L15/L16/L16a/L20.
 *
 * Package laws: zero runtime dependencies; no `any`; every exported
 * shape has a hand-rolled total type guard; all contract data is
 * JSON-serializable and byte-stable under canonical serialization; no
 * ambient clock and no ambient randomness; cross-lane shapes (T009/T011/
 * T012/T028/T031/T032/T035/T045/T048) are consumed through STRUCTURAL
 * MIRRORS only (D-003/D-004) — the interop trip-wire tests prove every
 * mirror against the real packages in this tree. This lane ships NO
 * package.json (the examples/ precedent: zero workspace edges — the
 * workspace glob stays inert).
 */

export type { PlatformErrorCode, PlatformError, PlatformResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

export type { Brand, Mutable, JsonValue, JsonObject, TimestampMs } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeInteger,
  isPositiveInteger,
  isMemberOf,
  deepFreeze,
  isDeeplyFrozen,
  isJsonValue,
  isJsonObject,
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
  isTimestampMs,
  timestampMs,
  requireTimestampMs,
  canonicalJson,
  stableDigest,
  stableDigestJson,
  isDigest,
} from './primitives';

export type { DecimalString } from './decimals';
export {
  isUnsignedDecimal,
  isSignedDecimal,
  decimalScale,
  compareDecimals,
  decimalsEqual,
  normalizeDecimal,
  isDecimalAtScale,
} from './decimals';

export type {
  SuiteId,
  MeasurementId,
  MeasurementLogId,
  SplitPlanId,
  SearchRecordId,
  ConfigSnapshotId,
  ExperimentId,
  TrialId,
  ArmId,
  SplitPolicyRef,
  DataRef,
  EvaluatorVersionRef,
  BenchmarkResultRef,
  TenantId,
  ProjectId,
} from './ids';
export {
  isSuiteId,
  isMeasurementId,
  isMeasurementLogId,
  isSplitPlanId,
  isSearchRecordId,
  isConfigSnapshotId,
  isExperimentId,
  isTrialId,
  isArmId,
  isSplitPolicyRef,
  isDataRef,
  isEvaluatorVersionRef,
  isBenchmarkResultRef,
  isTenantId,
  isProjectId,
} from './ids';

export { isDatasetSegment, isDatasetAxis } from './axis';
export type { DatasetSegment, DatasetAxis } from './axis';

export {
  isRealizedOutcomeSummaryMirror,
  isSliceReportShape,
  isSliceLineageMirror,
  isSliceReportMirror,
  slicePipelineViolations,
} from './slice-mirror';
export type {
  SliceBookMirror,
  RealizedOutcomeSummaryMirror,
  PaperOutcomeIntentMirror,
  LiveAuditIntentMirror,
  OrderDecisionMirror,
  SliceLineageMirror,
  SliceReportMirror,
} from './slice-mirror';

export {
  SEARCH_CLASSIFICATIONS_MIRROR,
  isSearchClassificationMirror,
  isSearchWindowMirror,
  isSearchTrialEntryMirror,
  validateSearchTrialEntryMirror,
  searchRecordIdMirror,
  chainGenesisMirror,
  chainFoldMirror,
  computeChainHeadMirror,
  configSnapshotIdMirror,
  verifySearchRecordLineage,
  canonicalSearchRecordMirror,
} from './search-mirror';
export type {
  SearchClassificationMirror,
  SearchWindowMirror,
  SearchTrialEntryMirror,
  ConfigSnapshotMirror,
  SearchBindingMirror,
  SearchRecordMirror,
} from './search-mirror';

export {
  WINDOW_SCHEMES_MIRROR,
  isWindowSchemeMirror,
  isRegimeFilterMirror,
  isHoldoutReservationMirror,
  isSplitDriverPolicyMirror,
  isSplitWindowPlanMirror,
  isHoldoutReservationPlanMirror,
  isSplitPlanLineageMirror,
  isSplitPlanMirror,
  planContentJsonMirror,
  splitPlanIdMirror,
  splitPlanDigest,
  verifySplitPlanMirror,
} from './split-mirror';
export type {
  WindowSchemeMirror,
  RegimeFilterMirror,
  HoldoutReservationMirror,
  SplitDriverPolicyMirror,
  SplitWindowPlanMirror,
  HoldoutReservationPlanMirror,
  SplitPlanLineageMirror,
  SplitPlanMirror,
} from './split-mirror';

export {
  EVIDENCE_CLASSES,
  isEvidenceClass,
  REPLAY_SOURCE_ID_PREFIX,
  isReplayDataSource,
  replaySourceJson,
  replaySourceId,
  replaySourceDigest,
  GENERATIVE_SOURCE_ID_PREFIX,
  PROCESS_KINDS_MIRROR,
  isProcessKindMirror,
  isProcessDeclarationMirror,
  isRegimePopulationSource,
  generativeSourceJson,
  generativeSourceId,
  generativeSourceDigest,
  LIVE_SOURCE_ID_PREFIX,
  isLiveSessionSource,
  liveSourceJson,
  liveSourceId,
  liveSourceDigest,
  SOURCE_KINDS,
  isSourceKind,
  isMaterialSource,
  materialOrigin,
  materialKind,
  materialDigest,
  checkEvidenceClass,
} from './material';
export type {
  EvidenceClass,
  ReplayDataSource,
  ProcessKindMirror,
  ProcessDeclarationMirror,
  RegimePopulationSource,
  LiveSessionSource,
  SourceKind,
  SourceOrigin,
  MaterialSource,
} from './material';

export {
  MEASUREMENT_METRICS_MIRROR,
  AXIS_KINDS,
  isAxisKind,
  SLICE_MEASURABLES,
  SLICE_MEASURABLE_PATHS,
  isSliceMeasurable,
  sliceMeasurableOf,
  extractSliceMeasurable,
} from './metrics';
export type { AxisKind, AxisValue, Measurable } from './metrics';

export {
  SUBJECT_KINDS,
  isSubjectKind,
  SUBJECT_REF_KINDS,
  isSubjectRefKind,
  isSubjectBinding,
  validateSubjectBinding,
  isAxisAttainment,
  suiteContentJson,
  suiteId,
  suiteDigest,
  validateSuiteDefinition,
} from './suite';
export type { SubjectKind, SubjectRefKind, SubjectBinding, AxisAttainment, SuiteAxis, SuiteDefinition } from './suite';

export {
  MEASUREMENT_PHASES,
  isMeasurementPhase,
  measurementContentJson,
  measurementId,
  canonicalMeasurement,
  runSuiteMeasurement,
  verifyMeasurementRecord,
} from './measurement';
export type {
  MeasurementPhase,
  AxisMeasurement,
  MeasurementMaterial,
  MeasurementSearchBinding,
  MeasurementRecord,
  SearchContext,
  MeasurementRunInput,
} from './measurement';

export {
  measurementLogId,
  measurementChainGenesis,
  measurementChainFold,
  computeMeasurementChainHead,
  isMeasurementLog,
  createMeasurementLog,
  appendMeasurement,
  verifyMeasurementLog,
} from './log';
export type { MeasurementLogBinding, MeasurementLog } from './log';

export {
  COMMISSION_REFUSAL_REASONS,
  isCommissionRefusalReason,
  isAdoptionPolicy,
  evaluateAdoptionGate,
} from './adoption';
export type { CommissionRefusalReason, AdoptionPolicy, GroundingMeasurement, AdoptionVerdict } from './adoption';

export {
  isMeasurementMetricMirror,
  isBenchmarkRequirementMirror,
  isVerificationRequirementMirror,
  isVerificationContractMirror,
  isVerificationOutcomeMirror,
} from './provider-mirror';
export type {
  BenchmarkRequirementMirror,
  VerificationRequirementMirror,
  VerificationOutcomeMirror,
} from './provider-mirror';

export { dischargeBenchmarkRequirements } from './discharge';
export type { DischargeInput } from './discharge';

export {
  T0,
  DAY,
  TENANT,
  PROJECT,
  dataRef,
  at,
  fixtureSliceReport,
  fixtureSubject,
  subjectForEvidence,
  fixturePlatformSuite,
  fixturePlatformSuiteRecord,
  fixtureCandidateSuite,
  fixtureReplaySource,
  fixtureGenerativeSource,
  fixtureLiveSource,
  fixtureSegmentsWithGap,
  fixtureSplitPlan,
  fixtureHoldoutReplaySource,
  fixtureSearchRecord,
  fixtureRunInput,
  fixtureHoldoutRunInput,
} from './fixtures';

/** Package identity and ownership (Work Order T049 — the benchmark machinery lane). */
export const packageInfo = {
  name: '@tradrl/benchmarks-platform',
  owner: 'T049',
  status: 'implemented',
} as const;
