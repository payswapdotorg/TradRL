// deploy/vercel/runtime/auth-routes.ts — THE HOST-OWNED PRINCIPAL AUTH
// ROUTES (FW-39-1, the identity wave 1 — the G-11 restart-orphan
// substrate; docs/design/IDENTITY-MODEL.md §5 Wave 1 / §3 option (c)).
//
// WHAT THIS IS: the lightweight credential model's host half — named
// principals (register with a passphrase; the host stores ONLY a salted
// KDF verifier over Node platform crypto — scrypt, the zero-dep law) +
// host-minted SCOPED, EXPIRING, REVOCABLE session tokens (HMAC-SHA256
// over platform crypto). Login exchanges the passphrase for the token;
// the token rides the `x-tradrl-principal-token` header; logout revokes
// it (the durable revocation list); the adoption route re-stamps the
// CALLING session's own desks with the additive `ownerPrincipal` so a
// logged-in principal's desks survive a browser restart, a cleared
// profile, or a new machine (the G-11 four-word posture — durable DATA /
// ephemeral SESSION / absent IDENTITY / ORPHANED access — closed at the
// substrate layer).
//
// THE ROUTES (host-owned, ADDITIVE, served BEFORE the boundary wrap —
// the W-8 pattern the session/runbook/promote routes establish; the
// paths are declared NOWHERE in the frozen T041 route table, so without
// this module they answer the boundary's typed not-found):
//
//   POST /v1/auth/register  { name, passphrase } -> 201 (the principal +
//                          a freshly minted token — registration logs in)
//   POST /v1/auth/login     { name, passphrase } -> 200 (the principal +
//                          the token + its expiry)
//   POST /v1/auth/logout    (the token header)    -> 200 (revoked, durable)
//   GET  /v1/auth/whoami    (the token header)    -> 200 (the principal
//                          identity + expiry — NEVER the verifier)
//   POST /v1/auth/adopt     (the token + session
//                          headers)              -> 200 (per-desk
//                          adoption of the CALLING session's own desks)
//
// THE AUTH LAW (the W-8 host-route law, verbatim): the host owns the
// credential registrations, so it authenticates these routes itself — a
// Bearer token that is not the deployment's registered developer
// credential is the typed 401 FIRST (authn precedes availability, the
// runbook precedent); the principal registry is the CREDENTIAL TENANT'S
// own (L12 by construction — the tenant comes from the authorization,
// never a request value; every store statement scopes `tenant = $1`).
// On top of the boundary credential, the principal routes demand the
// PRINCIPAL TOKEN (register/login exempt — they mint it). Unknown
// principal, wrong passphrase, absent/invalid/expired/revoked/foreign
// token: the INDISTINGUISHABLE typed 401 (unknown-vs-foreign — the
// boundary's own law; login's unknown-name and wrong-passphrase answers
// are byte-identical).
//
// THE HONEST UNAVAILABILITY (R46, the design's loud-teaching law): under
// the DEMO backing the credential store does not exist — the demo arm's
// per-instance in-memory state would silently cold-start reset every
// account, which the design forbids ("an account must never silently
// cold-start reset"). EVERY auth route therefore answers the typed
// `unavailable` 503 naming the durable-backing requirement — never a
// fake in-memory account, never a silent behavior difference. The same
// typed 503 answers when the durable seam built but the signing key
// (`TRADRL_AUTH_TOKEN_KEY`) is not configured: the surface requires
// configuration, never a fallback key derived from another credential.
// The shared token RESOLVER answers the absent-or-invalid verdict in
// those states (no token could ever have been minted — nothing to
// honor; the marker fold and the create-stamp therefore see no
// principal context, honestly).
//
// THE ADOPTION LAW (the design §5 Wave 1): `POST /v1/auth/adopt`
// re-stamps the additive `ownerPrincipal` on the CALLING session's OWN
// desks — the same ownership law the session routes enforce (rows the
// calling session OWNS: `ownerSession === session`, the shared demo
// project NEVER adoptable). IDEMPOTENT (a row already carrying the same
// owner reports `changed: false`, no durable write); per-desk response;
// NEVER a widening parameter — the request body is IGNORED entirely (no
// parameter can steer WHICH desks adopt; the FW-37-B module-level
// lesson applied here at birth).
//
// THE ENVELOPE DISCIPLINE: imported from runtime/routes.ts
// (demoRouteSuccess/demoRouteError/demoRouteRequestId — never
// duplicated); the same { requestId, data } / { requestId, error } wire
// shapes, the x-request-id/x-api-version headers, the typed
// 401/400/409/503 vocabulary of the closed ApiError code set.
//
// NO same-origin-exempt headers are ever emitted (the same-origin law —
// pinned by deploy/vercel/vercel.test.ts, which scans this file too).
//
// DOCUMENTED LIMITATIONS (honest, the W-8 precedent): host-owned routes
// run outside the T041 pipeline's metering/audit tail AND its rate
// limiter — a login endpoint with no host-side brute-force throttling is
// the known gap (the scrypt KDF is the cost lever; host-side throttling
// is a later wave's additive option). The principal token rides a custom
// header beside the boundary credential (the two-layer model: developer
// credential = the tenant; the principal token = the user; the console
// session id = the device correlation). Token theft is bounded by scope
// + expiry + revocation; the design's §3(c) exposure note applies (the
// public shell already bakes the tenant credential — no NEW exposure
// class arises; a stolen principal token is strictly narrower and
// revocable). The concurrent-register race (two registers of the same
// name in flight) is caught by the store's UNIQUE index as a typed
// degraded write; the check-then-insert is the common path.
//
// Zero-dep law: platform APIs only (node:crypto — the r2/upstash
// adapters' own platform-crypto precedent). Spec anchors: L12 (tenant
// isolation — the registry is tenant-scoped), L4 (observed instants on
// every stamp), R46 (the typed degraded/not-available states), the
// IDENTITY-MODEL design §3(c)/§5 Wave 1, G-11.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  apiError,
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  mintRequestId,
  problem,
  type ApiResponse,
  type RequestId,
} from '../../../services/api/src/index';
import type { PrincipalCredentialRecord, PrincipalRevocationRecord, SessionProjectRow } from '../../adapters/neon/stores';
import type { StoreFailure, StoreResult } from '../../adapters/shared';
import { DEMO_PROJECT_ID } from './demo';
import { demoRouteError, demoRouteRequestId, demoRouteSuccess, type VerifyDeveloperAuthorization } from './routes';
import { consoleSessionOf, projectOfRow } from './session-routes';

