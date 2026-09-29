// @tradrl/research (service) — THE FUNDAMENTAL-LANE INTEROP TRIP WIRES.
//
// The lane's sources import NOTHING outside their own lane (the single
// import surface, src/fundamental/imports.ts, reaches only the lane's
// own contract package via a relative source path). This test file
// imports the REAL packages on this branch (test-only, via relative
// source paths — the repo's established pattern) and proves the
// SERVICE-level mirrors have not drifted:
//
//   1. THE ADAPTERS (T038): the reference pipeline runs GREEN over REAL
//      equities + alternative-data adapter sessions (driven through the
//      REAL provider-sdk fake transport) wrapped as observation sources —
//      the scripted fake used throughout the tests mirrors the REAL
//      emitter shapes, and here the REAL thing flows through the very
//      same port, the L4 gate, the declared methods and the publication
//      discipline.
//   2. agent-os (T006): the pipeline's ACTUAL publication envelope (not a
//      fixture) JSON-round-trips through the REAL createMessageEnvelope.
//   3. DETERMINISM: the same REAL-adapter stream produces byte-identical
//      reports across independently constructed sessions.
//   4. THE RESUME: the resumable run-state protocol runs over TWO REAL
//      adapters (index-level intake -> serialize -> parse -> resume over
//      economic series -> publish once) and lands on a byte-stable
//      report.

import { describe, expect, it } from 'vitest';

// --- The lane under test -----------------------------------------------------
import {
  type FundamentalRunConfig,
  createFundamentalRunState,
  intakeFundamentalRunState,
  resumeFundamentalRunState,
  runFundamentalPipeline,
  serializeFundamentalRunState,
  FUNDAMENTAL_RUN_CONFIG,
} from './index';
// the contract surface lives in the body package (the service-root
// collision law): tests import it through the body package's own surface.
import {
  FUNDAMENTAL_METHOD_REGISTRY,
  createFundamentalRecordingPort,
  serializeFundamentalResearchReport,
  validateFundamentalResearchReport,
  type FundamentalObservation,
  type FundamentalObservationSource,
  type TimestampMs,
} from '../../../../bodies/fundamental-researcher/src/index';

// --- REAL packages on this branch (test-only imports — the trip wires) ------
import {
  createEquitiesAdapterSession,
  equitiesSubscription,
  EQUITIES_ENTITLEMENT,
  type AdapterSession as EquitiesAdapterSession,
} from '../../../../adapters/equities/src/index';
import {
  createAltDataAdapterSession,
  altDataSubscription,
  ALTDATA_VENDOR_ENTITLEMENT,
  type AdapterSession as AltDataAdapterSession,
} from '../../../../adapters/alternative-data/src/index';
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
const INTEROP_CONFIG: FundamentalRunConfig = {
  ...FUNDAMENTAL_RUN_CONFIG,
  asOf: ms(AT0 + 3_600_000),
  publishedAt: ms(AT0 + 3_600_000),
  opId: 'op-fundamental-interop-0001',
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
  session: EquitiesAdapterSession | AltDataAdapterSession,
  descriptor: { readonly id: string; readonly version: string; readonly provider: string },
): FundamentalObservationSource {
  return {
    descriptor,
    next(): FundamentalObservation | null {
      const pulled = session.nextEvent();
      if (!pulled.ok || pulled.value === null) return null;
      return pulled.value as unknown as FundamentalObservation;
    },
  };
}

