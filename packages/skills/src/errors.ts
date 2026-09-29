/**
 * @tradrl/skills — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors (the collect-all discipline
 * of @tradrl/evaluation / @tradrl/organization), while the existential laws
 * fail with precise single causes. Both flow through the same
 * {@link SkillResult} shape: a failure carries a non-empty `errors` array.
 *
 * THE ERROR TAXONOMY IS THE MACHINE-CHECKABLE FORM OF THE WORK ORDER'S
 * LAWS (spec/ARCHITECTURE-LOCK.md + spec/LEARNING-LOOP.md):
 * - Evidence law: `evidence_missing` — a skill claim with no evidence
 *   citation fails validation; extraction only emits evidence-backed
 *   candidates ("Skills are extracted FROM recorded experience — never
 *   invented").
 * - L16a: `label_as_evidence` — a profession/role label cited as
 *   suitability evidence ("Never equate model and profession").
 * - L3 (the existential law): `certified_version_mutation` — a certified
 *   BodyVersion NEVER mutates; any API that could mutate a certified
 *   version is a typed error.
 * - Compatibility gating: `compatibility_fail` — minting a BodyVersion
 *   whose substrate-compatibility refs fail agent-body's compatibility
 *   mirror shapes.
 * - Breaking-change declaration: `undeclared_breaking_change` — a delta
 *   removing a capability without the declared-breaking-change record.
 * - L9: `lineage_gap` — a record missing its full lineage block (parent
 *   version ref, evidence refs, gap refs, forge version, seed).
 * - L11: `attempt_hidden` / `attempt_rewrite` — the forge's attempt log is
 *   append-only; rejected candidates are RETAINED with structured reasons;
 *   hiding or rewriting one is a typed error.
 * - L12: `tenant_missing` / `tenant_mismatch` — every record carries
 *   TenantId + ProjectId, and scopes must cohere.
 * - Determinism law: `unseeded_forge` — there is no ambient randomness; a
 *   forge run without a seed cannot execute.
 */

/** Machine-readable failure codes for skill-extraction operations. */
export type SkillErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** Evidence law: a skill claim with no evidence citation. */
  | 'evidence_missing'
  /** L16a: a profession/role label was cited as suitability evidence. */
  | 'label_as_evidence'
  /** L3: an operation that would mutate a certified BodyVersion. */
  | 'certified_version_mutation'
  /** Compatibility gate: substrate-compatibility refs fail the mirror shapes. */
  | 'compatibility_fail'
  /** A capability removal without a declared-breaking-change record. */
  | 'undeclared_breaking_change'
  /** L9: a record's lineage block is incomplete. */
  | 'lineage_gap'
  /** L11: an attempt-log entry was hidden (a recorded attempt is missing). */
  | 'attempt_hidden'
  /** L11: an attempt-log entry was rewritten (append-only violation). */
  | 'attempt_rewrite'
  /** L12: a record is missing its tenant or project scope. */
  | 'tenant_missing'
  /** L12: record scopes disagree (one tenant per lineage chain). */
  | 'tenant_mismatch'
  /** Determinism law: the forge/extraction run was invoked without a seed. */
  | 'unseeded_forge'
  /** Two records in one collection share an id. */
  | 'duplicate_record'
  /** A certification decision conflicts with the candidate's state. */
  | 'certification_conflict';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface SkillError {
  readonly code: SkillErrorCode;
  /** Dotted path from the validated root, e.g. `candidates[2].lineage.seed`. Empty for record-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type SkillResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly SkillError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: SkillErrorCode, message: string, path = ''): SkillResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly SkillError[]): SkillResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): SkillResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): SkillError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): SkillError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): SkillError {
  return { code: 'invalid_type', path: '', message };
}
