/**
 * Reference compute-runner tests — the acceptance-critical flows.
 *
 *   - THE 1-vs-N EQUIVALENCE (criterion 3): one worker, then four workers
 *     with INJECTED DUPLICATION + REORDERING + MULTIPLE COLLECT ROUNDS —
 *     byte-identical aggregates (deep-equal + canonical bytes).
 *   - Divergence trip wire (criterion 5): a corrupted duplicate result for
 *     the same (job, seed) key fails the fold with a typed divergence.
 *   - Failure retention (criterion 6): failed tasks appear in the
 *     aggregate's failure manifest; a vanished job is a typed
 *     failure_hidden error.
 *   - Resume (criterion 10): serialized run state -> parse -> resume ->
 *     complete, with chain verification; tamper = chain_mismatch.
 *   - The start/pump gates: invalid schedules/ports, port submit failures,
 *     acknowledgment mismatches, the explicit collect bound.
 */

import { describe, expect, it } from 'vitest';

import * as compute from '../../../../packages/compute/src/index';
import { createDriverEpisodeGenerator } from './generator';
import { createScriptedComputePort } from './port';
import {
  aggregateComputeRun,
  COMPUTE_RUN_STATE_SCHEMA,
  computeRunComplete,
  pendingSubmissions,
  pumpComputeCollect,
  resumeComputeRunState,
  runComputeToCompletion,
  serializeComputeRunState,
  startComputeRun,
  verifyComputeRunChain,
  type ComputeRunState,
} from './runner';
import { GOLDEN_EXPERIMENT, GOLDEN_TENANT, goldenAggregate, goldenJobLiterals, goldenRun, goldenSchedule, goldenWorkers } from './fixtures';

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

/** Run the golden flow with a script override. */
function flow(workerCount: number, script?: Partial<Parameters<typeof createScriptedComputePort>[0]>): { readonly state: ComputeRunState; readonly aggregate: compute.EpisodeAggregate } {
  return goldenRun(workerCount, script);
}

describe('startComputeRun (the entry gates)', () => {
  it('refuses invalid schedules, invalid ports and empty task lists with typed errors', () => {
    const port = createScriptedComputePort({ workers: goldenWorkers(1), generator: createDriverEpisodeGenerator() });

    const badSchedule = startComputeRun({ nope: true }, port);
    expect(badSchedule.ok).toBe(false);
    if (!badSchedule.ok) expect(badSchedule.errors[0]?.code).toBe('invalid_id'); // the run id is the first gate

    const emptySchedule = unwrap(compute.planComputeSchedule('run-empty' as compute.ComputeRunId, [], 2));
    const empty = startComputeRun(emptySchedule, port);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors[0]?.code).toBe('invalid_schedule');

    const badPort = startComputeRun(goldenSchedule(1), { submit: 42 });
    expect(badPort.ok).toBe(false);
    if (!badPort.ok) expect(badPort.errors[0]?.code).toBe('port_invalid');
  });

  it('refuses a port whose submit fails (port_error, codes preserved) and one that acknowledges foreign ids (port_invalid)', () => {
    const schedule = goldenSchedule(1);

    const refusing = {
      submit: () => ({ ok: false as const, errors: [{ code: 'queue_full', path: '', message: 'the substrate queue is full' }] }),
      collect: () => ({ ok: true as const, value: [] }),
      cancel: () => ({ ok: true as const, value: true }),
    };
    const refused = startComputeRun(schedule, refusing);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.errors[0]?.code).toBe('port_error');
      expect(refused.errors[0]?.message).toContain('queue_full');
    }

    const echoing = {
      submit: (task: compute.ComputeTask) => ({ ok: true as const, value: `sub-forged-${task.slot}` as compute.SubmissionId }),
      collect: () => ({ ok: true as const, value: [] }),
      cancel: () => ({ ok: true as const, value: true }),
    };
    const echoed = startComputeRun(schedule, echoing);
    expect(echoed.ok).toBe(false);
    if (!echoed.ok) expect(echoed.errors[0]?.code).toBe('port_invalid');
  });

  it('submits every task in canonical order and returns the fresh running state', () => {
    const submitted: string[] = [];
    const recording = {
      submit: (task: compute.ComputeTask) => {
        submitted.push(task.submission);
        return { ok: true as const, value: task.submission };
      },
      collect: () => ({ ok: true as const, value: [] as readonly compute.JobOutcome[] }),
      cancel: () => ({ ok: true as const, value: true }),
    };
    const state = unwrap(startComputeRun(goldenSchedule(2), recording));
    expect(state.status).toBe('running');
    expect(state.collected).toEqual([]);
    expect(state.outcome_chain).toEqual([]);
    expect(submitted.length).toBe(4); // 2 jobs x 2 slots
    expect(compute.isDeeplyFrozen(state)).toBe(true);
  });
});

