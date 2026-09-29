// @tradrl/body-sentiment-researcher — observation intake tests.
//
// Behavioral: the canonical observation validation (discriminant first,
// quartet laws, provenance block laws); the L4 as-of gate (admit/defer,
// never drop); the canonical observation order; the injected source port.

import { describe, expect, it } from 'vitest';

import {
  EVENT_TYPES,
  ASSET_CLASSES,
  OBSERVATION_KINDS,
  EVENT_ORIGINS,
  validateResearchObservation,
  isNewsObservation,
  isSentimentScoreObservation,
  isResearchObservation,
  validateObservationProvenance,
  admitObservation,
  gateObservations,
  canonicalObservationOrder,
  createScriptedObservationSource,
  isObservationSource,
  classifyPulledRecord,
  type ResearchObservation,
} from './observations';
import { type TimestampMs } from './primitives';
import {
  FIXTURE_AT0,
  FIXTURE_AS_OF,
  FIXTURE_OBSERVATIONS,
  fixtureNewsObservation,
  fixtureSentimentObservation,
} from './fixtures';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = FIXTURE_AT0;

describe('observation validation', () => {
  it('accepts every golden fixture observation', () => {
    for (const observation of FIXTURE_OBSERVATIONS) {
      expect(validateResearchObservation(observation)).toEqual([]);
      expect(isResearchObservation(observation)).toBe(true);
    }
  });

  it('discriminants FIRST: a non-research event type is unknown_event_type', () => {
    const errors = validateResearchObservation({ event_type: 'trade' });
    expect(errors.map((e) => e.code)).toEqual(['unknown_event_type']);
    const none = validateResearchObservation({ event_type: 'gossip' });
    expect(none.map((e) => e.code)).toEqual(['unknown_event_type']);
  });

  it('enforces the ONE quartet ordering: available_time >= event_time (timestamp_order)', () => {
    const early = fixtureSentimentObservation({ eventId: 'obs-bad-1', at: AT0, instrument: 'TEST-AAA', score: '0.1' });
    const broken = { ...early, available_time: ms((early.event_time as number) - 1) };
    const errors = validateResearchObservation(broken);
    expect(errors.map((e) => e.code)).toContain('timestamp_order');
  });

  it('rejects a malformed social-signal value (the signed-decimal discipline)', () => {
    const broken = fixtureSentimentObservation({ eventId: 'obs-bad-2', at: AT0, instrument: 'TEST-AAA', score: 'maybe-positive' });
    expect(validateResearchObservation(broken).length).toBeGreaterThan(0);
    expect(isSentimentScoreObservation(broken)).toBe(false);
  });

  it('rejects a news payload without a headline', () => {
    const good = fixtureNewsObservation({ eventId: 'obs-bad-3', at: AT0, instrument: 'TEST-AAA', headline: 'x' });
    const broken = { ...good, payload: { ...good.payload, headline: '' } };
    expect(validateResearchObservation(broken).map((e) => e.code)).toContain('invalid_field');
    expect(isNewsObservation(broken)).toBe(false);
  });
});

describe('the provenance block (T008 mirror laws)', () => {
  const eventId = 'obs-prov-1';

  it('requires an adapter for historical origin', () => {
    const errors = validateObservationProvenance({ origin: 'historical', adapter: null, derived_from: [], transform: null }, eventId);
    expect(errors.map((e) => e.code)).toContain('provenance_adapter_required');
  });

  it('rejects self-reference', () => {
    const errors = validateObservationProvenance({ origin: 'generated', adapter: null, derived_from: [eventId], transform: 't' }, eventId);
    expect(errors.map((e) => e.code)).toContain('provenance_self_reference');
  });

  it('rejects duplicate parents', () => {
    const errors = validateObservationProvenance({ origin: 'generated', adapter: null, derived_from: ['a', 'a'], transform: 't' }, eventId);
    expect(errors.map((e) => e.code)).toContain('provenance_duplicate_parent');
  });

  it('requires a transform iff there are parents (both directions)', () => {
    const withParentsNoTransform = validateObservationProvenance({ origin: 'generated', adapter: null, derived_from: ['a'], transform: null }, eventId);
    expect(withParentsNoTransform.map((e) => e.code)).toContain('provenance_transform_required');
    const transformWithoutParents = validateObservationProvenance({ origin: 'generated', adapter: null, derived_from: [], transform: 't' }, eventId);
    expect(transformWithoutParents.map((e) => e.code)).toContain('provenance_transform_without_parents');
  });

  it('mirrors the canonical taxonomy vocabularies', () => {
    expect(EVENT_TYPES).toContain('news');
    expect(EVENT_TYPES).toContain('social_signal');
    expect(ASSET_CLASSES).toContain('equity');
    expect(OBSERVATION_KINDS).toEqual(['news', 'social_signal']);
    expect(EVENT_ORIGINS).toEqual(['historical', 'simulated', 'generated']);
  });
});

