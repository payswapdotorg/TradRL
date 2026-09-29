/**
 * @tradrl/adapter-brokers — the guard transport: the provider pipeline.
 *
 * THE PROVIDER-SPECIFIC INBOUND PIPELINE (L2/L13 — all broker-gateway
 * semantics live here, never in the emitted canonical events): the
 * session's normalized engine (./contract/session.ts) drives an INJECTED
 * transport port; this module wraps that port so every inbound message on
 * the documented report channel is
 *
 *   1. schema-guarded (the documented ExecutionReport fields validated;
 *      unknown fields are typed MappingErrors — the anti-silent-drop law;
 *      unknown MsgType discriminators and malformed documented fields are
 *      typed protocol errors; unconvertible documented times are typed
 *      invalid_time_field errors), and
 *   2. execution-sequenced (the documented report continuity laws: CumQty
 *      is cumulative, so it must not regress per order; ExecID is unique
 *      per order — regressions and repeats are typed protocol errors), and
 *   3. derived (the documented report becomes the canonical escape-hatch
 *      form `{ data: {...canonical vocabulary...}, transactTimeMs }` —
 *      see ../schemas.ts deriveExecutionReportPayload).
 *
 * send() and close() pass through UNMANGLED (the SDK's neutrality
 * contract: raw subscription requests AND the routing path's built
 * NewOrderSingle messages cross the port verbatim; the guard never
 * touches outbound traffic — the L8 routing checks live in
 * ../routing.ts, before any message exists). Guard and sequence
 * failures surface through recv()'s typed failure branch — the session
 * engine propagates them without swallowing.
 *
 * Determinism: the guard's state (per-order cumulative/exec-id trackers)
 * is a pure function of the message sequence it has consumed — the same
 * scripted transport always yields the same derived stream,
 * byte-identically.
 */

import { failure, success, type SdkResult } from './contract/errors';
import type { InboundMessage, TransportPort, TransportRecvResult, TransportSendResult, OutboundMessage } from './contract/transport';
import type { JsonObject } from './contract/json';
import { isTimestampMs } from './contract/timestamp';
import { deepFreeze } from './contract/freeze';
import { compareDecimal } from './contract/decimals';
import { brokerProtocolError } from './protocol';
import { guardExecutionReportPayload, deriveExecutionReportPayload, type NormalizedExecutionReport } from './schemas';

/** The per-order sequencing state the guard tracks (introspectable, read-only view). */
export interface BrokerOrderSequencing {
  /** The last CumQty observed for the order (the cumulative filled quantity). */
  readonly last_cum_qty: string;
  /** Every ExecID observed for the order, in arrival order (documented uniqueness — repeats are typed errors). */
  readonly exec_ids: readonly string[];
}

/** The constructed guard transport: a TransportPort over the injected inner port. */
export interface BrokerGuardTransport extends TransportPort {
  /**
   * Introspection: the per-order sequencing state (keyed by the
   * documented OrderID), for tests and health dashboards. Read-only view.
   */
  orderSequencing(): Readonly<Record<string, BrokerOrderSequencing>>;
}

/**
 * Wrap an injected transport port in the broker inbound guard pipeline.
 * The returned port is what the normalized session engine drives.
 */
export function createBrokerGuardTransport(inner: TransportPort): BrokerGuardTransport {
  // Documented report continuity, keyed by the documented OrderID.
  const orderState = new Map<string, { lastCumQty: string; execIds: string[] }>();

  /** Enforce the documented sequencing laws for one validated report. */
  function trackExecutionReport(report: NormalizedExecutionReport): SdkResult<null> {
    const previous = orderState.get(report.OrderID);
    if (previous !== undefined) {
      // The cumulative law first (CumQty may stay equal across non-fill
      // reports — an acknowledgement after a partial fill changes
      // nothing), then the exec-id uniqueness law — both documented, both
      // typed, both tested.
      if (compareDecimal(report.CumQty, previous.lastCumQty) < 0) {
        return failure(
          brokerProtocolError(
            'cum_qty_regression',
            `order "${report.OrderID}": CumQty regressed from ${previous.lastCumQty} to ${report.CumQty} — the documented cumulative filled quantity must not go backwards`,
          ),
        );
      }
      if (previous.execIds.includes(report.ExecID)) {
        return failure(
          brokerProtocolError(
            'duplicate_exec_id',
            `order "${report.OrderID}": ExecID "${report.ExecID}" repeats — the documented execution report id is unique per order`,
          ),
        );
      }
    }
    const nextExecIds = previous === undefined ? [report.ExecID] : [...previous.execIds, report.ExecID];
    orderState.set(report.OrderID, { lastCumQty: report.CumQty, execIds: nextExecIds });
    return success(null);
  }

  /** Process one raw inbound message into 0..n emitter-facing messages. */
  function processInbound(message: InboundMessage): SdkResult<readonly InboundMessage[]> {
    if (!isTimestampMs(message.at)) {
      return failure(brokerProtocolError('malformed_payload', `the inbound message receive time ${String(message.at)} is not a valid epoch-millisecond timestamp`));
    }
    const channel = message.channel;
    if (channel === 'executionReport') {
      // Documented ExecutionReport: guard -> sequence -> derive.
      const report = guardExecutionReportPayload(message.payload);
      if (!report.ok) return failure(report.error);
      const tracked = trackExecutionReport(report.value);
      if (!tracked.ok) return failure(tracked.error);
      const derived: JsonObject = deriveExecutionReportPayload(report.value);
      return success([{ at: message.at, channel, payload: derived }]);
    }
    // Unknown-to-guard channels pass through verbatim: the session's
    // routing owns unsubscribed channels (typed unknown_channel).
    return success([message]);
  }

  const guard: BrokerGuardTransport = {
    orderSequencing(): Readonly<Record<string, BrokerOrderSequencing>> {
      const view: Record<string, BrokerOrderSequencing> = {};
      for (const [orderId, state] of orderState) {
        view[orderId] = deepFreeze({ last_cum_qty: state.lastCumQty, exec_ids: [...state.execIds] }) as BrokerOrderSequencing;
      }
      return deepFreeze(view) as Readonly<Record<string, BrokerOrderSequencing>>;
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
