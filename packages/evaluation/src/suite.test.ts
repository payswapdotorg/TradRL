/**
 * Behavioral tests for @tradrl/evaluation suites: composition rules,
 * duplicate-member rejection, and THE L10 LAW — a release-grade suite
 * without an adversarial suite reference is a typed construction error
 * (`missing_adversarial_member`), while screening suites compose freely.
 */

import { describe, expect, it } from 'vitest';

import {
  createEvaluationSuite,
  isEvaluationSuite,
  isReleaseGradeSuite,
  isSuiteGrade,
  isSuiteMember,
  isSuiteMemberKind,
  SUITE_GRADES,
  SUITE_MEMBER_KINDS,
  suiteSplitPolicyRefs,
  type EvaluationSuite,
} from './index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RELEASE_SUITE_INPUT = {
  suiteId: 'suite.friction-2024q4',
  grade: 'release',
  evaluatorVersion: 'evaluator.friction-suite@3',
  members: [
    { kind: 'blind', splitPolicy: 'split.blind-2024q4', metricIds: ['metric.gate-ratio'] },
    { kind: 'walk-forward', splitPolicy: 'split.wf-anchored', metricIds: ['metric.gate-ratio', 'metric.blocking'] },
    { kind: 'regime', splitPolicy: 'split.regime-crisis', metricIds: ['metric.gate-ratio'] },
    { kind: 'cost', splitPolicy: 'split.cost-stress', metricIds: ['metric.blocking'] },
    { kind: 'latency', splitPolicy: 'split.latency-stress', metricIds: ['metric.blocking'] },
    { kind: 'adversarial', splitPolicy: 'split.adversarial-pop', metricIds: ['metric.gate-ratio'] },
    { kind: 'organization-ablation', splitPolicy: 'split.ablation-org', metricIds: ['metric.gate-ratio'] },
    { kind: 'model-substitution', splitPolicy: 'split.model-sub', metricIds: ['metric.gate-ratio'] },
  ],
  adversarialSuiteRefs: ['suite.adversarial-pop-1'],
} as const;

function releaseSuite(): EvaluationSuite {
  const result = createEvaluationSuite(RELEASE_SUITE_INPUT);
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

// ---------------------------------------------------------------------------
// Vocabulary and member guards
// ---------------------------------------------------------------------------

describe('suite vocabulary guards', () => {
  it('member kinds and grades are closed vocabularies', () => {
    expect(SUITE_MEMBER_KINDS).toHaveLength(8);
    for (const kind of SUITE_MEMBER_KINDS) expect(isSuiteMemberKind(kind)).toBe(true);
    expect(isSuiteMemberKind('friendly')).toBe(false); // L10 is adversarial or nothing
    expect(isSuiteMemberKind(7)).toBe(false);
    expect(SUITE_GRADES).toEqual(['screening', 'release']);
    expect(isSuiteGrade('release')).toBe(true);
    expect(isSuiteGrade('RELEASE')).toBe(false);
  });

  it('isSuiteMember enforces non-empty unique metric ids', () => {
    expect(isSuiteMember({ kind: 'blind', splitPolicy: 'p', metricIds: ['m'] })).toBe(true);
    expect(isSuiteMember({ kind: 'blind', splitPolicy: 'p', metricIds: [] })).toBe(false);
    expect(isSuiteMember({ kind: 'blind', splitPolicy: 'p', metricIds: ['m', 'm'] })).toBe(false);
    expect(isSuiteMember({ kind: 'blind', splitPolicy: '', metricIds: ['m'] })).toBe(false);
    expect(isSuiteMember({ kind: 'nope', splitPolicy: 'p', metricIds: ['m'] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

describe('createEvaluationSuite (composition rules)', () => {
  it('composes a full release suite covering every member kind', () => {
    const suite = releaseSuite();
    expect(isEvaluationSuite(suite)).toBe(true);
    expect(suite.members).toHaveLength(8);
    expect(suite.adversarialSuiteRefs).toEqual(['suite.adversarial-pop-1']);
    expect(isReleaseGradeSuite(suite)).toBe(true);
    expect(Object.isFrozen(suite)).toBe(true);
    expect(suiteSplitPolicyRefs(suite)[1]).toBe('split.wf-anchored');
  });

  it('L10: a release-grade suite WITHOUT adversarial coverage is a typed error', () => {
    const result = createEvaluationSuite({ ...RELEASE_SUITE_INPUT, adversarialSuiteRefs: [] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('missing_adversarial_member');
    expect(result.errors[0]?.message).toContain('L10');
  });

  it('screening suites compose without adversarial coverage (the cheap in-search gate)', () => {
    const result = createEvaluationSuite({
      ...RELEASE_SUITE_INPUT,
      grade: 'screening',
      adversarialSuiteRefs: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(isReleaseGradeSuite(result.value)).toBe(false);
  });

  it('rejects duplicate (kind, splitPolicy) members — the same layer under the same split twice', () => {
    const result = createEvaluationSuite({
      ...RELEASE_SUITE_INPUT,
      members: [
        { kind: 'blind', splitPolicy: 'split.blind-2024q4', metricIds: ['m'] },
        { kind: 'blind', splitPolicy: 'split.blind-2024q4', metricIds: ['m2'] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors.some((e) => e.code === 'invalid_field' && e.path === 'members[1].splitPolicy')).toBe(true);
  });

  it('the same kind under DIFFERENT splits composes (multi-window protocols are legal)', () => {
    const result = createEvaluationSuite({
      ...RELEASE_SUITE_INPUT,
      members: [
        { kind: 'blind', splitPolicy: 'split.blind-a', metricIds: ['m'] },
        { kind: 'blind', splitPolicy: 'split.blind-b', metricIds: ['m'] },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('collects every structural violation with dotted paths', () => {
    const result = createEvaluationSuite({
      suiteId: '',
      grade: 'ship',
      evaluatorVersion: '',
      members: [],
      adversarialSuiteRefs: 'x',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('suiteId');
    expect(paths).toContain('grade');
    expect(paths).toContain('evaluatorVersion');
    expect(paths).toContain('members');
    expect(paths).toContain('adversarialSuiteRefs');
  });

  it('rejects duplicate adversarial refs and non-object input without throwing', () => {
    const dup = createEvaluationSuite({ ...RELEASE_SUITE_INPUT, adversarialSuiteRefs: ['a', 'a'] });
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error('must fail');
    expect(dup.errors[0]?.path).toBe('adversarialSuiteRefs[1]');

    expect(createEvaluationSuite(null).ok).toBe(false);
    expect(createEvaluationSuite('suite').ok).toBe(false);
  });

  it('isEvaluationSuite rejects degenerate records (guard parity with the constructor)', () => {
    expect(isEvaluationSuite(releaseSuite())).toBe(true);
    expect(isEvaluationSuite({ ...RELEASE_SUITE_INPUT, adversarialSuiteRefs: [] })).toBe(false); // L10 in the guard
    expect(isEvaluationSuite({ ...RELEASE_SUITE_INPUT, members: [] })).toBe(false);
    expect(isEvaluationSuite({ ...RELEASE_SUITE_INPUT, grade: 'ship' })).toBe(false);
    expect(isEvaluationSuite(null)).toBe(false);
  });

  it('construction is deterministic (same input, deeply-equal suite)', () => {
    const a = createEvaluationSuite(RELEASE_SUITE_INPUT);
    const b = createEvaluationSuite(RELEASE_SUITE_INPUT);
    expect(a).toEqual(b);
    if (a.ok && b.ok) expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
  });
});
