/**
 * @tradrl/adapter-equities — documented raw record schemas (the guard layer).
 *
 * PUBLIC DOCUMENTED SHAPES ONLY (Work Order T038 law: "raw payload schemas
 * for the documented PUBLIC shapes of licensed index/equity feeds ...
 * model the licensing boundary: licensed content is referenced by opaque
 * entitlement refs and NEVER embedded in test fixtures beyond documented
 * public metadata"). The field names and forms below are the documented
 * public record shapes of the licensed index feed; every VALUE in this
 * package's fixtures is synthetic (opaque TEST-* identifiers, synthetic
 * levels/weights) — licensed index content is never copied (spec/
 * ADAPTERS.md Licensing).
 *
 *   - Index level record (channel "indexLevel"):
 *     `{ recordType: "INDEX_LEVEL", indexId, tradeDate,
 *     disseminationTimeMs, indexLevel, indexDivisor, sequenceNumber }` —
 *     the level and divisor are decimal strings; the dissemination
 *     instant is epoch milliseconds; sequenceNumber is the feed's
 *     per-index record sequence.
 *   - Constituent weight record (channel "constituentWeights"):
 *     `{ recordType: "CONSTITUENT_WEIGHT", indexId, tradeDate,
 *     disseminationTimeMs, constituentSymbol, constituentWeight,
 *     shareClassCode, sequenceNumber }` — the weight is a decimal string
 *     in [0, 1]; the share class code is one of the documented set.
 *   - Corporate action record (channel "corporateActions"):
 *     `{ recordType: "CORPORATE_ACTION", actionId, corporateSymbol,
 *     actionTypeCode, effectiveDate, announcementTimeMs, actionRatio,
 *     currencyCode }` — the action ratio is the documented "N:M" form.
 *
 * NO licensed or proprietary payloads are consumed or copied
 * (spec/ADAPTERS.md Licensing). Every guard is hand-rolled and total; no
 * `any`. The guard layer's dispositions (exactly the T037 discipline):
 *
 *   - an extra field the schema does not document  -> typed MappingError
 *     `unmapped_raw_field` (the anti-silent-drop law — never a silent drop);
 *   - a documented field of the wrong shape        -> typed protocol error
 *     `malformed_payload`;
 *   - a documented record-type discriminator with an
 *     undocumented value                          -> typed protocol error
 *     `unknown_message_type`.
 *
 * DERIVATION (deterministic, provider layer — L2): the guard translates
 * the documented forms into the representation the mapping tables
 * declare. Index level records map field-for-field; constituent weight
 * and corporate action records are RESTRUCTURED into the canonical
 * `other` escape-hatch form — a derived `data` object whose keys are
 * CANONICAL vocabulary (symbol, weight, share_class, action,
 * effective_date, ratio, currency — never the documented raw names), so
 * no provider field name can leak into an emitted canonical event
 * (L2/L13 trip-wired in neutrality.test.ts). Raw field NAMES are
 * preserved wherever the value survives.
 */

import { failure, mappingError, success, type AdapterError, type SdkResult } from './contract/errors';
import { isNonEmptyString, isPositiveSafeInteger, isRecord } from './contract/fields';
import { compareDecimal, isPositiveDecimal, isUnsignedDecimal } from './contract/decimals';
import type { JsonObject, JsonValue } from './contract/json';
import { isTimestampMs, type TimestampMs } from './contract/timestamp';
import { equitiesProtocolError } from './protocol';
import { tradeDateDayIndex } from './calendar';

/**
 * The documented raw field names across the consumed feed channels — the
 * provider vocabulary. It lives ONLY in the adapter's declaration layers
 * (schemas, mapping tables, descriptors); the inverse-neutrality
 * trip-wire test asserts none of these names ever appears as a field of
 * an emitted CANONICAL event (L2: "a canonical event carrying a
 * provider-specific field name is a violation").
 */
export const EQUITIES_RAW_FIELD_NAMES: readonly string[] = [
  'recordType',
  'indexId',
  'tradeDate',
  'disseminationTimeMs',
  'indexLevel',
  'indexDivisor',
  'sequenceNumber',
  'constituentSymbol',
  'constituentWeight',
  'shareClassCode',
  'actionId',
  'corporateSymbol',
  'actionTypeCode',
  'effectiveDate',
  'announcementTimeMs',
  'actionRatio',
  'currencyCode',
];

