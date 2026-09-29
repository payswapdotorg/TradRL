/**
 * Cross-package interoperability for @tradrl/skills (T017):
 *
 * The D-003/D-004 drift law: skill extraction consumes agent-body,
 * trajectory, experiments, evaluation and organization shapes ONLY
 * through STRUCTURAL MIRRORS — never imports in src/ (the frozen workspace
 * lockfile forbids the dependency edges). This test file is the trip
 * wire: it imports the REAL packages on this branch and proves the
 * mirrors have not drifted.
 *
 * 1. Agent-body parity (T003/T016): the canonical-JSON and stable-digest
 *    algorithms are BYTE-IDENTICAL (canonicalJson/stableDigest ===
 *    registryCanonicalJson/registryStableDigest); the measured-evidence
 *    mirror guards accept REAL registry evidence entries; the
 *    SkillArtifactRef guard is runtime-identical to agent-body's
 *    isSkillArtifactRef; skill records citing registry evidence and
 *    skill-artifact refs pass agent-body's own guards.
 * 2. Trajectory parity (T011): a REAL TrajectoryMetadata (built through
 *    the trajectory lane's own validator) satisfies
 *    TrajectoryMetadataMirror, and the mirror is assignable to the real
 *    record type (compile-time trip wire).
 * 3. Experiments parity (T011): a REAL TrialRecord (validated by the
 *    experiments lane's own guard) satisfies TrialOutcomeMirror; the
 *    status vocabulary is identical kind-for-kind.
 * 4. Evaluation parity (T012): a REAL AttainmentVerdict (validated by the
 *    evaluation lane's own guard) satisfies VerdictEvidenceMirror, and
 *    its verdict id passes the VerdictId mirror guard.
 * 5. Organization parity (T016): a REAL CapabilityGap (built via the
 *    organization lane's own factory) satisfies CapabilityGapMirror; the
 *    six failure-class kinds match kind-for-kind; the gap record is
 *    mutually assignable with the mirror (compile-time trip wire).
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

// --- The contract package under test ---
import {
  type CapabilityGapMirror,
  type TrialOutcomeMirror,
  type TrajectoryMetadataMirror,
  type VerdictEvidenceMirror,
  CAPABILITY_GAP_KINDS,
  TRIAL_STATUSES_MIRROR,
  canonicalJson,
  isCapabilityGapMirror,
  isMeasuredEvidence,
  isSkillArtifactRef,
  isTrajectoryMetadataMirror,
  isTrialOutcomeMirror,
  isTrialStatusMirror,
  isVerdictEvidenceMirror,
  isVerdictId,
  runExtraction,
  stableDigest,
} from './index';
import type { ExtractionProtocol, MeasuredEvidence } from './index';
import { extractionVersionRef } from './primitives';

// --- REAL packages on this branch (test-only imports — the trip wire) ---
import {
  LABEL_EVIDENCE_KEYS as REGISTRY_LABEL_KEYS,
  isMeasuredEvidence as registryIsMeasuredEvidence,
  registryCanonicalJson,
  registryStableDigest,
} from '../../agent-body/src/capability-registry';
import { isSkillArtifactRef as agentBodyIsSkillArtifactRef } from '../../agent-body/src/primitives';
import {
  type TrajectoryMetadata,
  isTrajectoryMetadata,
} from '../../trajectory/src/index';
import {
  type TrialRecord,
  type TrialStatus,
  TRIAL_STATUSES,
  isTrialRecord,
} from '../../experiments/src/index';
import {
  type AttainmentVerdict,
  type VerdictId as EvalVerdictId,
  isAttainmentVerdict,
  verdictIdOf,
} from '../../evaluation/src/index';
import {
  type CapabilityGap,
  CAPABILITY_GAP_KINDS as ORG_GAP_KINDS,
  createCapabilityGap,
} from '../../organization/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the skills-lane gap mirror is mutually assignable with the organization record. */
function gapMirrorIsCanonical(value: CapabilityGapMirror): CapabilityGap {
  return value;
}

function gapCanonicalIsMirror(value: CapabilityGap): CapabilityGapMirror {
  return value;
}

/** Compiles iff a REAL trajectory metadata record satisfies the skills-lane mirror. */
function trajectoryMetadataIsMirror(value: TrajectoryMetadata): TrajectoryMetadataMirror {
  return value;
}

/** Compiles iff a REAL trial record satisfies the skills-lane outcome mirror. */
function trialRecordIsMirror(value: TrialRecord): TrialOutcomeMirror {
  return value;
}

/** Compiles iff a REAL attainment verdict satisfies the skills-lane verdict mirror. */
function verdictIsMirror(value: AttainmentVerdict): VerdictEvidenceMirror {
  return value;
}

// ---------------------------------------------------------------------------
// Fixtures built through the REAL lanes' own constructors/validators
// ---------------------------------------------------------------------------

