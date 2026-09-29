// @tradrl/organization — capability-registry + control-plane mirror tests.
//
// Laws under test:
// - The registry mirror's TYPED validation: L16a `label_as_evidence`,
//   `registry_digest_mismatch` (L9), duplicate ids, structural
//   collect-all.
// - Query-by-capability pure filtering and measured-value extraction.
// - Control-mirror guards over the goal/constraint fixtures, and the
//   predicate evaluator's total, fail-closed semantics.

import { describe, expect, it } from 'vitest';
import {
  capabilityKey,
  type CapabilityRecordMirror,
  type CapabilityQueryMirror,
  type RegistrySnapshotMirror,
  evaluateCriterionPredicateMirror,
  isCapabilityQueryMirror,
  isCapabilityRecordMirror,
  isConstraintSetStatementMirror,
  isGoalStatementMirror,
  isMeasuredEvidenceMirror,
  isRegistrySnapshotMirror,
  measuredValueOf,
  queryByCapabilityMirror,
  registrySnapshotDigestMirror,
  validateRegistrySnapshotMirror,
} from './index';
import {
  fixtureConstraints,
  fixtureGoal,
  fixtureRecords,
  fixtureSnapshot,
} from './fixtures';

describe('registry mirror: positive paths', () => {
  it('the fixture records and snapshot pass the mirror guards', () => {
    for (const record of fixtureRecords) expect(isCapabilityRecordMirror(record)).toBe(true);
    expect(isRegistrySnapshotMirror(fixtureSnapshot)).toBe(true);
  });

  it('the mirror snapshot validates against the full law (digest binds)', () => {
    const result = validateRegistrySnapshotMirror(fixtureSnapshot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it('the snapshot digest is order-independent (set semantics)', () => {
    const reversed = [...fixtureRecords].reverse();
    expect(registrySnapshotDigestMirror(reversed)).toBe(fixtureSnapshot.digest);
  });

  it('the snapshot survives a JSON round-trip', () => {
    const roundTrip: unknown = JSON.parse(JSON.stringify(fixtureSnapshot));
    expect(validateRegistrySnapshotMirror(roundTrip).ok).toBe(true);
  });

  it('evidence guards cover the closed union', () => {
    expect(isMeasuredEvidenceMirror({ kind: 'benchmark', benchmarkId: 'b', resultRef: 'r' })).toBe(true);
    expect(isMeasuredEvidenceMirror({ kind: 'measurement-record', recordRef: 'm', metric: 'p50-latency-ms', value: 3 })).toBe(true);
    expect(isMeasuredEvidenceMirror({ kind: 'result-ref', resultRef: 'r' })).toBe(true);
    expect(isMeasuredEvidenceMirror({ kind: 'label', label: 'mathematician' })).toBe(false);
    expect(isMeasuredEvidenceMirror({ kind: 'vibes' })).toBe(false);
  });
});

describe('registry mirror: L16a and L9 typed errors (negative paths)', () => {
  it('a labeled record fails the mirror guard', () => {
    const labeled: unknown = {
      ...fixtureRecords[0],
      descriptors: [
        { ...fixtureRecords[0]?.descriptors[0], profession: 'mathematician' },
      ],
    };
    expect(isCapabilityRecordMirror(labeled)).toBe(false);
  });

  it('label-as-evidence is the typed error (field keys)', () => {
    const labeled: unknown = {
      records: [
        {
          ...fixtureRecords[0],
          role: 'researcher',
        },
      ],
      digest: 'aaaaaaaaaaaaaaaa',
    };
    const result = validateRegistrySnapshotMirror(labeled);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.code === 'label_as_evidence');
      expect(error).toBeDefined();
      expect(error?.path).toContain('role');
    }
  });

  it('label-as-evidence is the typed error (kind: "label" evidence)', () => {
    const labelEvidence: unknown = {
      records: [
        {
          recordId: 'capreg-bad-0001',
          subject: { kind: 'cognitive-substrate', substrateRef: 'acme-models/reasoner-2@2026.03' },
          descriptors: [
            { capability: 'mathematical-reasoning', evidence: [{ kind: 'label', label: 'mathematician' }] },
          ],
          compatibilityRefs: [],
        },
      ],
      digest: 'aaaaaaaaaaaaaaaa',
    };
    const result = validateRegistrySnapshotMirror(labelEvidence);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
    }
  });

  it('an empty-evidence descriptor is label_as_evidence (a bare claim is a label)', () => {
    const bare: unknown = {
      records: [
        {
          recordId: 'capreg-bad-0002',
          subject: { kind: 'body-version', bodyVersionRef: 'math-researcher@1.0.0' },
          descriptors: [{ capability: 'mathematical-reasoning', evidence: [] }],
          compatibilityRefs: [],
        },
      ],
      digest: 'aaaaaaaaaaaaaaaa',
    };
    const result = validateRegistrySnapshotMirror(bare);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
    }
  });

  it('a doctored digest is registry_digest_mismatch (L9 lineage forgery)', () => {
    const doctored: RegistrySnapshotMirror = { records: fixtureRecords, digest: '0000000000000000' as never };
    const result = validateRegistrySnapshotMirror(doctored);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('registry_digest_mismatch');
    }
  });

  it('duplicate record ids are invalid', () => {
    const duplicated: unknown = {
      records: [fixtureRecords[0], fixtureRecords[0]],
      digest: registrySnapshotDigestMirror([fixtureRecords[0], fixtureRecords[0]]),
    };
    const result = validateRegistrySnapshotMirror(duplicated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('duplicate record id'))).toBe(true);
    }
  });

  it('structural violations are collected, never thrown', () => {
    expect(validateRegistrySnapshotMirror(null).ok).toBe(false);
    expect(validateRegistrySnapshotMirror('snapshot').ok).toBe(false);
    expect(validateRegistrySnapshotMirror({ records: 'nope', digest: 'x' }).ok).toBe(false);
    const malformed: unknown = { records: [{ recordId: 42, subject: null, descriptors: [], compatibilityRefs: null }], digest: 9 };
    const result = validateRegistrySnapshotMirror(malformed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('query-by-capability (pure filtering)', () => {
  it('matches records demonstrating every required key', () => {
    const query: CapabilityQueryMirror = { requires: [capabilityKey('mathematical-reasoning')] };
    expect(isCapabilityQueryMirror(query)).toBe(true);
    const matches = queryByCapabilityMirror(fixtureSnapshot, query);
    expect(matches.map((record) => record.recordId)).toEqual([
      'capreg-body-mathresearcher-0001',
      'capreg-substrate-limite-0001',
    ]);
  });

  it('a multi-key contract requires all keys on one record', () => {
    const matches = queryByCapabilityMirror(fixtureSnapshot, {
      requires: [capabilityKey('mathematical-reasoning'), capabilityKey('stochastic-process-analysis')],
    });
    expect(matches.map((record) => record.recordId)).toEqual(['capreg-body-mathresearcher-0001']);
  });

  it('unknown keys match nothing; malformed queries fail the guard', () => {
    expect(queryByCapabilityMirror(fixtureSnapshot, { requires: [capabilityKey('sentiment-event-analysis')] })).toHaveLength(0);
    expect(isCapabilityQueryMirror({ requires: [] })).toBe(false);
    expect(isCapabilityQueryMirror({ requires: ['x', 'x'] })).toBe(false);
    expect(isCapabilityQueryMirror({ requires: ['x', 42] })).toBe(false);
  });

  it('querying is pure (snapshot unchanged)', () => {
    const before = JSON.stringify(fixtureSnapshot);
    queryByCapabilityMirror(fixtureSnapshot, { requires: [capabilityKey('risk-assessment')] });
    expect(JSON.stringify(fixtureSnapshot)).toBe(before);
  });
});

describe('measured-value extraction (deterministic, declared)', () => {
  it('extracts the last measurement for a metric in record order', () => {
    const limite = fixtureRecords[1] as CapabilityRecordMirror;
    expect(measuredValueOf(limite, 'benchmark-score')).toBe(0.83);
    expect(measuredValueOf(limite, 'p95-latency-ms')).toBe(1850);
    expect(measuredValueOf(limite, 'compute-units')).toBe(6);
  });

  it('returns null when the record carries no such measurement', () => {
    const swift = fixtureRecords[2] as CapabilityRecordMirror;
    expect(measuredValueOf(swift, 'benchmark-score')).toBe(0.64);
    const mathBody = fixtureRecords[0] as CapabilityRecordMirror;
    expect(measuredValueOf(mathBody, 'p95-latency-ms')).toBeNull();
    expect(measuredValueOf(mathBody, 'compute-units')).toBeNull();
  });
});

describe('control-plane mirrors (compile inputs)', () => {
  it('the goal and constraint fixtures pass the mirror guards', () => {
    expect(isGoalStatementMirror(fixtureGoal)).toBe(true);
    expect(isConstraintSetStatementMirror(fixtureConstraints)).toBe(true);
  });

  it('mirrors survive JSON round-trips', () => {
    expect(isGoalStatementMirror(JSON.parse(JSON.stringify(fixtureGoal)))).toBe(true);
    expect(isConstraintSetStatementMirror(JSON.parse(JSON.stringify(fixtureConstraints)))).toBe(true);
  });

  it('mirror guards reject malformed goals (collect-all via guard totality)', () => {
    expect(isGoalStatementMirror({ ...fixtureGoal, version: 0 })).toBe(false);
    expect(isGoalStatementMirror({ ...fixtureGoal, tenantId: '' })).toBe(false);
    expect(isGoalStatementMirror({ ...fixtureGoal, horizon: { startsAt: 2, endsAt: 1 } })).toBe(false);
    expect(isGoalStatementMirror({ ...fixtureGoal, successCriteria: { criteria: [], requiredSatisfaction: 1 } })).toBe(false);
    expect(isGoalStatementMirror(null)).toBe(false);
    expect(isConstraintSetStatementMirror({ ...fixtureConstraints, constraints: 'nope' })).toBe(false);
    expect(isConstraintSetStatementMirror(null)).toBe(false);
  });

  it('the predicate evaluator mirror is total and fail-closed', () => {
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.max', bound: 40 }, 10)).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.max', bound: 40 }, 50)).toBe(false);
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.min', bound: 0.75 }, 0.8)).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.min', bound: 0.75 }, 'high' as never)).toBe(false);
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.range', min: 1, max: 5 }, 3)).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.range', min: 1, max: 5 }, 9)).toBe(false);
    expect(evaluateCriterionPredicateMirror({ kind: 'equals', value: 'exact-replay' }, 'exact-replay')).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'notEquals', value: true }, false)).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'oneOf', values: ['a', 'b'] }, 'b')).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'oneOf', values: ['a', 'b'] }, 'c')).toBe(false);
    expect(evaluateCriterionPredicateMirror({ kind: 'flag', expected: true }, false)).toBe(false);
    expect(evaluateCriterionPredicateMirror({ kind: 'flag', expected: true }, 'yes' as never)).toBe(false);
  });
});
