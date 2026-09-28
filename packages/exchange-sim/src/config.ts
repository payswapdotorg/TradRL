/**
 * @tradrl/exchange-sim — the exchange configuration (venue parameters,
 * seed, models, fidelity declarations) and its deterministic digest.
 *
 * L5 MODE DISCIPLINE: the `fidelity` field admits exactly the two L5
 * modes an exchange simulator can serve — `reactive_replay` (endogenous
 * participants trading against a seeded book) and `generative`
 * (counterfactual worlds). `exact_replay` FAILS validation with
 * `unsupported_fidelity`: in exact replay, submitted orders are recorded
 * as intents and NEVER matched (see the market-world lane, T009) —
 * matching is precisely the reactive act this engine performs.
 *
 * L9 (reproducible lineage): {@link canonicalConfigJson} serializes a
 * validated config with recursively sorted keys, so equal configs always
 * produce byte-identical canonical JSON regardless of field order at
 * construction; {@link configHash} folds that into an FNV-1a 32-bit
 * digest (the same construction the sibling lanes use). The session
 * records of the reference service bind the digest (L9), and the engine
 * derives every latency draw from the config's seed.
 *
 * VENUE PARAMETERS (the L6 knobs): `tick_size` and `lot_size` (the price
 * and quantity grids), `max_book_depth` (levels retained per side —
 * orders resting beyond the cap are rejected, never silently dropped).
 */

import { deepFreeze, isNonEmptyString, isPositiveSafeInteger, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type ExchangeError, type ExchangeResult } from './errors';
import type { InstrumentId, Seed, VenueId } from './ids';
import { isInstrumentId, isSeed, isVenueId } from './ids';
import { isCanonicalPositiveDecimal, normalize } from './decimals';
import { isAssetClassOfMarket } from './asset-class';
import type { FeeSchedule } from './fees';
import { validateFeeSchedule } from './fees';
import type { LatencyConfig } from './latency';
import { validateLatencyConfig } from './latency';
import type { SlippageConfig } from './slippage';
import { validateSlippageConfig } from './slippage';
import type { MarketImpactPolicy } from './impact';
import { isMarketImpactPolicy, ENGINE_IMPACT_KINDS } from './impact';
import type { JsonValue } from './json';

// ---------------------------------------------------------------------------
// Fidelity (L5 — the modes an exchange simulator serves)
// ---------------------------------------------------------------------------

/** The two L5 modes an exchange simulator serves (exact replay records intents, never matches). */
export type ExchangeFidelity = 'reactive_replay' | 'generative';

/** Runtime-checkable list. */
export const EXCHANGE_FIDELITY_MODES: readonly ExchangeFidelity[] = ['reactive_replay', 'generative'] as const;

