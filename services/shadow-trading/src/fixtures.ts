/**
 * @tradrl/shadow_trading — the deterministic fixture scenario (the
 * behavioral suite's substrate).
 *
 * THE GOLDEN SCENARIO (every number hand-computed exactly):
 *   The scope: tenant-shadow-alpha / project-shadow-alpha over the
 *   SHADOWSIM venue (BTC-USD + ETH-USD), seeded books BTC asks
 *   50000.00x0.5 + 50050.00x1.0 / bids 49950.00x0.8 + 49900.00x1.2,
 *   ETH asks 3000.00x2.0 / bids 2990.00x3.0; taker fee 2 bps, maker
 *   1 bps (half-up at 8 decimals); fill latency 150ms on ODD fill
 *   ordinals and 600ms on EVEN ones (the visibility-window knob).
 *
 *   The decision stream (7 decisions):
 *     d1 @ T0+25_000 — limit buy 0.75 BTC @ 50100: walks the asks ->
 *       fills 0.5 @ 50000 (fee 5) + 0.25 @ 50050 (fee 2.5025);
 *       BOTH latency-pending at the tick (available +150/+600).
 *     d2 @ T0+26_000 — market sell 0.2 BTC: fills 0.2 @ 49950 (fee
 *       1.998); the tick APPLIES d1's two fills (their windows
 *       elapsed): position 0.75 BTC, cash 100000 - 25005 - 12515.0025
 *       = 62479.9975.
 *     d3 @ T0+60_000 — limit buy 0.8 ETH @ 3050: fills 0.8 @ 3000
 *       (fee 0.48, 600ms pending); the tick applies d2's fill:
 *       position 0.55 BTC, cash 72467.9995.
 *     d4 @ T0+61_000 — limit buy 0.1 BTC @ 70500: the GATE approves
 *       (post-trade 0.65 x 95000 = 61750 < 110000) but the RISK stage
 *       REFUSES — the BTC mark rose to 95000 (event available
 *       T0+60_500): position notional 0.55 x 95000 = 52250 > the risk
 *       cap 52000. ZERO world submissions. The tick applies d3's ETH
 *       fill: cash 70067.5195, positions BTC 0.55 + ETH 0.8.
 *     d5 @ T0+90_000 — market sell 0.3 BTC: the mark fell back to
 *       50000 (event T0+89_500) -> the risk stage is within again;
 *       fills 0.3 @ 49950 (fee 2.997). (The mark crash measures a
 *       DRAWDOWN breach — portfolio-kind: measured, recorded, NOT
 *       blocking — the L7 division this lane declares.)
 *     d6 @ T0+120_000 — limit buy 0.9 BTC @ 56000: the ask level
 *       50050 holds 0.75 -> fills 0.75 @ 50050 (fee 7.5075, 600ms
 *       pending) -> PARTIAL (0.75 of 0.9; the remainder rests).
 *     d7 @ T0+150_000 — limit buy 0.1 BTC @ 10000: the book holds NO
 *       asks -> zero fills -> EXPIRED (the resting order's declared
 *       window disposition).
 *
 *   The refusal fixtures trip EACH gate dimension exactly once
 *   (identity / authorization / limits / venue permissions / rate
 *   limits / credentials) plus the risk stage and the kill switch.
 *
 * Zero runtime dependencies. No ambient clock — every instant is an
 * explicit literal. No ambient randomness — the latency schedule is
 * ordinal-derived.
 */

import { canonicalJson, deepFreeze, fnv1a32Hex, type TimestampMs } from './primitives';
import { type ShadowResult, ok } from './errors';
import type { ReactiveFillMirror, ReactiveWorldPort, ReactiveWorldSubmissionMirror, ReactiveWorldViewMirror, WorldActionReceiptMirror, WorldPortResult, EngineFillMirror } from './world-mirror';
import type { MachineAsOfViewMirror, MachineCursorMirror, MachineCursorOptions, MachineDrainMirror, MachinePortResult, MachineRecordMirror, TimeMachinePort, FirewallAuditMirror } from './time-machine-mirror';
import type { StrategyIntentMirror } from '../../../packages/execution-policy/src/index';
import {
  add as decAdd,
  compare as decCompare,
  divideRoundHalfUp as decDivide,
  multiply as decMultiply,
  normalize as decNormalize,
  startKillSwitch,
  subtract as decSubtract,
  validateExecutionPolicy,
  DEFAULT_CHECK_ORDER,
  type ExecutionPolicy,
  type KillSwitchLog,
} from '../../../packages/execution-policy/src/index';
import { compileRiskPolicy, type RiskPolicy } from '../../../packages/risk/src/index';
import { createShadowSession, runShadowSession, type ShadowSession } from './session';

// ---------------------------------------------------------------------------
// The reference scope (explicit literals — no ambient anything)
// ---------------------------------------------------------------------------

/** The fixture clock base (epoch ms). */
export const T0 = 1_700_000_000_000;

/** The reference scope. */
export const TENANT = 'tenant-shadow-alpha';
export const PROJECT = 'project-shadow-alpha';
export const SEED = 't030-reference-seed';

/** The reference principal (the strategy spec id the policy allows). */
export const PRINCIPAL = 'spec-shadow-eq-drift';

