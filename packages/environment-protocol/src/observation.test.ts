/**
 * The observation envelope and the L4 inclusive boundary it carries.
 *
 * The acceptance-critical behaviors:
 *   - an observation with `available_time == now` IS visible;
 *   - an observation with `available_time == now + 1` is NOT;
 *   - DERIVED observations (non-empty lineage) obey the SAME law;
 *   - synthetic origins are withheld exactly like historical ones;
 *   - validation is timeless (future-dated availability is VALID).
 */

import { describe, expect, it } from 'vitest';

import {
  isObservation,
  isObservationVisible,
  isDerivedObservation,
  isSyntheticObservation,
  validateObservation,
  visibleObservationsAt,
  withheldObservationsAt,
  type Observation,
} from './index';
import { requireTimestampMs, type TimestampMs } from './index';

function historicalObservation(availableTime: number, id = `obs-${availableTime}`): Observation {
  const result = validateObservation({
    observation_id: id,
    available_time: requireTimestampMs(availableTime),
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    payload: { price: '43125.10', size: '0.017' },
    provenance: { origin: 'historical', source: 'binance-adapter@1.4.0', derived_from: [] },
  });
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

/** A derived observation: computed from parents, with lineage, available later than its inputs. */
function derivedObservation(availableTime: number, parents: readonly string[]): Observation {
  const result = validateObservation({
    observation_id: `derived-${availableTime}`,
    available_time: requireTimestampMs(availableTime),
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    payload: { vwap: '43120.55' },
    provenance: { origin: 'simulated', source: 'vwap-1m-aggregator', derived_from: parents },
  });
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('the L4 inclusive boundary (isObservationVisible / visibleObservationsAt)', () => {
  const NOW: TimestampMs = requireTimestampMs(1_000);
  const atNow = historicalObservation(1_000, 'obs-at-now');
  const atNowPlusOne = historicalObservation(1_001, 'obs-at-now-plus-one');

  it('an observation with available_time == now IS visible (inclusive)', () => {
    expect(isObservationVisible(atNow, NOW)).toBe(true);
  });

  it('an observation with available_time == now + 1 is NOT visible', () => {
    expect(isObservationVisible(atNowPlusOne, NOW)).toBe(false);
    expect(isObservationVisible(atNowPlusOne, requireTimestampMs(NOW - 1))).toBe(false);
  });

  it('filtering: the visible subset at `now` excludes exactly the future-dated ones', () => {
    const all = [historicalObservation(500, 'a'), atNow, atNowPlusOne, historicalObservation(2_000, 'b')];
    expect(visibleObservationsAt(all, NOW).map((observation) => observation.observation_id)).toEqual(['a', 'obs-at-now']);
    expect(withheldObservationsAt(all, NOW).map((observation) => observation.observation_id)).toEqual([
      'obs-at-now-plus-one',
      'b',
    ]);
  });

  it('the boundary is monotone: raising `at` reveals, lowering withholds', () => {
    const embargoed = historicalObservation(5_000, 'embargo');
    expect(isObservationVisible(embargoed, requireTimestampMs(4_999))).toBe(false);
    expect(isObservationVisible(embargoed, requireTimestampMs(5_000))).toBe(true);
    expect(isObservationVisible(embargoed, requireTimestampMs(5_001))).toBe(true);
  });
});

describe('derived observations obey the SAME law (L4 has no origin/derivation awareness)', () => {
  const NOW: TimestampMs = requireTimestampMs(10_000);

  it('a derived observation is recognized by its lineage and withheld until its availability', () => {
    const parents = [historicalObservation(9_000, 'in-1'), historicalObservation(9_500, 'in-2')];
    const feature = derivedObservation(10_000, parents.map((parent) => parent.observation_id));
    expect(isDerivedObservation(feature)).toBe(true);
    expect(isDerivedObservation(parents[0])).toBe(false);

    // One millisecond before its availability: withheld, exactly like a primitive observation.
    expect(isObservationVisible(feature, requireTimestampMs(9_999))).toBe(false);
    // Exactly at its availability: visible (inclusive).
    expect(isObservationVisible(feature, NOW)).toBe(true);
  });

  it('a future-dated derived observation is filtered out alongside primitive ones', () => {
    const primitive = historicalObservation(10_000, 'p');
    const futureDerived = derivedObservation(10_001, ['p']);
    const visible = visibleObservationsAt([primitive, futureDerived], NOW);
    expect(visible.map((observation) => observation.observation_id)).toEqual(['p']);
  });
});

describe('syntheticity (L5 mirror)', () => {
  it('simulated and generated observations are synthetic; historical is not', () => {
    expect(isSyntheticObservation(historicalObservation(1))).toBe(false);
    expect(isSyntheticObservation(derivedObservation(2, ['x']))).toBe(true);

    const generated = validateObservation({
      observation_id: 'gen-1',
      available_time: requireTimestampMs(1),
      venue: null,
      instrument: null,
      payload: { scenario: 'flash-crash-1' },
      provenance: { origin: 'generated', source: 'stress-generator', derived_from: [] },
    });
    if (!generated.ok) throw new Error('fixture must be valid');
    expect(isSyntheticObservation(generated.value)).toBe(true);
  });

  it('the boundary makes no exception for origin: synthetic observations are withheld identically', () => {
    const syntheticFuture = derivedObservation(10_000, ['anything']);
    expect(isObservationVisible(syntheticFuture, requireTimestampMs(9_999))).toBe(false);
  });
});

describe('observation validation', () => {
  it('accepts a well-formed envelope and freezes it deeply', () => {
    const observation = historicalObservation(1_000);
    expect(isObservation(observation)).toBe(true);
    expect(Object.isFrozen(observation)).toBe(true);
    expect(Object.isFrozen(observation.provenance)).toBe(true);
  });

  it('is timeless: a future-dated available_time is a VALID observation (embargo is representable)', () => {
    const future = historicalObservation(4_102_444_800_000);
    expect(validateObservation(future).ok).toBe(true);
  });

  it('collects every violation: missing and invalid fields together', () => {
    const result = validateObservation({
      available_time: 'not-a-number',
      venue: 7,
      payload: { bad: Number.NaN },
      provenance: { origin: 'legendary', source: null, derived_from: 'nope' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((error) => `${error.code}:${error.path}`);
      expect(codes).toContain('missing_field:observation.observation_id');
      expect(codes).toContain('invalid_field:observation.available_time');
      expect(codes).toContain('invalid_field:observation.venue');
      expect(codes).toContain('invalid_field:observation.payload');
      expect(codes).toContain('invalid_field:observation.provenance.origin');
      expect(codes).toContain('invalid_field:observation.provenance.derived_from');
    }
  });

  it('rejects non-JSON payloads (functions, undefined, NaN, Infinity)', () => {
    for (const payload of [Number.NaN, Number.POSITIVE_INFINITY, () => 1, undefined]) {
      const result = validateObservation({
        observation_id: 'x',
        available_time: requireTimestampMs(1),
        venue: null,
        instrument: null,
        payload,
        provenance: { origin: 'simulated', source: 'stub', derived_from: [] },
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects out-of-range and fractional available_time', () => {
    for (const availableTime of [-1, 1.5, 8_639_999_999_999_999 + 1]) {
      const result = validateObservation({
        observation_id: 'x',
        available_time: availableTime,
        venue: null,
        instrument: null,
        payload: null,
        provenance: { origin: 'simulated', source: 'stub', derived_from: [] },
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.errors[0].code).toBe('invalid_field');
    }
  });

  it('historical observations require a source (no orphan history)', () => {
    const result = validateObservation({
      observation_id: 'x',
      available_time: requireTimestampMs(1),
      venue: null,
      instrument: null,
      payload: null,
      provenance: { origin: 'historical', source: null, derived_from: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].path).toBe('observation.provenance.source');
    }
  });

  it('rejects lineage self-reference and duplicate parents', () => {
    const selfRef = validateObservation({
      observation_id: 'self',
      available_time: requireTimestampMs(1),
      venue: null,
      instrument: null,
      payload: null,
      provenance: { origin: 'simulated', source: 'agg', derived_from: ['self'] },
    });
    expect(selfRef.ok).toBe(false);

    const dupParent = validateObservation({
      observation_id: 'dup',
      available_time: requireTimestampMs(1),
      venue: null,
      instrument: null,
      payload: null,
      provenance: { origin: 'simulated', source: 'agg', derived_from: ['a', 'a'] },
    });
    expect(dupParent.ok).toBe(false);
  });

  it('non-object roots fail with invalid_type', () => {
    for (const root of [null, 42, 'x', []]) {
      expect(validateObservation(root).ok).toBe(false);
    }
  });

  it('the total guard agrees with the validator on malformed values', () => {
    expect(isObservation(null)).toBe(false);
    expect(isObservation({})).toBe(false);
    expect(isObservation(historicalObservation(1))).toBe(true);
  });
});
