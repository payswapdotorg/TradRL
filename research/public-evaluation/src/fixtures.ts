/**
 * @tradrl/research-public-evaluation — test and documentation fixtures
 * (Work Order T049). Trusted-literal builders for this package's own
 * tests: publication policies, a measured fixture (compiled through the
 * REAL own-lane machinery over the machinery's fixtures), and the
 * assembled publication inputs. The interop tests replace the machinery
 * fixtures with the REAL T048 report and the REAL merged lanes.
 */

import { deepFreeze } from './primitives';
import type { JsonValue, TimestampMs } from './primitives';
import { requireTimestampMs } from './primitives';
import { runSuiteMeasurement } from './imports';
import type { MeasurementRecord, SliceReportMirror, MaterialSource, SplitPlanMirror, SearchRecordMirror, SuiteDefinition, SubjectBinding } from './imports';
import {
  T0,
  DAY,
  TENANT,
  PROJECT,
  fixtureSliceReport,
  fixturePlatformSuiteRecord,
  fixtureReplaySource,
  fixtureSplitPlan,
  fixtureSearchRecord,
  fixtureSubject,
  fixtureHoldoutReplaySource,
} from '../../../benchmarks/platform/src/fixtures';
import type { PublicationPolicy } from './gate';

export { T0, DAY, TENANT, PROJECT };

/** The publication instant of the fixture publications (after the measurement instant). */
export const PUBLISHED_AT: TimestampMs = requireTimestampMs(T0 + 60_000);

/** The default publication policy: every axis of the platform fixture suite is public. */
export function fixturePolicy(): PublicationPolicy {
  return deepFreeze({ publicAxes: ['crypto-events', 'news-events', 'frames', 'lanes-consumed', 'intents', 'step2-intents', 'routed', 'refusals', 'audit-records', 'world-fills', 'outcome-records', 'realized-pnl', 'cash', 'report-digest', 'outcome-digest', 'audit-coherent', 'refusals-cost-zero', 'paper-goals-bound', 'live-goals-bound', 'clocks-separated'] });
}

/** A minimal policy: the headline counts only. */
export function fixtureMinimalPolicy(): PublicationPolicy {
  return deepFreeze({ publicAxes: ['crypto-events', 'routed', 'refusals', 'audit-coherent'] });
}

/** A measured fixture over the machinery's own fixtures (the REAL own-lane runner). */
export function fixtureMeasurement(): MeasurementRecord {
  const result = runSuiteMeasurement({
    suite: fixturePlatformSuiteRecord(),
    subject: fixtureSubject(),
    evidence: fixtureSliceReport() as unknown as SliceReportMirror,
    material: fixtureReplaySource() as MaterialSource,
    phase: 'in-search',
    search: null,
    plan: fixtureSplitPlan() as SplitPlanMirror,
    measured_at: requireTimestampMs(T0 + 30_000),
  });
  if (!result.ok) {
    throw new Error(`the fixture measurement must compile: ${result.errors.map((error) => error.message).join('; ')}`);
  }
  return result.value;
}

/** A holdout measured fixture (reserved material + the bound search). */
export function fixtureHoldoutMeasurement(): MeasurementRecord {
  const result = runSuiteMeasurement({
    suite: fixturePlatformSuiteRecord(),
    subject: fixtureSubject(),
    evidence: fixtureSliceReport() as unknown as SliceReportMirror,
    material: fixtureHoldoutReplaySource() as MaterialSource,
    phase: 'holdout',
    search: { record: fixtureSearchRecord() as unknown as SearchRecordMirror, trial: 'trial-fixture-holdout-0001' },
    plan: fixtureSplitPlan() as SplitPlanMirror,
    measured_at: requireTimestampMs(T0 + 40_000),
  });
  if (!result.ok) {
    throw new Error(`the holdout fixture measurement must compile: ${result.errors.map((error) => error.message).join('; ')}`);
  }
  return result.value;
}

/** Operator attachments that NEVER publish (the gate's negative fixtures). */
export const CHAIN_OF_THOUGHT_ATTACHMENT: JsonValue = deepFreeze({
  context: { summary: 'the run looked good', reasoning: 'we reasoned the strategy would hold up because the backtest said so' },
});

export const TENANT_DATA_ATTACHMENT: JsonValue = deepFreeze({
  context: { note: 'supporting material', orders: [{ id: 'ord-1', side: 'buy', size: '0.20' }], positions: [{ instrument: 'BTC-USDT', quantity: '0.20' }] },
});

/** The re-exported machinery fixture surface (the interop tests reach the REAL lanes directly). */
export {
  fixtureSliceReport,
  fixturePlatformSuiteRecord,
  fixtureReplaySource,
  fixtureSplitPlan,
  fixtureSearchRecord,
  fixtureSubject,
  fixtureHoldoutReplaySource,
};
export type { SuiteDefinition, SubjectBinding };
