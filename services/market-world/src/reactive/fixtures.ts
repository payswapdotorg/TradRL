/**
 * @tradrl/market-world (reactive service) — deterministic fixture scenarios
 * (work order T027): a scripted recorded stream (the T009 fixture
 * discipline), scripted participant action feeds, physics configs, and the
 * GOLDEN WORLD EVOLUTION runner.
 *
 * DETERMINISM (L9 — the acceptance law): "same (recorded stream, seed,
 * participant action script, physics configs, clock config) ->
 * byte-identical world evolution: engine state, fills, observations
 * (deep-equal, twice)". Every fixture value derives from the seed (the
 * seeded xorshift32 discipline) or is hand-scripted at fixed offsets from
 * T0; the runner drives the world through a FIXED driver script. Two runs
 * of {@link runReactiveFixture} produce byte-identical canonical evolution
 * JSON and identical run-record digests — proven in fixtures.test.ts, with
 * the REAL exchange-sim engine bound through the injected driver port.
 *
 * THE PROVENANCE DISCIPLINE (T009): fixture stream events DECLARE
 * recorded-historical provenance explicitly (`origin: 'historical'`,
 * adapter `{ id: 'reactive-fixture-adapter', version: '1.0.0' }`). The
 * world cannot (and need not) distinguish a fixture from a vendor feed —
 * the discipline is that the fixture generator only emits records that
 * claim, honestly within the laboratory, "this is the recorded history".
 *
 * THE SCENARIO deliberately exercises the full path space: a seed snapshot
 * from history, an embargoed trade, a same-instant stream/action collision
 * (the interleaving contrast instant T0+30_000), a crossing fill with a
 * resting remainder, a market sweep, a gtt expiry, a requested cancel, and
 * a candidate order — so the byte-identity claim covers every outcome kind
 * the engine emits and both observation origins (historical + simulated).
 */

import { canonicalJson, createSeededRandom, deepFreeze } from './primitives';
import type { JsonValue } from './primitives';
import type { TimestampMs } from './ids';
import type { EngineDriver, EngineStateMirror } from './exchange-mirror';
import { physicsHash, validateExchangePhysics } from './exchange-mirror';
import type { ParticipantActionFeed } from './action-feed';
import { createScriptedActionFeed } from './action-feed';
import type { InterleavingPolicy, ReactiveWorldConfig } from './config';
import { configHash, validateReactiveWorldConfig } from './config';
import type { ReactiveFillRecord, ReactiveObservation, ReactiveRunRecord, ReactiveRunState } from './records';
import type { ReactiveWorldInputs, ReactiveWorldService } from './service';
import { createReactiveWorldService, resumeReactiveWorldService } from './service';
import type { RecordedEventSource } from './stream';
import { asRecordedEventSource } from './stream';

const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// Fixture options
// ---------------------------------------------------------------------------

/** Fixture options: everything derives from the seed and these knobs. */
export interface ReactiveFixtureOptions {
  /** The deterministic seed (stream, physics draws, ids). Default 'reactive-fixture-alpha'. */
  readonly seed: string;
  /** The episode's asOf anchor (ms after T0). Default 100_000. */
  readonly horizonMs: number;
  /** The declared interleaving policy (the ordering law under test). Default 'stream_first'. */
  readonly interleaving: 'stream_first' | 'actions_first' | 'unrestricted';
  /** Stop the driver script after N steps (resume tests); null = full run. Default null. */
  readonly stopAfterDriverStep: number | null;
}

const DEFAULTS: ReactiveFixtureOptions = { seed: 'reactive-fixture-alpha', horizonMs: 100_000, interleaving: 'stream_first', stopAfterDriverStep: null };

