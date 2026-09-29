/**
 * @tradrl/compute — the ComputePort: the injected substrate interface.
 *
 * THE SUBSTRATE IS A PORT, NEVER A PROCESS. This package ships NO worker
 * processes, NO queues, NO network clients (Work Order T014 non-scope is
 * explicit): "Distributed" here means the PROTOCOL (jobs, partitioning,
 * aggregation, failure semantics) is correct and deterministic — concrete
 * substrates bind later by implementing this interface and injecting it.
 *
 * The port's three operations (the work order's exact surface):
 *
 *   - `submit(task)` — hand one planned {@link ComputeTask} to the
 *     substrate. The substrate ACKNOWLEDGES with the task's own submission
 *     id (the scheduler mints ids deterministically; the port echoes, it
 *     never re-assigns — outcomes must map back to tasks).
 *   - `collect()` — the DELTA of job outcomes (results and failures)
 *     completed since the previous collect, in ANY order the substrate
 *     likes (the aggregate is order-independent) and WITH duplicates
 *     (at-least-once execution: re-execution of a task is safe because
 *     results are deterministic and the aggregate deduplicates by digest
 *     equality — a mismatched digest for the same key is a typed
 *     divergence error).
 *   - `cancel(submission)` — retract a submission; outcomes already
 *     collected stay collected (history is never rewritten — L11's spirit).
 *
 * Port failures carry the SUBSTRATE's own error vocabulary (plain string
 * codes — real queues name failure modes this package rightly does not);
 * the runner maps them onto the closed `port_error` code while preserving
 * code and message (the environmentFailure discipline of
 * @tradrl/rl-protocol).
 */

import { deepFreeze, isNonNegativeSafeInteger, isPositiveSafeInteger, isRecord, fnv1a32Hex } from './primitives';
import type { JsonObject } from './primitives';
import { fail, ok, type ComputeError, type ComputeResult } from './errors';
import type { ComputeErrorCode } from './errors';
import type { EpisodeJob, SeedRange } from './job';
import { isNonEmptySeedRange, validateEpisodeJob } from './job';
import { jobTree } from './job';
import type { JobId, SubmissionId } from './ids';
import { isSubmissionId } from './ids';

// ---------------------------------------------------------------------------
// The substrate error/result discipline (world-lane codes preserved)
// ---------------------------------------------------------------------------

/** A substrate error as this package sees it: the `code` vocabulary belongs to the SUBSTRATE's own lane. */
export interface PortError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** A substrate operation outcome, structurally identical to the environment lane's result shape. */
export type PortResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly PortError[] };

// ---------------------------------------------------------------------------
// The ComputeTask (the schedulable unit handed to the port)
// ---------------------------------------------------------------------------

/**
 * One planned unit of work: the FULL job (self-contained — a worker needs
 * the whole declaration), the worker slot the task serves, the worker
 * count of the schedule (submission ids derive from all three), and this
 * slot's partition of the job's seed range (the DECLARED partitioning —
 * never negotiated). The submission id is minted deterministically by
 * {@link deriveSubmissionId}: work-unit identity, not execution identity
 * (re-executions of the same work unit share the id — the at-least-once
 * discipline).
 */
export interface ComputeTask {
  readonly submission: SubmissionId;
  readonly job: EpisodeJob;
  /** The worker slot this task serves: a safe integer in `[0, worker_count)`. */
  readonly slot: number;
  /** The worker count of the schedule that planned this task. */
  readonly worker_count: number;
  /** This slot's partition of the job's seed range — non-empty (empty slots are not scheduled). */
  readonly seed_range: SeedRange;
}

/** Runtime guard for a compute task. */
export function isComputeTask(value: unknown): value is ComputeTask {
  if (!isRecord(value)) return false;
  if (!isSubmissionId(value.submission)) return false;
  if (typeof (value as Record<string, unknown>).job !== 'object' || value.job === null) return false;
  if (!isNonNegativeSafeInteger(value.slot)) return false;
  if (!isPositiveSafeInteger(value.worker_count)) return false;
  if (!(value.slot < (value.worker_count as number))) return false;
  if (!isNonEmptySeedRange(value.seed_range)) return false;
  // The embedded job is shape-checked by its own guard (defense in depth —
  // validators re-check deeply).
  const job = (value as Record<string, unknown>).job as Record<string, unknown>;
  if (!isRecord(job) || typeof job.job_id !== 'string' || (job.job_id as string).length === 0) return false;
  return true;
}

/**
 * The declared derivation of a task's submission id:
 * `sub-<fnv1a32(job_id|slot|worker_count)>`. Deterministic — the same
 * work unit (job + slot + schedule width) always carries the same id.
 */
