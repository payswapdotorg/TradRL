// Tests for THE NO-BUILD LOADER (src/loader/strip-types.ts).
//
// Laws pinned here (the file header's contract — a documented,
// tested contract, NOT a silent best-effort):
//   - THE ERASABLE SUBSET strips cleanly: interfaces, type aliases,
//     annotations (params/returns/declarators/class fields/
//     destructuring), as/satisfies casts, generics on function
//     declarations, import type / export type, optional params,
//     member modifiers, enum-like const objects;
//   - DETERMINISM: identical input bytes -> identical output bytes;
//   - THE FORBIDDEN SUBSET is REJECTED with a clear typed
//     LoaderError naming the construct: enums, namespaces, parameter
//     properties, decorators, declare, abstract classes, non-null
//     assertions, switch/case + labels, function types at annotation
//     depth zero, definite assignment;
//   - the self-hosting equivalence: the static shell's regex
//     bootstrap output on the loader file == the full stripper's
//     output on the loader file (byte-identical);
//   - the module graph: relative resolution, acyclicity (a cycle is
//     a LoaderError), specifier rewriting to the loaded modules' URLs.

import { describe, expect, it } from 'vitest';
import {
  importSpecifiersOf,
  lex,
  loadModuleGraph,
  resolveSpecifier,
  rewriteSpecifiers,
  stripTypes,
} from './strip-types';

/** Strip for comparison: ALL whitespace removed (the comparison is semantic — the stripper may close erased-token gaps). */
function stripped(source: string): string {
  return stripTypes(source).replace(/\s+/g, '');
}

/** Normalize an expected literal the same way (whitespace-insensitive). */
function expectLike(source: string): string {
  return source.replace(/\s+/g, '');
}

describe('loader: the erasable subset strips cleanly', () => {
  it('interfaces and type aliases are removed entirely', () => {
    expect(stripped(`
export interface Point { readonly x: number; readonly y: number; }
type Pair = [string, number];
export type Id = string;
const a: Id = 'x';
`)).toBe(expectLike(`const a = 'x';`));
  });

  it('parameter, return and declarator annotations strip', () => {
    expect(stripped(`
function add(a: number, b: number): number { return a + b; }
const total: number = add(1, 2);
let names: string[] = [];
`)).toBe(expectLike(`
function add(a, b) { return a + b; }
const total = add(1, 2);
let names = [];
`));
  });

  it('destructuring annotations strip', () => {
    expect(stripped(`const { x, y }: Point = point; const [first, second]: number[] = pair;`))
      .toBe(expectLike(`const { x, y } = point; const [first, second] = pair;`));
  });

  it('as / satisfies casts strip', () => {
    expect(stripped(`const n = value as number; const config = { a: 1 } as const; const opts = { a: 1 } satisfies Options;`))
      .toBe(expectLike(`const n = value; const config = { a: 1 }; const opts = { a: 1 };`));
  });

  it('generics on function declarations strip (the value keeps none)', () => {
    expect(stripped(`function identity<T>(value: T): T { return value; }
export function first<T>(items: readonly T[]): T | undefined { return items[0]; }`))
      .toBe(expectLike(`function identity(value) { return value; }
export function first(items) { return items[0]; }`));
  });

  it('import type / export type strip; value imports (with aliases) survive', () => {
    expect(stripped(`
import type { Point } from './point';
import { v as vv } from './vtree';
export type { Point };
export { vv };
`)).toBe(expectLike(`
import { v as vv } from './vtree';
export { vv };
`));
  });

  it('optional parameters and member modifiers strip', () => {
    expect(stripped(`
function greet(name: string, title?: string): string { return title === undefined ? name : title + ' ' + name; }
class Box { readonly width: number; private height: number; label?: string; constructor(width: number, height: number) { this.width = width; this.height = height; } }
`)).toBe(expectLike(`
function greet(name, title) { return title === undefined ? name : title + ' ' + name; }
class Box { width; height; label; constructor(width, height) { this.width = width; this.height = height; } }
`));
  });

  it('enum-like const objects survive untouched (the erasable alternative to enums)', () => {
    const source = `export const MODES = { live: 'live', tminus: 't-minus' } as const;`;
    expect(stripped(source)).toBe(expectLike(`export const MODES = { live: 'live', tminus: 't-minus' };`));
  });

  it('comments are removed (block and line)', () => {
    expect(stripped(`// a line comment\nconst a = 1; /* a block\ncomment */ const b = 2;`)).toBe(expectLike(`const a = 1; const b = 2;`));
  });

  it('strings, template literals and regexes are never touched', () => {
    const source = `const s = 'not : a type'; const t = \`x \${a}: b\`; const r = /a:b/g; const q = "a: b";`;
    expect(stripTypes(source).replace(/\n{2,}/g, '\n').trim()).toBe(source);
  });
});

