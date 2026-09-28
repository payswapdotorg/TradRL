/**
 * @tradrl/exchange-sim — the exchange/order-book simulation contract
 * package (Work Order T010): the execution-fidelity core of the Market
 * World.
 *
 * Public API:
 *   - `ExchangeConfig` + validation + `canonicalConfigJson` / `configHash`
 *     (L9 lineage anchors) + the L5 mode discipline
 *     (`reactive_replay` | `generative`; exact replay never matches).
 *   - `OrderIntent` — the STRUCTURAL MIRROR of domain-core's `Order`
 *     (sides, kinds, time-in-force, price matrix, canonical decimals,
 *     ISO timestamps); guards + collect-all validation.
 *   - `BookLevel` / `BookSnapshotSeed` — STRUCTURAL MIRRORS of
 *     market-protocol's book payload shapes; the engine's immutable
 *     `BookState` / `RestingLevel` / `RestingOrder`; seed validation
 *     against the venue grid rules; `topOfBook` / `bookSnapshotView`.
 *   - `MatchingEngine` — the pure reducer: `createEngine` / `submitOrder`
 *     / `cancelOrder` / `advanceEngine` over an immutable book with
 *     price-time priority, deterministic tie-breaking, partial fills,
 *     per-order audit trails, and typed operation errors.
 *   - Records: `OrderAck` / `OrderReject` / `Fill` / `OrderCancelRecord`
 *     / `OrderRecord` — every emitted record carries an HONEST
 *     availability quartet (L4).
 *   - Models: `FeeSchedule` (maker/taker tiers), `LatencyConfig`
 *     (fixed/uniform deterministic delay), `SlippageConfig` (book_walk /
 *     fixed_bps), `MarketImpactPolicy` (default: the explicit
 *     declared-absence record `NO_MARKET_IMPACT`) — each with its
 *     first-class L6 fidelity declaration record.
 *   - Exact decimal arithmetic (`decimals.ts`), `TimestampMs` /
 *     asset-class mirrors, branded ids, typed errors, deepFreeze.
 *
 * Zero runtime dependencies; types, schemas and pure functions only.
 * Cross-lane shapes (domain-core Order, market-protocol book/trade/quote
 * payloads and envelope fields, environment-protocol TimestampMs) are
 * STRUCTURAL MIRRORS (D-003/D-004) — this package never imports them;
 * the interop tests prove the mirrors against the real packages present
 * on this branch and trip-wire against the environment lane when it is
 * present (the Lead's integration tree).
 */

// Errors and results
export type { ExchangeErrorCode, ExchangeError, ExchangeResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives (deepFreeze discipline, branding)
export type { Brand } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  deepFreeze,
  isDeeplyFrozen,
} from './primitives';

// JSON value model (opaque payloads)
export type { JsonValue, JsonObject } from './json';
export { isJsonValue, isJsonObject } from './json';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs, timestampMs, requireTimestampMs } from './timestamp';

// Asset-class mirror (canonical owner: @tradrl/market-protocol)
export type { AssetClass } from './asset-class';
export { ASSET_CLASSES, isAssetClassOfMarket } from './asset-class';

// Branded ids and opaque cross-lane references
export type {
  ExchangeOrderId,
  FillId,
  FeePolicyId,
  LatencyPolicyId,
  VenueId,
  InstrumentId,
  AgentInstanceId,
  Seed,
} from './ids';
export {
  isExchangeOrderId,
  isFillId,
  isFeePolicyId,
  isLatencyPolicyId,
  isVenueId,
  isInstrumentId,
  isAgentInstanceId,
  isSeed,
  mintOrderId,
  mintFillId,
} from './ids';

// Exact decimal arithmetic
export type { DecimalString, Timestamp } from './domain-mirror';
export {
  isTimestamp,
  isDecimalString,
  isPositiveDecimal,
  isoToEpochMs,
} from './domain-mirror';
export {
  isUnsignedDecimal,
  isCanonicalDecimal,
  isCanonicalPositiveDecimal,
  isEqual,
  compare,
  isZero,
  add,
  subtract,
  multiply,
  normalize,
  roundHalfUp,
  divideRoundHalfUp,
  isAlignedToGrid,
  floorToGrid,
  ceilToGrid,
} from './decimals';

// The order-intent mirror (canonical owner: @tradrl/domain-core Order)
export type {
  OrderSide,
  CoreOrderKind,
  OrderKind,
  CoreTimeInForce,
  TimeInForce,
  OrderIntent,
} from './domain-mirror';
export {
  ORDER_SIDES,
  CORE_ORDER_KINDS,
  CORE_TIME_IN_FORCE,
  isOrderSide,
  isCoreOrderKind,
  isOrderKind,
  isCoreTimeInForce,
  isTimeInForce,
  isOrderIntent,
  validateOrderIntent,
} from './domain-mirror';

// The fee model
export type { FeeRole, FeeTier, FeeSchedule, FeeQuote } from './fees';
export {
  FEE_FIDELITY,
  isFeeRole,
  isFeeTier,
  isFeeSchedule,
  validateFeeSchedule,
  selectFeeTier,
  feeOf,
  feesOfFill,
} from './fees';

// The latency model
export type { LatencyConfig } from './latency';
export { LATENCY_FIDELITY, isLatencyConfig, validateLatencyConfig, latencyDelayMs } from './latency';

// The slippage model
export type { SlippageConfig } from './slippage';
export { SLIPPAGE_FIDELITY, isSlippageConfig, validateSlippageConfig, aggressorPrice } from './slippage';

// The market-impact policy
export type { MarketImpactPolicy } from './impact';
export { NO_MARKET_IMPACT, IMPACT_FIDELITY, isMarketImpactPolicy, ENGINE_IMPACT_KINDS } from './impact';

// The book
export type { BookLevel, BookSnapshotSeed, RestingOrder, RestingLevel, BookState, TopOfBook } from './book';
export {
  isBookLevel,
  isBookSnapshotSeed,
  validateBookSeed,
  emptyBook,
  isBookState,
  topOfBook,
  bookSnapshotView,
} from './book';

// Output records and the audit trail
export type {
  AvailabilityQuartet,
  OrderStatus,
  RejectReason,
  CancelReason,
  Fill,
  OrderAck,
  OrderReject,
  OrderCancelRecord,
  OrderAuditEvent,
  OrderRecord,
} from './records';
export {
  isAvailabilityQuartet,
  quartetOf,
  ORDER_STATUSES,
  isOrderStatus,
  isTerminalStatus,
  REJECT_REASONS,
  isRejectReason,
  CANCEL_REASONS,
  isCancelReason,
  isFill,
  isOrderAck,
  isOrderReject,
  isOrderCancelRecord,
  isOrderAuditEvent,
  isOrderRecord,
  describeOrder,
} from './records';

// The engine
export type { EngineState, SubmitOutcome, CancelOutcome, AdvanceOutcome, EngineInit, CancelReference } from './engine';
export { createEngine, submitOrder, cancelOrder, advanceEngine } from './engine';

// The exchange configuration (L9 anchors)
export type { ExchangeConfig, ExchangeFidelity } from './config';
export {
  EXCHANGE_FIDELITY_MODES,
  isExchangeFidelity,
  validateExchangeConfig,
  isExchangeConfig,
  canonicalJson,
  canonicalConfigJson,
  configHash,
  fnv1a32Hex,
} from './config';

/** Package identity and ownership (Work Order T010). */
export const packageInfo = {
  name: '@tradrl/exchange-sim',
  owner: 'T010',
  status: 'implemented',
} as const;
