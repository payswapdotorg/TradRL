/**
 * Behavioral tests for @tradrl/evaluation search-integrity reporting (L11):
 * failures and rejections RETAINED and counted over the FULL trial log;
 * the best-of-N selection effect QUANTIFIED (reported statistic vs
 * blind-selection expectation); HIDING TRIALS IS A TYPED ERROR; the report
 * is deterministic and deeply frozen.
 */

import { describe, expect, it } from 'vitest';

import {
  computeSearchIntegrityReport,
  isBestOfNEffect,
  isSearchIntegrityReport,
  isSelectionClaim,
  isTrialLogEntry,
  isTrialStatistic,
  type ArmId,
  type SelectionClaim,
  type TrialId,
  type TrialLogEntry,
  type TrialStatistic,
} from './index';
import { requireTimestampMs } from './primitives';

// ---------------------------------------------------------------------------
// Fixtures — a log with successes, failures, rejections AND progressions
// ---------------------------------------------------------------------------

const trialId = (id: string): TrialId => id as TrialId;
const armId = (id: string): ArmId => id as ArmId;

function entry(overrides: { trial_id: string; arm: string; status: TrialLogEntry['status']; trajectory?: string; outcome?: { score: number } | null; failure_reason?: string }): TrialLogEntry {
  const trial = trialId(overrides.trial_id);
  const arm = armId(overrides.arm);
  const succeeded: TrialLogEntry = {
    trial_id: trial,
    arm,
    status: 'succeeded',
    trajectory: (overrides.trajectory ?? 'traj.x') as TrialLogEntry['trajectory'],
    outcome: overrides.outcome ?? { score: 0.5 },
    started_at: requireTimestampMs(1_700_000_000_000),
    ended_at: requireTimestampMs(1_700_000_060_000),
    failure_reason: null,
  };
  const failed: TrialLogEntry = {
    trial_id: trial,
    arm,
    status: 'failed',
    trajectory: null,
    outcome: null,
    started_at: null,
    ended_at: requireTimestampMs(1_700_000_060_000),
    failure_reason: overrides.failure_reason ?? 'runtime crashed',
  };
  const planned: TrialLogEntry = {
    trial_id: trial,
    arm,
    status: 'planned',
    trajectory: null,
    outcome: null,
    started_at: null,
    ended_at: null,
    failure_reason: null,
  };
  const running: TrialLogEntry = {
    trial_id: trial,
    arm,
    status: 'running',
    trajectory: null,
    outcome: null,
    started_at: requireTimestampMs(1_700_000_000_000),
    ended_at: null,
    failure_reason: null,
  };
  const rejected: TrialLogEntry = {
    trial_id: trial,
    arm,
    status: 'rejected',
    trajectory: null,
    outcome: null,
    started_at: null,
    ended_at: requireTimestampMs(1_700_000_060_000),
    failure_reason: overrides.failure_reason ?? 'arm admission refused',
  };
  switch (overrides.status) {
    case 'succeeded':
      return succeeded;
    case 'failed':
      return failed;
    case 'planned':
      return planned;
    case 'running':
      return running;
    case 'rejected':
      return rejected;
  }
}

const LOG: readonly TrialLogEntry[] = [
  // trial-1 progresses planned -> running -> succeeded (progressions retained).
  entry({ trial_id: 'trial-1', arm: 'arm-treatment', status: 'planned' }),
  entry({ trial_id: 'trial-1', arm: 'arm-treatment', status: 'running' }),
  entry({ trial_id: 'trial-1', arm: 'arm-treatment', status: 'succeeded', trajectory: 'traj.1', outcome: { score: 0.62 } }),
  // trial-2 fails; trial-3 is rejected; trial-4 succeeds.
  entry({ trial_id: 'trial-2', arm: 'arm-treatment', status: 'failed', failure_reason: 'environment crashed' }),
  entry({ trial_id: 'trial-3', arm: 'arm-control', status: 'rejected', failure_reason: 'admission refused' }),
  entry({ trial_id: 'trial-4', arm: 'arm-treatment', status: 'succeeded', trajectory: 'traj.4', outcome: { score: 0.10 } }),
];

const STATISTICS: readonly TrialStatistic[] = [
  { trial_id: trialId('trial-1'), statistic: 0.62 },
  { trial_id: trialId('trial-2'), statistic: null },
  { trial_id: trialId('trial-3'), statistic: null },
  { trial_id: trialId('trial-4'), statistic: 0.10 },
];

