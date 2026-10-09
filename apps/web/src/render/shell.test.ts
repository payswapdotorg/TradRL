// Tests for the app shell render (render/shell.ts + the composed
// renderConsoleModel — UX-DESIGN.md §2/§3, T051).
//
// Laws pinned here (pure VNode assertions — serializeVNode bytes, no DOM):
//   - the .tradrl-shell root with data-theme (light DEFAULT, dark via
//     the shell view — the palettes themselves are pinned in
//     src/shell/tokens.test.ts);
//   - the shell structure: brand row, the four nav groups with ALL
//     FIFTEEN targets, the CONNECTION block, the environment badge,
//     the mobile header + drawer backdrop, the main content wrapper;
//   - the active-item treatment (aria-current="page" on exactly the
//     active target; the twelve section items keep data-section for
//     T042's interaction law);
//   - the connection states: LIVE / DEGRADED / UNREACHABLE /
//     CONNECTING — always dot + label, never color alone; the loading
//     skeleton while connecting; the details popover (endpoint, last
//     poll, degradation, retry);
//   - the page scaffold on EVERY section: H1 + one-sentence muted
//     subtitle + status badge + the ghost icon-only Refresh with
//     aria-label; Home renders the hero and no scaffold.

import { describe, expect, it } from 'vitest';
import { openWorkspace, reduceAll, type WorkspaceEvent, type WorkspaceState } from '../core/workspace';
import { SHELL_TARGETS, SHELL_TITLES } from '../core/nav';
import { renderConsoleModel, serializeConsoleModel } from './model';
import { serializeVNode, type VNode } from './vtree';
import {
  activeTargetOf,
  badgeClassOf,
  CONNECTION_STATE_LABELS,
  connectionClassOf,
  defaultShellView,
  sectionBadgeOf,
  SHELL_INTERACTION_CSS,
  type ShellView,
} from './shell';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

function stateAt(events: readonly WorkspaceEvent[] = [], section?: string): WorkspaceState {
  const all = section === undefined ? events : [...events, { kind: 'section-selected', at: T0 + 1, section }];
  return reduceAll(openWorkspace(SCOPE, T0), all as readonly WorkspaceEvent[]);
}

/** A shell view with overrides applied to the default. */
function view(overrides: Partial<ShellView> = {}, state: WorkspaceState = stateAt()): ShellView {
  return { ...defaultShellView(state), ...overrides };
}

/** The serialized render with a workspace state + shell view. */
function render(state: WorkspaceState, viewOverride: Partial<ShellView> = {}): string {
  return serializeVNode(renderConsoleModel(state, T0 + 40, view(viewOverride, state)));
}

describe('shell: the .tradrl-shell root (§1/§2)', () => {
  it('renders the tradrl-shell root with the light theme as the DEFAULT', () => {
    const serialized = render(stateAt());
    expect(serialized).toContain('class="tradrl-shell console"');
    expect(serialized).toContain('data-theme="light"');
  });

  it('renders the dark theme via the shell view (data-theme="dark")', () => {
    const serialized = render(stateAt(), { theme: 'dark' });
    expect(serialized).toContain('data-theme="dark"');
    expect(serialized).not.toContain('data-theme="light"');
  });

  it('carries the connection, render instant and ACTIVE TARGET on the root (T042 pins preserved; the W-10b delegation fix)', () => {
    const serialized = render(stateAt([{ kind: 'connection-changed', at: T0 + 2, status: 'connected' }]));
    expect(serialized).toContain('data-connection="connected"');
    expect(serialized).toContain('data-rendered-at="1700000000040"');
    // THE W-10b DELEGATION LAW: the root's active-target STATE MARKER is
    // `data-active-target` — the root must NEVER carry a bare `data-target`
    // (the delegated-navigation vocabulary of the affordance buttons):
    // app/console.ts resolves `closest('[data-target]')` for navigation, and
    // every element descends from the root — a root `data-target`
    // intercepted EVERY click as a navigation and returned before any
    // [data-action] branch could run (the J1 hard block: the onboarding
    // wizard was unclickable, silently, with zero console errors).
    expect(serialized).toContain('data-active-target="goal"'); // the default view: the selected section
    const rootTag = serialized.match(/<div class="tradrl-shell console"[^>]*>/)?.[0] ?? '';
    expect(rootTag).not.toContain('data-target=');
  });

  it('the shell view is pure data: identical (state, at, view) -> identical bytes', () => {
    const state = stateAt([{ kind: 'connection-changed', at: T0 + 2, status: 'connected' }]);
    expect(render(state, { theme: 'dark', simulated: true })).toBe(render(state, { theme: 'dark', simulated: true }));
  });
});

