// Tests for THE ACCOUNT PLANE (FW-39-2, identity Wave 2 —
// app/account-plane.ts): the boot validation (the whoami cache's read
// path), the register/login submit, logout, and the adoption ceremony —
// driven end-to-end over a scripted transport + an injected storage
// map, with the seams recording every render/toast/refresh.
//
// Laws pinned here:
//   - the anonymous boot makes ZERO auth calls (the demo flow is
//     untouched — the no-change pin's behavioral half);
//   - a stored session boot paints 'checking', validates via whoami,
//     lands authenticated (the cached name confirmed) and re-reads the
//     directory (the re-attach);
//   - a 401 boot clears the stored session honestly (anonymous, the
//     host's message surfaced — never a fabricated login);
//   - a 503 boot lands the TEACHING state (the demo backing's typed
//     not-available), keeping the stored session (the unavailability is
//     the deployment's state, not the session's falsity);
//   - login persists the mint, renders the adoption ceremony (the
//     session's own desks minus the demo desk) and toasts;
//   - the empty-field submit is the inline error (never a dead API
//     call);
//   - the per-desk adopt call is PARAMETERLESS (the contract's own law)
//     and its per-desk response folds into the rows with a toast;
//   - logout clears the local session on every completion (a typed
//     failure still signs out — a stale login is worse).

import { describe, expect, it } from 'vitest';
import type { ApiTransport, SdkRequest, SdkResponse } from '../api/transport';
import type { ProjectRecord } from '../api/contracts';
import { PRINCIPAL_SESSION_STORAGE_KEY, type AccountPanelState } from '../core/principal';
import { accountFieldOf, createAccountPlane, type AccountPlaneInput, type AccountToast } from './account-plane';

const T0 = 1_700_000_000_000;

function ok(data: unknown): SdkResponse {
  return { status: 200, headers: {}, body: { requestId: 'req-test', data } };
}

function envelopeError(status: number, code: string, message: string): SdkResponse {
  return { status, headers: {}, body: { requestId: 'req-test', error: { code, message, status } } };
}

const MINT = { token: 'tok-principal-0123456789abcdef', principal: { id: 'prn-1', name: 'desk.owner' } };
const STORED = JSON.stringify({ token: 'tok-principal-0123456789abcdef', name: 'desk.owner' });

function directoryRow(id: string, marker: 'session-owned' | 'principal-owned' | 'tenant-available'): ProjectRecord {
  return {
    id,
    tenantId: 'tenant-a',
    name: `desk ${id}`,
    executionMode: 'simulation',
    lifecycle: { projectId: id, status: 'active', acceptanceCriteriaId: null, organizationRef: null },
    lineage: { projectId: id, goal: { goalId: 'goal-1', version: 1 }, constraintSet: { id: 'cs-1', version: 1 } },
    createdAt: T0,
    updatedAt: T0,
    consoleSessionScope: marker,
  } as unknown as ProjectRecord;
}

const DIRECTORY: readonly ProjectRecord[] = [
  directoryRow('prj-demo-console', 'tenant-available'),
  directoryRow('prj-own-1', 'session-owned'),
];

/** One harness: the scripted transport + the injected seams, recording everything. */
function harness(responses: SdkResponse[], storedValue: string | null = null) {
  const requests: SdkRequest[] = [];
  let cursor = 0;
  const transport: ApiTransport = async (request) => {
    requests.push(request);
    const response = responses[cursor];
    cursor += 1;
    if (response === undefined) throw new Error('scripted transport exhausted');
    return response;
  };
  const map = new Map<string, string>(storedValue === null ? [] : [[PRINCIPAL_SESSION_STORAGE_KEY, storedValue]]);
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
  let panel: AccountPanelState | null = null;
  const renders: number[] = [];
  const toasts: AccountToast[] = [];
  let refreshes = 0;
  const seams: AccountPlaneInput = {
    transport,
    headers: { 'x-tradrl-console-session': 'session-0123456789abcdef' },
    storage,
    demoProjectId: 'prj-demo-console',
    directory: () => DIRECTORY,
    getPanel: () => panel,
    setPanel: (next) => { panel = next; },
    render: () => { renders.push(1); },
    showToast: (toast) => { toasts.push(toast); },
    refresh: async () => { refreshes += 1; },
  };
  return {
    plane: createAccountPlane(seams),
    seams,
    requests,
    storage,
    panel: () => panel,
    renders,
    toasts,
    refreshes: () => refreshes,
  };
}

