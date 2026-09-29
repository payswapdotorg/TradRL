/**
 * @tradrl/adapter-news — the INVERSE-neutrality trip-wire.
 *
 * Acceptance criterion 4: "a test asserts the CANONICAL emitted events
 * contain no provider-specific field names (Binance/Coinbase vocabulary
 * lives only in descriptor/mapping/session layers)."
 *
 * Law L2/L13 read inversely: the SDK must contain no provider name; THIS
 * adapter is where the news wire vocabulary lives — but ONLY in the
 * declaration layers (descriptor, schemas, mapping tables, guard). The
 * emitted CANONICAL events must be provider-neutral market-protocol
 * shapes: no wire raw field name may appear as a field of an emitted
 * event (beyond the four names the canonical news payload contract
 * itself shares), and the documented raw payload forms (publisher codes)
 * must not leak into the canonical values.
 *
 * The test walks every emitted event RECURSIVELY, collecting every field
 * name, and asserts the intersection with the adapter's exported
 * provider vocabulary ({@link NEWS_RAW_FIELD_NAMES}) is empty; it also
 * proves the positive direction — the vocabulary DOES live in the
 * declaration layers.
 */

import { describe, expect, it } from 'vitest';

import {
  createNewsAdapterSession,
  newsSubscription,
  NEWS_WIRE_SERVICE_ENTITLEMENT,
  NEWS_RAW_FIELD_NAMES,
  NEWS_SOURCE_DESCRIPTOR,
  NEWS_MAPPING_TABLES,
  accountedRawFields,
  deriveWireItemPayload,
  derivePublicHeadlinePayload,
  guardWireItemPayload,
  type AdapterSession,
  type EmittedEvent,
  type JsonObject,
} from './index';
import { createFakeTransport, type TransportScript, type TimestampMs } from '../../../packages/provider-sdk/src/index';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_717_423_200_000;

/** Emit a stream covering BOTH documented channels (including a released embargo), with canonical identity values only. */
function emitAll(): EmittedEvent[] {
  const transportScript: TransportScript = {
    inbound: [
      {
        at: ms(AT0),
        channel: 'licensedWire',
        payload: {
          recordType: 'NEWS_ITEM',
          itemId: 'WIRE-ITEM-0001',
          publisherCode: 'PUB-A',
          publishedTimeMs: AT0,
          headline: 'Synthetic test headline one',
          body: 'Synthetic wire body.',
          tickers: ['TEST-AAA'],
          tags: ['TEST-TAG-EARNINGS'],
          url: 'https://example.invalid/item/1',
          embargoTimeMs: AT0 + 5,
        },
      },
      {
        at: ms(AT0 + 10),
        channel: 'publicHeadlines',
        payload: {
          recordType: 'NEWS_ITEM',
          itemId: 'PUBLIC-ITEM-0002',
          publisherCode: 'PUB-B',
          publishedTimeMs: AT0 + 10,
          headline: 'Synthetic public headline two',
          tickers: ['TEST-BBB'],
        },
      },
    ],
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  };
  const construction = createFakeTransport(transportScript);
  if (!construction.ok) throw new Error('script must validate');
  const sessionConstruction = createNewsAdapterSession({
    transport: construction.transport,
    entitlement: NEWS_WIRE_SERVICE_ENTITLEMENT,
  });
  if (!sessionConstruction.ok) throw new Error('session must construct');
  const session: AdapterSession = sessionConstruction.session;
  session.open();
  for (const [channel, instrument] of [
    ['licensedWire', 'TEST-AAA'],
    ['publicHeadlines', 'TEST-BBB'],
  ] as const) {
    const spec = newsSubscription({ channel, instrument });
    if (!spec.ok) throw new Error(`subscription must build: ${spec.error.message}`);
    const sent = session.subscribe(spec.value);
    if (!sent.ok) throw new Error(`subscribe must succeed: ${sent.error.message}`);
  }
  const events: EmittedEvent[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok) throw new Error(`unexpected failure: ${next.error.code}`);
    if (next.value === null) break;
    events.push(next.value);
  }
  return events;
}

/** Recursively collect every field name of a JSON-shaped value. */
function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const element of value) collectKeys(element, keys);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
}

