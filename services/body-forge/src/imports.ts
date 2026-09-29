/**
 * @tradrl/body-forge (service) — the import surface.
 *
 * One module owning every cross-module import so the frozen workspace
 * lockfile story stays legible:
 * - `@tradrl/skills` — the contract package this service implements
 *   (consumed via a RELATIVE SOURCE IMPORT; the frozen workspace lockfile
 *   admits no new package dependency edges on this branch — the same
 *   discipline services/organization-compiler and services/learning
 *   document; linking the workspace packages is a merge-time concern for
 *   the Tech Lead).
 * - `./mirrors` — the agent-body BodyVersion structural mirror family.
 *
 * Re-exported here so every service module imports from ONE place.
 */

// --- The contract package (@tradrl/skills, T017) ----------------------------
export type {
  CapabilityGapMirror,
  CertificationDecisionInput,
  CertificationLineage,
  CertificationRecord,
  CertificationRecordId,
  CompatibilityVerdictRef,
  ForgeVersionRef,
  SkillDelta,
  SkillError,
  SkillResult,
  TimestampMs,
  TrialId,
  TrajectoryId,
  VerdictId,
} from '../../../packages/skills/src/index';
export {
  appendCertificationRecord,
  canonicalJson,
  createCertificationRecord,
  decideCertification,
  deepCloneJson,
  deepFreeze,
  isCapabilityGapMirror,
  isCertificationRecordId,
  isCompatibilityVerdictRef,
  isNonEmptyString,
  isProjectId,
  isRecord,
  isSkillDelta,
  isTenantId,
  isTimestampMs,
  isVerdictId,
  stableDigest,
} from '../../../packages/skills/src/index';

// --- The agent-body structural mirrors (this service) -----------------------
export type {
  BodyCompositionMirror,
  BodyVersionIdMirror,
  BodyVersionMirror,
  CertificationEvidenceMirror,
  ForgeScope,
  SemVerMirror,
  SubstrateCompatibilityManifestMirror,
} from './mirrors';
export {
  bodyVersionInvariantsMirror,
  compositionInvariantsMirror,
  isBodyVersionIdMirror,
  isBodyVersionMirror,
  isIso8601Mirror,
  isSemVerMirror,
  mirrorCanonicalJson,
  mirrorStableDigest,
  semVerMirrorToString,
} from './mirrors';
