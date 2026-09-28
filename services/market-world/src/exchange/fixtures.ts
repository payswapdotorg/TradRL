/**
 * @tradrl/market-world (exchange service) — deterministic fixture
 * scenarios (work order T010, acceptance criterion: "a scripted
 * order-flow + book-seed scenario replaying deterministically").
 *
 * Determinism (L9): every value is derived from the fixture seed — the
 * config (seeded uniform latency, so outcome availability draws are
 * seed-sensitive), the book seed (tick/lot-aligned levels), the episode
 * spec and the SCRIPTED order flow. Two runs of
 * {@link runExchangeFixture} produce BYTE-IDENTICAL outcome streams
 * (canonical JSON comparison) and identical session-record digests —
 * proven in fixtures.test.ts.
 *
 * The scenario deliberately exercises the full path space: a crossing
 * fill, a partial fill + rest, an IOC remainder cancel, a resting order
 * canceled by request, a rejected intent (wrong tick), a FOK death, and
 * a gtt expiry — so the byte-identity claim covers every outcome kind
 * the engine emits.
 */

import { createExchangeService, type ExchangeEpisodeView, type ExchangeService, type SessionRecord } from './session';
import { configHash, type TimestampMs } from '../../../../packages/exchange-sim/src/index';
import type { ServiceResult } from './errors';
import type { ExchangeEvent } from './event';
import type { JsonValue } from './env-mirror';
import { canonicalJson } from './env-mirror';

// ---------------------------------------------------------------------------
// Fixture values
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;

/** Fixture options: everything derives from the seed. */
export interface ExchangeFixtureOptions {
  /** The deterministic seed (config + latency draws + ids). Default 'exchange-fixture-alpha'. */
  readonly seed: string;
  /** The episode's asOf anchor (ms after T0). Default 120_000. */
  readonly horizonMs: number;
}

const DEFAULTS: ExchangeFixtureOptions = { seed: 'exchange-fixture-alpha', horizonMs: 120_000 };

/** The fixture exchange config: seeded uniform latency + book_walk slippage + a two-tier fee schedule. */
export function fixtureExchangeConfig(overrides: Partial<ExchangeFixtureOptions> = {}): Record<string, unknown> {
  const options = resolve(overrides);
  return {
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    tick_size: '0.01',
    lot_size: '0.001',
    max_book_depth: 10,
    seed: options.seed,
    fidelity: 'reactive_replay',
    fees: {
      tiers: [
        { up_to_notional: '1000', maker_bps: '1', taker_bps: '2' },
        { up_to_notional: null, maker_bps: '0.5', taker_bps: '1' },
      ],
      fee_decimals: 8,
    },
    latency: { kind: 'uniform', min_ms: 50, max_ms: 500 },
    slippage: { kind: 'book_walk' },
    impact: {
      kind: 'none',
      declaration: 'no endogenous market impact (fixture)',
      limitation: 'endogenous reaction is T027 territory; the fixture composes the engine as-is',
    },
  };
}

/** The fixture book seed: tick/lot-aligned two-sided book around 100. */
export function fixtureBookSeed(): Record<string, unknown> {
  return {
    bids: [
      { price: '100.00', size: '5.000' },
      { price: '99.50', size: '3.000' },
    ],
    asks: [
      { price: '100.50', size: '4.000' },
      { price: '101.00', size: '6.000' },
    ],
  };
}

/** The fixture episode spec: binds to the exchange world derived from the config. */
export function fixtureSpec(overrides: Partial<ExchangeFixtureOptions> = {}): Record<string, unknown> {
  const options = resolve(overrides);
  const config = fixtureExchangeConfig(options);
  const hash = configHashOf(config);
  return {
    profile: {
      environment_id: `env-exchange-fixture-${options.seed}`,
      fidelity: 'reactive_replay',
      clock: {
        now: T0,
        asOf: T0 + options.horizonMs,
        playbackSpeed: 1,
        paused: false,
        fidelity: 'reactive_replay',
        informationPolicy: 'point-in-time',
      },
      seed: options.seed,
      venue_scope: ['BINANCE'],
      instrument_scope: ['BTC-USDT'],
      latency_policy: `latency:${hash}`,
      fee_policy: `fees:${hash}`,
    },
    world: { world_id: `world-exchange-${hash}`, kind: 'exchange-sim' },
    information_policy: 'point-in-time',
  };
}

function configHashOf(config: Record<string, unknown>): string {
  // Validated through the service constructor's own validation path; a
  // direct hash requires the canonical form, which the service exposes.
  const probe = createExchangeService(config, fixtureBookSeed());
  if (!probe.ok) throw new Error(`fixture config invalid: ${JSON.stringify(probe.errors)}`);
  return probe.value.config_hash;
}

function resolve(overrides: Partial<ExchangeFixtureOptions>): ExchangeFixtureOptions {
  return { seed: overrides.seed ?? DEFAULTS.seed, horizonMs: overrides.horizonMs ?? DEFAULTS.horizonMs };
}

// ---------------------------------------------------------------------------
// The scripted order flow
// ---------------------------------------------------------------------------

/** One scripted step: an action at an instant, or a clock advance. */
export type FixtureStep =
  | { readonly kind: 'action'; readonly at: number; readonly action: Record<string, unknown> }
  | { readonly kind: 'advance'; readonly to: number };

