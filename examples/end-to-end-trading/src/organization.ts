// @tradrl/example-e2e-trading — STAGE 2: THE ORGANIZATION COMPILER.
//
// Goal/Constraints/Budgets -> a small agent organization (ARCHITECTURE.md
// core flow). The reference compiler builds the capability registry
// snapshot from the six body versions' declared capabilities (measured
// evidence records — L16a: labels never establish suitability), then
// proposes ONE candidate organization: six slots (four research bodies,
// the Trading Director, the Execution body), a topic-wired topology on
// the kernel fabric, per-slot training allocation and decision cadence.
// The candidate log is append-only (L11) and carries the full lineage
// block (L9). Safety trip-wire: a blueprint embedding authority keys is
// a typed construction failure (L8/L20).

import { deepFreeze, stableDigest8Json, type JsonValue } from './primitives';
import { fail, ok, type ExampleResult } from './errors';
import type {
  CompileBudgetsMirror, OrganizationBlueprintMirror, OrganizationCandidateMirror,
  RegistrySnapshotMirror, SearchLogMirror, CapabilityRecordMirror,
  CandidateLineageMirror, ObjectiveMeasurementsMirror,
} from './mirrors/agent';
import type { GoalStatementMirror, ConstraintSetStatementMirror } from './mirrors/control';
import type { BodyVersionMirror } from './mirrors/agent';
import type { TradingScenario } from './scenario';
import { validateGoalStatement, validateConstraintSet } from './control-plane';

export const REFERENCE_COMPILER_VERSION = 'compiler/reference-organization@1.0.0';

/** The slot map of the reference organization (stable ids). */
export const REFERENCE_SLOTS = [
  { slotId: 'slot-1', bodyId: 'sentiment-researcher' },
  { slotId: 'slot-2', bodyId: 'regime-researcher' },
  { slotId: 'slot-3', bodyId: 'fundamental-researcher' },
  { slotId: 'slot-4', bodyId: 'cross-market-researcher' },
  { slotId: 'slot-5', bodyId: 'trading-director' },
  { slotId: 'slot-6', bodyId: 'execution' },
] as const;

/** The topic fabric of the reference organization (never kernel.*). */
export const REFERENCE_TOPICS = {
  sentiment: 'research.sentiment',
  regime: 'research.regime',
  fundamental: 'research.fundamental',
  crossMarket: 'research.crossmarket',
  decisions: 'directors.decisions',
  escalations: 'directors.escalations',
  intents: 'strategy.intents',
  lifecycleReports: 'execution.lifecycle',
} as const;

/** Mints the capability registry snapshot from the six body versions. */
export function registrySnapshotOf(
  bodies: readonly BodyVersionMirror[],
  tenant: string,
  takenAt: number,
): RegistrySnapshotMirror {
  const records: CapabilityRecordMirror[] = [];
  for (const body of bodies) {
    for (const capability of body.composition.capabilities) {
      records.push({
        recordId: `cap:${body.bodyId}:${capability.id}`,
        subject: { kind: 'body-version', ref: body.id },
        descriptor: { capabilityKey: `${capability.category}:${capability.id}`, summary: capability.description },
        evidence: [
          {
            kind: 'measured' as const,
            metric: 'capability.declared',
            value: 1,
            unit: 'boolean',
            measuredAt: body.createdAt ? Date.parse(body.createdAt) || takenAt : takenAt,
            measuredBy: `body/${body.bodyId}`,
          },
        ],
        declaredAt: takenAt,
        tenantId: tenant,
      });
    }
  }
  const content = { records, takenAt, tenantId: tenant };
  return deepFreeze({ ...content, digest: stableDigest8Json(content as unknown as JsonValue) });
}

/** Builds the seven-axis reference blueprint for the six bodies. */
export function referenceBlueprint(bodies: readonly BodyVersionMirror[]): OrganizationBlueprintMirror {
  const byId = new Map(bodies.map((body) => [body.bodyId, body] as const));
  const slotOf = (bodyId: string): string =>
    REFERENCE_SLOTS.find((slot) => slot.bodyId === bodyId)!.slotId;
  const assignments = REFERENCE_SLOTS.map((slot) => {
    const body = byId.get(slot.bodyId)!;
    return {
      slotId: slot.slotId,
      subject: { kind: 'body-version' as const, ref: body.id },
      capabilityRecordRefs: body.composition.capabilities.map((capability) => `cap:${body.bodyId}:${capability.id}`),
      riskPolicyRefs: [],
    };
  });
  const researchSlots = REFERENCE_SLOTS.filter((slot) => slot.bodyId.endsWith('-researcher')).map((slot) => slot.slotId);
  const directorSlot = slotOf('trading-director');
  const executionSlot = slotOf('execution');
  return deepFreeze({
    agentCount: REFERENCE_SLOTS.length,
    specializations: [
      { capabilityKey: 'research:sentiment', benchmarkRefs: [] },
      { capabilityKey: 'research:regime', benchmarkRefs: [] },
      { capabilityKey: 'research:fundamental', benchmarkRefs: [] },
      { capabilityKey: 'research:cross-market', benchmarkRefs: [] },
      { capabilityKey: 'decision:synthesis', benchmarkRefs: [] },
      { capabilityKey: 'execution:order-lifecycle', benchmarkRefs: [] },
    ],
    assignments,
    topology: {
      wires: [
        { topic: REFERENCE_TOPICS.sentiment, publishers: [researchSlots[0]!], subscribers: [directorSlot] },
        { topic: REFERENCE_TOPICS.regime, publishers: [researchSlots[1]!], subscribers: [directorSlot] },
        { topic: REFERENCE_TOPICS.fundamental, publishers: [researchSlots[2]!], subscribers: [directorSlot] },
        { topic: REFERENCE_TOPICS.crossMarket, publishers: [researchSlots[3]!], subscribers: [directorSlot] },
        { topic: REFERENCE_TOPICS.decisions, publishers: [directorSlot], subscribers: [directorSlot, executionSlot] },
        { topic: REFERENCE_TOPICS.escalations, publishers: [directorSlot], subscribers: [directorSlot] },
        { topic: REFERENCE_TOPICS.lifecycleReports, publishers: [executionSlot], subscribers: [directorSlot] },
      ],
    },
    trainingAllocation: {
      entries: REFERENCE_SLOTS.map((slot) => ({ slotId: slot.slotId, method: 'statistical-causal', computeUnits: 0 })),
    },
    decisionCadence: {
      entries: REFERENCE_SLOTS.map((slot) => ({
        slotId: slot.slotId,
        intervalMs: slot.bodyId === 'execution' ? 1_000 : 1_200_000,
      })),
    },
    adversarialPopulation: null,
  } satisfies OrganizationBlueprintMirror);
}

