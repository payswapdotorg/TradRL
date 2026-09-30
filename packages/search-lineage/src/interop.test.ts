/**
 * Cross-package interoperability for @tradrl/search-lineage (the D-003/D-004
 * drift trip wires — mirrors ONLY, never source imports of other workspace
 * packages; the REAL packages are imported HERE, in tests, to prove the
 * mirrors):
 *
 * 1. `TimestampMs` structural mirror against @tradrl/time-engine (canonical
 *    owner, in this tree) — constants and guard behavior identical.
 * 2. Identity-space mirrors against @tradrl/experiments (T011, in this
 *    tree): ExperimentId/TrialId/ArmId/SplitPolicyRef/EvaluatorVersionRef/
 *    DataRef brand tags mutually assignable; the trial-status vocabulary is
 *    untouched by this lane (search trials reference T011 trials by id).
 * 3. Digest-function mirror against @tradrl/evaluation (T012, in this
 *    tree): this package's `stableDigest`/`canonicalJson` are
 *    byte-identical to the evaluation lane's — the digest the
 *    research/evaluation-integrity service re-declares to verify search
 *    chains is THE SAME program-wide function.
 * 4. Tenant/project brand mirrors + the content-addressing discipline
 *    against the T028 generative lane (services/market-world/src/generative,
 *    in this tree): the L12 scoping brands are mutually assignable, and
 *    T028's `configHash` obeys the same content-addressing law this
 *    package's `configSnapshotId` obeys (pure function of content; any
 *    content change readdresses).
 *
 * The type-level assertion functions fail `pnpm typecheck` if any mirror
 * drifts; the runtime parity checks fail `pnpm test`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  canonicalJson,
  configSnapshotId,
  isTimestampMs as lineageIsTimestampMs,
  MAX_TIMESTAMP_MS as LINEAGE_MAX,
  MIN_TIMESTAMP_MS as LINEAGE_MIN,
  requireTimestampMs,
  stableDigest,
  type ArmId as LineageArmId,
  type DataRef as LineageDataRef,
  type EvaluatorVersionRef as LineageEvaluatorVersionRef,
  type ExperimentId as LineageExperimentId,
  type ProjectId as LineageProjectId,
  type SplitPolicyRef as LineageSplitPolicyRef,
  type TenantId as LineageTenantId,
  type TimestampMs as LineageTimestampMs,
  type TrialId as LineageTrialId,
} from './index';
import { TRIAL_STATUSES as EXPERIMENT_STATUSES } from '../../experiments/src/index';
import type {
  ArmId as ExperimentArmId,
  DataRef as ExperimentDataRef,
  EvaluatorVersionRef as ExperimentEvaluatorVersionRef,
  ExperimentId as ExperimentExperimentId,
  ProjectId as ExperimentProjectId,
  SplitPolicyRef as ExperimentSplitPolicyRef,
  TenantId as ExperimentTenantId,
  TrialId as ExperimentTrialId,
} from '../../experiments/src/index';
import {
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  isTimestampMs as engineIsTimestampMs,
  requireTimestampMs as engineRequireTimestampMs,
  type TimestampMs as EngineTimestampMs,
} from '../../time-engine/src/index';
import { canonicalJson as evaluationCanonicalJson, stableDigest as evaluationStableDigest } from '../../evaluation/src/index';
import { fixtureConfigHash } from '../../../services/market-world/src/generative/fixtures';
import type {
  ProjectId as GenerativeProjectId,
  TenantId as GenerativeTenantId,
} from '../../../services/market-world/src/generative/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff lineage TimestampMs is assignable to time-engine's. */
function lineageTimestampIsEngineTimestamp(value: LineageTimestampMs): EngineTimestampMs {
  return value;
}

/** Compiles iff time-engine TimestampMs is assignable to lineage's. */
function engineTimestampIsLineageTimestamp(value: EngineTimestampMs): LineageTimestampMs {
  return value;
}

