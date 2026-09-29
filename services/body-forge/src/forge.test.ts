/**
 * @tradrl/body-forge — the reference forge tests.
 *
 * Behavioral, law-driven:
 * - DETERMINISM: same (parent, deltas, gaps, evidence, seed, forge
 *   version, target, createdAt) -> byte-identical forged candidate
 *   (deep-equal, twice; the golden fixture).
 * - THE COMPATIBILITY GATE: a candidate whose substrate-compatibility
 *   refs fail the agent-body mirror shapes is NOT minted
 *   (`compatibility_fail`, typed error).
 * - THE BREAKING-CHANGE LAW: a delta removing a capability without the
 *   declared-breaking-change record is refused (`undeclared_breaking_change`).
 * - L3 (the existential law): the parent is NEVER mutated (deep-frozen,
 *   deep-equal after forging); the mint is always a NEW object; a delta
 *   set that would empty the composition is refused.
 * - Lineage monotonicity; L12 scope coherence; the seed law.
 */

import { describe, expect, it } from 'vitest';

import { deepCloneJson, isDeeplyFrozen } from '../../../packages/skills/src/index';
import {
  type BodyVersionMirror,
  type ForgedCandidate,
  compareSemVerMirror,
  forgeBodyVersion,
  isForgedCandidate,
  serializeForgedCandidate,
  validateCompatibilityGate,
  validateForgeInput,
} from './index';
import {
  fixtureDeltas,
  fixtureForgeInput,
  fixtureForgedCandidate,
  fixtureBrokenCompatibilityForgeInput,
  fixtureUndeclaredRemovalForgeInput,
  fixtureParentBodyVersion,
  fixtureGaps,
} from './fixtures';
import { mirrorCanonicalJson } from './mirrors';

describe('the golden forge run (happy path)', () => {
  it('mints the golden candidate: a distinct record kind, uncertified, parent-linked', () => {
    const result = forgeBodyVersion(fixtureForgeInput);
    expect(result.minted).toBe(true);
    expect(result.candidate).not.toBeNull();
    const candidate = result.candidate as ForgedCandidate;
    expect(isForgedCandidate(candidate)).toBe(true);
    expect(candidate.kind).toBe('forged-candidate');
    expect(candidate.candidate.id).toBe('regime-researcher@1.3.0');
    expect(candidate.candidate.parentId).toBe('regime-researcher@1.2.0');
    expect(candidate.candidate.certified).toBe(false);
    expect(candidate.candidate.certificationEvidence).toBeNull();
    // The manifest records EXACTLY what was applied.
    expect(candidate.manifest.appliedDeltaIds).toEqual(['delta-legacy-removal', 'delta-regime-v2']); // canonical order
    expect(candidate.manifest.capabilityAdditions).toEqual(['microstructure-analysis']);
    expect(candidate.manifest.capabilityRefinements).toEqual(['regime-detection']);
    expect(candidate.manifest.capabilityRemovals).toEqual([
      {
        capabilityId: 'legacy-signal-reading',
        rationale: 'Superseded by refined regime detection; the deprecated signal capability is dropped.',
        addressesGapIds: ['gap-regime-1'],
      },
    ]);
    expect(candidate.manifest.procedureAdditions).toEqual(['regime-shift-review']);
    expect(candidate.manifest.procedureRemovals).toEqual(['legacy-signal-scan']);
    expect(candidate.manifest.policyAmendmentCount).toBe(1);
    // The composition applied the patches.
    const composition = candidate.candidate.composition;
    expect(composition.capabilities.map((c) => c.id).sort()).toEqual(['microstructure-analysis', 'regime-detection']);
    expect(composition.capabilities.find((c) => c.id === 'regime-detection')?.skillArtifactRefs).toEqual([
      'skill-artifact:regime-1',
      'skill-artifact:regime-2',
    ]);
    expect(composition.knowledgeToolPolicy.toolCallBudgetPerDecision).toBe(6);
    expect(composition.procedures.map((p) => p.id).sort()).toEqual(['regime-review', 'regime-shift-review']);
    // The L9 lineage block.
    expect(candidate.lineage.parentVersionRef).toBe('regime-researcher@1.2.0');
    expect(candidate.lineage.gapRefs).toEqual(['gap-regime-1', 'gap-liquidity-1']);
    expect(candidate.lineage.evidenceRefs).toEqual(['trajectory:traj-regime-42', 'trial:trial-regime-9', 'verdict:v-regime-1']);
    expect(candidate.lineage.forgeVersion).toBe('reference-forge/1');
    expect(candidate.lineage.seed).toBe('forge-seed-1');
  });

  it('the minted candidate is deeply frozen', () => {
    expect(isDeeplyFrozen(fixtureForgedCandidate)).toBe(true);
  });

  it('the input validation returns the narrowed input on success', () => {
    const result = validateForgeInput(fixtureForgeInput);
    expect(result.ok).toBe(true);
  });
});

