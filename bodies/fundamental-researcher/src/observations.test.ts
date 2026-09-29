// @tradrl/body-fundamental-researcher — the observation intake tests.
//
// Behavioral: the T038 emitter-shape mirrors (reported fundamentals,
// macro releases, corporate-action escape-hatch records), the quartet
// law, the provenance block invariants, THE L4 GATE (future observations
// are deferred, never consumed), the canonical knowledge-time order, the
// source port discipline. Negative paths: unknown event types, broken
// quartets, provenance violations, non-decimal reported values, non
// corporate_action escape hatches.

import { describe, expect, it } from 'vitest';
import {
  FUNDAMENTAL_OBSERVATION_KINDS,
  canonicalObservationOrder,
  classifyPulledRecord,
  createScriptedObservationSource,
  gateObservations,
  isCorporateActionObservation,
  isFundamentalDatumObservation,
  isFundamentalObservation,
  isFundamentalObservationSource,
  isMacroReleaseObservation,
  validateFundamentalObservation,
  validateObservationProvenance,
} from './observations';
import {
  FIXTURE_OBSERVATIONS,
  fixtureActionObservation,
  fixtureFundamentalObservation,
  fixtureMacroObservation,
} from './fixtures';
import { isDeeplyFrozen } from './primitives';
import { type TimestampMs } from './primitives';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_717_423_200_000;

describe('the fixture observation set (T038 emitter shapes)', () => {
  it('every golden observation validates against the lane mirrors', () => {
    expect(FIXTURE_OBSERVATIONS.length).toBe(14);
    for (const observation of FIXTURE_OBSERVATIONS) {
      expect(isFundamentalObservation(observation)).toBe(true);
      expect(validateFundamentalObservation(observation)).toEqual([]);
    }
  });

  it('the discriminants narrow correctly', () => {
    for (const observation of FIXTURE_OBSERVATIONS) {
      if (observation.event_type === 'fundamental') expect(isFundamentalDatumObservation(observation)).toBe(true);
      if (observation.event_type === 'macro_release') expect(isMacroReleaseObservation(observation)).toBe(true);
      if (observation.event_type === 'other') expect(isCorporateActionObservation(observation)).toBe(true);
    }
    expect([...FUNDAMENTAL_OBSERVATION_KINDS]).toEqual(['fundamental', 'macro_release', 'other']);
  });

  it('the fixtures are deeply frozen', () => {
    expect(isDeeplyFrozen(FIXTURE_OBSERVATIONS)).toBe(true);
  });
});

describe('quartet + envelope validation', () => {
  it('an observation whose available_time precedes event_time is a typed timestamp_order error', () => {
    const broken = { ...FIXTURE_OBSERVATIONS[0], available_time: ms(AT0 - 1) };
    const errors = validateFundamentalObservation(broken);
    expect(errors.map((e) => e.code)).toContain('timestamp_order');
  });

  it('a non-decimal reported value is invalid-for-this-lane (the exact-arithmetic floor)', () => {
    const broken = fixtureFundamentalObservation({
      eventId: 'obs-bad-value',
      at: ms(AT0),
      instrument: 'TEST-LARGECAP',
      field: 'INDEX_LEVEL',
      period: '2024-06-03',
      value: 'N/A',
    });
    const errors = validateFundamentalObservation(broken);
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('reported-fundamental payload')]),
    );
  });

  it('a macro release without a decimal forecast is invalid-for-this-lane', () => {
    const broken = fixtureMacroObservation({ eventId: 'obs-bad-forecast', at: ms(AT0), instrument: 'TEST-ECON-CPI', period: '2024-05', actual: '3.3', forecast: 'soon' });
    expect(validateFundamentalObservation(broken).length).toBeGreaterThan(0);
  });

  it('an unknown event type is the unknown_event_type typed error', () => {
    const errors = validateFundamentalObservation({ event_type: 'quote', payload: {} });
    expect(errors[0]?.code).toBe('unknown_event_type');
  });

  it('a non corporate_action escape-hatch record is refused (unknown_event_type)', () => {
    const stray = {
      ...fixtureActionObservation({ eventId: 'obs-stray', at: ms(AT0), instrument: 'TEST-AAA', action: 'split', effectiveDate: '2024-06-10', ratio: '4:1' }),
      payload: { kind: 'index_constituent_weight', data: { symbol: 'TEST-AAA', weight: '0.0694' } },
    };
    const errors = validateFundamentalObservation(stray);
    expect(errors[0]?.code).toBe('unknown_event_type');
    expect(errors[0]?.message).toContain('corporate_action');
  });

  it('a malformed corporate-action record is invalid (malformed ratio, date, currency)', () => {
    const cases = [
      { ratio: '4-to-1' },
      { effectiveDate: '2024/06/10' },
      { currency: 'dollars' },
    ];
    for (const patch of cases) {
      const broken = fixtureActionObservation({
        eventId: 'obs-bad-action',
        at: ms(AT0),
        instrument: 'TEST-AAA',
        action: 'split',
        effectiveDate: patch.effectiveDate ?? '2024-06-10',
        ratio: patch.ratio ?? '4:1',
        currency: patch.currency ?? 'USD',
      });
      expect(validateFundamentalObservation(broken).length).toBeGreaterThan(0);
    }
  });
});

