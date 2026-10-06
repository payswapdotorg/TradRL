// @tradrl/example-e2e-trading — THE RUN ORCHESTRATOR.
//
// Wires the whole pipeline over one scenario (ARCHITECTURE.md core flow,
// made real): goal/constraint compilation -> organization -> bodies +
// possessions -> Agent OS boot -> reactive market world -> point-in-time
// research -> Trading Director decision -> strategy/portfolio
// construction -> risk + authorization through the 13-stage gateway ->
// paper/shadow execution in the simulated exchange -> outcomes with full
// L15 lineage. Every stage appends its artifacts to the chain-verified
// lineage stream; the run is a PURE function of the scenario bytes (the
// determinism law: two runs, byte-identical streams).

import { add, compare, multiply, signedSubtract, subtract } from './decimals';
import { canonicalJson, deepFreeze, fnv1a32Hex, stableDigest8Json, type JsonValue } from './primitives';
import { fail, ok, unwrap, type ExampleResult } from './errors';
import type { TradingScenario } from './scenario';
import { validateTradingScenario } from './scenario';
import {
  appendLineageRecord, artifactDigestOf, lineageStreamDigest, startLineageStream,
  type LineageRecordDraft, type LineageStream,
} from './lineage';
import {
  compileExecutionPolicy, compileRiskPolicy, riskPolicyRefOf, validateConstraintSet,
  validateGoalStatement,
} from './control-plane';
import { compileOrganization, registrySnapshotOf } from './organization';
import { referenceBodies, referenceInstanceIds, referencePossessions } from './bodies';
import { applyKernelOperation, deriveOpId, initialKernelState, type KernelState } from './kernel';
import { referenceEngine } from './engine';
import {
  marksAt, settleWorld, startReactiveWorld, submitWorldAction, worldRunRecord,
  type ReactiveWorld,
} from './world';
import { runResearch, visibleEvents } from './research';
import { composeDirectorDecision, DIRECTOR_METHOD_REGISTRY_MIRROR } from './director';
import type { DirectorDecisionMirror } from './mirrors/director';
import type { ResearchIntakeMirror } from './mirrors/research';
import {
  applyAccountFills, compileStrategyRun, computeWeights, initialPortfolioState,
  portfolioStateIdOf, referenceStrategySpec,
} from './strategy';
import type { StrategyRunMirror } from './mirrors/strategy';
import type {
  AccountFillMirror, ConstraintSetVersionRefMirror, GoalVersionRefMirror,
  PortfolioStateMirror, StrategyLineageMirror,
} from './mirrors/control';
import {
  createExecutionGateway, createPaperVenueAdapter, type GatewayRuntimeState,
} from './gateway';
import type {
  ApproveDecisionMirror, AuthorityGrantRecordMirror, EntitlementRegistryMirror,
  GatewaySubmissionRecordMirror, RoutingTableMirror,
} from './mirrors/execution';
import type { KillSwitchLogMirror, KillSwitchRecordMirror } from './mirrors/risk';
import { applyWorldFills, prepareOrder, submitOrder, verifyLifecycleLog } from './execution-body';
import type { OrderLifecycleLogMirror } from './mirrors/execution';
import type { EngineDriverMirror, MarketEventMirror, ReactiveFillRecordMirror } from './mirrors/market';
import {
  appendShadowOutcome, deriveDecisionOutcome, domainOutcomeOf, goalProgressOf,
  startShadowOutcomeLog, verifyShadowOutcomeChain,
} from './outcomes';
import type {
  DomainOutcomeMirror, GoalProgressRecordMirror, ShadowLineageMirror, ShadowOutcomeLogMirror,
} from './mirrors/shadow';

export interface EndToEndRunResult {
  readonly scenario: TradingScenario;
  readonly scenarioDigest: string;
  readonly lineage: LineageStream;
  readonly kernel: KernelState;
  readonly world: ReactiveWorld;
  readonly riskPolicy: import('./mirrors/risk').RiskPolicyMirror;
  readonly executionPolicy: import('./mirrors/execution').ExecutionPolicyMirror;
  readonly decisions: readonly DirectorDecisionMirror[];
  readonly researchIntakes: readonly ResearchIntakeMirror[];
  readonly strategyRuns: readonly StrategyRunMirror[];
  readonly submissions: readonly GatewaySubmissionRecordMirror[];
  readonly lifecycleLogs: readonly OrderLifecycleLogMirror[];
  readonly outcomeLog: ShadowOutcomeLogMirror;
  readonly outcomes: readonly DomainOutcomeMirror[];
  readonly goalProgress: GoalProgressRecordMirror;
  readonly finalPortfolio: PortfolioStateMirror;
  readonly digest: string;
}

