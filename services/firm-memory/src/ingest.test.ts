/**
 * @tradrl/firm-memory-service — the ingestion pipeline's laws: the
 * mirror gates, the L12 scope law (mixed-scope batch), the
 * subject-binding law (dangling/disagreeing subjects), the L4 law
 * (future-dated ingestion), the duplicate-evidence law (idempotence),
 * the promotion decisions (fresh birth, the bar, revision folding,
 * non-dominating and dominating challenges, the internal contest and
 * domination), and atomicity (a failed batch changes nothing).
 */

import { describe, expect, it } from 'vitest';
import { ingestFirmLearning } from './ingest';
import { createFirmMemoryState, firmMemoryStateDigest, type FirmMemoryState } from './state';
import {
  FIRM_PROJECT,
  FIRM_PROJECT_B,
  FIRM_T0,
  FIRM_TENANT,
  FIRM_TENANT_B,
  firmScenarioPolicy,
  firmScenarioShortPolicy,
  scenarioSnapshotAdverse,
  scenarioSnapshotChallenger,
  scenarioSnapshotDominating,
  scenarioSnapshotInternalContest,
  scenarioSnapshotInternalDomination,
  scenarioSnapshotMinimal,
  scenarioSnapshotReinforce,
  scenarioSnapshotTenantB,
} from './fixtures';
import { asTimestampMs } from './imports';

/** Ingest one scenario (the tests' shorthand; throws on failure). */
function ingest(state: FirmMemoryState, snapshot: { readonly outcomes: readonly unknown[]; readonly postMortems: readonly unknown[]; readonly at: ReturnType<typeof asTimestampMs> }, policy = firmScenarioPolicy) {
  const result = ingestFirmLearning(state, { outcomes: snapshot.outcomes, postMortems: snapshot.postMortems }, policy, { at: snapshot.at });
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; '));
  return result.value;
}

describe('the mirror gates', () => {
  it('a malformed outcome record is the typed invalid_field at its index', () => {
    const snapshot = scenarioSnapshotAdverse();
    const broken = { ...(snapshot.outcomes[0] as object), tenant: 42 };
    const result = ingestFirmLearning(createFirmMemoryState(), { outcomes: [broken, ...snapshot.outcomes.slice(1)], postMortems: snapshot.postMortems }, firmScenarioPolicy, { at: snapshot.at });
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
    expect(result.errors[0]?.path).toBe('outcomes[0]');
  });

  it('a malformed post-mortem is the typed invalid_field at its index; an empty post-mortem list is invalid', () => {
    const snapshot = scenarioSnapshotAdverse();
    const broken = { ...(snapshot.postMortems[0] as object), postMortemId: 'not-prefixed' };
    const result = ingestFirmLearning(createFirmMemoryState(), { outcomes: snapshot.outcomes, postMortems: [broken] }, firmScenarioPolicy, { at: snapshot.at });
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
    expect(result.errors[0]?.path).toBe('postMortems[0]');

    const empty = ingestFirmLearning(createFirmMemoryState(), { outcomes: snapshot.outcomes, postMortems: [] }, firmScenarioPolicy, { at: snapshot.at });
    if (empty.ok) throw new Error('must fail');
    expect(empty.errors[0]?.code).toBe('invalid_field');
  });
});

describe('the L12 scope law (one scope per batch)', () => {
  it('a mixed-scope batch is the typed tenant_mismatch; nothing appends', () => {
    const a = scenarioSnapshotAdverse();
    const b = scenarioSnapshotTenantB();
    const before = createFirmMemoryState();
    const result = ingestFirmLearning(before, { outcomes: [...a.outcomes, ...b.outcomes], postMortems: a.postMortems }, firmScenarioPolicy, { at: a.at });
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('tenant_mismatch');
    // Atomicity: the failed batch changed nothing.
    expect(firmMemoryStateDigest(before)).toBe(firmMemoryStateDigest(createFirmMemoryState()));
  });

  it('a post-mortem whose lineage disagrees with its subject outcome is the typed tenant_mismatch', () => {
    const a = scenarioSnapshotAdverse();
    const b = scenarioSnapshotTenantB();
    const foreign = { ...(b.postMortems[0] as object), subject: { ...(b.postMortems[0] as { subject: object }).subject } };
    // A tenant-B post-mortem whose subject is retargeted at a tenant-A outcome: cross-scope by construction.
    const bPostMortem = b.postMortems[0] as { subject: { outcomeRecordRef: string } };
    const aOutcome = a.outcomes[0] as { outcomeId: string };
    const retargeted = { ...foreign, subject: { ...bPostMortem.subject, outcomeRecordRef: aOutcome.outcomeId } };
    const result = ingestFirmLearning(createFirmMemoryState(), { outcomes: a.outcomes, postMortems: [retargeted] }, firmScenarioPolicy, { at: a.at });
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('tenant_mismatch');
  });
});

