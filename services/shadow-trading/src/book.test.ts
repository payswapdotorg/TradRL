/**
 * The exact-decimal book suite: hand-derived fee/position/cash sums
 * (EXACT equality — plus a one-grid-step mismatch DETECTED), the
 * fill-visibility latency window, and the L4 boundary at exact
 * equality (a record with available_time == the drain instant IS
 * delivered — inclusive) AND off-by-one millisecond (+1 is NOT).
 */

import { describe, expect, it } from 'vitest';
import {
  applyWorldFill,
  bookFromPortfolio,
  emptyBook,
  unrealizedPnlOf,
  equityOf,
  accountFillView,
  type BookMark,
  type ShadowBook,
} from './book';
import { admitWorldFill, fillIsVisible, type ReactiveFillMirror } from './world-mirror';
import { admitDrainedRecords, type MachineDrainMirror, type MachineRecordMirror } from './time-machine-mirror';
import { createScriptedMachine, T0, unwrap, unwrapMachine } from './fixtures';
import { fail } from './errors';

// ---------------------------------------------------------------------------
// The hand-derived fill fixtures (the book tests' substrate)
// ---------------------------------------------------------------------------

/** Build one world fill with FULL physics lineage (the book's input grammar). */
function worldFill(overrides: {
  readonly ordinal: number;
  readonly venue?: string;
  readonly instrument?: string;
  readonly side?: 'buy' | 'sell';
  readonly price?: string;
  readonly aggressorPrice?: string;
  readonly quantity?: string;
  readonly takerFee?: string;
  readonly makerFee?: string;
  readonly latency?: number;
  readonly at?: number;
}): ReactiveFillMirror {
  const at = (overrides.at ?? T0 + 25_000) as number;
  const latency = overrides.latency ?? 150;
  const fill = {
    fill_id: `fx-${String(overrides.ordinal).padStart(8, '0')}`,
    trade_id: `tx-${String(overrides.ordinal).padStart(8, '0')}`,
    venue: overrides.venue ?? 'SHADOWSIM',
    instrument: overrides.instrument ?? 'BTC-USD',
    quartet: { event_time: at, source_time: null, available_time: at + latency, ingestion_time: at + latency },
    sequence: overrides.ordinal,
    taker_order_id: 'eo-00000001',
    maker_order_id: 'mo-00000001',
    aggressor_side: overrides.side ?? 'buy',
    price: overrides.price ?? '50000.00',
    aggressor_price: overrides.aggressorPrice ?? overrides.price ?? '50000.00',
    quantity: overrides.quantity ?? '0.5',
    taker_fee: overrides.takerFee ?? '5',
    maker_fee: overrides.makerFee ?? '2.5',
    latency_ms: latency,
  };
  return {
    fill,
    fill_id: fill.fill_id,
    episode_id: 'ep-shadow-00000001',
    run_ref: 'run-shadow-abcdef01',
    taker_participant: 'agent-shadow-alpha',
    taker_order_id: 'eo-00000001',
    maker_order_id: 'mo-00000001',
    physics: {
      engine_config_hash: 'abcdef01',
      fee_policy: 'fees:abcdef01',
      latency_policy: 'latency:abcdef01',
      slippage_policy: 'slippage:abcdef01',
      impact_policy: 'impact:abcdef01',
      run_ref: 'run-shadow-abcdef01',
      tenant: 'tenant-shadow-alpha',
      project: 'project-shadow-alpha',
    },
  } as unknown as ReactiveFillMirror;
}

// ---------------------------------------------------------------------------
// Exact-decimal fee/position/cash sums (hand-derived, EXACT equality)
// ---------------------------------------------------------------------------

