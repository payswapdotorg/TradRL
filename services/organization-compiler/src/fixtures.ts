/**
 * @tradrl/organization-compiler — deterministic service fixtures.
 *
 * A deterministic fake registry snapshot (capability records with MEASURED
 * evidence only — L16a), a goal/constraint fixture pair, and the compile
 * inputs the reference-compiler test suite and golden determinism check
 * drive. Everything is a pure literal; the same fixtures always produce
 * the same golden candidate sequence.
 */

import {
  type CapabilityGap,
  type CapabilityKey,
  type CapabilityRecordMirror,
  type CompileBudgets,
  type CompileInput,
  type GoalStatementMirror,
  type ConstraintSetStatementMirror,
  type RegistrySnapshotMirror,
  type TimestampMs,
  capabilityGapId,
  capabilityKey,
  capabilityRecordId,
  compilerVersionRef,
  attainmentEvidenceRef,
  goalRef,
  constraintSetRef,
  registrySnapshotDigestMirror,
  searchSeed,
  tenantId,
} from '../../../packages/organization/src/index';
import { REFERENCE_COMPILER_VERSION } from './strategy';

// ---------------------------------------------------------------------------
// The goal / constraint fixture pair (control-domain shapes)
// ---------------------------------------------------------------------------

export const fixtureGoal: GoalStatementMirror = {
  id: goalRef('goal/atlas/regime-alpha'),
  version: 3,
  tenantId: tenantId('tenant-atlas'),
  objective: 'Discover an organization that attains the regime-alpha objective under constraints.',
  horizon: { startsAt: 1_772_611_200_000 as TimestampMs, endsAt: 1_772_700_000_000 as TimestampMs, label: 'Q2-2026' },
  successCriteria: {
    criteria: [
      { id: 'c-attain', metric: 'attainment.satisfiedRatio', predicate: { kind: 'limit.min', bound: 0.75 } },
      { id: 'c-drawdown', metric: 'risk.maxDrawdownRatio', predicate: { kind: 'limit.max', bound: 0.2 } },
      { id: 'c-latency', metric: 'latency.p95Ms', predicate: { kind: 'limit.max', bound: 2500 } },
    ],
    requiredSatisfaction: 0.6,
  },
  evaluation: {
    blindRef: 'policy/blind/atlas-v1',
    walkForwardRef: 'policy/walk-forward/atlas-v1',
    regimeRef: 'policy/regime/atlas-v1',
    adversarialRequired: true,
  },
  createdAt: 1_772_000_000_000 as TimestampMs,
};

export const fixtureConstraints: ConstraintSetStatementMirror = {
  id: constraintSetRef('constraints/atlas/risk-budget'),
  version: 2,
  tenantId: tenantId('tenant-atlas'),
  name: 'Atlas risk budget',
  constraints: [
    {
      id: 'k-compute',
      domain: 'state',
      subject: 'compute.units',
      predicate: { kind: 'limit.max', bound: 40 },
      severity: 'blocking',
    },
    {
      id: 'k-latency',
      domain: 'state',
      subject: 'latency.p95Ms',
      predicate: { kind: 'limit.max', bound: 3000 },
      severity: 'blocking',
    },
    {
      id: 'k-wires',
      domain: 'action',
      subject: 'coordination.wires',
      predicate: { kind: 'limit.max', bound: 12 },
      severity: 'advisory',
    },
  ],
  createdAt: 1_772_000_100_000 as TimestampMs,
};

// ---------------------------------------------------------------------------
// The deterministic fake registry snapshot (measured evidence ONLY)
// ---------------------------------------------------------------------------

const mathBodyRecord: CapabilityRecordMirror = {
  recordId: capabilityRecordId('capreg-body-mathresearcher-0001'),
  subject: { kind: 'body-version', bodyVersionRef: 'math-researcher@1.0.0' },
  descriptors: [
    {
      capability: capabilityKey('mathematical-reasoning'),
      evidence: [
        { kind: 'benchmark', benchmarkId: 'bench/olympiad-mix-v3', resultRef: 'result/bench/olympiad-mix-v3/math-researcher@1.0.0' },
        { kind: 'measurement-record', recordRef: 'meas/math-researcher/proof-depth-2026-02', metric: 'benchmark-score', value: 0.87 },
        { kind: 'measurement-record', recordRef: 'meas/math-researcher/latency-2026-02', metric: 'p95-latency-ms', value: 1500 },
        { kind: 'measurement-record', recordRef: 'meas/math-researcher/cost-2026-02', metric: 'compute-units', value: 5 },
      ],
    },
    {
      capability: capabilityKey('stochastic-process-analysis'),
      evidence: [
        { kind: 'measurement-record', recordRef: 'meas/math-researcher/stochastic-2026-02', metric: 'benchmark-score', value: 0.79 },
      ],
    },
  ],
  compatibilityRefs: ['compat/math-researcher@1.0.0/frontier-reasoner'],
};

const limiteSubstrateRecord: CapabilityRecordMirror = {
  recordId: capabilityRecordId('capreg-substrate-limite-0001'),
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
};

