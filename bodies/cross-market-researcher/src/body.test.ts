// @tradrl/body-cross-market-researcher — THE BODY SPEC TESTS.
//
// The L8 authority trip-wires live here: every edit that grants execution
// authority (EXECUTE in allowedActions, executionAuthority != 'none',
// EXECUTE not prohibited, an edited authority-scope record, a
// consequential tool in a procedure, a non-research capability) fails
// validation with its typed code. L16a: a model identity offered as
// evaluation evidence fails. The reserved-topic law. And the authored
// spec itself validates cleanly and is immutable.

import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTION_NAMES_MIRROR,
  EXECUTION_AUTHORITY_MODES_MIRROR,
  EVALUATION_LAYERS_MIRROR,
  FIDELITY_MODES_MIRROR,
  PROCEDURE_TRIGGERS_MIRROR,
  PLANNING_STYLES_MIRROR,
  MODALITIES_MIRROR,
  REQUIREMENT_LEVELS_MIRROR,
  SUBSTITUTION_TEST_RESULTS_MIRROR,
  CROSS_MARKET_PIPELINE_STAGES,
  CROSS_MARKET_RESEARCHER_BODY,
  CROSS_MARKET_RESEARCHER_BODY_DIGEST,
  CROSS_MARKET_RESEARCHER_BODY_ID,
  CROSS_MARKET_RESEARCHER_BODY_VERSION_REF,
  isBodyVersionMirror,
  isCrossMarketResearcherBody,
  looksLikeModelIdentity,
  validateCrossMarketResearcherBody,
  validateCrossMarketResearcherBodySpec,
} from './body';
import { isDeeplyFrozen } from './primitives';
import {
  consequentialToolBodySpec,
  editedAuthorityScopeBodySpec,
  executionGrantedBodySpec,
  executeNotProhibitedBodySpec,
  externalGatewayBodySpec,
  modelIdentityEvidenceBodySpec,
  nonResearchCapabilityBodySpec,
  reservedTopicBodySpec,
} from './fixtures';

const codesOf = (v: unknown): readonly string[] =>
  validateCrossMarketResearcherBody(v).map((e) => e.code);

describe('the authored spec', () => {
  it('validates cleanly against every law', () => {
    expect(validateCrossMarketResearcherBody(CROSS_MARKET_RESEARCHER_BODY)).toEqual([]);
    expect(isCrossMarketResearcherBody(CROSS_MARKET_RESEARCHER_BODY)).toBe(true);
  });

  it('is deeply frozen and carries a stable digest', () => {
    expect(isDeeplyFrozen(CROSS_MARKET_RESEARCHER_BODY)).toBe(true);
    expect(CROSS_MARKET_RESEARCHER_BODY_DIGEST).toMatch(/^[0-9a-f]{16}$/);
    expect(CROSS_MARKET_RESEARCHER_BODY_ID).toBe('cross-market-researcher');
    expect(CROSS_MARKET_RESEARCHER_BODY_VERSION_REF).toBe('cross-market-researcher@1.0.0');
  });

  it('is AUTHORED, not forged: uncertified with null evidence (T017 owns forging)', () => {
    expect(CROSS_MARKET_RESEARCHER_BODY.bodyVersion.certified).toBe(false);
    expect(CROSS_MARKET_RESEARCHER_BODY.bodyVersion.certificationEvidence).toBeNull();
  });

  it('mirrors the body-version shape and cites skill artifacts opaquely (T017)', () => {
    expect(isBodyVersionMirror(CROSS_MARKET_RESEARCHER_BODY.bodyVersion)).toBe(true);
    for (const capability of CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.capabilities) {
      expect(capability.skillArtifactRefs.length).toBeGreaterThan(0);
    }
    expect(CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.capabilities.length).toBe(4);
  });

  it('declares the five-stage research pipeline as its procedures', () => {
    const steps = CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.procedures
      .find((p) => p.id === 'research-cycle')?.steps ?? [];
    expect(steps.map((s) => s.id)).toEqual([...CROSS_MARKET_PIPELINE_STAGES]);
  });

  it('judges its outputs by cited evaluation criteria (never self-declared)', () => {
    expect(CROSS_MARKET_RESEARCHER_BODY.research.evaluationCriteriaRefs.length).toBeGreaterThanOrEqual(3);
    for (const ref of CROSS_MARKET_RESEARCHER_BODY.research.evaluationCriteriaRefs) {
      expect(looksLikeModelIdentity(ref)).toBe(false);
    }
  });

  it('substrate compatibility is opaque requirement refs (L2/L16a)', () => {
    expect(CROSS_MARKET_RESEARCHER_BODY.research.substrateRequirements.length).toBeGreaterThanOrEqual(2);
  });

  it('the validation wrapper agrees', () => {
    const wrapped = validateCrossMarketResearcherBodySpec(CROSS_MARKET_RESEARCHER_BODY);
    expect(wrapped.ok).toBe(true);
  });
});

