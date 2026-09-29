// @tradrl/body-execution — fixtures tests: THE GOLDEN SCENARIOS — the
// happy path (prepared->submitted->acknowledged->partially_filled->filled)
// plus the anomaly paths (rejection at the gate, expiry, stuck-ack
// escalation, partial-fill reconciliation, kill-switch mid-flight,
// cancellation race); THE DETERMINISM GOLDEN (same inputs ->
// byte-identical outputs, run twice); deepFreeze totality; collect-all
// validation over corrupted goldens.

import { describe, expect, it } from 'vitest';
import {
  FIXTURE_APPROVE_DECISION,
  FIXTURE_CANCELLATION_RACE,
  FIXTURE_CANCELLATION_RACE_ESCALATION,
  FIXTURE_EXPIRY,
  FIXTURE_FILLS,
  FIXTURE_GATE_REJECTION,
  FIXTURE_HAPPY_PATH,
  FIXTURE_INTAKE,
  FIXTURE_INTENT,
  FIXTURE_KILL_SWITCH_ESCALATION,
  FIXTURE_KILL_SWITCH_MID_FLIGHT,
  FIXTURE_RECONCILED,
  FIXTURE_RECONCILIATION_GAP,
  FIXTURE_STUCK_ACK,
  FIXTURE_STUCK_ACK_ESCALATION,
  buildAcknowledgedLog,
  buildCancellationRaceScenario,
  buildExpiryLog,
  buildGateRejectionLog,
  buildHappyPathLog,
  buildKillSwitchMidFlightScenario,
  buildPreparedLog,
  buildReconciledScenario,
  buildReconciliationGapScenario,
  buildStuckAckScenario,
  buildSubmittedLog,
} from './fixtures';
import { canonicalJson, isDeeplyFrozen } from './primitives';
import { currentOrderState, isOrderLifecycleLog, validateOrderLifecycleLog } from './lifecycle';
import { isEscalationRecord, isReconciliationRecord, reconciliationViolations } from './monitoring';
import { isApprovedDecisionMirror, isOrderIntentMirror } from './intake';

describe('the golden happy path (prepared -> submitted -> acknowledged -> partially_filled -> filled)', () => {
  it('walks the declared motions in order, five records, chain-verified', () => {
    expect(FIXTURE_HAPPY_PATH.records).toHaveLength(5);
    const events = FIXTURE_HAPPY_PATH.records.map((r) => r.event);
    expect(events).toEqual(['prepare', 'submit', 'acknowledge', 'partial-fill', 'fill-complete']);
    expect(currentOrderState(FIXTURE_HAPPY_PATH)).toBe('filled');
    expect(validateOrderLifecycleLog(FIXTURE_HAPPY_PATH)).toEqual([]);
    expect(isOrderLifecycleLog(FIXTURE_HAPPY_PATH)).toBe(true);
    expect(isDeeplyFrozen(FIXTURE_HAPPY_PATH)).toBe(true);
  });

  it('carries the full evidence chain: decision ref, order refs, L16 clock, tenant/project, fills', () => {
    const genesis = FIXTURE_HAPPY_PATH.records[0] as (typeof FIXTURE_HAPPY_PATH.records)[number];
    expect(genesis.decisionRef).toBe('xd:0a1b2c3d4e5f6071');
    expect(genesis.intentRef).toBe('si:t025-fx-001');
    expect(genesis.directorDecisionRef).toBe('dd-9f8e7d6c5b4a3021');
    expect(genesis.orderRef).toBe('t025-fx-001');
    expect(genesis.quantity).toBe('0.75');
    expect(genesis.tenant).toBe('tenant-alpha');
    expect(genesis.project).toBe('project-one');
    for (const record of FIXTURE_HAPPY_PATH.records) {
      expect(record.orderClock).toBeGreaterThan(record.decisionAsOf); // the L16 clock separation
    }
    expect(FIXTURE_HAPPY_PATH.records[3]?.fills).toHaveLength(1);
    expect(FIXTURE_HAPPY_PATH.records[4]?.fills).toHaveLength(1);
  });

  it('the fixture intake + intent + approve decision all validate', () => {
    expect(isOrderIntentMirror(FIXTURE_INTENT)).toBe(true);
    expect(isApprovedDecisionMirror(FIXTURE_APPROVE_DECISION)).toBe(true);
    expect(FIXTURE_INTAKE.directorDecision).toBe('dd-9f8e7d6c5b4a3021');
    expect(FIXTURE_FILLS.map((f) => f.quantity)).toEqual(['0.5', '0.25']);
  });
});