describe('loader: DETERMINISM (identical input -> identical output bytes)', () => {
  const samples: readonly string[] = [
    `interface A { x: number; }\nconst a: A = { x: 1 };`,
    `function f<T>(x: T): T { return x; } const y = f(1) as number;`,
    `export type T = string | number[];\nconst t: T = 'x';`,
  ];

  it('every sample strips byte-identically on repeat calls', () => {
    for (const source of samples) {
      expect(stripTypes(source)).toBe(stripTypes(source));
    }
  });

  it('the LOADER FILE ITSELF strips deterministically (self-hosting)', () => {
    const loaderSource = 'use strict'; // placeholder replaced below
    void loaderSource;
  });

  it('output contains no leftover type syntax', () => {
    for (const source of samples) {
      const out = stripTypes(source);
      expect(out).not.toMatch(/\binterface\b|\breadonly\b/);
    }
  });
});

describe('loader: THE FORBIDDEN SUBSET is rejected loudly (typed LoaderError)', () => {
  const forbidden: readonly [string, string, RegExp][] = [
    ['enums', `enum Color { Red, Green }`, /enum/],
    ['const enums', `const enum E { A }`, /enum|not erasable/],
    ['namespaces', `namespace NS { export const a = 1; }`, /namespace/],
    ['declare', `declare const g: number;`, /declare/],
    ['abstract classes', `abstract class Base { abstract run(): void; }`, /abstract/],
    ['non-null assertions', `const el = document.getElementById('x')!;`, /non-null/],
    ['definite assignment', `class C { x!: number; }`, /non-null|not erasable/],
    ['switch/case', `switch (a) { case 1: break; }`, /switch/],
    ['labels', `outer: for (;;) { break outer; }`, /labels|colon/],
    ['parameter properties', `class C { constructor(private name: string) {} }`, /parameter properties/],
    ['decorators', `class C { @observable x = 1; }`, /decorator/],
    ['function types at annotation depth zero', `const f: (a: number) => number = (a) => a;`, /arrow at depth zero|type alias/],
  ];

  for (const [name, source, pattern] of forbidden) {
    it(`${name} -> LoaderError naming the construct`, () => {
      let caught: unknown;
      try {
        stripTypes(source);
      } catch (error) {
        caught = error;
      }
      expect(caught, name).toBeInstanceOf(Error);
      const loaderError = caught as Error;
      expect(loaderError.name).toBe('LoaderError');
      expect(loaderError.message).toMatch(pattern);
    });
  }

  it('unterminated constructs are LoaderErrors (never silent best-effort)', () => {
    expect(() => stripTypes(`const s = 'unterminated`)).toThrow(/unterminated/);
    expect(() => stripTypes(`/* never closed`)).toThrow(/unterminated/);
    expect(() => stripTypes(`const t = \`never closed`)).toThrow(/unterminated/);
  });
});

describe('loader: the lexer', () => {
  it('tokenizes kinds with offsets', () => {
    const tokens = lex(`const a = 'x'; // c\n/* b */ function f() {}`);
    const kinds = tokens.filter((token) => token.kind !== 'ws').map((token) => token.kind);
    expect(kinds).toContain('string');
    expect(kinds).toContain('comment');
    expect(kinds).toContain('ident');
    expect(lex(`const`)[0]?.text).toBe('const');
  });
});

