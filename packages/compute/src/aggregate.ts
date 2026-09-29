/**
 * @tradrl/compute — the AggregateProtocol (the canonical fold).
 *
 * THE DETERMINISM LAW (Work Order T014 — "the heart of this WO"):
 * "episode generation results are a PURE FUNCTION of (job specification,
 * seed, environment/policy script) — NEVER of scheduling order, worker
 * count, or timing. Aggregation folds results in a DECLARED canonical
 * order (e.g. trial-id-sorted) so that a 1-worker run and an N-worker run
 * over the same job set produce byte-identical aggregates."
 *
 * {@link aggregateEpisodes} implements the fold as a PURE function of
 * (schedule, outcome SET — never the outcome order):
 *
 *   1. every outcome is guard-validated (collect-all);
 *   2. every outcome maps to a PLANNED submission (`schedule_mismatch`);
 *   3. every result is coherent with its task: job ref, ABSOLUTE ordinal
 *      inside the task's partition (`result_out_of_range`), the declared
 *      seed derivation (`invalid_result`), and lineage EQUALITY with the
 *      job's own block (`lineage_mismatch` — L9);
 *   4. results group by (job, episode ordinal) key — the (job, seed)
 *      identity: duplicate submissions of the same key are DEDUPLICATED by
 *      digest equality (at-least-once execution is safe — re-execution is
 *      deterministic), while a mismatched digest OR contradicting trial
 *      bytes for the same key is a typed `divergence` error; the surviving
 *      representative is the canonically-first worker's copy, so the fold
 *      is independent of arrival order;
 *   5. the L11 coverage law: every job and every task has either full
 *      results or an EXPLANING FAILURE RECORD — a task with neither is a
 *      typed `failure_hidden` error (hiding a failed job is a typed error,
 *      never a silent drop);
 *   6. trials fold in the DECLARED canonical order (trial id ascending)
 *      into the experiment trial-log shape (the T011 TrialRecord mirror,
 *      paired with the job lineage — the T013 emission discipline), with
 *      trial-id and trajectory uniqueness enforced (`duplicate_trial` /
 *      `duplicate_trajectory`);
 *   7. failures fold into the FAILURE MANIFEST in canonical
 *      (job, submission, worker, kind, detail) order — retained records,
 *      never dropped (L11);
 *   8. the aggregate's own digest folds the canonical tree (L9) — equal
 *      aggregate content, identical bytes.
 */

import { deepFreeze, isDigest8, isRecord } from './primitives';
import type { JsonObject } from './primitives';
import { canonicalJson } from './primitives';
import { fnv1a32Hex } from './primitives';
import { fail, ok, type ComputeResult } from './errors';
import type { EpisodeJob, JobLineage } from './job';
import { lineageTree } from './job';
import { episodeSeedAt } from './partition';
import type { ComputeTask } from './port';
import type { JobFailure, JobOutcome, JobResult } from './outcome';
import { failureTree, validateJobOutcome } from './outcome';
import type { ComputeSchedule } from './schedule';
import { scheduleJobs, validateComputeSchedule } from './schedule';
import { trialTree } from './trial-mirror';
import type { TrialRecord } from './trial-mirror';
import type { ComputeRunId, ExperimentId, JobId, ProjectId, TenantId } from './ids';

// ---------------------------------------------------------------------------
// The aggregate record
// ---------------------------------------------------------------------------

/**
 * One aggregated trial entry: the experiments-lane trial record (the T011
 * mirror — proven against the REAL package by src/interop.test.ts) paired
 * with the job that generated it and the job's L9/L12 lineage block — the
 * T013 `TrainerTrial` emission discipline (record + lineage) carried into
 * the distributed lane.
 */
export interface AggregateTrial {
  readonly trial: TrialRecord;
  /** The job whose partition generated the evidence. */
  readonly job: JobId;
  /** The job's L9/L12 lineage block. */
  readonly lineage: JobLineage;
}

