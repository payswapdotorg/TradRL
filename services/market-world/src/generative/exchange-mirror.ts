/**
 * @tradrl/market-world (generative service) — STRUCTURAL MIRRORS of
 * @tradrl/exchange-sim (T010): the execution-physics core this world
 * DRIVES (work order T028).
 *
 * THE LAW THIS MODULE SERVES: "No imports across lanes:
 * exchange-sim/environment-protocol/market-world contract/time-engine
 * shapes are STRUCTURAL MIRRORS; interop trip-wire tests prove the mirrors
 * against the real packages on your branch." The generative lane therefore
 * re-declares every exchange-sim shape it touches — the physics
 * configuration (venue grids, fees, latency, slippage, impact), the order
 * intent, the engine's output records (acks/rejects/fills/cancels), the
 * engine state and the transition outcomes — field-for-field, with
 * IDENTICAL field names (plain strings, no brand friction) so the REAL
 * engine's values assign to these mirrors without casts.
 *
 * THE ENGINE IS INJECTED, NEVER IMPORTED (the generative difference,
 * driven honestly): the matching engine is a PURE REDUCER owned by T010;
 * this world drives it through the {@link EngineDriver} port — the
 * structural mirror of `createEngine` / `submitOrder` / `cancelOrder` /
 * `advanceEngine`. The service constructor receives the driver as a
 * declared input; the reference binding (the REAL exchange-sim functions)
 * is supplied by consumers and by the interop trip-wire tests, which prove
 * that the real functions satisfy the port structurally and that a full
 * episode driven through the REAL engine is byte-identical across runs.
 * THE GENERATIVE DIFFERENCE IS PRESERVED: the GENERATED population's
 * intents and the candidate organization's intents are SUBMITTED to the
 * engine (fills, fees, latency, slippage — full physics), never merely
 * recorded.
 *
 * L6 (microstructure fidelity): the engine's physics declarations are
 * carried verbatim into this lane's configs and lineage — nothing silently
 * approximated. The impact policy kind `'none'` is the engine's only
 * implementable kind (its fail-close rule); richer endogenous reaction is
 * composed AROUND the engine (T010's extension contract) and is NOT
 * smuggled into it — the DECLARED STOCHASTIC PROCESSES of process.ts are
 * exactly that composition.
 */

import { canonicalJson, deepFreeze, isNonEmptyString, isNonNegativeSafeInteger, isPositiveSafeInteger, isRecord } from './primitives';
import { fnv1a32Hex } from './primitives';
import type { JsonValue } from './primitives';
import { isJsonValue } from './primitives';
import { invalidField, invalidType, missingField, ok, type GenerativeError, type GenerativeResult } from './errors';
import { isTimestampMs, type TimestampMs } from './ids';

// ---------------------------------------------------------------------------
// Decimal grammar mirrors (canonical owner: exchange-sim decimals.ts)
// ---------------------------------------------------------------------------

/** Canonical decimal grammar: no leading zeros, no sign, no trailing ".0" gaps (mirror). */
export function isCanonicalDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(value);
}

/** Is the canonical decimal exactly zero ("0" or "0.00...")? (mirror) */
function isZeroDecimal(value: string): boolean {
  return /^0(?:\.0+)?$/.test(value);
}

/** Canonical grammar AND strictly positive (mirror of exchange-sim's isCanonicalPositiveDecimal). */
export function isCanonicalPositiveDecimal(value: unknown): value is string {
  return isCanonicalDecimal(value) && !isZeroDecimal(value);
}

/** Unsigned decimal grammar (mirror). */
export function isUnsignedDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value);
}

// ---------------------------------------------------------------------------
// The fidelity vocabulary of an exchange simulator (mirror of T010 config)
// ---------------------------------------------------------------------------

/**
 * The two L5 modes an exchange simulator serves (mirror of exchange-sim's
 * `ExchangeFidelity`): exact replay records intents and NEVER matches
 * (T009), so it is not an engine mode. THIS lane further narrows the world
 * config to `'generative'` (config.ts enforces the honesty — the modes
 * must agree, L5).
 */
export type ExchangeFidelity = 'reactive_replay' | 'generative';

