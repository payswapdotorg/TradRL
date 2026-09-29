/**
 * @tradrl/adapter-alternative-data — the guard transport: the provider
 * pipeline.
 *
 * THE PROVIDER-SPECIFIC INBOUND PIPELINE (L2/L13 — all vendor semantics
 * live here, never in the emitted canonical events): the session's
 * normalized engine (./contract/session.ts) drives an INJECTED transport
 * port; this module wraps that port so every inbound observation record
 * is
 *
 *   1. schema-guarded (documented record validated; unknown fields are
 *      typed MappingErrors — the anti-silent-drop law; unknown record
 *      types and malformed documented fields are typed protocol errors;
 *      the stateless window laws — reversed windows and mid-window
 *      releases — are enforced by the schema guards through the
 *      declared law's predicates, ../window-release.ts), and
 *   2. window-sequenced (the declared per-series window-overlap law:
 *      observation windows must TILE — a window that starts before the
 *      series' previous window ended is a typed
 *      observation_window_overlap).
 *
 * send() and close() pass through UNMANGLED (the SDK's neutrality
 * contract: raw subscription requests cross the port verbatim; the
 * guard never touches outbound traffic). Guard and window failures
 * surface through recv()'s typed failure branch — the session engine
 * propagates them without swallowing.
 *
 * Determinism: the guard's state (the per-series window end
 * high-water-marks) is a pure function of the record sequence it has
 * consumed — the same scripted transport always yields the same derived
 * record stream, byte-identically.
 */

import { failure, success, type SdkResult } from './contract/errors';
import type { InboundMessage, TransportPort, TransportRecvResult, TransportSendResult, OutboundMessage } from './contract/transport';
import type { JsonObject } from './contract/json';
import { isTimestampMs, type TimestampMs } from './contract/timestamp';
import { altDataProtocolError } from './protocol';
import {
  guardSentimentObservationPayload,
  guardOnChainMetricPayload,
  guardEconomicObservationPayload,
  guardSatelliteObservationPayload,
  deriveSentimentPayload,
  deriveOnChainPayload,
  deriveEconomicPayload,
  deriveSatellitePayload,
} from './schemas';
import { windowsOverlap } from './window-release';

/** The constructed guard transport: a TransportPort over the injected inner port. */
export interface AltDataGuardTransport extends TransportPort {
  /**
   * Introspection: the last observed observation window end per guarded
   * series (`channel|seriesKey`), for tests and health dashboards.
   * Read-only view.
   */
  windowTrackers(): Readonly<Record<string, number>>;
}

/**
 * Wrap an injected transport port in the alternative-data inbound guard
 * pipeline. The returned port is what the normalized session engine
 * drives.
 */
export function createAltDataGuardTransport(inner: TransportPort): AltDataGuardTransport {
  // Documented observation window ends: keyed by channel|seriesKey
  // (sentiment/economic/satellite key on seriesId; onChain keys on chainId).
  // Values are schema-validated timestamps (branded on store).
  const windowEnds = new Map<string, TimestampMs>();

  /** The declared per-series window-overlap law (windows tile, never overlap). */
  function trackWindow(
    channel: string,
    seriesKey: string,
    windowStartMs: TimestampMs,
    windowEndMs: TimestampMs,
  ): SdkResult<null> {
    const key = `${channel}|${seriesKey}`;
    const previous = windowEnds.get(key);
    if (previous !== undefined && windowsOverlap(previous, windowStartMs)) {
      return failure(
        altDataProtocolError(
          'observation_window_overlap',
          `channel "${channel}" series "${seriesKey}": observation window starting at ${windowStartMs} overlaps the series' previous window (which ended at ${previous}) — observation windows must tile without overlap`,
        ),
      );
    }
    windowEnds.set(key, windowEndMs as TimestampMs);
    return success(null);
  }

  /** Process one raw inbound message into exactly one emitter-facing message. */
  function processInbound(message: InboundMessage): SdkResult<InboundMessage> {
    if (!isTimestampMs(message.at)) {
      return failure(altDataProtocolError('malformed_payload', `the inbound message receive time ${String(message.at)} is not a valid epoch-millisecond timestamp`));
    }
    const channel = message.channel;
    if (channel === 'sentiment') {
      // Documented sentiment observation: guard (window laws included) -> window sequencing -> derive.
      const observation = guardSentimentObservationPayload(message.payload);
      if (!observation.ok) return failure(observation.error);
      const tracked = trackWindow(channel, observation.value.seriesId, observation.value.windowStartMs, observation.value.windowEndMs);
      if (!tracked.ok) return failure(tracked.error);
      const payload: JsonObject = deriveSentimentPayload(observation.value);
      return success({ at: message.at, channel, payload });
    }
    if (channel === 'onChain') {
      // Documented on-chain metric: guard -> window sequencing (keyed by chain) -> derive.
      const metric = guardOnChainMetricPayload(message.payload);
      if (!metric.ok) return failure(metric.error);
      const tracked = trackWindow(channel, metric.value.chainId, metric.value.windowStartMs, metric.value.windowEndMs);
      if (!tracked.ok) return failure(tracked.error);
      const payload: JsonObject = deriveOnChainPayload(metric.value);
      return success({ at: message.at, channel, payload });
    }
    if (channel === 'economicSeries') {
      // Documented economic series observation: guard -> window sequencing -> derive.
      const observation = guardEconomicObservationPayload(message.payload);
      if (!observation.ok) return failure(observation.error);
      const tracked = trackWindow(channel, observation.value.seriesId, observation.value.windowStartMs, observation.value.windowEndMs);
      if (!tracked.ok) return failure(tracked.error);
      const payload: JsonObject = deriveEconomicPayload(observation.value);
      return success({ at: message.at, channel, payload });
    }
    if (channel === 'satelliteSeries') {
      // Documented satellite observation: guard -> window sequencing -> derive.
      const observation = guardSatelliteObservationPayload(message.payload);
      if (!observation.ok) return failure(observation.error);
      const tracked = trackWindow(channel, observation.value.seriesId, observation.value.windowStartMs, observation.value.windowEndMs);
      if (!tracked.ok) return failure(tracked.error);
      const payload: JsonObject = deriveSatellitePayload(observation.value);
      return success({ at: message.at, channel, payload });
    }
    // Unknown-to-guard channels pass through verbatim: the session's
    // routing owns unsubscribed channels (typed unknown_channel).
    return success(message);
  }

  const guard: AltDataGuardTransport = {
    windowTrackers(): Readonly<Record<string, number>> {
      return { ...Object.fromEntries(windowEnds) };
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
      return { ok: true, message: processed.value };
    },
  };
  return guard;
}
