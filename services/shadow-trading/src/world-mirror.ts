/**
 * @tradrl/shadow_trading — the REACTIVE WORLD PORT: the structural
 * mirror of T027's public surface that the shadow session consumes as
 * an INJECTED dependency.
 *
 * THE IMPORT LAW (the Work Order): the reactive world is READ-ONLY to
 * this lane and arrives ONLY through this port — the shadow lane never
 * imports `services/market-world`; `interop.test.ts` drives the REAL
 * `createReactiveWorldService` through this port (the T013
 * replay-adapter precedent) and is the drift trip wire.
 *
 * THE PHYSICS LINEAGE LAW (T027's, honored here): every fill the world
 * emits carries the engine's own fill record VERBATIM plus the
 * physics lineage block (engine config hash + fee/latency/slippage/
 * impact policy refs + run ref + tenant/project). A shadow fill whose
 * world fill lacks the lineage is the typed `physics_lineage_missing`
 * — the shadow book never accounts over a fill it cannot attribute.
 *
 * THE L4 FILL-VISIBILITY LAW: a fill's availability quartet gates when
 * the shadow book may observe it — `available_time <= now` (INCLUSIVE;
 * information latency, the engine's own declaration). {@link
 * fillIsVisible} is the gate; {@link admitWorldFill} is the typed
 * defense-in-depth trip wire.
 */

import { isNonEmptyString, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import { type ShadowResult, fail, ok } from './errors';

// (The JsonValue type is no longer needed at the port surface — the finish
// product is opaque to this lane; kept for the module's exported vocabulary.)
export type { JsonValue } from './primitives';

// ---------------------------------------------------------------------------
// The port result shapes (structural seams the REAL services satisfy)
// ---------------------------------------------------------------------------

/**
 * The world port's result shape — T027's `ReactiveResult` law-for-law
 * (the REAL service satisfies this structurally; failures carry the
 * service's own typed errors verbatim, lifted by the session as
 * `world_error`).
 */
export type WorldPortResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[] };

// ---------------------------------------------------------------------------
// The engine fill mirror (T010's Fill, via T027's ReactiveFillRecord.fill)
// ---------------------------------------------------------------------------

/** The availability quartet (the time-engine discipline, mirrored). */
export interface FillQuartetMirror {
  readonly event_time: TimestampMs;
  readonly source_time: null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
}

/** Guard: a quartet (source_time null; available >= event). */
export function isFillQuartetMirror(v: unknown): v is FillQuartetMirror {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.event_time) || !isTimestampMs(v.available_time) || !isTimestampMs(v.ingestion_time)) return false;
  if (v.source_time !== null) return false;
  return (v.available_time as number) >= (v.event_time as number);
}

/**
 * One engine fill (the exchange-sim `Fill`, mirrored): the trade print
 * price, the aggressor's post-slippage price, the executed quantity,
 * both fees, the injected latency, the engine's global fill ordinal
 * and the per-order identities.
 */
export interface EngineFillMirror {
  readonly fill_id: string;
  readonly trade_id: string;
  readonly venue: string;
  readonly instrument: string;
  readonly quartet: FillQuartetMirror;
  readonly sequence: number;
  readonly taker_order_id: string;
  readonly maker_order_id: string;
  /** The aggressor's side — the ACCOUNT's side (the engine emits 'buy' | 'sell'; typed at the guard). */
  readonly aggressor_side: string;
  readonly price: string;
  readonly aggressor_price: string;
  readonly quantity: string;
  readonly taker_fee: string;
  readonly maker_fee: string;
  readonly latency_ms: number;
}

/** The account side of an engine fill (the aggressor's side — the engine's closed vocabulary). */
export type FillSide = 'buy' | 'sell';

/** Read the account side off an engine fill (null when malformed — the guard already rejects those). */
export function fillSideOf(fill: EngineFillMirror): FillSide | null {
  return fill.aggressor_side === 'buy' || fill.aggressor_side === 'sell' ? fill.aggressor_side : null;
}

