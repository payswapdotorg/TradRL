/**
 * @tradrl/exchange-sim — the order book: seed mirrors and the engine's
 * immutable book state.
 *
 * THE SEED MIRROR (D-003/D-004): {@link BookLevel} and
 * {@link BookSnapshotSeed} are STRUCTURAL MIRRORS of @tradrl/market-
 * protocol's `book_snapshot` payload shapes (BookLevel / BookSnapshotPayload
 * — the loose unsigned-decimal grammar, so a canonical market-protocol
 * payload assigns without casts; proven in src/book.test.ts against the
 * REAL package, which is present on this branch). Seed levels are
 * normalized to canonical decimals internally, so all EMITTED prices and
 * sizes are byte-stable (L9).
 *
 * THE BOOK STATE (the engine's private half of {@link EngineState}):
 * an immutable value object of price levels, each carrying an ordered
 * queue of resting order references. Bids are stored best-first
 * (descending price), asks best-first (ascending price); within a level
 * the queue is ARRIVAL ORDER (price-time priority — engine.ts). Every
 * transition rebuilds the affected arrays; nothing mutates in place (L3).
 *
 * L6 DECLARED LIMITATION (engine.ts header repeats it): the book models
 * VISIBLE resting liquidity only — no hidden/iceberg liquidity, no
 * queue-position estimation, no synthetic depth.
 */

import { deepFreeze, isNonEmptyString, isNonNegativeSafeInteger, isPositiveSafeInteger, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type ExchangeError, type ExchangeResult } from './errors';
import { compare, isPositiveDecimal, isUnsignedDecimal, normalize } from './decimals';
import type { ExchangeOrderId } from './ids';
import { isExchangeOrderId } from './ids';

// ---------------------------------------------------------------------------
// The seed mirrors (market-protocol book_snapshot payload shapes)
// ---------------------------------------------------------------------------

/**
 * One price level of a book seed. STRUCTURAL MIRROR of market-protocol's
 * `BookLevel`: `{ price, size }` as unsigned decimal strings (loose
 * grammar — normalized to canonical form by the engine).
 */
export interface BookLevel {
  readonly price: string;
  readonly size: string;
}

/**
 * A book seed: the initial visible book. STRUCTURAL MIRROR of
 * market-protocol's `BookSnapshotPayload` (bids/asks/depth/last_update_id).
 * The ENGINE additionally enforces venue grid rules on the seed at
 * construction (see {@link validateBookSeed}): prices tick-aligned, sizes
 * lot-aligned and positive, at most `max_book_depth` levels per side, and
 * NOT crossed (best bid strictly below best ask) — a crossed seed would
 * instantly match against itself, which no resting book may do.
 */
export interface BookSnapshotSeed {
  /** Full visible bid side (any order — the engine sorts descending). May be empty. */
  readonly bids: readonly BookLevel[];
  /** Full visible ask side (any order — the engine sorts ascending). May be empty. */
  readonly asks: readonly BookLevel[];
  /** Number of levels the venue exposes, when known. Informational. */
  readonly depth?: number;
  /** Venue book-state identifier, when provided. Informational (echoed into lineage). */
  readonly last_update_id?: string;
}

/** Runtime guard for a book level (mirror of market-protocol's level rule: positive price and size). */
export function isBookLevel(value: unknown): value is BookLevel {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.price) && isPositiveDecimal(value.price) && isNonEmptyString(value.size) && isPositiveDecimal(value.size);
}

/** Runtime guard for a structurally valid (mirror-shape) book snapshot seed. */
export function isBookSnapshotSeed(value: unknown): value is BookSnapshotSeed {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.bids) || !value.bids.every((level) => isBookLevel(level))) return false;
  if (!Array.isArray(value.asks) || !value.asks.every((level) => isBookLevel(level))) return false;
  if (value.depth !== undefined && !isNonNegativeSafeInteger(value.depth)) return false;
  if (value.last_update_id !== undefined && !isNonEmptyString(value.last_update_id)) return false;
  return true;
}

/**
 * Validate an untrusted book seed against the VENUE rules (tick/lot grid,
 * depth cap, no crossing) — the engine-side gate beyond the mirror shape.
 * Collect-all: every violation is reported. On success the value is
 * returned narrowed, deeply frozen, with levels SORTED (bids descending,
 * asks ascending) and prices/sizes NORMALIZED to canonical decimals.
 */