/** Resolve options against defaults (explicit fields win). */
export function fixtureOptions(overrides: Partial<ReactiveFixtureOptions> = {}): ReactiveFixtureOptions {
  return {
    seed: overrides.seed ?? DEFAULTS.seed,
    horizonMs: overrides.horizonMs ?? DEFAULTS.horizonMs,
    interleaving: overrides.interleaving ?? DEFAULTS.interleaving,
    stopAfterDriverStep: overrides.stopAfterDriverStep ?? DEFAULTS.stopAfterDriverStep,
  };
}

// ---------------------------------------------------------------------------
// The physics configuration (grid-aligned with the fixture stream)
// ---------------------------------------------------------------------------

/** The fixture exchange physics: seeded uniform latency + book_walk slippage + a two-tier fee schedule. */
export function fixturePhysics(): Record<string, unknown> {
  return {
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    tick_size: '0.01',
    lot_size: '0.001',
    max_book_depth: 10,
    seed: 'reactive-fixture-alpha',
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
      declaration: 'no endogenous impact beyond the book walk (fixture) — the engine matches the visible book only',
      limitation: 'endogenous reaction around the engine is composed by T027 policies; the fixture declares the engine as-is',
    },
  };
}

/** The fixture physics lineage refs (versioned policy refs bound into every fill). */
export function fixturePhysicsRefs(): Record<string, string> {
  const validated = validateExchangePhysics(fixturePhysics());
  if (!validated.ok) throw new Error(`fixture physics invalid: ${JSON.stringify(validated.errors)}`);
  const hash = physicsHash(validated.value);
  return {
    fee_policy: `fees:${hash}`,
    latency_policy: `latency:${hash}`,
    slippage_policy: `slippage:${hash}`,
    impact_policy: `impact:${hash}`,
  };
}

// ---------------------------------------------------------------------------
// The scripted recorded stream (the T009 fixture discipline)
// ---------------------------------------------------------------------------

/** The fixture provenance block — the explicit recorded-historical declaration. */
export const FIXTURE_ADAPTER = { id: 'reactive-fixture-adapter', version: '1.0.0' } as const;

/**
 * The full deterministic recorded history of the fixture stream, as
 * UNTRUSTED records (the world validates them through its own guards).
 * Hand-scripted at fixed offsets with seeded sizes, so the same options
 * always generate the byte-identical stream — including the collision
 * instant T0+30_000 (a quote becoming available exactly when the
 * adversary's market sell fires — the interleaving contrast anchor) and
 * two embargoed records (availability after event_time).
 */
