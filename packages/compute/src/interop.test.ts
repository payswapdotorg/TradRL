/**
 * Cross-package interoperability trip wires for @tradrl/compute.
 *
 * The compute lane's mirrors are proven against the REAL canonical packages
 * PRESENT on this branch (static relative imports — the market-world /
 * rl-protocol interop precedent; the frozen write surface permits
 * test-only imports):
 *
 *   - @tradrl/time-engine + @tradrl/environment-protocol (T001/T005):
 *     TimestampMs parity, the EpisodeId/Seed brand parity.
 *   - @tradrl/trajectory (T011): the trajectory-lane reference brands.
 *   - @tradrl/experiments (T011): TrialRecord EXACT mirror equality and
 *     the runtime proof that AGGREGATED trials pass the REAL experiments
 *     validators — the aggregate's trial log IS experiments-lane evidence.
 *   - @tradrl/rl-protocol (T013): the trainer-lane identity brands
 *     (RewardModelRef, AgentInstanceId, producer sets), canonical JSON
 *     parity, and the DriverConfig mirrors.
 *   - services/learning/src/rl (the REAL T013 reference trainer): the
 *     declared driver configuration satisfies the reference trainer's own
 *     options guard and constructs a working trainer — the strongest
 *     proof that distributed generation drives the T013 contracts per
 *     worker instead of replacing them.
 *
 * Type-level assertions fail `pnpm typecheck`; runtime assertions fail
 * `pnpm test`. Either way, a mirror can never drift silently.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as compute from './index';
import * as engine from '../../time-engine/src/index';
import * as envProtocol from '../../environment-protocol/src/index';
import * as trajectory from '../../trajectory/src/index';
import * as experiments from '../../experiments/src/index';
import * as rl from '../../rl-protocol/src/index';
import { createReferenceTrainer, isReferenceTrainerOptions } from '../../../services/learning/src/rl/trainer';
import type { ReferenceTrainerOptions } from '../../../services/learning/src/rl/trainer';

import type { EpisodeJob } from './index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the compute lane's TimestampMs is the program-wide TimestampMs. */
function timestampParity(value: compute.TimestampMs): engine.TimestampMs {
  return value;
}

/** Compiles iff the compute lane's trial record IS the experiments-lane record. */
function trialRecordIsCanonical(record: compute.TrialRecord): experiments.TrialRecord {
  return record;
}

/** Compiles iff a REAL experiments trial record satisfies the compute mirror. */
function canonicalTrialRecordIsMirror(record: experiments.TrialRecord): compute.TrialRecord {
  return record;
}

/** Compiles iff the declared driver configuration IS the T013 reference trainer's options. */
function driverConfigIsTrainerOptions(config: compute.DriverConfig): ReferenceTrainerOptions {
  return config;
}

// ---------------------------------------------------------------------------
// Shared fixtures (hand-built, no service dependency)
// ---------------------------------------------------------------------------

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

const T0 = 1_700_000_000_000;

function jobLiteral(): Record<string, unknown> {
  return {
    job_id: 'job-interop',
    lineage: {
      experiment: 'exp-interop',
      environment_config: 'envcfg-interop',
      policy: 'policy:scripted@1',
      reward_models: ['reward-model:obs-count@1'],
      tenant: 'tenant-interop',
      project: 'prj-interop',
    },
    arm: 'arm-control',
    seed_base: 'seed-interop',
    seed_range: { start: 0, end: 4 },
    step_budget: 10,
    driver: {
      actor: 'agent-interop',
      step_ms: 100,
      runtime: '@tradrl/learning/compute@1',
      body_versions: ['body-interop@1'],
      substrates: ['substrate-interop@1'],
    },
  };
}

