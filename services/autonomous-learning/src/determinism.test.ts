/**
 * The determinism suite: the byte-stable golden literals + the
 * run-twice byte-identity law (L9) + the immutability discipline.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTO_PROJECT,
  AUTO_TENANT,
  GOLDEN_COMMISSION_ID,
  GOLDEN_COMMISSION_TRIAL,
  GOLDEN_CONSUMED_HOOKS,
  GOLDEN_CYCLE_ID,
  GOLDEN_GAP_IDS,
  GOLDEN_MEMORY_FEED_ID,
  GOLDEN_REVISION_ID,
  GOLDEN_REVISION_TRIAL,
  GOLDEN_STATE_DIGEST,
  autonomousLearningStateDigest,
  createAutonomousLearningState,
  runImprovementCycle,
  scenarioCycleInputs,
} from './index';

/** Run the scenario cycle; throw on failure. */
function runScenario(): ReturnType<typeof runImprovementCycle> {
  return runImprovementCycle(createAutonomousLearningState(), scenarioCycleInputs());
}

describe('the golden literals (byte-stable by construction)', () => {
  it('the first cycle pins exactly the golden ids and digest', () => {
    const result = runScenario();
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    expect(result.value.cycle.cycleId).toBe(GOLDEN_CYCLE_ID);
    expect(autonomousLearningStateDigest(result.value.state)).toBe(GOLDEN_STATE_DIGEST);
    expect(result.value.cycle.gaps).toEqual([...GOLDEN_GAP_IDS]);
    expect(result.value.cycle.revision).toBe(GOLDEN_REVISION_ID);
    expect(result.value.cycle.commission).toBe(GOLDEN_COMMISSION_ID);
    expect(result.value.cycle.memoryFeed).toBe(GOLDEN_MEMORY_FEED_ID);
    expect(result.value.cycle.revisionTrial).toBe(GOLDEN_REVISION_TRIAL);
    expect(result.value.cycle.commissionTrial).toBe(GOLDEN_COMMISSION_TRIAL);
    expect(result.value.state.consumedHooks).toHaveLength(GOLDEN_CONSUMED_HOOKS);
    expect(result.value.cycle.tenant).toBe(AUTO_TENANT);
    expect(result.value.cycle.project).toBe(AUTO_PROJECT);
  });
});

describe('the run-twice byte-identity law (L9)', () => {
  it('identical inputs -> byte-identical state, record and products, twice', () => {
    const first = runScenario();
    const second = runScenario();
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(JSON.stringify(first.value.state)).toBe(JSON.stringify(second.value.state));
    expect(JSON.stringify(first.value.cycle)).toBe(JSON.stringify(second.value.cycle));
    expect(JSON.stringify(first.value.products)).toBe(JSON.stringify(second.value.products));
    expect(autonomousLearningStateDigest(first.value.state)).toBe(autonomousLearningStateDigest(second.value.state));
  });

  it('a one-millisecond-later instant changes every derived address (content-bound, not clock-bound)', () => {
    const first = runScenario();
    const later = runImprovementCycle(createAutonomousLearningState(), {
      ...scenarioCycleInputs(),
      at: (scenarioCycleInputs().at + 1) as never,
    });
    if (!first.ok || !later.ok) throw new Error('unreachable');
    expect(later.value.cycle.cycleId).not.toBe(first.value.cycle.cycleId);
    expect(later.value.cycle.at).not.toBe(first.value.cycle.at);
  });
});

describe('the immutability discipline (the runtime half of append-only)', () => {
  it('every product and record is deeply frozen — mutation attempts throw', () => {
    const result = runScenario();
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    const { cycle, products, state } = result.value;
    expect(() => {
      (cycle as { policyDigest: string }).policyDigest = 'forged';
    }).toThrow();
    expect(() => {
      (products.gaps[0] as { kind: string }).kind = 'vibes';
    }).toThrow();
    expect(() => {
      (state.log.cycles as unknown[]).pop();
    }).toThrow();
    expect(() => {
      (products.commission?.evidence as unknown as { verdictRefs: string[] }).verdictRefs.push('forged');
    }).toThrow();
    // The freeze survived the attempts.
    expect(cycle.policyDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(products.gaps[0]?.kind).toBe('execution');
    expect(state.log.cycles).toHaveLength(1);
    expect(products.commission?.evidence.verdictRefs).toHaveLength(2);
  });
});
