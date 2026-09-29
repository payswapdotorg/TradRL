// @tradrl/body-execution — intake tests: the order-lane mirrors (T019's
// decisions/fills/switch, T020's limit states, the order intent) and
// THE INTAKE GATE (approve-only authority, L12 scope, causality).

import { describe, expect, it } from 'vitest';
import type { TimestampMs } from './primitives';
import {
  FIXTURE_APPROVE_DECISION,
  FIXTURE_INTAKE,
  FIXTURE_INTENT,
  FIXTURE_LIMIT_STATES,
  FIXTURE_REFUSAL_INTAKE,
  FIXTURE_STANDING_SWITCH,
  FIXTURE_THROWN_SWITCH,
  FIXTURE_T0,
  FIXTURE_TENANT,
  FIXTURE_PROJECT,
} from './fixtures';
import {
  acceptExecutionIntake,
  isApprovedDecisionMirror,
  isCheckResultMirror,
  isExecutionDecisionMirror,
  isExecutionLineageMirror,
  isKillSwitchStandingStateMirror,
  isLimitStateMirror,
  isOrderIntentMirror,
  isPolicyVersionRefMirror,
  isRefusalDecisionMirror,
  isSimulatedFillMirror,
  isTimestampMirror,
  isSimulationFidelityMirror,
  validateExecutionIntake,
  validateFillEvidence,
  ORDER_SIDES_MIRROR,
  CORE_ORDER_KINDS_MIRROR,
  CORE_TIME_IN_FORCE_MIRROR,
  PRE_TRADE_CHECK_KINDS_MIRROR,
} from './intake';

describe('the order-intent mirror (the final request form)', () => {
  it('the fixture intent validates', () => {
    expect(isOrderIntentMirror(FIXTURE_INTENT)).toBe(true);
    expect(FIXTURE_INTENT.quantity).toBe('0.75');
  });

  it('the core kind/price matrix and TIF/expiry discipline are enforced', () => {
    expect(isOrderIntentMirror({ ...FIXTURE_INTENT, kind: 'market', price: '50000.00' })).toBe(false);
    expect(isOrderIntentMirror({ ...FIXTURE_INTENT, kind: 'stop', price: '50000.00', stopPrice: '49000.00' })).toBe(false);
    expect(isOrderIntentMirror({ ...FIXTURE_INTENT, kind: 'stop', price: undefined, stopPrice: '49000.00' })).toBe(true);
    expect(isOrderIntentMirror({ ...FIXTURE_INTENT, timeInForce: 'gtt' })).toBe(false); // gtt requires expiresAt
    expect(isOrderIntentMirror({ ...FIXTURE_INTENT, timeInForce: 'gtt', expiresAt: '2023-11-15T00:00:00Z' })).toBe(true);
    expect(isOrderIntentMirror({ ...FIXTURE_INTENT, quantity: '00.75' })).toBe(false); // canonical grammar
    expect(isOrderIntentMirror({ ...FIXTURE_INTENT, quantity: 0.75 })).toBe(false); // floats refused
    expect(isOrderIntentMirror(null)).toBe(false);
  });

  it('the vocabularies mirror the execution lane (buy/sell, four kinds, five TIFs, seven checks)', () => {
    expect([...ORDER_SIDES_MIRROR]).toEqual(['buy', 'sell']);
    expect([...CORE_ORDER_KINDS_MIRROR]).toEqual(['market', 'limit', 'stop', 'stop-limit']);
    expect([...CORE_TIME_IN_FORCE_MIRROR]).toEqual(['day', 'gtc', 'ioc', 'fok', 'gtt']);
    expect([...PRE_TRADE_CHECK_KINDS_MIRROR]).toEqual([
      'kill_switch', 'identity', 'authorization', 'limits', 'venue_permissions', 'rate_limits', 'credentials',
    ]);
  });

  it('the timestamp mirror validates RFC3339 with mandatory offsets', () => {
    expect(isTimestampMirror('2023-11-14T22:13:20.000Z')).toBe(true);
    expect(isTimestampMirror('2023-13-14T22:13:20Z')).toBe(false); // month 13
    expect(isTimestampMirror('2023-02-30T00:00:00Z')).toBe(false); // Feb 30
    expect(isTimestampMirror('2024-02-29T00:00:00Z')).toBe(true); // leap year
    expect(isTimestampMirror('2023-02-29T00:00:00Z')).toBe(false);
  });
});

