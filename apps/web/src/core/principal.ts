// @tradrl/web-console — THE NAMED PRINCIPAL (FW-39-2, identity Wave 2 —
// docs/design/IDENTITY-MODEL.md §5 Wave 2; the G-11 restart-orphan
// deployment blocker's user-facing half).
//
// THE LAW (the design's option (c), Phase 1): the deployed console was
// anonymous by design — one developer credential baked into the public
// shell, one shared tenant, ownership stamped by a DYING correlation
// device (the localStorage session id) — so a browser restart, a cleared
// profile or a new machine orphaned every desk the user launched (Round
// F/G's four-word posture: durable DATA / ephemeral SESSION / absent
// IDENTITY / ORPHANED access). Wave 1 (deploy/vercel, a parallel
// surface) ships the host substrate; THIS module is the console's
// client half — the token store, the auth client against the DOCUMENTED
// contract, and the whoami cache — coded DEFENSIVELY (the routes may
// not exist yet on a given backing; the typed answers below are the
// whole truth the surface ever claims).
//
// THE DOCUMENTED CONTRACT (design §5 Wave 1; the parallel wave owns the
// server side — this module never assumes beyond it):
//   POST /v1/auth/register  { name, passphrase }        -> { token, principal }
//   POST /v1/auth/login     { name, passphrase }        -> { token, principal }
//   POST /v1/auth/logout    (Bearer principal token)    -> 2xx
//   GET  /v1/auth/whoami    (Bearer principal token)    -> { principal }
//   POST /v1/auth/adopt     (Bearer + the session header) -> { desks: [...] }
// Typed 401/404/503 per the boundary's own envelope discipline
// ({ requestId, data } / { requestId, error }); unknown-vs-foreign
// indistinguishable; under the DEMO backing every route answers the
// TYPED not-available (503 — an account must never silently cold-start
// reset, R46). The adopt route takes NO widening parameter (the FW-37-B
// module-level lesson): it re-stamps the CALLING session's own desks,
// idempotently, with a PER-DESK response.
//
// THE TRUST-ZONE AMENDMENT (the design §3(c), disclosed): localStorage
// gains ONE revocable bearer token (never the passphrase — the host
// stores only a salted verifier; the console never persists or sends
// it after the login call). The public shell ALREADY bakes the
// developer credential, so this adds no new exposure class — it
// strictly narrows what a stolen browser holds (principal desks,
// revocable) versus the status quo (the tenant credential,
// irrevocable). A storage that refuses (private mode) degrades to
// per-boot sessions — the same honest-degradation class as the session
// id's ephemeral mint.
//
// This module is PURE + storage-seamed (the core/session.ts pattern):
// no DOM, no clock, no fetch — the transport and the storage are
// INJECTED (tests script both), and every parse of an untrusted answer
// degrades to a typed error, never a fabricated identity.

import type { ApiTransport, SdkResponse } from '../api/transport';
import { ApiConsoleError, errorFromEnvelope } from '../api/errors';
import type { ProjectRecord } from '../api/contracts';
import { isDemoProject, sessionOwnDesksOf } from './tenant';

// ---------------------------------------------------------------------------
// The token store (the storage seam)
// ---------------------------------------------------------------------------

/**
 * The principal session's storage key (the browser trust zone). One
 * validated JSON record — { token, name } — written at login/register,
 * cleared at logout and at any 401 (the whoami validation). The `name`
 * half is the WHOAMI CACHE: the surface renders "signed in as <name>"
 * instantly at boot while the whoami call validates the token; a 401
 * clears the whole record honestly (never a fabricated session).
 */
export const PRINCIPAL_SESSION_STORAGE_KEY = 'tradrl_console_principal';

/** The storage seam the principal session persists through (localStorage in production — the same seam class as the posture record). */
export interface PrincipalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Guard: a well-formed principal token (the url-safe class the host mints; generous — the host's own grammar is the authority). */
export function isPrincipalToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,512}$/.test(value);
}

/** The stored principal session (the token + the whoami-cached name). */
export interface StoredPrincipalSession {
  readonly token: string;
  readonly name: string;
}

/** Parse one stored principal session (strict; anything malformed degrades to absent — never a half-trusted token). */
export function parseStoredPrincipalSession(value: string | null): StoredPrincipalSession | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { readonly token?: unknown; readonly name?: unknown };
  if (!isPrincipalToken(record.token)) return null;
  if (typeof record.name !== 'string' || record.name.length === 0 || record.name.length > 128) return null;
  return { token: record.token, name: record.name };
}

/** Serialize one stored principal session (the storage's own form). */
export function serializePrincipalSession(session: StoredPrincipalSession): string {
  return JSON.stringify({ token: session.token, name: session.name });
}

