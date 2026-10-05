/**
 * Cross-lane interoperability trip wires for the Arena adapter (Work
 * Order T046): the REAL lanes this adapter consumes ONLY through its
 * STRUCTURAL MIRRORS are loaded STATICALLY here (the tests are the
 * trip wires — the adapter's sources import none of them):
 *
 *   - packages/capability-provider (T045 — THE interface this adapter
 *     implements the consumption side of): every mirrored envelope
 *     shape is a compile-time mutual-assignment witness against the
 *     REAL types; the error/label/vocabulary constants match
 *     member-for-member; the stable digest is byte-identical; the
 *     validator VERDICTS agree on a positive+negative battery; and —
 *     the headline — the adapter-minted envelopes drive the REAL
 *     exchange through the FULL happy path (declare -> request ->
 *     quote -> engage -> deliver -> verify -> import), with the
 *     content-addressed ids byte-identical between the adapter's
 *     mirror mint and the REAL exchange's own mint.
 *   - packages/skills (T017 — the capability/skill language): the
 *     measured-evidence union and the L16a label vocabulary agree; the
 *     L18 imported-artifact draft minted from the REAL exchange over
 *     the ADAPTER's envelopes is accepted by the REAL
 *     `createSkillRecord`.
 *   - packages/agent-body (T016): the registry digest fold agrees
 *     (the program-wide law has ONE fold).
 *   - packages/sdk + services/api (T041): the idempotency-key
 *     derivation is byte-identical; the adapter's routed request
 *     rides the REAL public jobs route end-to-end as the job's OPAQUE
 *     spec — retained byte-exactly, replay-safe under the same key,
 *     and invisible to a foreign tenant.
 *   - The additivity trip-wire: the adapter's non-test sources
 *     contain ZERO cross-package imports (D-003/D-004) and no ambient
 *     clock or randomness (L4/L9).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// --- The REAL lanes (test-only; this adapter's src imports NONE of them) ----
import * as capabilityProvider from '../../../packages/capability-provider/src/index';
import * as skills from '../../../packages/skills/src/index';
import * as sdk from '../../../packages/sdk/src/index';
import { registryStableDigest } from '../../../packages/agent-body/src/capability-registry';
import { createTradRLClient } from '../../../packages/sdk/src/client';
import type { SdkRequest, SdkResponse } from '../../../packages/sdk/src/transport';
import { fixtureService, TENANT_A, TOKEN_A } from '../../../services/api/src/fixtures';
import type { ApiRequest, ApiResponse } from '../../../services/api/src/index';

// The REAL provider-sdk's scripted fake transport.
import { createFakeTransport, type TransportScript } from '../../../packages/provider-sdk/src/index';

// --- This adapter -------------------------------------------------------------
import {
  ARENA_ENTITLEMENT,
  ARENA_REQUEST_JOB_OPERATION,
  arenaRequestJobIdempotencyKey,
  arenaRequestJobPayload,
  createArenaAdapterSession,
  arenaSubscription,
  DELIVERABLE_KINDS,
  LABEL_EVIDENCE_KEYS_MIRROR,
  PROVIDER_ERROR_CODES,
  VERIFICATION_KINDS,
  deriveIdempotencyKeyMirror,
  narrowArenaRequestJobPayload,
  stableDigest,
  stableDigestJson,
  validateCapabilityRequest as mirrorValidateRequest,
  validateDeliverable as mirrorValidateDeliverable,
  validateProviderDeclaration as mirrorValidateDeclaration,
  type CapabilityGapMirror,
  type CapabilityRequest,
  type CapabilityRequestDraft,
  type Deliverable,
  type EmittedEnvelope,
  type Engagement,
  type MeasuredEvidenceMirror,
  type ProviderCapabilityOffer,
  type ProviderClaim,
  type ProviderDeclaration,
  type ProviderDeclarationDraft,
  type ProviderQuote,
  type ProviderTerms,
  type ProviderVerificationReport,
  type SkillApplicabilityMirror,
  type TimestampMs,
  type VerificationOutcome,
  type VerificationRequirement,
} from './index';
import {
  arenaCatalogPayload,
  arenaQuotePayload,
  arenaDeliveryPayload,
  arenaRequestDraft,
  fixtureEngagement,
  fixtureQuote,
  fixtureRequest,
  FIXTURE_GOALPOSTS,
  FIXTURE_TENANT,
  FIXTURE_PROJECT,
  T0,
} from './test-fixtures';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` on drift). No casts: the
// mirrors must be structurally identical to the REAL T045 shapes.
// ---------------------------------------------------------------------------

/** Compiles iff the adapter's ProviderDeclaration mirror IS the REAL one. */
function adapterDeclarationIsReal(value: ProviderDeclaration): capabilityProvider.ProviderDeclaration {
  return value;
}

