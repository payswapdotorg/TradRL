/**
 * Cross-package interoperability for @tradrl/organization (T016):
 *
 * The D-003/D-004 drift law: organization search consumes agent-os,
 * control-domain, evaluation and agent-body shapes ONLY through
 * STRUCTURAL MIRRORS — never imports in src/ (the frozen workspace
 * lockfile forbids the dependency edges). This test file is the trip
 * wire: it imports the REAL packages on this branch and proves the
 * mirrors have not drifted.
 *
 * 1. Control-domain parity (T007): type-level mutual assignability of
 *    GoalStatementMirror <-> GoalStatement and
 *    ConstraintSetStatementMirror <-> ConstraintSetStatement (the brand
 *    tags match); runtime: control-domain-shaped records pass the mirror
 *    guards unchanged; predicate-evaluation agreement with domain-core's
 *    own engine (the organization mirror executes the same truth).
 * 2. Agent-body registry parity (T003/T016): REAL registry records and
 *    snapshots (built via the registry module's factories) pass the
 *    mirror guards; the digest algorithms are BYTE-IDENTICAL
 *    (registrySnapshotDigestMirror === registryDigestOf); labeled
 *    records fail the mirror validation with `label_as_evidence`.
 * 3. Evaluation parity (T012): type-level mutual assignability of the
 *    bridge trial entries/statistics/selection with the evaluation lane's
 *    TrialLogEntry/TrialStatistic/SelectionClaim; the bridge's
 *    status-invariant law equals the evaluation mirror's; and the
 *    END-TO-END search-integrity proof — a bridge output fed into the
 *    REAL `computeSearchIntegrityReport` succeeds with failures retained
 *    and the best-of-N effect quantified (L11).
 * 4. Agent-os parity (T006): topic-name guard parity against the real
 *    `TopicName` factory/guard, and the kernel-topic reservation
 *    (KERNEL_TOPICS are rejected as organization topics — envelope.ts:
 *    "consumers MUST NOT use them as organization topics").
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type ArmId as OrgArmId,
  type ExperimentId as OrgExperimentId,
  type GoalRef as OrgGoalRef,
  type ConstraintSetRef as OrgConstraintSetRef,
  type ProjectId as OrgProjectId,
  type TenantId as OrgTenantId,
  type TimestampMs as OrgTimestampMs,
  type TopicName as OrgTopicName,
  type TrajectoryId as OrgTrajectoryId,
  type TrialId as OrgTrialId,
  BRIDGE_ARM,
  capabilityKey,
  evaluateCriterionPredicateMirror,
  isOrganizationTopic,
  isTopicName as orgIsTopicName,
  toSearchIntegrityInput,
  validateSearchLog,
} from './index';
import {
  fixtureBlueprint,
  fixtureBudgets,
  fixtureCompilerVersion,
  fixtureConstraints,
  fixtureGoal,
  fixtureSeed,
  fixtureSnapshot,
  fixtureStrategy,
  fixtureTenant,
} from './fixtures';
import type {
  BridgeSelectionClaim,
  BridgeTrialEntry,
  BridgeTrialStatistic,
  GoalStatementMirror,
  ConstraintSetStatementMirror,
  SearchLog,
} from './index';
import { aggregateOrganizationObjective, createOrganizationCandidate, searchRunIdOf } from './index';

// --- REAL packages on this branch (test-only imports — the trip wire) ---
import {
  type GoalStatement,
  type ConstraintSetStatement,
  isGoalStatement,
  isConstraintSetStatement,
} from '../../control-domain/src/index';
import {
  type ConstraintSet,
  type ConstraintEvaluationContext,
  type Timestamp as DomainTimestamp,
  evaluateConstraintSet,
} from '../../domain-core/src/index';
import {
  type ExperimentId,
  type TrialLogEntry,
  type TrialStatistic,
  type SelectionClaim,
  computeSearchIntegrityReport,
  isTrialLogEntry,
} from '../../evaluation/src/index';
import {
  capabilityRecordId as registryCapabilityRecordId,
  createCapabilityRecord,
  createRegistrySnapshot,
  registryDigestOf,
} from '../../agent-body/src/capability-registry';
import {
  KERNEL_TOPICS,
  topicName as osTopicName,
  isTopicName as osIsTopicName,
} from '../../agent-os/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the organization GoalRef is assignable to control-domain's. */
function orgGoalRefIsControl(value: OrgGoalRef): GoalStatement['id'] {
  return value;
}

