import { describe, expect, it } from 'vitest';

import {
  createSimulationClock,
  leakageCheck,
  requireTimestampMs,
  type Observable,
  type SimulationClock,
  type TimeResult,
  type TrajectorySample,
} from './index';

function unwrap<T>(result: TimeResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${result.error.code}: ${result.error.message}`);
}

function mkClock(now: number): SimulationClock {
  return unwrap(
    createSimulationClock({ asOf: requireTimestampMs(1_000_000), now: requireTimestampMs(now), fidelity: 'reactive_replay' }),
  );
}

interface StubObservation extends Observable {
  readonly id: string;
  readonly available_time: number & { readonly __brand: 'TradRL.TimestampMs' };
}

function obs(id: string, availableTime: number): StubObservation {
  return { id, available_time: requireTimestampMs(availableTime) };
}

describe('leakageCheck', () => {
  it('certifies a clean trajectory with full counts', () => {
    const trajectory: TrajectorySample<StubObservation>[] = [
      { clock: mkClock(1_000), observed: [obs('a', 500), obs('b', 1_000)] }, // boundary-inclusive at now
      { clock: mkClock(1_500), observed: [obs('c', 1_200)] },
    ];
    const report = leakageCheck(trajectory);
    expect(report.clean).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.samplesChecked).toBe(2);
    expect(report.observationsChecked).toBe(3);
  });

  it('catches a future observation and reports its lead', () => {
    const trajectory: TrajectorySample<StubObservation>[] = [
      { clock: mkClock(1_000), observed: [obs('ok', 800), obs('leak', 1_250)], label: 'step-1' },
    ];
    const report = leakageCheck(trajectory);
    expect(report.clean).toBe(false);
    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0];
    expect(finding?.kind).toBe('future_observation');
    if (finding?.kind === 'future_observation') {
      expect(finding.sampleIndex).toBe(0);
      expect(finding.observationIndex).toBe(1);
      expect(finding.label).toBe('step-1');
      expect(finding.clockNow).toBe(1_000);
      expect(finding.available_time).toBe(1_250);
      expect(finding.leadMs).toBe(250);
    }
  });

  it('reports every violation, not just the first', () => {
    const trajectory: TrajectorySample<StubObservation>[] = [
      { clock: mkClock(1_000), observed: [obs('l1', 1_001), obs('l2', 2_000), obs('fine', 999)] },
      { clock: mkClock(1_100), observed: [obs('l3', 9_999)] },
    ];
    const report = leakageCheck(trajectory);
    expect(report.clean).toBe(false);
    expect(report.findings).toHaveLength(3);
    const leads = report.findings.map((f) => (f.kind === 'future_observation' ? f.leadMs : -1));
    expect(leads).toEqual([1, 1_000, 8_899]);
  });

  it('flags a clock regression in the trajectory recording itself', () => {
    const trajectory: TrajectorySample<StubObservation>[] = [
      { clock: mkClock(2_000), observed: [] },
      { clock: mkClock(1_500), observed: [], label: 'out-of-order' },
    ];
    const report = leakageCheck(trajectory);
    expect(report.clean).toBe(false);
    const finding = report.findings[0];
    expect(finding?.kind).toBe('clock_regression');
    if (finding?.kind === 'clock_regression') {
      expect(finding.sampleIndex).toBe(1);
      expect(finding.fromNow).toBe(2_000);
      expect(finding.toNow).toBe(1_500);
    }
  });

  it('treats an observation exactly at now as legitimate (inclusive boundary)', () => {
    const trajectory: TrajectorySample<StubObservation>[] = [
      { clock: mkClock(1_000), observed: [obs('exact', 1_000)] },
    ];
    expect(leakageCheck(trajectory).clean).toBe(true);
  });

  it('handles an empty trajectory', () => {
    const report = leakageCheck([]);
    expect(report.clean).toBe(true);
    expect(report.samplesChecked).toBe(0);
    expect(report.observationsChecked).toBe(0);
  });
});
