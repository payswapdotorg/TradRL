/**
 * @tradrl/provenance — correction records.
 *
 * Behavioral suite: input/record validation (positive and negative),
 * guard totality, and the latest-correction-status VIEW over an
 * append-only log (never a rewrite).
 */

import type { CustodyChain, TimestampMs } from './index';
import { describe, expect, it } from 'vitest';

import {
  correctionIds,
  hasCorrectionId,
  isCorrectionInput,
  isCorrectionRecord,
  latestCorrectionStatus,
  validateCorrectionInput,
  validateCorrectionRecord,
  type CorrectionInput,
  type CorrectionRecord,
} from './index';

const CUSTODY = {
  adapter: null,
  batch: { batch_id: 'ops-batch-001' },
  commit: { commit_id: 'cmt-00000005', commit_sequence: 5, ingestion_time: 50_000 },
} as const;

const INPUT: CorrectionInput = {
  correction_id: 'fix-001',
  corrected_event_id: 'tick-001-1',
  reason: 'vendor restatement: price precision',
  amendment: { price: '43125.10', size: '0.017' },
};

const RECORD: CorrectionRecord = { ...INPUT, custody:(CUSTODY) as CustodyChain };

describe('correction input validation', () => {
  it('accepts a well-formed amendment', () => {
    expect(validateCorrectionInput(INPUT)).toEqual([]);
    expect(isCorrectionInput(INPUT)).toBe(true);
  });

  it('requires correction_id, target, reason and a JSON amendment', () => {
    expect(validateCorrectionInput({ ...INPUT, correction_id: '' }).length).toBe(1);
    expect(validateCorrectionInput({ ...INPUT, corrected_event_id: '' }).length).toBe(1);
    expect(validateCorrectionInput({ ...INPUT, reason: '' }).length).toBe(1);
    expect(validateCorrectionInput({ ...INPUT, reason: undefined } as Partial<CorrectionInput>).length).toBe(1);
    expect(validateCorrectionInput({ ...INPUT, amendment: { bad: Number.NaN } }).length).toBe(1);
    expect(validateCorrectionInput({ ...INPUT, amendment: { bad: undefined } as unknown as Record<string, never> }).length).toBe(1);
    expect(validateCorrectionInput(null).length).toBe(1);
    expect(validateCorrectionInput(42).length).toBe(1);
  });
});

describe('correction record validation (with custody)', () => {
  it('accepts a stored correction and rejects missing/bad custody', () => {
    expect(validateCorrectionRecord(RECORD)).toEqual([]);
    expect(isCorrectionRecord(RECORD)).toBe(true);
    expect(validateCorrectionRecord(INPUT).length).toBeGreaterThan(0);
    expect(isCorrectionRecord(INPUT)).toBe(false);
    expect(
      validateCorrectionRecord({ ...RECORD, custody: { ...CUSTODY, commit: { ...CUSTODY.commit, commit_sequence: 0 } } })
        .length,
    ).toBe(1);
  });
});

describe('latestCorrectionStatus (view over an append-only log)', () => {
  const second: CorrectionRecord = {
    correction_id: 'fix-002',
    corrected_event_id: 'tick-001-1',
    reason: 'vendor restatement: side flipped after audit',
    amendment: { side: 'sell' },
    custody: { ...CUSTODY, commit: { commit_id: 'cmt-00000006', commit_sequence: 6, ingestion_time:(60_000) as TimestampMs } },
  };
  const otherTarget: CorrectionRecord = {
    correction_id: 'fix-003',
    corrected_event_id: 'tick-002-1',
    reason: 'duplicate print',
    amendment: {},
    custody:(CUSTODY) as CustodyChain,
  };

  it('uncorrected when no amendment names the event', () => {
    expect(latestCorrectionStatus('tick-001-1', [])).toEqual({ status: 'uncorrected', event_id: 'tick-001-1' });
    expect(latestCorrectionStatus('tick-001-1', [otherTarget])).toEqual({
      status: 'uncorrected',
      event_id: 'tick-001-1',
    });
  });

  it('the latest amendment wins; the full history is preserved in append order', () => {
    const status = latestCorrectionStatus('tick-001-1', [RECORD, otherTarget, second]);
    expect(status.status).toBe('corrected');
    if (status.status === 'corrected') {
      expect(status.count).toBe(2);
      expect(status.latest.correction_id).toBe('fix-002');
      expect(status.history.map((entry) => entry.correction_id)).toEqual(['fix-001', 'fix-002']);
    }
  });

  it('pure: the input log is never mutated', () => {
    const log: CorrectionRecord[] = [RECORD, second];
    const before = JSON.stringify(log);
    latestCorrectionStatus('tick-001-1', log);
    expect(JSON.stringify(log)).toBe(before);
  });
});

describe('correction list helpers', () => {
  it('correctionIds and hasCorrectionId', () => {
    expect(correctionIds([RECORD, second()])).toEqual(['fix-001', 'fix-002']);
    expect(hasCorrectionId([RECORD], 'fix-001')).toBe(true);
    expect(hasCorrectionId([RECORD], 'fix-999')).toBe(false);
  });
});

function second(): CorrectionRecord {
  return {
    correction_id: 'fix-002',
    corrected_event_id: 'tick-001-1',
    reason: 'vendor restatement: side flipped after audit',
    amendment: { side: 'sell' },
    custody: { ...CUSTODY, commit: { commit_id: 'cmt-00000006', commit_sequence: 6, ingestion_time:(60_000) as TimestampMs } },
  };
}