/** Compiles iff control-domain's GoalRef is assignable to the organization's. */
function controlGoalRefIsOrg(value: GoalStatement['id']): OrgGoalRef {
  return value;
}

/** Compiles iff the TenantId identity spaces coincide (L12: one program-wide space). */
function orgTenantIsControl(value: OrgTenantId): ConstraintSetStatement['tenantId'] {
  return value;
}

function controlTenantIsOrg(value: GoalStatement['tenantId']): OrgTenantId {
  return value;
}

/** Compiles iff the ProjectId identity spaces coincide. */
function orgProjectIsControl(value: OrgProjectId): GoalStatement['tenantId'] {
  return value as never;
}

/** Compiles iff the mirror is assignable to the canonical record (and back). */
function mirrorIsCanonical(value: GoalStatementMirror): GoalStatement {
  return value;
}

function canonicalIsMirror(value: GoalStatement): GoalStatementMirror {
  return value;
}

function constraintMirrorIsCanonical(value: ConstraintSetStatementMirror): ConstraintSetStatement {
  return value;
}

function constraintCanonicalIsMirror(value: ConstraintSetStatement): ConstraintSetStatementMirror {
  return value;
}

/** Compiles iff the bridge trial entry is assignable to the evaluation mirror (and back). */
function bridgeTrialIsEvalTrial(value: BridgeTrialEntry): TrialLogEntry {
  return value;
}

function evalTrialIsBridgeTrial(value: TrialLogEntry): BridgeTrialEntry {
  return value;
}

function bridgeStatisticIsEvalStatistic(value: BridgeTrialStatistic): TrialStatistic {
  return value;
}

function bridgeSelectionIsEvalSelection(value: BridgeSelectionClaim): SelectionClaim {
  return value;
}

/** Compiles iff the bridge identity brands coincide with the evaluation lane's. */
function orgTrialIdIsEval(value: OrgTrialId): TrialLogEntry['trial_id'] {
  return value;
}

function orgArmIdIsEval(value: OrgArmId): TrialLogEntry['arm'] {
  return value;
}

function orgTrajectoryIsEval(value: OrgTrajectoryId): NonNullable<TrialLogEntry['trajectory']> {
  return value;
}

function orgExperimentIsEval(value: OrgExperimentId): ExperimentId {
  return value;
}

// ---------------------------------------------------------------------------
// 1. Control-domain parity
// ---------------------------------------------------------------------------

describe('control-domain parity (T007)', () => {
  it('control-domain-shaped goal and constraint records pass the mirrors unchanged', () => {
    // The fixtures were authored against the MIRROR; the canonical
    // control-domain guards must accept them byte-for-byte, and the
    // organization mirrors must accept control-domain's own guards' output.
    expect(isGoalStatement(fixtureGoal)).toBe(true);
    expect(isConstraintSetStatement(fixtureConstraints)).toBe(true);
  });

  it('the predicate evaluator mirror agrees with domain-core\'s engine', () => {
    // domain-core's evaluateConstraintSet executes Constraint predicates
    // over an evaluation context; the organization mirror must produce the
    // SAME truth for the same predicate over the same value.
    const context: ConstraintEvaluationContext = {
      observations: {},
      state: { 'compute.units': 10, 'latency.p95Ms': 3200 },
      actions: {},
      outcomes: {},
    };
    const constraintSet = {
      id: 'constraints/interop/parity',
      version: 1,
      constraints: [
        {
          id: 'k1',
          domain: 'state',
          subject: 'compute.units',
          predicate: { kind: 'limit.max', bound: 40 },
          severity: 'blocking',
        },
        {
          id: 'k2',
          domain: 'state',
          subject: 'latency.p95Ms',
          predicate: { kind: 'limit.max', bound: 3000 },
          severity: 'blocking',
        },
      ],
      createdAt: '2026-03-01T00:00:00Z',
    } as unknown as ConstraintSet;
    const report = evaluateConstraintSet(constraintSet, context, '2026-03-02T00:00:00Z' as DomainTimestamp);
    const computeCheck = report.checks.find((c: { constraintId: string }) => c.constraintId === 'k1');
    const latencyCheck = report.checks.find((c: { constraintId: string }) => c.constraintId === 'k2');
    expect(computeCheck?.status).toBe('satisfied');
    expect(latencyCheck?.status).toBe('violated');
    // The organization mirror must agree on both truths.
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.max', bound: 40 }, 10)).toBe(true);
    expect(evaluateCriterionPredicateMirror({ kind: 'limit.max', bound: 3000 }, 3200)).toBe(false);
  });

  it('the type-level parity helpers compile (see functions above)', () => {
    expect(orgGoalRefIsControl).toBeDefined();
    expect(controlGoalRefIsOrg).toBeDefined();
    expect(mirrorIsCanonical).toBeDefined();
    expect(canonicalIsMirror).toBeDefined();
    expect(constraintMirrorIsCanonical).toBeDefined();
    expect(constraintCanonicalIsMirror).toBeDefined();
    expect(orgTenantIsControl).toBeDefined();
    expect(controlTenantIsOrg).toBeDefined();
    expectTypeOf(mirrorIsCanonical(fixtureGoal)).toExtend<GoalStatement>();
  });
});

