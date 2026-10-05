/**
 * T048 — STATION 2: THE REACTIVE WORLD (T027) + the slice's time machine.
 *
 * The REAL `createReactiveWorldService` over the slice's scope, fed by
 * the adapter station's canonical events (the recorded stream — the
 * canonical envelopes ARE the world's RecordedEvent shape, law for
 * law), matched by the REAL exchange-sim engine bound through the
 * injected EngineDriver port (the T027 interop pattern: exchange-sim
 * is a transitive composition — the documented driver seam; the
 * interop trip wires of T027/T030 prove the mirror law-for-law), with
 * one ADVERSARY participant whose scripted crossing buy moves the book
 * before the slice's order arrives — the market fights back (the
 * reactive difference; in exact replay an order is a receipt, never a
 * match).
 *
 * The engine seeds from the latest book_snapshot available at the
 * episode's start instant (the adapter's T0 partial-depth snapshot),
 * the exogenous stream flows in through the L4 boundary, and the
 * endogenous submissions are matched with the declared physics (fees,
 * latency, book-walk slippage) — every fill carries its full physics
 * lineage.
 *
 * THE TIME MACHINE (T029's rolling machine is consumed through T030's
 * injected port — not a direct dependency of this slice): this module
 * carries the slice's own compact scripted implementation of the port
 * over the same canonical events (the point-in-time view with the
 * INCLUSIVE availability boundary). A production host injects the
 * REAL rolling machine; the port shape is identical (T030's interop
 * test drives the REAL machine through it).
 */

import * as exchangeSim from '../../../packages/exchange-sim/src/index';
import * as reactive from '../../../services/market-world/src/reactive/index';
import {
  createScriptedActionFeed,
  type ParticipantActionFeed,
  type RecordedEventSource,
} from '../../../services/market-world/src/reactive/index';
import type { EmittedEvent } from '../../../adapters/binance/src/index';
import type {
  MachineAsOfViewMirror,
  MachineCursorMirror,
  MachineDrainMirror,
  MachinePortResult,
  MachineRecordMirror,
  TimeMachinePort,
  TimestampMs,
} from '../../../services/shadow-trading/src/index';

import { BTC, PROJECT, SEED, T0, TENANT, VENUE, unwrap } from './scope';

// ---------------------------------------------------------------------------
// The slice's scope identities (station-local)
// ---------------------------------------------------------------------------

/** The reactive world's id (the episode spec binds to it). */
export const WORLD_ID = 'world-e2e-slice';

/** The environment id (the episode spec's profile). */
export const ENVIRONMENT_ID = 'env-e2e-slice';

/** The world's horizon: the whole market day (the last decision + margin). */
export const WORLD_AS_OF = T0 + 400_000;

/** The shadow trader (the candidate participant the shadow session drives). */
export const SHADOW_PARTICIPANT = 'agent-e2e-shadow';

/** The adversary (whose crossing buy moves the book before the slice's order). */
export const ADVERSARY_PARTICIPANT = 'agent-e2e-adversary';

/** The time-machine dataset the shadow session consumes. */
export const MACHINE_DATASET = 'e2e-slice-live';

// ---------------------------------------------------------------------------
// The exchange physics (the declared engine configuration)
// ---------------------------------------------------------------------------

/** The slice's exchange physics: two-tier fees, uniform latency, book-walk slippage. */
export function slicePhysics(): Record<string, unknown> {
  return {
    venue: VENUE,
    instrument: BTC,
    asset_class: 'crypto',
    tick_size: '0.01',
    lot_size: '0.001',
    max_book_depth: 10,
    seed: SEED,
    fidelity: 'reactive_replay',
    fees: {
      tiers: [
        { up_to_notional: '10000', maker_bps: '1', taker_bps: '2' },
        { up_to_notional: null, maker_bps: '0.5', taker_bps: '1' },
      ],
      fee_decimals: 8,
    },
    latency: { kind: 'uniform', min_ms: 50, max_ms: 500 },
    slippage: { kind: 'book_walk' },
    impact: {
      kind: 'none',
      declaration: 'no endogenous impact beyond the book walk — the engine matches the visible book only (the fixture declaration)',
      limitation: 'endogenous reaction around the engine is composed by T027 policies; the slice declares the engine as-is',
    },
  };
}

