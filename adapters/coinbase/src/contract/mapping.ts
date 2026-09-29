/**
 * @tradrl/adapter-coinbase — the mapping table: raw fields -> canonical fields.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/mapping.ts (law D-004:
 * structural mirrors, never imports). spec/ADAPTERS.md: "Adapters preserve
 * provenance and entitlement constraints"; L4: adapters declare mapping
 * provenance (raw field -> canonical field, with source time policy
 * declared). The {@link MappingTable} IS that declaration:
 *
 *   - `fields`: every raw field the adapter maps to a canonical payload
 *     field, with a declared value {@link FieldTransform}.
 *   - `constants`: canonical fields filled with declared constant values.
 *   - `tolerated`: raw fields the adapter EXPLICITLY declares as knowingly
 *     dropped (auditable, recorded in the table — never silent).
 *   - `source_time_policy`: how the availability quartet's times are
 *     derived from raw fields vs the receive time.
 *
 * THE ANTI-SILENT-DROP LAW: at emission, every raw field present in a
 * message must be accounted for by exactly one of {mapped fields,
 * tolerated fields, time-policy fields}. A raw field accounted for by
 * NOTHING is a typed MappingError naming the field. Dropping is possible
 * ONLY by explicit declaration; silently is unrepresentable.
 *
 * The Coinbase tables (see ../mapping-tables.ts) declare the documented
 * Coinbase raw field names (e.g. "lastUpdateId", "p", "q", "m", "T") — the
 * provider vocabulary lives in THOSE declarations, never in the emitted
 * canonical events (the inverse-neutrality trip-wire test).
 *
 * The table is validated against the canonical payload field inventory
 * ({@link payloadFieldSpec}): every required canonical field must be
 * covered, every targeted field must exist, and the levels transform may
 * only feed book payloads' level arrays. Validated tables are deep-frozen
 * and immutable.
 */

import {
  invalidField,
  isNonEmptyString,
  isRecord,
  isUniqueNonEmptyStringArray,
  missingField,
  type MappingTableId,
} from './fields';
import type { SdkFieldError } from './errors';
import { canonicalFieldsOf, payloadFieldSpec } from './payloads';
import { isEventType, type EventType } from './taxonomy';
import type { JsonValue, JsonObject } from './json';
import { isUnsignedDecimal, isSignedDecimal } from './decimals';
import { deepFreeze } from './freeze';

// ---------------------------------------------------------------------------
// Value transforms.
// ---------------------------------------------------------------------------

/**
 * A declared value transform: how one raw field's value becomes the
 * canonical field's value. Transforms are PURE and TOTAL-or-typed-error:
 * any input the transform cannot translate produces a MappingError at
 * emission (never a silent drop, never a null).
 */
export type FieldTransform =
  /** Pass the raw value through unchanged; the payload validator enforces the final shape. */
  | { readonly kind: 'identity' }
  /** Map a raw enum string through a declared table (e.g. vendor side -> canonical side). */
  | { readonly kind: 'enum'; readonly map: Readonly<Record<string, string>> }
  /** Accept a decimal string as-is, or a finite JSON number printed as a decimal string. */
  | { readonly kind: 'decimal-string' }
  /** Translate an array of raw level records into canonical book levels. */
  | {
      readonly kind: 'levels';
      readonly price_field: string;
      readonly size_field: string;
    };

