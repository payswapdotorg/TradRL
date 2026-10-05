// @tradrl/capability-provider — the engagement envelopes' laws:
// the deliverable-kind vocabulary, the request envelope (the evidence
// law + the frozen goalposts), the quote-match law, the lifecycle
// transition table, and the deliverable (the payload digest pin).

import { describe, expect, it } from 'vitest';
import {
  DELIVERABLE_KINDS,
  ENGAGEMENT_TRANSITIONS,
  isCapabilityRequest,
  isDeliverable,
  isDeliverableKind,
  isEngagementStatus,
  isLegalTransition,
  isProviderClaim,
  isProviderTerms,
  quoteMatchProblems,
  stableDigestJson,
  validateCapabilityRequest,
  validateDeliverable,
} from './index';
import type { CapabilityRequest, ProviderQuote } from './index';
import {
  FIXTURE_TENANT,
  FIXTURE_VERIFICATION,
  T0,
  validDeliverableDraft,
  validQuoteDraft,
  validRequestDraft,
} from './fixtures';

function mintedRequest(): CapabilityRequest {
  const result = validateCapabilityRequest(validRequestDraft());
  if (!result.ok) throw new Error(`fixture request invalid: ${result.errors.map((e) => e.message).join('; ')}`);
  return result.value;
}

function mintedQuote(request: CapabilityRequest): ProviderQuote {
  // The quote is minted by the exchange; for unit tests we validate the
  // draft through the exchange's quote path indirectly — here we build
  // the same record the exchange mints (content-addressed identically).
  const draft = validQuoteDraft(request);
  const identityContent = {
    requestId: draft.requestId,
    providerRef: draft.providerRef,
    offerRef: draft.offerRef,
    terms: draft.terms,
    quotedAt: draft.quotedAt,
    tenantId: draft.tenantId,
    projectId: draft.projectId,
  };
  return {
    quoteId: `qte:${stableDigestJson(identityContent)}`,
    requestId: draft.requestId,
    providerRef: draft.providerRef,
    offerRef: draft.offerRef,
    terms: draft.terms,
    quotedAt: draft.quotedAt,
    tenantId: draft.tenantId,
    projectId: draft.projectId,
  } as unknown as ProviderQuote;
}

describe('the deliverable-kind vocabulary (spec/ADAPTERS.md, verbatim)', () => {
  it('is exactly the five delivered operations (request is the request envelope itself)', () => {
    expect([...DELIVERABLE_KINDS]).toEqual(['expert-evidence', 'demonstration', 'annotation', 'evaluation', 'capability-artifact']);
  });

  it('isDeliverableKind closes the vocabulary', () => {
    expect(isDeliverableKind('expert-evidence')).toBe(true);
    expect(isDeliverableKind('arena-challenge')).toBe(false);
    expect(isDeliverableKind(undefined)).toBe(false);
  });
});

