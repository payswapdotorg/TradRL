/**
 * SchedulerContract tests: the pure planner's determinism (byte-identical
 * schedules from shuffled job sets), canonical (job id, slot) task order,
 * the declared-partition task ranges, set coherence (one experiment's
 * batch — L12), duplicate job ids, and the DEEP validator's trip wires
 * (seed_overlap on duplicated slots, seed_gap on missing slots,
 * invalid_schedule on mutated ranges and submission ids).
 */

import { describe, expect, it } from 'vitest';

import * as compute from './index';

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

function jobLiteral(jobId: string, arm: string, start: number, end: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    job_id: jobId,
    lineage: {
      experiment: 'exp-schedule',
      environment_config: 'envcfg-schedule',
      policy: 'policy:scripted@1',
      reward_models: [],
      tenant: 'tenant-schedule',
      project: 'prj-schedule',
      ...('lineage' in overrides ? (overrides.lineage as Record<string, unknown>) : {}),
    },
    arm,
    seed_base: `seed-${jobId}`,
    seed_range: { start, end },
    step_budget: 12,
    driver: {
      actor: 'agent-schedule',
      step_ms: 100,
      runtime: '@tradrl/learning/compute@1',
      body_versions: ['body@1'],
      substrates: ['sub@1'],
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'lineage')),
  };
}

function jobSet(): readonly Record<string, unknown>[] {
  return [
    jobLiteral('job-alpha', 'arm-control', 0, 6),
    jobLiteral('job-beta', 'arm-treatment', 6, 10),
  ];
}

describe('planComputeSchedule (the pure planner)', () => {
  it('partitions every job across the slots by the DECLARED function; empty slots are not scheduled', () => {
    const schedule = unwrap(compute.planComputeSchedule('run-schedule' as compute.ComputeRunId, jobSet(), 4));
    expect(schedule.worker_count).toBe(4);
    expect(schedule.tasks.length).toBe(8); // both jobs partition into 4 non-empty subranges

    const byJob = new Map<string, compute.ComputeTask[]>();
    for (const task of schedule.tasks) {
      expect(task.worker_count).toBe(4);
      expect(task.submission).toBe(compute.deriveSubmissionId(task.job.job_id, task.slot, 4));
      const existing = byJob.get(task.job.job_id);
      if (existing === undefined) byJob.set(task.job.job_id, [task]);
      else existing.push(task);
    }
    for (const [jobId, tasks] of byJob) {
      const job = unwrap(compute.validateEpisodeJob(tasks[0]?.job));
      for (const task of tasks) {
        const declared = unwrap(compute.partitionSeedRange(job.seed_range, 4, task.slot));
        expect(task.seed_range).toEqual(declared);
      }
      expect(tasks.map((task) => task.slot)).toEqual([0, 1, 2, 3]);
      expect(jobId).toBeTruthy();
    }
  });

  it('worker counts above the ordinals schedule only the non-empty slots', () => {
    const schedule = unwrap(compute.planComputeSchedule('run-sparse' as compute.ComputeRunId, [jobLiteral('job-tiny', 'arm-control', 0, 2)], 5));
    expect(schedule.tasks.length).toBe(2);
    expect(schedule.tasks.map((task) => task.slot)).toEqual([0, 1]);
    expect(schedule.tasks[0]?.seed_range).toEqual({ start: 0, end: 1 });
    expect(schedule.tasks[1]?.seed_range).toEqual({ start: 1, end: 2 });
  });

  it("DETERMINISM: the same job set plans byte-identical schedules, twice — and input order is never meaning", () => {
    const first = unwrap(compute.planComputeSchedule('run-det' as compute.ComputeRunId, jobSet(), 3));
    const second = unwrap(compute.planComputeSchedule('run-det' as compute.ComputeRunId, jobSet(), 3));
    expect(compute.canonicalScheduleJson(first)).toBe(compute.canonicalScheduleJson(second));

    const shuffled = [jobSet()[1], jobSet()[0]] as readonly Record<string, unknown>[];
    const fromShuffled = unwrap(compute.planComputeSchedule('run-det' as compute.ComputeRunId, shuffled, 3));
    expect(compute.canonicalScheduleJson(fromShuffled)).toBe(compute.canonicalScheduleJson(first));

    // Canonical task order: (job id, slot).
    const keys = first.tasks.map((task) => `${task.job.job_id}#${task.slot}`);
    expect(keys).toEqual([...keys].sort());
    expect(compute.isDeeplyFrozen(first)).toBe(true);
  });

  it('different run ids or worker counts plan different schedules (chain seeds differ)', () => {
    const base = unwrap(compute.planComputeSchedule('run-a' as compute.ComputeRunId, jobSet(), 2));
    const otherRun = unwrap(compute.planComputeSchedule('run-b' as compute.ComputeRunId, jobSet(), 2));
    const otherWidth = unwrap(compute.planComputeSchedule('run-a' as compute.ComputeRunId, jobSet(), 3));
    expect(compute.scheduleChainSeed(base)).not.toBe(compute.scheduleChainSeed(otherRun));
    expect(compute.scheduleChainSeed(base)).not.toBe(compute.scheduleChainSeed(otherWidth));
    expect(compute.scheduleChainSeed(base)).toBe(compute.scheduleChainSeed(unwrap(compute.planComputeSchedule('run-a' as compute.ComputeRunId, jobSet(), 2))));
  });

  it('typed errors: bad run id, bad worker count, non-array job set, duplicate job ids', () => {
    expect(compute.planComputeSchedule('', jobSet(), 2).ok).toBe(false);
    expect(compute.planComputeSchedule('run-x' as compute.ComputeRunId, jobSet(), 0).ok).toBe(false);
    expect(compute.planComputeSchedule('run-x' as compute.ComputeRunId, 42 as unknown as readonly unknown[], 2).ok).toBe(false);

    const duplicated = [jobLiteral('job-dup', 'arm-control', 0, 2), jobLiteral('job-dup', 'arm-treatment', 2, 4)];
    const result = compute.planComputeSchedule('run-x' as compute.ComputeRunId, duplicated, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('job_invalid');
      expect(result.errors[0]?.path).toBe('jobs[1].job_id');
    }
  });

  it('L12 set coherence: a job of another experiment/tenant/project refuses planning', () => {
    for (const [field, value] of [['experiment', 'exp-other'], ['tenant', 'tenant-other'], ['project', 'prj-other']] as const) {
      const foreign = jobLiteral('job-foreign', 'arm-control', 0, 2, { lineage: { [field]: value } });
      const result = compute.planComputeSchedule('run-x' as compute.ComputeRunId, [jobLiteral('job-home', 'arm-control', 0, 2), foreign], 2);
      expect(result.ok, field).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code).toBe('lineage_mismatch');
        expect(result.errors[0]?.path).toContain('jobs[1].lineage');
      }
    }
  });
});

