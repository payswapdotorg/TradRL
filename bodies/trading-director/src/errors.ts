// @tradrl/body-trading-director — the typed error taxonomy.
//
// Owning Work Order: T024.
//
// Two disciplines (mirroring the researchers and @tradrl/skills):
// - COLLECT-ALL validation (`DirectorValidation<T>` with `errors:
//   DirectorError[]`) for record validation — every violation is reported,
//   nothing is silently dropped, and untrusted input NEVER throws;
// - SINGLE typed failure (`DirectorResult<T>`) for operations that produce
//   exactly one outcome or one refusal.
//
// Error codes are a CLOSED union; each family cites its law:
//   - L4 point-in-time:  research_from_the_future (the decision hub's
//                         intake gate — an input whose asOf is later than
//                         the decision instant), as_of_mismatch,
//                         timestamp_order
//   - L8/L16 authority:  execution_authority_granted,
//                         execute_action_allowed, execute_not_prohibited,
//                         consequential_tool_in_procedure,
//                         forbidden_tool_in_procedure,
//                         non_director_capability, order_level_control
//                         (L16: order-level lifecycle is T025's lane, never
//                         this body's), reserved_publication_topic
//   - L9 lineage:        report_ref_mismatch, lineage_missing,
//                         digest_mismatch, duplicate_input_report,
//                         decision_composition_mismatch,
//                         goal_ref_malformed, constraint_ref_malformed
//   - L12 tenant:        tenant_missing, project_missing,
//                         tenant_mismatch, project_mismatch
//   - L16a suitability:  model_identity_as_evidence
//   - method honesty:    undeclared_method, method_version_mismatch,
//                         method_kind_mismatch, method_kind_missing,
//                         duplicate_method, method_registry_empty,
//                         quorum_not_declared (quorum is declared by the
//                         method, never hardcoded)
//   - coverage law:      lane_not_accounted (every one of the four lanes
//                         must be accounted consumed|conflicted|absent),
//                         lane_absence_record_missing (a missing lane
//                         produces a typed absence record — never silence),
//                         coverage_status_mismatch, conflict_record_mismatch
//   - publication:       unstructured_publication
//   - structural:        invalid_type, missing_field, invalid_field,
//                         unknown_lane, decimal_invalid,
//                         directive_shape_mismatch

/** The closed vocabulary of typed director errors. */
export const DIRECTOR_ERROR_CODES = [
  // structural
  'invalid_type',
  'missing_field',
  'invalid_field',
  'unknown_lane',
  'decimal_invalid',
  'directive_shape_mismatch',
  // L4 point-in-time (the research intake gate)
  'research_from_the_future',
  'as_of_mismatch',
  'timestamp_order',
  // L8 read-only authority + L16 strategic/execution separation
  'execution_authority_granted',
  'execute_action_allowed',
  'execute_not_prohibited',
  'consequential_tool_in_procedure',
  'forbidden_tool_in_procedure',
  'non_director_capability',
  'order_level_control',
  'reserved_publication_topic',
  // L9 lineage
  'report_ref_mismatch',
  'lineage_missing',
  'digest_mismatch',
  'duplicate_input_report',
  'decision_composition_mismatch',
  'goal_ref_malformed',
  'constraint_ref_malformed',
  // L12 tenant isolation
  'tenant_missing',
  'project_missing',
  'tenant_mismatch',
  'project_mismatch',
  // L16a labels never establish suitability
  'model_identity_as_evidence',
  // method honesty
  'undeclared_method',
  'method_version_mismatch',
  'method_kind_mismatch',
  'method_kind_missing',
  'duplicate_method',
  'method_registry_empty',
  'quorum_not_declared',
  // coverage accounting (the four-lane law)
  'lane_not_accounted',
  'lane_absence_record_missing',
  'coverage_status_mismatch',
  'conflict_record_mismatch',
  // publication discipline
  'unstructured_publication',
] as const;

/** A typed director error code. */
export type DirectorErrorCode = (typeof DIRECTOR_ERROR_CODES)[number];

/** A typed director error: code + dotted path + human-readable message. */
export interface DirectorError {
  readonly code: DirectorErrorCode;
  /** Dotted path from the offending record's root (`` = whole record). */
  readonly path: string;
  readonly message: string;
}

/**
 * COLLECT-ALL validation outcome: every violation of every law, or `ok`.
 * Untrusted input never throws — refusal is data.
 */
export interface DirectorValidation<T> {
  readonly ok: boolean;
  readonly value: T | null;
  readonly errors: readonly DirectorError[];
}

/** SINGLE typed failure outcome for operations with one refusal mode. */
export type DirectorResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly DirectorError[] };

/** Builds an `ok` single-outcome result. */
export function ok<T>(value: T): DirectorResult<T> {
  return { ok: true, value };
}

/** Builds a single typed failure. */
export function fail<T = never>(code: DirectorErrorCode, message: string, path = ''): DirectorResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

/** Builds a single typed failure from a prepared error list. */
export function failWith<T = never>(errors: readonly DirectorError[]): DirectorResult<T> {
  return { ok: false, errors: [...errors] };
}

/** Error constructor: a missing required field. */
export function missingField(path: string): DirectorError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** Error constructor: an invalid field. */
export function invalidField(path: string, message: string): DirectorError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** Error constructor: a wrong-typed record. */
export function invalidType(path: string, expected: string): DirectorError {
  return { code: 'invalid_type', path, message: `field "${path}" must be ${expected}` };
}

/** Collects validation errors into a `DirectorValidation` for a value. */
export function validationOf<T>(
  value: T | null,
  errors: readonly DirectorError[],
): DirectorValidation<T> {
  return errors.length === 0
    ? { ok: true, value, errors: [] }
    : { ok: false, value: null, errors: [...errors] };
}