/** The shadow trader's actor id (the action envelopes' actor). */
export const PARTICIPANT = 'agent-shadow-alpha';

/** The reference venue + instruments. */
export const VENUE = 'SHADOWSIM';
export const BTC = 'BTC-USD';
export const ETH = 'ETH-USD';

/** The fixture dataset identity (the time machine's). */
export const DATASET = 'shadow-alpha-live';

/** The episode's as-of horizon (the scripted world's clock anchor). */
const HORIZON = T0 + 300_000;

/** Unwrap a fixture result or fail loudly (fixtures are valid by construction). */
export function unwrap<T>(result: ShadowResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

/** Unwrap a MACHINE-port result (the single-error result shape) or fail loudly. */
export function unwrapMachine<T>(result: MachinePortResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`machine fixture must be valid: ${result.error.code}: ${result.error.message}`);
}

// ---------------------------------------------------------------------------
// The scripted world (the injected reactive-world port)
// ---------------------------------------------------------------------------

/** One book level. */
interface Level {
  price: string;
  size: string;
}

/** One episode's state inside the scripted world. */
interface ScriptedEpisode {
  readonly episodeId: string;
  asks: Level[];
  bids: Level[];
  ethAsks: Level[];
  ethBids: Level[];
  fills: ReactiveFillMirror[];
  now: TimestampMs;
  finished: boolean;
  submissionOrdinal: number;
}

/** The world's deterministic physics digests (L9 lineage). */
function worldConfigDigest(): string {
  return fnv1a32Hex(canonicalJson({
    venue: VENUE,
    instruments: [BTC, ETH],
    taker_bps: '2',
    maker_bps: '1',
    fee_decimals: 8,
    latency_odd_ms: 150,
    latency_even_ms: 600,
    slippage: 'book_walk',
    impact: 'none',
  }));
}

/** The fresh book seeds (per episode — each episode is its own engine). */
function freshAsks(): Level[] {
  return [
    { price: '50000.00', size: '0.5' },
    { price: '50050.00', size: '1.0' },
  ];
}
function freshBids(): Level[] {
  return [
    { price: '49950.00', size: '0.8' },
    { price: '49900.00', size: '1.2' },
  ];
}

/** The ETH book seed. */
function freshEthAsks(): Level[] {
  return [{ price: '3000.00', size: '2.0' }];
}
function freshEthBids(): Level[] {
  return [{ price: '2990.00', size: '3.0' }];
}

/** The deterministic latency schedule: ODD fill ordinals 150ms, EVEN ones 600ms. */
function latencyOf(fillOrdinal: number): number {
  return fillOrdinal % 2 === 1 ? 150 : 600;
}

/** The exact taker/maker fee at the declared bps (half-up at 8 decimals). */
function feeOf(notional: string, bps: string): string {
  return decDivide(decMultiply(notional, bps), '10000', 8);
}

/**
 * The scripted world: a deterministic price-time-priority book walker
 * with exact fees and the ordinal latency schedule — the structural
 * stand-in the session consumes through the port (the interop test
 * replaces it with the REAL reactive world service).
 */