/** Runtime-checkable list (mirror). */
export const EXCHANGE_FIDELITY_MODES: readonly ExchangeFidelity[] = ['reactive_replay', 'generative'];

/** Runtime guard (mirror). */
export function isExchangeFidelity(value: unknown): value is ExchangeFidelity {
  return typeof value === 'string' && (EXCHANGE_FIDELITY_MODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The physics models (mirrors of T010 fees/latency/slippage/impact)
// ---------------------------------------------------------------------------

/** One fee tier (mirror of exchange-sim's FeeTier). */
export interface FeeTierMirror {
  /** Inclusive upper bound of fill notional, or null for the catch-all top tier. */
  readonly up_to_notional: string | null;
  readonly maker_bps: string;
  readonly taker_bps: string;
}

/** The fee schedule (mirror of exchange-sim's FeeSchedule). */
export interface FeeScheduleMirror {
  readonly tiers: readonly FeeTierMirror[];
  /** The number of fractional digits fees are rounded to (half-up). */
  readonly fee_decimals: number;
}

/** Guard: a fee tier (mirror). */
function isFeeTier(value: unknown): value is FeeTierMirror {
  if (!isRecord(value)) return false;
  if (value.up_to_notional !== null && !isUnsignedDecimal(value.up_to_notional)) return false;
  if (typeof value.maker_bps !== 'string' || !isUnsignedDecimal(value.maker_bps)) return false;
  if (typeof value.taker_bps !== 'string' || !isUnsignedDecimal(value.taker_bps)) return false;
  return true;
}

/** Guard: a fee schedule (mirror — tiers strictly increasing, last is the null catch-all). */
export function isFeeSchedule(value: unknown): value is FeeScheduleMirror {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.tiers) || value.tiers.length === 0) return false;
  if (!(value.tiers as readonly unknown[]).every((tier) => isFeeTier(tier))) return false;
  const tiers = value.tiers as readonly FeeTierMirror[];
  let previousBound: number | null = null;
  for (let index = 0; index < tiers.length; index++) {
    const tier = tiers[index] as FeeTierMirror;
    if (index < tiers.length - 1 && tier.up_to_notional === null) return false;
    if (index === tiers.length - 1 && tier.up_to_notional !== null) return false;
    if (tier.up_to_notional !== null) {
      const bound = Number(tier.up_to_notional);
      if (previousBound !== null && bound <= previousBound) return false;
      previousBound = bound;
    }
  }
  if (!isNonNegativeSafeInteger(value.fee_decimals)) return false;
  return true;
}

/** The latency model (mirror of exchange-sim's LatencyConfig). */
export type LatencyConfigMirror =
  | { readonly kind: 'fixed'; readonly fixed_ms: number }
  | { readonly kind: 'uniform'; readonly min_ms: number; readonly max_ms: number };

/** Guard: a latency config (mirror). */
export function isLatencyConfig(value: unknown): value is LatencyConfigMirror {
  if (!isRecord(value)) return false;
  if (value.kind === 'fixed') {
    return typeof value.fixed_ms === 'number' && Number.isSafeInteger(value.fixed_ms) && value.fixed_ms >= 0;
  }
  if (value.kind === 'uniform') {
    return (
      typeof value.min_ms === 'number' &&
      Number.isSafeInteger(value.min_ms) &&
      value.min_ms >= 0 &&
      typeof value.max_ms === 'number' &&
      Number.isSafeInteger(value.max_ms) &&
      value.max_ms >= value.min_ms
    );
  }
  return false;
}

/** The slippage model (mirror of exchange-sim's SlippageConfig). */
export type SlippageConfigMirror = { readonly kind: 'book_walk' } | { readonly kind: 'fixed_bps'; readonly bps: string };

/** Guard: a slippage config (mirror). */
export function isSlippageConfig(value: unknown): value is SlippageConfigMirror {
  if (!isRecord(value)) return false;
  if (value.kind === 'book_walk') return true;
  if (value.kind === 'fixed_bps') {
    return typeof value.bps === 'string' && isUnsignedDecimal(value.bps) && !isZeroDecimal(value.bps);
  }
  return false;
}

