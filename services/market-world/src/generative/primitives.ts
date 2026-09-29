/**
 * @tradrl/market-world (generative service) — structural primitives (work
 * order T028): the zero-dependency foundation of the generative lane.
 *
 * MIRROR DISCIPLINE (D-003/D-004, the law this Work Order operates under):
 * this module re-declares the SHARED PRIMITIVES every sibling lane owns in
 * its own contract package (`deepFreeze`, the record/string/number guards,
 * the JSON value model, canonical serialization, the FNV-1a derivation) —
 * field-for-field, behavior-for-behavior — because the frozen write surface
 * (`services/market-world/src/generative/**` only) forbids imports across
 * lanes. The interop trip-wire tests (src/interop.test.ts) prove the
 * mirrors against the REAL packages present on this branch
 * (@tradrl/exchange-sim, @tradrl/environment-protocol,
 * @tradrl/rl-protocol).
 *
 * DETERMINISM (L9): every function here is pure — no ambient clock, no
 * Math.random, no process data. THE GENERATIVE LAW: "the process
 * declarations are versioned records — never ambient randomness" — the
 * ONLY randomness this lane ever sees is the SEEDED xorshift32 state a
 * declared process carries in its serializable runtime state (process.ts);
 * every draw is a pure function of the declared seed, so same declarations
 * -> same draws, byte-identical, twice, forever.
 */

// ---------------------------------------------------------------------------
// Branding (compile-time-only tags — the sibling lanes' Brand)
// ---------------------------------------------------------------------------

/** A compile-time-only brand tag (runtime value is untouched). */
export type Brand<Base, Tag> = Base & { readonly __brand: Tag };

// ---------------------------------------------------------------------------
// Runtime type guards (hand-rolled, total — no `any` anywhere)
// ---------------------------------------------------------------------------

/** Narrow `unknown` to a plain non-null non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** A finite number (NaN and ±Infinity excluded). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A non-negative safe integer. */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A positive safe integer. */
export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

// ---------------------------------------------------------------------------
// The JSON value model (opaque payloads — the sibling lanes' JsonValue)
// ---------------------------------------------------------------------------

/** The JSON value model: the only payload currency this lane accepts. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** The object branch of the JSON value model. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** Total runtime guard for the JSON value model (finite numbers only). */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((element) => isJsonValue(element));
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const element: unknown = (value as Record<string, unknown>)[key];
      if (!isJsonValue(element)) return false;
    }
    return true;
  }
  return false;
}

/** Narrow to the object branch of the JSON value model. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// deepFreeze (the L3 immutability discipline)
// ---------------------------------------------------------------------------

/**
 * Recursively freeze a value (arrays and plain objects). Returns the SAME
 * reference, deeply frozen — the discipline every public record of this
 * lane follows (immutability tests assert `isDeeplyFrozen`).
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const element: unknown = (value as Record<string, unknown>)[key];
    if (typeof element === 'object' && element !== null && !Object.isFrozen(element)) {
      deepFreeze(element);
    }
  }
  return value;
}

/** Is the value deeply frozen (every reachable object frozen)? */
export function isDeeplyFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const element: unknown = (value as Record<string, unknown>)[key];
    if (!isDeeplyFrozen(element)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Canonical serialization + the deterministic digest (L9)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization: object keys recursively sorted (code-unit
 * order), arrays in order, strings via `JSON.stringify`, finite numbers via
 * `String`. Equal JSON values always serialize byte-identically — the
 * property every lineage digest of this lane relies on. MIRRORS the sibling
 * lanes' `canonicalJson` exactly (interop-tested).
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value); // finite by the JSON model
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const object = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

/**
 * FNV-1a 32-bit hash of a string, as zero-padded lowercase hex — the
 * canonical TradRL derivation, mirrored (same seed, same prime, same
 * output width as every sibling lane; interop-tested for parity).
 */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// The seeded PRNG (the generative lane's ONLY randomness — declared, never ambient)
// ---------------------------------------------------------------------------

/**
 * The initial xorshift32 state a declared process derives from its seed:
 * `fnv1a32(seed)` (never zero — the degenerate fixed point of xorshift32).
 */
export function seededState(seed: string): number {
  const state = Number.parseInt(fnv1a32Hex(seed), 16);
  return state === 0 ? 0x9e3779b9 : state;
}

/**
 * One xorshift32 step over a uint32 state, returning the next state. PURE:
 * the state IS the randomness — a process's serializable runtime carries
 * it, so a resumed process draws the IDENTICAL future sequence (L9).
 */
export function xorshift32(state: number): number {
  let value = state >>> 0;
  value ^= value << 13;
  value >>>= 0;
  value ^= value >>> 17;
  value ^= value << 5;
  value >>>= 0;
  return value;
}

