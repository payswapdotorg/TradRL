/**
 * @tradrl/market-protocol — social signal payload.
 *
 * An aggregated signal from social/alternative platforms (mention counts,
 * sentiment scores, ...). `value` is a signed decimal string — sentiment
 * scales are frequently negative.
 */

import { isSignedDecimal } from '../decimals';
import { invalidField, missingField, isNonEmptyString } from '../fields';
import type { MarketProtocolError } from '../errors';

const URL_RE = /^https?:\/\//;

export interface SocialSignalPayload {
  /** Platform identifier (e.g. "x", "reddit", "stocktwits"). */
  readonly platform: string;
  /** Metric name (e.g. "mention_count", "sentiment_score"). */
  readonly metric: string;
  /** Metric value, signed decimal string. */
  readonly value: string;
  /** Author/account, when the signal is account-scoped. */
  readonly author?: string;
  /** Canonical content URL, when available. */
  readonly url?: string;
}

export function validateSocialSignalPayload(value: unknown): MarketProtocolError[] {
  const errors: MarketProtocolError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'social_signal payload must be an object')];
  }
  const payload = value as Record<string, unknown>;

  for (const field of ['platform', 'metric'] as const) {
    const fieldValue = payload[field];
    if (fieldValue === undefined) errors.push(missingField(field));
    else if (!isNonEmptyString(fieldValue))
      errors.push(invalidField(field, 'must be a non-empty string'));
  }

  if (payload.value === undefined) errors.push(missingField('value'));
  else if (!isSignedDecimal(payload.value))
    errors.push(invalidField('value', 'must be a signed decimal string (e.g. "-0.21", "1520")'));

  if (payload.author !== undefined && !isNonEmptyString(payload.author))
    errors.push(invalidField('author', 'must be a non-empty string when present'));
  if (payload.url !== undefined && (typeof payload.url !== 'string' || !URL_RE.test(payload.url)))
    errors.push(invalidField('url', 'must be an http(s) URL string when present'));

  return errors;
}

export function isSocialSignalPayload(value: unknown): value is SocialSignalPayload {
  return validateSocialSignalPayload(value).length === 0;
}
