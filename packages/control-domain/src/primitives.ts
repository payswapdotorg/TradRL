// @tradrl/control-domain — shared contract primitives for the control plane.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L4 (point-in-time truth — every
// timestamp carries an explicit UTC offset), L12 (tenant isolation — ids are
// opaque so identity spaces cannot be conflated), L20 (safety outside prompts —
// guards are strict, fail-closed and total).
//
// Package laws (mirroring @tradrl/domain-core and @tradrl/agent-body):
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape has a hand-rolled total type guard.
// - All contract data is JSON-serializable (brands are compile-time only).
// - Cross-lane entities are referenced ONLY through opaque branded ids.
//
// This module contains TWO deliberate structural mirrors (decision D-003/D-004
// pattern, see packages/market-protocol/src/timestamp.ts):
// - `TimestampMs` mirrors @tradrl/time-engine (canonical) — same brand string
//   'TradRL.TimestampMs', same bounds, same guard. Used for control-plane
//   audit fields (created/updated, audit-log instants).
// - `Timestamp` mirrors @tradrl/domain-core primitives (canonical) — ISO-8601
//   string with mandatory explicit offset, brand 'Timestamp'. Used for the
//   GoalStatement mirror, which must stay structurally assignable to
//   domain-core's Goal shapes.
// The cross-package trip wire lives in src/interop.test.ts: if either mirror
// drifts, `pnpm typecheck` (type-level assertions) and `pnpm test` (runtime
// parity) fail.

// ---------------------------------------------------------------------------
// Branding (compile-time nominal identity, erased at runtime)
// ---------------------------------------------------------------------------

/**
 * Nominal branding helper — identical declaration to domain-core's
 * (`T & { readonly __brand: B }`) so that identically-branded types in the two
 * packages remain mutually assignable (the D-004 mirror rule).
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Strips `readonly` modifiers — used by tests to attempt mutations. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Structural guard helpers (hand-rolled, `any`-free, total)
// ---------------------------------------------------------------------------

/** Guard: a plain, non-array, non-null object. */
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

/** Guard: a finite number in the closed interval [0, 1]. */
export function isUnitInterval(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

/** Guard: an integer >= 0. */
export function isNonNegativeInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0;
}

/** Guard: an integer >= 1 (versions are 1-based; 0 marks "absent"). */
export function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 1;
}

/** Guard: an array whose every element satisfies `guard`. */
export function isArrayOf<T>(
  v: unknown,
  guard: (item: unknown) => item is T,
): v is readonly T[] {
  return Array.isArray(v) && v.every((item) => guard(item));
}

/** Builds a guard for a closed string-union vocabulary. */
export function isEnum<const V extends readonly string[]>(
  values: V,
): (v: unknown) => v is V[number] {
  const allowed = new Set<string>(values);
  return (v: unknown): v is V[number] => typeof v === 'string' && allowed.has(v);
}

/** True when the array has no duplicate entries (string identity). */
export function hasNoDuplicates(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

// ---------------------------------------------------------------------------
// TimestampMs — structural mirror of @tradrl/time-engine (DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/**
 * A validated epoch-millisecond timestamp. Canonical definition:
 * `@tradrl/time-engine` (packages/time-engine/src/timestamp.ts). This mirror
 * re-declares the IDENTICAL structural type so control-plane audit fields
 * interoperate with the time-engine without a package dependency (the frozen
 * workspace lockfile forbids one). Construct through time-engine's
 * `timestampMs` / `requireTimestampMs` / `fromIso`, or validate untrusted
 * values with {@link isTimestampMs}.
 */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** Lower bound of the representable range (the Unix epoch). Mirror of time-engine. */
export const MIN_TIMESTAMP_MS = 0;

/** Upper bound of the representable range (last ECMAScript Date instant). Mirror of time-engine. */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Runtime guard — mirrors `isTimestampMs` from @tradrl/time-engine. */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_TIMESTAMP_MS &&
    value <= MAX_TIMESTAMP_MS
  );
}

// ---------------------------------------------------------------------------
// Timestamp — structural mirror of @tradrl/domain-core primitives (ISO-8601)
// ---------------------------------------------------------------------------

/**
 * Instant in time encoded as an RFC 3339 / ISO-8601 string with a MANDATORY
 * explicit UTC offset ("Z" or "+HH:MM"). Canonical definition:
 * `@tradrl/domain-core` (packages/domain-core/src/primitives.ts). The
 * GoalStatement mirror uses this type so domain-core Goal records remain
 * structurally assignable to the mirrored horizon shapes.
 */
export type Timestamp = Brand<string, 'Timestamp'>;

const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Guard: RFC 3339 timestamp with explicit offset and a real calendar date/time. */
export function isTimestamp(v: unknown): v is Timestamp {
  if (typeof v !== 'string' || !TIMESTAMP_PATTERN.test(v)) return false;
  return Number.isFinite(Date.parse(v));
}

/**
 * Chronological comparison of two valid ISO-8601 timestamps (numeric instant
 * order, independent of the textual offset representation). Mirrors
 * domain-core's `compareTimestamps`. Precondition: both arguments are valid.
 */
export function compareTimestamps(a: Timestamp, b: Timestamp): -1 | 0 | 1 {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of ARCHITECTURE-LOCK L3 discipline)
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
 * Compiled control-plane records must pass this check: a record that can be
 * mutated after publication is not a contract record.
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
