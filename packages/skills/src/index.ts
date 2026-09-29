/**
 * @tradrl/skills — public API.
 *
 * Owning Work Order: T017 (frozen write surface: packages/skills,
 * services/body-forge).
 *
 * The skill-extraction contract package — the learning loop's closing half
 * (spec/LEARNING-LOOP.md: "failure analysis -> skill extraction -> Body
 * Version -> compatibility -> shadow -> outcome -> next experiment").
 * Zero runtime dependencies; types, schemas and pure functions only. No
 * ambient clock (`Date.now()` never appears) and no ambient randomness
 * (seeded derivation only) — byte-determinism of serialization is a
 * construction law.
 *
 * - primitives: structural guards, string-keyed brands (owned id spaces +
 *   cross-lane mirrors), deep-freeze discipline, canonical JSON + stable
 *   digest (the program-wide law), seeded draws.
 * - errors: the typed error taxonomy — the machine-checkable form of the
 *   work order's laws (evidence_missing, certified_version_mutation,
 *   compatibility_fail, undeclared_breaking_change, lineage_gap,
 *   attempt_hidden, tenant_missing, label_as_evidence, unseeded_forge, ...).
 * - record: `SkillRecord` — the evidence-backed skill (capability
 *   descriptor with MEASURED evidence per the registry discipline — L16a;
 *   provenance mirrors into trajectory/experiments/evaluation; opaque
 *   applicability; full L9/L12 lineage). Evidence-less skills fail.
 * - delta: `SkillDelta` — the composable change a skill makes to a body
 *   (capability additions/refinements/removals with declared breaking
 *   changes, knowledge/tool policy amendments, procedure amendments) as
 *   structured patches against agent-body mirror shapes.
 * - extraction: `ExtractionProtocol` — (trajectory evidence, gap records,
 *   attainment evidence) -> RANKED candidate SkillRecords, with the
 *   declared, versioned ranking function; pure and deterministic.
 * - certification: `CertificationRecord` — the (candidate,
 *   evaluation-verdict-ref, compatibility-verdict-ref) ->
 *   certified|rejected record with structured reasons; append-only.
 *
 * The reference body forge lives in services/body-forge; it consumes this
 * contract package via a relative source import (the frozen workspace
 * lockfile admits no new package dependency edges on this branch).
 */

// Errors and results
export type {
  SkillErrorCode,
  SkillError,
  SkillResult,
} from './errors';
export {
  fail,
  failures,
  ok,
  missingField,
  invalidField,
  invalidType,
} from './errors';

// Structural primitives (deepFreeze discipline, branding, JSON model)
export type { Brand, Mutable, JsonValue, JsonObject } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeInteger,
  isPositiveInteger,
  isArrayOf,
  isMemberOf,
  deepFreeze,
  isDeeplyFrozen,
  deepCloneJson,
  isJsonValue,
  isJsonObject,
  canonicalJson,
  stableDigest,
  stableDigestJson,
  isDigest,
  fnv1a32,
  createSeededRandom,
} from './primitives';

// TimestampMs mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './primitives';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs, timestampMs } from './primitives';

// Branded ids and opaque cross-lane references
export type {
  TenantId,
  ProjectId,
  TrajectoryId,
  ExperimentId,
  TrialId,
  ArmId,
  VerdictId,
  CapabilityKey,
  CapabilityRecordId,
  CapabilityGapId,
  AttainmentEvidenceRef,
  SkillRecordId,
  SkillArtifactRef,
  SkillDeltaId,
  CertificationRecordId,
  ExtractionVersionRef,
  ForgeVersionRef,
  BodyVersionRef,
  SubstrateRef,
  EnvironmentProfileRef,
  ToolRef,
  KnowledgeSourceRef,
  EvidenceRef,
  InstrumentClassRef,
  CompatibilityVerdictRef,
} from './primitives';
export {
  isTenantId,
  isProjectId,
  isTrajectoryId,
  isExperimentId,
  isTrialId,
  isArmId,
  isVerdictId,
  isCapabilityKey,
  isCapabilityRecordId,
  isCapabilityGapId,
  isAttainmentEvidenceRef,
  isSkillRecordId,
  isSkillArtifactRef,
  isSkillDeltaId,
  isCertificationRecordId,
  isExtractionVersionRef,
  isForgeVersionRef,
  isBodyVersionRef,
  isSubstrateRef,
  isEnvironmentProfileRef,
  isToolRef,
  isKnowledgeSourceRef,
  isEvidenceRef,
  isInstrumentClassRef,
  isCompatibilityVerdictRef,
  tenantId,
  projectId,
  capabilityKey,
  capabilityGapId,
  skillRecordId,
  skillArtifactRef,
  skillDeltaId,
  certificationRecordId,
  extractionVersionRef,
  forgeVersionRef,
  bodyVersionRef,
} from './primitives';

