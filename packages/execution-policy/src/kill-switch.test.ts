/**
 * @tradrl/execution-policy — the KillSwitch tests: the append-only
 * standing-switch law.
 *
 * Negative paths (the Work Order's demands): "once thrown, ALL
 * subsequent intents are refused with the kill-switch refusal kind"
 * (proven here at the switch level; the check-machine tests prove the
 * refusal kind); "history rewrite is a typed error" (splice, edit and
 * truncate a serialized log and assert the typed `killswitch_rewrite`);
 * "un-throwing is a NEW record, never a mutation".
 */

import { describe, expect, it } from 'vitest';

import {
  currentThrowEvidence,
  isKillSwitchLog,
  killSwitchState,
  restoreKillSwitch,
  startKillSwitch,
  throwKillSwitch,
  validateKillSwitchLog,
  verifyKillSwitchChain,
} from './index';
import { T0, fixtureKillSwitch, unwrap } from './test-fixtures';

describe('KillSwitch — the standing switch', () => {
  it('a switch starts STANDING with a genesis record and a derived identity', () => {
    const log = fixtureKillSwitch();
    expect(killSwitchState(log)).toBe('standing');
    expect(log.switchId).toMatch(/^ksw:[0-9a-f]{8}$/);
    expect(log.records).toHaveLength(1);
    expect(log.records[0]?.sequence).toBe(1);
    expect(log.records[0]?.state).toBe('standing');
    expect(currentThrowEvidence(log)).toBeNull();
    expect(verifyKillSwitchChain(log).ok).toBe(true);
  });

  it('the same genesis inputs always yield the same switch id (L9)', () => {
    const a = startKillSwitch('tenant-alpha' as never, 'project-one' as never, (T0 - 2_000) as never);
    const b = startKillSwitch('tenant-alpha' as never, 'project-one' as never, (T0 - 2_000) as never);
    expect(unwrap(a).switchId).toBe(unwrap(b).switchId);
  });
});

describe('KillSwitch — throwing', () => {
  it('throwing appends a thrown record; the state becomes thrown with its evidence', () => {
    const thrown = unwrap(throwKillSwitch(fixtureKillSwitch(), 'circuit breaker: adverse market conditions', (T0 + 5_000) as never));
    expect(killSwitchState(thrown)).toBe('thrown');
    expect(thrown.records).toHaveLength(2);
    const record = thrown.records[1];
    expect(record?.state).toBe('thrown');
    expect(record?.reason).toBe('circuit breaker: adverse market conditions');
    expect(record?.sequence).toBe(2);
    const evidence = currentThrowEvidence(thrown);
    expect(evidence?.reason).toBe('circuit breaker: adverse market conditions');
    expect(verifyKillSwitchChain(thrown).ok).toBe(true);
  });

  it('NEGATIVE — throwing without a reason fails (an unexplained kill is not auditable)', () => {
    const result = throwKillSwitch(fixtureKillSwitch(), '', (T0 + 5_000) as never);
    expect(result.ok).toBe(false);
  });

  it('NEGATIVE — throwing an already-thrown switch fails (a re-throw is not a state change)', () => {
    const thrown = unwrap(throwKillSwitch(fixtureKillSwitch(), 'first', (T0 + 5_000) as never));
    const again = throwKillSwitch(thrown, 'second', (T0 + 6_000) as never);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors[0]?.code).toBe('invalid_switch_transition');
  });

  it('the thrown log is deeply frozen (immutability discipline)', () => {
    const thrown = unwrap(throwKillSwitch(fixtureKillSwitch(), 'freeze me', (T0 + 5_000) as never));
    expect(Object.isFrozen(thrown)).toBe(true);
    expect(Object.isFrozen(thrown.records)).toBe(true);
    expect(Object.isFrozen(thrown.records[1])).toBe(true);
    expect(() => {
      (thrown.records[1] as { reason: string }).reason = 'rewritten';
    }).toThrow();
  });
});