/** Compiles iff the REAL ProviderDeclaration satisfies the adapter's mirror. */
function realDeclarationIsAdapter(value: capabilityProvider.ProviderDeclaration): ProviderDeclaration {
  return value;
}

/** Compiles iff the adapter's CapabilityRequest mirror IS the REAL one. */
function adapterRequestIsReal(value: CapabilityRequest): capabilityProvider.CapabilityRequest {
  return value;
}

/** Compiles iff the REAL CapabilityRequest satisfies the adapter's mirror. */
function realRequestIsAdapter(value: capabilityProvider.CapabilityRequest): CapabilityRequest {
  return value;
}

/** Compiles iff the adapter's ProviderQuote mirror IS the REAL one (both directions). */
function adapterQuoteIsReal(value: ProviderQuote): capabilityProvider.ProviderQuote {
  return value;
}

function realQuoteIsAdapter(value: capabilityProvider.ProviderQuote): ProviderQuote {
  return value;
}

/** Compiles iff the adapter's Engagement mirror IS the REAL one (both directions). */
function adapterEngagementIsReal(value: Engagement): capabilityProvider.Engagement {
  return value;
}

function realEngagementIsAdapter(value: capabilityProvider.Engagement): Engagement {
  return value;
}

/** Compiles iff the adapter's Deliverable mirror IS the REAL one (both directions). */
function adapterDeliverableIsReal(value: Deliverable): capabilityProvider.Deliverable {
  return value;
}

function realDeliverableIsAdapter(value: capabilityProvider.Deliverable): Deliverable {
  return value;
}

/** Compiles iff the adapter's verification-report mirror IS the REAL one (both directions). */
function adapterReportIsReal(value: ProviderVerificationReport): capabilityProvider.ProviderVerificationReport {
  return value;
}

function realReportIsAdapter(value: capabilityProvider.ProviderVerificationReport): ProviderVerificationReport {
  return value;
}

/** Compiles iff the adapter's requirement + outcome mirrors are the REAL ones. */
function adapterRequirementIsReal(value: VerificationRequirement): capabilityProvider.VerificationRequirement {
  return value;
}

function realRequirementIsAdapter(value: capabilityProvider.VerificationRequirement): VerificationRequirement {
  return value;
}

function adapterOutcomeIsReal(value: VerificationOutcome): capabilityProvider.VerificationOutcome {
  return value;
}

function realOutcomeIsAdapter(value: capabilityProvider.VerificationOutcome): VerificationOutcome {
  return value;
}

/** Compiles iff the adapter's offer + claim + terms mirrors are the REAL ones. */
function adapterOfferIsReal(value: ProviderCapabilityOffer): capabilityProvider.ProviderCapabilityOffer {
  return value;
}

function adapterClaimIsReal(value: ProviderClaim): capabilityProvider.ProviderClaim {
  return value;
}

function adapterTermsIsReal(value: ProviderTerms): capabilityProvider.ProviderTerms {
  return value;
}

/** Compiles iff the adapter's draft shapes are the REAL ones. */
function adapterDeclarationDraftIsReal(value: ProviderDeclarationDraft): capabilityProvider.ProviderDeclarationDraft {
  return value;
}

function realDeclarationDraftIsAdapter(value: capabilityProvider.ProviderDeclarationDraft): ProviderDeclarationDraft {
  return value;
}

