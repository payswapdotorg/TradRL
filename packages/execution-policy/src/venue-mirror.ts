// @tradrl/execution-policy — the exchange-lane structural mirrors: the
// venue-side physics the execution SIMULATOR drives.
//
// STRUCTURAL MIRROR of @tradrl/exchange-sim (T010) — re-declared by
// STRUCTURE, never imported (D-003/D-004): the FeeSchedule, the
// LatencyConfig, the SlippageConfig, the MarketImpactPolicy, the
// ExchangeConfig (venue parameters + seed + fidelity) and the book
// snapshot seed — field-for-field identical (same names, same brands,
// same optionality, same validation laws), so a REAL exchange-sim
// config IS a {@link VenueModelConfigMirror} (mutually assignable, zero
// casts; proven by src/interop.test.ts against the REAL package on this
// branch). Any change in the exchange-sim contracts MUST be mirrored
// here and vice versa.
//
// WHY THIS MIRROR EXISTS (the Work Order's §2: "packages/exchange-sim/
// src/** (T010): MatchingEngine, OrderIntent, FeeSchedule,
// LatencyConfig, SlippageConfig, MarketImpactPolicy — the venue-side
// physics your simulator drives (mirrors)"): the ExecutionSimulationSpec
// binds venue models by VALUE (config mirrors + digest), and every
// simulated fill carries its venue lineage — the engine record refs and
// the fee/latency/slippage/impact configs it was produced under (L5/L6:
// the simulator declares its fidelity and its physics, never implies
// them).
//
// {@link venueModelDigest} is the L9 anchor: it serializes a validated
// venue model with the SAME canonical tree exchange-sim's
// `canonicalConfigJson` uses and folds it with the same FNV-1a — so a
// mirrored venue model always digests identically to the REAL config it
// mirrors (the interop trip wire asserts the parity; a drifted mirror
// changes the digest and fails the test).
//
// THE VENUE STATE ({@link ExecutionVenueState}) is the GATE's view of
// the venue at decision time: per (venue, instrument) the instrument's
// asset class, the reference price the limits check computes notionals
// against, and the rate-window order count the rate-limits check
// consumes. It is an INPUT to the pure gate — the simulator threads it
// forward (approved submissions increment the counters), so
// determinism is a function of (intents, policy, venue state, seed).
//
// Spec anchors: spec/ARCHITECTURE.md (Market World: "exchange, order
// book, ... latency, fees, slippage and impact"), spec/ARCHITECTURE-
// LOCK.md L5, L6, L9.

import { deepFreeze, isMemberOf, isNonEmptyString, isNonNegativeSafeInteger, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, fnv1a32Hex, fnv1a32Int } from './primitives';
import { compare, isCanonicalPositiveDecimal, isUnsignedDecimal, isZero, normalize } from './decimals';
import type { InstrumentId, Seed, VenueId } from './ids';
import { isInstrumentId, isSeed, isVenueId } from './ids';
import {
  invalidField,
  invalidType,
  missingField,
  ok,
  type ExecutionPolicyError,
  type ExecutionPolicyResult,
} from './errors';
import { isPositiveDecimalString, type DecimalString } from './strategy-mirror';

// ---------------------------------------------------------------------------
// The fee model (mirror of exchange-sim's fees.ts)
// ---------------------------------------------------------------------------

/** Which side of a match a fill's fee is priced for. Mirror. */
export type FeeRole = 'maker' | 'taker';

/**
 * One fee tier. Mirror of exchange-sim's `FeeTier`: `up_to_notional` is
 * the inclusive upper bound of fill notional this tier prices (null =
 * the catch-all top tier); `maker_bps` / `taker_bps` are non-negative
 * decimal bps rates.
 */
export interface FeeTierMirror {
  /** Inclusive upper bound of fill notional, or null for the catch-all top tier. */
  readonly up_to_notional: string | null;
  readonly maker_bps: string;
  readonly taker_bps: string;
}

