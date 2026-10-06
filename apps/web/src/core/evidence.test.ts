// Tests for evidence capsules (R38) — typed, content-addressed bundles.
//
// Laws pinned here (evidence.ts header):
//   - a capsule is a TYPED BUNDLE over one served record: identity, refs,
//     typed facts (decimal strings VERBATIM) and its availability instant;
//   - the id is CONTENT-ADDRESSED: identical record -> identical capsule ->
//     identical id (byte-for-byte, the demanded determinism pin);
//   - REF-ONLY rendering: the capsule carries the record's own evidence
//     refs — it never recomputes or rewrites them;
//   - provenance: every capsule names the API route it was read from (R45);
//   - L12: cross-scope records never bundle (typed CrossTenantRenderError).

import { describe, expect, it } from 'vitest';
import type { GatewaySubmissionRecord, JobRecord, OutcomeRecord, PostMortemRecord, ServedKnowledge } from '../api/contracts';
import {
  capsuleFromJob,
  capsuleFromKnowledge,
  capsuleFromOutcome,
  capsuleFromPostMortem,
  capsuleFromSubmission,
  capsulesFromJobs,
  capsulesFromKnowledge,
  capsulesFromOutcomes,
  type EvidenceCapsule,
} from './evidence';
import { CrossTenantRenderError } from './errors';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

function outcome(): OutcomeRecord {
  return {
    outcomeId: 'out-1', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
    decision: { decisionRef: 'dec-1', intentRef: 'int-1', disposition: 'filled' },
    outcomeClass: 'realized-profit',
    expectation: { expectedQuantity: '10.5', expectedRealized: '1.500', tolerance: '0.2500', declaredBy: 'body-1' },
    realization: { filledQuantity: '10.5', realizedOutcome: '1.7500', feeTotal: '0.0200', notionalTotal: '1050.0000', unrealizedAtDecision: '0.0000' },
    deviation: { quantityShortfall: null, realizedGap: '0.2500', withinTolerance: true },
    evidence: [{ kind: 'fill', ref: 'fil-1' }, { kind: 'audit', ref: 'aud-1' }],
    lineage: { shadow: { fidelity: { mode: 'live' } } },
    asOf: T0 + 30, priorChainHead: '00000000',
  } as unknown as OutcomeRecord;
}

function postMortem(): PostMortemRecord {
  return {
    postMortemId: 'pm-1', ordinal: 1,
    subject: { outcomeRecordRef: 'out-1', decisionRef: 'dec-1', intentRef: 'int-1', outcomeClass: 'realized-profit' },
    expected: { expectedQuantity: null, expectedRealized: null, tolerance: '0.2500' },
    happened: { disposition: 'filled', filledQuantity: '10.5', realizedOutcome: '1.7500', feeTotal: '0.0200', notionalTotal: '1050.0000' },
    gap: { quantityShortfall: null, realizedGap: '0.2500', withinTolerance: false },
    hypotheses: [{ class: 'regime-shift', confidence: '0.70', detail: {}, evidence: [], note: null }],
    evidence: [{ kind: 'trajectory', ref: 'traj-1' }],
    lineage: { tenant: 'tenant-a', project: 'proj-a', shadowSessionRef: 'ss-1', shadowOutcomeRef: 'so-1', trajectoryRef: null, experiment: null },
    asOf: T0 + 40, priorChainHead: '00000000',
  };
}

function knowledge(): ServedKnowledge {
  return {
    record: {
      knowledgeId: 'knl-1', ordinal: 1, tenant: 'tenant-a', project: 'proj-a',
      claim: { kind: 'causal', polarity: 'positive', dimension: 'momentum', lagBand: '0-1d' },
      confidence: '0.80', evidenceCount: 4,
      provenance: { postMortemRefs: ['pm-1'], outcomeRefs: ['out-1', 'out-2'], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: [] },
      validity: { from: T0, to: T0 + 1000 }, asOf: T0, priorChainHead: '00000000',
    },
    status: 'active', supersededBy: null,
  } as unknown as ServedKnowledge;
}

function routedSubmission(): GatewaySubmissionRecord {
  return { kind: 'routed', submissionId: 'sub-1', decisionId: 'dec-1', auditId: 'aud-1', requestRef: 'req-1', venue: 'venue-x', adapterRef: 'ad-1', channelRef: 'ch-1', routedAt: T0 + 20 };
}