/** The documented record-type discriminators, per channel. */
const INDEX_LEVEL_RECORD_TYPE = 'INDEX_LEVEL';
const CONSTITUENT_WEIGHT_RECORD_TYPE = 'CONSTITUENT_WEIGHT';
const CORPORATE_ACTION_RECORD_TYPE = 'CORPORATE_ACTION';

/** The documented corporate action type codes and their neutral translations. */
const ACTION_TYPE_CODES: Readonly<Record<string, string>> = {
  SPLIT: 'split',
  CASH_DIVIDEND: 'cash_dividend',
  MERGER: 'merger',
};

/** The documented share class codes and their neutral translations. */
const SHARE_CLASS_CODES: Readonly<Record<string, string>> = {
  COMMON: 'common',
  PREFERRED: 'preferred',
};

/** The strict documented date shape: YYYY-MM-DD. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The documented action ratio shape: N:M. */
const RATIO_RE = /^\d+:\d+$/;

/** The documented currency code shape: ISO 4217-style three letters. */
const CURRENCY_RE = /^[A-Z]{3}$/;

/** The validated index level record (documented names, validated shapes). */
export interface NormalizedIndexLevel {
  readonly recordType: 'INDEX_LEVEL';
  readonly indexId: string;
  readonly tradeDate: string;
  readonly disseminationTimeMs: TimestampMs;
  readonly indexLevel: string;
  readonly indexDivisor: string;
  readonly sequenceNumber: number;
}

/** The validated constituent weight record (documented names, validated shapes). */
export interface NormalizedConstituentWeight {
  readonly recordType: 'CONSTITUENT_WEIGHT';
  readonly indexId: string;
  readonly tradeDate: string;
  readonly disseminationTimeMs: TimestampMs;
  readonly constituentSymbol: string;
  readonly constituentWeight: string;
  readonly shareClassCode: string;
  readonly sequenceNumber: number;
}

/** The validated corporate action record (documented names, validated shapes). */
export interface NormalizedCorporateAction {
  readonly recordType: 'CORPORATE_ACTION';
  readonly actionId: string;
  readonly corporateSymbol: string;
  readonly actionTypeCode: string;
  readonly effectiveDate: string;
  readonly announcementTimeMs: TimestampMs;
  readonly actionRatio: string;
  readonly currencyCode: string;
}

function malformed(channel: string, detail: string): AdapterError {
  return equitiesProtocolError('malformed_payload', `channel "${channel}": ${detail}`);
}

