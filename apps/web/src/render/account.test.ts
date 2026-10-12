// Tests for THE ACCOUNT SURFACE (FW-39-2, identity Wave 2 —
// render/account.ts + its composition into the shell): the
// login/register surface, the adoption ceremony, the demo-not-available
// teaching state, the copy honesty ride-along, the Home first-run
// offer, and the anonymous no-change pin.
//
// Laws pinned here (pure VNode assertions — serializeVNode bytes, no
// DOM):
//   - the anonymous surface: the register/login forms (passphrase-first,
//     the mode toggle, both fields, the submit), the SIMULATED
//     disclosure ADJACENT when the console runs demo data, and the
//     honest optional-card note;
//   - the authenticated surface: the signed-in name, the adoption
//     ceremony (per-desk rows with their own adopt buttons; the adopted
//     state as disclosed text, never a dead control), logout;
//   - the teaching state: "Accounts are not available on this
//     deployment" + the host's own message quoted — never a silent
//     wall;
//   - THE COPY HONESTY RIDE-ALONG: the Theme/Project rows read
//     "remembered on this device" for anonymous sessions and "remembered
//     for future visits" for authenticated principals;
//   - THE FIRST-RUN OFFER: the Home invitation renders for anonymous
//     sessions AFTER onboarding — NEVER inside the open wizard (the
//     no-change pin), and never for authenticated/unavailable surfaces;
//   - THE WALL CENSUS UNDER A PRINCIPAL: the switcher's options list
//     the principal-owned rows + the shared demo desk ONLY (the marker
//     law pinned through the render fold).

import { describe, expect, it } from 'vitest';
import { openWorkspace, reduceAll, type WorkspaceEvent, type WorkspaceState } from '../core/workspace';
import { initialOnboarding, onboardingPanel } from '../core/onboarding';
import type { ProjectRecord } from '../api/contracts';
import { defaultShellView, settingsPanel, switcherOptions, type ShellView } from './shell';
import { renderConsoleModel } from './model';
import { serializeVNode } from './vtree';
import {
  accountInviteCard,
  accountPanelOf,
  accountSettingsBody,
  rememberedScopeCopy,
  switcherListScopeCopy,
} from './account';
import {
  anonymousAccountPanel,
  authenticatedAccountPanel,
  unavailableAccountPanel,
} from '../core/principal';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

function stateAt(events: readonly WorkspaceEvent[] = []): WorkspaceState {
  return reduceAll(openWorkspace(SCOPE, T0), events);
}

function view(overrides: Partial<ShellView> = {}, state: WorkspaceState = stateAt()): ShellView {
  return { ...defaultShellView(state), ...overrides };
}

/** A directory row with the host's additive session-scope marker. */
function directoryRow(id: string, marker: 'session-owned' | 'principal-owned' | 'tenant-available' | 'none'): ProjectRecord {
  return {
    id,
    tenantId: 'tenant-a',
    name: `desk ${id}`,
    executionMode: 'simulation',
    lifecycle: { projectId: id, status: 'active', acceptanceCriteriaId: null, organizationRef: null },
    lineage: { projectId: id, goal: { goalId: 'goal-1', version: 1 }, constraintSet: { id: 'cs-1', version: 1 } },
    createdAt: T0,
    updatedAt: T0,
    ...(marker === 'none' ? {} : { consoleSessionScope: marker }),
  } as unknown as ProjectRecord;
}

const OWN_DIRECTORY: readonly ProjectRecord[] = [
  directoryRow('prj-demo-console', 'tenant-available'),
  directoryRow('prj-own-1', 'session-owned'),
];

const ADOPTION_ROWS = [
  { projectId: 'prj-own-1', name: 'desk prj-own-1', status: 'offered' as const, detail: null },
];

