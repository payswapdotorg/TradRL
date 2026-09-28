/**
 * @tradrl/market-world — WorldAdapter tests: the episode protocol over a
 * loaded replay world.
 *
 * Covers: start validation (spec mirror laws, world binding, L5 mode
 * discipline, the as_of anchor), the deterministic episode id, the inclusive
 * observation boundary through the adapter, intent recording with typed
 * receipts (criterion 7: never a fill), the action laws (from-future, stale
 * sequence, duplicate id), episode scope filtering, finish semantics, and
 * restore (resume).
 */

import { describe, expect, it } from 'vitest';

import {
  createWorldAdapter,
  deserializeReplayWorldState,
  deriveEpisodeId,
  initReplayWorld,
  isDeeplyFrozen,
  requireTimestampMs,
  validateEnvironmentSpec,
  type EpisodeId,
  type ReplayWorldState,
  type WorldAdapter,
} from './index';
import { ingestWorld } from './transition';

const T0 = 1_700_000_000_000;
const AS_OF = T0 + 10_000;
const t = (ms: number) => requireTimestampMs(ms);

function configFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    world_id: 'world-replay-fixture',
    fidelity: 'exact_replay',
    information_policy: 'point-in-time',
    seed: 'seed-alpha',
    as_of: AS_OF,
    streams: [
      { venue: 'BINANCE', instrument: 'BTC-USDT' },
      { venue: 'XNAS', instrument: 'AAPL' },
    ],
    ...overrides,
  };
}

function eventFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'evt-1',
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: T0,
    source_time: T0,
    available_time: T0 + 40,
    ingestion_time: T0 + 100,
    sequence: 1,
    provider: 'binance',
    provenance: { origin: 'historical', adapter: { id: 'binance-adapter', version: '1.4.0' }, derived_from: [], transform: null },
    payload: { price: '43125.10', size: '0.017', side: 'buy' },
    ...overrides,
  };
}

function clockFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    now: T0,
    asOf: AS_OF,
    playbackSpeed: 1,
    paused: false,
    fidelity: 'exact_replay',
    informationPolicy: 'point-in-time',
    ...overrides,
  };
}

function profileFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    environment_id: 'env-replay-1',
    fidelity: 'exact_replay',
    clock: clockFixture(),
    seed: 'seed-alpha',
    venue_scope: [],
    instrument_scope: [],
    latency_policy: null,
    fee_policy: null,
    ...overrides,
  };
}

function specFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profile: profileFixture(),
    world: { world_id: 'world-replay-fixture', kind: 'replay' },
    information_policy: 'point-in-time',
    ...overrides,
  };
}

