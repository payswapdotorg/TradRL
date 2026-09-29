// @tradrl/research (service) — THE CROSS-MARKET-LANE INTEROP TRIP WIRES.
//
// The lane's sources import NOTHING outside their own lane (the single
// import surface, src/cross-market/imports.ts, reaches only the lane's
// own contract package via a relative source path). This test file
// imports the REAL packages on this branch (test-only, via relative
// source paths — the repo's established pattern) and proves the
// SERVICE-level mirrors have not drifted:
//
//   1. THE ADAPTERS (T037/T038): the reference pipeline runs GREEN over a
//      REAL cross-venue, cross-asset-class source set — the Coinbase
//      adapter (rising BTC-USD trades) beside the equities adapter
//      (rising TEST-LARGECAP index levels) — driven through the REAL
//      provider-sdk fake transport, wrapped as the lane's multi-source
//      observation ports: the same ports, the L4 gate, the declared
//      relationship methods and the publication discipline.
//   2. agent-os (T006): the pipeline's ACTUAL publication envelope (not a
//      fixture) JSON-round-trips through the REAL createMessageEnvelope.
//   3. DETERMINISM: the same REAL-adapter stream produces byte-identical
//      reports across independently constructed sessions.
//   4. THE RESUME: the resumable run-state protocol runs over TWO REAL
//      adapters (index-level intake -> serialize -> parse -> resume over
//      the venue trades -> publish once) and lands on a byte-stable
//      report.

import { describe, expect, it } from 'vitest';

// --- The lane under test -----------------------------------------------------
import {
  type CrossMarketRunConfig,
  advanceCrossMarketRunState,
  createCrossMarketRunState,
  intakeCrossMarketRunState,
  resumeCrossMarketRunState,
  runCrossMarketPipeline,
  serializeCrossMarketRunState,
  CROSS_MARKET_RUN_CONFIG,
} from './index';
// the contract surface lives in the body package (the service-root
// collision law): tests import it through the body package's own surface.
import {
  CROSS_MARKET_METHOD_REGISTRY,
  createCrossMarketRecordingPort,
  serializeCrossMarketResearchReport,
  validateCrossMarketResearchReport,
  type CrossMarketObservation,
  type CrossMarketObservationSource,
  type TimestampMs,
} from '../../../../bodies/cross-market-researcher/src/index';

// --- REAL packages on this branch (test-only imports — the trip wires) ------
import {
  createCoinbaseAdapterSession,
  coinbaseSubscription,
  COINBASE_ENTITLEMENT,
  type AdapterSession as CoinbaseSession,
} from '../../../../adapters/coinbase/src/index';
import {
  createEquitiesAdapterSession,
  equitiesSubscription,
  EQUITIES_ENTITLEMENT,
  type AdapterSession as EquitiesSession,
} from '../../../../adapters/equities/src/index';
import {
  createFakeTransport,
  type FakeTransport,
  type JsonObject,
  type TransportScript,
} from '../../../../packages/provider-sdk/src/index';
import { createMessageEnvelope, isMessageEnvelope } from '../../../../packages/agent-os/src/index';

// --- helpers -----------------------------------------------------------------

const AT0 = 1_717_423_200_000; // 2024-06-03T14:00:00Z — Monday, inside the declared US regular session.
const ms = (value: number): TimestampMs => value as TimestampMs;

function unwrap<T>(result: { readonly ok: boolean; readonly errors?: readonly { code: string; message: string }[]; readonly value?: T }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result.value as T;
}

/**
 * The interop run config: the fixture lineage binding with the as-of
 * pushed one hour past every scripted instant (every real emission is
 * knowable — the L4 gate admits the whole stream; nothing is deferred).
 */
const INTEROP_CONFIG: CrossMarketRunConfig = {
  ...CROSS_MARKET_RUN_CONFIG,
  asOf: ms(AT0 + 3_600_000),
  publishedAt: ms(AT0 + 3_600_000),
  opId: 'op-crossmarket-interop-0001',
};

function script(inbound: readonly { at: number; channel: string; payload: JsonObject }[]): TransportScript {
  return {
    inbound: inbound.map((entry) => ({ at: entry.at as never, channel: entry.channel, payload: entry.payload })),
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  };
}

function transportFor(transportScript: TransportScript): FakeTransport {
  const construction = createFakeTransport(transportScript);
  if (!construction.ok) throw new Error(`script must validate: ${JSON.stringify(construction.errors)}`);
  return construction.transport;
}

/**
 * Wraps a REAL adapter session as the pipeline's injected observation
 * port: the session's `nextEvent` discipline IS the port's `next`
 * discipline. The REAL canonical event IS the lane's observation mirror
 * (extras ride — the canonical contract is a floor); the intake
 * classifier validates every pulled record at runtime.
 */
function adapterSource(
  session: CoinbaseSession | EquitiesSession,
  descriptor: { readonly id: string; readonly version: string; readonly provider: string },
): CrossMarketObservationSource {
  return {
    descriptor,
    next(): CrossMarketObservation | null {
      const pulled = session.nextEvent();
      if (!pulled.ok || pulled.value === null) return null;
      return pulled.value as unknown as CrossMarketObservation;
    },
  };
}

