/**
 * @tradrl/provider-sdk — OHLCV / bar payload.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's ohlcv payload (law D-004:
 * never imports). One candlestick/bar over a fixed interval. Cross-field
 * consistency IS enforced (high >= max(open, close), low <= min(open, close),
 * high >= low) using exact decimal comparison — an inconsistent bar is a
 * protocol violation, not a market fact.
 */

import { compareDecimal, isPositiveDecimal, isUnsignedDecimal } from '../decimals';
import { invalidField, isNonNegativeSafeInteger, missingField } from '../fields';
import type { SdkFieldError } from '../errors';

/** Bar interval pattern: one integer count + unit (s|m|h|d|w|M). */
const INTERVAL_RE = /^\d+[smhdwM]$/;

export interface OhlcvPayload {
  /** Bar interval, e.g. "1m", "5s", "1h", "1d" (M = month). */
  readonly interval: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  /** Traded volume over the interval — zero-volume bars are legitimate. */
  readonly volume: string;
  /** Whether the bar is finalized (interval closed). */
  readonly closed?: boolean;
  /** Number of trades in the interval, when the venue provides it. */
  readonly trade_count?: number;
}

export function validateOhlcvPayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'ohlcv payload must be an object')];
  }
  const payload = value as Record<string, unknown>;

  if (payload.interval === undefined) errors.push(missingField('interval'));
  else if (typeof payload.interval !== 'string' || !INTERVAL_RE.test(payload.interval))
    errors.push(invalidField('interval', 'must match /^\\d+[smhdwM]$/ (e.g. "1m", "5s", "1h", "1d")'));

  for (const field of ['open', 'high', 'low', 'close'] as const) {
    const fieldValue = payload[field];
    if (fieldValue === undefined) errors.push(missingField(field));
    else if (!isPositiveDecimal(fieldValue))
      errors.push(invalidField(field, 'must be a positive decimal string'));
  }

  if (payload.volume === undefined) errors.push(missingField('volume'));
  else if (!isUnsignedDecimal(payload.volume))
    errors.push(invalidField('volume', 'must be an unsigned decimal string (zero allowed)'));

  if (payload.closed !== undefined && typeof payload.closed !== 'boolean')
    errors.push(invalidField('closed', 'must be a boolean when present'));
  if (payload.trade_count !== undefined && !isNonNegativeSafeInteger(payload.trade_count))
    errors.push(invalidField('trade_count', 'must be a non-negative integer when present'));

  // Cross-field consistency — exact decimal arithmetic, never float-mediated.
  const { open, high, low, close } = payload;
  if (
    typeof open === 'string' && typeof high === 'string' && typeof low === 'string' && typeof close === 'string' &&
    isPositiveDecimal(open) && isPositiveDecimal(high) && isPositiveDecimal(low) && isPositiveDecimal(close)
  ) {
    if (compareDecimal(high, open) === -1 || compareDecimal(high, close) === -1)
      errors.push(invalidField('high', 'high must be >= max(open, close)'));
    if (compareDecimal(low, open) === 1 || compareDecimal(low, close) === 1)
      errors.push(invalidField('low', 'low must be <= min(open, close)'));
    if (compareDecimal(high, low) === -1) errors.push(invalidField('high', 'high must be >= low'));
  }

  return errors;
}

export function isOhlcvPayload(value: unknown): value is OhlcvPayload {
  return validateOhlcvPayload(value).length === 0;
}
