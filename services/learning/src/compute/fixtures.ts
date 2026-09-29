/**
 * @tradrl/learning (service) — the golden compute fixtures (T014).
 *
 * The canonical episode batch the tests and the acceptance criteria
 * reference: TWO jobs of ONE experiment (a control arm and a treatment
 * arm — the T015 curriculum/population consumer's spawning pattern), each
 * with the lineage the scripted compute universe derives (the environment
 * config ref is the content hash of the exact spec the generator drives —
 * computed here so the job literals and the generator agree BY
 * CONSTRUCTION).
 *
 * Everything is deterministic: the golden schedule, the golden aggregate
 * and the golden bytes are pure functions of the golden job set — the
 * same values on every construction (the tests prove it, twice).
 */

import { deriveEnvironmentConfigRef } from '../../../../packages/rl-protocol/src/index';
import {
  planComputeSchedule,
  validateEpisodeJob,
  type ComputeRunId,
  type ComputeSchedule,
  type EpisodeAggregate,
  type EpisodeJob,
  type WorkerRef,
} from '../../../../packages/compute/src/index';
import { SCRIPT_COMPUTE_POLICY_REF, scriptComputeSpec } from './generator';
import { createDriverEpisodeGenerator } from './generator';
import { createScriptedComputePort, type ScriptedComputePortOptions } from './port';
import {
  aggregateComputeRun,
  runComputeToCompletion,
  startComputeRun,
  type ComputeRunState,
} from './runner';

// ---------------------------------------------------------------------------
// The golden job set
// ---------------------------------------------------------------------------

/** The golden run identity (one experiment's episode batch). */
export function goldenComputeRunId(): ComputeRunId {
  return 'compute-run-golden' as ComputeRunId;
}

/** The golden experiment / tenant / project (one scope — L12). */
export const GOLDEN_EXPERIMENT = 'exp-golden-curriculum';
export const GOLDEN_TENANT = 'tenant-golden';
export const GOLDEN_PROJECT = 'prj-golden';

/**
 * The golden job literals (untrusted-form, like the tests' declaration
 * literals): a control-arm batch [0, 6) and a treatment-arm batch [6, 12)
 * of one curriculum experiment — the T015 consumer's spawning pattern.
 */
export function goldenJobLiterals(): readonly Record<string, unknown>[] {
  const build = (jobId: string, arm: string, start: number, end: number, seedBase: string): Record<string, unknown> => {
    const literal: Record<string, unknown> = {
      job_id: jobId,
      lineage: {
        experiment: GOLDEN_EXPERIMENT,
        environment_config: 'envcfg-pending', // derived below
        policy: SCRIPT_COMPUTE_POLICY_REF,
        reward_models: ['reward-model:obs-count@1'],
        tenant: GOLDEN_TENANT,
        project: GOLDEN_PROJECT,
      },
      arm,
      seed_base: seedBase,
      seed_range: { start, end },
      step_budget: 12,
      driver: {
        actor: 'agent-golden-curriculum',
        step_ms: 100,
        runtime: '@tradrl/learning/compute@1',
        body_versions: ['body-golden@1'],
        substrates: ['substrate-golden@1'],
      },
    };
    // The environment config ref is the content hash of the EXACT spec the
    // generator drives (L9 — the declared config is the contract).
    const job = validateEpisodeJob({ ...literal, lineage: { ...(literal.lineage as Record<string, unknown>), environment_config: 'envcfg-placeholder' } });
    if (!job.ok) throw new Error(`golden fixture bug: ${JSON.stringify(job.errors)}`);
    (literal.lineage as Record<string, unknown>).environment_config = deriveEnvironmentConfigRef(scriptComputeSpec(job.value));
    return literal;
  };
  return [
    build('job-golden-control', 'arm-control', 0, 6, 'seed-golden-control'),
    build('job-golden-treatment', 'arm-treatment', 6, 12, 'seed-golden-treatment'),
  ];
}

/** The golden job set, validated and deeply frozen (the canonical batch). */
export function goldenJobSet(): readonly EpisodeJob[] {
  const jobs = goldenJobLiterals().map((literal) => {
    const job = validateEpisodeJob(literal);
    if (!job.ok) throw new Error(`golden fixture bug: ${JSON.stringify(job.errors)}`);
    return job.value;
  });
  return jobs;
}

/** The golden schedule for `workerCount` workers (the pure planner over the golden set). */
export function goldenSchedule(workerCount: number): ComputeSchedule {
  const schedule = planComputeSchedule(goldenComputeRunId(), goldenJobLiterals(), workerCount);
  if (!schedule.ok) throw new Error(`golden fixture bug: ${JSON.stringify(schedule.errors)}`);
  return schedule.value;
}

// ---------------------------------------------------------------------------
// The golden flow + aggregate
// ---------------------------------------------------------------------------

/** The default substrate workers of the golden flow. */
export function goldenWorkers(count: number): readonly WorkerRef[] {
  return Array.from({ length: count }, (_, index) => `worker-golden-${index}` as WorkerRef);
}

/**
 * Run the golden flow end-to-end for `workerCount` workers under a
 * scripted port (default script: no duplication, no failures, one round —
 * override with `script`): plan, submit, collect to completion, fold.
 */
export function goldenRun(workerCount: number, script?: Partial<ScriptedComputePortOptions>): { readonly state: ComputeRunState; readonly aggregate: EpisodeAggregate } {
  const schedule = goldenSchedule(workerCount);
  const options: ScriptedComputePortOptions = {
    workers: goldenWorkers(workerCount),
    generator: createDriverEpisodeGenerator(),
    ...script,
  };
  const port = createScriptedComputePort(options);
  const started = startComputeRun(schedule, port);
  if (!started.ok) throw new Error(`golden fixture bug: ${JSON.stringify(started.errors)}`);
  const completed = runComputeToCompletion(started.value, port, { max_collects: 8 });
  if (!completed.ok) throw new Error(`golden fixture bug: ${JSON.stringify(completed.errors)}`);
  const aggregate = aggregateComputeRun(completed.value);
  if (!aggregate.ok) throw new Error(`golden fixture bug: ${JSON.stringify(aggregate.errors)}`);
  return { state: completed.value, aggregate: aggregate.value };
}

/**
 * The golden aggregate: the canonical fold of the golden batch — the SAME
 * value for every worker count (the 1-vs-N equivalence law), stable across
 * constructions (tested twice).
 */
export function goldenAggregate(workerCount = 1): EpisodeAggregate {
  return goldenRun(workerCount).aggregate;
}