function adapterRequestDraftIsReal(value: CapabilityRequestDraft): capabilityProvider.CapabilityRequestDraft {
  return value;
}

function realRequestDraftIsAdapter(value: capabilityProvider.CapabilityRequestDraft): CapabilityRequestDraft {
  return value;
}

/** Compiles iff the T017 language mirrors (via the REAL T045 mirrors) are the REAL ones. */
function adapterEvidenceIsReal(value: MeasuredEvidenceMirror): capabilityProvider.MeasuredEvidenceMirror {
  return value;
}

function realEvidenceIsAdapter(value: capabilityProvider.MeasuredEvidenceMirror): MeasuredEvidenceMirror {
  return value;
}

function adapterApplicabilityIsReal(value: SkillApplicabilityMirror): capabilityProvider.SkillApplicabilityMirror {
  return value;
}

function realApplicabilityIsAdapter(value: capabilityProvider.SkillApplicabilityMirror): SkillApplicabilityMirror {
  return value;
}

function adapterGapIsReal(value: CapabilityGapMirror): capabilityProvider.CapabilityGapMirror {
  return value;
}

function realGapIsAdapter(value: capabilityProvider.CapabilityGapMirror): CapabilityGapMirror {
  return value;
}

void adapterDeclarationIsReal; void realDeclarationIsAdapter;
void adapterRequestIsReal; void realRequestIsAdapter;
void adapterQuoteIsReal; void realQuoteIsAdapter;
void adapterEngagementIsReal; void realEngagementIsAdapter;
void adapterDeliverableIsReal; void realDeliverableIsAdapter;
void adapterReportIsReal; void realReportIsAdapter;
void adapterRequirementIsReal; void realRequirementIsAdapter;
void adapterOutcomeIsReal; void realOutcomeIsAdapter;
void adapterOfferIsReal; void adapterClaimIsReal; void adapterTermsIsReal;
void adapterDeclarationDraftIsReal; void realDeclarationDraftIsAdapter;
void adapterRequestDraftIsReal; void realRequestDraftIsAdapter;
void adapterEvidenceIsReal; void realEvidenceIsAdapter;
void adapterApplicabilityIsReal; void realApplicabilityIsAdapter;
void adapterGapIsReal; void realGapIsAdapter;

// ---------------------------------------------------------------------------
// The runtime parity trip wires
// ---------------------------------------------------------------------------

