// @tradrl/search-lineage — branded identity references (Work Order T031).
//
// Id discipline (mirroring @tradrl/evaluation, @tradrl/experiments and the
// T028 generative lane):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T031, the search-lineage lane) are listed
//   first: the search-record and config-snapshot identity spaces.
// - The remaining OPAQUE cross-lane references mirror their owners' exact
//   brand tags (D-003/D-004): `ExperimentId`/`TrialId`/`ArmId`/
//   `SplitPolicyRef`/`EvaluatorVersionRef`/`DataRef` mirror
//   @tradrl/experiments (T011); `TenantId`/`ProjectId` mirror
//   @tradrl/domain-core (T002) and the T028 generative lane's identical
//   declarations. This package never imports those packages — it only
//   reserves the reference types here (same structural-mirror law as
//   TimestampMs, see interop.test.ts).

import { isNonEmptyString, type Brand } from './primitives';

// --- Ids owned by the search-lineage lane (T031) -----------------------------

/**
 * Identity of one SEARCH RECORD: `srch:<digest>` where the digest covers the
 * canonical binding block (experiment, evaluator, tenant, project) — the
 * record's own identity is derived, deterministic and content-bound (L9).
 */
export type SearchRecordId = Brand<string, 'TradRL.SearchRecordId'>;

/**
 * Identity of one CONTENT-ADDRESSED config snapshot:
 * `snap:<digest>` where the digest is over the canonical JSON of the stored
 * config. Two identical configs address to the SAME snapshot id — the
 * search DAG's dedupe anchor.
 */
export type ConfigSnapshotId = Brand<string, 'TradRL.ConfigSnapshotId'>;

// --- Opaque cross-lane references (referents owned by other lanes) ------------

/** Experiment identity — structural mirror of @tradrl/experiments (T011). */
export type ExperimentId = Brand<string, 'ExperimentId'>;

/** Trial identity — structural mirror of @tradrl/experiments (T011). */
export type TrialId = Brand<string, 'TrialId'>;

/** Comparison-arm identity — structural mirror of @tradrl/experiments (T011). */
export type ArmId = Brand<string, 'ArmId'>;

/**
 * Split policy reference — mirror of @tradrl/experiments (T011); referents
 * owned by @tradrl/evaluation's split-policy lane (T012) and T032's
 * evaluation-splits. A search trial's `evaluation_policy` and every entry
 * of `splits` live in this identity space.
 */
export type SplitPolicyRef = Brand<string, 'SplitPolicyRef'>;

/** Versioned evaluator reference — mirror of @tradrl/experiments (T011). */
export type EvaluatorVersionRef = Brand<string, 'EvaluatorVersionRef'>;

/** Dataset reference — structural mirror of @tradrl/experiments (T011). */
export type DataRef = Brand<string, 'DataRef'>;

/** Tenant identity — L12 (tenant isolation). Mirror of @tradrl/domain-core. */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root — L15. Mirror of @tradrl/domain-core. */
export type ProjectId = Brand<string, 'ProjectId'>;

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (see interop.test.ts). The OWNED identity spaces
// additionally carry a derivation-prefix law (`srch:` / `snap:`), so their
// guards check the prefix too — a hand-minted id that never went through the
// package's content-addressing is rejected at the runtime boundary.

export function isSearchRecordId(v: unknown): v is SearchRecordId {
  return isNonEmptyString(v) && v.startsWith('srch:');
}

export function isConfigSnapshotId(v: unknown): v is ConfigSnapshotId {
  return isNonEmptyString(v) && v.startsWith('snap:');
}

export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
export const isSplitPolicyRef = (v: unknown): v is SplitPolicyRef => isNonEmptyString(v);
export const isEvaluatorVersionRef = (v: unknown): v is EvaluatorVersionRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
