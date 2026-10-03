/**
 * @tradrl/research-benchmarks — typed errors and results (Work Order T032).
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors, while construction and run
 * laws fail with a precise single cause. Both flow through the same
 * {@link BenchmarkResult} shape.
 *
 * The error taxonomy below is the machine-checkable form of the benchmark
 * SUITE's laws (the Work Order's own charter):
 * - `holdout_in_search` — the Work Order's law: a search-phase benchmark
 *   run whose scored material intersects the split plan's reserved (unseen)
 *   holdout — a benchmark run that scores a holdout window inside a search
 *   loop.
 * - `search_material_in_holdout` — the symmetric coherence law: a
 *   holdout-phase run scoring search-window material.
 * - `search_context_required` — holdout evidence always judges a search
 *   (L10/L11); a holdout run without its search-record binding does not
 *   compile.
 * - `chain_mismatch` — the search record or the result log the suite reads
 *   does not verify against its own chain (L9/L11).
 * - `classification_conflict` — the run's phase disagrees with the search
 *   record's classification of the bound trial (the record is the
 *   authority; the in-search/holdout separation is enforced THROUGH the
 *   mirror).
 * - `evidence_conflated` / `live_claim_on_simulation` — simulation evidence
 *   and live evidence are never conflated (the manifest's class law).
 * - `ladder_violation` — the LEARNING-LOOP regime ladder laws (simple
 *   synthetic regimes -> unseen multi-regime combinations).
 * - `tenant_mismatch` — L12 on every record and binding.
 * - `result_mismatch` / `duplicate_result` — the L9 content-address law
 *   and the L11 append-only law of the result log.
 * - `manifest_binding_mismatch` / `result_binding_mismatch` — the
 *   manifest's cross-binding laws.
 */

/** Machine-readable failure codes for research-benchmarks operations. */
export type BenchmarkErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** An instant is outside the representable range or not an integer epoch-ms number. */
  | 'invalid_timestamp'
  /** A dataset axis is malformed (ordering, overlap, empty). */
  | 'invalid_axis'
  /** A benchmark definition is malformed or incoherent. */
  | 'invalid_definition'
  /** An observation record is malformed. */
  | 'invalid_observation'
  /** An observation names a segment outside the split plan's material. */
  | 'unknown_segment'
  /** A scored segment carries no declared observation. */
  | 'missing_observation'
  /** A decimal string is malformed. */
  | 'invalid_decimal'
  /** A score is not an exact decimal at the benchmark's declared scale. */
  | 'scale_mismatch'
  /** A stress variation is malformed or its magnitude out of domain. */
  | 'invalid_stress'
  /** A search-phase run scores reserved (unseen) holdout material. */
  | 'holdout_in_search'
  /** A holdout-phase run scores search-window material. */
  | 'search_material_in_holdout'
  /** A holdout run carries no reserved holdout material to score. */
  | 'no_holdout_material'
  /** A holdout run must bind the search record it judges. */
  | 'search_context_required'
  /** A verified chain (search record or result log) disagrees with its recorded head. */
  | 'chain_mismatch'
  /** The bound trial is not logged by the search record. */
  | 'unknown_trial'
  /** The run's phase disagrees with the record's classification of the bound trial. */
  | 'classification_conflict'
  /** The regime ladder laws are violated. */
  | 'ladder_violation'
  /** Simulation evidence and live evidence were conflated. */
  | 'evidence_conflated'
  /** Live evidence was claimed over synthetic-origin data (L5/L6). */
  | 'live_claim_on_simulation'
  /** A cross-tenant or cross-project operation (L12). */
  | 'tenant_mismatch'
  /** A result record is malformed. */
  | 'invalid_result'
  /** A result's recorded content address disagrees with its content (L9). */
  | 'result_mismatch'
  /** A result id is already appended — the result log is append-only. */
  | 'duplicate_result'
  /** A manifest is malformed. */
  | 'invalid_manifest'
  /** A manifest entry's binding disagrees with a bound record's lineage. */
  | 'manifest_binding_mismatch'
  /** A result record is bound under the wrong benchmark. */
  | 'result_binding_mismatch';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface BenchmarkError {
  readonly code: BenchmarkErrorCode;
  /** Dotted path from the validated root, e.g. `entries[2].results[0]`. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type BenchmarkResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly BenchmarkError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: BenchmarkErrorCode, message: string, path = ''): BenchmarkResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly BenchmarkError[]): BenchmarkResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): BenchmarkResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): BenchmarkError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): BenchmarkError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): BenchmarkError {
  return { code: 'invalid_type', path: '', message };
}
