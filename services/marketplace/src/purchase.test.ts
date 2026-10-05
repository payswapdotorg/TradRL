// @tradrl/marketplace-service — the PURCHASE tests: the commercial
// half of the engagement lifecycle — the binding laws, the budget and
// listing-price laws, the closed lifecycle table, THE PAYMENT GATE
// (verified charges; rejected and withdrawn never do), the exact
// metered arithmetic, and the artifact license.

import { describe, expect, it } from 'vitest';
import {
  bindEngagement,
  createEntitlementLedger,
  createMarketplace,
  entitlementSnapshot,
  isSettlement,
  issueEntitlementGrant,
  licenseCoversImport,
  openPurchase,
  PURCHASE_TRANSITIONS,
  publishListing,
  retireListing,
  settlePurchase,
  stableDigestJson,
  verifyMarketplaceChain,
  voidPurchase,
} from './index';
import type { EntitlementLedgerState, MarketplaceState } from './index';
import { FIXTURE_PROJECT, FIXTURE_TENANT, FIXTURE_VERIFICATION, T0, validDeclaration } from './fixtures';

// ---------------------------------------------------------------------------
// Hand-crafted T045-shaped records (well-formed ids; the REAL exchange
// mints the real ones — the interop test drives those end-to-end).
// ---------------------------------------------------------------------------

const REQUEST_ID = `cpr:${stableDigestJson({ fixture: 'request' })}`;
const QUOTE_ID = `qte:${stableDigestJson({ fixture: 'quote' })}`;
const ENGAGEMENT_ID = `eng:${stableDigestJson({ fixture: 'engagement' })}`;
const DELIVERABLE_ID = `dlv:${stableDigestJson({ fixture: 'deliverable' })}`;
const REPORT_ID = `vrf:${stableDigestJson({ fixture: 'report' })}`;
const PAYLOAD_DIGEST = stableDigestJson({ fixture: 'payload' });

/** A valid request mirror with the offered fixed-fee budget at the list price. */
function requestMirror(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: REQUEST_ID,
    requestedCapability: 'liquidity-regime-analysis',
    summary: 'Liquidity-regime analysis of the stress window',
    deliverableKind: 'capability-artifact',
    gapRefs: ['gap-liquidity-0042'],
    evidenceRefs: ['evi://capsule-321'],
    verification: FIXTURE_VERIFICATION,
    deadline: T0 + 86_400_000,
    consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' },
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    requestedAt: T0 + 2000,
    ...overrides,
  };
}

/** A valid quote mirror countering AT the offered budget (the list price). */
function quoteMirror(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    quoteId: QUOTE_ID,
    requestId: REQUEST_ID,
    providerRef: 'vendor-microstructure-alpha',
    offerRef: 'offer-liquidity-analysis',
    terms: {
      deliverableKind: 'capability-artifact',
      verification: FIXTURE_VERIFICATION,
      consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' },
      estimatedDeliveryAt: T0 + 5000,
    },
    quotedAt: T0 + 3000,
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    ...overrides,
  };
}

/** A valid engagement mirror (the T045 record the commercial half tracks). */
function engagementMirror(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    engagementId: ENGAGEMENT_ID,
    requestId: REQUEST_ID,
    quoteId: QUOTE_ID,
    providerRef: 'vendor-microstructure-alpha',
    deliverableKind: 'capability-artifact',
    verification: FIXTURE_VERIFICATION,
    deadline: T0 + 86_400_000,
    applicability: { environmentProfileRefs: ['env://stress-windows'], instrumentClassRefs: ['class://us-equities'] },
    status: 'open',
    openedAt: T0 + 4000,
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    ...overrides,
  };
}

/** A verified report over the fixture contract (all outcomes passed). */
function verifiedReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reportId: REPORT_ID,
    engagementId: ENGAGEMENT_ID,
    deliverableId: DELIVERABLE_ID,
    verdict: 'verified',
    outcomes: FIXTURE_VERIFICATION.map((requirement) => ({ requirementRef: (requirement as { requirementRef: string }).requirementRef, passed: true, detail: 'met' })),
    verifiedAt: T0 + 7000,
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    ...overrides,
  };
}

