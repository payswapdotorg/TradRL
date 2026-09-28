/**
 * The OrderIntent mirror against the REAL @tradrl/domain-core (present on
 * this branch): a domain-core `Order` IS an `OrderIntent` and vice versa
 * (type-level witnesses + runtime guard parity), plus the mirrored
 * matrices and the collect-all validation's negative paths.
 */

import { describe, expect, it } from 'vitest';

import {
  CORE_ORDER_KINDS,
  CORE_TIME_IN_FORCE,
  ORDER_SIDES,
  isOrderIntent,
  isTimestamp,
  validateOrderIntent,
  type OrderIntent,
} from './domain-mirror';
import type { Order, OrderSide } from '../../domain-core/src/order';
import { isOrder as domainIsOrder, ORDER_SIDES as DOMAIN_SIDES, CORE_ORDER_KINDS as DOMAIN_KINDS, CORE_TIME_IN_FORCE as DOMAIN_TIF } from '../../domain-core/src/order';
import { requireTimestampMs } from './timestamp';
import type { InstrumentId, VenueId } from './index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if the mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff a domain-core Order is assignable to an OrderIntent. */
function domainOrderIsIntent(value: Order): OrderIntent {
  return value;
}

/** Compiles iff an OrderIntent is assignable to a domain-core Order. */
function intentIsDomainOrder(value: OrderIntent): Order {
  return value;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VENUE = 'BINANCE' as const;
const INSTRUMENT = 'BTC-USDT' as const;
const CREATED = '2026-01-01T00:00:00Z';

function intentFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientOrderId: 'cli-1',
    instrumentId: INSTRUMENT,
    venueId: VENUE,
    side: 'buy',
    kind: 'limit',
    quantity: '1.5',
    price: '43125.10',
    timeInForce: 'gtc',
    createdAt: CREATED,
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

describe('OrderIntent structural mirror (domain-core Order)', () => {
  it('a domain-core-valid Order passes the OrderIntent guard, and vice versa', () => {
    const domainShaped = intentFixture();
    expect(domainIsOrder(domainShaped)).toBe(true);
    expect(isOrderIntent(domainShaped)).toBe(true);
    const validated = unwrap(validateOrderIntent(domainShaped, { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId }));
    expect(domainIsOrder(validated)).toBe(true);
    // Type-level witnesses compile both directions.
    const asIntent: OrderIntent = domainOrderIsIntent(validated);
    const asOrder: Order = intentIsDomainOrder(asIntent);
    expect(asOrder.clientOrderId).toBe('cli-1');
  });

  it('the mirrored vocabularies are identical to domain-core', () => {
    expect(ORDER_SIDES).toEqual(DOMAIN_SIDES);
    expect(CORE_ORDER_KINDS).toEqual(DOMAIN_KINDS);
    expect(CORE_TIME_IN_FORCE).toEqual(DOMAIN_TIF);
    expect(ORDER_SIDES).toEqual(['buy', 'sell']);
    expect(CORE_ORDER_KINDS).toEqual(['market', 'limit', 'stop', 'stop-limit']);
    expect(CORE_TIME_IN_FORCE).toEqual(['day', 'gtc', 'ioc', 'fok', 'gtt']);
  });

  it('the mirrored guards agree on accept/reject across a boundary sample', () => {
    const samples: readonly unknown[] = [
      intentFixture(),
      intentFixture({ kind: 'market', price: undefined }),
      intentFixture({ kind: 'market', price: '100' }), // matrix violation
      intentFixture({ kind: 'limit', price: undefined }), // matrix violation
      intentFixture({ kind: 'stop', stopPrice: '100' }),
      intentFixture({ kind: 'stop-limit', price: '100', stopPrice: '101' }),
      intentFixture({ timeInForce: 'gtt', expiresAt: '2026-02-01T00:00:00Z' }),
      intentFixture({ timeInForce: 'gtc', expiresAt: '2026-02-01T00:00:00Z' }), // TIF matrix violation
      intentFixture({ quantity: '0' }),
      intentFixture({ quantity: '01.5' }), // non-canonical decimal
      intentFixture({ quantity: '-1' }),
      intentFixture({ price: '01.2' }),
      intentFixture({ createdAt: '2026-01-01T00:00:00' }), // missing offset
      intentFixture({ clientOrderId: '' }),
      intentFixture({ notes: '   ' }),
      { not: 'an order' },
      null,
      42,
    ];
    for (const sample of samples) {
      expect(isOrderIntent(sample), JSON.stringify(sample)).toBe(domainIsOrder(sample));
    }
  });
});

describe('validateOrderIntent (collect-all + engine binding)', () => {
  it('validates a good intent deeply frozen', () => {
    const result = validateOrderIntent(intentFixture(), { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value.price).toBe('43125.10');
  });

  it('collects every violation with dotted paths', () => {
    const result = validateOrderIntent(
      { side: 'up', quantity: '0', createdAt: 'nope' },
      { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.errors.map((error) => error.path);
    expect(paths).toContain('intent.clientOrderId');
    expect(paths).toContain('intent.instrumentId');
    expect(paths).toContain('intent.venueId');
    expect(paths).toContain('intent.side');
    expect(paths).toContain('intent.kind');
    expect(paths).toContain('intent.quantity');
    expect(paths).toContain('intent.timeInForce');
    expect(paths).toContain('intent.createdAt');
  });

  it('rejects intents bound to a different venue or instrument (typed, before any state)', () => {
    const wrongVenue = validateOrderIntent(intentFixture({ venueId: 'COINBASE' }), { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId });
    expect(wrongVenue.ok).toBe(false);
    if (wrongVenue.ok) return;
    expect(wrongVenue.errors[0]?.code).toBe('invalid_field');
    expect(wrongVenue.errors[0]?.path).toBe('intent.venueId');

    const wrongInstrument = validateOrderIntent(intentFixture({ instrumentId: 'ETH-USDT' }), { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId });
    expect(wrongInstrument.ok).toBe(false);
  });

  it('enforces the price matrix and the TIF expiry matrix (mirrored laws)', () => {
    expect(validateOrderIntent(intentFixture({ kind: 'market', price: undefined }), { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId }).ok).toBe(true);
    expect(validateOrderIntent(intentFixture({ kind: 'market', price: '100' }), { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId }).ok).toBe(false);
    expect(validateOrderIntent(intentFixture({ kind: 'limit', price: undefined }), { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId }).ok).toBe(false);
    expect(validateOrderIntent(intentFixture({ kind: 'stop', stopPrice: '43000', price: undefined }), { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId }).ok).toBe(true);
    expect(validateOrderIntent(intentFixture({ timeInForce: 'gtt', expiresAt: '2026-02-01T00:00:00Z' }), { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId }).ok).toBe(true);
    expect(validateOrderIntent(intentFixture({ timeInForce: 'gtc', expiresAt: '2026-02-01T00:00:00Z' }), { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId }).ok).toBe(false);
    expect(validateOrderIntent(intentFixture({ timeInForce: 'gtt' }), { venue:(VENUE) as VenueId, instrument:(INSTRUMENT) as InstrumentId }).ok).toBe(false);
  });

  it('open vocabularies stay open (registered kinds/TIFs pass the envelope)', () => {
    expect(isOrderIntent(intentFixture({ kind: 'iceberg' }))).toBe(true);
    expect(isOrderIntent(intentFixture({ timeInForce: 'opg' }))).toBe(true);
  });
});

describe('Timestamp mirror', () => {
  it('accepts RFC 3339 with explicit offsets and rejects calendar-only strings', () => {
    expect(isTimestamp('2026-01-01T00:00:00Z')).toBe(true);
    expect(isTimestamp('2026-01-01T00:00:00+02:00')).toBe(true);
    expect(isTimestamp('2026-01-01T00:00:00.500Z')).toBe(true);
    expect(isTimestamp('2026-01-01T00:00:00')).toBe(false);
    expect(isTimestamp('2026-01-01')).toBe(false);
    expect(isTimestamp('not a timestamp')).toBe(false);
    expect(isTimestamp(42)).toBe(false);
  });

  it('guards the TimestampMs range mirror (parity anchors for interop)', () => {
    expect(requireTimestampMs(0)).toBe(0);
    expect(requireTimestampMs(8_639_999_999_999_999)).toBe(8_639_999_999_999_999);
    expect(() => requireTimestampMs(-1)).toThrow(RangeError);
    expect(() => requireTimestampMs(8_640_000_000_000_000)).toThrow(RangeError);
  });
});
