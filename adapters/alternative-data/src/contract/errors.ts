/**
 * @tradrl/adapter-alternative-data — typed error taxonomy and result shapes.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/errors.ts (law D-004:
 * structural mirrors, never imports — the frozen workspace lockfile
 * forbids package dependencies). The adapter implements the SDK's contract shapes with its own code;
 * provider semantics (the alternative-data vocabulary) live ONLY in this
 * package's provider layer (L2/L13 — the inverse of the SDK's own
 * neutrality trip-wire). Two failure disciplines exactly as the SDK
 * declares them: collect-all validation for untrusted declarations, and
 * single typed operation failures (frozen, machine-checkable). The
 * provider-namespace protocol codes (../protocol.ts) flow through the
 * SAME frozen AdapterError shape at runtime.
 */

/** Collect-all field error codes (mirror of the market-protocol discipline). */
export type SdkFieldErrorCode = 'missing_field' | 'invalid_field' | 'invalid_type';

/** A single collect-all validation failure, located by a dotted field path. */
export interface SdkFieldError {
  readonly code: SdkFieldErrorCode;
  /** Dotted path from the declaration root. Empty for whole-object errors. */
  readonly path: string;
  readonly message: string;
}

/** Validation outcome: a validated (deep-frozen) value or every violation. */
export type SdkValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly SdkFieldError[] };

// ---------------------------------------------------------------------------
// Operation error taxonomy.
// ---------------------------------------------------------------------------

/** The five families of the adapter error taxonomy. */
export type AdapterErrorKind = 'transport' | 'mapping' | 'entitlement' | 'protocol' | 'timeout';

/** Transport port failures (the injected transport failed or is unusable). */
export type TransportErrorCode = 'transport_send_failed' | 'transport_recv_failed' | 'transport_unavailable';

/** Mapping failures — the raw -> canonical translation refused something. */
export type MappingErrorCode =
  /** A raw field is present but the mapping table does not account for it (never silently dropped). */
  | 'unmapped_raw_field'
  /** A mapped raw field is absent though the entry requires it. */
  | 'mapped_field_missing'
  /** A transform produced a value that violates the canonical payload contract. */
  | 'invalid_mapped_value'
  /** A declared time field could not be converted to an epoch-millisecond timestamp. */
  | 'invalid_time_field';

/** Entitlement failures — licensing/access declarations. */
export type EntitlementErrorCode = 'entitlement_undeclared';

/** Protocol failures — state machine, routing and configuration misuse. */
export type ProtocolErrorCode =
  /** A lifecycle transition is invalid in the current state (e.g. subscribe before open). */
  | 'invalid_transition'
  /** close() on an already-closed session. */
  | 'double_close'
  /** Any operation on a closed session. */
  | 'use_after_close'
  /** subscribe() on a channel that already has a subscription. */
  | 'duplicate_subscription'
  /** A message arrived on a channel with no subscription. */
  | 'unknown_channel'
  /** A subscription named a mapping table that was not declared. */
  | 'mapping_table_not_found'
  /** A provided configuration/timeline is structurally invalid. */
  | 'invalid_configuration'
  /** The emitter produced a record that failed its own canonical floor (defense in depth). */
  | 'invalid_emission'
  /** The emitter produced a provenance block that failed the ingestion mirror (defense in depth). */
  | 'invalid_provenance';

/** Receive-wait failures. */
export type TimeoutErrorCode = 'receive_timeout';

/** The machine-readable code set of the whole taxonomy. */
export type AdapterErrorCode =
  | TransportErrorCode
  | MappingErrorCode
  | EntitlementErrorCode
  | ProtocolErrorCode
  | TimeoutErrorCode;

/** A typed, frozen operation failure. */
export interface AdapterError {
  /** The error family (discriminant of the taxonomy). */
  readonly kind: AdapterErrorKind;
  readonly code: AdapterErrorCode;
  readonly message: string;
}

/** Operation outcome: a value or a single typed failure. */
export type SdkResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AdapterError };

// ---------------------------------------------------------------------------
// Constructors (frozen) and guards.
// ---------------------------------------------------------------------------

function freezeError(kind: AdapterErrorKind, code: AdapterErrorCode, message: string): AdapterError {
  return Object.freeze({ kind, code, message });
}

/** Construct a frozen TransportError. */
export function transportError(code: TransportErrorCode, message: string): AdapterError {
  return freezeError('transport', code, message);
}

/** Construct a frozen MappingError. */
export function mappingError(code: MappingErrorCode, message: string): AdapterError {
  return freezeError('mapping', code, message);
}

/** Construct a frozen EntitlementError. */
export function entitlementError(code: EntitlementErrorCode, message: string): AdapterError {
  return freezeError('entitlement', code, message);
}

/** Construct a frozen ProtocolError. */
export function protocolError(code: ProtocolErrorCode, message: string): AdapterError {
  return freezeError('protocol', code, message);
}

/** Construct a frozen TimeoutError. */
export function timeoutError(code: TimeoutErrorCode, message: string): AdapterError {
  return freezeError('timeout', code, message);
}

/** Narrowing guard for the whole taxonomy. */
export function isAdapterError(value: unknown): value is AdapterError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const KINDS: readonly string[] = ['transport', 'mapping', 'entitlement', 'protocol', 'timeout'];
  return (
    typeof candidate.kind === 'string' &&
    KINDS.includes(candidate.kind) &&
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string'
  );
}

/** Guard: the error belongs to the transport family. */
export function isTransportError(value: unknown): value is AdapterError {
  return isAdapterError(value) && value.kind === 'transport';
}

/** Guard: the error belongs to the mapping family. */
export function isMappingError(value: unknown): value is AdapterError {
  return isAdapterError(value) && value.kind === 'mapping';
}

/** Guard: the error belongs to the entitlement family. */
export function isEntitlementError(value: unknown): value is AdapterError {
  return isAdapterError(value) && value.kind === 'entitlement';
}

/** Guard: the error belongs to the protocol family. */
export function isProtocolError(value: unknown): value is AdapterError {
  return isAdapterError(value) && value.kind === 'protocol';
}

/** Guard: the error belongs to the timeout family. */
export function isTimeoutError(value: unknown): value is AdapterError {
  return isAdapterError(value) && value.kind === 'timeout';
}

/** Construct a collect-all failure (for internal declaration validators). */
export function validationFailure<T = never>(errors: readonly SdkFieldError[]): SdkValidation<T> {
  return { ok: false, errors };
}

/** Construct a collect-all success carrying a validated value. */
export function validationSuccess<T>(value: T): SdkValidation<T> {
  return { ok: true, value };
}

/** Construct an operation failure. */
export function failure<T = never>(error: AdapterError): SdkResult<T> {
  return { ok: false, error };
}

/** Construct an operation success. */
export function success<T>(value: T): SdkResult<T> {
  return { ok: true, value };
}
