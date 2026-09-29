/**
 * @tradrl/compute — the typed outcome records: JobResult and JobFailure.
 *
 * Every submission's outcome is a RETAINED typed record (append-only —
 * L11's spirit: worker failures are never silent drops):
 *
 *   - {@link JobResult} — one generated episode: the job ref, the worker
 *     that executed it (L9: every result carries its job ref + worker ref
 *     + digest), the ABSOLUTE episode ordinal within the job's seed range,
 *     the DERIVED seed (the declared derivation — a result whose seed does
 *     not match (job, ordinal) is a typed protocol violation), the
 *     world-minted episode id, the EPISODE DIGEST (the byte-determinism
 *     anchor: same (job spec, seed, env/policy script) -> identical
 *     episode bytes -> identical digest, twice), and the trial-ref-shaped
 *     payload (the T011 `TrialRecord` mirror).
 *   - {@link JobFailure} — one worker failure: the failure KIND (the
 *     closed taxonomy: timeout | protocol | divergence | environment |
 *     cancelled), the non-empty detail, and the FULL lineage block (the
 *     work order: "failure carries the kind + lineage").
 *
 * CONCURRENCY SEMANTICS (the work order's law): at-least-once execution
 * with idempotent, deterministic results — the same (job, seed) re-executed
 * yields byte-identical episode bytes, so duplicate result submissions are
 * DEDUPLICATED by digest equality at aggregation; a mismatched digest for
 * the same (job, seed) key is a typed `divergence` error (aggregate.ts).
 */

import { deepFreeze, isDigest8, isNonEmptyString, isRecord } from './primitives';
import type { JsonObject } from './primitives';
import { canonicalJson } from './primitives';
import { fnv1a32Hex } from './primitives';
import { fail, invalidType, ok, type ComputeError, type ComputeResult } from './errors';
import type { EpisodeId, JobId, Seed, SubmissionId, WorkerRef } from './ids';
import { isEpisodeId, isJobId, isSeed, isSubmissionId, isWorkerRef } from './ids';
import type { JobLineage } from './job';
import { isJobLineage, lineageTree, validateJobLineage } from './job';
import type { TrialRecord } from './trial-mirror';
import { isTrialRecord, trialTree, validateTrialRecord } from './trial-mirror';

// ---------------------------------------------------------------------------
// The failure-kind taxonomy
// ---------------------------------------------------------------------------

/** The closed worker-failure taxonomy (the work order names timeout/protocol/divergence...). */
export type FailureKind = 'timeout' | 'protocol' | 'divergence' | 'environment' | 'cancelled';

/** Runtime-checkable list of failure kinds. */
export const FAILURE_KINDS: readonly FailureKind[] = ['timeout', 'protocol', 'divergence', 'environment', 'cancelled'];