/**
 * The fee schedule. Mirror of exchange-sim's `FeeSchedule`: tiers
 * ordered by strictly increasing `up_to_notional`, the LAST tier the
 * null catch-all, fees rounded half-up to `fee_decimals`.
 */
export interface FeeScheduleMirror {
  readonly tiers: readonly FeeTierMirror[];
  /** The number of fractional digits fees are rounded to (half-up). Non-negative safe integer. */
  readonly fee_decimals: number;
}

/** Guard: a fee role. Mirror. */
export function isFeeRole(value: unknown): value is FeeRole {
  return value === 'maker' || value === 'taker';
}

/** Guard: a structurally valid fee tier. Mirror. */
export function isFeeTierMirror(value: unknown): value is FeeTierMirror {
  if (!isRecord(value)) return false;
  if (value.up_to_notional !== null && !(isNonEmptyString(value.up_to_notional) && isUnsignedDecimal(value.up_to_notional))) {
    return false;
  }
  if (!isNonEmptyString(value.maker_bps) || !isUnsignedDecimal(value.maker_bps)) return false;
  if (!isNonEmptyString(value.taker_bps) || !isUnsignedDecimal(value.taker_bps)) return false;
  return true;
}

/** Guard: a structurally valid fee schedule. Mirror. */
export function isFeeScheduleMirror(value: unknown): value is FeeScheduleMirror {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.tiers)) return false;
  if (!value.tiers.every((tier) => isFeeTierMirror(tier))) return false;
  if (typeof value.fee_decimals !== 'number' || !Number.isSafeInteger(value.fee_decimals) || value.fee_decimals < 0) {
    return false;
  }
  return true;
}

/**
 * Collect-all validation of an untrusted fee schedule. Mirror of
 * exchange-sim's `validateFeeSchedule` law for law: at least one tier,
 * non-negative unsigned decimal rates, strictly positive strictly
 * increasing bounds, exactly one trailing null catch-all.
 */
export function validateFeeScheduleMirror(value: unknown, path = 'fees'): ExecutionPolicyResult<FeeScheduleMirror> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExecutionPolicyError[] = [];

  let tiers: readonly FeeTierMirror[] | undefined;
  if (value.tiers === undefined) {
    errors.push(missingField(`${path}.tiers`));
  } else if (!Array.isArray(value.tiers)) {
    errors.push(invalidField(`${path}.tiers`, 'must be an array of tiers'));
  } else if (value.tiers.length === 0) {
    errors.push(invalidField(`${path}.tiers`, 'must contain at least one tier'));
  } else {
    const candidates = value.tiers as readonly unknown[];
    const validated: FeeTierMirror[] = [];
    let lastBound: string | null = null;
    let sawCatchAll = false;
    for (let index = 0; index < candidates.length; index++) {
      const tier = candidates[index];
      if (!isFeeTierMirror(tier)) {
        errors.push(
          invalidField(
            `${path}.tiers[${index}]`,
            'must be an object with up_to_notional (positive decimal or null) and non-negative decimal maker_bps/taker_bps',
          ),
        );
        continue;
      }
      if (sawCatchAll) {
        errors.push(invalidField(`${path}.tiers[${index}]`, 'no tier may follow the null catch-all tier'));
        continue;
      }
      if (tier.up_to_notional === null) {
        sawCatchAll = true;
        validated.push(deepFreeze({ up_to_notional: null, maker_bps: tier.maker_bps, taker_bps: tier.taker_bps }));
        continue;
      }
      if (isZero(tier.up_to_notional)) {
        errors.push(invalidField(`${path}.tiers[${index}].up_to_notional`, 'must be strictly positive'));
        continue;
      }
      if (lastBound !== null && compare(tier.up_to_notional, lastBound) <= 0) {
        errors.push(invalidField(`${path}.tiers[${index}].up_to_notional`, `must strictly exceed the previous bound (${lastBound})`));
        continue;
      }
      lastBound = tier.up_to_notional;
      validated.push(deepFreeze({ up_to_notional: tier.up_to_notional, maker_bps: tier.maker_bps, taker_bps: tier.taker_bps }));
    }
    if (!sawCatchAll && errors.length === 0) {
      errors.push(invalidField(`${path}.tiers`, 'must end with a null catch-all tier so every notional resolves to exactly one tier'));
    }
    if (errors.length === 0) tiers = validated;
  }

  if (value.fee_decimals === undefined) {
    errors.push(missingField(`${path}.fee_decimals`));
  } else if (typeof value.fee_decimals !== 'number' || !Number.isSafeInteger(value.fee_decimals) || value.fee_decimals < 0) {
    errors.push(invalidField(`${path}.fee_decimals`, 'must be a non-negative safe integer'));
  }

  if (errors.length > 0) return { ok: false, errors };
  return ok(deepFreeze({ tiers: tiers as readonly FeeTierMirror[], fee_decimals: value.fee_decimals as number }));
}