describe('DETERMINISM (the determinism law)', () => {
  it('same inputs -> byte-identical forged candidate (deep-equal, twice)', () => {
    const a = forgeBodyVersion(fixtureForgeInput);
    const b = forgeBodyVersion(deepCloneJson(fixtureForgeInput));
    expect(a.minted).toBe(true);
    expect(b.minted).toBe(true);
    expect(a.candidate).toEqual(b.candidate); // deep-equal
    expect(a.candidate).toBe(a.candidate); // stable reference within one result
    expect(serializeForgedCandidate(a.candidate as ForgedCandidate)).toBe(
      serializeForgedCandidate(b.candidate as ForgedCandidate),
    );
  });

  it('the golden fixture is byte-stable across runs', () => {
    const again = forgeBodyVersion(fixtureForgeInput);
    expect(serializeForgedCandidate(again.candidate as ForgedCandidate)).toBe(
      serializeForgedCandidate(fixtureForgedCandidate),
    );
  });

  it('the input array order of deltas cannot leak into the output (canonical application order)', () => {
    const reversed = {
      ...fixtureForgeInput,
      deltas: [...fixtureDeltas].reverse(),
    };
    const a = forgeBodyVersion(fixtureForgeInput);
    const b = forgeBodyVersion(reversed);
    expect(serializeForgedCandidate(a.candidate as ForgedCandidate)).toBe(
      serializeForgedCandidate(b.candidate as ForgedCandidate),
    );
  });

  it('any input mutation changes the input digest', () => {
    const mutated = { ...fixtureForgeInput, seed: 'forge-seed-OTHER' };
    const a = forgeBodyVersion(fixtureForgeInput);
    const b = forgeBodyVersion(mutated);
    expect(a.inputDigest).not.toBe(b.inputDigest);
  });
});

describe('THE COMPATIBILITY GATE (negative path)', () => {
  it('a candidate whose compatibility refs fail the agent-body mirror is NOT minted', () => {
    const result = forgeBodyVersion(fixtureBrokenCompatibilityForgeInput);
    expect(result.minted).toBe(false);
    expect(result.candidate).toBeNull();
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.every((r) => r.code === 'compatibility_fail')).toBe(true);
    expect(result.reasons.some((r) => r.path.includes('minContextWindowTokens'))).toBe(true);
    expect(result.reasons.some((r) => r.path.includes('substrate'))).toBe(true);
  });

  it('the gate validates the manifest shapes (requirements/constraints/records)', () => {
    const good = validateCompatibilityGate(fixtureParentBodyVersion.composition.substrateCompatibility);
    expect(good.ok).toBe(true);
    const bad = validateCompatibilityGate({ requirements: { minContextWindowTokens: 'x' } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors[0]?.code).toBe('compatibility_fail');
    }
  });
});

describe('THE BREAKING-CHANGE LAW (negative path)', () => {
  it('a delta removing a capability without the declaration is refused with undeclared_breaking_change', () => {
    const result = forgeBodyVersion(fixtureUndeclaredRemovalForgeInput);
    expect(result.minted).toBe(false);
    expect(result.candidate).toBeNull();
    expect(result.reasons.some((r) => r.code === 'undeclared_breaking_change')).toBe(true);
  });

  it('a declared removal appears in the manifest as a structured record (never a surprise)', () => {
    const removals = fixtureForgedCandidate.manifest.capabilityRemovals;
    expect(removals.length).toBe(1);
    expect(removals[0]?.capabilityId).toBe('legacy-signal-reading');
    expect(removals[0]?.rationale.length).toBeGreaterThan(0);
    expect(removals[0]?.addressesGapIds).toEqual(['gap-regime-1']);
  });
});

describe('L3 — the existential law (the parent is NEVER mutated)', () => {
  it('the parent record stays deeply frozen and byte-identical after forging', () => {
    const before = mirrorCanonicalJson(fixtureParentBodyVersion);
    const beforeClone = deepCloneJson(fixtureParentBodyVersion);
    forgeBodyVersion(fixtureForgeInput);
    expect(mirrorCanonicalJson(fixtureParentBodyVersion)).toBe(before);
    expect(fixtureParentBodyVersion).toEqual(beforeClone);
    expect(isDeeplyFrozen(fixtureParentBodyVersion)).toBe(true);
  });

  it('the mint is always a NEW object (never the parent, never the input)', () => {
    const result = forgeBodyVersion(fixtureForgeInput);
    const candidate = result.candidate as ForgedCandidate;
    expect(candidate.candidate).not.toBe(fixtureParentBodyVersion);
    expect(candidate.candidate.composition).not.toBe(fixtureParentBodyVersion.composition);
  });

  it('a delta set that would empty the composition is refused (a body composes >= 1 capability)', () => {
    const emptying = {
      ...fixtureForgeInput,
      deltas: [
        {
          deltaId: 'delta-empty',
          skillRecordRef: 'skill-empty',
          changes: [
            {
              change: 'remove-capability' as const,
              capabilityId: 'regime-detection',
              declaredBreakingChange: { rationale: 'remove all', addressesGapIds: [] },
            },
            {
              change: 'remove-capability' as const,
              capabilityId: 'legacy-signal-reading',
              declaredBreakingChange: { rationale: 'remove all', addressesGapIds: [] },
            },
          ],
          tenantId: 'tenant-forge',
          projectId: 'project-forge',
        },
      ],
    };
    const result = forgeBodyVersion(emptying);
    expect(result.minted).toBe(false);
    expect(result.reasons.some((r) => r.message.includes('at least one capability'))).toBe(true);
  });
});

