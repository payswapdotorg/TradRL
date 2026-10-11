// deploy/vercel/runtime/alerts.ts — THE PRICE-ALERT DECLARATION (FW-46, the
// S2 market-facing surface — S2's top friction, Round L seventh round:
// "zero charts, live data feeds, or price alerts anywhere in the console,
// so I keep paying for and living in TradingView for prices while
// TradRL holds the governance"; "Market World is the persisted launch
// spec, not a market view").
//
// WHAT THIS IS: the HOST-OWNED consequential route
//
//   POST /v1/projects/:projectId/alerts
//
// — the W-8/FW-31-A/FW-32-A/FW-45 host-route law (served BEFORE the
// boundary wrap with developer-credential authn; the path is declared
// NOWHERE in the frozen T041 route table — the notes.ts precedent this
// module mirrors). A declared alert is the desk's OWN declaration
// (market + direction + level), stored on the project's goal-set row —
// the SAME opaque payload column the launch world (W-28 D-8), the
// ownership stamps (FW-MI-A/FW-39-1) and the research notes (FW-45)
// ride. One storage, four consumers: the host goal route serves the
// alerts back (the console's boot re-read — the `world`/`notes`
// additive-field precedent), the research deliverable's provenance block
// names them (runtime/deliverable.ts), the console's market view folds
// their firing state (apps/web core/market.ts — fires ONLY on recorded
// fill prices), and the console derives alert-declared/alert-fired export
// events (apps/web export-record) — THE ALERTS REACH THE CHAIN.
//
// THE CONTRACT (typed per the established laws — authn first):
//   401 unauthenticated  — a Bearer token that is not the deployment's
//                         registered developer credential (the W-8 law).
//   400 validation_failed — the body is not an alert: not an object, a
//                         missing/empty/oversized market (1..64 chars), a
//                         direction outside 'above'|'below', or a level
//                         that is not a POSITIVE exact-decimal string (the
//                         wire grammar, at most 32 chars). The broken
//                         paths are named in the problems — NEVER a
//                         half-applied alert (the draft-store law; 400 is
//                         the boundary's own untrusted-payload status,
//                         errors.ts's frozen mapping — never a novel one).
//   404 not_found        — no goal set on record for the project (unknown
//                         and cross-tenant stay indistinguishable, the
//                         boundary's own law). The alert rides a record
//                         that must exist — fail-closed, never an alert
//                         on nothing.
//   503 unavailable      — the storage read/write failed (the drain's
//                         own typed failure surfaces — the mutation is
//                         unconfirmed, the caller learns); a DEGRADED
//                         revocation read on the actor stamp fails closed
//                         too (the FW-39-3 law).
//   200 { alert }        — the minted record (or, on a re-declare of an
//                         alert the project already carries — the same
//                         market + direction + level, the client's own
//                         idempotency-key unit — the SAME stored record:
//                         the FIRST mint stands, never a duplicate row).
//
// THE MINT (pure, deterministic): alertId is CONTENT-ADDRESSED over the
// alert's own envelope (tenant + project + declaredAt + market +
// direction + level) — the house id grammar (`alert:` + 8 hex). The
// declaredAt is the ROUTE'S OWN observation (L4 — never a request value,
// never backdated). The optional ACTOR stamp (the FW-39-3 promote law)
// rides as the additive actorPrincipal/actorAt fields; an anonymous
// declaration carries the honest absence.
//
// DISCLOSED LIMITATIONS (honest — UX-DESIGN §7 anti-deception):
//   - An alert FIRES ONLY ON OBSERVATIONS ON RECORD: the console
//     evaluates the declaration against the desk's own recorded fill
//     prices (the earliest crossing at-or-after the declaration). NO
//     live market feed exists in this deployment — an alert never
//     watches a live market, and the console's surface teaches exactly
//     this at the point of use.
//   - Under the DEMO backing the storage is PER-INSTANCE (the demo arm's
//     own law — a serverless cold start resets it; honest under the
//     SIMULATED badge). Under the DURABLE backing the alert merges into
//     the goal-set row and write-throughs on the SAME pending drain
//     every stamp rides — DURABLE RECORD, served by every instance's
//     projection.
//   - Host-owned routes run outside the T041 pipeline's metering/audit
//     tail — the one W-8 limitation every host route carries.
//
// NO CORS headers are ever emitted (the same-origin law — pinned by
// deploy/vercel/vercel.test.ts, which scans this file too).
//
// THE NO-CYCLE LAW (the notes.ts precedent): this module is imported BY
// deploy/vercel/api/router.ts + runtime/compose.ts, so it imports ONLY
// frozen-service primitives + types — never a runtime dependency on
// './routes'.
//
// Zero-dep law: platform APIs only. Spec anchors: R43 (additive), R45
// (provenance), R46 (every failure path typed; never a crash), L4 (the
// declaredAt is the route's own instant), L12 (every fold keys on the
// AUTHORIZED tenant), L9 (the level is an exact-decimal string, verbatim).

