// @tradrl/evaluation-integrity — branded identity references (Work Order T031).
//
// Id discipline (mirroring @tradrl/evaluation, @tradrl/search-lineage and
// the T028 generative lane):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T031, the evaluation-integrity service lane)
//   are listed first: the split-registry, split-definition, quarantine and
//   selection-audit identity spaces.
// - The remaining OPAQUE cross-lane references mirror their owners' exact
//   brand tags (D-003/D-004): `SearchRecordId`/`ConfigSnapshotId` mirror
//   @tradrl/search-lineage (T031, this work order's record layer);
//   `ExperimentId`/`TrialId`/`SplitPolicyRef`/`DataRef` mirror
//   @tradrl/experiments (T011); `TenantId`/`ProjectId` mirror
//   @tradrl/domain-core (T002). This package never imports those packages —
//   it only reserves the reference types here.

import { isNonEmptyString, type Brand } from './primitives';

// --- Ids owned by the evaluation-integrity lane (T031) -----------------------

/**
 * Identity of one SPLIT REGISTRY: `sreg:<digest>` over the canonical
 * registry binding (tenant, project) — derived, deterministic (L9).
 */
export type SplitRegistryId = Brand<string, 'TradRL.SplitRegistryId'>;

/**
 * Identity of one registered SPLIT DEFINITION: `sdef:<digest>` over the
 * canonical definition content — content-addressed, so identical split
 * designs address identically.
 */
export type SplitDefinitionId = Brand<string, 'TradRL.SplitDefinitionId'>;

/**
 * Identity of one QUARANTINE record (the unseen-data declaration):
 * `qtn:<digest>` over the canonical quarantine content.
 */
export type QuarantineId = Brand<string, 'TradRL.QuarantineId'>;

/**
 * Identity of one compiled SELECTION AUDIT: `saud:<digest>` over the
 * canonical audit inputs — the audit's own identity is derived from
 * everything it judged (L9).
 */
export type SelectionAuditId = Brand<string, 'TradRL.SelectionAuditId'>;

// --- Opaque cross-lane references (referents owned by other lanes) ------------

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

/** Tenant identity — L12 (tenant isolation). Mirror of @tradrl/domain-core. */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root — L15. Mirror of @tradrl/domain-core. */
export type ProjectId = Brand<string, 'ProjectId'>;

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. The OWNED identity
// spaces additionally carry a derivation-prefix law (`sreg:` / `sdef:` /
// `qtn:` / `saud:`), so hand-minted ids that never went through this
// package's content addressing are rejected at the runtime boundary.

export function isSplitRegistryId(v: unknown): v is SplitRegistryId {
  return isNonEmptyString(v) && v.startsWith('sreg:');
}

export function isSplitDefinitionId(v: unknown): v is SplitDefinitionId {
  return isNonEmptyString(v) && v.startsWith('sdef:');
}

export function isQuarantineId(v: unknown): v is QuarantineId {
  return isNonEmptyString(v) && v.startsWith('qtn:');
}

export function isSelectionAuditId(v: unknown): v is SelectionAuditId {
  return isNonEmptyString(v) && v.startsWith('saud:');
}

export const isSearchRecordId = (v: unknown): v is SearchRecordId => isNonEmptyString(v) && v.startsWith('srch:');
export const isConfigSnapshotId = (v: unknown): v is ConfigSnapshotId => isNonEmptyString(v) && v.startsWith('snap:');
export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
export const isSplitPolicyRef = (v: unknown): v is SplitPolicyRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
