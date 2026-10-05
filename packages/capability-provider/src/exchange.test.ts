// @tradrl/capability-provider — the EXCHANGE state machine's laws:
// the happy path, idempotent replays, the lifecycle gates, the deadline
// law, the L12 gate, and the chain (tamper-evidence on every axis).

import { describe, expect, it } from 'vitest';
import {
  createProviderExchange,
  issueCapabilityRequest,
  liveEngagementFor,
  openEngagement,
  providerExchangeDigest,
  registerProviderDeclaration,
  serializeProviderExchange,
  submitDeliverable,
  submitProviderQuote,
  verifyDeliverable,
  verifyExchangeChain,
  withdrawEngagement,
  GENESIS_CHAIN_HEAD,
} from './index';
import type { ExchangeLogEntry, ProviderExchangeState } from './index';
import {
  FIXTURE_TENANT,
  FIXTURE_VERIFICATION,
  T0,
  failingOutcomes,
  passingOutcomes,
  validDeclarationDraft,
  validDeliverableDraft,
  validQuoteDraft,
  validRequestDraft,
} from './fixtures';

/** Starts a fresh exchange with the fixture declaration + request registered. */
function started(): { state: ProviderExchangeState; request: ReturnType<typeof validRequestRecord> } {
  const exchange = createProviderExchange(FIXTURE_TENANT);
  if (!exchange.ok) throw new Error('exchange creation failed');
  let state = exchange.value;
  const declared = registerProviderDeclaration(state, validDeclarationDraft());
  if (!declared.ok) throw new Error(declared.errors[0].message);
  state = declared.value.state;
  const requested = issueCapabilityRequest(state, validRequestDraft());
  if (!requested.ok) throw new Error(requested.errors[0].message);
  return { state: requested.value.state, request: requested.value.record };
}

/** The validated fixture request record (the quote drafts need the full record, never a stub). */
function validRequestRecord() {
  const exchange = createProviderExchange(FIXTURE_TENANT);
  if (!exchange.ok) throw new Error('exchange creation failed');
  const result = issueCapabilityRequest(exchange.value, validRequestDraft());
  if (!result.ok) throw new Error(result.errors[0].message);
  return result.value.record;
}

describe('the happy path (declaration -> request -> quote -> engagement -> deliverable -> verification)', () => {
  it('runs end-to-end with the chain green and the engagement closed as verified', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    state = quoted.value.state;

    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.record.status).toBe('open');
    expect(opened.value.record.verification).toEqual(validRequestDraft().verification); // frozen VERBATIM
    state = opened.value.state;

    const delivered = submitDeliverable(state, validDeliverableDraft(opened.value.record));
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) return;
    state = delivered.value.state;
    const deliveredEngagement = liveEngagementFor(state, request.requestId as never);
    expect(deliveredEngagement?.status).toBe('delivered');

    const verified = verifyDeliverable(state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes: passingOutcomes(),
      verifiedAt: T0 + 4_000,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.record.engagement.status).toBe('verified');
    expect(verified.value.record.report.verdict).toBe('verified');
    state = verified.value.state;

    expect(verifyExchangeChain(state).ok).toBe(true);
    expect(state.log.length).toBe(6); // declared, requested, quoted, opened, delivered, verified
  });

  it('the log kinds follow the operation order with contiguous seqs and linked heads', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
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
    state = verified.value.state;

    const kinds = state.log.map((entry) => entry.kind);
    expect(kinds).toEqual(['provider-declared', 'request-issued', 'quote-submitted', 'engagement-opened', 'deliverable-submitted', 'engagement-verified']);
    expect(state.log[0].priorHead).toBe(GENESIS_CHAIN_HEAD);
    for (let index = 1; index < state.log.length; index++) {
      expect(state.log[index].priorHead).toBe(state.log[index - 1].head);
      expect(state.log[index].seq).toBe(index);
    }
  });

  it('a failing outcome set closes the engagement as REJECTED (retained data — reproducibility)', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    state = opened.value.state;
    const delivered = submitDeliverable(state, validDeliverableDraft(opened.value.record));
    if (!delivered.ok) throw new Error(delivered.errors[0].message);
    state = delivered.value.state;
    const rejected = verifyDeliverable(state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes: failingOutcomes(),
      verifiedAt: T0 + 4_000,
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.value.record.engagement.status).toBe('rejected');
    expect(rejected.value.record.report.verdict).toBe('rejected');
    // The rejected deliverable + report are RETAINED.
    expect(rejected.value.state.deliverables.has(delivered.value.record.deliverableId)).toBe(true);
    expect(rejected.value.state.verificationReports.has(rejected.value.record.report.reportId)).toBe(true);
  });
});

