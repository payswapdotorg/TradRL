// @tradrl/capability-provider — deterministic test/interop fixtures.
//
// The same discipline as services/body-forge's fixtures: pure builders
// over fixed literals — NO ambient clock, NO ambient randomness; every
// instant is a fixed constant; every derived id is content-addressed
// over those constants (so the fixtures are byte-stable across runs
// and usable as pinned vectors).

import type {
  CapabilityRequest,
  CapabilityRequestDraft,
  Deliverable,
  Engagement,
  ProviderDeclaration,
  ProviderQuote,
} from './index';
import type { ProviderVerificationReport, VerificationOutcome, VerificationRequirement } from './index';
import {
  createProviderExchange,
  issueCapabilityRequest,
  openEngagement,
  registerProviderDeclaration,
  submitDeliverable,
  submitProviderQuote,
  verifyDeliverable,
} from './index';
import type { ProviderExchangeState } from './index';
import { stableDigestJson } from './index';

/** The fixture tenant (L12 scope of the fixture exchange). */
export const FIXTURE_TENANT = 'tenant-capability-fixture';

/** The fixture project. */
export const FIXTURE_PROJECT = 'prj-capability-fixture';

/** The fixture provider's stable reference. */
export const FIXTURE_PROVIDER = 'expert-firm-alpha';

/** The base instant of every fixture clock reading (fixed — never a wall clock). */
export const T0 = 1_730_000_000_000;

/** A valid measured-evidence entry (benchmark — the T017 union's first member). */
export const FIXTURE_EVIDENCE = [
  { kind: 'benchmark', benchmarkId: 'bench-microstructure-42', resultRef: 'res://bench-run-0091' },
  { kind: 'measurement-record', recordRef: 'rec://measure-77', metric: 'benchmark-score', value: 0.87 },
] as const;

/** A valid verification contract (the frozen goalposts): one benchmark + one measurement + one local evaluation. */
export const FIXTURE_VERIFICATION: readonly VerificationRequirement[] = [
  { kind: 'benchmark', requirementRef: 'bench-check', benchmarkId: 'bench-microstructure-42' },
  { kind: 'measurement', requirementRef: 'latency-check', metric: 'p95-latency-ms', max: 900 },
  { kind: 'local-evaluation', requirementRef: 'local-eval', evaluationRef: 'eval://suite-capability-import-1' },
];

/** A valid capability-gap id (the T017 identifier grammar). */
export const FIXTURE_GAP_ID = 'gap-regime-0042';

/** A valid evidence-capsule ref. */
export const FIXTURE_EVIDENCE_REF = 'evi://capsule-123';

/** A valid provider declaration draft (version 1, root of the supersede history). */
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

/** A valid capability-request draft (cites a gap; verification contract frozen at issue time). */
export function validRequestDraft(): CapabilityRequestDraft {
  return {
    requestedCapability: 'liquidity-regime-analysis',
    summary: 'Liquidity-regime analysis of the stress window around the flash event',
    deliverableKind: 'capability-artifact',
    gapRefs: [FIXTURE_GAP_ID],
    evidenceRefs: [FIXTURE_EVIDENCE_REF],
    verification: FIXTURE_VERIFICATION,
    deadline: T0 + 86_400_000,
    consideration: { currency: 'usd-cents', amount: 12_500 },
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
    requestedAt: T0 + 1_000,
  };
}

