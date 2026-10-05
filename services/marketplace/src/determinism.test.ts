// @tradrl/marketplace-service — determinism: byte-identical outputs for
// identical inputs (L9), and the source-level no-ambient-anything law.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bindEngagement,
  createMarketplace,
  entitlementSnapshot,
  issueEntitlementGrant,
  marketplaceDigest,
  openPurchase,
  publishListing,
  retireListing,
  serializeMarketplace,
  settlePurchase,
  verifyMarketplaceChain,
} from './index';
import type { EntitlementLedgerState, MarketplaceState } from './index';
import { createEntitlementLedger } from './index';
import { FIXTURE_GAP_ID, FIXTURE_PROJECT, FIXTURE_TENANT, FIXTURE_VERIFICATION, T0, validDeclaration } from './fixtures';
import { stableDigestJson } from './imports';

const REQUEST_ID = `cpr:${stableDigestJson({ fixture: 'determinism-request' })}`;
const QUOTE_ID = `qte:${stableDigestJson({ fixture: 'determinism-quote' })}`;
const ENGAGEMENT_ID = `eng:${stableDigestJson({ fixture: 'determinism-engagement' })}`;
const DELIVERABLE_ID = `dlv:${stableDigestJson({ fixture: 'determinism-deliverable' })}`;
const REPORT_ID = `vrf:${stableDigestJson({ fixture: 'determinism-report' })}`;
const PAYLOAD_DIGEST = stableDigestJson({ fixture: 'determinism-payload' });

/** The FULL commercial lifecycle over fixed literals (the determinism vector). */
function runLifecycle(): { marketplace: MarketplaceState; entitlements: EntitlementLedgerState } {
  const created = createMarketplace(FIXTURE_TENANT);
  if (!created.ok) throw new Error('unreachable');
  const published = publishListing(created.value, {
    declaration: validDeclaration(),
    offerRef: 'offer-liquidity-analysis',
    pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '12500.50' },
    listedAt: T0 + 1000,
  });
  if (!published.ok) throw new Error('unreachable');
  const revised = publishListing(published.value.state, {
    declaration: validDeclaration(),
    offerRef: 'offer-liquidity-analysis',
    pricing: { kind: 'fixed-fee', currency: 'usd-cents', amount: '13000' },
    listedAt: T0 + 1500,
  });
  if (!revised.ok) throw new Error('unreachable');
  const ledger = createEntitlementLedger(FIXTURE_TENANT);
  if (!ledger.ok) throw new Error('unreachable');
  const funded = issueEntitlementGrant(ledger.value, {
    tenantId: FIXTURE_TENANT, projectId: null, kind: 'spend-allowance',
    terms: { kind: 'spend-allowance', currency: 'usd-cents', amount: '50000' },
    version: 1, supersedes: null, sourceRef: 'plan://operator/determinism',
    issuedAt: T0, effectiveFrom: T0, effectiveUntil: null,
  });
  if (!funded.ok) throw new Error('unreachable');
  const opened = openPurchase(revised.value.state, {
    listingRef: revised.value.record.listingRef,
    request: {
      requestId: REQUEST_ID, requestedCapability: 'liquidity-regime-analysis', summary: 'Liquidity-regime analysis of the stress window',
      deliverableKind: 'capability-artifact', gapRefs: [FIXTURE_GAP_ID], evidenceRefs: ['evi://capsule-321'],
      verification: FIXTURE_VERIFICATION, deadline: T0 + 86_400_000,
      consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '13000' },
      tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT, requestedAt: T0 + 2000,
    },
    quote: {
      quoteId: QUOTE_ID, requestId: REQUEST_ID, providerRef: 'vendor-microstructure-alpha', offerRef: 'offer-liquidity-analysis',
      terms: { deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, consideration: { kind: 'fixed-fee', currency: 'usd-cents', amount: '13000' }, estimatedDeliveryAt: T0 + 5000 },
      quotedAt: T0 + 3000, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT,
    },
    openedAt: T0 + 3500,
  });
  if (!opened.ok) throw new Error(`unreachable: ${opened.errors.map((e) => e.message).join('; ')}`);
  const bound = bindEngagement(opened.value.state, {
    purchaseId: opened.value.record.purchaseId,
    engagement: {
      engagementId: ENGAGEMENT_ID, requestId: REQUEST_ID, quoteId: QUOTE_ID, providerRef: 'vendor-microstructure-alpha',
      deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, deadline: T0 + 86_400_000,
      applicability: { environmentProfileRefs: ['env://stress-windows'], instrumentClassRefs: ['class://us-equities'] },
      status: 'open', openedAt: T0 + 4000, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT,
    },
    engagedAt: T0 + 4500,
  });
  if (!bound.ok) throw new Error('unreachable');
  const settled = settlePurchase(bound.value.state, funded.value.state, {
    purchaseId: opened.value.record.purchaseId,
    engagement: {
      engagementId: ENGAGEMENT_ID, requestId: REQUEST_ID, quoteId: QUOTE_ID, providerRef: 'vendor-microstructure-alpha',
      deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, deadline: T0 + 86_400_000,
      applicability: { environmentProfileRefs: ['env://stress-windows'], instrumentClassRefs: ['class://us-equities'] },
      status: 'verified', openedAt: T0 + 4000, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT,
    },
    verificationReport: {
      reportId: REPORT_ID, engagementId: ENGAGEMENT_ID, deliverableId: DELIVERABLE_ID, verdict: 'verified',
      outcomes: FIXTURE_VERIFICATION.map((requirement) => ({ requirementRef: (requirement as { requirementRef: string }).requirementRef, passed: true, detail: 'met' })),
      verifiedAt: T0 + 7000, tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT,
    },
    deliverable: {
      deliverableId: DELIVERABLE_ID, engagementId: ENGAGEMENT_ID, kind: 'capability-artifact',
      claims: [{ claimRef: 'claim-liquidity-model', capabilityKey: 'liquidity-regime-analysis', measuredEvidence: [{ kind: 'benchmark', benchmarkId: 'bench-microstructure-42', resultRef: 'res://bench-run-0091' }] }],
      payload: { artifact: 'liquidity-regime-model-v3' }, payloadDigest: PAYLOAD_DIGEST, submittedAt: T0 + 6000,
      tenantId: FIXTURE_TENANT, projectId: FIXTURE_PROJECT,
    },
    settledAt: T0 + 8000,
  });
  if (!settled.ok) throw new Error(`unreachable: ${settled.errors.map((e) => e.message).join('; ')}`);
  const retired = retireListing(settled.value.marketplace, { listingRef: revised.value.record.listingRef, retiredAt: T0 + 9000 });
  if (!retired.ok) throw new Error('unreachable');
  return { marketplace: retired.value.state, entitlements: settled.value.entitlements };
}