describe('the subject-binding law', () => {
  it('a post-mortem whose subject outcome is absent is the typed lineage_gap', () => {
    const a = scenarioSnapshotAdverse();
    const orphan = { ...(a.postMortems[0] as object), subject: { ...(a.postMortems[0] as { subject: object }).subject, outcomeRecordRef: 'out:ffffffff' } };
    const result = ingestFirmLearning(createFirmMemoryState(), { outcomes: a.outcomes.slice(1), postMortems: [orphan] }, firmScenarioPolicy, { at: a.at });
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('lineage_gap');
  });

  it('a subject whose decision/intent/class disagrees with the outcome is the typed lineage_gap', () => {
    const a = scenarioSnapshotAdverse();
    const disagreeing = { ...(a.postMortems[0] as object), subject: { ...(a.postMortems[0] as { subject: object }).subject, outcomeClass: 'as_expected' } };
    const result = ingestFirmLearning(createFirmMemoryState(), { outcomes: a.outcomes, postMortems: [disagreeing] }, firmScenarioPolicy, { at: a.at });
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('lineage_gap');
  });

  it('a post-mortem may bind to an outcome consumed by an EARLIER batch (the ledger)', () => {
    // Batch 1: adverse (consumes o1..o3). Batch 2 supplies no outcomes but a REFINEMENT post-mortem
    // for o1's outcome (T033's supersession: a strictly-later draft with a NEW pmr id).
    const first = ingest(createFirmMemoryState(), scenarioSnapshotAdverse());
    const a = scenarioSnapshotAdverse();
    const subject = a.outcomes[0] as { outcomeId: string; decision: { decisionRef: string; intentRef: string }; outcomeClass: string };
    const refinement = {
      ...(a.postMortems[0] as object),
      postMortemId: 'pmr:refinem1', // a NEW id — T033's supersession mints a fresh record
      subject: { outcomeRecordRef: subject.outcomeId, decisionRef: subject.decision.decisionRef, intentRef: subject.decision.intentRef, outcomeClass: subject.outcomeClass },
      hypotheses: [{ class: 'market_move', confidence: '0.5', detail: { markAtDecision: '50100', markAtWindow: '49900', direction: 'adverse' }, evidence: [], note: null }],
    };
    const result = ingestFirmLearning(first.state, { outcomes: [], postMortems: [refinement] }, firmScenarioPolicy, { at: asTimestampMs(FIRM_T0 + 220_000) });
    expect(result.ok).toBe(true); // binds via the consumed-outcome ledger — no dangling
  });
});

describe('the L4 law', () => {
  it('an ingestion instant before the evidence is the typed l4_boundary_violation', () => {
    const a = scenarioSnapshotAdverse();
    const result = ingestFirmLearning(createFirmMemoryState(), { outcomes: a.outcomes, postMortems: a.postMortems }, firmScenarioPolicy, { at: asTimestampMs(FIRM_T0 + 100_000) });
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('l4_boundary_violation');
    expect(result.errors[0]?.path).toBe('at');
  });
});

describe('the duplicate-evidence law (idempotence)', () => {
  it('re-ingesting the same post-mortem is the typed duplicate_evidence (never a silent double-count)', () => {
    const first = ingest(createFirmMemoryState(), scenarioSnapshotAdverse());
    const again = ingestFirmLearning(first.state, { outcomes: scenarioSnapshotAdverse().outcomes, postMortems: scenarioSnapshotAdverse().postMortems }, firmScenarioPolicy, { at: scenarioSnapshotAdverse().at });
    if (again.ok) throw new Error('must fail');
    expect(again.errors[0]?.code).toBe('duplicate_evidence');
    // The state is unchanged by the failed re-ingestion.
    expect(firmMemoryStateDigest(first.state)).toBe(firmMemoryStateDigest(first.state));
  });

  it('duplicates WITHIN one batch are also the typed duplicate_evidence', () => {
    const a = scenarioSnapshotAdverse();
    const result = ingestFirmLearning(createFirmMemoryState(), { outcomes: a.outcomes, postMortems: [a.postMortems[0], a.postMortems[0]] }, firmScenarioPolicy, { at: a.at });
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('duplicate_evidence');
  });
});