describe('typed mint gates (negative paths)', () => {
  it('a target version at or below the parent is refused (lineage monotonicity)', () => {
    const regression = {
      ...fixtureForgeInput,
      targetVersion: { major: 1, minor: 2, patch: 0, prerelease: [], build: [] },
    };
    const result = forgeBodyVersion(regression);
    expect(result.minted).toBe(false);
    expect(result.reasons.some((r) => r.message.includes('STRICTLY greater'))).toBe(true);
    expect(compareSemVerMirror(regression.targetVersion, fixtureParentBodyVersion.version)).toBe(0);
  });

  it('a missing seed is refused with unseeded_forge', () => {
    const unseeded = { ...fixtureForgeInput, seed: '' };
    const result = forgeBodyVersion(unseeded);
    expect(result.minted).toBe(false);
    expect(result.reasons.some((r) => r.code === 'unseeded_forge')).toBe(true);
  });

  it('a delta scope disagreement is refused with tenant_mismatch (L12)', () => {
    const foreign = {
      ...fixtureForgeInput,
      deltas: [{ ...fixtureDeltas[0], tenantId: 'tenant-OTHER' } as never],
    };
    const result = forgeBodyVersion(foreign);
    expect(result.minted).toBe(false);
    expect(result.reasons[0]?.code).toBe('tenant_mismatch');
  });

  it('a gap scope disagreement is refused with tenant_mismatch (L12)', () => {
    const foreign = {
      ...fixtureForgeInput,
      gaps: [{ ...fixtureGaps[0], tenantId: 'tenant-OTHER' }],
    };
    const result = forgeBodyVersion(foreign);
    expect(result.minted).toBe(false);
    expect(result.reasons[0]?.code).toBe('tenant_mismatch');
  });

  it('an invalid parent (broken invariants) is refused with structured reasons', () => {
    const invalidParent: BodyVersionMirror = {
      ...fixtureParentBodyVersion,
      composition: {
        ...fixtureParentBodyVersion.composition,
        authorityBoundary: {
          // EXECUTE without external-gateway-only — the L8/L20 mirror law.
          allowedActions: ['EXECUTE', 'OBSERVE'],
          prohibitedActions: [],
          approvalRequiredActions: [],
          executionAuthority: 'none',
          riskPolicyRef: null,
        },
      },
    };
    const result = forgeBodyVersion({ ...fixtureForgeInput, parent: invalidParent });
    expect(result.minted).toBe(false);
    expect(result.reasons.some((r) => r.message.includes('external-gateway-only'))).toBe(true);
  });

  it('a refinement of a non-existent capability is refused', () => {
    const phantom = {
      ...fixtureForgeInput,
      deltas: [
        {
          deltaId: 'delta-phantom',
          skillRecordRef: 'skill-phantom',
          changes: [
            {
              change: 'refine-capability' as const,
              capabilityId: 'does-not-exist',
              description: 'refined',
              additionalSkillArtifactRefs: [],
            },
          ],
          tenantId: 'tenant-forge',
          projectId: 'project-forge',
        },
      ],
    };
    const result = forgeBodyVersion(phantom);
    expect(result.minted).toBe(false);
    expect(result.reasons.some((r) => r.message.includes('does not exist in the parent composition'))).toBe(true);
  });

  it('a duplicate capability addition is refused (agent-body uniqueness law)', () => {
    const duplicate = {
      ...fixtureForgeInput,
      deltas: [
        {
          deltaId: 'delta-duplicate',
          skillRecordRef: 'skill-duplicate',
          changes: [
            {
              change: 'add-capability' as const,
              capabilityId: 'regime-detection',
              name: 'Regime detection',
              description: 'duplicate',
              category: 'research',
              critical: false,
              skillArtifactRefs: ['skill-artifact:x'],
            },
          ],
          tenantId: 'tenant-forge',
          projectId: 'project-forge',
        },
      ],
    };
    const result = forgeBodyVersion(duplicate);
    expect(result.minted).toBe(false);
    expect(result.reasons.some((r) => r.message.includes('already exists'))).toBe(true);
  });

  it('non-object roots are refused with invalid_type-style reasons', () => {
    const result = forgeBodyVersion('not-an-object');
    expect(result.minted).toBe(false);
    expect(result.reasons[0]?.code).toBe('invalid_type');
  });
});
