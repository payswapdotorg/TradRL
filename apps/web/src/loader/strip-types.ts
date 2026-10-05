// @tradrl/web-console — THE NO-BUILD LOADER (self-hosting).
//
// THE LAW (Work Order T042): "A static shell: index.html at the
// package root plus a documented no-build loader (the app boots
// from the TS entry via the package main; no bundler, no framework,
// no runtime dependency — DOM APIs only)". This module is that
// loader, and it is SELF-HOSTING: the static shell's tiny bootstrap
// (inline in index.html) strips THIS file with a ~40-line regex
// pass (this file is written in a restricted erasable subset —
// the micro-style laws below), imports it as a module, and then
// THIS module's full tokenizer-based stripper handles every other
// source file (the general erasable subset). The equivalence is
// pinned by a test: the regex bootstrap's output on this file is
// byte-identical to the full stripper's output on this file.
//
// THE ERASABLE SUBSET (the full stripper's contract — enforced by
// loud LoaderError, never a silent mis-strip):
//   allowed:  interfaces, type aliases, annotations (params,
//             returns, declarators, class fields), as/satisfies
//             casts, generics on function/method declarations,
//             import type / export type, optional params (?:),
//             readonly/private/public/protected member modifiers,
//             optional class members, destructuring annotations.
//   forbidden (LoaderError): enums, namespaces, parameter
//             properties, decorators, declare, abstract classes,
//             non-null assertions (x!), switch/case and labels
//             (use maps and if/else), function types at annotation
//             depth zero (name a type alias instead), type syntax
//             inside template-literal interpolations, definite
//             assignment (x!: T).
//
// THE MICRO-STYLE LAWS (this file only, so the static shell's
// inline regex bootstrap can strip it BYTE-IDENTICALLY to the full
// stripper — the equivalence is pinned by a test that parses the
// real index.html, so the two can never drift):
//   - no imports (self-contained); no enums; no ternaries (if/else
//     only); no template literals; no as/satisfies casts; no
//     optional parameters; no generic functions; the one class (the
//     exported error type) carries no type syntax beyond constructor
//     param annotations; parameter annotations (including on the one
//     replace-callback) stay within the micro shapes below;
//   - annotations restricted to named types, single-level generics
//     (no nested angle brackets), arrays and unions — every
//     annotation and every parameter list on ONE line;
//   - type aliases single-line; interfaces close at column zero;
//   - object literal values are literals or shorthand — never bare
//     identifiers and never the keyword literals true/false/null/
//     undefined confusion-shapes after a key colon (build context
//     records through makeContext / shorthand instead);
//   - no ' as ' text inside string literals; string and regex
//     literals never contain the byte pairs // /* or */ (so the
//     comment passes can never self-mangle — this file's own
//     comment-stripping regexes are therefore built from strings
//     via new RegExp).
//
// Zero dependencies: pure string and array code, no DOM, no node
// builtins, no Math.random, no clock. Deterministic: identical
// input bytes strip to identical output bytes.

// ---------------------------------------------------------------------------
// The token model
// ---------------------------------------------------------------------------

/** One lexical token of the stripper's pass. */
export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly newlineBefore: boolean;
}

/** The token kinds. */
export type TokenKind = 'ws' | 'comment' | 'string' | 'template' | 'number' | 'regex' | 'ident' | 'punct';

/** The lexer's keyword vocabulary (contextual typing words included). */
const KEYWORDS: readonly string[] = [
  'abstract', 'as', 'async', 'await', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements',
  'import', 'in', 'infer', 'instanceof', 'interface', 'is', 'keyof', 'let',
  'module', 'namespace', 'new', 'of', 'private', 'protected', 'public',
  'readonly', 'return', 'satisfies', 'set', 'static', 'super', 'switch',
  'this', 'throw', 'try', 'type', 'typeof', 'var', 'void', 'while', 'yield',
];

/** `true` for identifier text that is a reserved word of the subset's grammar. */
function isKeyword(text: string): boolean {
  return KEYWORDS.indexOf(text) !== -1;
}

/** `true` when the char can start an identifier. */
function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

/** `true` when the char can continue an identifier. */
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

/** `true` when the char is a decimal digit. */
function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** The multi-character punctuators, longest first (the lexer's greedy set). */
const PUNCTUATORS: readonly string[] = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=',
  '*=', '/=', '%=', '&=', '|=', '^=', '**', '{', '}', '(', ')', '[', ']',
  ';', ',', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '?',
  ':', '.', '=', '@', '#',
];

/** The keywords after which a `/` starts a regex literal (the standard heuristic). */
const REGEX_PRECEDERS: readonly string[] = [
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
];

/** Scan one template literal from the opening backtick; returns the index just past the closing backtick. */
function scanTemplate(source: string, start: number): number {
  let pos = start + 1;
  while (pos < source.length) {
    const ch = source.charAt(pos);
    if (ch === '\\') {
      pos += 2;
      continue;
    }
    if (ch === '`') return pos + 1;
    if (ch === '$' && source.charAt(pos + 1) === '{') {
      pos = scanTemplateExpression(source, pos + 2);
      continue;
    }
    pos += 1;
  }
  throw new LoaderErrorImpl('the template literal opened at ' + start + ' is unterminated');
}

/** Scan a template interpolation expression from just past `${`; returns the index just past its matching `}`. */
function scanTemplateExpression(source: string, start: number): number {
  let depth = 1;
  let pos = start;
  while (pos < source.length) {
    const ch = source.charAt(pos);
    if (ch === '\\') {
      pos += 2;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      pos = scanQuoted(source, pos);
      continue;
    }
    if (ch === '`') {
      pos = scanTemplate(source, pos);
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return pos + 1;
    }
    pos += 1;
  }
  throw new LoaderErrorImpl('the template interpolation opened at ' + start + ' is unterminated');
}

/** Scan a quoted string from its opening quote; returns the index just past the closing quote. */
function scanQuoted(source: string, start: number): number {
  const quote = source.charAt(start);
  let pos = start + 1;
  while (pos < source.length) {
    const ch = source.charAt(pos);
    if (ch === '\\') {
      pos += 2;
      continue;
    }
    if (ch === quote) return pos + 1;
    pos += 1;
  }
  throw new LoaderErrorImpl('the string opened at ' + start + ' is unterminated');
}

/** Scan a regex literal from its opening `/`; returns the index just past the closing `/` (plus flags). */
function scanRegex(source: string, start: number): number {
  let pos = start + 1;
  let inClass = false;
  while (pos < source.length) {
    const ch = source.charAt(pos);
    if (ch === '\\') {
      pos += 2;
      continue;
    }
    if (ch === '[') inClass = true;
    if (ch === ']') inClass = false;
    if (ch === '/' && !inClass) {
      pos += 1;
      while (pos < source.length && isIdentPart(source.charAt(pos))) pos += 1;
      return pos;
    }
    if (ch === '\n') throw new LoaderErrorImpl('the regex literal opened at ' + start + ' spans a line');
    pos += 1;
  }
  throw new LoaderErrorImpl('the regex literal opened at ' + start + ' is unterminated');
}