// ---------------------------------------------------------------------------
// The latency model (mirror of exchange-sim's latency.ts)
// ---------------------------------------------------------------------------

/**
 * The delay shape. Mirror of exchange-sim's `LatencyConfig`: one
 * constant delay, or a deterministic uniform draw in [min_ms, max_ms].
 */
export type LatencyConfigMirror =
  | { readonly kind: 'fixed'; readonly fixed_ms: number }
  | { readonly kind: 'uniform'; readonly min_ms: number; readonly max_ms: number };

/** Guard: a structurally valid latency config. Mirror. */
export function isLatencyConfigMirror(value: unknown): value is LatencyConfigMirror {
  if (!isRecord(value)) return false;
  if (value.kind === 'fixed') {
    return typeof value.fixed_ms === 'number' && Number.isSafeInteger(value.fixed_ms) && value.fixed_ms >= 0;
  }
  if (value.kind === 'uniform') {
    return (
      typeof value.min_ms === 'number' &&
      Number.isSafeInteger(value.min_ms) &&
      value.min_ms >= 0 &&
      typeof value.max_ms === 'number' &&
      Number.isSafeInteger(value.max_ms) &&
      value.max_ms >= value.min_ms
    );
  }
  return false;
}

/**
 * The deterministic delay (whole milliseconds) of one outcome. Mirror
 * of exchange-sim's `latencyDelayMs`: a PURE function of (config,
 * seed, domain, ordinal) — counter-keyed FNV-1a + splitmix32 draw, no
 * mutable RNG state, no Math.random, no Date.now. The same inputs
 * always produce the same delay (L9 determinism).
 */
export function latencyDelayMsMirror(config: LatencyConfigMirror, seed: string, domain: string, ordinal: number): number {
  if (config.kind === 'fixed') return config.fixed_ms;
  const span = config.max_ms - config.min_ms;
  if (span === 0) return config.min_ms;
  const key = fnv1a32Int(`${seed}:${domain}:${ordinal}`);
  // splitmix32 finalizer over the 32-bit key (the exchange-sim derivation, mirrored).
  let state = (key >>> 0) + 0x9e3779b9;
  let mixed = state >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
  mixed = (mixed ^ (mixed >>> 15)) >>> 0;
  const draw = mixed / 0x1_0000_0000; // [0, 1)
  return config.min_ms + Math.floor(draw * (span + 1));
}

// ---------------------------------------------------------------------------
// The slippage model (mirror of exchange-sim's slippage.ts)
// ---------------------------------------------------------------------------

/**
 * The slippage shape. Mirror of exchange-sim's `SlippageConfig`:
 * `book_walk` (slippage emerges from walking the visible book) or
 * `fixed_bps` (an explicit aggressor-side penalty).
 */
export type SlippageConfigMirror = { readonly kind: 'book_walk' } | { readonly kind: 'fixed_bps'; readonly bps: string };

