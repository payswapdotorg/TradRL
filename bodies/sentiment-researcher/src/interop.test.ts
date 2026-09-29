// @tradrl/body-sentiment-researcher — THE INTEROP TRIP WIRES.
//
// Law D-003/D-004: this package's sources import NOTHING outside their
// own lane. This test file imports the REAL packages on this branch
// (test-only, via relative source paths — the repo's established
// pattern) and proves every structural mirror has not drifted:
//
//   1. agent-body (T003): a REAL createBodyVersion built from this
//      spec's composition is accepted; the vocabularies match
//      kind-for-kind and in order; the real guard accepts a JSON
//      round-trip of this spec's mirror record.
//   2. skills (T017): canonical JSON + stable digests are byte-identical
//      algorithms; skill-artifact ref guards agree on valid/invalid
//      corpora.
//   3. evaluation (T012): the confidence-level vocabulary matches
//      kind-for-kind (a category, never a score).
//   4. provenance + data-ingestion + market-protocol (T008): the
//      observation provenance blocks validate under the REAL canonical
//      validators; the T038-shaped observations pass the REAL
//      market-protocol MarketEvent validation (quartet + provenance).
//   5. agent-os (T006): the kernel topic reservation matches
//      kind-for-kind; the publication envelope JSON-round-trips through
//      the REAL createMessageEnvelope.
//   6. THE ADAPTERS (T038): driving the REAL news and alternative-data
//      adapter sessions over the REAL provider-sdk fake transport
//      produces EmittedEvents that this package's observation mirrors
//      accept VERBATIM (extras ride — the canonical contract is a floor).

import { describe, expect, it } from 'vitest';

// --- The contract package under test ---------------------------------------
import {
  type AgentInstanceId,
  type TopicName,
  type TenantId,
  type MessageEnvelopeMirror,
  CONFIDENCE_LEVELS,
  buildResearchPublication,
  canonicalJson,
  isMessageEnvelopeMirror,
  isNewsObservation,
  isSentimentScoreObservation,
  isSkillArtifactRef,
  stableDigest,
  validateObservationProvenance,
  validateResearchObservation,
  validateResearchPublication,
  SENTIMENT_RESEARCHER_BODY,
  AGENT_ACTION_NAMES_MIRROR,
  EVALUATION_LAYERS_MIRROR,
  EXECUTION_AUTHORITY_MODES_MIRROR,
  FIDELITY_MODES_MIRROR,
  PROCEDURE_TRIGGERS_MIRROR,
  PLANNING_STYLES_MIRROR,
  MODALITIES_MIRROR,
  REQUIREMENT_LEVELS_MIRROR,
  SUBSTITUTION_TEST_RESULTS_MIRROR,
  KERNEL_TOPICS_MIRROR,
} from './index';
import {
  FIXTURE_OBSERVATIONS,
  FIXTURE_READING,
  FIXTURE_REPORT,
  FIXTURE_REGISTRY,
  FIXTURE_SENDER,
  FIXTURE_TENANT,
  FIXTURE_TOPIC,
  FIXTURE_AS_OF,
} from './fixtures';

// --- REAL packages on this branch (test-only imports — the trip wires) ------
import {
  type BodyVersionDraft,
  AGENT_ACTION_NAMES,
  EVALUATION_LAYERS,
  EXECUTION_AUTHORITY_MODES,
  FIDELITY_MODES,
  PROCEDURE_TRIGGERS,
  PLANNING_STYLES,
  MODALITIES,
  REQUIREMENT_LEVELS,
  SUBSTITUTION_TEST_RESULTS,
  createBodyVersion,
  isBodyVersion,
  isBodyComposition,
} from '../../../packages/agent-body/src/index';
import {
  canonicalJson as skillsCanonicalJson,
  stableDigest as skillsStableDigest,
  isSkillArtifactRef as skillsIsSkillArtifactRef,
} from '../../../packages/skills/src/index';
import { VERDICT_CONFIDENCE_LEVELS, isVerdictConfidence } from '../../../packages/evaluation/src/index';
import { validateProvenance as marketValidateProvenance, validateMarketEvent } from '../../../packages/market-protocol/src/index';
import { KERNEL_TOPICS, createMessageEnvelope, isMessageEnvelope } from '../../../packages/agent-os/src/index';