/** `true` when a `/` before token `index` starts a regex (the prev-significant-token heuristic — JS-faithful: after a plain identifier `/` is DIVISION, never a regex). */
function regexAllowedAfter(tokens: readonly Token[], index: number): boolean {
  for (let scan = index - 1; scan >= 0; scan--) {
    const token = tokens[scan];
    if (token.kind === 'ws' || token.kind === 'comment') continue;
    if (token.kind === 'ident') return REGEX_PRECEDERS.indexOf(token.text) !== -1;
    if (token.kind === 'number' || token.kind === 'string' || token.kind === 'template' || token.kind === 'regex') return false;
    if (token.kind === 'punct') {
      return token.text !== ')' && token.text !== ']' && token.text !== '}' && token.text !== '++' && token.text !== '--';
    }
    return true;
  }
  return true;
}

/** Lex the whole source into tokens (comments included, whitespace included). */
export function lex(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let newlineBefore = false;
  while (pos < source.length) {
    const ch = source.charAt(pos);
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      const start = pos;
      while (pos < source.length && (source.charAt(pos) === ' ' || source.charAt(pos) === '\t' || source.charAt(pos) === '\r')) pos += 1;
      pushToken(tokens, 'ws', source, start, pos, newlineBefore);
      newlineBefore = false;
      continue;
    }
    if (ch === '\n') {
      const start = pos;
      pos += 1;
      pushToken(tokens, 'ws', source, start, pos, newlineBefore);
      newlineBefore = true;
      continue;
    }
    if (ch === '/' && source.charAt(pos + 1) === '/') {
      const start = pos;
      const end = source.indexOf('\n', pos);
      if (end === -1) {
        pos = source.length;
      } else {
        pos = end;
      }
      pushToken(tokens, 'comment', source, start, pos, newlineBefore);
      continue;
    }
    if (ch === '/' && source.charAt(pos + 1) === '*') {
      const start = pos;
      const end = source.indexOf('*/', pos + 2);
      if (end === -1) throw new LoaderErrorImpl('the block comment opened at ' + start + ' is unterminated');
      pos = end + 2;
      pushToken(tokens, 'comment', source, start, pos, newlineBefore);
      continue;
    }
    if (ch === '\'' || ch === '"') {
      const start = pos;
      pos = scanQuoted(source, pos);
      pushToken(tokens, 'string', source, start, pos, newlineBefore);
      continue;
    }
    if (ch === '`') {
      const start = pos;
      pos = scanTemplate(source, pos);
      pushToken(tokens, 'template', source, start, pos, newlineBefore);
      continue;
    }
    if (isDigit(ch) || (ch === '.' && isDigit(source.charAt(pos + 1)))) {
      const start = pos;
      while (pos < source.length) {
        const c = source.charAt(pos);
        if (isIdentPart(c) || c === '.' || ((c === '+' || c === '-') && (source.charAt(pos - 1) === 'e' || source.charAt(pos - 1) === 'E'))) {
          pos += 1;
          continue;
        }
        break;
      }
      pushToken(tokens, 'number', source, start, pos, newlineBefore);
      continue;
    }
    if (ch === '/' && regexAllowedAfter(tokens, tokens.length)) {
      const start = pos;
      pos = scanRegex(source, pos);
      pushToken(tokens, 'regex', source, start, pos, newlineBefore);
      continue;
    }
    if (isIdentStart(ch)) {
      const start = pos;
      while (pos < source.length && isIdentPart(source.charAt(pos))) pos += 1;
      pushToken(tokens, 'ident', source, start, pos, newlineBefore);
      continue;
    }
    const punctuator = matchPunctuator(source, pos);
    if (punctuator !== null) {
      const start = pos;
      pos += punctuator.length;
      pushToken(tokens, 'punct', source, start, pos, newlineBefore);
      continue;
    }
    throw new LoaderErrorImpl('the character ' + JSON.stringify(ch) + ' at offset ' + pos + ' is not lexable');
  }
  return tokens;
}

/** Push one token onto the list, returning it. */
function pushToken(tokens: Token[], kind: TokenKind, source: string, start: number, end: number, newlineBefore: boolean): Token {
  const token: Token = { kind, text: source.slice(start, end), start, end, newlineBefore };
  tokens.push(token);
  return token;
}

/** Match the longest punctuator at `pos`, or null. */
function matchPunctuator(source: string, pos: number): string | null {
  const candidates: string[] = [];
  for (let index = 0; index < PUNCTUATORS.length; index++) {
    const candidate = PUNCTUATORS[index];
    if (source.startsWith(candidate, pos)) candidates.push(candidate);
  }
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (let index = 1; index < candidates.length; index++) {
    if (candidates[index].length > best.length) best = candidates[index];
  }
  return best;
}

// ---------------------------------------------------------------------------
// The type-region scanner (character level — types have no comparisons)
// ---------------------------------------------------------------------------

/** The scan modes of a type region (where it is allowed to end). */
export type TypeScanMode = 'param' | 'declarator' | 'return' | 'cast' | 'generic';

/** The result of a type-region scan: where it ended and on what terminator. */
export interface TypeScan {
  readonly end: number;
  readonly terminator: string;
}


/** Build one type-scan result (shorthand only — the micro-style law: never bare identifiers after a key colon). */
function typeScan(end: number, terminator: string): TypeScan {
  return { end, terminator };
}

/** `true` when the char at `pos` continues a multi-line type (a leading `|`/`&` continuation line). */
function continuesType(source: string, pos: number): boolean {
  let scan = pos;
  while (scan < source.length && (source.charAt(scan) === ' ' || source.charAt(scan) === '\t' || source.charAt(scan) === '\r')) scan += 1;
  const ch = source.charAt(scan);
  return ch === '|' || ch === '&' || ch === '.';
}

/** `true` when the char before `pos` (skipping whitespace) is a union/intersection separator. */
function unionArmBefore(source: string, pos: number): boolean {
  let scan = pos - 1;
  while (scan >= 0) {
    const ch = source.charAt(scan);
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      scan -= 1;
      continue;
    }
    return ch === '|' || ch === '&';
  }
  return false;
}

/**
 * Scan one type region from just after its opening `:` (or `<` in
 * generic mode). Character level: in type syntax `<`/`>` are always
 * brackets and there are no comparison operators, so depth counting
 * is sound. The subset forbids `=>` inside annotations (name a type
 * alias for function types) — encountering one is a loud error.
 */