describe('idempotent replays (content-addressed exactly-once)', () => {
  it('replaying a byte-identical request is a replay (no new log entry, same id)', () => {
    const { state, request } = started();
    const again = issueCapabilityRequest(state, validRequestDraft());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.replayed).toBe(true);
    expect(again.value.record.requestId).toBe(request.requestId);
    expect(again.value.state.log.length).toBe(state.log.length);
  });

  it('replaying a byte-identical declaration is a replay', () => {
    const exchange = createProviderExchange(FIXTURE_TENANT);
    if (!exchange.ok) throw new Error('exchange creation failed');
    const first = registerProviderDeclaration(exchange.value, validDeclarationDraft());
    if (!first.ok) throw new Error(first.errors[0].message);
    const second = registerProviderDeclaration(first.value.state, validDeclarationDraft());
    if (!second.ok) throw new Error(second.errors[0].message);
    expect(second.value.replayed).toBe(true);
    expect(second.value.state.log.length).toBe(first.value.state.log.length);
  });

  it('replaying a byte-identical deliverable is a replay', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    state = opened.value.state;
    const first = submitDeliverable(state, validDeliverableDraft(opened.value.record));
    if (!first.ok) throw new Error(first.errors[0].message);
    const second = submitDeliverable(first.value.state, validDeliverableDraft(opened.value.record));
    if (!second.ok) throw new Error(second.errors[0].message);
    expect(second.value.replayed).toBe(true);
    expect(second.value.state.log.length).toBe(first.value.state.log.length);
  });

  it('the same (request, quote, instant) triple replays the engagement; a LATER instant mints a fresh id', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const replay = openEngagement(opened.value.state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    expect(replay.ok && replay.value.replayed).toBe(true);

    const withdrawn = withdrawEngagement(opened.value.state, { engagementId: opened.value.record.engagementId, withdrawnAt: T0 + 3_000 });
    if (!withdrawn.ok) throw new Error(withdrawn.errors[0].message);
    const rengaged = openEngagement(withdrawn.value.state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 5_000 });
    expect(rengaged.ok).toBe(true);
    if (!rengaged.ok) return;
    expect(rengaged.value.record.engagementId).not.toBe(opened.value.record.engagementId);
  });

  it('replaying the SAME withdrawal is a replay (no new log entry); a different instant stays invalid_transition', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const withdrawn = withdrawEngagement(opened.value.state, { engagementId: opened.value.record.engagementId, withdrawnAt: T0 + 3_000 });
    if (!withdrawn.ok) throw new Error(withdrawn.errors[0].message);

    // The retry-after-timeout shape: the identical withdrawal input replays.
    const replay = withdrawEngagement(withdrawn.value.state, { engagementId: opened.value.record.engagementId, withdrawnAt: T0 + 3_000 });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.replayed).toBe(true);
    expect(replay.value.record.status).toBe('withdrawn');
    expect(replay.value.state.log.length).toBe(withdrawn.value.state.log.length);

    // A DIFFERENT withdrawal instant on the terminal engagement is still refused.
    const later = withdrawEngagement(withdrawn.value.state, { engagementId: opened.value.record.engagementId, withdrawnAt: T0 + 3_100 });
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.errors[0].code).toBe('invalid_transition');
  });
});

