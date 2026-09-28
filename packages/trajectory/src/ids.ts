/**
 * @tradrl/trajectory — branded identities and opaque cross-lane references.
 *
 * Id discipline (mirrors `@tradrl/domain-core` ids.ts):
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
 * Brand literals for `ProjectRef`/`TenantRef` deliberately match the
 * domain-core reservations (`'ProjectId'`/`'TenantId'`) so the mirrored
 * references stay mutually assignable with the canonical ids — verified by
 * the interop trip-wire test.
 */

import { Brand, isNonEmptyString } from './primitives';

// --- Ids owned by this package (T011 trajectory lane) -----------------------

/** Identity of a complete trajectory record. */
export type TrajectoryId = Brand<string, 'TrajectoryId'>;

/** Identity of one atomic step within a trajectory. */
export type StepId = Brand<string, 'StepId'>;

/**
 * Opaque grouping id for a causal chain: steps that belong to one decision
 * process (deliberation -> action -> environment response) share a
 * causality id. Its semantics are owned by the consuming runtimes
 * (environment-runner T005 / agent-runtime T006); the trajectory record
 * only preserves it for lineage.
 */
export type CausalityId = Brand<string, 'CausalityId'>;

// --- Opaque cross-lane references (referents owned by other lanes) ----------

/** Project (T002 domain-core; canonical `ProjectId`). */
export type ProjectRef = Brand<string, 'ProjectId'>;
/** Tenant (T002 domain-core; canonical `TenantId`). Isolation semantics owned by T044. */
export type TenantRef = Brand<string, 'TenantId'>;
/** Episode executed in an environment (T005 environment-protocol). */
export type EpisodeRef = Brand<string, 'EpisodeRef'>;
/** Agent instance that acted (T003/T006 lanes). */
export type AgentInstanceRef = Brand<string, 'AgentInstanceRef'>;
/** Immutable body version (T003 agent-body lane). */
export type BodyVersionRef = Brand<string, 'BodyVersionRef'>;
/** Cognitive substrate (T003 agent-body lane). */
export type SubstrateRef = Brand<string, 'SubstrateRef'>;
/** Environment configuration record — typically a content hash (T005 lane). */
export type EnvironmentConfigRef = Brand<string, 'EnvironmentConfigRef'>;
/** Runtime instance that executed the episode (environment-runner / agent-runtime). */
export type RuntimeRef = Brand<string, 'RuntimeRef'>;
/** Input dataset consumed by the run (T008 provenance lane owns referents). */
export type DataRef = Brand<string, 'DataRef'>;

// --- Guards -----------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (see ids.test.ts).

export const isTrajectoryId = (v: unknown): v is TrajectoryId => isNonEmptyString(v);
export const isStepId = (v: unknown): v is StepId => isNonEmptyString(v);
export const isCausalityId = (v: unknown): v is CausalityId => isNonEmptyString(v);

export const isProjectRef = (v: unknown): v is ProjectRef => isNonEmptyString(v);
export const isTenantRef = (v: unknown): v is TenantRef => isNonEmptyString(v);
export const isEpisodeRef = (v: unknown): v is EpisodeRef => isNonEmptyString(v);
export const isAgentInstanceRef = (v: unknown): v is AgentInstanceRef => isNonEmptyString(v);
export const isBodyVersionRef = (v: unknown): v is BodyVersionRef => isNonEmptyString(v);
export const isSubstrateRef = (v: unknown): v is SubstrateRef => isNonEmptyString(v);
export const isEnvironmentConfigRef = (v: unknown): v is EnvironmentConfigRef => isNonEmptyString(v);
export const isRuntimeRef = (v: unknown): v is RuntimeRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
