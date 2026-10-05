/**
 * T049 — the MIRROR laws (benchmarks/platform's structural mirrors of the
 * merged evaluation surfaces): the exact-decimal discipline (including the
 * DELIBERATE, documented correction of the program-wide compareMagnitude —
 * see decimals.ts), the T048 SliceReport mirror + its station invariants,
 * the T031 search-record mirror + the mirrored chain law, the T032
 * split-plan mirror + the content-address law, and the material sources +
 * the evidence-class law.
 */

import { describe, expect, it } from 'vitest';

import {
  compareDecimals,
  decimalScale,
  decimalsEqual,
  isDecimalAtScale,
  isSignedDecimal,
  isUnsignedDecimal,
  normalizeDecimal,
} from '../../../benchmarks/platform/src/decimals';
import {
  isRealizedOutcomeSummaryMirror,
  isSliceReportMirror,
  isSliceReportShape,
  slicePipelineViolations,
  type SliceReportMirror,
} from '../../../benchmarks/platform/src/slice-mirror';
import {
  chainFoldMirror,
  chainGenesisMirror,
  computeChainHeadMirror,
  configSnapshotIdMirror,
  isSearchTrialEntryMirror,
  searchRecordIdMirror,
  validateSearchTrialEntryMirror,
  verifySearchRecordLineage,
} from '../../../benchmarks/platform/src/search-mirror';
import {
  isSplitPlanMirror,
  planContentJsonMirror,
  splitPlanDigest,
  splitPlanIdMirror,
  verifySplitPlanMirror,
  type SplitPlanMirror,
} from '../../../benchmarks/platform/src/split-mirror';
import {
  EVIDENCE_CLASSES,
  GENERATIVE_SOURCE_ID_PREFIX,
  LIVE_SOURCE_ID_PREFIX,
  REPLAY_SOURCE_ID_PREFIX,
  checkEvidenceClass,
  generativeSourceDigest,
  generativeSourceId,
  isLiveSessionSource,
  isMaterialSource,
  isRegimePopulationSource,
  isReplayDataSource,
  liveSourceDigest,
  liveSourceId,
  materialDigest,
  materialKind,
  materialOrigin,
  replaySourceDigest,
  replaySourceId,
} from '../../../benchmarks/platform/src/material';
import {
  fixtureGenerativeSource,
  fixtureLiveSource,
  fixtureReplaySource,
  fixtureSearchRecord,
  fixtureSliceReport,
  fixtureSplitPlan,
  type JsonObject,
} from '../../../benchmarks/platform/src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function thaw<T>(value: T): T {
  return structuredClone(value);
}

function tamperedReport(tamper: (report: Record<string, unknown>) => void): JsonObject {
  const report = thaw(fixtureSliceReport()) as unknown as Record<string, unknown>;
  tamper(report);
  return report as unknown as JsonObject;
}

// ---------------------------------------------------------------------------
// The exact-decimal discipline
// ---------------------------------------------------------------------------

