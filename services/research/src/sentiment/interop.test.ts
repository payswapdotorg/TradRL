// @tradrl/research (service) — THE SERVICE-LANE INTEROP TRIP WIRES.
//
// The service's sources import NOTHING outside their own lane (the single
// import surface, src/sentiment/imports.ts, reaches only the lane's own
// contract package via a relative source path). This test file imports
// the REAL packages on this branch (test-only, via relative source paths
// — the repo's established pattern) and proves the SERVICE-level mirrors
// have not drifted:
//
//   1. THE ADAPTERS (T038): the reference pipeline runs GREEN over REAL
//      news + alternative-data adapter sessions (driven through the REAL
//      provider-sdk fake transport) wrapped as ObservationSources — the
//      scripted fake used throughout the tests mirrors the REAL emitter
//      shape, and here the REAL thing flows through the very same port,
//      the L4 gate, the declared methods and the publication discipline.
//   2. agent-os (T006): the pipeline's ACTUAL publication envelope (not a
//      fixture) JSON-round-trips through the REAL createMessageEnvelope.
//   3. DETERMINISM: the same REAL-adapter stream produces byte-identical
//      reports across independently constructed sessions.
//   4. THE RESUME: the resumable run-state protocol runs over TWO REAL
//      adapters (news intake -> serialize -> parse -> resume over
//      sentiment -> publish once) and lands on the SAME byte-stable
//      report as the one-pass run.

import { describe, expect, it } from 'vitest';

// --- The service under test -------------------------------------------------
import {
  type ObservationSource,
  type ResearchObservation,
  type ResearchRunConfig,
  type TimestampMs,
  SENTIMENT_METHOD_REGISTRY,
  createRecordingPublicationPort,
  createSentimentRunState,
  deepFreeze,
  intakeSentimentRunState,
  resumeSentimentRunState,
  runResearchPipeline,
  serializeResearchReport,
  serializeSentimentRunState,
  validateResearchReport,
} from './index';
import { FIXTURE_RUN_CONFIG } from './fixtures';

// --- REAL packages on this branch (test-only imports — the trip wires) ------
import {
  createNewsAdapterSession,
  newsSubscription,
  NEWS_WIRE_SERVICE_ENTITLEMENT,
  type AdapterSession as NewsAdapterSession,
} from '../../../../adapters/news/src/index';
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

const AT0 = 1_717_423_200_000;
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
const INTEROP_CONFIG: ResearchRunConfig = deepFreeze({
  ...FIXTURE_RUN_CONFIG,
  asOf: ms(AT0 + 3_600_000),
  publishedAt: ms(AT0 + 3_600_000),
  opId: 'op-research-interop-0001',
});

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
  session: NewsAdapterSession | AltDataAdapterSession,
  descriptor: { readonly id: string; readonly version: string; readonly provider: string },
): ObservationSource {
  return {
    descriptor,
    next(): ResearchObservation | null {
      const pulled = session.nextEvent();
      if (!pulled.ok || pulled.value === null) return null;
      return pulled.value as unknown as ResearchObservation;
    },
  };
}

/** A REAL news adapter session: four earnings wire items on TEST-AAA. */
function realNewsSource(): ObservationSource {
  const wireItem = (itemId: string): JsonObject =>
    ({
      recordType: 'NEWS_ITEM',
      itemId,
      publisherCode: 'PUB-A',
      publishedTimeMs: AT0,
      headline: `Interop wire headline ${itemId}`,
      body: 'Synthetic interop wire body.',
      tickers: ['TEST-AAA'],
      tags: ['earnings'],
      url: `https://example.invalid/item/${itemId}`,
    }) as JsonObject;

  const construction = createNewsAdapterSession({
    transport: transportFor(
      script([
        { at: AT0 + 10, channel: 'licensedWire', payload: wireItem('INT-NEWS-1') },
        { at: AT0 + 20, channel: 'licensedWire', payload: wireItem('INT-NEWS-2') },
        { at: AT0 + 30, channel: 'licensedWire', payload: wireItem('INT-NEWS-3') },
        { at: AT0 + 40, channel: 'licensedWire', payload: wireItem('INT-NEWS-4') },
      ]),
    ),
    entitlement: NEWS_WIRE_SERVICE_ENTITLEMENT,
  });
  if (!construction.ok) throw new Error(`news session must construct: ${JSON.stringify(construction.errors)}`);
  const session = construction.session;
  if (!session.open().ok) throw new Error('news session must open');
  const spec = newsSubscription({ channel: 'licensedWire', instrument: 'TEST-AAA' });
  if (!spec.ok) throw new Error('news subscription must build');
  if (!session.subscribe(spec.value).ok) throw new Error('news subscribe must succeed');
  return adapterSource(session, { id: 'news-adapter', version: '1.0.0', provider: 'tradrl-news' });
}

