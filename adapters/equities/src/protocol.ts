/**
 * @tradrl/adapter-equities — provider-namespace protocol error codes.
 *
 * THE ADAPTER-NAMESPACE EXTENSION (documented, deliberate): the SDK's
 * closed `AdapterErrorCode` union (mirrored verbatim in
 * ./contract/errors.ts) covers the provider-NEUTRAL failure families; the
 * licensed index feed's documented record protocol adds failures that have
 * no neutral name — record-sequence regressions, trading-calendar
 * violations, duplicate corporate-action ids, unknown record types,
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
 * The equities/index feed protocol failure codes (adapter namespace,
 * protocol family). Each cites the documented record behavior it enforces.
 */
export type EquitiesProtocolErrorCode =
  /** A feed record's sequenceNumber does not strictly advance per index stream. */
  | 'sequence_regression'
  /** A record's date or dissemination instant violates the declared trading calendar. */
  | 'session_calendar_violation'
  /** A corporate action id repeats on the feed (the dedup law). */
  | 'duplicate_action'
  /** The record's documented recordType discriminator is not one this channel carries. */
  | 'unknown_message_type'
  /** A documented field is present but violates its documented shape. */
  | 'malformed_payload'
  /** A scripted schedule exceeds a declared feed rate/quota limit (enforcement is the adapter's duty). */
  | 'rate_quota_exceeded';

/** Runtime list of the equities feed protocol codes. */
export const EQUITIES_PROTOCOL_CODES: readonly EquitiesProtocolErrorCode[] = [
  'sequence_regression',
  'session_calendar_violation',
  'duplicate_action',
  'unknown_message_type',
  'malformed_payload',
  'rate_quota_exceeded',
];

/**
 * Construct a frozen ProtocolError carrying an equities-feed-namespace code.
 *
 * The runtime object is an ordinary AdapterError ({kind: 'protocol', code,
 * message}); the cast is the single, documented place where the
 * provider-namespace code enters the neutral shape (see the module header
 * for why the type union cannot admit it statically).
 */
export function equitiesProtocolError(code: EquitiesProtocolErrorCode, message: string): AdapterError {
  return protocolError(code as unknown as ProtocolErrorCode, message);
}

/**
 * Narrow an error to an equities-feed protocol code (the runtime converse
 * of {@link equitiesProtocolError}). Returns null when the value is not a
 * protocol-family AdapterError carrying one of the declared codes.
 */
export function equitiesProtocolCodeOf(value: unknown): EquitiesProtocolErrorCode | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'protocol' || typeof candidate.code !== 'string') return null;
  return (EQUITIES_PROTOCOL_CODES as readonly string[]).includes(candidate.code)
    ? (candidate.code as EquitiesProtocolErrorCode)
    : null;
}

/** Guard: the value is a protocol-family AdapterError carrying the given equities code. */
export function isEquitiesProtocolError(value: unknown, code: EquitiesProtocolErrorCode): boolean {
  return equitiesProtocolCodeOf(value) === code;
}