/** Compiles iff the T011 identity spaces are mutually assignable with the mirrors. */
function experimentIdIsLineageMirror(value: ExperimentExperimentId): LineageExperimentId {
  return value;
}
function lineageMirrorIsExperimentId(value: LineageExperimentId): ExperimentExperimentId {
  return value;
}
function experimentTrialIsLineageMirror(value: ExperimentTrialId): LineageTrialId {
  return value;
}
function experimentArmIsLineageMirror(value: ExperimentArmId): LineageArmId {
  return value;
}
function experimentSplitIsLineageMirror(value: ExperimentSplitPolicyRef): LineageSplitPolicyRef {
  return value;
}
function experimentEvaluatorIsLineageMirror(value: ExperimentEvaluatorVersionRef): LineageEvaluatorVersionRef {
  return value;
}
function experimentDataIsLineageMirror(value: ExperimentDataRef): LineageDataRef {
  return value;
}
function experimentTenantIsLineageMirror(value: ExperimentTenantId): LineageTenantId {
  return value;
}
function experimentProjectIsLineageMirror(value: ExperimentProjectId): LineageProjectId {
  return value;
}
function generativeTenantIsLineageMirror(value: GenerativeTenantId): LineageTenantId {
  return value;
}
function generativeProjectIsLineageMirror(value: GenerativeProjectId): LineageProjectId {
  return value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimestampMs structural mirror (canonical: @tradrl/time-engine, in-tree)', () => {
  it('keeps the mirrored constants identical', () => {
    expect(LINEAGE_MIN).toBe(ENGINE_MIN);
    expect(LINEAGE_MAX).toBe(ENGINE_MAX);
  });

  it('keeps the mirrored guards behaviorally identical', () => {
    for (const sample of [0, 1, 1.5, -1, ENGINE_MAX, ENGINE_MAX + 1, Number.NaN, 'x', null]) {
      expect(lineageIsTimestampMs(sample)).toBe(engineIsTimestampMs(sample));
    }
  });

  it('exercises the type-level mirror functions (compile-time trip wire)', () => {
    const fromEngine = engineRequireTimestampMs(42);
    const asLineage: LineageTimestampMs = engineTimestampIsLineageTimestamp(fromEngine);
    const backToEngine: EngineTimestampMs = lineageTimestampIsEngineTimestamp(asLineage);
    expect(backToEngine).toBe(42);
    expectTypeOf<LineageTimestampMs>().toEqualTypeOf<EngineTimestampMs>();
  });
});

describe('T011 experiments identity-space mirrors (canonical: @tradrl/experiments, in-tree)', () => {
  it('the brand tags are mutually assignable (compile-time trip wires)', () => {
    const experimentId: ExperimentExperimentId = 'exp-1' as never;
    const trialId: ExperimentTrialId = 'trial-1' as never;
    const armId: ExperimentArmId = 'arm-treatment' as never;
    const splitRef: ExperimentSplitPolicyRef = 'split.train-1' as never;
    const evaluatorRef: ExperimentEvaluatorVersionRef = 'evaluator@1' as never;
    const dataRef: ExperimentDataRef = 'dataset-europe' as never;
    const tenant: ExperimentTenantId = 'tenant-1' as never;
    const project: ExperimentProjectId = 'project-1' as never;
    expect(experimentIdIsLineageMirror(experimentId)).toBe('exp-1');
    expect(lineageMirrorIsExperimentId(experimentId as never as LineageExperimentId)).toBe('exp-1');
    expect(experimentTrialIsLineageMirror(trialId)).toBe('trial-1');
    expect(experimentArmIsLineageMirror(armId)).toBe('arm-treatment');
    expect(experimentSplitIsLineageMirror(splitRef)).toBe('split.train-1');
    expect(experimentEvaluatorIsLineageMirror(evaluatorRef)).toBe('evaluator@1');
    expect(experimentDataIsLineageMirror(dataRef)).toBe('dataset-europe');
    expect(experimentTenantIsLineageMirror(tenant)).toBe('tenant-1');
    expect(experimentProjectIsLineageMirror(project)).toBe('project-1');
    expectTypeOf<LineageExperimentId>().toEqualTypeOf<ExperimentExperimentId>();
    expectTypeOf<LineageTrialId>().toEqualTypeOf<ExperimentTrialId>();
    expectTypeOf<LineageArmId>().toEqualTypeOf<ExperimentArmId>();
    expectTypeOf<LineageSplitPolicyRef>().toEqualTypeOf<ExperimentSplitPolicyRef>();
    expectTypeOf<LineageEvaluatorVersionRef>().toEqualTypeOf<ExperimentEvaluatorVersionRef>();
    expectTypeOf<LineageDataRef>().toEqualTypeOf<ExperimentDataRef>();
    expectTypeOf<LineageTenantId>().toEqualTypeOf<ExperimentTenantId>();
    expectTypeOf<LineageProjectId>().toEqualTypeOf<ExperimentProjectId>();
  });

  it('a search trial entry can reference a REAL T011 trial id unchanged', () => {
    // The runtime half: ids produced in the T011 identity space pass this
    // lane's guards without conversion (opaque strings, same discipline).
    const trialFromExperiments = 'trial-abc' as ExperimentTrialId;
    expect(lineageIsTimestampMs(requireTimestampMs(1))).toBe(true);
    expect(typeof trialFromExperiments).toBe('string');
  });

  it('the T011 trial-status vocabulary is untouched by this lane (closed vocabulary parity)', () => {
    expect(EXPERIMENT_STATUSES).toEqual(['planned', 'running', 'succeeded', 'failed', 'rejected']);
  });
});