import {
  apiError,
  canonicalJson,
  CURRENT_API_VERSION,
  deepFreeze,
  fnv1a32Hex,
  isRecord,
  mintRequestId,
  problem,
  type ApiError,
  type ApiRequest,
  type ApiResponse,
  type RequestId,
} from '../../../services/api/src/index';
import type { StoreFailure } from '../../adapters/shared';
import type { PrincipalResolution } from './auth-routes'; // TYPE-ONLY (the no-cycle law: erased at runtime)

// ---------------------------------------------------------------------------
// The record + the untrusted-input gate
// ---------------------------------------------------------------------------

/**
 * ONE DECLARED PRICE ALERT — the desk's own declaration (market +
 * direction + level), stored on the goal-set record (the FW-46 record
 * class). Every field is the mint's own or the input's own, verbatim;
 * the FIRING is derived by the console against recorded prices (never
 * here — nothing about a live market is claimed or watched).
 */
export interface PriceAlertRecord {
  /** The content-addressed identity (`alert:` + 8 hex — the house id grammar). */
  readonly alertId: string;
  /** The AUTHORIZED tenant (L12 — never a request value). */
  readonly tenant: string;
  /** The project whose goal-set row carries the alert. */
  readonly project: string;
  /** The route's OWN observation instant (L4 — never a request value). */
  readonly declaredAt: number;
  /** The instrument the alert watches (e.g. 'BTC-USD'), verbatim (1..64 characters). */
  readonly market: string;
  /** The crossing direction: 'above' fires at price >= level; 'below' at price <= level. */
  readonly direction: 'above' | 'below';
  /** The alert's price level — a positive exact-decimal string, verbatim (at most 32 characters). */
  readonly level: string;
  /**
   * The declaring ACTOR (the FW-39-3 audit-stamp law): the principal id
   * whose VALID token rode the declare request. ADDITIVE; absent on an
   * ANONYMOUS declaration — the honest absence, never fabricated.
   */
  readonly actorPrincipal?: string;
  /** The actor stamp's OWN observed instant (the mint's own declaredAt — L4). Absent exactly when `actorPrincipal` is. */
  readonly actorAt?: number;
}

/** The market's honest bound (an instrument id, not a sentence — the input gate teaches it). */
export const PRICE_ALERT_MARKET_MAX = 64;

/** The level's honest bound (a price, exact-decimal grammar, bounded for one opaque row). */
export const PRICE_ALERT_LEVEL_MAX = 32;

/** The alert-declare body's validated shape. */
export interface PriceAlertInput {
  readonly market: string;
  readonly direction: 'above' | 'below';
  readonly level: string;
}

/** The exact-decimal grammar (the wire's own — no exponent, no grouping, no sign here: levels are positive). */
const POSITIVE_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * THE UNTRUSTED-INPUT GATE (the draft-store law): parse the request body
 * STRUCTURALLY, fail-closed, and refuse WHOLE — never a half-applied
 * alert. The bounds are policy, taught in the problems themselves.
 */
