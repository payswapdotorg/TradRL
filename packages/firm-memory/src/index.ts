/**
 * @tradrl/firm-memory — the tenant-isolated organizational memory
 * CONTRACTS package (Work Order T034): the Memory/evaluation plane's
 * FIRM BRAIN segment (spec/ARCHITECTURE.md — "Outcome -> Firm Brain ->
 * Capability Improvement"; the "Memory/evaluation" plane listing
 * "...outcomes, post-mortems, Firm Brain and Body Versions").
 *
 * Public API:
 *   - `FirmKnowledgeRecord` — the promoted, deduplicated learning
 *     unit: the typed claim (closed kind/polarity/lag-band
 *     vocabularies), the aggregate confidence (the exact MIN fold),
 *     the distinct-outcome count, the L9 provenance refs back to the
 *     supporting post-mortems/outcomes/experiments/sessions, the
 *     validity window, and the `fkr:` content address.
 *   - `ContradictionRecord` — the typed record of one contested
 *     knowledge family (two opposing sides; the register's own
 *     hash-chained append-only log — never a silent overwrite).
 *   - The two chains — `FirmKnowledgeLog` / `ContradictionLog`
 *     (T030/T031's fold law, mirrored: the typed
 *     `firm_log_rewrite` / `contradiction_log_rewrite` crimes; the
 *     `contradiction_detected` flip-without-domination crime).
 *   - The promotion policy shapes — evidence count, aggregate
 *     confidence, window stability, validity window.
 *   - The point-in-time query contracts — `KnowledgeQuery`,
 *     `KnowledgeQueryOptions`, `ServedKnowledge` (L4: the future is
 *     never returned; L12: scope-pure reads).
 *   - The T033 query-surface MIRRORS — `OutcomeRecordMirror`,
 *     `PostMortemRecordMirror` and friends (field-for-field, never
 *     imported; the service's interop test is the drift trip wire).
 *
 * Package laws (mirroring the merged contract packages):
 * - Zero runtime dependencies; zero WORKSPACE imports of any kind —
 *   types, guards and pure functions only, everything hand-rolled.
 * - No `any`; every exported shape ships a hand-rolled total guard.
 * - All contract data is JSON-serializable and deeply frozen.
 * - No ambient clock (`Date.now()` never appears) and no ambient
 *   randomness; every id is content-addressed (`fkr:` / `fkc:` /
 *   `fmr:`) and every instant is an injected parameter.
 * - Exact decimals on every confidence path — a JS number is the
 *   typed `decimal_imprecision`; the signed arithmetic helpers are
 *   the local BigInt fixed-point mirror of the program-wide grammar
 *   (pinned against @tradrl/execution-policy's REAL kernel by the
 *   service's interop parity trip wire).
 * - L12 on every record (tenant/project scope); L4 at every evidence
 *   boundary (knowledge cannot predate its evidence; serving cannot
 *   return the future); append-only + chain-verified wherever
 *   history is retained (rewriting or HIDING a knowledge entry or a
 *   contradiction is a typed error).
 */

// Errors and results
export type { FirmMemoryErrorCode, FirmMemoryError, FirmMemoryResult } from './errors';
export { fail, failures, ok, isFirmMemoryError } from './errors';

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
  unitIntervalCompare,
} from './primitives';

// Ids and opaque cross-lane references
export type {
  FirmKnowledgeId,
  ContradictionId,
  FirmReceiptId,
  TenantRef,
  ProjectRef,
  OutcomeRef,
  PostMortemRef,
  SessionRef,
  DecisionRef,
  IntentRef,
  TrajectoryRef,
  ExperimentRef,
  TrialRef,
} from './ids';
export {
  isFirmKnowledgeId,
  isContradictionId,
  isFirmReceiptId,
  mintFirmKnowledgeId,
  mintContradictionId,
  mintFirmReceiptId,
  isOpaqueRef,
} from './ids';

// The closed knowledge vocabulary + the deterministic derivations
export type { KnowledgeKind, HarmPolarity, MovePolarity, CalibrationPolarity, ClaimPolarity, LagBand, OutcomeClassMirror } from './vocabulary';
export {
  KNOWLEDGE_KINDS,
  HARM_POLARITIES,
  MOVE_POLARITIES,
  CALIBRATION_POLARITIES,
  CLAIM_POLARITIES,
  LAG_BANDS,
  OUTCOME_CLASS_VALUES,
  isKnowledgeKind,
  requireKnowledgeKind,
  polaritiesForKind,
  isPolarityForKind,
  requirePolarityForKind,
  oppositePolarity,
  isLagBand,
  requireLagBand,
  deriveLagBand,
  isOutcomeClassMirror,
  harmPolarityOfOutcome,
} from './vocabulary';

