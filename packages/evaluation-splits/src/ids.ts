// @tradrl/evaluation-splits — branded identity references (Work Order T032).
//
// Id discipline (mirroring @tradrl/evaluation, @tradrl/search-lineage and
// @tradrl/evaluation-integrity):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T032, the split-driver lane) are listed
//   first: the split-plan and split-plan-ledger identity spaces.
// - The remaining OPAQUE cross-lane references mirror their owners' exact
//   brand tags (D-003/D-004): `SplitPolicyRef`/`DataRef`/`ExperimentId`
//   mirror @tradrl/experiments (T011); `EvaluatorVersionRef` mirrors
//   @tradrl/evaluation (T012); `TenantId`/`ProjectId` mirror
//   @tradrl/domain-core (T002). This package never imports those packages —
//   it only reserves the reference types here.

import { isNonEmptyString, type Brand } from './primitives';

// --- Ids owned by the evaluation-splits lane (T032) -------------------------

/**
 * Identity of one materialized SPLIT PLAN: `splan:<digest>` over the
 * canonical plan content — content-addressed, so identical (axis, policy)
 * derivations address identically (L9 + the Work Order's determinism law).
 */
export type SplitPlanId = Brand<string, 'TradRL.SplitPlanId'>;

/**
 * Identity of one SPLIT PLAN LEDGER: `splr:<digest>` over the canonical
 * ledger binding (tenant, project) — derived, deterministic (L9, L12).
 */
export type SplitPlanLedgerId = Brand<string, 'TradRL.SplitPlanLedgerId'>;

// --- Opaque cross-lane references (referents owned by other lanes) ------------

/** Split policy reference — mirror of @tradrl/experiments (T011); referents owned by T012/T032. */
export type SplitPolicyRef = Brand<string, 'SplitPolicyRef'>;

/** Dataset reference — structural mirror of @tradrl/experiments (T011). */
export type DataRef = Brand<string, 'DataRef'>;

/** Experiment identity — structural mirror of @tradrl/experiments (T011). */
export type ExperimentId = Brand<string, 'ExperimentId'>;

/** Versioned evaluator reference — structural mirror of @tradrl/evaluation (T012). */
export type EvaluatorVersionRef = Brand<string, 'EvaluatorVersionRef'>;

/** Tenant identity — L12 (tenant isolation). Mirror of @tradrl/domain-core. */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root — L15. Mirror of @tradrl/domain-core. */
export type ProjectId = Brand<string, 'ProjectId'>;

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. The OWNED identity
// spaces additionally carry a derivation-prefix law (`splan:` / `splr:`),
// so hand-minted ids that never went through this package's content
// addressing are rejected at the runtime boundary.

export function isSplitPlanId(v: unknown): v is SplitPlanId {
  return isNonEmptyString(v) && v.startsWith('splan:');
}

export function isSplitPlanLedgerId(v: unknown): v is SplitPlanLedgerId {
  return isNonEmptyString(v) && v.startsWith('splr:');
}

export const isSplitPolicyRef = (v: unknown): v is SplitPolicyRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isEvaluatorVersionRef = (v: unknown): v is EvaluatorVersionRef => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
