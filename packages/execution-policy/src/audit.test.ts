/**
 * @tradrl/execution-policy — the AuditRecord tests: every decision
 * emits exactly one audit record; the trail is append-only and
 * chain-verified (rewrite is the typed `audit_rewrite`).
 */

import { describe, expect, it } from 'vitest';

import {
  appendAuditRecord,
  appendDecision,
  auditRecordOf,
  isAuditLog,
  isAuditRecord,
  runExecutionGate,
  startAuditLog,
  validateAuditLog,
  validateExecutionPolicy,
  verifyAuditChain,
} from './index';
import { fixtureIntent, fixtureKillSwitch, fixturePortfolio, fixturePolicyInput, fixtureVenueState, unwrap } from './test-fixtures';

/** Run the fixture gate once and return the decision. */
function approvedDecision() {
  const result = runExecutionGate({
    intent: fixtureIntent(),
    policy: unwrap(validateExecutionPolicy(fixturePolicyInput())),
    portfolio: fixturePortfolio(),
    venueState: fixtureVenueState(),
    killSwitch: fixtureKillSwitch(),
  });
  if (!result.ok) throw new Error('fixture gate must approve');
  return result.value;
}

/** Run the fixture gate with an authorization-failing intent and return the refusal (same tenant scope — auditable). */
function refusedDecision() {
  const result = runExecutionGate({
    intent: fixtureIntent({
      order: {
        clientOrderId: 't019-fx-audit',
        instrumentId: 'BTC-USD',
        venueId: 'REFSIM',
        side: 'sell',
        kind: 'stop',
        quantity: '0.5',
        stopPrice: '48000.00',
        timeInForce: 'gtc',
        createdAt: '2023-11-14T22:13:20.000Z',
      },
    }),
    policy: unwrap(validateExecutionPolicy(fixturePolicyInput())),
    portfolio: fixturePortfolio(),
    venueState: fixtureVenueState(),
    killSwitch: fixtureKillSwitch(),
  });
  if (!result.ok) throw new Error('fixture gate must decide');
  if (result.value.kind !== 'refuse') throw new Error('fixture must refuse');
  return result.value;
}

describe('AuditRecord — every decision emits exactly one', () => {
  it('an APPROVE decision emits an audit record carrying the full lineage chain and enumerated checks', () => {
    const decision = approvedDecision();
    const record = unwrap(auditRecordOf(decision, 1, 'seed-head'));
    expect(isAuditRecord(record)).toBe(true);
    expect(record.auditId).toMatch(/^xa:[0-9a-f]{8}$/);
    expect(record.sequence).toBe(1);
    expect(record.outcome).toBe('approve');
    expect(record.decisionId).toBe(decision.decisionId);
    expect(record.intentRef).toBe('si:fixture0001');
    expect(record.checks).toHaveLength(decision.checks.length);
    expect(record.checks.every((check) => check.outcome === 'pass')).toBe(true);
    expect(record.refusal).toBeNull();
    // The lineage chain (intent -> strategy -> goal) + policy + tenant/project.
    expect(record.lineage.strategy).toEqual({ specId: 'spec-fixture', version: 1 });
    expect(record.lineage.goal).toEqual({ goalId: 'goal-fixture', version: 1 });
    expect(record.tenant).toBe('tenant-alpha');
    expect(record.project).toBe('project-one');
  });

  it('a REFUSE decision emits an audit record carrying the structured refusal reason', () => {
    const decision = refusedDecision();
    const record = unwrap(auditRecordOf(decision, 1, 'seed-head'));
    expect(record.outcome).toBe('refuse');
    expect(record.refusal).toEqual(decision.failure.reason);
    // Approvals and refusals are audited identically (a refusal is
    // evidence of the gate working).
    expect(record.checks[record.checks.length - 1]?.outcome).toBe('fail');
  });

  it('NEGATIVE — a malformed decision fails emission (never a best-effort record)', () => {
    const result = auditRecordOf({ kind: 'approve' } as never, 1, 'seed-head');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_decision');
  });
});

