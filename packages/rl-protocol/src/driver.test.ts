/**
 * EpisodeDriver behavioral tests: lifecycle totality, the L4 gate, the
 * budget law, the delta discipline, world-reward recording, rejection
 * recording, immutability, and byte-determinism (run twice, deep-equal and
 * serialized-bytes-equal).
 *
 * The fake environment below is a TEST-LOCAL fixture (the package ships NO
 * world — the reference scripted world lives in services/learning): it
 * satisfies the EnvironmentPort structurally, enforces the same laws a real
 * world enforces (inclusive L4 boundary, causal action law, monotonic
 * anchored time), and emits optional world reward signals. The rogue
 * variant violates the boundary deliberately — the L4 trip wire's target.
 */

import { describe, expect, it } from 'vitest';

import * as rl from './index';

const T0 = 1_700_000_000_000;
const AS_OF = T0 + 3_000;

type SimpleResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { code: string; path: string; message: string }[] };

function okEnv<T>(value: T): SimpleResult<T> {
  return { ok: true, value };
}

function failEnv(code: string, message: string): { readonly ok: false; readonly errors: readonly { code: string; path: string; message: string }[] } {
  return { ok: false, errors: [{ code, path: '', message }] };
}

function unwrap<T>(result: SimpleResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected fixture failure: ${JSON.stringify(result.errors)}`);
}

function specLiteral(): Record<string, unknown> {
  return {
    profile: {
      environment_id: 'env-fake-driver',
      fidelity: 'exact_replay',
      clock: { now: T0, asOf: AS_OF, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
      seed: 'seed-fake',
      venue_scope: [],
      instrument_scope: [],
      latency_policy: null,
      fee_policy: null,
    },
    world: { world_id: 'world-fake', kind: 'fake' },
    information_policy: 'point-in-time',
  };
}

interface FakeWorldOptions {
  readonly seed: string;
  readonly ticks: number;
  readonly tickMs: number;
  readonly emitRewards: boolean;
}

/**
 * The scripted fake world: `ticks` observations, tick i available at
 * `T0 + (i+1) * tickMs`; one world reward per advance when `emitRewards`.
 * Fully deterministic given (seed, options, operation order).
 */
function createFakeWorld(options: FakeWorldOptions): rl.EnvironmentPort {
  let spec: rl.EnvironmentSpec | null = null;
  let episode: rl.EpisodeId | null = null;
  let clock: rl.ClockConfig = {
    now: T0 as rl.TimestampMs,
    asOf: AS_OF as rl.TimestampMs,
    playbackSpeed: 1,
    paused: false,
    fidelity: 'exact_replay',
    informationPolicy: 'point-in-time',
  };
  let status: 'running' | 'finished' = 'running';
  let termination: rl.TerminationReason | null = null;
  const rewards: rl.RewardSignalEnvelope[] = [];
  const acceptedCount = { value: 0 };
  let lastSequence: number | null = null;

  const view = (): rl.EpisodeView => ({
    episode_id: episode as rl.EpisodeId,
    clock,
    status,
    termination,
    rewards: [...rewards],
  });

  return {
    start(candidate: unknown): SimpleResult<rl.EpisodeView> {
      if (spec !== null) return failEnv('duplicate_episode', 'an episode is already bound');
      const specResult = rl.validateEnvironmentSpec(candidate);
      if (!specResult.ok) return specResult as SimpleResult<rl.EpisodeView>;
      spec = specResult.value;
      episode = `ep-fake-${rl.fnv1a32Hex(options.seed)}` as rl.EpisodeId;
      clock = { ...clock, now: spec.profile.clock.now, asOf: spec.profile.clock.asOf };
      return okEnv(view());
    },
    observe(id: rl.EpisodeId, at: rl.TimestampMs): SimpleResult<readonly rl.ObservationView[]> {
      if (id !== episode) return failEnv('unknown_episode', `episode ${id} is not known`);
      if ((at as number) > (clock.now as number)) return failEnv('observation_beyond_now', `at ${at} exceeds now ${clock.now}`);
      const visible: rl.ObservationView[] = [];
      for (let index = 0; index < options.ticks; index++) {
        const available = (T0 + (index + 1) * options.tickMs) as rl.TimestampMs;
        if ((available as number) <= (at as number)) {
          visible.push({ observation_id: `obs-${index}` as rl.ObservationId, available_time: available });
        }
      }
      return okEnv(visible);
    },
    submit(id: rl.EpisodeId, action: rl.ActionRecord): SimpleResult<rl.EpisodeView> {
      if (id !== episode) return failEnv('unknown_episode', `episode ${id} is not known`);
      if (status === 'finished') return failEnv('episode_finished', 'the episode is finished');
      if (!rl.isActionRecord(action)) return failEnv('invalid_action', 'malformed action envelope');
      if ((action.submitted_at as number) > (clock.now as number)) return failEnv('action_from_future', 'submitted_at is after now');
      if (lastSequence !== null && action.client_sequence <= lastSequence) {
        return failEnv('stale_sequence', `client_sequence ${action.client_sequence} is not greater than ${lastSequence}`);
      }
      lastSequence = action.client_sequence;
      acceptedCount.value += 1;
      return okEnv(view());
    },
    advance(id: rl.EpisodeId, to: rl.TimestampMs): SimpleResult<rl.EpisodeView> {
      if (id !== episode) return failEnv('unknown_episode', `episode ${id} is not known`);
      if (status === 'finished') return failEnv('episode_finished', 'the episode is finished');
      if ((to as number) < (clock.now as number)) return failEnv('clock_regression', `now ${clock.now}, target ${to}`);
      if ((to as number) > (clock.asOf as number)) return failEnv('beyond_as_of', `asOf ${clock.asOf}, target ${to}`);
      clock = { ...clock, now: to };
      if (options.emitRewards) {
        const index = rewards.length;
        rewards.push({
          reward_id: `rw-${index}` as rl.RewardId,
          at: to,
          available_time: to,
          value: -0.25,
          metric: 'fake-tick',
          source: 'fake-world',
          detail: null,
        });
      }
      return okEnv(view());
    },
    finish(id: rl.EpisodeId, reason: unknown): SimpleResult<rl.EpisodeFinishView> {
      if (id !== episode) return failEnv('unknown_episode', `episode ${id} is not known`);
      if (status === 'finished') return failEnv('episode_finished', 'already finished');
      if (!rl.isTerminationReason(reason)) return failEnv('invalid_termination', 'malformed termination');
      status = 'finished';
      termination = reason;
      const pendingCount = options.ticks; // the whole scripted universe
      return okEnv({
        episode: view(),
        result: {
          episode_id: episode as rl.EpisodeId,
          environment_id: (spec as rl.EnvironmentSpec).profile.environment_id,
          spec: spec as rl.EnvironmentSpec,
          termination: reason,
          final_now: clock.now,
          accepted_action_count: acceptedCount.value,
          pending_observation_count: pendingCount,
          rewards: [...rewards],
        },
      });
    },
  };
}

/** The rogue world: observe hands a FUTURE-dated observation (the L4 trip-wire target). */
function createRogueWorld(): rl.EnvironmentPort {
  const base = createFakeWorld({ seed: 'rogue', ticks: 2, tickMs: 100, emitRewards: false });
  return {
    ...base,
    observe(id: rl.EpisodeId, at: rl.TimestampMs): SimpleResult<readonly rl.ObservationView[]> {
      // The violation: an observation claiming availability AFTER the query instant.
      return okEnv([{ observation_id: 'obs-future' as rl.ObservationId, available_time: ((at as number) + 1) as rl.TimestampMs }]);
    },
  };
}

function freshDriver(budget = 10): rl.DriverState {
  return unwrap(rl.createEpisodeDriver({ seed: 'seed-driver-test', step_budget: budget, actor: 'agent-driver-test' }));
}

function startOn(world: rl.EnvironmentPort): rl.DriverState {
  return unwrap(rl.driverStart(freshDriver(), world, specLiteral()));
}

describe('driver lifecycle (start/observe/act/advance/finish + error paths)', () => {
  it('refuses operations before start with driver_not_started', () => {
    const driver = freshDriver();
    const world = createFakeWorld({ seed: 's1', ticks: 3, tickMs: 100, emitRewards: false });
    for (const result of [
      rl.driverObserve(driver, world, T0 as rl.TimestampMs),
      rl.driverAct(driver, world, [{ kind: 'hold', payload: null }]),
      rl.driverAdvance(driver, world, (T0 + 100) as rl.TimestampMs),
      rl.driverFinish(driver, world, { code: 'completed', detail: 'x' }),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.code).toBe('driver_not_started');
    }
  });

  it('refuses non-port environments and malformed specs at start', () => {
    const driver = freshDriver();
    const notAPort = { start: 'nope' };
    const failed = rl.driverStart(driver, notAPort, specLiteral());
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.errors[0]?.code).toBe('invalid_environment');

    const world = createFakeWorld({ seed: 's2', ticks: 1, tickMs: 100, emitRewards: false });
    const badSpec = rl.driverStart(driver, world, { nope: true });
    expect(badSpec.ok).toBe(false);
    if (!badSpec.ok) expect(badSpec.errors[0]?.code).toBe('missing_field');
  });

  it('drives a full episode: ordinals sequential, budget decremented, result captured', () => {
    const world = createFakeWorld({ seed: 's3', ticks: 20, tickMs: 100, emitRewards: true });
    let state = startOn(world);
    expect(state.status).toBe('running');
    expect(state.episode).toBe(`ep-fake-${rl.fnv1a32Hex('s3')}`);

    for (let step = 0; step < 3; step++) {
      const now = (state.clock as { readonly now: rl.TimestampMs }).now;
      state = unwrap(rl.driverObserve(state, world, now));
      state = unwrap(rl.driverAct(state, world, [{ kind: 'probe', payload: step }]));
      state = unwrap(rl.driverAdvance(state, world, ((now as number) + 500) as rl.TimestampMs));
    }
    expect(state.steps.length).toBe(3);
    expect(state.steps.map((step) => step.step)).toEqual([1, 2, 3]);
    expect(state.budget).toBe(7);
    expect(state.steps[1]?.clock.now).toBe((T0 + 1000) as rl.TimestampMs);

    // World-emitted rewards land in the steps they were emitted during.
    expect(state.steps[0]?.rewards.length).toBe(1);
    expect(state.steps[0]?.rewards[0]?.metric).toBe('fake-tick');

    const finished = unwrap(rl.driverFinish(state, world, { code: 'completed', detail: 'driver test' }));
    expect(finished.status).toBe('finished');
    expect(finished.termination?.code).toBe('completed');
    expect(finished.finish_result?.accepted_action_count).toBe(3);
  });

  it('records REJECTIONS as experience and continues the drive (L8: requests, never authority)', () => {
    const world = createFakeWorld({ seed: 's4', ticks: 5, tickMs: 100, emitRewards: false });
    let state = startOn(world);

    // First act: a proposal whose minted envelope the world ACCEPTS.
    state = unwrap(rl.driverAct(state, world, [{ kind: 'probe', payload: null }]));
    // Second act within the same step: force a rejection by simulating the
    // world's stale-sequence law — submit directly with a stale sequence.
    const staleAction: rl.ActionRecord = {
      action_id: 'manual-stale' as rl.ActionId,
      actor: 'agent-driver-test' as rl.AgentInstanceId,
      submitted_at: (state.clock as { readonly now: rl.TimestampMs }).now,
      client_sequence: 0, // not greater than the accepted 0
      payload: null,
    };
    const response = world.submit(state.episode as rl.EpisodeId, staleAction);
    expect(response.ok).toBe(false); // the world really rejects it

    // The driver's own rejection path: a proposal list whose SECOND item is
    // rejected because the FIRST consumed the sequence; use a rogue world
    // wrapper that rejects every submission.
    let rejecting = state;
    const rejectAll: rl.EnvironmentPort = {
      ...world,
      submit: (id, action) => failEnv('invalid_action', `rejected for test: ${action.action_id}`),
    };
    rejecting = unwrap(rl.driverAct(rejecting, rejectAll, [])); // no-op on empty proposals
    const acted = unwrap(
      rl.driverAct(rejecting, rejectAll, [
        { kind: 'a', payload: null },
        { kind: 'b', payload: null },
      ]),
    );
    expect(acted.open?.rejections.length).toBe(2);
    expect(acted.open?.rejections[0]?.errors[0]?.code).toBe('invalid_action');
    expect(acted.open?.rejections[0]?.action.action_id).toContain('-a2');
    expect(acted.open?.actions.length).toBe(1); // the earlier accepted one
  });

  it('polices the query instant (L4): observation_beyond_now and clock laws', () => {
    const world = createFakeWorld({ seed: 's5', ticks: 5, tickMs: 100, emitRewards: false });
    const state = startOn(world);

    const beyond = rl.driverObserve(state, world, ((state.clock as { readonly now: number }).now + 1) as rl.TimestampMs);
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(beyond.errors[0]?.code).toBe('observation_beyond_now');

    const regression = rl.driverAdvance(state, world, (T0 - 1) as rl.TimestampMs);
    expect(regression.ok).toBe(false);
    if (!regression.ok) expect(regression.errors[0]?.code).toBe('clock_regression');

    const pastAsOf = rl.driverAdvance(state, world, (AS_OF + 1) as rl.TimestampMs);
    expect(pastAsOf.ok).toBe(false);
    if (pastAsOf.ok) throw new Error('unreachable');
    expect(pastAsOf.errors[0]?.code).toBe('beyond_as_of');
  });

  it('THE L4 TRIP WIRE: a future-dated observation from a rogue world is a typed l4_boundary_violation', () => {
    const rogue = createRogueWorld();
    const state = startOn(rogue);
    const observed = rl.driverObserve(state, rogue, (state.clock as { readonly now: rl.TimestampMs }).now);
    expect(observed.ok).toBe(false);
    if (!observed.ok) {
      expect(observed.errors[0]?.code).toBe('l4_boundary_violation');
      expect(observed.errors[0]?.message).toContain('obs-future');
    }
  });

  it('records only observation REFS (the L4 envelope law: no payload ever reaches the log)', () => {
    const world = createFakeWorld({ seed: 's6', ticks: 5, tickMs: 100, emitRewards: false });
    let state = startOn(world);
    // Observe at T0 (nothing visible yet), advance to T0+500 (five ticks
    // become available), then observe AGAIN — the delivered refs land in
    // the open step and close at the next advance.
    state = unwrap(rl.driverObserve(state, world, (state.clock as { readonly now: rl.TimestampMs }).now));
    state = unwrap(rl.driverAdvance(state, world, (T0 + 500) as rl.TimestampMs));
    expect(state.steps.length).toBe(1); // the empty first step records nothing
    state = unwrap(rl.driverObserve(state, world, (T0 + 500) as rl.TimestampMs));
    state = unwrap(rl.driverAdvance(state, world, (T0 + 600) as rl.TimestampMs));
    expect(state.steps.length).toBe(2);
    expect(state.steps[1]?.observations.length).toBe(5);
    for (const ref of state.steps[1]?.observations ?? []) {
      expect(Object.keys(ref).sort()).toEqual(['available_time', 'observation_id']);
    }
  });

  it('applies the delta discipline: re-observation adds nothing already delivered', () => {
    const world = createFakeWorld({ seed: 's7', ticks: 5, tickMs: 100, emitRewards: false });
    let state = startOn(world);
    state = unwrap(rl.driverObserve(state, world, (state.clock as { readonly now: rl.TimestampMs }).now));
    expect(state.delivered.length).toBe(0); // nothing available at T0
    state = unwrap(rl.driverAdvance(state, world, (T0 + 500) as rl.TimestampMs));
    expect(state.steps.length).toBe(1); // the empty first step records nothing
    state = unwrap(rl.driverObserve(state, world, (T0 + 500) as rl.TimestampMs)); // delivers 5
    expect(state.open?.observations.length).toBe(5);
    const beforeReobservation = state.open?.observations.length ?? -1;
    const deliveredBefore = state.delivered.length;
    state = unwrap(rl.driverObserve(state, world, (T0 + 500) as rl.TimestampMs)); // re-observation: delta only
    expect(state.open?.observations.length).toBe(beforeReobservation); // nothing added
    expect(state.delivered.length).toBe(deliveredBefore); // the information set is unchanged
    state = unwrap(rl.driverAdvance(state, world, (T0 + 600) as rl.TimestampMs));
    expect(state.steps.length).toBe(2);
    expect(state.steps[1]?.observations.length).toBe(5);
  });

  it('enforces the budget: budget_exhausted refuses new steps; finish still works', () => {
    const world = createFakeWorld({ seed: 's8', ticks: 20, tickMs: 100, emitRewards: false });
    let state = unwrap(rl.createEpisodeDriver({ seed: 'seed-budget', step_budget: 2, actor: 'agent-budget' }));
    state = unwrap(rl.driverStart(state, world, specLiteral()));
    for (let step = 0; step < 2; step++) {
      const now = (state.clock as { readonly now: rl.TimestampMs }).now;
      state = unwrap(rl.driverObserve(state, world, now));
      state = unwrap(rl.driverAdvance(state, world, ((now as number) + 500) as rl.TimestampMs));
    }
    expect(state.budget).toBe(0);
    const observe = rl.driverObserve(state, world, (state.clock as { readonly now: rl.TimestampMs }).now);
    expect(observe.ok).toBe(false);
    if (!observe.ok) expect(observe.errors[0]?.code).toBe('budget_exhausted');
    const act = rl.driverAct(state, world, [{ kind: 'probe', payload: null }]);
    expect(act.ok).toBe(false);
    if (!act.ok) expect(act.errors[0]?.code).toBe('budget_exhausted');

    const finished = unwrap(rl.driverFinish(state, world, { code: 'step_limit', detail: 'budget of 2 exhausted' }));
    expect(finished.termination?.code).toBe('step_limit');
    expect(finished.steps.length).toBe(2);
  });

  it('use-after-finish and double-finish are typed driver_finished errors', () => {
    const world = createFakeWorld({ seed: 's9', ticks: 2, tickMs: 100, emitRewards: false });
    let state = startOn(world);
    const now = (state.clock as { readonly now: rl.TimestampMs }).now;
    state = unwrap(rl.driverObserve(state, world, now));
    state = unwrap(rl.driverAdvance(state, world, (T0 + 100) as rl.TimestampMs));
    state = unwrap(rl.driverFinish(state, world, { code: 'completed', detail: 'first finish' }));

    for (const result of [
      rl.driverObserve(state, world, (state.clock as { readonly now: rl.TimestampMs }).now),
      rl.driverAct(state, world, [{ kind: 'hold', payload: null }]),
      rl.driverAdvance(state, world, (T0 + 200) as rl.TimestampMs),
      rl.driverFinish(state, world, { code: 'aborted', detail: 'double finish' }),
      rl.driverStart(state, world, specLiteral()),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.code).toBe('driver_finished');
    }
  });

  it('closeStep at finish preserves the open step (nothing is pruned — L11 spirit)', () => {
    const world = createFakeWorld({ seed: 's10', ticks: 5, tickMs: 100, emitRewards: false });
    let state = startOn(world);
    state = unwrap(rl.driverAdvance(state, world, (T0 + 200) as rl.TimestampMs)); // step 1 (empty)
    state = unwrap(rl.driverObserve(state, world, (T0 + 200) as rl.TimestampMs)); // opens step 2 with 2 obs
    state = unwrap(rl.driverAct(state, world, [{ kind: 'probe', payload: null }]));
    const finished = unwrap(rl.driverFinish(state, world, { code: 'completed', detail: 'open step closed at finish' }));
    expect(finished.steps.length).toBe(1); // the empty advance recorded nothing
    const last = finished.steps[finished.steps.length - 1];
    expect(last?.observations.length).toBe(2);
    expect(last?.actions.length).toBe(1);
    expect(last?.clock.now).toBe((T0 + 200) as rl.TimestampMs);
  });
});

describe('driver determinism and immutability', () => {
  it('same (world script, seed): byte-identical step log, run twice', () => {
    const drive = (): rl.DriverState => {
      const world = createFakeWorld({ seed: 'det', ticks: 12, tickMs: 100, emitRewards: true });
      let state = unwrap(rl.createEpisodeDriver({ seed: 'seed-det', step_budget: 8, actor: 'agent-det' }));
      state = unwrap(rl.driverStart(state, world, specLiteral()));
      while ((state.clock as { readonly now: number }).now < (state.clock as { readonly asOf: number }).asOf) {
        const now = (state.clock as { readonly now: rl.TimestampMs }).now;
        const target = Math.min((now as number) + 400, (state.clock as { readonly asOf: number }).asOf) as rl.TimestampMs;
        state = unwrap(rl.driverObserve(state, world, now));
        state = unwrap(rl.driverAct(state, world, [{ kind: 'probe', payload: state.steps.length }]));
        state = unwrap(rl.driverAdvance(state, world, target));
      }
      return unwrap(rl.driverFinish(state, world, { code: 'completed', detail: 'determinism drive' }));
    };
    const first = drive();
    const second = drive();
    expect(first.steps.length).toBe(8);
    expect(JSON.stringify(first.steps)).toBe(JSON.stringify(second.steps));
    expect(rl.serializeDriverSteps(first)).toBe(rl.serializeDriverSteps(second));
    expect(rl.isDeeplyFrozen(first.steps)).toBe(true);
  });

  it('different seeds mint different step/causality ids (the seed is lineage)', () => {
    const driveWith = (seed: string): string => {
      const world = createFakeWorld({ seed: 'same-world', ticks: 2, tickMs: 100, emitRewards: false });
      let state = unwrap(rl.createEpisodeDriver({ seed, step_budget: 2, actor: 'agent-seed' }));
      state = unwrap(rl.driverStart(state, world, specLiteral()));
      state = unwrap(rl.driverObserve(state, world, (state.clock as { readonly now: rl.TimestampMs }).now));
      state = unwrap(rl.driverAdvance(state, world, (T0 + 100) as rl.TimestampMs));
      return (state.steps[0]?.step_id as string) ?? 'none';
    };
    expect(driveWith('seed-a')).not.toBe(driveWith('seed-b'));
  });

  it('driver states are deeply frozen; mutation attempts throw', () => {
    const world = createFakeWorld({ seed: 's11', ticks: 2, tickMs: 100, emitRewards: false });
    const state = startOn(world);
    expect(rl.isDeeplyFrozen(state)).toBe(true);
    expect(() => {
      (state as unknown as { budget: number }).budget = 999;
    }).toThrow();
    expect(() => {
      (state.steps as unknown as unknown[]).push('x');
    }).toThrow();
  });
});