describe('validateComputeSchedule (the deep validator)', () => {
  it("accepts the planner's own output unchanged", () => {
    const schedule = unwrap(compute.planComputeSchedule('run-valid' as compute.ComputeRunId, jobSet(), 3));
    const validated = unwrap(compute.validateComputeSchedule(schedule));
    expect(compute.canonicalScheduleJson(validated)).toBe(compute.canonicalScheduleJson(schedule));
  });

  it('seed_overlap: a duplicated (job, slot) task refuses validation', () => {
    const schedule = unwrap(compute.planComputeSchedule('run-overlap' as compute.ComputeRunId, jobSet(), 3));
    const duplicated = { ...schedule, tasks: [...schedule.tasks, schedule.tasks[0]] };
    const result = compute.validateComputeSchedule(duplicated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('seed_overlap');
  });

  it('seed_gap: a missing non-empty slot refuses validation', () => {
    const schedule = unwrap(compute.planComputeSchedule('run-gap' as compute.ComputeRunId, jobSet(), 3));
    // Drop job-beta's slot-2 task (its partition [8, 9) is non-empty).
    const holed = { ...schedule, tasks: schedule.tasks.filter((task) => !(task.job.job_id === 'job-beta' && task.slot === 2)) };
    const result = compute.validateComputeSchedule(holed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('seed_gap');
  });

  it('invalid_schedule: a mutated subrange and a forged submission id refuse validation', () => {
    const schedule = unwrap(compute.planComputeSchedule('run-mut' as compute.ComputeRunId, jobSet(), 2));
    const mutatedRange = {
      ...schedule,
      tasks: schedule.tasks.map((task) =>
        task.job.job_id === 'job-beta' && task.slot === 1 ? { ...task, seed_range: { start: 9, end: 12 } } : task,
      ),
    };
    const rangeResult = compute.validateComputeSchedule(mutatedRange);
    expect(rangeResult.ok).toBe(false);
    if (!rangeResult.ok) expect(rangeResult.errors[0]?.code).toBe('invalid_schedule');

    const forgedId = {
      ...schedule,
      tasks: schedule.tasks.map((task, index) => (index === 0 ? { ...task, submission: 'sub-forged' as compute.SubmissionId } : task)),
    };
    const idResult = compute.validateComputeSchedule(forgedId);
    expect(idResult.ok).toBe(false);
    if (!idResult.ok) {
      expect(idResult.errors[0]?.code).toBe('invalid_schedule');
      expect(idResult.errors[0]?.path).toBe('schedule.tasks[0].submission');
    }
  });

  it('invalid_schedule: mixed experiment batches and task/schedule worker-count mismatches refuse validation', () => {
    // A mixed batch is constructed by MERGING two internally-valid
    // schedules of two experiments (the planner itself refuses mixed sets —
    // this is the deep validator's independent gate).
    const home = unwrap(compute.planComputeSchedule('run-mix' as compute.ComputeRunId, [jobLiteral('job-home', 'arm-control', 0, 2)], 2));
    const foreignJob = jobLiteral('job-foreign', 'arm-treatment', 0, 2, { lineage: { experiment: 'exp-other' } });
    const foreign = unwrap(compute.planComputeSchedule('run-mix' as compute.ComputeRunId, [foreignJob], 2));
    const merged = { ...home, tasks: [...home.tasks, ...foreign.tasks] };
    const mixedResult = compute.validateComputeSchedule(merged);
    expect(mixedResult.ok).toBe(false);
    if (!mixedResult.ok) expect(mixedResult.errors[0]?.code).toBe('lineage_mismatch');

    // Two tasks claiming ONE job id with different job records refuse
    // validation (a job id names ONE declaration).
    const schedule = unwrap(compute.planComputeSchedule('run-claim' as compute.ComputeRunId, jobSet(), 2));
    const forked = {
      ...schedule,
      tasks: schedule.tasks.map((task, index) =>
        index === schedule.tasks.length - 1 ? { ...task, job: { ...task.job, step_budget: 99 } } : task,
      ),
    };
    const forkResult = compute.validateComputeSchedule(forked);
    expect(forkResult.ok).toBe(false);
    if (!forkResult.ok) expect(forkResult.errors[0]?.code).toBe('invalid_schedule');

    const mismatched = { ...schedule, tasks: schedule.tasks.map((task, index) => (index === 0 ? { ...task, worker_count: 5 } : task)) };
    const mismatchResult = compute.validateComputeSchedule(mismatched);
    expect(mismatchResult.ok).toBe(false);
    if (!mismatchResult.ok) expect(mismatchResult.errors[0]?.code).toBe('invalid_schedule');
  });

  it('shape errors: missing fields refuse validation with precise paths', () => {
    const noRun = compute.validateComputeSchedule({ worker_count: 2, tasks: [] });
    expect(noRun.ok).toBe(false);
    if (!noRun.ok) expect(noRun.errors[0]?.path).toBe('schedule.run');

    const noWorkers = compute.validateComputeSchedule({ run: 'run-x' as compute.ComputeRunId, tasks: [] });
    expect(noWorkers.ok).toBe(false);
    if (!noWorkers.ok) expect(noWorkers.errors[0]?.path).toBe('schedule.worker_count');
  });
});

describe('SchedulerContract surface', () => {
  it('the planner object satisfies the contract guard; a bare object does not', () => {
    const scheduler: compute.SchedulerContract = {
      plan: (run, jobs, workerCount) => compute.planComputeSchedule(run, jobs, workerCount),
    };
    expect(compute.isSchedulerContract(scheduler)).toBe(true);
    expect(compute.isSchedulerContract({})).toBe(false);
    expect(compute.isSchedulerContract(null)).toBe(false);
    expect(
      unwrap(scheduler.plan('run-impl' as compute.ComputeRunId, [jobLiteral('job-impl', 'arm-control', 0, 3)], 2)).tasks.length,
    ).toBe(2);
  });
});

describe("scheduleJobs (the aggregate's job registry)", () => {
  it("keys the schedule's jobs by id, one entry per job", () => {
    const schedule = unwrap(compute.planComputeSchedule('run-jobs' as compute.ComputeRunId, jobSet(), 2));
    const jobs = compute.scheduleJobs(schedule);
    expect(jobs.size).toBe(2);
    expect(jobs.get('job-alpha' as compute.JobId)?.arm).toBe('arm-control');
    expect(jobs.get('job-beta' as compute.JobId)?.arm).toBe('arm-treatment');
  });
});
