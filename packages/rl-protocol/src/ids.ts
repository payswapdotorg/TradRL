// @tradrl/rl-protocol — branded identity references.
//
// Id discipline (mirrors packages/environment-protocol, packages/trajectory
// and packages/experiments ids.ts):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T013) are listed first: TrainingRunId and the
//   RewardModelRef versioned-reference space.
// - The remaining OPAQUE cross-lane references mirror their owners' EXACT
//   brand tags the same way the sibling contract packages do:
//   EpisodeId/ObservationId/ActionId/RewardId/EnvironmentId/WorldId/Seed/
//   AgentInstanceId mirror @tradrl/environment-protocol (T005);
//   TrajectoryId/StepId/CausalityId/EnvironmentConfigRef/RuntimeRef/DataRef/
//   ToolOutcomeRef/EnvironmentResultRef mirror @tradrl/trajectory (T011);
//   ExperimentId/TrialId/ArmId mirror @tradrl/experiments (T011);
//   TenantId/ProjectId/OrganizationId/BodyVersionRef/SubstrateRef mirror
//   @tradrl/domain-core and @tradrl/agent-os (T002/T006). This package never
//   imports those packages — it only reserves the reference types here
//   (D-003/D-004; same structural-mirror law as TimestampMs, verified by
//   src/interop.test.ts).

import { Brand, isNonEmptyString } from './primitives';

// --- Ids owned by rl-protocol (T013) -----------------------------------------

/** Identity of one training run: the declaration + its append-only run state. */
export type TrainingRunId = Brand<string, 'TrainingRunId'>;

/**
 * Opaque versioned reference to a declared {@link RewardModel} — the
 * identity every bridge-emitted reward signal carries (L7: a reward signal
 * without a declared RewardModelRef is a typed error). Versioning is part of
 * the ref string itself (e.g. `reward-model:obs-count@1`), mirroring
 * `EnvironmentConfigRef`'s identity discipline.
 */
export type RewardModelRef = Brand<string, 'RewardModelRef'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

// T005 environment-protocol identities (mirrored brand tags).
/** Episode executed in an environment. */
export type EpisodeId = Brand<string, 'EpisodeId'>;
/** Observation identity. */
export type ObservationId = Brand<string, 'ObservationId'>;
/** Action (request) identity. */
export type ActionId = Brand<string, 'ActionId'>;
/** Reward signal identity. */
export type RewardId = Brand<string, 'RewardId'>;
/** Environment identity. */
export type EnvironmentId = Brand<string, 'EnvironmentId'>;
/** Environment seed (opaque deterministic seed; brand tag mirrors T005's `Seed`). */
export type Seed = Brand<string, 'EnvironmentSeed'>;
/** Agent instance that acted (T003/T006 lanes). */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;
/** World identity (T009/T010 world lanes). */
export type WorldId = Brand<string, 'WorldId'>;
/** Venue identity (T002/T004 market lanes). */
export type VenueId = Brand<string, 'VenueId'>;
/** Instrument identity (T002/T004 market lanes). */
export type InstrumentId = Brand<string, 'InstrumentId'>;
/** Latency policy reference (T010 exchange simulation lane). */
export type LatencyPolicyId = Brand<string, 'LatencyPolicyId'>;
/** Fee policy reference (T010 exchange simulation lane). */
export type FeePolicyId = Brand<string, 'FeePolicyId'>;

// T011 trajectory-lane identities and references (mirrored brand tags).
/** Identity of a complete trajectory record. */
export type TrajectoryId = Brand<string, 'TrajectoryId'>;
/** Identity of one atomic step within a trajectory (unique within the record). */
export type StepId = Brand<string, 'StepId'>;
/** Opaque grouping id of one causal chain within a trajectory. */
export type CausalityId = Brand<string, 'CausalityId'>;
/** Versioned environment configuration record ref — typically a content hash. */
export type EnvironmentConfigRef = Brand<string, 'EnvironmentConfigRef'>;
/** Runtime instance that executed the episode (environment-runner / trainer). */
export type RuntimeRef = Brand<string, 'RuntimeRef'>;
/** Input dataset consumed by the run (T008 provenance lane owns referents). */
export type DataRef = Brand<string, 'DataRef'>;
/** Tool outcome recorded by the agent-os kernel (T006). */
export type ToolOutcomeRef = Brand<string, 'ToolOutcomeRef'>;
/** Environment result record of one step's effects (T005). */
export type EnvironmentResultRef = Brand<string, 'EnvironmentResultRef'>;

// T011 experiments-lane identities (mirrored brand tags).
/** Identity of one experiment: design + append-only search history. */
export type ExperimentId = Brand<string, 'ExperimentId'>;
/** Identity of one trial within an experiment. */
export type TrialId = Brand<string, 'TrialId'>;
/** Identity of one comparison arm within an experiment design. */
export type ArmId = Brand<string, 'ArmId'>;

// T002 domain-core / T006 agent-os references (mirrored brand tags).
/** Tenant scope — the isolation root (L12). */
export type TenantId = Brand<string, 'TenantId'>;
/** Project continuity root (L15). */
export type ProjectId = Brand<string, 'ProjectId'>;
/** Organization identity. */
export type OrganizationId = Brand<string, 'OrganizationId'>;
/** Immutable body version reference. */
export type BodyVersionRef = Brand<string, 'BodyVersionRef'>;
/** Cognitive substrate reference. */
export type SubstrateRef = Brand<string, 'SubstrateRef'>;

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (see interop.test.ts).

export const isTrainingRunId = (v: unknown): v is TrainingRunId => isNonEmptyString(v);
export const isRewardModelRef = (v: unknown): v is RewardModelRef => isNonEmptyString(v);

export const isEpisodeId = (v: unknown): v is EpisodeId => isNonEmptyString(v);
export const isObservationId = (v: unknown): v is ObservationId => isNonEmptyString(v);
export const isActionId = (v: unknown): v is ActionId => isNonEmptyString(v);
export const isRewardId = (v: unknown): v is RewardId => isNonEmptyString(v);
export const isEnvironmentId = (v: unknown): v is EnvironmentId => isNonEmptyString(v);
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);
export const isAgentInstanceId = (v: unknown): v is AgentInstanceId => isNonEmptyString(v);
export const isWorldId = (v: unknown): v is WorldId => isNonEmptyString(v);
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
export const isLatencyPolicyId = (v: unknown): v is LatencyPolicyId => isNonEmptyString(v);
export const isFeePolicyId = (v: unknown): v is FeePolicyId => isNonEmptyString(v);

export const isTrajectoryId = (v: unknown): v is TrajectoryId => isNonEmptyString(v);
export const isStepId = (v: unknown): v is StepId => isNonEmptyString(v);
export const isCausalityId = (v: unknown): v is CausalityId => isNonEmptyString(v);
export const isEnvironmentConfigRef = (v: unknown): v is EnvironmentConfigRef => isNonEmptyString(v);
export const isRuntimeRef = (v: unknown): v is RuntimeRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isToolOutcomeRef = (v: unknown): v is ToolOutcomeRef => isNonEmptyString(v);
export const isEnvironmentResultRef = (v: unknown): v is EnvironmentResultRef => isNonEmptyString(v);

export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);

export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isOrganizationId = (v: unknown): v is OrganizationId => isNonEmptyString(v);
export const isBodyVersionRef = (v: unknown): v is BodyVersionRef => isNonEmptyString(v);
export const isSubstrateRef = (v: unknown): v is SubstrateRef => isNonEmptyString(v);
