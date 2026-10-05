/**
 * @tradrl/adapter-arena — the normalized adapter session (the engine).
 *
 * The provider-neutral lifecycle this adapter drives over the GUARD
 * transport (../guard-transport.ts) with its declarations — the mirror
 * of @tradrl/provider-sdk's session contract, specialized to the
 * capability-provider domain (Work Order T046):
 *
 *   injected port -> [guard: documented wire schema validation, dedup,
 *   correlation + goalpost pre-checks] -> this engine [lifecycle state
 *   machine, declared-capability cross-checks, unmangled request
 *   pass-through, mapping tables, T045 envelope minting] ->
 *   provider-neutral capability-provider envelopes (the T045 shapes —
 *   declarations, quotes, deliverables), each wrapped with its mapping
 *   provenance (L9) and the declared entitlement ref.
 *
 * THE ENGINE NEVER DECIDES provider semantics: the wire vocabulary
 * lives in the provider layer (schemas/mapping-tables/routing); the
 * correlation + goalpost pre-checks live in the guard (the state they
 * need is the provider session's); the PLATFORM'S EXCHANGE remains the
 * authority over every envelope (the engine MINTS, the exchange
 * REGISTERS). The provider never verifies its own deliverable (L20).
 *
 * Determinism: no clock, no randomness — the same scripted transport
 * always yields the same envelope stream, byte-identically.
 */

import { invalidField, isNonEmptyString, isRecord, missingField } from './fields';
import { failure, protocolError, success, entitlementError, type SdkFieldError, type SdkResult } from './errors';
import type { JsonObject } from './json';
import { isJsonObject } from './json';
import type { EntitlementEnvelope, EntitlementRef } from './entitlement';
import { isEntitlementEnvelope, entitlementRefOf } from './entitlement';
import type { MappingTable } from './mapping';
import { applyMappingTable } from './mapping';
import {
  isEngagement,
  validateCapabilityRequest,
  validateDeliverable,
  validateProviderDeclaration,
  validateProviderQuoteDraft,
} from './provider-envelopes';
import type { MappingTableId } from './fields';
import type { TransportPort, OutboundMessage } from './transport';
import type { SourceDescriptor } from './descriptors';
import { isDeclaredChannel } from './descriptors';
import type { TimestampMs } from './timestamp';
import { isTimestampMs } from './timestamp';
import type { TimestampMs as ProviderTimestampMs } from './provider';
import type {
  CapabilityRequest,
  CapabilityRequestId,
  Deliverable,
  Engagement,
  EngagementId,
  ProviderDeclaration,
  ProviderQuote,
} from './provider-envelopes';

/** The lifecycle states of a session. */
export type SessionState = 'idle' | 'open' | 'subscribed' | 'closed';

/** The concrete adapter's identity (the lineage producer on every emitted envelope — L9). */
export interface AdapterRef {
  readonly id: string;
  readonly version: string;
}

/** One subscription: a raw wire channel bound to a mapping table. */
export interface ChannelSubscription {
  /** The raw channel to subscribe on (must be declared in the source's capabilities). */
  readonly channel: string;
  /** The raw subscription request payload — passed through the transport UNMANGLED (provider-neutral pass-through). */
  readonly request: JsonObject;
  /** The declared mapping table translating this channel's messages (must be declared in the session config). */
  readonly mapping_table_id: MappingTableId;
}

/** The session's configuration (validated at construction). */
export interface AdapterSessionConfig {
  /** The declared source descriptor (the capability envelope every operation is cross-checked against). */
  readonly descriptor: SourceDescriptor;
  /** The concrete adapter's identity (id + version). */
  readonly adapter: AdapterRef;
  /** The injected transport port (ALREADY guard-wrapped by the provider layer). NO network lives in this package. */
  readonly transport: TransportPort;
  /** Declared mapping tables (at least one, unique ids, validated/frozen). */
  readonly mapping_tables: readonly MappingTable[];
  /** Optional entitlement envelope; omitted = the refusal path (typed EntitlementError at emission). */
  readonly entitlement?: EntitlementEnvelope;
  /** The session's tenant scope (L12 — injected into every minted envelope, never read from the wire). */
  readonly tenantId: string;
  /** The session's project scope (L12). */
  readonly projectId: string;
}