/** A REAL equities adapter session: five rising index levels on TEST-LARGECAP. */
function realIndexLevelSource(): FundamentalObservationSource {
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
        { at: AT0 + 10, channel: 'indexLevel', payload: indexLevelRecord(2, AT0 + 10, '101.0000') },
        { at: AT0 + 20, channel: 'indexLevel', payload: indexLevelRecord(3, AT0 + 20, '100.5000') },
        { at: AT0 + 30, channel: 'indexLevel', payload: indexLevelRecord(4, AT0 + 30, '100.7500') },
        { at: AT0 + 40, channel: 'indexLevel', payload: indexLevelRecord(5, AT0 + 40, '103.0000') },
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

/** A REAL equities adapter session: one corporate action on TEST-AAA. */
function realCorporateActionSource(): FundamentalObservationSource {
  const construction = createEquitiesAdapterSession({
    transport: transportFor(
      script([
        {
          at: AT0 + 50,
          channel: 'corporateActions',
          payload: {
            recordType: 'CORPORATE_ACTION',
            actionId: 'INT-ACT-0001',
            corporateSymbol: 'TEST-AAA',
            actionTypeCode: 'SPLIT',
            effectiveDate: '2024-06-10',
            announcementTimeMs: AT0 + 50,
            actionRatio: '4:1',
            currencyCode: 'USD',
          } as JsonObject,
        },
      ]),
    ),
    entitlement: EQUITIES_ENTITLEMENT,
  });
  if (!construction.ok) throw new Error(`equities session must construct: ${JSON.stringify(construction.errors)}`);
  const session = construction.session;
  if (!session.open().ok) throw new Error('equities session must open');
  const spec = equitiesSubscription({ channel: 'corporateActions', instrument: 'TEST-AAA' });
  if (!spec.ok) throw new Error('subscription must build');
  if (!session.subscribe(spec.value).ok) throw new Error('subscribe must succeed');
  return adapterSource(session, { id: 'adapter-equities', version: '1.0.0', provider: 'licensed-index-a' });
}

/** A REAL alternative-data session: two above-consensus CPI releases. */
function realEconomicSeriesSource(): FundamentalObservationSource {
  const economicSeries = (seriesId: string, period: string, actual: string, forecast: string, window: { windowStartMs: number; windowEndMs: number }): JsonObject =>
    ({
      recordType: 'ECONOMIC_SERIES_OBSERVATION',
      seriesId,
      regionCode: 'US',
      period,
      actualValue: actual,
      forecastValue: forecast,
      priorValue: actual,
      unitCode: '%',
      ...window,
      releaseTimeMs: AT0,
    }) as JsonObject;
  // two non-overlapping observation windows (the adapter's per-series law)
  const W1 = { windowStartMs: AT0 - 3_600_000, windowEndMs: AT0 - 1_800_000 };
  const W2 = { windowStartMs: AT0 - 1_800_000, windowEndMs: AT0 };

  const construction = createAltDataAdapterSession({
    transport: transportFor(
      script([
        { at: AT0, channel: 'economicSeries', payload: economicSeries('INT-ECON-CPI', '2024-04', '3.4', '3.2', W1) },
        { at: AT0 + 1_000, channel: 'economicSeries', payload: economicSeries('INT-ECON-CPI', '2024-05', '3.3', '3.25', W2) },
      ]),
    ),
    entitlement: ALTDATA_VENDOR_ENTITLEMENT,
  });
  if (!construction.ok) throw new Error(`alt-data session must construct: ${JSON.stringify(construction.errors)}`);
  const session = construction.session;
  if (!session.open().ok) throw new Error('alt-data session must open');
  const spec = altDataSubscription({ channel: 'economicSeries', instrument: 'TEST-ECON-CPI' });
  if (!spec.ok) throw new Error('subscription must build');
  if (!session.subscribe(spec.value).ok) throw new Error('subscribe must succeed');
  return adapterSource(session, { id: 'adapter-altdata', version: '1.0.0', provider: 'alt-data-vendor-a' });
}

// ---------------------------------------------------------------------------
// 1. THE REAL ADAPTERS (T038) feed the reference pipeline
// ---------------------------------------------------------------------------

describe('interop: REAL adapter sessions feed the fundamental pipeline', () => {
  it('the full declared cycle runs green over real equities + alt-data emissions', () => {
    const publisher = createFundamentalRecordingPort();
    const outcome = runFundamentalPipeline(INTEROP_CONFIG, {
      sources: [realIndexLevelSource(), realCorporateActionSource(), realEconomicSeriesSource()],
      publisher,
    });
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);

    // the assessments: the extended valuation (5 real levels, latest over the
    // trailing four) and the above-consensus macro surprise (2 real releases)
    expect(value.assessments.length).toBe(2);
    const byKind = new Map(value.assessments.map((a) => [a.assessmentKind, a]));
    expect(byKind.get('valuation-level')?.scope.instrument).toBe('TEST-LARGECAP');
    expect(byKind.get('valuation-level')?.stance.score).toBe('0.0242');
    expect(byKind.get('valuation-level')?.confidence.evidenceCount).toBe(5);
    expect(byKind.get('macro-surprise')?.scope.instrument).toBe('TEST-ECON-CPI');
    expect(byKind.get('macro-surprise')?.stance.score).toBe('0.0390');

    // the corporate-action digestion: one real split -> neutral (declared table)
    expect(value.actionDigests.length).toBe(1);
    expect(value.actionDigests[0]?.action).toBe('split');
    expect(value.actionDigests[0]?.implication).toBe('neutral');
    expect(value.actionDigests[0]?.observationCount).toBe(1);

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
    expect(validateFundamentalResearchReport(value.publication.report, FUNDAMENTAL_METHOD_REGISTRY)).toEqual([]);
    void FUNDAMENTAL_METHOD_REGISTRY;
  });
});

