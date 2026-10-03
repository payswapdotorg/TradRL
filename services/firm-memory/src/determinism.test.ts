/**
 * @tradrl/firm-memory-service — DETERMINISM (L9): identical inputs ->
 * identical bytes, on every derivation the lane owns:
 *
 *   - the whole golden pipeline (batches 1..4 + the internal scenarios
 *     + tenant B's world) runs TWICE and produces byte-identical state
 *     (the state digest), chain heads, receipts and served results;
 *   - the chain heads and counts equal the PINNED golden literals
 *     (golden.ts) — any drift in the mirrors, the scope laws, the
 *     candidate lifting, the promotion decisions, the reconcile, the
 *     record minting or the chain folds fails loudly;
 *   - the knowledge-chain derivation is byte-stable: the same append
 *     sequence re-derives the same fold and the same content-addressed
 *     ids;
 *   - the promotion decisions are pure: re-running the ingestion over
 *     the same inputs produces the same receipt ids and the same
 *     family winners (the point-in-time serving digest is stable).
 */

import { describe, expect, it } from 'vitest';
import { ingestFirmLearning } from './ingest';
import { queryFirmKnowledge } from './serve';
import { createFirmMemoryState, firmMemoryStateDigest, type FirmMemoryState } from './state';
import {
  FIRM_PROJECT,
  FIRM_T0,
  FIRM_TENANT,
  firmScenarioPolicy,
  firmScenarioServingPolicy,
  scenarioSnapshotAdverse,
  scenarioSnapshotChallenger,
  scenarioSnapshotDominating,
  scenarioSnapshotInternalContest,
  scenarioSnapshotInternalDomination,
  scenarioSnapshotReinforce,
  scenarioSnapshotTenantB,
} from './fixtures';
import { asTimestampMs, type TimestampMs } from './imports';
import {
  GOLDEN_ACTIVE_COUNT,
  GOLDEN_CONTRADICTION_COUNT,
  GOLDEN_CONTRADICTION_HEAD_B3,
  GOLDEN_KNOWLEDGE_COUNT,
  GOLDEN_KNOWLEDGE_HEAD_B1,
  GOLDEN_STATE_DIGEST_B,
  GOLDEN_STATE_DIGEST_B1,
  GOLDEN_STATE_DIGEST_B2,
  GOLDEN_STATE_DIGEST_B3,
  GOLDEN_STATE_DIGEST_B4,
  GOLDEN_STATE_DIGEST_B5,
  GOLDEN_STATE_DIGEST_B6,
} from './golden';