export function scanTypeRegion(source: string, start: number, mode: TypeScanMode): TypeScan {
  let pos = start;
  let depth = 0;
  while (pos < source.length) {
    const ch = source.charAt(pos);
    if (ch === '\'' || ch === '"') {
      pos = scanQuoted(source, pos);
      continue;
    }
    if (mode === 'return' && ch === '{' && depth === 0) {
      // An inline OBJECT return type: a `{` that LEADS the region or
      // continues a union/intersection arm (after `|`/`&`) opens a
      // type brace; any other `{` at depth zero is the function BODY
      // and ends the region here. (Decided from the region's own
      // leading text — never by probing the body, which holds real
      // code: strings, regexes and templates.)
      if (pos === start || unionArmBefore(source, pos)) {
        depth += 1;
        pos += 1;
        continue;
      }
      return typeScan(pos, ch);
    }
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
      depth += 1;
      pos += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
      if (depth === 0) {
        if (mode === 'param' && ch === ')') return typeScan(pos, ch);
        if (mode === 'cast' && (ch === ')' || ch === ']' || ch === '}')) return typeScan(pos, ch);
        if (mode === 'generic' && ch === '>') return typeScan(pos + 1, ch);
        throw new LoaderErrorImpl('the type region opened at ' + start + ' (' + mode + ') is unbalanced at offset ' + pos);
      }
      depth -= 1;
      pos += 1;
      continue;
    }
    if (ch === '=' && source.charAt(pos + 1) === '>') {
      if (depth === 0 && (mode === 'return' || mode === 'cast')) return typeScan(pos, '=>');
      throw new LoaderErrorImpl('the type region opened at ' + start + ' contains an arrow at depth zero — name a type alias for function types (the erasable subset)');
    }
    if (depth === 0) {
      if (ch === ',') return typeScan(pos, ch);
      if (ch === ';') return typeScan(pos, ch);
      if (ch === '=') return typeScan(pos, ch);
      if (ch === '{' && mode === 'return') return typeScan(pos, ch);
      if (ch === '?') return typeScan(pos, ch);
      if (ch === '\n') {
        if (mode === 'param' || mode === 'generic') {
          pos += 1;
          continue;
        }
        if (continuesType(source, pos + 1)) {
          pos += 1;
          continue;
        }
        return typeScan(pos, ch);
      }
    }
    pos += 1;
  }
  throw new LoaderErrorImpl('the type region opened at ' + start + ' runs to the end of the source');
}

// ---------------------------------------------------------------------------
// The statement-level type constructs (regex-free, token-walked)
// ---------------------------------------------------------------------------

/** The context kinds of the walk's brace/paren stack. */
export type ContextKind = 'top' | 'block' | 'object' | 'class' | 'paren' | 'bracket';

/** One walk context. */
export interface Context {
  readonly kind: ContextKind;
  readonly params: boolean;
  readonly openIndex: number;
  sawKey: boolean;
  expectingKey: boolean;
  memberLevel: boolean;
}

/** The module-graph loading bindings (everything injected — browser or test). */
export interface LoaderBindings {
  readModule(path: string): Promise<string>;
  createModuleUrl(code: string): Promise<string>;
  importModule(url: string): Promise<unknown>;
}

/** The loader's typed error (re-exported through the console's error module surface). */
export class LoaderErrorImpl extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoaderError';
  }
}

// ---------------------------------------------------------------------------
// The stripper
// ---------------------------------------------------------------------------

/** The walk state. */
export interface StripState {
  readonly source: string;
  readonly tokens: readonly Token[];
  readonly removals: Removal[];
  ctx: Context[];
  ternary: number[];
  constructorFlag: boolean;
}

/** One removal range (start inclusive, end exclusive) over the source. */
export interface Removal {
  readonly start: number;
  readonly end: number;
}

/** The main strip: erase every type construct; refuse every non-erasable one. */
export function stripTypes(source: string): string {
  const tokens = lex(source);
  const state: StripState = { source, tokens, removals: [], ctx: [makeContext('top', false, -1, true, false)], ternary: [], constructorFlag: false };
  walkRange(state, 0, tokens.length);
  const removals = state.removals.slice().sort(byStart);
  let output = '';
  let pos = 0;
  let covered = -1;
  for (let index = 0; index < removals.length; index++) {
    const removal = removals[index];
    if (removal.start < covered) {
      // Overlaps a removal already applied (e.g. a sub-walk re-removing a token inside
      // a region the first pass removed): merge — never re-emit the covered range.
      if (removal.end > pos) {
        pos = removal.end;
        covered = removal.end;
      }
      continue;
    }
    output += source.slice(pos, removal.start);
    pos = removal.end;
    covered = removal.end;
  }
  output += source.slice(pos);
  // The comment passes are built from strings via new RegExp (the
  // micro-style law): a regex-literal spelling of these patterns
  // would contain the byte pairs // and */ and be mangled by the
  // very pass it defines when THIS file strips itself.
  const blockComment = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
  const lineComment = new RegExp('[ \\t]*\\/\\/[^\\n]*', 'g');
  return output.replace(blockComment, '').replace(lineComment, '');
}

/** Sort removals by start. */
function byStart(a: Removal, b: Removal): number {
  return a.start - b.start;
}

/** The next code token at or after `index` (skipping ws, comments and tokens already scheduled for removal). */
function nextCode(state: StripState, index: number): Token | null {
  for (let scan = index; scan < state.tokens.length; scan++) {
    const token = state.tokens[scan];
    if (token.kind === 'ws' || token.kind === 'comment') continue;
    if (isRemoved(state, token)) continue;
    return token;
  }
  return null;
}

/** The previous code token before `index` (skipping ws, comments and tokens already scheduled for removal). */
function prevCode(state: StripState, index: number): Token | null {
  for (let scan = index - 1; scan >= 0; scan--) {
    const token = state.tokens[scan];
    if (token.kind === 'ws' || token.kind === 'comment') continue;
    if (isRemoved(state, token)) continue;
    return token;
  }
  return null;
}

/** The index of the matching close for the punctuator token at `open` (its token index). */
function matchingClose(state: StripState, open: number): number {
  const token = state.tokens[open];
  const closers: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const close = closers[token.text];
  let depth = 0;
  for (let scan = open; scan < state.tokens.length; scan++) {
    const candidate = state.tokens[scan];
    if (candidate.kind !== 'punct') continue;
    if (candidate.text === token.text || (token.text === '{' && (candidate.text === '${' ))) {
      depth += 1;
      continue;
    }
    if (candidate.text === close) {
      depth -= 1;
      if (depth === 0) return scan;
    }
  }
  throw new LoaderErrorImpl('the group opened at offset ' + token.start + ' is never closed');
}

/** Remove a source range. */
function remove(state: StripState, start: number, end: number): void {
  state.removals.push({ start, end });
}

/** `true` when the token's range is already scheduled for removal (e.g. a declarator annotation removed by its keyword walker). */
function isRemoved(state: StripState, token: Token): boolean {
  for (let scan = 0; scan < state.removals.length; scan++) {
    const range = state.removals[scan];
    if (token.start >= range.start && token.end <= range.end) return true;
  }
  return false;
}

/** Remove one token. */
function removeToken(state: StripState, token: Token): void {
  remove(state, token.start, token.end);
}

/** The top of the context stack. */
function top(state: StripState): Context {
  return state.ctx[state.ctx.length - 1];
}

/** Walk a token range [from, to) erasing type syntax (re-entrant — param groups sub-walk). */
function walkRange(state: StripState, from: number, to: number): void {
  let index = from;
  while (index < to) {
    const token = state.tokens[index];
    if (token.kind === 'ws' || token.kind === 'comment') {
      index += 1;
      continue;
    }
    index = walkToken(state, index, to);
  }
}

