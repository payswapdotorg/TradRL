// Tests for the design-token system (src/shell/tokens.css — UX-DESIGN.md §1, T051)
// and the no-build shell wiring (index.html).
//
// Laws pinned here — the token system is DATA, and the data is the
// charter's own tables, transcribed:
//   - BOTH palettes complete on the .tradrl-shell root: light (the
//     warm palette, DEFAULT via the bare selector + data-theme="light")
//     and dark (data-theme="dark");
//   - the connection-state tokens (base/soft/text) with the dark
//     soft/text variants via color-mix(in oklch, <base> 18%, transparent);
//   - the radius scale (0.625rem + sm 6 / md 8 / lg 10 / xl 14) and the
//     4px spacing scale (--space-1..8);
//   - the font stacks (Geist Sans/Mono with the charter's system
//     fallbacks) and the chart palette;
//   - the focus-visible law, verbatim;
//   - the html background follows the active theme (overscroll law);
//   - prefers-reduced-motion gates every animation/transition;
//   - the static shell links the stylesheets and re-applies the
//     persisted theme (localStorage `tradrl_theme`) before first paint.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const TOKENS_CSS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const SHELL_CSS = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');
const INDEX_HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

/** One parsed CSS rule (selector + body). */
interface Rule { readonly selector: string; readonly body: string }

/** Parse a stylesheet into flat rules (comments stripped; no nesting — hand-authored files). */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null = pattern.exec(stripped);
  while (match !== null) {
    rules.push({ selector: match[1].trim(), body: match[2] });
    match = pattern.exec(stripped);
  }
  return rules;
}

const RULES = parseRules(TOKENS_CSS);

/** Find the FIRST rule matching a selector predicate. */
function ruleWhere(predicate: (rule: Rule) => boolean): Rule {
  const found = RULES.find(predicate);
  if (found === undefined) throw new Error('no rule matched the predicate');
  return found;
}

/** Extract a declaration's value from a rule body (custom properties are whitespace-tolerant). */
function tokenOf(body: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(body);
  if (match === null) throw new Error(`token ${name} not declared`);
  return match[1].trim();
}

const LIGHT = ruleWhere((rule) => rule.selector.includes("data-theme='light'"));
const DARK = ruleWhere((rule) => rule.selector.includes("data-theme='dark'") && rule.body.includes('--background:'));
const CONNECTION_LIGHT = ruleWhere((rule) => rule.selector === '.tradrl-shell' && rule.body.includes('--tradrl-live:'));
const CONNECTION_DARK = ruleWhere((rule) => rule.selector.includes("data-theme='dark'") && rule.body.includes('--tradrl-live-soft:'));
const SCALES = ruleWhere((rule) => rule.selector === '.tradrl-shell' && rule.body.includes('--radius:'));

describe('tokens: the light palette (DEFAULT — the warm palette, §1.1)', () => {
  it('declares the complete light palette on the shell root', () => {
    const table: Record<string, string> = {
      '--background': 'oklch(0.98 0.002 90)',
      '--foreground': 'oklch(0.2 0.005 90)',
      '--card': 'oklch(0.99 0.001 90)',
      '--card-foreground': 'oklch(0.2 0.005 90)',
      '--popover': 'oklch(0.99 0.001 90)',
      '--primary': 'oklch(0.28 0.01 90)',
      '--primary-foreground': 'oklch(0.98 0.002 90)',
      '--secondary': 'oklch(0.95 0.003 90)',
      '--muted': 'oklch(0.95 0.003 90)',
      '--input': 'oklch(0.95 0.003 90)',
      '--secondary-foreground': 'oklch(0.2 0.01 90)',
      '--muted-foreground': 'oklch(0.48 0.008 90)',
      '--accent': 'oklch(0.93 0.025 165)',
      '--accent-foreground': 'oklch(0.3 0.06 165)',
      '--destructive': 'oklch(0.65 0.15 25)',
      '--border': 'oklch(0.91 0.004 90)',
      '--ring': 'oklch(0.7 0.1 165)',
      '--sidebar': 'oklch(0.97 0.003 90)',
      '--sidebar-primary': 'oklch(0.7 0.1 165)',
      '--sidebar-ring': 'oklch(0.7 0.1 165)',
      '--sidebar-accent': 'oklch(0.93 0.025 165)',
      '--sidebar-accent-foreground': 'oklch(0.3 0.06 165)',
      '--sidebar-border': 'oklch(0.91 0.004 90)',
    };
    for (const [name, value] of Object.entries(table)) {
      expect(tokenOf(LIGHT.body, name), name).toBe(value);
    }
  });

  it('the light theme is the DEFAULT (the bare .tradrl-shell selector carries it)', () => {
    expect(LIGHT.selector).toBe('.tradrl-shell,\n.tradrl-shell[data-theme=\'light\']');
  });
});

