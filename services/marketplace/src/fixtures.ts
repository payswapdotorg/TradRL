// @tradrl/marketplace-service — deterministic test/interop fixtures.
//
// The same discipline as the sibling lanes: pure builders over fixed
// literals — NO ambient clock, NO ambient randomness; every instant is
// a fixed constant; every derived id is content-addressed over those
// constants (so the fixtures are byte-stable across runs and usable as
// pinned vectors).

import type { MarketplaceState } from './state';
import { createMarketplace } from './state';
import { publishListing } from './catalog';
import type { Consideration } from './consideration';
import { stableDigestJson } from './imports';

/** The fixture tenant (L12 scope of the fixture marketplace). */
export const FIXTURE_TENANT = 'tenant-marketplace-fixture';

/** The fixture project. */
export const FIXTURE_PROJECT = 'prj-marketplace-fixture';

/** The fixture provider's stable reference. */
export const FIXTURE_PROVIDER = 'vendor-microstructure-alpha';

/** The base instant of every fixture clock reading (fixed — never a wall clock). */
export const T0 = 1_735_600_000_000;

/** A valid measured-evidence entry set (the T017 union — benchmark + measurement). */
export const FIXTURE_EVIDENCE = [
  { kind: 'benchmark', benchmarkId: 'bench-microstructure-42', resultRef: 'res://bench-run-0091' },
  { kind: 'measurement-record', recordRef: 'rec://measure-77', metric: 'benchmark-score', value: 0.87 },
] as const;

/** A valid verification contract (the frozen goalposts): one benchmark + one measurement + one local evaluation. */
export const FIXTURE_VERIFICATION: readonly Record<string, unknown>[] = [
  { kind: 'benchmark', requirementRef: 'bench-check', benchmarkId: 'bench-microstructure-42' },
  { kind: 'measurement', requirementRef: 'latency-check', metric: 'p95-latency-ms', max: 900 },
  { kind: 'local-evaluation', requirementRef: 'local-eval', evaluationRef: 'eval://suite-marketplace-1' },
];

/** A valid capability-gap id (the T017 identifier grammar). */
export const FIXTURE_GAP_ID = 'gap-liquidity-0042';

/** A valid evidence-capsule ref. */
export const FIXTURE_EVIDENCE_REF = 'evi://capsule-321';

/**
 * A valid T045-shaped provider DECLARATION DRAFT (plain JSON — the
 * untrusted-input shape the REAL T045 `validateProviderDeclaration`
 * accepts and mints, pinned by the interop test).
 */
export function validDeclarationDraft(): Record<string, unknown> {
  return {
    providerRef: FIXTURE_PROVIDER,
    displayName: 'Alpha Microstructure Research',
    offers: [
      {
        offerRef: 'offer-liquidity-analysis',
        capabilityKey: 'liquidity-regime-analysis',
        summary: 'Microstructure liquidity-regime analysis under exchange stress windows',
        measuredEvidence: FIXTURE_EVIDENCE,
        applicability: { environmentProfileRefs: ['env://stress-windows'], instrumentClassRefs: ['class://us-equities'] },
        deliverableKinds: ['capability-artifact', 'expert-evidence'],
        verificationKinds: ['benchmark', 'measurement', 'local-evaluation'],
      },
    ],
    version: 1,
    supersedes: null,
    declaredAt: T0,
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
  };
}

/**
 * The MINTED provider declaration record — the exchange-retained shape
 * the marketplace publishes listings FROM: the draft plus its
 * content-addressed `pvd:` identity, derived over the SAME identity
 * content T045's `validateProviderDeclaration` mints from (the interop
 * test pins the byte-parity: `validateProviderDeclaration(draft).value`
 * IS this record).
 */
export function validDeclaration(): Record<string, unknown> {
  const draft = validDeclarationDraft();
  return {
    declarationId: `pvd:${stableDigestJson({
      providerRef: draft.providerRef,
      displayName: draft.displayName,
      offers: draft.offers,
      version: draft.version,
      supersedes: draft.supersedes,
      declaredAt: draft.declaredAt,
      tenantId: draft.tenantId,
      projectId: draft.projectId,
    })}`,
    ...draft,
  };
}

/** The default fixture pricing (a fixed fee in the fixture currency). */
export const FIXTURE_CURRENCY = 'usd-cents';
export const FIXTURE_PRICING: Consideration = { kind: 'fixed-fee', currency: FIXTURE_CURRENCY, amount: '12500.50' };

/** Creates the fixture marketplace with the fixture listing published. */
export function fixtureMarketplace(): MarketplaceState {
  const created = createMarketplace(FIXTURE_TENANT);
  if (!created.ok) throw new Error(`unreachable: ${created.errors.map((e) => e.message).join('; ')}`);
  const published = publishListing(created.value, {
    declaration: validDeclaration(),
    offerRef: 'offer-liquidity-analysis',
    pricing: { ...FIXTURE_PRICING },
    listedAt: T0 + 1_000,
  });
  if (!published.ok) throw new Error(`unreachable: ${published.errors.map((e) => e.message).join('; ')}`);
  return published.value.state;
}
