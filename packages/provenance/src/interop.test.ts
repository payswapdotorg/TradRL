/**
 * Cross-package interoperability trip wires for the T008 data plane.
 *
 * The five declarations of `TimestampMs` (canonical @tradrl/time-engine +
 * four structural mirrors: market-protocol, provenance, event-store,
 * data-ingestion) and the provenance/envelope mirrors are deliberately NOT
 * package dependencies (the frozen workspace lockfile forbids it — law
 * D-004). This file is the trip wire: if any declaration drifts, the
 * type-level assertions below fail `pnpm typecheck`, and the runtime
 * parity checks fail `pnpm test`. It follows the established pattern of
 * `packages/market-protocol/src/interop.test.ts` (cross-package imports
 * happen ONLY in tests, via relative paths).
 *
 * It also proves the plane's L4 behavior end-to-end: future-dated
 * availability passes the whole ingest plane and is withheld by the
 * time-engine firewall until the clock reaches it.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_TIMESTAMP_MS as PROV_MAX,
  MIN_TIMESTAMP_MS as PROV_MIN,
  isTimestampMs as provIsTimestampMs,
  validateProvenanceRecord,
  type ProvenanceRecord,
  type TimestampMs as ProvTimestampMs,
} from './index';
import {
  EVENT_TYPES as PROTOCOL_EVENT_TYPES,
  ASSET_CLASSES as PROTOCOL_ASSET_CLASSES,
  MAX_TIMESTAMP_MS as PROTOCOL_MAX,
  MIN_TIMESTAMP_MS as PROTOCOL_MIN,
  isTimestampMs as protocolIsTimestampMs,
  validateMarketEvent,
  validateProvenance as protocolValidateProvenance,
  validateSequenceMonotonicity,
  type MarketEvent,
  type Provenance as ProtocolProvenance,
  type TimestampMs as ProtocolTimestampMs,
} from '../../market-protocol/src/index';
import {
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  advanceClockTo,
  createSimulationClock,
  createVisibilityFilter,
  isTimestampMs as engineIsTimestampMs,
  requireTimestampMs,
  validateDerivedAvailability,
  type DerivedAvailability,
  type Observable,
  type TimestampMs as EngineTimestampMs,
} from '../../time-engine/src/index';
import {
  ASSET_CLASSES as STORE_ASSET_CLASSES,
  EVENT_TYPES as STORE_EVENT_TYPES,
  MAX_TIMESTAMP_MS as STORE_MAX,
  MIN_TIMESTAMP_MS as STORE_MIN,
  isTimestampMs as storeIsTimestampMs,
  isStorableProvenance,
  validateBatchSequences as storeValidateBatchSequences,
  checkDerivedAvailability,
  type StorableEvent,
  type StorableProvenance,
  type TimestampMs as StoreTimestampMs,
} from '../../../services/event-store/src/index';
import {
  ASSET_CLASSES as INGEST_ASSET_CLASSES,
  EVENT_TYPES as INGEST_EVENT_TYPES,
  MAX_TIMESTAMP_MS as INGEST_MAX,
  MIN_TIMESTAMP_MS as INGEST_MIN,
  createSyntheticNewsAdapter,
  createSyntheticTickAdapter,
  isTimestampMs as ingestIsTimestampMs,
  type ProviderAdapter,
  validateBatchSequences as ingestValidateBatchSequences,
  type CanonicalEvent,
  type TimestampMs as IngestTimestampMs,
} from '../../../services/data-ingestion/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if any mirror drifts).
// ---------------------------------------------------------------------------

/** Compiles iff provenance TimestampMs is assignable to the engine's canonical. */
function provTimestampIsEngineTimestamp(value: ProvTimestampMs): EngineTimestampMs {
  return value;
}

/** Compiles iff the engine's canonical TimestampMs is assignable to provenance's. */
function engineTimestampIsProvTimestamp(value: EngineTimestampMs): ProvTimestampMs {
  return value;
}

