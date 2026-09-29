// @tradrl/body-fundamental-researcher — THE INTEROP TRIP WIRES.
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
//      T038-shaped observations pass the REAL market-protocol
//      MarketEvent validation (fundamental, macro_release and the
//      corporate-action `other` records — quartet + provenance).
//   5. agent-os (T006): the kernel topic reservation matches
//      kind-for-kind; the publication envelope JSON-round-trips through
//      the REAL createMessageEnvelope.
//   6. THE ADAPTERS (T038): driving the REAL equities adapter (indexLevel
//      + corporateActions channels) and the REAL alternative-data adapter
//      (economicSeries channel) over the REAL provider-sdk fake
//      transport produces EmittedEvents that this package's observation
//      mirrors accept VERBATIM (extras ride — the canonical contract is
//      a floor), and a real-emitted observation can serve as assessment
//      evidence.

import { describe, expect, it } from 'vitest';

// --- The contract package under test ---------------------------------------
import {
  type AgentInstanceId,
  type TopicName,
  type TenantId,
  type MessageEnvelopeMirror,
  CONFIDENCE_LEVELS,
  buildFundamentalPublication,
  canonicalJson,
  createFundamentalAssessment,
  isMessageEnvelopeMirror,
  isFundamentalDatumObservation,
  isMacroReleaseObservation,
  isCorporateActionObservation,
  isSkillArtifactRef,
  stableDigest,
  validateObservationProvenance,
  validateFundamentalObservation,
  validateFundamentalPublication,
  FUNDAMENTAL_RESEARCHER_BODY,
  FUNDAMENTAL_METHOD_REGISTRY,
  FUNDAMENTAL_VALUATION_METHOD,
  FUNDAMENTAL_CONFIDENCE_METHOD,
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
  FIXTURE_PROVENANCE,
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
  createEquitiesAdapterSession,
  equitiesSubscription,
  EQUITIES_ENTITLEMENT,
  type AdapterSession as EquitiesAdapterSession,
  type EmittedEvent as EquitiesEmittedEvent,
} from '../../../adapters/equities/src/index';
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
    const mirror = FUNDAMENTAL_RESEARCHER_BODY.bodyVersion;
    const draft = JSON.parse(JSON.stringify(mirror)) as BodyVersionDraft;
    const real = createBodyVersion(draft);
    expect(() => real).not.toThrow(); // construction validates every T003 invariant
    expect(isBodyVersion(real)).toBe(true);
    expect(real.id).toBe('fundamental-researcher@1.0.0');
    expect(isBodyComposition(real.composition)).toBe(true);
  });

  it('the real guard accepts a JSON round-trip of this spec\'s mirror record', () => {
    const round = JSON.parse(JSON.stringify(FUNDAMENTAL_RESEARCHER_BODY.bodyVersion));
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
    const draft = JSON.parse(JSON.stringify(FUNDAMENTAL_RESEARCHER_BODY.bodyVersion)) as BodyVersionDraft;
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
    const valid = ['skills/fundamental/assessment-v1', 'skills/x', 'a'.repeat(1024)];
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
    const kinds = new Set<string>();
    for (const observation of FIXTURE_OBSERVATIONS) {
      kinds.add(observation.event_type);
      const result = validateMarketEvent(observation);
      expect(result.ok).toBe(true);
    }
    // all three consumed kinds are covered by the golden set
    expect(kinds).toEqual(new Set(['fundamental', 'macro_release', 'other']));
  });

  it('negative parity: a broken quartet fails BOTH validators', () => {
    const observation = FIXTURE_OBSERVATIONS[0]!;
    const broken = { ...observation, available_time: (observation.event_time as number) - 1 };
    expect(validateMarketEvent(broken).ok).toBe(false);
    // this lane's observation validator rejects it too (timestamp_order)
    expect(validateFundamentalObservation(broken).map((e) => e.code)).toContain('timestamp_order');
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
    const built = buildFundamentalPublication({
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
    expect(validateFundamentalPublication(built.value, FIXTURE_REGISTRY)).toEqual([]);
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
// 6. THE ADAPTERS (T038) — the observation mirrors accept REAL emitter output
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

function drainEquities(session: EquitiesAdapterSession): { events: EquitiesEmittedEvent[] } {
  const events: EquitiesEmittedEvent[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok || next.value === null) break;
    events.push(next.value);
  }
  return { events };
}

function drainAltData(session: AltDataAdapterSession): { events: AltDataEmittedEvent[] } {
  const events: AltDataEmittedEvent[] = [];
  for (;;) {
    const next = session.nextEvent();
    if (!next.ok || next.value === null) break;
    events.push(next.value);
  }
  return { events };
}

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

const corporateAction = (actionId: string): JsonObject =>
  ({
    recordType: 'CORPORATE_ACTION',
    actionId,
    corporateSymbol: 'TEST-AAA',
    actionTypeCode: 'SPLIT',
    effectiveDate: '2024-06-10',
    announcementTimeMs: AT0 + 20,
    actionRatio: '4:1',
    currencyCode: 'USD',
  }) as JsonObject;

const economicSeries = (seriesId: string, period: string, actual: string, forecast: string): JsonObject =>
  ({
    recordType: 'ECONOMIC_SERIES_OBSERVATION',
    seriesId,
    regionCode: 'US',
    period,
    actualValue: actual,
    forecastValue: forecast,
    priorValue: actual,
    unitCode: '%',
    windowStartMs: AT0 - 3_600_000,
    windowEndMs: AT0 - 1_800_000,
    releaseTimeMs: AT0,
  }) as JsonObject;

describe('interop: the REAL equities adapter (T038) feeds the fundamental mirror', () => {
  it('emitted index-level events satisfy isFundamentalDatumObservation verbatim (extras ride)', () => {
    const construction = createEquitiesAdapterSession({
      transport: transportFor(
        script([
          { at: AT0, channel: 'indexLevel', payload: indexLevel(1, AT0, '100.0000') },
          { at: AT0 + 10, channel: 'indexLevel', payload: indexLevel(2, AT0 + 10, '101.0000') },
          { at: AT0 + 20, channel: 'indexLevel', payload: indexLevel(3, AT0 + 20, '100.5000') },
          { at: AT0 + 30, channel: 'indexLevel', payload: indexLevel(4, AT0 + 30, '100.7500') },
          { at: AT0 + 40, channel: 'indexLevel', payload: indexLevel(5, AT0 + 40, '103.0000') },
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
    const { events } = drainEquities(session);
    expect(events.length).toBe(5);
    for (const event of events) {
      expect(event.event_type).toBe('fundamental');
      expect(isFundamentalDatumObservation(event)).toBe(true);
      const payload = event.payload as { field: string };
      expect(payload.field).toBe('INDEX_LEVEL');
      expect(event.asset_class).toBe('index');
    }
    // and the whole stream passes the REAL canonical event validation
    for (const event of events) {
      expect(validateMarketEvent(event).ok).toBe(true);
    }
  });

  it('emitted corporate-action events satisfy isCorporateActionObservation verbatim', () => {
    const construction = createEquitiesAdapterSession({
      transport: transportFor(script([{ at: AT0 + 20, channel: 'corporateActions', payload: corporateAction('INT-ACT-0001') }])),
      entitlement: EQUITIES_ENTITLEMENT,
    });
    if (!construction.ok) throw new Error(`equities session must construct: ${JSON.stringify(construction.errors)}`);
    const session = construction.session;
    if (!session.open().ok) throw new Error('equities session must open');
    const spec = equitiesSubscription({ channel: 'corporateActions', instrument: 'TEST-AAA' });
    if (!spec.ok) throw new Error('subscription must build');
    if (!session.subscribe(spec.value).ok) throw new Error('subscribe must succeed');
    const { events } = drainEquities(session);
    expect(events.length).toBe(1);
    for (const event of events) {
      expect(event.event_type).toBe('other');
      expect(isCorporateActionObservation(event)).toBe(true);
      const payload = event.payload as { kind: string; data: { action: string; ratio: string } };
      expect(payload.kind).toBe('corporate_action');
      expect(payload.data.action).toBe('split');
      expect(payload.data.ratio).toBe('4:1');
      // the announcement instant is the event time (the declared policy)
      expect(event.available_time).toBeGreaterThanOrEqual(event.event_time);
    }
    for (const event of events) {
      expect(validateMarketEvent(event).ok).toBe(true);
    }
  });
});

describe('interop: the REAL alternative-data adapter (T038) feeds the macro mirror', () => {
  it('emitted economicSeries events satisfy isMacroReleaseObservation verbatim', () => {
    const construction = createAltDataAdapterSession({
      transport: transportFor(
        script([
          { at: AT0, channel: 'economicSeries', payload: economicSeries('INT-ECON-1', '2024-04', '3.4', '3.2') },
          { at: AT0 + 1_000, channel: 'economicSeries', payload: economicSeries('INT-ECON-2', '2024-05', '3.3', '3.25') },
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
    const { events } = drainAltData(session);
    expect(events.length).toBe(2);
    for (const event of events) {
      expect(event.event_type).toBe('macro_release');
      expect(isMacroReleaseObservation(event)).toBe(true);
      const payload = event.payload as { forecast?: string };
      expect(payload.forecast).toBeDefined();
      // the release instant IS the availability (window->release law)
      expect(event.available_time).toBe(event.event_time);
    }
    for (const event of events) {
      expect(validateMarketEvent(event).ok).toBe(true);
    }
  });
});

describe('interop: the full chain stays honest', () => {
  it('a real-emitted index-level observation can serve as assessment evidence', () => {
    // Re-run the equities session and cite its real output in an assessment.
    const construction = createEquitiesAdapterSession({
      transport: transportFor(script([{ at: AT0, channel: 'indexLevel', payload: indexLevel(1, AT0, '104.5000') }])),
      entitlement: EQUITIES_ENTITLEMENT,
    });
    if (!construction.ok) throw new Error('must construct');
    const session = construction.session;
    session.open();
    const spec = equitiesSubscription({ channel: 'indexLevel', instrument: 'TEST-LARGECAP' });
    if (!spec.ok) throw new Error('must build');
    session.subscribe(spec.value);
    const { events } = drainEquities(session);
    const realEvent = events[0];
    expect(realEvent).toBeDefined();
    expect(isFundamentalDatumObservation(realEvent)).toBe(true);

    // cite the REAL emitted event (serialized through JSON) as evidence
    const citation = {
      observationId: realEvent.event_id,
      availableTime: realEvent.available_time,
      provenance: JSON.parse(JSON.stringify(realEvent.provenance)),
    };
    const assessment = createFundamentalAssessment(
      {
        scope: { instrument: 'TEST-LARGECAP', series: 'INDEX_LEVEL' },
        assessmentKind: 'valuation-level',
        stance: {
          methodId: FUNDAMENTAL_VALUATION_METHOD.methodId,
          methodVersion: FUNDAMENTAL_VALUATION_METHOD.version,
          direction: 'positive',
          score: '0.05',
        },
        confidence: {
          methodId: FUNDAMENTAL_CONFIDENCE_METHOD.methodId,
          methodVersion: FUNDAMENTAL_CONFIDENCE_METHOD.version,
          level: 'low',
          evidenceCount: 1,
          dispersion: null,
        },
        evidence: [citation],
        asOf: (AT0 + 60_000) as never,
        bodyVersion: 'fundamental-researcher@1.0.0' as never,
        tenantId: FIXTURE_TENANT,
        projectId: 'project-interop' as never,
        seed: 'seed/interop/fundamental-1',
      },
      FUNDAMENTAL_METHOD_REGISTRY,
    );
    expect(assessment.ok).toBe(true);
    void FIXTURE_PROVENANCE;
  });
});
