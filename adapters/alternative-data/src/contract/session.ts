/**
 * @tradrl/adapter-alternative-data — the normalized adapter session.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/session.ts (law D-004:
 * structural mirrors, never imports — the frozen workspace lockfile
 * forbids package dependencies). The session is the provider-neutral lifecycle this adapter drives over
 * the GUARD transport (../guard-transport.ts) with its declarations:
 * injected port -> [guard: documented schema validation, domain laws,
 * normalization] -> normalized engine [lifecycle state machine,
 * declared-capability cross-checks, unmangled request pass-through,
 * routing, canonical emission] -> provider-neutral canonical events
 * (honest quartet, provenance, entitlement ref, mapping provenance).
 * Deterministic: no clock, no randomness.
 */

import {
  invalidField,
  isNonEmptyString,
  isRecord,
  missingField,
  type MappingTableId,
  type VenueId,
  type InstrumentId,
} from './fields';
import { failure, protocolError, success, type SdkFieldError, type SdkResult } from './errors';
import { isAssetClass, type AssetClass } from './taxonomy';
import type { JsonObject } from './json';
import type { AdapterRef, EventOrigin } from './provenance';
import type { EntitlementEnvelope } from './entitlement';
import type { MappingTable } from './mapping';
import type { TransportPort, OutboundMessage } from './transport';
import type { SourceDescriptor } from './descriptors';
import type { CanonicalEmitter, EmittedEvent, DerivationSpec, StreamBinding } from './emitter';
import { createCanonicalEmitter } from './emitter';
import type { TimestampMs } from './timestamp';

/** The lifecycle states of a session. */
export type SessionState = 'idle' | 'open' | 'subscribed' | 'closed';

/** One subscription: a raw channel bound to a mapping table and a canonical stream identity. */
export interface SubscriptionSpec {
  /** The raw channel to subscribe on (must be declared in the source's capabilities). */
  readonly channel: string;
  /** The raw subscription request payload — passed through the transport UNMANGLED (provider-neutral pass-through). */
  readonly request: JsonObject;
  /** The canonical venue the stream belongs to. */
  readonly venue: VenueId;
  /** The canonical instrument the stream belongs to (must be declared in a symbol universe of the same asset class). */
  readonly instrument: InstrumentId;
  /** The canonical asset class of the stream. */
  readonly asset_class: AssetClass;
  /** The declared mapping table translating this channel's messages (must be declared in the session config). */
  readonly mapping_table_id: MappingTableId;
}

/** The session's configuration (validated at construction). */
export interface AdapterSessionConfig {
  readonly descriptor: SourceDescriptor;
  /** The concrete adapter's identity (id + version). */
  readonly adapter: AdapterRef;
  /** The injected transport port. NO network lives in this package. */
  readonly transport: TransportPort;
  /** Declared mapping tables (at least one, unique ids, validated/frozen). */
  readonly mapping_tables: readonly MappingTable[];
  /** Optional entitlement envelope; omitted = the refusal path (typed EntitlementError at emission). */
  readonly entitlement?: EntitlementEnvelope;
  /** Origin of emitted records (default historical). */
  readonly origin?: EventOrigin;
  /** Optional derivation lineage. */
  readonly derivation?: DerivationSpec | null;
  /** First sequence number per stream (default 0). */
  readonly sequence_start?: number;
}

/** Constructed-result type of {@link createAdapterSession}. */
export type SessionConstruction =
  | { readonly ok: true; readonly session: AdapterSession }
  | { readonly ok: false; readonly errors: readonly SdkFieldError[] };

/** A registered event handler, invoked for every successfully emitted event during pump(). */
export type EventHandler = (event: EmittedEvent) => void;

/** The normalized adapter session. */
export interface AdapterSession {
  /**
   * The validated configuration. Deliberately NOT deep-frozen: it carries
   * the injected transport port, whose own mutable state belongs to the
   * port (freezing a live port would break real transports, T037+). The
   * declaration fields it shares with the emitter are frozen THERE.
   */
  readonly config: AdapterSessionConfig;
  /** The current lifecycle state. */
  state(): SessionState;
  /** The receive time of the last delivered message (health input), or null when none. */
  lastMessageAt(): TimestampMs | null;
  /** Transition idle -> open. */
  open(): SdkResult<null>;
  /** Bind a subscription (open or subscribed state only) and send the raw request through the transport. */
  subscribe(spec: SubscriptionSpec): SdkResult<null>;
  /** Pull the next emission; null when the transport is drained. */
  nextEvent(): SdkResult<EmittedEvent | null>;
  /** Register a handler invoked for every successfully emitted event during {@link pump}. */
  onEvent(handler: EventHandler): void;
  /**
   * Drain the transport: emit every remaining message through the handler.
   * Returns the number of events delivered, or the first typed failure
   * (which aborts the pump — deterministic failure surfacing).
   */
  pump(): SdkResult<number>;
  /** Close the session and the underlying port (open/subscribed/idle -> closed). */
  close(): SdkResult<null>;
}

