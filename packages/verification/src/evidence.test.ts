/**
 * Behavioral tests for @tradrl/verification evidence-chain verification:
 * lineage hashes present and recomputable (a TAMPERED hash fails), quartets
 * monotone (a FUTURE-DATED quartet fails), no future leakage, verdicts are
 * boolean + reasons (never scores), and the report is deterministic and
 * deeply frozen. Work-order acceptance #7 (negative trip-wires).
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalPayload,
  isAvailabilityQuartet,
  isLeakageSample,
  isVerificationCase,
  isVerificationFailure,
  isVerificationReport,
  lineageHashOf,
  verifyEvidenceChain,
  type AvailabilityQuartet,
  type LineageHashCase,
  type NoFutureLeakageCase,
  type QuartetMonotoneCase,
  type VerificationFailure,
} from './index';
import { requireTimestampMs } from './primitives';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAYLOAD = { verdictId: 'vd:0011223344556677', attained: true, suite: 'suite.friction-2024q4' } as const;
const AS_OF = requireTimestampMs(1_800_000_000_000);

function quartet(eventTime: number, availableTime: number, ingestionTime: number): AvailabilityQuartet {
  return {
    event_time: requireTimestampMs(eventTime),
    source_time: null,
    available_time: requireTimestampMs(availableTime),
    ingestion_time: requireTimestampMs(ingestionTime),
  };
}

function cleanCases(): readonly unknown[] {
  const payload = { ...PAYLOAD } as unknown as Record<string, never>;
  const lineage: LineageHashCase = {
    kind: 'lineage-hash',
    caseId: 'case.lineage.verdict-1',
    recordRef: 'record.verdict-1',
    payload,
    claimedHash: lineageHashOf(payload),
  };
  const quartets: QuartetMonotoneCase = {
    kind: 'quartet-monotone',
    caseId: 'case.quartet.chain-1',
    asOf: AS_OF,
    quartets: [
      quartet(AS_OF - 5_000, AS_OF - 4_000, AS_OF - 3_000),
      quartet(AS_OF - 2_000, AS_OF - 1_000, AS_OF),
    ],
  };
  const leakage: NoFutureLeakageCase = {
    kind: 'no-future-leakage',
    caseId: 'case.leakage.run-1',
    asOf: AS_OF,
    samples: [
      { clockNow: AS_OF - 1_000, available_time: AS_OF - 2_000 },
      { clockNow: AS_OF, available_time: AS_OF - 1_000 },
    ],
  };
  return [lineage, quartets, leakage];
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('case guards', () => {
  it('AvailabilityQuartet and LeakageSample validate timestamps', () => {
    expect(isAvailabilityQuartet(quartet(1, 2, 3))).toBe(true);
    expect(isAvailabilityQuartet({ ...quartet(1, 2, 3), available_time: -1 })).toBe(false);
    expect(isAvailabilityQuartet({ ...quartet(1, 2, 3), source_time: 'x' })).toBe(false);
    expect(isAvailabilityQuartet({ ...quartet(1, 2, 3), ingestion_time: 1.5 })).toBe(false);
    expect(isLeakageSample({ clockNow: 1, available_time: 2 })).toBe(true);
    expect(isLeakageSample({ clockNow: Number.NaN, available_time: 2 })).toBe(false);
  });

  it('isVerificationCase accepts the three kinds and rejects malformed ones', () => {
    const cases = cleanCases();
    for (const verificationCase of cases) expect(isVerificationCase(verificationCase)).toBe(true);
    expect(isVerificationCase({ kind: 'lineage-hash', caseId: '', recordRef: 'r', payload: {}, claimedHash: 'x' })).toBe(false);
    expect(isVerificationCase({ kind: 'quartet-monotone', caseId: 'c', asOf: -1, quartets: [] })).toBe(false);
    expect(isVerificationCase({ kind: 'no-future-leakage', caseId: 'c', asOf: 1, samples: 'x' })).toBe(false);
    expect(isVerificationCase({ kind: 'other' })).toBe(false);
    expect(isVerificationCase(null)).toBe(false);
  });

  it('isVerificationFailure validates codes and indexes', () => {
    expect(isVerificationFailure({ caseId: 'c', code: 'lineage-hash-mismatch', index: 0 })).toBe(true);
    expect(isVerificationFailure({ caseId: 'c', code: 'lineage-hash-mismatch', index: -1 })).toBe(false);
    expect(isVerificationFailure({ caseId: 'c', code: 'not-a-code', index: 0 })).toBe(false);
    expect(isVerificationFailure(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The verifier
// ---------------------------------------------------------------------------

describe('verifyEvidenceChain (clean chain)', () => {
  it('passes with zero failures; the report is boolean + reasons, never scores', () => {
    const result = verifyEvidenceChain(cleanCases());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    const report = result.value;
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.casesChecked).toBe(3);
    expect(isVerificationReport(report)).toBe(true);
    expect(Object.isFrozen(report)).toBe(true);
    // The report surface carries NO numeric score field anywhere.
    expect(Object.keys(report).sort()).toEqual(['casesChecked', 'failures', 'passed', 'reportId']);
  });

  it('deterministic: same cases -> byte-identical report and id', () => {
    const a = verifyEvidenceChain(cleanCases());
    const b = verifyEvidenceChain(cleanCases());
    expect(a).toEqual(b);
    if (a.ok && b.ok) {
      expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
      expect(a.value.reportId).toBe(b.value.reportId);
      expect(a.value.reportId.startsWith('vr:')).toBe(true);
    }
  });

  it('collects every structural violation with indexed dotted paths', () => {
    const result = verifyEvidenceChain([
      'not-an-object',
      { kind: 'unknown-kind', caseId: 'c' },
      { kind: 'lineage-hash', caseId: '' },
      { kind: 'quartet-monotone', caseId: 'c', asOf: 'x', quartets: [] },
      { kind: 'no-future-leakage', caseId: 'c', asOf: 1, samples: [] },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('cases[0]');
    expect(paths).toContain('cases[1].kind');
    expect(paths).toContain('cases[2].caseId');
    expect(paths).toContain('cases[3].asOf');
    expect(paths).toContain('cases[4].samples');
  });

  it('rejects duplicate case ids (typed duplicate_case)', () => {
    const cases = cleanCases();
    const duplicate = { ...(cases[0] as LineageHashCase) };
    const result = verifyEvidenceChain([cases[0], duplicate]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
    expect(result.errors[0]?.path).toBe('cases[1].caseId');
  });

  it('rejects non-array input without throwing', () => {
    expect(verifyEvidenceChain('x' as unknown as readonly unknown[]).ok).toBe(false);
  });
});

describe('NEGATIVE trip-wire: a TAMPERED lineage hash fails the chain (acceptance #7)', () => {
  it('recomputing over a mutated payload detects the tamper (lineage-hash-mismatch)', () => {
    const original = { ...PAYLOAD } as unknown as Record<string, never>;
    const tampered = { ...PAYLOAD, attained: false } as unknown as Record<string, never>;
    const caseRecord: LineageHashCase = {
      kind: 'lineage-hash',
      caseId: 'case.lineage.tamper',
      recordRef: 'record.verdict-1',
      payload: tampered,
      claimedHash: lineageHashOf(original), // the hash of the ORIGINAL — the payload was swapped
    };
    const result = verifyEvidenceChain([caseRecord]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.passed).toBe(false);
    expect(result.value.failures).toEqual([{ caseId: 'case.lineage.tamper', code: 'lineage-hash-mismatch', index: 0 }]);
  });

  it('a claimed hash that is not a well-formed digest fails (lineage-hash-malformed)', () => {
    const payload = { ...PAYLOAD } as unknown as Record<string, never>;
    const caseRecord: LineageHashCase = {
      kind: 'lineage-hash',
      caseId: 'case.lineage.malformed',
      recordRef: 'record.verdict-1',
      payload,
      claimedHash: 'not-a-digest',
    };
    const result = verifyEvidenceChain([caseRecord]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.passed).toBe(false);
    expect(result.value.failures[0]?.code).toBe('lineage-hash-malformed');
  });

  it('a single flipped character in the claimed hash fails (digest sensitivity)', () => {
    const payload = { ...PAYLOAD } as unknown as Record<string, never>;
    const good = lineageHashOf(payload);
    const flipped = (good.slice(0, 15) + (good[15] === '0' ? '1' : '0')) as string;
    const caseRecord: LineageHashCase = {
      kind: 'lineage-hash',
      caseId: 'case.lineage.flip',
      recordRef: 'record.verdict-1',
      payload,
      claimedHash: flipped,
    };
    const result = verifyEvidenceChain([caseRecord]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.passed).toBe(false);
  });

  it('canonical key order does not matter — only content does (L9 canonical form)', () => {
    const a = { ...PAYLOAD, attained: true } as unknown as Record<string, never>;
    const b = { attained: true, ...PAYLOAD } as unknown as Record<string, never>;
    expect(canonicalPayload(a)).toBe(canonicalPayload(b));
    expect(lineageHashOf(a)).toBe(lineageHashOf(b));
  });
});

describe('NEGATIVE trip-wire: a FUTURE-DATED quartet fails the chain (acceptance #7)', () => {
  it('available_time beyond asOf is a quartet-future-dated failure', () => {
    const caseRecord: QuartetMonotoneCase = {
      kind: 'quartet-monotone',
      caseId: 'case.quartet.future',
      asOf: AS_OF,
      quartets: [
        quartet(AS_OF - 5_000, AS_OF - 4_000, AS_OF - 3_000),
        quartet(AS_OF - 1_000, AS_OF + 1_000, AS_OF + 2_000), // future-dated availability
      ],
    };
    const result = verifyEvidenceChain([caseRecord]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.passed).toBe(false);
    expect(result.value.failures).toEqual([{ caseId: 'case.quartet.future', code: 'quartet-future-dated', index: 1 }]);
  });

  it('available_time BEFORE event_time is a quartet-ordering-violation failure', () => {
    const caseRecord: QuartetMonotoneCase = {
      kind: 'quartet-monotone',
      caseId: 'case.quartet.ordering',
      asOf: AS_OF,
      quartets: [quartet(AS_OF - 1_000, AS_OF - 2_000, AS_OF)], // availability precedes occurrence
    };
    const result = verifyEvidenceChain([caseRecord]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.passed).toBe(false);
    expect(result.value.failures).toEqual([{ caseId: 'case.quartet.ordering', code: 'quartet-ordering-violation', index: 0 }]);
  });

  it('failures are located per index — one bad quartet among clean ones', () => {
    const caseRecord: QuartetMonotoneCase = {
      kind: 'quartet-monotone',
      caseId: 'case.quartet.mixed',
      asOf: AS_OF,
      quartets: [
        quartet(AS_OF - 9_000, AS_OF - 8_000, AS_OF - 7_000),
        quartet(AS_OF - 6_000, AS_OF - 6_000, AS_OF - 5_000), // available == event is LEGAL (inclusive)
        quartet(AS_OF - 4_000, AS_OF - 5_000, AS_OF - 3_000), // ordering violation
        quartet(AS_OF - 2_000, AS_OF + 5_000, AS_OF), // future-dated
      ],
    };
    const result = verifyEvidenceChain([caseRecord]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    const failures = result.value.failures as readonly VerificationFailure[];
    expect(failures.map((f) => [f.code, f.index])).toEqual([
      ['quartet-ordering-violation', 2],
      ['quartet-future-dated', 3],
    ]);
  });
});

describe('NEGATIVE trip-wire: future leakage fails the chain (L4)', () => {
  it('an observation delivered BEFORE its availability is a future-leakage failure', () => {
    const caseRecord: NoFutureLeakageCase = {
      kind: 'no-future-leakage',
      caseId: 'case.leakage.premature',
      asOf: AS_OF,
      samples: [
        { clockNow: AS_OF - 5_000, available_time: AS_OF - 6_000 },
        { clockNow: AS_OF - 5_000, available_time: AS_OF - 4_000 }, // seen 1s before availability
      ],
    };
    const result = verifyEvidenceChain([caseRecord]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.passed).toBe(false);
    expect(result.value.failures).toEqual([{ caseId: 'case.leakage.premature', code: 'future-leakage', index: 1 }]);
  });

  it('a sample available beyond the as-of boundary is a sample-future-dated failure', () => {
    const caseRecord: NoFutureLeakageCase = {
      kind: 'no-future-leakage',
      caseId: 'case.leakage.asof',
      asOf: AS_OF,
      samples: [{ clockNow: AS_OF + 10_000, available_time: AS_OF + 5_000 }],
    };
    const result = verifyEvidenceChain([caseRecord]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.passed).toBe(false);
    expect(result.value.failures[0]?.code).toBe('sample-future-dated');
  });

  it('delivery EXACTLY at availability is legal (the inclusive boundary)', () => {
    const caseRecord: NoFutureLeakageCase = {
      kind: 'no-future-leakage',
      caseId: 'case.leakage.exact',
      asOf: AS_OF,
      samples: [{ clockNow: AS_OF - 1_000, available_time: AS_OF - 1_000 }],
    };
    const result = verifyEvidenceChain([caseRecord]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.passed).toBe(true);
  });
});

describe('report consistency laws', () => {
  it('isVerificationReport enforces passed iff failures empty', () => {
    const clean = verifyEvidenceChain(cleanCases());
    if (!clean.ok) throw new Error('must succeed');
    expect(isVerificationReport({ ...clean.value, passed: false })).toBe(false); // passed=false with no failures is inconsistent
    expect(isVerificationReport({ ...clean.value, failures: [{ caseId: 'c', code: 'future-leakage', index: 0 }] })).toBe(false); // passed=true with a failure
    expect(isVerificationReport(null)).toBe(false);
  });

  it('mixed chains: one failed case fails the whole chain (no partial credit, no scores)', () => {
    const cases = cleanCases();
    const payload = { ...PAYLOAD } as unknown as Record<string, never>;
    const tampered: LineageHashCase = {
      kind: 'lineage-hash',
      caseId: 'case.lineage.tamper-2',
      recordRef: 'record.verdict-2',
      payload: { ...PAYLOAD, attained: true, suite: 'suite.TAMPERED' } as unknown as Record<string, never>,
      claimedHash: lineageHashOf(payload),
    };
    const result = verifyEvidenceChain([...cases, tampered]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.passed).toBe(false);
    expect(result.value.casesChecked).toBe(4);
    expect(result.value.failures).toHaveLength(1);
  });
});