/** Ingest one scenario (the tests' shorthand; throws on failure). */
function ingest(state: FirmMemoryState, snapshot: { readonly outcomes: readonly unknown[]; readonly postMortems: readonly unknown[]; readonly at: TimestampMs }) {
  const result = ingestFirmLearning(state, { outcomes: snapshot.outcomes, postMortems: snapshot.postMortems }, firmScenarioPolicy, { at: snapshot.at });
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.code}: ${error.message}`).join('; '));
  return result.value;
}

/** The golden pipeline (the full scenario world). */
function runGoldenPipeline(): { readonly state: FirmMemoryState; readonly digests: readonly string[] } {
  let state = createFirmMemoryState();
  const digests: string[] = [];
  let step = ingest(state, scenarioSnapshotAdverse());
  state = step.state;
  digests.push(firmMemoryStateDigest(state), state.knowledgeLog.head);
  step = ingest(state, scenarioSnapshotReinforce());
  state = step.state;
  digests.push(firmMemoryStateDigest(state));
  step = ingest(state, scenarioSnapshotChallenger());
  state = step.state;
  digests.push(firmMemoryStateDigest(state), state.contradictionLog.head);
  step = ingest(state, scenarioSnapshotDominating());
  state = step.state;
  digests.push(firmMemoryStateDigest(state));
  step = ingest(state, scenarioSnapshotInternalContest());
  state = step.state;
  digests.push(firmMemoryStateDigest(state));
  step = ingest(state, scenarioSnapshotInternalDomination());
  state = step.state;
  digests.push(firmMemoryStateDigest(state));
  step = ingest(state, scenarioSnapshotTenantB());
  state = step.state;
  digests.push(firmMemoryStateDigest(state));
  return { state, digests };
}

describe('the golden pipeline (identical inputs -> identical bytes, TWICE)', () => {
  it('the whole scenario world is byte-identical across runs (L9)', () => {
    const first = runGoldenPipeline();
    const second = runGoldenPipeline();
    expect(first.digests).toEqual(second.digests);
    expect(JSON.stringify(first.state)).toBe(JSON.stringify(second.state));
    expect(firmMemoryStateDigest(first.state)).toBe(firmMemoryStateDigest(second.state));
  });

  it('the pinned golden literals hold (any drift fails loudly)', () => {
    const { state, digests } = runGoldenPipeline();
    const [b1Digest, b1Head, b2Digest, b3Digest, b3ContradictionHead, b4Digest, b5Digest, b6Digest, bDigest] = digests as [string, string, string, string, string, string, string, string, string];
    expect(b1Digest).toBe(GOLDEN_STATE_DIGEST_B1);
    expect(b1Head).toBe(GOLDEN_KNOWLEDGE_HEAD_B1);
    expect(b2Digest).toBe(GOLDEN_STATE_DIGEST_B2);
    expect(b3Digest).toBe(GOLDEN_STATE_DIGEST_B3);
    expect(b3ContradictionHead).toBe(GOLDEN_CONTRADICTION_HEAD_B3);
    expect(b4Digest).toBe(GOLDEN_STATE_DIGEST_B4);
    expect(b5Digest).toBe(GOLDEN_STATE_DIGEST_B5);
    expect(b6Digest).toBe(GOLDEN_STATE_DIGEST_B6);
    expect(bDigest).toBe(GOLDEN_STATE_DIGEST_B);
    expect(state.knowledgeLog.records.length).toBe(GOLDEN_KNOWLEDGE_COUNT);
    expect(state.contradictionLog.records.length).toBe(GOLDEN_CONTRADICTION_COUNT);
    const served = queryFirmKnowledge(state, { tenant: FIRM_TENANT, project: FIRM_PROJECT }, { at: asTimestampMs(FIRM_T0 + 5_000_000), retention: firmScenarioServingPolicy });
    if (!served.ok) throw new Error(served.errors.map((error) => error.message).join('; '));
    expect(served.value.length).toBe(GOLDEN_ACTIVE_COUNT);
  });
});

describe('the chain derivation is byte-stable (the fold + the content addresses)', () => {
  it('re-running one batch twice mints the SAME fkr: ids, the SAME chain head and the SAME receipt', () => {
    const run = () => ingest(createFirmMemoryState(), scenarioSnapshotAdverse());
    const first = run();
    const second = run();
    expect(first.state.knowledgeLog.head).toBe(second.state.knowledgeLog.head);
    expect(first.state.knowledgeLog.records.map((record) => record.knowledgeId)).toEqual(second.state.knowledgeLog.records.map((record) => record.knowledgeId));
    expect(first.receipt.receiptId).toBe(second.receipt.receiptId);
    expect(first.receipt.batchDigest).toBe(second.receipt.batchDigest);
    expect(first.receipt.fresh).toEqual(second.receipt.fresh);
    expect(JSON.stringify(first.state)).toBe(JSON.stringify(second.state));
  });

  it('the point-in-time serving digest is stable (the projection is pure)', () => {
    const run = () => JSON.stringify(queryFirmKnowledge(runGoldenPipeline().state, { tenant: FIRM_TENANT, project: FIRM_PROJECT }, { at: asTimestampMs(FIRM_T0 + 3_000_000), retention: firmScenarioServingPolicy, activeOnly: false }));
    expect(run()).toBe(run());
  });
});