describe('shell: the brand row + grouped navigation (§2)', () => {
  it('the brand row: logo tile + TradRL wordmark, links to Home, accessible as TradRL Console', () => {
    const serialized = render(stateAt());
    expect(serialized).toContain('class="brand-row"');
    expect(serialized).toContain('data-target="home"');
    expect(serialized).toContain('aria-label="TradRL Console"');
    expect(serialized).toContain('<span class="brand-word">TradRL</span>');
    expect(serialized).toContain('class="brand-tile"');
  });

  it('the navigation is aria-label="Primary" with the four groups in order', () => {
    const serialized = render(stateAt());
    expect(serialized).toContain('aria-label="Primary"');
    const order = ['Overview', 'Workspace', 'Evidence', 'Account'].map((label) => serialized.indexOf(`data-nav-group="${label}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('ALL FIFTEEN targets render as nav items (D1: one-click reachability)', () => {
    const serialized = render(stateAt());
    for (const target of SHELL_TARGETS) {
      expect(serialized, target).toContain(`data-target="${target}"`);
    }
  });

  it('the twelve section items keep data-section (T042 interaction law preserved)', () => {
    const serialized = render(stateAt());
    expect(serialized).toContain('data-section="time-machine"');
    expect(serialized).toContain('data-section="lessons"');
    expect(serialized).toContain('data-section="goal"');
  });

  it('exactly ONE item carries aria-current="page": the active target\'s nav item', () => {
    const state = stateAt([], 'risk');
    const serialized = render(state);
    expect(serialized).toContain('aria-current="page"');
    expect(serialized.match(/aria-current="page"/g)?.length).toBe(1);
    // the active item IS the risk item (class + data-target + aria-current on one button)
    expect(serialized).toMatch(/class="nav-item active" data-target="risk"[^>]*aria-current="page"/);
  });

  it('the active item carries the active class; the active target follows the account view', () => {
    const state = stateAt();
    expect(activeTargetOf(state, view({ accountView: 'section' }, state))).toBe('goal');
    expect(activeTargetOf(state, view({ accountView: 'inbox' }, state))).toBe('inbox');
    const serialized = render(state, { accountView: 'settings' });
    expect(serialized).toContain('data-target="settings"');
    expect(serialized).toContain('class="nav-item active"');
  });
});

describe('shell: the CONNECTION block (§1.3/§2 — never color alone)', () => {
  it('renders the CONNECTION label + the LIVE state (dot + label) when connected', () => {
    const serialized = render(stateAt([{ kind: 'connection-changed', at: T0 + 2, status: 'connected' }]));
    expect(serialized).toContain('CONNECTION');
    expect(serialized).toContain('>LIVE<');
    expect(serialized).toContain('class="conn-dot conn-dot-live"');
    expect(serialized).toContain('API reachable');
  });

  it('renders DEGRADED with the last failed read as the detail line', () => {
    const state = stateAt([
      { kind: 'connection-changed', at: T0 + 2, status: 'connected' },
      { kind: 'degraded-read', at: T0 + 3, route: 'GET /v1/projects/:id', family: 'unavailable', message: 'the transport failed: network gone' },
    ]);
    const serialized = render(state);
    expect(serialized).toContain('>DEGRADED<');
    expect(serialized).toContain('class="conn-dot conn-dot-warn"');
    expect(serialized).toContain('last failed read: GET /v1/projects/:id');
  });

  it('renders UNREACHABLE when offline', () => {
    const serialized = render(stateAt([{ kind: 'connection-changed', at: T0 + 2, status: 'offline' }]));
    expect(serialized).toContain('>UNREACHABLE<');
    expect(serialized).toContain('class="conn-dot conn-dot-down"');
  });

  it('renders CONNECTING with the loading skeleton bar (no label-only state)', () => {
    const serialized = render(stateAt()); // a fresh workspace is connecting
    expect(serialized).toContain('>CONNECTING<');
    expect(serialized).toContain('class="conn-dot conn-dot-idle"');
    expect(serialized).toContain('conn-skeleton');
  });

  it('the connection mapping covers the whole status vocabulary', () => {
    expect(connectionClassOf('connected')).toBe('live');
    expect(connectionClassOf('degraded')).toBe('warn');
    expect(connectionClassOf('offline')).toBe('down');
    expect(connectionClassOf('connecting')).toBe('idle');
    expect(CONNECTION_STATE_LABELS).toEqual({ live: 'LIVE', warn: 'DEGRADED', down: 'UNREACHABLE', idle: 'CONNECTING' });
  });

  it('the details popover carries endpoint, last poll, degradation and the retry action', () => {
    const serialized = render(stateAt([{ kind: 'connection-changed', at: T0 + 2, status: 'connected' }]), { endpoint: 'https://api.example.net' });
    expect(serialized).toContain('class="connection-popover"');
    expect(serialized).toContain('https://api.example.net');
    expect(serialized).toContain('last poll');
    expect(serialized).toContain('degradation');
    expect(serialized).toContain('data-action="refresh"');
    expect(serialized).toContain('Retry connection');
  });

  it('the environment badge: SIMULATED · demo data on a fake adapter; LIVE on the real API', () => {
    const simulated = render(stateAt(), { simulated: true });
    expect(simulated).toContain('SIMULATED · demo data');
    expect(simulated).toContain('env-simulated');
    const live = render(stateAt([{ kind: 'connection-changed', at: T0 + 2, status: 'connected' }]), { simulated: false });
    expect(live).toContain('>LIVE</span>'.replace('</span>', '')); // the env badge label LIVE
    expect(live).toContain('env-live');
    expect(live).not.toContain('SIMULATED');
  });
});

describe('shell: the mobile header + drawer (§2)', () => {
  it('renders the sticky header (brand + connection indicator + menu button)', () => {
    const serialized = render(stateAt());
    expect(serialized).toContain('class="shell-header"');
    expect(serialized).toContain('aria-label="Open navigation"');
    expect(serialized).toContain('data-action="drawer-open"');
    expect(serialized).toContain('aria-expanded="false"');
  });

  it('the drawer state rides the root (closed by default; open via the view)', () => {
    expect(render(stateAt())).toContain('data-drawer="closed"');
    expect(render(stateAt(), { drawerOpen: true })).toContain('data-drawer="open"');
    expect(render(stateAt(), { drawerOpen: true })).toContain('aria-expanded="true"');
  });

  it('the backdrop closes the drawer (data-action="drawer-close")', () => {
    const serialized = render(stateAt());
    expect(serialized).toContain('class="drawer-backdrop"');
    expect(serialized).toContain('data-action="drawer-close"');
    expect(serialized).toContain('aria-label="Close navigation"');
  });
});

describe('shell: the page scaffold (§3 — every section)', () => {
  it('EVERY workspace section renders H1 + its charter subtitle + status badge + the Refresh action', () => {
    const sections = SHELL_TARGETS.filter((target) => target !== 'home' && target !== 'inbox' && target !== 'settings');
    for (const section of sections) {
      const state = stateAt([], section);
      const serialized = render(state, { accountView: 'section' });
      const scaffold = serialized.indexOf('class="page-scaffold"');
      expect(scaffold, section).toBeGreaterThanOrEqual(0);
      expect(serialized, section).toContain(`data-scaffold="${section}"`);
      // H1 with the section title
      expect(serialized, section).toContain(`<h1 class="page-title">${SHELL_TITLES[section]}</h1>`);
      // the ghost icon-only Refresh with an aria-label
      expect(serialized, section).toContain('data-action="refresh"');
      expect(serialized, section).toMatch(/aria-label="Refresh [^"]+"/);
      // a status badge is present (one of the three)
      expect(serialized, section).toMatch(/class="status-badge badge-(live|simulated|readonly)"/);
    }
  });

  it('the status badge maps: SIMULATED on a fake adapter (always labeled); LIVE when connected on the real API; READ-ONLY otherwise', () => {
    const connected = stateAt([{ kind: 'connection-changed', at: T0 + 2, status: 'connected' }]);
    expect(sectionBadgeOf(view({}, connected), 'connected')).toBe('LIVE');
    expect(sectionBadgeOf(view({ simulated: true }, connected), 'connected')).toBe('SIMULATED');
    expect(sectionBadgeOf(view({}, stateAt()), 'connecting')).toBe('READ-ONLY');
    expect(sectionBadgeOf(view({}, stateAt([{ kind: 'degraded-read', at: T0 + 3, route: 'r', family: 'unavailable', message: 'm' }])), 'degraded')).toBe('READ-ONLY');
    expect(badgeClassOf('LIVE')).toBe('live');
    expect(badgeClassOf('SIMULATED')).toBe('simulated');
    expect(badgeClassOf('READ-ONLY')).toBe('readonly');
    // and in the render:
    expect(render(connected, { simulated: true })).toContain('>SIMULATED<');
    expect(render(connected)).toContain('>LIVE<');
    expect(render(stateAt())).toContain('>READ-ONLY<');
  });

  it('the subtitle copy renders verbatim (the charter §3 list)', () => {
    const serialized = render(stateAt([], 'evidence'), { accountView: 'section' });
    expect(serialized).toContain('Content-addressed evidence capsules.');
  });

  it('the busy refresh renders the spinning state (data-busy)', () => {
    expect(render(stateAt())).toContain('data-busy="false"');
    expect(render(stateAt(), { busy: true })).toContain('data-busy="true"');
  });

  it('Home renders the hero and NO scaffold (§3: the hero IS the page)', () => {
    const serialized = render(stateAt(), { accountView: 'home' });
    expect(serialized).toContain('class="panel hero"');
    expect(serialized).toContain('Your organization at a glance.');
    expect(serialized).not.toContain('class="page-scaffold"');
  });

  it('the Inbox target renders the inbox panel; Settings renders the theme control', () => {
    const inbox = render(stateAt(), { accountView: 'inbox' });
    expect(inbox).toContain('class="inbox"');
    expect(inbox).toContain('Notifications');
    const settings = render(stateAt(), { accountView: 'settings' });
    expect(settings).toContain('data-action="theme-light"');
    expect(settings).toContain('data-action="theme-dark"');
    expect(settings).toContain('aria-pressed="true"'); // the active theme button
    expect(settings).toContain('data-settings="tenant context"');
    expect(settings).toContain('data-settings="data export"');
  });
});

describe('shell: the composed model keeps T042 pins (regression floor)', () => {
  it('the default render (classic view) opens on the selected section with header + nav + launch panel', () => {
    const serialized = serializeConsoleModel(stateAt(), T0 + 40);
    expect(serialized).toContain('data-section="goal"');
    expect(serialized).toContain('TradRL Console');
    expect(serialized).toContain('data-connection="connecting"');
  });

  it('the main content wrapper is present (the shell-content region)', () => {
    const serialized = render(stateAt());
    expect(serialized).toContain('class="shell-main"');
    expect(serialized).toContain('class="shell-content"');
    expect(serialized).toContain('class="shell-sidebar"');
  });

  it('the content region is a <main> landmark — exactly one per page (J12; the existing landmarks stay)', () => {
    const serialized = render(stateAt());
    expect(serialized).toContain('<main class="shell-main"');
    expect(serialized.match(/<main[\s>]/g)?.length ?? 0).toBe(1);
    // the pre-existing landmarks are untouched: the complementary
    // sidebar, the Primary nav, and the page scaffold's header.
    expect(serialized).toContain('<aside class="shell-sidebar"');
    expect(serialized).toContain('aria-label="Primary"');
    expect(serialized).toContain('class="page-scaffold"');
  });

  it('the Time Machine bar still renders inside the shell (T042 law)', () => {
    const serialized = render(stateAt());
    expect(serialized).toContain('class="timemachine"');
  });
});

// ---------------------------------------------------------------------------
// W-19: the pricing disclosure (the S5 CFO finding — "zero pricing
// information") + the R8 interaction supplement (the nav hit-area laws).
// ---------------------------------------------------------------------------

describe('shell: the Settings pricing disclosure (W-19 — the S5 CFO finding)', () => {
  it('Settings carries a Pricing card a user can find without external help', () => {
    const settings = render(stateAt(), { accountView: 'settings' });
    expect(settings).toContain('data-settings="pricing"');
    expect(settings).toContain('Pricing');
  });

  it('the pricing facts are the CURRENT factual state — pilot free, no billing, commercial pricing not published', () => {
    const settings = render(stateAt(), { accountView: 'settings' });
    expect(settings).toContain('pilot access');
    expect(settings).toContain('free');
    expect(settings).toContain('billing today');
    expect(settings).toContain('no payment is collected');
    expect(settings).toContain('commercial pricing');
    expect(settings).toContain('not published yet');
  });

  it('the disclosure fabricates NO numbers — no price, no tier, no percentage anywhere in the card', () => {
    const settings = render(stateAt(), { accountView: 'settings' });
    const card = settings.slice(settings.indexOf('data-settings="pricing"'), settings.indexOf('data-settings="data export"'));
    expect(card.length).toBeGreaterThan(0); // the slice found the card (it sits between pricing and data export)
    // no currency, no per-seat/per-month vocabulary, no digits posing as a price
    expect(card).not.toMatch(/[$€£]\s*\d/);
    expect(card).not.toMatch(/\d+\s*(?:USD|EUR|per month|per seat|\/mo|\/user)/i);
    expect(card).not.toContain('per month');
  });
});

describe('shell: the R8 interaction supplement — the nav hit-area laws (W-19, CSS-as-data)', () => {
  it('the nav paints and hit-tests ABOVE the fixed chrome (brand row, palette affordance, connection zone)', () => {
    expect(SHELL_INTERACTION_CSS).toContain('.shell-nav { position: relative; z-index: 2; }');
    expect(SHELL_INTERACTION_CSS).toContain('.connection-zone { position: relative; z-index: 1; flex: none; }');
    expect(SHELL_INTERACTION_CSS).toContain('.shell-sidebar > .brand-row { position: relative; z-index: 1; }');
    expect(SHELL_INTERACTION_CSS).toContain('.shell-sidebar > .palette-affordance { position: relative; z-index: 1; }');
  });

  it('the connection popover can never explode over the nav: its facts stack and its height clamps with its own scroll', () => {
    // The live-browser diagnosis: the popover's `.fact` rows are 11rem+1fr on
    // a ~208px tile — a long degradation line wrapped to ~666px tall and the
    // open tile grew to ~1108px, covering the ENTIRE nav (measured at
    // 1280×720; a Goal nav click was refused as "covered by
    // <details.connection-tile>" — the Phase-2 R8 report, 22 friction rows).
    expect(SHELL_INTERACTION_CSS).toContain('.connection-popover .fact { grid-template-columns: 1fr; gap: 2px; }');
    expect(SHELL_INTERACTION_CSS).toContain('.connection-popover { max-height: 40vh; overflow-y: auto; }');
  });

  it('the supplement is additive layering/geometry only — it repaints nothing and moves no charter rule', () => {
    // No rule may touch paint (color/background/border) or reposition the
    // charter layout beyond stacking context + the popover's own box.
    for (const banned of ['color:', 'background:', 'border:', 'display: none', 'position: fixed', 'position: absolute', 'transform:']) {
      expect(SHELL_INTERACTION_CSS, `the supplement must not carry ${banned}`).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// FW-36-B (Round E register E-8, part 3) — THE NAV BELL'S DEMO MARKER. The
// shared demo project's notices badge the fresh session's bell unmarked (L3's
// exact finding: "Inbox — 13 unread notices" read as the user's own world);
// the bell now carries the quiet DEMO chip whenever the workspace scopes to
// the teaching desk — the sidebar env-badge's own pattern, extended.
// ---------------------------------------------------------------------------

describe('shell: FW-36-B (E-8, part 3) — the nav bell DEMO marker', () => {
  /** A workspace state scoped to the shared demo project (the fresh session's first world). */
  function demoScopeState(): WorkspaceState {
    return stateAt([], 'goal');
  }

  it('the DEMO-scope bell carries the DEMO chip and the aria-label names the shared demo project — the chip is absent on every other scope', () => {
    const demoScope = { tenantId: 'tenant-a', projectId: 'prj-demo-console' } as const;
    const demoState = reduceAll(openWorkspace(demoScope, T0), [] as readonly WorkspaceEvent[]);
    const demoBytes = render(demoState);
    expect(demoBytes).toContain('class="demo-flag bell-demo" data-demo="true"'); // the chip
    expect(demoBytes).toContain('>DEMO<');
    expect(demoBytes).toContain('aria-label="Inbox — no unread notices (the shared demo project)"');

    const ownBytes = render(demoScopeState()); // proj-a — a real desk
    expect(ownBytes).not.toContain('data-demo="true"');
    expect(ownBytes).toContain('aria-label="Inbox — no unread notices"');
  });

  it('the marker rides the composed render (renderConsoleModel), not only the shell helper — the whole console discloses it', () => {
    const demoScope = { tenantId: 'tenant-a', projectId: 'prj-demo-console' } as const;
    const demoState = reduceAll(openWorkspace(demoScope, T0), [] as readonly WorkspaceEvent[]);
    const bytes = serializeVNode(renderConsoleModel(demoState, T0 + 40));
    expect(bytes).toContain('data-demo="true"');
  });
});
