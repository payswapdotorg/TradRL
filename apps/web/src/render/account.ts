// @tradrl/web-console — THE ACCOUNT SURFACE (FW-39-2, identity Wave 2 —
// docs/design/IDENTITY-MODEL.md §5 Wave 2; the render half of
// core/principal.ts, extracted per the payload-budget law: console.ts
// rides a 160 KiB single-file line, so the account surface lives HERE
// and the shell composes it).
//
// WHAT THIS RENDERS (pure VNode data — identical (panel, simulated)
// pairs serialize identically):
//   - THE SETTINGS ACCOUNT ROW: register/login (passphrase-first), the
//     adoption ceremony (the session's own desks, per-desk adopt
//     buttons), logout — every state degrades HONESTLY: the demo
//     backing's typed not-available teaches itself loudly ("accounts
//     are not available on this deployment"), never a silent wall;
//   - THE FIRST-RUN OFFER (the Home invitation): a subtle "create an
//     account so your desks survive restarts" card for ANONYMOUS
//     sessions AFTER onboarding (the composition gate — the wizard
//     never carries it — lives in render/model.ts);
//   - THE COPY HONESTY FOLDS: the Theme/Project rows' "remembered for
//     future visits" is TRUE for an authenticated principal and becomes
//     the device-scoped "remembered on this device" for anonymous
//     sessions (the design's honesty rider; per-account POSTURE is
//     Phase 2, the copy changes now);
//   - THE SIMULATED DISCLOSURE, adjacent to the account rows: an
//     account never implies real money (the design §3(c) audit rider).
//
// The interactions are DELEGATED (app/console.ts's one resolver): the
// buttons carry data-action="account-*", the inputs
// data-account-field — the plane (app/account-plane.ts) owns the
// branches; this module owns only the bytes.

import { v, type VNode } from './vtree';
import { labeledInput } from './flow';
import { anonymousAccountPanel, type AccountPanelState, type AdoptionDeskRow } from '../core/principal';

/** The account panel of a shell view (undefined = the anonymous default — a fresh browser, the demo flow's own shape). */
export type AccountViewField = { readonly account?: AccountPanelState };

/** Fold a shell view's account field to its panel (the anonymous default when absent — never a half surface). */
export function accountPanelOf(view: AccountViewField): AccountPanelState {
  return view.account ?? anonymousAccountPanel();
}

/**
 * THE COPY HONESTY FOLD (the design §5 Wave 2's ride-along): the
 * Theme/Project rows' persistence promise. An AUTHENTICATED principal's
 * choice is remembered for future visits (the account is the durable
 * identity — the desks re-attach at login); an ANONYMOUS session's
 * choice survives only THIS device's browser storage — a cleared
 * profile or a new machine loses it, and the copy says exactly that.
 */
export function rememberedScopeCopy(panel: AccountPanelState): string {
  return panel.surface === 'authenticated' ? 'remembered for future visits' : 'remembered on this device';
}

/** The SIMULATED disclosure adjacent to the account rows (an account never implies real money — the demo marking rides the surface). */
function simulatedDisclosure(simulated: boolean): VNode | null {
  if (!simulated) return null;
  return v('p', { class: 'card-note', 'data-account-simulated': 'true' }, ['SIMULATED — this console runs on demo data. An account never implies real money.']);
}

/** One adoption-ceremony row: the desk's own name + its per-desk adopt state (offered = its own button; adopted/failed = the disclosed state, never a dead control). */
function adoptionRow(row: AdoptionDeskRow, busy: boolean): VNode {
  const adopted = row.status === 'adopted';
  return v('div', { class: 'def-item', 'data-adopt-desk': row.projectId }, [
    v('dt', {}, [row.name]),
    v('dd', {}, [
      adopted
        ? v('span', { class: 'card-note', 'data-adopt-state': 'adopted' }, [row.detail === null ? 'Adopted — this desk now follows your account.' : row.detail])
        : row.status === 'failed'
          ? v('span', { class: 'card-note', 'data-adopt-state': 'failed' }, [row.detail === null ? 'The host refused this desk\'s adoption.' : row.detail])
          : v('button', { class: 'tm-button', 'data-action': 'account-adopt', 'data-desk': row.projectId, type: 'button', ...(busy ? { 'aria-disabled': 'true' } : {}) }, ['Adopt this desk']),
    ]),
  ]);
}

/**
 * THE SETTINGS ACCOUNT ROW — the whole account surface in one
 * settingsRow body (render/shell.ts composes it; the row's own title
 * and description live there, beside it, so the visual language stays
 * one). Every surface state renders honestly:
 *   - 'checking'      a plain line (a stored token is being validated);
 *   - 'anonymous'     the register/login forms (passphrase-first);
 *   - 'authenticated' the signed-in name, the adoption ceremony, logout;
 *   - 'unavailable'   the teaching state — the deployment's typed
 *                     not-available, quoted, never a silent wall.
 */