export function createScriptedWorld(): ReactiveWorldPort {
  const configHash = worldConfigDigest();
  const runId = `run-shadow-${configHash}`;
  const episodes: ScriptedEpisode[] = [];
  const physics = {
    engine_config_hash: configHash,
    fee_policy: `fees:${configHash}`,
    latency_policy: `latency:${configHash}`,
    slippage_policy: `slippage:${configHash}`,
    impact_policy: `impact:${configHash}`,
    run_ref: runId,
    tenant: TENANT,
    project: PROJECT,
  };

  const episodeOf = (episodeId: string): ScriptedEpisode | undefined => episodes.find((episode) => episode.episodeId === episodeId);

  const viewOf = (episode: ScriptedEpisode): ReactiveWorldViewMirror =>
    deepFreeze({
      episode_id: episode.episodeId,
      clock: { now: episode.now, asOf: HORIZON as TimestampMs },
      status: episode.finished ? 'finished' : 'running',
      settled: true,
      pending_stream_events: 0,
      pending_scripted_actions: 0,
    });

  /** The book walk: match one order intent against the opposite side's levels. */
  const matchOrder = (episode: ScriptedEpisode, intent: Record<string, unknown>, at: TimestampMs): { fills: EngineFillMirror[]; status: string; orderId: string } => {
    const instrument = intent.instrumentId as string;
    const side = intent.side as 'buy' | 'sell';
    const kind = intent.kind as string;
    const limitPrice = typeof intent.price === 'string' ? intent.price : undefined;
    let quantity = decNormalize(intent.quantity as string);
    const isBuy = side === 'buy';
    let levels = isBuy ? episode.asks : episode.bids;
    if (instrument === ETH) levels = isBuy ? episode.ethAsks : episode.ethBids;
    const fills: EngineFillMirror[] = [];
    let levelIndex = 0;
    while (decCompareExact(quantity, '0') > 0 && levelIndex < levels.length) {
      const level = levels[levelIndex];
      if (level === undefined) break;
      if (kind === 'limit' && limitPrice !== undefined) {
        const crosses = isBuy ? decCompareExact(level.price, limitPrice) <= 0 : decCompareExact(level.price, limitPrice) >= 0;
        if (!crosses) break;
      }
      const take = decCompareExact(level.size, quantity) >= 0 ? quantity : level.size;
      if (decCompareExact(take, '0') > 0) {
        const notional = decMultiply(level.price, take);
        const fillOrdinal = episode.fills.length + fills.length + 1;
        const latency = latencyOf(fillOrdinal);
        const orderId = `eo-${String(episode.submissionOrdinal).padStart(8, '0')}`;
        const makerOrderId = `mo-${String(fillOrdinal).padStart(8, '0')}`;
        fills.push(
          deepFreeze({
            fill_id: `fx-${String(fillOrdinal).padStart(8, '0')}`,
            trade_id: `tx-${String(fillOrdinal).padStart(8, '0')}`,
            venue: VENUE,
            instrument,
            quartet: deepFreeze({
              event_time: at,
              source_time: null,
              available_time: (at + latency) as TimestampMs,
              ingestion_time: (at + latency) as TimestampMs,
            }),
            sequence: fillOrdinal,
            taker_order_id: orderId,
            maker_order_id: makerOrderId,
            aggressor_side: side,
            price: level.price,
            aggressor_price: level.price,
            quantity: take,
            taker_fee: feeOf(notional, '2'),
            maker_fee: feeOf(notional, '1'),
            latency_ms: latency,
          }),
        );
        level.size = decSub(level.size, take);
        quantity = decSub(quantity, take);
      }
      if (decCompareExact(level.size, '0') === 0) {
        levels.splice(levelIndex, 1);
      } else {
        levelIndex++;
      }
    }
    const filledSoFar = fills.reduce((total, fill) => decAdd(total, fill.quantity), '0');
    const orderQuantity = decNormalize(intent.quantity as string);
    const status = decCompareExact(filledSoFar, orderQuantity) === 0 ? 'filled' : decCompareExact(filledSoFar, '0') > 0 ? 'partially_filled' : 'open';
    const orderId = `eo-${String(episode.submissionOrdinal).padStart(8, '0')}`;
    return { fills, status, orderId };
  };

  return {
    config_hash: configHash,
    run_id: runId,
    engine_config_hash: configHash,
    get episodes(): readonly string[] {
      return Object.freeze(episodes.map((episode) => episode.episodeId));
    },
    start(spec: unknown): WorldPortResult<ReactiveWorldViewMirror> {
      void spec;
      const episodeId = `ep-shadow-${String(episodes.length + 1).padStart(8, '0')}`;
      const episode: ScriptedEpisode = {
        episodeId,
        asks: freshAsks(),
        bids: freshBids(),
        ethAsks: freshEthAsks(),
        ethBids: freshEthBids(),
        fills: [],
        now: T0 as TimestampMs,
        finished: false,
        submissionOrdinal: 0,
      };
      episodes.push(episode);
      return ok(viewOf(episode));
    },
    advance(episodeId: string, to: TimestampMs): WorldPortResult<ReactiveWorldViewMirror> {
      const episode = episodeOf(episodeId);
      if (episode === undefined) return portFail('unknown_episode', `the scripted world does not know episode ${episodeId}`);
      if ((to as number) < (episode.now as number)) return portFail('clock_not_monotonic', `the scripted world's clock cannot move backward (${to} < ${episode.now})`);
      episode.now = to;
      return ok(viewOf(episode));
    },
    submit(episodeId: string, action: unknown): WorldPortResult<ReactiveWorldSubmissionMirror> {
      const episode = episodeOf(episodeId);
      if (episode === undefined) return portFail('unknown_episode', `the scripted world does not know episode ${episodeId}`);
      const record = action as { action_id?: unknown; actor?: unknown; submitted_at?: unknown; client_sequence?: unknown; payload?: { type?: unknown; intent?: Record<string, unknown> } };
      if (typeof record.action_id !== 'string' || typeof record.actor !== 'string' || typeof record.submitted_at !== 'number' || typeof record.client_sequence !== 'number' || typeof record.payload !== 'object' || record.payload === null) {
        return portFail('invalid_action', 'the action envelope is malformed');
      }
      if ((record.submitted_at as number) > (episode.now as number)) {
        return portFail('action_from_future', `action ${record.action_id} claims submission at ${record.submitted_at}, after the episode's now ${episode.now}`);
      }
      if (record.payload.type !== 'submit_order' || typeof record.payload.intent !== 'object' || record.payload.intent === null) {
        return portFail('invalid_action', "the scripted world only accepts 'submit_order' payloads");
      }
      episode.submissionOrdinal += 1;
      const matched = matchOrder(episode, record.payload.intent, record.submitted_at as TimestampMs);
      const worldFills: ReactiveFillMirror[] = matched.fills.map((fill) =>
        deepFreeze({
          fill,
          fill_id: fill.fill_id,
          episode_id: episodeId,
          run_ref: runId,
          taker_participant: record.actor as string,
          taker_order_id: fill.taker_order_id,
          maker_order_id: fill.maker_order_id,
          physics,
        }),
      );
      episode.fills.push(...worldFills);
      const receipt: WorldActionReceiptMirror = deepFreeze({
        receipt_id: `swr-${String(episode.submissionOrdinal).padStart(8, '0')}`,
        episode_id: episodeId,
        action_id: record.action_id,
        actor: record.actor as string,
        client_sequence: record.client_sequence as number,
        recorded_at: episode.now,
        disposition: 'engine_matched',
        engine: deepFreeze({
          kind: 'ack',
          order_id: matched.orderId,
          status: matched.status,
          reject_reason: null,
          fill_ids: Object.freeze(matched.fills.map((fill) => fill.fill_id)),
        }),
        physics,
      });
      const view = viewOf(episode);
      return ok(deepFreeze({ ...view, receipt }) as ReactiveWorldSubmissionMirror);
    },
    fills(episodeId: string): WorldPortResult<readonly ReactiveFillMirror[]> {
      const episode = episodeOf(episodeId);
      if (episode === undefined) return portFail('unknown_episode', `the scripted world does not know episode ${episodeId}`);
      return ok(Object.freeze([...episode.fills]));
    },
    finish(episodeId: string, reason: unknown): WorldPortResult<null> {
      void reason;
      const episode = episodeOf(episodeId);
      if (episode === undefined) return portFail('unknown_episode', `the scripted world does not know episode ${episodeId}`);
      episode.finished = true;
      return ok(null);
    },
    runRecord(episodeId: string): WorldPortResult<{ digest: string }> {
      const episode = episodeOf(episodeId);
      if (episode === undefined) return portFail('unknown_episode', `the scripted world does not know episode ${episodeId}`);
      return ok(deepFreeze({ digest: fnv1a32Hex(canonicalJson(episode.fills)) }));
    },
  } as unknown as ReactiveWorldPort;
}

