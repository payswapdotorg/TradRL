/**
 * @tradrl/adapter-arena — shared test fixtures (internal test support;
 * NOT exported from the package index — the contract surface stays
 * clean).
 *
 * The fixtures mirror the discipline of the sibling packages' test
 * suites: hand-assembled wire payloads and drafts that are VALID by
 * construction (the unwrap helpers fail loudly if a fixture drifts
 * from the contract), with override-based variants for the negative
 * paths. Every value is SYNTHETIC (opaque arena:// refs, fixed instants
 * — no ambient clock, no ambient randomness, no licensed content, no
 * credentials).
 */

import type { JsonObject } from './contract/json';
import type { TimestampMs } from './contract/timestamp';
import type { CapabilityRequest, Engagement, ProviderQuote, VerificationRequirement } from './contract/provider-envelopes';
import type { CapabilityRequestDraft } from './contract/provider-envelopes';
import type { ProviderResult } from './contract/provider';
import { deriveEngagementId } from './contract/provider';
import { validateCapabilityRequest, validateProviderQuoteDraft } from './contract/provider-envelopes';

/** The fixture tenant (L12 scope of the fixture session). */
export const FIXTURE_TENANT = 'tenant-arena-fixture';

/** The fixture project. */
export const FIXTURE_PROJECT = 'prj-arena-fixture';

/** The base instant of every fixture clock reading (fixed — never a wall clock). */
export const T0 = 1_731_000_000_000;

/** The fixture clock helper. */
export const at = (value: number): TimestampMs => value as TimestampMs;

