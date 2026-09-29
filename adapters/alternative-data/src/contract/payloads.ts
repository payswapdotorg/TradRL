/**
 * @tradrl/adapter-alternative-data — canonical payload contracts
 * (social_signal, macro_release, fundamental) and the payload registry
 * over the emittable set.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/payloads/{registry,
 * social-signal,macro-release,fundamental}.ts (themselves mirrors of
 * @tradrl/market-protocol; law D-004: never imports; the interop test
 * asserts validator VERDICT PARITY against the real market-protocol and
 * the real provider-sdk for every fixture battery entry). The registry's
 * type is a mapped type over the emittable taxonomy, so exhaustiveness is
 * a COMPILE ERROR, not a runtime surprise.
 *
 * The {@link payloadFieldSpec} inventory covers the FULL canonical
 * taxonomy (as string data — required/optional field names per event
 * type), exactly like the SDK's, because mapping-table validation targets
 * canonical fields by name; the VALIDATORS exist only for the emittable
 * set, and {@link validatePayloadFor} is TOTAL: a non-emittable canonical
 * type is a typed error, never a silent pass.
 */

import { isSignedDecimal } from './decimals';
import { invalidField, isNonEmptyString, missingField } from './fields';
import type { SdkFieldError } from './errors';
import type { EmittableEventType, EmittablePayloadMap, EventType, PayloadOf } from './taxonomy';
import { isEmittableEventType } from './taxonomy';

// ---------------------------------------------------------------------------
// Social signal payload (mirror of the canonical social-signal contract).
// ---------------------------------------------------------------------------

const URL_RE = /^https?:\/\//;

export interface SocialSignalPayload {
  /** Platform identifier (opaque, e.g. "chain-a", "sentiment-vendor-a"). */
  readonly platform: string;
  /** Metric name (e.g. "sentiment_score", "active_addresses"). */
  readonly metric: string;
  /** Metric value, signed decimal string. */
  readonly value: string;
  /** Author/account, when the signal is account-scoped. */
  readonly author?: string;
  /** Canonical content URL, when available. */
  readonly url?: string;
}

export function validateSocialSignalPayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
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

// ---------------------------------------------------------------------------
// Macro release payload (mirror of the canonical macro-release contract).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fundamental payload (mirror of the canonical fundamental contract).
// ---------------------------------------------------------------------------

export interface FundamentalPayload {
  /** Field name (e.g. "OIL_STORAGE_ESTIMATE", "EPS_DILUTED", "REVENUE"). */
  readonly field: string;
  /** Reporting period (e.g. "2024-Q2", "2024-06-02"). */
  readonly period: string;
  /** Reported value, free-form. */
  readonly value: string;
  /** Unit label (e.g. "MMbbl", "USD", "USD/share"). */
  readonly unit?: string;
  /** Source statement label (e.g. "satellite-observation", "quarterly-report"). */
  readonly source?: string;
}

export function validateFundamentalPayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
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

// ---------------------------------------------------------------------------
// The registry over the emittable set.
// ---------------------------------------------------------------------------

/** What a registered payload validator provides. */
export interface PayloadValidator<P> {
  /** Collect every violation (paths relative to the payload root). */
  validate(value: unknown): readonly SdkFieldError[];
  /** Throwing-free narrowing guard. */
  is(value: unknown): value is P;
}

/** The registry: every emittable event type maps to its typed payload validator. */
export const payloadRegistry: {
  readonly [E in EmittableEventType]: PayloadValidator<PayloadOf<E>>;
} = {
  social_signal: { validate: validateSocialSignalPayload, is: isSocialSignalPayload },
  macro_release: { validate: validateMacroReleasePayload, is: isMacroReleasePayload },
  fundamental: { validate: validateFundamentalPayload, is: isFundamentalPayload },
};

// ---------------------------------------------------------------------------
// The canonical field inventory (mapping-table target vocabulary).
// ---------------------------------------------------------------------------

/** The field inventory of one canonical payload. */
export interface PayloadFieldSpec {
  /** Fields every valid payload of this type carries. */
  readonly required: readonly string[];
  /** Fields a payload may additionally carry. */
  readonly optional: readonly string[];
}

/**
 * Required/optional field inventory per canonical event type — the mapping
 * table's canonical target vocabulary. Mirror of the SDK's full inventory
 * (string data for every canonical type, emittable or not), so mapping-table
 * validation can judge canonical field names for any declared table; the
 * emittable entries are additionally pinned to the validators above by the
 * registry parity tests.
 */
export const payloadFieldSpec: { readonly [E in EventType]: PayloadFieldSpec } = {
  trade: { required: ['price', 'size', 'side'], optional: ['trade_id'] },
  quote: { required: ['bid_price', 'bid_size', 'ask_price', 'ask_size'], optional: [] },
  book_snapshot: { required: ['bids', 'asks'], optional: ['depth', 'last_update_id'] },
  book_delta: { required: ['action', 'levels'], optional: ['last_update_id'] },
  ohlcv: { required: ['interval', 'open', 'high', 'low', 'close', 'volume'], optional: ['closed', 'trade_count'] },
  news: { required: ['headline', 'symbols'], optional: ['body', 'source', 'url', 'tags'] },
  macro_release: { required: ['indicator', 'region', 'period', 'actual'], optional: ['forecast', 'prior', 'unit'] },
  social_signal: { required: ['platform', 'metric', 'value'], optional: ['author', 'url'] },
  fundamental: { required: ['field', 'period', 'value'], optional: ['unit', 'source'] },
  option_chain_mark: {
    required: ['underlying', 'expiry', 'strike', 'right', 'mark_price'],
    optional: ['implied_vol', 'greeks'],
  },
  other: { required: ['kind', 'data'], optional: [] },
};

/** Canonical fields (required + optional) targetable by a mapping table. */
export function canonicalFieldsOf(eventType: EventType): readonly string[] {
  const spec = payloadFieldSpec[eventType];
  return [...spec.required, ...spec.optional];
}

/**
 * Validate a value as the typed payload of one canonical event type.
 * TOTAL over the full canonical taxonomy: an event type this adapter
 * cannot emit (no validator registered) is a typed error — never a silent
 * pass, never an undefined-registry crash.
 */
export function validatePayloadFor(eventType: EventType, value: unknown): readonly SdkFieldError[] {
  if (!isEmittableEventType(eventType)) {
    return [invalidField('', `${eventType} is not an emittable event type of this adapter — no payload validator is registered`)];
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', `${eventType} payload must be an object`)];
  }
  return payloadRegistry[eventType].validate(value);
}
