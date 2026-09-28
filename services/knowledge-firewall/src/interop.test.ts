/**
 * Cross-lane structural-mirror trip-wires for the firewall SERVICE layer
 * (T026, acceptance criterion: structural mirrors).
 *
 * The service core (mirrors.ts + service.ts) is zero-dependency by D-004:
 * it re-declares the knowledge contracts with identical brands instead of
 * importing them. These tests are the trip wire — if the service mirrors or
 * the time-engine/knowledge contracts drift, the type-level assertions
 * below fail `pnpm typecheck` and the runtime checks fail `pnpm test`:
 *
 *   - real KnowledgeBase <-> service KnowledgeBaseView (both directions),
 *   - real KnowledgeRecord <-> service mirror (both directions),
 *   - domain-core TenantId <-> service mirror (identical brand),
 *   - market-protocol Provenance <-> service mirror (the T008-shape
 *     provenance contract),
 *   - the real SimulationClock satisfies FirewallClock,
 *   - END-TO-END: the real fixtures (real bases built through the real
 *     append path, real clocks) flow through the mirror-typed service API.
 *
 * DEVIATION NOTE (dispatch): the T008 reference bundle was unavailable
 * (expired tmpfiles link; REFERENCE NEEDED reported; dispatcher directed
 * continuation). Mirror targets are therefore the repo-authoritative
 * contracts on main: time-engine/knowledge (this Work Order), market-protocol
 * provenance (the T008 lane's declared foundation) and domain-core tenant
 * identity. The Lead re-runs these trip-wires against the actual T008
 * provenance/event-store fixtures at the integration station.
 */

import { describe, expect, it } from 'vitest';

// The service's mirror declarations under test.
import {
  firewallGetRecord,
  firewallQuery,
  type FirewallClock,
  type KnowledgeBaseView,
  type KnowledgeRecord as MirrorKnowledgeRecord,
  type KnowledgeProvenance,
  type TenantId as MirrorTenantId,
} from './index';

// The REAL knowledge contracts (time-engine/knowledge — implemented by T026).
import {
  createKnowledgeRecord,
  type KnowledgeBase as RealKnowledgeBase,
  type KnowledgeRecord as RealKnowledgeRecord,
} from '../../../packages/time-engine/src/knowledge/index';
import { requireTimestampMs, type SimulationClock } from '../../../packages/time-engine/src/index';

// The mirrored cross-lane contracts.
import type { TenantId as DomainCoreTenantId } from '../../../packages/domain-core/src/index';
import type { Provenance as ProtocolProvenance } from '../../../packages/market-protocol/src/index';

// The real fixtures (integration wiring).
import { cleanKnowledgeGraph, firewallClockAt, ids, leakyKnowledgeGraph, tenantIsolationScenario } from './fixtures';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts).
// ---------------------------------------------------------------------------

/** Compiles iff a real KnowledgeBase is assignable to the service view. */
function realBaseIsView(value: RealKnowledgeBase): KnowledgeBaseView {
  return value;
}

/** Compiles iff the service view is assignable back to a real KnowledgeBase. */
function viewIsRealBase(value: KnowledgeBaseView): RealKnowledgeBase {
  return value;
}

/** Compiles iff a real KnowledgeRecord is assignable to the mirror. */
function realRecordIsMirror(value: RealKnowledgeRecord): MirrorKnowledgeRecord {
  return value;
}

/** Compiles iff the mirror record is assignable back to the real one. */
function mirrorRecordIsReal(value: MirrorKnowledgeRecord): RealKnowledgeRecord {
  return value;
}

/** Compiles iff domain-core TenantId is assignable to the mirror. */
function domainCoreTenantIsMirror(value: DomainCoreTenantId): MirrorTenantId {
  return value;
}

/** Compiles iff the mirror TenantId is assignable to domain-core's. */
function mirrorTenantIsDomainCore(value: MirrorTenantId): DomainCoreTenantId {
  return value;
}

/** Compiles iff market-protocol Provenance is assignable to the mirror. */
function protocolProvenanceIsMirror(value: ProtocolProvenance): KnowledgeProvenance {
  return value;
}

/** Compiles iff the mirror provenance is assignable to market-protocol's. */
function mirrorProvenanceIsProtocol(value: KnowledgeProvenance): ProtocolProvenance {
  return value;
}

/** Compiles iff the real SimulationClock satisfies FirewallClock. */
function simulationClockIsFirewallClock(value: SimulationClock): FirewallClock {
  return value;
}

