/**
 * Cross-package interoperability trip wires for @tradrl/rl-protocol.
 *
 * The bridge's mirrors are proven against the REAL canonical packages
 * PRESENT on this branch (static relative imports — the market-world
 * interop precedent; the frozen write surface permits test-only imports):
 *
 *   - @tradrl/environment-protocol (T005): TimestampMs parity, brand-tag
 *     parity, EXACT mirror equality (EnvironmentSpec / Action / clock),
 *     the one-way `Environment -> EnvironmentPort` consumer-view witness,
 *     and a full RUNTIME drive of the REAL StubEnvironment
 *     (services/environment-runner) through THIS package's EpisodeDriver —
 *     the strongest proof that the bridge drives real TradRL worlds.
 *   - @tradrl/trajectory (T011): TrajectoryStep / TrajectoryMetadata /
 *     ClockSample / RewardSignalRecord exact-mirror equality, and the
 *     runtime proof that the bridge's step logs, assembled trajectories and
 *     reward-annotated steps pass the REAL guards (and serialize through
 *     the REAL canonical serializer — byte-identical across two runs).
 *   - @tradrl/experiments (T011): TrialRecord exact-mirror equality and the
 *     runtime proof that the bridge's emitted trials pass the REAL
 *     validator.
 *
 * Type-level assertions fail `pnpm typecheck`; runtime assertions fail
 * `pnpm test`. Either way, a mirror can never drift silently.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as rl from './index';
import * as envProtocol from '../../environment-protocol/src/index';
import * as trajectory from '../../trajectory/src/index';
import * as experiments from '../../experiments/src/index';
import { createStubEnvironment } from '../../../services/environment-runner/src/index';

import type { Environment } from '../../environment-protocol/src/index';
import type { TrajectoryStep as RealTrajectoryStep } from '../../trajectory/src/index';
import type { TrialRecord as RealTrialRecord } from '../../experiments/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff a REAL T005 Environment satisfies the bridge's EnvironmentPort (the consumer view). */
function realEnvironmentSatisfiesPort(environment: Environment): rl.EnvironmentPort {
  return environment;
}

/** Compiles iff a REAL observation is assignable to the L4-minimal ObservationView (never read around the envelope). */
function realObservationIsView(observation: envProtocol.Observation): rl.ObservationView {
  return observation;
}

