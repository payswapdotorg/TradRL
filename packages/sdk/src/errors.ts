// @tradrl/sdk — the typed error taxonomy.
//
// THE LAW (Work Order): "the typed error taxonomy (ApiError
// hierarchy: auth/permission/tenant/rate-limit/validation/conflict/
// unavailable — each programmatically distinguishable)". Every class
// carries the service's error code, its HTTP status, the request id
// and (where the server sends one) the retry signal; distinction is
// threefold — `instanceof`, the `code` string and the static
// `family` — so a consumer never string-matches messages.
//
// The mapping mirrors @tradrl/api-service's closed error vocabulary
// ONE-FOR-ONE (the interop test pins the parity; drift = loud test
// failure).

/** The service's error codes the SDK maps onto its hierarchy (the mirror of the service's closed vocabulary). */
export const SDK_ERROR_CODES = [
  'unauthenticated',
  'wrong_auth_plane',
  'forbidden',
  'cross_tenant_access',
  'gate_bypass_attempt',
  'unsupported_version',
  'not_found',
  'method_not_allowed',
  'rate_limited',
  'validation_failed',
  'idempotency_required',
  'idempotency_conflict',
  'conflict',
  'unavailable',
] as const;

/** One service error code. */
export type SdkErrorCode = (typeof SDK_ERROR_CODES)[number];

/** One typed problem of a validation failure (the service's dotted-path problems). */
export interface SdkProblem {
  readonly path: string;
  readonly message: string;
}

/** The error families (the programmatically-distinguishable taxonomy the Work Order names). */
export const SDK_ERROR_FAMILIES = [
  'auth',
  'permission',
  'tenant',
  'rate-limit',
  'validation',
  'conflict',
  'unavailable',
  'not-found',
  'version',
] as const;

/** One error family. */
export type SdkErrorFamily = (typeof SDK_ERROR_FAMILIES)[number];

/** The deterministic code -> family mapping (the single source of truth). */
export const SDK_ERROR_FAMILY_OF: Readonly<Record<SdkErrorCode, SdkErrorFamily>> = Object.freeze({
  unauthenticated: 'auth',
  wrong_auth_plane: 'permission',
  forbidden: 'permission',
  cross_tenant_access: 'tenant',
  gate_bypass_attempt: 'permission',
  unsupported_version: 'version',
  not_found: 'not-found',
  method_not_allowed: 'not-found',
  rate_limited: 'rate-limit',
  validation_failed: 'validation',
  idempotency_required: 'validation',
  idempotency_conflict: 'conflict',
  conflict: 'conflict',
  unavailable: 'unavailable',
});

/**
 * The base of the SDK's error hierarchy: the service's typed error
 * envelope as a thrown, programmatically-distinguishable Error.
 */
export class ApiSdkError extends Error {
  /** The service's typed error code. */
  readonly code: SdkErrorCode;
  /** The HTTP status the service sent. */
  readonly status: number;
  /** The error family (the taxonomy dimension — stable across code additions). */
  readonly family: SdkErrorFamily;
  /** The service's request id (support/audit join key). */
  readonly requestId?: string;
  /** The server's retry signal in ms (rate_limited). */
  readonly retryAfterMs?: number;
  /** The dotted-path problems (validation failures). */
  readonly problems?: readonly SdkProblem[];

  constructor(code: SdkErrorCode, message: string, status: number, options: { readonly requestId?: string; readonly retryAfterMs?: number; readonly problems?: readonly SdkProblem[] } = {}) {
    super(message);
    this.name = 'ApiSdkError';
    this.code = code;
    this.status = status;
    this.family = SDK_ERROR_FAMILY_OF[code];
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.problems !== undefined) this.problems = options.problems;
  }
}

/** 401 — the credential is missing/unknown (auth family). */
export class AuthenticationError extends ApiSdkError {
  constructor(error: ApiSdkError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'AuthenticationError';
  }
}

/** 403 — the credential lacks the permission, sits on the wrong plane, or attempted a gate bypass (permission family). */
export class PermissionError extends ApiSdkError {
  constructor(error: ApiSdkError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'PermissionError';
  }
}

/** 403 — cross-tenant access refused at the routing layer (tenant family — L12). */
export class TenantIsolationError extends ApiSdkError {
  constructor(error: ApiSdkError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'TenantIsolationError';
  }
}

/** 429 — over budget; carries the server's retry signal (rate-limit family). */
export class RateLimitError extends ApiSdkError {
  constructor(error: ApiSdkError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'RateLimitError';
  }
}

/** 4xx — the untrusted payload was rejected (validation family — dotted-path problems). */
export class ValidationError extends ApiSdkError {
  constructor(error: ApiSdkError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'ValidationError';
  }
}

/** 409 — a conflict (idempotency key reuse with a different body; domain conflicts) (conflict family). */
export class ConflictError extends ApiSdkError {
  constructor(error: ApiSdkError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'ConflictError';
  }
}

/** 503 / transport — the boundary or a backing service is unavailable (unavailable family; retryable per policy). */
export class UnavailableError extends ApiSdkError {
  constructor(error: ApiSdkError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'UnavailableError';
  }
}

/** 404 — the addressed resource does not exist for this credential's scope (not-found family). */
export class NotFoundError extends ApiSdkError {
  constructor(error: ApiSdkError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'NotFoundError';
  }
}

/** 404 — the path's API version is not served (version family; re-negotiate). */
export class VersionMismatchError extends ApiSdkError {
  constructor(error: ApiSdkError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'VersionMismatchError';
  }
}

/**
 * Translate one service error envelope (the wire shape) into the
 * typed hierarchy. Unknown codes still surface (as the base class
 * with the raw code) — the SDK never swallows errors.
 */
export function errorFromEnvelope(envelope: {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly status?: unknown;
  readonly problems?: unknown;
  readonly retryAfterMs?: unknown;
}, requestId?: string): ApiSdkError {
  const code = (typeof envelope.code === 'string' && (SDK_ERROR_CODES as readonly string[]).includes(envelope.code) ? envelope.code : 'unavailable') as SdkErrorCode;
  const message = typeof envelope.message === 'string' ? envelope.message : 'the service returned an error without a message';
  const status = typeof envelope.status === 'number' ? envelope.status : 0;
  const retryAfterMs = typeof envelope.retryAfterMs === 'number' ? envelope.retryAfterMs : undefined;
  const problems = Array.isArray(envelope.problems)
    ? (envelope.problems.filter((p): p is SdkProblem => typeof p === 'object' && p !== null && typeof (p as SdkProblem).path === 'string' && typeof (p as SdkProblem).message === 'string') as SdkProblem[])
    : undefined;
  const base = new ApiSdkError(code, message, status, { requestId, retryAfterMs, problems });
  switch (SDK_ERROR_FAMILY_OF[code]) {
    case 'auth':
      return new AuthenticationError(base);
    case 'permission':
      return new PermissionError(base);
    case 'tenant':
      return new TenantIsolationError(base);
    case 'rate-limit':
      return new RateLimitError(base);
    case 'validation':
      return new ValidationError(base);
    case 'conflict':
      return new ConflictError(base);
    case 'unavailable':
      return new UnavailableError(base);
    case 'not-found':
      return new NotFoundError(base);
    case 'version':
      return new VersionMismatchError(base);
  }
}

/** `true` when the error is retryable per the taxonomy (rate limits and unavailability only — never 4xx semantics). */
export function isRetryable(error: ApiSdkError): boolean {
  return error.family === 'rate-limit' || error.family === 'unavailable';
}