describe('AuditLog — the append-only, chain-verified trail', () => {
  it('the trail grows one record per decision, in order, and verifies', () => {
    let log = unwrap(startAuditLog('tenant-alpha' as never, 'project-one' as never));
    expect(log.records).toHaveLength(0);
    log = unwrap(appendDecision(log, approvedDecision()));
    log = unwrap(appendDecision(log, refusedDecision()));
    expect(log.records).toHaveLength(2);
    expect(log.records[0]?.sequence).toBe(1);
    expect(log.records[1]?.sequence).toBe(2);
    expect(isAuditLog(log)).toBe(true);
    expect(verifyAuditChain(log).ok).toBe(true);
    expect(Object.isFrozen(log)).toBe(true);
  });

  it('NEGATIVE — re-auditing a decision fails with audit_rewrite (one decision, one record)', () => {
    const decision = approvedDecision();
    let log = unwrap(startAuditLog('tenant-alpha' as never, 'project-one' as never));
    log = unwrap(appendDecision(log, decision));
    const again = appendDecision(log, decision);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors[0]?.code).toBe('audit_rewrite');
  });

  it('NEGATIVE — a cross-tenant decision cannot be audited into the trail (L12)', () => {
    const log = unwrap(startAuditLog('tenant-beta' as never, 'project-one' as never));
    const result = appendDecision(log, approvedDecision());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('tenant_missing');
  });

  it('NEGATIVE — a spliced trail fails chain verification with audit_rewrite', () => {
    let log = unwrap(startAuditLog('tenant-alpha' as never, 'project-one' as never));
    log = unwrap(appendDecision(log, approvedDecision()));
    log = unwrap(appendDecision(log, refusedDecision()));
    const forged = JSON.parse(JSON.stringify(log)) as { records: unknown[] };
    forged.records.splice(0, 1); // remove the approval — the crime
    const verified = verifyAuditChain(forged as never);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('audit_rewrite');
  });

  it('NEGATIVE — an edited record fails chain verification with audit_rewrite', () => {
    let log = unwrap(startAuditLog('tenant-alpha' as never, 'project-one' as never));
    log = unwrap(appendDecision(log, refusedDecision()));
    const forged = JSON.parse(JSON.stringify(log)) as { records: { intentRef: string }[] };
    forged.records[0] = { ...forged.records[0], intentRef: 'si:someotherintent' }; // rewrite history
    const verified = verifyAuditChain(forged as never);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('audit_rewrite');
  });

  it('the resume path: appendAuditRecord re-admits only chain-coherent records', () => {
    let log = unwrap(startAuditLog('tenant-alpha' as never, 'project-one' as never));
    const decision = approvedDecision();
    // A hand-built record with a forged chain head fails (it does not
    // fold onto the trail's seed).
    const forgedHead = unwrap(auditRecordOf(decision, 1, 'forged-head'));
    const result = appendAuditRecord(log, forgedHead);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('audit_rewrite');
    // A record claiming a wrong sequence fails.
    const wrongSequence = unwrap(auditRecordOf(decision, 7, 'seed-head'));
    const result2 = appendAuditRecord(log, wrongSequence);
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.errors[0]?.code).toBe('audit_rewrite');
    // The positive path: the decision appended through appendDecision
    // produces the record the resume path would re-admit.
    const appended = unwrap(appendDecision(log, decision));
    expect(appended.records[0]?.auditId).toBeDefined();
  });

  it('NEGATIVE — a duplicate decision id admitted through appendAuditRecord fails', () => {
    let log = unwrap(startAuditLog('tenant-alpha' as never, 'project-one' as never));
    log = unwrap(appendDecision(log, approvedDecision()));
    const duplicate = log.records[0];
    if (duplicate === undefined) throw new Error('unreachable');
    const result = appendAuditRecord(log, duplicate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('audit_rewrite');
  });

  it('validateAuditLog re-verifies the chain (the resume gate)', () => {
    let log = unwrap(startAuditLog('tenant-alpha' as never, 'project-one' as never));
    log = unwrap(appendDecision(log, approvedDecision()));
    const roundTrip = JSON.parse(JSON.stringify(log));
    expect(validateAuditLog(roundTrip).ok).toBe(true);
    const bad = { ...roundTrip, records: [] };
    // An empty trail is structurally valid (nothing recorded yet).
    expect(validateAuditLog(bad).ok).toBe(true);
    const tampered = JSON.parse(JSON.stringify(log)) as { records: { sequence: number }[] };
    tampered.records[0] = { ...tampered.records[0], sequence: 42 };
    expect(validateAuditLog(tampered).ok).toBe(false);
  });

  it('the serialized trail survives the JSON round-trip byte-identically (L9 portability)', () => {
    let log = unwrap(startAuditLog('tenant-alpha' as never, 'project-one' as never));
    log = unwrap(appendDecision(log, approvedDecision()));
    log = unwrap(appendDecision(log, refusedDecision()));
    const once = JSON.stringify(log);
    const twice = JSON.stringify(JSON.parse(once));
    expect(twice).toBe(once);
  });
});