/** Guard: an engine fill (structural; the engine validated semantics). */
export function isEngineFillMirror(v: unknown): v is EngineFillMirror {
  if (!isRecord(v)) return false;
  for (const field of ['fill_id', 'trade_id', 'venue', 'instrument', 'taker_order_id', 'maker_order_id', 'price', 'aggressor_price', 'quantity', 'taker_fee', 'maker_fee'] as const) {
    if (!isNonEmptyString(v[field])) return false;
  }
  if (v.aggressor_side !== 'buy' && v.aggressor_side !== 'sell') return false;
  if (!isFillQuartetMirror(v.quartet)) return false;
  if (typeof v.sequence !== 'number' || !Number.isSafeInteger(v.sequence) || v.sequence < 1) return false;
  if (typeof v.latency_ms !== 'number' || !Number.isSafeInteger(v.latency_ms) || v.latency_ms < 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The physics lineage block (T027's law, mirrored field for field)
// ---------------------------------------------------------------------------

/** The full physics lineage of one engine-driven outcome. */
export interface WorldPhysicsLineageMirror {
  readonly engine_config_hash: string;
  readonly fee_policy: string;
  readonly latency_policy: string;
  readonly slippage_policy: string;
  readonly impact_policy: string;
  readonly run_ref: string;
  readonly tenant: string;
  readonly project: string;
}

/** Guard: a complete physics lineage block. */
export function isWorldPhysicsLineageMirror(v: unknown): v is WorldPhysicsLineageMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.engine_config_hash) &&
    isNonEmptyString(v.fee_policy) &&
    isNonEmptyString(v.latency_policy) &&
    isNonEmptyString(v.slippage_policy) &&
    isNonEmptyString(v.impact_policy) &&
    isNonEmptyString(v.run_ref) &&
    isNonEmptyString(v.tenant) &&
    isNonEmptyString(v.project)
  );
}

// ---------------------------------------------------------------------------
// The reactive fill record (T027's ReactiveFillRecord, mirrored)
// ---------------------------------------------------------------------------

/** One world fill: the engine's fill VERBATIM + the physics lineage + the episode/run binding. */
export interface ReactiveFillMirror {
  readonly fill: EngineFillMirror;
  readonly fill_id: string;
  readonly episode_id: string;
  readonly run_ref: string;
  readonly taker_participant: string;
  readonly taker_order_id: string;
  readonly maker_order_id: string;
  readonly physics: WorldPhysicsLineageMirror;
}

/**
 * The TOTAL world-fill guard — the physics-lineage law enforced. Fails
 * with the typed errors:
 *   - `physics_lineage_missing` — the engine fill or the lineage block
 *     is absent/incomplete;
 *   - `lineage_gap` — the run/episode/order binding is missing or
 *     disagrees with the lineage block.
 */
export function requireReactiveFillMirror(value: unknown): ShadowResult<ReactiveFillMirror> {
  if (!isRecord(value)) return fail('physics_lineage_missing', 'a world fill record must be an object');
  if (!isEngineFillMirror(value.fill)) {
    return fail('physics_lineage_missing', 'the record must carry the engine fill verbatim (the engine record ref IS the lineage anchor)');
  }
  if (!isWorldPhysicsLineageMirror(value.physics)) {
    return fail('physics_lineage_missing', 'the fill carries no complete physics lineage block — every engine-driven fill carries its full physics lineage (engine config hash + fee/latency/slippage/impact policy refs)');
  }
  for (const field of ['fill_id', 'episode_id', 'run_ref', 'taker_participant', 'taker_order_id', 'maker_order_id'] as const) {
    if (!isNonEmptyString(value[field])) {
      return fail('lineage_gap', `the world fill lacks its ${field.replace(/_/g, ' ')} — engine record refs are lineage (L9)`);
    }
  }
  if (value.physics.run_ref !== value.run_ref) {
    return fail('lineage_gap', 'the physics lineage run ref disagrees with the record run ref');
  }
  if (value.fill.fill_id !== value.fill_id) {
    return fail('lineage_gap', 'the record fill id disagrees with the engine fill id (forensic completeness)');
  }
  return ok(value as unknown as ReactiveFillMirror);
}