/** Unwrap a fixture result or fail loudly (fixtures are valid by construction). */
export function unwrapProvider<T>(result: ProviderResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${result.errors.map((error) => `(${error.code}) ${error.path}: ${error.message}`).join('; ')}`);
}

/**
 * The frozen goalposts of the fixture conversation: one benchmark + one
 * measurement + one local-evaluation requirement (the declared catalog
 * offer `offer-liquidity-regime-analysis` accepts all three kinds).
 */
export const FIXTURE_GOALPOSTS: readonly VerificationRequirement[] = [
  { kind: 'benchmark', requirementRef: 'bench-check', benchmarkId: 'bench-microstructure-42' },
  { kind: 'measurement', requirementRef: 'latency-check', metric: 'p95-latency-ms', max: 900 },
  { kind: 'local-evaluation', requirementRef: 'local-eval', evaluationRef: 'eval://suite-arena-import-1' },
];

/** A valid capability-request draft (cites a gap; goalposts frozen at issue time). */
export function arenaRequestDraft(): CapabilityRequestDraft {
  return {
    requestedCapability: 'liquidity-regime-analysis',
    summary: 'Liquidity-regime analysis of the stress window around the flash event',
    deliverableKind: 'capability-artifact',
    gapRefs: ['gap-liquidity-0042'],
    evidenceRefs: ['evi://capsule-arena-123'],
    verification: FIXTURE_GOALPOSTS,
    deadline: T0 + 86_400_000,
    consideration: { currency: 'usd-cents', amount: 12_500 },
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    requestedAt: T0 + 1_000,
  };
}

/** Mints the fixture capability request (content-addressed — the same id the REAL T045 mints for the same draft). */
export function fixtureRequest(): CapabilityRequest {
  return unwrapProvider(validateCapabilityRequest(arenaRequestDraft()));
}

/** The documented wire catalog publication payload (revision 1 — the supersede-history root). */
export function arenaCatalogPayload(): JsonObject {
  return {
    messageKind: 'ARENA_CATALOG',
    messageId: 'arena-cat-0001',
    providerName: 'Arena Human Expertise Network',
    offers: [
      {
        offerId: 'offer-liquidity-regime-analysis',
        capability: 'liquidity-regime-analysis',
        summary: 'Human liquidity-regime analysis under exchange stress windows',
        evidence: [
          { kind: 'benchmark', benchmarkId: 'bench-microstructure-42', resultRef: 'arena://bench-run-0091' },
          { kind: 'measurement-record', recordRef: 'arena://measure-77', metric: 'benchmark-score', value: 0.91 },
        ],
        scope: { environments: ['env://stress-windows'], instruments: ['class://us-equities', 'class://spot-majors'] },
        deliverableTypes: ['ARTIFACT', 'EVIDENCE'],
        verificationTypes: ['BENCHMARK', 'MEASUREMENT', 'LOCAL_EVAL'],
      },
      {
        offerId: 'offer-microstructure-stress-replay',
        capability: 'microstructure-stress-replay',
        summary: 'Human-annotated microstructure stress replay scenarios',
        evidence: [
          { kind: 'benchmark', benchmarkId: 'bench-stress-replay-7', resultRef: 'arena://bench-run-0143' },
        ],
        scope: { environments: ['env://stress-windows', 'env://flash-events'], instruments: ['class://us-equities'] },
        deliverableTypes: ['DEMONSTRATION', 'ANNOTATION', 'ASSESSMENT'],
        verificationTypes: ['BENCHMARK', 'LOCAL_EVAL'],
      },
    ],
    catalogRevision: 1,
    publishedAtMs: T0,
  };
}

/** The documented wire quote payload answering the fixture request (goalposts echoed VERBATIM). */
export function arenaQuotePayload(request: CapabilityRequest): JsonObject {
  return {
    messageKind: 'ARENA_QUOTE',
    messageId: 'arena-qte-0002',
    requestRef: request.requestId,
    offerRef: 'offer-liquidity-regime-analysis',
    deliverableType: 'ARTIFACT',
    verificationEcho: [...request.verification],
    counterTerms: { currency: 'usd-cents', amount: 15_000 },
    estimatedDeliveryMs: request.requestedAt + 43_200_000,
    respondedAtMs: request.requestedAt + 1_000,
  } as unknown as JsonObject;
}

/** A hand-constructed valid `ProviderQuote` over the fixture request (the mirror mint — the content-addressed id the mapping will produce). */
export function fixtureQuote(request: CapabilityRequest): ProviderQuote {
  const draft = {
    requestId: request.requestId,
    providerRef: 'arena',
    offerRef: 'offer-liquidity-regime-analysis',
    terms: {
      deliverableKind: request.deliverableKind,
      verification: request.verification,
      consideration: { currency: 'usd-cents', amount: 15_000 },
      estimatedDeliveryAt: request.requestedAt + 43_200_000,
    },
    quotedAt: request.requestedAt + 1_000,
    tenantId: request.tenantId,
    projectId: request.projectId,
  };
  const minted = validateProviderQuoteDraft(draft);
  if (!minted.ok) {
    throw new Error(`fixture quote must mint: ${minted.errors.map((error) => `(${error.code}) ${error.path}: ${error.message}`).join('; ')}`);
  }
  return minted.value;
}

/** A hand-constructed valid `Engagement` over the request+quote pair (the mirror derivation — content-addressed id). */
export function fixtureEngagement(request: CapabilityRequest, quote: ProviderQuote, openedAt: number): Engagement {
  const engagementId = deriveEngagementId({ requestId: request.requestId, quoteId: quote.quoteId, openedAt });
  return {
    engagementId,
    requestId: request.requestId,
    quoteId: quote.quoteId,
    providerRef: quote.providerRef,
    deliverableKind: request.deliverableKind,
    verification: request.verification,
    deadline: request.deadline,
    applicability: {
      environmentProfileRefs: ['env://stress-windows'],
      instrumentClassRefs: ['class://us-equities', 'class://spot-majors'],
    },
    status: 'open',
    openedAt,
    tenantId: request.tenantId,
    projectId: request.projectId,
  } as unknown as Engagement;
}

/** The documented wire delivery payload answering the fixture engagement (claims evidence-backed; content opaque). */
export function arenaDeliveryPayload(engagement: Engagement): JsonObject {
  return {
    messageKind: 'ARENA_DELIVERY',
    messageId: 'arena-dlv-0003',
    engagementRef: engagement.engagementId,
    deliverableType: 'ARTIFACT',
    claims: [
      {
        claimId: 'claim-liquidity-model',
        capability: 'liquidity-regime-analysis',
        evidence: [
          { kind: 'benchmark', benchmarkId: 'bench-microstructure-42', resultRef: 'arena://bench-run-0091' },
          { kind: 'measurement-record', recordRef: 'arena://measure-78', metric: 'benchmark-score', value: 0.93 },
        ],
      },
    ],
    content: {
      analysis: 'regime-classification',
      windows: ['09:30-09:35', '09:35-09:40'],
      artifact: 'arena://artifact/liquidity-model-v3',
    },
    deliveredAtMs: engagement.openedAt + 500,
  };
}
