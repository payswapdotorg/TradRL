// @tradrl/marketplace-service — the COMMISSION tests: minting the
// T045-shaped capability-request draft from a recorded capability gap
// and an active listing under the offered consideration (the
// T017 + T045 + T047 composition the Work Order mandates).

import { describe, expect, it } from 'vitest';
import { commissionCapabilityRequest, publishListing, createMarketplace } from './index';
import type { MarketplaceState, MarketplaceResult } from './index';
import { FIXTURE_EVIDENCE_REF, FIXTURE_GAP_ID, FIXTURE_PROJECT, FIXTURE_TENANT, FIXTURE_VERIFICATION, T0, validDeclaration } from './fixtures';

function listed(): { state: MarketplaceState; listingRef: string } {
  const created = createMarketplace(FIXTURE_TENANT);
  if (!created.ok) throw new Error('unreachable');
  const published = publishListing(created.value, {
    declaration: validDeclaration(),
    offerRef: 'offer-liquidity-analysis',
    pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' },
    listedAt: T0 + 1000,
  });
  if (!published.ok) throw new Error(`unreachable: ${published.errors.map((e) => e.message).join('; ')}`);
  return { state: published.value.state, listingRef: published.value.record.listingRef };
}

function commissionInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    listingRef: 'PLACEHOLDER',
    deliverableKind: 'capability-artifact',
    gapRefs: [FIXTURE_GAP_ID],
    evidenceRefs: [FIXTURE_EVIDENCE_REF],
    verification: FIXTURE_VERIFICATION,
    deadline: T0 + 86_400_000,
    offeredConsideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' },
    requestedAt: T0 + 2000,
    ...overrides,
  };
}

