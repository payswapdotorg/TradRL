// @tradrl/body-execution — body tests (EXECUTION_BODY: the authored
// spec validates; THE L8 NEGATIVES — EXECUTE without the gateway
// pairing, model-autonomous claims, 'none'-mode reference spec, EXECUTE
// prohibited, consequential tools; THE L16 NEGATIVES — the strategic
// clock, strategic-level control; the L16a model-identity ban; the
// reserved-topic law; the mirrored T003 invariants).

import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTION_NAMES_MIRROR,
  EVALUATION_LAYERS_MIRROR,
  EXECUTION_AUTHORITY_MODES_MIRROR,
  EXECUTION_BODY,
  EXECUTION_BODY_DIGEST,
  EXECUTION_BODY_ID,
  EXECUTION_BODY_VERSION_REF,
  EXECUTION_CLOCKS,
  FIDELITY_MODES_MIRROR,
  MODALITIES_MIRROR,
  PLANNING_STYLES_MIRROR,
  PROCEDURE_TRIGGERS_MIRROR,
  REQUIREMENT_LEVELS_MIRROR,
  SUBSTITUTION_TEST_RESULTS_MIRROR,
  isConsequentialToolName,
  isExecutionBody,
  looksLikeModelIdentity,
  validateExecutionBody,
} from './body';
import { isDeeplyFrozen } from './primitives';
import {
  consequentialToolBodySpec,
  executeProhibitedBodySpec,
  executionGrantedBodySpec,
  modelAutonomousBodySpec,
  modelIdentityEvidenceBodySpec,
  noneModeBodySpec,
  nonExecutionCapabilityBodySpec,
  reservedTopicBodySpec,
  strategicClockBodySpec,
  strategicControlBodySpec,
} from './fixtures';

describe('the authored spec', () => {
  it('validates cleanly under every law', () => {
    expect(validateExecutionBody(EXECUTION_BODY)).toEqual([]);
  });

  it('carries the canonical identity and a stable digest', () => {
    expect(EXECUTION_BODY.bodyVersion.id).toBe('execution@1.0.0');
    expect(EXECUTION_BODY_ID).toBe('execution');
    expect(EXECUTION_BODY_VERSION_REF).toBe('execution@1.0.0');
    expect(EXECUTION_BODY_DIGEST).toMatch(/^[0-9a-f]{16}$/);
    expect(isExecutionBody(EXECUTION_BODY)).toBe(true);
  });

  it('is deeply frozen (immutable authored record)', () => {
    expect(isDeeplyFrozen(EXECUTION_BODY)).toBe(true);
  });

  it('certification stays false with null evidence (T017\'s law: certification is the verification lane\'s verdict)', () => {
    expect(EXECUTION_BODY.bodyVersion.certified).toBe(false);
    expect(EXECUTION_BODY.bodyVersion.certificationEvidence).toBeNull();
  });
});

