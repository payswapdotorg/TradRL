/**
 * @tradrl/adapter-news — the canonical emitter.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/emitter.ts (law D-004:
 * structural mirrors, never imports). The emitter is where raw payloads
 * become CANONICAL events: it applies a declared MappingTable, constructs
 * an HONEST availability quartet from the declared SourceTimePolicy,
 * attaches the T008-mirrored provenance block and the entitlement ref,
 * validates EVERYTHING through the mirrored canonical contracts, and
 * deep-freezes the result. Every failure is a typed AdapterError — silent
 * drops are unrepresentable.
 *
 * The emittable event-type union is narrowed to this adapter's declared
 * set ('news'); each member is structurally
 * identical to the SDK's, so the union remains assignable to the SDK's
 * full-taxonomy EmittedEvent (the interop test's type-level witness).
 *
 * THE AVAILABILITY QUARTET (L4 — point-in-time truth) is constructed
 * honestly per the declared mapping-table policy: event_time from the
 * declared raw field (or the receive time), available_time per the
 * declared basis CLAMPED to >= event_time (the one enforced ordering —
 * vendor clock skew is clamped, never trusted), ingestion_time = the
 * receive time (advisory; the store re-stamps at commit).
 *
 * Determinism: event ids and sequences are pure functions of (adapter id,
 * table id, stream key, arrival order) — the same script always emits the
 * same stream, byte-identically.
 */

import {
  invalidField,
  isNonEmptyString,
  isRecord,
  isUniqueNonEmptyStringArray,
  missingField,
  type AdapterId,
  type AdapterVersion,
  type EntitlementId,
  type EventId,
  type MappingTableId,
  type ProviderId,
  type VenueId,
  type InstrumentId,
} from './fields';
import { failure, mappingError, protocolError, entitlementError, success, type AdapterError, type SdkFieldError, type SdkResult } from './errors';
import type { AssetClass, EmittableEventType, EventType, PayloadOf } from './taxonomy';
import type { TimestampMs } from './timestamp';
import { isTimestampMs } from './timestamp';
import type { JsonValue } from './json';
import { validatePayloadFor } from './payloads';
import type { MappingTable, SourceTimePolicy, FieldTransform } from './mapping';
import { accountedRawFields, applyFieldTransform } from './mapping';
import type { AdapterRef, EventOrigin, IngestionProvenance } from './provenance';
import { validateIngestionProvenance } from './provenance';
import type { EntitlementEnvelope, EntitlementRef } from './entitlement';
import { isEntitlementEnvelope } from './entitlement';
import type { InboundMessage } from './transport';
import type { SourceDescriptor } from './descriptors';
import { deepFreeze } from './freeze';

// ---------------------------------------------------------------------------
// The emitted event (canonical envelope mirror + entitlement + mapping ref).
// ---------------------------------------------------------------------------

/**
 * The mapping provenance carried on every emitted event: which declared
 * table produced it and under which declared time policy (L4/L9 — each
 * record is self-describing about its own translation).
 */
export interface MappingProvenance {
  readonly table_id: MappingTableId;
  readonly source_time_policy: SourceTimePolicy;
}

/** Fields shared by every emitted event regardless of type. */
export interface EmittedEventCommon {
  readonly event_id: EventId;
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly asset_class: AssetClass;
  readonly event_time: TimestampMs;
  readonly source_time: TimestampMs | null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
  readonly sequence: number;
  readonly provider: ProviderId;
  readonly provenance: IngestionProvenance;
  readonly entitlement: EntitlementRef;
  readonly mapping: MappingProvenance;
}

/** An emitted event of a specific canonical type — the discriminant narrows the payload. */
export type EmittedEventFor<K extends EmittableEventType> = EmittedEventCommon & {
  readonly event_type: K;
  readonly payload: PayloadOf<K>;
};

/**
 * The canonical, provider-neutral event the SDK emits: a structural mirror
 * of the canonical market event (envelope + quartet + typed payload +
 * provenance) EXTENDED with the entitlement ref and the mapping provenance.
 * The extras ride as tolerated unknown fields downstream (the canonical
 * contract is a floor); the mirrored core keeps the record assignable to
 * the canonical event shapes — trip-wired in the interop test.
 */
