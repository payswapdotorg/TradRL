// Cross-lane interoperability trip wires for the marketplace service
// (Work Order T047): the REAL lanes this service consumes ONLY through
// its STRUCTURAL MIRRORS (plus its OWN contract package) are loaded
// STATICALLY here (the tests are the trip wires — the src lane imports
// none of them):
//
//   - packages/capability-provider (T045 — THE EXCHANGE THIS LANE
//     BUILDS THE COMMERCIAL HALF ON): the REAL mint of the fixture's
//     declaration is pinned byte-for-byte; then THE COMPOSITION LAW is
//     driven END-TO-END over the REAL exchange — the REAL declaration
//     registers, the marketplace publishes its listing FROM the
//     retained REAL record, the commissioned request draft is accepted
//     by the REAL `issueCapabilityRequest`, the REAL quote + engagement
//     + deliverable + verification flow through the REAL exchange ops,
//     the marketplace binds + settles THE REAL RECORDS (the payment
//     gate charges the REAL entitlements ledger), and the settlement's
//     artifact license names EXACTLY the artifact the REAL L18 import
//     path (`importAsSkillRecordDraft`) carries — `licenseCoversImport`
//     composes the two lanes' outputs.
//   - packages/skills (T017): the REAL `stableDigest` agrees with this
//     lane's re-exported fold (the program-wide digest law).
//   - packages/sdk (T041): the REAL `deriveIdempotencyKey` agrees with
//     the mirror derivation byte-for-byte; the REAL SDK error-family
//     vocabulary matches the mirror.
//
// The marketplace's runtime src imports NONE of these lanes (D-003/
// D-004): it imports only its OWN contract package
// (@tradrl/entitlements) via imports.ts, and every other lane's shapes
// live in mirrors.ts.

import { describe, expect, it } from 'vitest';

// --- The REAL lanes (test-only; this lane's src imports NONE of them) --------
import * as capabilityProvider from '../../../packages/capability-provider/src/index';
import * as skills from '../../../packages/skills/src/index';
import * as sdk from '../../../packages/sdk/src/index';

// --- This lane -----------------------------------------------------------------
import {
  bindEngagement,
  commissionCapabilityRequest,
  createEntitlementLedger,
  createMarketplace,
  deriveIdempotencyKeyMirror,
  entitlementSnapshot,
  isCapabilityRequestMirror,
  isEngagementMirror,
  isProviderQuoteMirror,
  isProviderVerificationReportMirror,
  issueEntitlementGrant,
  licenseCoversImport,
  licensedArtifactRef,
  openPurchase,
  publishListing,
  SDK_ERROR_FAMILIES_MIRROR,
  settlePurchase,
  stableDigest,
  verifyMarketplaceChain,
} from './index';
import type { EntitlementLedgerState, LicenseGrantView, MarketplaceState } from './index';
import { FIXTURE_GAP_ID, FIXTURE_PROJECT, FIXTURE_TENANT, FIXTURE_VERIFICATION, T0, validDeclaration, validDeclarationDraft } from './fixtures';
import { stableDigestJson } from './imports';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL T045 CapabilityRequest IS this lane's mirror. */
function realRequestSatisfiesMirror(request: capabilityProvider.CapabilityRequest): ReturnType<typeof isCapabilityRequestMirror> {
  return request;
}
void realRequestSatisfiesMirror;

/** Compiles iff the REAL T045 ProviderQuote IS this lane's mirror. */
function realQuoteSatisfiesMirror(quote: capabilityProvider.ProviderQuote): ReturnType<typeof isProviderQuoteMirror> {
  return quote;
}
void realQuoteSatisfiesMirror;

/** Compiles iff the REAL T045 Engagement IS this lane's mirror. */
function realEngagementSatisfiesMirror(engagement: capabilityProvider.Engagement): ReturnType<typeof isEngagementMirror> {
  return engagement;
}
void realEngagementSatisfiesMirror;

// ---------------------------------------------------------------------------
// The REAL T045 declaration mint (the fixture's pin)
// ---------------------------------------------------------------------------

