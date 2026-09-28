/**
 * @tradrl/provider-sdk — the scripted fake transport (test harness).
 *
 * NO NETWORK IN THIS PACKAGE: the SDK's only transport implementation is
 * this TEST-harness fake, which replays a DECLARED script — inbound
 * messages with their timeline instants, optional scripted failures and
 * an optional declared receive timeout. Every SDK behavior is therefore a
 * pure function of the script: the determinism contract ("same script ->
 * byte-identical emission stream") is enforced against exactly this
 * transport.
 *
 * Scripted semantics (all deterministic):
 *   - `recv()` delivers inbound messages in timeline order. A message's
 *     `at` is its receive time — the only "clock" the SDK consumes.
 *   - `recv_failures[i].before_index` fires ONCE when the next-to-deliver
 *     index reaches it (a transient port failure; the message stays
 *     queued, a retry delivers it).
 *   - `receive_timeout_ms` models the adapter's wait budget: when the gap
 *     from the last delivered message to the next scripted one exceeds
 *     the budget, recv() returns a TimeoutError ONCE (the wait expired;
 *     the message stays queued — it "arrives" on the next wait).
 *   - `send()` records every outbound request (introspectable for
 *     pass-through assertions) and can script send failures by index.
 *   - After `close()`, send/recv are typed TransportErrors.
 */

import { invalidField, isNonEmptyString, isPositiveSafeInteger, isRecord, missingField } from '../fields';
import { failure, transportError, timeoutError, type SdkFieldError, type SdkResult } from '../errors';
import type { JsonObject } from '../json';
import { isJsonObject } from '../json';
import { isTimestampMs, type TimestampMs } from '../timestamp';
import type { OutboundMessage, TransportPort, TransportRecvResult, TransportSendResult } from '../transport';
import { deepFreeze } from '../freeze';

/** One scripted inbound message at a timeline instant. */
export interface ScriptedInbound {
  readonly at: TimestampMs;
  readonly channel: string;
  readonly payload: JsonObject;
}

/** A scripted transient recv failure, firing once when the queue index reaches it. */
export interface ScriptedRecvFailure {
  /** Fires when the next-to-deliver index equals this (0-based; may equal inbound.length to fail while drained). */
  readonly before_index: number;
  readonly message: string;
}

/** A scripted send failure, firing once at the given send ordinal (0-based). */
export interface ScriptedSendFailure {
  readonly on_send_index: number;
  readonly message: string;
}

/** The declared transport script. */
export interface TransportScript {
  /** Inbound messages in timeline order (non-decreasing `at`). */
  readonly inbound: readonly ScriptedInbound[];
  /** Transient recv failures (unique indices). */
  readonly recv_failures: readonly ScriptedRecvFailure[];
  /** Send failures (unique ordinals). */
  readonly send_failures: readonly ScriptedSendFailure[];
  /**
   * The modeled receive-wait budget: a gap from the last delivered message
   * to the next scripted one strictly greater than this fires a
   * TimeoutError once. Null disables timeout modeling.
   */
  readonly receive_timeout_ms: number | null;
}

/** Constructed-result type of {@link createFakeTransport}. */
export type FakeTransportConstruction =
  | { readonly ok: true; readonly transport: FakeTransport }
  | { readonly ok: false; readonly errors: readonly SdkFieldError[] };

/** The scripted fake transport (implements the TransportPort interface). */
export interface FakeTransport extends TransportPort {
  /** The validated (frozen) script. */
  readonly script: TransportScript;
  /** Every outbound request sent so far (pass-through introspection). */
  sent(): readonly OutboundMessage[];
  /** Whether the port is closed. */
  isClosed(): boolean;
  /** How many inbound messages have been delivered so far. */
  deliveredCount(): number;
}

