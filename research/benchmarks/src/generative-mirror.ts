/**
 * @tradrl/research-benchmarks — the T028 GENERATIVE REGIME POPULATION
 * MIRROR + the LEARNING-LOOP REGIME LADDER (Work Order T032).
 *
 * STRUCTURAL MIRROR of the generative lane's declared-surface shapes (T028,
 * services/market-world/src/generative): there IS no recorded stream —
 * entire market POPULATIONS are generated from DECLARED, SEEDED, VERSIONED
 * stochastic processes (the `ProcessDeclaration` mirror below,
 * field-for-field) under a fully-determining config whose digest the
 * generative service binds into every run record. This mirror re-declares
 * the data face of that surface so a benchmark over a generative regime
 * population binds the SAME identity material a T028 run record binds
 * (L9): the process declarations, the seed, the config digest, and the
 * regime vocabulary the population generates. The origin is 'generated'
 * (the market-protocol/T028 provenance vocabulary mirror): generative
 * worlds are exploration/stress instruments, not historical truth (L5/L6).
 *
 * THE REGIME LADDER (spec/LEARNING-LOOP.md curriculum — the suite's
 * generative driver must cover it, per the Work Order: "the LEARNING-LOOP
 * regime ladder from simple synthetic regimes to unseen multi-regime
 * combinations"):
 *   1. `synthetic-single-regime`  — curriculum step 1 ("Simple synthetic
 *      regimes"): the population generates exactly ONE regime; nothing is
 *      unseen.
 *   2. `synthetic-multi-regime`  — the bridge: the population generates
 *      two or more regimes; still nothing unseen.
 *   3. `unseen-multi-regime`     — curriculum step 6 ("Unseen multi-regime
 *      tests"): the population declares a DISJOINT unseen regime set, and
 *      the unseen multi-regime evaluation scores material covering >= 2
 *      distinct regimes including >= 1 unseen one — combinations the
 *      search never optimized against ("Use unseen periods, regimes,
 *      assets, venues or combinations not optimized against",
 *      spec/EVALUATION-PROTOCOL.md).
 *
 * The ladder laws are enforced typed by the benchmark driver
 * (`ladder_violation`): a level's structural law is data, not decoration.
 */

import { deepFreeze, isDigest, isJsonObject, isNonEmptyString, isPositiveInteger, isRecord, stableDigestJson } from './primitives';
import type { JsonObject } from './primitives';
import { fail, invalidField, invalidType, missingField, ok, type BenchmarkError, type BenchmarkResult } from './errors';

/** The derivation prefix of every generative source id. */
export const GENERATIVE_SOURCE_ID_PREFIX = 'gsrc:' as const;

// ---------------------------------------------------------------------------
// The process declaration mirror (T028's declared stochastic processes)
// ---------------------------------------------------------------------------

/**
 * The closed process-kind vocabulary — MIRROR of T028's `ProcessKind`
 * (services/market-world/src/generative/process.ts; DO NOT DIVERGE — the
 * interop trip-wire proves mutual assignability against the real
 * declaration type; a vocabulary change in the generative lane must fail
 * this lane's typecheck loudly):
 * - `reference_price_walk` — the WORLD process (exactly one per config).
 * - `market_maker` / `momentum_taker` / `mean_reverter` / `noise_trader` —
 *   the POPULATION behavior policies.
 */
export type ProcessKindMirror =
  | 'reference_price_walk'
  | 'market_maker'
  | 'momentum_taker'
  | 'mean_reverter'
  | 'noise_trader';

/** Runtime-checkable list (mirror of T028's PROCESS_KINDS). */
export const PROCESS_KINDS_MIRROR: readonly ProcessKindMirror[] = [
  'reference_price_walk',
  'market_maker',
  'momentum_taker',
  'mean_reverter',
  'noise_trader',
] as const;

/** Guard: a process kind (mirror). */
export function isProcessKindMirror(value: unknown): value is ProcessKindMirror {
  return typeof value === 'string' && (PROCESS_KINDS_MIRROR as readonly string[]).includes(value);
}

/**
 * One declared stochastic process — STRUCTURAL MIRROR of T028's
 * `ProcessDeclaration` (field-for-field): versioned (a parameterization
 * change is a NEW record), seeded (the seed derives every draw — never
 * ambient randomness), cadenced (`step_ms` fixes the firing instants), and
 * closed (`params` carries the kind's declared parameters).
 */
export interface ProcessDeclarationMirror {
  readonly process_id: string;
  readonly version: string;
  readonly kind: ProcessKindMirror;
  readonly seed: string;
  readonly step_ms: number;
  readonly params: JsonObject;
}

