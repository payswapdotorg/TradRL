/**
 * AggregateProtocol tests — the canonical fold.
 *
 * Behavioral law chain: order-independence (shuffled outcomes fold
 * identically), at-least-once dedup by digest equality with the
 * divergence trip wire, the L11 coverage law (failure_hidden on missing
 * jobs/tasks; retained failure manifest on worker failures), per-result
 * coherence (partition range, seed derivation, lineage equality), the
 * canonical trial-id order, duplicate trial/trajectory trip wires, and the
 * aggregate digest's tamper gate.
 */

import { describe, expect, it } from 'vitest';

import * as compute from './index';

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

const T0 = 1_700_000_000_000;

function jobLiteral(jobId: string, arm: string, start: number, end: number): Record<string, unknown> {
  return {
    job_id: jobId,
    lineage: {
      experiment: 'exp-aggregate',
      environment_config: 'envcfg-aggregate',
      policy: 'policy:scripted@1',
      reward_models: [],
      tenant: 'tenant-aggregate',
      project: 'prj-aggregate',
    },
    arm,
    seed_base: `seed-${jobId}`,
    seed_range: { start, end },
    step_budget: 12,
    driver: {
      actor: 'agent-aggregate',
      step_ms: 100,
      runtime: '@tradrl/learning/compute@1',
      body_versions: ['body@1'],
      substrates: ['sub@1'],
    },
  };
}

/** Plan the canonical two-job set for `workers` workers. */
function planFor(workers: number): compute.ComputeSchedule {
  return unwrap(
    compute.planComputeSchedule('run-aggregate' as compute.ComputeRunId, [jobLiteral('job-alpha', 'arm-control', 0, 4), jobLiteral('job-beta', 'arm-treatment', 4, 8)], workers),
  );
}

/** A guard-valid result for (task, ordinal) under `worker`, with an override hook. */
function resultFor(
  task: compute.ComputeTask,
  ordinal: number,
  worker: string,
  overrides: ((result: compute.JobResult) => compute.JobResult) | undefined = undefined,
): compute.JobResult {
  const base = unwrap(
    compute.validateJobResult({
      kind: 'result',
      submission: task.submission,
      job: task.job.job_id,
      worker,
      episode_index: ordinal,
      seed: compute.episodeSeedAt(task.job, ordinal),
      episode: `ep-${task.job.job_id}-${ordinal}`,
      digest: compute.fnv1a32Hex(`${task.job.job_id}|${ordinal}`),
      trial: {
        trial_id: compute.deriveJobTrialId(task.job.job_id, ordinal),
        arm: task.job.arm,
        status: 'succeeded',
        trajectory: compute.deriveJobTrajectoryId(task.job.job_id, ordinal),
        outcome: { steps: 6, digest: compute.fnv1a32Hex(`${task.job.job_id}|${ordinal}`) },
        started_at: T0,
        ended_at: T0 + 600,
        failure_reason: null,
      },
      lineage: task.job.lineage,
    }),
  );
  return overrides === undefined ? base : overrides(base);
}

/** A guard-valid failure record for `task` under `worker`. */
function failureFor(task: compute.ComputeTask, worker: string, kind: compute.FailureKind = 'timeout'): compute.JobFailure {
  return unwrap(
    compute.validateJobFailure({
      kind: 'failure',
      submission: task.submission,
      job: task.job.job_id,
      worker,
      failure_kind: kind,
      detail: `scripted ${kind} of ${task.job.job_id} slot ${task.slot}`,
      lineage: task.job.lineage,
    }),
  );
}

/** All results of a schedule under one worker per slot, in canonical task order. */
function allResults(schedule: compute.ComputeSchedule): compute.JobResult[] {
  const results: compute.JobResult[] = [];
  for (const task of schedule.tasks) {
    for (let ordinal = task.seed_range.start; ordinal < task.seed_range.end; ordinal++) {
      results.push(resultFor(task, ordinal, `worker-${task.slot}`));
    }
  }
  return results;
}

