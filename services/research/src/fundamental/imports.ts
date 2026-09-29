// @tradrl/research (service) — the fundamental lane's single import surface.
//
// Work Order T023. One module owning every cross-module import so the
// frozen workspace lockfile story stays legible (the body-forge and
// sentiment-lane precedent): the service imports ITS OWN LANE's contract
// package — bodies/fundamental-researcher — via a relative source path,
// exactly as services/research/src/sentiment imports
// bodies/sentiment-researcher and services/research/src/regime imports
// bodies/regime-researcher. Every other lane's shapes are already
// structural mirrors inside that package (law D-003/D-004); this lane
// imports NOTHING else. Cross-package trip wires against the REAL packages
// (agent-body, skills, evaluation, market-protocol, provenance, agent-os,
// the T038 equities/alt-data adapters) live in
// bodies/fundamental-researcher's interop test and in this lane's interop
// test (test-only imports).
//
// NOTE (the service-root collision law): this module is NOT re-exported
// wholesale by the lane's public index — the sentiment lane (T021,
// frozen) already publishes the shared generic names (canonicalJson,
// TenantId, ok, ...) through the service root, and a second `export *`
// of those names would be a TS2308 ambiguity. The fundamental lane's
// public surface (src/fundamental/index.ts) exports ONLY
// fundamental-prefixed (or otherwise unique) names.

export type {
  AgentInstanceId,
  BodyVersionRef,
  FundamentalAssessmentId,
  FundamentalMethodId,
  FundamentalMethodVersionRef,
  CorporateActionDigestId,
  ObservationId,
  ProjectId,
  FundamentalResearchReportId,
  TenantId,
  TopicName,
  ToolRef,
} from '../../../../bodies/fundamental-researcher/src/ids';
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
} from '../../../../bodies/fundamental-researcher/src/primitives';
export type { FundamentalError, FundamentalResult, FundamentalValidation } from '../../../../bodies/fundamental-researcher/src/errors';
export {
  fail,
  invalidField,
  invalidType,
  missingField,
  ok,
} from '../../../../bodies/fundamental-researcher/src/errors';
export type {
  AssessmentKind,
  CorporateActionKind,
  ImplicationStance,
  ValuationAssessmentParameters,
  MacroSurpriseAssessmentParameters,
  HealthAssessmentParameters,
  FundamentalMethodRecord,
  FundamentalMethodRegistry,
} from '../../../../bodies/fundamental-researcher/src/methods';
export {
  ASSESSMENT_KINDS,
  CORPORATE_ACTION_KINDS,
  FUNDAMENTAL_METHOD_REGISTRY,
  findFundamentalMethod,
} from '../../../../bodies/fundamental-researcher/src/methods';
export type {
  DeferredObservation,
  FundamentalDatumObservation,
  FundamentalObservationSource,
  FundamentalObservation,
  MacroReleaseObservation,
  CorporateActionObservation,
  UnsupportedObservation,
} from '../../../../bodies/fundamental-researcher/src/observations';
export {
  canonicalObservationOrder,
  classifyPulledRecord,
  createScriptedObservationSource,
  gateObservations,
  isFundamentalObservationSource,
  isFundamentalObservation,
  validateFundamentalObservation,
} from '../../../../bodies/fundamental-researcher/src/observations';
export type {
  ConfidenceAssessment,
  ObservationCitation,
  StanceAssessment,
  FundamentalAssessment,
} from '../../../../bodies/fundamental-researcher/src/assessment';
export {
  classifyStanceDirection,
  createFundamentalAssessment,
  isFundamentalAssessment,
  serializeFundamentalAssessment,
  validateFundamentalAssessment,
} from '../../../../bodies/fundamental-researcher/src/assessment';
export type { CorporateActionDigest } from '../../../../bodies/fundamental-researcher/src/action-digest';
export {
  createCorporateActionDigest,
  isCorporateActionDigest,
  serializeCorporateActionDigest,
  validateCorporateActionDigest,
} from '../../../../bodies/fundamental-researcher/src/action-digest';
export type {
  CoverageAccounting,
  FundamentalDataGap,
  FundamentalResearchReport,
  FundamentalSummary,
} from '../../../../bodies/fundamental-researcher/src/report';
export {
  composeFundamentalSummary,
  createFundamentalResearchReport,
  dominantStanceOf,
  isFundamentalResearchReport,
  serializeFundamentalResearchReport,
  validateFundamentalResearchReport,
} from '../../../../bodies/fundamental-researcher/src/report';
export type {
  FundamentalResearcherBodySpec,
  FundamentalAuthorityScope,
} from '../../../../bodies/fundamental-researcher/src/body';
export {
  FUNDAMENTAL_PIPELINE_STAGES,
  FUNDAMENTAL_RESEARCHER_BODY,
  FUNDAMENTAL_RESEARCHER_BODY_DIGEST,
  validateFundamentalResearcherBody,
} from '../../../../bodies/fundamental-researcher/src/body';
export type {
  MessageEnvelopeMirror,
  PublicationReceipt,
  FundamentalPublication,
  FundamentalPublicationInput,
  FundamentalPublicationPort,
} from '../../../../bodies/fundamental-researcher/src/publication';
export {
  buildFundamentalPublication,
  createFundamentalRecordingPort,
  isFundamentalPublicationPort,
  fundamentalReportRefOf,
  serializeFundamentalPublication,
  validateFundamentalPublication,
} from '../../../../bodies/fundamental-researcher/src/publication';
export {
  compareDecimal,
  decimalAbs,
  decimalDispersion,
  decimalMean,
  decimalRatio,
  decimalSub,
} from '../../../../bodies/fundamental-researcher/src/decimals';
// The deterministic observation fixture builders (the body package's
// fixture world — the same seam the sentiment lane uses).
export {
  fixtureFundamentalObservation,
  fixtureMacroObservation,
  fixtureActionObservation,
} from '../../../../bodies/fundamental-researcher/src/fixtures';
