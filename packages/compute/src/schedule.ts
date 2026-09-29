/**
 * @tradrl/compute — the SchedulerContract and the deterministic schedule.
 *
 * `planComputeSchedule` is a PURE FUNCTION of (run id, job set, worker
 * count): every job's seed range is partitioned across the worker slots by
 * the DECLARED partitioning function (partition.ts), one task per
 * non-empty slot, tasks sorted CANONICALLY by (job id, slot) — so a
 * shuffled job set plans the byte-identical schedule (scheduling order is
 * never meaning, the work unit identity is). The schedule is itself
 * deterministic + serializable: `canonicalScheduleJson` yields identical
 * bytes for equal schedules, and {@link scheduleChainSeed} anchors the run
 * state's outcome chain (the T013 declaration-chain discipline).
 *
 * The job set is ONE EXPERIMENT'S BATCH: all jobs must share the
 * experiment, tenant and project (L12 — mixing tenants in one schedule is
 * an isolation violation; one aggregate, one experiment). Duplicate job
 * ids refuse planning (`job_invalid`).
 */

import { deepFreeze, isPositiveSafeInteger, isRecord } from './primitives';
import type { JsonObject } from './primitives';
import { canonicalJson } from './primitives';
import { fnv1a32Hex } from './primitives';
import { fail, ok, type ComputeError, type ComputeResult } from './errors';
import type { EpisodeJob } from './job';
import { validateEpisodeJob } from './job';
import { jobTree } from './job';
import { isEmptyPartition, partitionSeedRange } from './partition';
import type { ComputeTask } from './port';
import { deriveSubmissionId, taskTree, validateComputeTask } from './port';
import type { ComputeRunId, JobId } from './ids';
import { isComputeRunId, isJobId } from './ids';

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

/**
 * The planned schedule: the run identity, the worker count, and the tasks
 * in CANONICAL (job id, slot) order. Tasks carry the full job records —
 * the schedule is self-contained and serializable.
 */
export interface ComputeSchedule {
  readonly run: ComputeRunId;
  /** The worker count the plan partitions across (positive safe integer). */
  readonly worker_count: number;
  /** The planned tasks, canonically ordered by (job id, slot). */
  readonly tasks: readonly ComputeTask[];
}

