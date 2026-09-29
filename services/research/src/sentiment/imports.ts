// @tradrl/research (service) — the single import surface.
//
// Work Order T021. One module owning every cross-module import so the
// frozen workspace lockfile story stays legible (the body-forge
// precedent): the service imports ITS OWN LANE's contract package —
// bodies/sentiment-researcher — via a relative source path, exactly as
// services/body-forge imports packages/skills. Every other lane's shapes
// are already structural mirrors inside that package (law D-003/D-004);
// this service imports NOTHING else. Cross-package trip wires against
// the REAL packages (agent-body, skills, evaluation, provenance,
// agent-os, the T038 adapters) live in bodies/sentiment-researcher's
// interop test and in this lane's interop test (test-only imports).

export type {
  AgentInstanceId,
  BodyVersionRef,
  EventDigestId,
  MethodId,
  MethodVersionRef,
  ObservationId,
  ProjectId,
  ResearchReportId,
  SentimentReadingId,
  TenantId,
  TopicName,
  ToolRef,
} from '../../../../bodies/sentiment-researcher/src/ids';
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
} from '../../../../bodies/sentiment-researcher/src/primitives';
export type { ResearchError, ResearchResult, ResearchValidation } from '../../../../bodies/sentiment-researcher/src/errors';
export {
  fail,
  invalidField,
  invalidType,
  missingField,
  ok,
} from '../../../../bodies/sentiment-researcher/src/errors';
export type {
  AggregationParameters,
  EventDetectionParameters,
  ConfidenceParameters,
  ReportCompositionParameters,
  EventKind,
  MethodRecord,
  MethodRegistry,
} from '../../../../bodies/sentiment-researcher/src/methods';
export {
  EVENT_KINDS,
  SENTIMENT_METHOD_REGISTRY,
  findMethod,
} from '../../../../bodies/sentiment-researcher/src/methods';
export type {
  DeferredObservation,
  NewsObservation,
  ObservationSource,
  ResearchObservation,
  SentimentScoreObservation,
  UnsupportedObservation,
} from '../../../../bodies/sentiment-researcher/src/observations';
export {
  canonicalObservationOrder,
  classifyPulledRecord,
  createScriptedObservationSource,
  gateObservations,
  isObservationSource,
  isResearchObservation,
  validateResearchObservation,
} from '../../../../bodies/sentiment-researcher/src/observations';
export type {
  ConfidenceAssessment,
  IntensityAssessment,
  ObservationCitation,
  PolarityAssessment,
  SentimentReading,
} from '../../../../bodies/sentiment-researcher/src/reading';
export {
  createSentimentReading,
  isSentimentReading,
  serializeSentimentReading,
  validateSentimentReading,
} from '../../../../bodies/sentiment-researcher/src/reading';
export type { EventDigest } from '../../../../bodies/sentiment-researcher/src/digest';
export {
  createEventDigest,
  isEventDigest,
  serializeEventDigest,
  validateEventDigest,
} from '../../../../bodies/sentiment-researcher/src/digest';
export type {
  CoverageAccounting,
  DataGap,
  ResearchReport,
  ResearchSummary,
} from '../../../../bodies/sentiment-researcher/src/report';
export {
  composeResearchSummary,
  createResearchReport,
  dominantPolarityOf,
  isResearchReport,
  serializeResearchReport,
  validateResearchReport,
} from '../../../../bodies/sentiment-researcher/src/report';
export type {
  SentimentResearcherBodySpec,
  ResearchAuthorityScope,
} from '../../../../bodies/sentiment-researcher/src/body';
export {
  RESEARCH_PIPELINE_STAGES,
  SENTIMENT_RESEARCHER_BODY,
  SENTIMENT_RESEARCHER_BODY_DIGEST,
  validateSentimentResearcherBody,
} from '../../../../bodies/sentiment-researcher/src/body';
export type {
  MessageEnvelopeMirror,
  PublicationReceipt,
  ResearchPublication,
  ResearchPublicationInput,
  ResearchPublicationPort,
} from '../../../../bodies/sentiment-researcher/src/publication';
export {
  buildResearchPublication,
  createRecordingPublicationPort,
  isResearchPublicationPort,
  reportRefOf,
  serializeResearchPublication,
  validateResearchPublication,
} from '../../../../bodies/sentiment-researcher/src/publication';
export {
  decimalAbs,
  decimalDispersion,
  decimalMean,
  compareDecimal,
} from '../../../../bodies/sentiment-researcher/src/decimals';
