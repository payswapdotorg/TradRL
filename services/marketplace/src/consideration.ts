// @tradrl/marketplace-service — the CONSIDERATION: the typed
// commercial terms of the marketplace (T047's CORE OWNERSHIP).
//
// THE LAWS THIS MODULE SERVES:
// - THE OPAQUE SLOT LAW: T045's exchange carries the commercial terms
//   as OPAQUE JSON — `consideration` on the capability request (what
//   the platform OFFERS) and on the provider terms (what the provider
//   COUNTERS) — deliberately uninterpreted by that lane ("T047 owns
//   the semantics", W-6a's limitation note). THIS module is that
//   semantics: the closed typed contract the slot must satisfy, the
//   collect-all validator that narrows the opaque JSON into it, and
//   the comparison laws the negotiation runs under.
// - THE MONEY LAW: every amount and rate is a canonical decimal STRING
//   over the program-wide grammar (never a float, never coerced — a
//   number is the typed `invalid_decimal`); every currency is an
//   identifier from ONE commercial vocabulary per program; arithmetic
//   is exact BigInt fixed-point (`rate x units` — `decimalMultiply`).
// - THE PRICING-MODEL LAW (closed vocabulary):
//     - `fixed-fee` — one price for the engagement (a free listing
//       prices at `"0"` — the marketplace does not force payment);
//     - `usage-metered` — a per-unit rate (the `unit` names what is
//       metered, e.g. `per-annotation`); the charge is `rate x units`,
//       exact, settled against the declared usage.
//   THE PAYMENT GATE lives in purchase.ts: only a VERIFIED engagement
//   charges (rejected and withdrawn never do — "never pay for rejected
//   work"); this module computes WHAT, the settlement decides WHETHER.
// - THE NEGOTIATION LAWS (typed, pure):
//     - `considerationWithin(offer, counter)` — the BUDGET LAW: the
//       provider's counter never exceeds the platform's offered budget
//       (`consideration_exceeds_budget`), answers in the SAME
//       commercial language (`consideration_incomparable` — a fixed
//       offer is not answered with a metered counter), in the SAME
//       currency (`currency_mismatch`), and a no-charge offer (`null`)
//       is only answered in kind;
//     - `considerationCharge(consideration, usageUnits)` — the exact
//       price of an engagement (fixed-fee ignores usage; metered
//       requires it — `usage_missing`).
// - L16a: the label trip-wire applies to the terms' JSON tree (a
//   pricing block citing a profession label is a typed violation).
// - Determinism: validation is pure and collect-all; the minted terms
//   are deeply frozen clones (never aliasing the caller's draft).

import { deepCloneJson, deepFreeze, isCanonicalUnsignedDecimal, isRecord, isZeroDecimal, signedCompare } from './imports';
import type { JsonValue } from './imports';
import type { MarketplaceError, MarketplaceResult } from './errors';
import { fail, failures, invalidField, invalidType, missingField, ok } from './errors';
import { decimalMultiply } from './imports';
import { labelKeyPaths } from './mirrors';

// ---------------------------------------------------------------------------
// The closed pricing-model vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed pricing-model vocabulary — the two ways a marketplace
 * offering prices an engagement. A third model would be a commercial
 * architecture change, not a data point.
 */
export const PRICING_MODELS = ['fixed-fee', 'usage-metered'] as const;

/** One pricing model. */
export type PricingModel = (typeof PRICING_MODELS)[number];

/** Guard: `PricingModel`. */
export function isPricingModel(v: unknown): v is PricingModel {
  return v === 'fixed-fee' || v === 'usage-metered';
}

// ---------------------------------------------------------------------------
// The typed terms (the opaque slot's contract)
// ---------------------------------------------------------------------------

/** The currency grammar: an identifier (one commercial vocabulary per program). */
export const CURRENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** The usage-unit grammar: an identifier naming WHAT is metered (e.g. `per-annotation`). */
export const USAGE_UNIT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * A fixed fee: one exact price for the engagement. A free listing
 * prices at amount `"0"` (the marketplace does not force payment —
 * open capability offerings list at zero).
 */
export interface FixedFeeConsideration {
  readonly kind: 'fixed-fee';
  /** The commercial currency (identifier — e.g. `usd-cents`). */
  readonly currency: string;
  /** The exact price (canonical unsigned decimal; `"0"` for a free listing). */
  readonly amount: string;
}

