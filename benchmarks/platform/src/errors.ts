/**
 * @tradrl/benchmarks-platform — typed errors and results (Work Order T049).
 *
 * Contract modules never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors, while the run laws fail with
 * a precise single cause. Both flow through the same {@link PlatformResult}
 * shape (the program-wide discipline).
 *
 * The error taxonomy below is the machine-checkable form of the benchmark
 * MACHINERY's laws:
 * - `invalid_suite` / `unknown_axis` / `axis_mismatch` / `scale_mismatch` /
 *   `unknown_measurable` — the suite-definition and axis laws (a suite's
 *   axes reference the closed measurable vocabulary of their subject kind;
 *   decimal axes declare their exact scale).
 * - `invalid_subject` / `subject_kind_mismatch` — the L9 subject binding
 *   (the measured artifact's content address + the full lineage refs).
 * - `invalid_evidence` / `evidence_mismatch` — the measured artifact must
 *   BE the subject kind's evidence shape (the T048 SliceReport mirror for
 *   reference-slice subjects).
 * - `pipeline_incoherent` — the reference-slice evidence violates its own
 *   station invariants (the platform self-benchmark's structural laws).
 * - `invalid_phase` / `holdout_in_search` / `search_material_in_holdout` /
 *   `search_context_required` / `unknown_trial` / `classification_conflict`
 *   — the T032 split discipline mirrored into the measurement lane: an
 *   in-search measurement never measures reserved unseen material; a
 *   holdout measurement always judges a verified search.
 * - `chain_mismatch` — a search record or measurement log that does not
 *   verify against its own chain (L9/L11 — the T031 mirror).
 * - `synthetic_holdout` / `live_claim_on_simulation` / `evidence_conflated` /
 *   `fidelity_claim_dishonest` — the T028/T031 honesty laws: generative
 *   populations are exploration instruments; synthetic material never
 *   serves as unseen holdout evidence; simulation and live evidence are
 *   never conflated; a live claim over synthetic material is refused.
 * - `selected_without_holdout` / `evidence_missing` / `evidence_insufficient` /
 *   `hidden_trials` — the T035 adoption-gate laws over measured evidence
 *   (mirrored vocabulary: in-search-only attained evidence withholds; a
 *   cited trial outside the retained search record fails closed).
 * - `requirement_unmatched` — the T045 discharge seam's law: a benchmark
 *   requirement names a suite the supplied measurements never measured.
 * - `invalid_measurement` / `measurement_mismatch` / `duplicate_measurement`
 *   — the L9 content-address law and the L11 append-only law of the
 *   measurement log.
 * - `tenant_mismatch` — L12 on every record and binding.
 */

/** Machine-readable failure codes for the platform benchmark machinery. */
export type PlatformErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A suite definition is malformed or incoherent. */
  | 'invalid_suite'
  /** A suite axis references a measurable outside the subject kind's closed vocabulary. */
  | 'unknown_measurable'
  /** A suite axis's kind disagrees with the referenced measurable's kind. */
  | 'axis_mismatch'
  /** A decimal axis value is not an exact decimal at the axis's declared scale. */
  | 'scale_mismatch'
  /** A decimal string is malformed. */
  | 'invalid_decimal'
  /** A subject binding is malformed (L9: artifact address + full lineage refs). */
  | 'invalid_subject'
  /** The subject binding's kind disagrees with the suite's declared subject kind. */
  | 'subject_kind_mismatch'
  /** The measured evidence artifact is malformed for its subject kind. */
  | 'invalid_evidence'
  /** The measured evidence disagrees with the subject binding (the artifact digest must match). */
  | 'evidence_mismatch'
  /** The reference-slice evidence violates a station invariant of its own pipeline. */
  | 'pipeline_incoherent'
  /** The measurement phase is not a member of the closed phase vocabulary. */
  | 'invalid_phase'
  /** An in-search measurement's material intersects the split plan's reserved unseen holdout. */
  | 'holdout_in_search'
  /** A holdout measurement's material is not reserved unseen material. */
  | 'search_material_in_holdout'
  /** A holdout measurement carries no reserved material, or no search-record binding. */
  | 'search_context_required'
  /** A bound trial is not logged by the search record. */
  | 'unknown_trial'
  /** The measurement's phase disagrees with the search record's classification of the bound trial. */
  | 'classification_conflict'
  /** A verified chain (search record or measurement log) disagrees with its recorded head. */
  | 'chain_mismatch'
  /** A holdout measurement draws its unseen material from a synthetic (generative) source. */
  | 'synthetic_holdout'
  /** Live evidence was claimed over simulation-origin material (L5/L6). */
  | 'live_claim_on_simulation'
  /** Simulation evidence and live evidence were conflated. */
  | 'evidence_conflated'
  /** A material source claims a fidelity its kind cannot honestly claim (T028 mirror). */
  | 'fidelity_claim_dishonest'
  /** The adoption gate's withhold: the cited attained evidence is in-search only. */
  | 'selected_without_holdout'
  /** The adoption gate's withhold: no measured evidence was supplied. */
  | 'evidence_missing'
  /** The adoption gate's withhold: evidence present but never attained. */
  | 'evidence_insufficient'
  /** Cited evidence names a trial the retained search record never logged (fail-closed). */
  | 'hidden_trials'
  /** A benchmark requirement names a suite the supplied measurements never measured. */
  | 'requirement_unmatched'
  /** A measurement record is malformed. */
  | 'invalid_measurement'
  /** A measurement's recorded content address disagrees with its content (L9). */
  | 'measurement_mismatch'
  /** A measurement id is already appended — the measurement log is append-only. */
  | 'duplicate_measurement'
  /** A verification contract is malformed (the T045 discharge seam's input). */
  | 'invalid_contract'
  /** A cross-tenant or cross-project operation (L12). */
  | 'tenant_mismatch';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface PlatformError {
  readonly code: PlatformErrorCode;
  /** Dotted path from the validated root, e.g. `axes[2].attainment`. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type PlatformResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly PlatformError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: PlatformErrorCode, message: string, path = ''): PlatformResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly PlatformError[]): PlatformResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): PlatformResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): PlatformError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): PlatformError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): PlatformError {
  return { code: 'invalid_type', path: '', message };
}
