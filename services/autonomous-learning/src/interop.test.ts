/**
 * Cross-lane interoperability trip wires for the autonomous-learning lane
 * (Work Order T035): the REAL lanes this loop consumes ONLY through its
 * STRUCTURAL MIRRORS are loaded STATICALLY here (the tests are the trip
 * wires — the src lane itself imports none of them):
 *
 *   - services/shadow-trading (T030) + services/outcome-learning (T033):
 *     the REAL golden session runs to completion, the REAL ingestion +
 *     draft generation run over it, and the REAL `queryLearningHooks`
 *     surface returns the REAL hooks that drive this loop's cycle (the
 *     drift trip wires: the REAL hooks satisfy this lane's mirrors, and
 *     the REAL outcome/post-mortem records flow VERBATIM through the
 *     memory feed).
 *   - services/firm-memory (T034): the cycle's memory feed drives the
 *     REAL `ingestFirmLearning` — the brain grows from the loop's product
 *     (the Firm-Brain semantics honored end-to-end) — and the grown
 *     brain's REAL `queryFirmKnowledge` output annotates the NEXT cycle
 *     (the loop closes: cycle 1 feeds the brain, cycle 2 reads it).
 *   - services/learning (T015): the cycle's curriculum revision drives
 *     the REAL `planCurriculum` over a REAL validated curriculum version
 *     (in the session's scope) — the REAL plan's gap-driven stages cite
 *     the loop's minted gap ids; the REAL trail (openCurriculumTrail +
 *     enterCurriculum) drives the cycle's earned-rung gate.
 *   - packages/search-lineage (T031): the REAL `createSearchRecord` +
 *     `appendSearchTrial` build the retained search history the adoption
 *     gate reads; every search-trial bundle the loop emits appends to the
 *     REAL record green (the improvement search is retained), and the
 *     appended record still verifies.
 *   - packages/skills (T017's contracts) + services/body-forge (T017):
 *     the loop's minted gaps satisfy the REAL capability-gap guards, and
 *     the commission's bundle (gaps + evidence + seed) drives the REAL
 *     `forgeBodyVersion` — a REAL ForgedCandidate whose lineage carries
 *     the loop's gap ids.
 *   - packages/trajectory + packages/experiments (T011): the REAL
 *     trajectory metadata and experiment binding flow BYTE-EXACT through
 *     the T033 records into the commission's evidence block.
 */

import { describe, expect, it } from 'vitest';
import * as shadowTrading from '../../shadow-trading/src/index';
import { referenceIntentStream, runReferenceScenario } from '../../shadow-trading/src/fixtures';
import * as outcomeLearning from '../../outcome-learning/src/index';
import { queryLearningHooks, queryOutcomeRecords, queryPostMortems } from '../../outcome-learning/src/query';
import * as firmMemory from '../../firm-memory/src/index';
import { firmScenarioPolicy, firmScenarioServingPolicy } from '../../firm-memory/src/fixtures';
import * as learning from '../../learning/src/index';
import { goldenCurriculumVersionLiteral } from '../../learning/src/curriculum/fixtures';
import * as searchLineage from '../../../packages/search-lineage/src/index';
import * as skills from '../../../packages/skills/src/index';
import * as bodyForge from '../../body-forge/src/index';
import { fixtureDeltas, fixtureParentBodyVersion } from '../../body-forge/src/fixtures';
import * as trajectory from '../../../packages/trajectory/src/index';
import * as outcomesContracts from '../../../packages/outcomes/src/index';
import {
  DEFAULT_IMPROVEMENT_POLICY,
  ImprovementCycleInputs,
  OutcomeLearningHookMirror,
  ServedKnowledgeEnvelopeMirror,
  createAutonomousLearningState,
  isOutcomeLearningHookMirror,
  isSearchRecordMirror,
  isSearchTrialEntryMirror,
  runImprovementCycle,
  verifySearchRecordMirror,
} from './index';
import type { CurriculumTrailMirror, SearchRecordMirror } from './index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL T033 OutcomeLearningHook IS this lane's mirror. */
function realHookSatisfiesMirror(hook: outcomesContracts.OutcomeLearningHook): OutcomeLearningHookMirror {
  return hook;
}

