// @tradrl/body-execution — ids tests: the owned identity spaces, the
// opaque cross-lane refs, and the order-lane prefix-guarded mirrors.

import { describe, expect, it } from 'vitest';
import {
  bodyVersionRef,
  cancelConfirmationRef,
  decisionRef,
  directorDecisionRef,
  fillRef,
  intentRef,
  killSwitchRef,
  methodId,
  methodVersionRef,
  orderLifecycleId,
  orderRef,
  escalationRecordId,
  reconciliationRecordId,
  gatewayRequestRef,
  tenantId,
  projectId,
  isBodyVersionRef,
  isCancelConfirmationRef,
  isDecisionRef,
  isDirectorDecisionRef,
  isEscalationRecordId,
  isFillRef,
  isGatewayRequestRef,
  isIntentRef,
  isKillSwitchRef,
  isMethodId,
  isMethodVersionRef,
  isOrderLifecycleId,
  isOrderRef,
  isReconciliationRecordId,
  isTopicName,
  isAgentInstanceId,
  isEvaluationCriteriaRef,
  isTenantId,
  isProjectId,
} from './ids';

describe('the owned identity spaces', () => {
  it('lifecycle/escalation/reconciliation/request ids follow the compact identifier pattern', () => {
    expect(isOrderLifecycleId('ol-0123456789abcdef')).toBe(true);
    expect(isOrderLifecycleId('')).toBe(false);
    expect(isEscalationRecordId('esc-0123456789abcdef')).toBe(true);
    expect(isEscalationRecordId('bad id')).toBe(false);
    expect(isReconciliationRecordId('rcn-0123456789abcdef')).toBe(true);
    expect(isReconciliationRecordId('')).toBe(false);
    expect(isGatewayRequestRef('gwr-0123456789abcdef')).toBe(true);
    expect(isGatewayRequestRef('bad id')).toBe(false);
    expect(isOrderRef('t025-fx-001')).toBe(true);
    expect(isOrderRef('')).toBe(false);
  });

  it('method ids are opaque refs; method versions are strict X.Y.Z', () => {
    expect(isMethodId('method/execution/order-preparation')).toBe(true);
    expect(isMethodId('')).toBe(false);
    expect(isMethodVersionRef('1.0.0')).toBe(true);
    expect(isMethodVersionRef('1.0')).toBe(false);
    expect(isMethodVersionRef('1.0.0-alpha')).toBe(false);
    expect(isMethodVersionRef('01.0.0')).toBe(false);
  });

  it('the throwing constructors throw on invalid input', () => {
    expect(() => orderLifecycleId('bad id')).toThrow(TypeError);
    expect(() => escalationRecordId('')).toThrow(TypeError);
    expect(() => reconciliationRecordId('bad id')).toThrow(TypeError);
    expect(() => gatewayRequestRef('')).toThrow(TypeError);
    expect(() => orderRef('bad id')).toThrow(TypeError);
    expect(() => methodId('')).toThrow(TypeError);
    expect(() => methodVersionRef('1.0')).toThrow(TypeError);
    expect(() => tenantId('')).toThrow(TypeError);
    expect(() => projectId('')).toThrow(TypeError);
    expect(() => bodyVersionRef('execution-1.0.0')).toThrow(TypeError);
    expect(() => decisionRef('xdx:1')).toThrow(TypeError);
    expect(() => intentRef('si')).toThrow(TypeError);
    expect(() => directorDecisionRef('xd:1')).toThrow(TypeError);
    expect(() => killSwitchRef('ksw')).toThrow(TypeError);
    expect(() => fillRef('xs-1')).toThrow(TypeError);
    expect(() => cancelConfirmationRef('conf')).toThrow(TypeError);
  });
});

describe('the mirrored cross-lane identities (opaque refs)', () => {
  it('tenant/project are non-empty strings; body-version refs are canonical', () => {
    expect(isTenantId('tenant-alpha')).toBe(true);
    expect(isTenantId('')).toBe(false);
    expect(isProjectId('project-one')).toBe(true);
    expect(isProjectId('')).toBe(false);
    expect(isBodyVersionRef('execution@1.0.0')).toBe(true);
    expect(isBodyVersionRef('execution@1.0')).toBe(false);
    expect(isBodyVersionRef('execution@01.0.0')).toBe(false);
    expect(isBodyVersionRef('trading-director@1.2.3-beta.1+build')).toBe(true);
  });

  it('topic names and agent instance ids follow the compact identifier pattern', () => {
    expect(isTopicName('execution.lifecycle-reports')).toBe(true);
    expect(isTopicName('has space')).toBe(false);
    expect(isAgentInstanceId('agent-instance-execution-0001')).toBe(true);
    expect(isAgentInstanceId('')).toBe(false);
    expect(isEvaluationCriteriaRef('criteria/execution/lifecycle-attainment@1')).toBe(true);
    expect(isEvaluationCriteriaRef('')).toBe(false);
  });
});

describe('THE ORDER-LANE PREFIX-GUARDED refs (the thin mirrors)', () => {
  it('decision refs require the xd: prefix (T019\'s DecisionId space)', () => {
    expect(isDecisionRef('xd:0a1b2c3d4e5f6071')).toBe(true);
    expect(isDecisionRef('dd-123')).toBe(false);
    expect(isDecisionRef('')).toBe(false);
    expect(isDecisionRef(42)).toBe(false);
  });

  it('intent refs require the si: prefix (T018\'s StrategyIntent space)', () => {
    expect(isIntentRef('si:fixture0001')).toBe(true);
    expect(isIntentRef('xd:fixture')).toBe(false);
    expect(isIntentRef('')).toBe(false);
  });

  it('director decision refs require the dd- prefix (T024\'s DirectorDecisionId space)', () => {
    expect(isDirectorDecisionRef('dd-9f8e7d6c5b4a3021')).toBe(true);
    expect(isDirectorDecisionRef('xd:1')).toBe(false);
    expect(isDirectorDecisionRef('')).toBe(false);
  });

  it('kill-switch refs require the ksw: prefix (T019\'s KillSwitchId space)', () => {
    expect(isKillSwitchRef('ksw:1a2b3c4d')).toBe(true);
    expect(isKillSwitchRef('ks:1')).toBe(false);
    expect(isKillSwitchRef('')).toBe(false);
  });

  it('fill refs require the xsf- prefix (T019\'s SimulatedFillId space)', () => {
    expect(isFillRef('xsf-00000001')).toBe(true);
    expect(isFillRef('xsf')).toBe(false);
    expect(isFillRef('fill-1')).toBe(false);
  });

  it('cancel confirmation refs require the confirm: prefix (the gateway\'s space)', () => {
    expect(isCancelConfirmationRef('confirm:cancel-0001')).toBe(true);
    expect(isCancelConfirmationRef('cancel-0001')).toBe(false);
    expect(isCancelConfirmationRef('')).toBe(false);
  });
});
