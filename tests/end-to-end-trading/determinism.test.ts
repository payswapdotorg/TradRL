// tests/end-to-end-trading/determinism.test.ts — THE DETERMINISM GATE.
//
// Two runs over the same scenario bytes produce BYTE-IDENTICAL artifact
// streams: the lineage stream, the outcome log, the world run record and
// every per-stage record stream. A different seed produces different
// bytes (sanity: the digests are not constants). No ambient clock, no
// ambient randomness — the scenario is the only entropy.

import { describe, expect, it } from 'vitest';

import {
  runReferenceSlice, runEndToEndTradingScenario, REFERENCE_SCENARIO,
  serializeLineageStream, serializeScenario, worldRunRecord, canonicalJson,
  deepFreeze, type TradingScenario,
} from '../../examples/end-to-end-trading/src/index';

function scenarioWithSeed(seed: string): TradingScenario {
  return deepFreeze({ ...structuredClone(REFERENCE_SCENARIO as unknown as TradingScenario), seed });
}

describe('T048 determinism gate — two runs, byte-identical streams', () => {
  it('produces byte-identical lineage streams across two fresh runs', () => {
    const first = runReferenceSlice();
    const second = runReferenceSlice();
    if (!first.ok || !second.ok) throw new Error('runs failed');
    const bytesA = serializeLineageStream(first.value.lineage);
    const bytesB = serializeLineageStream(second.value.lineage);
    expect(bytesA).toBe(bytesB);
    expect(first.value.digest).toBe(second.value.digest);
  });

  it('produces byte-identical outcome logs, world records and decisions', () => {
    const first = runReferenceSlice();
    const second = runReferenceSlice();
    if (!first.ok || !second.ok) throw new Error('runs failed');
    expect(canonicalJson(first.value.outcomeLog as never)).toBe(canonicalJson(second.value.outcomeLog as never));
    expect(canonicalJson(worldRunRecord(first.value.world) as never)).toBe(
      canonicalJson(worldRunRecord(second.value.world) as never),
    );
    expect(canonicalJson(first.value.decisions as never)).toBe(canonicalJson(second.value.decisions as never));
    expect(canonicalJson(first.value.strategyRuns as never)).toBe(canonicalJson(second.value.strategyRuns as never));
    expect(canonicalJson(first.value.submissions as never)).toBe(canonicalJson(second.value.submissions as never));
    expect(canonicalJson(first.value.goalProgress as never)).toBe(canonicalJson(second.value.goalProgress as never));
    expect(canonicalJson(first.value.finalPortfolio as never)).toBe(canonicalJson(second.value.finalPortfolio as never));
    expect(first.value.kernel.operations.map((op) => op.opId)).toEqual(
      second.value.kernel.operations.map((op) => op.opId),
    );
  });

  it('runs from the canonical scenario BYTES reproduce the same stream', () => {
    const bytes = serializeScenario(REFERENCE_SCENARIO);
    const direct = runReferenceSlice();
    const fromBytes = runEndToEndTradingScenario(JSON.parse(bytes));
    if (!direct.ok || !fromBytes.ok) throw new Error('runs failed');
    expect(serializeLineageStream(fromBytes.value.lineage)).toBe(serializeLineageStream(direct.value.lineage));
    expect(fromBytes.value.digest).toBe(direct.value.digest);
  });

  it('a different seed produces different bytes (the digests are live)', () => {
    const baseline = runReferenceSlice();
    const seeded = runEndToEndTradingScenario(scenarioWithSeed('seed/t048/reference-2'));
    if (!baseline.ok || !seeded.ok) throw new Error('runs failed');
    expect(serializeLineageStream(seeded.value.lineage)).not.toBe(serializeLineageStream(baseline.value.lineage));
    expect(seeded.value.digest).not.toBe(baseline.value.digest);
  });

  it('repeated runs are stable under many iterations (no hidden state)', () => {
    const digests: string[] = [];
    for (let index = 0; index < 5; index++) {
      const result = runReferenceSlice();
      if (!result.ok) throw new Error('run failed');
      digests.push(result.value.digest);
    }
    expect(new Set(digests).size).toBe(1);
  });
});
