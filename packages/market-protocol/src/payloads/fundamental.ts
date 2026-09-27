/**
 * @tradrl/market-protocol — fundamental payload.
 *
 * A reported fundamental datum (EPS, revenue, shares outstanding…) for an
 * instrument and period. `value` is free-form: fundamentals arrive as
 * "1.23", "6.7B" or "N/A" and the contract refuses to over-promise.
 */

import { invalidField, missingField, isNonEmptyString } from '../fields';
import type { MarketProtocolError } from '../errors';

export interface FundamentalPayload {
  /** Field name (e.g. "EPS_DILUTED", "REVENUE"). */
  readonly field: string;
  /** Reporting period (e.g. "2024-Q2"). */
  readonly period: string;
  /** Reported value, free-form. */
  readonly value: string;
  /** Unit label (e.g. "USD", "USD/share"). */
  readonly unit?: string;
  /** Source statement label (e.g. "10-Q"). */
  readonly source?: string;
}

export function validateFundamentalPayload(value: unknown): MarketProtocolError[] {
  const errors: MarketProtocolError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'fundamental payload must be an object')];
  }
  const payload = value as Record<string, unknown>;

  for (const field of ['field', 'period', 'value'] as const) {
    const fieldValue = payload[field];
    if (fieldValue === undefined) errors.push(missingField(field));
    else if (!isNonEmptyString(fieldValue))
      errors.push(invalidField(field, 'must be a non-empty string'));
  }
  for (const field of ['unit', 'source'] as const) {
    const fieldValue = payload[field];
    if (fieldValue !== undefined && !isNonEmptyString(fieldValue))
      errors.push(invalidField(field, 'must be a non-empty string when present'));
  }
  return errors;
}

export function isFundamentalPayload(value: unknown): value is FundamentalPayload {
  return validateFundamentalPayload(value).length === 0;
}