/**
 * Usage-metered pricing: an exact per-unit rate. The charge of an
 * engagement is `rate x usageUnits` (exact decimal multiplication) —
 * the usage is declared at settlement and pinned by the settlement
 * record.
 */
export interface UsageMeteredConsideration {
  readonly kind: 'usage-metered';
  /** The commercial currency (identifier). */
  readonly currency: string;
  /** The exact per-unit rate (canonical unsigned decimal). */
  readonly rate: string;
  /** What is metered (identifier — e.g. `per-annotation`). */
  readonly unit: string;
}

/**
 * THE TYPED CONSIDERATION — the contract for the opaque JSON slot T045
 * carries. The platform's OFFER (request.consideration) is its budget
 * ceiling; the provider's COUNTER (quote.terms.consideration) is its
 * asking price. `null` is the explicit no-charge offer (T045: "use
 * null for none") — only answerable in kind.
 */
export type Consideration = FixedFeeConsideration | UsageMeteredConsideration | null;

// ---------------------------------------------------------------------------
// The guards
// ---------------------------------------------------------------------------

/** Guard: `FixedFeeConsideration`. */
export function isFixedFeeConsideration(v: unknown): v is FixedFeeConsideration {
  if (!isRecord(v)) return false;
  if (v.kind !== 'fixed-fee') return false;
  if (typeof v.currency !== 'string' || !CURRENCY_PATTERN.test(v.currency)) return false;
  if (!isCanonicalUnsignedDecimal(v.amount)) return false;
  return true;
}

/** Guard: `UsageMeteredConsideration`. */
export function isUsageMeteredConsideration(v: unknown): v is UsageMeteredConsideration {
  if (!isRecord(v)) return false;
  if (v.kind !== 'usage-metered') return false;
  if (typeof v.currency !== 'string' || !CURRENCY_PATTERN.test(v.currency)) return false;
  if (!isCanonicalUnsignedDecimal(v.rate)) return false;
  if (typeof v.unit !== 'string' || !USAGE_UNIT_PATTERN.test(v.unit)) return false;
  return true;
}

/** Guard: `Consideration` (the closed union incl. the no-charge `null`). */
export function isConsideration(v: unknown): v is Consideration {
  return v === null || isFixedFeeConsideration(v) || isUsageMeteredConsideration(v);
}

// ---------------------------------------------------------------------------
// The collect-all validator (the opaque slot's narrowing)
// ---------------------------------------------------------------------------

/**
 * Collect-all validation of an untrusted consideration against the
 * FULL law, returning the deeply frozen typed terms. THE MONEY LAW:
 * amounts and rates are canonical decimal STRINGS — a number, a comma
 * decimal, a leading zero or a negative price is the typed
 * `invalid_decimal`, never coerced. THE LABEL LAW (L16a): a label key
 * anywhere in the terms' JSON tree is the typed `label_as_evidence`.
 */
