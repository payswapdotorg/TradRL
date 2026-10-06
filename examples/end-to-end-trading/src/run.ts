// @tradrl/example-e2e-trading — THE PIPELINE RUNNER (T048's composition).
//
// The whole ARCHITECTURE.md core flow made runnable in one deterministic
// function: User goal -> organization compiler -> bodies/possessions ->
// Agent OS -> market world -> research -> strategy -> risk -> execution ->
// outcome. Every stage consumes its predecessor's REAL records (never
// stubs), emits its own lineage records into the L15 ledger, and runs on
// injected instants only. Byte-reproducible: identical scenario in,
// identical stream out.

import { canonicalJson, deepFreeze, fnv1a32Hex, stableDigest, type JsonValue } from './primitives';
import { compareDecimal, decimalAt, decimalDivide, decimalMean, decimalMultiply, decimalSubtract, decimalSum } from './decimals';
import {
  mintApproveDecisionId,
  mintGatewayAuditRecordId,
  mintGatewaySubmissionId,
  mintOrdinalId,
  mintShadowOutcomeRecordId,
  mintShadowRefusalId,
  mintShadowSessionId,
  isoTimestampOf,
} from './ids';
import { REFERENCE_SCENARIO, type ScenarioRecord, type StreamEvent } from './scenario';
import {
  appendEntry,
  startLedger,
  verifyLedger,
  type LineageLedger,
} from './lineage';
import {
  type AgentActionNameMirror,
  type AgentInstanceMirror,
  type BodyVersionMirror,
  type PossessionMirror,
  authorityViolationsOf,
} from './mirrors/agent-body';
import {
  type KernelOperationMirror,
  type MessageEnvelopeMirror,
  type OrganizationBlueprintMirror,
  type OrganizationMirror,
  messageIdOf,
} from './mirrors/agent-os';
import {
  type CrossMarketReportMirror,
  type FundamentalReportMirror,
  type RegimeReportMirror,
  type ResearchIntakeMirror,
  type SentimentReportMirror,
  type CitationMirror,
} from './mirrors/research';
import {
  DIRECTOR_METHOD_REGISTRY,
  composeDirectorDecision,
  type DirectorDecision,
  type DirectorOutcome,
} from './mirrors/director';
import {
  type GoalStatementMirror,
  type ConstraintSetStatementMirror,
  type StrategyIntentMirror,
  type StrategyRunMirror,
  type PortfolioStateMirror,
  type StrategySpecMirror,
  compileStrategyRun,
  initialPortfolioState,
  baseTargetWeights,
  type ObservationWindowMirror,
  type MarketEventMirror,
} from './mirrors/strategy';
import {
  type ApproveDecisionMirror,
  type ExecutionDecisionMirror,
  type ExecutionPolicyMirror,
  type GatewayAuditRecordMirror,
  type GatewaySubmissionRecordMirror,
  type LimitEvaluationRecordMirror,
  type OrderRoutingPortMirror,
  type RoutingBundleMirror,
  type RoutingSendResult,
  evaluateLimitsMirror,
  runExecutionGateMirror,
  credentialValueViolations,
  contentDigest8,
} from './mirrors/authority';
import {
  type OrderLifecycleLogMirror,
  type ReconciliationRecordMirror,
  acceptExecutionIntakeMirror,
  appendOrderLifecycleEventMirror,
  prepareOrderMirror,
  reconcileFillsMirror,
} from './mirrors/execution';
import {
  type EngineStateMirror,
  type ExchangeConfigMirror,
  type FillMirror,
  createEngineMirror,
  submitOrderMirror,
} from './mirrors/exchange';
import {
  type ReactiveFillRecordMirror,
  type ReactiveObservationMirror,
  type ShadowBookMirror,
  type ShadowFillMirror,
  type ShadowLineageMirror,
  type ShadowOutcomeRecordMirror,
  type ShadowOutcomeLogMirror,
  type TimeMachineRecordMirror,
  type AsOfViewMirror,
  applyWorldFillMirror,
} from './mirrors/world';

// ---------------------------------------------------------------------------
// The run record
// ---------------------------------------------------------------------------

export interface EndToEndRunRecord {
  readonly runId: string;
  readonly scenarioId: string;
  readonly tenant: string;
  readonly project: string;
  readonly asOfRange: { readonly from: number; readonly to: number };
  readonly stages: {
    readonly scenario: { readonly goal: GoalStatementMirror; readonly constraintSet: ConstraintSetStatementMirror };
    readonly organization: { readonly blueprint: OrganizationBlueprintMirror; readonly organization: OrganizationMirror };
    readonly bodies: {
      readonly bodies: readonly BodyVersionMirror[];
      readonly possessions: readonly PossessionMirror[];
      readonly instances: readonly AgentInstanceMirror[];
      readonly kernelOps: readonly KernelOperationMirror[];
      readonly envelopes: readonly MessageEnvelopeMirror[];
    };
    readonly marketWorld: {
      readonly machineRecords: readonly TimeMachineRecordMirror[];
      readonly view: AsOfViewMirror;
      readonly engineConfigHashes: readonly { readonly instrumentId: string; readonly hash: string }[];
      readonly observations: readonly ReactiveObservationMirror[];
    };
    readonly research: ResearchIntakeMirror;
    readonly director: { readonly outcome: DirectorOutcome };
    readonly strategy: { readonly spec: StrategySpecMirror; readonly state: PortfolioStateMirror; readonly run: StrategyRunMirror };
    readonly riskGateway: {
      readonly evaluations: readonly LimitEvaluationRecordMirror[];
      readonly decisions: readonly ExecutionDecisionMirror[];
      readonly auditRecords: readonly GatewayAuditRecordMirror[];
      readonly submissions: readonly GatewaySubmissionRecordMirror[];
    };
    readonly execution: {
      readonly logs: readonly OrderLifecycleLogMirror[];
      readonly reconciliations: readonly ReconciliationRecordMirror[];
      readonly engineFills: readonly FillMirror[];
      readonly reactiveFills: readonly ReactiveFillRecordMirror[];
    };
    readonly outcomes: {
      readonly book: ShadowBookMirror;
      readonly shadowFills: readonly ShadowFillMirror[];
      readonly outcomeLog: ShadowOutcomeLogMirror;
    };
  };
  readonly ledger: LineageLedger;
}

/** The typed run error codes. */
export type RunErrorCode =
  | 'stage_failed'
  | 'director_composition_failed'
  | 'strategy_compilation_failed'
  | 'gateway_refused'
  | 'order_preparation_failed'
  | 'lifecycle_failed'
  | 'ledger_failed'
  | 'engine_failed';

export interface RunError {
  readonly code: RunErrorCode;
  readonly stage: string;
  readonly message: string;
  readonly detail?: unknown;
}

export type RunResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly RunError[] };

// ---------------------------------------------------------------------------
// The deterministic kernel (a tiny agent-os mirror driver)
// ---------------------------------------------------------------------------

class DeterministicKernel {
  private ops: KernelOperationMirror[] = [];
  private envelopes: MessageEnvelopeMirror[] = [];
  private sequences = new Map<string, number>();

  constructor(private readonly tenant: string) {}

  nextOpId(): string {
    return `op-${String(this.ops.length + 1).padStart(4, '0')}`;
  }

  record(type: AgentActionNameMirror, actor: string, at: number, topic: string | null, payloadRef: string | null): string {
    const opId = this.nextOpId();
    this.ops.push(deepFreeze({ opId, type, timestamp: at, actor, tenantId: this.tenant, topic, payloadRef }));
    return opId;
  }

  publish(opId: string, actor: string, topic: string, payloadRef: string, at: number): MessageEnvelopeMirror {
    const sequence = (this.sequences.get(actor) ?? 0) + 1;
    this.sequences.set(actor, sequence);
    const envelope: MessageEnvelopeMirror = deepFreeze({
      id: messageIdOf(opId, actor, sequence),
      topic,
      tenantId: this.tenant,
      sender: actor,
      payloadRef,
      sequence,
      causalityId: opId,
      publishedAt: at,
    });
    this.envelopes.push(envelope);
    return envelope;
  }

  snapshot(): { readonly ops: readonly KernelOperationMirror[]; readonly envelopes: readonly MessageEnvelopeMirror[] } {
    return deepFreeze({ ops: this.ops, envelopes: this.envelopes });
  }
}

/** The ledger helper: append or fail the run (broken links stop the world). */
function ledgerAppend(
  ledger: LineageLedger,
  stage: Parameters<typeof appendEntry>[1]['stage'],
  recordKind: string,
  recordId: string,
  scenario: ScenarioRecord,
  asOf: number,
  parents: readonly string[],
): { readonly ledger: LineageLedger; readonly entryId: string } {
  const result = appendEntry(ledger, {
    stage,
    recordKind,
    recordId,
    tenant: scenario.tenant,
    project: scenario.project,
    asOf,
    parents,
  });
  if (!result.ok) {
    throw new Error(`ledger append failed at ${stage}/${recordKind}: ${result.errors.map((e) => e.message).join('; ')}`);
  }
  return { ledger: result.value, entryId: result.value.entries[result.value.entries.length - 1].entryId };
}

// ---------------------------------------------------------------------------
// Stage helpers: the five body specs (deterministic, structurally real)
// ---------------------------------------------------------------------------

function researchBody(
  bodyId: string,
  summary: string,
  topic: string,
): BodyVersionMirror {
  return deepFreeze({
    id: `${bodyId}@1.0.0`,
    bodyId,
    version: { major: 1, minor: 0, patch: 0, prerelease: [], build: [] },
    parentId: null,
    composition: {
      mission: {
        summary,
        goalRefs: ['goal/e2e-reference'],
        standingDirectives: ['observe only point-in-time admitted records (L4)'],
      },
      capabilities: [
        {
          id: `capability/${bodyId}/research`,
          name: 'research',
          description: summary,
          category: 'research',
          skillArtifactRefs: [`skill/${bodyId}/observation@1`],
          critical: true,
        },
      ],
      knowledgeToolPolicy: {
        allowedTools: ['tools/observation-subscriber', 'tools/research-composer'],
        forbiddenTools: ['tools/order-entry', 'tools/execution-router'],
        toolCallBudgetPerDecision: 8,
        allowedKnowledgeSources: [`dataset/e2e/reference@1`],
        forbiddenKnowledgeSources: [],
      },
      procedures: [
        {
          id: 'procedure/research-cycle',
          name: 'research-cycle',
          trigger: 'scheduled',
          steps: [
            { id: 'step/observe', description: 'drain the point-in-time cursor', toolRefs: ['tools/observation-subscriber'], approvalRequired: false },
            { id: 'step/compose', description: 'compose the report from admitted observations', toolRefs: ['tools/research-composer'], approvalRequired: false },
          ],
        },
      ],
      planningPolicy: { style: 'reactive', maxPlanDepth: 2, replanTriggers: ['observation-gap'] },
      delegationPolicy: { canDelegate: false, maxDelegationDepth: 0, delegateeCategories: [], escalationCategories: ['data-gap'] },
      authorityBoundary: {
        allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'LEARN', 'REPORT', 'ESCALATE'],
        prohibitedActions: ['EXECUTE', 'SPAWN', 'TERMINATE', 'APPROVE', 'DELEGATE'],
        approvalRequiredActions: [],
        executionAuthority: 'none',
        riskPolicyRef: null,
      },
      evaluationEnvironment: {
        requiredEvaluationLayers: ['data-integrity', 'functional-correctness'],
        requiredEnvironmentFeatures: ['point-in-time-observations'],
        requiredDataCategories: ['market'],
        requiredFidelityModes: ['reactive-replay'],
      },
      substrateCompatibility: {
        requirements: { minContextWindowTokens: 8192, minMaxOutputTokens: 1024, requiredInputModalities: ['text'], requiredOutputModalities: ['text'], toolUse: 'required', structuredOutput: 'required' },
        constraints: { allowedSubstitutionClasses: null, maxInputCostPerMTokens: null, maxOutputCostPerMTokens: null, maxP95LatencyMs: null },
        testedSubstrates: [{ substrate: 'substrate/e2e-reasoner@1', result: 'pass', testedAt: '2026-06-01T00:00:00Z', evidence: 'evidence/e2e/substrate-pass@1', notes: null }],
      },
    },
    createdAt: '2026-06-01T00:00:00Z',
    certified: false,
    certificationEvidence: null,
  });
}