export function fixtureRecordedBatches(): readonly (readonly Record<string, unknown>[])[] {
  const random = createSeededRandom('reactive-fixture-alpha/stream');
  const size = (scale: number): string => (0.001 + Math.floor(random() * scale * 1000) / 1000).toFixed(3);
  const historical = (derivedFrom: readonly string[] = [], transform: string | null = null): Record<string, unknown> => ({
    origin: 'historical',
    adapter: { ...FIXTURE_ADAPTER },
    derived_from: derivedFrom,
    transform,
  });

  const first: Record<string, unknown>[] = [
    // 1. The seed snapshot: available AT T0 (the engine seeds from it).
    {
      event_id: 'rf-000001',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      event_type: 'book_snapshot',
      event_time: T0,
      source_time: T0,
      available_time: T0,
      ingestion_time: T0,
      sequence: 1,
      provider: 'reactive-fixtures',
      provenance: historical(),
      payload: {
        bids: [
          { price: '100.00', size: '5.000' },
          { price: '99.50', size: '3.000' },
        ],
        asks: [
          { price: '100.50', size: '4.000' },
          { price: '101.00', size: '6.000' },
        ],
      },
    },
    // 2. A top-of-book quote at T0+20_000.
    {
      event_id: 'rf-000002',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      event_type: 'quote',
      event_time: T0 + 20_000,
      source_time: T0 + 20_000,
      available_time: T0 + 20_000,
      ingestion_time: T0 + 20_000,
      sequence: 1,
      provider: 'reactive-fixtures',
      provenance: historical(),
      payload: { bid_price: '100.00', bid_size: size(2), ask_price: '100.50', ask_size: size(2) },
    },
    // 3. An EMBARGOED trade: available 40ms after event_time.
    {
      event_id: 'rf-000003',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      event_type: 'trade',
      event_time: T0 + 25_000,
      source_time: T0 + 25_000,
      available_time: T0 + 25_040,
      ingestion_time: T0 + 25_010,
      sequence: 1,
      provider: 'reactive-fixtures',
      provenance: historical(),
      payload: { price: '100.50', size: size(1), side: 'buy' },
    },
  ];

  const second: Record<string, unknown>[] = [
    // 4. THE COLLISION INSTANT: a quote becoming available exactly at
    //    T0+30_000 — the same instant the adversary's market sell fires
    //    (the interleaving contrast anchor).
    {
      event_id: 'rf-000004',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      event_type: 'quote',
      event_time: T0 + 30_000,
      source_time: T0 + 30_000,
      available_time: T0 + 30_000,
      ingestion_time: T0 + 30_000,
      sequence: 2,
      provider: 'reactive-fixtures',
      provenance: historical(),
      payload: { bid_price: '100.00', bid_size: size(2), ask_price: '101.00', ask_size: size(2) },
    },
    // 5. An EMBARGOED trade: available 500ms after event_time.
    {
      event_id: 'rf-000005',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      event_type: 'trade',
      event_time: T0 + 40_000,
      source_time: T0 + 40_000,
      available_time: T0 + 40_500,
      ingestion_time: T0 + 40_020,
      sequence: 2,
      provider: 'reactive-fixtures',
      provenance: historical(),
      payload: { price: '100.00', size: size(1), side: 'sell' },
    },
    // 6. A recorded mid-stream snapshot (observable history; the engine
    //    seed is chosen at episode start only — documented).
    {
      event_id: 'rf-000006',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      event_type: 'book_snapshot',
      event_time: T0 + 50_000,
      source_time: T0 + 50_000,
      available_time: T0 + 50_000,
      ingestion_time: T0 + 50_000,
      sequence: 2,
      provider: 'reactive-fixtures',
      provenance: historical(),
      payload: {
        bids: [
          { price: '99.50', size: '2.000' },
          { price: '99.00', size: '1.500' },
        ],
        asks: [
          { price: '101.50', size: '3.000' },
          { price: '102.00', size: '4.500' },
        ],
      },
    },
  ];

  const third: Record<string, unknown>[] = [
    // 7. A late quote near the horizon.
    {
      event_id: 'rf-000007',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      event_type: 'quote',
      event_time: T0 + 80_000,
      source_time: T0 + 80_000,
      available_time: T0 + 80_000,
      ingestion_time: T0 + 80_000,
      sequence: 3,
      provider: 'reactive-fixtures',
      provenance: historical(),
      payload: { bid_price: '99.50', bid_size: size(2), ask_price: '101.50', ask_size: size(2) },
    },
    // 8. A derived vwap aggregate over the trades (historical origin,
    //    explicit lineage + transform — derived observations obey the same
    //    L4 boundary as primitive ones).
    {
      event_id: 'rf-vwap-000',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      event_type: 'other',
      event_time: T0 + 55_000,
      source_time: null,
      available_time: T0 + 55_001,
      ingestion_time: T0 + 55_002,
      sequence: 1,
      provider: 'reactive-fixtures',
      provenance: historical(['rf-000003', 'rf-000005'], 'fixture-vwap-1m'),
      payload: { kind: 'vwap_1m', data: { window_ms: 60_000, over_trades: 2 } },
    },
  ];

  return [first, second, third];
}

/** A fresh recorded event source over the fixture stream (call again for a second, identical source). */
export function createFixtureEventSource(): RecordedEventSource {
  return asRecordedEventSource(fixtureRecordedBatches().map((batch) => [...batch]));
}

