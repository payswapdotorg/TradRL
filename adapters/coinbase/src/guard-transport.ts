/**
 * @tradrl/adapter-coinbase — the guard transport: the provider pipeline.
 *
 * THE PROVIDER-SPECIFIC INBOUND PIPELINE (L2/L13 — all Coinbase semantics
 * live here, never in the emitted canonical events): the session's
 * normalized engine (./contract/session.ts) drives an INJECTED transport
 * port; this module wraps that port so every inbound message is
 *
 *   1. schema-guarded (documented payload validated; unknown fields are
 *      typed MappingErrors — the anti-silent-drop law; unknown message
 *      types — e.g. an l2update on the snapshot-only level2_batch channel
 *      — and malformed documented fields are typed protocol errors), and
 *   2. normalized (level arrays become level records; documented ISO-8601
 *      times become epoch milliseconds — deterministic, no Date.parse),
 *   and
 *   3. message-sequenced (the documented per-product `sequence` numbers on
 *      the ticker and match channels must strictly advance — a regression
 *      is a typed protocol error; the first message on each stream
 *      establishes the baseline).
 *
 * send() and close() pass through UNMANGLED (the SDK's neutrality
 * contract: raw subscription requests cross the port verbatim; the guard
 * never touches outbound traffic). Guard and sequence failures surface
 * through recv()'s typed failure branch — the session engine propagates
 * them without swallowing.
 *
 * Determinism: the guard's state (sequence trackers) is a pure function
 * of the message sequence it has consumed — the same scripted transport
 * always yields the same normalized stream, byte-identically.
 */

import { failure, success, type SdkResult } from './contract/errors';
import type { InboundMessage, TransportPort, TransportRecvResult, TransportSendResult, OutboundMessage } from './contract/transport';
import { isTimestampMs } from './contract/timestamp';
import { coinbaseProtocolError } from './protocol';
import { guardCoinbasePayload, isNormalizedTicker, isNormalizedMatch } from './schemas';

/** The constructed guard transport: a TransportPort over the injected inner port. */
export interface CoinbaseGuardTransport extends TransportPort {
  /**
   * Introspection: the last observed documented sequence number per
   * guarded stream (`channel|product_id`), for tests and health
   * dashboards. Read-only view.
   */
  sequenceTrackers(): Readonly<Record<string, number>>;
}

/**
 * Wrap an injected transport port in the Coinbase inbound guard pipeline.
 * The returned port is what the normalized session engine drives.
 */
export function createCoinbaseGuardTransport(inner: TransportPort): CoinbaseGuardTransport {
  // Documented message sequences: keyed by channel|product_id (the
  // documented product_id field). level2_batch snapshots carry no
  // sequence field and are not tracked.
  const lastSequence = new Map<string, number>();

  function trackSequencedMessage(channel: string, payload: InboundMessage['payload']): SdkResult<null> {
    const record = payload as Record<string, unknown>;
    const productId = record.product_id;
    const sequence = record.sequence;
    if (typeof productId !== 'string' || !isTimestampMsSafeInteger(sequence)) {
      return failure(
        coinbaseProtocolError('malformed_payload', `channel "${channel}": the normalized payload must carry product_id and a sequence number`),
      );
    }
    const key = `${channel}|${productId}`;
    const previous = lastSequence.get(key);
    if (previous !== undefined && sequence <= previous) {
      return failure(
        coinbaseProtocolError(
          'sequence_regression',
          `channel "${channel}" product "${productId}": sequence ${sequence} does not advance past the previous ${previous} — the documented message sequence must be strictly increasing`,
        ),
      );
    }
    lastSequence.set(key, sequence);
    return success(null);
  }

  /** Process one raw inbound message into exactly one normalized message. */
  function processInbound(message: InboundMessage): SdkResult<readonly InboundMessage[]> {
    if (!isTimestampMs(message.at)) {
      return failure(coinbaseProtocolError('malformed_payload', `the inbound message receive time ${String(message.at)} is not a valid epoch-millisecond timestamp`));
    }
    const channel = message.channel;
    if (channel === 'level2_batch' || channel === 'ticker' || channel === 'match') {
      const guarded = guardCoinbasePayload(channel, message.payload);
      if (!guarded.ok) return failure(guarded.error);
      if (channel === 'ticker' || channel === 'match') {
        // The documented sequence semantics: strictly advancing per product.
        const tracked = trackSequencedMessage(channel, guarded.value);
        if (!tracked.ok) return failure(tracked.error);
        // Introspection-only narrowing (the guard already validated the shape).
        if (channel === 'ticker' && !isNormalizedTicker(guarded.value)) {
          return failure(coinbaseProtocolError('malformed_payload', 'channel "ticker": the normalized payload failed its structural re-check'));
        }
        if (channel === 'match' && !isNormalizedMatch(guarded.value)) {
          return failure(coinbaseProtocolError('malformed_payload', 'channel "match": the normalized payload failed its structural re-check'));
        }
      }
      return success([{ at: message.at, channel, payload: guarded.value }]);
    }
    // Unknown-to-guard channels pass through verbatim: the session's
    // routing owns unsubscribed channels (typed unknown_channel).
    return success([message]);
  }

  const guard: CoinbaseGuardTransport = {
    sequenceTrackers(): Readonly<Record<string, number>> {
      return { ...Object.fromEntries(lastSequence) };
    },
    send(message: OutboundMessage): TransportSendResult {
      return inner.send(message); // pass-through, unmangled (the neutrality contract)
    },
    close(): void {
      inner.close();
    },
    recv(): TransportRecvResult {
      const received = inner.recv();
      if (!received.ok) return received;
      if (received.message === null) {
        return { ok: true, message: null }; // drained
      }
      const processed = processInbound(received.message);
      if (!processed.ok) {
        return { ok: false, error: processed.error };
      }
      return { ok: true, message: processed.value[0] };
    },
  };
  return guard;
}

/** Local total check for the sequence-number shape (positive safe integer). */
function isTimestampMsSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
