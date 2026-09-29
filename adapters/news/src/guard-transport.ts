/**
 * @tradrl/adapter-news — the guard transport: the provider pipeline
 * (with the declared EMBARGO hold-and-release discipline).
 *
 * THE PROVIDER-SPECIFIC INBOUND PIPELINE (L2/L13 — all wire semantics
 * live here, never in the emitted canonical events): the session's
 * normalized engine (./contract/session.ts) drives an INJECTED transport
 * port; this module wraps that port so every inbound item is
 *
 *   1. schema-guarded (documented item validated; unknown fields are
 *      typed MappingErrors — the anti-silent-drop law; unknown record
 *      types and malformed documented fields are typed protocol errors),
 *   2. deduplicated (documented item ids must not repeat — a repeat is
 *      a typed duplicate_item), and
 *   3. embargo-classified per the DECLARED quartet policy
 *      (../embargo.ts): an item RECEIVED before its embargo lift
 *      instant is HELD; a held item is delivered when a later timeline
 *      instant reaches its lift instant, RE-STAMPED to that instant —
 *      so the emitter-facing receive time (and therefore available_time,
 *      per the table's receive-time availability basis) IS the lift
 *      instant, never before the embargo (L4 honest quartets).
 *
 *      Release order: held items are kept sorted by lift instant
 *      (stable), and released BEFORE the message that advanced the
 *      timeline past their lift — the delivered stream's receive
 *      instants stay non-decreasing. A timeline that DRAINS while an
 *      embargoed item remains held is a typed `embargo_not_lifted`
 *      failure — the item never became available in the observed window
 *      and the adapter refuses to drop it silently (the anti-silent-drop
 *      law applied to time).
 *
 * send() and close() pass through UNMANGLED (the SDK's neutrality
 * contract: raw subscription requests cross the port verbatim; the
 * guard never touches outbound traffic). Guard and dedup failures
 * surface through recv()'s typed failure branch — the session engine
 * propagates them without swallowing.
 *
 * Determinism: the guard's state (item id set, held queue, pending
 * deliveries) is a pure function of the item sequence it has consumed —
 * the same scripted transport always yields the same delivery stream,
 * byte-identically.
 */

import { failure, type AdapterError, type SdkResult } from './contract/errors';
import type { InboundMessage, TransportPort, TransportRecvResult, TransportSendResult, OutboundMessage } from './contract/transport';
import type { JsonObject } from './contract/json';
import { isTimestampMs, type TimestampMs } from './contract/timestamp';
import { newsProtocolError } from './protocol';
import {
  guardPublicHeadlinePayload,
  guardWireItemPayload,
  derivePublicHeadlinePayload,
  deriveWireItemPayload,
} from './schemas';
import { isEmbargoedAt, embargoLiftAt } from './embargo';

/** One item held under the declared embargo policy. */
interface HeldItem {
  readonly channel: string;
  /** The derived (guard-consumed fields dropped) emitter-facing payload. */
  readonly payload: JsonObject;
  /** The embargo lift instant — the instant the item becomes deliverable. */
  readonly liftAt: TimestampMs;
}

/** The guard's disposition for one inbound message. */
type GuardOutcome =
  | { readonly kind: 'deliver'; readonly message: InboundMessage }
  | { readonly kind: 'hold'; readonly item: HeldItem }
  | { readonly kind: 'failure'; readonly error: AdapterError };

/** The constructed guard transport: a TransportPort over the injected inner port. */
export interface NewsGuardTransport extends TransportPort {
  /**
   * Introspection: the item ids seen so far (the dedup set), for tests
   * and health dashboards. Read-only view.
   */
  seenItemIds(): readonly string[];
  /** Introspection: the lift instants of items currently held under the embargo policy. */
  heldItems(): readonly TimestampMs[];
}

/**
 * Wrap an injected transport port in the news wire inbound guard
 * pipeline. The returned port is what the normalized session engine
 * drives.
 */
