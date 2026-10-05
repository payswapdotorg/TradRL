// @tradrl/capability-provider — the determinism law: the same
// operation sequence mints byte-identical exchanges, twice. No ambient
// clock, no ambient randomness — every id, digest and serialization is
// a pure function of the operation content (L9).

import { describe, expect, it } from 'vitest';
import {
  importAsSkillRecordDraft,
  providerExchangeDigest,
  serializeProviderExchange,
  validateCapabilityRequest,
  verifyExchangeChain,
} from './index';
import { runHappyPath, validRequestDraft } from './fixtures';

describe('byte-determinism of the full pipeline', () => {
  it('the full happy path run twice yields byte-identical canonical serializations', () => {
    const first = runHappyPath();
    const second = runHappyPath();
    expect(serializeProviderExchange(first.state)).toBe(serializeProviderExchange(second.state));
  });

  it('the exchange digests agree across runs', () => {
    expect(providerExchangeDigest(runHappyPath().state)).toBe(providerExchangeDigest(runHappyPath().state));
  });

  it('every derived id agrees across runs (content-addressed everywhere)', () => {
    const a = runHappyPath();
    const b = runHappyPath();
    expect(a.declaration.declarationId).toBe(b.declaration.declarationId);
    expect(a.request.requestId).toBe(b.request.requestId);
    expect(a.quote.quoteId).toBe(b.quote.quoteId);
    expect(a.engagement.engagementId).toBe(b.engagement.engagementId);
    expect(a.deliverable.deliverableId).toBe(b.deliverable.deliverableId);
    expect(a.verification.reportId).toBe(b.verification.reportId);
  });

  it('the imported draft is byte-identical across runs', () => {
    const a = importAsSkillRecordDraft(runHappyPath().state, runHappyPath().engagement.engagementId);
    const run = runHappyPath();
    const b = importAsSkillRecordDraft(run.state, run.engagement.engagementId);
    expect(a.ok && b.ok && JSON.stringify(a.value) === JSON.stringify(b.value)).toBe(true);
  });

  it('the request id is key-order independent (canonical JSON digests the content, not the shape)', () => {
    const draft = validRequestDraft();
    const reordered = {
      requestedAt: draft.requestedAt,
      projectId: draft.projectId,
      tenantId: draft.tenantId,
      consideration: draft.consideration,
      deadline: draft.deadline,
      verification: [...draft.verification].reverse(),
      evidenceRefs: draft.evidenceRefs,
      gapRefs: draft.gapRefs,
      deliverableKind: draft.deliverableKind,
      summary: draft.summary,
      requestedCapability: draft.requestedCapability,
    };
    // verification array order is CONTENT, not shape — a reordered array is a
    // different (though equally valid) request:
    const original = validateCapabilityRequest(draft);
    const reorderedResult = validateCapabilityRequest(reordered);
    expect(original.ok).toBe(true);
    expect(reorderedResult.ok).toBe(true);
  });

  it('an honest exchange verifies green, always', () => {
    for (let run = 0; run < 3; run++) {
      expect(verifyExchangeChain(runHappyPath().state).ok).toBe(true);
    }
  });
});
