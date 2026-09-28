// Contract-guard behavioral tests: timestamps, durations, freezing, hashing,
// ids, the canonical-event envelope, provenance, records, the computation
// policy, the ingest clock and the projection selector. Negative paths,
// boundaries, immutability.

import { describe, expect, it } from 'vitest';
import {
  ASSET_CLASSES,
  EVENT_ORIGINS,
  EVENT_TYPES,
  MAX_TIMESTAMP_MS,
  MIN_TIMESTAMP_MS,
  canonicalString,
  createDeterministicIngestClock,
  datasetRef,
  deepFreeze,
  durationToMillis,
  hashOf,
  isAdmissionStamp,
  isComputationPolicy,
  isDeeplyFrozen,
  isDuration,
  isLineageHash,
  isMachineProvenance,
  isTimestampMs,
  nextIngestStamp,
  tenantId,
  validateCanonicalEvent,
  validateIngestionProvenance,
  validateProjectionSelector,
  type IngestClock,
} from './index';
import { rawEvent } from './fixtures';

describe('timestamp mirror', () => {
  it('accepts the representable range boundaries and rejects outside/insane values', () => {
    expect(isTimestampMs(MIN_TIMESTAMP_MS)).toBe(true);
    expect(isTimestampMs(MAX_TIMESTAMP_MS)).toBe(true);
    expect(isTimestampMs(-1)).toBe(false);
    expect(isTimestampMs(MAX_TIMESTAMP_MS + 1)).toBe(false);
    expect(isTimestampMs(1.5)).toBe(false);
    expect(isTimestampMs(Number.NaN)).toBe(false);
    expect(isTimestampMs(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isTimestampMs('1000')).toBe(false);
    expect(isTimestampMs(null)).toBe(false);
  });
});

describe('duration mirror', () => {
  it('guards non-negative finite components', () => {
    expect(isDuration({})).toBe(true);
    expect(isDuration({ milliseconds: 250 })).toBe(true);
    expect(isDuration({ hours: 1, minutes: 30 })).toBe(true);
    expect(isDuration({ milliseconds: -1 })).toBe(false);
    expect(isDuration({ seconds: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isDuration({ days: 'one' })).toBe(false);
    expect(isDuration(null)).toBe(false);
    expect(isDuration({ milliseconds: undefined })).toBe(false);
  });

  it('resolves to whole milliseconds and floors fractional sums', () => {
    expect(durationToMillis({})).toBe(0);
    expect(durationToMillis({ milliseconds: 1_000 })).toBe(1_000);
    expect(durationToMillis({ seconds: 1, milliseconds: 500 })).toBe(1_500);
    expect(durationToMillis({ hours: 1, minutes: 30 })).toBe(5_400_000);
    expect(durationToMillis({ days: 1 })).toBe(86_400_000);
    expect(durationToMillis({ milliseconds: 0.9 })).toBe(0);
    expect(durationToMillis({ milliseconds: 1.9 })).toBe(1);
  });
});

describe('deep freezing', () => {
  it('freezes every reachable object and array', () => {
    const value = deepFreeze({ a: { b: [1, { c: 2 }] }, d: [{ e: 3 }] });
    expect(isDeeplyFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(Object.isFrozen(value.a.b[1])).toBe(true);
    expect(() => {
      (value.a as Record<string, unknown>).b = 'x';
    }).toThrow();
  });

  it('is cycle-safe and skips already-frozen branches', () => {
    const shared = deepFreeze({ x: 1 });
    const cyclic: Record<string, unknown> = { shared };
    cyclic.self = cyclic;
    expect(isDeeplyFrozen(deepFreeze(cyclic))).toBe(true);
    expect(Object.isFrozen(shared)).toBe(true);
  });

  it('reports unfrozen leaves', () => {
    expect(isDeeplyFrozen({ a: { b: 2 } })).toBe(false);
    expect(isDeeplyFrozen(42)).toBe(true);
    expect(isDeeplyFrozen(null)).toBe(true);
  });
});

describe('canonical serialization and hashing', () => {
  it('serializes objects with recursively sorted keys (order independence)', () => {
    expect(canonicalString({ b: 1, a: 2 })).toBe(canonicalString({ a: 2, b: 1 }));
    expect(canonicalString({ z: { y: 1, x: 2 }, a: [3, { c: 1, b: 2 }] })).toBe(
      canonicalString({ a: [3, { b: 2, c: 1 }], z: { x: 2, y: 1 } }),
    );
  });

  it('renders scalars and strings deterministically', () => {
    expect(canonicalString(null)).toBe('null');
    expect(canonicalString(true)).toBe('true');
    expect(canonicalString(-0)).toBe('0');
    expect(canonicalString('a"b')).toBe('"a\\"b"');
    expect(canonicalString([1, 'x'])).toBe('[1,"x"]');
  });

  it('throws on non-serializable values (totality)', () => {
    expect(() => canonicalString(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalString(undefined)).toThrow(TypeError);
    expect(() => canonicalString(() => 1)).toThrow(TypeError);
  });

  it('hashes deterministically (same content, same hash) and distinguishes content', () => {
    expect(hashOf({ a: 1, b: [2, 3] })).toBe(hashOf({ b: [2, 3], a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
    expect(hashOf('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
  });
});

describe('opaque ids', () => {
  it('validating constructors reject empties and non-strings', () => {
    expect(datasetRef('acme-live').ok).toBe(true);
    expect(datasetRef('').ok).toBe(false);
    expect(tenantId('').ok).toBe(false);
    expect(tenantId('acme').ok).toBe(true);
  });

  it('lineage hashes are 8-8 dashed lowercase hex', () => {
    expect(isLineageHash('0123abcd-ffffffff')).toBe(true);
    expect(isLineageHash('0123ABCD-FFFFFFFF')).toBe(false);
    expect(isLineageHash('0123abcd')).toBe(false);
    expect(isLineageHash(hashOf({ any: 'content' }))).toBe(true);
  });
});

describe('canonical event validation (T008 envelope mirror)', () => {
  it('accepts the fixture floor', () => {
    expect(validateCanonicalEvent(rawEvent('evt-1', 1_000)).ok).toBe(true);
  });

  it('collects every violation: missing fields, bad types, unknown discriminators', () => {
    const result = validateCanonicalEvent({});
    const paths = result.errors.map((error) => error.path);
    for (const path of ['event_type', 'event_id', 'venue', 'instrument', 'asset_class', 'event_time', 'source_time', 'available_time', 'ingestion_time', 'sequence', 'provenance', 'payload']) {
      expect(paths).toContain(path);
    }
    expect(result.ok).toBe(false);

    const bad = validateCanonicalEvent({ ...rawEvent('evt-2', 1_000), event_type: 'warp' });
    expect(bad.errors.some((error) => error.code === 'unknown_event_type')).toBe(true);

    const badAsset = validateCanonicalEvent({ ...rawEvent('evt-3', 1_000), asset_class: 'stamps' });
    expect(badAsset.errors.some((error) => error.code === 'unknown_asset_class')).toBe(true);
  });

  it('rejects non-object candidates with a typed invalid-type error', () => {
    for (const candidate of [null, 42, 'event', []]) {
      const result = validateCanonicalEvent(candidate);
      expect(result.ok).toBe(false);
      expect(result.errors[0]?.code).toBe('invalid_type');
    }
  });

  it('enforces the ONE quartet ordering (D-003): available_time >= event_time', () => {
    // rawEvent('evt-4', 1_000) has event_time 950 — availability 900 precedes it.
    const early = validateCanonicalEvent({ ...rawEvent('evt-4', 1_000), available_time: 900 });
    expect(early.ok).toBe(false);
    expect(early.errors.some((error) => error.code === 'timestamp_order')).toBe(true);
    // Equal is the boundary: information about an event is observable at the event instant.
    expect(validateCanonicalEvent({ ...rawEvent('evt-5', 1_000), available_time: 950, event_time: 950 }).ok).toBe(true);
  });

  it('future-dated availability is VALID at the envelope (withholding is the firewall\'s job)', () => {
    expect(validateCanonicalEvent(rawEvent('evt-future', 1_000_000_000)).ok).toBe(true);
  });

  it('rejects invalid quartet timestamps and sequences', () => {
    expect(validateCanonicalEvent({ ...rawEvent('evt-6', 1_000), event_time: -1 }).ok).toBe(false);
    expect(validateCanonicalEvent({ ...rawEvent('evt-7', 1_000), ingestion_time: 1.5 }).ok).toBe(false);
    expect(validateCanonicalEvent({ ...rawEvent('evt-8', 1_000), sequence: -1 }).ok).toBe(false);
    expect(validateCanonicalEvent({ ...rawEvent('evt-9', 1_000), sequence: 1.5 }).ok).toBe(false);
  });

  it('enforces the other-kind rule and the payload-record floor', () => {
    const otherNoKind = validateCanonicalEvent({ ...rawEvent('evt-10', 1_000), event_type: 'other', payload: { note: 'kindless' } });
    expect(otherNoKind.errors.some((error) => error.code === 'other_kind_required')).toBe(true);
    expect(validateCanonicalEvent({ ...rawEvent('evt-11', 1_000), event_type: 'other', payload: { kind: 'opinion' } }).ok).toBe(true);
    expect(validateCanonicalEvent({ ...rawEvent('evt-12', 1_000), payload: 'not-an-object' }).ok).toBe(false);
  });

  it('carries the full taxonomy surface (mirror parity lists)', () => {
    expect(EVENT_TYPES).toHaveLength(11);
    expect(ASSET_CLASSES).toHaveLength(8);
    expect(EVENT_ORIGINS).toEqual(['historical', 'simulated', 'generated']);
  });
});

describe('ingestion provenance validation (mirror)', () => {
  const base = { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null };

  it('accepts the historical floor and rejects origin/adapters violations', () => {
    expect(validateIngestionProvenance(base, 'evt-1')).toHaveLength(0);
    expect(validateIngestionProvenance({ ...base, origin: 'mythical' }, 'evt-2').length).toBeGreaterThan(0);
    // historical events must reference their adapter
    expect(
      validateIngestionProvenance({ ...base, adapter: null }, 'evt-3').some((error) => error.code === 'provenance_adapter_required'),
    ).toBe(true);
    // simulated events may omit the adapter
    expect(validateIngestionProvenance({ ...base, origin: 'simulated', adapter: null }, 'evt-4')).toHaveLength(0);
  });

  it('enforces the lineage rules: transform-iff-parents, no self-reference, no duplicates', () => {
    expect(
      validateIngestionProvenance({ ...base, derived_from: ['p-1'] }, 'evt-5').some((error) => error.code === 'provenance_transform_required'),
    ).toBe(true);
    expect(
      validateIngestionProvenance({ ...base, derived_from: [], transform: 't' }, 'evt-6').some(
        (error) => error.code === 'provenance_transform_without_parents',
      ),
    ).toBe(true);
    expect(
      validateIngestionProvenance({ ...base, derived_from: ['evt-7'], transform: 't' }, 'evt-7').some(
        (error) => error.code === 'provenance_self_reference',
      ),
    ).toBe(true);
    expect(
      validateIngestionProvenance({ ...base, derived_from: ['p-1', 'p-1'], transform: 't' }, 'evt-8').some(
        (error) => error.code === 'provenance_duplicate_parent',
      ),
    ).toBe(true);
    expect(
      validateIngestionProvenance({ ...base, derived_from: ['p-1', 'p-2'], transform: 't' }, 'evt-9'),
    ).toHaveLength(0);
  });

  it('machine provenance requires the stored block (custody + corrections)', () => {
    expect(isMachineProvenance({ ...base })).toBe(false); // no custody/corrections
    expect(isMachineProvenance(null)).toBe(false);
    expect(
      isMachineProvenance({
        ...base,
        corrections: [],
        custody: { adapter: base.adapter, batch: { batch_id: 'b-1' }, commit: { commit_id: 'c-1', commit_sequence: 1, ingestion_time: 5 } },
      }),
    ).toBe(true);
  });
});

describe('computation policy (mirror)', () => {
  it('requires a non-empty transform id and a valid delay', () => {
    expect(isComputationPolicy({ transform_id: 'vwap', delay: {} })).toBe(true);
    expect(isComputationPolicy({ transform_id: 'vwap', delay: { milliseconds: 250 } })).toBe(true);
    expect(isComputationPolicy({ transform_id: '', delay: {} })).toBe(false);
    expect(isComputationPolicy({ transform_id: 'vwap', delay: { milliseconds: -1 } })).toBe(false);
    expect(isComputationPolicy(null)).toBe(false);
  });
});

describe('ingest clock (L9 — injected, deterministic)', () => {
  it('steps deterministically from the base and pre-advances with consumed', () => {
    const clock = createDeterministicIngestClock(1_000, 5);
    expect(clock.ok).toBe(true);
    if (!clock.ok) return;
    expect(clock.value.next()).toBe(1_000);
    expect(clock.value.next()).toBe(1_005);
    const advanced = createDeterministicIngestClock(1_000, 5, 2);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.value.next()).toBe(1_010); // two stamps already consumed
  });

  it('rejects invalid bases, steps and consumed counts (typed failures)', () => {
    expect(createDeterministicIngestClock(-1).ok).toBe(false);
    expect(createDeterministicIngestClock(1_000, 0).ok).toBe(false);
    expect(createDeterministicIngestClock(1_000, 1.5).ok).toBe(false);
    expect(createDeterministicIngestClock(1_000, 1, -1).ok).toBe(false);
  });

  it('exposes transferable state and converts throws/invalid stamps to typed failures', () => {
    const clock = createDeterministicIngestClock(500, 2);
    expect(clock.ok).toBe(true);
    if (!clock.ok) return;
    clock.value.next();
    expect(clock.value.state()).toEqual({ kind: 'builtin-stepping', base: 500, step_ms: 2, consumed: 1 });

    const throwing = { next: (): number => { throw new Error('boom'); } };
    expect(nextIngestStamp(throwing as unknown as IngestClock).ok).toBe(false);
    const invalid = { next: (): number => -5 };
    const result = nextIngestStamp(invalid as unknown as IngestClock);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_ingest_clock');
  });
});

describe('projection selector validation (T026 filter mirror)', () => {
  it('accepts the empty selector and valid bounds', () => {
    expect(validateProjectionSelector({}).ok).toBe(true);
    expect(validateProjectionSelector({ ids: ['a', 'b'], availableFrom: 1, availableTo: 2 }).ok).toBe(true);
  });

  it('rejects bad ids, duplicates, bad bounds and inverted windows', () => {
    expect(validateProjectionSelector({ ids: ['a', ''] }).ok).toBe(false);
    expect(validateProjectionSelector({ ids: ['a', 'a'] }).ok).toBe(false);
    expect(validateProjectionSelector({ ids: 'a' }).ok).toBe(false);
    expect(validateProjectionSelector({ availableFrom: -1 }).ok).toBe(false);
    expect(validateProjectionSelector({ availableFrom: 10, availableTo: 5 }).ok).toBe(false);
    expect(validateProjectionSelector(null).ok).toBe(false);
  });
});

describe('admission stamp guard', () => {
  it('validates ordinals, ids, stamps and arrival sequences', () => {
    expect(isAdmissionStamp({ batch_ordinal: 1, batch_id: 'b', ingestion_time: 5, arrival_sequence: 0 })).toBe(true);
    expect(isAdmissionStamp({ batch_ordinal: 0, batch_id: 'b', ingestion_time: 5, arrival_sequence: 0 })).toBe(false);
    expect(isAdmissionStamp({ batch_ordinal: 1, batch_id: '', ingestion_time: 5, arrival_sequence: 0 })).toBe(false);
    expect(isAdmissionStamp({ batch_ordinal: 1, batch_id: 'b', ingestion_time: -5, arrival_sequence: 0 })).toBe(false);
    expect(isAdmissionStamp({ batch_ordinal: 1, batch_id: 'b', ingestion_time: 5, arrival_sequence: -1 })).toBe(false);
    expect(isAdmissionStamp(null)).toBe(false);
  });
});