/** Measurements + aggregate for the reference candidate (all declared inputs). */
export function referenceMeasurements(
  goal: GoalStatementMirror,
  blueprint: OrganizationBlueprintMirror,
  budgets: CompileBudgetsMirror,
): { measurements: ObjectiveMeasurementsMirror; objective: { score: number; contributions: Record<string, number>; inputDigest: string } } {
  const wires = blueprint.topology.wires.reduce((acc, wire) => acc + wire.publishers.length * wire.subscribers.length, 0);
  const measurements: ObjectiveMeasurementsMirror = {
    objectiveAttainment: goal.successCriteria.requiredSatisfaction,
    risk: 1,
    compute: blueprint.trainingAllocation.entries.reduce((acc, entry) => acc + entry.computeUnits, 0),
    coordinationCost: wires,
    latency: Math.max(...blueprint.decisionCadence.entries.map((entry) => entry.intervalMs)),
    robustness: 1,
    redundancy: 0,
  };
  const inputDigest = stableDigest8Json({ goal: goal.id, blueprint: blueprint.agentCount, budgets: budgets.maxAgents } as JsonValue);
  return {
    measurements,
    objective: { score: goal.successCriteria.requiredSatisfaction, contributions: { objectiveAttainment: measurements.objectiveAttainment }, inputDigest },
  };
}

/** The deterministic reference compiler: one proposed candidate. */
export function compileOrganization(
  scenario: TradingScenario,
  bodies: readonly BodyVersionMirror[],
  registrySnapshot: RegistrySnapshotMirror,
  asOf: number,
): ExampleResult<SearchLogMirror> {
  const goalValidation = validateGoalStatement(scenario.goal);
  if (!goalValidation.ok) return goalValidation;
  const constraintValidation = validateConstraintSet(scenario.constraintSet);
  if (!constraintValidation.ok) return constraintValidation;
  const goal = goalValidation.value;
  const constraints = constraintValidation.value;

  const blueprint = referenceBlueprint(bodies);
  // L8/L20 trip-wire: no authority keys anywhere in the blueprint.
  const blueprintJson = JSON.stringify(blueprint);
  for (const forbidden of ['"authority"', '"token"', '"credential"', '"apiKey"', '"secret"', '"grant"']) {
    if (blueprintJson.includes(forbidden)) {
      return fail('invalid_state', `blueprint embeds authority material (${forbidden}) — authority_in_blueprint (L8/L20)`, 'blueprint');
    }
  }
  if (blueprint.agentCount > scenario.budgets.maxAgents) {
    return fail('invalid_state', `blueprint agentCount ${blueprint.agentCount} exceeds budget ${scenario.budgets.maxAgents}`, 'blueprint.agentCount');
  }

  const { measurements, objective } = referenceMeasurements(goal, blueprint, scenario.budgets);
  const lineage: CandidateLineageMirror = {
    goalRef: goal.id,
    goalVersion: goal.version,
    constraintSetRef: constraints.id,
    constraintSetVersion: constraints.version,
    registrySnapshotDigest: registrySnapshot.digest,
    seed: scenario.seed,
    compilerVersion: REFERENCE_COMPILER_VERSION,
    parentCandidateId: null,
    tenantId: scenario.tenant,
    projectId: scenario.project,
  };
  const candidate: OrganizationCandidateMirror = deepFreeze({
    candidateId: `cand:${stableDigest8Json({ blueprint: blueprint.agentCount, lineage: lineage.registrySnapshotDigest, seed: scenario.seed } as JsonValue)}`,
    sequence: 1,
    blueprint,
    measurements,
    objective,
    lineage,
    disposition: 'proposed',
    reasons: [],
  });
  const searchRunId = `orgsearch:${stableDigest8Json({
    goal: goal.id,
    constraints: constraints.id,
    seed: scenario.seed,
    compilerVersion: REFERENCE_COMPILER_VERSION,
    registry: registrySnapshot.digest,
  } as JsonValue)}`;
  const log: SearchLogMirror = deepFreeze({
    searchRunId,
    tenantId: scenario.tenant,
    projectId: scenario.project,
    goal,
    constraints,
    budgets: scenario.budgets,
    registrySnapshot,
    seed: scenario.seed,
    compilerVersion: REFERENCE_COMPILER_VERSION,
    candidates: [candidate],
  });
  void asOf;
  return ok(log);
}
