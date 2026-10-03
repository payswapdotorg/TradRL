// @tradrl/api-service — the authn/authz substrate and the PLANE LAW.
//
// THE PLANE LAW (Work Order): the boundary serves two strictly
// separated auth planes:
//   - PUBLIC  — developer/tenant credentials ('dev:') route ONLY the
//     versioned /v1 surface;
//   - PRIVATE — internal service credentials ('int:') route ONLY the
//     /internal surface (control-plane and agent-runtime endpoints).
// A public token hitting a private route is the typed 403
// `wrong_auth_plane` (test REQUIRED); the reverse is the same typed
// error. The planes share NOTHING: no credential is dual-plane.
//
// AUTHN: `Authorization: Bearer <token>` — tokens are opaque strings
// minted by the host at credential registration and mapped 1:1 in the
// registry (construction-time injection; the boundary NEVER mints
// tokens over the wire). A missing/unknown token is the typed 401
// `unauthenticated`.
//
// AUTHZ: route-family permissions per credential. A credential without
// the route's family is the typed 403 `forbidden`. Untrusted text can
// NEVER grant anything (L20/SECURITY.md): permissions live ONLY in the
// registry, injected at construction — never in payloads, never in
// headers, never in prompts.
//
// Spec anchors: SECURITY.md (trust zones, tenant isolation, untrusted
// input), ARCHITECTURE-LOCK.md L12/L20, R43.

import { canonicalJson, deepFreeze, fnv1a32Hex, isNonEmptyString, isRecord } from './primitives';
import { apiError, type ApiError } from './errors';
import type { PrivateRouteFamily, PublicRouteFamily, RouteFamily } from './contracts';
import { isPrivateRouteFamily, isPublicRouteFamily } from './contracts';
import type { InternalCredentialId, DeveloperCredentialId, TenantId } from './ids';
import { mintDeveloperCredentialId, mintInternalCredentialId } from './ids';

// ---------------------------------------------------------------------------
// The credential record
// ---------------------------------------------------------------------------

/** The auth-plane vocabulary. */
export const AUTH_PLANES = ['public', 'private'] as const;

/** One auth plane. */
export type AuthPlane = (typeof AUTH_PLANES)[number];

/** Guard: an auth plane. */
export function isAuthPlane(v: unknown): v is AuthPlane {
  return typeof v === 'string' && (AUTH_PLANES as readonly string[]).includes(v);
}

/** The public-plane credential: a developer/tenant actor. */
export interface DeveloperCredential {
  readonly kind: 'developer';
  readonly credentialId: DeveloperCredentialId;
  /** The owning tenant — the L12 isolation root injected into every request this credential makes. */
  readonly tenant: TenantId;
  /** The principal name (audit WHO; opaque to the boundary). */
  readonly principal: string;
  /** The granted route families (authz; registry-injected only). */
  readonly permissions: readonly PublicRouteFamily[];
}

/** The private-plane credential: an internal platform service. */
export interface InternalCredential {
  readonly kind: 'internal';
  readonly credentialId: InternalCredentialId;
  /** The service principal name (e.g. 'agent-runtime', 'control-plane'). */
  readonly principal: string;
  /** The granted internal route families (authz; registry-injected only). */
  readonly permissions: readonly PrivateRouteFamily[];
}

/** One registered credential — exactly one plane, never both. */
export type ApiCredential = DeveloperCredential | InternalCredential;

/** Guard: a developer credential. */
export function isDeveloperCredential(v: unknown): v is DeveloperCredential {
  if (!isRecord(v) || v.kind !== 'developer') return false;
  if (typeof v.credentialId !== 'string' || !/^dev:[0-9a-f]{8}$/.test(v.credentialId)) return false;
  if (!isNonEmptyString(v.tenant)) return false;
  if (!isNonEmptyString(v.principal)) return false;
  if (!Array.isArray(v.permissions) || !v.permissions.every((p) => isPublicRouteFamily(p))) return false;
  return true;
}

/** Guard: an internal credential. */
export function isInternalCredential(v: unknown): v is InternalCredential {
  if (!isRecord(v) || v.kind !== 'internal') return false;
  if (typeof v.credentialId !== 'string' || !/^int:[0-9a-f]{8}$/.test(v.credentialId)) return false;
  if (!isNonEmptyString(v.principal)) return false;
  if (!Array.isArray(v.permissions) || !v.permissions.every((p) => isPrivateRouteFamily(p))) return false;
  return true;
}

/** Guard: any credential. */
export function isApiCredential(v: unknown): v is ApiCredential {
  return isDeveloperCredential(v) || isInternalCredential(v);
}

/** The plane a credential belongs to. */
export function planeOf(credential: ApiCredential): AuthPlane {
  return credential.kind === 'developer' ? 'public' : 'private';
}

// ---------------------------------------------------------------------------
// The credential registry (construction-time injection)
// ---------------------------------------------------------------------------

