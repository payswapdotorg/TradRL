/**
 * @tradrl/autonomous-learning (service) — shared primitives (Work Order
 * T035).
 *
 * The lane's own contract discipline, re-declared per the D-003/D-004
 * mirror law (this service owns NO contract package among the frozen
 * siblings — the services/api precedent): compile-time branding,
 * hand-rolled total guards, the deep-freeze discipline, the JSON value
 * model, canonical JSON + FNV-1a digests (the program-wide law), the
 * dual-lane stable digest (the exact mirror of @tradrl/search-lineage's
 * and @tradrl/evaluation's function — the fold behind T031's search
 * chains, re-declared here so this lane can VERIFY search records and
 * curriculum trails it did not build; the interop trip wires prove the
 * agreement), the TimestampMs mirror of @tradrl/time-engine, and this
 * lane's TYPED error taxonomy.
 *
 * Laws honored here (Work Order T035, following the merged lanes):
 * - ZERO runtime dependencies; pure data and pure functions only.
 * - No `any` anywhere; every exported shape has a hand-rolled total guard.
 * - No ambient clock: `Date.now()` never appears — every instant is an
 *   explicit parameter, so every derived record is replayable and
 *   byte-deterministic (same inputs -> identical canonical bytes, twice).
 * - No ambient randomness: content-addressed derivations only (FNV-1a
 *   over declared identity content).
 * - Cross-lane entities are referenced ONLY through opaque branded string
 *   ids — never imported (D-003/D-004).
 */

// ---------------------------------------------------------------------------
// Compile-time branding
// ---------------------------------------------------------------------------

/**
 * Nominal tag for otherwise-primitive values. The brand exists only at
 * compile time; at runtime this is the underlying primitive. Obtain
 * branded values ONLY through the validating guards of this lane.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

// ---------------------------------------------------------------------------
// Structural type-check helpers (hand-rolled, `any`-free)
// ---------------------------------------------------------------------------

/** `true` when `v` is a plain object (not an array, not a class instance). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** `true` when `v` is a non-empty string after trimming. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** `true` when `v` is a finite number (never NaN, never ±Infinity). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** `true` when `v` is a safe integer `>= 1` (ordinals, versions, counts). */
export function isPositiveSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

/** `true` when `v` is a safe integer `>= 0`. */
export function isNonNegativeSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** `true` when `v` is a member of the closed string list `values`. */
export function isMemberOf<T extends string>(values: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v);
}

/** `true` when `v` is an array whose every element satisfies `guard`. */
export function isArrayOf<T>(v: unknown, guard: (element: unknown) => element is T): v is readonly T[] {
  if (!Array.isArray(v)) return false;
  return v.every((element) => guard(element));
}

/** Strips `readonly` modifiers — used by tests to attempt mutations. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Deep immutability (the runtime half of the append-only discipline)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze`s every reachable plain object and array.
 * Already-frozen branches are skipped, so cycles terminate and shared
 * frozen substructures cost nothing. Returns the same reference.
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

// ---------------------------------------------------------------------------
// JSON value model (opaque payloads)
// ---------------------------------------------------------------------------

/** Recursive JSON value model. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

/** A JSON object (record of JSON values). */
export type JsonObject = { readonly [key: string]: JsonValue };

/** Runtime guard for a JSON value (deep). */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((element) => isJsonValue(element));
  if (typeof value === 'object') {
    return Object.values(value).every((element) => isJsonValue(element));
  }
  return false;
}

/** Runtime guard for a JSON object. */
export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((element) => isJsonValue(element));
}

// ---------------------------------------------------------------------------
// Canonical JSON + stable digests (byte-determinism law)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization of any JSON value: object keys recursively
 * sorted (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values always serialize
 * byte-identically. Mirror of every contract package's canonicalJson — the
 * canonical form is a program-wide law, not a package choice.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value); // finite by the JSON model
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const object = value as JsonObject;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

/**
 * FNV-1a 32-bit hash of a string, as zero-padded lowercase hex. Mirror of
 * every contract package's fnv1a32Hex — the digest discipline is
 * program-wide. Cycle ids, gap ids, revision/commission/feed ids and the
 * improvement log's chain fold are all FNV-1a 32-bit values.
 */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Runtime guard for an 8-char lowercase-hex digest (the FNV-1a discipline). */
export function isDigest8(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}$/.test(value);
}

// ---------------------------------------------------------------------------
// The dual-lane stable digest (T031's chain fold — the exact mirror)
// ---------------------------------------------------------------------------

/** Fixed 32-bit FNV-1a offset basis and prime (hand-rolled digest, L9). */
const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/** One 32-bit FNV-1a round over a UTF-16 code unit (denormalized to UTF-8 bytes, mirroring @tradrl/search-lineage). */
function fnv1aRound(hash: number, unit: number): number {
  const bytes: number[] = [];
  if (unit < 0x80) {
    bytes.push(unit);
  } else if (unit < 0x800) {
    bytes.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f));
  } else if (unit < 0x10000) {
    bytes.push(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f));
  } else {
    bytes.push(
      0xf0 | (unit >> 18),
      0x80 | ((unit >> 12) & 0x3f),
      0x80 | ((unit >> 6) & 0x3f),
      0x80 | (unit & 0x3f),
    );
  }
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}