export type EmittedEvent = EmittedEventFor<'news'>;

/** The stream identity a subscription binds: where the event belongs. */
export interface StreamBinding {
  /** The raw channel the message arrived on. */
  readonly channel: string;
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly asset_class: AssetClass;
  /** The declared mapping table that translates this channel's messages. */
  readonly table: MappingTable;
}

/** Optional derivation declaration (L9): lineage parents + the transform id. */
export interface DerivationSpec {
  readonly derived_from: readonly string[];
  readonly transform: string;
}

// ---------------------------------------------------------------------------
// Emitter configuration and construction.
// ---------------------------------------------------------------------------

/** The emitter's validated configuration. */
export interface EmitterConfig {
  /** The source descriptor (provider identity + declared capabilities). */
  readonly source: SourceDescriptor;
  /** The concrete adapter's identity (id + version) — the lineage producer. */
  readonly adapter: AdapterRef;
  /** Declared mapping tables, at least one, unique table ids. */
  readonly mapping_tables: readonly MappingTable[];
  /**
   * The declared entitlement envelope. OPTIONAL — and deliberately so:
   * omission is the negative path. An emitter without a declared
   * entitlement REFUSES TO EMIT (typed EntitlementError) — there is no
   * code path that emits an entitlement-less record.
   */
  readonly entitlement?: EntitlementEnvelope;
  /** The origin of emitted records; default 'historical' (real-world observation). */
  readonly origin?: EventOrigin;
  /** Optional derivation lineage; default primitive (derived_from: [], transform: null). */
  readonly derivation?: DerivationSpec | null;
  /** First sequence number per stream; default 0. */
  readonly sequence_start?: number;
}

/** Constructed-result type of {@link createCanonicalEmitter}. */
export type EmitterConstruction =
  | { readonly ok: true; readonly emitter: CanonicalEmitter }
  | { readonly ok: false; readonly errors: readonly SdkFieldError[] };

/** The canonical emitter over validated declarations. */
export interface CanonicalEmitter {
  /** The validated configuration (frozen). */
  readonly config: EmitterConfig;
  /**
   * Translate one inbound message into one canonical event. Deterministic:
   * a pure function of (config, binding, message, per-stream counters).
   * The stream's next sequence is consumed only on SUCCESS (failed
   * emissions do not burn sequence numbers — arrival discipline).
   */
  emit(message: InboundMessage, binding: StreamBinding): SdkResult<EmittedEvent>;
  /** The table with the given id, or null when none was declared. */
  tableOf(tableId: MappingTableId): MappingTable | null;
  /** Per-stream sequence high-water marks (introspection; the emitted stream's state). */
  sequenceState(): Readonly<Record<string, number>>;
}

/** The stream key of an event: `venue|instrument|stream` (the canonical sequence scope). */
export function emittedStreamKey(venue: string, instrument: string, eventType: EventType, payload: Record<string, unknown>): string {
  const stream = eventType === 'other' ? `other:${String(payload.kind)}` : eventType;
  return `${venue}|${instrument}|${stream}`;
}

/** Convert a raw time value to a timestamp: safe-integer number or digit-string. */
function convertTimestamp(value: unknown, field: string): SdkResult<TimestampMs> {
  if (typeof value === 'number' && Number.isSafeInteger(value) && isTimestampMs(value)) {
    return success(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && isTimestampMs(parsed)) {
      return success(parsed);
    }
  }
  return failure(
    mappingError('invalid_time_field', `raw time field "${field}" does not convert to an epoch-millisecond timestamp: ${typeof value === 'string' ? `"${value}"` : String(value)}`),
  );
}