export function validateConsideration(v: unknown, path = 'consideration'): MarketplaceResult<Consideration> {
  if (v === null) return ok(null); // the explicit no-charge offer
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType(path, `${path} must be a consideration object ({kind: fixed-fee | usage-metered, ...}) or null (no charge)`)] };
  }
  const errors: MarketplaceError[] = [];

  // L16a: the label trip-wire over the whole terms tree.
  for (const labelPath of labelKeyPaths(v)) {
    errors.push({
      code: 'label_as_evidence',
      path: `${path}.${labelPath}`,
      message: `field "${labelPath}" cites a profession/role label — pricing terms describe commercial terms, never what anyone claims to BE (L16a/L19)`,
    });
  }

  if (v.kind === undefined) {
    errors.push(missingField(`${path}.kind`));
  } else if (v.kind === 'fixed-fee') {
    if (v.currency === undefined) errors.push(missingField(`${path}.currency`));
    else if (typeof v.currency !== 'string' || !CURRENCY_PATTERN.test(v.currency)) {
      errors.push(invalidField(`${path}.currency`, 'invalid currency (identifier pattern — one commercial vocabulary per program, e.g. "usd-cents")'));
    }
    if (v.amount === undefined) errors.push({ code: 'invalid_decimal', path: `${path}.amount`, message: `"${path}.amount" is required` });
    else if (!isCanonicalUnsignedDecimal(v.amount)) {
      errors.push({ code: 'invalid_decimal', path: `${path}.amount`, message: `the amount must be a canonical unsigned decimal string (got ${JSON.stringify(v.amount)}) — money is exact, never a float` });
    }
  } else if (v.kind === 'usage-metered') {
    if (v.currency === undefined) errors.push(missingField(`${path}.currency`));
    else if (typeof v.currency !== 'string' || !CURRENCY_PATTERN.test(v.currency)) {
      errors.push(invalidField(`${path}.currency`, 'invalid currency (identifier pattern — one commercial vocabulary per program)'));
    }
    if (v.rate === undefined) errors.push({ code: 'invalid_decimal', path: `${path}.rate`, message: `"${path}.rate" is required` });
    else if (!isCanonicalUnsignedDecimal(v.rate)) {
      errors.push({ code: 'invalid_decimal', path: `${path}.rate`, message: `the rate must be a canonical unsigned decimal string (got ${JSON.stringify(v.rate)}) — money is exact, never a float` });
    }
    if (v.unit === undefined) errors.push(missingField(`${path}.unit`));
    else if (typeof v.unit !== 'string' || !USAGE_UNIT_PATTERN.test(v.unit)) {
      errors.push(invalidField(`${path}.unit`, 'invalid usage unit (identifier pattern naming what is metered, e.g. "per-annotation")'));
    }
  } else {
    errors.push(invalidField(`${path}.kind`, `must be one of ${PRICING_MODELS.join(' | ')} (the closed pricing-model vocabulary)`));
  }

  if (errors.length > 0) return failures(errors);
  const typed = v as unknown as FixedFeeConsideration | UsageMeteredConsideration;
  // Clone-then-freeze: the minted terms never alias the caller's draft.
  const frozen: Consideration = deepFreeze(deepCloneJson(typed as unknown as JsonValue)) as unknown as Consideration;
  if (!isConsideration(frozen)) {
    return fail('consideration_invalid', 'the minted consideration failed its own structural guard', path);
  }
  return ok(frozen);
}

// ---------------------------------------------------------------------------
// The charge computation (WHAT — the settlement decides WHETHER)
// ---------------------------------------------------------------------------

/**
 * The exact charge of an engagement under the given consideration:
 * fixed-fee -> the amount (the usage, if any, is ignored — the price
 * is the price); usage-metered -> `rate x usageUnits` (EXACT decimal
 * multiplication; the usage must be a canonical unsigned decimal —
 * `usage_missing` when absent, `invalid_decimal` when malformed);
 * null -> `"0"` (no charge — the settlement's no-charge path).
 */
export function considerationCharge(
  consideration: Consideration,
  usageUnits: string | null | undefined,
  path = 'consideration',
): MarketplaceResult<string> {
  if (consideration === null) return ok('0');
  if (consideration.kind === 'fixed-fee') return ok(consideration.amount);
  // usage-metered: the usage is the settlement's declared input.
  if (usageUnits === null || usageUnits === undefined) {
    return fail('usage_missing', `the consideration is usage-metered (${consideration.currency} ${consideration.rate}/${consideration.unit}) but no usage was declared — a metered settlement settles nothing without its usage`, path);
  }
  if (!isCanonicalUnsignedDecimal(usageUnits)) {
    return { ok: false, errors: [{ code: 'invalid_decimal', path: 'usageUnits', message: `the usage must be a canonical unsigned decimal string (got ${JSON.stringify(usageUnits)})` }] };
  }
  return ok(decimalMultiply(consideration.rate, usageUnits));
}

// ---------------------------------------------------------------------------
// The negotiation laws (the budget law + the comparability laws)
// ---------------------------------------------------------------------------

/**
 * THE BUDGET LAW: may the provider's COUNTER be accepted against the
 * platform's OFFERED consideration? Typed refusals:
 * - `consideration_incomparable` — the counter answers in a DIFFERENT
 *   commercial language than the offer (fixed vs metered vs none): the
 *   negotiation stays in one pricing model;
 * - `currency_mismatch` — the counter's currency is not the offer's;
 * - `consideration_exceeds_budget` — the counter exceeds the offered
 *   budget (a fixed counter's amount above the offered amount; a
 *   metered counter's rate above the offered rate; ANY price against a
 *   no-charge offer).
 * A counter AT or BELOW the offer is accepted (the provider may
 * discount).
 */