export function deriveSubmissionId(job: JobId, slot: number, workerCount: number): SubmissionId {
  return `sub-${fnv1a32Hex(`${job}|${slot}|${workerCount}`)}` as SubmissionId;
}

// ---------------------------------------------------------------------------
// The ComputePort (interface ONLY — no implementation ships here)
// ---------------------------------------------------------------------------

/**
 * The injected compute substrate: submit / collect / cancel. THE PACKAGE
 * SHIPS NO IMPLEMENTATION — the reference scripted fake lives in
 * services/learning (test fixture); real substrates (queues, process
 * pools, schedulers) bind later behind this interface. Implementations
 * MUST:
 *   - acknowledge `submit` with the task's own `submission` id;
 *   - return only DELTA outcomes from `collect` (duplicates allowed —
 *     at-least-once; re-execution is safe because generation is
 *     deterministic);
 *   - keep already-collected outcomes immutable (`cancel` retracts
 *     pending work, never history).
 */
export interface ComputePort {
  /** Hand one planned task to the substrate; acknowledged with the task's own submission id. */
  submit(task: ComputeTask): PortResult<SubmissionId>;
  /** The outcomes (results and failures) completed since the previous collect, in any order, duplicates allowed. */
  collect(): PortResult<readonly unknown[]>;
  /** Retract a submission's pending work (already-collected outcomes stay). */
  cancel(submission: SubmissionId): PortResult<true>;
}

/**
 * Structural runtime guard for the ComputePort surface: an object carrying
 * the three operations with function type. Substrates may guard their own
 * richer surfaces; this checks only the frozen contract.
 */
export function isComputePort(value: unknown): value is ComputePort {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.submit === 'function' &&
    typeof candidate.collect === 'function' &&
    typeof candidate.cancel === 'function'
  );
}

/** Map a substrate failure onto the closed compute taxonomy (code/message preserved). */
export function portFailure<T>(errors: readonly PortError[]): ComputeResult<T> {
  if (errors.length === 0) {
    return fail('port_error', 'the compute port failed without errors (impossible by contract)');
  }
  const mapped: ComputeError[] = errors.map((error): ComputeError => ({
    code: 'port_error' as ComputeErrorCode,
    path: error.path,
    message: `[${error.code}] ${error.message}`,
  }));
  return { ok: false, errors: mapped };
}

// ---------------------------------------------------------------------------
// Canonical JSON tree (byte-determinism law)
// ---------------------------------------------------------------------------

/** JSON-tree projection of a compute task (compile-proven JSON safety, no casts). */
export function taskTree(task: ComputeTask): JsonObject {
  return {
    submission: task.submission,
    job: jobTree(task.job),
    slot: task.slot,
    worker_count: task.worker_count,
    seed_range: { start: task.seed_range.start, end: task.seed_range.end },
  };
}

/**
 * Collect-all validation of an untrusted compute task (the embedded job is
 * validated deeply through {@link validateEpisodeJob}; the partition
 * coherence against the DECLARED partitioning function is schedule.ts's
 * deep validator's business). On success the value is returned narrowed,
 * deeply frozen.
 */
export function validateComputeTask(value: unknown, path = 'task'): ComputeResult<ComputeTask> {
  if (!isRecord(value)) {
    return fail('invalid_type', `${path} must be an object`);
  }
  const jobResult = validateEpisodeJob(value.job, `${path}.job`);
  if (!jobResult.ok) return jobResult;
  if (value.submission === undefined) {
    return fail('missing_field', `the task submission id is missing`, `${path}.submission`);
  }
  if (!isSubmissionId(value.submission)) {
    return fail('invalid_field', 'must be a non-empty submission id', `${path}.submission`);
  }
  if (!isNonNegativeSafeInteger(value.slot)) {
    return fail('invalid_field', 'must be a non-negative safe integer', `${path}.slot`);
  }
  if (!isPositiveSafeInteger(value.worker_count)) {
    return fail('invalid_field', 'must be a positive safe integer', `${path}.worker_count`);
  }
  if (!((value.slot as number) < (value.worker_count as number))) {
    return fail('invalid_field', `slot (${String(value.slot)}) must be below worker_count (${String(value.worker_count)})`, `${path}.slot`);
  }
  if (!isNonEmptySeedRange(value.seed_range)) {
    return fail('invalid_field', 'must be a non-empty [start, end) range — empty slots are not scheduled', `${path}.seed_range`);
  }
  return ok(
    deepFreeze({
      submission: value.submission as SubmissionId,
      job: jobResult.value,
      slot: value.slot as number,
      worker_count: value.worker_count as number,
      seed_range: deepFreeze({ start: (value.seed_range as SeedRange).start, end: (value.seed_range as SeedRange).end }),
    }),
  );
}