export function parsePriceAlertBody(body: unknown): { readonly ok: true; readonly input: PriceAlertInput } | { readonly ok: false; readonly problems: readonly ReturnType<typeof problem>[] } {
  if (!isRecord(body)) {
    return { ok: false, problems: Object.freeze([problem('body', 'the request body must be a JSON object carrying market, direction and level')]) };
  }
  const problems: ReturnType<typeof problem>[] = [];
  let market: string | null = null;
  let direction: 'above' | 'below' | null = null;
  let level: string | null = null;
  const marketValue = (body as { readonly market?: unknown }).market;
  if (typeof marketValue !== 'string' || marketValue.trim().length === 0 || marketValue.trim().length > PRICE_ALERT_MARKET_MAX) {
    problems.push(problem('market', `the alert market must be a string of 1..${PRICE_ALERT_MARKET_MAX} characters (the instrument id it watches, e.g. BTC-USD)`));
  } else {
    market = marketValue.trim();
  }
  const directionValue = (body as { readonly direction?: unknown }).direction;
  if (directionValue !== 'above' && directionValue !== 'below') {
    problems.push(problem('direction', "the alert direction must be exactly 'above' or 'below' (the crossing the alert watches)"));
  } else {
    direction = directionValue;
  }
  const levelValue = (body as { readonly level?: unknown }).level;
  if (typeof levelValue !== 'string' || !POSITIVE_DECIMAL_PATTERN.test(levelValue) || levelValue === '0' || levelValue.length > PRICE_ALERT_LEVEL_MAX) {
    problems.push(problem('level', `the alert level must be a positive exact-decimal string of at most ${PRICE_ALERT_LEVEL_MAX} characters (e.g. 61000.50) — the wire's own decimal grammar, stored verbatim`));
  } else {
    level = levelValue;
  }
  if (market === null || direction === null || level === null) return { ok: false, problems: Object.freeze(problems) };
  return { ok: true, input: { market, direction, level } };
}

/**
 * Structural parse of ONE SERVED alert record (the way-out half of the
 * untrusted-input law: a stored row that no longer parses serves as
 * ABSENT — skipped honestly, never a crash, never a half-record — R46).
 */
export function parsePriceAlertRecord(value: unknown): PriceAlertRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.alertId !== 'string' || value.alertId.length === 0) return null;
  if (typeof value.tenant !== 'string' || value.tenant.length === 0) return null;
  if (typeof value.project !== 'string' || value.project.length === 0) return null;
  if (typeof value.declaredAt !== 'number' || !Number.isFinite(value.declaredAt)) return null;
  if (typeof value.market !== 'string' || value.market.length === 0) return null;
  if (value.direction !== 'above' && value.direction !== 'below') return null;
  if (typeof value.level !== 'string' || value.level.length === 0) return null;
  const actorPrincipal = (value as { readonly actorPrincipal?: unknown }).actorPrincipal;
  const actorAt = (value as { readonly actorAt?: unknown }).actorAt;
  return {
    alertId: value.alertId,
    tenant: value.tenant,
    project: value.project,
    declaredAt: value.declaredAt,
    market: value.market,
    direction: value.direction,
    level: value.level,
    ...(typeof actorPrincipal === 'string' && actorPrincipal.length > 0 && typeof actorAt === 'number' && Number.isFinite(actorAt) ? { actorPrincipal, actorAt } : {}),
  };
}

/** The well-formed alerts of one stored `alerts` field (an opaque unknown — malformed entries are skipped honestly, R46). */
export function priceAlertsOf(field: unknown): readonly PriceAlertRecord[] {
  if (!Array.isArray(field)) return [];
  const alerts: PriceAlertRecord[] = [];
  for (const entry of field) {
    const parsed = parsePriceAlertRecord(entry);
    if (parsed !== null) alerts.push(parsed);
  }
  return Object.freeze(alerts);
}

