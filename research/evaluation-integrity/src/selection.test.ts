/**
 * @tradrl/evaluation-integrity — the selection-effect audit tests.
 *
 * Laws under test (selection.ts) — the typed error taxonomy, each
 * negative-tested:
 * - `hidden_trials` — statistics that do not cover every in-search trial
 *   (the PLATFORM mirror of T012's hidden_trials law);
 * - `unknown_statistic` — fabricated coverage;
 * - `scale_mismatch` — statistics outside the declared exact-decimal scale;
 * - `selected_without_holdout` — the selected config carries no holdout
 *   evaluation (fail-closed: the audit refuses to invent);
 * - `selection_not_in_search` — a non-candidate selection;
 * - `synthetic_holdout` — holdout evidence over synthetic origin;
 * - `leakage_without_embargo` — a holdout window too close to optimization;
 * - `quarantine_violation` — in-search consumption of quarantined material;
 * - `chain_mismatch` — an unverified search record;
 * - `selection_mismatch` — a corroborating T012 report naming a different
 *   selection (or binding a different experiment).
 *
 * Plus the exact-decimal computation: reported statistic, blind-selection
 * expectation, selection inflation, holdout degradation, DAG shape — all
 * pinned.
 */

import { describe, expect, it } from 'vitest';

import { compileSelectionAudit } from './index';
import type { SearchRecordMirror } from './index';
import { DAY, SEARCH_FIXTURES, T0, buildRecord, thawRecord } from './fixtures';

const EMBARGO = 3 * DAY;

function quarantineInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant: 'tenant-1',
    project: 'project-1',
    segments: [{ ref: 'dataset-holdout', start: T0 + 5 * DAY, end: T0 + 6 * DAY, regime: 'unseen' }],
    registered_at: T0 - DAY,
    reason: 'final-period holdout material',
    ...overrides,
  };
}

function statistics(): Record<string, unknown>[] {
  return [
    { trial: 't1', statistic: '0.1000' },
    { trial: 't2', statistic: '0.1200' },
    { trial: 't3', statistic: '0.0800' },
    { trial: 't4', statistic: '0.2000' },
  ];
}

function holdout(): Record<string, unknown>[] {
  return [{ trial: 'h1', statistic: '0.1500', origin: 'historical' }];
}

function auditInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    search: buildRecord(SEARCH_FIXTURES),
    statistics: statistics(),
    holdout: holdout(),
    selection: { selectedTrialId: 't4' },
    statisticScale: 4,
    embargo: { source: 'declared', embargoMs: EMBARGO },
    quarantine: quarantineInput(),
    ...overrides,
  };
}

