import { describe, expect, it } from 'vitest';

import {
  derivedAvailableTime,
  isDerivedAvailability,
  requireTimestampMs,
  validateDerivedAvailability,
  type DerivedAvailability,
  type Observable,
  type TimeResult,
} from './index';

function unwrap<T>(result: TimeResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${result.error.code}: ${result.error.message}`);
}

interface StubInput extends Observable {
  readonly id: string;
  readonly available_time: number & { readonly __brand: 'TradRL.TimestampMs' };
}

function input(id: string, availableTime: number): StubInput {
  return { id, available_time: requireTimestampMs(availableTime) };
}

const VWAP_POLICY = { transform_id: 'vwap-1m-aggregator', delay: { milliseconds: 250 } } as const;

describe('derivedAvailableTime — latest input availability plus computation policy', () => {
  it('equals the latest input available_time plus the policy delay', () => {
    const inputs = [input('t1', 1_000), input('t2', 3_000), input('t3', 2_000)];
    expect(unwrap(derivedAvailableTime(inputs, VWAP_POLICY))).toBe(3_250);
  });

  it('works for a single input and zero delay', () => {
    expect(unwrap(derivedAvailableTime([input('t1', 1_000)], VWAP_POLICY))).toBe(1_250);
    expect(
      unwrap(derivedAvailableTime([input('t1', 1_000)], { transform_id: 'pass-through', delay: {} })),
    ).toBe(1_000);
  });

  it('models a forward-return label: available at event time + horizon', () => {
    const event = input('trade-42', 1_700_000_000_000);
    const labelPolicy = { transform_id: 'fwd-return-5m', delay: { minutes: 5 } };
    expect(unwrap(derivedAvailableTime([event], labelPolicy))).toBe(1_700_000_000_000 + 5 * 60_000);
  });

  it('rejects empty inputs and malformed policies with typed errors', () => {
    const empty = derivedAvailableTime([], VWAP_POLICY);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('no_inputs');

    const noTransform = derivedAvailableTime([input('t1', 1)], { transform_id: '', delay: {} });
    expect(noTransform.ok).toBe(false);
    if (!noTransform.ok) expect(noTransform.error.code).toBe('invalid_policy');

    const negativeDelay = derivedAvailableTime([input('t1', 1)], { transform_id: 'x', delay: { minutes: -1 } });
    expect(negativeDelay.ok).toBe(false);
    if (!negativeDelay.ok) expect(negativeDelay.error.code).toBe('invalid_duration');
  });
});

describe('validateDerivedAvailability — the firewall polices derived state', () => {
  const inputs = [input('t1', 1_000), input('t2', 3_000)];

  function artifact(availableTime: number, derivedFrom: readonly string[] = ['t1', 't2']): DerivedAvailability {
    return {
      available_time: requireTimestampMs(availableTime),
      derived_from: derivedFrom,
      computation: VWAP_POLICY,
    };
  }

  it('accepts an artifact available at or after its latest input', () => {
    expect(unwrap(validateDerivedAvailability(inputs, artifact(3_250)))).toBe(true);
    expect(unwrap(validateDerivedAvailability(inputs, artifact(10_000)))).toBe(true);
  });

  it('rejects an artifact claiming availability before its latest input', () => {
    const result = validateDerivedAvailability(inputs, artifact(2_999));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('derived_before_inputs');
  });

  it('rejects an artifact with empty lineage or empty inputs', () => {
    const noLineage = validateDerivedAvailability(inputs, artifact(5_000, []));
    expect(noLineage.ok).toBe(false);
    if (!noLineage.ok) expect(noLineage.error.code).toBe('derived_without_lineage');

    const noInputs = validateDerivedAvailability([], artifact(5_000));
    expect(noInputs.ok).toBe(false);
    if (!noInputs.ok) expect(noInputs.error.code).toBe('no_inputs');
  });

  it('isDerivedAvailability guards the contract structurally', () => {
    expect(isDerivedAvailability(artifact(3_250))).toBe(true);
    expect(isDerivedAvailability({ ...artifact(3_250), available_time: -1 })).toBe(false);
    expect(isDerivedAvailability({ ...artifact(3_250), derived_from: [] })).toBe(false);
    expect(isDerivedAvailability({ ...artifact(3_250), computation: { transform_id: '', delay: {} } })).toBe(false);
    expect(isDerivedAvailability(null)).toBe(false);
  });
});
