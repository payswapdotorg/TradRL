/**
 * @tradrl/provider-sdk — provenance mirror (T008 semantics), entitlement,
 * descriptors and mapping tables: behavioral validation battery.
 */

import { describe, expect, it } from 'vitest';
import type { EntitlementEnvelope, IngestionProvenance, SourceDescriptor, RateQuotaEnvelope, TimestampMs } from './index';

import {
  validateIngestionProvenance,
  isIngestionProvenance,
  isSyntheticEvent,
  EVENT_ORIGINS,
  validateEntitlementEnvelope,
  isEntitlementEnvelope,
  entitlementRefOf,
  validateSourceDescriptor,
  isSourceDescriptor,
  isDeclaredInstrument,
  isDeclaredChannel,
  isDeclaredEventType,
  validateMappingTable,
  accountedRawFields,
  timePolicyFields,
  applyFieldTransform,
  validateHealthThresholds,
  assessHealth,
  validateRateQuotaEnvelope,
  assessScheduleFeasibility,
} from './index';

// ---------------------------------------------------------------------------
// Provenance (T008 mirror).
// ---------------------------------------------------------------------------

describe('ingestion provenance mirror', () => {
  const primitive: IngestionProvenance = {
    origin: 'historical',
    adapter: { id: 'fixture-adapter', version: '1.0.0' },
    derived_from: [],
    transform: null,
  };

  it('accepts a primitive historical block (adapter required)', () => {
    expect(validateIngestionProvenance(primitive, 'evt-1')).toEqual([]);
    expect(isIngestionProvenance(primitive)).toBe(true);
  });

  it('refuses orphan history: historical without adapter', () => {
    const orphan = { ...primitive, adapter: null };
    expect(validateIngestionProvenance(orphan, 'evt-1').length).toBeGreaterThan(0);
    expect(isIngestionProvenance(orphan)).toBe(false);
  });

  it('accepts simulated/generated records without an adapter', () => {
    for (const origin of ['simulated', 'generated'] as const) {
      const block = { ...primitive, origin, adapter: null };
      expect(validateIngestionProvenance(block, 'evt-1')).toEqual([]);
    }
  });

  it('derived events require a transform; a transform without parents is meaningless', () => {
    const derived = { ...primitive, derived_from: ['evt-0'], transform: 'agg-1m' };
    expect(validateIngestionProvenance(derived, 'evt-1')).toEqual([]);
    expect(validateIngestionProvenance({ ...derived, transform: null }, 'evt-1').length).toBeGreaterThan(0);
    expect(validateIngestionProvenance({ ...primitive, transform: 'why' }, 'evt-1').length).toBeGreaterThan(0);
  });

  it('refuses self-reference and duplicate parents', () => {
    expect(validateIngestionProvenance({ ...primitive, derived_from: ['evt-1'], transform: 't' }, 'evt-1').length).toBeGreaterThan(0);
    expect(
      validateIngestionProvenance({ ...primitive, derived_from: ['a', 'a'], transform: 't' }, 'evt-1').length,
    ).toBeGreaterThan(0);
  });

  it('syntheticity: origin !== historical', () => {
    expect(isSyntheticEvent({ provenance: primitive })).toBe(false);
    expect(isSyntheticEvent({ provenance: { ...primitive, origin: 'simulated' } })).toBe(true);
    expect(EVENT_ORIGINS).toEqual(['historical', 'simulated', 'generated']);
  });
});

// ---------------------------------------------------------------------------
// Entitlement envelope.
// ---------------------------------------------------------------------------