/** Handle one code token; returns the next index. Tokens already inside a scheduled removal are skipped whole (their syntax is gone — re-walking removed interiors corrupts the context stack). */
function walkToken(state: StripState, index: number, to: number): number {
  const token = state.tokens[index];
  if (isRemoved(state, token)) return index + 1;
  const source = state.source;
  const context = top(state);
  if (token.kind === 'ident') {
    return walkIdent(state, index, token, context);
  }
  if (token.kind === 'punct') {
    return walkPunct(state, index, token, context, to);
  }
  return index + 1;
}

/** Handle one identifier/keyword token. */
function walkIdent(state: StripState, index: number, token: Token, context: Context): number {
  const source = state.source;
  const text = token.text;
  const after = nextCode(state, index + 1);
  if (context.kind === 'paren' && context.params) {
    // Parameter modifiers are type-only syntax (parameter properties are refused below).
    if (text === 'readonly') {
      removeToken(state, token);
      return index + 1;
    }
    if (text === 'public' || text === 'private' || text === 'protected') {
      if (state.constructorFlag) throw new LoaderErrorImpl('parameter properties (constructor parameter modifiers) are not erasable — assign the field in the constructor body instead (offset ' + token.start + ')');
      removeToken(state, token);
      return index + 1;
    }
  }
  if ((text === 'enum' || text === 'namespace' || text === 'module' || text === 'declare') && after !== null && after.kind === 'ident') {
    throw new LoaderErrorImpl('the ' + text + ' syntax at offset ' + token.start + ' is not erasable — the no-build loader refuses it (use interfaces, type aliases and plain objects)');
  }
  if (text === 'interface') {
    return removeInterface(state, index);
  }
  if (text === 'type' && after !== null && after.kind === 'ident') {
    const beyond = nextCode(state, tokenIndexAfter(state, after));
    if (beyond !== null && beyond.text === '=' ) {
      return removeTypeAlias(state, index);
    }
    if (beyond !== null && beyond.text === '<') {
      return removeTypeAlias(state, index);
    }
  }
  if (text === 'import') {
    return walkImport(state, index);
  }
  if (text === 'export') {
    return walkExport(state, index);
  }
  if (text === 'function') {
    return walkFunctionHead(state, index);
  }
  if (text === 'class') {
    return walkClassHead(state, index);
  }
  if (text === 'as' || text === 'satisfies') {
    const previous = prevCode(state, index);
    if (previous !== null && previous.kind === 'punct' && previous.text === '.') {
      return index + 1;
    }
    return removeCast(state, index, token);
  }
  if (text === 'abstract' || text === 'accessor' || text === 'override') {
    throw new LoaderErrorImpl('the ' + text + ' modifier at offset ' + token.start + ' is not erasable in this subset');
  }
  if (text === 'switch') {
    throw new LoaderErrorImpl('switch/case is not supported by the erasable subset — use a lookup map or if/else (offset ' + token.start + ')');
  }
  // A declarator binding: const/let/var NAME [: Type] [= init]
  if (text === 'const' || text === 'let' || text === 'var') {
    return walkDeclaratorKeyword(state, index);
  }
  // Class member modifiers and heads are handled at the punct level.
  if (context.kind === 'class' && context.memberLevel) {
    if (text === 'readonly' || text === 'public' || text === 'private' || text === 'protected') {
      removeToken(state, token);
      return index + 1;
    }
    if (text === 'get' || text === 'set' || text === 'static' || text === 'async') {
      return index + 1;
    }
    // A member name: field or method.
    if (after !== null && after.kind === 'punct' && after.text === '(') {
      state.constructorFlag = text === 'constructor';
      return index + 1;
    }
    if (after !== null && after.kind === 'punct' && after.text === '<') {
      throw new LoaderErrorImpl('generic class methods are not erasable in this subset (offset ' + token.start + ')');
    }
    return index + 1;
  }
  if (context.kind === 'object' && context.memberLevel) {
    if (after !== null && after.kind === 'punct' && after.text === '(') {
      return index + 1;
    }
    return index + 1;
  }
  return index + 1;
}