/** Guard: a structurally valid slippage config. Mirror. */
export function isSlippageConfigMirror(value: unknown): value is SlippageConfigMirror {
  if (!isRecord(value)) return false;
  if (value.kind === 'book_walk') return true;
  if (value.kind === 'fixed_bps') {
    return typeof value.bps === 'string' && isUnsignedDecimal(value.bps) && !isZero(value.bps);
  }
  return false;
}

// ---------------------------------------------------------------------------
// The market-impact policy (mirror of exchange-sim's impact.ts)
// ---------------------------------------------------------------------------

/**
 * A market-impact policy declaration. Mirror of exchange-sim's
 * `MarketImpactPolicy`: data-only, `kind` an opaque string, with the
 * L6 `declaration` and `limitation` fields (non-empty — the explicit
 * fidelity statement).
 */
export interface MarketImpactPolicyMirror {
  /** The policy kind. `'none'` is the declared-absence policy the engine implements. */
  readonly kind: string;
  /** What this policy models (non-empty — the L6 declaration). */
  readonly declaration: string;
  /** What this policy does NOT model (non-empty — the L6 declared limitation/absence). */
  readonly limitation: string;
}

/** Guard: a structurally valid market-impact policy record. Mirror. */
export function isMarketImpactPolicyMirror(value: unknown): value is MarketImpactPolicyMirror {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.kind)) return false;
  if (!isNonEmptyString(value.declaration)) return false;
  if (!isNonEmptyString(value.limitation)) return false;
  return true;
}

/** The kinds the exchange-sim ENGINE itself implements (exactly one: the declared absence). Mirror. */
export const ENGINE_IMPACT_KINDS_MIRROR: readonly string[] = ['none'];

// ---------------------------------------------------------------------------
// The venue model config (field-for-field mirror of exchange-sim's ExchangeConfig)
// ---------------------------------------------------------------------------

/** The two L5 modes an exchange simulator serves. Mirror of exchange-sim's `ExchangeFidelity`. */
export type ExchangeFidelityMirror = 'reactive_replay' | 'generative';

export const EXCHANGE_FIDELITY_MODES_MIRROR: readonly ExchangeFidelityMirror[] = ['reactive_replay', 'generative'] as const;

/** Guard: an exchange fidelity mode. Mirror. */
export function isExchangeFidelityMirror(value: unknown): value is ExchangeFidelityMirror {
  return typeof value === 'string' && (EXCHANGE_FIDELITY_MODES_MIRROR as readonly string[]).includes(value);
}

/**
 * The fully-determining venue model configuration. Field-for-field
 * mirror of exchange-sim's `ExchangeConfig`: venue identity, instrument,
 * asset class, the price/quantity grids, the book-depth cap, the seed,
 * the venue-side L5 fidelity mode, and the four physics models (fees,
 * latency, slippage, impact).
 */
export interface VenueModelConfigMirror {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  /** The market-protocol asset class of the instrument (envelope taxonomy). */
  readonly asset_class: string;
  /** The price grid (strictly positive canonical decimal, e.g. "0.01"). */
  readonly tick_size: string;
  /** The quantity grid (strictly positive canonical decimal, e.g. "0.001"). */
  readonly lot_size: string;
  /** Maximum book levels retained per side. */
  readonly max_book_depth: number;
  /** The opaque deterministic seed — every latency draw derives from it. */
  readonly seed: Seed;
  /** The venue-side L5 mode this model serves. */
  readonly fidelity: ExchangeFidelityMirror;
  readonly fees: FeeScheduleMirror;
  readonly latency: LatencyConfigMirror;
  readonly slippage: SlippageConfigMirror;
  readonly impact: MarketImpactPolicyMirror;
}

/**
 * Collect-all validation of an untrusted venue model config — mirrors
 * exchange-sim's `validateExchangeConfig` law for law (grid positivity,
 * depth cap, model validators, the impact fail-close rule: only 'none'
 * is implementable by the engine this lane mirrors; T027 owns the
 * rest). On success the value is returned narrowed, deeply frozen, with
 * tick/lot normalized to canonical decimals.
 */
