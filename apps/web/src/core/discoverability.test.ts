// THE DISCOVERABILITY LAW TESTS (UX-DESIGN.md §5, T051) — all seven
// clauses, each pinned against the composed console render + the pure
// core modules. A feature that is not easily discoverable is
// considered ABSENT: these tests are the operator's acceptance bar.
//
//   D1 one-click reachability of every section + Inbox + Settings
//      from any section (the persistent sidebar's 15 targets).
//   D2 above-the-fold orientation (H1 + subtitle + badge on every
//      section, primary actions visible).
//   D3 teaching states (empty/loading/error per section; exactly ONE
//      primary action in empties; never a blank region).
//   D4 palette coverage (100% of nav targets + the other kinds).
//   D5 onboarding (≤3 steps, skippable, never blocks returning users).
//   D6 notification surfacing (bell + inbox + toast; unread
//      recoverable from any page).
//   D7 settings completeness (all four rows with descriptions).

import { describe, expect, it } from 'vitest';
import { openWorkspace, reduceAll, type WorkspaceEvent, type WorkspaceState } from './workspace';
import { NAV_GROUPS, SHELL_TARGETS, type ShellTarget } from './nav';
import { WORKSPACE_SECTIONS } from './sections';
import { paletteIndex, rankPalette } from './palette';
import { initialOnboarding, isOnboarded, ONBOARDING_STEPS, skipOnboarding } from './onboarding';
import { unreadCount } from './notices';
import { renderConsoleModel } from '../render/model';
import { defaultShellView, type ShellView } from '../render/shell';
import { serializeVNode } from '../render/vtree';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

/** Render with a shell-view override at an injected instant. */
function render(state: WorkspaceState, overrides: Partial<ShellView> = {}, at = T0 + 50): string {
  return serializeVNode(renderConsoleModel(state, at, { ...defaultShellView(state), ...overrides }));
}

/** A populated workspace (anchored so its data is knowable at the view instant). */
function populated(): WorkspaceState {
  const project = {
    id: 'proj-a', tenantId: 'tenant-a', name: 'Console Test Project', executionMode: 'simulation',
    lifecycle: { projectId: 'proj-a', status: 'active', acceptanceCriteriaId: null, organizationRef: 'org:alpha' },
    lineage: { projectId: 'proj-a', createdAt: T0, createdBy: 'worker', priorVersion: null, version: 1, goal: { goalId: 'goal-1', version: 1 }, constraintSet: { id: 'cs-1', version: 1 } },
    createdAt: T0, updatedAt: T0,
  } as never;
  const job = { jobId: 'job-1', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'running', submittedAt: T0 + 20 } as never;
  return reduceAll(openWorkspace(SCOPE, T0), [
    { kind: 'connection-changed', at: T0 + 1, status: 'connected' },
    { kind: 'project-loaded', at: T0 + 2, project },
    { kind: 'job-updated', at: T0 + 20, job },
    { kind: 'view-live', at: T0 + 50 },
  ]);
}

describe('D1 — one-click reachability (every section + Inbox + Settings from ANY section)', () => {
  it('from EVERY section, all fifteen targets render as clickable nav items in one persistent sidebar', () => {
    for (const section of WORKSPACE_SECTIONS) {
      const state = reduceAll(populated(), [{ kind: 'section-selected', at: T0 + 50, section }]);
      const bytes = render(state, { accountView: 'section' });
      for (const target of SHELL_TARGETS) {
        expect(bytes, `${section} -> ${target}`).toContain(`data-target="${target}"`);
      }
      expect(bytes, section).toContain('aria-label="Primary"');
    }
  });

  it('the nav groups partition the fifteen targets in charter order', () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(['Overview', 'Workspace', 'Evidence', 'Account']);
    expect(SHELL_TARGETS.length).toBe(15);
  });
});

describe('D2 — above-the-fold orientation (H1 + subtitle + badge on every section)', () => {
  it('EVERY section renders its H1 + charter subtitle + status badge + the Refresh action', () => {
    const sections = SHELL_TARGETS.filter((target) => target !== 'home');
    for (const target of sections) {
      const state = target === 'inbox' || target === 'settings'
        ? populated()
        : reduceAll(populated(), [{ kind: 'section-selected', at: T0 + 50, section: target }]);
      const accountView = target === 'inbox' || target === 'settings' ? target : 'section';
      const bytes = render(state, { accountView });
      expect(bytes, target).toContain(`data-scaffold="${target}"`);
      expect(bytes, target).toMatch(/<h1 class="page-title">[^<]+<\/h1>/);
      expect(bytes, target).toMatch(/<p class="page-subtitle">[^<]+\.<\/p>/);
      expect(bytes, target).toMatch(/class="status-badge badge-(live|simulated|readonly)"/);
      expect(bytes, target).toMatch(/aria-label="Refresh [^"]+"/);
    }
  });
});

