// Tests for D-10 (W-29) — THE SIDEBAR'S SINGLE-SCROLL GEOMETRY.
//
// The persona findings (M5 at 1280x577, L2 + L5 even at 1440x900): the
// Settings nav button's click point resolved to the sticky CONNECTION
// chip (span.conn-state / details.connection-tile) while
// nav.shell-nav — scrollable in principle (scrollHeight 724 >
// clientHeight 638) — would not scroll (wheel, scrollIntoView,
// keyboard focus+Enter all failed; only Cmd+K reached Settings).
//
// THE ROOT CAUSE: the nav was a flex item (flex: 1 1 auto) with its OWN
// overflow-y: auto INSIDE an also-scrollable sidebar. At every common
// viewport the nav flex-shrunk below its content, so the nav's own
// scroll container clipped its LAST items (the Account group — the
// bell, Settings) under the connection zone's paint area: the clipped
// buttons' click rects landed inside the connection zone, and the
// wheel over the region had nothing to scroll (the sidebar itself fit
// — the nav had absorbed the shrink).
//
// THE LAW PINNED HERE (CSS-as-data, the tokens.test.ts /
// touch-targets.test.ts pattern — the harness has no layout engine,
// so the geometry is pinned as stylesheet laws + rendered structure):
//   - the SIDEBAR is the ONE scroll container (overflow-y: auto +
//     overscroll-behavior: contain — the wheel never chains to the
//     page);
//   - the nav renders at its NATURAL height (flex: none, NO overflow
//     declaration) — its items live in the sidebar's single scroll
//     flow, never clipped beneath a sibling;
//   - the brand row, the search affordance and the connection zone
//     are flex: none — nothing shrinks, nothing grows over content;
//   - neither the nav nor the connection zone is positioned
//     (fixed/absolute/sticky) — in-flow siblings cannot overlap, so
//     the connection chip can never cover a nav item's click point;
//   - the rendered shell carries the in-flow order: brand row, search
//     affordance, nav, connection zone.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openWorkspace, reduceAll, type WorkspaceEvent, type WorkspaceState } from '../core/workspace';
import { renderConsoleModel } from '../render/model';
import { serializeVNode } from '../render/vtree';
import { defaultShellView } from '../render/shell';

const SHELL_CSS = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');

/** One parsed CSS rule (selector + body). */
interface Rule { readonly selector: string; readonly body: string }

/** Parse flat (non-nested) CSS into rules — comments stripped first. */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = /([^{}]+)\{([^}]*)\}/g;
  let match = pattern.exec(stripped);
  while (match !== null) {
    rules.push({ selector: match[1].trim(), body: match[2] });
    match = pattern.exec(stripped);
  }
  return rules;
}

/** The whole stylesheet with every @media block removed (top-level rules only). */
function topLevelCss(css: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < css.length) {
    const at = css.indexOf('@media', cursor);
    if (at < 0) {
      out += css.slice(cursor);
      break;
    }
    out += css.slice(cursor, at);
    const open = css.indexOf('{', at);
    if (open < 0) break;
    let depth = 1;
    let scan = open + 1;
    while (scan < css.length && depth > 0) {
      if (css[scan] === '{') depth += 1;
      else if (css[scan] === '}') depth -= 1;
      scan += 1;
    }
    cursor = scan;
  }
  return out;
}

const TOP_LEVEL_RULES = parseRules(topLevelCss(SHELL_CSS));

/** The first TOP-LEVEL rule for a selector (the charter's desktop law). */
function topLevelRuleFor(selector: string): Rule | undefined {
  return TOP_LEVEL_RULES.find((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector));
}

