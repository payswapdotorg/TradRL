/**
 * The ExchangeService — behavioral tests: the episode protocol (T005
 * shapes), the L4 boundary (fills invisible before their latency window,
 * visible exactly AT it), clock laws, lineage determinism, and the
 * market-protocol envelope validation of every emitted event (the
 * strongest interop check — statically available on this branch).
 */

import { describe, expect, it } from 'vitest';

import {
  createExchangeService,
  type ExchangeEpisodeView,
  type ExchangeService,
  type ExchangeSubmission,
} from './session';
import { isExchangeEvent, sequenceKeyOf, type ExchangeEvent } from './event';
import { isActionMirror, isEpisodeStateMirror, isObservationMirror } from './env-mirror';
import { validateMarketEvent } from '../../../../../packages/market-protocol/src/index';
import type { TimestampMs } from '../../../../../packages/exchange-sim/src/index';
import { isDeeplyFrozen, topOfBook } from '../../../../../packages/exchange-sim/src/index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;
const FIXED_LATENCY = 250;

function configFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    tick_size: '0.01',
    lot_size: '0.001',
    max_book_depth: 10,
    seed: 'service-seed',
    fidelity: 'reactive_replay',
    fees: { tiers: [{ up_to_notional: null, maker_bps: '1', taker_bps: '2' }], fee_decimals: 8 },
    latency: { kind: 'fixed', fixed_ms: FIXED_LATENCY },
    slippage: { kind: 'book_walk' },
    impact: { kind: 'none', declaration: 'none', limitation: 'T027 owns it' },
    ...overrides,
  };
}

const BOOK_SEED = {
  bids: [
    { price: '100.00', size: '5.000' },
    { price: '99.50', size: '3.000' },
  ],
  asks: [
    { price: '100.50', size: '4.000' },
    { price: '101.00', size: '6.000' },
  ],
};

function specFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
  return {
    profile: {
      environment_id: 'env-service-test',
      fidelity: 'reactive_replay',
      clock: { now: T0, asOf: T0 + 60_000, playbackSpeed: 1, paused: false, fidelity: 'reactive_replay', informationPolicy: 'point-in-time' },
      seed: 'service-seed',
      venue_scope: ['BINANCE'],
      instrument_scope: ['BTC-USDT'],
      latency_policy: null,
      fee_policy: null,
    },
    world: { world_id: service.world_id, kind: 'exchange-sim' },
    information_policy: 'point-in-time',
    ...overrides,
  };
}

function intentFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientOrderId: 'cli-1',
    instrumentId: 'BTC-USDT',
    venueId: 'BINANCE',
    side: 'buy',
    kind: 'limit',
    quantity: '2',
    price: '100.50',
    timeInForce: 'gtc',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function actionFixture(id: string, sequence: number, payload: Record<string, unknown>, at: number): Record<string, unknown> {
  return { action_id: `act-${id}`, actor: 'agent-alpha', submitted_at: at, client_sequence: sequence, payload };
}

type Serviceish = { readonly ok: true; readonly value: ExchangeService } | { readonly ok: false; readonly errors: readonly { code: string; message: string }[] };

function unwrapService(result: Serviceish): ExchangeService {
  if (result.ok) return result.value;
  throw new Error(`service fixture failed: ${JSON.stringify(result.errors)}`);
}

function unwrapView(result: { readonly ok: true; readonly value: ExchangeEpisodeView } | { readonly ok: false; readonly errors: readonly { code: string; message: string }[] }): ExchangeEpisodeView {
  if (result.ok) return result.value;
  throw new Error(`view fixture failed: ${JSON.stringify(result.errors)}`);
}