describe('the gate-decision mirrors', () => {
  it('the fixture APPROVE decision validates; REFUSE validates as its own kind', () => {
    expect(isApprovedDecisionMirror(FIXTURE_APPROVE_DECISION)).toBe(true);
    expect(isRefusalDecisionMirror(FIXTURE_APPROVE_DECISION)).toBe(false);
    const refusal = FIXTURE_REFUSAL_INTAKE.decision;
    expect(isRefusalDecisionMirror(refusal)).toBe(true);
    expect(isApprovedDecisionMirror(refusal)).toBe(false);
    expect(isExecutionDecisionMirror(FIXTURE_APPROVE_DECISION)).toBe(true);
    expect(isExecutionDecisionMirror(refusal)).toBe(true);
    expect(isExecutionDecisionMirror({ kind: 'maybe' })).toBe(false);
  });

  it('the nested mirrors validate', () => {
    expect(isPolicyVersionRefMirror({ policyId: 'xpol:fixture', version: 1 })).toBe(true);
    expect(isPolicyVersionRefMirror({ policyId: '', version: 0 })).toBe(false);
    expect(isExecutionLineageMirror(FIXTURE_APPROVE_DECISION.lineage)).toBe(true);
    expect(isExecutionLineageMirror({ ...FIXTURE_APPROVE_DECISION.lineage, venues: [] })).toBe(false);
    expect(isCheckResultMirror({ dimension: 'identity', ordinal: 1, outcome: 'pass' })).toBe(true);
    expect(isCheckResultMirror({ dimension: 'identity', ordinal: 0, outcome: 'pass' })).toBe(false);
  });

  it('an approve decision with a failing check is NOT an approve mirror (all checks must pass)', () => {
    const doctored = JSON.parse(JSON.stringify(FIXTURE_APPROVE_DECISION)) as Record<string, unknown>;
    const checks = doctored.checks as { outcome: string }[];
    checks[0].outcome = 'fail';
    expect(isApprovedDecisionMirror(doctored)).toBe(false);
  });
});

describe('the kill-switch standing-state mirror (the injected fact)', () => {
  it('standing and thrown both validate with their evidence laws', () => {
    expect(isKillSwitchStandingStateMirror(FIXTURE_STANDING_SWITCH)).toBe(true);
    expect(isKillSwitchStandingStateMirror(FIXTURE_THROWN_SWITCH)).toBe(true);
    // a thrown switch without its evidence is malformed
    expect(isKillSwitchStandingStateMirror({ state: 'thrown', switchId: null, thrownAt: null, reason: null })).toBe(false);
    expect(isKillSwitchStandingStateMirror({ state: 'standing', switchId: 'ksw:1', thrownAt: null, reason: null })).toBe(false);
    expect(isKillSwitchStandingStateMirror({ state: 'disarmed' })).toBe(false);
  });
});

describe('the simulated-fill mirror (the fill evidence)', () => {
  it('the fidelity modes are the two honest simulated ones — NEVER live', () => {
    expect(isSimulationFidelityMirror('paper_venue')).toBe(true);
    expect(isSimulationFidelityMirror('simulated_matching')).toBe(true);
    expect(isSimulationFidelityMirror('live')).toBe(false);
  });

  it('the fixture fill shape validates through the mirror', () => {
    const fill = {
      fillId: 'xsf-00000001',
      sequence: 1,
      venue: 'REFSIM',
      instrument: 'BTC-USD',
      side: 'buy',
      price: '50000.00',
      aggressorPrice: '50010.00',
      quantity: '0.5',
      fee: '20.00',
      latencyMs: 500,
      decisionId: 'xd:0a1b2c3d4e5f6071',
      intentRef: 'si:fixture0001',
      fidelity: 'paper_venue',
      venueLineage: {
        configDigest: '0123abcd',
        engineOrderRef: 'xo-000001',
        engineFillRef: 'xsf-00000001',
        feesRef: 'fees:ref',
        latencyRef: 'latency:ref',
        slippageRef: 'slip:ref',
        impactRef: 'impact:ref',
      },
      lineage: FIXTURE_APPROVE_DECISION.lineage,
      tenant: 'tenant-alpha',
      project: 'project-one',
      asOf: FIXTURE_T0 + 1_200,
    };
    expect(isSimulatedFillMirror(fill)).toBe(true);
    expect(isSimulatedFillMirror({ ...fill, fillId: 'fill-1' })).toBe(false);
    expect(isSimulatedFillMirror({ ...fill, fidelity: 'live' })).toBe(false);
    expect(isSimulatedFillMirror({ ...fill, venueLineage: { ...fill.venueLineage, configDigest: 'nothex' } })).toBe(false);
  });

  it('validateFillEvidence enforces the L12 scope and the decision binding', () => {
    const fill = {
      fillId: 'xsf-00000001',
      sequence: 1,
      venue: 'REFSIM',
      instrument: 'BTC-USD',
      side: 'buy',
      price: '50000.00',
      aggressorPrice: '50010.00',
      quantity: '0.5',
      fee: '20.00',
      latencyMs: 500,
      decisionId: 'xd:0a1b2c3d4e5f6071',
      intentRef: 'si:fixture0001',
      fidelity: 'paper_venue',
      venueLineage: {
        configDigest: '0123abcd',
        engineOrderRef: 'xo-000001',
        engineFillRef: 'xsf-00000001',
        feesRef: 'fees:ref',
        latencyRef: 'latency:ref',
        slippageRef: 'slip:ref',
        impactRef: 'impact:ref',
      },
      lineage: FIXTURE_APPROVE_DECISION.lineage,
      tenant: 'tenant-alpha',
      project: 'project-one',
      asOf: FIXTURE_T0 + 1_200,
    };
    const scope = { tenant: FIXTURE_TENANT, project: FIXTURE_PROJECT, decision: 'xd:0a1b2c3d4e5f6071' };
    expect(validateFillEvidence(fill, scope)).toEqual([]);
    expect(validateFillEvidence(fill, { ...scope, tenant: 'tenant-beta' as never })[0]?.code).toBe('tenant_mismatch');
    expect(validateFillEvidence(fill, { ...scope, project: 'project-two' as never })[0]?.code).toBe('project_mismatch');
    expect(validateFillEvidence(fill, { ...scope, decision: 'xd:other' })[0]?.code).toBe('fill_ref_mismatch');
    expect(validateFillEvidence('not-a-fill', scope)[0]?.code).toBe('invalid_field');
  });
});

