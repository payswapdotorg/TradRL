/**
 * @tradrl/organization — shared TEST fixtures (not exported from the
 * package index; imported directly by the test files).
 *
 * Everything here is deterministic, measured-evidence-only and
 * JSON-round-trippable. Provider names are fictional (L13/L14). Branded
 * values are constructed through the package's validating factories.
 */

import {
  capabilityKey,
  capabilityRecordId,
  type CapabilityRecordMirror,
  type CompilerVersionRef,
  type ConstraintSetRef,
  type GoalRef,
  type RegistryDigest,
  type SearchSeed,
  type TenantId,
  type TimestampMs,
  compilerVersionRef,
  constraintSetRef,
  goalRef,
  registrySnapshotDigestMirror,
  searchSeed,
  tenantId,
} from './index';
import type { GoalStatementMirror, ConstraintSetStatementMirror, RegistrySnapshotMirror } from './index';

const tenant: TenantId = tenantId('tenant-atlas');
const goal: GoalRef = goalRef('goal/atlas/regime-alpha');
const constraintSet: ConstraintSetRef = constraintSetRef('constraints/atlas/risk-budget');
const seed: SearchSeed = searchSeed('atlas-regime-alpha-seed-7');
const compiler: CompilerVersionRef = compilerVersionRef('reference-enumeration/1');

// ---------------------------------------------------------------------------
// Goal mirror fixture (control-domain shape)
// ---------------------------------------------------------------------------

export const fixtureGoal: GoalStatementMirror = {
  id: goal,
  version: 3,
  tenantId: tenant,
  objective: 'Discover an organization that attains the regime-alpha objective under constraints.',
  horizon: { startsAt: 1_772_611_200_000 as TimestampMs, endsAt: 1_772_700_000_000 as TimestampMs, label: 'Q2-2026' },
  successCriteria: {
    criteria: [
      {
        id: 'c-attain',
        metric: 'attainment.satisfiedRatio',
        predicate: { kind: 'limit.min', bound: 0.75 },
      },
      {
        id: 'c-drawdown',
        metric: 'risk.maxDrawdownRatio',
        predicate: { kind: 'limit.max', bound: 0.2 },
      },
      {
        id: 'c-latency',
        metric: 'latency.p95Ms',
        predicate: { kind: 'limit.max', bound: 2500 },
      },
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

// ---------------------------------------------------------------------------
// Constraint-set mirror fixture (control-domain shape)
// ---------------------------------------------------------------------------

export const fixtureConstraints: ConstraintSetStatementMirror = {
  id: constraintSet,
  version: 2,
  tenantId: tenant,
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
// Registry snapshot fixture (measured evidence only — L16a)
// ---------------------------------------------------------------------------

export const fixtureRecords: readonly CapabilityRecordMirror[] = [
  {
    recordId: capabilityRecordId('capreg-body-mathresearcher-0001'),
    subject: { kind: 'body-version', bodyVersionRef: 'math-researcher@1.0.0' },
    descriptors: [
      {
        capability: capabilityKey('mathematical-reasoning'),
        evidence: [
          { kind: 'benchmark', benchmarkId: 'bench/olympiad-mix-v3', resultRef: 'result/bench/olympiad-mix-v3/math-researcher@1.0.0' },
          { kind: 'measurement-record', recordRef: 'meas/math-researcher/proof-depth-2026-02', metric: 'benchmark-score', value: 0.87 },
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
  },
  {
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
  },
  {
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
        capability: capabilityKey('risk-assessment'),
        evidence: [{ kind: 'result-ref', resultRef: 'result/risk-suite/swift-1@2026.02' }],
      },
    ],
    compatibilityRefs: [],
  },
];

export const fixtureSnapshot: RegistrySnapshotMirror = {
  records: fixtureRecords,
  digest: registrySnapshotDigestMirror(fixtureRecords) as RegistryDigest,
};

// ---------------------------------------------------------------------------
// Strategy + budgets + identity fixtures
// ---------------------------------------------------------------------------

export const fixtureStrategy = {
  strategyVersion: 'weighted-sum-v1',
  weights: {
    attainment: 0.4,
    riskPenalty: 0.1,
    compute: 0.1,
    coordinationCost: 0.1,
    latency: 0.1,
    robustness: 0.1,
    redundancy: 0.1,
  },
  normalization: {
    maxComputeUnits: 40,
    maxCoordinationWires: 12,
    maxLatencyMs: 3000,
  },
  tieBreak: 'attainment-then-compute-then-id-v1',
} as const;

export const fixtureBudgets = {
  maxAgents: 4,
  maxComputeUnits: 40,
  maxCoordinationWires: 12,
  maxLatencyMs: 3000,
  maxEnumeratedCandidates: 64,
  retainLimitK: 2,
} as const;

export const fixtureTenant = tenant;
export const fixtureSeed = seed;
export const fixtureCompilerVersion = compiler;

// ---------------------------------------------------------------------------
// Blueprint fixture (all seven axes, coherent)
// ---------------------------------------------------------------------------

export const fixtureBlueprint = {
  tenantId: tenant,
  projectId: 'project/atlas/regime-alpha',
  agentCount: 2,
  specializations: [
    {
      capabilityKey: 'mathematical-reasoning',
      benchmarkRefs: ['bench/olympiad-mix-v3'],
      gapId: 'gap.regime-alpha.math-reasoning',
    },
    {
      capabilityKey: 'regime-analysis',
      benchmarkRefs: [],
    },
  ],
  assignments: [
    {
      slotId: 'slot-1',
      subject: { kind: 'body-version', bodyVersionRef: 'math-researcher@1.0.0' },
      capabilityRecordRefs: ['capreg-body-mathresearcher-0001'],
      riskPolicyRefs: ['policy/risk/atlas/researcher-gate'],
    },
    {
      slotId: 'slot-2',
      subject: { kind: 'cognitive-substrate', substrateRef: 'delta-labs/swift-1@2026.02' },
      capabilityRecordRefs: ['capreg-substrate-swift-0001'],
      riskPolicyRefs: [],
    },
  ],
  topology: {
    wires: [
      { topic: 'org.atlas.regime-alpha.coordination', publishers: ['slot-1', 'slot-2'], subscribers: ['slot-1', 'slot-2'] },
    ],
  },
  trainingAllocation: {
    entries: [
      { slotId: 'slot-1', method: 'supervised', computeUnits: 8 },
      { slotId: 'slot-2', method: 'statistical-causal', computeUnits: 4 },
    ],
  },
  decisionCadence: {
    entries: [
      { slotId: 'slot-1', intervalMs: 3_600_000 },
      { slotId: 'slot-2', intervalMs: 900_000 },
    ],
  },
  adversarialPopulation: {
    adversarialRequired: true,
    adversaryRefs: ['adversary/atlas/crowding-v2', 'adversary/atlas/quote-stuffing-v1'],
  },
} as const;