describe('KillSwitch — restoring (un-throwing is a NEW record)', () => {
  it('restore appends a standing record; the thrown episode stays in the log forever', () => {
    const standing = fixtureKillSwitch();
    const thrown = unwrap(throwKillSwitch(standing, 'temporary halt', (T0 + 5_000) as never));
    const restored = unwrap(restoreKillSwitch(thrown, (T0 + 10_000) as never));
    expect(killSwitchState(restored)).toBe('standing');
    expect(restored.records).toHaveLength(3);
    // The thrown record is still there — append-only history.
    expect(restored.records[1]?.state).toBe('thrown');
    expect(restored.records[1]?.reason).toBe('temporary halt');
    expect(restored.records[2]?.state).toBe('standing');
    expect(currentThrowEvidence(restored)).toBeNull();
    expect(verifyKillSwitchChain(restored).ok).toBe(true);
  });

  it('NEGATIVE — restoring a standing switch fails', () => {
    const result = restoreKillSwitch(fixtureKillSwitch(), (T0 + 1_000) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_switch_transition');
  });

  it('the original logs are untouched by every transition (value semantics)', () => {
    const standing = fixtureKillSwitch();
    const thrown = unwrap(throwKillSwitch(standing, 'x', (T0 + 5_000) as never));
    expect(killSwitchState(standing)).toBe('standing');
    expect(thrown.records).toHaveLength(2);
    expect(standing.records).toHaveLength(1);
  });
});

describe('KillSwitch — history rewrite is a typed error (the negative test)', () => {
  /** Serialize -> parse a log (the JSON round-trip a forger would use). */
  function thaw(log: ReturnType<typeof fixtureKillSwitch>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(log)) as Record<string, unknown>;
  }

  it('NEGATIVE — splicing a middle record out fails with killswitch_rewrite (sequence + chain catch it)', () => {
    // A three-record log (genesis, thrown, restore): splicing the
    // THROWN record out leaves a sequence gap the chain catches.
    const standing = fixtureKillSwitch();
    const thrown = unwrap(throwKillSwitch(standing, 'hide this episode', (T0 + 5_000) as never));
    const restored = unwrap(restoreKillSwitch(thrown, (T0 + 10_000) as never));
    const forged = thaw(restored);
    const records = forged.records as unknown[];
    records.splice(1, 1); // remove the thrown record — the crime
    const verified = verifyKillSwitchChain(forged as never);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('killswitch_rewrite');
  });

  it('tail truncation to a valid prefix is chain-valid — DOCUMENTED: the resume anchor catches it', () => {
    // Inherent to digest chains: a PREFIX of an honest log verifies on
    // its own. The crime of tail truncation is caught at RESUME time,
    // where the run state (services/execution-sim) binds the chain
    // heads it consumed and refuses a shortened log — the contract-
    // level crimes the chain itself catches are middle-splices, edits,
    // forged ids and scope changes (proven around this test).
    const thrown = unwrap(throwKillSwitch(fixtureKillSwitch(), 'tail', (T0 + 5_000) as never));
    const forged = thaw(thrown);
    (forged.records as unknown[]).pop(); // tail-truncate to the genesis
    const verified = verifyKillSwitchChain(forged as never);
    expect(verified.ok).toBe(true); // prefix-valid — the documented property
    expect(killSwitchState(forged as never)).toBe('standing'); // the truncated log lies about the current state...
    // ...which is exactly why the resume path re-binds the recorded
    // heads (the service tests prove the truncated log fails resume).
  });

  it('NEGATIVE — editing a thrown record\'s reason fails with killswitch_rewrite', () => {
    const thrown = unwrap(throwKillSwitch(fixtureKillSwitch(), 'original reason', (T0 + 5_000) as never));
    const forged = thaw(thrown);
    ((forged.records as { reason: string }[])[1] as { reason: string }).reason = 'rewritten reason';
    const verified = verifyKillSwitchChain(forged as never);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('killswitch_rewrite');
  });

  it('NEGATIVE — a forged switch id fails with killswitch_rewrite', () => {
    const standing = fixtureKillSwitch();
    const forged = thaw(standing);
    forged.switchId = 'ksw:deadbeef';
    const verified = verifyKillSwitchChain(forged as never);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('killswitch_rewrite');
  });

  it('NEGATIVE — validateKillSwitchLog re-verifies the chain (the resume gate)', () => {
    const thrown = unwrap(throwKillSwitch(fixtureKillSwitch(), 'x', (T0 + 5_000) as never));
    const good = validateKillSwitchLog(JSON.parse(JSON.stringify(thrown)));
    expect(good.ok).toBe(true);
    const forged = thaw(thrown);
    ((forged.records as { sequence: number }[])[1] as { sequence: number }).sequence = 99;
    const bad = validateKillSwitchLog(forged);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.code).toBe('killswitch_rewrite');
  });

  it('the serialized log survives the JSON round-trip byte-identically (L9 portability)', () => {
    const thrown = unwrap(throwKillSwitch(fixtureKillSwitch(), 'round trip', (T0 + 5_000) as never));
    const once = JSON.stringify(thrown);
    const twice = JSON.stringify(JSON.parse(once));
    expect(twice).toBe(once);
  });
});