// ---------------------------------------------------------------------------
// 2. agent-os (T006) — the pipeline's actual publication envelope
// ---------------------------------------------------------------------------

describe('interop: the publication envelope is agent-os-honest', () => {
  it('the pipeline\'s ACTUAL envelope round-trips through the REAL factory', () => {
    const outcome = runFundamentalPipeline(INTEROP_CONFIG, {
      sources: [realIndexLevelSource(), realEconomicSeriesSource()],
      publisher: createFundamentalRecordingPort(),
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
  it('two independently constructed session sets produce byte-identical reports', () => {
    const once = runFundamentalPipeline(INTEROP_CONFIG, {
      sources: [realIndexLevelSource(), realEconomicSeriesSource()],
      publisher: createFundamentalRecordingPort(),
    });
    const twice = runFundamentalPipeline(INTEROP_CONFIG, {
      sources: [realIndexLevelSource(), realEconomicSeriesSource()],
      publisher: createFundamentalRecordingPort(),
    });
    expect(unwrap(once).reportId).toBe(unwrap(twice).reportId);
    expect(serializeFundamentalResearchReport(unwrap(once).publication.report)).toBe(
      serializeFundamentalResearchReport(unwrap(twice).publication.report),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. THE RESUME over two REAL adapters
// ---------------------------------------------------------------------------

describe('interop: the resumable protocol over REAL adapters', () => {
  it('index-level intake -> serialize -> parse -> resume over economic series -> ONE publication', () => {
    // pass 1: intake over the REAL equities index-level channel only
    const state = createFundamentalRunState(INTEROP_CONFIG);
    const afterIndexLevels = intakeFundamentalRunState(state, [realIndexLevelSource()]);
    expect(afterIndexLevels.ok).toBe(true);
    expect(unwrap(afterIndexLevels).coverage.observationsAdmitted).toBe(5);
    expect(unwrap(afterIndexLevels).publishedReportIds.length).toBe(0);

    // serialize -> parse (chain verified) -> resume over the REAL alt-data adapter
    const bytes = serializeFundamentalRunState(unwrap(afterIndexLevels));
    const resumed = resumeFundamentalRunState(bytes, {
      sources: [realEconomicSeriesSource()],
      publisher: createFundamentalRecordingPort(),
    });
    expect(resumed.ok).toBe(true);
    const done = unwrap(resumed);
    // the merged run saw both real streams
    expect(done.state.coverage.observationsAdmitted).toBe(7);
    expect(done.state.publishedReportIds.length).toBe(1);
    expect(done.outcome.assessments.length).toBe(2);

    // ...and it is the SAME byte-stable report as the one-pass run
    const onePass = runFundamentalPipeline(INTEROP_CONFIG, {
      sources: [realIndexLevelSource(), realEconomicSeriesSource()],
      publisher: createFundamentalRecordingPort(),
    });
    expect(done.outcome.reportId).toBe(unwrap(onePass).reportId);
    expect(serializeFundamentalResearchReport(done.outcome.publication.report)).toBe(
      serializeFundamentalResearchReport(unwrap(onePass).publication.report),
    );
  });
});
