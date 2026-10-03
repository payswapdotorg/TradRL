/**
 * Cross-lane interoperability trip wires for the firm-memory lane
 * (Work Order T034): the REAL lanes this lane consumes ONLY through
 * its structural mirrors are loaded STATICALLY here (the tests are
 * the trip wires — the src lane itself imports neither):
 *
 *   - services/shadow-trading (T030) + services/outcome-learning
 *     (T033): the REAL golden session runs to completion, the REAL
 *     ingestion + draft generation run over it, the REAL query
 *     surface (queryOutcomeRecords + queryPostMortems — the Firm
 *     Brain's declared ingestion source) returns REAL records, and
 *     those records satisfy this lane's MIRRORS structurally
 *     (type-level witnesses + runtime guards). A FULL Firm-Brain
 *     ingestion promotes ALL FOUR knowledge kinds from the REAL
 *     pipeline; the promotion is byte-deterministic (L9); a tampered
 *     brain never serves.
 *   - packages/outcomes (T033's contracts): the REAL OutcomeRecord /
 *     PostMortemRecord / OutcomeLearningHook satisfy the mirrors
 *     field-for-field (compiles iff the mirrors have not drifted).
 *   - packages/control-domain (T007): the REAL TenantId/ProjectId
 *     identity shapes ARE this lane's opaque refs (one program-wide
 *     tenant identity space — L12).
 *   - packages/trajectory + packages/experiments (T011): the REAL
 *     trajectory metadata and trial record validate under THEIR
 *     guards and their ids flow BYTE-EXACT through the binding into
 *     the Firm Brain's provenance.
 *   - packages/execution-policy (T019): the REAL decimal kernel
 *     (add/subtract/compare over canonical decimals) agrees with this
 *     lane's LOCAL exact-decimal helpers on a corpus of signed pairs
 *     — the parity trip wire that licenses the zero-import design.
 */

import { describe, expect, it } from 'vitest';
import * as shadowTrading from '../../shadow-trading/src/index';
import { runReferenceScenario, referenceIntentStream } from '../../shadow-trading/src/fixtures';
import * as outcomeLearning from '../../outcome-learning/src/index';
import { queryOutcomeRecords, queryPostMortems } from '../../outcome-learning/src/query';
import * as trajectory from '../../../packages/trajectory/src/index';
import * as experiments from '../../../packages/experiments/src/index';
import * as controlDomain from '../../../packages/control-domain/src/index';
import * as executionPolicy from '../../../packages/execution-policy/src/index';
import * as outcomesContracts from '../../../packages/outcomes/src/index';
import { ingestFirmLearning } from './ingest';
import { queryFirmKnowledge } from './serve';
import { createFirmMemoryState, firmMemoryStateDigest, type FirmMemoryState } from './state';
import { firmScenarioPolicy, firmScenarioServingPolicy } from './fixtures';
import {
  isOutcomeRecordMirror,
  isPostMortemRecordMirror,
  type OutcomeRecordMirror,
  type PostMortemRecordMirror,
} from './imports';
import { deepFreeze, signedAdd, signedCompare, signedSubtract } from './imports';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL T033 OutcomeRecord IS this lane's mirror. */
function realOutcomeSatisfiesMirror(record: outcomesContracts.OutcomeRecord): OutcomeRecordMirror {
  return record;
}

/** Compiles iff the REAL T033 PostMortemRecord IS this lane's mirror. */
function realPostMortemSatisfiesMirror(record: outcomesContracts.PostMortemRecord): PostMortemRecordMirror {
  return record;
}

/** Compiles iff the REAL T007 TenantId/ProjectId ARE this lane's opaque scope refs (one identity space, L12). */
function realControlDomainScope(tenant: controlDomain.TenantId, project: controlDomain.ProjectId): { tenant: string; project: string } {
  return { tenant, project };
}

