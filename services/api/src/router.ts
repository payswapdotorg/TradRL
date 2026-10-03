// @tradrl/api-service — THE ROUTE TABLE and the pattern matcher.
//
// The boundary's two planes as DATA: every route declares its plane,
// method, path pattern (`:param` segments), route family (the authz
// permission), its idempotency law (required on consequential routes
// — execution requests and job submissions; optional on other
// mutations) and its consequentiality (which requests emit the
// audited who/what/when/tenant/route/consequence record).
//
// THE VERSION LAW: the public plane's path carries the contract
// version (`/v1/...`). A path with an UNSUPPORTED version prefix
// (`/v2/...`) resolves to the typed `unsupported_version` naming the
// served versions — never a bare 404 (the developer must be able to
// negotiate).
//
// THE L8 LAW (structural): exactly ONE route family
// (`execution:write`) maps to the execution handler, and that handler
// touches the ExecutionGatewayPort and NOTHING else — the route table
// is the single source of truth the gate-bypass tests reason over.
//
// Spec anchors: R43, L8, L12, L20.

import { apiError, type ApiError } from './errors';
import { deepFreeze, isNonEmptyString } from './primitives';
import type { AuthPlane } from './auth';
import type { RouteFamily } from './contracts';
import { API_VERSIONS } from './contracts';

// ---------------------------------------------------------------------------
// The route declaration
// ---------------------------------------------------------------------------

/** The idempotency law of one route. */
export type IdempotencyLaw = 'required' | 'optional' | 'none';

/** One declared route. */
export interface RouteDeclaration {
  readonly plane: AuthPlane;
  readonly method: string;
  /** The path pattern with `:param` capture segments (e.g. `/v1/projects/:projectId`). */
  readonly pattern: string;
  /** The authz permission family. */
  readonly family: RouteFamily;
  /** The idempotency law (required on execution requests + job submissions). */
  readonly idempotency: IdempotencyLaw;
  /** Consequential requests (mutations + execution) emit the audited route/consequence record. */
  readonly consequential: boolean;
  /** The route's stable name (audit/metering dimension). */
  readonly name: string;
}

/** The full public route table. Frozen: adding a route is a contract change (the SDK mirrors it). */
export const PUBLIC_ROUTES: readonly RouteDeclaration[] = deepFreeze([
  { plane: 'public', method: 'GET', pattern: '/v1/meta', family: 'meta:read', idempotency: 'none', consequential: false, name: 'meta' },
  { plane: 'public', method: 'POST', pattern: '/v1/projects', family: 'projects:write', idempotency: 'optional', consequential: true, name: 'projects.create' },
  { plane: 'public', method: 'GET', pattern: '/v1/projects', family: 'projects:read', idempotency: 'none', consequential: false, name: 'projects.list' },
  { plane: 'public', method: 'GET', pattern: '/v1/projects/:projectId', family: 'projects:read', idempotency: 'none', consequential: false, name: 'projects.get' },
  { plane: 'public', method: 'POST', pattern: '/v1/projects/:projectId/lifecycle', family: 'projects:write', idempotency: 'optional', consequential: true, name: 'projects.lifecycle' },
  { plane: 'public', method: 'POST', pattern: '/v1/projects/:projectId/organization', family: 'projects:write', idempotency: 'optional', consequential: true, name: 'projects.bindOrganization' },
  { plane: 'public', method: 'POST', pattern: '/v1/knowledge/query', family: 'knowledge:read', idempotency: 'none', consequential: false, name: 'knowledge.query' },
  { plane: 'public', method: 'POST', pattern: '/v1/outcomes/query', family: 'outcomes:read', idempotency: 'none', consequential: false, name: 'outcomes.query' },
  { plane: 'public', method: 'POST', pattern: '/v1/post-mortems/query', family: 'outcomes:read', idempotency: 'none', consequential: false, name: 'postMortems.query' },
  { plane: 'public', method: 'POST', pattern: '/v1/jobs/research', family: 'jobs:write', idempotency: 'required', consequential: true, name: 'jobs.research' },
  { plane: 'public', method: 'POST', pattern: '/v1/jobs/learning', family: 'jobs:write', idempotency: 'required', consequential: true, name: 'jobs.learning' },
  { plane: 'public', method: 'GET', pattern: '/v1/jobs/:jobId', family: 'jobs:read', idempotency: 'none', consequential: false, name: 'jobs.get' },
  { plane: 'public', method: 'POST', pattern: '/v1/execution/requests', family: 'execution:write', idempotency: 'required', consequential: true, name: 'execution.requests' },
  { plane: 'public', method: 'GET', pattern: '/v1/organizations/:organizationRef/status', family: 'organizations:read', idempotency: 'none', consequential: false, name: 'organizations.status' },
]);