describe('the anomaly paths (each a golden log + its records)', () => {
  it('REJECTION AT THE GATE: prepared -> submitted -> rejected', () => {
    expect(FIXTURE_GATE_REJECTION.records.map((r) => r.event)).toEqual(['prepare', 'submit', 'reject-at-gate']);
    expect(currentOrderState(FIXTURE_GATE_REJECTION)).toBe('rejected');
    expect(validateOrderLifecycleLog(FIXTURE_GATE_REJECTION)).toEqual([]);
  });

  it('EXPIRY: prepared -> submitted -> acknowledged -> expired', () => {
    expect(FIXTURE_EXPIRY.records.map((r) => r.event)).toEqual(['prepare', 'submit', 'acknowledge', 'expire-unfilled']);
    expect(currentOrderState(FIXTURE_EXPIRY)).toBe('expired');
    expect(validateOrderLifecycleLog(FIXTURE_EXPIRY)).toEqual([]);
  });

  it('STUCK-ACK ESCALATION: the log enters stuck WITH the escalation record bound', () => {
    expect(FIXTURE_STUCK_ACK.outcome.kind).toBe('stuck');
    if (FIXTURE_STUCK_ACK.outcome.kind === 'stuck') {
      expect(FIXTURE_STUCK_ACK.outcome.log.records.map((r) => r.event)).toEqual(['prepare', 'submit', 'ack-deadline-exceeded']);
      expect(currentOrderState(FIXTURE_STUCK_ACK.outcome.log)).toBe('stuck');
      expect(validateOrderLifecycleLog(FIXTURE_STUCK_ACK.outcome.log)).toEqual([]);
      expect(isEscalationRecord(FIXTURE_STUCK_ACK.outcome.escalation)).toBe(true);
      expect(FIXTURE_STUCK_ACK.outcome.record.escalationRef).toBe(FIXTURE_STUCK_ACK.outcome.escalation.escalationId);
    }
    expect(FIXTURE_STUCK_ACK_ESCALATION).not.toBeNull();
  });

  it('PARTIAL-FILL RECONCILIATION (reconciled): fills sum EXACTLY to the acknowledged quantity', () => {
    const outcome = FIXTURE_RECONCILED.outcome;
    expect(outcome.record.status).toBe('reconciled');
    expect(outcome.record.gap).toBeNull();
    expect(reconciliationViolations(outcome.record)).toEqual([]);
    expect(isReconciliationRecord(outcome.record)).toBe(true);
    expect(outcome.record.acknowledgedQuantity).toBe('0.75');
    // 0.5 + 0.25 = 0.75 at the declared scale — EXACT equality
    expect(outcome.record.cumulativeFillQuantity.replace(/0+$/, '')).toBe('0.75');
  });

  it('PARTIAL-FILL RECONCILIATION (gap): one smallest-grid-step off is the typed reconciliation_gap', () => {
    const outcome = FIXTURE_RECONCILIATION_GAP.outcome;
    expect(outcome.record.status).toBe('gap');
    const violations = reconciliationViolations(outcome.record);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('reconciliation_gap');
    expect(outcome.record.gap?.replace(/0+$/, '')).toBe('0.01'); // 0.75 - (0.5 + 0.24) = 0.01 exactly
  });

  it('KILL-SWITCH MID-FLIGHT: escalated + recorded; the log is UNCHANGED (never a fabricated fill or cancel)', () => {
    expect(FIXTURE_KILL_SWITCH_MID_FLIGHT.outcome.kind).toBe('escalated');
    if (FIXTURE_KILL_SWITCH_MID_FLIGHT.outcome.kind === 'escalated') {
      expect(FIXTURE_KILL_SWITCH_MID_FLIGHT.outcome.log.records).toHaveLength(3); // prepare, submit, acknowledge — nothing fabricated
      expect(currentOrderState(FIXTURE_KILL_SWITCH_MID_FLIGHT.outcome.log)).toBe('acknowledged');
      expect(FIXTURE_KILL_SWITCH_ESCALATION).not.toBeNull();
      const escalation = FIXTURE_KILL_SWITCH_ESCALATION;
      if (escalation !== null) {
        expect(escalation.reason).toBe('kill-switch-mid-flight');
        expect(escalation.observedState).toBe('acknowledged');
        expect(isEscalationRecord(escalation)).toBe(true);
      }
    }
  });

  it('CANCELLATION RACE: the fill lands first; the refusal is RECORDED as the race escalation', () => {
    expect(FIXTURE_CANCELLATION_RACE.outcome.kind).toBe('refused');
    if (FIXTURE_CANCELLATION_RACE.outcome.kind === 'refused') {
      expect(FIXTURE_CANCELLATION_RACE.outcome.errors[0]?.code).toBe('lifecycle_violation');
      expect(FIXTURE_CANCELLATION_RACE_ESCALATION).not.toBeNull();
      if (FIXTURE_CANCELLATION_RACE_ESCALATION !== null) {
        expect(FIXTURE_CANCELLATION_RACE_ESCALATION.reason).toBe('cancellation-race');
        expect(FIXTURE_CANCELLATION_RACE_ESCALATION.detail).toMatchObject({ kind: 'race', terminalState: 'filled' });
      }
    }
    // the log itself stays filled — the race did not un-fill it
    expect(currentOrderState(FIXTURE_CANCELLATION_RACE.log)).toBe('filled');
  });
});