/** A REAL equities adapter session: four rising index levels on TEST-LARGECAP (one per 60s window). */
function realIndexLevelSource(): CrossMarketObservationSource {
  const indexLevelRecord = (sequence: number, dissemination: number, level: string): JsonObject =>
    ({
      recordType: 'INDEX_LEVEL',
      indexId: 'TEST-LARGECAP',
      tradeDate: '2024-06-03',
      disseminationTimeMs: dissemination,
      indexLevel: level,
      indexDivisor: '1234.5678',
      sequenceNumber: sequence,
    }) as JsonObject;

  const construction = createEquitiesAdapterSession({
    transport: transportFor(
      script([
        { at: AT0, channel: 'indexLevel', payload: indexLevelRecord(1, AT0, '100.0000') },
        { at: AT0 + 60_000, channel: 'indexLevel', payload: indexLevelRecord(2, AT0 + 60_000, '101.0000') },
        { at: AT0 + 120_000, channel: 'indexLevel', payload: indexLevelRecord(3, AT0 + 120_000, '102.0000') },
        { at: AT0 + 180_000, channel: 'indexLevel', payload: indexLevelRecord(4, AT0 + 180_000, '103.0000') },
      ]),
    ),
    entitlement: EQUITIES_ENTITLEMENT,
  });
  if (!construction.ok) throw new Error(`equities session must construct: ${JSON.stringify(construction.errors)}`);
  const session = construction.session;
  if (!session.open().ok) throw new Error('equities session must open');
  const spec = equitiesSubscription({ channel: 'indexLevel', instrument: 'TEST-LARGECAP' });
  if (!spec.ok) throw new Error('subscription must build');
  if (!session.subscribe(spec.value).ok) throw new Error('subscribe must succeed');
  return adapterSource(session, { id: 'adapter-equities', version: '1.0.0', provider: 'licensed-index-a' });
}

/** A REAL Coinbase adapter session: four rising BTC-USD matches (one per 60s window). */
function realVenueTradeSource(): CrossMarketObservationSource {
  const coinbaseMatch = (sequence: number, tradeId: number, price: string, isoTime: string): JsonObject =>
    ({
      type: 'match',
      trade_id: tradeId,
      sequence,
      maker_order_id: '2b6f88ef-7c21-4b1f-9a1e-1b1f4c6d1e5f',
      taker_order_id: 'f1a2b3c4-d5e6-4789-a012-3456789abcde',
      time: isoTime,
      product_id: 'BTC-USD',
      size: '0.01700000',
      price,
      side: 'buy',
    }) as JsonObject;

  const construction = createCoinbaseAdapterSession({
    transport: transportFor(
      script([
        { at: AT0, channel: 'match', payload: coinbaseMatch(1, 1, '50000.00', '2024-06-03T14:00:00.123456Z') },
        { at: AT0 + 60_000, channel: 'match', payload: coinbaseMatch(2, 2, '50500.00', '2024-06-03T14:01:00.123456Z') },
        { at: AT0 + 120_000, channel: 'match', payload: coinbaseMatch(3, 3, '51000.00', '2024-06-03T14:02:00.123456Z') },
        { at: AT0 + 180_000, channel: 'match', payload: coinbaseMatch(4, 4, '51500.00', '2024-06-03T14:03:00.123456Z') },
      ]),
    ),
    entitlement: COINBASE_ENTITLEMENT,
  });
  if (!construction.ok) throw new Error(`coinbase session must construct: ${JSON.stringify(construction.errors)}`);
  const session = construction.session;
  if (!session.open().ok) throw new Error('coinbase session must open');
  const spec = coinbaseSubscription({ channel: 'match', instrument: 'BTC-USD' });
  if (!spec.ok) throw new Error('subscription must build');
  if (!session.subscribe(spec.value).ok) throw new Error('subscribe must succeed');
  return adapterSource(session, { id: 'adapter-coinbase', version: '1.0.0', provider: 'coinbase' });
}

// ---------------------------------------------------------------------------
// 1. THE REAL ADAPTERS (T037/T038) feed the reference pipeline
// ---------------------------------------------------------------------------