/** Compiles iff the store's mirror is mutually assignable with market-protocol's. */
function storeTimestampIsProtocolTimestamp(value: StoreTimestampMs): ProtocolTimestampMs {
  return value;
}

/** Compiles iff ingestion's mirror is mutually assignable with market-protocol's. */
function ingestTimestampIsProtocolTimestamp(value: IngestTimestampMs): ProtocolTimestampMs {
  return value;
}

/** Compiles iff a ProvenanceRecord (store-level extension) IS a market-protocol Provenance block. */
function provenanceRecordIsProtocolProvenance(value: ProvenanceRecord): ProtocolProvenance {
  return value;
}

/** Compiles iff a validated market-protocol MarketEvent is committable to the store. */
function marketEventIsStorable(value: MarketEvent): StorableEvent {
  return value;
}

/** Compiles iff a validated market-protocol MarketEvent is a canonical ingestion event. */
function marketEventIsCanonical(value: MarketEvent): CanonicalEvent {
  return value;
}

/** Compiles iff a StorableEvent structurally satisfies the firewall's Observable. */
function storedEventIsObservable(value: StorableEvent): Observable {
  return value;
}

/** Compiles iff a CanonicalEvent structurally satisfies the firewall's Observable. */
function canonicalEventIsObservable(value: CanonicalEvent): Observable {
  return value;
}

/** Compiles iff a market-protocol MarketEvent is a sequenced event for both service mirrors. */
function marketEventIsSequenced(value: MarketEvent): StorableEvent {
  return value;
}

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

function ts(n: number): EngineTimestampMs {
  return requireTimestampMs(n);
}

const CUSTODY = {
  adapter: { id: 'synthetic-tick-adapter', version: '1.0.0' },
  batch: { batch_id: 'tick-batch-001' },
  commit: { commit_id: 'cmt-00000001', commit_sequence: 1, ingestion_time: requireTimestampMs(10_000) },
};

/** market-protocol's own provenance fixtures (from its provenance.test.ts). */
const PROTOCOL_HISTORICAL: ProtocolProvenance = {
  origin: 'historical',
  adapter: { id: 'binance-adapter', version: '1.4.0' },
  derived_from: [],
  transform: null,
};
const PROTOCOL_SIMULATED: ProtocolProvenance = {
  origin: 'simulated',
  adapter: null,
  derived_from: [],
  transform: null,
};

/** The same fixtures, extended into store-level records. */
const STORE_LEVEL: ProvenanceRecord = {
  ...PROTOCOL_HISTORICAL,
  corrections: [],
  custody: CUSTODY,
};