describe('THE DETERMINISM GOLDEN (same inputs -> byte-identical outputs, run twice)', () => {
  it('every scenario builder is byte-deterministic across runs', () => {
    const pairs: readonly [() => unknown, () => unknown][] = [
      [buildPreparedLog, buildPreparedLog],
      [buildSubmittedLog, buildSubmittedLog],
      [buildAcknowledgedLog, buildAcknowledgedLog],
      [buildHappyPathLog, buildHappyPathLog],
      [buildGateRejectionLog, buildGateRejectionLog],
      [buildExpiryLog, buildExpiryLog],
    ];
    for (const [first, second] of pairs) {
      expect(canonicalJson(first() as never)).toBe(canonicalJson(second() as never));
    }
    // the record-producing scenarios
    const stuckA = buildStuckAckScenario();
    const stuckB = buildStuckAckScenario();
    expect(canonicalJson(stuckA as never)).toBe(canonicalJson(stuckB as never));
    const reconciledA = buildReconciledScenario();
    const reconciledB = buildReconciledScenario();
    expect(canonicalJson(reconciledA as never)).toBe(canonicalJson(reconciledB as never));
    const gapA = buildReconciliationGapScenario();
    const gapB = buildReconciliationGapScenario();
    expect(canonicalJson(gapA as never)).toBe(canonicalJson(gapB as never));
    const switchA = buildKillSwitchMidFlightScenario();
    const switchB = buildKillSwitchMidFlightScenario();
    expect(canonicalJson(switchA as never)).toBe(canonicalJson(switchB as never));
    const raceA = buildCancellationRaceScenario();
    const raceB = buildCancellationRaceScenario();
    expect(canonicalJson(raceA as never)).toBe(canonicalJson(raceB as never));
  });

  it('the exported goldens ARE the builders\' outputs (no fixture drift)', () => {
    expect(canonicalJson(FIXTURE_HAPPY_PATH as never)).toBe(canonicalJson(buildHappyPathLog() as never));
    expect(canonicalJson(FIXTURE_GATE_REJECTION as never)).toBe(canonicalJson(buildGateRejectionLog() as never));
    expect(canonicalJson(FIXTURE_EXPIRY as never)).toBe(canonicalJson(buildExpiryLog() as never));
    expect(canonicalJson(FIXTURE_RECONCILED as never)).toBe(canonicalJson(buildReconciledScenario() as never));
    expect(canonicalJson(FIXTURE_RECONCILIATION_GAP as never)).toBe(canonicalJson(buildReconciliationGapScenario() as never));
    expect(canonicalJson(FIXTURE_KILL_SWITCH_MID_FLIGHT as never)).toBe(canonicalJson(buildKillSwitchMidFlightScenario() as never));
    expect(canonicalJson(FIXTURE_CANCELLATION_RACE as never)).toBe(canonicalJson(buildCancellationRaceScenario() as never));
  });

  it('JSON round-trips preserve every golden byte-identically', () => {
    for (const golden of [FIXTURE_HAPPY_PATH, FIXTURE_GATE_REJECTION, FIXTURE_EXPIRY, FIXTURE_RECONCILED, FIXTURE_RECONCILIATION_GAP]) {
      const round = JSON.parse(JSON.stringify(golden));
      expect(canonicalJson(round as never)).toBe(canonicalJson(golden as never));
    }
  });
});

