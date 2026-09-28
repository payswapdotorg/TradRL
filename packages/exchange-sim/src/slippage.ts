/**
 * @tradrl/exchange-sim — the slippage model (explicitly declared shapes).
 *
 * L6 FIDELITY DECLARATION — `SLIPPAGE_FIDELITY` is a first-class export; a
 * dedicated test asserts it exists. Exactly two shapes are modeled, and
 * both ride on the matching engine's exact book walking:
 *
 *   - `book_walk` (the default and the honest pure-book model): slippage
 *     EMERGES from walking the visible book — a market or crossing order
 *     consumes resting levels at their prices, so the average fill price
 *     degrades with consumed depth. NO additional penalty is applied.
 *   - `fixed_bps`: an explicit approximation knob — on top of the walked
 *     price, the AGGRESSOR's execution price is degraded by a fixed bps
 *     rate and re-quantized onto the tick grid ADVERSARIALLY to the
 *     aggressor (buy: ceil to tick — pay at least the slipped price; sell:
 *     floor to tick — receive at most it), with a one-tick floor so
 *     prices stay strictly positive. The quantization is EXACT integer
 *     rational arithmetic (price x (10_000 ± bps) / 10_000, then exact
 *     grid floor/ceil) — no float mediation, no intermediate rounding.
 *
 * DECLARED LIMITATIONS:
 *   - no hidden liquidity, no icebergs, no depth beyond the visible book;
 *   - no queue-position dynamics (resting priority is price-time only);
 *   - no latency-arbitrage dynamics between the book view and fills;
 *   - `fixed_bps` models nothing structural: it is a declared calibration
 *     approximation for microstructure noise the visible book does not
 *     carry.
 *
 * The model applies to the AGGRESSOR's price only; the resting maker is
 * always filled at the book price (the trade print), which is also the
 * engine's `last_trade_price`.
 */

import { deepFreeze, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type ExchangeError, type ExchangeResult } from './errors';
import { isUnsignedDecimal, isZero, normalize } from './decimals';

// ---------------------------------------------------------------------------
// The fidelity declaration (L6 — asserted to exist by tests)
// ---------------------------------------------------------------------------

/** The explicit L6 fidelity declaration of the slippage model. */
export const SLIPPAGE_FIDELITY = deepFreeze({
  modeled: [
    'book_walk: slippage emerges from walking the visible book (fills consume levels at their prices; no synthetic penalty)',
    'fixed_bps: an explicit aggressor-side penalty of N bps on the walked price, re-quantized to the tick grid adversarially to the aggressor by exact integer rational arithmetic',
  ],
  declared_limitations: [
    'no hidden liquidity, no iceberg orders, no depth beyond the visible book',
    'no queue-position dynamics (resting priority is price-time only)',
    'no latency-arbitrage between the book view and fill observability',
    'fixed_bps is a declared calibration approximation, not a microstructure model',
  ],
} as const);

// ---------------------------------------------------------------------------
// The configuration
// ---------------------------------------------------------------------------

/** The slippage shape: emergent book walking, or a fixed-bps aggressor penalty. */
export type SlippageConfig = { readonly kind: 'book_walk' } | { readonly kind: 'fixed_bps'; readonly bps: string };

/** Runtime guard for a structurally valid slippage config. */
export function isSlippageConfig(value: unknown): value is SlippageConfig {
  if (!isRecord(value)) return false;
  if (value.kind === 'book_walk') return true;
  if (value.kind === 'fixed_bps') {
    return typeof value.bps === 'string' && isUnsignedDecimal(value.bps) && !isZero(value.bps);
  }
  return false;
}

/**
 * Collect-all validation of an untrusted slippage config. `fixed_bps`
 * requires a strictly positive unsigned decimal bps rate. On success the
 * value is returned narrowed, deeply frozen.
 */
