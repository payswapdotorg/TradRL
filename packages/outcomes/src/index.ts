/**
 * @tradrl/outcomes — the outcome/post-mortem learning CONTRACTS
 * package (Work Order T033): the Memory/evaluation plane's OUTCOMES +
 * POST-MORTEMS segment (spec/ARCHITECTURE.md — Firm Brain stays T034,
 * Body Versions stay with the body forge).
 *
 * Public API:
 *   - `OutcomeRecord` — one decision linked to its realized
 *     consequences: the expectation / realization / deviation blocks
 *     (exact decimals, honest NULLs), the closed outcome-class
 *     vocabulary, and the full L9/L15 lineage (trajectory, experiment,
 *     shadow session, decision stream position — plus T030's lineage
 *     block VERBATIM, byte-preserving).
 *   - `PostMortemRecord` — the structured post-mortem: what was
 *     expected, what happened, the attribution hypotheses (four typed
 *     classes, unit-interval confidences, evidence-grounded), the gap
 *     arithmetic — drafts by construction, supersession by append.
 *   - The two append-only, chain-verified logs —
 *     `OutcomeLearningLog` / `PostMortemLog` (T030's fold law,
 *     mirrored; the typed `outcome_log_rewrite` /
 *     `postmortem_log_rewrite` crimes).
 *   - `OutcomeLearningHook` + `compileOutcomeLearningHook` — the
 *     evaluation-hook shapes T035 will consume (the hook informs,
 *     never decides — R27 boundary).
 *   - The shadow outcome stream MIRRORS — `ShadowOutcomeRecordMirror`
 *     and friends (T030's input surface, field-for-field, never
 *     imported; the service's interop test is the drift trip wire).
 *
 * Package laws (mirroring the merged contract packages):
 * - Zero runtime dependencies; zero WORKSPACE imports of any kind —
 *   types, guards and pure functions only, everything hand-rolled.
 * - No `any`; every exported shape ships a hand-rolled total guard.
 * - All contract data is JSON-serializable and deeply frozen.
 * - No ambient clock (`Date.now()` never appears) and no ambient
 *   randomness; every id is content-addressed (`out:` / `pmr:` /
 *   `olh:`) and every instant is an injected parameter.
 * - Exact decimals on every money/confidence path — a JS number is
 *   the typed `decimal_imprecision`; the signed arithmetic helpers are
 *   the local BigInt fixed-point mirror of the program-wide grammar
 *   (pinned against @tradrl/execution-policy's REAL kernel by the
 *   service's interop parity trip wire).
 * - L12 on every record (tenant/project scope, enforced against the
 *   shadow lineage at the mint); L4 at every evidence boundary (a
 *   learning record cannot predate its evidence); append-only +
 *   chain-verified wherever history is retained.
 */

// Errors and results
export type { OutcomesErrorCode, OutcomesError, OutcomesResult } from './errors';
export { fail, failures, ok, invalidField, invalidType, isOutcomesError } from './errors';

// Structural primitives (deepFreeze discipline, canonical JSON, digests, exact decimals)
export type { JsonValue, JsonObject, TimestampMs } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isMemberOf,
  deepFreeze,
  isDeeplyFrozen,
  canonicalJson,
  fnv1a32Hex,
  isDigest,
  isTimestampMs,
  asTimestampMs,
  UNSIGNED_DECIMAL_PATTERN,
  SIGNED_DECIMAL_PATTERN,
  isCanonicalUnsignedDecimal,
  isCanonicalSignedDecimal,
  isUnitIntervalDecimal,
  signedAdd,
  signedSubtract,
  signedNegate,
  signedAbs,
  signedCompare,
  unsignedAdd,
  isZeroDecimal,
} from './primitives';

// Ids and opaque cross-lane references
export type {
  OutcomeRecordId,
  PostMortemId,
  LearningHookId,
  TenantRef,
  ProjectRef,
  DecisionRef,
  IntentRef,
  SessionRef,
  TrajectoryRef,
  ExperimentRef,
  TrialRef,
} from './ids';
export {
  isOutcomeRecordId,
  isPostMortemId,
  isLearningHookId,
  mintOutcomeRecordId,
  mintPostMortemId,
  mintLearningHookId,
  isOpaqueRef,
} from './ids';

