// @tradrl/control-domain — shared contract primitives.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L12 (tenant isolation — every
// record carries a tenant scope), L15 (project continuity — lineage ids on
// every control-plane record), L20 (safety outside prompts — guards are
// strict, fail-closed and total); spec/DOMAIN-MODEL.md (Goal,
// ConstraintSet, Project); AGENTS.md package laws.
//
// Laws honored here:
// - Zero runtime dependencies; pure data and pure functions only.
// - All contract data is JSON-serializable (no Dates, Maps, Sets or symbols
//   in serialized shapes; brand markers are compile-time only).
// - No `any`; every exported shape ships a hand-rolled total type guard.
// - Cross-lane entities (T002 domain-core, T003 agent-body, T004
//   time-engine, T012 evaluation, T016 organization compiler) are referenced
//   ONLY through opaque branded ids or structural mirrors — never imported.

// ---------------------------------------------------------------------------
// Branding (compile-time only, erased at runtime)
// ---------------------------------------------------------------------------

/**
 * Nominal branding helper — the same discipline as
 * `@tradrl/domain-core`'s `Brand<T, B>`. Distinct identity spaces get
 * distinct tags so they are not interchangeable at compile time.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Strips `readonly` modifiers — used by tests to attempt illegal mutations. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Structural guard helpers (hand-rolled, `any`-free, never throw)
// ---------------------------------------------------------------------------

/** Structural guard: a plain JSON object (not an array, not null). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Guard: a string with at least one character (whitespace-only rejected). */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Guard: a finite JS number (NaN, +/-Infinity rejected). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Guard: a finite number in the closed interval [0, 1]. */
export function isUnitInterval(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

/** Guard: an integer >= 1 (the version discipline for versioned records). */
export function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 1;
}

const IDENTIFIER_PATH_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/;

/**
 * Guard: dot-separated identifier path (e.g. "risk.maxDrawdown",
 * "returns.sharpe"). Mirrors the constraint-subject / metric-key discipline
 * of `@tradrl/domain-core` primitives so criterion metrics and constraint
 * subjects live in one address space. Segments start with a letter.
 */
export function isIdentifierPath(v: unknown): v is string {
  return typeof v === 'string' && IDENTIFIER_PATH_PATTERN.test(v);
}

/** Guard: every element of the array satisfies `guard`. */
export function isArrayOf<T>(
  v: unknown,
  guard: (item: unknown) => item is T,
): v is readonly T[] {
  return Array.isArray(v) && v.every((item) => guard(item));
}

/** Guard: a closed string vocabulary. */
export function isOneOf<const V extends readonly string[]>(
  values: V,
): (v: unknown) => v is V[number] {
  const allowed = new Set<string>(values);
  return (v: unknown): v is V[number] => typeof v === 'string' && allowed.has(v);
}

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of "immutable versioned capability", L3)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze`s every reachable plain object and array.
 * Already-frozen branches are skipped, so cycles terminate and shared frozen
 * substructures cost nothing. Returns the same reference, deeply frozen.
 */
export function deepFreeze<T>(value: T): T {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) continue;
    Object.freeze(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        if (item !== null && typeof item === 'object') stack.push(item);
      }
    } else {
      for (const key of Object.keys(current)) {
        const child: unknown = (current as Record<string, unknown>)[key];
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    }
  }
  return value;
}

/**
 * `true` when every reachable plain object and array is `Object.isFrozen`.
 * The runtime guard behind "compiled artifacts and project records never
 * mutate in place": a record that is not deeply frozen fails this check.
 */
export function isDeeplyFrozen(value: unknown): boolean {
  const visited = new Set<unknown>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (!Object.isFrozen(current)) return false;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else {
      for (const key of Object.keys(current)) {
        stack.push((current as Record<string, unknown>)[key]);
      }
    }
  }
  return true;
}

/** Deep-clones JSON-serializable contract data (round-trips through JSON). */
export function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
