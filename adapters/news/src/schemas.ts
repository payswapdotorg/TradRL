/**
 * @tradrl/adapter-news — documented raw item schemas (the guard layer).
 *
 * PUBLIC DOCUMENTED SHAPES ONLY (Work Order T038 law: "schemas for
 * documented public news item shapes (headline, timestamp, symbols/
 * tickers tagging, publisher ref)"). The field names and forms below are
 * the documented public item shapes of the news wire's two channels:
 *
 *   - Public headline record (channel "publicHeadlines" — the public
 *     headline metadata tier): `{ recordType: "NEWS_ITEM", itemId,
 *     publisherCode, publishedTimeMs, headline, tickers }` — the
 *     documented PUBLIC shape only (headline metadata; no body, no
 *     embargo — those are licensed-wire fields).
 *   - Licensed wire item (channel "licensedWire" — the licensed full
 *     wire tier): `{ recordType: "NEWS_ITEM", itemId, publisherCode,
 *     publishedTimeMs, headline, body, tickers, tags, url,
 *     embargoTimeMs }` — body, tags, url and the embargo instant are
 *     documented OPTIONAL fields (a wire item may be headline-only; an
 *     item is embargoed only when the vendor declares a lift instant).
 *
 * NO licensed wire content is copied into this package's fixtures beyond
 * documented public metadata — every fixture headline, body and url is
 * synthetic, on opaque TEST-* tickers (spec/ADAPTERS.md Licensing: the
 * licensed wire tier is referenced by opaque entitlement refs, never
 * reproduced).
 *
 * Every guard is hand-rolled and total; no `any`. The guard layer's
 * dispositions (exactly the T037 discipline):
 *
 *   - an extra field the schema does not document  -> typed MappingError
 *     `unmapped_raw_field` (the anti-silent-drop law — never a silent drop;
 *     on the public channel this includes licensed-only fields);
 *   - a documented field of the wrong shape        -> typed protocol error
 *     `malformed_payload`;
 *   - a documented record-type discriminator with an
 *     undocumented value                          -> typed protocol error
 *     `unknown_message_type`.
 *
 * DERIVATION (deterministic, provider layer — L2): the guard translates
 * the documented forms into the representation the mapping tables
 * declare: recordType and itemId (guard-consumed — schema checks and the
 * item dedup law) and embargoTimeMs (consumed by the DECLARED embargo
 * quartet policy, ../embargo.ts) never reach the emitter; the remaining
 * documented fields pass through with their NAMES preserved (the mapping
 * table maps them; the publisher code is translated to the neutral
 * editorial source label by the mapping table's declared enum).
 */

import { failure, mappingError, success, type AdapterError, type SdkResult } from './contract/errors';
import { isNonEmptyString, isPositiveSafeInteger, isRecord } from './contract/fields';
import type { JsonObject, JsonValue } from './contract/json';
import { isTimestampMs, type TimestampMs } from './contract/timestamp';
import { newsProtocolError } from './protocol';

/**
 * The documented raw field names across the consumed wire channels — the
 * provider vocabulary. It lives ONLY in the adapter's declaration layers
 * (schemas, mapping tables, descriptors); the inverse-neutrality
 * trip-wire test asserts none of these names ever appears as a field of
 * an emitted CANONICAL event (L2: "a canonical event carrying a
 * provider-specific field name is a violation") — except the four names
 * the canonical news payload contract itself shares ("headline", "body",
 * "url", "tags" — the same overlap discipline as the book adapters'
 * "bids"/"asks").
 */
export const NEWS_RAW_FIELD_NAMES: readonly string[] = [
  'recordType',
  'itemId',
  'publisherCode',
  'publishedTimeMs',
  'headline',
  'body',
  'tickers',
  'tags',
  'url',
  'embargoTimeMs',
];

/** The documented record-type discriminator, per channel. */
const NEWS_ITEM_RECORD_TYPE = 'NEWS_ITEM';

/** The strict documented article URL shape: http(s). */
const URL_RE = /^https?:\/\//;

