// @tradrl/benchmarks-platform — branded identity references (Work Order T049).
//
// Id discipline (the program-wide law, mirroring research/benchmarks,
// @tradrl/search-lineage, @tradrl/evaluation-splits and
// @tradrl/evaluation-integrity):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this lane (T049, the platform benchmark machinery) are
//   listed first: the capability-suite and measurement identity spaces.
//   Their prefixes (`cbms:` / `cbmm:` / `cbml:`) are derivation laws —
//   hand-minted ids that never went through this lane's content addressing
//   are rejected at the runtime boundary.
// - The remaining OPAQUE cross-lane references mirror their owners' exact
//   brand tags (D-003/D-004): `SplitPlanId` mirrors
//   @tradrl/evaluation-splits (T032); `SearchRecordId` mirrors
//   @tradrl/search-lineage (T031); `TrialId`/`ArmId`/`SplitPolicyRef`/
//   `DataRef` mirror @tradrl/experiments (T011); `EvaluatorVersionRef`
//   mirrors @tradrl/evaluation (T012); `BenchmarkResultRef` mirrors
//   research/benchmarks' `bres:` result identity (T032); `TenantId`/
//   `ProjectId` mirror @tradrl/domain-core (T002). This lane never imports
//   those packages — it only reserves the reference types here.

import { isNonEmptyString, type Brand } from './primitives';

// --- Ids owned by the platform benchmark machinery (T049) -------------------

/**
 * Identity of one CAPABILITY SUITE definition: `cbms:<digest>` over the
 * canonical suite content — content-addressed, so identical suite designs
 * address identically (L9).
 */
export type SuiteId = Brand<string, 'TradRL.SuiteId'>;

/**
 * Identity of one MEASUREMENT RECORD: `cbmm:<digest>` over the canonical
 * measurement content — the referent of T045's measured-evidence
 * `resultRef` (the benchmark lane owns this referent).
 */
export type MeasurementId = Brand<string, 'TradRL.MeasurementId'>;

/**
 * Identity of one MEASUREMENT LOG: `cbml:<digest>` over the canonical log
 * binding (tenant, project) — derived, deterministic (L9, L12).
 */
export type MeasurementLogId = Brand<string, 'TradRL.MeasurementLogId'>;

// --- Opaque cross-lane references (referents owned by other lanes) ------------

/** Split plan identity — structural mirror of @tradrl/evaluation-splits (T032). */
export type SplitPlanId = Brand<string, 'TradRL.SplitPlanId'>;

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

/** Benchmark result identity — structural mirror of research/benchmarks (T032). */
export type BenchmarkResultRef = Brand<string, 'TradRL.BenchmarkResultId'>;

/** Tenant identity — L12 (tenant isolation). Mirror of @tradrl/domain-core. */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root — L15. Mirror of @tradrl/domain-core. */
export type ProjectId = Brand<string, 'ProjectId'>;

// --- Guards -------------------------------------------------------------------

export function isSuiteId(v: unknown): v is SuiteId {
  return isNonEmptyString(v) && v.startsWith('cbms:');
}

export function isMeasurementId(v: unknown): v is MeasurementId {
  return isNonEmptyString(v) && v.startsWith('cbmm:');
}

export function isMeasurementLogId(v: unknown): v is MeasurementLogId {
  return isNonEmptyString(v) && v.startsWith('cbml:');
}

export const isSplitPlanId = (v: unknown): v is SplitPlanId => isNonEmptyString(v) && v.startsWith('splan:');
export const isSearchRecordId = (v: unknown): v is SearchRecordId => isNonEmptyString(v) && v.startsWith('srch:');
export const isConfigSnapshotId = (v: unknown): v is ConfigSnapshotId => isNonEmptyString(v) && v.startsWith('snap:');
export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
export const isSplitPolicyRef = (v: unknown): v is SplitPolicyRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isEvaluatorVersionRef = (v: unknown): v is EvaluatorVersionRef => isNonEmptyString(v);
export const isBenchmarkResultRef = (v: unknown): v is BenchmarkResultRef => isNonEmptyString(v) && v.startsWith('bres:');
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
