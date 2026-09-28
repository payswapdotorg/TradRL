/**
 * @tradrl/provider-sdk — dogfooding the adapter contract factories.
 *
 * The contract cases every concrete adapter (T037+) MUST pass are
 * themselves run against a NEUTRAL reference subject built entirely from
 * the SDK's own primitives with provider-neutral fixture names — proving
 * the factories are correct, complete and runnable before any adapter
 * depends on them. The subject's fixtures also demonstrate the intended
 * usage shape for T037+ (descriptor + tables + entitlement + scripts +
 * session factory).
 */

import { describe, expect, it } from 'vitest';

import {
  adapterContractCases,
  createAdapterSession,
  createFakeTransport,
  validateMappingTable,
  validateSourceDescriptor,
  type AdapterContractSubject,
  type AdapterSession,
  type MappingTable,
  type SourceDescriptor,
  type SubscriptionSpec,
  type TransportPort,
  type TimestampMs,
  type JsonObject,
  type TransportScript,
} from './index';

const at = (value: number): TimestampMs => value as TimestampMs;

function fixtureDescriptor(): SourceDescriptor {
  const result = validateSourceDescriptor({
    provider: 'fixture-source',
    category: 'market-data',
    capabilities: {
      channels: ['raw-trades'],
      symbol_universes: [{ universe_id: 'uni-major', asset_class: 'crypto', instruments: ['PAIR-1'] }],
      event_types: ['trade'],
      latency_class: 'realtime',
    },
  });
  if (!result.ok) throw new Error('fixture must validate');
  return result.value;
}

function fixtureTable(): MappingTable {
  const result = validateMappingTable({
    table_id: 'tbl-trade',
    event_type: 'trade',
    fields: [
      { raw_field: 'p', canonical_field: 'price', transform: { kind: 'decimal-string' } },
      { raw_field: 'q', canonical_field: 'size', transform: { kind: 'decimal-string' } },
      { raw_field: 's', canonical_field: 'side', transform: { kind: 'enum', map: { B: 'buy', S: 'sell' } } },
    ],
    constants: [],
    tolerated: ['seq'],
    source_time_policy: {
      event_time_basis: 'raw-field',
      event_time_field: 'ts',
      source_time_field: null,
      availability_basis: 'receive-time',
    },
  });
  if (!result.ok) throw new Error('fixture must validate');
  return result.value;
}

const subscription: SubscriptionSpec = {
  channel: 'raw-trades',
  request: { symbol: 'PAIR-1', stream: 'matches' },
  venue: 'VENUE-A',
  instrument: 'PAIR-1',
  asset_class: 'crypto',
  mapping_table_id: 'tbl-trade',
};

function tradePayload(price: string, seq: number): JsonObject {
  return { ts: 9_960, p: price, q: '0.017', s: 'B', seq } as JsonObject;
}

const validScript: TransportScript = {
  inbound: [
    { at: at(10_000), channel: 'raw-trades', payload: tradePayload('100.5', 1) },
    { at: at(10_040), channel: 'raw-trades', payload: tradePayload('100.6', 2) },
  ],
  recv_failures: [],
  send_failures: [],
  receive_timeout_ms: null,
};

const unmappedFieldScript: TransportScript = {
  inbound: [
    { at: at(10_000), channel: 'raw-trades', payload: { ...tradePayload('100.5', 1), vendor_extra: 'surprise' } },
  ],
  recv_failures: [],
  send_failures: [],
  receive_timeout_ms: null,
};

function buildSession(transport: TransportPort, withEntitlement: boolean): AdapterSession {
  const config: Record<string, unknown> = {
    descriptor: fixtureDescriptor(),
    adapter: { id: 'fixture-adapter', version: '1.0.0' },
    transport,
    mapping_tables: [fixtureTable()],
  };
  if (withEntitlement) {
    config.entitlement = {
      entitlement_id: 'ent-fixture',
      access_class: 'restricted',
      constraints: ['license-tier-2'],
      terms_ref: null,
    };
  }
  const construction = createAdapterSession(config);
  if (!construction.ok) {
    throw new Error(`the reference subject must construct: ${JSON.stringify(construction.errors)}`);
  }
  return construction.session;
}

const subject: AdapterContractSubject = {
  descriptor: fixtureDescriptor(),
  subscription,
  validScript,
  unmappedFieldScript,
  createSession: (transport: TransportPort): AdapterSession => buildSession(transport, true),
  createSessionWithoutEntitlement: (transport: TransportPort): AdapterSession => buildSession(transport, false),
};

describe('the SDK passes its own adapter contract (dogfood)', () => {
  const cases = adapterContractCases(subject);

  it('exposes the full contract suite (the factories are complete)', () => {
    expect(cases.length).toBe(11);
    expect(cases.map((contractCase) => contractCase.name)).toEqual([
      'lifecycle: open, subscribe, drain, close succeeds',
      'lifecycle: double close is a typed ProtocolError',
      'lifecycle: use-after-close is a typed ProtocolError',
      'lifecycle: subscribe before open is a typed ProtocolError',
      'mapping: an unmapped raw field is a MappingError (never silently dropped)',
      'entitlement: emission without a declared entitlement is an EntitlementError',
      'quartet: every emitted event carries a complete availability quartet (L4)',
      'lineage: every emitted event carries a provenance block satisfying the ingestion mirror (L9)',
      'payloads: every emitted payload satisfies its canonical payload validator',
      'determinism: the same script emits a byte-identical stream twice',
      'neutrality: the raw subscription request passes through unmangled',
    ]);
  });

  it('every case passes against the neutral reference subject', () => {
    for (const contractCase of cases) {
      expect(() => contractCase.run()).not.toThrow();
    }
  });
});

describe('the contract factories catch violations (they are real tests)', () => {
  it('a subject that silently tolerates unmapped fields FAILS the mapping case', () => {
    const sloppyTable = validateMappingTable({
      table_id: 'tbl-trade',
      event_type: 'trade',
      fields: [
        { raw_field: 'p', canonical_field: 'price', transform: { kind: 'decimal-string' } },
        { raw_field: 'q', canonical_field: 'size', transform: { kind: 'decimal-string' } },
        { raw_field: 's', canonical_field: 'side', transform: { kind: 'enum', map: { B: 'buy', S: 'sell' } } },
      ],
      constants: [],
      tolerated: ['seq', 'vendor_extra'], // the "silent drop" is tolerated by DECLARATION
      source_time_policy: {
        event_time_basis: 'raw-field',
        event_time_field: 'ts',
        source_time_field: null,
        availability_basis: 'receive-time',
      },
    });
    if (!sloppyTable.ok) throw new Error('must validate');
    const sloppySubject: AdapterContractSubject = {
      ...subject,
      createSession: (transport: TransportPort): AdapterSession => {
        const construction = createAdapterSession({
          descriptor: fixtureDescriptor(),
          adapter: { id: 'fixture-adapter', version: '1.0.0' },
          transport,
          mapping_tables: [sloppyTable.value],
          entitlement: {
            entitlement_id: 'ent-fixture',
            access_class: 'restricted',
            constraints: ['license-tier-2'],
            terms_ref: null,
          },
        });
        if (!construction.ok) throw new Error('must construct');
        return construction.session;
      },
    };
    const mappingCase = adapterContractCases(sloppySubject).find(
      (contractCase) => contractCase.name.includes('unmapped raw field'),
    );
    if (mappingCase === undefined) throw new Error('the mapping case must exist');
    expect(() => mappingCase.run()).toThrow(); // the factory must reject the sloppy adapter
  });
});
