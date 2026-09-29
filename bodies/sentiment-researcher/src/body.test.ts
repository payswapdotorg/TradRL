// @tradrl/body-sentiment-researcher — THE BODY SPEC TESTS.
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
  RESEARCH_PIPELINE_STAGES,
  SENTIMENT_RESEARCHER_BODY,
  SENTIMENT_RESEARCHER_BODY_DIGEST,
  SENTIMENT_RESEARCHER_BODY_ID,
  SENTIMENT_RESEARCHER_BODY_VERSION_REF,
  isBodyVersionMirror,
  isSentimentResearcherBody,
  looksLikeModelIdentity,
  validateSentimentResearcherBody,
  validateSentimentResearcherBodySpec,
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
  validateSentimentResearcherBody(v).map((e) => e.code);

describe('the authored spec', () => {
  it('validates cleanly against every law', () => {
    expect(validateSentimentResearcherBody(SENTIMENT_RESEARCHER_BODY)).toEqual([]);
    expect(isSentimentResearcherBody(SENTIMENT_RESEARCHER_BODY)).toBe(true);
  });

  it('is deeply frozen and carries a stable digest', () => {
    expect(isDeeplyFrozen(SENTIMENT_RESEARCHER_BODY)).toBe(true);
    expect(SENTIMENT_RESEARCHER_BODY_DIGEST).toMatch(/^[0-9a-f]{16}$/);
    expect(SENTIMENT_RESEARCHER_BODY_ID).toBe('sentiment-researcher');
    expect(SENTIMENT_RESEARCHER_BODY_VERSION_REF).toBe('sentiment-researcher@1.0.0');
  });

  it('is AUTHORED, not forged: uncertified with null evidence (T017 owns forging)', () => {
    expect(SENTIMENT_RESEARCHER_BODY.bodyVersion.certified).toBe(false);
    expect(SENTIMENT_RESEARCHER_BODY.bodyVersion.certificationEvidence).toBeNull();
  });

  it('mirrors the body-version shape and cites skill artifacts opaquely (T017)', () => {
    expect(isBodyVersionMirror(SENTIMENT_RESEARCHER_BODY.bodyVersion)).toBe(true);
    for (const capability of SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.capabilities) {
      expect(capability.skillArtifactRefs.length).toBeGreaterThan(0);
    }
    expect(SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.capabilities.length).toBe(4);
  });

  it('declares the six-stage research pipeline as its procedures', () => {
    const steps = SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.procedures
      .find((p) => p.id === 'research-cycle')?.steps ?? [];
    expect(steps.map((s) => s.id)).toEqual([...RESEARCH_PIPELINE_STAGES]);
  });

  it('judges its outputs by cited evaluation criteria (never self-declared)', () => {
    expect(SENTIMENT_RESEARCHER_BODY.research.evaluationCriteriaRefs.length).toBeGreaterThanOrEqual(3);
    for (const ref of SENTIMENT_RESEARCHER_BODY.research.evaluationCriteriaRefs) {
      expect(looksLikeModelIdentity(ref)).toBe(false);
    }
  });

  it('substrate compatibility is opaque requirement refs (L2/L16a)', () => {
    expect(SENTIMENT_RESEARCHER_BODY.research.substrateRequirements.length).toBeGreaterThanOrEqual(2);
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

  it('looksLikeModelIdentity detects canonical substrate refs and passes criteria refs', () => {
    expect(looksLikeModelIdentity('acme-models/reasoner-2@2026.03')).toBe(true);
    expect(looksLikeModelIdentity('criteria/sentiment/reading-attainment@1')).toBe(false);
  });
});

describe('the reserved-topic law', () => {
  it('publishing to a kernel.* topic fails (reserved_publication_topic)', () => {
    expect(codesOf(reservedTopicBodySpec())).toContain('reserved_publication_topic');
  });
});

describe('validation wrapper', () => {
  it('returns the spec when clean and typed errors when not', () => {
    expect(validateSentimentResearcherBodySpec(SENTIMENT_RESEARCHER_BODY).ok).toBe(true);
    const bad = validateSentimentResearcherBodySpec(executionGrantedBodySpec());
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('unreachable');
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it('garbage input is typed refusal, never a throw', () => {
    for (const garbage of [null, 42, 'x', {}, { bodyVersion: null, research: null }]) {
      expect(() => validateSentimentResearcherBody(garbage)).not.toThrow();
      expect(validateSentimentResearcherBody(garbage).length).toBeGreaterThan(0);
    }
  });
});

describe('the mirrored vocabularies (kind-for-kind with agent-body)', () => {
  it('the fourteen kernel actions', () => {
    expect(AGENT_ACTION_NAMES_MIRROR.length).toBe(14);
    expect(AGENT_ACTION_NAMES_MIRROR).toContain('EXECUTE');
    expect(AGENT_ACTION_NAMES_MIRROR).toContain('PUBLISH');
  });

  it('execution authority has NO model-autonomous member (L8/L20)', () => {
    expect(EXECUTION_AUTHORITY_MODES_MIRROR).toEqual(['none', 'external-gateway-only']);
    expect(EXECUTION_AUTHORITY_MODES_MIRROR).not.toContain('model-autonomous');
  });

  it('the nine evaluation layers and three fidelity modes', () => {
    expect(EVALUATION_LAYERS_MIRROR.length).toBe(9);
    expect(FIDELITY_MODES_MIRROR).toEqual(['exact-replay', 'reactive-replay', 'counterfactual-generative']);
  });

  it('triggers, planning styles, modalities, requirement levels, substitution results', () => {
    expect(PROCEDURE_TRIGGERS_MIRROR).toEqual(['scheduled', 'event', 'on-demand', 'escalation']);
    expect(PLANNING_STYLES_MIRROR).toEqual(['reactive', 'deliberative', 'hybrid']);
    expect(MODALITIES_MIRROR).toEqual(['text', 'image', 'audio', 'video']);
    expect(REQUIREMENT_LEVELS_MIRROR).toEqual(['required', 'optional']);
    expect(SUBSTITUTION_TEST_RESULTS_MIRROR).toEqual(['pass', 'fail', 'conditional']);
  });
});