/** Cheap structural guard (use {@link requireReactiveFillMirror} for the typed law). */
export function isReactiveFillMirror(value: unknown): value is ReactiveFillMirror {
  return requireReactiveFillMirror(value).ok;
}

// ---------------------------------------------------------------------------
// Fill visibility (the latency window — the L4 gate over fills)
// ---------------------------------------------------------------------------

/**
 * The fill-visibility law: a fill may enter the shadow book's
 * knowledge ONLY when `available_time <= now` (INCLUSIVE — visible
 * exactly at the availability instant, never one millisecond earlier).
 * The engine's `latency_ms` is information latency; the quartet's
 * `available_time` is the boundary input.
 */
export function fillIsVisible(fill: EngineFillMirror, now: TimestampMs): boolean {
  return (fill.quartet.available_time as number) <= (now as number);
}

/**
 * The typed defense-in-depth gate: admit one world fill into the
 * shadow book's knowledge at instant `now`. A fill whose
 * `available_time` exceeds `now` fails `l4_boundary_violation` —
 * never a silent filter, never a leak.
 */
export function admitWorldFill(fill: ReactiveFillMirror, now: TimestampMs): ShadowResult<ReactiveFillMirror> {
  if (!fillIsVisible(fill.fill, now)) {
    return fail(
      'l4_boundary_violation',
      `fill ${fill.fill_id} becomes available at ${String(fill.fill.quartet.available_time)}, after the query instant ${String(now)} — a fill is never visible before its latency window elapses (L4)`,
    );
  }
  return ok(fill);
}

// ---------------------------------------------------------------------------
// The episode view + receipt mirrors (T027's service products)
// ---------------------------------------------------------------------------

/** The world's episode view (the subset the shadow driver reads). */
export interface ReactiveWorldViewMirror {
  readonly episode_id: string;
  readonly clock: { readonly now: TimestampMs; readonly asOf: TimestampMs };
  readonly status: string;
  readonly settled: boolean;
  readonly pending_stream_events: number;
  readonly pending_scripted_actions: number;
}

/** Guard: an episode view. */
export function isReactiveWorldViewMirror(v: unknown): v is ReactiveWorldViewMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.episode_id)) return false;
  if (!isRecord(v.clock) || !isTimestampMs(v.clock.now) || !isTimestampMs(v.clock.asOf)) return false;
  if (typeof v.status !== 'string') return false;
  if (typeof v.settled !== 'boolean') return false;
  if (typeof v.pending_stream_events !== 'number' || typeof v.pending_scripted_actions !== 'number') return false;
  return true;
}

/** The engine intake outcome summary riding the receipt. */
export interface WorldReceiptEngineMirror {
  readonly kind: 'ack' | 'reject' | 'cancel';
  readonly order_id: string;
  readonly status: string;
  readonly reject_reason: string | null;
  readonly fill_ids: readonly string[];
}

/** One processed action's receipt (T027's ActionReceipt, mirrored). */
export interface WorldActionReceiptMirror {
  readonly receipt_id: string;
  readonly episode_id: string;
  readonly action_id: string;
  readonly actor: string;
  readonly client_sequence: number;
  readonly recorded_at: TimestampMs;
  readonly disposition: string;
  readonly engine: WorldReceiptEngineMirror;
  readonly physics: WorldPhysicsLineageMirror;
}

