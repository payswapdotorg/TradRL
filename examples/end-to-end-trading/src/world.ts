// @tradrl/example-e2e-trading — THE REACTIVE MARKET WORLD (T027 pattern).
//
// A synchronous reactive-replay world: a recorded event history (the
// scenario's market stream) is settled forward under point-in-time
// availability (L4 — an event is visible iff `available_time <= now`,
// INCLUSIVE), while participant actions are matched by the INJECTED
// engine driver (the T027 seam — `EngineDriverMirror`). The world never
// fabricates fills itself: every fill carries the engine's physics
// lineage; every observation carries the source record verbatim.
//
// Mode honesty (L5): the config's mode is the LITERAL 'reactive_replay'
// — anything else is a typed `fidelity_claim_dishonest` construction
// failure. This world is a simulation instrument, never historical truth.

import {
  canonicalJson, deepFreeze, fnv1a32Hex, isNonEmptyString, stableDigest8Json,
  type JsonValue,
} from './primitives';
import { add, divideRoundHalfUp } from './decimals';
import { fail, ok, type ExampleResult } from './errors';
import type {
  ActionReceiptMirror, EngineDriverMirror, EngineStateMirror, MarketEventMirror,
  ReactiveFillRecordMirror, ReactiveObservationMirror, WorldActionMirror,
  ExchangePhysicsMirror, PhysicsLineageMirror, TopOfBookMirror,
} from './mirrors/market';
import { topOfBook } from './engine';

/** The reactive world configuration (mirror of the T027 ReactiveWorldConfig). */
export interface ReactiveWorldConfig {
  readonly world_id: string;
  readonly mode: 'reactive_replay';
  readonly information_policy: 'point-in-time';
  readonly tenant: string;
  readonly project: string;
  readonly seed: string;
  readonly as_of: number;
  readonly streams: readonly { readonly venue: string; readonly instrument: string }[];
  readonly exchange: readonly {
    readonly venue: string;
    readonly instrument: string;
    readonly asset_class: string;
    readonly physics: ExchangePhysicsMirror;
    readonly bookSeed: { readonly bids: readonly { price: string; size: string }[]; readonly asks: readonly { price: string; size: string }[] };
  }[];
  readonly participants: readonly { readonly instance: string; readonly role: 'candidate' | 'adversary' | 'co_participant'; readonly feed: string | null }[];
  readonly interleaving: { readonly kind: 'stream_first' };
  readonly playback_speed: number;
}

/** The reactive world run record (mirror of the T027 ReactiveRunRecord digest discipline). */
export interface ReactiveRunRecordMirror {
  readonly schema: 'tradrl/example-reactive-run-record@1';
  readonly run_id: string;
  readonly world: {
    readonly world_id: string;
    readonly mode: 'reactive_replay';
    readonly config_hash: string;
    readonly engine_config_hash: string;
    readonly seed: string;
    readonly as_of: number;
    readonly streams: readonly { readonly venue: string; readonly instrument: string }[];
    readonly tenant: string;
    readonly project: string;
  };
  readonly episode: { readonly episode_id: string; readonly final_now: number };
  readonly ingestion: { readonly batches: number; readonly events: number; readonly chain_head: string };
  readonly engine: { readonly orders: number; readonly fills: number };
  readonly clock_timeline: readonly { readonly to: number; readonly settled: boolean }[];
  readonly fill_log: readonly ReactiveFillRecordMirror[];
  readonly receipt_log: readonly ActionReceiptMirror[];
  readonly digest: string;
}

export interface WorldSubmitOutcome {
  readonly world: ReactiveWorld;
  readonly receipt: ActionReceiptMirror;
  readonly fills: readonly ReactiveFillRecordMirror[];
}

/** The reactive world — a pure, deterministic value object. */
export interface ReactiveWorld {
  readonly config: ReactiveWorldConfig;
  readonly configHash: string;
  readonly engineConfigHash: string;
  readonly worldId: string;
  readonly runId: string;
  readonly episodeId: string;
  readonly now: number;
  readonly settled: boolean;
  readonly engines: ReadonlyMap<string, EngineStateMirror>;
  readonly observations: readonly ReactiveObservationMirror[];
  readonly fills: readonly ReactiveFillRecordMirror[];
  readonly receipts: readonly ActionReceiptMirror[];
  readonly ingestionChainHead: string;
  readonly clockTimeline: readonly { readonly to: number; readonly settled: boolean }[];
  readonly driver: EngineDriverMirror;
}

function streamKey(venue: string, instrument: string): string {
  return `${venue}|${instrument}`;
}

