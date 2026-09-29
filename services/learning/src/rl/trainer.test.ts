/**
 * Reference trainer behavioral tests: the full bridge loop
 * (prepare -> drive -> record -> reward -> finish -> collect -> log) over
 * the scripted fixture world, with determinism (run twice, deep-equal and
 * byte-identical), the L7/L9/L11/L12 trip wires, the budget law, failed
 * trials as records, and the fixture's structural satisfaction of the REAL
 * environment-protocol `Environment` guard (the T005 interop proof).
 */

import { describe, expect, it } from 'vitest';

import * as rl from '../../../../packages/rl-protocol/src/index';
import * as envProtocol from '../../../../packages/environment-protocol/src/index';
import * as trajectory from '../../../../packages/trajectory/src/index';
import * as experiments from '../../../../packages/experiments/src/index';
import {
  createReferenceTrainer,
  type ReferenceTrainer,
} from './trainer';
import { createScriptedEnvironment, scriptedEpisodeId, scriptedWorldOptions } from './fixtures';
import { createScriptedPolicy } from './policy';
import {
  createActionEngagementRewardModel,
  createObservationCostRewardModel,
  createRogueRewardModel,
} from './reward-models';

const T0 = 1_700_000_000_000;
const AS_OF = T0 + 3_000;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

/** Trusted-literal id constructors (tests build typed evidence). */
const trialId = (id: string): rl.TrialId => id as rl.TrialId;
const armId = (id: string): rl.ArmId => id as rl.ArmId;

function trainerOptions(): Record<string, unknown> {
  return {
    actor: 'agent-trainer-test',
    step_ms: 400,
    runtime: '@tradrl/learning/reference-trainer@1',
    body_versions: ['body-trainer@1'],
    substrates: ['substrate-trainer@1'],
    data: [],
  };
}

function declarationLiteral(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: 'run-trainer-test',
    method: 'rl',
    environment_spec: {
      profile: {
        environment_id: 'env-trainer-test',
        fidelity: 'exact_replay',
        clock: { now: T0, asOf: AS_OF, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
        seed: 'seed-trainer-test',
        venue_scope: [],
        instrument_scope: [],
        latency_policy: null,
        fee_policy: null,
      },
      world: { world_id: 'world-scripted', kind: 'scripted' },
      information_policy: 'point-in-time',
    },
    reward_models: ['reward-model:obs-count@1', 'reward-model:act-count@1'],
    step_budget: 10,
    seed: 'seed-trainer-test',
    tenant: 'tenant-trainer-test',
    project: 'prj-trainer-test',
    ...overrides,
  };
}

function worldRecordLiteral(): Record<string, unknown> {
  return {
    schema: 'tradrl/replay-run-record@1',
    world: { world_id: 'world-scripted', config_hash: 'a1b2c3d4', seed: 'seed-trainer-test', as_of: AS_OF },
    episode: { episode_id: 'ep-x', environment_id: 'env-trainer-test', spec_hash: 'e5f6a7b8' },
    ingestion: { chain_head: 'c9d0e1f2' },
    digest: 'deadbeef',
  };
}

/** Drive one full run over a fresh scripted world (the complete bridge loop). */
function driveFullRun(): { readonly trainer: ReferenceTrainer; readonly run: rl.TrainingRunState; readonly episode: rl.EpisodeId } {
  const trainer = unwrap(createReferenceTrainer(trainerOptions()));
  const world = createScriptedEnvironment(scriptedWorldOptions({ seed: 'world-a', baseTime: T0, asOf: AS_OF, stepMs: 100, ticks: 12 }));
  const policy = createScriptedPolicy('policy-seed-a');
  let run = unwrap(trainer.prepareRun(declarationLiteral()));
  run = unwrap(trainer.driveEpisode(run, world, policy));
  const episode = run.episodes[run.episodes.length - 1]?.episode as rl.EpisodeId;
  return { trainer, run, episode };
}

// ---------------------------------------------------------------------------
// The fixture world satisfies the REAL environment protocol (T005 interop)
// ---------------------------------------------------------------------------

