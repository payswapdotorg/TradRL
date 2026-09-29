// @tradrl/body-trading-director — body tests (TRADING_DIRECTOR_BODY: the
// authored spec validates; THE L8 NEGATIVES — EXECUTE in allowedActions,
// executionAuthority != 'none', EXECUTE not prohibited, a consequential
// tool in a procedure; THE L16 NEGATIVES — order-level control scope,
// order-level clock; the L16a model-identity ban; the reserved-topic
// law; the mirrored T003 invariants).

import { describe, expect, it } from 'vitest';
import {
  TRADING_DIRECTOR_BODY,
  TRADING_DIRECTOR_BODY_DIGEST,
  TRADING_DIRECTOR_BODY_ID,
  TRADING_DIRECTOR_BODY_VERSION_REF,
  isTradingDirectorBody,
  looksLikeModelIdentity,
  validateTradingDirectorBody,
} from './body';
import { isDeeplyFrozen } from './primitives';
import {
  consequentialToolBodySpec,
  editedAuthorityScopeBodySpec,
  executionGrantedBodySpec,
  executeNotProhibitedBodySpec,
  modelIdentityEvidenceBodySpec,
  nonDecisionCapabilityBodySpec,
  orderLevelClockBodySpec,
  orderLevelControlBodySpec,
  reservedTopicBodySpec,
  externalGatewayBodySpec,
} from './fixtures';

describe('the authored spec', () => {
  it('validates cleanly under every law', () => {
    expect(validateTradingDirectorBody(TRADING_DIRECTOR_BODY)).toEqual([]);
  });

  it('carries the canonical identity and a stable digest', () => {
    expect(TRADING_DIRECTOR_BODY.bodyVersion.id).toBe('trading-director@1.0.0');
    expect(TRADING_DIRECTOR_BODY_ID).toBe('trading-director');
    expect(TRADING_DIRECTOR_BODY_VERSION_REF).toBe('trading-director@1.0.0');
    expect(TRADING_DIRECTOR_BODY_DIGEST).toMatch(/^[0-9a-f]{16}$/);
    expect(isTradingDirectorBody(TRADING_DIRECTOR_BODY)).toBe(true);
  });

  it('is deeply frozen (immutable authored record)', () => {
    expect(isDeeplyFrozen(TRADING_DIRECTOR_BODY)).toBe(true);
  });

  it('the authority boundary: NO EXECUTE anywhere, executionAuthority none, EXECUTE prohibited', () => {
    const boundary = TRADING_DIRECTOR_BODY.bodyVersion.composition.authorityBoundary;
    expect(boundary.allowedActions).not.toContain('EXECUTE');
    expect(boundary.executionAuthority).toBe('none');
    expect(boundary.prohibitedActions).toContain('EXECUTE');
    expect(boundary.allowedActions).toEqual(
      expect.arrayContaining(['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REQUEST', 'LEARN', 'REPORT', 'ESCALATE']),
    );
  });

  it('the L16 declarations: strategic clock, order-level control prohibited, no order tools', () => {
    expect(TRADING_DIRECTOR_BODY.director.clock).toBe('strategic');
    expect(TRADING_DIRECTOR_BODY.director.authorityScope.orderLevelControl).toBe('prohibited');
    for (const tool of TRADING_DIRECTOR_BODY.bodyVersion.composition.knowledgeToolPolicy.allowedTools) {
      expect(/(order|execution|trade|position)-/i.test(tool)).toBe(false);
    }
    expect(TRADING_DIRECTOR_BODY.bodyVersion.composition.knowledgeToolPolicy.forbiddenTools).toEqual(
      expect.arrayContaining(['tools/order-entry', 'tools/execution-router', 'tools/position-manager']),
    );
  });

  it('the director consumes all four research lanes (D-020) on their real topics', () => {
    expect([...TRADING_DIRECTOR_BODY.director.consumedLanes]).toEqual([
      'sentiment',
      'regime',
      'fundamental',
      'cross-market',
    ]);
    expect(TRADING_DIRECTOR_BODY.director.researchTopics).toEqual({
      sentiment: 'research.sentiment',
      regime: 'research.regime',
      fundamental: 'research.fundamental',
      'cross-market': 'research.crossmarket',
    });
  });
});

