// @tradrl/capability-provider — the L18 local-import path + the T041
// job projection.

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_REQUEST_JOB_OPERATION,
  capabilityRequestJobIdempotencyKey,
  capabilityRequestJobPayload,
  IDEMPOTENCY_KEY_PATTERN_MIRROR,
  importAsSkillRecordDraft,
  IMPORT_PROTOCOL_VERSION,
  isCapabilityRequest,
  narrowCapabilityRequestJobPayload,
  openEngagement,
  submitDeliverable,
  submitProviderQuote,
  verifyDeliverable,
  withdrawEngagement,
  issueCapabilityRequest,
} from './index';
import { failingOutcomes, passingOutcomes, runHappyPath, validQuoteDraft, validRequestDraft, validDeliverableDraft, T0 } from './fixtures';

describe('the L18 local-import path (a verified capability artifact becomes a T017-shaped draft)', () => {
  it('mints the imported-artifact draft from a VERIFIED capability-artifact engagement', () => {
    const run = runHappyPath();
    const result = importAsSkillRecordDraft(run.state, run.engagement.engagementId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const draft = result.value;
    expect(draft.skillId).toMatch(/^cpi-[0-9a-f]{16}$/);
    expect(draft.artifactRef).toMatch(/^cpa:[0-9a-f]{16}$/);
    expect(draft.provenance.origin).toBe('imported-artifact');
    // The attainment evidence IS the platform's verification (+ the payload pin).
    expect(draft.provenance.attainmentEvidenceRefs[0]).toBe(run.verification.reportId);
    expect(draft.provenance.attainmentEvidenceRefs[1]).toBe(`dlv-payload:${run.deliverable.payloadDigest}`);
    // The lineage closes the commissioning chain: gap refs + evidence refs from the REQUEST.
    expect(draft.lineage.gapRefs).toEqual(run.request.gapRefs);
    expect(draft.lineage.evidenceRefs).toEqual(run.request.evidenceRefs);
    expect(draft.lineage.extractionVersion).toBe(IMPORT_PROTOCOL_VERSION);
    expect(draft.lineage.extractedAt).toBe(run.verification.verifiedAt);
    expect(draft.lineage.parentSkillRef).toBeNull();
    expect(draft.descriptor.capabilityKey).toBe(run.request.requestedCapability);
    expect(draft.descriptor.measuredEvidence.length).toBeGreaterThan(0);
    expect(draft.applicability).toEqual(run.engagement.applicability);
  });

  it('is deterministic: the same exchange records mint the same draft, twice', () => {
    const run = runHappyPath();
    const a = importAsSkillRecordDraft(run.state, run.engagement.engagementId);
    const b = importAsSkillRecordDraft(run.state, run.engagement.engagementId);
    expect(a.ok && b.ok && JSON.stringify(a.value) === JSON.stringify(b.value)).toBe(true);
  });

  it('deduplicates the claims\' measured evidence by canonical bytes', () => {
    const run = runHappyPath();
    const result = importAsSkillRecordDraft(run.state, run.engagement.engagementId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = result.value.descriptor.measuredEvidence.map((e) => JSON.stringify(e));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('an UNVERIFIED engagement never imports (verification_missing)', () => {
    // open (never delivered)
    let state = runHappyPath().state;
    const freshRequest = issueCapabilityRequest(state, { ...validRequestDraft(), summary: 'a second, open request', requestedAt: T0 + 10_000 });
    if (!freshRequest.ok) throw new Error(freshRequest.errors[0].message);
    state = freshRequest.value.state;
    const quoted = submitProviderQuote(state, validQuoteDraft(freshRequest.value.record));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    const opened = openEngagement(quoted.value.state, { requestId: freshRequest.value.record.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 11_000 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const result = importAsSkillRecordDraft(opened.value.state, opened.value.record.engagementId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('verification_missing');
  });

  it('a REJECTED engagement never imports (verification_missing)', () => {
    const run = runHappyPath();
    // Build a rejected engagement on a fresh request in the same exchange style:
    let state = run.state;
    const freshRequest = issueCapabilityRequest(state, { ...validRequestDraft(), summary: 'a request that will be rejected', requestedAt: T0 + 10_000 });
    if (!freshRequest.ok) throw new Error(freshRequest.errors[0].message);
    state = freshRequest.value.state;
    const quoted = submitProviderQuote(state, validQuoteDraft(freshRequest.value.record));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    const opened = openEngagement(quoted.value.state, { requestId: freshRequest.value.record.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 11_000 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const delivered = submitDeliverable(opened.value.state, validDeliverableDraft(opened.value.record));
    if (!delivered.ok) throw new Error(delivered.errors[0].message);
    const rejected = verifyDeliverable(delivered.value.state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes: failingOutcomes(),
      verifiedAt: T0 + 12_000,
    });
    if (!rejected.ok) throw new Error(rejected.errors[0].message);
    const result = importAsSkillRecordDraft(rejected.value.state, opened.value.record.engagementId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('verification_missing');
  });

  it('a WITHDRAWN engagement never imports (verification_missing)', () => {
    const run = runHappyPath();
    let state = run.state;
    const freshRequest = issueCapabilityRequest(state, { ...validRequestDraft(), summary: 'a withdrawn request', requestedAt: T0 + 10_000 });
    if (!freshRequest.ok) throw new Error(freshRequest.errors[0].message);
    state = freshRequest.value.state;
    const quoted = submitProviderQuote(state, validQuoteDraft(freshRequest.value.record));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    const opened = openEngagement(quoted.value.state, { requestId: freshRequest.value.record.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 11_000 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const withdrawn = withdrawEngagement(opened.value.state, { engagementId: opened.value.record.engagementId, withdrawnAt: T0 + 12_000 });
    if (!withdrawn.ok) throw new Error(withdrawn.errors[0].message);
    const result = importAsSkillRecordDraft(withdrawn.value.state, opened.value.record.engagementId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('verification_missing');
  });

  it('a verified NON-artifact engagement is deliverable_not_importable', () => {
    const run = runHappyPath();
    // A verified expert-evidence engagement: same flow, different kind.
    let state = run.state;
    const requestDraft = { ...validRequestDraft(), deliverableKind: 'expert-evidence' as const, summary: 'an expert-evidence request', requestedAt: T0 + 10_000 };
    const request = issueCapabilityRequest(state, requestDraft);
    if (!request.ok) throw new Error(request.errors[0].message);
    state = request.value.state;
    const quoteDraft = validQuoteDraft(request.value.record) as { terms: { deliverableKind: string } };
    quoteDraft.terms = { ...quoteDraft.terms, deliverableKind: 'expert-evidence' };
    const quoted = submitProviderQuote(state, quoteDraft);
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    const opened = openEngagement(quoted.value.state, { requestId: request.value.record.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 11_000 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const deliverableDraft = validDeliverableDraft(opened.value.record) as { kind: string };
    deliverableDraft.kind = 'expert-evidence';
    const delivered = submitDeliverable(opened.value.state, deliverableDraft);
    if (!delivered.ok) throw new Error(delivered.errors[0].message);
    const verified = verifyDeliverable(delivered.value.state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes: passingOutcomes(),
      verifiedAt: T0 + 12_000,
    });
    if (!verified.ok) throw new Error(verified.errors[0].message);
    const result = importAsSkillRecordDraft(verified.value.state, opened.value.record.engagementId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('deliverable_not_importable');
  });

  it('an unknown engagement is engagement_unknown', () => {
    const run = runHappyPath();
    const result = importAsSkillRecordDraft(run.state, 'eng:0000000000000000');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('engagement_unknown');
  });
});

describe('the T041 job projection (the request envelope rides the public jobs surface)', () => {
  it('wraps and narrows round-trip byte-exactly', () => {
    const run = runHappyPath();
    const payload = capabilityRequestJobPayload(run.request);
    expect(payload.operation).toBe(CAPABILITY_REQUEST_JOB_OPERATION);
    const narrowed = narrowCapabilityRequestJobPayload(payload);
    expect(narrowed.ok).toBe(true);
    if (!narrowed.ok) return;
    expect(narrowed.value.requestId).toBe(run.request.requestId);
    expect(JSON.stringify(narrowed.value)).toBe(JSON.stringify(run.request));
  });

  it('a non-object spec, a foreign operation, and a non-request each refuse typed', () => {
    expect(narrowCapabilityRequestJobPayload('nope').ok).toBe(false);
    const foreignOperation = narrowCapabilityRequestJobPayload({ operation: 'something.else', request: runHappyPath().request });
    expect(foreignOperation.ok).toBe(false);
    if (!foreignOperation.ok) expect(foreignOperation.errors[0].path).toBe('spec.operation');
    const notARequest = narrowCapabilityRequestJobPayload({ operation: CAPABILITY_REQUEST_JOB_OPERATION, request: { nope: true } });
    expect(notARequest.ok).toBe(false);
    if (!notARequest.ok) expect(notARequest.errors[0].path).toBe('spec.request');
  });

  it('a label-smuggled request refuses the narrowing too (the L16a scan travels with the contract)', () => {
    const run = runHappyPath();
    const smuggled = { ...run.request, profession: 'senior quant' };
    const narrowed = narrowCapabilityRequestJobPayload(capabilityRequestJobPayload(smuggled as never));
    expect(narrowed.ok).toBe(false);
  });

  it('the request satisfies its own guard after the round trip', () => {
    const run = runHappyPath();
    expect(isCapabilityRequest(run.request)).toBe(true);
  });

  it('the idempotency key follows the SDK grammar and is stable per envelope', () => {
    const run = runHappyPath();
    const key = capabilityRequestJobIdempotencyKey(run.request);
    expect(IDEMPOTENCY_KEY_PATTERN_MIRROR.test(key)).toBe(true);
    expect(capabilityRequestJobIdempotencyKey(run.request)).toBe(key);
  });
});