/**
 * The dual-lane FNV-1a stable digest — the EXACT mirror of
 * @tradrl/search-lineage's `stableDigest` (itself the mirror of
 * @tradrl/evaluation's function; same seeding, same even/odd lanes, same
 * length fold, same 16-hex rendering). DO NOT DIVERGE: this lane
 * re-declares it to VERIFY search-record chains and the derived snapshot
 * addresses it did not build — the interop trip wire proves a REAL
 * @tradrl/search-lineage record verifies here byte-for-byte.
 */
export function stableDigest(canonical: string): string {
  let even = FNV_OFFSET_32;
  let odd = FNV_OFFSET_32 ^ 0x2f6e2e1; // second lane seed (arbitrary, fixed forever)
  const units = Array.from(canonical);
  for (let index = 0; index < units.length; index++) {
    const unit = units[index].codePointAt(0) as number;
    if (index % 2 === 0) even = fnv1aRound(even, unit);
    else odd = fnv1aRound(odd, unit);
  }
  // Fold the length into both lanes so prefix-extension collisions cannot survive.
  even = Math.imul(even ^ units.length, FNV_PRIME_32) >>> 0;
  odd = Math.imul(odd ^ (units.length * 31), FNV_PRIME_32) >>> 0;
  const hex = (value: number): string => value.toString(16).padStart(8, '0');
  return `${hex(even)}${hex(odd)}`;
}

/** Stable digest of any JSON value through the canonical form (the search chain's per-entry fold input). */
export function stableDigestJson(value: JsonValue): string {
  return stableDigest(canonicalJson(value));
}

// ---------------------------------------------------------------------------
// The TimestampMs mirror (canonical owner: @tradrl/time-engine)
// ---------------------------------------------------------------------------

/** Epoch milliseconds, information-availability-safe. Mirror of the program-wide `TradRL.TimestampMs` brand. */
export type TimestampMs = Brand<number, 'TradRL.TimestampMs'>;

/** The smallest legal epoch-millisecond instant (mirror of the time-engine bound). */
export const MIN_TIMESTAMP_MS = 0;

/** The largest legal epoch-millisecond instant (mirror of the time-engine bound). */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Runtime guard for a TimestampMs (integer epoch-ms within the legal range). */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_TIMESTAMP_MS && value <= MAX_TIMESTAMP_MS;
}

// ---------------------------------------------------------------------------
// Typed errors and results (the autonomous-learning taxonomy)
// ---------------------------------------------------------------------------

/**
 * Machine-readable failure codes for autonomous-improvement operations.
 * The taxonomy is the Work Order T035 error spine: the envelope codes the
 * sibling lanes share, L12 (`tenant_missing`, `tenant_scope_mismatch` —
 * one scope per cycle, foreign records never improve another tenant),
 * L4 (`l4_boundary_violation` — the loop never learns from the future),
 * the idempotence law (`duplicate_evidence` — a hook contributes EXACTLY
 * ONCE), the chain laws (`chain_mismatch` — a tampered improvement log,
 * search record or curriculum trail never drives improvement), T031's
 * platform laws (`hidden_trials` — cited evidence outside the retained
 * search record), the policy laws (`policy_invalid`, `gap_unmapped`) and
 * the lineage law (`lineage_gap`).
 */
export type ImprovementErrorCode =
  // --- generic envelope validation ------------------------------------------
  /** The root value is not an object/array where one is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A branded id is not a well-formed identity. */
  | 'invalid_id'
  /** A value is not a valid epoch-millisecond timestamp. */
  | 'invalid_timestamp'
  // --- L12 tenant isolation ----------------------------------------------------
  /** The tenant/project scope is absent or malformed. */
  | 'tenant_missing'
  /** A record's tenant/project scope disagrees with the cycle's (L12 isolation). */
  | 'tenant_scope_mismatch'
  // --- L4 point-in-time truth ----------------------------------------------------
  /** A record or query instant precedes evidence it must postdate (no learning from the future). */
  | 'l4_boundary_violation'
  // --- idempotence -----------------------------------------------------------------
  /** A learning hook was supplied/consumed twice (evidence contributes EXACTLY ONCE). */
  | 'duplicate_evidence'
  // --- the chain laws -----------------------------------------------------------------
  /** A chain-verified ledger (improvement log, search record, curriculum trail) fails verification. */
  | 'chain_mismatch'
  // --- T031 platform integrity -----------------------------------------------------------
  /** Cited evaluation evidence names trials the retained search record does not hold. */
  | 'hidden_trials'
  // --- the policy laws ---------------------------------------------------------------------
  /** The improvement policy violates its contract (totality, closed vocabularies, coherence). */
  | 'policy_invalid'
  /** A focus row selects no gap kind (null) where the policy demands one. */
  | 'gap_unmapped'
  // --- lineage --------------------------------------------------------------------------------
  /** A required lineage input (planning context, trail, search record) is absent or malformed. */
  | 'lineage_gap';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface ImprovementError {
  readonly code: ImprovementErrorCode;
  /** Dotted path from the validated root, e.g. `hooks[2].asOf`. Empty for cycle-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type ImprovementResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ImprovementError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: ImprovementErrorCode, message: string, path = ''): ImprovementResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly ImprovementError[]): ImprovementResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): ImprovementResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): ImprovementError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): ImprovementError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): ImprovementError {
  return { code: 'invalid_type', path: '', message };
}
