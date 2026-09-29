// @tradrl/learning (service) — curriculum-lane branded identity references
// (Work Order T015).
//
// Id discipline (mirrors packages/rl-protocol, packages/compute,
// packages/experiments, packages/organization ids.ts):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this lane (T015) are listed first: CurriculumVersionRef,
//   CurriculumPlanId, LivePermissionRef, and (in populations/ids.ts)
//   PopulationId, AdversaryId, StrategyRef, SelectionFunctionId,
//   MatchupId, MutationOperatorRef.
// - The remaining OPAQUE cross-lane references mirror their owners' EXACT
//   brand tags the same way the sibling contract packages do:
//   ExperimentId/TrialId/ArmId/TrajectoryId/EnvironmentConfigRef/
//   EvaluatorVersionRef/SplitPolicyRef/DataRef mirror @tradrl/experiments
//   (T011); VerdictId/AcceptanceCriteriaId/CriteriaRef mirror
//   @tradrl/evaluation (T012); Seed/AgentInstanceId/RuntimeRef/
//   RewardModelRef/BodyVersionRef/SubstrateRef mirror @tradrl/rl-protocol
//   (T013); JobId/PolicyRef mirror @tradrl/compute (T014);
//   GoalRef/ConstraintSetRef/OrganizationId mirror @tradrl/control-domain
//   via the organization lane's mirrors (T007/T016);
//   CapabilityGapId/CapabilityKey/AttainmentEvidenceRef mirror
//   @tradrl/organization (T016); TenantId/ProjectId mirror
//   @tradrl/domain-core and @tradrl/agent-os (T002/T006). This lane never
//   imports those packages — it only reserves the reference types here
//   (D-003/D-004; verified by the interop trip-wire tests).

import { type Brand, isNonEmptyString } from './primitives';

// --- Ids owned by the curriculum lane (T015) ---------------------------------

/** Opaque versioned reference to a curriculum version record (the declared ladder table). */
export type CurriculumVersionRef = Brand<string, 'CurriculumVersionRef'>;

/** Identity of one curriculum plan (the ordered stage plan for one goal/seed). */
export type CurriculumPlanId = Brand<string, 'CurriculumPlanId'>;

/**
 * Opaque reference to the permission record that gates stage 9
 * (controlled_live). Live execution is PERMITTED-ONLY, never default
 * (Work Order T015 ladder law): a plan or transition scheduling
 * `controlled_live` without this record is a typed
 * `live_permission_missing` error.
 */
export type LivePermissionRef = Brand<string, 'LivePermissionRef'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

// T011 experiments-lane identities and references (mirrored brand tags).
/** Identity of one experiment: design + append-only search history. */
export type ExperimentId = Brand<string, 'ExperimentId'>;
/** Identity of one trial within an experiment. */
export type TrialId = Brand<string, 'TrialId'>;
/** Identity of one comparison arm within an experiment design. */
export type ArmId = Brand<string, 'ArmId'>;
/** Identity of a complete trajectory record. */
export type TrajectoryId = Brand<string, 'TrajectoryId'>;
/** Versioned environment configuration record ref — typically a content hash. */
export type EnvironmentConfigRef = Brand<string, 'EnvironmentConfigRef'>;
/** Opaque reference to a success-criteria definition (evaluation lane). */
export type CriteriaRef = Brand<string, 'CriteriaRef'>;
/** Opaque versioned reference to the evaluator that scores trials. */
export type EvaluatorVersionRef = Brand<string, 'EvaluatorVersionRef'>;
/** Opaque versioned reference to an evaluation split policy. */
export type SplitPolicyRef = Brand<string, 'SplitPolicyRef'>;
/** Dataset ref (provenance lane owns referents). */
export type DataRef = Brand<string, 'DataRef'>;

// T012 evaluation-lane identities (mirrored brand tags).
/** Identity of one compiled attainment verdict. */
export type VerdictId = Brand<string, 'VerdictId'>;
/** Identity of one compiled acceptance-criteria record. */
export type AcceptanceCriteriaId = Brand<string, 'AcceptanceCriteriaId'>;

// T013 rl-protocol identities (mirrored brand tags).
/** Environment seed (opaque deterministic seed; brand tag mirrors T005/T013's `Seed`). */
export type Seed = Brand<string, 'EnvironmentSeed'>;
/** Agent instance that acted (the driver's actor). */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;
/** Runtime instance that executed the episode. */
export type RuntimeRef = Brand<string, 'RuntimeRef'>;
/** Versioned reward model reference (the L7 declaration identity). */
export type RewardModelRef = Brand<string, 'RewardModelRef'>;
/** Immutable body version reference (the experience producer). */
export type BodyVersionRef = Brand<string, 'BodyVersionRef'>;
/** Cognitive substrate reference. */
export type SubstrateRef = Brand<string, 'SubstrateRef'>;

