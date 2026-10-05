/**
 * @tradrl/adapter-arena — the declared mapping tables: validation,
 * field accounting (the anti-silent-drop law), and the applied
 * translation of the fixture wire payloads into the canonical T045
 * envelope drafts.
 */

import { describe, expect, it } from 'vitest';

import {
  ARENA_MAPPING_TABLES,
  ARENA_CATALOG_TABLE,
  ARENA_QUOTE_TABLE,
  ARENA_DELIVERY_TABLE,
  ARENA_CHANNEL_TABLE_IDS,
  ARENA_WIRE_FIELD_NAMES,
  ARENA_WIRE_NAMES_SHARED_WITH_CANONICAL,
  accountedRawFields,
  applyMappingTable,
  validateMappingTable,
  canonicalEnvelopeFields,
  stableDigestJson,
  type MappingTable,
  type ProviderTimestampMs,
} from './index';
import {
  arenaCatalogPayload,
  arenaQuotePayload,
  arenaDeliveryPayload,
  fixtureRequest,
  fixtureQuote,
  fixtureEngagement,
  T0,
  FIXTURE_TENANT,
  FIXTURE_PROJECT,
} from './test-fixtures';

const request = fixtureRequest();
// The mirror mint: the SAME content-addressed quote the ARENA_QUOTE_TABLE
// translation mints from the wire quote payload (pinned below) — never a
// hand-cast placeholder id.
const quote = fixtureQuote(request);
const engagement = fixtureEngagement(request, quote, T0 + 2_500);

const context = { receiveAt: (T0 + 9_999) as ProviderTimestampMs, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT };

describe('the declared tables validate (the declaration discipline)', () => {
  it('all three tables are valid, frozen declarations', () => {
    expect(ARENA_MAPPING_TABLES.length).toBe(3);
    for (const table of ARENA_MAPPING_TABLES as readonly MappingTable[]) {
      const validation = validateMappingTable(table);
      expect(validation.ok).toBe(true);
      expect(Object.isFrozen(table)).toBe(true);
    }
  });

  it('one table per consumed channel, each producing its envelope kind', () => {
    expect(ARENA_CATALOG_TABLE.envelope_kind).toBe('declaration');
    expect(ARENA_QUOTE_TABLE.envelope_kind).toBe('quote');
    expect(ARENA_DELIVERY_TABLE.envelope_kind).toBe('deliverable');
    expect(ARENA_CHANNEL_TABLE_IDS.arenaCatalog).toBe(ARENA_CATALOG_TABLE.table_id);
    expect(ARENA_CHANNEL_TABLE_IDS.arenaQuotes).toBe(ARENA_QUOTE_TABLE.table_id);
    expect(ARENA_CHANNEL_TABLE_IDS.arenaDeliveries).toBe(ARENA_DELIVERY_TABLE.table_id);
  });

  it('the negative path: validateMappingTable rejects coverage gaps and double dispositions', () => {
    // A declaration table without the offers carry fails coverage.
    const missingOffers = validateMappingTable({ ...ARENA_CATALOG_TABLE, structured: [] });
    expect(missingOffers.ok).toBe(false);
    if (!missingOffers.ok) {
      expect(missingOffers.errors.some((error) => error.message.includes('"offers"'))).toBe(true);
    }
    // A raw field with two dispositions fails.
    const doubleField = validateMappingTable({
      ...ARENA_QUOTE_TABLE,
      fields: [...ARENA_QUOTE_TABLE.fields, { raw_field: 'requestRef', canonical_field: 'offerRef', transform: { kind: 'identity' } }],
    });
    expect(doubleField.ok).toBe(false);
    // A deliverable table must compute the payload digest.
    const noDigest = validateMappingTable({ ...ARENA_DELIVERY_TABLE, computed: [] });
    expect(noDigest.ok).toBe(false);
    if (!noDigest.ok) {
      expect(noDigest.errors.some((error) => error.message.includes('payloadDigest'))).toBe(true);
    }
  });
});

describe('the anti-silent-drop law (field accounting)', () => {
  it('every documented wire field is accounted for by each table', () => {
    const catalogFields = accountedRawFields(ARENA_CATALOG_TABLE);
    for (const field of ['providerName', 'offers', 'catalogRevision', 'publishedAtMs', 'messageKind', 'messageId']) {
      expect(catalogFields).toContain(field);
    }
    const quoteFields = accountedRawFields(ARENA_QUOTE_TABLE);
    for (const field of ['requestRef', 'offerRef', 'deliverableType', 'verificationEcho', 'counterTerms', 'estimatedDeliveryMs', 'respondedAtMs']) {
      expect(quoteFields).toContain(field);
    }
    const deliveryFields = accountedRawFields(ARENA_DELIVERY_TABLE);
    for (const field of ['engagementRef', 'deliverableType', 'claims', 'content', 'deliveredAtMs']) {
      expect(deliveryFields).toContain(field);
    }
  });

  it('the mapping refuses an UNACCOUNTED wire field (never a silent drop)', () => {
    const outcome = applyMappingTable(ARENA_CATALOG_TABLE, { ...arenaCatalogPayload(), extraVendorField: 'x' } as never, context);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.problems.some((problem) => problem.includes('unmapped_raw_field') && problem.includes('extraVendorField'))).toBe(true);
    }
  });

  it('the mapping refuses a missing required wire field', () => {
    const payload = arenaCatalogPayload() as Record<string, unknown>;
    delete payload.providerName;
    const outcome = applyMappingTable(ARENA_CATALOG_TABLE, payload as never, context);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.problems.some((problem) => problem.includes('mapped_field_missing') && problem.includes('providerName'))).toBe(true);
    }
  });
});

