/**
 * @tradrl/adapter-brokers — the INVERSE-neutrality trip-wire.
 *
 * Acceptance criterion 4: "a test asserts the CANONICAL emitted events
 * contain no provider-specific field names (provider vocabulary lives
 * only in descriptor/mapping/session layers)."
 *
 * Law L2/L13 read inversely: the SDK must contain no provider name; THIS
 * adapter is where the broker-gateway vocabulary lives — but ONLY in the
 * declaration layers (descriptor, schemas, mapping tables, guard). The
 * emitted CANONICAL events must be provider-neutral market-protocol
 * shapes: no broker-gateway raw field name may appear as a field of an
 * emitted event, and the documented raw payload forms must not leak into
 * the canonical values.
 *
 * The test walks every emitted event RECURSIVELY, collecting every field
 * name, and asserts the intersection with the adapter's exported
 * provider vocabulary ({@link BROKER_RAW_FIELD_NAMES}) is empty; it also
 * proves the positive direction — the vocabulary DOES live in the
 * declaration layers (the mapping tables account for the derived raw
 * fields, the descriptor carries the provider id and channel names), and
 * the L8 routing message (which legitimately carries the documented FIX
 * vocabulary — it is OUTBOUND protocol traffic, never a canonical event)
 * never enters the emission path.
 */

import { describe, expect, it } from 'vitest';

import {
  createBrokerAdapterSession,
  brokerExecutionReportSubscription,
  BROKER_ENTITLEMENT,
  BROKER_RAW_FIELD_NAMES,
  BROKER_SOURCE_DESCRIPTOR,
  BROKER_MAPPING_TABLES,
  accountedRawFields,
  type AdapterSession,
  type EmittedEvent,
} from './index';
import { createFakeTransport, type TransportScript, type TimestampMs } from '../../../packages/provider-sdk/src/index';
import { fixtureExecutionReport, fixturePartialFill, fixtureFill } from './test-fixtures';

const ms = (value: number): TimestampMs => value as TimestampMs;
const T0 = 1_717_459_200_000;

/** Emit a stream covering the documented report channel, with canonical identity values only. */
function emitAll(): EmittedEvent[] {
  const transportScript: TransportScript = {
    inbound: [
      { at: ms(T0), channel: 'executionReport', payload: fixtureExecutionReport() as never },
      { at: ms(T0 + 500), channel: 'executionReport', payload: fixturePartialFill() as never },
      { at: ms(T0 + 1_000), channel: 'executionReport', payload: fixtureFill() as never },
    ],
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  };
  const construction = createFakeTransport(transportScript);
  if (!construction.ok) throw new Error('script must validate');
  const sessionConstruction = createBrokerAdapterSession({
    transport: construction.transport,
    entitlement: BROKER_ENTITLEMENT,
  });
  if (!sessionConstruction.ok) throw new Error('session must construct');
  const session: AdapterSession = sessionConstruction.session;
  session.open();
  const spec = brokerExecutionReportSubscription({ instrument: 'BTC-USDT' });
  if (!spec.ok) throw new Error(`subscription must build: ${spec.error.message}`);
  const sent = session.subscribe(spec.value);
  if (!sent.ok) throw new Error(`subscribe must succeed: ${sent.error.message}`);
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

  it('the documented report stream emits (the walk is not vacuous)', () => {
    expect(events.length).toBe(3);
    expect(events.every((event) => event.event_type === 'other')).toBe(true);
    expect(events.every((event) => event.payload.kind === 'execution_report')).toBe(true);
  });

  it('NO provider-specific field name appears anywhere in the emitted canonical events (L2)', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event, keys);
    expect(keys.size).toBeGreaterThan(20); // the walk must actually cover the records
    // "venue" and "side" are shared by the canonical contracts themselves
    // (the envelope's venue; the trade vocabulary reused in the derived
    // data); every OTHER documented broker field name is provider-only and
    // banned.
    const canonicalOverlap = ['venue', 'side'];
    const banned = (BROKER_RAW_FIELD_NAMES as readonly string[]).filter((name) => !canonicalOverlap.includes(name));
    expect(banned.length).toBeGreaterThan(15); // the banned list is substantial
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
      'kind', 'data',
      'order_id', 'client_order_id', 'exec_id', 'exec_type', 'order_status',
      'side', 'order_qty', 'last_qty', 'last_px', 'cum_qty', 'leaves_qty', 'avg_px',
    ];
    for (const key of keys) {
      expect(canonicalFields).toContain(key);
    }
  });

  it('the documented raw payload FORMS do not leak into the canonical values', () => {
    const serialized = JSON.stringify(events);
    // The canonical instrument id ("BTC-USDT") appears; the documented raw
    // status/exec code domains do not (the canonical names do).
    expect(serialized).toContain('"order_status":"filled"');
    expect(serialized).toContain('"exec_type":"partial_fill"');
    expect(serialized).not.toContain('"OrdStatus"');
    expect(serialized).not.toContain('"ExecType"');
    expect(serialized).not.toContain('"MsgType"');
    expect(serialized).not.toContain('ORDER_STATUS');
    expect(serialized).not.toContain('PARTIALLY_FILLED');
  });

  it('the provider vocabulary DOES live in the declaration layers (the L2 inverse: HERE)', () => {
    // The descriptor carries the provider id and the channel vocabulary.
    expect(BROKER_SOURCE_DESCRIPTOR.provider).toBe('fix-broker-gateway');
    expect(BROKER_SOURCE_DESCRIPTOR.capabilities.channels).toContain('executionReport');
    // The mapping tables account for the derived emitter-facing raw fields.
    const reportTable = BROKER_MAPPING_TABLES.find((table) => table.table_id === 'broker-execution-report');
    if (reportTable === undefined) throw new Error('the report table must exist');
    const accounted = accountedRawFields(reportTable);
    expect(accounted).toContain('data');
    expect(accounted).toContain('transactTimeMs');
    // The schema layer exports the documented vocabulary.
    expect(BROKER_RAW_FIELD_NAMES).toContain('ClOrdID');
    expect(BROKER_RAW_FIELD_NAMES).toContain('CumQty');
    expect(BROKER_RAW_FIELD_NAMES.length).toBeGreaterThan(15);
  });
});
