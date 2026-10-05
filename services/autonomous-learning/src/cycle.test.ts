/**
 * The improvement-cycle behavioral suite: the loop's whole pipeline — the
 * products (gaps / revision / commission / feed / search trials), the
 * agenda's honesty (the focus table, the no-gap rows, the active-only
 * annotation), the safety laws, and EVERY gate's typed failure path.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTO_HOLDOUT_TRIAL,
  AUTO_IN_SEARCH_TRIAL,
  AUTO_KNOWLEDGE_HEAD,
  AUTO_PROJECT,
  AUTO_SESSION,
  AUTO_TENANT,
  AUTO_TRAJECTORY,
  AUTO_T2,
  GOLDEN_EXECUTION_ANNOTATION,
  ImprovementCycleInputs,
  ImprovementPolicy,
  OutcomeLearningHookMirror,
  capabilityKeyOf,
  createAutonomousLearningState,
  isImprovementCycleRecord,
  runImprovementCycle,
  scenarioCycleInputs,
  scenarioExpectedGapKinds,
  scenarioHooks,
  scenarioOutcomes,
  scenarioPolicy,
  scenarioSearchRecord,
} from './index';
import type { ImprovementCycleRecord } from './index';

/** Run the scenario cycle; throw on failure (the happy-path helper). */
function runScenario(): ReturnType<typeof runImprovementCycle> {
  return runImprovementCycle(createAutonomousLearningState(), scenarioCycleInputs());
}

/** Clone the scenario inputs with an override. */
function inputsWith(override: Partial<ImprovementCycleInputs>): ImprovementCycleInputs {
  return { ...scenarioCycleInputs(), ...override } as ImprovementCycleInputs;
}

