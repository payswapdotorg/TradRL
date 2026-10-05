/**
 * @tradrl/adapter-arena — the adapter session tests: the lifecycle over
 * an injected transport port (the REAL provider-sdk's scripted fake,
 * via relative path — cross-package imports happen ONLY in tests), the
 * guard pipeline's typed refusals, the optional-path seam, and the
 * byte-determinism of the whole emission stream.
 */

import { describe, expect, it } from 'vitest';

// The REAL provider-sdk's scripted fake transport (test-only import).
import { createFakeTransport, type TransportScript } from '../../../packages/provider-sdk/src/index';

import {
  createArenaAdapterSession,
  createArenaSessionWithoutEntitlement,
  arenaSubscription,
  ARENA_ENTITLEMENT,
  arenaProtocolCodeOf,
  isEntitlementError,
  validateProviderDeclaration,
  validateDeliverable,
  validateProviderQuoteDraft,
  type ArenaAdapterSession,
  type EmittedEnvelope,
  type JsonObject,
  type TimestampMs,
} from './index';
import {
  arenaCatalogPayload,
  arenaQuotePayload,
  arenaDeliveryPayload,
  arenaRequestDraft,
  fixtureRequest,
  fixtureQuote,
  fixtureEngagement,
  FIXTURE_TENANT,
  FIXTURE_PROJECT,
  T0,
} from './test-fixtures';

const request = fixtureRequest();
const engagement = fixtureEngagement(request, fixtureQuote(request), T0 + 2_500);

const ms = (value: number): TimestampMs => value as TimestampMs;

/** The full happy-path conversation script (catalog -> quote -> delivery). */
function happyScript(): TransportScript {
  return {
    inbound: [
      { at: ms(T0), channel: 'arenaCatalog', payload: arenaCatalogPayload() },
      { at: ms(T0 + 1_500), channel: 'arenaQuotes', payload: arenaQuotePayload(request) },
      { at: ms(T0 + 3_000), channel: 'arenaDeliveries', payload: arenaDeliveryPayload(engagement) },
    ],
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  };
}

/** Construct a subscribed happy-path session over a fresh fake transport. */
function subscribedSession(script: TransportScript): { session: ArenaAdapterSession; transport: unknown } {
  const construction = createFakeTransport(script);
  if (!construction.ok) throw new Error('script must validate');
  const sessionConstruction = createArenaAdapterSession({
    transport: construction.transport,
    entitlement: ARENA_ENTITLEMENT,
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
  });
  if (!sessionConstruction.ok) throw new Error(`session must construct: ${sessionConstruction.errors.map((e) => e.message).join('; ')}`);
  const session = sessionConstruction.session;
  const opened = session.engine.open();
  if (!opened.ok) throw new Error(`open must succeed: ${opened.error.message}`);
  for (const channel of ['arenaCatalog', 'arenaQuotes', 'arenaDeliveries'] as const) {
    const spec = arenaSubscription({ channel, sinceRevision: 1 });
    if (!spec.ok) throw new Error(`subscription must build: ${spec.error.message}`);
    const subscribed = session.engine.subscribe(spec.value);
    if (!subscribed.ok) throw new Error(`subscribe must succeed: ${subscribed.error.message}`);
  }
  return { session, transport: construction.transport };
}

describe('session construction (the collect-all law)', () => {
  it('requires the transport port and the L12 scope', () => {
    const noTransport = createArenaAdapterSession({ tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT });
    expect(noTransport.ok).toBe(false);
    if (!noTransport.ok) expect(noTransport.errors[0]!.path).toBe('transport');

    const construction = createFakeTransport(happyScript());
    if (!construction.ok) throw new Error('script must validate');
    const noScope = createArenaAdapterSession({ transport: construction.transport });
    expect(noScope.ok).toBe(false);
  });

  it('refuses a malformed entitlement envelope', () => {
    const construction = createFakeTransport(happyScript());
    if (!construction.ok) throw new Error('script must validate');
    const bad = createArenaAdapterSession({ transport: construction.transport, entitlement: { access_class: 'maybe' }, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT });
    expect(bad.ok).toBe(false);
  });
});

