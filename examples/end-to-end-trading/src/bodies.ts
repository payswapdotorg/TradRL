// @tradrl/example-e2e-trading — STAGE 3: THE SIX BODY VERSIONS + POSSESSIONS.
//
// The bodies the organization compiled: four research bodies (T021/T022/
// T023), the Trading Director (T024) and the Execution body (T025), as
// BodyVersion mirrors of the REAL bodies' declared compositions (mission,
// capabilities, knowledge/tool policy, procedures, planning, delegation,
// authority boundary, evaluation, substrate compatibility), each bound
// to a substrate through a Possession (T003) — the "bodies with
// possessions wired into the reactive world" stage. L8/L16 wired into
// the declarations: the director prohibits EXECUTE and order-level
// control; the execution body prohibits strategic control and venue-direct
// placement; the gateway is the ONLY path to the venue.

import { deepFreeze } from './primitives';
import type {
  BodyCompositionMirror, BodyVersionMirror, PossessionMirror,
} from './mirrors/agent';
import type { TradingScenario } from './scenario';
import { REFERENCE_TOPICS } from './organization';

function bodyOf(
  bodyId: string,
  version: '1.0.0',
  composition: BodyCompositionMirror,
  createdAtIso: string,
): BodyVersionMirror {
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10)) as [number, number, number];
  return deepFreeze({
    id: `${bodyId}@${version}`,
    bodyId,
    version: { major, minor, patch },
    parentId: null,
    composition,
    createdAt: createdAtIso,
    certified: false,
    certificationEvidence: null,
  });
}