describe('tokens: the dark palette (data-theme="dark", §1.2)', () => {
  it('declares the complete dark palette on the shell root', () => {
    const table: Record<string, string> = {
      '--background': '#0a0a0a',
      '--foreground': '#fafafa',
      '--card': '#171717',
      '--card-foreground': '#fafafa',
      '--popover': '#171717',
      '--primary': '#e5e5e5',
      '--primary-foreground': '#171717',
      '--secondary': '#262626',
      '--muted': '#262626',
      '--input': '#ffffff26',
      '--secondary-foreground': '#fafafa',
      '--muted-foreground': '#a1a1a1',
      '--accent': '#262626',
      '--accent-foreground': '#fafafa',
      '--destructive': '#ff6568',
      '--border': '#ffffff1a',
      '--ring': '#737373',
      '--sidebar': '#171717',
      '--sidebar-primary': '#5cb28f',
      '--sidebar-ring': '#5cb28f',
      '--sidebar-accent': '#262626',
      '--sidebar-accent-foreground': '#fafafa',
      '--sidebar-border': '#ffffff1a',
    };
    for (const [name, value] of Object.entries(table)) {
      expect(tokenOf(DARK.body, name), name).toBe(value);
    }
  });

  it('the dark theme is selected by data-theme="dark" on the shell root', () => {
    expect(DARK.selector).toContain('.tradrl-shell[data-theme=\'dark\']');
  });
});

describe('tokens: the connection states (§1.3)', () => {
  it('declares the base/soft/text triples (light values)', () => {
    const table: Record<string, [string, string, string]> = {
      '--tradrl-live': ['#5cb28f', '#d9eee4', '#00563c'],
      '--tradrl-warn': ['#d58b4b', '#fbe7d8', '#7d460b'],
      '--tradrl-down': ['#dc655f', '#ffe4e1', '#90302e'],
      '--tradrl-idle': ['#82807a', '#e8e8e6', '#57554f'],
    };
    for (const [base, [soft, softValue, textValue]] of Object.entries(table)) {
      expect(tokenOf(CONNECTION_LIGHT.body, base), base).toBe(soft);
      expect(tokenOf(CONNECTION_LIGHT.body, `${base}-soft`), base).toBe(softValue);
      expect(tokenOf(CONNECTION_LIGHT.body, `${base}-text`), base).toBe(textValue);
    }
  });

  it('the dark soft/text variants: color-mix 18% softs, base-color text (§1.3 rule)', () => {
    const bases = { live: '#5cb28f', warn: '#d58b4b', down: '#dc655f', idle: '#82807a' } as const;
    for (const [name, base] of Object.entries(bases)) {
      expect(tokenOf(CONNECTION_DARK.body, `--tradrl-${name}-soft`)).toBe(`color-mix(in oklch, ${base} 18%, transparent)`);
      expect(tokenOf(CONNECTION_DARK.body, `--tradrl-${name}-text`)).toBe(base);
    }
  });
});

describe('tokens: radius, spacing, typography, charts (§1.4)', () => {
  it('the radius scale: 0.625rem base + sm 6 / md 8 / lg 10 / xl 14', () => {
    expect(tokenOf(SCALES.body, '--radius')).toBe('0.625rem');
    expect(tokenOf(SCALES.body, '--radius-sm')).toBe('6px');
    expect(tokenOf(SCALES.body, '--radius-md')).toBe('8px');
    expect(tokenOf(SCALES.body, '--radius-lg')).toBe('10px');
    expect(tokenOf(SCALES.body, '--radius-xl')).toBe('14px');
  });

  it('the 4px spacing scale: --space-1..8 = 4/8/12/16/24/32/48/64', () => {
    const expected = ['4px', '8px', '12px', '16px', '24px', '32px', '48px', '64px'];
    for (let index = 0; index < expected.length; index += 1) {
      expect(tokenOf(SCALES.body, `--space-${index + 1}`)).toBe(expected[index]);
    }
  });

  it('the font stacks: Geist Sans/Mono with the charter system fallbacks', () => {
    expect(tokenOf(SCALES.body, '--font-sans')).toBe('\'Geist Sans\', ui-sans-serif, -apple-system, \'Segoe UI\', Arial, sans-serif');
    expect(tokenOf(SCALES.body, '--font-mono')).toBe('\'Geist Mono\', ui-monospace, \'SF Mono\', Consolas, monospace');
  });

  it('the chart palette (both themes): orange/teal/amber/violet/rose', () => {
    expect(tokenOf(SCALES.body, '--chart-1')).toBe('#f05100');
    expect(tokenOf(SCALES.body, '--chart-2')).toBe('#009588');
    expect(tokenOf(SCALES.body, '--chart-3')).toBe('#fcbb00');
    expect(tokenOf(SCALES.body, '--chart-4')).toBe('#ac4bff');
    expect(tokenOf(SCALES.body, '--chart-5')).toBe('#ff2357');
  });
});