// ---------------------------------------------------------------------------
// The roster + the scripted action feeds
// ---------------------------------------------------------------------------

/** The fixture roster: one candidate (driver-driven), one adversary, one co-participant. */
export function fixtureParticipants(): readonly Record<string, unknown>[] {
  return [
    { instance: 'agent-candidate-alpha', role: 'candidate', feed: null },
    { instance: 'agent-adversary-beta', role: 'adversary', feed: 'feed-adversary-beta' },
    { instance: 'agent-maker-gamma', role: 'co_participant', feed: 'feed-maker-gamma' },
  ];
}

/** The order-intent builder (the domain-core Order mirror vocabulary). */
function intent(clientOrderId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
  // The action payload must be a JSON value: undefined fields (the
  // presence matrix) are dropped.
  for (const key of Object.keys(built)) {
    if (built[key] === undefined) delete built[key];
  }
  return built;
}

/** One scripted action envelope for participant `actor` at `at` (sequence `seq`, payload `payload`). */
function scripted(actor: string, seq: number, at: number, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    at,
    action: {
      action_id: `fx-${actor}-${String(seq).padStart(2, '0')}`,
      actor,
      submitted_at: at,
      client_sequence: seq,
      payload,
    },
  };
}

/** The adversary's script: a crossing fill with a resting remainder, then the collision-instant market sweep. */
export function fixtureAdversaryScript(): readonly Record<string, unknown>[] {
  return [
    // T0+10_000: buy 5 @ 100.50 limit — fills 4 against the seeded ask,
    // remainder 1 rests (the book MOVES: the reactive difference).
    scripted('agent-adversary-beta', 1, T0 + 10_000, { type: 'submit_order', intent: intent('fx-adv-cross', { quantity: '5' }) }),
    // T0+30_000 — THE COLLISION INSTANT: market sell 2, sweeping the bids.
    scripted('agent-adversary-beta', 2, T0 + 30_000, { type: 'submit_order', intent: intent('fx-adv-sweep', { side: 'sell', kind: 'market', price: undefined, quantity: '2' }) }),
  ];
}

/** The co-participant's script: a resting sell, a gtt buy that expires, and a requested cancel. */
export function fixtureMakerScript(): readonly Record<string, unknown>[] {
  return [
    // T0+15_000: rest a sell at a new level.
    scripted('agent-maker-gamma', 1, T0 + 15_000, { type: 'submit_order', intent: intent('fx-mkr-rest', { side: 'sell', price: '101.50', quantity: '2' }) }),
    // T0+20_000: a gtt buy far from the market, expiring at T0+70_000.
    scripted('agent-maker-gamma', 2, T0 + 20_000, { type: 'submit_order', intent: intent('fx-mkr-gtt', { side: 'buy', price: '99.00', quantity: '1', timeInForce: 'gtt', expiresAt: new Date(T0 + 70_000).toISOString() }) }),
    // T0+45_000: cancel the resting sell by client id.
    scripted('agent-maker-gamma', 3, T0 + 45_000, { type: 'cancel_client_order', client_order_id: 'fx-mkr-rest' }),
  ];
}

/** Build the fixture feeds (fresh cursors — call again for resume's fresh bindings). */
export function createFixtureFeeds(): readonly { readonly ref: string; readonly feed: ParticipantActionFeed }[] {
  const adversary = createScriptedActionFeed('agent-adversary-beta' as never, fixtureAdversaryScript());
  if (!adversary.ok) throw new Error(`fixture adversary feed invalid: ${JSON.stringify(adversary.errors)}`);
  const maker = createScriptedActionFeed('agent-maker-gamma' as never, fixtureMakerScript());
  if (!maker.ok) throw new Error(`fixture maker feed invalid: ${JSON.stringify(maker.errors)}`);
  return [
    { ref: 'feed-adversary-beta', feed: adversary.value },
    { ref: 'feed-maker-gamma', feed: maker.value },
  ];
}