/** Construct the availability quartet from the declared policy and the receive time. */
function buildQuartet(
  policy: SourceTimePolicy,
  rawPayload: Record<string, unknown>,
  receivedAt: TimestampMs,
): SdkResult<{ event_time: TimestampMs; source_time: TimestampMs | null; available_time: TimestampMs; ingestion_time: TimestampMs }> {
  // event_time
  let eventTime: TimestampMs;
  if (policy.event_time_basis === 'receive-time') {
    eventTime = receivedAt;
  } else {
    const raw = rawPayload[policy.event_time_field as string];
    if (raw === undefined) {
      return failure(
        mappingError('mapped_field_missing', `the declared event time field "${policy.event_time_field}" is absent from the raw payload`),
      );
    }
    const converted = convertTimestamp(raw, policy.event_time_field as string);
    if (!converted.ok) return converted;
    eventTime = converted.value;
  }

  // source_time (advisory; absent or null means the source does not say)
  let sourceTime: TimestampMs | null = null;
  if (policy.source_time_field !== null) {
    const raw = rawPayload[policy.source_time_field];
    if (raw !== undefined && raw !== null) {
      const converted = convertTimestamp(raw, policy.source_time_field);
      if (!converted.ok) return converted;
      sourceTime = converted.value;
    }
  }

  // available_time per the declared basis, then CLAMPED to >= event_time.
  const basisTime = policy.availability_basis === 'event-time' ? eventTime : receivedAt;
  const availableTime: TimestampMs = basisTime < eventTime ? eventTime : basisTime;

  return success({
    event_time: eventTime,
    source_time: sourceTime,
    available_time: availableTime,
    ingestion_time: receivedAt,
  });
}

/** Build the mapped canonical payload from the raw payload. */
function buildPayload(table: MappingTable, rawPayload: Record<string, unknown>): SdkResult<Record<string, JsonValue>> {
  const payload: Record<string, JsonValue> = {};
  for (const field of table.fields) {
    const raw = rawPayload[field.raw_field];
    if (raw === undefined) {
      if (field.required) {
        return failure(
          mappingError('mapped_field_missing', `the mapped raw field "${field.raw_field}" is absent (required by the mapping table)`),
        );
      }
      continue; // optional and absent: the canonical field is omitted
    }
    const outcome = applyFieldTransform(field.transform, raw as JsonValue, field.raw_field);
    if (!outcome.ok) {
      return failure(mappingError('invalid_mapped_value', outcome.message));
    }
    payload[field.canonical_field] = outcome.value;
  }
  for (const constant of table.constants) {
    payload[constant.canonical_field] = constant.value;
  }
  return success(payload);
}

/** Build the emitted event object with a FIXED key order (byte-identical JSON). */
function buildEventRecord(
  common: EmittedEventCommon,
  eventType: EventType,
  payload: Record<string, JsonValue>,
): EmittedEvent {
  return {
    event_id: common.event_id,
    venue: common.venue,
    instrument: common.instrument,
    asset_class: common.asset_class,
    event_type: eventType,
    event_time: common.event_time,
    source_time: common.source_time,
    available_time: common.available_time,
    ingestion_time: common.ingestion_time,
    sequence: common.sequence,
    provider: common.provider,
    provenance: common.provenance,
    entitlement: common.entitlement,
    mapping: common.mapping,
    payload,
  } as unknown as EmittedEvent;
}

/**
 * Construct the canonical emitter from an untrusted configuration.
 * Validates everything up front (collect-all); the resulting emitter's
 * config is deep-frozen.
 */