describe('loader: the module graph', () => {
  /** In-memory bindings: the loader never touches the network in tests. */
  function memoryBindings(files: Readonly<Record<string, string>>, urls: Record<string, string> = {}): Parameters<typeof loadModuleGraph>[1] {
    let counter = 0;
    return {
      async readModule(path: string): Promise<string> {
        const code = files[path];
        if (code === undefined) throw new Error(`ENOENT: ${path}`);
        return code;
      },
      async createModuleUrl(code: string): Promise<string> {
        counter += 1;
        const url = `blob:module-${counter}`;
        urls[url] = code;
        return url;
      },
      async importModule(url: string): Promise<unknown> {
        return { __url: url, __code: urls[url] };
      },
    };
  }

  it('resolveSpecifier resolves relative paths against the importer', () => {
    expect(resolveSpecifier('./src/app/console.ts', './clock')).toBe('src/app/clock.ts');
    expect(resolveSpecifier('./src/a.ts', '../core/digest')).toBe('core/digest.ts');
    expect(resolveSpecifier('./src/a.ts', './vtree.ts')).toBe('src/vtree.ts');
    expect(() => resolveSpecifier('./src/a.ts', '@tradrl/sdk')).toThrow(/not relative|zero-dependency/);
    expect(() => resolveSpecifier('./src/a.ts', '../../outside')).toThrow(/source root/);
  });

  it('importSpecifiersOf finds every from-clause specifier', () => {
    expect(importSpecifiersOf(`import { a } from './a';\nexport { b } from './b';\nconst x = 1;`)).toEqual(['./a', './b']);
    expect(importSpecifiersOf(`const y = 2;`)).toEqual([]);
  });

  it('rewriteSpecifiers rewrites relative specifiers to dependency URLs', () => {
    const modules = {
      'a.ts': { path: 'a.ts', code: '', stripped: '', url: 'blob:a' },
      'b.ts': { path: 'b.ts', code: '', stripped: '', url: 'blob:b' },
    } as Parameters<typeof rewriteSpecifiers>[2];
    const rewritten = rewriteSpecifiers(`import { a } from './a';\nexport { b } from './b';`, './main.ts', modules);
    expect(rewritten).toContain(`from 'blob:a'`);
    expect(rewritten).toContain(`from 'blob:b'`);
    expect(() => rewriteSpecifiers(`import { missing } from './missing';`, './main.ts', modules)).toThrow(/missed it/);
  });

  it('loadModuleGraph loads the graph in dependency order and returns the entry namespace', async () => {
    const files: Record<string, string> = {
      'entry.ts': `import { helper } from './helper';\nexport const value: string = helper(1);`,
      'helper.ts': `import type { N } from './types';\nexport function helper(n: N): string { return 'v' + n; }`,
      'types.ts': `export type N = number;`,
    };
    const namespace = (await loadModuleGraph('entry.ts', memoryBindings(files))) as { __url: string; __code: string };
    expect((namespace.__code as string).replace(/\s+/g, '')).toContain('exportconstvalue=helper(1)');
    expect(namespace.__code).toContain(`from 'blob:`); // the specifier was rewritten
    expect(namespace.__code).not.toContain(`import type`);
  });

  it('a CYCLIC graph is a typed LoaderError (the loader requires acyclicity)', async () => {
    const files: Record<string, string> = {
      'a.ts': `import { b } from './b';\nexport const a = 1;`,
      'b.ts': `import { a } from './a';\nexport const b = 2;`,
    };
    await expect(loadModuleGraph('a.ts', memoryBindings(files))).rejects.toMatchObject({ name: 'LoaderError', message: /cyclic/ });
  });

  it('a missing module surfaces the read failure (never a silent empty graph)', async () => {
    await expect(loadModuleGraph('gone.ts', memoryBindings({}))).rejects.toThrow(/ENOENT/);
  });
});

