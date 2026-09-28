/**
 * The EpisodeStore: the id-keyed mediation shell. Everything the pure
 * transitions do, keyed by episode id — plus exactly one new failure mode:
 * `unknown_episode`.
 */

import { describe, expect, it } from 'vitest';

import {
  advanceEpisode,
  createEpisodeStore,
  finishEpisode,
  startEpisode,
  type EpisodeState,
} from './index';
import { requireTimestampMs } from './index';

function specInput(): Record<string, unknown> {
  return {
    profile: {
      environment_id: 'env-stub-1',
      fidelity: 'generative',
      clock: {
        now: requireTimestampMs(1_000),
        asOf: requireTimestampMs(5_000),
        playbackSpeed: 1,
        paused: false,
        fidelity: 'generative',
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

function started(): EpisodeState {
  const result = startEpisode(specInput());
  if (!result.ok) throw new Error(`fixture must start: ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('createEpisodeStore', () => {
  it('starts episodes, registers them under their derived id, and snapshots stay in sync', () => {
    const store = createEpisodeStore();
    const start = store.start(specInput());
    expect(start.ok).toBe(true);
    if (!start.ok) throw new Error('must start');
    const episodeId = start.value.episode_id;
    expect(store.episodes).toEqual([episodeId]);
    expect(store.get(episodeId)?.status).toBe('running');

    const advanced = store.advance(episodeId, requireTimestampMs(2_000));
    expect(advanced.ok).toBe(true);
    expect(store.get(episodeId)?.clock.now).toBe(2_000);
  });

  it('mediates many episodes independently', () => {
    const store = createEpisodeStore();
    const first = store.start(specInput());
    const reseeded = specInput();
    (reseeded.profile as Record<string, unknown>).seed = 'seed-beta-2';
    const second = store.start(reseeded);
    if (!first.ok || !second.ok) throw new Error('must start');
    expect(store.episodes.length).toBe(2);
    expect(first.value.episode_id).not.toBe(second.value.episode_id);
  });

  it('rejects an invalid spec at start (no episode is registered)', () => {
    const store = createEpisodeStore();
    expect(store.start({ profile: null }).ok).toBe(false);
    expect(store.episodes).toEqual([]);
  });

  it('every operation on an UNKNOWN episode fails with unknown_episode', () => {
    const store = createEpisodeStore();
    const unknown = 'ep-does-not-exist' as ReturnType<typeof started>['episode_id'];
    for (const result of [
      store.emit(unknown, []),
      store.emitRewards(unknown, []),
      store.observe(unknown, requireTimestampMs(1_000)),
      store.submit(unknown, { action_id: 'a', actor: 'x', submitted_at: requireTimestampMs(1), client_sequence: 0, payload: null }),
      store.advance(unknown, requireTimestampMs(2_000)),
      store.finish(unknown, { code: 'completed', detail: 'x' }),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].code).toBe('unknown_episode');
    }
    expect(store.get(unknown)).toBeUndefined();
  });

  it('forwards the protocol failure modes unchanged (regression, beyond asOf, finished)', () => {
    const store = createEpisodeStore();
    const start = store.start(specInput());
    if (!start.ok) throw new Error('must start');
    const id = start.value.episode_id;

    expect(store.advance(id, requireTimestampMs(1_000)).ok).toBe(true); // no-op advance
    expect(store.advance(id, requireTimestampMs(999)).ok).toBe(false); // regression
    expect(store.advance(id, requireTimestampMs(5_001)).ok).toBe(false); // beyond asOf

    const finished = store.finish(id, { code: 'completed', detail: 'asOf reached' });
    expect(finished.ok).toBe(true);
    expect(store.get(id)?.status).toBe('finished');
    expect(store.advance(id, requireTimestampMs(3_000)).ok).toBe(false); // frozen clock
    expect(store.observe(id, requireTimestampMs(1_000)).ok).toBe(true); // audit query at/below final now still works
    expect(store.finish(id, { code: 'aborted', detail: 'again' }).ok).toBe(false); // double finish
  });

  it('emitted observations become visible through the store exactly at their availability', () => {
    const store = createEpisodeStore();
    const start = store.start(specInput());
    if (!start.ok) throw new Error('must start');
    const id = start.value.episode_id;

    const emitted = store.emit(id, [
      {
        observation_id: 't-2000',
        available_time: requireTimestampMs(2_000),
        venue: null,
        instrument: null,
        payload: { n: 1 },
        provenance: { origin: 'simulated', source: 'stub', derived_from: [] },
      },
    ]);
    expect(emitted.ok).toBe(true);

    // Withheld before availability even after the clock passes it? No — after
    // advancing to 2000 the boundary reveals it exactly (inclusive).
    const before = store.observe(id, requireTimestampMs(1_999));
    expect(before.ok).toBe(false); // beyond now: the clock has not moved yet
    const advanced = store.advance(id, requireTimestampMs(2_000));
    expect(advanced.ok).toBe(true);
    const visible = store.observe(id, requireTimestampMs(2_000));
    expect(visible.ok).toBe(true);
    if (visible.ok) {
      expect(visible.value.map((observation) => observation.observation_id)).toEqual(['t-2000']);
    }
  });

  it('duplicate observation ids are rejected through the store as well', () => {
    const store = createEpisodeStore();
    const start = store.start(specInput());
    if (!start.ok) throw new Error('must start');
    const id = start.value.episode_id;
    const observation = {
      observation_id: 'dup',
      available_time: requireTimestampMs(2_000),
      venue: null,
      instrument: null,
      payload: null,
      provenance: { origin: 'simulated', source: 'stub', derived_from: [] },
    };
    expect(store.emit(id, [observation]).ok).toBe(true);
    const second = store.emit(id, [observation]);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.errors[0].code).toBe('duplicate_observation');
  });

  it('finishing through the store yields the same terminal artifacts as the pure transition', () => {
    const store = createEpisodeStore();
    const start = store.start(specInput());
    if (!start.ok) throw new Error('must start');
    const id = start.value.episode_id;
    const storeFinish = store.finish(id, { code: 'terminal', detail: 'world end' });
    expect(storeFinish.ok).toBe(true);

    const pureFinish = finishEpisode(start.value, { code: 'terminal', detail: 'world end' });
    expect(pureFinish.ok).toBe(true);
    if (storeFinish.ok && pureFinish.ok) {
      expect(storeFinish.value.result).toEqual(pureFinish.value.result);
    }
  });

  it('advanceEpisode-equivalent monotonicity holds through the store across many steps', () => {
    const store = createEpisodeStore();
    const start = store.start(specInput());
    if (!start.ok) throw new Error('must start');
    const id = start.value.episode_id;
    let now = 1_000;
    while (now < 5_000) {
      const next = Math.min(now + 1_000, 5_000);
      const advanced = store.advance(id, requireTimestampMs(next));
      expect(advanced.ok).toBe(true);
      now = next;
    }
    expect(store.get(id)?.clock.now).toBe(5_000);
    expect(store.advance(id, requireTimestampMs(5_000)).ok).toBe(true); // no-op at the horizon
    expect(store.advance(id, requireTimestampMs(5_001)).ok).toBe(false);
    // The pure transition agrees on the terminal clock.
    expect(advanceEpisode(start.value, requireTimestampMs(5_000)).ok).toBe(true);
  });
});