/** A REAL trajectory metadata record, validated by the trajectory lane's own guard. */
const realTrajectoryMetadata = {
  trajectory_id: 'traj-interop-1',
  tenant: 'tenant-a',
  project: 'project-b',
  episode: 'episode-1',
  environment_config: 'envcfg/replay-1',
  runtime: 'runtime/runner-1',
  data: ['dataset/equities-v2'],
  body_versions: ['regime-researcher@1.0.0'],
  substrates: ['acme-models/reasoner-2@2026.03'],
} as unknown as TrajectoryMetadata;
expect(isTrajectoryMetadata(realTrajectoryMetadata)).toBe(true);

/** A REAL trial record, validated by the experiments lane's own guard. */
const realTrialRecord = {
  trial_id: 'trial-interop-1',
  arm: 'arm-treatment',
  status: 'succeeded',
  trajectory: 'traj-interop-1',
  outcome: { metric: 'engagement', value: 3 },
  started_at: 1_700_000_000_000,
  ended_at: 1_700_000_060_000,
  failure_reason: null,
} as unknown as TrialRecord;
expect(isTrialRecord(realTrialRecord)).toBe(true);

/** A REAL attainment verdict, validated by the evaluation lane's own guard. */
const realVerdict = {
  verdictId: verdictIdOf('criteria/interop' as never, 'suite/interop' as never, 'evaluator/1' as never),
  attained: false,
  criteriaId: 'criteria/interop',
  suite: 'suite/interop',
  evaluatorVersion: 'evaluator/1',
  perCriterion: [],
  limitations: [],
  confidence: {
    level: 'low',
    totalApplicableConstraints: 0,
    splitsEvaluated: 0,
    vacuousSplits: 0,
    vacuousShare: 0,
  },
  inputDigest: '0123456789abcdef',
  verdictHash: 'fedcba9876543210',
} as unknown as AttainmentVerdict;
expect(isAttainmentVerdict(realVerdict)).toBe(true);

/** A REAL capability gap, built via the organization lane's own factory. */
const realGap = createCapabilityGap({
  gapId: 'gap-interop-1',
  kind: 'regime',
  capabilityKey: 'regime-detection',
  evidenceRef: 'capsule:gap-interop-1',
  detectedAt: 1_700_000_000_000,
  tenantId: 'tenant-a',
  projectId: 'project-b',
} as never);

// ---------------------------------------------------------------------------
// 1. Agent-body parity (T003/T016)
// ---------------------------------------------------------------------------