// ---------------------------------------------------------------------------
// The driver script (the candidate's actions — part of the deterministic function)
// ---------------------------------------------------------------------------

/** One driver step: settle the world at an instant, then (maybe) submit the candidate's action. */
export type FixtureDriverStep =
  | { readonly kind: 'settle'; readonly to: number }
  | { readonly kind: 'action'; readonly at: number; readonly action: Record<string, unknown> };

/** The candidate's driving script: two orders (a crossing buy, then a sell into the moved book). */
export function fixtureDriverScript(): readonly FixtureDriverStep[] {
  return [
    // T0+25_000: settle, then a crossing candidate buy at the best ask.
    { kind: 'action', at: T0 + 25_000, action: { action_id: 'fx-cand-01', actor: 'agent-candidate-alpha', submitted_at: T0 + 25_000, client_sequence: 1, payload: { type: 'submit_order', intent: intent('fx-cand-cross', { price: '101.00', quantity: '2' }) } } },
    // T0+35_000: settle through the collision instant and the embargo window.
    { kind: 'settle', to: T0 + 35_000 },
    // T0+60_000: settle, then a candidate sell into the moved book.
    { kind: 'action', at: T0 + 60_000, action: { action_id: 'fx-cand-02', actor: 'agent-candidate-alpha', submitted_at: T0 + 60_000, client_sequence: 2, payload: { type: 'submit_order', intent: intent('fx-cand-sell', { side: 'sell', price: '100.00', quantity: '1.5' }) } } },
  ];
}

// ---------------------------------------------------------------------------
// The world config + the episode spec
// ---------------------------------------------------------------------------

/** A world config that matches the fixture stream and roster. */
export function fixtureWorldConfig(overrides: Partial<ReactiveFixtureOptions> = {}): Record<string, unknown> {
  const options = fixtureOptions(overrides);
  const physics = fixturePhysics();
  const physicsResult = validateExchangePhysics(physics);
  if (!physicsResult.ok) throw new Error(`fixture physics invalid: ${JSON.stringify(physicsResult.errors)}`);
  const hash = physicsHash(physicsResult.value);
  return {
    world_id: `world-reactive-fixture-${options.seed}`,
    mode: 'reactive_replay',
    information_policy: 'point-in-time',
    tenant: 'tenant-fixture-alpha',
    project: 'project-fixture-alpha',
    seed: options.seed,
    as_of: T0 + 120_000,
    streams: [{ venue: 'BINANCE', instrument: 'BTC-USDT' }],
    exchange: physics,
    physics_refs: {
      fee_policy: `fees:${hash}`,
      latency_policy: `latency:${hash}`,
      slippage_policy: `slippage:${hash}`,
      impact_policy: `impact:${hash}`,
    },
    participants: fixtureParticipants(),
    interleaving: { kind: options.interleaving },
    playback_speed: 1,
  };
}

/** The fixture episode spec: binds to the fixture world, clock anchored at the stream start. */
export function fixtureSpec(overrides: Partial<ReactiveFixtureOptions> = {}): Record<string, unknown> {
  const options = fixtureOptions(overrides);
  const config = fixtureWorldConfig(options);
  const physicsResult = validateExchangePhysics(fixturePhysics());
  if (!physicsResult.ok) throw new Error('fixture physics invalid (impossible)');
  const hash = physicsHash(physicsResult.value);
  return {
    profile: {
      environment_id: `env-reactive-fixture-${options.seed}`,
      fidelity: 'reactive_replay',
      clock: { now: T0, asOf: T0 + options.horizonMs, playbackSpeed: 1, paused: false, fidelity: 'reactive_replay', informationPolicy: 'point-in-time' },
      seed: options.seed,
      venue_scope: ['BINANCE'],
      instrument_scope: ['BTC-USDT'],
      latency_policy: `latency:${hash}`,
      fee_policy: `fees:${hash}`,
    },
    world: { world_id: config.world_id, kind: 'reactive' },
    information_policy: 'point-in-time',
  };
}