describe('exact decimals — the buy path', () => {
  it('a single buy: quantity, basis, cash and fees accumulate EXACTLY', () => {
    // Buy 0.5 @ 50000 with taker fee 5: basis 25000, cash 100000 - 25005 = 74995.
    const book = unwrap(bookFromPortfolio({ positions: [], cash: '100000' }, T0 as never));
    const effect = unwrap(applyWorldFill(book, worldFill({ ordinal: 1, quantity: '0.5', price: '50000.00', takerFee: '5' })));
    expect(effect.book.positions.length).toBe(1);
    expect(effect.book.positions[0]?.quantity).toBe('0.5');
    expect(effect.book.positions[0]?.costBasis).toBe('25000'); // 0.5 x 50000 — EXACT
    expect(effect.book.cash).toBe('74995'); // 100000 - 25000 - 5 — EXACT
    expect(effect.book.realizedPnl).toBe('0'); // buys realize nothing
    expect(effect.realizedDelta).toBe('0');
  });

  it('a second buy at a different level: the average-cost basis is the EXACT sum', () => {
    // Buy 0.5 @ 50000 (fee 5) then 0.25 @ 50050 (fee 2.5025):
    // basis 25000 + 12512.5 = 37512.5; cash 100000 - 25005 - 12515.0025 = 62479.9975.
    let book = unwrap(bookFromPortfolio({ positions: [], cash: '100000' }, T0 as never));
    book = unwrap(applyWorldFill(book, worldFill({ ordinal: 1, quantity: '0.5', price: '50000.00', takerFee: '5' }))).book;
    const second = unwrap(applyWorldFill(book, worldFill({ ordinal: 2, quantity: '0.25', price: '50050.00', takerFee: '2.5025', latency: 600 })));
    expect(second.book.positions[0]?.quantity).toBe('0.75');
    expect(second.book.positions[0]?.costBasis).toBe('37512.5'); // EXACT
    expect(second.book.cash).toBe('62479.9975'); // EXACT
  });

  it('a ONE-GRID-STEP mismatch is DETECTED (exact equality is the law)', () => {
    // The same second buy but with the fee one grid step (0.00000001) off:
    // 62479.9975 + 0.00000001 != 62479.9975 — the exact comparison fails.
    let book = unwrap(bookFromPortfolio({ positions: [], cash: '100000' }, T0 as never));
    book = unwrap(applyWorldFill(book, worldFill({ ordinal: 1, quantity: '0.5', price: '50000.00', takerFee: '5' }))).book;
    const stepOff = unwrap(applyWorldFill(book, worldFill({ ordinal: 2, quantity: '0.25', price: '50050.00', takerFee: '2.50250001', latency: 600 })));
    expect(stepOff.book.cash).not.toBe('62479.9975');
    expect(stepOff.book.cash).toBe('62479.99749999'); // the one-step drift, exactly
    // And a one-grid-step price mismatch is detected the same way.
    const priceStepOff = unwrap(applyWorldFill(book, worldFill({ ordinal: 3, quantity: '0.25', price: '50050.01', takerFee: '2.5025', latency: 600 })));
    expect(priceStepOff.book.positions[0]?.costBasis).not.toBe('37512.5');
    expect(priceStepOff.book.positions[0]?.costBasis).toBe('37512.5025');
  });

  it('a float-mediating money path is inexpressible (the typed decimal_imprecision)', () => {
    const result = bookFromPortfolio({ positions: [], cash: 100000 }, T0 as never);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('decimal_imprecision');
    const result2 = bookFromPortfolio({ positions: [{ venue: 'v', instrument: 'i', quantity: 0.5, costBasis: '1', openedAt: T0 }], cash: '1' }, T0 as never);
    expect(result2.ok).toBe(false);
    expect(!result2.ok && result2.errors[0]?.code).toBe('decimal_imprecision');
  });
});

