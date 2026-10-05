/**
 * @tradrl/research-public-evaluation — the PUBLIC EVIDENCE FORMAT (Work
 * Order T049, research/): the platform's publication layer.
 *
 * Public API:
 *   - `primitives.ts` — the shared contract discipline (the program-wide
 *     canonical JSON + dual-lane stable digest, verbatim).
 *   - `errors.ts` — the typed error taxonomy (every publication law has
 *     its code, each negative-tested).
 *   - `ids.ts` — this lane's identity spaces (`pev:` published records,
 *     `pevl:` publication logs) + the opaque cross-lane refs.
 *   - `imports.ts` — the ONE own-lane import surface (benchmarks/platform
 *     — the same Work Order's machinery; the services/marketplace
 *     precedent). Everything else stays behind mirrors.
 *   - `record.ts` — the PUBLISHED EVALUATION RECORD: content-addressed
 *     (L9), provenance-carrying, point-in-time (L4), tenant-scoped
 *     (L12); the claim block; the re-verification recipe.
 *   - `gate.ts` — THE PUBLICATION GATE: the never-publish vocabularies
 *     (chain-of-thought, tenant data — closed key scans, fail-closed)
 *     and the projection law (claims are DERIVED, public axes only).
 *   - `publish.ts` — `compilePublishedRecord` (the gate-to-record
 *     pipeline; claims derived, L4 bound, recipe assembled, `pev:`
 *     addressed).
 *   - `log.ts` — the append-only, chain-verified PUBLICATION LOG (L11;
 *     identical bytes replay; a point-in-time claim is immutable).
 *   - `reverify.ts` — `reverifyPublishedRecord`: the deterministic
 *     re-verification — RE-RUNS the benchmark machinery over the
 *     retained sources and refuses on any byte divergence.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md ("Simulation evidence and
 * live evidence are never conflated" — the class rides the measurement
 * into the publication), spec/ARCHITECTURE-LOCK.md L4/L9/L11/L12/L15/L20,
 * R42 (export/import without customer leakage — the never-publish laws
 * ARE this requirement's benchmark-side half).
 *
 * Package laws: zero runtime dependencies; no `any`; every exported
 * shape has a hand-rolled total type guard; all contract data is
 * JSON-serializable and byte-stable under canonical serialization; no
 * ambient clock and no ambient randomness; the ONE out-of-directory
 * import is the own-lane machinery surface (imports.ts, documented);
 * cross-lane shapes stay behind the machinery's mirrors.
 */

export type { PublicationErrorCode, PublicationError, PublicationResult } from './errors';
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

export type {
  PublishedRecordId,
  PublicationLogId,
  SuiteRef,
  MeasurementRef,
  SplitPlanRef,
  SearchRecordRef,
  EvaluatorVersionRef,
  TenantId,
  ProjectId,
} from './ids';
export {
  isPublishedRecordId,
  isPublicationLogId,
  isSuiteRef,
  isMeasurementRef,
  isSplitPlanRef,
  isSearchRecordRef,
  isEvaluatorVersionRef,
  isTenantId,
  isProjectId,
} from './ids';

export type {
  SubjectKind,
  SubjectRefKind,
  SubjectBinding,
  AxisAttainment,
  SuiteAxis,
  SuiteDefinition,
  MeasurementPhase,
  AxisMeasurement,
  MeasurementMaterial,
  MeasurementSearchBinding,
  MeasurementRecord,
  MeasurementLog,
  MeasurementLogBinding,
  SearchContext,
  MeasurementRunInput,
  SliceReportMirror,
  SplitPlanMirror,
  SearchRecordMirror,
  EvidenceClass,
  MaterialSource,
  AxisKind,
} from './imports';
export {
  isSubjectBinding,
  validateSubjectBinding,
  isAxisKind,
  suiteId,
  suiteDigest,
  validateSuiteDefinition,
  runSuiteMeasurement,
  verifyMeasurementRecord,
  canonicalMeasurement,
  measurementId,
  measurementContentJson,
  splitPlanDigest,
  verifySplitPlanMirror,
  verifySearchRecordLineage,
  isSliceReportMirror,
  slicePipelineViolations,
  // The machinery's MEASUREMENT LOG (the append-only, chain-verified history —
  // the same lane's log API; this layer's own log is its `pevl:` twin over
  // published records).
  isMeasurementLog,
  createMeasurementLog,
  appendMeasurement,
  verifyMeasurementLog,
  measurementLogId,
  measurementChainGenesis,
  measurementChainFold,
  computeMeasurementChainHead,
} from './imports';

export { isPublishedClaimShape, publicationContentJson, publishedRecordId, canonicalPublication, verifyPublishedRecord, claimsFromMeasurement, publicationClaimKey } from './record';
export type { PublishedClaim, PublicationProvenance, ReverificationRecipe, PublishedEvaluationRecord } from './record';

export {
  CHAIN_OF_THOUGHT_KEYS,
  TENANT_DATA_KEYS,
  neverPublishPaths,
  scanNeverPublish,
  isPublicationPolicy,
  projectClaims,
  checkPolicyAxes,
} from './gate';
export type { NeverPublishClass, PublicationPolicy } from './gate';

export { compilePublishedRecord } from './publish';
export type { PublicationInput } from './publish';

export {
  publicationLogId,
  publicationChainGenesis,
  publicationChainFold,
  computePublicationChainHead,
  isPublicationLog,
  createPublicationLog,
  publishRecord,
  verifyPublicationLog,
} from './log';
export type { PublicationLogBinding, PublicationLogEntry, PublicationLog, PublicationAppend } from './log';

export { reverifyPublishedRecord } from './reverify';
export type { ReverificationSources, ReverificationOutcome } from './reverify';

export {
  T0,
  DAY,
  TENANT,
  PROJECT,
  PUBLISHED_AT,
  fixturePolicy,
  fixtureMinimalPolicy,
  fixtureMeasurement,
  fixtureHoldoutMeasurement,
  CHAIN_OF_THOUGHT_ATTACHMENT,
  TENANT_DATA_ATTACHMENT,
  fixtureSliceReport,
  fixturePlatformSuiteRecord,
  fixtureReplaySource,
  fixtureSplitPlan,
  fixtureSearchRecord,
  fixtureSubject,
  fixtureHoldoutReplaySource,
} from './fixtures';

/** Package identity and ownership (Work Order T049 — the publication lane). */
export const packageInfo = {
  name: '@tradrl/research-public-evaluation',
  owner: 'T049',
  status: 'implemented',
} as const;