// The evidence-backed skill record
export type {
  LabelEvidenceKey,
  CapabilityEvidenceKind,
  MeasurementMetric,
  BenchmarkEvidence,
  MeasurementRecordEvidence,
  ResultRefEvidence,
  MeasuredEvidence,
  SkillCapabilityDescriptor,
  SkillOrigin,
  SkillProvenance,
  SkillApplicability,
  SkillLineage,
  SkillRecord,
} from './record';
export {
  LABEL_EVIDENCE_KEYS,
  CAPABILITY_EVIDENCE_KINDS,
  MEASUREMENT_METRICS,
  isLabelEvidenceKey,
  labelKeyPaths,
  isCapabilityEvidenceKind,
  isMeasurementMetric,
  isMeasuredEvidence,
  isSkillCapabilityDescriptor,
  SKILL_ORIGINS,
  isSkillOrigin,
  isSkillProvenance,
  provenanceCitationCount,
  isSkillApplicability,
  isSkillLineage,
  isSkillRecord,
  validateSkillRecord,
  createSkillRecord,
  serializeSkillRecord,
} from './record';

// The composable skill delta
export type {
  ProcedureTrigger,
  SkillChangeKind,
  BreakingChangeDeclaration,
  CapabilityAddition,
  CapabilityRefinement,
  CapabilityRemoval,
  KnowledgeToolPolicyAmendment,
  ProcedureStepPatch,
  ProcedurePatch,
  ProcedureAmendment,
  SkillChange,
  SkillDelta,
} from './delta';
export {
  PROCEDURE_TRIGGERS,
  SKILL_CHANGE_KINDS,
  isProcedureTrigger,
  isSkillChangeKind,
  isBreakingChangeDeclaration,
  isProcedureStepPatch,
  isProcedurePatch,
  isSkillChange,
  isSkillDelta,
  deltaCoherenceProblems,
  validateSkillDelta,
  createSkillDelta,
} from './delta';

// The extraction protocol
export type {
  CapabilityGapKind,
  CapabilityGapMirror,
  TrajectoryMetadataMirror,
  TrajectoryEvidenceMirror,
  TrialStatusMirror,
  TrialOutcomeMirror,
  VerdictEvidenceMirror,
  GapEvidenceBinding,
  ExtractionRankingWeights,
  ExtractionRankingFunction,
  ExtractionProtocol,
  ExtractionInput,
  RankedSkillCandidate,
  ExtractionOutput,
} from './extraction';
export {
  CAPABILITY_GAP_KINDS,
  isCapabilityGapKind,
  isCapabilityGapMirror,
  isTrajectoryMetadataMirror,
  isTrajectoryEvidenceMirror,
  TRIAL_STATUSES_MIRROR,
  isTrialStatusMirror,
  isTrialOutcomeMirror,
  isVerdictEvidenceMirror,
  isGapEvidenceBinding,
  bindingCitationCount,
  isExtractionRankingWeights,
  isExtractionRankingFunction,
  isExtractionProtocol,
  isRankedSkillCandidate,
  deriveSkillRecordId,
  deriveSkillArtifactRef,
  validateExtractionInput,
  evidenceStrengthOf,
  runExtraction,
} from './extraction';

// The certification record (certified | rejected — append-only)
export type {
  CertificationDecision,
  CertificationReasonCode,
  CertificationReason,
  CertificationLineage,
  CertificationDecisionInput,
  CertificationRecord,
} from './certification';
export {
  CERTIFICATION_DECISIONS,
  isCertificationDecision,
  CERTIFICATION_REASON_CODES,
  isCertificationReasonCode,
  isCertificationReason,
  isCertificationLineage,
  isCertificationDecisionInput,
  decideCertification,
  isCertificationRecord,
  validateCertificationRecord,
  createCertificationRecord,
  validateCertificationLog,
  appendCertificationRecord,
} from './certification';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/skills',
  owner: 'T017',
  status: 'implemented',
  concepts: [
    'SkillRecord',
    'SkillDelta',
    'ExtractionProtocol',
    'CertificationRecord',
  ],
} as const;