export function createCanonicalEmitter(config: unknown): EmitterConstruction {
  const errors: SdkFieldError[] = [];
  if (!isRecord(config)) {
    return { ok: false, errors: [invalidField('emitter_config', 'must be an object')] };
  }

  // Source descriptor.
  if (config.source === undefined) {
    errors.push(missingField('source'));
  } else {
    const sourceErrors = validateDescriptorShape(config.source);
    errors.push(...sourceErrors);
  }

  // Adapter ref.
  if (config.adapter === undefined) {
    errors.push(missingField('adapter'));
  } else if (!isRecord(config.adapter) || !isNonEmptyString(config.adapter.id) || !isNonEmptyString(config.adapter.version)) {
    errors.push(invalidField('adapter', 'must be an object with non-empty id and version'));
  }

  // Mapping tables.
  const tables = new Map<string, MappingTable>();
  if (config.mapping_tables === undefined) {
    errors.push(missingField('mapping_tables'));
  } else if (!Array.isArray(config.mapping_tables) || config.mapping_tables.length === 0) {
    errors.push(invalidField('mapping_tables', 'must be a non-empty array of declared mapping tables'));
  } else {
    config.mapping_tables.forEach((table, index) => {
      if (!isRecord(table) || !isNonEmptyString(table.table_id) || !isNonEmptyString(table.event_type)) {
        errors.push(invalidField(`mapping_tables[${index}]`, 'must be a validated mapping table'));
        return;
      }
      if (tables.has(table.table_id)) {
        errors.push(invalidField(`mapping_tables[${index}]`, `duplicate table id "${table.table_id}"`));
        return;
      }
      // Structural acceptance: the table must already be a validated (frozen) table.
      if (!isMappingTableShape(table)) {
        errors.push(invalidField(`mapping_tables[${index}]`, 'must be a validated mapping table (use validateMappingTable)'));
        return;
      }
      tables.set(table.table_id, table as unknown as MappingTable);
    });
  }

  // Cross-check: every table's event type must be within the source's declared capabilities.
  if (isRecord(config.source) && isRecord(config.source.capabilities) && Array.isArray(config.source.capabilities.event_types)) {
    const declaredTypes = config.source.capabilities.event_types as readonly unknown[];
    for (const [tableId, table] of tables) {
      if (!declaredTypes.includes(table.event_type)) {
        errors.push(
          invalidField(
            'mapping_tables',
            `table "${tableId}" emits ${table.event_type}, which the source descriptor does not declare emittable`,
          ),
        );
      }
    }
  }

  // Entitlement envelope (optional; validated when present).
  if (config.entitlement !== undefined && !isEntitlementEnvelope(config.entitlement)) {
    errors.push(invalidField('entitlement', 'must be a declared entitlement envelope when present'));
  }

  // Origin.
  if (config.origin !== undefined && !(typeof config.origin === 'string' && ['historical', 'simulated', 'generated'].includes(config.origin))) {
    errors.push(invalidField('origin', 'must be historical | simulated | generated when present'));
  }

  // Derivation.
  if (config.derivation !== undefined && config.derivation !== null) {
    if (
      !isRecord(config.derivation) ||
      !Array.isArray(config.derivation.derived_from) ||
      !isUniqueNonEmptyStringArray(config.derivation.derived_from) ||
      !isNonEmptyString(config.derivation.transform)
    ) {
      errors.push(invalidField('derivation', 'must be an object with unique non-empty derived_from ids and a non-empty transform'));
    }
  }

  // Sequence start.
  if (config.sequence_start !== undefined && !(typeof config.sequence_start === 'number' && Number.isSafeInteger(config.sequence_start) && config.sequence_start >= 0)) {
    errors.push(invalidField('sequence_start', 'must be a non-negative safe integer when present'));
  }

  if (errors.length > 0) return { ok: false, errors };

  const normalizedConfig: EmitterConfig = {
    source: config.source as SourceDescriptor,
    adapter: config.adapter as AdapterRef,
    mapping_tables: [...tables.values()],
    entitlement: config.entitlement === undefined ? undefined : (config.entitlement as EntitlementEnvelope),
    origin: config.origin === undefined ? 'historical' : (config.origin as EventOrigin),
    derivation: config.derivation === undefined ? null : (config.derivation as DerivationSpec | null),
    sequence_start: config.sequence_start === undefined ? 0 : (config.sequence_start as number),
  };

  // Resolved (non-optional) view for the emission path.
  const resolvedOrigin: EventOrigin = normalizedConfig.origin ?? 'historical';
  const resolvedDerivation: DerivationSpec | null = normalizedConfig.derivation ?? null;
  const sequenceStart: number = normalizedConfig.sequence_start ?? 0;
  const sequenceCounters = new Map<string, number>();

  const emitter: CanonicalEmitter = {
    config: deepFreeze(normalizedConfig as unknown) as unknown as EmitterConfig,
    tableOf(tableId: string): MappingTable | null {
      return tables.get(tableId) ?? null;
    },
    sequenceState(): Readonly<Record<string, number>> {
      return Object.fromEntries(sequenceCounters);
    },
    emit(message: InboundMessage, binding: StreamBinding): SdkResult<EmittedEvent> {
      return emitOne(message, binding);
    },
  };


  function emitOne(message: InboundMessage, binding: StreamBinding): SdkResult<EmittedEvent> {
    // 1. Entitlement refusal FIRST (undeclared = refuse-to-emit).
    if (normalizedConfig.entitlement === undefined) {
      return failure(
        entitlementError(
          'entitlement_undeclared',
          'the emitter has no declared entitlement envelope — the adapter refuses to emit records whose entitlement is undeclared (spec/ADAPTERS.md licensing)',
        ),
      );
    }

    const table = binding.table;

    // 2. Raw field accounting: nothing present may be unaccounted for.
    const accounted = new Set<string>(accountedRawFields(table));
    const rawKeys = Object.keys(message.payload).sort();
    for (const key of rawKeys) {
      if (!accounted.has(key)) {
        return failure(
          mappingError(
            'unmapped_raw_field',
            `raw field "${key}" on channel "${binding.channel}" is not accounted for by mapping table "${table.table_id}" — map it, tolerate it explicitly, or fix the feed; silent drops are unrepresentable`,
          ),
        );
      }
    }

    // 3. The quartet from the declared policy.
    if (!isTimestampMs(message.at)) {
      return failure(protocolError('invalid_configuration', 'the inbound message receive time is not a valid timestamp'));
    }
    const quartet = buildQuartet(table.source_time_policy, message.payload as Record<string, unknown>, message.at);
    if (!quartet.ok) return quartet;

    // 4. The mapped payload + canonical validation.
    const payloadResult = buildPayload(table, message.payload as Record<string, unknown>);
    if (!payloadResult.ok) return payloadResult;
    const payload = payloadResult.value;
    const payloadErrors = validatePayloadFor(table.event_type, payload);
    if (payloadErrors.length > 0) {
      const summary = payloadErrors.map((error) => `${error.path === '' ? 'payload' : `payload.${error.path}`}: ${error.message}`).join('; ');
      return failure(mappingError('invalid_mapped_value', `the mapped payload violates the canonical ${table.event_type} contract — ${summary}`));
    }

    // 5. Sequence + event id (deterministic).
    const streamKey = emittedStreamKey(binding.venue, binding.instrument, table.event_type, payload);
    const nextSequence = (sequenceCounters.get(streamKey) ?? sequenceStart) + 1;
    const eventId: EventId = `${normalizedConfig.adapter.id}:${table.table_id}:${streamKey}:${nextSequence}`;

    // 6. Provenance block (T008 mirror).
    const derivation = resolvedDerivation;
    const provenance: IngestionProvenance = {
      origin: resolvedOrigin,
      adapter: { id: normalizedConfig.adapter.id, version: normalizedConfig.adapter.version },
      derived_from: derivation === null || derivation === undefined ? [] : derivation.derived_from,
      transform: derivation === null || derivation === undefined ? null : derivation.transform,
    };
    const provenanceErrors = validateIngestionProvenance(provenance, eventId);
    if (provenanceErrors.length > 0) {
      return failure(
        protocolError(
          'invalid_provenance',
          `the constructed provenance block failed the ingestion mirror: ${provenanceErrors.map((error) => error.message).join('; ')}`,
        ),
      );
    }

    const entitlementRef: EntitlementRef = {
      entitlement_id: normalizedConfig.entitlement.entitlement_id,
      constraints: normalizedConfig.entitlement.constraints,
    };
    const mappingProvenance: MappingProvenance = {
      table_id: table.table_id,
      source_time_policy: table.source_time_policy,
    };

    const event = buildEventRecord(
      {
        event_id: eventId,
        venue: binding.venue,
        instrument: binding.instrument,
        asset_class: binding.asset_class,
        event_time: quartet.value.event_time,
        source_time: quartet.value.source_time,
        available_time: quartet.value.available_time,
        ingestion_time: quartet.value.ingestion_time,
        sequence: nextSequence,
        provider: normalizedConfig.source.provider,
        provenance,
        entitlement: entitlementRef,
        mapping: mappingProvenance,
      },
      table.event_type,
      payload,
    );

    // 7. Defense in depth: the canonical floor over the fully built record.
    const floorErrors = validateEmittedFloor(event);
    if (floorErrors.length > 0) {
      return failure(
        protocolError(
          'invalid_emission',
          `the constructed event failed the canonical envelope floor: ${floorErrors.map((error) => error.message).join('; ')}`,
        ),
      );
    }

    // Sequence is consumed only on success.
    sequenceCounters.set(streamKey, nextSequence);

    return success(deepFreeze(event) as unknown as EmittedEvent);
  }

  return { ok: true, emitter };
}