describe('the improvement cycle: the products', () => {
  it('mints the typed capability gaps from the failure hooks (the declared focus table)', () => {
    const result = runScenario();
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    const { cycle, products } = result.value;
    expect(products.gaps.map((gap) => gap.kind)).toEqual([...scenarioExpectedGapKinds()]);
    expect(cycle.gaps).toEqual(products.gaps.map((gap) => gap.gapId));
    for (const gap of products.gaps) {
      expect(gap.gapId).toMatch(/^alg:[0-9a-f]{8}$/);
      expect(gap.tenantId).toBe(AUTO_TENANT);
      expect(gap.projectId).toBe(AUTO_PROJECT);
      expect(gap.detectedAt).toBe(products.gaps[0] === gap ? AUTO_T2 - 1_000 : AUTO_T2 - 1_000);
    }
    // The evidence refs are the REAL hook ids (the failure evidence, content-addressed).
    const hookIds = new Set(scenarioHooks().map((hook) => hook.hookId));
    for (const gap of products.gaps) expect(hookIds.has(gap.evidenceRef)).toBe(true);
    // The capability keys are the declared derivations (L16a — a contract, never a label).
    expect(products.gaps[0]?.capabilityKey).toBe(capabilityKeyOf('execution', 'execution_quality'));
    expect(products.gaps[1]?.capabilityKey).toBe(capabilityKeyOf('regime', 'strategy_revision'));
  });

  it('grounds NO gap for the honest no-gap rows (data_pipeline stays an infrastructure fact)', () => {
    const result = runScenario();
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    // The data_pipeline hook (adverse_gap + data_lag) mints nothing; the
    // as-expected hook (focus none) mints nothing.
    expect(result.value.products.gaps).toHaveLength(2);
  });

  it('assembles the curriculum revision: the T015 plan-input bundle, brain-annotated', () => {
    const result = runScenario();
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    const revision = result.value.products.revision;
    if (revision === null) throw new Error('the scenario must mint a revision');
    expect(revision.kind).toBe('curriculum-revision');
    expect(revision.revisionId).toMatch(/^alv:[0-9a-f]{8}$/);
    expect(revision.planInput.current).toBe('synthetic_regimes'); // the trail's earned rung
    expect(revision.planInput.gaps.map((gap) => gap.gapId)).toEqual(result.value.cycle.gaps);
    expect(revision.planInput.tenant).toBe(AUTO_TENANT);
    expect(revision.knowledgeHead).toBe(AUTO_KNOWLEDGE_HEAD);
    // The annotations join the brain's ACTIVE knowledge of the declared kinds
    // (the decayed market_behavior entry never annotates).
    expect(revision.annotations).toHaveLength(2);
    expect(revision.annotations[0]?.relatedKnowledge).toEqual(GOLDEN_EXECUTION_ANNOTATION);
    expect(revision.annotations[1]?.relatedKnowledge).toEqual(GOLDEN_EXECUTION_ANNOTATION);
  });

  it('assembles the skill commission: the T017 bundle, adoption-gated on the holdout verdict', () => {
    const result = runScenario();
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    const commission = result.value.products.commission;
    if (commission === null) throw new Error('the scenario must mint a commission');
    expect(commission.kind).toBe('skill-commission');
    expect(commission.status).toBe('commissioned');
    expect(commission.refusal).toBeNull();
    // The commissioning focuses in the CLOSED focus order (deterministic).
    expect(commission.focuses).toEqual(['strategy_revision', 'execution_quality']);
    // The evidence block is the T017 ForgeEvidence shape: the REAL trajectory
    // binding + the evaluated trials + the verdicts, sorted-deduped.
    expect(commission.evidence.trajectoryRefs).toEqual([AUTO_TRAJECTORY]);
    expect(commission.evidence.trialRefs).toEqual([AUTO_HOLDOUT_TRIAL, AUTO_IN_SEARCH_TRIAL].sort());
    expect(commission.evidence.verdictRefs).toEqual(['verdict-auto-holdout', 'verdict-auto-insearch']);
    // The grounding cites the attained HOLDOUT verdict — the gate's release basis.
    expect(commission.grounding).toEqual([{ verdict: 'verdict-auto-holdout', trial: AUTO_HOLDOUT_TRIAL, classification: 'holdout' }]);
  });

  it('assembles the memory feed: the T034 snapshot, records VERBATIM', () => {
    const result = runScenario();
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    const feed = result.value.products.memory;
    if (feed === null) throw new Error('the scenario must mint a memory feed');
    expect(feed.kind).toBe('memory-feed');
    expect(feed.feedId).toMatch(/^alm:[0-9a-f]{8}$/);
    expect(feed.snapshot.outcomes).toEqual([...scenarioOutcomes()]);
    expect(feed.snapshot.postMortems).toHaveLength(3);
    expect(feed.at).toBe(AUTO_T2);
  });

  it('mints the search trials for the revision and the RELEASED commission (L11)', () => {
    const result = runScenario();
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    const { cycle, products } = result.value;
    expect(products.searchTrials).toHaveLength(2);
    expect(products.searchTrials[0]?.trial).toBe(cycle.revisionTrial);
    expect(products.searchTrials[1]?.trial).toBe(cycle.commissionTrial);
    for (const trial of products.searchTrials) {
      expect(trial.trial).toMatch(/^alt:[0-9a-f]{8}$/);
      expect(trial.classification).toBe('in-search'); // an improvement proposal is an optimization step
      expect(trial.arm).toBeNull();
      expect(trial.parents).toEqual([]); // the first cycle has no improvement DAG ancestors
      expect(trial.tenant).toBe(AUTO_TENANT);
      expect(trial.recorded_at).toBe(AUTO_T2);
    }
    // The configs cite the product ids.
    expect(products.searchTrials[0]?.config).toMatchObject({ product: 'curriculum_revision' });
    expect(products.searchTrials[1]?.config).toMatchObject({ product: 'skill_commission' });
  });

  it('appends the cycle record and extends the consumed-hooks ledger', () => {
    const result = runScenario();
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    const { cycle, state } = result.value;
    expect(isImprovementCycleRecord(cycle)).toBe(true);
    expect(cycle.ordinal).toBe(1);
    expect(cycle.consumedHooks).toEqual(scenarioHooks().map((hook) => hook.hookId));
    expect(state.log.cycles).toHaveLength(1);
    expect(state.consumedHooks).toHaveLength(4);
    expect(state.consumedHooks.every((entry) => entry.cycleOrdinal === 1)).toBe(true);
  });
});

