// @tradrl/api-service — the boundary's typed error taxonomy.
//
// THE LAW (Work Order): every failure at every pipeline stage is a
// TYPED error — a closed code vocabulary, a deterministic HTTP status
// mapping, and a machine-readable problems list. The SDK's ApiError
// hierarchy mirrors THIS taxonomy one-for-one (packages/sdk; the
// interop trip-wire tests pin the parity).
//
// The named error of the charter (Work Order "Evidence" list):
//   - `wrong_auth_plane`   — a public token hitting a private route
//                            (typed 403; the plane test REQUIRED);
//   - `cross_tenant_access`— cross-tenant access at the ROUTING layer
//                            (typed 403; L12; isolation tests REQUIRED);
//   - `gate_bypass_attempt`— a direct-execution code path (typed 403;
//                            L8 — submitting authority instead of an
//                            intent, or any attempt to route around the
//                            T040 gateway, is refused HERE);
//   - `rate_limited`       — carries the server's retry signal
//                            (retryAfterMs) the SDK honors;
//   - `validation_failed`  — EVERY payload is untrusted input
//                            (SECURITY.md); rejection is typed, with
//                            dotted-path problems;
//   - `idempotency_conflict` — a consequential route replayed with the
//                            same key but a different body (typed 409).
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L8, L12, L20;
// spec/SECURITY.md (untrusted input, tenant isolation);
// spec/REQUIREMENTS.md R43 (developer API/SDK).

import { deepFreeze, isNonEmptyString, isNonNegativeSafeInteger, isRecord } from './primitives';

// ---------------------------------------------------------------------------
// The closed error-code vocabulary
// ---------------------------------------------------------------------------

/**
 * The boundary's closed error-code vocabulary. Frozen: adding a code
 * is a contract change (the SDK's hierarchy must track it — the
 * interop test asserts the parity).
 */
export const API_ERROR_CODES = [
  // --- The authn/authz/plane stages -------------------------------------
  'unauthenticated',      // 401 — missing/invalid credential token
  'wrong_auth_plane',     // 403 — public token on private route or vice versa
  'forbidden',            // 403 — credential lacks the route family permission
  'cross_tenant_access',  // 403 — L12: foreign-scope access at the routing layer
  'gate_bypass_attempt',  // 403 — L8: direct-execution path attempted at the boundary
  // --- The pre-handler stages -------------------------------------------
  'unsupported_version',  // 404 — the path's API version is not served
  'not_found',            // 404 — unknown route (indistinguishable from foreign id)
  'method_not_allowed',   // 405 — known path, wrong method
  'rate_limited',         // 429 — over the credential's budget (retryAfterMs set)
  'validation_failed',    // 400 — untrusted payload rejected (problems list)
  'idempotency_required', // 400 — consequential route without an Idempotency-Key
  'idempotency_conflict', // 409 — same key, different body (the first stands)
  // --- The handler stage -------------------------------------------------
  'conflict',             // 409 — domain refusal surfaced as a typed conflict
  'unavailable',          // 503 — a backing service port refused/unavailable
] as const;

/** One error code of the closed vocabulary. */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Guard: an error code of the closed vocabulary. */
export function isApiErrorCode(v: unknown): v is ApiErrorCode {
  return typeof v === 'string' && (API_ERROR_CODES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The HTTP status mapping (deterministic; the single source of truth)
// ---------------------------------------------------------------------------

/** The deterministic status mapping: every code carries exactly one HTTP status. */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = deepFreeze({
  unauthenticated: 401,
  wrong_auth_plane: 403,
  forbidden: 403,
  cross_tenant_access: 403,
  gate_bypass_attempt: 403,
  unsupported_version: 404,
  not_found: 404,
  method_not_allowed: 405,
  rate_limited: 429,
  validation_failed: 400,
  idempotency_required: 400,
  idempotency_conflict: 409,
  conflict: 409,
  unavailable: 503,
});

// ---------------------------------------------------------------------------
// The error record (the wire shape)
// ---------------------------------------------------------------------------

/** One typed problem of a `validation_failed` rejection: a dotted path + the human-readable law it broke. */
export interface ApiProblem {
  readonly path: string;
  readonly message: string;
}

/** Guard: one typed problem. */
export function isApiProblem(v: unknown): v is ApiProblem {
  return isRecord(v) && isNonEmptyString(v.path) && isNonEmptyString(v.message);
}

/**
 * The boundary's error record — the wire shape every failure
 * serializes to. `problems` carries the dotted-path rejection list of
 * `validation_failed`; `retryAfterMs` carries the server's retry
 * signal of `rate_limited` (the SDK's backoff honors it through the
 * injected transport).
 */
export interface ApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  /** The deterministic HTTP status (derived from the code). */
  readonly status: number;
  /** Dotted-path problems (validation_failed). */
  readonly problems?: readonly ApiProblem[];
  /** The server's retry signal in ms (rate_limited). */
  readonly retryAfterMs?: number;
}

/** Guard: an error record of this taxonomy. */
export function isApiError(v: unknown): v is ApiError {
  if (!isRecord(v)) return false;
  if (!isApiErrorCode(v.code)) return false;
  if (!isNonEmptyString(v.message)) return false;
  if (v.status !== API_ERROR_STATUS[v.code]) return false;
  if (v.problems !== undefined) {
    if (!Array.isArray(v.problems) || !v.problems.every((p) => isApiProblem(p))) return false;
  }
  if (v.retryAfterMs !== undefined && !isNonNegativeSafeInteger(v.retryAfterMs)) return false;
  return true;
}

/** Construct a typed error record (status derived; never guessed at call sites). */
export function apiError(
  code: ApiErrorCode,
  message: string,
  options: { readonly problems?: readonly ApiProblem[]; readonly retryAfterMs?: number } = {},
): ApiError {
  const error: ApiError = {
    code,
    message,
    status: API_ERROR_STATUS[code],
    ...(options.problems === undefined ? {} : { problems: Object.freeze([...options.problems]) }),
    ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
  };
  return deepFreeze(error);
}

/** Construct one typed problem. */
export function problem(path: string, message: string): ApiProblem {
  return deepFreeze({ path, message });
}

// ---------------------------------------------------------------------------
// The result discipline (mirrors the sibling packages' ok/fail)
// ---------------------------------------------------------------------------

/** A typed result: success value or the typed error record. */
export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiError };

/** The success constructor. */
export function ok<T>(value: T): ApiResult<T> {
  return { ok: true, value };
}

/** The failure constructor. */
export function fail<T = never>(
  code: ApiErrorCode,
  message: string,
  options: { readonly problems?: readonly ApiProblem[]; readonly retryAfterMs?: number } = {},
): ApiResult<T> {
  return { ok: false, error: apiError(code, message, options) };
}