/** The scripted order-flow fixture: the full path space in one deterministic scenario. */
export function fixtureScript(): readonly FixtureStep[] {
  const intent = (clientOrderId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => {
    const built: Record<string, unknown> = {
      clientOrderId,
      instrumentId: 'BTC-USDT',
      venueId: 'BINANCE',
      side: 'buy',
      kind: 'limit',
      quantity: '3',
      price: '100.50',
      timeInForce: 'gtc',
      createdAt: '2026-01-01T00:00:00Z',
      ...overrides,
    };
    // The action payload must be a JSON value: undefined fields (e.g. a
    // market order's absent price — the presence matrix) are dropped.
    for (const key of Object.keys(built)) {
      if (built[key] === undefined) delete built[key];
    }
    return built;
  };
  const action = (id: string, sequence: number, payload: Record<string, unknown>, at: number): Record<string, unknown> => ({
    action_id: `act-${id}`,
    actor: 'agent-fixture',
    submitted_at: at,
    client_sequence: sequence,
    payload,
  });

  return [
    // 1. A crossing buy: fills against the 100.50 ask, remainder rests.
    { kind: 'action', at: T0 + 10, action: action('cross', 1, { type: 'submit_order', intent: intent('fx-cross', { quantity: '5' }) }, T0 + 10) },
    // 2. An IOC buy: fills what the book offers at its limit, cancels the rest.
    { kind: 'action', at: T0 + 25, action: action('ioc', 2, { type: 'submit_order', intent: intent('fx-ioc', { quantity: '4', timeInForce: 'ioc' }) }, T0 + 25) },
    // 3. A resting sell (new level on the ask side).
    { kind: 'action', at: T0 + 40, action: action('rest', 3, { type: 'submit_order', intent: intent('fx-rest', { side: 'sell', price: '101.50', quantity: '2' }) }, T0 + 40) },
    // 4. A market sell: sweeps the bid side.
    { kind: 'action', at: T0 + 60, action: action('sweep', 4, { type: 'submit_order', intent: intent('fx-sweep', { side: 'sell', kind: 'market', price: undefined, quantity: '4' }) }, T0 + 60) },
    // 5. A FOK buy that cannot fill (availability < quantity): dies whole.
    { kind: 'action', at: T0 + 75, action: action('fok', 5, { type: 'submit_order', intent: intent('fx-fok', { quantity: '50', timeInForce: 'fok' }) }, T0 + 75) },
    // 6. A rejected intent (off-tick price): a typed outcome on the stream.
    { kind: 'action', at: T0 + 90, action: action('offtick', 6, { type: 'submit_order', intent: intent('fx-offtick', { price: '100.505' }) }, T0 + 90) },
    // 7. A gtt sell that will expire at the advance below.
    { kind: 'action', at: T0 + 100, action: action('gtt', 7, { type: 'submit_order', intent: intent('fx-gtt', { side: 'sell', price: '101.50', quantity: '1', timeInForce: 'gtt', expiresAt: isoAt(60_000) }) }, T0 + 100) },
    // 8. Cancel the resting sell by client id.
    { kind: 'action', at: T0 + 120, action: action('cancel', 8, { type: 'cancel_client_order', client_order_id: 'fx-rest' }, T0 + 120) },
    // 9. Advance past the gtt expiry.
    { kind: 'advance', to: T0 + 90_000 },
  ];
}

function isoAt(ms: number): string {
  return new Date(T0 + ms).toISOString();
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/** The products of one fixture run. */
export interface ExchangeFixtureRun {
  readonly service: ExchangeService;
  readonly episodeId: string;
  readonly record: SessionRecord;
  readonly events: readonly ExchangeEvent[];
  /** Canonical JSON of the whole outcome stream (byte-identity comparator). */
  readonly outcomeStreamJson: string;
}

/** Unwrap helper for fixture plumbing. */
function unwrap<T>(result: ServiceResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`fixture step failed: ${JSON.stringify(result.errors)}`);
}

/**
 * Run the fixture scenario once: create the service, start the episode,
 * drive the scripted flow, finish, and collect the lineage record plus
 * the canonical outcome stream. Deterministic: identical options ->
 * byte-identical `outcomeStreamJson` and identical `record.digest`.
 */
export function runExchangeFixture(overrides: Partial<ExchangeFixtureOptions> = {}): ExchangeFixtureRun {
  const options = resolve(overrides);
  const service = unwrap(createExchangeService(fixtureExchangeConfig(options), fixtureBookSeed()));
  const started = unwrap(service.start(fixtureSpec(options)));
  const episodeId = (started as ExchangeEpisodeView).episode_id;

  let clockNow = T0;
  for (const step of fixtureScript()) {
    if (step.kind === 'advance') {
      unwrap(service.advance(episodeId, (step.to) as TimestampMs));
      clockNow = step.to;
    } else {
      // The causal law: an action may not claim submission after `now` (and
      // the engine matches in arrival order) — advance the clock to the
      // step's instant before submitting (a no-op when already there).
      if (step.at > clockNow) {
        unwrap(service.advance(episodeId, (step.at) as TimestampMs));
        clockNow = step.at;
      }
      unwrap(service.submit(episodeId, step.action));
    }
  }
  // Advance to the horizon so every latency window elapses (all outcomes
  // become observable), then finish and record.
  unwrap(service.advance(episodeId, (T0 + options.horizonMs - 1_000) as TimestampMs));
  unwrap(service.finish(episodeId, { code: 'completed', detail: 'fixture scenario complete' }));
  void clockNow;

  const record = unwrap(service.sessionRecord(episodeId));
  const events = unwrap(service.events(episodeId));
  const outcomeStreamJson = canonicalJson(events.map((event) => event as unknown as JsonValue) as JsonValue);
  return { service, episodeId, record, events, outcomeStreamJson };
}
