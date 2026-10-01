/**
 * @tradrl/evaluation-integrity — the unseen-data quarantine tests.
 *
 * Laws under test (quarantine.ts):
 * - content-addressed quarantine ids (identical declarations address
 *   identically; supplied ids that disagree fail);
 * - PREDECLARATION (`quarantine_registered_late`): the declaration must
 *   not postdate the search's first entry instant;
 * - EMPIRICAL CLEANLINESS (`quarantine_violation`): no in-search trial
 *   consumes quarantined material by dataset ref or window overlap — and
 *   holdout trials consuming it are CORRECT;
 * - scope matching (`tenant_mismatch`, L12);
 * - unverified records support no check (`chain_mismatch`).
 */

import { describe, expect, it } from 'vitest';

import { checkQuarantine, quarantineRecordId, registerQuarantine } from './index';
import type { SearchRecordMirror } from './index';
import { T0, DAY, buildRecord, thawRecord } from './fixtures';

/** t1 optimizes [T0, T0+1d); h1 evaluates [T0+5d, T0+6d) over the holdout dataset. */
const RECORD: SearchRecordMirror = buildRecord([
  { trial: 't1', config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY } },
  { trial: 'h1', classification: 'holdout', config: { lr: '0.1' }, window: { start: T0 + 5 * DAY, end: T0 + 6 * DAY }, datasets: ['dataset-holdout'] },
]);

function quarantine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant: 'tenant-1',
    project: 'project-1',
    segments: [{ ref: 'dataset-holdout', start: T0 + 5 * DAY, end: T0 + 6 * DAY, regime: 'unseen' }],
    registered_at: T0 - DAY,
    reason: 'final-period holdout material',
    ...overrides,
  };
}

describe('registration', () => {
  it('derives the content-addressed id', () => {
    const a = registerQuarantine(quarantine());
    const b = registerQuarantine(quarantine());
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error('must register');
    expect(a.value.quarantine_id).toBe(b.value.quarantine_id);
    expect(a.value.quarantine_id.startsWith('qtn:')).toBe(true);
    expect(a.value.quarantine_id).toBe(quarantineRecordId({ tenant: a.value.tenant, project: a.value.project, segments: a.value.segments, registered_at: a.value.registered_at, reason: a.value.reason }));
  });

  it('a supplied id that disagrees with the content fails', () => {
    const result = registerQuarantine(quarantine({ quarantine_id: 'qtn:ffffffffffffffff' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
    expect(result.errors[0]?.message).toContain('content and address cannot disagree');
  });

  it('collects structural violations', () => {
    expect(registerQuarantine({}).ok).toBe(false);
    expect(registerQuarantine(quarantine({ segments: [] })).ok).toBe(false);
    expect(registerQuarantine(quarantine({ segments: [{ ref: 'x', start: T0 + 5 * DAY, end: T0 + 4 * DAY, regime: 'r' }] })).ok).toBe(false);
    expect(registerQuarantine(quarantine({ registered_at: -1 })).ok).toBe(false);
    expect(registerQuarantine(quarantine({ reason: '' })).ok).toBe(false);
  });
});

describe('the PREDECLARATION law', () => {
  it('a quarantine declared after the first search entry fails quarantine_registered_late', () => {
    // The first entry instant is T0+100; declare at T0+200.
    const result = checkQuarantine(RECORD, quarantine({ registered_at: T0 + 200 }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('quarantine_registered_late');
    expect(result.errors[0]?.message).toContain('BEFORE');
  });

  it('a quarantine declared exactly at the first entry instant is legal', () => {
    const result = checkQuarantine(RECORD, quarantine({ registered_at: T0 + 100 }));
    expect(result.ok).toBe(true);
  });

  it('a predeclared quarantine passes the timing law', () => {
    const result = checkQuarantine(RECORD, quarantine());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must pass');
    expect(result.value.quarantinedSegments).toBe(1);
    expect(result.value.inSearchTrials).toBe(1);
  });
});

describe('the EMPIRICAL CLEANLINESS law', () => {
  it('an in-search trial consuming a quarantined DATASET fails quarantine_violation', () => {
    const result = checkQuarantine(RECORD, quarantine({ segments: [{ ref: 'dataset-europe', start: T0 + 5 * DAY, end: T0 + 6 * DAY, regime: 'unseen' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('quarantine_violation');
    expect(result.errors[0]?.message).toContain('dataset-europe');
    expect(result.errors[0]?.message).toContain('not unseen');
  });

  it('an in-search trial whose WINDOW overlaps a quarantined segment fails quarantine_violation', () => {
    const result = checkQuarantine(RECORD, quarantine({ segments: [{ ref: 'dataset-future', start: T0 + DAY / 2, end: T0 + 2 * DAY, regime: 'unseen' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('quarantine_violation');
    expect(result.errors[0]?.message).toContain('overlaps quarantined segment');
  });

  it('a holdout trial consuming quarantined material is CORRECT (that is what quarantine is for)', () => {
    // The default fixture quarantines exactly h1's window+dataset: clean.
    const result = checkQuarantine(RECORD, quarantine());
    expect(result.ok).toBe(true);
  });

  it('adjacent-but-disjoint windows do not burn the quarantine', () => {
    // Quarantine [T0+DAY, T0+2d): t1's window [T0, T0+DAY) ends exactly at its start.
    const result = checkQuarantine(RECORD, quarantine({ segments: [{ ref: 'dataset-after', start: T0 + DAY, end: T0 + 2 * DAY, regime: 'unseen' }] }));
    expect(result.ok).toBe(true);
  });
});

describe('scope and verification gates', () => {
  it('a cross-scope quarantine fails tenant_mismatch (L12)', () => {
    const result = checkQuarantine(RECORD, quarantine({ tenant: 'tenant-2' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('tenant_mismatch');
    expect(result.errors[0]?.message).toContain('never cross scopes');
    const wrongProject = checkQuarantine(RECORD, quarantine({ project: 'project-2' }));
    expect(wrongProject.ok).toBe(false);
    if (wrongProject.ok) throw new Error('must fail');
    expect(wrongProject.errors[0]?.code).toBe('tenant_mismatch');
  });

  it('an unverified record supports no quarantine check', () => {
    const tampered = thawRecord(RECORD);
    tampered.entries[0]!.datasets = ['dataset-asia'];
    const result = checkQuarantine(tampered, quarantine());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('chain_mismatch');
  });
});
