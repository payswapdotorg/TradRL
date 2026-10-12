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

// THE D-1 TIMEOUT LAW (FW-50-B — the FW-49 raise extended to the
// boot-shaped files): the boot-path tests below that compile a module
// through the REAL data: URL seam (the bootstrap-import pair) or walk
// the FULL apps/web source graph through the REAL loadModuleGraph (the
// graph-load family) carry the same build-shaped cost class as the
// determinism tests FW-49 raised — every module of the graph strips,
// compiles and resolves per load — and their per-test timeout was
// vitest's IMPLICIT 5,000ms default. The FW-50 merge-result battery
// measured it: the shell boot-sequence test at 6,601ms under machine
// load (and the FW-50 payload grew +23KB — more graph to strip on every
// load; the pre-fix re-run on this tree measured 7,835ms). A timeout
// there measures MACHINE LOAD, not the contract. The timeout is
// therefore declared EXPLICITLY as BOOT_TEST_TIMEOUT_MS, floor-pinned
// by its own test at the end of this file at the FW-49 documented-safe
// ceiling (60,000ms), so the D-1 class can never silently regress to an
// implicit default on the boot-path files either. The two pure
// string-law pins in the first describe (the bootstrap-pass presence
// check + the byte-identity compare — regex/byte work over ONE file, no
// module compilation, no graph walk) deliberately stay at the implicit
// default: they measure in single-digit milliseconds and have never
// flaked in the record (the FW-49 beforeAll precedent — raising them
// would be un-evidenced scope growth).
const BOOT_TEST_TIMEOUT_MS = 60_000; // the D-1 extension (FW-50-B): the FW-49 documented-safe ceiling — floor-pinned by the D-1 test at the end of this file

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

  it('the bootstrap-stripped loader imports cleanly as a module and exports the loader surface', { timeout: BOOT_TEST_TIMEOUT_MS }, async () => {
    const bootstrapOut = runBootstrapPass(INDEX_HTML, LOADER_SOURCE);
    const mod = await importStripped(bootstrapOut);
    expect(typeof mod.stripTypes).toBe('function');
    expect(typeof mod.loadModuleGraph).toBe('function');
    expect(typeof mod.bootNoBuild).toBe('function');
    expect(typeof mod.lex).toBe('function');
  });

  it('the full stripper output on the loader file imports cleanly as a module too (both sides of the equivalence must be bootable)', { timeout: BOOT_TEST_TIMEOUT_MS }, async () => {
    const mod = await importStripped(stripTypes(LOADER_SOURCE));
    expect(typeof mod.stripTypes).toBe('function');
    expect(typeof mod.loadModuleGraph).toBe('function');
  });
});

describe('boot path: the FULL apps/web source graph through the REAL loadModuleGraph', () => {
  it('the shell boot sequence (app module, then package main) loads: every module strips, compiles and resolves (data: URL imports)', { timeout: BOOT_TEST_TIMEOUT_MS }, async () => {
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

  it('the app module (the shell’s first graph load) boots its exports through the same path', { timeout: BOOT_TEST_TIMEOUT_MS }, async () => {
    const app = (await loadModuleGraph('./src/app/console.ts', diskBindings())) as Record<string, unknown>;
    expect(typeof app.bootConsole).toBe('function');
  });

  it('the app sources carry NO call-site or constructor type arguments (they survive stripping as comparison garbage and throw at runtime)', { timeout: BOOT_TEST_TIMEOUT_MS }, () => {
    // The erasable subset allows generics on DECLARATIONS only. A call-site
    // `request<Page<X>>(...)` or a constructor `new Map<K, V>()` is NOT
    // erased by the stripper — it survives as `request < Page < X >> (...)`,
    // which is valid JS (comparisons) and therefore passes every compile
    // pin, then throws ReferenceError at RUNTIME. The real-browser proof
    // exposed exactly this class (the `Page is not defined` degradation);
    // this pin scans the STRIPPED output (type-land is already gone there)
    // so any survivor is real runtime garbage.
    // `name<Type>(` / `name<Outer<Inner>>(` — an identifier, an angle-bracket
    // type-argument shape (UpperCamelCase type names per the house style, no
    // operators inside — comparison chains like `a < b && c > d(e)` cannot
    // match), then the call paren. The closing `>` MUST be allowed before the
    // paren (the obvious first draft `name<[^<>()\n]*\(` excludes it and can
    // never match anything — a false green this pin only survived because of).
    const callSiteGeneric = /\b[A-Za-z_$][A-Za-z0-9_$]*\s*<\s*[A-Z][A-Za-z0-9_$]*[A-Za-z0-9_$<>,.\s]*>\s*\(/;
    const newGenericType = /\bnew\s+[A-Za-z_$][A-Za-z0-9_$]*\s*<\s*[A-Z]/;
    for (const module of allSourceModules()) {
      const stripped = stripTypes(readFileSync(join(APPS_WEB, module), 'utf8'));
      for (const line of stripped.split('\n')) {
        if (callSiteGeneric.test(line)) {
          expect.fail(`${module} (stripped): call-site type argument survived: ${line.trim()}`);
        }
        if (newGenericType.test(line)) {
          expect.fail(`${module} (stripped): constructor type argument survived: ${line.trim()}`);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// THE D-1 TIMEOUT FLOOR (FW-50-B): the boot-path tests' per-test timeout
// is the EXPLICIT BOOT_TEST_TIMEOUT_MS, floor-pinned at the FW-49
// documented-safe ceiling — the D-1 class (a boot-shaped test timing out
// at vitest's implicit 5,000ms default under machine load) can never
// silently regress to an implicit default on the boot-path files either
// (the FW-49 law, completed to the boot-shaped half).
// ---------------------------------------------------------------------------

describe('boot path — the D-1 boot timeout floor (FW-50-B)', () => {
  it('the boot-path tests\' per-test timeout is the explicit constant at the documented-safe ceiling (>= 60,000ms — never vitest\'s implicit 5,000ms default)', () => {
    expect(BOOT_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});