/** Runtime guard for the schedule shape. */
export function isComputeSchedule(value: unknown): value is ComputeSchedule {
  if (!isRecord(value)) return false;
  if (!isComputeRunId(value.run)) return false;
  if (!isPositiveSafeInteger(value.worker_count)) return false;
  if (!Array.isArray(value.tasks)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The planner (the pure function the SchedulerContract names)
// ---------------------------------------------------------------------------

/**
 * Plan the job set for `workerCount` workers — the declared pure planner.
 * Laws enforced:
 *   - every job passes {@link validateEpisodeJob} (collect-all across the
 *     set, paths `jobs[i]...`);
 *   - job ids are unique (`job_invalid` on duplicates);
 *   - the set is ONE experiment's batch: shared experiment, tenant and
 *     project (`lineage_mismatch` — L12 tenant isolation);
 *   - `workerCount` is a positive safe integer;
 *   - every task's seed range is the DECLARED partition of its job at its
 *     slot; empty slots are NOT scheduled (no work, no submission).
 *
 * Deterministic: the same (run, job set as a set, worker count) plans the
 * byte-identical schedule regardless of the job set's input order — tasks
 * are emitted in canonical (job id, slot) order.
 */
export function planComputeSchedule(run: unknown, jobs: readonly unknown[], workerCount: number): ComputeResult<ComputeSchedule> {
  if (!isComputeRunId(run)) {
    return fail('invalid_id', 'the schedule run id must be a non-empty compute run id', 'run');
  }
  if (!isPositiveSafeInteger(workerCount)) {
    return fail('invalid_field', 'workerCount must be a positive safe integer', 'worker_count');
  }
  if (!Array.isArray(jobs)) {
    return fail('invalid_type', 'the job set must be an array of episode jobs', 'jobs');
  }

  const validated: EpisodeJob[] = [];
  const errors: ComputeError[] = [];
  const seenJobIds = new Set<string>();

  for (let index = 0; index < jobs.length; index++) {
    const jobResult = validateEpisodeJob(jobs[index], `jobs[${index}]`);
    if (!jobResult.ok) {
      errors.push(...jobResult.errors);
      continue;
    }
    const job = jobResult.value;
    if (seenJobIds.has(job.job_id)) {
      errors.push({ code: 'job_invalid', path: `jobs[${index}].job_id`, message: `job id "${job.job_id}" appears twice in the job set — one job, one id` });
      continue;
    }
    seenJobIds.add(job.job_id);
    validated.push(job);
  }
  if (errors.length > 0) return { ok: false, errors };

  if (validated.length > 0) {
    const first = validated[0] as EpisodeJob;
    for (let index = 1; index < validated.length; index++) {
      const job = validated[index] as EpisodeJob;
      if (
        job.lineage.experiment !== first.lineage.experiment ||
        job.lineage.tenant !== first.lineage.tenant ||
        job.lineage.project !== first.lineage.project
      ) {
        return fail(
          'lineage_mismatch',
          `jobs[${index}] (${job.job_id}) names experiment "${job.lineage.experiment}" / tenant "${job.lineage.tenant}" / project "${job.lineage.project}", but the job set belongs to "${first.lineage.experiment}" / "${first.lineage.tenant}" / "${first.lineage.project}" — one schedule, one experiment's batch (L12 tenant isolation; a batch mixing scopes cannot aggregate into one experiment trial log)`,
          `jobs[${index}].lineage`,
        );
      }
    }
  }

  const tasks: ComputeTask[] = [];
  for (const job of validated) {
    for (let slot = 0; slot < workerCount; slot++) {
      const partition = partitionSeedRange(job.seed_range, workerCount, slot);
      if (!partition.ok) return partition;
      if (isEmptyPartition(partition.value)) continue; // no work, no submission
      tasks.push(
        deepFreeze({
          submission: deriveSubmissionId(job.job_id, slot, workerCount),
          job,
          slot,
          worker_count: workerCount,
          seed_range: partition.value,
        }),
      );
    }
  }

  // Canonical order: (job id, slot) — input order is never meaning.
  tasks.sort((a, b) => (a.job.job_id === b.job.job_id ? a.slot - b.slot : a.job.job_id < b.job.job_id ? -1 : 1));

  return ok(deepFreeze({ run, worker_count: workerCount, tasks }));
}

// ---------------------------------------------------------------------------
// The deep schedule validator (untrusted input — the runner's entry gate)
// ---------------------------------------------------------------------------

/**
 * Deep validation of an untrusted schedule: every task passes
 * {@link validateComputeTask}; job ids are unique; the set is one
 * experiment's batch; and PER JOB the planned slots are exactly the
 * non-empty partitions of the DECLARED partitioning function — duplicate
 * slots fire `seed_overlap` (overlapping subranges), missing non-empty
 * slots fire `seed_gap` (uncovered ordinals), and a task whose subrange
 * is not the declared partition at its slot fires `invalid_schedule`.
 * Submission ids must equal the declared derivation.
 */
export function validateComputeSchedule(value: unknown, path = 'schedule'): ComputeResult<ComputeSchedule> {
  if (!isRecord(value)) {
    return fail('invalid_type', `${path} must be an object`, path);
  }
  if (value.run === undefined) {
    return fail('invalid_id', 'the schedule run id is missing', `${path}.run`);
  }
  if (!isComputeRunId(value.run)) {
    return fail('invalid_id', 'must be a non-empty compute run id', `${path}.run`);
  }
  if (value.worker_count === undefined) {
    return fail('invalid_field', 'the schedule worker count is missing', `${path}.worker_count`);
  }
  if (!isPositiveSafeInteger(value.worker_count)) {
    return fail('invalid_field', 'must be a positive safe integer', `${path}.worker_count`);
  }
  if (!Array.isArray(value.tasks)) {
    return fail('invalid_field', 'must be an array of compute tasks', `${path}.tasks`);
  }

  const workerCount = value.worker_count as number;
  const errors: ComputeError[] = [];
  const tasks: ComputeTask[] = [];

  for (let index = 0; index < (value.tasks as readonly unknown[]).length; index++) {
    const taskResult = validateComputeTask((value.tasks as readonly unknown[])[index], `${path}.tasks[${index}]`);
    if (!taskResult.ok) {
      errors.push(...taskResult.errors);
      continue;
    }
    const task = taskResult.value;
    if (task.worker_count !== workerCount) {
      errors.push({
        code: 'invalid_schedule',
        path: `${path}.tasks[${index}].worker_count`,
        message: `task worker_count (${task.worker_count}) must equal the schedule's (${workerCount})`,
      });
      continue;
    }
    if (task.submission !== deriveSubmissionId(task.job.job_id, task.slot, task.worker_count)) {
      errors.push({
        code: 'invalid_schedule',
        path: `${path}.tasks[${index}].submission`,
        message: `submission id "${task.submission}" is not the declared derivation sub-<fnv1a32(job|slot|worker_count)> for job "${task.job.job_id}" slot ${task.slot}`,
      });
      continue;
    }
    tasks.push(task);
  }
  if (errors.length > 0) return { ok: false, errors };

  // Per job: the planned slots must be exactly the non-empty declared partitions.
  const byJob = new Map<string, ComputeTask[]>();
  for (const task of tasks) {
    const existing = byJob.get(task.job.job_id);
    if (existing === undefined) {
      byJob.set(task.job.job_id, [task]);
    } else {
      existing.push(task);
    }
  }
  for (const [jobId, jobTasks] of byJob) {
    const job = (jobTasks[0] as ComputeTask).job;
    // Set-coherence (L12): every task of a job must carry the job's own record.
    for (let index = 0; index < jobTasks.length; index++) {
      const task = jobTasks[index] as ComputeTask;
      if (canonicalJson(jobTree(task.job)) !== canonicalJson(jobTree(job))) {
        return fail(
          'invalid_schedule',
          `two tasks claim job "${jobId}" with different job records — a job id names ONE declaration`,
          `${path}.tasks`,
        );
      }
    }

    const seenSlots = new Set<number>();
    for (const task of jobTasks) {
      if (seenSlots.has(task.slot)) {
        return fail(
          'seed_overlap',
          `job "${jobId}" is scheduled twice at slot ${task.slot} — the declared partition gives every slot ONE subrange; overlapping subranges violate the seed discipline (total coverage, zero overlap)`,
          `${path}.tasks`,
        );
      }
      seenSlots.add(task.slot);
      const declared = partitionSeedRange(job.seed_range, workerCount, task.slot);
      if (!declared.ok) return declared;
      if (
        task.seed_range.start !== declared.value.start ||
        task.seed_range.end !== declared.value.end
      ) {
        return fail(
          'invalid_schedule',
          `job "${jobId}" slot ${task.slot} carries subrange [${task.seed_range.start}, ${task.seed_range.end}) but the DECLARED partition at that slot is [${declared.value.start}, ${declared.value.end}) — the partitioning function is protocol, not configuration`,
          `${path}.tasks`,
        );
      }
    }
    for (let slot = 0; slot < workerCount; slot++) {
      const declared = partitionSeedRange(job.seed_range, workerCount, slot);
      if (!declared.ok) return declared;
      if (isEmptyPartition(declared.value)) continue;
      if (!seenSlots.has(slot)) {
        return fail(
          'seed_gap',
          `job "${jobId}" has no task for slot ${slot}, whose DECLARED partition [${declared.value.start}, ${declared.value.end}) is non-empty — uncovered ordinals violate the seed discipline (total coverage, zero overlap)`,
          `${path}.tasks`,
        );
      }
    }
  }

  // Set coherence: one experiment's batch (L12).
  if (tasks.length > 0) {
    const first = (tasks[0] as ComputeTask).job;
    for (let index = 1; index < tasks.length; index++) {
      const job = (tasks[index] as ComputeTask).job;
      if (
        job.lineage.experiment !== first.lineage.experiment ||
        job.lineage.tenant !== first.lineage.tenant ||
        job.lineage.project !== first.lineage.project
      ) {
        return fail(
          'lineage_mismatch',
          `the schedule mixes experiments/tenants/projects ("${job.lineage.experiment}" vs "${first.lineage.experiment}") — one schedule, one experiment's batch (L12)`,
          `${path}.tasks[${index}].job.lineage`,
        );
      }
    }
  }

  return ok(deepFreeze({ run: value.run as ComputeRunId, worker_count: workerCount, tasks: deepFreeze([...tasks]) }));
}

// ---------------------------------------------------------------------------
// The SchedulerContract
// ---------------------------------------------------------------------------

/**
 * The interface a concrete scheduler implements (the reference planner is
 * {@link planComputeSchedule}; external orchestrators and T015's batch
 * spawner sit behind the same operation). Implementations MUST keep
 * planning a pure, deterministic function of (run, job set, worker count)
 * — the schedule is serializable and byte-stable.
 */
export interface SchedulerContract {
  /** Plan the job set for N workers (pure; deterministic; serializable). */
  plan(run: unknown, jobs: readonly unknown[], workerCount: number): ComputeResult<ComputeSchedule>;
}

/** Runtime guard for the SchedulerContract surface. */
export function isSchedulerContract(value: unknown): value is SchedulerContract {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>).plan === 'function';
}

// ---------------------------------------------------------------------------
// Canonical serialization (byte-determinism law)
// ---------------------------------------------------------------------------

/** JSON-tree projection of a schedule (compile-proven JSON safety, no casts). */
export function scheduleTree(schedule: ComputeSchedule): JsonObject {
  return {
    run: schedule.run,
    worker_count: schedule.worker_count,
    tasks: schedule.tasks.map((task) => taskTree(task)),
  };
}

/** Canonical JSON of a validated schedule — equal schedules produce identical bytes. */
export function canonicalScheduleJson(schedule: ComputeSchedule): string {
  return canonicalJson(scheduleTree(schedule));
}

/**
 * The schedule's chain seed: folds the canonical schedule JSON (binds run
 * id, worker count and every task — L9). The run state's outcome chain
 * seeds from this value (the T013 declaration-chain discipline).
 */
export function scheduleChainSeed(schedule: ComputeSchedule): string {
  return fnv1a32Hex(canonicalScheduleJson(schedule));
}

/** The jobs of a schedule, keyed by id (the aggregate's job registry). */
export function scheduleJobs(schedule: ComputeSchedule): ReadonlyMap<JobId, EpisodeJob> {
  const jobs = new Map<JobId, EpisodeJob>();
  for (const task of schedule.tasks) {
    if (!jobs.has(task.job.job_id)) jobs.set(task.job.job_id, task.job);
  }
  return jobs;
}
