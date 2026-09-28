/**
 * @tradrl/provider-sdk — determinism: the emission stream is a pure
 * function of the scripted transport.
 *
 * Law (Work Order T036, acceptance 4): "same scripted transport timeline
 * -> byte-identical canonical emission stream (deep-equal, twice)". The
 * byte-identity is checked BOTH as JSON.stringify equality (key order is
 * fixed by construction) and as deep structural equality.
 */

import { describe, expect, it } from 'vitest';

import {
  createAdapterSession,
  createFakeTransport,
  validateMappingTable,
  validateSourceDescriptor,
  type AdapterSession,
  type MappingTable,
  type SourceDescriptor,
  type SubscriptionSpec,
  type TimestampMs,
  type JsonObject,
} from './index';

const at = (value: number): TimestampMs => value as TimestampMs;

function fixtureDescriptor(): SourceDescriptor {
  const result = validateSourceDescriptor({
    provider: 'fixture-source',
    category: 'market-data',
    capabilities: {
      channels: ['raw-trades', 'raw-book'],
      symbol_universes: [
        { universe_id: 'uni-major', asset_class: 'crypto', instruments: ['PAIR-1'] },
      ],
      event_types: ['trade', 'book_snapshot'],
      latency_class: 'realtime',
    },
  });
  if (!result.ok) throw new Error('fixture must validate');
  return result.value;
}

function tradeTable(): MappingTable {
  const result = validateMappingTable({
    table_id: 'tbl-trade',
    event_type: 'trade',
    fields: [
      { raw_field: 'p', canonical_field: 'price', transform: { kind: 'decimal-string' } },
      { raw_field: 'q', canonical_field: 'size', transform: { kind: 'decimal-string' } },
      { raw_field: 's', canonical_field: 'side', transform: { kind: 'enum', map: { B: 'buy', S: 'sell' } } },
      { raw_field: 'tid', canonical_field: 'trade_id', required: false },
    ],
    constants: [],
    tolerated: ['seq'],
    source_time_policy: {
      event_time_basis: 'raw-field',
      event_time_field: 'ts',
      source_time_field: 'vendor_ts',
      availability_basis: 'receive-time',
    },
  });
  if (!result.ok) throw new Error('fixture must validate');
  return result.value;
}

function bookTable(): MappingTable {
  const result = validateMappingTable({
    table_id: 'tbl-book',
    event_type: 'book_snapshot',
    fields: [
      { raw_field: 'bids', canonical_field: 'bids', transform: { kind: 'levels', price_field: 'px', size_field: 'sz' } },
      { raw_field: 'asks', canonical_field: 'asks', transform: { kind: 'levels', price_field: 'px', size_field: 'sz' } },
    ],
    constants: [{ canonical_field: 'depth', value: 10 }],
    tolerated: [],
    source_time_policy: {
      event_time_basis: 'receive-time',
      event_time_field: null,
      source_time_field: null,
      availability_basis: 'receive-time',
    },
  });
  if (!result.ok) throw new Error('fixture must validate');
  return result.value;
}

const tradeSub: SubscriptionSpec = {
  channel: 'raw-trades',
  request: { symbol: 'PAIR-1' },
  venue: 'VENUE-A',
  instrument: 'PAIR-1',
  asset_class: 'crypto',
  mapping_table_id: 'tbl-trade',
};

const bookSub: SubscriptionSpec = {
  channel: 'raw-book',
  request: { symbol: 'PAIR-1', level: '10' },
  venue: 'VENUE-A',
  instrument: 'PAIR-1',
  asset_class: 'crypto',
  mapping_table_id: 'tbl-book',
};

/** A mixed script: two streams, interleaved, with a tolerated extra field. */
function mixedScript(): unknown {
  const trade = (atMs: number, seq: number, price: string, tid: string | null): JsonObject =>
    ({ ts: atMs - 40, vendor_ts: atMs - 45, p: price, q: '0.017', s: 'B', ...(tid === null ? {} : { tid }), seq }) as JsonObject;
  const book = (atMs: number, bid: string): JsonObject =>
    ({ bids: [{ px: bid, sz: '1.25' }], asks: [{ px: '101.25', sz: '0.5' }] }) as JsonObject;
  return {
    inbound: [
      { at: at(10_000), channel: 'raw-trades', payload: trade(10_000, 1, '100.5', 't-1') },
      { at: at(10_020), channel: 'raw-book', payload: book(10_020, '100.25') },
      { at: at(10_040), channel: 'raw-trades', payload: trade(10_040, 2, '100.6', null) },
      { at: at(10_060), channel: 'raw-trades', payload: trade(10_060, 3, '100.7', 't-3') },
      { at: at(10_080), channel: 'raw-book', payload: book(10_080, '100.5') },
    ],
    recv_failures: [{ before_index: 1, message: 'transient' }],
    send_failures: [],
    receive_timeout_ms: 1_000,
  };
}

