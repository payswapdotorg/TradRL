// @tradrl/body-cross-market-researcher — THE INTEROP TRIP WIRES.
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
//   4. provenance + market-protocol (T008): the observation provenance
//      blocks validate under the REAL canonical validators; the
//      T037/T038-shaped observations pass the REAL market-protocol
//      MarketEvent validation (quote, trade and fundamental records —
//      quartet + provenance).
//   5. agent-os (T006): the kernel topic reservation matches
//      kind-for-kind; the publication envelope JSON-round-trips through
//      the REAL createMessageEnvelope.
//   6. THE ADAPTERS (T037/T038): driving the REAL Coinbase adapter
//      (matches -> trades) and the REAL equities adapter (indexLevel ->
//      reported fundamentals) over the REAL provider-sdk fake transport
//      produces EmittedEvents that this package's observation mirrors
//      accept VERBATIM (extras ride — the canonical contract is a
//      floor), and real-emitted observations can serve as relationship
//      evidence.

import { describe, expect, it } from 'vitest';

// --- The contract package under test ---------------------------------------
import {
  type AgentInstanceId,
  type TopicName,
  type TenantId,
  type MessageEnvelopeMirror,
  CONFIDENCE_LEVELS,
  buildCrossMarketPublication,
  canonicalJson,
  createCrossMarketRelationship,
  isMessageEnvelopeMirror,
  isCrossMarketRelationship,
  isQuoteObservation,
  isTradeObservation,
  isFundamentalDatumObservation,
  isSkillArtifactRef,
  stableDigest,
  validateObservationProvenance,
  validateCrossMarketObservation,
  validateCrossMarketPublication,
  CROSS_MARKET_RESEARCHER_BODY,
  CROSS_MARKET_METHOD_REGISTRY,
  CROSS_MARKET_CO_MOVEMENT_METHOD,
  CROSS_MARKET_CONFIDENCE_METHOD,
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
  FIXTURE_REPORT,
  FIXTURE_REGISTRY,
  FIXTURE_SENDER,
  FIXTURE_TENANT,
  FIXTURE_TOPIC,
  FIXTURE_AS_OF,
  FIXTURE_LEGS,
  pairCitations,
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

// --- The REAL adapters (T037/T038) + the REAL provider-sdk fake transport --
import {
  createCoinbaseAdapterSession,
  coinbaseSubscription,
  COINBASE_ENTITLEMENT,
  type AdapterSession as CoinbaseSession,
  type EmittedEvent as CoinbaseEvent,
} from '../../../adapters/coinbase/src/index';
import {
  createEquitiesAdapterSession,
  equitiesSubscription,
  EQUITIES_ENTITLEMENT,
  type AdapterSession as EquitiesSession,
  type EmittedEvent as EquitiesEvent,
} from '../../../adapters/equities/src/index';
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
    const mirror = CROSS_MARKET_RESEARCHER_BODY.bodyVersion;
    const draft = JSON.parse(JSON.stringify(mirror)) as BodyVersionDraft;
    const real = createBodyVersion(draft);
    expect(() => real).not.toThrow(); // construction validates every T003 invariant
    expect(isBodyVersion(real)).toBe(true);
    expect(real.id).toBe('cross-market-researcher@1.0.0');
    expect(isBodyComposition(real.composition)).toBe(true);
  });

  it('the real guard accepts a JSON round-trip of this spec\'s mirror record', () => {
    const round = JSON.parse(JSON.stringify(CROSS_MARKET_RESEARCHER_BODY.bodyVersion));
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
    const draft = JSON.parse(JSON.stringify(CROSS_MARKET_RESEARCHER_BODY.bodyVersion)) as BodyVersionDraft;
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
      FIXTURE_REPORT as never,
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
    const valid = ['skills/crossmarket/relationship-analysis-v1', 'skills/x', 'a'.repeat(1024)];
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

  it('this lane\'s T037/T038-shaped observations pass the REAL canonical MarketEvent validation', () => {
    const kinds = new Set<string>();
    for (const observation of FIXTURE_OBSERVATIONS) {
      kinds.add(observation.event_type);
      const result = validateMarketEvent(observation);
      expect(result.ok).toBe(true);
    }
    expect(kinds).toEqual(new Set(['trade', 'fundamental']));
  });

  it('negative parity: a broken quartet fails BOTH validators', () => {
    const observation = FIXTURE_OBSERVATIONS[0]!;
    const broken = { ...observation, available_time: (observation.event_time as number) - 1 };
    expect(validateMarketEvent(broken).ok).toBe(false);
    // this lane's observation validator rejects it too (timestamp_order)
    expect(validateCrossMarketObservation(broken).map((e) => e.code)).toContain('timestamp_order');
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
    const built = buildCrossMarketPublication({
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
    expect(validateCrossMarketPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
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
    void (built.value as { envelope: MessageEnvelopeMirror });
  });
});

// ---------------------------------------------------------------------------
// 6. THE ADAPTERS (T037/T038) — the observation mirrors accept REAL emitter
//    output
// ---------------------------------------------------------------------------

const AT0 = 1_717_423_200_000; // 2024-06-03T14:00:00Z — Monday, inside the declared US regular session.

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

function drain(session: CoinbaseSession | EquitiesSession): { events: (CoinbaseEvent | EquitiesEvent)[] } {
  const events: (CoinbaseEvent | EquitiesEvent)[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok || next.value === null) break;
    events.push(next.value);
  }
  return { events };
}

const coinbaseMatch = (sequence: number, tradeId: number, price: string, isoTime: string) =>
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

const indexLevel = (sequence: number, dissemination: number, level: string): JsonObject =>
  ({
    recordType: 'INDEX_LEVEL',
    indexId: 'TEST-LARGECAP',
    tradeDate: '2024-06-03',
    disseminationTimeMs: dissemination,
    indexLevel: level,
    indexDivisor: '1234.5678',
    sequenceNumber: sequence,
  }) as JsonObject;

describe('interop: the REAL Coinbase adapter (T037) feeds the trade mirror', () => {
  it('emitted match events satisfy isTradeObservation verbatim (extras ride)', () => {
    const construction = createCoinbaseAdapterSession({
      transport: transportFor(
        script([
          { at: AT0, channel: 'match', payload: coinbaseMatch(1, 1, '50000.00', '2024-06-03T14:00:00.123456Z') },
          { at: AT0 + 10, channel: 'match', payload: coinbaseMatch(2, 2, '50100.00', '2024-06-03T14:00:01.123456Z') },
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
    const { events } = drain(session);
    expect(events.length).toBe(2);
    for (const event of events) {
      expect(event.event_type).toBe('trade');
      expect(isTradeObservation(event)).toBe(true);
      expect(event.venue).toBe('COINBASE');
      expect(event.asset_class).toBe('crypto');
    }
    // and the whole stream passes the REAL canonical event validation
    for (const event of events) {
      expect(validateMarketEvent(event).ok).toBe(true);
    }
  });

  it('emitted ticker events satisfy isQuoteObservation verbatim', () => {
    const ticker = (sequence: number): JsonObject =>
      ({
        type: 'ticker',
        trade_id: 7,
        sequence,
        time: '2024-06-03T14:00:00.123456Z',
        product_id: 'BTC-USD',
        price: '50000.00',
        last_size: '0.017',
        best_bid: '49999.00',
        best_bid_size: '0.50000000',
        best_ask: '50001.00',
        best_ask_size: '0.73000000',
        open_24h: '-26.59000000',
        volume_24h: '12345.67000000',
        low_24h: '42500.00000000',
        high_24h: '50200.00000000',
        volume_30d: '450000.00000000',
      }) as JsonObject;
    const construction = createCoinbaseAdapterSession({
      transport: transportFor(script([{ at: AT0, channel: 'ticker', payload: ticker(1) }])),
      entitlement: COINBASE_ENTITLEMENT,
    });
    if (!construction.ok) throw new Error(`coinbase session must construct: ${JSON.stringify(construction.errors)}`);
    const session = construction.session;
    if (!session.open().ok) throw new Error('coinbase session must open');
    const spec = coinbaseSubscription({ channel: 'ticker', instrument: 'BTC-USD' });
    if (!spec.ok) throw new Error('subscription must build');
    if (!session.subscribe(spec.value).ok) throw new Error('subscribe must succeed');
    const { events } = drain(session);
    expect(events.length).toBe(1);
    for (const event of events) {
      expect(event.event_type).toBe('quote');
      expect(isQuoteObservation(event)).toBe(true);
    }
    for (const event of events) {
      expect(validateMarketEvent(event).ok).toBe(true);
    }
  });
});

describe('interop: the REAL equities adapter (T038) feeds the fundamental mirror', () => {
  it('emitted index-level events satisfy isFundamentalDatumObservation verbatim', () => {
    const construction = createEquitiesAdapterSession({
      transport: transportFor(
        script([
          { at: AT0, channel: 'indexLevel', payload: indexLevel(1, AT0, '100.0000') },
          { at: AT0 + 10, channel: 'indexLevel', payload: indexLevel(2, AT0 + 10, '101.0000') },
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
    const { events } = drain(session);
    expect(events.length).toBe(2);
    for (const event of events) {
      expect(event.event_type).toBe('fundamental');
      expect(isFundamentalDatumObservation(event)).toBe(true);
    }
    for (const event of events) {
      expect(validateMarketEvent(event).ok).toBe(true);
    }
  });
});

describe('interop: the full chain stays honest', () => {
  it('real-emitted observations from TWO venues can serve as relationship evidence', () => {
    // leg 1: the REAL equities session's index levels (rising)
    const equitiesConstruction = createEquitiesAdapterSession({
      transport: transportFor(script([{ at: AT0, channel: 'indexLevel', payload: indexLevel(1, AT0, '104.5000') }])),
      entitlement: EQUITIES_ENTITLEMENT,
    });
    if (!equitiesConstruction.ok) throw new Error('equities must construct');
    const equitiesSession = equitiesConstruction.session;
    equitiesSession.open();
    const equitiesSpec = equitiesSubscription({ channel: 'indexLevel', instrument: 'TEST-LARGECAP' });
    if (!equitiesSpec.ok) throw new Error('must build');
    equitiesSession.subscribe(equitiesSpec.value);

    // leg 2: the REAL coinbase session's trades (rising)
    const coinbaseConstruction = createCoinbaseAdapterSession({
      transport: transportFor(script([{ at: AT0, channel: 'match', payload: coinbaseMatch(1, 1, '50000.00', '2024-06-03T14:00:00.123456Z') }])),
      entitlement: COINBASE_ENTITLEMENT,
    });
    if (!coinbaseConstruction.ok) throw new Error('coinbase must construct');
    const coinbaseSession = coinbaseConstruction.session;
    coinbaseSession.open();
    const coinbaseSpec = coinbaseSubscription({ channel: 'match', instrument: 'BTC-USD' });
    if (!coinbaseSpec.ok) throw new Error('must build');
    coinbaseSession.subscribe(coinbaseSpec.value);

    const indexEvent = drain(equitiesSession).events[0] as EquitiesEvent;
    const tradeEvent = drain(coinbaseSession).events[0] as CoinbaseEvent;
    expect(indexEvent).toBeDefined();
    expect(tradeEvent).toBeDefined();
    expect(isFundamentalDatumObservation(indexEvent)).toBe(true);
    expect(isTradeObservation(tradeEvent)).toBe(true);

    // cite the REAL emitted events (JSON-round-tripped) as both-leg evidence
    const citations = pairCitations(
      { venue: 'LICENSED-INDEX-A', instrument: 'TEST-LARGECAP', assetClass: 'index', series: 'INDEX_LEVEL' },
      [JSON.parse(JSON.stringify(indexEvent))],
      { venue: 'COINBASE', instrument: 'BTC-USD', assetClass: 'crypto', series: 'trade' },
      [JSON.parse(JSON.stringify(tradeEvent))],
    );
    const relationship = createCrossMarketRelationship(
      {
        pair: {
          left: { venue: 'LICENSED-INDEX-A', instrument: 'TEST-LARGECAP', assetClass: 'index', series: 'INDEX_LEVEL' },
          right: { venue: 'COINBASE', instrument: 'BTC-USD', assetClass: 'crypto', series: 'trade' },
        },
        relationKind: 'co-movement',
        measure: {
          methodId: CROSS_MARKET_CO_MOVEMENT_METHOD.methodId,
          methodVersion: CROSS_MARKET_CO_MOVEMENT_METHOD.version,
          direction: 'neutral',
          score: '0.0000',
        },
        window: { from: indexEvent.available_time, to: tradeEvent.available_time },
        confidence: {
          methodId: CROSS_MARKET_CONFIDENCE_METHOD.methodId,
          methodVersion: CROSS_MARKET_CONFIDENCE_METHOD.version,
          level: 'low',
          evidenceCount: 2,
          legImbalance: 0,
        },
        evidence: citations,
        asOf: (AT0 + 60_000) as never,
        bodyVersion: 'cross-market-researcher@1.0.0' as never,
        tenantId: FIXTURE_TENANT,
        projectId: 'project-interop' as never,
        seed: 'seed/interop/crossmarket-1',
      },
      CROSS_MARKET_METHOD_REGISTRY,
    );
    expect(relationship.ok).toBe(true);
    if (relationship.ok) {
      expect(isCrossMarketRelationship(relationship.value)).toBe(true);
      void FIXTURE_LEGS;
    }
  });
});
