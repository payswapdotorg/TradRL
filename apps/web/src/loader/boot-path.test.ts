// THE REAL-BROWSER BOOT PATH PINS (T051 follow-up W-7a).
//
// THE HOLE THIS FILE CLOSES (the defect the Lead verified on the live
// deployment): the console NEVER booted in a real browser. Vitest
// imports go through esbuild and the old "self-hosting equivalence"
// test only ever ran the FULL stripper — the shell's inline regex
// bootstrap was never executed by any test, and 29/33 app modules
// were rejected by the real stripper on the real path.
//
// These pins make that impossible to repeat:
//   1. THE BOOTSTRAP PIN — extract the ACTUAL regex pass from the
//      REAL apps/web/index.html bytes (never a copy in this test, so
//      drift between the shell and this suite is impossible), run it
//      on the REAL loader file, and assert its output is
//      BYTE-IDENTICAL to the full stripper's output on the same file
//      AND imports cleanly as a module (data: URL dynamic import).
//   2. THE GRAPH PIN — load the FULL apps/web source graph through
//      the REAL loadModuleGraph with data: URL imports: every module
//      strips, compiles and resolves, from the documented boot entry
//      (the package main) down to the leaf modules. This is the
//      integration test the suite never had.
//
// The evidence trail (red first, then green) is in the work order's
// PR body; these tests are the permanent regression floor.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadModuleGraph, stripTypes, type LoaderBindings } from './strip-types';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS_WEB = resolve(HERE, '../..');
const INDEX_HTML = readFileSync(join(APPS_WEB, 'index.html'), 'utf8');
const LOADER_SOURCE = readFileSync(join(HERE, 'strip-types.ts'), 'utf8');

/** Every non-test TS module under apps/web/src (the graph pin must cover them all). */
function allSourceModules(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && entry.name.endsWith('.test.ts') === false) found.push(relative(APPS_WEB, full));
    }
  };
  walk(join(APPS_WEB, 'src'));
  return found.sort();
}

/**
 * Extract the REAL bootstrap statement — the `.replace(...)` chain that
 * strips the loader — from the REAL index.html bytes at test time.
 * Parsing the actual file (instead of copying the regexes here) is the
 * whole point: the shell and the pin can never drift apart.
 */
function extractBootstrapPass(indexHtml: string): string {
  const anchor = 'const stripped = loaderSource';
  const start = indexHtml.indexOf(anchor);
  expect(start, 'index.html must carry the inline bootstrap pass (const stripped = loaderSource …)').toBeGreaterThan(0);
  const lines = indexHtml.slice(start).split('\n');
  const collected: string[] = [];
  for (const line of lines) {
    collected.push(line);
    if (line.trim().endsWith(';')) break;
  }
  const statement = collected.join('\n');
  expect(statement, 'the bootstrap pass must be a replace chain over loaderSource').toContain('.replace(');
  return statement;
}

/** Run the REAL bootstrap pass (extracted from the real index.html) on the loader source. */
function runBootstrapPass(indexHtml: string, loaderSource: string): string {
  const statement = extractBootstrapPass(indexHtml);
  const runner = new Function('loaderSource', `${statement}\nreturn stripped;`);
  return runner(loaderSource) as string;
}

/** Import stripped code as a REAL module (data: URL — the same module-compilation path the shell's blob import exercises). */
async function importStripped(code: string): Promise<Record<string, unknown>> {
  const url = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  return (await import(url)) as Record<string, unknown>;
}

/** The REAL module-graph bindings over the REAL files on disk, with data: URL module imports. */
function diskBindings(readPaths?: string[]): LoaderBindings {
  return {
    async readModule(path: string): Promise<string> {
      if (readPaths !== undefined) readPaths.push(path);
      return readFileSync(resolve(APPS_WEB, path), 'utf8');
    },
    async createModuleUrl(code: string): Promise<string> {
      return `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
    },
    async importModule(url: string): Promise<unknown> {
      return await import(url);
    },
  };
}

describe('boot path: the shell bootstrap (extracted from the REAL index.html)', () => {
  it('the bootstrap pass is present, tiny (the no-build law) and carries no external dependency', () => {
    const statement = extractBootstrapPass(INDEX_HTML);
    // THE NO-BUILD LAW: a handful of hand-authored regex passes — no bundler,
    // no framework, no external asset. The line budget keeps it that way.
    const lineCount = statement.split('\n').length;
    expect(lineCount).toBeLessThan(16);
    expect(statement).not.toMatch(/https?:\/\//);
  });

  it('the bootstrap output on the loader file is BYTE-IDENTICAL to the full stripper output (the self-hosting equivalence, pinned for real this time)', () => {
    const bootstrapOut = runBootstrapPass(INDEX_HTML, LOADER_SOURCE);
    const fullOut = stripTypes(LOADER_SOURCE);
    expect(bootstrapOut).toBe(fullOut);
  });

  it('the bootstrap-stripped loader imports cleanly as a module and exports the loader surface', async () => {
    const bootstrapOut = runBootstrapPass(INDEX_HTML, LOADER_SOURCE);
    const mod = await importStripped(bootstrapOut);
    expect(typeof mod.stripTypes).toBe('function');
    expect(typeof mod.loadModuleGraph).toBe('function');
    expect(typeof mod.bootNoBuild).toBe('function');
    expect(typeof mod.lex).toBe('function');
  });

  it('the full stripper output on the loader file imports cleanly as a module too (both sides of the equivalence must be bootable)', async () => {
    const mod = await importStripped(stripTypes(LOADER_SOURCE));
    expect(typeof mod.stripTypes).toBe('function');
    expect(typeof mod.loadModuleGraph).toBe('function');
  });
});

describe('boot path: the FULL apps/web source graph through the REAL loadModuleGraph', () => {
  it('the shell boot sequence (app module, then package main) loads: every module strips, compiles and resolves (data: URL imports)', async () => {
    // THE REAL SHELL SEQUENCE (index.html's inline bootstrap):
    //   (1) the app module graph — parked on window.__TRADRL_CONSOLE_BOOT__
    //       before the main loads (the main's own dynamic import of the
    //       TS entry cannot resolve in the browser; the parked module is
    //       the boot path);
    //   (2) the package main, which auto-boots through that seam.
    const readPaths: string[] = [];
    const app = (await loadModuleGraph('./src/app/console.ts', diskBindings(readPaths))) as Record<string, unknown>;
    expect(typeof app.bootConsole).toBe('function');
    const main = (await loadModuleGraph('./src/index.ts', diskBindings(readPaths))) as Record<string, unknown>;
    expect(typeof main.bootFromShell).toBe('function');
    expect(typeof main.autoBoot).toBe('function');
    expect(typeof main.bootNoBuild).toBe('function');
    // THE COVERAGE PIN: the boot sequence's transitive closure is the
    // whole non-test source tree — no module sits outside the boot path.
    const expected = allSourceModules();
    const normalize = (p: string): string => p.replace(/^\.\//, '').replace(/\\/g, '/');
    const read = readPaths.map(normalize);
    for (const module of expected) {
      expect(read, `the boot graph must load ${module}`).toContain(module);
    }
  });

  it('the app module (the shell’s first graph load) boots its exports through the same path', async () => {
    const app = (await loadModuleGraph('./src/app/console.ts', diskBindings())) as Record<string, unknown>;
    expect(typeof app.bootConsole).toBe('function');
  });
});