/**
 * The experiment's aggregated episode evidence: the trial log in DECLARED
 * canonical order (trial id ascending) plus the FAILURE MANIFEST (L11 —
 * every worker failure is a retained record) and the aggregate's own
 * digest. The record is worker-count-independent by construction: worker
 * refs, submission ids and arrival order never enter the fold.
 */
export interface EpisodeAggregate {
  readonly run: ComputeRunId;
  readonly experiment: ExperimentId;
  /** Tenant scope (L12). */
  readonly tenant: TenantId;
  /** Project continuity root (L15). */
  readonly project: ProjectId;
  /** The trial log in canonical trial-id order. */
  readonly trials: readonly AggregateTrial[];
  /** The failure manifest in canonical (job, submission, worker, kind, detail) order. */
  readonly failures: readonly JobFailure[];
  /** The digest of the canonical aggregate tree (8-char lowercase hex — L9). */
  readonly digest: string;
}

/** Runtime guard for a structurally valid, canonically-ordered aggregate. */
export function isEpisodeAggregate(value: unknown): value is EpisodeAggregate {
  if (!isRecord(value)) return false;
  if (typeof value.run !== 'string' || value.run.length === 0) return false;
  if (typeof value.experiment !== 'string' || value.experiment.length === 0) return false;
  if (typeof value.tenant !== 'string' || value.tenant.length === 0) return false;
  if (typeof value.project !== 'string' || value.project.length === 0) return false;
  if (!isDigest8(value.digest)) return false;
  if (!Array.isArray(value.trials)) return false;
  let previousTrialId: string | null = null;
  for (const entry of value.trials as readonly unknown[]) {
    if (!isRecord(entry)) return false;
    if (!isRecord(entry.trial) || typeof (entry.trial as Record<string, unknown>).trial_id !== 'string') return false;
    if (typeof entry.job !== 'string' || (entry.job as string).length === 0) return false;
    if (!isRecord(entry.lineage)) return false;
    const trialId = (entry.trial as Record<string, unknown>).trial_id as string;
    if (previousTrialId !== null && !(previousTrialId < trialId)) return false; // canonical order is law
    previousTrialId = trialId;
  }
  if (!Array.isArray(value.failures)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The canonical fold
// ---------------------------------------------------------------------------

/** The canonical comparator of failure-manifest entries (total, declared). */
function failureComparator(a: JobFailure, b: JobFailure): number {
  if (a.job !== b.job) return a.job < b.job ? -1 : 1;
  if (a.submission !== b.submission) return a.submission < b.submission ? -1 : 1;
  if (a.worker !== b.worker) return a.worker < b.worker ? -1 : 1;
  if (a.failure_kind !== b.failure_kind) return a.failure_kind < b.failure_kind ? -1 : 1;
  return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
}

/** One (job, ordinal) key's collected results, pending the divergence check. */
interface ResultGroup {
  readonly task: ComputeTask;
  readonly results: JobResult[];
}

/**
 * Fold the collected outcomes of a validated schedule into the experiment's
 * {@link EpisodeAggregate} — the canonical, order-independent, worker-count-
 * independent fold (see the module header for the law chain). Inputs are
 * UNTRUSTED: the schedule goes through the deep validator; every outcome
 * through its record validator; semantic coherence (partition range, seed
 * derivation, lineage equality, divergence, coverage) is enforced here.
 */
export function aggregateEpisodes(schedule: unknown, outcomes: readonly unknown[]): ComputeResult<EpisodeAggregate> {
  const scheduleResult = validateComputeSchedule(schedule);
  if (!scheduleResult.ok) return scheduleResult;
  const plan = scheduleResult.value;

  if (!Array.isArray(outcomes)) {
    return fail('invalid_type', 'the collected outcomes must be an array', 'outcomes');
  }

  // 1. Validate every outcome (collect-all, indexed paths).
  const validated: JobOutcome[] = [];
  for (let index = 0; index < outcomes.length; index++) {
    const outcomeResult = validateJobOutcome(outcomes[index], `outcomes[${index}]`);
    if (!outcomeResult.ok) return outcomeResult;
    validated.push(outcomeResult.value);
  }

  // 2. Map submissions to tasks; verify per-outcome coherence.
  const taskBySubmission = new Map<string, ComputeTask>();
  for (const task of plan.tasks) taskBySubmission.set(task.submission, task);

  const groups = new Map<string, ResultGroup>();
  const failures: JobFailure[] = [];
  const outcomesPerJob = new Map<string, number>();

  for (const outcome of validated) {
    const task = taskBySubmission.get(outcome.submission);
    if (task === undefined) {
      return fail(
        'schedule_mismatch',
        `the outcome of submission "${outcome.submission}" (job "${outcome.job}") names no planned task of run "${plan.run}" — outcomes map onto the schedule, never beside it`,
        'outcomes',
      );
    }
    const jobCount = outcomesPerJob.get(outcome.job) ?? 0;
    outcomesPerJob.set(outcome.job, jobCount + 1);

    if (outcome.kind === 'failure') {
      if (outcome.job !== task.job.job_id) {
        return fail(
          'schedule_mismatch',
          `the failure names job "${outcome.job}" but its submission "${outcome.submission}" was planned for job "${task.job.job_id}"`,
          'outcomes',
        );
      }
      if (canonicalJson(lineageTree(outcome.lineage)) !== canonicalJson(lineageTree(task.job.lineage))) {
        return fail(
          'lineage_mismatch',
          `the failure of job "${task.job.job_id}" (submission "${task.submission}") carries a lineage block that differs from its job's own (L9 — a worker failure binds the declared lineage, never a private one)`,
          'outcomes',
        );
      }
      failures.push(outcome);
      continue;
    }

    // Result coherence: job ref, absolute ordinal within the partition,
    // declared seed derivation, lineage equality with the job's own block.
    if (outcome.job !== task.job.job_id) {
      return fail(
        'schedule_mismatch',
        `the result names job "${outcome.job}" but its submission "${outcome.submission}" was planned for job "${task.job.job_id}"`,
        'outcomes',
      );
    }
    if (outcome.episode_index < task.seed_range.start || outcome.episode_index >= task.seed_range.end) {
      return fail(
        'result_out_of_range',
        `the result's episode ordinal ${outcome.episode_index} lies outside its task's declared partition [${task.seed_range.start}, ${task.seed_range.end}) of job "${task.job.job_id}" — the partition is law`,
        'outcomes',
      );
    }
    const derivedSeed = episodeSeedAt(task.job, outcome.episode_index);
    if (outcome.seed !== derivedSeed) {
      return fail(
        'invalid_result',
        `the result of job "${task.job.job_id}" ordinal ${outcome.episode_index} carries seed "${outcome.seed}" but the declared derivation yields "${derivedSeed}" — no ambient randomness (the seed discipline is law)`,
        'outcomes',
      );
    }
    if (canonicalJson(lineageTree(outcome.lineage)) !== canonicalJson(lineageTree(task.job.lineage))) {
      return fail(
        'lineage_mismatch',
        `the result of job "${task.job.job_id}" ordinal ${outcome.episode_index} carries a lineage block that differs from its job's own (L9 — evidence binds the declared lineage, never a private one)`,
        'outcomes',
      );
    }

    const key = `${outcome.job}#${outcome.episode_index}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { task, results: [outcome] });
    } else {
      group.results.push(outcome);
    }
  }

  // 3. Divergence + dedup per (job, ordinal) key.
  const representative = new Map<string, JobResult>();
  for (const [key, group] of groups) {
    const first = group.results[0] as JobResult;
    for (let index = 1; index < group.results.length; index++) {
      const other = group.results[index] as JobResult;
      if (other.digest !== first.digest) {
        return fail(
          'divergence',
          `job "${first.job}" episode ordinal ${first.episode_index}: duplicate results carry digests "${first.digest}" and "${other.digest}" — same (job, seed) key, different evidence bytes (determinism is law; re-execution must be byte-identical)`,
          'outcomes',
        );
      }
      if (canonicalJson(trialTree(other.trial)) !== canonicalJson(trialTree(first.trial))) {
        return fail(
          'divergence',
          `job "${first.job}" episode ordinal ${first.episode_index}: duplicate results agree on digest "${first.digest}" but carry different trial records — contradicting evidence for one (job, seed) key`,
          'outcomes',
        );
      }
      if (other.episode !== first.episode) {
        return fail(
          'divergence',
          `job "${first.job}" episode ordinal ${first.episode_index}: duplicate results claim different episode ids ("${first.episode}" vs "${other.episode}") — the same seed drives one world`,
          'outcomes',
        );
      }
    }
    // The canonical representative: the lexicographically-first
    // (worker, submission) copy — arrival order never decides.
    let chosen = first;
    for (const candidate of group.results) {
      if (candidate.worker < chosen.worker || (candidate.worker === chosen.worker && candidate.submission < chosen.submission)) {
        chosen = candidate;
      }
    }
    representative.set(key, chosen);
  }

  // 4. The L11 coverage law.
  const failuresBySubmission = new Map<string, number>();
  for (const failure of failures) {
    const count = failuresBySubmission.get(failure.submission) ?? 0;
    failuresBySubmission.set(failure.submission, count + 1);
  }
  const jobs = scheduleJobs(plan);
  for (const job of jobs.values()) {
    if ((outcomesPerJob.get(job.job_id) ?? 0) === 0) {
      return fail(
        'failure_hidden',
        `job "${job.job_id}" has neither results nor a failure record — hiding a failed job is a typed error (L11: search history is retained, never silently pruned)`,
        'outcomes',
      );
    }
  }
  for (const task of plan.tasks) {
    let covered = 0;
    for (let ordinal = task.seed_range.start; ordinal < task.seed_range.end; ordinal++) {
      if (representative.has(`${task.job.job_id}#${ordinal}`)) covered += 1;
    }
    if (covered < task.seed_range.end - task.seed_range.start && !failuresBySubmission.has(task.submission)) {
      return fail(
        'failure_hidden',
        `job "${task.job.job_id}" slot ${task.slot} (submission "${task.submission}"): ${task.seed_range.end - task.seed_range.start - covered} episode ordinal(s) of partition [${task.seed_range.start}, ${task.seed_range.end}) produced no result and no failure record explains the gap (L11)`,
        'outcomes',
      );
    }
  }

  // 5. The canonical trial fold.
  const entries: AggregateTrial[] = [];
  const trialIds = new Set<string>();
  const trajectories = new Set<string>();
  for (const result of representative.values()) {
    if (trialIds.has(result.trial.trial_id)) {
      return fail(
        'duplicate_trial',
        `trial id "${result.trial.trial_id}" is claimed by two distinct episodes — honest derivation from (job, ordinal) cannot collide`,
        'outcomes',
      );
    }
    trialIds.add(result.trial.trial_id);
    if (result.trial.trajectory !== null) {
      if (trajectories.has(result.trial.trajectory)) {
        return fail(
          'duplicate_trajectory',
          `trajectory "${result.trial.trajectory}" is claimed by two distinct trials — an experience stream belongs to one trial`,
          'outcomes',
        );
      }
      trajectories.add(result.trial.trajectory);
    }
    const task = taskBySubmission.get(result.submission) as ComputeTask;
    entries.push(deepFreeze({ trial: result.trial, job: result.job, lineage: task.job.lineage }));
  }
  // DECLARED canonical order: trial id ascending (code-unit order).
  entries.sort((a, b) => (a.trial.trial_id < b.trial.trial_id ? -1 : a.trial.trial_id > b.trial.trial_id ? 1 : 0));

  // 6. The failure manifest (L11): deduplicate exact-equal records, sort canonically.
  const seenFailureBytes = new Set<string>();
  const manifest: JobFailure[] = [];
  for (const failure of failures) {
    const bytes = canonicalJson(failureTree(failure));
    if (seenFailureBytes.has(bytes)) continue;
    seenFailureBytes.add(bytes);
    manifest.push(failure);
  }
  manifest.sort(failureComparator);

  // 7. The aggregate's own digest (L9) over the canonical tree sans digest.
  const anchor = plan.tasks.length > 0 ? (plan.tasks[0] as ComputeTask).job.lineage : undefined;
  if (anchor === undefined) {
    return fail('invalid_schedule', 'the schedule plans no tasks — an aggregate of nothing is inexpressible (a job set carries work)', 'schedule');
  }
  const withoutDigest: EpisodeAggregate = deepFreeze({
    run: plan.run,
    experiment: anchor.experiment,
    tenant: anchor.tenant,
    project: anchor.project,
    trials: entries,
    failures: manifest,
    digest: '00000000',
  });
  const digest = aggregateDigest(withoutDigest);

  return ok(
    deepFreeze({
      run: plan.run,
      experiment: anchor.experiment,
      tenant: anchor.tenant,
      project: anchor.project,
      trials: entries,
      failures: manifest,
      digest,
    }),
  );
}

// ---------------------------------------------------------------------------
// Canonical serialization + digest verification (byte-determinism law)
// ---------------------------------------------------------------------------

/** JSON-tree projection of an aggregate-trial entry (compile-proven JSON safety). */
export function aggregateTrialTree(entry: AggregateTrial): JsonObject {
  return {
    trial: trialTree(entry.trial),
    job: entry.job,
    lineage: lineageTree(entry.lineage),
  };
}

/** JSON-tree projection of the aggregate (compile-proven JSON safety). */
export function aggregateTree(aggregate: EpisodeAggregate): JsonObject {
  return {
    run: aggregate.run,
    experiment: aggregate.experiment,
    tenant: aggregate.tenant,
    project: aggregate.project,
    trials: aggregate.trials.map((entry) => aggregateTrialTree(entry)),
    failures: aggregate.failures.map((failure) => failureTree(failure)),
    digest: aggregate.digest,
  };
}

/** Canonical JSON of an aggregate — equal aggregates produce identical bytes. */
export function canonicalAggregateJson(aggregate: EpisodeAggregate): string {
  return canonicalJson(aggregateTree(aggregate));
}

/** The digest of the canonical aggregate tree SANS the digest field (the fold input). */
export function aggregateDigest(aggregate: EpisodeAggregate): string {
  const tree: JsonObject = {
    run: aggregate.run,
    experiment: aggregate.experiment,
    tenant: aggregate.tenant,
    project: aggregate.project,
    trials: aggregate.trials.map((entry) => aggregateTrialTree(entry)),
    failures: aggregate.failures.map((failure) => failureTree(failure)),
  };
  return fnv1a32Hex(canonicalJson(tree));
}

/**
 * Verify an untrusted aggregate's digest: recompute the fold over the
 * canonical tree and compare. A tampered record fails with
 * `chain_mismatch` — never silently.
 */
export function verifyAggregateDigest(value: unknown): ComputeResult<true> {
  if (!isEpisodeAggregate(value)) {
    return fail('invalid_type', 'verifyAggregateDigest requires a structurally valid aggregate');
  }
  const expected = aggregateDigest(value);
  if (value.digest !== expected) {
    return fail(
      'chain_mismatch',
      `the aggregate's digest is "${value.digest}" but its content folds to "${expected}" — the record was tampered with`,
    );
  }
  return ok(true);
}