describe('the REAL T045 capability-provider interface (the consumed surface)', () => {
  it('the typed error vocabulary matches member-for-member (the same laws)', () => {
    expect([...PROVIDER_ERROR_CODES]).toEqual([...capabilityProvider.PROVIDER_ERROR_CODES]);
  });

  it('the L16a label vocabulary matches member-for-member (and the REAL T017 lane)', () => {
    expect([...LABEL_EVIDENCE_KEYS_MIRROR]).toEqual([...capabilityProvider.LABEL_EVIDENCE_KEYS_MIRROR]);
    expect([...LABEL_EVIDENCE_KEYS_MIRROR]).toEqual([...skills.LABEL_EVIDENCE_KEYS]);
  });

  it('the deliverable-kind and verification-kind vocabularies match member-for-member', () => {
    expect([...DELIVERABLE_KINDS]).toEqual([...capabilityProvider.DELIVERABLE_KINDS]);
    expect([...VERIFICATION_KINDS]).toEqual([...capabilityProvider.VERIFICATION_KINDS]);
  });

  it('the stable digest is byte-identical to the REAL lanes (the program-wide fold)', () => {
    const vectors: readonly string[] = [
      '',
      'plain-ascii-vector',
      '{"a":1,"b":[2,3]}',
      'latin-1: café résumé',
      'cjk: 流動性レジーム分析',
      'astral: \u{1D54F}liquidity\u{1F680}',
    ];
    for (const vector of vectors) {
      expect(stableDigest(vector)).toBe(capabilityProvider.stableDigest(vector));
      expect(stableDigest(vector)).toBe(skills.stableDigest(vector));
      expect(stableDigest(vector)).toBe(registryStableDigest(vector));
    }
    const jsonVectors: readonly unknown[] = [
      { b: 1, a: [true, null, 'x'] },
      { summary: 'Liquidité — régime', consideration: { currency: 'eur', amount: 42 } },
      ['é', '流', '𝕏'],
    ];
    for (const vector of jsonVectors) {
      expect(stableDigestJson(vector)).toBe(capabilityProvider.stableDigestJson(vector));
    }
  });

  it('the validator VERDICTS agree on a positive + negative battery (the mirror is the law)', () => {
    // The positive battery: the adapter's fixture drafts validate in BOTH lanes.
    const declarationDraft = {
      providerRef: 'arena',
      displayName: 'Arena Human Expertise Network',
      offers: [
        {
          offerRef: 'offer-liquidity-regime-analysis',
          capabilityKey: 'liquidity-regime-analysis',
          summary: 'Human liquidity-regime analysis under exchange stress windows',
          measuredEvidence: [
            { kind: 'benchmark', benchmarkId: 'bench-microstructure-42', resultRef: 'arena://bench-run-0091' },
          ],
          applicability: { environmentProfileRefs: ['env://stress-windows'], instrumentClassRefs: ['class://us-equities'] },
          deliverableKinds: ['capability-artifact'],
          verificationKinds: ['benchmark'],
        },
      ],
      version: 1,
      supersedes: null,
      declaredAt: T0,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
    };
    const mine = mirrorValidateDeclaration(declarationDraft);
    const real = capabilityProvider.validateProviderDeclaration(declarationDraft);
    expect(mine.ok).toBe(true);
    expect(real.ok).toBe(true);
    if (mine.ok && real.ok) {
      expect(mine.value.declarationId).toBe(real.value.declarationId); // byte-identical content-addressed mint
      expect(JSON.stringify(mine.value)).toBe(JSON.stringify(real.value));
    }

    // The negative battery: the same malformed drafts fail in BOTH lanes with the same codes.
    const labelSmuggled = { ...declarationDraft, profession: 'Senior Quantitative Analyst' };
    expect(mirrorValidateDeclaration(labelSmuggled).ok).toBe(false);
    expect(capabilityProvider.validateProviderDeclaration(labelSmuggled).ok).toBe(false);

    const inventedRequest = { ...arenaRequestDraft(), gapRefs: [], evidenceRefs: [] };
    expect(mirrorValidateRequest(inventedRequest).ok).toBe(false);
    expect(capabilityProvider.validateCapabilityRequest(inventedRequest).ok).toBe(false);

    const requestMine = mirrorValidateRequest(arenaRequestDraft());
    const requestReal = capabilityProvider.validateCapabilityRequest(arenaRequestDraft());
    expect(requestMine.ok).toBe(true);
    expect(requestReal.ok).toBe(true);
    if (requestMine.ok && requestReal.ok) {
      expect(requestMine.value.requestId).toBe(requestReal.value.requestId); // byte-identical cpr: mint
    }

    // The deliverable payload law: a wrong digest fails in BOTH lanes.
    const wrongDigest = {
      engagementId: 'eng:0123456789abcdef',
      kind: 'capability-artifact',
      claims: [{ claimRef: 'c', capabilityKey: 'liquidity-regime-analysis', measuredEvidence: [{ kind: 'result-ref', resultRef: 'r' }] }],
      payload: { a: 1 },
      payloadDigest: '0000000000000000',
      submittedAt: T0 + 1,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
    };
    expect(mirrorValidateDeliverable(wrongDigest).ok).toBe(false);
    expect(capabilityProvider.validateDeliverable(wrongDigest).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The headline drive: the adapter-minted envelopes run the REAL exchange
// end-to-end (declaration -> request -> quote -> engagement -> deliverable ->
// verification -> the L18 import)
// ---------------------------------------------------------------------------

/** Runs the adapter conversation over the scripted wire and returns the three minted envelopes. */
function runAdapterConversation(): { readonly emissions: readonly EmittedEnvelope[]; readonly routed: CapabilityRequest } {
  const request = fixtureRequest();
  // The mirror mint: the SAME content-addressed quote the adapter's
  // mapping mints from the wire quote below (pinned member-for-member by
  // mapping-tables.test) — never a hand-cast placeholder id, which would
  // fork the announced engagement's derivation from the exchange's own.
  const fixtureQuoteMint = fixtureQuote(request);
  const engagement = fixtureEngagement(request, fixtureQuoteMint, T0 + 2_500);
  const script: TransportScript = {
    inbound: [
      { at: T0 as TimestampMs, channel: 'arenaCatalog', payload: arenaCatalogPayload() },
      { at: (T0 + 1_500) as TimestampMs, channel: 'arenaQuotes', payload: arenaQuotePayload(request) },
      { at: (T0 + 3_000) as TimestampMs, channel: 'arenaDeliveries', payload: arenaDeliveryPayload(engagement) },
    ],
    recv_failures: [],
    send_failures: [],
    receive_timeout_ms: null,
  };
  const transport = createFakeTransport(script);
  if (!transport.ok) throw new Error('script must validate');
  const construction = createArenaAdapterSession({
    transport: transport.transport,
    entitlement: ARENA_ENTITLEMENT,
    tenantId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECT,
  });
  if (!construction.ok) throw new Error(`session must construct: ${construction.errors.map((e) => e.message).join('; ')}`);
  const session = construction.session;
  if (!session.engine.open().ok) throw new Error('open must succeed');
  for (const channel of ['arenaCatalog', 'arenaQuotes', 'arenaDeliveries'] as const) {
    const spec = arenaSubscription({ channel, sinceRevision: 1 });
    if (!spec.ok) throw new Error('subscription must build');
    if (!session.engine.subscribe(spec.value).ok) throw new Error('subscribe must succeed');
  }
  const routed = session.routeRequest(arenaRequestDraft());
  if (!routed.ok) throw new Error(`routing must succeed: ${routed.error.message}`);
  const announced = session.announceEngagement(engagement);
  if (!announced.ok) throw new Error('announcement must succeed');
  const emissions: EmittedEnvelope[] = [];
  session.engine.onEnvelope((emission) => emissions.push(emission));
  const pumped = session.engine.pump();
  if (!pumped.ok) throw new Error(`pump must succeed: ${pumped.error.message}`);
  if (pumped.value !== 3) throw new Error(`expected 3 emissions, got ${pumped.value}`);
  return { emissions, routed: routed.value.request };
}

describe('the adapter-minted envelopes drive the REAL T045 exchange end-to-end', () => {
  it('declare -> request -> quote -> engage -> deliver -> verify -> import, all on the REAL exchange', () => {
    const { emissions, routed } = runAdapterConversation();
    const [declarationEmission, quoteEmission, deliveryEmission] = emissions;
    if (declarationEmission.envelope.kind !== 'declaration') throw new Error('first emission must be the declaration');
    if (quoteEmission.envelope.kind !== 'quote') throw new Error('second emission must be the quote');
    if (deliveryEmission.envelope.kind !== 'deliverable') throw new Error('third emission must be the deliverable');

    // The REAL exchange, driven ONLY with adapter-minted envelopes.
    const exchange = capabilityProvider.createProviderExchange(FIXTURE_TENANT);
    if (!exchange.ok) throw new Error('exchange creation failed');
    let state = exchange.value;

    // 1. The declaration: the adapter's catalog envelope registers on the REAL exchange.
    const declared = capabilityProvider.registerProviderDeclaration(state, declarationEmission.envelope.record);
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    state = declared.value.state;
    // The REAL mint is byte-identical to the adapter's mirror mint.
    expect(declared.value.record.declarationId).toBe(declarationEmission.envelope.record.declarationId);

    // 2. The request: the adapter's routed request issues on the REAL exchange (same cpr: id).
    const requested = capabilityProvider.issueCapabilityRequest(state, arenaRequestDraft());
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    state = requested.value.state;
    expect(requested.value.record.requestId).toBe(routed.requestId);

    // 3. The quote: the adapter's quote envelope submits against the REAL laws.
    const quoted = capabilityProvider.submitProviderQuote(state, quoteEmission.envelope.record);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    state = quoted.value.state;
    expect(quoted.value.record.quoteId).toBe(quoteEmission.envelope.record.quoteId);

    // 4. The engagement: the REAL exchange opens over the adapter's request + quote.
    const opened = capabilityProvider.openEngagement(state, {
      requestId: requested.value.record.requestId,
      quoteId: quoted.value.record.quoteId,
      openedAt: T0 + 2_500,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    state = opened.value.state;
    // The REAL engagement is the one the adapter announced (the deterministic derivation agrees).
    expect(opened.value.record.engagementId).toBe(deliveryEmission.envelope.forEngagement);

    // 5. The deliverable: the adapter's delivery envelope submits on the REAL exchange.
    const delivered = capabilityProvider.submitDeliverable(state, deliveryEmission.envelope.record);
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) return;
    state = delivered.value.state;
    expect(delivered.value.record.deliverableId).toBe(deliveryEmission.envelope.record.deliverableId);

    // 6. The verification: the PLATFORM's machinery supplies the outcomes (never the adapter — L20).
    const outcomes: readonly VerificationOutcome[] = [
      { requirementRef: 'bench-check', passed: true, detail: 'benchmark evidence cites bench-microstructure-42 (arena://bench-run-0091)' },
      { requirementRef: 'latency-check', passed: true, detail: 'p95 latency measured at 812ms (bound 900ms)' },
      { requirementRef: 'local-eval', passed: true, detail: 'local evaluation suite eval://suite-arena-import-1 attained' },
    ];
    const verified = capabilityProvider.verifyDeliverable(state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes,
      verifiedAt: T0 + 4_000,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    state = verified.value.state;
    expect(verified.value.record.report.verdict).toBe('verified');
    expect(verified.value.record.engagement.status).toBe('verified');

    // 7. The L18 import: the REAL localize path mints the imported-artifact draft; the REAL T017 accepts it.
    const imported = capabilityProvider.importAsSkillRecordDraft(state, opened.value.record.engagementId);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const record = skills.createSkillRecord(imported.value);
    expect(record.provenance.origin).toBe('imported-artifact');
    expect(record.provenance.attainmentEvidenceRefs).toContain(verified.value.record.report.reportId);
    expect(record.lineage.gapRefs).toEqual(routed.gapRefs);
    expect(record.descriptor.measuredEvidence.length).toBeGreaterThan(0);
    expect(skills.serializeSkillRecord(record)).toBe(skills.serializeSkillRecord(record));

    // 8. The chain: the whole conversation is chain-verified on the REAL exchange.
    const chain = capabilityProvider.verifyExchangeChain(state);
    expect(chain.ok).toBe(true);
  });

  it('a REJECTED verification is retained (the reproducibility law) and imports nothing', () => {
    const { emissions } = runAdapterConversation();
    const [declarationEmission, quoteEmission, deliveryEmission] = emissions;
    if (declarationEmission.envelope.kind !== 'declaration') throw new Error('declaration expected');
    if (quoteEmission.envelope.kind !== 'quote') throw new Error('quote expected');
    if (deliveryEmission.envelope.kind !== 'deliverable') throw new Error('deliverable expected');

    const exchange = capabilityProvider.createProviderExchange(FIXTURE_TENANT);
    if (!exchange.ok) throw new Error('exchange creation failed');
    let state = exchange.value;
    const declared = capabilityProvider.registerProviderDeclaration(state, declarationEmission.envelope.record);
    if (!declared.ok) throw new Error('declaration must register');
    state = declared.value.state;
    const requested = capabilityProvider.issueCapabilityRequest(state, arenaRequestDraft());
    if (!requested.ok) throw new Error('request must issue');
    state = requested.value.state;
    const quoted = capabilityProvider.submitProviderQuote(state, quoteEmission.envelope.record);
    if (!quoted.ok) throw new Error('quote must submit');
    state = quoted.value.state;
    const opened = capabilityProvider.openEngagement(state, { requestId: requested.value.record.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error('engagement must open');
    state = opened.value.state;
    const delivered = capabilityProvider.submitDeliverable(state, deliveryEmission.envelope.record);
    if (!delivered.ok) throw new Error('deliverable must submit');
    state = delivered.value.state;

    const failing: readonly VerificationOutcome[] = [
      { requirementRef: 'bench-check', passed: true, detail: 'benchmark evidence cites the suite' },
      { requirementRef: 'latency-check', passed: false, detail: 'p95 latency measured at 1204ms (bound 900ms) — over the bound' },
      { requirementRef: 'local-eval', passed: true, detail: 'local evaluation suite attained' },
    ];
    const rejected = capabilityProvider.verifyDeliverable(state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes: failing,
      verifiedAt: T0 + 4_000,
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    state = rejected.value.state;
    expect(rejected.value.record.report.verdict).toBe('rejected');
    expect(rejected.value.record.engagement.status).toBe('rejected');
    // The rejected deliverable is RETAINED (reproducibility) but imports NOTHING (L18).
    expect(state.deliverables.has(delivered.value.record.deliverableId)).toBe(true);
    const refused = capabilityProvider.importAsSkillRecordDraft(state, opened.value.record.engagementId);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors[0]!.code).toBe('verification_missing');
    // And the chain still verifies (history is retained, including the rejection).
    expect(capabilityProvider.verifyExchangeChain(state).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The T041 trip wires: the SDK parity + the REAL jobs route
// ---------------------------------------------------------------------------

/** Parse the SDK's `path?query` into the service's (path, query record). */
function splitQuery(path: string): { readonly path: string; readonly query?: Record<string, string> } {
  const questionAt = path.indexOf('?');
  if (questionAt === -1) return { path: path.split('/').map((segment) => decodeURIComponent(segment)).join('/') };
  const raw = path.slice(questionAt + 1);
  const query: Record<string, string> = {};
  for (const pair of raw.split('&')) {
    if (pair.length === 0) continue;
    const equalsAt = pair.indexOf('=');
    const key = decodeURIComponent(equalsAt === -1 ? pair : pair.slice(0, equalsAt));
    const value = equalsAt === -1 ? '' : decodeURIComponent(pair.slice(equalsAt + 1));
    query[key] = value;
  }
  return { path: path.slice(0, questionAt).split('/').map((segment) => decodeURIComponent(segment)).join('/'), query };
}

/** Bind the REAL service to the SDK's injectable transport interface. */
function serviceTransport(handle: (request: ApiRequest) => ApiResponse): (request: SdkRequest) => Promise<SdkResponse> {
  return async (request) => {
    const { path, query } = splitQuery(request.path);
    const headers: Record<string, string> = {};
    if (request.headers.authorization !== undefined) headers.authorization = request.headers.authorization;
    if (request.headers['idempotency-key'] !== undefined) headers['idempotency-key'] = request.headers['idempotency-key'];
    const response = handle({ method: request.method, path, headers, ...(query === undefined ? {} : { query }), ...(request.body === undefined ? {} : { body: request.body }) });
    return {
      status: response.status,
      headers: { ...response.headers } as Record<string, string>,
      body: response.body,
    };
  };
}

describe('the REAL T041 SDK surface (the API integration)', () => {
  it('the idempotency-key derivation is byte-identical to the REAL SDK derivation', () => {
    const vectors: readonly unknown[] = [
      ['capability-provider.request', 'cpr:0123456789abcdef'],
      ['jobs.research', { projectId: 'prj-x', spec: { a: 1 } }],
      'plain-string',
    ];
    for (const vector of vectors) {
      expect(deriveIdempotencyKeyMirror(vector)).toBe(sdk.deriveIdempotencyKey(vector));
    }
    // The arena boundary key IS the REAL SDK derivation over the operation identity.
    const request = fixtureRequest();
    expect(arenaRequestJobIdempotencyKey(request)).toBe(
      sdk.deriveIdempotencyKey([ARENA_REQUEST_JOB_OPERATION, request.requestId]),
    );
  });

  it('the adapter-routed request rides the REAL public jobs route end-to-end (opaque spec, retained byte-exactly, replay-safe)', async () => {
    const { service, bundle } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });

    const request = fixtureRequest();
    const payload = arenaRequestJobPayload(request);

    // The REAL pipeline accepts the envelope as the job's OPAQUE spec (202).
    const job = await client.jobs.submitResearch({ projectId: request.projectId, spec: payload });
    expect(job.kind).toBe('research');
    expect(job.status).toBe('submitted');
    expect(job.tenant).toBe(TENANT_A);

    // The REAL submission port retained the spec byte-exactly.
    expect(bundle.jobs.submissions).toHaveLength(1);
    const retained = bundle.jobs.submissions[0]!;
    expect(retained.spec).toEqual(payload);

    // The typed narrowing recovers the envelope from the RETAINED spec.
    const narrowed = narrowArenaRequestJobPayload(retained.spec);
    expect(narrowed.ok).toBe(true);
    if (!narrowed.ok) return;
    expect(narrowed.value.requestId).toBe(request.requestId);
    expect(JSON.stringify(narrowed.value)).toBe(JSON.stringify(request));

    // The boundary idempotency key: a retry replays the ORIGINAL job (never a double submission).
    const first = await client.jobs.submitResearch(
      { projectId: request.projectId, spec: arenaRequestJobPayload(request) },
      { idempotencyKey: arenaRequestJobIdempotencyKey(request) },
    );
    const second = await client.jobs.submitResearch(
      { projectId: request.projectId, spec: arenaRequestJobPayload(request) },
      { idempotencyKey: arenaRequestJobIdempotencyKey(request) },
    );
    expect(second.jobId).toBe(first.jobId);

    // A foreign-tenant read is the REAL typed TenantIsolationError (L12 end-to-end).
    const betaClient = createTradRLClient({ transport: serviceTransport(service.handle), token: 'tok-dev-beta-0002' });
    await expect(betaClient.jobs.get(job.jobId)).rejects.toBeInstanceOf(sdk.TenantIsolationError);
  });
});

// ---------------------------------------------------------------------------
// The additivity trip-wire: the adapter's non-test sources are
// self-contained (zero cross-package imports) and deterministic (no
// ambient clock or randomness)
// ---------------------------------------------------------------------------

/** Recursively collect the package's non-test TypeScript sources. */
function nonTestSources(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      collected.push(...nonTestSources(join(directory, entry.name)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      collected.push(join(directory, entry.name));
    }
  }
  return collected;
}

describe('the additivity trip-wire (D-003/D-004 + the determinism law)', () => {
  const srcRoot = fileURLToPath(new URL('.', import.meta.url));

  it('the non-test sources contain ZERO cross-package imports (structural mirrors only)', () => {
    const sources = nonTestSources(srcRoot);
    expect(sources.length).toBeGreaterThan(10); // the walk must actually cover the package
    for (const source of sources) {
      const text = readFileSync(source, 'utf8');
      // No workspace-relative imports (../ or ../../), no package-name imports, no dynamic imports.
      expect(
        text,
        `${source} must not import outside the package (structural mirrors only — D-003/D-004)`,
      ).not.toMatch(/from\s+'(\.\.[\\/]|@tradrl\/|[a-z@][^'"]*node_modules)/);
      expect(text, `${source} must not dynamically import`).not.toMatch(/\bimport\s*\(/);
    }
  });

  it('the non-test sources contain no ambient clock or randomness (L4/L9)', () => {
    for (const source of nonTestSources(srcRoot)) {
      const text = readFileSync(source, 'utf8');
      expect(text, `${source} must not read the wall clock`).not.toContain('Date.now');
      expect(text, `${source} must not use ambient randomness`).not.toContain('Math.random');
    }
  });

  it('the frozen-goalpost fixtures agree with the adapter mirror\'s own request mint (byte-identical cpr: ids)', () => {
    const request = fixtureRequest();
    const reminted = mirrorValidateRequest(arenaRequestDraft());
    expect(reminted.ok).toBe(true);
    if (reminted.ok) {
      expect(request.requestId).toBe(reminted.value.requestId);
    }
    expect(request.verification).toEqual(FIXTURE_GOALPOSTS);
  });
});
