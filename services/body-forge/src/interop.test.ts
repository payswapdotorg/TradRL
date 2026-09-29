/**
 * Cross-package interoperability for @tradrl/body-forge (T017):
 *
 * THE ACCEPTANCE CRITERION (Work Order T017, criterion 11): "forged
 * candidates satisfy agent-body's BodyVersion mirror; extraction inputs
 * satisfy trajectory/experiment/verdict mirrors; gap inputs satisfy the
 * organization lane's CapabilityGap shape (trip-wire tests against the
 * real packages)." The extraction-input trip wires live in
 * packages/skills/src/interop.test.ts; THIS file is the forge-side wire:
 *
 * 1. MIRROR FIDELITY (agent-body, T003): a REAL `createBodyVersion`
 *    output satisfies `isBodyVersionMirror`; the GOLDEN FORGED candidate
 *    (built purely in mirror shapes) satisfies the REAL agent-body
 *    `isBodyVersion` guard — and the real `certifyBodyVersion` ACCEPTS it
 *    (the full semantic-invariant parity: canonical id, parent lineage,
 *    composition laws, compatibility manifest).
 * 2. NEGATIVE PARITY: the broken-compatibility parent fails BOTH the
 *    mirror guard and the real agent-body guard (guard agreement on the
 *    refusal side).
 * 3. GAP PARITY (organization, T016): a REAL `createCapabilityGap` record
 *    satisfies `isCapabilityGapMirror` and drives a successful forge run.
 * 4. ENUM PARITY: the mirrored composition vocabularies match the real
 *    agent-body enums kind-for-kind (actions, execution authority,
 *    evaluation layers, fidelity modes, triggers, planning styles,
 *    modalities, requirement levels, substitution results).
 */

import { describe, expect, it } from 'vitest';

// --- The service under test ---
import {
  type BodyVersionMirror,
  AGENT_ACTION_NAMES_MIRROR,
  EVALUATION_LAYERS_MIRROR,
  EXECUTION_AUTHORITY_MODES_MIRROR,
  FIDELITY_MODES_MIRROR,
  MODALITIES_MIRROR,
  PLANNING_STYLES_MIRROR,
  PROCEDURE_TRIGGERS_MIRROR,
  REQUIREMENT_LEVELS_MIRROR,
  SUBSTITUTION_TEST_RESULTS_MIRROR,
  forgeBodyVersion,
  isBodyVersionMirror,
} from './index';
import {
  fixtureBrokenCompatibilityForgeInput,
  fixtureForgeInput,
  fixtureForgedCandidate,
  fixtureParentBodyVersion,
} from './fixtures';

// --- The REAL agent-body package (test-only import — the trip wire) ---
import {
  type BodyVersionDraft,
  AGENT_ACTION_NAMES,
  EVALUATION_LAYERS,
  EXECUTION_AUTHORITY_MODES,
  FIDELITY_MODES,
  MODALITIES,
  PLANNING_STYLES,
  PROCEDURE_TRIGGERS,
  REQUIREMENT_LEVELS,
  SUBSTITUTION_TEST_RESULTS,
  certifyBodyVersion,
  createBodyVersion,
  isBodyVersion,
} from '../../../packages/agent-body/src/index';
import {
  type BodyComposition,
  type CertificationEvidence,
  isBodyComposition,
} from '../../../packages/agent-body/src/index';
import { createCapabilityGap } from '../../../packages/organization/src/index';
import { isCapabilityGapMirror } from '../../../packages/skills/src/index';

// ---------------------------------------------------------------------------
// 1. Mirror fidelity (agent-body, T003)
// ---------------------------------------------------------------------------

/** A REAL BodyVersion built by agent-body's own factory from the fixture composition. */
const realBodyVersion = createBodyVersion({
  bodyId: 'regime-researcher',
  version: { major: 2, minor: 0, patch: 0, prerelease: [], build: [] },
  parentId: null,
  composition: fixtureParentBodyVersion.composition as unknown as BodyComposition,
  createdAt: '2026-04-01T00:00:00Z',
} as unknown as BodyVersionDraft);

