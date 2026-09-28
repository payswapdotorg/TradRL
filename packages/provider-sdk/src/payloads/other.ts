/**
 * @tradrl/provider-sdk — the `other` escape-hatch payload.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's other payload (law D-004:
 * never imports). Event types outside the canonical taxonomy still enter the
 * pipeline, but they MUST identify themselves: `kind` is a REQUIRED
 * free-form string naming the sub-type, and `data` is a closed JSON object.
 * The escape hatch is typed and self-describing — never a bare `unknown`.
 */

import { isJsonObject } from '../json';
import { invalidField, isNonEmptyString, missingField } from '../fields';
import type { SdkFieldError } from '../errors';

export interface OtherPayload {
  /** REQUIRED free-form kind naming the sub-type (e.g. "liquidation", "funding_rate"). */
  readonly kind: string;
  /** Free-form JSON object payload. May be empty. */
  readonly data: { readonly [key: string]: unknown } & object;
}

export function validateOtherPayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'other payload must be an object')];
  }
  const payload = value as Record<string, unknown>;
  if (payload.kind === undefined) errors.push(missingField('kind'));
  else if (!isNonEmptyString(payload.kind))
    errors.push(invalidField('kind', 'must be a non-empty string — the escape hatch must name its kind'));
  if (payload.data === undefined) errors.push(missingField('data'));
  else if (!isJsonObject(payload.data))
    errors.push(invalidField('data', 'must be a JSON object (finite numbers, no undefined)'));
  return errors;
}

export function isOtherPayload(value: unknown): value is OtherPayload {
  return validateOtherPayload(value).length === 0;
}