export interface RunOptions {
  /** An alternative engine driver (the tests bind the REAL exchange-sim here). */
  readonly driver?: EngineDriverMirror;
}

const SETTLE_DELAY_MS = 10_000;
const ORDER_CLOCK_OFFSET_MS = 1_500;

export function runEndToEndTradingScenario(scenarioInput: unknown, options?: RunOptions): ExampleResult<EndToEndRunResult> {
  const scenarioValidation = validateTradingScenario(scenarioInput);
  if (!scenarioValidation.ok) return scenarioValidation;
  const scenario = scenarioValidation.value;

  const goalValidation = validateGoalStatement(scenario.goal);
  if (!goalValidation.ok) return goalValidation;
  const constraintValidation = validateConstraintSet(scenario.constraintSet);
  if (!constraintValidation.ok) return constraintValidation;

  let lineage: LineageStream = startLineageStream();
  const append = (draft: Omit<LineageRecordDraft, 'tenant' | 'project'>): void => {
    lineage = unwrap(appendLineageRecord(lineage, { ...draft, tenant: scenario.tenant, project: scenario.project }));
  };

  // -------------------------------------------------------------------------
  // STAGE 1 — goal/constraint compilation (+ risk policy + kill switch)
  // -------------------------------------------------------------------------
  const riskPolicy = unwrap(compileRiskPolicy({ scenario, asOf: scenario.epochMs }));
  append({ stage: 'goal', artifactId: `goal:${scenario.goal.id}@${scenario.goal.version}`, artifactDigest: artifactDigestOf(scenario.goal), asOf: scenario.goal.createdAt, consumedIds: [] });
  append({ stage: 'constraints', artifactId: `cs:${scenario.constraintSet.id}@${scenario.constraintSet.version}`, artifactDigest: artifactDigestOf(scenario.constraintSet), asOf: scenario.constraintSet.createdAt, consumedIds: [`goal:${scenario.goal.id}`] });
  append({ stage: 'risk-policy', artifactId: riskPolicy.policyId, artifactDigest: artifactDigestOf(riskPolicy), asOf: riskPolicy.asOf, consumedIds: [`cs:${scenario.constraintSet.id}@${scenario.constraintSet.version}`] });

  const killSwitchContent = {
    sequence: 1,
    state: 'standing' as const,
    reason: null,
    thrownAt: null,
    tenant: scenario.tenant,
    project: scenario.project,
    asOf: scenario.epochMs,
  };
  const killSwitch: KillSwitchLogMirror = deepFreeze({
    switchId: `ksw:${fnv1a32Hex(canonicalJson({ tenant: scenario.tenant, project: scenario.project, state: 'standing' } as JsonValue))}`,
    records: [
      deepFreeze({
        ...killSwitchContent,
        recordId: `ksr:${fnv1a32Hex(fnv1a32Hex('ksw-genesis' + canonicalJson(killSwitchContent as JsonValue)) + canonicalJson(killSwitchContent as JsonValue))}`,
        chainHead: fnv1a32Hex('ksw-genesis' + canonicalJson(killSwitchContent as JsonValue)),
      }) as KillSwitchRecordMirror,
    ],
  });

  const executionPolicy = unwrap(compileExecutionPolicy({
    scenario, killSwitchId: killSwitch.switchId, riskPolicyRef: riskPolicyRefOf(riskPolicy), riskClassLimits: riskPolicy.classLimits, asOf: scenario.epochMs,
  }));

  // -------------------------------------------------------------------------
  // STAGES 2-3 — organization + bodies + possessions
  // -------------------------------------------------------------------------
  const bodies = referenceBodies(scenario);
  const registrySnapshot = registrySnapshotOf(bodies, scenario.tenant, scenario.epochMs);
  const searchLog = unwrap(compileOrganization(scenario, bodies, registrySnapshot, scenario.epochMs));
  const proposed = searchLog.candidates.find((candidate) => candidate.disposition === 'proposed')!;
  append({ stage: 'organization', artifactId: searchLog.searchRunId, artifactDigest: artifactDigestOf(searchLog), asOf: scenario.epochMs, consumedIds: [`goal:${scenario.goal.id}`, `cs:${scenario.constraintSet.id}`] });

  const possessions = referencePossessions(scenario, bodies);
  for (const body of bodies) {
    append({ stage: 'bodies', artifactId: body.id, artifactDigest: artifactDigestOf(body), asOf: scenario.epochMs, consumedIds: [searchLog.searchRunId] });
  }
  for (const possession of possessions) {
    append({ stage: 'possessions', artifactId: possession.id, artifactDigest: artifactDigestOf(possession), asOf: scenario.epochMs, consumedIds: [possession.bodyVersionId] });
  }

  // -------------------------------------------------------------------------
  // STAGE 4 — Agent OS boot
  // -------------------------------------------------------------------------
  let kernel = initialKernelState(scenario.tenant);
  const instances = referenceInstanceIds();
  const bootOp = (op: Parameters<typeof applyKernelOperation>[1]): void => {
    kernel = unwrap(applyKernelOperation(kernel, op)).state;
  };
  {
    const controlSpawn = { type: 'SPAWN' as const, timestamp: scenario.epochMs, actor: 'ai-control', tenantId: scenario.tenant, instance: 'ai-control', bodyVersion: 'control-plane@1.0.0', substrate: 'substrate/reference@1', manager: null };
    bootOp({ ...controlSpawn, opId: deriveOpId(controlSpawn) });
  }
  for (let index = 0; index < bodies.length; index++) {
    const spawn = { type: 'SPAWN' as const, timestamp: scenario.epochMs, actor: 'ai-control', tenantId: scenario.tenant, instance: instances[index]!, bodyVersion: bodies[index]!.id, substrate: 'substrate/reference@1', manager: 'ai-director' };
    bootOp({ ...spawn, opId: deriveOpId(spawn) });
  }
  for (const wire of proposed.blueprint.topology.wires) {
    for (const subscriber of wire.subscribers) {
      const subscribe = { type: 'SUBSCRIBE' as const, timestamp: scenario.epochMs, actor: instanceOfSlot(subscriber), tenantId: scenario.tenant, topic: wire.topic };
      bootOp({ ...subscribe, opId: deriveOpId(subscribe) });
    }
  }
  append({ stage: 'kernel', artifactId: `kernel:${kernel.operations.length}-ops`, artifactDigest: artifactDigestOf(kernel.operations.map((op) => op.opId)), asOf: scenario.epochMs, consumedIds: [searchLog.searchRunId] });

  // -------------------------------------------------------------------------
  // STAGE 5 — the reactive market world
  // -------------------------------------------------------------------------
  const driver = options?.driver ?? referenceEngine;
  const worldConfig = {
    world_id: `world-${scenario.scenarioId}`,
    mode: 'reactive_replay' as const,
    information_policy: 'point-in-time' as const,
    tenant: scenario.tenant,
    project: scenario.project,
    seed: scenario.seed,
    as_of: scenario.epochMs,
    streams: scenario.universe.map((entry) => ({ venue: entry.venue, instrument: entry.instrument })),
    exchange: scenario.physics.map((entry) => ({
      venue: entry.venue,
      instrument: entry.instrument,
      asset_class: scenario.universe.find((u) => u.instrument === entry.instrument)?.assetClass ?? 'crypto',
      physics: entry.physics,
      bookSeed: scenario.bookSeeds.find((seed) => seed.venue === entry.venue && seed.instrument === entry.instrument)?.seed ?? { bids: [], asks: [] },
    })),
    participants: [{ instance: 'ai-execution', role: 'candidate' as const, feed: null }],
    interleaving: { kind: 'stream_first' as const },
    playback_speed: 1,
  };
  let world = unwrap(startReactiveWorld(worldConfig, driver, scenario.marketEvents));
  append({ stage: 'world', artifactId: world.runId, artifactDigest: worldRunRecord(world).digest, asOf: scenario.epochMs, consumedIds: [searchLog.searchRunId] });

  // -------------------------------------------------------------------------
  // The strategy spec + portfolio genesis
  // -------------------------------------------------------------------------
  const strategySpec = referenceStrategySpec(
    scenario,
    riskPolicyRefOf(riskPolicy),
    searchLog.searchRunId,
    proposed.blueprint.assignments
      .filter((assignment) => assignment.subject.ref.startsWith('trading-director') || assignment.subject.ref.startsWith('execution'))
      .map((assignment) => assignment.slotId),
  );
  const goalVersionRef: GoalVersionRefMirror = { goalId: scenario.goal.id, version: scenario.goal.version };
  const constraintVersionRef: ConstraintSetVersionRefMirror = { id: scenario.constraintSet.id, version: scenario.constraintSet.version };
  const strategyLineage: StrategyLineageMirror = {
    strategy: { specId: strategySpec.specId, version: strategySpec.version },
    goal: goalVersionRef,
    constraintSet: constraintVersionRef,
    windowId: 'genesis',
    seed: scenario.seed,
    tenant: scenario.tenant,
    project: scenario.project,
  };
  let portfolio = initialPortfolioState(strategyLineage, scenario.initialCash, scenario.epochMs);

  // -------------------------------------------------------------------------
  // The gateway wiring (authority + routing + the paper adapter)
  // -------------------------------------------------------------------------
  const grantDraft = {
    version: 1,
    supersedes: null,
    tenant: scenario.tenant,
    project: scenario.project,
    principal: { specId: strategySpec.specId, version: strategySpec.version },
    scopeRef: scenario.policies.execution.grantScopeRef,
    orderKinds: [...scenario.policies.execution.orderKinds],
    venues: [...new Set(scenario.universe.map((entry) => entry.venue))],
    rateBudgets: [...new Set(scenario.universe.map((entry) => entry.venue))].map((venue) => ({
      venue,
      windowMs: scenario.policies.execution.grantRateBudget.windowMs,
      maxOrders: scenario.policies.execution.grantRateBudget.maxOrders,
    })),
    credentials: [...new Set(scenario.universe.map((entry) => entry.venue))].map((venue) => ({
      venue,
      credentialRef: scenario.policies.execution.credentialRef,
    })),
    validity: { issuedAt: scenario.epochMs, expiresAt: scenario.goal.horizon.endsAt },
    revocations: [],
    asOf: scenario.epochMs,
  };
  const authorityRegistry: EntitlementRegistryMirror = deepFreeze({
    tenant: scenario.tenant,
    project: scenario.project,
    grants: [deepFreeze({ ...grantDraft, grantId: `xag:${fnv1a32Hex(canonicalJson(grantDraft as JsonValue))}` } as AuthorityGrantRecordMirror)],
    venues: [...new Set(scenario.universe.map((entry) => entry.venue))],
  });
  const routingTable: RoutingTableMirror = deepFreeze({
    tenant: scenario.tenant,
    project: scenario.project,
    entries: scenario.universe.map((entry) => ({
      venue: entry.venue,
      instrument: entry.instrument,
      adapterRef: scenario.policies.execution.adapterRef,
      channelRef: scenario.policies.execution.channelRef,
    })),
  });

  const decisions: DirectorDecisionMirror[] = [];
  const researchIntakes: ResearchIntakeMirror[] = [];
  const strategyRuns: StrategyRunMirror[] = [];
  const submissions: GatewaySubmissionRecordMirror[] = [];
  const lifecycleLogs: OrderLifecycleLogMirror[] = [];
  const outcomes: DomainOutcomeMirror[] = [];
  let outcomeLog = startShadowOutcomeLog();
  let gatewayCarry: Partial<GatewayRuntimeState> | undefined;
  let actionCounter = 0;
  const worldBox: { world: ReactiveWorld } = { world };

  const paperAdapter = createPaperVenueAdapter();
  const paperPort = {
    routeOrder(routing: Parameters<typeof paperAdapter.port.routeOrder>[0]): { ok: true; value: null } | { ok: false; error: { kind: string; code: string; message: string } } {
      // THE VENUE SEAM: the translated order is submitted into the reactive
      // world's engine (paper/shadow execution, T030 pattern). This is the
      // ONLY place the slice touches a venue — and it carries a FORGE-VALID
      // gateway APPROVE decision (L8).
      const submitted = submitWorldAction(
        worldBox.world,
        {
          action_id: `swa-${String(++actionCounter).padStart(8, '0')}`,
          actor: 'ai-execution',
          submitted_at: routing.decision.asOf + 250,
          client_sequence: actionCounter,
          payload: { type: 'submit_order', intent: routing.intent.order },
        },
        scenario.marketEvents,
      );
      if (!submitted.ok) {
        return { ok: false, error: { kind: 'protocol', code: 'world_rejected', message: submitted.errors.map((error) => error.message).join('; ') } };
      }
      worldBox.world = submitted.value.world;
      return { ok: true, value: null };
    },
  };

  // -------------------------------------------------------------------------
  // STAGES 6-11 — the decision cycles
  // -------------------------------------------------------------------------
  for (let decisionIndex = 0; decisionIndex < scenario.decisions.length; decisionIndex++) {
    const slot = scenario.decisions[decisionIndex]!;
    const at = scenario.epochMs + slot.atOffsetMs;
    const windowFrom = at - slot.lookbackMs;
    const windowId = `win-${decisionIndex + 1}`;

    // Settle the world to the decision instant (stream_first).
    world = unwrap(settleWorld(worldBox.world, scenario.marketEvents, at));
    worldBox.world = world;

    // Kernel: OBSERVE (each research instance pulls its window).
    for (const researcher of instances.slice(0, 4)) {
      const observe = { type: 'OBSERVE' as const, timestamp: at, actor: researcher, tenantId: scenario.tenant, windowRef: windowId };
      bootOp({ ...observe, opId: deriveOpId(observe) });
    }

    // STAGE 6 — research (the four lanes, point-in-time).
    const researchRun = runResearch(world, { asOf: at, windowFrom, tenant: scenario.tenant, project: scenario.project, seed: scenario.seed });
    researchIntakes.push(researchRun);
    const consumedObservationIds = visibleEvents(world, windowFrom, at).map((event) => event.event_id);
    const laneTopics: [string, string][] = [
      ['sentiment', 'research.sentiment'],
      ['regime', 'research.regime'],
      ['fundamental', 'research.fundamental'],
      ['cross-market', 'research.crossmarket'],
    ];
    for (let laneIndex = 0; laneIndex < laneTopics.length; laneIndex++) {
      const [lane, topic] = laneTopics[laneIndex]!;
      const report =
        lane === 'sentiment' ? researchRun.sentiment! :
        lane === 'regime' ? researchRun.regime! :
        lane === 'fundamental' ? researchRun.fundamental! :
        researchRun.crossMarket!;
      const publish = { type: 'PUBLISH' as const, timestamp: at, actor: instances[laneIndex]!, tenantId: scenario.tenant, topic, payloadRef: `report:${report.reportId}` };
      bootOp({ ...publish, opId: deriveOpId(publish) });
      append({ stage: 'research', artifactId: report.reportId, artifactDigest: artifactDigestOf(report), asOf: at, consumedIds: [...consumedObservationIds] });
    }

    // STAGE 7 — the Trading Director.
    const directorOutcome = unwrap(composeDirectorDecision({
      asOf: at,
      goal: goalVersionRef,
      constraintSets: [constraintVersionRef],
      tenantId: scenario.tenant,
      projectId: scenario.project,
      seed: scenario.seed,
      methodId: DIRECTOR_METHOD_REGISTRY_MIRROR.methods[0]!.methodId,
      registry: DIRECTOR_METHOD_REGISTRY_MIRROR,
      bodyVersion: 'trading-director@1.0.0',
      intake: researchRun,
    }));
    if (directorOutcome.kind === 'escalation') {
      append({ stage: 'director', artifactId: directorOutcome.escalation.escalationId, artifactDigest: artifactDigestOf(directorOutcome.escalation), asOf: at, consumedIds: directorOutcome.escalation.inputs.map((input) => input.reportId) });
      const publish = { type: 'PUBLISH' as const, timestamp: at, actor: 'ai-director', tenantId: scenario.tenant, topic: 'directors.escalations', payloadRef: `escalation:${directorOutcome.escalation.escalationId}` };
      bootOp({ ...publish, opId: deriveOpId(publish) });
      continue;
    }
    const decision = directorOutcome.decision;
    decisions.push(decision);
    append({ stage: 'director', artifactId: decision.decisionId, artifactDigest: artifactDigestOf(decision), asOf: at, consumedIds: decision.inputs.map((input) => input.reportId) });
    {
      const publish = { type: 'PUBLISH' as const, timestamp: at, actor: 'ai-director', tenantId: scenario.tenant, topic: 'directors.decisions', payloadRef: `decision:${decision.decisionId}` };
      bootOp({ ...publish, opId: deriveOpId(publish) });
    }

    // STAGE 8 — strategy (drift-gated intents bound to the directive).
    const marks = unwrap(marksAt(world, scenario.universe, at));
    const window = {
      window_id: windowId,
      events: world.observations
        .map((observation) => observation.payload as MarketEventMirror)
        .filter((event): event is Extract<MarketEventMirror, { event_type: 'trade' | 'quote' }> => event.available_time >= windowFrom && event.available_time <= at && (event.event_type === 'trade' || event.event_type === 'quote'))
        .sort((a, b) => (a.available_time === b.available_time ? (a.event_id < b.event_id ? -1 : 1) : a.available_time - b.available_time)),
      asOf: at,
      starts_at: windowFrom,
      ends_at: at,
    };
    const strategyOutcome = unwrap(compileStrategyRun({
      spec: strategySpec,
      state: portfolio,
      window,
      constraintSet: scenario.constraintSet,
      goal: scenario.goal,
      seed: scenario.seed,
      directorDecision: { decisionId: decision.decisionId, directive: decision.directive },
    }));
    strategyRuns.push(strategyOutcome.run);
    append({ stage: 'strategy', artifactId: strategyOutcome.run.runId, artifactDigest: artifactDigestOf(strategyOutcome.run), asOf: at, consumedIds: [decision.decisionId, windowId] });
    for (const intent of strategyOutcome.run.intents) {
      // L8: EXECUTE is authority-neutral — the kernel transports the intent
      // ref to the GATE, never to a venue.
      const execute = { type: 'EXECUTE' as const, timestamp: at, actor: 'ai-execution', tenantId: scenario.tenant, intentRef: intent.intentId, authorityTokenRef: `grant:${scenario.policies.execution.grantScopeRef.slice('grant:'.length)}` };
      bootOp({ ...execute, opId: deriveOpId(execute) });
      const publish = { type: 'PUBLISH' as const, timestamp: at, actor: 'ai-director', tenantId: scenario.tenant, topic: 'strategy.intents', payloadRef: `intent:${intent.intentId}` };
      bootOp({ ...publish, opId: deriveOpId(publish) });
    }

    // STAGE 9 — the gateway (constructed per decision with the CURRENT
    // facts; the runtime carries across decisions — resume semantics).
    const venueState = {
      asOf: at,
      instruments: scenario.universe.map((entry) => ({
        venue: entry.venue,
        instrument: entry.instrument,
        instrumentClass: entry.assetClass,
        referencePrice: marks.get(`${entry.venue}|${entry.instrument}`)!.price,
        rateWindowOrderCount: 0,
      })),
    };
    const gateway = unwrap(createExecutionGateway({
      policy: executionPolicy,
      gate: { portfolio, venueState },
      risk: { policy: riskPolicy, exposure: null },
      authority: authorityRegistry,
      routing: routingTable,
      adapters: [{ adapterRef: scenario.policies.execution.adapterRef, port: paperPort }],
      killSwitch,
      instants: countingInstants(at),
      substrate: 'substrate:example-e2e-reference@1',
      executionMode: 'paper',
    }, gatewayCarry));

    interface CycleFill {
      readonly intent: import('./mirrors/strategy').StrategyIntentMirror;
      readonly submission: GatewaySubmissionRecordMirror;
      readonly approve: ApproveDecisionMirror;
      readonly fills: readonly ReactiveFillRecordMirror[];
    }
    const cycleFills: CycleFill[] = [];
    const cycleSubmissions: { readonly intent: import('./mirrors/strategy').StrategyIntentMirror; readonly submission: GatewaySubmissionRecordMirror }[] = [];
    for (const intent of strategyOutcome.run.intents) {
      const fillsBefore = worldBox.world.fills.length;
      const submission = gateway.submitDecision(intent);
      if (!submission.ok) {
        return fail('invalid_state', `the gateway refused to reason over intent ${intent.intentId}: ${submission.errors.map((error) => error.message).join('; ')}`, 'gateway');
      }
      submissions.push(submission.value);
      cycleSubmissions.push({ intent, submission: submission.value });
      append({ stage: 'gate', artifactId: submission.value.submissionId, artifactDigest: artifactDigestOf(submission.value), asOf: at, consumedIds: [intent.intentId] });
      if (submission.value.kind !== 'routed') continue;

      // The fills this intent's world action produced (synchronous engine).
      const newFills = worldBox.world.fills.slice(fillsBefore);
      const approve = gateway.decisions().find((candidate) => candidate.decisionId === submission.value.decisionId);
      if (!approve) {
        return fail('invalid_state', `the gateway minted decision ${submission.value.decisionId} but cannot reproduce it`, 'gateway');
      }
      cycleFills.push({ intent, submission: submission.value, approve, fills: newFills });

      // STAGE 10 — the execution body: prepare -> submit -> fills.
      const prepared = unwrap(prepareOrder({
        decision: approve,
        intent,
        directorDecisionRef: decision.decisionId,
        orderClock: approve.asOf + ORDER_CLOCK_OFFSET_MS,
      }));
      const submitted = unwrap(submitOrder(prepared, submission.value, approve.asOf + ORDER_CLOCK_OFFSET_MS + 250));
      const withFills = newFills.length > 0 ? unwrap(applyWorldFills(submitted, newFills, at + SETTLE_DELAY_MS)) : submitted;
      lifecycleLogs.push(withFills);
      append({ stage: 'execution', artifactId: `ol:${withFills.records[0]!.lifecycleId}`, artifactDigest: artifactDigestOf(withFills), asOf: at + ORDER_CLOCK_OFFSET_MS, consumedIds: [submission.value.decisionId!, intent.intentId] });
    }
    gatewayCarry = gateway.runtime();

    // Settle so fills become visible (information latency honored).
    const settleAt = at + SETTLE_DELAY_MS;
    world = unwrap(settleWorld(worldBox.world, scenario.marketEvents, settleAt));
    worldBox.world = world;

    // STAGE 11 — outcomes; portfolio transitions on the applied fills.
    let accountFills: AccountFillMirror[] = [];
    const shadowLineage: ShadowLineageMirror = {
      sessionId: `shs:${scenario.scenarioId}`,
      fidelity: { mode: 'shadow', fill_origin: 'simulated' },
      executionPolicy: { policyId: executionPolicy.policyId, version: executionPolicy.version },
      riskPolicy: { policyId: riskPolicy.policyId, version: riskPolicy.version },
      configDigests: { worldConfigHash: world.configHash, engineConfigHash: world.engineConfigHash, dataset: `dataset:${scenario.scenarioId}` },
      run: { runId: world.runId, episodeId: world.episodeId },
      cursor: { cursorId: `cur:${scenario.scenarioId}`, position: world.observations.length },
      seed: scenario.seed,
      tenant: scenario.tenant,
      project: scenario.project,
    };
    // One outcome per submitted intent — refusals are outcomes too (T030).
    for (const cycled of cycleSubmissions) {
      const fills = cycleFills.find((candidate) => candidate.intent.intentId === cycled.intent.intentId)?.fills ?? [];
      const derived = deriveDecisionOutcome({
        intent: cycled.intent,
        submission: cycled.submission,
        fills,
        unrealizedAtDecision: unrealizedOf(portfolio, marks),
        lineage: shadowLineage,
        asOf: settleAt,
      }, outcomeLog);
      outcomeLog = unwrap(appendShadowOutcome(outcomeLog, derived.outcome));
      outcomes.push(domainOutcomeOf(derived.outcome, scenario.goal, derived.outcome.realizedOutcome, '0', portfolio.cash));
      accountFills = [...accountFills, ...derived.accountFills];
      append({ stage: 'outcome', artifactId: derived.outcome.outcomeId, artifactDigest: artifactDigestOf(derived.outcome), asOf: settleAt, consumedIds: [derived.outcome.decisionRef ?? derived.outcome.intentRef] });
    }
    if (accountFills.length > 0) {
      portfolio = unwrap(applyAccountFills(portfolio, accountFills, settleAt));
    }
  }

  // -------------------------------------------------------------------------
  // The final portfolio + goal progress (L7/L15)
  // -------------------------------------------------------------------------
  const finalAt = scenario.epochMs + (scenario.decisions[scenario.decisions.length - 1]?.atOffsetMs ?? 0) + SETTLE_DELAY_MS;
  const finalMarks = unwrap(marksAt(world, scenario.universe, finalAt));
  const finalContent = {
    positions: portfolio.positions,
    weights: computeWeights(portfolio.positions, portfolio.cash, finalMarks),
    cash: portfolio.cash,
    realizedPnl: portfolio.realizedPnl,
    unrealizedPnl: portfolio.positions.reduce((acc, position) => add(acc, multiply(position.quantity, finalMarks.get(`${position.venueId}|${position.instrumentId}`)!.price)), '0'),
    asOf: finalAt,
    lineage: { ...strategyLineage, windowId: 'final' },
  };
  const finalPortfolio = deepFreeze({ ...finalContent, stateId: portfolioStateIdOf(finalContent) } as PortfolioStateMirror);
  const finalEquity = add(finalPortfolio.cash, finalPortfolio.unrealizedPnl);
  const realizedPnl = signedSubtract(finalEquity, scenario.initialCash);
  const peak = maxOf([scenario.initialCash, finalEquity]);
  const maxDrawdown = subtract(peak, finalEquity);

  const goalProgress = goalProgressOf(scenario.goal, scenario.project, outcomeLog.records.map((record) => record.outcomeId), finalEquity, realizedPnl, maxDrawdown, finalAt);
  append({ stage: 'goal-progress', artifactId: `goal-progress:${scenario.goal.id}`, artifactDigest: artifactDigestOf(goalProgress), asOf: finalAt, consumedIds: outcomeLog.records.map((record) => record.outcomeId) });

  // Final coherence checks (the run refuses to report broken chains).
  if (!verifyShadowOutcomeChain(outcomeLog)) {
    return fail('chain_mismatch', 'the outcome log failed its chain verification', 'outcomeLog');
  }
  for (const log of lifecycleLogs) {
    const verified = verifyLifecycleLog(log);
    if (!verified.ok) return verified;
  }

  const digest = lineageStreamDigest(lineage);
  return ok(deepFreeze({
    scenario,
    scenarioDigest: fnv1a32Hex(canonicalJson(scenario as unknown as JsonValue)),
    lineage,
    kernel,
    world,
    riskPolicy,
    executionPolicy,
    decisions,
    researchIntakes,
    strategyRuns,
    submissions,
    lifecycleLogs,
    outcomeLog,
    outcomes,
    goalProgress,
    finalPortfolio,
    digest,
  }));
}

function instanceOfSlot(slotId: string): string {
  const index = Number.parseInt(slotId.replace('slot-', ''), 10) - 1;
  return referenceInstanceIds()[index] ?? 'ai-control';
}

function maxOf(values: readonly string[]): string {
  return values.reduce((acc, value) => (compare(value, acc) > 0 ? value : acc), values[0] ?? '0');
}

function unrealizedOf(portfolio: PortfolioStateMirror, marks: ReadonlyMap<string, { price: string }>): string {
  return portfolio.positions.reduce((acc, position) => add(acc, multiply(position.quantity, marks.get(`${position.venueId}|${position.instrumentId}`)?.price ?? '0')), '0');
}

/** A deterministic instant source: anchor + counter * 250ms (all from the scenario). */
function countingInstants(anchor: number): { next(): number } {
  let counter = 0;
  return {
    next(): number {
      counter += 1;
      return anchor + counter * 250;
    },
  };
}