// ---------------------------------------------------------------------------
// The wire contract
// ---------------------------------------------------------------------------

/** The principal-token header (the client mirror rides wave 2; the same naming law as the console session header). */
export const PRINCIPAL_TOKEN_HEADER = 'x-tradrl-principal-token';

/** The host-owned auth routes' paths (additive — declared nowhere in the frozen route table). */
export const AUTH_ROUTE_PATHS = deepFreeze(['/v1/auth/register', '/v1/auth/login', '/v1/auth/logout', '/v1/auth/whoami', '/v1/auth/adopt'] as const);

/** The token's scope claim: the principal's own desks (the own-desks wall — nothing wider is ever minted). */
export const PRINCIPAL_TOKEN_SCOPE = 'principal-desks' as const;

/** The token's time-to-live (12 hours — a working session; expiry is enforced on every verification). */
export const PRINCIPAL_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/** The KDF: scrypt over Node platform crypto (the platform defaults; a 64-byte hex verifier). */
const KDF_KEY_LENGTH = 64;

/** The minimal request surface the auth routes consume (the wrapped ApiRequest carries exactly these + the body). */
export type AuthRouteRequest = {
  readonly method: string;
  readonly path: string;
  readonly headers: unknown;
  readonly body?: unknown;
};

// ---------------------------------------------------------------------------
// The credential-store seam (the durable principal registry + revocation list)
// ---------------------------------------------------------------------------

/**
 * The principal credential store (the durable composition's NeonPrincipalStore
 * implements it; the seam stays structural so the routes are pure over it).
 * Every operation scopes by the CALLER's tenant; every failure is the typed
 * StoreFailure (R46 — never a throw).
 */
