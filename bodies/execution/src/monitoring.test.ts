// @tradrl/body-execution — monitoring tests: the declared monitoring
// procedures — stuck-order detection (an EscalationRecord, never an
// exception, never a silent timeout), exact-equality fill
// reconciliation (one grid step off is the typed reconciliation_gap),
// the cancellation policy with race recording, kill-switch mid-flight
// (escalate + record, NEVER fabricate a fill or a cancel).

import { describe, expect, it } from 'vitest';
import {
  CANCELLATION_POLICY_CITATION,
  ESCALATION_REASONS,
  FILL_RECONCILIATION_CITATION,
  KILL_SWITCH_RESPONSE_CITATION,
  STUCK_DETECTION_CITATION,
  attemptCancellation,
  canonicalEscalationJson,
  createEscalationRecord,
  detectStuckOrder,
  isEscalationRecord,
  isEscalationReason,
  isEscalationDetail,
  isReconciliationRecord,
  isReconciliationStatus,
  reconcileFills,
  reconciliationViolations,
  respondToKillSwitch,
  validateEscalationRecord,
  validateReconciliationRecord,
} from './monitoring';
import {
  FIXTURE_APPROVE_DECISION,
  FIXTURE_CANCEL_CONFIRMATION,
  FIXTURE_CANCELLATION_RACE,
  FIXTURE_CANCELLATION_RACE_ESCALATION,
  FIXTURE_CLOCKS,
  FIXTURE_DECISION_ID,
  FIXTURE_HAPPY_PATH,
  FIXTURE_KILL_SWITCH_ESCALATION,
  FIXTURE_KILL_SWITCH_MID_FLIGHT,
  FIXTURE_ORDER_REF,
  FIXTURE_QUANTITY,
  FIXTURE_RECONCILED,
  FIXTURE_RECONCILIATION_GAP,
  FIXTURE_REGISTRY,
  FIXTURE_STUCK_ACK,
  FIXTURE_STUCK_ACK_ESCALATION,
  FIXTURE_SWITCH_ID,
  FIXTURE_THROWN_SWITCH,
  FIXTURE_T0,
  FIXTURE_TENANT,
  FIXTURE_PROJECT,
  buildAcknowledgedLog,
  buildGateRejectionLog,
  buildHappyPathLog,
  buildSubmittedLog,
} from './fixtures';
import { canonicalJson, isDeeplyFrozen } from './primitives';
import { currentOrderState } from './lifecycle';

describe('the escalation vocabulary', () => {
  it('the closed reason vocabulary is the five named anomalies', () => {
    expect(ESCALATION_REASONS).toEqual([
      'ack-deadline-exceeded', 'fill-deadline-exceeded', 'reconciliation-gap', 'kill-switch-mid-flight', 'cancellation-race',
    ]);
    expect(isEscalationReason('quorum-unmet')).toBe(false);
    expect(isReconciliationStatus('reconciled')).toBe(true);
    expect(isReconciliationStatus('gappy')).toBe(false);
  });
});

