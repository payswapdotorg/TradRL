/**
 * @tradrl/adapter-news — the injected transport port.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/transport.ts (law D-004:
 * structural mirrors, never imports — the frozen workspace lockfile
 * forbids package dependencies). NO NETWORK IN THIS PACKAGE (Work Order T038: "You ship NO
 * fetch/websocket/redis clients"). The adapter consumes the INJECTED
 * port — send/recv/close — and wraps it in the session's guard transport
 * (../guard-transport.ts), which validates and normalizes documented
 * payloads on the way UP. The port is deliberately SYNCHRONOUS-pull so
 * the same script always produces the same canonical stream,
 * byte-identically (determinism).
 */

import type { AdapterError } from './errors';
import type { JsonObject } from './json';
import type { TimestampMs } from './timestamp';

/** A request the adapter sends DOWN the transport (e.g. a subscription request). */
export interface OutboundMessage {
  /** The raw channel name in the transport's own vocabulary. */
  readonly channel: string;
  /** The raw request payload — opaque to the SDK, passed through unmangled. */
  readonly payload: JsonObject;
}

/**
 * A message the transport delivers UP to the adapter. `at` is the receive
 * time — the only clock input the deterministic SDK ever consumes; real
 * transports stamp it with their receive clock, scripted transports stamp
 * it from the timeline.
 */
export interface InboundMessage {
  readonly at: TimestampMs;
  readonly channel: string;
  readonly payload: JsonObject;
}

/** Outcome of send(): the port accepted the request, or a typed transport failure. */
export type TransportSendResult = { readonly ok: true } | { readonly ok: false; readonly error: AdapterError };

/**
 * Outcome of recv(): the next message (null when the transport is drained),
 * or a typed failure — TransportError for port failures, TimeoutError when
 * a declared receive wait expired (both are `AdapterError`s; the kind
 * discriminates).
 */
export type TransportRecvResult =
  | { readonly ok: true; readonly message: InboundMessage | null }
  | { readonly ok: false; readonly error: AdapterError };

/**
 * The injected transport port. Interface ONLY — the SDK ships no
 * implementation (the scripted fake in the test harness excepted, being
 * test infrastructure).
 */
export interface TransportPort {
  /** Send a request down the transport. */
  send(message: OutboundMessage): TransportSendResult;
  /** Pull the next available inbound message; null when drained. */
  recv(): TransportRecvResult;
  /** Close the port. Idempotent at the port level (the session enforces the lifecycle). */
  close(): void;
}

/** Structural guard for an inbound message. */
export function isInboundMessage(value: unknown): value is InboundMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.at === 'number' &&
    Number.isInteger(candidate.at) &&
    candidate.at >= 0 &&
    typeof candidate.channel === 'string' &&
    candidate.channel.length > 0 &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null &&
    !Array.isArray(candidate.payload)
  );
}
