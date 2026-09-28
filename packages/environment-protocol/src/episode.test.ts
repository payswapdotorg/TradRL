/**
 * The episode step protocol: full lifecycle (start -> emit -> observe ->
 * submit -> advance -> finish) and every rejected path — invalid action,
 * finished episode, unknown episode (store.test.ts), clock regression,
 * beyond-asOf, observe-beyond-now, stale sequence, future submission,
 * duplicate ids. Also: purity/immutability of transitions and determinism
 * of startEpisode.
 */

import { describe, expect, it } from 'vitest';

import {
  actorHighestSequence,
  advanceEpisode,
  emitObservations,
  emitRewardSignals,
  finishEpisode,
  isEpisodeFinish,
  isEpisodeResult,
  isEpisodeState,
  isTerminationReason,
  observeEpisode,
  startEpisode,
  submitAction,
  validateEnvironmentSpec,
  visibleRewardsAt,
  type AgentInstanceId,
  type EpisodeState,
  type EnvironmentSpec,
  type Observation,
} from './index';
import { isDeeplyFrozen, requireTimestampMs, type TimestampMs } from './index';

/** Trusted-literal constructor for actor ids in fixtures (brand cast). */
const agent = (id: string): AgentInstanceId => id as AgentInstanceId;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function specInput(): Record<string, unknown> {
  return {
    profile: {
      environment_id: 'env-stub-1',
      fidelity: 'reactive_replay',
      clock: {
        now: requireTimestampMs(1_000),
        asOf: requireTimestampMs(5_000),
        playbackSpeed: 1,
        paused: false,
        fidelity: 'reactive_replay',
        informationPolicy: 'point-in-time',
      },
      seed: 'seed-alpha-1',
      venue_scope: ['BINANCE'],
      instrument_scope: ['BTC-USDT'],
      latency_policy: null,
      fee_policy: null,
    },
    world: { world_id: 'world-stub', kind: 'stub' },
    information_policy: 'point-in-time',
  };
}