describe('the account settings surface — the anonymous register/login forms', () => {
  it('renders the mode toggle, both fields and the submit (passphrase-first)', () => {
    const body = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody(anonymousAccountPanel(), false) });
    expect(body).toContain('data-action="account-mode-login"');
    expect(body).toContain('data-action="account-mode-register"');
    expect(body).toContain('data-account-field="name"');
    expect(body).toContain('data-account-field="passphrase"');
    expect(body).toContain('type="password"');
    expect(body).toContain('data-action="account-submit"');
    expect(body).toContain('Sign in'); // the default mode is login
  });

  // FW-51 (the Round N minors — S2's one recorded account friction, S3
  // corroborated: "two identically-labeled 'Create account' buttons (mode
  // switcher + submit — clicked the wrong one first)"). THE LAW: every
  // button names its OWN action — the segmented toggle names the MODE it
  // selects (aria-pressed carries the selection), the submit names the
  // ACTION it performs on the entered fields (the adoption row's own
  // "Adopt this desk" vocabulary: verb + this + the noun it acts on).
  it('FW-51: in REGISTER mode every button names its own action — the toggle keeps the mode\'s name, the submit names the account it creates; never two identically-labeled "Create account" buttons', () => {
    const panel = { ...anonymousAccountPanel(), mode: 'register' as const };
    const body = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody(panel, false) });
    // the mode toggle renders BOTH faces, the register one selected
    expect(body).toContain('data-action="account-mode-login"');
    expect(body).toContain('data-action="account-mode-register"');
    expect(body).toContain('aria-pressed="true"');
    // THE DUPLICATION PIN: exactly ONE "Create account" renders — the
    // SEGMENT's own mode name. The submit never repeats it (the pre-fix
    // tree rendered the label twice: the segment + the submit).
    expect(body.match(/Create account/g) ?? []).toHaveLength(1);
    expect(body).toContain('>Create account</button>');
    // the submit names its own action — the account the entered name +
    // passphrase create (distinct from the mode's name, so the two
    // controls can never be confused for each other again)
    expect(body).toContain('data-action="account-submit"');
    expect(body).toContain('>Create this account</button>');
    // and the login face's name renders exactly once too — the login
    // SEGMENT (in register mode the submit is the create action, never a
    // second "Sign in")
    expect(body.match(/Sign in/g) ?? []).toHaveLength(1);
  });

  it('the SIMULATED disclosure rides ADJACENT when the console runs demo data (an account never implies real money)', () => {
    const plain = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody(anonymousAccountPanel(), false) });
    expect(plain).not.toContain('data-account-simulated');
    const simulated = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody(anonymousAccountPanel(), true) });
    expect(simulated).toContain('data-account-simulated="true"');
    expect(simulated).toContain('SIMULATED');
    expect(simulated).toContain('An account never implies real money');
  });

  it('the buffered edits render merged (the J3 law) and an inline error renders in the form\'s own card', () => {
    const panel = { ...anonymousAccountPanel(), edits: { name: 'desk.owner' }, error: 'no such principal' };
    const body = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody(panel, false) });
    expect(body).toContain('value="desk.owner"');
    expect(body).toContain('data-account-error="no such principal"');
    expect(body).toContain('role="alert"');
  });
});

describe('the account settings surface — the adoption ceremony + logout', () => {
  it('renders the signed-in name, per-desk adopt buttons and the sign-out', () => {
    const panel = { ...authenticatedAccountPanel('desk.owner'), adoption: ADOPTION_ROWS };
    const body = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody(panel, false) });
    expect(body).toContain('data-account-surface="authenticated"');
    expect(body).toContain('desk.owner');
    expect(body).toContain('data-adopt-desk="prj-own-1"');
    expect(body).toContain('data-action="account-adopt"');
    expect(body).toContain('data-desk="prj-own-1"');
    expect(body).toContain('Adopt this desk');
    expect(body).toContain('data-action="account-logout"');
    expect(body).toContain('Sign out');
  });

  it('an adopted desk renders its disclosed state (never a dead control); the demo desk never appears', () => {
    const adopted = [
      { projectId: 'prj-own-1', name: 'desk prj-own-1', status: 'adopted' as const, detail: null },
      { projectId: 'prj-own-2', name: 'desk prj-own-2', status: 'adopted' as const, detail: 'already yours — adopted before this visit' },
    ];
    const body = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody({ ...authenticatedAccountPanel('desk.owner'), adoption: adopted }, false) });
    expect(body).toContain('data-adopt-state="adopted"');
    expect(body).toContain('Adopted — this desk now follows your account.');
    expect(body).toContain('already yours — adopted before this visit');
    expect(body).not.toContain('data-adopt-desk="prj-demo-console"');
    expect(body).not.toContain('data-action="account-adopt"'); // everything adopted — no dead buttons
  });

  it('the empty ceremony teaches its own truth (no desks waiting; launched desks follow on their own)', () => {
    const body = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody(authenticatedAccountPanel('desk.owner'), false) });
    expect(body).toContain('data-account-adoption="0"');
    // FW-42-B (the copy-lag): the copy tells the ACCOUNT-SCOPED truth —
    // "your account", never the session-scoped undersell
    expect(body).toContain('desks you launch while signed in follow your account on their own');
    expect(body).toContain("your account's other desks sit in the project list");
  });

  it('FW-42-B (the copy-lag): the ceremony intro says "Your desks" — the account scope the pure test proved (never the session-scoped undersell)', () => {
    const panel = { ...authenticatedAccountPanel('desk.owner'), adoption: ADOPTION_ROWS };
    const body = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody(panel, false) });
    expect(body).toContain('Your desks, below');
    expect(body).not.toContain('This session\u2019s own desks, below'); // the pre-fix session-scoped copy is gone (the typographic apostrophe the source uses)
    expect(body).toContain('a still-offered desk adopts on one click, idempotently'); // the defense-in-depth control is disclosed
  });

  it('FW-42-B (J-1): the sign-in resolution\'s per-desk states render their own disclosed wording (already-adopted vs adopted-now), never a re-offer button', () => {
    const resolved = [
      { projectId: 'prj-signed-in', name: 'desk prj-signed-in', status: 'adopted' as const, detail: 'already yours — following this account' },
      { projectId: 'prj-anon', name: 'desk prj-anon', status: 'adopted' as const, detail: 'now follows your account — adopted at sign-in' },
    ];
    const body = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody({ ...authenticatedAccountPanel('desk.owner'), adoption: resolved }, false) });
    expect(body).toContain('already yours — following this account');
    expect(body).toContain('now follows your account — adopted at sign-in');
    expect(body).not.toContain('data-action="account-adopt"'); // no re-offer button over a resolved desk
  });
});