describe('entitlement envelope', () => {
  const envelope: EntitlementEnvelope = {
    entitlement_id: 'ent-1',
    access_class: 'restricted',
    constraints: ['license-tier-2', 'no-redistribution'],
    terms_ref: 'terms://doc-9',
  };

  it('accepts a declared envelope and derives the record ref', () => {
    expect(validateEntitlementEnvelope(envelope)).toHaveLength(0);
    expect(isEntitlementEnvelope(envelope)).toBe(true);
    const ref = entitlementRefOf(envelope);
    expect(ref.entitlement_id).toBe('ent-1');
    expect(ref.constraints).toEqual(['license-tier-2', 'no-redistribution']);
  });

  it('accepts public data with no constraints (the declaration is the audit unit)', () => {
    const open = { entitlement_id: 'ent-open', access_class: 'public', constraints: [], terms_ref: null };
    expect(validateEntitlementEnvelope(open)).toHaveLength(0);
  });

  it('collects every violation', () => {
    const errors = validateEntitlementEnvelope({ entitlement_id: '', access_class: 'secret', constraints: ['a', 'a'], terms_ref: '' });
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(isEntitlementEnvelope({})).toBe(false);
    expect(isEntitlementEnvelope(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source descriptor.
// ---------------------------------------------------------------------------

describe('source descriptor', () => {
  const descriptor: SourceDescriptor = {
    provider: 'fixture-source',
    category: 'market-data',
    capabilities: {
      channels: ['raw-trades', 'raw-book'],
      symbol_universes: [
        { universe_id: 'uni-major', asset_class: 'crypto', instruments: ['PAIR-1', 'PAIR-2'] },
      ],
      event_types: ['trade', 'book_snapshot', 'book_delta'],
      latency_class: 'realtime',
    },
  };

  it('accepts and freezes a declared descriptor', () => {
    const result = validateSourceDescriptor(descriptor);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.capabilities)).toBe(true);
      expect(isSourceDescriptor(result.value)).toBe(true);
    }
  });

  it('cross-check helpers answer from the declaration', () => {
    expect(isDeclaredChannel(descriptor, 'raw-trades')).toBe(true);
    expect(isDeclaredChannel(descriptor, 'raw-quotes')).toBe(false);
    expect(isDeclaredInstrument(descriptor, 'PAIR-1', 'crypto')).toBe(true);
    expect(isDeclaredInstrument(descriptor, 'PAIR-1', 'equity')).toBe(false);
    expect(isDeclaredEventType(descriptor, 'trade')).toBe(true);
    expect(isDeclaredEventType(descriptor, 'news')).toBe(false);
  });

  it('collects every violation (empty channels, empty universes, bad enums)', () => {
    const invalid = {
      provider: '',
      category: 'other',
      capabilities: {
        channels: [],
        symbol_universes: [],
        event_types: ['nope'],
        latency_class: 'instantaneous',
      },
    };
    const result = validateSourceDescriptor(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(6);
  });

  it('rejects duplicate channels, universes and instruments', () => {
    const duplicated = {
      ...descriptor,
      capabilities: {
        ...descriptor.capabilities,
        channels: ['raw-trades', 'raw-trades'],
        symbol_universes: [
          { universe_id: 'u', asset_class: 'crypto', instruments: ['PAIR-1', 'PAIR-1'] },
          { universe_id: 'u', asset_class: 'crypto', instruments: ['PAIR-1'] },
        ],
      },
    };
    const result = validateSourceDescriptor(duplicated);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mapping table.
// ---------------------------------------------------------------------------

describe('mapping table', () => {
  const policy = {
    event_time_basis: 'raw-field',
    event_time_field: 'ts',
    source_time_field: 'vendor_ts',
    availability_basis: 'receive-time',
  };

  const tradeTable = {
    table_id: 'tbl-trade',
    event_type: 'trade',
    fields: [
      { raw_field: 'p', canonical_field: 'price', transform: { kind: 'decimal-string' } },
      { raw_field: 'q', canonical_field: 'size', transform: { kind: 'decimal-string' } },
      { raw_field: 's', canonical_field: 'side', transform: { kind: 'enum', map: { B: 'buy', S: 'sell' } } },
    ],
    constants: [],
    tolerated: ['seq'],
    source_time_policy: policy,
  };

  it('validates and freezes a declared table with normalized defaults', () => {
    const result = validateMappingTable(tradeTable);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fields[0].required).toBe(true); // default
      expect(result.value.fields[0].transform.kind).toBe('decimal-string');
      expect(Object.isFrozen(result.value)).toBe(true);
      expect([...accountedRawFields(result.value)].sort()).toEqual(['p', 'q', 's', 'seq', 'ts', 'vendor_ts'].sort());
      expect(timePolicyFields(result.value.source_time_policy)).toEqual(['ts', 'vendor_ts']);
    }
  });

  it('requires coverage of every required canonical field', () => {
    const incomplete = {
      ...tradeTable,
      fields: tradeTable.fields.slice(0, 2), // drops 'side'
    };
    const result = validateMappingTable(incomplete);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.message.includes('side'))).toBe(true);
    }
  });

  it('rejects unknown canonical fields and duplicate targets', () => {
    expect(validateMappingTable({ ...tradeTable, fields: [{ raw_field: 'x', canonical_field: 'not_a_field' }] }).ok).toBe(false);
    const duplicated = {
      ...tradeTable,
      fields: [...tradeTable.fields, { raw_field: 'p2', canonical_field: 'price' }],
    };
    expect(validateMappingTable(duplicated).ok).toBe(false);
  });

  it('rejects a raw field with two dispositions (mapped + tolerated, or policy + either)', () => {
    expect(validateMappingTable({ ...tradeTable, tolerated: ['seq', 'p'] }).ok).toBe(false);
    expect(
      validateMappingTable({ ...tradeTable, source_time_policy: { ...policy, event_time_field: 'p' }, fields: tradeTable.fields.slice(0, 2) }).ok,
    ).toBe(false);
  });

  it('the levels transform only feeds book payload level arrays', () => {
    const badLevels = {
      table_id: 'tbl-x',
      event_type: 'trade',
      fields: [{ raw_field: 'lvls', canonical_field: 'price', transform: { kind: 'levels', price_field: 'p', size_field: 'q' } }],
      constants: [],
      tolerated: [],
      source_time_policy: { event_time_basis: 'receive-time', event_time_field: null, source_time_field: null, availability_basis: 'event-time' },
    };
    expect(validateMappingTable(badLevels).ok).toBe(false);

    const goodSnapshot = {
      table_id: 'tbl-book',
      event_type: 'book_snapshot',
      fields: [
        { raw_field: 'bids', canonical_field: 'bids', transform: { kind: 'levels', price_field: 'p', size_field: 'q' } },
        { raw_field: 'asks', canonical_field: 'asks', transform: { kind: 'levels', price_field: 'p', size_field: 'q' } },
      ],
      constants: [],
      tolerated: [],
      source_time_policy: { event_time_basis: 'receive-time', event_time_field: null, source_time_field: null, availability_basis: 'receive-time' },
    };
    const result = validateMappingTable(goodSnapshot);
    expect(result.ok).toBe(true);
  });

  it('time policy validation: raw-field basis requires the field; receive-time forbids it', () => {
    expect(
      validateMappingTable({ ...tradeTable, source_time_policy: { event_time_basis: 'raw-field', event_time_field: null, source_time_field: null, availability_basis: 'event-time' } }).ok,
    ).toBe(false);
    expect(
      validateMappingTable({ ...tradeTable, source_time_policy: { event_time_basis: 'receive-time', event_time_field: 'ts', source_time_field: null, availability_basis: 'event-time' } }).ok,
    ).toBe(false);
  });
});

describe('field transforms (pure applications)', () => {
  it('identity passes the raw value through', () => {
    expect(applyFieldTransform({ kind: 'identity' }, 42, 'f')).toEqual({ ok: true, value: 42 });
  });

  it('enum maps declared keys and refuses undeclared ones', () => {
    const map = { B: 'buy', S: 'sell' };
    expect(applyFieldTransform({ kind: 'enum', map }, 'B', 's')).toEqual({ ok: true, value: 'buy' });
    const refused = applyFieldTransform({ kind: 'enum', map }, 'X', 's');
    expect(refused.ok).toBe(false);
    expect(applyFieldTransform({ kind: 'enum', map }, 1, 's').ok).toBe(false);
  });

  it('decimal-string accepts decimal strings and finite numbers, refuses exponents and garbage', () => {
    expect(applyFieldTransform({ kind: 'decimal-string' }, '43125.10', 'p')).toEqual({ ok: true, value: '43125.10' });
    expect(applyFieldTransform({ kind: 'decimal-string' }, 0.017, 'q')).toEqual({ ok: true, value: '0.017' });
    expect(applyFieldTransform({ kind: 'decimal-string' }, '1e3', 'p').ok).toBe(false);
    expect(applyFieldTransform({ kind: 'decimal-string' }, 1e21, 'p').ok).toBe(false);
    expect(applyFieldTransform({ kind: 'decimal-string' }, null, 'p').ok).toBe(false);
    expect(applyFieldTransform({ kind: 'decimal-string' }, true, 'p').ok).toBe(false);
  });

  it('levels translates arrays of level records, converting price/size', () => {
    const transform = { kind: 'levels', price_field: 'px', size_field: 'sz' } as const;
    const raw = [
      { px: '100.5', sz: '1.25' },
      { px: 101, sz: 2 },
    ];
    const outcome = applyFieldTransform(transform, raw, 'bids');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value).toEqual([
        { price: '100.5', size: '1.25' },
        { price: '101', size: '2' },
      ]);
    }
    expect(applyFieldTransform(transform, 'not-an-array', 'bids').ok).toBe(false);
    expect(applyFieldTransform(transform, [{ px: '1' }], 'bids').ok).toBe(false); // missing sz
    expect(applyFieldTransform(transform, [{ px: 'x', sz: '1' }], 'bids').ok).toBe(false); // bad decimal
  });
});

// ---------------------------------------------------------------------------
// Health.
// ---------------------------------------------------------------------------

describe('health heartbeats', () => {
  const thresholds = { heartbeat_interval_ms: 10_000, staleness_limit_ms: 30_000 };
  const at = (value: number): TimestampMs => value as TimestampMs;

  it('validates thresholds (limit >= interval)', () => {
    expect(validateHealthThresholds(thresholds).ok).toBe(true);
    expect(validateHealthThresholds({ heartbeat_interval_ms: 30_000, staleness_limit_ms: 10_000 }).ok).toBe(false);
    expect(validateHealthThresholds({ heartbeat_interval_ms: 0, staleness_limit_ms: 10_000 }).ok).toBe(false);
  });

  it('assesses liveness against an injected instant (no wall clock)', () => {
    const fresh = assessHealth(thresholds, at(100_000), at(105_000));
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.value.stale).toBe(false);
      expect(fresh.value.elapsed_since_last_ms).toBe(5_000);
      expect(fresh.value.missed_beats).toBe(0);
      expect(Object.isFrozen(fresh.value)).toBe(true);
    }

    const stale = assessHealth(thresholds, at(100_000), at(140_000));
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.value.stale).toBe(true);
      expect(stale.value.missed_beats).toBe(4);
    }

    const never = assessHealth(thresholds, null, at(140_000));
    expect(never.ok).toBe(true);
    if (never.ok) {
      expect(never.value.last_message_at).toBe(null);
      expect(never.value.elapsed_since_last_ms).toBe(null);
      expect(never.value.stale).toBe(false); // absence of messages is not staleness of a feed that never delivered
    }
  });

  it('refuses assessing the past (typed protocol error)', () => {
    const result = assessHealth(thresholds, at(100_000), at(90_000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('protocol');
  });
});

