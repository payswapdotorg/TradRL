/**
 * @tradrl/research-benchmarks — the BENCHMARK SUITE (Work Order T032,
 * research/): the executable machinery that turns split definitions into
 * reproducible evaluation evidence.
 *
 * Public API:
 *   - `primitives.ts` — the shared contract discipline (Brand, guards,
 *     deep-freeze, canonical JSON, the program-wide dual-lane FNV-1a
 *     stable digest, the TimestampMs mirror).
 *   - `decimals.ts` — EXACT decimal-string numerics (scaled-bigint
 *     arithmetic; the scores that quantify performance never float; the
 *     single rendering to the declared score scale rounds once, half-even).
 *   - `ids.ts` — this lane's identity spaces (`BenchmarkId`,
 *     `BenchmarkManifestId`, `BenchmarkResultId`, `ResultLogId`) plus the
 *     opaque cross-lane reference mirrors (T032 evaluation-splits, T031
 *     search-lineage, T011 experiments, T012 evaluation, domain-core).
 *   - `axis.ts` — the dataset axis (T012/T031/T032 structural mirror).
 *   - `replay-mirror.ts` — the T009 replay data source mirror (stream
 *     refs + replay config digest + coverage; origin 'historical').
 *   - `generative-mirror.ts` — the T028 generative regime population
 *     mirror (declared seeded processes, regime vocabularies, disjoint
 *     unseen regimes) + the LEARNING-LOOP REGIME LADDER.
 *   - `search-mirror.ts` — the T031 search-record structural mirror + the
 *     mirrored CHAIN VERIFIER (a record built by the REAL
 *     @tradrl/search-lineage verifies here byte-for-byte).
 *   - `split-mirror.ts` — the T032 split-plan structural mirror + the
 *     mirrored content-address verifier (a plan materialized by the REAL
 *     @tradrl/evaluation-splits verifies here with the identical
 *     `splan:` id).
 *   - `evidence.ts` — the live-session source + the EVIDENCE CLASS LAW
 *     (simulation and live evidence are never conflated).
 *   - `stress.ts` — the EVALUATION-PROTOCOL stress variations (fees,
 *     slippage, latency, fill probability — exact decimals).
 *   - `observations.ts` — the per-segment execution-sensitive
 *     observations (the scoring input).
 *   - `definition.ts` — the benchmark DEFINITION (content-addressed,
 *     driver/phase/class/plan/source/evaluator/stress/scale/ladder/scope).
 *   - `driver.ts` — `runBenchmark` (the walk-forward evaluation drivers
 *     over replay data and generative regime populations) + untrusted
 *     result verification (`result_mismatch`).
 *   - `result-log.ts` — the append-only, chain-verified result LOG (L11).
 *   - `manifest.ts` — the benchmark MANIFEST (L9/L15 binding: split plan,
 *     data/regime source, evaluator, results with exact decimal scores).
 *
 * Typed error laws (each negative-tested):
 * - `holdout_in_search` — the Work Order's law: a search-phase run that
 *   scores a holdout window (a benchmark run inside a search loop).
 * - `search_material_in_holdout` / `no_holdout_material` — the phase
 *   coherence laws.
 * - `search_context_required` / `chain_mismatch` / `unknown_trial` /
 *   `classification_conflict` — the in-search vs holdout separation
 *   enforced THROUGH the search-record mirror (T031).
 * - `evidence_conflated` / `live_claim_on_simulation` — simulation and
 *   live evidence are never conflated (manifest + definition levels).
 * - `ladder_violation` — the LEARNING-LOOP regime ladder laws.
 * - `missing_observation` / `unknown_segment` / `scale_mismatch` — the
 *   scoring laws.
 * - `result_mismatch` / `duplicate_result` — the L9 content-address law
 *   and the L11 append-only law of the result log.
 * - `manifest_binding_mismatch` / `result_binding_mismatch` — the
 *   manifest's cross-binding laws.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md (layers, stress,
 * generalization, selection integrity, acceptance; "Simulation evidence
 * and live evidence are never conflated"), spec/LEARNING-LOOP.md (the
 * regime ladder), R21, ARCHITECTURE-LOCK L4/L7/L9/L10/L11/L12/L15.
 *
 * Package laws: zero runtime dependencies; no `any`; every exported shape
 * has a hand-rolled total type guard; all contract data is
 * JSON-serializable and byte-stable under canonical serialization;
 * cross-lane shapes from T009/T011/T012/T028/T031/T032 are consumed
 * through STRUCTURAL MIRRORS only (D-003/D-004) — the interop trip-wire
 * tests prove the mirrors against the real packages in this tree.
 */