/** Exact compare over normalized decimals (local alias for readability). */
function decCompareExact(a: string, b: string): number {
  return decCompare(decNormalize(a), decNormalize(b));
}

/** Exact subtract (local alias). */
function decSub(a: string, b: string): string {
  return decSubtract(decNormalize(a), decNormalize(b));
}

/** Build a world-port failure (the reactive error shape). */
function portFail(code: string, message: string): WorldPortResult<never> {
  return { ok: false, errors: [{ code, path: '', message }] };
}

// ---------------------------------------------------------------------------
// The scripted time machine (the injected machine port)
// ---------------------------------------------------------------------------

/** A machine-port success. */
function machineOk<T>(value: T): MachinePortResult<T> {
  return { ok: true, value };
}

/** A machine-port failure (the single-error result shape). */
function machineFail<T = never>(code: string, message: string): MachinePortResult<T> {
  return { ok: false, error: { code, message } };
}

/** One scripted machine record. */
interface ScriptedRecord {
  readonly record_id: string;
  readonly available_time: TimestampMs;
  readonly payload: Record<string, unknown>;
}

/** The scripted machine's rolling window (all records visible within the horizon). */
function scriptedRecords(): readonly ScriptedRecord[] {
  return [
    { record_id: 'mk-0001', available_time: (T0 + 5_000) as TimestampMs, payload: { price: '50000.00' } },
    // Available EXACTLY at d1's drain instant — the inclusive L4 boundary.
    { record_id: 'mk-0002', available_time: (T0 + 25_000) as TimestampMs, payload: { price: '50000.00' } },
    // Available ONE MILLISECOND after d1's drain instant — NOT delivered at d1 (the off-by-one).
    { record_id: 'mk-0003', available_time: (T0 + 25_001) as TimestampMs, payload: { price: '50000.10' } },
    { record_id: 'mk-0004', available_time: (T0 + 60_000) as TimestampMs, payload: { price: '50000.00' } },
    { record_id: 'mk-0005', available_time: (T0 + 90_000) as TimestampMs, payload: { price: '50000.00' } },
    { record_id: 'mk-0006', available_time: (T0 + 150_000) as TimestampMs, payload: { price: '50000.00' } },
  ];
}

/** The machine's internal cursor state. */
interface ScriptedCursor {
  readonly cursor_id: string;
  position: number;
  last_drain_at: TimestampMs | null;
  drains: number;
  delivered: number;
}

/**
 * The scripted time machine: a deterministic rolling window with the
 * INCLUSIVE availability boundary, (available_time, record_id)
 * ordering, per-drain firewall audits, forking and as-of views — the
 * structural stand-in the session consumes through the port (the
 * interop test replaces it with the REAL rolling time machine).
 */