describe('THE L8 TRIP-WIRES (read-only authority — the existential law)', () => {
  it('granting EXECUTE fails (execution_authority_granted)', () => {
    expect(codesOf(executionGrantedBodySpec())).toContain('execution_authority_granted');
  });

  it('executionAuthority external-gateway-only fails (execution_authority_granted)', () => {
    expect(codesOf(externalGatewayBodySpec())).toContain('execution_authority_granted');
  });

  it('removing EXECUTE from prohibitedActions fails (execute_not_prohibited)', () => {
    expect(codesOf(executeNotProhibitedBodySpec())).toContain('execute_not_prohibited');
  });

  it('editing the authority-scope record off the law fails (execution_authority_granted)', () => {
    expect(codesOf(editedAuthorityScopeBodySpec())).toContain('execution_authority_granted');
  });

  it('a consequential tool in a procedure fails (consequential_tool_in_procedure)', () => {
    expect(codesOf(consequentialToolBodySpec())).toContain('consequential_tool_in_procedure');
  });

  it('a non-research capability category fails (non_research_capability)', () => {
    expect(codesOf(nonResearchCapabilityBodySpec())).toContain('non_research_capability');
  });
});

describe('THE L16a TRIP-WIRE (labels/model identities never establish suitability)', () => {
  it('a model identity as evaluation evidence fails (model_identity_as_evidence)', () => {
    expect(codesOf(modelIdentityEvidenceBodySpec())).toContain('model_identity_as_evidence');
  });

  it('looksLikeModelIdentity detects substrate-shaped references only', () => {
    expect(looksLikeModelIdentity('acme-models/reasoner-2@2026.03')).toBe(true);
    expect(looksLikeModelIdentity('criteria/crossmarket/relationship-attainment@1')).toBe(false);
    expect(looksLikeModelIdentity('substrate-requirement/structured-output')).toBe(false);
  });
});

describe('the reserved-topic law', () => {
  it('a kernel.* publication topic fails (reserved_publication_topic)', () => {
    expect(codesOf(reservedTopicBodySpec())).toContain('reserved_publication_topic');
  });
});

describe('mirrored vocabulary sanity (structure)', () => {
  it('the fourteen kernel actions, four execution modes absent model-autonomous, and friends', () => {
    expect(AGENT_ACTION_NAMES_MIRROR.length).toBe(14);
    expect(EXECUTION_AUTHORITY_MODES_MIRROR).not.toContain('model-autonomous');
    expect(EVALUATION_LAYERS_MIRROR.length).toBe(9);
    expect(FIDELITY_MODES_MIRROR.length).toBe(3);
    expect(PROCEDURE_TRIGGERS_MIRROR.length).toBe(4);
    expect(PLANNING_STYLES_MIRROR.length).toBe(3);
    expect(MODALITIES_MIRROR.length).toBe(4);
    expect(REQUIREMENT_LEVELS_MIRROR.length).toBe(2);
    expect(SUBSTITUTION_TEST_RESULTS_MIRROR.length).toBe(3);
  });
});

describe('structural negative paths', () => {
  it('a non-record fails immediately (invalid_type)', () => {
    expect(codesOf(null)).toEqual(['invalid_type']);
    expect(codesOf(42)).toEqual(['invalid_type']);
  });

  it('a spec missing its research declaration fails (invalid_type)', () => {
    expect(codesOf({ bodyVersion: CROSS_MARKET_RESEARCHER_BODY.bodyVersion })).toEqual(['invalid_type']);
  });

  it('empty observation kinds fail (the intake declaration is non-empty)', () => {
    expect(
      codesOf({ ...CROSS_MARKET_RESEARCHER_BODY, research: { ...CROSS_MARKET_RESEARCHER_BODY.research, observationKinds: [] } }),
    ).toContain('invalid_field');
  });

  it('an unknown observation kind fails', () => {
    expect(
      codesOf({ ...CROSS_MARKET_RESEARCHER_BODY, research: { ...CROSS_MARKET_RESEARCHER_BODY.research, observationKinds: ['gossip' as never] } }),
    ).toContain('invalid_field');
  });

  it('empty evaluation criteria refs fail (quality is never self-declared)', () => {
    expect(
      codesOf({ ...CROSS_MARKET_RESEARCHER_BODY, research: { ...CROSS_MARKET_RESEARCHER_BODY.research, evaluationCriteriaRefs: [] } }),
    ).toContain('invalid_field');
  });

  it('empty substrate requirements fail (L2)', () => {
    expect(
      codesOf({ ...CROSS_MARKET_RESEARCHER_BODY, research: { ...CROSS_MARKET_RESEARCHER_BODY.research, substrateRequirements: [] } }),
    ).toContain('invalid_field');
  });

  it('the isCrossMarketResearcherBody guard binds the identity, not just the shape', () => {
    const drifted = JSON.parse(JSON.stringify(CROSS_MARKET_RESEARCHER_BODY));
    drifted.bodyVersion.id = 'cross-market-researcher@9.9.9';
    expect(validateCrossMarketResearcherBody(drifted).length).toBeGreaterThan(0);
    expect(isCrossMarketResearcherBody(drifted)).toBe(false);
  });
});
