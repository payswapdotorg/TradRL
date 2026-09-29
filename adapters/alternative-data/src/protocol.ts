/**
 * @tradrl/adapter-alternative-data — provider-namespace protocol error codes.
 *
 * THE ADAPTER-NAMESPACE EXTENSION (documented, deliberate): the SDK's
 * closed `AdapterErrorCode` union (mirrored verbatim in
 * ./contract/errors.ts) covers the provider-NEUTRAL failure families;
 * the alternative-data vendor's documented observation protocol adds
 * failures that have no neutral name — mid-window releases, overlapping
 * observation windows, unknown record types, malformed documented
 * payloads, quota enforcement refusals. Those live HERE, in the provider
 * layer (L2/L13: provider semantics stay in the adapter), carried
 * through the SAME frozen AdapterError shape at runtime — kind
 * 'protocol', a provider-namespace code string. The real SDK's
 * `isAdapterError` guard accepts them (it checks kind/code/message as
 * strings), and the SDK's own contract harness asserts them by code.
 *
 * Law line: "the emitted CANONICAL events are provider-neutral ... A
 * canonical event carrying a provider-specific field name is a violation"
 * — these codes are transport-protocol semantics, never event fields.
 */

import { protocolError, type AdapterError, type ProtocolErrorCode } from './contract/errors';

/**
 * The alternative-data vendor protocol failure codes (adapter namespace,
 * protocol family). Each cites the documented observation behavior it
 * enforces.
 */
export type AltDataProtocolErrorCode =
  /** An observation's declared release instant precedes its observation window's end (a mid-window release — impossible and refused). */
  | 'release_before_window_close'
  /** A series observation window starts before the series' previous window ended (windows must not overlap). */
  | 'observation_window_overlap'
  /** The record's documented recordType discriminator is not one this channel carries. */
  | 'unknown_message_type'
  /** A documented field is present but violates its documented shape. */
  | 'malformed_payload'
  /** A scripted schedule exceeds a declared vendor rate/quota limit (enforcement is the adapter's duty). */
  | 'rate_quota_exceeded';

/** Runtime list of the alternative-data vendor protocol codes. */
export const ALTDATA_PROTOCOL_CODES: readonly AltDataProtocolErrorCode[] = [
  'release_before_window_close',
  'observation_window_overlap',
  'unknown_message_type',
  'malformed_payload',
  'rate_quota_exceeded',
];

/**
 * Construct a frozen ProtocolError carrying an alternative-data-namespace code.
 *
 * The runtime object is an ordinary AdapterError ({kind: 'protocol', code,
 * message}); the cast is the single, documented place where the
 * provider-namespace code enters the neutral shape (see the module header
 * for why the type union cannot admit it statically).
 */
export function altDataProtocolError(code: AltDataProtocolErrorCode, message: string): AdapterError {
  return protocolError(code as unknown as ProtocolErrorCode, message);
}

/**
 * Narrow an error to an alternative-data protocol code (the runtime
 * converse of {@link altDataProtocolError}). Returns null when the value
 * is not a protocol-family AdapterError carrying one of the declared
 * codes.
 */
export function altDataProtocolCodeOf(value: unknown): AltDataProtocolErrorCode | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'protocol' || typeof candidate.code !== 'string') return null;
  return (ALTDATA_PROTOCOL_CODES as readonly string[]).includes(candidate.code)
    ? (candidate.code as AltDataProtocolErrorCode)
    : null;
}

/** Guard: the value is a protocol-family AdapterError carrying the given alt-data code. */
export function isAltDataProtocolError(value: unknown, code: AltDataProtocolErrorCode): boolean {
  return altDataProtocolCodeOf(value) === code;
}
