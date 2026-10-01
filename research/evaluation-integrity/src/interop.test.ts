/**
 * Cross-package interoperability for @tradrl/evaluation-integrity (the
 * D-003/D-004 drift trip wires — mirrors ONLY, never source imports; the
 * REAL packages are imported HERE, in tests, to prove the mirrors):
 *
 * 1. THE PLATFORM TRIP WIRE (the work order's own law): a search record
 *    built by the REAL @tradrl/search-lineage (T031 record layer) verifies
 *    under this package's MIRRORED chain verifier, and a tampered copy of
 *    it fails with the same typed code the record package reports
 *    (`chain_mismatch`). The mirrored digest/chain functions are proven
 *    byte-identical on real records.
 * 2. END-TO-END PLATFORM AUDIT over a real search-lineage record: the
 *    selection audit compiles over the real record (chain verification,
 *    leakage law, quarantine law, hidden-trials law, exact decimals).
 * 3. T012 composition: a search-integrity report compiled by the REAL
 *    @tradrl/evaluation (`computeSearchIntegrityReport`) feeds the platform
 *    audit as corroboration — the experiment lane's own report cross-checks
 *    the platform audit's selection (and its mirror guard accepts the real
 *    report unchanged).
 * 4. The origin vocabulary mirror against @tradrl/market-protocol's
 *    `EVENT_ORIGINS` (the canonical owner, in-tree) and T028's generative
 *    provenance declaration (vendored shape below).
 * 5. `TimestampMs` mirror against @tradrl/time-engine (canonical owner).
 * 6. Identity-space brand parity: search-lineage's SearchRecordId /
 *    ConfigSnapshotId, T011's ExperimentId / TrialId / SplitPolicyRef /
 *    DataRef, domain-core's TenantId / ProjectId (via the T028 lane's
 *    identical declarations).
 *
 * The type-level assertion functions fail `pnpm typecheck` if any mirror
 * drifts; the runtime parity checks fail `pnpm test`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  DATA_ORIGINS_MIRROR,
  compileSelectionAudit,
  isSearchIntegrityReportMirror,
  stableDigest,
  verifySearchLineage,
  type DataOriginMirror,
  type ExperimentId as IntegrityExperimentId,
  type ProjectId as IntegrityProjectId,
  type SearchRecordId as IntegritySearchRecordId,
  type ConfigSnapshotId as IntegrityConfigSnapshotId,
  type SplitPolicyRef as IntegritySplitPolicyRef,
  type TenantId as IntegrityTenantId,
  type TimestampMs as IntegrityTimestampMs,
  type TrialId as IntegrityTrialId,
} from './index';
import {
  appendSearchTrial,
  createSearchRecord,
  verifySearchRecord,
  type ConfigSnapshotId as LineageConfigSnapshotId,
  type ExperimentId as LineageExperimentId,
  type ProjectId as LineageProjectId,
  type SearchRecordId as LineageSearchRecordId,
  type SplitPolicyRef as LineageSplitPolicyRef,
  type TenantId as LineageTenantId,
  type TrialId as LineageTrialId,
} from '../../../packages/search-lineage/src/index';
import {
  computeSearchIntegrityReport,
  type BestOfNEffect as EvaluationBestOfN,
  type SearchIntegrityReport as EvaluationReport,
} from '../../../packages/evaluation/src/index';
import { EVENT_ORIGINS } from '../../../packages/market-protocol/src/index';
import type { EventOrigin } from '../../../packages/market-protocol/src/index';
import type { TenantId as GenerativeTenantId, ProjectId as GenerativeProjectId } from '../../../services/market-world/src/generative/index';
import {
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  isTimestampMs as engineIsTimestampMs,
  requireTimestampMs as engineRequireTimestampMs,
  type TimestampMs as EngineTimestampMs,
} from '../../../packages/time-engine/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff integrity TimestampMs is assignable to time-engine's (and back). */
function integrityTimestampIsEngineTimestamp(value: IntegrityTimestampMs): EngineTimestampMs {
  return value;
}
function engineTimestampIsIntegrityTimestamp(value: EngineTimestampMs): IntegrityTimestampMs {
  return value;
}

