/**
 * @tradrl/trajectory — shared primitive helpers.
 *
 * Hand-rolled guard and immutability helpers used across the trajectory
 * contract package. ZERO runtime dependencies: this package never imports
 * another TradRL package (the workspace lockfile forbids contract-package
 * dependencies — see packages/market-protocol/src/interop.test.ts for the
 * structural-mirror discipline this file supports).
 *
 * Laws honored here (spec/ARCHITECTURE-LOCK.md):
 * - L20 safety outside prompts: guards are strict, total and never throw.
 * - Immutability law (T011): records are deeply-frozen value objects;
 *   `deepFreeze`/`isDeeplyFrozen` are the runtime half of that law.
 */

/** Nominal branding helper — compile-time only, erased at runtime. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Structural guard: a plain, non-array, non-null object. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Guard: a string with at least one character (whitespace-only is rejected). */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Guard: a finite JS number (NaN, +/-Infinity rejected). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** `true` when `v` is an array whose every element satisfies `guard`. */
export function isArrayOf<T>(
  v: unknown,
  guard: (item: unknown) => item is T,
): v is readonly T[] {
  return Array.isArray(v) && v.every((item) => guard(item));
}

/** Builds a guard for a closed string-union type. */
export function isEnum<const V extends readonly string[]>(
  values: V,
): (v: unknown) => v is V[number] {
  const allowed = new Set<string>(values);
  return (v: unknown): v is V[number] => typeof v === 'string' && allowed.has(v);
}

/** Returns the values that occur more than once in `items` (order preserved). */
export function duplicatesOf<T>(items: readonly T[]): readonly T[] {
  const seen = new Set<T>();
  const duplicated = new Set<T>();
  for (const item of items) {
    if (seen.has(item)) duplicated.add(item);
    else seen.add(item);
  }
  return [...duplicated];
}

/** Strips `readonly` modifiers — used by tests to attempt mutations. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// JSON value discipline (opaque payloads, outcome summaries, parameters)
// ---------------------------------------------------------------------------

/**
 * A recursively JSON-safe value: the only kinds of payload this package
 * accepts inside opaque fields (action payloads, evaluation parameters).
 * Finite numbers only; `undefined` is not a JSON value (absent keys, not
 * present-but-undefined, is the discipline).
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Guard: a plain JSON object (record of JSON values). */
export function isJsonObject(v: unknown): v is { readonly [key: string]: JsonValue } {
  if (!isRecord(v)) return false;
  return Object.values(v).every(isJsonValue);
}

/** Guard: a recursively JSON-safe value (finite numbers, no undefined). */
export function isJsonValue(v: unknown): v is JsonValue {
  if (v === null) return true;
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(v);
    case 'object':
      if (Array.isArray(v)) return v.every(isJsonValue);
      return isJsonObject(v);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of the T011 immutability law)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze`s every reachable plain object and array.
 * Already-frozen branches are skipped, so cycles terminate and shared frozen
 * substructures cost nothing. Returns the same reference, now deeply frozen.
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
 * A trajectory or experiment record that is not deeply frozen fails this
 * check — append-only lineage must never be mutable in place.
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