describe('the applied translation (the canonical T045 drafts)', () => {
  it('the catalog publication becomes the declaration draft (constants, enum maps, instant policy)', () => {
    const outcome = applyMappingTable(ARENA_CATALOG_TABLE, arenaCatalogPayload(), context);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const draft = outcome.draft;
    expect(draft.providerRef).toBe('arena');
    expect(draft.displayName).toBe('Arena Human Expertise Network');
    expect(draft.version).toBe(1);
    expect(draft.supersedes).toBeNull();
    expect(draft.declaredAt).toBe(T0);
    expect(draft.tenantId).toBe(FIXTURE_TENANT);
    expect(draft.projectId).toBe(FIXTURE_PROJECT);
    const offers = draft.offers as { offerRef: string; capabilityKey: string; deliverableKinds: string[]; verificationKinds: string[]; measuredEvidence: unknown[] }[];
    expect(offers.length).toBe(2);
    expect(offers[0]!.offerRef).toBe('offer-liquidity-regime-analysis');
    expect(offers[0]!.deliverableKinds).toEqual(['capability-artifact', 'expert-evidence']);
    expect(offers[0]!.verificationKinds).toEqual(['benchmark', 'measurement', 'local-evaluation']);
    expect(offers[0]!.measuredEvidence.length).toBe(2);
  });

  it('the quote response becomes the quote draft (the goalposts carried VERBATIM into terms.verification)', () => {
    const outcome = applyMappingTable(ARENA_QUOTE_TABLE, arenaQuotePayload(request), context);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const draft = outcome.draft;
    expect(draft.requestId).toBe(request.requestId);
    expect(draft.providerRef).toBe('arena');
    expect(draft.offerRef).toBe('offer-liquidity-regime-analysis');
    const terms = draft.terms as { deliverableKind: string; verification: unknown[]; consideration: { amount: number }; estimatedDeliveryAt: number };
    expect(terms.deliverableKind).toBe('capability-artifact');
    expect(terms.verification).toEqual([...request.verification]);
    expect(terms.consideration.amount).toBe(15_000);
    expect(terms.estimatedDeliveryAt).toBe(request.requestedAt + 43_200_000);
    expect(draft.quotedAt).toBe(request.requestedAt + 1_000);
  });

  it('the delivery becomes the deliverable draft (claims mapped; the digest COMPUTED over the content)', () => {
    const payload = arenaDeliveryPayload(fixtureEngagement(request, quote, T0 + 2_500));
    const outcome = applyMappingTable(ARENA_DELIVERY_TABLE, payload, context);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const draft = outcome.draft;
    expect(draft.engagementId).toBe(engagement.engagementId);
    expect(draft.kind).toBe('capability-artifact');
    const claims = draft.claims as { claimRef: string; capabilityKey: string }[];
    expect(claims[0]!.claimRef).toBe('claim-liquidity-model');
    expect(claims[0]!.capabilityKey).toBe('liquidity-regime-analysis');
    expect(draft.payloadDigest).toBe(stableDigestJson((payload as { content: unknown }).content));
    expect(draft.submittedAt).toBe(engagement.openedAt + 500);
  });

  it('the same payload + context always produce the same draft (byte-determinism)', () => {
    for (const table of [ARENA_CATALOG_TABLE, ARENA_QUOTE_TABLE, ARENA_DELIVERY_TABLE] as const) {
      const payload =
        table === ARENA_CATALOG_TABLE ? arenaCatalogPayload()
        : table === ARENA_QUOTE_TABLE ? arenaQuotePayload(request)
        : arenaDeliveryPayload(fixtureEngagement(request, quote, T0 + 2_500));
      const first = applyMappingTable(table, payload, context);
      const second = applyMappingTable(table, payload, context);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(JSON.stringify(first.draft)).toBe(JSON.stringify(second.draft));
      }
    }
  });

  it('the canonical vocabulary is exactly the T045 draft fields (never a wire name)', () => {
    // "offers", "offerRef", "summary" and "claims" are shared by the T045
    // canonical contracts themselves (the declared overlap — see
    // ARENA_WIRE_NAMES_SHARED_WITH_CANONICAL); every OTHER documented wire
    // field name must never name a canonical draft field.
    const shared = ARENA_WIRE_NAMES_SHARED_WITH_CANONICAL as readonly string[];
    for (const kind of ['declaration', 'quote', 'deliverable'] as const) {
      const vocabulary = canonicalEnvelopeFields(kind);
      const leaked = vocabulary.filter((field) => ARENA_WIRE_FIELD_NAMES.includes(field) && !shared.includes(field));
      expect(leaked).toEqual([]);
    }
  });
});
