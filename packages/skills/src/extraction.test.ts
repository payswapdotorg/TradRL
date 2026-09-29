/**
 * @tradrl/skills — ExtractionProtocol tests.
 *
 * Behavioral, law-driven:
 * - THE EVIDENCE LAW: extraction only emits evidence-backed candidates —
 *   gaps with no binding are SKIPPED and the skip is RETAINED (never
 *   hidden); candidates cite their provenance and measured evidence.
 * - The ranking function is DECLARED and versioned: strength ordering is
 *   deterministic (strength DESC, capabilityKey ASC tie-break).
 * - Determinism: same (input, protocol) -> byte-identical output, twice
 *   (deep-equal + digest equality).
 * - Failure-driven input: an empty gap list is invalid.
 * - L12 scope coherence (tenant_mismatch), the seed law
 *   (unseeded_forge), version coherence, duplicate detection.
 */

import { describe, expect, it } from 'vitest';

import {
  type CapabilityGapMirror,
  type ExtractionInput,
  type ExtractionProtocol,
  type ExtractionOutput,
  type GapEvidenceBinding,
  type TrialOutcomeMirror,
  type VerdictEvidenceMirror,
  deriveSkillArtifactRef,
  deriveSkillRecordId,
  evidenceStrengthOf,
  isExtractionRankingWeights,
  isExtractionRankingFunction,
  runExtraction,
  validateExtractionInput,
} from './extraction';
import { extractionVersionRef } from './primitives';
import { isSkillRecord } from './record';

const EXTRACTION_VERSION = extractionVersionRef('reference-extraction/1');

const PROTOCOL: ExtractionProtocol = {
  extractionVersion: EXTRACTION_VERSION,
  ranking: {
    rankingVersion: 'evidence-strength/1',
    weights: {
      trajectoryStep: 0.1,
      succeededTrial: 2,
      attainedVerdict: 5,
      corroboration: 1,
    },
  },
};

function gap(id: string, capabilityKey: string, kind: string): CapabilityGapMirror {
  return {
    gapId: id,
    kind,
    capabilityKey,
    evidenceRef: `capsule:${id}`,
    detectedAt: 1_700_000_000_000,
    tenantId: 'tenant-a',
    projectId: 'project-b',
  } as unknown as CapabilityGapMirror;
}

function trajectory(id: string, steps: number): { trajectory: Record<string, unknown>; stepCount: number } {
  return {
    trajectory: {
      trajectory_id: id,
      tenant: 'tenant-a',
      project: 'project-b',
      body_versions: ['regime-researcher@1.0.0'],
      substrates: ['acme-models/reasoner-2@2026.03'],
    },
    stepCount: steps,
  };
}

function succeededTrial(id: string): TrialOutcomeMirror {
  return {
    trial_id: id,
    arm: 'arm-treatment',
    status: 'succeeded',
    trajectory: 'traj-1',
    failure_reason: null,
  } as unknown as TrialOutcomeMirror;
}

function verdict(id: string, attained: boolean): VerdictEvidenceMirror {
  return {
    verdictId: id,
    attained,
    criteriaId: 'criteria/1',
    suite: 'suite/1',
    evaluatorVersion: 'evaluator/1',
  } as unknown as VerdictEvidenceMirror;
}

function binding(gapId: string, partial: Record<string, unknown>): GapEvidenceBinding {
  return {
    gapId,
    trajectoryRefs: [],
    experimentRefs: [],
    trialRefs: [],
    verdictRefs: [],
    attainmentEvidenceRefs: [],
    ...partial,
  } as unknown as GapEvidenceBinding;
}

function input(partial: Record<string, unknown>): ExtractionInput {
  return {
    gapRecords: [gap('gap-1', 'regime-detection', 'regime')],
    trajectories: [trajectory('traj-1', 40)],
    trialOutcomes: [succeededTrial('trial-1')],
    verdictEvidence: [verdict('v-1', true)],
    bindings: [
      binding('gap-1', {
        trajectoryRefs: ['traj-1'],
        experimentRefs: ['exp-1'],
        trialRefs: ['trial-1'],
        verdictRefs: ['v-1'],
      }),
    ],
    extractionVersion: 'reference-extraction/1',
    seed: 'seed-1',
    tenantId: 'tenant-a',
    projectId: 'project-b',
    extractedAt: 1_700_000_100_000,
    ...partial,
  } as unknown as ExtractionInput;
}