describe('the golden flow (1 worker, no script)', () => {
  it('plans, submits, collects and folds the canonical batch', () => {
    const { state, aggregate } = flow(1);
    expect(state.status).toBe('complete');
    expect(computeRunComplete(state)).toBe(true);
    expect(pendingSubmissions(state)).toEqual([]);
    expect(state.collected.length).toBe(12); // 12 episodes, no duplicates
    expect(unwrap(verifyComputeRunChain(state))).toBe(true);

    expect(aggregate.trials.length).toBe(12);
    expect(aggregate.failures).toEqual([]);
    expect(aggregate.experiment).toBe(GOLDEN_EXPERIMENT);
    expect(aggregate.tenant).toBe(GOLDEN_TENANT);
    expect(unwrap(compute.verifyAggregateDigest(aggregate))).toBe(true);
    const trialIds = aggregate.trials.map((entry) => entry.trial.trial_id);
    expect(trialIds).toEqual([...trialIds].sort());
    // The two arms both landed: 6 control trials, 6 treatment trials.
    expect(aggregate.trials.filter((entry) => entry.trial.arm === 'arm-control').length).toBe(6);
    expect(aggregate.trials.filter((entry) => entry.trial.arm === 'arm-treatment').length).toBe(6);
  });

  it('the golden aggregate is stable across constructions and worker counts (the oracle)', () => {
    const first = goldenAggregate(1);
    const second = goldenAggregate(1);
    const wide = goldenAggregate(4);
    expect(compute.canonicalAggregateJson(first)).toBe(compute.canonicalAggregateJson(second));
    expect(compute.canonicalAggregateJson(first)).toBe(compute.canonicalAggregateJson(wide));
    expect(first.digest).toBe(wide.digest);
  });
});

