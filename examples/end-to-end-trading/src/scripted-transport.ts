/**
 * T048 — the slice's scripted transport ports.
 *
 * THE ADAPTER LAW (T036/T037/T038): "no network — the transport is an
 * injected port". The REAL adapter sessions take a `TransportPort`
 * (send/recv/close — the SDK's shape, mirrored inside each adapter).
 * This module is the slice's OWN deterministic implementation of that
 * port: a fixed inbound timeline of raw provider messages, drained in
 * order; the sent SUBSCRIBE frames are recorded verbatim (the
 * neutrality contract — the session passes requests through unmangled).
 *
 * This is the piece a production host replaces with a real websocket
 * client: everything downstream of `recv()` is the REAL platform code.
 */

import type { JsonObject } from '../../../adapters/binance/src/contract/json';
import type { TimestampMs } from '../../../adapters/binance/src/contract/timestamp';
import { transportError } from '../../../adapters/binance/src/contract/errors';
import type {
  InboundMessage,
  OutboundMessage,
  TransportPort,
  TransportRecvResult,
  TransportSendResult,
} from '../../../adapters/binance/src/contract/transport';

/** One scripted inbound raw message: the receive instant + channel + raw JSON payload. */
export interface ScriptedInbound {
  readonly at: TimestampMs;
  readonly channel: string;
  readonly payload: JsonObject;
}

/** The recorded outbound frame (the adapter's SUBSCRIBE request, verbatim). */
export interface RecordedOutbound {
  readonly channel: string;
  readonly payload: JsonObject;
}

/**
 * Build one scripted transport port. Deterministic: the same timeline
 * always drains the same messages in the same order; `recv()` returns
 * null once drained; `close()` is idempotent at the port level (the
 * session enforces the lifecycle). The slice's timelines always drain
 * fully before close, so the failure branch is unreachable by design
 * (fail-closed anyway — a closed port never yields messages).
 */
export function scriptedTransport(timeline: readonly ScriptedInbound[]): { readonly port: TransportPort; readonly sent: () => readonly RecordedOutbound[] } {
  const queue: readonly ScriptedInbound[] = [...timeline];
  const sent: RecordedOutbound[] = [];
  let cursor = 0;
  let closed = false;
  const port: TransportPort = {
    send(message: OutboundMessage): TransportSendResult {
      if (closed) return { ok: false, error: transportError('transport_send_failed', 'the scripted transport is closed') };
      sent.push({ channel: message.channel, payload: message.payload });
      return { ok: true };
    },
    recv(): TransportRecvResult {
      if (closed) {
        return { ok: false, error: transportError('transport_unavailable', 'the scripted transport is closed') };
      }
      if (cursor >= queue.length) {
        return { ok: true, message: null };
      }
      const next = queue[cursor] as ScriptedInbound;
      void (next.at satisfies TimestampMs);
      cursor += 1;
      return { ok: true, message: { at: next.at, channel: next.channel, payload: next.payload } };
    },
    close(): void {
      closed = true;
    },
  };
  return { port, sent: () => [...sent] };
}