/** Handle one punctuator token. */
function walkPunct(state: StripState, index: number, token: Token, context: Context, to: number): number {
  const source = state.source;
  const text = token.text;
  const after = nextCode(state, index + 1);
  if (text === '@') {
    throw new LoaderErrorImpl('decorators are not erasable (offset ' + token.start + ')');
  }
  if (text === '!') {
    const previous = prevCode(state, index);
    const afterExpression = previous !== null && (previous.kind === 'string' || previous.kind === 'number' || previous.kind === 'template'
      || (previous.kind === 'ident' && isKeyword(previous.text) === false)
      || (previous.kind === 'punct' && (previous.text === ')' || previous.text === ']')));
    const nextText = source.charAt(token.end);
    if (afterExpression && (nextText === '.' || nextText === '[' || nextText === '(' || nextText === ';' || nextText === ',' || nextText === ')' || nextText === ':' || nextText === ' ' || nextText === '\n' || nextText === '\t')) {
      throw new LoaderErrorImpl('the non-null assertion at offset ' + token.start + ' is not erasable — check explicitly instead');
    }
    // `x!(…)`, `x!.y`, `x![…]`: an assertion can only follow an
    // expression END. A `!` in OPERATOR position is a unary NOT —
    // `!(cond)` is ordinary code, never an assertion (the day-one
    // unary-not-before-parens false positive).
    if (afterExpression && after !== null && after.kind === 'punct' && (after.text === '.' || after.text === '[' || after.text === '(')) {
      throw new LoaderErrorImpl('the non-null assertion at offset ' + token.start + ' is not erasable — check explicitly instead');
    }
    return index + 1;
  }
  if (text === '?') {
    if (context.kind === 'paren' && context.params) {
      const nextChar = source.charAt(token.end);
      if (nextChar === ':') {
        removeToken(state, token);
        return index + 1;
      }
    }
    if (context.kind === 'class' && context.memberLevel) {
      const nextChar = source.charAt(token.end);
      if (nextChar === ':') {
        removeToken(state, token);
        return index + 1;
      }
    }
    state.ternary.push(state.ctx.length);
    return index + 1;
  }
  if (text === ':') {
    if (isRemoved(state, token)) return index + 1;
    if (state.ternary.length > 0 && state.ternary[state.ternary.length - 1] === state.ctx.length) {
      state.ternary.pop();
      return index + 1;
    }
    if (context.kind === 'object') {
      if (context.expectingKey && context.sawKey === false) {
        return index + 1;
      }
      if (context.sawKey) {
        context.sawKey = false;
        return index + 1;
      }
    }
    if (context.kind === 'paren') {
      // A parameter annotation (function/arrow/catch params): strip the colon and the type region.
      const scan = scanTypeRegion(source, skipWs(source, token.end), 'param');
      remove(state, token.start, scan.end);
      return index + 1;
    }
    if (context.kind === 'class' && context.memberLevel) {
      // A class field annotation: strip the colon and the type region (ends at the member semicolon).
      const scan = scanTypeRegion(source, skipWs(source, token.end), 'param');
      remove(state, token.start, scan.end);
      return index + 1;
    }
    throw new LoaderErrorImpl('the colon at offset ' + token.start + ' is neither an object key nor a ternary branch nor an annotation — labels and switch/case are not erasable');
  }
  if (text === '(') {
    const previous = prevCode(state, index);
    const isHead = previous !== null && previous.kind === 'ident' && isKeyword(previous.text) === false && (context.kind === 'class' || context.kind === 'object') && context.memberLevel;
    const isFunction = previous !== null && previous.kind === 'ident' && (previous.text === 'function');
    state.ctx.push(makeContext('paren', isHead || isFunction, index, false, false));
    return index + 1;
  }
  if (text === ')') {
    const closed = top(state);
    if (closed.kind !== 'paren') throw new LoaderErrorImpl('unbalanced close paren at offset ' + token.start);
    state.ctx.pop();
    const next = after;
    if (next !== null && next.kind === 'punct' && next.text === '=>') {
      subwalkParams(state, closed.openIndex, index);
      state.constructorFlag = false;
      return index + 1;
    }
    if (next !== null && next.kind === 'punct' && next.text === ':') {
      if (state.ternary.length > 0 && state.ternary[state.ternary.length - 1] === state.ctx.length) {
        // The colon belongs to a ternary branch (cond ? f(a) : b) — leave the
        // ternary marker for the colon's own handler to pop.
        state.constructorFlag = false;
        return index + 1;
      }
      const scan = scanTypeRegion(source, skipWs(source, next.end), 'return');
      if (scan.terminator === '=>' || scan.terminator === '{') {
        subwalkParams(state, closed.openIndex, index);
        remove(state, next.start, scan.end);
        state.constructorFlag = false;
        if (scan.terminator === '{') {
          const bodyOpen = nextCode(state, indexOfTokenEndingAt(state, scan.end));
          if (bodyOpen !== null && bodyOpen.text === '{') {
            state.ctx.push(makeContext('block', false, -1, false, false));
            return tokenIndexAfter(state, bodyOpen);
          }
        }
        return index + 1;
      }
      throw new LoaderErrorImpl('the colon after the group closing at offset ' + token.start + ' is not a return annotation — the erasable subset refuses it');
    }
    state.constructorFlag = false;
    return index + 1;
  }
  if (text === '{') {
    const previous = prevCode(state, index);
    const isObject = previous !== null && previous.kind === 'punct' && (previous.text === '=' || previous.text === '(' || previous.text === ',' || previous.text === '[' || previous.text === ':' || previous.text === '=>' || previous.text === '&&' || previous.text === '||' || previous.text === '??' || previous.text === '?' || previous.text === '!' || previous.text === 'return' ) ;
    const isObjectIdent = previous !== null && previous.kind === 'ident' && (previous.text === 'return' || previous.text === 'typeof' || previous.text === 'await' || previous.text === 'case' || previous.text === 'new' || previous.text === 'void' || previous.text === 'throw' || previous.text === 'yield' || previous.text === 'do');
    const isObjectPunct = previous !== null && previous.kind === 'punct' && (previous.text === '=' || previous.text === '(' || previous.text === ',' || previous.text === '[' || previous.text === ':' || previous.text === '=>' || previous.text === '&&' || previous.text === '||' || previous.text === '??' || previous.text === '?' || previous.text === '!');
    if (isObjectPunct || isObjectIdent) {
      state.ctx.push(makeContext('object', false, index, true, true));
      return index + 1;
    }
    if (classBodyPending(state)) {
      clearClassPending(state);
      state.ctx.push(makeContext('class', false, index, true, false));
      return index + 1;
    }
    state.ctx.push(makeContext('block', false, index, false, false));
    return index + 1;
  }
  if (text === '}') {
    const closed = top(state);
    if (closed.kind === 'top') throw new LoaderErrorImpl('unbalanced close brace at offset ' + token.start);
    state.ctx.pop();
    return index + 1;
  }
  if (text === '[') {
    state.ctx.push(makeContext('bracket', false, index, false, false));
    return index + 1;
  }
  if (text === ']') {
    const closed = top(state);
    if (closed.kind !== 'bracket') throw new LoaderErrorImpl('unbalanced close bracket at offset ' + token.start);
    state.ctx.pop();
    return index + 1;
  }
  if (text === ',' && context.kind === 'object') {
    context.expectingKey = true;
    context.sawKey = false;
    return index + 1;
  }
  if (text === ';') {
    if (context.kind === 'class') {
      context.memberLevel = true;
    }
    if (context.kind === 'paren') {
      // A class field inside a paren never occurs; the member-level reset lives on the class context.
    }
    return index + 1;
  }
  if (text === '(' || text === ')') {
    return index + 1;
  }
  return index + 1;
}

/** Skip whitespace/comments from `pos`; returns the first code char position. */
function skipWs(source: string, pos: number): number {
  let scan = pos;
  while (scan < source.length) {
    const ch = source.charAt(scan);
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      scan += 1;
      continue;
    }
    if (ch === '/' && source.charAt(scan + 1) === '/') {
      const end = source.indexOf('\n', scan);
      if (end === -1) {
        scan = source.length;
      } else {
        scan = end;
      }
      continue;
    }
    if (ch === '/' && source.charAt(scan + 1) === '*') {
      const end = source.indexOf('*/', scan + 2);
      if (end === -1) {
        scan = source.length;
      } else {
        scan = end + 2;
      }
      continue;
    }
    return scan;
  }
  return scan;
}

/** The token index whose `end` equals `pos`, or -1. */
function indexOfTokenEndingAt(state: StripState, pos: number): number {
  for (let scan = 0; scan < state.tokens.length; scan++) {
    if (state.tokens[scan].end === pos) return scan;
  }
  return -1;
}


/** The token index of a given token, or -1. */
function indexOfToken(state: StripState, token: Token): number {
  for (let scan = 0; scan < state.tokens.length; scan++) {
    if (state.tokens[scan] === token) return scan;
  }
  return -1;
}

/** The token index after the given token. */
function tokenIndexAfter(state: StripState, token: Token): number {
  for (let scan = 0; scan < state.tokens.length; scan++) {
    if (state.tokens[scan] === token) return scan + 1;
  }
  return state.tokens.length;
}

/** Sub-walk a parameter group's interior [open+1, close) with a params context. */
function subwalkParams(state: StripState, open: number, close: number): void {
  const saved = state.ctx.slice();
  const savedTernary = state.ternary.slice();
  state.ctx = [makeContext('top', false, -1, true, false), makeContext('paren', true, open, true, false)];
  state.ternary = [];
  walkRange(state, open + 1, close);
  state.ctx = saved;
  state.ternary = savedTernary;
}

