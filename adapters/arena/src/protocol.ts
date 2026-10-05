/**
 * @tradrl/adapter-arena — provider-namespace protocol error codes.
 *
 * THE ADAPTER-NAMESPACE EXTENSION (documented, deliberate): the
 * contract layer's closed `AdapterErrorCode` union (mirrored verbatim
 * in ./contract/errors.ts) covers the provider-NEUTRAL failure
 * families; the Arena wire's documented protocol adds failures that
 * have no neutral name — duplicate wire message ids, an unknown
 * correlation, a drifted verification contract, an out-of-order wire
 * instant, an engagement the announced contract refuses, quota
 * enforcement refusals. Those live HERE, in the provider layer (L2/L13:
 * provider semantics stay in the adapter), carried through the SAME
 * frozen AdapterError shape at runtime — kind 'protocol', a
 * provider-namespace code string. The REAL SDK's `isAdapterError`
 * guard accepts them (it checks kind/code/message as strings).
 *
 * Law line: the minted CANONICAL envelopes are provider-neutral T045
 * shapes; these codes are transport-protocol semantics, never envelope
 * fields.
 */

import { protocolError, type AdapterError, type ProtocolErrorCode } from './contract/errors';

/**
 * The Arena wire protocol failure codes (adapter namespace, protocol family).
 * Each cites the documented wire behavior it enforces.
 */
export type ArenaProtocolErrorCode =
  /** A wire message id repeats (the documented dedup law — the wire must not re-deliver a message). */
  | 'duplicate_message'
  /** The message's documented messageKind discriminator is not one this channel carries. */
  | 'unknown_message_kind'
  /** A documented field is present but violates its documented shape. */
  | 'malformed_payload'
  /** A quote or delivery arrived whose correlation ref resolves to no routed request / announced engagement. */
  | 'unknown_correlation'
  /** The wire's echoed verification contract is not the routed request's VERBATIM — goalposts never move. */
  | 'verification_drift'
  /** A wire instant violates the L4 ordering the conversation requires (quotes postdate their request; deliveries postdate their engagement). */
  | 'conversation_order_violation'
  /** The wire deliverable violates the announced engagement's frozen contract (kind mismatch or deadline exceeded). */
  | 'engagement_contract_refused'
  /** A routed request lies outside the declared Arena catalog's capability envelope (fail-fast at the boundary). */
  | 'arena_catalog_mismatch'
  /** A scripted schedule exceeds a declared Arena rate/quota limit (enforcement is the adapter's duty). */
  | 'rate_quota_exceeded';

/** Runtime list of the Arena wire protocol codes. */
export const ARENA_PROTOCOL_CODES: readonly ArenaProtocolErrorCode[] = [
  'duplicate_message',
  'unknown_message_kind',
  'malformed_payload',
  'unknown_correlation',
  'verification_drift',
  'conversation_order_violation',
  'engagement_contract_refused',
  'arena_catalog_mismatch',
  'rate_quota_exceeded',
];

/**
 * Construct a frozen ProtocolError carrying an Arena-wire-namespace code.
 *
 * The runtime object is an ordinary AdapterError ({kind: 'protocol', code,
 * message}); the cast is the single, documented place where the
 * provider-namespace code enters the neutral shape (see the module header
 * for why the type union cannot admit it statically).
 */
export function arenaProtocolError(code: ArenaProtocolErrorCode, message: string): AdapterError {
  return protocolError(code as unknown as ProtocolErrorCode, message);
}

/**
 * Narrow an error to an Arena-wire protocol code (the runtime converse of
 * {@link arenaProtocolError}). Returns null when the value is not a
 * protocol-family AdapterError carrying one of the declared codes.
 */
export function arenaProtocolCodeOf(value: unknown): ArenaProtocolErrorCode | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'protocol' || typeof candidate.code !== 'string') return null;
  return (ARENA_PROTOCOL_CODES as readonly string[]).includes(candidate.code)
    ? (candidate.code as ArenaProtocolErrorCode)
    : null;
}

/** Guard: the value is a protocol-family AdapterError carrying the given Arena code. */
export function isArenaProtocolError(value: unknown, code: ArenaProtocolErrorCode): boolean {
  return arenaProtocolCodeOf(value) === code;
}
