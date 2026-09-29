/**
 * @tradrl/adapter-news — the documented item schema tests.
 *
 * Behavioral: every channel's documented shape validated; the negative
 * dispositions (unmapped raw field -> MappingError — including
 * licensed-only fields on the public channel, malformed documented field
 * -> protocol error, unknown record type -> protocol error); the
 * documented optional-field semantics; and the derivations into the
 * emitter-facing representation (guard-consumed fields dropped,
 * optional fields omitted when absent).
 */

import { describe, expect, it } from 'vitest';

import {
  guardPublicHeadlinePayload,
  guardWireItemPayload,
  guardNewsPayload,
  derivePublicHeadlinePayload,
  deriveWireItemPayload,
  isNormalizedPublicHeadline,
  isNormalizedWireItem,
  newsProtocolCodeOf,
  type JsonObject,
  type SdkResult,
} from './index';

const AT0 = 1_717_423_200_000;

const publicHeadline = (overrides: Record<string, unknown> = {}): JsonObject =>
  ({
    recordType: 'NEWS_ITEM',
    itemId: 'WIRE-ITEM-0001',
    publisherCode: 'PUB-A',
    publishedTimeMs: AT0,
    headline: 'Synthetic test headline one',
    tickers: ['TEST-AAA'],
    ...overrides,
  }) as JsonObject;

const wireItem = (overrides: Record<string, unknown> = {}): JsonObject =>
  ({
    recordType: 'NEWS_ITEM',
    itemId: 'WIRE-ITEM-0002',
    publisherCode: 'PUB-B',
    publishedTimeMs: AT0,
    headline: 'Synthetic test headline two',
    body: 'Synthetic wire body.',
    tickers: ['TEST-AAA', 'TEST-BBB'],
    tags: ['TEST-TAG-EARNINGS'],
    url: 'https://example.invalid/item/2',
    embargoTimeMs: AT0 + 5_000,
    ...overrides,
  }) as JsonObject;

function expectFailure(result: SdkResult<unknown>, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
}

describe('channel "publicHeadlines" — the documented public headline record', () => {
  it('validates the documented public shape into a normalized record', () => {
    const result = guardPublicHeadlinePayload(publicHeadline());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.recordType).toBe('NEWS_ITEM');
      expect(result.value.itemId).toBe('WIRE-ITEM-0001');
      expect(result.value.publisherCode).toBe('PUB-A');
      expect(result.value.publishedTimeMs).toBe(AT0);
      expect(result.value.headline).toBe('Synthetic test headline one');
      expect([...result.value.tickers]).toEqual(['TEST-AAA']);
      expect(isNormalizedPublicHeadline(result.value)).toBe(true);
    }
  });

  it('a licensed-only field on the public channel is a typed unmapped_raw_field (the public tier carries no licensed content)', () => {
    for (const licensedField of [wireItem().body, wireItem().tags, wireItem().url, wireItem().embargoTimeMs]) {
      void licensedField;
    }
    const withBody = guardPublicHeadlinePayload(publicHeadline({ body: 'licensed content' }));
    expectFailure(withBody, 'unmapped_raw_field');
    if (!withBody.ok) expect(withBody.error.message).toContain('body');
    expectFailure(guardPublicHeadlinePayload(publicHeadline({ embargoTimeMs: AT0 })), 'unmapped_raw_field');
    expectFailure(guardPublicHeadlinePayload(publicHeadline({ url: 'https://example.invalid/x' })), 'unmapped_raw_field');
    expectFailure(guardPublicHeadlinePayload(publicHeadline({ tags: ['T'] })), 'unmapped_raw_field');
  });

  it('an extra unknown field is a typed unmapped_raw_field; a missing documented field is malformed', () => {
    expectFailure(guardPublicHeadlinePayload(publicHeadline({ vendor_extra: 1 })), 'unmapped_raw_field');
    const missing = { ...publicHeadline() } as Record<string, unknown>;
    delete missing.headline;
    expectFailure(guardPublicHeadlinePayload(missing as JsonObject), 'malformed_payload');
  });

  it('documented shape laws: non-empty headline, ticker array, publication timestamp', () => {
    expectFailure(guardPublicHeadlinePayload(publicHeadline({ headline: '' })), 'malformed_payload');
    expectFailure(guardPublicHeadlinePayload(publicHeadline({ tickers: 'TEST-AAA' })), 'malformed_payload');
    expectFailure(guardPublicHeadlinePayload(publicHeadline({ tickers: [''] })), 'malformed_payload');
    expectFailure(guardPublicHeadlinePayload(publicHeadline({ publishedTimeMs: 0 })), 'malformed_payload');
    expectFailure(guardPublicHeadlinePayload(publicHeadline({ publishedTimeMs: -1 })), 'malformed_payload');
    expectFailure(guardPublicHeadlinePayload(publicHeadline({ publisherCode: '' })), 'malformed_payload');
    expectFailure(guardPublicHeadlinePayload(publicHeadline({ itemId: '' })), 'malformed_payload');
  });

  it('an undocumented record type discriminator is a typed unknown_message_type', () => {
    const result = guardPublicHeadlinePayload(publicHeadline({ recordType: 'CORRECTION' }));
    expectFailure(result, 'unknown_message_type');
    if (!result.ok) {
      expect(newsProtocolCodeOf(result.error)).toBe('unknown_message_type');
      expect(result.error.message).toContain('CORRECTION');
    }
  });
});

