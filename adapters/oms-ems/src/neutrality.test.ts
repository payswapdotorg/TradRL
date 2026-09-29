/**
 * @tradrl/adapter-oms-ems — the INVERSE-neutrality trip-wire.
 *
 * Acceptance criterion 4: "a test asserts the CANONICAL emitted events
 * contain no provider-specific field names (provider vocabulary lives
 * only in descriptor/mapping/session layers)."
 *
 * Law L2/L13 read inversely: the SDK must contain no provider name; THIS
 * adapter is where the OMS/EMS vocabulary lives — but ONLY in the
 * declaration layers (descriptor, schemas, mapping tables, guard). The
 * emitted CANONICAL events must be provider-neutral market-protocol
 * shapes: no OMS/EMS raw field name may appear as a field of an emitted
 * event, and the documented raw payload forms must not leak into the
 * canonical values.
 *
 * The test walks every emitted event RECURSIVELY, collecting every field
 * name, and asserts the intersection with the adapter's exported
 * provider vocabulary ({@link OMS_EMS_RAW_FIELD_NAMES}) is empty; it
 * also proves the positive direction — the vocabulary DOES live in the
 * declaration layers — and that the L8 routing instruction (which
 * legitimately carries the documented camelCase vocabulary — it is
 * OUTBOUND protocol traffic, never a canonical event) never enters the
 * emission path.
 */

import { describe, expect, it } from 'vitest';

import {
  createOmsEmsAdapterSession,
  omsEmsOrderStateSubscription,
  OMS_EMS_ENTITLEMENT,
  OMS_EMS_RAW_FIELD_NAMES,
  OMS_EMS_SOURCE_DESCRIPTOR,
  OMS_EMS_MAPPING_TABLES,
  accountedRawFields,
  type AdapterSession,
  type EmittedEvent,
} from './index';
import { createFakeTransport, type TransportScript, type TimestampMs } from '../../../packages/provider-sdk/src/index';
import { fixtureOrderState, fixturePartiallyFilledState, fixtureFilledState } from './test-fixtures';

const ms = (value: number): TimestampMs => value as TimestampMs;
const T0 = 1_717_459_200_000;

/** Emit a stream covering the documented state channel, with canonical identity values only. */
function emitAll(): EmittedEvent[] {
  const transportScript: TransportScript = {
    inbound: [
      { at: ms(T0), channel: 'orderState', payload: fixtureOrderState() as never },
      { at: ms(T0 + 500), channel: 'orderState', payload: fixturePartiallyFilledState() as never },
      { at: ms(T0 + 1_000), channel: 'orderState', payload: fixtureFilledState() as never },
    ],
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  };
  const construction = createFakeTransport(transportScript);
  if (!construction.ok) throw new Error('script must validate');
  const sessionConstruction = createOmsEmsAdapterSession({
    transport: construction.transport,
    entitlement: OMS_EMS_ENTITLEMENT,
  });
  if (!sessionConstruction.ok) throw new Error('session must construct');
  const session: AdapterSession = sessionConstruction.session;
  session.open();
  const spec = omsEmsOrderStateSubscription({ instrument: 'BTC-USDT' });
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

  it('the documented state stream emits (the walk is not vacuous)', () => {
    expect(events.length).toBe(3);
    expect(events.every((event) => event.event_type === 'other')).toBe(true);
    expect(events.every((event) => event.payload.kind === 'order_state')).toBe(true);
  });

  it('NO provider-specific field name appears anywhere in the emitted canonical events (L2)', () => {
    const keys = new Set<string>();
    for (const event of events) collectKeys(event, keys);
    expect(keys.size).toBeGreaterThan(20); // the walk must actually cover the records
    // "venue", "status" and "sequence" are shared by the canonical
    // vocabulary itself (the envelope's venue and sequence; the derived
    // data's status); every OTHER documented OMS/EMS field name is
    // provider-only and banned.
    const canonicalOverlap = ['venue', 'status', 'sequence'];
    const banned = (OMS_EMS_RAW_FIELD_NAMES as readonly string[]).filter((name) => !canonicalOverlap.includes(name));
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
      'origin', 'adapter', 'id', 'version', 'derived_from', 'transform', 'sequence',
      'entitlement_id', 'constraints', 'table_id', 'source_time_policy',
      'event_time_basis', 'event_time_field', 'source_time_field', 'availability_basis',
      'kind', 'data',
      'order_id', 'client_order_id', 'status', 'order_qty', 'filled_qty',
      'leaves_qty', 'avg_px', 'last_qty', 'last_px',
    ];
    for (const key of keys) {
      expect(canonicalFields).toContain(key);
    }
  });

  it('the documented raw payload FORMS do not leak into the canonical values', () => {
    const serialized = JSON.stringify(events);
    // The canonical status names appear; the documented uppercase code domains do not.
    expect(serialized).toContain('"status":"filled"');
    expect(serialized).toContain('"filled_qty":"0.5"');
    expect(serialized).not.toContain('"recordType"');
    expect(serialized).not.toContain('"clOrdId"');
    expect(serialized).not.toContain('"filledQty"');
    expect(serialized).not.toContain('"NEW"');
    expect(serialized).not.toContain('"PARTIALLY_FILLED"');
    expect(serialized).not.toContain('"FILLED"');
  });

  it('the provider vocabulary DOES live in the declaration layers (the L2 inverse: HERE)', () => {
    // The descriptor carries the provider id and the channel vocabulary.
    expect(OMS_EMS_SOURCE_DESCRIPTOR.provider).toBe('oms-ems-gateway');
    expect(OMS_EMS_SOURCE_DESCRIPTOR.capabilities.channels).toContain('orderState');
    // The mapping tables account for the derived emitter-facing raw fields.
    const stateTable = OMS_EMS_MAPPING_TABLES.find((table) => table.table_id === 'oms-ems-order-state');
    if (stateTable === undefined) throw new Error('the state table must exist');
    const accounted = accountedRawFields(stateTable);
    expect(accounted).toContain('data');
    expect(accounted).toContain('updatedAtMs');
    // The schema layer exports the documented vocabulary.
    expect(OMS_EMS_RAW_FIELD_NAMES).toContain('orderId');
    expect(OMS_EMS_RAW_FIELD_NAMES).toContain('filledQty');
    expect(OMS_EMS_RAW_FIELD_NAMES.length).toBeGreaterThan(15);
  });
});