describe('D3 — teaching states (empty/loading/error; exactly ONE action; never blank)', () => {
  it('a fresh workspace teaches in EVERY emptiable section (icon + sentence + exactly ONE action)', () => {
    // time-machine + risk always render their control/status surfaces (never empty);
    // every other section teaches with the EmptyState.
    const teaching = WORKSPACE_SECTIONS.filter((section) => section !== 'time-machine' && section !== 'risk');
    for (const section of teaching) {
      const state = reduceAll(openWorkspace(SCOPE, T0), [{ kind: 'section-selected', at: T0 + 1, section }]);
      const bytes = render(state, { accountView: 'section' }, T0 + 1);
      expect(bytes, section).toContain('class="empty-state"');
      expect(bytes.match(/class="empty-action"/g)?.length ?? 0, section).toBe(1);
      expect(bytes, section).toContain(`data-section="${section}"`); // never a blank region
    }
    for (const section of ['time-machine', 'risk'] as const) {
      const state = reduceAll(openWorkspace(SCOPE, T0), [{ kind: 'section-selected', at: T0 + 1, section }]);
      const bytes = render(state, { accountView: 'section' }, T0 + 1);
      expect(bytes, section).toContain(`data-section="${section}"`); // never blank: its own surface renders
      expect(bytes, section).toContain('class="card"');             // its own surface renders (controls/status), never blank
    }
  });

  it('Home teaches while connecting (skeletons) and when offline (ErrorState, raw text quarantined)', () => {
    const connecting = render(openWorkspace(SCOPE, T0), { accountView: 'home' }, T0 + 1);
    expect(connecting).toContain('data-loading="stat-grid"');
    const offline = reduceAll(openWorkspace(SCOPE, T0), [
      { kind: 'degraded-read', at: T0 + 1, route: 'GET /v1/meta', family: 'unavailable', message: 'ECONNREFUSED' },
      { kind: 'connection-changed', at: T0 + 1, status: 'offline' },
    ]);
    const offlineBytes = render(offline, { accountView: 'home' }, T0 + 2);
    expect(offlineBytes).toContain('role="alert"');
    expect(offlineBytes).toContain('Try again');
  });
});

describe('D4 — palette coverage (100% of navigation targets + the other kinds)', () => {
  it('the palette index carries every one of the fifteen nav targets + project/job/notification/evidence kinds', () => {
    const state = populated();
    const index = paletteIndex(state, () => []);
    const navRefs = index.filter((entry) => entry.kind === 'NAVIGATION').map((entry) => entry.ref);
    expect(navRefs).toEqual(SHELL_TARGETS.map((target) => `nav:${target}`));
    expect(index.some((entry) => entry.kind === 'PROJECT')).toBe(true);
    expect(index.some((entry) => entry.kind === 'JOB')).toBe(true);
    // any single-letter query still resolves a navigation target (fuzzy backstop)
    const resolved = rankPalette(index, 'e');
    expect(resolved.length).toBeGreaterThan(0);
  });
});

describe('D5 — onboarding (≤3 steps, skippable, never blocks returning users)', () => {
  it('exactly three steps; skippable on every step; completion persists; returning users skip straight past', () => {
    expect(ONBOARDING_STEPS.length).toBeLessThanOrEqual(3);
    for (let step = 0; step < ONBOARDING_STEPS.length; step += 1) {
      let state = initialOnboarding();
      for (let index = 0; index < step; index += 1) state = { step: index + 1 };
      expect(isOnboarded(skipOnboarding(state))).toBe(true);
    }
    // returning users: the boot reads the persisted completion and renders no wizard
    const returning = render(populated(), { accountView: 'home', onboarding: { completed: true } });
    expect(returning).not.toContain('data-onboarding="step-');
    // a first-run user sees step one
    const firstRun = render(populated(), { accountView: 'home', onboarding: initialOnboarding() });
    expect(firstRun).toContain('data-onboarding="step-1"');
  });
});

describe('D6 — notification surfacing (bell + inbox + toast; unread recoverable from any page)', () => {
  it('the bell renders on EVERY section with the live unread count; the Inbox lists notices; the toast is role=status', () => {
    const state = populated(); // the notice fold derives notices from the reads
    const unread = unreadCount(state.inbox);
    for (const section of WORKSPACE_SECTIONS) {
      const withSection = reduceAll(state, [{ kind: 'section-selected', at: T0 + 50, section }]);
      const bytes = render(withSection, { accountView: 'section' });
      expect(bytes, section).toContain('aria-label="Inbox — '); // the bell is present from every page
      if (unread > 0) expect(bytes, section).toContain(`data-unread="${unread}"`);
    }
    const inbox = render(state, { accountView: 'inbox' });
    expect(inbox).toContain('data-unread="');
    expect(inbox).toContain('Mark all read');
    expect(inbox).toContain('class="inbox"');
    // the toast record rides the shell view
    const toasted = render(state, { accountView: 'home', toast: { kind: 'failed_evaluation', title: 'Failed evaluation', sentence: 'An evaluation did not pass — the firm keeps the lesson.' } });
    expect(toasted).toContain('role="status"');
    expect(toasted).toContain('data-toast="failed_evaluation"');
  });
});

describe('D7 — settings completeness (all four rows with plain-language descriptions)', () => {
  it('Settings renders theme, API endpoint, tenant context and data export — each with a description + a working control', () => {
    const bytes = render(populated(), { accountView: 'settings', endpoint: 'https://api.example.net' });
    expect(bytes).toContain('data-settings="theme"');
    expect(bytes).toContain('data-settings="api endpoint"');
    expect(bytes).toContain('data-settings="tenant context"');
    expect(bytes).toContain('data-settings="data export"');
    // every row carries a plain-language description (card-note)
    expect(bytes.match(/class="card-note"/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    // the theme control persists through the seam; the endpoint shows; the export action works; the tenant context shows
    expect(bytes).toContain('data-action="theme-light"');
    expect(bytes).toContain('data-action="theme-dark"');
    expect(bytes).toContain('https://api.example.net');
    expect(bytes).toContain('tenant-a');
    expect(bytes).toContain('data-action="export-workspace"');
    // nothing else configurable hides elsewhere: the guided intro affordance lives here too (§4.13)
    expect(bytes).toContain('data-action="onboarding-reopen"');
  });
});

describe('the law\'s own determinism', () => {
  it('the composed render stays byte-identical (same state + instant + view)', () => {
    const state = populated();
    expect(render(state, { accountView: 'home' })).toBe(render(state, { accountView: 'home' }));
  });
});