/** The validated public headline record (documented names, validated shapes). */
export interface NormalizedPublicHeadline {
  readonly recordType: 'NEWS_ITEM';
  readonly itemId: string;
  readonly publisherCode: string;
  readonly publishedTimeMs: TimestampMs;
  readonly headline: string;
  readonly tickers: readonly string[];
}

/** The validated licensed wire item (documented names, validated shapes). */
export interface NormalizedWireItem {
  readonly recordType: 'NEWS_ITEM';
  readonly itemId: string;
  readonly publisherCode: string;
  readonly publishedTimeMs: TimestampMs;
  readonly headline: string;
  /** Body text, when the item carries one (documented optional). */
  readonly body?: string;
  readonly tickers: readonly string[];
  /** Free-form topical tags, when carried (documented optional). */
  readonly tags?: readonly string[];
  /** Canonical article URL, when available (documented optional). */
  readonly url?: string;
  /** The declared embargo lift instant, when the item is embargoed (documented optional). */
  readonly embargoTimeMs?: TimestampMs;
}

function malformed(channel: string, detail: string): AdapterError {
  return newsProtocolError('malformed_payload', `channel "${channel}": ${detail}`);
}

function unknownMessageType(channel: string, documented: readonly string[], actual: string): AdapterError {
  return newsProtocolError(
    'unknown_message_type',
    `channel "${channel}": record type "${actual}" is not one of the documented types (${documented.join(' | ')}) — the adapter refuses undocumented record shapes`,
  );
}

function unmappedField(channel: string, field: string): AdapterError {
  return mappingError(
    'unmapped_raw_field',
    `raw field "${field}" on channel "${channel}" is not accounted for by the documented schema or the mapping table — map it, tolerate it explicitly, or fix the feed; silent drops are unrepresentable`,
  );
}

/** Assert the payload's keys are exactly a subset of the documented set (extras are unmapped fields). */
function rejectUndocumentedKeys(channel: string, payload: Record<string, unknown>, documented: readonly string[]): AdapterError | null {
  for (const key of Object.keys(payload).sort()) {
    if (!documented.includes(key)) {
      return unmappedField(channel, key);
    }
  }
  return null;
}

/** Require a documented field to be present. */
function requireField(channel: string, payload: Record<string, unknown>, field: string): AdapterError | null {
  if (payload[field] === undefined) {
    return malformed(channel, `the documented field "${field}" is missing`);
  }
  return null;
}

/** Validate a documented epoch-millisecond timestamp field. */
function guardTimestamp(channel: string, field: string, value: unknown): SdkResult<TimestampMs> {
  if (!isTimestampMs(value) || !isPositiveSafeInteger(value)) {
    return failure(malformed(channel, `field "${field}" must be a positive epoch-millisecond integer (got ${String(value)})`));
  }
  return success(value);
}

/** Validate a documented array-of-non-empty-strings field. */
function guardStringArray(channel: string, field: string, value: unknown): SdkResult<readonly string[]> {
  if (!Array.isArray(value)) {
    return failure(malformed(channel, `field "${field}" must be an array of strings`));
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!isNonEmptyString(value[index])) {
      return failure(malformed(channel, `field "${field}"[${index}] must be a non-empty string`));
    }
  }
  return success(value);
}

/** Validate the shared documented item core (recordType, ids, headline, tickers). */
function guardItemCore(
  channel: string,
  record: Record<string, unknown>,
): SdkResult<{ itemId: string; publisherCode: string; publishedTimeMs: TimestampMs; headline: string; tickers: readonly string[] }> {
  if (record.recordType !== NEWS_ITEM_RECORD_TYPE) {
    return failure(unknownMessageType(channel, [NEWS_ITEM_RECORD_TYPE], String(record.recordType)));
  }
  if (!isNonEmptyString(record.itemId)) {
    return failure(malformed(channel, 'field "itemId" must be a non-empty item identifier'));
  }
  if (!isNonEmptyString(record.publisherCode)) {
    return failure(malformed(channel, 'field "publisherCode" must be a non-empty publisher code'));
  }
  const publishedTimeMs = guardTimestamp(channel, 'publishedTimeMs', record.publishedTimeMs);
  if (!publishedTimeMs.ok) return publishedTimeMs;
  if (!isNonEmptyString(record.headline)) {
    return failure(malformed(channel, 'field "headline" must be a non-empty headline string'));
  }
  const tickers = guardStringArray(channel, 'tickers', record.tickers);
  if (!tickers.ok) return tickers;
  return success({
    itemId: record.itemId,
    publisherCode: record.publisherCode,
    publishedTimeMs: publishedTimeMs.value,
    headline: record.headline,
    tickers: tickers.value,
  });
}

