// @tradrl/marketplace-service — the CONSIDERATION tests: the typed
// commercial terms (T047's core ownership), the money law, the charge
// computation, and the negotiation laws.

import { describe, expect, it } from 'vitest';
import {
  CURRENCY_PATTERN,
  describeConsideration,
  considerationCharge,
  considerationWithin,
  isConsideration,
  isFixedFeeConsideration,
  isUsageMeteredConsideration,
  PRICING_MODELS,
  USAGE_UNIT_PATTERN,
  validateConsideration,
  withinListingPricing,
} from './index';

describe('the closed pricing-model vocabulary + the guards', () => {
  it('is pinned member-for-member', () => {
    expect([...PRICING_MODELS]).toEqual(['fixed-fee', 'usage-metered']);
  });

  it('fixed-fee terms: identifier currency + canonical decimal amount', () => {
    expect(isFixedFeeConsideration({ kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' })).toBe(true);
    expect(isFixedFeeConsideration({ kind: 'fixed-fee', currency: 'usd-cents', amount: 12500 })).toBe(false);
    expect(isFixedFeeConsideration({ kind: 'fixed-fee', currency: 'usd cents', amount: '1' })).toBe(false);
    expect(isFixedFeeConsideration({ kind: 'fixed-fee', currency: 'usd-cents', amount: '0' })).toBe(true); // free listing
  });

  it('usage-metered terms: identifier currency + canonical rate + identifier unit', () => {
    expect(isUsageMeteredConsideration({ kind: 'usage-metered', currency: 'usd-cents', rate: '12.5', unit: 'per-annotation' })).toBe(true);
    expect(isUsageMeteredConsideration({ kind: 'usage-metered', currency: 'usd-cents', rate: '0.1', unit: 'per annotation' })).toBe(false);
    expect(isUsageMeteredConsideration({ kind: 'usage-metered', currency: 'usd-cents', rate: 0.1, unit: 'per-annotation' })).toBe(false);
  });

  it('the union closes over the two models + the explicit null (no charge)', () => {
    expect(isConsideration(null)).toBe(true);
    expect(isConsideration({ kind: 'revenue-share', basisPoints: 100 })).toBe(false);
    expect(CURRENCY_PATTERN.test('usd-cents')).toBe(true);
    expect(CURRENCY_PATTERN.test('USD CENTS')).toBe(false);
    expect(USAGE_UNIT_PATTERN.test('per-annotation')).toBe(true);
  });
});

describe('validateConsideration (the opaque slot\'s narrowing — collect-all)', () => {
  it('mints deeply frozen typed terms from valid input (both models + null)', () => {
    for (const input of [null, { kind: 'fixed-fee', currency: 'usd-cents', amount: '100' }, { kind: 'usage-metered', currency: 'usd-cents', rate: '0.5', unit: 'per-annotation' }]) {
      const result = validateConsideration(input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it('the money law: a NUMBER amount is the typed invalid_decimal — never coerced', () => {
    const result = validateConsideration({ kind: 'fixed-fee', currency: 'usd-cents', amount: 12500 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'invalid_decimal')).toBe(true);
      expect(result.errors[0].path).toBe('consideration.amount');
    }
  });

  it('collects every violation at once', () => {
    const result = validateConsideration({ kind: 'usage-metered', currency: 'x y', rate: 1, unit: 'bad unit' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('the L16a label law: a label key anywhere in the terms is the typed refusal', () => {
    const result = validateConsideration({ kind: 'fixed-fee', currency: 'usd-cents', amount: '100', title: 'Quant Provider' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'label_as_evidence')).toBe(true);
    }
  });

  it('the mint never freezes the caller\'s draft (purity)', () => {
    const draft = { kind: 'fixed-fee', currency: 'usd-cents', amount: '100' };
    const result = validateConsideration(draft);
    expect(result.ok).toBe(true);
    expect(Object.isFrozen(draft)).toBe(false);
  });
});

describe('considerationCharge (the exact price computation)', () => {
  it('fixed-fee: the price is the price (usage ignored)', () => {
    const charge = considerationCharge({ kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' }, '99');
    expect(charge.ok && charge.value).toBe('12500.50');
  });

  it('usage-metered: rate x units, EXACT (the 0.1 x 3 = 0.3 trap)', () => {
    const charge = considerationCharge({ kind: 'usage-metered', currency: 'usd-cents', rate: '0.1', unit: 'per-annotation' }, '3');
    expect(charge.ok && charge.value).toBe('0.3');
    const big = considerationCharge({ kind: 'usage-metered', currency: 'usd-cents', rate: '0.125', unit: 'per-annotation' }, '8000');
    expect(big.ok && big.value).toBe('1000');
  });

  it('usage-metered without usage is the typed usage_missing; malformed usage is invalid_decimal', () => {
    const missing = considerationCharge({ kind: 'usage-metered', currency: 'usd-cents', rate: '1', unit: 'per-annotation' }, null);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0].code).toBe('usage_missing');
    const malformed = considerationCharge({ kind: 'usage-metered', currency: 'usd-cents', rate: '1', unit: 'per-annotation' }, '3.5.5');
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.errors[0].code).toBe('invalid_decimal');
  });

  it('null (no charge) settles at "0"', () => {
    const charge = considerationCharge(null, '99');
    expect(charge.ok && charge.value).toBe('0');
  });

  it('metered usage of 0 settles at "0" (nothing used, nothing owed)', () => {
    const charge = considerationCharge({ kind: 'usage-metered', currency: 'usd-cents', rate: '5', unit: 'per-annotation' }, '0');
    expect(charge.ok && charge.value).toBe('0');
  });
});

describe('considerationWithin (the budget law)', () => {
  const offer = { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500' } as const;

  it('accepts a counter at or below the offer', () => {
    expect(considerationWithin(offer, { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500' }).ok).toBe(true);
    expect(considerationWithin(offer, { kind: 'fixed-fee', currency: 'usd-cents', amount: '9900' }).ok).toBe(true);
    expect(considerationWithin(offer, null).ok).toBe(true); // a free counter is a discount to zero
  });

  it('refuses a counter above the offer with the typed consideration_exceeds_budget', () => {
    const result = considerationWithin(offer, { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.01' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe('consideration_exceeds_budget');
      expect(result.errors[0].message).toContain('12500.01');
    }
  });

  it('refuses a pricing-model change with the typed consideration_incomparable', () => {
    const result = considerationWithin(offer, { kind: 'usage-metered', currency: 'usd-cents', rate: '1', unit: 'per-annotation' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('consideration_incomparable');
  });

  it('refuses a currency change with the typed currency_mismatch', () => {
    const result = considerationWithin(offer, { kind: 'fixed-fee', currency: 'eur-cents', amount: '100' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('currency_mismatch');
  });

  it('a no-charge offer accepts only a no-charge counter', () => {
    expect(considerationWithin(null, null).ok).toBe(true);
    const result = considerationWithin(null, offer);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('consideration_exceeds_budget');
  });

  it('metered offers compare RATES (and the metered unit is part of the language)', () => {
    const meteredOffer = { kind: 'usage-metered', currency: 'usd-cents', rate: '0.5', unit: 'per-annotation' } as const;
    expect(considerationWithin(meteredOffer, { kind: 'usage-metered', currency: 'usd-cents', rate: '0.5', unit: 'per-annotation' }).ok).toBe(true);
    const over = considerationWithin(meteredOffer, { kind: 'usage-metered', currency: 'usd-cents', rate: '0.6', unit: 'per-annotation' });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0].code).toBe('consideration_exceeds_budget');
    const unitChange = considerationWithin(meteredOffer, { kind: 'usage-metered', currency: 'usd-cents', rate: '0.5', unit: 'per-demonstration' });
    expect(unitChange.ok).toBe(false);
    if (!unitChange.ok) expect(unitChange.ok === false && unitChange.errors[0].code).toBe('consideration_incomparable');
  });
});

describe('withinListingPricing (the listing-price law)', () => {
  const list = { kind: 'fixed-fee', currency: 'usd-cents', amount: '1000' } as const;

  it('accepts a counter at or below the list; refuses above', () => {
    expect(withinListingPricing(list, { kind: 'fixed-fee', currency: 'usd-cents', amount: '1000' }).ok).toBe(true);
    expect(withinListingPricing(list, { kind: 'fixed-fee', currency: 'usd-cents', amount: '999.99' }).ok).toBe(true);
    const over = withinListingPricing(list, { kind: 'fixed-fee', currency: 'usd-cents', amount: '1000.01' });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0].code).toBe('listing_mismatch');
  });

  it('a free counter is always within the listing', () => {
    expect(withinListingPricing(list, null).ok).toBe(true);
  });
});

describe('describeConsideration (deterministic, legible)', () => {
  it('describes the three shapes', () => {
    expect(describeConsideration(null)).toBe('no charge');
    expect(describeConsideration({ kind: 'fixed-fee', currency: 'usd-cents', amount: '0' })).toBe('free (usd-cents 0)');
    expect(describeConsideration({ kind: 'fixed-fee', currency: 'usd-cents', amount: '10' })).toBe('fixed fee 10 usd-cents');
    expect(describeConsideration({ kind: 'usage-metered', currency: 'usd-cents', rate: '0.5', unit: 'per-annotation' })).toBe('metered 0.5 usd-cents/per-annotation');
  });
});
