/**
 * @tradrl/adapter-arena — the guard transport: the provider pipeline
 * (schema validation, dedup, correlation + goalpost pre-checks).
 *
 * THE PROVIDER-SPECIFIC INBOUND PIPELINE (L2/L13 — all wire semantics
 * live here, never in the minted canonical envelopes): the session's
 * engine (./contract/session.ts) drives an INJECTED transport port;
 * this module wraps that port so every inbound wire message is
 *
 *   1. schema-guarded (the documented channel shape; unknown
 *      messageKind discriminators and malformed documented fields are
 *      typed protocol errors — never silent drops),
 *   2. deduplicated (documented wire message ids must not repeat — a
 *      repeat is a typed `duplicate_message`), and
 *   3. pre-checked against the CONVERSATION state the provider session
 *      owns (fail-fast at the boundary — the PLATFORM'S EXCHANGE
 *      remains the authority; the adapter TRANSLATES, the exchange
 *      DECIDES):
 *        - a quote must answer a ROUTED request (`unknown_correlation`),
 *          postdate it (L4 — `conversation_order_violation`), offer the
 *          requested deliverable kind and accept the frozen goalposts
 *          VERBATIM by canonical bytes (`verification_drift` — the
 *          negotiation integrity law);
 *        - a delivery for an ANNOUNCED engagement must match its frozen
 *          deliverable kind, postdate its open instant (L4) and meet
 *          its deadline (`engagement_contract_refused`) — deliveries
 *          for unannounced engagements pass (the exchange owns the
 *          refusal; the adapter never invents engagement law).
 *
 * send() and close() pass through UNMANGLED (the neutrality contract:
 * raw request frames cross the port verbatim; the guard never touches
 * outbound traffic). Guard failures surface through recv()'s typed
 * failure branch — the engine propagates them without swallowing.
 *
 * Determinism: the guard's state (message-id set) is a pure function
 * of the message sequence it has consumed — the same scripted
 * transport always yields the same delivery stream, byte-identically.
 */

import { failure, type AdapterError, type SdkResult } from './contract/errors';
import { canonicalJson } from './contract/provider';
import type { CapabilityRequest, DeliverableKind, Engagement } from './contract/provider-envelopes';
import type { InboundMessage, TransportPort, TransportRecvResult, TransportSendResult, OutboundMessage } from './contract/transport';
import { isTimestampMs } from './contract/timestamp';
import { arenaProtocolError } from './protocol';
import { guardArenaCatalogPayload, guardArenaDeliveryPayload, guardArenaQuotePayload } from './schemas';
import { ARENA_DELIVERABLE_KIND_MAP } from './descriptor';

/** The canonical DeliverableKind -> wire code map (the declared enum map, inverted). */
const WIRE_CODE_OF_KIND: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(ARENA_DELIVERABLE_KIND_MAP).map(([code, kind]) => [kind, code])),
);

/** The wire deliverable-type code for a canonical kind (documented translation). */
function wireCodeOfKind(kind: DeliverableKind): string {
  const code = WIRE_CODE_OF_KIND[kind];
  if (code === undefined) {
    throw new Error(`no documented wire code for the deliverable kind "${kind}" (a declaration drift — the declared map covers the full ADAPTERS vocabulary)`);
  }
  return code;
}

/**
 * The conversation state the provider session owns and the guard
 * pre-checks against (the routed requests + the announced engagements
 * + the session's L12 scope).
 */
export interface ArenaConversationState {
  /** The session's tenant scope (L12 — every routed request must live inside it). */
  readonly tenantId: string;
  /** The session's project scope (L12). */
  readonly projectId: string;
  /** The routed requests, by request id (the correlation the wire echoes). */
  readonly routedRequests: Map<string, CapabilityRequest>;
  /** The announced engagements, by engagement id (the frozen contracts deliveries are pre-checked against). */
  readonly announcedEngagements: Map<string, Engagement>;
}