/** Compiles iff a REAL episode state is assignable to the bridge's EpisodeView. */
function realEpisodeStateIsView(state: envProtocol.EpisodeState): rl.EpisodeView {
  return state;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;
const AS_OF = T0 + 10_000;

/** A spec literal the REAL protocol validators accept (the market-world interop precedent). */
function specLiteral(): Record<string, unknown> {
  return {
    profile: {
      environment_id: 'env-rl-interop',
      fidelity: 'exact_replay',
      clock: { now: T0, asOf: AS_OF, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
      seed: 'seed-rl-interop',
      venue_scope: [],
      instrument_scope: [],
      latency_policy: null,
      fee_policy: null,
    },
    world: { world_id: 'world-rl-interop', kind: 'stub' },
    information_policy: 'point-in-time',
  };
}

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

/** A local deterministic policy for the drives (pure — the same input, the same proposals). */
function localPolicy(input: rl.PolicyInput): readonly rl.PolicyProposal[] {
  return [{ kind: 'probe', payload: input.observations.length }];
}

/** A local deterministic reward model for the annotation passes. */
function localRewardModel(): rl.RewardModel {
  return {
    model_ref: 'reward-model:interop-obs-count@1' as rl.RewardModelRef,
    declared_inputs: ['observations', 'clock'],
    transform: (scope: rl.RewardScope): readonly rl.RewardClaim[] => [
      {
        at: (scope.clock as { readonly now: rl.TimestampMs }).now,
        available_time: (scope.clock as { readonly now: rl.TimestampMs }).now,
        value: -(scope.observations as readonly unknown[]).length,
        metric: 'interop-observation-cost',
        detail: null,
        input_keys: ['observations', 'clock'],
      },
    ],
    metadata: { owner: 'interop', law: 'L7' },
  };
}

/** Drive the REAL StubEnvironment through THIS package's EpisodeDriver. */
function driveStubEpisode(seed: string, stepMs: number, budget: number): { readonly driver: rl.DriverState; readonly episode: string } {
  const environment = createStubEnvironment();
  const driver = unwrap(rl.createEpisodeDriver({ seed, step_budget: budget, actor: 'agent-rl-interop' }));
  const spec = unwrap(rl.validateEnvironmentSpec(specLiteral()));
  const started = unwrap(rl.driverStart(driver, environment, spec));

  let state = started;
  while ((state.clock as { readonly now: number }).now < (state.clock as { readonly asOf: number }).asOf) {
    const now = (state.clock as { readonly now: rl.TimestampMs }).now;
    const observed = rl.driverObserve(state, environment, now);
    if (!observed.ok) throw new Error(`observe failed: ${JSON.stringify(observed.errors)}`);
    state = observed.value;

    const proposals = localPolicy({
      episode_id: state.episode as string as rl.EpisodeId,
      step: state.steps.length + 1,
      now,
      observations: state.delivered,
    });
    const acted = rl.driverAct(state, environment, proposals);
    if (!acted.ok) throw new Error(`act failed: ${JSON.stringify(acted.errors)}`);
    state = acted.value;

    const asOfNumber = (state.clock as { readonly asOf: number }).asOf;
    const target = Math.min((now as number) + stepMs, asOfNumber) as rl.TimestampMs;
    const advanced = rl.driverAdvance(state, environment, target);
    if (!advanced.ok) throw new Error(`advance failed: ${JSON.stringify(advanced.errors)}`);
    state = advanced.value;
  }

  const finished = rl.driverFinish(state, environment, { code: 'completed', detail: 'interop drive' });
  if (!finished.ok) throw new Error(`finish failed: ${JSON.stringify(finished.errors)}`);
  return { driver: finished.value, episode: finished.value.episode as string };
}

/** Assemble the canonical trajectory from a finished drive. */
function assembleTrajectory(driver: rl.DriverState): rl.Trajectory {
  const spec = unwrap(rl.validateEnvironmentSpec(specLiteral()));
  const episode = driver.episode as string as rl.EpisodeId;
  const runId = 'run-interop-1' as rl.TrainingRunId;
  const metadata: rl.TrajectoryMetadata = {
    trajectory_id: rl.deriveTrajectoryId(runId, episode),
    tenant: 'tenant-interop' as rl.TenantId,
    project: 'prj-interop' as rl.ProjectId,
    episode,
    environment_config: rl.deriveEnvironmentConfigRef(spec),
    runtime: 'runner-rl-interop@1' as rl.RuntimeRef,
    data: [],
    body_versions: ['body-interop@1' as rl.BodyVersionRef],
    substrates: ['substrate-interop@1' as rl.SubstrateRef],
  };
  let record = unwrap(rl.createTrajectory(metadata, []));
  for (const step of driver.steps) {
    record = unwrap(rl.appendTrajectoryStep(record, step));
  }
  return record;
}

// ---------------------------------------------------------------------------
// TimestampMs + brand parity
// ---------------------------------------------------------------------------

describe('TimestampMs and brand-tag parity with the REAL lanes', () => {
  it('TimestampMs is mutually assignable and behaviorally identical across all four packages', () => {
    expectTypeOf<rl.TimestampMs>().toEqualTypeOf<envProtocol.TimestampMs>();
    expectTypeOf<rl.TimestampMs>().toEqualTypeOf<trajectory.TimestampMs>();
    expectTypeOf<rl.TimestampMs>().toEqualTypeOf<experiments.TimestampMs>();
    expect(rl.MIN_TIMESTAMP_MS).toBe(envProtocol.MIN_TIMESTAMP_MS);
    expect(rl.MAX_TIMESTAMP_MS).toBe(envProtocol.MAX_TIMESTAMP_MS);
    for (const sample of [0, 1, 1.5, -1, envProtocol.MAX_TIMESTAMP_MS, envProtocol.MAX_TIMESTAMP_MS + 1, Number.NaN, 'x', null]) {
      expect(rl.isTimestampMs(sample)).toBe(envProtocol.isTimestampMs(sample));
    }
    const fromReal = envProtocol.requireTimestampMs(T0);
    expect(rl.isTimestampMs(fromReal)).toBe(true);
  });

  it('the opaque reference brands are mutually assignable with their canonical owners', () => {
    expectTypeOf<rl.TrajectoryId>().toEqualTypeOf<trajectory.TrajectoryId>();
    expectTypeOf<rl.TrajectoryId>().toEqualTypeOf<experiments.TrajectoryId>();
    expectTypeOf<rl.StepId>().toEqualTypeOf<trajectory.StepId>();
    expectTypeOf<rl.CausalityId>().toEqualTypeOf<trajectory.CausalityId>();
    expectTypeOf<rl.EnvironmentConfigRef>().toEqualTypeOf<trajectory.EnvironmentConfigRef>();
    expectTypeOf<rl.EpisodeId>().toEqualTypeOf<envProtocol.EpisodeId>();
    expectTypeOf<rl.EpisodeId>().toEqualTypeOf<trajectory.EpisodeId>();
    expectTypeOf<rl.ObservationId>().toEqualTypeOf<envProtocol.ObservationId>();
    expectTypeOf<rl.ActionId>().toEqualTypeOf<envProtocol.ActionId>();
    expectTypeOf<rl.RewardId>().toEqualTypeOf<envProtocol.RewardId>();
    expectTypeOf<rl.TrialId>().toEqualTypeOf<experiments.TrialId>();
    expectTypeOf<rl.ArmId>().toEqualTypeOf<experiments.ArmId>();
    expectTypeOf<rl.TenantId>().toEqualTypeOf<trajectory.TenantId>();
    expectTypeOf<rl.ProjectId>().toEqualTypeOf<trajectory.ProjectId>();
    expectTypeOf<rl.BodyVersionRef>().toEqualTypeOf<trajectory.BodyVersionRef>();
    expectTypeOf<rl.SubstrateRef>().toEqualTypeOf<trajectory.SubstrateRef>();
    expect(rl.isTrajectoryId('traj-x')).toBe(trajectory.isTrajectoryId('traj-x'));
    expect(rl.isTrialId('trial-x')).toBe(experiments.isTrialId('trial-x'));
  });
});

// ---------------------------------------------------------------------------
// Environment-lane mirrors (T005)
// ---------------------------------------------------------------------------

describe('environment-protocol mirrors (T005 trip wire)', () => {
  it('EnvironmentSpec / Action / clock mirrors are EXACTLY the canonical types', () => {
    expectTypeOf<rl.EnvironmentSpec>().toEqualTypeOf<envProtocol.EnvironmentSpec>();
    expectTypeOf<rl.ActionRecord>().toEqualTypeOf<envProtocol.Action>();
    expectTypeOf<rl.ClockConfig>().toEqualTypeOf<envProtocol.ClockConfig>();
    expectTypeOf<rl.TerminationReason>().toEqualTypeOf<envProtocol.TerminationReason>();
    expectTypeOf<rl.EnvironmentProfile>().toEqualTypeOf<envProtocol.EnvironmentProfile>();
  });

  it('the REAL guards accept a value validated by the bridge mirror, and vice versa', () => {
    const byBridge = unwrap(rl.validateEnvironmentSpec(specLiteral()));
    expect(envProtocol.isEnvironmentSpec(byBridge)).toBe(true);
    expect(envProtocol.validateEnvironmentSpec(byBridge).ok).toBe(true);

    const byReal = unwrap(envProtocol.validateEnvironmentSpec(specLiteral()));
    expect(rl.isEnvironmentSpec(byReal)).toBe(true);
    expect(rl.validateEnvironmentSpec(byReal).ok).toBe(true);

    // Canonical spec JSON parity: the L9 anchor is byte-identical.
    expect(rl.canonicalSpecJson(byBridge)).toBe(envProtocol.canonicalSpecJson(byReal));
  });

  it('the REAL Environment satisfies the bridge EnvironmentPort (one-way consumer view)', () => {
    const stub = createStubEnvironment();
    const port: rl.EnvironmentPort = realEnvironmentSatisfiesPort(stub);
    expect(rl.isEnvironmentPort(port)).toBe(true);
    expect(envProtocol.isEnvironment(stub)).toBe(true);

    // The observation view law (L4): a REAL observation is assignable to the
    // view — the bridge's TYPE surface exposes only observation_id and
    // available_time, so compiled bridge code cannot read around the
    // envelope. The runtime proof is in the step log below: the driver
    // records refs and ONLY refs (Object.keys carries no payload).
    const observation: envProtocol.Observation = {
      observation_id: 'obs-1' as envProtocol.ObservationId,
      available_time: envProtocol.requireTimestampMs(T0),
      venue: null,
      instrument: null,
      payload: { hidden: 'payload' },
      provenance: { origin: 'simulated', source: 'interop', derived_from: [] },
    };
    const view: rl.ObservationView = realObservationIsView(observation);
    expect(view.observation_id).toBe('obs-1');

    const episodeStateShape: envProtocol.EpisodeState = unwrap(envProtocol.startEpisode(specLiteral()));
    const episodeView: rl.EpisodeView = realEpisodeStateIsView(episodeStateShape);
    expect(rl.isEpisodeView(episodeView)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Trajectory-lane mirrors (T011)
// ---------------------------------------------------------------------------

describe('trajectory mirrors (T011 trip wire)', () => {
  it('TrajectoryStep / metadata / clock sample / reward record are EXACTLY the canonical types', () => {
    expectTypeOf<rl.TrajectoryStep>().toEqualTypeOf<RealTrajectoryStep>();
    expectTypeOf<rl.TrajectoryMetadata>().toEqualTypeOf<trajectory.TrajectoryMetadata>();
    expectTypeOf<rl.ClockSample>().toEqualTypeOf<trajectory.ClockSample>();
    expectTypeOf<rl.RewardSignalRecord>().toEqualTypeOf<trajectory.RewardSignalRecord>();
    expectTypeOf<rl.ObservationRef>().toEqualTypeOf<trajectory.ObservationRef>();
    expectTypeOf<rl.RejectionRecord>().toEqualTypeOf<trajectory.RejectionRecord>();
  });

  it('drives the REAL StubEnvironment through the bridge driver; the step log passes the REAL trajectory guards', () => {
    const { driver, episode } = driveStubEpisode('seed-rl-interop', 500, 40);
    expect(driver.steps.length).toBeGreaterThan(0);
    expect(driver.status).toBe('finished');
    for (const step of driver.steps) {
      expect(trajectory.isTrajectoryStep(step)).toBe(true);
      expect(trajectory.validateTrajectoryStep(step).ok).toBe(true);
    }

    const record = assembleTrajectory(driver);
    const realValidated = trajectory.validateTrajectory(record);
    expect(realValidated.ok, JSON.stringify(realValidated.ok ? null : realValidated.errors)).toBe(true);
    expect(trajectory.isTrajectory(record)).toBe(true);

    // The REAL canonical serializer accepts the bridge-assembled record.
    const bytes = trajectory.serializeTrajectory(realValidated.ok ? realValidated.value : record);
    expect(typeof bytes).toBe('string');
    expect(episode.startsWith('ep-')).toBe(true);
  });

  it('two identical drives over fresh REAL stubs produce byte-identical serialized trajectories (L9)', () => {
    const first = driveStubEpisode('seed-rl-interop', 500, 40);
    const second = driveStubEpisode('seed-rl-interop', 500, 40);
    const bytesA = trajectory.serializeTrajectory(assembleTrajectory(first.driver) as trajectory.Trajectory);
    const bytesB = trajectory.serializeTrajectory(assembleTrajectory(second.driver) as trajectory.Trajectory);
    expect(bytesA).toBe(bytesB);
    expect(rl.serializeDriverSteps(first.driver)).toBe(rl.serializeDriverSteps(second.driver));
    expect(JSON.stringify(first.driver.steps)).toBe(JSON.stringify(second.driver.steps));
  });

  it('reward-annotated steps satisfy the REAL trajectory guards (model signals extend, never mutate)', () => {
    const { driver } = driveStubEpisode('seed-rl-interop', 500, 40);
    const record = assembleTrajectory(driver);
    const annotated = unwrap(rl.attachRewardSignals(record, [localRewardModel()]));
    expect(rl.everySignalCarriesModelRef(annotated)).toBe(true);
    for (const step of annotated.steps) {
      expect(trajectory.isTrajectoryStep(step)).toBe(true);
      expect(trajectory.validateTrajectoryStep(step).ok).toBe(true);
    }
    for (const reward of annotated.steps.flatMap((step) => step.model_rewards)) {
      // The model signal IS a canonical reward signal record (plus its ref).
      expect(trajectory.isRewardSignalRecord(reward)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Experiments-lane mirrors (T011)
// ---------------------------------------------------------------------------

describe('experiments mirrors (T011 trip wire)', () => {
  it('TrialRecord is EXACTLY the canonical type', () => {
    expectTypeOf<rl.TrialRecord>().toEqualTypeOf<RealTrialRecord>();
  });

  it('the bridge-emitted trial passes the REAL experiments validators', () => {
    const { driver } = driveStubEpisode('seed-rl-interop', 500, 40);
    const episode = driver.episode as string as rl.EpisodeId;
    const runId = 'run-interop-1' as rl.TrainingRunId;
    const trial: rl.TrialRecord = {
      trial_id: 'trial-interop-1' as rl.TrialId,
      arm: 'arm-treatment' as rl.ArmId,
      status: 'succeeded',
      trajectory: rl.deriveTrajectoryId(runId, episode),
      outcome: { note: 'bridge-emitted evidence; evaluation owns acceptance (L7)' },
      started_at: envProtocol.requireTimestampMs(T0),
      ended_at: envProtocol.requireTimestampMs(AS_OF),
      failure_reason: null,
    };
    expect(rl.isTrialRecord(trial)).toBe(true);
    const realResult = experiments.validateTrialRecord(trial);
    expect(realResult.ok, JSON.stringify(realResult.ok ? null : realResult.errors)).toBe(true);
    expect(experiments.isTrialRecord(unwrap(rl.validateTrialRecord(trial)))).toBe(true);
  });

  it("the REAL experiment log law accepts the bridge trial as one arm's evidence", () => {
    const { driver } = driveStubEpisode('seed-rl-interop', 500, 40);
    const episode = driver.episode as string as rl.EpisodeId;
    const runId = 'run-interop-1' as rl.TrainingRunId;
    const trialRecord = unwrap(
      rl.validateTrialRecord({
        trial_id: 'trial-interop-2' as rl.TrialId,
        arm: 'arm-control' as rl.ArmId,
        status: 'succeeded',
        trajectory: rl.deriveTrajectoryId(runId, episode),
        outcome: { suite: 'interop' },
        started_at: T0,
        ended_at: AS_OF,
        failure_reason: null,
      }),
    );
    // The canonical experiment record accepts the bridge's mirror record
    // directly (no adaptation): one experiment, one appended trial.
    const experiment = unwrap(
      experiments.createExperimentRecord({
        experiment_id: 'exp-interop-1',
        tenant: 'tenant-interop',
        project: 'prj-interop',
        goal: 'goal-interop',
        criteria: ['criteria-interop'],
        design: {
          hypothesis: 'The bridge emits experiments-lane-conformant trials.',
          intervention: { kind: 'bridge-drive', description: 'Drive the stub world through the T013 bridge.', parameters: {} },
          comparison: [
            { arm: 'arm-control', role: 'control', description: 'Baseline bridge drive.' },
            { arm: 'arm-treatment', role: 'treatment', description: 'Treatment bridge drive.' },
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
    const appended = experiments.appendTrial(experiment, trialRecord);
    expect(appended.ok, JSON.stringify(appended.ok ? null : appended.errors)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Canonical JSON parity
// ---------------------------------------------------------------------------

describe('canonical JSON parity', () => {
  it("the bridge canonicalizer produces the REAL packages' bytes", () => {
    const value = { b: 1, a: [true, null, 'x'], c: { z: 0.5, y: '' } };
    const tree: unknown = value;
    if (!rl.isJsonValue(tree)) throw new Error('fixture must be JSON');
    const jsonValue: rl.JsonValue = tree;
    expect(rl.canonicalJson(jsonValue)).toBe(trajectory.canonicalJson(jsonValue as trajectory.JsonValue));
    expect(rl.canonicalJson(jsonValue)).toBe(envProtocol.canonicalJson(jsonValue as envProtocol.JsonValue));
    // Standard FNV-1a 32-bit test vectors (the digest discipline is
    // program-wide, not package-specific).
    expect(rl.fnv1a32Hex('')).toBe('811c9dc5');
    expect(rl.fnv1a32Hex('a')).toBe('e40c292c');
    expect(rl.fnv1a32Hex('foobar')).toBe('bf9cf968');
  });
});