/** Compiles iff the REAL T011 trajectory/experiment/trial ids ARE this lane's opaque refs (the T011 discipline). */
function realT011IdsSatisfyRefs(meta: trajectory.TrajectoryMetadata, trial: experiments.TrialRecord): { trajectoryRef: string; experimentRef: string; trialRef: string } {
  return { trajectoryRef: meta.trajectory_id, experimentRef: 'experiment-interop-t034', trialRef: trial.trial_id };
}

void realOutcomeSatisfiesMirror;
void realPostMortemSatisfiesMirror;
void realControlDomainScope;
void realT011IdsSatisfyRefs;

// ---------------------------------------------------------------------------
// The REAL golden pipeline (T030 -> T033), driven end-to-end
// ---------------------------------------------------------------------------

/** The retention that serves the whole append-only history (the trip wire's window). */
const WHOLE_HISTORY = { outcomeWindowMs: Number.MAX_SAFE_INTEGER, postMortemWindowMs: Number.MAX_SAFE_INTEGER };

/** Run the REAL golden session + the REAL ingestion + the REAL drafts + the REAL queries. */
async function realQuerySurface(): Promise<{ readonly outcomes: readonly OutcomeRecordMirror[]; readonly postMortems: readonly PostMortemRecordMirror[]; readonly tenant: string; readonly project: string; readonly at: number }> {
  const session = await runReferenceScenario();
  const decisionFacts = referenceIntentStream().map((intent) => ({
    intentRef: intent.intentId,
    decisionRef: null, // the decision refs bind through the outcome records, not the intents
    venue: intent.order.venueId,
    instrument: intent.order.instrumentId,
    side: intent.order.side,
    orderQuantity: intent.order.quantity,
    streamPosition: intent.sequence,
  }));
  const fillFacts = session.fills.map((fill) => ({
    fillId: fill.fillId,
    intentRef: fill.intentRef,
    quantity: fill.worldFill.fill.quantity,
    availableAt: fill.worldFill.fill.quartet.available_time,
  }));
  const intents = referenceIntentStream();
  const expectations = [
    { intentRef: intents[0]?.intentId as string, expectedRealized: '4', declaredBy: 'body:interop-projectionist' },
    { intentRef: intents[1]?.intentId as string, expectedRealized: '35', declaredBy: 'body:interop-projectionist' },
    { intentRef: intents[5]?.intentId as string, expectedRealized: '12.5', declaredBy: 'body:interop-projectionist' },
  ];
  const ingested = outcomeLearning.ingestShadowOutcomes(outcomeLearning.createOutcomeLearningState(), {
    outcomeLog: session.outcomeLog,
    bookSnapshot: session.book,
    binding: { trajectoryRef: null, experimentRef: null, trialRef: null },
    decisionFacts,
    fillFacts,
    expectations,
    at: session.now,
  });
  if (!ingested.ok) throw new Error(ingested.errors.map((error) => error.message).join('; '));
  const drafted = outcomeLearning.generatePostMortemDrafts(ingested.value, outcomeLearning.DEFAULT_POST_MORTEM_DRAFT_POLICY, {
    markFacts: [{ venue: 'SHADOWSIM', instrument: 'BTC-USD', markAtDecision: '50100', markAtWindow: '50400' }],
    at: session.now,
  });
  if (!drafted.ok) throw new Error(drafted.errors.map((error) => error.message).join('; '));
  const outcomes = queryOutcomeRecords(drafted.value.state, { tenant: session.tenant, project: session.project }, { at: session.now, retention: WHOLE_HISTORY });
  if (!outcomes.ok) throw new Error(outcomes.errors.map((error) => error.message).join('; '));
  const postMortems = queryPostMortems(drafted.value.state, { tenant: session.tenant, project: session.project }, { at: session.now, retention: WHOLE_HISTORY });
  if (!postMortems.ok) throw new Error(postMortems.errors.map((error) => error.message).join('; '));
  return { outcomes: outcomes.value, postMortems: postMortems.value, tenant: session.tenant, project: session.project, at: session.now as number };
}

