/**
 * @tradrl/adapter-equities — the guard transport: the provider pipeline.
 *
 * THE PROVIDER-SPECIFIC INBOUND PIPELINE (L2/L13 — all feed semantics
 * live here, never in the emitted canonical events): the session's
 * normalized engine (./contract/session.ts) drives an INJECTED transport
 * port; this module wraps that port so every inbound record is
 *
 *   1. schema-guarded (documented record validated; unknown fields are
 *      typed MappingErrors — the anti-silent-drop law; unknown record
 *      types and malformed documented fields are typed protocol errors),
 *   2. trading-calendar-checked (the DECLARED calendar laws, criterion
 *      9: the intraday index-level channel requires its trade date to be
 *      a declared session day, its dissemination instant to fall within
 *      a declared session window on a declared session day, and its
 *      dissemination day to BE the trade date — the intraday
 *      dissemination of trade date D happens on D; the constituent
 *      weights channel requires its trade date to be a declared session
 *      day; the corporate actions channel is declared NOT
 *      calendar-bound — announcements happen around the clock),
 *   3. sequenced (the documented per-index record sequences must
 *      STRICTLY advance — a regression is a typed
 *      sequence_regression), and
 *   4. deduplicated (corporate action ids must not repeat — a repeat
 *      is a typed duplicate_action).
 *
 * send() and close() pass through UNMANGLED (the SDK's neutrality
 * contract: raw subscription requests cross the port verbatim; the
 * guard never touches outbound traffic). Guard, calendar and sequence
 * failures surface through recv()'s typed failure branch — the session
 * engine propagates them without swallowing.
 *
 * Determinism: the guard's state (sequence trackers, action id set) is
 * a pure function of the record sequence it has consumed — the same
 * scripted transport always yields the same derived record stream,
 * byte-identically.
 */

import { failure, success, type SdkResult } from './contract/errors';
import type { InboundMessage, TransportPort, TransportRecvResult, TransportSendResult, OutboundMessage } from './contract/transport';
import type { JsonObject } from './contract/json';
import { isTimestampMs, type TimestampMs } from './contract/timestamp';
import { equitiesProtocolError } from './protocol';
import {
  guardIndexLevelPayload,
  guardConstituentWeightsPayload,
  guardCorporateActionsPayload,
  deriveIndexLevelPayload,
  deriveConstituentWeightPayload,
  deriveCorporateActionPayload,
} from './schemas';
import {
  EQUITIES_SESSION_CALENDAR,
  isSessionDay,
  isTradingInstant,
  tradeDateDayIndex,
  utcDayIndexAt,
} from './calendar';

/** The constructed guard transport: a TransportPort over the injected inner port. */
export interface EquitiesGuardTransport extends TransportPort {
  /**
   * Introspection: the last observed sequenceNumber per guarded index
   * stream (`channel|indexId`) and the seen corporate action ids, for
   * tests and health dashboards. Read-only view.
   */
  sequenceTrackers(): Readonly<Record<string, number>>;
  /** Introspection: the corporate action ids seen so far (the dedup set). */
  seenActionIds(): readonly string[];
}

/**
 * Wrap an injected transport port in the equities feed inbound guard
 * pipeline. The returned port is what the normalized session engine
 * drives.
 */
