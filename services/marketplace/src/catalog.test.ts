// @tradrl/marketplace-service — the CATALOG tests: publish / revise /
// retire, the snapshot + revision + retirement laws, the deterministic
// discovery fold, and the chain.

import { describe, expect, it } from 'vitest';
import {
  activeListingAt,
  createMarketplace,
  deriveListingRef,
  discoverListings,
  isMarketplaceListing,
  MARKETPLACE_LOG_KINDS,
  publishListing,
  retireListing,
  reviseListing,
  verifyMarketplaceChain,
} from './index';
import type { MarketplaceState, MarketplaceResult } from './index';
import { FIXTURE_PROJECT, FIXTURE_TENANT, FIXTURE_VERIFICATION, T0, validDeclaration } from './fixtures';

function fresh(): MarketplaceResult<MarketplaceState> {
  return createMarketplace(FIXTURE_TENANT);
}

describe('publishListing (the source + snapshot + pricing laws)', () => {
  it('publishes a listing from a valid declaration: snapshot, content-addressed ids, one log entry', () => {
    const state = fresh();
    if (!state.ok) throw new Error('unreachable');
    const published = publishListing(state.value, {
      declaration: validDeclaration(),
      offerRef: 'offer-liquidity-analysis',
      pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' },
      listedAt: T0 + 1000,
    });
    expect(published.ok).toBe(true);
    if (published.ok) {
      const listing = published.value.record;
      expect(listing.listingId).toMatch(/^mkl:[0-9a-f]{16}$/);
      expect(listing.listingRef).toMatch(/^ml:[0-9a-f]{16}$/);
      expect(listing.version).toBe(1);
      expect(listing.supersedes).toBeNull();
      expect(listing.offer.capabilityKey).toBe('liquidity-regime-analysis');
      expect(listing.providerName).toBe('Alpha Microstructure Research');
      expect(isMarketplaceListing(listing)).toBe(true);
      expect(published.value.state.log).toHaveLength(1);
      expect(published.value.state.log[0].kind).toBe('listing-published');
      // The slot identity is stable and derived from (tenant, provider, offer).
      expect(listing.listingRef).toBe(deriveListingRef({ tenantId: FIXTURE_TENANT, providerRef: 'vendor-microstructure-alpha', offerRef: 'offer-liquidity-analysis' }));
    }
  });

  it('a quote\'s source law: an offer absent from the declaration is the typed listing_mismatch', () => {
    const state = fresh();
    if (!state.ok) throw new Error('unreachable');
    const published = publishListing(state.value, {
      declaration: validDeclaration(),
      offerRef: 'offer-nonexistent',
      pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1' },
      listedAt: T0 + 1000,
    });
    expect(published.ok).toBe(false);
    if (!published.ok) expect(published.errors[0].code).toBe('listing_mismatch');
  });

  it('a null pricing is the typed refusal (listings are priced advertisements)', () => {
    const state = fresh();
    if (!state.ok) throw new Error('unreachable');
    const published = publishListing(state.value, {
      declaration: validDeclaration(),
      offerRef: 'offer-liquidity-analysis',
      pricing: null,
      listedAt: T0 + 1000,
    });
    expect(published.ok).toBe(false);
    if (!published.ok) expect(published.errors[0].code).toBe('consideration_invalid');
  });

  it('L4: a listing never predates its source declaration', () => {
    const state = fresh();
    if (!state.ok) throw new Error('unreachable');
    const published = publishListing(state.value, {
      declaration: validDeclaration(),
      offerRef: 'offer-liquidity-analysis',
      pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1' },
      listedAt: T0 - 1,
    });
    expect(published.ok).toBe(false);
    if (!published.ok) expect(published.errors[0].code).toBe('l4_boundary_violation');
  });

  it('a free listing prices at fixed-fee "0"', () => {
    const state = fresh();
    if (!state.ok) throw new Error('unreachable');
    const published = publishListing(state.value, {
      declaration: validDeclaration(),
      offerRef: 'offer-liquidity-analysis',
      pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '0' },
      listedAt: T0 + 1000,
    });
    expect(published.ok).toBe(true);
  });

  it('an invalid declaration shape is the typed invalid_type; a foreign tenant never enters (L12)', () => {
    const state = fresh();
    if (!state.ok) throw new Error('unreachable');
    const badShape = publishListing(state.value, { declaration: { nope: true }, offerRef: 'x', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1' }, listedAt: T0 });
    expect(badShape.ok).toBe(false);
    if (!badShape.ok) expect(badShape.errors[0].code).toBe('invalid_type');
    const foreign = publishListing(state.value, {
      declaration: { ...validDeclaration(), tenantId: 'tenant-other' },
      offerRef: 'offer-liquidity-analysis',
      pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1' },
      listedAt: T0 + 1000,
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0].code).toBe('cross_tenant_access');
  });

  it('L16a: a label-smuggled declaration is refused (listings describe capabilities, never professions)', () => {
    const state = fresh();
    if (!state.ok) throw new Error('unreachable');
    const smuggled = publishListing(state.value, {
      declaration: { ...validDeclaration(), offers: [{ ...(validDeclaration().offers as unknown[])[0], profession: 'quant researcher' }] },
      offerRef: 'offer-liquidity-analysis',
      pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1' },
      listedAt: T0 + 1000,
    });
    expect(smuggled.ok).toBe(false);
    if (!smuggled.ok) expect(smuggled.errors.some((error) => error.code === 'label_as_evidence')).toBe(true);
  });
});

describe('the revision law (publish over an existing slot mints version + 1)', () => {
  it('revises with a chained id and retains the full history', () => {
    const state = fresh();
    if (!state.ok) throw new Error('unreachable');
    const v1 = publishListing(state.value, { declaration: validDeclaration(), offerRef: 'offer-liquidity-analysis', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1000' }, listedAt: T0 + 1000 });
    if (!v1.ok) throw new Error('unreachable');
    const v2 = reviseListing(v1.value.state, { declaration: validDeclaration(), offerRef: 'offer-liquidity-analysis', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1200' }, listedAt: T0 + 2000 });
    expect(v2.ok).toBe(true);
    if (v2.ok) {
      expect(v2.value.record.version).toBe(2);
      expect(v2.value.record.supersedes).toBe(v1.value.record.listingId);
      expect(v2.value.state.listingHistory).toHaveLength(2);
      expect(v2.value.state.log).toHaveLength(2);
      expect(v2.value.state.log[1].kind).toBe('listing-revised');
      // The prior revision is untouched (L3).
      expect(v1.value.record.version).toBe(1);
    }
    // Replaying the identical revision is an idempotent replay.
    const replay = reviseListing(v2.ok ? v2.value.state : v1.value.state, { declaration: validDeclaration(), offerRef: 'offer-liquidity-analysis', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1200' }, listedAt: T0 + 2000 });
    expect(replay.ok && replay.value.replayed).toBe(true);
  });
});

describe('the retirement law (terminal)', () => {
  function listed(): MarketplaceState {
    const state = fresh();
    if (!state.ok) throw new Error('unreachable');
    const published = publishListing(state.value, { declaration: validDeclaration(), offerRef: 'offer-liquidity-analysis', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1000' }, listedAt: T0 + 1000 });
    if (!published.ok) throw new Error('unreachable');
    return published.value.state;
  }

  it('retires once; replays idempotently; a retired slot never revises', () => {
    const state = listed();
    const slot = state.listingsBySlot.keys().next().value as string;
    const retired = retireListing(state, { listingRef: slot, retiredAt: T0 + 3000 });
    expect(retired.ok).toBe(true);
    if (!retired.ok) throw new Error('unreachable');
    const replay = retireListing(retired.value.state, { listingRef: slot, retiredAt: T0 + 3000 });
    expect(replay.ok && replay.value.replayed).toBe(true);
    const again = retireListing(retired.value.state, { listingRef: slot, retiredAt: T0 + 4000 });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors[0].code).toBe('listing_retired');
    const revise = reviseListing(retired.value.state, { declaration: validDeclaration(), offerRef: 'offer-liquidity-analysis', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1' }, listedAt: T0 + 5000 });
    expect(revise.ok).toBe(false);
    if (!revise.ok) expect(revise.errors[0].code).toBe('listing_retired');
  });

  it('an unknown slot is the typed listing_unknown', () => {
    const state = listed();
    const retired = retireListing(state, { listingRef: 'ml:0123456789abcdef', retiredAt: T0 + 3000 });
    expect(retired.ok).toBe(false);
    if (!retired.ok) expect(retired.errors[0].code).toBe('listing_unknown');
  });
});

describe('discoverListings (the point-in-time deterministic fold)', () => {
  function catalog(): MarketplaceState {
    let state = fresh();
    if (!state.ok) throw new Error('unreachable');
    let current = state.value;
    const alpha = publishListing(current, { declaration: validDeclaration(), offerRef: 'offer-liquidity-analysis', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1500' }, listedAt: T0 + 1000 });
    if (!alpha.ok) throw new Error('unreachable');
    current = alpha.value.state;
    // A second provider: metered, cheaper first-unit economics.
    const beta = publishListing(current, {
      declaration: { ...validDeclaration(), providerRef: 'vendor-beta', displayName: 'Beta Sentiment Desk', declaredAt: T0, offers: [{ ...(validDeclaration().offers as unknown[])[0], offerRef: 'offer-sentiment-scan', capabilityKey: 'sentiment-event-analysis', deliverableKinds: ['expert-evidence'] }] },
      offerRef: 'offer-sentiment-scan',
      pricing: { kind: 'usage-metered', currency: 'usd-cents', rate: '0.5', unit: 'per-annotation' },
      listedAt: T0 + 1500,
    });
    if (!beta.ok) throw new Error('unreachable');
    current = beta.value.state;
    // A third: free.
    const free = publishListing(current, {
      declaration: { ...validDeclaration(), providerRef: 'vendor-open-research', displayName: 'Open Research Collective', declaredAt: T0, offers: [{ ...(validDeclaration().offers as unknown[])[0], offerRef: 'offer-open-regime', capabilityKey: 'regime-classification' }] },
      offerRef: 'offer-open-regime',
      pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '0' },
      listedAt: T0 + 2000,
    });
    if (!free.ok) throw new Error('unreachable');
    return free.value.state;
  }

  it('discovers everything active at the instant, in the canonical order (free first, then by exact price)', () => {
    const state = catalog();
    const found = discoverListings(state, { at: T0 + 5000 });
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value).toHaveLength(3);
      // Ordering: fixed-fee first (free "0" before "1500"), then metered.
      expect(found.value[0].pricing.kind === 'fixed-fee' && found.value[0].pricing.amount).toBe('0');
      expect(found.value[1].pricing.kind === 'fixed-fee' && found.value[1].pricing.amount).toBe('1500');
      expect(found.value[2].pricing.kind).toBe('usage-metered');
    }
  });

  it('L4: a listing not yet published at the instant is invisible; retired listings disappear', () => {
    const state = catalog();
    const early = discoverListings(state, { at: T0 + 1200 });
    expect(early.ok && early.value).toHaveLength(1); // only alpha (beta at +1500, free at +2000)
    const slot = [...state.listingsBySlot.keys()].find((ref) => state.listingsBySlot.get(ref)?.providerRef === 'vendor-beta') as string;
    const retired = retireListing(state, { listingRef: slot, retiredAt: T0 + 6000 });
    expect(retired.ok).toBe(true);
    const after = discoverListings(retired.ok ? retired.value.state : state, { at: T0 + 7000 });
    expect(after.ok && after.value).toHaveLength(2);
    const before = discoverListings(retired.ok ? retired.value.state : state, { at: T0 + 5500 });
    expect(before.ok && before.value).toHaveLength(3); // not yet retired at +5500
  });

  it('the filters: capability key, deliverable kind, verification kind, currency, exact price bound', () => {
    const state = catalog();
    const byCapability = discoverListings(state, { capabilityKey: 'liquidity-regime-analysis', at: T0 + 5000 });
    expect(byCapability.ok && byCapability.value).toHaveLength(1);
    const byKind = discoverListings(state, { deliverableKind: 'expert-evidence', at: T0 + 5000 });
    expect(byKind.ok && byCapability.value).toHaveLength(1);
    const byVerification = discoverListings(state, { verificationKind: 'benchmark', at: T0 + 5000 });
    expect(byVerification.ok && byVerification.value).toHaveLength(3);
    const byCurrency = discoverListings(state, { currency: 'eur-cents', at: T0 + 5000 });
    expect(byCurrency.ok && byCurrency.value).toHaveLength(0);
    const byPrice = discoverListings(state, { maxPrice: '0.4', at: T0 + 5000 });
    expect(byPrice.ok && byPrice.value).toHaveLength(1); // the free listing only (the metered rate 0.5 is above the bound)
    const byRate = discoverListings(state, { maxPrice: '0.5', currency: 'usd-cents', at: T0 + 5000 });
    expect(byRate.ok && byRate.value).toHaveLength(2); // free + the 0.5-rate metered listing
  });

  it('identical queries return identical orderings (determinism)', () => {
    const state = catalog();
    const a = discoverListings(state, { at: T0 + 5000 });
    const b = discoverListings(state, { at: T0 + 5000 });
    expect(a.ok && b.ok && JSON.stringify(a.value) === JSON.stringify(b.value)).toBe(true);
  });
});

describe('activeListingAt (the purchase path\'s gate)', () => {
  it('resolves the revision current at the instant and refuses retired slots', () => {
    const state = fresh();
    if (!state.ok) throw new Error('unreachable');
    const v1 = publishListing(state.value, { declaration: validDeclaration(), offerRef: 'offer-liquidity-analysis', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1000' }, listedAt: T0 + 1000 });
    if (!v1.ok) throw new Error('unreachable');
    const v2 = reviseListing(v1.value.state, { declaration: validDeclaration(), offerRef: 'offer-liquidity-analysis', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '2000' }, listedAt: T0 + 2000 });
    if (!v2.ok) throw new Error('unreachable');
    const atEarly = activeListingAt(v2.value.state, v1.value.record.listingRef, T0 + 1500);
    expect(atEarly.ok && (atEarly.value.pricing as { amount: string }).amount).toBe('1000');
    const atLate = activeListingAt(v2.value.state, v1.value.record.listingRef, T0 + 2500);
    expect(atLate.ok && (atLate.value.pricing as { amount: string }).amount).toBe('2000');
  });
});

describe('the chain + the log kinds', () => {
  it('the log kinds are exactly the seven operations', () => {
    expect([...MARKETPLACE_LOG_KINDS]).toEqual([
      'listing-published',
      'listing-revised',
      'listing-retired',
      'purchase-opened',
      'purchase-bound',
      'purchase-settled',
      'purchase-voided',
    ]);
  });

  it('the full catalog lifecycle verifies green; a spliced log is chain_mismatch', () => {
    const state = fresh();
    if (!state.ok) throw new Error('unreachable');
    const v1 = publishListing(state.value, { declaration: validDeclaration(), offerRef: 'offer-liquidity-analysis', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1000' }, listedAt: T0 + 1000 });
    if (!v1.ok) throw new Error('unreachable');
    const v2 = reviseListing(v1.value.state, { declaration: validDeclaration(), offerRef: 'offer-liquidity-analysis', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '2000' }, listedAt: T0 + 2000 });
    if (!v2.ok) throw new Error('unreachable');
    const slot = v1.value.record.listingRef;
    const retired = retireListing(v2.value.state, { listingRef: slot, retiredAt: T0 + 3000 });
    if (!retired.ok) throw new Error('unreachable');
    expect(verifyMarketplaceChain(retired.value.state).ok).toBe(true);
    const spliced = { ...retired.value.state, log: [retired.value.state.log[1]] };
    const verified = verifyMarketplaceChain(spliced);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0].code).toBe('chain_mismatch');
    // A rewritten listing record is detected too.
    const tampered = {
      ...retired.value.state,
      listingsById: new Map(retired.value.state.listingsById).set(v1.value.record.listingId, { ...v1.value.record, pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1' } }),
    };
    const tamperVerified = verifyMarketplaceChain(tampered);
    expect(tamperVerified.ok).toBe(false);
    if (!tamperVerified.ok) expect(tamperVerified.errors[0].code).toBe('chain_mismatch');
  });
});