describe('the capability request envelope', () => {
  it('a valid request mints a cpr: id and satisfies its guard (frozen)', () => {
    const request = mintedRequest();
    expect(request.requestId).toMatch(/^cpr:[0-9a-f]{16}$/);
    expect(isCapabilityRequest(request)).toBe(true);
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('the id is content-addressed: the same draft twice, the same id', () => {
    expect(mintedRequest().requestId).toBe(mintedRequest().requestId);
  });

  it('THE EVIDENCE LAW: a request with no citation is invalid (evidence_missing)', () => {
    const draft = { ...validRequestDraft(), gapRefs: [], evidenceRefs: [] };
    const result = validateCapabilityRequest(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'evidence_missing')).toBe(true);
    expect(isCapabilityRequest(draft)).toBe(false);
  });

  it('THE GOALPOST LAW: an empty verification contract is invalid (verification_required)', () => {
    const draft = { ...validRequestDraft(), verification: [] };
    const result = validateCapabilityRequest(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'verification_required')).toBe(true);
  });

  it('L4: a deadline before the request instant is invalid (l4_boundary_violation)', () => {
    const draft = { ...validRequestDraft(), deadline: T0 - 1 };
    const result = validateCapabilityRequest(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'l4_boundary_violation')).toBe(true);
  });

  it('L16a: label keys anywhere in the request are typed violations', () => {
    const draft = { ...validRequestDraft(), summary: 'ok' } as Record<string, unknown>;
    draft.role = 'professional market maker';
    const result = validateCapabilityRequest(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
  });

  it('rejects an unknown deliverable kind and a bad capability key', () => {
    expect(validateCapabilityRequest({ ...validRequestDraft(), deliverableKind: 'arena-challenge' }).ok).toBe(false);
    expect(validateCapabilityRequest({ ...validRequestDraft(), requestedCapability: '' }).ok).toBe(false);
  });

  it('L12: a missing tenant/project is the typed tenant_missing', () => {
    const noTenant = { ...validRequestDraft() } as Record<string, unknown>;
    delete noTenant.tenantId;
    const result = validateCapabilityRequest(noTenant);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'tenant_missing')).toBe(true);
  });

  it('the mint is PURE: the caller\'s draft is neither aliased nor frozen in place', () => {
    // A PRIVATE verification array (the fixture draft aliases the module-level
    // FIXTURE_VERIFICATION — mutating that shared constant would contaminate
    // every other test, which is exactly the aliasing this test refuses).
    const draft = { ...validRequestDraft(), verification: [...validRequestDraft().verification] } as { verification: unknown[] };
    const callersVerification = draft.verification;
    const result = validateCapabilityRequest(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The minted record is frozen; the caller\'s draft is NOT (no side
    // effect on untrusted input), and mutating the draft cannot corrupt
    // the minted record (no aliasing).
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.verification)).toBe(true);
    expect(Object.isFrozen(callersVerification)).toBe(false);
    const mintedLength = result.value.verification.length;
    callersVerification.pop();
    expect(isCapabilityRequest(result.value)).toBe(true);
    expect(result.value.verification).toHaveLength(mintedLength);
  });

  it('the consideration is opaque JSON (null is a valid "no consideration")', () => {
    const result = validateCapabilityRequest({ ...validRequestDraft(), consideration: null });
    expect(result.ok).toBe(true);
  });
});

describe('the provider terms + the quote-match law (goalposts never move)', () => {
  it('isProviderTerms checks the shape', () => {
    expect(isProviderTerms(mintedQuote(mintedRequest()).terms)).toBe(true);
    expect(isProviderTerms({ deliverableKind: 'annotation' })).toBe(false);
  });

  it('a verbatim quote matches cleanly', () => {
    const request = mintedRequest();
    const quote = mintedQuote(request);
    expect(quoteMatchProblems(request, quote, undefined)).toEqual([]);
  });

  it('a renegotiated verification contract is a mismatch (canonical bytes must be identical)', () => {
    const request = mintedRequest();
    const quote = mintedQuote(request);
    const renegotiated = {
      ...quote,
      terms: {
        ...quote.terms,
        verification: [...FIXTURE_VERIFICATION, { kind: 'benchmark', requirementRef: 'extra', benchmarkId: 'b' }],
      },
    } as unknown as ProviderQuote;
    const problems = quoteMatchProblems(request, renegotiated, undefined);
    expect(problems.some((p) => p.includes('VERBATIM'))).toBe(true);
  });

  it('a different deliverable kind is a mismatch', () => {
    const request = mintedRequest();
    const quote = mintedQuote(request);
    const wrongKind = { ...quote, terms: { ...quote.terms, deliverableKind: 'annotation' } } as unknown as ProviderQuote;
    const problems = quoteMatchProblems(request, wrongKind, undefined);
    expect(problems.some((p) => p.includes('deliverable kind'))).toBe(true);
  });

  it('a quote predating its request violates L4', () => {
    const request = mintedRequest();
    const quote = mintedQuote(request);
    const early = { ...quote, quotedAt: request.requestedAt - 1 } as unknown as ProviderQuote;
    const problems = quoteMatchProblems(request, early, undefined);
    expect(problems.some((p) => p.includes('predates the request instant'))).toBe(true);
  });

  it('a scope disagreement between quote and request is a mismatch (L12)', () => {
    const request = mintedRequest();
    const quote = mintedQuote(request);
    const foreign = { ...quote, projectId: 'prj-other' } as unknown as ProviderQuote;
    const problems = quoteMatchProblems(request, foreign, undefined);
    expect(problems.some((p) => p.includes('tenant/project scope'))).toBe(true);
  });

  it('the offer resolution laws: missing offer, wrong capability, unproduced kind, unaccepted verification', () => {
    const request = mintedRequest();
    const quote = mintedQuote(request);
    const declaration = {
      providerRef: quote.providerRef,
      offers: [
        {
          offerRef: 'offer-liquidity-analysis',
          capabilityKey: 'liquidity-regime-analysis',
          deliverableKinds: ['capability-artifact', 'expert-evidence'],
          verificationKinds: ['benchmark', 'measurement', 'local-evaluation'],
        },
      ],
    } as unknown as Parameters<typeof quoteMatchProblems>[2];
    expect(quoteMatchProblems(request, quote, declaration)).toEqual([]);

    const missingOffer = { ...quote, offerRef: 'offer-gone' } as unknown as ProviderQuote;
    expect(quoteMatchProblems(request, missingOffer, declaration).some((p) => p.includes('does not exist'))).toBe(true);

    const wrongCapability = {
      providerRef: quote.providerRef,
      offers: [{ offerRef: 'offer-liquidity-analysis', capabilityKey: 'different-capability', deliverableKinds: ['capability-artifact'], verificationKinds: ['benchmark'] }],
    } as unknown as Parameters<typeof quoteMatchProblems>[2];
    expect(quoteMatchProblems(request, quote, wrongCapability).some((p) => p.includes('serves capability'))).toBe(true);

    const noSuchKind = {
      providerRef: quote.providerRef,
      offers: [{ offerRef: 'offer-liquidity-analysis', capabilityKey: 'liquidity-regime-analysis', deliverableKinds: ['annotation'], verificationKinds: ['benchmark'] }],
    } as unknown as Parameters<typeof quoteMatchProblems>[2];
    expect(quoteMatchProblems(request, quote, noSuchKind).some((p) => p.includes('does not produce deliverable kind'))).toBe(true);

    const noSuchVerification = {
      providerRef: quote.providerRef,
      offers: [{ offerRef: 'offer-liquidity-analysis', capabilityKey: 'liquidity-regime-analysis', deliverableKinds: ['capability-artifact'], verificationKinds: ['benchmark'] }],
    } as unknown as Parameters<typeof quoteMatchProblems>[2];
    expect(quoteMatchProblems(request, quote, noSuchVerification).some((p) => p.includes('does not accept verification kind'))).toBe(true);
  });
});