export function validateVenueModelConfig(value: unknown, path = 'venueModel'): ExecutionPolicyResult<VenueModelConfigMirror> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExecutionPolicyError[] = [];

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
  } else if (!isNonEmptyString(value.asset_class)) {
    errors.push(invalidField(`${path}.asset_class`, 'must be a non-empty string (a canonical market-protocol asset class)'));
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
      code: 'fidelity_claim_dishonest',
      path: `${path}.fidelity`,
      message: "exact_replay records orders as intents and never matches them (T009) — an exchange simulator serves reactive_replay or generative",
    });
  } else if (!isExchangeFidelityMirror(value.fidelity)) {
    errors.push(invalidField(`${path}.fidelity`, `must be one of ${EXCHANGE_FIDELITY_MODES_MIRROR.join(' | ')}`));
  }

  let fees: FeeScheduleMirror | undefined;
  if (value.fees === undefined) {
    errors.push(missingField(`${path}.fees`));
  } else {
    const feesResult = validateFeeScheduleMirror(value.fees, `${path}.fees`);
    if (feesResult.ok) fees = feesResult.value;
    else errors.push(...feesResult.errors);
  }

  let latency: LatencyConfigMirror | undefined;
  if (value.latency === undefined) {
    errors.push(missingField(`${path}.latency`));
  } else if (!isLatencyConfigMirror(value.latency)) {
    errors.push(invalidField(`${path}.latency`, "must be { kind: 'fixed', fixed_ms } or { kind: 'uniform', min_ms <= max_ms } (non-negative safe integers)"));
  } else {
    latency = deepFreeze(
      value.latency.kind === 'fixed'
        ? { kind: 'fixed', fixed_ms: value.latency.fixed_ms }
        : { kind: 'uniform', min_ms: value.latency.min_ms, max_ms: value.latency.max_ms },
    );
  }

  let slippage: SlippageConfigMirror | undefined;
  if (value.slippage === undefined) {
    errors.push(missingField(`${path}.slippage`));
  } else if (!isSlippageConfigMirror(value.slippage)) {
    errors.push(invalidField(`${path}.slippage`, "must be { kind: 'book_walk' } or { kind: 'fixed_bps', bps } with a strictly positive unsigned bps"));
  } else {
    slippage = deepFreeze(value.slippage.kind === 'book_walk' ? { kind: 'book_walk' } : { kind: 'fixed_bps', bps: value.slippage.bps });
  }

  let impact: MarketImpactPolicyMirror | undefined;
  if (value.impact === undefined) {
    errors.push(missingField(`${path}.impact`));
  } else if (!isMarketImpactPolicyMirror(value.impact)) {
    errors.push(invalidField(`${path}.impact`, 'must be a market-impact policy record (kind, declaration, limitation)'));
  } else if (!(ENGINE_IMPACT_KINDS_MIRROR as readonly string[]).includes(value.impact.kind)) {
    errors.push({
      code: 'fidelity_claim_dishonest',
      path: `${path}.impact.kind`,
      message: `impact kind "${value.impact.kind}" is not implemented by the engine this lane mirrors (only 'none') — endogenous impact belongs to the reactive-world lane (T027); fail-closed rather than guessing semantics`,
    });
  } else {
    impact = deepFreeze({ kind: value.impact.kind, declaration: value.impact.declaration, limitation: value.impact.limitation });
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
      fidelity: value.fidelity as ExchangeFidelityMirror,
      fees: fees as FeeScheduleMirror,
      latency: latency as LatencyConfigMirror,
      slippage: slippage as SlippageConfigMirror,
      impact: impact as MarketImpactPolicyMirror,
    }),
  );
}

/**
 * Runtime guard for a structurally valid venue model config (the cheap
 * structural check; `validateVenueModelConfig` is the authority —
 * mirroring exchange-sim's `isExchangeConfig` discipline).
 */