// ---------------------------------------------------------------------------
// The runner (the golden world evolution)
// ---------------------------------------------------------------------------

/** The products of one fixture run. */
export interface ReactiveFixtureRun {
  readonly service: ReactiveWorldService;
  readonly episodeId: string;
  /** The L9 run record (null when the run stopped mid-script for resume tests). */
  readonly record: ReactiveRunRecord | null;
  readonly engineState: EngineStateMirror;
  readonly fills: readonly ReactiveFillRecord[];
  readonly observations: readonly ReactiveObservation[];
  /** Canonical JSON of the whole evolution (the byte-identity comparator). */
  readonly evolutionJson: string;
  /** The exported run state when the run stopped mid-script (resume tests); null on a full run. */
  readonly exportedState: ReactiveRunState | null;
}

/** Unwrap helper for fixture plumbing (a fixture step failing is a fixture bug, not a test outcome). */
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture step failed: ${JSON.stringify(result.errors)}`);
}

/** Build fresh fixture inputs over the given engine driver (source + feeds are fresh cursors). */
export function createFixtureInputs(engine: EngineDriver): ReactiveWorldInputs {
  return { source: createFixtureEventSource(), engine, feeds: createFixtureFeeds() };
}

/**
 * Run the fixture scenario once: create the service (with the INJECTED
 * engine driver), load the stream, start the episode, drive the scripted
 * flow (settle-then-act per driver step; the step machine processes one
 * boundary per advance), optionally stop mid-script (resume tests), finish
 * (full runs), and collect the lineage record plus the canonical
 * evolution. Deterministic: identical options + engine -> byte-identical
 * `evolutionJson` and identical `record.digest`.
 */
export async function runReactiveFixture(engine: EngineDriver, overrides: Partial<ReactiveFixtureOptions> = {}): Promise<ReactiveFixtureRun> {
  const options = fixtureOptions(overrides);
  const inputs: ReactiveWorldInputs = { source: createFixtureEventSource(), engine, feeds: createFixtureFeeds() };
  const service = unwrap(createReactiveWorldService(fixtureWorldConfig(options), inputs));
  unwrap(await service.loadAll());

  const started = unwrap(service.start(fixtureSpec(options)));
  const episodeId = started.episode_id;

  const script = fixtureDriverScript();
  const stopAfter = options.stopAfterDriverStep;
  const limit = stopAfter === null ? script.length : Math.min(stopAfter, script.length);
  let stopped = false;

  for (let index = 0; index < limit; index++) {
    const step = script[index];
    if (step === undefined) break;
    if (step.kind === 'settle') {
      settleAt(service, episodeId, step.to as TimestampMs);
    } else {
      settleAt(service, episodeId, step.at as TimestampMs);
      unwrap(service.submit(episodeId, step.action));
    }
  }
  if (stopAfter !== null && limit < script.length) {
    stopped = true;
  }

  if (stopped) {
    const exported = unwrap(service.exportRunState(episodeId));
    const evolutionJson = evolutionJsonOf(service, episodeId, null, started.clock.now);
    return { service, episodeId, record: null, engineState: unwrap(service.engineState(episodeId)), fills: unwrap(service.fills(episodeId)), observations: unwrap(service.observe(episodeId, started.clock.now)), evolutionJson, exportedState: exported };
  }

  // Absorb the whole window (every latency window elapses; every boundary
  // processes), then finish and record.
  const horizon = (T0 + options.horizonMs - 1_000) as TimestampMs;
  settleAt(service, episodeId, horizon);
  unwrap(service.finish(episodeId, { code: 'completed', detail: 'fixture scenario complete' }));
  const record = unwrap(service.runRecord(episodeId));
  const evolutionJson = evolutionJsonOf(service, episodeId, record, horizon);
  return { service, episodeId, record, engineState: unwrap(service.engineState(episodeId)), fills: unwrap(service.fills(episodeId)), observations: unwrap(service.observe(episodeId, horizon)), evolutionJson, exportedState: null };
}

/** Advance (one boundary per call) until the world is settled at `to` (the full-catch-up loop). */
function settleAt(service: ReactiveWorldService, episodeId: string, to: TimestampMs): void {
  for (let iteration = 0; iteration < 10_000; iteration++) {
    const view = unwrap(service.advance(episodeId, to));
    if (view.settled) return;
  }
  throw new Error('fixture settle loop did not converge (infinite catch-up is impossible by construction)');
}

/** The canonical evolution JSON: engine state + fills + observations (+ record) — the byte-identity comparator. */
function evolutionJsonOf(service: ReactiveWorldService, episodeId: string, record: ReactiveRunRecord | null, at: TimestampMs): string {
  const engineState = unwrap(service.engineState(episodeId));
  const fills = unwrap(service.fills(episodeId));
  const observations = unwrap(service.observe(episodeId, at));
  const tree: JsonValue = {
    engine_state: engineState as unknown as JsonValue,
    fills: fills as unknown as JsonValue,
    observations: observations as unknown as JsonValue,
    record: record === null ? null : (record as unknown as JsonValue),
  };
  return canonicalJson(tree);
}

/**
 * Resume a stopped fixture run and drive the REMAINING script: the fresh
 * inputs are verified against the exported state (chain + feeds), then the
 * rest of the driver script runs, the episode finishes, and the run record
 * is collected. A resumed run finishes with the IDENTICAL record as an
 * uninterrupted run — proven in fixtures.test.ts.
 */
export async function resumeReactiveFixture(
  engine: EngineDriver,
  exported: ReactiveRunState,
  overrides: Partial<ReactiveFixtureOptions> = {},
): Promise<ReactiveFixtureRun> {
  const options = fixtureOptions(overrides);
  const inputs: ReactiveWorldInputs = { source: createFixtureEventSource(), engine, feeds: createFixtureFeeds() };
  const resumed = await resumeReactiveWorldService(exported, inputs);
  const service = unwrap(resumed);
  const episodeId = service.episodes[0];
  if (episodeId === undefined) throw new Error('resumed service carries no episode');

  const script = fixtureDriverScript();
  const stopAfter = options.stopAfterDriverStep;
  const from = stopAfter === null ? 0 : stopAfter;
  for (let index = from; index < script.length; index++) {
    const step = script[index];
    if (step === undefined) break;
    if (step.kind === 'settle') {
      settleAt(service, episodeId, step.to as TimestampMs);
    } else {
      settleAt(service, episodeId, step.at as TimestampMs);
      unwrap(service.submit(episodeId, step.action));
    }
  }
  const horizon = (T0 + options.horizonMs - 1_000) as TimestampMs;
  settleAt(service, episodeId, horizon);
  unwrap(service.finish(episodeId, { code: 'completed', detail: 'fixture scenario complete' }));
  const record = unwrap(service.runRecord(episodeId));
  const evolutionJson = evolutionJsonOf(service, episodeId, record, horizon);
  return { service, episodeId, record, engineState: unwrap(service.engineState(episodeId)), fills: unwrap(service.fills(episodeId)), observations: unwrap(service.observe(episodeId, horizon)), evolutionJson, exportedState: null };
}

/** The fixture config hash (deterministic; computed through the full config validator — no engine needed). */
export function fixtureConfigHash(overrides: Partial<ReactiveFixtureOptions> = {}): string {
  const validated = validateReactiveWorldConfig(fixtureWorldConfig(overrides));
  if (!validated.ok) throw new Error(`fixture config invalid: ${JSON.stringify(validated.errors)}`);
  return configHash(validated.value);
}

/** Re-export for consumers (the interleaving policy literal of the fixture). */
export type { InterleavingPolicy, ReactiveWorldConfig };