/** A COMPLETED research job WITH its release-candidate result (the D-9 capsule's source — the /v1/jobs/:jobId read). */
function completedResearchJob(): JobRecord {
  return {
    jobId: 'job-1', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'complete',
    submittedAt: T0 + 10, completedAt: T0 + 28,
    result: { kind: 'release-candidate', specId: 'spec-demo-director', version: 1, project: 'proj-a' },
  };
}

/** A COMPLETED learning job WITH its training-summary result (the epochs fact's source). */
function completedLearningJob(): JobRecord {
  return {
    jobId: 'job-2', kind: 'learning', tenant: 'tenant-a', project: 'proj-a', status: 'complete',
    submittedAt: T0 + 10, completedAt: T0 + 35,
    result: { kind: 'training-summary', epochs: 3, project: 'proj-a' },
  };
}

/** A pending job (no result — nothing to bundle; a pending job proves nothing about a deliverable). */
function pendingJob(): JobRecord {
  return { jobId: 'job-3', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'running', submittedAt: T0 + 10 };
}

/** A completed job whose record carries NO result payload (a seed-shape complete without the payload). */
function resultlessCompleteJob(): JobRecord {
  return { jobId: 'job-4', kind: 'research', tenant: 'tenant-a', project: 'proj-a', status: 'complete', submittedAt: T0 + 10 };
}

describe('evidence: capsule shape + provenance (R45)', () => {
  it('an outcome capsule names its read route, source ref, and carries the record availability (L4)', () => {
    const capsule = capsuleFromOutcome(SCOPE, outcome());
    expect(capsule.sourceKind).toBe('outcome');
    expect(capsule.sourceRef).toBe('out-1');
    expect(capsule.sourceRoute).toBe('/v1/outcomes/query');
    expect(capsule.availableAt).toBe(T0 + 30);
    expect(capsule.tenantId).toBe('tenant-a');
    expect(capsule.projectId).toBe('proj-a');
  });

  it('every source kind carries its own provenance route', () => {
    expect(capsuleFromPostMortem(SCOPE, postMortem()).sourceRoute).toBe('/v1/post-mortems/query');
    expect(capsuleFromKnowledge(SCOPE, knowledge()).sourceRoute).toBe('/v1/knowledge/query');
    expect(capsuleFromSubmission(SCOPE, routedSubmission()).sourceRoute).toBe('/v1/execution/requests');
    expect(capsuleFromJob(SCOPE, completedResearchJob()).sourceRoute).toBe('/v1/jobs/:jobId'); // D-9 (W-28): the jobs lane's own route
  });

  it('the facts are typed, closed per source kind, with decimal values VERBATIM (never re-formatted)', () => {
    const capsule = capsuleFromOutcome(SCOPE, outcome());
    const facts = new Map(capsule.facts.map((fact) => [fact.label, fact.value]));
    expect(facts.get('disposition')).toBe('filled');
    expect(facts.get('outcome-class')).toBe('realized-profit');
    expect(facts.get('expected-quantity')).toBe('10.5');
    expect(facts.get('realized-outcome')).toBe('1.7500'); // verbatim — trailing zeros preserved
    expect(facts.get('fee-total')).toBe('0.0200');
    expect(facts.get('notional-total')).toBe('1050.0000');
    expect(facts.get('within-tolerance')).toBe('true');
  });

  it('a null fact renders as the closed "none" token, a count as its decimal string', () => {
    const pmCapsule = capsuleFromPostMortem(SCOPE, postMortem());
    const facts = new Map(pmCapsule.facts.map((fact) => [fact.label, fact.value]));
    expect(facts.get('realized-gap')).toBe('0.2500');
    expect(facts.get('within-tolerance')).toBe('false');
    expect(facts.get('hypotheses')).toBe('1');
    const knCapsule = capsuleFromKnowledge(SCOPE, knowledge());
    const knFacts = new Map(knCapsule.facts.map((fact) => [fact.label, fact.value]));
    expect(knFacts.get('dimension')).toBe('momentum');
    expect(knFacts.get('lag-band')).toBe(undefined); // not a knowledge fact
    expect(knFacts.get('confidence')).toBe('0.80');
    expect(knFacts.get('evidence-count')).toBe('4');
    expect(knFacts.get('status')).toBe('active');
  });
});