// ---------------------------------------------------------------------------
// Channel schemas: documented raw item -> validated, normalized item.
// ---------------------------------------------------------------------------

/** The documented public headline fields (channel "publicHeadlines"). */
const PUBLIC_HEADLINE_FIELDS: readonly string[] = [
  'recordType',
  'itemId',
  'publisherCode',
  'publishedTimeMs',
  'headline',
  'tickers',
];

/**
 * Channel "publicHeadlines" — the documented public headline metadata
 * record: the PUBLIC shape only. A licensed-wire-only field (body, tags,
 * url, embargoTimeMs) on this channel is an UNMAPPED field — the public
 * tier does not carry licensed content (typed MappingError, never a
 * silent drop).
 */
export function guardPublicHeadlinePayload(payload: JsonObject): SdkResult<NormalizedPublicHeadline> {
  const channel = 'publicHeadlines';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, PUBLIC_HEADLINE_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of PUBLIC_HEADLINE_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  const core = guardItemCore(channel, record);
  if (!core.ok) return core;

  return success({
    recordType: NEWS_ITEM_RECORD_TYPE,
    itemId: core.value.itemId,
    publisherCode: core.value.publisherCode,
    publishedTimeMs: core.value.publishedTimeMs,
    headline: core.value.headline,
    tickers: core.value.tickers,
  });
}

/** The documented licensed wire item fields (channel "licensedWire"). */
const WIRE_ITEM_FIELDS: readonly string[] = [
  'recordType',
  'itemId',
  'publisherCode',
  'publishedTimeMs',
  'headline',
  'body',
  'tickers',
  'tags',
  'url',
  'embargoTimeMs',
];

/** The documented optional wire item fields. */
const WIRE_OPTIONAL_FIELDS: readonly string[] = ['body', 'tags', 'url', 'embargoTimeMs'];

/**
 * Channel "licensedWire" — the documented licensed full wire item. The
 * body, tags, url and embargo instant are documented OPTIONAL fields:
 * present -> validated shape; absent -> the item simply does not carry
 * them. The embargo instant may legitimately lie in the past (an item
 * whose embargo already lifted — delivered and emitted immediately).
 */
export function guardWireItemPayload(payload: JsonObject): SdkResult<NormalizedWireItem> {
  const channel = 'licensedWire';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, WIRE_ITEM_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of WIRE_ITEM_FIELDS) {
    if (WIRE_OPTIONAL_FIELDS.includes(field)) continue; // optional: validated below when present
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  const core = guardItemCore(channel, record);
  if (!core.ok) return core;

  let body: string | undefined;
  if (record.body !== undefined) {
    if (!isNonEmptyString(record.body)) {
      return failure(malformed(channel, `field "body" must be a non-empty body string when present (got ${String(record.body)})`));
    }
    body = record.body;
  }
  let tags: readonly string[] | undefined;
  if (record.tags !== undefined) {
    const tagsResult = guardStringArray(channel, 'tags', record.tags);
    if (!tagsResult.ok) return tagsResult;
    tags = tagsResult.value;
  }
  let url: string | undefined;
  if (record.url !== undefined) {
    if (typeof record.url !== 'string' || !URL_RE.test(record.url)) {
      return failure(malformed(channel, `field "url" must be an http(s) URL string when present (got ${String(record.url)})`));
    }
    url = record.url;
  }
  let embargoTimeMs: TimestampMs | undefined;
  if (record.embargoTimeMs !== undefined) {
    const embargo = guardTimestamp(channel, 'embargoTimeMs', record.embargoTimeMs);
    if (!embargo.ok) return embargo;
    embargoTimeMs = embargo.value;
  }

  const item: NormalizedWireItem = {
    recordType: NEWS_ITEM_RECORD_TYPE,
    itemId: core.value.itemId,
    publisherCode: core.value.publisherCode,
    publishedTimeMs: core.value.publishedTimeMs,
    headline: core.value.headline,
    tickers: core.value.tickers,
    body,
    tags,
    url,
    embargoTimeMs,
  };

  return success(item);
}

