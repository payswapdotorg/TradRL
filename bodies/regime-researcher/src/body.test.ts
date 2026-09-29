// @tradrl/body-regime-researcher — the body spec tests.

import { describe, expect, it } from 'vitest';

import {
  AGENT_ACTION_NAMES_MIRROR,
  EVALUATION_LAYERS_MIRROR,
  EXECUTION_AUTHORITY_MODES_MIRROR,
  FIDELITY_MODES_MIRROR,
  MODALITIES_MIRROR,
  PLANNING_STYLES_MIRROR,
  PROCEDURE_TRIGGERS_MIRROR,
  REGIME_PIPELINE_STAGES,
  REGIME_RESEARCHER_BODY,
  REGIME_RESEARCHER_BODY_DIGEST,
  REGIME_RESEARCHER_BODY_VERSION_REF,
  REQUIREMENT_LEVELS_MIRROR,
  SUBSTITUTION_TEST_RESULTS_MIRROR,
  isRegimeResearcherBody,
  looksLikeModelIdentity,
  validateRegimeResearcherBody,
  validateRegimeResearcherBodySpec,
} from './body';
import { KERNEL_TOPICS_MIRROR } from './publication';
import {
  consequentialToolBodySpec,
  editedAuthorityScopeBodySpec,
  executeNotProhibitedBodySpec,
  executionGrantedBodySpec,
  externalGatewayBodySpec,
  modelIdentityEvidenceBodySpec,
  nonResearchCapabilityBodySpec,
  reservedTopicBodySpec,
} from './fixtures';
import { isDeeplyFrozen } from './primitives';

const codesOf = (errors: readonly { code: string }[]): readonly string[] => errors.map((e) => e.code);

describe('REGIME_RESEARCHER_BODY (the shipped spec)', () => {
  it('validates cleanly against every law', () => {
    expect(validateRegimeResearcherBody(REGIME_RESEARCHER_BODY)).toEqual([]);
    expect(isRegimeResearcherBody(REGIME_RESEARCHER_BODY)).toBe(true);
  });

  it('is deeply frozen and carries a stable digest', () => {
    expect(isDeeplyFrozen(REGIME_RESEARCHER_BODY)).toBe(true);
    expect(REGIME_RESEARCHER_BODY_DIGEST).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is AUTHORED, not forged: uncertified with null evidence (T017 owns forging)', () => {
    expect(REGIME_RESEARCHER_BODY.bodyVersion.certified).toBe(false);
    expect(REGIME_RESEARCHER_BODY.bodyVersion.certificationEvidence).toBeNull();
  });

  it('mirrors the body-version shape and cites skill artifacts opaquely (T017)', () => {
    expect(REGIME_RESEARCHER_BODY.bodyVersion.id).toBe('regime-researcher@1.0.0');
    expect(REGIME_RESEARCHER_BODY.bodyVersion.bodyId).toBe('regime-researcher');
    expect(REGIME_RESEARCHER_BODY_VERSION_REF).toBe('regime-researcher@1.0.0');
    for (const capability of REGIME_RESEARCHER_BODY.bodyVersion.composition.capabilities) {
      expect(capability.skillArtifactRefs.length).toBeGreaterThan(0);
      for (const ref of capability.skillArtifactRefs) {
        expect(ref.startsWith('skills/regime/')).toBe(true);
      }
    }
  });

  it('declares the six-stage regime research pipeline as its procedures', () => {
    const cycle = REGIME_RESEARCHER_BODY.bodyVersion.composition.procedures.find(
      (p) => p.id === 'regime-research-cycle',
    );
    expect(cycle).toBeDefined();
    expect(cycle!.steps.map((s) => s.id)).toEqual([...REGIME_PIPELINE_STAGES]);
    expect(REGIME_RESEARCHER_BODY.research.observationKinds).toEqual(['quote', 'trade', 'book_snapshot']);
  });

  it('judges its outputs by cited evaluation criteria (never self-declared)', () => {
    expect(REGIME_RESEARCHER_BODY.research.evaluationCriteriaRefs.length).toBe(3);
    for (const ref of REGIME_RESEARCHER_BODY.research.evaluationCriteriaRefs) {
      expect(ref.startsWith('criteria/regime/')).toBe(true);
    }
  });

  it('substrate compatibility is opaque requirement refs (L2/L16a)', () => {
    expect(REGIME_RESEARCHER_BODY.research.substrateRequirements.length).toBeGreaterThan(0);
    for (const ref of REGIME_RESEARCHER_BODY.research.substrateRequirements) {
      expect(looksLikeModelIdentity(ref)).toBe(false);
    }
  });

  it('runs the canonical method registry (the closed set)', () => {
    expect(REGIME_RESEARCHER_BODY.research.methodRegistry.methods.length).toBe(4);
  });
});