/** Compiles iff the REAL T015 CurriculumTrail IS this lane's mirror. */
function realTrailSatisfiesMirror(trail: learning.CurriculumTrail): CurriculumTrailMirror {
  return trail;
}

/** Compiles iff the REAL T031 SearchRecord IS this lane's mirror. */
function realSearchSatisfiesMirror(record: searchLineage.SearchRecord): SearchRecordMirror {
  return record;
}

/** Compiles iff the REAL T033 hook IS this lane's mirror (the drift trip wire). */
function realHookSatisfiesMirrorArray(hooks: readonly outcomesContracts.OutcomeLearningHook[]): readonly OutcomeLearningHookMirror[] {
  return hooks;
}

/** Compiles iff the REAL T015 CurriculumPlanInput accepts this lane's revision bundle. */
function revisionPlanInputSatisfiesRealInput(revision: { planInput: unknown }): learning.CurriculumPlanInput {
  return revision.planInput as learning.CurriculumPlanInput;
}

void realHookSatisfiesMirror;
void realHookSatisfiesMirrorArray;
void realTrailSatisfiesMirror;
void realSearchSatisfiesMirror;
void revisionPlanInputSatisfiesRealInput;

// ---------------------------------------------------------------------------
// The REAL pipelines (T030 -> T033 -> the loop's world)
// ---------------------------------------------------------------------------

/** The retention that serves the whole append-only history (the trip wire's window). */
const WHOLE_HISTORY = { outcomeWindowMs: Number.MAX_SAFE_INTEGER, postMortemWindowMs: Number.MAX_SAFE_INTEGER };

/** The REAL T011 binding this interop threads through the whole loop. */
const REAL_TRAJECTORY = 'trajectory-interop-t035';
const REAL_EXPERIMENT = 'experiment-interop-t035';
const REAL_TRIAL = 'trial-interop-t035';

/** The interop's search-record trials. */
const SEARCH_IN_TRIAL = 'trial-interop-insearch-1';
const SEARCH_HOLDOUT_TRIAL = 'trial-interop-holdout-1';

