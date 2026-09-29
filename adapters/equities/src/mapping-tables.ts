/**
 * @tradrl/adapter-equities — the declared mapping tables.
 *
 * Work Order T038: "mapping table with the source-time policy (index
 * dissemination time vs receive session, calendar/session semantics
 * declared)". One table per channel (the session binds each channel's
 * messages to exactly one table); the family is exported as
 * {@link EQUITIES_MAPPING_TABLES}.
 *
 * RAW FIELD PROVENANCE, per table:
 *   - "equities-index-level" (channel "indexLevel" -> fundamental): the
 *     guard derives the emitter-facing payload { tradeDate,
 *     disseminationTimeMs, indexLevel, indexDivisor }. `tradeDate` maps
 *     to the canonical reporting period; `indexLevel` (decimal-string)
 *     maps to the reported value; the documented divisor is DECLARED
 *     tolerated — the fundamental contract has no divisor field and the
 *     drop is auditable, never silent; `disseminationTimeMs` is the
 *     declared event-time field. The guard-consumed documented fields
 *     (recordType, indexId, sequenceNumber) never reach the emitter —
 *     accounted for by the guard's schema checks and its sequencing law.
 *     Source-time policy (L4, honest): event_time = the index
 *     dissemination instant (the vendor's own clock claim for the
 *     level); availability at the receive time of the adapter's session,
 *     CLAMPED to >= event_time (vendor clock skew is clamped, never
 *     trusted) — the declared "dissemination time vs receive session"
 *     policy.
 *   - "equities-constituent-weight" (channel "constituentWeights" ->
 *     other): the guard derives the canonical escape-hatch form
 *     { data: { symbol, weight, share_class }, disseminationTimeMs } —
 *     every key inside `data` is canonical vocabulary. `data` maps to
 *     the canonical `data` field (identity — the guard already
 *     restructured it); the kind is the declared constant
 *     "index_constituent_weight". Same source-time policy as index
 *     levels (dissemination instant -> receive-session availability).
 *   - "equities-corporate-action" (channel "corporateActions" -> other):
 *     the guard derives { data: { symbol, action, effective_date,
 *     ratio, currency }, announcementTimeMs } with the declared kind
 *     "corporate_action". Source-time policy: event_time = the
 *     announcement instant (the corporate-action event is the
 *     announcement, not the effective date — the effective date rides
 *     in the payload); availability at the receive time (clamped).
 *
 * Every table is validated (collect-all) and deep-frozen; the
 * unmapped-field law is enforced BOTH here (the guard's documented-schema
 * check) and in the emitter (raw accounting over the derived payload).
 */

import { validateMappingTable, type MappingTable, type MappingTableValidation } from './contract/mapping';

/** The channel -> table binding (the session's subscription targets). */
export const EQUITIES_CHANNEL_TABLE_IDS: Readonly<Record<string, string>> = {
  indexLevel: 'equities-index-level',
  constituentWeights: 'equities-constituent-weight',
  corporateActions: 'equities-corporate-action',
};

function declareTable(value: unknown): MappingTable {
  const validation: MappingTableValidation = validateMappingTable(value);
  if (!validation.ok) {
    // Our own declaration — a validation failure is a programming error.
    throw new Error(`the equities mapping table declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** Channel "indexLevel" (documented index level record) -> canonical fundamental. */
export const EQUITIES_INDEX_LEVEL_TABLE: MappingTable = declareTable({
  table_id: 'equities-index-level',
  event_type: 'fundamental',
  fields: [
    { raw_field: 'tradeDate', canonical_field: 'period', transform: { kind: 'identity' } },
    { raw_field: 'indexLevel', canonical_field: 'value', transform: { kind: 'decimal-string' } },
  ],
  constants: [
    { canonical_field: 'field', value: 'INDEX_LEVEL' },
    { canonical_field: 'unit', value: 'index-points' },
    { canonical_field: 'source', value: 'index-dissemination' },
  ],
  tolerated: ['indexDivisor'],
  source_time_policy: {
    event_time_basis: 'raw-field',
    event_time_field: 'disseminationTimeMs',
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** Channel "constituentWeights" (guard-derived escape-hatch form) -> canonical other. */
export const EQUITIES_CONSTITUENT_WEIGHT_TABLE: MappingTable = declareTable({
  table_id: 'equities-constituent-weight',
  event_type: 'other',
  fields: [
    { raw_field: 'data', canonical_field: 'data', transform: { kind: 'identity' } },
  ],
  constants: [
    { canonical_field: 'kind', value: 'index_constituent_weight' },
  ],
  tolerated: [],
  source_time_policy: {
    event_time_basis: 'raw-field',
    event_time_field: 'disseminationTimeMs',
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** Channel "corporateActions" (guard-derived escape-hatch form) -> canonical other. */
export const EQUITIES_CORPORATE_ACTION_TABLE: MappingTable = declareTable({
  table_id: 'equities-corporate-action',
  event_type: 'other',
  fields: [
    { raw_field: 'data', canonical_field: 'data', transform: { kind: 'identity' } },
  ],
  constants: [
    { canonical_field: 'kind', value: 'corporate_action' },
  ],
  tolerated: [],
  source_time_policy: {
    event_time_basis: 'raw-field',
    event_time_field: 'announcementTimeMs',
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** The declared mapping table family (one per documented channel). */
export const EQUITIES_MAPPING_TABLES: readonly MappingTable[] = [
  EQUITIES_INDEX_LEVEL_TABLE,
  EQUITIES_CONSTITUENT_WEIGHT_TABLE,
  EQUITIES_CORPORATE_ACTION_TABLE,
];
