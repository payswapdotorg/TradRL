/**
 * @tradrl/firm-memory-service — the serving surface's laws: the L4
 * point-in-time projection (future entries invisible; a future point
 * read is the typed `l4_boundary_violation`), the decay windows (an
 * expired validity window serves as history, not active knowledge),
 * the supersession projection (the deterministic family winner +
 * `supersededBy`), the retention horizon (NEVER a deletion), the
 * chain gate (a tampered brain never serves — the typed
 * `chain_mismatch`), and the closed-vocabulary filters.
 */

import { describe, expect, it } from 'vitest';
import { ingestFirmLearning } from './ingest';
import { getKnowledgeAt, queryContradictions, queryFirmKnowledge } from './serve';
import { createFirmMemoryState, type FirmMemoryState } from './state';
import {
  FIRM_PROJECT,
  FIRM_T0,
  FIRM_TENANT,
  firmScenarioPolicy,
  firmScenarioServingPolicy,
  firmScenarioShortPolicy,
  scenarioSnapshotAdverse,
  scenarioSnapshotChallenger,
  scenarioSnapshotDominating,
  scenarioSnapshotMinimal,
  scenarioSnapshotReinforce,
} from './fixtures';
import { asTimestampMs, deepFreeze, type TimestampMs } from './imports';

