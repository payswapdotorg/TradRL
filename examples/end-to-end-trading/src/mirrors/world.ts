// @tradrl/example-e2e-trading — STRUCTURAL MIRRORS of the reactive market
// world (T027: services/market-world/src/reactive), the rolling time
// machine (T029: services/time-machine) and the shadow-trading lane
// (T030: services/shadow-trading).
//
// D-003/D-004 law: this module imports NOTHING outside the example tree.
// Reactive observations carry `origin: 'historical'` for stream events and
// `origin: 'simulated'` for engine outcomes (L5/L6); the L4 boundary is
// INCLUSIVE (`available_time <= now`); fill visibility obeys latency.

import { deepFreeze, isNonEmptyString, isRecord, isTimestampMs } from '../primitives';
import { decimalAt, decimalMultiply, decimalSubtract, decimalSum } from '../decimals';
import type { FillMirror } from './exchange';

// ---------------------------------------------------------------------------
// The reactive world (T027 mirror)
// ---------------------------------------------------------------------------

export type InterleavingPolicyMirror = {
  readonly kind: 'stream_first' | 'actions_first' | 'unrestricted';
};

export type ParticipantRoleMirror = 'candidate' | 'adversary' | 'co_participant';

export interface ParticipantDeclarationMirror {
  readonly instance: string;
  readonly role: ParticipantRoleMirror;
  readonly feed: string | null;
}

export interface ReactiveWorldConfigMirror {
  readonly world_id: string;
  readonly mode: 'reactive_replay'; // LITERAL — any other claim is dishonest (L5)
  readonly information_policy: 'point-in-time';
  readonly tenant: string;
  readonly project: string;
  readonly seed: string;
  readonly as_of: number;
  readonly streams: readonly { readonly venue: string; readonly instrument: string }[];
  readonly exchange: {
    readonly venue: string;
    readonly instrument: string;
    readonly tick_size: string;
    readonly lot_size: string;
  };
  readonly physics_refs: {
    readonly fee_policy: string;
    readonly latency_policy: string;
    readonly slippage_policy: string;
    readonly impact_policy: string;
  };
  readonly participants: readonly ParticipantDeclarationMirror[];
  readonly interleaving: InterleavingPolicyMirror;
  readonly playback_speed: number;
}

export interface PhysicsLineageMirror {
  readonly engine_config_hash: string;
  readonly fee_policy: string;
  readonly latency_policy: string;
  readonly slippage_policy: string;
  readonly impact_policy: string;
  readonly run_ref: string;
  readonly tenant: string;
  readonly project: string;
}

export interface ReactiveObservationMirror {
  readonly observation_id: string;
  readonly available_time: number;
  readonly venue: string | null;
  readonly instrument: string | null;
  readonly payload: unknown;
  readonly provenance: {
    readonly origin: 'historical' | 'simulated'; // engine outcomes are ALWAYS 'simulated' (L6)
    readonly source: string | null;
    readonly derived_from: readonly string[];
  };
  readonly run_ref: string;
  readonly tenant: string;
  readonly project: string;
}

export interface ReactiveFillRecordMirror {
  readonly fill: FillMirror;
  readonly fill_id: string;
  readonly episode_id: string;
  readonly run_ref: string;
  readonly taker_participant: string;
  readonly taker_order_id: string;
  readonly maker_order_id: string;
  readonly physics: PhysicsLineageMirror;
}

export interface WorldActionReceiptMirror {
  readonly receipt_id: string;
  readonly episode_id: string;
  readonly action_id: string;
  readonly actor: string;
  readonly client_sequence: number;
  readonly recorded_at: number;
  readonly disposition: 'engine_matched';
  readonly engine: {
    readonly kind: 'ack' | 'reject' | 'cancel';
    readonly order_id: string;
    readonly status: string;
    readonly reject_reason: string | null;
    readonly fill_ids: readonly string[];
  };
  readonly physics: PhysicsLineageMirror;
}

/** Guard: a reactive fill record (physics lineage REQUIRED — L6). */
export function isReactiveFillRecordMirror(v: unknown): v is ReactiveFillRecordMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.fill_id) &&
    isNonEmptyString(v.episode_id) &&
    isNonEmptyString(v.taker_participant) &&
    isRecord(v.fill) &&
    isRecord(v.physics) &&
    isNonEmptyString(v.physics.engine_config_hash)
  );
}

/** Fill visibility: available_time <= now (INCLUSIVE — the L4 boundary). */
export function fillIsVisibleMirror(fill: ReactiveFillRecordMirror, now: number): boolean {
  return fill.fill.quartet.available_time <= now;
}

// ---------------------------------------------------------------------------
// The time machine (T029 mirror)
// ---------------------------------------------------------------------------

export interface TimeMachineRecordMirror {
  readonly record_id: string;
  readonly tenant: string;
  readonly payload: unknown;
  readonly event_time: number;
  readonly source_time: number | null;
  readonly available_time: number;
  readonly ingestion_time: number;
  readonly inputs: readonly string[];
  readonly computation: unknown;
  readonly provenance: unknown;
  readonly arrival_sequence: number;
}