/** One minted, validated capability-provider envelope (the T045 shapes). */
export type MintedEnvelope =
  | { readonly kind: 'declaration'; readonly record: ProviderDeclaration }
  | { readonly kind: 'quote'; readonly record: ProviderQuote; readonly answersRequest: CapabilityRequestId }
  | { readonly kind: 'deliverable'; readonly record: Deliverable; readonly forEngagement: EngagementId };

/**
 * The emission record: the minted envelope plus its adapter-side
 * provenance (L9) — the channel, the translating table, the receive
 * instant, the provider identity and the declared entitlement ref.
 * The envelope itself is the provider-neutral T045 shape; EVERYTHING
 * adapter-specific stays in THIS wrapper (the neutrality law).
 */
export interface EmittedEnvelope {
  readonly envelope: MintedEnvelope;
  /** The wire channel the source message arrived on. */
  readonly channel: string;
  /** The mapping table that translated the message. */
  readonly tableId: MappingTableId;
  /** The message's receive instant (the only injected clock reading). */
  readonly receivedAt: TimestampMs;
  /** The declared provider identity (the descriptor's provider id). */
  readonly provider: string;
  /** The declared entitlement ref (carried — never interpreted here). */
  readonly entitlement: EntitlementRef;
  /** The mapping provenance: the raw fields the table accounted for (auditable). */
  readonly accountedRawFields: readonly string[];
}

/** A registered envelope handler, invoked for every successfully emitted envelope during pump(). */
export type EnvelopeHandler = (emission: EmittedEnvelope) => void;

/** The normalized adapter session. */
export interface AdapterSession {
  /** The validated configuration (the transport port's own state belongs to the port — not frozen). */
  readonly config: AdapterSessionConfig;
  /** The current lifecycle state. */
  state(): SessionState;
  /** The receive time of the last delivered message (health input), or null when none. */
  lastMessageAt(): TimestampMs | null;
  /** Transition idle -> open. */
  open(): SdkResult<null>;
  /** Bind a subscription (open or subscribed state only) and send the raw request through the transport. */
  subscribe(spec: ChannelSubscription): SdkResult<null>;
  /** Send a raw request frame through the transport (open or subscribed state; unmangled pass-through). */
  sendRequest(message: OutboundMessage): SdkResult<null>;
  /** Pull the next emission; null when the transport is drained. */
  nextEnvelope(): SdkResult<EmittedEnvelope | null>;
  /** Register a handler invoked for every successfully emitted envelope during {@link pump}. */
  onEnvelope(handler: EnvelopeHandler): void;
  /**
   * Drain the transport: emit every remaining message through the handler.
   * Returns the number of envelopes delivered, or the first typed failure
   * (which aborts the pump — deterministic failure surfacing).
   */
  pump(): SdkResult<number>;
  /** Close the session and the underlying port (open/subscribed/idle -> closed). */
  close(): SdkResult<null>;
}

/** Constructed-result type of {@link createAdapterSession}. */
export type SessionConstruction =
  | { readonly ok: true; readonly session: AdapterSession }
  | { readonly ok: false; readonly errors: readonly SdkFieldError[] };

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
  if (!isJsonObject(value.request)) errors.push(invalidField('request', 'must be a JSON object'));
  if (!isNonEmptyString(value.mapping_table_id)) errors.push(invalidField('mapping_table_id', 'must be a non-empty string'));
  return errors;
}