describe('the inverse-neutrality trip-wire (criterion 4)', () => {
  const events = emitAll();

  it('every documented channel emits (the walk is not vacuous)', () => {
    expect(events.length).toBe(2);
    expect(events.every((event) => event.event_type === 'news')).toBe(true);
  });

  it('NO provider-specific field name appears anywhere in the emitted canonical events (L2)', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event, keys);
    expect(keys.size).toBeGreaterThan(20); // the walk must actually cover the records
    // "headline", "body", "url" and "tags" are shared by the canonical news
    // payload contract itself; every OTHER documented wire field name is
    // provider-only and banned.
    const canonicalOverlap = ['headline', 'body', 'url', 'tags'];
    const banned = (NEWS_RAW_FIELD_NAMES as readonly string[]).filter((name) => !canonicalOverlap.includes(name));
    expect(banned.length).toBeGreaterThanOrEqual(6); // the banned list is substantial
    const violations = [...keys].filter((key) => banned.includes(key));
    expect(violations).toEqual([]);
  });

  it('the emitted field names are the canonical contract vocabulary only', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event, keys);
    const canonicalFields = [
      'event_id', 'venue', 'instrument', 'asset_class', 'event_type',
      'event_time', 'source_time', 'available_time', 'ingestion_time',
      'sequence', 'provider', 'provenance', 'entitlement', 'mapping', 'payload',
      'origin', 'adapter', 'id', 'version', 'derived_from', 'transform',
      'entitlement_id', 'constraints', 'table_id', 'source_time_policy',
      'event_time_basis', 'event_time_field', 'source_time_field', 'availability_basis',
      'headline', 'body', 'source', 'symbols', 'url', 'tags',
    ];
    for (const key of keys) {
      expect(canonicalFields).toContain(key);
    }
  });

  it('the documented raw payload FORMS do not leak into the canonical values', () => {
    const serialized = JSON.stringify(events);
    // The publisher codes never appear; the enum-translated neutral
    // editorial source labels do.
    expect(serialized).not.toContain('PUB-A');
    expect(serialized).not.toContain('PUB-B');
    expect(serialized).toContain('"source":"publisher-a"');
    expect(serialized).toContain('"source":"publisher-b"');
    // The record-type discriminator and the guard-consumed names never appear.
    expect(serialized).not.toContain('NEWS_ITEM');
    // NOTE: the DECLARED time-policy field name ("publishedTimeMs") appears
    // as a VALUE inside the mapping provenance block
    // (mapping.source_time_policy.event_time_field) — the SDK's L4/L9
    // design: every record is self-describing about its own translation.
    // The raw embargo field name never appears anywhere (guard-consumed).
    expect(serialized).not.toContain('"embargoTimeMs"');
    expect(serialized).not.toContain('"itemId"');
  });

  it('the provider vocabulary DOES live in the declaration layers (the L2 inverse: HERE)', () => {
    // The descriptor carries the provider id and the channel vocabulary.
    expect(NEWS_SOURCE_DESCRIPTOR.provider).toBe('news-wire-a');
    expect(NEWS_SOURCE_DESCRIPTOR.capabilities.channels).toContain('licensedWire');
    // The mapping tables declare the derived emitter-facing fields (the
    // publisher code is mapped through the declared enum).
    const wireTable = NEWS_MAPPING_TABLES.find((table) => table.table_id === 'news-licensed-wire-item');
    if (wireTable === undefined) throw new Error('the wire table must exist');
    const accounted = accountedRawFields(wireTable);
    expect(accounted).toContain('publisherCode');
    expect(accounted).toContain('headline');
    expect(accounted).toContain('tickers');
    // The schema layer exports the documented vocabulary.
    expect(NEWS_RAW_FIELD_NAMES).toContain('recordType');
    expect(NEWS_RAW_FIELD_NAMES).toContain('embargoTimeMs');
    expect(NEWS_RAW_FIELD_NAMES.length).toBeGreaterThanOrEqual(10);
    // The derivation keeps the documented names on the guard side (never
    // the emitter side).
    const guarded = guardWireItemPayload({
      recordType: 'NEWS_ITEM', itemId: 'WIRE-X', publisherCode: 'PUB-A', publishedTimeMs: AT0,
      headline: 'h', body: 'b', tickers: ['TEST-AAA'], tags: ['T'], url: 'https://example.invalid/x',
      embargoTimeMs: AT0,
    } as JsonObject);
    if (!guarded.ok) throw new Error('must guard');
    expect(deriveWireItemPayload(guarded.value)).toHaveProperty('publisherCode');
    const publicGuarded = guardWireItemPayload({
      recordType: 'NEWS_ITEM', itemId: 'WIRE-Y', publisherCode: 'PUB-B', publishedTimeMs: AT0,
      headline: 'h', tickers: ['TEST-BBB'],
    } as JsonObject);
    if (!publicGuarded.ok) throw new Error('must guard');
    expect(derivePublicHeadlinePayload(publicGuarded.value as unknown as Parameters<typeof derivePublicHeadlinePayload>[0])).toHaveProperty('publisherCode');
  });
});