/** Runtime guard for a failure kind. */
export function isFailureKind(value: unknown): value is FailureKind {
  return typeof value === 'string' && (FAILURE_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The result record
// ---------------------------------------------------------------------------

/**
 * One generated episode's outcome record. The digest is the FNV-1a of the
 * episode's canonical step bytes (the T013 step-chain discipline, applied
 * by the executing worker); the trial is the experiments-lane record the
 * episode's evidence emits (status, trajectory ref, outcome summary —
 * outcome is DATA produced by generation, never an acceptance verdict:
 * evaluation (T012) decides, L7).
 */
export interface JobResult {
  readonly kind: 'result';
  /** The submission the result belongs to. */
  readonly submission: SubmissionId;
  /** The job the episode belongs to (L9: results carry their job ref). */
  readonly job: JobId;
  /** The worker that executed the episode (L9: results carry their worker ref). */
  readonly worker: WorkerRef;
  /** The ABSOLUTE episode ordinal within the job's seed range. */
  readonly episode_index: number;
  /** The DERIVED episode seed — must equal `episodeSeedAt(job, episode_index)`. */
  readonly seed: Seed;
  /** The world-minted episode id. */
  readonly episode: EpisodeId;
  /** The episode digest (8-char lowercase hex — the byte-determinism anchor). */
  readonly digest: string;
  /** The trial-ref-shaped payload (the T011 TrialRecord mirror). */
  readonly trial: TrialRecord;
  /** The full L9/L12 lineage block (results carry lineage). */
  readonly lineage: JobLineage;
}

/** Runtime guard for a job result. */
export function isJobResult(value: unknown): value is JobResult {
  if (!isRecord(value)) return false;
  if (value.kind !== 'result') return false;
  if (!isSubmissionId(value.submission)) return false;
  if (!isJobId(value.job)) return false;
  if (!isWorkerRef(value.worker)) return false;
  if (typeof value.episode_index !== 'number' || !Number.isSafeInteger(value.episode_index) || value.episode_index < 0) return false;
  if (!isSeed(value.seed)) return false;
  if (!isEpisodeId(value.episode)) return false;
  if (!isDigest8(value.digest)) return false;
  if (typeof (value as Record<string, unknown>).trial !== 'object' || value.trial === null) return false;
  if (!isTrialRecord(value.trial)) return false;
  if (!isJobLineage(value.lineage)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted job result. On success the value
 * is returned narrowed, deeply frozen. (Semantic coherence with the job
 * set — lineage equality, seed derivation, partition range — is
 * aggregate.ts's law; this validates the record itself.)
 */
export function validateJobResult(value: unknown, path = 'result'): ComputeResult<JobResult> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ComputeError[] = [];

  if (value.kind !== 'result') {
    errors.push({ code: 'invalid_result', path: `${path}.kind`, message: `a result record carries kind "result" (got ${JSON.stringify(value.kind)})` });
  }

  if (value.submission === undefined) {
    errors.push({ code: 'invalid_result', path: `${path}.submission`, message: 'the result submission id is missing' });
  } else if (!isSubmissionId(value.submission)) {
    errors.push({ code: 'invalid_result', path: `${path}.submission`, message: 'must be a non-empty submission id' });
  }

  if (value.job === undefined) {
    errors.push({ code: 'invalid_result', path: `${path}.job`, message: 'the result job ref is missing (L9 — results carry their job ref)' });
  } else if (!isJobId(value.job)) {
    errors.push({ code: 'invalid_result', path: `${path}.job`, message: 'must be a non-empty job id' });
  }

  if (value.worker === undefined) {
    errors.push({ code: 'invalid_result', path: `${path}.worker`, message: 'the result worker ref is missing (L9 — results carry their worker ref)' });
  } else if (!isWorkerRef(value.worker)) {
    errors.push({ code: 'invalid_result', path: `${path}.worker`, message: 'must be a non-empty worker ref' });
  }

  if (value.episode_index === undefined) {
    errors.push({ code: 'invalid_result', path: `${path}.episode_index`, message: 'the result episode ordinal is missing' });
  } else if (typeof value.episode_index !== 'number' || !Number.isSafeInteger(value.episode_index) || value.episode_index < 0) {
    errors.push({ code: 'invalid_result', path: `${path}.episode_index`, message: 'must be a non-negative safe integer (the ABSOLUTE ordinal within the job seed range)' });
  }

  if (value.seed === undefined) {
    errors.push({ code: 'invalid_result', path: `${path}.seed`, message: 'the result seed is missing (the declared derivation binds it)' });
  } else if (!isSeed(value.seed)) {
    errors.push({ code: 'invalid_result', path: `${path}.seed`, message: 'must be a non-empty derived seed' });
  }

  if (value.episode === undefined) {
    errors.push({ code: 'invalid_result', path: `${path}.episode`, message: 'the result episode id is missing' });
  } else if (!isEpisodeId(value.episode)) {
    errors.push({ code: 'invalid_result', path: `${path}.episode`, message: 'must be a non-empty episode id' });
  }

  if (value.digest === undefined) {
    errors.push({ code: 'invalid_result', path: `${path}.digest`, message: 'the result episode digest is missing (L9 — the byte-determinism anchor)' });
  } else if (!isDigest8(value.digest)) {
    errors.push({ code: 'invalid_result', path: `${path}.digest`, message: 'must be an 8-char lowercase-hex digest (the FNV-1a discipline)' });
  }

  let trial: TrialRecord | undefined;
  if (value.trial === undefined) {
    errors.push({ code: 'invalid_result', path: `${path}.trial`, message: 'the result trial payload is missing (the T011 mirror)' });
  } else {
    const trialResult = validateTrialRecord(value.trial, `${path}.trial`);
    if (trialResult.ok) {
      trial = trialResult.value;
    } else {
      errors.push(...trialResult.errors);
    }
  }

  let lineage: JobLineage | undefined;
  if (value.lineage === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.lineage`, message: 'the result lineage block is missing (L9 — results carry lineage)' });
  } else {
    const lineageResult = validateJobLineage(value.lineage, `${path}.lineage`);
    if (lineageResult.ok) {
      lineage = lineageResult.value;
    } else {
      errors.push(...lineageResult.errors);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      kind: 'result' as const,
      submission: value.submission as SubmissionId,
      job: value.job as JobId,
      worker: value.worker as WorkerRef,
      episode_index: value.episode_index as number,
      seed: value.seed as Seed,
      episode: value.episode as EpisodeId,
      digest: value.digest as string,
      trial: trial as TrialRecord,
      lineage: lineage as JobLineage,
    }),
  );
}

// ---------------------------------------------------------------------------
// The failure record
// ---------------------------------------------------------------------------

/**
 * One worker failure record — RETAINED, never dropped (L11). The kind is
 * the closed taxonomy; the detail is non-empty prose; the lineage block is
 * carried in full (the work order: "failure carries the kind + lineage").
 */
export interface JobFailure {
  readonly kind: 'failure';
  /** The submission that failed. */
  readonly submission: SubmissionId;
  /** The job the failed work belonged to (L9). */
  readonly job: JobId;
  /** The worker that reported the failure (L9). */
  readonly worker: WorkerRef;
  /** The closed failure-kind taxonomy member. */
  readonly failure_kind: FailureKind;
  /** Non-empty failure detail (an unexplained failure is not auditable). */
  readonly detail: string;
  /** The full L9/L12 lineage block. */
  readonly lineage: JobLineage;
}

/** Runtime guard for a job failure. */
export function isJobFailure(value: unknown): value is JobFailure {
  if (!isRecord(value)) return false;
  if (value.kind !== 'failure') return false;
  if (!isSubmissionId(value.submission)) return false;
  if (!isJobId(value.job)) return false;
  if (!isWorkerRef(value.worker)) return false;
  if (!isFailureKind(value.failure_kind)) return false;
  if (!isNonEmptyString(value.detail)) return false;
  if (!isJobLineage(value.lineage)) return false;
  return true;
}

/** Collect-all validation of an untrusted job failure record. */
export function validateJobFailure(value: unknown, path = 'failure'): ComputeResult<JobFailure> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ComputeError[] = [];

  if (value.kind !== 'failure') {
    errors.push({ code: 'invalid_failure', path: `${path}.kind`, message: `a failure record carries kind "failure" (got ${JSON.stringify(value.kind)})` });
  }

  if (value.submission === undefined) {
    errors.push({ code: 'invalid_failure', path: `${path}.submission`, message: 'the failure submission id is missing' });
  } else if (!isSubmissionId(value.submission)) {
    errors.push({ code: 'invalid_failure', path: `${path}.submission`, message: 'must be a non-empty submission id' });
  }

  if (value.job === undefined) {
    errors.push({ code: 'invalid_failure', path: `${path}.job`, message: 'the failure job ref is missing (L9)' });
  } else if (!isJobId(value.job)) {
    errors.push({ code: 'invalid_failure', path: `${path}.job`, message: 'must be a non-empty job id' });
  }

  if (value.worker === undefined) {
    errors.push({ code: 'invalid_failure', path: `${path}.worker`, message: 'the failure worker ref is missing (L9)' });
  } else if (!isWorkerRef(value.worker)) {
    errors.push({ code: 'invalid_failure', path: `${path}.worker`, message: 'must be a non-empty worker ref' });
  }

  if (value.failure_kind === undefined) {
    errors.push({ code: 'invalid_failure', path: `${path}.failure_kind`, message: 'the failure kind is missing (timeout | protocol | divergence | environment | cancelled)' });
  } else if (!isFailureKind(value.failure_kind)) {
    errors.push({ code: 'invalid_failure', path: `${path}.failure_kind`, message: `must be one of ${FAILURE_KINDS.join(' | ')}` });
  }

  if (value.detail === undefined) {
    errors.push({ code: 'invalid_failure', path: `${path}.detail`, message: 'the failure detail is missing — an unexplained failure is not auditable' });
  } else if (!isNonEmptyString(value.detail)) {
    errors.push({ code: 'invalid_failure', path: `${path}.detail`, message: 'must be a non-empty failure detail' });
  }

  let lineage: JobLineage | undefined;
  if (value.lineage === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.lineage`, message: 'the failure lineage block is missing (L9 — failures carry lineage)' });
  } else {
    const lineageResult = validateJobLineage(value.lineage, `${path}.lineage`);
    if (lineageResult.ok) {
      lineage = lineageResult.value;
    } else {
      errors.push(...lineageResult.errors);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      kind: 'failure' as const,
      submission: value.submission as SubmissionId,
      job: value.job as JobId,
      worker: value.worker as WorkerRef,
      failure_kind: value.failure_kind as FailureKind,
      detail: value.detail as string,
      lineage: lineage as JobLineage,
    }),
  );
}

// ---------------------------------------------------------------------------
// The outcome union + canonical serialization (byte-determinism law)
// ---------------------------------------------------------------------------

/** One submission outcome: a result or a failure (discriminated by `kind`). */
export type JobOutcome = JobResult | JobFailure;

/** Runtime guard for any outcome. */
export function isJobOutcome(value: unknown): value is JobOutcome {
  return isJobResult(value) || isJobFailure(value);
}

/** JSON-tree projection of a result record (compile-proven JSON safety, no casts). */
export function resultTree(result: JobResult): JsonObject {
  return {
    kind: 'result',
    submission: result.submission,
    job: result.job,
    worker: result.worker,
    episode_index: result.episode_index,
    seed: result.seed,
    episode: result.episode,
    digest: result.digest,
    trial: trialTree(result.trial),
    lineage: lineageTree(result.lineage),
  };
}

/** JSON-tree projection of a failure record (compile-proven JSON safety, no casts). */
export function failureTree(failure: JobFailure): JsonObject {
  return {
    kind: 'failure',
    submission: failure.submission,
    job: failure.job,
    worker: failure.worker,
    failure_kind: failure.failure_kind,
    detail: failure.detail,
    lineage: lineageTree(failure.lineage),
  };
}

/** Canonical JSON of any outcome — equal outcomes produce identical bytes. */
export function canonicalOutcomeJson(outcome: JobOutcome): string {
  return canonicalJson(outcome.kind === 'result' ? resultTree(outcome) : failureTree(outcome));
}

/**
 * The digest of one outcome — the run state's chain link (the T013
 * step-chain discipline applied to collected outcomes: the chain binds the
 * schedule and every outcome in arrival order; a resumed run provably
 * consumed the same outcomes).
 */
export function outcomeDigest(outcome: JobOutcome): string {
  return fnv1a32Hex(canonicalOutcomeJson(outcome));
}

/** Guard helper for the runner: validate any outcome (collect-all). */
export function validateJobOutcome(value: unknown, path = 'outcome'): ComputeResult<JobOutcome> {
  if (isRecord(value) && value.kind === 'result') return validateJobResult(value, path);
  if (isRecord(value) && value.kind === 'failure') return validateJobFailure(value, path);
  return fail('invalid_type', `${path} must carry kind "result" or "failure"`, path);
}