/**
 * The market-impact policy (mirror of exchange-sim's MarketImpactPolicy —
 * the OPEN, data-only record). The engine implements exactly one kind,
 * `'none'`; every other kind fails ITS config validation (fail-closed).
 * This lane carries the policy verbatim and binds its ref into every
 * fill's physics lineage. THE GENERATIVE NOTE (L6): endogenous market
 * reaction beyond the book walk is provided by the DECLARED STOCHASTIC
 * PROCESSES (process.ts) composing AROUND the engine — exactly the
 * extension contract T010 declares.
 */
export interface MarketImpactPolicyMirror {
  readonly kind: string;
  readonly declaration: string;
  readonly limitation: string;
}

/** Guard: a market-impact policy record (mirror). */
export function isMarketImpactPolicy(value: unknown): value is MarketImpactPolicyMirror {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.kind) && isNonEmptyString(value.declaration) && isNonEmptyString(value.limitation);
}

// ---------------------------------------------------------------------------
// The exchange physics configuration (mirror of T010's ExchangeConfig)
// ---------------------------------------------------------------------------

/**
 * The fully-determining exchange configuration (STRUCTURAL MIRROR of
 * exchange-sim's `ExchangeConfig`, identical field names): venue identity,
 * grid rules, seed, the three execution models and the impact policy. The
 * REAL engine validates this value again at `createEngine` — this lane's
 * validation is the fail-early mirror of the same law.
 */
export interface ExchangePhysicsMirror {
  readonly venue: string;
  readonly instrument: string;
  readonly asset_class: string;
  readonly tick_size: string;
  readonly lot_size: string;
  readonly max_book_depth: number;
  readonly seed: string;
  readonly fidelity: ExchangeFidelity;
  readonly fees: FeeScheduleMirror;
  readonly latency: LatencyConfigMirror;
  readonly slippage: SlippageConfigMirror;
  readonly impact: MarketImpactPolicyMirror;
}

/** The market-protocol asset classes (mirror of the envelope taxonomy). */
export const ASSET_CLASSES: readonly string[] = ['crypto', 'equity', 'index', 'future', 'option', 'forex', 'commodity', 'macro', 'other'];

/** Guard: a canonical market asset class (mirror). */
export function isAssetClassOfMarket(value: unknown): value is string {
  return typeof value === 'string' && ASSET_CLASSES.includes(value);
}

/**
 * Collect-all validation of the exchange physics configuration (mirror of
 * exchange-sim's `validateExchangeConfig`, the impact fail-close rule
 * included: only `'none'` is engine-implementable). On success the value
 * is returned narrowed, deeply frozen.
 */
