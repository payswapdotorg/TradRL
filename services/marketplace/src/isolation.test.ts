// @tradrl/marketplace-service — the L12 isolation tests: the marketplace
// is scoped to ONE tenant; nothing foreign crosses the boundary.

import { describe, expect, it } from 'vitest';
import {
  bindEngagement,
  commissionCapabilityRequest,
  createMarketplace,
  discoverListings,
  openPurchase,
  publishListing,
  retireListing,
  settlePurchase,
  voidPurchase,
  verifyMarketplaceChain,
} from './index';
import type { MarketplaceState, MarketplaceResult } from './index';
import { createEntitlementLedger } from './index';
import { FIXTURE_GAP_ID, FIXTURE_PROJECT, FIXTURE_TENANT, FIXTURE_VERIFICATION, T0, validDeclaration } from './fixtures';
import { stableDigestJson } from './imports';

const REQUEST_ID = `cpr:${stableDigestJson({ fixture: 'isolation-request' })}`;
const QUOTE_ID = `qte:${stableDigestJson({ fixture: 'isolation-quote' })}`;
const ENGAGEMENT_ID = `eng:${stableDigestJson({ fixture: 'isolation-engagement' })}`;
const DELIVERABLE_ID = `dlv:${stableDigestJson({ fixture: 'isolation-deliverable' })}`;
const REPORT_ID = `vrf:${stableDigestJson({ fixture: 'isolation-report' })}`;
const PAYLOAD_DIGEST = stableDigestJson({ fixture: 'isolation-payload' });

function fixtureListing(): MarketplaceResult<MarketplaceState> {
  const created = createMarketplace(FIXTURE_TENANT);
  if (!created.ok) return created;
  const published = publishListing(created.value, {
    declaration: validDeclaration(),
    offerRef: 'offer-liquidity-analysis',
    pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '500' },
    listedAt: T0 + 1000,
  });
  if (!published.ok) return published;
  return { ok: true, value: published.value.state };
}