/** Runtime guard for an exchange fidelity mode. */
export function isExchangeFidelity(value: unknown): value is ExchangeFidelity {
  return typeof value === 'string' && (EXCHANGE_FIDELITY_MODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The configuration
// ---------------------------------------------------------------------------

/**
 * The fully-determining exchange configuration (L9): venue identity, grid
 * rules, seed, the three execution models and the impact policy.
 */
export interface ExchangeConfig {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  /** The market-protocol asset class of the instrument (envelope taxonomy). */
  readonly asset_class: string;
  /** The price grid (strictly positive canonical decimal, e.g. "0.01"). */
  readonly tick_size: string;
  /** The quantity grid (strictly positive canonical decimal, e.g. "0.001"). */
  readonly lot_size: string;
  /** Maximum book levels retained per side (orders beyond the cap are rejected). */
  readonly max_book_depth: number;
  /** The opaque deterministic seed — every latency draw derives from it. */
  readonly seed: Seed;
  /** The L5 mode this engine serves. */
  readonly fidelity: ExchangeFidelity;
  readonly fees: FeeSchedule;
  readonly latency: LatencyConfig;
  readonly slippage: SlippageConfig;
  readonly impact: MarketImpactPolicy;
}

/**
 * Collect-all validation of an untrusted exchange config. Composes the
 * model validators; enforces grid positivity, the depth cap, the asset
 * class taxonomy and the impact-policy fail-close rule (only 'none' is
 * implementable by this engine — T027 owns the rest). On success the
 * value is returned narrowed, deeply frozen, with tick/lot normalized to
 * canonical decimals.
 */
export function validateExchangeConfig(value: unknown, path = 'config'): ExchangeResult<ExchangeConfig> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExchangeError[] = [];

  if (value.venue === undefined) {
    errors.push(missingField(`${path}.venue`));
  } else if (!isVenueId(value.venue)) {
    errors.push(invalidField(`${path}.venue`, 'must be a non-empty string'));
  }

  if (value.instrument === undefined) {
    errors.push(missingField(`${path}.instrument`));
  } else if (!isInstrumentId(value.instrument)) {
    errors.push(invalidField(`${path}.instrument`, 'must be a non-empty string'));
  }

  if (value.asset_class === undefined) {
    errors.push(missingField(`${path}.asset_class`));
  } else if (!isAssetClassOfMarket(value.asset_class)) {
    errors.push(invalidField(`${path}.asset_class`, 'must be a canonical market-protocol asset class'));
  }

  if (value.tick_size === undefined) {
    errors.push(missingField(`${path}.tick_size`));
  } else if (!isCanonicalPositiveDecimal(value.tick_size)) {
    errors.push(invalidField(`${path}.tick_size`, 'must be a canonical decimal string greater than zero (e.g. "0.01")'));
  }

  if (value.lot_size === undefined) {
    errors.push(missingField(`${path}.lot_size`));
  } else if (!isCanonicalPositiveDecimal(value.lot_size)) {
    errors.push(invalidField(`${path}.lot_size`, 'must be a canonical decimal string greater than zero (e.g. "0.001")'));
  }

  if (value.max_book_depth === undefined) {
    errors.push(missingField(`${path}.max_book_depth`));
  } else if (!isPositiveSafeInteger(value.max_book_depth)) {
    errors.push(invalidField(`${path}.max_book_depth`, 'must be a positive safe integer'));
  }

  if (value.seed === undefined) {
    errors.push(missingField(`${path}.seed`));
  } else if (!isSeed(value.seed)) {
    errors.push(invalidField(`${path}.seed`, 'must be a non-empty string'));
  }

  if (value.fidelity === undefined) {
    errors.push(missingField(`${path}.fidelity`));
  } else if (value.fidelity === 'exact_replay') {
    errors.push({
      code: 'unsupported_fidelity',
      path: `${path}.fidelity`,
      message: "exact_replay records orders as intents and never matches them (T009) — an exchange simulator serves reactive_replay or generative",
    });
  } else if (!isExchangeFidelity(value.fidelity)) {
    errors.push(invalidField(`${path}.fidelity`, `must be one of ${EXCHANGE_FIDELITY_MODES.join(' | ')}`));
  }

  let fees: FeeSchedule | undefined;
  if (value.fees === undefined) {
    errors.push(missingField(`${path}.fees`));
  } else {
    const feesResult = validateFeeSchedule(value.fees, `${path}.fees`);
    if (feesResult.ok) fees = feesResult.value;
    else errors.push(...feesResult.errors);
  }

  let latency: LatencyConfig | undefined;
  if (value.latency === undefined) {
    errors.push(missingField(`${path}.latency`));
  } else {
    const latencyResult = validateLatencyConfig(value.latency, `${path}.latency`);
    if (latencyResult.ok) latency = latencyResult.value;
    else errors.push(...latencyResult.errors);
  }

  let slippage: SlippageConfig | undefined;
  if (value.slippage === undefined) {
    errors.push(missingField(`${path}.slippage`));
  } else {
    const slippageResult = validateSlippageConfig(value.slippage, `${path}.slippage`);
    if (slippageResult.ok) slippage = slippageResult.value;
    else errors.push(...slippageResult.errors);
  }

  if (value.impact === undefined) {
    errors.push(missingField(`${path}.impact`));
  } else if (!isMarketImpactPolicy(value.impact)) {
    errors.push(invalidField(`${path}.impact`, 'must be a market-impact policy record (kind, declaration, limitation)'));
  } else if (!(ENGINE_IMPACT_KINDS as readonly string[]).includes(value.impact.kind)) {
    errors.push({
      code: 'unsupported_impact_policy',
      path: `${path}.impact.kind`,
      message: `impact kind "${value.impact.kind}" is not implemented by this engine (only 'none') — endogenous impact belongs to the reactive-world lane (T027); the engine fail-closes rather than guessing semantics`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      venue: value.venue as VenueId,
      instrument: value.instrument as InstrumentId,
      asset_class: value.asset_class as string,
      tick_size: normalize(value.tick_size as string),
      lot_size: normalize(value.lot_size as string),
      max_book_depth: value.max_book_depth as number,
      seed: value.seed as Seed,
      fidelity: value.fidelity as ExchangeFidelity,
      fees: fees as FeeSchedule,
      latency: latency as LatencyConfig,
      slippage: slippage as SlippageConfig,
      impact: deepFreeze({ ...(value.impact as MarketImpactPolicy) }),
    }),
  );
}

/** Runtime guard for a structurally valid exchange config. */
export function isExchangeConfig(value: unknown): value is ExchangeConfig {
  // Full validation is the authority; this guard is the cheap structural
  // check for hot paths (validation results can be cached by callers).
  if (!isRecord(value)) return false;
  if (!isVenueId(value.venue) || !isInstrumentId(value.instrument)) return false;
  if (!isNonEmptyString(value.asset_class) || !isAssetClassOfMarket(value.asset_class)) return false;
  if (!isCanonicalPositiveDecimal(value.tick_size) || !isCanonicalPositiveDecimal(value.lot_size)) return false;
  if (!isPositiveSafeInteger(value.max_book_depth)) return false;
  if (!isSeed(value.seed) || !isExchangeFidelity(value.fidelity)) return false;
  if (!isRecord(value.fees) || !isRecord(value.latency) || !isRecord(value.slippage) || !isRecord(value.impact)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Canonical serialization + digest (L9)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash of a string, as zero-padded lowercase hex (the canonical TradRL derivation, mirrored). */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Canonical JSON serialization of any JSON value: object keys recursively
 * sorted (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values always serialize
 * byte-identically (mirror of the sibling lanes' canonicalJson).
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
 * Canonical JSON of a validated exchange config — the config's lineage
 * anchor: equal configs produce byte-identical bytes regardless of field
 * order at construction (L9). The tree is built field-by-field (no casts)
 * so the compiler proves JSON-safety.
 */
export function canonicalConfigJson(config: ExchangeConfig): string {
  const tree: JsonValue = {
    venue: config.venue,
    instrument: config.instrument,
    asset_class: config.asset_class,
    tick_size: config.tick_size,
    lot_size: config.lot_size,
    max_book_depth: config.max_book_depth,
    seed: config.seed,
    fidelity: config.fidelity,
    fees: {
      tiers: config.fees.tiers.map((tier) => ({
        up_to_notional: tier.up_to_notional,
        maker_bps: tier.maker_bps,
        taker_bps: tier.taker_bps,
      })),
      fee_decimals: config.fees.fee_decimals,
    },
    latency: config.latency.kind === 'fixed'
      ? { kind: 'fixed', fixed_ms: config.latency.fixed_ms }
      : { kind: 'uniform', min_ms: config.latency.min_ms, max_ms: config.latency.max_ms },
    slippage: config.slippage.kind === 'book_walk' ? { kind: 'book_walk' } : { kind: 'fixed_bps', bps: config.slippage.bps },
    impact: {
      kind: config.impact.kind,
      declaration: config.impact.declaration,
      limitation: config.impact.limitation,
    },
  };
  return canonicalJson(tree);
}

/**
 * The deterministic digest of an exchange config: FNV-1a 32-bit of the
 * canonical config JSON, as zero-padded lowercase hex. Bound into the
 * reference service's session records (L9) and used to derive the
 * service's world id.
 */
export function configHash(config: ExchangeConfig): string {
  return fnv1a32Hex(canonicalConfigJson(config));
}
