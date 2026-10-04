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
// THE MICRO-STYLE LAWS (this file only, so the regex bootstrap can
// strip it): no imports (self-contained); no classes/enums/
// ternaries; no annotated arrow parameters; annotations restricted
// to named types, single-level generics, arrays and unions; type
// aliases single-line; interfaces close at column zero; object
// literal values are literals or shorthand (never bare identifiers
// after a key colon); no ' as ' text inside string/template
// literals; no optional parameters; no generic functions.
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

/** `true` when a `/` at `pos` starts a regex (the prev-significant-token heuristic). */
function regexAllowedAfter(previous: Token | null): boolean {
  if (previous === null) return true;
  if (previous.kind === 'comment' || previous.kind === 'ws') return regexAllowedAfter(null);
  if (previous.kind === 'ident') {
    return previous.kind === 'ident' && REGEX_PRECEDERS.indexOf(previous.text) !== -1;
  }
  if (previous.kind === 'number' || previous.kind === 'string' || previous.kind === 'template' || previous.kind === 'regex') return false;
  if (previous.kind === 'punct') {
    return previous.text !== ')' && previous.text !== ']' && previous.text !== '}' && previous.text !== '++' && previous.text !== '--';
  }
  return true;
}

/** Lex the whole source into tokens (comments included, whitespace included). */
export function lex(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let newlineBefore = false;
  let previous: Token | null = null;
  while (pos < source.length) {
    const ch = source.charAt(pos);
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      const start = pos;
      while (pos < source.length && (source.charAt(pos) === ' ' || source.charAt(pos) === '\t' || source.charAt(pos) === '\r')) pos += 1;
      previous = pushToken(tokens, 'ws', source, start, pos, newlineBefore, previous);
      newlineBefore = false;
      continue;
    }
    if (ch === '\n') {
      const start = pos;
      pos += 1;
      previous = pushToken(tokens, 'ws', source, start, pos, newlineBefore, previous);
      newlineBefore = true;
      continue;
    }
    if (ch === '/' && source.charAt(pos + 1) === '/') {
      const start = pos;
      const end = source.indexOf('\n', pos);
      pos = end === -1 ? source.length : end;
      previous = pushToken(tokens, 'comment', source, start, pos, newlineBefore, previous);
      continue;
    }
    if (ch === '/' && source.charAt(pos + 1) === '*') {
      const start = pos;
      const end = source.indexOf('*/', pos + 2);
      if (end === -1) throw new LoaderErrorImpl('the block comment opened at ' + start + ' is unterminated');
      pos = end + 2;
      previous = pushToken(tokens, 'comment', source, start, pos, newlineBefore, previous);
      continue;
    }
    if (ch === '\'' || ch === '"') {
      const start = pos;
      pos = scanQuoted(source, pos);
      previous = pushToken(tokens, 'string', source, start, pos, newlineBefore, previous);
      continue;
    }
    if (ch === '`') {
      const start = pos;
      pos = scanTemplate(source, pos);
      previous = pushToken(tokens, 'template', source, start, pos, newlineBefore, previous);
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
      previous = pushToken(tokens, 'number', source, start, pos, newlineBefore, previous);
      continue;
    }
    if (ch === '/' && regexAllowedAfter(previous)) {
      const start = pos;
      pos = scanRegex(source, pos);
      previous = pushToken(tokens, 'regex', source, start, pos, newlineBefore, previous);
      continue;
    }
    if (isIdentStart(ch)) {
      const start = pos;
      while (pos < source.length && isIdentPart(source.charAt(pos))) pos += 1;
      previous = pushToken(tokens, 'ident', source, start, pos, newlineBefore, previous);
      continue;
    }
    const punctuator = matchPunctuator(source, pos);
    if (punctuator !== null) {
      const start = pos;
      pos += punctuator.length;
      previous = pushToken(tokens, 'punct', source, start, pos, newlineBefore, previous);
      continue;
    }
    throw new LoaderErrorImpl('the character ' + JSON.stringify(ch) + ' at offset ' + pos + ' is not lexable');
  }
  return tokens;
}