export function validateExchangePhysics(value: unknown, path = 'config.exchange'): GenerativeResult<ExchangePhysicsMirror> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path}`, `${path} must be an object`)] };
  }
  const errors: GenerativeError[] = [];

  if (value.venue === undefined) {
    errors.push(missingField(`${path}.venue`));
  } else if (!isNonEmptyString(value.venue)) {
    errors.push(invalidField(`${path}.venue`, 'must be a non-empty string'));
  }

  if (value.instrument === undefined) {
    errors.push(missingField(`${path}.instrument`));
  } else if (!isNonEmptyString(value.instrument)) {
    errors.push(invalidField(`${path}.instrument`, 'must be a non-empty string'));
  }

  if (value.asset_class === undefined) {
    errors.push(missingField(`${path}.asset_class`));
  } else if (!isAssetClassOfMarket(value.asset_class)) {
    errors.push(invalidField(`${path}.asset_class`, 'must be a canonical market-protocol asset class'));
  }

  if (value.tick_size === undefined) {
    errors.push(missingField(`${path}.tick_size`));
  } else if (!isCanonicalPositiveDecimal(value.tick_size)) {
    errors.push(invalidField(`${path}.tick_size`, 'must be a canonical decimal string greater than zero (e.g. "0.01")'));
  }

  if (value.lot_size === undefined) {
    errors.push(missingField(`${path}.lot_size`));
  } else if (!isCanonicalPositiveDecimal(value.lot_size)) {
    errors.push(invalidField(`${path}.lot_size`, 'must be a canonical decimal string greater than zero (e.g. "0.001")'));
  }

  if (value.max_book_depth === undefined) {
    errors.push(missingField(`${path}.max_book_depth`));
  } else if (!isPositiveSafeInteger(value.max_book_depth)) {
    errors.push(invalidField(`${path}.max_book_depth`, 'must be a positive safe integer'));
  }

  if (value.seed === undefined) {
    errors.push(missingField(`${path}.seed`));
  } else if (!isNonEmptyString(value.seed)) {
    errors.push(invalidField(`${path}.seed`, 'must be a non-empty string'));
  }

  if (value.fidelity === undefined) {
    errors.push(missingField(`${path}.fidelity`));
  } else if (value.fidelity === 'exact_replay') {
    // L5 (mirror of the engine's own law): exact replay records intents and
    // never matches — an exchange simulator serves reactive_replay/generative.
    errors.push({
      code: 'fidelity_claim_dishonest',
      path: `${path}.fidelity`,
      message: "exact_replay records orders as intents and never matches them (T009) — an exchange simulator serves reactive_replay or generative",
    });
  } else if (!isExchangeFidelity(value.fidelity)) {
    errors.push(invalidField(`${path}.fidelity`, `must be one of ${EXCHANGE_FIDELITY_MODES.join(' | ')}`));
  }

  let fees: FeeScheduleMirror | undefined;
  if (value.fees === undefined) {
    errors.push(missingField(`${path}.fees`));
  } else if (!isFeeSchedule(value.fees)) {
    errors.push(invalidField(`${path}.fees`, 'must be a fee schedule: non-empty ordered tiers with a null catch-all last tier and a fee_decimals count'));
  } else {
    fees = value.fees;
  }

  let latency: LatencyConfigMirror | undefined;
  if (value.latency === undefined) {
    errors.push(missingField(`${path}.latency`));
  } else if (!isLatencyConfig(value.latency)) {
    errors.push(invalidField(`${path}.latency`, 'must be a latency config: { kind: "fixed", fixed_ms } or { kind: "uniform", min_ms <= max_ms }'));
  } else {
    latency = value.latency;
  }

  let slippage: SlippageConfigMirror | undefined;
  if (value.slippage === undefined) {
    errors.push(missingField(`${path}.slippage`));
  } else if (!isSlippageConfig(value.slippage)) {
    errors.push(invalidField(`${path}.slippage`, 'must be a slippage config: { kind: "book_walk" } or { kind: "fixed_bps", bps > 0 }'));
  } else {
    slippage = value.slippage;
  }

  let impact: MarketImpactPolicyMirror | undefined;
  if (value.impact === undefined) {
    errors.push(missingField(`${path}.impact`));
  } else if (!isMarketImpactPolicy(value.impact)) {
    errors.push(invalidField(`${path}.impact`, 'must be a market-impact policy record (kind, declaration, limitation)'));
  } else if (value.impact.kind !== 'none') {
    // The engine fail-closes on any impact kind other than 'none' (T010's
    // law); this lane mirrors the fail-close rather than guessing semantics.
    errors.push({
      code: 'invalid_field',
      path: `${path}.impact.kind`,
      message: `impact kind "${value.impact.kind}" is not implemented by the exchange engine (only 'none') — endogenous reaction is composed AROUND the engine by declared processes (T010's extension contract), never inside it`,
    });
  } else {
    impact = value.impact;
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      venue: value.venue as string,
      instrument: value.instrument as string,
      asset_class: value.asset_class as string,
      tick_size: value.tick_size as string,
      lot_size: value.lot_size as string,
      max_book_depth: value.max_book_depth as number,
      seed: value.seed as string,
      fidelity: value.fidelity as ExchangeFidelity,
      fees: fees as FeeScheduleMirror,
      latency: latency as LatencyConfigMirror,
      slippage: slippage as SlippageConfigMirror,
      impact: deepFreeze({ ...(impact as MarketImpactPolicyMirror) }),
    }),
  );
}

/**
 * Canonical JSON of the physics configuration (mirror of exchange-sim's
 * `canonicalConfigJson` — the field-by-field JSON tree, so equal configs
 * produce byte-identical bytes and the hash below matches the REAL
 * engine's config hash; interop-tested).
 */