describe('interop: REAL cross-venue adapter sessions feed the cross-market pipeline', () => {
  it('the full declared cycle runs green over real equities + coinbase emissions', () => {
    const publisher = createCrossMarketRecordingPort();
    const outcome = runCrossMarketPipeline(INTEROP_CONFIG, {
      sources: [realIndexLevelSource(), realVenueTradeSource()],
      publisher,
    });
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);

    // one cross-venue, cross-asset-class pair: the index level leg beside
    // the crypto trade leg — synchronized risers
    expect(value.relationships.length).toBe(3);
    const byKind = new Map(value.relationships.map((r) => [r.relationKind, r]));
    expect(byKind.get('co-movement')?.pair.left.venue).toBe('COINBASE');
    expect(byKind.get('co-movement')?.pair.right.venue).toBe('LICENSED-INDEX-A');
    expect(byKind.get('co-movement')?.measure.score).toBe('1.0000');
    expect(byKind.get('co-movement')?.measure.direction).toBe('positive');
    expect(byKind.get('co-movement')?.confidence.evidenceCount).toBe(8);
    expect(byKind.get('lead-lag')).toBeDefined();
    expect(byKind.get('spread-divergence')).toBeDefined();

    // full coverage: 8 offered, 8 admitted, nothing dropped
    expect(value.coverage).toEqual({
      observationsOffered: 8,
      observationsAdmitted: 8,
      observationsDeferred: 0,
      observationsUnsupported: 0,
      observationsInvalid: 0,
    });

    // the publication discipline: exactly one bound envelope through the port
    expect(publisher.published.length).toBe(1);
    expect(publisher.published[0]!.envelope.payload).toBe(`report:${value.reportId}`);

    // the report validates under the shipped body's declared method registry
    expect(validateCrossMarketResearchReport(value.publication.report, CROSS_MARKET_METHOD_REGISTRY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. agent-os (T006) — the pipeline's actual publication envelope
// ---------------------------------------------------------------------------

describe('interop: the publication envelope is agent-os-honest', () => {
  it('the pipeline\'s ACTUAL envelope round-trips through the REAL factory', () => {
    const outcome = runCrossMarketPipeline(INTEROP_CONFIG, {
      sources: [realIndexLevelSource(), realVenueTradeSource()],
      publisher: createCrossMarketRecordingPort(),
    });
    const value = unwrap(outcome);
    const real = createMessageEnvelope(JSON.parse(JSON.stringify(value.publication.envelope)));
    expect(isMessageEnvelope(real)).toBe(true);
    expect(real.id).toBe(value.publication.envelope.id);
    expect(real.payload).toBe(`report:${value.reportId}`);
    expect(real.sequence).toBe(INTEROP_CONFIG.publicationSequence);
    expect(real.topic).toBe(INTEROP_CONFIG.topic);
  });
});

// ---------------------------------------------------------------------------
// 3. DETERMINISM over independently constructed REAL sessions
// ---------------------------------------------------------------------------

describe('interop: determinism over REAL adapters', () => {
  it('two independently constructed cross-venue session sets produce byte-identical reports', () => {
    const once = runCrossMarketPipeline(INTEROP_CONFIG, {
      sources: [realIndexLevelSource(), realVenueTradeSource()],
      publisher: createCrossMarketRecordingPort(),
    });
    const twice = runCrossMarketPipeline(INTEROP_CONFIG, {
      sources: [realVenueTradeSource(), realIndexLevelSource()],
      publisher: createCrossMarketRecordingPort(),
    });
    expect(unwrap(once).reportId).toBe(unwrap(twice).reportId);
    expect(serializeCrossMarketResearchReport(unwrap(once).publication.report)).toBe(
      serializeCrossMarketResearchReport(unwrap(twice).publication.report),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. THE RESUME over two REAL adapters
// ---------------------------------------------------------------------------

describe('interop: the resumable protocol over REAL adapters', () => {
  it('index-level intake -> serialize -> parse -> resume over venue trades -> ONE publication', () => {
    // pass 1: intake over the REAL equities index-level channel only
    const state = createCrossMarketRunState(INTEROP_CONFIG);
    const afterIndexLevels = intakeCrossMarketRunState(state, [realIndexLevelSource()]);
    expect(afterIndexLevels.ok).toBe(true);
    expect(unwrap(afterIndexLevels).coverage.observationsAdmitted).toBe(4);
    expect(unwrap(afterIndexLevels).publishedReportIds.length).toBe(0);

    // serialize -> parse (chain verified) -> resume over the REAL coinbase venue
    const bytes = serializeCrossMarketRunState(unwrap(afterIndexLevels));
    const resumed = resumeCrossMarketRunState(bytes, {
      sources: [realVenueTradeSource()],
      publisher: createCrossMarketRecordingPort(),
    });
    expect(resumed.ok).toBe(true);
    const done = unwrap(resumed);
    // the merged run saw both real streams
    expect(done.state.coverage.observationsAdmitted).toBe(8);
    expect(done.state.publishedReportIds.length).toBe(1);
    expect(done.outcome.relationships.length).toBe(3);

    // ...and it is the SAME byte-stable report as the one-pass run
    const onePass = runCrossMarketPipeline(INTEROP_CONFIG, {
      sources: [realIndexLevelSource(), realVenueTradeSource()],
      publisher: createCrossMarketRecordingPort(),
    });
    expect(done.outcome.reportId).toBe(unwrap(onePass).reportId);
    expect(serializeCrossMarketResearchReport(done.outcome.publication.report)).toBe(
      serializeCrossMarketResearchReport(unwrap(onePass).publication.report),
    );
    void advanceCrossMarketRunState;
  });
});
