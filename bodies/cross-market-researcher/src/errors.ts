// @tradrl/body-cross-market-researcher — the typed error taxonomy.
//
// Owning Work Order: T023.
//
// Two disciplines (mirroring @tradrl/provenance and @tradrl/skills):
// - COLLECT-ALL validation (`CrossMarketValidation<T>` with `errors:
//   CrossMarketError[]`) for record validation — every violation is
//   reported, nothing is silently dropped, and untrusted input NEVER
//   throws;
// - SINGLE typed failure (`CrossMarketResult<T>`) for operations that
//   produce exactly one outcome or one refusal.
//
// Error codes are a CLOSED union; each family cites its law:
//   - L4 point-in-time:  future_observation, future_evidence,
//                         timestamp_order, as_of_mismatch
//   - L8 read-only:      execution_authority_granted, execute_not_prohibited,
//                         consequential_tool_in_procedure,
//                         forbidden_tool_in_procedure, non_research_capability,
//                         reserved_publication_topic
//   - L9 lineage:        evidence_missing, lineage_missing, digest_mismatch,
//                         chain_mismatch, duplicate_observation_ref,
//                         report_composition_mismatch, leg_coverage_missing
//   - L12 tenant:        tenant_missing, project_missing
//   - L16a suitability:  model_identity_as_evidence
//   - method honesty:    undeclared_method, method_version_mismatch,
//                         method_kind_mismatch, method_kind_missing,
//                         relationship_kind_mismatch, duplicate_method,
//                         method_registry_empty
//   - relationship laws: relationship_direction_mismatch,
//                         direction_measure_mismatch, pair_not_distinct
//   - provenance (T008 mirror): provenance_adapter_required,
//                         provenance_transform_required,
//                         provenance_transform_without_parents,
//                         provenance_self_reference, provenance_duplicate_parent
//   - publication:       unstructured_publication
//   - structural:        invalid_type, missing_field, invalid_field,
//                         unknown_event_type, unknown_asset_class,
//                         unknown_relation_kind, unknown_relationship_direction,
//                         decimal_invalid, schema_version_mismatch,
//                         run_config_mismatch

/** The closed vocabulary of typed cross-market research errors. */
export const CROSS_MARKET_ERROR_CODES = [
  // structural
  'invalid_type',
  'missing_field',
  'invalid_field',
  'unknown_event_type',
  'unknown_asset_class',
  'unknown_relation_kind',
  'unknown_relationship_direction',
  'decimal_invalid',
  'schema_version_mismatch',
  'run_config_mismatch',
  // L4 point-in-time
  'future_observation',
  'future_evidence',
  'timestamp_order',
  'as_of_mismatch',
  // L8 read-only authority
  'execution_authority_granted',
  'execute_not_prohibited',
  'consequential_tool_in_procedure',
  'forbidden_tool_in_procedure',
  'non_research_capability',
  'reserved_publication_topic',
  // L9 lineage
  'evidence_missing',
  'lineage_missing',
  'digest_mismatch',
  'chain_mismatch',
  'duplicate_observation_ref',
  'report_composition_mismatch',
  'leg_coverage_missing',
  // L12 tenant isolation
  'tenant_missing',
  'project_missing',
  // L16a labels never establish suitability
  'model_identity_as_evidence',
  // method honesty
  'undeclared_method',
  'method_version_mismatch',
  'method_kind_mismatch',
  'method_kind_missing',
  'relationship_kind_mismatch',
  'duplicate_method',
  'method_registry_empty',
  // relationship laws (declared decision functions + the pair law)
  'relationship_direction_mismatch',
  'direction_measure_mismatch',
  'pair_not_distinct',
  // provenance block (T008 mirror)
  'provenance_adapter_required',
  'provenance_transform_required',
  'provenance_transform_without_parents',
  'provenance_self_reference',
  'provenance_duplicate_parent',
  // publication discipline
  'unstructured_publication',
] as const;

/** A typed cross-market research error code. */
export type CrossMarketErrorCode = (typeof CROSS_MARKET_ERROR_CODES)[number];

/** A typed research error: code + dotted path + human-readable message. */
export interface CrossMarketError {
  readonly code: CrossMarketErrorCode;
  /** Dotted path from the offending record's root (`` = whole record). */
  readonly path: string;
  readonly message: string;
}

/**
 * COLLECT-ALL validation outcome: every violation of every law, or `ok`.
 * Untrusted input never throws — refusal is data.
 */
export interface CrossMarketValidation<T> {
  readonly ok: boolean;
  readonly value: T | null;
  readonly errors: readonly CrossMarketError[];
}

/** SINGLE typed failure outcome for operations with one refusal mode. */
export type CrossMarketResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly CrossMarketError[] };

/** Builds an `ok` single-outcome result. */
export function ok<T>(value: T): CrossMarketResult<T> {
  return { ok: true, value };
}

/** Builds a single typed failure. */
export function fail<T = never>(code: CrossMarketErrorCode, message: string, path = ''): CrossMarketResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

/** Builds a single typed failure from a prepared error list. */
export function failWith<T = never>(errors: readonly CrossMarketError[]): CrossMarketResult<T> {
  return { ok: false, errors: [...errors] };
}

/** Error constructor: a missing required field. */
export function missingField(path: string): CrossMarketError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** Error constructor: an invalid field. */
export function invalidField(path: string, message: string): CrossMarketError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** Error constructor: a wrong-typed record. */
export function invalidType(path: string, expected: string): CrossMarketError {
  return { code: 'invalid_type', path, message: `field "${path}" must be ${expected}` };
}

/** Collects validation errors into a `CrossMarketValidation` for a value. */
export function validationOf<T>(
  value: T | null,
  errors: readonly CrossMarketError[],
): CrossMarketValidation<T> {
  return errors.length === 0
    ? { ok: true, value, errors: [] }
    : { ok: false, value: null, errors: [...errors] };
}
