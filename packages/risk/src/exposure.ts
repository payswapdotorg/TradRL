// @tradrl/risk — the ExposureComputation: (portfolio-state mirror,
// market-state mirror, fills) -> ExposureRecord.
//
// THE MEASUREMENT LAW (the Work Order's §4: T019's gate checks limits —
// but "nothing computes what the limits are checked AGAINST: no
// exposure aggregation across positions, no concentration measurement,
// no drawdown tracking, no leverage computation"): THIS module owns the
// measurement. Per-instrument and aggregate exposure, gross/net
// notional, equity, the threaded high-water mark and drawdown — all
// EXACT decimals (BigInt fixed-point; the typed `decimal_imprecision`
// trip wire rejects any JS number that tries to enter a money path),
// all lineage-carrying (L9), all tenant-scoped (L12).
//
// THE MEASURES (each defined once, exactly):
//   - ORDER measure: one input fill's quantity and its T19-gate
//     notional (quantity x REFERENCE price — the same math
//     execution-policy's checkLimits applies, so this lane's
//     order-notional states and the gate's agree).
//   - POSITION measure: the POST-FILL held quantity (the unsigned
//     magnitude discipline — sells beyond the holding fold to magnitude,
//     mirroring T019's postTradePosition; shorts are the T040 lane) and
//     its mark notional (quantity x reference price).
//   - CASH: post-fill cash — signed (buys beyond cash are margin; the
//     one signed surface, see decimals.ts's signed extension). Buys pay
//     the AGGRESSOR price plus the taker fee; sells receive the
//     aggressor price minus it (the account-as-aggressor
//     interpretation — fill-mirror.ts).
//   - GROSS NOTIONAL: the sum of the position notionals.
//   - NET NOTIONAL: the sum of SIGNED notionals — degenerately equal to
//     gross under the unsigned position domain (documented; the
//     long/short refinement lands with T040's signed books).
//   - EQUITY: cash + gross notional (NAV at reference marks; the
//     portfolio mirror's realized/unrealized PnL split is recorded
//     metadata, not added — its cash already carries realized proceeds).
//   - PEAK EQUITY: max(prior peak, equity) — the threaded high-water
//     mark (the drawdown series' backbone, measures.ts).
//   - DRAWDOWN: peak - equity (>= 0 by construction).
//
// DETERMINISM (L9): the same (portfolio state, market state, fills,
// prior peak) always produces the byte-identical record — the exposure
// id is content-addressed (`exp:` + digest of the canonical content).
// No ambient clock (the record's asOf is the market state's), no
// randomness.
//
// THE DECLARED-INPUTS LAW: a position or fill whose (venue, instrument)
// pair the market state does not cover is the typed `market_state_gap` —
// the engine refuses to price at a guessed reference (never a
// best-effort measurement).
//
// Spec anchors: spec/ARCHITECTURE.md (Execution — "limits"; the core
// flow "Strategy/Portfolio/Risk -> Execution"), spec/ARCHITECTURE-
// LOCK.md L4, L8, L9, L12.