describe('THE 1-vs-N EQUIVALENCE (the determinism law)', () => {
  it('one worker vs four workers with duplication + reordering + multi-round collects -> BYTE-IDENTICAL aggregate', () => {
    const solo = flow(1);

    const wideSchedule = goldenSchedule(4);
    const duplicatedTask = wideSchedule.tasks[0] as compute.ComputeTask;
    const duplicatedSubmission = duplicatedTask.submission;
    const wide = flow(4, {
      duplicate: [duplicatedSubmission],
      reverse: true,
      rounds: 3,
    });

    // The wide run actually saw duplication (its ledger is longer by the
    // duplicated task's ordinals) and a different arrival order — the
    // substrate behaved differently.
    const duplicatedSize = duplicatedTask.seed_range.end - duplicatedTask.seed_range.start;
    expect(wide.state.collected.length).toBe(solo.state.collected.length + duplicatedSize);
    expect(JSON.stringify(wide.state.collected.map((outcome) => outcome.submission))).not.toBe(
      JSON.stringify(solo.state.collected.map((outcome) => outcome.submission)),
    );
    // ...and the runs' chains differ (arrival order is ledger meaning).
    expect(wide.state.outcome_chain).not.toEqual(solo.state.outcome_chain);

    // THE LAW: the aggregates are byte-identical anyway.
    expect(compute.canonicalAggregateJson(wide.aggregate)).toBe(compute.canonicalAggregateJson(solo.aggregate));
    expect(wide.aggregate).toEqual(solo.aggregate); // deep-equal
    expect(wide.aggregate.digest).toBe(solo.aggregate.digest);
  });

  it('duplication alone changes nothing: 4 workers with and without a duplicate fold identically', () => {
    const clean = flow(4);
    const schedule = goldenSchedule(4);
    const duplicated = (schedule.tasks[3] as compute.ComputeTask).submission;
    const noisy = flow(4, { duplicate: [duplicated] });
    expect(noisy.state.collected.length).toBe(clean.state.collected.length + (schedule.tasks[3] as compute.ComputeTask).seed_range.end - (schedule.tasks[3] as compute.ComputeTask).seed_range.start);
    expect(compute.canonicalAggregateJson(noisy.aggregate)).toBe(compute.canonicalAggregateJson(clean.aggregate));
  });

  it('worker count is a dial, not a variable: 1..6 workers all fold the same bytes', () => {
    const reference = compute.canonicalAggregateJson(goldenAggregate(1));
    for (let workers = 2; workers <= 6; workers++) {
      expect(compute.canonicalAggregateJson(goldenAggregate(workers)), `workers=${workers}`).toBe(reference);
    }
  });
});

describe('the divergence trip wire (at-least-once with corrupt re-execution)', () => {
  /** Run to the completed state only (the fold is expected to fail). */
  const runState = (workerCount: number, script: Partial<Parameters<typeof createScriptedComputePort>[0]>): ComputeRunState => {
    const schedule = goldenSchedule(workerCount);
    const port = createScriptedComputePort({ workers: goldenWorkers(workerCount), generator: createDriverEpisodeGenerator(), ...script });
    const started = unwrap(startComputeRun(schedule, port));
    return unwrap(runComputeToCompletion(started, port, { max_collects: 8 }));
  };

  it('a duplicate with a MUTATED DIGEST fails the fold with a typed divergence', () => {
    const schedule = goldenSchedule(4);
    const duplicated = (schedule.tasks[0] as compute.ComputeTask).submission;
    const state = runState(4, { duplicate: [duplicated], corrupt: 'digest' });
    expect(state.status).toBe('complete'); // the substrate delivered — the LAW fires at the fold
    const aggregate = aggregateComputeRun(state);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) {
      expect(aggregate.errors[0]?.code).toBe('divergence');
      expect(aggregate.errors[0]?.message).toContain('digest');
    }
  });

  it('a duplicate with a CONTRADICTING TRIAL (same digest) fails the fold with a typed divergence', () => {
    const schedule = goldenSchedule(2);
    const duplicated = (schedule.tasks[0] as compute.ComputeTask).submission;
    const state = runState(2, { duplicate: [duplicated], corrupt: 'trial' });
    const aggregate = aggregateComputeRun(state);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) {
      expect(aggregate.errors[0]?.code).toBe('divergence');
      expect(aggregate.errors[0]?.message).toContain('trial');
    }
  });
});

