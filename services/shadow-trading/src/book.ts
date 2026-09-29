/**
 * @tradrl/shadow_trading — the SHADOW BOOK: the paper account's
 * positions/cash/realized-unrealized accounting, derived EXCLUSIVELY
 * from world fills that carry their full physics lineage.
 *
 * THE EXACT-DECIMAL LAW: every money path is a decimal STRING computed
 * through the contract package's BigInt fixed-point arithmetic
 * (@tradrl/execution-policy's decimals module — a permitted relative
 * source import). A JS number on a money path is the typed
 * `decimal_imprecision`. The ONE divided site (a sell's proportional
 * cost-basis release) rounds HALF-UP at 8 fractional digits — the
 * declared precision (the trading-strategy portfolio discipline,
 * mirrored).
 *
 * THE ACCOUNT SEMANTICS (the account-as-aggressor interpretation —
 * the exchange-sim/risk-lane convention):
 *   - buy: quantity += q; costBasis += aggressor_price x q;
 *     cash -= (aggressor_price x q + taker_fee)
 *   - sell: released = costBasis x q_sold / held (half-up at 8dp);
 *     realizedPnl += (aggressor_price x q_sold - released) - taker_fee;
 *     cash += aggressor_price x q_sold - taker_fee (a fee exceeding
 *     the proceeds debits the difference — total, exact);
 *     quantity -= q_sold; costBasis -= released
 *   - unrealized (mark-to-market at the session's current marks):
 *     Σ (mark x quantity - costBasis), SIGNED
 *
 * THE CASH-FLOOR LAW: the strategy-lane portfolio mirror this book
 * derives carries NON-NEGATIVE cash; a scenario that would drive the
 * paper account's cash below zero fails the typed `invalid_state`
 * (fail-closed — the margin-book domain is the risk engine's
 * exposure record, not the portfolio mirror this lane must emit).
 */