export interface PrincipalCredentialStore {
  putPrincipal(tenant: string, record: PrincipalCredentialRecord): Promise<StoreResult<{ readonly stored: true }>>;
  principalByName(tenant: string, name: string): Promise<StoreResult<PrincipalCredentialRecord | null>>;
  principalById(tenant: string, principalId: string): Promise<StoreResult<PrincipalCredentialRecord | null>>;
  putRevocation(tenant: string, record: PrincipalRevocationRecord): Promise<StoreResult<{ readonly stored: true }>>;
  revocationOf(tenant: string, tokenId: string): Promise<StoreResult<PrincipalRevocationRecord | null>>;
}

/**
 * The adoption seam (the durable composition's surfaces): the FRESH
 * session-listing rows (the same JOIN the session routes read — the
 * calling session's own desks come from it, never a request value) + the
 * additive principal-ownership stamp (the `ownerSession` stamp's twin).
 */
export interface PrincipalAdoptionSeam {
  readonly sessionRowsOf: (tenant: string) => Promise<StoreResult<readonly SessionProjectRow[]>>;
  readonly stampPrincipalOwner: (tenant: string, projectId: string, principalId: string) => Promise<{ readonly stamped: boolean; readonly changed: boolean }>;
}

/**
 * The auth routes' structural input (compose.ts builds it on EVERY
 * composition — the not-available states are carried IN the input as
 * nulls, so the dispatcher can teach them loudly; the complete state is
 * narrowed once, below).
 */
export interface AuthRouteInput {
  /** The host auth seam (the composition's registered developer credential — authn FIRST, the W-8 law). */
  readonly verifyDeveloperAuthorization: VerifyDeveloperAuthorization;
  /** The durable credential store. Null = the surface is not-available (the DEMO backing — no store exists). */
  readonly principals: PrincipalCredentialStore | null;
  /** The HMAC signing key (`TRADRL_AUTH_TOKEN_KEY`). Null = the surface is not-available (unconfigured). */
  readonly tokenKey: string | null;
  /** The injected instant source (token iat/exp/revokedAt; tests inject a mutable clock; the host reads the wall clock). */
  readonly now: () => number;
  /** The adoption seam (the session rows + the principal-ownership stamp). Null = not-available with the store. */
  readonly adoption: PrincipalAdoptionSeam | null;
}

/** The COMPLETE input — the invariant the dispatcher enforces before any route runs (the not-available states never reach a route). */
export type CompleteAuthRouteInput = AuthRouteInput & {
  readonly principals: PrincipalCredentialStore;
  readonly tokenKey: string;
  readonly adoption: PrincipalAdoptionSeam;
};

// ---------------------------------------------------------------------------
// The token (mint + verify — HMAC over platform crypto)
// ---------------------------------------------------------------------------

/** One VERIFIED principal token's claims (the serving identity — never the verifier). */
export interface PrincipalTokenVerdict {
  readonly principalId: string;
  readonly name: string;
  readonly tenant: string;
  readonly expiresAt: number;
  readonly tokenId: string;
}

/** The resolver's verdict: a valid token, an absent/invalid one (indistinguishable by design), or the typed degraded read. */
export type PrincipalResolution =
  | { readonly kind: 'valid'; readonly token: PrincipalTokenVerdict }
  | { readonly kind: 'absent-or-invalid' }
  | { readonly kind: 'degraded'; readonly error: StoreFailure };

/** The token payload's structural shape (the claims the HMAC covers). */
interface PrincipalTokenClaims {
  readonly sub: string;
  readonly name: string;
  readonly tid: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly scope: string;
}

/** The request's principal-token header value (structural probe — the boundary's ApiRequestHeaders and the test harnesses carry different declared shapes). */
function principalTokenOf(headers: unknown): string | null {
  if (headers === null || typeof headers !== 'object') return null;
  const presented = (headers as { readonly [PRINCIPAL_TOKEN_HEADER]?: unknown })[PRINCIPAL_TOKEN_HEADER];
  return typeof presented === 'string' && presented.length > 0 ? presented : null;
}

/** HMAC-SHA256 over the signed prefix (platform crypto; the key never crosses a wire). */
function signTokenPrefix(prefix: string, key: string): string {
  return createHmac('sha256', key).update(prefix).digest('base64url');
}

