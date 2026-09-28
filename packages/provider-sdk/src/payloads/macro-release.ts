/**
 * @tradrl/provider-sdk — macro release payload.
 *
 * STRUCTURAL MIRROR of @tradrl/market-protocol's macro-release payload (law
 * D-004: never imports). A scheduled macroeconomic indicator release. Values
 * are free-form strings: real feeds are heterogeneous and forcing a numeric
 * form would make the contract lie.
 */

import { invalidField, isNonEmptyString, missingField } from '../fields';
import type { SdkFieldError } from '../errors';

export interface MacroReleasePayload {
  /** Indicator identifier (opaque, e.g. "US_CPI_YOY"). */
  readonly indicator: string;
  /** Region/geography (e.g. "US", "EU"). */
  readonly region: string;
  /** Reference period (e.g. "2024-05", "2024Q2"). */
  readonly period: string;
  /** Released value, free-form. */
  readonly actual: string;
  /** Consensus forecast, when known. */
  readonly forecast?: string;
  /** Prior (possibly revised) value, when known. */
  readonly prior?: string;
  /** Unit label (e.g. "%", "K persons"). */
  readonly unit?: string;
}

export function validateMacroReleasePayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'macro_release payload must be an object')];
  }
  const payload = value as Record<string, unknown>;

  for (const field of ['indicator', 'region', 'period', 'actual'] as const) {
    const fieldValue = payload[field];
    if (fieldValue === undefined) errors.push(missingField(field));
    else if (!isNonEmptyString(fieldValue))
      errors.push(invalidField(field, 'must be a non-empty string'));
  }
  for (const field of ['forecast', 'prior', 'unit'] as const) {
    const fieldValue = payload[field];
    if (fieldValue !== undefined && !isNonEmptyString(fieldValue))
      errors.push(invalidField(field, 'must be a non-empty string when present'));
  }
  return errors;
}

export function isMacroReleasePayload(value: unknown): value is MacroReleasePayload {
  return validateMacroReleasePayload(value).length === 0;
}
