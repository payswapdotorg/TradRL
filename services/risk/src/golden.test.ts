/**
 * @tradrl/risk-engine (service) — the golden determinism fixtures (Work
 * Order T020): the byte-stable digests of the reference scenario's
 * outcomes.
 *
 * The same (steps, policies, switch logs, seed) always yields the
 * byte-identical exposures + evaluations + measures + drawdown series
 * + audit chain — the digests below pin them. The Work Order's
 * determinism acceptance: run the scenario TWICE, deep-equal (proven
 * here across every run of the suite); the serialized run state is
 * byte-identical too. A contract or engine change that alters the byte
 * output changes these constants — visibly.
 */

import { describe, expect, it } from 'vitest';

import {
  GOLDEN_AUDIT_RECORD_COUNT,
  GOLDEN_BLOCKED_SWITCH_STATES,
  GOLDEN_BREACHING_TOTAL,
  GOLDEN_DRAWDOWN_SERIES,
  GOLDEN_EVALUATION_COUNT,
  GOLDEN_EXPOSURE_COUNT,
  GOLDEN_MEASURE_COUNT,
  GOLDEN_POLICY_VERSIONS,
  GOLDEN_RUN_DIGEST,
  GOLDEN_STEP_COUNT,
  driveReferenceScenario,
  riskRunDigest,
  serializeRiskRunState,
} from './index';
import { retainedPolicyVersions } from '../../../packages/risk/src/index';

describe('the golden determinism fixtures', () => {
  it('the reference scenario digest is byte-stable (run twice, deep-equal)', () => {
    const first = driveReferenceScenario();
    if (!first.ok) throw new Error(JSON.stringify(first.errors));
    const second = driveReferenceScenario();
    if (!second.ok) throw new Error(JSON.stringify(second.errors));
    // Deep-equal, twice — the determinism acceptance.
    expect(second.value).toEqual(first.value);
    expect(riskRunDigest(first.value)).toBe(GOLDEN_RUN_DIGEST);
    expect(riskRunDigest(second.value)).toBe(GOLDEN_RUN_DIGEST);
  });

  it('the reference scenario\'s counts pin the documented shape', () => {
    const run = driveReferenceScenario();
    if (!run.ok) throw new Error(JSON.stringify(run.errors));
    expect(run.value.processedStepIds).toHaveLength(GOLDEN_STEP_COUNT);
    expect(run.value.exposures).toHaveLength(GOLDEN_EXPOSURE_COUNT);
    expect(run.value.evaluations).toHaveLength(GOLDEN_EVALUATION_COUNT);
    expect(run.value.measures).toHaveLength(GOLDEN_MEASURE_COUNT);
    expect(run.value.auditTrail.records).toHaveLength(GOLDEN_AUDIT_RECORD_COUNT);
    expect(retainedPolicyVersions(run.value.policyTrail)).toHaveLength(GOLDEN_POLICY_VERSIONS);
    expect(run.value.drawdownSeries.map((point) => point.drawdown)).toEqual([...GOLDEN_DRAWDOWN_SERIES]);
    const breaching = run.value.evaluations.reduce((total, evaluation) => total + evaluation.states.filter((state) => state.state === 'breaching').length, 0);
    const blocked = run.value.evaluations.reduce((total, evaluation) => total + evaluation.states.filter((state) => state.state === 'blocked').length, 0);
    expect(breaching).toBe(GOLDEN_BREACHING_TOTAL);
    expect(blocked).toBe(GOLDEN_BLOCKED_SWITCH_STATES);
  });

  it('the serialized run state is byte-deterministic (twice)', () => {
    const first = driveReferenceScenario();
    if (!first.ok) throw new Error(JSON.stringify(first.errors));
    const second = driveReferenceScenario();
    if (!second.ok) throw new Error(JSON.stringify(second.errors));
    const firstBytes = serializeRiskRunState(first.value);
    const secondBytes = serializeRiskRunState(second.value);
    if (!firstBytes.ok || !secondBytes.ok) throw new Error('serialization must succeed');
    expect(secondBytes.value).toBe(firstBytes.value);
  });
});
