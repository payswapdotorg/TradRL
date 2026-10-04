// Tests for watch mode — R37's seven lenses and the CHAIN-OF-THOUGHT LAW.
//
// Laws pinned here (watch.ts header):
//   - UX.md verbatim: "Show which agent acts, capability used, evidence
//     consulted, proposal, challenge, risk checks and decision. Do not
//     expose hidden chain-of-thought.";
//   - the watch event carries EXACTLY the seven lenses and nothing else;
//   - THE FIREWALL: a reasoning-shaped key anywhere in a payload about to
//     enter the watch surface is the typed ChainOfThoughtExposureError
//     (NEGATIVE TEST REQUIRED — the Work Order names it);
//   - L20: the risk-check lens renders the gateway's verdicts VERBATIM,
//     never re-decides them;
//   - deterministic feed ordering; L12 scope gates on ingest.

import { describe, expect, it } from 'vitest';
import type { GatewaySubmissionRecord, JobRecord, OrgStatusSnapshot, OutcomeRecord, PostMortemRecord } from '../api/contracts';
import { ChainOfThoughtExposureError } from './errors';
import {
  REASONING_KEYS,
  assertNoReasoningText,
  isClosedCapability,
  orderWatchEvents,
  watchEventFromJob,
  watchEventFromOutcome,
  watchEventFromPostMortem,
  watchEventFromSubmission,
  watchEventsFromOrgSnapshot,
  type WatchEvent,
} from './watch';
import { CrossTenantRenderError } from './errors';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

function orgSnapshot(): OrgStatusSnapshot {
  return { organizationRef: 'org:alpha', tenant: 'tenant-a', project: 'proj-a', status: 'active', at: T0, instanceRefs: ['inst:researcher', 'inst:director'] };
}

function job(): JobRecord {
  return { jobId: 'job-1', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'running', submittedAt: T0 + 10 };
}

function routedSubmission(): GatewaySubmissionRecord {
  return { kind: 'routed', submissionId: 'sub-1', decisionId: 'dec-1', auditId: 'aud-1', requestRef: 'req-1', venue: 'venue-x', adapterRef: 'ad-1', channelRef: 'ch-1', routedAt: T0 + 20 };
}

function refusedSubmission(): GatewaySubmissionRecord {
  return { kind: 'refused', submissionId: 'sub-2', decisionId: null, auditId: 'aud-2', refusal: { stage: 'risk-policy' }, refusedAt: T0 + 21 };
}

function outcome(): OutcomeRecord {
  return {
    outcomeId: 'out-1', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
    decision: { decisionRef: 'dec-1', intentRef: 'int-1', disposition: 'filled' },
    outcomeClass: 'realized-profit',
    expectation: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25', declaredBy: 'b1' },
    realization: { filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00', unrealizedAtDecision: '0.00' },
    deviation: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: true },
    evidence: [{ kind: 'fill', ref: 'fil-1' }, { kind: 'audit', ref: 'aud-9' }],
    lineage: { shadow: { fidelity: { mode: 'live' } } },
    asOf: T0 + 30, priorChainHead: '00000000',
  } as unknown as OutcomeRecord;
}

function postMortem(): PostMortemRecord {
  return {
    postMortemId: 'pm-1', ordinal: 1,
    subject: { outcomeRecordRef: 'out-1', decisionRef: 'dec-1', intentRef: 'int-1', outcomeClass: 'realized-profit' },
    expected: { expectedQuantity: null, expectedRealized: null, tolerance: '0.25' },
    happened: { disposition: 'filled', filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00' },
    gap: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: true },
    hypotheses: [{ class: 'regime-shift', confidence: '0.70', detail: { opaque: true }, evidence: [], note: 'a note' }],
    evidence: [{ kind: 'trajectory', ref: 'traj-1' }],
    lineage: { tenant: 'tenant-a', project: 'proj-a', shadowSessionRef: 'ss-1', shadowOutcomeRef: 'so-1', trajectoryRef: null, experiment: null },
    asOf: T0 + 40, priorChainHead: '00000000',
  };
}