/** The reference flow, package-only: plan, generate hand-built results, fold. */
function referenceAggregate(): compute.EpisodeAggregate {
  const schedule = unwrap(compute.planComputeSchedule('run-interop' as compute.ComputeRunId, [jobLiteral()], 2));
  const outcomes: compute.JobResult[] = [];
  for (const task of schedule.tasks) {
    for (let ordinal = task.seed_range.start; ordinal < task.seed_range.end; ordinal++) {
      outcomes.push(
        unwrap(
          compute.validateJobResult({
            kind: 'result',
            submission: task.submission,
            job: task.job.job_id,
            worker: `worker-${task.slot}`,
            episode_index: ordinal,
            seed: compute.episodeSeedAt(task.job, ordinal),
            episode: `ep-interop-${ordinal}`,
            digest: compute.fnv1a32Hex(`interop|${ordinal}`),
            trial: {
              trial_id: compute.deriveJobTrialId(task.job.job_id, ordinal),
              arm: task.job.arm,
              status: 'succeeded',
              trajectory: compute.deriveJobTrajectoryId(task.job.job_id, ordinal),
              outcome: { steps: 6, note: 'generation data; acceptance is evaluation business (L7)' },
              started_at: T0,
              ended_at: T0 + 600,
              failure_reason: null,
            },
            lineage: task.job.lineage,
          }),
        ),
      );
    }
  }
  return unwrap(compute.aggregateEpisodes(schedule, outcomes));
}

// ---------------------------------------------------------------------------
// TimestampMs + brand parity
// ---------------------------------------------------------------------------

describe('TimestampMs and brand-tag parity with the REAL lanes', () => {
  it('TimestampMs is mutually assignable and behaviorally identical across the lanes', () => {
    expectTypeOf<compute.TimestampMs>().toEqualTypeOf<engine.TimestampMs>();
    expectTypeOf<compute.TimestampMs>().toEqualTypeOf<envProtocol.TimestampMs>();
    expectTypeOf<compute.TimestampMs>().toEqualTypeOf<trajectory.TimestampMs>();
    expectTypeOf<compute.TimestampMs>().toEqualTypeOf<experiments.TimestampMs>();
    expectTypeOf<compute.TimestampMs>().toEqualTypeOf<rl.TimestampMs>();
    const fromEngine: engine.TimestampMs = timestampParity(T0 as compute.TimestampMs);
    expect(compute.isTimestampMs(fromEngine)).toBe(true);
    for (const sample of [0, 1, -1, 1.5, compute.MAX_TIMESTAMP_MS, compute.MAX_TIMESTAMP_MS + 1, Number.NaN, 'x', null]) {
      expect(compute.isTimestampMs(sample)).toBe(engine.isTimestampMs(sample));
    }
  });

  it('the opaque reference brands are mutually assignable with their canonical owners', () => {
    // T005 environment identities.
    expectTypeOf<compute.EpisodeId>().toEqualTypeOf<envProtocol.EpisodeId>();
    expectTypeOf<compute.EpisodeId>().toEqualTypeOf<trajectory.EpisodeId>();
    expectTypeOf<compute.Seed>().toEqualTypeOf<envProtocol.Seed>();
    expectTypeOf<compute.Seed>().toEqualTypeOf<rl.Seed>();
    // T011 trajectory-lane references.
    expectTypeOf<compute.TrajectoryId>().toEqualTypeOf<trajectory.TrajectoryId>();
    expectTypeOf<compute.EnvironmentConfigRef>().toEqualTypeOf<trajectory.EnvironmentConfigRef>();
    expectTypeOf<compute.RuntimeRef>().toEqualTypeOf<trajectory.RuntimeRef>();
    expectTypeOf<compute.DataRef>().toEqualTypeOf<trajectory.DataRef>();
    expectTypeOf<compute.RuntimeRef>().toEqualTypeOf<rl.RuntimeRef>();
    expectTypeOf<compute.DataRef>().toEqualTypeOf<rl.DataRef>();
    // T011 experiments-lane identities.
    expectTypeOf<compute.TrialId>().toEqualTypeOf<experiments.TrialId>();
    expectTypeOf<compute.ArmId>().toEqualTypeOf<experiments.ArmId>();
    expectTypeOf<compute.ExperimentId>().toEqualTypeOf<experiments.ExperimentId>();
    // T013 rl-protocol identities (the trainer lane T014 scales).
    expectTypeOf<compute.RewardModelRef>().toEqualTypeOf<rl.RewardModelRef>();
    expectTypeOf<compute.AgentInstanceId>().toEqualTypeOf<rl.AgentInstanceId>();
    expectTypeOf<compute.BodyVersionRef>().toEqualTypeOf<rl.BodyVersionRef>();
    expectTypeOf<compute.SubstrateRef>().toEqualTypeOf<rl.SubstrateRef>();
    // T002/T006 scope references.
    expectTypeOf<compute.TenantId>().toEqualTypeOf<trajectory.TenantId>();
    expectTypeOf<compute.ProjectId>().toEqualTypeOf<trajectory.ProjectId>();
    expectTypeOf<compute.TenantId>().toEqualTypeOf<rl.TenantId>();
    expectTypeOf<compute.ProjectId>().toEqualTypeOf<rl.ProjectId>();
    // Runtime guard parity on the shared opaque ids.
    expect(compute.isTrialId('trial-x')).toBe(experiments.isTrialId('trial-x'));
    expect(compute.isSeed('seed-x')).toBe(rl.isSeed('seed-x'));
    expect(compute.isEpisodeId('ep-x')).toBe(envProtocol.isEpisodeId('ep-x'));
  });
});

