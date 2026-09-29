/**
 * @tradrl/adapter-brokers — the declared mapping tables.
 *
 * Work Order T039 (following the T037/T038 discipline): "the mapping
 * table — every consumed raw field -> canonical field with the
 * source-time policy; unknown raw field = MappingError (never silently
 * dropped)". One table per inbound channel (the session binds each
 * channel's messages to exactly one table); the family is exported as
 * {@link BROKER_MAPPING_TABLES}.
 *
 * RAW FIELD PROVENANCE, "broker-execution-report" (channel
 * "executionReport" -> other, kind "execution_report"): the guard
 * (../schemas.ts) validates the documented ExecutionReport fields and
 * derives the emitter-facing escape-hatch form `{ data: {...},
 * transactTimeMs }` — every key inside `data` is CANONICAL vocabulary
 * (order_id, client_order_id, exec_id, exec_type, order_status, side,
 * order_qty, last_qty, last_px, cum_qty, leaves_qty, avg_px). `data` maps
 * to the canonical `data` field (identity — the guard already
 * restructured it); the kind is the declared constant
 * "execution_report"; `transactTimeMs` is the declared event-time field.
 * The guard-consumed documented fields (MsgType, Symbol, TransactTime's
 * documented UTCTimestamp form) never reach the emitter — accounted for
 * by the guard's schema checks, never silently dropped.
 *
 * Source-time policy (L4, honest): event_time = the report's documented
 * TransactTime, converted to epoch milliseconds deterministically (the
 * gateway's own clock claim for the execution); availability at the
 * receive time of the adapter's session, CLAMPED to >= event_time
 * (gateway clock skew is clamped, never trusted); source_time is null —
 * the documented ExecutionReport carries exactly one time field, and
 * claiming a second "vendor claim" from the same field would be
 * dishonest bookkeeping.
 *
 * Every table is validated (collect-all) and deep-frozen; the
 * unmapped-field law is enforced BOTH here (the guard's documented-schema
 * check) and in the emitter (raw accounting over the derived payload).
 */

import { validateMappingTable, type MappingTable, type MappingTableValidation } from './contract/mapping';

/** The channel -> table binding (the session's subscription targets). */
export const BROKER_CHANNEL_TABLE_IDS: Readonly<Record<string, string>> = {
  executionReport: 'broker-execution-report',
};

function declareTable(value: unknown): MappingTable {
  const validation: MappingTableValidation = validateMappingTable(value);
  if (!validation.ok) {
    // Our own declaration — a validation failure is a programming error.
    throw new Error(`the broker mapping table declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** Channel "executionReport" (guard-derived escape-hatch form) -> canonical other (kind "execution_report"). */
export const BROKER_EXECUTION_REPORT_TABLE: MappingTable = declareTable({
  table_id: 'broker-execution-report',
  event_type: 'other',
  fields: [
    { raw_field: 'data', canonical_field: 'data', transform: { kind: 'identity' } },
  ],
  constants: [
    { canonical_field: 'kind', value: 'execution_report' },
  ],
  tolerated: [],
  source_time_policy: {
    event_time_basis: 'raw-field',
    event_time_field: 'transactTimeMs',
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** The declared mapping table family (one per documented inbound channel). */
export const BROKER_MAPPING_TABLES: readonly MappingTable[] = [
  BROKER_EXECUTION_REPORT_TABLE,
];