describe('commissionCapabilityRequest (the T017 + T045 + T047 composition)', () => {
  it('mints the plain-JSON T045 request draft from (active listing, cited gap, frozen contract, offered budget)', () => {
    const { state, listingRef } = listed();
    const commissioned = commissionCapabilityRequest(state, commissionInput({ listingRef }) as never);
    expect(commissioned.ok).toBe(true);
    if (!commissioned.ok) throw new Error('unreachable');
    const { draft, listing } = commissioned.value;
    // The draft carries the LISTING's capability contract and applicability scope.
    expect(draft.requestedCapability).toBe('liquidity-regime-analysis');
    expect(draft.deliverableKind).toBe('capability-artifact');
    expect(draft.gapRefs).toEqual([FIXTURE_GAP_ID]);
    expect(draft.evidenceRefs).toEqual([FIXTURE_EVIDENCE_REF]);
    // THE FREEZE LAW: the verification contract is carried VERBATIM.
    expect(JSON.stringify(draft.verification)).toBe(JSON.stringify(FIXTURE_VERIFICATION));
    expect(draft.deadline).toBe(T0 + 86_400_000);
    // THE BUDGET-OFFER LAW: the offered consideration rides the opaque slot.
    expect(draft.consideration).toEqual({ kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' });
    expect(draft.tenantId).toBe(FIXTURE_TENANT);
    expect(draft.projectId).toBe(FIXTURE_PROJECT);
    expect(draft.requestedAt).toBe(T0 + 2000);
    expect(listing.listingRef).toBe(listingRef);
  });

  it('THE EVIDENCE LAW: an uncited request is invented, not requested', () => {
    const { state, listingRef } = listed();
    const uncited = commissionCapabilityRequest(state, commissionInput({ listingRef, gapRefs: [], evidenceRefs: [] }) as never) as MarketplaceResult<never>;
    expect(uncited.ok).toBe(false);
    if (!uncited.ok) {
      expect(uncited.errors[0].code).toBe('invalid_field');
      expect(uncited.errors[0].message).toContain('no evidence citation');
    }
  });

  it('THE LISTING LAW: a deliverable kind or verification regime the offer did not declare is refused', () => {
    const { state, listingRef } = listed();
    const wrongKind = commissionCapabilityRequest(state, commissionInput({ listingRef, deliverableKind: 'annotation' }) as never) as MarketplaceResult<never>;
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.errors[0].code).toBe('listing_mismatch');
    // A verification kind the offer does not accept (the fixture offer accepts all three kinds —
    // use a requirement the mirror rejects to prove the per-requirement check exists).
    const badRequirement = commissionCapabilityRequest(state, commissionInput({ listingRef, verification: [{ kind: 'local-evaluation', requirementRef: 'x' }] }) as never) as MarketplaceResult<never>;
    expect(badRequirement.ok).toBe(false);
    if (!badRequirement.ok) expect(badRequirement.errors[0].code).toBe('invalid_field');
    // Duplicate requirement refs are refused (the contract's refs are unique).
    const duplicated = commissionCapabilityRequest(state, commissionInput({
      listingRef,
      verification: [
        { kind: 'benchmark', requirementRef: 'bench-check', benchmarkId: 'bench-microstructure-42' },
        { kind: 'benchmark', requirementRef: 'bench-check', benchmarkId: 'bench-microstructure-42' },
      ],
    }) as never) as MarketplaceResult<never>;
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) expect(duplicated.errors[0].message).toContain('duplicate requirementRef');
  });

  it('L4: a deadline that predates the request instant is refused', () => {
    const { state, listingRef } = listed();
    const early = commissionCapabilityRequest(state, commissionInput({ listingRef, deadline: T0 + 1000 }) as never) as MarketplaceResult<never>;
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors[0].code).toBe('l4_boundary_violation');
  });

  it('THE BUDGET-OFFER LAW: an offer below the list price is dead on arrival; a model or currency change is incomparable', () => {
    const { state, listingRef } = listed();
    const lowball = commissionCapabilityRequest(state, commissionInput({ listingRef, offeredConsideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1' } }) as never) as MarketplaceResult<never>;
    expect(lowball.ok).toBe(false);
    if (!lowball.ok) expect(lowball.errors[0].code).toBe('listing_mismatch');
    const wrongModel = commissionCapabilityRequest(state, commissionInput({ listingRef, offeredConsideration: { kind: 'usage-metered', currency: 'usd-cents', rate: '1', unit: 'per-annotation' } }) as never) as MarketplaceResult<never>;
    expect(wrongModel.ok).toBe(false);
    if (!wrongModel.ok) expect(wrongModel.errors[0].code).toBe('consideration_incomparable');
    const wrongCurrency = commissionCapabilityRequest(state, commissionInput({ listingRef, offeredConsideration: { kind: 'fixed-fee', currency: 'eur-cents', amount: '12500.50' } }) as never) as MarketplaceResult<never>;
    expect(wrongCurrency.ok).toBe(false);
    if (!wrongCurrency.ok) expect(wrongCurrency.errors[0].code).toBe('currency_mismatch');
    const nullOffer = commissionCapabilityRequest(state, commissionInput({ listingRef, offeredConsideration: null }) as never) as MarketplaceResult<never>;
    expect(nullOffer.ok).toBe(false);
    if (!nullOffer.ok) expect(nullOffer.errors[0].code).toBe('listing_mismatch');
  });

  it('determinism: identical inputs mint identical drafts (the minter is pure)', () => {
    const { state, listingRef } = listed();
    const a = commissionCapabilityRequest(state, commissionInput({ listingRef }) as never);
    const b = commissionCapabilityRequest(state, commissionInput({ listingRef }) as never);
    if (!a.ok || !b.ok) throw new Error('unreachable');
    expect(JSON.stringify(a.value.draft)).toBe(JSON.stringify(b.value.draft));
  });

  it('an unknown or retired slot never commissions', () => {
    const { state, listingRef } = listed();
    const unknown = commissionCapabilityRequest(state, commissionInput({ listingRef: 'ml:0123456789abcdef' }) as never) as MarketplaceResult<never>;
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0].code).toBe('listing_unknown');
  });
});