function directorBody(): BodyVersionMirror {
  return deepFreeze({
    id: 'trading-director@1.0.0',
    bodyId: 'trading-director',
    version: { major: 1, minor: 0, patch: 0, prerelease: [], build: [] },
    parentId: null,
    composition: {
      mission: {
        summary: 'Portfolio-level decision composition over the four research lanes (L16: strategic level only).',
        goalRefs: ['goal/e2e-reference'],
        standingDirectives: ['never order-level control (L16)', 'never execution authority (L8)'],
      },
      capabilities: [
        { id: 'capability/director/research-intake', name: 'research-intake', description: 'consume the four research lanes', category: 'decision', skillArtifactRefs: ['skill/director/intake@1'], critical: true },
        { id: 'capability/director/decision-synthesis', name: 'decision-synthesis', description: 'declared-method synthesis', category: 'decision', skillArtifactRefs: ['skill/director/synthesis@1'], critical: true },
      ],
      knowledgeToolPolicy: {
        allowedTools: ['tools/research-subscriber', 'tools/decision-synthesizer', 'tools/decision-publisher'],
        forbiddenTools: ['tools/order-entry', 'tools/execution-router', 'tools/position-manager'],
        toolCallBudgetPerDecision: 16,
        allowedKnowledgeSources: ['dataset/e2e/reference@1'],
        forbiddenKnowledgeSources: [],
      },
      procedures: [
        {
          id: 'procedure/decision-cycle',
          name: 'decision-cycle',
          trigger: 'scheduled',
          steps: [
            { id: 'step/intake', description: 'validate the four-lane intake (L4/L12)', toolRefs: ['tools/research-subscriber'], approvalRequired: false },
            { id: 'step/synthesize', description: 'run the declared synthesis method', toolRefs: ['tools/decision-synthesizer'], approvalRequired: false },
            { id: 'step/publish', description: 'publish the decision or escalation', toolRefs: ['tools/decision-publisher'], approvalRequired: false },
          ],
        },
      ],
      planningPolicy: { style: 'deliberative', maxPlanDepth: 3, replanTriggers: ['quorum-unmet', 'irreconcilable-conflict'] },
      delegationPolicy: { canDelegate: false, maxDelegationDepth: 0, delegateeCategories: [], escalationCategories: ['quorum-unmet', 'irreconcilable-conflict'] },
      authorityBoundary: {
        allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REQUEST', 'LEARN', 'REPORT', 'ESCALATE'],
        prohibitedActions: ['EXECUTE', 'SPAWN', 'TERMINATE', 'APPROVE', 'DELEGATE'],
        approvalRequiredActions: ['ESCALATE'],
        executionAuthority: 'none',
        riskPolicyRef: null,
      },
      evaluationEnvironment: {
        requiredEvaluationLayers: ['functional-correctness', 'organization-ablation'],
        requiredEnvironmentFeatures: ['four-lane-research-intake'],
        requiredDataCategories: ['market'],
        requiredFidelityModes: ['reactive-replay'],
      },
      substrateCompatibility: {
        requirements: { minContextWindowTokens: 32768, minMaxOutputTokens: 4096, requiredInputModalities: ['text'], requiredOutputModalities: ['text'], toolUse: 'required', structuredOutput: 'required' },
        constraints: { allowedSubstitutionClasses: null, maxInputCostPerMTokens: null, maxOutputCostPerMTokens: null, maxP95LatencyMs: null },
        testedSubstrates: [{ substrate: 'substrate/e2e-reasoner@1', result: 'pass', testedAt: '2026-06-01T00:00:00Z', evidence: 'evidence/e2e/substrate-pass@1', notes: null }],
      },
    },
    createdAt: '2026-06-01T00:00:00Z',
    certified: false,
    certificationEvidence: null,
  });
}

function strategistBody(): BodyVersionMirror {
  const strategist = researchBody('strategist', 'Portfolio construction and intent emission under the goal and constraint set.', 'directors.decisions');
  return deepFreeze({
    ...strategist,
    id: 'strategist@1.0.0',
    bodyId: 'strategist',
    composition: {
      ...strategist.composition,
      mission: { summary: 'Portfolio construction: directive + goal + constraints -> lot-fenced intents with constraint proofs.', goalRefs: ['goal/e2e-reference'], standingDirectives: ['constraint gate BEFORE intent emission'] },
      capabilities: [
        { id: 'capability/strategist/portfolio-construction', name: 'portfolio-construction', description: 'target weights, drift, candidate actions', category: 'strategy', skillArtifactRefs: ['skill/strategist/construction@1'], critical: true },
        { id: 'capability/strategist/intent-emission', name: 'intent-emission', description: 'emit constraint-proved order intents', category: 'strategy', skillArtifactRefs: ['skill/strategist/emission@1'], critical: true },
      ],
      knowledgeToolPolicy: {
        allowedTools: ['tools/directive-subscriber', 'tools/portfolio-composer', 'tools/intent-emitter'],
        forbiddenTools: ['tools/order-entry', 'tools/execution-router', 'tools/position-manager'],
        toolCallBudgetPerDecision: 16,
        allowedKnowledgeSources: ['dataset/e2e/reference@1'],
        forbiddenKnowledgeSources: [],
      },
      authorityBoundary: {
        allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REQUEST', 'LEARN', 'REPORT', 'ESCALATE'],
        prohibitedActions: ['EXECUTE', 'SPAWN', 'TERMINATE', 'APPROVE', 'DELEGATE'],
        approvalRequiredActions: [],
        executionAuthority: 'none',
        riskPolicyRef: 'rpol:e2e-reference',
      },
    },
  });
}

function executionBody(): BodyVersionMirror {
  return deepFreeze({
    id: 'execution@1.0.0',
    bodyId: 'execution',
    version: { major: 1, minor: 0, patch: 0, prerelease: [], build: [] },
    parentId: null,
    composition: {
      mission: {
        summary: 'Order-lifecycle management through the external gateway ONLY (L8: the body REQUESTS, the gateway executes).',
        goalRefs: ['goal/e2e-reference'],
        standingDirectives: ['L16: the order-level clock, distinct from every strategic asOf', 'never fabricate a fill or a cancel'],
      },
      capabilities: [
        { id: 'capability/execution/order-lane-intake', name: 'order-lane-intake', description: 'APPROVE decisions + intents + kill-switch standing state', category: 'order-lifecycle', skillArtifactRefs: ['skill/execution/intake@1'], critical: true },
        { id: 'capability/execution/order-preparation', name: 'order-preparation', description: 'prepare + submit through the gateway', category: 'order-lifecycle', skillArtifactRefs: ['skill/execution/preparation@1'], critical: true },
        { id: 'capability/execution/fill-reconciliation', name: 'fill-reconciliation', description: 'exact-equality reconciliation', category: 'order-lifecycle', skillArtifactRefs: ['skill/execution/reconciliation@1'], critical: true },
      ],
      knowledgeToolPolicy: {
        allowedTools: ['tools/execution-gateway-requester', 'tools/lifecycle-monitor'],
        forbiddenTools: ['tools/venue-direct-order-entry', 'tools/execution-router', 'tools/position-manager'],
        toolCallBudgetPerDecision: 24,
        allowedKnowledgeSources: ['dataset/e2e/reference@1'],
        forbiddenKnowledgeSources: [],
      },
      procedures: [
        {
          id: 'procedure/order-management-cycle',
          name: 'order-management-cycle',
          trigger: 'event',
          steps: [
            { id: 'step/intake', description: 'accept the gated bundle', toolRefs: ['tools/lifecycle-monitor'], approvalRequired: false },
            { id: 'step/prepare', description: 'prepare the order (L16 clock)', toolRefs: ['tools/lifecycle-monitor'], approvalRequired: false },
            { id: 'step/request-submission', description: 'REQUEST through the gateway', toolRefs: ['tools/execution-gateway-requester'], approvalRequired: true },
            { id: 'step/reconcile', description: 'reconcile fills exactly', toolRefs: ['tools/lifecycle-monitor'], approvalRequired: false },
          ],
        },
      ],
      planningPolicy: { style: 'reactive', maxPlanDepth: 2, replanTriggers: ['stuck-order', 'reconciliation-gap'] },
      delegationPolicy: { canDelegate: false, maxDelegationDepth: 0, delegateeCategories: [], escalationCategories: ['kill-switch-mid-flight'] },
      authorityBoundary: {
        allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REQUEST', 'EXECUTE', 'LEARN', 'REPORT', 'ESCALATE'],
        prohibitedActions: ['SPAWN', 'TERMINATE', 'APPROVE', 'DELEGATE'],
        approvalRequiredActions: ['EXECUTE', 'ESCALATE'],
        executionAuthority: 'external-gateway-only',
        riskPolicyRef: null,
      },
      evaluationEnvironment: {
        requiredEvaluationLayers: ['functional-correctness', 'execution-stress'],
        requiredEnvironmentFeatures: ['gateway-request-mode'],
        requiredDataCategories: ['market'],
        requiredFidelityModes: ['reactive-replay'],
      },
      substrateCompatibility: {
        requirements: { minContextWindowTokens: 16384, minMaxOutputTokens: 2048, requiredInputModalities: ['text'], requiredOutputModalities: ['text'], toolUse: 'required', structuredOutput: 'required' },
        constraints: { allowedSubstitutionClasses: null, maxInputCostPerMTokens: null, maxOutputCostPerMTokens: null, maxP95LatencyMs: null },
        testedSubstrates: [{ substrate: 'substrate/e2e-reasoner@1', result: 'pass', testedAt: '2026-06-01T00:00:00Z', evidence: 'evidence/e2e/substrate-pass@1', notes: null }],
      },
    },
    createdAt: '2026-06-01T00:00:00Z',
    certified: false,
    certificationEvidence: null,
  });
}

// ---------------------------------------------------------------------------
// THE RUN
// ---------------------------------------------------------------------------