/** A deliverable mirror with a verified-artifact claim (L16a evidence included). */
function deliverableMirror(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deliverableId: DELIVERABLE_ID,
    engagementId: ENGAGEMENT_ID,
    kind: 'capability-artifact',
    claims: [
      {
        claimRef: 'claim-liquidity-model',
        capabilityKey: 'liquidity-regime-analysis',
        measuredEvidence: [{ kind: 'benchmark', benchmarkId: 'bench-microstructure-42', resultRef: 'res://bench-run-0091' }],
      },
    ],
    payload: { artifact: 'liquidity-regime-model-v3' },
    payloadDigest: PAYLOAD_DIGEST,
    submittedAt: T0 + 6000,
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    ...overrides,
  };
}

/** The fixture marketplace with the listing published, plus a funded entitlements ledger. */
function setup(): { marketplace: MarketplaceState; entitlements: EntitlementLedgerState; listingRef: string } {
  const market = createMarketplace(FIXTURE_TENANT);
  if (!market.ok) throw new Error('unreachable');
  const published = publishListing(market.value, {
    declaration: validDeclaration(),
    offerRef: 'offer-liquidity-analysis',
    pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' },
    listedAt: T0 + 1000,
  });
  if (!published.ok) throw new Error(`unreachable: ${published.errors.map((e) => e.message).join('; ')}`);
  const ledger = createEntitlementLedger(FIXTURE_TENANT);
  if (!ledger.ok) throw new Error('unreachable');
  const funded = requireFunded(ledger.value);
  return { marketplace: published.value.state, entitlements: funded, listingRef: published.value.record.listingRef };
}

function requireFunded(ledger: EntitlementLedgerState, amount = '50000'): EntitlementLedgerState {
  const issued = issueEntitlementGrant(ledger, {
    tenantId: FIXTURE_TENANT,
    projectId: null,
    kind: 'spend-allowance',
    terms: { kind: 'spend-allowance', currency: 'usd-cents', amount },
    version: 1,
    supersedes: null,
    sourceRef: 'plan://operator/marketplace-test',
    issuedAt: T0,
    effectiveFrom: T0,
    effectiveUntil: null,
  });
  if (!issued.ok) throw new Error(`unreachable: ${issued.errors.map((e) => e.message).join('; ')}`);
  return issued.value.state;
}

/** Opens + binds a purchase (the settlement tests' base). */
function engagedPurchase() {
  const { marketplace, entitlements, listingRef } = setup();
  const opened = openPurchase(marketplace, { listingRef, request: requestMirror(), quote: quoteMirror(), openedAt: T0 + 3500 });
  if (!opened.ok) throw new Error(`unreachable: ${opened.errors.map((e) => e.message).join('; ')}`);
  const bound = bindEngagement(opened.value.state, { purchaseId: opened.value.record.purchaseId, engagement: engagementMirror(), engagedAt: T0 + 4500 });
  if (!bound.ok) throw new Error(`unreachable: ${bound.errors.map((e) => e.message).join('; ')}`);
  return { marketplace: bound.value.state, entitlements, purchaseId: opened.value.record.purchaseId, listingRef };
}

// ---------------------------------------------------------------------------
// The binding + negotiation laws
// ---------------------------------------------------------------------------

