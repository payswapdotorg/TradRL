/**
 * @tradrl/market-protocol — quote payload.
 *
 * A top-of-book bid/ask quotation. The contract does NOT enforce
 * bid < ask: crossed or locked quotes are market-microstructure facts, not
 * protocol violations (adapters normalize; book builders handle them).
 */

import { isPositiveDecimal } from '../decimals';
import { invalidField, missingField } from '../fields';
import type { MarketProtocolError } from '../errors';

export interface QuotePayload {
  readonly bid_price: string;
  readonly bid_size: string;
  readonly ask_price: string;
  readonly ask_size: string;
}

const POSITIVE_FIELDS = ['bid_price', 'bid_size', 'ask_price', 'ask_size'] as const;

export function validateQuotePayload(value: unknown): MarketProtocolError[] {
  const errors: MarketProtocolError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'quote payload must be an object')];
  }
  const payload = value as Record<string, unknown>;
  for (const field of POSITIVE_FIELDS) {
    const fieldValue = payload[field];
    if (fieldValue === undefined) errors.push(missingField(field));
    else if (!isPositiveDecimal(fieldValue))
      errors.push(invalidField(field, 'must be a positive decimal string'));
  }
  return errors;
}

export function isQuotePayload(value: unknown): value is QuotePayload {
  return validateQuotePayload(value).length === 0;
}
