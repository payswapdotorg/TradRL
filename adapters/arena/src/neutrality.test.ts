/**
 * @tradrl/adapter-arena — the INVERSE-neutrality trip-wire.
 *
 * Law L2/L13 read inversely for this adapter: the contract mirror
 * knows no provider; THIS adapter is where the Arena wire vocabulary
 * lives — but ONLY in the declaration layers (descriptor, schemas,
 * mapping tables, guard, routing). The minted CANONICAL envelopes are
 * provider-neutral T045 shapes: no Arena wire field name may appear
 * as a field of an emitted envelope, and the documented wire FORMS
 * (the wire type codes, the wire message ids, the wire discriminators)
 * must not leak into the envelope values.
 *
 * The test drives the FULL happy-path conversation (all three
 * channels), walks every emitted envelope RECURSIVELY collecting every
 * field name, and asserts the intersection with the adapter's exported
 * wire vocabulary is empty; it also proves the positive direction —
 * the vocabulary DOES live in the declaration layers.
 */

import { describe, expect, it } from 'vitest';

// The REAL provider-sdk's scripted fake transport (test-only import).
import { createFakeTransport, type TransportScript } from '../../../packages/provider-sdk/src/index';

import {
  createArenaAdapterSession,
  arenaSubscription,
  ARENA_ENTITLEMENT,
  ARENA_WIRE_FIELD_NAMES,
  ARENA_WIRE_NAMES_SHARED_WITH_CANONICAL,
  ARENA_MESSAGE_KINDS,
  ARENA_SOURCE_DESCRIPTOR,
  ARENA_MAPPING_TABLES,
  ARENA_CATALOG_TABLE,
  accountedRawFields,
  guardArenaCatalogPayload,
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
// The mirror mint: the SAME content-addressed quote the adapter's mapping
// mints from the wire quote (pinned by mapping-tables.test) — never a
// hand-cast placeholder id, which would fork the announced engagement's
// derivation from the exchange's own (the interop test pins that parity).
const fixtureQuoteMint = fixtureQuote(request);
const engagement = fixtureEngagement(request, fixtureQuoteMint, T0 + 2_500);

const ms = (value: number): TimestampMs => value as TimestampMs;

/** Runs the full conversation and returns every emitted envelope. */
function emitAll(): EmittedEnvelope[] {
  const script: TransportScript = {
    inbound: [
      { at: ms(T0), channel: 'arenaCatalog', payload: arenaCatalogPayload() },
      { at: ms(T0 + 1_500), channel: 'arenaQuotes', payload: arenaQuotePayload(request) },
      { at: ms(T0 + 3_000), channel: 'arenaDeliveries', payload: arenaDeliveryPayload(engagement) },
    ],
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  };
  const construction = createFakeTransport(script);
  if (!construction.ok) throw new Error('script must validate');
  const sessionConstruction = createArenaAdapterSession({
    transport: construction.transport,
    entitlement: ARENA_ENTITLEMENT,
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
  });
  if (!sessionConstruction.ok) throw new Error('session must construct');
  const session = sessionConstruction.session;
  const opened = session.engine.open();
  if (!opened.ok) throw new Error(`open must succeed: ${opened.error.message}`);
  for (const channel of ['arenaCatalog', 'arenaQuotes', 'arenaDeliveries'] as const) {
    const spec = arenaSubscription({ channel, sinceRevision: 1 });
    if (!spec.ok) throw new Error(`subscription must build: ${spec.error.message}`);
    const subscribed = session.engine.subscribe(spec.value);
    if (!subscribed.ok) throw new Error(`subscribe must succeed: ${subscribed.error.message}`);
  }
  const routed = session.routeRequest(arenaRequestDraft());
  if (!routed.ok) throw new Error(`routing must succeed: ${routed.error.message}`);
  const announced = session.announceEngagement(engagement);
  if (!announced.ok) throw new Error(`announcement must succeed: ${announced.error.message}`);

  const emissions: EmittedEnvelope[] = [];
  session.engine.onEnvelope((emission) => emissions.push(emission));
  const pumped = session.engine.pump();
  if (!pumped.ok) throw new Error(`pump must succeed: ${pumped.error.message}`);
  return emissions;
}

/** Recursively collect every field name of a JSON-shaped value, WITHOUT
 * descending into the OPAQUE members: the deliverable's `payload` (the
 * payload law — untrusted provider content, carried verbatim and pinned
 * by digest; the exchange never interprets it) and every `consideration`
 * block (opaque structured terms — T047 owns the semantics). Their
 * INTERNAL field names are the provider's own content, deliberately
 * neither canonical vocabulary nor wire field names. */
function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const element of value) collectKeys(element, keys);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      if (key === 'payload' || key === 'consideration') continue; // opaque: carried verbatim, never interpreted
      collectKeys(nested, keys);
    }
  }
}