export function considerationWithin(
  offer: Consideration,
  counter: Consideration,
  path = 'counter',
): MarketplaceResult<void> {
  // The no-charge law: a null offer is only answerable in kind.
  if (offer === null) {
    if (counter === null) return ok(undefined);
    return fail('consideration_exceeds_budget', 'the platform offered NO CHARGE (null consideration) but the counter asks a price — nothing is payable against a no-charge offer', path);
  }
  if (counter === null) {
    return ok(undefined); // a free counter against a priced offer is a discount to zero — accepted
  }
  if (offer.kind !== counter.kind) {
    return fail('consideration_incomparable', `the offer is ${offer.kind} but the counter is ${counter.kind} — the negotiation stays in ONE pricing model (re-issue the request or re-quote)`, path);
  }
  if (offer.currency !== counter.currency) {
    return fail('currency_mismatch', `the offer's currency is "${offer.currency}" but the counter's is "${counter.currency}" — one commercial vocabulary per negotiation`, path);
  }
  if (offer.kind === 'fixed-fee' && counter.kind === 'fixed-fee') {
    if (signedCompare(counter.amount, offer.amount) > 0) {
      return fail('consideration_exceeds_budget', `the counter's price ${counter.amount} ${counter.currency} exceeds the offered budget ${offer.amount} ${offer.currency}`, path);
    }
    return ok(undefined);
  }
  if (offer.kind === 'usage-metered' && counter.kind === 'usage-metered') {
    if (signedCompare(counter.rate, offer.rate) > 0) {
      return fail('consideration_exceeds_budget', `the counter's rate ${counter.rate} ${counter.currency}/${counter.unit} exceeds the offered budget rate ${offer.rate} ${offer.currency}/${offer.unit}`, path);
    }
    if (counter.unit !== offer.unit) {
      return fail('consideration_incomparable', `the offer meters "${offer.unit}" but the counter meters "${counter.unit}" — the metered unit is part of the commercial language`, path);
    }
    return ok(undefined);
  }
  return fail('consideration_incomparable', 'unreachable pricing-model combination', path);
}

// ---------------------------------------------------------------------------
// The listing-price law (the counter never exceeds the LISTING either)
// ---------------------------------------------------------------------------

/**
 * THE LISTING-PRICE LAW: the provider's counter never exceeds its own
 * published listing pricing (the listing is what the marketplace
 * advertised; a counter above it is the typed `listing_mismatch`).
 * Same comparability and currency laws as the budget law; a free
 * listing (price `"0"`) accepts only free counters.
 */
export function withinListingPricing(
  listingPricing: FixedFeeConsideration | UsageMeteredConsideration,
  counter: Consideration,
  path = 'counter',
): MarketplaceResult<void> {
  if (counter === null) return ok(undefined); // a free counter is always within the listing
  if (listingPricing.kind !== counter.kind) {
    return fail('listing_mismatch', `the listing prices ${listingPricing.kind} but the counter is ${counter.kind} — the quote must answer the listing's pricing model`, path);
  }
  if (listingPricing.currency !== counter.currency) {
    return fail('currency_mismatch', `the listing's currency is "${listingPricing.currency}" but the counter's is "${counter.currency}"`, path);
  }
  if (listingPricing.kind === 'fixed-fee' && counter.kind === 'fixed-fee') {
    if (signedCompare(counter.amount, listingPricing.amount) > 0) {
      return fail('listing_mismatch', `the counter's price ${counter.amount} ${counter.currency} exceeds the listing's published price ${listingPricing.amount} ${listingPricing.currency} — the listing is what the marketplace advertised`, path);
    }
    return ok(undefined);
  }
  if (listingPricing.kind === 'usage-metered' && counter.kind === 'usage-metered') {
    if (signedCompare(counter.rate, listingPricing.rate) > 0) {
      return fail('listing_mismatch', `the counter's rate ${counter.rate} ${counter.currency}/${counter.unit} exceeds the listing's published rate ${listingPricing.rate} ${listingPricing.currency}/${listingPricing.unit}`, path);
    }
    return ok(undefined);
  }
  return fail('listing_mismatch', 'unreachable pricing-model combination', path);
}

// ---------------------------------------------------------------------------
// Descriptive helpers (deterministic, human-legible)
// ---------------------------------------------------------------------------

/** The deterministic one-line description of a consideration (listings, settlements, evidence). */
export function describeConsideration(consideration: Consideration): string {
  if (consideration === null) return 'no charge';
  if (consideration.kind === 'fixed-fee') {
    return isZeroDecimal(consideration.amount) ? `free (${consideration.currency} 0)` : `fixed fee ${consideration.amount} ${consideration.currency}`;
  }
  return `metered ${consideration.rate} ${consideration.currency}/${consideration.unit}`;
}