describe('evidence: REF-ONLY rendering (no recompute)', () => {
  it('the capsule carries the record\'s OWN evidence refs, verbatim', () => {
    const capsule = capsuleFromOutcome(SCOPE, outcome());
    expect(capsule.refs).toEqual([{ kind: 'fill', ref: 'fil-1' }, { kind: 'audit', ref: 'aud-1' }]);
  });

  it('the submission capsule refs the gateway audit (the verdict\'s own evidence)', () => {
    const capsule = capsuleFromSubmission(SCOPE, routedSubmission());
    expect(capsule.refs).toEqual([{ kind: 'gateway-audit', ref: 'aud-1' }]);
    const facts = new Map(capsule.facts.map((fact) => [fact.label, fact.value]));
    expect(facts.get('verdict')).toBe('routed');
    expect(facts.get('venue')).toBe('venue-x');
    expect(facts.get('request-ref')).toBe('req-1');
  });

  it('the knowledge capsule derives refs ONLY from the record\'s provenance (empty families drop out)', () => {
    const capsule = capsuleFromKnowledge(SCOPE, knowledge());
    expect(capsule.refs).toEqual([
      { kind: 'post-mortem', ref: 'pm-1' },
      { kind: 'outcome', ref: 'out-1 out-2' },
      // the empty experiment family is absent, never a blank entry
    ]);
  });

  it('the listing collectors preserve input order, one capsule per record', () => {
    const capsules = capsulesFromOutcomes(SCOPE, [outcome(), { ...outcome(), outcomeId: 'out-2' }]);
    expect(capsules.map((capsule) => capsule.sourceRef)).toEqual(['out-1', 'out-2']);
    expect(capsulesFromKnowledge(SCOPE, [knowledge()])).toHaveLength(1);
  });
});

