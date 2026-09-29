// @tradrl/research (service) — the cross-market lane's single import surface.
//
// Work Order T023. One module owning every cross-module import so the
// frozen workspace lockfile story stays legible (the body-forge and
// sibling-lane precedent): the service imports ITS OWN LANE's contract
// package — bodies/cross-market-researcher — via a relative source path,
// exactly as services/research/src/sentiment imports
// bodies/sentiment-researcher. Every other lane's shapes are already
// structural mirrors inside that package (law D-003/D-004); this lane
// imports NOTHING else. Cross-package trip wires against the REAL packages
// (agent-body, skills, evaluation, market-protocol, provenance, agent-os,
// the T037 Coinbase + T038 equities adapters) live in
// bodies/cross-market-researcher's interop test and in this lane's
// interop test (test-only imports).
//
// NOTE (the service-root collision law): this module is NOT re-exported
// wholesale by the lane's public index — the sentiment lane (T021,
// frozen) already publishes the shared generic names (canonicalJson,
// TenantId, ok, ...) through the service root, and a second `export *`
// of those names would be a TS2308 ambiguity. The cross-market lane's
// public surface (src/cross-market/index.ts) exports ONLY cross-market
// prefixed (or otherwise unique) names.

export type {
  AgentInstanceId,
  BodyVersionRef,
  CrossMarketMethodId,
  CrossMarketMethodVersionRef,
  CrossMarketObservationId,
  CrossMarketRelationshipId,
  CrossMarketResearchReportId,
  ProjectId,
  TenantId,
  TopicName,
  ToolRef,
} from '../../../../bodies/cross-market-researcher/src/ids';
export {
  canonicalJson,
  deepCloneJson,
  deepFreeze,
  fnv1a32,
  isDeeplyFrozen,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  stableDigest,
  stableDigestJson,
  type TimestampMs,
} from '../../../../bodies/cross-market-researcher/src/primitives';
export type { CrossMarketError, CrossMarketResult, CrossMarketValidation } from '../../../../bodies/cross-market-researcher/src/errors';
export {
  fail,
  invalidField,
  invalidType,
  missingField,
  ok,
} from '../../../../bodies/cross-market-researcher/src/errors';
export type {
  RelationshipKind,
  RelationshipDirection,
  CoMovementParameters,
  LeadLagParameters,
  SpreadDivergenceParameters,
  CrossMarketMethodRecord,
  CrossMarketMethodRegistry,
} from '../../../../bodies/cross-market-researcher/src/methods';
export {
  CROSS_MARKET_METHOD_REGISTRY,
  RELATIONSHIP_KINDS,
  findCrossMarketMethod,
} from '../../../../bodies/cross-market-researcher/src/methods';
export type {
  DeferredObservation,
  FundamentalDatumObservation,
  CrossMarketObservationSource,
  CrossMarketObservation,
  QuoteObservation,
  TradeObservation,
  UnsupportedObservation,
} from '../../../../bodies/cross-market-researcher/src/observations';
export {
  canonicalObservationOrder,
  classifyPulledRecord,
  createScriptedCrossMarketSource,
  gateObservations,
  isCrossMarketObservationSource,
  isCrossMarketObservation,
  validateCrossMarketObservation,
} from '../../../../bodies/cross-market-researcher/src/observations';
export type {
  ConfidenceLevel,
  CrossMarketConfidence,
  MarketLeg,
  MarketPair,
  ObservationCitation,
  RelationshipMeasure,
  RelationshipWindow,
  CrossMarketRelationship,
} from '../../../../bodies/cross-market-researcher/src/relationship';
export {
  createCrossMarketRelationship,
  isCrossMarketRelationship,
  marketLegKey,
  serializeCrossMarketRelationship,
  validateCrossMarketRelationship,
} from '../../../../bodies/cross-market-researcher/src/relationship';
export type {
  CoverageAccounting,
  CrossMarketDataGap,
  CrossMarketResearchReport,
  CrossMarketSummary,
} from '../../../../bodies/cross-market-researcher/src/report';
export {
  composeCrossMarketSummary,
  createCrossMarketResearchReport,
  dominantRelationKindOf,
  isCrossMarketResearchReport,
  serializeCrossMarketResearchReport,
  validateCrossMarketResearchReport,
} from '../../../../bodies/cross-market-researcher/src/report';
export type {
  CrossMarketResearcherBodySpec,
  CrossMarketAuthorityScope,
} from '../../../../bodies/cross-market-researcher/src/body';
export {
  CROSS_MARKET_PIPELINE_STAGES,
  CROSS_MARKET_RESEARCHER_BODY,
  CROSS_MARKET_RESEARCHER_BODY_DIGEST,
  validateCrossMarketResearcherBody,
} from '../../../../bodies/cross-market-researcher/src/body';
export type {
  MessageEnvelopeMirror,
  PublicationReceipt,
  CrossMarketPublication,
  CrossMarketPublicationInput,
  CrossMarketPublicationPort,
} from '../../../../bodies/cross-market-researcher/src/publication';
export {
  buildCrossMarketPublication,
  createCrossMarketRecordingPort,
  isCrossMarketPublicationPort,
  crossMarketReportRefOf,
  serializeCrossMarketPublication,
  validateCrossMarketPublication,
} from '../../../../bodies/cross-market-researcher/src/publication';
export {
  compareDecimal,
  decimalAbs,
  decimalDispersion,
  decimalMean,
  decimalRatio,
  decimalSub,
} from '../../../../bodies/cross-market-researcher/src/decimals';
export type { RoundingMode } from '../../../../bodies/cross-market-researcher/src/decimals';
// The deterministic observation fixture builders (the body package's
// fixture world — the same seam the sibling lanes use).
export {
  fixtureFundamentalObservation,
  fixtureTradeObservation,
} from '../../../../bodies/cross-market-researcher/src/fixtures';