describe('the lifecycle transition table (closed)', () => {
  it('the statuses are the five states', () => {
    for (const status of ['open', 'delivered', 'verified', 'rejected', 'withdrawn']) {
      expect(isEngagementStatus(status)).toBe(true);
    }
    expect(isEngagementStatus('closed')).toBe(false);
  });

  it('the table: open -> delivered|withdrawn; delivered -> delivered|verified|rejected|withdrawn; terminals have NO successors', () => {
    expect(ENGAGEMENT_TRANSITIONS.open).toEqual(['delivered', 'withdrawn']);
    expect(ENGAGEMENT_TRANSITIONS.delivered).toEqual(['delivered', 'verified', 'rejected', 'withdrawn']);
    expect(ENGAGEMENT_TRANSITIONS.verified).toEqual([]);
    expect(ENGAGEMENT_TRANSITIONS.rejected).toEqual([]);
    expect(ENGAGEMENT_TRANSITIONS.withdrawn).toEqual([]);
  });

  it('isLegalTransition answers per the table', () => {
    expect(isLegalTransition('open', 'delivered')).toBe(true);
    expect(isLegalTransition('open', 'verified')).toBe(false); // nothing to verify yet
    expect(isLegalTransition('delivered', 'verified')).toBe(true);
    expect(isLegalTransition('verified', 'delivered')).toBe(false); // terminal
    expect(isLegalTransition('withdrawn', 'open')).toBe(false); // terminal
  });
});

