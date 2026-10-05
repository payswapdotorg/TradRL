// @tradrl/web-console — THE APP SHELL RENDER (UX-DESIGN.md §2/§3, T051).
//
// THE CHARTER: the `.tradrl-shell` root wrapper; the fixed 256px
// sidebar (brand row, the four charter nav groups with all fifteen
// targets, the bottom CONNECTION status block + environment badge);
// the mobile sticky header + slide-in drawer; and every section's
// page scaffold (H1 + one-sentence muted subtitle + status badge +
// right-aligned actions with the ghost icon-only Refresh).
//
// This module is PURE VNode data (render/model.ts composes it inside
// the wall-clock render guard): same (state, viewAt, view) ->
// identical serialized bytes. It owns NO laws of the workspace — the
// section panels and their availability/scope/verdict gates stay in
// render/model.ts, untouched; the shell is chrome around them.
//
// Connection states (§1.3, never color alone — always dot + label):
//   LIVE teal (steady) / DEGRADED amber (steady) / UNREACHABLE rose /
//   CONNECTING neutral (gentle pulse, reduced-motion disabled).

import type { ConnectionStatus, WorkspaceState } from '../core/workspace';
import { unreadCount } from '../core/notices';
import type { ThemeName } from '../core/theme';
import { NAV_GROUPS, SHELL_SUBTITLES, SHELL_TITLES, isSectionTarget, type ShellTarget } from '../core/nav';
import { formatInstantUtc } from '../core/format';
import { notificationBell, toastRecord } from './flow';
import { paletteAffordance, paletteOverlay } from '../core/palette';
import { onboardingPanel, onboardingReopenAffordance, type OnboardingState } from '../core/onboarding';
import { v, type VNode } from './vtree';

/** The shell's view state — everything the chrome renders that is not workspace state. */
export interface ShellView {
  /** The active theme (charter §1: light default, dark alternate). */
  readonly theme: ThemeName;
  /** The non-section landing target: home, inbox or settings ('section' = the workspace's selected section). */
  readonly accountView: 'home' | 'inbox' | 'settings' | 'section';
  /** The API endpoint the console talks to (shown in Settings + the connection popover). */
  readonly endpoint: string;
  /** True when the console runs on a fake/demo adapter (the SIMULATED environment badge + section badge). */
  readonly simulated: boolean;
  /** True while a refresh is in flight (the Refresh button's spinning state). */
  readonly busy: boolean;
  /** True while the mobile drawer is open. */
  readonly drawerOpen: boolean;
  /** The open detail sheet (§4.5a): a job or an organization snapshot. */
  readonly sheet: SheetRef | null;
  /** The command palette's state (§4.14): closed, or its query + selection. */
  readonly palette: { readonly query: string; readonly selected: number } | null;
  /** The onboarding wizard's state (§4.13): null = not showing (returning users). */
  readonly onboarding: OnboardingState | null;
  /** The newest notice to toast (§4.10; the app layer owns the ~5s timer). */
  readonly toast: { readonly kind: string; readonly title: string; readonly sentence: string } | null;
  /** The armed two-step confirm (§4.11): 'launch' when the launch confirm is armed. */
  readonly confirm: 'launch' | null;
  /** The launch form's touched field names (§4.11 — inline validation renders only after blur). */
  readonly touchedFields: readonly string[];
  /** The launch form's PENDING edits (the J3 wiring): field -> the last typed string, not yet committed into the state machine — the render merges them so a re-render never reverts the user's text. */
  readonly launchEdits: Readonly<Record<string, string>>;
  /** The inline-opened evidence capsule (§4.9): its data-capsule ref, or null. */
  readonly openCapsule: string | null;
}

/** A reference to the record a detail sheet shows (§4.5a). */
export interface SheetRef {
  /** The record family: a job or an organization snapshot. */
  readonly kind: 'job' | 'snapshot';
  /** The record's id (jobId / organizationRef). */
  readonly id: string;
}

