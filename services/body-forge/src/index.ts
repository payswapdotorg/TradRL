/**
 * @tradrl/body-forge — public API.
 *
 * Owning Work Order: T017 (frozen write surface: services/body-forge).
 *
 * The reference body forge — the learning loop's closing half
 * (spec/LEARNING-LOOP.md: "failure analysis -> skill extraction -> Body
 * Version -> compatibility -> shadow -> outcome -> next experiment").
 * Zero runtime dependencies; the service consumes its contract package,
 * `@tradrl/skills`, via a relative source import (the frozen workspace
 * lockfile admits no new package dependency edges on this branch — the
 * same discipline services/organization-compiler and services/learning
 * document; linking the workspace packages is a merge-time concern for
 * the Tech Lead). No ambient clock (`Date.now()` never appears) — every
 * instant is an explicit parameter. No LLM calls, no training, no
 * network: the forge is a PROTOCOL layer — pure records + pure
 * functions. Concrete model-driven extraction is a runtime concern
 * outside this service.
 *
 * - mirrors: the agent-body BodyVersion STRUCTURAL MIRROR family (the
 *   full composition contract — mission, capabilities, knowledge/tool
 *   policy, procedures, planning, delegation, authority boundaries,
 *   evaluation requirements, substrate compatibility) + the canonical
 *   id/semver/ISO guards and the mirrored semantic invariants.
 * - forge: `forgeBodyVersion` — (parent BodyVersion mirror, SkillDelta
 *   set, gap records, evidence, seed, forge version, target version,
 *   createdAt) -> ForgedCandidate (pure, deterministic, byte-stable);
 *   the compatibility gate; the certification path
 *   (`certifyCandidate` — L3 typed errors, append-only certification).
 * - attempt-log: the L11 append-only attempt log — rejected attempts are
 *   RETAINED with structured reasons; hiding or rewriting one is a typed
 *   error (`attempt_hidden` / `attempt_rewrite`), proven by the digest
 *   chain.
 * - run-state: the resumable forge run state (serialize -> parse ->
 *   resume, chain-verified).
 * - fixtures: the golden fixtures (parent, delta set, gaps per kind,
 *   byte-stable golden candidate, certification accept + rejection
 *   paths).
 */

// The agent-body structural mirror family
export type {
  BodyVersionIdMirror,
  BodyIdMirror,
  SemVerMirror,
  MissionMirror,
  BodyCapabilityMirror,
  KnowledgeToolPolicyMirror,
  ProcedureStepMirror,
  BodyProcedureMirror,
  PlanningPolicyMirror,
  DelegationPolicyMirror,
  AuthorityBoundaryMirror,
  EvaluationEnvironmentRequirementsMirror,
  SubstrateRequirementsMirror,
  SubstrateConstraintsMirror,
  TestedSubstrateRecordMirror,
  SubstrateCompatibilityManifestMirror,
  BodyCompositionMirror,
  CertificationEvidenceMirror,
  BodyVersionMirror,
  ForgeScope,
} from './mirrors';
export {
  AGENT_ACTION_NAMES_MIRROR,
  EXECUTION_AUTHORITY_MODES_MIRROR,
  EVALUATION_LAYERS_MIRROR,
  FIDELITY_MODES_MIRROR,
  PROCEDURE_TRIGGERS_MIRROR,
  PLANNING_STYLES_MIRROR,
  MODALITIES_MIRROR,
  REQUIREMENT_LEVELS_MIRROR,
  SUBSTITUTION_TEST_RESULTS_MIRROR,
  isSemVerMirror,
  semVerMirrorToString,
  isBodyVersionIdMirror,
  isBodyIdMirror,
  isIso8601Mirror,
  isAgentActionNameMirror,
  isExecutionAuthorityModeMirror,
  isEvaluationLayerMirror,
  isFidelityModeMirror,
  isProcedureTriggerMirror,
  isPlanningStyleMirror,
  isModalityMirror,
  isRequirementLevelMirror,
  isSubstitutionTestResultMirror,
  isMissionMirror,
  isBodyCapabilityMirror,
  isKnowledgeToolPolicyMirror,
  isProcedureStepMirror,
  isBodyProcedureMirror,
  isPlanningPolicyMirror,
  isDelegationPolicyMirror,
  isAuthorityBoundaryMirror,
  isEvaluationEnvironmentRequirementsMirror,
  isSubstrateRequirementsMirror,
  isSubstrateConstraintsMirror,
  isTestedSubstrateRecordMirror,
  isSubstrateCompatibilityManifestMirror,
  isBodyCompositionMirror,
  isCertificationEvidenceMirror,
  isBodyVersionMirror,
  compositionInvariantsMirror,
  bodyVersionInvariantsMirror,
  mirrorCanonicalJson,
  mirrorStableDigest,
  isForgeScope,
} from './mirrors';

// The reference forge
export type {
  ForgeEvidence,
  DeclaredRemoval,
  DeltaManifest,
  ForgeLineage,
  ForgedCandidate,
  ForgeInput,
  ForgeResultValue,
  CertifyCandidateInput,
} from './forge';
export {
  isForgeEvidence,
  isForgedCandidate,
  validateForgeInput,
  compareSemVerMirror,
  validateCompatibilityGate,
  forgeBodyVersion,
  serializeForgedCandidate,
  certifyCandidate,
} from './forge';

// The append-only attempt log (L11)
export type { ForgeAttemptOutcome, ForgeAttempt, AttemptLog } from './attempt-log';
export {
  FORGE_ATTEMPT_OUTCOMES,
  ATTEMPT_CHAIN_GENESIS,
  isForgeAttemptOutcome,
  isForgeAttempt,
  isAttemptLog,
  deriveAttemptId,
  createAttemptLog,
  forgeAttemptOf,
  appendAttempt,
  validateAttemptLog,
  serializeAttemptLog,
  parseAttemptLog,
} from './attempt-log';

// The resumable run state (serialize -> parse -> resume, chain-verified)
export type { ForgeRunState, ForgeForRunResult } from './run-state';
export {
  FORGE_RUN_STATE_SCHEMA,
  isForgeRunState,
  deriveForgeRunId,
  createForgeRunState,
  forgeForRun,
  serializeForgeRunState,
  parseForgeRunState,
  validateForgeRunState,
  resumeForgeRunState,
} from './run-state';

// The golden fixtures
export {
  fixtureParentBodyVersion,
  fixtureGaps,
  fixtureDeltas,
  fixtureForgeInput,
  fixtureUndeclaredRemovalForgeInput,
  fixtureBrokenCompatibilityForgeInput,
  fixtureForgedCandidate,
  CERTIFY_AT,
  fixtureCertificationAcceptInput,
  fixtureCertificationEvidenceMissingInput,
  fixtureCertificationCompatibilityFailInput,
} from './fixtures';

/** Service identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/body-forge',
  owner: 'T017',
  status: 'implemented',
  concepts: [
    'BodyVersionMirror',
    'forgeBodyVersion',
    'ForgedCandidate',
    'compatibility gate',
    'certification path',
    'attempt log (L11)',
    'resumable run state',
  ],
} as const;