export interface FirewallDecisionMirror {
  readonly record_id: string;
  readonly decision: 'included' | 'excluded';
  readonly reason: 'visible' | 'not_yet_available' | 'tenant_boundary' | 'filtered_out';
  readonly available_time: number | null;
  readonly now: number;
}

export interface FirewallAuditMirror {
  readonly tenant: string;
  readonly at: number;
  readonly scanned: number;
  readonly decisions: readonly FirewallDecisionMirror[];
}

export interface AsOfViewMirror {
  readonly dataset: string;
  readonly at: number;
  readonly records: readonly TimeMachineRecordMirror[];
  readonly audit: FirewallAuditMirror;
}

/** The L4 admission law: available_time >= event_time, admission <= at. */
export function admitRecordMirror(
  record: TimeMachineRecordMirror,
  at: number,
  tenant: string,
): FirewallDecisionMirror {
  if (record.tenant !== tenant) {
    return { record_id: record.record_id, decision: 'excluded', reason: 'tenant_boundary', available_time: null, now: at };
  }
  if (record.available_time > at) {
    return { record_id: record.record_id, decision: 'excluded', reason: 'not_yet_available', available_time: record.available_time, now: at };
  }
  return { record_id: record.record_id, decision: 'included', reason: 'visible', available_time: record.available_time, now: at };
}

// ---------------------------------------------------------------------------
// The shadow lane (T030 mirror)
// ---------------------------------------------------------------------------

export type ShadowDisposition = 'filled' | 'refused' | 'partial' | 'expired';

export interface ShadowLineageMirror {
  readonly sessionId: string;
  readonly fidelity: { readonly mode: 'shadow'; readonly fill_origin: 'simulated' };
  readonly executionPolicy: { readonly policyId: string; readonly version: number };
  readonly riskPolicy: { readonly policyId: string; readonly version: number };
  readonly configDigests: {
    readonly worldConfigHash: string;
    readonly engineConfigHash: string;
    readonly dataset: string;
  };
  readonly run: { readonly runId: string; readonly episodeId: string };
  readonly cursor: { readonly cursorId: string; readonly position: number };
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

export interface ShadowFillMirror {
  readonly fillId: string; // 'swf-' + 8-digit ordinal
  readonly sequence: number;
  readonly worldFill: ReactiveFillRecordMirror;
  readonly decisionId: string;
  readonly intentRef: string;
  readonly availableAt: number;
  readonly appliedAt: number | null;
  readonly lineage: ShadowLineageMirror;
}

export interface ShadowPositionMirror {
  readonly venue: string;
  readonly instrument: string;
  readonly quantity: string;
  readonly costBasis: string;
  readonly openedAt: number;
}

export interface ShadowBookMirror {
  readonly positions: readonly ShadowPositionMirror[];
  readonly cash: string;
  readonly realizedPnl: string;
  readonly asOf: number;
}

export interface ShadowCostsMirror {
  readonly feeTotal: string;
  readonly notionalTotal: string;
}

export interface ShadowOutcomeRecordMirror {
  readonly outcomeId: string; // 'swo:' + 8-hex
  readonly ordinal: number;
  readonly intentRef: string;
  readonly decisionRef: string;
  readonly refusalRef: string | null;
  readonly disposition: ShadowDisposition;
  readonly fills: readonly string[]; // 'swf-' ids
  readonly costs: ShadowCostsMirror;
  readonly realizedOutcome: string;
  readonly unrealizedAtDecision: string;
  readonly priorChainHead: string;
  readonly lineage: ShadowLineageMirror;
  readonly asOf: number;
}

export const OUTCOME_CHAIN_SEED_MIRROR = '00000000';

export interface ShadowOutcomeLogMirror {
  readonly records: readonly ShadowOutcomeRecordMirror[];
  readonly head: string;
}

/** Applies one world fill to the shadow book (exact decimals; buys only in the slice). */
export function applyWorldFillMirror(
  book: ShadowBookMirror,
  fill: ReactiveFillRecordMirror,
  appliedAt: number,
): ShadowBookMirror {
  const instrument = fill.fill.instrument;
  const venue = fill.fill.venue;
  const price = fill.fill.aggressor_side === 'buy' ? fill.fill.aggressor_price : fill.fill.price;
  const quantity = fill.fill.quantity;
  const fee = fill.fill.taker_fee;
  const notional = decimalMultiply(quantity, price, 8, 'half-even');
  const existing = book.positions.find((position) => position.instrument === instrument);
  const positions =
    existing === undefined
      ? [...book.positions, { venue, instrument, quantity, costBasis: decimalAt(notional, 8, 'half-even'), openedAt: appliedAt }]
      : book.positions.map((position) =>
          position.instrument === instrument
            ? {
                ...position,
                quantity: decimalSum([position.quantity, quantity], 8, 'half-even'),
                costBasis: decimalSum([position.costBasis, notional], 8, 'half-even'),
              }
            : position,
        );
  return deepFreeze({
    positions,
    cash: decimalSubtract(book.cash, decimalSum([notional, fee], 8, 'half-even'), 8, 'half-even'),
    realizedPnl: book.realizedPnl,
    asOf: appliedAt,
  });
}