describe('T049 mirrors — the exact-decimal discipline', () => {
  it('compares equal-scale decimals exactly', () => {
    expect(compareDecimals('0.00', '0.00')).toBe(0);
    expect(compareDecimals('1.50', '1.50')).toBe(0);
    expect(compareDecimals('1.50', '2.50')).toBe(-1);
    expect(compareDecimals('2.50', '1.50')).toBe(1);
  });

  it('compares across scales exactly (representation independence)', () => {
    expect(compareDecimals('5.00', '5.0')).toBe(0);
    expect(compareDecimals('0.20', '0.3')).toBe(-1);
    expect(compareDecimals('0.30', '0.2')).toBe(1);
    expect(decimalsEqual('10.000', '10.00')).toBe(true);
  });

  it('compares across INTEGER DIGIT COUNTS exactly (the corrected law — the owners miscompare here)', () => {
    // The program-wide compareMagnitude (evaluation-splits /
    // evaluation-integrity / research-benchmarks) returns 0 / -1 for these
    // pairs (pinned at audit time); the measurement lane's corrected mirror
    // compares them exactly. See decimals.ts for the divergence record.
    expect(compareDecimals('10.00', '1.00')).toBe(1);
    expect(compareDecimals('1.00', '10.00')).toBe(-1);
    expect(compareDecimals('15.00', '9.00')).toBe(1);
    expect(compareDecimals('100.00', '99.00')).toBe(1);
    expect(compareDecimals('99.00', '100.00')).toBe(-1);
    expect(compareDecimals('1000000.00', '999999.99')).toBe(1);
  });

  it('stays byte-identical to the owners on equal digit counts (the divergence is exactly the correction)', () => {
    // Every pair whose integer parts carry the same digit count must compare
    // exactly as the owners' implementation does (they agree with the truth
    // on that domain).
    expect(compareDecimals('86400000', '86400000')).toBe(0);
    expect(compareDecimals('1730000000000', '1730000086400')).toBe(-1);
    expect(compareDecimals('1730000086400', '1730000000000')).toBe(1);
  });

  it('handles signs and zeros exactly', () => {
    expect(compareDecimals('-1.00', '1.00')).toBe(-1);
    expect(compareDecimals('-2.00', '-1.00')).toBe(-1);
    expect(compareDecimals('-0.00', '0.00')).toBe(0);
    expect(compareDecimals('-0.50', '0.20')).toBe(-1);
    expect(compareDecimals('+3.14', '3.14')).toBe(0);
  });

  it('guards the lexical forms, scales and normalizations', () => {
    expect(isUnsignedDecimal('0.5')).toBe(true);
    expect(isUnsignedDecimal('-0.5')).toBe(false);
    expect(isSignedDecimal('-0.0021')).toBe(true);
    expect(isSignedDecimal('1.2.3')).toBe(false);
    expect(decimalScale('259200000.5')).toBe(1);
    expect(isDecimalAtScale('12.345', 3)).toBe(true);
    expect(isDecimalAtScale('12.34', 3)).toBe(false);
    expect(normalizeDecimal('+007.50')).toBe('7.50');
    expect(normalizeDecimal('-0.00')).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// The T048 SliceReport mirror + the station invariants
// ---------------------------------------------------------------------------

describe('T049 mirrors — the T048 SliceReport mirror', () => {
  it('accepts the fixture report under both the shape and the full law', () => {
    const report = fixtureSliceReport();
    expect(isSliceReportShape(report)).toBe(true);
    expect(isSliceReportMirror(report)).toBe(true);
    expect(slicePipelineViolations(report as unknown as SliceReportMirror)).toHaveLength(0);
  });

  it('rejects a 16-hex outcomeDigest (T048\'s digests are 8-hex fnv1a32Hex — the W-9a defect pin)', () => {
    const report = tamperedReport((draft) => {
      const outcomes = draft.outcomes as Record<string, unknown>;
      outcomes.outcomeDigest = '0011223344556677';
    });
    expect(isRealizedOutcomeSummaryMirror((report as { outcomes: unknown }).outcomes)).toBe(false);
    expect(isSliceReportShape(report)).toBe(false);
  });

  it('rejects a 16-hex reportDigest (same law, the report anchor)', () => {
    const report = tamperedReport((draft) => {
      draft.reportDigest = '0011223344556677';
    });
    expect(isSliceReportShape(report)).toBe(false);
  });

  it('names the embargo law: a news-carrying slice lifts its embargo at a real instant', () => {
    const report = tamperedReport((draft) => {
      const md = draft.marketData as Record<string, unknown>;
      md.embargoAvailableAt = 0;
    });
    expect(isSliceReportShape(report)).toBe(true);
    expect(isSliceReportMirror(report)).toBe(false);
    expect(slicePipelineViolations(report as unknown as SliceReportMirror)[0]).toContain('embargo');
  });

  it('names the audit law: a coherent gateway carries audit records', () => {
    const report = tamperedReport((draft) => {
      const gateway = draft.gateway as Record<string, unknown>;
      gateway.auditRecords = 0;
    });
    expect(isSliceReportMirror(report)).toBe(false);
    expect(slicePipelineViolations(report as unknown as SliceReportMirror)[0]).toContain('audit');
  });

  it('names the L15 law: every paper outcome binds the run goal', () => {
    const report = tamperedReport((draft) => {
      const lineage = draft.lineage as Record<string, unknown>;
      const intents = lineage.paperOutcomeIntents as { goalId: string }[];
      intents[0] = { ...intents[0]!, goalId: 'goal-from-another-run' };
    });
    expect(isSliceReportMirror(report)).toBe(false);
    expect(slicePipelineViolations(report as unknown as SliceReportMirror)[0]).toContain('L15');
  });

  it('names the L15 law: every live audit record binds the run goal', () => {
    const report = tamperedReport((draft) => {
      const lineage = draft.lineage as Record<string, unknown>;
      const audits = lineage.liveAuditIntents as { goalId: string }[];
      audits[1] = { ...audits[1]!, goalId: 'goal-from-another-run' };
    });
    expect(isSliceReportMirror(report)).toBe(false);
    expect(slicePipelineViolations(report as unknown as SliceReportMirror)[0]).toContain('L15');
  });

  it('names the L15 law: an order citing a foreign director decision', () => {
    const report = tamperedReport((draft) => {
      const lineage = draft.lineage as Record<string, unknown>;
      const orders = lineage.orderDecisions as { directorDecisionRef: string }[];
      orders[0] = { ...orders[0]!, directorDecisionRef: 'dd-from-another-run' };
    });
    expect(isSliceReportMirror(report)).toBe(false);
    expect(slicePipelineViolations(report as unknown as SliceReportMirror)[0]).toContain('L15');
  });

  it('names the L16 law: the order clock never precedes the cited strategic instant', () => {
    const report = tamperedReport((draft) => {
      const lineage = draft.lineage as Record<string, unknown>;
      const orders = lineage.orderDecisions as { orderClock: number; decisionAsOf: number }[];
      orders[1] = { ...orders[1]!, orderClock: orders[1]!.decisionAsOf - 1 };
    });
    expect(isSliceReportMirror(report)).toBe(false);
    expect(slicePipelineViolations(report as unknown as SliceReportMirror)[0]).toContain('L16');
  });
});

// ---------------------------------------------------------------------------
// The T031 search-record mirror + the mirrored chain law
// ---------------------------------------------------------------------------

describe('T049 mirrors — the T031 search-record mirror', () => {
  it('verifies the fixture record end-to-end (identity + snapshots + entries + chain)', () => {
    const result = verifySearchRecordLineage(fixtureSearchRecord());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    expect(result.value.entries).toHaveLength(2);
    expect(result.value.entries[0]?.classification).toBe('in-search');
    expect(result.value.entries[1]?.classification).toBe('holdout');
  });

  it('derives the identity and chain exactly like the owner (srch: + digest(binding); fold over entries)', () => {
    const record = fixtureSearchRecord();
    const binding = { experiment: record.experiment, evaluator: record.evaluator, tenant: record.tenant, project: record.project };
    expect(record.search_id).toBe(searchRecordIdMirror(binding));
    expect(record.chain_head).toBe(computeChainHeadMirror(binding, record.entries));
    expect(chainGenesisMirror(binding)).toMatch(/^[0-9a-f]{16}$/);
    const fold = chainFoldMirror('a'.repeat(16), record.entries[0]!);
    expect(fold).toMatch(/^[0-9a-f]{16}$/);
  });

  it('detects a MUTATED entry (chain_mismatch)', () => {
    const tampered = thaw(fixtureSearchRecord()) as unknown as Record<string, unknown>;
    const entries = tampered.entries as Record<string, unknown>[];
    entries[0] = { ...entries[0]!, arm: 'arm-forged' };
    const result = verifySearchRecordLineage(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('detects a REORDERED log even with forged monotone instants (chain_mismatch)', () => {
    const tampered = thaw(fixtureSearchRecord()) as unknown as Record<string, unknown>;
    const entries = tampered.entries as Record<string, unknown>[];
    // Reverse the log AND swap the instants so the order law stays satisfied —
    // only the CHAIN can catch this reorder (the head binds append order).
    entries.reverse();
    const firstInstant = entries[0]!.recorded_at as number;
    const secondInstant = entries[1]!.recorded_at as number;
    entries[0] = { ...entries[0]!, recorded_at: Math.min(firstInstant, secondInstant) };
    entries[1] = { ...entries[1]!, recorded_at: Math.max(firstInstant, secondInstant) };
    const result = verifySearchRecordLineage(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('detects a TRUNCATED log (hiding a trial — chain_mismatch)', () => {
    const tampered = thaw(fixtureSearchRecord()) as unknown as Record<string, unknown>;
    tampered.entries = (tampered.entries as unknown[]).slice(0, 1);
    const result = verifySearchRecordLineage(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('chain_mismatch');
  });

  it('refuses a holdout entry with parents or foreign splits (the structural holdout law)', () => {
    const entry = thaw(fixtureSearchRecord().entries[1]!);
    const withParent = { ...entry, parents: ['trial-fixture-search-0001'] } as never;
    expect(isSearchTrialEntryMirror(withParent)).toBe(false);
    const validate = validateSearchTrialEntryMirror(withParent);
    expect(validate.ok).toBe(false);
    if (!validate.ok) expect(validate.errors.some((error) => error.message.includes('empty for a holdout trial'))).toBe(true);
  });

  it('requires the arm field (the owner\'s validateSearchTrialEntry rejects a missing arm — parity)', () => {
    const entry = thaw(fixtureSearchRecord().entries[0]!) as unknown as Record<string, unknown>;
    const noArm = { ...entry };
    delete noArm.arm;
    expect(isSearchTrialEntryMirror(noArm)).toBe(false);
    const validate = validateSearchTrialEntryMirror(noArm);
    expect(validate.ok).toBe(false);
    if (!validate.ok) expect(validate.errors.map((error) => error.path)).toContain('trial.arm');
  });

  it('mints config snapshot addresses content-addressedly (snap:<digest>)', () => {
    const config: JsonObject = { a: 1, b: 'two' };
    const id = configSnapshotIdMirror(config);
    expect(id).toMatch(/^snap:[0-9a-f]{16}$/);
    expect(configSnapshotIdMirror({ b: 'two', a: 1 })).toBe(id); // canonical: key order is irrelevant
    expect(configSnapshotIdMirror({ a: 2, b: 'two' })).not.toBe(id);
  });

  it('refuses an entry referencing an unstored snapshot (retention law)', () => {
    const tampered = thaw(fixtureSearchRecord()) as unknown as Record<string, unknown>;
    const entries = tampered.entries as Record<string, unknown>[];
    entries[0] = { ...entries[0]!, config: 'snap:0000000000000000' };
    const result = verifySearchRecordLineage(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain('unstored config snapshot');
  });

  it('refuses an in-search trial taking a holdout parent (the L11 overfitting law)', () => {
    const tampered = thaw(fixtureSearchRecord()) as unknown as Record<string, unknown>;
    const entries = tampered.entries as Record<string, unknown>[];
    // entry[1] is the holdout trial; rewrite entry[1] as in-search with entry[0] parent — then append a NEW in-search entry with the ORIGINAL holdout entry as parent.
    const binding = { experiment: tampered.experiment, evaluator: tampered.evaluator, tenant: tampered.tenant, project: tampered.project } as never;
    const newEntry = {
      trial: 'trial-fixture-child-0001',
      arm: null,
      classification: 'in-search',
      config: (tampered.snapshots as { snapshot_id: string }[])[0]!.snapshot_id,
      parents: ['trial-fixture-holdout-0001'],
      splits: ['split-policy://fixture-walk-forward-v1'],
      datasets: ['dataset-0'],
      window: null,
      evaluation_policy: 'split-policy://fixture-walk-forward-v1',
      recorded_at: 1_730_000_030_000,
      tenant: tampered.tenant,
      project: tampered.project,
    };
    (tampered.entries as unknown[]).push(newEntry);
    tampered.chain_head = computeChainHeadMirror(binding, tampered.entries as never);
    const result = verifySearchRecordLineage(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain('holdout trial');
  });
});

// ---------------------------------------------------------------------------
// The T032 split-plan mirror + the content-address law
// ---------------------------------------------------------------------------

describe('T049 mirrors — the T032 split-plan mirror', () => {
  it('verifies the fixture plan end-to-end (structure + ladder + leakage + content address)', () => {
    const result = verifySplitPlanMirror(fixtureSplitPlan());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    expect(result.value.windows).toHaveLength(3);
    expect(result.value.holdout?.segments).toHaveLength(2);
  });

  it('derives the plan id exactly like the owner (splan: over the canonical plan content)', () => {
    const plan = fixtureSplitPlan();
    const { plan_id: drop, ...content } = plan;
    void drop;
    expect(plan.plan_id).toBe(splitPlanIdMirror(content as Omit<SplitPlanMirror, 'plan_id'>));
    expect(plan.plan_id).toMatch(/^splan:[0-9a-f]{16}$/);
    expect(splitPlanDigest(plan)).toBe(plan.plan_id.slice('splan:'.length));
    expect(planContentJsonMirror(content as Omit<SplitPlanMirror, 'plan_id'>).kind).toBe('walk-forward-plan');
  });

  it('rejects a mutated window (content and address cannot disagree)', () => {
    const tampered = thaw(fixtureSplitPlan()) as unknown as Record<string, unknown>;
    const windows = tampered.windows as Record<string, unknown>[];
    windows[0] = { ...windows[0]!, purged: 5 };
    const result = verifySplitPlanMirror(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain("content's address");
  });

  it('detects holdout leakage into window material (holdout_in_search — fail-closed over the plan AS STORED)', () => {
    const tampered = thaw(fixtureSplitPlan()) as unknown as Record<string, unknown>;
    const windows = tampered.windows as Record<string, unknown>[];
    const holdout = tampered.holdout as { segments: { ref: string }[] };
    const test = windows[0]!.test as Record<string, unknown>;
    test.ref = holdout.segments[0]!.ref; // window 0 now tests the RESERVED segment
    const result = verifySplitPlanMirror(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('holdout_in_search');
      expect(result.errors[0]?.message).toContain('TEST material');
    }
  });

  it('detects holdout leakage into TRAIN material (the other half of the law)', () => {
    const tampered = thaw(fixtureSplitPlan()) as unknown as Record<string, unknown>;
    const windows = tampered.windows as Record<string, unknown>[];
    const holdout = tampered.holdout as { segments: { ref: string }[] };
    const train = windows[0]!.train as Record<string, unknown>[];
    train[0] = { ...train[0]!, ref: holdout.segments[1]!.ref };
    const result = verifySplitPlanMirror(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain('TRAIN material');
  });

  it('refuses non-dense window ordinals and incoherent lineage counts', () => {
    const sparse = thaw(fixtureSplitPlan()) as unknown as Record<string, unknown>;
    const windows = sparse.windows as Record<string, unknown>[];
    windows[1] = { ...windows[1]!, index: 7 };
    const sparseResult = verifySplitPlanMirror(sparse);
    expect(sparseResult.ok).toBe(false);
    if (!sparseResult.ok) expect(sparseResult.errors[0]?.message).toContain('dense from 0');

    const miscounted = thaw(fixtureSplitPlan()) as unknown as Record<string, unknown>;
    const lineage = miscounted.lineage as Record<string, unknown>;
    lineage.window_count = 99;
    const countResult = verifySplitPlanMirror(miscounted);
    expect(countResult.ok).toBe(false);
    if (!countResult.ok) expect(countResult.errors[0]?.message).toContain('window count');
  });

  it('exposes the structural guard separately from the verifier', () => {
    expect(isSplitPlanMirror(fixtureSplitPlan())).toBe(true);
    const tampered = thaw(fixtureSplitPlan()) as unknown as Record<string, unknown>;
    tampered.plan_id = 'splan:0000000000000000';
    expect(isSplitPlanMirror(tampered)).toBe(true); // structural only — the content-address law is the verifier's
    expect(verifySplitPlanMirror(tampered).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The material sources + the evidence-class law
// ---------------------------------------------------------------------------

describe('T049 mirrors — the material sources + the evidence-class law', () => {
  it('guards and content-addresses the three source kinds', () => {
    const replay = fixtureReplaySource();
    expect(isReplayDataSource(replay)).toBe(true);
    expect(isMaterialSource(replay)).toBe(true);
    expect(replay.source_id).toBe(replaySourceId(replay));
    expect(replay.source_id.startsWith(REPLAY_SOURCE_ID_PREFIX)).toBe(true);
    expect(materialOrigin(replay)).toBe('historical');
    expect(materialKind(replay)).toBe('replay-dataset');
    expect(materialDigest(replay)).toBe(replaySourceDigest(replay));

    const generative = fixtureGenerativeSource();
    expect(isRegimePopulationSource(generative)).toBe(true);
    expect(generative.source_id).toBe(generativeSourceId(generative));
    expect(generative.source_id.startsWith(GENERATIVE_SOURCE_ID_PREFIX)).toBe(true);
    expect(materialOrigin(generative)).toBe('generated');
    expect(materialDigest(generative)).toBe(generativeSourceDigest(generative));

    const live = fixtureLiveSource();
    expect(isLiveSessionSource(live)).toBe(true);
    expect(live.source_id).toBe(liveSourceId(live));
    expect(live.source_id.startsWith(LIVE_SOURCE_ID_PREFIX)).toBe(true);
    expect(materialDigest(live)).toBe(liveSourceDigest(live));
  });

  it('refuses a non-16-hex config digest (the T032 owner\'s digest law — parity)', () => {
    const replay = thaw(fixtureReplaySource()) as unknown as Record<string, unknown>;
    replay.config_digest = 'cfg-replay-fixture-0001'; // a free label, not a digest
    expect(isReplayDataSource(replay)).toBe(false);

    const generative = thaw(fixtureGenerativeSource()) as unknown as Record<string, unknown>;
    generative.config_digest = 'cfg-generative-fixture-0001';
    expect(isRegimePopulationSource(generative)).toBe(false);

    const live = thaw(fixtureLiveSource()) as unknown as Record<string, unknown>;
    live.config_digest = 'cfg-live-fixture-0001';
    expect(isLiveSessionSource(live)).toBe(false);
  });

  it('refuses a generative population claiming a historical origin (the T028 fidelity law)', () => {
    const forged = thaw(fixtureGenerativeSource()) as unknown as Record<string, unknown>;
    forged.origin = 'historical';
    expect(isRegimePopulationSource(forged)).toBe(false);
  });

  it('enforces the evidence-class law matrix (never conflated)', () => {
    expect(EVIDENCE_CLASSES).toEqual(['simulation', 'live']);
    expect(checkEvidenceClass('simulation', fixtureReplaySource()).ok).toBe(true);
    expect(checkEvidenceClass('simulation', fixtureGenerativeSource()).ok).toBe(true);
    expect(checkEvidenceClass('live', fixtureLiveSource()).ok).toBe(true);

    const liveOverGenerative = checkEvidenceClass('live', fixtureGenerativeSource());
    expect(liveOverGenerative.ok).toBe(false);
    if (!liveOverGenerative.ok) expect(liveOverGenerative.code).toBe('live_claim_on_simulation');

    const liveOverReplay = checkEvidenceClass('live', fixtureReplaySource());
    expect(liveOverReplay.ok).toBe(false);
    if (!liveOverReplay.ok) expect(liveOverReplay.code).toBe('live_claim_on_simulation');

    const simulationOverLive = checkEvidenceClass('simulation', fixtureLiveSource());
    expect(simulationOverLive.ok).toBe(false);
    if (!simulationOverLive.ok) expect(simulationOverLive.code).toBe('evidence_conflated');
  });
});