describe('THE L8 NEGATIVES (typed errors, extending the researchers\' validators)', () => {
  it('EXECUTE in allowedActions is execution_authority_granted', () => {
    const errors = validateTradingDirectorBody(executionGrantedBodySpec());
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('execution_authority_granted');
    const granted = errors.find((e) => e.code === 'execution_authority_granted');
    expect(granted?.path).toContain('allowedActions');
    expect(granted?.message).toContain('L8');
  });

  it('executionAuthority != none is execution_authority_granted', () => {
    const errors = validateTradingDirectorBody(externalGatewayBodySpec());
    expect(errors.map((e) => e.code)).toContain('execution_authority_granted');
    expect(errors.map((e) => e.path)).toEqual(expect.arrayContaining([expect.stringContaining('executionAuthority')]));
  });

  it('EXECUTE absent from prohibitedActions is execute_not_prohibited', () => {
    const errors = validateTradingDirectorBody(executeNotProhibitedBodySpec());
    expect(errors.map((e) => e.code)).toContain('execute_not_prohibited');
  });

  it('a consequential tool in a procedure is consequential_tool_in_procedure (and the forbidden tool is refused)', () => {
    const errors = validateTradingDirectorBody(consequentialToolBodySpec());
    expect(errors.map((e) => e.code)).toContain('consequential_tool_in_procedure');
    // the same doctored spec also violates the allowed/forbidden tool
    // disjointness (order-entry is both allowed and forbidden there).
    expect(errors.map((e) => e.code)).toContain('invalid_field');
    // a tool NOT in the allowed policy cited by a procedure step is the
    // forbidden_tool_in_procedure typed error (position-manager is
    // declared forbidden, never allowed).
    const forbiddenCiting = {
      ...TRADING_DIRECTOR_BODY,
      bodyVersion: {
        ...TRADING_DIRECTOR_BODY.bodyVersion,
        composition: {
          ...TRADING_DIRECTOR_BODY.bodyVersion.composition,
          procedures: TRADING_DIRECTOR_BODY.bodyVersion.composition.procedures.map((procedure) => ({
            ...procedure,
            steps: procedure.steps.map((step) =>
              step.id === 'publish'
                ? { ...step, toolRefs: [...step.toolRefs, 'tools/position-manager' as never] }
                : step,
            ),
          })),
        },
      },
    };
    const forbiddenErrors = validateTradingDirectorBody(forbiddenCiting);
    const forbiddenCodes = forbiddenErrors.map((e) => e.code);
    expect(forbiddenCodes).toContain('forbidden_tool_in_procedure');
    expect(forbiddenCodes).toContain('consequential_tool_in_procedure');
  });

  it('a non-decision capability category is non_director_capability', () => {
    const errors = validateTradingDirectorBody(nonDecisionCapabilityBodySpec());
    expect(errors.map((e) => e.code)).toContain('non_director_capability');
  });

  it('an edited authority-scope record is execution_authority_granted (fixed by law)', () => {
    const errors = validateTradingDirectorBody(editedAuthorityScopeBodySpec());
    expect(errors.map((e) => e.code)).toContain('execution_authority_granted');
  });
});

describe('THE L16 NEGATIVES (strategic/execution separation)', () => {
  it('an authority scope granting ORDER-LEVEL CONTROL is order_level_control', () => {
    const errors = validateTradingDirectorBody(orderLevelControlBodySpec());
    expect(errors.map((e) => e.code)).toContain('order_level_control');
  });

  it('an order-level CLOCK declaration is order_level_control (a different body, T025, on a different clock)', () => {
    const errors = validateTradingDirectorBody(orderLevelClockBodySpec());
    expect(errors.map((e) => e.code)).toContain('order_level_control');
    expect(errors[0]?.message).toContain('T025');
  });
});

describe('the L16a model-identity ban', () => {
  it('looksLikeModelIdentity detects substrate-shaped refs', () => {
    expect(looksLikeModelIdentity('acme-models/reasoner-2@2026.03')).toBe(true);
    expect(looksLikeModelIdentity('criteria/director/decision-attainment@1')).toBe(false);
    expect(looksLikeModelIdentity('goal/portfolio-direction')).toBe(false);
  });

  it('a model identity as evaluation evidence is model_identity_as_evidence', () => {
    const errors = validateTradingDirectorBody(modelIdentityEvidenceBodySpec());
    expect(errors.map((e) => e.code)).toContain('model_identity_as_evidence');
  });
});

describe('the reserved-topic law', () => {
  it('a kernel.* decision topic is reserved_publication_topic', () => {
    const errors = validateTradingDirectorBody(reservedTopicBodySpec());
    expect(errors.map((e) => e.code)).toContain('reserved_publication_topic');
  });
});

describe('the mirrored T003 invariants (still enforced)', () => {
  it('a duplicate capability id is refused', () => {
    const capabilities = TRADING_DIRECTOR_BODY.bodyVersion.composition.capabilities;
    const spec = {
      ...TRADING_DIRECTOR_BODY,
      bodyVersion: {
        ...TRADING_DIRECTOR_BODY.bodyVersion,
        composition: {
          ...TRADING_DIRECTOR_BODY.bodyVersion.composition,
          capabilities: [...capabilities, capabilities[0] as never],
        },
      },
    };
    const errors = validateTradingDirectorBody(spec);
    expect(errors.map((e) => e.message)).toEqual(expect.arrayContaining([expect.stringContaining('capability ids must be unique')]));
  });

  it('a doctored canonical id is refused', () => {
    const spec = {
      ...TRADING_DIRECTOR_BODY,
      bodyVersion: { ...TRADING_DIRECTOR_BODY.bodyVersion, id: 'trading-director@9.9.9' },
    };
    const errors = validateTradingDirectorBody(spec);
    expect(errors.map((e) => e.message)).toEqual(expect.arrayContaining([expect.stringContaining('canonical identity')]));
  });

  it('a consumed-lanes list missing a lane is refused (all four, D-020)', () => {
    const spec = {
      ...TRADING_DIRECTOR_BODY,
      director: {
        ...TRADING_DIRECTOR_BODY.director,
        consumedLanes: ['sentiment', 'regime', 'fundamental'],
      },
    };
    const errors = validateTradingDirectorBody(spec);
    expect(errors.map((e) => e.message)).toEqual(expect.arrayContaining([expect.stringContaining('cross-market')]));
  });

  it('hostile input never throws (total validation)', () => {
    for (const hostile of [null, 42, 'spec', {}, { bodyVersion: null, director: null }]) {
      expect(() => validateTradingDirectorBody(hostile)).not.toThrow();
      expect(validateTradingDirectorBody(hostile).length).toBeGreaterThan(0);
    }
  });
});