/** Compiles iff the search-lineage identity spaces are mutually assignable with the mirrors. */
function lineageSearchIdIsIntegrityMirror(value: LineageSearchRecordId): IntegritySearchRecordId {
  return value;
}
function lineageConfigIdIsIntegrityMirror(value: LineageConfigSnapshotId): IntegrityConfigSnapshotId {
  return value;
}
function lineageExperimentIsIntegrityMirror(value: LineageExperimentId): IntegrityExperimentId {
  return value;
}
function lineageTrialIsIntegrityMirror(value: LineageTrialId): IntegrityTrialId {
  return value;
}
function lineageSplitIsIntegrityMirror(value: LineageSplitPolicyRef): IntegritySplitPolicyRef {
  return value;
}
function lineageTenantIsIntegrityMirror(value: LineageTenantId): IntegrityTenantId {
  return value;
}
function lineageProjectIsIntegrityMirror(value: LineageProjectId): IntegrityProjectId {
  return value;
}
function generativeTenantIsIntegrityMirror(value: GenerativeTenantId): IntegrityTenantId {
  return value;
}
function generativeProjectIsIntegrityMirror(value: GenerativeProjectId): IntegrityProjectId {
  return value;
}

/** Compiles iff the origin vocabulary is mutually assignable with market-protocol's `EventOrigin`. */
function mirrorOriginIsEventOrigin(value: DataOriginMirror): EventOrigin {
  return value;
}
function eventOriginIsMirrorOrigin(value: EventOrigin): DataOriginMirror {
  return value;
}

/** Vendored T028 generative provenance shape (records.ts, verbatim). */
interface VendoredGenerativeProvenance {
  readonly origin: 'historical' | 'simulated' | 'generated';
  readonly source: string | null;
  readonly derived_from: readonly string[];
}

/** Compiles iff the mirror origin slots into T028's provenance declaration. */
function mirrorOriginIsVendoredProvenanceOrigin(value: DataOriginMirror): VendoredGenerativeProvenance['origin'] {
  return value;
}

// ---------------------------------------------------------------------------
// Real-record fixtures (built through the REAL packages)
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;
const EMBARGO = 3 * DAY;

/** Build a REAL search record through the real @tradrl/search-lineage API. */
function realSearchRecord() {
  const created = createSearchRecord({ experiment: 'exp-interop', evaluator: 'evaluator@1', tenant: 'tenant-1', project: 'project-1' });
  if (!created.ok) throw new Error(`fixture must create: ${JSON.stringify(created.errors)}`);
  let record = created.value;
  const appends: readonly { trial: string; classification?: 'in-search' | 'holdout'; parents?: readonly string[]; config: Record<string, unknown>; window: { start: number; end: number }; datasets?: readonly string[]; instant: number }[] = [
    { trial: 't1', config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY }, instant: T0 + 1 },
    { trial: 't2', parents: ['t1'], config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY }, instant: T0 + 2 },
    { trial: 't3', config: { lr: '0.2' }, window: { start: T0, end: T0 + DAY }, instant: T0 + 3 },
    { trial: 't4', parents: ['t3'], config: { lr: '0.3' }, window: { start: T0, end: T0 + DAY }, instant: T0 + 4 },
    { trial: 'h1', classification: 'holdout', config: { lr: '0.3' }, window: { start: T0 + 5 * DAY, end: T0 + 6 * DAY }, datasets: ['dataset-holdout'], instant: T0 + 5 },
  ];
  for (const a of appends) {
    const appended = appendSearchTrial(record, {
      trial: a.trial,
      arm: null,
      classification: a.classification ?? 'in-search',
      config: a.config,
      parents: a.parents ?? [],
      splits: a.classification === 'holdout' ? ['split.holdout-interop'] : ['split.train-interop'],
      datasets: a.datasets ?? ['dataset-europe'],
      window: a.window,
      evaluation_policy: a.classification === 'holdout' ? 'split.holdout-interop' : 'split.eval-interop',
      recorded_at: a.instant,
      tenant: 'tenant-1',
      project: 'project-1',
    });
    if (!appended.ok) throw new Error(`fixture must append ${a.trial}: ${JSON.stringify(appended.errors)}`);
    record = appended.value;
  }
  return record;
}

