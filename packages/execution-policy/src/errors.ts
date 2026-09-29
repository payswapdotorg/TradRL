/**
 * @tradrl/execution-policy — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects
 * ALL violations and reports them as typed errors (the collect-all
 * discipline of the sibling contract packages — exchange-sim,
 * trading-strategy, rl-protocol), while state transitions fail with a
 * precise single cause. Both flow through the same
 * {@link ExecutionPolicyResult} shape: a failure carries a non-empty
 * `errors` array.
 *
 * The taxonomy names this Work Order's existential laws explicitly:
 *   - `incomplete_policy` / `check_dimension_missing` — the L8
 *     hard-control TOTALITY law: a policy that omits a check dimension
 *     is not a gate and fails validation ("the gate is total or it is
 *     not a gate");
 *   - `credential_value_present` — credential opacity: this lane carries
 *     credential REFERENCES, never values (a record embedding a value
 *     fails validation; live values belong to the secrets lane, T044,
 *     and venue binding is T040);
 *   - `fidelity_claim_dishonest` — simulation honesty (L5/L6): a
 *     simulated record claiming live fidelity is a typed error;
 *   - `killswitch_rewrite` — the append-only switch law: rewriting
 *     switch history is impossible to express, and a tampered log fails
 *     chain verification;
 *   - `lineage_gap` (L9) and `tenant_missing` (L12).
 *
 * DISTINCTION (L8, mirroring exchange-sim's error note): an operation
 * FAILURE (this module) means the gate could not even evaluate the
 * request as a well-formed event (malformed intent envelope, tampered
 * switch log, venue-state gap). A REFUSAL (check-machine.ts
 * `RefusalDecision`) is a SUCCESSFUL gate outcome — every check ran,
 * one failed, and the decision is a structured record. A consequential
 * intent NEVER produces an exception from the check machine: a refusal
 * is data, auditable like an approval.
 */

/** Machine-readable failure codes for execution-policy operations. */
export type ExecutionPolicyErrorCode =
  // --- generic envelope validation ------------------------------------------
  /** The root value is not an object/array where one is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A branded id is not a non-empty string. */
  | 'invalid_id'
  /** A value is not a valid epoch-millisecond timestamp. */
  | 'invalid_timestamp'
  /** A value is not a JSON-safe opaque payload. */
  | 'invalid_payload'
  /** Serialized text is not parseable JSON. */
  | 'invalid_json'
  /** A decimal string is malformed or outside the mirrored grammars. */
  | 'invalid_decimal'
  // --- the L8 hard-control totality law (the existential law of this lane) ----
  /** The policy is structurally incomplete (collect-all detail in `errors`). */
  | 'incomplete_policy'
  /** A check dimension is absent from the policy's declaration (the gate is total or it is not a gate). */
  | 'check_dimension_missing'
  /** The declared check order is not the full permutation with the kill switch first. */
  | 'invalid_check_order'
  // --- credential opacity ------------------------------------------------------
  /** A record embeds a credential VALUE (only opaque refs are expressible). */
  | 'credential_value_present'
  // --- simulation honesty (L5/L6) ------------------------------------------------
  /** A simulated record claims live fidelity (or an unknown fidelity mode). */
  | 'fidelity_claim_dishonest'
  // --- the append-only switch law --------------------------------------------------
  /** Switch history was rewritten, truncated or tampered (chain verification failed). */
  | 'killswitch_rewrite'
  /** A switch transition is illegal for the log's current state. */
  | 'invalid_switch_transition'
  // --- the audit trail --------------------------------------------------------------
  /** The audit trail was rewritten, truncated or tampered (chain verification failed). */
  | 'audit_rewrite'
  /** A decision does not carry the structure an audit record requires. */
  | 'invalid_decision'
  // --- the gate's input laws ----------------------------------------------------------
  /** A lineage field is absent or malformed (L9). */
  | 'lineage_gap'
  /** A record carries no tenant/project scope (L12). */
  | 'tenant_missing'
  /** The venue state does not cover the intent's (venue, instrument) pair. */
  | 'venue_state_gap'
  /** The provided kill-switch log does not match the policy's declared switch. */
  | 'switch_binding_mismatch'
  /** A record contradicts its own invariants (idempotency, sequence, digest). */
  | 'invalid_state';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface ExecutionPolicyError {
  readonly code: ExecutionPolicyErrorCode;
  /** Dotted path from the validated root, e.g. `policy.limits[1].maxOrderSize`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type ExecutionPolicyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ExecutionPolicyError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: ExecutionPolicyErrorCode, message: string, path = ''): ExecutionPolicyResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly ExecutionPolicyError[]): ExecutionPolicyResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): ExecutionPolicyResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): ExecutionPolicyError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): ExecutionPolicyError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): ExecutionPolicyError {
  return { code: 'invalid_type', path: '', message };
}
