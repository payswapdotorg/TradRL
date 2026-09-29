// @tradrl/learning (service) — populations-lane branded identity references
// (Work Order T015).
//
// Id discipline (mirrors the curriculum lane's ids.ts and the contract
// packages): every id is an opaque non-empty string at runtime; branding
// is a compile-time nominal tag so distinct identity spaces are not
// interchangeable.
//
// Ids OWNED by this lane (T015 populations): PopulationId, AdversaryId,
// StrategyRef, SelectionFunctionId, MutationOperatorId, MatchupId,
// PopulationGeneration (a branded count).
//
// The OPAQUE cross-lane references (AdversaryBlueprintRef, GoalRef,
// OrganizationId, TenantId, ProjectId, Seed, EnvironmentConfigRef, ...)
// are re-exported from the curriculum lane's mirror declarations — ONE
// mirror set per service (the populations lane and the curriculum lane
// share the service's identity spaces by construction; the interop
// trip-wire tests assert the parity with the canonical owner packages).

import { type Brand, isNonEmptyString } from '../curriculum/primitives';

// --- Ids owned by the populations lane (T015) --------------------------------

/** Identity of one adversarial population (the lineage anchor of its generations). */
export type PopulationId = Brand<string, 'PopulationId'>;

/** Identity of one adversary within a population (unique across the population's history). */
export type AdversaryId = Brand<string, 'AdversaryId'>;

/** Opaque versioned reference to an adversary strategy/policy script. */
export type StrategyRef = Brand<string, 'StrategyRef'>;

/** Identity of one DECLARED selection function record (versioned; no hidden fitness). */
export type SelectionFunctionId = Brand<string, 'SelectionFunctionId'>;

/** Identity of one DECLARED mutation operator record (versioned). */
export type MutationOperatorId = Brand<string, 'MutationOperatorId'>;

/** Identity of one self-play matchup (candidate vs adversary set). */
export type MatchupId = Brand<string, 'MatchupId'>;

// --- Opaque cross-lane references (re-exported from the service's mirrors) ---

export type {
  AdversaryBlueprintRef,
  AgentInstanceId,
  ArmId,
  BodyVersionRef,
  CurriculumVersionRef,
  DataRef,
  EnvironmentConfigRef,
  EvaluatorVersionRef,
  ExperimentId,
  GoalRef,
  JobId,
  OrganizationId,
  PolicyRef,
  ProjectId,
  RewardModelRef,
  RuntimeRef,
  Seed,
  SplitPolicyRef,
  SubstrateRef,
  TenantId,
  TrialId,
} from '../curriculum/ids';
export type { CurriculumStageKind } from '../curriculum/ladder';

export {
  isAdversaryBlueprintRef,
  isAgentInstanceId,
  isArmId,
  isBodyVersionRef,
  isCurriculumVersionRef,
  isDataRef,
  isEnvironmentConfigRef,
  isEvaluatorVersionRef,
  isExperimentId,
  isGoalRef,
  isJobId,
  isOrganizationId,
  isPolicyRef,
  isProjectId,
  isRewardModelRef,
  isRuntimeRef,
  isSeed,
  isSplitPolicyRef,
  isSubstrateRef,
  isTenantId,
  isTrialId,
} from '../curriculum/ids';
export { isCurriculumStageKind } from '../curriculum/ladder';

// The AdversaryBlueprintRef mirror (the organization lane's brand tag,
// T016 — the blueprint refs adversaries cite; see population.ts).
import type { AdversaryBlueprintRef } from '../curriculum/ids';
export type { AdversaryBlueprintRef as PopulationBlueprintRefAlias };

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (the interop trip-wire tests assert mutual
// assignability with the canonical owners).

export const isPopulationId = (v: unknown): v is PopulationId => isNonEmptyString(v);
export const isAdversaryId = (v: unknown): v is AdversaryId => isNonEmptyString(v);
export const isStrategyRef = (v: unknown): v is StrategyRef => isNonEmptyString(v);
export const isSelectionFunctionId = (v: unknown): v is SelectionFunctionId => isNonEmptyString(v);
export const isMutationOperatorId = (v: unknown): v is MutationOperatorId => isNonEmptyString(v);
export const isMatchupId = (v: unknown): v is MatchupId => isNonEmptyString(v);

/** Blueprint-ref guard re-export (the organization lane's opaque-ref discipline). */
export const isBlueprintRef = (v: unknown): v is AdversaryBlueprintRef => isNonEmptyString(v);
