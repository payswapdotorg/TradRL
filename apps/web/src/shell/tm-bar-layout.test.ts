// Tests for the sticky Time Machine bar's layout law (D-6e, W-25C —
// UX-DESIGN.md §4.8 + the personas' low-viewport finding).
//
// THE DEFECT: on short viewports the sticky TM bar (position: sticky,
// top: 8px, z-index: 10) sat over low-viewport click points — a target
// the keyboard or an anchor navigation scrolled into view landed
// BEHIND the stuck bar, and people had to hunt for a scroll position
// that uncovered it.
//
// Laws pinned here (CSS-as-data, the tokens.test.ts /
// touch-targets.test.ts pattern — the honest testable seam for layout
// in a no-browser vitest run):
//   - the bar STAYS STICKY (§4.8's charter shape is untouched);
//   - the scroll container (html) reserves the bar's stuck height for
//     every programmatic scroll — scroll-padding-top >= the reserve —
//     so a focus/anchor/scrollIntoView target lands BELOW the bar,
//     never behind it;
//   - the reserve token covers the bar's tallest wrapped layout and
//     carries a documented floor;
//   - the mobile reserve adds the sticky 56px header (§2);
//   - the z-index ladder keeps the bar above content but below EVERY
//     overlay (the sheet, the toasts, the palette, the onboarding
//     overlay) — no overlay target can end up trapped under the bar.

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

/** The inner CSS of every `@media (max-width: 767px)` block (brace-matched). */
function mobileBlockBodies(css: string): string {
  const bodies: string[] = [];
  const needle = '@media (max-width: 767px)';
  let index = css.indexOf(needle);
  while (index >= 0) {
    const open = css.indexOf('{', index);
    if (open < 0) break;
    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    bodies.push(css.slice(open + 1, cursor - 1));
    index = css.indexOf(needle, cursor);
  }
  return bodies.join('\n');
}

const TOP_LEVEL_RULES = parseRules(topLevelCss(SHELL_CSS));
const MOBILE_RULES = parseRules(mobileBlockBodies(SHELL_CSS));

/** The first TOP-LEVEL rule for a selector. */
function topLevelRuleFor(selector: string): Rule | undefined {
  return TOP_LEVEL_RULES.find((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector));
}

/** Every mobile rule whose selector list contains the given selector. */
function mobileRulesFor(selector: string): Rule[] {
  return MOBILE_RULES.filter((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector));
}

/** The integer value of the first `<n>px` declaration of a property in a rule body (null when absent). */
function pxOf(body: string, property: string): number | null {
  const match = new RegExp(`${property}:\\s*([0-9]+)px`).exec(body);
  return match === null ? null : Number(match[1]);
}

/** The integer z-index of a rule's body (null when it declares none). */
function zIndexOf(rule: Rule | undefined): number | null {
  if (rule === undefined) return null;
  const match = /z-index:\s*(-?\d+)/.exec(rule.body);
  return match === null ? null : Number(match[1]);
}

describe('the sticky TM bar never permanently covers interactive targets (D-6e)', () => {
  it('the bar STAYS STICKY (§4.8\'s charter shape is untouched)', () => {
    const bar = topLevelRuleFor('.timemachine');
    expect(bar).toBeDefined();
    expect(bar?.body).toContain('position: sticky');
    expect(bar?.body).toContain('top: 8px');
  });

  it('the scroll container reserves the bar\'s stuck height: html scroll-padding-top >= the reserve (+ the 8px top offset)', () => {
    const root = topLevelRuleFor(':root');
    expect(root).toBeDefined();
    const reserve = root !== undefined ? pxOf(root.body, '--tm-bar-reserve') : null;
    expect(reserve).not.toBeNull();
    // The floor: the bar's tallest wrapped layout — the modes row (~26px)
    // + the controls row (~44px, the J12 mobile floor) + the notice line
    // (~18px) + the grid gaps + the 20px padding — pinned at no less
    // than 96px so a wrapped bar can never outgrow the reserve.
    expect(reserve ?? 0).toBeGreaterThanOrEqual(96);

    const html = topLevelRuleFor('html');
    expect(html).toBeDefined();
    expect(html?.body).toContain('scroll-padding-top: calc(var(--tm-bar-reserve) + 8px)');
  });

  it('the MOBILE reserve adds the sticky 56px header (§2) on top of the bar\'s', () => {
    const rules = mobileRulesFor('html');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => rule.body.includes('scroll-padding-top: calc(var(--tm-bar-reserve) + 8px + 56px)'))).toBe(true);
  });

  it('the z-index ladder: the bar sits above content but BELOW every overlay — no overlay target ends up under the bar', () => {
    const bar = zIndexOf(topLevelRuleFor('.timemachine'));
    const sheet = zIndexOf(topLevelRuleFor('.sheet'));
    const toasts = zIndexOf(topLevelRuleFor('.toast-stack'));
    const palette = zIndexOf(topLevelRuleFor('.palette'));
    const onboarding = zIndexOf(topLevelRuleFor('.onboarding'));
    expect(bar).not.toBeNull();
    expect(bar ?? 0).toBeGreaterThan(0); // above normal content
    for (const overlay of [sheet, toasts, palette, onboarding]) {
      expect(overlay).not.toBeNull();
      expect(overlay ?? 0).toBeGreaterThan(bar ?? 0); // every overlay wins
    }
  });
});