/** Builds the six reference body versions (all fields declared, frozen). */
export function referenceBodies(scenario: TradingScenario): readonly BodyVersionMirror[] {
  const createdAt = new Date(scenario.epochMs).toISOString();
  const goalRef = scenario.goal.id;
  const tenant = scenario.tenant;

  const researchMission = (lane: string, topic: string): BodyCompositionMirror['mission'] => ({
    summary: `${lane} research: consume point-in-time observations from the reactive market world and publish a research report on the ${topic} topic`,
    goalRefs: [goalRef],
    standingDirectives: ['point-in-time only (L4)', 'publish evidence-cited records only'],
  });

  const sentiment: BodyVersionMirror = bodyOf('sentiment-researcher', '1.0.0', {
    mission: researchMission('sentiment', REFERENCE_TOPICS.sentiment),
    capabilities: [
      { id: 'sentiment-intake', name: 'Sentiment intake', description: 'Admit news/social observations under the availability gate', category: 'research', skillArtifactRefs: [], critical: true },
      { id: 'polarity-assessment', name: 'Polarity assessment', description: 'Score polarity/intensity with declared thresholds', category: 'research', skillArtifactRefs: [], critical: true },
      { id: 'report-composition', name: 'Report composition', description: 'Compose the sentiment report with summary + coverage', category: 'research', skillArtifactRefs: [], critical: true },
    ],
    knowledgeToolPolicy: {
      allowedTools: ['observation-source'], forbiddenTools: ['execution-adapter', 'venue-api'],
      toolCallBudgetPerDecision: 64,
      allowedKnowledgeSources: ['market-world'], forbiddenKnowledgeSources: ['future'],
    },
    procedures: [
      { id: 'p-sentiment-1', name: 'research-cycle', trigger: 'cadence', steps: [
        { id: 's-1', description: 'Pull observations available at the decision instant', toolRefs: ['observation-source'], approvalRequired: false },
        { id: 's-2', description: 'Score polarity per instrument; compose and publish the report', toolRefs: [], approvalRequired: false },
      ] },
    ],
    planningPolicy: { style: 'reactive', horizon: 'one decision' },
    delegationPolicy: { mayDelegate: false, scope: 'none' },
    authorityBoundary: {
      allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REPORT'],
      prohibitedActions: ['EXECUTE', 'APPROVE', 'ESCALATE', 'DELEGATE'],
      approvalRequiredActions: [],
      executionAuthority: 'none',
      riskPolicyRef: null,
    },
    evaluationEnvironment: { requiredLayers: ['functional-correctness', 'data-integrity'] },
    substrateCompatibility: { requirements: ['deterministic-text'], constraints: [], testedSubstrates: ['substrate/reference@1'] },
  }, createdAt);

  const regime: BodyVersionMirror = bodyOf('regime-researcher', '1.0.0', {
    mission: researchMission('regime', REFERENCE_TOPICS.regime),
    capabilities: [
      { id: 'window-statistics', name: 'Window statistics', description: 'Net-move ratios over the observation window', category: 'research', skillArtifactRefs: [], critical: true },
      { id: 'regime-classification', name: 'Regime classification', description: 'Classify windows under the declared taxonomy', category: 'research', skillArtifactRefs: [], critical: true },
    ],
    knowledgeToolPolicy: {
      allowedTools: ['observation-source'], forbiddenTools: ['execution-adapter', 'venue-api'],
      toolCallBudgetPerDecision: 64, allowedKnowledgeSources: ['market-world'], forbiddenKnowledgeSources: ['future'],
    },
    procedures: [
      { id: 'p-regime-1', name: 'research-cycle', trigger: 'cadence', steps: [
        { id: 's-1', description: 'Compute window statistics; classify; publish the regime report', toolRefs: ['observation-source'], approvalRequired: false },
      ] },
    ],
    planningPolicy: { style: 'reactive', horizon: 'one decision' },
    delegationPolicy: { mayDelegate: false, scope: 'none' },
    authorityBoundary: {
      allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REPORT'],
      prohibitedActions: ['EXECUTE', 'APPROVE', 'ESCALATE', 'DELEGATE'],
      approvalRequiredActions: [], executionAuthority: 'none', riskPolicyRef: null,
    },
    evaluationEnvironment: { requiredLayers: ['functional-correctness', 'data-integrity'] },
    substrateCompatibility: { requirements: ['deterministic-numeric'], constraints: [], testedSubstrates: ['substrate/reference@1'] },
  }, createdAt);

  const fundamental: BodyVersionMirror = bodyOf('fundamental-researcher', '1.0.0', {
    mission: researchMission('fundamental', REFERENCE_TOPICS.fundamental),
    capabilities: [
      { id: 'assessment-intake', name: 'Fundamental intake', description: 'Admit fundamental/macro observations', category: 'research', skillArtifactRefs: [], critical: true },
      { id: 'stance-assessment', name: 'Stance assessment', description: 'Score stance per series with declared thresholds', category: 'research', skillArtifactRefs: [], critical: true },
    ],
    knowledgeToolPolicy: {
      allowedTools: ['observation-source'], forbiddenTools: ['execution-adapter', 'venue-api'],
      toolCallBudgetPerDecision: 64, allowedKnowledgeSources: ['market-world'], forbiddenKnowledgeSources: ['future'],
    },
    procedures: [
      { id: 'p-fundamental-1', name: 'research-cycle', trigger: 'cadence', steps: [
        { id: 's-1', description: 'Assess stances; publish the fundamental report', toolRefs: ['observation-source'], approvalRequired: false },
      ] },
    ],
    planningPolicy: { style: 'reactive', horizon: 'one decision' },
    delegationPolicy: { mayDelegate: false, scope: 'none' },
    authorityBoundary: {
      allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REPORT'],
      prohibitedActions: ['EXECUTE', 'APPROVE', 'ESCALATE', 'DELEGATE'],
      approvalRequiredActions: [], executionAuthority: 'none', riskPolicyRef: null,
    },
    evaluationEnvironment: { requiredLayers: ['functional-correctness', 'data-integrity'] },
    substrateCompatibility: { requirements: ['deterministic-text'], constraints: [], testedSubstrates: ['substrate/reference@1'] },
  }, createdAt);

  const crossMarket: BodyVersionMirror = bodyOf('cross-market-researcher', '1.0.0', {
    mission: researchMission('cross-market', REFERENCE_TOPICS.crossMarket),
    capabilities: [
      { id: 'pair-measurement', name: 'Pair measurement', description: 'Measure cross-instrument co-movement', category: 'research', skillArtifactRefs: [], critical: true },
      { id: 'relationship-composition', name: 'Relationship composition', description: 'Compose relationship records with legged evidence', category: 'research', skillArtifactRefs: [], critical: true },
    ],
    knowledgeToolPolicy: {
      allowedTools: ['observation-source'], forbiddenTools: ['execution-adapter', 'venue-api'],
      toolCallBudgetPerDecision: 64, allowedKnowledgeSources: ['market-world'], forbiddenKnowledgeSources: ['future'],
    },
    procedures: [
      { id: 'p-cross-1', name: 'research-cycle', trigger: 'cadence', steps: [
        { id: 's-1', description: 'Measure pairs; publish the cross-market report', toolRefs: ['observation-source'], approvalRequired: false },
      ] },
    ],
    planningPolicy: { style: 'reactive', horizon: 'one decision' },
    delegationPolicy: { mayDelegate: false, scope: 'none' },
    authorityBoundary: {
      allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REPORT'],
      prohibitedActions: ['EXECUTE', 'APPROVE', 'ESCALATE', 'DELEGATE'],
      approvalRequiredActions: [], executionAuthority: 'none', riskPolicyRef: null,
    },
    evaluationEnvironment: { requiredLayers: ['functional-correctness', 'data-integrity'] },
    substrateCompatibility: { requirements: ['deterministic-numeric'], constraints: [], testedSubstrates: ['substrate/reference@1'] },
  }, createdAt);

  const director: BodyVersionMirror = bodyOf('trading-director', '1.0.0', {
    mission: {
      summary: 'Trading Director: consume the four research reports and produce the portfolio directive (or a typed escalation) on directors.decisions',
      goalRefs: [goalRef],
      standingDirectives: [
        'strategic clock only (L16) — never order-level control',
        'consume research strictly at or before the decision instant (L4)',
        'execution is prohibited at this body (L8)',
      ],
    },
    capabilities: [
      { id: 'research-intake', name: 'Research intake', description: 'Cite the four lanes with L4/L12 gates', category: 'decision', skillArtifactRefs: [], critical: true },
      { id: 'decision-synthesis', name: 'Decision synthesis', description: 'Declared-method synthesis over lane stances', category: 'decision', skillArtifactRefs: [], critical: true },
      { id: 'decision-publication', name: 'Decision publication', description: 'Publish the directive', category: 'decision', skillArtifactRefs: [], critical: true },
      { id: 'escalation', name: 'Escalation', description: 'Quorum-unmet / irreconcilable-conflict records', category: 'decision', skillArtifactRefs: [], critical: true },
    ],
    knowledgeToolPolicy: {
      allowedTools: ['research-reports'], forbiddenTools: ['execution-adapter', 'venue-api', 'order-entry'],
      toolCallBudgetPerDecision: 8, allowedKnowledgeSources: ['research-reports'], forbiddenKnowledgeSources: ['future', 'firm-memory'],
    },
    procedures: [
      { id: 'p-director-1', name: 'decision-cycle', trigger: 'cadence', steps: [
        { id: 's-1', description: 'Intake the four reports under the availability gate', toolRefs: ['research-reports'], approvalRequired: false },
        { id: 's-2', description: 'Synthesize under the declared method; publish the directive or the escalation', toolRefs: [], approvalRequired: false },
      ] },
    ],
    planningPolicy: { style: 'declarative-synthesis', horizon: 'one decision' },
    delegationPolicy: { mayDelegate: false, scope: 'none' },
    authorityBoundary: {
      allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REQUEST', 'LEARN', 'REPORT', 'ESCALATE'],
      prohibitedActions: ['EXECUTE', 'APPROVE'],
      approvalRequiredActions: [],
      executionAuthority: 'none',
      riskPolicyRef: null,
    },
    evaluationEnvironment: { requiredLayers: ['functional-correctness', 'historical-performance', 'organization-ablation'] },
    substrateCompatibility: { requirements: ['deterministic-text'], constraints: ['no-ambient-clock'], testedSubstrates: ['substrate/reference@1'] },
  }, createdAt);

  const execution: BodyVersionMirror = bodyOf('execution', '1.0.0', {
    mission: {
      summary: 'Execution body: own the order lifecycle under the external gateway — requests are gateway-bound, never venue-direct (L8/L16)',
      goalRefs: [goalRef],
      standingDirectives: [
        'order-level clock only (L16) — strictly after the decision instant',
        'only gateway APPROVE decisions authorize submissions (L8)',
        'fills are facts, never fabricated',
      ],
    },
    capabilities: [
      { id: 'order-preparation', name: 'Order preparation', description: 'Prepare orders from approved intents', category: 'execution', skillArtifactRefs: [], critical: true },
      { id: 'lifecycle-monitoring', name: 'Lifecycle monitoring', description: 'Acknowledge/fill/reconcile monitoring', category: 'execution', skillArtifactRefs: [], critical: true },
      { id: 'gateway-request', name: 'Gateway request', description: 'REQUEST operations to the external gateway', category: 'execution', skillArtifactRefs: [], critical: true },
    ],
    knowledgeToolPolicy: {
      allowedTools: ['gateway-port'], forbiddenTools: ['venue-api', 'order-entry-direct'],
      toolCallBudgetPerDecision: 16, allowedKnowledgeSources: ['gateway-decisions'], forbiddenKnowledgeSources: ['future'],
    },
    procedures: [
      { id: 'p-execution-1', name: 'execution-cycle', trigger: 'directive', steps: [
        { id: 's-1', description: 'Prepare the order; record the lifecycle genesis', toolRefs: [], approvalRequired: false },
        { id: 's-2', description: 'REQUEST submission through the gateway port; record fills as they become visible', toolRefs: ['gateway-port'], approvalRequired: true },
      ] },
    ],
    planningPolicy: { style: 'state-machine', horizon: 'order lifetime' },
    delegationPolicy: { mayDelegate: false, scope: 'none' },
    authorityBoundary: {
      allowedActions: ['OBSERVE', 'SUBSCRIBE', 'REQUEST', 'PUBLISH', 'REPORT', 'ESCALATE'],
      prohibitedActions: ['APPROVE'],
      approvalRequiredActions: ['EXECUTE'],
      executionAuthority: 'gateway-request-only',
      riskPolicyRef: null,
    },
    evaluationEnvironment: { requiredLayers: ['functional-correctness', 'execution-stress'] },
    substrateCompatibility: { requirements: ['deterministic-numeric'], constraints: ['no-ambient-clock'], testedSubstrates: ['substrate/reference@1'] },
  }, createdAt);

  return deepFreeze([sentiment, regime, fundamental, crossMarket, director, execution]);
}