// T014 compute-lane identities (mirrored brand tags).
/** Identity of one episode-generation job: the unit of distributed work. */
export type JobId = Brand<string, 'JobId'>;
/** Opaque versioned reference to the policy script a job's workers run. */
export type PolicyRef = Brand<string, 'PolicyRef'>;

// T002 domain-core / T007 control-domain / T016 organization references
// (mirrored brand tags).
/** Tenant scope — the isolation root (L12). */
export type TenantId = Brand<string, 'TenantId'>;
/** Project continuity root (L15). */
export type ProjectId = Brand<string, 'ProjectId'>;
/** Candidate organization reference. */
export type OrganizationId = Brand<string, 'OrganizationId'>;
/** Opaque reference to a goal record — mirror of control-domain `GoalRef`. */
export type GoalRef = Brand<string, 'GoalRef'>;
/** Opaque reference to a versioned constraint-set record. */
export type ConstraintSetRef = Brand<string, 'ConstraintSetRef'>;

// T016 organization-lane references (mirrored brand tags).
/** Identity of one typed capability gap. */
export type CapabilityGapId = Brand<string, 'CapabilityGapId'>;
/** A capability CONTRACT key (identifier pattern; never a profession label — L16a). */
export type CapabilityKey = Brand<string, 'CapabilityKey'>;
/** Opaque reference to the (failure or attainment) evidence that detected a gap. */
export type AttainmentEvidenceRef = Brand<string, 'AttainmentEvidenceRef'>;
/** Opaque adversary-blueprint reference (the organization lane's blueprint records — the populations interlock). */
export type AdversaryBlueprintRef = Brand<string, 'AdversaryBlueprintRef'>;

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (the interop trip-wire tests assert mutual
// assignability with the canonical owners). The organization-lane gap
// identities (CapabilityGapId, CapabilityKey) mirror the ORGANIZATION
// guards' identifier-pattern semantics exactly, so a REAL organization gap
// record satisfies this lane's mirrors and vice versa (the runtime half of
// the drift trip wire).

/** The identifier pattern of the organization/registry lanes (mirrored). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function isIdentifierString(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

export const isCurriculumVersionRef = (v: unknown): v is CurriculumVersionRef => isNonEmptyString(v);
export const isCurriculumPlanId = (v: unknown): v is CurriculumPlanId => isNonEmptyString(v);
export const isLivePermissionRef = (v: unknown): v is LivePermissionRef => isNonEmptyString(v);
export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
export const isTrajectoryId = (v: unknown): v is TrajectoryId => isNonEmptyString(v);
export const isEnvironmentConfigRef = (v: unknown): v is EnvironmentConfigRef => isNonEmptyString(v);
export const isCriteriaRef = (v: unknown): v is CriteriaRef => isNonEmptyString(v);
export const isEvaluatorVersionRef = (v: unknown): v is EvaluatorVersionRef => isNonEmptyString(v);
export const isSplitPolicyRef = (v: unknown): v is SplitPolicyRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isVerdictId = (v: unknown): v is VerdictId => isNonEmptyString(v);
export const isAcceptanceCriteriaId = (v: unknown): v is AcceptanceCriteriaId => isNonEmptyString(v);
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);
export const isAgentInstanceId = (v: unknown): v is AgentInstanceId => isNonEmptyString(v);
export const isRuntimeRef = (v: unknown): v is RuntimeRef => isNonEmptyString(v);
export const isRewardModelRef = (v: unknown): v is RewardModelRef => isNonEmptyString(v);
export const isBodyVersionRef = (v: unknown): v is BodyVersionRef => isNonEmptyString(v);
export const isSubstrateRef = (v: unknown): v is SubstrateRef => isNonEmptyString(v);
export const isJobId = (v: unknown): v is JobId => isNonEmptyString(v);
export const isPolicyRef = (v: unknown): v is PolicyRef => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isOrganizationId = (v: unknown): v is OrganizationId => isNonEmptyString(v);
export const isGoalRef = (v: unknown): v is GoalRef => isNonEmptyString(v);
export const isConstraintSetRef = (v: unknown): v is ConstraintSetRef => isNonEmptyString(v);
export const isCapabilityGapId = (v: unknown): v is CapabilityGapId => isIdentifierString(v);
export const isCapabilityKey = (v: unknown): v is CapabilityKey => isIdentifierString(v);
export const isAttainmentEvidenceRef = (v: unknown): v is AttainmentEvidenceRef => isNonEmptyString(v);
/** Guard: `AdversaryBlueprintRef` (the organization lane's opaque-ref discipline: <= 1024 chars, no edge/control whitespace). */
export const isAdversaryBlueprintRef = (v: unknown): v is AdversaryBlueprintRef =>
  typeof v === 'string' && v.length > 0 && v.length <= 1024 && !/[\u0000-\u001f]/.test(v) && v.trim() === v;