describe('the account settings surface — the demo-not-available teaching state', () => {
  it('teaches loudly (never a silent wall) and quotes the host\'s own answer', () => {
    const panel = unavailableAccountPanel('accounts are not served by this deployment\'s backing (R46)');
    const body = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody(panel, true) });
    expect(body).toContain('data-account-surface="unavailable"');
    expect(body).toContain('Accounts are not available on this deployment');
    expect(body).toContain('nothing about your session changes');
    expect(body).toContain('data-account-unavailable-reason="true"');
    expect(body).toContain('accounts are not served by this deployment\'s backing (R46)');
  });

  it('the checking state renders a plain line (a stored token is being validated)', () => {
    const panel = { ...anonymousAccountPanel(), surface: 'checking' as const };
    const body = serializeVNode({ tag: 'div', attrs: {}, children: accountSettingsBody(panel, false) });
    expect(body).toContain('data-account-surface="checking"');
    expect(body).toContain('Checking for a saved account');
  });
});

describe('the copy honesty ride-along (the Theme/Project rows\' persistence promise)', () => {
  it('anonymous sessions read the device-scoped copy; authenticated principals keep the true future-visits promise', () => {
    expect(rememberedScopeCopy(anonymousAccountPanel())).toBe('remembered on this device');
    expect(rememberedScopeCopy(unavailableAccountPanel('x'))).toBe('remembered on this device');
    expect(rememberedScopeCopy(authenticatedAccountPanel('desk.owner'))).toBe('remembered for future visits');
  });

  it('the Settings rows themselves carry the honest copy (the panel composes the fold)', () => {
    const anonymous = serializeVNode(settingsPanel(stateAt(), view()));
    expect(anonymous).toContain('your choice is remembered on this device');
    const authenticated = serializeVNode(settingsPanel(stateAt(), view({ account: authenticatedAccountPanel('desk.owner') })));
    expect(authenticated).toContain('your choice is remembered for future visits');
    expect(authenticated).not.toContain('remembered on this device');
  });

  it('the account row composes into the whole Settings model (the extraction pattern\'s one seam)', () => {
    const state = stateAt([{ kind: 'section-selected', at: T0 + 1, section: 'goal' }]);
    const serialized = serializeVNode(renderConsoleModel(state, T0 + 2, { ...view({ accountView: 'settings' }, state) }));
    expect(serialized).toContain('data-settings="account"');
    expect(serialized).toContain('data-account-surface="anonymous"');
    expect(serialized).toContain('data-action="account-submit"');
  });
});