/** Instance ids of the six slots (stable, derived from slot ids). */
export function referenceInstanceIds(): readonly string[] {
  return [
    'ai-research-sentiment', 'ai-research-regime', 'ai-research-fundamental',
    'ai-research-crossmarket', 'ai-director', 'ai-execution',
  ];
}

/** Wires each body to its substrate through a possession (T003 pattern). */
export function referencePossessions(
  scenario: TradingScenario,
  bodies: readonly BodyVersionMirror[],
): readonly PossessionMirror[] {
  const createdAt = new Date(scenario.epochMs).toISOString();
  const instances = referenceInstanceIds();
  return deepFreeze(
    bodies.map((body, index) => ({
      id: `pos:${scenario.tenant}:${body.bodyId}`,
      bodyVersionId: body.id,
      substrateId: 'substrate/reference@1',
      adapter: { adapterId: 'adapter-example-reference', configRef: `adapter-config:${body.bodyId}@1` },
      runtimeProfile: { maxConcurrentDecisions: 1, timeoutMs: 60_000 },
      environmentProfile: { profileRef: 'env-profile/reactive-world@1', fidelity: 'reactive_replay' },
      policyBundleRef: `policy-bundle:${scenario.tenant}:${body.bodyId}@1`,
      status: 'active' as const,
      createdAt,
    })).map((possession, index) => ({ ...possession, id: `${possession.id}:${instances[index]!.slice(3)}` })),
  );
}