/** Runs the whole reference pipeline over a scenario (deterministic). */
export function runEndToEndScenario(scenario: ScenarioRecord = REFERENCE_SCENARIO): RunResult<EndToEndRunRecord> {
  try {
    return { ok: true, value: runPipeline(scenario) };
  } catch (error) {
    return {
      ok: false,
      errors: deepFreeze([
        {
          code: 'stage_failed',
          stage: 'pipeline',
          message: error instanceof Error ? error.message : String(error),
        },
      ]),
    };
  }
}

function runPipeline(scenario: ScenarioRecord): EndToEndRunRecord {
  const { instants, seeds } = scenario;
  const kernel = new DeterministicKernel(scenario.tenant);
  let ledger = startLedger(scenario.tenant, scenario.project);

  // -- Stage 1: scenario (the goal is the L15 root) ------------------------
  const scenarioEntry = ledgerAppend(ledger, 'scenario', 'scenario', scenario.scenarioId, scenario, instants.t0, []);
  ledger = scenarioEntry.ledger;
  const goalEntry = ledgerAppend(ledger, 'scenario', 'goal-statement', scenario.goal.id, scenario, scenario.goal.createdAt, [scenarioEntry.entryId]);
  ledger = goalEntry.ledger;
  const constraintEntry = ledgerAppend(ledger, 'scenario', 'constraint-set', scenario.constraintSet.id, scenario, scenario.constraintSet.createdAt, [scenarioEntry.entryId]);
  ledger = constraintEntry.ledger;

  // -- Stage 2: organization compile (declared method, budget-bounded) -----
  const specializations = ['sentiment-research', 'regime-research', 'fundamental-research', 'cross-market-research', 'trading-director', 'strategy', 'execution'];
  const blueprint: OrganizationBlueprintMirror = deepFreeze({
    tenantId: scenario.tenant,
    projectId: scenario.project,
    agentCount: 7,
    specializations,
    assignments: [
      { slotId: 'slot/sentiment', bodyVersionRef: 'sentiment-researcher@1.0.0', capabilityRecordRefs: ['caprec/sentiment/observation@1'], riskPolicyRefs: [] },
      { slotId: 'slot/regime', bodyVersionRef: 'regime-researcher@1.0.0', capabilityRecordRefs: ['caprec/regime/observation@1'], riskPolicyRefs: [] },
      { slotId: 'slot/fundamental', bodyVersionRef: 'fundamental-researcher@1.0.0', capabilityRecordRefs: ['caprec/fundamental/observation@1'], riskPolicyRefs: [] },
      { slotId: 'slot/cross-market', bodyVersionRef: 'cross-market-researcher@1.0.0', capabilityRecordRefs: ['caprec/crossmarket/observation@1'], riskPolicyRefs: [] },
      { slotId: 'slot/director', bodyVersionRef: 'trading-director@1.0.0', capabilityRecordRefs: ['caprec/director/synthesis@1'], riskPolicyRefs: [] },
      { slotId: 'slot/strategist', bodyVersionRef: 'strategist@1.0.0', capabilityRecordRefs: ['caprec/strategist/construction@1'], riskPolicyRefs: ['rpol:e2e-reference'] },
      { slotId: 'slot/execution', bodyVersionRef: 'execution@1.0.0', capabilityRecordRefs: ['caprec/execution/lifecycle@1'], riskPolicyRefs: [] },
    ],
    topology: {
      wires: [
        { topic: 'research.sentiment', publishers: ['slot/sentiment'], subscribers: ['slot/director'] },
        { topic: 'research.regime', publishers: ['slot/regime'], subscribers: ['slot/director'] },
        { topic: 'research.fundamental', publishers: ['slot/fundamental'], subscribers: ['slot/director'] },
        { topic: 'research.crossmarket', publishers: ['slot/cross-market'], subscribers: ['slot/director'] },
        { topic: 'directors.decisions', publishers: ['slot/director'], subscribers: ['slot/strategist'] },
        { topic: 'strategy.intents', publishers: ['slot/strategist'], subscribers: ['slot/execution'] },
      ],
    },
    trainingAllocation: { research: 0.5, strategy: 0.3, evaluation: 0.2 },
    decisionCadence: { mode: 'event-driven' },
    adversarialPopulation: { adversarySlots: 0, declared: 'none-required' },
  });
  if (blueprint.agentCount > scenario.budget.maxAgentCount) {
    throw new Error(`organization compile: agentCount ${String(blueprint.agentCount)} exceeds the budget ${String(scenario.budget.maxAgentCount)}`);
  }
  const organization: OrganizationMirror = deepFreeze({
    id: 'org/e2e-reference-1',
    tenantId: scenario.tenant,
    projectId: scenario.project,
    name: 'e2e-reference-organization',
    status: 'active',
    createdAt: instants.t0,
    memberships: blueprint.assignments.map((assignment) => ({
      agentInstanceId: `agent/e2e-${assignment.slotId.replace('slot/', '')}`,
      role: assignment.slotId.replace('slot/', ''),
      bodyVersionId: assignment.bodyVersionRef,
    })),
    communicationTopologyId: 'topology/e2e-reference-1',
    decisionCadence: { mode: 'event-driven' },
  });
  const blueprintEntry = ledgerAppend(ledger, 'organization', 'organization-blueprint', 'org/e2e-reference-1', scenario, instants.t0, [goalEntry.entryId, constraintEntry.entryId]);
  ledger = blueprintEntry.ledger;
  const organizationEntry = ledgerAppend(ledger, 'organization', 'organization', organization.id, scenario, instants.t0, [blueprintEntry.entryId]);
  ledger = organizationEntry.ledger;

  // -- Stage 3: bodies + possessions + kernel spawn -------------------------
  const bodies: BodyVersionMirror[] = [
    researchBody('sentiment-researcher', 'Sentiment observation: polarity/intensity readings over news-shaped events.', 'research.sentiment'),
    researchBody('regime-researcher', 'Regime observation: net-move classification over trade prints.', 'research.regime'),
    researchBody('fundamental-researcher', 'Fundamental observation: stance assessments over fundamental events.', 'research.fundamental'),
    researchBody('cross-market-researcher', 'Cross-market observation: co-movement relationships over instrument pairs.', 'research.crossmarket'),
    directorBody(),
    strategistBody(),
    executionBody(),
  ];
  for (const body of bodies) {
    const violations = authorityViolationsOf(body.composition.authorityBoundary);
    if (violations.length > 0) {
      throw new Error(`body ${body.id} violates the authority laws: ${violations.join(', ')}`);
    }
  }
  const possessions: PossessionMirror[] = blueprint.assignments.map((assignment, index) =>
    deepFreeze({
      id: `possession/e2e-${String(index + 1).padStart(2, '0')}`,
      bodyVersionId: assignment.bodyVersionRef,
      substrateId: scenario.substrate,
      adapter: { adapterId: 'adapter/e2e-reasoner@1', configRef: 'config/e2e-reasoner@1' },
      runtimeProfile: { timeoutMs: 30_000, maxRetries: 0, maxConcurrentInvocations: 1, costBudgetRef: 'budget/e2e/compute@1' },
      environmentProfile: { environmentRef: 'environment/e2e-reactive@1', fidelityMode: 'reactive-replay' },
      policyBundleRef: 'policybundle/e2e-reference@1',
      status: 'validated',
      createdAt: '2026-06-01T00:00:00Z',
    }),
  );
  const instances: AgentInstanceMirror[] = blueprint.assignments.map((assignment, index) =>
    deepFreeze({
      id: organization.memberships[index].agentInstanceId,
      possessionId: possessions[index].id,
      projectId: scenario.project,
      managerId: assignment.slotId === 'slot/execution' ? 'agent/e2e-strategist' : assignment.slotId === 'slot/strategist' ? 'agent/e2e-director' : 'agent/e2e-director',
      authority: {
        allowedActions: assignment.slotId === 'slot/execution' ? ['OBSERVE', 'SUBSCRIBE', 'REQUEST', 'EXECUTE', 'PUBLISH', 'REPORT', 'ESCALATE'] : ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REQUEST', 'REPORT', 'ESCALATE'],
        deniedActions: assignment.slotId === 'slot/execution' ? ['SPAWN', 'TERMINATE', 'APPROVE', 'DELEGATE'] : ['EXECUTE', 'SPAWN', 'TERMINATE', 'APPROVE', 'DELEGATE'],
        maxDelegationDepth: 0,
      },
      runtimeStateRef: `runtime/e2e-${assignment.slotId.replace('slot/', '')}@1`,
      status: 'ready',
      spawnedAt: '2026-06-01T00:00:00Z',
    }),
  );
  const instanceEntries: { readonly id: string; readonly entryId: string }[] = [];
  bodies.forEach((body, index) => {
    const bodyEntry = ledgerAppend(ledger, 'bodies', 'body-version', body.id, scenario, instants.t0, [organizationEntry.entryId]);
    ledger = bodyEntry.ledger;
    const possessionEntry = ledgerAppend(ledger, 'bodies', 'possession', possessions[index].id, scenario, instants.t0, [bodyEntry.entryId]);
    ledger = possessionEntry.ledger;
    const instanceEntry = ledgerAppend(ledger, 'bodies', 'agent-instance', instances[index].id, scenario, instants.t0, [possessionEntry.entryId]);
    ledger = instanceEntry.ledger;
    instanceEntries.push({ id: instances[index].id, entryId: instanceEntry.entryId });
    kernel.record('SPAWN', instances[index].id, instants.t0, null, null);
  });
  for (const wire of blueprint.topology.wires) {
    for (const subscriber of wire.subscribers) {
      const subscriberInstance = instances.find((instance, index) => blueprint.assignments[index].slotId === subscriber);
      if (subscriberInstance !== undefined) {
        kernel.record('SUBSCRIBE', subscriberInstance.id, instants.t0, wire.topic, null);
      }
    }
  }

  // -- Stage 4: market world + time machine ---------------------------------
  const machineRecords: TimeMachineRecordMirror[] = scenario.stream.map((event, index) =>
    deepFreeze({
      record_id: event.event_id,
      tenant: scenario.tenant,
      payload: { event_type: event.event_type, instrument: event.instrument, payload: event.payload },
      event_time: event.event_time,
      source_time: event.source_time,
      available_time: event.available_time,
      ingestion_time: event.ingestion_time,
      inputs: [],
      computation: null,
      provenance: { adapter: event.provenance.adapter, batch: { batch_id: 'batch/e2e-stream-1' }, commit: { commit_id: 'commit/e2e-1', commit_sequence: 1, ingestion_time: event.ingestion_time } },
      arrival_sequence: index + 1,
    }),
  );
  const view: AsOfViewMirror = deepFreeze({
    dataset: 'dataset/e2e/reference@1',
    at: instants.researchAsOf,
    records: machineRecords.filter((record) => record.available_time <= instants.researchAsOf),
    audit: deepFreeze({
      tenant: scenario.tenant,
      at: instants.researchAsOf,
      scanned: machineRecords.length,
      decisions: machineRecords.map((record) => ({
        record_id: record.record_id,
        decision: record.available_time <= instants.researchAsOf ? ('included' as const) : ('excluded' as const),
        reason: record.available_time <= instants.researchAsOf ? ('visible' as const) : ('not_yet_available' as const),
        available_time: record.available_time,
        now: instants.researchAsOf,
      })),
    }),
  });
  const engineConfigOf = (binding: { readonly instrumentId: string; readonly tickSize: string; readonly lotSize: string }): ExchangeConfigMirror =>
    deepFreeze({
      ...scenario.exchangeConfig,
      instrument: binding.instrumentId,
      tick_size: binding.tickSize,
      lot_size: binding.lotSize,
    });
  const engines = new Map<string, EngineStateMirror>();
  const engineConfigHashes: { readonly instrumentId: string; readonly hash: string }[] = [];
  for (const binding of scenario.engineBindings) {
    const config = engineConfigOf(binding);
    const created = createEngineMirror(config, { book_seed: binding.bookSeed, start_at: instants.t0 });
    if (!created.ok) throw new Error(`engine creation failed for ${binding.instrumentId}`);
    engines.set(binding.instrumentId, created.value);
    engineConfigHashes.push({ instrumentId: binding.instrumentId, hash: fnv1a32Hex(canonicalJson(config as unknown as JsonValue)) });
  }
  const worldConfigHash = fnv1a32Hex(canonicalJson(scenario.worldConfig as unknown as JsonValue));
  const observations: ReactiveObservationMirror[] = view.records.map((record) => {
    const event = scenario.stream.find((candidate) => candidate.event_id === record.record_id) as StreamEvent;
    return deepFreeze({
      observation_id: `obs-${record.record_id}`,
      available_time: record.available_time,
      venue: event.venue,
      instrument: event.instrument,
      payload: event.payload,
      provenance: { origin: 'historical', source: event.provider, derived_from: [] },
      run_ref: 'run/e2e-reactive-1',
      tenant: scenario.tenant,
      project: scenario.project,
    });
  });
  const worldEntry = ledgerAppend(ledger, 'market-world', 'reactive-world-config', scenario.worldConfig.world_id, scenario, instants.t0, [scenarioEntry.entryId]);
  ledger = worldEntry.ledger;
  const observationEntries = new Map<string, string>();
  for (const observation of observations) {
    const entry = ledgerAppend(ledger, 'market-world', 'world-observation', observation.observation_id, scenario, observation.available_time, [worldEntry.entryId]);
    ledger = entry.ledger;
    observationEntries.set(observation.observation_id, entry.entryId);
  }
  const viewEntry = ledgerAppend(ledger, 'market-world', 'as-of-view', `view/research@${String(instants.researchAsOf)}`, scenario, instants.researchAsOf, observations.map((observation) => observationEntries.get(observation.observation_id) as string));
  ledger = viewEntry.ledger;

  // -- Stage 5: the four research bodies ------------------------------------
  const sentimentInstance = instances[0];
  const regimeInstance = instances[1];
  const fundamentalInstance = instances[2];
  const crossMarketInstance = instances[3];

  const citationOf = (observation: ReactiveObservationMirror): CitationMirror =>
    deepFreeze({
      observationId: observation.observation_id,
      availableTime: observation.available_time,
      provenance: { origin: 'historical', adapter: { id: 'adapter-binance', version: '0.0.0' }, derived_from: [], transform: null },
    });

  const newsObservations = observations.filter((observation) => {
    const event = scenario.stream.find((candidate) => candidate.event_id === observation.observation_id.replace('obs-', ''));
    return event !== undefined && event.event_type === 'news';
  });
  const fundamentalObservations = observations.filter((observation) => {
    const event = scenario.stream.find((candidate) => candidate.event_id === observation.observation_id.replace('obs-', ''));
    return event !== undefined && event.event_type === 'fundamental';
  });
  const tradeObservationsByInstrument = new Map<string, ReactiveObservationMirror[]>();
  for (const instrument of scenario.universe) {
    tradeObservationsByInstrument.set(
      instrument.instrumentId,
      observations.filter((observation) => {
        const event = scenario.stream.find((candidate) => candidate.event_id === observation.observation_id.replace('obs-', ''));
        return event !== undefined && event.event_type === 'trade' && event.instrument === instrument.instrumentId;
      }),
    );
  }

  // Sentiment: polarity readings from news events (typed data gaps elsewhere).
  const sentimentReadings = newsObservations.map((observation, index) => {
    const event = scenario.stream.find((candidate) => candidate.event_id === observation.observation_id.replace('obs-', '')) as StreamEvent;
    const payload = event.payload as { readonly kind: string; readonly polarityHint: 'positive' | 'negative' | 'neutral'; readonly note: string };
    const score = payload.polarityHint === 'positive' ? '0.8' : payload.polarityHint === 'negative' ? '-0.8' : '0';
    return deepFreeze({
      readingId: `sr-${String(index + 1).padStart(4, '0')}`,
      scope: { instrument: event.instrument, venue: event.venue },
      polarity: { methodId: 'method/sentiment/polarity', methodVersion: '1.0.0', direction: (payload.polarityHint === 'neutral' ? 'neutral' : payload.polarityHint) as 'positive' | 'negative' | 'neutral', score },
      intensity: { methodId: 'method/sentiment/intensity', methodVersion: '1.0.0', level: 'moderate' as const, score: '0.6' },
      confidence: { methodId: 'method/sentiment/confidence', methodVersion: '1.0.0', level: 'high' as const, evidenceCount: 1, dispersion: null },
      evidence: [citationOf(observation)],
      asOf: instants.researchAsOf,
      bodyVersion: 'sentiment-researcher@1.0.0',
      tenantId: scenario.tenant,
      projectId: scenario.project,
      seed: seeds.world,
    });
  });
  const sentimentDigests = newsObservations.map((observation, index) => {
    const event = scenario.stream.find((candidate) => candidate.event_id === observation.observation_id.replace('obs-', '')) as StreamEvent;
    return deepFreeze({
      digestId: `ed-${String(index + 1).padStart(4, '0')}`,
      kind: 'sentiment-spike' as const,
      instruments: [event.instrument],
      venues: [event.venue],
      window: { from: event.event_time, to: event.event_time },
      observationCount: 1,
      evidence: [citationOf(observation)],
      asOf: instants.researchAsOf,
      methodId: 'method/sentiment/event-digest',
      methodVersion: '1.0.0',
      bodyVersion: 'sentiment-researcher@1.0.0',
      tenantId: scenario.tenant,
      projectId: scenario.project,
      seed: seeds.world,
    });
  });
  const sentimentContent = {
    asOf: instants.researchAsOf,
    bodyVersion: 'sentiment-researcher@1.0.0',
    methodId: 'method/sentiment/report',
    methodVersion: '1.0.0',
    tenantId: scenario.tenant,
    projectId: scenario.project,
    seed: seeds.world,
    readings: sentimentReadings,
    digests: sentimentDigests,
    summary: {
      readingCount: sentimentReadings.length,
      digestCount: sentimentDigests.length,
      instrumentCount: new Set(sentimentReadings.map((reading) => reading.scope.instrument)).size,
      dominantPolarity: 'positive',
      meanPolarityScore: '0.8',
      coverage: { observationsOffered: newsObservations.length, observationsAdmitted: newsObservations.length, observationsDeferred: 0, observationsUnsupported: 0, observationsInvalid: 0 },
      dataGaps: scenario.universe
        .filter((instrument) => !newsObservations.some((observation) => observation.instrument === instrument.instrumentId))
        .map((instrument) => ({ kind: 'no-news-observations', instrument: instrument.instrumentId })),
    },
  };
  const sentimentReport: SentimentReportMirror = deepFreeze({
    ...sentimentContent,
    reportId: `rr-${stableDigest(canonicalJson(sentimentContent as unknown as JsonValue))}`,
  });

  // Regime: net-move classification per instrument.
  const regimeClassifications = scenario.universe.flatMap((instrument, index) => {
    const trades = tradeObservationsByInstrument.get(instrument.instrumentId) ?? [];
    if (trades.length < 2) return [];
    const events = trades.map((observation) => scenario.stream.find((candidate) => candidate.event_id === observation.observation_id.replace('obs-', '')) as StreamEvent);
    const first = events[0].payload as { readonly price: string };
    const last = events[events.length - 1].payload as { readonly price: string };
    const moves: string[] = [];
    for (let i = 1; i < events.length; i += 1) {
      const previous = events[i - 1].payload as { readonly price: string };
      const current = events[i].payload as { readonly price: string };
      moves.push(decimalAt(decimalDivide(decimalSubtract(current.price, previous.price, 8, 'half-even'), previous.price, 8, 'half-even'), 6, 'half-even'));
    }
    const netMoveRatio = decimalAt(decimalDivide(decimalSubtract(last.price, first.price, 8, 'half-even'), first.price, 8, 'half-even'), 6, 'half-even');
    const meanAbsChangeRatio = decimalMean(moves.map((move) => (move.startsWith('-') ? move.slice(1) : move)), 6, 'half-even');
    const label = compareDecimal(netMoveRatio, '0.008') >= 0 ? 'trending-up' : compareDecimal(netMoveRatio, '-0.008') <= 0 ? 'trending-down' : compareDecimal(meanAbsChangeRatio, '0.01') >= 0 ? 'volatile' : 'ranging';
    return [
      deepFreeze({
        classificationId: `rc-${String(index + 1).padStart(4, '0')}`,
        scope: { instrument: instrument.instrumentId, venue: instrument.venueId },
        label,
        netMoveRatio,
        meanAbsChangeRatio,
        window: { from: events[0].event_time, to: events[events.length - 1].event_time },
        observationCount: trades.length,
        evidence: trades.map((observation) => citationOf(observation)),
        confidence: { methodId: 'method/regime/confidence', methodVersion: '1.0.0', level: 'moderate' as const, evidenceCount: trades.length, dispersion: null },
        asOf: instants.researchAsOf,
        methodId: 'method/regime/classification',
        methodVersion: '1.0.0',
        bodyVersion: 'regime-researcher@1.0.0',
        tenantId: scenario.tenant,
        projectId: scenario.project,
        seed: seeds.world,
      }),
    ];
  });
  const regimeContent = {
    asOf: instants.researchAsOf,
    bodyVersion: 'regime-researcher@1.0.0',
    methodId: 'method/regime/report',
    methodVersion: '1.0.0',
    tenantId: scenario.tenant,
    projectId: scenario.project,
    seed: seeds.world,
    classifications: regimeClassifications,
    changes: [],
    summary: {
      classificationCount: regimeClassifications.length,
      changeCount: 0,
      instrumentCount: new Set(regimeClassifications.map((classification) => classification.scope.instrument)).size,
      windowCount: regimeClassifications.length,
      dominantRegime: 'trending-up',
      meanNetMoveRatio: regimeClassifications.length > 0 ? decimalMean(regimeClassifications.map((classification) => classification.netMoveRatio), 6, 'half-even') : null,
      coverage: { observationsOffered: [...tradeObservationsByInstrument.values()].flat().length, observationsAdmitted: [...tradeObservationsByInstrument.values()].flat().length, observationsDeferred: 0, observationsUnsupported: 0, observationsInvalid: 0 },
      dataGaps: [],
    },
  };
  const regimeReport: RegimeReportMirror = deepFreeze({
    ...regimeContent,
    reportId: `rr-${stableDigest(canonicalJson(regimeContent as unknown as JsonValue))}`,
  });

  // Fundamental: stance assessments from fundamental events.
  const fundamentalAssessments = fundamentalObservations.map((observation, index) => {
    const event = scenario.stream.find((candidate) => candidate.event_id === observation.observation_id.replace('obs-', '')) as StreamEvent;
    const payload = event.payload as { readonly field: string; readonly period: string; readonly value: string };
    const value = Number(payload.value);
    const direction: 'positive' | 'negative' | 'neutral' = value >= 0.7 ? 'positive' : value <= 0.3 ? 'negative' : 'neutral';
    return deepFreeze({
      assessmentId: `fa-${String(index + 1).padStart(4, '0')}`,
      scope: { instrument: event.instrument, series: payload.field },
      assessmentKind: 'health-indicator' as const,
      stance: { methodId: 'method/fundamental/stance', methodVersion: '1.0.0', direction, score: payload.value },
      confidence: { methodId: 'method/fundamental/confidence', methodVersion: '1.0.0', level: 'moderate' as const, evidenceCount: 1, dispersion: null },
      evidence: [citationOf(observation)],
      asOf: instants.researchAsOf,
      bodyVersion: 'fundamental-researcher@1.0.0',
      tenantId: scenario.tenant,
      projectId: scenario.project,
      seed: seeds.world,
    });
  });
  const fundamentalContent = {
    asOf: instants.researchAsOf,
    bodyVersion: 'fundamental-researcher@1.0.0',
    methodId: 'method/fundamental/report',
    methodVersion: '1.0.0',
    tenantId: scenario.tenant,
    projectId: scenario.project,
    seed: seeds.world,
    assessments: fundamentalAssessments,
    actionDigests: [],
    summary: {
      assessmentCount: fundamentalAssessments.length,
      actionDigestCount: 0,
      instrumentCount: new Set(fundamentalAssessments.map((assessment) => assessment.scope.instrument)).size,
      dominantStance: 'positive',
      meanStanceScore: fundamentalAssessments.length > 0 ? decimalMean(fundamentalAssessments.map((assessment) => assessment.stance.score), 4, 'half-even') : null,
      coverage: { observationsOffered: fundamentalObservations.length, observationsAdmitted: fundamentalObservations.length, observationsDeferred: 0, observationsUnsupported: 0, observationsInvalid: 0 },
      dataGaps: scenario.universe
        .filter((instrument) => !fundamentalAssessments.some((assessment) => assessment.scope.instrument === instrument.instrumentId))
        .map((instrument) => ({ kind: 'no-fundamental-observations', instrument: instrument.instrumentId, series: 'ALL' })),
    },
  };
  const fundamentalReport: FundamentalReportMirror = deepFreeze({
    ...fundamentalContent,
    reportId: `frr-${stableDigest(canonicalJson(fundamentalContent as unknown as JsonValue))}`,
  });

  // Cross-market: co-movement relationships over instrument pairs.
  const pairs: readonly [string, string][] = [['BTC-USD', 'ETH-USD'], ['BTC-USD', 'SOL-USD']];
  const relationships = pairs.flatMap((pair, index) => {
    const leftClassification = regimeClassifications.find((classification) => classification.scope.instrument === pair[0]);
    const rightClassification = regimeClassifications.find((classification) => classification.scope.instrument === pair[1]);
    if (leftClassification === undefined || rightClassification === undefined) return [];
    const leftSign = compareDecimal(leftClassification.netMoveRatio, '0') > 0 ? 1 : compareDecimal(leftClassification.netMoveRatio, '0') < 0 ? -1 : 0;
    const rightSign = compareDecimal(rightClassification.netMoveRatio, '0') > 0 ? 1 : compareDecimal(rightClassification.netMoveRatio, '0') < 0 ? -1 : 0;
    const direction = leftSign !== 0 && leftSign === rightSign ? 'positive' : leftSign === 0 || rightSign === 0 ? 'no-lead' : 'divergent';
    const leftTrades = tradeObservationsByInstrument.get(pair[0]) ?? [];
    const rightTrades = tradeObservationsByInstrument.get(pair[1]) ?? [];
    return [
      deepFreeze({
        relationshipId: `cmr-${String(index + 1).padStart(4, '0')}`,
        pair: {
          left: { venue: 'REFSIM', instrument: pair[0], assetClass: 'crypto', series: 'trade.close' },
          right: { venue: 'REFSIM', instrument: pair[1], assetClass: 'crypto', series: 'trade.close' },
        },
        relationKind: 'co-movement' as const,
        measure: { methodId: 'method/crossmarket/measure', methodVersion: '1.0.0', direction, score: decimalMean([leftClassification.netMoveRatio, rightClassification.netMoveRatio], 6, 'half-even') },
        window: { from: Math.min(...[...leftTrades, ...rightTrades].map((observation) => observation.available_time)), to: Math.max(...[...leftTrades, ...rightTrades].map((observation) => observation.available_time)) },
        confidence: { methodId: 'method/crossmarket/confidence', methodVersion: '1.0.0', level: 'low' as const, evidenceCount: leftTrades.length + rightTrades.length, legImbalance: Math.abs(leftTrades.length - rightTrades.length) },
        evidence: [
          ...leftTrades.map((observation) => deepFreeze({ leg: 'left' as const, observationId: observation.observation_id, availableTime: observation.available_time, provenance: { origin: 'historical' as const, adapter: { id: 'adapter-binance', version: '0.0.0' }, derived_from: [], transform: null } })),
          ...rightTrades.map((observation) => deepFreeze({ leg: 'right' as const, observationId: observation.observation_id, availableTime: observation.available_time, provenance: { origin: 'historical' as const, adapter: { id: 'adapter-binance', version: '0.0.0' }, derived_from: [], transform: null } })),
        ],
        asOf: instants.researchAsOf,
        bodyVersion: 'cross-market-researcher@1.0.0',
        tenantId: scenario.tenant,
        projectId: scenario.project,
        seed: seeds.world,
      }),
    ];
  });
  const crossMarketContent = {
    asOf: instants.researchAsOf,
    bodyVersion: 'cross-market-researcher@1.0.0',
    methodId: 'method/crossmarket/report',
    methodVersion: '1.0.0',
    tenantId: scenario.tenant,
    projectId: scenario.project,
    seed: seeds.world,
    relationships,
    summary: {
      relationshipCount: relationships.length,
      pairCount: relationships.length,
      instrumentCount: new Set(relationships.flatMap((relationship) => [relationship.pair.left.instrument, relationship.pair.right.instrument])).size,
      dominantRelationKind: 'co-movement',
      meanMeasureScore: relationships.length > 0 ? decimalMean(relationships.map((relationship) => relationship.measure.score), 6, 'half-even') : null,
      coverage: { observationsOffered: relationships.length * 4, observationsAdmitted: relationships.reduce((acc, relationship) => acc + relationship.evidence.length, 0), observationsDeferred: 0, observationsUnsupported: 0, observationsInvalid: 0 },
      dataGaps: [],
    },
  };
  const crossMarketReport: CrossMarketReportMirror = deepFreeze({
    ...crossMarketContent,
    reportId: `cmrr-${stableDigest(canonicalJson(crossMarketContent as unknown as JsonValue))}`,
  });

  const intake: ResearchIntakeMirror = deepFreeze({
    sentiment: sentimentReport,
    regime: regimeReport,
    fundamental: fundamentalReport,
    crossMarket: crossMarketReport,
  });
  const reportEntries = new Map<string, string>();
  const reportPublication = (report: { readonly reportId: string }, actor: string, topic: string): void => {
    const parents = [
      viewEntry.entryId,
      instanceEntries.find((instance) => instance.id === actor)?.entryId ?? viewEntry.entryId,
    ];
    const entry = ledgerAppend(ledger, 'research', 'research-report', report.reportId, scenario, instants.researchAsOf, parents);
    ledger = entry.ledger;
    reportEntries.set(report.reportId, entry.entryId);
    const opId = kernel.record('PUBLISH', actor, instants.researchAsOf, topic, `report:${report.reportId}`);
    kernel.publish(opId, actor, topic, `report:${report.reportId}`, instants.researchAsOf);
  };
  reportPublication(sentimentReport, sentimentInstance.id, 'research.sentiment');
  reportPublication(regimeReport, regimeInstance.id, 'research.regime');
  reportPublication(fundamentalReport, fundamentalInstance.id, 'research.fundamental');
  reportPublication(crossMarketReport, crossMarketInstance.id, 'research.crossmarket');

  // -- Stage 6: the Trading Director (T024 composition) ---------------------
  const directorInstance = instances[4];
  const directorComposition = composeDirectorDecision({
    asOf: instants.decisionAsOf,
    goal: { goalId: scenario.goal.id, version: scenario.goal.version },
    constraintSets: [{ id: scenario.constraintSet.id, version: scenario.constraintSet.version }],
    tenantId: scenario.tenant,
    projectId: scenario.project,
    seed: seeds.director,
    methodId: 'method/director/synthesis',
    registry: DIRECTOR_METHOD_REGISTRY,
    bodyVersion: 'trading-director@1.0.0',
    intake,
  });
  if (!directorComposition.ok) {
    throw new Error(`director composition failed: ${directorComposition.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
  }
  const directorOutcome = directorComposition.value;
  if (directorOutcome.kind === 'escalation') {
    throw new Error('director composition escalated in the reference scenario (quorum/conflict) — the reference expects a decision');
  }
  const decision = directorOutcome.decision;
  const directorDecisionRef = decision.decisionId;
  const directorEntry = ledgerAppend(
    ledger,
    'director',
    'director-decision',
    decision.decisionId,
    scenario,
    instants.decisionAsOf,
    [
      goalEntry.entryId,
      constraintEntry.entryId,
      directorInstance !== undefined ? instanceEntries[4].entryId : goalEntry.entryId,
      ...decision.inputs.map((input) => reportEntries.get(input.reportId) ?? viewEntry.entryId),
    ],
  );
  ledger = directorEntry.ledger;
  {
    const opId = kernel.record('PUBLISH', directorInstance.id, instants.decisionAsOf, 'directors.decisions', `decision:${decision.decisionId}`);
    kernel.publish(opId, directorInstance.id, 'directors.decisions', `decision:${decision.decisionId}`, instants.decisionAsOf);
  }

  // -- Stage 7: the strategist (T018 composition) ----------------------------
  const strategistInstance = instances[5];
  const directive = decision.directive.kind === 'allocation-adjustment' ? decision.directive : null;
  const universe = scenario.universe.map((instrument) => ({
    instrumentId: instrument.instrumentId,
    venueId: instrument.venueId,
    lotSize: instrument.lotSize,
    tickSize: instrument.tickSize,
  }));
  const baseSpecForWeights = { universe, allocation: { kind: 'equal_weight' } } as unknown as StrategySpecMirror;
  const baseWeights = baseTargetWeights(baseSpecForWeights, 4);
  const weightsWithDirective = baseWeights.map((entry) => {
    const adjustment = directive?.adjustments.find((candidate) => candidate.instrumentId === entry.instrumentId);
    if (adjustment === undefined) return entry;
    return { instrumentId: entry.instrumentId, weight: decimalAt(decimalSum([entry.weight, adjustment.deltaWeight], 4, 'half-even'), 4, 'half-even') };
  });
  const spec: StrategySpecMirror = deepFreeze({
    specId: 'spec/e2e-reference',
    version: 1,
    tenant: scenario.tenant,
    project: scenario.project,
    goal: scenario.goal.id,
    name: 'e2e-reference-equal-weight-with-directive',
    universe,
    allocation: { kind: 'fixed_weights', weights: weightsWithDirective },
    rebalancing: { trigger: 'drift_band', band: '0.05', cadenceMs: 3_600_000 },
    priceDiscipline: { kind: 'limit', anchor: 'last_trade' },
    riskPolicyRefs: ['rpol:e2e-reference'],
    generators: [],
    decimalPrecision: 4,
    organization: { organizationId: organization.id, assignmentRefs: blueprint.assignments.map((assignment) => assignment.slotId) },
    createdAt: instants.t0,
    description: 'Equal-weight base bound with the director directive delta on BTC-USD.',
  });
  const windowEvents: readonly MarketEventMirror[] = view.records.map((record) => {
    const event = scenario.stream.find((candidate) => candidate.event_id === record.record_id) as StreamEvent;
    if (event.event_type !== 'trade') {
      return {
        event_id: event.event_id,
        venue: event.venue,
        instrument: event.instrument,
        asset_class: event.asset_class,
        event_type: 'quote' as const,
        event_time: event.event_time,
        source_time: event.source_time,
        available_time: event.available_time,
        ingestion_time: event.ingestion_time,
        sequence: event.sequence,
        provider: event.provider,
        provenance: { origin: 'historical' as const, adapter: event.provenance.adapter, derived_from: [], transform: null },
        payload: { bid_price: '0', bid_size: '0', ask_price: '0', ask_size: '0' },
      };
    }
    return {
      event_id: event.event_id,
      venue: event.venue,
      instrument: event.instrument,
      asset_class: event.asset_class,
      event_type: 'trade' as const,
      event_time: event.event_time,
      source_time: event.source_time,
      available_time: event.available_time,
      ingestion_time: event.ingestion_time,
      sequence: event.sequence,
      provider: event.provider,
      provenance: { origin: 'historical' as const, adapter: event.provenance.adapter, derived_from: [], transform: null },
      payload: event.payload as { readonly price: string; readonly size: string; readonly side: 'buy' | 'sell' },
    };
  });
  const window: ObservationWindowMirror = deepFreeze({
    window_id: 'window/research@1',
    events: windowEvents,
    asOf: instants.strategyAsOf,
    starts_at: instants.t0,
    ends_at: instants.strategyAsOf,
  });
  const strategyLineage = {
    strategy: { specId: spec.specId, version: spec.version },
    goal: { goalId: scenario.goal.id, version: scenario.goal.version },
    constraintSet: { id: scenario.constraintSet.id, version: scenario.constraintSet.version },
    windowId: window.window_id,
    seed: seeds.strategy,
    tenant: scenario.tenant,
    project: scenario.project,
  };
  const initialState = initialPortfolioState(strategyLineage, scenario.initialCash, instants.t0);
  const strategyCompilation = compileStrategyRun({
    spec,
    state: initialState,
    window,
    constraintSet: scenario.constraintSet,
    goal: scenario.goal,
    seed: seeds.strategy,
    directorDecisionRef: decision.decisionId,
  });
  if (!strategyCompilation.ok) {
    throw new Error(`strategy compilation failed: ${strategyCompilation.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
  }
  const strategyRun = strategyCompilation.value;
  const specEntry = ledgerAppend(ledger, 'strategy', 'strategy-spec', `${spec.specId}@${String(spec.version)}`, scenario, spec.createdAt, [directorEntry.entryId, goalEntry.entryId, constraintEntry.entryId, instanceEntries[5].entryId]);
  ledger = specEntry.ledger;
  const strategyRunEntry = ledgerAppend(ledger, 'strategy', 'strategy-run', strategyRun.runId, scenario, instants.strategyAsOf, [specEntry.entryId, directorEntry.entryId]);
  ledger = strategyRunEntry.ledger;
  const intentEntries = new Map<string, string>();
  for (const intent of strategyRun.intents) {
    const entry = ledgerAppend(ledger, 'strategy', 'strategy-intent', intent.intentId, scenario, instants.strategyAsOf, [strategyRunEntry.entryId]);
    ledger = entry.ledger;
    intentEntries.set(intent.intentId, entry.entryId);
    const opId = kernel.record('PUBLISH', strategistInstance.id, instants.strategyAsOf, 'strategy.intents', `intent:${intent.intentId}`);
    kernel.publish(opId, strategistInstance.id, 'strategy.intents', `intent:${intent.intentId}`, instants.strategyAsOf);
  }

  // -- Stage 8: risk + the execution gateway (T040 gate stack) --------------
  const policy = scenario.executionPolicy;
  const riskPolicy = scenario.riskPolicy;
  const evaluations: LimitEvaluationRecordMirror[] = [];
  const decisions: ExecutionDecisionMirror[] = [];
  const auditRecords: GatewayAuditRecordMirror[] = [];
  const submissions: GatewaySubmissionRecordMirror[] = [];
  let auditChainHead = fnv1a32Hex(canonicalJson({ tenant: scenario.tenant, project: scenario.project, records: 0 } as unknown as JsonValue));
  let auditSequence = 0;
  let engineFillCounter = 0;
  const reactiveFills: ReactiveFillRecordMirror[] = [];
  const orderClocks = new Map<string, { prepare: number; submit: number; acknowledge: number; fill: number }>();
  const engineFills: FillMirror[] = [];

  // The injected paper-exchange adapter port (the venue side of L8: it
  // re-checks the decision before anything reaches an engine).
  const paperAdapter: OrderRoutingPortMirror = {
    routeOrder(routing: RoutingBundleMirror): RoutingSendResult {
      const decisionRecord = routing.decision;
      if (
        typeof decisionRecord !== 'object' ||
        decisionRecord === null ||
        (decisionRecord as { kind?: unknown }).kind !== 'approve' ||
        !(decisionRecord as { decisionId?: unknown }).decisionId ||
        !String((decisionRecord as { decisionId?: unknown }).decisionId).startsWith('xd:')
      ) {
        return {
          ok: false,
          error: { kind: 'entitlement', code: 'decision_not_approved', message: 'the venue adapter requires a VALID APPROVED decision — L8: the model never bypasses the gate' },
        };
      }
      const intent = routing.intent as { instrumentId?: string; venueId?: string; side?: string; kind?: string; quantity?: string; price?: string; timeInForce?: string; clientOrderId?: string; createdAt?: string };
      const engine = engines.get(String(intent.instrumentId));
      if (engine === undefined) {
        return { ok: false, error: { kind: 'protocol', code: 'wrong_instrument', message: `no engine bound for instrument ${String(intent.instrumentId)}` } };
      }
      const decisionIndex = decisions.length - 1;
      const submitAt = instants.orderClockBase + 500 * decisionIndex + 110;
      const outcome = submitOrderMirror(
        engine,
        deepFreeze({
          clientOrderId: String(intent.clientOrderId),
          instrumentId: String(intent.instrumentId),
          venueId: String(intent.venueId),
          side: intent.side === 'sell' ? 'sell' : 'buy',
          kind: intent.kind === 'market' ? 'market' : 'limit',
          quantity: String(intent.quantity),
          ...(intent.price !== undefined ? { price: String(intent.price) } : {}),
          timeInForce: (intent.timeInForce ?? 'gtc') as 'day' | 'gtc' | 'ioc' | 'fok' | 'gtt',
          createdAt: String(intent.createdAt),
        }),
        submitAt,
      );
      if (!outcome.ok) {
        return { ok: false, error: { kind: 'protocol', code: outcome.errors[0].code, message: outcome.errors[0].message } };
      }
      engines.set(String(intent.instrumentId), outcome.value.state);
      for (const fill of outcome.value.fills) {
        engineFills.push(fill);
        engineFillCounter += 1;
        const hash = engineConfigHashes.find((candidate) => candidate.instrumentId === fill.instrument)?.hash ?? '';
        reactiveFills.push(
          deepFreeze({
            fill,
            fill_id: fill.fill_id,
            episode_id: 'episode/e2e-1',
            run_ref: 'run/e2e-reactive-1',
            taker_participant: 'agent/e2e-execution',
            taker_order_id: fill.taker_order_id,
            maker_order_id: fill.maker_order_id,
            physics: {
              engine_config_hash: hash,
              fee_policy: scenario.worldConfig.physics_refs.fee_policy,
              latency_policy: scenario.worldConfig.physics_refs.latency_policy,
              slippage_policy: scenario.worldConfig.physics_refs.slippage_policy,
              impact_policy: scenario.worldConfig.physics_refs.impact_policy,
              run_ref: 'run/e2e-reactive-1',
              tenant: scenario.tenant,
              project: scenario.project,
            },
          }),
        );
      }
      orderClocks.set(String((routing.decision as { intentRef?: unknown }).intentRef), {
        prepare: instants.orderClockBase + 500 * decisionIndex + 100,
        submit: submitAt,
        acknowledge: submitAt + 10,
        fill: submitAt + 260,
      });
      return { ok: true, value: null };
    },
  };

  for (const intent of strategyRun.intents) {
    const intentDigest = contentDigest8({ intentId: intent.intentId, asOf: intent.asOf });
    const instrumentState = {
      venue: intent.order.venueId,
      instrument: intent.order.instrumentId,
      instrumentClass: 'crypto',
      referencePrice: markPriceOfWindow(window, intent.order.instrumentId)?.price ?? '0',
      rateWindowOrderCount: decisions.length,
    };
    const evaluation = evaluateLimitsMirror({
      policy: riskPolicy,
      killSwitchState: 'standing',
      order: { instrumentClass: 'crypto', quantity: intent.order.quantity, price: intent.order.price ?? instrumentState.referencePrice, side: intent.order.side },
      positionQuantity: '0',
      intentRef: intent.intentId,
      goal: { goalId: scenario.goal.id, version: scenario.goal.version },
      tenant: scenario.tenant,
      project: scenario.project,
      asOf: instants.strategyAsOf,
      digest: intentDigest,
    });
    evaluations.push(evaluation);
    const gate = runExecutionGateMirror({
      intent: {
        intentId: intent.intentId,
        tenant: intent.tenant,
        project: intent.project,
        order: {
          instrumentId: intent.order.instrumentId,
          venueId: intent.order.venueId,
          side: intent.order.side,
          kind: intent.order.kind,
          quantity: intent.order.quantity,
          price: intent.order.price,
        },
        strategy: intent.strategy,
        goal: intent.goal,
        seed: intent.seed,
      },
      policy,
      portfolio: {
        positionOf: () => '0',
        equity: scenario.initialCash,
      },
      venueState: { asOf: instants.strategyAsOf, instruments: [instrumentState] },
      killSwitch: { state: 'standing', switchId: null, thrownAt: null, reason: null },
      digestOf: () => intentDigest,
    });
    decisions.push(gate);
    const evaluationEntry = ledgerAppend(ledger, 'risk-gateway', 'limit-evaluation', evaluation.evaluationId, scenario, instants.strategyAsOf, [intentEntries.get(intent.intentId) as string]);
    ledger = evaluationEntry.ledger;
    const decisionEntry = ledgerAppend(ledger, 'risk-gateway', 'gate-decision', gate.decisionId, scenario, instants.strategyAsOf, [evaluationEntry.entryId]);
    ledger = decisionEntry.ledger;

    if (gate.kind !== 'approve') {
      // A refusal is a RECORD (never an exception): audit + submission refused, ZERO adapter calls.
      auditSequence += 1;
      const auditContent = {
        sequence: auditSequence,
        who: { bodyVersion: intent.strategy, intentRef: intent.intentId, decisionId: gate.decisionId, decisionKind: 'refuse' as const, clientOrderId: intent.order.clientOrderId },
        substrate: scenario.substrate,
        policy: { policyId: policy.policyId, version: policy.version },
        visibleState: { ...instrumentState, rateWindowOrderCount: decisions.length - 1, riskExposureRef: evaluation.evaluationId },
        riskChecks: { evaluationId: evaluation.evaluationId, riskPolicy: { policyId: riskPolicy.policyId, version: riskPolicy.version }, within: evaluation.states.filter((state) => state.state === 'within').length, breaching: 0, blocked: evaluation.states.filter((state) => state.state === 'blocked').length },
        order: null,
        execution: null,
        outcome: 'refused' as const,
        refusal: { stage: 'policy_gate' as const, code: gate.failure.dimension, detail: gate.failure.reason },
        lineage: gate.lineage,
        tenant: scenario.tenant,
        project: scenario.project,
        asOf: instants.strategyAsOf,
      };
      auditChainHead = fnv1a32Hex(auditChainHead + canonicalJson(auditContent as unknown as JsonValue));
      const auditRecord: GatewayAuditRecordMirror = deepFreeze({ ...auditContent, auditId: mintGatewayAuditRecordId(contentDigest8(auditContent)), chainHead: auditChainHead });
      auditRecords.push(auditRecord);
      submissions.push(
        deepFreeze({
          kind: 'refused',
          submissionId: mintGatewaySubmissionId(contentDigest8({ decisionId: gate.decisionId, refusedAt: instants.strategyAsOf })),
          decisionId: gate.decisionId,
          auditId: auditRecord.auditId,
          refusal: { stage: 'policy_gate' as const, detail: gate.failure },
          refusedAt: instants.strategyAsOf,
        }),
      );
      const auditEntry = ledgerAppend(ledger, 'risk-gateway', 'gateway-audit-record', auditRecord.auditId, scenario, instants.strategyAsOf, [decisionEntry.entryId]);
      ledger = auditEntry.ledger;
      const refusalSubmissionEntry = ledgerAppend(ledger, 'risk-gateway', 'gateway-submission', submissions[submissions.length - 1].submissionId, scenario, instants.strategyAsOf, [auditEntry.entryId]);
      ledger = refusalSubmissionEntry.ledger;
      continue;
    }

    // The translation contract (opacity + forgery law + coherence), then the
    // injected adapter call — exactly one, only after all gates passed.
    const translation = gatewayTranslate(gate, intent, scenario);
    if (!translation.ok) {
      throw new Error(`gateway translation failed: ${translation.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
    }
    const decisionIndex = decisions.length - 1;
    const routedAt = instants.orderClockBase + 500 * decisionIndex + 110;
    const send = paperAdapter.routeOrder({
      decision: gate,
      intent: intent.order,
      kill_switch: { state: 'standing' },
      credential_ref: 'cred:refsim/e2e-reference@1',
      route: { venue: intent.order.venueId, credential_ref: 'cred:refsim/e2e-reference@1' },
    });
    auditSequence += 1;
    const auditContent = {
      sequence: auditSequence,
      who: { bodyVersion: intent.strategy, intentRef: intent.intentId, decisionId: gate.decisionId, decisionKind: 'approve' as const, clientOrderId: intent.order.clientOrderId },
      substrate: scenario.substrate,
      policy: { policyId: policy.policyId, version: policy.version },
      visibleState: { ...instrumentState, rateWindowOrderCount: decisions.length - 1, riskExposureRef: evaluation.evaluationId },
      riskChecks: { evaluationId: evaluation.evaluationId, riskPolicy: { policyId: riskPolicy.policyId, version: riskPolicy.version }, within: evaluation.states.filter((state) => state.state === 'within').length, breaching: 0, blocked: evaluation.states.filter((state) => state.state === 'blocked').length },
      order: { adapterRef: 'adapter:paper-exchange@1.0.0', channelRef: 'chan:refsim-orders', credentialRef: 'cred:refsim/e2e-reference@1', clientOrderId: intent.order.clientOrderId, requestRef: translation.value.requestRef },
      execution: { routed: send.ok, submissionAt: routedAt, messageDigest: send.ok ? contentDigest8({ decisionId: gate.decisionId, clientOrderId: intent.order.clientOrderId }) : null },
      outcome: (send.ok ? 'routed' : 'refused') as 'routed' | 'refused',
      refusal: send.ok ? null : { stage: 'adapter' as const, code: send.error.code, detail: send.error.message },
      lineage: gate.lineage,
      tenant: scenario.tenant,
      project: scenario.project,
      asOf: instants.strategyAsOf,
    };
    auditChainHead = fnv1a32Hex(auditChainHead + canonicalJson(auditContent as unknown as JsonValue));
    const auditRecord: GatewayAuditRecordMirror = deepFreeze({ ...auditContent, auditId: mintGatewayAuditRecordId(contentDigest8(auditContent)), chainHead: auditChainHead });
    auditRecords.push(auditRecord);
    const submission: GatewaySubmissionRecordMirror = send.ok
      ? deepFreeze({
          kind: 'routed',
          submissionId: mintGatewaySubmissionId(contentDigest8({ decisionId: gate.decisionId, routedAt })),
          decisionId: gate.decisionId,
          auditId: auditRecord.auditId,
          requestRef: translation.value.requestRef,
          venue: intent.order.venueId,
          adapterRef: 'adapter:paper-exchange@1.0.0',
          channelRef: 'chan:refsim-orders',
          routedAt,
        })
      : deepFreeze({
          kind: 'refused',
          submissionId: mintGatewaySubmissionId(contentDigest8({ decisionId: gate.decisionId, refusedAt: routedAt })),
          decisionId: gate.decisionId,
          auditId: auditRecord.auditId,
          refusal: { stage: 'adapter' as const, detail: send.error },
          refusedAt: routedAt,
        });
    submissions.push(submission);
    const auditEntry = ledgerAppend(ledger, 'risk-gateway', 'gateway-audit-record', auditRecord.auditId, scenario, instants.strategyAsOf, [decisionEntry.entryId]);
    ledger = auditEntry.ledger;
    const submissionEntry = ledgerAppend(ledger, 'risk-gateway', 'gateway-submission', submission.submissionId, scenario, instants.strategyAsOf, [auditEntry.entryId]);
    ledger = submissionEntry.ledger;
    const opId = kernel.record('REQUEST', instances[6].id, routedAt, 'execution.gateway-verdicts', `decision:${gate.decisionId}`);
    kernel.publish(opId, instances[6].id, 'execution.gateway-verdicts', `decision:${gate.decisionId}`, routedAt);
    if (!send.ok) {
      throw new Error(`gateway adapter refused intent ${intent.intentId}: ${send.error.code} ${send.error.message}`);
    }
  }

  // -- Stage 9: the execution body (order lifecycle on its own clock) -------
  const logs: OrderLifecycleLogMirror[] = [];
  const reconciliations: ReconciliationRecordMirror[] = [];
  const approvedDecisions = decisions.filter((decision): decision is ApproveDecisionMirror => decision.kind === 'approve');
  approvedDecisions.forEach((decision, index) => {
    const intent = strategyRun.intents.find((candidate) => candidate.intentId === decision.intentRef);
    if (intent === undefined) throw new Error(`execution: no intent for decision ${decision.decisionId}`);
    const intakeResult = acceptExecutionIntakeMirror(
      { decision, intent, killSwitch: { state: 'standing', switchId: null, thrownAt: null, reason: null }, limitStates: [], directorDecision: decision.decisionId },
      { tenant: scenario.tenant, project: scenario.project },
      instants.orderClockBase + 500 * index + 90,
    );
    if (!intakeResult.ok) {
      throw new Error(`execution intake failed for ${decision.decisionId}: ${intakeResult.errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
    }
    const clocks = orderClocks.get(decision.intentRef) ?? { prepare: instants.orderClockBase + 500 * index + 100, submit: instants.orderClockBase + 500 * index + 110, acknowledge: instants.orderClockBase + 500 * index + 120, fill: instants.orderClockBase + 500 * index + 370 };
    const prepared = prepareOrderMirror({
      decisionRef: decision.decisionId,
      decisionAsOf: decision.asOf,
      intentRef: intent.intentId,
      directorDecision: directorDecisionRef,
      orderRef: `e2e-${String(index + 1)}`,
      venue: intent.order.venueId,
      instrument: intent.order.instrumentId,
      side: intent.order.side,
      orderKind: intent.order.kind,
      quantity: intent.order.quantity,
      orderClock: clocks.prepare,
      methodId: 'method/execution/order-preparation',
      methodVersion: '1.0.0',
      tenant: scenario.tenant,
      project: scenario.project,
    });
    if (!prepared.ok) throw new Error(`order preparation failed: ${prepared.errors.map((error) => error.code).join(', ')}`);
    let log = prepared.value;
    const submitResult = appendOrderLifecycleEventMirror(log, { event: 'submit', orderClock: clocks.submit, methodId: 'method/execution/order-preparation', methodVersion: '1.0.0', killSwitch: { state: 'standing' } });
    if (!submitResult.ok) throw new Error(`submit failed: ${submitResult.errors.map((error) => error.code).join(', ')}`);
    log = submitResult.value;
    const acknowledgeResult = appendOrderLifecycleEventMirror(log, { event: 'acknowledge', orderClock: clocks.acknowledge, methodId: 'method/execution/order-preparation', methodVersion: '1.0.0' });
    if (!acknowledgeResult.ok) throw new Error(`acknowledge failed: ${acknowledgeResult.errors.map((error) => error.code).join(', ')}`);
    log = acknowledgeResult.value;
    const orderFills = reactiveFills.filter((fill) => fill.fill.instrument === intent.order.instrumentId);
    if (orderFills.length > 0) {
      const fillEvent = orderFills.reduce((acc, fill) => (fill.fill.quartet.available_time > acc ? fill.fill.quartet.available_time : acc), clocks.fill);
      const cumulative = decimalSum(orderFills.map((fill) => fill.fill.quantity), 8, 'half-even');
      const complete = compareDecimal(cumulative, intent.order.quantity) >= 0;
      const draft = {
        event: (complete ? 'fill-complete' : 'partial-fill') as 'fill-complete' | 'partial-fill',
        orderClock: fillEvent + 1,
        fills: orderFills.map((fill, fillIndex) => deepFreeze({ fillRef: mintOrdinalId('xsf-', index * 10 + fillIndex + 1), quantity: fill.fill.quantity, orderClock: fill.fill.quartet.available_time })),
        methodId: 'method/execution/fill-reconciliation',
        methodVersion: '1.0.0',
      };
      const fillResult = appendOrderLifecycleEventMirror(log, draft);
      if (!fillResult.ok) throw new Error(`fill append failed: ${fillResult.errors.map((error) => error.code).join(', ')}`);
      log = fillResult.value;
    }
    logs.push(log);
    const reconciliation = reconcileFillsMirror(log, clocks.fill + 10, 'method/execution/fill-reconciliation', '1.0.0');
    reconciliations.push(reconciliation.record);
    if (reconciliation.violations.length > 0) {
      throw new Error(`reconciliation gap on ${log.orderRef}: ${reconciliation.violations.map((violation) => violation.message).join('; ')}`);
    }
    const lifecycleEntryIds: string[] = [];
    for (const record of log.records) {
      const entry = ledgerAppend(ledger, 'execution', `order-lifecycle-${record.event}`, record.lifecycleId, scenario, record.orderClock, [intentEntries.get(intent.intentId) as string]);
      ledger = entry.ledger;
      lifecycleEntryIds.push(entry.entryId);
    }
    const reconciliationEntry = ledgerAppend(ledger, 'execution', 'reconciliation-record', reconciliation.record.reconciliationId, scenario, reconciliation.record.orderClock, lifecycleEntryIds);
    ledger = reconciliationEntry.ledger;
  });

  // -- Stage 10: outcomes (the shadow lane settles; L15 closes) -------------
  const sessionId = mintShadowSessionId(contentDigest8({ tenant: scenario.tenant, project: scenario.project, seed: seeds.world }));
  const shadowLineage: ShadowLineageMirror = deepFreeze({
    sessionId,
    fidelity: { mode: 'shadow', fill_origin: 'simulated' },
    executionPolicy: { policyId: policy.policyId, version: policy.version },
    riskPolicy: { policyId: riskPolicy.policyId, version: riskPolicy.version },
    configDigests: { worldConfigHash, engineConfigHash: engineConfigHashes[0].hash, dataset: 'dataset/e2e/reference@1' },
    run: { runId: 'run/e2e-reactive-1', episodeId: 'episode/e2e-1' },
    cursor: { cursorId: 'cur-00000001', position: view.records.length },
    seed: seeds.world,
    tenant: scenario.tenant,
    project: scenario.project,
  });
  let book: ShadowBookMirror = deepFreeze({ positions: [], cash: decimalAt(scenario.initialCash, 8, 'half-even'), realizedPnl: '0', asOf: instants.t0 });
  const shadowFills: ShadowFillMirror[] = [];
  reactiveFills.forEach((fill, index) => {
    book = applyWorldFillMirror(book, fill, instants.fillApplicationAsOf);
    const owningDecision =
      approvedDecisions.find((candidate) => {
        const owningIntent = strategyRun.intents.find((intent) => intent.intentId === candidate.intentRef);
        return owningIntent !== undefined && owningIntent.order.instrumentId === fill.fill.instrument;
      }) ?? approvedDecisions[0];
    shadowFills.push(
      deepFreeze({
        fillId: mintOrdinalId('swf-', index + 1),
        sequence: index + 1,
        worldFill: fill,
        decisionId: owningDecision.decisionId,
        intentRef: owningDecision.intentRef,
        availableAt: fill.fill.quartet.available_time,
        appliedAt: instants.fillApplicationAsOf,
        lineage: shadowLineage,
      }),
    );
  });
  const outcomeRecords: ShadowOutcomeRecordMirror[] = [];
  let outcomeHead = '00000000';
  decisions.forEach((decision, index) => {
    const intent = strategyRun.intents.find((candidate) => candidate.intentId === decision.intentRef);
    if (intent === undefined) return;
    const intentFills = shadowFills.filter((fill) => fill.intentRef === intent.intentId);
    if (decision.kind === 'refuse') {
      // A refusal is a RECORD with a refused-disposition outcome (never silence).
      const refusalContent = {
        ordinal: index + 1,
        intentRef: intent.intentId,
        decisionRef: decision.decisionId,
        refusalRef: mintShadowRefusalId(contentDigest8({ decisionId: decision.decisionId, stage: 'policy_gate' })),
        disposition: 'refused' as const,
        fills: [],
        costs: { feeTotal: '0', notionalTotal: '0' },
        realizedOutcome: '0',
        unrealizedAtDecision: '0',
        priorChainHead: outcomeHead,
        lineage: shadowLineage,
        asOf: instants.outcomeAsOf,
      };
      outcomeHead = fnv1a32Hex(outcomeHead + canonicalJson(refusalContent as unknown as JsonValue));
      outcomeRecords.push(deepFreeze({ ...refusalContent, outcomeId: mintShadowOutcomeRecordId(contentDigest8(refusalContent)) }));
      return;
    }
    const disposition: ShadowOutcomeRecordMirror['disposition'] =
      intentFills.length === 0 ? 'refused' : compareDecimal(decimalSum(intentFills.map((fill) => fill.worldFill.fill.quantity), 8, 'half-even'), intent.order.quantity) >= 0 ? 'filled' : 'partial';
    const feeTotal = decimalSum(intentFills.map((fill) => fill.worldFill.fill.taker_fee), 8, 'half-even');
    const notionalTotal = decimalSum(
      intentFills.map((fill) => decimalMultiply(fill.worldFill.fill.quantity, fill.worldFill.fill.aggressor_price, 8, 'half-even')),
      8,
      'half-even',
    );
    const position = book.positions.find((candidate) => candidate.instrument === intent.order.instrumentId);
    const mark = markPriceOfWindow(window, intent.order.instrumentId)?.price ?? '0';
    const unrealized = position === undefined ? '0' : decimalSubtract(decimalMultiply(position.quantity, mark, 8, 'half-even'), position.costBasis, 8, 'half-even');
    const content = {
      ordinal: index + 1,
      intentRef: intent.intentId,
      decisionRef: decision.decisionId,
      refusalRef: null,
      disposition,
      fills: intentFills.map((fill) => fill.fillId),
      costs: { feeTotal, notionalTotal },
      realizedOutcome: '0',
      unrealizedAtDecision: unrealized,
      priorChainHead: outcomeHead,
      lineage: shadowLineage,
      asOf: instants.outcomeAsOf,
    };
    outcomeHead = fnv1a32Hex(outcomeHead + canonicalJson(content as unknown as JsonValue));
    outcomeRecords.push(deepFreeze({ ...content, outcomeId: mintShadowOutcomeRecordId(contentDigest8(content)) }));
  });
  const outcomeLog: ShadowOutcomeLogMirror = deepFreeze({ records: outcomeRecords, head: outcomeHead });
  for (const fill of shadowFills) {
    const entry = ledgerAppend(ledger, 'outcomes', 'shadow-fill', fill.fillId, scenario, fill.availableAt, [intentEntries.get(fill.intentRef) as string]);
    ledger = entry.ledger;
  }
  for (const record of outcomeRecords) {
    const fillParentIds = record.fills
      .map((fillId) => ledger.entries.find((entry) => entry.recordKind === 'shadow-fill' && entry.recordId === fillId)?.entryId)
      .filter((id): id is string => id !== undefined);
    const entry = ledgerAppend(
      ledger,
      'outcomes',
      'shadow-outcome-record',
      record.outcomeId,
      scenario,
      record.asOf,
      [intentEntries.get(record.intentRef) as string, ...fillParentIds],
    );
    ledger = entry.ledger;
    const opId = kernel.record('REPORT', instances[6].id, instants.outcomeAsOf, 'execution.lifecycle-reports', `outcome:${record.outcomeId}`);
    kernel.publish(opId, instances[6].id, 'execution.lifecycle-reports', `outcome:${record.outcomeId}`, instants.outcomeAsOf);
  }

  // -- Close the ledger (chain-verified) + mint the run ----------------------
  const verification = verifyLedger(ledger);
  if (!verification.ok) {
    throw new Error(`lineage ledger failed verification: ${verification.errors.map((error) => error.message).join('; ')}`);
  }
  const kernelSnapshot = kernel.snapshot();
  const runContent = {
    scenarioId: scenario.scenarioId,
    tenant: scenario.tenant,
    project: scenario.project,
    ledgerHead: ledger.head,
    outcomeHead: outcomeLog.head,
    kernelOpCount: kernelSnapshot.ops.length,
  };
  const runId = `e2e-${stableDigest(canonicalJson(runContent as unknown as JsonValue))}`;
  return deepFreeze({
    runId,
    scenarioId: scenario.scenarioId,
    tenant: scenario.tenant,
    project: scenario.project,
    asOfRange: { from: instants.t0, to: instants.outcomeAsOf },
    stages: {
      scenario: { goal: scenario.goal, constraintSet: scenario.constraintSet },
      organization: { blueprint, organization },
      bodies: { bodies, possessions, instances, kernelOps: kernelSnapshot.ops, envelopes: kernelSnapshot.envelopes },
      marketWorld: { machineRecords, view, engineConfigHashes, observations },
      research: intake,
      director: { outcome: directorOutcome },
      strategy: { spec, state: initialState, run: strategyRun },
      riskGateway: { evaluations, decisions, auditRecords, submissions },
      execution: { logs, reconciliations, engineFills, reactiveFills },
      outcomes: { book, shadowFills, outcomeLog },
    },
    ledger,
  });
}

/** The mark price of an instrument in the strategy window. */
function markPriceOfWindow(window: ObservationWindowMirror, instrument: string): { readonly price: string } | null {
  let lastTrade: string | null = null;
  for (const event of window.events) {
    if (event.instrument !== instrument) continue;
    if (event.event_type === 'trade') lastTrade = event.payload.price;
  }
  return lastTrade === null ? null : { price: lastTrade };
}

/** The gateway translation contract (opacity + forgery law + coherence). */
function gatewayTranslate(
  decision: ApproveDecisionMirror,
  intent: StrategyIntentMirror,
  scenario: ScenarioRecord,
): { readonly ok: true; readonly value: { readonly requestRef: string } } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const errors: { readonly code: string; readonly message: string }[] = [];
  const opacity = [...credentialValueViolations(decision, 'decision'), ...credentialValueViolations(intent.order, 'order')];
  if (opacity.length > 0) errors.push({ code: 'credential_value_present', message: `credential material at ${opacity.join(', ')}` });
  if (mintApproveDecisionId(decision) !== decision.decisionId) {
    errors.push({ code: 'decision_not_approved', message: 'the approve decision id does not match its content (forgery law)' });
  }
  if (!decision.lineage.venues.includes(intent.order.venueId)) {
    errors.push({ code: 'request_incoherent', message: 'the order venue must appear in the decision lineage' });
  }
  if (scenario.tenant !== decision.lineage.tenant) {
    errors.push({ code: 'request_incoherent', message: 'the decision lineage tenant must match the scenario scope (L12)' });
  }
  if (errors.length > 0) return { ok: false, errors: deepFreeze(errors) };
  return {
    ok: true,
    value: deepFreeze({
      requestRef: `gor:${contentDigest8({ decisionId: decision.decisionId, clientOrderId: intent.order.clientOrderId, venue: intent.order.venueId })}`,
    }),
  };
}

// Re-export commonly needed helpers for consumers of the run record.
export { REFERENCE_SCENARIO };
