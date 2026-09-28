/**
 * @tradrl/provider-sdk — the injected transport port.
 *
 * NO NETWORK IN THIS PACKAGE (Work Order T036, law: "No network in this
 * package: transport is an injected port (interface)"). The SDK defines the
 * PORT — the minimal provider-neutral surface a concrete adapter's
 * transport must satisfy — and ships only a scripted fake implementation in
 * the test harness (harness/fake-transport.ts). Real transports (websocket
 * clients, REST pollers, file readers) are injected by concrete adapters
 * (T037+); the SDK's behavior is therefore a pure function of the
 * (scripted) transport: determinism by construction.
 *
 * The port is deliberately SYNCHRONOUS-pull: `recv()` returns the next
 * available message or null when drained. Asynchronous transports adapt
 * themselves to this shape (queueing inbound messages) — the canonical
 * emission path never awaits, so the same script always produces the same
 * stream, byte-identically.
 *
 * Message payloads are closed JSON values (see json.ts): raw vendor
 * payloads cross the boundary typed, never as bare unknowns.
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
