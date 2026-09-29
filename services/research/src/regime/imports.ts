// @tradrl/research (service) — the regime lane's single import surface.
//
// Work Order T022. One module owning every cross-module import so the
// frozen workspace lockfile story stays legible (the body-forge and
// sentiment-lane precedent): the service imports ITS OWN LANE's contract
// package — bodies/regime-researcher — via a relative source path, exactly
// as services/research/src/sentiment imports bodies/sentiment-researcher
// and services/body-forge imports packages/skills. Every other lane's
// shapes are already structural mirrors inside that package (law
// D-003/D-004); this lane imports NOTHING else. Cross-package trip wires
// against the REAL packages (agent-body, skills, evaluation,
// market-protocol, provenance, agent-os, the T037 Coinbase adapter, the
// T009 replay world) live in bodies/regime-researcher's interop test and
// in this lane's interop test (test-only imports).
//
// NOTE (the service-root collision law): this module is NOT re-exported
// by the lane's public index — the sentiment lane (T021, frozen) already
// publishes the shared generic names (canonicalJson, TenantId, ok, ...)
// through the service root, and a second `export *` of those names would
// be a TS2308 ambiguity. The regime lane's public surface (src/regime/
// index.ts) exports ONLY regime-prefixed names; the primitives above are
// internal to this lane.

export type {
  AgentInstanceId,
  BodyVersionRef,
  MarketObservationId,
  ProjectId,
  RegimeChangeId,
  RegimeClassificationId,
  RegimeMethodId,
  RegimeMethodVersionRef,
  RegimeResearchReportId,
  TenantId,
  TopicName,
  ToolRef,
} from '../../../../bodies/regime-researcher/src/ids';
export {
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  stableDigest,
  stableDigestJson,
  type TimestampMs,
} from '../../../../bodies/regime-researcher/src/primitives';
export type { RegimeError, RegimeResult, RegimeValidation } from '../../../../bodies/regime-researcher/src/errors';
export {
  fail,
  invalidField,
  invalidType,
  missingField,
  ok,
} from '../../../../bodies/regime-researcher/src/errors';
export type {
  RegimeChangeDetectionParameters,
  RegimeClassificationParameters,
  RegimeConfidenceParameters,
  RegimeReportCompositionParameters,
  RegimeMethodRecord,
  RegimeMethodRegistry,
} from '../../../../bodies/regime-researcher/src/methods';
export {
  REGIME_METHOD_REGISTRY,
  findRegimeMethod,
} from '../../../../bodies/regime-researcher/src/methods';
export type {
  BookSnapshotObservation,
  DeferredMarketObservation,
  MarketObservation,
  MarketObservationSource,
  QuoteObservation,
  TradeObservation,
  UnsupportedMarketObservation,
} from '../../../../bodies/regime-researcher/src/observations';
export {
  canonicalMarketObservationOrder,
  classifyPulledMarketRecord,
  createScriptedMarketSource,
  gateMarketObservations,
  isMarketObservationSource,
  validateMarketObservation,
} from '../../../../bodies/regime-researcher/src/observations';
export type {
  ConfidenceLevel,
  MarketObservationCitation,
  RegimeClassification,
  RegimeConfidence,
  RegimeScope,
  RegimeWindow,
  RegimeWindowStats,
} from '../../../../bodies/regime-researcher/src/classification';
export {
  classifyRegimeWindow,
  computeRegimeWindowDispersion,
  computeRegimeWindowStats,
  createRegimeClassification,
  extractObservationPrice,
  serializeRegimeClassification,
  validateRegimeClassification,
} from '../../../../bodies/regime-researcher/src/classification';
export type { RegimeChange } from '../../../../bodies/regime-researcher/src/change';
export {
  createRegimeChange,
  serializeRegimeChange,
  validateRegimeChange,
} from '../../../../bodies/regime-researcher/src/change';
export type {
  IntakeCoverage,
  RegimeDataGap,
  RegimeResearchReport,
  RegimeSummary,
} from '../../../../bodies/regime-researcher/src/report';
export {
  composeRegimeSummary,
  createRegimeResearchReport,
  dominantRegimeOf,
  serializeRegimeResearchReport,
  validateRegimeResearchReport,
} from '../../../../bodies/regime-researcher/src/report';
export type {
  RegimeResearcherBodySpec,
  RegimeAuthorityScope,
} from '../../../../bodies/regime-researcher/src/body';
export {
  REGIME_PIPELINE_STAGES,
  REGIME_RESEARCHER_BODY,
  REGIME_RESEARCHER_BODY_DIGEST,
  validateRegimeResearcherBody,
} from '../../../../bodies/regime-researcher/src/body';
export type {
  RegimePublicationReceipt,
  RegimeMessageEnvelope,
  RegimePublication,
  RegimePublicationInput,
  RegimePublicationPort,
} from '../../../../bodies/regime-researcher/src/publication';
export {
  buildRegimePublication,
  createRegimeRecordingPort,
  isRegimePublicationPort,
  regimeReportRefOf,
  serializeRegimePublication,
  validateRegimePublication,
} from '../../../../bodies/regime-researcher/src/publication';
export {
  compareDecimal,
  decimalAbs,
  decimalDispersion,
  decimalMean,
  decimalRatio,
  decimalSub,
} from '../../../../bodies/regime-researcher/src/decimals';