/** Read the stored principal session (best-effort; a storage that refuses reads degrades to absent). */
export function readStoredPrincipalSession(storage: PrincipalStorage): StoredPrincipalSession | null {
  try {
    return parseStoredPrincipalSession(storage.getItem(PRINCIPAL_SESSION_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Persist the principal session (best-effort; a storage that refuses writes degrades to the per-boot session — re-login each boot, disclosed in the copy). */
export function persistPrincipalSession(storage: PrincipalStorage, session: StoredPrincipalSession): void {
  try {
    storage.setItem(PRINCIPAL_SESSION_STORAGE_KEY, serializePrincipalSession(session));
  } catch {
    // private mode / quota: this boot's login still works, it just does not survive a restart
  }
}

/** Clear the stored principal session (logout, or a 401 validation — the honest "no session on record"). */
export function clearStoredPrincipalSession(storage: PrincipalStorage): void {
  try {
    storage.setItem(PRINCIPAL_SESSION_STORAGE_KEY, '');
  } catch {
    // best-effort — the in-memory session already ended
  }
}

// ---------------------------------------------------------------------------
// The whoami cache (in-memory, keyed by token)
// ---------------------------------------------------------------------------

/** One validated whoami answer (the principal's own name, as the host serves it). */
export interface WhoamiAnswer {
  readonly name: string;
}

/** The in-memory whoami cache (the design's own seam): token -> the last validated answer, so repeat surfaces never re-call the route. */
export interface WhoamiCache {
  read(token: string): WhoamiAnswer | null;
  write(token: string, answer: WhoamiAnswer): void;
  clear(): void;
}

/** Build an empty whoami cache (one per console boot). */
export function createWhoamiCache(): WhoamiCache {
  // The erasable-subset law (core/palette.ts's own precedent): constructor
  // type arguments (new Map<...>) are not in the published subset — the
  // annotation carries the typing instead.
  const entries: Map<string, WhoamiAnswer> = new Map();
  return {
    read: (token) => entries.get(token) ?? null,
    write: (token, answer) => { entries.set(token, answer); },
    clear: () => { entries.clear(); },
  };
}

// ---------------------------------------------------------------------------
// The auth client (the documented contract, defensively)
// ---------------------------------------------------------------------------

/** The credentials the register/login routes carry (passphrase-first — email/magic-link is Phase 2, the design §6). */
export interface PrincipalCredentials {
  readonly name: string;
  readonly passphrase: string;
}

/** One login/register answer: the minted token + the principal's own name. */
export interface PrincipalSessionMint {
  readonly token: string;
  readonly name: string;
}

/** One per-desk adoption outcome, exactly as the adopt route's per-desk response serves it. */
export interface AdoptionDeskOutcome {
  readonly projectId: string;
  readonly adopted: boolean;
  readonly already: boolean;
}

/** The auth client against the documented contract (the transport INJECTED; the principal token + the session header carried per the route's own law). */
export interface PrincipalAuthClient {
  register(credentials: PrincipalCredentials): Promise<PrincipalSessionMint>;
  login(credentials: PrincipalCredentials): Promise<PrincipalSessionMint>;
  logout(token: string): Promise<void>;
  whoami(token: string): Promise<WhoamiAnswer>;
  adopt(token: string): Promise<readonly AdoptionDeskOutcome[]>;
}

/** The client's construction seams (the transport adapter + the headers every auth call carries — the session header, so adopt's "calling session" is the truth). */
export interface PrincipalAuthClientConfig {
  readonly transport: ApiTransport;
  /** Extra headers on every auth call (the console session header — `x-tradrl-console-session`, the same seam the frozen routes ride). */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Read a principal-ish name out of an untrusted answer (the documented shape is { principal: { name } }; the plain-string form is accepted defensively — never fabricated, only passed through). */
function nameOfAnswer(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as { readonly principal?: unknown; readonly name?: unknown };
  if (typeof record.name === 'string' && record.name.length > 0 && record.name.length <= 128) return record.name;
  if (typeof record.principal === 'object' && record.principal !== null) {
    const principal = record.principal as { readonly name?: unknown };
    if (typeof principal.name === 'string' && principal.name.length > 0 && principal.name.length <= 128) return principal.name;
  }
  return null;
}

/** True when the error is the DEMO backing's typed not-available (the 503 unavailable family — the surface's teaching state). */
export function isAuthUnavailableError(error: unknown): boolean {
  return error instanceof ApiConsoleError && error.family === 'unavailable';
}

/** True when the error is the typed unauthenticated (a missing/unknown/revoked/expired token — the session is not on record). */
export function isAuthUnauthenticatedError(error: unknown): boolean {
  return error instanceof ApiConsoleError && error.family === 'auth';
}

/**
 * Build the auth client. Every route answers through the boundary's own
 * envelope discipline: a 2xx unwraps `data`; anything else translates
 * through the shared typed-error mirror (api/errors.ts — the same
 * envelope translation the frozen-route client rides, never
 * duplicated); a transport that throws degrades to the unavailable
 * family (the honest "cannot reach the auth plane", never a crash).
 */
export function createPrincipalAuthClient(config: PrincipalAuthClientConfig): PrincipalAuthClient {
  const transport = config.transport;
  const extraHeaders = config.headers ?? {};

  /** One envelope round-trip: unwrap the success data or throw the typed error. */
  async function roundTrip(method: 'GET' | 'POST', path: string, body?: unknown, token?: string): Promise<unknown> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    let response: SdkResponse;
    try {
      response = await transport({ method, path, headers, ...(body === undefined ? {} : { body }) });
    } catch (cause) {
      // The cast lives OUTSIDE the interpolation (the erasable-subset law).
      const causeError = cause as Error;
      throw new ApiConsoleError('unavailable', `the auth transport failed: ${causeError?.message ?? String(cause)}`, 503);
    }
    const envelope = response.body as { requestId?: string; data?: unknown; error?: Record<string, unknown> } | null;
    if (response.status >= 200 && response.status < 300) {
      if (envelope !== null && typeof envelope === 'object' && 'data' in envelope) return envelope.data;
      throw new ApiConsoleError('unavailable', `the auth route answered ${response.status} without a success envelope`, 503);
    }
    if (envelope !== null && typeof envelope === 'object' && 'error' in envelope && typeof envelope.error === 'object' && envelope.error !== null) {
      throw errorFromEnvelope(envelope.error as Parameters<typeof errorFromEnvelope>[0], envelope.requestId);
    }
    throw new ApiConsoleError('unavailable', `the auth route answered ${response.status} without an error envelope`, 503);
  }

  /** The mint of a register/login answer (the token is validated by shape — anything else is the typed unavailable, never a fabricated session). */
  function mintOf(data: unknown): PrincipalSessionMint {
    if (typeof data !== 'object' || data === null) throw new ApiConsoleError('unavailable', 'the auth route answered without a session mint', 503);
    const record = data as { readonly token?: unknown };
    if (!isPrincipalToken(record.token)) throw new ApiConsoleError('unavailable', 'the auth route answered without a well-formed token', 503);
    const name = nameOfAnswer(data);
    if (name === null) throw new ApiConsoleError('unavailable', 'the auth route answered without the principal\'s name', 503);
    return { token: record.token, name };
  }

  /** The per-desk adoption outcomes of an adopt answer (defensively shaped; an absent desks list is the typed unavailable, never a fabricated adoption). */
  function outcomesOf(data: unknown): readonly AdoptionDeskOutcome[] {
    if (typeof data !== 'object' || data === null || !Array.isArray((data as { readonly desks?: unknown }).desks)) {
      throw new ApiConsoleError('unavailable', 'the adopt route answered without its per-desk response', 503);
    }
    const desks = (data as { readonly desks: readonly unknown[] }).desks;
    const outcomes: AdoptionDeskOutcome[] = [];
    for (const entry of desks) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as { readonly projectId?: unknown; readonly adopted?: unknown; readonly already?: unknown };
      if (typeof record.projectId !== 'string' || record.projectId.length === 0) continue;
      outcomes.push({
        projectId: record.projectId,
        adopted: record.adopted === true || record.already === true,
        already: record.already === true,
      });
    }
    return outcomes;
  }

  return {
    async register(credentials) {
      return mintOf(await roundTrip('POST', '/v1/auth/register', { name: credentials.name, passphrase: credentials.passphrase }));
    },
    async login(credentials) {
      return mintOf(await roundTrip('POST', '/v1/auth/login', { name: credentials.name, passphrase: credentials.passphrase }));
    },
    async logout(token) {
      await roundTrip('POST', '/v1/auth/logout', undefined, token);
    },
    async whoami(token) {
      const name = nameOfAnswer(await roundTrip('GET', '/v1/auth/whoami', undefined, token));
      if (name === null) throw new ApiConsoleError('unavailable', 'the whoami route answered without the principal\'s name', 503);
      return { name };
    },
    async adopt(token) {
      return outcomesOf(await roundTrip('POST', '/v1/auth/adopt', {}, token));
    },
  };
}

// ---------------------------------------------------------------------------
// The account panel state (the pure folds the plane and the render ride)
// ---------------------------------------------------------------------------

/** The account surface's four faces. 'checking' = a stored token is being validated at boot; 'unavailable' = the deployment's typed not-available (the teaching state). */
export type AccountSurface = 'checking' | 'anonymous' | 'authenticated' | 'unavailable';

/** The account form's fields (passphrase-first: a name and a passphrase — the design's own Phase-1 shape). */
export type AccountFieldName = 'name' | 'passphrase';

/** One adoption-ceremony row: a session-own desk (never the shared demo desk — it is every session's teaching desk, not this one's property) with its own adopt state. */
export interface AdoptionDeskRow {
  readonly projectId: string;
  readonly name: string;
  readonly status: 'offered' | 'adopted' | 'failed';
  readonly detail: string | null;
}

/** The account panel's whole chrome state (rides the shell view; pure folds below — never a half-applied surface). */
export interface AccountPanelState {
  readonly surface: AccountSurface;
  readonly principalName: string | null;
  /** The host's own typed message when the surface is 'unavailable' (the teaching state quotes the truth, never invents one). */
  readonly unavailableMessage: string | null;
  readonly mode: 'login' | 'register';
  /** The form's buffered edits (the J3 beat-safe pattern: the render merges, the submit commits). */
  readonly edits: Readonly<Record<string, string>>;
  readonly error: string | null;
  readonly busy: boolean;
  /** The adoption ceremony's rows (null until the surface is authenticated with a directory on record). */
  readonly adoption: readonly AdoptionDeskRow[] | null;
}

/** The default panel: anonymous, login-mode, empty edits (a fresh browser — the demo flow's own shape, byte-for-byte). */
export function anonymousAccountPanel(): AccountPanelState {
  return { surface: 'anonymous', principalName: null, unavailableMessage: null, mode: 'login', edits: {}, error: null, busy: false, adoption: null };
}

/** The boot-validation panel: a stored token exists and is being validated (rendered plainly, never a wall). */
export function checkingAccountPanel(): AccountPanelState {
  return { ...anonymousAccountPanel(), surface: 'checking' };
}

/** The authenticated panel (a validated session — the principal's own name, the ceremony's rows to follow). */
export function authenticatedAccountPanel(name: string): AccountPanelState {
  return { ...anonymousAccountPanel(), surface: 'authenticated', principalName: name };
}

/** The teaching panel: the deployment's typed not-available, quoting the host's own message. */
export function unavailableAccountPanel(message: string): AccountPanelState {
  return { ...anonymousAccountPanel(), surface: 'unavailable', unavailableMessage: message };
}

/** Buffer one form edit (the J3 law: buffer only — the render merges it; never a render on the keystroke). */
export function accountFormEdited(panel: AccountPanelState, field: AccountFieldName, value: string): AccountPanelState {
  return { ...panel, edits: { ...panel.edits, [field]: value } };
}

/** Switch the form's mode (login <-> register; the buffered edits carry over — the same user typing). */
export function accountModeSwitched(panel: AccountPanelState, mode: 'login' | 'register'): AccountPanelState {
  if (panel.mode === mode) return panel;
  return { ...panel, mode, error: null };
}

/**
 * The adoption ceremony's rows: the session's OWN desks of the directory
 * (core/tenant.ts's own fold — 'session-owned', 'principal-owned' and
 * the honest unmarked fallback all read as own), EXCLUDING the shared
 * demo desk (every session's teaching desk — never this session's
 * property to adopt). Pure: identical directories derive identical
 * rows.
 */
export function adoptionRowsOf(directory: readonly ProjectRecord[], demoProjectId: string): readonly AdoptionDeskRow[] {
  const rows: AdoptionDeskRow[] = [];
  for (const project of sessionOwnDesksOf(directory, demoProjectId)) {
    if (isDemoProject(project.id) && project.id === demoProjectId) continue;
    rows.push({ projectId: project.id, name: project.name, status: 'offered', detail: null });
  }
  return rows;
}

/**
 * Fold the adopt route's PER-DESK response into the ceremony's rows
 * (idempotent by the route's own contract: an `already` outcome keeps
 * the adopted state and names it; a row the response does not name
 * keeps its prior state — the host's answer is the truth, never a
 * fabricated adoption). Pure: identical (rows, outcomes) pairs fold
 * identically.
 */
export function adoptionOutcomeApplied(rows: readonly AdoptionDeskRow[], outcomes: readonly AdoptionDeskOutcome[]): readonly AdoptionDeskRow[] {
  return rows.map((row) => {
    const outcome = outcomes.find((entry) => entry.projectId === row.projectId);
    if (outcome === undefined) return row;
    if (outcome.adopted) {
      return { ...row, status: 'adopted', detail: outcome.already ? 'already yours — adopted before this visit' : null };
    }
    return { ...row, status: 'failed', detail: 'the host refused this desk\'s adoption (its per-desk answer names the reason)' };
  });
}