// ---------------------------------------------------------------------------
// Derivations: validated items -> emitter-facing payloads (the mapping
// tables' declared representation). Deterministic; FIXED key order;
// optional fields are OMITTED when absent (never undefined-valued — the
// payload is a closed JSON object).
// ---------------------------------------------------------------------------

/**
 * Derive the emitter-facing payload of a public headline item: the
 * documented fields the mapping table consumes (publisher code,
 * publication instant, headline, tickers). The guard-consumed fields
 * (recordType, itemId) never reach the emitter — they were consumed by
 * the schema checks and the guard's dedup law.
 */
export function derivePublicHeadlinePayload(item: NormalizedPublicHeadline): JsonObject {
  return {
    publisherCode: item.publisherCode,
    publishedTimeMs: item.publishedTimeMs,
    headline: item.headline,
    tickers: item.tickers as unknown as JsonValue,
  };
}

/**
 * Derive the emitter-facing payload of a licensed wire item: the
 * documented fields the mapping table consumes (publisher code,
 * publication instant, headline, tickers, and the optional body, tags,
 * url). The guard-consumed fields (recordType, itemId, embargoTimeMs)
 * never reach the emitter — recordType and itemId were consumed by the
 * schema checks and the dedup law, and the embargo instant by the
 * DECLARED embargo quartet policy (../embargo.ts), which re-stamps the
 * emitter-facing receive instant of a held item to its lift instant.
 */
export function deriveWireItemPayload(item: NormalizedWireItem): JsonObject {
  const payload: Record<string, JsonValue> = {
    publisherCode: item.publisherCode,
    publishedTimeMs: item.publishedTimeMs,
    headline: item.headline,
    tickers: item.tickers as unknown as JsonValue,
  };
  if (item.body !== undefined) payload.body = item.body;
  if (item.tags !== undefined) payload.tags = item.tags as unknown as JsonValue;
  if (item.url !== undefined) payload.url = item.url;
  return payload as JsonObject;
}

/**
 * Guard and validate the payload of a message on one of the adapter's
 * documented channels. Channels WITHOUT a documented schema pass through
 * verbatim — the session's routing (unknown_channel) owns unsubscribed
 * channels.
 */
export function guardNewsPayload(channel: string, payload: JsonObject): SdkResult<JsonObject> {
  if (channel === 'publicHeadlines') {
    const item = guardPublicHeadlinePayload(payload);
    if (!item.ok) return item;
    return success(derivePublicHeadlinePayload(item.value));
  }
  if (channel === 'licensedWire') {
    const item = guardWireItemPayload(payload);
    if (!item.ok) return item;
    return success(deriveWireItemPayload(item.value));
  }
  return success(payload);
}

/** Structural guard for the validated public headline record (introspection). */
export function isNormalizedPublicHeadline(value: unknown): value is NormalizedPublicHeadline {
  return (
    isRecord(value) &&
    value.recordType === NEWS_ITEM_RECORD_TYPE &&
    isNonEmptyString(value.itemId) &&
    isNonEmptyString(value.publisherCode) &&
    isTimestampMs(value.publishedTimeMs) &&
    isNonEmptyString(value.headline) &&
    Array.isArray(value.tickers)
  );
}

/** Structural guard for the validated licensed wire item (introspection). */
export function isNormalizedWireItem(value: unknown): value is NormalizedWireItem {
  return (
    isRecord(value) &&
    value.recordType === NEWS_ITEM_RECORD_TYPE &&
    isNonEmptyString(value.itemId) &&
    isNonEmptyString(value.publisherCode) &&
    isTimestampMs(value.publishedTimeMs) &&
    isNonEmptyString(value.headline) &&
    Array.isArray(value.tickers)
  );
}