describe('the improvement cycle: the agenda honesty + the safety laws', () => {
  it('a cycle of only neutral hooks mints NOTHING but the memory feed (the honest quiet cycle)', () => {
    const neutral = scenarioHooks().filter((hook) => hook.suggestedFocus === 'none');
    const result = runImprovementCycle(
      createAutonomousLearningState(),
      inputsWith({ hooks: neutral }),
    );
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    const { cycle, products } = result.value;
    expect(products.gaps).toHaveLength(0);
    expect(products.revision).toBeNull();
    expect(products.commission).toBeNull();
    expect(products.searchTrials).toHaveLength(0);
    expect(products.memory).not.toBeNull();
    expect(cycle.commissionStatus).toBe('none');
    expect(cycle.revision).toBeNull();
    expect(cycle.revisionTrial).toBeNull();
    expect(cycle.commissionTrial).toBeNull();
  });

  it('the plan input NEVER carries a live-permission record (the loop never grants live execution)', () => {
    const result = runScenario();
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    const planInput = result.value.products.revision?.planInput as unknown as Record<string, unknown>;
    expect(planInput.live_permission).toBeUndefined();
    expect(Object.keys(planInput).sort()).toEqual(['candidate', 'constraints', 'current', 'gaps', 'goal', 'project', 'seed', 'tenant'].sort());
  });

  it('a second cycle progresses the loop: new hooks mint new gaps and the trials gain parents', () => {
    const first = runScenario();
    if (!first.ok) throw new Error(first.errors.map((error) => error.message).join('; '));
    // The second cycle: only the execution hook re-appears (new id — a new
    // outcome), plus the in-search evidence (the holdout verdict is gone).
    const secondHook: OutcomeLearningHookMirror = {
      ...(scenarioHooks()[0] as OutcomeLearningHookMirror),
      hookId: 'olh:secondcycle',
      outcomeRecordRef: 'out:auto0005',
      decisionRef: 'decision-auto-5',
      intentRef: 'intent-auto-5',
    };
    const second = runImprovementCycle(
      first.value.state,
      inputsWith({
        at: (AUTO_T2 + 5_000) as never,
        hooks: [secondHook],
        outcomes: [...scenarioOutcomes()].slice(0, 1),
        postMortems: [],
        evaluations: [{ verdict: 'verdict-auto-insearch', attained: true, trial: AUTO_IN_SEARCH_TRIAL, criteria: 'criteria-auto@1', evidenceRef: 'evidence-auto-insearch' }],
      }),
    );
    if (!second.ok) throw new Error(second.errors.map((error) => error.message).join('; '));
    const { cycle, products } = second.value;
    expect(cycle.ordinal).toBe(2);
    expect(products.gaps).toHaveLength(1);
    expect(cycle.gaps).toHaveLength(1);
    // The commission is WITHHELD: only in-search attained evidence exists now.
    expect(products.commission?.status).toBe('withheld');
    expect(products.commission?.refusal).toBe('selected_without_holdout');
    expect(cycle.commissionStatus).toBe('withheld');
    // The WITHHELD commission mints NO trial; the revision's trial gains the
    // first cycle's revision trial as its parent (the improvement DAG).
    expect(cycle.commissionTrial).toBeNull();
    expect(products.searchTrials).toHaveLength(1);
    expect(products.searchTrials[0]?.parents).toEqual([first.value.cycle.revisionTrial]);
    expect(cycle.revisionTrial).not.toBe(first.value.cycle.revisionTrial);
  });
});