export type { BenchmarkErrorCode, BenchmarkError, BenchmarkResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

export type { Brand, Mutable, JsonValue, JsonObject, TimestampMs } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeInteger,
  isPositiveInteger,
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

export type { DecimalString, RoundingMode } from './decimals';
export {
  ROUNDING_MODES,
  isUnsignedDecimal,
  isSignedDecimal,
  decimalScale,
  compareDecimals,
  decimalsEqual,
  addDecimals,
  subtractDecimals,
  mulDecimals,
  divByPowerOfTen,
  meanAtScale,
  isDecimalAtScale,
  normalizeDecimal,
  roundDecimalToScale,
} from './decimals';

export type {
  BenchmarkId,
  BenchmarkManifestId,
  BenchmarkResultId,
  ResultLogId,
  SplitPlanId,
  SplitPlanLedgerId,
  SearchRecordId,
  ConfigSnapshotId,
  ExperimentId,
  TrialId,
  ArmId,
  SplitPolicyRef,
  DataRef,
  EvaluatorVersionRef,
  TenantId,
  ProjectId,
} from './ids';
export {
  isBenchmarkId,
  isBenchmarkManifestId,
  isBenchmarkResultId,
  isResultLogId,
  isSplitPlanId,
  isSplitPlanLedgerId,
  isSearchRecordId,
  isConfigSnapshotId,
  isExperimentId,
  isTrialId,
  isArmId,
  isSplitPolicyRef,
  isDataRef,
  isEvaluatorVersionRef,
  isTenantId,
  isProjectId,
} from './ids';

export { isDatasetSegment, isDatasetAxis } from './axis';
export type { DatasetSegment, DatasetAxis } from './axis';

export {
  REPLAY_SOURCE_ID_PREFIX,
  isReplayDataSource,
  replaySourceJson,
  replaySourceId,
  replaySourceDigest,
  validateReplayDataSource,
} from './replay-mirror';
export type { ReplayDataSource, DataOrigin } from './replay-mirror';

export {
  GENERATIVE_SOURCE_ID_PREFIX,
  PROCESS_KINDS_MIRROR,
  isProcessKindMirror,
  isProcessDeclarationMirror,
  REGIME_LADDER,
  REGIME_LADDER_LEVELS,
  isRegimeLadderLevel,
  isRegimePopulationSource,
  generativeSourceJson,
  generativeSourceId,
  generativeSourceDigest,
  validateRegimePopulationSource,
} from './generative-mirror';
export type {
  ProcessKindMirror,
  ProcessDeclarationMirror,
  RegimeLadderLevel,
  RegimePopulationSource,
} from './generative-mirror';

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
  LIVE_SOURCE_ID_PREFIX,
  EVIDENCE_CLASSES,
  isEvidenceClass,
  isLiveSessionSource,
  liveSourceJson,
  liveSourceId,
  liveSourceDigest,
  validateLiveSessionSource,
  SOURCE_KINDS,
  isSourceKind,
  checkEvidenceClass,
} from './evidence';
export type { EvidenceClass, LiveSessionSource, SourceKind } from './evidence';

export {
  STRESS_AXES,
  STRESS_AXIS_LIST,
  isStressAxis,
  isStressVariation,
  validateStressVariations,
  applyStressVariations,
} from './stress';
export type { StressAxis, StressVariation, StressSensitivity } from './stress';

export { isSegmentObservation, planMaterialRefs, validateObservationSet } from './observations';
export type { SegmentObservation, ObservationSet } from './observations';

export {
  BENCHMARK_DRIVERS,
  isBenchmarkDriver,
  BENCHMARK_PHASES,
  isBenchmarkPhase,
  dataSourceOrigin,
  dataSourceKind,
  dataSourceDigest,
  definitionContentJson,
  benchmarkId,
  definitionDigest,
  validateBenchmarkDefinition,
} from './definition';
export type {
  BenchmarkDriver,
  BenchmarkPhase,
  BenchmarkDataSource,
  BenchmarkDefinition,
} from './definition';

export {
  resultContentJson,
  benchmarkResultId,
  canonicalBenchmarkResult,
  runBenchmark,
  verifyBenchmarkResult,
} from './driver';
export type {
  WindowScore,
  BenchmarkResultLineage,
  BenchmarkResultRecord,
  SearchContextBinding,
  BenchmarkRunInput,
} from './driver';

export {
  isBenchmarkResultLog,
  resultLogId,
  resultChainGenesis,
  resultChainFold,
  computeResultChainHead,
  createResultLog,
  appendBenchmarkResult,
  verifyResultLog,
  canonicalResultLog,
} from './result-log';
export type { ResultLogBinding, BenchmarkResultLog } from './result-log';

export {
  manifestContentJson,
  benchmarkManifestId,
  canonicalBenchmarkManifest,
  compileBenchmarkManifest,
  verifyBenchmarkManifest,
} from './manifest';
export type { ManifestResultBinding, BenchmarkManifestEntry, BenchmarkManifest } from './manifest';

/** Package identity and ownership (Work Order T032). */
export const packageInfo = {
  name: '@tradrl/research-benchmarks',
  owner: 'T032',
  status: 'implemented',
} as const;