describe('the L12 boundary (one tenant per marketplace)', () => {
  it('a marketplace is created within exactly one tenant scope', () => {
    expect(createMarketplace('').ok).toBe(false);
    expect(createMarketplace(FIXTURE_TENANT).ok).toBe(true);
  });

  it('a foreign DECLARATION never enters the catalog', () => {
    const state = fixtureListing();
    if (!state.ok) throw new Error('unreachable');
    const foreign = publishListing(state.value, {
      declaration: { ...validDeclaration(), tenantId: 'tenant-other', declarationId: `pvd:${stableDigestJson({ fixture: 'foreign' })}` },
      offerRef: 'offer-liquidity-analysis',
      pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '1' },
      listedAt: T0 + 2000,
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0].code).toBe('cross_tenant_access');
  });

  it('a foreign REQUEST or QUOTE never opens a purchase', () => {
    const state = fixtureListing();
    if (!state.ok) throw new Error('unreachable');
    const listingRef = [...state.value.listingsBySlot.keys()][0] as string;
    const foreignRequest = {
      requestId: REQUEST_ID, requestedCapability: 'liquidity-regime-analysis', summary: 's',
      deliverableKind: 'capability-artifact', gapRefs: [FIXTURE_GAP_ID], evidenceRefs: ['evi://x'],
      verification: FIXTURE_VERIFICATION, deadline: null, consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '500' },
      tenantId: 'tenant-other', projectId: FIXTURE_PROJECT, requestedAt: T0 + 1500,
    };
    const refused = openPurchase(state.value, { listingRef, request: foreignRequest, quote: { quoteId: QUOTE_ID, requestId: REQUEST_ID, providerRef: 'vendor-microstructure-alpha', offerRef: 'offer-liquidity-analysis', terms: { deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '500' }, estimatedDeliveryAt: null }, quotedAt: T0 + 1600, tenantId: 'tenant-other', projectId: FIXTURE_PROJECT }, openedAt: T0 + 1700 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors[0].code).toBe('cross_tenant_access');
  });

  it('a foreign ENGAGEMENT never binds and never settles', () => {
    const state = fixtureListing();
    if (!state.ok) throw new Error('unreachable');
    const listingRef = [...state.value.listingsBySlot.keys()][0] as string;
    const opened = openPurchase(state.value, {
      listingRef,
      request: {
        requestId: REQUEST_ID, requestedCapability: 'liquidity-regime-analysis', summary: 's', deliverableKind: 'capability-artifact',
        gapRefs: [FIXTURE_GAP_ID], evidenceRefs: ['evi://x'], verification: FIXTURE_VERIFICATION, deadline: null,
        consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '500' },
        tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT, requestedAt: T0 + 1500,
      },
      quote: { quoteId: QUOTE_ID, requestId: REQUEST_ID, providerRef: 'vendor-microstructure-alpha', offerRef: 'offer-liquidity-analysis', terms: { deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '500' }, estimatedDeliveryAt: null }, quotedAt: T0 + 1600, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT },
      openedAt: T0 + 1700,
    });
    if (!opened.ok) throw new Error(`unreachable: ${opened.errors.map((e) => e.message).join('; ')}`);
    const foreignEngagement = {
      engagementId: ENGAGEMENT_ID, requestId: REQUEST_ID, quoteId: QUOTE_ID, providerRef: 'vendor-microstructure-alpha',
      deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, deadline: null,
      applicability: { environmentProfileRefs: [], instrumentClassRefs: [] }, status: 'open', openedAt: T0 + 1800,
      tenantId: 'tenant-other', projectId: FIXTURE_PROJECT,
    };
    const refused = bindEngagement(opened.value.state, { purchaseId: opened.value.record.purchaseId, engagement: foreignEngagement, engagedAt: T0 + 1900 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors[0].code).toBe('cross_tenant_access');
  });

  it('two tenants\' marketplaces are fully disjoint (same ops, different scopes, different ids)', () => {
    function run(tenant: string): string {
      const created = createMarketplace(tenant);
      if (!created.ok) throw new Error('unreachable');
      const published = publishListing(created.value, {
        declaration: { ...validDeclaration(), tenantId: tenant, projectId: `${tenant}-prj`, declarationId: `pvd:${stableDigestJson({ tenant })}` },
        offerRef: 'offer-liquidity-analysis',
        pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '500' },
        listedAt: T0 + 1000,
      });
      if (!published.ok) throw new Error('unreachable');
      return published.value.record.listingRef;
    }
    const a = run('tenant-alpha');
    const b = run('tenant-beta');
    expect(a).not.toBe(b); // the slot identity carries the tenant scope
  });

  it('discovery never crosses scopes (the fold reads only the scoped catalog)', () => {
    const state = fixtureListing();
    if (!state.ok) throw new Error('unreachable');
    const found = discoverListings(state.value, { at: T0 + 5000 });
    if (!found.ok) throw new Error('unreachable');
    for (const listing of found.value) expect(listing.tenantId).toBe(FIXTURE_TENANT);
  });

  it('the settlement charge and license stay inside the purchasing tenant\'s ledger', () => {
    const state = fixtureListing();
    if (!state.ok) throw new Error('unreachable');
    const listingRef = [...state.value.listingsBySlot.keys()][0] as string;
    const opened = openPurchase(state.value, {
      listingRef,
      request: {
        requestId: REQUEST_ID, requestedCapability: 'liquidity-regime-analysis', summary: 's', deliverableKind: 'capability-artifact',
        gapRefs: [FIXTURE_GAP_ID], evidenceRefs: ['evi://x'], verification: FIXTURE_VERIFICATION, deadline: null,
        consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '500' },
        tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT, requestedAt: T0 + 1500,
      },
      quote: { quoteId: QUOTE_ID, requestId: REQUEST_ID, providerRef: 'vendor-microstructure-alpha', offerRef: 'offer-liquidity-analysis', terms: { deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '500' }, estimatedDeliveryAt: null }, quotedAt: T0 + 1600, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT },
      openedAt: T0 + 1700,
    });
    if (!opened.ok) throw new Error('unreachable');
    const bound = bindEngagement(opened.value.state, {
      purchaseId: opened.value.record.purchaseId,
      engagement: {
        engagementId: ENGAGEMENT_ID, requestId: REQUEST_ID, quoteId: QUOTE_ID, providerRef: 'vendor-microstructure-alpha',
        deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, deadline: null,
        applicability: { environmentProfileRefs: [], instrumentClassRefs: [] }, status: 'open', openedAt: T0 + 1800,
        tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT,
      },
      engagedAt: T0 + 1900,
    });
    if (!bound.ok) throw new Error('unreachable');
    const ledger = createEntitlementLedger('tenant-other'); // a FOREIGN tenant's ledger
    if (!ledger.ok) throw new Error('unreachable');
    const settled = settlePurchase(bound.value.state, ledger.value, {
      purchaseId: opened.value.record.purchaseId,
      engagement: {
        engagementId: ENGAGEMENT_ID, requestId: REQUEST_ID, quoteId: QUOTE_ID, providerRef: 'vendor-microstructure-alpha',
        deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, deadline: null,
        applicability: { environmentProfileRefs: [], instrumentClassRefs: [] }, status: 'verified', openedAt: T0 + 1800,
        tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT,
      },
      verificationReport: {
        reportId: REPORT_ID, engagementId: ENGAGEMENT_ID, deliverableId: DELIVERABLE_ID, verdict: 'verified',
        outcomes: FIXTURE_VERIFICATION.map((requirement) => ({ requirementRef: (requirement as { requirementRef: string }).requirementRef, passed: true, detail: 'met' })),
        verifiedAt: T0 + 6000, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT,
      },
      deliverable: {
        deliverableId: DELIVERABLE_ID, engagementId: ENGAGEMENT_ID, kind: 'capability-artifact',
        claims: [{ claimRef: 'claim-x', capabilityKey: 'liquidity-regime-analysis', measuredEvidence: [{ kind: 'result-ref', resultRef: 'res://x' }] }],
        payload: { artifact: 'x' }, payloadDigest: PAYLOAD_DIGEST, submittedAt: T0 + 5000,
        tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT,
      },
      settledAt: T0 + 8000,
    });
    expect(settled.ok).toBe(false); // the foreign ledger's tenant gate refuses the charge
    if (!settled.ok) expect(settled.errors[0].code).toBe('cross_tenant_access');
    // The marketplace state is unchanged by the refused settlement.
    expect(verifyMarketplaceChain(bound.value.state).ok).toBe(true);
  });

  it('a commission never cites a foreign marketplace (the minter reads only the scoped catalog)', () => {
    const state = fixtureListing();
    if (!state.ok) throw new Error('unreachable');
    const listingRef = [...state.value.listingsBySlot.keys()][0] as string;
    const commissioned = commissionCapabilityRequest(state.value, {
      listingRef,
      deliverableKind: 'capability-artifact',
      gapRefs: [FIXTURE_GAP_ID],
      evidenceRefs: [],
      verification: FIXTURE_VERIFICATION,
      deadline: null,
      offeredConsideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '500' },
      requestedAt: T0 + 2000,
    });
    if (!commissioned.ok) throw new Error('unreachable');
    expect(commissioned.value.draft.tenantId).toBe(FIXTURE_TENANT); // the draft rides THIS marketplace's scope
  });

  it('retire + void stay scoped (unknown ids in a foreign marketplace are the typed unknowns)', () => {
    const state = fixtureListing();
    if (!state.ok) throw new Error('unreachable');
    const retire = retireListing(state.value, { listingRef: 'ml:0123456789abcdef', retiredAt: T0 + 3000 });
    expect(retire.ok).toBe(false);
    if (!retire.ok) expect(retire.errors[0].code).toBe('listing_unknown');
    const voided = voidPurchase(state.value, { purchaseId: 'po:0123456789abcdef', voidedAt: T0 + 3000 });
    expect(voided.ok).toBe(false);
    if (!voided.ok) expect(voided.errors[0].code).toBe('purchase_unknown');
  });
});