/** One registration input: the credential plus its opaque bearer token. */
export interface CredentialRegistration {
  readonly credential: ApiCredential;
  /** The bearer token mapping to this credential (opaque non-empty; host-minted). */
  readonly token: string;
}

/** Guard: a credential registration. */
export function isCredentialRegistration(v: unknown): v is CredentialRegistration {
  return isRecord(v) && isApiCredential(v.credential) && isNonEmptyString(v.token);
}

/**
 * The credential registry: tokens -> credentials. Built at service
 * construction from the injected registrations; IMMUTABLE afterwards
 * (credential issuance is a host act at the secure boundary, never a
 * wire act — the registry has no runtime mutation entry point).
 */
export class CredentialRegistry {
  private readonly byToken: ReadonlyMap<string, ApiCredential>;
  private readonly byId: ReadonlyMap<string, ApiCredential>;

  constructor(registrations: readonly CredentialRegistration[]) {
    const byToken = new Map<string, ApiCredential>();
    const byId = new Map<string, ApiCredential>();
    for (const registration of registrations) {
      if (!isCredentialRegistration(registration)) {
        throw new Error('CredentialRegistry: invalid registration (credential + token required)');
      }
      if (byToken.has(registration.token) || byId.has(registration.credential.credentialId)) {
        throw new Error('CredentialRegistry: duplicate token or credential id in registrations');
      }
      byToken.set(registration.token, deepFreeze(registration.credential));
      byId.set(registration.credential.credentialId, registration.credential);
    }
    this.byToken = byToken;
    this.byId = byId;
  }

  /** Authn: resolve a bearer token to its credential (null when unknown/absent — never throws). */
  resolve(token: string | undefined): ApiCredential | null {
    if (token === undefined || !isNonEmptyString(token)) return null;
    return this.byToken.get(token) ?? null;
  }

  /** Lookup by credential id (audit/metering joins). */
  credentialOf(credentialId: string): ApiCredential | null {
    return this.byId.get(credentialId) ?? null;
  }

  /** The number of registered credentials (all planes). */
  get size(): number {
    return this.byToken.size;
  }
}

// ---------------------------------------------------------------------------
// Authn: the bearer-token extraction
// ---------------------------------------------------------------------------

/** Extract the bearer token from an Authorization header value (null when absent/malformed). */
export function bearerTokenOf(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length);
  return isNonEmptyString(token) ? token : null;
}

// ---------------------------------------------------------------------------
// The pipeline's authn/authz/plane stages (pure; typed errors)
// ---------------------------------------------------------------------------

/** The authn verdict: the resolved credential or the typed 401. */
export function authenticate(registry: CredentialRegistry, authorization: string | undefined): { readonly ok: true; readonly credential: ApiCredential } | { readonly ok: false; readonly error: ApiError } {
  const token = bearerTokenOf(authorization);
  if (token === null) {
    return {
      ok: false,
      error: apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'),
    };
  }
  const credential = registry.resolve(token);
  if (credential === null) {
    return {
      ok: false,
      error: apiError('unauthenticated', 'the presented credential token is not registered at this boundary'),
    };
  }
  return { ok: true, credential };
}

/** The plane verdict: the credential's plane must BE the route's plane (`wrong_auth_plane` otherwise). */
export function authorizePlane(credential: ApiCredential, routePlane: AuthPlane): { readonly ok: true } | { readonly ok: false; readonly error: ApiError } {
  const credentialPlane = planeOf(credential);
  if (credentialPlane !== routePlane) {
    return {
      ok: false,
      error: apiError(
        'wrong_auth_plane',
        credentialPlane === 'public'
          ? 'a public (developer) credential cannot route the internal service-to-service plane — the planes are strictly separated (a public token on a private route is a typed 403)'
          : 'an internal service credential cannot route the public developer plane — the planes are strictly separated',
      ),
    };
  }
  return { ok: true };
}

/** The authz verdict: the credential's permission set must contain the route's family. */
export function authorizeRoute(credential: ApiCredential, family: RouteFamily): { readonly ok: true } | { readonly ok: false; readonly error: ApiError } {
  if (!(credential.permissions as readonly string[]).includes(family)) {
    return {
      ok: false,
      error: apiError(
        'forbidden',
        `the credential ${credential.credentialId} (${credential.principal}) does not carry the "${family}" route family — permissions are registry-injected facts, never payload grants (L20)`,
      ),
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Credential minting helpers (host-side; construction-time only)
// ---------------------------------------------------------------------------

/** Derive a developer credential id from its identity content (deterministic). */
export function developerCredentialIdFor(tenant: string, principal: string): DeveloperCredentialId {
  return mintDeveloperCredentialId(fnv1a32Hex(canonicalJson({ kind: 'developer', tenant, principal })));
}

/** Derive an internal credential id from its identity content (deterministic). */
export function internalCredentialIdFor(principal: string): InternalCredentialId {
  return mintInternalCredentialId(fnv1a32Hex(canonicalJson({ kind: 'internal', principal })));
}

deepFreeze(AUTH_PLANES);