/**
 * Construct a session from an untrusted configuration. Validates the
 * configuration (collect-all), then returns the session in the idle
 * state.
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
  if (!isRecord(config.descriptor) || !isNonEmptyString((config.descriptor as Record<string, unknown>).provider)) {
    return { ok: false, errors: [invalidField('descriptor', 'must be a declared source descriptor')] };
  }
  if (!isRecord(config.adapter) || !isNonEmptyString((config.adapter as Record<string, unknown>).id) || !isNonEmptyString((config.adapter as Record<string, unknown>).version)) {
    return { ok: false, errors: [invalidField('adapter', 'must be the concrete adapter identity ({id, version})')] };
  }
  if (!Array.isArray(config.mapping_tables) || config.mapping_tables.length === 0) {
    return { ok: false, errors: [invalidField('mapping_tables', 'must be a NON-EMPTY array of declared mapping tables')] };
  }
  const tableIds = new Set<string>();
  for (const table of config.mapping_tables as readonly unknown[]) {
    if (!isRecord(table) || !isNonEmptyString(table.table_id)) {
      return { ok: false, errors: [invalidField('mapping_tables', 'every entry must be a declared mapping table')] };
    }
    if (tableIds.has(table.table_id)) {
      return { ok: false, errors: [invalidField('mapping_tables', `duplicate mapping table id "${table.table_id}"`)] };
    }
    tableIds.add(table.table_id);
  }
  if (!isNonEmptyString(config.tenantId) || !isNonEmptyString(config.projectId)) {
    return { ok: false, errors: [invalidField('tenantId', 'the session carries its L12 tenant/project scope (both required)')] };
  }
  const entitlement: unknown = config.entitlement;
  if (entitlement !== undefined && entitlement !== null && !isEntitlementEnvelope(entitlement)) {
    return { ok: false, errors: [invalidField('entitlement', 'must be a declared entitlement envelope or null (the refusal path)')] };
  }

  const descriptor = config.descriptor as unknown as SourceDescriptor;
  const normalizedConfig: AdapterSessionConfig = {
    descriptor,
    adapter: config.adapter as unknown as AdapterRef,
    transport: config.transport as TransportPort,
    mapping_tables: config.mapping_tables as readonly MappingTable[],
    entitlement: entitlement === null || entitlement === undefined ? undefined : (entitlement as EntitlementEnvelope),
    tenantId: config.tenantId as string,
    projectId: config.projectId as string,
  };

  let state: SessionState = 'idle';
  let lastMessageAt: TimestampMs | null = null;
  let closedPort = false;
  const bindings = new Map<string, { readonly channel: string; readonly table: MappingTable }>();
  let handler: EnvelopeHandler | null = null;

  function requireNotClosed(operation: string): SdkResult<null> | null {
    if (state === 'closed') {
      return failure(
        protocolError('use_after_close', `cannot ${operation} a closed session — every operation on a closed session is a typed error`),
      );
    }
    return null;
  }

  /** Mints the T045 envelope from the mapped draft (defense in depth: the minted record re-validates). */
  function mintEnvelope(table: MappingTable, draft: Record<string, unknown>): SdkResult<MintedEnvelope> {
    switch (table.envelope_kind) {
      case 'declaration': {
        const validated = validateProviderDeclaration(draft);
        if (!validated.ok) {
          return failure(
            protocolError('invalid_emission', `the mapped declaration draft failed the T045 validation law: ${validated.errors.map((error) => `(${error.code}) ${error.path}: ${error.message}`).join('; ')}`),
          );
        }
        return success({ kind: 'declaration', record: validated.value });
      }
      case 'quote': {
        const validated = validateProviderQuoteDraft(draft);
        if (!validated.ok) {
          return failure(
            protocolError('invalid_emission', `the mapped quote draft failed the T045 validation law: ${validated.errors.map((error) => `(${error.code}) ${error.path}: ${error.message}`).join('; ')}`),
          );
        }
        const requestId = (draft.requestId as unknown) as CapabilityRequestId;
        return success({ kind: 'quote', record: validated.value, answersRequest: requestId });
      }
      case 'deliverable': {
        const validated = validateDeliverable(draft);
        if (!validated.ok) {
          return failure(
            protocolError('invalid_emission', `the mapped deliverable draft failed the T045 validation law: ${validated.errors.map((error) => `(${error.code}) ${error.path}: ${error.message}`).join('; ')}`),
          );
        }
        const engagementId = (draft.engagementId as unknown) as EngagementId;
        return success({ kind: 'deliverable', record: validated.value, forEngagement: engagementId });
      }
    }
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
    subscribe(spec: ChannelSubscription): SdkResult<null> {
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
      if (!isDeclaredChannel(descriptor, spec.channel)) {
        return failure(
          protocolError(
            'invalid_configuration',
            `channel "${spec.channel}" is not declared in the source descriptor's capabilities — declare it or subscribe on a declared channel`,
          ),
        );
      }
      const table = (normalizedConfig.mapping_tables as readonly MappingTable[]).find((candidate) => candidate.table_id === spec.mapping_table_id);
      if (table === undefined) {
        return failure(
          protocolError('mapping_table_not_found', `mapping table "${spec.mapping_table_id}" was not declared in the session configuration`),
        );
      }
      // Send the raw request through the injected transport (pass-through, unmangled).
      const request: OutboundMessage = { channel: spec.channel, payload: spec.request };
      const sent = normalizedConfig.transport.send(request);
      if (!sent.ok) return sent;

      bindings.set(spec.channel, { channel: spec.channel, table });
      state = 'subscribed';
      return success(null);
    },
    sendRequest(message: OutboundMessage): SdkResult<null> {
      const closed = requireNotClosed('send a request on');
      if (closed !== null) return closed;
      if (state !== 'open' && state !== 'subscribed') {
        return failure(
          protocolError('invalid_transition', `sendRequest() requires the open or subscribed state (current: ${state}) — open the session first`),
        );
      }
      const sent = normalizedConfig.transport.send(message);
      if (!sent.ok) return sent;
      return success(null);
    },
    nextEnvelope(): SdkResult<EmittedEnvelope | null> {
      const closed = requireNotClosed('receive on');
      if (closed !== null) return closed;
      if (state !== 'subscribed') {
        return failure(
          protocolError('invalid_transition', `nextEnvelope() requires the subscribed state (current: ${state}) — subscribe first`),
        );
      }
      const received = normalizedConfig.transport.recv();
      if (!received.ok) return received;
      if (received.message === null) {
        return success(null); // drained
      }
      const message = received.message;
      if (!isTimestampMs(message.at)) {
        return failure(
          protocolError('invalid_configuration', `the inbound message receive time ${String(message.at)} is not a valid epoch-millisecond timestamp`),
        );
      }
      lastMessageAt = message.at;
      const binding = bindings.get(message.channel);
      if (binding === undefined) {
        return failure(
          protocolError('unknown_channel', `a message arrived on channel "${message.channel}", which has no subscription — every inbound channel must be subscribed`),
        );
      }
      const table = binding.table;
      const mapped = applyMappingTable(table, message.payload, {
        // The documented brand boundary: the transport layer speaks the SDK's
        // TimestampMs brand, the envelope layer the T045 one — both are the
        // same epoch-millisecond integer (validated above), translated here
        // at the single seam where the two mirror families meet.
        receiveAt: message.at as unknown as ProviderTimestampMs,
        tenantId: normalizedConfig.tenantId,
        projectId: normalizedConfig.projectId,
      });
      if (!mapped.ok) {
        return failure(
          protocolError('invalid_emission', `the wire message on channel "${message.channel}" failed the declared mapping: ${mapped.problems.join('; ')}`),
        );
      }
      const minted = mintEnvelope(table, mapped.draft);
      if (!minted.ok) return minted;

      // THE LICENSING LAW: no code path emits an entitlement-less record.
      if (normalizedConfig.entitlement === undefined) {
        return failure(
          entitlementError(
            'entitlement_undeclared',
            'the session carries no declared entitlement envelope — every emission requires one (there is no code path that emits an entitlement-less record)',
          ),
        );
      }

      const emission: EmittedEnvelope = {
        envelope: minted.value,
        channel: message.channel,
        tableId: table.table_id,
        receivedAt: message.at,
        provider: descriptor.provider,
        entitlement: entitlementRefOf(normalizedConfig.entitlement),
        accountedRawFields: table.fields.map((field) => field.raw_field),
      };
      return success(emission);
    },
    onEnvelope(registered: EnvelopeHandler): void {
      handler = registered;
    },
    pump(): SdkResult<number> {
      let delivered = 0;
      for (;;) {
        const next = session.nextEnvelope();
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

// ---------------------------------------------------------------------------
// The conversation-state helpers (the routed-request / engagement tracking)
// ---------------------------------------------------------------------------

/**
 * Narrows an untrusted record to a routed `CapabilityRequest` (the
 * mirror validation — the full exchange law incl. the L16a label scan).
 * The provider session calls this before routing a request onto the
 * wire; the failures are the T045 typed violations.
 */
export function narrowRoutedRequest(value: unknown): SdkResult<CapabilityRequest> {
  const validated = validateCapabilityRequest(value);
  if (!validated.ok) {
    return failure(
      protocolError(
        'invalid_configuration',
        `the routed request failed the CapabilityRequest law: ${validated.errors.map((error) => `(${error.code}) ${error.path}: ${error.message}`).join('; ')}`,
      ),
    );
  }
  return success(validated.value);
}

/** Guard: a structurally valid `Engagement` (the announced-engagement tracking). */
export function isAnnouncedEngagement(value: unknown): value is Engagement {
  return isEngagement(value);
}
