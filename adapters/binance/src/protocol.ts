/**
 * @tradrl/adapter-binance — provider-namespace protocol error codes.
 *
 * THE ADAPTER-NAMESPACE EXTENSION (documented, deliberate): the SDK's
 * closed `AdapterErrorCode` union (mirrored verbatim in
 * ./contract/errors.ts) covers the provider-NEUTRAL failure families;
 * Binance's documented stream protocol adds failures that have no neutral
 * name — update-id sequencing violations, unknown message types,
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
 * The Binance protocol failure codes (adapter namespace, protocol family).
 * Each cites the documented stream behavior it enforces.
 */
export type BinanceProtocolErrorCode =
  /** A depth-diff message's final update id does not advance past the previous message's (regression). */
  | 'update_id_regression'
  /** A depth-diff message's first update id is not the successor of the previous final id (gap/out-of-sync). */
  | 'update_id_gap'
  /** A partial-depth snapshot's lastUpdateId does not advance (regression). */
  | 'update_id_regression_snapshot'
  /** The message's documented event type discriminator is not one this channel carries. */
  | 'unknown_message_type'
  /** A documented field is present but violates its documented shape. */
  | 'malformed_payload'
  /** A scripted schedule exceeds a declared Binance rate/quota limit (enforcement is the adapter's duty). */
  | 'rate_quota_exceeded';

/** Runtime list of the Binance protocol codes. */
export const BINANCE_PROTOCOL_CODES: readonly BinanceProtocolErrorCode[] = [
  'update_id_regression',
  'update_id_gap',
  'update_id_regression_snapshot',
  'unknown_message_type',
  'malformed_payload',
  'rate_quota_exceeded',
];

/**
 * Construct a frozen ProtocolError carrying a Binance-namespace code.
 *
 * The runtime object is an ordinary AdapterError ({kind: 'protocol', code,
 * message}); the cast is the single, documented place where the
 * provider-namespace code enters the neutral shape (see the module header
 * for why the type union cannot admit it statically).
 */
export function binanceProtocolError(code: BinanceProtocolErrorCode, message: string): AdapterError {
  return protocolError(code as unknown as ProtocolErrorCode, message);
}

/**
 * Narrow an error to a Binance protocol code (the runtime converse of
 * {@link binanceProtocolError}). Returns null when the value is not a
 * protocol-family AdapterError carrying one of the declared codes.
 */
export function binanceProtocolCodeOf(value: unknown): BinanceProtocolErrorCode | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'protocol' || typeof candidate.code !== 'string') return null;
  return (BINANCE_PROTOCOL_CODES as readonly string[]).includes(candidate.code)
    ? (candidate.code as BinanceProtocolErrorCode)
    : null;
}

/** Guard: the value is a protocol-family AdapterError carrying the given Binance code. */
export function isBinanceProtocolError(value: unknown, code: BinanceProtocolErrorCode): boolean {
  return binanceProtocolCodeOf(value) === code;
}
