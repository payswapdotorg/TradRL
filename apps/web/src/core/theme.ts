// @tradrl/web-console — the theme system (UX-DESIGN.md §1, T051).
//
// THE CHARTER: "All tokens are CSS custom properties declared on the
// shell root element `.tradrl-shell` … The active theme is selected
// by `data-theme="light"` (default) or `data-theme="dark"` on that
// root … Theme choice persists in `localStorage` (`tradrl_theme`) and
// re-applies before first paint."
//
// This module is the theme SYSTEM's logic (the palettes themselves
// are hand-authored CSS in src/shell/tokens.css — craft, not code):
//   - the persistence key (closed vocabulary: 'tradrl_theme');
//   - the theme names ('light' default / 'dark' alternate);
//   - reading the stored choice (any garbage degrades to light);
//   - persisting a choice;
//   - applying a theme to an element (the data-theme attribute).
//
// Every function takes INJECTED dependencies (a storage-like seam, an
// element-like seam) — the module stays pure and headless-testable;
// the browser bindings live in the entry (src/index.ts) and the
// static shell (index.html's pre-paint script).

/** The theme names — the charter's two palettes. Light is the DEFAULT. */
export type ThemeName = 'light' | 'dark';

/** The localStorage key the theme persists under (charter §1: `tradrl_theme`). */
export const THEME_STORAGE_KEY = 'tradrl_theme';

/** The closed vocabulary of theme names (light first — it is the default). */
export const THEME_NAMES: readonly ThemeName[] = ['light', 'dark'];

/** The minimal storage seam (localStorage in the browser; a map in tests). */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Normalize any stored value to a theme name: 'dark' selects the dark
 * alternate; EVERYTHING else (including null, absent, corrupted
 * values) is the light default. The default never depends on the
 * environment — determinism law.
 */
export function normalizeTheme(value: unknown): ThemeName {
  return value === 'dark' ? 'dark' : 'light';
}

/** Read the persisted theme from a storage seam (degrades to light on any failure). */
export function readStoredTheme(storage: { getItem(key: string): string | null }): ThemeName {
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    // storage unavailable (private mode, sandboxed iframe): light default, session-only
    return 'light';
  }
}

/** Persist a theme choice (a failure to persist never breaks the session). */
export function persistTheme(storage: ThemeStorage, theme: ThemeName): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage unavailable: the theme applies for this session only
  }
}

/** Apply a theme to an element — the `data-theme` attribute on the shell root. */
export function applyTheme(element: { setAttribute(name: string, value: string): void }, theme: ThemeName): void {
  element.setAttribute('data-theme', theme);
}