describe('the scripted fixture world (structural environment-protocol satisfaction)', () => {
  it('passes the REAL isEnvironment guard and the REAL spec/observation guards over its outputs', () => {
    const world = createScriptedEnvironment(scriptedWorldOptions({ seed: 'interop-fixture', baseTime: T0, asOf: AS_OF, ticks: 3 }));
    // The REAL T005 guard accepts the fixture (five function operations).
    expect(envProtocol.isEnvironment(world)).toBe(true);

    const started = world.start(unwrap(rl.validateEnvironmentSpec((declarationLiteral() as Record<string, unknown>).environment_spec)));
    expect(started.ok).toBe(true);
    if (started.ok) {
      // The REAL episode-state guard accepts the fixture's views (full shape:
      // spec, pending, accepted_actions, rewards).
      expect(envProtocol.isEpisodeState(started.value)).toBe(true);
    }
    const advanced = world.advance(scriptedEpisodeId('interop-fixture'), (T0 + 200) as rl.TimestampMs);
    expect(advanced.ok).toBe(true);
    const observed = world.observe(scriptedEpisodeId('interop-fixture'), (T0 + 200) as rl.TimestampMs);
    expect(observed.ok).toBe(true);
    if (observed.ok) {
      // The REAL observation guard accepts the fixture's envelopes (payload,
      // venue, instrument, provenance included).
      expect(observed.value.every((observation) => envProtocol.isObservation(observation))).toBe(true);
    }
    const submitted = world.submit(scriptedEpisodeId('interop-fixture'), {
      action_id: 'act-fixture-1',
      actor: 'agent-trainer-test',
      submitted_at: T0 + 200,
      client_sequence: 0,
      payload: null,
    });
    expect(submitted.ok).toBe(true);
    if (submitted.ok) expect(envProtocol.isEpisodeState(submitted.value)).toBe(true);
    const finished = world.finish(scriptedEpisodeId('interop-fixture'), { code: 'completed', detail: 'fixture interop' });
    expect(finished.ok).toBe(true);
    if (finished.ok) {
      expect(envProtocol.isEpisodeFinish(finished.value)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The full bridge loop
// ---------------------------------------------------------------------------

describe('the reference trainer: the full loop (drive -> record -> reward -> bind -> emit)', () => {
  it('drives an episode to completion and records it', () => {
    const { run, episode } = driveFullRun();
    expect(run.status).toBe('driving');
    expect(run.episodes.length).toBe(1);
    expect(episode).toBe(scriptedEpisodeId('world-a'));
    expect(run.steps_used).toBeGreaterThan(0);
    expect(run.steps_used).toBeLessThanOrEqual(10);
    expect(unwrap(rl.verifyRunChain(run))).toBe(true);
  });

  it('assembles the canonical trajectory and the REAL trajectory package validates it', () => {
    const { trainer, run, episode } = driveFullRun();
    const record = unwrap(trainer.episodeTrajectory(run, episode));
    expect(trajectory.validateTrajectory(record).ok).toBe(true);
    expect(record.metadata.trajectory_id).toBe(rl.deriveTrajectoryId(run.declaration.run_id, episode));
    expect(record.metadata.tenant).toBe('tenant-trainer-test');
    expect(record.metadata.body_versions).toEqual(['body-trainer@1']);
    // The world channel carries the scripted world's reward signals.
    expect(record.steps.some((step) => step.rewards.length > 0)).toBe(true);
  });

  it('annotates post-hoc with the DECLARED models; every signal carries its ref (L7)', () => {
    const { trainer, run, episode } = driveFullRun();
    const annotated = unwrap(
      trainer.annotateEpisode(run, episode, [createObservationCostRewardModel(), createActionEngagementRewardModel()]),
    );
    expect(rl.everySignalCarriesModelRef(annotated)).toBe(true);
    expect(annotated.applied_models).toEqual(['reward-model:obs-count@1', 'reward-model:act-count@1']);
    // The world channel is untouched: model rewards ride their own channel.
    for (const step of annotated.steps) {
      expect(step.model_rewards.every((reward) => reward.model_ref !== undefined)).toBe(true);
    }
    // The annotated steps satisfy the REAL trajectory guards.
    for (const step of annotated.steps) {
      expect(trajectory.isTrajectoryStep(step)).toBe(true);
    }
  });

  it('refuses a model the run did not declare (reward_model_mismatch — the declaration is the L9/L7 contract)', () => {
    const { trainer, run, episode } = driveFullRun();
    const result = trainer.annotateEpisode(run, episode, [createRogueRewardModel()]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('reward_model_mismatch');
  });

  it('the rogue model trips undeclared_reward_input when declared (the L7 input boundary)', () => {
    const { trainer, run, episode } = driveFullRun();
    const declaredRogue = unwrap(trainer.prepareRun(declarationLiteral({ reward_models: ['reward-model:rogue@1'] })));
    const driven = unwrap(
      trainer.driveEpisode(
        declaredRogue,
        createScriptedEnvironment(scriptedWorldOptions({ seed: 'world-rogue', baseTime: T0, asOf: AS_OF, ticks: 3 })),
        createScriptedPolicy('policy-rogue'),
      ),
    );
    const rogueEpisode = driven.episodes[driven.episodes.length - 1]?.episode as rl.EpisodeId;
    const annotated = trainer.annotateEpisode(driven, rogueEpisode, [createRogueRewardModel()]);
    expect(annotated.ok).toBe(false);
    if (!annotated.ok) expect(annotated.errors[0]?.code).toBe('undeclared_reward_input');
  });

  it('collects the trial: lineage-bound, REAL-experiments-valid, appended to the log', () => {
    const { trainer, run, episode } = driveFullRun();
    const finished = unwrap(rl.finishTrainingRun(run, { code: 'completed', detail: 'trainer test' }));
    const trial = unwrap(
      trainer.collectTrial(finished, {
        trial_id: trialId('trial-trainer-1'),
        arm: armId('arm-treatment'),
        episode,
        trajectory: rl.deriveTrajectoryId(finished.declaration.run_id, episode),
        outcome: { note: 'bridge evidence; evaluation owns acceptance (L7)' },
        failure_reason: null,
        started_at: T0 as rl.TimestampMs,
        ended_at: AS_OF as rl.TimestampMs,
        world_record: worldRecordLiteral(),
      }),
    );
    // The experiments-lane guards accept the emitted trial.
    expect(experiments.isTrialRecord(trial.trial)).toBe(true);
    expect(experiments.validateTrialRecord(trial.trial).ok).toBe(true);
    // The L9 lineage binds the world record's fields.
    expect(trial.lineage.world).toEqual({ config_hash: 'a1b2c3d4', chain_head: 'c9d0e1f2', spec_hash: 'e5f6a7b8', digest: 'deadbeef' });
    expect(trial.lineage.reward_models).toEqual(['reward-model:obs-count@1', 'reward-model:act-count@1']);
    // The log retains it.
    expect(trainer.trialLog().entries.map((entry) => entry.trial.trial_id)).toEqual(['trial-trainer-1']);
  });

  it('collectTrial refuses an unfinished run, an unknown episode, and an incoherent trajectory ref', () => {
    const { trainer, run, episode } = driveFullRun();
    const unfinished = trainer.collectTrial(run, {
      trial_id: trialId('t'),
      arm: armId('a'),
      episode,
      trajectory: rl.deriveTrajectoryId(run.declaration.run_id, episode),
      outcome: {},
      failure_reason: null,
      started_at: T0 as rl.TimestampMs,
      ended_at: AS_OF as rl.TimestampMs,
      world_record: worldRecordLiteral(),
    });
    expect(unfinished.ok).toBe(false);
    if (!unfinished.ok) expect(unfinished.errors[0]?.code).toBe('run_not_finished');

    const finished = unwrap(rl.finishTrainingRun(run, { code: 'completed', detail: 'x' }));
    const unknownEpisode = trainer.collectTrial(finished, {
      trial_id: trialId('t'),
      arm: armId('a'),
      episode: 'ep-never-driven' as rl.EpisodeId,
      trajectory: 'traj-x' as rl.TrajectoryId,
      outcome: {},
      failure_reason: null,
      started_at: T0 as rl.TimestampMs,
      ended_at: AS_OF as rl.TimestampMs,
      world_record: worldRecordLiteral(),
    });
    expect(unknownEpisode.ok).toBe(false);
    if (!unknownEpisode.ok) expect(unknownEpisode.errors[0]?.code).toBe('invalid_lineage');

    const wrongTrajectory = trainer.collectTrial(finished, {
      trial_id: trialId('t'),
      arm: armId('a'),
      episode,
      trajectory: 'traj-not-derived' as rl.TrajectoryId,
      outcome: {},
      failure_reason: null,
      started_at: T0 as rl.TimestampMs,
      ended_at: AS_OF as rl.TimestampMs,
      world_record: worldRecordLiteral(),
    });
    expect(wrongTrajectory.ok).toBe(false);
    if (!wrongTrajectory.ok) expect(wrongTrajectory.errors[0]?.code).toBe('invalid_lineage');
  });

  it('THE L11 TRIP WIRE: collecting the same trial id twice is a typed trial_rewrite refusal', () => {
    const { trainer, run, episode } = driveFullRun();
    const finished = unwrap(rl.finishTrainingRun(run, { code: 'completed', detail: 'x' }));
    const evidence = {
      trial_id: trialId('trial-dup'),
      arm: armId('arm-treatment'),
      episode,
      trajectory: rl.deriveTrajectoryId(finished.declaration.run_id, episode),
      outcome: { note: 'x' },
      failure_reason: null,
      started_at: T0 as rl.TimestampMs,
      ended_at: AS_OF as rl.TimestampMs,
      world_record: worldRecordLiteral(),
    };
    unwrap(trainer.collectTrial(finished, evidence));
    const duplicate = trainer.collectTrial(finished, evidence);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.errors[0]?.code).toBe('trial_rewrite');
      expect(duplicate.errors[0]?.message).toContain('L11');
    }
    // The log kept exactly one entry.
    expect(trainer.trialLog().entries.length).toBe(1);
  });

  it('failures are records: a failed trial carries its reason (the experiments-lane law)', () => {
    const { trainer, run, episode } = driveFullRun();
    const finished = unwrap(rl.finishTrainingRun(run, { code: 'step_limit', detail: 'budget' }));
    const trial = unwrap(
      trainer.collectTrial(finished, {
        trial_id: trialId('trial-failed-1'),
        arm: armId('arm-control'),
        episode,
        trajectory: rl.deriveTrajectoryId(finished.declaration.run_id, episode),
        outcome: null,
        failure_reason: 'environment rejected the second episode binding (duplicate episode)',
        started_at: T0 as rl.TimestampMs,
        ended_at: AS_OF as rl.TimestampMs,
        world_record: worldRecordLiteral(),
      }),
    );
    expect(trial.trial.status).toBe('failed');
    expect(trial.trial.failure_reason).toContain('duplicate episode');
    expect(experiments.validateTrialRecord(trial.trial).ok).toBe(true);
  });

  it('L12: a declaration missing tenant or project fails prepareRun', () => {
    const trainer = unwrap(createReferenceTrainer(trainerOptions()));
    const { tenant, ...withoutTenant } = declarationLiteral() as { tenant: string } & Record<string, unknown>;
    const tenantResult = trainer.prepareRun(withoutTenant);
    expect(tenantResult.ok).toBe(false);
    if (!tenantResult.ok) expect(tenantResult.errors[0]?.path).toBe('declaration.tenant');

    const { project, ...withoutProject } = declarationLiteral() as { project: string } & Record<string, unknown>;
    const projectResult = trainer.prepareRun(withoutProject);
    expect(projectResult.ok).toBe(false);
    if (!projectResult.ok) expect(projectResult.errors[0]?.path).toBe('declaration.project');
  });
});

// ---------------------------------------------------------------------------
// Determinism + budget + lifecycle
// ---------------------------------------------------------------------------

describe('trainer determinism, budget, and lifecycle', () => {
  it('same (world script, policy, seed, budget): byte-identical runs, twice (L9)', () => {
    const drive = (): { readonly run: rl.TrainingRunState; readonly bytes: string } => {
      const trainer = unwrap(createReferenceTrainer(trainerOptions()));
      const world = createScriptedEnvironment(scriptedWorldOptions({ seed: 'world-det', baseTime: T0, asOf: AS_OF, stepMs: 100, ticks: 10 }));
      const policy = createScriptedPolicy('policy-det');
      let run = unwrap(trainer.prepareRun(declarationLiteral({ run_id: 'run-det', seed: 'seed-det' })));
      run = unwrap(trainer.driveEpisode(run, world, policy));
      const finished = unwrap(rl.finishTrainingRun(run, { code: 'completed', detail: 'determinism' }));
      const bytes = JSON.stringify({ episodes: finished.episodes, step_chain: finished.step_chain });
      return { run: finished, bytes };
    };
    const first = drive();
    const second = drive();
    expect(first.bytes).toBe(second.bytes);
    expect(first.run.steps_used).toBe(second.run.steps_used);
    expect(rl.serializeDriverSteps as unknown).toBeDefined();
  });

  it('the step budget bounds the run; a second drive over an exhausted run is typed budget_exhausted', () => {
    const trainer = unwrap(createReferenceTrainer(trainerOptions()));
    const world = createScriptedEnvironment(scriptedWorldOptions({ seed: 'world-budget', baseTime: T0, asOf: T0 + 10_000, stepMs: 100, ticks: 40 }));
    const policy = createScriptedPolicy('policy-budget');
    let run = unwrap(trainer.prepareRun(declarationLiteral({ step_budget: 4 })));
    run = unwrap(trainer.driveEpisode(run, world, policy));
    expect(run.steps_used).toBe(4);
    const episode = run.episodes[0];
    expect(episode?.steps.length).toBe(4);

    // A fresh world for a second episode — but the budget is gone.
    const secondWorld = createScriptedEnvironment(scriptedWorldOptions({ seed: 'world-budget-2', baseTime: T0, asOf: T0 + 1_000, ticks: 4 }));
    const exhausted = trainer.driveEpisode(run, secondWorld, policy);
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) expect(exhausted.errors[0]?.code).toBe('budget_exhausted');
  });

  it('refuses driving a finished run, bad ports, and invalid options', () => {
    const trainer = unwrap(createReferenceTrainer(trainerOptions()));
    let run = unwrap(trainer.prepareRun(declarationLiteral()));
    run = unwrap(rl.finishTrainingRun(run, { code: 'completed', detail: 'x' }));
    const world = createScriptedEnvironment(scriptedWorldOptions({ seed: 'w', ticks: 2 }));
    const policy = createScriptedPolicy('p');
    const finishedRun = trainer.driveEpisode(run, world, policy);
    expect(finishedRun.ok).toBe(false);
    if (!finishedRun.ok) expect(finishedRun.errors[0]?.code).toBe('run_finished');

    const fresh = unwrap(trainer.prepareRun(declarationLiteral({ run_id: 'run-ports' })));
    const badEnv = trainer.driveEpisode(fresh, { nope: true } as unknown as rl.EnvironmentPort, policy);
    expect(badEnv.ok).toBe(false);
    if (!badEnv.ok) expect(badEnv.errors[0]?.code).toBe('invalid_environment');
    const badPolicy = trainer.driveEpisode(fresh, world, { propose: 'not-a-function' } as unknown as rl.PolicyPort);
    expect(badPolicy.ok).toBe(false);
    if (!badPolicy.ok) expect(badPolicy.errors[0]?.code).toBe('invalid_policy');

    const badOptions = createReferenceTrainer({ actor: '', step_ms: 0 });
    expect(badOptions.ok).toBe(false);
  });

  it('a world failure surfaces as a typed environment_error (failures are records)', () => {
    const trainer = unwrap(createReferenceTrainer(trainerOptions()));
    // The scripted world serves ONE episode: driving the same world twice
    // fails at start with the world's own code, mapped onto the closed
    // taxonomy with the code preserved in the message.
    const world = createScriptedEnvironment(scriptedWorldOptions({ seed: 'world-one', baseTime: T0, asOf: AS_OF, ticks: 2 }));
    const policy = createScriptedPolicy('p');
    let run = unwrap(trainer.prepareRun(declarationLiteral()));
    run = unwrap(trainer.driveEpisode(run, world, policy));
    const second = trainer.driveEpisode(run, world, policy);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.errors[0]?.code).toBe('environment_error');
      expect(second.errors[0]?.message).toContain('duplicate_episode');
    }
  });
});
