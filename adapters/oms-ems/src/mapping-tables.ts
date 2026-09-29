/**
 * @tradrl/adapter-oms-ems — the declared mapping tables.
 *
 * Work Order T039 (following the T037/T038 discipline): "the mapping
 * table — every consumed raw field -> canonical field with the
 * source-time policy; unknown raw field = MappingError (never silently
 * dropped)". One table per inbound channel (the session binds each
 * channel's messages to exactly one table); the family is exported as
 * {@link OMS_EMS_MAPPING_TABLES}.
 *
 * RAW FIELD PROVENANCE, "oms-ems-order-state" (channel "orderState" ->
 * other, kind "order_state"): the guard (../schemas.ts) validates the
 * documented ORDER_STATE fields and derives the emitter-facing
 * escape-hatch form `{ data: {...}, updatedAtMs }` — every key inside
 * `data` is CANONICAL vocabulary (order_id, client_order_id, status,
 * venue, order_qty, filled_qty, leaves_qty, avg_px, last_qty, last_px).
 * `data` maps to the canonical `data` field (identity — the guard
 * already restructured it); the kind is the declared constant
 * "order_state"; `updatedAtMs` is the declared event-time field. The
 * guard-consumed documented fields (recordType, sequence, updatedAt's
 * documented ISO form) never reach the emitter — accounted for by the
 * guard's schema checks (and its per-order sequencing law), never
 * silently dropped.
 *
 * Source-time policy (L4, honest): event_time = the record's documented
 * updatedAt, converted to epoch milliseconds deterministically (the
 * OMS's own clock claim for the state change); availability at the
 * receive time of the adapter's session, CLAMPED to >= event_time (OMS
 * clock skew is clamped, never trusted); source_time is null — the
 * documented ORDER_STATE record carries exactly one time field, and
 * claiming a second "vendor claim" from the same field would be
 * dishonest bookkeeping.
 *
 * Every table is validated (collect-all) and deep-frozen; the
 * unmapped-field law is enforced BOTH here (the guard's documented-schema
 * check) and in the emitter (raw accounting over the derived payload).
 */

import { validateMappingTable, type MappingTable, type MappingTableValidation } from './contract/mapping';

/** The channel -> table binding (the session's subscription targets). */
export const OMS_EMS_CHANNEL_TABLE_IDS: Readonly<Record<string, string>> = {
  orderState: 'oms-ems-order-state',
};

function declareTable(value: unknown): MappingTable {
  const validation: MappingTableValidation = validateMappingTable(value);
  if (!validation.ok) {
    // Our own declaration — a validation failure is a programming error.
    throw new Error(`the OMS/EMS mapping table declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** Channel "orderState" (guard-derived escape-hatch form) -> canonical other (kind "order_state"). */
export const OMS_EMS_ORDER_STATE_TABLE: MappingTable = declareTable({
  table_id: 'oms-ems-order-state',
  event_type: 'other',
  fields: [
    { raw_field: 'data', canonical_field: 'data', transform: { kind: 'identity' } },
  ],
  constants: [
    { canonical_field: 'kind', value: 'order_state' },
  ],
  tolerated: [],
  source_time_policy: {
    event_time_basis: 'raw-field',
    event_time_field: 'updatedAtMs',
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** The declared mapping table family (one per documented inbound channel). */
export const OMS_EMS_MAPPING_TABLES: readonly MappingTable[] = [
  OMS_EMS_ORDER_STATE_TABLE,
];