/** Remove an interface (or export interface) declaration: keyword through the matching brace. */
function removeInterface(state: StripState, index: number): number {
  const source = state.source;
  let scan = index;
  let depth = 0;
  let opened = -1;
  while (scan < state.tokens.length) {
    const token = state.tokens[scan];
    if (token.kind === 'punct' && token.text === '{') {
      if (depth === 0) opened = scan;
      depth += 1;
    }
    if (token.kind === 'punct' && token.text === '}') {
      depth -= 1;
      if (depth === 0) {
        const previous = prevCode(state, index);
        let start = state.tokens[index].start;
        if (previous !== null && previous.kind === 'ident' && previous.text === 'export') start = previous.start;
        remove(state, start, token.end);
        return scan + 1;
      }
    }
    scan += 1;
  }
  throw new LoaderErrorImpl('the interface at offset ' + state.tokens[index].start + ' is never closed');
}

/** Remove a type alias (or export type alias): keyword through the statement end — multi-line union aliases are ONE alias. */
function removeTypeAlias(state: StripState, index: number): number {
  const tokens = state.tokens;
  let scan = index + 1;
  let depth = 0;
  let sawEquals = false;
  while (scan < tokens.length) {
    const token = tokens[scan];
    if (token.kind === 'punct') {
      if (token.text === '(' || token.text === '[' || token.text === '{') depth += 1;
      if (token.text === ')' || token.text === ']' || token.text === '}') depth -= 1;
      if (depth === 0 && token.text === '=' && sawEquals === false) {
        sawEquals = true;
        scan += 1;
        continue;
      }
      if (depth === 0 && token.text === ';') {
        const previous = prevCode(state, index);
        let start = tokens[index].start;
        if (previous !== null && previous.kind === 'ident' && previous.text === 'export') start = previous.start;
        remove(state, start, token.end);
        return scan + 1;
      }
    }
    if (token.kind === 'ws' && token.text.indexOf('\n') !== -1 && depth === 0 && sawEquals) {
      // A newline ends the alias only when the type does not continue
      // on the next line (a leading `|`/`&` arm) and did not trail one
      // on this line — `type X =\n  | A\n  | B` is one alias.
      if (typeContinuesAfter(state, scan)) {
        scan += 1;
        continue;
      }
      const previous = prevCode(state, index);
      let start = tokens[index].start;
      if (previous !== null && previous.kind === 'ident' && previous.text === 'export') start = previous.start;
      remove(state, start, token.start);
      return scan + 1;
    }
    scan += 1;
  }
  throw new LoaderErrorImpl('the type alias at offset ' + tokens[index].start + ' never ends');
}

/** `true` when the type alias continues around the newline token at `index` (a union arm on either side). */
function typeContinuesAfter(state: StripState, index: number): boolean {
  const next = nextCode(state, index + 1);
  if (next !== null && next.kind === 'punct' && (next.text === '|' || next.text === '&')) return true;
  const previous = prevCode(state, index);
  if (previous !== null && previous.kind === 'punct' && (previous.text === '|' || previous.text === '&')) return true;
  return false;
}

/** Walk an import statement: drop `import type` entirely; drop type-marked specifiers. */
function walkImport(state: StripState, index: number): number {
  const tokens = state.tokens;
  const after = nextCode(state, index + 1);
  if (after !== null && after.kind === 'punct' && after.text === '(') {
    // A DYNAMIC import (`import(...)`): an expression, never a
    // statement — the specifier-list machinery must not touch it
    // (skipping past one desynchronized the walk and left its `as`
    // casts and closers unhandled — the day-one dynamic-import bug).
    return index + 1;
  }
  if (after !== null && after.kind === 'ident' && after.text === 'type') {
    return removeImportStatement(state, index);
  }
  return cleanSpecifierList(state, index);
}

/** Walk an export statement: drop `export type` forms; keep value exports. */
function walkExport(state: StripState, index: number): number {
  const tokens = state.tokens;
  const after = nextCode(state, index + 1);
  if (after !== null && after.kind === 'ident' && after.text === 'type') {
    const name = nextCode(state, tokenIndexAfter(state, after));
    let terminator: Token | null = name;
    if (name !== null && name.kind === 'ident') terminator = nextCode(state, tokenIndexAfter(state, name));
    if (terminator !== null && terminator.kind === 'punct' && terminator.text === '{') {
      return removeExportTypeSpecifiers(state, index);
    }
    if (terminator !== null && terminator.kind === 'punct' && (terminator.text === '=' || terminator.text === '<')) {
      // `export type X = ...` / `export type X<...> = ...`: a type alias — remove
      // it through the alias terminator (unions of strings included).
      let aliasIndex = indexOfToken(state, after);
      if (aliasIndex === -1) aliasIndex = index;
      return removeTypeAlias(state, aliasIndex);
    }
    return removeImportStatement(state, index);
  }
  if (after !== null && after.kind === 'punct' && after.text === '{') {
    // `export { ... }` (with optional `from '...'`): the list may carry `as`
    // aliases — skip past the whole statement, never strip them as casts.
    return endOfImportStatement(state, index + 1);
  }
  return index + 1;
}

/** Remove a whole import/export statement from its keyword to its terminator. */
function removeImportStatement(state: StripState, index: number): number {
  const tokens = state.tokens;
  let scan = index;
  while (scan < tokens.length) {
    const token = tokens[scan];
    if (token.kind === 'punct' && token.text === ';') {
      remove(state, tokens[index].start, token.end);
      return scan + 1;
    }
    if (token.kind === 'string') {
      const end = token.end;
      let next = scan + 1;
      while (next < tokens.length && (tokens[next].kind === 'ws' || tokens[next].kind === 'comment')) next += 1;
      if (next < tokens.length && tokens[next].kind === 'punct' && tokens[next].text === ';') {
        remove(state, tokens[index].start, tokens[next].end);
        return next + 1;
      }
      remove(state, tokens[index].start, end);
      return scan + 1;
    }
    scan += 1;
  }
  remove(state, tokens[index].start, tokens[tokens.length - 1].end);
  return tokens.length;
}

/** Clean an import statement's specifier list: drop `type X` entries (and the statement if nothing remains). */
function cleanSpecifierList(state: StripState, index: number): number {
  const tokens = state.tokens;
  let scan = index;
  while (scan < tokens.length) {
    const token = tokens[scan];
    if (token.kind === 'string' || (token.kind === 'punct' && token.text === ';')) break;
    if (token.kind === 'punct' && token.text === '{') {
      const close = matchingClose(state, scan);
      cleanBraces(state, scan, close);
      const specifiers = countValueSpecifiers(state, scan, close);
      const beforeBraces = prevCode(state, scan);
      const hasDefault = beforeBraces !== null && beforeBraces.kind === 'ident' && beforeBraces.text !== 'from' && isKeyword(beforeBraces.text) === false && beforeBraces.start > tokens[index].start;
      if (specifiers === 0 && hasDefault === false) {
        return removeImportStatement(state, index);
      }
      // Skip past the whole statement: the specifier list may carry `as` aliases,
      // which are NOT casts and must never be stripped.
      return endOfImportStatement(state, close + 1);
    }
    scan += 1;
  }
  return endOfImportStatement(state, index + 1);
}