describe('failure retention (L11) and the hidden-failure law', () => {
  it('a failed task lands in the manifest with its retained record; its unexplained ordinals are covered', () => {
    const schedule = goldenSchedule(2);
    const failedTask = schedule.tasks[1] as compute.ComputeTask;
    const run = flow(2, { fail: [{ submission: failedTask.submission, kind: 'timeout', keep_results: 1 }] });
    expect(run.state.status).toBe('complete');
    expect(run.aggregate.trials.length).toBe(12 - ((failedTask.seed_range.end - failedTask.seed_range.start) - 1));
    expect(run.aggregate.failures.length).toBe(1);
    expect(run.aggregate.failures[0]?.failure_kind).toBe('timeout');
    expect(run.aggregate.failures[0]?.job).toBe(failedTask.job.job_id);
    expect(run.aggregate.failures[0]?.worker).toBe(`worker-golden-${failedTask.slot}`);
    expect(unwrap(compute.verifyAggregateDigest(run.aggregate))).toBe(true);
  });

  it('a vanished job never completes the run (run_not_complete at the bound) and the fold names it (failure_hidden)', () => {
    const schedule = goldenSchedule(2);
    const vanished = schedule.tasks
      .filter((task) => task.job.job_id === 'job-golden-treatment')
      .map((task) => task.submission);
    const port = createScriptedComputePort({
      workers: goldenWorkers(2),
      generator: createDriverEpisodeGenerator(),
      vanish: vanished,
    });
    const started = unwrap(startComputeRun(schedule, port));

    // One collect round lands the surviving job's outcomes (the vanished
    // job's submissions report nothing).
    const pumped = unwrap(pumpComputeCollect(started, port));
    expect(pumped.status).toBe('running');
    expect(pumped.collected.length).toBeGreaterThan(0);

    // The bounded loop cannot complete: the vanished submissions never report.
    const bounded = runComputeToCompletion(pumped, port, { max_collects: 3 });
    expect(bounded.ok).toBe(false);
    if (!bounded.ok) {
      expect(bounded.errors[0]?.code).toBe('run_not_complete');
      expect(bounded.errors[0]?.message).toContain('did not complete');
    }

    // Aggregating the partially-collected ledger is the TYPED hidden-failure
    // error naming the vanished job (the control job is fully covered).
    const aggregate = aggregateComputeRun(pumped);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) {
      expect(aggregate.errors[0]?.code).toBe('failure_hidden');
      expect(aggregate.errors[0]?.message).toContain('job-golden-treatment');
    }
  });

  it('a partially-collected run (rounds) aggregates to the same hidden-failure law when a task is missing mid-flight', () => {
    const schedule = goldenSchedule(1);
    const vanished = [(schedule.tasks[1] as compute.ComputeTask).submission];
    const port = createScriptedComputePort({
      workers: goldenWorkers(1),
      generator: createDriverEpisodeGenerator(),
      vanish: vanished,
      rounds: 2,
    });
    const started = unwrap(startComputeRun(schedule, port));
    const pumped = unwrap(pumpComputeCollect(started, port));
    expect(pumped.status).toBe('running');
    const aggregate = aggregateComputeRun(pumped);
    expect(aggregate.ok).toBe(false);
    if (!aggregate.ok) expect(aggregate.errors[0]?.code).toBe('failure_hidden');
  });

  it('cancel retracts pending work; already-collected outcomes stay (history is never rewritten)', () => {
    const schedule = goldenSchedule(1);
    const target = (schedule.tasks[1] as compute.ComputeTask).submission;
    const port = createScriptedComputePort({
      workers: goldenWorkers(1),
      generator: createDriverEpisodeGenerator(),
      rounds: 2,
    });
    const started = unwrap(startComputeRun(schedule, port));
    const firstPump = unwrap(pumpComputeCollect(started, port));
    expect(firstPump.status).toBe('running'); // half the outcomes are still queued

    expect(port.cancel(target)).toEqual({ ok: true, value: true });
    const secondPump = unwrap(pumpComputeCollect(firstPump, port));
    // The cancelled submission's remaining outcomes never arrive.
    expect(secondPump.collected.every((outcome) => outcome.submission !== target || firstPump.collected.includes(outcome))).toBe(true);
    expect(port.cancel('sub-never-submitted' as compute.SubmissionId).ok).toBe(false);
  });
});

