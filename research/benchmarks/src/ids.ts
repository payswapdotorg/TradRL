// @tradrl/research-benchmarks — branded identity references (Work Order T032).
//
// Id discipline (mirroring @tradrl/evaluation, @tradrl/search-lineage,
// @tradrl/evaluation-splits and @tradrl/evaluation-integrity):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T032, the research-benchmarks suite lane)
//   are listed first: the benchmark, manifest, result and result-log
//   identity spaces.
// - The remaining OPAQUE cross-lane references mirror their owners' exact
//   brand tags (D-003/D-004): `SplitPlanId`/`SplitPlanLedgerId` mirror
//   @tradrl/evaluation-splits (T032, this work order's driver lane);
//   `SearchRecordId`/`ConfigSnapshotId` mirror @tradrl/search-lineage and
//   its evaluation-integrity re-declaration (T031);
//   `ExperimentId`/`TrialId`/`ArmId`/`SplitPolicyRef`/`DataRef` mirror
//   @tradrl/experiments (T011); `EvaluatorVersionRef` mirrors
//   @tradrl/evaluation (T012); `TenantId`/`ProjectId` mirror
//   @tradrl/domain-core (T002). This package never imports those packages
//   — it only reserves the reference types here.

import { isNonEmptyString, type Brand } from './primitives';

// --- Ids owned by the research-benchmarks lane (T032) -----------------------

/**
 * Identity of one BENCHMARK DEFINITION: `bmk:<digest>` over the canonical
 * definition content — content-addressed, so identical benchmark designs
 * address identically (L9).
 */
export type BenchmarkId = Brand<string, 'TradRL.BenchmarkId'>;

/**
 * Identity of one compiled BENCHMARK MANIFEST: `bmfm:<digest>` over the
 * canonical manifest content — the manifest's identity is derived from
 * everything it binds (L9/L15).
 */
export type BenchmarkManifestId = Brand<string, 'TradRL.BenchmarkManifestId'>;

/**
 * Identity of one BENCHMARK RESULT RECORD: `bres:<digest>` over the
 * canonical result content — content-addressed (L9).
 */
export type BenchmarkResultId = Brand<string, 'TradRL.BenchmarkResultId'>;

/**
 * Identity of one BENCHMARK RESULT LOG: `brlog:<digest>` over the canonical
 * log binding (tenant, project) — derived, deterministic (L9, L12).
 */
export type ResultLogId = Brand<string, 'TradRL.ResultLogId'>;

// --- Opaque cross-lane references (referents owned by other lanes) ------------

/** Split plan identity — structural mirror of @tradrl/evaluation-splits (T032). */
export type SplitPlanId = Brand<string, 'TradRL.SplitPlanId'>;

/** Split plan ledger identity — structural mirror of @tradrl/evaluation-splits (T032). */
export type SplitPlanLedgerId = Brand<string, 'TradRL.SplitPlanLedgerId'>;

/** Search record identity — structural mirror of @tradrl/search-lineage (T031). */
export type SearchRecordId = Brand<string, 'TradRL.SearchRecordId'>;

/** Config snapshot identity — structural mirror of @tradrl/search-lineage (T031). */
export type ConfigSnapshotId = Brand<string, 'TradRL.ConfigSnapshotId'>;

/** Experiment identity — structural mirror of @tradrl/experiments (T011). */
export type ExperimentId = Brand<string, 'ExperimentId'>;

/** Trial identity — structural mirror of @tradrl/experiments (T011). */
export type TrialId = Brand<string, 'TrialId'>;

/** Comparison-arm identity — structural mirror of @tradrl/experiments (T011). */
export type ArmId = Brand<string, 'ArmId'>;

/** Split policy reference — mirror of @tradrl/experiments (T011); referents owned by T012/T032. */
export type SplitPolicyRef = Brand<string, 'SplitPolicyRef'>;

/** Dataset reference — structural mirror of @tradrl/experiments (T011). */
export type DataRef = Brand<string, 'DataRef'>;

/** Versioned evaluator reference — structural mirror of @tradrl/evaluation (T012). */
export type EvaluatorVersionRef = Brand<string, 'EvaluatorVersionRef'>;

/** Tenant identity — L12 (tenant isolation). Mirror of @tradrl/domain-core. */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root — L15. Mirror of @tradrl/domain-core. */
export type ProjectId = Brand<string, 'ProjectId'>;

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. The OWNED identity
// spaces additionally carry a derivation-prefix law (`bmk:` / `bmfm:` /
// `bres:` / `brlog:`), so hand-minted ids that never went through this
// package's content addressing are rejected at the runtime boundary.

export function isBenchmarkId(v: unknown): v is BenchmarkId {
  return isNonEmptyString(v) && v.startsWith('bmk:');
}

export function isBenchmarkManifestId(v: unknown): v is BenchmarkManifestId {
  return isNonEmptyString(v) && v.startsWith('bmfm:');
}

export function isBenchmarkResultId(v: unknown): v is BenchmarkResultId {
  return isNonEmptyString(v) && v.startsWith('bres:');
}

export function isResultLogId(v: unknown): v is ResultLogId {
  return isNonEmptyString(v) && v.startsWith('brlog:');
}

export const isSplitPlanId = (v: unknown): v is SplitPlanId => isNonEmptyString(v) && v.startsWith('splan:');
export const isSplitPlanLedgerId = (v: unknown): v is SplitPlanLedgerId => isNonEmptyString(v) && v.startsWith('splr:');
export const isSearchRecordId = (v: unknown): v is SearchRecordId => isNonEmptyString(v) && v.startsWith('srch:');
export const isConfigSnapshotId = (v: unknown): v is ConfigSnapshotId => isNonEmptyString(v) && v.startsWith('snap:');
export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
export const isSplitPolicyRef = (v: unknown): v is SplitPolicyRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isEvaluatorVersionRef = (v: unknown): v is EvaluatorVersionRef => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