describe('the boot validation (readBoot)', () => {
  it('a browser with NO stored session stays anonymous with ZERO auth calls (the demo flow untouched)', async () => {
    const h = harness([]);
    await h.plane.readBoot();
    expect(h.requests).toEqual([]); // zero auth calls — the honest no-op
    expect(h.panel()).toBeNull(); // the view keeps its anonymous default (no panel ever written)
  });

  it('a stored session paints checking, validates via whoami, lands authenticated + re-reads the directory', async () => {
    const h = harness([ok({ principal: { id: 'prn-1', name: 'desk.owner' } })], STORED);
    const pending = h.plane.readBoot();
    expect(h.panel()?.surface).toBe('checking'); // painted synchronously before the answer
    await pending;
    expect(h.requests[0]?.path).toBe('/v1/auth/whoami');
    expect(h.requests[0]?.headers.authorization).toBe('Bearer tok-principal-0123456789abcdef');
    expect(h.panel()?.surface).toBe('authenticated');
    expect(h.panel()?.principalName).toBe('desk.owner');
    expect(h.panel()?.adoption?.map((row) => row.projectId)).toEqual(['prj-own-1']); // the ceremony's rows (demo excluded)
    expect(h.refreshes()).toBe(1); // the re-attach: the directory re-reads
  });

  it('a 401 boot clears the stored session honestly — anonymous, the message surfaced, never a fabricated login', async () => {
    const h = harness([envelopeError(401, 'unauthenticated', 'the principal token is not on record')], STORED);
    await h.plane.readBoot();
    expect(h.panel()?.surface).toBe('anonymous');
    expect(h.panel()?.error).toBe('the principal token is not on record');
    expect(h.storage.getItem(PRINCIPAL_SESSION_STORAGE_KEY)).toBe(''); // cleared
    expect(h.refreshes()).toBe(0);
  });

  it('a 503 boot lands the TEACHING state (the demo backing\'s typed not-available), keeping the stored session', async () => {
    const h = harness([envelopeError(503, 'unavailable', 'accounts are not available on this deployment (R46)')], STORED);
    await h.plane.readBoot();
    expect(h.panel()?.surface).toBe('unavailable');
    expect(h.panel()?.unavailableMessage).toContain('not available on this deployment');
    expect(h.storage.getItem(PRINCIPAL_SESSION_STORAGE_KEY)).toBe(STORED); // kept — the unavailability is not the session's falsity
  });
});

describe('the register/login submit', () => {
  it('login persists the mint, renders the ceremony, toasts, and re-reads the directory', async () => {
    const h = harness([ok(MINT)]);
    h.plane.interact('account-mode-login', { getAttribute: () => 'account-mode-login' });
    expect(h.panel()?.mode).toBe('login');
    // the J3 edit buffer: the fields buffer without a render
    expect(h.plane.edit({ getAttribute: (name: string) => (name === 'data-account-field' ? 'name' : null), value: 'desk.owner' })).toBe(true);
    expect(h.plane.edit({ getAttribute: (name: string) => (name === 'data-account-field' ? 'passphrase' : null), value: 'correct horse battery staple' })).toBe(true);
    expect(h.renders.length).toBe(1); // only the mode switch rendered — the edits buffer silently
    h.plane.interact('account-submit', { getAttribute: () => 'account-submit' });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); }); // let the async submit settle
    expect(h.requests[0]?.path).toBe('/v1/auth/login');
    expect(h.requests[0]?.body).toEqual({ name: 'desk.owner', passphrase: 'correct horse battery staple' });
    expect(h.panel()?.surface).toBe('authenticated');
    expect(h.panel()?.principalName).toBe('desk.owner');
    expect(h.panel()?.adoption?.map((row) => row.projectId)).toEqual(['prj-own-1']);
    expect(h.toasts[0]?.title).toBe('Signed in');
    expect(h.storage.getItem(PRINCIPAL_SESSION_STORAGE_KEY)).toBe(JSON.stringify({ token: MINT.token, name: 'desk.owner' }));
    expect(h.refreshes()).toBe(1);
  });

  it('register rides the register route when the mode is register', async () => {
    const h = harness([ok(MINT)]);
    h.plane.interact('account-mode-register', { getAttribute: () => 'account-mode-register' });
    h.plane.edit({ getAttribute: (name: string) => (name === 'data-account-field' ? 'name' : null), value: 'desk.owner' });
    h.plane.edit({ getAttribute: (name: string) => (name === 'data-account-field' ? 'passphrase' : null), value: 'correct horse battery staple' });
    h.plane.interact('account-submit', { getAttribute: () => 'account-submit' });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(h.requests[0]?.path).toBe('/v1/auth/register');
    expect(h.toasts[0]?.title).toBe('Account created');
  });

  it('an empty field is the inline error — never a dead API call', async () => {
    const h = harness([]);
    h.plane.interact('account-submit', { getAttribute: () => 'account-submit' });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(h.requests).toEqual([]);
    expect(h.panel()?.error).toContain('Both fields are required');
  });

  it('a 503 submit flips the whole surface to the teaching state; a typed 404 surfaces inline', async () => {
    const unavailable = harness([envelopeError(503, 'unavailable', 'accounts are not available on this deployment (R46)')]);
    unavailable.plane.edit({ getAttribute: (name: string) => (name === 'data-account-field' ? 'name' : null), value: 'desk.owner' });
    unavailable.plane.edit({ getAttribute: (name: string) => (name === 'data-account-field' ? 'passphrase' : null), value: 'correct horse battery staple' });
    unavailable.plane.interact('account-submit', { getAttribute: () => 'account-submit' });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(unavailable.panel()?.surface).toBe('unavailable');
    expect(unavailable.panel()?.unavailableMessage).toContain('not available on this deployment');

    const unknown = harness([envelopeError(404, 'not_found', 'no such principal')]);
    unknown.plane.edit({ getAttribute: (name: string) => (name === 'data-account-field' ? 'name' : null), value: 'nobody' });
    unknown.plane.edit({ getAttribute: (name: string) => (name === 'data-account-field' ? 'passphrase' : null), value: 'correct horse battery staple' });
    unknown.plane.interact('account-submit', { getAttribute: () => 'account-submit' });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(unknown.panel()?.surface).toBe('anonymous');
    expect(unknown.panel()?.error).toBe('no such principal'); // unknown-vs-foreign indistinguishable — the host's own words
    expect(unknown.panel()?.busy).toBe(false);
  });
});