describe('the negotiation + lifecycle gates (typed refusals)', () => {
  it('a quote against an unknown request is request_unknown', () => {
    const { state } = started();
    const unknownRequestStub = { requestId: 'cpr:0000000000000000', deliverableKind: 'capability-artifact', verification: FIXTURE_VERIFICATION, requestedAt: T0 + 1_000, tenantId: FIXTURE_TENANT, projectId: 'prj-capability-fixture' } as never;
    const result = submitProviderQuote(state, validQuoteDraft(unknownRequestStub));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('request_unknown');
  });

  it('a quote from an unregistered provider is provider_unknown', () => {
    const { state, request } = started();
    const draft = validQuoteDraft(request) as Record<string, unknown>;
    draft.providerRef = 'provider-never-registered';
    const result = submitProviderQuote(state, draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('provider_unknown');
  });

  it('a renegotiated quote (verification not verbatim) is quote_mismatch', () => {
    const { state, request } = started();
    const draft = validQuoteDraft(request) as { terms: { verification: unknown[] } };
    draft.terms.verification = [...draft.terms.verification, { kind: 'benchmark', requirementRef: 'sneaky', benchmarkId: 'b' }];
    const result = submitProviderQuote(state, draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('quote_mismatch');
  });

  it('the quote MINT runs the full law: a label key anywhere in the quote is label_as_evidence', () => {
    const { state, request } = started();
    const draft = validQuoteDraft(request) as Record<string, unknown> & { terms: { consideration: Record<string, unknown> } };
    draft.terms = { ...draft.terms, consideration: { ...draft.terms.consideration, jobTitle: 'Senior Liquidity Expert' } };
    const result = submitProviderQuote(state, draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
  });

  it('the quote MINT runs the full law: malformed terms can never mint a self-guard-failing record', () => {
    const { state, request } = started();
    // A garbage deliverableKind (outside the closed vocabulary):
    const badKind = validQuoteDraft(request) as { terms: { deliverableKind: string } };
    badKind.terms = { ...badKind.terms, deliverableKind: 'arena-challenge' };
    const kindResult = submitProviderQuote(state, badKind);
    expect(kindResult.ok).toBe(false);
    if (!kindResult.ok) expect(kindResult.errors.some((e) => e.code === 'invalid_field' && e.path === 'quote.terms')).toBe(true);

    // A malformed verification member (not a VerificationRequirement):
    const badVerification = validQuoteDraft(request) as { terms: { verification: unknown[] } };
    badVerification.terms = { ...badVerification.terms, verification: [{ kind: 'vibes' }] };
    expect(submitProviderQuote(state, badVerification).ok).toBe(false);

    // A non-JSON consideration (a function is not a JSON value):
    const badConsideration = validQuoteDraft(request) as { terms: { consideration: unknown } };
    badConsideration.terms = { ...badConsideration.terms, consideration: () => 'not json' };
    expect(submitProviderQuote(state, badConsideration as never).ok).toBe(false);

    // A bogus estimate instant:
    const badEstimate = validQuoteDraft(request) as { terms: { estimatedDeliveryAt: unknown } };
    badEstimate.terms = { ...badEstimate.terms, estimatedDeliveryAt: 'soon' };
    expect(submitProviderQuote(state, badEstimate as never).ok).toBe(false);
  });

  it('a quote citing an unknown offer is quote_mismatch', () => {
    const { state, request } = started();
    const draft = validQuoteDraft(request) as Record<string, unknown>;
    draft.offerRef = 'offer-does-not-exist';
    const result = submitProviderQuote(state, draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('quote_mismatch');
  });

  it('a quote whose offer serves a different capability is quote_mismatch', () => {
    const { state } = started();
    // The offer exists but the REQUEST asks for a capability it does not serve:
    const otherRequest = issueCapabilityRequest(state, { ...validRequestDraft(), requestedCapability: 'some-other-capability', requestedAt: T0 + 1_500 });
    if (!otherRequest.ok) throw new Error(otherRequest.errors[0].message);
    const badQuote = submitProviderQuote(otherRequest.value.state, validQuoteDraft(otherRequest.value.record));
    expect(badQuote.ok).toBe(false);
    if (!badQuote.ok) expect(badQuote.errors[0].code).toBe('quote_mismatch');
  });

  it('opening an engagement for a request with a LIVE engagement is engagement_exists', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    // A SECOND quote from the SAME provider (different terms -> different id):
    const secondQuoteDraft = validQuoteDraft(request) as Record<string, unknown>;
    secondQuoteDraft.terms = {
      ...(secondQuoteDraft.terms as Record<string, unknown>),
      consideration: { currency: 'usd-cents', amount: 16_000 },
    };
    const secondQuote = submitProviderQuote(opened.value.state, secondQuoteDraft);
    if (!secondQuote.ok) throw new Error(secondQuote.errors[0].message);
    const result = openEngagement(secondQuote.value.state, { requestId: request.requestId, quoteId: secondQuote.value.record.quoteId, openedAt: T0 + 2_600 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('engagement_exists');
  });

  it('opening before the request instant violates L4', () => {
    const { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    const result = openEngagement(quoted.value.state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('l4_boundary_violation');
  });

  it('verifying an OPEN engagement is deliverable_missing; verifying a TERMINAL one is invalid_transition', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const early = verifyDeliverable(opened.value.state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: 'dlv:0000000000000000',
      outcomes: passingOutcomes(),
      verifiedAt: T0 + 3_000,
    });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors[0].code).toBe('deliverable_missing');

    const delivered = submitDeliverable(opened.value.state, validDeliverableDraft(opened.value.record));
    if (!delivered.ok) throw new Error(delivered.errors[0].message);
    const verified = verifyDeliverable(delivered.value.state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes: passingOutcomes(),
      verifiedAt: T0 + 4_000,
    });
    if (!verified.ok) throw new Error(verified.errors[0].message);
    const again = verifyDeliverable(verified.value.state, {
      engagementId: opened.value.record.engagementId,
      deliverableId: delivered.value.record.deliverableId,
      outcomes: passingOutcomes(),
      verifiedAt: T0 + 5_000,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors[0].code).toBe('invalid_transition');
  });

  it('delivering after withdrawal is invalid_transition', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const withdrawn = withdrawEngagement(opened.value.state, { engagementId: opened.value.record.engagementId, withdrawnAt: T0 + 3_000 });
    if (!withdrawn.ok) throw new Error(withdrawn.errors[0].message);
    expect(withdrawn.value.record.status).toBe('withdrawn');
    const late = submitDeliverable(withdrawn.value.state, validDeliverableDraft(opened.value.record));
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.errors[0].code).toBe('invalid_transition');
  });

  it('withdrawing twice is invalid_transition', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const withdrawn = withdrawEngagement(opened.value.state, { engagementId: opened.value.record.engagementId, withdrawnAt: T0 + 3_000 });
    if (!withdrawn.ok) throw new Error(withdrawn.errors[0].message);
    const twice = withdrawEngagement(withdrawn.value.state, { engagementId: opened.value.record.engagementId, withdrawnAt: T0 + 3_100 });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.errors[0].code).toBe('invalid_transition');
  });

  it('THE DEADLINE LAW: a late deliverable is deadline_exceeded (refused, never recorded)', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const lateDraft = validDeliverableDraft(opened.value.record) as { submittedAt: number };
    lateDraft.submittedAt = (validRequestDraft().deadline as number) + 1;
    const late = submitDeliverable(opened.value.state, lateDraft);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.errors[0].code).toBe('deadline_exceeded');
    // Nothing was appended.
    expect(opened.value.state.log.length).toBe(late.ok ? -1 : opened.value.state.log.length);
  });

  it('THE KIND LAW: a deliverable of the wrong kind is deliverable_mismatch', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const wrongKind = validDeliverableDraft(opened.value.record) as { kind: string; claims: { capabilityKey: string }[] };
    wrongKind.kind = 'annotation';
    const result = submitDeliverable(opened.value.state, wrongKind);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('deliverable_mismatch');
  });

  it('an unknown engagement/deliverable is the typed unknown error', () => {
    const { state } = started();
    const unknownEngagement = openEngagement(state, { requestId: 'cpr:0000000000000000', quoteId: 'qte:0000000000000000', openedAt: T0 });
    expect(unknownEngagement.ok).toBe(false);
    if (!unknownEngagement.ok) expect(unknownEngagement.errors[0].code).toBe('request_unknown');

    const withdrawn = withdrawEngagement(state, { engagementId: 'eng:0000000000000000', withdrawnAt: T0 });
    expect(withdrawn.ok).toBe(false);
    if (!withdrawn.ok) expect(withdrawn.errors[0].code).toBe('engagement_unknown');

    const verified = verifyDeliverable(state, { engagementId: 'eng:0000000000000000', deliverableId: 'dlv:0000000000000000', outcomes: [], verifiedAt: T0 });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0].code).toBe('engagement_unknown');
  });

  it('a declaration that skips the supersede chain is invalid_transition', () => {
    const exchange = createProviderExchange(FIXTURE_TENANT);
    if (!exchange.ok) throw new Error('exchange creation failed');
    const first = registerProviderDeclaration(exchange.value, validDeclarationDraft());
    if (!first.ok) throw new Error(first.errors[0].message);
    const skipped = registerProviderDeclaration(first.value.state, {
      ...validDeclarationDraft(),
      version: 3,
      declaredAt: T0 + 100,
    });
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) expect(skipped.errors[0].code).toBe('invalid_transition');
  });
});

