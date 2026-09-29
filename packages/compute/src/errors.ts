/**
 * @tradrl/compute — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors (the collect-all discipline of
 * every @tradrl contract package), while state transitions fail with a
 * precise single cause. Both flow through the same {@link ComputeResult}
 * shape: a failure carries a non-empty `errors` array.
 *
 * The taxonomy is the Work Order T014 error spine — `job_invalid`,
 * `seed_overlap`, `divergence`, `lineage_gap`, `failure_hidden`,
 * `tenant_missing` — plus the closed envelope vocabulary the sibling
 * packages share. Cross-lane error codes: when the injected COMPUTE port
 * fails, its error codes belong to the substrate's own vocabulary (real
 * queues name failure modes this package rightly does not); the runner maps
 * every port failure onto `port_error` while PRESERVING the substrate's
 * code and message — the same discipline @tradrl/rl-protocol applies to
 * environment ports and @tradrl/trajectory applies to rejection errors.
 */

/** Machine-readable failure codes for compute operations. */
export type ComputeErrorCode =
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
  /** Serialized text is not the canonical serialization of the record. */
  | 'invalid_serialization'
  // --- jobs (L9/L12) ----------------------------------------------------------
  /** A job record violates the EpisodeJob contract. */
  | 'job_invalid'
  /** An L9 lineage field is absent or malformed (experiment/env config/policy/reward models). */
  | 'lineage_gap'
  /** The L12 tenant / L15 project scope is absent or malformed. */
  | 'tenant_missing'
  /** A record's lineage is incoherent with its job or the job set. */
  | 'lineage_mismatch'
  // --- seed discipline (the determinism law) -----------------------------------
  /** Task seed subranges of one job overlap (the declared partition is law). */
  | 'seed_overlap'
  /** Task seed subranges do not cover the job's whole range. */
  | 'seed_gap'
  // --- scheduling ---------------------------------------------------------------
  /** A schedule violates its shape or invariants (partition coherence, ids, slots). */
  | 'invalid_schedule'
  /** An outcome names a submission the schedule never planned. */
  | 'schedule_mismatch'
  // --- outcomes -------------------------------------------------------------------
  /** A result record violates the contract (shape, seed derivation, digest form). */
  | 'invalid_result'
  /** A failure record violates the contract. */
  | 'invalid_failure'
  /** A result's episode ordinal lies outside its task's partition subrange. */
  | 'result_out_of_range'
  /** Same (job, seed) key with contradicting evidence (different digests or trials). */
  | 'divergence'
  /** The executing worker's episode generation failed (T013 machinery codes preserved in the message). */
  | 'generation_failed'
  // --- aggregation (L11) -----------------------------------------------------------
  /** A task or job with neither results nor a failure record — hiding a failed job is a typed error. */
  | 'failure_hidden'
  /** Two distinct episodes claim the same trial id. */
  | 'duplicate_trial'
  /** Two distinct trials claim the same trajectory. */
  | 'duplicate_trajectory'
  // --- run state ----------------------------------------------------------------------
  /** A run state is malformed. */
  | 'invalid_run_state'
  /** The collect bound was reached before every submission reported an outcome. */
  | 'run_not_complete'
  /** The recorded outcomes do not fold onto the recorded chain (tampered content). */
  | 'chain_mismatch'
  // --- the injected substrate -----------------------------------------------------------
  /** A value does not structurally satisfy the ComputePort surface. */
  | 'port_invalid'
  /** The injected compute port failed; the substrate's codes are preserved. */
  | 'port_error';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface ComputeError {
  readonly code: ComputeErrorCode;
  /** Dotted path from the validated root, e.g. `jobs[2].lineage.tenant`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type ComputeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ComputeError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: ComputeErrorCode, message: string, path = ''): ComputeResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly ComputeError[]): ComputeResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): ComputeResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): ComputeError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): ComputeError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): ComputeError {
  return { code: 'invalid_type', path: '', message };
}
