// @tradrl/capability-provider — L12 tenant isolation: two exchanges
// (two tenants) are independent worlds; a record minted in one never
// resolves in the other, and cross-tenant drafts are typed refusals at
// the gate (nothing foreign is stored, so nothing foreign can leak).

import { describe, expect, it } from 'vitest';
import {
  createProviderExchange,
  importAsSkillRecordDraft,
  issueCapabilityRequest,
  liveEngagementFor,
  openEngagement,
  registerProviderDeclaration,
  submitDeliverable,
  submitProviderQuote,
  verifyDeliverable,
  verifyExchangeChain,
  withdrawEngagement,
} from './index';
import {
  FIXTURE_TENANT,
  T0,
  passingOutcomes,
  validDeclarationDraft,
  validDeliverableDraft,
  validQuoteDraft,
  validRequestDraft,
} from './fixtures';

const OTHER_TENANT = 'tenant-beta-isolated';

/** Registers the fixture declaration + request under a different tenant. */
function otherTenantDrafts() {
  const declaration = validDeclarationDraft() as { tenantId: string; projectId: string };
  declaration.tenantId = OTHER_TENANT;
  declaration.projectId = 'prj-beta-1';
  const request = { ...validRequestDraft(), tenantId: OTHER_TENANT, projectId: 'prj-beta-1' };
  return { declaration, request };
}