/** The token index just past an import/export statement's terminator (the from-string and its optional semicolon). */
function endOfImportStatement(state: StripState, from: number): number {
  const tokens = state.tokens;
  let scan = from;
  while (scan < tokens.length) {
    const token = tokens[scan];
    if (token.kind === 'string') {
      let next = scan + 1;
      while (next < tokens.length && (tokens[next].kind === 'ws' || tokens[next].kind === 'comment')) next += 1;
      if (next < tokens.length && tokens[next].kind === 'punct' && tokens[next].text === ';') return next + 1;
      return scan + 1;
    }
    if (token.kind === 'punct' && token.text === ';') return scan + 1;
    if (token.kind === 'punct' && token.text === '{') {
      // a second brace group (export ... from): keep scanning past it
      scan = matchingClose(state, scan) + 1;
      continue;
    }
    scan += 1;
  }
  return tokens.length;
}

/** Remove `export type { ... }` statements entirely. */
function removeExportTypeSpecifiers(state: StripState, index: number): number {
  const tokens = state.tokens;
  let scan = index;
  while (scan < tokens.length) {
    const token = tokens[scan];
    if (token.kind === 'punct' && token.text === ';') {
      remove(state, tokens[index].start, token.end);
      return scan + 1;
    }
    if (token.kind === 'string') {
      return removeImportStatement(state, index);
    }
    scan += 1;
  }
  remove(state, tokens[index].start, tokens[tokens.length - 1].end);
  return tokens.length;
}

/**
 * Clean a `{ ... }` specifier list of type-marked entries: a group that
 * is exactly `type NAME` is dropped TOGETHER WITH its adjacent
 * separator comma, so `import { v, type VNode }` becomes
 * `import { v }` and `import { type A, type B }` becomes `import { }`.
 * (The old form removed `tokens[scan - 1]` — the WHITESPACE between
 * `type` and the name, leaving the `type` keyword itself in the
 * output: `import { v, type }` — the day-one inline-type bug.)
 */
function cleanBraces(state: StripState, open: number, close: number): void {
  const tokens = state.tokens;
  let groupStart = open + 1;
  let separator: Token | null = null;
  let kept = false;
  for (let scan = open + 1; scan <= close; scan++) {
    const token = tokens[scan];
    if (scan !== close && (token.kind !== 'punct' || token.text !== ',')) continue;
    // scan is the group's separating comma, or `close` (the list's end).
    let head: Token | null = null;
    let name: Token | null = null;
    let codeCount = 0;
    for (let inner = groupStart; inner < scan; inner++) {
      const innerToken = tokens[inner];
      if (innerToken.kind === 'ws' || innerToken.kind === 'comment') continue;
      codeCount += 1;
      if (codeCount === 1) head = innerToken;
      if (codeCount === 2) name = innerToken;
    }
    const isTypeGroup = head !== null && name !== null && codeCount === 2
      && head.kind === 'ident' && head.text === 'type' && name.kind === 'ident';
    if (isTypeGroup && head !== null && name !== null) {
      removeToken(state, head);
      removeToken(state, name);
      if (kept && separator !== null) {
        // A value specifier precedes: drop THIS group's leading comma.
        removeToken(state, separator);
      } else if (scan !== close) {
        // Nothing kept yet and a group follows: drop the trailing comma.
        removeToken(state, token);
      }
    } else {
      kept = true;
    }
    if (scan !== close) separator = token;
    groupStart = scan + 1;
  }
}

/** Count the value specifiers inside a cleaned `{ ... }` list (the `type` lookahead stays INSIDE the braces and ignores removals — a removed-name lookahead that escapes the braces would count the `type` keyword itself as a value specifier). */
function countValueSpecifiers(state: StripState, open: number, close: number): number {
  const tokens = state.tokens;
  let count = 0;
  let pendingType = false;
  for (let scan = open + 1; scan < close; scan++) {
    const token = tokens[scan];
    if (token.kind === 'ident' && token.text === 'type') {
      let probe = scan + 1;
      while (probe < close && (tokens[probe].kind === 'ws' || tokens[probe].kind === 'comment')) probe += 1;
      if (probe < close && tokens[probe].kind === 'ident') {
        pendingType = true;
        continue;
      }
    }
    if (token.kind === 'ident' && !pendingType) count += 1;
    if (token.kind === 'punct' && token.text === ',') pendingType = false;
    if (token.kind === 'ident') pendingType = false;
  }
  return count;
}

/** Walk a function head: name, optional generics (removed), params (sub-walked at close), optional return annotation. */
function walkFunctionHead(state: StripState, index: number): number {
  const tokens = state.tokens;
  let scan = index + 1;
  const nameToken = nextCode(state, scan);
  if (nameToken !== null && nameToken.kind === 'ident' && isKeyword(nameToken.text) === false) {
    scan = tokenIndexAfter(state, nameToken);
  }
  if (nameToken !== null && nameToken.kind === 'punct' && nameToken.text === '*') {
    const afterStar = nextCode(state, tokenIndexAfter(state, nameToken));
    if (afterStar !== null && afterStar.kind === 'ident') scan = tokenIndexAfter(state, afterStar);
  }
  const generics = nextCode(state, scan);
  if (generics !== null && generics.kind === 'punct' && generics.text === '<') {
    const typeScan = scanTypeRegion(state.source, generics.end, 'generic');
    remove(state, generics.start, typeScan.end);
    scan = indexOfTokenEndingAt(state, typeScan.end);
    if (scan === -1) scan = tokenIndexAfter(state, generics);
  }
  return scan;
}

/** Walk a class head: name, optional extends clause; the body `{` is claimed by the pending flag. */
function walkClassHead(state: StripState, index: number): number {
  const tokens = state.tokens;
  setClassPending(state, true);
  let scan = index + 1;
  let seenName = false;
  while (scan < tokens.length) {
    const token = tokens[scan];
    if (token.kind === 'punct' && token.text === '{') break;
    if (token.kind === 'ident') {
      if (token.text === 'abstract') throw new LoaderErrorImpl('abstract classes are not erasable (offset ' + token.start + ')');
      seenName = seenName || isKeyword(token.text) === false;
      scan += 1;
      continue;
    }
    scan += 1;
  }
  return index + 1;
}

/** Walk a declarator keyword: binding name/pattern, optional annotation, initializer handled by expression contexts. */
function walkDeclaratorKeyword(state: StripState, index: number): number {
  const tokens = state.tokens;
  const after = nextCode(state, index + 1);
  if (after === null) return index + 1;
  if (after.kind === 'ident' && (after.text === 'enum' || after.text === 'namespace' || after.text === 'module' || after.text === 'declare' || after.text === 'abstract' || after.text === 'switch')) {
    // `const enum` and friends: let the walk visit the forbidden keyword itself.
    return index + 1;
  }
  if (after.kind === 'ident') {
    const annotation = nextCode(state, tokenIndexAfter(state, after));
    if (annotation !== null && annotation.kind === 'punct' && annotation.text === ':') {
      const scan = scanTypeRegion(state.source, skipWs(state.source, annotation.end), 'declarator');
      remove(state, annotation.start, scan.end);
    }
    return tokenIndexAfter(state, after);
  }
  if (after.kind === 'punct' && (after.text === '{' || after.text === '[')) {
    const close = matchingClose(state, tokenIndexAfter(state, after) - 1);
    const annotation = nextCode(state, close + 1);
    if (annotation !== null && annotation.kind === 'punct' && annotation.text === ':') {
      const scan = scanTypeRegion(state.source, skipWs(state.source, annotation.end), 'declarator');
      remove(state, annotation.start, scan.end);
    }
    return close + 1;
  }
  return index + 1;
}