describe('THE AUTHORITY BOUNDARY (the L8 order-lane configuration)', () => {
  it('EXECUTE is in allowedActions PAIRED with external-gateway-only — the REQUEST semantics', () => {
    const boundary = EXECUTION_BODY.bodyVersion.composition.authorityBoundary;
    expect(boundary.allowedActions).toContain('EXECUTE');
    expect(boundary.executionAuthority).toBe('external-gateway-only');
    expect(boundary.prohibitedActions).not.toContain('EXECUTE');
    expect(boundary.approvalRequiredActions).toContain('EXECUTE'); // the request is approval-gated
    expect(boundary.allowedActions).toEqual(
      expect.arrayContaining(['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REQUEST', 'LEARN', 'REPORT', 'ESCALATE']),
    );
  });

  it('EXECUTION_AUTHORITY_MODES_MIRROR deliberately has NO model-autonomous member (L8/L20)', () => {
    expect([...EXECUTION_AUTHORITY_MODES_MIRROR]).toEqual(['none', 'external-gateway-only']);
    expect(EXECUTION_AUTHORITY_MODES_MIRROR).not.toContain('model-autonomous');
  });

  it('the L16 declarations: order-level clock, strategic control prohibited, no venue-direct tools', () => {
    expect(EXECUTION_BODY.execution.clock).toBe('order-level');
    expect([...EXECUTION_CLOCKS]).toEqual(['order-level']);
    expect(EXECUTION_BODY.execution.authorityScope.strategicLevelControl).toBe('prohibited');
    expect(EXECUTION_BODY.execution.authorityScope.orderRouting).toBe('prohibited'); // T040's chokepoint
    expect(EXECUTION_BODY.execution.authorityScope.executionRequest).toBe('gateway-request-only');
    for (const tool of EXECUTION_BODY.bodyVersion.composition.knowledgeToolPolicy.allowedTools) {
      expect(isConsequentialToolName(tool)).toBe(false);
    }
    expect(EXECUTION_BODY.bodyVersion.composition.knowledgeToolPolicy.forbiddenTools).toEqual(
      expect.arrayContaining(['tools/venue-direct-order-entry', 'tools/execution-router', 'tools/position-manager']),
    );
  });

  it('every capability is order-lifecycle-category', () => {
    for (const capability of EXECUTION_BODY.bodyVersion.composition.capabilities) {
      expect(capability.category).toBe('order-lifecycle');
    }
  });

  it('the consequential-tool detector catches the venue-side verbs and passes the monitoring tools', () => {
    expect(isConsequentialToolName('tools/venue-direct-order-entry')).toBe(true);
    expect(isConsequentialToolName('tools/place-order')).toBe(true);
    expect(isConsequentialToolName('tools/execution-router')).toBe(true);
    expect(isConsequentialToolName('tools/position-manager')).toBe(true);
    expect(isConsequentialToolName('tools/order-request-preparer')).toBe(false);
    expect(isConsequentialToolName('tools/execution-gateway-requester')).toBe(false);
    expect(isConsequentialToolName('tools/order-lifecycle-monitor')).toBe(false);
    expect(isConsequentialToolName('tools/fill-reconciler')).toBe(false);
  });
});

describe('THE L8 NEGATIVES (typed errors on doctored specs)', () => {
  it('EXECUTE in allowedActions with executionAuthority \'none\' — execution_authority_granted (the pairing law, kept)', () => {
    const errors = validateExecutionBody(executionGrantedBodySpec());
    expect(errors.some((e) => e.code === 'execution_authority_granted')).toBe(true);
    const pairing = errors.find((e) => e.code === 'execution_authority_granted' && e.message.includes('REQUESTS through the gateway'));
    expect(pairing).toBeDefined();
  });

  it('A MODEL-AUTONOMOUS claim — execution_authority_granted (outside the closed mode set)', () => {
    const errors = validateExecutionBody(modelAutonomousBodySpec());
    expect(errors.some((e) => e.code === 'execution_authority_granted')).toBe(true);
    const autonomous = errors.find((e) => e.message.includes('model-autonomous'));
    expect(autonomous).toBeDefined();
    expect(autonomous?.message).toContain('no model-autonomous member by design');
  });

  it('\'none\' on the reference role — execution_authority_granted (the role REQUIRES the gateway-ref mode)', () => {
    const errors = validateExecutionBody(noneModeBodySpec());
    const roleError = errors.find((e) => e.code === 'execution_authority_granted' && e.message.includes('REQUIRES the gateway-ref mode'));
    expect(roleError).toBeDefined();
  });

  it('EXECUTE in prohibitedActions — execute_prohibited (the gateway-request action may not be prohibited)', () => {
    const errors = validateExecutionBody(executeProhibitedBodySpec());
    expect(errors.some((e) => e.code === 'execute_prohibited')).toBe(true);
    // the T003 disjointness invariant fires too (allowed ∩ prohibited = ∅)
    expect(errors.some((e) => e.code === 'invalid_field')).toBe(true);
  });

  it('A CONSEQUENTIAL (venue-direct) tool in a procedure — consequential_tool_in_procedure', () => {
    const errors = validateExecutionBody(consequentialToolBodySpec());
    expect(errors.some((e) => e.code === 'consequential_tool_in_procedure')).toBe(true);
    expect(errors.some((e) => e.code === 'forbidden_tool_in_procedure')).toBe(true); // also outside the allowed policy
  });

  it('A NON-ORDER-LIFECYCLE capability — non_execution_capability', () => {
    const errors = validateExecutionBody(nonExecutionCapabilityBodySpec());
    expect(errors.some((e) => e.code === 'non_execution_capability')).toBe(true);
  });
});

