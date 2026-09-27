/**
 * @tradrl/market-protocol — option chain mark payload.
 *
 * A derivative/option mark. One event carries ONE option's mark (the
 * envelope `instrument` identifies the listing); a chain is a series of
 * these over the same underlying/expiry. Greeks and implied vol are optional
 * because not every feed quotes them — absence is information, not error.
 */

import { isPositiveDecimal, isSignedDecimal } from '../decimals';
import { invalidField, missingField, isNonEmptyString } from '../fields';
import { isTimestampMs } from '../timestamp';
import type { MarketProtocolError } from '../errors';

export type OptionRight = 'call' | 'put';

/** Option greeks, each a signed decimal string. All optional. */
export interface OptionGreeks {
  readonly delta?: string;
  readonly gamma?: string;
  readonly vega?: string;
  readonly theta?: string;
}

export interface OptionChainMarkPayload {
  /** Underlying instrument id (e.g. "SPX"). */
  readonly underlying: string;
  /** Expiration instant (epoch ms). */
  readonly expiry: number & { readonly __brand: 'TradRL.TimestampMs' };
  /** Strike price, positive decimal string. */
  readonly strike: string;
  /** Option right. */
  readonly right: OptionRight;
  /** Mark price, positive decimal string. */
  readonly mark_price: string;
  /** Implied volatility, positive decimal string, when quoted. */
  readonly implied_vol?: string;
  /** Quoted greeks, when available. */
  readonly greeks?: OptionGreeks;
}

export function validateOptionChainMarkPayload(value: unknown): MarketProtocolError[] {
  const errors: MarketProtocolError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'option_chain_mark payload must be an object')];
  }
  const payload = value as Record<string, unknown>;

  if (payload.underlying === undefined) errors.push(missingField('underlying'));
  else if (!isNonEmptyString(payload.underlying))
    errors.push(invalidField('underlying', 'must be a non-empty string'));

  if (payload.expiry === undefined) errors.push(missingField('expiry'));
  else if (!isTimestampMs(payload.expiry))
    errors.push(invalidField('expiry', 'must be a valid epoch-millisecond timestamp'));

  if (payload.strike === undefined) errors.push(missingField('strike'));
  else if (!isPositiveDecimal(payload.strike))
    errors.push(invalidField('strike', 'must be a positive decimal string'));

  if (payload.right === undefined) errors.push(missingField('right'));
  else if (payload.right !== 'call' && payload.right !== 'put')
    errors.push(invalidField('right', 'must be "call" or "put"'));

  if (payload.mark_price === undefined) errors.push(missingField('mark_price'));
  else if (!isPositiveDecimal(payload.mark_price))
    errors.push(invalidField('mark_price', 'must be a positive decimal string'));

  if (payload.implied_vol !== undefined && !isPositiveDecimal(payload.implied_vol))
    errors.push(invalidField('implied_vol', 'must be a positive decimal string when present'));

  if (payload.greeks !== undefined) {
    if (typeof payload.greeks !== 'object' || payload.greeks === null || Array.isArray(payload.greeks)) {
      errors.push(invalidField('greeks', 'must be an object when present'));
    } else {
      const greeks = payload.greeks as Record<string, unknown>;
      for (const field of ['delta', 'gamma', 'vega', 'theta'] as const) {
        const fieldValue = greeks[field];
        if (fieldValue !== undefined && !isSignedDecimal(fieldValue))
          errors.push(invalidField(`greeks.${field}`, 'must be a signed decimal string when present'));
      }
    }
  }

  return errors;
}

export function isOptionChainMarkPayload(value: unknown): value is OptionChainMarkPayload {
  return validateOptionChainMarkPayload(value).length === 0;
}
