/**
 * The book: seed mirror parity against the REAL @tradrl/market-protocol
 * book payload validators (present on this branch), venue grid-rule
 * validation, and the resting-book invariants.
 */

import { describe, expect, it } from 'vitest';

import {
  bookSnapshotView,
  emptyBook,
  isBookLevel,
  isBookSnapshotSeed,
  topOfBook,
  validateBookSeed,
  type BookLevel,
  type BookState,
} from './book';
import { validateBookSnapshotPayload } from '../../market-protocol/src/payloads/book';
import type { BookLevel as MarketBookLevel, BookSnapshotPayload as MarketBookSnapshotPayload } from '../../market-protocol/src/payloads/book';
import { validateMarketEvent } from '../../market-protocol/src/envelope';
import { add } from './decimals';
import { deepFreeze } from './primitives';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if the mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff a market-protocol BookLevel is assignable to our mirror. */
function marketLevelIsMirrorLevel(value: MarketBookLevel): BookLevel {
  return value;
}

/** Compiles iff our mirror level is assignable to a market-protocol BookLevel. */
function mirrorLevelIsMarketLevel(value: BookLevel): MarketBookLevel {
  return value;
}

/** Compiles iff a canonical BookSnapshotPayload assigns to our seed shape. */
function marketSnapshotIsSeed(value: MarketBookSnapshotPayload): { bids: readonly BookLevel[]; asks: readonly BookLevel[] } {
  return value;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VENUE_RULES = { tick_size: '0.01', lot_size: '0.001', max_book_depth: 5 };

function seedFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bids: [
      { price: '43100.00', size: '1.500' },
      { price: '43098.00', size: '2.000' },
    ],
    asks: [
      { price: '43102.00', size: '1.000' },
      { price: '43104.00', size: '0.500' },
    ],
    ...overrides,
  };
}

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly unknown[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BookLevel / BookSnapshotSeed structural mirror (market-protocol)', () => {
  it('a canonical market-protocol book_snapshot payload passes the seed guard and validation', () => {
    // Build a canonical event carrying a book_snapshot payload, extract the
    // validated payload — the exact shape a T008 ingestion adapter hands us.
    const eventResult = validateMarketEvent({
      event_id: 'evt-book-1',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      event_type: 'book_snapshot',
      event_time: 1_700_000_000_000,
      source_time: 1_700_000_000_000,
      available_time: 1_700_000_000_040,
      ingestion_time: 1_700_000_000_100,
      sequence: 1,
      provider: 'binance',
      provenance: { origin: 'historical', adapter: { id: 'binance-adapter', version: '1.4.0' }, derived_from: [], transform: null },
      payload: seedFixture(),
    });
    expect(eventResult.ok).toBe(true);
    if (!eventResult.ok) return;
    const canonical = eventResult.value.payload as MarketBookSnapshotPayload;
    expect(isBookSnapshotSeed(canonical)).toBe(true);
    const seeded = validateBookSeed(canonical, VENUE_RULES);
    expect(seeded.ok, JSON.stringify(seeded.ok ? null : seeded.errors)).toBe(true);
    // Type-level witnesses compile both directions.
    const first = seeded.ok ? seeded.value.bids[0] : undefined;
    if (first === undefined) return;
    const asMarket: MarketBookLevel = mirrorLevelIsMarketLevel(first);
    const asMirror: BookLevel = marketLevelIsMirrorLevel(asMarket);
    expect(asMirror.price).toBe('43100.00');
    void marketSnapshotIsSeed;
  });

  it('the level guards agree on accept/reject across a boundary sample', () => {
    const samples: readonly unknown[] = [
      { price: '43100.00', size: '1.5' },
      { price: '01.2', size: '1.5' }, // loose grammar: BOTH accept (mirror parity)
      { price: '0', size: '1.5' }, // non-positive price: BOTH reject
      { price: '43100.00', size: '0' }, // non-positive size: BOTH reject
      { price: '-1', size: '1' },
      { price: '43100.00' },
      { price: 43100, size: 1 },
      null,
    ];
    for (const sample of samples) {
      expect(isBookLevel(sample), JSON.stringify(sample)).toBe(sample !== null && typeof sample === 'object' ? validateBookSnapshotPayload({ bids: [sample], asks: [] }).length === 0 : false);
    }
  });

  it('the market-protocol payload validator and the seed guard agree on whole snapshots', () => {
    const snapshots: readonly unknown[] = [
      seedFixture(),
      seedFixture({ bids: [{ price: '0', size: '1' }] }),
      seedFixture({ asks: [{ price: '1', size: '0' }] }),
      seedFixture({ bids: 'nope' }),
      {},
      null,
    ];
    for (const snapshot of snapshots) {
      const marketErrors = validateBookSnapshotPayload(snapshot);
      expect(isBookSnapshotSeed(snapshot), JSON.stringify(snapshot)).toBe(marketErrors.length === 0);
    }
  });
});

