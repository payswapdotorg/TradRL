// @tradrl/body-fundamental-researcher — the typed error taxonomy.
//
// Owning Work Order: T023.
//
// Two disciplines (mirroring @tradrl/provenance and @tradrl/skills):
// - COLLECT-ALL validation (`FundamentalValidation<T>` with `errors:
//   FundamentalError[]`) for record validation — every violation is
//   reported, nothing is silently dropped, and untrusted input NEVER
//   throws;
// - SINGLE typed failure (`FundamentalResult<T>`) for operations that
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
//                         report_composition_mismatch
//   - L12 tenant:        tenant_missing, project_missing
//   - L16a suitability:  model_identity_as_evidence
//   - method honesty:    undeclared_method, method_version_mismatch,
//                         method_kind_mismatch, method_kind_missing,
//                         assessment_kind_mismatch, duplicate_method,
//                         method_registry_empty
//   - assessment laws:   stance_direction_mismatch, implication_mismatch
//   - provenance (T008 mirror): provenance_adapter_required,
//                         provenance_transform_required,
//                         provenance_transform_without_parents,
//                         provenance_self_reference, provenance_duplicate_parent
//   - publication:       unstructured_publication
//   - structural:        invalid_type, missing_field, invalid_field,
//                         unknown_event_type, unknown_asset_class,
//                         unknown_assessment_kind, unknown_action_kind,
//                         unknown_stance_direction, decimal_invalid,
//                         schema_version_mismatch, run_config_mismatch

/** The closed vocabulary of typed fundamental-research errors. */
export const FUNDAMENTAL_ERROR_CODES = [
  // structural
  'invalid_type',
  'missing_field',
  'invalid_field',
  'unknown_event_type',
  'unknown_asset_class',
  'unknown_assessment_kind',
  'unknown_action_kind',
  'unknown_stance_direction',
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
  'assessment_kind_mismatch',
  'duplicate_method',
  'method_registry_empty',
  // assessment laws (declared decision functions)
  'stance_direction_mismatch',
  'implication_mismatch',
  // provenance block (T008 mirror)
  'provenance_adapter_required',
  'provenance_transform_required',
  'provenance_transform_without_parents',
  'provenance_self_reference',
  'provenance_duplicate_parent',
  // publication discipline
  'unstructured_publication',
] as const;

/** A typed fundamental-research error code. */
export type FundamentalErrorCode = (typeof FUNDAMENTAL_ERROR_CODES)[number];

/** A typed research error: code + dotted path + human-readable message. */
export interface FundamentalError {
  readonly code: FundamentalErrorCode;
  /** Dotted path from the offending record's root (`` = whole record). */
  readonly path: string;
  readonly message: string;
}

/**
 * COLLECT-ALL validation outcome: every violation of every law, or `ok`.
 * Untrusted input never throws — refusal is data.
 */
export interface FundamentalValidation<T> {
  readonly ok: boolean;
  readonly value: T | null;
  readonly errors: readonly FundamentalError[];
}

/** SINGLE typed failure outcome for operations with one refusal mode. */
export type FundamentalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly FundamentalError[] };

/** Builds an `ok` single-outcome result. */
export function ok<T>(value: T): FundamentalResult<T> {
  return { ok: true, value };
}

/** Builds a single typed failure. */
export function fail<T = never>(code: FundamentalErrorCode, message: string, path = ''): FundamentalResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

/** Builds a single typed failure from a prepared error list. */
export function failWith<T = never>(errors: readonly FundamentalError[]): FundamentalResult<T> {
  return { ok: false, errors: [...errors] };
}

/** Error constructor: a missing required field. */
export function missingField(path: string): FundamentalError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** Error constructor: an invalid field. */
export function invalidField(path: string, message: string): FundamentalError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** Error constructor: a wrong-typed record. */
export function invalidType(path: string, expected: string): FundamentalError {
  return { code: 'invalid_type', path, message: `field "${path}" must be ${expected}` };
}

/** Collects validation errors into a `FundamentalValidation` for a value. */
export function validationOf<T>(
  value: T | null,
  errors: readonly FundamentalError[],
): FundamentalValidation<T> {
  return errors.length === 0
    ? { ok: true, value, errors: [] }
    : { ok: false, value: null, errors: [...errors] };
}