/** Draw `u ∈ [0,1)` from a state, returning `{ state, u }` (pure). */
export function drawUnit(state: number): { readonly state: number; readonly u: number } {
  const next = xorshift32(state);
  return { state: next, u: next / 0x1_0000_0000 };
}

// ---------------------------------------------------------------------------
// Exact decimal arithmetic (LOCAL, minimal — the population lane's own need)
// ---------------------------------------------------------------------------

/**
 * A canonical decimal's scaled-integer view: `int / 10^scale`, exact for
 * the magnitudes this lane touches (prices/quantities well below 2^53).
 * This is NOT exchange physics (T010 owns matching/fees/slippage — the
 * engine is DRIVEN here, never reimplemented): it is the population
 * lane's own arithmetic for computing declared anchor prices and policy
 * order prices on the venue grid, mirroring the grid discipline that
 * exchange-sim itself validates (the REAL engine re-validates every
 * price/quantity a process emits; this arithmetic only keeps the
 * generator coherent).
 */
export interface ScaledDecimal {
  readonly int: number;
  readonly scale: number;
}

/** Parse a canonical decimal string into its exact scaled view (null if malformed). */
export function parseCanonicalDecimal(value: string): ScaledDecimal | null {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) return null;
  const dot = value.indexOf('.');
  if (dot === -1) return { int: Number.parseInt(value, 10), scale: 0 };
  const digits = value.slice(0, dot) + value.slice(dot + 1);
  return { int: Number.parseInt(digits, 10), scale: value.length - dot - 1 };
}

/** Render a scaled decimal as the CANONICAL decimal string (trailing zeros stripped). */
export function renderScaledDecimal(value: ScaledDecimal): string {
  const sign = value.int < 0 ? '-' : '';
  const digits = Math.abs(value.int).toString().padStart(value.scale + 1, '0');
  if (value.scale === 0) return `${sign}${digits}`;
  const cut = digits.length - value.scale;
  const whole = digits.slice(0, cut);
  let fraction = digits.slice(cut);
  while (fraction.length > 0 && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/** Rescale to a common scale and add exactly (null on overflow beyond safe integers). */
export function addScaled(a: ScaledDecimal, b: ScaledDecimal): ScaledDecimal | null {
  const scale = Math.max(a.scale, b.scale);
  const lift = (value: ScaledDecimal): number => {
    let int = value.int;
    for (let index = value.scale; index < scale; index++) int *= 10;
    return int;
  };
  const int = lift(a) + lift(b);
  if (!Number.isSafeInteger(int)) return null;
  return { int, scale };
}

/** Rescale to a common scale and subtract exactly. */
export function subtractScaled(a: ScaledDecimal, b: ScaledDecimal): ScaledDecimal | null {
  const negated: ScaledDecimal = { int: -b.int, scale: b.scale };
  return addScaled(a, negated);
}

/** Multiply a scaled decimal by a non-negative integer exactly. */
export function multiplyScaledByInteger(a: ScaledDecimal, factor: number): ScaledDecimal | null {
  if (!Number.isSafeInteger(factor) || factor < 0) return null;
  const int = a.int * factor;
  if (!Number.isSafeInteger(int)) return null;
  return { int, scale: a.scale };
}

/**
 * Compute `price + ticks * tick_size` exactly, rendered canonically (the
 * grid arithmetic of the declared processes). Returns null on any
 * malformed input or unsafe magnitude.
 */
export function shiftPriceByTicks(price: string, ticks: number, tickSize: string): string | null {
  if (ticks === 0) return price;
  const base = parseCanonicalDecimal(price);
  const step = parseCanonicalDecimal(tickSize);
  if (base === null || step === null) return null;
  const moved = multiplyScaledByInteger(step, Math.abs(ticks));
  if (moved === null) return null;
  const sum = ticks > 0 ? addScaled(base, moved) : subtractScaled(base, moved);
  if (sum === null) return null;
  return renderScaledDecimal(sum);
}

/**
 * Is `price` aligned to the `tick` grid (an exact integer multiple)? The
 * coherence law the config enforces on declared start prices, policy
 * spreads and the initial book (the REAL engine re-validates alignment of
 * everything it receives — this keeps the GENERATOR honest up front).
 */
export function isAlignedToGridLocal(price: string, tick: string): boolean {
  const value = parseCanonicalDecimal(price);
  const step = parseCanonicalDecimal(tick);
  if (value === null || step === null || step.int === 0) return false;
  const scale = Math.max(value.scale, step.scale);
  const lift = (candidate: ScaledDecimal): number => {
    let int = candidate.int;
    for (let index = candidate.scale; index < scale; index++) int *= 10;
    return int;
  };
  const liftedValue = lift(value);
  const liftedStep = lift(step);
  if (liftedStep === 0) return false;
  return liftedValue % liftedStep === 0;
}
