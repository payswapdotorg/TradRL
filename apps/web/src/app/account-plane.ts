// @tradrl/web-console — THE ACCOUNT PLANE (FW-39-2, identity Wave 2 —
// the app-layer interaction half of core/principal.ts, extracted per
// the payload-budget law the oversight plane established: console.ts
// rides a 160 KiB single-file line, so the account surface's whole
// cadence lives HERE with INJECTED seams and console.ts adds only the
// thinnest wiring).
//
// WHAT THIS PLANE OWNS (the app/oversight-plane.ts pattern — no
// closure state beyond its own panel):
//   - THE BOOT VALIDATION: a stored principal session (the whoami
//     cache's persisted half) is validated once at boot through
//     GET /v1/auth/whoami — a 200 renders authenticated, a 401 clears
//     the stored session honestly (never a fabricated login), and the
//     DEMO backing's typed not-available (503) renders the TEACHING
//     state. A browser with NO stored session stays anonymous with
//     ZERO auth calls (the demo flow is untouched, byte-for-byte).
//   - THE REGISTER/LOGIN SUBMIT (passphrase-first): the host's typed
//     answers surface inline in the form's own card (a 404 is the
//     unknown-vs-foreign answer; a 503 flips the surface to the
//     teaching state) — never a toast for an error the user must read
//     to fix, never a silent wall.
//   - THE ADOPTION CEREMONY: POST /v1/auth/adopt (parameterless per
//     the contract — the calling session's own desks, never a widening
//     parameter), the PER-DESK response folding into the ceremony's
//     rows (idempotent — an `already` outcome keeps the adopted state
//     and names it), a toast per desk, and a directory re-read (the
//     re-attach: the listing may now serve the principal's desks with
//     their 'principal-owned' markers, which the wall census reads as
//     own — core/tenant.ts's marker law).
//   - LOGOUT: the host's logout invalidates the token; the local
//     session clears on every completion (a typed failure still clears
//     — a stale login is worse than an honest sign-out).
//
// Spec anchors: R46 (the typed degraded state — an account must never
// silently cold-start reset), L20, the design §5 Wave 2's honesty
// laws (no silent walls; the unavailability teaches loudly).

import type { ProjectRecord } from '../api/contracts';
import type { ApiTransport } from '../api/transport';
import {
  accountFormEdited,
  accountModeSwitched,
  adoptionOutcomeApplied,
  adoptionRowsOf,
  anonymousAccountPanel,
  authenticatedAccountPanel,
  createPrincipalAuthClient,
  createWhoamiCache,
  type AccountFieldName,
  type AccountPanelState,
  clearStoredPrincipalSession,
  isAuthUnauthenticatedError,
  isAuthUnavailableError,
  persistPrincipalSession,
  readStoredPrincipalSession,
  unavailableAccountPanel,
  type PrincipalHeaderState,
  type WhoamiCache,
} from '../core/principal';
import type { PrincipalAuthClient, PrincipalStorage } from '../core/principal';

/** One toast the plane surfaces (the shell view's own shape — kind/title/sentence). */
export interface AccountToast {
  readonly kind: string;
  readonly title: string;
  readonly sentence: string;
}

/** The injected seams the plane rides (the export-flow.ts pattern — no closure state of its own beyond the panel). */
export interface AccountPlaneSeams {
  /** The transport adapter the auth client rides (the SAME transport the frozen-route client rides — injected once by the app layer). */
  readonly transport: ApiTransport;
  /** Extra headers every auth call carries (the console session header — adopt's "calling session" law; the same headers the frozen-route client carries). */
  readonly headers?: Readonly<Record<string, string>>;
  /** The auth client against the documented contract (REQUIRED on the plane's own seams — createAccountPlane builds it over the transport + headers when the caller injects none). */
  readonly auth: PrincipalAuthClient;
  /** The principal session's storage seam (localStorage in production; null = this boot persists nothing — the per-boot degradation, disclosed in the copy). */
  readonly storage: PrincipalStorage | null;
  /**
   * THE LIVE PRINCIPAL-TOKEN STATE (FW-39-3, optional): the plane writes it
   * at every session transition (mint / boot-validation success / logout +
   * the honest clears) so the console's own consequential writes carry the
   * acting principal's token — the audit stamp's client half. Absent = the
   * plane never touches the transport's headers (the pre-FW-39-3 shape).
   */
  readonly principalHeaders?: PrincipalHeaderState;
  /** The shared demo project's id (the teaching desk — never adoptable, never this session's property). */
  readonly demoProjectId: string;
  /** The tenant's project directory as currently on record (the ceremony's rows + the re-attach re-read derive from it). */
  readonly directory: () => readonly ProjectRecord[];
  /** The panel as currently rendered (null = the anonymous default). */
  readonly getPanel: () => AccountPanelState | null;
  /** Write the panel (the render's carrier — the shell view's account field). */
  readonly setPanel: (panel: AccountPanelState) => void;
  /** Re-render now (the plane owns its own render calls — never a half-painted surface). */
  readonly render: () => void;
  /** Surface one toast (the shell's own toast mechanism — kind/title/sentence, auto-dismissed by the app). */
  readonly showToast: (toast: AccountToast) => void;
  /** The full read cadence (the re-attach: a login/adopt re-lists the directory through the console's own refresh). */
  readonly refresh: () => Promise<void>;
}

