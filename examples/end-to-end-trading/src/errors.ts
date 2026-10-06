// @tradrl/example-e2e-trading — the typed error taxonomy (mirror of the
// program-wide Result discipline: no exceptions for untrusted input; typed
// data records; decimal arithmetic preconditions throw).

/** The closed error-code vocabulary of the reference slice. */
export type ExampleErrorCode =
  | 'invalid_type'
  | 'missing_field'
  | 'invalid_field'
  | 'invalid_id'
  | 'invalid_timestamp'
  | 'invalid_decimal'
  | 'decimal_imprecision'
  | 'invalid_state'
  | 'invalid_json'
  | 'lineage_gap'
  | 'chain_mismatch'
  | 'tenant_mismatch'
  | 'tenant_missing'
  | 'observation_gap'
  | 'research_from_the_future'
  | 'quorum_unmet'
  | 'directive_shape_mismatch'
  | 'decision_not_approved'
  | 'kill_switch_thrown'
  | 'unknown_grant'
  | 'rate_budget_exhausted'
  | 'limits_breaching'
  | 'venue_not_permitted'
  | 'no_route'
  | 'mode_confusion'
  | 'credential_value_present'
  | 'clock_not_monotonic'
  | 'l4_boundary_violation'
  | 'lifecycle_violation'
  | 'quantity_mismatch'
  | 'universe_violation'
  | 'constraint_refused'
  | 'invalid_serialization'
  | 'scenario_invalid'
  | 'undeclared_method'
  | 'risk_constraint_uncompilable'
  | 'evidence_missing'
  | 'future_evidence';

/** One typed error — data, never a thrown class (the program-wide law). */
export interface ExampleError {
  readonly code: ExampleErrorCode;
  readonly path: string;
  readonly message: string;
}

/** The result envelope used by every stage of the slice. */
export type ExampleResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ExampleError[] };

/** Constructor: a success. */
export function ok<T>(value: T): ExampleResult<T> {
  return { ok: true, value };
}

/** Constructor: a failure carrying one typed error. */
export function fail<T = never>(code: ExampleErrorCode, message: string, path = ''): ExampleResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

/** Constructor: a failure carrying many typed errors. */
export function failures<T = never>(errors: readonly ExampleError[]): ExampleResult<T> {
  return { ok: false, errors: [...errors] };
}

/** Constructor: `missing_field` shorthand. */
export function missingField(path: string, message = 'field is required'): ExampleError {
  return { code: 'missing_field', path, message };
}

/** Constructor: `invalid_field` shorthand. */
export function invalidField(path: string, message: string): ExampleError {
  return { code: 'invalid_field', path, message };
}

/** Constructor: `invalid_type` shorthand. */
export function invalidType(message: string, path = ''): ExampleError {
  return { code: 'invalid_type', path, message };
}

/** Unwraps a result or rethrows its errors as a single Error (internal invariant use only). */
export function unwrap<T>(result: ExampleResult<T>): T {
  if (result.ok) return result.value;
  const detail = result.errors.map((error) => `${error.path ? `${error.path}: ` : ''}${error.code} — ${error.message}`);
  throw new Error(`example invariant violated:\n  ${detail.join('\n  ')}`);
}