export function worldConfigHash(config: ReactiveWorldConfig): string {
  return stableDigest8Json(config as unknown as JsonValue);
}

export function engineConfigHash(config: ReactiveWorldConfig): string {
  return fnv1a32Hex(
    canonicalJson(
      config.exchange
        .map((entry) => ({
          stream: streamKey(entry.venue, entry.instrument),
          venue: entry.venue,
          instrument: entry.instrument,
          asset_class: entry.asset_class,
          tick_size: entry.physics.tick_size,
          lot_size: entry.physics.lot_size,
          max_book_depth: entry.physics.max_book_depth,
          seed: entry.physics.seed,
          fidelity: entry.physics.fidelity,
          fees: entry.physics.fees,
          latency: entry.physics.latency,
          slippage: entry.physics.slippage,
          impact: entry.physics.impact,
        }))
        .sort((a, b) => (a.stream < b.stream ? -1 : 1)) as unknown as JsonValue,
    ),
  );
}

/** Physics lineage shared by every fill (T027's PhysicsLineage). */
function physicsLineage(world: ReactiveWorld): PhysicsLineageMirror {
  return {
    engine_config_hash: world.engineConfigHash,
    fee_policy: 'fee-schedule/tiers@1',
    latency_policy: 'information-latency-only@1',
    slippage_policy: 'slippage/book-walk@1',
    impact_policy: 'none@1',
    run_ref: world.runId,
    tenant: world.config.tenant,
    project: world.config.project,
  };
}

/** Boots the reactive world (typed `fidelity_claim_dishonest` on mode lies). */
export function startReactiveWorld(
  config: unknown,
  driver: EngineDriverMirror,
  recordedEvents: readonly MarketEventMirror[],
): ExampleResult<ReactiveWorld> {
  if (
    !config ||
    typeof config !== 'object' ||
    (config as ReactiveWorldConfig).mode !== 'reactive_replay'
  ) {
    return fail(
      'invalid_state',
      'the reactive world requires mode "reactive_replay" — any other claim is typed dishonesty (L5)',
      'world.mode',
    );
  }
  const typed = config as ReactiveWorldConfig;
  if (typed.information_policy !== 'point-in-time') {
    return fail('invalid_state', 'information_policy must be "point-in-time" (L4)', 'world.information_policy');
  }
  const configHash = worldConfigHash(typed);
  const engineHash = engineConfigHash(typed);
  const engines = new Map<string, EngineStateMirror>();
  for (const entry of typed.exchange) {
    const created = driver.createEngine(
      {
        venue: entry.venue,
        instrument: entry.instrument,
        asset_class: entry.asset_class,
        tick_size: entry.physics.tick_size,
        lot_size: entry.physics.lot_size,
        max_book_depth: entry.physics.max_book_depth,
        seed: entry.physics.seed,
        fidelity: entry.physics.fidelity,
        fees: entry.physics.fees,
        latency: entry.physics.latency,
        slippage: entry.physics.slippage,
        impact: entry.physics.impact,
      },
      { book_seed: entry.bookSeed, start_at: typed.as_of },
    );
    if (!created.ok) {
      return fail('invalid_state', `engine for ${streamKey(entry.venue, entry.instrument)} rejected its config: ${created.errors.map((e) => e.message).join('; ')}`, 'world.exchange');
    }
    engines.set(streamKey(entry.venue, entry.instrument), created.value);
  }
  const runId = `run-${fnv1a32Hex(`${configHash}:lineage-genesis`)}`;
  const episodeId = `ep-${fnv1a32Hex(canonicalJson({ spec: 'example-e2e', world_id: typed.world_id, as_of: typed.as_of, seed: typed.seed } as JsonValue))}`;
  const world: ReactiveWorld = {
    config: deepFreeze(typed),
    configHash,
    engineConfigHash: engineHash,
    worldId: typed.world_id,
    runId,
    episodeId,
    now: typed.as_of,
    settled: false,
    engines,
    observations: [],
    fills: [],
    receipts: [],
    ingestionChainHead: 'ingestion-genesis',
    clockTimeline: [],
    driver,
  };
  // Settle the pre-episode history (events available at or before as_of).
  return settleWorld(world, recordedEvents, typed.as_of);
}

/**
 * Settles the world to `to`: admits every recorded event whose
 * available_time <= to (L4, inclusive) as an observation, then advances
 * every engine clock. Pure — returns a NEW world.
 */