/** The REAL exchange-sim reducer bound through the injected EngineDriver port (the T027 interop pattern). */
export function realEngineDriver(): reactive.EngineDriver {
  type RealEngineState = Parameters<typeof exchangeSim.submitOrder>[0];
  return {
    createEngine: (config, init) => exchangeSim.createEngine(config, init) as unknown as reactive.EngineOpResult<reactive.EngineStateMirror>,
    submitOrder: (state, intent, at) => exchangeSim.submitOrder(state as unknown as RealEngineState, intent, at) as unknown as reactive.EngineOpResult<reactive.SubmitOutcomeMirror>,
    cancelOrder: (state, reference, at) => exchangeSim.cancelOrder(state as unknown as RealEngineState, reference, at) as unknown as reactive.EngineOpResult<reactive.CancelOutcomeMirror>,
    advanceEngine: (state, to) => exchangeSim.advanceEngine(state as unknown as RealEngineState, to) as unknown as reactive.EngineOpResult<reactive.AdvanceOutcomeMirror>,
  };
}

// ---------------------------------------------------------------------------
// The world configuration + the episode spec
// ---------------------------------------------------------------------------

/** The world's participant roster: the shadow candidate + one scripted adversary. */
function sliceParticipants(): readonly Record<string, unknown>[] {
  return [
    { instance: SHADOW_PARTICIPANT, role: 'candidate', feed: null },
    { instance: ADVERSARY_PARTICIPANT, role: 'adversary', feed: 'feed-e2e-adversary' },
  ];
}

/** The adversary's script: ONE crossing buy at T0+15_000 that consumes the two best ask levels. */
function adversaryScript(): readonly Record<string, unknown>[] {
  return [
    {
      at: T0 + 15_000,
      action: {
        action_id: 'e2e-adv-01',
        actor: ADVERSARY_PARTICIPANT,
        submitted_at: T0 + 15_000,
        client_sequence: 1,
        payload: {
          type: 'submit_order',
          intent: {
            clientOrderId: 'e2e-adv-cross',
            instrumentId: BTC,
            venueId: VENUE,
            side: 'buy',
            kind: 'limit',
            quantity: '2.6',
            price: '50200.00',
            timeInForce: 'gtc',
            createdAt: '2024-06-03T14:00:15.000Z',
          },
        },
      },
    },
  ];
}

/** The world configuration (mode-honest: reactive_replay, the L5/L6 declaration). */
export function sliceWorldConfig(): Record<string, unknown> {
  return {
    world_id: WORLD_ID,
    mode: 'reactive_replay',
    information_policy: 'point-in-time',
    tenant: TENANT,
    project: PROJECT,
    seed: SEED,
    as_of: WORLD_AS_OF,
    streams: [{ venue: VENUE, instrument: BTC }],
    exchange: slicePhysics(),
    physics_refs: slicePhysicsRefs(),
    participants: sliceParticipants(),
    interleaving: { kind: 'stream_first' },
    playback_speed: 1,
  };
}

/** The episode spec: binds to the slice's world, clock anchored at the stream start. */
export function sliceWorldSpec(): Record<string, unknown> {
  return {
    profile: {
      environment_id: ENVIRONMENT_ID,
      fidelity: 'reactive_replay',
      clock: { now: T0, asOf: WORLD_AS_OF, playbackSpeed: 1, paused: false, fidelity: 'reactive_replay', informationPolicy: 'point-in-time' },
      seed: SEED,
      venue_scope: [VENUE],
      instrument_scope: [BTC],
      latency_policy: slicePhysicsRefs().latency_policy,
      fee_policy: slicePhysicsRefs().fee_policy,
    },
    world: { world_id: WORLD_ID, kind: 'reactive' },
    information_policy: 'point-in-time',
  };
}