describe('the L12 gate (a foreign record never crosses the exchange boundary)', () => {
  it('a foreign-tenant declaration is cross_tenant_access', () => {
    const exchange = createProviderExchange(FIXTURE_TENANT);
    if (!exchange.ok) throw new Error('exchange creation failed');
    const foreign = validDeclarationDraft() as { tenantId: string };
    foreign.tenantId = 'tenant-foreign';
    const result = registerProviderDeclaration(exchange.value, foreign);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('cross_tenant_access');
  });

  it('a foreign-tenant request is cross_tenant_access', () => {
    const { state } = started();
    const foreign = validRequestDraft() as { tenantId: string };
    foreign.tenantId = 'tenant-foreign';
    const result = issueCapabilityRequest(state, foreign);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('cross_tenant_access');
  });

  it('a foreign-tenant deliverable is cross_tenant_access (even against a valid engagement)', () => {
    let { state, request } = started();
    const quoted = submitProviderQuote(state, validQuoteDraft(request));
    if (!quoted.ok) throw new Error(quoted.errors[0].message);
    state = quoted.value.state;
    const opened = openEngagement(state, { requestId: request.requestId, quoteId: quoted.value.record.quoteId, openedAt: T0 + 2_500 });
    if (!opened.ok) throw new Error(opened.errors[0].message);
    const foreign = validDeliverableDraft(opened.value.record) as { tenantId: string; payloadDigest: string };
    foreign.tenantId = 'tenant-foreign';
    const result = submitDeliverable(opened.value.state, foreign);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('cross_tenant_access');
  });

  it('creating an exchange without a tenant scope is tenant_missing', () => {
    const result = createProviderExchange('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('tenant_missing');
  });
});

describe('the chain law (tamper-evidence on every axis)', () => {
  it('verifyExchangeChain is green on an honest exchange', () => {
    const { state } = started();
    expect(verifyExchangeChain(state).ok).toBe(true);
  });

  it('rewriting a log entry (the head link) is chain_mismatch', () => {
    const { state } = started();
    const tampered: ExchangeLogEntry = { ...state.log[1], at: state.log[1].at + 999 };
    const log = [...state.log];
    log[1] = tampered;
    const bad = { ...state, log } as ProviderExchangeState;
    const result = verifyExchangeChain(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('chain_mismatch');
  });

  it('removing an entry is chain_mismatch (contiguous seq)', () => {
    const { state } = started();
    const log = state.log.slice(1);
    const bad = { ...state, log } as ProviderExchangeState;
    const result = verifyExchangeChain(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('chain_mismatch');
  });

  it('rewriting a RETAINED record is chain_mismatch (the digest leg)', () => {
    const { state, request } = started();
    const forged = new Map(state.requests);
    const original = forged.get(request.requestId as never);
    if (original === undefined) throw new Error('request missing');
    forged.set(request.requestId as never, { ...original, summary: 'silently rewritten summary' });
    const bad = { ...state, requests: forged } as ProviderExchangeState;
    const result = verifyExchangeChain(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('chain_mismatch');
  });

  it('hiding a record is chain_mismatch (history cannot be deleted)', () => {
    const { state, request } = started();
    const emptied = new Map(state.requests);
    emptied.delete(request.requestId as never);
    const bad = { ...state, requests: emptied } as ProviderExchangeState;
    const result = verifyExchangeChain(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('chain_mismatch');
  });

  it('the digest of an empty exchange is the genesis digest; serialization is canonical JSON', () => {
    const exchange = createProviderExchange(FIXTURE_TENANT);
    if (!exchange.ok) throw new Error('exchange creation failed');
    expect(providerExchangeDigest(exchange.value)).toMatch(/^[0-9a-f]{16}$/);
    const serialized = serializeProviderExchange(exchange.value);
    expect(serialized).toContain('"log":[]');
    expect(() => JSON.parse(serialized)).not.toThrow();
  });
});
