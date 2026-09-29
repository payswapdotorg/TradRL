/**
 * @tradrl/adapter-binance — the guard transport: the provider pipeline.
 *
 * THE PROVIDER-SPECIFIC INBOUND PIPELINE (L2/L13 — all Binance semantics
 * live here, never in the emitted canonical events): the session's
 * normalized engine (./contract/session.ts) drives an INJECTED transport
 * port; this module wraps that port so every inbound message is
 *
 *   1. schema-guarded (documented payload validated; unknown fields are
 *      typed MappingErrors — the anti-silent-drop law; unknown message
 *      types and malformed documented fields are typed protocol errors),
 *   2. update-id sequenced (the documented depth stream continuity laws:
 *      depth-diff U/u ranges must be gapless and advancing; partial-depth
 *      lastUpdateId must not regress), and
 *   3. split (a documented two-sided depth diff becomes the canonical
 *      action-homogeneous book_delta sub-messages — see
 *      ./schemas.ts splitDepthDiff).
 *
 * send() and close() pass through UNMANGLED (the SDK's neutrality
 * contract: raw subscription requests cross the port verbatim; the
 * guard never touches outbound traffic). Guard and sequence failures
 * surface through recv()'s typed failure branch — the session engine
 * propagates them without swallowing.
 *
 * Determinism: the guard's state (sequence trackers, pending sub-message
 * queue) is a pure function of the message sequence it has consumed — the
 * same scripted transport always yields the same sub-message stream,
 * byte-identically.
 */

import { failure, success, type SdkResult } from './contract/errors';
import type { InboundMessage, TransportPort, TransportRecvResult, TransportSendResult, OutboundMessage } from './contract/transport';
import type { JsonObject } from './contract/json';
import { isTimestampMs } from './contract/timestamp';
import { binanceProtocolError } from './protocol';
import {
  guardBinancePayload,
  guardDepthDiffPayload,
  splitDepthDiff,
  type NormalizedDepthDiff,
} from './schemas';

/** The constructed guard transport: a TransportPort over the injected inner port. */
export interface BinanceGuardTransport extends TransportPort {
  /**
   * Introspection: the final update ids observed per guarded stream
   * (depth-diff: `channel|symbol`; partial depth: `channel`), for tests
   * and health dashboards. Read-only view.
   */
  sequenceTrackers(): Readonly<Record<string, number>>;
}

/**
 * Wrap an injected transport port in the Binance inbound guard pipeline.
 * The returned port is what the normalized session engine drives.
 */
export function createBinanceGuardTransport(inner: TransportPort): BinanceGuardTransport {
  // Documented update-id continuity: depthDiff keyed by channel|symbol
  // (the documented `s` field); partial depth keyed by channel (the
  // documented payload carries no symbol field).
  const diffLastFinal = new Map<string, number>();
  const snapshotLastUpdate = new Map<string, number>();
  let pending: InboundMessage[] = [];

  function trackDepthSnapshot(channel: string, payload: JsonObject): SdkResult<null> {
    const lastUpdateId = payload.lastUpdateId;
    if (lastUpdateId === undefined || typeof lastUpdateId !== 'number') {
      return failure(binanceProtocolError('malformed_payload', `channel "${channel}": the normalized payload must carry the lastUpdateId number`));
    }
    const previous = snapshotLastUpdate.get(channel);
    if (previous !== undefined && lastUpdateId < previous) {
      return failure(
        binanceProtocolError(
          'update_id_regression_snapshot',
          `channel "${channel}": lastUpdateId regressed from ${previous} to ${lastUpdateId} — the documented book-state id must not go backwards`,
        ),
      );
    }
    snapshotLastUpdate.set(channel, lastUpdateId);
    return success(null);
  }

  function trackDepthDiff(channel: string, diff: NormalizedDepthDiff): SdkResult<null> {
    const key = `${channel}|${diff.s}`;
    const previous = diffLastFinal.get(key);
    if (previous !== undefined) {
      // Regression first (the monotonic law), then the gapless-continuity
      // law — both documented, both typed, both tested.
      if (diff.u <= previous) {
        return failure(
          binanceProtocolError(
            'update_id_regression',
            `channel "${channel}" symbol "${diff.s}": final update id ${diff.u} does not advance past the previous ${previous} — the documented depth diff stream must be monotonically advancing`,
          ),
        );
      }
      if (diff.U !== previous + 1) {
        return failure(
          binanceProtocolError(
            'update_id_gap',
            `channel "${channel}" symbol "${diff.s}": first update id ${diff.U} is not the successor of the previous final id ${previous} — the documented depth diff stream must be gapless (resynchronize from a snapshot)`,
          ),
        );
      }
    }
    diffLastFinal.set(key, diff.u);
    return success(null);
  }

  /** Process one raw inbound message into 0..n emitter-facing sub-messages. */
  function processInbound(message: InboundMessage): SdkResult<readonly InboundMessage[]> {
    if (!isTimestampMs(message.at)) {
      return failure(binanceProtocolError('malformed_payload', `the inbound message receive time ${String(message.at)} is not a valid epoch-millisecond timestamp`));
    }
    const channel = message.channel;
    if (channel === 'depth') {
      // Documented partial depth: guard -> normalize -> lastUpdateId continuity.
      const guarded = guardBinancePayload(channel, message.payload);
      if (!guarded.ok) return failure(guarded.error);
      const tracked = trackDepthSnapshot(channel, guarded.value);
      if (!tracked.ok) return failure(tracked.error);
      return success([{ at: message.at, channel, payload: guarded.value }]);
    }
    if (channel === 'depthDiff') {
      // Documented depth diff: guard -> normalize -> U/u continuity -> split.
      const diff = guardDepthDiffPayload(message.payload);
      if (!diff.ok) return failure(diff.error);
      const tracked = trackDepthDiff(channel, diff.value);
      if (!tracked.ok) return failure(tracked.error);
      const subPayloads = splitDepthDiff(diff.value);
      const subMessages: InboundMessage[] = subPayloads.map((payload) => ({ at: message.at, channel, payload }));
      return success(subMessages);
    }
    if (channel === 'bookTicker' || channel === 'trade') {
      // Documented shapes: guard -> normalize; one emitter-facing message.
      const guarded = guardBinancePayload(channel, message.payload);
      if (!guarded.ok) return failure(guarded.error);
      return success([{ at: message.at, channel, payload: guarded.value }]);
    }
    // Unknown-to-guard channels pass through verbatim: the session's
    // routing owns unsubscribed channels (typed unknown_channel).
    return success([message]);
  }

  const guard: BinanceGuardTransport = {
    sequenceTrackers(): Readonly<Record<string, number>> {
      return { ...Object.fromEntries(diffLastFinal), ...Object.fromEntries(snapshotLastUpdate) };
    },
    send(message: OutboundMessage): TransportSendResult {
      return inner.send(message); // pass-through, unmangled (the neutrality contract)
    },
    close(): void {
      inner.close();
    },
    recv(): TransportRecvResult {
      for (;;) {
        const queued = pending.shift();
        if (queued !== undefined) {
          return { ok: true, message: queued };
        }
        const received = inner.recv();
        if (!received.ok) return received;
        if (received.message === null) {
          return { ok: true, message: null }; // drained
        }
        const processed = processInbound(received.message);
        if (!processed.ok) {
          return { ok: false, error: processed.error };
        }
        const subMessages = processed.value;
        if (subMessages.length === 0) {
          continue; // an empty documented diff emits nothing — keep pulling
        }
        pending = subMessages.slice(1);
        return { ok: true, message: subMessages[0] };
      }
    },
  };
  return guard;
}