export function accountSettingsBody(panel: AccountPanelState, simulated: boolean): readonly VNode[] {
  const disclosure = simulatedDisclosure(simulated);
  if (panel.surface === 'checking') {
    return [
      v('p', { class: 'card-note', 'data-account-surface': 'checking' }, ['Checking for a saved account…']),
      ...(disclosure === null ? [] : [disclosure]),
    ];
  }
  if (panel.surface === 'unavailable') {
    return [
      v('p', { class: 'card-note', 'data-account-surface': 'unavailable', role: 'note' }, ['Accounts are not available on this deployment — this console runs without a login, and nothing about your session changes. The host\'s own answer:']),
      v('p', { class: 'card-note', 'data-account-unavailable-reason': 'true' }, [panel.unavailableMessage === null ? 'the auth routes answered the typed not-available' : panel.unavailableMessage]),
      ...(disclosure === null ? [] : [disclosure]),
    ];
  }
  if (panel.surface === 'authenticated') {
    const name = panel.principalName === null ? '' : panel.principalName;
    const rows = panel.adoption ?? [];
    return [
      v('div', { class: 'fact-row', 'data-account-surface': 'authenticated' }, [
        v('span', { class: 'fact-label' }, ['signed in as']),
        v('span', { class: 'fact-value' }, [name]),
      ]),
      v('div', { class: 'card-note', 'data-account-adoption': String(rows.length) }, [
        v('p', {}, [rows.length === 0
          ? 'No desks from this session are waiting to be adopted — desks you launch while signed in follow this account on their own.'
          : 'This session\'s own desks, below — adopt the ones you want to follow your account (idempotent; adopting is per-desk and disclosed). The shared demo desk is everyone\'s teaching desk and never adopts.']),
        v('dl', { class: 'def-grid' }, rows.map((row) => adoptionRow(row, panel.busy))),
      ]),
      v('div', { class: 'tm-playback' }, [
        v('button', { class: 'tm-button', 'data-action': 'account-logout', type: 'button', ...(panel.busy ? { 'aria-disabled': 'true' } : {}) }, ['Sign out']),
      ]),
      ...(disclosure === null ? [] : [disclosure]),
    ];
  }
  // 'anonymous' — the register/login forms (passphrase-first; the mode
  // toggle reuses the theme row's segmented shape).
  const register = panel.mode === 'register';
  return [
    v('div', { class: 'segmented', role: 'group', 'aria-label': 'Account mode', 'data-account-surface': 'anonymous' }, [
      v('button', { class: 'segment', 'data-action': 'account-mode-login', type: 'button', 'aria-pressed': register ? 'false' : 'true' }, ['Sign in']),
      v('button', { class: 'segment', 'data-action': 'account-mode-register', type: 'button', 'aria-pressed': register ? 'true' : 'false' }, ['Create account']),
    ]),
    ...labeledInput({ label: 'Account name', name: 'name', value: panel.edits.name ?? '', required: true, placeholder: 'e.g. desk.owner@firm', hint: 'The name you will sign in with.', vocabulary: 'account' }),
    ...labeledInput({ label: 'Passphrase', name: 'passphrase', value: panel.edits.passphrase ?? '', type: 'password', required: true, hint: register ? 'Choose one — the host stores only a salted verifier, never the passphrase.' : 'Your account\'s passphrase.', vocabulary: 'account' }),
    ...(panel.error === null ? [] : [v('p', { class: 'field-error', role: 'alert', 'data-account-error': panel.error }, [panel.error])]),
    v('div', { class: 'tm-playback' }, [
      v('button', { class: 'tm-button', 'data-action': 'account-submit', type: 'button', ...(panel.busy ? { 'aria-disabled': 'true' } : {}) }, [panel.busy ? 'Working…' : register ? 'Create account' : 'Sign in']),
    ]),
    v('p', { class: 'card-note' }, ['Optional — the console works without an account. An account keeps the desks you adopt across browser restarts and machines; without one, this device\'s browser storage is the only thing that remembers your session.']),
    ...(disclosure === null ? [] : [disclosure]),
  ];
}

/**
 * THE FIRST-RUN OFFER (the design §5 Wave 2: "a first-run offer AFTER
 * onboarding (never inside it — the demo flow stays untouched)"): a
 * subtle invitation for ANONYMOUS sessions on Home. The composition
 * gate lives in render/model.ts (the wizard-open view never carries
 * it); the card's own bytes live here. The button rides the EXISTING
 * delegated navigation (data-target="settings" — a BUTTON the nav
 * branch resolves), so the offer costs zero new interaction wiring.
 */
export function accountInviteCard(): VNode {
  return v('div', { class: 'card account-invite', 'data-account-invite': 'true' }, [
    v('div', { class: 'def-eyebrow' }, ['ACCOUNT']),
    v('p', { class: 'card-note' }, ['Create an account so your desks survive restarts — sign in on any browser to find them again.']),
    v('div', { class: 'tm-playback' }, [
      v('button', { class: 'tm-button', 'data-target': 'settings', type: 'button' }, ['Set up an account']),
    ]),
  ]);
}
