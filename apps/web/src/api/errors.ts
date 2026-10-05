// @tradrl/web-console — the SDK mirror: the typed error taxonomy.
//
// THE LAW (Work Order T042): the console mirrors "@tradrl/sdk's
// client/error/pagination shapes". This module is the STRUCTURAL
// MIRROR of packages/sdk/src/errors.ts — the ApiError hierarchy
// (auth/permission/tenant/rate-limit/validation/conflict/unavailable
// — each programmatically distinguishable) with the same codes, the
// same families and the same envelope translation, never imported
// (D-003/D-004 law; src/api/interop.test.ts pins the parity against
// the REAL SDK, and drives the REAL API service through this
// taxonomy).
//
// Spec anchors: R43, L12 (the tenant family), L20.

/** The boundary's error codes this mirror maps onto its hierarchy (the mirror of the SDK's closed vocabulary). */
export const API_ERROR_CODES = [
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

/** One boundary error code. */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** One typed problem of a validation failure (the boundary's dotted-path problems). */
export interface ApiProblem {
  readonly path: string;
  readonly message: string;
}

/** The error families (the programmatically-distinguishable taxonomy). */
export const API_ERROR_FAMILIES = [
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
export type ApiErrorFamily = (typeof API_ERROR_FAMILIES)[number];

/** The deterministic code -> family mapping (the single source of truth). */
export const API_ERROR_FAMILY_OF: Readonly<Record<ApiErrorCode, ApiErrorFamily>> = Object.freeze({
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
 * The base of the console's mirrored error hierarchy: the boundary's
 * typed error envelope as a thrown, programmatically-distinguishable
 * Error. Distinction is threefold — `instanceof`, the `code` string
 * and the static `family` — so the console never string-matches
 * messages.
 */
export class ApiConsoleError extends Error {
  /** The boundary's typed error code. */
  readonly code: ApiErrorCode;
  /** The HTTP status the boundary sent. */
  readonly status: number;
  /** The error family (the taxonomy dimension — stable across code additions). */
  readonly family: ApiErrorFamily;
  /** The boundary's request id (support/audit join key). */
  readonly requestId?: string;
  /** The server's retry signal in ms (rate_limited). */
  readonly retryAfterMs?: number;
  /** The dotted-path problems (validation failures). */
  readonly problems?: readonly ApiProblem[];

  constructor(code: ApiErrorCode, message: string, status: number, options: { readonly requestId?: string; readonly retryAfterMs?: number; readonly problems?: readonly ApiProblem[] } = {}) {
    super(message);
    this.name = 'ApiConsoleError';
    this.code = code;
    this.status = status;
    this.family = API_ERROR_FAMILY_OF[code];
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.problems !== undefined) this.problems = options.problems;
  }
}

/** 401 — the credential is missing/unknown (auth family). */
export class AuthenticationError extends ApiConsoleError {
  constructor(error: ApiConsoleError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'AuthenticationError';
  }
}

/** 403 — the credential lacks the permission, sits on the wrong plane, or attempted a gate bypass (permission family). */
export class PermissionError extends ApiConsoleError {
  constructor(error: ApiConsoleError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'PermissionError';
  }
}

/** 403 — cross-tenant access refused at the routing layer (tenant family — L12). */
export class TenantIsolationError extends ApiConsoleError {
  constructor(error: ApiConsoleError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'TenantIsolationError';
  }
}

/** 429 — over budget; carries the server's retry signal (rate-limit family). */
export class RateLimitError extends ApiConsoleError {
  constructor(error: ApiConsoleError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'RateLimitError';
  }
}

/** 4xx — the untrusted payload was rejected (validation family — dotted-path problems). */
export class ValidationError extends ApiConsoleError {
  constructor(error: ApiConsoleError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'ValidationError';
  }
}

/** 409 — a conflict (idempotency key reuse with a different body; domain conflicts) (conflict family). */
export class ConflictError extends ApiConsoleError {
  constructor(error: ApiConsoleError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'ConflictError';
  }
}

/** 503 / transport — the boundary or a backing service is unavailable (unavailable family; retryable per policy). */
export class UnavailableError extends ApiConsoleError {
  constructor(error: ApiConsoleError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'UnavailableError';
  }
}

/** 404 — the addressed resource does not exist for this credential's scope (not-found family). */
export class NotFoundError extends ApiConsoleError {
  constructor(error: ApiConsoleError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'NotFoundError';
  }
}

/** 404 — the path's API version is not served (version family; re-negotiate). */
export class VersionMismatchError extends ApiConsoleError {
  constructor(error: ApiConsoleError) {
    super(error.code, error.message, error.status, { requestId: error.requestId, retryAfterMs: error.retryAfterMs, problems: error.problems });
    this.name = 'VersionMismatchError';
  }
}

/** One family's typed-error constructor (the erasable-subset law: function types live in named aliases, never inline at annotation depth zero). */
type FamilyErrorCtor = (base: ApiConsoleError) => ApiConsoleError;

/** The family -> typed-error mapping (the lookup-map alternative to switch/case — the erasable subset's own remedy). */
const FAMILY_ERRORS: Readonly<Record<ApiErrorFamily, FamilyErrorCtor>> = Object.freeze({
  auth: (base) => new AuthenticationError(base),
  permission: (base) => new PermissionError(base),
  tenant: (base) => new TenantIsolationError(base),
  'rate-limit': (base) => new RateLimitError(base),
  validation: (base) => new ValidationError(base),
  conflict: (base) => new ConflictError(base),
  unavailable: (base) => new UnavailableError(base),
  'not-found': (base) => new NotFoundError(base),
  version: (base) => new VersionMismatchError(base),
});

/**
 * Translate one boundary error envelope (the wire shape) into the
 * typed hierarchy. Unknown codes still surface (as the base class
 * with the raw code) — the console never swallows errors.
 */
export function errorFromEnvelope(envelope: {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly status?: unknown;
  readonly problems?: unknown;
  readonly retryAfterMs?: unknown;
}, requestId?: string): ApiConsoleError {
  const code = (typeof envelope.code === 'string' && (API_ERROR_CODES as readonly string[]).includes(envelope.code) ? envelope.code : 'unavailable') as ApiErrorCode;
  const message = typeof envelope.message === 'string' ? envelope.message : 'the boundary returned an error without a message';
  const status = typeof envelope.status === 'number' ? envelope.status : 0;
  const retryAfterMs = typeof envelope.retryAfterMs === 'number' ? envelope.retryAfterMs : undefined;
  const problems = Array.isArray(envelope.problems)
    ? (envelope.problems.filter((p): p is ApiProblem => typeof p === 'object' && p !== null && typeof (p as ApiProblem).path === 'string' && typeof (p as ApiProblem).message === 'string') as ApiProblem[])
    : undefined;
  const base = new ApiConsoleError(code, message, status, { requestId, retryAfterMs, problems });
  return FAMILY_ERRORS[API_ERROR_FAMILY_OF[code]](base);
}

/** `true` when the error is retryable per the taxonomy (rate limits and unavailability only — never 4xx semantics). */
export function isRetryable(error: ApiConsoleError): boolean {
  return error.family === 'rate-limit' || error.family === 'unavailable';
}