export function validateBookSeed(
  value: unknown,
  venue: { readonly tick_size: string; readonly lot_size: string; readonly max_book_depth: number },
  path = 'book_seed',
): ExchangeResult<BookSnapshotSeed> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExchangeError[] = [];

  if (value.bids === undefined) {
    errors.push(missingField(`${path}.bids`));
  } else if (!Array.isArray(value.bids)) {
    errors.push(invalidField(`${path}.bids`, 'must be an array of levels'));
  } else {
    errors.push(...validateLevels(value.bids as readonly unknown[], `${path}.bids`, venue));
  }

  if (value.asks === undefined) {
    errors.push(missingField(`${path}.asks`));
  } else if (!Array.isArray(value.asks)) {
    errors.push(invalidField(`${path}.asks`, 'must be an array of levels'));
  } else {
    errors.push(...validateLevels(value.asks as readonly unknown[], `${path}.asks`, venue));
  }

  if (value.depth !== undefined && !isNonNegativeSafeInteger(value.depth)) {
    errors.push(invalidField(`${path}.depth`, 'must be a non-negative integer when present'));
  }
  if (value.last_update_id !== undefined && !isNonEmptyString(value.last_update_id)) {
    errors.push(invalidField(`${path}.last_update_id`, 'must be a non-empty string when present'));
  }

  if (errors.length > 0) return { ok: false, errors };

  const bids = sortedLevels(value.bids as readonly BookLevel[], 'desc');
  const asks = sortedLevels(value.asks as readonly BookLevel[], 'asc');

  // No crossing: a resting book's best bid must be strictly below its best ask.
  if (bids.length > 0 && asks.length > 0 && compare(bids[0].price, asks[0].price) >= 0) {
    errors.push(
      invalidField(
        `${path}`,
        `the seed book is crossed (best bid ${bids[0].price} >= best ask ${asks[0].price}) — a resting book may not cross itself`,
      ),
    );
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      bids: bids.map((level) => deepFreeze({ price: level.price, size: level.size })),
      asks: asks.map((level) => deepFreeze({ price: level.price, size: level.size })),
      ...(value.depth !== undefined ? { depth: value.depth as number } : {}),
      ...(value.last_update_id !== undefined ? { last_update_id: value.last_update_id as string } : {}),
    }),
  );
}

/** Level-array validation: mirror shape + venue grid rules (tick, lot) + depth cap. */
function validateLevels(levels: readonly unknown[], path: string, venue: { readonly tick_size: string; readonly lot_size: string; readonly max_book_depth: number }): ExchangeError[] {
  const errors: ExchangeError[] = [];
  if (levels.length > venue.max_book_depth) {
    errors.push(invalidField(path, `carries ${levels.length} levels but the venue caps the book at ${venue.max_book_depth} per side`));
  }
  const seen = new Set<string>();
  for (let index = 0; index < levels.length; index++) {
    const level = levels[index];
    if (!isBookLevel(level)) {
      errors.push(invalidField(`${path}[${index}]`, 'must be an object with positive decimal price and size'));
      continue;
    }
    const canonicalPrice = normalize(level.price);
    if (canonicalPrice !== level.price && !isUnsignedDecimal(level.price)) {
      errors.push(invalidField(`${path}[${index}].price`, `"${level.price}" is not a decimal string`));
      continue;
    }
    if (seen.has(canonicalPrice)) {
      errors.push(invalidField(`${path}[${index}].price`, `duplicate level price "${canonicalPrice}" — aggregate levels before seeding`));
      continue;
    }
    seen.add(canonicalPrice);
    // Venue grid rules (L6 explicit): seed prices sit on the tick grid,
    // seed sizes on the lot grid.
    if (!isMultipleOf(canonicalPrice, venue.tick_size)) {
      errors.push(invalidField(`${path}[${index}].price`, `"${canonicalPrice}" is not a multiple of the tick size ${venue.tick_size}`));
    }
    if (!isMultipleOf(normalize(level.size), venue.lot_size)) {
      errors.push(invalidField(`${path}[${index}].size`, `"${level.size}" is not a multiple of the lot size ${venue.lot_size}`));
    }
  }
  return errors;
}

/** Exact grid-multiple check (import-avoiding alias kept local for clarity). */
function isMultipleOf(value: string, grid: string): boolean {
  // Exact: bring both to a common scale and test the remainder.
  const [vd, vs] = splitDecimal(value);
  const [gd, gs] = splitDecimal(grid);
  const scale = Math.max(vs, gs);
  return (vd * 10n ** BigInt(scale - vs)) % (gd * 10n ** BigInt(scale - gs)) === 0n;
}

function splitDecimal(value: string): [bigint, number] {
  const dot = value.indexOf('.');
  const intPart = dot === -1 ? value : value.slice(0, dot);
  const fracPart = dot === -1 ? '' : value.slice(dot + 1);
  return [BigInt(`${intPart || '0'}${fracPart}`), fracPart.length];
}

/** Sort levels by price (desc for bids, asc for asks) and normalize decimals. */
function sortedLevels(levels: readonly BookLevel[], direction: 'asc' | 'desc'): readonly BookLevel[] {
  const normalized = levels.map((level) => deepFreeze({ price: normalize(level.price), size: normalize(level.size) }));
  const sorted = normalized.sort((a, b) => (direction === 'asc' ? compare(a.price, b.price) : compare(b.price, a.price)));
  return sorted;
}

// ---------------------------------------------------------------------------
// The engine's resting book (immutable value objects)
// ---------------------------------------------------------------------------

/**
 * One resting order in a level queue. `remaining` is the live unfilled
 * quantity (updated by rebuild, never mutated in place); the full order
 * record (audit trail) lives in the engine's order log, keyed by order id.
 */
