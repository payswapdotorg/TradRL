/**
 * @tradrl/autonomous-learning (service) — the deterministic scenario
 * fixtures (Work Order T035): hand-minted, in-scope records shaped exactly
 * like the owning lanes' outputs (the firm-memory/outcome-learning
 * fixtures' own precedent — the REAL pipelines drive the interop test;
 * these drive the behavioral suites).
 *
 * The scenario: a tenant's first improvement cycle over a shadow-trading
 * world that produced four learned outcomes — an execution shortfall, an
 * adverse decision gap, an adverse data-lag gap and an as-expected
 * outcome — whose post-mortems attribute the adverse gaps to the decision
 * and the data lag. The Firm Brain already serves one active
 * decision-pattern entry. The search record retains one in-search trial
 * and one holdout trial; the evaluated evidence cites both (the holdout
 * verdict attained — the commission releases).
 */

import { canonicalJson, deepFreeze, fnv1a32Hex, type TimestampMs } from './primitives';
import type {
  CapabilityGapMirror,
  CurriculumTrailMirror,
  TransitionLineageMirror,
  EvaluatedEvidenceMirror,
  OutcomeLearningHookMirror,
  SearchRecordMirror,
  SearchTrialEntryMirror,
  ServedKnowledgeEnvelopeMirror,
} from './mirrors';
import {
  searchChainFoldMirror,
  searchChainGenesisMirror,
  trailChainSeedMirror,
  trailChainStepMirror,
} from './mirrors';
import type { SearchPolicyBlock } from './integrity';
import { ImprovementPolicy } from './policy';
import { ImprovementCycleInputs, PlanningContext } from './cycle';

// ---------------------------------------------------------------------------
// The scenario constants
// ---------------------------------------------------------------------------

export const AUTO_T0 = 1_700_500_000_000 as TimestampMs;
export const AUTO_T1 = 1_700_500_001_000 as TimestampMs; // hooks' asOf
export const AUTO_T2 = 1_700_500_002_000 as TimestampMs; // the cycle instant
export const AUTO_TENANT = 'tenant-auto';
export const AUTO_PROJECT = 'prj-auto';
export const AUTO_TENANT_B = 'tenant-auto-b';
export const AUTO_PROJECT_B = 'prj-auto-b';
export const AUTO_GOAL = 'goal-auto';
export const AUTO_CONSTRAINTS = 'constraints-auto';
export const AUTO_CANDIDATE = 'org-auto-candidate';
export const AUTO_SEED = 'seed-auto-improvement';
export const AUTO_CURRICULUM_VERSION = 'curriculum@1.0.0';
export const AUTO_SESSION = 'shs:auto-1';
export const AUTO_EXPERIMENT = 'experiment-auto-1';
export const AUTO_EVALUATOR = 'evaluator-auto@1';
export const AUTO_SPLIT = 'split-walk-forward-auto';
export const AUTO_DATASET = 'dataset-auto-1';
export const AUTO_KNOWLEDGE_HEAD = 'fmb:auto-brain-head-1';
export const AUTO_TRAJECTORY = 'trajectory-auto-1';
export const AUTO_IN_SEARCH_TRIAL = 'trial-auto-insearch';
export const AUTO_HOLDOUT_TRIAL = 'trial-auto-holdout';

// ---------------------------------------------------------------------------
// The hooks (T033-shaped, content-addressed the owner's way)
// ---------------------------------------------------------------------------

/** The hook content tree (everything except the content-addressed id). */
function hookContent(hook: Omit<OutcomeLearningHookMirror, 'hookId'>): Record<string, unknown> {
  return {
    outcomeRecordRef: hook.outcomeRecordRef,
    decisionRef: hook.decisionRef,
    intentRef: hook.intentRef,
    tenant: hook.tenant,
    project: hook.project,
    outcomeClass: hook.outcomeClass,
    realizedGap: hook.realizedGap,
    quantityShortfall: hook.quantityShortfall,
    dominantAttribution: hook.dominantAttribution === null ? null : { class: hook.dominantAttribution.class, confidence: hook.dominantAttribution.confidence },
    suggestedFocus: hook.suggestedFocus,
    evidence: [...hook.evidence],
    asOf: hook.asOf,
  };
}

