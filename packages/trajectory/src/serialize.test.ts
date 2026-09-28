/**
 * @tradrl/trajectory — deterministic canonical serialization.
 *
 * Acceptance criteria under test:
 * - Same record -> identical canonical JSON bytes, TWICE (and across
 *   key-insertion orders and construction histories).
 * - Distinct append orders produce distinct records and distinct bytes.
 * - Round-trip: parse(serialize(t)) deep-equals t and re-serializes to the
 *   same bytes; replay of the parse equals the recorded order.
 */

import { describe, expect, it } from 'vitest';

import {
  appendStep,
  canonicalize,
  parseTrajectory,
  serializeTrajectory,
} from './index';
import type { Trajectory } from './index';
import { validMetadata, validStep, validTrajectory } from './fixtures';

describe('canonicalize', () => {
  it('sorts object keys and emits no whitespace', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: { y: [3, 1, 2], x: null } })).toBe('{"x":null,"z":{"y":[3,1,2]}}');
  });

  it('preserves array order (order is the step log — meaningful)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('treats absent and undefined-valued keys identically', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalize({ a: 1 })).toBe('{"a":1}');
  });
});

describe('serializeTrajectory determinism', () => {
  it('same record -> identical bytes, twice', () => {
    const trajectory = validTrajectory(3);
    const first = serializeTrajectory(trajectory);
    const second = serializeTrajectory(trajectory);
    expect(first).toBe(second);
  });

  it('equal records built through DIFFERENT histories serialize identically', () => {
    // Direct construction vs. append-after-append of the same steps.
    const direct = validTrajectory(2);
    let grown = validTrajectory(0);
    for (const step of direct.steps) {
      const next = appendStep(grown, step);
      if (!next.ok) throw new Error(next.error.message);
      grown = next.value;
    }
    expect(serializeTrajectory(grown)).toBe(serializeTrajectory(direct));
  });

  it('key-insertion order of opaque payloads does not change the bytes', () => {
    const withA = validStep();
    const withB: typeof withA = {
      ...withA,
      action: { actorId: withA.action.actorId, payload: { notional: '1000', kind: 'order.intention', side: 'buy', instrument: 'BTC-USDT' } },
    };
    const t1 = serializeTrajectory({ ...validTrajectory(0), steps: [withA] });
    const t2 = serializeTrajectory({ ...validTrajectory(0), steps: [withB] });
    expect(t1).toBe(t2);
  });

  it('distinct append orders produce distinct canonical bytes', () => {
    const s1 = validStep(1_700_000_000_000, 1);
    const s2 = validStep(1_700_000_001_000, 2);
    const base = { id: 'traj-0192' as const, metadata: validMetadata() };
    const order12 = appendStep(appendStep({ ...base, steps: [] }, s1).value as Trajectory, s2);
    const order21 = appendStep(appendStep({ ...base, steps: [] }, s2).value as Trajectory, s1);
    if (!order12.ok || !order21.ok) throw new Error('fixture must append');
    expect(serializeTrajectory(order12.value)).not.toBe(serializeTrajectory(order21.value));
  });
});

describe('parseTrajectory round-trip', () => {
  it('parse(serialize(t)) deep-equals t and re-serializes byte-identically', () => {
    const original = validTrajectory(3);
    const bytes = serializeTrajectory(original);
    const parsed = parseTrajectory(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(original);
    expect(serializeTrajectory(parsed.value)).toBe(bytes);
  });

  it('the parse is deeply frozen and replays the recorded order', () => {
    const parsed = parseTrajectory(serializeTrajectory(validTrajectory(3)));
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.steps[0])).toBe(true);
    expect(parsed.value.steps.map((s) => s.id)).toEqual(['step-1', 'step-2', 'step-3']);
  });

  it('rejects non-JSON text, non-record JSON, and structurally invalid trajectories', () => {
    expect(parseTrajectory('').ok).toBe(false);
    expect(parseTrajectory('not json').ok).toBe(false);
    expect(parseTrajectory('42').ok).toBe(false);
    expect(parseTrajectory('[]').ok).toBe(false);
    // Structurally valid JSON, but the lineage block is gutted.
    const gutted = JSON.parse(serializeTrajectory(validTrajectory(1))) as Record<string, unknown>;
    delete gutted.metadata;
    expect(parseTrajectory(JSON.stringify(gutted)).ok).toBe(false);
  });
});