describe('evidence: CONTENT-ADDRESSING determinism (the demanded pin)', () => {
  it('identical record -> identical capsule id, byte for byte', () => {
    const first = capsuleFromOutcome(SCOPE, outcome());
    const second = capsuleFromOutcome(SCOPE, outcome());
    expect(second.capsuleId).toBe(first.capsuleId);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('the id grammar is evc: + 8-hex, and different content gives a different id', () => {
    const capsule = capsuleFromOutcome(SCOPE, outcome());
    expect(capsule.capsuleId).toMatch(/^evc:[0-9a-f]{8}$/);
    const varied = capsuleFromOutcome(SCOPE, { ...outcome(), realization: { ...outcome().realization, realizedOutcome: '9.9999' } } as unknown as OutcomeRecord);
    expect(varied.capsuleId).not.toBe(capsule.capsuleId);
    // a different source kind over the same facts is a DIFFERENT capsule
    expect(capsuleFromPostMortem(SCOPE, postMortem()).capsuleId).not.toMatch(capsule.capsuleId);
  });

  it('repeated derivation is stable (no ambient state, no clock, no randomness)', () => {
    const ids = new Set<string>();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      ids.add(capsuleFromKnowledge(SCOPE, knowledge()).capsuleId);
    }
    expect(ids.size).toBe(1);
  });

  it('the whole capsule list serializes identically for identical input', () => {
    const first = JSON.stringify(capsulesFromOutcomes(SCOPE, [outcome()]));
    const second = JSON.stringify(capsulesFromOutcomes(SCOPE, [outcome()]));
    expect(second).toBe(first);
  });
});

describe('evidence: L12 — cross-scope records never bundle', () => {
  it('a foreign tenant record is the typed CrossTenantRenderError', () => {
    expect(() => capsuleFromOutcome(SCOPE, { ...outcome(), tenant: 'tenant-b' } as unknown as OutcomeRecord)).toThrow(CrossTenantRenderError);
    expect(() => capsuleFromPostMortem(SCOPE, { ...postMortem(), lineage: { ...postMortem().lineage, tenant: 'tenant-b' } })).toThrow(CrossTenantRenderError);
    expect(() => capsuleFromKnowledge(SCOPE, { ...knowledge(), record: { ...knowledge().record, tenant: 'tenant-b' } } as unknown as ServedKnowledge)).toThrow(CrossTenantRenderError);
  });

  it('a foreign PROJECT record is refused too (the full scope gate)', () => {
    expect(() => capsuleFromOutcome(SCOPE, { ...outcome(), project: 'proj-z' } as unknown as OutcomeRecord)).toThrow(CrossTenantRenderError);
  });
});

describe('evidence: D-9 — the job capsules (the result->job lineage leg, W-28)', () => {
  it('a COMPLETED job WITH a result mints a capsule carrying the JOB REF (the lineage leg L2 asked for) + the result payload\'s own facts, verbatim', () => {
    const capsule = capsuleFromJob(SCOPE, completedResearchJob());
    expect(capsule.sourceKind).toBe('job');
    expect(capsule.sourceRef).toBe('job-1');
    expect(capsule.refs).toEqual([{ kind: 'job', ref: 'job-1' }]); // THE lineage leg: a capsule that references its job
    const facts = new Map(capsule.facts.map((entry) => [entry.label, entry.value]));
    expect(facts.get('job-kind')).toBe('research');
    expect(facts.get('deliverable')).toBe('release-candidate');
    expect(facts.get('spec-id')).toBe('spec-demo-director');
    expect(facts.get('version')).toBe('1'); // the decimal string of the payload's own number
    expect(facts.get('project')).toBe('proj-a');
  });

  it('the job capsule carries the completion instant as its availability (L4 — the facts are knowable only then)', () => {
    expect(capsuleFromJob(SCOPE, completedResearchJob()).availableAt).toBe(T0 + 28); // completedAt, never submittedAt
    expect(capsuleFromJob(SCOPE, completedLearningJob()).availableAt).toBe(T0 + 35);
  });

  it('a learning job\'s training summary bundles its own facts (the epochs marker)', () => {
    const capsule = capsuleFromJob(SCOPE, completedLearningJob());
    const facts = new Map(capsule.facts.map((entry) => [entry.label, entry.value]));
    expect(facts.get('job-kind')).toBe('learning');
    expect(facts.get('deliverable')).toBe('training-summary');
    expect(facts.get('epochs')).toBe('3');
    expect(facts.get('spec-id')).toBe(undefined); // never fabricated (L20 — the payload carries none)
  });

  it('a job WITHOUT a result mints NO capsule (the fold skips it; the direct builder is the loud guard)', () => {
    expect(capsulesFromJobs(SCOPE, [pendingJob(), resultlessCompleteJob()])).toEqual([]);
    expect(() => capsuleFromJob(SCOPE, pendingJob())).toThrow(/carries no completed result to bundle/);
    expect(() => capsuleFromJob(SCOPE, resultlessCompleteJob())).toThrow(/carries no completed result to bundle/);
  });

  it('the fold: one capsule per COMPLETED job WITH a result, input order preserved, the others dropped', () => {
    const capsules = capsulesFromJobs(SCOPE, [pendingJob(), completedResearchJob(), resultlessCompleteJob(), completedLearningJob()]);
    expect(capsules.map((capsule) => capsule.sourceRef)).toEqual(['job-1', 'job-2']); // the fold's own order, never a re-sort
  });

  it('D-9 idempotence: an identical job re-read derives the IDENTICAL capsule — never a duplicate (content-addressed id)', () => {
    const first = capsuleFromJob(SCOPE, completedResearchJob());
    const second = capsuleFromJob(SCOPE, completedResearchJob());
    expect(second.capsuleId).toBe(first.capsuleId);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // the fold over a listing that (through a re-read) carries the same
    // record twice derives two capsules with the SAME content address —
    // upstream the reducer's replace-by-id merge keeps the listing itself
    // deduped; the content address is the second, independent guard.
    const doubled = capsulesFromJobs(SCOPE, [completedResearchJob(), completedResearchJob()]);
    expect(doubled).toHaveLength(2);
    expect(doubled[1]?.capsuleId).toBe(doubled[0]?.capsuleId);
  });

  it('a varied result payload is a DIFFERENT capsule (the content address follows the content)', () => {
    const varied = capsuleFromJob(SCOPE, { ...completedResearchJob(), result: { kind: 'release-candidate', specId: 'spec-other', version: 1, project: 'proj-a' } });
    expect(varied.capsuleId).not.toBe(capsuleFromJob(SCOPE, completedResearchJob()).capsuleId);
    // and the id grammar is the shared one: evc: + 8-hex
    expect(capsuleFromJob(SCOPE, completedResearchJob()).capsuleId).toMatch(/^evc:[0-9a-f]{8}$/);
  });

  it('L12: a foreign-tenant or foreign-project job never bundles (the typed CrossTenantRenderError)', () => {
    expect(() => capsuleFromJob(SCOPE, { ...completedResearchJob(), tenant: 'tenant-b' } as unknown as JobRecord)).toThrow(CrossTenantRenderError);
    expect(() => capsuleFromJob(SCOPE, { ...completedResearchJob(), project: 'proj-z' } as unknown as JobRecord)).toThrow(CrossTenantRenderError);
  });
});
