/**
 * The T031 integrity suite: the adoption gate (the holdout distinction,
 * the hidden-trials law, the refusal vocabulary) and the search-trial
 * mint (content addressing, the improvement DAG, the guard failures).
 */

import { describe, expect, it } from 'vitest';
import {
  AUTO_DATASET,
  AUTO_PROJECT,
  AUTO_SPLIT,
  AUTO_T2,
  AUTO_TENANT,
  evaluateAdoptionGate,
  mintImprovementSearchTrial,
  scenarioEvaluations,
  scenarioSearchPolicy,
  scenarioSearchRecord,
} from './index';
import type { EvaluatedEvidenceMirror } from './index';

/** Assert the failure helper (accepts any ImprovementResult shape). */
function expectFailure(result: unknown, code: string): void {
  const outcome = result as { ok: boolean; errors?: readonly { code: string; message: string }[] };
  expect(outcome.ok).toBe(false);
  expect(outcome.errors?.[0]?.code).toBe(code);
}

describe('evaluateAdoptionGate: the holdout distinction', () => {
  it('releases on an attained HOLDOUT verdict (the grounding cites it)', () => {
    const gate = evaluateAdoptionGate(scenarioSearchRecord(), scenarioEvaluations(), true);
    expect(gate.ok).toBe(true);
    if (!gate.ok) throw new Error('unreachable');
    expect(gate.value.decision).toBe('commissioned');
    expect(gate.value.refusal).toBeNull();
    expect(gate.value.grounding).toEqual([
      { verdict: 'verdict-auto-holdout', trial: 'trial-auto-holdout', classification: 'holdout' },
    ]);
  });

  it('withholds in-search-only attained evidence: selected_without_holdout (the best-of-N trap)', () => {
    const inSearchOnly = scenarioEvaluations().filter((evaluation) => evaluation.trial !== 'trial-auto-holdout');
    const gate = evaluateAdoptionGate(scenarioSearchRecord(), inSearchOnly, true);
    expect(gate.ok).toBe(true);
    if (!gate.ok) throw new Error('unreachable');
    expect(gate.value.decision).toBe('withheld');
    expect(gate.value.refusal).toBe('selected_without_holdout');
    expect(gate.value.grounding).toEqual([]);
  });

  it('withholds empty evidence: evidence_missing', () => {
    const gate = evaluateAdoptionGate(scenarioSearchRecord(), [], true);
    expect(gate.ok).toBe(true);
    if (!gate.ok) throw new Error('unreachable');
    expect(gate.value.decision).toBe('withheld');
    expect(gate.value.refusal).toBe('evidence_missing');
  });

  it('withholds present-but-never-attained evidence: evidence_insufficient', () => {
    const neverAttained: readonly EvaluatedEvidenceMirror[] = [
      { verdict: 'verdict-auto-holdout', attained: false, trial: 'trial-auto-holdout', criteria: 'criteria-auto@1', evidenceRef: 'evidence-auto-holdout' },
    ];
    const gate = evaluateAdoptionGate(scenarioSearchRecord(), neverAttained, true);
    expect(gate.ok).toBe(true);
    if (!gate.ok) throw new Error('unreachable');
    expect(gate.value.decision).toBe('withheld');
    expect(gate.value.refusal).toBe('evidence_insufficient');
  });

  it('the policy switch: requiresHoldout=false releases on an attained IN-SEARCH verdict (the switch is the policy\'s)', () => {
    const inSearchOnly = scenarioEvaluations().filter((evaluation) => evaluation.trial !== 'trial-auto-holdout');
    const gate = evaluateAdoptionGate(scenarioSearchRecord(), inSearchOnly, false);
    expect(gate.ok).toBe(true);
    if (!gate.ok) throw new Error('unreachable');
    expect(gate.value.decision).toBe('commissioned');
    expect(gate.value.grounding).toEqual([
      { verdict: 'verdict-auto-insearch', trial: 'trial-auto-insearch', classification: 'in-search' },
    ]);
  });

  it('cited evidence naming an unretained trial is hidden_trials — fail-closed, naming every ghost', () => {
    const ghosts: readonly EvaluatedEvidenceMirror[] = [
      { verdict: 'verdict-ghost-1', attained: true, trial: 'trial-ghost-1', criteria: 'c', evidenceRef: 'e1' },
      { verdict: 'verdict-ghost-2', attained: false, trial: 'trial-ghost-2', criteria: 'c', evidenceRef: 'e2' },
    ];
    const gate = evaluateAdoptionGate(scenarioSearchRecord(), ghosts, true);
    expectFailure(gate, 'hidden_trials');
    const message = (gate as unknown as { errors: { message: string }[] }).errors[0]?.message ?? '';
    expect(message).toContain('trial-ghost-1');
    expect(message).toContain('trial-ghost-2');
  });

  it('a single ghost among real evidence still fails the whole gate (never a silent drop)', () => {
    const mixed: readonly EvaluatedEvidenceMirror[] = [
      ...scenarioEvaluations(),
      { verdict: 'verdict-ghost-1', attained: true, trial: 'trial-ghost-1', criteria: 'c', evidenceRef: 'e1' },
    ];
    const gate = evaluateAdoptionGate(scenarioSearchRecord(), mixed, true);
    expectFailure(gate, 'hidden_trials');
  });
});