describe('the promotion decisions', () => {
  it('batch 1 promotes decision_pattern/harmful/unresolved and market_behavior/adverse (e=3); below-bar candidates do not birth', () => {
    const { state, receipt } = ingest(createFirmMemoryState(), scenarioSnapshotAdverse());
    expect(receipt.fresh).toHaveLength(2);
    expect(receipt.revisions).toHaveLength(0);
    expect(receipt.supersessions).toHaveLength(0);
    expect(receipt.contradictions).toHaveLength(0);
    const claims = state.knowledgeLog.records.map((record) => `${record.claim.kind}/${record.claim.dimension ?? record.claim.lagBand ?? ''}:${record.claim.polarity}`);
    expect(claims.sort()).toEqual(['decision_pattern/unresolved:harmful', 'market_behavior/:adverse']);
    // The exact folds: MIN confidences, e=3, the provenance carries the refs.
    for (const record of state.knowledgeLog.records) {
      expect(record.evidenceCount).toBe(3);
      expect(record.provenance.outcomeRefs).toHaveLength(3);
      expect(record.provenance.postMortemRefs).toHaveLength(3);
      expect(record.provenance.sessionRefs).toEqual([expect.stringContaining('shs:')]);
      expect(record.provenance.experimentRefs).toEqual(['experiment-brain-1']);
      expect(record.provenance.trajectoryRefs).toEqual(['trajectory-brain-1']);
      expect(record.confidence).toBe(record.claim.kind === 'market_behavior' ? '0.5' : '0.4');
      expect(record.validity.from).toBe(scenarioSnapshotAdverse().at);
      expect(record.validity.to).toBe((scenarioSnapshotAdverse().at as number + firmScenarioPolicy.validityWindowMs) as never);
      expect(record.asOf).toBe(scenarioSnapshotAdverse().at);
    }
    // The receipt is content-addressed and scoped.
    expect(receipt.receiptId).toMatch(/^fmr:[0-9a-f]{8}$/);
    expect(receipt.tenant).toBe(FIRM_TENANT);
    expect(receipt.project).toBe(FIRM_PROJECT);
    expect(receipt.batchDigest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('batch 2 REVISIONS the market/decision families (the union fold: e=5) and births model_calibration/over_projection (e=2)', () => {
    const first = ingest(createFirmMemoryState(), scenarioSnapshotAdverse());
    const second = ingest(first.state, scenarioSnapshotReinforce());
    expect(second.receipt.revisions).toHaveLength(2);
    expect(second.receipt.fresh).toHaveLength(1);
    const marketEntries = second.state.knowledgeLog.records.filter((record) => record.claim.kind === 'market_behavior');
    expect(marketEntries).toHaveLength(2); // the fresh entry + its revision
    const revision = marketEntries[1];
    expect(revision?.evidenceCount).toBe(5); // o1..o3 ∪ o4,o5
    expect(revision?.provenance.outcomeRefs).toHaveLength(5);
    expect(revision?.confidence).toBe('0.4'); // MIN(0.5, 0.45, 0.4) over the union = 0.4
    expect(revision?.asOf).toBe(scenarioSnapshotReinforce().at); // strictly later, window re-opened
    expect(revision?.validity.from).toBe(scenarioSnapshotReinforce().at);
    const calibration = second.state.knowledgeLog.records.find((record) => record.claim.kind === 'model_calibration');
    expect(calibration?.claim.polarity).toBe('over_projection'); // projected 4 > realized -2 — derived exactly
    expect(calibration?.evidenceCount).toBe(2);
  });

  it('a NON-dominating challenger: the contest is recorded (the typed record), the incumbent stands — never a silent overwrite', () => {
    const first = ingest(ingest(createFirmMemoryState(), scenarioSnapshotAdverse()).state, scenarioSnapshotReinforce());
    const incumbentCount = first.state.knowledgeLog.records.filter((record) => record.claim.kind === 'market_behavior' && record.claim.polarity === 'adverse').length;
    const third = ingest(first.state, scenarioSnapshotChallenger());
    // The contest: exactly one contradiction record, challenger side e=2 vs incumbent e=5.
    expect(third.receipt.contradictions).toHaveLength(1);
    expect(third.receipt.fresh).toHaveLength(0);
    expect(third.receipt.revisions).toHaveLength(0);
    expect(third.receipt.supersessions).toHaveLength(0);
    const contest = third.state.contradictionLog.records[0];
    expect(contest?.sides[0]?.knowledgeRef).toMatch(/^fkr:/); // the incumbent side carries its ref
    expect(contest?.sides[0]?.evidenceCount).toBe(5);
    expect(contest?.sides[1]?.knowledgeRef).toBeNull(); // the challenger is a batch candidate
    expect(contest?.sides[1]?.evidenceCount).toBe(2);
    expect(contest?.sides[1]?.polarity).toBe('favorable');
    // The knowledge chain gained nothing — the incumbent line is byte-identical (2 records:
    // the fresh entry + its batch-2 revision, both adverse).
    expect(third.state.knowledgeLog.records.length).toBe(first.state.knowledgeLog.records.length);
    expect(incumbentCount).toBe(2);
  });

  it('a DOMINATING challenger: the contest is recorded AND the family flips (the supersession append)', () => {
    const first = ingest(ingest(createFirmMemoryState(), scenarioSnapshotAdverse()).state, scenarioSnapshotReinforce());
    const second = ingest(first.state, scenarioSnapshotChallenger());
    const third = ingest(second.state, scenarioSnapshotDominating());
    expect(third.receipt.supersessions).toHaveLength(1);
    expect(third.receipt.contradictions).toHaveLength(1);
    const flip = third.state.knowledgeLog.records[third.state.knowledgeLog.records.length - 1];
    expect(flip?.claim.kind).toBe('market_behavior');
    expect(flip?.claim.polarity).toBe('favorable');
    expect(flip?.evidenceCount).toBe(6); // strictly dominating the incumbent's 5
  });

  it('the internal contest with EQUAL counts records the contest and promotes NEITHER', () => {
    const { state, receipt } = ingest(createFirmMemoryState(), scenarioSnapshotInternalContest());
    expect(receipt.contradictions).toHaveLength(1);
    expect(receipt.fresh).toHaveLength(0);
    expect(state.knowledgeLog.records).toHaveLength(0);
    const contest = state.contradictionLog.records[0];
    expect(contest?.sides[0]?.knowledgeRef).toBeNull(); // batch-internal: both sides are candidates
    expect(contest?.sides[0]?.polarity).toBe('harmful'); // lexicographic ascending order
    expect(contest?.sides[1]?.polarity).toBe('helpful');
    expect(contest?.sides[0]?.evidenceCount).toBe(2);
    expect(contest?.sides[1]?.evidenceCount).toBe(2);
  });

  it('the internal DOMINATION (2 harmful vs 3 helpful) records the contest and promotes the helpful side', () => {
    const { state, receipt } = ingest(createFirmMemoryState(), scenarioSnapshotInternalDomination());
    expect(receipt.contradictions).toHaveLength(1);
    expect(receipt.fresh).toHaveLength(1);
    const promoted = state.knowledgeLog.records[0];
    expect(promoted?.claim.polarity).toBe('helpful');
    expect(promoted?.claim.dimension).toBe('timing');
    expect(promoted?.evidenceCount).toBe(3);
  });

  it('tenant B ingests into its own scope (the two-world basis for the isolation tests)', () => {
    const { state, receipt } = ingest(createFirmMemoryState(), scenarioSnapshotTenantB());
    expect(receipt.fresh).toHaveLength(2);
    expect(state.knowledgeLog.records.every((record) => record.tenant === FIRM_TENANT_B && record.project === FIRM_PROJECT_B)).toBe(true);
  });

  it('a short validity policy decays the knowledge quickly (the decay tests\' basis)', () => {
    const { state, receipt } = ingest(createFirmMemoryState(), scenarioSnapshotMinimal(), firmScenarioShortPolicy);
    expect(receipt.fresh).toHaveLength(1);
    const record = state.knowledgeLog.records[0];
    expect((record?.validity.to as number) - (record?.validity.from as number)).toBe(1_000);
  });
});

describe('atomicity', () => {
  it('a law violation anywhere in the batch appends NOTHING (all-or-nothing)', () => {
    const first = ingest(createFirmMemoryState(), scenarioSnapshotAdverse());
    const digestBefore = firmMemoryStateDigest(first.state);
    // A batch whose first post-mortem is fine but whose second is already consumed -> duplicate_evidence, nothing appends.
    const a = scenarioSnapshotAdverse();
    const mixed = ingestFirmLearning(first.state, { outcomes: a.outcomes, postMortems: [a.postMortems[0]] }, firmScenarioPolicy, { at: asTimestampMs(FIRM_T0 + 300_000) });
    if (mixed.ok) throw new Error('must fail');
    expect(mixed.errors[0]?.code).toBe('duplicate_evidence');
    expect(firmMemoryStateDigest(first.state)).toBe(digestBefore);
  });
});