describe('the ranking function record', () => {
  it('accepts declared non-negative weights only', () => {
    expect(isExtractionRankingWeights(PROTOCOL.ranking.weights)).toBe(true);
    expect(
      isExtractionRankingWeights({ trajectoryStep: -1, succeededTrial: 1, attainedVerdict: 1, corroboration: 1 }),
    ).toBe(false);
    expect(
      isExtractionRankingWeights({ trajectoryStep: Number.NaN, succeededTrial: 1, attainedVerdict: 1, corroboration: 1 }),
    ).toBe(false);
  });

  it('the protocol record is guarded', () => {
    expect(isExtractionRankingFunction(PROTOCOL.ranking)).toBe(true);
    expect(isExtractionRankingFunction({ rankingVersion: '', weights: PROTOCOL.ranking.weights })).toBe(false);
  });

  it('evidenceStrengthOf is the declared weighted sum', () => {
    // 40 steps * 0.1 + 1 succeeded trial * 2 + 1 attained verdict * 5 + 4 categories * 1 = 15
    const strength = evidenceStrengthOf(
      binding('gap-1', {
        trajectoryRefs: ['traj-1'],
        experimentRefs: ['exp-1'],
        trialRefs: ['trial-1'],
        verdictRefs: ['v-1'],
      }),
      [trajectory('traj-1', 40)] as unknown as Parameters<typeof evidenceStrengthOf>[1],
      [succeededTrial('trial-1')] as unknown as Parameters<typeof evidenceStrengthOf>[2],
      [verdict('v-1', true)] as unknown as Parameters<typeof evidenceStrengthOf>[3],
      PROTOCOL.ranking,
    );
    expect(strength).toBeCloseTo(15, 9);
  });
});