export function settleWorld(
  world: ReactiveWorld,
  recordedEvents: readonly MarketEventMirror[],
  to: number,
): ExampleResult<ReactiveWorld> {
  if (to < world.now) {
    return fail('clock_not_monotonic', `settle target ${to} precedes world now ${world.now}`, 'world.now');
  }
  const observations: ReactiveObservationMirror[] = [];
  let chainHead = world.ingestionChainHead;
  let admitted = 0;
  for (const event of recordedEvents) {
    const alreadySeen = world.observations.some((seen) => seen.observation_id === event.event_id);
    if (alreadySeen) continue;
    if (event.available_time <= to) {
      observations.push({
        observation_id: event.event_id,
        available_time: event.available_time,
        venue: event.venue,
        instrument: event.instrument,
        payload: event as unknown as JsonValue,
        provenance: {
          origin: event.provenance.origin === 'historical' ? 'historical' : 'simulated',
          source: event.provider,
          derived_from: [],
        },
        run_ref: world.runId,
        tenant: world.config.tenant,
        project: world.config.project,
      });
      chainHead = fnv1a32Hex(`${chainHead}:${event.event_id}`);
      admitted += 1;
    }
  }
  observations.sort((a, b) =>
    a.available_time === b.available_time
      ? a.observation_id < b.observation_id
        ? -1
        : 1
      : a.available_time - b.available_time,
  );
  const engines = new Map(world.engines);
  for (const [key, engine] of engines) {
    const advanced = world.driver.advanceEngine(engine, to);
    if (!advanced.ok) {
      return fail('invalid_state', `engine ${key} refused to advance: ${advanced.errors.map((e) => e.message).join('; ')}`, 'world.engines');
    }
    engines.set(key, advanced.value.state);
  }
  const nextWorld: ReactiveWorld = {
    ...world,
    now: to,
    observations: [...world.observations, ...observations],
    ingestionChainHead: chainHead,
    engines,
    clockTimeline: [...world.clockTimeline, { to, settled: admitted > 0 || to === world.now }],
  };
  return ok(nextWorld);
}

/** Submits a participant action to the engines (the ONLY path to a fill). */
export function submitWorldAction(
  world: ReactiveWorld,
  action: WorldActionMirror,
  recordedEvents: readonly MarketEventMirror[],
): ExampleResult<WorldSubmitOutcome> {
  if (action.submitted_at < world.now) {
    return fail('clock_not_monotonic', `action ${action.action_id} predates world now ${world.now}`, 'action.submitted_at');
  }
  if (action.payload.type !== 'submit_order') {
    return fail('invalid_state', `the reference world only accepts submit_order actions (got "${action.payload.type}")`, 'action.payload.type');
  }
  const intent = action.payload.intent;
  const key = streamKey(intent.venueId, intent.instrumentId);
  const engine = world.engines.get(key);
  if (!engine) {
    return fail('invalid_state', `stream ${key} is not part of this world`, 'action.payload.intent');
  }
  // Settle the world to the action instant first (stream_first interleaving).
  const settled = settleWorld(world, recordedEvents, action.submitted_at);
  if (!settled.ok) return settled;
  const working = settled.value;
  const submitted = working.driver.submitOrder(engine, intent, action.submitted_at);
  if (!submitted.ok) {
    return fail('invalid_state', `engine rejected order: ${submitted.errors.map((e) => `${e.code} ${e.message}`).join('; ')}`, 'action');
  }
  const physics = physicsLineage(working);
  const newFills: ReactiveFillRecordMirror[] = submitted.value.fills.map((fill) => ({
    fill,
    fill_id: fill.fill_id,
    episode_id: working.episodeId,
    run_ref: working.runId,
    taker_participant: action.actor,
    taker_order_id: fill.taker_order_id,
    maker_order_id: fill.maker_order_id,
    physics,
  }));
  const receipt: ActionReceiptMirror = {
    receipt_id: `intent:${working.episodeId}:${action.action_id}`,
    episode_id: working.episodeId,
    action_id: action.action_id,
    actor: action.actor,
    client_sequence: action.client_sequence,
    recorded_at: action.submitted_at,
    disposition: 'engine_matched',
    engine: {
      kind: 'ack' in submitted.value.ack ? 'ack' : 'reject',
      order_id: submitted.value.ack.order_id,
      status: 'status' in submitted.value.ack ? submitted.value.ack.status : 'rejected',
      reject_reason: 'reason' in submitted.value.ack ? submitted.value.ack.reason : null,
      fill_ids: submitted.value.fills.map((fill) => fill.fill_id),
    },
    physics,
  };
  const engines = new Map(working.engines);
  engines.set(key, submitted.value.state);
  const nextWorld: ReactiveWorld = {
    ...working,
    engines,
    fills: [...working.fills, ...newFills],
    receipts: [...working.receipts, receipt],
  };
  return ok({ world: nextWorld, receipt, fills: newFills });
}