/** Validate an untrusted transport script (collect-all; frozen). */
export function validateTransportScript(value: unknown): { readonly ok: true; readonly value: TransportScript } | { readonly ok: false; readonly errors: readonly SdkFieldError[] } {
  const errors: SdkFieldError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidField('script', 'must be an object')] };
  }

  if (value.inbound === undefined) {
    errors.push(missingField('inbound'));
  } else if (!Array.isArray(value.inbound)) {
    errors.push(invalidField('inbound', 'must be an array of scripted inbound messages'));
  } else {
    let previousAt: number | null = null;
    value.inbound.forEach((message, index) => {
      const path = `inbound[${index}]`;
      if (!isRecord(message)) {
        errors.push(invalidField(path, 'must be an object with at, channel and payload'));
        return;
      }
      if (!isTimestampMs(message.at)) errors.push(invalidField(`${path}.at`, 'must be a valid epoch-millisecond timestamp'));
      else if (previousAt !== null && (message.at as number) < previousAt)
        errors.push(invalidField(`${path}.at`, 'must not precede the previous message (timeline order)'));
      else previousAt = message.at as number;

      if (!isNonEmptyString(message.channel)) errors.push(invalidField(`${path}.channel`, 'must be a non-empty string'));
      if (message.payload === undefined) errors.push(missingField(`${path}.payload`));
      else if (!isJsonObject(message.payload)) errors.push(invalidField(`${path}.payload`, 'must be a JSON object'));
    });
  }

  if (value.recv_failures === undefined) {
    errors.push(missingField('recv_failures'));
  } else if (!Array.isArray(value.recv_failures)) {
    errors.push(invalidField('recv_failures', 'must be an array of scripted recv failures'));
  } else {
    const seen = new Set<number>();
    const inboundLength = Array.isArray(value.inbound) ? value.inbound.length : 0;
    value.recv_failures.forEach((entry, index) => {
      const path = `recv_failures[${index}]`;
      if (!isRecord(entry)) {
        errors.push(invalidField(path, 'must be an object with before_index and message'));
        return;
      }
      if (typeof entry.before_index !== 'number' || !Number.isSafeInteger(entry.before_index) || entry.before_index < 0) {
        errors.push(invalidField(`${path}.before_index`, 'must be a non-negative safe integer'));
      } else if (entry.before_index > inboundLength) {
        errors.push(invalidField(`${path}.before_index`, 'must not exceed the inbound timeline length'));
      } else if (seen.has(entry.before_index)) {
        errors.push(invalidField(`${path}.before_index`, `duplicate failure index ${entry.before_index}`));
      } else {
        seen.add(entry.before_index);
      }
      if (!isNonEmptyString(entry.message)) errors.push(invalidField(`${path}.message`, 'must be a non-empty string'));
    });
  }

  if (value.send_failures === undefined) {
    errors.push(missingField('send_failures'));
  } else if (!Array.isArray(value.send_failures)) {
    errors.push(invalidField('send_failures', 'must be an array of scripted send failures'));
  } else {
    const seen = new Set<number>();
    value.send_failures.forEach((entry, index) => {
      const path = `send_failures[${index}]`;
      if (!isRecord(entry)) {
        errors.push(invalidField(path, 'must be an object with on_send_index and message'));
        return;
      }
      if (typeof entry.on_send_index !== 'number' || !Number.isSafeInteger(entry.on_send_index) || entry.on_send_index < 0) {
        errors.push(invalidField(`${path}.on_send_index`, 'must be a non-negative safe integer'));
      } else if (seen.has(entry.on_send_index)) {
        errors.push(invalidField(`${path}.on_send_index`, `duplicate failure ordinal ${entry.on_send_index}`));
      } else {
        seen.add(entry.on_send_index);
      }
      if (!isNonEmptyString(entry.message)) errors.push(invalidField(`${path}.message`, 'must be a non-empty string'));
    });
  }

  if (value.receive_timeout_ms === undefined) {
    errors.push(missingField('receive_timeout_ms'));
  } else if (value.receive_timeout_ms !== null && !isPositiveSafeInteger(value.receive_timeout_ms)) {
    errors.push(invalidField('receive_timeout_ms', 'must be a positive safe integer of milliseconds or null'));
  }

  if (errors.length > 0) return { ok: false, errors };

  const normalized: TransportScript = {
    inbound: value.inbound as readonly ScriptedInbound[],
    recv_failures: value.recv_failures as readonly ScriptedRecvFailure[],
    send_failures: value.send_failures as readonly ScriptedSendFailure[],
    receive_timeout_ms: value.receive_timeout_ms as number | null,
  };
  return { ok: true, value: deepFreeze(normalized as unknown) as unknown as TransportScript };
}