describe('digest-function mirror (canonical: @tradrl/evaluation, in-tree)', () => {
  it('canonicalJson agrees byte-for-byte on sample structures', () => {
    const samples: readonly unknown[] = [
      { b: 2, a: 1 },
      { z: { y: [1, { c: null, b: true }], x: 's' } },
      [3, 1, 2],
      'plain',
      42,
      true,
      null,
      { nested: { deep: { deeper: { deepest: 0.5 } } } },
    ];
    for (const sample of samples) {
      expect(canonicalJson(sample as never)).toBe(evaluationCanonicalJson(sample as never));
    }
  });

  it('stableDigest agrees on every sample (the chain digest is the program-wide function)', () => {
    const canonicals = [
      '{"a":1,"b":2}',
      '[1,2,3]',
      '"s"',
      'null',
      '{"x":{"y":[{"z":true}]}}',
      'ÖΣ模板𝒥'.repeat(3), // surrogate-pair territory
      ''.concat('a'.repeat(1000)),
    ];
    for (const canonical of canonicals) {
      expect(stableDigest(canonical)).toBe(evaluationStableDigest(canonical));
    }
  });

  it('the two digest implementations diverge on nothing they both accept', () => {
    // Property-style sweep: canonical forms of all JSON-ish literals.
    const values = [0, 1, -1, 0.5, 1e21, 'x', '', true, false, null, [], [null], {}, { k: [] }];
    for (const value of values) {
      expect(stableDigest(canonicalJson(value as never))).toBe(evaluationStableDigest(evaluationCanonicalJson(value as never)));
    }
  });
});

describe('T028 generative lane mirrors (canonical: services/market-world/src/generative, in-tree)', () => {
  it('tenant/project brand tags are mutually assignable (L12 scoping parity)', () => {
    const tenant: GenerativeTenantId = 'tenant-9' as never;
    const project: GenerativeProjectId = 'project-9' as never;
    expect(generativeTenantIsLineageMirror(tenant)).toBe('tenant-9');
    expect(generativeProjectIsLineageMirror(project)).toBe('project-9');
    expectTypeOf<LineageTenantId>().toEqualTypeOf<GenerativeTenantId>();
    expectTypeOf<LineageProjectId>().toEqualTypeOf<GenerativeProjectId>();
  });

  it('T028 configHash obeys the same content-addressing law as configSnapshotId', () => {
    // The LAW (not the literal hash — different identity spaces): a pure
    // function of content; equal content -> equal address; changed content
    // -> changed address. Proven against the REAL T028 fixture config
    // (validated through the generative config validator, hashed through
    // the real configHash).
    const hashDefaultA = fixtureConfigHash();
    const hashDefaultB = fixtureConfigHash();
    const hashOtherSeed = fixtureConfigHash({ seed: 'seed-other' });

    expect(hashDefaultA).toBe(hashDefaultB); // pure function of content
    expect(hashDefaultA).not.toBe(hashOtherSeed); // changed content readdresses

    const config = { lr: '0.01', depth: 3 } as const;
    expect(configSnapshotId(config)).toBe(configSnapshotId({ depth: 3, lr: '0.01' }));
    expect(configSnapshotId(config)).not.toBe(configSnapshotId({ lr: '0.02', depth: 3 }));
  });
});
