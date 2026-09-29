/**
 * The replay adapter tests — THE README CONTRACT (services/market-world/
 * README.md, T013 row): drive the REAL ReplayWorldService (imported here
 * in the TEST ONLY — the adapter itself never imports the replay lane)
 * through the five operations, bind its REAL ReplayRunRecord into the
 * experiment lineage, and emit the trial the experiments lane accepts.
 *
 * The replay world emits ZERO reward signals by design (L7) — the bridge
 * attaches its OWN reward models to the recorded trajectory, post-hoc.
 */

import { describe, expect, it } from 'vitest';

import * as rl from '../../../../packages/rl-protocol/src/index';
import * as experiments from '../../../../packages/experiments/src/index';
import * as trajectory from '../../../../packages/trajectory/src/index';
import {
  createReplayWorldService,
  createFixtureEventSource,
  fixtureSpec,
  fixtureWorldConfig,
} from '../../../market-world/src/index';
import { driveReplayEpisodeWithTrainer, isReplayWorldServiceShape, replayServiceAsEnvironmentPort } from './replay-adapter';
import { createReferenceTrainer } from './trainer';
import { createScriptedPolicy } from './policy';
import { createObservationCostRewardModel } from './reward-models';

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

function trainerOptions(): Record<string, unknown> {
  return {
    actor: 'agent-replay-bridge',
    step_ms: 750,
    runtime: '@tradrl/learning/reference-trainer@1',
    body_versions: ['body-replay-bridge@1'],
    substrates: ['substrate-replay-bridge@1'],
    data: ['dataset-replay-fixture'],
  };
}

/** A declaration binding the run to the replay fixture world's spec. */
function replayDeclaration(runId: string, seed: string): Record<string, unknown> {
  const spec = fixtureSpec({ seed }) as Record<string, unknown>;
  return {
    run_id: runId,
    method: 'rl',
    environment_spec: spec,
    reward_models: ['reward-model:obs-count@1'],
    step_budget: 8,
    seed,
    tenant: 'tenant-replay-bridge',
    project: 'prj-replay-bridge',
  };
}

/** One complete bridged replay episode over the REAL service. */
async function bridgeOnce(runId: string, seed: string): Promise<{ readonly run: rl.TrainingRunState; readonly episode: rl.EpisodeId; readonly record: unknown }> {
  const trainer = unwrap(createReferenceTrainer(trainerOptions()));
  const service = unwrap(createReplayWorldService(fixtureWorldConfig({ seed }), createFixtureEventSource({ seed })));
  const run = unwrap(trainer.prepareRun(replayDeclaration(runId, seed)));
  const bridged = await driveReplayEpisodeWithTrainer({ service, trainer, run, policy: createScriptedPolicy(`policy-${seed}`) });
  if (!bridged.ok) throw new Error(JSON.stringify(bridged.errors));
  return { run: bridged.value.run, episode: bridged.value.episode, record: bridged.value.world_record };
}

describe('the thin ReplayWorldService structural mirror', () => {
  it('the REAL service satisfies the structural guard and wraps into an EnvironmentPort', async () => {
    const service = unwrap(createReplayWorldService(fixtureWorldConfig({ seed: 'mirror-seed' }), createFixtureEventSource({ seed: 'mirror-seed' })));
    expect(isReplayWorldServiceShape(service)).toBe(true);
    const port = replayServiceAsEnvironmentPort(service);
    expect(rl.isEnvironmentPort(port)).toBe(true);
  });

  it('refuses non-service values with a typed invalid_environment', async () => {
    const trainer = unwrap(createReferenceTrainer(trainerOptions()));
    const run = unwrap(trainer.prepareRun(replayDeclaration('run-bad', 'bad-seed')));
    const bridged = await driveReplayEpisodeWithTrainer({ service: { nope: true }, trainer, run, policy: createScriptedPolicy('p') });
    expect(bridged.ok).toBe(false);
    if (!bridged.ok) expect(bridged.errors[0]?.code).toBe('invalid_environment');
  });
});