// The evidence references (closed kind vocabulary + prefix discipline)
export type { EvidenceKind, EvidenceRef } from './evidence';
export { EVIDENCE_KINDS, isEvidenceKind, isEvidenceRef, requireEvidenceRef, validateEvidenceList } from './evidence';

// The shadow outcome stream mirrors (T030's input surface — never imports)
export type {
  ShadowDispositionMirror,
  ShadowLineageMirror,
  ShadowCostsMirror,
  ShadowOutcomeRecordMirror,
  ShadowOutcomeLogMirror,
  DecisionFactsMirror,
  FillFactsMirror,
} from './shadow-stream-mirror';
export {
  isShadowDispositionMirror,
  isShadowLineageMirror,
  isShadowCostsMirror,
  isShadowOutcomeRecordMirror,
  isShadowOutcomeLogMirror,
  SHADOW_OUTCOME_CHAIN_SEED_MIRROR,
  verifyShadowOutcomeChainMirror,
  shadowOutcomeStreamDigestMirror,
  isDecisionFactsMirror,
  isFillFactsMirror,
} from './shadow-stream-mirror';

// The outcome-class vocabulary + the derivation law
export type { OutcomeClass } from './classification';
export { OUTCOME_CLASSES, isOutcomeClass, requireOutcomeClass, classifyOutcome } from './classification';
export type { OutcomeClassificationInput } from './classification';

// The attribution contracts (four typed classes + confidences)
export type {
  AttributionClass,
  DecisionDimension,
  ModelErrorKind,
  MarketMoveDirection,
  DecisionAttribution,
  MarketMoveAttribution,
  ModelErrorAttribution,
  DataLagAttribution,
  AttributionHypothesis,
} from './attribution';
export {
  ATTRIBUTION_CLASSES,
  DECISION_DIMENSIONS,
  MODEL_ERROR_KINDS,
  isAttributionClass,
  requireAttributionClass,
  isDecisionDimension,
  isModelErrorKind,
  isMarketMoveDirection,
  isDecisionAttribution,
  isMarketMoveAttribution,
  isModelErrorAttribution,
  isDataLagAttribution,
  isAttributionHypothesis,
  validateAttributionHypothesis,
  hypothesisOrder,
} from './attribution';

// The outcome record
export type {
  ExpectationProvenance,
  OutcomeExpectation,
  OutcomeRealization,
  OutcomeDeviation,
  OutcomeLineage,
  OutcomeDecisionLink,
  OutcomeRecord,
} from './outcome-record';
export {
  isExpectationProvenance,
  isOutcomeExpectation,
  isOutcomeRealization,
  isOutcomeDeviation,
  isOutcomeLineage,
  isOutcomeDecisionLink,
  isOutcomeRecord,
  outcomeRecordContentTree,
  mintOutcomeRecord,
} from './outcome-record';

// The post-mortem record
export type {
  PostMortemSubject,
  PostMortemExpectation,
  PostMortemActual,
  PostMortemGap,
  PostMortemLineage,
  PostMortemRecord,
} from './postmortem';
export {
  isPostMortemSubject,
  isPostMortemExpectation,
  isPostMortemActual,
  isPostMortemGap,
  isPostMortemLineage,
  isPostMortemRecord,
  postMortemContentTree,
  mintPostMortem,
} from './postmortem';

// The append-only, chain-verified learning logs
export type { OutcomeLearningLog, PostMortemLog } from './logs';
export {
  OUTCOME_LEARNING_CHAIN_SEED,
  POSTMORTEM_CHAIN_SEED,
  startOutcomeLearningLog,
  startPostMortemLog,
  appendOutcomeRecord,
  appendPostMortem,
  verifyOutcomeLearningChain,
  verifyPostMortemChain,
  isOutcomeLearningLog,
  isPostMortemLog,
  outcomeLearningLogDigest,
  postMortemLogDigest,
} from './logs';

// The evaluation hooks (T035's consumption surface)
export type { LearningFocus, OutcomeLearningHook } from './hooks';
export { LEARNING_FOCUS, isLearningFocus, compileOutcomeLearningHook } from './hooks';