/** The internal binding of one subscribed channel. */
interface ChannelBinding {
  readonly spec: SubscriptionSpec;
  readonly table: MappingTable;
}

/**
 * Construct a session from an untrusted configuration. Validates the
 * configuration (collect-all; the emitter's validation runs inside), then
 * returns the session in the idle state.
 */
export function createAdapterSession(config: unknown): SessionConstruction {
  if (!isRecord(config)) {
    return { ok: false, errors: [invalidField('session_config', 'must be an object')] };
  }

  if (config.transport === undefined) {
    return { ok: false, errors: [missingField('transport')] };
  }
  if (!isTransportPortShape(config.transport)) {
    return { ok: false, errors: [invalidField('transport', 'must be an injected transport port (send/recv/close)')] };
  }

  // Delegate the emitter-shaped validation (descriptor, adapter, tables,
  // entitlement, origin, derivation, sequence start) to the emitter factory.
  const emitterConfig = {
    source: config.descriptor,
    adapter: config.adapter,
    mapping_tables: config.mapping_tables,
    entitlement: config.entitlement,
    origin: config.origin,
    derivation: config.derivation,
    sequence_start: config.sequence_start,
  };
  const emitterConstruction = createCanonicalEmitter(emitterConfig);
  if (!emitterConstruction.ok) {
    return { ok: false, errors: emitterConstruction.errors };
  }
  const emitter = emitterConstruction.emitter;

  const descriptor = config.descriptor as SourceDescriptor;
  const normalizedConfig: AdapterSessionConfig = {
    descriptor,
    adapter: config.adapter as AdapterRef,
    transport: config.transport as TransportPort,
    mapping_tables: emitter.config.mapping_tables,
    entitlement: emitter.config.entitlement,
    origin: emitter.config.origin,
    derivation: emitter.config.derivation,
    sequence_start: emitter.config.sequence_start,
  };

  let state: SessionState = 'idle';
  let lastMessageAt: TimestampMs | null = null;
  let closedPort = false;
  const bindings = new Map<string, ChannelBinding>();
  let handler: EventHandler | null = null;

  function requireNotClosed(operation: string): SdkResult<null> | null {
    if (state === 'closed') {
      return failure(
        protocolError('use_after_close', `cannot ${operation} a closed session — every operation on a closed session is a typed error`),
      );
    }
    return null;
  }

  const session: AdapterSession = {
    config: normalizedConfig,
    state(): SessionState {
      return state;
    },
    lastMessageAt(): TimestampMs | null {
      return lastMessageAt;
    },
    open(): SdkResult<null> {
      const closed = requireNotClosed('open');
      if (closed !== null) return closed;
      if (state !== 'idle') {
        return failure(protocolError('invalid_transition', `open() requires the idle state (current: ${state})`));
      }
      state = 'open';
      return success(null);
    },
    subscribe(spec: SubscriptionSpec): SdkResult<null> {
      const closed = requireNotClosed('subscribe on');
      if (closed !== null) return closed;
      if (state !== 'open' && state !== 'subscribed') {
        return failure(
          protocolError('invalid_transition', `subscribe() requires the open or subscribed state (current: ${state}) — open the session first`),
        );
      }
      const specErrors = validateSubscriptionSpec(spec);
      if (specErrors.length > 0) {
        return failure(protocolError('invalid_configuration', `invalid subscription spec: ${specErrors.map((error) => error.message).join('; ')}`));
      }
      if (bindings.has(spec.channel)) {
        return failure(protocolError('duplicate_subscription', `channel "${spec.channel}" already has a subscription`));
      }
      // Declared-capability cross-checks (the adapter cannot silently exceed its envelope).
      if (!descriptor.capabilities.channels.includes(spec.channel)) {
        return failure(
          protocolError(
            'invalid_configuration',
            `channel "${spec.channel}" is not declared in the source descriptor's capabilities — declare it or subscribe on a declared channel`,
          ),
        );
      }
      const table = emitter.tableOf(spec.mapping_table_id);
      if (table === null) {
        return failure(
          protocolError('mapping_table_not_found', `mapping table "${spec.mapping_table_id}" was not declared in the session configuration`),
        );
      }
      if (!descriptor.capabilities.event_types.includes(table.event_type)) {
        return failure(
          protocolError(
            'invalid_configuration',
            `table "${table.table_id}" emits ${table.event_type}, which the source descriptor does not declare emittable`,
          ),
        );
      }
      const instrumentDeclared = descriptor.capabilities.symbol_universes.some(
        (universe) => universe.asset_class === spec.asset_class && universe.instruments.includes(spec.instrument),
      );
      if (!instrumentDeclared) {
        return failure(
          protocolError(
            'invalid_configuration',
            `instrument "${spec.instrument}" (asset class ${spec.asset_class}) is not declared in any symbol universe of the source descriptor`,
          ),
        );
      }

      // Send the raw request through the injected transport (pass-through, unmangled).
      const request: OutboundMessage = { channel: spec.channel, payload: spec.request };
      const sent = normalizedConfig.transport.send(request);
      if (!sent.ok) return sent;

      bindings.set(spec.channel, { spec, table });
      state = 'subscribed';
      return success(null);
    },
    nextEvent(): SdkResult<EmittedEvent | null> {
      const closed = requireNotClosed('receive on');
      if (closed !== null) return closed;
      if (state !== 'subscribed') {
        return failure(
          protocolError('invalid_transition', `nextEvent() requires the subscribed state (current: ${state}) — subscribe first`),
        );
      }
      const received = normalizedConfig.transport.recv();
      if (!received.ok) return received;
      if (received.message === null) {
        return success(null); // drained
      }
      const message = received.message;
      lastMessageAt = message.at;
      const binding = bindings.get(message.channel);
      if (binding === undefined) {
        return failure(
          protocolError('unknown_channel', `a message arrived on channel "${message.channel}", which has no subscription — every inbound channel must be subscribed`),
        );
      }
      const streamBinding: StreamBinding = {
        channel: binding.spec.channel,
        venue: binding.spec.venue,
        instrument: binding.spec.instrument,
        asset_class: binding.spec.asset_class,
        table: binding.table,
      };
      return emitter.emit(message, streamBinding);
    },
    onEvent(registered: EventHandler): void {
      handler = registered;
    },
    pump(): SdkResult<number> {
      let delivered = 0;
      for (;;) {
        const next = session.nextEvent();
        if (!next.ok) return next;
        if (next.value === null) return success(delivered);
        if (handler !== null) handler(next.value);
        delivered += 1;
      }
    },
    close(): SdkResult<null> {
      if (state === 'closed') {
        return failure(protocolError('double_close', 'the session is already closed — double close is a typed error'));
      }
      if (!closedPort) {
        normalizedConfig.transport.close();
        closedPort = true;
      }
      state = 'closed';
      return success(null);
    },
  };

  return { ok: true, session };
}

/** Structural shape check for an injected transport port. */
function isTransportPortShape(value: unknown): value is TransportPort {
  if (!isRecord(value)) return false;
  return typeof value.send === 'function' && typeof value.recv === 'function' && typeof value.close === 'function';
}

/** Validate a subscription spec (shape-level, collect-all). */
function validateSubscriptionSpec(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (!isRecord(value)) {
    return [invalidField('subscription', 'must be an object')];
  }
  if (!isNonEmptyString(value.channel)) errors.push(invalidField('channel', 'must be a non-empty string'));
  if (!isRecord(value.request)) errors.push(invalidField('request', 'must be a JSON object'));
  if (!isNonEmptyString(value.venue)) errors.push(invalidField('venue', 'must be a non-empty string'));
  if (!isNonEmptyString(value.instrument)) errors.push(invalidField('instrument', 'must be a non-empty string'));
  if (!isAssetClass(value.asset_class)) errors.push(invalidField('asset_class', 'must be a canonical asset class'));
  if (!isNonEmptyString(value.mapping_table_id)) errors.push(invalidField('mapping_table_id', 'must be a non-empty string'));
  return errors;
}
