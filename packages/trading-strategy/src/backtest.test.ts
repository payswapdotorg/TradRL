/**
 * Behavioral tests for the backtest trail: the append-only law (L11 —
 * rewriting a disposition is a typed error), the attainment evidence
 * bindings, the structured reasons, and the L8/L12 validation laws.
 */

import { describe, expect, it } from 'vitest';

import {
  appendBacktestCandidate,
  backtestRunIdOf,
  isBacktestCandidate,
  isBacktestRecord,
  startBacktestRecord,
  validateBacktestCandidate,
  validateBacktestRecord,
  type BacktestCandidate,
  type BacktestRecord,
} from './index';

const T0 = 1_700_000_000_000;
const GOAL = { goalId: 'goal-1', version: 1 } as never;
const TENANT = 'tenant-alpha' as never;
const PROJECT = 'project-one' as never;

function candidate(overrides?: Record<string, unknown>): BacktestCandidate {
  const base = {
    candidateId: 'btc:aabbccdd',
    sequence: 1,
    strategy: { specId: 'spec-1', version: 1 },
    window: { windowId: 'win-1', startsAt: T0 - 1000, endsAt: T0 },
    attainment: [
      {
        criterionId: 'c1',
        requiredSatisfaction: 1,
        gatingConstraintIds: ['g1', 'g2'],
        blockingConstraintIds: ['g1'],
        evidenceRef: 'eval-evidence:c1@1',
      },
    ],
    disposition: 'retained',
    reason: { kind: 'attained', attainedCriteria: 1, totalCriteria: 1 },
    learning: { trialId: 'trial-1', armId: 'arm-a', trajectoryId: 'traj-1' },
    goal: GOAL,
    tenant: TENANT,
    project: PROJECT,
    recordedAt: T0,
  } as unknown as Record<string, unknown>;
  return { ...base, ...overrides } as unknown as BacktestCandidate;
}

describe('the backtest trail (L11)', () => {
  it('starts empty with a content-addressed basis id', () => {
    const record = startBacktestRecord(GOAL, TENANT, PROJECT);
    expect(isBacktestRecord(record)).toBe(true);
    expect(record.candidates).toHaveLength(0);
    expect(record.runId).toBe(backtestRunIdOf(GOAL, TENANT, PROJECT));
    expect(validateBacktestRecord(record).ok).toBe(true);
  });

  it('appends candidates with contiguous sequences and retains them all', () => {
    let record = startBacktestRecord(GOAL, TENANT, PROJECT);
    const first = candidate();
    const appended = appendBacktestCandidate(record, first);
    expect(appended.ok).toBe(true);
    if (appended.ok) {
      record = appended.value;
      expect(record.candidates).toHaveLength(1);
      const second = appendBacktestCandidate(
        record,
        candidate({ candidateId: 'btc:11223344', sequence: 2, disposition: 'rejected', reason: { kind: 'not_attained', failedCriteria: ['c1'] } }),
      );
      expect(second.ok).toBe(true);
      if (second.ok) {
        record = second.value;
        // REJECTED candidates are retained records (search integrity).
        expect(record.candidates.map((entry) => entry.disposition)).toEqual(['retained', 'rejected']);
        expect(validateBacktestRecord(record).ok).toBe(true);
      }
    }
  });

  it('rewriting a recorded disposition (duplicate id) is the typed backtest_rewrite', () => {
    let record = startBacktestRecord(GOAL, TENANT, PROJECT);
    const first = appendBacktestCandidate(record, candidate());
    expect(first.ok).toBe(true);
    if (first.ok) record = first.value;
    // The crime: the SAME candidate id comes back with a different disposition.
    const rewrite = appendBacktestCandidate(
      record,
      candidate({ sequence: 2, disposition: 'proposed', reason: { kind: 'attained', attainedCriteria: 1, totalCriteria: 1 } }),
    );
    expect(rewrite.ok).toBe(false);
    if (!rewrite.ok) {
      expect(rewrite.errors[0]?.code).toBe('backtest_rewrite');
      expect(rewrite.errors[0]?.message).toContain('disposition');
    }
  });

  it('a sequence gap is the typed backtest_rewrite (append-only)', () => {
    const record = startBacktestRecord(GOAL, TENANT, PROJECT);
    const gap = appendBacktestCandidate(record, candidate({ sequence: 5 }));
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.errors[0]?.code).toBe('backtest_rewrite');
  });

  it('a second proposed candidate is the typed backtest_rewrite (the selection is append-once)', () => {
    let record = startBacktestRecord(GOAL, TENANT, PROJECT);
    const first = appendBacktestCandidate(record, candidate({ disposition: 'proposed' }));
    expect(first.ok).toBe(true);
    if (first.ok) record = first.value;
    const second = appendBacktestCandidate(
      record,
      candidate({ candidateId: 'btc:ffeeddcc', sequence: 2, disposition: 'proposed' }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.errors[0]?.code).toBe('backtest_rewrite');
  });

  it('a candidate from another scope is rejected (L12/L9)', () => {
    const record = startBacktestRecord(GOAL, TENANT, PROJECT);
    const foreign = appendBacktestCandidate(record, candidate({ tenant: 'tenant-beta' as never }));
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0]?.code).toBe('tenant_missing');
    const foreignGoal = appendBacktestCandidate(record, candidate({ goal: { goalId: 'goal-9', version: 1 } as never }));
    expect(foreignGoal.ok).toBe(false);
    if (!foreignGoal.ok) expect(foreignGoal.errors[0]?.code).toBe('lineage_gap');
  });

  it('validateBacktestRecord catches a hidden-candidate shape (non-contiguous sequences)', () => {
    const record: BacktestRecord = {
      runId: backtestRunIdOf(GOAL, TENANT, PROJECT),
      goal: GOAL,
      tenant: TENANT,
      project: PROJECT,
      candidates: [candidate({ sequence: 2 })], // sequence 2 at index 0: history was rewritten
    } as never;
    const result = validateBacktestRecord(record);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'backtest_rewrite')).toBe(true);
    }
  });
});

