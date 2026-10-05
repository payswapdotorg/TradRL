// @tradrl/web-console — THE PACKAGE MAIN (the app entry).
//
// THE LAW (Work Order T042): "A static shell: index.html at the
// package root plus a documented no-build loader (the app boots from
// the TS entry via the package main; no bundler, no framework, no
// runtime dependency — DOM APIs only; graceful degradation when the
// API is unreachable)."
//
// This module is that entry (apps/web/package.json main -> src/index.ts).
// It is the ONLY place the browser world meets the console world:
//   - it reads the static shell's configuration (the API origin and
//     the credential token the host injected into index.html),
//   - it constructs the injected transport (the fetch binding),
//   - it constructs the injected clock (the system seam — boot
//     boundary only; every render pass runs at injected instants),
//   - it boots the console (src/app/console.ts) and mounts it into
//     the shell's root element,
//   - and it degrades GRACEFULLY at every step: a missing root, a
//     missing configuration, an unreachable API, or a loader failure
//     renders a readable message into the page — never a blank page,
//     never an unhandled crash.
//
// The wall-clock law: the ONLY wall-clock read is core/clock.ts's
// systemNowMs (the injected-clock adapter's default seam). Nothing
// here calls Date.now directly.

import { bootNoBuild } from './loader/strip-types';
import type { ConsoleHandle } from './app/console';
import type { ApiTransport } from './api/transport';
import { createFetchTransport } from './api/transport';
import { readStoredTheme, type ThemeStorage } from './core/theme';

/** The console's configuration as the static shell carries it (window.__TRADRL_CONSOLE__). */
export interface ShellConfig {
  /** The API origin (default: the page's own origin — a same-origin deployment). */
  readonly apiOrigin?: string;
  /** The credential token (the host minted it at the secure boundary; required). */
  readonly token?: string;
  /** The tenant id (required — L12: the workspace is tenant-scoped). */
  readonly tenantId?: string;
  /** The project id ('' = the launchpad — the primary flow starts here). */
  readonly projectId?: string;
  /** True when this shell runs on a fake/demo adapter (the SIMULATED environment badge; the shipped static shell defaults to true — a real host overrides it). */
  readonly simulated?: boolean;
}

/** The preloaded app module the shell's bootstrap parks on window before importing this module (the static-shell boot path; the erasable-subset law: object types live in named aliases, cast targets included). */
type BootModuleHolder = { __TRADRL_CONSOLE_BOOT__?: typeof import('./app/console') };

/** The static shell's root element id (index.html's #tradrl-console). */
export const CONSOLE_ROOT_ID = 'tradrl-console';

/** Read the shell's configuration (the injected global; defaults apply after). */
export function readShellConfig(globalLike: { __TRADRL_CONSOLE__?: ShellConfig } = globalThis as { __TRADRL_CONSOLE__?: ShellConfig }): ShellConfig {
  return globalLike.__TRADRL_CONSOLE__ ?? {};
}

/** The effective API base URL: the configured origin, else the page's own origin. */
export function apiBaseUrl(config: ShellConfig, locationLike: { readonly origin: string } = typeof window !== 'undefined' ? window.location : { origin: '' }): string {
  if (config.apiOrigin !== undefined && config.apiOrigin.length > 0) return config.apiOrigin.replace(/\/$/, '');
  return locationLike.origin;
}

/** Render a plain, readable degradation message into a container (DOM APIs only — no innerHTML). */
export function renderBootMessage(documentLike: Document, container: Element, message: string, detail?: string): void {
  const paragraph = documentLike.createElement('p');
  paragraph.setAttribute('class', 'console-boot-message');
  paragraph.setAttribute('data-boot', 'degraded');
  paragraph.appendChild(documentLike.createTextNode(message));
  if (detail !== undefined && detail.length > 0) {
    paragraph.appendChild(documentLike.createTextNode(` — ${detail}`));
  }
  while (container.firstChild !== null) container.removeChild(container.firstChild);
  container.appendChild(paragraph);
}

/** Find the shell's root element (null when the page carries none). */
export function findConsoleRoot(documentLike: Document): HTMLElement | null {
  return documentLike.getElementById(CONSOLE_ROOT_ID);
}

/**
 * The boot path (exported for tests; the browser auto-boot calls it):
 * load the console's app module through the no-build loader and boot
 * it into the root. Returns the live handle. Every failure degrades
 * gracefully — the message lands in the root, and the error rethrows
 * only when even that is impossible (no root at all).
 */