function makeAdapter(events: Record<string, unknown>[], configOverrides: Record<string, unknown> = {}): WorldAdapter {
  const world = initReplayWorld(configFixture(configOverrides));
  if (!world.ok) throw new Error(`world fixture failed: ${JSON.stringify(world.errors)}`);
  const loaded = ingestWorld(world.value, events);
  if (!loaded.ok) throw new Error(`load fixture failed: ${JSON.stringify(loaded.errors)}`);
  return createWorldAdapter(loaded.value);
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; errors: readonly { code: string; message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

const LOADED_EVENTS: Record<string, unknown>[] = [
  eventFixture({ event_id: 't1', event_time: T0, available_time: T0 + 100, sequence: 1 }),
  eventFixture({ event_id: 't2', event_time: T0 + 200, available_time: T0 + 200, sequence: 2 }),
  eventFixture({ event_id: 't3', event_time: T0 + 300, available_time: T0 + 300, sequence: 3 }),
  eventFixture({ event_id: 'a1', venue: 'XNAS', instrument: 'AAPL', asset_class: 'equity', event_time: T0 + 50, available_time: T0 + 150, sequence: 1 }),
];

describe('start — spec validation and world binding', () => {
  it('binds a valid spec, derives the mirrored episode id, and anchors the clock from the spec', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const view = unwrap(adapter.start(specFixture()));
    const spec = unwrap(validateEnvironmentSpec(specFixture()));
    expect(view.episode_id).toBe(deriveEpisodeId(spec)); // the mirrored derivation, live
    expect(view.episode_id.startsWith('ep-')).toBe(true);
    expect(view.clock.now).toBe(T0);
    expect(view.clock.asOf).toBe(AS_OF);
    expect(view.status).toBe('running');
    expect(view.termination).toBeNull();
    expect(view.rewards).toEqual([]); // replay never fabricates rewards
    expect(isDeeplyFrozen(view)).toBe(true);
    // Pending carries the full offered set (future-dated = embargoed), in arrival order.
    expect(view.pending.map((observation) => observation.observation_id)).toEqual(['t1', 'a1', 't2', 't3']);
  });

  it('rejects a malformed spec with the mirrored collect-all diagnostics', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const result = adapter.start({ profile: { clock: {} } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.code === 'missing_field' || error.code === 'invalid_field')).toBe(true);
  });

  it('rejects a spec bound to a DIFFERENT world (world_binding_mismatch)', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const result = adapter.start(specFixture({ world: { world_id: 'some-other-world', kind: 'replay' } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('world_binding_mismatch');
  });

  it('enforces the L5 mode discipline: non-exact-replay fidelity rejected (unsupported_fidelity)', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const reactive = specFixture({
      profile: profileFixture({ fidelity: 'reactive_replay', clock: clockFixture({ fidelity: 'reactive_replay' }) }),
    });
    const result = adapter.start(reactive);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('unsupported_fidelity');
  });

  it('rejects a spec whose clock anchors beyond the world as_of (beyond_world_as_of)', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const beyond = specFixture({ profile: profileFixture({ clock: clockFixture({ now: AS_OF, asOf: AS_OF + 1 }) }) });
    const result = adapter.start(beyond);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('beyond_world_as_of');
  });

  it('a sub-window episode (spec asOf < world as_of) is legal', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const sub = specFixture({ profile: profileFixture({ clock: clockFixture({ asOf: T0 + 250 }) }) });
    expect(adapter.start(sub).ok).toBe(true);
  });

  it('rejects re-starting the same spec (duplicate_episode: an episode id is a unique run)', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    expect(adapter.start(specFixture()).ok).toBe(true);
    const second = adapter.start(specFixture());
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.errors[0]?.code).toBe('duplicate_episode');
  });

  it('serves a SECOND episode over the same loaded history with an independent run line', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const first = unwrap(adapter.start(specFixture()));
    const second = unwrap(
      adapter.start(specFixture({ profile: profileFixture({ environment_id: 'env-replay-2', clock: clockFixture({ now: T0 + 100 }) }) })),
    );
    expect(second.episode_id).not.toBe(first.episode_id);
    expect(second.clock.now).toBe(T0 + 100);
    expect(adapter.episodes.length).toBe(2);
  });
});

describe('observe — the inclusive L4 boundary through the adapter', () => {
  it('delivers available_time == now and withholds now + 1; observations are full event envelopes', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const view = unwrap(adapter.start(specFixture()));
    const advanced = unwrap(adapter.advance(view.episode_id, t(T0 + 200)));
    expect(advanced.clock.now).toBe(T0 + 200);

    const visible = unwrap(adapter.observe(view.episode_id, t(T0 + 200)));
    expect(visible.map((observation) => observation.observation_id)).toEqual(['t1', 'a1', 't2']);
    // The withheld one (t3, available at T0+300):
    expect(visible.some((observation) => observation.observation_id === 't3')).toBe(false);

    // The payload IS the full recorded event envelope (forensic completeness).
    const t2 = visible.find((observation) => observation.observation_id === 't2');
    expect(t2).toBeDefined();
    const payload = t2?.payload as Record<string, unknown>;
    expect(payload.event_id).toBe('t2');
    expect(payload.event_type).toBe('trade');
    expect(payload.available_time).toBe(T0 + 200);
    expect(payload.sequence).toBe(2);
    expect((payload.payload as Record<string, unknown>).price).toBe('43125.10');
    expect(t2?.available_time).toBe(T0 + 200); // the L4 input, untransformed
    expect(t2?.venue).toBe('BINANCE');
    expect(t2?.provenance.origin).toBe('historical');
    expect(t2?.provenance.source).toBe('binance-adapter@1.4.0');
  });

  it('rejects observing beyond now (observation_beyond_now)', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const view = unwrap(adapter.start(specFixture()));
    const result = adapter.observe(view.episode_id, t(T0 + 201));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('observation_beyond_now');
  });

  it('rejects an unknown episode (unknown_episode)', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const result = adapter.observe('ep-nonexistent' as EpisodeId, t(T0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('unknown_episode');
  });

  it('honors the episode scope: a venue-scoped episode never sees out-of-scope streams', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const scoped = specFixture({ profile: profileFixture({ venue_scope: ['BINANCE'] }) });
    const view = unwrap(adapter.start(scoped));
    const advanced = unwrap(adapter.advance(view.episode_id, t(T0 + 300)));
    const visible = unwrap(adapter.observe(view.episode_id, t(T0 + 300)));
    // 'a1' is on XNAS — outside the episode's venue scope.
    expect(visible.map((observation) => observation.observation_id)).toEqual(['t1', 't2', 't3']);
    expect(advanced.pending.map((observation) => observation.observation_id)).toEqual(['t1', 't2', 't3']);
  });
});