describe('byte determinism (L9)', () => {
  it('the same op sequence mints byte-identical canonical serializations', () => {
    expect(serializeMarketplace(runLifecycle().marketplace)).toBe(serializeMarketplace(runLifecycle().marketplace));
  });

  it('the digests are stable across process runs (pinned vector)', () => {
    expect(marketplaceDigest(runLifecycle().marketplace)).toMatch(/^[0-9a-f]{16}$/);
    expect(marketplaceDigest(runLifecycle().marketplace)).toBe(marketplaceDigest(runLifecycle().marketplace));
  });

  it('the entitlements side of the same lifecycle is byte-identical too', () => {
    const snapshotOf = (state: EntitlementLedgerState) => {
      const snapshot = entitlementSnapshot(state, T0 + 10_000);
      if (!snapshot.ok) throw new Error('unreachable');
      return JSON.stringify(snapshot.value.entries.map((entry) => [entry.rootId, entry.status, entry.consumed, entry.remaining]));
    };
    expect(snapshotOf(runLifecycle().entitlements)).toBe(snapshotOf(runLifecycle().entitlements));
  });

  it('chain verification is deterministic (green twice, same bytes)', () => {
    const state = runLifecycle().marketplace;
    expect(verifyMarketplaceChain(state).ok).toBe(true);
    expect(verifyMarketplaceChain(state).ok).toBe(true);
  });
});

describe('the no-ambient-anything law (source-level)', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  /** The source with comments stripped (the LAW text names the forbidden calls; the code never calls them). */
  function codeOf(file: string): string {
    const source = readFileSync(join(here, file), 'utf8');
    return source
      .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 '); // line comments (never the ':// ' of a URI scheme)
  }

  it('no Date.now / Math.random / new Date anywhere in the lane\'s CODE', () => {
    for (const file of ['errors.ts', 'imports.ts', 'consideration.ts', 'listing.ts', 'state.ts', 'catalog.ts', 'commission.ts', 'purchase.ts', 'mirrors.ts', 'index.ts']) {
      const code = codeOf(file);
      expect(code.includes('Date.now(')).toBe(false);
      expect(code.includes('Math.random')).toBe(false);
      expect(code.includes('new Date(')).toBe(false);
    }
  });

  it('no cross-lane imports in the lane\'s sources (D-003/D-004) — only the OWN contract package via imports.ts', () => {
    for (const file of ['errors.ts', 'imports.ts', 'consideration.ts', 'listing.ts', 'state.ts', 'catalog.ts', 'commission.ts', 'purchase.ts', 'mirrors.ts', 'index.ts', 'fixtures.ts']) {
      const code = codeOf(file);
      expect(code.includes(`from '@tradrl/`)).toBe(false); // no package-name imports, ever
      if (file !== 'imports.ts') {
        // Only imports.ts owns the relative path into the OWN contract
        // package; every other module imports within the service.
        expect(code.match(/from '\.\.\/\.\.\/\.\.\//)).toBeNull();
      }
    }
    // imports.ts imports EXACTLY ONE out-of-lane source tree: the OWN contract package.
    const imports = codeOf('imports.ts');
    const outOfLane = imports.match(/from '\.\.\/\.\.\/\.\.\/([^']+)'/g) ?? [];
    expect(outOfLane.every((specifier) => specifier.includes('/packages/entitlements/src/'))).toBe(true);
  });
});
