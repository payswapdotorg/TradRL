/**
 * @tradrl/exchange-sim — the fee model (maker/taker, configurable tiers).
 *
 * L6 FIDELITY DECLARATION — the record below is a first-class export
 * (`FEE_FIDELITY`); a dedicated test asserts it exists and names every
 * modeled and unmodeled behavior, so nothing here is a silent
 * approximation:
 *
 * MODELED exactly:
 *   - maker/taker role split (the resting side is maker, the arriving
 *     side is taker);
 *   - per-tier bps rates over the fill notional (price x quantity, exact
 *     decimal product);
 *   - HALF-UP rounding to a configurable number of fee decimals (the ONLY
 *     numeric approximation in the money paths — explicit, deterministic).
 *
 * DECLARED LIMITATIONS (approximations, by design of this Work Order):
 *   - tier selection is by PER-FILL notional; real venues tier by a
 *     participant's rolling cumulative volume — the authority-free
 *     simulator has no participant accounts to accumulate against
 *     (L8: account/permission state belongs outside);
 *   - fees are quoted in the instrument's quote currency as a bare decimal
 *     amount (no currency conversion, no rebate/negative-fee tiers —
 *     rates are non-negative);
 *   - no minimum fee, no per-order flat fees, no funding payments.
 */

import { deepFreeze, isNonEmptyString, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type ExchangeError, type ExchangeResult } from './errors';
import { compare, divideRoundHalfUp, isUnsignedDecimal, isZero, multiply } from './decimals';

// ---------------------------------------------------------------------------
// The fidelity declaration (L6 — asserted to exist by tests)
// ---------------------------------------------------------------------------

/** The explicit L6 fidelity declaration of the fee model. */
export const FEE_FIDELITY = deepFreeze({
  modeled: [
    'maker/taker role split (resting side is maker, arriving side is taker)',
    'per-tier bps rates over the exact fill notional (price x quantity, exact decimal arithmetic)',
    'half-up rounding of each fee to a configurable decimal precision',
  ],
  declared_limitations: [
    'tier selection is per-fill notional, not rolling cumulative participant volume (no accounts in an authority-free simulator — L8)',
    'rates are non-negative bps in the quote currency: no rebates, no negative maker fees, no currency conversion',
    'no minimum fee, no flat per-order fee, no funding payments',
  ],
} as const);

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

/** Which side of a match a fill's fee is priced for. */
export type FeeRole = 'maker' | 'taker';

/**
 * One fee tier. `up_to_notional` is the inclusive upper bound of fill
 * notional this tier prices (null = the catch-all top tier); `maker_bps` /
 * `taker_bps` are non-negative decimal bps rates ("10" = 10 bps = 0.10%).
 */
export interface FeeTier {
  /** Inclusive upper bound of fill notional, or null for the catch-all top tier. */
  readonly up_to_notional: string | null;
  readonly maker_bps: string;
  readonly taker_bps: string;
}

/**
 * The fee schedule. Tiers must be ordered by strictly increasing
 * `up_to_notional` and the LAST tier must be the null catch-all, so every
 * possible notional resolves to exactly one tier (totality, fail-closed
 * validation).
 */
export interface FeeSchedule {
  readonly tiers: readonly FeeTier[];
  /** The number of fractional digits fees are rounded to (half-up). Non-negative safe integer. */
  readonly fee_decimals: number;
}

/** The computed fee product of one fill side. */
export interface FeeQuote {
  /** The fill notional the tier was selected by (price x quantity, exact). */
  readonly notional: string;
  /** The bps rate applied for the priced role. */
  readonly bps: string;
  /** The role priced. */
  readonly role: FeeRole;
  /** The fee amount, rounded half-up to the schedule's `fee_decimals`. */
  readonly fee: string;
}

// ---------------------------------------------------------------------------
// Guards and validation
// ---------------------------------------------------------------------------

/** Runtime guard for a fee role. */
export function isFeeRole(value: unknown): value is FeeRole {
  return value === 'maker' || value === 'taker';
}

/** Runtime guard for a structurally valid fee tier. */
export function isFeeTier(value: unknown): value is FeeTier {
  if (!isRecord(value)) return false;
  if (value.up_to_notional !== null && !(isNonEmptyString(value.up_to_notional) && isUnsignedDecimal(value.up_to_notional))) {
    return false;
  }
  if (!isNonEmptyString(value.maker_bps) || !isUnsignedDecimal(value.maker_bps)) return false;
  if (!isNonEmptyString(value.taker_bps) || !isUnsignedDecimal(value.taker_bps)) return false;
  return true;
}