export function canonicalPhysicsJson(physics: ExchangePhysicsMirror): string {
  const tree: JsonValue = {
    venue: physics.venue,
    instrument: physics.instrument,
    asset_class: physics.asset_class,
    tick_size: physics.tick_size,
    lot_size: physics.lot_size,
    max_book_depth: physics.max_book_depth,
    seed: physics.seed,
    fidelity: physics.fidelity,
    fees: {
      tiers: physics.fees.tiers.map((tier) => ({
        up_to_notional: tier.up_to_notional,
        maker_bps: tier.maker_bps,
        taker_bps: tier.taker_bps,
      })),
      fee_decimals: physics.fees.fee_decimals,
    },
    latency: physics.latency.kind === 'fixed'
      ? { kind: 'fixed', fixed_ms: physics.latency.fixed_ms }
      : { kind: 'uniform', min_ms: physics.latency.min_ms, max_ms: physics.latency.max_ms },
    slippage: physics.slippage.kind === 'book_walk' ? { kind: 'book_walk' } : { kind: 'fixed_bps', bps: physics.slippage.bps },
    impact: {
      kind: physics.impact.kind,
      declaration: physics.impact.declaration,
      limitation: physics.impact.limitation,
    },
  };
  return canonicalJson(tree);
}

/**
 * The deterministic digest of the physics configuration — MUST equal the
 * REAL exchange-sim `configHash` for the same config (interop-tested); it
 * is the `engine_config_hash` bound into every generative fill's physics
 * lineage (L9).
 */
export function physicsHash(physics: ExchangePhysicsMirror): string {
  return fnv1a32Hex(canonicalPhysicsJson(physics));
}

// ---------------------------------------------------------------------------
// The order intent (mirror of T010's OrderIntent — the domain-core Order)
// ---------------------------------------------------------------------------

/**
 * The order intent (STRUCTURAL MIRROR of exchange-sim's `OrderIntent`,
 * itself the domain-core `Order` mirror): plain strings, identical field
 * names. THIS lane validates only the payload envelope; the ENGINE is the
 * authority on intent validity (the T010 service pattern — validation is
 * not duplicated, it is delegated to the owner).
 */
export interface OrderIntentMirror {
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venueId: string;
  readonly side: string;
  readonly kind: string;
  readonly quantity: string;
  readonly price?: string;
  readonly stopPrice?: string;
  readonly timeInForce: string;
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// The engine's output records (mirrors of T010 records.ts)
// ---------------------------------------------------------------------------

/** The availability quartet (mirror). `available >= event` is the L4 input. */
export interface AvailabilityQuartetMirror {
  readonly event_time: TimestampMs;
  readonly source_time: null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
}

/** Guard: a quartet (mirror — source_time null, available >= event). */
export function isAvailabilityQuartet(value: unknown): value is AvailabilityQuartetMirror {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.event_time) || !isTimestampMs(value.available_time) || !isTimestampMs(value.ingestion_time)) return false;
  if (value.source_time !== null) return false;
  return (value.available_time as number) >= (value.event_time as number);
}

/** One executed fill (STRUCTURAL MIRROR of exchange-sim's `Fill` — plain strings). */
export interface FillMirror {
  readonly fill_id: string;
  readonly trade_id: string;
  readonly venue: string;
  readonly instrument: string;
  readonly quartet: AvailabilityQuartetMirror;
  readonly sequence: number;
  readonly taker_order_id: string;
  readonly maker_order_id: string;
  readonly aggressor_side: string;
  readonly price: string;
  readonly aggressor_price: string;
  readonly quantity: string;
  readonly taker_fee: string;
  readonly maker_fee: string;
  readonly latency_ms: number;
}

/** Guard: a fill-shaped record (structural; the engine validated the semantics). */
export function isFillMirror(value: unknown): value is FillMirror {
  if (!isRecord(value)) return false;
  for (const field of ['fill_id', 'trade_id', 'venue', 'instrument', 'taker_order_id', 'maker_order_id', 'aggressor_side', 'price', 'aggressor_price', 'quantity', 'taker_fee', 'maker_fee'] as const) {
    if (!isNonEmptyString(value[field])) return false;
  }
  if (!isAvailabilityQuartet(value.quartet)) return false;
  if (!isNonNegativeSafeInteger(value.sequence)) return false;
  if (typeof value.latency_ms !== 'number' || !Number.isSafeInteger(value.latency_ms) || value.latency_ms < 0) return false;
  return true;
}