function runSession(script: unknown): string {
  const transportConstruction = createFakeTransport(script);
  if (!transportConstruction.ok) throw new Error('script must validate');
  const construction = createAdapterSession({
    descriptor: fixtureDescriptor(),
    adapter: { id: 'fixture-adapter', version: '1.0.0' },
    transport: transportConstruction.transport,
    mapping_tables: [tradeTable(), bookTable()],
    entitlement: {
      entitlement_id: 'ent-fixture',
      access_class: 'restricted',
      constraints: ['license-tier-2'],
      terms_ref: null,
    },
    sequence_start: 100,
  });
  if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
  const session: AdapterSession = construction.session;

  const trace: unknown[] = [];
  const open = session.open();
  trace.push({ open: open.ok });
  trace.push({ subscribeTrade: session.subscribe(tradeSub).ok });
  trace.push({ subscribeBook: session.subscribe(bookSub).ok });
  const seen: unknown[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok) {
      seen.push({ error: { kind: next.error.kind, code: next.error.code, message: next.error.message } });
      continue; // transient failures and timeouts are part of the stream
    }
    if (next.value === null) break;
    seen.push(next.value);
  }
  trace.push({ events: seen });
  return JSON.stringify(trace);
}

describe('emission determinism', () => {
  it('the same script yields a byte-identical stream (JSON identity, twice)', () => {
    const first = runSession(mixedScript());
    const second = runSession(mixedScript());
    expect(first).toBe(second);
  });

  it('the stream contains exactly the expected canonical events (deep-equal snapshot)', () => {
    const transportConstruction = createFakeTransport(mixedScript());
    if (!transportConstruction.ok) throw new Error('script must validate');
    const construction = createAdapterSession({
      descriptor: fixtureDescriptor(),
      adapter: { id: 'fixture-adapter', version: '1.0.0' },
      transport: transportConstruction.transport,
      mapping_tables: [tradeTable(), bookTable()],
      entitlement: {
        entitlement_id: 'ent-fixture',
        access_class: 'restricted',
        constraints: ['license-tier-2'],
        terms_ref: null,
      },
      sequence_start: 100,
    });
    if (!construction.ok) throw new Error('session must construct');
    const session = construction.session;
    session.open();
    session.subscribe(tradeSub);
    session.subscribe(bookSub);

    const collected: unknown[] = [];
    for (;;) {
      const next = session.nextEvent();
      if (!next.ok) {
        collected.push(next.error);
        continue;
      }
      if (next.value === null) break;
      collected.push(next.value);
    }

    // one transient recv failure before the second message; one timeout for
    // the 40ms gap? no — the timeout budget (1000ms) exceeds every gap.
    const errors = collected.filter((entry) => (entry as { kind?: string }).kind === 'transport');
    expect(errors).toHaveLength(1);

    const events = collected.filter((entry) => (entry as { event_type?: string }).event_type !== undefined);
    expect(events).toHaveLength(5);

    const trades = events.filter((event) => (event as { event_type: string }).event_type === 'trade');
    expect(trades.map((event) => (event as { sequence: number }).sequence)).toEqual([101, 102, 103]);
    const books = events.filter((event) => (event as { event_type: string }).event_type === 'book_snapshot');
    expect(books.map((event) => (event as { sequence: number }).sequence)).toEqual([101, 102]);

    // deterministic event ids
    expect((trades[0] as { event_id: string }).event_id).toBe(
      'fixture-adapter:tbl-trade:VENUE-A|PAIR-1|trade:101',
    );
    expect((books[0] as { event_id: string }).event_id).toBe(
      'fixture-adapter:tbl-book:VENUE-A|PAIR-1|book_snapshot:101',
    );

    // constants ride along; the optional trade_id appears only when mapped
    expect((books[0] as { payload: { depth: number } }).payload.depth).toBe(10);
    expect((trades[1] as { payload: { trade_id?: string } }).payload.trade_id).toBeUndefined();
  });

  it('a different script yields a different stream (non-degenerate check)', () => {
    const base = runSession(mixedScript());
    const variant = mixedScript() as { inbound: { payload: JsonObject }[] };
    variant.inbound[0].payload = { ...variant.inbound[0].payload, p: '999.9' };
    const variantRun = runSession(variant);
    expect(variantRun).not.toBe(base);
  });
});