describe('watch: THE CHAIN-OF-THOUGHT FIREWALL (R37 — the negative test the Work Order demands)', () => {
  it('the reasoning-key vocabulary is closed and non-empty', () => {
    expect(REASONING_KEYS.length).toBeGreaterThanOrEqual(10);
    expect(REASONING_KEYS).toContain('reasoning');
    expect(REASONING_KEYS).toContain('chainOfThought');
    expect(REASONING_KEYS).toContain('systemPrompt');
    expect(REASONING_KEYS).toContain('scratchpad');
  });

  it('a record carrying a reasoning-shaped key is the typed ChainOfThoughtExposureError — NEVER rendered', () => {
    const contaminated = { ...job(), result: { reasoning: 'I considered exploiting the risk policy by...' } } as JobRecord;
    let caught: unknown;
    try {
      watchEventFromJob(SCOPE, contaminated);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ChainOfThoughtExposureError);
    const violation = caught as ChainOfThoughtExposureError;
    expect(violation.name).toBe('ChainOfThoughtExposureError');
    expect(violation.code).toBe('chain_of_thought_exposure');
    expect(violation.message).toContain('jobRecord.result.reasoning');
    expect(violation.message).toContain('R37');
  });

  it('the firewall is RECURSIVE: reasoning text nested deep in the payload is caught too', () => {
    const contaminated = { ...outcome(), realization: { ...outcome().realization, nested: { deep: [{ rationale: 'hidden deliberation' }] } } } as unknown as OutcomeRecord;
    expect(() => watchEventFromOutcome(SCOPE, contaminated)).toThrow(ChainOfThoughtExposureError);

    const deepOrg = { ...orgSnapshot(), instanceRefs: [] as never, metadata: { analysis: { chain_of_thought: 'text' } } } as unknown as OrgStatusSnapshot;
    expect(() => watchEventsFromOrgSnapshot(SCOPE, deepOrg)).toThrow(ChainOfThoughtExposureError);
  });

  it('every vocabulary key fires (the firewall has no gaps)', () => {
    for (const key of REASONING_KEYS) {
      const payload = { [key]: 'whatever' };
      expect(() => assertNoReasoningText(payload, 'test'), key).toThrow(ChainOfThoughtExposureError);
    }
  });

  it('clean payloads pass untouched (the firewall does not over-fire)', () => {
    expect(() => assertNoReasoningText({ agent: 'inst:1', capability: 'research', evidence: [{ kind: 'fill', ref: 'f1' }] }, 'clean')).not.toThrow();
    expect(() => assertNoReasoningText({ list: [1, 2, { ok: true }] }, 'clean')).not.toThrow();
    expect(() => assertNoReasoningText('a string', 'clean')).not.toThrow();
    expect(() => assertNoReasoningText(null, 'clean')).not.toThrow();
    // near-miss keys that are NOT reasoning-shaped must pass (no substring false-positives)
    expect(() => assertNoReasoningText({ reasoningRefs: ['ref-1'], prompted: false }, 'clean')).not.toThrow();
  });
});