const swiftSubstrateRecord: CapabilityRecordMirror = {
  recordId: capabilityRecordId('capreg-substrate-swift-0001'),
  subject: { kind: 'cognitive-substrate', substrateRef: 'delta-labs/swift-1@2026.02' },
  descriptors: [
    {
      capability: capabilityKey('regime-analysis'),
      evidence: [
        { kind: 'measurement-record', recordRef: 'meas/swift-1/regime-2026-02', metric: 'benchmark-score', value: 0.64 },
        { kind: 'measurement-record', recordRef: 'meas/swift-1/latency-2026-02', metric: 'p95-latency-ms', value: 900 },
        { kind: 'measurement-record', recordRef: 'meas/swift-1/cost-2026-02', metric: 'compute-units', value: 2 },
      ],
    },
    {
      capability: capabilityKey('sentiment-event-analysis'),
      evidence: [
        { kind: 'measurement-record', recordRef: 'meas/swift-1/sentiment-2026-02', metric: 'benchmark-score', value: 0.58 },
        { kind: 'measurement-record', recordRef: 'meas/swift-1/sentiment-latency-2026-02', metric: 'p50-latency-ms', value: 300 },
      ],
    },
  ],
  compatibilityRefs: [],
};

const wideSubstrateRecord: CapabilityRecordMirror = {
  recordId: capabilityRecordId('capreg-substrate-wide-0001'),
  subject: { kind: 'cognitive-substrate', substrateRef: 'delta-labs/wide-1@2026.01' },
  descriptors: [
    {
      capability: capabilityKey('regime-analysis'),
      evidence: [
        { kind: 'measurement-record', recordRef: 'meas/wide-1/regime-2026-02', metric: 'benchmark-score', value: 0.71 },
        { kind: 'measurement-record', recordRef: 'meas/wide-1/latency-2026-02', metric: 'p95-latency-ms', value: 1100 },
        { kind: 'measurement-record', recordRef: 'meas/wide-1/cost-2026-02', metric: 'compute-units', value: 3 },
      ],
    },
    {
      capability: capabilityKey('sentiment-event-analysis'),
      evidence: [
        { kind: 'measurement-record', recordRef: 'meas/wide-1/sentiment-2026-02', metric: 'benchmark-score', value: 0.62 },
        { kind: 'measurement-record', recordRef: 'meas/wide-1/sentiment-latency-2026-02', metric: 'p95-latency-ms', value: 800 },
        { kind: 'measurement-record', recordRef: 'meas/wide-1/sentiment-cost-2026-02', metric: 'compute-units', value: 1 },
      ],
    },
    {
      capability: capabilityKey('mathematical-reasoning'),
      evidence: [
        { kind: 'result-ref', resultRef: 'result/math-suite/wide-1@2026.01' },
      ],
    },
  ],
  compatibilityRefs: [],
};

/** The deterministic fake registry snapshot (canonical digest derived). */
export const fixtureSnapshot: RegistrySnapshotMirror = {
  records: [mathBodyRecord, limiteSubstrateRecord, swiftSubstrateRecord, wideSubstrateRecord],
  digest: registrySnapshotDigestMirror([
    mathBodyRecord,
    limiteSubstrateRecord,
    swiftSubstrateRecord,
    wideSubstrateRecord,
  ]) as never,
};

// ---------------------------------------------------------------------------
// Budgets, demand and the compile input
// ---------------------------------------------------------------------------

export const fixtureBudgets: CompileBudgets = {
  maxAgents: 4,
  maxComputeUnits: 40,
  maxCoordinationWires: 12,
  maxLatencyMs: 3000,
  maxEnumeratedCandidates: 64,
  retainLimitK: 2,
} as const;

/** The fixture demand: three capability contracts (the search-space axes' demand side). */
export const fixtureRequiredCapabilities: readonly CapabilityKey[] = [
  capabilityKey('mathematical-reasoning'),
  capabilityKey('regime-analysis'),
  capabilityKey('sentiment-event-analysis'),
];

/** The fixture failure-driven gaps (LEARNING-LOOP typed CapabilityGaps). */
export const fixtureGaps: readonly CapabilityGap[] = [
  {
    gapId: capabilityGapId('gap.regime-alpha.math-reasoning'),
    kind: 'regime',
    capabilityKey: capabilityKey('mathematical-reasoning'),
    evidenceRef: attainmentEvidenceRef('evidence/failure/atlas-run-41'),
    detectedAt: 1_772_500_000_000 as TimestampMs,
    tenantId: 'tenant-atlas',
    projectId: 'project/atlas/regime-alpha' as never,
  },
];

/** The deterministic compile input the reference compiler runs on. */
export const fixtureCompileInput: CompileInput = {
  goal: fixtureGoal,
  constraints: fixtureConstraints,
  budgets: fixtureBudgets,
  registrySnapshot: fixtureSnapshot,
  requiredCapabilities: fixtureRequiredCapabilities,
  gaps: fixtureGaps,
  seed: searchSeed('atlas-regime-alpha-seed-7'),
  compilerVersion: compilerVersionRef(REFERENCE_COMPILER_VERSION),
  tenantId: tenantId('tenant-atlas'),
  projectId: 'project/atlas/regime-alpha' as never,
};