describe('serialization, resume and the tamper gate', () => {
  it('serializes to canonical bytes: equal states, identical bytes; schema marker present', () => {
    const { state } = flow(2);
    const first = unwrap(serializeComputeRunState(state));
    const second = unwrap(serializeComputeRunState(state));
    expect(first).toBe(second);
    expect(first).toContain(COMPUTE_RUN_STATE_SCHEMA);
  });

  it('RESUME: serialize after a partial round -> parse -> resume -> complete -> aggregate equals the straight-through bytes', () => {
    // Straight-through reference.
    const straight = flow(3, { rounds: 3 });

    // The interrupted run: same script, one round collected, then frozen.
    const schedule = goldenSchedule(3);
    const port = createScriptedComputePort({
      workers: goldenWorkers(3),
      generator: createDriverEpisodeGenerator(),
      rounds: 3,
    });
    let run = unwrap(startComputeRun(schedule, port));
    run = unwrap(pumpComputeCollect(run, port));
    expect(run.status).toBe('running');
    expect(run.collected.length).toBeGreaterThan(0);

    const bytes = unwrap(serializeComputeRunState(run));
    const resumed = unwrap(resumeComputeRunState(bytes));
    // Byte-stability across the round-trip.
    expect(unwrap(serializeComputeRunState(resumed))).toBe(bytes);
    expect(compute.isDeeplyFrozen(resumed)).toBe(true);
    expect(unwrap(verifyComputeRunChain(resumed))).toBe(true);
    expect(() => {
      (resumed as unknown as { status: string }).status = 'complete';
    }).toThrow();

    // Continue on the SAME substrate: the resumed run completes and folds
    // the straight-through aggregate, byte-identically.
    const completed = unwrap(runComputeToCompletion(resumed, port, { max_collects: 8 }));
    expect(completed.status).toBe('complete');
    const aggregate = unwrap(aggregateComputeRun(completed));
    expect(compute.canonicalAggregateJson(aggregate)).toBe(compute.canonicalAggregateJson(straight.aggregate));
    expect(unwrap(serializeComputeRunState(completed))).toBe(unwrap(serializeComputeRunState(straight.state)));
  });

  it('typed failures: bad JSON, wrong schema, structurally invalid state', () => {
    const badJson = resumeComputeRunState('{not json');
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) expect(badJson.errors[0]?.code).toBe('invalid_json');

    const wrongSchema = resumeComputeRunState(JSON.stringify({ schema: 'tradrl/other@1', state: {} }));
    expect(wrongSchema.ok).toBe(false);
    if (!wrongSchema.ok) expect(wrongSchema.errors[0]?.code).toBe('invalid_serialization');

    const invalidState = resumeComputeRunState(JSON.stringify({ schema: COMPUTE_RUN_STATE_SCHEMA, state: { nope: true } }));
    expect(invalidState.ok).toBe(false);
    if (!invalidState.ok) expect(invalidState.errors[0]?.code).toBe('invalid_serialization');
  });

  it('THE TAMPER GATE: rewritten ledger content fails chain_mismatch, never silently', () => {
    const schedule = goldenSchedule(2);
    const port = createScriptedComputePort({ workers: goldenWorkers(2), generator: createDriverEpisodeGenerator() });
    let run = unwrap(startComputeRun(schedule, port));
    run = unwrap(runComputeToCompletion(run, port, { max_collects: 4 }));

    const parsed = JSON.parse(unwrap(serializeComputeRunState(run))) as { readonly state: { readonly collected: { digest?: string }[] } };
    const firstResult = parsed.state.collected[0];
    if (firstResult === undefined || firstResult.digest === undefined) throw new Error('fixture bug: no result in the ledger');
    const ledger = parsed.state.collected.map((entry, index) => (index === 0 ? { ...entry, digest: 'deadbeef' } : entry)); // tamper with the recorded evidence
    const tamperedBytes = JSON.stringify({ schema: COMPUTE_RUN_STATE_SCHEMA, state: { ...parsed.state, collected: ledger } });
    const tampered = resumeComputeRunState(tamperedBytes);
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      expect(tampered.errors[0]?.code).toBe('chain_mismatch');
      expect(tampered.errors[0]?.message).toContain('tampered');
    }
  });

  it('a truncated chain (dropped head) fails chain_mismatch on resume', () => {
    const { state } = flow(1);
    const parsed = JSON.parse(unwrap(serializeComputeRunState(state))) as { readonly state: { readonly outcome_chain: string[] } };
    parsed.state.outcome_chain.pop();
    const truncated = resumeComputeRunState(JSON.stringify({ schema: COMPUTE_RUN_STATE_SCHEMA, state: parsed.state }));
    expect(truncated.ok).toBe(false);
    if (!truncated.ok) expect(truncated.errors[0]?.code).toBe('invalid_serialization'); // chain/ledger length coherence fails the guard first
  });
});