/** The physics lineage refs (versioned policy refs bound into every engine fill). */
export function slicePhysicsRefs(): Record<string, string> {
  const validated = reactive.validateExchangePhysics(slicePhysics());
  const physics = unwrap(validated, 'the slice physics must validate');
  const hash = reactive.physicsHash(physics);
  return {
    fee_policy: `fees:${hash}`,
    latency_policy: `latency:${hash}`,
    slippage_policy: `slippage:${hash}`,
    impact_policy: `impact:${hash}`,
  };
}

// ---------------------------------------------------------------------------
// The station
// ---------------------------------------------------------------------------

/** Station 2's product: the loaded world service + a fresh time-machine port. */
export interface ReactiveWorldStation {
  readonly world: reactive.ReactiveWorldService;
  /** A fresh scripted time machine over the same canonical events (one per shadow session). */
  readonly machine: TimeMachinePort;
}

/**
 * Build + load the reactive world over the adapter station's BTC events
 * (the world executes the BTC-USDT stream; the ETH mark informs the
 * strategy but carries no book in this world — documented honestly).
 */
export async function buildReactiveWorld(binanceEvents: readonly EmittedEvent[]): Promise<ReactiveWorldStation> {
  // The recorded stream: the BTC-USDT events, in two digest-chained batches
  // (the seed snapshot, then the trade prints).
  const snapshot = binanceEvents.filter((event) => event.event_type === 'book_snapshot');
  const trades = binanceEvents.filter((event) => event.event_type === 'trade' && event.instrument === BTC);
  const source: RecordedEventSource = reactive.asRecordedEventSource([[...snapshot], [...trades]]);

  const adversary = createScriptedActionFeed(ADVERSARY_PARTICIPANT as never, adversaryScript());
  const feed: ParticipantActionFeed = unwrap(adversary, 'the adversary feed must construct');

  const construction = reactive.createReactiveWorldService(sliceWorldConfig(), {
    source,
    engine: realEngineDriver(),
    feeds: [{ ref: 'feed-e2e-adversary', feed }],
  });
  const world = unwrap(construction, 'the reactive world must construct');
  const loaded = unwrap(await world.loadAll(), 'the recorded stream must load');
  if (loaded.events !== snapshot.length + trades.length) {
    throw new Error(`the world must apply every recorded event (expected ${snapshot.length + trades.length}, applied ${loaded.events})`);
  }
  return { world, machine: sliceTimeMachine([...snapshot, ...trades]) };
}

// ---------------------------------------------------------------------------
// The slice's scripted time machine (T030's injected port, implemented here)
// ---------------------------------------------------------------------------

interface ScriptedCursor {
  cursor_id: string;
  position: number;
  last_drain_at: TimestampMs | null;
  drains: number;
  delivered: number;
}

/**
 * The compact scripted rolling machine: the canonical events as records
 * (their availability quartets verbatim), cursors with the INCLUSIVE
 * drain boundary, the firewall audit per drain, and the as-of view.
 * Deterministic; the same records always drain the same deltas.
 */