describe('the lifecycle state machine (typed errors on every misuse)', () => {
  it('refuses subscribe-before-open, unknown channels, duplicate subscriptions, use-after-close and double-close', () => {
    const construction = createFakeTransport(happyScript());
    if (!construction.ok) throw new Error('script must validate');
    const built = createArenaAdapterSession({ transport: construction.transport, entitlement: ARENA_ENTITLEMENT, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT });
    if (!built.ok) throw new Error('session must construct');
    const session = built.session;

    const spec = arenaSubscription({ channel: 'arenaCatalog', sinceRevision: 1 });
    if (!spec.ok) throw new Error('subscription must build');
    const beforeOpen = session.engine.subscribe(spec.value);
    expect(beforeOpen.ok).toBe(false);
    if (!beforeOpen.ok) expect(beforeOpen.error.code).toBe('invalid_transition');

    const opened = session.engine.open();
    expect(opened.ok).toBe(true);

    const unknownChannel = session.engine.subscribe({ channel: 'arenaSecret', request: {}, mapping_table_id: 'arena-catalog-publication' });
    expect(unknownChannel.ok).toBe(false);
    if (!unknownChannel.ok) expect(unknownChannel.error.code).toBe('invalid_configuration');

    const badTable = session.engine.subscribe({ channel: 'arenaCatalog', request: {}, mapping_table_id: 'no-such-table' });
    expect(badTable.ok).toBe(false);
    if (!badTable.ok) expect(badTable.error.code).toBe('mapping_table_not_found');

    const subscribed = session.engine.subscribe(spec.value);
    expect(subscribed.ok).toBe(true);
    const duplicate = session.engine.subscribe(spec.value);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe('duplicate_subscription');

    const closed = session.engine.close();
    expect(closed.ok).toBe(true);
    const afterClose = session.engine.nextEnvelope();
    expect(afterClose.ok).toBe(false);
    if (!afterClose.ok) expect(afterClose.error.code).toBe('use_after_close');
    const doubleClose = session.engine.close();
    expect(doubleClose.ok).toBe(false);
    if (!doubleClose.ok) expect(doubleClose.error.code).toBe('double_close');
  });
});