/** Mint one fixture hook (content-addressed: `olh:` + FNV-1a over the canonical content). */
function mintHook(hook: Omit<OutcomeLearningHookMirror, 'hookId'>): OutcomeLearningHookMirror {
  return deepFreeze({ ...hook, hookId: `olh:${fnv1a32Hex(canonicalJson(hookContent(hook) as never))}` } as OutcomeLearningHookMirror);
}

/** The plain-literal shape of one hook (the fixtures' unbranded authoring form). */
type HookLiteral = {
  readonly outcomeRecordRef: string;
  readonly decisionRef: string;
  readonly intentRef: string;
  readonly tenant: string;
  readonly project: string;
  readonly outcomeClass: OutcomeLearningHookMirror['outcomeClass'];
  readonly realizedGap: string | null;
  readonly quantityShortfall: string | null;
  readonly dominantAttribution: { readonly class: 'decision' | 'market_move' | 'model_error' | 'data_lag'; readonly confidence: string } | null;
  readonly suggestedFocus: OutcomeLearningHookMirror['suggestedFocus'];
  readonly evidence: readonly { readonly kind: string; readonly ref: string }[];
  readonly asOf: TimestampMs;
};

/** Mint one fixture hook from an unbranded literal (the brand is compile-time only — the runtime guards own the truth). */
function hookOf(literal: HookLiteral): OutcomeLearningHookMirror {
  return mintHook(literal as Omit<OutcomeLearningHookMirror, 'hookId'>);
}