describe('the provider claim + the deliverable', () => {
  it('isProviderClaim requires NON-EMPTY measured evidence (L16a)', () => {
    expect(isProviderClaim({ claimRef: 'c1', capabilityKey: 'k', measuredEvidence: [{ kind: 'result-ref', resultRef: 'r' }] })).toBe(true);
    expect(isProviderClaim({ claimRef: 'c1', capabilityKey: 'k', measuredEvidence: [] })).toBe(false);
    expect(isProviderClaim({ claimRef: 'c1', capabilityKey: 'k' })).toBe(false);
  });

  it('a valid deliverable mints a dlv: id and satisfies its guard', () => {
    const engagement = { engagementId: 'eng:0123456789abcdef', deliverableKind: 'capability-artifact', tenantId: 'tenant-capability-fixture', projectId: 'prj-capability-fixture', openedAt: T0 } as never;
    const result = validateDeliverable(validDeliverableDraft(engagement));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deliverableId).toMatch(/^dlv:[0-9a-f]{16}$/);
    expect(isDeliverable(result.value)).toBe(true);
  });

  it('THE PAYLOAD LAW: a diverging digest is the typed payload_digest_mismatch', () => {
    const engagement = { engagementId: 'eng:0123456789abcdef', deliverableKind: 'capability-artifact', tenantId: 'tenant-capability-fixture', projectId: 'prj-capability-fixture', openedAt: T0 } as never;
    const draft = validDeliverableDraft(engagement) as { payloadDigest: string };
    draft.payloadDigest = '0000000000000000';
    const result = validateDeliverable(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'payload_digest_mismatch')).toBe(true);
  });

  it('an empty claim list is invalid (a claim-less deliverable asserts nothing verifiable)', () => {
    const engagement = { engagementId: 'eng:0123456789abcdef', deliverableKind: 'capability-artifact', tenantId: 'tenant-capability-fixture', projectId: 'prj-capability-fixture', openedAt: T0 } as never;
    const draft = validDeliverableDraft(engagement) as { claims: unknown[] };
    draft.claims = [];
    const result = validateDeliverable(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
  });

  it('duplicate claimRefs are invalid', () => {
    const engagement = { engagementId: 'eng:0123456789abcdef', deliverableKind: 'capability-artifact', tenantId: 'tenant-capability-fixture', projectId: 'prj-capability-fixture', openedAt: T0 } as never;
    const draft = validDeliverableDraft(engagement) as { claims: Record<string, unknown>[] };
    draft.claims = [draft.claims[0], { ...draft.claims[0] }];
    expect(validateDeliverable(draft).ok).toBe(false);
  });

  it('L12 + L4 shape checks on the deliverable', () => {
    const engagement = { engagementId: 'eng:0123456789abcdef', deliverableKind: 'capability-artifact', tenantId: 'tenant-capability-fixture', projectId: 'prj-capability-fixture', openedAt: T0 } as never;
    const noTenant = validDeliverableDraft(engagement) as Record<string, unknown>;
    delete noTenant.tenantId;
    const result = validateDeliverable(noTenant);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'tenant_missing')).toBe(true);

    const badInstant = validDeliverableDraft(engagement) as { submittedAt: number };
    badInstant.submittedAt = 1.5;
    expect(validateDeliverable(badInstant).ok).toBe(false);
  });

  it('the deliverable mint is PURE (no aliasing, no side-effect freeze of the caller\'s draft)', () => {
    const engagement = { engagementId: 'eng:0123456789abcdef', deliverableKind: 'capability-artifact', tenantId: 'tenant-capability-fixture', projectId: 'prj-capability-fixture', openedAt: T0 } as never;
    const draft = validDeliverableDraft(engagement) as { claims: unknown[] };
    const callersClaims = draft.claims;
    const result = validateDeliverable(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value.claims)).toBe(true);
    expect(Object.isFrozen(callersClaims)).toBe(false);
    callersClaims.pop();
    expect(isDeliverable(result.value)).toBe(true);
    expect(result.value.claims).toHaveLength(1);
  });

  it('the deliverable id is content-addressed (same draft, same id, twice)', () => {
    const engagement = { engagementId: 'eng:0123456789abcdef', deliverableKind: 'capability-artifact', tenantId: 'tenant-capability-fixture', projectId: 'prj-capability-fixture', openedAt: T0 } as never;
    const a = validateDeliverable(validDeliverableDraft(engagement));
    const b = validateDeliverable(validDeliverableDraft(engagement));
    expect(a.ok && b.ok && a.value.deliverableId === b.value.deliverableId).toBe(true);
  });

  it('a label key inside a claim (or the payload) is caught by the L16a scan', () => {
    const engagement = { engagementId: 'eng:0123456789abcdef', deliverableKind: 'capability-artifact', tenantId: 'tenant-capability-fixture', projectId: 'prj-capability-fixture', openedAt: T0 } as never;
    const draft = validDeliverableDraft(engagement) as { payload: Record<string, unknown> };
    draft.payload = { ...draft.payload, profession: 'senior quant' };
    const result = validateDeliverable(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
  });
});