export function isVenueModelConfigMirror(value: unknown): value is VenueModelConfigMirror {
  if (!isRecord(value)) return false;
  if (!isVenueId(value.venue) || !isInstrumentId(value.instrument)) return false;
  if (!isNonEmptyString(value.asset_class)) return false;
  if (!isCanonicalPositiveDecimal(value.tick_size) || !isCanonicalPositiveDecimal(value.lot_size)) return false;
  if (!isPositiveSafeInteger(value.max_book_depth)) return false;
  if (!isSeed(value.seed) || !isExchangeFidelityMirror(value.fidelity)) return false;
  if (!isRecord(value.fees) || !isRecord(value.latency) || !isRecord(value.slippage) || !isRecord(value.impact)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The venue model digest (the L9 anchor — parity with exchange-sim's configHash)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of a validated venue model — the SAME tree
 * exchange-sim's `canonicalConfigJson` builds over its config (venue,
 * instrument, asset_class, grids, depth, seed, fidelity, fees, latency,
 * slippage, impact), so equal models produce byte-identical bytes
 * regardless of field order at construction (L9). The tree is built
 * field-by-field (no casts) so the compiler proves JSON-safety.
 */
export function venueModelJson(model: VenueModelConfigMirror): string {
  const tree: JsonValue = {
    venue: model.venue,
    instrument: model.instrument,
    asset_class: model.asset_class,
    tick_size: model.tick_size,
    lot_size: model.lot_size,
    max_book_depth: model.max_book_depth,
    seed: model.seed,
    fidelity: model.fidelity,
    fees: {
      tiers: model.fees.tiers.map((tier) => ({
        up_to_notional: tier.up_to_notional,
        maker_bps: tier.maker_bps,
        taker_bps: tier.taker_bps,
      })),
      fee_decimals: model.fees.fee_decimals,
    },
    latency: model.latency.kind === 'fixed'
      ? { kind: 'fixed', fixed_ms: model.latency.fixed_ms }
      : { kind: 'uniform', min_ms: model.latency.min_ms, max_ms: model.latency.max_ms },
    slippage: model.slippage.kind === 'book_walk' ? { kind: 'book_walk' } : { kind: 'fixed_bps', bps: model.slippage.bps },
    impact: {
      kind: model.impact.kind,
      declaration: model.impact.declaration,
      limitation: model.impact.limitation,
    },
  };
  return canonicalJson(tree);
}

/**
 * The deterministic digest of a validated venue model: FNV-1a 32-bit of
 * the canonical model JSON, as zero-padded lowercase hex. DIGEST PARITY
 * with exchange-sim's `configHash` over the mirrored config (proven by
 * the interop trip wire): bound into venue-model refs and every
 * simulated fill's venue lineage (L9).
 */
export function venueModelDigest(model: VenueModelConfigMirror): string {
  return fnv1a32Hex(venueModelJson(model));
}

// ---------------------------------------------------------------------------
// The book snapshot seed (mirror of exchange-sim's book.ts seed shapes)
// ---------------------------------------------------------------------------

/**
 * One price level of a book seed. Mirror of exchange-sim's `BookLevel`
 * (itself the market-protocol `book_snapshot` payload mirror): `{ price,
 * size }` as unsigned decimal strings.
 */
export interface BookLevelMirror {
  readonly price: string;
  readonly size: string;
}

/** Guard: a book level (positive price and size — mirror). */
export function isBookLevelMirror(value: unknown): value is BookLevelMirror {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.price) &&
    isUnsignedDecimal(value.price) &&
    !isZero(value.price) &&
    isNonEmptyString(value.size) &&
    isUnsignedDecimal(value.size) &&
    !isZero(value.size)
  );
}

/**
 * A book seed: the initial visible book. Mirror of exchange-sim's
 * `BookSnapshotSeed` (bids/asks/depth/last_update_id).
 */
