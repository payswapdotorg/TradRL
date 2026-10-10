// Tests for FW-38-B (Round G register G-7 + G-10) — THE AFFORDANCE-REACH
// LAWS (CSS-as-data, the tokens.test.ts / sidebar-layout.test.ts pattern:
// the harness has no layout engine, so the geometry is pinned as
// stylesheet laws + rendered structure; G-7's sticky law was verified
// LIVE on the deployed console before it was pinned here).
//
// G-7 (3-6/6 launches, the round's highest-frequency friction): the
// wizard's "Next: <step>" click silently no-oped on the FIRST click.
// THE ROOT CAUSE (reproduced 5/5 live, headless 1280x577, the deployed
// console): the action row sits at the END of a long card; when the card
// straddles the fold the button's click point sits BELOW the viewport —
// a click there resolves to the inert root (<html>: every captured
// mousedown/mouseup/click carried target HTML, connected), and the
// delegated resolver, rightly, finds no affordance: no press captured,
// no dispatch, step unchanged, no error, nothing disabled. THE LAW
// PINNED: the primary flow's action rows are STICKY within the wizard
// card (bottom-anchored) — whenever any part of the card is on screen
// its actions are IN the viewport, so the click point can never sit
// below the fold. Verified live: with the rule injected, the same
// find-text click from the same fold-straddling scroll resolved to
// BUTTON.tm-button[launch-step-world] and advanced the step.
//
// G-10 (7 personas): the job sheet's fixed backdrop (z-index 40, inset 0)
// covered the whole viewport INCLUDING the nav rail (z-index 20) — every
// nav click while a sheet was open hit the backdrop, closed the sheet,
// and navigated NOWHERE (a second click was needed). THE LAW PINNED: the
// desktop rail sits ABOVE the backdrop (45 — between the sheet 41 and
// the toasts 60; the rail never overlaps the sheet itself on any
// >=768px viewport), the mobile drawer keeps its pre-change stacking
// (20 — the sheet is full-width there), and the backdrop's own geometry
// is UNTOUCHED (fixed, inset 0, 40 — the click-outside-to-close law
// holds). The nav handler's half of the law (one click navigates AND
// closes the sheet) is pinned in app/console-interactions.test.ts.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

/** One @media block's inner CSS (the prelude matched by prefix, e.g. '(max-width: 767px)'). */
function mediaBlockCss(css: string, prelude: string): string {
  const marker = `@media ${prelude}`;
  const at = css.indexOf(marker);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  if (open < 0) return '';
  let depth = 1;
  let scan = open + 1;
  while (scan < css.length && depth > 0) {
    if (css[scan] === '{') depth += 1;
    else if (css[scan] === '}') depth -= 1;
    scan += 1;
  }
  return css.slice(open + 1, scan - 1);
}

const TOP_LEVEL_RULES = parseRules(topLevelCss(SHELL_CSS));
const MOBILE_RULES = parseRules(mediaBlockCss(SHELL_CSS, '(max-width: 767px)'));

/** The first TOP-LEVEL rule for a selector (the charter's desktop law). */
function topLevelRuleFor(selector: string): Rule | undefined {
  return TOP_LEVEL_RULES.find((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector));
}

/** The z-index a rule's body declares (null when none). */
function zIndexOf(rule: Rule | undefined): number | null {
  if (rule === undefined) return null;
  const match = /z-index:\s*(\d+)/.exec(rule.body);
  return match === null ? null : Number(match[1]);
}

describe('FW-38-B (G-7): the primary flow\'s action rows RIDE THE FOLD (the below-fold click point can never no-op)', () => {
  it('the wizard\'s action affordances are sticky-anchored to the fold: the Next/Review row, the arm button and the armed confirm row', () => {
    // the comma-group rule carries all three selectors — assert the group itself
    const group = TOP_LEVEL_RULES.find((rule) => rule.selector.includes('.launch-wizard .tm-playback') && rule.selector.includes('.launch-wizard .confirm-arm') && rule.selector.includes('.launch-wizard .confirm-inline'));
    expect(group, 'the sticky rule covers the Next/Review row AND the arm button AND the armed confirm row').toBeDefined();
    expect(group?.body).toContain('position: sticky');
    expect(group?.body).toContain('bottom: 12px');
    expect(group?.body).toContain('z-index: 5');
    // the row's own chrome rule (the single-selector follow-up): an opaque
    // card background, so the fields scrolling under the pinned row never
    // show through its gaps
    const chrome = TOP_LEVEL_RULES.find((rule) => rule.selector.trim() === '.launch-wizard .tm-playback');
    expect(chrome, 'the pinned row carries its own opaque chrome').toBeDefined();
    expect(chrome?.body).toContain('background: var(--card)');
    expect(chrome?.body).toContain('border: 1px solid var(--border)');
  });

  it('the plain (non-wizard) Time Machine playback row is UNTOUCHED — the sticky law is scoped to the wizard card only', () => {
    const tmPlayback = topLevelRuleFor('.tm-playback');
    expect(tmPlayback).toBeDefined();
    expect(tmPlayback?.body).not.toMatch(/position:\s*sticky/); // the TM bar's own controls keep their in-flow law
  });
});

describe('FW-38-B (G-10): the nav rail stays reachable while a sheet is open (the backdrop never covers the rail)', () => {
  it('the desktop rail sits ABOVE the sheet backdrop and BELOW the toasts — z-index 45, never again 20', () => {
    const sidebar = topLevelRuleFor('.shell-sidebar');
    expect(sidebar).toBeDefined();
    expect(zIndexOf(sidebar)).toBe(45); // above the backdrop (40), below the toasts (60)
    const backdrop = topLevelRuleFor('.sheet-backdrop');
    expect(zIndexOf(backdrop)).toBe(40);
    const toasts = topLevelRuleFor('.toast-stack');
    expect(zIndexOf(toasts)).toBe(60);
    expect(zIndexOf(backdrop) ?? 0).toBeLessThan(zIndexOf(sidebar) ?? 0);
    expect(zIndexOf(sidebar) ?? 0).toBeLessThan(zIndexOf(toasts) ?? 1);
  });

  it('the backdrop\'s own geometry is UNTOUCHED — fixed, inset 0 (the click-outside-to-close law holds exactly as before)', () => {
    const backdrop = topLevelRuleFor('.sheet-backdrop');
    expect(backdrop).toBeDefined();
    expect(backdrop?.body).toContain('position: fixed');
    expect(backdrop?.body).toContain('inset: 0');
  });

  it('the mobile drawer keeps its pre-change stacking — z-index 20 under the sheet pair (the lift is a DESKTOP law)', () => {
    const mobileSidebar = MOBILE_RULES.find((rule) => rule.selector.split(',').map((part) => part.trim()).includes('.shell-sidebar'));
    expect(mobileSidebar, 'the <768px block restates the sidebar rule').toBeDefined();
    expect(zIndexOf(mobileSidebar)).toBe(20);
  });
});