describe('watch: the seven lenses (UX.md verbatim)', () => {
  it('the watch event carries exactly the seven lens fields (+ scope + instant)', () => {
    const event = watchEventFromJob(SCOPE, job());
    expect(Object.keys(event).sort()).toEqual(['agent', 'at', 'capability', 'challenge', 'decision', 'evidenceConsulted', 'projectId', 'proposal', 'riskChecks', 'tenantId'].sort());
  });

  it('org snapshots: one event PER ACTING INSTANCE (the agent lens), capability organization, decision observed', () => {
    const events = watchEventsFromOrgSnapshot(SCOPE, orgSnapshot());
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.agent).toMatch(/^inst:/);
      expect(event.capability).toBe('organization');
      expect(event.proposal).toBeNull(); // the console never invents what the API does not serve
      expect(event.decision).toEqual({ kind: 'observed', ref: 'org:alpha' });
    }
    expect(events[0]?.agent).toBe('inst:researcher');
    expect(events[1]?.agent).toBe('inst:director');
  });

  it('jobs: the proposal lens carries the job ref; closed capability or null', () => {
    const event = watchEventFromJob(SCOPE, job());
    expect(event.proposal).toBe('job-1');
    expect(event.capability).toBe('research');
    expect(event.at).toBe(T0 + 10);
    const alienKind = { ...job(), kind: 'mystery' as never } as JobRecord;
    expect(watchEventFromJob(SCOPE, alienKind).capability).toBeNull(); // unknown kinds render null, never invented
  });

  it('the closed capability vocabulary', () => {
    for (const capability of ['research', 'learning', 'execution', 'organization']) expect(isClosedCapability(capability)).toBe(true);
    expect(isClosedCapability('Mystery')).toBe(false);
  });

  it('submissions (L20): the risk-check lens renders the gateway verdict VERBATIM, the decision lens the gateway kind', () => {
    const refused = watchEventFromSubmission(SCOPE, refusedSubmission());
    expect(refused.riskChecks).toEqual([{ dimension: 'risk-policy', outcome: 'refused' }]); // the gateway's stage, verbatim
    expect(refused.decision).toEqual({ kind: 'refused', ref: 'sub-2' });
    expect(refused.capability).toBe('execution');
    expect(refused.evidenceConsulted).toEqual([{ kind: 'gateway-audit', ref: 'aud-2' }]);

    const routed = watchEventFromSubmission(SCOPE, routedSubmission());
    expect(routed.riskChecks).toEqual([]); // routed: no refusal to render
    expect(routed.decision).toEqual({ kind: 'routed', ref: 'sub-1' });
    expect(routed.proposal).toBe('req-1');
  });

  it('outcomes: the evidence lens carries the record\'s own evidence refs; the proposal lens the intent', () => {
    const event = watchEventFromOutcome(SCOPE, outcome());
    expect(event.evidenceConsulted).toEqual([{ kind: 'fill', ref: 'fil-1' }, { kind: 'audit', ref: 'aud-9' }]);
    expect(event.proposal).toBe('int-1');
    expect(event.decision).toEqual({ kind: 'observed', ref: 'dec-1' });
  });

  it('post-mortems: the challenge lens carries the leading hypothesis CLASS — details and notes never enter', () => {
    const event = watchEventFromPostMortem(SCOPE, postMortem());
    expect(event.challenge).toBe('regime-shift');
    expect(event.proposal).toBe('dec-1');
    const canonical = JSON.stringify(event);
    expect(canonical).not.toContain('a note'); // the hypothesis note never surfaces
    expect(canonical).not.toContain('deliberation');
    const noHypotheses = watchEventFromPostMortem(SCOPE, { ...postMortem(), hypotheses: [] });
    expect(noHypotheses.challenge).toBeNull();
  });
});

describe('watch: deterministic ordering + the L12 gate', () => {
  it('orderWatchEvents sorts by instant, then canonical form (stable, pure)', () => {
    const events: WatchEvent[] = [
      watchEventFromJob(SCOPE, { ...job(), submittedAt: T0 + 30 }),
      watchEventsFromOrgSnapshot(SCOPE, orgSnapshot())[0] as WatchEvent,
      watchEventFromSubmission(SCOPE, refusedSubmission()),
    ];
    const ordered = orderWatchEvents([...events].reverse());
    expect(ordered.map((event) => event.at)).toEqual([T0, T0 + 21, T0 + 30]);
    expect(orderWatchEvents(orderWatchEvents(events))).toEqual(orderWatchEvents(events)); // idempotent
  });

  it('a foreign tenant record is the typed CrossTenantRenderError at ingest', () => {
    expect(() => watchEventsFromOrgSnapshot(SCOPE, { ...orgSnapshot(), tenant: 'tenant-b' } as OrgStatusSnapshot)).toThrow(CrossTenantRenderError);
    expect(() => watchEventFromJob(SCOPE, { ...job(), tenant: 'tenant-b' } as JobRecord)).toThrow(CrossTenantRenderError);
    expect(() => watchEventFromOutcome(SCOPE, { ...outcome(), tenant: 'tenant-b' } as unknown as OutcomeRecord)).toThrow(CrossTenantRenderError);
    expect(() => watchEventFromPostMortem(SCOPE, { ...postMortem(), lineage: { ...postMortem().lineage, tenant: 'tenant-b' } })).toThrow(CrossTenantRenderError);
  });
});