describe('channel "licensedWire" — the documented licensed wire item', () => {
  it('validates the full documented shape into a normalized record (embargo included)', () => {
    const result = guardWireItemPayload(wireItem());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.itemId).toBe('WIRE-ITEM-0002');
      expect(result.value.body).toBe('Synthetic wire body.');
      expect([...(result.value.tags ?? [])]).toEqual(['TEST-TAG-EARNINGS']);
      expect(result.value.url).toBe('https://example.invalid/item/2');
      expect(result.value.embargoTimeMs).toBe(AT0 + 5_000);
      expect(isNormalizedWireItem(result.value)).toBe(true);
    }
  });

  it('the documented optional fields are optional: a headline-only wire item validates', () => {
    const headlineOnly = {
      recordType: 'NEWS_ITEM',
      itemId: 'WIRE-ITEM-BARE',
      publisherCode: 'PUB-A',
      publishedTimeMs: AT0,
      headline: 'Synthetic bare headline',
      tickers: ['TEST-AAA'],
    };
    const result = guardWireItemPayload(headlineOnly);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.body).toBeUndefined();
      expect(result.value.tags).toBeUndefined();
      expect(result.value.url).toBeUndefined();
      expect(result.value.embargoTimeMs).toBeUndefined();
    }
  });

  it('an optional field present with a bad shape is a typed malformed_payload', () => {
    expectFailure(guardWireItemPayload(wireItem({ body: '' })), 'malformed_payload');
    expectFailure(guardWireItemPayload(wireItem({ tags: 'not-an-array' })), 'malformed_payload');
    expectFailure(guardWireItemPayload(wireItem({ tags: [''] })), 'malformed_payload');
    expectFailure(guardWireItemPayload(wireItem({ url: 'ftp://example.invalid/x' })), 'malformed_payload');
    expectFailure(guardWireItemPayload(wireItem({ url: 'not-a-url' })), 'malformed_payload');
    expectFailure(guardWireItemPayload(wireItem({ embargoTimeMs: 0 })), 'malformed_payload');
    expectFailure(guardWireItemPayload(wireItem({ embargoTimeMs: 'soon' })), 'malformed_payload');
  });

  it('a past-dated embargo instant is legitimate shape-wise (already lifted at receipt — the guard policy decides)', () => {
    const result = guardWireItemPayload(wireItem({ embargoTimeMs: AT0 - 60_000 }));
    expect(result.ok).toBe(true);
  });

  it('an extra field is a typed unmapped_raw_field; an unknown record type is typed', () => {
    expectFailure(guardWireItemPayload(wireItem({ vendor_extra: 'x' })), 'unmapped_raw_field');
    expectFailure(guardWireItemPayload(wireItem({ recordType: 'ADVISORY' })), 'unknown_message_type');
  });
});

describe('the derivations into the emitter-facing representation', () => {
  it('derivePublicHeadlinePayload drops the guard-consumed fields (recordType, itemId)', () => {
    const guarded = guardPublicHeadlinePayload(publicHeadline());
    if (!guarded.ok) throw new Error('must guard');
    const payload = derivePublicHeadlinePayload(guarded.value) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['headline', 'publishedTimeMs', 'publisherCode', 'tickers']);
  });

  it('deriveWireItemPayload drops the guard-consumed fields and omits absent optionals', () => {
    const guarded = guardWireItemPayload(wireItem());
    if (!guarded.ok) throw new Error('must guard');
    const payload = deriveWireItemPayload(guarded.value) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'body', 'headline', 'publishedTimeMs', 'publisherCode', 'tags', 'tickers', 'url',
    ]);
    // recordType, itemId and embargoTimeMs are guard-consumed (dedup + the
    // declared embargo quartet policy) — never emitter-facing.
    expect(payload).not.toHaveProperty('recordType');
    expect(payload).not.toHaveProperty('itemId');
    expect(payload).not.toHaveProperty('embargoTimeMs');

    const { body: _b, tags: _t, url: _u, embargoTimeMs: _e, ...headlineOnly } = wireItem() as Record<string, unknown>;
    const bareGuarded = guardWireItemPayload(headlineOnly as JsonObject);
    if (!bareGuarded.ok) throw new Error('must guard');
    const barePayload = deriveWireItemPayload(bareGuarded.value) as Record<string, unknown>;
    expect(Object.keys(barePayload).sort()).toEqual(['headline', 'publishedTimeMs', 'publisherCode', 'tickers']);
  });
});

describe('guardNewsPayload routing', () => {
  it('routes each documented channel to its schema guard and derivation', () => {
    expect(guardNewsPayload('publicHeadlines', publicHeadline()).ok).toBe(true);
    expect(guardNewsPayload('licensedWire', wireItem()).ok).toBe(true);
    expectFailure(guardNewsPayload('licensedWire', wireItem({ recordType: 'NOPE' })), 'unknown_message_type');
  });

  it('channels without a documented schema pass through verbatim (the session owns routing)', () => {
    const payload: JsonObject = { anything: 'goes' } as JsonObject;
    const result = guardNewsPayload('someOtherChannel', payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(payload);
  });
});