// ---------------------------------------------------------------------------
// Structural re-validation helpers (defense in depth + construction).
// ---------------------------------------------------------------------------

/** Minimal structural validation of a source descriptor record (shape-level). */
function validateDescriptorShape(value: unknown): SdkFieldError[] {
  if (!isRecord(value)) return [invalidField('source', 'must be a source descriptor object')];
  const errors: SdkFieldError[] = [];
  if (!isNonEmptyString(value.provider)) errors.push(invalidField('source.provider', 'must be a non-empty string'));
  if (value.category !== 'market-data' && value.category !== 'execution' && value.category !== 'model' && value.category !== 'human') {
    errors.push(invalidField('source.category', 'must be market-data | execution | model | human'));
  }
  const capabilities = value.capabilities;
  if (!isRecord(capabilities)) {
    errors.push(invalidField('source.capabilities', 'must be a capabilities object'));
  } else {
    if (!isUniqueNonEmptyStringArray(capabilities.channels)) {
      errors.push(invalidField('source.capabilities.channels', 'must be unique non-empty channel names'));
    }
    if (!Array.isArray(capabilities.symbol_universes) || capabilities.symbol_universes.length === 0) {
      errors.push(invalidField('source.capabilities.symbol_universes', 'must be a non-empty array of universes'));
    }
    if (!Array.isArray(capabilities.event_types) || capabilities.event_types.length === 0) {
      errors.push(invalidField('source.capabilities.event_types', 'must be a non-empty array of event types'));
    }
    if (capabilities.latency_class !== 'realtime' && capabilities.latency_class !== 'near-realtime' && capabilities.latency_class !== 'delayed' && capabilities.latency_class !== 'batch') {
      errors.push(invalidField('source.capabilities.latency_class', 'must be realtime | near-realtime | delayed | batch'));
    }
  }
  return errors;
}

