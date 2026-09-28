/**
 * @tradrl/provider-sdk — news payload.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's news payload (law D-004:
 * never imports). A news item, possibly tied to instruments via `symbols`
 * (which may be empty). Content is untrusted input by the security model
 * (spec/SECURITY.md) — the payload is data, never instructions.
 */

import { invalidField, isNonEmptyString, missingField } from '../fields';
import type { SdkFieldError } from '../errors';

const URL_RE = /^https?:\/\//;

export interface NewsPayload {
  /** Headline. Required, non-empty. */
  readonly headline: string;
  /** Body text, when carried. */
  readonly body?: string;
  /** Editorial source label (opaque, e.g. "newswire-a"). */
  readonly source?: string;
  /** Related instrument ids. May be empty. */
  readonly symbols: readonly string[];
  /** Canonical article URL, when available. */
  readonly url?: string;
  /** Free-form topical tags. */
  readonly tags?: readonly string[];
}

function validateStringArray(value: unknown, path: string, errors: SdkFieldError[]): void {
  if (!Array.isArray(value)) {
    errors.push(invalidField(path, 'must be an array of strings'));
    return;
  }
  value.forEach((element, index) => {
    if (!isNonEmptyString(element)) errors.push(invalidField(`${path}[${index}]`, 'must be a non-empty string'));
  });
}

export function validateNewsPayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'news payload must be an object')];
  }
  const payload = value as Record<string, unknown>;

  if (payload.headline === undefined) errors.push(missingField('headline'));
  else if (!isNonEmptyString(payload.headline)) errors.push(invalidField('headline', 'must be a non-empty string'));

  if (payload.body !== undefined && typeof payload.body !== 'string')
    errors.push(invalidField('body', 'must be a string when present'));
  if (payload.source !== undefined && !isNonEmptyString(payload.source))
    errors.push(invalidField('source', 'must be a non-empty string when present'));

  if (payload.symbols === undefined) errors.push(missingField('symbols'));
  else validateStringArray(payload.symbols, 'symbols', errors);

  if (payload.url !== undefined && (typeof payload.url !== 'string' || !URL_RE.test(payload.url)))
    errors.push(invalidField('url', 'must be an http(s) URL string when present'));

  if (payload.tags !== undefined) validateStringArray(payload.tags, 'tags', errors);

  return errors;
}

export function isNewsPayload(value: unknown): value is NewsPayload {
  return validateNewsPayload(value).length === 0;
}