/** Parse a data-row payload into a sheet reference (null when unknown). */
export function parseSheetRef(rowId: string): SheetRef | null {
  const separator = rowId.indexOf(':');
  if (separator <= 0) return null;
  const kind = rowId.slice(0, separator);
  const id = rowId.slice(separator + 1);
  if (id.length === 0) return null;
  if (kind === 'job') return { kind: 'job', id };
  if (kind === 'snapshot') return { kind: 'snapshot', id };
  return null;
}

/** The default shell view: light theme, the workspace's own selected section, no endpoint, not simulated, idle. */
export function defaultShellView(state: WorkspaceState): ShellView {
  void state;
  return { theme: 'light', accountView: 'section', endpoint: '', simulated: false, busy: false, drawerOpen: false, sheet: null, palette: null, onboarding: null, toast: null, confirm: null, touchedFields: [], launchEdits: {}, openCapsule: null };
}

/** Resolve the active target: the account view when set, else the workspace's selected section. */
export function activeTargetOf(state: WorkspaceState, view: ShellView): ShellTarget {
  return view.accountView === 'section' ? state.selectedSection : view.accountView;
}

/** The connection classes (§1.3's vocabulary). */
export type ConnectionClass = 'live' | 'warn' | 'down' | 'idle';

/** Map the API connection status to its connection class (§1.3). */
export function connectionClassOf(status: ConnectionStatus): ConnectionClass {
  if (status === 'connected') return 'live';
  if (status === 'degraded') return 'warn';
  if (status === 'offline') return 'down';
  return 'idle';
}

/** The connection state labels (never color alone — the label is the contract). */
export const CONNECTION_STATE_LABELS: Readonly<Record<ConnectionClass, string>> = Object.freeze({
  live: 'LIVE',
  warn: 'DEGRADED',
  down: 'UNREACHABLE',
  idle: 'CONNECTING',
});

/** The section status badge (§3): LIVE teal / SIMULATED amber / READ-ONLY neutral outline. */
export type SectionBadge = 'LIVE' | 'SIMULATED' | 'READ-ONLY';

/** Resolve the section badge: simulated is always labeled (anti-deception, §7). */
export function sectionBadgeOf(view: ShellView, status: ConnectionStatus): SectionBadge {
  if (view.simulated) return 'SIMULATED';
  if (status === 'connected') return 'LIVE';
  return 'READ-ONLY';
}

/** The badge's style key (lowercase class fragment). */
export function badgeClassOf(badge: SectionBadge): string {
  if (badge === 'LIVE') return 'live';
  if (badge === 'SIMULATED') return 'simulated';
  return 'readonly';
}

/** One fact row (the shell's own chrome copy of the model's fact row). */
function shellFactRow(label: string, value: string): VNode {
  return v('div', { class: 'fact' }, [
    v('span', { class: 'fact-label' }, [label]),
    v('span', { class: 'fact-value' }, [value]),
  ]);
}