export function validateSlippageConfig(value: unknown, path = 'slippage'): ExchangeResult<SlippageConfig> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExchangeError[] = [];

  if (value.kind === undefined) {
    errors.push(missingField(`${path}.kind`));
  } else if (value.kind !== 'book_walk' && value.kind !== 'fixed_bps') {
    errors.push(invalidField(`${path}.kind`, "must be 'book_walk' or 'fixed_bps'"));
  } else if (value.kind === 'fixed_bps') {
    if (value.bps === undefined) {
      errors.push(missingField(`${path}.bps`));
    } else if (typeof value.bps !== 'string' || !isUnsignedDecimal(value.bps)) {
      errors.push(invalidField(`${path}.bps`, 'must be an unsigned decimal string of basis points'));
    } else if (isZero(value.bps)) {
      errors.push(invalidField(`${path}.bps`, 'must be strictly positive — zero-bps fixed slippage is book_walk, name it honestly'));
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return ok(deepFreeze(value.kind === 'book_walk' ? { kind: 'book_walk' } : { kind: 'fixed_bps', bps: value.bps as string }));
}

// ---------------------------------------------------------------------------
// Exact rational helpers (BigInt fixed-point; local to this module)
// ---------------------------------------------------------------------------

/** An exact non-negative decimal parsed to integer digits at a scale. */
interface ExactDecimal {
  readonly digits: bigint;
  readonly scale: number;
}

function parseExact(value: string): ExactDecimal {
  const dot = value.indexOf('.');
  const intPart = dot === -1 ? value : value.slice(0, dot);
  const fracPart = dot === -1 ? '' : value.slice(dot + 1);
  return { digits: BigInt(`${intPart || '0'}${fracPart}`), scale: fracPart.length };
}

/** The canonical string form of an exact scaled value (no trailing zeros). */
function formatExact(digits: bigint, scale: number): string {
  const text = digits.toString();
  if (scale === 0) return text;
  const padded = text.padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale);
  let fracPart = padded.slice(padded.length - scale);
  while (fracPart.length > 0 && fracPart.endsWith('0')) fracPart = fracPart.slice(0, -1);
  return fracPart.length === 0 ? intPart : `${intPart}.${fracPart}`;
}

// ---------------------------------------------------------------------------
// Slippage application (pure, exact)
// ---------------------------------------------------------------------------

/**
 * The aggressor's execution price for a match at `bookPrice`.
 *   - `book_walk`: the book price itself, unchanged (slippage already
 *     emerged from walking; the maker and the aggressor trade AT the book
 *     price — the print and the aggressor price coincide).
 *   - `fixed_bps`: the book price degraded by the bps rate against the
 *     aggressor (buy pays more, sell receives less), then re-quantized
 *     onto the tick grid adversarially to the aggressor (buy: ceil; sell:
 *     floor) with a one-tick floor so it stays strictly positive.
 *
 * The `fixed_bps` path computes `bookPrice * (10_000 ± bps) / 10_000` and
 * the grid quantization with EXACT integer arithmetic — one BigInt
 * division and remainder, no intermediate rounding anywhere. Pure and
 * deterministic.
 */
export function aggressorPrice(
  config: SlippageConfig,
  aggressorSide: 'buy' | 'sell',
  bookPrice: string,
  tickSize: string,
): string {
  if (config.kind === 'book_walk') return normalize(bookPrice);

  const price = parseExact(bookPrice);
  const bps = parseExact(config.bps);
  // factor = (10_000 ± bps) / 10_000 — held as the exact rational
  // value = price.digits * factorNumerator / 10^(price.scale + bps.scale).
  const basis = 10_000n * 10n ** BigInt(bps.scale);
  const factorNumerator = aggressorSide === 'buy' ? basis + bps.digits : basis - bps.digits;
  if (factorNumerator <= 0n) {
    // A sell-side slip of >= 10_000 bps drives the price to zero or below:
    // the one-tick floor keeps prices strictly positive (declared).
    return normalize(tickSize);
  }
  const valueNumerator = price.digits * factorNumerator;
  const valueScale = price.scale + bps.scale;

  // Quantize value/grid onto the grid, adversarially to the aggressor:
  // q = ceil-or-floor(value / grid); result = q * grid, at the grid's scale.
  const grid = parseExact(tickSize);
  const gridDenominator = grid.digits * 10n ** BigInt(valueScale);
  const valueAtGridScale = valueNumerator * 10n ** BigInt(grid.scale);
  const quotient = valueAtGridScale / gridDenominator;
  const remainder = valueAtGridScale % gridDenominator;
  let units = quotient;
  if (aggressorSide === 'buy' && remainder !== 0n) units = quotient + 1n; // ceil: pay at least
  const quantized = units * grid.digits;
  const result = formatExact(quantized, grid.scale);
  if (isZero(result)) return normalize(tickSize); // one-tick floor
  return result;
}
