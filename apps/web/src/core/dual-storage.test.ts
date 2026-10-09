// FW-36-B (Round E register §3.2 — total restart recovery) — THE
// DUAL-HOME STORAGE SEAM'S OWN PINS. The root cause these pins carry:
// the personas' "full browser restart (profile intact)" is the eval
// harness's browser-session close/reopen — a path that DISCARDS the
// session's whole web-storage state while the host-level artifacts
// survive, which is why every filer measured reload SURVIVING and
// restart resetting all four posture arms at once (the minutes-old
// theme included — no write race can lose that; the STORE was
// discarded). The fix's client half: every posture-class write lands
// in BOTH homes (localStorage primary, a long-lived same-origin cookie
// secondary) and every read prefers the primary and falls back — a
// restart that keeps EITHER home restores every arm, the session-desks
// membership included (the re-adopted session id is the host's own
// ownership marker).

import { describe, expect, it } from 'vitest';
import { cookieStorageOf, dualStorage, type CookieWriter, type SeamStorage } from './dual-storage';
import { consoleSessionIdOf, CONSOLE_SESSION_HEADER, CONSOLE_SESSION_STORAGE_KEY } from './session';

/** A map-backed seam storage (the rigs' own shape). */
class MapStorage implements SeamStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/** A document-like cookie writer (the browser's document.cookie assignment semantics, jar-parsed). */
class CookieDocument implements CookieWriter {
  cookie = '';
  /** Every assignment the seam issued (the browser CONSUMES these — the jar reads back name=value only). */
  readonly assignments: string[] = [];
  setCookie(assignment: string): void {
    this.assignments.push(assignment);
    const separator = assignment.indexOf('=');
    const name = assignment.slice(0, separator);
    const value = assignment.slice(separator + 1, assignment.indexOf(';'));
    const next = `${name}=${value}`;
    const kept = this.cookie.split(';').map((part) => part.trim()).filter((part) => part.length > 0 && !part.startsWith(`${name}=`));
    this.cookie = [...kept, next].join('; ');
  }
}