describe('the full conversation (the optional path, end to end through the adapter)', () => {
  it('routes the request, mints the declaration + quote envelopes, announces the engagement, mints the deliverable', () => {
    const { session } = subscribedSession(happyScript());

    // The optional-path seam: route the platform request onto the wire.
    const routed = session.routeRequest(arenaRequestDraft());
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    expect(session.conversation.routedRequests.size).toBe(1);
    expect(session.conversation.routedRequests.has(request.requestId)).toBe(true);

    // Announce the platform's engagement (the guard pre-checks deliveries against it).
    const announced = session.announceEngagement(engagement);
    expect(announced.ok).toBe(true);

    // Pump the whole conversation.
    const emissions: EmittedEnvelope[] = [];
    session.engine.onEnvelope((emission) => emissions.push(emission));
    const pumped = session.engine.pump();
    expect(pumped.ok).toBe(true);
    if (!pumped.ok) return;
    expect(pumped.value).toBe(3);

    // The declaration envelope is a VALID T045 declaration.
    const declaration = emissions[0]!;
    expect(declaration.envelope.kind).toBe('declaration');
    if (declaration.envelope.kind !== 'declaration') return;
    const revalidated = validateProviderDeclaration(declaration.envelope.record);
    expect(revalidated.ok).toBe(true);
    if (revalidated.ok) {
      expect(revalidated.value.providerRef).toBe('arena');
      expect(revalidated.value.offers.length).toBe(2);
      expect(revalidated.value.declarationId).toMatch(/^pvd:[0-9a-f]{16}$/);
    }
    expect(declaration.channel).toBe('arenaCatalog');
    expect(declaration.entitlement.entitlement_id).toBe('ent-arena-engagement');

    // The quote envelope is a VALID T045 quote answering the routed request.
    const quoteEmission = emissions[1]!;
    expect(quoteEmission.envelope.kind).toBe('quote');
    if (quoteEmission.envelope.kind !== 'quote') return;
    const requoted = validateProviderQuoteDraft(quoteEmission.envelope.record);
    expect(requoted.ok).toBe(true);
    if (requoted.ok) {
      expect(requoted.value.requestId).toBe(request.requestId);
      expect(requoted.value.terms.deliverableKind).toBe('capability-artifact');
      expect(requoted.value.quoteId).toMatch(/^qte:[0-9a-f]{16}$/);
    }
    expect(quoteEmission.envelope.answersRequest).toBe(request.requestId);

    // The deliverable envelope is a VALID T045 deliverable for the announced engagement.
    const deliveryEmission = emissions[2]!;
    expect(deliveryEmission.envelope.kind).toBe('deliverable');
    if (deliveryEmission.envelope.kind !== 'deliverable') return;
    const redelivered = validateDeliverable(deliveryEmission.envelope.record);
    expect(redelivered.ok).toBe(true);
    if (redelivered.ok) {
      expect(redelivered.value.engagementId).toBe(engagement.engagementId);
      expect(redelivered.value.kind).toBe('capability-artifact');
      expect(redelivered.value.deliverableId).toMatch(/^dlv:[0-9a-f]{16}$/);
      expect(redelivered.value.payloadDigest).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(deliveryEmission.envelope.forEngagement).toBe(engagement.engagementId);
  });

  it('the wire deliverable-type codes never leak into the minted envelopes (the enum translation)', () => {
    const { session } = subscribedSession(happyScript());
    session.routeRequest(arenaRequestDraft());
    session.announceEngagement(engagement);
    const emissions: EmittedEnvelope[] = [];
    session.engine.onEnvelope((emission) => emissions.push(emission));
    const pumped = session.engine.pump();
    expect(pumped.ok).toBe(true);
    const serialized = JSON.stringify(emissions.map((emission) => emission.envelope));
    expect(serialized).not.toContain('ARTIFACT');
    expect(serialized).not.toContain('EVIDENCE');
    expect(serialized).toContain('"capability-artifact"');
  });
});

describe('the guard pipeline\'s typed refusals (fail-fast at the boundary)', () => {
  it('refuses a duplicate wire message id (duplicate_message)', () => {
    const script: TransportScript = {
      inbound: [
        { at: ms(T0), channel: 'arenaCatalog', payload: arenaCatalogPayload() },
        { at: ms(T0 + 1), channel: 'arenaCatalog', payload: arenaCatalogPayload() },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const { session } = subscribedSession(script);
    const first = session.engine.nextEnvelope();
    expect(first.ok).toBe(true);
    const second = session.engine.nextEnvelope();
    expect(second.ok).toBe(false);
    if (!second.ok) expect(arenaProtocolCodeOf(second.error)).toBe('duplicate_message');
  });

  it('refuses a quote answering an unknown correlation (unknown_correlation)', () => {
    const script: TransportScript = {
      inbound: [{ at: ms(T0 + 1_500), channel: 'arenaQuotes', payload: arenaQuotePayload(request) }],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const { session } = subscribedSession(script); // no request routed
    const outcome = session.engine.nextEnvelope();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(arenaProtocolCodeOf(outcome.error)).toBe('unknown_correlation');
  });

  it('refuses a quote whose echoed goalposts drifted (verification_drift — goalposts never move)', () => {
    const driftedPayload: JsonObject = {
      ...arenaQuotePayload(request),
      verificationEcho: [
        { kind: 'benchmark', requirementRef: 'bench-check', benchmarkId: 'bench-microstructure-42' },
        { kind: 'measurement', requirementRef: 'latency-check', metric: 'p95-latency-ms', max: 999 }, // the moved goalpost
        { kind: 'local-evaluation', requirementRef: 'local-eval', evaluationRef: 'eval://suite-arena-import-1' },
      ],
    };
    const script: TransportScript = {
      inbound: [{ at: ms(T0 + 1_500), channel: 'arenaQuotes', payload: driftedPayload }],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const { session } = subscribedSession(script);
    session.routeRequest(arenaRequestDraft());
    const outcome = session.engine.nextEnvelope();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(arenaProtocolCodeOf(outcome.error)).toBe('verification_drift');
  });

  it('refuses a quote that predates its request (conversation_order_violation — L4)', () => {
    const earlyPayload: JsonObject = { ...arenaQuotePayload(request), respondedAtMs: request.requestedAt - 1 };
    const script: TransportScript = {
      inbound: [{ at: ms(T0 + 1_500), channel: 'arenaQuotes', payload: earlyPayload }],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const { session } = subscribedSession(script);
    session.routeRequest(arenaRequestDraft());
    const outcome = session.engine.nextEnvelope();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(arenaProtocolCodeOf(outcome.error)).toBe('conversation_order_violation');
  });

  it('refuses a delivery violating the announced engagement (engagement_contract_refused: kind + deadline)', () => {
    // A wrong-kind delivery (EVIDENCE vs the engagement's frozen ARTIFACT).
    const wrongKindScript: TransportScript = {
      inbound: [
        { at: ms(T0 + 3_000), channel: 'arenaDeliveries', payload: { ...arenaDeliveryPayload(engagement), deliverableType: 'EVIDENCE' } as JsonObject },
      ],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const wrongKind = subscribedSession(wrongKindScript);
    wrongKind.session.announceEngagement(engagement);
    const refused = wrongKind.session.engine.nextEnvelope();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(arenaProtocolCodeOf(refused.error)).toBe('engagement_contract_refused');

    // A late delivery (past the frozen deadline).
    const latePayload: JsonObject = { ...arenaDeliveryPayload(engagement), deliveredAtMs: engagement.deadline! + 1 };
    const lateScript: TransportScript = {
      inbound: [{ at: ms(engagement.deadline! + 1), channel: 'arenaDeliveries', payload: latePayload }],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const late = subscribedSession(lateScript);
    late.session.announceEngagement(engagement);
    const lateRefused = late.session.engine.nextEnvelope();
    expect(lateRefused.ok).toBe(false);
    if (!lateRefused.ok) expect(arenaProtocolCodeOf(lateRefused.error)).toBe('engagement_contract_refused');
  });

  it('a delivery for an UNANNOUNCED engagement passes the guard (the platform\'s exchange owns the refusal)', () => {
    const script: TransportScript = {
      inbound: [{ at: ms(T0 + 3_000), channel: 'arenaDeliveries', payload: arenaDeliveryPayload(engagement) }],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const { session } = subscribedSession(script);
    const outcome = session.engine.nextEnvelope();
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.value !== null) {
      expect(outcome.value.envelope.kind).toBe('deliverable');
    }
  });

  it('an unknown messageKind on a consumed channel is a typed failure (unknown_message_kind)', () => {
    const script: TransportScript = {
      inbound: [{ at: ms(T0), channel: 'arenaCatalog', payload: { ...arenaCatalogPayload(), messageKind: 'ARENA_TELEMETRY' } as JsonObject }],
      recv_failures: [],
      send_failures: [],
      receive_timeout_ms: null,
    };
    const { session } = subscribedSession(script);
    const outcome = session.engine.nextEnvelope();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(arenaProtocolCodeOf(outcome.error)).toBe('unknown_message_kind');
  });
});

describe('the licensing law (entitlement declaration)', () => {
  it('emission without a declared entitlement is a typed EntitlementError (no entitlement-less record exists)', () => {
    const construction = createFakeTransport(happyScript());
    if (!construction.ok) throw new Error('script must validate');
    const built = createArenaSessionWithoutEntitlement(construction.transport, FIXTURE_TENANT, FIXTURE_PROJECT);
    if (!built.ok) throw new Error('session must construct');
    const session = built.session;
    const opened = session.engine.open();
    if (!opened.ok) throw new Error('open must succeed');
    const spec = arenaSubscription({ channel: 'arenaCatalog', sinceRevision: 1 });
    if (!spec.ok) throw new Error('subscription must build');
    session.engine.subscribe(spec.value);
    const outcome = session.engine.nextEnvelope();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(isEntitlementError(outcome.error)).toBe(true);
      expect(outcome.error.code).toBe('entitlement_undeclared');
    }
  });
});

describe('the optional-path seam (routeRequest / announceEngagement)', () => {
  it('refuses a request outside the session\'s L12 scope (the adapter routes within one tenant)', () => {
    const { session } = subscribedSession(happyScript());
    const foreign = { ...arenaRequestDraft(), tenantId: 'tenant-other' };
    const routed = session.routeRequest(foreign);
    expect(routed.ok).toBe(false);
    if (!routed.ok) {
      expect(routed.error.code).toBe('invalid_configuration');
      expect(routed.error.message).toContain('L12');
    }
  });

  it('refuses a malformed announced engagement and a foreign-scope one', () => {
    const { session } = subscribedSession(happyScript());
    const malformed = session.announceEngagement({ engagementId: 'not-an-id' });
    expect(malformed.ok).toBe(false);
    const foreign = session.announceEngagement({ ...engagement, tenantId: 'tenant-other' } as never);
    expect(foreign.ok).toBe(false);
  });

  it('a routed request whose frame fails to send surfaces the typed transport failure', () => {
    const script: TransportScript = {
      inbound: [],
      recv_failures: [],
      send_failures: [{ on_send_index: 3, message: 'the wire refused the request frame' }], // sends 0-2 are the three channel SUBSCRIBE frames
      receive_timeout_ms: null,
    };
    const { session } = subscribedSession(script);
    const routed = session.routeRequest(arenaRequestDraft());
    expect(routed.ok).toBe(false);
    if (!routed.ok) expect(routed.error.kind).toBe('transport');
  });
});

describe('byte-determinism (the same script, the same envelope stream)', () => {
  it('two identical conversations produce byte-identical envelope streams', () => {
    const first = subscribedSession(happyScript());
    const second = subscribedSession(happyScript());
    first.session.routeRequest(arenaRequestDraft());
    second.session.routeRequest(arenaRequestDraft());
    first.session.announceEngagement(engagement);
    second.session.announceEngagement(engagement);
    const firstEmissions: EmittedEnvelope[] = [];
    const secondEmissions: EmittedEnvelope[] = [];
    first.session.engine.onEnvelope((emission) => firstEmissions.push(emission));
    second.session.engine.onEnvelope((emission) => secondEmissions.push(emission));
    const firstPumped = first.session.engine.pump();
    const secondPumped = second.session.engine.pump();
    expect(firstPumped.ok).toBe(true);
    expect(secondPumped.ok).toBe(true);
    expect(JSON.stringify(firstEmissions)).toBe(JSON.stringify(secondEmissions));
    expect(firstEmissions.length).toBe(3);
  });
});
