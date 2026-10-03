// @tradrl/firm-memory-service — the lane's single import surface.
//
// Work Order T034. One module owning every cross-module import so the
// frozen workspace lockfile story stays legible (the outcome-learning
// precedent): the service imports ITS OWN LANE's contract package —
// packages/firm-memory — via a relative source path, exactly as
// services/outcome-learning imports packages/outcomes. Every OTHER
// lane's shapes (T033's OutcomeRecord/PostMortemRecord and the whole
// attribution surface, T011's trajectory/experiment/trial refs, T007's
// tenant/project identity) are already STRUCTURAL MIRRORS inside that
// package (law D-003/D-004); this lane imports NOTHING else — zero
// workspace dependencies in package.json, zero cross-lane source
// imports in src. Cross-lane trip wires against the REAL services
// (outcome-learning, shadow-trading) and the REAL packages (outcomes,
// trajectory, experiments, control-domain, execution-policy) live in
// interop.test.ts (test-only imports).

export type { FirmMemoryErrorCode, FirmMemoryError, FirmMemoryResult } from '../../../packages/firm-memory/src/errors';
export { fail, failures, ok, isFirmMemoryError } from '../../../packages/firm-memory/src/errors';
export type { JsonValue, JsonObject, TimestampMs } from '../../../packages/firm-memory/src/primitives';
export {
  isRecord,
  isNonEmptyString,
  isTimestampMs,
  asTimestampMs,
  deepFreeze,
  canonicalJson,
  fnv1a32Hex,
  isDigest,
  isCanonicalUnsignedDecimal,
  isCanonicalSignedDecimal,
  isUnitIntervalDecimal,
  signedAdd,
  signedSubtract,
  signedCompare,
  unitIntervalCompare,
} from '../../../packages/firm-memory/src/primitives';
export type { TenantRef, ProjectRef, OutcomeRef, PostMortemRef, SessionRef } from '../../../packages/firm-memory/src/ids';
export { isOpaqueRef } from '../../../packages/firm-memory/src/ids';
export {
  mintFirmReceiptId,
  isFirmKnowledgeId,
  isContradictionId,
} from '../../../packages/firm-memory/src/ids';
export type { KnowledgeKind, ClaimPolarity, LagBand, HarmPolarity, MovePolarity, CalibrationPolarity, OutcomeClassMirror } from '../../../packages/firm-memory/src/vocabulary';
export {
  KNOWLEDGE_KINDS,
  polaritiesForKind,
  oppositePolarity,
  deriveLagBand,
  harmPolarityOfOutcome,
  isKnowledgeKind,
  isClaimPolarity,
  isPolarityForKind,
  isOutcomeClassMirror,
  isLagBand,
} from '../../../packages/firm-memory/src/vocabulary';
export type { KnowledgeClaim, ClaimScope } from '../../../packages/firm-memory/src/claim';
export {
  claimFamilyKey,
  claimOrder,
  claimsContradict,
  mintKnowledgeClaim,
  oppositeOf,
  describeClaim,
} from '../../../packages/firm-memory/src/claim';
export type {
  OutcomeRecordMirror,
  PostMortemRecordMirror,
  AttributionHypothesisMirror,
  AttributionClassMirror,
  AttributionDetailMirror,
  DecisionDimensionMirror,
  DecisionAttributionMirror,
  MarketMoveAttributionMirror,
  ModelErrorAttributionMirror,
  DataLagAttributionMirror,
  EvidenceRefMirror,
} from '../../../packages/firm-memory/src/outcome-mirror';
export {
  isOutcomeRecordMirror,
  isPostMortemRecordMirror,
  isAttributionHypothesisMirror,
  isDecisionDimensionMirror,
  isDecisionAttributionMirror,
  isMarketMoveAttributionMirror,
  isModelErrorAttributionMirror,
  isDataLagAttributionMirror,
  isEvidenceRefMirror,
} from '../../../packages/firm-memory/src/outcome-mirror';
export type { FirmKnowledgeRecord, KnowledgeProvenance, ValidityWindow } from '../../../packages/firm-memory/src/record';
export { mintFirmKnowledgeRecord, sortedUniqueRefs, windowCovers, isFirmKnowledgeRecord } from '../../../packages/firm-memory/src/record';
export type { ContradictionRecord, ContradictionSide } from '../../../packages/firm-memory/src/contradiction';
export { mintContradictionRecord, isContradictionRecord } from '../../../packages/firm-memory/src/contradiction';
export type { PromotionPolicy, ServingPolicy } from '../../../packages/firm-memory/src/policy';
export {
  validatePromotionPolicy,
  validateServingPolicy,
  DEFAULT_PROMOTION_POLICY,
  DEFAULT_SERVING_POLICY,
  meetsPromotionBar,
  servingVisibilityWindow,
  withinServingWindow,
} from '../../../packages/firm-memory/src/policy';
export type { FirmKnowledgeLog, ContradictionLog } from '../../../packages/firm-memory/src/log';
export {
  startFirmKnowledgeLog,
  startContradictionLog,
  appendFirmKnowledge,
  appendContradiction,
  verifyFirmKnowledgeChain,
  verifyContradictionChain,
  firmKnowledgeLogDigest,
  contradictionLogDigest,
} from '../../../packages/firm-memory/src/log';
export type { KnowledgeQuery, ContradictionQuery, KnowledgeQueryOptions, ServedKnowledge } from '../../../packages/firm-memory/src/query';
export { familyWinnerId, knowledgeStatusAt, contradictionVisibleAt } from '../../../packages/firm-memory/src/query';
