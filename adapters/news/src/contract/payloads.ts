/**
 * @tradrl/adapter-news — the canonical news payload contract and the
 * payload registry over the emittable set.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/payloads/{registry,
 * news}.ts (themselves mirrors of @tradrl/market-protocol; law D-004:
 * never imports; the interop test asserts validator VERDICT PARITY
 * against the real market-protocol and the real provider-sdk for every
 * fixture battery entry). The registry's type is a mapped type over the
 * emittable taxonomy, so exhaustiveness is a COMPILE ERROR, not a runtime
 * surprise.
 *
 * The {@link payloadFieldSpec} inventory covers the FULL canonical
 * taxonomy (as string data — required/optional field names per event
 * type), exactly like the SDK's, because mapping-table validation targets
 * canonical fields by name; the VALIDATORS exist only for the emittable
 * set, and {@link validatePayloadFor} is TOTAL: a non-emittable canonical
 * type is a typed error, never a silent pass.
 *
 * News content is untrusted input by the security model (spec/SECURITY.md)
 * — the payload is data, never instructions.
 */

import { invalidField, isNonEmptyString, missingField } from './fields';
import type { SdkFieldError } from './errors';
import type { EmittableEventType, EmittablePayloadMap, EventType, PayloadOf } from './taxonomy';
import { isEmittableEventType } from './taxonomy';

// ---------------------------------------------------------------------------
// News payload (mirror of the canonical news contract).
// ---------------------------------------------------------------------------

const URL_RE = /^https?:\/\//;

export interface NewsPayload {
  /** Headline. Required, non-empty. */
  readonly headline: string;
  /** Body text, when carried. */
  readonly body?: string;
  /** Editorial source label (opaque, e.g. "publisher-a"). */
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
  news: { validate: validateNewsPayload, is: isNewsPayload },
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