// ---------------------------------------------------------------------------
// Trip-wire tests.
// ---------------------------------------------------------------------------

describe('service mirrors <-> time-engine/knowledge contracts (D-004 trip wire)', () => {
  it('a real record and base flow through the mirror types (compile-time + runtime)', () => {
    const recordResult = createKnowledgeRecord({
      record_id: 'kr-interop-1',
      tenant: 'acme',
      payload: { proof: true },
      event_time: requireTimestampMs(950),
      source_time: null,
      available_time: requireTimestampMs(1_000),
      ingestion_time: requireTimestampMs(1_050),
      inputs: [],
      computation: null,
      provenance: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null },
    });
    if (!recordResult.ok) throw new Error('fixture must be valid');
    const realRecord: RealKnowledgeRecord = recordResult.value;

    const asMirror = realRecordIsMirror(realRecord);
    const backToReal = mirrorRecordIsReal(asMirror);
    expect(backToReal.record_id).toBe('kr-interop-1');
    expect(backToReal.available_time).toBe(1_000);

    const realBase: RealKnowledgeBase = { records: [realRecord], size: 1 };
    const asView = realBaseIsView(realBase);
    expect(asView.size).toBe(1);
    const backToBase = viewIsRealBase(asView);
    expect(backToBase.records.length).toBe(1);
  });

  it('tenant identity mirrors domain-core (identical brand, both directions)', () => {
    const fromDomainCore: DomainCoreTenantId = 'acme' as DomainCoreTenantId;
    const asMirror = domainCoreTenantIsMirror(fromDomainCore);
    const back = mirrorTenantIsDomainCore(asMirror);
    expect(back).toBe('acme');
  });

  it('provenance mirrors market-protocol (the T008-shape foundation, both directions)', () => {
    const fromProtocol: ProtocolProvenance = {
      origin: 'historical',
      adapter: { id: 'binance-adapter', version: '1.4.0' },
      derived_from: ['evt-1'],
      transform: 'resample-1m',
    };
    const asMirror = protocolProvenanceIsMirror(fromProtocol);
    const back = mirrorProvenanceIsProtocol(asMirror);
    expect(back.origin).toBe('historical');
    expect(back.transform).toBe('resample-1m');
  });

  it('the real SimulationClock satisfies FirewallClock', () => {
    const clock: SimulationClock = firewallClockAt(3_250);
    const asFirewallClock = simulationClockIsFirewallClock(clock);
    expect(asFirewallClock.now).toBe(3_250);
  });
});

describe('END-TO-END: real bases and real clocks through the mirror-typed service', () => {
  it('queries the clean fixture base with a real SimulationClock', () => {
    const fixture = cleanKnowledgeGraph();
    const clock: FirewallClock = simulationClockIsFirewallClock(firewallClockAt(3_250));
    const result = firewallQuery(realBaseIsView(fixture.base), clock, ids.acme(), {});
    if (!result.ok) throw new Error(`unexpected failure: ${result.error.code}`);
    expect(result.records.map((record) => record.record_id)).toEqual([
      'kr-trade-1',
      'kr-trade-2',
      'kr-trade-3',
      'kr-feature-vwap',
    ]);
    // The real feature record, round-tripped through the mirror typing:
    const feature = result.records.find((record) => record.record_id === 'kr-feature-vwap');
    const realFeature = feature === undefined ? undefined : mirrorRecordIsReal(feature);
    expect(realFeature?.computation?.transform_id).toBe('vwap-1m-aggregator');
  });

  it('reads and rejects over the tenant fixture base with typed errors', () => {
    const mixed = tenantIsolationScenario();
    const clock = firewallClockAt(2_000);
    const served = firewallGetRecord(realBaseIsView(mixed.base), clock, ids.acme(), ids.record('kr-acme-1'));
    expect(served.ok).toBe(true);

    const rejected = firewallGetRecord(realBaseIsView(mixed.base), clock, ids.globex(), ids.record('kr-acme-1'));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('tenant_isolation');
  });

  it('queries the leaky fixture base (reads stay policed; the scan owns the graph audit)', () => {
    const leaky = leakyKnowledgeGraph();
    const result = firewallQuery(realBaseIsView(leaky.base), firewallClockAt(10_000), ids.acme(), {});
    if (!result.ok) throw new Error(`unexpected failure: ${result.error.code}`);
    expect(result.records.map((record) => record.record_id)).toEqual(['kr-raw-late', 'kr-derived-eager']);
    expect(leaky.scan.clean).toBe(false); // the forensic instrument flags the leak
  });
});