/** A valid quote draft against {@link validRequestDraft}'s request (verification accepted VERBATIM; every instant derives from the request). */
export function validQuoteDraft(request: CapabilityRequest): Record<string, unknown> {
  return {
    requestId: request.requestId,
    providerRef: FIXTURE_PROVIDER,
    offerRef: 'offer-liquidity-analysis',
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
}

/** A valid deliverable draft against the engagement (claims evidence-backed; payload digest pinned; the instant derives from the engagement). */
export function validDeliverableDraft(engagement: Engagement): Record<string, unknown> {
  const payload = { analysis: 'regime-classification', windows: ['09:30-09:35', '09:35-09:40'], artifact: 'artifact://liquidity-model-v3' };
  return {
    engagementId: engagement.engagementId,
    kind: engagement.deliverableKind,
    claims: [
      {
        claimRef: 'claim-liquidity-model',
        capabilityKey: 'liquidity-regime-analysis',
        measuredEvidence: FIXTURE_EVIDENCE,
      },
    ],
    payload,
    payloadDigest: stableDigestJson(payload),
    submittedAt: engagement.openedAt + 500,
    tenantId: engagement.tenantId,
    projectId: engagement.projectId,
  };
}

/** The passing outcome set over {@link FIXTURE_VERIFICATION} (EXACT coverage, all passed). */
export function passingOutcomes(): readonly VerificationOutcome[] {
  return [
    { requirementRef: 'bench-check', passed: true, detail: 'benchmark evidence cites bench-microstructure-42 (result res://bench-run-0091)' },
    { requirementRef: 'latency-check', passed: true, detail: 'p95 latency measured at 812ms (bound 900ms)' },
    { requirementRef: 'local-eval', passed: true, detail: 'local evaluation suite eval://suite-capability-import-1 attained' },
  ];
}

/** The failing outcome set (the measurement requirement fails). */
export function failingOutcomes(): readonly VerificationOutcome[] {
  return [
    { requirementRef: 'bench-check', passed: true, detail: 'benchmark evidence cites bench-microstructure-42' },
    { requirementRef: 'latency-check', passed: false, detail: 'p95 latency measured at 1204ms (bound 900ms) — over the bound' },
    { requirementRef: 'local-eval', passed: true, detail: 'local evaluation suite attained' },
  ];
}

/** The full happy-path exchange run: declared -> requested -> quoted -> engaged -> delivered -> verified. */
export interface HappyPathRun {
  readonly state: ProviderExchangeState;
  readonly declaration: ProviderDeclaration;
  readonly request: CapabilityRequest;
  readonly quote: ProviderQuote;
  readonly engagement: Engagement;
  readonly deliverable: Deliverable;
  readonly verification: ProviderVerificationReport;
}

/** Runs the full happy path on a fresh fixture exchange (pure — same bytes every run). */
export function runHappyPath(): HappyPathRun {
  const exchange = createProviderExchange(FIXTURE_TENANT);
  if (!exchange.ok) throw new Error('fixture exchange creation failed');
  let state = exchange.value;

  const declared = registerProviderDeclaration(state, validDeclarationDraft());
  if (!declared.ok) throw new Error(`fixture declaration failed: ${declared.errors.map((e) => e.message).join('; ')}`);
  state = declared.value.state;

  const requested = issueCapabilityRequest(state, validRequestDraft());
  if (!requested.ok) throw new Error(`fixture request failed: ${requested.errors.map((e) => e.message).join('; ')}`);
  state = requested.value.state;

  const quoted = submitProviderQuote(state, validQuoteDraft(requested.value.record));
  if (!quoted.ok) throw new Error(`fixture quote failed: ${quoted.errors.map((e) => e.message).join('; ')}`);
  state = quoted.value.state;

  const opened = openEngagement(state, { requestId: requested.value.record.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
  if (!opened.ok) throw new Error(`fixture engagement failed: ${opened.errors.map((e) => e.message).join('; ')}`);
  state = opened.value.state;

  const delivered = submitDeliverable(state, validDeliverableDraft(opened.value.record));
  if (!delivered.ok) throw new Error(`fixture deliverable failed: ${delivered.errors.map((e) => e.message).join('; ')}`);
  state = delivered.value.state;

  const verified = verifyDeliverable(state, {
    engagementId: opened.value.record.engagementId,
    deliverableId: delivered.value.record.deliverableId,
    outcomes: passingOutcomes(),
    verifiedAt: T0 + 4_000,
  });
  if (!verified.ok) throw new Error(`fixture verification failed: ${verified.errors.map((e) => e.message).join('; ')}`);
  state = verified.value.state;

  return {
    state,
    declaration: declared.value.record,
    request: requested.value.record,
    quote: quoted.value.record,
    engagement: verified.value.record.engagement,
    deliverable: delivered.value.record,
    verification: verified.value.record.report,
  };
}