function unknownMessageType(channel: string, documented: readonly string[], actual: string): AdapterError {
  return equitiesProtocolError(
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

/** Validate a documented decimal-string field. */
function guardDecimalString(channel: string, field: string, value: unknown): SdkResult<string> {
  if (typeof value !== 'string' || !isPositiveDecimal(value)) {
    return failure(malformed(channel, `field "${field}" must be a positive decimal string (got ${typeof value === 'string' ? `"${value}"` : String(value)})`));
  }
  return success(value);
}

/** Validate a documented YYYY-MM-DD date field: strict form AND a real civil date. */
function guardDate(channel: string, field: string, value: unknown): SdkResult<string> {
  if (typeof value !== 'string' || !DATE_RE.test(value) || tradeDateDayIndex(value) === null) {
    return failure(malformed(channel, `field "${field}" must be a real YYYY-MM-DD civil date string (got ${typeof value === 'string' ? `"${value}"` : String(value)})`));
  }
  return success(value);
}

// ---------------------------------------------------------------------------
// Channel schemas: documented raw record -> validated, normalized record.
// ---------------------------------------------------------------------------

/** The documented index level record fields (channel "indexLevel"). */
const INDEX_LEVEL_FIELDS: readonly string[] = [
  'recordType',
  'indexId',
  'tradeDate',
  'disseminationTimeMs',
  'indexLevel',
  'indexDivisor',
  'sequenceNumber',
];

/**
 * Channel "indexLevel" — the documented index level record. Validated
 * shape: the discriminator must be INDEX_LEVEL; the level and divisor
 * must be positive decimal strings; the dissemination instant must be a
 * positive epoch-millisecond integer; the sequence number must be a
 * positive integer.
 */
export function guardIndexLevelPayload(payload: JsonObject): SdkResult<NormalizedIndexLevel> {
  const channel = 'indexLevel';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, INDEX_LEVEL_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of INDEX_LEVEL_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (record.recordType !== INDEX_LEVEL_RECORD_TYPE) {
    return failure(unknownMessageType(channel, [INDEX_LEVEL_RECORD_TYPE], String(record.recordType)));
  }
  if (!isNonEmptyString(record.indexId)) {
    return failure(malformed(channel, 'field "indexId" must be a non-empty index identifier'));
  }
  const tradeDate = guardDate(channel, 'tradeDate', record.tradeDate);
  if (!tradeDate.ok) return tradeDate;
  const disseminationTimeMs = guardTimestamp(channel, 'disseminationTimeMs', record.disseminationTimeMs);
  if (!disseminationTimeMs.ok) return disseminationTimeMs;
  const indexLevel = guardDecimalString(channel, 'indexLevel', record.indexLevel);
  if (!indexLevel.ok) return indexLevel;
  const indexDivisor = guardDecimalString(channel, 'indexDivisor', record.indexDivisor);
  if (!indexDivisor.ok) return indexDivisor;
  if (!isPositiveSafeInteger(record.sequenceNumber)) {
    return failure(malformed(channel, `field "sequenceNumber" must be a positive integer (got ${String(record.sequenceNumber)})`));
  }

  return success({
    recordType: INDEX_LEVEL_RECORD_TYPE,
    indexId: record.indexId,
    tradeDate: tradeDate.value,
    disseminationTimeMs: disseminationTimeMs.value,
    indexLevel: indexLevel.value,
    indexDivisor: indexDivisor.value,
    sequenceNumber: record.sequenceNumber,
  });
}

/** The documented constituent weight record fields (channel "constituentWeights"). */
const CONSTITUENT_WEIGHT_FIELDS: readonly string[] = [
  'recordType',
  'indexId',
  'tradeDate',
  'disseminationTimeMs',
  'constituentSymbol',
  'constituentWeight',
  'shareClassCode',
  'sequenceNumber',
];

/**
 * Channel "constituentWeights" — the documented constituent weight
 * record. Shape laws: the weight is a decimal string in [0, 1] (a weight
 * above one is not a weight — typed malformed_payload); the share class
 * code must be one of the documented set.
 */
export function guardConstituentWeightsPayload(payload: JsonObject): SdkResult<NormalizedConstituentWeight> {
  const channel = 'constituentWeights';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, CONSTITUENT_WEIGHT_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of CONSTITUENT_WEIGHT_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (record.recordType !== CONSTITUENT_WEIGHT_RECORD_TYPE) {
    return failure(unknownMessageType(channel, [CONSTITUENT_WEIGHT_RECORD_TYPE], String(record.recordType)));
  }
  if (!isNonEmptyString(record.indexId)) {
    return failure(malformed(channel, 'field "indexId" must be a non-empty index identifier'));
  }
  const tradeDate = guardDate(channel, 'tradeDate', record.tradeDate);
  if (!tradeDate.ok) return tradeDate;
  const disseminationTimeMs = guardTimestamp(channel, 'disseminationTimeMs', record.disseminationTimeMs);
  if (!disseminationTimeMs.ok) return disseminationTimeMs;
  if (!isNonEmptyString(record.constituentSymbol)) {
    return failure(malformed(channel, 'field "constituentSymbol" must be a non-empty symbol string'));
  }
  const weight = record.constituentWeight;
  if (typeof weight !== 'string' || !isUnsignedDecimal(weight)) {
    return failure(malformed(channel, `field "constituentWeight" must be a decimal string (got ${typeof weight === 'string' ? `"${weight}"` : String(weight)})`));
  }
  // The upper bound is checked exactly (lexical comparison): an exactly-zero
  // weight (a constituent removed from the index) is legitimate; a weight
  // strictly greater than one is impossible data. The zero case is excluded
  // BEFORE the comparison (the mirrored compareDecimal's zero-vs-positive
  // ordering quirk is SDK-verbatim by law D-004 — reported, never edited).
  const weightIsZero = compareDecimal(weight, '0') === 0;
  if (!weightIsZero && compareDecimal(weight, '1') === 1) {
    return failure(malformed(channel, `field "constituentWeight" (${weight}) exceeds 1 — a constituent weight is a fraction of the index`));
  }
  const shareClass = SHARE_CLASS_CODES[String(record.shareClassCode)];
  if (shareClass === undefined) {
    return failure(malformed(channel, `field "shareClassCode" ("${String(record.shareClassCode)}") is not one of the documented share class codes (${Object.keys(SHARE_CLASS_CODES).join(' | ')})`));
  }
  if (!isPositiveSafeInteger(record.sequenceNumber)) {
    return failure(malformed(channel, `field "sequenceNumber" must be a positive integer (got ${String(record.sequenceNumber)})`));
  }

  return success({
    recordType: CONSTITUENT_WEIGHT_RECORD_TYPE,
    indexId: record.indexId,
    tradeDate: tradeDate.value,
    disseminationTimeMs: disseminationTimeMs.value,
    constituentSymbol: record.constituentSymbol,
    constituentWeight: weight,
    shareClassCode: String(record.shareClassCode),
    sequenceNumber: record.sequenceNumber,
  });
}

/** The documented corporate action record fields (channel "corporateActions"). */
const CORPORATE_ACTION_FIELDS: readonly string[] = [
  'recordType',
  'actionId',
  'corporateSymbol',
  'actionTypeCode',
  'effectiveDate',
  'announcementTimeMs',
  'actionRatio',
  'currencyCode',
];

/**
 * Channel "corporateActions" — the documented corporate action record.
 * Shape laws: the action type code must be one of the documented set
 * (an undocumented code is an unknown message type — the sub-type
 * discriminator); the ratio must be the documented "N:M" form; the
 * currency code must be three uppercase letters.
 */
export function guardCorporateActionsPayload(payload: JsonObject): SdkResult<NormalizedCorporateAction> {
  const channel = 'corporateActions';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, CORPORATE_ACTION_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of CORPORATE_ACTION_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (record.recordType !== CORPORATE_ACTION_RECORD_TYPE) {
    return failure(unknownMessageType(channel, [CORPORATE_ACTION_RECORD_TYPE], String(record.recordType)));
  }
  if (!isNonEmptyString(record.actionId)) {
    return failure(malformed(channel, 'field "actionId" must be a non-empty action identifier'));
  }
  if (!isNonEmptyString(record.corporateSymbol)) {
    return failure(malformed(channel, 'field "corporateSymbol" must be a non-empty symbol string'));
  }
  if (!isNonEmptyString(record.actionTypeCode) || ACTION_TYPE_CODES[record.actionTypeCode] === undefined) {
    return failure(
      unknownMessageType(channel, Object.keys(ACTION_TYPE_CODES), String(record.actionTypeCode)),
    );
  }
  const effectiveDate = guardDate(channel, 'effectiveDate', record.effectiveDate);
  if (!effectiveDate.ok) return effectiveDate;
  const announcementTimeMs = guardTimestamp(channel, 'announcementTimeMs', record.announcementTimeMs);
  if (!announcementTimeMs.ok) return announcementTimeMs;
  if (typeof record.actionRatio !== 'string' || !RATIO_RE.test(record.actionRatio)) {
    return failure(malformed(channel, `field "actionRatio" must be an N:M ratio string (got ${typeof record.actionRatio === 'string' ? `"${record.actionRatio}"` : String(record.actionRatio)})`));
  }
  if (typeof record.currencyCode !== 'string' || !CURRENCY_RE.test(record.currencyCode)) {
    return failure(malformed(channel, `field "currencyCode" must be a three-letter currency code (got ${typeof record.currencyCode === 'string' ? `"${record.currencyCode}"` : String(record.currencyCode)})`));
  }

  return success({
    recordType: CORPORATE_ACTION_RECORD_TYPE,
    actionId: record.actionId,
    corporateSymbol: record.corporateSymbol,
    actionTypeCode: record.actionTypeCode,
    effectiveDate: effectiveDate.value,
    announcementTimeMs: announcementTimeMs.value,
    actionRatio: record.actionRatio,
    currencyCode: record.currencyCode,
  });
}

// ---------------------------------------------------------------------------
// Derivations: validated records -> emitter-facing payloads (the mapping
// tables' declared representation). Deterministic; FIXED key order.
// ---------------------------------------------------------------------------

/**
 * Derive the emitter-facing payload of an index level record: the
 * documented fields the mapping table consumes (tradeDate, dissemination
 * instant, level) plus the tolerated divisor. The guard-consumed fields
 * (recordType, indexId, sequenceNumber) never reach the emitter — they
 * were consumed by the schema checks and the guard's sequencing law.
 */
export function deriveIndexLevelPayload(level: NormalizedIndexLevel): JsonObject {
  return {
    tradeDate: level.tradeDate,
    disseminationTimeMs: level.disseminationTimeMs,
    indexLevel: level.indexLevel,
    indexDivisor: level.indexDivisor,
  };
}

/**
 * Derive the emitter-facing payload of a constituent weight record: the
 * canonical `other` form — a derived `data` object whose keys are
 * CANONICAL vocabulary (symbol, weight, share_class) — plus the
 * dissemination instant (the mapping table's declared event-time field).
 * The documented raw names never reach the emitter.
 */
export function deriveConstituentWeightPayload(weight: NormalizedConstituentWeight): JsonObject {
  return {
    data: {
      symbol: weight.constituentSymbol,
      weight: weight.constituentWeight,
      share_class: SHARE_CLASS_CODES[weight.shareClassCode],
    } as unknown as JsonValue,
    disseminationTimeMs: weight.disseminationTimeMs,
  };
}

/**
 * Derive the emitter-facing payload of a corporate action record: the
 * canonical `other` form — a derived `data` object whose keys are
 * CANONICAL vocabulary (symbol, action, effective_date, ratio, currency)
 * — plus the announcement instant (the mapping table's declared
 * event-time field). The action and currency VALUES are translated to
 * their neutral documented forms.
 */
export function deriveCorporateActionPayload(action: NormalizedCorporateAction): JsonObject {
  return {
    data: {
      symbol: action.corporateSymbol,
      action: ACTION_TYPE_CODES[action.actionTypeCode],
      effective_date: action.effectiveDate,
      ratio: action.actionRatio,
      currency: action.currencyCode,
    } as unknown as JsonValue,
    announcementTimeMs: action.announcementTimeMs,
  };
}

/**
 * Guard and validate the payload of a message on one of the adapter's
 * documented channels. Channels WITHOUT a documented schema pass through
 * verbatim — the session's routing (unknown_channel) owns unsubscribed
 * channels.
 */
export function guardEquitiesPayload(channel: string, payload: JsonObject): SdkResult<JsonObject> {
  if (channel === 'indexLevel') {
    const level = guardIndexLevelPayload(payload);
    if (!level.ok) return level;
    return success(deriveIndexLevelPayload(level.value));
  }
  if (channel === 'constituentWeights') {
    const weight = guardConstituentWeightsPayload(payload);
    if (!weight.ok) return weight;
    return success(deriveConstituentWeightPayload(weight.value));
  }
  if (channel === 'corporateActions') {
    const action = guardCorporateActionsPayload(payload);
    if (!action.ok) return action;
    return success(deriveCorporateActionPayload(action.value));
  }
  return success(payload);
}

/** Structural guard for the validated index level record (introspection). */
export function isNormalizedIndexLevel(value: unknown): value is NormalizedIndexLevel {
  return (
    isRecord(value) &&
    value.recordType === INDEX_LEVEL_RECORD_TYPE &&
    isNonEmptyString(value.indexId) &&
    isNonEmptyString(value.tradeDate) &&
    isTimestampMs(value.disseminationTimeMs) &&
    isPositiveDecimal(value.indexLevel) &&
    isPositiveDecimal(value.indexDivisor) &&
    isPositiveSafeInteger(value.sequenceNumber)
  );
}

/** Structural guard for the validated constituent weight record (introspection). */
export function isNormalizedConstituentWeight(value: unknown): value is NormalizedConstituentWeight {
  return (
    isRecord(value) &&
    value.recordType === CONSTITUENT_WEIGHT_RECORD_TYPE &&
    isNonEmptyString(value.indexId) &&
    isNonEmptyString(value.constituentSymbol) &&
    isUnsignedDecimal(value.constituentWeight) &&
    isNonEmptyString(value.shareClassCode) &&
    isPositiveSafeInteger(value.sequenceNumber)
  );
}

/** Structural guard for the validated corporate action record (introspection). */
export function isNormalizedCorporateAction(value: unknown): value is NormalizedCorporateAction {
  return (
    isRecord(value) &&
    value.recordType === CORPORATE_ACTION_RECORD_TYPE &&
    isNonEmptyString(value.actionId) &&
    isNonEmptyString(value.corporateSymbol) &&
    isNonEmptyString(value.actionTypeCode) &&
    isNonEmptyString(value.effectiveDate) &&
    isTimestampMs(value.announcementTimeMs) &&
    isNonEmptyString(value.actionRatio) &&
    isNonEmptyString(value.currencyCode)
  );
}
