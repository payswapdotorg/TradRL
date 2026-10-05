/**
 * @tradrl/adapter-arena — the documented wire schema guards (positive
 * and negative paths; the fixtures are the documented shapes, the
 * variants are the malformed ones — every failure is typed, never a
 * crash, never a silent drop).
 */

import { describe, expect, it } from 'vitest';

import {
  guardArenaCatalogPayload,
  guardArenaQuotePayload,
  guardArenaDeliveryPayload,
  arenaProtocolCodeOf,
  type JsonObject,
} from './index';
import {
  arenaCatalogPayload,
  arenaQuotePayload,
  arenaDeliveryPayload,
  fixtureRequest,
  fixtureQuote,
  fixtureEngagement,
  T0,
} from './test-fixtures';

const request = fixtureRequest();
const engagement = fixtureEngagement(request, fixtureQuote(request), T0 + 2_500);

describe('the arenaCatalog schema guard', () => {
  it('accepts the documented catalog publication', () => {
    const guarded = guardArenaCatalogPayload(arenaCatalogPayload());
    expect(guarded.ok).toBe(true);
    if (guarded.ok) {
      expect(guarded.value.offers.length).toBe(2);
      expect(guarded.value.catalogRevision).toBe(1);
    }
  });

  it('refuses an unknown messageKind discriminator (typed unknown_message_kind)', () => {
    const guarded = guardArenaCatalogPayload({ ...arenaCatalogPayload(), messageKind: 'ARENA_OTHER' } as JsonObject);
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(arenaProtocolCodeOf(guarded.error)).toBe('unknown_message_kind');
  });

  it('refuses an offer without measured evidence (L16a — the label-shaped claim)', () => {
    const payload = arenaCatalogPayload();
    (payload.offers as { evidence?: unknown }[])[0]!.evidence = [];
    const guarded = guardArenaCatalogPayload(payload);
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) {
      expect(arenaProtocolCodeOf(guarded.error)).toBe('malformed_payload');
      expect(guarded.error.message).toContain('offers[0].evidence');
    }
  });

  it('refuses an undocumented wire deliverable-type code', () => {
    const payload = arenaCatalogPayload();
    (payload.offers as { deliverableTypes?: unknown }[])[0]!.deliverableTypes = ['MYSTERY_KIND'];
    const guarded = guardArenaCatalogPayload(payload);
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(guarded.error.message).toContain('deliverableTypes');
  });

  it('refuses a malformed publication instant', () => {
    const guarded = guardArenaCatalogPayload({ ...arenaCatalogPayload(), publishedAtMs: -1 } as JsonObject);
    expect(guarded.ok).toBe(false);
  });
});

describe('the arenaQuotes schema guard', () => {
  it('accepts the documented quote response', () => {
    const guarded = guardArenaQuotePayload(arenaQuotePayload(request));
    expect(guarded.ok).toBe(true);
    if (guarded.ok) {
      expect(guarded.value.requestRef).toBe(request.requestId);
      expect(guarded.value.verificationEcho.length).toBe(3);
    }
  });

  it('refuses an unknown discriminator and malformed fields (typed failures)', () => {
    const wrongKind = guardArenaQuotePayload({ ...arenaQuotePayload(request), messageKind: 'ARENA_CATALOG' } as JsonObject);
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(arenaProtocolCodeOf(wrongKind.error)).toBe('unknown_message_kind');

    const malformed = guardArenaQuotePayload({ ...arenaQuotePayload(request), respondedAtMs: 'soon' } as unknown as JsonObject);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(arenaProtocolCodeOf(malformed.error)).toBe('malformed_payload');
  });

  it('accepts a null estimated delivery (no estimate) and refuses a bad requirement echo', () => {
    const noEstimate = guardArenaQuotePayload({ ...arenaQuotePayload(request), estimatedDeliveryMs: null } as JsonObject);
    expect(noEstimate.ok).toBe(true);

    const payload = arenaQuotePayload(request);
    (payload.verificationEcho as unknown[])[0] = { kind: 'nonsense' };
    const badEcho = guardArenaQuotePayload(payload);
    expect(badEcho.ok).toBe(false);
    if (!badEcho.ok) expect(badEcho.error.message).toContain('verificationEcho[0]');
  });
});

describe('the arenaDeliveries schema guard', () => {
  it('accepts the documented delivery submission', () => {
    const guarded = guardArenaDeliveryPayload(arenaDeliveryPayload(engagement));
    expect(guarded.ok).toBe(true);
    if (guarded.ok) {
      expect(guarded.value.engagementRef).toBe(engagement.engagementId);
      expect(guarded.value.claims.length).toBe(1);
    }
  });

  it('refuses a claim-less delivery and malformed content (typed failures)', () => {
    const noClaims = guardArenaDeliveryPayload({ ...arenaDeliveryPayload(engagement), claims: [] } as JsonObject);
    expect(noClaims.ok).toBe(false);
    if (!noClaims.ok) expect(noClaims.error.message).toContain('claims');

    const badContent = guardArenaDeliveryPayload({ ...arenaDeliveryPayload(engagement), content: undefined } as unknown as JsonObject);
    expect(badContent.ok).toBe(false);
  });

  it('refuses an undocumented wire deliverable-type code', () => {
    const guarded = guardArenaDeliveryPayload({ ...arenaDeliveryPayload(engagement), deliverableType: 'MYSTERY' } as JsonObject);
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(guarded.error.message).toContain('deliverableType');
  });
});
