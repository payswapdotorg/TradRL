// @tradrl/research-public-evaluation — branded identity references (Work Order T049).
//
// Id discipline (the program-wide law): every id is an opaque non-empty
// string at runtime; branding is a compile-time nominal tag so distinct
// identity spaces are not interchangeable. Ids OWNED by this package are
// the published-record and publication-log identity spaces; their
// prefixes (`pev:` / `pevl:`) are derivation laws — hand-minted ids that
// never went through this package's content addressing are rejected at
// the runtime boundary. The OPAQUE cross-lane references mirror their
// owners' exact brand tags (D-003/D-004): the benchmark machinery's
// `cbms:`/`cbmm:` suites and measurements (the own-lane import surface),
// `splan:` split plans (T032), `srch:` search records (T031), and the
// domain `TenantId`/`ProjectId` (T002).

import { isNonEmptyString, type Brand } from './primitives';

// --- Ids owned by the publication layer (T049) -------------------------------

/**
 * Identity of one PUBLISHED EVALUATION RECORD: `pev:<digest>` over the
 * canonical publication content — content-addressed, so identical
 * publications address identically (L9), and a mutated field breaks the
 * address.
 */
export type PublishedRecordId = Brand<string, 'TradRL.PublishedRecordId'>;

/**
 * Identity of one PUBLICATION LOG: `pevl:<digest>` over the canonical log
 * binding (tenant, project) — derived, deterministic (L9, L12).
 */
export type PublicationLogId = Brand<string, 'TradRL.PublicationLogId'>;

// --- Opaque cross-lane references (referents owned by other lanes) ------------

/** Suite identity — the benchmark machinery's owned identity space (benchmarks/platform). */
export type SuiteRef = Brand<string, 'TradRL.SuiteId'>;

/** Measurement identity — the benchmark machinery's owned identity space (benchmarks/platform). */
export type MeasurementRef = Brand<string, 'TradRL.MeasurementId'>;

/** Split plan identity — structural mirror of @tradrl/evaluation-splits (T032). */
export type SplitPlanRef = Brand<string, 'TradRL.SplitPlanId'>;

/** Search record identity — structural mirror of @tradrl/search-lineage (T031). */
export type SearchRecordRef = Brand<string, 'TradRL.SearchRecordId'>;

/** Versioned evaluator reference — structural mirror of @tradrl/evaluation (T012). */
export type EvaluatorVersionRef = Brand<string, 'EvaluatorVersionRef'>;

/** Tenant identity — L12 (tenant isolation). Mirror of @tradrl/domain-core. */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root — L15. Mirror of @tradrl/domain-core. */
export type ProjectId = Brand<string, 'ProjectId'>;

// --- Guards -------------------------------------------------------------------

export function isPublishedRecordId(v: unknown): v is PublishedRecordId {
  return isNonEmptyString(v) && v.startsWith('pev:');
}

export function isPublicationLogId(v: unknown): v is PublicationLogId {
  return isNonEmptyString(v) && v.startsWith('pevl:');
}

export const isSuiteRef = (v: unknown): v is SuiteRef => isNonEmptyString(v) && v.startsWith('cbms:');
export const isMeasurementRef = (v: unknown): v is MeasurementRef => isNonEmptyString(v) && v.startsWith('cbmm:');
export const isSplitPlanRef = (v: unknown): v is SplitPlanRef => isNonEmptyString(v) && v.startsWith('splan:');
export const isSearchRecordRef = (v: unknown): v is SearchRecordRef => isNonEmptyString(v) && v.startsWith('srch:');
export const isEvaluatorVersionRef = (v: unknown): v is EvaluatorVersionRef => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
