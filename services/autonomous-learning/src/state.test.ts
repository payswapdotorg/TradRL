/**
 * The state-machine suite: the improvement log's append-only + chain laws,
 * the consumed-hooks ledger, the state digest, and the record guard's
 * coherence laws.
 */

import { describe, expect, it } from 'vitest';
import {
  ImprovementCycleRecord,
  appendImprovementCycle,
  autonomousLearningStateDigest,
  createAutonomousLearningState,
  improvementChainStep,
  improvementLogHead,
  isAutonomousLearningState,
  isImprovementCycleRecord,
  runImprovementCycle,
  scenarioCycleInputs,
  verifyImprovementLog,
} from './index';

/** Run the scenario once; throw on failure. */
function scenarioCycle(): { record: ImprovementCycleRecord; state: ReturnType<typeof createAutonomousLearningState> } {
  const result = runImprovementCycle(createAutonomousLearningState(), scenarioCycleInputs());
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return { record: result.value.cycle, state: result.value.state };
}

describe('the improvement log: append-only + chain-verified', () => {
  it('a fresh state is empty, guard-valid, and chain-verifies', () => {
    const state = createAutonomousLearningState();
    expect(isAutonomousLearningState(state)).toBe(true);
    expect(state.log.cycles).toHaveLength(0);
    expect(state.log.chain).toHaveLength(0);
    expect(verifyImprovementLog(state.log)).toBe(true);
    expect(improvementLogHead(state.log)).toBe('00000000'); // the program-wide seed
    expect(autonomousLearningStateDigest(state)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('append folds the chain and extends the consumed-hooks ledger', () => {
    const { record, state } = scenarioCycle();
    expect(state.log.cycles).toHaveLength(1);
    expect(verifyImprovementLog(state.log)).toBe(true);
    expect(improvementLogHead(state.log)).toBe(improvementChainStep('00000000', record));
    expect(state.consumedHooks.map((entry) => entry.hookId)).toEqual(record.consumedHooks);
    expect(isImprovementCycleRecord(record)).toBe(true);
  });

  it('the ORIGINAL state is untouched by the append (a NEW state, L11)', () => {
    const fresh = createAutonomousLearningState();
    const result = runImprovementCycle(fresh, scenarioCycleInputs());
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    expect(fresh.log.cycles).toHaveLength(0);
    expect(fresh.consumedHooks).toHaveLength(0);
    expect(result.value.state.log.cycles).toHaveLength(1);
  });

  it('a spliced ordinal is chain_mismatch (the append law)', () => {
    const { record } = scenarioCycle();
    const spliced: ImprovementCycleRecord = { ...record, ordinal: 99 };
    const result = appendImprovementCycle(createAutonomousLearningState(), spliced);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('chain_mismatch');
      expect(result.errors[0]?.message).toContain('append-only');
    }
  });

  it('a forged record id is invalid_id (identity IS the content address)', () => {
    const { record } = scenarioCycle();
    const forged: ImprovementCycleRecord = { ...record, cycleId: 'alc:00000000' as never };
    const result = appendImprovementCycle(createAutonomousLearningState(), forged);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('invalid_id');
      expect(result.errors[0]?.message).toContain(record.cycleId);
    }
  });

  it('an edited record never re-verifies (a tampered history never drives the next cycle)', () => {
    const { state } = scenarioCycle();
    const edited = {
      ...state,
      log: {
        cycles: [{ ...state.log.cycles[0] as ImprovementCycleRecord, policyDigest: 'deadbeef' }],
        chain: [...state.log.chain],
      },
    };
    expect(verifyImprovementLog(edited.log)).toBe(false);
    // A removed record (hiding a cycle) fails too.
    const hidden = {
      ...state,
      log: { cycles: [], chain: [...state.log.chain] },
    };
    expect(verifyImprovementLog(hidden.log)).toBe(false);
    // A truncated chain fails too.
    const truncated = {
      ...state,
      log: { cycles: [...state.log.cycles], chain: [] },
    };
    expect(verifyImprovementLog(truncated.log)).toBe(false);
  });

  it('a guard-invalid record is refused (invalid_type) — the refusal-coherence law', () => {
    const { record } = scenarioCycle();
    // A withheld status without a refusal is incoherent.
    const incoherent = { ...record, commissionStatus: 'withheld', commissionRefusal: null };
    expect(isImprovementCycleRecord(incoherent)).toBe(false);
    const result = appendImprovementCycle(createAutonomousLearningState(), incoherent as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_type');
  });

  it('two cycles chain in order and the state digest distinguishes them', () => {
    const first = scenarioCycle();
    const secondInputs = {
      ...scenarioCycleInputs(),
      at: (first.record.at + 5_000) as never,
      hooks: [],
      outcomes: [],
      postMortems: [],
      evaluations: [],
    };
    const second = runImprovementCycle(first.state, secondInputs);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.errors.map((error) => error.message).join('; '));
    expect(second.value.state.log.cycles).toHaveLength(2);
    expect(verifyImprovementLog(second.value.state.log)).toBe(true);
    expect(second.value.cycle.ordinal).toBe(2);
    expect(autonomousLearningStateDigest(second.value.state)).not.toBe(autonomousLearningStateDigest(first.state));
  });
});