describe('validateBookSeed (venue grid rules)', () => {
  it('sorts and normalizes a good seed (bids descending, asks ascending, canonical decimals)', () => {
    const seeded = unwrap(
      validateBookSeed(
        seedFixture({
          bids: [
            { price: '43098.00', size: '2.000' },
            { price: '43100.00', size: '1.500' },
          ],
        }),
        VENUE_RULES,
      ),
    );
    expect(seeded.bids.map((level) => level.price)).toEqual(['43100.00', '43098.00']);
    expect(seeded.asks.map((level) => level.price)).toEqual(['43102.00', '43104.00']);
    expect(Object.isFrozen(seeded)).toBe(true);
  });

  it('rejects crossed and locked seeds', () => {
    const crossed = validateBookSeed(
      seedFixture({ bids: [{ price: '43102.00', size: '1' }], asks: [{ price: '43102.00', size: '1' }] }),
      VENUE_RULES,
    );
    expect(crossed.ok).toBe(false);
    if (crossed.ok) return;
    expect(crossed.errors[0]?.message).toMatch(/crossed/);
  });

  it('rejects off-tick prices, off-lot sizes, duplicates, and over-depth seeds (collect-all)', () => {
    const offTick = validateBookSeed(seedFixture({ bids: [{ price: '43100.005', size: '1' }] }), VENUE_RULES);
    expect(offTick.ok).toBe(false);
    if (!offTick.ok) expect(offTick.errors[0]?.message).toMatch(/tick/);

    const offLot = validateBookSeed(seedFixture({ asks: [{ price: '43102.00', size: '0.0015' }] }), VENUE_RULES);
    expect(offLot.ok).toBe(false);
    if (!offLot.ok) expect(offLot.errors[0]?.message).toMatch(/lot/);

    const duplicate = validateBookSeed(
      seedFixture({ bids: [{ price: '43100.00', size: '1' }, { price: '43100.00', size: '2' }] }),
      VENUE_RULES,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.errors[0]?.message).toMatch(/duplicate/);

    const tooDeep = validateBookSeed(
      { bids: [1, 2, 3, 4, 5, 6].map((i) => ({ price: String(43000 + i * 10) + '.00', size: '1' })), asks: [] },
      VENUE_RULES,
    );
    expect(tooDeep.ok).toBe(false);
    if (!tooDeep.ok) expect(tooDeep.errors[0]?.message).toMatch(/depth/);
  });

  it('accepts an empty book (both sides may be empty)', () => {
    expect(validateBookSeed({ bids: [], asks: [] }, VENUE_RULES).ok).toBe(true);
  });
});

describe('book views', () => {
  it('topOfBook aggregates the best level and is null on one-sided books', () => {
    const book: BookState = deepFreeze({
      bids: [{ price: '100.00', orders: [{ order_id: 'xo-1', remaining: '2' }, { order_id: 'xo-2', remaining: '3' }] }],
      asks: [],
    });
    expect(topOfBook(book)).toBeNull();
    const twoSided: BookState = deepFreeze({
      bids: book.bids,
      asks: [{ price: '100.50', orders: [{ order_id: 'xo-3', remaining: '1' }] }],
    });
    const top = topOfBook(twoSided);
    expect(top?.bid_price).toBe('100.00');
    expect(top?.bid_size).toBe('5');
    expect(top?.ask_size).toBe('1');
  });

  it('bookSnapshotView emits the aggregated levels in best-first order', () => {
    const book: BookState = deepFreeze({
      bids: [
        { price: '100.00', orders: [{ order_id: 'xo-1', remaining: '1.5' }, { order_id: 'xo-2', remaining: '2.5' }] },
        { price: '99.50', orders: [{ order_id: 'xo-3', remaining: '4' }] },
      ],
      asks: [{ price: '100.50', orders: [{ order_id: 'xo-4', remaining: '0.5' }] }],
    });
    const view = bookSnapshotView(book);
    expect(view.bids).toEqual([
      { price: '100.00', size: '4' },
      { price: '99.50', size: '4' },
    ]);
    expect(view.asks).toEqual([{ price: '100.50', size: '0.5' }]);
    // The view is a market-protocol book_snapshot payload shape.
    expect(validateBookSnapshotPayload(view).length).toBe(0);
  });

  it('emptyBook is empty and frozen', () => {
    const book = emptyBook();
    expect(book.bids).toEqual([]);
    expect(book.asks).toEqual([]);
    expect(Object.isFrozen(book)).toBe(true);
    expect(add('0', '0')).toBe('0'); // arithmetic sanity anchor
  });
});
