/**
 * @tradrl/provider-sdk — the canonical emitter: behavioral battery.
 *
 * The laws under test: entitlement refusal precedes everything; unmapped
 * raw fields are typed errors (silent drops unrepresentable); the quartet
 * is constructed honestly per the declared policy (clamping preserved);
 * provenance satisfies the ingestion mirror; every emitted record is
 * deep-frozen and carries its entitlement ref; failed emissions do not
 * burn sequence numbers.
 */

import { describe, expect, it } from 'vitest';

import {
  createCanonicalEmitter,
  validateMappingTable,
  validateSourceDescriptor,
  validateEntitlementEnvelope,
  validateEmittedFloor,
  emittedStreamKey,
  type EmittedEvent,
  type StreamBinding,
  type MappingTable,
  type SourceDescriptor,
  type EntitlementEnvelope,
} from './index';
import { isTimestampMs, type TimestampMs } from './timestamp';

function ts(value: number): TimestampMs {
  return value as TimestampMs;
}

function fixtureDescriptor(): SourceDescriptor {
  const result = validateSourceDescriptor({
    provider: 'fixture-source',
    category: 'market-data',
    capabilities: {
      channels: ['raw-trades'],
      symbol_universes: [{ universe_id: 'uni-major', asset_class: 'crypto', instruments: ['PAIR-1', 'PAIR-2'] }],
      event_types: ['trade'],
      latency_class: 'realtime',
    },
  });
  if (!result.ok) throw new Error(`fixture descriptor must validate: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function fixtureEntitlement(): EntitlementEnvelope {
  const errors = validateEntitlementEnvelope({
    entitlement_id: 'ent-fixture',
    access_class: 'restricted',
    constraints: ['license-tier-2'],
    terms_ref: null,
  });
  if (errors.length > 0) throw new Error('fixture entitlement must validate');
  return {
    entitlement_id: 'ent-fixture',
    access_class: 'restricted',
    constraints: ['license-tier-2'],
    terms_ref: null,
  };
}

const descriptor: SourceDescriptor = fixtureDescriptor();
const entitlement: EntitlementEnvelope = fixtureEntitlement();

function tradeTable(overrides: Record<string, unknown> = {}): MappingTable {
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
    ...overrides,
  });
  if (!result.ok) throw new Error(`fixture table must validate: ${JSON.stringify(result.errors)}`);
  return result.value;
}

const binding = (table: MappingTable): StreamBinding => ({
  channel: 'raw-trades',
  venue: 'VENUE-A',
  instrument: 'PAIR-1',
  asset_class: 'crypto',
  table,
});

const message = (payload: Record<string, unknown>, at = 10_000) => ({
  at: ts(at),
  channel: 'raw-trades',
  payload: payload as import('./index').JsonObject,
});

const rawTrade = { ts: 9_950, vendor_ts: 9_940, p: '43125.10', q: '0.017', s: 'B', tid: 't-1', seq: 7 };

describe('emitter construction', () => {
  it('validates the configuration collect-all', () => {
    const bad = createCanonicalEmitter({ adapter: { id: 'a', version: '1' } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a table whose event type the source does not declare', () => {
    const newsTable = validateMappingTable({
      table_id: 'tbl-news',
      event_type: 'news',
      fields: [
        { raw_field: 'h', canonical_field: 'headline' },
        { raw_field: 'sym', canonical_field: 'symbols' },
      ],
      constants: [],
      tolerated: [],
      source_time_policy: { event_time_basis: 'receive-time', event_time_field: null, source_time_field: null, availability_basis: 'event-time' },
    });
    if (!newsTable.ok) throw new Error('fixture must validate');
    const result = createCanonicalEmitter({
      source: descriptor,
      adapter: { id: 'fixture-adapter', version: '1.0.0' },
      mapping_tables: [newsTable.value],
      entitlement,
    });
    expect(result.ok).toBe(false);
  });
});

describe('entitlement refusal (licensing law)', () => {
  it('emission without a declared envelope is a typed EntitlementError', () => {
    const construction = createCanonicalEmitter({
      source: descriptor,
      adapter: { id: 'fixture-adapter', version: '1.0.0' },
      mapping_tables: [tradeTable()],
      // entitlement deliberately omitted — the negative path
    });
    expect(construction.ok).toBe(true);
    if (!construction.ok) return;
    const emitted = construction.emitter.emit(message(rawTrade), binding(tradeTable()));
    expect(emitted.ok).toBe(false);
    if (!emitted.ok) {
      expect(emitted.error.kind).toBe('entitlement');
      expect(emitted.error.code).toBe('entitlement_undeclared');
    }
  });

  it('entitlement refusal precedes unmapped-field errors (unlicensed records are refused before parsing)', () => {
    const construction = createCanonicalEmitter({
      source: descriptor,
      adapter: { id: 'fixture-adapter', version: '1.0.0' },
      mapping_tables: [tradeTable()],
    });
    if (!construction.ok) throw new Error('must construct');
    const unmappedMessage = message({ ...rawTrade, surprise: 'field' });
    const emitted = construction.emitter.emit(unmappedMessage, binding(tradeTable()));
    expect(emitted.ok).toBe(false);
    if (!emitted.ok) expect(emitted.error.kind).toBe('entitlement');
  });
});

describe('raw field accounting (anti-silent-drop)', () => {
  const build = () => {
    const construction = createCanonicalEmitter({
      source: descriptor,
      adapter: { id: 'fixture-adapter', version: '1.0.0' },
      mapping_tables: [tradeTable()],
      entitlement,
    });
    if (!construction.ok) throw new Error('must construct');
    return construction.emitter;
  };

  it('an unmapped raw field is a MappingError naming the field', () => {
    const emitted = build().emit(message({ ...rawTrade, surprise: 'field' }), binding(tradeTable()));
    expect(emitted.ok).toBe(false);
    if (!emitted.ok) {
      expect(emitted.error.kind).toBe('mapping');
      expect(emitted.error.code).toBe('unmapped_raw_field');
      expect(emitted.error.message).toContain('surprise');
    }
  });

  it('a tolerated field is accounted for (explicit, auditable, never silent)', () => {
    const emitted = build().emit(message(rawTrade), binding(tradeTable()));
    expect(emitted.ok).toBe(true);
  });

  it('a missing required mapped field is a MappingError', () => {
    const { p: _p, ...withoutPrice } = rawTrade;
    const emitted = build().emit(message(withoutPrice), binding(tradeTable()));
    expect(emitted.ok).toBe(false);
    if (!emitted.ok) {
      expect(emitted.error.code).toBe('mapped_field_missing');
      expect(emitted.error.message).toContain('p');
    }
  });

  it('an optional mapped field may be absent', () => {
    const { tid: _tid, ...withoutId } = rawTrade;
    const emitted = build().emit(message(withoutId), binding(tradeTable()));
    expect(emitted.ok).toBe(true);
    if (emitted.ok && emitted.value.event_type === 'trade') expect(emitted.value.payload.trade_id).toBeUndefined();
  });

  it('a transform refusal is a MappingError (invalid mapped value)', () => {
    const emitted = build().emit(message({ ...rawTrade, p: 'not-a-number' }), binding(tradeTable()));
    expect(emitted.ok).toBe(false);
    if (!emitted.ok) {
      expect(emitted.error.kind).toBe('mapping');
      expect(emitted.error.code).toBe('invalid_mapped_value');
    }
  });

  it('an enum key outside the declared map is refused', () => {
    const emitted = build().emit(message({ ...rawTrade, s: 'X' }), binding(tradeTable()));
    expect(emitted.ok).toBe(false);
    if (!emitted.ok) expect(emitted.error.code).toBe('invalid_mapped_value');
  });

  it('a mapped payload violating the canonical contract is refused (collect-all summary)', () => {
    const emitted = build().emit(message({ ...rawTrade, q: '-1' }), binding(tradeTable()));
    expect(emitted.ok).toBe(false);
    if (!emitted.ok) {
      expect(emitted.error.kind).toBe('mapping');
      expect(emitted.error.message).toContain('size');
    }
  });
});

describe('the availability quartet (L4 honesty)', () => {
  const build = () => {
    const construction = createCanonicalEmitter({
      source: descriptor,
      adapter: { id: 'fixture-adapter', version: '1.0.0' },
      mapping_tables: [tradeTable()],
      entitlement,
    });
    if (!construction.ok) throw new Error('must construct');
    return construction.emitter;
  };

  it('derives the quartet per the declared policy (raw event time, vendor source time, receive-stamped availability and ingestion)', () => {
    const emitted = build().emit(message(rawTrade, 10_000), binding(tradeTable()));
    expect(emitted.ok).toBe(true);
    if (!emitted.ok) return;
    const event = emitted.value;
    expect(event.event_time).toBe(9_950); // raw field
    expect(event.source_time).toBe(9_940); // vendor claimed
    expect(event.available_time).toBe(10_000); // receive basis
    expect(event.ingestion_time).toBe(10_000);
    expect(isTimestampMs(event.event_time)).toBe(true);
  });

  it('clamps vendor clock skew: availability never precedes the event', () => {
    // event_time from the raw field is LATER than the receive time (skewed vendor clock)
    const skewed = { ...rawTrade, ts: 12_000, vendor_ts: 11_900 };
    const emitted = build().emit(message(skewed, 10_000), binding(tradeTable()));
    expect(emitted.ok).toBe(true);
    if (!emitted.ok) return;
    expect(emitted.value.event_time).toBe(12_000);
    expect(emitted.value.available_time).toBe(12_000); // clamped to >= event_time
    expect(emitted.value.ingestion_time).toBe(10_000); // informational, deliberately unordered
  });

  it('event-time availability basis: available = event (historical backfill semantics)', () => {
    const table = tradeTable({
      source_time_policy: {
        event_time_basis: 'raw-field',
        event_time_field: 'ts',
        source_time_field: null,
        availability_basis: 'event-time',
      },
    });
    // vendor_ts is not consumed by this policy (source does not say) — omit it.
    const { vendor_ts: _v, ...rawWithoutVendorTime } = rawTrade;
    const emitted = build().emit(message(rawWithoutVendorTime, 100_000), binding(table));
    expect(emitted.ok).toBe(true);
    if (emitted.ok) {
      expect(emitted.value.available_time).toBe(9_950);
      expect(emitted.value.source_time).toBe(null); // source does not say
      expect(emitted.value.ingestion_time).toBe(100_000); // backfilled long after availability
    }
  });

  it('receive-time event basis: we only know when we saw it', () => {
    const table = tradeTable({
      source_time_policy: {
        event_time_basis: 'receive-time',
        event_time_field: null,
        source_time_field: null,
        availability_basis: 'receive-time',
      },
    });
    // Neither time field is consumed by the receive-time basis — omit both.
    const { ts: _t, vendor_ts: _v, ...rawWithoutTimes } = rawTrade;
    const emitted = build().emit(message(rawWithoutTimes, 10_000), binding(table));
    expect(emitted.ok).toBe(true);
    if (emitted.ok) {
      expect(emitted.value.event_time).toBe(10_000);
      expect(emitted.value.source_time).toBe(null);
      expect(emitted.value.available_time).toBe(10_000);
    }
  });

  it('an unconvertible declared time field is a typed MappingError', () => {
    const emitted = build().emit(message({ ...rawTrade, ts: 'yesterday' }), binding(tradeTable()));
    expect(emitted.ok).toBe(false);
    if (!emitted.ok) expect(emitted.error.code).toBe('invalid_time_field');
  });

  it('a missing declared event-time field is a typed MappingError', () => {
    const { ts: _ts, vendor_ts: _v, ...withoutTs } = rawTrade;
    const emitted = build().emit(message(withoutTs), binding(tradeTable()));
    expect(emitted.ok).toBe(false);
    if (!emitted.ok) expect(emitted.error.code).toBe('mapped_field_missing');
  });
});

describe('emitted records (shape, lineage, freezing)', () => {
  const build = () => {
    const construction = createCanonicalEmitter({
      source: descriptor,
      adapter: { id: 'fixture-adapter', version: '1.0.0' },
      mapping_tables: [tradeTable()],
      entitlement,
    });
    if (!construction.ok) throw new Error('must construct');
    return construction.emitter;
  };

  it('emits a complete, deep-frozen canonical record', () => {
    const emitted = build().emit(message(rawTrade), binding(tradeTable()));
    expect(emitted.ok).toBe(true);
    if (!emitted.ok) return;
    const event: EmittedEvent = emitted.value;
    expect(event.event_type).toBe('trade');
    expect(event.payload).toEqual({ price: '43125.10', size: '0.017', side: 'buy', trade_id: 't-1' });
    expect(event.provider).toBe('fixture-source');
    expect(event.venue).toBe('VENUE-A');
    expect(event.instrument).toBe('PAIR-1');
    expect(event.asset_class).toBe('crypto');
    expect(event.provenance.origin).toBe('historical');
    expect(event.provenance.adapter).toEqual({ id: 'fixture-adapter', version: '1.0.0' });
    expect(event.provenance.derived_from).toEqual([]);
    expect(event.provenance.transform).toBe(null);
    expect(event.entitlement.entitlement_id).toBe('ent-fixture');
    expect(event.entitlement.constraints).toEqual(['license-tier-2']);
    expect(event.mapping.table_id).toBe('tbl-trade');
    expect(event.mapping.source_time_policy.event_time_field).toBe('ts');

    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Object.isFrozen(event.provenance)).toBe(true);
    expect(() => {
      (event.payload as { price?: string }).price = '0';
    }).toThrow();
  });

  it('the floor validator accepts the constructed record (defense in depth stays green)', () => {
    const emitted = build().emit(message(rawTrade), binding(tradeTable()));
    if (!emitted.ok) throw new Error('must emit');
    expect(validateEmittedFloor(emitted.value)).toEqual([]);
  });

  it('deterministic ids and sequences: the same message emits the same record twice', () => {
    const first = build().emit(message(rawTrade), binding(tradeTable()));
    const second = build().emit(message(rawTrade), binding(tradeTable()));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (first.ok && second.ok) {
      expect(first.value.event_id).toBe(second.value.event_id);
      expect(first.value.sequence).toBe(1);
    }
  });

  it('sequences advance per stream and only on success', () => {
    const emitter = build();
    const first = emitter.emit(message(rawTrade), binding(tradeTable()));
    const failed = emitter.emit(message({ ...rawTrade, surprise: 1 }), binding(tradeTable())); // burns nothing
    const second = emitter.emit(message(rawTrade), binding(tradeTable()));
    expect(first.ok && second.ok && failed.ok === false).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.sequence).toBe(2);
      expect(second.value.event_id).not.toBe(first.value.event_id);
    }
    // independent stream (different instrument binding) restarts at sequence_start
    const otherBinding: StreamBinding = { ...binding(tradeTable()), instrument: 'PAIR-2' };
    const other = emitter.emit(message(rawTrade), otherBinding);
    if (other.ok) expect(other.value.sequence).toBe(1);
  });

  it('emittedStreamKey scopes other events by payload kind', () => {
    expect(emittedStreamKey('v', 'i', 'trade', {})).toBe('v|i|trade');
    expect(emittedStreamKey('v', 'i', 'other', { kind: 'funding_rate' })).toBe('v|i|other:funding_rate');
  });

  it('supports declared derivation lineage (L9)', () => {
    const construction = createCanonicalEmitter({
      source: descriptor,
      adapter: { id: 'fixture-adapter', version: '1.0.0' },
      mapping_tables: [tradeTable()],
      entitlement,
      derivation: { derived_from: ['evt-parent-1', 'evt-parent-2'], transform: 'vwap-1m-aggregator' },
    });
    if (!construction.ok) throw new Error('must construct');
    const emitted = construction.emitter.emit(message(rawTrade), binding(tradeTable()));
    expect(emitted.ok).toBe(true);
    if (emitted.ok) {
      expect(emitted.value.provenance.derived_from).toEqual(['evt-parent-1', 'evt-parent-2']);
      expect(emitted.value.provenance.transform).toBe('vwap-1m-aggregator');
    }
  });

  it('supports simulated/generated origins (syntheticity mirror)', () => {
    for (const origin of ['simulated', 'generated'] as const) {
      const construction = createCanonicalEmitter({
        source: descriptor,
        adapter: { id: 'fixture-world', version: '1.0.0' },
        mapping_tables: [tradeTable()],
        entitlement,
        origin,
      });
      if (!construction.ok) throw new Error('must construct');
      const emitted = construction.emitter.emit(message(rawTrade), binding(tradeTable()));
      if (emitted.ok) expect(emitted.value.provenance.origin).toBe(origin);
    }
  });
});