describe('the attainment evidence binding (evaluation-lane mirror)', () => {
  it('a valid binding passes the guard (blocking subset of gating, non-empty gating)', () => {
    const binding = candidate().attainment[0];
    expect(binding).toBeDefined();
    expect(isBacktestCandidate(candidate())).toBe(true);
  });

  it('an empty gating list fails (a criterion gated by nothing cannot define attainment)', () => {
    const broken = candidate({ attainment: [{ criterionId: 'c1', requiredSatisfaction: 1, gatingConstraintIds: [], blockingConstraintIds: [], evidenceRef: 'e' }] });
    expect(isBacktestCandidate(broken)).toBe(false);
    const result = validateBacktestCandidate(broken);
    expect(result.ok).toBe(false);
  });

  it('a blocking id outside the gating list fails', () => {
    const broken = candidate({
      attainment: [{ criterionId: 'c1', requiredSatisfaction: 1, gatingConstraintIds: ['g1'], blockingConstraintIds: ['gX'], evidenceRef: 'e' }],
    });
    expect(isBacktestCandidate(broken)).toBe(false);
  });
});

describe('candidate validation (L8/L12 negative paths)', () => {
  it('an authority-embedding candidate fails with authority_in_strategy', () => {
    const criminal = candidate({ venuePermission: 'BINANCE:trade' });
    const result = validateBacktestCandidate(criminal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'authority_in_strategy')).toBe(true);
  });

  it('a candidate without tenant/project fails with tenant_missing', () => {
    const anonymous = candidate({ tenant: undefined, project: undefined });
    const result = validateBacktestCandidate(anonymous);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((error) => error.code);
      expect(codes).toContain('tenant_missing');
    }
  });

  it('a free-text reason fails (reasons are structured data)', () => {
    const prose = candidate({ reason: 'because it felt good' as never });
    const result = validateBacktestCandidate(prose);
    expect(result.ok).toBe(false);
  });
});