/** Shape-level acceptance of a (pre-validated) mapping table. */
function isMappingTableShape(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.fields) || value.fields.length === 0) return false;
  if (!Array.isArray(value.tolerated)) return false;
  if (!isRecord(value.source_time_policy)) return false;
  return isNonEmptyString(value.table_id) && isNonEmptyString(value.event_type);
}

/**
 * The canonical envelope floor over a fully built emitted event: quartet
 * presence + ordering, identifier totality, provenance mirror, payload
 * registry. Mirrors the canonical validation discipline (market-protocol
 * envelope + T008 ingestion floor) over the record the SDK constructed.
 */
export function validateEmittedFloor(event: EmittedEvent): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  const record = event as unknown as Record<string, unknown>;

  for (const field of ['event_id', 'venue', 'instrument', 'provider', 'entitlement', 'mapping'] as const) {
    if (record[field] === undefined) errors.push(missingField(field));
  }
  if (!isTimestampMs(record.event_time)) errors.push(invalidField('event_time', 'must be a valid timestamp'));
  if (record.source_time !== null && !isTimestampMs(record.source_time))
    errors.push(invalidField('source_time', 'must be a valid timestamp or null'));
  if (!isTimestampMs(record.available_time)) errors.push(invalidField('available_time', 'must be a valid timestamp'));
  if (!isTimestampMs(record.ingestion_time)) errors.push(invalidField('ingestion_time', 'must be a valid timestamp'));
  if (
    isTimestampMs(record.event_time) &&
    isTimestampMs(record.available_time) &&
    (record.available_time as number) < (record.event_time as number)
  ) {
    errors.push(invalidField('available_time', 'precedes event_time — information may not be observable before it occurred'));
  }
  if (typeof record.sequence !== 'number' || !Number.isSafeInteger(record.sequence) || (record.sequence as number) < 0) {
    errors.push(invalidField('sequence', 'must be a non-negative safe integer'));
  }
  const provenanceErrors = validateIngestionProvenance(record.provenance, typeof record.event_id === 'string' ? record.event_id : '');
  errors.push(...provenanceErrors);
  const payloadErrors = validatePayloadFor(event.event_type, record.payload);
  errors.push(...payloadErrors.map((error) => ({ ...error, path: error.path === '' ? 'payload' : `payload.${error.path}` })));
  return errors;
}
