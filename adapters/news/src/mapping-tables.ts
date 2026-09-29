/**
 * @tradrl/adapter-news — the declared mapping tables.
 *
 * Work Order T038: "mapping (publication time -> available time policy;
 * embargo semantics as DECLARED quartet policies)". One table per
 * channel; the family is exported as {@link NEWS_MAPPING_TABLES}.
 *
 * RAW FIELD PROVENANCE, per table:
 *   - "news-public-headline" (channel "publicHeadlines" -> news): the
 *     guard derives the emitter-facing payload { publisherCode,
 *     publishedTimeMs, headline, tickers }. `headline` and `tickers` map
 *     directly (the canonical news payload shares those field names);
 *     the documented publisher code is translated by the declared ENUM
 *     to the neutral editorial source label (publisher vocabulary lives
 *     in the enum map, never in the canonical event fields);
 *     `publishedTimeMs` is the declared event-time field. Source-time
 *     policy (L4, honest): event_time = the publication instant (the
 *     wire's own clock claim); availability at the receive time,
 *     CLAMPED to >= event_time — the declared "publication time ->
 *     available time" policy for the public tier (a host that polls
 *     late receives an honest quartet anchored at its own receive
 *     instant).
 *   - "news-licensed-wire-item" (channel "licensedWire" -> news): the
 *     guard derives { publisherCode, publishedTimeMs, headline, body?,
 *     tickers, tags?, url? } — the optional documented fields are
 *     omitted when absent. Same direct mappings plus the optional
 *     body/tags/url; same enum for the publisher code. Source-time
 *     policy: event_time = the publication instant; availability at the
 *     receive time (clamped). THE EMBARGO POLICY (../embargo.ts) rides
 *     on this table's channel: a record held pre-embargo is delivered
 *     at its lift instant, so its emitter-facing receive instant — and
 *     therefore its available_time — IS the lift instant, never before
 *     the embargo (L4). The guard-consumed fields (recordType, itemId,
 *     embargoTimeMs) never reach the emitter — accounted for by the
 *     schema checks, the dedup law and the embargo policy.
 *
 * Every table is validated (collect-all) and deep-frozen; the
 * unmapped-field law is enforced BOTH here (the guard's documented-schema
 * check) and in the emitter (raw accounting over the derived payload).
 */

import { validateMappingTable, type MappingTable, type MappingTableValidation } from './contract/mapping';

/** The channel -> table binding (the session's subscription targets). */
export const NEWS_CHANNEL_TABLE_IDS: Readonly<Record<string, string>> = {
  publicHeadlines: 'news-public-headline',
  licensedWire: 'news-licensed-wire-item',
};

function declareTable(value: unknown): MappingTable {
  const validation: MappingTableValidation = validateMappingTable(value);
  if (!validation.ok) {
    // Our own declaration — a validation failure is a programming error.
    throw new Error(`the news mapping table declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/**
 * The declared publisher code -> neutral editorial source label enum
 * (the documented wire publisher codes; the values are opaque neutral
 * labels — provider vocabulary lives in THIS map, never in the canonical
 * event fields).
 */
const PUBLISHER_ENUM: Readonly<Record<string, string>> = {
  'PUB-A': 'publisher-a',
  'PUB-B': 'publisher-b',
};

/** Channel "publicHeadlines" (documented public headline record) -> canonical news. */
export const NEWS_PUBLIC_HEADLINE_TABLE: MappingTable = declareTable({
  table_id: 'news-public-headline',
  event_type: 'news',
  fields: [
    { raw_field: 'headline', canonical_field: 'headline', transform: { kind: 'identity' } },
    { raw_field: 'tickers', canonical_field: 'symbols', transform: { kind: 'identity' } },
    { raw_field: 'publisherCode', canonical_field: 'source', transform: { kind: 'enum', map: PUBLISHER_ENUM } },
  ],
  constants: [],
  tolerated: [],
  source_time_policy: {
    event_time_basis: 'raw-field',
    event_time_field: 'publishedTimeMs',
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** Channel "licensedWire" (documented licensed wire item) -> canonical news. */
export const NEWS_LICENSED_WIRE_TABLE: MappingTable = declareTable({
  table_id: 'news-licensed-wire-item',
  event_type: 'news',
  fields: [
    { raw_field: 'headline', canonical_field: 'headline', transform: { kind: 'identity' } },
    { raw_field: 'tickers', canonical_field: 'symbols', transform: { kind: 'identity' } },
    { raw_field: 'publisherCode', canonical_field: 'source', transform: { kind: 'enum', map: PUBLISHER_ENUM } },
    { raw_field: 'body', canonical_field: 'body', transform: { kind: 'identity' }, required: false },
    { raw_field: 'tags', canonical_field: 'tags', transform: { kind: 'identity' }, required: false },
    { raw_field: 'url', canonical_field: 'url', transform: { kind: 'identity' }, required: false },
  ],
  constants: [],
  tolerated: [],
  source_time_policy: {
    event_time_basis: 'raw-field',
    event_time_field: 'publishedTimeMs',
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** The declared mapping table family (one per documented channel). */
export const NEWS_MAPPING_TABLES: readonly MappingTable[] = [
  NEWS_PUBLIC_HEADLINE_TABLE,
  NEWS_LICENSED_WIRE_TABLE,
];