export function createEquitiesGuardTransport(inner: TransportPort): EquitiesGuardTransport {
  // Documented record sequences: keyed by channel|indexId.
  const indexSequences = new Map<string, number>();
  // Documented corporate action dedup: the action id set.
  const actionIds = new Set<string>();

  /** The intraday calendar law of the index-level channel (criterion 9). */
  function checkIndexLevelCalendar(channel: string, tradeDate: string, disseminationTimeMs: TimestampMs): SdkResult<null> {
    if (!isSessionDay(EQUITIES_SESSION_CALENDAR, tradeDate)) {
      return failure(
        equitiesProtocolError(
          'session_calendar_violation',
          `channel "${channel}": trade date "${tradeDate}" is not a declared session day of the trading calendar (weekend or non-session weekday) — index data is valued on trading days`,
        ),
      );
    }
    if (!isTradingInstant(EQUITIES_SESSION_CALENDAR, disseminationTimeMs)) {
      return failure(
        equitiesProtocolError(
          'session_calendar_violation',
          `channel "${channel}": the dissemination instant ${disseminationTimeMs} does not fall within a declared session window on a declared session day — the intraday index-level channel disseminates during the trading session`,
        ),
      );
    }
    const tradeDay = tradeDateDayIndex(tradeDate);
    if (tradeDay === null || utcDayIndexAt(disseminationTimeMs) !== tradeDay) {
      return failure(
        equitiesProtocolError(
          'session_calendar_violation',
          `channel "${channel}": the dissemination instant ${disseminationTimeMs} is not on the trade date "${tradeDate}" — an intraday dissemination of trade date D happens on D`,
        ),
      );
    }
    return success(null);
  }

  /** The trade-date calendar law of the constituent-weights channel. */
  function checkWeightsTradeDate(channel: string, tradeDate: string): SdkResult<null> {
    if (!isSessionDay(EQUITIES_SESSION_CALENDAR, tradeDate)) {
      return failure(
        equitiesProtocolError(
          'session_calendar_violation',
          `channel "${channel}": trade date "${tradeDate}" is not a declared session day of the trading calendar — reconstitution data is valued on trading days`,
        ),
      );
    }
    return success(null);
  }

  /** The documented per-index strictly-advancing sequence law. */
  function trackSequence(channel: string, indexId: string, sequenceNumber: number): SdkResult<null> {
    const key = `${channel}|${indexId}`;
    const previous = indexSequences.get(key);
    if (previous !== undefined && sequenceNumber <= previous) {
      return failure(
        equitiesProtocolError(
          'sequence_regression',
          `channel "${channel}" index "${indexId}": sequence number ${sequenceNumber} does not advance past the previous ${previous} — the documented feed record sequence must be monotonically advancing`,
        ),
      );
    }
    indexSequences.set(key, sequenceNumber);
    return success(null);
  }

  /** The corporate action dedup law. */
  function trackActionId(channel: string, actionId: string): SdkResult<null> {
    if (actionIds.has(actionId)) {
      return failure(
        equitiesProtocolError(
          'duplicate_action',
          `channel "${channel}": corporate action id "${actionId}" repeats — the feed must not re-deliver an announced action`,
        ),
      );
    }
    actionIds.add(actionId);
    return success(null);
  }

  /** Process one raw inbound message into exactly one emitter-facing message. */
  function processInbound(message: InboundMessage): SdkResult<InboundMessage> {
    if (!isTimestampMs(message.at)) {
      return failure(equitiesProtocolError('malformed_payload', `the inbound message receive time ${String(message.at)} is not a valid epoch-millisecond timestamp`));
    }
    const channel = message.channel;
    if (channel === 'indexLevel') {
      // Documented index level: guard -> calendar law -> sequence law -> derive.
      const level = guardIndexLevelPayload(message.payload);
      if (!level.ok) return failure(level.error);
      const calendar = checkIndexLevelCalendar(channel, level.value.tradeDate, level.value.disseminationTimeMs);
      if (!calendar.ok) return failure(calendar.error);
      const tracked = trackSequence(channel, level.value.indexId, level.value.sequenceNumber);
      if (!tracked.ok) return failure(tracked.error);
      const payload: JsonObject = deriveIndexLevelPayload(level.value);
      return success({ at: message.at, channel, payload });
    }
    if (channel === 'constituentWeights') {
      // Documented constituent weights: guard -> trade-date law -> sequence law -> derive.
      const weight = guardConstituentWeightsPayload(message.payload);
      if (!weight.ok) return failure(weight.error);
      const calendar = checkWeightsTradeDate(channel, weight.value.tradeDate);
      if (!calendar.ok) return failure(calendar.error);
      const tracked = trackSequence(channel, weight.value.indexId, weight.value.sequenceNumber);
      if (!tracked.ok) return failure(tracked.error);
      const payload: JsonObject = deriveConstituentWeightPayload(weight.value);
      return success({ at: message.at, channel, payload });
    }
    if (channel === 'corporateActions') {
      // Documented corporate actions: guard -> dedup law -> derive.
      // NOT calendar-bound by declaration: announcements happen around the clock.
      const action = guardCorporateActionsPayload(message.payload);
      if (!action.ok) return failure(action.error);
      const tracked = trackActionId(channel, action.value.actionId);
      if (!tracked.ok) return failure(tracked.error);
      const payload: JsonObject = deriveCorporateActionPayload(action.value);
      return success({ at: message.at, channel, payload });
    }
    // Unknown-to-guard channels pass through verbatim: the session's
    // routing owns unsubscribed channels (typed unknown_channel).
    return success(message);
  }

  const guard: EquitiesGuardTransport = {
    sequenceTrackers(): Readonly<Record<string, number>> {
      return { ...Object.fromEntries(indexSequences) };
    },
    seenActionIds(): readonly string[] {
      return [...actionIds];
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
