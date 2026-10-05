// Tests for the J12 touch-target floor (UX-DESIGN.md §6 J12: "touch
// targets >= 44px") + the <main> landmark — the W-17b completion.
//
// Laws pinned here (CSS-as-data, the tokens.test.ts pattern):
//   - at MOBILE widths (<768px) every interactive surface carries the
//     44px floor in BOTH dimensions: the nav items (drawer nav), the
//     icon buttons (Refresh, sheet close), the mode/segment/tm buttons,
//     the search affordance, the palette entries, the accordion
//     summaries, the scrubber, the capsule badges, the toast close, the
//     form fields, the confirm pair, the teaching-state actions;
//   - the floor is MOBILE-SCOPED: the charter's compact desktop rules
//     (§2 nav py-2.5 px-3, the 36px ghost icon button) are law and stay
//     verbatim — the 44px minimums live ONLY inside the mobile media
//     query, so the desktop layout is untouched;
//   - the previously INLINE (`all: unset`) buttons get a flex/grid box
//     at mobile widths so the minimums actually apply (min-height is
//     inert on non-replaced inline boxes).
//
// The <main> landmark render law is pinned in render/shell.test.ts.

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

/**
 * Extract the inner CSS of every `@media (max-width: 767px)` block
 * (brace-matched — the mobile breakpoint the drawer/header rule uses).
 */
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

const MOBILE_RULES = parseRules(mobileBlockBodies(SHELL_CSS));
const TOP_LEVEL_RULES = parseRules(topLevelCss(SHELL_CSS));

/** Every mobile rule whose selector list contains the given selector. */
function mobileRulesFor(selector: string): Rule[] {
  return MOBILE_RULES.filter((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector));
}

/** The first TOP-LEVEL rule for a selector (the charter's desktop law). */
function topLevelRuleFor(selector: string): Rule | undefined {
  return TOP_LEVEL_RULES.find((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector));
}