/** Runtime guard for a structurally valid fee schedule. */
export function isFeeSchedule(value: unknown): value is FeeSchedule {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.tiers)) return false;
  if (!value.tiers.every((tier) => isFeeTier(tier))) return false;
  if (typeof value.fee_decimals !== 'number' || !Number.isSafeInteger(value.fee_decimals) || value.fee_decimals < 0) {
    return false;
  }
  return true;
}

/**
 * Collect-all validation of an untrusted fee schedule. Enforces: at least
 * one tier; non-negative unsigned decimal rates and strictly positive,
 * strictly increasing bounds; exactly one trailing null catch-all (so tier
 * selection is total). On success the value is returned narrowed, deeply
 * frozen.
 */
export function validateFeeSchedule(value: unknown, path = 'fees'): ExchangeResult<FeeSchedule> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExchangeError[] = [];

  let tiers: readonly FeeTier[] | undefined;
  if (value.tiers === undefined) {
    errors.push(missingField(`${path}.tiers`));
  } else if (!Array.isArray(value.tiers)) {
    errors.push(invalidField(`${path}.tiers`, 'must be an array of tiers'));
  } else if (value.tiers.length === 0) {
    errors.push(invalidField(`${path}.tiers`, 'must contain at least one tier'));
  } else {
    const candidates = value.tiers as readonly unknown[];
    const validated: FeeTier[] = [];
    let lastBound: string | null = null;
    let sawCatchAll = false;
    for (let index = 0; index < candidates.length; index++) {
      const tier = candidates[index];
      if (!isFeeTier(tier)) {
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
        errors.push(
          invalidField(
            `${path}.tiers[${index}].up_to_notional`,
            `must strictly exceed the previous bound (${lastBound})`,
          ),
        );
        continue;
      }
      lastBound = tier.up_to_notional;
      validated.push(deepFreeze({ up_to_notional: tier.up_to_notional, maker_bps: tier.maker_bps, taker_bps: tier.taker_bps }));
    }
    if (!sawCatchAll && errors.length === 0) {
      errors.push(
        invalidField(`${path}.tiers`, 'must end with a null catch-all tier so every notional resolves to exactly one tier'),
      );
    }
    if (errors.length === 0) tiers = validated;
  }

  if (value.fee_decimals === undefined) {
    errors.push(missingField(`${path}.fee_decimals`));
  } else if (typeof value.fee_decimals !== 'number' || !Number.isSafeInteger(value.fee_decimals) || value.fee_decimals < 0) {
    errors.push(invalidField(`${path}.fee_decimals`, 'must be a non-negative safe integer'));
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      tiers: tiers as readonly FeeTier[],
      fee_decimals: value.fee_decimals as number,
    }),
  );
}

// ---------------------------------------------------------------------------
// Fee computation (pure, exact but for the declared rounding)
// ---------------------------------------------------------------------------

/**
 * Select the tier a fill notional resolves to. Total by validation (the
 * trailing null catch-all); deterministic (the first bound covering the
 * notional wins, bounds are strictly increasing).
 */
export function selectFeeTier(schedule: FeeSchedule, notional: string): FeeTier {
  for (const tier of schedule.tiers) {
    if (tier.up_to_notional === null) return tier;
    if (compare(notional, tier.up_to_notional) <= 0) return tier;
  }
  // Unreachable by validation (the catch-all is enforced last); kept total.
  throw new Error('selectFeeTier: schedule has no catch-all tier (impossible by validation)');
}

/**
 * Compute the fee of one fill side. `price` and `quantity` are the fill's
 * execution price and size (unsigned decimal strings); the notional is the
 * exact product, the tier is selected by that notional, and the fee is
 * `notional * bps / 10_000` rounded HALF-UP to `fee_decimals` — the one
 * declared approximation. Pure and deterministic.
 */
export function feeOf(schedule: FeeSchedule, role: FeeRole, price: string, quantity: string): FeeQuote {
  const notional = multiply(price, quantity);
  const tier = selectFeeTier(schedule, notional);
  const bps = role === 'maker' ? tier.maker_bps : tier.taker_bps;
  const unrounded = multiply(notional, bps);
  const fee = divideRoundHalfUp(unrounded, '10000', schedule.fee_decimals);
  return deepFreeze({ notional, bps, role, fee });
}

/** Convenience: the schedule's two-sided fee product of one fill (taker + maker). */
export function feesOfFill(
  schedule: FeeSchedule,
  price: string,
  quantity: string,
): { readonly taker: FeeQuote; readonly maker: FeeQuote } {
  return deepFreeze({ taker: feeOf(schedule, 'taker', price, quantity), maker: feeOf(schedule, 'maker', price, quantity) });
}
