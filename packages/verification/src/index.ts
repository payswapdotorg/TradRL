/**
 * @tradrl/verification — evidence-chain verification and the release gate
 * (T012).
 *
 * Public API:
 *   - Structural primitives — the shared contract vocabulary (guards,
 *     deep-freeze discipline, JSON model, canonical JSON, the stable digest
 *     MIRRORED byte-identically from @tradrl/evaluation) and the
 *     `TimestampMs` mirror of @tradrl/time-engine.
 *   - Ids — the verification-lane identity spaces (`VerificationCaseId`,
 *     `VerificationReportId`, `ReleaseGateId`) plus the opaque evaluation-
 *     lane mirrors (`SuiteId`, `AdversarialSuiteRef`, `VerdictId`,
 *     `EvaluationRunId`, `EvaluatorVersionRef`).
 *   - Evidence-chain verification — `VerificationCase` (lineage-hash,
 *     quartet-monotone, no-future-leakage claims) and
 *     `verifyEvidenceChain` -> `VerificationReport` (boolean + reasons,
 *     never scores); `lineageHashOf` / `canonicalPayload` for minting.
 *   - Release gate — `composeReleaseGate`: an evaluation-suite result (its
 *     attainment verdict) + a verification report -> the id-referenced,
 *     no-free-text `ReleaseGateRecord`. The L10 law is a typed refusal:
 *     no adversarial suite reference, no gate.
 *
 * Zero runtime dependencies; types, schemas and pure functions only. No
 * ambient clock anywhere. The evaluation-lane shapes consumed here are
 * STRUCTURAL MIRRORS (D-003/D-004) — never imports; src/interop.test.ts is
 * the drift trip wire.
 */

// Errors and results
export type { VerificationErrorCode, VerificationError, VerificationResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives (deepFreeze discipline, branding, JSON model, digests)
export type { Brand, Mutable, JsonValue, JsonObject } from './primitives';
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
  canonicalJson,
  stableDigest,
  stableDigestJson,
  isDigest,
} from './primitives';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './primitives';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs } from './primitives';

// Branded ids and opaque cross-lane references
export type {
  VerificationCaseId,
  VerificationReportId,
  ReleaseGateId,
  SuiteId,
  AdversarialSuiteRef,
  VerdictId,
  EvaluationRunId,
  EvaluatorVersionRef,
} from './ids';
export {
  isVerificationCaseId,
  isVerificationReportId,
  isReleaseGateId,
  isSuiteId,
  isAdversarialSuiteRef,
  isVerdictId,
  isEvaluationRunId,
  isEvaluatorVersionRef,
} from './ids';

// Evidence-chain verification
export type {
  AvailabilityQuartet,
  LeakageSample,
  LineageHashCase,
  QuartetMonotoneCase,
  NoFutureLeakageCase,
  VerificationCase,
  VerificationReasonCode,
  VerificationFailure,
  VerificationReport,
} from './evidence';
export {
  isAvailabilityQuartet,
  isLeakageSample,
  VERIFICATION_CASE_KINDS,
  isLineageHashCase,
  isQuartetMonotoneCase,
  isNoFutureLeakageCase,
  isVerificationCase,
  VERIFICATION_REASON_CODES,
  isVerificationReasonCode,
  isVerificationFailure,
  isVerificationReport,
  verifyEvidenceChain,
  lineageHashOf,
  canonicalPayload,
} from './evidence';

// The release gate
export type {
  SuiteGradeMirror,
  EvaluationSuiteMirror,
  AttainmentVerdictMirror,
  VerificationReportMirror,
  ReleaseRecommendation,
  ReleaseReasonCode,
  ReleaseGateRecord,
  ReleaseGateInput,
} from './release';
export {
  SUITE_GRADES_MIRROR,
  isSuiteGradeMirror,
  isEvaluationSuiteMirror,
  isAttainmentVerdictMirror,
  isVerificationReportMirror,
  RELEASE_RECOMMENDATIONS,
  isReleaseRecommendation,
  RELEASE_REASON_CODES,
  isReleaseReasonCode,
  isReleaseGateRecord,
  composeReleaseGate,
} from './release';

/** Package identity and ownership (Work Order T012). */
export const packageInfo = {
  name: '@tradrl/verification',
  owner: 'T012',
  status: 'implemented',
} as const;