/**
 * Construct the scripted fake transport. The script is validated and
 * frozen; the transport's subsequent behavior is a pure function of it.
 */
export function createFakeTransport(value: unknown): FakeTransportConstruction {
  const validated = validateTransportScript(value);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  const script = validated.value;

  let closed = false;
  let nextIndex = 0;
  let delivered = 0;
  let sentCount = 0;
  let lastDeliveredAt: TimestampMs | null = null;
  const sentLog: OutboundMessage[] = [];
  const firedRecvFailures = new Set<number>();
  const firedSendFailures = new Set<number>();
  const firedTimeouts = new Set<number>();

  const transport: FakeTransport = {
    script,
    sent(): readonly OutboundMessage[] {
      return [...sentLog];
    },
    isClosed(): boolean {
      return closed;
    },
    deliveredCount(): number {
      return delivered;
    },
    send(message: OutboundMessage): TransportSendResult {
      if (closed) {
        return {
          ok: false,
          error: transportError('transport_unavailable', 'the transport port is closed — send is unavailable'),
        };
      }
      const ordinal = sentCount;
      sentCount += 1;
      const scripted = script.send_failures.find(
        (entry) => entry.on_send_index === ordinal && !firedSendFailures.has(ordinal),
      );
      if (scripted !== undefined) {
        firedSendFailures.add(ordinal);
        return {
          ok: false,
          error: transportError('transport_send_failed', `scripted send failure: ${scripted.message}`),
        };
      }
      sentLog.push({ channel: message.channel, payload: message.payload });
      return { ok: true };
    },
    recv(): TransportRecvResult {
      if (closed) {
        return {
          ok: false,
          error: transportError('transport_unavailable', 'the transport port is closed — recv is unavailable'),
        };
      }
      // Transient scripted failure (fires once; the message stays queued).
      const failureAtIndex = script.recv_failures.find(
        (entry) => entry.before_index === nextIndex && !firedRecvFailures.has(entry.before_index),
      );
      if (failureAtIndex !== undefined) {
        firedRecvFailures.add(failureAtIndex.before_index);
        return {
          ok: false,
          error: transportError('transport_recv_failed', `scripted recv failure: ${failureAtIndex.message}`),
        };
      }
      if (nextIndex >= script.inbound.length) {
        return { ok: true, message: null }; // drained
      }
      const next = script.inbound[nextIndex];
      // Timeout modeling: the wait for this message would have expired once.
      if (
        script.receive_timeout_ms !== null &&
        lastDeliveredAt !== null &&
        next.at - lastDeliveredAt > script.receive_timeout_ms &&
        !firedTimeouts.has(nextIndex)
      ) {
        firedTimeouts.add(nextIndex);
        return {
          ok: false,
          error: timeoutError(
            'receive_timeout',
            `the scripted gap to the next message (${next.at - lastDeliveredAt}ms) exceeds the declared receive timeout (${script.receive_timeout_ms}ms)`,
          ),
        };
      }
      nextIndex += 1;
      delivered += 1;
      lastDeliveredAt = next.at;
      return { ok: true, message: { at: next.at, channel: next.channel, payload: next.payload } };
    },
    close(): void {
      closed = true;
    },
  };

  return { ok: true, transport };
}

/** Convenience: build a scripted inbound message. */
export function scriptedInbound(at: number, channel: string, payload: JsonObject): ScriptedInbound {
  return { at: at as TimestampMs, channel, payload };
}

/** Convenience: an empty script (drained transport). */
export function emptyScript(): TransportScript {
  return { inbound: [], recv_failures: [], send_failures: [], receive_timeout_ms: null };
}

/** Convenience result helper for tests: unwrap or throw. */
export function unwrapTransport<T>(result: SdkResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected transport failure: ${result.error.kind}/${result.error.code}: ${result.error.message}`);
}