import { deepFreeze, isNonEmptyString, isRecord, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, stableDigest } from './primitives';
import {
  add as decAdd,
  isNonNegativeDecimalInput,
  isSignedCanonicalDecimal,
  multiply as decMultiply,
  normalize as decNormalize,
  signedAdd,
  signedCompare,
  signedSubtract,
} from './decimals';
import type { AssetClassMirror, RiskMarketState } from './market-mirror';
import { isRiskMarketState } from './market-mirror';
import type { PortfolioStateMirror, PositionRecordMirror } from './portfolio-mirror';
import { isPortfolioStateMirror } from './portfolio-mirror';
import type { FillMirror } from './fill-mirror';
import { isFillMirror } from './fill-mirror';
import type { ExposureRecordId, InstrumentId, ProjectId, Seed, TenantId, VenueId } from './ids';
import { isInstrumentId, isVenueId, mintExposureRecordId } from './ids';
import {
  type RiskError,
  type RiskResult,
  invalidField,
  invalidType,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The measures' records
// ---------------------------------------------------------------------------

/**
 * One order measure: the exposure input's record of ONE fill — the
 * quantity executed and the notional T019's gate would compute for it
 * (quantity x reference price). Carries the fill's lineage ref.
 */
export interface OrderMeasure {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly assetClass: AssetClassMirror;
  /** The market state's reference price the notional was computed at. */
  readonly referencePrice: string;
  /** The executed quantity (canonical decimal). */
  readonly quantity: string;
  /** quantity x referencePrice — EXACT (the T019 gate-notional math). */
  readonly notional: string;
  /** The source fill's id (lineage). */
  readonly fillRef: string;
}

/** Guard: `OrderMeasure`. */
export function isOrderMeasure(v: unknown): v is OrderMeasure {
  if (!isRecord(v)) return false;
  if (!isVenueId(v.venue)) return false;
  if (!isInstrumentId(v.instrument)) return false;
  if (typeof v.assetClass !== 'string' || v.assetClass === '') return false;
  if (typeof v.referencePrice !== 'string' || !isNonNegativeDecimalInput(v.referencePrice)) return false;
  if (typeof v.quantity !== 'string' || !isNonNegativeDecimalInput(v.quantity)) return false;
  if (typeof v.notional !== 'string' || !isNonNegativeDecimalInput(v.notional)) return false;
  if (!isNonEmptyString(v.fillRef)) return false;
  return true;
}

/**
 * One position measure: the POST-FILL held quantity (unsigned
 * magnitude) and its mark notional at the market state's reference
 * price.
 */
export interface PositionMeasure {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly assetClass: AssetClassMirror;
  /** The market state's reference price the notional was marked at. */
  readonly referencePrice: string;
  /** The post-fill held quantity (canonical decimal). */
  readonly quantity: string;
  /** quantity x referencePrice — EXACT. */
  readonly notional: string;
}

/** Guard: `PositionMeasure`. */
export function isPositionMeasure(v: unknown): v is PositionMeasure {
  if (!isRecord(v)) return false;
  if (!isVenueId(v.venue)) return false;
  if (!isInstrumentId(v.instrument)) return false;
  if (typeof v.assetClass !== 'string' || v.assetClass === '') return false;
  if (typeof v.referencePrice !== 'string' || !isNonNegativeDecimalInput(v.referencePrice)) return false;
  if (typeof v.quantity !== 'string' || !isNonNegativeDecimalInput(v.quantity)) return false;
  if (typeof v.notional !== 'string' || !isNonNegativeDecimalInput(v.notional)) return false;
  return true;
}

/**
 * The exposure record's lineage block (L9): the measured portfolio
 * state's id, the market state's id, the threaded prior peak, the run's
 * seed, and the tenant/project scope (L12).
 */
export interface ExposureLineage {
  readonly portfolioState: string;
  readonly marketState: string;
  /** The high-water mark this measurement extends (null at genesis). */
  readonly priorPeakEquity: string | null;
  /** The deterministic seed of the run the measures belong to. */
  readonly seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: `ExposureLineage`. */
export function isExposureLineage(v: unknown): v is ExposureLineage {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.portfolioState)) return false;
  if (!isNonEmptyString(v.marketState)) return false;
  if (v.priorPeakEquity !== null && !isSignedCanonicalDecimal(v.priorPeakEquity)) return false;
  if (!isNonEmptyString(v.seed)) return false;
  if (typeof v.tenant !== 'string' || v.tenant === '') return false;
  if (typeof v.project !== 'string' || v.project === '') return false;
  return true;
}

/**
 * The exposure record: everything the limit evaluation reasons over.
 * Content-addressed (`exp:` + digest of the canonical content); deeply
 * frozen; byte-stable under canonical serialization (L9).
 */
