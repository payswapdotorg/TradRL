/**
 * @tradrl/evaluation-integrity — the integrity SERVICE tree (Work Order
 * T031, research/ — the platform layer above T012's in-package
 * search-integrity reporting and above T031's own record package
 * @tradrl/search-lineage).
 *
 * Public API:
 *   - `primitives.ts` — the shared contract discipline (Brand, guards,
 *     deep-freeze, canonical JSON, the dual-lane FNV-1a stable digest
 *     mirrored from evaluation/search-lineage, the TimestampMs mirror,
 *     half-open interval geometry).
 *   - `ids.ts` — this lane's own identity spaces (SplitRegistryId,
 *     SplitDefinitionId, QuarantineId, SelectionAuditId) plus the opaque
 *     cross-lane reference mirrors (search-lineage, T011 experiments,
 *     domain-core).
 *   - `decimals.ts` — EXACT decimal-string numerics (scaled-bigint
 *     arithmetic; the numbers that quantify overfitting never float).
 *   - `axis.ts` — the dataset axis (T012 structural mirror).
 *   - `splits.ts` — the SPLIT/HOLDOUT REGISTRY: anchored walk-forward,
 *     PURGED/EMBARGOED construction (`window_exhaustion`,
 *     `embargo_overlap`, `degenerate_mask`), the append-only
 *     content-addressed registry, and the EMBARGO AUTHORITY
 *     (`unknown_split_policy`).
 *   - `quarantine.ts` — the UNSEEN-DATA QUARANTINE: predeclaration
 *     (`quarantine_registered_late`) and empirical cleanliness
 *     (`quarantine_violation`) over every in-search trial.
 *   - `search-mirror.ts` — the search-lineage STRUCTURAL MIRROR plus the
 *     mirrored CHAIN VERIFIER (a record built by the real
 *     @tradrl/search-lineage verifies here byte-for-byte; tamper =
 *     `chain_mismatch`).
 *   - `leakage.ts` — LEAKAGE DETECTION across the lineage:
 *     `leakage_without_embargo`, `synthetic_holdout`,
 *     `classification_mismatch`, `unknown_trial`.
 *   - `selection.ts` — the SELECTION-EFFECT AUDIT over the search DAG:
 *     quantified best-of-N inflation and holdout degradation in exact
 *     decimals, with the platform hidden-trials law
 *     (`hidden_trials`), `selected_without_holdout`, `scale_mismatch`,
 *     and the T012 report cross-check (`selection_mismatch`).
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md lines 21-24 (unseen material,
 * in-search vs holdout distinction, walk-forward and purged/embargoed
 * designs); spec/ARCHITECTURE.md "Evaluation" ("Preserve search history");
 * ARCHITECTURE-LOCK L11 (search integrity), L4 (point-in-time truth),
 * L9 (reproducible lineage), L12 (tenant isolation); R20
 * (Backtest-overfitting/search-integrity controls), R21
 * (walk-forward/unseen evaluation); PROJECT-STATE invariant 7.
 *
 * Package laws: zero runtime dependencies; no `any`; every exported shape
 * has a hand-rolled total type guard; all contract data is
 * JSON-serializable and byte-stable under canonical serialization;
 * cross-lane shapes from T011/T012/T028/search-lineage are consumed through
 * STRUCTURAL MIRRORS only (D-003/D-004) — the interop trip-wire tests
 * prove the mirrors against the real packages in this tree.
 */

export type { IntegrityErrorCode, IntegrityError, IntegrityResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

export type { Brand, Mutable, JsonValue, JsonObject, TimestampMs, TimeWindow } from './primitives';
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
  isTimeWindow,
  windowsOverlap,
  windowGap,
} from './primitives';

export type {
  SplitRegistryId,
  SplitDefinitionId,
  QuarantineId,
  SelectionAuditId,
  SearchRecordId,
  ConfigSnapshotId,
  ExperimentId,
  TrialId,
  SplitPolicyRef,
  DataRef,
  TenantId,
  ProjectId,
} from './ids';
export {
  isSplitRegistryId,
  isSplitDefinitionId,
  isQuarantineId,
  isSelectionAuditId,
  isSearchRecordId,
  isConfigSnapshotId,
  isExperimentId,
  isTrialId,
  isSplitPolicyRef,
  isDataRef,
  isTenantId,
  isProjectId,
} from './ids';

export {
  ROUNDING_MODES,
  isUnsignedDecimal,
  isSignedDecimal,
  decimalScale,
  compareDecimals,
  decimalsEqual,
  maxDecimal,
  addDecimals,
  subtractDecimals,
  meanDecimals,
  isDecimalAtScale,
  normalizeDecimal,
} from './decimals';
export type { DecimalString, RoundingMode } from './decimals';

export { isDatasetSegment, isDatasetAxis, validateDatasetAxis } from './axis';
export type { DatasetSegment, DatasetAxis } from './axis';

export {
  SPLIT_KINDS,
  isSplitKind,
  isSplitDefinition,
  splitDefinitionId,
  validateSplitDefinition,
  constructWalkForward,
  constructBlindHoldout,
  constructSplits,
  isSplitRegistry,
  splitRegistryId,
  createSplitRegistry,
  registerSplit,
  embargoOfPolicy,
  policySegmentRefs,
} from './splits';
export type { SplitKind, SplitDefinition, SplitWindow, BlindHoldoutSplit, RegisteredSplit, SplitRegistry } from './splits';

export { QUARANTINE_ID_PREFIX, isQuarantineRecord, quarantineRecordId, registerQuarantine, checkQuarantine } from './quarantine';
export type { QuarantineRecord, QuarantineCheck } from './quarantine';

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
  verifySearchLineage,
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
  DATA_ORIGINS_MIRROR,
  isDataOriginMirror,
  isEvaluationClaim,
  validateEvaluationClaim,
  isEmbargoSource,
  checkHoldoutWindowSeparation,
  detectLeakage,
} from './leakage';
export type { DataOriginMirror, EvaluationClaim, EmbargoSource, LeakageCheck } from './leakage';

export {
  isBestOfNEffectMirror,
  isSearchIntegrityReportMirror,
  compileSelectionAudit,
} from './selection';
export type {
  BestOfNEffectMirror,
  SearchIntegrityReportMirror,
  InSearchStatistic,
  HoldoutEvaluation,
  SelectionClaim,
  ExperimentRetained,
  SelectionAudit,
  SelectionAuditInput,
} from './selection';

/** Package identity and ownership (Work Order T031). */
export const packageInfo = {
  name: '@tradrl/evaluation-integrity',
  owner: 'T031',
  status: 'implemented',
} as const;