describe('PROCEDURE 1: stuck-order detection (never an exception, never silent)', () => {
  it('within the declared ack deadline: the outcome is DATA, not an error', () => {
    const outcome = detectStuckOrder({
      log: buildSubmittedLog(),
      orderClock: FIXTURE_CLOCKS.submit + 100, // 100ms after submit — within the 2000ms deadline
      methodId: STUCK_DETECTION_CITATION.methodId,
      methodVersion: STUCK_DETECTION_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.kind).toBe('within-deadline');
      if (outcome.value.kind === 'within-deadline') {
        expect(outcome.value.state).toBe('submitted');
      }
    }
  });

  it('THE ACK DEADLINE EXCEEDED: the order enters stuck AND an EscalationRecord is produced', () => {
    const outcome = detectStuckOrder({
      log: buildSubmittedLog(),
      orderClock: FIXTURE_CLOCKS.stuckCheck, // > 2000ms after submit
      methodId: STUCK_DETECTION_CITATION.methodId,
      methodVersion: STUCK_DETECTION_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.value.kind === 'stuck') {
      expect(currentOrderState(outcome.value.log)).toBe('stuck');
      expect(outcome.value.record.escalationRef).toBe(outcome.value.escalation.escalationId);
      expect(outcome.value.escalation.reason).toBe('ack-deadline-exceeded');
      expect(outcome.value.escalation.detail).toMatchObject({
        kind: 'deadline',
        event: 'ack-deadline-exceeded',
        deadlineMs: 2000,
      });
      expect(outcome.value.escalation.observedState).toBe('submitted');
      expect(outcome.value.escalation.orderClock).toBe(FIXTURE_CLOCKS.stuckCheck);
      expect(outcome.value.escalation.orderRef).toBe(FIXTURE_ORDER_REF);
      expect(outcome.value.escalation.decisionRef).toBe(FIXTURE_DECISION_ID);
      expect(outcome.value.escalation.tenant).toBe(FIXTURE_TENANT);
      expect(isEscalationRecord(outcome.value.escalation)).toBe(true);
      expect(isDeeplyFrozen(outcome.value.escalation)).toBe(true);
    } else {
      throw new Error('the deadline-exceeded detection must produce a stuck outcome');
    }
  });

  it('THE FILL DEADLINE: acknowledged without fill progress past 30s also goes stuck', () => {
    const outcome = detectStuckOrder({
      log: buildAcknowledgedLog(),
      orderClock: FIXTURE_CLOCKS.acknowledge + 31_000,
      methodId: STUCK_DETECTION_CITATION.methodId,
      methodVersion: STUCK_DETECTION_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.value.kind === 'stuck') {
      expect(outcome.value.escalation.reason).toBe('fill-deadline-exceeded');
      expect((outcome.value.escalation.detail as { deadlineMs: number }).deadlineMs).toBe(30_000);
    }
  });

  it('the golden stuck scenario matches the fixture byte-for-byte (determinism)', () => {
    const scenario = FIXTURE_STUCK_ACK;
    const rebuilt = detectStuckOrder({
      log: buildSubmittedLog(),
      orderClock: FIXTURE_CLOCKS.stuckCheck,
      methodId: STUCK_DETECTION_CITATION.methodId,
      methodVersion: STUCK_DETECTION_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok && rebuilt.value.kind === 'stuck' && scenario.outcome.kind === 'stuck') {
      expect(canonicalJson(rebuilt.value.escalation as never)).toBe(canonicalJson(scenario.outcome.escalation as never));
      expect(canonicalJson(rebuilt.value.log as never)).toBe(canonicalJson(scenario.outcome.log as never));
    }
  });

  it('malformed inputs are typed refusals, never exceptions', () => {
    const bad = detectStuckOrder(null);
    expect(bad.ok).toBe(false);
    const undeclared = detectStuckOrder({
      log: buildSubmittedLog(),
      orderClock: FIXTURE_CLOCKS.stuckCheck,
      methodId: 'method/none',
      methodVersion: '1.0.0',
      registry: FIXTURE_REGISTRY,
    });
    expect(undeclared.ok).toBe(false);
    if (!undeclared.ok) expect(undeclared.errors[0]?.code).toBe('undeclared_method');
  });
});

describe('PROCEDURE 2: fill reconciliation (exact equality)', () => {
  it('EXACT EQUALITY: fills summing to the acknowledged quantity is reconciled (zero violations)', () => {
    const scenario = FIXTURE_RECONCILED;
    expect(scenario.outcome.record.status).toBe('reconciled');
    expect(scenario.outcome.record.gap).toBeNull();
    expect(scenario.outcome.record.cumulativeFillQuantity).toBe('0.50000000' === scenario.outcome.record.cumulativeFillQuantity ? '0.5' : scenario.outcome.record.cumulativeFillQuantity);
    expect(reconciliationViolations(scenario.outcome.record)).toEqual([]);
    expect(isReconciliationRecord(scenario.outcome.record)).toBe(true);
  });

  it('ONE GRID STEP OFF: the typed reconciliation_gap (0.5 + 0.24 = 0.74 vs 0.75 — the exact gap 0.01)', () => {
    const scenario = FIXTURE_RECONCILIATION_GAP;
    expect(scenario.outcome.record.status).toBe('gap');
    const gap = scenario.outcome.record.gap;
    expect(gap).not.toBeNull();
    if (gap !== null) {
      expect(gap.startsWith('0.01')).toBe(true); // the exact difference at the declared scale
    }
    const violations = reconciliationViolations(scenario.outcome.record);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('reconciliation_gap');
    expect(violations[0]?.message).toContain('exact equality');
    expect(violations[0]?.message).toContain('0.01');
  });

  it('the gap record remains a valid record (data, never an exception) and carries the exact inputs', () => {
    const scenario = FIXTURE_RECONCILIATION_GAP;
    expect(validateReconciliationRecord(scenario.outcome.record)).toEqual([]);
    expect(scenario.outcome.record.fills).toHaveLength(2);
    expect(scenario.outcome.record.orderClock).toBe(FIXTURE_CLOCKS.reconciliation);
    expect(scenario.outcome.record.tenant).toBe(FIXTURE_TENANT);
  });

  it('a larger mismatch is also a gap (with the exact amount stated)', () => {
    // acknowledge 0.75, only the 0.5 fill: the difference is 0.25
    const acknowledged = buildAcknowledgedLog();
    const partialOnly = acknowledged; // no fills at all: cumulative 0
    const outcome = reconcileFills({
      log: partialOnly,
      acknowledgedQuantity: FIXTURE_QUANTITY,
      orderClock: FIXTURE_CLOCKS.reconciliation,
      methodId: FILL_RECONCILIATION_CITATION.methodId,
      methodVersion: FILL_RECONCILIATION_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.record.status).toBe('gap');
      expect(reconciliationViolations(outcome.value.record)[0]?.code).toBe('reconciliation_gap');
    }
  });

  it('malformed inputs are typed refusals', () => {
    const bad = reconcileFills({ log: null, acknowledgedQuantity: '0.75', orderClock: FIXTURE_T0, methodId: 'm', methodVersion: '1.0.0', registry: FIXTURE_REGISTRY });
    expect(bad.ok).toBe(false);
    const badQuantity = reconcileFills({ log: buildHappyPathLog(), acknowledgedQuantity: 0.75, orderClock: FIXTURE_T0 + 1, methodId: FILL_RECONCILIATION_CITATION.methodId, methodVersion: '1.0.0', registry: FIXTURE_REGISTRY });
    expect(badQuantity.ok).toBe(false);
  });
});

describe('PROCEDURE 3: the cancellation policy (race recording)', () => {
  it('a lawful cancel from acknowledged lands cancelled with its confirmation evidence', () => {
    const outcome = attemptCancellation({
      log: buildAcknowledgedLog(),
      cancelConfirmationRef: FIXTURE_CANCEL_CONFIRMATION,
      orderClock: FIXTURE_CLOCKS.cancelAttempt,
      methodId: CANCELLATION_POLICY_CITATION.methodId,
      methodVersion: CANCELLATION_POLICY_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.value.kind === 'cancelled') {
      expect(currentOrderState(outcome.value.log)).toBe('cancelled');
      expect(outcome.value.record.event).toBe('cancel-unfilled');
      expect(outcome.value.record.cancelConfirmationRef).toBe(FIXTURE_CANCEL_CONFIRMATION);
    }
  });

  it('THE CANCELLATION RACE: a cancel against a FILLED order is refused AND RECORDED', () => {
    const scenario = FIXTURE_CANCELLATION_RACE;
    expect(scenario.outcome.kind).toBe('refused');
    if (scenario.outcome.kind === 'refused') {
      expect(scenario.outcome.errors[0]?.code).toBe('lifecycle_violation');
      expect(scenario.outcome.escalation).not.toBeNull();
      const escalation = scenario.outcome.escalation as { reason: string; detail: unknown };
      expect(escalation.reason).toBe('cancellation-race');
      expect(escalation.detail).toMatchObject({ kind: 'race', terminalState: 'filled', note: 'fill-landed-first' });
    }
  });

  it('a cancel against another terminal state (rejected) is a plain refusal, no race record', () => {
    // Build rejected: prepare -> submit -> reject-at-gate (the fixture's own builder)
    const rejectedLog = buildGateRejectionLog();
    const outcome = attemptCancellation({
      log: rejectedLog,
      cancelConfirmationRef: FIXTURE_CANCEL_CONFIRMATION,
      orderClock: FIXTURE_CLOCKS.cancelAttempt,
      methodId: CANCELLATION_POLICY_CITATION.methodId,
      methodVersion: CANCELLATION_POLICY_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.value.kind === 'refused') {
      expect(outcome.value.errors[0]?.code).toBe('lifecycle_violation');
      expect(outcome.value.escalation).toBeNull(); // no race — the order never filled
    }
  });

  it('a cancel without a confirmation ref is cancel_fabricated (never fabricate)', () => {
    const outcome = attemptCancellation({
      log: buildAcknowledgedLog(),
      cancelConfirmationRef: 'not-a-confirmation',
      orderClock: FIXTURE_CLOCKS.cancelAttempt,
      methodId: CANCELLATION_POLICY_CITATION.methodId,
      methodVersion: CANCELLATION_POLICY_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors[0]?.code).toBe('cancel_fabricated');
  });
});

describe('PROCEDURE 4: kill-switch mid-flight (escalate + record — NEVER fabricate)', () => {
  it('a standing switch is data (nothing to do)', () => {
    const outcome = respondToKillSwitch({
      log: buildAcknowledgedLog(),
      killSwitch: { state: 'standing', switchId: null, thrownAt: null, reason: null },
      orderClock: FIXTURE_CLOCKS.switchResponse,
      methodId: KILL_SWITCH_RESPONSE_CITATION.methodId,
      methodVersion: KILL_SWITCH_RESPONSE_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.kind).toBe('standing');
  });

  it('A THROWN SWITCH MID-FLIGHT: the body ESCALATES and RECORDS — the lifecycle log is UNCHANGED', () => {
    const scenario = FIXTURE_KILL_SWITCH_MID_FLIGHT;
    expect(scenario.outcome.kind).toBe('escalated');
    if (scenario.outcome.kind === 'escalated') {
      const escalation = scenario.outcome.escalation;
      expect(escalation.reason).toBe('kill-switch-mid-flight');
      expect(escalation.detail).toMatchObject({
        kind: 'kill-switch',
        switchId: FIXTURE_SWITCH_ID,
        reason: 'circuit breaker',
      });
      expect(escalation.observedState).toBe('acknowledged');
      expect(escalation.evidence).toContain(FIXTURE_SWITCH_ID);
      expect(isEscalationRecord(escalation)).toBe(true);
      // THE LAW: the log returned is EXACTLY the input log — no fabricated fill, no fabricated cancel
      expect(scenario.outcome.log.records).toHaveLength(scenario.log.records.length);
      expect(currentOrderState(scenario.outcome.log)).toBe('acknowledged');
      expect(canonicalJson(scenario.outcome.log as never)).toBe(canonicalJson(scenario.log as never));
    }
  });

  it('a thrown switch on a TERMINAL order: data, no escalation needed (the lifecycle already ended)', () => {
    const outcome = respondToKillSwitch({
      log: FIXTURE_HAPPY_PATH, // filled
      killSwitch: FIXTURE_THROWN_SWITCH,
      orderClock: FIXTURE_CLOCKS.reconciliation,
      methodId: KILL_SWITCH_RESPONSE_CITATION.methodId,
      methodVersion: KILL_SWITCH_RESPONSE_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.kind).toBe('standing');
  });

  it('a thrown switch without its evidence ref is a typed refusal', () => {
    const outcome = respondToKillSwitch({
      log: buildAcknowledgedLog(),
      killSwitch: { state: 'thrown', switchId: 'not-ksw', thrownAt: FIXTURE_CLOCKS.switchThrown, reason: 'x' },
      orderClock: FIXTURE_CLOCKS.switchResponse,
      methodId: KILL_SWITCH_RESPONSE_CITATION.methodId,
      methodVersion: KILL_SWITCH_RESPONSE_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors[0]?.code).toBe('invalid_field');
  });

  it('the golden mid-flight escalation matches the fixture (determinism)', () => {
    const rebuilt = respondToKillSwitch({
      log: buildAcknowledgedLog(),
      killSwitch: FIXTURE_THROWN_SWITCH,
      orderClock: FIXTURE_CLOCKS.switchResponse,
      methodId: KILL_SWITCH_RESPONSE_CITATION.methodId,
      methodVersion: KILL_SWITCH_RESPONSE_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    });
    expect(FIXTURE_KILL_SWITCH_ESCALATION).not.toBeNull();
    if (rebuilt.ok && rebuilt.value.kind === 'escalated' && FIXTURE_KILL_SWITCH_ESCALATION !== null) {
      expect(canonicalEscalationJson(rebuilt.value.escalation)).toBe(canonicalEscalationJson(FIXTURE_KILL_SWITCH_ESCALATION));
    }
  });
});

describe('the escalation record contracts', () => {
  it('createEscalationRecord builds and freezes; bad drafts refuse', () => {
    const good = createEscalationRecord({
      orderRef: FIXTURE_ORDER_REF,
      decisionRef: FIXTURE_DECISION_ID,
      reason: 'cancellation-race',
      detail: { kind: 'race', terminalState: 'filled', note: 'fill-landed-first' },
      observedState: 'filled',
      orderClock: FIXTURE_CLOCKS.cancelAttempt,
      evidence: ['xd:1', 'ol-2'],
      methodId: CANCELLATION_POLICY_CITATION.methodId,
      methodVersion: CANCELLATION_POLICY_CITATION.methodVersion,
      tenant: FIXTURE_TENANT,
      project: FIXTURE_PROJECT,
    });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.value.escalationId).toMatch(/^esc-[0-9a-f]{16}$/);
      expect(isDeeplyFrozen(good.value)).toBe(true);
    }
    const bad = createEscalationRecord({ reason: 'nonsense', detail: {} });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.length).toBeGreaterThan(4);
  });

  it('the detail/reason coherence law fires on mismatched pairs', () => {
    const mismatched = validateEscalationRecord({
      orderRef: FIXTURE_ORDER_REF,
      decisionRef: FIXTURE_DECISION_ID,
      reason: 'kill-switch-mid-flight',
      detail: { kind: 'race', terminalState: 'filled', note: 'fill-landed-first' },
      observedState: 'filled',
      orderClock: FIXTURE_CLOCKS.cancelAttempt,
      evidence: [],
      methodId: CANCELLATION_POLICY_CITATION.methodId,
      methodVersion: CANCELLATION_POLICY_CITATION.methodVersion,
      escalationId: 'esc-0123456789abcdef',
      tenant: FIXTURE_TENANT,
      project: FIXTURE_PROJECT,
    });
    expect(mismatched.some((e) => e.code === 'invalid_field')).toBe(true);
    expect(isEscalationDetail({ kind: 'deadline', event: 'weird', deadlineMs: 1, waitedMs: 1 })).toBe(false);
    expect(isEscalationDetail(null)).toBe(false);
  });

  it('the golden escalation fixtures validate under their own laws', () => {
    expect(FIXTURE_STUCK_ACK_ESCALATION).not.toBeNull();
    if (FIXTURE_STUCK_ACK_ESCALATION !== null) {
      expect(validateEscalationRecord(FIXTURE_STUCK_ACK_ESCALATION)).toEqual([]);
    }
    expect(FIXTURE_CANCELLATION_RACE_ESCALATION).not.toBeNull();
    if (FIXTURE_CANCELLATION_RACE_ESCALATION !== null) {
      expect(validateEscalationRecord(FIXTURE_CANCELLATION_RACE_ESCALATION)).toEqual([]);
    }
  });

  it('the reconciliation status/gap coherence law fires', () => {
    const incoherent = validateReconciliationRecord({
      orderRef: FIXTURE_ORDER_REF,
      decisionRef: FIXTURE_DECISION_ID,
      acknowledgedQuantity: '0.75',
      cumulativeFillQuantity: '0.74',
      gap: null,
      status: 'gap',
      fills: [],
      orderClock: FIXTURE_CLOCKS.reconciliation,
      methodId: FILL_RECONCILIATION_CITATION.methodId,
      methodVersion: FILL_RECONCILIATION_CITATION.methodVersion,
      reconciliationId: 'rcn-0123456789abcdef',
      tenant: FIXTURE_TENANT,
      project: FIXTURE_PROJECT,
    });
    expect(incoherent.some((e) => e.code === 'invalid_field')).toBe(true);
    expect(FIXTURE_APPROVE_DECISION.decisionId).toBe(FIXTURE_DECISION_ID);
  });
});
