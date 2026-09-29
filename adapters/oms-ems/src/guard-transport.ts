/**
 * @tradrl/adapter-oms-ems — the guard transport: the provider pipeline.
 *
 * THE PROVIDER-SPECIFIC INBOUND PIPELINE (L2/L13 — all OMS/EMS semantics
 * live here, never in the emitted canonical events): the session's
 * normalized engine (./contract/session.ts) drives an INJECTED transport
 * port; this module wraps that port so every inbound message on the
 * documented state channel is
 *
 *   1. schema-guarded (the documented ORDER_STATE fields validated;
 *      unknown fields are typed MappingErrors — the anti-silent-drop law;
 *      unknown recordType discriminators and malformed documented fields
 *      are typed protocol errors; unconvertible documented times are
 *      typed invalid_time_field errors), and
 *   2. state-sequenced (the documented per-order continuity law: the
 *      record's sequence must strictly advance per order — a regression
 *      or repeat is a typed protocol error), and
 *   3. derived (the documented record becomes the canonical escape-hatch
 *      form `{ data: {...canonical vocabulary...}, updatedAtMs }` —
 *      see ../schemas.ts deriveOrderStatePayload).
 *
 * send() and close() pass through UNMANGLED (the SDK's neutrality
 * contract: raw subscription requests AND the routing path's built
 * ROUTE_ORDER instructions cross the port verbatim; the guard never
 * touches outbound traffic — the L8 routing checks live in
 * ../routing.ts, before any message exists). Guard and sequence
 * failures surface through recv()'s typed failure branch — the session
 * engine propagates them without swallowing.
 *
 * Determinism: the guard's state (per-order sequence trackers) is a pure
 * function of the message sequence it has consumed — the same scripted
 * transport always yields the same derived stream, byte-identically.
 */

import { failure, success, type SdkResult } from './contract/errors';
import type { InboundMessage, TransportPort, TransportRecvResult, TransportSendResult, OutboundMessage } from './contract/transport';
import type { JsonObject } from './contract/json';
import { isTimestampMs } from './contract/timestamp';
import { deepFreeze } from './contract/freeze';
import { omsEmsProtocolError } from './protocol';
import { guardOrderStatePayload, deriveOrderStatePayload, type NormalizedOrderState } from './schemas';

/** The constructed guard transport: a TransportPort over the injected inner port. */
export interface OmsEmsGuardTransport extends TransportPort {
  /**
   * Introspection: the last documented sequence observed per order
   * (keyed by the documented orderId), for tests and health dashboards.
   * Read-only view.
   */
  orderSequences(): Readonly<Record<string, number>>;
}

/**
 * Wrap an injected transport port in the OMS/EMS inbound guard pipeline.
 * The returned port is what the normalized session engine drives.
 */
export function createOmsEmsGuardTransport(inner: TransportPort): OmsEmsGuardTransport {
  // Documented per-order record sequencing, keyed by the documented orderId.
  const orderSequences = new Map<string, number>();

  /** Enforce the documented per-order sequencing law for one validated record. */
  function trackOrderState(state: NormalizedOrderState): SdkResult<null> {
    const previous = orderSequences.get(state.orderId);
    if (previous !== undefined && state.sequence <= previous) {
      return failure(
        omsEmsProtocolError(
          'state_sequence_regression',
          `order "${state.orderId}": sequence ${state.sequence} does not advance past the previous ${previous} — the documented per-order record sequence is strictly increasing`,
        ),
      );
    }
    orderSequences.set(state.orderId, state.sequence);
    return success(null);
  }

  /** Process one raw inbound message into 0..n emitter-facing messages. */
  function processInbound(message: InboundMessage): SdkResult<readonly InboundMessage[]> {
    if (!isTimestampMs(message.at)) {
      return failure(omsEmsProtocolError('malformed_payload', `the inbound message receive time ${String(message.at)} is not a valid epoch-millisecond timestamp`));
    }
    const channel = message.channel;
    if (channel === 'orderState') {
      // Documented ORDER_STATE: guard -> sequence -> derive.
      const state = guardOrderStatePayload(message.payload);
      if (!state.ok) return failure(state.error);
      const tracked = trackOrderState(state.value);
      if (!tracked.ok) return failure(tracked.error);
      const derived: JsonObject = deriveOrderStatePayload(state.value);
      return success([{ at: message.at, channel, payload: derived }]);
    }
    // Unknown-to-guard channels pass through verbatim: the session's
    // routing owns unsubscribed channels (typed unknown_channel).
    return success([message]);
  }

  const guard: OmsEmsGuardTransport = {
    orderSequences(): Readonly<Record<string, number>> {
      return deepFreeze({ ...Object.fromEntries(orderSequences) }) as Readonly<Record<string, number>>;
    },
    send(message: OutboundMessage): TransportSendResult {
      return inner.send(message); // pass-through, unmangled (the neutrality contract)
    },
    close(): void {
      inner.close();
    },
    recv(): TransportRecvResult {
      for (;;) {
        const received = inner.recv();
        if (!received.ok) return received;
        if (received.message === null) {
          return { ok: true, message: null }; // drained
        }
        const processed = processInbound(received.message);
        if (!processed.ok) {
          return { ok: false, error: processed.error };
        }
        const messages = processed.value;
        if (messages.length === 0) {
          continue; // a derived empty payload emits nothing — keep pulling
        }
        return { ok: true, message: messages[0] };
      }
    },
  };
  return guard;
}