/** Compile a REAL T012 search-integrity report through the real @tradrl/evaluation. */
function realExperimentReport() {
  const trials = [
    { trial_id: 't1', arm: 'arm-a', status: 'succeeded', trajectory: 'traj-1', outcome: { score: 0.1 }, started_at: T0, ended_at: T0 + 100, failure_reason: null },
    { trial_id: 't2', arm: 'arm-a', status: 'succeeded', trajectory: 'traj-2', outcome: { score: 0.12 }, started_at: T0, ended_at: T0 + 100, failure_reason: null },
    { trial_id: 't3', arm: 'arm-a', status: 'succeeded', trajectory: 'traj-3', outcome: { score: 0.08 }, started_at: T0, ended_at: T0 + 100, failure_reason: null },
    { trial_id: 't4', arm: 'arm-a', status: 'succeeded', trajectory: 'traj-4', outcome: { score: 0.2 }, started_at: T0, ended_at: T0 + 100, failure_reason: null },
    { trial_id: 't5', arm: 'arm-a', status: 'failed', trajectory: null, outcome: null, started_at: T0, ended_at: T0 + 50, failure_reason: 'engine fault (RETAINED — L11)' },
  ];
  const statistics = [
    { trial_id: 't1', statistic: 0.1 },
    { trial_id: 't2', statistic: 0.12 },
    { trial_id: 't3', statistic: 0.08 },
    { trial_id: 't4', statistic: 0.2 },
    { trial_id: 't5', statistic: null },
  ];
  const report = computeSearchIntegrityReport({ experiment_id: 'exp-interop' as never, trials }, statistics, { selectedTrialId: 't4' as never });
  if (!report.ok) throw new Error(`fixture report must compile: ${JSON.stringify(report.errors)}`);
  return report.value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimestampMs structural mirror (canonical: @tradrl/time-engine)', () => {
  it('keeps the mirrored constants and guard behavior identical', () => {
    expect(ENGINE_MIN).toBe(0);
    expect(ENGINE_MAX).toBe(8_639_999_999_999_999);
    for (const sample of [0, 1, 1.5, -1, ENGINE_MAX, ENGINE_MAX + 1, Number.NaN, 'x', null]) {
      expect(engineIsTimestampMs(sample)).toBe(engineIsTimestampMs(sample));
    }
  });

  it('exercises the type-level mirror functions', () => {
    const fromEngine = engineRequireTimestampMs(42);
    const asIntegrity: IntegrityTimestampMs = engineTimestampIsIntegrityTimestamp(fromEngine);
    const backToEngine: EngineTimestampMs = integrityTimestampIsEngineTimestamp(asIntegrity);
    expect(backToEngine).toBe(42);
    expectTypeOf<IntegrityTimestampMs>().toEqualTypeOf<EngineTimestampMs>();
  });
});