const SELECTION: SelectionClaim = { selectedTrialId: trialId('trial-1') };

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('trial log mirror guards (T011 structural law)', () => {
  it('accepts the fixture entries and rejects status-law violations', () => {
    for (const logEntry of LOG) expect(isTrialLogEntry(logEntry)).toBe(true);
    // planned with a start is illegal; succeeded without outcome/trajectory is illegal.
    expect(isTrialLogEntry({ ...LOG[0], started_at: 1 })).toBe(false);
    const successNoEvidence = { ...LOG[2], trajectory: null };
    expect(isTrialLogEntry(successNoEvidence)).toBe(false);
    const failedNoReason = { ...LOG[3], failure_reason: null };
    expect(isTrialLogEntry(failedNoReason)).toBe(false);
    const rejectedRan = { ...LOG[4], started_at: 1 };
    expect(isTrialLogEntry(rejectedRan)).toBe(false);
    expect(isTrialLogEntry(null)).toBe(false);
  });

  it('statistic and selection guards', () => {
    expect(isTrialStatistic({ trial_id: 't', statistic: 0.5 })).toBe(true);
    expect(isTrialStatistic({ trial_id: 't', statistic: null })).toBe(true);
    expect(isTrialStatistic({ trial_id: 't', statistic: Number.NaN })).toBe(false);
    expect(isTrialStatistic({ trial_id: '', statistic: 0.5 })).toBe(false);
    expect(isSelectionClaim({ selectedTrialId: 't' })).toBe(true);
    expect(isSelectionClaim({ selectedTrialId: '' })).toBe(false);
    expect(isSelectionClaim(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

describe('computeSearchIntegrityReport (L11)', () => {
  it('counts the FULL log: failures and rejections retained, progressions recorded', () => {
    const result = computeSearchIntegrityReport({ experiment_id: 'exp-1' as never, trials: LOG }, STATISTICS, SELECTION);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    const report = result.value;
    expect(isSearchIntegrityReport(report)).toBe(true);
    expect(report.experiment).toBe('exp-1');
    expect(report.trialsCounted).toBe(4);
    expect(report.logEntries).toBe(6);
    expect(report.progressions).toBe(2); // planned->running->succeeded retained
    expect(report.succeeded).toBe(2);
    expect(report.failuresRetained).toBe(1);
    expect(report.rejectionsRetained).toBe(1);
    expect(report.nonTerminal).toBe(0);
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('quantifies the best-of-N selection effect: reported statistic vs blind-selection expectation', () => {
    const result = computeSearchIntegrityReport({ experiment_id: 'exp-1' as never, trials: LOG }, STATISTICS, SELECTION);
    if (!result.ok) throw new Error('must succeed');
    const effect = result.value.bestOfN;
    expect(effect).not.toBeNull();
    if (effect === null) throw new Error('effect must exist');
    expect(isBestOfNEffect(effect)).toBe(true);
    expect(effect.selectedTrialId).toBe('trial-1');
    expect(effect.candidates).toBe(2); // only succeeded trials carry statistics
    expect(effect.reportedStatistic).toBe(0.62);
    expect(effect.blindSelectionExpectation).toBeCloseTo((0.62 + 0.10) / 2, 12);
    expect(effect.selectionInflation).toBeCloseTo(0.62 - 0.36, 12);
    expect(effect.selectedIsBest).toBe(true);
  });

  it('a selection that is NOT the argmax is flagged (selectedIsBest false)', () => {
    const result = computeSearchIntegrityReport({ experiment_id: 'exp-1' as never, trials: LOG }, STATISTICS, { selectedTrialId: 'trial-4' });
    if (!result.ok) throw new Error('must succeed');
    const effect = result.value.bestOfN;
    if (effect === null) throw new Error('effect must exist');
    expect(effect.selectedIsBest).toBe(false);
    expect(effect.selectionInflation).toBeCloseTo(0.10 - 0.36, 12); // negative: the "selection" underperforms blind expectation
  });

  it('HIDING TRIALS IS A TYPED ERROR — statistics must cover every distinct trial', () => {
    const hidden = computeSearchIntegrityReport({ experiment_id: 'exp-1' as never, trials: LOG }, STATISTICS.slice(0, 3), SELECTION); // dropped trial-4 (a SUCCESS — hiding the weak one)
    expect(hidden.ok).toBe(false);
    if (hidden.ok) throw new Error('must fail');
    expect(hidden.errors[0]?.code).toBe('hidden_trials');
    expect(hidden.errors[0]?.message).toContain('trial-4');

    // Hiding the FAILURE is equally typed.
    const hiddenFailure = computeSearchIntegrityReport(
      { experiment_id: 'exp-1' as never, trials: LOG },
      [STATISTICS[0], STATISTICS[1], STATISTICS[3]] as readonly TrialStatistic[],
      SELECTION,
    );
    expect(hiddenFailure.ok).toBe(false);
    if (hiddenFailure.ok) throw new Error('must fail');
    expect(hiddenFailure.errors[0]?.code).toBe('hidden_trials');
  });

  it('fabricated statistics for unknown trials are typed errors', () => {
    const fabricated = computeSearchIntegrityReport(
      { experiment_id: 'exp-1' as never, trials: LOG },
      [...STATISTICS, { trial_id: 'trial-ghost', statistic: 1 }],
      SELECTION,
    );
    expect(fabricated.ok).toBe(false);
    if (fabricated.ok) throw new Error('must fail');
    expect(fabricated.errors[0]?.code).toBe('unknown_statistic');
  });

  it('selection claims must be backed by the log AND a statistic', () => {
    const notInLog = computeSearchIntegrityReport({ experiment_id: 'exp-1' as never, trials: LOG }, STATISTICS, { selectedTrialId: trialId('trial-ghost') });
    expect(notInLog.ok).toBe(false);
    if (notInLog.ok) throw new Error('must fail');
    expect(notInLog.errors[0]?.code).toBe('selection_not_in_log');

    const noStatistic = computeSearchIntegrityReport({ experiment_id: 'exp-1' as never, trials: LOG }, STATISTICS, { selectedTrialId: trialId('trial-2') });
    expect(noStatistic.ok).toBe(false);
    if (noStatistic.ok) throw new Error('must fail');
    expect(noStatistic.errors[0]?.code).toBe('selected_without_statistic');
  });

  it('no candidates: the effect is undefined and REFUSED, not invented', () => {
    const emptyLog: readonly TrialLogEntry[] = [entry({ trial_id: 'trial-x', arm: 'a', status: 'failed', failure_reason: 'boom' })];
    const result = computeSearchIntegrityReport({ experiment_id: 'exp-1' as never, trials: emptyLog }, [{ trial_id: trialId('trial-x'), statistic: null }], { selectedTrialId: trialId('trial-x') });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('no_candidates');
  });

  it('structurally invalid log entries are collected typed errors', () => {
    const result = computeSearchIntegrityReport(
      { experiment_id: 'exp-1' as never, trials: [...LOG, { trial_id: 'bad', arm: 'a', status: 'succeeded', trajectory: null, outcome: null, started_at: 1, ended_at: 2, failure_reason: null }] },
      STATISTICS,
      SELECTION,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.path).toBe('trials[6]');
  });

  it('non-terminal trials are counted as nonTerminal (honesty, not error)', () => {
    const openLog: readonly TrialLogEntry[] = [...LOG, entry({ trial_id: 'trial-5', arm: 'arm-control', status: 'planned' })];
    const stats: readonly TrialStatistic[] = [...STATISTICS, { trial_id: trialId('trial-5'), statistic: null }];
    const result = computeSearchIntegrityReport({ experiment_id: 'exp-1' as never, trials: openLog }, stats, SELECTION);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.nonTerminal).toBe(1);
    expect(result.value.trialsCounted).toBe(5);
  });

  it('deterministic: same inputs -> byte-identical report and id', () => {
    const a = computeSearchIntegrityReport({ experiment_id: 'exp-1' as never, trials: LOG }, STATISTICS, SELECTION);
    const b = computeSearchIntegrityReport({ experiment_id: 'exp-1' as never, trials: LOG }, STATISTICS, SELECTION);
    expect(a).toEqual(b);
    if (a.ok && b.ok) {
      expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
      expect(a.value.reportId).toBe(b.value.reportId);
      expect(a.value.reportId.startsWith('sir:')).toBe(true);
    }
    // Any mutation of the log changes the derived id.
    const mutated = computeSearchIntegrityReport({ experiment_id: 'exp-1' as never, trials: LOG.slice(0, 5) }, [STATISTICS[0], STATISTICS[1], STATISTICS[2]] as readonly TrialStatistic[], SELECTION);
    if (a.ok && mutated.ok) expect(mutated.value.reportId).not.toBe(a.value.reportId);
  });

  it('invalid inputs fail without throwing', () => {
    expect(computeSearchIntegrityReport(null as never, [], null).ok).toBe(false);
    expect(computeSearchIntegrityReport({ experiment_id: '' as never, trials: [] }, [], null).ok).toBe(false);
    expect(computeSearchIntegrityReport({ trials: [] } as never, [], null).ok).toBe(false);
    expect(computeSearchIntegrityReport({ experiment_id: 'e' as never, trials: 'x' } as never, [], null).ok).toBe(false);
    expect(computeSearchIntegrityReport({ experiment_id: 'e' as never, trials: [] }, 'x' as never, null).ok).toBe(false);
    expect(computeSearchIntegrityReport({ experiment_id: 'e' as never, trials: [] }, [], 'x').ok).toBe(false);
  });
});