describe('the adoption ceremony + logout', () => {
  /** Sign in through the harness first (one mint answer). */
  async function signedIn(h: ReturnType<typeof harness>): Promise<void> {
    h.plane.edit({ getAttribute: (name: string) => (name === 'data-account-field' ? 'name' : null), value: 'desk.owner' });
    h.plane.edit({ getAttribute: (name: string) => (name === 'data-account-field' ? 'passphrase' : null), value: 'correct horse battery staple' });
    h.plane.interact('account-submit', { getAttribute: () => 'account-submit' });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  }

  it('the adopt press drives the PARAMETERLESS route; the per-desk response folds + toasts + re-reads', async () => {
    const h = harness([ok(MINT), ok({ desks: [{ projectId: 'prj-own-1', adopted: true }] })]);
    await signedIn(h);
    const handled = h.plane.interact('account-adopt', { getAttribute: (name: string) => (name === 'data-desk' ? 'prj-own-1' : 'account-adopt') });
    expect(handled).toBe(true);
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(h.requests[1]?.path).toBe('/v1/auth/adopt');
    expect(h.requests[1]?.body).toEqual({}); // parameterless per the contract — no widening parameter
    expect(h.requests[1]?.headers.authorization).toBe('Bearer tok-principal-0123456789abcdef');
    expect(h.requests[1]?.headers['x-tradrl-console-session']).toBe('session-0123456789abcdef');
    expect(h.panel()?.adoption?.[0]).toMatchObject({ projectId: 'prj-own-1', status: 'adopted' });
    expect(h.toasts[1]?.title).toBe('Desk adopted');
    expect(h.refreshes()).toBe(2); // login's re-read + adoption's re-read
  });

  it('an idempotent replay toasts "Already yours" and keeps the adopted state', async () => {
    const h = harness([ok(MINT), ok({ desks: [{ projectId: 'prj-own-1', adopted: true }] }), ok({ desks: [{ projectId: 'prj-own-1', already: true }] })]);
    await signedIn(h);
    h.plane.interact('account-adopt', { getAttribute: (name: string) => (name === 'data-desk' ? 'prj-own-1' : 'account-adopt') });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    h.plane.interact('account-adopt', { getAttribute: (name: string) => (name === 'data-desk' ? 'prj-own-1' : 'account-adopt') });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(h.panel()?.adoption?.[0]?.status).toBe('adopted');
    expect(h.panel()?.adoption?.[0]?.detail).toContain('already yours');
    expect(h.toasts[2]?.title).toBe('Already yours');
  });

  it('logout clears the local session on every completion (a typed failure still signs out)', async () => {
    const clean = harness([ok(MINT), ok({})]);
    await signedIn(clean);
    clean.plane.interact('account-logout', { getAttribute: () => 'account-logout' });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(clean.requests[1]?.path).toBe('/v1/auth/logout');
    expect(clean.panel()?.surface).toBe('anonymous');
    expect(clean.storage.getItem(PRINCIPAL_SESSION_STORAGE_KEY)).toBe('');
    expect(clean.toasts[1]?.title).toBe('Signed out');

    const refused = harness([ok(MINT), envelopeError(503, 'unavailable', 'the auth plane is unreachable')]);
    await signedIn(refused);
    refused.plane.interact('account-logout', { getAttribute: () => 'account-logout' });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(refused.panel()?.surface).toBe('anonymous'); // still signed out — a stale login is worse
    expect(refused.panel()?.error).toBe('the auth plane is unreachable'); // the honest note
  });

  it('a non-account action falls through (the plane never swallows another branch\'s press)', () => {
    const h = harness([]);
    expect(h.plane.interact('theme-light', { getAttribute: () => 'theme-light' })).toBe(false);
    expect(h.plane.interact('account-unknown', { getAttribute: () => 'account-unknown' })).toBe(false); // unknown account kinds fall through too — never a silent swallow
    expect(h.plane.edit({ getAttribute: () => null })).toBe(false);
    expect(accountFieldOf({ getAttribute: () => null, value: 'x' })).toBeNull();
  });
});