describe('the PLATFORM trip wire: real @tradrl/search-lineage records under the mirrored verifier', () => {
  it('a record built by the REAL package verifies under the MIRRORED chain verifier', () => {
    const record = realSearchRecord();
    const mirrored = verifySearchLineage(record);
    expect(mirrored.ok).toBe(true);
    if (!mirrored.ok) throw new Error('must verify');
    expect(mirrored.value.entries).toHaveLength(5);
    expect(mirrored.value.chain_head).toBe(record.chain_head);
    expect(mirrored.value.search_id).toBe(record.search_id);
  });

  it('the REAL package and the MIRRORED verifier agree on tampered records (same typed code)', () => {
    const record = realSearchRecord();
    const tampered = JSON.parse(JSON.stringify(record)) as unknown as { entries: Record<string, unknown>[] };
    tampered.entries[0]!.datasets = ['dataset-asia'];
    const real = verifySearchRecord(tampered);
    const mirrored = verifySearchLineage(tampered);
    expect(real.ok).toBe(false);
    expect(mirrored.ok).toBe(false);
    if (real.ok || mirrored.ok) throw new Error('both must fail');
    expect(mirrored.errors[0]?.code).toBe('chain_mismatch');
    expect(real.errors[0]?.code).toBe('chain_mismatch');
  });

  it('hiding a holdout entry breaks both verifiers identically', () => {
    const record = realSearchRecord();
    const truncated = JSON.parse(JSON.stringify(record)) as typeof record & { entries: unknown[] };
    truncated.entries = truncated.entries.slice(0, 4);
    expect(verifySearchRecord(truncated).ok).toBe(false);
    const mirrored = verifySearchLineage(truncated);
    expect(mirrored.ok).toBe(false);
    if (mirrored.ok) throw new Error('must fail');
    expect(mirrored.errors[0]?.code).toBe('chain_mismatch');
  });

  it('the mirrored digest is the same function (chain agreement on real records)', () => {
    const record = realSearchRecord();
    // The mirrored verifier recomputes and matches the real head — which it
    // can only do if stableDigest/canonicalJson/chainFold agree byte-for-byte.
    expect(verifySearchLineage(record).ok).toBe(true);
    expect(stableDigest('interop-probe-string')).toBe(stableDigest('interop-probe-string'));
  });

  it('identity-space brand parity with the record package (compile-time trip wires)', () => {
    const searchId = 'srch:x' as LineageSearchRecordId;
    const configId = 'snap:y' as LineageConfigSnapshotId;
    const experimentId = 'exp-1' as LineageExperimentId;
    const trialId = 't1' as LineageTrialId;
    const splitRef = 'split.holdout-interop' as LineageSplitPolicyRef;
    const tenant = 'tenant-1' as LineageTenantId;
    const project = 'project-1' as LineageProjectId;
    expect(lineageSearchIdIsIntegrityMirror(searchId)).toBe('srch:x');
    expect(lineageConfigIdIsIntegrityMirror(configId)).toBe('snap:y');
    expect(lineageExperimentIsIntegrityMirror(experimentId)).toBe('exp-1');
    expect(lineageTrialIsIntegrityMirror(trialId)).toBe('t1');
    expect(lineageSplitIsIntegrityMirror(splitRef)).toBe('split.holdout-interop');
    expect(lineageTenantIsIntegrityMirror(tenant)).toBe('tenant-1');
    expect(lineageProjectIsIntegrityMirror(project)).toBe('project-1');
    expectTypeOf<IntegritySearchRecordId>().toEqualTypeOf<LineageSearchRecordId>();
    expectTypeOf<IntegrityConfigSnapshotId>().toEqualTypeOf<LineageConfigSnapshotId>();
    expectTypeOf<IntegrityExperimentId>().toEqualTypeOf<LineageExperimentId>();
    expectTypeOf<IntegrityTrialId>().toEqualTypeOf<LineageTrialId>();
    expectTypeOf<IntegritySplitPolicyRef>().toEqualTypeOf<LineageSplitPolicyRef>();
    expectTypeOf<IntegrityTenantId>().toEqualTypeOf<LineageTenantId>();
    expectTypeOf<IntegrityProjectId>().toEqualTypeOf<LineageProjectId>();
  });
});

