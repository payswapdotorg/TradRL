/**
 * @tradrl/search-lineage — determinism tests (the Engineering Protocol law:
 * "identical inputs -> identical bytes").
 *
 * Laws under test:
 * - the SAME append sequence (same trials, same configs, same injected
 *   instants) always produces byte-identical canonical records;
 * - a DIFFERENT sequence (any changed field, instant or order) produces
 *   different bytes;
 * - serialization round-trips through JSON without losing the record
 *   (portability across processes — the audit service consumes serialized
 *   records);
 * - no ambient clock: nothing in the package reads time (proved by
 *   construction — every instant in these records came from literals).
 */

import { describe, expect, it } from 'vitest';

import { appendSearchTrial, canonicalSearchRecord, createSearchRecord, verifySearchRecord } from './index';
import type { SearchRecord } from './index';

const T0 = 1_700_000_000_000;
const BINDING = { experiment: 'exp-det', evaluator: 'evaluator@1', tenant: 'tenant-1', project: 'project-1' } as const;

interface Step {
  readonly trial: string;
  readonly classification?: 'in-search' | 'holdout';
  readonly parents?: readonly string[];
  readonly config: Record<string, unknown>;
  readonly recordedAt: number;
}

const STEPS: readonly Step[] = [
  { trial: 't1', config: { lr: '0.1', depth: 2 }, recordedAt: T0 + 1 },
  // t2 and t3 share an instant (legal — append order breaks the tie), which
  // lets the reorder test isolate pure order effects.
  { trial: 't2', parents: ['t1'], config: { lr: '0.1', depth: 3 }, recordedAt: T0 + 2 },
  { trial: 't3', config: { lr: '0.2', depth: 3 }, recordedAt: T0 + 2 },
  { trial: 'h1', classification: 'holdout', config: { check: true }, recordedAt: T0 + 4 },
];

function build(steps: readonly Step[] = STEPS): SearchRecord {
  let current = createSearchRecord(BINDING);
  if (!current.ok) throw new Error('fixture must create');
  for (const step of steps) {
    const appended = appendSearchTrial(current.value, {
      trial: step.trial,
      arm: null,
      classification: step.classification ?? 'in-search',
      config: step.config,
      parents: step.parents ?? [],
      splits: step.classification === 'holdout' ? ['split.holdout-1'] : ['split.train-1'],
      datasets: ['dataset-europe'],
      window: { start: T0, end: T0 + 86_400_000 },
      evaluation_policy: step.classification === 'holdout' ? 'split.holdout-1' : 'split.eval-a',
      recorded_at: step.recordedAt,
      tenant: BINDING.tenant,
      project: BINDING.project,
    });
    if (!appended.ok) throw new Error(`fixture must append ${step.trial}: ${JSON.stringify(appended.errors)}`);
    current = { ok: true as const, value: appended.value };
  }
  return current.value;
}

describe('byte determinism', () => {
  it('the same inputs produce identical canonical bytes (repeatedly)', () => {
    const first = canonicalSearchRecord(build());
    for (let i = 0; i < 5; i++) {
      expect(canonicalSearchRecord(build())).toBe(first);
    }
  });

  it('a changed trial field changes the bytes', () => {
    const steps = STEPS.map((s) => ({ ...s }));
    (steps[1] as Step & { config: Record<string, unknown> }).config = { lr: '0.1', depth: 4 };
    expect(canonicalSearchRecord(build(steps))).not.toBe(canonicalSearchRecord(build()));
  });

  it('a changed injected instant changes the bytes', () => {
    const steps = STEPS.map((s) => ({ ...s, recordedAt: s.recordedAt + 1 }));
    expect(canonicalSearchRecord(build(steps))).not.toBe(canonicalSearchRecord(build()));
  });

  it('a changed append order changes the bytes (equal instants, legal reorder)', () => {
    // t2 and t3 share an instant; both depend only on t1 — swapping them is
    // log-legal but changes the canonical bytes (append order is content).
    const swapped = STEPS.map((s) => ({ ...s }));
    const tmp = swapped[1] as Step;
    swapped[1] = swapped[2] as Step;
    swapped[2] = tmp;
    const equalInstant = build(swapped);
    expect(canonicalSearchRecord(equalInstant)).not.toBe(canonicalSearchRecord(build()));
  });

  it('an illegal reorder (parent after child) is rejected by the append law', () => {
    const steps = [STEPS[1] as Step, STEPS[0] as Step, STEPS[2] as Step, STEPS[3] as Step];
    let rejected = false;
    try {
      build(steps);
    } catch (error) {
      rejected = (error as Error).message.includes('append');
    }
    expect(rejected).toBe(true);
  });

  it('the record survives a JSON round-trip and still verifies', () => {
    const original = build();
    const serialized = JSON.stringify(original);
    const parsed = JSON.parse(serialized) as unknown;
    const verified = verifySearchRecord(parsed);
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error('must verify');
    expect(canonicalSearchRecord(verified.value)).toBe(canonicalSearchRecord(original));
  });
});

describe('injected instants only (no ambient clock)', () => {
  it('records built in separate processes (simulated) with the same literals are identical', () => {
    // Two independent "processes" (fresh closures, no shared state).
    const processA = build;
    const processB = (): SearchRecord => build();
    expect(canonicalSearchRecord(processA())).toBe(canonicalSearchRecord(processB()));
  });
});