describe('aggregateEpisodes (the canonical fold)', () => {
  it('folds every result into trial-id order regardless of arrival order; byte-identical, twice', () => {
    const schedule = planFor(3);
    const outcomes = allResults(schedule);

    const straight = unwrap(compute.aggregateEpisodes(schedule, outcomes));
    const shuffled = [...outcomes].reverse();
    const folded = unwrap(compute.aggregateEpisodes(schedule, shuffled));

    expect(compute.canonicalAggregateJson(straight)).toBe(compute.canonicalAggregateJson(folded));
    const again = unwrap(compute.aggregateEpisodes(schedule, [...outcomes].sort(() => (outcomes.length % 2 === 0 ? -1 : 1))));
    expect(compute.canonicalAggregateJson(straight)).toBe(compute.canonicalAggregateJson(again));

    expect(straight.trials.length).toBe(8);
    const trialIds = straight.trials.map((entry) => entry.trial.trial_id);
    expect(trialIds).toEqual([...trialIds].sort());
    expect(straight.failures).toEqual([]);
    expect(compute.isDeeplyFrozen(straight)).toBe(true);
    expect(unwrap(compute.verifyAggregateDigest(straight))).toBe(true);

    // The entries pair each trial with its job's lineage (the T013 emission
    // discipline) and the aggregate anchors the L12 scope.
    for (const entry of straight.trials) {
      expect(entry.lineage.experiment).toBe('exp-aggregate');
      expect(['job-alpha', 'job-beta']).toContain(entry.job);
    }
    expect(straight.experiment).toBe('exp-aggregate');
    expect(straight.tenant).toBe('tenant-aggregate');
    expect(straight.project).toBe('prj-aggregate');
    expect(straight.run).toBe('run-aggregate');
  });

  it('the aggregate is worker-count-independent: 1 worker and 4 workers fold identically', () => {
    const solo = unwrap(compute.aggregateEpisodes(planFor(1), allResults(planFor(1))));
    const wide = unwrap(compute.aggregateEpisodes(planFor(4), allResults(planFor(4))));
    expect(compute.canonicalAggregateJson(solo)).toBe(compute.canonicalAggregateJson(wide));
    expect(solo.digest).toBe(wide.digest);
  });

  it('at-least-once dedup: duplicate results with equal digests collapse to ONE entry', () => {
    const schedule = planFor(2);
    const outcomes = allResults(schedule);
    // Re-emit every result of the first task from a second worker (a
    // re-execution after a timeout — same key, same digest).
    const firstTask = schedule.tasks[0] as compute.ComputeTask;
    const duplicated: compute.JobResult[] = [];
    for (let ordinal = firstTask.seed_range.start; ordinal < firstTask.seed_range.end; ordinal++) {
      duplicated.push(resultFor(firstTask, ordinal, 'worker-retry'));
    }
    const aggregate = unwrap(compute.aggregateEpisodes(schedule, [...outcomes, ...duplicated, ...duplicated]));
    expect(aggregate.trials.length).toBe(8);
    // The dedup leaves no trace in the fold (the same inputs deduplicated
    // or not produce byte-identical aggregates).
    expect(compute.canonicalAggregateJson(aggregate)).toBe(compute.canonicalAggregateJson(unwrap(compute.aggregateEpisodes(schedule, outcomes))));
  });

  it('DIVERGENCE TRIP WIRE: same (job, seed) key, different digests -> typed divergence', () => {
    const schedule = planFor(2);
    const outcomes = allResults(schedule);
    const firstTask = schedule.tasks[0] as compute.ComputeTask;
    const firstOrdinal = firstTask.seed_range.start;
    const divergent = resultFor(firstTask, firstOrdinal, 'worker-rogue', (result) => ({
      ...result,
      digest: compute.fnv1a32Hex(`${result.digest}|divergent`),
    }));
    const aggregate = compute.aggregateEpisodes(schedule, [...outcomes, divergent]);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) {
      expect(aggregate.errors[0]?.code).toBe('divergence');
      expect(aggregate.errors[0]?.message).toContain(firstTask.job.job_id);
    }
  });

  it('DIVERGENCE TRIP WIRE: equal digests, contradicting trial records -> typed divergence', () => {
    const schedule = planFor(1);
    const outcomes = allResults(schedule);
    const firstTask = schedule.tasks[0] as compute.ComputeTask;
    const firstOrdinal = firstTask.seed_range.start;
    const contradicting = resultFor(firstTask, firstOrdinal, 'worker-rogue', (result) => ({
      ...result,
      trial: { ...result.trial, outcome: { steps: 999 } },
    }));
    const aggregate = compute.aggregateEpisodes(schedule, [...outcomes, contradicting]);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) expect(aggregate.errors[0]?.code).toBe('divergence');
  });

  it('FAILURES ARE RETAINED: worker failures land in the manifest, alongside the results they explain', () => {
    const schedule = planFor(2);
    const outcomes: compute.JobOutcome[] = [];
    const failedTask = schedule.tasks[1] as compute.ComputeTask;
    for (const task of schedule.tasks) {
      if (task === failedTask) {
        // The task partially completed (first ordinal), then timed out; the
        // retry never happened. The failure EXPLAINS the gap.
        outcomes.push(resultFor(task, task.seed_range.start, 'worker-1'));
        outcomes.push(failureFor(task, 'worker-1', 'timeout'));
      } else {
        for (let ordinal = task.seed_range.start; ordinal < task.seed_range.end; ordinal++) {
          outcomes.push(resultFor(task, ordinal, `worker-${task.slot}`));
        }
      }
    }
    const aggregate = unwrap(compute.aggregateEpisodes(schedule, outcomes));
    expect(aggregate.trials.length).toBe(7); // 4 + 3 of the failed task
    expect(aggregate.failures.length).toBe(1);
    expect(aggregate.failures[0]?.failure_kind).toBe('timeout');
    expect(aggregate.failures[0]?.job).toBe(failedTask.job.job_id);
    expect(unwrap(compute.verifyAggregateDigest(aggregate))).toBe(true);

    // The retry story: full results AND a retained failure record — the
    // manifest keeps the failure (L11: history is never pruned).
    const retried = [...outcomes.filter((outcome) => outcome.kind === 'failure'), ...allResults(schedule)];
    const retriedAggregate = unwrap(compute.aggregateEpisodes(schedule, retried));
    expect(retriedAggregate.trials.length).toBe(8);
    expect(retriedAggregate.failures.length).toBe(1);
  });

  it('the manifest deduplicates exact-equal failure records and orders canonically', () => {
    const schedule = planFor(1); // one task per job — both must be explained
    const firstTask = schedule.tasks[0] as compute.ComputeTask;
    const secondTask = schedule.tasks[1] as compute.ComputeTask;
    const outcomes: compute.JobOutcome[] = [
      failureFor(firstTask, 'worker-a', 'timeout'),
      failureFor(firstTask, 'worker-a', 'timeout'), // exact duplicate emission
      failureFor(secondTask, 'worker-b', 'protocol'),
    ];
    const aggregate = unwrap(compute.aggregateEpisodes(schedule, outcomes));
    expect(aggregate.failures.length).toBe(2);
    // Canonical (job, submission, worker, kind, detail) order: job-alpha's
    // failure precedes job-beta's.
    expect(aggregate.failures[0]?.job).toBe(firstTask.job.job_id);
    expect(aggregate.failures[1]?.job).toBe(secondTask.job.job_id);
  });

  it('FAILURE_HIDDEN: a job with neither results nor failures is a typed error naming the job', () => {
    const schedule = planFor(2);
    // Everything of job-beta vanishes.
    const outcomes = allResults(schedule).filter((result) => result.job === 'job-alpha');
    const aggregate = compute.aggregateEpisodes(schedule, outcomes);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) {
      expect(aggregate.errors[0]?.code).toBe('failure_hidden');
      expect(aggregate.errors[0]?.message).toContain('job-beta');
    }
  });

  it('FAILURE_HIDDEN: a task whose partition is partially uncovered without a failure record is a typed error', () => {
    const schedule = planFor(2);
    const outcomes = allResults(schedule);
    // Drop ONE result of job-beta's first task (its last ordinal) — no
    // failure record explains the gap.
    const holed = outcomes.filter((result) => !(result.job === 'job-beta' && result.episode_index === 7));
    const aggregate = compute.aggregateEpisodes(schedule, holed);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) {
      expect(aggregate.errors[0]?.code).toBe('failure_hidden');
      expect(aggregate.errors[0]?.message).toContain('job-beta');
    }
  });

  it('schedule_mismatch: outcomes of unknown submissions and results naming the wrong job refuse the fold', () => {
    const schedule = planFor(2);
    const outcomes = allResults(schedule);
    const unknown = { ...(outcomes[0] as compute.JobResult), submission: 'sub-unknown' as compute.SubmissionId };
    const unknownResult = compute.aggregateEpisodes(schedule, [...outcomes, unknown]);
    expect(unknownResult.ok).toBe(false);
    if (!unknownResult.ok) expect(unknownResult.errors[0]?.code).toBe('schedule_mismatch');

    const wrongJob = { ...(outcomes[0] as compute.JobResult), job: 'job-unknown' as compute.JobId };
    const wrongJobResult = compute.aggregateEpisodes(schedule, [...outcomes, wrongJob]);
    expect(wrongJobResult.ok).toBe(false);
    if (!wrongJobResult.ok) expect(wrongJobResult.errors[0]?.code).toBe('schedule_mismatch');

    const failureUnknown = { ...(failureFor(schedule.tasks[0] as compute.ComputeTask, 'worker-x')), submission: 'sub-unknown' as compute.SubmissionId };
    const failureResult = compute.aggregateEpisodes(schedule, [failureUnknown]);
    expect(failureResult.ok).toBe(false);
    if (!failureResult.ok) expect(failureResult.errors[0]?.code).toBe('schedule_mismatch');
  });

  it("result_out_of_range: a result outside its task's declared partition refuses the fold", () => {
    const schedule = planFor(2);
    const firstTask = schedule.tasks[0] as compute.ComputeTask;
    const secondTask = schedule.tasks[1] as compute.ComputeTask;
    // A result for job-alpha's ordinal, but attributed to job-beta's task.
    const smuggled = resultFor(secondTask, firstTask.seed_range.start, 'worker-1');
    const aggregate = compute.aggregateEpisodes(schedule, [...allResults(schedule), smuggled]);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) expect(aggregate.errors[0]?.code).toBe('result_out_of_range');
  });

  it('invalid_result: a seed that is not the declared derivation refuses the fold (no ambient randomness)', () => {
    const schedule = planFor(1);
    const outcomes = allResults(schedule);
    const rogue = { ...(outcomes[0] as compute.JobResult), seed: 'seed-rogue' as compute.Seed };
    const aggregate = compute.aggregateEpisodes(schedule, [rogue]);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) {
      expect(aggregate.errors[0]?.code).toBe('invalid_result');
      expect(aggregate.errors[0]?.message).toContain('declared derivation');
    }
  });

  it('lineage_mismatch: a result carrying a private lineage block refuses the fold (L9)', () => {
    const schedule = planFor(1);
    const outcomes = allResults(schedule);
    const private_ = { ...(outcomes[0] as compute.JobResult), lineage: { ...(outcomes[0] as compute.JobResult).lineage, experiment: 'exp-private' } };
    const aggregate = compute.aggregateEpisodes(schedule, [...outcomes, private_]);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) {
      expect(aggregate.errors[0]?.code).toBe('lineage_mismatch');
      expect(aggregate.errors[0]?.message).toContain('L9');
    }
  });

  it('lineage_mismatch: a failure carrying a private lineage block refuses the fold (L9)', () => {
    const schedule = planFor(1);
    const failedTask = schedule.tasks[0] as compute.ComputeTask;
    const rogueFailure = { ...failureFor(failedTask, 'worker-rogue'), lineage: { ...failedTask.job.lineage, experiment: 'exp-private' } };
    const aggregate = compute.aggregateEpisodes(schedule, [...allResults(schedule), rogueFailure]);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) {
      expect(aggregate.errors[0]?.code).toBe('lineage_mismatch');
      expect(aggregate.errors[0]?.message).toContain('L9');
    }
  });

  it('duplicate_trial / duplicate_trajectory: two episodes claiming one identity refuse the fold', () => {
    const schedule = planFor(1);
    const firstTask = schedule.tasks[0] as compute.ComputeTask;
    // Full coverage of BOTH jobs, but ordinal 1's trial CLAIMS ordinal 0's
    // trial id.
    const colliding: compute.JobResult[] = allResults(schedule).map((result) =>
      result.job === firstTask.job.job_id && result.episode_index === firstTask.seed_range.start + 1
        ? { ...result, trial: { ...result.trial, trial_id: compute.deriveJobTrialId(firstTask.job.job_id, firstTask.seed_range.start) } }
        : result,
    );
    const trialCollision = compute.aggregateEpisodes(schedule, colliding);
    expect(trialCollision.ok).toBe(false);
    if (!trialCollision.ok) expect(trialCollision.errors[0]?.code).toBe('duplicate_trial');

    // Full coverage, but job-alpha's ordinal-1 trial CLAIMS ordinal 0's
    // trajectory.
    const trajectoryCollision: compute.JobResult[] = allResults(schedule).map((result) =>
      result.job === firstTask.job.job_id && result.episode_index === firstTask.seed_range.start + 1
        ? {
            ...result,
            trial: { ...result.trial, trajectory: compute.deriveJobTrajectoryId(firstTask.job.job_id, firstTask.seed_range.start) },
          }
        : result,
    );
    const trajectoryResult = compute.aggregateEpisodes(schedule, trajectoryCollision);
    expect(trajectoryResult.ok).toBe(false);
    if (!trajectoryResult.ok) expect(trajectoryResult.errors[0]?.code).toBe('duplicate_trajectory');
  });

  it('invalid outcomes refuse the fold before any semantics (collect-all paths)', () => {
    const schedule = planFor(1);
    expect(compute.aggregateEpisodes(schedule, [null]).ok).toBe(false);
    expect(compute.aggregateEpisodes(schedule, [{ kind: 'other' }]).ok).toBe(false);
    expect(compute.aggregateEpisodes(schedule, 'nope' as unknown as readonly unknown[]).ok).toBe(false);

    const digestMissing = { ...(allResults(schedule)[0] as compute.JobResult) };
    const stripped = { ...digestMissing, digest: 'zzz' };
    expect(compute.aggregateEpisodes(schedule, [stripped]).ok).toBe(false);

    // A failure without a lineage block is a lineage_gap.
    const bare = { kind: 'failure', submission: (schedule.tasks[0] as compute.ComputeTask).submission, job: 'job-alpha', worker: 'w', failure_kind: 'timeout', detail: 'x' };
    const bareResult = compute.aggregateEpisodes(schedule, [bare]);
    expect(bareResult.ok).toBe(false);
    if (!bareResult.ok) expect(bareResult.errors[0]?.code).toBe('lineage_gap');
  });

  it('the schedule itself is validated: a corrupted schedule refuses the fold', () => {
    const schedule = planFor(2);
    const corrupted = { ...schedule, worker_count: 7 };
    expect(compute.aggregateEpisodes(corrupted, allResults(schedule)).ok).toBe(false);
    expect(compute.aggregateEpisodes({}, allResults(schedule)).ok).toBe(false);
  });

  it('an empty task set refuses the fold (an aggregate of nothing is inexpressible)', () => {
    const empty = unwrap(compute.planComputeSchedule('run-empty' as compute.ComputeRunId, [], 2));
    expect(empty.tasks.length).toBe(0);
    expect(compute.aggregateEpisodes(empty, []).ok).toBe(false);
  });
});