function spec(): EnvironmentSpec {
  const result = validateEnvironmentSpec(specInput());
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function started(): EpisodeState {
  const result = startEpisode(specInput());
  if (!result.ok) throw new Error(`fixture must start: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function observationAt(availableTime: number, id: string): Observation {
  const result = emitObservations(started(), [
    {
      observation_id: id,
      available_time: requireTimestampMs(availableTime),
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      payload: { tick: availableTime },
      provenance: { origin: 'simulated', source: 'stub-world', derived_from: [] },
    },
  ]);
  if (!result.ok) throw new Error(`fixture must emit: ${JSON.stringify(result.errors)}`);
  return result.value.pending[0];
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

describe('startEpisode', () => {
  it('starts a running episode with a deterministic id and the spec bound', () => {
    const episode = started();
    expect(episode.status).toBe('running');
    expect(episode.termination).toBeNull();
    expect(episode.pending).toEqual([]);
    expect(episode.accepted_actions).toEqual([]);
    expect(episode.rewards).toEqual([]);
    expect(episode.clock.now).toBe(1_000);
    expect(episode.clock.asOf).toBe(5_000);
    expect(episode.spec.profile.seed).toBe('seed-alpha-1');
    expect(episode.episode_id.startsWith('ep-')).toBe(true);
    expect(isEpisodeState(episode)).toBe(true);
  });

  it('is deterministic: equal spec inputs produce deep-equal states', () => {
    expect(started()).toEqual(started());
  });

  it('rejects a malformed spec with the validator errors', () => {
    const result = startEpisode({ profile: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('returns a deeply frozen state', () => {
    expect(isDeeplyFrozen(started())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// emit + observe (L4 carry)
// ---------------------------------------------------------------------------

describe('emitObservations', () => {
  it('appends validated observations without mutating the source state', () => {
    const before = started();
    const result = emitObservations(before, [
      {
        observation_id: 'tick-1',
        available_time: requireTimestampMs(1_500),
        venue: 'BINANCE',
        instrument: 'BTC-USDT',
        payload: { tick: 1 },
        provenance: { origin: 'simulated', source: 'stub-world', derived_from: [] },
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pending.length).toBe(1);
      expect(before.pending.length).toBe(0); // purity: the old state is untouched
      expect(result.value).not.toBe(before);
    }
  });

  it('accepts FUTURE-dated observations (embargo is representable)', () => {
    const result = emitObservations(started(), [
      {
        observation_id: 'embargoed',
        available_time: requireTimestampMs(4_000),
        venue: null,
        instrument: null,
        payload: { macro: 'cpi' },
        provenance: { origin: 'historical', source: 'replay-file', derived_from: [] },
      },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects a duplicate observation id (within the batch and against the pending set)', () => {
    const first = emitObservations(started(), [
      {
        observation_id: 'dup',
        available_time: requireTimestampMs(1_500),
        venue: null,
        instrument: null,
        payload: null,
        provenance: { origin: 'simulated', source: 'stub-world', derived_from: [] },
      },
    ]);
    if (!first.ok) throw new Error('fixture must emit');
    // Against the pending set.
    const second = emitObservations(first.value, [
      {
        observation_id: 'dup',
        available_time: requireTimestampMs(1_600),
        venue: null,
        instrument: null,
        payload: null,
        provenance: { origin: 'simulated', source: 'stub-world', derived_from: [] },
      },
    ]);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.errors[0].code).toBe('duplicate_observation');
    // Within one batch.
    const batch = emitObservations(started(), [
      { observation_id: 'a', available_time: requireTimestampMs(1_500), venue: null, instrument: null, payload: null, provenance: { origin: 'simulated', source: 's', derived_from: [] } },
      { observation_id: 'a', available_time: requireTimestampMs(1_600), venue: null, instrument: null, payload: null, provenance: { origin: 'simulated', source: 's', derived_from: [] } },
    ]);
    expect(batch.ok).toBe(false);
    if (!batch.ok) expect(batch.errors[0].code).toBe('duplicate_observation');
  });

  it('rejects a malformed observation envelope', () => {
    const result = emitObservations(started(), [{ observation_id: '' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid_field');
  });
});

describe('observeEpisode (the point-in-time delivery)', () => {
  function episodeWithTicks(): EpisodeState {
    // The clock advances to 4000 first; queries below are all <= now.
    // Ticks become available at 1000 (== start now), 2000, 3000, 3500 (derived), 4100 (still future even at now=4000).
    const result = emitObservations(started(), [
      { observation_id: 't0', available_time: requireTimestampMs(1_000), venue: null, instrument: null, payload: { n: 0 }, provenance: { origin: 'simulated', source: 'stub', derived_from: [] } },
      { observation_id: 't1', available_time: requireTimestampMs(2_000), venue: null, instrument: null, payload: { n: 1 }, provenance: { origin: 'simulated', source: 'stub', derived_from: [] } },
      { observation_id: 't2', available_time: requireTimestampMs(3_000), venue: null, instrument: null, payload: { n: 2 }, provenance: { origin: 'simulated', source: 'stub', derived_from: [] } },
      // A DERIVED observation computed from t1/t2, available at 3500 (inputs + delay).
      { observation_id: 'feat', available_time: requireTimestampMs(3_500), venue: null, instrument: null, payload: { mean: 1.5 }, provenance: { origin: 'simulated', source: 'mean-agg', derived_from: ['t1', 't2'] } },
      { observation_id: 'future', available_time: requireTimestampMs(4_100), venue: null, instrument: null, payload: { n: 9 }, provenance: { origin: 'simulated', source: 'stub', derived_from: [] } },
    ]);
    if (!result.ok) throw new Error('fixture must emit');
    const advanced = advanceEpisode(result.value, requireTimestampMs(4_000));
    if (!advanced.ok) throw new Error('fixture must advance');
    return advanced.value;
  }

  it('delivers exactly the observations with available_time <= at (inclusive boundary)', () => {
    const episode = episodeWithTicks();
    const at2k = observeEpisode(episode, requireTimestampMs(2_000));
    expect(at2k.ok).toBe(true);
    if (at2k.ok) {
      expect(at2k.value.map((observation) => observation.observation_id)).toEqual(['t0', 't1']);
    }
    // The derived feature at 3500 and the future tick at 4100 are withheld.
    const at3k = observeEpisode(episode, requireTimestampMs(3_000));
    if (at3k.ok) {
      expect(at3k.value.map((observation) => observation.observation_id)).toEqual(['t0', 't1', 't2']);
    }
    const at35k = observeEpisode(episode, requireTimestampMs(3_500));
    if (at35k.ok) {
      expect(at35k.value.map((observation) => observation.observation_id)).toEqual(['t0', 't1', 't2', 'feat']);
    }
  });

  it('an observation with available_time == now IS visible; == now + 1 is NOT', () => {
    const episode = episodeWithTicks();
    const now: TimestampMs = requireTimestampMs(2_000);
    const visible = observeEpisode(episode, now);
    if (!visible.ok) throw new Error('must observe');
    const ids = visible.value.map((observation) => observation.observation_id);
    expect(ids).toContain('t1'); // available_time == now -> visible
    expect(ids).not.toContain('t2'); // available_time == now + 1 -> withheld
  });

  it('observing is PURE: the state is unchanged and repeats are identical', () => {
    const episode = episodeWithTicks();
    const first = observeEpisode(episode, requireTimestampMs(2_000));
    const second = observeEpisode(episode, requireTimestampMs(2_000));
    expect(second).toEqual(first);
    expect(episode.pending.length).toBe(5);
  });

  it('rejects a query beyond the current now', () => {
    const unadvanced = started();
    const result = observeEpisode(unadvanced, requireTimestampMs(1_001));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('observation_beyond_now');
    // at == now is legal (inclusive).
    expect(observeEpisode(unadvanced, requireTimestampMs(1_000)).ok).toBe(true);
  });

  it('supports Time-Machine queries at past instants and on finished episodes', () => {
    const advanced = advanceEpisode(episodeWithTicks(), requireTimestampMs(4_000));
    if (!advanced.ok) throw new Error('must advance');
    const historical = observeEpisode(advanced.value, requireTimestampMs(1_500));
    if (historical.ok) {
      expect(historical.value.map((observation) => observation.observation_id)).toEqual(['t0']);
    }
    const finished = finishEpisode(advanced.value, { code: 'completed', detail: 'asOf reached' });
    if (!finished.ok) throw new Error('must finish');
    const afterFinish = observeEpisode(finished.value.episode, requireTimestampMs(2_000));
    expect(afterFinish.ok).toBe(true); // audit queries survive the finish
  });
});

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

describe('submitAction', () => {
  function actionInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      action_id: 'act-0',
      actor: 'agent-main',
      submitted_at: requireTimestampMs(1_000),
      client_sequence: 0,
      payload: { kind: 'probe' },
      ...overrides,
    };
  }

  it('accepts a valid request, appends it to the log, and leaves the old state untouched', () => {
    const before = started();
    const result = submitAction(before, actionInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.accepted_actions.length).toBe(1);
      expect(before.accepted_actions.length).toBe(0);
      expect(result.value).not.toBe(before);
    }
  });

  it('rejects an invalid envelope (validation only — no authority is exercised)', () => {
    const result = submitAction(started(), actionInput({ payload: () => 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid_field');
  });

  it('rejects an action whose submitted_at is after now (causal law), inclusive at == now', () => {
    const future = submitAction(started(), actionInput({ submitted_at: requireTimestampMs(1_001) }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.errors[0].code).toBe('action_from_future');
    const atNow = submitAction(started(), actionInput({ submitted_at: requireTimestampMs(1_000) }));
    expect(atNow.ok).toBe(true);
  });

  it('rejects a stale client_sequence (equal or lower than the actor last accepted)', () => {
    const first = submitAction(started(), actionInput());
    if (!first.ok) throw new Error('must submit');
    // Equal -> stale.
    const replay = submitAction(first.value, actionInput({ action_id: 'act-0b' }));
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.errors[0].code).toBe('stale_sequence');
    // Lower -> stale.
    const lower = submitAction(first.value, actionInput({ action_id: 'act-0c', client_sequence: 0 }));
    expect(lower.ok).toBe(false);
    // Higher -> accepted.
    const higher = submitAction(first.value, actionInput({ action_id: 'act-1', client_sequence: 1 }));
    expect(higher.ok).toBe(true);
  });

  it('tracks sequences per actor independently (multi-agent episodes are legal)', () => {
    const first = submitAction(started(), actionInput());
    if (!first.ok) throw new Error('must submit');
    const otherActor = submitAction(
      first.value,
      actionInput({ action_id: 'act-other', actor: agent('agent-hedge'), client_sequence: 0 }),
    );
    expect(otherActor.ok).toBe(true);
    expect(actorHighestSequence(started(), agent('agent-main'))).toBeNull();
    if (otherActor.ok) {
      expect(actorHighestSequence(otherActor.value, agent('agent-main'))).toBe(0);
      expect(actorHighestSequence(otherActor.value, agent('agent-hedge'))).toBe(0);
    }
  });

  it('rejects submissions to a finished episode', () => {
    const finished = finishEpisode(started(), { code: 'aborted', detail: 'operator abort' });
    if (!finished.ok) throw new Error('must finish');
    const result = submitAction(finished.value.episode, actionInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('episode_finished');
  });
});

// ---------------------------------------------------------------------------
// advance
// ---------------------------------------------------------------------------

describe('advanceEpisode (monotonic, <= asOf)', () => {
  it('advances forward and updates the clock immutably', () => {
    const before = started();
    const result = advanceEpisode(before, requireTimestampMs(2_000));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.clock.now).toBe(2_000);
      expect(before.clock.now).toBe(1_000);
      expect(result.value).not.toBe(before);
    }
  });

  it('FAILS on regression to an earlier instant', () => {
    const advanced = advanceEpisode(started(), requireTimestampMs(2_000));
    if (!advanced.ok) throw new Error('must advance');
    const regression = advanceEpisode(advanced.value, requireTimestampMs(1_999));
    expect(regression.ok).toBe(false);
    if (!regression.ok) expect(regression.errors[0].code).toBe('clock_regression');
  });

  it('FAILS on advancing past asOf', () => {
    const result = advanceEpisode(started(), requireTimestampMs(5_001));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('beyond_as_of');
    // Exactly asOf is the natural horizon — allowed.
    expect(advanceEpisode(started(), requireTimestampMs(5_000)).ok).toBe(true);
  });

  it('a no-op advance to the current now is legal', () => {
    expect(advanceEpisode(started(), requireTimestampMs(1_000)).ok).toBe(true);
  });

  it('rejects an invalid target timestamp', () => {
    const result = advanceEpisode(started(), 1.5 as unknown as TimestampMs);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid_timestamp');
  });

  it('rejects advancing a finished episode', () => {
    const finished = finishEpisode(started(), { code: 'completed', detail: 'asOf reached' });
    if (!finished.ok) throw new Error('must finish');
    const result = advanceEpisode(finished.value.episode, requireTimestampMs(2_000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('episode_finished');
  });
});

// ---------------------------------------------------------------------------
// rewards
// ---------------------------------------------------------------------------

describe('emitRewardSignals', () => {
  function rewardInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const episode = started();
    return {
      reward_id: 'rw-0',
      episode_id: episode.episode_id,
      at: requireTimestampMs(1_000),
      available_time: requireTimestampMs(1_200),
      value: 0.25,
      metric: 'stub-tick',
      source: 'stub-world',
      detail: null,
      ...overrides,
    };
  }

  it('emits a valid signal and keeps it pending its availability', () => {
    const episode = started();
    const result = emitRewardSignals(episode, [rewardInput()]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rewards.length).toBe(1);
      expect(visibleRewardsAt(result.value, requireTimestampMs(1_199)).length).toBe(0);
      expect(visibleRewardsAt(result.value, requireTimestampMs(1_200)).length).toBe(1); // inclusive
    }
  });

  it('rejects a signal naming a different episode', () => {
    const result = emitRewardSignals(started(), [rewardInput({ episode_id: 'ep-somewhere-else' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('reward_episode_mismatch');
  });

  it('rejects duplicates and malformed signals', () => {
    const first = emitRewardSignals(started(), [rewardInput()]);
    if (!first.ok) throw new Error('must emit');
    const dup = emitRewardSignals(first.value, [rewardInput()]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors[0].code).toBe('duplicate_reward');

    const malformed = emitRewardSignals(started(), [rewardInput({ value: Number.NaN, reward_id: 'rw-bad' })]);
    expect(malformed.ok).toBe(false);
  });

  it('rejects emission into a finished episode', () => {
    const finished = finishEpisode(started(), { code: 'terminal', detail: 'world end state' });
    if (!finished.ok) throw new Error('must finish');
    const result = emitRewardSignals(finished.value.episode, [rewardInput()]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('episode_finished');
  });
});

// ---------------------------------------------------------------------------
// finish
// ---------------------------------------------------------------------------

describe('finishEpisode', () => {
  it('produces the terminal state AND the immutable result record', () => {
    const withAction = submitAction(started(), {
      action_id: 'act-0',
      actor: 'agent-main',
      submitted_at: requireTimestampMs(1_000),
      client_sequence: 0,
      payload: null,
    });
    if (!withAction.ok) throw new Error('must submit');
    const advanced = advanceEpisode(withAction.value, requireTimestampMs(4_000));
    if (!advanced.ok) throw new Error('must advance');
    const finished = finishEpisode(advanced.value, { code: 'completed', detail: 'asOf reached' });
    expect(finished.ok).toBe(true);
    if (finished.ok) {
      const { episode, result } = finished.value;
      expect(isEpisodeFinish(finished.value)).toBe(true);
      expect(isEpisodeResult(result)).toBe(true);
      expect(episode.status).toBe('finished');
      expect(episode.termination).toEqual({ code: 'completed', detail: 'asOf reached' });
      expect(result.episode_id).toBe(episode.episode_id);
      expect(result.environment_id).toBe('env-stub-1');
      expect(result.final_now).toBe(4_000);
      expect(result.accepted_action_count).toBe(1);
      expect(result.pending_observation_count).toBe(0);
      expect(result.spec.profile.seed).toBe('seed-alpha-1'); // L9 binding
      expect(isDeeplyFrozen(result)).toBe(true);
    }
  });

  it('rejects an invalid termination reason (unknown code, empty detail)', () => {
    expect(finishEpisode(started(), { code: 'vanished', detail: 'x' }).ok).toBe(false);
    expect(finishEpisode(started(), { code: 'completed', detail: ' ' }).ok).toBe(false);
    expect(finishEpisode(started(), null).ok).toBe(false);
    expect(isTerminationReason({ code: 'aborted', detail: 'reason' })).toBe(true);
    expect(isTerminationReason({ code: 'aborted' })).toBe(false);
  });

  it('rejects finishing twice', () => {
    const once = finishEpisode(started(), { code: 'completed', detail: 'first' });
    if (!once.ok) throw new Error('must finish');
    const twice = finishEpisode(once.value.episode, { code: 'aborted', detail: 'second' });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.errors[0].code).toBe('episode_finished');
  });

  it('a finished episode rejects every mutation but stays queryable', () => {
    const finished = finishEpisode(started(), { code: 'completed', detail: 'end' });
    if (!finished.ok) throw new Error('must finish');
    const terminal = finished.value.episode;
    expect(emitObservations(terminal, []).ok).toBe(false);
    expect(
      submitAction(terminal, { action_id: 'x', actor: 'a', submitted_at: requireTimestampMs(1_000), client_sequence: 0, payload: null }).ok,
    ).toBe(false);
    expect(advanceEpisode(terminal, requireTimestampMs(2_000)).ok).toBe(false);
    expect(observeEpisode(terminal, requireTimestampMs(1_000)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// guards + purity
// ---------------------------------------------------------------------------

describe('state guards and total immutability', () => {
  it('isEpisodeState accepts protocol-constructed states and rejects malformed ones', () => {
    expect(isEpisodeState(started())).toBe(true);
    expect(isEpisodeState(null)).toBe(false);
    expect(isEpisodeState({})).toBe(false);
    expect(isEpisodeState({ ...started(), status: 'paused' })).toBe(false);
    expect(isEpisodeState({ ...started(), termination: { code: 'completed', detail: 'x' } })).toBe(false); // running with termination
  });

  it('mutation attempts on frozen states throw (deep immutability)', () => {
    const episode = started();
    const withTick = emitObservations(episode, [
      { observation_id: 't', available_time: requireTimestampMs(1_000), venue: null, instrument: null, payload: null, provenance: { origin: 'simulated', source: 's', derived_from: [] } },
    ]);
    if (!withTick.ok) throw new Error('must emit');
    expect(() => {
      (withTick.value as unknown as Record<string, unknown>)['status'] = 'finished';
    }).toThrow();
    expect(() => {
      (withTick.value.pending as unknown as unknown[]).push(observationAt(1_000, 't2'));
    }).toThrow();
  });

  it('transitions never reuse the previous state object; unchanged frozen arrays may be shared safely', () => {
    const a = started();
    const b = emitObservations(a, [
      { observation_id: 't', available_time: requireTimestampMs(1_000), venue: null, instrument: null, payload: null, provenance: { origin: 'simulated', source: 's', derived_from: [] } },
    ]);
    if (!b.ok) throw new Error('must emit');
    const c = advanceEpisode(b.value, requireTimestampMs(2_000));
    if (!c.ok) throw new Error('must advance');
    expect(b.value).not.toBe(c.value); // new state object
    expect(b.value.clock).not.toBe(c.value.clock); // new clock
    expect(Object.isFrozen(b.value.pending)).toBe(true); // sharing is safe because frozen
    expect([...b.value.pending]).toEqual([...c.value.pending]); // content preserved
    const d = emitObservations(b.value, [
      { observation_id: 't2', available_time: requireTimestampMs(2_000), venue: null, instrument: null, payload: null, provenance: { origin: 'simulated', source: 's', derived_from: [] } },
    ]);
    if (!d.ok) throw new Error('must emit');
    expect(b.value.pending).not.toBe(d.value.pending); // growing collections are copied
  });
});