/** The scenario's four hooks: the execution shortfall, the adverse decision gap, the adverse data-lag gap, the as-expected outcome. */
export function scenarioHooks(): readonly OutcomeLearningHookMirror[] {
  return deepFreeze([
    hookOf({
      outcomeRecordRef: 'out:auto0001',
      decisionRef: 'decision-auto-1',
      intentRef: 'intent-auto-1',
      tenant: AUTO_TENANT,
      project: AUTO_PROJECT,
      outcomeClass: 'execution_shortfall',
      realizedGap: '-12.5',
      quantityShortfall: '0.25',
      dominantAttribution: { class: 'decision', confidence: '0.4' },
      suggestedFocus: 'execution_quality',
      evidence: [{ kind: 'shadow_outcome', ref: 'swo:auto0001' }],
      asOf: AUTO_T1,
    }),
    hookOf({
      outcomeRecordRef: 'out:auto0002',
      decisionRef: 'decision-auto-2',
      intentRef: 'intent-auto-2',
      tenant: AUTO_TENANT,
      project: AUTO_PROJECT,
      outcomeClass: 'adverse_gap',
      realizedGap: '-40',
      quantityShortfall: null,
      dominantAttribution: { class: 'decision', confidence: '0.5' },
      suggestedFocus: 'strategy_revision',
      evidence: [{ kind: 'shadow_outcome', ref: 'swo:auto0002' }],
      asOf: AUTO_T1,
    }),
    hookOf({
      outcomeRecordRef: 'out:auto0003',
      decisionRef: 'decision-auto-3',
      intentRef: 'intent-auto-3',
      tenant: AUTO_TENANT,
      project: AUTO_PROJECT,
      outcomeClass: 'adverse_gap',
      realizedGap: '-7.5',
      quantityShortfall: null,
      dominantAttribution: { class: 'data_lag', confidence: '0.3' },
      suggestedFocus: 'data_pipeline',
      evidence: [{ kind: 'shadow_outcome', ref: 'swo:auto0003' }],
      asOf: AUTO_T1,
    }),
    hookOf({
      outcomeRecordRef: 'out:auto0004',
      decisionRef: 'decision-auto-4',
      intentRef: 'intent-auto-4',
      tenant: AUTO_TENANT,
      project: AUTO_PROJECT,
      outcomeClass: 'as_expected',
      realizedGap: '0',
      quantityShortfall: null,
      dominantAttribution: null,
      suggestedFocus: 'none',
      evidence: [{ kind: 'shadow_outcome', ref: 'swo:auto0004' }],
      asOf: AUTO_T1,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// The outcome + post-mortem records (envelope-complete; T034 owns the rest)
// ---------------------------------------------------------------------------

/** One envelope-complete outcome record (the fields the memory feed's envelope reads). */
export interface OutcomeRecordFixture {
  readonly outcomeId: string;
  readonly ordinal: number;
  readonly tenant: string;
  readonly project: string;
  readonly outcomeClass: string;
  readonly lineage: {
    readonly shadow: { readonly sessionId: string };
    readonly trajectoryRef: string | null;
    readonly experiment: { readonly experimentRef: string; readonly trialRef: string } | null;
  };
  readonly asOf: TimestampMs;
}

/** The scenario's four outcome records (one per hook's subject). */
export function scenarioOutcomes(): readonly OutcomeRecordFixture[] {
  return deepFreeze([
    { outcomeId: 'out:auto0001', ordinal: 1, tenant: AUTO_TENANT, project: AUTO_PROJECT, outcomeClass: 'execution_shortfall', lineage: { shadow: { sessionId: AUTO_SESSION }, trajectoryRef: AUTO_TRAJECTORY, experiment: null }, asOf: AUTO_T1 },
    { outcomeId: 'out:auto0002', ordinal: 2, tenant: AUTO_TENANT, project: AUTO_PROJECT, outcomeClass: 'adverse_gap', lineage: { shadow: { sessionId: AUTO_SESSION }, trajectoryRef: AUTO_TRAJECTORY, experiment: null }, asOf: AUTO_T1 },
    { outcomeId: 'out:auto0003', ordinal: 3, tenant: AUTO_TENANT, project: AUTO_PROJECT, outcomeClass: 'adverse_gap', lineage: { shadow: { sessionId: AUTO_SESSION }, trajectoryRef: null, experiment: null }, asOf: AUTO_T1 },
    { outcomeId: 'out:auto0004', ordinal: 4, tenant: AUTO_TENANT, project: AUTO_PROJECT, outcomeClass: 'as_expected', lineage: { shadow: { sessionId: AUTO_SESSION }, trajectoryRef: null, experiment: null }, asOf: AUTO_T1 },
  ]);
}

/** One envelope-complete post-mortem record. */
export interface PostMortemRecordFixture {
  readonly postMortemId: string;
  readonly ordinal: number;
  readonly lineage: { readonly tenant: string; readonly project: string; readonly shadowSessionRef: string };
  readonly asOf: TimestampMs;
}

/** The scenario's three post-mortem drafts (the two adverse gaps + the shortfall). */
export function scenarioPostMortems(): readonly PostMortemRecordFixture[] {
  return deepFreeze([
    { postMortemId: 'pmr:auto0001', ordinal: 1, lineage: { tenant: AUTO_TENANT, project: AUTO_PROJECT, shadowSessionRef: AUTO_SESSION }, asOf: AUTO_T1 },
    { postMortemId: 'pmr:auto0002', ordinal: 2, lineage: { tenant: AUTO_TENANT, project: AUTO_PROJECT, shadowSessionRef: AUTO_SESSION }, asOf: AUTO_T1 },
    { postMortemId: 'pmr:auto0003', ordinal: 3, lineage: { tenant: AUTO_TENANT, project: AUTO_PROJECT, shadowSessionRef: AUTO_SESSION }, asOf: AUTO_T1 },
  ]);
}

// ---------------------------------------------------------------------------
// The served knowledge (T034-shaped envelopes)
// ---------------------------------------------------------------------------

/** The scenario's served knowledge: one active decision-pattern entry + one decayed market-behavior entry. */
export function scenarioKnowledge(): readonly ServedKnowledgeEnvelopeMirror[] {
  return deepFreeze([
    { knowledgeId: 'fkr:auto0001', tenant: AUTO_TENANT, project: AUTO_PROJECT, kind: 'decision_pattern', status: 'active', asOf: AUTO_T0 },
    { knowledgeId: 'fkr:auto0002', tenant: AUTO_TENANT, project: AUTO_PROJECT, kind: 'market_behavior', status: 'decayed', asOf: AUTO_T0 },
  ] as unknown as readonly ServedKnowledgeEnvelopeMirror[]);
}

// ---------------------------------------------------------------------------
// The curriculum trail (T015-shaped, chain-folded the owner's way)
// ---------------------------------------------------------------------------

/** The scenario's trail: entered at the bottom rung (the mirrored fold's chain). */
export function scenarioTrail(): CurriculumTrailMirror {
  const lineage = deepFreeze({ goal: AUTO_GOAL, curriculum_version: AUTO_CURRICULUM_VERSION, tenant: AUTO_TENANT, project: AUTO_PROJECT } as unknown as TransitionLineageMirror);
  const entry = deepFreeze({
    kind: 'entry',
    from: null,
    to: 'synthetic_regimes',
    evidence: null,
    reason: 'ladder_entry',
    recordedAt: AUTO_T0,
    lineage,
    live_permission: null,
  } as unknown as Parameters<typeof trailChainStepMirror>[1]);
  const seed = trailChainSeedMirror(lineage);
  return deepFreeze({ lineage, records: [entry], record_chain: [trailChainStepMirror(seed, entry)] } as unknown as CurriculumTrailMirror);
}

// ---------------------------------------------------------------------------
// The search record (T031-shaped, chain-folded the owner's way)
// ---------------------------------------------------------------------------

/** One search-trial entry fixture (the in-search optimization trial). */
function inSearchEntry(): SearchTrialEntryMirror {
  return deepFreeze({
    trial: AUTO_IN_SEARCH_TRIAL,
    arm: 'arm-auto-alpha',
    classification: 'in-search',
    config: 'snap:auto0001',
    parents: [],
    splits: [AUTO_SPLIT],
    datasets: [AUTO_DATASET],
    window: { start: AUTO_T0, end: AUTO_T1 },
    evaluation_policy: AUTO_SPLIT,
    recorded_at: AUTO_T1,
    tenant: AUTO_TENANT,
    project: AUTO_PROJECT,
  } as unknown as SearchTrialEntryMirror);
}

/** One search-trial entry fixture (the holdout leaf check). */
function holdoutEntry(): SearchTrialEntryMirror {
  return deepFreeze({
    trial: AUTO_HOLDOUT_TRIAL,
    arm: null,
    classification: 'holdout',
    config: 'snap:auto0002',
    parents: [],
    splits: [AUTO_SPLIT],
    datasets: [AUTO_DATASET],
    window: null,
    evaluation_policy: AUTO_SPLIT,
    recorded_at: AUTO_T1,
    tenant: AUTO_TENANT,
    project: AUTO_PROJECT,
  } as unknown as SearchTrialEntryMirror);
}

/** The scenario's search record: the binding + the two trials, chain-folded the owner's way. */
export function scenarioSearchRecord(): SearchRecordMirror {
  const record = deepFreeze({
    search_id: 'srch:auto0001',
    experiment: AUTO_EXPERIMENT,
    evaluator: AUTO_EVALUATOR,
    tenant: AUTO_TENANT,
    project: AUTO_PROJECT,
    entries: [] as readonly SearchTrialEntryMirror[],
    chain_head: '',
  } as unknown as SearchRecordMirror);
  let head = searchChainGenesisMirror(record);
  const entries: SearchTrialEntryMirror[] = [];
  for (const entry of [inSearchEntry(), holdoutEntry()]) {
    head = searchChainFoldMirror(head, entry);
    entries.push(entry);
  }
  return deepFreeze({ ...record, entries, chain_head: head } as unknown as SearchRecordMirror);
}

// ---------------------------------------------------------------------------
// The evaluated evidence (T012 verdict essentials + the T031 trial binding)
// ---------------------------------------------------------------------------

/** The scenario's evaluated evidence: an attained holdout verdict + an attained in-search verdict. */
export function scenarioEvaluations(): readonly EvaluatedEvidenceMirror[] {
  return deepFreeze([
    { verdict: 'verdict-auto-holdout', attained: true, trial: AUTO_HOLDOUT_TRIAL, criteria: 'criteria-auto@1', evidenceRef: 'evidence-auto-holdout' },
    { verdict: 'verdict-auto-insearch', attained: true, trial: AUTO_IN_SEARCH_TRIAL, criteria: 'criteria-auto@1', evidenceRef: 'evidence-auto-insearch' },
  ] as unknown as readonly EvaluatedEvidenceMirror[]);
}

// ---------------------------------------------------------------------------
// The cycle inputs
// ---------------------------------------------------------------------------

/** The scenario's planning context. */
export function scenarioPlanning(): PlanningContext {
  return deepFreeze({ goal: AUTO_GOAL, constraints: AUTO_CONSTRAINTS, candidate: AUTO_CANDIDATE, seed: AUTO_SEED } as unknown as PlanningContext);
}

/** The scenario's search policy block. */
export function scenarioSearchPolicy(): SearchPolicyBlock {
  return deepFreeze({ evaluationPolicy: AUTO_SPLIT, splits: [AUTO_SPLIT], datasets: [AUTO_DATASET] } as unknown as SearchPolicyBlock);
}

/**
 * The scenario's whole cycle inputs (the first cycle): four hooks, four
 * outcome records, three post-mortems, the brain's two served entries,
 * the entered trail, the two-trial search record, the two evaluated
 * verdicts, the planning context and the DEFAULT policy.
 */
export function scenarioCycleInputs(): ImprovementCycleInputs {
  return deepFreeze({
    at: AUTO_T2,
    tenant: AUTO_TENANT,
    project: AUTO_PROJECT,
    hooks: [...scenarioHooks()],
    outcomes: [...scenarioOutcomes()],
    postMortems: [...scenarioPostMortems()],
    knowledge: [...scenarioKnowledge()],
    knowledgeHead: AUTO_KNOWLEDGE_HEAD,
    trail: scenarioTrail(),
    search: scenarioSearchRecord(),
    searchPolicy: scenarioSearchPolicy(),
    evaluations: [...scenarioEvaluations()],
    planning: scenarioPlanning(),
    policy: scenarioPolicy(),
  } as unknown as ImprovementCycleInputs);
}

/** The scenario's improvement policy: the DEFAULT table (the declared interpretation). */
export function scenarioPolicy(): ImprovementPolicy {
  return deepFreeze({
    version: 'improvement@1.0.0',
    focusTable: {
      strategy_revision: { gapKind: 'regime', knowledgeKind: 'decision_pattern', commission: true },
      model_recalibration: { gapKind: 'regime', knowledgeKind: 'model_calibration', commission: true },
      data_pipeline: { gapKind: null, knowledgeKind: 'data_latency', commission: false },
      risk_policy: { gapKind: 'risk', knowledgeKind: 'decision_pattern', commission: true },
      execution_quality: { gapKind: 'execution', knowledgeKind: 'decision_pattern', commission: true },
      none: { gapKind: null, knowledgeKind: null, commission: false },
    },
    requiresHoldout: true,
  } as unknown as ImprovementPolicy);
}

/** The expected minted gaps of the scenario (the execution + regime gaps, in hook order). */
export function scenarioExpectedGapKinds(): readonly CapabilityGapMirror['kind'][] {
  return ['execution', 'regime'];
}