describe('the improvement cycle: every gate fails closed with its typed error', () => {
  it('an invalid state is invalid_type', () => {
    const result = runImprovementCycle({ not: 'a state' }, scenarioCycleInputs());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_type');
  });

  it('a tampered improvement log never drives the next cycle (chain_mismatch)', () => {
    const first = runScenario();
    if (!first.ok) throw new Error(first.errors.map((error) => error.message).join('; '));
    const records = [...first.value.state.log.cycles];
    const tampered = {
      ...first.value.state,
      log: {
        cycles: [{ ...(records[0] as ImprovementCycleRecord), at: 1 }, ...records.slice(1)],
        chain: [...first.value.state.log.chain],
      },
    };
    const second = runImprovementCycle(tampered, inputsWith({ hooks: [] }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a hook consumed by an earlier cycle is duplicate_evidence (the idempotence ledger)', () => {
    const first = runScenario();
    if (!first.ok) throw new Error(first.errors.map((error) => error.message).join('; '));
    const second = runImprovementCycle(first.value.state, inputsWith({}));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.errors[0]?.code).toBe('duplicate_evidence');
      expect(second.errors[0]?.message).toContain('EXACTLY ONCE');
    }
  });

  it('a hook re-supplied within one batch is duplicate_evidence', () => {
    const hooks = [...scenarioHooks()];
    const doubled = [...hooks, hooks[0] as OutcomeLearningHookMirror];
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ hooks: doubled }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('duplicate_evidence');
  });

  it('a malformed hook fails its mirror (invalid_field) — the closed vocabularies', () => {
    const rogue = { ...scenarioHooks()[0], suggestedFocus: 'vibes' } as unknown as OutcomeLearningHookMirror;
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ hooks: [rogue] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');
    const rogueId = { ...scenarioHooks()[0], hookId: 'not-an-olh-id' } as unknown as OutcomeLearningHookMirror;
    const result2 = runImprovementCycle(createAutonomousLearningState(), inputsWith({ hooks: [rogueId] }));
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.errors[0]?.code).toBe('invalid_field');
  });

  it('a future-dated hook is l4_boundary_violation (the loop never improves on future evidence)', () => {
    const future = { ...scenarioHooks()[0], asOf: (AUTO_T2 + 1) as never } as OutcomeLearningHookMirror;
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ hooks: [future] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('l4_boundary_violation');
  });

  it('a future-dated outcome record is l4_boundary_violation', () => {
    const futureOutcome = { ...(scenarioOutcomes()[0] as object), asOf: (AUTO_T2 + 1) as never };
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ outcomes: [futureOutcome] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('l4_boundary_violation');
  });

  it('an outcome record without its shadow session lineage is invalid_field (the L15 root)', () => {
    const orphan = { outcomeId: 'out:auto0009', tenant: AUTO_TENANT, project: AUTO_PROJECT, asOf: AUTO_T2, lineage: { shadow: {} } };
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ outcomes: [orphan] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');
  });

  it('a duplicate outcome within one feed is duplicate_evidence', () => {
    const doubled = [...scenarioOutcomes(), scenarioOutcomes()[0]];
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ outcomes: doubled }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('duplicate_evidence');
  });

  it('a tampered curriculum trail is chain_mismatch', () => {
    const trail = scenarioCycleInputs().trail;
    const tampered = {
      ...trail,
      records: [{ ...trail.records[0] as object, reason: 'evidenced_advance' }],
    };
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ trail: tampered as never }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a tampered search record is chain_mismatch', () => {
    const search = scenarioSearchRecord();
    const tampered = {
      ...search,
      entries: search.entries.map((entry, index) => (index === 0 ? { ...entry, classification: 'holdout' as const } : entry)),
    };
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ search: tampered }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('cited evidence naming an unretained trial is hidden_trials (fail-closed)', () => {
    const evaluations = [
      { verdict: 'verdict-ghost', attained: true, trial: 'trial-never-logged', criteria: 'criteria-auto@1', evidenceRef: 'evidence-ghost' },
    ];
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ evaluations }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('hidden_trials');
      expect(result.errors[0]?.message).toContain('trial-never-logged');
    }
  });

  it('an invalid policy is policy_invalid', () => {
    const brokenPolicy: ImprovementPolicy = { ...scenarioPolicy(), requiresHoldout: 'yes' as never };
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ policy: brokenPolicy }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_invalid');
  });

  it('a missing planning context is lineage_gap', () => {
    const result = runImprovementCycle(
      createAutonomousLearningState(),
      inputsWith({ planning: { goal: '', constraints: 'c', candidate: 'o', seed: 's' } as never }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('lineage_gap');
  });

  it('a missing instant is invalid_timestamp', () => {
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ at: 'now' as never }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_timestamp');
  });

  it('an absent scope is tenant_missing', () => {
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ tenant: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('tenant_missing');
  });

  it('a malformed search-record shape is invalid_field (the mirror before the chain)', () => {
    const result = runImprovementCycle(
      createAutonomousLearningState(),
      inputsWith({ search: { search_id: 'srch:x', entries: 'nope' } as never }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');
  });
});