export interface RestingOrder {
  readonly order_id: ExchangeOrderId;
  /** Live unfilled quantity (canonical decimal, strictly positive while resting). */
  readonly remaining: string;
}

/** One price level: a canonical tick-aligned price plus its arrival-ordered queue. */
export interface RestingLevel {
  /** Canonical, tick-aligned price. */
  readonly price: string;
  /** Resting orders in ARRIVAL order (price-time priority; engine.ts owns the law). */
  readonly orders: readonly RestingOrder[];
}

/**
 * The immutable resting book. `bids` is best-first (descending price),
 * `asks` best-first (ascending price); level arrays are kept dense (no
 * empty levels — a level whose queue empties is removed).
 */
export interface BookState {
  readonly bids: readonly RestingLevel[];
  readonly asks: readonly RestingLevel[];
}

/** The empty book. */
export function emptyBook(): BookState {
  return deepFreeze({ bids: [], asks: [] });
}

/** Runtime guard for a structurally valid resting book (engine invariant: dense, sorted, positive). */
export function isBookState(value: unknown): value is BookState {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.bids) || !Array.isArray(value.asks)) return false;
  const bidsOk = (value.bids as readonly unknown[]).every((level, index) =>
    isRestingLevel(level) && indexSidesSorted(level as RestingLevel, value.bids as readonly RestingLevel[], index, 'desc'),
  );
  if (!bidsOk) return false;
  const asksOk = (value.asks as readonly unknown[]).every((level, index) =>
    isRestingLevel(level) && indexSidesSorted(level as RestingLevel, value.asks as readonly RestingLevel[], index, 'asc'),
  );
  return asksOk;
}

function indexSidesSorted(level: RestingLevel, levels: readonly RestingLevel[], index: number, direction: 'asc' | 'desc'): boolean {
  if (index === 0) return true;
  const previous = levels[index - 1];
  const ordered = direction === 'asc' ? compare(previous.price, level.price) < 0 : compare(previous.price, level.price) > 0;
  return ordered;
}

function isRestingLevel(value: unknown): value is RestingLevel {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.price) || !isUnsignedDecimal(value.price)) return false;
  if (!Array.isArray(value.orders) || value.orders.length === 0) return false;
  return value.orders.every((order) => isRestingOrder(order));
}

function isRestingOrder(value: unknown): value is RestingOrder {
  if (!isRecord(value)) return false;
  if (!isExchangeOrderId(value.order_id)) return false;
  return isNonEmptyString(value.remaining) && isPositiveDecimal(value.remaining);
}

// ---------------------------------------------------------------------------
// Book views (read-only projections; the service emits these as events)
// ---------------------------------------------------------------------------

/**
 * The aggregated top-of-book quote view (mirror of market-protocol's
 * `QuotePayload` fields). `null` when either side is empty — an honest
 * venue emits NO quote rather than a fabricated one-sided price.
 */
export interface TopOfBook {
  readonly bid_price: string;
  readonly bid_size: string;
  readonly ask_price: string;
  readonly ask_size: string;
}

/** The aggregated best bid/ask, or null when a side is empty. */
export function topOfBook(book: BookState): TopOfBook | null {
  const bestBid = book.bids[0];
  const bestAsk = book.asks[0];
  if (bestBid === undefined || bestAsk === undefined) return null;
  return deepFreeze({
    bid_price: bestBid.price,
    bid_size: aggregate(bestBid.orders),
    ask_price: bestAsk.price,
    ask_size: aggregate(bestAsk.orders),
  });
}

/** The total resting quantity at a level (exact decimal sum). */
function aggregate(orders: readonly RestingOrder[]): string {
  let total = '0';
  for (const order of orders) {
    total = addExact(total, order.remaining);
  }
  return total;
}

function addExact(a: string, b: string): string {
  const [ad, as] = splitDecimal(a);
  const [bd, bs] = splitDecimal(b);
  const scale = Math.max(as, bs);
  return joinDecimal(ad * 10n ** BigInt(scale - as) + bd * 10n ** BigInt(scale - bs), scale);
}

function joinDecimal(digits: bigint, scale: number): string {
  const text = digits.toString();
  if (scale === 0) return text;
  const padded = text.padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale);
  let fracPart = padded.slice(padded.length - scale);
  while (fracPart.length > 0 && fracPart.endsWith('0')) fracPart = fracPart.slice(0, -1);
  return fracPart.length === 0 ? intPart : `${intPart}.${fracPart}`;
}

/**
 * The aggregated full-book view (mirror of market-protocol's
 * `BookSnapshotPayload` shape): bids descending, asks ascending, sizes
 * aggregated per level. JSON-serializable, deeply frozen.
 */
export function bookSnapshotView(book: BookState): {
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
} {
  return deepFreeze({
    bids: book.bids.map((level) => deepFreeze({ price: level.price, size: aggregate(level.orders) })),
    asks: book.asks.map((level) => deepFreeze({ price: level.price, size: aggregate(level.orders) })),
  });
}

/** Guard re-export used by config validation for depth sanity. */
export { isPositiveSafeInteger };