/** Guard: `ProcessDeclarationMirror`. */
export function isProcessDeclarationMirror(value: unknown): value is ProcessDeclarationMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.process_id)) return false;
  if (!isNonEmptyString(value.version)) return false;
  if (!isProcessKindMirror(value.kind)) return false;
  if (!isNonEmptyString(value.seed)) return false;
  if (!isPositiveInteger(value.step_ms)) return false;
  return isJsonObject(value.params);
}

// ---------------------------------------------------------------------------
// The regime ladder (spec/LEARNING-LOOP.md curriculum)
// ---------------------------------------------------------------------------

/** The LEARNING-LOOP regime ladder levels (see the module header). */
export const REGIME_LADDER = ['synthetic-single-regime', 'synthetic-multi-regime', 'unseen-multi-regime'] as const;
export type RegimeLadderLevel = (typeof REGIME_LADDER)[number];

/** Runtime-checkable list of the ladder levels. */
export const REGIME_LADDER_LEVELS: readonly RegimeLadderLevel[] = REGIME_LADDER;

/** Guard: a ladder level. */
export function isRegimeLadderLevel(value: unknown): value is RegimeLadderLevel {
  return typeof value === 'string' && (REGIME_LADDER as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The generative regime population source
// ---------------------------------------------------------------------------

/**
 * The generative regime population source: the declared seeded processes
 * (T028 mirror), the regime vocabulary the population generates, the
 * DISJOINT unseen regime set (ladder level 3), the population seed and the
 * generative config digest (T028's content identity). The id is
 * content-addressed (`gsrc:<digest>`), so identical populations address
 * identically (L9).
 */
export interface RegimePopulationSource {
  readonly source_id: string;
  readonly kind: 'generative-population';
  readonly origin: 'generated';
  /** Regime labels the population generates for SEARCH material (non-empty, unique). */
  readonly regimes: readonly string[];
  /** Regime labels held OUT of the search population (unique; disjoint from `regimes`). */
  readonly unseen_regimes: readonly string[];
  /** The declared seeded stochastic processes (non-empty; unique process ids). */
  readonly processes: readonly ProcessDeclarationMirror[];
  /** The population's opaque deterministic seed (T028 mirror). */
  readonly seed: string;
  /** The deterministic digest of the generative world config (T028 config-hash mirror). */
  readonly config_digest: string;
}

/** Guard: `RegimePopulationSource` (structural; the ladder disjointness law is enforced by validation). */
export function isRegimePopulationSource(value: unknown): value is RegimePopulationSource {
  if (!isRecord(value)) return false;
  if (typeof value.source_id !== 'string' || !value.source_id.startsWith(GENERATIVE_SOURCE_ID_PREFIX)) return false;
  if (value.kind !== 'generative-population') return false;
  if (value.origin !== 'generated') return false;
  if (!Array.isArray(value.regimes) || value.regimes.length === 0) return false;
  if (!(value.regimes as readonly unknown[]).every((label) => isNonEmptyString(label))) return false;
  if (new Set(value.regimes as readonly string[]).size !== (value.regimes as readonly unknown[]).length) return false;
  if (!Array.isArray(value.unseen_regimes)) return false;
  if (!(value.unseen_regimes as readonly unknown[]).every((label) => isNonEmptyString(label))) return false;
  if (new Set(value.unseen_regimes as readonly string[]).size !== (value.unseen_regimes as readonly unknown[]).length) return false;
  if (!Array.isArray(value.processes) || value.processes.length === 0) return false;
  if (!(value.processes as readonly unknown[]).every((declaration) => isProcessDeclarationMirror(declaration))) return false;
  if (!isNonEmptyString(value.seed)) return false;
  return isDigest(value.config_digest);
}

/** The canonical source JSON (the content-addressing input; no `source_id`). */
export function generativeSourceJson(content: Omit<RegimePopulationSource, 'source_id'>): JsonObject {
  return {
    kind: content.kind,
    origin: content.origin,
    regimes: content.regimes,
    unseen_regimes: content.unseen_regimes,
    processes: content.processes as unknown as readonly JsonObject[],
    seed: content.seed,
    config_digest: content.config_digest,
  };
}

/** Compute the content address of a generative source: `gsrc:<digest>`. */
export function generativeSourceId(content: Omit<RegimePopulationSource, 'source_id'>): string {
  return `${GENERATIVE_SOURCE_ID_PREFIX}${stableDigestJson(generativeSourceJson(content))}`;
}

/** The content digest of a validated source (manifest lineage binding). */
export function generativeSourceDigest(source: RegimePopulationSource): string {
  return stableDigestJson(generativeSourceJson(source));
}

/**
 * Collect-all validation of an untrusted generative regime population
 * source. Enforces the disjointness law (`regimes` ∩ `unseen_regimes` =
 * ∅ — an unseen regime that is also a search regime is not unseen) and the
 * unique-process-id law. On success the source is returned narrowed,
 * deeply frozen, with the DERIVED content address (`gsrc:<digest>`) — a
 * supplied id that disagrees with the content fails `invalid_field` (L9).
 */
export function validateRegimePopulationSource(value: unknown, path = 'data_source'): BenchmarkResult<RegimePopulationSource> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: BenchmarkError[] = [];
  if (value.kind === undefined) errors.push(missingField(`${path}.kind`));
  else if (value.kind !== 'generative-population') errors.push(invalidField(`${path}.kind`, "must be 'generative-population'"));

  if (value.origin === undefined) errors.push(missingField(`${path}.origin`));
  else if (value.origin !== 'generated') errors.push(invalidField(`${path}.origin`, "a generative population's origin must be 'generated' (the synthetic-provenance declaration, L5/L6)"));

  if (value.regimes === undefined) {
    errors.push(missingField(`${path}.regimes`));
  } else if (!Array.isArray(value.regimes) || value.regimes.length === 0) {
    errors.push(invalidField(`${path}.regimes`, 'must be a non-empty array of regime labels'));
  } else if (new Set(value.regimes as readonly string[]).size !== (value.regimes as readonly unknown[]).length) {
    errors.push(invalidField(`${path}.regimes`, 'must not repeat a regime label'));
  }

  if (value.unseen_regimes === undefined) {
    errors.push(missingField(`${path}.unseen_regimes`));
  } else if (!Array.isArray(value.unseen_regimes)) {
    errors.push(invalidField(`${path}.unseen_regimes`, 'must be an array of unseen regime labels'));
  } else if (new Set(value.unseen_regimes as readonly string[]).size !== (value.unseen_regimes as readonly unknown[]).length) {
    errors.push(invalidField(`${path}.unseen_regimes`, 'must not repeat an unseen regime label'));
  }

  if (value.processes === undefined) {
    errors.push(missingField(`${path}.processes`));
  } else if (!Array.isArray(value.processes) || value.processes.length === 0) {
    errors.push(invalidField(`${path}.processes`, 'must be a non-empty array of declared stochastic processes (the T028 mirror)'));
  } else {
    const seen = new Set<string>();
    (value.processes as readonly unknown[]).forEach((candidate, index) => {
      if (!isProcessDeclarationMirror(candidate)) {
        errors.push(invalidField(`${path}.processes[${index}]`, 'must be a declared process: { process_id, version, kind, seed, step_ms, params }'));
      } else {
        const declaration = candidate as ProcessDeclarationMirror;
        if (seen.has(declaration.process_id)) {
          errors.push(invalidField(`${path}.processes[${index}].process_id`, `duplicate process id "${declaration.process_id}"`));
        }
        seen.add(declaration.process_id);
      }
    });
  }

  if (value.seed === undefined) errors.push(missingField(`${path}.seed`));
  else if (!isNonEmptyString(value.seed)) errors.push(invalidField(`${path}.seed`, 'must be a non-empty deterministic seed'));

  if (value.config_digest === undefined) errors.push(missingField(`${path}.config_digest`));
  else if (!isDigest(value.config_digest)) errors.push(invalidField(`${path}.config_digest`, 'must be the deterministic digest of the generative world config (the T028 config hash)'));

  if (errors.length > 0) return { ok: false, errors };

  const regimes = value.regimes as readonly string[];
  const unseenRegimes = value.unseen_regimes as readonly string[];
  const overlap = regimes.filter((label) => unseenRegimes.includes(label));
  if (overlap.length > 0) {
    return fail('invalid_field', `unseen regime(s) [${overlap.join(', ')}] also appear in the population's search regimes — an unseen regime that is also a search regime is not unseen (the ladder disjointness law)`, `${path}.unseen_regimes`);
  }

  const content: Omit<RegimePopulationSource, 'source_id'> = {
    kind: 'generative-population',
    origin: 'generated',
    regimes,
    unseen_regimes: unseenRegimes,
    processes: value.processes as readonly ProcessDeclarationMirror[],
    seed: value.seed as string,
    config_digest: value.config_digest as string,
  };
  const derivedId = generativeSourceId(content);
  if (value.source_id !== undefined && value.source_id !== derivedId) {
    return fail('invalid_field', `source id "${value.source_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`, `${path}.source_id`);
  }
  return ok(deepFreeze({ source_id: derivedId, ...content } satisfies RegimePopulationSource));
}