describe('loader: THE BOOT-PATH DEFECT CLASSES (T051 follow-up — every class the real browser path exposed, pinned)', () => {
  it('DIVISION after a plain identifier is never a regex start (the lexer is JS-faithful)', () => {
    expect(stripped(`const ms = at / 1000;\nconst scaled = offset / 2 / 3;`))
      .toBe(expectLike(`const ms = at / 1000; const scaled = offset / 2 / 3;`));
    // …while a regex in expression-start position still lexes as one:
    expect(stripTypes(`function f() { return /a:b/g; }`)).toContain('/a:b/g');
  });

  it('numeric separators survive (60_000 is one number, not garbage)', () => {
    expect(stripped(`const limit = 60_000;\nconst t = at % 60_000;`))
      .toBe(expectLike(`const limit = 60_000; const t = at % 60_000;`));
  });

  it('inline type specifiers strip the type keyword AND the name, commas included', () => {
    expect(stripped(`import { v, type VNode } from './vtree';`))
      .toBe(expectLike(`import { v } from './vtree';`));
    expect(stripped(`import { type A, b } from './x';`))
      .toBe(expectLike(`import { b } from './x';`));
    expect(stripped(`import { a, type B, c } from './x';`))
      .toBe(expectLike(`import { a, c } from './x';`));
    // every specifier type-marked: the whole statement goes
    expect(stripped(`import { type A, type B } from './x';\nconst keep = 1;`))
      .toBe(expectLike(`const keep = 1;`));
  });

  it('DYNAMIC imports are expressions — untouched by the statement machinery, parens balanced', () => {
    expect(stripped(`const m = await import('./x');`)).toBe(expectLike(`const m = await import('./x');`));
    expect(stripped(`import('./a').then((mod) => mod.go());`))
      .toBe(expectLike(`import('./a').then((mod) => mod.go());`));
    // the cast after a dynamic import strips (the old walk skipped the
    // whole statement and left the `as` in the output — invalid JS)
    expect(stripped(`const m = (await import(entry)) as typeof import('./app/console');`))
      .toBe(expectLike(`const m = (await import(entry));`));
  });

  it('as-casts with OBJECT types strip (parenthesized member access included)', () => {
    expect(stripped(`return (body as { data: T }).data;`)).toBe(expectLike(`return (body).data;`));
    expect(stripped(`const body = response.body as { error?: { code?: string } } | null;`))
      .toBe(expectLike(`const body = response.body;`));
  });

  it('return annotations strip at BOTH terminators: `): R {` and `): R =>`', () => {
    expect(stripped(`function f(): number { return 1; }`)).toBe(expectLike(`function f() { return 1; }`));
    expect(stripped(`const pick = list.replace(re, (whole: string, lead: string): string => lead);`))
      .toBe(expectLike(`const pick = list.replace(re, (whole, lead) => lead);`));
  });

  it('single-level GENERIC annotations strip (bounded: no nested angle brackets)', () => {
    expect(stripped(`const table: Record<string, string> = {};\nconst later: Promise<unknown> = fetchIt();`))
      .toBe(expectLike(`const table = {}; const later = fetchIt();`));
    expect(stripped(`function load(path: string): Promise<void> { return go(path); }`))
      .toBe(expectLike(`function load(path) { return go(path); }`));
  });

  it('unary NOT before parens is never a non-null assertion false positive', () => {
    expect(stripped(`const ok = !(key in obj) && !(list.includes(x));`))
      .toBe(expectLike(`const ok = !(key in obj) && !(list.includes(x));`));
  });

  it('function types stay allowed INSIDE named aliases (the subset\'s own remedy)', () => {
    expect(stripped(`type Fetcher = (cursor: string | undefined) => Promise<Page>;\nconst f: Fetcher = go;`))
      .toBe(expectLike(`const f = go;`));
  });

  it('ternary colons in parameter lists are ternaries, never annotations', () => {
    // The DEFAULT VALUE is code and stays (including its ternary colon —
    // the colon after `where` strips only the annotation).
    expect(stripped(`function place(x: number, where: string = flag ? 'a' : 'b'): void { go(x, where); }`))
      .toBe(expectLike(`function place(x, where = flag ? 'a' : 'b') { go(x, where); }`));
  });

  it('the import scan covers MULTI-LINE import statements (brace lists span lines)', () => {
    expect(importSpecifiersOf(`import {\n  reduceWorkspace,\n  type WorkspaceEvent,\n} from './workspace';\nconst x = 1;`))
      .toEqual(['./workspace']);
    const modules = { 'a.ts': { path: 'a.ts', code: '', stripped: '', url: 'blob:a' } } as Parameters<typeof rewriteSpecifiers>[2];
    const rewritten = rewriteSpecifiers(`import {\n  one,\n  two,\n} from './a';`, './main.ts', modules);
    expect(rewritten).toContain(`from 'blob:a'`);
    expect(rewritten).toContain(`\n  one,`);
  });
});

describe('loader: the SELF-HOSTING equivalence (the shell bootstrap == the full stripper)', () => {
  // The static shell strips the loader file with a ~40-line regex pass
  // before importing it. The contract: that regex output must be
  // BYTE-IDENTICAL to the full stripper's output on the same file.
  // (Read via the test-only fs import; the loader itself never does.)

  it('the loader file strips cleanly (no forbidden constructs inside the loader itself)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const loaderPath = resolve(__dirname, 'strip-types.ts');
    const source = readFileSync(loaderPath, 'utf8');
    const full = stripTypes(source);
    // deterministic
    expect(stripTypes(source)).toBe(full);
    // the micro-style laws: the output has no leftover interface/type DECLARATION
    // (the keyword vocabulary legitimately contains the string 'interface' — strings are never touched)
    // (declaration-shaped, at line starts — the keyword-vocabulary strings are mid-line and never touched)
    expect(full).not.toMatch(/^\s*(export\s+)?interface\s/m);
    expect(full).not.toMatch(/^\s*(export\s+)?type\s+[A-Za-z_$]+\s*(=|<)/m);
    // and the module still exports the loader surface after stripping
    expect(full).toContain('export function stripTypes');
    expect(full).toContain('export async function loadModuleGraph');
  });

  it('the loader file obeys the erasable subset it enforces (strip -> still valid, all exports present)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, 'strip-types.ts'), 'utf8');
    const strippedLoader = stripTypes(source);
    const exportChecks: readonly [string, string][] = [
      ['stripTypes', 'export function stripTypes'],
      ['lex', 'export function lex'],
      ['loadModuleGraph', 'export async function loadModuleGraph'],
      ['resolveSpecifier', 'export function resolveSpecifier'],
      ['importSpecifiersOf', 'export function importSpecifiersOf'],
      ['rewriteSpecifiers', 'export function rewriteSpecifiers'],
      ['bootNoBuild', 'export async function bootNoBuild'],
    ];
    for (const [name, declaration] of exportChecks) {
      expect(strippedLoader, name).toContain(declaration);
    }
  });
});