/** Creates a fresh conversation state within one tenant/project scope (L12). */
export function createArenaConversationState(tenantId: string, projectId: string): ArenaConversationState {
  return {
    tenantId,
    projectId,
    routedRequests: new Map<string, CapabilityRequest>(),
    announcedEngagements: new Map<string, Engagement>(),
  };
}

/** The guard's disposition for one inbound message. */
type GuardOutcome =
  | { readonly kind: 'deliver'; readonly message: InboundMessage }
  | { readonly kind: 'failure'; readonly error: AdapterError };

/** The constructed guard transport: a TransportPort over the injected inner port. */
export interface ArenaGuardTransport extends TransportPort {
  /** Introspection: the wire message ids seen so far (the dedup set). Read-only view. */
  seenMessageIds(): readonly string[];
}

/**
 * Wrap an injected transport port in the Arena wire inbound guard
 * pipeline. The returned port is what the session engine drives.
 */
export function createArenaGuardTransport(inner: TransportPort, state: ArenaConversationState): ArenaGuardTransport {
  // Documented message dedup: the wire must not re-deliver a message.
  const messageIds = new Set<string>();

  /** The documented message dedup law. */
  function trackMessageId(channel: string, messageId: string): SdkResult<null> {
    if (messageIds.has(messageId)) {
      return failure(
        arenaProtocolError(
          'duplicate_message',
          `channel "${channel}": wire message id "${messageId}" repeats — the wire must not re-deliver a message`,
        ),
      );
    }
    messageIds.add(messageId);
    return { ok: true, value: null };
  }

  /** The correlation + goalpost pre-checks for one wire quote message. */
  function precheckQuote(message: InboundMessage): GuardOutcome {
    const guarded = guardArenaQuotePayload(message.payload);
    if (!guarded.ok) return { kind: 'failure', error: guarded.error };
    const quote = guarded.value;
    const tracked = trackMessageId(message.channel, quote.messageId);
    if (!tracked.ok) return { kind: 'failure', error: tracked.error };

    const request = state.routedRequests.get(quote.requestRef);
    if (request === undefined) {
      return {
        kind: 'failure',
        error: arenaProtocolError(
          'unknown_correlation',
          `the quote's correlation ref "${quote.requestRef}" resolves to no request routed through this session — the wire answered a conversation this adapter never opened`,
        ),
      };
    }
    // L4: the quote postdates the request it answers.
    if (quote.respondedAtMs < request.requestedAt) {
      return {
        kind: 'failure',
        error: arenaProtocolError(
          'conversation_order_violation',
          `the quote instant (${quote.respondedAtMs}) predates the routed request's instant (${request.requestedAt}) — history never runs backwards (L4)`,
        ),
      };
    }
    // THE GOALPOST LAW: the echoed verification contract is the routed
    // request's VERBATIM, by canonical bytes — goalposts never move.
    if (canonicalJson(quote.verificationEcho) !== canonicalJson(request.verification)) {
      return {
        kind: 'failure',
        error: arenaProtocolError(
          'verification_drift',
          'the quote\'s echoed verification contract is not the routed request\'s frozen goalposts VERBATIM (canonical bytes differ) — the negotiation integrity law refuses the drift',
        ),
      };
    }
    // The quote answers what was asked: the deliverable kind matches.
    if (quote.deliverableType !== wireCodeOfKind(request.deliverableKind)) {
      return {
        kind: 'failure',
        error: arenaProtocolError(
          'engagement_contract_refused',
          `the quote offers wire deliverable type "${quote.deliverableType}" but the routed request asked for "${wireCodeOfKind(request.deliverableKind)}" (${request.deliverableKind})`,
        ),
      };
    }
    return { kind: 'deliver', message };
  }

  /** The correlation + contract pre-checks for one wire delivery message. */
  function precheckDelivery(message: InboundMessage): GuardOutcome {
    const guarded = guardArenaDeliveryPayload(message.payload);
    if (!guarded.ok) return { kind: 'failure', error: guarded.error };
    const delivery = guarded.value;
    const tracked = trackMessageId(message.channel, delivery.messageId);
    if (!tracked.ok) return { kind: 'failure', error: tracked.error };

    const engagement = state.announcedEngagements.get(delivery.engagementRef);
    if (engagement === undefined) {
      // A delivery for an unannounced engagement passes: the PLATFORM'S
      // EXCHANGE owns the refusal (engagement_unknown / deliverable
      // mismatch / deadline) — the adapter never invents engagement law.
      return { kind: 'deliver', message };
    }
    if (delivery.deliverableType !== wireCodeOfKind(engagement.deliverableKind)) {
      return {
        kind: 'failure',
        error: arenaProtocolError(
          'engagement_contract_refused',
          `the delivery's wire deliverable type "${delivery.deliverableType}" does not match the announced engagement's frozen kind "${engagement.deliverableKind}" (wire code "${wireCodeOfKind(engagement.deliverableKind)}")`,
        ),
      };
    }
    if (delivery.deliveredAtMs < engagement.openedAt) {
      return {
        kind: 'failure',
        error: arenaProtocolError(
          'conversation_order_violation',
          `the delivery instant (${delivery.deliveredAtMs}) predates the announced engagement's open instant (${engagement.openedAt}) — history never runs backwards (L4)`,
        ),
      };
    }
    if (engagement.deadline !== null && delivery.deliveredAtMs > engagement.deadline) {
      return {
        kind: 'failure',
        error: arenaProtocolError(
          'engagement_contract_refused',
          `the delivery instant (${delivery.deliveredAtMs}) is after the announced engagement's frozen deadline (${engagement.deadline}) — late work is refused at the boundary, never silently accepted`,
        ),
      };
    }
    return { kind: 'deliver', message };
  }

  /** Process one raw inbound message into its guard disposition. */
  function processInbound(message: InboundMessage): GuardOutcome {
    if (!isTimestampMs(message.at)) {
      return {
        kind: 'failure',
        error: arenaProtocolError('malformed_payload', `the inbound message receive time ${String(message.at)} is not a valid epoch-millisecond timestamp`),
      };
    }
    if (message.channel === 'arenaCatalog') {
      const guarded = guardArenaCatalogPayload(message.payload);
      if (!guarded.ok) return { kind: 'failure', error: guarded.error };
      const tracked = trackMessageId(message.channel, guarded.value.messageId);
      if (!tracked.ok) return { kind: 'failure', error: tracked.error };
      return { kind: 'deliver', message };
    }
    if (message.channel === 'arenaQuotes') {
      return precheckQuote(message);
    }
    if (message.channel === 'arenaDeliveries') {
      return precheckDelivery(message);
    }
    // Unknown-to-guard channels pass through verbatim: the engine's
    // routing owns unsubscribed channels (typed unknown_channel).
    return { kind: 'deliver', message };
  }

  const guard: ArenaGuardTransport = {
    seenMessageIds(): readonly string[] {
      return [...messageIds];
    },
    send(message: OutboundMessage): TransportSendResult {
      return inner.send(message); // pass-through, unmangled (the neutrality contract)
    },
    close(): void {
      inner.close();
    },
    recv(): TransportRecvResult {
      for (;;) {
        // 1. Pull the next raw message from the injected port.
        const received = inner.recv();
        if (!received.ok) return received;
        if (received.message === null) {
          return { ok: true, message: null }; // drained
        }
        const message = received.message;
        // 2. Guard + pre-check the message.
        const outcome = processInbound(message);
        if (outcome.kind === 'failure') {
          return { ok: false, error: outcome.error };
        }
        // 3. Deliver the (validated) message up to the engine.
        return { ok: true, message: outcome.message };
      }
    },
  };
  return guard;
}