/** The minimal delegated-action surface the plane reads (app/console.ts's vocabulary). */
export interface AccountActionElement {
  getAttribute(name: string): string | null;
}

/** The minimal field-target surface the plane reads (the J3 edit buffer's own shape). */
export interface AccountFieldTarget {
  getAttribute(name: string): string | null;
  readonly value?: string;
}

/** Read the account-field edit of an event target (null when the target is not one of the account form's inputs). */
export function accountFieldOf(target: unknown): { readonly field: AccountFieldName; readonly value: string } | null {
  const element = target as AccountFieldTarget | null;
  if (element === null || element === undefined || typeof element.getAttribute !== 'function') return null;
  const name = element.getAttribute('data-account-field');
  if (name !== 'name' && name !== 'passphrase') return null;
  return { field: name, value: typeof element.value === 'string' ? element.value : '' };
}

/** The panel as currently rendered (the seams' fold — the anonymous default when the view carries none). */
function panelOf(seams: AccountPlaneSeams): AccountPanelState {
  return seams.getPanel() ?? { surface: 'anonymous', principalName: null, unavailableMessage: null, mode: 'login', edits: {}, error: null, busy: false, adoption: null };
}

/** Write + render one panel (the plane's one write path). */
function put(seams: AccountPlaneSeams, panel: AccountPanelState): void {
  seams.setPanel(panel);
  seams.render();
}

/**
 * THE BOOT VALIDATION — the whoami cache's own read path. A stored
 * session exists: paint 'checking' synchronously, validate through
 * GET /v1/auth/whoami, and land the honest answer. No stored session:
 * nothing happens at all (zero auth calls — the anonymous demo flow
 * is untouched, the no-change pin's own law).
 */
export async function readAccountBoot(seams: AccountPlaneSeams, cache: WhoamiCache): Promise<void> {
  const stored = seams.storage === null ? null : readStoredPrincipalSession(seams.storage);
  if (stored === null) return;
  put(seams, { ...panelOf(seams), surface: 'checking', error: null });
  try {
    const answer = await seams.auth.whoami(stored.token);
    cache.write(stored.token, answer);
    seams.principalHeaders?.setToken(stored.token); // FW-39-3: the validated token goes live for the console's own writes
    put(seams, { ...authenticatedAccountPanel(answer.name), edits: panelOf(seams).edits, adoption: adoptionRowsOf(seams.directory(), seams.demoProjectId) });
    void seams.refresh(); // the re-attach: the listing re-reads for the signed-in session
  } catch (error) {
    if (isAuthUnavailableError(error)) {
      put(seams, unavailableAccountPanel((error as Error).message));
      return;
    }
    // 401 (the token is not on record), 404 (unknown-vs-foreign), or an
    // unexpected typed answer: the session is not usable — clear it
    // honestly and surface the host's own message inline.
    if (seams.storage !== null) clearStoredPrincipalSession(seams.storage);
    seams.principalHeaders?.setToken(null); // FW-39-3: the dead token leaves the transport headers
    cache.clear();
    const panel = panelOf(seams);
    put(seams, { ...panel, surface: panel.surface === 'checking' ? 'anonymous' : panel.surface, error: (error as Error)?.message ?? String(error) });
  }
}

