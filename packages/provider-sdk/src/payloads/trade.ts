/**
 * @tradrl/provider-sdk — trade payload.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's trade payload (law D-004:
 * never imports; verdict parity is trip-wired in the interop test). A single
 * executed trade print; prices and sizes are decimal strings.
 */

import { isPositiveDecimal } from '../decimals';
import { invalidField, isNonEmptyString, missingField } from '../fields';
import type { SdkFieldError } from '../errors';

export type TradeSide = 'buy' | 'sell';

export interface TradePayload {
  /** Execution price per unit, unsigned decimal string (e.g. "43125.10"). */
  readonly price: string;
  /** Executed quantity, unsigned decimal string (e.g. "0.017"). */
  readonly size: string;
  /** Aggressor side of the trade. */
  readonly side: TradeSide;
  /** Venue trade identifier, when the venue provides one. */
  readonly trade_id?: string;
}

export function validateTradePayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'trade payload must be an object')];
  }
  const payload = value as Record<string, unknown>;
  if (payload.price === undefined) errors.push(missingField('price'));
  else if (!isPositiveDecimal(payload.price)) errors.push(invalidField('price', 'must be a positive decimal string'));

  if (payload.size === undefined) errors.push(missingField('size'));
  else if (!isPositiveDecimal(payload.size)) errors.push(invalidField('size', 'must be a positive decimal string'));

  if (payload.side === undefined) errors.push(missingField('side'));
  else if (payload.side !== 'buy' && payload.side !== 'sell')
    errors.push(invalidField('side', 'must be "buy" or "sell"'));

  if (payload.trade_id !== undefined && !isNonEmptyString(payload.trade_id))
    errors.push(invalidField('trade_id', 'must be a non-empty string when present'));

  return errors;
}

export function isTradePayload(value: unknown): value is TradePayload {
  return validateTradePayload(value).length === 0;
}