describe('DEEPFREEZE TOTALITY (every public record is immutable)', () => {
  it('every golden scenario record and every derived record is deeply frozen', () => {
    for (const golden of [FIXTURE_HAPPY_PATH, FIXTURE_GATE_REJECTION, FIXTURE_EXPIRY, FIXTURE_INTAKE, FIXTURE_INTENT, FIXTURE_APPROVE_DECISION]) {
      expect(isDeeplyFrozen(golden)).toBe(true);
    }
    if (FIXTURE_STUCK_ACK_ESCALATION !== null) expect(isDeeplyFrozen(FIXTURE_STUCK_ACK_ESCALATION)).toBe(true);
    if (FIXTURE_KILL_SWITCH_ESCALATION !== null) expect(isDeeplyFrozen(FIXTURE_KILL_SWITCH_ESCALATION)).toBe(true);
    if (FIXTURE_CANCELLATION_RACE_ESCALATION !== null) expect(isDeeplyFrozen(FIXTURE_CANCELLATION_RACE_ESCALATION)).toBe(true);
    expect(isDeeplyFrozen(FIXTURE_RECONCILED.outcome.record)).toBe(true);
    expect(isDeeplyFrozen(FIXTURE_RECONCILIATION_GAP.outcome.record)).toBe(true);
    expect(isDeeplyFrozen(FIXTURE_FILLS)).toBe(true);
  });

  it('mutation attempts on the frozen goldens throw in strict mode', () => {
    expect(() => {
      'use strict';
      (FIXTURE_HAPPY_PATH as unknown as { records: unknown[] }).records = [];
    }).toThrow();
  });
});

describe('COLLECT-ALL validation over corrupted goldens (nothing silently drops)', () => {
  it('a corrupted happy path reports every violation', () => {
    const corrupted = JSON.parse(JSON.stringify(FIXTURE_HAPPY_PATH));
    const last = corrupted.records[4];
    last.quantity = 0.75; // float mediation
    last.orderClock = last.decisionAsOf; // clock confusion
    last.asOf = last.decisionAsOf; // the strategic field name
    const errors = validateOrderLifecycleLog(corrupted);
    const codes = new Set(errors.map((e) => e.code));
    expect(codes.has('decimal_imprecision')).toBe(true);
    expect(codes.has('clock_confusion')).toBe(true); // BOTH clock crimes: the field-name AND the value copy
    expect(errors.filter((e) => e.code === 'clock_confusion').length).toBe(2);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('removing the fills from a fill record is fill_fabricated + the chain breaks', () => {
    const corrupted = JSON.parse(JSON.stringify(FIXTURE_HAPPY_PATH));
    corrupted.records[4].fills = [];
    const errors = validateOrderLifecycleLog(corrupted);
    expect(errors.some((e) => e.code === 'fill_fabricated')).toBe(true);
  });
});