export function createScriptedMachine(): TimeMachinePort {
  const records = scriptedRecords();
  const cursors: ScriptedCursor[] = [];
  const cursorIdOf = (ordinal: number): string => `cur-shadow-${String(ordinal).padStart(8, '0')}`;

  const toMirror = (record: ScriptedRecord): MachineRecordMirror =>
    deepFreeze({
      record_id: record.record_id,
      tenant: TENANT,
      payload: record.payload,
      event_time: (record.available_time - 50) as TimestampMs,
      source_time: null,
      available_time: record.available_time,
      ingestion_time: (record.available_time + 100) as TimestampMs,
      inputs: [],
      computation: null,
      provenance: deepFreeze({ origin: 'historical', adapter: { id: 'shadow-fixtures', version: '1.0.0' }, derived_from: [], transform: null, corrections: [], custody: { adapter: { id: 'shadow-fixtures', version: '1.0.0' }, batch: { batch_id: 'b-shadow' }, commit: { commit_id: `c-${record.record_id}`, commit_sequence: 1, ingestion_time: (record.available_time + 100) as TimestampMs } } }),
      arrival_sequence: records.indexOf(record),
    });

  const auditOf = (at: TimestampMs, included: readonly MachineRecordMirror[], scanned: number): FirewallAuditMirror =>
    deepFreeze({
      tenant: TENANT,
      at,
      scanned,
      decisions: Object.freeze([
        ...included.map((record) => deepFreeze({ record_id: record.record_id, decision: 'included' as const, reason: 'available_at_or_before_now', available_time: record.available_time, now: at })),
        ...records
          .filter((record) => (record.available_time as number) > (at as number))
          .map((record) => deepFreeze({ record_id: record.record_id, decision: 'excluded' as const, reason: 'available_after_now', available_time: record.available_time, now: at })),
      ]),
    });

  return deepFreeze({
    dataset: DATASET,
    tenant: TENANT,
    openCursor(options?: MachineCursorOptions): MachinePortResult<MachineCursorMirror> {
      const from = options?.from ?? 'start';
      const ordinal = cursors.length + 1;
      const position = from === 'tip' ? records.length : 0;
      const cursor: ScriptedCursor = { cursor_id: cursorIdOf(ordinal), position, last_drain_at: null, drains: 0, delivered: 0 };
      cursors.push(cursor);
      return machineOk(cursorMirrorOf(cursor));
    },
    drainCursor(cursorId: string, at: TimestampMs): MachinePortResult<MachineDrainMirror> {
      const cursor = cursors.find((candidate) => candidate.cursor_id === cursorId);
      if (cursor === undefined) return machineFail('unknown_cursor', `the scripted machine does not know cursor ${cursorId}`);
      const visible = records
        .map((record, index) => ({ record, index }))
        .filter(({ record, index }) => index >= cursor.position && (record.available_time as number) <= (at as number))
        .sort((a, b) => {
          if (a.record.available_time !== b.record.available_time) return (a.record.available_time as number) - (b.record.available_time as number);
          return a.record.record_id < b.record.record_id ? -1 : a.record.record_id > b.record.record_id ? 1 : 0;
        })
        .map(({ record }) => toMirror(record));
      const advanced = visible.length > 0;
      if (advanced) {
        const last = visible[visible.length - 1];
        if (last !== undefined) {
          const lastIndex = records.findIndex((record) => record.record_id === last.record_id);
          cursor.position = lastIndex + 1;
        }
      }
      cursor.drains += 1;
      cursor.delivered += visible.length;
      cursor.last_drain_at = at;
      const audit = auditOf(at, visible, records.length);
      return machineOk(deepFreeze({
        cursor_id: cursorId,
        at,
        records: Object.freeze(visible),
        position: cursor.position,
        advanced,
        audit,
      }));
    },
    forkCursor(cursorId: string): MachinePortResult<MachineCursorMirror> {
      const cursor = cursors.find((candidate) => candidate.cursor_id === cursorId);
      if (cursor === undefined) return machineFail('unknown_cursor', `the scripted machine does not know cursor ${cursorId}`);
      const ordinal = cursors.length + 1;
      const fork: ScriptedCursor = { cursor_id: cursorIdOf(ordinal), position: cursor.position, last_drain_at: cursor.last_drain_at, drains: 0, delivered: 0 };
      cursors.push(fork);
      return machineOk(cursorMirrorOf(fork));
    },
    getCursor(cursorId: string): MachinePortResult<MachineCursorMirror> {
      const cursor = cursors.find((candidate) => candidate.cursor_id === cursorId);
      if (cursor === undefined) return machineFail('unknown_cursor', `the scripted machine does not know cursor ${cursorId}`);
      return machineOk(cursorMirrorOf(cursor));
    },
    asOf(query: { readonly dataset: string; readonly at: TimestampMs }): MachinePortResult<MachineAsOfViewMirror> {
      if (query.dataset !== DATASET) return machineFail('unknown_dataset', `the scripted machine serves ${DATASET}, not ${query.dataset}`);
      const visible = records
        .filter((record) => (record.available_time as number) <= (query.at as number))
        .map((record) => toMirror(record));
      const audit = auditOf(query.at, visible, records.length);
      const hash = fnv1a32Hex(canonicalJson(visible.map((record) => record.record_id)));
      return machineOk(deepFreeze({ dataset: DATASET, at: query.at, records: Object.freeze(visible), audit, hash }));
    },
  } as unknown as TimeMachinePort);

  function cursorMirrorOf(cursor: ScriptedCursor): MachineCursorMirror {
    return deepFreeze({ cursor_id: cursor.cursor_id, dataset: DATASET, position: cursor.position, last_drain_at: cursor.last_drain_at, drains: cursor.drains, delivered: cursor.delivered });
  }
}

// ---------------------------------------------------------------------------
// The reference declarations (the control stack)
// ---------------------------------------------------------------------------

/** The standing kill switch of the reference scope (genesis at T0 - 10s). */
export function referenceKillSwitch(): KillSwitchLog {
  const result = startKillSwitch(TENANT as never, PROJECT as never, (T0 - 10_000) as never);
  if (!result.ok) throw new Error(`reference kill switch must start: ${JSON.stringify(result.errors)}`);
  return result.value;
}

