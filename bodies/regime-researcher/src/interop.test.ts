// @tradrl/body-regime-researcher — THE INTEROP TRIP WIRES.
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
//   4. provenance + market-protocol (T008/T004): the observation
//      provenance blocks validate under the REAL canonical validators;
//      the market-shaped observations (quotes/trades/book snapshots
//      with quartets) pass the REAL market-protocol MarketEvent
//      validation.
//   5. agent-os (T006): the kernel topic reservation matches
//      kind-for-kind; the publication envelope JSON-round-trips through
//      the REAL createMessageEnvelope.
//   6. THE MARKET-DATA ADAPTER (T037 Coinbase): driving the REAL
//      Coinbase adapter session over the REAL provider-sdk fake
//      transport produces canonical trade/quote/book_snapshot events
//      that this package's observation mirrors accept VERBATIM (extras
//      ride — the canonical contract is a floor).
//   7. THE REPLAY WORLD (T009 market-world): the REAL deterministic
//      fixture stream's quote/trade/book_snapshot records satisfy this
//      package's observation mirrors verbatim — the regime researcher's
//      observation substrate is the replay world's event stream.

import { describe, expect, it } from 'vitest';

// --- The contract package under test ---------------------------------------
import {
  type AgentInstanceId,
  type TenantId,
  type TopicName,
  type RegimeMessageEnvelope,
  CONFIDENCE_LEVELS,
  buildRegimePublication,
  canonicalJson,
  isRegimeMessageEnvelope,
  isQuoteObservation,
  isTradeObservation,
  isBookSnapshotObservation,
  isSkillArtifactRef,
  stableDigest,
  validateObservationProvenance,
  validateMarketObservation,
  validateRegimePublication,
  REGIME_RESEARCHER_BODY,
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

// --- The REAL Coinbase adapter (T037) + the REAL provider-sdk transport ----
import {
  createCoinbaseAdapterSession,
  coinbaseSubscription,
  COINBASE_ENTITLEMENT,
  type AdapterSession as CoinbaseSession,
  type EmittedEvent as CoinbaseEvent,
} from '../../../adapters/coinbase/src/index';
import {
  createFakeTransport,
  type FakeTransport,
  type JsonObject,
  type TransportScript,
} from '../../../packages/provider-sdk/src/index';

// --- The REAL replay world fixtures (T009) ----------------------------------
import { fixtureEvents } from '../../../services/market-world/src/index';

// ---------------------------------------------------------------------------
// 1. agent-body (T003) — the BodyVersion mirror
// ---------------------------------------------------------------------------

describe('interop: agent-body (the BodyVersion mirror)', () => {
  it('a REAL createBodyVersion built from this spec\'s composition is valid', () => {
    const mirror = REGIME_RESEARCHER_BODY.bodyVersion;
    const draft = JSON.parse(JSON.stringify(mirror)) as BodyVersionDraft;
    const real = createBodyVersion(draft);
    expect(() => real).not.toThrow(); // construction validates every T003 invariant
    expect(isBodyVersion(real)).toBe(true);
    expect(real.id).toBe('regime-researcher@1.0.0');
    expect(isBodyComposition(real.composition)).toBe(true);
  });

  it('the real guard accepts a JSON round-trip of this spec\'s mirror record', () => {
    const round = JSON.parse(JSON.stringify(REGIME_RESEARCHER_BODY.bodyVersion));
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
    const draft = JSON.parse(JSON.stringify(REGIME_RESEARCHER_BODY.bodyVersion)) as BodyVersionDraft;
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
    const valid = ['skills/regime/classification-v1', 'skills/x', 'a'.repeat(1024)];
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
// 4. provenance / market-protocol (T008/T004) — the provenance block +
//    canonical market-event floor
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

  it('this lane\'s market observations pass the REAL canonical MarketEvent validation', () => {
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
    expect(validateMarketObservation(broken).map((e) => e.code)).toContain('timestamp_order');
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
    const built = buildRegimePublication({
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
    expect(validateRegimePublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
    // the envelope alone round-trips through the REAL agent-os factory
    const real = createMessageEnvelope(JSON.parse(JSON.stringify(built.value.envelope)));
    expect(isMessageEnvelope(real)).toBe(true);
    expect(real.id).toBe(built.value.envelope.id);
    expect(real.payload).toBe(built.value.envelope.payload);
    expect(real.sequence).toBe(1);
    // the real envelope satisfies this lane's mirror guard
    expect(isRegimeMessageEnvelope(JSON.parse(JSON.stringify(real)))).toBe(true);
    // the payload is the opaque report reference, bound to the report id
    expect(real.payload).toBe(`report:${FIXTURE_REPORT.reportId}`);
  });
});

// ---------------------------------------------------------------------------
// 6. THE MARKET-DATA ADAPTER (T037 Coinbase) — the observation mirrors
//    accept REAL emitter output
// ---------------------------------------------------------------------------

const AT0 = 1_716_312_132_123;
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

function drain(session: CoinbaseSession): { events: CoinbaseEvent[] } {
  const events: CoinbaseEvent[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok || next.value === null) break;
    events.push(next.value);
  }
  return { events };
}

describe('interop: the REAL Coinbase adapter (T037) feeds this lane\'s observation mirrors', () => {
  it('emitted trade/quote/book_snapshot events satisfy the mirrors verbatim (extras ride — the floor)', () => {
    const coinbaseMatch = (sequence: number, tradeId: number, side: 'buy' | 'sell'): JsonObject =>
      ({
        type: 'match',
        trade_id: tradeId,
        sequence,
        maker_order_id: '2b6f88ef-7c21-4b1f-9a1e-1b1f4c6d1e5f',
        taker_order_id: 'f1a2b3c4-d5e6-4789-a012-3456789abcde',
        time: '2024-05-21T17:22:12.123456Z',
        product_id: 'BTC-USD',
        size: '0.01700000',
        price: '43125.10000000',
        side,
      }) as JsonObject;

    const coinbaseTicker = (sequence: number): JsonObject =>
      ({
        type: 'ticker',
        trade_id: 7,
        sequence,
        time: '2024-05-21T17:22:12.123456Z',
        product_id: 'BTC-USD',
        price: '43125.10000000',
        last_size: '0.01700000',
        best_bid: '43125.09000000',
        best_bid_size: '0.50000000',
        best_ask: '43125.11000000',
        best_ask_size: '0.73000000',
        open_24h: '-26.59000000',
        volume_24h: '12345.67000000',
        low_24h: '42500.00000000',
        high_24h: '43200.00000000',
        volume_30d: '450000.00000000',
      }) as JsonObject;

    const coinbaseSnapshot = (): JsonObject =>
      ({
        type: 'snapshot',
        product_id: 'BTC-USD',
        bids: [['43125.20000000', '1.10000000']],
        asks: [['43126.30000000', '0.50000000']],
      }) as JsonObject;

    const construction = createCoinbaseAdapterSession({
      transport: transportFor(
        script([
          { at: AT0, channel: 'match', payload: coinbaseMatch(6573391, 7, 'buy') },
          { at: AT0 + 10, channel: 'ticker', payload: coinbaseTicker(6573392) },
          { at: AT0 + 20, channel: 'level2_batch', payload: coinbaseSnapshot() },
          { at: AT0 + 30, channel: 'match', payload: coinbaseMatch(6573393, 8, 'sell') },
        ]),
      ),
      entitlement: COINBASE_ENTITLEMENT,
    });
    if (!construction.ok) throw new Error(`session must construct: ${JSON.stringify(construction.errors)}`);
    const session = construction.session;
    expect(session.open().ok).toBe(true);
    for (const channel of ['match', 'ticker', 'level2_batch'] as const) {
      const spec = coinbaseSubscription({ channel, instrument: 'BTC-USD' });
      if (!spec.ok) throw new Error('subscription must build');
      expect(session.subscribe(spec.value).ok).toBe(true);
    }
    const { events } = drain(session);
    expect(events.length).toBe(4);

    // EVERY emitted event satisfies this lane's observation mirrors and
    // the REAL canonical event validation, verbatim (the extras —
    // entitlement, mapping — ride as tolerated fields).
    for (const event of events) {
      if (event.event_type === 'trade') expect(isTradeObservation(event)).toBe(true);
      if (event.event_type === 'quote') expect(isQuoteObservation(event)).toBe(true);
      if (event.event_type === 'book_snapshot') expect(isBookSnapshotObservation(event)).toBe(true);
      expect(validateMarketObservation(event)).toEqual([]);
      expect(validateMarketEvent(event).ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. THE REPLAY WORLD (T009) — the observation substrate
// ---------------------------------------------------------------------------

describe('interop: the REAL market-world replay fixtures feed the observation mirrors', () => {
  it('the replay world\'s recorded quote/trade/book_snapshot stream is valid observation input', () => {
    const events = fixtureEvents();
    expect(events.length).toBeGreaterThan(0);
    let classified = 0;
    for (const record of events) {
      const eventType = (record as { event_type?: unknown }).event_type;
      if (eventType === 'quote' || eventType === 'trade' || eventType === 'book_snapshot') {
        expect(validateMarketObservation(record)).toEqual([]);
        expect(validateMarketEvent(record).ok).toBe(true);
        classified += 1;
      }
    }
    // the stream contains market events this researcher can classify
    expect(classified).toBeGreaterThan(0);
    // and the derived vwap `other` aggregates are NOT market observations
    // (they ride the `other` escape hatch — correctly unsupported here)
    const others = events.filter((record) => (record as { event_type?: unknown }).event_type === 'other');
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      expect(validateMarketObservation(other).map((e) => e.code)).toContain('unknown_event_type');
    }
  });

  it('a replay-world observation can serve as classification evidence', () => {
    // Pick a quote from the real replay stream; it must pass intake AND
    // the canonical citation shape.
    const quote = fixtureEvents().find(
      (record) => (record as { event_type?: unknown }).event_type === 'quote',
    );
    expect(quote).toBeDefined();
    const errors = validateMarketObservation(quote);
    expect(errors).toEqual([]);
    const citation = {
      observationId: (quote as { event_id: string }).event_id,
      availableTime: (quote as { available_time: number }).available_time,
      provenance: (quote as { provenance: unknown }).provenance,
    };
    expect(validateObservationProvenance(citation.provenance, citation.observationId)).toEqual([]);
  });
});
