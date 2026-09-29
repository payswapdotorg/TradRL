/**
 * @tradrl/adapter-coinbase — provider-namespace protocol error codes.
 *
 * THE ADAPTER-NAMESPACE EXTENSION (documented, deliberate): the SDK's
 * closed `AdapterErrorCode` union (mirrored verbatim in
 * ./contract/errors.ts) covers the provider-NEUTRAL failure families;
 * Coinbase's documented channel protocol adds failures that have no
 * neutral name — message-sequence regressions, unknown message types,
 * malformed documented payloads, quota enforcement refusals. Those live
 * HERE, in the provider layer (L2/L13: provider semantics stay in the
 * adapter), carried through the SAME frozen AdapterError shape at
 * runtime — kind 'protocol', a provider-namespace code string. The real
 * SDK's `isAdapterError` guard accepts them (it checks kind/code/message
 * as strings), and the SDK's own contract harness asserts them by code.
 *
 * Law line: "the emitted CANONICAL events are provider-neutral ... A
 * canonical event carrying a provider-specific field name is a violation"
 * — these codes are transport-protocol semantics, never event fields.
 */

import { protocolError, type AdapterError, type ProtocolErrorCode } from './contract/errors';

/**
 * The Coinbase protocol failure codes (adapter namespace, protocol family).
 * Each cites the documented channel behavior it enforces.
 */
export type CoinbaseProtocolErrorCode =
  /** A ticker/matches message's sequence number did not advance past the previous one (regression). */
  | 'sequence_regression'
  /** The message's documented type discriminator is not one this channel carries. */
  | 'unknown_message_type'
  /** A documented field is present but violates its documented shape. */
  | 'malformed_payload'
  /** A scripted schedule exceeds a declared Coinbase rate/quota limit (enforcement is the adapter's duty). */
  | 'rate_quota_exceeded';

/** Runtime list of the Coinbase protocol codes. */
export const COINBASE_PROTOCOL_CODES: readonly CoinbaseProtocolErrorCode[] = [
  'sequence_regression',
  'unknown_message_type',
  'malformed_payload',
  'rate_quota_exceeded',
];

/**
 * Construct a frozen ProtocolError carrying a Coinbase-namespace code.
 *
 * The runtime object is an ordinary AdapterError ({kind: 'protocol', code,
 * message}); the cast is the single, documented place where the
 * provider-namespace code enters the neutral shape (see the module header
 * for why the type union cannot admit it statically).
 */
export function coinbaseProtocolError(code: CoinbaseProtocolErrorCode, message: string): AdapterError {
  return protocolError(code as unknown as ProtocolErrorCode, message);
}

/**
 * Narrow an error to a Coinbase protocol code (the runtime converse of
 * {@link coinbaseProtocolError}). Returns null when the value is not a
 * protocol-family AdapterError carrying one of the declared codes.
 */
export function coinbaseProtocolCodeOf(value: unknown): CoinbaseProtocolErrorCode | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'protocol' || typeof candidate.code !== 'string') return null;
  return (COINBASE_PROTOCOL_CODES as readonly string[]).includes(candidate.code)
    ? (candidate.code as CoinbaseProtocolErrorCode)
    : null;
}

/** Guard: the value is a protocol-family AdapterError carrying the given Coinbase code. */
export function isCoinbaseProtocolError(value: unknown, code: CoinbaseProtocolErrorCode): boolean {
  return coinbaseProtocolCodeOf(value) === code;
}