// ---------------------------------------------------------------------------
// The mint (pure, deterministic over the envelope)
// ---------------------------------------------------------------------------

/** The content-addressed alert id over the alert's own envelope (the house id grammar). */
export function mintPriceAlert(tenant: string, project: string, at: number, input: PriceAlertInput, actor?: { readonly principalId: string }): PriceAlertRecord {
  return deepFreeze({
    alertId: `alert:${fnv1a32Hex(canonicalJson(['price-alert', tenant, project, at, input.market, input.direction, input.level] as never))}`,
    tenant,
    project,
    declaredAt: at,
    market: input.market,
    direction: input.direction,
    level: input.level,
    ...(actor === undefined ? {} : { actorPrincipal: actor.principalId, actorAt: at }),
  });
}

// ---------------------------------------------------------------------------
// The storage seam (both backings implement it)
// ---------------------------------------------------------------------------

/** The typed declare outcome: the stored record, or the typed failure (target absent = the honest 404; anything else = the drain's own 503). */
export type AlertDeclareOutcome =
  | { readonly ok: true; readonly alert: PriceAlertRecord }
  | { readonly ok: false; readonly error: StoreFailure };

/**
 * The composition's alert-declaration surface — ONE function the route
 * drives, implemented per backing: under DURABLE the goal-set row merge
 * (the same pending drain every stamp rides — the write confirms before
 * the response leaves) and write-through, idempotent PER CONTENT (a
 * re-declare of the same market+direction+level returns the STORED
 * record — the FIRST mint stands); under DEMO the per-instance capture
 * (the promote registry's own disclosed law). NULL under port overrides
 * (the route is absent — the boundary's typed not-found, the pre-law).
 */
export interface AlertDeclarationSurface {
  /** Declare one minted alert on the project's record (idempotent per alertId — the FIRST stored record stands). */
  readonly declare: (tenant: string, project: string, alert: PriceAlertRecord) => Promise<AlertDeclareOutcome>;
}

// ---------------------------------------------------------------------------
// The envelope discipline (the notes.ts precedent: built from the frozen
// service's own primitives — no runtime dependency on './routes')
// ---------------------------------------------------------------------------

/** The minimal request surface the alert route consumes (the wrapped ApiRequest carries exactly these + the body). */
export type AlertDeclareRequest = Pick<ApiRequest, 'method' | 'path' | 'headers'> & { readonly body?: unknown };

function alertRouteRequestId(request: AlertDeclareRequest, serial: number): RequestId {
  return mintRequestId(fnv1a32Hex(canonicalJson(['alert-declare-route', request.method, request.path, serial] as never)));
}

function alertRouteSuccess(requestId: RequestId, data: unknown): ApiResponse {
  return deepFreeze({ status: 200, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION }, body: { requestId, data } });
}

function alertRouteError(requestId: RequestId, error: ApiError): ApiResponse {
  const headers: Record<string, string> = { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION };
  if (error.retryAfterMs !== undefined) headers['retry-after-ms'] = String(error.retryAfterMs);
  return deepFreeze({ status: error.status, headers, body: { requestId, error } });
}

/** The `/v1/projects/:projectId/alerts` path match (the captured project id, or null). */
export function matchAlertDeclarePath(path: string): string | null {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 4) return null;
  if (segments[0] !== 'v1' || segments[1] !== 'projects' || segments[3] !== 'alerts') return null;
  const projectId = segments[2] as string;
  return projectId.length > 0 ? projectId : null;
}

/** The alert route's structural input (the composition builds it; null alerts = the route is absent under port overrides). */
export interface AlertDeclareRouteInput {
  /** The host auth seam (the composition's registered developer credential — the W-8 law). */
  readonly verifyDeveloperAuthorization: (authorization: string | undefined) => { readonly tenant: string; readonly principal: string } | null;
  /** The backing's alert-declaration surface (the storage seam above). */
  readonly alerts: AlertDeclarationSurface;
  /**
   * THE PRINCIPAL TOKEN RESOLVER (FW-39-3, the audit stamp — optional so
   * existing constructions stay valid): a VALID token stamps the mint's
   * additive actor fields; an absent/invalid one mints the ANONYMOUS
   * shape; a DEGRADED revocation read answers the typed 503 (fail
   * closed — the promote route's own law).
   */
  readonly resolvePrincipalToken?: (headers: unknown, tenant: string) => Promise<PrincipalResolution>;
}