describe('exact decimals — the sell path (the proportional basis release)', () => {
  /** The golden post-d2 book: 0.75 BTC @ basis 37512.5, cash 62479.9975. */
  function goldenBook(): ShadowBook {
    let book = unwrap(bookFromPortfolio({ positions: [], cash: '100000' }, T0 as never));
    book = unwrap(applyWorldFill(book, worldFill({ ordinal: 1, quantity: '0.5', price: '50000.00', takerFee: '5' }))).book;
    book = unwrap(applyWorldFill(book, worldFill({ ordinal: 2, quantity: '0.25', price: '50050.00', takerFee: '2.5025', latency: 600 }))).book;
    return book;
  }

  it('a sell releases the EXACT proportional basis and realizes the EXACT PnL', () => {
    // Sell 0.2 @ 49950 (taker fee 1.998) out of 0.75 @ 37512.5:
    // released = 37512.5 x 0.2 / 0.75 = 10003.33333333 (half-up at 8dp);
    // realized = 9990 - 10003.33333333 - 1.998 = -15.33133333;
    // cash = 62479.9975 + 9990 - 1.998 = 72467.9995;
    // basis after = 37512.5 - 10003.33333333 = 27509.16666667.
    const book = goldenBook();
    const effect = unwrap(applyWorldFill(book, worldFill({ ordinal: 3, side: 'sell', quantity: '0.2', price: '49950.00', takerFee: '1.998' })));
    expect(effect.realizedDelta).toBe('-15.33133333'); // EXACT, hand-derived
    expect(effect.book.realizedPnl).toBe('-15.33133333');
    expect(effect.book.cash).toBe('72467.9995'); // EXACT
    expect(effect.book.positions[0]?.quantity).toBe('0.55');
    expect(effect.book.positions[0]?.costBasis).toBe('27509.16666667'); // EXACT
  });

  it('a sell of the FULL holding closes the position (the zero-quantity filter)', () => {
    const book = goldenBook();
    const effect = unwrap(applyWorldFill(book, worldFill({ ordinal: 3, side: 'sell', quantity: '0.75', price: '49950.00', takerFee: '7.485' })));
    expect(effect.book.positions.length).toBe(0);
    // realized = 0.75 x 49950 - 37512.5 - 7.485 = 37462.5 - 37512.5 - 7.485 = -57.485 — EXACT.
    expect(effect.realizedDelta).toBe('-57.485');
    expect(effect.book.cash).toBe('99935.0125'); // 62479.9975 + 37462.5 - 7.485 — EXACT
    expect(effect.book.realizedPnl).toBe('-57.485');
  });

  it('a sell beyond the holding is the typed invalid_state (no shorts in the unsigned domain)', () => {
    const book = goldenBook();
    const result = applyWorldFill(book, worldFill({ ordinal: 3, side: 'sell', quantity: '0.8', price: '49950.00' }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('invalid_state');
  });

  it('a buy that would drive cash negative is the typed invalid_state (the cash-floor law)', () => {
    const book = unwrap(bookFromPortfolio({ positions: [], cash: '100' }, T0 as never));
    const result = applyWorldFill(book, worldFill({ ordinal: 1, quantity: '0.5', price: '50000.00', takerFee: '5' }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('invalid_state');
  });
});

describe('exact decimals — the mark-to-market split', () => {
  it('the unrealized PnL is the EXACT signed sum (mark x quantity - basis)', () => {
    let book = unwrap(bookFromPortfolio({ positions: [], cash: '100000' }, T0 as never));
    book = unwrap(applyWorldFill(book, worldFill({ ordinal: 1, quantity: '0.5', price: '50000.00', takerFee: '5' }))).book;
    const marks: BookMark[] = [{ venue: 'SHADOWSIM', instrument: 'BTC-USD', price: '52000.00', source: 'last_trade' }];
    // unrealized = 0.5 x 52000 - 25000 = 1000 — EXACT; equity = 74995 + 26000 = 100995.
    expect(unrealizedPnlOf(book, marks)).toBe('1000');
    expect(equityOf(book, marks)).toBe('100995');
    // A mark BELOW the basis: unrealized goes negative — the signed grammar.
    const falling: BookMark[] = [{ venue: 'SHADOWSIM', instrument: 'BTC-USD', price: '48000.00', source: 'last_trade' }];
    expect(unrealizedPnlOf(book, falling)).toBe('-1000');
  });

  it('an unmarked position contributes -basis (the declared conservative convention)', () => {
    let book = unwrap(bookFromPortfolio({ positions: [], cash: '100000' }, T0 as never));
    book = unwrap(applyWorldFill(book, worldFill({ ordinal: 1, quantity: '0.5', price: '50000.00', takerFee: '5' }))).book;
    expect(unrealizedPnlOf(book, [])).toBe('-25000');
  });
});

// ---------------------------------------------------------------------------
// The account-role views (taker vs maker)
// ---------------------------------------------------------------------------

describe('the account-role views', () => {
  it('the taker view: the aggressor side, the aggressor price, the taker fee', () => {
    const view = unwrap(accountFillView(worldFill({ ordinal: 1, side: 'buy', price: '50000.00', takerFee: '5' }).fill, 'taker'));
    expect(view.side).toBe('buy');
    expect(view.price).toBe('50000'); // the canonical normalization strips trailing zeros
    expect(view.fee).toBe('5');
  });

  it('the maker view: the OPPOSITE side, the level price, the maker fee', () => {
    const view = unwrap(accountFillView(worldFill({ ordinal: 1, side: 'buy', price: '50000.00', makerFee: '2.5' }).fill, 'maker'));
    expect(view.side).toBe('sell');
    expect(view.price).toBe('50000');
    expect(view.fee).toBe('2.5');
  });

  it('the maker-role book application: the level price + the maker fee', () => {
    // My resting sell is hit by an incoming buy: the fill's aggressor_side is 'buy'
    // (the OTHER party); MY side is 'sell' at the level price with the maker fee.
    let book = unwrap(bookFromPortfolio({ positions: [], cash: '100000' }, T0 as never));
    book = unwrap(applyWorldFill(book, worldFill({ ordinal: 1, quantity: '0.5', price: '50000.00', takerFee: '5' }))).book;
    const hit = unwrap(applyWorldFill(book, worldFill({ ordinal: 2, side: 'buy', quantity: '0.2', price: '49950.00', takerFee: '1.998', makerFee: '0.999' }), 'maker'));
    // MY account: sold 0.2 @ 49950 with the 0.999 maker fee.
    expect(hit.book.positions[0]?.quantity).toBe('0.3');
    expect(hit.book.cash).toBe('84984.001'); // 74995 + 9990 - 0.999 — EXACT
    expect(hit.realizedDelta).toBe('-10.999'); // 9990 - released basis 10000 - 0.999 — EXACT
  });
});

// ---------------------------------------------------------------------------
// Fill visibility (the latency window)
// ---------------------------------------------------------------------------

describe('fill visibility — a fill is NEVER visible before its latency window elapses', () => {
  it('the inclusive law: available_time == now IS visible; +1 is NOT', () => {
    const at = (T0 + 25_150) as never;
    const visible = worldFill({ ordinal: 1, quantity: '0.5', price: '50000.00', latency: 150 });
    expect((visible.fill.quartet.available_time as number)).toBe(T0 + 25_150);
    expect(fillIsVisible(visible.fill, at)).toBe(true);
    expect(fillIsVisible(visible.fill, (T0 + 25_149) as never)).toBe(false);
    expect(fillIsVisible(visible.fill, (T0 + 25_151) as never)).toBe(true);
  });

  it('the typed gate: admitting an embargoed fill fails l4_boundary_violation', () => {
    const visible = worldFill({ ordinal: 1, quantity: '0.5', price: '50000.00', latency: 600 });
    const early = admitWorldFill(visible, (T0 + 25_000) as never);
    expect(early.ok).toBe(false);
    expect(!early.ok && early.errors[0]?.code).toBe('l4_boundary_violation');
    const exact = admitWorldFill(visible, (T0 + 25_600) as never);
    expect(exact.ok).toBe(true);
  });

  it('the latency window in the session flow: an embargoed fill stays OUT of the book until its instant', () => {
    // The fill applies at its availability instant — not before, not after.
    let book = unwrap(bookFromPortfolio({ positions: [], cash: '100000' }, T0 as never));
    const fill = worldFill({ ordinal: 1, quantity: '0.5', price: '50000.00', latency: 600 });
    const admitted = admitWorldFill(fill, (T0 + 25_599) as never);
    expect(admitted.ok).toBe(false);
    expect(!admitted.ok && admitted.errors[0]?.code).toBe('l4_boundary_violation');
    const admittedExact = unwrap(admitWorldFill(fill, (T0 + 25_600) as never));
    book = unwrap(applyWorldFill(book, admittedExact)).book;
    expect(book.positions[0]?.quantity).toBe('0.5');
  });
});

// ---------------------------------------------------------------------------
// The L4 boundary over DRAINED records (the machine contract)
// ---------------------------------------------------------------------------

describe('the L4 boundary — the drain delivers available_time == now (INCLUSIVE); +1 does NOT', () => {
  /** A drain mirror carrying the given records at the given instant. */
  function drain(records: readonly MachineRecordMirror[], at: number): MachineDrainMirror {
    return {
      cursor_id: 'cur-shadow-00000001',
      at: at as never,
      records,
      position: records.length,
      advanced: records.length > 0,
      audit: { tenant: 'tenant-shadow-alpha', at: at as never, scanned: records.length, decisions: [] },
    } as MachineDrainMirror;
  }

  it('a record with available_time == the drain instant IS delivered (inclusive)', () => {
    const machine = createScriptedMachine();
    // mk-0002 is available at EXACTLY T0+25_000 (d1's drain instant).
    const drained = unwrapMachine(machine.drainCursor(unwrapMachine(machine.openCursor({ from: 'start' })).cursor_id, (T0 + 25_000) as never));
    expect(drained.records.map((record) => record.record_id)).toEqual(['mk-0001', 'mk-0002']);
    expect(unwrap(admitDrainedRecords(drained)).length).toBe(2);
  });

  it('the off-by-one millisecond: +1 is NOT delivered at the earlier instant', () => {
    const machine = createScriptedMachine();
    // At T0+25_000, mk-0003 (available T0+25_001) is NOT delivered.
    const drained = unwrapMachine(machine.drainCursor(unwrapMachine(machine.openCursor({ from: 'start' })).cursor_id, (T0 + 25_000) as never));
    expect(drained.records.some((record) => record.record_id === 'mk-0003')).toBe(false);
    // One millisecond later, it IS.
    const next = unwrapMachine(machine.drainCursor(drained.cursor_id, (T0 + 25_001) as never));
    expect(next.records.map((record) => record.record_id)).toEqual(['mk-0003']);
  });

  it('the typed defense-in-depth: a leaked record fails l4_boundary_violation', () => {
    const leaked = [
      { record_id: 'mk-9999', tenant: 'tenant-shadow-alpha', payload: {}, event_time: T0, source_time: null, available_time: T0 + 100, ingestion_time: T0 + 100, inputs: [], computation: null, provenance: {}, arrival_sequence: 0 },
    ] as unknown as readonly MachineRecordMirror[];
    const result = admitDrainedRecords(drain(leaked, T0));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('l4_boundary_violation');
    expect(!result.ok && result.errors[0]?.message).toContain('mk-9999');
  });

  it('the (available_time, record_id) ordering holds across a multi-record drain', () => {
    const machine = createScriptedMachine();
    const drained = unwrapMachine(machine.drainCursor(unwrapMachine(machine.openCursor({ from: 'start' })).cursor_id, (T0 + 150_000) as never));
    expect(drained.records.map((record) => record.record_id)).toEqual(['mk-0001', 'mk-0002', 'mk-0003', 'mk-0004', 'mk-0005', 'mk-0006']);
  });
});

// ---------------------------------------------------------------------------
// The empty book + guards
// ---------------------------------------------------------------------------

describe('the book guards', () => {
  it('the empty book is empty', () => {
    const book = emptyBook(T0 as never);
    expect(book.positions.length).toBe(0);
    expect(book.cash).toBe('0');
  });

  it('the genesis netting discipline rejects duplicate (venue, instrument) rows', () => {
    const result = bookFromPortfolio({
      positions: [
        { venue: 'SHADOWSIM', instrument: 'BTC-USD', quantity: '0.5', costBasis: '25000', openedAt: T0 },
        { venue: 'SHADOWSIM', instrument: 'BTC-USD', quantity: '0.25', costBasis: '12512.5', openedAt: T0 },
      ],
      cash: '100000',
    }, T0 as never);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('invalid_field');
  });

  it('a fill without physics lineage is the typed physics_lineage_missing', () => {
    const book = unwrap(bookFromPortfolio({ positions: [], cash: '100000' }, T0 as never));
    const orphan = { fill_id: 'fx-00000001' } as unknown as ReactiveFillMirror;
    const result = applyWorldFill(book, orphan);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe('physics_lineage_missing');
    // The lineage-block variants too.
    const noPhysics = { ...worldFill({ ordinal: 1 }), physics: undefined } as unknown as ReactiveFillMirror;
    const result2 = applyWorldFill(book, noPhysics);
    expect(result2.ok).toBe(false);
    expect(!result2.ok && result2.errors[0]?.code).toBe('physics_lineage_missing');
  });
});

// (The fail import keeps the module's dependency surface explicit for the suite.)
void fail;