/** Guard: a receipt. */
export function isWorldActionReceiptMirror(v: unknown): v is WorldActionReceiptMirror {
  if (!isRecord(v)) return false;
  for (const field of ['receipt_id', 'episode_id', 'action_id', 'actor', 'disposition'] as const) {
    if (!isNonEmptyString(v[field])) return false;
  }
  if (typeof v.client_sequence !== 'number' || !Number.isSafeInteger(v.client_sequence) || v.client_sequence < 0) return false;
  if (!isTimestampMs(v.recorded_at)) return false;
  if (!isRecord(v.engine)) return false;
  if (v.engine.kind !== 'ack' && v.engine.kind !== 'reject' && v.engine.kind !== 'cancel') return false;
  if (!isNonEmptyString(v.engine.order_id) || typeof v.engine.status !== 'string') return false;
  if (v.engine.reject_reason !== null && !isNonEmptyString(v.engine.reject_reason)) return false;
  if (!Array.isArray(v.engine.fill_ids) || !v.engine.fill_ids.every((x) => isNonEmptyString(x))) return false;
  if (!isWorldPhysicsLineageMirror(v.physics)) return false;
  return true;
}

/** The submit product: the new view PLUS the typed receipt. */
export interface ReactiveWorldSubmissionMirror {
  readonly episode_id: string;
  readonly clock: { readonly now: TimestampMs; readonly asOf: TimestampMs };
  readonly status: string;
  readonly settled: boolean;
  readonly pending_stream_events: number;
  readonly pending_scripted_actions: number;
  readonly receipt: WorldActionReceiptMirror;
}

/** Guard: a submission. */
export function isReactiveWorldSubmissionMirror(v: unknown): v is ReactiveWorldSubmissionMirror {
  if (!isReactiveWorldViewMirror(v)) return false;
  return isWorldActionReceiptMirror((v as unknown as Record<string, unknown>).receipt);
}

// ---------------------------------------------------------------------------
// The injected port (the structural seam)
// ---------------------------------------------------------------------------

/**
 * The reactive world port: the structural mirror of T027's
 * `ReactiveWorldService` surface the shadow session drives. The REAL
 * service satisfies this port field-for-field (interop-proven); the
 * session never imports the service — it receives it.
 */
export interface ReactiveWorldPort {
  /** The world config's deterministic digest (L9 lineage). */
  readonly config_hash: string;
  /** The run id (binds config + stream — L9 lineage). */
  readonly run_id: string;
  /** The engine physics digest (the REAL engine's configHash — L6/L9 lineage). */
  readonly engine_config_hash: string;
  /** All registered episode ids, in registration order. */
  readonly episodes: readonly string[];

  /** Start an episode over an environment spec (the session's spec input). */
  start(spec: unknown): WorldPortResult<ReactiveWorldViewMirror>;
  /** Advance one boundary toward `to` (the driver loops until `settled`). */
  advance(episode: string, to: TimestampMs): WorldPortResult<ReactiveWorldViewMirror>;
  /** Submit one action envelope at the episode's current instant. */
  submit(episode: string, action: unknown): WorldPortResult<ReactiveWorldSubmissionMirror>;
  /** The full fill log (each record with its physics lineage). */
  fills(episode: string): WorldPortResult<readonly ReactiveFillMirror[]>;
  /** Finish the episode (terminal state; the finish product is opaque to this lane). */
  finish(episode: string, reason: unknown): WorldPortResult<unknown>;
  /** The L9 run record of a finished episode (digest + lineage). */
  runRecord(episode: string): WorldPortResult<{ readonly digest: string }>;
}

/**
 * Guard: a reactive world port (the structural seam). The REAL
 * `ReactiveWorldService` passes this guard — the interop trip wire
 * proves it; a mock that drifts from the surface fails here.
 */
export function isReactiveWorldPort(v: unknown): v is ReactiveWorldPort {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.config_hash) || !isNonEmptyString(v.run_id) || !isNonEmptyString(v.engine_config_hash)) return false;
  if (!Array.isArray(v.episodes)) return false;
  for (const field of ['start', 'advance', 'submit', 'fills', 'finish', 'runRecord'] as const) {
    if (typeof (v as Record<string, unknown>)[field] !== 'function') return false;
  }
  return true;
}