/** Remove an `as Type` / `satisfies Type` cast. */
function removeCast(state: StripState, index: number, token: Token): number {
  const scan = scanTypeRegion(state.source, skipWs(state.source, token.end), 'cast');
  let lead = token.start;
  const previous = prevCode(state, index);
  if (previous !== null) lead = previous.end;
  remove(state, lead, scan.end);
  // Resume AT the region's terminator token (a resume on the token
  // BEFORE it would re-walk a closer and corrupt the context stack —
  // the `(x as T).y` mis-strip class).
  const resume = indexOfTokenStartingAt(state, scan.end);
  if (resume !== -1) return resume;
  return index + 1;
}

/** The token index whose `start` equals `pos`, or -1. */
function indexOfTokenStartingAt(state: StripState, pos: number): number {
  for (let scan = 0; scan < state.tokens.length; scan++) {
    if (state.tokens[scan].start === pos) return scan;
  }
  return -1;
}

/** Build one walk context. Shorthand values only — the micro-style law: never a bare keyword literal after a key colon (the shell's regex pass would eat `: false` as a union-arm annotation). */
function makeContext(kind: ContextKind, params: boolean, openIndex: number, memberLevel: boolean, expectingKey: boolean): Context {
  const sawKey = false;
  return { kind, params, openIndex, sawKey, expectingKey, memberLevel };
}

// ---------------------------------------------------------------------------
// The class-body pending flag (module-scoped — the walk is single-threaded)
// ---------------------------------------------------------------------------

let classPending = false;

/** Set the class-body pending flag (the next `{` opens a class body). */
function setClassPending(state: StripState, value: boolean): void {
  classPending = value;
}

/** Read the class-body pending flag. */
function classBodyPending(state: StripState): boolean {
  return classPending;
}

/** Clear the class-body pending flag. */
function clearClassPending(state: StripState): void {
  classPending = false;
}

// ---------------------------------------------------------------------------
// The module-graph loader
// ---------------------------------------------------------------------------

/** Resolve a relative specifier against an importer path (both repo-relative, '/'-separated). */
export function resolveSpecifier(importer: string, specifier: string): string {
  if (specifier.startsWith('./') === false && specifier.startsWith('../') === false) {
    throw new LoaderErrorImpl('the specifier ' + JSON.stringify(specifier) + ' in ' + importer + ' is not relative — the console is zero-dependency; every import is a workspace-relative path');
  }
  let importerDir = '';
  if (importer.indexOf('/') !== -1) importerDir = importer.slice(0, importer.lastIndexOf('/'));
  const parts = (importerDir + '/' + specifier).split('/');
  const stack: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part.length === 0 || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) throw new LoaderErrorImpl('the specifier ' + JSON.stringify(specifier) + ' in ' + importer + ' escapes the source root');
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  let resolved = stack.join('/');
  if (resolved.endsWith('.ts') === false) resolved = resolved + '.ts';
  return resolved;
}

/** One loaded module of the graph. */
export interface LoadedModule {
  readonly path: string;
  readonly code: string;
  readonly stripped: string;
  readonly url: string;
}

/** Load the whole module graph from an entry and return the entry module's namespace. */
export async function loadModuleGraph(entry: string, bindings: LoaderBindings): Promise<unknown> {
  const modules: Record<string, LoadedModule> = {};
  const order: string[] = [];
  const visiting: string[] = [];
  async function load(path: string): Promise<void> {
    if (modules[path] !== undefined) return;
    if (visiting.indexOf(path) !== -1) {
      throw new LoaderErrorImpl('the module graph is cyclic through ' + path + ' — the no-build loader requires an acyclic import graph');
    }
    visiting.push(path);
    const code = await bindings.readModule(path);
    const stripped = stripTypes(code);
    const specifiers = importSpecifiersOf(stripped);
    for (let index = 0; index < specifiers.length; index++) {
      await load(resolveSpecifier(path, specifiers[index]));
    }
    visiting.pop();
    order.push(path);
    modules[path] = { path, code, stripped, url: '' };
  }
  await load(entry);
  for (let index = 0; index < order.length; index++) {
    const path = order[index];
    const module = modules[path];
    const rewritten = rewriteSpecifiers(module.stripped, path, modules);
    const url = await bindings.createModuleUrl(rewritten);
    modules[path] = { path, code: module.code, stripped: module.stripped, url };
  }
  const entryUrl = modules[entry].url;
  return await bindings.importModule(entryUrl);
}

/**
 * The import/export alternation, built from concatenated strings (never
 * a regex literal): a literal spelling would carry the text
 * `:import|export` — which the shell bootstrap's annotation pass reads
 * as a UNION TYPE annotation and eats.
 */
const IMPORT_EXPORT_ALTERNATION = '(?:' + 'import' + '|' + 'export' + ')';

/**
 * The statement body: `\b` then a from-clause. `[^;]*?` spans NEWLINES
 * (multi-line import braces) — an import statement carries no semicolon
 * before its from-clause, so this cannot bleed across statements.
 */
const FROM_CLAUSE_TAIL = '\\b[^;]*?from[ \\t]*[\'"]';

/** Extract the module specifiers of a stripped source (import/export ... from '...', MULTI-LINE statements included). */
export function importSpecifiersOf(stripped: string): string[] {
  const specifiers: string[] = [];
  const pattern = new RegExp('(?:^|\\n)[ \\t]*' + IMPORT_EXPORT_ALTERNATION + FROM_CLAUSE_TAIL + '([^\'"]+)[\'"]', 'g');
  let match = pattern.exec(stripped);
  while (match !== null) {
    specifiers.push(match[1]);
    match = pattern.exec(stripped);
  }
  return specifiers;
}

/** Rewrite every relative specifier of a stripped source to its dependency's URL (multi-line statements included). */
export function rewriteSpecifiers(stripped: string, path: string, modules: Record<string, LoadedModule>): string {
  const rewriter = new RegExp('(^|\\n)([ \\t]*' + IMPORT_EXPORT_ALTERNATION + FROM_CLAUSE_TAIL + ')([^\'"]+)([\'"])', 'g');
  return stripped.replace(rewriter, (whole: string, lead: string, head: string, specifier: string, tail: string): string => {
    const resolved = resolveSpecifier(path, specifier);
    const dependency = modules[resolved];
    if (dependency === undefined) throw new LoaderErrorImpl('the module ' + resolved + ' (imported by ' + path + ') was not loaded — the graph pass missed it');
    return lead + head + dependency.url + tail;
  });
}

/** The static shell's boot entry: load the app from its TS entry through the injected bindings. */
export async function bootNoBuild(entry: string, bindings: LoaderBindings): Promise<unknown> {
  return await loadModuleGraph(entry, bindings);
}