/** An order ack (mirror). */
export interface OrderAckMirror {
  readonly order_id: string;
  readonly client_order_id: string;
  readonly quartet: AvailabilityQuartetMirror;
  readonly status: string;
  readonly filled_quantity: string;
}

/** An order reject (mirror). */
export interface OrderRejectMirror {
  readonly order_id: string;
  readonly client_order_id: string;
  readonly quartet: AvailabilityQuartetMirror;
  readonly reason: string;
  readonly detail: string;
}

/** A cancel/expiry record (mirror). */
export interface OrderCancelMirror {
  readonly order_id: string;
  readonly client_order_id: string;
  readonly quartet: AvailabilityQuartetMirror;
  readonly reason: string;
  readonly remaining_quantity: string;
}

/** Guard: ack-shaped (structural). */
export function isOrderAckMirror(value: unknown): value is OrderAckMirror {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.order_id) && isNonEmptyString(value.client_order_id) && isAvailabilityQuartet(value.quartet) && isNonEmptyString(value.status) && typeof value.filled_quantity === 'string';
}

/** Guard: reject-shaped (structural). */
export function isOrderRejectMirror(value: unknown): value is OrderRejectMirror {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.order_id) && isNonEmptyString(value.client_order_id) && isAvailabilityQuartet(value.quartet) && isNonEmptyString(value.reason) && isNonEmptyString(value.detail);
}

/** Guard: cancel-shaped (structural). */
export function isOrderCancelMirror(value: unknown): value is OrderCancelMirror {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.order_id) && isNonEmptyString(value.client_order_id) && isAvailabilityQuartet(value.quartet) && isNonEmptyString(value.reason) && typeof value.remaining_quantity === 'string';
}

// ---------------------------------------------------------------------------
// The engine state + transition outcomes (mirrors of T010 engine.ts)
// ---------------------------------------------------------------------------

/** One resting order in a level queue (mirror). */
export interface RestingOrderMirror {
  readonly order_id: string;
  readonly remaining: string;
}

/** One resting price level (mirror). */
export interface RestingLevelMirror {
  readonly price: string;
  readonly orders: readonly RestingOrderMirror[];
}

/** The order book (mirror — bids descending, asks ascending, by the engine's invariant). */
export interface BookStateMirror {
  readonly bids: readonly RestingLevelMirror[];
  readonly asks: readonly RestingLevelMirror[];
}

/** The immutable engine state (STRUCTURAL MIRROR of exchange-sim's `EngineState`). */
export interface EngineStateMirror {
  readonly config: ExchangePhysicsMirror;
  readonly now: TimestampMs;
  readonly next_order_ordinal: number;
  readonly next_fill_ordinal: number;
  readonly book: BookStateMirror;
  readonly orders: readonly unknown[];
  readonly fills: readonly FillMirror[];
  readonly last_trade_price: string | null;
}

/**
 * The product of one order submission (mirror of exchange-sim's
 * `SubmitOutcome`).
 */
export interface SubmitOutcomeMirror {
  readonly state: EngineStateMirror;
  readonly ack: OrderAckMirror | OrderRejectMirror;
  readonly fills: readonly FillMirror[];
  readonly cancels: readonly OrderCancelMirror[];
  readonly top_of_book_changed: boolean;
}

/** The product of one cancel request (mirror). */
export interface CancelOutcomeMirror {
  readonly state: EngineStateMirror;
  readonly cancel: OrderCancelMirror;
}

/** The product of one clock advance (mirror). */
export interface AdvanceOutcomeMirror {
  readonly state: EngineStateMirror;
  readonly expirations: readonly OrderCancelMirror[];
}

// ---------------------------------------------------------------------------
// The injected engine driver (THE port the generative core drives)
// ---------------------------------------------------------------------------

/**
 * A world-operation outcome from the engine, structurally identical to
 * exchange-sim's `ExchangeResult` (plain code/path/message errors — the
 * engine's own vocabulary, preserved verbatim by the lifting rule).
 */