describe('the provenance block (T008 mirror)', () => {
  it('the fixture blocks validate under the mirrored invariants', () => {
    for (const observation of FIXTURE_OBSERVATIONS) {
      expect(validateObservationProvenance(observation.provenance, observation.event_id)).toEqual([]);
    }
  });

  it('historical observations must cite their adapter (provenance_adapter_required)', () => {
    const errors = validateObservationProvenance({ origin: 'historical', adapter: null, derived_from: [], transform: null }, 'x');
    expect(errors[0]?.code).toBe('provenance_adapter_required');
  });

  it('a derivation must declare its transform, and vice versa', () => {
    const noTransform = validateObservationProvenance({ origin: 'simulated', adapter: null, derived_from: ['parent-1'], transform: null }, 'x');
    expect(noTransform[0]?.code).toBe('provenance_transform_required');
    const noParents = validateObservationProvenance({ origin: 'simulated', adapter: null, derived_from: [], transform: 'sum' }, 'x');
    expect(noParents[0]?.code).toBe('provenance_transform_without_parents');
  });

  it('self-reference and duplicate parents are typed errors', () => {
    const self = validateObservationProvenance({ origin: 'simulated', adapter: null, derived_from: ['x'], transform: 't' }, 'x');
    expect(self[0]?.code).toBe('provenance_self_reference');
    const dup = validateObservationProvenance({ origin: 'simulated', adapter: null, derived_from: ['a', 'a'], transform: 't' }, 'x');
    expect(dup[0]?.code).toBe('provenance_duplicate_parent');
  });
});

describe('THE L4 GATE (point-in-time truth)', () => {
  it('defers — never consumes — observations available after the as-of instant', () => {
    const future = fixtureFundamentalObservation({ eventId: 'obs-future-1', at: ms(AT0 + 120_000), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '200.0000' });
    const gated = gateObservations([...FIXTURE_OBSERVATIONS, future], ms(AT0 + 60_000));
    expect(gated.admitted.length).toBe(FIXTURE_OBSERVATIONS.length);
    expect(gated.deferred.length).toBe(1);
    expect(gated.deferred[0]?.observationId).toBe('obs-future-1');
    expect(gated.deferred[0]?.reason).toBe('future_observation');
    // the future observation is NOT among the admitted (L4)
    expect(gated.admitted.some((o) => o.event_id === 'obs-future-1')).toBe(false);
  });

  it('admits an observation exactly at the as-of instant (the boundary)', () => {
    const gated = gateObservations(FIXTURE_OBSERVATIONS.slice(0, 1), FIXTURE_OBSERVATIONS[0]!.available_time);
    expect(gated.admitted.length).toBe(1);
    expect(gated.deferred.length).toBe(0);
  });

  it('the gate is pure: gating twice yields identical buckets', () => {
    const asOf = ms(AT0 + 60_000);
    expect(gateObservations(FIXTURE_OBSERVATIONS, asOf)).toEqual(gateObservations(FIXTURE_OBSERVATIONS, asOf));
  });
});

describe('the canonical knowledge-time order', () => {
  it('sorts by (available_time, event_id) — presentation order cannot leak', () => {
    const reversed = [...FIXTURE_OBSERVATIONS].reverse();
    expect(canonicalObservationOrder(reversed)).toEqual(canonicalObservationOrder(FIXTURE_OBSERVATIONS));
    const ordered = canonicalObservationOrder(FIXTURE_OBSERVATIONS);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      expect(previous.available_time <= current.available_time).toBe(true);
      if (previous.available_time === current.available_time) {
        expect(previous.event_id <= current.event_id).toBe(true);
      }
    }
  });
});

describe('the source port + pulled-record classification', () => {
  it('a scripted source drains in order and then returns null', () => {
    const source = createScriptedObservationSource(
      { id: 'test-source', version: '1.0.0', provider: 'test' },
      FIXTURE_OBSERVATIONS.slice(0, 3),
    );
    expect(isFundamentalObservationSource(source)).toBe(true);
    expect(source.next()?.event_id).toBe(FIXTURE_OBSERVATIONS[0]?.event_id);
    expect(source.next()?.event_id).toBe(FIXTURE_OBSERVATIONS[1]?.event_id);
    expect(source.next()?.event_id).toBe(FIXTURE_OBSERVATIONS[2]?.event_id);
    expect(source.next()).toBeNull();
  });

  it('classifies valid, invalid and unsupported records (nothing silently dropped)', () => {
    const valid = classifyPulledRecord(FIXTURE_OBSERVATIONS[0]);
    expect(valid.ok && valid.value.kind).toBe('admitted');
    // shape-valid but law-invalid (a provenance self-reference passes the
    // structural guard, fails the validation laws) -> invalid_observation
    const first = FIXTURE_OBSERVATIONS[0]!;
    const lawBreaking = {
      ...first,
      provenance: { ...first.provenance, derived_from: [first.event_id], transform: 't' },
    };
    const invalid = classifyPulledRecord(lawBreaking);
    expect(invalid.ok && invalid.value.kind === 'noted' && invalid.value.note.reason).toBe('invalid_observation');
    if (invalid.ok && invalid.value.kind === 'noted') {
      expect(invalid.value.note.detail).toBe('provenance_self_reference');
    }
    const unsupported = classifyPulledRecord({ event_type: 'quote', payload: {} });
    expect(unsupported.ok && unsupported.value.kind === 'noted' && unsupported.value.note.reason).toBe('unsupported_observation_type');
    const notAnObject = classifyPulledRecord(42);
    expect(notAnObject.ok && notAnObject.value.kind === 'noted' && notAnObject.value.note.reason).toBe('invalid_observation');
  });
});