export function createNewsGuardTransport(inner: TransportPort): NewsGuardTransport {
  // Documented item dedup: the wire must not re-deliver an item.
  const itemIds = new Set<string>();
  // Items held under the declared embargo policy, sorted by lift instant.
  let held: HeldItem[] = [];
  // Derived messages ready for delivery (released holds + passed messages).
  let pending: InboundMessage[] = [];
  // The receive instant of the last message pulled from the inner port
  // (the timeline's current head — the only "present" the guard knows).
  let lastPulledAt: TimestampMs | null = null;

  /** The documented item dedup law. */
  function trackItemId(channel: string, itemId: string): SdkResult<null> {
    if (itemIds.has(itemId)) {
      return failure(
        newsProtocolError(
          'duplicate_item',
          `channel "${channel}": wire item id "${itemId}" repeats — the feed must not re-deliver an item`,
        ),
      );
    }
    itemIds.add(itemId);
    return { ok: true, value: null };
  }

  /** Insert an item into the held queue, stably sorted by lift instant. */
  function insertHeld(item: HeldItem): void {
    let index = held.length;
    for (let position = 0; position < held.length; position += 1) {
      if (held[position].liftAt > item.liftAt) {
        index = position;
        break;
      }
    }
    held = [...held.slice(0, index), item, ...held.slice(index)];
  }

  /** Process one raw inbound message into its guard disposition. */
  function processInbound(message: InboundMessage): GuardOutcome {
    if (!isTimestampMs(message.at)) {
      return {
        kind: 'failure',
        error: newsProtocolError('malformed_payload', `the inbound message receive time ${String(message.at)} is not a valid epoch-millisecond timestamp`),
      };
    }
    const channel = message.channel;
    if (channel === 'publicHeadlines') {
      // Documented public headline: guard -> dedup -> derive -> deliver.
      // The public tier carries no embargo field by documented shape.
      const item = guardPublicHeadlinePayload(message.payload);
      if (!item.ok) return { kind: 'failure', error: item.error };
      const tracked = trackItemId(channel, item.value.itemId);
      if (!tracked.ok) return { kind: 'failure', error: tracked.error };
      const payload: JsonObject = derivePublicHeadlinePayload(item.value);
      return { kind: 'deliver', message: { at: message.at, channel, payload } };
    }
    if (channel === 'licensedWire') {
      // Documented licensed wire item: guard -> dedup -> embargo policy.
      const item = guardWireItemPayload(message.payload);
      if (!item.ok) return { kind: 'failure', error: item.error };
      const tracked = trackItemId(channel, item.value.itemId);
      if (!tracked.ok) return { kind: 'failure', error: tracked.error };
      const payload: JsonObject = deriveWireItemPayload(item.value);
      if (isEmbargoedAt(item.value, message.at)) {
        const liftAt = embargoLiftAt(item.value);
        if (liftAt === null) {
          // Unreachable (isEmbargoedAt implies a lift instant); defense in depth.
          return {
            kind: 'failure',
            error: newsProtocolError('malformed_payload', 'an embargoed item must carry a validated embargo lift instant'),
          };
        }
        return { kind: 'hold', item: { channel, payload, liftAt } };
      }
      return { kind: 'deliver', message: { at: message.at, channel, payload } };
    }
    // Unknown-to-guard channels pass through verbatim: the session's
    // routing owns unsubscribed channels (typed unknown_channel).
    return { kind: 'deliver', message };
  }

  const guard: NewsGuardTransport = {
    seenItemIds(): readonly string[] {
      return [...itemIds];
    },
    heldItems(): readonly TimestampMs[] {
      return held.map((item) => item.liftAt);
    },
    send(message: OutboundMessage): TransportSendResult {
      return inner.send(message); // pass-through, unmangled (the neutrality contract)
    },
    close(): void {
      inner.close();
    },
    recv(): TransportRecvResult {
      for (;;) {
        // 1. Deliver queued messages first (released holds, in order).
        const queued = pending.shift();
        if (queued !== undefined) {
          return { ok: true, message: queued };
        }
        // 2. Pull the next raw item from the injected port.
        const received = inner.recv();
        if (!received.ok) return received;
        if (received.message === null) {
          // 3. Drained: a held embargoed item is a typed failure — never a silent drop.
          if (held.length > 0) {
            return {
              ok: false,
              error: newsProtocolError(
                'embargo_not_lifted',
                `the scripted timeline drained while ${held.length} embargoed wire item(s) remain held (earliest lift instant ${held[0].liftAt}) — the records never became available in the observed window; extend the timeline, never drop them silently`,
              ),
            };
          }
          return { ok: true, message: null };
        }
        const message = received.message;
        lastPulledAt = message.at;
        // 4. Guard + classify the item.
        const outcome = processInbound(message);
        if (outcome.kind === 'failure') {
          return { ok: false, error: outcome.error };
        }
        // 5. Release held items whose lift instant the timeline has reached
        //    (BEFORE the newly arrived item — their availability precedes it).
        if (lastPulledAt !== null) {
          while (held.length > 0 && held[0].liftAt <= lastPulledAt) {
            const release = held[0];
            held = held.slice(1);
            pending = [...pending, { at: release.liftAt, channel: release.channel, payload: release.payload }];
          }
        }
        // 6. Queue the new item (or hold it).
        if (outcome.kind === 'hold') {
          insertHeld(outcome.item);
        } else {
          pending = [...pending, outcome.message];
        }
        // Loop: pending is now non-empty (or the item was held) — deliver next.
      }
    },
  };
  return guard;
}