describe('runExtraction (happy path)', () => {
  it('emits evidence-backed candidates with full provenance and lineage', () => {
    const result = runExtraction(input({}), PROTOCOL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.value;
    expect(output.candidates.length).toBe(1);
    const candidate = output.candidates[0] as { skill: Parameters<typeof isSkillRecord>[0] };
    expect(isSkillRecord(candidate.skill)).toBe(true);
    const skill = candidate.skill as {
      provenance: { trajectoryRefs: readonly string[]; trialRefs: readonly string[]; experimentRefs: readonly string[] };
      lineage: { gapRefs: readonly string[]; seed: string; tenantId: string };
      descriptor: { measuredEvidence: readonly { kind: string; resultRef: string }[] };
    };
    expect(skill.provenance.trajectoryRefs).toEqual(['traj-1']);
    expect(skill.provenance.trialRefs).toEqual(['trial-1']);
    expect(skill.provenance.experimentRefs).toEqual(['exp-1']);
    expect(skill.lineage.gapRefs).toEqual(['gap-1']);
    expect(skill.lineage.seed).toBe('seed-1');
    expect(skill.lineage.tenantId).toBe('tenant-a');
    expect(skill.descriptor.measuredEvidence.length).toBe(3); // trajectory + trial + verdict result-refs
  });

  it('ranks candidates by declared strength DESC with capabilityKey tie-break', () => {
    const twoGaps = input({
      gapRecords: [
        gap('gap-1', 'regime-detection', 'regime'),
        gap('gap-2', 'liquidity-impact-estimation', 'liquidity'),
      ],
      bindings: [
        binding('gap-1', { trajectoryRefs: ['traj-1'], experimentRefs: ['exp-1'], trialRefs: ['trial-1'], verdictRefs: ['v-1'] }),
        // gap-2 bound to weaker evidence: one attainment ref only
        binding('gap-2', { attainmentEvidenceRefs: ['capsule:gap-2'] }),
      ],
    });
    const result = runExtraction(twoGaps, PROTOCOL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [first, second] = result.value.candidates;
    expect(first?.rank).toBe(1);
    expect(second?.rank).toBe(2);
    expect((first?.evidenceStrength as number) > (second?.evidenceStrength as number)).toBe(true);
    expect((first?.skill as { descriptor: { capabilityKey: string } }).descriptor.capabilityKey).toBe('regime-detection');
  });

  it('gaps with NO binding are skipped and the skip is RETAINED (never hidden)', () => {
    const result = runExtraction(
      input({
        gapRecords: [gap('gap-1', 'regime-detection', 'regime'), gap('gap-2', 'sentiment-analysis', 'sentiment-event')],
        bindings: [binding('gap-1', { trajectoryRefs: ['traj-1'] })],
      }),
      PROTOCOL,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates.length).toBe(1);
    expect(result.value.skippedGapIds).toEqual(['gap-2']);
  });

  it('derived identities are pure functions of (version, seed, gap)', () => {
    expect(deriveSkillRecordId(EXTRACTION_VERSION, 'seed-1', 'gap-1' as never)).toBe(
      deriveSkillRecordId(EXTRACTION_VERSION, 'seed-1', 'gap-1' as never),
    );
    expect(deriveSkillRecordId(EXTRACTION_VERSION, 'seed-1', 'gap-1' as never)).not.toBe(
      deriveSkillRecordId(EXTRACTION_VERSION, 'seed-1', 'gap-2' as never),
    );
    expect(deriveSkillArtifactRef(EXTRACTION_VERSION, 'seed-1', 'gap-1' as never)).not.toBe(
      deriveSkillRecordId(EXTRACTION_VERSION, 'seed-1', 'gap-1' as never),
    );
  });
});

describe('DETERMINISM (the determinism law)', () => {
  it('same (input, protocol) -> byte-identical output, twice', () => {
    const fixture = input({});
    const a = runExtraction(fixture, PROTOCOL);
    const b = runExtraction(JSON.parse(JSON.stringify(fixture)), PROTOCOL);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const outA: ExtractionOutput = a.value;
    const outB: ExtractionOutput = b.value;
    expect(outA).toEqual(outB); // deep-equal
    expect(JSON.stringify(outA)).toBe(JSON.stringify(outB)); // byte-identical
    expect(outA.inputDigest).toBe(outB.inputDigest);
    expect(outA.outputDigest).toBe(outB.outputDigest);
  });

  it('any input mutation changes the input digest', () => {
    const base = input({});
    const mutated = input({ extractedAt: 1_700_000_200_000 });
    const a = runExtraction(base, PROTOCOL);
    const b = runExtraction(mutated, PROTOCOL);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.inputDigest).not.toBe(b.value.inputDigest);
  });

  it('a different ranking function changes the strengths (the ranking is declared, not hidden)', () => {
    const otherProtocol: ExtractionProtocol = {
      extractionVersion: EXTRACTION_VERSION,
      ranking: {
        rankingVersion: 'evidence-strength/2',
        weights: { trajectoryStep: 10, succeededTrial: 0, attainedVerdict: 0, corroboration: 0 },
      },
    };
    const a = runExtraction(input({}), PROTOCOL);
    const b = runExtraction(input({}), otherProtocol);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const strengthA = a.value.candidates[0]?.evidenceStrength as number;
    const strengthB = b.value.candidates[0]?.evidenceStrength as number;
    expect(strengthA).not.toBe(strengthB);
  });
});

describe('typed input validation (negative paths)', () => {
  it('an empty gap list is invalid — extraction is failure-driven', () => {
    const result = validateExtractionInput(input({ gapRecords: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('failure-driven'))).toBe(true);
    }
  });

  it('a binding that cites no evidence is invalid (evidence_missing)', () => {
    const result = validateExtractionInput(input({ bindings: [binding('gap-1', {})] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'evidence_missing')).toBe(true);
    }
  });

  it('a gap-scope disagreement fails with tenant_mismatch (L12)', () => {
    const foreign = input({
      gapRecords: [
        {
          gapId: 'gap-9',
          kind: 'regime',
          capabilityKey: 'regime-detection',
          evidenceRef: 'capsule:gap-9',
          detectedAt: 1_700_000_000_000,
          tenantId: 'tenant-OTHER',
          projectId: 'project-b',
        },
      ],
      bindings: [binding('gap-9', { trajectoryRefs: ['traj-1'] })],
    });
    const mismatch = validateExtractionInput(foreign);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.errors[0]?.code).toBe('tenant_mismatch');
    }
  });

  it('a missing seed fails with unseeded_forge', () => {
    const draft = input({}) as unknown as Record<string, unknown>;
    draft.seed = '';
    const result = validateExtractionInput(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'unseeded_forge')).toBe(true);
    }
  });

  it('a version disagreement between input and protocol is a lineage error', () => {
    const result = runExtraction(input({ extractionVersion: 'reference-extraction/OTHER' }), PROTOCOL);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message.includes('lineage coherence')).toBe(true);
    }
  });

  it('duplicate gap ids and duplicate bindings are typed errors', () => {
    const duplicates = input({
      gapRecords: [gap('gap-1', 'regime-detection', 'regime'), gap('gap-1', 'liquidity-estimation', 'liquidity')],
    });
    const result = validateExtractionInput(duplicates);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'duplicate_record')).toBe(true);
    }
    const doubleBinding = input({
      bindings: [binding('gap-1', { trajectoryRefs: ['traj-1'] }), binding('gap-1', { trialRefs: ['trial-1'] })],
    });
    const bindingResult = validateExtractionInput(doubleBinding);
    expect(bindingResult.ok).toBe(false);
    if (!bindingResult.ok) {
      expect(bindingResult.errors.some((e) => e.code === 'duplicate_record')).toBe(true);
    }
  });

  it('a binding for an unknown gap is invalid', () => {
    const result = validateExtractionInput(input({ bindings: [binding('gap-404', { trialRefs: ['trial-1'] })] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('does not exist'))).toBe(true);
    }
  });

  it('trial status invariants are mirrored (succeeded requires a trajectory)', () => {
    const result = validateExtractionInput(
      input({
        trialOutcomes: [
          { trial_id: 'trial-x', arm: 'arm', status: 'succeeded', trajectory: null, failure_reason: null },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });
});