/** Structural guard for a field transform. */
export function isFieldTransform(value: unknown): value is FieldTransform {
  if (!isRecord(value)) return false;
  if (value.kind === 'identity') return true;
  if (value.kind === 'decimal-string') return true;
  if (value.kind === 'enum') {
    if (!isRecord(value.map)) return false;
    const entries = Object.entries(value.map);
    if (entries.length === 0) return false;
    return entries.every(([key, target]) => isNonEmptyString(key) && isNonEmptyString(target));
  }
  if (value.kind === 'levels') {
    return (
      isNonEmptyString(value.price_field) &&
      isNonEmptyString(value.size_field) &&
      value.price_field !== value.size_field
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Source time policy (the quartet's declared derivation).
// ---------------------------------------------------------------------------

/** Where `event_time` comes from: a raw vendor field, or the receive time. */
export type EventTimeBasis = 'raw-field' | 'receive-time';

/** Where `available_time` comes from BEFORE clamping (see below). */
export type AvailabilityBasis = 'event-time' | 'receive-time';

/**
 * The declared time policy of a mapping table (L4 — honest quartets).
 *
 * The emitter derives:
 *   - `event_time`:      raw field value, or the receive time.
 *   - `source_time`:     the raw vendor-claimed time field, or null when
 *                        the source does not say (advisory; unordered —
 *                        vendor clocks disagree, which is exactly why the
 *                        field exists).
 *   - `available_time`:  per the availability basis, then CLAMPED to
 *                        >= event_time (the one enforced ordering —
 *                        information may not be observable before the
 *                        event occurred; adapters clamp vendor clock skew).
 *   - `ingestion_time`:  the receive time (advisory; the store re-stamps
 *                        at commit — the T008 discipline).
 */
export interface SourceTimePolicy {
  readonly event_time_basis: EventTimeBasis;
  /** Required iff event_time_basis is 'raw-field'; must be null otherwise. */
  readonly event_time_field: string | null;
  /** The vendor-claimed time field, or null when the source does not say. */
  readonly source_time_field: string | null;
  readonly availability_basis: AvailabilityBasis;
}

/** Structural guard for a source time policy. */
export function isSourceTimePolicy(value: unknown): value is SourceTimePolicy {
  if (!isRecord(value)) return false;
  if (value.event_time_basis !== 'raw-field' && value.event_time_basis !== 'receive-time') return false;
  if (value.event_time_basis === 'raw-field' && !isNonEmptyString(value.event_time_field)) return false;
  if (value.event_time_basis === 'receive-time' && value.event_time_field !== null) return false;
  if (value.source_time_field !== null && !isNonEmptyString(value.source_time_field)) return false;
  return value.availability_basis === 'event-time' || value.availability_basis === 'receive-time';
}

// ---------------------------------------------------------------------------
// Field mappings, constants and the table.
// ---------------------------------------------------------------------------

/** One raw -> canonical field mapping with its declared transform. */
export interface FieldMapping {
  /** The raw field name in the vendor's message payload. */
  readonly raw_field: string;
  /** The canonical payload field it feeds. */
  readonly canonical_field: string;
  /** The declared value transform (default identity). */
  readonly transform: FieldTransform;
  /** Whether the raw field MUST be present in every message (default true). */
  readonly required: boolean;
}

/** One canonical field filled with a declared constant value. */
export interface ConstantField {
  readonly canonical_field: string;
  readonly value: JsonValue;
}

/**
 * The declared mapping table for one canonical event type on one channel:
 * the raw->canonical field provenance plus the source time policy.
 */
export interface MappingTable {
  /** Opaque table identifier (referenced by subscriptions and event ids). */
  readonly table_id: MappingTableId;
  /** The canonical event type this table produces. */
  readonly event_type: EventType;
  /** Raw -> canonical field mappings. Unique raw fields; unique canonical targets. */
  readonly fields: readonly FieldMapping[];
  /** Canonical fields filled with declared constants. */
  readonly constants: readonly ConstantField[];
  /** Raw fields explicitly declared as knowingly dropped (auditable). */
  readonly tolerated: readonly string[];
  /** The declared quartet derivation. */
  readonly source_time_policy: SourceTimePolicy;
}

/** The raw fields consumed by a table's time policy. */
export function timePolicyFields(policy: SourceTimePolicy): readonly string[] {
  const fields: string[] = [];
  if (policy.event_time_basis === 'raw-field' && policy.event_time_field !== null) {
    fields.push(policy.event_time_field);
  }
  if (policy.source_time_field !== null) fields.push(policy.source_time_field);
  return fields;
}

/** All raw fields this table accounts for (mapped, tolerated and time-policy). */
export function accountedRawFields(table: MappingTable): readonly string[] {
  return [
    ...table.fields.map((field) => field.raw_field),
    ...table.tolerated,
    ...timePolicyFields(table.source_time_policy),
  ];
}

/** Which canonical fields the levels transform may target, per event type. */
const LEVEL_TARGETS: Readonly<Record<string, readonly string[]>> = {
  book_snapshot: ['bids', 'asks'],
  book_delta: ['levels'],
};

function validateTransform(
  value: unknown,
  path: string,
  eventType: EventType,
  canonicalField: string,
  errors: SdkFieldError[],
): void {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    errors.push(invalidField(`${path}.transform`, 'must be a declared transform'));
    return;
  }
  if (value.kind === 'identity' || value.kind === 'decimal-string') {
    return; // shape complete
  }
  if (value.kind === 'enum') {
    if (!isRecord(value.map) || Object.keys(value.map).length === 0) {
      errors.push(invalidField(`${path}.transform.map`, 'must be a non-empty raw->canonical string map'));
      return;
    }
    for (const [key, target] of Object.entries(value.map)) {
      if (!isNonEmptyString(key) || !isNonEmptyString(target)) {
        errors.push(invalidField(`${path}.transform.map`, 'every key and value must be a non-empty string'));
        return;
      }
    }
    return;
  }
  if (value.kind === 'levels') {
    const allowed = LEVEL_TARGETS[eventType];
    if (allowed === undefined || !allowed.includes(canonicalField)) {
      const permitted = allowed === undefined ? 'book payload level arrays' : allowed.join(' | ');
      errors.push(
        invalidField(
          `${path}.transform`,
          `the levels transform may only target ${permitted} for ${eventType}`,
        ),
      );
      return;
    }
    if (!isNonEmptyString(value.price_field) || !isNonEmptyString(value.size_field)) {
      errors.push(invalidField(`${path}.transform`, 'levels requires non-empty price_field and size_field'));
      return;
    }
    if (value.price_field === value.size_field) {
      errors.push(invalidField(`${path}.transform`, 'levels price_field and size_field must differ'));
    }
    return;
  }
  errors.push(invalidField(`${path}.transform`, `"${value.kind}" is not a declared transform kind`));
}

/** Validated result of {@link validateMappingTable}. */
export type MappingTableValidation =
  | { readonly ok: true; readonly value: MappingTable }
  | { readonly ok: false; readonly errors: readonly SdkFieldError[] };

/**
 * Validate an untrusted value as a MappingTable. Collects EVERY violation;
 * never throws. The validated table is deep-frozen (immutable declaration)
 * with defaults normalized (identity transform, required fields).
 */
export function validateMappingTable(value: unknown): MappingTableValidation {
  const errors: SdkFieldError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidField('mapping_table', 'must be an object')] };
  }

  if (value.table_id === undefined) errors.push(missingField('table_id'));
  else if (!isNonEmptyString(value.table_id))
    errors.push(invalidField('table_id', 'must be a non-empty string'));

  if (value.event_type === undefined) errors.push(missingField('event_type'));
  else if (!isEventType(value.event_type))
    errors.push(invalidField('event_type', 'must be a canonical event type'));
  const eventType: EventType | undefined = isEventType(value.event_type) ? value.event_type : undefined;

  // Fields.
  const seenRaw = new Set<string>();
  const seenCanonical = new Set<string>();
  if (value.fields === undefined) {
    errors.push(missingField('fields'));
  } else if (!Array.isArray(value.fields) || value.fields.length === 0) {
    errors.push(invalidField('fields', 'must be a non-empty array of field mappings'));
  } else {
    const canonicalVocabulary = eventType !== undefined ? canonicalFieldsOf(eventType) : [];
    value.fields.forEach((entry, index) => {
      const path = `fields[${index}]`;
      if (!isRecord(entry)) {
        errors.push(invalidField(path, 'must be an object with raw_field and canonical_field'));
        return;
      }
      if (entry.raw_field === undefined) errors.push(missingField(`${path}.raw_field`));
      else if (!isNonEmptyString(entry.raw_field))
        errors.push(invalidField(`${path}.raw_field`, 'must be a non-empty string'));
      else if (seenRaw.has(entry.raw_field))
        errors.push(invalidField(`${path}.raw_field`, `duplicate raw field "${entry.raw_field}"`));
      else seenRaw.add(entry.raw_field);

      if (entry.canonical_field === undefined) errors.push(missingField(`${path}.canonical_field`));
      else if (!isNonEmptyString(entry.canonical_field))
        errors.push(invalidField(`${path}.canonical_field`, 'must be a non-empty string'));
      else if (canonicalVocabulary.length > 0 && !canonicalVocabulary.includes(entry.canonical_field))
        errors.push(
          invalidField(
            `${path}.canonical_field`,
            `"${entry.canonical_field}" is not a field of the ${eventType} payload (${canonicalVocabulary.join(' | ')})`,
          ),
        );
      else if (seenCanonical.has(entry.canonical_field))
        errors.push(invalidField(`${path}.canonical_field`, `duplicate canonical field "${entry.canonical_field}"`));
      else seenCanonical.add(entry.canonical_field);

      if (entry.transform !== undefined && eventType !== undefined && isNonEmptyString(entry.canonical_field)) {
        validateTransform(entry.transform, path, eventType, entry.canonical_field, errors);
      }

      if (entry.required !== undefined && typeof entry.required !== 'boolean')
        errors.push(invalidField(`${path}.required`, 'must be a boolean when present'));
    });
  }

  // Constants.
  const constantCanonical = new Set<string>();
  if (value.constants === undefined) {
    errors.push(missingField('constants'));
  } else if (!Array.isArray(value.constants)) {
    errors.push(invalidField('constants', 'must be an array of constant field declarations'));
  } else {
    const canonicalVocabulary = eventType !== undefined ? canonicalFieldsOf(eventType) : [];
    value.constants.forEach((entry, index) => {
      const path = `constants[${index}]`;
      if (!isRecord(entry)) {
        errors.push(invalidField(path, 'must be an object with canonical_field and value'));
        return;
      }
      if (entry.canonical_field === undefined) errors.push(missingField(`${path}.canonical_field`));
      else if (!isNonEmptyString(entry.canonical_field))
        errors.push(invalidField(`${path}.canonical_field`, 'must be a non-empty string'));
      else if (canonicalVocabulary.length > 0 && !canonicalVocabulary.includes(entry.canonical_field))
        errors.push(
          invalidField(
            `${path}.canonical_field`,
            `"${entry.canonical_field}" is not a field of the ${eventType} payload`,
          ),
        );
      else if (seenCanonical.has(entry.canonical_field))
        errors.push(
          invalidField(`${path}.canonical_field`, `canonical field "${entry.canonical_field}" is already mapped`),
        );
      else if (constantCanonical.has(entry.canonical_field))
        errors.push(invalidField(`${path}.canonical_field`, `duplicate constant field "${entry.canonical_field}"`));
      else constantCanonical.add(entry.canonical_field);
    });
  }

  // Coverage: fields + constants must cover every required canonical field.
  if (eventType !== undefined) {
    for (const requiredField of payloadFieldSpec[eventType].required) {
      if (!seenCanonical.has(requiredField) && !constantCanonical.has(requiredField)) {
        errors.push(
          invalidField(
            'fields',
            `the required canonical field "${requiredField}" of the ${eventType} payload is covered by neither a field mapping nor a constant`,
          ),
        );
      }
    }
  }

  // Tolerated.
  if (value.tolerated === undefined) {
    errors.push(missingField('tolerated'));
  } else if (!isUniqueNonEmptyStringArray(value.tolerated)) {
    errors.push(invalidField('tolerated', 'must be an array of unique non-empty raw field names'));
  } else {
    for (const toleratedField of value.tolerated) {
      if (seenRaw.has(toleratedField)) {
        errors.push(
          invalidField(
            'tolerated',
            `"${toleratedField}" is both mapped and tolerated — a raw field has exactly one disposition`,
          ),
        );
        break;
      }
    }
  }

  // Source time policy.
  if (value.source_time_policy === undefined) {
    errors.push(missingField('source_time_policy'));
  } else if (!isSourceTimePolicy(value.source_time_policy)) {
    errors.push(invalidField('source_time_policy', 'must be a declared source time policy'));
  } else {
    const policyFields = timePolicyFields(value.source_time_policy);
    for (const policyField of policyFields) {
      if (seenRaw.has(policyField)) {
        errors.push(
          invalidField(
            'source_time_policy',
            `"${policyField}" is both a time-policy field and a mapped field — a raw field has exactly one disposition`,
          ),
        );
      } else if (Array.isArray(value.tolerated) && value.tolerated.includes(policyField)) {
        errors.push(
          invalidField(
            'source_time_policy',
            `"${policyField}" is both a time-policy field and a tolerated field — a raw field has exactly one disposition`,
          ),
        );
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Normalize defaults (identity transform, required=true) and freeze.
  const normalized: MappingTable = {
    table_id: value.table_id as string,
    event_type: value.event_type as EventType,
    fields: (value.fields as readonly Record<string, unknown>[]).map((entry) => ({
      raw_field: entry.raw_field as string,
      canonical_field: entry.canonical_field as string,
      transform: entry.transform === undefined ? { kind: 'identity' } : (entry.transform as FieldTransform),
      required: entry.required === undefined ? true : (entry.required as boolean),
    })),
    constants: (value.constants ?? []) as readonly ConstantField[],
    tolerated: value.tolerated as readonly string[],
    source_time_policy: value.source_time_policy as SourceTimePolicy,
  };
  return { ok: true, value: deepFreeze(normalized as unknown) as unknown as MappingTable };
}

// ---------------------------------------------------------------------------
// Transform application. Pure functions returning typed outcomes; the
// emitter converts failures to MappingError.
// ---------------------------------------------------------------------------

/** Outcome of applying one declared transform to one raw value. */
export type TransformOutcome =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly message: string };

/** Outcome of a decimal-string conversion. */
type DecimalOutcome = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string };

/** Convert one raw value to a decimal string per the decimal-string transform. */
function toDecimalString(value: unknown, path: string): DecimalOutcome {
  if (typeof value === 'string') {
    if (isUnsignedDecimal(value) || isSignedDecimal(value)) return { ok: true, value: value };
    return { ok: false, message: `${path}: "${value}" is not a well-formed decimal string` };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const printed = String(value);
    if (isUnsignedDecimal(printed) || isSignedDecimal(printed)) {
      return { ok: true, value: printed };
    }
    return {
      ok: false,
      message: `${path}: the number ${value} prints as "${printed}", which is not a well-formed decimal string (exponent notation cannot be normalized losslessly)`,
    };
  }
  return { ok: false, message: `${path}: expected a decimal string or a finite number, got ${typeof value}` };
}

/** Apply a declared transform to one raw value. Pure; typed failure, never throws. */
export function applyFieldTransform(
  transform: FieldTransform,
  rawValue: JsonValue,
  path: string,
): TransformOutcome {
  switch (transform.kind) {
    case 'identity':
      return { ok: true, value: rawValue };
    case 'enum': {
      if (typeof rawValue !== 'string') {
        return { ok: false, message: `${path}: enum transforms require a string input, got ${typeof rawValue}` };
      }
      const mapped = transform.map[rawValue];
      if (mapped === undefined) {
        return {
          ok: false,
          message: `${path}: raw enum value "${rawValue}" is not a declared key of the enum map`,
        };
      }
      return { ok: true, value: mapped };
    }
    case 'decimal-string':
      return toDecimalString(rawValue, path);
    case 'levels': {
      if (!Array.isArray(rawValue)) {
        return { ok: false, message: `${path}: levels transforms require an array of level records` };
      }
      const levels: { price: string; size: string }[] = [];
      for (let index = 0; index < rawValue.length; index += 1) {
        const level = rawValue[index];
        if (!isRecord(level)) {
          return { ok: false, message: `${path}[${index}]: each level must be an object` };
        }
        const price = level[transform.price_field];
        const size = level[transform.size_field];
        if (price === undefined || size === undefined) {
          return {
            ok: false,
            message: `${path}[${index}]: level record is missing "${transform.price_field}" or "${transform.size_field}"`,
          };
        }
        const priceOutcome = toDecimalString(price, `${path}[${index}].${transform.price_field}`);
        if (!priceOutcome.ok) return priceOutcome;
        const sizeOutcome = toDecimalString(size, `${path}[${index}].${transform.size_field}`);
        if (!sizeOutcome.ok) return sizeOutcome;
        levels.push({ price: priceOutcome.value, size: sizeOutcome.value });
      }
      return { ok: true, value: levels };
    }
  }
}

/** The raw payload value for a field, or undefined. */
export function rawFieldOf(rawPayload: JsonObject, field: string): JsonValue | undefined {
  return rawPayload[field];
}