describe('tenant isolation (L12 — separate exchanges are separate worlds)', () => {
  it('the same providerRef is independently registered in each tenant (no cross-tenant registry)', () => {
    const alpha = createProviderExchange(FIXTURE_TENANT);
    const beta = createProviderExchange(OTHER_TENANT);
    if (!alpha.ok || !beta.ok) throw new Error('exchange creation failed');
    const a = registerProviderDeclaration(alpha.value, validDeclarationDraft());
    const { declaration } = otherTenantDrafts();
    const b = registerProviderDeclaration(beta.value, declaration);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Same providerRef, DIFFERENT content-addressed declaration ids (tenant is content).
    expect(a.value.record.providerRef).toBe(b.value.record.providerRef);
    expect(a.value.record.declarationId).not.toBe(b.value.record.declarationId);
  });

  it("tenant A's request is invisible to tenant B (request_unknown — indistinguishable from nonexistent)", () => {
    const alpha = createProviderExchange(FIXTURE_TENANT);
    const beta = createProviderExchange(OTHER_TENANT);
    if (!alpha.ok || !beta.ok) throw new Error('exchange creation failed');
    const declared = registerProviderDeclaration(alpha.value, validDeclarationDraft());
    if (!declared.ok) throw new Error(declared.errors[0].message);
    const requested = issueCapabilityRequest(declared.value.state, validRequestDraft());
    if (!requested.ok) throw new Error(requested.errors[0].message);

    // Tenant B quotes against tenant A's request: the request does not exist for B.
    const foreignQuote = validQuoteDraft(requested.value.record) as Record<string, unknown>;
    foreignQuote.tenantId = OTHER_TENANT;
    foreignQuote.projectId = 'prj-beta-1';
    const result = submitProviderQuote(beta.value, foreignQuote);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('request_unknown');
  });

  it("tenant B cannot deliver against tenant A's engagement (engagement_unknown — invisible)", () => {
    const alpha = createProviderExchange(FIXTURE_TENANT);
    const beta = createProviderExchange(OTHER_TENANT);
    if (!alpha.ok || !beta.ok) throw new Error('exchange creation failed');
    const declaredA = registerProviderDeclaration(alpha.value, validDeclarationDraft());
    if (!declaredA.ok) throw new Error(declaredA.errors[0].message);
    let state = declaredA.value.state;
    const requested = issueCapabilityRequest(state, validRequestDraft());
    if (!requested.ok) throw new Error(requested.errors[0].message);
    state = requested.value.state;
    const quoted = submitProviderQuote(state, validQuoteDraft(requested.value.record));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    const opened = openEngagement(quoted.value.state, { requestId: requested.value.record.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);

    const foreignDeliverable = validDeliverableDraft(opened.value.record) as Record<string, unknown>;
    foreignDeliverable.tenantId = OTHER_TENANT;
    foreignDeliverable.projectId = 'prj-beta-1';
    const delivered = submitDeliverable(beta.value, foreignDeliverable);
    expect(delivered.ok).toBe(false);
    if (!delivered.ok) expect(delivered.errors[0].code).toBe('engagement_unknown');
  });

  it('a beta-tenant engagement never imports through alpha (engagement_unknown)', () => {
    const alpha = createProviderExchange(FIXTURE_TENANT);
    const beta = createProviderExchange(OTHER_TENANT);
    if (!alpha.ok || !beta.ok) throw new Error('exchange creation failed');
    const { declaration, request } = otherTenantDrafts();
    const declaredBeta = registerProviderDeclaration(beta.value, declaration);
    if (!declaredBeta.ok) throw new Error(declaredBeta.errors[0].message);
    let betaState = declaredBeta.value.state;
    const requested = issueCapabilityRequest(betaState, request);
    if (!requested.ok) throw new Error(requested.errors[0].message);
    betaState = requested.value.state;
    const quoted = submitProviderQuote(betaState, validQuoteDraft(requested.value.record));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    const opened = openEngagement(quoted.value.state, { requestId: requested.value.record.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const delivered = submitDeliverable(opened.value.state, validDeliverableDraft(opened.value.record));
    if (!delivered.ok) throw new Error(delivered.errors[0].message);
    const verified = verifyDeliverable(delivered.value.state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes: passingOutcomes(),
      verifiedAt: T0 + 4_000,
    });
    if (!verified.ok) throw new Error(verified.errors[0].message);

    // Alpha has NO knowledge of beta's engagement.
    const result = importAsSkillRecordDraft(alpha.value, opened.value.record.engagementId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('engagement_unknown');
  });

  it('the beta exchange runs its own full happy path green (isolation does not break beta)', () => {
    const beta = createProviderExchange(OTHER_TENANT);
    if (!beta.ok) throw new Error('exchange creation failed');
    const { declaration, request } = otherTenantDrafts();
    const declaredBeta = registerProviderDeclaration(beta.value, declaration);
    if (!declaredBeta.ok) throw new Error(declaredBeta.errors[0].message);
    let state = declaredBeta.value.state;
    const requested = issueCapabilityRequest(state, request);
    if (!requested.ok) throw new Error(requested.errors[0].message);
    state = requested.value.state;
    const quoted = submitProviderQuote(state, validQuoteDraft(requested.value.record));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: requested.value.record.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    state = opened.value.state;
    const delivered = submitDeliverable(state, validDeliverableDraft(opened.value.record));
    if (!delivered.ok) throw new Error(delivered.errors[0].message);
    state = delivered.value.state;
    const verified = verifyDeliverable(state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes: passingOutcomes(),
      verifiedAt: T0 + 4_000,
    });
    if (!verified.ok) throw new Error(verified.errors[0].message);
    expect(verifyExchangeChain(verified.value.state).ok).toBe(true);

    const imported = importAsSkillRecordDraft(verified.value.state, opened.value.record.engagementId);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.value.lineage.tenantId).toBe(OTHER_TENANT); // the L12 scope travels with the import
    }
  });

  it('withdraw + live-engagement lookups stay scoped to their own exchange', () => {
    const alpha = createProviderExchange(FIXTURE_TENANT);
    const beta = createProviderExchange(OTHER_TENANT);
    if (!alpha.ok || !beta.ok) throw new Error('exchange creation failed');
    const { declaration, request } = otherTenantDrafts();
    const declaredAlpha = registerProviderDeclaration(alpha.value, validDeclarationDraft());
    if (!declaredAlpha.ok) throw new Error(declaredAlpha.errors[0].message);
    let alphaState = declaredAlpha.value.state;
    const alphaRequest = issueCapabilityRequest(alphaState, validRequestDraft());
    if (!alphaRequest.ok) throw new Error(alphaRequest.errors[0].message);
    alphaState = alphaRequest.value.state;

    const declaredBeta = registerProviderDeclaration(beta.value, declaration);
    if (!declaredBeta.ok) throw new Error(declaredBeta.errors[0].message);
    let betaState = declaredBeta.value.state;
    const betaRequest = issueCapabilityRequest(betaState, request);
    if (!betaRequest.ok) throw new Error(betaRequest.errors[0].message);
    betaState = betaRequest.value.state;

    expect(liveEngagementFor(alphaState, betaRequest.value.record.requestId as never)).toBeUndefined();
    expect(liveEngagementFor(betaState, alphaRequest.value.record.requestId as never)).toBeUndefined();

    const quoted = submitProviderQuote(betaState, validQuoteDraft(betaRequest.value.record));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    const opened = openEngagement(quoted.value.state, { requestId: betaRequest.value.record.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const withdrawn = withdrawEngagement(opened.value.state, { engagementId: opened.value.record.engagementId, withdrawnAt: T0 + 3_000 });
    expect(withdrawn.ok).toBe(true);
  });
});