// ---------------------------------------------------------------------------
// Experiments-lane mirrors (T011) — the aggregate's trial log
// ---------------------------------------------------------------------------

describe('experiments mirrors (T011 trip wire)', () => {
  it('TrialRecord is EXACTLY the canonical type', () => {
    expectTypeOf<compute.TrialRecord>().toEqualTypeOf<experiments.TrialRecord>();
    expectTypeOf<compute.TrialStatus>().toEqualTypeOf<experiments.TrialStatus>();
    const canonical: experiments.TrialRecord = trialRecordIsCanonical(
      unwrap(compute.validateTrialRecord(referenceAggregate().trials[0]?.trial)),
    );
    expect(canonical.trial_id).toBeTruthy();
    expect(canonicalTrialRecordIsMirror(canonical).status).toBe('succeeded');
  });

  it('THE RUNTIME PROOF: every aggregated trial passes the REAL experiments validators', () => {
    const aggregate = referenceAggregate();
    expect(aggregate.trials.length).toBe(4);
    for (const entry of aggregate.trials) {
      expect(experiments.isTrialRecord(entry.trial)).toBe(true);
      const validated = experiments.validateTrialRecord(entry.trial);
      expect(validated.ok, JSON.stringify(validated.ok ? null : validated.errors)).toBe(true);
      // And the compute mirror accepts the REAL validator's narrowed value.
      expect(compute.isTrialRecord(unwrap(compute.validateTrialRecord(entry.trial)))).toBe(true);
    }
  });

  it("the REAL experiment log law accepts the aggregated trials as one experiment's evidence", () => {
    const aggregate = referenceAggregate();
    const experiment = unwrap(
      experiments.createExperimentRecord({
        experiment_id: 'exp-interop',
        tenant: 'tenant-interop',
        project: 'prj-interop',
        goal: 'goal-interop',
        criteria: ['criteria-interop'],
        design: {
          hypothesis: 'Distributed generation emits experiments-lane-conformant trials.',
          intervention: { kind: 'episode-batch', description: 'Generate episodes through the T014 compute protocol.', parameters: {} },
          comparison: [
            { arm: 'arm-control', role: 'control', description: 'Baseline batch.' },
            { arm: 'arm-treatment', role: 'treatment', description: 'Treatment batch (unpopulated here — the log law only needs the arm to exist).' },
          ],
          splits: ['split-interop'],
          candidate_organization: 'org-interop',
          body_versions: ['body-interop@1'],
          substrates: ['substrate-interop@1'],
          datasets: [],
          environment_config: 'envcfg-interop',
          evaluator_version: 'evaluator-interop@1',
        },
        trials: [],
        finalization: null,
      }),
    );
    for (const entry of aggregate.trials) {
      const appended = experiments.appendTrial(experiment, entry.trial);
      expect(appended.ok, JSON.stringify(appended.ok ? null : appended.errors)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// rl-protocol mirrors (T013) — the driver configuration
// ---------------------------------------------------------------------------

describe('rl-protocol mirrors (T013 trip wire)', () => {
  it('the DriverConfig field types are the T013 trainer-lane types', () => {
    const driver: compute.DriverConfig = unwrap(compute.validateDriverConfig((jobLiteral() as { readonly driver: unknown }).driver));
    const actor: rl.AgentInstanceId = driver.actor;
    const runtime: rl.RuntimeRef = driver.runtime;
    const bodies: readonly rl.BodyVersionRef[] = driver.body_versions;
    const substrates: readonly rl.SubstrateRef[] = driver.substrates;
    const models: readonly rl.RewardModelRef[] = unwrap(compute.validateJobLineage((jobLiteral() as { readonly lineage: unknown }).lineage)).reward_models;
    expect(actor).toBe('agent-interop');
    expect(runtime).toBe('@tradrl/learning/compute@1');
    expect(bodies).toEqual(['body-interop@1']);
    expect(substrates).toEqual(['substrate-interop@1']);
    expect(models).toEqual(['reward-model:obs-count@1']);
  });

  it('DriverConfig is EXACTLY the reference trainer options, both directions at runtime', () => {
    expectTypeOf<compute.DriverConfig>().toEqualTypeOf<ReferenceTrainerOptions>();
    const driver: compute.DriverConfig = unwrap(compute.validateDriverConfig((jobLiteral() as { readonly driver: unknown }).driver));

    // The REAL T013 guard accepts the compute lane's declared driver config.
    expect(isReferenceTrainerOptions(driver)).toBe(true);
    const trainerOptions: ReferenceTrainerOptions = driverConfigIsTrainerOptions(driver);
    const trainer = unwrap(createReferenceTrainer(trainerOptions));
    expect(typeof trainer.driveEpisode).toBe('function');

    // And the compute guard accepts the REAL trainer options literal.
    const realOptions = {
      actor: 'agent-interop-2',
      step_ms: 250,
      runtime: '@tradrl/learning/reference-trainer@1',
      body_versions: ['body@2'],
      substrates: ['sub@2'],
      data: ['dataset@1'],
    };
    expect(isReferenceTrainerOptions(realOptions)).toBe(true);
    expect(compute.isDriverConfig(realOptions)).toBe(true);
    expect(unwrap(compute.validateDriverConfig(realOptions)).step_ms).toBe(250);
  });

  it('canonical JSON parity: the compute canonicalizer produces the REAL packages bytes', () => {
    const value = { b: 1, a: [true, null, 'x'], c: { z: 0.5, y: '' } };
    const tree: unknown = value;
    if (!compute.isJsonValue(tree)) throw new Error('fixture must be JSON');
    const jsonValue: compute.JsonValue = tree;
    expect(compute.canonicalJson(jsonValue)).toBe(rl.canonicalJson(jsonValue as rl.JsonValue));
    expect(compute.canonicalJson(jsonValue)).toBe(trajectory.canonicalJson(jsonValue as trajectory.JsonValue));
    // Standard FNV-1a 32-bit test vectors (the digest discipline is
    // program-wide, not package-specific).
    expect(compute.fnv1a32Hex('')).toBe('811c9dc5');
    expect(compute.fnv1a32Hex('a')).toBe('e40c292c');
    expect(compute.fnv1a32Hex('foobar')).toBe('bf9cf968');
  });

  it("the seed discipline's trial/trajectory derivations mirror the T013 derivation discipline", () => {
    // T013: traj-<fnv1a32(run|episode)>; T014: traj-<fnv1a32(job|ordinal)> —
    // the same identity form, the distributed identity source.
    expect(compute.deriveJobTrajectoryId('job-interop' as compute.JobId, 2)).toBe(
      `traj-${compute.fnv1a32Hex('job-interop|2')}`,
    );
    expect(compute.deriveJobTrialId('job-interop' as compute.JobId, 2)).toBe(
      `trial-${compute.fnv1a32Hex('job-interop|2')}`,
    );
    // The T013 derivation over the same-shaped inputs produces the same
    // form (byte-parity of the discipline, not the identity source).
    expect(rl.deriveTrajectoryId('run-x' as rl.TrainingRunId, 'ep-y' as rl.EpisodeId)).toBe(
      `traj-${rl.fnv1a32Hex('run-x|ep-y')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// The whole-contract witness: the aggregated record's L9/L12 anchors
// ---------------------------------------------------------------------------

describe('the aggregated record binds the L9/L12 anchors of its jobs', () => {
  it('the aggregate carries the experiment/tenant/project of the job set', () => {
    const aggregate = referenceAggregate();
    const job: EpisodeJob = unwrap(compute.validateEpisodeJob(jobLiteral()));
    expect(aggregate.experiment).toBe(job.lineage.experiment);
    expect(aggregate.tenant).toBe(job.lineage.tenant);
    expect(aggregate.project).toBe(job.lineage.project);
    for (const entry of aggregate.trials) {
      // L9 coherence: the entry's lineage IS the job's declared lineage.
      expect(entry.lineage).toEqual(job.lineage);
    }
  });
});