export interface BookSnapshotSeedMirror {
  /** Full visible bid side (any order — the simulator sorts descending). May be empty. */
  readonly bids: readonly BookLevelMirror[];
  /** Full visible ask side (any order — the simulator sorts ascending). May be empty. */
  readonly asks: readonly BookLevelMirror[];
  /** Number of levels the venue exposes, when known. Informational. */
  readonly depth?: number;
  /** Venue book-state identifier, when provided. Informational (echoed into lineage). */
  readonly last_update_id?: string;
}

/** Guard: a structurally valid (mirror-shape) book snapshot seed. */
export function isBookSnapshotSeedMirror(value: unknown): value is BookSnapshotSeedMirror {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.bids) || !value.bids.every((level) => isBookLevelMirror(level))) return false;
  if (!Array.isArray(value.asks) || !value.asks.every((level) => isBookLevelMirror(level))) return false;
  if (value.depth !== undefined && !isNonNegativeSafeInteger(value.depth)) return false;
  if (value.last_update_id !== undefined && !isNonEmptyString(value.last_update_id)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The gate's venue state (the rate/limits facts — an INPUT to the pure gate)
// ---------------------------------------------------------------------------

/**
 * The gate's view of one (venue, instrument) pair at decision time: the
 * instrument's asset class (the limits check's record selector), the
 * reference price notionals are computed against (canonical positive
 * decimal), and the orders already submitted to the venue within the
 * CURRENT rate window (the rate-limits check's counter).
 */
export interface VenueInstrumentState {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  /** The instrument's asset class (mirrors the venue model's `asset_class`). */
  readonly instrumentClass: string;
  /** Reference price for notional computation (canonical positive decimal). */
  readonly referencePrice: string;
  /** Orders already submitted to this venue within the current rate window (>= 0). */
  readonly rateWindowOrderCount: number;
}

/** Guard: `VenueInstrumentState`. */
export function isVenueInstrumentState(v: unknown): v is VenueInstrumentState {
  if (!isRecord(v)) return false;
  if (!isVenueId(v.venue)) return false;
  if (!isInstrumentId(v.instrument)) return false;
  if (!isNonEmptyString(v.instrumentClass)) return false;
  if (typeof v.referencePrice !== 'string' || !isPositiveDecimalString(v.referencePrice as DecimalString)) return false;
  if (!isNonNegativeSafeInteger(v.rateWindowOrderCount)) return false;
  return true;
}

/**
 * The gate's venue state: the per-(venue, instrument) facts at decision
 * time plus the state's as-of instant. Every (venue, instrument) pair
 * an intent names MUST be covered — a gap is the typed
 * `venue_state_gap` envelope error (never a best-effort guess at a
 * reference price; the limits check refuses to reason over absent
 * facts). Threaded forward by the simulator: approved submissions
 * increment the venue's rate-window counter.
 */
export interface ExecutionVenueState {
  /** The state's as-of instant (epoch ms). */
  readonly asOf: TimestampMs;
  readonly instruments: readonly VenueInstrumentState[];
}

/** Guard: `ExecutionVenueState` (structural; unique (venue, instrument) pairs). */
export function isExecutionVenueState(v: unknown): v is ExecutionVenueState {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!Array.isArray(v.instruments) || !v.instruments.every((x) => isVenueInstrumentState(x))) return false;
  const seen = new Set<string>();
  for (const state of v.instruments as readonly VenueInstrumentState[]) {
    const key = `${state.venue}|${state.instrument}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** The runtime-checkable exchange asset-class mirror (the market-protocol taxonomy). */
export const ASSET_CLASSES_MIRROR: readonly string[] = ['crypto', 'equity', 'index', 'futures', 'options', 'macro', 'news', 'social', 'alternative'] as const;

/** Guard: an asset class of the mirrored market taxonomy. */
export function isAssetClassMirror(value: unknown): value is string {
  return isMemberOf(ASSET_CLASSES_MIRROR, value);
}
