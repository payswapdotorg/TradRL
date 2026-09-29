// @tradrl/body-execution — the typed error taxonomy.
//
// Owning Work Order: T025.
//
// Two disciplines (mirroring the researchers, the director and
// @tradrl/skills):
// - COLLECT-ALL validation (`ExecutionBodyValidation<T>` with `errors:
//   ExecutionBodyError[]`) for record validation — every violation is
//   reported, nothing is silently dropped, and untrusted input NEVER
//   throws;
// - SINGLE typed failure (`ExecutionBodyResult<T>`) for operations that
//   produce exactly one outcome or one refusal.
//
// Error codes are a CLOSED union; each family cites its law:
//   - L16 strategic/execution separation (THE EXISTENTIAL LAW):
//                         clock_confusion (a lifecycle record stamped
//                         with strategic time — the order-level clock
//                         marker is a DISTINCT field from any strategic
//                         asOf), strategic_level_control (a spec claiming
//                         the director's strategic authority)
//   - the lifecycle law:  lifecycle_violation (an undefined, skipped or
//                         replayed transition), unknown_order_state,
//                         unknown_lifecycle_event, lifecycle_sequence
//                         (non-contiguous log), lifecycle_chain (a
//                         chain-head mismatch — the tamper trip wire),
//                         timestamp_order (order-clock causality:
//                         the order-level event cannot precede the
//                         decision that authorized it, and the clock
//                         cannot run backwards within a log)
//   - L8/L20 authority:  execution_authority_granted (EXECUTE claimed
//                         without the external-gateway-only pairing; any
//                         executionAuthority outside the closed mirror
//                         set — in particular any model-autonomous claim;
//                         'none' on THIS role's reference spec — the
//                         execution body's role REQUIRES the gateway-ref
//                         mode; an execute-shaped member on the port),
//                         execute_prohibited (EXECUTE in
//                         prohibitedActions — this role's gateway-request
//                         action may not be prohibited),
//                         consequential_tool_in_procedure (a
//                         venue-direct tool in a procedure),
//                         forbidden_tool_in_procedure,
//                         non_execution_capability,
//                         decision_not_approved (a refusal — or a
//                         non-decision — driving order preparation: a
//                         refusal is a record, never authority),
//                         killswitch_thrown (submission under a thrown
//                         standing switch — fail-closed, the gate's law
//                         honored), reserved_publication_topic
//   - L9 lineage:        lineage_missing, digest_mismatch,
//                         fill_ref_mismatch, quantity_mismatch
//                         (cumulative fills exceeding the order
//                         quantity)
//   - exact-decimal law: decimal_imprecision (float mediation on a
//                         quantity — a JS number in a quantity position
//                         is never coerced, always refused),
//                         decimal_invalid (a malformed decimal string)
//   - reconciliation:    reconciliation_gap (cumulative fills vs the
//                         acknowledged quantity — exact equality
//                         required; one smallest-grid-step off is the
//                         named minimum)
//   - monitoring laws:   escalation_missing (a stuck state without its
//                         bound escalation record — never a silent
//                         timeout), fill_fabricated (a fill event
//                         without fill evidence — NEVER fabricate),
//                         cancel_fabricated (a cancel transition without
//                         a confirmation ref — NEVER fabricate)
//   - L12 tenant:        tenant_missing, project_missing,
//                         tenant_mismatch, project_mismatch
//   - L16a suitability:  model_identity_as_evidence
//   - method honesty:    undeclared_method, method_version_mismatch,
//                         method_kind_mismatch, duplicate_method,
//                         method_registry_empty
//   - publication:       unstructured_publication
//   - structural:        invalid_type, missing_field, invalid_field

/** The closed vocabulary of typed execution-body errors. */
export const EXECUTION_BODY_ERROR_CODES = [
  // structural
  'invalid_type',
  'missing_field',
  'invalid_field',
  'unknown_order_state',
  'unknown_lifecycle_event',
  'decimal_invalid',
  // L16 strategic/execution separation (the existential law)
  'clock_confusion',
  'strategic_level_control',
  // the lifecycle law (the declared total state machine)
  'lifecycle_violation',
  'lifecycle_sequence',
  'lifecycle_chain',
  'timestamp_order',
  // L8/L20 authority (external execution authority)
  'execution_authority_granted',
  'execute_prohibited',
  'consequential_tool_in_procedure',
  'forbidden_tool_in_procedure',
  'non_execution_capability',
  'decision_not_approved',
  'killswitch_thrown',
  'reserved_publication_topic',
  // L9 lineage
  'lineage_missing',
  'digest_mismatch',
  'fill_ref_mismatch',
  'quantity_mismatch',
  // exact-decimal accounting
  'decimal_imprecision',
  // fill reconciliation
  'reconciliation_gap',
  // monitoring laws (records, never exceptions; never fabrication)
  'escalation_missing',
  'fill_fabricated',
  'cancel_fabricated',
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
  'duplicate_method',
  'method_registry_empty',
  // publication discipline
  'unstructured_publication',
] as const;

/** A typed execution-body error code. */
export type ExecutionBodyErrorCode = (typeof EXECUTION_BODY_ERROR_CODES)[number];

/** A typed execution-body error: code + dotted path + human-readable message. */
export interface ExecutionBodyError {
  readonly code: ExecutionBodyErrorCode;
  /** Dotted path from the offending record's root (`` = whole record). */
  readonly path: string;
  readonly message: string;
}

/**
 * COLLECT-ALL validation outcome: every violation of every law, or `ok`.
 * Untrusted input never throws — refusal is data.
 */
export interface ExecutionBodyValidation<T> {
  readonly ok: boolean;
  readonly value: T | null;
  readonly errors: readonly ExecutionBodyError[];
}

/** SINGLE typed failure outcome for operations with one refusal mode. */
export type ExecutionBodyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ExecutionBodyError[] };

/** Builds an `ok` single-outcome result. */
export function ok<T>(value: T): ExecutionBodyResult<T> {
  return { ok: true, value };
}

/** Builds a single typed failure. */
export function fail<T = never>(
  code: ExecutionBodyErrorCode,
  message: string,
  path = '',
): ExecutionBodyResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

/** Builds a single typed failure from a prepared error list. */
export function failWith<T = never>(errors: readonly ExecutionBodyError[]): ExecutionBodyResult<T> {
  return { ok: false, errors: [...errors] };
}

/** Error constructor: a missing required field. */
export function missingField(path: string): ExecutionBodyError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** Error constructor: an invalid field. */
export function invalidField(path: string, message: string): ExecutionBodyError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** Error constructor: a wrong-typed record. */
export function invalidType(path: string, expected: string): ExecutionBodyError {
  return { code: 'invalid_type', path, message: `field "${path}" must be ${expected}` };
}

/** Collects validation errors into an `ExecutionBodyValidation` for a value. */
export function validationOf<T>(
  value: T | null,
  errors: readonly ExecutionBodyError[],
): ExecutionBodyValidation<T> {
  return errors.length === 0
    ? { ok: true, value, errors: [] }
    : { ok: false, value: null, errors: [...errors] };
}