describe('FW-36-B (Round E register §3.2): the dual-home storage seam', () => {
  it('the cookie home round-trips values through document.cookie (encoded — a value with spaces, quotes and semicolon-shaped content survives verbatim)', () => {
    const documentLike = new CookieDocument();
    const cookie = cookieStorageOf(documentLike);
    expect(cookie).not.toBeNull();
    (cookie as SeamStorage).setItem('tradrl_theme', 'dark');
    (cookie as SeamStorage).setItem('tradrl_console_posture', JSON.stringify({ onboarded: true, note: 'a; b "c" d' }));
    expect((cookie as SeamStorage).getItem('tradrl_theme')).toBe('dark');
    expect(JSON.parse((cookie as SeamStorage).getItem('tradrl_console_posture') ?? '{}')).toEqual({ onboarded: true, note: 'a; b "c" d' });
    // the write carries the long-lived shape (Max-Age + path + SameSite)
    // — the browser CONSUMES the assignment; the jar reads back
    // name=value only, so the pin reads the recorded assignment.
    expect(documentLike.assignments.some((assignment) => assignment === 'tradrl_theme=dark; Max-Age=315360000; Path=/; SameSite=Lax')).toBe(true);
    // an unknown key reads null; a document without the cookie seam yields NO home
    expect((cookie as SeamStorage).getItem('absent')).toBeNull();
    expect(cookieStorageOf({} as CookieWriter)).toBeNull();
  });

  it('a value too large for a cookie pair (~4KB) skips the secondary home — the primary keeps its write, the degrade is silent (the seam\'s own law)', () => {
    const documentLike = new CookieDocument();
    const cookie = cookieStorageOf(documentLike) as SeamStorage;
    const huge = 'x'.repeat(4000);
    cookie.setItem('tradrl_notice_read', huge);
    expect(cookie.getItem('tradrl_notice_read')).toBeNull(); // never written to the jar
    cookie.setItem('tradrl_notice_read', 'small'); // a later small value lands
    expect(cookie.getItem('tradrl_notice_read')).toBe('small');
  });

  it('THE DUAL HOME: writes land in BOTH; reads prefer the primary and fall back to the secondary when the primary answers nothing', () => {
    const primary = new MapStorage();
    const secondary = new MapStorage();
    const dual = dualStorage(primary, secondary);
    dual.setItem('tradrl_theme', 'dark');
    expect(primary.map.get('tradrl_theme')).toBe('dark');
    expect(secondary.map.get('tradrl_theme')).toBe('dark');
    // the primary's value wins when both homes carry one
    secondary.map.set('tradrl_theme', 'light');
    expect(dual.getItem('tradrl_theme')).toBe('dark');
    // the secondary answers when the primary carries nothing
    primary.map.delete('tradrl_theme');
    expect(dual.getItem('tradrl_theme')).toBe('light');
    expect(dual.getItem('absent')).toBeNull();
  });

  it('THE RESTART ARMS RESTORE FROM THE COOKIE when localStorage is discarded (the L4 class: reload survives, restart resets 4/4) — the posture, the theme, the notice read-marks AND the session id (the desks-membership key)', () => {
    // The FIRST session: localStorage present, everything writes to both homes.
    const localStorageOne = new MapStorage();
    const cookieDocument = new CookieDocument();
    const cookieHome = cookieStorageOf(cookieDocument) as SeamStorage;
    const browserOne = dualStorage(localStorageOne, cookieHome);
    const sessionIdOne = consoleSessionIdOf(browserOne);
    browserOne.setItem('tradrl_theme', 'dark');
    browserOne.setItem('tradrl_console_posture', JSON.stringify({ onboarded: true, scopeProjectId: 'prj-mine', timeMachine: { speed: '1x', freeSpeed: '', mode: 'live', viewAt: null }, claimedDesks: ['prj-mine'] }));
    browserOne.setItem('tradrl_notice_read', JSON.stringify({ 'tenant-a/prj-mine/ntc-1': 1 }));

    // THE RESTART: the harness's browser-session close/reopen DISCARDS
    // localStorage (the fresh context) — the cookie home survives.
    const localStorageTwo = new MapStorage();
    const browserTwo = dualStorage(localStorageTwo, cookieHome);
    expect(consoleSessionIdOf(browserTwo)).toBe(sessionIdOne); // the session id re-adopts — the host's own ownership marker recognizes this browser again (the desks-membership arm)
    expect(browserTwo.getItem('tradrl_theme')).toBe('dark'); // the theme arm
    expect(JSON.parse(browserTwo.getItem('tradrl_console_posture') ?? '{}')).toEqual(expect.objectContaining({ onboarded: true, scopeProjectId: 'prj-mine' })); // the wizard-dismissal + scope-pointer arms
    expect(JSON.parse(browserTwo.getItem('tradrl_notice_read') ?? '{}')).toEqual({ 'tenant-a/prj-mine/ntc-1': 1 }); // the read-state arm
    expect(CONSOLE_SESSION_HEADER).toBe('x-tradrl-console-session'); // the header the host's session gate reads
    expect(sessionIdOne).toMatch(/^[a-f0-9]{32}$/); // the minted 32-hex id, stable across the restart
    void CONSOLE_SESSION_STORAGE_KEY;
  });

  it('a restart that discards BOTH homes is the disclosed honest limit: nothing client-side re-identifies the browser (the recovery card\'s path)', () => {
    const localStorageOne = new MapStorage();
    const cookieDocumentOne = new CookieDocument();
    const browserOne = dualStorage(localStorageOne, cookieStorageOf(cookieDocumentOne) as SeamStorage);
    const sessionIdOne = consoleSessionIdOf(browserOne);
    // BOTH homes discarded (a wiped session context): a new browser identity
    const localStorageTwo = new MapStorage();
    const cookieDocumentTwo = new CookieDocument();
    const browserTwo = dualStorage(localStorageTwo, cookieStorageOf(cookieDocumentTwo) as SeamStorage);
    expect(consoleSessionIdOf(browserTwo)).not.toBe(sessionIdOne); // honestly a NEW identity — never posture theater
    expect(browserTwo.getItem('tradrl_theme')).toBeNull();
  });
});