/** The full private route table (the internal service-to-service plane). Frozen. */
export const PRIVATE_ROUTES: readonly RouteDeclaration[] = deepFreeze([
  { plane: 'private', method: 'POST', pattern: '/internal/organizations/status', family: 'internal:organizations:write', idempotency: 'none', consequential: true, name: 'internal.organizations.status' },
  { plane: 'private', method: 'POST', pattern: '/internal/jobs/transitions', family: 'internal:jobs:write', idempotency: 'none', consequential: true, name: 'internal.jobs.transitions' },
  { plane: 'private', method: 'GET', pattern: '/internal/usage/:tenantId', family: 'internal:usage:read', idempotency: 'none', consequential: false, name: 'internal.usage' },
]);

/** The whole route table. */
export const ROUTES: readonly RouteDeclaration[] = deepFreeze([...PUBLIC_ROUTES, ...PRIVATE_ROUTES]);

// ---------------------------------------------------------------------------
// The pattern matcher
// ---------------------------------------------------------------------------

/** A resolved route: the declaration plus the captured path params. */
export interface ResolvedRoute {
  readonly route: RouteDeclaration;
  readonly params: Readonly<Record<string, string>>;
}

/** Split a pattern/path into segments (empty and '.' segments are illegal; '/'-normalized). */
function segmentsOf(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/** Match one pattern against one path; the captured params or null. */
function matchPattern(pattern: string, path: string): Readonly<Record<string, string>> | null {
  const patternSegments = segmentsOf(pattern);
  const pathSegments = segmentsOf(path);
  if (patternSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index++) {
    const patternSegment = patternSegments[index]!;
    const pathSegment = pathSegments[index]!;
    if (patternSegment.startsWith(':')) {
      if (!isNonEmptyString(pathSegment)) return null;
      params[patternSegment.slice(1)] = pathSegment;
      continue;
    }
    if (patternSegment !== pathSegment) return null;
  }
  return Object.freeze(params);
}

/** The version prefix of a path (e.g. 'v1'), or null when the path carries none. */
export function versionPrefixOf(path: string): string | null {
  const segments = segmentsOf(path);
  if (segments.length === 0) return null;
  const first = segments[0]!;
  return /^v\d+$/.test(first) ? first : null;
}

/**
 * Resolve one request's route. The resolution verdict:
 *   - a full match -> the declaration + params;
 *   - an unsupported VERSION prefix -> the typed `unsupported_version`
 *     (naming the served versions — the negotiation surface);
 *   - a path that matches a pattern with a DIFFERENT method -> the
 *     typed `method_not_allowed`;
 *   - anything else -> the typed `not_found`.
 * Total: never throws.
 */
export function resolveRoute(method: string, path: string): { readonly ok: true; readonly resolved: ResolvedRoute } | { readonly ok: false; readonly error: ApiError } {
  // The version law: a path whose FIRST segment is a version-looking
  // prefix we do not serve is the typed version error.
  const version = versionPrefixOf(path);
  if (version !== null && !(API_VERSIONS as readonly string[]).includes(version)) {
    return {
      ok: false,
      error: apiError(
        'unsupported_version',
        `the path's API version prefix "${version}" is not served by this boundary — the served versions are: ${API_VERSIONS.join(', ')} (negotiate via GET /v1/meta)`,
      ),
    };
  }

  const normalizedMethod = method.toUpperCase();
  let pathMatches = false;
  for (const route of ROUTES) {
    const params = matchPattern(route.pattern, path);
    if (params === null) continue;
    pathMatches = true;
    if (route.method.toUpperCase() === normalizedMethod) {
      return { ok: true, resolved: { route, params } };
    }
  }
  if (pathMatches) {
    return {
      ok: false,
      error: apiError('method_not_allowed', `the path ${JSON.stringify(path)} is served, but not with the method ${normalizedMethod}`),
    };
  }
  return {
    ok: false,
    error: apiError('not_found', `no route is declared at ${JSON.stringify(path)} on either plane of this boundary`),
  };
}

/** Every declared family (the permission vocabulary in route order — the meta surface). */
export function declaredFamilies(plane: AuthPlane): readonly RouteFamily[] {
  const families: RouteFamily[] = [];
  for (const route of ROUTES) {
    if (route.plane !== plane) continue;
    if (!families.includes(route.family)) families.push(route.family);
  }
  return Object.freeze(families);
}