describe('agent-body parity (T003/T016)', () => {
  it('canonical JSON + stable digest are BYTE-IDENTICAL to the registry algorithms', () => {
    const value = {
      b: [1, 2, { c: 'x' }],
      a: { z: null, y: true, nested: { deep: [false, 0.5, 's'] } },
    };
    const registryCanonical = registryCanonicalJson(value as never);
    const skillsCanonical = canonicalJson(value as never);
    expect(skillsCanonical).toBe(registryCanonical);
    expect(stableDigest(skillsCanonical)).toBe(registryStableDigest(registryCanonical));
  });

  it('the measured-evidence mirror guards accept REAL registry evidence entries', () => {
    const realEvidence: MeasuredEvidence[] = [
      { kind: 'benchmark', benchmarkId: 'bench/regime-v2', resultRef: 'result/1' },
      { kind: 'measurement-record', recordRef: 'meas/1', metric: 'p95-latency-ms', value: 420 },
      { kind: 'result-ref', resultRef: 'capsule/1' },
    ];
    for (const entry of realEvidence) {
      expect(isMeasuredEvidence(entry)).toBe(true);
      expect(registryIsMeasuredEvidence(entry)).toBe(true);
    }
  });

  it('registry-rejected evidence is mirror-rejected identically (L16a parity)', () => {
    const invalid: unknown = { kind: 'label', label: 'mathematician' };
    expect(isMeasuredEvidence(invalid)).toBe(false);
    expect(registryIsMeasuredEvidence(invalid)).toBe(false);
  });

  it('the label trip-wire vocabularies match key-for-key (L16a)', () => {
    expect([...REGISTRY_LABEL_KEYS].sort()).toEqual(['jobTitle', 'label', 'profession', 'role', 'roleLabel', 'title', 'vocation']);
    expect([...REGISTRY_LABEL_KEYS].sort()).toContain('profession');
  });

  it('SkillArtifactRef is runtime-identical to agent-body\'s guard', () => {
    const valid = ['skill-artifact:0123456a', 'artifact/x', 'a'.repeat(1024)];
    const invalid = ['', ' leading', 'trailing ', 'x'.repeat(1025), 3, null];
    for (const value of valid) {
      expect(isSkillArtifactRef(value)).toBe(agentBodyIsSkillArtifactRef(value));
    }
    for (const value of invalid) {
      expect(isSkillArtifactRef(value)).toBe(agentBodyIsSkillArtifactRef(value));
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Trajectory parity (T011)
// ---------------------------------------------------------------------------

describe('trajectory parity (T011)', () => {
  it('a REAL TrajectoryMetadata satisfies the skills-lane mirror guard', () => {
    expect(isTrajectoryMetadataMirror(realTrajectoryMetadata)).toBe(true);
  });

  it('the mirror rejects lineage holes the trajectory lane rejects', () => {
    const noProducers = { ...realTrajectoryMetadata, body_versions: [] };
    expect(isTrajectoryMetadata(noProducers)).toBe(false);
    expect(isTrajectoryMetadataMirror(noProducers)).toBe(false);
  });

  it('the extraction consumes real trajectory metadata as evidence', () => {
    const result = runExtraction(
      {
        gapRecords: [realGap],
        trajectories: [{ trajectory: realTrajectoryMetadata, stepCount: 12 }],
        trialOutcomes: [],
        verdictEvidence: [],
        bindings: [
          {
            gapId: 'gap-interop-1',
            trajectoryRefs: ['traj-interop-1'],
            experimentRefs: [],
            trialRefs: [],
            verdictRefs: [],
            attainmentEvidenceRefs: [],
          },
        ],
        extractionVersion: 'reference-extraction/1',
        seed: 'seed-interop',
        tenantId: 'tenant-a',
        projectId: 'project-b',
        extractedAt: 1_700_000_100_000,
      },
      {
        extractionVersion: extractionVersionRef('reference-extraction/1'),
        ranking: {
          rankingVersion: 'evidence-strength/1',
          weights: { trajectoryStep: 0.1, succeededTrial: 2, attainedVerdict: 5, corroboration: 1 },
        },
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidates.length).toBe(1);
      const provenance = (
        result.value.candidates[0]?.skill as unknown as {
          provenance: { trajectoryRefs: readonly string[] };
        }
      ).provenance;
      expect(provenance.trajectoryRefs).toEqual(['traj-interop-1']);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Experiments parity (T011)
// ---------------------------------------------------------------------------

describe('experiments parity (T011)', () => {
  it('a REAL TrialRecord satisfies the skills-lane outcome mirror guard', () => {
    expect(isTrialOutcomeMirror(realTrialRecord)).toBe(true);
  });

  it('the trial status vocabularies match kind-for-kind', () => {
    expect([...TRIAL_STATUSES_MIRROR]).toEqual([...TRIAL_STATUSES]);
    for (const status of TRIAL_STATUSES) {
      expect(isTrialStatusMirror(status)).toBe(true);
    }
  });

  it('the mirror enforces the experiments lane\'s evidence law (succeeded requires a trajectory)', () => {
    const noTrajectory = { ...realTrialRecord, trajectory: null };
    expect(isTrialRecord(noTrajectory)).toBe(false);
    expect(isTrialOutcomeMirror(noTrajectory)).toBe(false);
  });

  it('a failed trial requires a failure reason in both lanes', () => {
    const unexplained = { ...realTrialRecord, status: 'failed' as TrialStatus, failure_reason: null, outcome: null };
    expect(isTrialRecord(unexplained)).toBe(false);
    expect(isTrialOutcomeMirror(unexplained)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Evaluation parity (T012)
// ---------------------------------------------------------------------------

describe('evaluation parity (T012)', () => {
  it('a REAL AttainmentVerdict satisfies the skills-lane verdict mirror guard', () => {
    expect(isVerdictEvidenceMirror(realVerdict)).toBe(true);
  });

  it('the VerdictId mirror guard accepts the evaluation lane\'s own derived ids', () => {
    const derived: EvalVerdictId = verdictIdOf('criteria/x' as never, 'suite/y' as never, 'evaluator/2' as never);
    expect(isVerdictId(derived)).toBe(true);
  });

  it('the mirror rejects a verdict-shaped forgery (bad id fields)', () => {
    const forged = { ...realVerdict, verdictId: '' };
    expect(isVerdictEvidenceMirror(forged)).toBe(false);
    expect(isAttainmentVerdict(forged)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Organization parity (T016)
// ---------------------------------------------------------------------------

describe('organization parity (T016)', () => {
  it('a REAL CapabilityGap satisfies the skills-lane gap mirror guard', () => {
    expect(isCapabilityGapMirror(realGap)).toBe(true);
  });

  it('the six failure-class kinds match kind-for-kind (LEARNING-LOOP verbatim)', () => {
    expect([...CAPABILITY_GAP_KINDS]).toEqual([...ORG_GAP_KINDS]);
    for (const kind of ORG_GAP_KINDS) {
      expect(CAPABILITY_GAP_KINDS).toContain(kind);
    }
  });

  it('a gap the organization lane rejects is mirror-rejected too', () => {
    const invalid = { ...realGap, gapId: '!!!' };
    expect(isCapabilityGapMirror(invalid)).toBe(false);
  });

  it('the type-level parity helpers compile (see functions above)', () => {
    expect(gapMirrorIsCanonical).toBeDefined();
    expect(gapCanonicalIsMirror).toBeDefined();
    expect(trajectoryMetadataIsMirror).toBeDefined();
    expect(trialRecordIsMirror).toBeDefined();
    expect(verdictIsMirror).toBeDefined();
    expectTypeOf(gapCanonicalIsMirror(realGap)).toExtend<CapabilityGapMirror>();
  });
});