describe('tokens: the focus law + the motion law (§1.5)', () => {
  it('the focus-visible law, verbatim', () => {
    expect(TOKENS_CSS).toContain('.tradrl-shell *:focus-visible');
    expect(TOKENS_CSS).toContain('outline: 2px solid var(--tradrl-live)');
    expect(TOKENS_CSS).toContain('outline-offset: 2px');
  });

  it('prefers-reduced-motion gates every animation and transition', () => {
    expect(TOKENS_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(TOKENS_CSS).toContain('animation-duration: 0.01ms !important');
    expect(TOKENS_CSS).toContain('transition-duration: 0.01ms !important');
  });

  it('the html background follows the active theme (the overscroll law)', () => {
    const htmlRule = ruleWhere((rule) => rule.selector === 'html');
    const htmlDark = ruleWhere((rule) => rule.selector === "html[data-theme='dark']");
    expect(htmlRule.body).toContain('background: #f9f8f7');
    expect(htmlDark.body).toContain('background: #0a0a0a');
  });
});

describe('tokens: the app-shell layout carries the charter\'s measurements (§2)', () => {
  it('the fixed 256px sidebar; the brand row 64px; the max-w-6xl content wrapper', () => {
    expect(SHELL_CSS).toContain('width: 256px');
    expect(SHELL_CSS).toContain('height: 64px');
    expect(SHELL_CSS).toContain('padding-left: 256px');
    expect(SHELL_CSS).toContain('max-width: 72rem');
  });

  it('the motion curve is the charter\'s (300ms cubic-bezier(0.22, 1, 0.36, 1)) on the pill + the drawer', () => {
    expect(SHELL_CSS.match(/cubic-bezier\(0\.22, 1, 0\.36, 1\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(SHELL_CSS).toContain('transform 300ms cubic-bezier(0.22, 1, 0.36, 1)');
    expect(SHELL_CSS).toContain('transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1)');
  });

  it('the active pill sits on --sidebar-accent with radius-lg; the mobile header is 56px', () => {
    expect(SHELL_CSS).toContain('background: var(--sidebar-accent)');
    expect(SHELL_CSS).toContain('height: 56px');
    expect(SHELL_CSS).toContain('env(safe-area-inset-bottom)');
  });
});

describe('tokens: the no-build shell wiring (index.html)', () => {
  it('links the token system + the app shell stylesheets (static assets, no build)', () => {
    expect(INDEX_HTML).toContain('<link rel="stylesheet" href="./src/shell/tokens.css">');
    expect(INDEX_HTML).toContain('<link rel="stylesheet" href="./src/shell/shell.css">');
  });

  it('re-applies the persisted theme BEFORE FIRST PAINT (localStorage tradrl_theme, light default)', () => {
    expect(INDEX_HTML).toContain("localStorage.getItem('tradrl_theme')");
    expect(INDEX_HTML).toContain("localStorage.getItem('tradrl_theme') === 'dark' ? 'dark' : 'light'");
    // the pre-paint script runs in <head>, before the stylesheets and the loader bootstrap
    const themeScript = INDEX_HTML.indexOf("localStorage.getItem('tradrl_theme')");
    const stylesheets = INDEX_HTML.indexOf('<link rel="stylesheet"');
    const loader = INDEX_HTML.indexOf("fetch('./src/loader/strip-types.ts')");
    expect(themeScript).toBeGreaterThan(0);
    expect(themeScript).toBeLessThan(stylesheets);
    expect(themeScript).toBeLessThan(loader);
  });

  it('the shipped static shell is honestly labeled SIMULATED (demo data)', () => {
    expect(INDEX_HTML).toContain('simulated: true');
  });
});