/** Timing-safe equality over same-length strings (a length mismatch is a failed compare, never a throw). */
function timingSafeEqualText(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** Mint one principal token: `v1.<base64url claims>.<base64url hmac>` — scoped, expiring, revocable-by-jti. */
export function mintPrincipalToken(input: AuthRouteInput, claims: Omit<PrincipalTokenClaims, 'iat' | 'exp' | 'scope'>): { readonly token: string; readonly claims: PrincipalTokenClaims } {
  const issuedAt = input.now();
  const full: PrincipalTokenClaims = {
    ...claims,
    iat: issuedAt,
    exp: issuedAt + PRINCIPAL_TOKEN_TTL_MS,
    scope: PRINCIPAL_TOKEN_SCOPE,
  };
  const payload = Buffer.from(canonicalJson(full as never), 'utf8').toString('base64url');
  const prefix = `v1.${payload}`;
  return { token: `${prefix}.${signTokenPrefix(prefix, input.tokenKey as string)}`, claims: full };
}

/**
 * Resolve the request's principal token against the expected (authorized)
 * tenant. Every failure class — absent header, malformed shape, wrong
 * signature, foreign tenant, expired, revoked, the whole surface
 * not-available — answers the SAME 'absent-or-invalid' verdict
 * (indistinguishable, the boundary's own law); only a degraded
 * revocation read answers 'degraded' (the caller serves the typed 503 —
 * fail closed, never a partial principal view).
 */
export function resolvePrincipalToken(input: AuthRouteInput, headers: unknown, tenant: string): Promise<PrincipalResolution> {
  return (async (): Promise<PrincipalResolution> => {
    // THE NOT-AVAILABLE STATES: no signing key or no store -> no token could
    // ever have been minted by this deployment — nothing to honor (honest:
    // the marker fold + the create-stamp see no principal context).
    if (input.tokenKey === null || input.principals === null) return { kind: 'absent-or-invalid' };
    const presented = principalTokenOf(headers);
    if (presented === null) return { kind: 'absent-or-invalid' };
    // The structural shape: v1.<payload>.<signature>.
    const parts = presented.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1' || (parts[1] as string).length === 0 || (parts[2] as string).length === 0) return { kind: 'absent-or-invalid' };
    const payloadSegment = parts[1] as string;
    const signatureSegment = parts[2] as string;
    // The signature check (timing-safe; a malformed payload never decodes past it).
    if (!timingSafeEqualText(signatureSegment, signTokenPrefix(`v1.${payloadSegment}`, input.tokenKey))) return { kind: 'absent-or-invalid' };
    let claims: PrincipalTokenClaims | null = null;
    try {
      const decoded = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as unknown;
      if (typeof decoded === 'object' && decoded !== null) {
        const record = decoded as { readonly sub?: unknown; readonly name?: unknown; readonly tid?: unknown; readonly iat?: unknown; readonly exp?: unknown; readonly jti?: unknown; readonly scope?: unknown };
        if (typeof record.sub === 'string' && record.sub.length > 0
          && typeof record.name === 'string' && record.name.length > 0
          && typeof record.tid === 'string' && record.tid.length > 0
          && typeof record.iat === 'number' && typeof record.exp === 'number'
          && typeof record.jti === 'string' && record.jti.length > 0
          && record.scope === PRINCIPAL_TOKEN_SCOPE) {
          claims = { sub: record.sub, name: record.name, tid: record.tid, iat: record.iat, exp: record.exp, jti: record.jti, scope: PRINCIPAL_TOKEN_SCOPE };
        }
      }
    } catch {
      claims = null; // a malformed payload is an invalid token, never a crash
    }
    if (claims === null) return { kind: 'absent-or-invalid' };
    // L12: the token is bound to the expected tenant — a token minted for another deployment's tenant never authorizes here.
    if (claims.tid !== tenant) return { kind: 'absent-or-invalid' };
    // The expiry (enforced on EVERY verification — a token past its exp is dead).
    if (input.now() >= claims.exp) return { kind: 'absent-or-invalid' };
    // The revocation list (durable truth — a logged-out token stays dead across instances and cold starts). A degraded read FAILS CLOSED (degraded) — an unverifiable token is never honored.
    const revocation = await input.principals.revocationOf(tenant, claims.jti);
    if (!revocation.ok) return { kind: 'degraded', error: revocation.error };
    if (revocation.value !== null) return { kind: 'absent-or-invalid' };
    return { kind: 'valid', token: { principalId: claims.sub, name: claims.name, tenant: claims.tid, expiresAt: claims.exp, tokenId: claims.jti } };
  })();
}

// ---------------------------------------------------------------------------
// The auth surface (what the composition carries; the resolver + the input)
// ---------------------------------------------------------------------------

/** The composition's auth surface (FW-39-1): the routes' input + the shared token resolver (the marker fold + the create-stamp read the SAME verdict law). */
export interface AuthSurface {
  /** The auth routes' input (serveAuthRoute consumes it; the nulls teach the not-available states). */
  readonly input: AuthRouteInput;
  /** Resolve the request's principal token for one EXPECTED tenant (the session marker fold + the create-stamp consume this — one law, one implementation). */
  readonly resolvePrincipalToken: (headers: unknown, tenant: string) => Promise<PrincipalResolution>;
}

/** Build the composition's auth surface over one input (the resolver closes over it; NOT deep-frozen — the input carries live store instances whose own bookkeeping mutates). */
export function buildAuthSurface(input: AuthRouteInput): AuthSurface {
  return { input, resolvePrincipalToken: (headers: unknown, tenant: string) => resolvePrincipalToken(input, headers, tenant) };
}

// ---------------------------------------------------------------------------
// The KDF (the salted verifier — Node platform crypto, zero-dep)
// ---------------------------------------------------------------------------

/** Compute one passphrase's salted scrypt verifier (the record the registry stores; the passphrase itself NEVER persists). */
export function saltedVerifierOf(passphrase: string, salt: string): string {
  return scryptSync(passphrase, salt, KDF_KEY_LENGTH).toString('hex');
}

/** Verify a passphrase against a stored credential record (timing-safe; unknown record + wrong passphrase stay indistinguishable at the CALLER). */
function passphraseMatches(passphrase: string, record: PrincipalCredentialRecord): boolean {
  const candidate = saltedVerifierOf(passphrase, record.salt);
  return timingSafeEqualText(candidate, record.verifier);
}

// ---------------------------------------------------------------------------
// The routes (all run on the COMPLETE input — the dispatcher's guard is the runtime invariant)
// ---------------------------------------------------------------------------

/** The request-id mint of the auth routes (the demo-substance routes' own law — unique per invocation). */
function authRouteRequestId(request: AuthRouteRequest, serial: number): RequestId {
  return mintRequestId(fnv1a32Hex(canonicalJson(['auth-route', request.method, request.path, serial] as never)));
}

/** One 401 (the boundary's own unauthenticated law — the host routes' shared shape). */
function unauthenticated(requestId: RequestId): ApiResponse {
  return demoRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
}

/** The typed not-available of the auth surface (R46 — the loud teaching; the reason names the requirement, never a value). */
function authNotAvailable(requestId: RequestId, reason: 'demo-backing' | 'token-key'): ApiResponse {
  const message = reason === 'demo-backing'
    ? 'the principal account surface requires the DURABLE backing: under the DEMO backing the credential store is per-instance in-memory state that cold-start resets, and an account must never silently cold-start reset (R46; see docs/design/IDENTITY-MODEL.md §5 Wave 1) — the auth routes answer the typed not-available'
    : 'the principal account surface is not configured: the auth token-signing key (TRADRL_AUTH_TOKEN_KEY) is absent, and the surface requires configuration rather than a fallback key derived from another credential (R46) — the auth routes answer the typed not-available';
  return demoRouteError(requestId, apiError('unavailable', message));
}

/** The uniform 401 of a failed principal-token verification (absent/invalid/expired/revoked/foreign — indistinguishable by design). */
function principalTokenRequired(requestId: RequestId): ApiResponse {
  return demoRouteError(requestId, apiError('unauthenticated', `a valid principal token is required on this route (the ${PRINCIPAL_TOKEN_HEADER} header)`));
}

/** The typed 503 of a degraded credential-store read (R46 — never a partial view, never a silent fallback). */
function authDegraded(requestId: RequestId, operation: string, error: StoreFailure): ApiResponse {
  return demoRouteError(requestId, apiError('unavailable', `the ${operation} failed (${error.code}): ${error.message} — the auth route answers the typed degraded state (R46)`));
}

/** The register/login body's validated shape (the typed validation problems carry the broken paths). */
function credentialBodyOf(body: unknown): { readonly ok: true; readonly name: string; readonly passphrase: string } | { readonly ok: false; readonly problems: readonly ReturnType<typeof problem>[] } {
  if (typeof body !== 'object' || body === null) return { ok: false, problems: Object.freeze([problem('body', 'the request body must be a JSON object carrying name and passphrase')]) };
  const record = body as { readonly name?: unknown; readonly passphrase?: unknown };
  const problems: ReturnType<typeof problem>[] = [];
  let name: string | null = null;
  let passphrase: string | null = null;
  if (typeof record.name !== 'string' || record.name.trim().length < 1 || record.name.trim().length > 64) {
    problems.push(problem('name', 'the principal name must be a string of 1..64 characters (surrounding whitespace is not counted)'));
  } else {
    name = record.name.trim();
  }
  if (typeof record.passphrase !== 'string' || record.passphrase.length < 8 || record.passphrase.length > 256) {
    problems.push(problem('passphrase', 'the passphrase must be a string of 8..256 characters'));
  } else {
    passphrase = record.passphrase;
  }
  if (name === null || passphrase === null) return { ok: false, problems: Object.freeze(problems) };
  return { ok: true, name, passphrase };
}

/** The served principal identity view (from the token's claims) — NEVER the salt, NEVER the verifier. */
function principalViewOf(claims: PrincipalTokenClaims): { readonly id: string; readonly name: string } {
  return deepFreeze({ id: claims.sub, name: claims.name });
}

/** POST /v1/auth/register — create the named principal (salted verifier stored; token minted; registration logs in). */
async function registerRoute(input: CompleteAuthRouteInput, request: AuthRouteRequest, requestId: RequestId, authorizationTenant: string): Promise<ApiResponse> {
  const credentials = credentialBodyOf(request.body);
  if (!credentials.ok) {
    return demoRouteError(requestId, apiError('validation_failed', 'the registration body is not valid (the principal name and passphrase are required)', { problems: credentials.problems }));
  }
  // The duplicate-name check (the common path; the store's UNIQUE index is the concurrent-race backstop).
  const existing = await input.principals.principalByName(authorizationTenant, credentials.name);
  if (!existing.ok) return authDegraded(requestId, 'principal registry read', existing.error);
  if (existing.value !== null) {
    return demoRouteError(requestId, apiError('conflict', `a principal named ${JSON.stringify(credentials.name)} already exists in this tenant's registry — principal names are unique per tenant`));
  }
  // The credential record: a fresh principal id + a fresh salt; the verifier is the SALTED KDF digest (the passphrase itself NEVER persists).
  const salt = randomBytes(16).toString('hex');
  const stored: PrincipalCredentialRecord = deepFreeze({
    principalId: `prn-${randomBytes(8).toString('hex')}`,
    name: credentials.name,
    salt,
    verifier: saltedVerifierOf(credentials.passphrase, salt),
    createdAt: input.now(),
  });
  const put = await input.principals.putPrincipal(authorizationTenant, stored);
  if (!put.ok) return authDegraded(requestId, 'principal registry write', put.error);
  const minted = mintPrincipalToken(input, { sub: stored.principalId, name: stored.name, tid: authorizationTenant, jti: randomBytes(16).toString('hex') });
  return demoRouteSuccess(requestId, deepFreeze({ principal: principalViewOf(minted.claims), token: minted.token, expiresAt: minted.claims.exp }), 201);
}

/** POST /v1/auth/login — exchange the passphrase for a scoped, expiring, revocable token. */
async function loginRoute(input: CompleteAuthRouteInput, request: AuthRouteRequest, requestId: RequestId, authorizationTenant: string): Promise<ApiResponse> {
  const credentials = credentialBodyOf(request.body);
  if (!credentials.ok) {
    return demoRouteError(requestId, apiError('validation_failed', 'the login body is not valid (the principal name and passphrase are required)', { problems: credentials.problems }));
  }
  const read = await input.principals.principalByName(authorizationTenant, credentials.name);
  if (!read.ok) return authDegraded(requestId, 'principal registry read', read.error);
  // THE INDISTINGUISHABILITY LAW: an unknown name and a wrong passphrase answer
  // the IDENTICAL typed 401 — the caller learns nothing about which failed.
  if (read.value === null || !passphraseMatches(credentials.passphrase, read.value)) {
    return demoRouteError(requestId, apiError('unauthenticated', 'the principal name or passphrase is not correct'));
  }
  const minted = mintPrincipalToken(input, { sub: read.value.principalId, name: read.value.name, tid: authorizationTenant, jti: randomBytes(16).toString('hex') });
  return demoRouteSuccess(requestId, deepFreeze({ principal: principalViewOf(minted.claims), token: minted.token, expiresAt: minted.claims.exp }));
}

/**
 * POST /v1/auth/logout — revoke the presented token (the durable
 * revocation list; idempotent at the STORE layer). A SECOND logout with
 * the same token answers the typed 401: the token is dead, and the
 * revocation is enforced loudly on every verification path.
 */
async function logoutRoute(input: CompleteAuthRouteInput, request: AuthRouteRequest, requestId: RequestId, authorizationTenant: string): Promise<ApiResponse> {
  const resolution = await resolvePrincipalToken(input, request.headers, authorizationTenant);
  if (resolution.kind === 'degraded') return authDegraded(requestId, 'revocation-list read', resolution.error);
  if (resolution.kind === 'absent-or-invalid') return principalTokenRequired(requestId);
  const revocation: PrincipalRevocationRecord = deepFreeze({ principalId: resolution.token.principalId, tokenId: resolution.token.tokenId, revokedAt: input.now() });
  const put = await input.principals.putRevocation(authorizationTenant, revocation);
  if (!put.ok) return authDegraded(requestId, 'revocation-list write', put.error);
  return demoRouteSuccess(requestId, deepFreeze({ revoked: true }));
}

/** GET /v1/auth/whoami — the verified principal identity + expiry (NEVER the verifier; the salt never crosses either). */
async function whoamiRoute(input: CompleteAuthRouteInput, request: AuthRouteRequest, requestId: RequestId, authorizationTenant: string): Promise<ApiResponse> {
  const resolution = await resolvePrincipalToken(input, request.headers, authorizationTenant);
  if (resolution.kind === 'degraded') return authDegraded(requestId, 'revocation-list read', resolution.error);
  if (resolution.kind === 'absent-or-invalid') return principalTokenRequired(requestId);
  return demoRouteSuccess(requestId, deepFreeze({ principal: deepFreeze({ id: resolution.token.principalId, name: resolution.token.name }), expiresAt: resolution.token.expiresAt }));
}

/**
 * POST /v1/auth/adopt — the adoption ceremony's host half: the CALLING
 * session's OWN desks re-stamp the additive `ownerPrincipal` (beside
 * `ownerSession` — lineage preserved). NEVER a widening parameter: the
 * request body is IGNORED entirely; the target set is derived from the
 * session-ownership law over the FRESH session-listing rows (the same
 * JOIN the session routes read); the shared DEMO project is NEVER
 * adoptable (it is owned by no session). Idempotent per desk: a row
 * already carrying the same owner reports `changed: false` with no
 * durable write.
 */
async function adoptRoute(input: CompleteAuthRouteInput, request: AuthRouteRequest, requestId: RequestId, authorizationTenant: string): Promise<ApiResponse> {
  const resolution = await resolvePrincipalToken(input, request.headers, authorizationTenant);
  if (resolution.kind === 'degraded') return authDegraded(requestId, 'revocation-list read', resolution.error);
  if (resolution.kind === 'absent-or-invalid') return principalTokenRequired(requestId);
  const session = consoleSessionOf(request.headers);
  if (session === null) {
    return demoRouteError(requestId, apiError('validation_failed', 'the adoption route requires the console session header (it adopts the CALLING session\'s own desks — the session-ownership law scopes the target set, never a request parameter)', { problems: Object.freeze([problem('headers', 'the x-tradrl-console-session header is absent or malformed')]) }));
  }
  const rows = await input.adoption.sessionRowsOf(authorizationTenant);
  if (!rows.ok) return authDegraded(requestId, 'session-listing read', rows.error);
  // THE TARGET SET (derived, never parameterized): the rows the calling
  // session OWNS (ownerSession === session), the shared demo project
  // excluded — nothing else can adopt, no body value can widen it.
  const targets = rows.value.filter((row) => row.ownerSession === session && projectOfRow(row) !== DEMO_PROJECT_ID && projectOfRow(row).length > 0);
  const adoptions: { readonly projectId: string; readonly adopted: boolean; readonly changed: boolean }[] = [];
  for (const row of targets) {
    const projectId = projectOfRow(row);
    const stamp = await input.adoption.stampPrincipalOwner(authorizationTenant, projectId, resolution.token.principalId);
    adoptions.push(deepFreeze({ projectId, adopted: stamp.stamped, changed: stamp.changed }));
  }
  return demoRouteSuccess(requestId, deepFreeze({ adoptions: Object.freeze(adoptions), principal: deepFreeze({ id: resolution.token.principalId, name: resolution.token.name }) }));
}

// ---------------------------------------------------------------------------
// The dispatcher (null = not an auth route — fall through to the session
// routes / demo-substance routes / the frozen boundary)
// ---------------------------------------------------------------------------

/**
 * Serve one request off the host-owned principal auth routes. Returns
 * `null` when the request is NOT one of them (the caller falls through
 * — the pre-FW-39-1 behavior, byte-identical) or when the method is not
 * the route's own (the boundary answers its typed not-found for those
 * paths itself, exactly as before). `serial` is the caller's per-instance
 * request counter (the minted request ids stay unique per invocation —
 * the demo-substance routes' own law).
 */
export async function serveAuthRoute(input: AuthRouteInput, request: AuthRouteRequest, serial: number): Promise<ApiResponse | null> {
  // The path+method match FIRST (a non-matching request never pays an auth read).
  const isRegister = request.path === '/v1/auth/register' && request.method === 'POST';
  const isLogin = request.path === '/v1/auth/login' && request.method === 'POST';
  const isLogout = request.path === '/v1/auth/logout' && request.method === 'POST';
  const isWhoami = request.path === '/v1/auth/whoami' && request.method === 'GET';
  const isAdopt = request.path === '/v1/auth/adopt' && request.method === 'POST';
  if (!isRegister && !isLogin && !isLogout && !isWhoami && !isAdopt) return null;
  const requestId = authRouteRequestId(request, serial);
  // AUTHN FIRST (the W-8 host-route law — the developer credential gates the
  // tenant; the principal token gates the principal routes further down).
  const headers = request.headers as { readonly authorization?: unknown } | null;
  const authorization = input.verifyDeveloperAuthorization(typeof headers?.authorization === 'string' ? headers.authorization : undefined);
  if (authorization === null) return unauthenticated(requestId);
  // THE HONEST UNAVAILABILITY (R46): under the DEMO backing the credential
  // store does not exist (per-instance state would silently cold-start
  // reset accounts — forbidden); without the signing key the surface is
  // unconfigured. Both answer the typed not-available, LOUDLY, after authn.
  if (input.principals === null || input.tokenKey === null || input.adoption === null) {
    return authNotAvailable(requestId, input.principals === null || input.adoption === null ? 'demo-backing' : 'token-key');
  }
  // The guarded narrowing — the three non-null checks above are the runtime
  // invariant; the complete input is what every route below consumes.
  const complete = input as CompleteAuthRouteInput;
  if (isRegister) return registerRoute(complete, request, requestId, authorization.tenant);
  if (isLogin) return loginRoute(complete, request, requestId, authorization.tenant);
  if (isLogout) return logoutRoute(complete, request, requestId, authorization.tenant);
  if (isWhoami) return whoamiRoute(complete, request, requestId, authorization.tenant);
  return adoptRoute(complete, request, requestId, authorization.tenant);
}