/** A market-protocol-valid trade event (validated through THEIR validator). */
function canonicalTrade(availableTime: number, sequence: number, eventId: string): MarketEvent {
  const candidate = {
    event_id: eventId,
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'trade' as const,
    event_time: ts(availableTime - 50),
    source_time: ts(availableTime - 50),
    available_time: ts(availableTime),
    ingestion_time: ts(availableTime + 100),
    sequence,
    provider: 'binance',
    provenance: PROTOCOL_HISTORICAL,
    payload: { price: '43125.10', size: '0.017', side: 'buy' as const },
  };
  const result = validateMarketEvent(candidate);
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('TimestampMs structural mirrors (five declarations, one canonical)', () => {
  it('keeps every mirrored constant identical', () => {
    expect(PROV_MIN).toBe(ENGINE_MIN);
    expect(PROV_MAX).toBe(ENGINE_MAX);
    expect(PROTOCOL_MIN).toBe(ENGINE_MIN);
    expect(PROTOCOL_MAX).toBe(ENGINE_MAX);
    expect(STORE_MIN).toBe(ENGINE_MIN);
    expect(STORE_MAX).toBe(ENGINE_MAX);
    expect(INGEST_MIN).toBe(ENGINE_MIN);
    expect(INGEST_MAX).toBe(ENGINE_MAX);
  });

  it('keeps every mirrored guard behaviorally identical', () => {
    const samples = [0, 1, 1.5, -1, ENGINE_MAX, ENGINE_MAX + 1, Number.NaN, 'x', null, undefined];
    for (const sample of samples) {
      const expected = engineIsTimestampMs(sample);
      expect(provIsTimestampMs(sample)).toBe(expected);
      expect(protocolIsTimestampMs(sample)).toBe(expected);
      expect(storeIsTimestampMs(sample)).toBe(expected);
      expect(ingestIsTimestampMs(sample)).toBe(expected);
    }
  });

  it('exercises the type-level mirror functions (compile-time trip wire)', () => {
    const fromEngine = requireTimestampMs(42);
    const asProv = engineTimestampIsProvTimestamp(fromEngine);
    const asEngine = provTimestampIsEngineTimestamp(asProv);
    expect(asEngine).toBe(42);
    expect(storeTimestampIsProtocolTimestamp(asEngine)).toBe(42);
    expect(ingestTimestampIsProtocolTimestamp(asEngine)).toBe(42);
  });
});

describe('Provenance mirrors against market-protocol fixture shapes', () => {
  it('a ProvenanceRecord (store-level) IS a market-protocol Provenance block (type-level)', () => {
    const witness: ProtocolProvenance = provenanceRecordIsProtocolProvenance(STORE_LEVEL);
    expect(witness.origin).toBe('historical');
    expect(witness.adapter?.id).toBe('binance-adapter');
  });

  it('market-protocol fixtures are valid INPUT provenance for the store (their validator + ours agree)', () => {
    expect(protocolValidateProvenance(PROTOCOL_HISTORICAL, 'evt-1')).toEqual([]);
    expect(protocolValidateProvenance(PROTOCOL_SIMULATED, 'evt-1')).toEqual([]);
    // The store's input-provenance guard accepts market-protocol fixture shapes.
    expect(isStorableProvenance(PROTOCOL_HISTORICAL)).toBe(true);
    expect(isStorableProvenance(PROTOCOL_SIMULATED)).toBe(true);
    const asStorable: StorableProvenance = PROTOCOL_HISTORICAL;
    expect(asStorable.origin).toBe('historical');
  });

  it('market-protocol validation tolerates the store-level extension (backward compatible)', () => {
    expect(protocolValidateProvenance(STORE_LEVEL, 'evt-1')).toEqual([]);
  });

  it('the store-level record is a STRICTER contract: bare market-protocol provenance lacks custody/corrections', () => {
    expect(validateProvenanceRecord(PROTOCOL_HISTORICAL, 'evt-1').length).toBeGreaterThan(0);
    expect(validateProvenanceRecord(STORE_LEVEL, 'evt-1')).toEqual([]);
  });
});

describe('taxonomy mirrors (event types, asset classes)', () => {
  it('the event-store and data-ingestion taxonomies match market-protocol exactly', () => {
    expect([...STORE_EVENT_TYPES]).toEqual([...PROTOCOL_EVENT_TYPES]);
    expect([...INGEST_EVENT_TYPES]).toEqual([...PROTOCOL_EVENT_TYPES]);
    expect([...STORE_ASSET_CLASSES]).toEqual([...PROTOCOL_ASSET_CLASSES]);
    expect([...INGEST_ASSET_CLASSES]).toEqual([...PROTOCOL_ASSET_CLASSES]);
  });
});

describe('envelope mirrors: a validated MarketEvent feeds both services', () => {
  it('type-level: MarketEvent is assignable to StorableEvent AND CanonicalEvent', () => {
    const event = canonicalTrade(1_000, 1, 'evt-mirror-1');
    const storable = marketEventIsStorable(event);
    const canonical = marketEventIsCanonical(event);
    expect(storable.event_id).toBe('evt-mirror-1');
    expect(canonical.event_id).toBe('evt-mirror-1');
    const sequenced = marketEventIsSequenced(event);
    expect(sequenced.sequence).toBe(1);
  });

  it('runtime: every CLEAN event the synthetic adapters emit passes market-protocol\'s own validator', () => {
    // news-n4 is the DELIBERATE quartet-violation fixture (a vendor clock
    // contradiction) — the plane's validation rejects it into the DLQ (see
    // data-ingestion.test.ts); everything else the adapters emit must be
    // valid canonical market events.
    const checkAdapter = <Raw,>(adapter: ProviderAdapter<Raw>): number => {
      let checked = 0;
      for (const batch of adapter.discover().batches) {
        for (const raw of adapter.fetch(batch).records) {
          for (const event of adapter.normalize(raw).events) {
            if (event.event_id === 'news-n4') continue;
            const result = validateMarketEvent(event);
            expect(result.ok, `${event.event_id}: ${JSON.stringify(result.ok ? null : result.errors)}`).toBe(true);
            checked += 1;
          }
        }
      }
      return checked;
    };
    expect(checkAdapter(createSyntheticTickAdapter()) + checkAdapter(createSyntheticNewsAdapter())).toBeGreaterThan(5);
  });
});

describe('sequence discipline parity (same fixtures, same violations)', () => {
  it('duplicate/regression violations are identical across market-protocol and both service mirrors', () => {
    // Fixture shapes mirror market-protocol's sequence.test.ts.
    const duplicate = [
      canonicalTrade(1_000, 1, 'evt-seq-1'),
      canonicalTrade(1_100, 2, 'evt-seq-2'),
      canonicalTrade(1_200, 2, 'evt-seq-3'), // duplicate sequence
    ];
    expect(storeValidateBatchSequences(duplicate)).toEqual(validateSequenceMonotonicity(duplicate));
    expect(ingestValidateBatchSequences(duplicate)).toEqual(validateSequenceMonotonicity(duplicate));

    const regressed = [
      canonicalTrade(1_000, 5, 'evt-seq-4'),
      canonicalTrade(1_100, 6, 'evt-seq-5'),
      canonicalTrade(1_200, 4, 'evt-seq-6'), // regressed sequence
    ];
    expect(storeValidateBatchSequences(regressed)).toEqual(validateSequenceMonotonicity(regressed));
    expect(ingestValidateBatchSequences(regressed)).toEqual(validateSequenceMonotonicity(regressed));

    const clean = [
      canonicalTrade(1_000, 1, 'evt-seq-7'),
      canonicalTrade(1_100, 2, 'evt-seq-8'),
      canonicalTrade(1_200, 5, 'evt-seq-9'), // gaps are fine
    ];
    expect(storeValidateBatchSequences(clean).ok).toBe(true);
    expect(ingestValidateBatchSequences(clean).ok).toBe(true);
  });

  it('independent streams never interfere (venue/instrument/type scoping matches)', () => {
    const events = [
      canonicalTrade(1_000, 1, 'evt-seq-10'),
      (() => {
        const candidate = {
          ...canonicalTrade(1_050, 1, 'evt-seq-11'),
          venue: 'COINBASE',
          instrument: 'BTC-USD',
        };
        return candidate;
      })(),
      (() => {
        const candidate = { ...canonicalTrade(1_100, 1, 'evt-seq-12'), event_type: 'quote' as const, payload: { bid_price: '1', bid_size: '1', ask_price: '1.1', ask_size: '1' } };
        const result = validateMarketEvent(candidate);
        if (!result.ok) throw new Error('quote fixture must be valid');
        return result.value;
      })(),
    ];
    expect(storeValidateBatchSequences(events).ok).toBe(true);
    expect(ingestValidateBatchSequences(events).ok).toBe(true);
    expect(validateSequenceMonotonicity(events).ok).toBe(true);
  });
});

describe('derived-availability parity with @tradrl/time-engine', () => {
  const parentAvailable = ts(2_000);

  function derivedEvent(availableTime: number): StorableEvent {
    const event = canonicalTrade(availableTime, 1, 'evt-derived-1');
    return {
      ...marketEventIsStorable(event),
      provenance: {
        origin: 'historical',
        adapter: { id: 'feature-adapter', version: '0.2.0' },
        derived_from: ['evt-parent-1'],
        transform: 'vwap-1m-aggregator',
      },
    };
  }

  function engineArtifact(availableTime: number): DerivedAvailability {
    return {
      available_time: ts(availableTime),
      derived_from: ['evt-parent-1'],
      computation: { transform_id: 'vwap-1m-aggregator', delay: { milliseconds: 0 } },
    };
  }

  it('both reject a derived event available BEFORE its parent', () => {
    const inputs: readonly Observable[] = [{ available_time: parentAvailable }];
    const engine = validateDerivedAvailability(inputs, engineArtifact(1_500));
    expect(engine.ok).toBe(false);
    if (!engine.ok) expect(engine.error.code).toBe('derived_before_inputs');

    const store = checkDerivedAvailability(derivedEvent(1_500), [parentAvailable]);
    expect(store).not.toBeNull();
    expect(store?.code).toBe('derived_before_inputs');
  });

  it('both accept a derived event available AT or after its parent', () => {
    const inputs: readonly Observable[] = [{ available_time: parentAvailable }];
    expect(validateDerivedAvailability(inputs, engineArtifact(2_000)).ok).toBe(true);
    expect(checkDerivedAvailability(derivedEvent(2_000), [parentAvailable])).toBeNull();
    expect(validateDerivedAvailability(inputs, engineArtifact(2_500)).ok).toBe(true);
    expect(checkDerivedAvailability(derivedEvent(2_500), [parentAvailable])).toBeNull();
  });
});

describe('L4 end-to-end: embargoed data passes the ingest plane, is withheld by the firewall', () => {
  const RELEASE_AT = 8_600_500; // news-batch-001 n2: published 5_000_500 + 3_600_000 embargo

  it('the embargoed canonical event is market-protocol-valid (validation is timeless)', () => {
    const candidate = {
      event_id: 'news-n2',
      venue: 'SYNTH',
      instrument: 'BTC-USDT',
      asset_class: 'crypto',
      event_type: 'news',
      event_time: ts(5_000_500),
      source_time: null,
      available_time: ts(RELEASE_AT),
      ingestion_time: ts(RELEASE_AT + 25),
      sequence: 2,
      provider: 'synthetic',
      provenance: PROTOCOL_HISTORICAL,
      payload: { headline: 'Synthetic wire: embargoed regulatory decision', symbols: ['BTC-USDT'], source: 'synthetic-wire' },
    };
    const result = validateMarketEvent(candidate);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const asCanonical = marketEventIsCanonical(result.value);
      expect(canonicalEventIsObservable(asCanonical).available_time).toBe(RELEASE_AT);
    }
  });

  it('the firewall withholds the stored embargoed event until exactly its release instant', () => {
    // A stored event carrying the embargoed availability.
    const stored: StorableEvent = marketEventIsStorable(
      canonicalTrade(RELEASE_AT, 1, 'evt-embargo'),
    );
    const observable = storedEventIsObservable(stored);
    expect(observable.available_time).toBe(RELEASE_AT);

    const clock = createSimulationClock({
      asOf: ts(RELEASE_AT),
      now: ts(5_000_000),
      fidelity: 'exact_replay',
    });
    if (!clock.ok) throw new Error('clock fixture must be valid');
    const filter = createVisibilityFilter<StorableEvent>(clock.value);
    expect(filter.isVisible(stored)).toBe(false);

    const justBefore = advanceClockTo(clock.value, ts(RELEASE_AT - 1));
    if (!justBefore.ok) throw new Error('clock fixture must be valid');
    expect(createVisibilityFilter<StorableEvent>(justBefore.value).isVisible(stored)).toBe(false);

    const atRelease = advanceClockTo(clock.value, ts(RELEASE_AT));
    if (!atRelease.ok) throw new Error('clock fixture must be valid');
    const released = createVisibilityFilter<StorableEvent>(atRelease.value);
    expect(released.isVisible(stored)).toBe(true);
    expect(released.filter([stored])).toEqual([stored]);
  });
});