export async function bootFromShell(options: {
  readonly document?: Document;
  readonly entry?: string;
  readonly config?: ShellConfig;
  readonly transport?: ApiTransport;
  readonly fetchLike?: never;
} = {}): Promise<ConsoleHandle | null> {
  const documentLike = options.document ?? (typeof document !== 'undefined' ? document : null);
  if (documentLike === null) return null;
  const root = findConsoleRoot(documentLike);
  if (root === null) return null;

  const config = options.config ?? readShellConfig();
  if (config.token === undefined || config.token.length === 0) {
    renderBootMessage(documentLike, root, 'The console could not start', 'no credential token was injected into the shell (window.__TRADRL_CONSOLE__.token)');
    return null;
  }
  if (config.tenantId === undefined || config.tenantId.length === 0) {
    renderBootMessage(documentLike, root, 'The console could not start', 'no tenant was injected into the shell (window.__TRADRL_CONSOLE__.tenantId)');
    return null;
  }

  // THE NO-BUILD LOAD: this module is itself loaded through the
  // loader (or a bundler-free static server); the app module boots
  // from the TS entry via the package main. The loader's bindings
  // here are the browser's fetch + blob-URL module injection.
  const entry = options.entry ?? './src/app/console.ts';
  let boot: typeof import('./app/console') | null = null;
  try {
    const module = (await import(entry)) as typeof import('./app/console');
    boot = module;
  } catch {
    boot = null;
  }
  if (boot === null || typeof boot.bootConsole !== 'function') {
    // The static-shell path: the inline bootstrap loads the entry
    // through the no-build loader (blob-module graph) and lands it on
    // window.__TRADRL_CONSOLE_BOOT__ before importing this module.
    const holder = globalThis as BootModuleHolder;
    const preloaded = holder.__TRADRL_CONSOLE_BOOT__;
    if (preloaded === undefined || typeof preloaded.bootConsole !== 'function') {
      renderBootMessage(documentLike, root, 'The console could not start', 'the app module failed to load (see the browser console)');
      return null;
    }
    boot = preloaded;
  }

  try {
    // The persisted theme (charter §1: localStorage `tradrl_theme`; the
    // static shell's pre-paint script already applied it to <html> and
    // the app root — this is the boot-time read for the shell view).
    // The SAME storage seam carries the onboarding completion (§4.13:
    // localStorage `tradrl_onboarded`) — the entry MUST hand it to the
    // console or the wizard never persists and returning users see it
    // on every boot (the W-10b fix: the seam existed but was never
    // wired here).
    const storage: ThemeStorage | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined;
    const handle = boot.bootConsole({
      baseUrl: apiBaseUrl(config),
      token: config.token,
      scope: { tenantId: config.tenantId, projectId: config.projectId ?? '' },
      theme: storage === undefined ? 'light' : readStoredTheme(storage),
      ...(storage === undefined ? {} : { storage }),
      ...(storage === undefined ? {} : { onboardingStorage: storage }),
      simulated: config.simulated ?? false,
      ...(options.transport === undefined ? {} : { transport: options.transport }),
    });
    handle.mount(root, documentLike);
    return handle;
  } catch (error) {
    // Boot itself failed (a construction error): degrade with the message.
    renderBootMessage(documentLike, root, 'The console could not start', (error as Error)?.message ?? String(error));
    return null;
  }
}

/**
 * The browser auto-boot: the shell's script tag (a no-build loader
 * bootstrap or a static import) lands here on DOMContentLoaded. The
 * console's own read cadence then degrades gracefully per-read when
 * the API is unreachable (the app layer's law); this path only
 * guards the boot itself. The no-build loader is exercised through
 * `bootNoBuild` when the page carries no native TS module loading.
 */
export async function autoBoot(): Promise<ConsoleHandle | null> {
  return await bootFromShell();
}

// The browser auto-boot (guarded: never in a module-graph load for
// tests — the entry is imported for its exports there).
if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.readyState !== 'loading') {
  void autoBoot();
} else if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    void autoBoot();
  });
}

/** The no-build loader's re-export (the shell's bootstrap imports it from the package main). */
export { bootNoBuild };

export type { ConsoleHandle, ConsoleBootOptions } from './app/console';