describe('touch targets: the 44px floor at mobile widths (J12)', () => {
  it('the mobile media query exists and carries rules', () => {
    expect(mobileBlockBodies(SHELL_CSS).length).toBeGreaterThan(0);
    expect(MOBILE_RULES.length).toBeGreaterThan(0);
  });

  it('every interactive surface carries min-height: 44px at mobile widths', () => {
    const selectors = [
      '.nav-item',                       // the drawer nav buttons (measured 37px)
      '.connection-summary',             // the CONNECTION tile toggle
      '.connection-retry',               // Retry connection / export / guided-intro buttons
      '.icon-button',                    // the ghost icon-only Refresh + sheet close (36px)
      '.hero-cta',                       // the Home hero CTA
      '.tm-mode-btn',                    // LIVE / T-x / TIMESTAMP / PLAYBACK (measured ~34px)
      '.tm-scrubber',                    // the styled range input (the slider)
      '.tm-button',                      // play/pause + step controls + launch buttons
      '.segment',                        // the segmented control (theme + launch steps)
      '.toast-close',                    // the toast's manual dismiss
      '.capsule-badge',                  // the inline evidence capsule chips
      '.inbox-read-all',                 // Mark all read
      '.row-action.notice-read-toggle',  // the per-notice Mark read
      '.list-row',                       // the interactive list rows
      'details.list-row > summary',      // the accordion summaries (Show details)
      '.timeline-row > summary',         // the timeline row summaries
      '.empty-action',                   // EmptyState's ONE action
      '.error-retry',                    // ErrorState's Try again
      '.error-technical > summary',      // the Technical details disclosure
      '.field-input',                    // labels-above form inputs + selects
      '.confirm-arm',                    // the two-step confirm's arm button
      '.confirm-cancel',                 // the armed confirm's Cancel
      '.confirm-go',                     // the armed confirm's Confirm
      '.palette-affordance',             // the sidebar Search affordance (measured 39px)
      '.palette-input',                  // the palette's query input
      '.palette-item',                   // the palette entries
      '.onboarding-skip',                // the wizard's Skip link-button
      '.onboarding-cta',                 // the wizard's Continue CTA
    ];
    for (const selector of selectors) {
      const rules = mobileRulesFor(selector);
      expect(rules.length, `${selector} has a mobile rule`).toBeGreaterThan(0);
      expect(rules.some((rule) => rule.body.includes('min-height: 44px')), `${selector} carries min-height: 44px`).toBe(true);
    }
  });

  it('the narrow controls also carry min-width: 44px (both dimensions, J12)', () => {
    const narrow = [
      '.connection-retry', '.hero-cta', '.inbox-read-all', '.row-action.notice-read-toggle',
      '.icon-button', '.empty-action', '.error-retry', '.confirm-arm', '.confirm-cancel',
      '.confirm-go', '.tm-button', '.segment', '.tm-mode-btn', '.toast-close', '.onboarding-skip',
    ];
    for (const selector of narrow) {
      const rules = mobileRulesFor(selector);
      expect(rules.some((rule) => rule.body.includes('min-width: 44px')), `${selector} carries min-width: 44px`).toBe(true);
    }
  });

  it('the previously inline (all: unset) buttons get a box at mobile widths so the minimums apply', () => {
    // min-height/min-width are inert on non-replaced inline boxes — the
    // `all: unset` buttons must become flex/grid at mobile widths.
    const boxed = [
      '.connection-retry', '.hero-cta', '.inbox-read-all', '.row-action.notice-read-toggle',
      '.empty-action', '.error-retry', '.confirm-arm', '.confirm-cancel', '.confirm-go',
      '.tm-button', '.segment', '.tm-mode-btn', '.onboarding-skip',
    ];
    for (const selector of boxed) {
      const rules = mobileRulesFor(selector);
      expect(rules.some((rule) => /display:\s*(inline-flex|flex|grid)/.test(rule.body)), `${selector} gets a flex/grid box`).toBe(true);
    }
    // the toast close centers its glyph inside the expanded box
    const toastClose = mobileRulesFor('.toast-close');
    expect(toastClose.some((rule) => rule.body.includes('place-items: center'))).toBe(true);
    // the technical-details summary centers its label line
    const technical = mobileRulesFor('.error-technical > summary');
    expect(technical.length).toBeGreaterThan(0);
    expect(technical.some((rule) => rule.body.includes('align-items: center'))).toBe(true);
  });

  it('the floor block is ordered AFTER every `all: unset` rule (the cascade law — the W-18b correction)', () => {
    // `all` is a shorthand that implicitly resets EVERY property —
    // min-height, min-width, display included. A base rule carrying
    // `all: unset` at the same specificity beats a floor rule placed
    // EARLIER in the file, media query or not: W-17b's mid-file
    // placement kept the tm buttons at 29-34px in the live browser
    // while every CSS-as-data assertion here stayed green. The floor
    // block must be the LAST media query in the file, with NO
    // `all: unset` rule after it.
    // The check runs on the COMMENT-STRIPPED stylesheet: the floor
    // block's own header documents the trap in prose ("all: unset"),
    // and comments never participate in the cascade.
    const strippedCss = SHELL_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const floorStart = strippedCss.lastIndexOf('@media (max-width: 767px)');
    expect(floorStart).toBeGreaterThan(-1);
    expect(strippedCss.indexOf('all: unset', floorStart), 'no `all: unset` rule may follow the floor block').toBe(-1);
    expect(strippedCss.indexOf('@media', floorStart + 1), 'the floor block is the last media query').toBe(-1);
  });
});

describe('touch targets: the floor is mobile-scoped (the desktop law is untouched)', () => {
  it('the charter\'s compact desktop rules stay verbatim (§2 nav py-2.5 px-3; the 36px ghost icon button)', () => {
    const navItem = topLevelRuleFor('.nav-item');
    expect(navItem).toBeDefined();
    expect(navItem?.body).toContain('padding: 10px 12px');
    expect(navItem?.body).not.toContain('min-height');

    const iconButton = topLevelRuleFor('.icon-button');
    expect(iconButton).toBeDefined();
    expect(iconButton?.body).toContain('width: 36px');
    expect(iconButton?.body).toContain('height: 36px');
  });

  it('the 44px minimums appear ONLY inside the mobile media query', () => {
    for (const rule of TOP_LEVEL_RULES) {
      expect(rule.body.includes('min-height: 44px'), `${rule.selector} must not declare 44px outside the mobile query`).toBe(false);
    }
  });
});