export function sliceTimeMachine(events: readonly EmittedEvent[]): TimeMachinePort {
  const records: readonly MachineRecordMirror[] = events.map((event, index) => ({
    record_id: `tm-e2e-${String(index + 1).padStart(4, '0')}`,
    tenant: TENANT,
    payload: event.payload,
    event_time: event.event_time,
    source_time: event.source_time,
    available_time: event.available_time,
    ingestion_time: event.ingestion_time,
    inputs: [],
    computation: null,
    provenance: event.provenance,
    arrival_sequence: index,
  }));
  const cursors: ScriptedCursor[] = [];
  const cursorIdOf = (ordinal: number): string => `cur-e2e-${String(ordinal).padStart(6, '0')}`;
  const machineOk = <T>(value: T): MachinePortResult<T> => ({ ok: true, value });
  const machineFail = (code: string, message: string): MachinePortResult<never> => ({ ok: false, error: { code, message } });

  const auditOf = (at: TimestampMs, included: readonly MachineRecordMirror[]): { readonly tenant: string; readonly at: TimestampMs; readonly scanned: number; readonly decisions: readonly { readonly record_id: string; readonly decision: 'included' | 'excluded'; readonly reason: string; readonly available_time: TimestampMs | null; readonly now: TimestampMs }[] } => ({
    tenant: TENANT,
    at,
    scanned: records.length,
    decisions: [
      ...included.map((record) => ({ record_id: record.record_id, decision: 'included' as const, reason: 'available_at_or_before_now', available_time: record.available_time, now: at })),
      ...records.filter((record) => record.available_time > at).map((record) => ({ record_id: record.record_id, decision: 'excluded' as const, reason: 'available_after_now', available_time: record.available_time, now: at })),
    ],
  });

  const cursorMirror = (cursor: ScriptedCursor): MachineCursorMirror => ({
    cursor_id: cursor.cursor_id,
    dataset: MACHINE_DATASET,
    position: cursor.position,
    last_drain_at: cursor.last_drain_at,
    drains: cursor.drains,
    delivered: cursor.delivered,
  });

  return {
    dataset: MACHINE_DATASET,
    tenant: TENANT,
    openCursor(options?: { readonly from?: 'start' | 'tip' }) {
      const from = options?.from ?? 'start';
      const ordinal = cursors.length + 1;
      const cursor: ScriptedCursor = { cursor_id: cursorIdOf(ordinal), position: from === 'tip' ? records.length : 0, last_drain_at: null, drains: 0, delivered: 0 };
      cursors.push(cursor);
      return machineOk(cursorMirror(cursor));
    },
    drainCursor(cursorId: string, at: TimestampMs) {
      const cursor = cursors.find((candidate) => candidate.cursor_id === cursorId);
      if (cursor === undefined) return machineFail('unknown_cursor', `the scripted machine does not know cursor ${cursorId}`);
      const visible = records
        .map((record, index) => ({ record, index }))
        .filter(({ record, index }) => index >= cursor.position && record.available_time <= at)
        .sort((a, b) => (a.record.available_time !== b.record.available_time ? a.record.available_time - b.record.available_time : a.record.record_id < b.record.record_id ? -1 : 1))
        .map(({ record }) => record);
      const advanced = visible.length > 0;
      if (advanced) {
        const last = visible[visible.length - 1] as MachineRecordMirror;
        cursor.position = records.findIndex((record) => record.record_id === last.record_id) + 1;
      }
      cursor.drains += 1;
      cursor.delivered += visible.length;
      cursor.last_drain_at = at;
      const drain: MachineDrainMirror = { cursor_id: cursorId, at, records: visible, position: cursor.position, advanced, audit: auditOf(at, visible) };
      return machineOk(drain);
    },
    forkCursor(cursorId: string) {
      const cursor = cursors.find((candidate) => candidate.cursor_id === cursorId);
      if (cursor === undefined) return machineFail('unknown_cursor', `the scripted machine does not know cursor ${cursorId}`);
      const ordinal = cursors.length + 1;
      const fork: ScriptedCursor = { cursor_id: cursorIdOf(ordinal), position: cursor.position, last_drain_at: cursor.last_drain_at, drains: 0, delivered: 0 };
      cursors.push(fork);
      return machineOk(cursorMirror(fork));
    },
    getCursor(cursorId: string) {
      const cursor = cursors.find((candidate) => candidate.cursor_id === cursorId);
      if (cursor === undefined) return machineFail('unknown_cursor', `the scripted machine does not know cursor ${cursorId}`);
      return machineOk(cursorMirror(cursor));
    },
    asOf(query: { readonly dataset: string; readonly at: TimestampMs }) {
      if (query.dataset !== MACHINE_DATASET) return machineFail('unknown_dataset', `the scripted machine serves ${MACHINE_DATASET}, not ${query.dataset}`);
      const visible = records.filter((record) => record.available_time <= query.at);
      const view: MachineAsOfViewMirror = { dataset: MACHINE_DATASET, at: query.at, records: visible, audit: auditOf(query.at, visible), hash: `${visible.length}-of-${records.length}` };
      return machineOk(view);
    },
  };
}