/** Ingest one scenario (the tests' shorthand; throws on failure). */
function ingest(state: FirmMemoryState, snapshot: { readonly outcomes: readonly unknown[]; readonly postMortems: readonly unknown[]; readonly at: TimestampMs }, policy = firmScenarioPolicy) {
  const result = ingestFirmLearning(state, { outcomes: snapshot.outcomes, postMortems: snapshot.postMortems }, policy, { at: snapshot.at });
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.code}: ${error.message}`).join('; '));
  return result.value.state;
}

const SCOPE = { tenant: FIRM_TENANT, project: FIRM_PROJECT };
const WHOLE_HISTORY = { retention: firmScenarioServingPolicy };

/** The full A-scenario brain (batches 1..4: fresh, revision, contest, supersession). */
function fullBrain(): FirmMemoryState {
  let state = createFirmMemoryState();
  state = ingest(state, scenarioSnapshotAdverse());
  state = ingest(state, scenarioSnapshotReinforce());
  state = ingest(state, scenarioSnapshotChallenger());
  state = ingest(state, scenarioSnapshotDominating());
  return state;
}

describe('the L4 law (point-in-time truth — no lookahead in serving)', () => {
  it('a query at the batch-1 instant sees ONLY the batch-1 knowledge (the future is invisible)', () => {
    const brain = fullBrain();
    // At T0+200_000 (batch 1): exactly the two fresh entries.
    const atBatch1 = queryFirmKnowledge(brain, SCOPE, { at: scenarioSnapshotAdverse().at, retention: firmScenarioServingPolicy });
    if (!atBatch1.ok) throw new Error(atBatch1.errors.map((error) => error.message).join('; '));
    expect(atBatch1.value).toHaveLength(2);
    expect(atBatch1.value.every((served) => served.record.evidenceCount === 3)).toBe(true); // pre-revision counts
    // At the challenger instant (batch 3): the market family still adverse (e=5) — the flip is future.
    const atChallenger = queryFirmKnowledge(brain, SCOPE, { at: scenarioSnapshotChallenger().at, retention: firmScenarioServingPolicy });
    if (!atChallenger.ok) throw new Error(atChallenger.errors.map((error) => error.message).join('; '));
    const market = atChallenger.value.filter((served) => served.record.claim.kind === 'market_behavior');
    expect(market).toHaveLength(1);
    expect(market[0]?.record.claim.polarity).toBe('adverse');
    // At the dominating instant (batch 4): the flip exists.
    const atFlip = queryFirmKnowledge(brain, SCOPE, { at: scenarioSnapshotDominating().at, retention: firmScenarioServingPolicy });
    if (!atFlip.ok) throw new Error(atFlip.errors.map((error) => error.message).join('; '));
    const flipped = atFlip.value.filter((served) => served.record.claim.kind === 'market_behavior');
    expect(flipped[0]?.record.claim.polarity).toBe('favorable');
    expect(flipped[0]?.record.evidenceCount).toBe(6);
  });

  it('a POINT READ of a future-stamped entry is the typed l4_boundary_violation (defense in depth)', () => {
    const brain = fullBrain();
    const late = queryFirmKnowledge(brain, SCOPE, { at: asTimestampMs(FIRM_T0 + 5_000_000), retention: firmScenarioServingPolicy });
    if (!late.ok) throw new Error(late.errors.map((error) => error.message).join('; '));
    const flipId = (late.value.find((served) => served.record.claim.kind === 'market_behavior' && served.record.claim.polarity === 'favorable') as { record: { knowledgeId: string } }).record.knowledgeId;
    const early = getKnowledgeAt(brain, { ...SCOPE, knowledgeId: flipId }, { at: scenarioSnapshotAdverse().at, retention: firmScenarioServingPolicy });
    if (early.ok) throw new Error('must fail');
    expect(early.errors[0]?.code).toBe('l4_boundary_violation');
    expect(early.errors[0]?.message).toContain('did not exist at T');
  });
});

describe('the decay windows (validity expiry)', () => {
  it('active knowledge decays after its validity window: excluded when activeOnly, reported as decayed when history', () => {
    const brain = ingest(createFirmMemoryState(), scenarioSnapshotMinimal(), firmScenarioShortPolicy);
    const entry = brain.knowledgeLog.records[0];
    if (entry === undefined) throw new Error('the minimal scenario must promote');
    const withinWindow = asTimestampMs((entry.validity.from as number) + 500);
    const afterWindow = asTimestampMs((entry.validity.to as number) + 1);

    const active = queryFirmKnowledge(brain, SCOPE, { at: withinWindow, retention: firmScenarioServingPolicy });
    if (!active.ok) throw new Error(active.errors.map((error) => error.message).join('; '));
    expect(active.value).toHaveLength(1);
    expect(active.value[0]?.status).toBe('active');

    const activeAfterDecay = queryFirmKnowledge(brain, SCOPE, { at: afterWindow, retention: firmScenarioServingPolicy });
    if (!activeAfterDecay.ok) throw new Error(activeAfterDecay.errors.map((error) => error.message).join('; '));
    expect(activeAfterDecay.value).toHaveLength(0); // decayed — not active knowledge

    const history = queryFirmKnowledge(brain, SCOPE, { at: afterWindow, retention: firmScenarioServingPolicy, activeOnly: false });
    if (!history.ok) throw new Error(history.errors.map((error) => error.message).join('; '));
    expect(history.value).toHaveLength(1);
    expect(history.value[0]?.status).toBe('decayed'); // the honest verdict, history-served
  });

  it('reinforcement re-opens the window (a revision at a later instant extends validity)', () => {
    // The adverse batch first (a 30s window under the short policy), then the LATER minimal batch
    // revises the market family — the union folds and the window re-opens at the later instant.
    let brain = ingest(createFirmMemoryState(), scenarioSnapshotAdverse(), firmScenarioShortPolicy);
    brain = ingest(brain, scenarioSnapshotMinimal(), firmScenarioShortPolicy);
    const marketRecords = brain.knowledgeLog.records.filter((record) => record.claim.kind === 'market_behavior');
    const revision = marketRecords[marketRecords.length - 1];
    if (revision === undefined || marketRecords.length < 2) throw new Error('the minimal batch must revise the market family');
    expect((revision.validity.to as number) - (revision.validity.from as number)).toBe(1_000);
    expect(revision.validity.from).toBe(scenarioSnapshotMinimal().at); // re-opened at the revision instant
    expect(revision.evidenceCount).toBe(5); // the union fold: o1..o3 + m1,m2
  });
});

describe('the supersession projection (deterministic winners)', () => {
  it('after the dominating flip, the adverse entry serves as SUPERSEDED history with supersededBy pointing at the winner', () => {
    const brain = fullBrain();
    const at = asTimestampMs(FIRM_T0 + 5_000_000);
    const history = queryFirmKnowledge(brain, SCOPE, { at, retention: firmScenarioServingPolicy, activeOnly: false });
    if (!history.ok) throw new Error(history.errors.map((error) => error.message).join('; '));
    const market = history.value.filter((served) => served.record.claim.kind === 'market_behavior');
    expect(market).toHaveLength(3); // fresh adverse, revised adverse, dominating favorable
    const adverse = market.filter((served) => served.record.claim.polarity === 'adverse');
    const favorable = market.filter((served) => served.record.claim.polarity === 'favorable');
    expect(favorable[0]?.status).toBe('active');
    for (const served of adverse) {
      expect(served.status).toBe('superseded');
      expect(served.supersededBy).toBe(favorable[0]?.record.knowledgeId);
    }
    // activeOnly serves only the winner.
    const activeOnly = queryFirmKnowledge(brain, SCOPE, { at, retention: firmScenarioServingPolicy });
    if (!activeOnly.ok) throw new Error(activeOnly.errors.map((error) => error.message).join('; '));
    expect(activeOnly.value.filter((served) => served.record.claim.kind === 'market_behavior')).toHaveLength(1);
  });

  it('the point read bypasses activeOnly — the exact entry serves with its status reported', () => {
    const brain = fullBrain();
    const at = asTimestampMs(FIRM_T0 + 5_000_000);
    const history = queryFirmKnowledge(brain, SCOPE, { at, retention: firmScenarioServingPolicy, activeOnly: false });
    if (!history.ok) throw new Error(history.errors.map((error) => error.message).join('; '));
    const superseded = history.value.find((served) => served.status === 'superseded') as { record: { knowledgeId: string } };
    const point = getKnowledgeAt(brain, { ...SCOPE, knowledgeId: superseded.record.knowledgeId }, { at, retention: firmScenarioServingPolicy });
    if (!point.ok) throw new Error(point.errors.map((error) => error.message).join('; '));
    expect(point.value.status).toBe('superseded');
    expect(point.value.supersededBy).not.toBeNull();
  });
});

describe('the retention horizon (NEVER a deletion)', () => {
  it('a narrow history window hides old entries from history queries; the log retains everything', () => {
    const brain = fullBrain();
    const at = asTimestampMs(FIRM_T0 + 5_000_000);
    const narrow = deepFreeze({ historyWindowMs: 1_000 });
    const recent = queryFirmKnowledge(brain, SCOPE, { at, retention: narrow, activeOnly: false });
    if (!recent.ok) throw new Error(recent.errors.map((error) => error.message).join('; '));
    // Nothing was promoted within 1s of the query instant — the history window hides all.
    expect(recent.value).toHaveLength(0);
    // The full window still sees everything; the LOG itself is untouched.
    expect(brain.knowledgeLog.records.length).toBeGreaterThanOrEqual(5);
    const full = queryFirmKnowledge(brain, SCOPE, { at, retention: firmScenarioServingPolicy, activeOnly: false });
    if (!full.ok) throw new Error(full.errors.map((error) => error.message).join('; '));
    expect(full.value.length).toBe(brain.knowledgeLog.records.length);
  });
});

describe('the chain gate (a tampered brain never serves)', () => {
  it('an EDITED knowledge entry fails the chain verification — the typed chain_mismatch on every read', () => {
    const brain = fullBrain();
    const tampered = deepFreeze({
      ...brain,
      knowledgeLog: deepFreeze({
        ...brain.knowledgeLog,
        records: deepFreeze([
          { ...brain.knowledgeLog.records[0]!, confidence: '0.9' },
          ...brain.knowledgeLog.records.slice(1),
        ]),
      }),
    });
    const read = queryFirmKnowledge(tampered, SCOPE, { at: asTimestampMs(FIRM_T0 + 5_000_000), retention: firmScenarioServingPolicy });
    if (read.ok) throw new Error('must fail');
    expect(read.errors[0]?.code).toBe('chain_mismatch');
    const point = getKnowledgeAt(tampered, { ...SCOPE, knowledgeId: brain.knowledgeLog.records[0]!.knowledgeId }, { at: asTimestampMs(FIRM_T0 + 5_000_000), retention: firmScenarioServingPolicy });
    if (point.ok) throw new Error('must fail');
    expect(point.errors[0]?.code).toBe('chain_mismatch');
  });

  it('a REMOVED knowledge entry (hiding) and a tampered contradiction register also fail', () => {
    const brain = fullBrain();
    const hidden = deepFreeze({
      ...brain,
      knowledgeLog: deepFreeze({ ...brain.knowledgeLog, records: deepFreeze(brain.knowledgeLog.records.slice(0, 2)) }),
    });
    const read = queryFirmKnowledge(hidden, SCOPE, { at: asTimestampMs(FIRM_T0 + 5_000_000), retention: firmScenarioServingPolicy });
    if (read.ok) throw new Error('must fail');
    expect(read.errors[0]?.code).toBe('chain_mismatch');

    const tamperedRegister = deepFreeze({
      ...brain,
      contradictionLog: deepFreeze({
        ...brain.contradictionLog,
        records: deepFreeze(brain.contradictionLog.records.map((record, index) => (index === 0 ? { ...record, asOf: asTimestampMs(FIRM_T0 + 1) } : record))),
      }),
    });
    const contests = queryContradictions(tamperedRegister, SCOPE, { at: asTimestampMs(FIRM_T0 + 5_000_000), retention: firmScenarioServingPolicy });
    if (contests.ok) throw new Error('must fail');
    expect(contests.errors[0]?.code).toBe('chain_mismatch');
  });
});

describe('the closed-vocabulary filters + malformed inputs', () => {
  it('a foreign kind / polarity / lagBand / dimension in a query is a typed error', () => {
    const brain = fullBrain();
    const at = asTimestampMs(FIRM_T0 + 5_000_000);
    const foreignKind = queryFirmKnowledge(brain, { ...SCOPE, kinds: ['gut_feeling'] }, { at, retention: firmScenarioServingPolicy });
    if (foreignKind.ok) throw new Error('must fail');
    expect(foreignKind.errors[0]?.code).toBe('unknown_knowledge_kind');
    const foreignPolarity = queryFirmKnowledge(brain, { ...SCOPE, polarity: 'bullish' }, { at, retention: firmScenarioServingPolicy });
    if (foreignPolarity.ok) throw new Error('must fail');
    expect(foreignPolarity.errors[0]?.code).toBe('unknown_polarity');
    const foreignBand = queryFirmKnowledge(brain, { ...SCOPE, lagBand: 'sub_minute' }, { at, retention: firmScenarioServingPolicy });
    if (foreignBand.ok) throw new Error('must fail');
    expect(foreignBand.errors[0]?.code).toBe('unknown_lag_band');
    const foreignDimension = queryFirmKnowledge(brain, { ...SCOPE, dimension: 'vibes' }, { at, retention: firmScenarioServingPolicy });
    if (foreignDimension.ok) throw new Error('must fail');
    expect(foreignDimension.errors[0]?.code).toBe('invalid_field');
  });

  it('a missing instant or a malformed retention policy is a typed error', () => {
    const brain = fullBrain();
    const noInstant = queryFirmKnowledge(brain, SCOPE, { retention: firmScenarioServingPolicy } as never);
    if (noInstant.ok) throw new Error('must fail');
    expect(noInstant.errors[0]?.code).toBe('invalid_field');
    expect(noInstant.errors[0]?.path).toBe('at');
    const badRetention = queryFirmKnowledge(brain, SCOPE, { at: asTimestampMs(FIRM_T0 + 5_000_000), retention: { historyWindowMs: -1 } });
    if (badRetention.ok) throw new Error('must fail');
    expect(badRetention.errors[0]?.code).toBe('invalid_field');
  });

  it('an unknown knowledge id is the typed invalid_field (never a silent empty result)', () => {
    const brain = fullBrain();
    const point = getKnowledgeAt(brain, { ...SCOPE, knowledgeId: 'fkr:deadbeef' }, { at: asTimestampMs(FIRM_T0 + 5_000_000), retention: firmScenarioServingPolicy });
    if (point.ok) throw new Error('must fail');
    expect(point.errors[0]?.code).toBe('invalid_field');
  });

  it('the minConfidence filter is exact (the boundary is inclusive)', () => {
    const brain = ingest(createFirmMemoryState(), scenarioSnapshotAdverse());
    const at = asTimestampMs(FIRM_T0 + 5_000_000);
    const exact = queryFirmKnowledge(brain, { ...SCOPE, minConfidence: '0.4' }, { at, retention: firmScenarioServingPolicy });
    if (!exact.ok) throw new Error(exact.errors.map((error) => error.message).join('; '));
    expect(exact.value.map((served) => served.record.confidence).sort()).toEqual(['0.4', '0.5']);
    const above = queryFirmKnowledge(brain, { ...SCOPE, minConfidence: '0.45' }, { at, retention: firmScenarioServingPolicy });
    if (!above.ok) throw new Error(above.errors.map((error) => error.message).join('; '));
    expect(above.value.map((served) => served.record.confidence)).toEqual(['0.5']);
    const nonCanonical = queryFirmKnowledge(brain, { ...SCOPE, minConfidence: '0.5.5' }, { at, retention: firmScenarioServingPolicy });
    if (nonCanonical.ok) throw new Error('must fail');
    expect(nonCanonical.errors[0]?.code).toBe('confidence_incoherent');
  });
});

describe('the contradiction query surface', () => {
  it('serves the contests scope-pure, point-in-time, with the filters', () => {
    const brain = fullBrain();
    const at = asTimestampMs(FIRM_T0 + 5_000_000);
    const contests = queryContradictions(brain, SCOPE, { at, retention: firmScenarioServingPolicy });
    if (!contests.ok) throw new Error(contests.errors.map((error) => error.message).join('; '));
    expect(contests.value).toHaveLength(2); // the non-dominating + the dominating contest
    expect(contests.value.every((record) => record.tenant === FIRM_TENANT)).toBe(true);
    // Before the challenger instant: no contests are visible (L4).
    const early = queryContradictions(brain, SCOPE, { at: scenarioSnapshotAdverse().at, retention: firmScenarioServingPolicy });
    if (!early.ok) throw new Error(early.errors.map((error) => error.message).join('; '));
    expect(early.value).toHaveLength(0);
    // The polarity filter.
    const favorable = queryContradictions(brain, { ...SCOPE, polarity: 'favorable' }, { at, retention: firmScenarioServingPolicy });
    if (!favorable.ok) throw new Error(favorable.errors.map((error) => error.message).join('; '));
    expect(favorable.value.length).toBeGreaterThanOrEqual(1);
  });
});