describe('THE L8 LAWS (the existential declaration — negative paths)', () => {
  it('granting EXECUTE fails (execution_authority_granted)', () => {
    const errors = validateRegimeResearcherBody(executionGrantedBodySpec());
    expect(codesOf(errors)).toContain('execution_authority_granted');
  });

  it('executionAuthority external-gateway-only fails (execution_authority_granted)', () => {
    const errors = validateRegimeResearcherBody(externalGatewayBodySpec());
    expect(codesOf(errors)).toContain('execution_authority_granted');
  });

  it('removing EXECUTE from prohibitedActions fails (execute_not_prohibited)', () => {
    const errors = validateRegimeResearcherBody(executeNotProhibitedBodySpec());
    expect(codesOf(errors)).toContain('execute_not_prohibited');
  });

  it('editing the authority-scope record off the law fails (execution_authority_granted)', () => {
    const errors = validateRegimeResearcherBody(editedAuthorityScopeBodySpec());
    expect(codesOf(errors)).toContain('execution_authority_granted');
  });

  it('a consequential tool in a procedure fails (consequential_tool_in_procedure)', () => {
    const errors = validateRegimeResearcherBody(consequentialToolBodySpec());
    expect(codesOf(errors)).toContain('consequential_tool_in_procedure');
  });

  it('a non-research capability category fails (non_research_capability)', () => {
    const errors = validateRegimeResearcherBody(nonResearchCapabilityBodySpec());
    expect(codesOf(errors)).toContain('non_research_capability');
  });

  it('a model identity as evaluation evidence fails (model_identity_as_evidence)', () => {
    const errors = validateRegimeResearcherBody(modelIdentityEvidenceBodySpec());
    expect(codesOf(errors)).toContain('model_identity_as_evidence');
  });

  it('publishing to a kernel.* topic fails (reserved_publication_topic)', () => {
    const errors = validateRegimeResearcherBody(reservedTopicBodySpec());
    expect(codesOf(errors)).toContain('reserved_publication_topic');
  });

  it('the authority record is read-only (the L8 declaration)', () => {
    expect(REGIME_RESEARCHER_BODY.research.authorityScope).toEqual({
      scope: 'observation-research-publication',
      execution: 'prohibited',
      orderPlacement: 'prohibited',
      consequentialActions: 'prohibited',
    });
    expect(REGIME_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary.allowedActions).not.toContain('EXECUTE');
    expect(REGIME_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary.prohibitedActions).toContain('EXECUTE');
  });
});

describe('the validation wrapper', () => {
  it('returns the spec when clean and typed errors when not', () => {
    const clean = validateRegimeResearcherBodySpec(REGIME_RESEARCHER_BODY);
    expect(clean.ok).toBe(true);
    expect(clean.value).toBe(REGIME_RESEARCHER_BODY);
    const dirty = validateRegimeResearcherBodySpec(executionGrantedBodySpec());
    expect(dirty.ok).toBe(false);
    expect(dirty.value).toBeNull();
    expect(dirty.errors.length).toBeGreaterThan(0);
  });

  it('garbage input is typed refusal, never a throw', () => {
    for (const bad of [null, 12, 'spec', {}, { bodyVersion: {} }]) {
      expect(validateRegimeResearcherBody(bad).length).toBeGreaterThan(0);
    }
  });
});

describe('the mirrored vocabularies', () => {
  it('the fourteen kernel actions', () => {
    expect([...AGENT_ACTION_NAMES_MIRROR]).toHaveLength(14);
    expect(AGENT_ACTION_NAMES_MIRROR).toContain('EXECUTE');
    expect(AGENT_ACTION_NAMES_MIRROR).toContain('SUBSCRIBE');
  });

  it('execution authority has NO model-autonomous member (L8/L20)', () => {
    expect([...EXECUTION_AUTHORITY_MODES_MIRROR]).toEqual(['none', 'external-gateway-only']);
  });

  it('the nine evaluation layers and three fidelity modes', () => {
    expect([...EVALUATION_LAYERS_MIRROR]).toHaveLength(9);
    expect([...FIDELITY_MODES_MIRROR]).toEqual(['exact-replay', 'reactive-replay', 'counterfactual-generative']);
  });

  it('triggers, planning styles, modalities, requirement levels, substitution results', () => {
    expect([...PROCEDURE_TRIGGERS_MIRROR]).toEqual(['scheduled', 'event', 'on-demand', 'escalation']);
    expect([...PLANNING_STYLES_MIRROR]).toEqual(['reactive', 'deliberative', 'hybrid']);
    expect([...MODALITIES_MIRROR]).toEqual(['text', 'image', 'audio', 'video']);
    expect([...REQUIREMENT_LEVELS_MIRROR]).toEqual(['required', 'optional']);
    expect([...SUBSTITUTION_TEST_RESULTS_MIRROR]).toEqual(['pass', 'fail', 'conditional']);
  });

  it('looksLikeModelIdentity detects canonical substrate refs and passes criteria refs', () => {
    expect(looksLikeModelIdentity('acme-models/reasoner-2@2026.03')).toBe(true);
    expect(looksLikeModelIdentity('provider/gpt-x@v1')).toBe(true);
    expect(looksLikeModelIdentity('criteria/regime/report-attainment@1')).toBe(false);
    expect(looksLikeModelIdentity('substrate-requirement/structured-output')).toBe(false);
    expect(looksLikeModelIdentity('plain-string')).toBe(false);
  });

  it('the kernel topic reservation is mirrored', () => {
    expect([...KERNEL_TOPICS_MIRROR]).toHaveLength(7);
    expect(KERNEL_TOPICS_MIRROR).toContain('kernel.escalate');
  });
});