describe('the inverse-neutrality trip-wire (the emitted envelopes are provider-neutral T045 shapes)', () => {
  const emissions = emitAll();

  it('every consumed channel emits (the walk is not vacuous)', () => {
    expect(emissions.length).toBe(3);
    expect(emissions.map((emission) => emission.envelope.kind)).toEqual(['declaration', 'quote', 'deliverable']);
  });

  it('NO Arena wire field name appears anywhere in the minted canonical envelopes (L13)', () => {
    const keys = new Set<string>();
    for (const emission of emissions) collectKeys(emission.envelope, keys);
    expect(keys.size).toBeGreaterThan(15); // the walk must actually cover the records
    // "offers", "offerRef", "summary" and "claims" are shared by the T045
    // canonical contracts themselves (the declaration's offers, the quote's
    // offerRef, the offers' summary, the deliverable's claims — the declared
    // overlap); every OTHER documented Arena wire field name is
    // provider-only and banned (the sibling adapters' canonicalOverlap
    // discipline).
    const shared = ARENA_WIRE_NAMES_SHARED_WITH_CANONICAL as readonly string[];
    const banned = (ARENA_WIRE_FIELD_NAMES as readonly string[]).filter((name) => !shared.includes(name));
    expect(banned.length).toBeGreaterThanOrEqual(15); // the banned list is substantial
    const violations = [...keys].filter((key) => banned.includes(key));
    expect(violations).toEqual([]);
  });

  it('the emitted envelope field names are the T045 contract vocabulary only', () => {
    const keys = new Set<string>();
    for (const emission of emissions) collectKeys(emission.envelope, keys);
    const canonicalFields = [
      // The emission carrier (the adapter's provider-neutral wrapper —
      // contract/session.ts; everything adapter-specific stays in the
      // OUTER EmittedEnvelope, never in the record).
      'kind', 'record', 'answersRequest', 'forEngagement',
      // The declaration.
      'declarationId', 'providerRef', 'displayName', 'offers', 'version', 'supersedes', 'declaredAt',
      'offerRef', 'capabilityKey', 'summary', 'measuredEvidence', 'applicability',
      'environmentProfileRefs', 'instrumentClassRefs', 'deliverableKinds', 'verificationKinds',
      'tenantId', 'projectId',
      // The quote.
      'quoteId', 'requestId', 'terms', 'quotedAt',
      'deliverableKind', 'verification', 'consideration', 'estimatedDeliveryAt',
      // The deliverable.
      'deliverableId', 'engagementId', 'claims', 'payload', 'payloadDigest', 'submittedAt',
      'claimRef',
      // The verification requirements (the frozen goalposts).
      'requirementRef', 'benchmarkId', 'metric', 'min', 'max', 'evaluationRef',
      // The measured-evidence union members (T017/T045 language).
      'recordRef', 'resultRef', 'value',
    ];
    for (const key of keys) {
      expect(canonicalFields).toContain(key);
    }
  });

  it('the documented wire FORMS do not leak into the envelope values', () => {
    const serialized = JSON.stringify(emissions.map((emission) => emission.envelope));
    // The wire discriminators and type codes never appear.
    for (const discriminator of ARENA_MESSAGE_KINDS) {
      expect(serialized).not.toContain(discriminator);
    }
    expect(serialized).not.toContain('ARTIFACT');
    expect(serialized).not.toContain('EVIDENCE');
    expect(serialized).not.toContain('BENCHMARK');
    expect(serialized).not.toContain('LOCAL_EVAL');
    // The wire message ids never appear.
    expect(serialized).not.toContain('arena-cat-0001');
    expect(serialized).not.toContain('arena-qte-0002');
    expect(serialized).not.toContain('arena-dlv-0003');
    // The canonical forms DO appear (the enum translation worked).
    expect(serialized).toContain('"capability-artifact"');
    expect(serialized).toContain('"benchmark"');
    expect(serialized).toContain('"local-evaluation"');
  });

  it('the wire vocabulary DOES live in the declaration layers (the L13 inverse: HERE)', () => {
    // The descriptor carries the provider id and the channel vocabulary.
    expect(ARENA_SOURCE_DESCRIPTOR.provider).toBe('arena');
    expect(ARENA_SOURCE_DESCRIPTOR.capabilities.channels).toContain('arenaQuotes');
    // The mapping tables account for the wire fields by name.
    const accounted = accountedRawFields(ARENA_CATALOG_TABLE);
    expect(accounted).toContain('providerName');
    expect(accounted).toContain('offers');
    expect(accounted).toContain('catalogRevision');
    expect(ARENA_MAPPING_TABLES.length).toBe(3);
    // The schema layer exports the documented vocabulary.
    expect(ARENA_WIRE_FIELD_NAMES).toContain('messageKind');
    expect(ARENA_WIRE_FIELD_NAMES).toContain('deliverableType');
    expect(ARENA_WIRE_FIELD_NAMES).toContain('verificationEcho');
    expect(ARENA_WIRE_FIELD_NAMES.length).toBeGreaterThanOrEqual(20);
    // The schema guard keeps the documented names on the wire side.
    const guarded = guardArenaCatalogPayload(arenaCatalogPayload() as JsonObject);
    if (!guarded.ok) throw new Error('must guard');
    expect(guarded.value.messageId).toBe('arena-cat-0001');
  });
});
