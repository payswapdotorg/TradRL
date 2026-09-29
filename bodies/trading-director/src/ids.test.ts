// @tradrl/body-trading-director — ids tests (owned identity spaces,
// opaque cross-lane references, the trading-strategy versioned-pointer
// mirrors).

import { describe, expect, it } from 'vitest';
import {
  bodyVersionRef,
  directorDecisionId,
  escalationRecordId,
  isBodyVersionRef,
  isConstraintSetVersionRef,
  isCrossMarketReportId,
  isDirectorDecisionId,
  isEscalationRecordId,
  isEscalationRecordId as isEscId,
  isFundamentalReportId,
  isGoalVersionRef,
  isMethodId,
  isMethodVersionRef,
  isProjectId,
  isRegimeReportId,
  isSentimentReportId,
  isTenantId,
  isTopicName,
  methodId,
  methodVersionRef,
  projectId,
  tenantId,
} from './ids';

describe('owned identity spaces', () => {
  it('decision and escalation ids use the compact identifier pattern', () => {
    expect(isDirectorDecisionId('dd-0123456789abcdef')).toBe(true);
    expect(isEscalationRecordId('esc-0123456789abcdef')).toBe(true);
    expect(isDirectorDecisionId('')).toBe(false);
    expect(isEscalationRecordId('has space')).toBe(false);
    expect(directorDecisionId('dd-abc')).toBe('dd-abc');
    expect(escalationRecordId('esc-abc')).toBe('esc-abc');
    expect(() => directorDecisionId('')).toThrow(TypeError);
    expect(() => escalationRecordId('')).toThrow(TypeError);
  });

  it('method ids are opaque refs; method versions are strict X.Y.Z', () => {
    expect(isMethodId('method/director/synthesis')).toBe(true);
    expect(isMethodId('')).toBe(false);
    expect(isMethodVersionRef('1.0.0')).toBe(true);
    expect(isMethodVersionRef('1.0')).toBe(false);
    expect(isMethodVersionRef('1.0.0-beta')).toBe(false);
    expect(methodId('method/x')).toBe('method/x');
    expect(methodVersionRef('2.1.0')).toBe('2.1.0');
    expect(() => methodVersionRef('v1.0.0')).toThrow(TypeError);
  });
});

describe('mirrored cross-lane identities', () => {
  it('tenant and project ids are non-empty strings', () => {
    expect(isTenantId('tenant-director')).toBe(true);
    expect(isTenantId('')).toBe(false);
    expect(isProjectId('project-portfolio')).toBe(true);
    expect(isProjectId('')).toBe(false);
    expect(tenantId('t')).toBe('t');
    expect(projectId('p')).toBe('p');
  });

  it('body version refs are canonical ${bodyId}@${semver}', () => {
    expect(isBodyVersionRef('trading-director@1.0.0')).toBe(true);
    expect(isBodyVersionRef('sentiment-researcher@1.0.0')).toBe(true);
    expect(isBodyVersionRef('fundamental-researcher@1.0.0')).toBe(true);
    expect(isBodyVersionRef('cross-market-researcher@1.0.0')).toBe(true);
    expect(isBodyVersionRef('trading-director@1.0')).toBe(false);
    expect(isBodyVersionRef('@1.0.0')).toBe(false);
    expect(bodyVersionRef('trading-director@1.0.0')).toBe('trading-director@1.0.0');
    expect(() => bodyVersionRef('bad')).toThrow(TypeError);
  });

  it('research report citation ids are carried verbatim (non-empty strings)', () => {
    expect(isSentimentReportId('rr-0123456789abcdef')).toBe(true);
    expect(isRegimeReportId('rr-0123456789abcdef')).toBe(true);
    expect(isFundamentalReportId('frr-0123456789abcdef')).toBe(true);
    expect(isCrossMarketReportId('cmrr-0123456789abcdef')).toBe(true);
    expect(isSentimentReportId('')).toBe(false);
    expect(isRegimeReportId(42)).toBe(false);
    expect(isFundamentalReportId(null)).toBe(false);
    expect(isCrossMarketReportId(undefined)).toBe(false);
  });

  it('agent instance ids and topic names use the compact identifier pattern', () => {
    expect(isTopicName('directors.decisions')).toBe(true);
    expect(isTopicName('')).toBe(false);
  });
});

describe('the trading-strategy versioned-pointer mirrors (T018)', () => {
  it('goal version refs are { goalId, version >= 1 }', () => {
    expect(isGoalVersionRef({ goalId: 'goal/portfolio-direction', version: 1 })).toBe(true);
    expect(isGoalVersionRef({ goalId: 'g', version: 0 })).toBe(false);
    expect(isGoalVersionRef({ goalId: '', version: 1 })).toBe(false);
    expect(isGoalVersionRef({ goalId: 'g' })).toBe(false);
    expect(isGoalVersionRef(null)).toBe(false);
  });

  it('constraint-set version refs are { id, version >= 1 }', () => {
    expect(isConstraintSetVersionRef({ id: 'constraints/max-drawdown', version: 2 })).toBe(true);
    expect(isConstraintSetVersionRef({ id: 'c', version: 0 })).toBe(false);
    expect(isConstraintSetVersionRef({ id: '', version: 1 })).toBe(false);
    expect(isConstraintSetVersionRef('constraints/max-drawdown')).toBe(false);
  });

  it('the guard is total over untrusted input (never throws)', () => {
    for (const hostile of [null, undefined, 42, 'x', [], [1], { goalId: { deep: 1 }, version: 1 }]) {
      expect(() => isGoalVersionRef(hostile)).not.toThrow();
      expect(() => isConstraintSetVersionRef(hostile)).not.toThrow();
    }
  });
});

void isEscId;