describe('submit — intents with typed receipts, never fills (criterion 7)', () => {
  function startedAdapter(): { adapter: WorldAdapter; episodeId: EpisodeId } {
    const adapter = makeAdapter(LOADED_EVENTS);
    const view = unwrap(adapter.start(specFixture()));
    return { adapter, episodeId: view.episode_id };
  }

  function actionFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      action_id: 'act-1',
      actor: 'agent-alpha',
      submitted_at: T0 + 100,
      client_sequence: 1,
      payload: { kind: 'order_intent', side: 'buy', instrument: 'BTC-USDT', quantity: '0.01' },
      ...overrides,
    };
  }

  it('records an intent and returns a typed receipt — the disposition can only be recorded_as_intent', () => {
    const { adapter, episodeId } = startedAdapter();
    const submission = unwrap(adapter.submit(episodeId, actionFixture()));
    expect(submission.receipt.receipt_id).toBe(`intent:${episodeId}:act-1`);
    expect(submission.receipt.disposition).toBe('recorded_as_intent');
    expect(submission.receipt.recorded_at).toBe(T0); // the episode clock's now
    expect(submission.receipt.action_id).toBe('act-1');
    expect(submission.receipt.actor).toBe('agent-alpha');
    expect(submission.receipt.client_sequence).toBe(1);
    // The intent log on the episode state is complete and ordered.
    const state = adapter.episodeState(episodeId);
    expect(state?.intents.map((intent) => intent.action.action_id)).toEqual(['act-1']);
    // The accepted_actions view carries the requests.
    expect(submission.accepted_actions.map((action) => action.action_id)).toEqual(['act-1']);
  });

  it('never matches: the receipt type admits no fill (type-level) and no fill fields appear (runtime)', () => {
    const { adapter, episodeId } = startedAdapter();
    const submission = unwrap(adapter.submit(episodeId, actionFixture()));
    const receipt = submission.receipt;
    expect(Object.keys(receipt).sort()).toEqual(['action_id', 'actor', 'client_sequence', 'disposition', 'episode_id', 'receipt_id', 'recorded_at']);
    expect('fill' in receipt).toBe(false);
    expect('execution' in receipt).toBe(false);
    expect(receipt.disposition).toBe('recorded_as_intent');
  });

  it('rejects an action from the future (submitted_at > now) and accepts submitted_at == now (inclusive causal law)', () => {
    const { adapter, episodeId } = startedAdapter(); // now = T0
    const future = adapter.submit(episodeId, actionFixture({ submitted_at: T0 + 1 }));
    expect(future.ok).toBe(false);
    if (future.ok) return;
    expect(future.errors[0]?.code).toBe('action_from_future');

    const atNow = adapter.submit(episodeId, actionFixture({ action_id: 'act-at-now', submitted_at: T0 }));
    expect(atNow.ok).toBe(true);
  });

  it('rejects a stale client_sequence (per-actor, strictly increasing)', () => {
    const { adapter, episodeId } = startedAdapter();
    unwrap(adapter.submit(episodeId, actionFixture({ action_id: 'a1', client_sequence: 5 })));
    const stale = adapter.submit(episodeId, actionFixture({ action_id: 'a2', client_sequence: 5 }));
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.errors[0]?.code).toBe('stale_sequence');
    const regressed = adapter.submit(episodeId, actionFixture({ action_id: 'a3', client_sequence: 4 }));
    expect(regressed.ok).toBe(false);
    if (regressed.ok) return;
    expect(regressed.errors[0]?.code).toBe('stale_sequence');
    // The same actor may continue with a higher sequence.
    expect(adapter.submit(episodeId, actionFixture({ action_id: 'a4', client_sequence: 6 })).ok).toBe(true);
  });

  it('tracks sequences PER ACTOR (two actors may use the same client_sequence)', () => {
    const { adapter, episodeId } = startedAdapter();
    unwrap(adapter.submit(episodeId, actionFixture({ action_id: 'a1', actor: 'agent-alpha', client_sequence: 1 })));
    const other = adapter.submit(episodeId, actionFixture({ action_id: 'a2', actor: 'agent-beta', client_sequence: 1 }));
    expect(other.ok).toBe(true);
  });

  it('rejects a duplicate action id within the episode (receipt ids derive from them)', () => {
    const { adapter, episodeId } = startedAdapter();
    unwrap(adapter.submit(episodeId, actionFixture({ action_id: 'dupe' })));
    const second = adapter.submit(episodeId, actionFixture({ action_id: 'dupe', client_sequence: 2 }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.errors[0]?.code).toBe('duplicate_action');
  });

  it('rejects a malformed action envelope with collect-all diagnostics', () => {
    const { adapter, episodeId } = startedAdapter();
    const result = adapter.submit(episodeId, { action_id: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.code === 'missing_field')).toBe(true);
  });
});

