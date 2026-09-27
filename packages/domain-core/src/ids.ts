// @tradrl/domain-core — branded identity references.
//
// Id discipline:
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable (verified by type-level tests).
// - Ids OWNED by domain-core (T002) are listed first. The format of an id
//   (prefix, uuid, ulid, ...) is decided by the creating lane/service; these
//   contracts only require opaque non-empty strings.
// - OPAQUE cross-lane references follow the same rule: the referent entity
//   is owned by another Work Order (T003 agent lane, T004 market/time lane,
//   T011 experiments, T012 evidence, T019/T040 execution, T033 post-mortems,
//   T016 topology, T020 risk policy). Domain-core never imports those
//   packages — it only reserves the reference type here.

import { Brand, isNonEmptyString } from './primitives';

// --- Ids owned by domain-core (T002) ---------------------------------------

export type ProjectId = Brand<string, 'ProjectId'>;
export type GoalId = Brand<string, 'GoalId'>;
export type ConstraintSetId = Brand<string, 'ConstraintSetId'>;
export type InstrumentId = Brand<string, 'InstrumentId'>;
export type VenueId = Brand<string, 'VenueId'>;
export type OrganizationId = Brand<string, 'OrganizationId'>;
export type DecisionId = Brand<string, 'DecisionId'>;
export type OutcomeId = Brand<string, 'OutcomeId'>;
export type LessonId = Brand<string, 'LessonId'>;

/** Tenant (customer firm) identity. Isolation semantics owned by T044. */
export type TenantId = Brand<string, 'TenantId'>;

// --- Opaque cross-lane references (referents owned by other lanes) ---------

/** Agent instance (T003 agent-body lane). */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;
/** Immutable body version (T003 agent-body lane). */
export type BodyVersionId = Brand<string, 'BodyVersionId'>;
/** Risk policy record (T020 risk lane). */
export type RiskPolicyId = Brand<string, 'RiskPolicyId'>;
/** Evidence capsule (evaluation/evidence lane). */
export type EvidenceCapsuleId = Brand<string, 'EvidenceCapsuleId'>;
/** Experiment record (T011 learning lane). */
export type ExperimentId = Brand<string, 'ExperimentId'>;
/** Execution record (T019/T040 execution lanes). */
export type ExecutionId = Brand<string, 'ExecutionId'>;
/** Post-mortem record (T033 outcome-learning lane). */
export type PostMortemId = Brand<string, 'PostMortemId'>;
/** Capability gap record (learning lanes). */
export type CapabilityGapId = Brand<string, 'CapabilityGapId'>;
/** Communication topology record (T006/T016 organization lanes). */
export type TopologyId = Brand<string, 'TopologyId'>;

// --- Guards ------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (see ids.test.ts).

export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isGoalId = (v: unknown): v is GoalId => isNonEmptyString(v);
export const isConstraintSetId = (v: unknown): v is ConstraintSetId => isNonEmptyString(v);
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
export const isOrganizationId = (v: unknown): v is OrganizationId => isNonEmptyString(v);
export const isDecisionId = (v: unknown): v is DecisionId => isNonEmptyString(v);
export const isOutcomeId = (v: unknown): v is OutcomeId => isNonEmptyString(v);
export const isLessonId = (v: unknown): v is LessonId => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);

export const isAgentInstanceId = (v: unknown): v is AgentInstanceId => isNonEmptyString(v);
export const isBodyVersionId = (v: unknown): v is BodyVersionId => isNonEmptyString(v);
export const isRiskPolicyId = (v: unknown): v is RiskPolicyId => isNonEmptyString(v);
export const isEvidenceCapsuleId = (v: unknown): v is EvidenceCapsuleId => isNonEmptyString(v);
export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isExecutionId = (v: unknown): v is ExecutionId => isNonEmptyString(v);
export const isPostMortemId = (v: unknown): v is PostMortemId => isNonEmptyString(v);
export const isCapabilityGapId = (v: unknown): v is CapabilityGapId => isNonEmptyString(v);
export const isTopologyId = (v: unknown): v is TopologyId => isNonEmptyString(v);