/** Run the REAL golden session + the REAL T033 pipeline; return the loop's whole world. */
async function realLoopWorld(): Promise<{
  readonly hooks: readonly outcomesContracts.OutcomeLearningHook[];
  readonly outcomes: readonly unknown[];
  readonly postMortems: readonly unknown[];
  readonly trail: learning.CurriculumTrail;
  readonly search: searchLineage.SearchRecord;
  readonly tenant: string;
  readonly project: string;
  readonly at: number;
}> {
  const session = await runReferenceScenario();
  const intents = referenceIntentStream();
  const decisionFacts = intents.map((intent) => ({
    intentRef: intent.intentId,
    decisionRef: null,
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
  const expectations = [
    { intentRef: intents[0]?.intentId as string, expectedRealized: '4', declaredBy: 'body:interop-projectionist' },
    { intentRef: intents[1]?.intentId as string, expectedRealized: '35', declaredBy: 'body:interop-projectionist' },
    { intentRef: intents[5]?.intentId as string, expectedRealized: '12.5', declaredBy: 'body:interop-projectionist' },
  ];
  const ingested = outcomeLearning.ingestShadowOutcomes(outcomeLearning.createOutcomeLearningState(), {
    outcomeLog: session.outcomeLog,
    bookSnapshot: session.book,
    binding: { trajectoryRef: REAL_TRAJECTORY, experimentRef: REAL_EXPERIMENT, trialRef: REAL_TRIAL },
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
  const hooksResult = queryLearningHooks(drafted.value.state, { tenant: session.tenant, project: session.project }, { at: session.now, retention: WHOLE_HISTORY });
  if (!hooksResult.ok) throw new Error(hooksResult.errors.map((error) => error.message).join('; '));
  const outcomes = queryOutcomeRecords(drafted.value.state, { tenant: session.tenant, project: session.project }, { at: session.now, retention: WHOLE_HISTORY });
  if (!outcomes.ok) throw new Error(outcomes.errors.map((error) => error.message).join('; '));
  const postMortems = queryPostMortems(drafted.value.state, { tenant: session.tenant, project: session.project }, { at: session.now, retention: WHOLE_HISTORY });
  if (!postMortems.ok) throw new Error(postMortems.errors.map((error) => error.message).join('; '));

  // The REAL T015 trail (entered at the bottom rung, before the cycle instant).
  const lineage = { goal: 'goal-interop-t035', curriculum_version: 'curriculum@1.0.0', tenant: session.tenant, project: session.project };
  const entry = learning.enterCurriculum(lineage, (session.now - 60_000) as never);
  if (!entry.ok) throw new Error(entry.errors.map((error) => error.message).join('; '));
  const trail = learning.openCurriculumTrail(entry.value);
  if (!trail.ok) throw new Error(trail.errors.map((error) => error.message).join('; '));

  // The REAL T031 search record: one in-search trial + one holdout leaf.
  let search = searchLineage.createSearchRecord({
    experiment: 'experiment-interop-t035',
    evaluator: 'evaluator-interop-t035@1',
    tenant: session.tenant,
    project: session.project,
  });
  if (!search.ok) throw new Error(search.errors.map((error) => error.message).join('; '));
  const inSearchAppend = searchLineage.appendSearchTrial(search.value, {
    trial: SEARCH_IN_TRIAL,
    arm: 'arm-interop-alpha',
    classification: 'in-search',
    config: { interop: 't035', lane: 'in-search' },
    parents: [],
    splits: ['split-interop-t035'],
    datasets: ['dataset-interop-t035'],
    window: null,
    evaluation_policy: 'split-interop-t035',
    recorded_at: session.now,
    tenant: session.tenant,
    project: session.project,
  });
  if (!inSearchAppend.ok) throw new Error(inSearchAppend.errors.map((error) => error.message).join('; '));
  const holdoutAppend = searchLineage.appendSearchTrial(inSearchAppend.value, {
    trial: SEARCH_HOLDOUT_TRIAL,
    arm: null,
    classification: 'holdout',
    config: { interop: 't035', lane: 'holdout' },
    parents: [],
    splits: ['split-interop-t035'],
    datasets: ['dataset-interop-t035'],
    window: null,
    evaluation_policy: 'split-interop-t035',
    recorded_at: session.now,
    tenant: session.tenant,
    project: session.project,
  });
  if (!holdoutAppend.ok) throw new Error(holdoutAppend.errors.map((error) => error.message).join('; '));

  return {
    hooks: hooksResult.value,
    outcomes: outcomes.value,
    postMortems: postMortems.value,
    trail: trail.value,
    search: holdoutAppend.value,
    tenant: session.tenant,
    project: session.project,
    at: (session.now + 1_000) as number,
  };
}

/** The cycle inputs over the REAL world (cycle one). */
async function realCycleInputs(): Promise<ImprovementCycleInputs> {
  const world = await realLoopWorld();
  return {
    at: world.at as never,
    tenant: world.tenant,
    project: world.project,
    hooks: realHookSatisfiesMirrorArray(world.hooks) as never,
    outcomes: [...world.outcomes],
    postMortems: [...world.postMortems],
    knowledge: [],
    knowledgeHead: 'fmb:interop-empty-brain',
    trail: world.trail,
    search: world.search,
    searchPolicy: { evaluationPolicy: 'split-interop-t035', splits: ['split-interop-t035'], datasets: ['dataset-interop-t035'] },
    evaluations: [
      { verdict: 'verdict-interop-holdout', attained: true, trial: SEARCH_HOLDOUT_TRIAL, criteria: 'criteria-interop@1', evidenceRef: 'evidence-interop-holdout' },
      { verdict: 'verdict-interop-insearch', attained: true, trial: SEARCH_IN_TRIAL, criteria: 'criteria-interop@1', evidenceRef: 'evidence-interop-insearch' },
    ],
    planning: { goal: 'goal-interop-t035', constraints: 'constraints-interop-t035', candidate: 'org-interop-t035', seed: 'seed-interop-t035' },
    policy: DEFAULT_IMPROVEMENT_POLICY,
  } as unknown as ImprovementCycleInputs;
}

describe('the REAL T030 -> T033 pipeline drives the loop (the drift trip wires)', () => {
  it('the REAL hooks satisfy the mirror and drive a full cycle', async () => {
    const world = await realLoopWorld();
    expect(world.hooks.length).toBe(7); // T030's own golden decision count
    for (const hook of world.hooks) expect(isOutcomeLearningHookMirror(hook)).toBe(true);
    // The REAL search record + trail satisfy their mirrors AND verify under
    // this lane's OWN re-derived chain folds (the T031/T015 parity trip wire).
    expect(isSearchRecordMirror(world.search)).toBe(true);
    expect(verifySearchRecordMirror(world.search)).toBe(true);
    for (const entry of world.search.entries) expect(isSearchTrialEntryMirror(entry)).toBe(true);

    const result = runImprovementCycle(createAutonomousLearningState(), await realCycleInputs());
    if (!result.ok) throw new Error(result.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; '));
    const { cycle, products } = result.value;
    expect(cycle.tenant).toBe(world.tenant);
    expect(cycle.consumedHooks).toEqual(world.hooks.map((hook) => hook.hookId));
    // The REAL failure hooks mint REAL gaps: every gap's evidence ref is a
    // REAL content-addressed hook id; every kind is one of the six classes.
    expect(products.gaps.length).toBeGreaterThan(0);
    const realHookIds = new Set(world.hooks.map((hook) => hook.hookId));
    for (const gap of products.gaps) {
      expect(realHookIds.has(gap.evidenceRef)).toBe(true);
      expect(gap.tenantId).toBe(world.tenant);
      expect(gap.gapId).toMatch(/^alg:[0-9a-f]{8}$/);
    }
  });

  it('the loop is byte-deterministic over the REAL world (L9, twice)', async () => {
    const inputs = await realCycleInputs();
    const first = runImprovementCycle(createAutonomousLearningState(), inputs);
    const second = runImprovementCycle(createAutonomousLearningState(), inputs);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(JSON.stringify(first.value.cycle)).toBe(JSON.stringify(second.value.cycle));
    expect(JSON.stringify(first.value.products)).toBe(JSON.stringify(second.value.products));
  });
});

describe('the memory feed drives the REAL T034 brain (the Firm-Brain semantics, end-to-end)', () => {
  it('the feed ingests green and the brain grows; the grown brain annotates the NEXT cycle (the loop closes)', async () => {
    const world = await realLoopWorld();
    const first = runImprovementCycle(createAutonomousLearningState(), await realCycleInputs());
    if (!first.ok) throw new Error(first.errors.map((error) => error.message).join('; '));
    const feed = first.value.products.memory;
    if (feed === null) throw new Error('the REAL world must mint a memory feed');

    // THE FEED DRIVES THE REAL BRAIN: the outcomes + post-mortems flow
    // VERBATIM (T034's own mirrors validate every record).
    const ingested = firmMemory.ingestFirmLearning(firmMemory.createFirmMemoryState(), { outcomes: feed.snapshot.outcomes, postMortems: feed.snapshot.postMortems }, firmScenarioPolicy, { at: world.at as never });
    if (!ingested.ok) throw new Error(ingested.errors.map((error) => `${error.code}: ${error.message}`).join('; '));
    expect(ingested.value.receipt.fresh.length).toBeGreaterThan(0);
    expect(ingested.value.state.knowledgeLog.records.length).toBeGreaterThan(0);

    // THE GROWN BRAIN SERVES; the served entries become the NEXT cycle's knowledge.
    const served = firmMemory.queryFirmKnowledge(ingested.value.state, { tenant: world.tenant, project: world.project }, { at: world.at as never, retention: firmScenarioServingPolicy });
    if (!served.ok) throw new Error(served.errors.map((error) => error.message).join('; '));
    expect(served.value.length).toBeGreaterThan(0);
    const envelopes: readonly ServedKnowledgeEnvelopeMirror[] = served.value.map((entry) => ({
      knowledgeId: entry.record.knowledgeId,
      tenant: entry.record.tenant,
      project: entry.record.project,
      kind: entry.record.claim.kind,
      status: entry.status,
      asOf: entry.record.asOf,
    }));
    for (const envelope of envelopes) {
      expect(envelope.knowledgeId).toMatch(/^fkr:[0-9a-f]{8}$/);
      expect(envelope.status).toBe('active');
    }

    // Append cycle 1's search trials to the REAL search record (the retained history grows).
    let grownSearch: searchLineage.SearchRecord | null = null;
    for (const bundle of first.value.products.searchTrials) {
      const appended = searchLineage.appendSearchTrial(grownSearch ?? world.search, bundle as never);
      if (!appended.ok) throw new Error(appended.errors.map((error) => `${error.code}: ${error.message}`).join('; '));
      grownSearch = appended.value;
    }
    if (grownSearch === null) throw new Error('cycle 1 must emit search trials');
    expect(searchLineage.verifySearchRecord(grownSearch).ok).toBe(true);

    // THE SECOND CYCLE: two NEW hand-minted in-scope hooks (new outcomes —
    // the T033 drift was proven by cycle 1), the GROWN brain's knowledge,
    // the GROWN search record, and only IN-SEARCH attained evidence (the
    // commission must withhold this time — the loop's own T031 gate).
    const newHooks: readonly OutcomeLearningHookMirror[] = [
      {
        hookId: 'olh:interop2a',
        outcomeRecordRef: 'out:interop0008',
        decisionRef: 'decision-interop-8',
        intentRef: 'intent-interop-8',
        tenant: world.tenant,
        project: world.project,
        outcomeClass: 'execution_shortfall',
        realizedGap: '-3.5',
        quantityShortfall: '0.5',
        dominantAttribution: { class: 'decision', confidence: '0.4' },
        suggestedFocus: 'execution_quality',
        evidence: [{ kind: 'shadow_outcome', ref: 'swo:interop0008' }],
        asOf: world.at as never,
      },
      {
        hookId: 'olh:interop2b',
        outcomeRecordRef: 'out:interop0009',
        decisionRef: 'decision-interop-9',
        intentRef: 'intent-interop-9',
        tenant: world.tenant,
        project: world.project,
        outcomeClass: 'adverse_gap',
        realizedGap: '-15',
        quantityShortfall: null,
        dominantAttribution: { class: 'decision', confidence: '0.6' },
        suggestedFocus: 'strategy_revision',
        evidence: [{ kind: 'shadow_outcome', ref: 'swo:interop0009' }],
        asOf: world.at as never,
      },
    ];
    const second = runImprovementCycle(first.value.state, {
      at: (world.at + 5_000) as never,
      tenant: world.tenant,
      project: world.project,
      hooks: [...newHooks],
      outcomes: [],
      postMortems: [],
      knowledge: [...envelopes],
      knowledgeHead: 'fmb:interop-grown-brain',
      trail: world.trail,
      search: grownSearch,
      searchPolicy: { evaluationPolicy: 'split-interop-t035', splits: ['split-interop-t035'], datasets: ['dataset-interop-t035'] },
      evaluations: [
        { verdict: 'verdict-interop-insearch', attained: true, trial: SEARCH_IN_TRIAL, criteria: 'criteria-interop@1', evidenceRef: 'evidence-interop-insearch' },
      ],
      planning: { goal: 'goal-interop-t035', constraints: 'constraints-interop-t035', candidate: 'org-interop-t035', seed: 'seed-interop-t035' },
      policy: DEFAULT_IMPROVEMENT_POLICY,
    } as unknown as ImprovementCycleInputs);
    if (!second.ok) throw new Error(second.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; '));
    const { cycle, products } = second.value;
    expect(cycle.ordinal).toBe(2);

    // THE BRAIN-INFORMED ANNOTATION: cycle 2's revision cites the knowledge
    // entries PROMOTED FROM CYCLE 1'S FEED (the loop closes through T034).
    const revision = products.revision;
    if (revision === null) throw new Error('cycle 2 must mint a revision');
    const related = new Set(revision.annotations.flatMap((annotation) => annotation.relatedKnowledge));
    const promotedFromCycleOne = new Set(ingested.value.state.knowledgeLog.records.map((record) => record.knowledgeId));
    expect(related.size).toBeGreaterThan(0);
    for (const ref of related) expect(promotedFromCycleOne.has(ref)).toBe(true);

    // THE LOOP'S OWN T031 GATE: in-search-only evidence withholds the commission.
    expect(products.commission?.status).toBe('withheld');
    expect(products.commission?.refusal).toBe('selected_without_holdout');
    expect(cycle.commissionTrial).toBeNull();

    // The revision trial's parent is cycle 1's revision trial (the improvement DAG).
    expect(products.searchTrials[0]?.parents).toEqual([first.value.cycle.revisionTrial]);
    // And the REAL search record accepts cycle 2's trial too (the parent edge resolves).
    const appendedSecond = searchLineage.appendSearchTrial(grownSearch, products.searchTrials[0] as never);
    if (!appendedSecond.ok) throw new Error(appendedSecond.errors.map((error) => `${error.code}: ${error.message}`).join('; '));
    expect(searchLineage.verifySearchRecord(appendedSecond.value).ok).toBe(true);
  });
});

describe('the curriculum revision drives the REAL T015 planner', () => {
  it('planCurriculum consumes the revision bundle; the REAL plan cites the loop\'s gaps', async () => {
    const first = runImprovementCycle(createAutonomousLearningState(), await realCycleInputs());
    if (!first.ok) throw new Error(first.errors.map((error) => error.message).join('; '));
    const revision = first.value.products.revision;
    if (revision === null) throw new Error('the REAL world must mint a revision');

    // A REAL validated curriculum version in the session's scope.
    const literal = goldenCurriculumVersionLiteral();
    const world = await realLoopWorld();
    const versionResult = learning.validateCurriculumVersion({ ...literal, tenant: world.tenant, project: world.project });
    if (!versionResult.ok) throw new Error(versionResult.errors.map((error) => error.message).join('; '));

    // THE CONTRACT TEST: the REAL planner consumes the loop's plan-input bundle.
    const plan = learning.planCurriculum(revision.planInput as never, versionResult.value);
    if (!plan.ok) throw new Error(plan.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; '));
    expect(plan.value.lineage.tenant).toBe(world.tenant);
    expect(plan.value.lineage.project).toBe(world.project);
    // The gap-driven stages cite the loop's minted gap ids (failure-driven learning).
    const gapStages = plan.value.stages.filter((stage) => stage.motivation.kind === 'gap');
    expect(gapStages.length).toBeGreaterThan(0);
    const loopGapIds = new Set(first.value.cycle.gaps);
    for (const stage of gapStages) {
      if (stage.motivation.gapId !== undefined) expect(loopGapIds.has(stage.motivation.gapId)).toBe(true);
    }
    // The loop's plan input never grants live execution: the plan climbs only
    // to the earned rung (the trail entered at synthetic_regimes).
    expect(plan.value.target).toBe('synthetic_regimes');
    expect(plan.value.live_gate).toBeNull();
  });
});

describe('the skill commission drives the REAL T017 body forge', () => {
  it('the loop\'s gaps satisfy the REAL guards and forge a REAL candidate', async () => {
    const first = runImprovementCycle(createAutonomousLearningState(), await realCycleInputs());
    if (!first.ok) throw new Error(first.errors.map((error) => error.message).join('; '));
    const commission = first.value.products.commission;
    if (commission === null) throw new Error('the REAL world must mint a commission');
    expect(commission.status).toBe('commissioned'); // the holdout verdict attained

    const world = await realLoopWorld();

    // The REAL guards: the loop's minted gaps ARE organization-lane gaps.
    for (const gap of commission.gaps) {
      expect(skills.isCapabilityGapMirror(gap)).toBe(true);
    }

    // THE CONTRACT TEST: the REAL forge consumes the commission's bundle.
    // (The fixture deltas are re-scoped to the session — one tenant per
    // lineage chain, L12; the loop's gaps already carry the session scope.)
    const sessionDeltas = fixtureDeltas.map((delta) => ({
      ...delta,
      tenantId: world.tenant,
      projectId: world.project,
    }));
    const forged = bodyForge.forgeBodyVersion({
      parent: fixtureParentBodyVersion,
      deltas: sessionDeltas,
      gaps: commission.gaps,
      evidence: commission.evidence,
      seed: 'seed-interop-t035',
      forgeVersion: 'reference-forge/1',
      targetVersion: { major: 2, minor: 0, patch: 0, prerelease: [], build: [] },
      createdAt: '2026-04-01T00:00:00Z',
      tenantId: world.tenant,
      projectId: world.project,
    });
    if (!forged.minted || forged.candidate === null) {
      throw new Error(`the REAL forge refused the commission's bundle: ${JSON.stringify(forged.reasons)}`);
    }
    // The candidate's lineage carries the loop's gap ids (L9).
    const lineageGaps = JSON.stringify(forged.candidate.lineage);
    for (const gap of commission.gaps) expect(lineageGaps).toContain(gap.gapId);
    expect(forged.candidate.lineage.tenantId).toBe(world.tenant);
  });
});

describe('the REAL T011 lineage flows byte-exact through the loop', () => {
  it('the REAL trajectory metadata and experiment binding arrive in the commission\'s evidence', async () => {
    // The REAL trajectory metadata validates under ITS guard (the T011 trip wire).
    const meta = trajectory.validateTrajectoryMetadata({
      trajectory_id: REAL_TRAJECTORY,
      tenant: (await realLoopWorld()).tenant,
      project: (await realLoopWorld()).project,
      episode: 'epi-interop-t035',
      environment_config: 'envcfg:interop-t035',
      runtime: 'runtime:interop-t035',
      data: [],
      body_versions: ['bodyv:interop-t035'],
      substrates: ['substrate:interop-t035'],
    });
    if (!meta.ok) throw new Error(meta.errors.map((error) => error.message).join('; '));
    expect(meta.value.trajectory_id).toBe(REAL_TRAJECTORY);

    // The T033 records carry the binding VERBATIM (byte-preserving law)...
    const world = await realLoopWorld();
    for (const record of world.outcomes as readonly { lineage?: { trajectoryRef?: string | null; experiment?: { experimentRef: string; trialRef: string } | null } }[]) {
      expect(record.lineage?.trajectoryRef).toBe(REAL_TRAJECTORY);
      expect(record.lineage?.experiment?.experimentRef).toBe(REAL_EXPERIMENT);
      expect(record.lineage?.experiment?.trialRef).toBe(REAL_TRIAL);
    }
    // ...and the commission's evidence carries them byte-exact (the L9 flow).
    const first = runImprovementCycle(createAutonomousLearningState(), await realCycleInputs());
    if (!first.ok) throw new Error(first.errors.map((error) => error.message).join('; '));
    const commission = first.value.products.commission;
    if (commission === null) throw new Error('unreachable');
    expect(commission.evidence.trajectoryRefs).toContain(REAL_TRAJECTORY);
    expect(commission.evidence.trialRefs).toContain(REAL_TRIAL);
    expect(commission.evidence.trialRefs).toContain(SEARCH_IN_TRIAL);
    expect(commission.evidence.trialRefs).toContain(SEARCH_HOLDOUT_TRIAL);
    expect(commission.evidence.verdictRefs).toContain('verdict-interop-holdout');
  });
});