describe('the aggregate guard + digest tamper gate', () => {
  it("isEpisodeAggregate accepts the fold's output and refuses shuffled/hand-corrupted records", () => {
    const schedule = planFor(2);
    const aggregate = unwrap(compute.aggregateEpisodes(schedule, allResults(schedule)));
    expect(compute.isEpisodeAggregate(aggregate)).toBe(true);

    const shuffled = { ...aggregate, trials: [...aggregate.trials].reverse() };
    expect(compute.isEpisodeAggregate(shuffled)).toBe(false); // canonical order is law
    expect(compute.isEpisodeAggregate({ ...aggregate, digest: 'nope' })).toBe(false);
    expect(compute.isEpisodeAggregate(null)).toBe(false);
  });

  it('verifyAggregateDigest: tampered content fails chain_mismatch, never silently', () => {
    const schedule = planFor(2);
    const aggregate = unwrap(compute.aggregateEpisodes(schedule, allResults(schedule)));
    expect(unwrap(compute.verifyAggregateDigest(aggregate))).toBe(true);

    const tampered = { ...aggregate, experiment: 'exp-tampered' as compute.ExperimentId };
    const verified = compute.verifyAggregateDigest(tampered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.errors[0]?.code).toBe('chain_mismatch');
      expect(verified.errors[0]?.message).toContain('tampered');
    }
  });

  it("immutability: the fold's output is deeply frozen; mutation throws", () => {
    const schedule = planFor(1);
    const aggregate = unwrap(compute.aggregateEpisodes(schedule, allResults(schedule)));
    expect(compute.isDeeplyFrozen(aggregate)).toBe(true);
    expect(() => {
      (aggregate as unknown as { digest: string }).digest = '00000000';
    }).toThrow();
    expect(() => {
      ((aggregate.trials[0] as compute.AggregateTrial).trial as unknown as { status: string }).status = 'failed';
    }).toThrow();
  });
});