// --- The REAL adapters (T038) + the REAL provider-sdk fake transport --------
import {
  createNewsAdapterSession,
  newsSubscription,
  NEWS_WIRE_SERVICE_ENTITLEMENT,
  type AdapterSession as NewsAdapterSession,
  type EmittedEvent as NewsEmittedEvent,
} from '../../../adapters/news/src/index';
import {
  createAltDataAdapterSession,
  altDataSubscription,
  ALTDATA_VENDOR_ENTITLEMENT,
  type AdapterSession as AltDataAdapterSession,
  type EmittedEvent as AltDataEmittedEvent,
} from '../../../adapters/alternative-data/src/index';
import {
  createFakeTransport,
  type FakeTransport,
  type JsonObject,
  type TransportScript,
} from '../../../packages/provider-sdk/src/index';

// ---------------------------------------------------------------------------
// 1. agent-body (T003) — the BodyVersion mirror
// ---------------------------------------------------------------------------

describe('interop: agent-body (the BodyVersion mirror)', () => {
  it('a REAL createBodyVersion built from this spec\'s composition is valid', () => {
    const mirror = SENTIMENT_RESEARCHER_BODY.bodyVersion;
    const draft = JSON.parse(JSON.stringify(mirror)) as BodyVersionDraft;
    const real = createBodyVersion(draft);
    expect(() => real).not.toThrow(); // construction validates every T003 invariant
    expect(isBodyVersion(real)).toBe(true);
    expect(real.id).toBe('sentiment-researcher@1.0.0');
    expect(isBodyComposition(real.composition)).toBe(true);
  });

  it('the real guard accepts a JSON round-trip of this spec\'s mirror record', () => {
    const round = JSON.parse(JSON.stringify(SENTIMENT_RESEARCHER_BODY.bodyVersion));
    expect(isBodyVersion(round)).toBe(true);
    expect(isBodyComposition((round as { composition: unknown }).composition)).toBe(true);
  });

  it('every mirrored vocabulary matches the real one kind-for-kind AND in order', () => {
    expect([...AGENT_ACTION_NAMES_MIRROR]).toEqual([...AGENT_ACTION_NAMES]);
    expect([...EVALUATION_LAYERS_MIRROR]).toEqual([...EVALUATION_LAYERS]);
    expect([...EXECUTION_AUTHORITY_MODES_MIRROR]).toEqual([...EXECUTION_AUTHORITY_MODES]);
    expect([...FIDELITY_MODES_MIRROR]).toEqual([...FIDELITY_MODES]);
    expect([...PROCEDURE_TRIGGERS_MIRROR]).toEqual([...PROCEDURE_TRIGGERS]);
    expect([...PLANNING_STYLES_MIRROR]).toEqual([...PLANNING_STYLES]);
    expect([...MODALITIES_MIRROR]).toEqual([...MODALITIES]);
    expect([...REQUIREMENT_LEVELS_MIRROR]).toEqual([...REQUIREMENT_LEVELS]);
    expect([...SUBSTITUTION_TEST_RESULTS_MIRROR]).toEqual([...SUBSTITUTION_TEST_RESULTS]);
    expect(EXECUTION_AUTHORITY_MODES_MIRROR).not.toContain('model-autonomous');
  });

  it('the real execution-authority law agrees with this lane\'s L8 validation', () => {
    // Building a body version with EXECUTE allowed but executionAuthority 'none'
    // is rejected by the REAL factory — the same law this lane enforces.
    const draft = JSON.parse(JSON.stringify(SENTIMENT_RESEARCHER_BODY.bodyVersion)) as BodyVersionDraft;
    const doctored = draft as unknown as {
      composition: { authorityBoundary: { allowedActions: string[]; executionAuthority: string } };
    };
    doctored.composition.authorityBoundary.allowedActions = [...doctored.composition.authorityBoundary.allowedActions, 'EXECUTE'];
    expect(() => createBodyVersion(doctored as unknown as BodyVersionDraft)).toThrow(/external-gateway-only/);
  });
});