describe('the collect loop bounds and pump gates', () => {
  it('an invalid max_collects bound refuses the loop (no ambient time)', () => {
    const schedule = goldenSchedule(1);
    const port = createScriptedComputePort({ workers: goldenWorkers(1), generator: createDriverEpisodeGenerator() });
    const started = unwrap(startComputeRun(schedule, port));
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const result = runComputeToCompletion(started, port, { max_collects: bad });
      expect(result.ok, String(bad)).toBe(false);
      if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');
    }
  });

  it('an invalid outcome batch fails the pump atomically (the ledger only holds valid records)', () => {
    const schedule = goldenSchedule(1);
    const rogue = {
      submit: (task: compute.ComputeTask) => ({ ok: true as const, value: task.submission }),
      collect: () => ({ ok: true as const, value: [{ kind: 'result', nonsense: true }] }),
      cancel: () => ({ ok: true as const, value: true }),
    };
    const started = unwrap(startComputeRun(schedule, rogue));
    const pumped = pumpComputeCollect(started, rogue);
    expect(pumped.ok).toBe(false);
    if (!pumped.ok) expect(pumped.errors[0]?.code).toBe('invalid_result');

    // A port failing collect() surfaces as port_error with codes preserved.
    const failing = {
      submit: (task: compute.ComputeTask) => ({ ok: true as const, value: task.submission }),
      collect: () => ({ ok: false as const, errors: [{ code: 'substrate_melted', path: '', message: 'the substrate melted' }] }),
      cancel: () => ({ ok: true as const, value: true }),
    };
    const failingStart = unwrap(startComputeRun(schedule, failing));
    const failingPump = pumpComputeCollect(failingStart, failing);
    expect(failingPump.ok).toBe(false);
    if (!failingPump.ok) {
      expect(failingPump.errors[0]?.code).toBe('port_error');
      expect(failingPump.errors[0]?.message).toContain('substrate_melted');
    }
  });

  it('pumping a complete run is idempotent (late stragglers are the substrate business)', () => {
    const { state } = flow(1);
    const again = unwrap(pumpComputeCollect(state, createScriptedComputePort({ workers: goldenWorkers(1), generator: createDriverEpisodeGenerator() })));
    expect(again).toBe(state);
  });
});

describe('the golden job set (the fixture law)', () => {
  it('two jobs, one experiment, disjoint ranges, coherent lineage', () => {
    const jobs = goldenJobLiterals();
    expect(jobs.length).toBe(2);
    const first = unwrap(compute.validateEpisodeJob(jobs[0]));
    const second = unwrap(compute.validateEpisodeJob(jobs[1]));
    expect(first.lineage.experiment).toBe(second.lineage.experiment);
    expect(first.lineage.tenant).toBe(second.lineage.tenant);
    expect(first.seed_range.end).toBe(second.seed_range.start); // contiguous batches
    expect(first.arm).not.toBe(second.arm);
    expect(first.lineage.reward_models).toEqual(['reward-model:obs-count@1']);
  });
});