/**
 * Serve ONE POST /v1/projects/:projectId/alerts request. Returns `null`
 * when the request is NOT the alert route (the caller falls through to
 * the frozen boundary — the pre-FW-46 behavior, byte-identical). Authn
 * FIRST (the typed 401); the untrusted-input gate answers the typed 400
 * validation_failed (the boundary's own untrusted-payload status — never
 * a half-applied alert); the storage answers the typed 404 (no goal set
 * on record — fail-closed) or the drain's own typed 503; the mint is
 * idempotent per content. FW-39-3: a request carrying a VALID principal
 * token stamps the additive actor fields; a degraded revocation read
 * fails closed (the typed 503).
 */
export async function serveAlertDeclareRoute(input: AlertDeclareRouteInput, request: AlertDeclareRequest, serial: number): Promise<ApiResponse | null> {
  if (request.method !== 'POST') return null;
  const projectId = matchAlertDeclarePath(request.path);
  if (projectId === null) return null;
  const requestId = alertRouteRequestId(request, serial);
  // AUTHN FIRST (the boundary's own 401 law — the W-8 host routes' own shape).
  const authorization = input.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) {
    return alertRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
  }
  // THE UNTRUSTED-INPUT GATE (fail-closed, refused whole — the typed 400
  // validation_failed, the boundary's own untrusted-payload law).
  const parsed = parsePriceAlertBody(request.body);
  if (!parsed.ok) {
    return alertRouteError(requestId, apiError('validation_failed', 'the price-alert body is not valid (the market, direction and level are required, bounded, and stored verbatim — this deployment fetches nothing)', { problems: parsed.problems }));
  }
  // FW-39-3 — THE ACTOR RESOLUTION (the audit stamp, the promote route's law):
  // resolved only on the valid-input path. A VALID token stamps the mint; an
  // absent/invalid one mints the anonymous shape; a DEGRADED revocation read
  // FAILS CLOSED (the typed 503 — an unverifiable token is never honored).
  let actor: { readonly principalId: string } | undefined;
  if (input.resolvePrincipalToken !== undefined) {
    const resolution = await input.resolvePrincipalToken(request.headers, authorization.tenant);
    if (resolution.kind === 'degraded') {
      return alertRouteError(requestId, apiError('unavailable', `the revocation-list read failed (${resolution.error.code}): ${resolution.error.message} — the alert declare fails closed (R46); retry declares idempotently`));
    }
    if (resolution.kind === 'valid') actor = { principalId: resolution.token.principalId };
  }
  // THE MINT (L4: the route's OWN observation instant — never a request value).
  const alert = mintPriceAlert(authorization.tenant, projectId, Date.now(), parsed.input, actor);
  // THE STORAGE (L12 by construction — the surface keys on the AUTHORIZED tenant;
  // unknown and cross-tenant projects answer the typed 404, indistinguishably).
  const declared = await input.alerts.declare(authorization.tenant, projectId, alert);
  if (!declared.ok) {
    if (declared.error.code === 'price_alert_target_absent') {
      return alertRouteError(requestId, apiError('not_found', `no goal set exists for ${JSON.stringify(projectId)} at this host (the alert attaches to the project's own goal-set record — the record must exist; unknown and cross-tenant are indistinguishable)`));
    }
    return alertRouteError(requestId, apiError('unavailable', `the price-alert storage failed (${declared.error.code}): ${declared.error.message} — the declare is unconfirmed (R46)`));
  }
  return alertRouteSuccess(requestId, deepFreeze({ alert: declared.alert }));
}