describe('THE README CONTRACT: driving the REAL replay world through the bridge', () => {
  it('loads, drives the five operations, and binds the REAL run record into lineage', async () => {
    const trainer = unwrap(createReferenceTrainer(trainerOptions()));
    const { run, episode, record } = await bridgeOnce('run-replay-1', 'replay-seed-1');

    // The episode was driven and recorded with a folded chain.
    expect(run.episodes.length).toBe(1);
    expect(run.steps_used).toBeGreaterThan(0);
    expect(unwrap(rl.verifyRunChain(run))).toBe(true);

    // The L9 lineage: the REAL ReplayRunRecord's fields.
    const lineage = unwrap(rl.extractWorldLineage(record));
    expect(lineage.config_hash.length).toBe(8);
    expect(lineage.chain_head.length).toBe(8);
    expect(lineage.spec_hash.length).toBe(8);
    expect(lineage.digest.length).toBe(8);
    expect((record as { readonly episode?: { readonly episode_id?: string } }).episode?.episode_id).toBe(episode);

    // L7: the replay world emitted ZERO reward signals — the recorded
    // trajectory's world channel is empty.
    const recorded = unwrap(trainer.episodeTrajectory(run, episode));
    expect(recorded.steps.every((step) => step.rewards.length === 0)).toBe(true);
    // And the observations ARE the fixture stream's deliveries (refs only).
    expect(recorded.steps.some((step) => step.observations.length > 0)).toBe(true);
    // The REAL trajectory package validates the whole record.
    expect(trajectory.validateTrajectory(recorded).ok).toBe(true);

    // L7 post-hoc: the bridge attaches ITS OWN reward model.
    const annotated = unwrap(trainer.annotateEpisode(run, episode, [createObservationCostRewardModel()]));
    expect(rl.everySignalCarriesModelRef(annotated)).toBe(true);
    expect(annotated.steps.some((step) => step.model_rewards.length > 0)).toBe(true);

    // Emit: finish + collect the trial with the world record bound.
    const finished = unwrap(rl.finishTrainingRun(run, { code: 'completed', detail: 'replay bridge drive' }));
    const trial = unwrap(
      trainer.collectTrial(finished, {
        trial_id: 'trial-replay-1' as rl.TrialId,
        arm: 'arm-treatment' as rl.ArmId,
        episode,
        trajectory: rl.deriveTrajectoryId(finished.declaration.run_id, episode),
        outcome: { note: 'replay-bridge evidence; evaluation owns acceptance (L7)' },
        failure_reason: null,
        started_at: (recorded.steps[0]?.clock.now as rl.TimestampMs) ?? 0,
        ended_at: (finished.termination ? recorded.steps[recorded.steps.length - 1]?.clock.now : null) as rl.TimestampMs,
        world_record: record,
      }),
    );
    expect(trial.lineage.world).toEqual(lineage);
    expect(trial.lineage.environment_config).toBe(rl.deriveEnvironmentConfigRef(unwrap(rl.validateEnvironmentSpec(replayDeclaration('run-replay-1', 'replay-seed-1').environment_spec))));
    // The experiments-lane guards accept the emitted trial.
    expect(experiments.validateTrialRecord(trial.trial).ok).toBe(true);
    expect(trainer.trialLog().entries.length).toBe(1);
  });

  it('is deterministic: two fresh services + the same seeds produce byte-identical runs (L9)', async () => {
    const first = await bridgeOnce('run-replay-det', 'replay-det-seed');
    const second = await bridgeOnce('run-replay-det', 'replay-det-seed');
    expect(JSON.stringify(first.run.episodes)).toBe(JSON.stringify(second.run.episodes));
    expect(first.run.step_chain).toEqual(second.run.step_chain);
    expect(rl.fnv1a32Hex(JSON.stringify(first.record))).toBe(rl.fnv1a32Hex(JSON.stringify(second.record)));

    // Different seeds produce different lineages (the world's digest differs).
    const other = await bridgeOnce('run-replay-other', 'replay-other-seed');
    const firstLineage = unwrap(rl.extractWorldLineage(first.record));
    const otherLineage = unwrap(rl.extractWorldLineage(other.record));
    expect(firstLineage.digest).not.toBe(otherLineage.digest);
  });
});