describe('the exact-decimal computation (all facts pinned)', () => {
  it('compiles the audit with the quantified best-of-N inflation and holdout degradation', () => {
    const result = compileSelectionAudit(auditInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`must compile: ${JSON.stringify(result.errors)}`);
    const audit = result.value;
    expect(audit.candidates).toBe(4);
    expect(audit.reportedStatistic).toBe('0.2000');
    // mean(0.1, 0.12, 0.08, 0.2) = 0.5/4 = 0.125 exactly.
    expect(audit.blindSelectionExpectation).toBe('0.1250');
    expect(audit.selectionInflation).toBe('0.0750');
    expect(audit.selectedIsBest).toBe(true);
    expect(audit.holdoutStatistic).toBe('0.1500');
    expect(audit.holdoutDegradation).toBe('0.0500');
    expect(audit.selectedTrialId).toBe('t4');
    expect(audit.selectedConfig).toBe(buildRecord(SEARCH_FIXTURES).entries[3]?.config);
    expect(audit.searchMaxDepth).toBe(1);
    expect(audit.selectedDepth).toBe(1);
    expect(audit.quarantinedSegments).toBe(1);
    expect(audit.embargoMs).toBe(EMBARGO);
    expect(audit.experimentRetained).toBeNull();
    expect(audit.audit_id.startsWith('saud:')).toBe(true);
    expect(Object.isFrozen(audit)).toBe(true);
  });

  it('a selection that is NOT the argmax is flagged (the integrity signal)', () => {
    // Select t1 (0.1000) while t4 (0.2000) is the best. t1's config
    // ({lr:'0.1'}) needs its own holdout evaluation for the audit to
    // compile: add h2 evaluating that config.
    const record = buildRecord([
      ...SEARCH_FIXTURES,
      { trial: 'h2', classification: 'holdout' as const, config: { lr: '0.1' }, window: { start: T0 + 6 * DAY, end: T0 + 7 * DAY }, datasets: ['dataset-holdout-2'] },
    ]);
    const result = compileSelectionAudit(auditInput({
      search: record,
      selection: { selectedTrialId: 't1' },
      holdout: [...holdout(), { trial: 'h2', statistic: '0.0900', origin: 'historical' }],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`must compile: ${JSON.stringify(result.errors)}`);
    expect(result.value.selectedIsBest).toBe(false);
    expect(result.value.reportedStatistic).toBe('0.1000');
    expect(result.value.holdoutStatistic).toBe('0.0900');
    expect(result.value.holdoutDegradation).toBe('0.0100');
  });

  it('negative statistics degrade UPWARD honestly (exact signed arithmetic)', () => {
    const result = compileSelectionAudit(auditInput({
      statistics: [
        { trial: 't1', statistic: '-0.0500' },
        { trial: 't2', statistic: '-0.0200' },
        { trial: 't3', statistic: '-0.0800' },
        { trial: 't4', statistic: '-0.0100' },
      ],
      holdout: [{ trial: 'h1', statistic: '-0.0300', origin: 'historical' }],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must compile');
    expect(result.value.blindSelectionExpectation).toBe('-0.0400');
    expect(result.value.selectionInflation).toBe('0.0300');
    expect(result.value.holdoutDegradation).toBe('0.0200');
  });
});

describe('the hidden-trials law (platform mirror of T012)', () => {
  it('dropping the worst attempt from the statistics fails hidden_trials', () => {
    const dropped = statistics().filter((s) => (s as { trial: string }).trial !== 't3');
    const result = compileSelectionAudit(auditInput({ statistics: dropped }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('hidden_trials');
    expect(result.errors[0]?.message).toContain('t3');
    expect(result.errors[0]?.message).toContain('platform mirror');
  });

  it('a statistic naming an unknown trial fails unknown_statistic', () => {
    const result = compileSelectionAudit(auditInput({ statistics: [...statistics(), { trial: 'ghost', statistic: '0.5000' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('unknown_statistic');
  });

  it('a statistic naming a HOLDOUT trial fails unknown_statistic (candidates are the search)', () => {
    const result = compileSelectionAudit(auditInput({ statistics: [...statistics(), { trial: 'h1', statistic: '0.5000' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('unknown_statistic');
  });

  it('duplicate statistics fail', () => {
    const result = compileSelectionAudit(auditInput({ statistics: [...statistics(), { trial: 't4', statistic: '0.2000' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
  });

  it('a statistic outside the declared scale fails scale_mismatch', () => {
    const result = compileSelectionAudit(auditInput({ statistics: [{ trial: 't1', statistic: '0.1' }, ...statistics().slice(1)] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('scale_mismatch');
  });

  it('a float statistic is refused (exact decimals only)', () => {
    const result = compileSelectionAudit(auditInput({ statistics: [{ trial: 't1', statistic: 0.1 }, ...statistics().slice(1)] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
    expect(result.errors[0]?.message).toContain('no floats');
  });
});

describe('the selected_without_holdout law (fail-closed)', () => {
  it('selecting a config with no holdout evaluation fails', () => {
    // t1's config {lr:'0.1'} has no holdout entry; only t4's config does.
    const result = compileSelectionAudit(auditInput({ selection: { selectedTrialId: 't1' }, holdout: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('selected_without_holdout');
    expect(result.errors[0]?.message).toContain('will not be compiled');
  });

  it('a holdout ENTRY without a supplied evaluation also fails', () => {
    const result = compileSelectionAudit(auditInput({ holdout: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('selected_without_holdout');
  });
});

describe('selection classification laws', () => {
  it('selection_not_in_search: naming the holdout trial as the selection fails', () => {
    const result = compileSelectionAudit(auditInput({ selection: { selectedTrialId: 'h1' } }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('selection_not_in_search');
  });

  it('selection naming an unknown trial fails', () => {
    const result = compileSelectionAudit(auditInput({ selection: { selectedTrialId: 'ghost' } }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors.map((e) => e.code)).toContain('selection_not_in_search');
  });

  it('holdout evaluations naming an in-search trial fail classification_mismatch', () => {
    const result = compileSelectionAudit(auditInput({ holdout: [{ trial: 't1', statistic: '0.5000', origin: 'historical' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('classification_mismatch');
  });

  it('holdout evaluations naming an unknown trial fail unknown_trial', () => {
    const result = compileSelectionAudit(auditInput({ holdout: [...holdout(), { trial: 'ghost', statistic: '0.5000', origin: 'historical' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('unknown_trial');
  });
});

describe('the leakage law inside the audit', () => {
  it('a holdout window within the embargo of optimization fails leakage_without_embargo', () => {
    const leaking: SearchRecordMirror = buildRecord([
      ...SEARCH_FIXTURES.slice(0, 4).map((f) => ({ ...f })),
      { trial: 'h1', classification: 'holdout' as const, config: { lr: '0.3' }, window: { start: T0 + 2 * DAY, end: T0 + 2 * DAY + DAY / 2 }, datasets: ['dataset-holdout'] },
    ]);
    const result = compileSelectionAudit(auditInput({ search: leaking }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('leakage_without_embargo');
  });

  it('synthetic holdout evidence fails synthetic_holdout', () => {
    const result = compileSelectionAudit(auditInput({ holdout: [{ trial: 'h1', statistic: '0.1500', origin: 'generated' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('synthetic_holdout');
    expect(result.errors[0]?.message).toContain('exploration instruments');
  });
});

describe('the quarantine law inside the audit', () => {
  it('in-search consumption of quarantined material fails quarantine_violation', () => {
    const result = compileSelectionAudit(auditInput({ quarantine: quarantineInput({ segments: [{ ref: 'dataset-europe', start: T0 + 5 * DAY, end: T0 + 6 * DAY, regime: 'unseen' }] }) }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('quarantine_violation');
  });

  it('a late quarantine fails quarantine_registered_late', () => {
    const result = compileSelectionAudit(auditInput({ quarantine: quarantineInput({ registered_at: T0 + 200 }) }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('quarantine_registered_late');
  });
});

describe('the chain gate', () => {
  it('an unverified search record fails chain_mismatch', () => {
    const tampered = thawRecord(buildRecord(SEARCH_FIXTURES));
    tampered.entries[0]!.datasets = ['dataset-asia'];
    const result = compileSelectionAudit(auditInput({ search: tampered }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
  });
});

describe('the T012 report cross-check', () => {
  function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      reportId: 'sir:abcdef0123456789',
      experiment: 'exp-1',
      trialsCounted: 6,
      logEntries: 7,
      progressions: 1,
      succeeded: 5,
      failuresRetained: 1,
      rejectionsRetained: 1,
      nonTerminal: 0,
      bestOfN: {
        selectedTrialId: 't4',
        reportedStatistic: 0.2,
        blindSelectionExpectation: 0.125,
        candidates: 4,
        selectionInflation: 0.075,
        selectedIsBest: true,
      },
      ...overrides,
    };
  }

  it('an agreeing report corroborates and its honest counts are retained', () => {
    const result = compileSelectionAudit(auditInput({ experimentReport: report() }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must compile');
    expect(result.value.experimentRetained).not.toBeNull();
    expect(result.value.experimentRetained?.reportId).toBe('sir:abcdef0123456789');
    expect(result.value.experimentRetained?.failuresRetained).toBe(1);
    expect(result.value.experimentRetained?.rejectionsRetained).toBe(1);
    expect(result.value.experimentRetained?.logEntries).toBe(7);
  });

  it('a report naming a DIFFERENT selection fails selection_mismatch', () => {
    const disagreeing = report({ bestOfN: { selectedTrialId: 't2', reportedStatistic: 0.12, blindSelectionExpectation: 0.125, candidates: 4, selectionInflation: -0.005, selectedIsBest: false } });
    const result = compileSelectionAudit(auditInput({ experimentReport: disagreeing }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('selection_mismatch');
    expect(result.errors[0]?.message).toContain('cannot report different bests');
  });

  it('a report binding a different experiment fails selection_mismatch', () => {
    const result = compileSelectionAudit(auditInput({ experimentReport: report({ experiment: 'exp-other' }) }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('selection_mismatch');
    expect(result.errors[0]?.message).toContain('same experiment');
  });

  it('a report with a null bestOfN cannot corroborate a selection', () => {
    const result = compileSelectionAudit(auditInput({ experimentReport: report({ bestOfN: null }) }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('selection_mismatch');
  });

  it('a malformed report fails structurally', () => {
    const result = compileSelectionAudit(auditInput({ experimentReport: { reportId: 'x' } }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
  });
});

describe('determinism', () => {
  it('the same inputs compile to the same audit id (repeatedly)', () => {
    const first = compileSelectionAudit(auditInput());
    if (!first.ok) throw new Error('must compile');
    for (let i = 0; i < 5; i++) {
      const again = compileSelectionAudit(auditInput());
      if (!again.ok) throw new Error('must compile');
      expect(again.value.audit_id).toBe(first.value.audit_id);
    }
  });

  it('any input change changes the audit id', () => {
    const base = compileSelectionAudit(auditInput());
    if (!base.ok) throw new Error('must compile');
    const legal = compileSelectionAudit(auditInput({ embargo: { source: 'declared', embargoMs: 4 * DAY } }));
    if (!legal.ok) throw new Error('must compile');
    expect(legal.value.audit_id).not.toBe(base.value.audit_id);
    const changedStatistics = compileSelectionAudit(auditInput({ statistics: [{ trial: 't1', statistic: '0.1001' }, ...statistics().slice(1)] }));
    if (!changedStatistics.ok) throw new Error('must compile');
    expect(changedStatistics.value.audit_id).not.toBe(base.value.audit_id);
  });

  it('the audit survives a JSON round-trip of the search record', () => {
    const serialized = JSON.parse(JSON.stringify(buildRecord(SEARCH_FIXTURES)));
    const result = compileSelectionAudit(auditInput({ search: serialized }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must compile');
    const direct = compileSelectionAudit(auditInput());
    if (!direct.ok) throw new Error('must compile');
    expect(result.value.audit_id).toBe(direct.value.audit_id);
  });
});