describe('mirror fidelity (agent-body, T003)', () => {
  it('a REAL createBodyVersion output satisfies the forge mirror guard', () => {
    expect(isBodyVersion(realBodyVersion)).toBe(true);
    expect(isBodyVersionMirror(realBodyVersion)).toBe(true);
    expect(isBodyVersionMirror(JSON.parse(JSON.stringify(realBodyVersion)))).toBe(true);
  });

  it('the fixture parent (a certified mirror record) satisfies the REAL agent-body guard', () => {
    // The certified parent carries evidence — the real guard accepts
    // certified records too (certified iff evidence non-null).
    expect(isBodyVersion(fixtureParentBodyVersion)).toBe(true);
    expect(isBodyComposition(fixtureParentBodyVersion.composition)).toBe(true);
  });

  it('THE GOLDEN FORGED CANDIDATE satisfies the REAL agent-body isBodyVersion guard', () => {
    // The acceptance criterion: forged candidates satisfy agent-body's
    // BodyVersion mirror. Forged in PURE mirror shapes — accepted by the
    // canonical guard without any adaptation.
    expect(isBodyVersion(fixtureForgedCandidate.candidate)).toBe(true);
    expect(isBodyVersion(JSON.parse(JSON.stringify(fixtureForgedCandidate.candidate)))).toBe(true);
    expect(isBodyComposition(fixtureForgedCandidate.candidate.composition)).toBe(true);
  });

  it('the REAL certifyBodyVersion ACCEPTS the forged candidate (full invariant parity)', () => {
    // certifyBodyVersion re-validates the version (canonical id, parent
    // lineage, composition invariants) AND demands a passing substitution
    // test — the forged candidate satisfies every real law.
    const evidence = {
      evidenceRefs: ['capsule/interop/forge'],
      evaluationRefs: ['capsule/interop/eval'],
      certifiedBy: 'interop-trip-wire',
      certifiedAt: '2026-04-02T00:00:00Z',
      summary: 'Interop trip-wire: the real agent-body certifier accepts the forged candidate.',
    } as unknown as CertificationEvidence;
    const result = certifyBodyVersion(
      fixtureForgedCandidate.candidate as unknown as Parameters<typeof certifyBodyVersion>[0],
      evidence,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.certified.certified).toBe(true);
      expect(result.certified.id).toBe('regime-researcher@1.3.0');
    }
  });

  it('a forge run over the REAL body version mints a candidate that passes the real guard', () => {
    const result = forgeBodyVersion({
      ...fixtureForgeInput,
      parent: realBodyVersion as unknown as BodyVersionMirror,
      targetVersion: { major: 2, minor: 1, patch: 0, prerelease: [], build: [] },
    });
    expect(result.minted).toBe(true);
    if (result.candidate !== null) {
      expect(isBodyVersion(result.candidate.candidate)).toBe(true);
      expect(result.candidate.candidate.id).toBe('regime-researcher@2.1.0');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Negative parity (guard agreement on the refusal side)
// ---------------------------------------------------------------------------

describe('negative parity (agent-body, T003)', () => {
  it('the broken-compatibility parent fails BOTH guards identically', () => {
    const brokenParent = (
      fixtureBrokenCompatibilityForgeInput as { parent: BodyVersionMirror }
    ).parent;
    expect(isBodyVersionMirror(brokenParent)).toBe(false);
    expect(isBodyVersion(brokenParent)).toBe(false);
    // And the forge refuses to mint from it (compatibility_fail).
    const result = forgeBodyVersion(fixtureBrokenCompatibilityForgeInput);
    expect(result.minted).toBe(false);
    expect(result.reasons.every((r) => r.code === 'compatibility_fail')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Gap parity (organization, T016)
// ---------------------------------------------------------------------------

describe('gap parity (organization, T016)', () => {
  it('a REAL createCapabilityGap record satisfies the mirror and drives a forge run', () => {
    const realGap = createCapabilityGap({
      gapId: 'gap-org-interop-1',
      kind: 'regime',
      capabilityKey: 'regime-detection',
      evidenceRef: 'capsule:gap-org-interop-1',
      detectedAt: 1_700_000_000_000,
      tenantId: 'tenant-forge',
      projectId: 'project-forge',
    } as never);
    expect(isCapabilityGapMirror(realGap)).toBe(true);
    const result = forgeBodyVersion({
      ...fixtureForgeInput,
      gaps: [realGap],
    });
    expect(result.minted).toBe(true);
    if (result.candidate !== null) {
      expect(result.candidate.lineage.gapRefs).toEqual(['gap-org-interop-1']);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Enum parity (the mirrored composition vocabularies)
// ---------------------------------------------------------------------------

describe('enum parity (agent-body composition vocabularies)', () => {
  it('the kernel action set matches kind-for-kind', () => {
    expect([...AGENT_ACTION_NAMES_MIRROR]).toEqual([...AGENT_ACTION_NAMES]);
  });

  it('execution authority modes match (no model-autonomous — L8/L20)', () => {
    expect([...EXECUTION_AUTHORITY_MODES_MIRROR]).toEqual([...EXECUTION_AUTHORITY_MODES]);
    expect(EXECUTION_AUTHORITY_MODES_MIRROR).not.toContain('model-autonomous');
  });

  it('evaluation layers match kind-for-kind', () => {
    expect([...EVALUATION_LAYERS_MIRROR]).toEqual([...EVALUATION_LAYERS]);
  });

  it('fidelity modes match kind-for-kind (L5)', () => {
    expect([...FIDELITY_MODES_MIRROR]).toEqual([...FIDELITY_MODES]);
  });

  it('procedure triggers, planning styles, modalities, requirement levels and substitution results match', () => {
    expect([...PROCEDURE_TRIGGERS_MIRROR]).toEqual([...PROCEDURE_TRIGGERS]);
    expect([...PLANNING_STYLES_MIRROR]).toEqual([...PLANNING_STYLES]);
    expect([...MODALITIES_MIRROR]).toEqual([...MODALITIES]);
    expect([...REQUIREMENT_LEVELS_MIRROR]).toEqual([...REQUIREMENT_LEVELS]);
    expect([...SUBSTITUTION_TEST_RESULTS_MIRROR]).toEqual([...SUBSTITUTION_TEST_RESULTS]);
  });
});