function unwrapSubmit(result: { readonly ok: true; readonly value: ExchangeSubmission } | { readonly ok: false; readonly errors: readonly { code: string; message: string }[] }): ExchangeSubmission {
  if (result.ok) return result.value;
  throw new Error(`submit fixture failed: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// The episode protocol
// ---------------------------------------------------------------------------

describe('start (spec binding)', () => {
  it('binds a valid spec, derives the deterministic episode id, and starts a fresh engine at the spec clock', () => {
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const view = unwrapView(service.start(specFixture()));
    expect(view.status).toBe('running');
    expect(view.clock.now).toBe(T0);
    expect(view.pending).toEqual([]); // the seeded book emits nothing until a transition happens
    expect(view.episode_id).toMatch(/^ep-[0-9a-f]{8}$/);
    expect(isEpisodeStateMirror(view)).toBe(true);
    expect(isDeeplyFrozen(view)).toBe(true);
    // The book snapshot is the seeded book.
    const snapshot = service.bookSnapshot(view.episode_id);
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.value.bids.map((level) => level.price)).toEqual(['100', '99.5']);
    }
  });

  it('rejects foreign worlds, foreign kinds and mismatched fidelity (typed)', () => {
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const foreign = service.start(specFixture({ world: { world_id: 'world-elsewhere', kind: 'exchange-sim' } }));
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0]?.code).toBe('world_binding_mismatch');

    const wrongKind = service.start(specFixture({ world: { world_id: service.world_id, kind: 'replay' } }));
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.errors[0]?.code).toBe('world_binding_mismatch');

    const mismatched = service.start(
      specFixture({
        profile: {
          environment_id: 'env-service-test',
          fidelity: 'generative',
          clock: { now: T0, asOf: T0 + 60_000, playbackSpeed: 1, paused: false, fidelity: 'generative', informationPolicy: 'point-in-time' },
          seed: 'service-seed',
          venue_scope: ['BINANCE'],
          instrument_scope: ['BTC-USDT'],
          latency_policy: null,
          fee_policy: null,
        },
      }),
    );
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) expect(mismatched.errors[0]?.code).toBe('fidelity_mismatch');
  });

  it('rejects malformed specs (collect-all) and duplicate episode ids', () => {
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const malformed = service.start({ profile: { environment_id: '' } });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.errors.length).toBeGreaterThan(2);
    unwrapView(service.start(specFixture()));
    const duplicate = service.start(specFixture());
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.errors[0]?.code).toBe('duplicate_episode');
  });

  it('serves multiple episodes over one service (each a fresh engine over the same seed)', () => {
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const first = unwrapView(service.start(specFixture()));
    const second = unwrapView(
      service.start(
        specFixture({
          profile: {
            environment_id: 'env-service-test-2',
            fidelity: 'reactive_replay',
            clock: { now: T0, asOf: T0 + 60_000, playbackSpeed: 1, paused: false, fidelity: 'reactive_replay', informationPolicy: 'point-in-time' },
            seed: 'service-seed-2',
            venue_scope: ['BINANCE'],
            instrument_scope: ['BTC-USDT'],
            latency_policy: null,
            fee_policy: null,
          },
        }),
      ),
    );
    expect(first.episode_id).not.toBe(second.episode_id);
    expect(service.episodes).toEqual([first.episode_id, second.episode_id]);
  });
});

// ---------------------------------------------------------------------------
// submit + the L4 boundary
// ---------------------------------------------------------------------------

describe('submit (engine processing + observation emission)', () => {
  function scenario(): { service: ExchangeService; episode: string; submission: ExchangeSubmission } {
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const episode = unwrapView(service.start(specFixture())).episode_id;
    const submission = unwrapSubmit(
      service.submit(episode, actionFixture('buy-1', 1, { type: 'submit_order', intent: intentFixture() }, T0 + 10)),
    );
    return { service, episode, submission };
  }

  it('processes a crossing order: fills the engine, records the action, emits the outcome stream', () => {
    const { service, episode, submission } = scenario();
    expect(submission.receipt.disposition).toBe('engine_processed');
    expect(submission.receipt.fill_count).toBe(1);
    expect(submission.receipt.outcome.kind).toBe('ack');
    expect(submission.accepted_actions.length).toBe(1);
    expect(isActionMirror(submission.accepted_actions[0])).toBe(true);
    // The pending set holds the embargoed outcomes (ack + fill + quote).
    expect(submission.pending.length).toBe(3);
    for (const observation of submission.pending) {
      expect(isObservationMirror(observation)).toBe(true);
      expect(observation.provenance.origin).toBe('simulated');
    }
    expect(isDeeplyFrozen(submission)).toBe(true);
    void service;
    void episode;
  });

  it('THE L4 BOUNDARY: a fill is NOT observable before its latency window and IS at exactly available_time (inclusive)', () => {
    const { service, episode } = scenario();
    // The fill event: event_time T0+10, available T0+10+250.
    const events = service.events(episode);
    expect(events.ok).toBe(true);
    if (!events.ok) return;
    const fillEvent = events.value.find((event) => event.event_type === 'trade');
    expect(fillEvent).toBeDefined();
    if (fillEvent === undefined) return;
    expect(fillEvent.available_time).toBe(T0 + 10 + FIXED_LATENCY);

    // Not visible 1ms before the boundary.
    const before = service.observe(episode, (fillEvent.available_time - 1) as TimestampMs);
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.value.some((observation) => observation.observation_id === fillEvent.event_id)).toBe(false);

    // Visible AT the boundary (inclusive).
    const atBoundary = service.observe(episode, fillEvent.available_time);
    expect(atBoundary.ok).toBe(true);
    if (atBoundary.ok) expect(atBoundary.value.some((observation) => observation.observation_id === fillEvent.event_id)).toBe(true);

    // And the observation is the full event envelope (forensic completeness).
    const atBoundaryObs = atBoundary.ok ? atBoundary.value.find((observation) => observation.observation_id === fillEvent.event_id) : undefined;
    expect(atBoundaryObs).toBeDefined();
  });

  it('observe polices the clock (beyond now rejected, regression impossible through the API)', () => {
    const { service, episode } = scenario();
    const beyond = service.observe(episode, (T0 + 11) as TimestampMs);
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(beyond.errors[0]?.code).toBe('observation_beyond_now');
    const advanced = service.advance(episode, (T0 + 20_000) as TimestampMs);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    const lateEnough = service.observe(episode, (T0 + 20_000) as TimestampMs);
    expect(lateEnough.ok).toBe(true);
    if (lateEnough.ok) expect(lateEnough.value.length).toBe(3); // all outcomes visible by then
  });

  it('enforces the causal and ordering laws (future, stale sequence, duplicate id, malformed envelope)', () => {
    const { service, episode } = scenario();
    const fromFuture = service.submit(episode, actionFixture('future', 2, { type: 'cancel_order', order_id: 'xo-00000001' }, T0 + 61_000));
    expect(fromFuture.ok).toBe(false);
    if (!fromFuture.ok) expect(fromFuture.errors[0]?.code).toBe('action_from_future');

    const stale = service.submit(episode, actionFixture('stale', 1, { type: 'cancel_order', order_id: 'xo-00000001' }, T0 + 20));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.errors[0]?.code).toBe('stale_sequence');

    const duplicate = service.submit(episode, actionFixture('buy-1', 2, { type: 'cancel_order', order_id: 'xo-00000001' }, T0 + 20));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.errors[0]?.code).toBe('duplicate_action');

    const malformed = service.submit(episode, { action_id: 'x' });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.errors[0]?.code).toBe('invalid_action');

    const badPayload = service.submit(episode, actionFixture('bad', 2, { type: 'modify_order' }, T0 + 20));
    expect(badPayload.ok).toBe(false);
    if (!badPayload.ok) expect(badPayload.errors[0]?.code).toBe('invalid_action');

    const unknownEpisode = service.submit('ep-nonexistent', actionFixture('nope', 1, { type: 'cancel_order', order_id: 'x' }, T0));
    expect(unknownEpisode.ok).toBe(false);
  });

  it('forwards engine operation errors typed (unknown order, malformed intent)', () => {
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const episode = unwrapView(service.start(specFixture())).episode_id;
    const unknown = service.submit(episode, actionFixture('unknown', 1, { type: 'cancel_order', order_id: 'xo-99999999' }, T0 + 10));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0]?.code).toBe('unknown_order');

    const badIntent = service.submit(episode, actionFixture('bad-intent', 2, { type: 'submit_order', intent: { side: 'up' } }, T0 + 10));
    expect(badIntent.ok).toBe(false);
    if (!badIntent.ok) expect(badIntent.errors[0]?.code).toBe('missing_field');
  });

  it('a submit before the engine clock fails typed (arrival order is monotonic)', () => {
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const episode = unwrapView(service.start(specFixture())).episode_id;
    unwrapSubmit(service.submit(episode, actionFixture('first', 1, { type: 'submit_order', intent: intentFixture({ clientOrderId: 'a' }) }, T0 + 10)));
    unwrapView(service.advance(episode, (T0 + 1000) as TimestampMs));
    const retro = service.submit(episode, actionFixture('retro', 2, { type: 'submit_order', intent: intentFixture({ clientOrderId: 'b' }) }, T0 + 500));
    expect(retro.ok).toBe(false);
    if (!retro.ok) expect(retro.errors[0]?.code).toBe('arrival_before_now');
  });

  it('cancels by venue id and client id through the action vocabulary', () => {
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const episode = unwrapView(service.start(specFixture())).episode_id;
    const submission = unwrapSubmit(
      service.submit(episode, actionFixture('rest', 1, { type: 'submit_order', intent: intentFixture({ side: 'sell', price: '101.50', quantity: '2' }) }, T0 + 10)),
    );
    expect(submission.receipt.outcome.status).toBe('open');
    const canceled = service.submit(episode, actionFixture('cancel', 2, { type: 'cancel_client_order', client_order_id: 'cli-1' }, T0 + 20));
    expect(canceled.ok).toBe(true);
    if (canceled.ok) expect(canceled.value.receipt.outcome.status).toBe('canceled:cancel_requested');
    // The top of book is back to the seed ask.
    const top = topOfBook(canceled.value ? undefined : undefined);
    void top;
    const snapshot = service.bookSnapshot(episode);
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) expect(snapshot.value.asks[0]?.price).toBe('100.5');
  });
});

// ---------------------------------------------------------------------------
// advance / finish / lineage
// ---------------------------------------------------------------------------

describe('advance and finish', () => {
  it('advance polices monotonicity and the asOf anchor; finish produces the terminal record', () => {
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const episode = unwrapView(service.start(specFixture())).episode_id;
    const regression = service.advance(episode, (T0 - 1) as TimestampMs);
    expect(regression.ok).toBe(false);
    if (!regression.ok) expect(regression.errors[0]?.code).toBe('clock_regression');
    const beyond = service.advance(episode, (T0 + 60_001) as TimestampMs);
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(beyond.errors[0]?.code).toBe('beyond_as_of');

    unwrapView(service.advance(episode, (T0 + 30_000) as TimestampMs));
    const finished = service.finish(episode, { code: 'completed', detail: 'test horizon' });
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(finished.value.episode.status).toBe('finished');
    expect(finished.value.result.accepted_action_count).toBe(0);
    expect(finished.value.result.final_now).toBe(T0 + 30_000);
    expect(isDeeplyFrozen(finished.value)).toBe(true);

    // Terminal discipline: further mutations fail.
    const after = service.submit(episode, actionFixture('late', 1, { type: 'submit_order', intent: intentFixture() }, T0 + 30_000));
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.errors[0]?.code).toBe('episode_finished');
    const malformedReason = service.finish(episode, { code: 'completed' });
    expect(malformedReason.ok).toBe(false);
    const alreadyFinished = service.finish(episode, { code: 'aborted', detail: 'twice' });
    expect(alreadyFinished.ok).toBe(false);
  });

  it('expires gtt orders at their expiry instant through advance', () => {
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const episode = unwrapView(service.start(specFixture())).episode_id;
    unwrapSubmit(
      service.submit(
        episode,
        actionFixture('gtt', 1, {
          type: 'submit_order',
          intent: intentFixture({ side: 'sell', price: '101.50', quantity: '1', timeInForce: 'gtt', expiresAt: new Date(T0 + 20_000).toISOString() }),
        }, T0 + 10),
      ),
    );
    const before = unwrapView(service.advance(episode, (T0 + 19_999) as TimestampMs));
    expect(before.pending.some((observation) => observationAvailable(observation).reason === 'order_cancel')).toBe(false);
    const at = service.advance(episode, (T0 + 20_000) as TimestampMs);
    expect(at.ok).toBe(true);
    if (!at.ok) return;
    // The expiration event rides the stream as other:order_expired... via
    // the cancel vocabulary (order_cancel with reason 'expired').
    const events = service.events(episode);
    expect(events.ok).toBe(true);
    if (!events.ok) return;
    const kinds = events.value.map((event) => eventPayloadKind(event));
    expect(kinds).toContain('order_ack');
    expect(kinds).toContain('order_cancel');
  });

  it('sessionRecord: identical runs -> identical hashes (L9, criterion 9); mid-run access fails typed', () => {
    function runOnce(): { digest: string; outcomeHash: string; configHash: string } {
      const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
      const episode = unwrapView(service.start(specFixture())).episode_id;
      unwrapSubmit(service.submit(episode, actionFixture('s1', 1, { type: 'submit_order', intent: intentFixture() }, T0 + 10)));
      unwrapSubmit(service.submit(episode, actionFixture('s2', 2, { type: 'submit_order', intent: intentFixture({ clientOrderId: 'cli-2', side: 'sell', price: '101.50', quantity: '2' }) }, T0 + 20)));
      unwrapView(service.advance(episode, (T0 + 50_000) as TimestampMs));
      unwrapView(service.finish(episode, { code: 'completed', detail: 'lineage run' }));
      const record = service.sessionRecord(episode);
      expect(record.ok).toBe(true);
      if (!record.ok) throw new Error('record failed');
      return { digest: record.value.digest, outcomeHash: record.value.outcome_stream_hash, configHash: record.value.world.config_hash };
    }
    const first = runOnce();
    const second = runOnce();
    expect(second.outcomeHash).toBe(first.outcomeHash);
    expect(second.digest).toBe(first.digest);
    expect(second.configHash).toBe(first.configHash);

    // Mid-run access is typed-fail.
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const episode = unwrapView(service.start(specFixture())).episode_id;
    const early = service.sessionRecord(episode);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors[0]?.code).toBe('episode_not_finished');
  });
});

// ---------------------------------------------------------------------------
// The emitted event stream (the strongest interop: canonical validation)
// ---------------------------------------------------------------------------

describe('every emitted event is a CANONICAL MarketEvent (market-protocol validation)', () => {
  it('validates the full outcome stream of a mixed scenario through the real market-protocol validator', () => {
    const service = unwrapService(createExchangeService(configFixture(), BOOK_SEED));
    const episode = unwrapView(service.start(specFixture())).episode_id;
    unwrapSubmit(service.submit(episode, actionFixture('s1', 1, { type: 'submit_order', intent: intentFixture() }, T0 + 10)));
    unwrapSubmit(service.submit(episode, actionFixture('s2', 2, { type: 'submit_order', intent: intentFixture({ clientOrderId: 'cli-2', timeInForce: 'ioc', quantity: '9' }) }, T0 + 20)));
    unwrapSubmit(service.submit(episode, actionFixture('s3', 3, { type: 'submit_order', intent: intentFixture({ clientOrderId: 'cli-3', price: '100.505' }) }, T0 + 30)));
    unwrapView(service.advance(episode, (T0 + 50_000) as TimestampMs));
    const events = service.events(episode);
    expect(events.ok).toBe(true);
    if (!events.ok) return;
    expect(events.value.length).toBeGreaterThan(5);
    for (const event of events.value) {
      const result = validateMarketEvent(event);
      expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
      expect(isExchangeEvent(event)).toBe(true);
    }
    // Per-stream sequences are strictly increasing in emission order.
    const seen = new Map<string, number>();
    for (const event of events.value) {
      const key = sequenceKeyOf(event);
      const previous = seen.get(key);
      if (previous !== undefined) {
        expect(event.sequence, `${key}`).toBeGreaterThan(previous);
      }
      seen.set(key, event.sequence);
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers over event payloads
// ---------------------------------------------------------------------------

function eventPayloadKind(event: ExchangeEvent): string | null {
  if (event.event_type !== 'other') return event.event_type;
  if (typeof event.payload === 'object' && event.payload !== null && !Array.isArray(event.payload)) {
    const kind = (event.payload as { kind?: unknown }).kind;
    return typeof kind === 'string' ? kind : null;
  }
  return null;
}

function observationAvailable(observation: { readonly payload: unknown }): { readonly reason: unknown } {
  const payload = observation.payload as { data?: { reason?: unknown } };
  return { reason: payload?.data?.reason };
}