/** The fills whose existence the account can know at `at` (L4 inclusive). */
export function visibleFillsAt(world: ReactiveWorld, at: number): readonly ReactiveFillRecordMirror[] {
  return world.fills.filter((fill) => fill.fill.quartet.available_time <= at);
}

/** The point-in-time mark of an instrument: last trade print, else mid-quote. */
export function markAt(
  world: ReactiveWorld,
  venue: string,
  instrument: string,
  at: number,
): { readonly price: string; readonly source: 'last_trade' | 'mid_quote' } | null {
  let lastTrade: { readonly price: string; readonly time: number } | null = null;
  let lastQuote: { readonly bid: string; readonly ask: string; readonly time: number } | null = null;
  for (const observation of world.observations) {
    if (observation.available_time > at) continue;
    if (observation.venue !== venue || observation.instrument !== instrument) continue;
    const event = observation.payload as MarketEventMirror;
    if (event.event_type === 'trade') {
      if (!lastTrade || event.event_time >= lastTrade.time) {
        lastTrade = { price: event.payload.price, time: event.event_time };
      }
    } else if (event.event_type === 'quote') {
      if (!lastQuote || event.event_time >= lastQuote.time) {
        lastQuote = { bid: event.payload.bid_price, ask: event.payload.ask_price, time: event.event_time };
      }
    }
  }
  if (lastTrade) return { price: lastTrade.price, source: 'last_trade' };
  if (lastQuote) {
    return { price: divideRoundHalfUp(add(lastQuote.bid, lastQuote.ask), '2', 8), source: 'mid_quote' };
  }
  // Fall back to the engine's own prints — but ONLY those the point-in-time
  // set admits (fill availability includes information latency; L4 inclusive).
  const engine = world.engines.get(streamKey(venue, instrument));
  if (engine) {
    const visiblePrints = engine.fills.filter((fill) => fill.quartet.available_time <= at);
    if (visiblePrints.length > 0) {
      return { price: visiblePrints[visiblePrints.length - 1]!.price, source: 'last_trade' };
    }
    const top: TopOfBookMirror | null = topOfBook(engine.book);
    if (top) {
      return { price: divideRoundHalfUp(add(top.bid_price, top.ask_price), '2', 8), source: 'mid_quote' };
    }
  }
  return null;
}

/** Marks over the universe at `at` (observation_gap when an instrument is unmarked). */
export function marksAt(
  world: ReactiveWorld,
  universe: readonly { venue: string; instrument: string }[],
  at: number,
): ExampleResult<ReadonlyMap<string, { readonly price: string; readonly source: 'last_trade' | 'mid_quote' }>> {
  const marks = new Map<string, { price: string; source: 'last_trade' | 'mid_quote' }>();
  for (const entry of universe) {
    const mark = markAt(world, entry.venue, entry.instrument, at);
    if (!mark) {
      return fail('observation_gap', `no point-in-time mark for ${streamKey(entry.venue, entry.instrument)} at ${at}`, 'marks');
    }
    marks.set(streamKey(entry.venue, entry.instrument), mark);
  }
  return ok(marks);
}

/** The deterministic run record (the world's L9 anchor). */
export function worldRunRecord(world: ReactiveWorld): ReactiveRunRecordMirror {
  const record: Omit<ReactiveRunRecordMirror, 'digest'> = {
    schema: 'tradrl/example-reactive-run-record@1',
    run_id: world.runId,
    world: {
      world_id: world.worldId,
      mode: 'reactive_replay',
      config_hash: world.configHash,
      engine_config_hash: world.engineConfigHash,
      seed: world.config.seed,
      as_of: world.config.as_of,
      streams: world.config.streams,
      tenant: world.config.tenant,
      project: world.config.project,
    },
    episode: { episode_id: world.episodeId, final_now: world.now },
    ingestion: {
      batches: 1,
      events: world.observations.length,
      chain_head: world.ingestionChainHead,
    },
    engine: {
      orders: world.receipts.length,
      fills: world.fills.length,
    },
    clock_timeline: world.clockTimeline,
    fill_log: world.fills,
    receipt_log: world.receipts,
  };
  return deepFreeze({ ...record, digest: stableDigest8Json(record as unknown as JsonValue) });
}

export function isReactiveWorld(v: unknown): v is ReactiveWorld {
  return (
    typeof v === 'object' &&
    v !== null &&
    isNonEmptyString((v as ReactiveWorld).runId) &&
    Array.isArray((v as ReactiveWorld).fills)
  );
}