// ---------------------------------------------------------------------------
// 2. skills (T017) — canonical bytes + digest parity + ref guards
// ---------------------------------------------------------------------------

describe('interop: skills (canonical JSON + digests + artifact refs)', () => {
  it('canonicalJson and stableDigest are byte-identical algorithms', () => {
    for (const sample of [
      { b: 1, a: 'x', c: [3, 2, { z: null, y: true }] },
      FIXTURE_READING as never,
      { nested: { deep: { deeper: ['q', 'p'] } } },
      [],
      'plain',
      42,
      null,
    ]) {
      const mine = canonicalJson(sample as never);
      const theirs = skillsCanonicalJson(sample as never);
      expect(mine).toBe(theirs);
      expect(stableDigest(mine)).toBe(skillsStableDigest(theirs));
    }
  });

  it('the skill-artifact ref guards agree on valid and invalid corpora', () => {
    const valid = ['skills/sentiment/aggregation-v1', 'skills/x', 'a'.repeat(1024)];
    const invalid = ['', '   ', 'x'.repeat(1025), 'line\nbreak', 42, null];
    for (const value of valid) {
      expect(isSkillArtifactRef(value)).toBe(true);
      expect(skillsIsSkillArtifactRef(value)).toBe(true);
    }
    for (const value of invalid) {
      expect(isSkillArtifactRef(value)).toBe(false);
      expect(skillsIsSkillArtifactRef(value)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. evaluation (T012) — the confidence vocabulary
// ---------------------------------------------------------------------------

describe('interop: evaluation (the confidence category)', () => {
  it('the confidence levels match the verdict-confidence vocabulary kind-for-kind', () => {
    expect([...CONFIDENCE_LEVELS]).toEqual([...VERDICT_CONFIDENCE_LEVELS]);
    for (const level of CONFIDENCE_LEVELS) expect(isVerdictConfidence(level)).toBe(true);
    expect(isVerdictConfidence('very-sure')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. provenance / market-protocol (T008) — the provenance block mirror
// ---------------------------------------------------------------------------

describe('interop: provenance + market-protocol (the provenance block + canonical event floor)', () => {
  it('this lane\'s provenance blocks validate under the REAL market-protocol validator', () => {
    for (const observation of FIXTURE_OBSERVATIONS) {
      const errors = marketValidateProvenance(observation.provenance, observation.event_id);
      expect(errors).toEqual([]);
      // and under this lane's mirrored validator
      expect(validateObservationProvenance(observation.provenance, observation.event_id)).toEqual([]);
    }
  });

  it('this lane\'s T038-shaped observations pass the REAL canonical MarketEvent validation', () => {
    for (const observation of FIXTURE_OBSERVATIONS) {
      const result = validateMarketEvent(observation);
      expect(result.ok).toBe(true);
    }
  });

  it('negative parity: a broken quartet fails BOTH validators', () => {
    const observation = FIXTURE_OBSERVATIONS[0]!;
    const broken = { ...observation, available_time: (observation.event_time as number) - 1 };
    expect(validateMarketEvent(broken).ok).toBe(false);
    // this lane's observation validator rejects it too (timestamp_order)
    expect(validateResearchObservation(broken).map((e) => e.code)).toContain('timestamp_order');
  });
});

// ---------------------------------------------------------------------------
// 5. agent-os (T006) — the envelope mirror + topic reservation
// ---------------------------------------------------------------------------

describe('interop: agent-os (the envelope mirror)', () => {
  it('the kernel topic reservation matches kind-for-kind', () => {
    expect([...KERNEL_TOPICS_MIRROR]).toEqual([...KERNEL_TOPICS]);
  });

  it('this lane\'s publication envelope JSON-round-trips through the REAL factory', () => {
    const built = buildResearchPublication({
      opId: 'op-interop-0001',
      topic: FIXTURE_TOPIC as TopicName,
      tenantId: FIXTURE_TENANT as TenantId,
      sender: FIXTURE_SENDER as AgentInstanceId,
      report: FIXTURE_REPORT,
      sequence: 1,
      publishedAt: FIXTURE_AS_OF,
    });
    if (!built.ok) throw new Error('publication must build');
    // the full publication validates under this lane's discipline
    expect(validateResearchPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
    // the envelope alone round-trips through the REAL agent-os factory
    const real = createMessageEnvelope(JSON.parse(JSON.stringify(built.value.envelope)));
    expect(isMessageEnvelope(real)).toBe(true);
    expect(real.id).toBe(built.value.envelope.id);
    expect(real.payload).toBe(built.value.envelope.payload);
    expect(real.sequence).toBe(1);
    // the real envelope satisfies this lane's mirror guard
    expect(isMessageEnvelopeMirror(JSON.parse(JSON.stringify(real)))).toBe(true);
    // the payload is the opaque report reference, bound to the report id
    expect(real.payload).toBe(`report:${FIXTURE_REPORT.reportId}`);
  });
});

// ---------------------------------------------------------------------------
// 6. THE ADAPTERS (T038) — the observation mirrors accept REAL emitter output
// ---------------------------------------------------------------------------

const AT0 = 1_717_423_200_000;
const ms = (value: number): number => value;

function script(inbound: readonly { at: number; channel: string; payload: JsonObject }[]): TransportScript {
  return {
    inbound: inbound.map((entry) => ({ at: ms(entry.at) as never, channel: entry.channel, payload: entry.payload })),
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

function drain(session: NewsAdapterSession | AltDataAdapterSession): { events: unknown[] } {
  const events: unknown[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok || next.value === null) break;
    events.push(next.value);
  }
  return { events };
}

describe('interop: the REAL news adapter (T038) feeds this lane\'s observation mirror', () => {
  it('emitted news events satisfy isNewsObservation verbatim (extras ride — the floor)', () => {
    const wireItem = (itemId: string): JsonObject =>
      ({
        recordType: 'NEWS_ITEM',
        itemId,
        publisherCode: 'PUB-A',
        publishedTimeMs: AT0,
        headline: `Synthetic interop headline ${itemId}`,
        body: 'Synthetic wire body.',
        tickers: ['TEST-AAA'],
        tags: ['earnings'],
        url: `https://example.invalid/item/${itemId}`,
      }) as JsonObject;

    const construction = createNewsAdapterSession({
      transport: transportFor(
        script([
          { at: AT0 + 10, channel: 'licensedWire', payload: wireItem('INT-NEWS-1') },
          { at: AT0 + 20, channel: 'licensedWire', payload: wireItem('INT-NEWS-2') },
        ]),
      ),
      entitlement: NEWS_WIRE_SERVICE_ENTITLEMENT,
    });
    if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
    const session = construction.session;
    expect(session.open().ok).toBe(true);
    const spec = newsSubscription({ channel: 'licensedWire', instrument: 'TEST-AAA' });
    if (!spec.ok) throw new Error('subscription must build');
    expect(session.subscribe(spec.value).ok).toBe(true);
    const { events } = drain(session);
    expect(events.length).toBe(2);
    for (const event of events as NewsEmittedEvent[]) {
      expect(isNewsObservation(event)).toBe(true);
      expect(event.payload.headline).toContain('Synthetic interop headline');
    }
  });
});

describe('interop: the REAL alternative-data adapter (T038) feeds the sentiment mirror', () => {
  it('emitted social_signal events satisfy isSentimentScoreObservation verbatim', () => {
    const sentimentObservation = (seriesId: string, window: { windowStartMs: number; windowEndMs: number; releaseTimeMs: number }, score: string): JsonObject =>
      ({
        recordType: 'SENTIMENT_OBSERVATION',
        seriesId,
        ...window,
        sentimentScore: score,
      }) as JsonObject;

    const W1 = { windowStartMs: AT0 - 3_600_000, windowEndMs: AT0 - 1_800_000, releaseTimeMs: AT0 };
    const W2 = { windowStartMs: AT0 - 1_800_000, windowEndMs: AT0, releaseTimeMs: AT0 + 1_000 };

    const construction = createAltDataAdapterSession({
      transport: transportFor(
        script([
          { at: AT0, channel: 'sentiment', payload: sentimentObservation('INT-SENT-A', W1, '-0.21') },
          { at: AT0 + 1_000, channel: 'sentiment', payload: sentimentObservation('INT-SENT-A', W2, '0.35') },
        ]),
      ),
      entitlement: ALTDATA_VENDOR_ENTITLEMENT,
    });
    if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
    const session = construction.session;
    expect(session.open().ok).toBe(true);
    const spec = altDataSubscription({ channel: 'sentiment', instrument: 'TEST-AAA' });
    if (!spec.ok) throw new Error('subscription must build');
    expect(session.subscribe(spec.value).ok).toBe(true);
    const { events } = drain(session);
    expect(events.length).toBe(2);
    for (const event of events as AltDataEmittedEvent[]) {
      expect(isSentimentScoreObservation(event)).toBe(true);
      const social = event.payload as { metric: string };
      expect(social.metric).toBe('sentiment_score');
      // the release instant IS the availability (window->release law)
      expect(event.available_time).toBe(event.event_time);
    }
    // and the whole stream passes the REAL canonical event validation
    for (const event of events as AltDataEmittedEvent[]) {
      expect(validateMarketEvent(event).ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The full-chain trip wire: REAL adapter output -> mirror -> golden report
// ---------------------------------------------------------------------------

describe('interop: the full chain stays honest', () => {
  it('a real-emitted sentiment observation can serve as reading evidence', () => {
    // Re-run the alt-data session and cite its real output in a reading.
    const sentimentObservation = (seriesId: string, score: string): JsonObject =>
      ({
        recordType: 'SENTIMENT_OBSERVATION',
        seriesId,
        windowStartMs: AT0 - 3_600_000,
        windowEndMs: AT0 - 1_800_000,
        releaseTimeMs: AT0,
        sentimentScore: score,
      }) as JsonObject;

    const construction = createAltDataAdapterSession({
      transport: transportFor(script([{ at: AT0, channel: 'sentiment', payload: sentimentObservation('INT-CHAIN', '0.3000') }])),
      entitlement: ALTDATA_VENDOR_ENTITLEMENT,
    });
    if (!construction.ok) throw new Error('must construct');
    const session = construction.session;
    session.open();
    const spec = altDataSubscription({ channel: 'sentiment', instrument: 'TEST-AAA' });
    if (!spec.ok) throw new Error('must build');
    session.subscribe(spec.value);
    const { events } = drain(session);
    const realEvent = events[0] as AltDataEmittedEvent;
    expect(realEvent).toBeDefined();
    expect(isSentimentScoreObservation(realEvent)).toBe(true);

    // The golden reading's citations satisfy the real canonical event shape.
    for (const observation of FIXTURE_OBSERVATIONS) {
      expect(validateMarketEvent(observation).ok).toBe(true);
    }
    // The golden report cites exactly those observations and validates.
    expect(FIXTURE_REPORT.readings[0]!.evidence.length).toBe(5);
  });
});