/** Persist one minted session (the whoami cache's write-through; a null storage degrades to the per-boot session). */
function persistSession(seams: AccountPlaneSeams, mint: { readonly token: string; readonly name: string }): void {
  if (seams.storage === null) return;
  persistPrincipalSession(seams.storage, { token: mint.token, name: mint.name });
}

/**
 * THE ONE REGISTER/LOGIN SUBMIT (passphrase-first): local validation
 * first (an empty field is an inline error, never a dead API call),
 * then the documented route. The host's typed answers surface inline;
 * the DEMO backing's 503 flips the whole surface to the teaching
 * state. Success persists the session (the whoami cache's own form),
 * renders the ceremony, toasts, and re-reads the directory.
 */
async function submitCredentials(seams: AccountPlaneSeams, cache: WhoamiCache, register: boolean): Promise<void> {
  const before = panelOf(seams);
  const name = (before.edits.name ?? '').trim();
  const passphrase = before.edits.passphrase ?? '';
  if (name.length === 0 || passphrase.length === 0) {
    put(seams, { ...before, error: 'Both fields are required — an account name and a passphrase.' });
    return;
  }
  put(seams, { ...before, busy: true, error: null });
  try {
    const mint = register
      ? await seams.auth.register({ name, passphrase })
      : await seams.auth.login({ name, passphrase });
    persistSession(seams, mint);
    cache.write(mint.token, { name: mint.name });
    seams.principalHeaders?.setToken(mint.token); // FW-39-3: the minted token goes live for the console's own writes
    put(seams, {
      ...authenticatedAccountPanel(mint.name),
      edits: before.edits,
      adoption: adoptionRowsOf(seams.directory(), seams.demoProjectId),
    });
    seams.showToast({ kind: 'account', title: register ? 'Account created' : 'Signed in', sentence: register ? `Welcome, ${mint.name} — desks you adopt follow this account across restarts.` : `Welcome back, ${mint.name} — this session's desks can now be adopted.` });
    void seams.refresh(); // the re-attach: the listing re-reads for the signed-in session
  } catch (error) {
    if (isAuthUnavailableError(error)) {
      put(seams, unavailableAccountPanel((error as Error).message));
      return;
    }
    put(seams, { ...panelOf(seams), busy: false, error: (error as Error)?.message ?? String(error) });
  }
}

/**
 * THE LOGOUT: the host invalidates the token, then the local session
 * clears on EVERY completion (a typed failure still clears — a stale
 * login is worse than an honest sign-out — and surfaces its message).
 */
async function signOut(seams: AccountPlaneSeams, cache: WhoamiCache): Promise<void> {
  const before = panelOf(seams);
  const token = seams.storage === null ? null : readStoredPrincipalSession(seams.storage)?.token ?? null;
  put(seams, { ...before, busy: true });
  let message: string | null = null;
  if (token !== null) {
    try {
      await seams.auth.logout(token);
    } catch (error) {
      message = (error as Error)?.message ?? String(error);
    }
  }
  if (seams.storage !== null) clearStoredPrincipalSession(seams.storage);
  seams.principalHeaders?.setToken(null); // FW-39-3: the ended session leaves the transport headers
  cache.clear();
  put(seams, { ...anonymousAccountPanel(), edits: before.edits, ...(message === null ? {} : { error: message }) });
  seams.showToast({ kind: 'account', title: 'Signed out', sentence: 'This session is anonymous again — its desks stay reachable on this device.' });
  void seams.refresh();
}

/**
 * THE ADOPTION CEREMONY'S ONE CALL (parameterless per the contract —
 * the calling session's own desks): the per-desk response folds into
 * the rows, the clicked desk's outcome toasts, and the directory
 * re-reads (the re-attach — the listing may now carry the principal's
 * desks with their 'principal-owned' markers).
 */