/**
 * The REFERENCE EXECUTION POLICY — every check dimension present
 * (crypto cap records + the '*' catch-all, the two-pair venue
 * allowlist, the per-venue rate budget of 10/minute, the opaque
 * credential binding, the principal allowlist, limit+market grants)
 * under the canonical check order.
 */
export function referenceExecutionPolicy(options: { readonly omitCredentials?: boolean; readonly rateBudget?: number } = {}): ExecutionPolicy {
  const killSwitch = referenceKillSwitch();
  const result = validateExecutionPolicy({
    version: 1,
    tenant: TENANT,
    project: PROJECT,
    identity: { principals: [PRINCIPAL] },
    authorization: [
      { scopeRef: 'grant:shadow-execute-limit@1', orderKinds: ['limit'] },
      { scopeRef: 'grant:shadow-execute-market@1', orderKinds: ['market'] },
    ],
    limits: [
      { instrumentClass: 'crypto', maxOrderSize: '1', maxOrderNotional: '60000', maxPositionSize: '2', maxPositionNotional: '110000' },
      { instrumentClass: '*', maxOrderSize: '0.5', maxOrderNotional: '30000', maxPositionSize: '1', maxPositionNotional: '55000' },
    ],
    venuePermissions: [
      { venue: VENUE, instrument: BTC, instrumentClass: 'crypto' },
      { venue: VENUE, instrument: ETH, instrumentClass: 'crypto' },
    ],
    rateLimits: [{ venue: VENUE, windowMs: 60_000, maxOrders: options.rateBudget ?? 10 }],
    credentials: options.omitCredentials === true ? [] : [{ venue: VENUE, credentialRef: 'cred:shadowsim-main@1' }],
    killSwitch: { switchId: killSwitch.switchId },
    audit: { emission: 'every_decision' },
    checkOrder: [...DEFAULT_CHECK_ORDER],
    learning: null,
    asOf: (T0 - 30_000) as never,
  });
  if (!result.ok) throw new Error(`the reference policy must validate: ${JSON.stringify(result.errors)}`);
  return result.value;
}

/**
 * The REFERENCE RISK POLICY — compiled from the reference constraint
 * set: crypto class caps (order 1 / order notional 60000 / position 2
 * / position notional 52000 — TIGHTER than the gate's 110000, the
 * divergence the risk-stage refusal fixture exercises), drawdown
 * 10000, leverage 1.5, NO concentration (a single-instrument paper
 * book would concentrate at 1.0 by construction).
 */