describe('THE L16 NEGATIVES (typed errors on doctored specs)', () => {
  it('A STRATEGIC clock declaration — clock_confusion (the order-level clock is fixed by law)', () => {
    const errors = validateExecutionBody(strategicClockBodySpec());
    const confusion = errors.find((e) => e.code === 'clock_confusion');
    expect(confusion).toBeDefined();
    expect(confusion?.message).toContain('ORDER-LEVEL clock');
  });

  it('A STRATEGIC-LEVEL-CONTROL scope claim — strategic_level_control (the director\'s lane)', () => {
    const errors = validateExecutionBody(strategicControlBodySpec());
    const control = errors.find((e) => e.code === 'strategic_level_control');
    expect(control).toBeDefined();
    expect(control?.message).toContain('trading director');
  });
});

describe('THE L16a NEGATIVE + the reserved-topic law', () => {
  it('A MODEL IDENTITY as evaluation evidence — model_identity_as_evidence', () => {
    const errors = validateExecutionBody(modelIdentityEvidenceBodySpec());
    expect(errors.some((e) => e.code === 'model_identity_as_evidence')).toBe(true);
    expect(looksLikeModelIdentity('acme-models/reasoner-2@2026.03')).toBe(true);
    expect(looksLikeModelIdentity('criteria/execution/lifecycle-attainment@1')).toBe(false);
  });

  it('A RESERVED kernel topic — reserved_publication_topic', () => {
    const errors = validateExecutionBody(reservedTopicBodySpec());
    expect(errors.some((e) => e.code === 'reserved_publication_topic')).toBe(true);
    expect(errors.find((e) => e.code === 'reserved_publication_topic')?.message).toContain('kernel.*');
  });
});

describe('the mirrored T003 invariants (collect-all on doctored specs)', () => {
  it('a broken body version reports every invariant violation', () => {
    const doctored = JSON.parse(JSON.stringify(EXECUTION_BODY));
    const composition = doctored.bodyVersion.composition;
    composition.capabilities.push(JSON.parse(JSON.stringify(composition.capabilities[0])));
    composition.knowledgeToolPolicy.forbiddenTools.push(composition.knowledgeToolPolicy.allowedTools[0]);
    composition.procedures.push(JSON.parse(JSON.stringify(composition.procedures[0])));
    composition.delegationPolicy.maxDelegationDepth = 3; // canDelegate false
    composition.authorityBoundary.approvalRequiredActions.push('SPAWN'); // not allowed
    doctored.bodyVersion.id = 'wrong@id';
    const errors = validateExecutionBody(doctored);
    expect(errors.length).toBeGreaterThanOrEqual(6);
    const codes = new Set(errors.map((e) => e.code));
    expect(codes.has('invalid_field')).toBe(true); // canonical id, unique ids, disjointness, procedures, delegation, approval-required
  });

  it('a malformed record/type refuses cleanly', () => {
    expect(validateExecutionBody(null)[0]?.code).toBe('invalid_type');
    expect(validateExecutionBody({ bodyVersion: 'x' })[0]?.code).toBe('invalid_type');
    expect(validateExecutionBody({ bodyVersion: {}, execution: 'x' }).some((e) => e.code === 'invalid_type')).toBe(true);
    expect(validateExecutionBody({ bodyVersion: {}, execution: 'x' }).some((e) => e.code === 'invalid_field')).toBe(true);
  });

  it('the mirrored vocabularies are the T003 kinds', () => {
    expect([...AGENT_ACTION_NAMES_MIRROR]).toHaveLength(14);
    expect([...EVALUATION_LAYERS_MIRROR]).toHaveLength(9);
    expect([...FIDELITY_MODES_MIRROR]).toEqual(['exact-replay', 'reactive-replay', 'counterfactual-generative']);
    expect([...PROCEDURE_TRIGGERS_MIRROR]).toEqual(['scheduled', 'event', 'on-demand', 'escalation']);
    expect([...PLANNING_STYLES_MIRROR]).toEqual(['reactive', 'deliberative', 'hybrid']);
    expect([...MODALITIES_MIRROR]).toEqual(['text', 'image', 'audio', 'video']);
    expect([...REQUIREMENT_LEVELS_MIRROR]).toEqual(['required', 'optional']);
    expect([...SUBSTITUTION_TEST_RESULTS_MIRROR]).toEqual(['pass', 'fail', 'conditional']);
  });
});
