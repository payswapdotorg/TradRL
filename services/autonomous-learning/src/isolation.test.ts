/**
 * The tenant-isolation suite (L12/R25): ONE scope per cycle; every
 * consumed record of a foreign scope is the typed `tenant_scope_mismatch`
 * naming both scopes — never a silent drop, never a payload leak.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTO_PROJECT,
  AUTO_PROJECT_B,
  AUTO_TENANT,
  AUTO_TENANT_B,
  ImprovementCycleInputs,
  OutcomeLearningHookMirror,
  createAutonomousLearningState,
  runImprovementCycle,
  scenarioCycleInputs,
  scenarioHooks,
  scenarioKnowledge,
  scenarioOutcomes,
  scenarioPostMortems,
} from './index';
import type { CurriculumTrailMirror, SearchRecordMirror, ServedKnowledgeEnvelopeMirror, StageTransitionMirror, TransitionLineageMirror } from './index';
import { searchChainFoldMirror, searchChainGenesisMirror, trailChainSeedMirror, trailChainStepMirror } from './index';

/** Clone the scenario inputs with an override. */
function inputsWith(override: Partial<ImprovementCycleInputs>): ImprovementCycleInputs {
  return { ...scenarioCycleInputs(), ...override } as ImprovementCycleInputs;
}

/** Assert the single typed failure. */
function expectScopeMismatch(result: ReturnType<typeof runImprovementCycle>, path: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors[0]?.code).toBe('tenant_scope_mismatch');
    expect(result.errors[0]?.path).toBe(path);
    expect(result.errors[0]?.message).toContain(AUTO_TENANT_B);
    expect(result.errors[0]?.message).toContain(AUTO_TENANT);
  }
}

describe('the L12 law: one scope per cycle, foreign records refused typed', () => {
  it('a foreign-scope hook is tenant_scope_mismatch (a curriculum never trains on another scope\'s failures)', () => {
    const foreignHook: OutcomeLearningHookMirror = {
      ...scenarioHooks()[0],
      tenant: AUTO_TENANT_B,
      project: AUTO_PROJECT_B,
    };
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ hooks: [foreignHook] }));
    expectScopeMismatch(result, 'hooks[0]');
  });

  it('a foreign-scope outcome record is tenant_scope_mismatch (the brain never learns another scope\'s records)', () => {
    const foreignOutcome = { ...scenarioOutcomes()[0], tenant: AUTO_TENANT_B, project: AUTO_PROJECT_B };
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ outcomes: [foreignOutcome] }));
    expectScopeMismatch(result, 'outcomes[0]');
  });

  it('a foreign-scope post-mortem is tenant_scope_mismatch', () => {
    const foreign = {
      ...scenarioPostMortems()[0],
      lineage: { ...scenarioPostMortems()[0].lineage, tenant: AUTO_TENANT_B, project: AUTO_PROJECT_B },
    };
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ postMortems: [foreign] }));
    expectScopeMismatch(result, 'postMortems[0]');
  });

  it('a foreign-scope served-knowledge entry is tenant_scope_mismatch (the agenda never reads another scope\'s brain)', () => {
    const foreignKnowledge: ServedKnowledgeEnvelopeMirror = {
      ...scenarioKnowledge()[0],
      tenant: AUTO_TENANT_B,
      project: AUTO_PROJECT_B,
    };
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ knowledge: [foreignKnowledge] }));
    expectScopeMismatch(result, 'knowledge[0]');
  });

  it('a foreign-scope curriculum trail is tenant_scope_mismatch', () => {
    // Build a COHERENT foreign trail (the chain must verify under the foreign
    // lineage — the scope gate, not the chain gate, must catch this one).
    const foreignLineage = {
      ...scenarioCycleInputs().trail.lineage,
      tenant: AUTO_TENANT_B,
      project: AUTO_PROJECT_B,
    } as TransitionLineageMirror;
    const foreignRecords = (scenarioCycleInputs().trail.records as readonly StageTransitionMirror[]).map(
      (record) => ({ ...record, lineage: foreignLineage }) as StageTransitionMirror,
    );
    let head = trailChainSeedMirror(foreignLineage);
    const foreignChain: string[] = [];
    for (const record of foreignRecords) {
      head = trailChainStepMirror(head, record);
      foreignChain.push(head);
    }
    const foreignTrail = {
      lineage: foreignLineage,
      records: foreignRecords,
      record_chain: foreignChain,
    } as unknown as CurriculumTrailMirror;
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ trail: foreignTrail }));
    expectScopeMismatch(result, 'trail');
  });

  it('a foreign-scope search record is tenant_scope_mismatch', () => {
    // Build a COHERENT foreign record (the chain must verify under the foreign
    // binding — the scope gate, not the chain gate, must catch this one).
    const base = scenarioCycleInputs().search;
    const foreignEntries = base.entries.map((entry) => ({ ...entry, tenant: AUTO_TENANT_B, project: AUTO_PROJECT_B }));
    let head = searchChainGenesisMirror({ experiment: base.experiment, evaluator: base.evaluator, tenant: AUTO_TENANT_B, project: AUTO_PROJECT_B });
    for (const entry of foreignEntries) head = searchChainFoldMirror(head, entry);
    const foreignSearch = {
      ...base,
      tenant: AUTO_TENANT_B,
      project: AUTO_PROJECT_B,
      entries: foreignEntries,
      chain_head: head,
    } as SearchRecordMirror;
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ search: foreignSearch }));
    expectScopeMismatch(result, 'search');
  });

  it('the mixed-scope batch fails at the FIRST offender (an incoherent cycle never runs partially)', () => {
    // Two in-scope hooks + one foreign one at index 2: the failure names index 2.
    const hooks = [
      scenarioHooks()[0],
      scenarioHooks()[1],
      { ...scenarioHooks()[2], tenant: AUTO_TENANT_B, project: AUTO_PROJECT_B },
    ] as OutcomeLearningHookMirror[];
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ hooks }));
    expectScopeMismatch(result, 'hooks[2]');
    // Nothing was minted: the result carries no state at all.
    if (!result.ok) expect((result as { state?: unknown }).state).toBeUndefined();
  });

  it('a same-tenant/foreign-project record is tenant_scope_mismatch too (the project scope is L15 continuity)', () => {
    const crossProject: OutcomeLearningHookMirror = { ...scenarioHooks()[0], project: AUTO_PROJECT_B };
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ hooks: [crossProject] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('tenant_scope_mismatch');
  });

  it('the scope check precedes everything: no product of another scope can exist', () => {
    // A foreign hook with an in-scope gap-producing focus still mints NOTHING.
    const foreignHook: OutcomeLearningHookMirror = {
      ...scenarioHooks()[0],
      tenant: AUTO_TENANT_B,
      project: AUTO_PROJECT_B,
    };
    const result = runImprovementCycle(createAutonomousLearningState(), inputsWith({ hooks: [foreignHook] }));
    expect(result.ok).toBe(false);
    // And a second, in-scope cycle after the refused one is unaffected (the
    // refusal was total — no ledger entry, no partial state).
    const second = runScenarioCycle();
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.cycle.tenant).toBe(AUTO_TENANT);
  });
});

/** Run the plain scenario (the isolation-independence helper). */
function runScenarioCycle(): ReturnType<typeof runImprovementCycle> {
  return runImprovementCycle(createAutonomousLearningState(), scenarioCycleInputs());
}
