/**
 * @tradrl/learning (service) — curriculum-lane shared primitives (T015).
 *
 * The structural foundation of the curriculum and populations submodules:
 * compile-time branding, hand-rolled total guards, the deep-freeze
 * discipline, the JSON value model, canonical JSON and FNV-1a digests, the
 * TimestampMs mirror, and this lane's TYPED error taxonomy.
 *
 * Spec anchors: spec/ARCHITECTURE-LOCK.md L9 (reproducible lineage),
 * L11 (search integrity — stage trails and population histories are
 * append-only), L12 (tenant isolation); spec/LEARNING-LOOP.md (the
 * curriculum ladder schedules the native loop). Program decisions D-003 /
 * D-004: contract vocabularies are shared by STRUCTURAL MIRRORS, never by
 * imports — this module re-declares the same helper set every contract
 * package carries (packages/rl-protocol, packages/compute, ...); the drift
 * trip wires live in this lane's interop tests.
 *
 * Laws honored here (Work Order T015):
 * - ZERO runtime dependencies; pure data and pure functions only.
 * - No `any` anywhere; every exported shape has a hand-rolled total guard.
 * - No ambient clock: `Date.now()` never appears — every instant is an
 *   explicit parameter, so every derived record is replayable and
 *   byte-deterministic (same inputs -> identical canonical bytes, twice).
 * - No ambient randomness: seeded derivations only (FNV-1a over declared
 *   identity strings).
 * - Cross-lane entities are referenced ONLY through opaque branded string
 *   ids — never imported (D-003/D-004).
 */

// ---------------------------------------------------------------------------
// Compile-time branding
// ---------------------------------------------------------------------------

/**
 * Nominal tag for otherwise-primitive values. The brand exists only at
 * compile time; at runtime this is the underlying primitive. Obtain branded
 * values ONLY through the validating guards of this lane.
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

/** `true` when `v` is a safe integer `>= 0` (counts, ordinals, versions minus one). */
export function isNonNegativeSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** `true` when `v` is a safe integer `>= 1` (versions, generations, budgets). */
export function isPositiveSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

/** `true` when `v` is a finite number in `[0, 1]` (shares, ratios). */
export function isUnitInterval(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
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
// Deep immutability (runtime half of the append-only discipline, L9/L11)
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
 * The runtime check behind "plans, trails, populations and matchups are
 * append-only, deeply-frozen value objects": a value this lane constructed
 * that is not deeply frozen fails this check.
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
        const child: unknown = (current as Record<string, unknown>)[key];
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    }
  }
  return true;
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
 * canonical form is a program-wide law, not a package choice (the
 * determinism law: same inputs -> byte-identical plans and populations).
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
 * program-wide. Stage-plan digests, experiment ids, job ids, trial ids and
 * mutation derivations are all FNV-1a 32-bit values (8 lowercase hex chars).
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
// Typed errors and results (the curriculum-lane taxonomy)
// ---------------------------------------------------------------------------

/**
 * Machine-readable failure codes for curriculum and population operations.
 * The taxonomy is the Work Order T015 error spine: the ladder laws
 * (`stage_unknown`, `ladder_violation`), the stage-9 gate
 * (`live_permission_missing`), the evidence gate (`evidence_missing`,
 * `evidence_insufficient`), L6 fidelity honesty (`fidelity_claim_violation`),
 * L9 lineage (`lineage_gap`, `lineage_mismatch`), L10 (`population_missing`,
 * `adversary_not_fieldable`), L11 search integrity (`trail_rewrite`,
 * `hidden_adversary`), L12 (`tenant_missing`, `tenant_scope_mismatch`), plus
 * the closed envelope vocabulary the sibling lanes share.
 */
export type CurriculumErrorCode =
  // --- generic envelope validation ------------------------------------------
  /** The root value is not an object/array where one is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A branded id is not a non-empty string. */
  | 'invalid_id'
  /** A value is not a valid epoch-millisecond timestamp. */
  | 'invalid_timestamp'
  /** A value is not a JSON-safe opaque payload. */
  | 'invalid_payload'
  // --- the ladder laws --------------------------------------------------------
  /** A stage string outside the frozen nine-stage union (the ladder is closed). */
  | 'stage_unknown'
  /** A stage move violates the ladder order (skips, sideways, illegal regress). */
  | 'ladder_violation'
  /** Stage 9 (controlled_live) scheduled or entered without the declared permission record. */
  | 'live_permission_missing'
  // --- evidence-gated advancement (T012 citations) -----------------------------
  /** A transition cites no attainment-verdict evidence at all. */
  | 'evidence_missing'
  /** The cited verdict exists but cannot justify the move (non-attained advance). */
  | 'evidence_insufficient'
  // --- L6 fidelity honesty -------------------------------------------------------
  /** A stage descriptor's world mode contradicts the fidelity claim of its stage kind. */
  | 'fidelity_claim_violation'
  // --- L9 lineage ------------------------------------------------------------------
  /** A lineage field is absent or malformed. */
  | 'lineage_gap'
  /** A record's lineage is incoherent with its context (foreign scope, unknown parent). */
  | 'lineage_mismatch'
  // --- L10 adversarial discipline ----------------------------------------------------
  /** Stage 5 (adversarial_population) scheduled with no population to field. */
  | 'population_missing'
  /** A matchup names adversaries the cited population cannot field. */
  | 'adversary_not_fieldable'
  // --- L11 search integrity -----------------------------------------------------------
  /** An append-only trail or population history was rewritten, truncated or reordered. */
  | 'trail_rewrite'
  /** A retired adversary was hidden from a successor population record. */
  | 'hidden_adversary'
  // --- L12 tenant isolation --------------------------------------------------------------
  /** The tenant/project scope is absent or malformed. */
  | 'tenant_missing'
  /** A record's tenant/project scope disagrees with its context (L12 isolation). */
  | 'tenant_scope_mismatch'
  // --- version / method / selection ----------------------------------------------------------
  /** The curriculum version record violates its contract. */
  | 'version_invalid'
  /** A method string outside the LEARNING-LOOP method union. */
  | 'method_unknown'
  /** A gap kind has no declared remediation in the curriculum version. */
  | 'gap_unmapped'
  /** The declared selection cannot be executed over the population (counts, coverage). */
  | 'selection_infeasible';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface CurriculumError {
  readonly code: CurriculumErrorCode;
  /** Dotted path from the validated root, e.g. `stages[2].world_mode`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type CurriculumResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly CurriculumError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: CurriculumErrorCode, message: string, path = ''): CurriculumResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly CurriculumError[]): CurriculumResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): CurriculumResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): CurriculumError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): CurriculumError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): CurriculumError {
  return { code: 'invalid_type', path: '', message };
}