export function referenceRiskPolicy(): RiskPolicy {
  const compiled = compileRiskPolicy({
    constraintSet: {
      id: 'cs-shadow-reference',
      version: 1,
      tenantId: TENANT,
      name: 'shadow reference risk constraints',
      createdAt: (T0 - 40_000) as never,
      constraints: [
        { id: 'c-order-size-crypto', domain: 'action', subject: 'risk.order_size.crypto', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking', description: 'max single order size, crypto' },
        { id: 'c-order-notional-crypto', domain: 'action', subject: 'risk.order_notional.crypto', predicate: { kind: 'limit.max', bound: 60000 }, severity: 'blocking' },
        { id: 'c-position-size-crypto', domain: 'state', subject: 'risk.position_size.crypto', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' },
        { id: 'c-position-notional-crypto', domain: 'state', subject: 'risk.position_notional.crypto', predicate: { kind: 'limit.max', bound: 52000 }, severity: 'blocking', description: 'deliberately tighter than the gate cap — the risk-stage refusal divergence' },
        { id: 'c-drawdown', domain: 'state', subject: 'risk.drawdown', predicate: { kind: 'limit.max', bound: 10000 }, severity: 'blocking' },
        { id: 'c-leverage', domain: 'state', subject: 'risk.leverage', predicate: { kind: 'limit.max', bound: 1.5 }, severity: 'blocking' },
      ],
    },
    goal: { goalId: 'goal-shadow-1', version: 1 },
    tenant: TENANT as never,
    project: PROJECT as never,
    asOf: (T0 - 40_000) as never,
    ratioPrecision: 8,
  });
  if (!compiled.ok) throw new Error(`the reference risk policy must compile: ${JSON.stringify(compiled.errors)}`);
  return compiled.value;
}

/** The reference venue state (the gate's marks + rate counters). SOL is covered but NOT allowlisted. */
export function referenceVenueState(rateWindowOrderCount = 0): Record<string, unknown> {
  return deepFreeze({
    asOf: T0 as TimestampMs,
    instruments: [
      { venue: VENUE, instrument: BTC, instrumentClass: 'crypto', referencePrice: '50000.00', rateWindowOrderCount },
      { venue: VENUE, instrument: ETH, instrumentClass: 'crypto', referencePrice: '3000.00', rateWindowOrderCount },
      { venue: VENUE, instrument: 'SOL-USD', instrumentClass: 'crypto', referencePrice: '100.00', rateWindowOrderCount },
    ],
  });
}

/** The genesis portfolio: 100000 quote-currency cash, no positions. */
export function referenceGenesisPortfolio(): Record<string, unknown> {
  return deepFreeze({ positions: [], cash: '100000', realizedPnl: '0' });
}

/** The declared market events (the risk lane's point-in-time pricing facts). */
export function referenceMarketEvents(): readonly Record<string, unknown>[] {
  const trade = (eventId: string, instrument: string, price: string, available: number, sequence: number): Record<string, unknown> =>
    deepFreeze({
      event_id: eventId,
      venue: VENUE,
      instrument,
      asset_class: 'crypto',
      event_type: 'trade',
      event_time: (available - 50) as TimestampMs,
      source_time: null,
      available_time: available as TimestampMs,
      ingestion_time: (available + 100) as TimestampMs,
      sequence,
      provider: 'shadow-fixtures',
      provenance: { origin: 'historical', adapter: { id: 'shadow-fixtures', version: '1.0.0' }, derived_from: [], transform: null },
      payload: { price, size: '1', side: 'buy', trade_id: `tx-${eventId}` },
    });
  return [
    trade('me-btc-1', BTC, '50000.00', T0 + 25_000, 1),
    trade('me-eth-1', ETH, '3000.00', T0 + 59_000, 2),
    trade('me-btc-2', BTC, '95000.00', T0 + 60_500, 3),
    trade('me-btc-3', BTC, '50000.00', T0 + 89_500, 4),
  ];
}

/** The world spec the session starts its episode with (opaque to the session). */
export function referenceWorldSpec(): Record<string, unknown> {
  return deepFreeze({
    profile: {
      environment_id: 'env-shadow-fixture',
      fidelity: 'reactive_replay',
      clock: { now: T0, asOf: HORIZON, playbackSpeed: 1, paused: false, fidelity: 'reactive_replay', informationPolicy: 'point-in-time' },
      seed: SEED,
      venue_scope: [VENUE],
      instrument_scope: [BTC, ETH],
    },
    world: { world_id: 'world-shadow-fixture', kind: 'reactive' },
    information_policy: 'point-in-time',
  });
}

// ---------------------------------------------------------------------------
// The decision stream (the golden scenario)
// ---------------------------------------------------------------------------

/** The fixture ISO instant of T0. */
const ISO_T0 = '2023-11-14T22:13:20.000Z';

/** Build one reference-scoped strategy intent (the trading-strategy mirror). */
function intent(
  sequence: number,
  at: number,
  order: {
    readonly clientOrderId: string;
    readonly instrumentId: string;
    readonly side: 'buy' | 'sell';
    readonly kind: string;
    readonly quantity: string;
    readonly price?: string;
    readonly stopPrice?: string;
  },
  overrides: Record<string, unknown> = {},
): StrategyIntentMirror {
  const base = {
    intentId: `si:t030fx${String(sequence).padStart(4, '0')}`,
    sequence,
    order: {
      clientOrderId: order.clientOrderId,
      instrumentId: order.instrumentId,
      venueId: VENUE,
      side: order.side,
      kind: order.kind,
      quantity: order.quantity,
      ...(order.price !== undefined ? { price: order.price } : {}),
      ...(order.stopPrice !== undefined ? { stopPrice: order.stopPrice } : {}),
      timeInForce: 'gtc',
      createdAt: ISO_T0,
    },
    constraintProof: {
      constraintSet: { id: 'cs-shadow-reference', version: 1 },
      satisfied: [
        {
          constraintId: 'max-positions',
          domain: 'state',
          subject: 'state.positions',
          severity: 'blocking',
          predicate: { kind: 'limit.max', bound: 5 },
          observed: 0,
        },
      ],
      advisoryViolations: [],
    },
    goal: { goalId: 'goal-shadow-1', version: 1 },
    strategy: { specId: PRINCIPAL, version: 1 },
    windowRefs: ['win-shadow-1'],
    seed: SEED,
    tenant: TENANT,
    project: PROJECT,
    riskPolicyRefs: ['rpol:shadow-reference@1'],
    rationale: {
      kind: sequence === 1 ? 'initial_allocation' : 'rebalance_drift',
      instrumentId: order.instrumentId,
      targetWeight: '0.5',
      currentWeight: '0.25',
      drift: '0.25',
    },
    asOf: at,
  } as unknown as StrategyIntentMirror;
  return { ...base, ...overrides } as unknown as StrategyIntentMirror;
}

/** The golden decision stream (7 decisions: filled x3, risk-refused, filled, partial, expired). */
export function referenceIntentStream(): readonly StrategyIntentMirror[] {
  return [
    intent(1, T0 + 25_000, { clientOrderId: 't030-gold-1', instrumentId: BTC, side: 'buy', kind: 'limit', quantity: '0.75', price: '50100.00' }),
    intent(2, T0 + 26_000, { clientOrderId: 't030-gold-2', instrumentId: BTC, side: 'sell', kind: 'market', quantity: '0.2' }),
    intent(3, T0 + 60_000, { clientOrderId: 't030-gold-3', instrumentId: ETH, side: 'buy', kind: 'limit', quantity: '0.8', price: '3050.00' }),
    intent(4, T0 + 61_000, { clientOrderId: 't030-gold-4', instrumentId: BTC, side: 'buy', kind: 'limit', quantity: '0.1', price: '70500.00' }),
    intent(5, T0 + 90_000, { clientOrderId: 't030-gold-5', instrumentId: BTC, side: 'sell', kind: 'market', quantity: '0.3' }),
    intent(6, T0 + 120_000, { clientOrderId: 't030-gold-6', instrumentId: BTC, side: 'buy', kind: 'limit', quantity: '0.9', price: '56000.00' }),
    intent(7, T0 + 150_000, { clientOrderId: 't030-gold-7', instrumentId: BTC, side: 'buy', kind: 'limit', quantity: '0.1', price: '10000.00' }),
  ];
}

// --- The gate-refusal variants (each trips EXACTLY ONE dimension) ---------------

/** PATH 1 — identity fail: the intent comes from an undeclared principal. */
export function identityFailIntent(): StrategyIntentMirror {
  return intent(1, T0 + 25_000, { clientOrderId: 't030-identity-fail', instrumentId: BTC, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' }, { strategy: { specId: 'spec-intruder', version: 1 } });
}

/** PATH 2 — authorization fail: a stop order (no grant permits stop kinds). */
export function authorizationFailIntent(): StrategyIntentMirror {
  return intent(1, T0 + 25_000, { clientOrderId: 't030-auth-fail', instrumentId: BTC, side: 'sell', kind: 'stop', quantity: '0.5', stopPrice: '48000.00' });
}

/** PATH 3 — limits fail: a 1.5 BTC order breaches the crypto maxOrderSize of 1. */
export function limitFailIntent(): StrategyIntentMirror {
  return intent(1, T0 + 25_000, { clientOrderId: 't030-limit-fail', instrumentId: BTC, side: 'buy', kind: 'limit', quantity: '1.5', price: '50100.00' });
}

/** PATH 4 — venue permissions fail: SOL-USD is covered by the venue state but not allowlisted. */
export function venueFailIntent(): StrategyIntentMirror {
  return intent(1, T0 + 25_000, { clientOrderId: 't030-venue-fail', instrumentId: 'SOL-USD', side: 'buy', kind: 'limit', quantity: '0.5', price: '101.00' });
}

/** PATH 5 — rate limits fail: the venue's rate window is already at the budget. */
export function rateFailIntent(): StrategyIntentMirror {
  return intent(1, T0 + 25_000, { clientOrderId: 't030-rate-fail', instrumentId: BTC, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' });
}

/** PATH 6 — credentials fail: the policy variant binds no credential for the venue. */
export function credentialFailIntent(): StrategyIntentMirror {
  return intent(1, T0 + 25_000, { clientOrderId: 't030-credential-fail', instrumentId: BTC, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' });
}

/** A plain compliant intent (the kill-switch and tenant tests' substrate). */
export function compliantIntent(sequence = 1, at = T0 + 25_000): StrategyIntentMirror {
  return intent(sequence, at, { clientOrderId: `t030-compliant-${sequence}`, instrumentId: BTC, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' });
}

/** A cross-tenant intent (the L12 envelope fixture). */
export function crossTenantIntent(): StrategyIntentMirror {
  return intent(1, T0 + 25_000, { clientOrderId: 't030-cross-tenant', instrumentId: BTC, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' }, { tenant: 'tenant-omega', project: 'project-omega' });
}

// ---------------------------------------------------------------------------
// The session assembly + the golden scenario runner
// ---------------------------------------------------------------------------

/** An async iterator over a fixed array (the decision source). */
export function decisionSourceOf(intents: readonly unknown[]): AsyncIterator<unknown> {
  let index = 0;
  return {
    async next(): Promise<IteratorResult<unknown>> {
      if (index >= intents.length) return { done: true, value: undefined };
      const value = intents[index];
      index += 1;
      return { done: false, value };
    },
  };
}

/** Build the reference session over fresh ports (deterministic). */
export function createReferenceSession(options: {
  readonly intents?: readonly unknown[];
  readonly cursorFrom?: 'start' | 'tip';
  readonly venueState?: Record<string, unknown>;
  readonly executionPolicy?: ExecutionPolicy;
  readonly world?: ReactiveWorldPort;
  readonly timeMachine?: TimeMachinePort;
} = {}): ShadowResult<ShadowSession> {
  return createShadowSession({
    mode: 'shadow',
    tenant: TENANT,
    project: PROJECT,
    seed: SEED,
    participant: PARTICIPANT,
    world: options.world ?? createScriptedWorld(),
    worldSpec: referenceWorldSpec(),
    timeMachine: options.timeMachine ?? createScriptedMachine(),
    cursorFrom: options.cursorFrom ?? 'start',
    startAt: T0 as TimestampMs,
    executionPolicy: options.executionPolicy ?? referenceExecutionPolicy(),
    killSwitch: referenceKillSwitch(),
    risk: {
      policy: referenceRiskPolicy(),
      marketEvents: referenceMarketEvents(),
      quotePrecision: 8,
      priorPeakEquity: null,
    },
    genesisPortfolio: referenceGenesisPortfolio(),
    venueState: options.venueState ?? referenceVenueState(),
    decisionSource: decisionSourceOf(options.intents ?? referenceIntentStream()),
    lineage: {
      strategy: { specId: PRINCIPAL, version: 1 },
      goal: { goalId: 'goal-shadow-1', version: 1 },
      constraintSet: { id: 'cs-shadow-reference', version: 1 },
      windowId: 'win-shadow-1',
    },
  });
}

/** Run the golden scenario once (fresh ports; deterministic). */
export async function runReferenceScenario(): Promise<ShadowSession> {
  const session = unwrap(createReferenceSession());
  return unwrap(await runShadowSession(session));
}
