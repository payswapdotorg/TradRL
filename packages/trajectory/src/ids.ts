/**
 * @tradrl/trajectory — branded identities and opaque cross-lane references.
 *
 * Id discipline (mirrors `@tradrl/domain-core` / `@tradrl/environment-protocol`
 * / `@tradrl/experiments` ids.ts):
 * - Every id is an opaque non-empty string at runtime; branding is a
 *   compile-time nominal tag so distinct identity spaces are not
 *   interchangeable.
 * - Ids OWNED by this package (T011): `TrajectoryId`, `StepId`,
 *   `CausalityId`.
 * - OPAQUE cross-lane references follow the same rule: the referent entity
 *   is owned by another Work Order (T002 domain-core, T003 agent-body,
 *   T005 environment-protocol, T006 agent-os). This package never imports
 *   those packages — it only reserves the reference types here (D-003/D-004:
 *   structural mirrors + opaque branded ids, never cross-lane imports).
 *
 * Brand literals for cross-lane references deliberately match the canonical
 * owners' tags (`'EpisodeId'`, `'EnvironmentId'`, `'TenantId'`, ... — see
 * `packages/environment-protocol/src/ids.ts` and
 * `packages/experiments/src/ids.ts`) so the mirrored references stay mutually
 * assignable with the canonical ids — verified by the interop trip-wire
 * tests.
 */

import { Brand, isNonEmptyString } from './primitives';

// --- Ids owned by this package (T011 trajectory lane) -----------------------

/** Identity of a complete trajectory record. */
export type TrajectoryId = Brand<string, 'TrajectoryId'>;

/** Identity of one atomic step within a trajectory (unique within the record). */
export type StepId = Brand<string, 'StepId'>;

/**
 * Opaque grouping id for a causal chain: steps that belong to one decision
 * process (deliberation -> action -> environment response) share a causality
 * id. Its semantics are owned by the consuming runtimes; the trajectory
 * record only preserves it for lineage.
 */
export type CausalityId = Brand<string, 'CausalityId'>;

// --- Opaque cross-lane references (referents owned by other lanes) ----------

// T002 domain-core identities.
/** Project (canonical `ProjectId`). */
export type ProjectId = Brand<string, 'ProjectId'>;
/** Tenant (canonical `TenantId`). Isolation semantics owned by T044. */
export type TenantId = Brand<string, 'TenantId'>;
/** Organization (canonical `OrganizationId`). */
export type OrganizationId = Brand<string, 'OrganizationId'>;

// T003 agent-body lane references.
/** Immutable body version (canonical `BodyVersionRef`). */
export type BodyVersionRef = Brand<string, 'BodyVersionRef'>;
/** Cognitive substrate (canonical `SubstrateRef`). */
export type SubstrateRef = Brand<string, 'SubstrateRef'>;

// T005 environment-protocol identities (mirrored tags — see module header).
/** Episode executed in an environment. */
export type EpisodeId = Brand<string, 'EpisodeId'>;
/** Environment identity. */
export type EnvironmentId = Brand<string, 'EnvironmentId'>;
/** Observation identity. */
export type ObservationId = Brand<string, 'ObservationId'>;
/** Action identity. */
export type ActionId = Brand<string, 'ActionId'>;
/** Reward signal identity. */
export type RewardId = Brand<string, 'RewardId'>;
/** Environment seed. */
export type Seed = Brand<string, 'EnvironmentSeed'>;
/** World identity. */
export type WorldId = Brand<string, 'WorldId'>;
/** Venue identity. */
export type VenueId = Brand<string, 'VenueId'>;
/** Instrument identity. */
export type InstrumentId = Brand<string, 'InstrumentId'>;
/** Latency policy identity. */
export type LatencyPolicyId = Brand<string, 'LatencyPolicyId'>;
/** Fee policy identity. */
export type FeePolicyId = Brand<string, 'FeePolicyId'>;
/** Agent instance that acted (T003/T006 lanes). */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;

// T005/T006 run-lane references.
/** Environment configuration record — typically a content hash. */
export type EnvironmentConfigRef = Brand<string, 'EnvironmentConfigRef'>;
/** Runtime instance that executed the episode (environment-runner / agent-runtime). */
export type RuntimeRef = Brand<string, 'RuntimeRef'>;
/** Input dataset consumed by the run (T008 provenance lane owns referents). */
export type DataRef = Brand<string, 'DataRef'>;
/** Tool outcome recorded by the agent-os kernel (T006). */
export type ToolOutcomeRef = Brand<string, 'ToolOutcomeRef'>;
/** Environment result record of one step's effects (T005). */
export type EnvironmentResultRef = Brand<string, 'EnvironmentResultRef'>;

// --- Guards -----------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time.

export const isTrajectoryId = (v: unknown): v is TrajectoryId => isNonEmptyString(v);
export const isStepId = (v: unknown): v is StepId => isNonEmptyString(v);
export const isCausalityId = (v: unknown): v is CausalityId => isNonEmptyString(v);

export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isOrganizationId = (v: unknown): v is OrganizationId => isNonEmptyString(v);
export const isBodyVersionRef = (v: unknown): v is BodyVersionRef => isNonEmptyString(v);
export const isSubstrateRef = (v: unknown): v is SubstrateRef => isNonEmptyString(v);

export const isEpisodeId = (v: unknown): v is EpisodeId => isNonEmptyString(v);
export const isEnvironmentId = (v: unknown): v is EnvironmentId => isNonEmptyString(v);
export const isObservationId = (v: unknown): v is ObservationId => isNonEmptyString(v);
export const isActionId = (v: unknown): v is ActionId => isNonEmptyString(v);
export const isRewardId = (v: unknown): v is RewardId => isNonEmptyString(v);
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);
export const isWorldId = (v: unknown): v is WorldId => isNonEmptyString(v);
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
export const isLatencyPolicyId = (v: unknown): v is LatencyPolicyId => isNonEmptyString(v);
export const isFeePolicyId = (v: unknown): v is FeePolicyId => isNonEmptyString(v);
export const isAgentInstanceId = (v: unknown): v is AgentInstanceId => isNonEmptyString(v);

export const isEnvironmentConfigRef = (v: unknown): v is EnvironmentConfigRef => isNonEmptyString(v);
export const isRuntimeRef = (v: unknown): v is RuntimeRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isToolOutcomeRef = (v: unknown): v is ToolOutcomeRef => isNonEmptyString(v);
export const isEnvironmentResultRef = (v: unknown): v is EnvironmentResultRef => isNonEmptyString(v);