export type EngineOpResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly message: string }[] };

/** Engine initialization options (mirror of T010's EngineInit). */
export interface EngineInitMirror {
  readonly book_seed?: unknown;
  readonly start_at?: unknown;
}

/**
 * THE ENGINE DRIVER PORT — the structural mirror of the exchange-sim
 * MatchingEngine's four pure operations. The generative world drives the
 * REAL engine through this port (injected at construction; the interop
 * trip-wire binds the real `createEngine`/`submitOrder`/`cancelOrder`/
 * `advanceEngine` and proves assignability + behavior). This lane ships
 * NO engine implementation: exchange physics is T010's alone (L6 — the
 * engine is DRIVEN here, never reimplemented).
 */
export interface EngineDriver {
  /** Create an engine over a config and an optional book seed (mirrors createEngine). */
  createEngine(config: unknown, init: EngineInitMirror): EngineOpResult<EngineStateMirror>;
  /** Submit one order intent at an engine instant (mirrors submitOrder — THE generative act). */
  submitOrder(state: EngineStateMirror, intent: unknown, at: unknown): EngineOpResult<SubmitOutcomeMirror>;
  /** Cancel a live order's remainder (mirrors cancelOrder). */
  cancelOrder(state: EngineStateMirror, reference: unknown, at: unknown): EngineOpResult<CancelOutcomeMirror>;
  /** Advance the engine clock; expire due gtt orders (mirrors advanceEngine). */
  advanceEngine(state: EngineStateMirror, to: unknown): EngineOpResult<AdvanceOutcomeMirror>;
}

/** Structural runtime guard for the engine driver port (four operations). */
export function isEngineDriver(value: unknown): value is EngineDriver {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.createEngine === 'function' &&
    typeof candidate.submitOrder === 'function' &&
    typeof candidate.cancelOrder === 'function' &&
    typeof candidate.advanceEngine === 'function'
  );
}

// ---------------------------------------------------------------------------
// Engine-state views + the engine state hash (L9)
// ---------------------------------------------------------------------------

/**
 * The raw top-of-book view (no arithmetic — the best levels verbatim, the
 * engine's own ordering invariant): the honest "view of engine state" the
 * observation stream carries at every boundary where the top changed, and
 * the ONLY market state the declared processes' policies read.
 */
export interface BookTopView {
  readonly bid_price: string | null;
  readonly bid_orders: readonly RestingOrderMirror[];
  readonly ask_price: string | null;
  readonly ask_orders: readonly RestingOrderMirror[];
}

/** The raw top-of-book view of a book state (levels[0] of each side, verbatim). */
export function bookTopView(book: BookStateMirror): BookTopView {
  const bestBid = book.bids[0];
  const bestAsk = book.asks[0];
  return deepFreeze({
    bid_price: bestBid === undefined ? null : bestBid.price,
    bid_orders: bestBid === undefined ? [] : [...bestBid.orders],
    ask_price: bestAsk === undefined ? null : bestAsk.price,
    ask_orders: bestAsk === undefined ? [] : [...bestAsk.orders],
  });
}

/** A cheap, arithmetic-free identity key for change detection (deterministic). */
export function bookTopKey(view: BookTopView): string {
  const ordersKey = (orders: readonly RestingOrderMirror[]): string => orders.map((order) => `${order.order_id}:${order.remaining}`).join('|');
  return `${view.bid_price ?? '-'}#${ordersKey(view.bid_orders)};${view.ask_price ?? '-'}#${ordersKey(view.ask_orders)}`;
}

/**
 * The engine-state hash (L9): FNV-1a over the canonical JSON of the whole
 * engine state (config, clock, counters, book, order log, fills). The run
 * record binds it, and the golden determinism tests assert its stability —
 * same inputs, byte-identical engine evolution, twice.
 */
export function engineStateHash(state: EngineStateMirror): string {
  const json: unknown = state;
  if (!isJsonValue(json)) {
    // Impossible by the engine's own construction (deeply frozen JSON
    // values); kept total rather than throwing.
    return fnv1a32Hex('non-json-engine-state');
  }
  return fnv1a32Hex(canonicalJson(json));
}
