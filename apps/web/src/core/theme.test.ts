// Tests for the theme system (core/theme.ts — UX-DESIGN.md §1, T051).
//
// Laws pinned here:
//   - the persistence key is the charter's own (`tradrl_theme`);
//   - light is the DEFAULT — every non-'dark' stored value (null,
//     absent, corrupted, foreign) degrades to light, deterministically;
//   - persisting writes the theme name under the key;
//   - applying a theme sets `data-theme` on the element (the shell root);
//   - every function takes an injected seam (no global state, no DOM).

import { describe, expect, it } from 'vitest';
import {
  applyTheme,
  normalizeTheme,
  persistTheme,
  readStoredTheme,
  THEME_NAMES,
  THEME_STORAGE_KEY,
  type ThemeStorage,
} from './theme';

/** A map-backed storage seam (zero-dep test double). */
function mapStorage(initial: Record<string, string> = {}): ThemeStorage & { dump(): Record<string, string> } {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => { store.set(key, value); },
    dump: () => Object.fromEntries(store.entries()),
  };
}

describe('theme: the charter vocabulary', () => {
  it('the persistence key is the charter\'s own (tradrl_theme)', () => {
    expect(THEME_STORAGE_KEY).toBe('tradrl_theme');
  });

  it('the theme names are light (default) and dark (alternate)', () => {
    expect(THEME_NAMES).toEqual(['light', 'dark']);
  });
});

describe('theme: normalization (light is the DEFAULT)', () => {
  it("'dark' is the dark theme; EVERYTHING else is the light default", () => {
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme(null)).toBe('light');
    expect(normalizeTheme(undefined)).toBe('light');
    expect(normalizeTheme('')).toBe('light');
    expect(normalizeTheme('DARK')).toBe('light');
    expect(normalizeTheme('tradrl')).toBe('light');
    expect(normalizeTheme(42)).toBe('light');
  });
});

describe('theme: persistence', () => {
  it('reads a stored choice and degrades unknown values to light', () => {
    expect(readStoredTheme(mapStorage({ tradrl_theme: 'dark' }))).toBe('dark');
    expect(readStoredTheme(mapStorage({ tradrl_theme: 'light' }))).toBe('light');
    expect(readStoredTheme(mapStorage({}))).toBe('light');
    expect(readStoredTheme(mapStorage({ tradrl_theme: 'corrupted' }))).toBe('light');
  });

  it('persists a choice under the charter key', () => {
    const storage = mapStorage();
    persistTheme(storage, 'dark');
    expect(storage.dump()).toEqual({ tradrl_theme: 'dark' });
    persistTheme(storage, 'light');
    expect(storage.dump()).toEqual({ tradrl_theme: 'light' });
  });

  it('a throwing storage seam never breaks the session (read: light default; persist: no-op)', () => {
    const exploding = {
      getItem: (): string => { throw new Error('storage unavailable'); },
      setItem: (): void => { throw new Error('storage unavailable'); },
    };
    expect(readStoredTheme(exploding)).toBe('light');
    expect(() => persistTheme(exploding, 'dark')).not.toThrow();
  });
});

describe('theme: application (the data-theme attribute on the shell root)', () => {
  it('applies the theme as the data-theme attribute', () => {
    const applied: { name: string; value: string }[] = [];
    const element = { setAttribute: (name: string, value: string) => { applied.push({ name, value }); } };
    applyTheme(element, 'dark');
    applyTheme(element, 'light');
    expect(applied).toEqual([
      { name: 'data-theme', value: 'dark' },
      { name: 'data-theme', value: 'light' },
    ]);
  });
});