describe('openPurchase (the binding + negotiation laws)', () => {
  it('binds (listing, request, quote) under the agreed consideration at the list price', () => {
    const { marketplace, listingRef } = setup();
    const opened = openPurchase(marketplace, { listingRef, request: requestMirror(), quote: quoteMirror(), openedAt: T0 + 3500 });
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      const purchase = opened.value.record;
      expect(purchase.purchaseId).toMatch(/^po:[0-9a-f]{16}$/);
      expect(purchase.status).toBe('open');
      expect(purchase.agreedConsideration).toEqual({ kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' });
      expect(purchase.engagementId).toBeNull();
      expect(opened.value.state.log.at(-1)?.kind).toBe('purchase-opened');
    }
  });

  it('THE BUDGET LAW: a counter above the offered budget is the typed refusal', () => {
    const { marketplace, listingRef } = setup();
    const opened = openPurchase(marketplace, {
      listingRef,
      request: requestMirror(),
      quote: quoteMirror({ terms: { deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.51' }, estimatedDeliveryAt: T0 + 5000 } }),
      openedAt: T0 + 3500,
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.errors[0].code).toBe('consideration_exceeds_budget');
  });

  it('THE LISTING-PRICE LAW: a counter above the LIST price is refused even within the budget', () => {
    const { marketplace, listingRef } = setup();
    const opened = openPurchase(marketplace, {
      listingRef,
      request: requestMirror({ consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '99999' } }),
      quote: quoteMirror({ terms: { deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '20000' }, estimatedDeliveryAt: T0 + 5000 } }),
      openedAt: T0 + 3500,
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.errors[0].code).toBe('listing_mismatch');
  });

  it('a pricing-model change between offer and counter is the typed incomparability', () => {
    const { marketplace, listingRef } = setup();
    const opened = openPurchase(marketplace, {
      listingRef,
      request: requestMirror(),
      quote: quoteMirror({ terms: { deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, consideration: { kind: 'usage-metered', currency: 'usd-cents', rate: '1', unit: 'per-annotation' }, estimatedDeliveryAt: T0 + 5000 } }),
      openedAt: T0 + 3500,
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.errors[0].code).toBe('consideration_incomparable');
  });

  it('a quote not answering its request, or a foreign slot, is the typed mismatch', () => {
    const { marketplace, listingRef } = setup();
    const wrongRequest = openPurchase(marketplace, { listingRef, request: requestMirror({ requestId: `cpr:${stableDigestJson({ other: 1 })}` }), quote: quoteMirror(), openedAt: T0 + 3500 });
    expect(wrongRequest.ok).toBe(false);
    if (!wrongRequest.ok) expect(wrongRequest.errors[0].code).toBe('purchase_mismatch');
    const wrongSlot = openPurchase(marketplace, { listingRef: 'ml:0123456789abcdef', request: requestMirror(), quote: quoteMirror(), openedAt: T0 + 3500 });
    expect(wrongSlot.ok).toBe(false);
    if (!wrongSlot.ok) expect(wrongSlot.errors[0].code).toBe('listing_unknown');
  });

  it('the freeze law (composed): a quote with a moved goalpost is refused', () => {
    const { marketplace, listingRef } = setup();
    const movedGoalposts = [{ kind: 'local-evaluation', requirementRef: 'local-eval', evaluationRef: 'eval://suite-DIFFERENT' }];
    const opened = openPurchase(marketplace, {
      listingRef,
      request: requestMirror(),
      quote: quoteMirror({ terms: { deliverableKind: 'capability-artifact', verification: movedGoalposts, consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' }, estimatedDeliveryAt: T0 + 5000 } }),
      openedAt: T0 + 3500,
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.errors[0].code).toBe('purchase_mismatch');
  });

  it('ONE LIVE PURCHASE PER REQUEST (the commercial mirror of T045\'s engagement law)', () => {
    const { marketplace, listingRef } = setup();
    const first = openPurchase(marketplace, { listingRef, request: requestMirror(), quote: quoteMirror(), openedAt: T0 + 3500 });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    // A second purchase on the same request while the first is live: refused.
    const second = openPurchase(first.value.state, {
      listingRef,
      request: requestMirror(),
      quote: quoteMirror({ quoteId: `qte:${stableDigestJson({ fixture: 'quote-2' })}`, quotedAt: T0 + 3600 }),
      openedAt: T0 + 3700,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.errors[0].code).toBe('purchase_exists');
  });

  it('L12: a foreign request or quote never crosses the boundary', () => {
    const { marketplace, listingRef } = setup();
    const foreignRequest = openPurchase(marketplace, { listingRef, request: requestMirror({ tenantId: 'tenant-other' }), quote: quoteMirror({ tenantId: 'tenant-other' }), openedAt: T0 + 3500 });
    expect(foreignRequest.ok).toBe(false);
    if (!foreignRequest.ok) expect(foreignRequest.errors[0].code).toBe('cross_tenant_access');
  });

  it('the retirement gate: a retired slot never trades', () => {
    const { marketplace, listingRef } = setup();
    const retired = retireListing(marketplace, { listingRef, retiredAt: T0 + 3400 });
    expect(retired.ok).toBe(true);
    if (!retired.ok) throw new Error('unreachable');
    const opened = openPurchase(retired.value.state, { listingRef, request: requestMirror(), quote: quoteMirror(), openedAt: T0 + 3500 });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.errors[0].code).toBe('listing_retired');
  });
});

// ---------------------------------------------------------------------------
// The lifecycle table + the settlement (THE PAYMENT GATE)
// ---------------------------------------------------------------------------

describe('the closed lifecycle table', () => {
  it('is pinned', () => {
    expect(PURCHASE_TRANSITIONS).toEqual({
      open: ['engaged', 'voided'],
      engaged: ['settled'],
      settled: [],
      voided: [],
    });
  });

  it('an engaged purchase never voids; a settled purchase never settles again', () => {
    const { marketplace, purchaseId } = engagedPurchase();
    const voided = voidPurchase(marketplace, { purchaseId, voidedAt: T0 + 5000 });
    expect(voided.ok).toBe(false);
    if (!voided.ok) expect(voided.errors[0].code).toBe('invalid_transition');
    const settled = settlePurchase(marketplace, marketplace_entitlements_of(purchaseId), {
      purchaseId,
      engagement: engagementMirror({ status: 'withdrawn' }),
      settledAt: T0 + 8000,
    });
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error('unreachable');
    const again = settlePurchase(settled.value.marketplace, settled.value.entitlements, {
      purchaseId,
      engagement: engagementMirror({ status: 'withdrawn' }),
      settledAt: T0 + 9000,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors[0].code).toBe('invalid_transition');
  });
});

// (A tiny helper so the lifecycle test reads linearly: the engaged
// purchase's own entitlements state rides along.)
function marketplace_entitlements_of(_purchaseId: string): EntitlementLedgerState {
  const ledger = createEntitlementLedger(FIXTURE_TENANT);
  if (!ledger.ok) throw new Error('unreachable');
  return requireFunded(ledger.value);
}
describe('THE PAYMENT GATE (settlePurchase)', () => {
  it('a VERIFIED engagement charges the exact consideration and mints the artifact license', () => {
    const { marketplace, entitlements, purchaseId } = engagedPurchase();
    const settled = settlePurchase(marketplace, entitlements, {
      purchaseId,
      engagement: engagementMirror({ status: 'verified' }),
      verificationReport: verifiedReport(),
      deliverable: deliverableMirror(),
      settledAt: T0 + 8000,
    });
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(`unreachable: ${settled.errors.map((e) => e.message).join('; ')}`);
    const { settlement, purchase, licenseGrant, entitlements: after } = settled.value;
    expect(settlement.outcome).toBe('charged');
    expect(settlement.charge).toBe('12500.50');
    expect(settlement.currency).toBe('usd-cents');
    expect(settlement.consumptionId).toMatch(/^cns:[0-9a-f]{16}$/);
    expect(settlement.licenseGrantId).toMatch(/^eg:[0-9a-f]{16}$/);
    expect(settlement.verificationReportId).toBe(REPORT_ID);
    expect(purchase.status).toBe('settled');
    expect(isSettlement(settlement)).toBe(true);
    // The entitlements side: the spend allowance was drawn exactly. The
    // running SUM is in the kernel's canonical form (trailing zeros
    // normalized: 12500.50 + 0 -> 12500.5).
    const snapshot = entitlementSnapshotOf(after);
    const spend = snapshot.find((entry) => entry.grant.kind === 'spend-allowance');
    expect(spend?.consumed).toBe('12500.5');
    expect(spend?.remaining).toBe('37499.5');
    // The license names the deliverable's content-addressed artifact.
    const license = snapshot.find((entry) => entry.grant.kind === 'artifact-license');
    expect(license).toBeDefined();
    const licenseTerms = (license as unknown as { grant: { terms: { artifactRef: string; usageScope: string } } }).grant.terms;
    expect(licenseTerms.artifactRef).toBe(`cpa:${stableDigestJson({ deliverableId: DELIVERABLE_ID, payloadDigest: PAYLOAD_DIGEST })}`);
    expect(licenseTerms.usageScope).toBe('project');
    expect(licenseGrant).not.toBeNull();
    // The whole marketplace chain stays green.
    expect(verifyMarketplaceChain(settled.value.marketplace).ok).toBe(true);
  });

  it('a REJECTED engagement NEVER charges (never pay for rejected work)', () => {
    const { marketplace, entitlements, purchaseId } = engagedPurchase();
    const settled = settlePurchase(marketplace, entitlements, {
      purchaseId,
      engagement: engagementMirror({ status: 'rejected' }),
      verificationReport: verifiedReport({ verdict: 'rejected', outcomes: FIXTURE_VERIFICATION.map((requirement) => ({ requirementRef: (requirement as { requirementRef: string }).requirementRef, passed: false, detail: 'missed' })) }),
      settledAt: T0 + 8000,
    });
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error('unreachable');
    expect(settled.value.settlement.outcome).toBe('no-charge');
    expect(settled.value.settlement.charge).toBe('0');
    expect(settled.value.settlement.consumptionId).toBeNull();
    expect(settled.value.settlement.licenseGrantId).toBeNull();
  });

  it('a WITHDRAWN engagement never charges (no report required)', () => {
    const { marketplace, entitlements, purchaseId } = engagedPurchase();
    const settled = settlePurchase(marketplace, entitlements, {
      purchaseId,
      engagement: engagementMirror({ status: 'withdrawn' }),
      settledAt: T0 + 8000,
    });
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error('unreachable');
    expect(settled.value.settlement.outcome).toBe('no-charge');
  });

  it('settling a LIVE engagement is the typed invalid_transition; a missing report is verification_missing', () => {
    const { marketplace, entitlements, purchaseId } = engagedPurchase();
    const live = settlePurchase(marketplace, entitlements, { purchaseId, engagement: engagementMirror({ status: 'delivered' }), settledAt: T0 + 8000 });
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.errors[0].code).toBe('invalid_transition');
    const noReport = settlePurchase(marketplace, entitlements, { purchaseId, engagement: engagementMirror({ status: 'verified' }), settledAt: T0 + 8000 });
    expect(noReport.ok).toBe(false);
    if (!noReport.ok) expect(noReport.errors[0].code).toBe('verification_missing');
  });

  it('a report disagreeing with the engagement is the typed mismatch', () => {
    const { marketplace, entitlements, purchaseId } = engagedPurchase();
    const wrongEngagement = settlePurchase(marketplace, entitlements, {
      purchaseId,
      engagement: engagementMirror({ status: 'verified' }),
      verificationReport: verifiedReport({ engagementId: `eng:${stableDigestJson({ fixture: 'other-engagement' })}` }),
      deliverable: deliverableMirror(),
      settledAt: T0 + 8000,
    });
    expect(wrongEngagement.ok).toBe(false);
    if (!wrongEngagement.ok) expect(wrongEngagement.errors[0].code).toBe('purchase_mismatch');
    const verdictMismatch = settlePurchase(marketplace, entitlements, {
      purchaseId,
      engagement: engagementMirror({ status: 'verified' }),
      verificationReport: verifiedReport({ verdict: 'rejected' }),
      settledAt: T0 + 8000,
    });
    expect(verdictMismatch.ok).toBe(false);
    if (!verdictMismatch.ok) expect(verdictMismatch.errors[0].code).toBe('purchase_mismatch');
  });

  it('usage-metered purchases charge rate x usage EXACTLY', () => {
    // A metered listing at 12.5 per annotation; the offer budgets the same rate.
    const market = createMarketplace(FIXTURE_TENANT);
    if (!market.ok) throw new Error('unreachable');
    const published = publishListing(market.value, {
      declaration: validDeclaration(),
      offerRef: 'offer-liquidity-analysis',
      pricing: { kind: 'usage-metered', currency: 'usd-cents', rate: '12.5', unit: 'per-annotation' },
      listedAt: T0 + 1000,
    });
    if (!published.ok) throw new Error('unreachable');
    const ledger = createEntitlementLedger(FIXTURE_TENANT);
    if (!ledger.ok) throw new Error('unreachable');
    const entitlements = requireFunded(ledger.value);
    const opened = openPurchase(published.value.state, {
      listingRef: published.value.record.listingRef,
      request: requestMirror({ consideration: { kind: 'usage-metered', currency: 'usd-cents', rate: '12.5', unit: 'per-annotation' } }),
      quote: quoteMirror({ terms: { deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, consideration: { kind: 'usage-metered', currency: 'usd-cents', rate: '12.5', unit: 'per-annotation' }, estimatedDeliveryAt: T0 + 5000 } }),
      openedAt: T0 + 3500,
    });
    if (!opened.ok) throw new Error(`unreachable: ${opened.errors.map((e) => e.message).join('; ')}`);
    const bound = bindEngagement(opened.value.state, { purchaseId: opened.value.record.purchaseId, engagement: engagementMirror(), engagedAt: T0 + 4500 });
    if (!bound.ok) throw new Error('unreachable');
    const noUsage = settlePurchase(bound.value.state, entitlements, { purchaseId: opened.value.record.purchaseId, engagement: engagementMirror({ status: 'verified' }), verificationReport: verifiedReport(), deliverable: deliverableMirror(), settledAt: T0 + 8000 });
    expect(noUsage.ok).toBe(false);
    if (!noUsage.ok) expect(noUsage.errors[0].code).toBe('usage_missing');
    const settled = settlePurchase(bound.value.state, entitlements, { purchaseId: opened.value.record.purchaseId, engagement: engagementMirror({ status: 'verified' }), verificationReport: verifiedReport(), deliverable: deliverableMirror(), usageUnits: '800', settledAt: T0 + 8000 });
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error('unreachable');
    expect(settled.value.settlement.charge).toBe('10000'); // 12.5 x 800, exact
    expect(settled.value.settlement.usageUnits).toBe('800');
  });

  it('THE EXHAUSTION GATE: a charge the allowance cannot cover is the typed refusal (L20)', () => {
    const market = createMarketplace(FIXTURE_TENANT);
    if (!market.ok) throw new Error('unreachable');
    // A listing priced far above the funded allowance.
    const published = publishListing(market.value, {
      declaration: validDeclaration(),
      offerRef: 'offer-liquidity-analysis',
      pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '99999' },
      listedAt: T0 + 1000,
    });
    if (!published.ok) throw new Error('unreachable');
    const ledger = createEntitlementLedger(FIXTURE_TENANT);
    if (!ledger.ok) throw new Error('unreachable');
    const small = requireFunded(ledger.value, '500');
    const opened = openPurchase(published.value.state, {
      listingRef: published.value.record.listingRef,
      request: requestMirror({ consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '99999' } }),
      quote: quoteMirror({ terms: { deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '99999' }, estimatedDeliveryAt: T0 + 5000 } }),
      openedAt: T0 + 3500,
    });
    if (!opened.ok) throw new Error(`unreachable: ${opened.errors.map((e) => e.message).join('; ')}`);
    const bound = bindEngagement(opened.value.state, { purchaseId: opened.value.record.purchaseId, engagement: engagementMirror(), engagedAt: T0 + 4500 });
    if (!bound.ok) throw new Error('unreachable');
    const settled = settlePurchase(bound.value.state, small, { purchaseId: opened.value.record.purchaseId, engagement: engagementMirror({ status: 'verified' }), verificationReport: verifiedReport(), deliverable: deliverableMirror(), settledAt: T0 + 8000 });
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.errors[0].code).toBe('entitlement_exhausted');
    // The marketplace state is UNCHANGED by the refused settlement.
    expect(settled.ok ? null : bound.value.state.purchases.get(opened.value.record.purchaseId)?.status).toBe('engaged');
  });

  it('content-addressed idempotence: an identical settlement replays without re-charging', () => {
    const { marketplace, entitlements, purchaseId } = engagedPurchase();
    const first = settlePurchase(marketplace, entitlements, { purchaseId, engagement: engagementMirror({ status: 'verified' }), verificationReport: verifiedReport(), deliverable: deliverableMirror(), settledAt: T0 + 8000 });
    expect(first.ok && first.value.replayed).toBe(false);
    if (!first.ok) throw new Error('unreachable');
    const second = settlePurchase(first.value.marketplace, first.value.entitlements, { purchaseId, engagement: engagementMirror({ status: 'verified' }), verificationReport: verifiedReport(), deliverable: deliverableMirror(), settledAt: T0 + 8000 });
    expect(second.ok && second.value.replayed).toBe(true);
    if (second.ok) {
      expect(second.value.settlement.settlementId).toBe(first.value.settlement.settlementId);
      // The spend was drawn EXACTLY ONCE (the snapshot proves it).
      const snapshot = entitlementSnapshotOf(second.value.entitlements);
      const spend = snapshot.find((entry) => entry.grant.kind === 'spend-allowance');
      expect(spend?.consumed).toBe('12500.5'); // the canonical running sum (12500.50 drawn exactly once)
    }
  });

  it('voidPurchase exits an open purchase (the pre-engagement exit)', () => {
    const { marketplace, listingRef } = setup();
    const opened = openPurchase(marketplace, { listingRef, request: requestMirror(), quote: quoteMirror(), openedAt: T0 + 3500 });
    if (!opened.ok) throw new Error('unreachable');
    const voided = voidPurchase(opened.value.state, { purchaseId: opened.value.record.purchaseId, voidedAt: T0 + 5000 });
    expect(voided.ok).toBe(true);
    if (voided.ok) expect(voided.value.record.status).toBe('voided');
    // A voided purchase never opens again on the same request (new purchase allowed).
    const reopened = openPurchase(voided.value.state, {
      listingRef,
      request: requestMirror(),
      quote: quoteMirror({ quoteId: `qte:${stableDigestJson({ fixture: 'quote-after-void' })}`, quotedAt: T0 + 6000 }),
      openedAt: T0 + 7000,
    });
    expect(reopened.ok).toBe(true);
  });
});

describe('licenseCoversImport (the L18 import path\'s gate)', () => {
  it('covers the same artifact in the same tenant under the license\'s scope', () => {
    const artifactRef = `cpa:${stableDigestJson({ deliverableId: DELIVERABLE_ID, payloadDigest: PAYLOAD_DIGEST })}`;
    const license = {
      grantId: 'eg:0123456789abcdef',
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      kind: 'artifact-license' as const,
      terms: { kind: 'artifact-license' as const, artifactRef, usageScope: 'project' as const },
    };
    expect(licenseCoversImport(license, { artifactRef, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT })).toBe(true);
    // A foreign artifact is not licensed.
    expect(licenseCoversImport(license, { artifactRef: 'cpa:ffffffffffffffff', tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT })).toBe(false);
    // A foreign tenant is not licensed (L12).
    expect(licenseCoversImport(license, { artifactRef, tenantId: 'tenant-other', projectId: FIXTURE_PROJECT })).toBe(false);
    // A project license covers exactly its project.
    expect(licenseCoversImport(license, { artifactRef, tenantId: FIXTURE_TENANT, projectId: 'prj-other' })).toBe(false);
    // A tenant-wide license covers every project.
    const tenantWide = { ...license, projectId: null, terms: { ...license.terms, usageScope: 'tenant' as const } };
    expect(licenseCoversImport(tenantWide, { artifactRef, tenantId: FIXTURE_TENANT, projectId: 'prj-other' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Local helpers (entitlements snapshot access for the assertions)
// ---------------------------------------------------------------------------

function entitlementSnapshotOf(state: EntitlementLedgerState): { grant: { kind: string; terms: unknown }; consumed: string; remaining: string | null }[] {
  const snapshot = entitlementSnapshot(state, T0 + 10_000);
  if (!snapshot.ok) throw new Error(`unreachable: ${snapshot.errors.map((e) => e.message).join('; ')}`);
  return snapshot.value.entries as unknown as { grant: { kind: string; terms: unknown }; consumed: string; remaining: string | null }[];
}