describe('mintImprovementSearchTrial: the trial mint', () => {
  it('mints a deterministic, content-addressed, in-search bundle with the improvement DAG edges', () => {
    const first = mintImprovementSearchTrial({
      kind: 'curriculum_revision',
      productId: 'alv:aaaaaaaa',
      config: { product: 'curriculum_revision', revision: 'alv:aaaaaaaa' },
      parents: [],
      policy: scenarioSearchPolicy(),
      at: AUTO_T2,
      tenant: AUTO_TENANT,
      project: AUTO_PROJECT,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    expect(first.value.trial).toMatch(/^alt:[0-9a-f]{8}$/);
    expect(first.value.classification).toBe('in-search');
    expect(first.value.splits).toEqual([AUTO_SPLIT]);
    expect(first.value.datasets).toEqual([AUTO_DATASET]);
    expect(first.value.evaluation_policy).toBe(AUTO_SPLIT);
    expect(first.value.window).toBeNull();

    const second = mintImprovementSearchTrial({
      kind: 'curriculum_revision',
      productId: 'alv:aaaaaaaa',
      config: { product: 'curriculum_revision', revision: 'alv:aaaaaaaa' },
      parents: [first.value.trial],
      policy: scenarioSearchPolicy(),
      at: AUTO_T2,
      tenant: AUTO_TENANT,
      project: AUTO_PROJECT,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(second.value.parents).toEqual([first.value.trial]);

    // Same inputs -> same trial id (the content-addressing law).
    const again = mintImprovementSearchTrial({
      kind: 'curriculum_revision',
      productId: 'alv:aaaaaaaa',
      config: { product: 'curriculum_revision', revision: 'alv:aaaaaaaa' },
      parents: [],
      policy: scenarioSearchPolicy(),
      at: AUTO_T2,
      tenant: AUTO_TENANT,
      project: AUTO_PROJECT,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error('unreachable');
    expect(again.value.trial).toBe(first.value.trial);

    // Different content -> different address.
    expect(second.value.trial).not.toBe(first.value.trial);
  });

  it('refuses malformed mints with typed errors', () => {
    expectFailure(
      mintImprovementSearchTrial({
        kind: 'nope' as never,
        productId: 'alv:aaaaaaaa',
        config: {},
        parents: [],
        policy: scenarioSearchPolicy(),
        at: AUTO_T2,
        tenant: AUTO_TENANT,
        project: AUTO_PROJECT,
      }),
      'invalid_field',
    );
    expectFailure(
      mintImprovementSearchTrial({
        kind: 'skill_commission',
        productId: '',
        config: {},
        parents: [],
        policy: scenarioSearchPolicy(),
        at: AUTO_T2,
        tenant: AUTO_TENANT,
        project: AUTO_PROJECT,
      }),
      'invalid_field',
    );
    expectFailure(
      mintImprovementSearchTrial({
        kind: 'skill_commission',
        productId: 'als:aaaaaaaa',
        config: {},
        parents: [],
        policy: { evaluationPolicy: '', splits: [AUTO_SPLIT], datasets: [] } as never,
        at: AUTO_T2,
        tenant: AUTO_TENANT,
        project: AUTO_PROJECT,
      }),
      'invalid_field',
    );
  });
});