describe('advance and finish', () => {
  it('advance enforces the mirrored clock law (regression, beyond asOf) and finishes terminate the episode', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const view = unwrap(adapter.start(specFixture()));
    expect(adapter.advance(view.episode_id, t(T0 - 1)).ok).toBe(false);
    expect(adapter.advance(view.episode_id, t(AS_OF + 1)).ok).toBe(false);
    unwrap(adapter.advance(view.episode_id, t(T0 + 250)));

    const finish = unwrap(adapter.finish(view.episode_id, { code: 'completed', detail: 'clock reached asOf' }));
    expect(finish.episode.status).toBe('finished');
    expect(finish.episode.termination?.code).toBe('completed');
    expect(finish.result.episode_id).toBe(view.episode_id);
    expect(finish.result.environment_id).toBe('env-replay-1');
    expect(finish.result.final_now).toBe(T0 + 250);
    expect(finish.result.accepted_action_count).toBe(0);
    expect(finish.result.pending_observation_count).toBe(4);
    expect(finish.result.rewards).toEqual([]);

    // Terminal policing: submit/advance/finish on the finished episode fail.
    expect(adapter.submit(view.episode_id, { action_id: 'late', actor: 'a', submitted_at: T0, client_sequence: 1, payload: null }).ok).toBe(false);
    expect(adapter.advance(view.episode_id, t(T0 + 300)).ok).toBe(false);
    expect(adapter.finish(view.episode_id, { code: 'aborted', detail: 'twice' }).ok).toBe(false);
    // Observation queries remain legal (audit-side).
    expect(adapter.observe(view.episode_id, t(T0 + 250)).ok).toBe(true);
  });

  it('rejects an invalid termination reason', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const view = unwrap(adapter.start(specFixture()));
    expect(adapter.finish(view.episode_id, { code: 'vaporized', detail: '' }).ok).toBe(false);
    expect(adapter.finish(view.episode_id, null).ok).toBe(false);
  });
});

describe('restoreEpisode (the resume path)', () => {
  it('re-registers a serialized episode state and continues identically', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const view = unwrap(adapter.start(specFixture()));
    unwrap(adapter.advance(view.episode_id, t(T0 + 100)));
    const submission = unwrap(
      adapter.submit(view.episode_id, { action_id: 'act-1', actor: 'agent-alpha', submitted_at: T0 + 100, client_sequence: 1, payload: { kind: 'intent' } }),
    );

    // Serialize the episode state (the resume artifact) into a FRESH adapter
    // built over the same loaded history.
    const state = adapter.episodeState(view.episode_id);
    if (state === undefined) throw new Error('state missing');
    const serialized = JSON.parse(JSON.stringify(state));
    const freshAdapter = makeAdapter(LOADED_EVENTS);
    const restoredId = unwrap(freshAdapter.restoreEpisode(deserializeState(serialized)));
    expect(restoredId).toBe(view.episode_id);

    // Continuation is identical in shape: same clock, same intent log, same pending set.
    const restoredView = freshAdapter.episode(restoredId);
    expect(restoredView?.clock.now).toBe(T0 + 100);
    expect(restoredView?.accepted_actions.map((action) => action.action_id)).toEqual(['act-1']);
    expect(restoredView?.pending.map((observation) => observation.observation_id)).toEqual(
      submission.pending.map((observation) => observation.observation_id),
    );
    // And the restored episode continues to behave: a further intent records.
    const continued = freshAdapter.submit(restoredId, { action_id: 'act-2', actor: 'agent-alpha', submitted_at: T0 + 100, client_sequence: 2, payload: { kind: 'intent' } });
    expect(continued.ok).toBe(true);
  });

  it('rejects a restored state from a different world config', () => {
    const adapter = makeAdapter(LOADED_EVENTS);
    const view = unwrap(adapter.start(specFixture()));
    const state = adapter.episodeState(view.episode_id);
    if (state === undefined) throw new Error('state missing');
    const foreignAdapter = makeAdapter(LOADED_EVENTS, { world_id: 'a-different-world', seed: 'other' });
    const result = foreignAdapter.restoreEpisode(state);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('invalid_state');
  });
});

/** Deserialize helper for the resume-path fixtures (typed failure = test bug). */
function deserializeState(value: unknown): ReplayWorldState {
  const result = deserializeReplayWorldState(value);
  if (!result.ok) throw new Error(`deserialize fixture failed: ${JSON.stringify(result.errors)}`);
  return result.value;
}