describe('the REAL T045 declaration lane', () => {
  it('the REAL validateProviderDeclaration accepts the fixture draft and mints EXACTLY the fixture\'s minted record', () => {
    const minted = capabilityProvider.validateProviderDeclaration(validDeclarationDraft());
    expect(minted.ok).toBe(true);
    if (!minted.ok) throw new Error('unreachable');
    // Byte-parity: the fixture's validDeclaration() IS the REAL mint.
    expect(minted.value).toEqual(validDeclaration());
    expect(minted.value.declarationId).toBe((validDeclaration() as { declarationId: string }).declarationId);
    // The marketplace publishes listings FROM the REAL retained record.
    const market = createMarketplace(FIXTURE_TENANT);
    if (!market.ok) throw new Error('unreachable');
    const published = publishListing(market.value, {
      declaration: minted.value,
      offerRef: 'offer-liquidity-analysis',
      pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' },
      listedAt: T0 + 1000,
    });
    expect(published.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// THE COMPOSITION LAW: the REAL T045 exchange drives the marketplace's
// commercial half end-to-end (declaration -> listing -> commission ->
// request -> quote -> engagement -> deliverable -> verification ->
// purchase -> binding -> THE PAYMENT GATE -> the artifact license).
// ---------------------------------------------------------------------------

describe('the REAL T045 exchange composed with the marketplace (end to end)', () => {
  it('the full commercial lifecycle over the REAL exchange records, charging the REAL entitlements ledger', () => {
    // --- The REAL exchange, in the fixture tenant (L12). ----------------------
    const exchange = capabilityProvider.createProviderExchange(FIXTURE_TENANT);
    if (!exchange.ok) throw new Error(`unreachable: ${exchange.errors.map((e) => e.message).join('; ')}`);
    let providerState = exchange.value;

    // 1. The provider registers its declaration (the REAL mint).
    const registered = capabilityProvider.registerProviderDeclaration(providerState, validDeclarationDraft());
    if (!registered.ok) throw new Error(`unreachable: ${registered.errors.map((e) => e.message).join('; ')}`);
    providerState = registered.value.state;
    const declaration = registered.value.record;

    // 2. The marketplace publishes the listing FROM the REAL retained record.
    const market = createMarketplace(FIXTURE_TENANT);
    if (!market.ok) throw new Error('unreachable');
    const published = publishListing(market.value, {
      declaration,
      offerRef: 'offer-liquidity-analysis',
      pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' },
      listedAt: T0 + 1000,
    });
    if (!published.ok) throw new Error(`unreachable: ${published.errors.map((e) => e.message).join('; ')}`);
    let marketplace: MarketplaceState = published.value.state;
    const listingRef = published.value.record.listingRef;

    // 3. The commission mints the T045-shaped request draft (cited by the gap).
    const commissioned = commissionCapabilityRequest(marketplace, {
      listingRef,
      deliverableKind: 'capability-artifact',
      gapRefs: [FIXTURE_GAP_ID],
      evidenceRefs: ['evi://capsule-321'],
      verification: FIXTURE_VERIFICATION,
      deadline: T0 + 86_400_000,
      offeredConsideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' },
      requestedAt: T0 + 2000,
    });
    if (!commissioned.ok) throw new Error(`unreachable: ${commissioned.errors.map((e) => e.message).join('; ')}`);

    // 4. The REAL exchange accepts the commissioned draft (the full T045 law).
    const issued = capabilityProvider.issueCapabilityRequest(providerState, commissioned.value.draft);
    if (!issued.ok) throw new Error(`unreachable: ${issued.errors.map((e) => e.message).join('; ')}`);
    providerState = issued.value.state;
    const request = issued.value.record;
    expect(request.requestedCapability).toBe('liquidity-regime-analysis');
    expect(request.consideration).toEqual({ kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' });

    // 5. The provider quotes THROUGH the REAL exchange (the counter at the list price).
    const quoted = capabilityProvider.submitProviderQuote(providerState, {
      requestId: request.requestId,
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
    });
    if (!quoted.ok) throw new Error(`unreachable: ${quoted.errors.map((e) => e.message).join('; ')}`);
    providerState = quoted.value.state;
    const quote = quoted.value.record;

    // 6. The REAL engagement opens over (request, quote).
    const engaged = capabilityProvider.openEngagement(providerState, { requestId: request.requestId, quoteId: quote.quoteId, openedAt: T0 + 4000 });
    if (!engaged.ok) throw new Error(`unreachable: ${engaged.errors.map((e) => e.message).join('; ')}`);
    providerState = engaged.value.state;
    let engagement = engaged.value.record;

    // 7. The provider delivers (the REAL deliverable; the payload digest pins the bytes).
    const payload = { artifact: 'liquidity-regime-model-v3', model: { windows: 12, features: ['spread', 'depth'] } };
    const delivered = capabilityProvider.submitDeliverable(providerState, {
      engagementId: engagement.engagementId,
      kind: 'capability-artifact',
      claims: [
        {
          claimRef: 'claim-liquidity-model',
          capabilityKey: 'liquidity-regime-analysis',
          measuredEvidence: [
            { kind: 'benchmark', benchmarkId: 'bench-microstructure-42', resultRef: 'res://bench-run-0091' },
            { kind: 'measurement-record', recordRef: 'rec://measure-77', metric: 'benchmark-score', value: 0.87 },
          ],
        },
      ],
      payload,
      payloadDigest: stableDigestJson(payload),
      submittedAt: T0 + 6000,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
    });
    if (!delivered.ok) throw new Error(`unreachable: ${delivered.errors.map((e) => e.message).join('; ')}`);
    providerState = delivered.value.state;
    const deliverable = delivered.value.record;

    // 8. The marketplace binds the purchase to the REAL (delivered) engagement.
    const opened = openPurchase(marketplace, { listingRef, request, quote, openedAt: T0 + 3500 });
    if (!opened.ok) throw new Error(`unreachable: ${opened.errors.map((e) => e.message).join('; ')}`);
    marketplace = opened.value.state;
    expect(opened.value.record.agreedConsideration).toEqual({ kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' });
    const bound = bindEngagement(marketplace, { purchaseId: opened.value.record.purchaseId, engagement, engagedAt: T0 + 6500 });
    if (!bound.ok) throw new Error(`unreachable: ${bound.errors.map((e) => e.message).join('; ')}`);
    marketplace = bound.value.state;

    // 9. The REAL verification closes the engagement as verified.
    const outcomes = FIXTURE_VERIFICATION.map((requirement) => ({
      requirementRef: (requirement as { requirementRef: string }).requirementRef,
      passed: true,
      detail: 'the requirement is met on the retained evidence',
    }));
    const verified = capabilityProvider.verifyDeliverable(providerState, {
      engagementId: engagement.engagementId,
      deliverableId: deliverable.deliverableId,
      outcomes,
      verifiedAt: T0 + 7000,
    });
    if (!verified.ok) throw new Error(`unreachable: ${verified.errors.map((e) => e.message).join('; ')}`);
    providerState = verified.value.state;
    engagement = verified.value.record.engagement;
    const report = verified.value.record.report;
    expect(engagement.status).toBe('verified');

    // 10. THE PAYMENT GATE: the marketplace settles the REAL records, charging the REAL entitlements ledger.
    const ledger = createEntitlementLedger(FIXTURE_TENANT);
    if (!ledger.ok) throw new Error('unreachable');
    const funded = issueEntitlementGrant(ledger.value, {
      tenantId: FIXTURE_TENANT, projectId: null, kind: 'spend-allowance',
      terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '50000' },
      version: 1, supersedes: null, sourceRef: 'plan://operator/interop',
      issuedAt: T0, effectiveFrom: T0, effectiveUntil: null,
    });
    if (!funded.ok) throw new Error('unreachable');
    let entitlements: EntitlementLedgerState = funded.value.state;
    const settled = settlePurchase(marketplace, entitlements, {
      purchaseId: opened.value.record.purchaseId,
      engagement,
      verificationReport: report,
      deliverable,
      settledAt: T0 + 8000,
    });
    if (!settled.ok) throw new Error(`unreachable: ${settled.errors.map((e) => e.message).join('; ')}`);
    marketplace = settled.value.marketplace;
    entitlements = settled.value.entitlements;

    // The charge: exact, through the ledger, with the consumption record.
    expect(settled.value.settlement.outcome).toBe('charged');
    expect(settled.value.settlement.charge).toBe('12500.50');
    expect(settled.value.settlement.consumptionId).toMatch(/^cns:[0-9a-f]{16}$/);
    // The license: minted on the deliverable the report verified.
    expect(settled.value.settlement.licenseGrantId).toMatch(/^eg:[0-9a-f]{16}$/);
    // The whole marketplace chain stays green.
    expect(verifyMarketplaceChain(marketplace).ok).toBe(true);
    // The spend allowance was drawn exactly once.
    const snapshot = entitlementSnapshot(entitlements, T0 + 10_000);
    if (!snapshot.ok) throw new Error('unreachable');
    const spend = snapshot.value.entries.find((entry) => entry.grant.kind === 'spend-allowance');
    expect(spend?.consumed).toBe('12500.5'); // the kernel's canonical running sum
    expect(spend?.remaining).toBe('37499.5');

    // 11. THE LICENSE/IMPORT COMPOSITION: the settlement's license names
    // EXACTLY the artifact the REAL L18 import path carries, and covers
    // the import for the purchasing project.
    const imported = capabilityProvider.importAsSkillRecordDraft(providerState, engagement.engagementId);
    if (!imported.ok) throw new Error(`unreachable: ${imported.errors.map((e) => e.message).join('; ')}`);
    expect(imported.value.artifactRef).toBe(licensedArtifactRef(deliverable)); // byte-parity of the cpa: derivation
    const licenseEntry = snapshot.value.entries.find((entry) => entry.grant.kind === 'artifact-license');
    if (licenseEntry === undefined) throw new Error('unreachable: no license entry');
    const license: LicenseGrantView = {
      grantId: licenseEntry.grant.grantId,
      tenantId: licenseEntry.grant.tenantId,
      projectId: licenseEntry.grant.projectId,
      kind: 'artifact-license',
      terms: licenseEntry.grant.terms as LicenseGrantView['terms'],
    };
    expect(licenseCoversImport(license, { artifactRef: imported.value.artifactRef, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT })).toBe(true);
    // A foreign tenant's import is never covered (L12).
    expect(licenseCoversImport(license, { artifactRef: imported.value.artifactRef, tenantId: 'tenant-other', projectId: FIXTURE_PROJECT })).toBe(false);
  });

  it('a REJECTED REAL engagement settles at no charge (never pay for rejected work)', () => {
    const exchange = capabilityProvider.createProviderExchange(FIXTURE_TENANT);
    if (!exchange.ok) throw new Error('unreachable');
    let providerState = exchange.value;
    const registered = capabilityProvider.registerProviderDeclaration(providerState, validDeclarationDraft());
    if (!registered.ok) throw new Error('unreachable');
    providerState = registered.value.state;
    const market = createMarketplace(FIXTURE_TENANT);
    if (!market.ok) throw new Error('unreachable');
    const published = publishListing(market.value, { declaration: registered.value.record, offerRef: 'offer-liquidity-analysis', pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' }, listedAt: T0 + 1000 });
    if (!published.ok) throw new Error('unreachable');
    let marketplace = published.value.state;
    const commissioned = commissionCapabilityRequest(marketplace, {
      listingRef: published.value.record.listingRef,
      deliverableKind: 'capability-artifact',
      gapRefs: [FIXTURE_GAP_ID],
      evidenceRefs: [],
      verification: FIXTURE_VERIFICATION,
      deadline: null,
      offeredConsideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' },
      requestedAt: T0 + 2000,
    });
    if (!commissioned.ok) throw new Error('unreachable');
    const issued = capabilityProvider.issueCapabilityRequest(providerState, commissioned.value.draft);
    if (!issued.ok) throw new Error('unreachable');
    providerState = issued.value.state;
    const quoted = capabilityProvider.submitProviderQuote(providerState, {
      requestId: issued.value.record.requestId,
      providerRef: 'vendor-microstructure-alpha',
      offerRef: 'offer-liquidity-analysis',
      terms: { deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' }, estimatedDeliveryAt: null },
      quotedAt: T0 + 3000,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
    });
    if (!quoted.ok) throw new Error('unreachable');
    providerState = quoted.value.state;
    const engaged = capabilityProvider.openEngagement(providerState, { requestId: issued.value.record.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 4000 });
    if (!engaged.ok) throw new Error('unreachable');
    providerState = engaged.value.state;
    const payload = { artifact: 'rejected-model' };
    const delivered = capabilityProvider.submitDeliverable(providerState, {
      engagementId: engaged.value.record.engagementId, kind: 'capability-artifact',
      claims: [{ claimRef: 'claim-x', capabilityKey: 'liquidity-regime-analysis', measuredEvidence: [{ kind: 'result-ref', resultRef: 'res://x' }] }],
      payload, payloadDigest: stableDigestJson(payload), submittedAt: T0 + 6000, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT,
    });
    if (!delivered.ok) throw new Error('unreachable');
    providerState = delivered.value.state;
    const opened = openPurchase(marketplace, { listingRef: published.value.record.listingRef, request: issued.value.record, quote: quoted.value.record, openedAt: T0 + 3500 });
    if (!opened.ok) throw new Error('unreachable');
    marketplace = opened.value.state;
    const bound = bindEngagement(marketplace, { purchaseId: opened.value.record.purchaseId, engagement: engaged.value.record, engagedAt: T0 + 6500 });
    if (!bound.ok) throw new Error('unreachable');
    marketplace = bound.value.state;
    const rejected = capabilityProvider.verifyDeliverable(providerState, {
      engagementId: engaged.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes: FIXTURE_VERIFICATION.map((requirement) => ({ requirementRef: (requirement as { requirementRef: string }).requirementRef, passed: false, detail: 'the requirement is missed' })),
      verifiedAt: T0 + 7000,
    });
    if (!rejected.ok) throw new Error('unreachable');
    const ledger = createEntitlementLedger(FIXTURE_TENANT);
    if (!ledger.ok) throw new Error('unreachable');
    const settled = settlePurchase(marketplace, ledger.value, {
      purchaseId: opened.value.record.purchaseId,
      engagement: rejected.value.record.engagement,
      verificationReport: rejected.value.record.report,
      settledAt: T0 + 8000,
    });
    if (!settled.ok) throw new Error(`unreachable: ${settled.errors.map((e) => e.message).join('; ')}`);
    expect(settled.value.settlement.outcome).toBe('no-charge');
    expect(settled.value.settlement.charge).toBe('0');
    expect(settled.value.settlement.consumptionId).toBeNull();
    expect(settled.value.settlement.licenseGrantId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The parity trip wires (the program-wide folds + the SDK surface)
// ---------------------------------------------------------------------------

describe('the program-wide parity trip wires', () => {
  it('the REAL skills stableDigest agrees with this lane\'s fold (incl. non-ASCII + astral vectors)', () => {
    for (const vector of ['', 'marketplace', '{"amount":"1250.75","currency":"usd-cents"}', 'liquidity-régime-分析', '𝔘𝔫𝔦𝔠𝔬𝔡𝔢 astral plane']) {
      expect(stableDigest(vector)).toBe(skills.stableDigest(vector));
    }
  });

  it('the REAL SDK deriveIdempotencyKey agrees with the mirror derivation byte-for-byte', () => {
    const vectors = [
      { operation: 'marketplace.purchase.open', listingRef: 'ml:0123456789abcdef', requestId: 'cpr:0123456789abcdef' },
      ['marketplace.settlement', { purchaseId: 'po:0123456789abcdef', settledAt: 1735600000000 }],
      'a plain string part',
    ];
    for (const parts of vectors) {
      expect(deriveIdempotencyKeyMirror(parts)).toBe(sdk.deriveIdempotencyKey(parts));
    }
  });

  it('the REAL SDK error-family vocabulary matches this lane\'s mirror', () => {
    expect([...sdk.SDK_ERROR_FAMILIES]).toEqual([...SDK_ERROR_FAMILIES_MIRROR]);
  });

  it('the T045 exchange id grammar mirror is the REAL grammar (the prefixes this lane cites)', () => {
    for (const id of [
      `pvd:${stableDigestJson({ a: 1 })}`,
      `cpr:${stableDigestJson({ a: 2 })}`,
      `qte:${stableDigestJson({ a: 3 })}`,
      `eng:${stableDigestJson({ a: 4 })}`,
      `dlv:${stableDigestJson({ a: 5 })}`,
      `vrf:${stableDigestJson({ a: 6 })}`,
    ]) {
      expect(capabilityProvider.EXCHANGE_ID_PATTERN.test(id)).toBe(true);
    }
  });
});
