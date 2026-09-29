/**
 * @tradrl/adapter-binance — canonical payload contracts (trade, quote, book)
 * and the payload registry over the emittable set.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/payloads/{registry,trade,
 * quote,book}.ts (themselves mirrors of @tradrl/market-protocol; law D-004:
 * never imports; the interop test asserts validator VERDICT PARITY against
 * the real market-protocol and the real provider-sdk for every fixture
 * battery entry). The registry's type is a mapped type over the emittable
 * taxonomy, so exhaustiveness is a COMPILE ERROR, not a runtime surprise.
 *
 * The {@link payloadFieldSpec} inventory covers the FULL canonical
 * taxonomy (as string data — required/optional field names per event
 * type), exactly like the SDK's, because mapping-table validation targets
 * canonical fields by name; the VALIDATORS exist only for the emittable
 * set, and {@link validatePayloadFor} is TOTAL: a non-emittable canonical
 * type is a typed error, never a silent pass.
 */

import { isPositiveDecimal, isUnsignedDecimal } from './decimals';
import { invalidField, isNonEmptyString, isNonNegativeSafeInteger, missingField } from './fields';
import type { SdkFieldError } from './errors';
import type { EmittableEventType, EmittablePayloadMap, EventType, PayloadOf } from './taxonomy';
import { isEmittableEventType } from './taxonomy';

// ---------------------------------------------------------------------------
// Trade payload (mirror of the canonical trade contract).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Quote payload (mirror of the canonical quote contract).
// ---------------------------------------------------------------------------

export interface QuotePayload {
  readonly bid_price: string;
  readonly bid_size: string;
  readonly ask_price: string;
  readonly ask_size: string;
}

const POSITIVE_QUOTE_FIELDS = ['bid_price', 'bid_size', 'ask_price', 'ask_size'] as const;

export function validateQuotePayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'quote payload must be an object')];
  }
  const payload = value as Record<string, unknown>;
  for (const field of POSITIVE_QUOTE_FIELDS) {
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

// ---------------------------------------------------------------------------
// Book payloads (mirror of the canonical book contracts).
// ---------------------------------------------------------------------------

/** One price level. `size` semantics: absolute quantity at the price. */
export interface BookLevel {
  readonly price: string;
  readonly size: string;
}

export type BookDeltaAction = 'add' | 'update' | 'remove' | 'clear';

export interface BookSnapshotPayload {
  /** Full visible bid side. May be empty (no bids). */
  readonly bids: readonly BookLevel[];
  /** Full visible ask side. May be empty (no asks). */
  readonly asks: readonly BookLevel[];
  /** Number of levels the venue exposes, when known. */
  readonly depth?: number;
  /** Venue book-state identifier for continuity checks, when provided. */
  readonly last_update_id?: string;
}

export interface BookDeltaPayload {
  /** The kind of change. `clear` empties the book and must carry no levels. */
  readonly action: BookDeltaAction;
  /** Levels the action applies to. `add`/`update` require size > 0; `remove` allows size 0 (delete-by-price). */
  readonly levels: readonly BookLevel[];
  /** Venue book-state identifier for continuity checks, when provided. */
  readonly last_update_id?: string;
}

function validateLevel(
  level: unknown,
  path: string,
  requirePositiveSize: boolean,
  errors: SdkFieldError[],
): void {
  if (typeof level !== 'object' || level === null || Array.isArray(level)) {
    errors.push(invalidField(path, 'must be an object with price and size'));
    return;
  }
  const candidate = level as Record<string, unknown>;
  if (candidate.price === undefined) errors.push(missingField(`${path}.price`));
  else if (!isPositiveDecimal(candidate.price))
    errors.push(invalidField(`${path}.price`, 'must be a decimal string greater than zero'));
  if (candidate.size === undefined) errors.push(missingField(`${path}.size`));
  else if (requirePositiveSize && !isPositiveDecimal(candidate.size))
    errors.push(invalidField(`${path}.size`, 'must be a decimal string greater than zero for this action'));
  else if (!requirePositiveSize && !isUnsignedDecimal(candidate.size))
    errors.push(invalidField(`${path}.size`, 'must be a decimal string'));
}

function validateLevels(
  value: unknown,
  path: string,
  requirePositiveSize: boolean,
  errors: SdkFieldError[],
): void {
  if (!Array.isArray(value)) {
    errors.push(invalidField(path, 'must be an array of levels'));
    return;
  }
  value.forEach((level, index) => validateLevel(level, `${path}[${index}]`, requirePositiveSize, errors));
}

export function validateBookSnapshotPayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'book_snapshot payload must be an object')];
  }
  const payload = value as Record<string, unknown>;
  if (payload.bids === undefined) errors.push(missingField('bids'));
  else validateLevels(payload.bids, 'bids', true, errors);
  if (payload.asks === undefined) errors.push(missingField('asks'));
  else validateLevels(payload.asks, 'asks', true, errors);
  if (payload.depth !== undefined && !isNonNegativeSafeInteger(payload.depth))
    errors.push(invalidField('depth', 'must be a non-negative integer when present'));
  if (payload.last_update_id !== undefined && !isNonEmptyString(payload.last_update_id))
    errors.push(invalidField('last_update_id', 'must be a non-empty string when present'));
  return errors;
}

export function isBookSnapshotPayload(value: unknown): value is BookSnapshotPayload {
  return validateBookSnapshotPayload(value).length === 0;
}

export function validateBookDeltaPayload(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [invalidField('', 'book_delta payload must be an object')];
  }
  const payload = value as Record<string, unknown>;
  const ACTIONS: readonly BookDeltaAction[] = ['add', 'update', 'remove', 'clear'];
  if (payload.action === undefined) errors.push(missingField('action'));
  else if (typeof payload.action !== 'string' || !(ACTIONS as readonly string[]).includes(payload.action))
    errors.push(invalidField('action', 'must be one of add | update | remove | clear'));

  const action = payload.action;
  if (payload.levels === undefined) errors.push(missingField('levels'));
  else if (!Array.isArray(payload.levels)) errors.push(invalidField('levels', 'must be an array of levels'));
  else if (action === 'clear') {
    if (payload.levels.length > 0)
      errors.push(invalidField('levels', 'must be empty for action "clear" — clear empties the whole book'));
  } else {
    if (payload.levels.length === 0)
      errors.push(invalidField('levels', 'must not be empty for add | update | remove'));
    validateLevels(payload.levels, 'levels', action === 'add' || action === 'update', errors);
  }

  if (payload.last_update_id !== undefined && !isNonEmptyString(payload.last_update_id))
    errors.push(invalidField('last_update_id', 'must be a non-empty string when present'));
  return errors;
}

export function isBookDeltaPayload(value: unknown): value is BookDeltaPayload {
  return validateBookDeltaPayload(value).length === 0;
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
  trade: { validate: validateTradePayload, is: isTradePayload },
  quote: { validate: validateQuotePayload, is: isQuotePayload },
  book_snapshot: { validate: validateBookSnapshotPayload, is: isBookSnapshotPayload },
  book_delta: { validate: validateBookDeltaPayload, is: isBookDeltaPayload },
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