export interface ExposureRecord {
  /** Content-addressed identity: `exp:` + digest of the canonical content. */
  readonly exposureId: ExposureRecordId;
  /** The measurement instant (the market state's asOf — no ambient clock). */
  readonly asOf: TimestampMs;
  /** Post-fill cash (SIGNED — margin books may carry negative cash). */
  readonly cash: string;
  /** One measure per input fill, in input order. */
  readonly orders: readonly OrderMeasure[];
  /** The post-fill positions (portfolio positions + fill effects), in portfolio order then first-appearance. */
  readonly positions: readonly PositionMeasure[];
  /** The sum of the position notionals. */
  readonly grossNotional: string;
  /** The sum of SIGNED notionals (== gross under the unsigned domain — documented degeneracy). */
  readonly netNotional: string;
  /** cash + grossNotional (NAV at reference marks; SIGNED). */
  readonly equity: string;
  /** max(prior peak, equity) — the threaded high-water mark. */
  readonly peakEquity: string;
  /** peakEquity - equity (>= 0 by construction). */
  readonly drawdown: string;
  /** The input fills' ids, in input order (lineage). */
  readonly fillRefs: readonly string[];
  readonly lineage: ExposureLineage;
}

/** Guard: `ExposureRecord` (structural; the arithmetic coherence laws are re-proved by the limit evaluator). */
export function isExposureRecord(v: unknown): v is ExposureRecord {
  if (!isRecord(v)) return false;
  if (typeof v.exposureId !== 'string' || !v.exposureId.startsWith('exp:')) return false;
  if (typeof v.asOf !== 'number' || !Number.isSafeInteger(v.asOf) || v.asOf < 0) return false;
  if (typeof v.cash !== 'string' || !isSignedCanonicalDecimal(v.cash)) return false;
  if (!Array.isArray(v.orders) || !v.orders.every((x) => isOrderMeasure(x))) return false;
  if (!Array.isArray(v.positions) || !v.positions.every((x) => isPositionMeasure(x))) return false;
  if (typeof v.grossNotional !== 'string' || !isNonNegativeDecimalInput(v.grossNotional)) return false;
  if (typeof v.netNotional !== 'string' || !isNonNegativeDecimalInput(v.netNotional)) return false;
  if (typeof v.equity !== 'string' || !isSignedCanonicalDecimal(v.equity)) return false;
  if (typeof v.peakEquity !== 'string' || !isSignedCanonicalDecimal(v.peakEquity)) return false;
  if (typeof v.drawdown !== 'string' || !isNonNegativeDecimalInput(v.drawdown)) return false;
  if (!Array.isArray(v.fillRefs) || !v.fillRefs.every((x) => isNonEmptyString(x))) return false;
  if (!isExposureLineage(v.lineage)) return false;
  // Netting discipline: one position measure per (venue, instrument).
  const seen = new Set<string>();
  for (const position of v.positions) {
    const key = `${position.venue}|${position.instrument}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Content addressing (L9)
// ---------------------------------------------------------------------------

/** The canonical JSON tree of an exposure record's CONTENT (everything except the content-addressed `exposureId`). */
export function exposureContentTree(record: Omit<ExposureRecord, 'exposureId'>): JsonValue {
  return {
    asOf: record.asOf,
    cash: record.cash,
    orders: record.orders.map((order) => ({
      venue: order.venue,
      instrument: order.instrument,
      assetClass: order.assetClass,
      referencePrice: order.referencePrice,
      quantity: order.quantity,
      notional: order.notional,
      fillRef: order.fillRef,
    })),
    positions: record.positions.map((position) => ({
      venue: position.venue,
      instrument: position.instrument,
      assetClass: position.assetClass,
      referencePrice: position.referencePrice,
      quantity: position.quantity,
      notional: position.notional,
    })),
    grossNotional: record.grossNotional,
    netNotional: record.netNotional,
    equity: record.equity,
    peakEquity: record.peakEquity,
    drawdown: record.drawdown,
    fillRefs: [...record.fillRefs],
    lineage: {
      portfolioState: record.lineage.portfolioState,
      marketState: record.lineage.marketState,
      priorPeakEquity: record.lineage.priorPeakEquity,
      seed: record.lineage.seed,
      tenant: record.lineage.tenant,
      project: record.lineage.project,
    },
  };
}

/** The L9 anchor: the canonical JSON of a validated exposure record. */
export function canonicalExposureJson(record: ExposureRecord): string {
  return canonicalJson(exposureContentTree(record));
}

// ---------------------------------------------------------------------------
// The computation
// ---------------------------------------------------------------------------

/** The exposure computation's input bundle (everything the measures derive from). */
export interface ExposureInput {
  /** The untrusted portfolio-state mirror (the T018 shapes — validated inside). */
  readonly portfolio: unknown;
  /** The untrusted market state (the pricing facts — validated inside). */
  readonly marketState: unknown;
  /** The untrusted fill sequence (exchange-sim fill mirrors — validated inside). */
  readonly fills: readonly unknown[];
  /** The threaded high-water mark this measurement extends (null at genesis; a signed canonical decimal). */
  readonly priorPeakEquity: string | null;
  /** The deterministic seed of the run (lineage). */
  readonly seed: string;
}

/**
 * Compute the exposure record — the pure, deterministic measurement.
 * Fails with:
 *   - `invalid_type`/`invalid_field` — the portfolio mirror, market
 *     state or a fill fails its guard (collect-all);
 *   - `decimal_imprecision` — a JS NUMBER in a money field (cash,
 *     price, quantity, fee — float mediation is inexpressible);
 *   - `market_state_gap` — a position's or fill's (venue, instrument)
 *     pair is not covered by the market state (never a best-effort
 *     reference price);
 *   - `tenant_missing` — the portfolio mirror carries no tenant scope.
 * On success the record is deeply frozen with its content-addressed id
 * (L9): the same inputs always produce the byte-identical record.
 */
export function computeExposure(input: ExposureInput): RiskResult<ExposureRecord> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('computeExposure requires an input object { portfolio, marketState, fills, priorPeakEquity, seed }')] };
  }

  // --- The portfolio mirror (the strategy lane's snapshot) -------------------
  if (input.portfolio === undefined) {
    return { ok: false, errors: [invalidField('portfolio', 'computeExposure requires a portfolio-state mirror')] };
  }
  // The exact-decimal trip wire over the snapshot's money fields.
  if (isRecord(input.portfolio) && typeof (input.portfolio as Record<string, unknown>).cash === 'number') {
    return {
      ok: false,
      errors: [{
        code: 'decimal_imprecision',
        path: 'portfolio.cash',
        message: 'a JS number in a money path is float mediation — cash is a decimal STRING in the mirrored grammars',
      }],
    };
  }
  if (!isPortfolioStateMirror(input.portfolio)) {
    return { ok: false, errors: [invalidField('portfolio', 'computeExposure requires a structurally valid portfolio-state mirror (the T018 shapes)')] };
  }
  const portfolio = input.portfolio;

  // --- The market state (the pricing facts) -------------------------------------
  if (input.marketState === undefined) {
    return { ok: false, errors: [invalidField('marketState', 'computeExposure requires a market state (the pricing facts)')] };
  }
  if (isRecord(input.marketState) && (input.marketState as Record<string, unknown>).instruments !== undefined) {
    const instruments = (input.marketState as Record<string, unknown>).instruments;
    if (Array.isArray(instruments)) {
      for (let index = 0; index < instruments.length; index++) {
        const entry = instruments[index];
        if (isRecord(entry) && typeof entry.referencePrice === 'number') {
          return {
            ok: false,
            errors: [{
              code: 'decimal_imprecision',
              path: `marketState.instruments[${index}].referencePrice`,
              message: 'a JS number in a money path is float mediation — reference prices are decimal STRINGS',
            }],
          };
        }
      }
    }
  }
  if (!isRiskMarketState(input.marketState)) {
    return { ok: false, errors: [invalidField('marketState', 'computeExposure requires a structurally valid market state (market-mirror.ts)')] };
  }
  const marketState: RiskMarketState = input.marketState;

  // --- The fill sequence (the exposure inputs' execution evidence) ---------------
  if (input.fills !== undefined && !Array.isArray(input.fills)) {
    return { ok: false, errors: [invalidField('fills', 'computeExposure requires an array of fill mirrors')] };
  }
  const fills: readonly unknown[] = input.fills === undefined ? [] : input.fills;
  const validatedFills: FillMirror[] = [];
  for (let index = 0; index < fills.length; index++) {
    const candidate = fills[index];
    if (isRecord(candidate) && (typeof candidate.price === 'number' || typeof candidate.quantity === 'number' || typeof candidate.aggressor_price === 'number' || typeof candidate.taker_fee === 'number')) {
      return {
        ok: false,
        errors: [{
          code: 'decimal_imprecision',
          path: `fills[${index}]`,
          message: 'a JS number in a money path is float mediation — fill prices/quantities/fees are decimal STRINGS',
        }],
      };
    }
    if (!isFillMirror(candidate)) {
      return { ok: false, errors: [invalidField(`fills[${index}]`, 'computeExposure requires structurally valid fill mirrors (the T010 shapes)')] };
    }
    validatedFills.push(candidate);
  }

  // --- The prior peak ---------------------------------------------------------------
  if (input.priorPeakEquity !== null && input.priorPeakEquity !== undefined && !isSignedCanonicalDecimal(input.priorPeakEquity)) {
    return { ok: false, errors: [invalidField('priorPeakEquity', 'computeExposure requires a signed canonical decimal prior peak, or null at genesis')] };
  }
  const priorPeak = input.priorPeakEquity === undefined ? null : input.priorPeakEquity;
  if (typeof input.seed !== 'string' || input.seed === '') {
    return { ok: false, errors: [{ code: 'lineage_gap', path: 'seed', message: 'computeExposure requires the run seed (L9 determinism contract)' }] };
  }

  // --- The pricing table (the declared-inputs law) ------------------------------------
  const prices = new Map<string, { referencePrice: string; assetClass: AssetClassMirror }>();
  for (const entry of marketState.instruments) {
    prices.set(`${entry.venue}|${entry.instrument}`, { referencePrice: decNormalize(entry.referencePrice), assetClass: entry.assetClass });
  }
  const priceOf = (venue: string, instrument: string, path: string): RiskResult<{ referencePrice: string; assetClass: AssetClassMirror }> => {
    const found = prices.get(`${venue}|${instrument}`);
    if (found === undefined) {
      return {
        ok: false,
        errors: [{
          code: 'market_state_gap',
          path,
          message: `the market state does not cover (${venue}, ${instrument}) — the engine refuses to price at a guessed reference (never a best-effort measurement)`,
        }],
      };
    }
    return { ok: true, value: found };
  };

  // --- The position fold (portfolio positions + fill effects, unsigned magnitude) ----
  interface Folded {
    readonly venue: VenueId;
    readonly instrument: InstrumentId;
    quantity: string;
    readonly order: number;
  }
  const folded = new Map<string, Folded>();
  const register = (venue: VenueId, instrument: InstrumentId): Folded => {
    const key = `${venue}|${instrument}`;
    const existing = folded.get(key);
    if (existing !== undefined) return existing;
    const entry: Folded = { venue, instrument, quantity: '0', order: folded.size };
    folded.set(key, entry);
    return entry;
  };
  for (const position of portfolio.positions as readonly PositionRecordMirror[]) {
    const entry = register(position.venueId, position.instrumentId);
    entry.quantity = decAdd(entry.quantity, decNormalize(position.quantity));
  }

  // --- The order measures + the cash fold ------------------------------------------------
  const orders: OrderMeasure[] = [];
  let cash = decNormalize(portfolio.cash);
  for (let index = 0; index < validatedFills.length; index++) {
    const fill = validatedFills[index];
    const priced = priceOf(fill.venue, fill.instrument, `fills[${index}]`);
    if (!priced.ok) return { ok: false, errors: priced.errors };
    const quantity = decNormalize(fill.quantity);
    const referencePrice = priced.value.referencePrice;
    // The T019 gate-notional math: quantity x reference price — EXACT.
    const notional = decMultiply(quantity, referencePrice);
    orders.push(deepFreeze({
      venue: fill.venue,
      instrument: fill.instrument,
      assetClass: priced.value.assetClass,
      referencePrice,
      quantity,
      notional,
      fillRef: fill.fill_id,
    }));
    // The position fold: buys add, sells subtract — the UNSIGNED magnitude
    // discipline (a sell beyond the holding folds to magnitude; T019's
    // postTradePosition law, mirrored — shorts are the T040 lane).
    const entry = register(fill.venue, fill.instrument);
    const held = entry.quantity;
    entry.quantity = decNormalize(
      fill.aggressor_side === 'buy'
        ? decAdd(held, quantity)
        : signedCompare(held, quantity) >= 0 ? signedSubtract(held, quantity) : signedSubtract(quantity, held),
    );
    // The cash fold: the aggressor pays/receives the AGGRESSOR price (post-
    // slippage) and the taker fee — the account-as-aggressor interpretation.
    const aggressorPrice = decNormalize(fill.aggressor_price);
    const proceeds = decMultiply(quantity, aggressorPrice);
    const fee = decNormalize(fill.taker_fee);
    if (fill.aggressor_side === 'buy') {
      cash = signedAdd(cash, signedSubtract('0', decAdd(proceeds, fee)));
    } else {
      cash = signedAdd(cash, signedSubtract(proceeds, fee));
    }
  }

  // --- The position measures ----------------------------------------------------------
  const positions: PositionMeasure[] = [];
  for (const entry of [...folded.values()].sort((a, b) => a.order - b.order)) {
    const priced = prices.get(`${entry.venue}|${entry.instrument}`);
    if (priced === undefined) {
      return {
        ok: false,
        errors: [{
          code: 'market_state_gap',
          path: 'portfolio.positions',
          message: `the market state does not cover (${entry.venue}, ${entry.instrument}) — the engine refuses to price at a guessed reference (never a best-effort measurement)`,
        }],
      };
    }
    const notional = decMultiply(entry.quantity, priced.referencePrice);
    positions.push(deepFreeze({
      venue: entry.venue,
      instrument: entry.instrument,
      assetClass: priced.assetClass,
      referencePrice: priced.referencePrice,
      quantity: entry.quantity,
      notional,
    }));
  }

  // --- The aggregates ---------------------------------------------------------------------
  let gross = '0';
  for (const position of positions) {
    gross = decAdd(gross, position.notional);
  }
  // NET: the sum of SIGNED notionals — under the unsigned position domain
  // every sign is positive, so net == gross (documented degeneracy; the
  // long/short refinement lands with T040's signed books).
  const net = gross;
  // cash is canonical by construction (the fold's outputs are canonical);
  // SIGNED addition — a margin book's cash can be negative.
  const equity = signedAdd(cash, gross);
  const peakEquity = priorPeak === null ? equity : (signedCompare(priorPeak, equity) >= 0 ? priorPeak : equity);
  const drawdown = signedSubtract(peakEquity, equity);

  const payload: Omit<ExposureRecord, 'exposureId'> = {
    asOf: marketState.asOf,
    cash,
    orders,
    positions,
    grossNotional: gross,
    netNotional: net,
    equity,
    peakEquity,
    drawdown,
    fillRefs: validatedFills.map((fill) => fill.fill_id),
    lineage: deepFreeze({
      portfolioState: portfolio.stateId,
      marketState: marketState.stateId,
      priorPeakEquity: priorPeak,
      seed: input.seed as Seed,
      tenant: portfolio.lineage.tenant,
      project: portfolio.lineage.project,
    }),
  };
  return ok(deepFreeze({ ...payload, exposureId: mintExposureRecordId(stableDigest(exposureContentTree(payload))) }));
}
