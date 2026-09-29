/**
 * @tradrl/adapter-brokers — provider-namespace protocol error codes.
 *
 * THE ADAPTER-NAMESPACE EXTENSION (documented, deliberate — the T037
 * discipline): the SDK's closed `AdapterErrorCode` union (mirrored
 * verbatim in ./contract/errors.ts) covers the provider-NEUTRAL failure
 * families; the broker gateway's documented protocol adds failures that
 * have no neutral name — execution-report sequencing violations, unknown
 * message types, malformed documented payloads, quota enforcement
 * refusals — and THIS lane's existential laws add the L8 routing
 * refusals (routing without a valid APPROVED decision, routing under a
 * thrown kill switch) and the credential-opacity violation. Those live
 * HERE, in the provider layer (L2/L13: provider semantics stay in the
 * adapter), carried through the SAME frozen AdapterError shape at
 * runtime — kind 'protocol', a provider-namespace code string. The real
 * SDK's `isAdapterError` guard accepts them (it checks kind/code/message
 * as strings), and the SDK's own contract harness asserts them by code.
 *
 * Law lines (Work Order T039, section 3): "L8 ABSOLUTE ... the adapter
 * NEVER executes authority — it TRANSLATES approved decisions. An
 * adapter call path that could route an order without a valid APPROVED
 * decision record is a typed error (design + negative tests). Credential
 * VALUES never appear — opaque refs only (T019's law)."
 */

import { protocolError, type AdapterError, type ProtocolErrorCode } from './contract/errors';

/**
 * The broker-gateway protocol failure codes (adapter namespace, protocol
 * family). Each cites the documented protocol behavior or the law it
 * enforces.
 */
export type BrokerProtocolErrorCode =
  /** An execution report's CumQty does not advance past the previous report's for the same order (documented cumulative semantics). */
  | 'cum_qty_regression'
  /** An execution report's ExecID repeats for the same order (documented uniqueness). */
  | 'duplicate_exec_id'
  /** The message's documented MsgType discriminator is not one this channel carries. */
  | 'unknown_message_type'
  /** A documented field is present but violates its documented shape. */
  | 'malformed_payload'
  /** A scripted schedule exceeds a declared broker rate/quota limit (enforcement is the adapter's duty). */
  | 'rate_quota_exceeded'
  /** L8: order routing was attempted with a decision record that is not a valid APPROVE decision (a refusal, or a malformed record). */
  | 'decision_not_approved'
  /** L8: order routing was refused because the standing kill switch is thrown (the adapter honors the injected switch state; it never re-derives it). */
  | 'kill_switch_thrown'
  /** T019's credential-opacity law: the routing bundle embeds a credential VALUE under a credential-shaped key (opaque refs only). */
  | 'credential_value_present'
  /** A documented time field does not convert to an epoch-millisecond timestamp. */
  | 'invalid_time_field';

/** Runtime list of the broker protocol codes. */
export const BROKER_PROTOCOL_CODES: readonly BrokerProtocolErrorCode[] = [
  'cum_qty_regression',
  'duplicate_exec_id',
  'unknown_message_type',
  'malformed_payload',
  'rate_quota_exceeded',
  'decision_not_approved',
  'kill_switch_thrown',
  'credential_value_present',
  'invalid_time_field',
];

/**
 * Construct a frozen ProtocolError carrying a broker-namespace code.
 *
 * The runtime object is an ordinary AdapterError ({kind: 'protocol', code,
 * message}); the cast is the single, documented place where the
 * provider-namespace code enters the neutral shape (see the module header
 * for why the type union cannot admit it statically).
 */
export function brokerProtocolError(code: BrokerProtocolErrorCode, message: string): AdapterError {
  return protocolError(code as unknown as ProtocolErrorCode, message);
}

/**
 * Narrow an error to a broker protocol code (the runtime converse of
 * {@link brokerProtocolError}). Returns null when the value is not a
 * protocol-family AdapterError carrying one of the declared codes.
 */
export function brokerProtocolCodeOf(value: unknown): BrokerProtocolErrorCode | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'protocol' || typeof candidate.code !== 'string') return null;
  return (BROKER_PROTOCOL_CODES as readonly string[]).includes(candidate.code)
    ? (candidate.code as BrokerProtocolErrorCode)
    : null;
}

/** Guard: the value is a protocol-family AdapterError carrying the given broker code. */
export function isBrokerProtocolError(value: unknown, code: BrokerProtocolErrorCode): boolean {
  return brokerProtocolCodeOf(value) === code;
}