/** A REAL alternative-data session: five sentiment scores on TEST-AAA. */
function realSentimentSource(): ObservationSource {
  const sentimentItem = (index: number, score: string): JsonObject =>
    ({
      recordType: 'SENTIMENT_OBSERVATION',
      seriesId: `INT-SENT-${index}`,
      windowStartMs: AT0 - 3_600_000 + index * 60_000,
      windowEndMs: AT0 - 1_800_000 + index * 60_000,
      releaseTimeMs: AT0 + index * 1_000,
      sentimentScore: score,
    }) as JsonObject;

  const scores = ['0.5', '0.4', '0.6', '0.3', '0.7'];
  const construction = createAltDataAdapterSession({
    transport: transportFor(
      script(
        scores.map((score, index) => ({
          at: AT0 + index * 1_000,
          channel: 'sentiment',
          payload: sentimentItem(index + 1, score),
        })),
      ),
    ),
    entitlement: ALTDATA_VENDOR_ENTITLEMENT,
  });
  if (!construction.ok) throw new Error(`alt-data session must construct: ${JSON.stringify(construction.errors)}`);
  const session = construction.session;
  if (!session.open().ok) throw new Error('alt-data session must open');
  const spec = altDataSubscription({ channel: 'sentiment', instrument: 'TEST-AAA' });
  if (!spec.ok) throw new Error('alt-data subscription must build');
  if (!session.subscribe(spec.value).ok) throw new Error('alt-data subscribe must succeed');
  return adapterSource(session, { id: 'altdata-adapter', version: '1.0.0', provider: 'tradrl-altdata' });
}

// ---------------------------------------------------------------------------
// 1. THE REAL ADAPTERS (T038) feed the reference pipeline
// ---------------------------------------------------------------------------

describe('interop: REAL adapter sessions feed the pipeline', () => {
  it('the full declared cycle runs green over real news + alt-data emissions', () => {
    const publisher = createRecordingPublicationPort();
    const outcome = runResearchPipeline(INTEROP_CONFIG, {
      sources: [realNewsSource(), realSentimentSource()],
      publisher,
    });
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);

    // the aggregation: five real sentiment scores, one reading, no magic
    expect(value.readings.length).toBe(1);
    const reading = value.readings[0]!;
    expect(reading.scope.instrument).toBe('TEST-AAA');
    expect(reading.polarity.score).toBe('0.5000');
    expect(reading.confidence.evidenceCount).toBe(5);

    // the event detection: four earnings wire items, one cluster, one digest
    expect(value.digests.length).toBe(1);
    const digest = value.digests[0]!;
    expect(digest.kind).toBe('earnings-announcement');
    expect(digest.observationCount).toBe(4);
    expect(digest.instruments).toEqual(['TEST-AAA']);

    // no gaps and full coverage: 9 offered, 9 admitted, nothing dropped
    expect(value.dataGaps).toEqual([]);
    expect(value.coverage).toEqual({
      observationsOffered: 9,
      observationsAdmitted: 9,
      observationsDeferred: 0,
      observationsUnsupported: 0,
      observationsInvalid: 0,
    });

    // the publication discipline: exactly one bound envelope through the port
    expect(publisher.published.length).toBe(1);
    expect(publisher.published[0]!.envelope.payload).toBe(`report:${value.reportId}`);

    // the report validates under the shipped body's declared method registry
    expect(validateResearchReport(value.publication.report, SENTIMENT_METHOD_REGISTRY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. agent-os (T006) — the pipeline's actual publication envelope
// ---------------------------------------------------------------------------

describe('interop: the publication envelope is agent-os-honest', () => {
  it('the pipeline\'s ACTUAL envelope round-trips through the REAL factory', () => {
    const outcome = runResearchPipeline(INTEROP_CONFIG, {
      sources: [realNewsSource(), realSentimentSource()],
      publisher: createRecordingPublicationPort(),
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
  it('two independently constructed session pairs produce byte-identical reports', () => {
    const once = runResearchPipeline(INTEROP_CONFIG, {
      sources: [realNewsSource(), realSentimentSource()],
      publisher: createRecordingPublicationPort(),
    });
    const twice = runResearchPipeline(INTEROP_CONFIG, {
      sources: [realNewsSource(), realSentimentSource()],
      publisher: createRecordingPublicationPort(),
    });
    expect(unwrap(once).reportId).toBe(unwrap(twice).reportId);
    expect(serializeResearchReport(unwrap(once).publication.report)).toBe(
      serializeResearchReport(unwrap(twice).publication.report),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. THE RESUME over two REAL adapters
// ---------------------------------------------------------------------------

describe('interop: the resumable protocol over REAL adapters', () => {
  it('news intake -> serialize -> parse -> resume over sentiment -> ONE publication', () => {
    // pass 1: intake over the REAL news adapter only
    const state = createSentimentRunState(INTEROP_CONFIG);
    const afterNews = intakeSentimentRunState(state, [realNewsSource()]);
    expect(afterNews.ok).toBe(true);
    expect(unwrap(afterNews).coverage.observationsAdmitted).toBe(4);
    expect(unwrap(afterNews).publishedReportIds.length).toBe(0);

    // serialize -> parse (chain verified) -> resume over the REAL alt-data adapter
    const bytes = serializeSentimentRunState(unwrap(afterNews));
    const resumed = resumeSentimentRunState(bytes, {
      sources: [realSentimentSource()],
      publisher: createRecordingPublicationPort(),
    });
    expect(resumed.ok).toBe(true);
    const done = unwrap(resumed);
    // the merged run saw the whole real stream
    expect(done.state.coverage.observationsAdmitted).toBe(9);
    expect(done.state.publishedReportIds.length).toBe(1);
    expect(done.outcome.readings.length).toBe(1);
    expect(done.outcome.digests.length).toBe(1);

    // ...and it is the SAME byte-stable report as the one-pass run
    const onePass = runResearchPipeline(INTEROP_CONFIG, {
      sources: [realNewsSource(), realSentimentSource()],
      publisher: createRecordingPublicationPort(),
    });
    expect(done.outcome.reportId).toBe(unwrap(onePass).reportId);
    expect(serializeResearchReport(done.outcome.publication.report)).toBe(
      serializeResearchReport(unwrap(onePass).publication.report),
    );
  });
});