describe('the risk limit-state mirror (T020)', () => {
  it('the fixture limit states validate', () => {
    for (const state of FIXTURE_LIMIT_STATES) {
      expect(isLimitStateMirror(state)).toBe(true);
    }
  });

  it('unknown kinds and malformed scopes are rejected', () => {
    expect(isLimitStateMirror({ ...FIXTURE_LIMIT_STATES[0], kind: 'vibes' })).toBe(false);
    expect(isLimitStateMirror({ ...FIXTURE_LIMIT_STATES[0], scope: { kind: 'instrument', venue: '' } })).toBe(false);
    expect(isLimitStateMirror({ ...FIXTURE_LIMIT_STATES[1], scope: { kind: 'weird' } })).toBe(false);
  });
});

describe('THE INTAKE GATE', () => {
  const scope = { tenant: FIXTURE_TENANT, project: FIXTURE_PROJECT };
  const at = (t: number): TimestampMs => t as TimestampMs;

  it('the golden intake passes cleanly', () => {
    expect(validateExecutionIntake(FIXTURE_INTAKE, scope, at(FIXTURE_T0 + 50))).toEqual([]);
    const accepted = acceptExecutionIntake(FIXTURE_INTAKE, scope, at(FIXTURE_T0 + 50));
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.value.decision.decisionId).toBe(FIXTURE_APPROVE_DECISION.decisionId);
      expect(accepted.value.directorDecision).toBe('dd-9f8e7d6c5b4a3021');
    }
  });

  it('THE L8 LAW: a REFUSAL decision is a record, never authority (decision_not_approved)', () => {
    const errors = validateExecutionIntake(FIXTURE_REFUSAL_INTAKE, scope, at(FIXTURE_T0 + 50));
    expect(errors.some((e) => e.code === 'decision_not_approved')).toBe(true);
    expect(errors[0]?.message).toContain('REFUSED');
  });

  it('THE L8 LAW: a non-decision is not authority either', () => {
    const errors = validateExecutionIntake(
      { ...FIXTURE_INTAKE, decision: { kind: 'approve' } },
      scope,
      at(FIXTURE_T0 + 50),
    );
    expect(errors.some((e) => e.code === 'decision_not_approved')).toBe(true);
  });

  it('THE L12 LAWS: scope mismatches are typed errors', () => {
    const tenantErrors = validateExecutionIntake(FIXTURE_INTAKE, { tenant: 'tenant-beta' as never, project: FIXTURE_PROJECT }, at(FIXTURE_T0 + 50));
    expect(tenantErrors.some((e) => e.code === 'tenant_mismatch')).toBe(true);
    const projectErrors = validateExecutionIntake(FIXTURE_INTAKE, { tenant: FIXTURE_TENANT, project: 'project-two' as never }, at(FIXTURE_T0 + 50));
    expect(projectErrors.some((e) => e.code === 'project_mismatch')).toBe(true);
  });

  it('THE CAUSALITY LAW: a preparation instant before the decision is timestamp_order', () => {
    const errors = validateExecutionIntake(FIXTURE_INTAKE, scope, at(FIXTURE_T0 - 1));
    expect(errors.some((e) => e.code === 'timestamp_order')).toBe(true);
  });

  it('THE INTENT-BINDING LAW: a decision whose intent ref does not bind the intent fails (lineage_missing)', () => {
    const doctored = JSON.parse(JSON.stringify(FIXTURE_INTAKE));
    (doctored as { decision: { intentRef: string } }).decision.intentRef = 'si:someone-elses-intent';
    const errors = validateExecutionIntake(doctored, scope, at(FIXTURE_T0 + 50));
    expect(errors.some((e) => e.code === 'lineage_missing')).toBe(true);
  });

  it('malformed bundles, intents, switches and limit states all report (collect-all)', () => {
    const broken = validateExecutionIntake(
      {
        decision: 'nope',
        intent: 'nope',
        killSwitch: 'nope',
        limitStates: ['nope'],
        directorDecision: 'not-dd',
      },
      scope,
      at(FIXTURE_T0 + 50),
    );
    expect(broken.length).toBeGreaterThanOrEqual(5);
    expect(broken.some((e) => e.code === 'decision_not_approved')).toBe(true);
    expect(broken.some((e) => e.code === 'invalid_field')).toBe(true);
    expect(validateExecutionIntake(null, scope, at(FIXTURE_T0 + 50))[0]?.code).toBe('invalid_type');
  });
});