// The knowledge claim (the typed, never-prose content)
export type { KnowledgeClaim, ClaimScope } from './claim';
export {
  isKnowledgeClaim,
  claimFamilyKey,
  claimsContradict,
  claimOrder,
  mintKnowledgeClaim,
  oppositeOf,
  describeClaim,
} from './claim';

// The T033 query-surface structural mirrors (never imports)
export type {
  AttributionClassMirror,
  DecisionDimensionMirror,
  ModelErrorKindMirror,
  MarketMoveDirectionMirror,
  ShadowDispositionMirror,
  EvidenceKindMirror,
  EvidenceRefMirror,
  ShadowLineageBlockMirror,
  DecisionAttributionMirror,
  MarketMoveAttributionMirror,
  ModelErrorAttributionMirror,
  DataLagAttributionMirror,
  AttributionDetailMirror,
  AttributionHypothesisMirror,
  OutcomeExpectationMirror,
  OutcomeRealizationMirror,
  OutcomeDeviationMirror,
  OutcomeDecisionLinkMirror,
  ExperimentBindingMirror,
  OutcomeLineageMirror,
  OutcomeRecordMirror,
  PostMortemSubjectMirror,
  PostMortemExpectationMirror,
  PostMortemActualMirror,
  PostMortemGapMirror,
  PostMortemLineageMirror,
  PostMortemRecordMirror,
} from './outcome-mirror';
export {
  ATTRIBUTION_CLASS_MIRRORS,
  DECISION_DIMENSION_MIRRORS,
  MODEL_ERROR_KIND_MIRRORS,
  EVIDENCE_KIND_MIRRORS,
  isAttributionClassMirror,
  isDecisionDimensionMirror,
  isModelErrorKindMirror,
  isMarketMoveDirectionMirror,
  isShadowDispositionMirror,
  isEvidenceKindMirror,
  isEvidenceRefMirror,
  isEvidenceRefList,
  isShadowLineageBlockMirror,
  isDecisionAttributionMirror,
  isMarketMoveAttributionMirror,
  isModelErrorAttributionMirror,
  isDataLagAttributionMirror,
  isAttributionHypothesisMirror,
  isOutcomeExpectationMirror,
  isOutcomeRealizationMirror,
  isOutcomeDeviationMirror,
  isOutcomeDecisionLinkMirror,
  isExperimentBindingMirror,
  isOutcomeLineageMirror,
  isOutcomeRecordMirror,
  isPostMortemSubjectMirror,
  isPostMortemExpectationMirror,
  isPostMortemActualMirror,
  isPostMortemGapMirror,
  isPostMortemLineageMirror,
  isPostMortemRecordMirror,
} from './outcome-mirror';

// The firm-knowledge record (the primary contract)
export type { KnowledgeProvenance, ValidityWindow, FirmKnowledgeRecord } from './record';
export {
  isKnowledgeProvenance,
  isValidityWindow,
  windowCovers,
  isFirmKnowledgeRecord,
  firmKnowledgeContentTree,
  sortedUniqueRefs,
  mintFirmKnowledgeRecord,
} from './record';

// The contradiction record (the typed contest evidence)
export type { ContradictionSide, ContradictionRecord } from './contradiction';
export {
  isContradictionSide,
  isContradictionRecord,
  contradictionContentTree,
  mintContradictionRecord,
} from './contradiction';

// The policies
export type { PromotionPolicy, ServingPolicy } from './policy';
export {
  validatePromotionPolicy,
  DEFAULT_PROMOTION_POLICY,
  meetsPromotionBar,
  validateServingPolicy,
  DEFAULT_SERVING_POLICY,
  servingVisibilityWindow,
  withinServingWindow,
} from './policy';

// The memory chains (append-only, hash-chained)
export type { FirmKnowledgeLog, ContradictionLog } from './log';
export {
  FIRM_MEMORY_CHAIN_SEED,
  CONTRADICTION_CHAIN_SEED,
  startFirmKnowledgeLog,
  startContradictionLog,
  appendFirmKnowledge,
  appendContradiction,
  verifyFirmKnowledgeChain,
  verifyContradictionChain,
  isFirmKnowledgeLog,
  isContradictionLog,
  firmKnowledgeLogDigest,
  contradictionLogDigest,
  knowledgeFamilyKey,
} from './log';

// The point-in-time query contracts + the pure serving derivations
export type { KnowledgeQuery, ContradictionQuery, KnowledgeQueryOptions, ServedKnowledge } from './query';
export {
  familyWinnerId,
  knowledgeStatusAt,
  contradictionVisibleAt,
  windowCovers as windowCoversQuery,
} from './query';