/** Push one token onto the list, returning it (the prev-token link). */
function pushToken(tokens: Token[], kind: TokenKind, source: string, start: number, end: number, newlineBefore: boolean, _previous: Token | null): Token {
  const token: Token = { kind: kind, text: source.slice(start, end), start: start, end: end, newlineBefore: newlineBefore };
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

/** `true` when the char at `pos` continues a multi-line type (a leading `|`/`&` continuation line). */
function continuesType(source: string, pos: number): boolean {
  let scan = pos;
  while (scan < source.length && (source.charAt(scan) === ' ' || source.charAt(scan) === '\t' || source.charAt(scan) === '\r')) scan += 1;
  const ch = source.charAt(scan);
  return ch === '|' || ch === '&' || ch === '.';
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
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
      depth += 1;
      pos += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
      if (depth === 0) {
        if (mode === 'param' && ch === ')') return { end: pos, terminator: ch };
        if (mode === 'cast' && (ch === ')' || ch === ']' || ch === '}')) return { end: pos, terminator: ch };
        if (mode === 'generic' && ch === '>') return { end: pos, terminator: ch };
        throw new LoaderErrorImpl('the type region opened at ' + start + ' (' + mode + ') is unbalanced at offset ' + pos);
      }
      depth -= 1;
      pos += 1;
      continue;
    }
    if (ch === '=' && source.charAt(pos + 1) === '>') {
      if (depth === 0 && (mode === 'return' || mode === 'cast')) return { end: pos, terminator: '=>' };
      throw new LoaderErrorImpl('the type region opened at ' + start + ' contains an arrow at depth zero — name a type alias for function types (the erasable subset)');
    }
    if (depth === 0) {
      if (ch === ',') return { end: pos, terminator: ch };
      if (ch === ';') return { end: pos, terminator: ch };
      if (ch === '=') return { end: pos, terminator: ch };
      if (ch === '{' && mode === 'return') return { end: pos, terminator: ch };
      if (ch === '?') return { end: pos, terminator: ch };
      if (ch === '\n') {
        if (mode === 'param' || mode === 'generic') {
          pos += 1;
          continue;
        }
        if (continuesType(source, pos + 1)) {
          pos += 1;
          continue;
        }
        return { end: pos, terminator: ch };
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
  const state: StripState = { source: source, tokens: tokens, removals: [], ctx: [{ kind: 'top', params: false, openIndex: -1, sawKey: false, expectingKey: false, memberLevel: true }], ternary: [], constructorFlag: false };
  walkRange(state, 0, tokens.length);
  const removals = state.removals.slice().sort(byStart);
  let output = '';
  let pos = 0;
  for (let index = 0; index < removals.length; index++) {
    const removal = removals[index];
    output += source.slice(pos, removal.start);
    pos = removal.end;
  }
  output += source.slice(pos);
  return output.replace(/\/\*[\s\S]*?\*\//g, '').replace(/[ \t]*\/\/[^\n]*/g, '');
}

/** Sort removals by start. */
function byStart(a: Removal, b: Removal): number {
  return a.start - b.start;
}

/** The next code token at or after `index` (skipping ws and comments). */
function nextCode(state: StripState, index: number): Token | null {
  for (let scan = index; scan < state.tokens.length; scan++) {
    const token = state.tokens[scan];
    if (token.kind !== 'ws' && token.kind !== 'comment') return token;
  }
  return null;
}

/** The previous code token before `index` (skipping ws and comments). */
function prevCode(state: StripState, index: number): Token | null {
  for (let scan = index - 1; scan >= 0; scan--) {
    const token = state.tokens[scan];
    if (token.kind !== 'ws' && token.kind !== 'comment') return token;
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
  state.removals.push({ start: start, end: end });
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

/** Handle one code token; returns the next index. */
function walkToken(state: StripState, index: number, to: number): number {
  const token = state.tokens[index];
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
  if (text === 'enum' || text === 'namespace' || text === 'module' || text === 'declare') {
    throw new LoaderErrorImpl('the ' + text + ' syntax at offset ' + token.start + ' is not erasable — the no-build loader refuses it (use interfaces, type aliases and plain objects)');
  }
  if (text === 'interface') {
    return removeInterface(state, index);
  }
  if (text === 'type' && after !== null && after.kind === 'ident') {
    const beyond = nextCode(state, index + 2);
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
    if (previous !== null && previous.kind === 'ident' && isKeyword(previous.text) === false) {
      return index + 1;
    }
    if (previous !== null && previous.kind === 'ident' && KEYWORDS.indexOf(previous.text) !== -1 && previous.text !== 'const' && previous.text !== 'let' && previous.text !== 'var' && previous.text !== 'return' && previous.text !== 'typeof' && previous.text !== 'await' && previous.text !== 'yield' && previous.text !== 'new' && previous.text !== 'in' && previous.text !== 'of' && previous.text !== 'delete' && previous.text !== 'void' && previous.text !== 'throw' && previous.text !== 'else' && previous.text !== 'do' && previous.text !== 'case') {
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
    const nextText = source.charAt(token.end);
    if (after !== null && after.kind === 'punct' && (after.text === '.' || after.text === '[' || after.text === '(')) {
      throw new LoaderErrorImpl('the non-null assertion at offset ' + token.start + ' is not erasable — check explicitly instead');
    }
    if (nextText === '.' || nextText === '[' || nextText === '(') {
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
    if (context.kind === 'object') {
      if (context.expectingKey && context.sawKey === false) {
        return index + 1;
      }
      if (context.sawKey) {
        context.sawKey = false;
        return index + 1;
      }
    }
    if (state.ternary.length > 0 && state.ternary[state.ternary.length - 1] === state.ctx.length) {
      state.ternary.pop();
      return index + 1;
    }
    throw new LoaderErrorImpl('the colon at offset ' + token.start + ' is neither an object key nor a ternary branch nor an annotation — labels and switch/case are not erasable');
  }
  if (text === '(') {
    const previous = prevCode(state, index);
    const isHead = previous !== null && previous.kind === 'ident' && isKeyword(previous.text) === false && (context.kind === 'class' || context.kind === 'object') && context.memberLevel;
    const isFunction = previous !== null && previous.kind === 'ident' && (previous.text === 'function');
    state.ctx.push({ kind: 'paren', params: isHead || isFunction, openIndex: index, sawKey: false, expectingKey: false, memberLevel: false });
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
        state.ternary.pop();
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
            state.ctx.push({ kind: 'block', params: false, openIndex: -1, sawKey: false, expectingKey: false, memberLevel: false });
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
      state.ctx.push({ kind: 'object', params: false, openIndex: index, sawKey: false, expectingKey: true, memberLevel: true });
      return index + 1;
    }
    if (classBodyPending(state)) {
      clearClassPending(state);
      state.ctx.push({ kind: 'class', params: false, openIndex: index, sawKey: false, expectingKey: false, memberLevel: true });
      return index + 1;
    }
    state.ctx.push({ kind: 'block', params: false, openIndex: index, sawKey: false, expectingKey: false, memberLevel: false });
    return index + 1;
  }
  if (text === '}') {
    const closed = top(state);
    if (closed.kind === 'top') throw new LoaderErrorImpl('unbalanced close brace at offset ' + token.start);
    state.ctx.pop();
    return index + 1;
  }
  if (text === '[') {
    state.ctx.push({ kind: 'bracket', params: false, openIndex: index, sawKey: false, expectingKey: false, memberLevel: false });
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
      scan = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '/' && source.charAt(scan + 1) === '*') {
      const end = source.indexOf('*/', scan + 2);
      scan = end === -1 ? source.length : end + 2;
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
  state.ctx = [{ kind: 'top', params: false, openIndex: -1, sawKey: false, expectingKey: false, memberLevel: true }, { kind: 'paren', params: true, openIndex: open, sawKey: false, expectingKey: false, memberLevel: true }];
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
        const start = previous !== null && previous.kind === 'ident' && previous.text === 'export' ? previous.start : state.tokens[index].start;
        remove(state, start, token.end);
        return scan + 1;
      }
    }
    scan += 1;
  }
  throw new LoaderErrorImpl('the interface at offset ' + state.tokens[index].start + ' is never closed');
}

/** Remove a type alias (or export type alias): keyword through the statement end. */
function removeTypeAlias(state: StripState, index: number): number {
  const source = state.source;
  const tokens = state.tokens;
  let scan = index + 1;
  let depth = 0;
  while (scan < tokens.length) {
    const token = tokens[scan];
    if (token.kind === 'punct') {
      if (token.text === '(' || token.text === '[' || token.text === '{') depth += 1;
      if (token.text === ')' || token.text === ']' || token.text === '}') depth -= 1;
      if (depth === 0 && (token.text === ';' || token.text === '\n')) {
        const previous = prevCode(state, index);
        const start = previous !== null && previous.kind === 'ident' && previous.text === 'export' ? previous.start : tokens[index].start;
        const end = token.text === ';' ? token.end : token.start;
        remove(state, start, end);
        return scan + 1;
      }
    }
    if (token.kind === 'ws' && token.text.indexOf('\n') !== -1 && depth === 0) {
      const previous = prevCode(state, index);
      const start = previous !== null && previous.kind === 'ident' && previous.text === 'export' ? previous.start : tokens[index].start;
      remove(state, start, token.start);
      return scan + 1;
    }
    scan += 1;
  }
  throw new LoaderErrorImpl('the type alias at offset ' + tokens[index].start + ' never ends');
}

/** Walk an import statement: drop `import type` entirely; drop type-marked specifiers. */
function walkImport(state: StripState, index: number): number {
  const tokens = state.tokens;
  const after = nextCode(state, index + 1);
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
    const beyond = nextCode(state, index + 2);
    if (beyond !== null && beyond.kind === 'punct' && beyond.text === '{') {
      return removeExportTypeSpecifiers(state, index);
    }
    if (beyond !== null && beyond.kind === 'punct' && beyond.text === '=') {
      throw new LoaderErrorImpl('export assignment (export = ...) is not erasable (offset ' + beyond.start + ')');
    }
    return removeImportStatement(state, index);
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
      return scan + 1;
    }
    scan += 1;
  }
  return index + 1;
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

/** Clean a `{ ... }` specifier list of type-marked entries. */
function cleanBraces(state: StripState, open: number, close: number): void {
  const tokens = state.tokens;
  let scan = open + 1;
  let typeMarked: Token[] = [];
  let pendingType = false;
  while (scan < close) {
    const token = tokens[scan];
    if (token.kind === 'ident' && token.text === 'type') {
      const after = nextCode(state, scan + 1);
      if (after !== null && after.kind === 'ident') {
        pendingType = true;
        scan += 1;
        continue;
      }
    }
    if (token.kind === 'ident' && pendingType) {
      removeToken(state, tokens[scan - 1]);
      removeToken(state, token);
      pendingType = false;
      typeMarked.push(token);
      scan += 1;
      continue;
    }
    if (token.kind === 'punct' && token.text === ',') {
      if (typeMarked.length > 0) {
        const previous = prevCode(state, scan);
        if (previous !== null && typeMarked.indexOf(previous) !== -1) {
          removeToken(state, token);
        }
      }
      scan += 1;
      continue;
    }
    scan += 1;
  }
  const tail = typeMarked.length > 0 ? prevCode(state, close) : null;
  if (tail !== null && typeMarked.indexOf(tail) !== -1) {
    const commaBefore = findCommaBefore(state, open, close);
    if (commaBefore !== null) removeToken(state, commaBefore);
  }
}

/** Find the last comma before `close` inside [open, close). */
function findCommaBefore(state: StripState, open: number, close: number): Token | null {
  const tokens = state.tokens;
  let found: Token | null = null;
  for (let scan = open + 1; scan < close; scan++) {
    if (tokens[scan].kind === 'punct' && tokens[scan].text === ',') found = tokens[scan];
  }
  return found;
}

/** Count the value specifiers inside a cleaned `{ ... }` list. */
function countValueSpecifiers(state: StripState, open: number, close: number): number {
  const tokens = state.tokens;
  let count = 0;
  let pendingType = false;
  for (let scan = open + 1; scan < close; scan++) {
    const token = tokens[scan];
    if (token.kind === 'ident' && token.text === 'type') {
      const after = nextCode(state, scan + 1);
      if (after !== null && after.kind === 'ident') {
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
  const start = token.start;
  const previous = prevCode(state, index);
  const lead = previous !== null ? previous.end : start;
  remove(state, lead, scan.end);
  return indexOfTokenEndingAt(state, scan.end) === -1 ? index + 1 : indexOfTokenEndingAt(state, scan.end);
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
  const importerDir = importer.indexOf('/') === -1 ? '' : importer.slice(0, importer.lastIndexOf('/'));
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
    modules[path] = { path: path, code: code, stripped: stripped, url: '' };
  }
  await load(entry);
  for (let index = 0; index < order.length; index++) {
    const path = order[index];
    const module = modules[path];
    const rewritten = rewriteSpecifiers(module.stripped, path, modules);
    const url = await bindings.createModuleUrl(rewritten);
    modules[path] = { path: path, code: module.code, stripped: module.stripped, url: url };
  }
  const entryUrl = modules[entry].url;
  return await bindings.importModule(entryUrl);
}

/** Extract the module specifiers of a stripped source (import/export ... from '...'). */
export function importSpecifiersOf(stripped: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)[ \t]*(?:import|export)\b[^;\n]*?from[ \t]*['"]([^'"]+)['"]/g;
  let match = pattern.exec(stripped);
  while (match !== null) {
    specifiers.push(match[1]);
    match = pattern.exec(stripped);
  }
  return specifiers;
}

/** Rewrite every relative specifier of a stripped source to its dependency's URL. */
export function rewriteSpecifiers(stripped: string, path: string, modules: Record<string, LoadedModule>): string {
  return stripped.replace(/(^|\n)([ \t]*(?:import|export)\b[^;\n]*?from[ \t]*['"])([^'"]+)(['"])/g, (whole: string, lead: string, head: string, specifier: string, tail: string): string => {
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