describe('the Home first-run offer (AFTER onboarding, never inside it)', () => {
  it('renders for an anonymous session once the wizard is closed (a connected world, the main render path)', () => {
    const state = stateAt([{ kind: 'connection-changed', at: T0 + 1, status: 'connected' }]);
    const home = serializeVNode(renderConsoleModel(state, T0 + 2, view({ accountView: 'home' }, state)));
    expect(home).toContain('data-account-invite="true"');
    expect(home).toContain('Create an account so your desks survive restarts');
    expect(home).toContain('data-target="settings"'); // the EXISTING delegated navigation — zero new wiring
  });

  it('NEVER renders while the wizard is open (the offer is AFTER onboarding — the no-change pin)', () => {
    const state = stateAt([{ kind: 'connection-changed', at: T0 + 1, status: 'connected' }]);
    const withWizard = serializeVNode(renderConsoleModel(state, T0 + 2, view({ accountView: 'home', onboarding: initialOnboarding() }, state)));
    expect(withWizard).not.toContain('data-account-invite'); // the wizard-open gate holds the offer back
  });

  it('the wizard\'s own rendered bytes carry ZERO account surface (the no-change pin)', () => {
    const wizard = serializeVNode(onboardingPanel(initialOnboarding()));
    expect(wizard).not.toContain('account-');
    expect(wizard).not.toContain('data-account-field');
    expect(wizard).not.toContain('Set up an account');
    // and the invite is absent from the whole model while the wizard is open
    const model = serializeVNode(renderConsoleModel(stateAt(), T0 + 2, view({ accountView: 'home', onboarding: initialOnboarding() })));
    const inviteCount = model.split('data-account-invite="true"').length - 1;
    expect(inviteCount).toBe(0);
  });

  it('never renders for an authenticated principal or the teaching state', () => {
    const state = stateAt([{ kind: 'connection-changed', at: T0 + 1, status: 'connected' }]);
    const authenticated = serializeVNode(renderConsoleModel(state, T0 + 2, view({ accountView: 'home', account: authenticatedAccountPanel('desk.owner') }, state)));
    expect(authenticated).not.toContain('data-account-invite');
    const unavailable = serializeVNode(renderConsoleModel(state, T0 + 2, view({ accountView: 'home', account: unavailableAccountPanel('x') }, state)));
    expect(unavailable).not.toContain('data-account-invite');
  });

  it('the invite card\'s own bytes (the card\'s law: subtle, honest, navigational)', () => {
    const card = serializeVNode(accountInviteCard());
    expect(card).toContain('ACCOUNT');
    expect(card).toContain('sign in on any browser to find them again');
    expect(card).toContain('data-target="settings"');
  });
});

describe('the wall census under a principal (own + demo only — the marker law through the render fold)', () => {
  it('the switcher lists the principal-owned rows + the shared demo desk ONLY (never another session\'s)', () => {
    const state = stateAt([{ kind: 'projects-listed', at: T0 + 1, records: [
      directoryRow('prj-demo-console', 'tenant-available'),
      directoryRow('prj-principal-1', 'principal-owned'), // wave 1's marker — this principal's re-attached desk
      directoryRow('prj-own-1', 'session-owned'),
      directoryRow('prj-foreign-1', 'tenant-available'), // another session's desk — the wall holds
    ] }]);
    const options = switcherOptions(state, view());
    expect(options.map((project) => project.id)).toEqual(['prj-demo-console', 'prj-principal-1', 'prj-own-1']);
  });

  it('the account panel fold defaults the absent field to the anonymous surface (never a half surface)', () => {
    expect(accountPanelOf({}).surface).toBe('anonymous');
    expect(accountPanelOf({ account: authenticatedAccountPanel('desk.owner') }).principalName).toBe('desk.owner');
  });
});

// ---------------------------------------------------------------------------
// FW-42-B (the Round J copy-lag — 6/6 pure testers): the switcher's LIST
// copy under a signed-in principal tells the ACCOUNT-SCOPED truth. The
// Round J pure test proved the desks follow the ACCOUNT (a wiped context +
// one sign-in listed every desk — "your session's own projects" undersold
// it, 6/6 noted). THE LAW: an authenticated principal reads "your
// projects"; an anonymous session keeps the exact session-scoped bytes
// (honest for it — the device's storage is the only thing that remembers
// an anonymous session's projects).
// ---------------------------------------------------------------------------

describe('FW-42-B (the copy-lag): the switcher list copy is account-scoped under a signed-in principal', () => {
  it('authenticated: "your projects" + the account-following wording — never the session-scoped undersell', () => {
    const bytes = serializeVNode(settingsPanel(stateAt(), view({ account: authenticatedAccountPanel('desk.owner') })));
    expect(bytes).toContain('The list is your projects — every desk that follows your account, from any browser — plus the shared demo project');
    expect(bytes).not.toContain('your session\u2019s own projects'); // the undersell is gone under a principal
  });

  it('anonymous keeps the exact pre-fix bytes (the session-scoped copy is HONEST for it)', () => {
    const bytes = serializeVNode(settingsPanel(stateAt(), view()));
    expect(bytes).toContain('The list is your session\u2019s own projects plus the shared demo project');
    expect(bytes).not.toContain('every desk that follows your account');
  });

  it('the fold itself: authenticated vs anonymous (the rememberedScopeCopy precedent)', () => {
    expect(switcherListScopeCopy(authenticatedAccountPanel('desk.owner'))).toBe('your projects — every desk that follows your account, from any browser —');
    expect(switcherListScopeCopy(anonymousAccountPanel())).toBe('your session\u2019s own projects');
    expect(switcherListScopeCopy(unavailableAccountPanel('x'))).toBe('your session\u2019s own projects'); // the teaching posture is not a signed-in principal
  });
});
