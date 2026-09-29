/**
 * @tradrl/adapter-news — provider-namespace protocol error codes.
 *
 * THE ADAPTER-NAMESPACE EXTENSION (documented, deliberate): the SDK's
 * closed `AdapterErrorCode` union (mirrored verbatim in
 * ./contract/errors.ts) covers the provider-NEUTRAL failure families; the
 * news wire's documented item protocol adds failures that have no
 * neutral name — duplicate item ids, embargoed records that never lift,
 * unknown record types, malformed documented payloads, quota enforcement
 * refusals. Those live HERE, in the provider layer (L2/L13: provider
 * semantics stay in the adapter), carried through the SAME frozen
 * AdapterError shape at runtime — kind 'protocol', a provider-namespace
 * code string. The real SDK's `isAdapterError` guard accepts them (it
 * checks kind/code/message as strings), and the SDK's own contract
 * harness asserts them by code.
 *
 * Law line: "the emitted CANONICAL events are provider-neutral ... A
 * canonical event carrying a provider-specific field name is a violation"
 * — these codes are transport-protocol semantics, never event fields.
 */

import { protocolError, type AdapterError, type ProtocolErrorCode } from './contract/errors';

/**
 * The news wire protocol failure codes (adapter namespace, protocol family).
 * Each cites the documented wire behavior it enforces.
 */
export type NewsProtocolErrorCode =
  /** A wire item id repeats (the documented dedup law — the feed must not re-deliver an item). */
  | 'duplicate_item'
  /** The timeline drained while an embargoed record remains held (the record never became available — refused, never silently dropped). */
  | 'embargo_not_lifted'
  /** The record's documented recordType discriminator is not one this channel carries. */
  | 'unknown_message_type'
  /** A documented field is present but violates its documented shape. */
  | 'malformed_payload'
  /** A scripted schedule exceeds a declared wire rate/quota limit (enforcement is the adapter's duty). */
  | 'rate_quota_exceeded';

/** Runtime list of the news wire protocol codes. */
export const NEWS_PROTOCOL_CODES: readonly NewsProtocolErrorCode[] = [
  'duplicate_item',
  'embargo_not_lifted',
  'unknown_message_type',
  'malformed_payload',
  'rate_quota_exceeded',
];

/**
 * Construct a frozen ProtocolError carrying a news-wire-namespace code.
 *
 * The runtime object is an ordinary AdapterError ({kind: 'protocol', code,
 * message}); the cast is the single, documented place where the
 * provider-namespace code enters the neutral shape (see the module header
 * for why the type union cannot admit it statically).
 */
export function newsProtocolError(code: NewsProtocolErrorCode, message: string): AdapterError {
  return protocolError(code as unknown as ProtocolErrorCode, message);
}

/**
 * Narrow an error to a news-wire protocol code (the runtime converse of
 * {@link newsProtocolError}). Returns null when the value is not a
 * protocol-family AdapterError carrying one of the declared codes.
 */
export function newsProtocolCodeOf(value: unknown): NewsProtocolErrorCode | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'protocol' || typeof candidate.code !== 'string') return null;
  return (NEWS_PROTOCOL_CODES as readonly string[]).includes(candidate.code)
    ? (candidate.code as NewsProtocolErrorCode)
    : null;
}

/** Guard: the value is a protocol-family AdapterError carrying the given news code. */
export function isNewsProtocolError(value: unknown, code: NewsProtocolErrorCode): boolean {
  return newsProtocolCodeOf(value) === code;
}
