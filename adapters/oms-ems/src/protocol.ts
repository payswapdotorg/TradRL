/**
 * @tradrl/adapter-oms-ems — provider-namespace protocol error codes.
 *
 * THE ADAPTER-NAMESPACE EXTENSION (documented, deliberate — the T037
 * discipline, carried into this lane by T039): the SDK's closed
 * `AdapterErrorCode` union (mirrored verbatim in ./contract/errors.ts)
 * covers the provider-NEUTRAL failure families; the OMS/EMS gateway's
 * documented protocol adds failures that have no neutral name —
 * order-state sequence violations, unknown message types, malformed
 * documented payloads, quota enforcement refusals — and THIS lane's
 * existential laws add the L8 routing refusals (routing without a valid
 * APPROVED decision, routing under a thrown kill switch), the
 * credential-opacity violation, and the RECONCILIATION law's structured
 * mismatches (the OMS's order state vs the broker's execution reports).
 * Those live HERE, in the provider layer (L2/L13: provider semantics
 * stay in the adapter), carried through the SAME frozen AdapterError
 * shape at runtime — kind 'protocol', a provider-namespace code string.
 *
 * Law lines (Work Order T039, section 3): "L8 ABSOLUTE ... the adapter
 * NEVER executes authority — it TRANSLATES approved decisions. An
 * adapter call path that could route an order without a valid APPROVED
 * decision record is a typed error (design + negative tests). Credential
 * VALUES never appear — opaque refs only (T019's law)." And section 4:
 * "an OMS state reconciliation — that is this Work Order."
 */

import { protocolError, type AdapterError, type ProtocolErrorCode } from './contract/errors';

/**
 * The OMS/EMS gateway protocol failure codes (adapter namespace, protocol
 * family). Each cites the documented protocol behavior or the law it
 * enforces.
 */
export type OmsEmsProtocolErrorCode =
  /** An order-state record's sequence does not strictly advance per order (the documented per-order monotonic sequence). */
  | 'state_sequence_regression'
  /** The message's documented recordType discriminator is not one this channel carries. */
  | 'unknown_message_type'
  /** A documented field is present but violates its documented shape. */
  | 'malformed_payload'
  /** A scripted schedule exceeds a declared gateway rate/quota limit (enforcement is the adapter's duty). */
  | 'rate_quota_exceeded'
  /** L8: order routing was attempted with a decision record that is not a valid APPROVE decision (a refusal, or a malformed record). */
  | 'decision_not_approved'
  /** L8: order routing was refused because the standing kill switch is thrown (the adapter honors the injected switch state; it never re-derives it). */
  | 'kill_switch_thrown'
  /** T019's credential-opacity law: the routing bundle embeds a credential VALUE under a credential-shaped key (opaque refs only). */
  | 'credential_value_present'
  /** A documented time field does not convert to an epoch-millisecond timestamp. */
  | 'invalid_time_field'
  /** Reconciliation: the broker's execution reports are not in documented execution order (a repeat or regression of the execution id). */
  | 'reconcile_report_sequence'
  /** Reconciliation: the cumulative filled quantity law is violated (CumQty must advance by exactly each trade's LastQty). */
  | 'reconcile_cum_qty'
  /** Reconciliation: the open-quantity law is violated (LeavesQty must equal OrderQty minus CumQty while the order is live). */
  | 'reconcile_leaves_qty'
  /** Reconciliation: the average-price law is violated (AvgPx times CumQty must equal the summed trade notional). */
  | 'reconcile_avg_px'
  /** Reconciliation: the OMS's order-state record disagrees with the broker's execution reports (final quantity, open quantity or status). */
  | 'reconcile_state_mismatch';

/** Runtime list of the OMS/EMS protocol codes. */
export const OMS_EMS_PROTOCOL_CODES: readonly OmsEmsProtocolErrorCode[] = [
  'state_sequence_regression',
  'unknown_message_type',
  'malformed_payload',
  'rate_quota_exceeded',
  'decision_not_approved',
  'kill_switch_thrown',
  'credential_value_present',
  'invalid_time_field',
  'reconcile_report_sequence',
  'reconcile_cum_qty',
  'reconcile_leaves_qty',
  'reconcile_avg_px',
  'reconcile_state_mismatch',
];

/**
 * Construct a frozen ProtocolError carrying an OMS/EMS-namespace code.
 *
 * The runtime object is an ordinary AdapterError ({kind: 'protocol', code,
 * message}); the cast is the single, documented place where the
 * provider-namespace code enters the neutral shape (see the module header
 * for why the type union cannot admit it statically).
 */
export function omsEmsProtocolError(code: OmsEmsProtocolErrorCode, message: string): AdapterError {
  return protocolError(code as unknown as ProtocolErrorCode, message);
}

/**
 * Narrow an error to an OMS/EMS protocol code (the runtime converse of
 * {@link omsEmsProtocolError}). Returns null when the value is not a
 * protocol-family AdapterError carrying one of the declared codes.
 */
export function omsEmsProtocolCodeOf(value: unknown): OmsEmsProtocolErrorCode | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'protocol' || typeof candidate.code !== 'string') return null;
  return (OMS_EMS_PROTOCOL_CODES as readonly string[]).includes(candidate.code)
    ? (candidate.code as OmsEmsProtocolErrorCode)
    : null;
}

/** Guard: the value is a protocol-family AdapterError carrying the given OMS/EMS code. */
export function isOmsEmsProtocolError(value: unknown, code: OmsEmsProtocolErrorCode): boolean {
  return omsEmsProtocolCodeOf(value) === code;
}