async function adoptDesks(seams: AccountPlaneSeams, clickedDeskId: string): Promise<void> {
  const before = panelOf(seams);
  if (before.surface !== 'authenticated') return;
  const rows = before.adoption ?? [];
  const token = seams.storage === null ? null : readStoredPrincipalSession(seams.storage)?.token ?? null;
  if (token === null) {
    put(seams, { ...before, surface: 'anonymous', principalName: null, adoption: null, error: 'The saved session is gone — sign in again to adopt desks.' });
    return;
  }
  put(seams, { ...before, busy: true, error: null });
  try {
    const outcomes = await seams.auth.adopt(token);
    const folded = adoptionOutcomeApplied(rows, outcomes);
    put(seams, { ...before, busy: false, adoption: folded });
    const clicked = outcomes.find((outcome) => outcome.projectId === clickedDeskId);
    const clickedRow = folded.find((row) => row.projectId === clickedDeskId);
    if (clicked !== undefined && clicked.adopted) {
      seams.showToast({
        kind: 'account',
        title: clicked.already ? 'Already yours' : 'Desk adopted',
        sentence: clicked.already
          ? `${clickedDeskId} was already following this account.`
          : `${clickedDeskId} now follows your account — it survives restarts.`,
      });
    } else if (clickedRow !== undefined && clickedRow.status === 'failed') {
      put(seams, { ...panelOf(seams), error: `The host refused ${clickedDeskId}'s adoption — its per-desk answer is the row's own state.` });
    }
    void seams.refresh(); // the re-attach: the listing re-reads for the adopted desks
  } catch (error) {
    if (isAuthUnavailableError(error)) {
      put(seams, unavailableAccountPanel((error as Error).message));
      return;
    }
    if (isAuthUnauthenticatedError(error)) {
      if (seams.storage !== null) clearStoredPrincipalSession(seams.storage);
      seams.principalHeaders?.setToken(null); // FW-39-3: the refused token leaves the transport headers
      put(seams, { ...anonymousAccountPanel(), edits: before.edits, error: (error as Error)?.message ?? String(error) });
      return;
    }
    put(seams, { ...panelOf(seams), busy: false, error: (error as Error)?.message ?? String(error) });
  }
}

/**
 * THE DELEGATED ACCOUNT BRANCHES (app/console.ts's one resolver calls
 * this for every data-action="account-*" press): returns true when the
 * kind is the plane's (the caller returns; false falls through to the
 * shell's own branches, never a swallowed press).
 */
export function accountInteractionAt(seams: AccountPlaneSeams, cache: WhoamiCache, kind: string, action: AccountActionElement): boolean {
  if (!kind.startsWith('account-')) return false;
  if (kind === 'account-mode-login' || kind === 'account-mode-register') {
    const next = accountModeSwitched(panelOf(seams), kind === 'account-mode-register' ? 'register' : 'login');
    put(seams, next);
    return true;
  }
  if (kind === 'account-submit') {
    void submitCredentials(seams, cache, panelOf(seams).mode === 'register');
    return true;
  }
  if (kind === 'account-logout') {
    void signOut(seams, cache);
    return true;
  }
  if (kind === 'account-adopt') {
    const deskId = action.getAttribute('data-desk');
    if (deskId !== null) void adoptDesks(seams, deskId);
    return true;
  }
  return false;
}

/** The plane's whole construction: the seams + the whoami cache (one per console boot). */
export interface AccountPlane {
  /** The boot validation (call once at mount; a no-op without a stored session). */
  readBoot(): Promise<void>;
  /** The delegated-action branch (returns true when handled — app/console.ts's hook). */
  interact(kind: string, action: AccountActionElement): boolean;
  /** The J3 edit buffer (buffer only, never a render — the render merges the buffered edits). */
  edit(target: unknown): boolean;
}

/** The plane's construction input: the seams with the auth client OPTIONAL (built internally over the injected transport + headers when absent — the app layer's one-line wiring). */
export type AccountPlaneInput = Omit<AccountPlaneSeams, 'auth'> & { readonly auth?: PrincipalAuthClient };

/** Build the account plane over the injected seams (the whoami cache + the auth client are the plane's own). */
export function createAccountPlane(input: AccountPlaneInput): AccountPlane {
  const auth = input.auth ?? createPrincipalAuthClient({ transport: input.transport, ...(input.headers === undefined ? {} : { headers: input.headers }) });
  const plane: AccountPlaneSeams = { ...input, auth };
  const cache: WhoamiCache = createWhoamiCache();
  return {
    readBoot: () => readAccountBoot(plane, cache),
    interact: (kind, action) => accountInteractionAt(plane, cache, kind, action),
    edit: (target) => {
      const entry = accountFieldOf(target);
      if (entry === null) return false;
      const panel = panelOf(plane);
      if (panel.surface !== 'anonymous') return false; // the form renders only in the anonymous surface
      input.setPanel(accountFormEdited(panel, entry.field, entry.value));
      return true; // buffered — NO render (the J3 law: the buffer IS the live form)
    },
  };
}