describe('the REAL T033 query surface through the mirrors (the drift trip wires)', () => {
  it('the REAL outcome records + post-mortem drafts satisfy the mirror guards', async () => {
    const surface = await realQuerySurface();
    expect(surface.outcomes.length).toBe(7); // T030's own golden decision count
    expect(surface.postMortems.length).toBe(4); // T033's own golden draft count (adverse_gap x2, execution_shortfall, no_execution)
    for (const outcome of surface.outcomes) expect(isOutcomeRecordMirror(outcome)).toBe(true);
    for (const postMortem of surface.postMortems) expect(isPostMortemRecordMirror(postMortem)).toBe(true);
    // The REAL chain verdicts still hold (the brain ingests from a verified lane).
    expect(shadowTrading.verifyShadowOutcomeChain((await runReferenceScenario()).outcomeLog)).toBe(true);
  });

  it('a FULL Firm-Brain ingestion promotes ALL FOUR knowledge kinds from the REAL pipeline', async () => {
    const surface = await realQuerySurface();
    const ingested = ingestFirmLearning(createFirmMemoryState(), { outcomes: surface.outcomes, postMortems: surface.postMortems }, firmScenarioPolicy, { at: surface.at as never });
    if (!ingested.ok) throw new Error(ingested.errors.map((error) => `${error.code}: ${error.message}`).join('; '));
    const { state, receipt } = ingested.value;
    expect(receipt.fresh).toHaveLength(4);
    expect(receipt.revisions).toHaveLength(0);
    expect(receipt.contradictions).toHaveLength(0);
    const claims = state.knowledgeLog.records.map((record) => `${record.claim.kind}/${record.claim.dimension ?? record.claim.lagBand ?? ''}:${record.claim.polarity}`);
    // The golden marks ROSE (50100 -> 50400): the drafted buys watched a FAVORABLE move
    // (3 of the 4 drafted outcomes) — only one drafted sell watched the adverse side (e=1, below the bar).
    expect(claims.sort()).toEqual(['data_latency/sub_second:harmful', 'decision_pattern/unresolved:harmful', 'market_behavior/:favorable', 'model_calibration/:over_projection']);
    // The evidence folds over the REAL records: decision 4 outcomes, market 3, calibration 2, latency 3.
    const byKind = new Map(state.knowledgeLog.records.map((record) => [record.claim.kind, record] as const));
    expect(byKind.get('decision_pattern')?.evidenceCount).toBe(4);
    expect(byKind.get('market_behavior')?.evidenceCount).toBe(3);
    expect(byKind.get('model_calibration')?.evidenceCount).toBe(2);
    expect(byKind.get('data_latency')?.evidenceCount).toBe(3);
    // The provenance refs are the REAL content-addressed ids, byte-exact.
    for (const record of state.knowledgeLog.records) {
      for (const ref of record.provenance.outcomeRefs) expect(ref).toMatch(/^out:[0-9a-f]{8}$/);
      for (const ref of record.provenance.postMortemRefs) expect(ref).toMatch(/^pmr:[0-9a-f]{8}$/);
      expect(record.provenance.sessionRefs.every((ref) => ref.startsWith('shs:'))).toBe(true);
      expect(record.tenant).toBe(surface.tenant);
      expect(record.project).toBe(surface.project);
    }
    // The MIN-fold confidences are the REAL draft policy's values.
    expect(byKind.get('market_behavior')?.confidence).toBe('0.5');
    expect(byKind.get('decision_pattern')?.confidence).toBe('0.4');
    expect(byKind.get('data_latency')?.confidence).toBe('0.3'); // the weakest evidence bounds the claim
    // Point-in-time serving over the REAL-fed brain.
    const served = queryFirmKnowledge(state, { tenant: surface.tenant, project: surface.project }, { at: surface.at as never, retention: firmScenarioServingPolicy });
    if (!served.ok) throw new Error(served.errors.map((error) => error.message).join('; '));
    expect(served.value).toHaveLength(4);
    expect(served.value.every((entry) => entry.status === 'active')).toBe(true);
  });

  it('the REAL-fed brain is byte-deterministic (identical inputs -> identical bytes, L9)', async () => {
    const surface = await realQuerySurface();
    const run = (): FirmMemoryState => {
      const ingested = ingestFirmLearning(createFirmMemoryState(), { outcomes: surface.outcomes, postMortems: surface.postMortems }, firmScenarioPolicy, { at: surface.at as never });
      if (!ingested.ok) throw new Error(ingested.errors.map((error) => error.message).join('; '));
      return ingested.value.state;
    };
    const first = run();
    const second = run();
    expect(firmMemoryStateDigest(first)).toBe(firmMemoryStateDigest(second));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('a tampered REAL-fed brain never serves (the typed chain_mismatch)', async () => {
    const surface = await realQuerySurface();
    const ingested = ingestFirmLearning(createFirmMemoryState(), { outcomes: surface.outcomes, postMortems: surface.postMortems }, firmScenarioPolicy, { at: surface.at as never });
    if (!ingested.ok) throw new Error(ingested.errors.map((error) => error.message).join('; '));
    const records = [...ingested.value.state.knowledgeLog.records];
    const tampered = deepFreeze({
      ...ingested.value.state,
      knowledgeLog: deepFreeze({
        ...ingested.value.state.knowledgeLog,
        records: deepFreeze([{ ...records[0]!, evidenceCount: 99 }, ...records.slice(1)]),
      }),
    });
    const read = queryFirmKnowledge(tampered, { tenant: surface.tenant, project: surface.project }, { at: surface.at as never, retention: firmScenarioServingPolicy });
    if (read.ok) throw new Error('must fail');
    expect(read.errors[0]?.code).toBe('chain_mismatch');
  });
});

describe('the REAL T011 records through the binding (the lineage trip wires)', () => {
  it('flows real trajectory/experiment/trial ids byte-exact into the firm knowledge provenance', async () => {
    const surface = await realQuerySurface();
    // REAL trajectory metadata + REAL trial record (validated under THEIR guards).
    const meta = trajectory.validateTrajectoryMetadata({
      trajectory_id: 'trajectory-interop-t034',
      tenant: surface.tenant,
      project: surface.project,
      episode: 'epi-interop-t034',
      environment_config: 'envcfg:interop-1',
      runtime: 'runtime:interop-1',
      data: [],
      body_versions: ['bodyv:interop-1'],
      substrates: ['substrate:interop-1'],
    });
    if (!meta.ok) throw new Error(meta.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; '));
    const trial = experiments.validateTrialRecord({
      trial_id: 'trial-interop-t034',
      arm: 'arm-interop-alpha',
      status: 'succeeded',
      trajectory: 'trajectory-interop-t034',
      outcome: { verdict: 'ok' },
      started_at: 1_700_000_000_000,
      ended_at: surface.at,
      failure_reason: null,
    });
    if (!trial.ok) throw new Error(trial.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; '));

    // Re-run the REAL ingestion with the T011 binding, then the Firm-Brain ingestion.
    const session = await runReferenceScenario();
    const intents = referenceIntentStream();
    const ingested = outcomeLearning.ingestShadowOutcomes(outcomeLearning.createOutcomeLearningState(), {
      outcomeLog: session.outcomeLog,
      bookSnapshot: session.book,
      binding: { trajectoryRef: meta.value.trajectory_id, experimentRef: 'experiment-interop-t034', trialRef: trial.value.trial_id },
      decisionFacts: intents.map((intent) => ({
        intentRef: intent.intentId,
        decisionRef: null,
        venue: intent.order.venueId,
        instrument: intent.order.instrumentId,
        side: intent.order.side,
        orderQuantity: intent.order.quantity,
        streamPosition: intent.sequence,
      })),
      fillFacts: session.fills.map((fill) => ({
        fillId: fill.fillId,
        intentRef: fill.intentRef,
        quantity: fill.worldFill.fill.quantity,
        availableAt: fill.worldFill.fill.quartet.available_time,
      })),
      expectations: [
        { intentRef: intents[0]?.intentId as string, expectedRealized: '4', declaredBy: 'body:interop-projectionist' },
        { intentRef: intents[1]?.intentId as string, expectedRealized: '35', declaredBy: 'body:interop-projectionist' },
        { intentRef: intents[5]?.intentId as string, expectedRealized: '12.5', declaredBy: 'body:interop-projectionist' },
      ],
      at: session.now,
    });
    if (!ingested.ok) throw new Error(ingested.errors.map((error) => error.message).join('; '));
    const drafted = outcomeLearning.generatePostMortemDrafts(ingested.value, outcomeLearning.DEFAULT_POST_MORTEM_DRAFT_POLICY, {
      markFacts: [{ venue: 'SHADOWSIM', instrument: 'BTC-USD', markAtDecision: '50100', markAtWindow: '50400' }],
      at: session.now,
    });
    if (!drafted.ok) throw new Error(drafted.errors.map((error) => error.message).join('; '));
    const outcomes = queryOutcomeRecords(drafted.value.state, { tenant: session.tenant, project: session.project }, { at: session.now, retention: WHOLE_HISTORY });
    if (!outcomes.ok) throw new Error(outcomes.errors.map((error) => error.message).join('; '));
    const postMortems = queryPostMortems(drafted.value.state, { tenant: session.tenant, project: session.project }, { at: session.now, retention: WHOLE_HISTORY });
    if (!postMortems.ok) throw new Error(postMortems.errors.map((error) => error.message).join('; '));

    const brainIngested = ingestFirmLearning(createFirmMemoryState(), { outcomes: outcomes.value, postMortems: postMortems.value }, firmScenarioPolicy, { at: session.now as never });
    if (!brainIngested.ok) throw new Error(brainIngested.errors.map((error) => error.message).join('; '));
    for (const record of brainIngested.value.state.knowledgeLog.records) {
      expect(record.provenance.trajectoryRefs).toContain('trajectory-interop-t034'); // the REAL id, byte-exact
      expect(record.provenance.experimentRefs).toContain('experiment-interop-t034');
      expect(record.provenance.trialRefs).toContain('trial-interop-t034');
    }
  });
});

describe('the REAL decimal kernel parity (the zero-import license)', () => {
  it('agrees with execution-policy REAL add/compare/subtract over a corpus of canonical pairs (the kernel UNSIGNED domain)', () => {
    const corpus: readonly [string, string][] = [
      ['0', '0'], ['1', '0'], ['0', '1'], ['1.5', '2.25'], ['0.1', '0.2'], ['0.0000001', '0.0000002'],
      ['50041.66666667', '2400'], ['38.32833333', '38.32833333'], ['999999999.99999999', '0.00000001'],
      ['1', '0.99999999'], ['100000', '47504.515'], ['7', '12.000000001'], ['50100', '100'],
    ];
    for (const [a, b] of corpus) {
      expect(signedAdd(a, b)).toBe(executionPolicy.add(a, b));
      expect(String(signedCompare(a, b))).toBe(String(executionPolicy.compare(a, b)));
      if (executionPolicy.compare(a, b) >= 0) {
        expect(signedSubtract(a, b)).toBe(executionPolicy.subtract(a, b));
      } else {
        expect(signedSubtract(a, b)).toBe(`-${executionPolicy.subtract(b, a)}`);
      }
    }
  });

  it('handles the signed extension exactly where the kernel UNSIGNED domain ends (the local grammar)', () => {
    expect(signedAdd('-1.5', '2.25')).toBe('0.75');
    expect(signedAdd('-1.5', '-2.25')).toBe('-3.75');
    expect(signedSubtract('-5', '-7.5')).toBe('2.5');
    expect(signedCompare('-2.5', '2.4')).toBe(-1);
    // The kernel would throw here (the unsigned domain law); the signed
    // extension is the consuming lanes' documented pattern.
    expect(() => executionPolicy.subtract('1', '2')).toThrow();
  });
});