// ---------------------------------------------------------------------------
// Rate/quota.
// ---------------------------------------------------------------------------

describe('rate quota envelopes', () => {
  const envelope: RateQuotaEnvelope = { limit: 3, window_ms: 1000, policy: 'fixed-window', scope: 'per-connection' };

  it('validates declarative envelopes', () => {
    expect(validateRateQuotaEnvelope(envelope).ok).toBe(true);
    expect(validateRateQuotaEnvelope({ ...envelope, limit: 0 }).ok).toBe(false);
    expect(validateRateQuotaEnvelope({ ...envelope, window_ms: -1 }).ok).toBe(false);
    expect(validateRateQuotaEnvelope({ ...envelope, policy: 'token-bucket' }).ok).toBe(false);
    expect(validateRateQuotaEnvelope({ ...envelope, scope: '' }).ok).toBe(false);
  });

  it('fixed-window: epoch-aligned buckets catch bursts', () => {
    // 5 requests in [1000, 2000): limit 3 exceeded.
    const timeline = [1050, 1100, 1150, 1200, 1250];
    const report = assessScheduleFeasibility(envelope, timeline);
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.feasible).toBe(false);
      expect(report.value.violations).toEqual([
        { window_start: 1000, window_end: 2000, observed: 5, limit: 3, policy: 'fixed-window' },
      ]);
      expect(Object.isFrozen(report.value)).toBe(true);
    }
  });

  it('fixed-window: spread requests are feasible', () => {
    const feasible = assessScheduleFeasibility(envelope, [1050, 1100, 1150, 2300, 2350, 2400, 3600]);
    expect(feasible.ok && feasible.value.feasible).toBe(true);
  });

  it('rolling-window: every sliding window is checked', () => {
    const rolling: RateQuotaEnvelope = { limit: 2, window_ms: 1000, policy: 'rolling-window', scope: 'per-connection' };
    // 3 requests within any 1000ms window starting at 1500.
    const burst = [1500, 1600, 1700, 5000];
    const report = assessScheduleFeasibility(rolling, burst);
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.feasible).toBe(false);
      expect(report.value.violations.length).toBeGreaterThan(0);
      expect(report.value.violations[0].window_start).toBe(1500);
    }
    // separated requests are feasible
    const calm = assessScheduleFeasibility(rolling, [0, 2000, 4000]);
    expect(calm.ok && calm.value.feasible).toBe(true);
  });

  it('an invalid timeline is a typed protocol error', () => {
    const unordered = assessScheduleFeasibility(envelope, [2000, 1000]);
    expect(unordered.ok).toBe(false);
    if (!unordered.ok) expect(unordered.error.code).toBe('invalid_configuration');

    const nonTimestamp = assessScheduleFeasibility(envelope, [-5]);
    expect(nonTimestamp.ok).toBe(false);
  });
});