describe('sidebar layout: D-10 — the single-scroll sidebar (CSS-as-data)', () => {
  it('the SIDEBAR is the one scroll container: overflow-y auto + overscroll containment (the wheel never chains to the page)', () => {
    const sidebar = topLevelRuleFor('.shell-sidebar');
    expect(sidebar).toBeDefined();
    expect(sidebar?.body).toContain('overflow-y: auto');
    expect(sidebar?.body).toContain('overscroll-behavior: contain');
  });

  it('the nav renders at its NATURAL height in the sidebar\'s scroll flow — flex: none and NO overflow declaration (no inner scroll clip)', () => {
    const nav = topLevelRuleFor('.shell-nav');
    expect(nav).toBeDefined();
    expect(nav?.body).toContain('flex: none');
    // the pre-fix law (flex: 1 1 auto + overflow-y: auto) is what clipped
    // the Account group under the connection zone — neither may return
    expect(nav?.body).not.toContain('flex: 1 1 auto');
    expect(nav?.body, 'the nav must not declare its own scroll clip').not.toMatch(/overflow[xy]:/);
  });

  it('the fixed chrome never shrinks or grows over content: brand row, search affordance and connection zone are all flex: none', () => {
    for (const selector of ['.brand-row', '.palette-affordance', '.connection-zone']) {
      const rule = topLevelRuleFor(selector);
      expect(rule, `${selector} has a top-level rule`).toBeDefined();
      expect(rule?.body, `${selector} carries flex: none`).toContain('flex: none');
    }
  });

  it('NEITHER the nav NOR the connection zone is positioned — in-flow siblings cannot overlap (the connection chip can never cover a nav click point)', () => {
    // (.shell-sidebar itself is position: fixed BY THE CHARTER — the fixed
    // 256px column; that is the layout's foundation, not an overlap. The
    // overlap hazard is BETWEEN the sidebar's children: the nav and the
    // connection zone must stay in flow.)
    for (const selector of ['.shell-nav', '.connection-zone']) {
      const rule = topLevelRuleFor(selector);
      expect(rule, `${selector} has a top-level rule`).toBeDefined();
      expect(rule?.body, `${selector} must not carry position: fixed|absolute|sticky`).not.toMatch(/position:\s*(fixed|absolute|sticky)/);
    }
  });

  it('the R8 interaction supplement keeps only additive layering — no geometry rule may fight the charter surface (the D-10 layout half lives in shell.css)', () => {
    // The supplement (render/shell.ts SHELL_INTERACTION_CSS) stays the
    // z-order belt-and-braces; its own test (render/shell.test.ts) pins
    // its content. The charter stylesheet now owns the geometry — the
    // nav's rule here must not re-introduce a stacking context that
    // could defeat the in-flow law above.
    const nav = topLevelRuleFor('.shell-nav');
    expect(nav?.body).not.toContain('z-index');
  });
});

describe('sidebar layout: D-10 — the rendered shell structure (in-flow order)', () => {
  const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
  const T0 = 1_700_000_000_000;

  function stateAt(events: readonly WorkspaceEvent[] = []): WorkspaceState {
    return reduceAll(openWorkspace(SCOPE, T0), events);
  }

  it('the sidebar\'s children render IN FLOW, nav BEFORE the connection zone — the connection chip is never painted over the nav', () => {
    const serialized = serializeVNode(renderConsoleModel(stateAt([{ kind: 'connection-changed', at: T0 + 1, status: 'connected' }]), T0 + 40, { ...defaultShellView(stateAt()), accountView: 'section' }));
    const sidebarStart = serialized.indexOf('<aside class="shell-sidebar"');
    const sidebarEnd = serialized.indexOf('</aside>', sidebarStart);
    expect(sidebarStart).toBeGreaterThanOrEqual(0);
    const sidebar = serialized.slice(sidebarStart, sidebarEnd);
    // the four in-flow blocks, in order (the connection zone FOLLOWS the nav —
    // a later in-flow sibling paints below the fold of the same scroll, never on top)
    const brand = sidebar.indexOf('class="brand-row"');
    const palette = sidebar.indexOf('class="palette-affordance');
    const nav = sidebar.indexOf('class="shell-nav"');
    const connection = sidebar.indexOf('class="connection-zone"');
    for (const [name, index] of [['brand-row', brand], ['palette-affordance', palette], ['shell-nav', nav], ['connection-zone', connection]] as const) {
      expect(index, `${name} renders inside the sidebar`).toBeGreaterThanOrEqual(0);
    }
    expect(brand).toBeLessThan(palette);
    expect(palette).toBeLessThan(nav);
    expect(nav).toBeLessThan(connection);
    // the LAST nav target (Settings, the Account group) renders inside the nav —
    // the D-10 persona's unreachable item is structurally present before the zone
    const settings = sidebar.indexOf('data-target="settings"');
    expect(settings).toBeGreaterThan(nav);
    expect(settings).toBeLessThan(connection);
  });
});
