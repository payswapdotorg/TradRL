// @tradrl/experiments — branded identity references.
//
// Id discipline:
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T011) are listed first: TrialId, plus the
//   opaque reference spaces this package mints (ArmId, CriteriaRef,
//   EvaluatorVersionRef, SplitPolicyRef).
// - `ExperimentId` mirrors the EXACT brand tag @tradrl/domain-core (T002)
//   already reserves for "experiment record (T011 learning lane)" — the two
//   declarations stay mutually assignable without a package dependency.
// - The remaining OPAQUE cross-lane references mirror their owners' exact
//   tags the same way: TrajectoryId / EnvironmentConfigRef / DataRef mirror
//   @tradrl/trajectory (T011); GoalId / ProjectId / TenantId /
//   OrganizationId mirror @tradrl/domain-core (T002); BodyVersionRef /
//   SubstrateRef mirror @tradrl/agent-os (T006). This package never imports
//   those packages — it only reserves the reference types here (D-003/D-004;
//   same structural-mirror law as TimestampMs, see interop.test.ts).

import { Brand, isNonEmptyString } from './primitives';

// --- Ids owned by experiments (T011) ------------------------------------------

/** Identity of one experiment: design + append-only search history. */
export type ExperimentId = Brand<string, 'ExperimentId'>;

/** Identity of one trial within an experiment (unique per experiment). */
export type TrialId = Brand<string, 'TrialId'>;

/** Identity of one comparison arm within an experiment design. */
export type ArmId = Brand<string, 'ArmId'>;

/** Opaque reference to a success-criteria definition (evaluation lane, T012). */
export type CriteriaRef = Brand<string, 'CriteriaRef'>;

/** Opaque versioned reference to the evaluator that scores this experiment's trials (T012). */
export type EvaluatorVersionRef = Brand<string, 'EvaluatorVersionRef'>;

/** Opaque versioned reference to an evaluation split policy (T012/T032 lanes). */
export type SplitPolicyRef = Brand<string, 'SplitPolicyRef'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

/** Trajectory identity — structural mirror of @tradrl/trajectory (T011). */
export type TrajectoryId = Brand<string, 'TrajectoryId'>;

/** Versioned environment configuration ref — mirror of @tradrl/trajectory (T011). */
export type EnvironmentConfigRef = Brand<string, 'EnvironmentConfigRef'>;

/** Dataset ref — mirror of @tradrl/trajectory (T011). */
export type DataRef = Brand<string, 'DataRef'>;

/** Goal reference — mirror of @tradrl/domain-core's GoalId brand (T002). */
export type GoalId = Brand<string, 'GoalId'>;

/** Project reference — mirror of @tradrl/domain-core's ProjectId brand (T002). */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Tenant scope (L12) — mirror of @tradrl/domain-core's TenantId brand (T002). */
export type TenantId = Brand<string, 'TenantId'>;

/** Candidate organization reference — mirror of @tradrl/domain-core's OrganizationId brand (T002). */
export type OrganizationId = Brand<string, 'OrganizationId'>;

/** Immutable body version reference — structural mirror of @tradrl/agent-os (T006). */
export type BodyVersionRef = Brand<string, 'BodyVersionRef'>;

/** Cognitive substrate reference — structural mirror of @tradrl/agent-os (T006). */
export type SubstrateRef = Brand<string, 'SubstrateRef'>;

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (see ids.test.ts).

export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
export const isCriteriaRef = (v: unknown): v is CriteriaRef => isNonEmptyString(v);
export const isEvaluatorVersionRef = (v: unknown): v is EvaluatorVersionRef => isNonEmptyString(v);
export const isSplitPolicyRef = (v: unknown): v is SplitPolicyRef => isNonEmptyString(v);
export const isTrajectoryId = (v: unknown): v is TrajectoryId => isNonEmptyString(v);
export const isEnvironmentConfigRef = (v: unknown): v is EnvironmentConfigRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isGoalId = (v: unknown): v is GoalId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isOrganizationId = (v: unknown): v is OrganizationId => isNonEmptyString(v);
export const isBodyVersionRef = (v: unknown): v is BodyVersionRef => isNonEmptyString(v);
export const isSubstrateRef = (v: unknown): v is SubstrateRef => isNonEmptyString(v);
