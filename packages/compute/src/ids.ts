// @tradrl/compute — branded identity references.
//
// Id discipline (mirrors packages/rl-protocol, packages/trajectory,
// packages/experiments ids.ts):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T014) are listed first: JobId, WorkerRef,
//   SubmissionId, PolicyRef and ComputeRunId.
// - The remaining OPAQUE cross-lane references mirror their owners' EXACT
//   brand tags the same way the sibling contract packages do:
//   EpisodeId/Seed mirror @tradrl/environment-protocol (T005);
//   TrajectoryId/EnvironmentConfigRef/RuntimeRef/DataRef mirror
//   @tradrl/trajectory (T011); ExperimentId/TrialId/ArmId mirror
//   @tradrl/experiments (T011); RewardModelRef/AgentInstanceId/
//   BodyVersionRef/SubstrateRef mirror @tradrl/rl-protocol (T013 — the
//   trainer/driver lane this package scales); TenantId/ProjectId mirror
//   @tradrl/domain-core and @tradrl/agent-os (T002/T006). This package
//   never imports those packages — it only reserves the reference types
//   here (D-003/D-004; verified by src/interop.test.ts).

import { Brand, isNonEmptyString } from './primitives';

// --- Ids owned by compute (T014) ---------------------------------------------

/** Identity of one episode-generation job: the unit of distributed work. */
export type JobId = Brand<string, 'JobId'>;

/** Opaque identity of one compute worker (the substrate mints these). */
export type WorkerRef = Brand<string, 'WorkerRef'>;

/** Identity of one planned submission (job + worker slot partition). */
export type SubmissionId = Brand<string, 'SubmissionId'>;

/** Opaque versioned reference to the policy script a job's workers run. */
export type PolicyRef = Brand<string, 'PolicyRef'>;

/** Identity of one distributed episode-generation run (schedule + state). */
export type ComputeRunId = Brand<string, 'ComputeRunId'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

// T005 environment-protocol identities (mirrored brand tags).
/** Episode executed in an environment. */
export type EpisodeId = Brand<string, 'EpisodeId'>;
/** Environment seed (opaque deterministic seed; brand tag mirrors T005's `Seed`). */
export type Seed = Brand<string, 'EnvironmentSeed'>;

// T011 trajectory-lane identities and references (mirrored brand tags).
/** Identity of a complete trajectory record. */
export type TrajectoryId = Brand<string, 'TrajectoryId'>;
/** Versioned environment configuration record ref — typically a content hash. */
export type EnvironmentConfigRef = Brand<string, 'EnvironmentConfigRef'>;
/** Runtime instance that executed the episode (environment-runner / trainer). */
export type RuntimeRef = Brand<string, 'RuntimeRef'>;
/** Input dataset consumed by the run (T008 provenance lane owns referents). */
export type DataRef = Brand<string, 'DataRef'>;

// T011 experiments-lane identities (mirrored brand tags).
/** Identity of one experiment: design + append-only search history. */
export type ExperimentId = Brand<string, 'ExperimentId'>;
/** Identity of one trial within an experiment. */
export type TrialId = Brand<string, 'TrialId'>;
/** Identity of one comparison arm within an experiment design. */
export type ArmId = Brand<string, 'ArmId'>;

// T013 rl-protocol identities (mirrored brand tags — the lane T014 scales).
/** Versioned reward model reference (the L7 declaration identity). */
export type RewardModelRef = Brand<string, 'RewardModelRef'>;
/** Agent instance that acted (the driver's actor). */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;
/** Immutable body version reference (the experience producer). */
export type BodyVersionRef = Brand<string, 'BodyVersionRef'>;
/** Cognitive substrate reference. */
export type SubstrateRef = Brand<string, 'SubstrateRef'>;

// T002 domain-core / T006 agent-os references (mirrored brand tags).
/** Tenant scope — the isolation root (L12). */
export type TenantId = Brand<string, 'TenantId'>;
/** Project continuity root (L15). */
export type ProjectId = Brand<string, 'ProjectId'>;

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (see interop.test.ts).

export const isJobId = (v: unknown): v is JobId => isNonEmptyString(v);
export const isWorkerRef = (v: unknown): v is WorkerRef => isNonEmptyString(v);
export const isSubmissionId = (v: unknown): v is SubmissionId => isNonEmptyString(v);
export const isPolicyRef = (v: unknown): v is PolicyRef => isNonEmptyString(v);
export const isComputeRunId = (v: unknown): v is ComputeRunId => isNonEmptyString(v);

export const isEpisodeId = (v: unknown): v is EpisodeId => isNonEmptyString(v);
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);
export const isTrajectoryId = (v: unknown): v is TrajectoryId => isNonEmptyString(v);
export const isEnvironmentConfigRef = (v: unknown): v is EnvironmentConfigRef => isNonEmptyString(v);
export const isRuntimeRef = (v: unknown): v is RuntimeRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
export const isRewardModelRef = (v: unknown): v is RewardModelRef => isNonEmptyString(v);
export const isAgentInstanceId = (v: unknown): v is AgentInstanceId => isNonEmptyString(v);
export const isBodyVersionRef = (v: unknown): v is BodyVersionRef => isNonEmptyString(v);
export const isSubstrateRef = (v: unknown): v is SubstrateRef => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