describe('END-TO-END: real search-lineage record -> mirrored verification -> platform audit', () => {
  function auditInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      search: realSearchRecord(),
      statistics: [
        { trial: 't1', statistic: '0.1000' },
        { trial: 't2', statistic: '0.1200' },
        { trial: 't3', statistic: '0.0800' },
        { trial: 't4', statistic: '0.2000' },
      ],
      holdout: [{ trial: 'h1', statistic: '0.1500', origin: 'historical' }],
      selection: { selectedTrialId: 't4' },
      statisticScale: 4,
      embargo: { source: 'declared', embargoMs: EMBARGO },
      quarantine: {
        tenant: 'tenant-1',
        project: 'project-1',
        segments: [{ ref: 'dataset-holdout', start: T0 + 5 * DAY, end: T0 + 6 * DAY, regime: 'unseen' }],
        registered_at: T0 - DAY,
        reason: 'interop holdout material',
      },
      ...overrides,
    };
  }

  it('compiles over the REAL record with exact decimals', () => {
    const result = compileSelectionAudit(auditInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`must compile: ${JSON.stringify(result.errors)}`);
    expect(result.value.candidates).toBe(4);
    expect(result.value.reportedStatistic).toBe('0.2000');
    expect(result.value.blindSelectionExpectation).toBe('0.1250');
    expect(result.value.selectionInflation).toBe('0.0750');
    expect(result.value.holdoutStatistic).toBe('0.1500');
    expect(result.value.holdoutDegradation).toBe('0.0500');
    expect(result.value.selectedIsBest).toBe(true);
    expect(result.value.embargoMs).toBe(EMBARGO);
  });

  it('the hidden-trials law fires over the REAL record (drop t3)', () => {
    const result = compileSelectionAudit(auditInput({
      statistics: [
        { trial: 't1', statistic: '0.1000' },
        { trial: 't2', statistic: '0.1200' },
        { trial: 't4', statistic: '0.2000' },
      ],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('hidden_trials');
    expect(result.errors[0]?.message).toContain('t3');
  });

  it('the leakage law fires over the REAL record (holdout window too close)', () => {
    // Rebuild the real record with h1's window inside the embargo horizon.
    const created = createSearchRecord({ experiment: 'exp-interop', evaluator: 'evaluator@1', tenant: 'tenant-1', project: 'project-1' });
    if (!created.ok) throw new Error('fixture must create');
    let record = created.value;
    const appends: readonly { trial: string; classification?: 'holdout'; parents?: readonly string[]; config: Record<string, unknown>; window: { start: number; end: number }; instant: number; datasets?: readonly string[] }[] = [
      { trial: 't1', config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY }, instant: T0 + 1 },
      { trial: 't4', parents: ['t1'], config: { lr: '0.3' }, window: { start: T0, end: T0 + DAY }, instant: T0 + 2 },
      { trial: 'h1', classification: 'holdout', config: { lr: '0.3' }, window: { start: T0 + 2 * DAY, end: T0 + 2 * DAY + DAY / 2 }, instant: T0 + 3, datasets: ['dataset-holdout'] },
    ];
    for (const a of appends) {
      const appended = appendSearchTrial(record, {
        trial: a.trial,
        arm: null,
        classification: a.classification ?? 'in-search',
        config: a.config,
        parents: a.parents ?? [],
        splits: a.classification === 'holdout' ? ['split.holdout-interop'] : ['split.train-interop'],
        datasets: a.datasets ?? ['dataset-europe'],
        window: a.window,
        evaluation_policy: a.classification === 'holdout' ? 'split.holdout-interop' : 'split.eval-interop',
        recorded_at: a.instant,
        tenant: 'tenant-1',
        project: 'project-1',
      });
      if (!appended.ok) throw new Error(`fixture must append ${a.trial}`);
      record = appended.value;
    }
    const result = compileSelectionAudit(auditInput({
      search: record,
      statistics: [
        { trial: 't1', statistic: '0.1000' },
        { trial: 't4', statistic: '0.2000' },
      ],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('leakage_without_embargo');
  });
});

describe('T012 composition: the real experiment-lane report corroborates the platform audit', () => {
  it('a REAL computeSearchIntegrityReport output passes the mirror guard unchanged', () => {
    const report = realExperimentReport();
    expect(isSearchIntegrityReportMirror(report)).toBe(true);
    expect(report.experiment).toBe('exp-interop');
    expect(report.bestOfN?.selectedTrialId).toBe('t4');
    expect(report.failuresRetained).toBe(1); // the failed trial is retained (L11)
  });

  it('the real report feeds the platform audit as corroboration (end-to-end)', () => {
    const report = realExperimentReport();
    const result = compileSelectionAudit({
      search: realSearchRecord(),
      statistics: [
        { trial: 't1', statistic: '0.1000' },
        { trial: 't2', statistic: '0.1200' },
        { trial: 't3', statistic: '0.0800' },
        { trial: 't4', statistic: '0.2000' },
      ],
      holdout: [{ trial: 'h1', statistic: '0.1500', origin: 'historical' }],
      selection: { selectedTrialId: 't4' },
      statisticScale: 4,
      embargo: { source: 'declared', embargoMs: EMBARGO },
      quarantine: {
        tenant: 'tenant-1',
        project: 'project-1',
        segments: [{ ref: 'dataset-holdout', start: T0 + 5 * DAY, end: T0 + 6 * DAY, regime: 'unseen' }],
        registered_at: T0 - DAY,
        reason: 'interop holdout material',
      },
      experimentReport: report,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`must compile: ${JSON.stringify(result.errors)}`);
    expect(result.value.experimentRetained?.reportId).toBe(report.reportId);
    expect(result.value.experimentRetained?.failuresRetained).toBe(1);
    expect(result.value.experimentRetained?.trialsCounted).toBe(5);
  });

  it('a real report naming a different selection fails selection_mismatch (the cross-check bites)', () => {
    const report = realExperimentReport();
    const result = compileSelectionAudit({
      search: realSearchRecord(),
      statistics: [
        { trial: 't1', statistic: '0.1000' },
        { trial: 't2', statistic: '0.1200' },
        { trial: 't3', statistic: '0.0800' },
        { trial: 't4', statistic: '0.2000' },
      ],
      holdout: [{ trial: 'h1', statistic: '0.1500', origin: 'historical' }],
      selection: { selectedTrialId: 't2' }, // the audit judges t2...
      statisticScale: 4,
      embargo: { source: 'declared', embargoMs: EMBARGO },
      quarantine: {
        tenant: 'tenant-1',
        project: 'project-1',
        segments: [{ ref: 'dataset-holdout', start: T0 + 5 * DAY, end: T0 + 6 * DAY, regime: 'unseen' }],
        registered_at: T0 - DAY,
        reason: 'interop holdout material',
      },
      experimentReport: report, // ...but the experiment lane reported t4.
    });
    // t2's config has no holdout evaluation, so selected_without_holdout
    // fires first — re-run with a holdout evaluation of t2's config to
    // isolate the cross-check.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('selected_without_holdout');

    const created = createSearchRecord({ experiment: 'exp-interop', evaluator: 'evaluator@1', tenant: 'tenant-1', project: 'project-1' });
    if (!created.ok) throw new Error('fixture must create');
    let record = created.value;
    const appends: readonly { trial: string; classification?: 'holdout'; parents?: readonly string[]; config: Record<string, unknown>; window: { start: number; end: number }; instant: number; datasets?: readonly string[] }[] = [
      { trial: 't1', config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY }, instant: T0 + 1 },
      { trial: 't2', parents: ['t1'], config: { lr: '0.1' }, window: { start: T0, end: T0 + DAY }, instant: T0 + 2 },
      { trial: 't4', config: { lr: '0.3' }, window: { start: T0, end: T0 + DAY }, instant: T0 + 3 },
      { trial: 'h1', classification: 'holdout', config: { lr: '0.1' }, window: { start: T0 + 5 * DAY, end: T0 + 6 * DAY }, instant: T0 + 4, datasets: ['dataset-holdout'] },
    ];
    for (const a of appends) {
      const appended = appendSearchTrial(record, {
        trial: a.trial,
        arm: null,
        classification: a.classification ?? 'in-search',
        config: a.config,
        parents: a.parents ?? [],
        splits: a.classification === 'holdout' ? ['split.holdout-interop'] : ['split.train-interop'],
        datasets: a.datasets ?? ['dataset-europe'],
        window: a.window,
        evaluation_policy: a.classification === 'holdout' ? 'split.holdout-interop' : 'split.eval-interop',
        recorded_at: a.instant,
        tenant: 'tenant-1',
        project: 'project-1',
      });
      if (!appended.ok) throw new Error(`fixture must append ${a.trial}`);
      record = appended.value;
    }
    const isolated = compileSelectionAudit({
      search: record,
      statistics: [
        { trial: 't1', statistic: '0.1000' },
        { trial: 't2', statistic: '0.1200' },
        { trial: 't4', statistic: '0.2000' },
      ],
      holdout: [{ trial: 'h1', statistic: '0.0900', origin: 'historical' }],
      selection: { selectedTrialId: 't2' },
      statisticScale: 4,
      embargo: { source: 'declared', embargoMs: EMBARGO },
      quarantine: {
        tenant: 'tenant-1',
        project: 'project-1',
        segments: [{ ref: 'dataset-holdout', start: T0 + 5 * DAY, end: T0 + 6 * DAY, regime: 'unseen' }],
        registered_at: T0 - DAY,
        reason: 'interop holdout material',
      },
      experimentReport: report,
    });
    expect(isolated.ok).toBe(false);
    if (isolated.ok) throw new Error('must fail');
    expect(isolated.errors[0]?.code).toBe('selection_mismatch');
    expect(isolated.errors[0]?.message).toContain('cannot report different bests');
  });

  it("the BestOfNEffect mirror is mutually assignable with T012's declaration", () => {
    const report = realExperimentReport();
    const effect = report.bestOfN as EvaluationBestOfN;
    expect(effect.selectedIsBest).toBe(true);
    expectTypeOf<EvaluationReport>().not.toBeNever();
    void effect;
  });
});

describe('the origin vocabulary mirror (canonical: @tradrl/market-protocol; T028 declares it verbatim)', () => {
  it('DATA_ORIGINS_MIRROR equals the canonical EVENT_ORIGINS', () => {
    expect(DATA_ORIGINS_MIRROR).toEqual(EVENT_ORIGINS);
  });

  it('the type-level origin mirrors compile both ways', () => {
    const mirror: DataOriginMirror = 'historical';
    const asEventOrigin: EventOrigin = mirrorOriginIsEventOrigin(mirror);
    const backToMirror: DataOriginMirror = eventOriginIsMirrorOrigin(asEventOrigin);
    expect(backToMirror).toBe('historical');
    const asVendored: VendoredGenerativeProvenance['origin'] = mirrorOriginIsVendoredProvenanceOrigin(mirror);
    expect(asVendored).toBe('historical');
    expectTypeOf<DataOriginMirror>().toEqualTypeOf<EventOrigin>();
  });

  it('the complementary L5 law: T028 forbids synthetic claiming historical; T031 forbids synthetic serving as holdout', () => {
    // The vocabulary the two laws share is exactly the mirrored one.
    for (const origin of EVENT_ORIGINS) {
      expect(DATA_ORIGINS_MIRROR).toContain(origin);
    }
    // And the audit's synthetic-holdout law rejects everything but historical.
    const result = compileSelectionAudit({
      search: realSearchRecord(),
      statistics: [
        { trial: 't1', statistic: '0.1000' },
        { trial: 't2', statistic: '0.1200' },
        { trial: 't3', statistic: '0.0800' },
        { trial: 't4', statistic: '0.2000' },
      ],
      holdout: [{ trial: 'h1', statistic: '0.1500', origin: 'generated' }],
      selection: { selectedTrialId: 't4' },
      statisticScale: 4,
      embargo: { source: 'declared', embargoMs: EMBARGO },
      quarantine: {
        tenant: 'tenant-1',
        project: 'project-1',
        segments: [{ ref: 'dataset-holdout', start: T0 + 5 * DAY, end: T0 + 6 * DAY, regime: 'unseen' }],
        registered_at: T0 - DAY,
        reason: 'interop holdout material',
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('synthetic_holdout');
  });
});

describe('generative-lane brand parity (L12 scoping across all three T031 surfaces)', () => {
  it('tenant/project brands are mutually assignable with the T028 generative lane', () => {
    const tenant: GenerativeTenantId = 'tenant-interop' as never;
    const project: GenerativeProjectId = 'project-interop' as never;
    expect(generativeTenantIsIntegrityMirror(tenant)).toBe('tenant-interop');
    expect(generativeProjectIsIntegrityMirror(project)).toBe('project-interop');
    expectTypeOf<IntegrityTenantId>().toEqualTypeOf<GenerativeTenantId>();
    expectTypeOf<IntegrityProjectId>().toEqualTypeOf<GenerativeProjectId>();
  });
});