describe('the L4 as-of gate (point-in-time truth)', () => {
  it('admits observations available at or before the as-of instant', () => {
    for (const observation of FIXTURE_OBSERVATIONS) {
      expect(admitObservation(observation, FIXTURE_AS_OF)).toBe(true);
    }
  });

  it('DEFERS (never drops) an observation available after the as-of instant', () => {
    const future = fixtureSentimentObservation({
      eventId: 'obs-future-1',
      at: ms((FIXTURE_AS_OF as number) + 30_000),
      instrument: 'TEST-AAA',
      score: '0.5',
    });
    expect(admitObservation(future, FIXTURE_AS_OF)).toBe(false);
    const gated = gateObservations([...FIXTURE_OBSERVATIONS, future], FIXTURE_AS_OF);
    expect(gated.admitted.length).toBe(FIXTURE_OBSERVATIONS.length);
    expect(gated.deferred).toEqual([
      { observationId: 'obs-future-1', availableTime: future.available_time, reason: 'future_observation' },
    ]);
    // the deferred observation is NOT in the admitted set — L4
    expect(gated.admitted.includes(future)).toBe(false);
  });

  it('the boundary instant itself is admitted (<=, not <)', () => {
    const exactly = fixtureSentimentObservation({ eventId: 'obs-edge-1', at: FIXTURE_AS_OF, instrument: 'TEST-AAA', score: '0.1' });
    expect(admitObservation(exactly, FIXTURE_AS_OF)).toBe(true);
  });
});

describe('canonical observation order (the determinism law)', () => {
  it('orders by (available_time, event_id) and is presentation-order independent', () => {
    const reversed = FIXTURE_OBSERVATIONS.slice().reverse();
    const a = canonicalObservationOrder(FIXTURE_OBSERVATIONS);
    const b = canonicalObservationOrder(reversed);
    expect(a.map((o) => o.event_id)).toEqual(b.map((o) => o.event_id));
    expect(a).not.toBe(FIXTURE_OBSERVATIONS); // a copy, not the frozen input
  });
});

describe('the injected observation source port', () => {
  it('drains a scripted source deterministically', () => {
    const source = createScriptedObservationSource(
      { id: 'news-adapter', version: '1.0.0', provider: 'news-wire-a' },
      FIXTURE_OBSERVATIONS,
    );
    expect(isObservationSource(source)).toBe(true);
    const pulled: ResearchObservation[] = [];
    for (;;) {
      const next = source.next();
      if (next === null) break;
      pulled.push(next);
    }
    expect(pulled.length).toBe(FIXTURE_OBSERVATIONS.length);
    expect(source.next()).toBeNull(); // stays drained
  });

  it('classifies pulled records: admitted / unsupported / invalid', () => {
    const admitted = classifyPulledRecord(FIXTURE_OBSERVATIONS[0]);
    expect(admitted.ok && admitted.value.kind).toBe('admitted');
    const unsupported = classifyPulledRecord({ event_type: 'trade' });
    expect(unsupported.ok && unsupported.value.kind).toBe('noted');
    if (unsupported.ok && unsupported.value.kind === 'noted') {
      expect(unsupported.value.note.reason).toBe('unsupported_observation_type');
    }
    const invalid = classifyPulledRecord(42);
    expect(invalid.ok && invalid.value.kind).toBe('noted');
    if (invalid.ok && invalid.value.kind === 'noted') {
      expect(invalid.value.note.reason).toBe('invalid_observation');
    }
  });
});
