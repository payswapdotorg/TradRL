// @tradrl/web-console — the console session (FW-MI-A, defects MI-D1 + MI-D8).
//
// THE LAW (the wave-1 evidence, 9/9 professionals): the deployed console
// is anonymous by design — one shared credential baked into the public
// shell, one shared tenant — so before this module every browser session
// on the origin saw EVERY session's launched projects (the switcher, the
// palette, the export's projectDirectory; Northline's M1 saw "a rival
// fund's desks" in his switcher; Alder's S5 REJECTED over her audit
// export embedding 24 projects; Meridian's L3 switched into a colleague's
// desk by id). The fix's client half: every browser session carries a
// STABLE SESSION ID — generated on first load, held in localStorage,
// sent as the `x-tradrl-console-session` header on the console's API
// calls — and the host (deploy/vercel/runtime/session-routes.ts) filters
// every project-listing/detail surface by it, stamping launched projects
// with the owning session server-side. The session id is a CORRELATION
// device, not a credential: it is public-shape data (localStorage, same
// trust zone as `tradrl_theme` / `tradrl_onboarded` / `tradrl_scope_project`
// — spec/SECURITY.md's browser trust zone; no credential, no record
// content ever lives here), and the honest limitation stands: without
// authentication, session isolation is a shared-origin courtesy boundary,
// not an adversarial one (a caller that forges another session's header
// defeats it — the durable fix is per-tenant credentials, disclosed in
// the PR).
//
// This module is PURE + storage-seamed: the id is read-or-generated
// against an INJECTED storage (localStorage in production; tests inject
// maps), and the generator is INJECTED (crypto.getRandomValues in the
// browser; tests inject determinism). No DOM, no clock.

/** The session header's name (the host mirror: deploy/vercel/runtime/session-routes.ts — same name, same shape law). */
export const CONSOLE_SESSION_HEADER = 'x-tradrl-console-session';

/** The localStorage key the session id persists under (the browser trust zone — plain UI state, never a credential). */
export const CONSOLE_SESSION_STORAGE_KEY = 'tradrl_console_session';

/** Guard: a well-formed session id (the host accepts the url-safe class, 8-64 chars; the console mints 32-hex). */
export function isConsoleSessionId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

/** The injected random-byte source (crypto.getRandomValues in the browser; tests inject determinism) — receives the byte COUNT, returns the filled buffer. */
export type SessionRandom = (count: number) => Uint8Array;

/** The browser's random-byte binding (resolved lazily so tests never touch the platform). */
function defaultRandom(): SessionRandom {
  // The erasable-subset law: no inline arrow function types inside a
  // cast region — the structural binding uses METHOD signature syntax.
  const crypto = (globalThis as { readonly crypto?: { getRandomValues?(bytes: Uint8Array): Uint8Array } }).crypto;
  const source = crypto?.getRandomValues;
  if (crypto !== undefined && source !== undefined) {
    // INVOKED THROUGH .call WITH THE BINDING'S OWN OBJECT (`this` must be
    // the Crypto instance on some platforms — Node's webcrypto enforces
    // it; an unbound extraction throws "Value of this must be of type
    // Crypto").
    return (count) => source.call(crypto, new Uint8Array(count));
  }
  return (count) => {
    const bytes = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    return bytes;
  };
}

/** Mint one fresh session id (16 random bytes, 32 lowercase hex — the url-safe class the host's guard accepts). */
export function generateConsoleSessionId(random: SessionRandom = defaultRandom()): string {
  const bytes = random(16);
  let id = '';
  for (let index = 0; index < bytes.length; index += 1) {
    id += (bytes[index] ?? 0).toString(16).padStart(2, '0');
  }
  return id;
}

/** The storage seam the session id persists through (localStorage in production). */
export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The console session id, read-or-generated against the storage seam: a
 * stored WELL-FORMED id returns as-is (the stable identity across
 * reloads — the session's own desks restore with it); anything else
 * (nothing stored yet, a malformed value, a foreign format) mints a
 * fresh id and persists it best-effort (a storage that throws — private
 * mode, quota — degrades to the ephemeral id: this boot is still a
 * coherent session, honestly isolated within itself).
 */
export function consoleSessionIdOf(storage: SessionStorage, random: SessionRandom = defaultRandom()): string {
  try {
    const stored = storage.getItem(CONSOLE_SESSION_STORAGE_KEY);
    if (isConsoleSessionId(stored)) return stored;
  } catch {
    // a storage that refuses reads (private mode) — fall through to the ephemeral mint
  }
  const minted = generateConsoleSessionId(random);
  try {
    storage.setItem(CONSOLE_SESSION_STORAGE_KEY, minted);
  } catch {
    // a storage that refuses writes: the ephemeral id still identifies THIS boot's session
  }
  return minted;
}

/** The session header record the client carries on every request (the boot wiring's convenience — one entry, the header name to the session id). */
export function consoleSessionHeaders(sessionId: string): Readonly<Record<string, string>> {
  return { [CONSOLE_SESSION_HEADER]: sessionId };
}