/** A hand-authored 16px line icon (stroke = currentColor; active weight via CSS). */
function icon(paths: readonly VNode[], extraClass = 'nav-icon'): VNode {
  return v('svg', {
    class: extraClass,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, paths);
}

const P = (d: string): VNode => v('path', { d }, []);
const C = (cx: string, cy: string, r: string): VNode => v('circle', { cx, cy, r }, []);

/** The nav glyph of every target (simple, calm, geometric — the ShareNet line language). */
function navGlyphOf(target: ShellTarget): VNode {
  if (target === 'home') return icon([P('M4 11 12 4l8 7v9h-5.5v-6h-5v6H4Z')]);
  if (target === 'goal') return icon([C('12', '12', '8.25'), C('12', '12', '4'), v('circle', { cx: '12', cy: '12', r: '0.9', fill: 'currentColor', stroke: 'none' }, [])]);
  if (target === 'organization') return icon([C('6.5', '7', '2.6'), C('17.5', '7', '2.6'), C('12', '17', '2.6'), P('M8.7 8.6 10.9 14.7M15.3 8.6 13.1 14.7M9.1 7h5.8')]);
  if (target === 'market-world') return icon([C('12', '12', '8.25'), P('M3.75 12h16.5M12 3.75c3.8 3.6 3.8 12.9 0 16.5-3.8-3.6-3.8-12.9 0-16.5Z')]);
  if (target === 'time-machine') return icon([C('12', '12', '8.25'), P('M12 7.25V12l3.25 2.25')]);
  if (target === 'research') return icon([C('10.75', '10.75', '6.25'), P('M15.5 15.5 20.25 20.25')]);
  if (target === 'experiments') return icon([P('M10 3.5h4M11 3.5v5.2L5.6 18.4A1.6 1.6 0 0 0 7 20.5h10a1.6 1.6 0 0 0 1.4-2.1L13 8.7V3.5M8.2 14.5h7.6')]);
  if (target === 'decisions') return icon([P('M6.5 4.5V19.5M6.5 9.5h3.4c1.6 0 2.6.7 3.6 2.3 1.2 1.9 2.4 3 5 3.2M15.5 13.2 18.5 15l-3 1.8')]);
  if (target === 'execution') return icon([P('M8.25 5.5 18.5 12 8.25 18.5Z')]);
  if (target === 'risk') return icon([P('M12 3.5 19 6v5.2c0 4.8-2.9 8.1-7 9.3-4.1-1.2-7-4.5-7-9.3V6Z'), P('M9.2 12.2l2 2 3.6-3.8')]);
  if (target === 'evidence') return icon([v('rect', { x: '4', y: '7', width: '16', height: '11', rx: '3.5' }, []), P('M4 11.5h16')]);
  if (target === 'outcomes') return icon([P('M4.5 20h15M7.5 20v-6M12 20V9.5M16.5 20v-9.5')]);
  if (target === 'lessons') return icon([P('M5 4.5h4.5A2.5 2.5 0 0 1 12 7a2.5 2.5 0 0 1 2.5-2.5H19v14h-4.5A2.5 2.5 0 0 0 12 21a2.5 2.5 0 0 0-2.5-2.5H5Z'), P('M12 7v14')]);
  if (target === 'inbox') return icon([P('M7 16v-4.5a5 5 0 0 1 10 0V16l1.75 2.75H5.25Z'), P('M10.25 20.25a2 2 0 0 0 3.5 0')]);
  return icon([P('M4.5 7.25h15M4.5 12h15M4.5 16.75h15'), C('9.5', '7.25', '2'), C('14.5', '12', '2'), C('8.5', '16.75', '2')]);
}

/** The brand mark (the white 16px glyph inside the primary tile). */
function brandMark(): VNode {
  return icon([P('M7 8.5h10M12 8.5V19M8.5 19h7')], 'brand-mark nav-icon');
}

/** The menu glyph (the mobile drawer's button). */
function menuMark(): VNode {
  return icon([P('M4 7h16M4 12h16M4 17h16')], 'menu-icon nav-icon');
}

/** The refresh glyph (the scaffold's ghost icon-only action). */
function refreshMark(): VNode {
  return icon([P('M20 12a8 8 0 1 1-2.34-5.66'), P('M20 4v4.25h-4.25')]);
}

/** One navigation item (a section item ALSO carries data-section for T042's interaction law; the Inbox item is the §4.10 bell with the unread badge — visible from every page). */
function navItem(target: ShellTarget, active: boolean, unread: number): VNode {
  if (target === 'inbox') return notificationBell(unread);
  const attrs: Record<string, string> = {
    class: `nav-item${active ? ' active' : ''}`,
    'data-target': target,
    type: 'button',
  };
  if (isSectionTarget(target)) attrs['data-section'] = target;
  if (active) attrs['aria-current'] = 'page';
  return v('button', attrs, [navGlyphOf(target), v('span', { class: 'nav-item-label' }, [SHELL_TITLES[target]])]);
}

/** The grouped navigation (aria-label="Primary", the four charter groups in order; the bell carries the unread count). */
function shellNav(activeTarget: ShellTarget, unread: number): VNode {
  return v('nav', { class: 'shell-nav', 'aria-label': 'Primary' }, NAV_GROUPS.map((group) => v('div', { class: 'nav-group', 'data-nav-group': group.label }, [
    v('div', { class: 'nav-group-label' }, [group.label]),
    ...group.targets.map((target) => navItem(target, target === activeTarget, unread)),
  ])));
}

/** The latest degraded read note (the degradation reason), or null. */
function latestDegraded(state: WorkspaceState): { readonly route: string; readonly message: string } | null {
  if (state.degraded.length === 0) return null;
  const latest = state.degraded[state.degraded.length - 1] as { readonly route: string; readonly message: string };
  return { route: latest.route, message: latest.message };
}

/** The one detail line under the connection state (the loading skeleton while connecting). */
function connectionDetail(status: ConnectionStatus, state: WorkspaceState): VNode {
  if (status === 'connecting') return v('span', { class: 'conn-skeleton', 'aria-label': 'connecting' }, []);
  const degraded = latestDegraded(state);
  if (status === 'degraded' && degraded !== null) {
    return v('span', { class: 'conn-detail degraded' }, [`last failed read: ${degraded.route}`]);
  }
  if (status === 'offline') return v('span', { class: 'conn-detail degraded' }, ['the API is unreachable']);
  if (status === 'degraded') return v('span', { class: 'conn-detail degraded' }, ['a read failed; showing the last known world']);
  return v('span', { class: 'conn-detail' }, ['API reachable']);
}

/** The CONNECTION status block (sidebar bottom) + environment badge (§2). */
function connectionZone(state: WorkspaceState, view: ShellView, at: number): VNode {
  const cls = connectionClassOf(state.connection);
  const degraded = latestDegraded(state);
  return v('div', { class: 'connection-zone' }, [
    v('details', { class: 'connection-tile' }, [
      v('summary', { class: 'connection-summary', 'data-action': 'connection-details' }, [
        v('span', { class: 'connection-label' }, ['CONNECTION']),
        v('span', { class: `conn-state conn-${cls} connection-${state.connection}` }, [
          v('span', { class: `conn-dot conn-dot-${cls}` }, []),
          v('span', { class: 'conn-state-label' }, [CONNECTION_STATE_LABELS[cls]]),
        ]),
        connectionDetail(state.connection, state),
      ]),
      v('div', { class: 'connection-popover' }, [
        shellFactRow('endpoint', view.endpoint.length > 0 ? view.endpoint : 'not configured'),
        shellFactRow('last poll', formatInstantUtc(at)),
        shellFactRow('degradation', degraded === null ? 'none' : `${degraded.route} — ${degraded.message}`),
        v('button', { class: 'connection-retry', 'data-action': 'refresh', type: 'button' }, ['Retry connection']),
      ]),
    ]),
    v('div', { class: `env-badge ${view.simulated ? 'env-simulated' : 'env-live'}` }, [view.simulated ? 'SIMULATED · demo data' : 'LIVE']),
  ]);
}

/** The mobile sticky header (brand + connection indicator + menu button). */
function shellHeader(state: WorkspaceState, view: ShellView): VNode {
  const cls = connectionClassOf(state.connection);
  return v('header', { class: 'shell-header' }, [
    v('button', { class: 'brand-row', 'data-target': 'home', type: 'button', 'aria-label': 'TradRL Console' }, [
      v('span', { class: 'brand-tile' }, [brandMark()]),
      v('span', { class: 'brand-word' }, ['TradRL']),
    ]),
    v('span', { class: `header-conn conn-${cls} connection-${state.connection}` }, [
      v('span', { class: `conn-dot conn-dot-sm conn-dot-${cls}` }, []),
      v('span', { class: 'header-conn-label' }, [CONNECTION_STATE_LABELS[cls]]),
    ]),
    v('button', { class: 'menu-button', 'data-action': 'drawer-open', type: 'button', 'aria-label': 'Open navigation', 'aria-expanded': view.drawerOpen ? 'true' : 'false' }, [menuMark()]),
  ]);
}

/** The standard page scaffold header (§3) — every section but Home. */
function pageScaffold(target: ShellTarget, state: WorkspaceState, view: ShellView): VNode {
  const badge = sectionBadgeOf(view, state.connection);
  return v('header', { class: 'page-scaffold', 'data-scaffold': target }, [
    v('div', { class: 'page-heading' }, [
      v('h1', { class: 'page-title' }, [SHELL_TITLES[target]]),
      v('p', { class: 'page-subtitle' }, [SHELL_SUBTITLES[target]]),
    ]),
    v('div', { class: 'page-actions' }, [
      v('span', { class: `status-badge badge-${badgeClassOf(badge)}` }, [badge]),
      v('button', {
        class: 'icon-button refresh',
        'data-action': 'refresh',
        'data-busy': view.busy ? 'true' : 'false',
        type: 'button',
        'aria-label': `Refresh ${SHELL_TITLES[target]}`,
        title: 'Refresh',
      }, [refreshMark()]),
    ]),
  ]);
}

/** The Home hero (§3: Home has no header — the hero IS the page). */
export function heroPanel(cta?: VNode): VNode {
  return v('section', { class: 'panel hero', 'data-section': 'home' }, [
    v('p', { class: 'hero-eyebrow' }, ['TradRL Console']),
    v('h1', { class: 'hero-title' }, ['Your organization at a glance.']),
    v('p', { class: 'hero-lede' }, ['Set a goal, watch the organization work, and audit every decision.']),
    // THE J3 ENTRY's third affordance (the natural starting point): the
    // primary flow's first action lives IN the hero — the onboarding's
    // step-3 copy says "Start by describing a goal", and Home is where
    // a first-run user lands. A delegated action, never a nav target.
    ...(cta === undefined ? [] : [cta]),
  ]);
}

/** One Settings row: a title + plain-language description + the value/control (D7 — every row explains itself). */
function settingsRow(title: string, description: string, body: readonly VNode[]): VNode {
  return v('div', { class: 'card settings-row', 'data-settings': title.toLowerCase() }, [
    v('div', { class: 'card-title' }, [title]),
    v('p', { class: 'card-note' }, [description]),
    ...body,
  ]);
}

export function settingsPanel(state: WorkspaceState, view: ShellView): VNode {
  return v('section', { class: 'panel', 'data-section': 'settings' }, [
    // D7 row 1 — theme (with the persistence seam write-through)
    settingsRow('Theme', 'Choose light or dark; your choice is remembered for future visits.', [
      v('div', { class: 'segmented' }, [
        v('button', { class: 'segment', 'data-action': 'theme-light', type: 'button', 'aria-pressed': view.theme === 'light' ? 'true' : 'false' }, ['Light']),
        v('button', { class: 'segment', 'data-action': 'theme-dark', type: 'button', 'aria-pressed': view.theme === 'dark' ? 'true' : 'false' }, ['Dark']),
      ]),
    ]),
    // D7 row 2 — API endpoint (shown, plain-language)
    settingsRow('API endpoint', 'The address the console reads your organization from — every section fetches from here.', [
      shellFactRow('endpoint', view.endpoint.length > 0 ? view.endpoint : 'not configured'),
      shellFactRow('state', CONNECTION_STATE_LABELS[connectionClassOf(state.connection)]),
    ]),
    // D7 row 3 — tenant context (shown, plain-language)
    settingsRow('Tenant context', 'Your workspace is scoped to this tenant and project; every read and every record stays inside it.', [
      shellFactRow('tenant', state.scope.tenantId),
      shellFactRow('project', state.scope.projectId),
    ]),
    // D7 row 4 — data export (an action that works: the deterministic serialized workspace record)
    settingsRow('Data export', 'Download everything the console currently knows about this workspace, as a JSON file.', [
      v('button', { class: 'connection-retry', 'data-action': 'export-workspace', type: 'button' }, ['Export workspace data']),
    ]),
    // §4.13 the "?" affordance — re-opens the guided intro
    settingsRow('Guided intro', 'Show the three-step introduction to how the console works.', [
      onboardingReopenAffordance(),
    ]),
  ]);
}

/**
 * The composed shell: root wrapper, mobile header, drawer backdrop, sidebar, main content, the open sheet.
 *
 * THE DELEGATION LAW (the W-10b fix): the root carries the active
 * target as `data-active-target` — a STATE MARKER, never the
 * delegated-navigation vocabulary. `data-target` belongs EXCLUSIVELY
 * to the interactive affordance buttons (nav items, the brand rows,
 * the bell, palette items, empty-state actions): app/console.ts's
 * delegated click handler resolves `closest('[data-target]')` for
 * navigation, and every element in the console descends from this
 * root — when T051 put a bare `data-target` on the root, EVERY click
 * in the console was intercepted as a navigation to the active
 * target and returned before any [data-action] branch could run (the
 * J1 hard block: the onboarding wizard was unclickable, silently).
 */
export function renderAppShell(
  state: WorkspaceState,
  at: number,
  view: ShellView,
  activeTarget: ShellTarget,
  content: { readonly timeMachine: VNode; readonly main: VNode | null; readonly launch: VNode | null; readonly sheet: readonly VNode[]; readonly paletteResults: readonly import('../core/palette').PaletteEntry[] },
): VNode {
  return v('div', {
    class: 'tradrl-shell console',
    'data-theme': view.theme,
    'data-connection': state.connection,
    'data-rendered-at': String(at),
    'data-active-target': activeTarget,
    'data-drawer': view.drawerOpen ? 'open' : 'closed',
    'data-simulated': view.simulated ? 'true' : 'false',
    'data-sheet': view.sheet === null ? 'closed' : `${view.sheet.kind}:${view.sheet.id}`,
  }, [
    shellHeader(state, view),
    v('button', { class: 'drawer-backdrop', 'data-action': 'drawer-close', type: 'button', 'aria-label': 'Close navigation' }, []),
    v('aside', { class: 'shell-sidebar' }, [
      v('button', { class: 'brand-row', 'data-target': 'home', type: 'button', 'aria-label': 'TradRL Console' }, [
        v('span', { class: 'brand-tile' }, [brandMark()]),
        v('span', { class: 'brand-word' }, ['TradRL']),
      ]),
      paletteAffordance(),
      shellNav(activeTarget, unreadCount(state.inbox)),
      connectionZone(state, view, at),
    ]),
    v('div', { class: 'shell-main' }, [
      v('div', { class: 'shell-content' }, [
        ...(activeTarget === 'home' ? [] : [pageScaffold(activeTarget, state, view)]),
        content.timeMachine,
        ...(content.main === null ? [] : [content.main]),
        ...(content.launch === null ? [] : [content.launch]),
      ]),
    ]),
    // §4.14 the palette overlay (the app layer owns keys + Enter)
    ...(view.palette === null ? [] : [paletteOverlay({ query: view.palette.query, results: content.paletteResults, selected: view.palette.selected, unread: unreadCount(state.inbox) })]),
    // §4.13 the onboarding wizard — THE ONE COPY: the fixed-position
    // modal overlay directly under the shell root (render/model.ts
    // renders the main content normally behind it; it never renders
    // the wizard — the T051 double render put one copy inside
    // .shell-content too, and both froze at step one).
    ...(view.onboarding === null ? [] : [onboardingPanel(view.onboarding)]),
    // §4.10 the toast (top-right, ~5s auto-dismiss owned by the app layer)
    ...(view.toast === null ? [] : [toastRecord(view.toast.kind as 'failed_evaluation', view.toast.title, view.toast.sentence)]),
    ...content.sheet,
  ]);
}
