// @tradrl/execution-authority — the RoutingTable tests: the lookup
// law (Default-Deny for absent pairs), the uniqueness law and the
// opacity trip wire.

import { describe, expect, it } from 'vitest';

import {
  adapterDescriptorOf,
  channelOf,
  deepFreeze,
  isRoutingTable,
  mintAdapterDescriptorRef,
  mintChannelRef,
  routeFor,
  validateRoutingTable,
  type RoutingTable,
} from './index';
import { TENANT } from './test-fixtures';

/** A valid fixture routing table, overridable per test. */
function fixtureTable(overrides: { entries?: readonly Record<string, unknown>[] } = {}): RoutingTable {
  return deepFreeze({
    tenant: TENANT as never,
    project: 'project-gateway' as never,
    entries: (overrides.entries ?? [
      { venue: 'BROKER-FIX', instrument: 'BTC-USDT', adapterRef: 'adapter:adapter-brokers@0.0.0', channelRef: 'chan:newOrderSingle' },
      { venue: 'OMS-EMS', instrument: 'BTC-USDT', adapterRef: 'adapter:adapter-oms-ems@0.0.0', channelRef: 'chan:routingInstruction' },
    ]) as never,
  }) as unknown as RoutingTable;
}

describe('the routing table', () => {
  it('a valid fixture table passes the guard and the collect-all validator', () => {
    const table = fixtureTable();
    expect(isRoutingTable(table)).toBe(true);
    const validated = validateRoutingTable(table);
    expect(validated.ok).toBe(true);
  });

  it('routeFor resolves the declared pair and returns null for an UNROUTABLE pair (Default-Deny)', () => {
    const table = fixtureTable();
    expect(routeFor(table, 'BROKER-FIX' as never, 'BTC-USDT' as never)?.adapterRef).toBe('adapter:adapter-brokers@0.0.0');
    expect(routeFor(table, 'OMS-EMS' as never, 'BTC-USDT' as never)?.channelRef).toBe('chan:routingInstruction');
    // The unroutable cases: unknown venue, unknown instrument, a known
    // venue with a different instrument.
    expect(routeFor(table, 'UNKNOWN-VEN' as never, 'BTC-USDT' as never)).toBeNull();
    expect(routeFor(table, 'BROKER-FIX' as never, 'SOL-USDT' as never)).toBeNull();
    expect(routeFor(table, 'OMS-EMS' as never, 'SOL-USDT' as never)).toBeNull();
  });

  it('duplicate (venue, instrument) pairs fail validation', () => {
    const table = fixtureTable({
      entries: [
        { venue: 'BROKER-FIX', instrument: 'BTC-USDT', adapterRef: 'adapter:adapter-brokers@0.0.0', channelRef: 'chan:newOrderSingle' },
        { venue: 'BROKER-FIX', instrument: 'BTC-USDT', adapterRef: 'adapter:adapter-oms-ems@0.0.0', channelRef: 'chan:routingInstruction' },
      ],
    });
    expect(isRoutingTable(table)).toBe(false);
    const validated = validateRoutingTable(table);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.errors[0]?.code).toBe('invalid_field');
  });

  it('malformed refs fail the guard (adapter:/chan: prefixes are structural)', () => {
    expect(isRoutingTable(fixtureTable({ entries: [{ venue: 'BROKER-FIX', instrument: 'BTC-USDT', adapterRef: 'adapter-brokers', channelRef: 'chan:newOrderSingle' }] }))).toBe(false);
    expect(isRoutingTable(fixtureTable({ entries: [{ venue: 'BROKER-FIX', instrument: 'BTC-USDT', adapterRef: 'adapter:adapter-brokers@0.0.0', channelRef: 'newOrderSingle' }] }))).toBe(false);
    expect(isRoutingTable(fixtureTable({ entries: [{ venue: 'BROKER-FIX', instrument: 'BTC-USDT', adapterRef: 'adapter:adapter-brokers', channelRef: 'chan:newOrderSingle' }] }))).toBe(false);
  });

  it('the opacity trip wire runs over tables too', () => {
    const contaminated = { ...fixtureTable(), token: 'abc123' };
    expect(isRoutingTable(contaminated)).toBe(false);
    const validated = validateRoutingTable(contaminated);
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.errors[0]?.code).toBe('credential_value_present');
  });
});

describe('the ref minting/decomposition round trip (the T039 mirror bridge)', () => {
  it('mintAdapterDescriptorRef / adapterDescriptorOf round-trip the descriptor identity', () => {
    const ref = mintAdapterDescriptorRef({ id: 'adapter-brokers', version: '0.0.0' });
    expect(ref).toBe('adapter:adapter-brokers@0.0.0');
    expect(adapterDescriptorOf(ref)).toEqual({ id: 'adapter-brokers', version: '0.0.0' });
  });

  it('mintChannelRef / channelOf round-trip the channel name', () => {
    const ref = mintChannelRef('newOrderSingle');
    expect(ref).toBe('chan:newOrderSingle');
    expect(channelOf(ref)).toBe('newOrderSingle');
  });

  it('malformed descriptor inputs throw loudly at the minting boundary', () => {
    expect(() => mintAdapterDescriptorRef({ id: '', version: '0.0.0' })).toThrow();
    expect(() => mintChannelRef('')).toThrow();
    expect(() => adapterDescriptorOf('adapter:no-version' as never)).toThrow();
    expect(() => channelOf('notachannel' as never)).toThrow();
  });
});