import { deepFreeze, isNonNegativeSafeInteger, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import { type ShadowResult, fail, ok } from './errors';
import {
  add as decAdd,
  compare as decCompare,
  divideRoundHalfUp as decDivide,
  isCanonicalDecimal,
  isUnsignedDecimal,
  multiply as decMultiply,
  normalize as decNormalize,
  subtract as decSubtract,
} from '../../../packages/execution-policy/src/index';
import type { ReactiveFillMirror, EngineFillMirror } from './world-mirror';
import { requireReactiveFillMirror } from './world-mirror';
import type { PortfolioStateMirror } from '../../../packages/execution-policy/src/index';

/** The declared basis-release precision (the one divided site's rounding grid). */
export const SHADOW_BASIS_PRECISION = 8;

// ---------------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------------

/** One held position in the shadow book (the netting key is (venue, instrument)). */
export interface ShadowPosition {
  readonly venue: string;
  readonly instrument: string;
  /** Held quantity, non-negative canonical decimal. */
  readonly quantity: string;
  /** Total cost basis of the held quantity, non-negative canonical decimal. */
  readonly costBasis: string;
  /** The instant the position was opened (epoch ms). */
  readonly openedAt: TimestampMs;
}

/** The shadow book: the paper account's whole state. */
export interface ShadowBook {
  readonly positions: readonly ShadowPosition[];
  /** Quote-currency cash, non-negative canonical decimal. */
  readonly cash: string;
  /** Realized PnL accumulated over fills, SIGNED canonical decimal. */
  readonly realizedPnl: string;
  /** The last-applied instant (epoch ms — no ambient clock). */
  readonly asOf: TimestampMs;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** The empty book at an instant (cash '0', no positions). */
export function emptyBook(at: TimestampMs): ShadowBook {
  return deepFreeze({ positions: [], cash: '0', realizedPnl: '0', asOf: at });
}

/**
 * Build the genesis book from an untrusted portfolio-shaped record:
 * `{ positions: [{venue, instrument, quantity, costBasis, openedAt}], cash, realizedPnl? }`.
 * Exact-decimal trip-wired: a JS number on any money field is the
 * typed `decimal_imprecision`.
 */
export function bookFromPortfolio(input: unknown, at: TimestampMs): ShadowResult<ShadowBook> {
  if (!isRecord(input)) return fail('invalid_type', 'the genesis portfolio must be an object { positions, cash, ... }');
  if (typeof input.cash === 'number') {
    return fail('decimal_imprecision', 'a JS number in a money path is float mediation — cash is a decimal STRING');
  }
  if (typeof input.cash !== 'string' || !isUnsignedDecimal(input.cash)) {
    return fail('invalid_field', 'the genesis cash must be a non-negative decimal string', 'cash');
  }
  if (!Array.isArray(input.positions)) return fail('invalid_field', 'the genesis positions must be an array', 'positions');
  const positions: ShadowPosition[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < input.positions.length; index++) {
    const candidate = input.positions[index];
    if (!isRecord(candidate)) return fail('invalid_field', `positions[${index}] must be an object`, 'positions');
    if (typeof candidate.quantity === 'number' || typeof candidate.costBasis === 'number') {
      return fail('decimal_imprecision', `positions[${index}] carries a JS number in a money path — quantities and bases are decimal STRINGs`);
    }
    if (typeof candidate.venue !== 'string' || candidate.venue === '') return fail('invalid_field', `positions[${index}] lacks its venue`, 'positions');
    if (typeof candidate.instrument !== 'string' || candidate.instrument === '') return fail('invalid_field', `positions[${index}] lacks its instrument`, 'positions');
    if (typeof candidate.quantity !== 'string' || !isUnsignedDecimal(candidate.quantity)) {
      return fail('invalid_field', `positions[${index}].quantity must be a non-negative decimal string`, 'positions');
    }
    if (typeof candidate.costBasis !== 'string' || !isUnsignedDecimal(candidate.costBasis)) {
      return fail('invalid_field', `positions[${index}].costBasis must be a non-negative decimal string`, 'positions');
    }
    if (!isTimestampMs(candidate.openedAt)) return fail('invalid_field', `positions[${index}].openedAt must be an epoch-ms instant`, 'positions');
    const key = `${candidate.venue}|${candidate.instrument}`;
    if (seen.has(key)) return fail('invalid_field', `the netting discipline forbids two positions for (${key})`, 'positions');
    seen.add(key);
    positions.push(deepFreeze({
      venue: candidate.venue,
      instrument: candidate.instrument,
      quantity: decNormalize(candidate.quantity),
      costBasis: decNormalize(candidate.costBasis),
      openedAt: candidate.openedAt,
    }));
  }
  const realized = input.realizedPnl === undefined ? '0' : input.realizedPnl;
  if (typeof realized !== 'string' || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(realized)) {
    return fail('invalid_field', 'the genesis realizedPnl must be a signed canonical decimal string', 'realizedPnl');
  }
  return ok(deepFreeze({ positions, cash: decNormalize(input.cash), realizedPnl: decNormalize(realized), asOf: at }));
}

// ---------------------------------------------------------------------------
// Mark-to-market
// ---------------------------------------------------------------------------

/** One mark the book is valued against. */
export interface BookMark {
  readonly venue: string;
  readonly instrument: string;
  /** The reference price, canonical positive decimal. */
  readonly price: string;
  readonly source: 'last_trade' | 'mid_quote';
}

/**
 * The unrealized (mark-to-market) PnL at the given marks, SIGNED exact
 * decimal: Σ over positions (mark x quantity - costBasis). A position
 * without a mark contributes -costBasis (the conservative, declared
 * convention — an unmarked holding is carried at its basis).
 */
export function unrealizedPnlOf(book: ShadowBook, marks: readonly BookMark[]): string {
  const table = new Map<string, string>();
  for (const mark of marks) table.set(`${mark.venue}|${mark.instrument}`, decNormalize(mark.price));
  let total = '0';
  for (const position of book.positions) {
    const mark = table.get(`${position.venue}|${position.instrument}`);
    const notional = mark === undefined ? '0' : decMultiply(mark, position.quantity);
    const pnl = decSubtract(notional, position.costBasis);
    total = signedAdd(total, pnl);
  }
  return decNormalize(total);
}

/** The gross notional at the given marks (Σ mark x quantity — the exposure's gross). */
export function grossNotionalOf(book: ShadowBook, marks: readonly BookMark[]): string {
  const table = new Map<string, string>();
  for (const mark of marks) table.set(`${mark.venue}|${mark.instrument}`, decNormalize(mark.price));
  let total = '0';
  for (const position of book.positions) {
    const mark = table.get(`${position.venue}|${position.instrument}`);
    if (mark === undefined) continue;
    total = decAdd(total, decMultiply(mark, position.quantity));
  }
  return decNormalize(total);
}

/** The book's equity at the given marks: cash + gross notional (SIGNED sum of non-negative parts). */
export function equityOf(book: ShadowBook, marks: readonly BookMark[]): string {
  return decAdd(book.cash, grossNotionalOf(book, marks));
}

// ---------------------------------------------------------------------------
// Fill application (the account transition)
// ---------------------------------------------------------------------------

/** The product of one applied fill. */
export interface BookFillEffect {
  readonly book: ShadowBook;
  /** The realized PnL this fill crystallized (0 for buys; SIGNED exact decimal). */
  readonly realizedDelta: string;
}

/** The account's role in a fill: the submitting aggressor (taker) or the resting party (maker). */
export type AccountRole = 'taker' | 'maker';

/** The account-side execution view of one engine fill: the side, the price and the fee the BOOK accounts at. */
export interface AccountFillView {
  readonly side: 'buy' | 'sell';
  /** The account's execution price (the aggressor's post-slippage price when taker; the maker's level price when maker). */
  readonly price: string;
  /** The account's fee (the taker fee when taker; the maker fee when maker). */
  readonly fee: string;
}

/** Derive the account-side view of one engine fill (the account-as-aggressor / account-as-maker interpretation). */
export function accountFillView(fill: EngineFillMirror, role: AccountRole): ShadowResult<AccountFillView> {
  if (fill.aggressor_side !== 'buy' && fill.aggressor_side !== 'sell') {
    return fail('invalid_field', `fill ${fill.fill_id} carries an unknown aggressor side ${JSON.stringify(fill.aggressor_side)}`);
  }
  if (role === 'taker') {
    return ok(deepFreeze({ side: fill.aggressor_side, price: decNormalize(fill.aggressor_price), fee: decNormalize(fill.taker_fee) }));
  }
  return ok(deepFreeze({ side: fill.aggressor_side === 'buy' ? 'sell' : 'buy', price: decNormalize(fill.price), fee: decNormalize(fill.maker_fee) }));
}

/**
 * Apply ONE world fill to the book. The fill arrives as an UNTRUSTED
 * record: the physics-lineage law is enforced FIRST ({@link
 * requireReactiveFillMirror} — the book never accounts over a fill it
 * cannot attribute), then the exact-decimal account transition runs at
 * the declared ACCOUNT ROLE (taker: the aggressor's post-slippage
 * price + the taker fee; maker: the level price + the maker fee). The
 * caller OWNS the visibility law (the fill's `available_time <= now`
 * — see world-mirror.ts `admitWorldFill`); this function is the pure
 * accounting kernel.
 */
export function applyWorldFill(book: ShadowBook, fill: unknown, role: AccountRole = 'taker'): ShadowResult<BookFillEffect> {
  const required = requireReactiveFillMirror(fill);
  if (!required.ok) return required;
  const worldFill = required.value;
  const engineFill = worldFill.fill;
  const view = accountFillView(engineFill, role);
  if (!view.ok) return view;
  const side = view.value.side;
  const quantity = decNormalize(engineFill.quantity);
  const executionPrice = view.value.price;
  const fee = view.value.fee;
  const notional = decMultiply(executionPrice, quantity);

  const key = `${engineFill.venue}|${engineFill.instrument}`;
  const held = book.positions.find((position) => `${position.venue}|${position.instrument}` === key);
  let realizedDelta = '0';

  // --- The cash leg ------------------------------------------------------------
  let cash: string;
  if (side === 'buy') {
    const debit = decAdd(notional, fee);
    if (decCompare(book.cash, debit) < 0) {
      return fail(
        'invalid_state',
        `fill ${worldFill.fill_id} would drive the shadow book's cash negative (${book.cash} - ${debit}) — the portfolio mirror this lane emits carries non-negative cash; margin books are the risk engine's exposure domain`,
      );
    }
    cash = decSubtract(book.cash, debit);
  } else {
    // A sell credits notional minus the fee; a fee exceeding the
    // proceeds debits the difference (total, exact).
    cash = decCompare(notional, fee) >= 0 ? decAdd(book.cash, decSubtract(notional, fee)) : decSubtract(book.cash, decSubtract(fee, notional));
  }

  // --- The position leg -----------------------------------------------------------
  let positions: ShadowPosition[];
  if (held === undefined) {
    if (side === 'sell') {
      return fail(
        'invalid_state',
        `fill ${worldFill.fill_id} sells ${quantity} ${engineFill.instrument} with no holding — the shadow book's unsigned domain cannot go short (the T040 lane owns shorts)`,
      );
    }
    positions = [...book.positions, deepFreeze({ venue: engineFill.venue, instrument: engineFill.instrument, quantity, costBasis: notional, openedAt: engineFill.quartet.event_time })];
  } else if (side === 'buy') {
    positions = book.positions.map((position) =>
      `${position.venue}|${position.instrument}` === key
        ? { ...position, quantity: decAdd(position.quantity, quantity), costBasis: decAdd(position.costBasis, notional) }
        : position,
    );
  } else {
    const heldQuantity = held.quantity;
    if (decCompare(heldQuantity, quantity) < 0) {
      return fail(
        'invalid_state',
        `fill ${worldFill.fill_id} sells ${quantity} ${engineFill.instrument} against a holding of ${heldQuantity} — the shadow book's unsigned domain cannot go short (the T040 lane owns shorts)`,
      );
    }
    const remaining = decSubtract(heldQuantity, quantity);
    const releasedBasis = decIsZero(heldQuantity) ? '0' : decDivide(decMultiply(held.costBasis, quantity), heldQuantity, SHADOW_BASIS_PRECISION);
    const basisAfter = decSubtract(held.costBasis, releasedBasis);
    realizedDelta = decSubtract(decSubtract(notional, releasedBasis), fee);
    positions = book.positions
      .map((position) =>
        `${position.venue}|${position.instrument}` === key
          ? { ...position, quantity: remaining, costBasis: basisAfter }
          : position,
      )
      .filter((position) => !decIsZero(position.quantity));
  }

  const nextBook: ShadowBook = deepFreeze({
    positions,
    cash,
    realizedPnl: signedAdd(book.realizedPnl, realizedDelta),
    asOf: engineFill.quartet.available_time,
  });
  return ok({ book: nextBook, realizedDelta });
}

// ---------------------------------------------------------------------------
// The portfolio mirror (the strategy-lane snapshot both contract packages accept)
// ---------------------------------------------------------------------------

/** The lineage block the derived portfolio mirror carries (L9/L12). */
export interface BookLineage {
  readonly strategy: { readonly specId: string; readonly version: number };
  readonly goal: { readonly goalId: string; readonly version: number };
  readonly constraintSet: { readonly id: string; readonly version: number };
  readonly windowId: string;
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

/**
 * Derive the portfolio-state mirror (the T018 shape BOTH
 * @tradrl/execution-policy's gate and @tradrl/risk's exposure accept —
 * the mirrors are field-for-field identical): positions, weights (the
 * mark-share of equity, half-up at 8dp), cash, the signed PnL split at
 * the given marks, `asOf`, and the lineage block. The `stateId` is
 * content-addressed over the canonical content minus the id.
 */
export function portfolioMirrorOf(book: ShadowBook, marks: readonly BookMark[], lineage: BookLineage, digestOf: (text: string) => string): PortfolioStateMirror {
  const unrealized = unrealizedPnlOf(book, marks);
  const equity = equityOf(book, marks);
  const weights = book.positions.map((position) => {
    const mark = marks.find((candidate) => candidate.venue === position.venue && candidate.instrument === position.instrument);
    const notional = mark === undefined ? '0' : decMultiply(mark.price, position.quantity);
    const weight = decCompare(equity, '0') > 0 ? decDivide(notional, equity, SHADOW_BASIS_PRECISION) : '0';
    return deepFreeze({ instrumentId: position.instrument, weight, markSource: (mark?.source ?? 'last_trade') as 'last_trade' | 'mid_quote' });
  });
  const content = {
    positions: book.positions.map((position) => ({ instrumentId: position.instrument, venueId: position.venue, quantity: position.quantity, costBasis: position.costBasis, openedAt: position.openedAt })),
    weights,
    cash: book.cash,
    realizedPnl: book.realizedPnl,
    unrealizedPnl: unrealized,
    asOf: book.asOf,
    lineage,
  };
  return deepFreeze({ ...content, stateId: `ps:${digestOf(canonicalBookJson(content))}` }) as unknown as PortfolioStateMirror;
}

/** Canonical JSON over a tree of primitives (the local byte-identity grammar). */
function canonicalBookJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((element) => canonicalBookJson(element)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalBookJson(record[key])}`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// Local signed helpers (the exact-decimal signed extension)
// ---------------------------------------------------------------------------

/** Exact signed addition over the optional-leading-minus grammar. */
function signedAdd(a: string, b: string): string {
  const aNeg = a.startsWith('-');
  const bNeg = b.startsWith('-');
  const aAbs = aNeg ? a.slice(1) : a;
  const bAbs = bNeg ? b.slice(1) : b;
  if (aNeg === bNeg) return (aNeg ? '-' : '') + decAdd(aAbs, bAbs);
  const order = decCompare(aAbs, bAbs);
  if (order === 0) return '0';
  if (order > 0) return (aNeg ? '-' : '') + decSubtract(aAbs, bAbs);
  return (bNeg ? '-' : '') + decSubtract(bAbs, aAbs);
}

/** `true` iff the canonical decimal is exactly zero. */
function decIsZero(v: string): boolean {
  const normalized = decNormalize(v);
  return normalized === '0' || normalized === '0.0' || /^0\.(0)+$/.test(normalized);
}

/** Guard: a canonical decimal string (local re-check for book inputs). */
export function isCanonicalDecimalString(v: unknown): v is string {
  return typeof v === 'string' && isCanonicalDecimal(v);
}

/** Guard: a book (structural). */
export function isShadowBook(v: unknown): v is ShadowBook {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.positions)) return false;
  for (const position of v.positions) {
    if (!isRecord(position)) return false;
    if (typeof position.venue !== 'string' || position.venue === '') return false;
    if (typeof position.instrument !== 'string' || position.instrument === '') return false;
    if (typeof position.quantity !== 'string' || !isUnsignedDecimal(position.quantity)) return false;
    if (typeof position.costBasis !== 'string' || !isUnsignedDecimal(position.costBasis)) return false;
    if (!isTimestampMs(position.openedAt)) return false;
  }
  if (typeof v.cash !== 'string' || !isUnsignedDecimal(v.cash)) return false;
  if (typeof v.realizedPnl !== 'string' || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v.realizedPnl)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  return true;
}

/** Guard: a non-negative count (bookkeeping fields). */
export function isCount(v: unknown): v is number {
  return isNonNegativeSafeInteger(v);
}
