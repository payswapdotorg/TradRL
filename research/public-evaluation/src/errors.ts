/**
 * @tradrl/research-public-evaluation — typed errors and results (Work
 * Order T049).
 *
 * The error taxonomy below is the machine-checkable form of the
 * PUBLICATION LAYER's laws:
 * - `chain_of_thought` — NEVER PUBLISHED: reasoning traces, prompts,
 *   scratchpads, deliberation notes — the closed key vocabulary scan
 *   refuses them wherever they appear (operator attachments or the
 *   compiled record itself).
 * - `tenant_data` — NEVER PUBLISHED: raw tenant material — trajectories,
 *   market events, order payloads, positions, books, credentials — the
 *   closed key vocabulary scan (fail-closed: conservative on purpose).
 * - `unpublishable_class` — the projection law: a field class that the
 *   public format does not carry (internal-only axes; unredacted
 *   operator context that is neither claim nor provenance nor recipe).
 * - `claim_unverified` — a claim was supplied rather than DERIVED from
 *   the measurement, or disagrees with the re-measured values.
 * - `future_dated` — the L4 law: a publication cannot carry an as-of
 *   instant after its publication instant, and the as-of is BOUND to the
 *   measurement's evidence instant.
 * - `source_missing` / `reverify_failed` / `digest_mismatch` — the
 *   re-verification laws: a recipe ref without a supplied source; a
 *   re-run whose bytes diverge; a digest that does not match.
 * - `duplicate_publication` — the L11 law: one point-in-time claim per
 *   (suite, subject, as-of); different bytes for the same claim key are
 *   refused (identical bytes replay).
 * - `measurement_mismatch` / `chain_mismatch` — the own-lane gates
 *   re-exported through this package's error space (the benchmark
 *   machinery's content-address and chain laws).
 * - `tenant_mismatch` — L12 on every record and log.
 */

/** Machine-readable failure codes for the publication layer. */
export type PublicationErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A published record is malformed. */
  | 'invalid_publication'
  /** A published record's content address disagrees with its content (L9). */
  | 'publication_mismatch'
  /** NEVER PUBLISHED: chain-of-thought material was attached or compiled. */
  | 'chain_of_thought'
  /** NEVER PUBLISHED: raw tenant data was attached or compiled. */
  | 'tenant_data'
  /** A field class the public format does not carry. */
  | 'unpublishable_class'
  /** A claim is not derived from the measurement, or disagrees with the re-measured values. */
  | 'claim_unverified'
  /** The L4 law was violated (as-of after publication, or unbound to the evidence instant). */
  | 'future_dated'
  /** The as-of binding is absent or disagrees with the measurement's instant. */
  | 'as_of_mismatch'
  /** A recipe ref has no supplied source (the re-verification input manifest). */
  | 'source_missing'
  /** A re-run diverged from the published bytes. */
  | 'reverify_failed'
  /** A digest did not match its referent. */
  | 'digest_mismatch'
  /** Different bytes for the same point-in-time claim key (L11). */
  | 'duplicate_publication'
  /** A measurement record is malformed (the own-lane gate). */
  | 'measurement_mismatch'
  /** A verified chain (search record, measurement log, publication log) disagrees with its head. */
  | 'chain_mismatch'
  /** A cross-tenant or cross-project operation (L12). */
  | 'tenant_mismatch';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface PublicationError {
  readonly code: PublicationErrorCode;
  /** Dotted path from the validated root, e.g. `claim.axes[2]`. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type PublicationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly PublicationError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: PublicationErrorCode, message: string, path = ''): PublicationResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly PublicationError[]): PublicationResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): PublicationResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): PublicationError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): PublicationError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): PublicationError {
  return { code: 'invalid_type', path: '', message };
}