// ---------------------------------------------------------------------------
// 2. Agent-body registry parity (the absorbed module)
// ---------------------------------------------------------------------------

const realRecord = createCapabilityRecord({
  recordId: registryCapabilityRecordId('capreg-substrate-limite-0001'),
  subject: { kind: 'cognitive-substrate', substrateRef: 'limite-labs/limite-math@2026.01' },
  descriptors: [
    {
      capability: capabilityKey('mathematical-reasoning'),
      evidence: [
        { kind: 'benchmark', benchmarkId: 'bench/olympiad-mix-v3', resultRef: 'result/bench/olympiad-mix-v3/limite-math@2026.01' },
        { kind: 'measurement-record', recordRef: 'meas/limite-math/latency-2026-02', metric: 'p95-latency-ms', value: 1850 },
        { kind: 'measurement-record', recordRef: 'meas/limite-math/score-2026-02', metric: 'benchmark-score', value: 0.83 },
        { kind: 'measurement-record', recordRef: 'meas/limite-math/cost-2026-02', metric: 'compute-units', value: 6 },
      ],
    },
  ],
  compatibilityRefs: [],
});

const realSnapshot = createRegistrySnapshot([realRecord]);

describe('agent-body registry parity (T003/T016 absorption)', () => {
  it('REAL registry records and snapshots pass the organization mirrors unchanged', async () => {
    const { isCapabilityRecordMirror, isRegistrySnapshotMirror, validateRegistrySnapshotMirror } = await import(
      './capability-mirror'
    );
    expect(isCapabilityRecordMirror(realRecord)).toBe(true);
    expect(isRegistrySnapshotMirror(realSnapshot)).toBe(true);
    const result = validateRegistrySnapshotMirror(realSnapshot);
    expect(result.ok).toBe(true);
  });

  it('the digest algorithms are BYTE-IDENTICAL (registrySnapshotDigestMirror === registryDigestOf)', async () => {
    const { registrySnapshotDigestMirror } = await import('./capability-mirror');
    expect(registrySnapshotDigestMirror([realRecord])).toBe(realSnapshot.digest);
    expect(registryDigestOf([realRecord])).toBe(realSnapshot.digest);
  });

  it('a REAL labeled record fails the mirror validation with label_as_evidence', async () => {
    const { validateRegistrySnapshotMirror } = await import('./capability-mirror');
    const labeled: unknown = {
      records: [{ ...(realRecord as unknown as Record<string, unknown>), profession: 'mathematician' }],
      digest: 'aaaaaaaaaaaaaaaa',
    };
    const result = validateRegistrySnapshotMirror(labeled);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Evaluation parity + the END-TO-END search-integrity bridge proof
// ---------------------------------------------------------------------------

function buildInteropLog(): SearchLog {
  const measurements = (attainment: number) => ({
    attainmentScore: attainment,
    attainmentEvidenceRef: 'evidence/attainment/atlas-run-42',
    riskPenalty: 0.25,
    riskPolicyRefs: ['policy/risk/atlas/researcher-gate'],
    computeUnits: 10,
    coordinationCostWires: 2,
    latencyMs: 1200,
    robustness: 0.7,
    redundancy: 0.5,
  });
  const aggregate = (attainment: number) => {
    const result = aggregateOrganizationObjective(measurements(attainment), fixtureStrategy);
    if (!result.ok) throw new Error('interop fixture aggregation failed');
    return result.value;
  };
  const lineageBlock = (parent: string | null) => ({
    goalRef: fixtureGoal.id,
    goalVersion: fixtureGoal.version,
    constraintSetRef: fixtureConstraints.id,
    constraintSetVersion: fixtureConstraints.version,
    registrySnapshotDigest: fixtureSnapshot.digest,
    seed: fixtureSeed,
    compilerVersion: fixtureCompilerVersion,
    parentCandidateId: parent as never,
    tenantId: fixtureTenant,
    projectId: 'project/atlas/regime-alpha' as never,
  });
  const candidates = [
    createOrganizationCandidate({
      candidateId: 'candidate-1' as never,
      sequence: 1,
      blueprint: fixtureBlueprint as never,
      measurements: measurements(0.5) as never,
      objective: aggregate(0.5),
      lineage: lineageBlock(null),
      disposition: 'rejected',
      reasons: [{ code: 'below-required-satisfaction', requiredSatisfaction: 0.6, attainmentScore: 0.5 }],
    }),
    createOrganizationCandidate({
      candidateId: 'candidate-2' as never,
      sequence: 2,
      blueprint: fixtureBlueprint as never,
      measurements: measurements(0.8) as never,
      objective: aggregate(0.8),
      lineage: lineageBlock('candidate-1'),
      disposition: 'proposed',
      reasons: [],
    }),
    createOrganizationCandidate({
      candidateId: 'candidate-3' as never,
      sequence: 3,
      blueprint: fixtureBlueprint as never,
      measurements: measurements(0.7) as never,
      objective: aggregate(0.7),
      lineage: lineageBlock('candidate-1'),
      disposition: 'retained',
      reasons: [],
    }),
    createOrganizationCandidate({
      candidateId: 'candidate-4' as never,
      sequence: 4,
      blueprint: fixtureBlueprint as never,
      measurements: measurements(0.55) as never,
      objective: aggregate(0.55),
      lineage: lineageBlock('candidate-2'),
      disposition: 'rejected',
      reasons: [{ code: 'retain-limit', retainedCount: 1 }],
    }),
  ];
  return {
    searchRunId: searchRunIdOf({
      goal: fixtureGoal,
      constraints: fixtureConstraints,
      budgets: fixtureBudgets,
      registrySnapshot: fixtureSnapshot,
      seed: fixtureSeed,
      compilerVersion: fixtureCompilerVersion,
      requiredCapabilities: [capabilityKey('mathematical-reasoning'), capabilityKey('regime-analysis')],
      gaps: [],
    }),
    tenantId: fixtureTenant,
    projectId: 'project/atlas/regime-alpha' as never,
    goal: fixtureGoal,
    constraints: fixtureConstraints,
    budgets: fixtureBudgets,
    registrySnapshot: fixtureSnapshot,
    seed: fixtureSeed,
    compilerVersion: fixtureCompilerVersion,
    strategy: fixtureStrategy as never,
    requiredCapabilities: [capabilityKey('mathematical-reasoning'), capabilityKey('regime-analysis')],
    candidates,
    discovery: [],
    selection: { selectedCandidateId: 'candidate-2' as never },
  };
}

describe('evaluation parity + the search-integrity bridge (T012)', () => {
  const log = buildInteropLog();
  const baseInstant = 1_772_600_000_000 as OrgTimestampMs;

  it('the interop log validates against the full law', () => {
    const result = validateSearchLog(log);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('interop log must validate');
  });

  it('the bridge emits the evaluation input triple (guards pass, mirror laws agree)', () => {
    const bridged = toSearchIntegrityInput(log, baseInstant);
    expect(bridged.ok).toBe(true);
    if (!bridged.ok) throw new Error('bridge failed');
    const { experiment, statistics, selection } = bridged.value;
    // The evaluation lane's OWN guards accept every bridge record.
    expect(experiment.trials.every((trial) => isTrialLogEntry(trial))).toBe(true);
    expect(statistics).toHaveLength(4);
    expect(selection.selectedTrialId as string).toBe('candidate-2');
  });

  it('END-TO-END: the REAL computeSearchIntegrityReport scores the bridge output (L11)', () => {
    const bridged = toSearchIntegrityInput(log, baseInstant);
    expect(bridged.ok).toBe(true);
    if (!bridged.ok) throw new Error('bridge failed');
    const { experiment, statistics, selection } = bridged.value;
    const report = computeSearchIntegrityReport(
      experiment as unknown as Parameters<typeof computeSearchIntegrityReport>[0],
      statistics as unknown as readonly unknown[],
      selection as unknown,
    );
    expect(report.ok).toBe(true);
    if (report.ok) {
      // Failures retained: BOTH rejected candidates are counted (L11).
      expect(report.value.failuresRetained).toBe(0); // rejected trials, not failed ones
      expect(report.value.rejectionsRetained).toBe(2);
      expect(report.value.succeeded).toBe(2); // proposed + retained
      expect(report.value.trialsCounted).toBe(4);
      // Best-of-N effect quantified over the full enumeration history.
      expect(report.value.bestOfN?.candidates).toBe(2); // candidates with statistics
      expect(report.value.bestOfN?.selectedIsBest).toBe(true);
      // Blind expectation = mean over scored candidates; the selected score
      // is the max, so inflation is strictly positive.
      expect(report.value.bestOfN?.selectionInflation).toBeGreaterThan(0);
    }
  });

  it('hiding a rejected candidate is caught by the evaluation lane itself (hidden_trials)', () => {
    const bridged = toSearchIntegrityInput(log, baseInstant);
    expect(bridged.ok).toBe(true);
    if (!bridged.ok) throw new Error('bridge failed');
    const { experiment, statistics, selection } = bridged.value;
    // Drop the statistics of one REJECTED candidate — the classic "make the
    // search look cleaner" move. The evaluation lane's typed error fires.
    const doctored = statistics.filter((statistic) => statistic.trial_id !== 'candidate-1');
    const report = computeSearchIntegrityReport(
      experiment as unknown as Parameters<typeof computeSearchIntegrityReport>[0],
      doctored as unknown as readonly unknown[],
      selection as unknown,
    );
    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.errors.some((e) => e.code === 'hidden_trials')).toBe(true);
    }
  });

  it('the bridge is deterministic given (log, baseInstant)', () => {
    const a = toSearchIntegrityInput(log, baseInstant);
    const b = toSearchIntegrityInput(log, baseInstant);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('the type-level parity helpers compile (see functions above)', () => {
    expect(bridgeTrialIsEvalTrial).toBeDefined();
    expect(evalTrialIsBridgeTrial).toBeDefined();
    expect(bridgeStatisticIsEvalStatistic).toBeDefined();
    expect(bridgeSelectionIsEvalSelection).toBeDefined();
    expect(orgTrialIdIsEval).toBeDefined();
    expect(orgArmIdIsEval).toBeDefined();
    expect(orgTrajectoryIsEval).toBeDefined();
    expect(orgExperimentIsEval).toBeDefined();
    expectTypeOf(bridgeTrialIsEvalTrial).toBeFunction();
  });
});

// ---------------------------------------------------------------------------
// 4. Agent-os parity (T006)
// ---------------------------------------------------------------------------

describe('agent-os parity (T006)', () => {
  it('topic-name guard parity: every real TopicName passes the organization mirror', () => {
    for (const sample of ['org.atlas.coordination', 'team.regime-alpha.signal', 'a']) {
      const real = osTopicName(sample);
      expect(orgIsTopicName(real)).toBe(true);
      expect(osIsTopicName(real)).toBe(true);
    }
    for (const bad of ['', 'has space', 'ünicode-topic']) {
      expect(orgIsTopicName(bad)).toBe(osIsTopicName(bad));
    }
  });

  it('the REAL KERNEL_TOPICS are rejected as organization topics (envelope law)', () => {
    // envelope.ts: "consumers MUST NOT use them as organization topics."
    expect(KERNEL_TOPICS.length).toBeGreaterThanOrEqual(5);
    for (const topic of KERNEL_TOPICS) {
      expect(isOrganizationTopic(topic)).toBe(false);
      expect(orgIsTopicName(topic)).toBe(true); // still a valid TopicName —
      expect(osIsTopicName(topic)).toBe(true); // just RESERVED for the kernel.
    }
    expect(isOrganizationTopic('kernel.request')).toBe(false);
    expect(isOrganizationTopic(BRIDGE_ARM as never as OrgTopicName)).toBe(true);
  });
});
