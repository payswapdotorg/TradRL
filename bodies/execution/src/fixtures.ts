// @tradrl/body-execution — the deterministic fixture set.
//
// Owning Work Order: T025, "Fixtures": "Deterministic golden scenarios,
// hand-derived: the happy path (prepared->submitted->acknowledged->filled)
// plus the anomaly paths — rejection at the gate, expiry, stuck-ack
// escalation, partial-fill reconciliation, kill-switch mid-flight,
// cancellation race. Byte-stable outputs; certification stays false with
// null evidence (T017's law: certification is the verification lane's
// verdict)."
//
// Every fixture is hand-derived and deterministic: fixed literal
// instants (no clock), content-addressed derived ids (no randomness),
// and byte-identical outputs on every run (the determinism goldens in
// the test suite prove it — the same scenario built twice is
// byte-identical). The scenario fixtures build REAL lifecycle logs by
// driving the package's own constructors (prepareOrder /
// appendOrderLifecycleEvent / the monitoring procedures) so the golden
// outputs are exactly what the lane produces.
//
// Tenant/project constants align with the execution-policy and risk
// lanes' fixtures ('tenant-alpha' / 'project-one') so the interop trip
// wires can flow REAL-lane records through this package's mirrors.

import { deepFreeze, type TimestampMs } from './primitives';
import type { TenantId, ProjectId, OrderRef } from './ids';
import {
  type ApprovedDecisionMirror,
  type ExecutionIntake,
  type KillSwitchStandingStateMirror,
  type LimitStateMirror,
  type OrderIntentMirror,
  isKillSwitchStandingStateMirror,
} from './intake';
import {
  type MethodRegistry,
  EXECUTION_METHOD_REGISTRY,
  EXECUTION_ORDER_PREPARATION_METHOD,
  EXECUTION_STUCK_ORDER_DETECTION_METHOD,
  EXECUTION_FILL_RECONCILIATION_METHOD,
  EXECUTION_CANCELLATION_POLICY_METHOD,
  EXECUTION_KILL_SWITCH_RESPONSE_METHOD,
} from './methods';
import {
  type OrderLifecycleLog,
  prepareOrder,
  appendOrderLifecycleEvent,
  type FillEvidence,
} from './lifecycle';
import {
  type EscalationRecord,
  type FillReconciliationOutcome,
  type KillSwitchResponseOutcome,
  type StuckDetectionOutcome,
  type CancellationOutcome,
  detectStuckOrder,
  reconcileFills,
  respondToKillSwitch,
  attemptCancellation,
} from './monitoring';
import { EXECUTION_BODY, type ExecutionBodySpec } from './body';

// ---------------------------------------------------------------------------
// The fixed fixture constants (literal, deterministic)
// ---------------------------------------------------------------------------

/** The fixture decision instant (the strategic asOf — execution-policy's T0, aligned). */
export const FIXTURE_T0: TimestampMs = 1_700_000_000_000 as TimestampMs;

/** The tenant scope (aligned with the execution-policy/risk fixtures). */
export const FIXTURE_TENANT: TenantId = 'tenant-alpha' as TenantId;

/** The project scope (aligned with the execution-policy/risk fixtures). */
export const FIXTURE_PROJECT: ProjectId = 'project-one' as ProjectId;

/** The fixture order clock instants (the L16 order-level clock — every one AFTER the decision). */
export const FIXTURE_CLOCKS = deepFreeze({
  prepare: FIXTURE_T0 + 50,
  submit: FIXTURE_T0 + 200,
  acknowledge: FIXTURE_T0 + 900,
  fillOne: FIXTURE_T0 + 1_200,
  fillTwo: FIXTURE_T0 + 2_400,
  stuckCheck: FIXTURE_T0 + 5_000,
  switchThrown: FIXTURE_T0 + 1_500,
  switchResponse: FIXTURE_T0 + 1_600,
  cancelAttempt: FIXTURE_T0 + 2_600,
  expiry: FIXTURE_T0 + 30_000,
  reconciliation: FIXTURE_T0 + 3_000,
} as const);

/** The fixture gateway decision id (opaque 'xd:'-prefixed). */
export const FIXTURE_DECISION_ID = 'xd:0a1b2c3d4e5f6071';

/** The fixture intent ref ('si:'-prefixed — binds the fixture intent's clientOrderId). */
export const FIXTURE_INTENT_REF = 'si:t025-fx-001';

/** The fixture director decision ref (opaque 'dd'-prefixed — T024's space, consumed opaquely). */
export const FIXTURE_DIRECTOR_DECISION = 'dd-9f8e7d6c5b4a3021';

/** The fixture order identity (the clientOrderId space). */
export const FIXTURE_ORDER_REF: OrderRef = 't025-fx-001' as OrderRef;

/** The fixture order quantity (canonical positive decimal — exact). */
export const FIXTURE_QUANTITY = '0.75';

/** The fixture fill quantities (exact decimals; the grid step is '0.01'). */
export const FIXTURE_FILL_ONE = '0.5';
export const FIXTURE_FILL_TWO = '0.25';
/** The one-grid-step-short fill (0.75 - 0.01 = 0.74: the gap scenario's evidence). */
export const FIXTURE_FILL_TWO_GAP = '0.24';

/** The fixture fill refs (the 'xsf-' simulated-fill ordinal space). */
export const FIXTURE_FILL_ONE_REF = 'xsf-00000001';
export const FIXTURE_FILL_TWO_REF = 'xsf-00000002';

/** The fixture gateway cancel confirmation ref. */
export const FIXTURE_CANCEL_CONFIRMATION = 'confirm:cancel-0001';

/** The fixture kill-switch evidence. */
export const FIXTURE_SWITCH_ID = 'ksw:1a2b3c4d';
export const FIXTURE_SWITCH_REASON = 'circuit breaker';

/** The fixture method registry (the canonical registry). */
export const FIXTURE_REGISTRY: MethodRegistry = EXECUTION_METHOD_REGISTRY;

/** The canonical method citations (id + strict version). */
export const FIXTURE_PREPARATION_CITATION = deepFreeze({
  methodId: EXECUTION_ORDER_PREPARATION_METHOD.methodId as string,
  methodVersion: EXECUTION_ORDER_PREPARATION_METHOD.version as string,
}) as { readonly methodId: string; readonly methodVersion: string };

export const FIXTURE_STUCK_CITATION = deepFreeze({
  methodId: EXECUTION_STUCK_ORDER_DETECTION_METHOD.methodId as string,
  methodVersion: EXECUTION_STUCK_ORDER_DETECTION_METHOD.version as string,
}) as { readonly methodId: string; readonly methodVersion: string };

export const FIXTURE_RECONCILIATION_CITATION = deepFreeze({
  methodId: EXECUTION_FILL_RECONCILIATION_METHOD.methodId as string,
  methodVersion: EXECUTION_FILL_RECONCILIATION_METHOD.version as string,
}) as { readonly methodId: string; readonly methodVersion: string };

export const FIXTURE_CANCELLATION_CITATION = deepFreeze({
  methodId: EXECUTION_CANCELLATION_POLICY_METHOD.methodId as string,
  methodVersion: EXECUTION_CANCELLATION_POLICY_METHOD.version as string,
}) as { readonly methodId: string; readonly methodVersion: string };

export const FIXTURE_SWITCH_CITATION = deepFreeze({
  methodId: EXECUTION_KILL_SWITCH_RESPONSE_METHOD.methodId as string,
  methodVersion: EXECUTION_KILL_SWITCH_RESPONSE_METHOD.version as string,
}) as { readonly methodId: string; readonly methodVersion: string };

// ---------------------------------------------------------------------------
// The order-lane mirror fixtures (field-for-field with the REAL lanes)
// ---------------------------------------------------------------------------

/** The golden gated order intent (the shape the brokers/OMS-EMS adapters' routing consumes). */
export const FIXTURE_INTENT: OrderIntentMirror = deepFreeze({
  clientOrderId: 't025-fx-001',
  instrumentId: 'BTC-USD',
  venueId: 'REFSIM',
  side: 'buy',
  kind: 'limit',
  quantity: FIXTURE_QUANTITY,
  price: '50000.00',
  timeInForce: 'gtc',
  createdAt: '2023-11-14T22:13:20.000Z',
}) as OrderIntentMirror;

/** The lineage block of the fixture decisions (mirrors T019's ExecutionLineage). */
const FIXTURE_LINEAGE = deepFreeze({
  intentRef: FIXTURE_INTENT_REF,
  strategy: { specId: 'spec-fixture', version: 1 },
  goal: { goalId: 'goal-fixture', version: 1 },
  policy: { policyId: 'xpol:fixture', version: 1 },
  venues: ['REFSIM'],
  seed: 't019-seed',
  tenant: 'tenant-alpha',
  project: 'project-one',
}) as { intentRef: string; strategy: { specId: string; version: number }; goal: { goalId: string; version: number }; policy: { policyId: string; version: number }; venues: readonly string[]; seed: string; tenant: string; project: string };

/** The check-order + all-pass checks of the fixture approvals (T019's seven dimensions). */
const FIXTURE_CHECK_ORDER = ['kill_switch', 'identity', 'authorization', 'limits', 'venue_permissions', 'rate_limits', 'credentials'] as const;

const FIXTURE_PASSED_CHECKS = FIXTURE_CHECK_ORDER.map((dimension, index) => ({
  dimension,
  ordinal: index + 1,
  outcome: 'pass' as const,
}));

/** The golden APPROVE decision mirror (the authority). */
export const FIXTURE_APPROVE_DECISION: ApprovedDecisionMirror = deepFreeze({
  kind: 'approve',
  decisionId: FIXTURE_DECISION_ID,
  intentRef: FIXTURE_INTENT_REF,
  policy: { policyId: 'xpol:fixture', version: 1 },
  checkOrder: [...FIXTURE_CHECK_ORDER],
  checks: FIXTURE_PASSED_CHECKS,
  lineage: FIXTURE_LINEAGE,
  asOf: FIXTURE_T0,
}) as unknown as ApprovedDecisionMirror;

/** The golden REFUSE decision mirror (a record — never authority). */
export const FIXTURE_REFUSE_DECISION = deepFreeze({
  kind: 'refuse',
  decisionId: 'xd:0a1b2c3d4e5f6072',
  intentRef: FIXTURE_INTENT_REF,
  policy: { policyId: 'xpol:fixture', version: 1 },
  checkOrder: [...FIXTURE_CHECK_ORDER],
  checks: [
    { dimension: 'kill_switch', ordinal: 1, outcome: 'pass' as const },
    { dimension: 'identity', ordinal: 2, outcome: 'pass' as const },
  ],
  failure: {
    dimension: 'authorization',
    ordinal: 3,
    reason: { dimension: 'authorization', orderKind: 'stop', permittedKinds: ['market', 'limit'] },
  },
  lineage: FIXTURE_LINEAGE,
  asOf: FIXTURE_T0,
});

/** The standing kill-switch fixture (armed, nothing thrown). */
export const FIXTURE_STANDING_SWITCH: KillSwitchStandingStateMirror = deepFreeze({
  state: 'standing',
  switchId: null,
  thrownAt: null,
  reason: null,
}) as KillSwitchStandingStateMirror;

/** The thrown kill-switch fixture (the injected mid-flight fact). */
export const FIXTURE_THROWN_SWITCH: KillSwitchStandingStateMirror = deepFreeze({
  state: 'thrown',
  switchId: FIXTURE_SWITCH_ID,
  thrownAt: FIXTURE_CLOCKS.switchThrown,
  reason: FIXTURE_SWITCH_REASON,
}) as KillSwitchStandingStateMirror;

/** The observed limit-state fixtures (T020's shapes, within). */
export const FIXTURE_LIMIT_STATES: readonly LimitStateMirror[] = deepFreeze([
  {
    kind: 'order_size',
    scope: { kind: 'instrument', venue: 'REFSIM', instrument: 'BTC-USD', instrumentClass: 'crypto' },
    state: 'within',
    reason: null,
  },
  {
    kind: 'drawdown',
    scope: { kind: 'portfolio' },
    state: 'within',
    reason: null,
  },
]) as readonly LimitStateMirror[];

/** The golden intake bundle (the accepted order-lane input). */
export const FIXTURE_INTAKE: ExecutionIntake = deepFreeze({
  decision: FIXTURE_APPROVE_DECISION,
  intent: FIXTURE_INTENT,
  killSwitch: FIXTURE_STANDING_SWITCH,
  limitStates: FIXTURE_LIMIT_STATES,
  directorDecision: FIXTURE_DIRECTOR_DECISION,
}) as ExecutionIntake;

/** An intake bundle carrying the REFUSAL (the negative: never authority). */
export const FIXTURE_REFUSAL_INTAKE: ExecutionIntake = deepFreeze({
  decision: FIXTURE_REFUSE_DECISION,
  intent: FIXTURE_INTENT,
  killSwitch: FIXTURE_STANDING_SWITCH,
  limitStates: FIXTURE_LIMIT_STATES,
  directorDecision: null,
}) as ExecutionIntake;

// ---------------------------------------------------------------------------
// The fill-evidence fixtures
// ---------------------------------------------------------------------------

/** The golden fill evidence (0.5 then 0.25 — the reconciled happy path). */
export const FIXTURE_FILLS: readonly FillEvidence[] = deepFreeze([
  { fillRef: FIXTURE_FILL_ONE_REF, quantity: FIXTURE_FILL_ONE, orderClock: FIXTURE_CLOCKS.fillOne },
  { fillRef: FIXTURE_FILL_TWO_REF, quantity: FIXTURE_FILL_TWO, orderClock: FIXTURE_CLOCKS.fillTwo },
]) as unknown as readonly FillEvidence[];

/** The gap-scenario fill evidence (0.5 then 0.24 — one grid step short of 0.75). */
export const FIXTURE_GAP_FILLS: readonly FillEvidence[] = deepFreeze([
  { fillRef: FIXTURE_FILL_ONE_REF, quantity: FIXTURE_FILL_ONE, orderClock: FIXTURE_CLOCKS.fillOne },
  { fillRef: FIXTURE_FILL_TWO_REF, quantity: FIXTURE_FILL_TWO_GAP, orderClock: FIXTURE_CLOCKS.fillTwo },
]) as unknown as readonly FillEvidence[];

// ---------------------------------------------------------------------------
// The scenario builders (drive the lane's own constructors — the
// golden outputs ARE what the lane produces)
// ---------------------------------------------------------------------------

/** Unwraps a fixture builder result (fixtures must construct — a failure is a fixture bug). */
function unwrap<T>(result: { ok: true; value: T } | { ok: false; errors: readonly { message: string }[] }): T {
  if (!result.ok) {
    throw new Error(`fixture must construct: ${result.errors.map((e) => e.message).join('; ')}`);
  }
  return result.value;
}

/** The shared preparation input (the genesis of every scenario). */
const FIXTURE_PREPARATION_INPUT = deepFreeze({
  decisionRef: FIXTURE_DECISION_ID,
  decisionAsOf: FIXTURE_T0,
  intentRef: FIXTURE_INTENT_REF,
  directorDecision: FIXTURE_DIRECTOR_DECISION,
  orderRef: FIXTURE_ORDER_REF,
  venue: 'REFSIM',
  instrument: 'BTC-USD',
  side: 'buy' as const,
  orderKind: 'limit',
  quantity: FIXTURE_QUANTITY,
  orderClock: FIXTURE_CLOCKS.prepare,
  methodId: FIXTURE_PREPARATION_CITATION.methodId,
  methodVersion: FIXTURE_PREPARATION_CITATION.methodVersion,
  tenant: FIXTURE_TENANT,
  project: FIXTURE_PROJECT,
});

/** Builds the genesis log (the prepared order). */
export function buildPreparedLog(): OrderLifecycleLog {
  return unwrap(prepareOrder(FIXTURE_PREPARATION_INPUT, FIXTURE_REGISTRY));
}

/** Submits a log (the gateway REQUEST accepted). */
export function buildSubmittedLog(): OrderLifecycleLog {
  return unwrap(
    appendOrderLifecycleEvent(buildPreparedLog(), {
      event: 'submit',
      orderClock: FIXTURE_CLOCKS.submit,
      killSwitch: FIXTURE_STANDING_SWITCH,
      methodId: FIXTURE_PREPARATION_CITATION.methodId,
      methodVersion: FIXTURE_PREPARATION_CITATION.methodVersion,
    }, FIXTURE_REGISTRY),
  );
}

/** Acknowledges a submitted log (the venue's ack). */
export function buildAcknowledgedLog(): OrderLifecycleLog {
  return unwrap(
    appendOrderLifecycleEvent(buildSubmittedLog(), {
      event: 'acknowledge',
      orderClock: FIXTURE_CLOCKS.acknowledge,
      methodId: FIXTURE_PREPARATION_CITATION.methodId,
      methodVersion: FIXTURE_PREPARATION_CITATION.methodVersion,
    }, FIXTURE_REGISTRY),
  );
}

/** THE HAPPY PATH: prepared -> submitted -> acknowledged -> partially_filled -> filled. */
export function buildHappyPathLog(): OrderLifecycleLog {
  const acknowledged = buildAcknowledgedLog();
  const partial = unwrap(
    appendOrderLifecycleEvent(acknowledged, {
      event: 'partial-fill',
      orderClock: FIXTURE_CLOCKS.fillOne,
      fills: [FIXTURE_FILLS[0] as FillEvidence],
      methodId: FIXTURE_RECONCILIATION_CITATION.methodId,
      methodVersion: FIXTURE_RECONCILIATION_CITATION.methodVersion,
    }, FIXTURE_REGISTRY),
  );
  return unwrap(
    appendOrderLifecycleEvent(partial, {
      event: 'fill-complete',
      orderClock: FIXTURE_CLOCKS.fillTwo,
      fills: [FIXTURE_FILLS[1] as FillEvidence],
      methodId: FIXTURE_RECONCILIATION_CITATION.methodId,
      methodVersion: FIXTURE_RECONCILIATION_CITATION.methodVersion,
    }, FIXTURE_REGISTRY),
  );
}

/** THE GATE-REJECTION PATH: prepared -> submitted -> rejected. */
export function buildGateRejectionLog(): OrderLifecycleLog {
  return unwrap(
    appendOrderLifecycleEvent(buildSubmittedLog(), {
      event: 'reject-at-gate',
      orderClock: FIXTURE_CLOCKS.acknowledge,
      methodId: FIXTURE_PREPARATION_CITATION.methodId,
      methodVersion: FIXTURE_PREPARATION_CITATION.methodVersion,
    }, FIXTURE_REGISTRY),
  );
}

/** THE EXPIRY PATH: prepared -> submitted -> acknowledged -> expired. */
export function buildExpiryLog(): OrderLifecycleLog {
  return unwrap(
    appendOrderLifecycleEvent(buildAcknowledgedLog(), {
      event: 'expire-unfilled',
      orderClock: FIXTURE_CLOCKS.expiry,
      methodId: FIXTURE_PREPARATION_CITATION.methodId,
      methodVersion: FIXTURE_PREPARATION_CITATION.methodVersion,
    }, FIXTURE_REGISTRY),
  );
}

/** THE STUCK-ACK ESCALATION: prepared -> submitted -> stuck (ack deadline exceeded), with the escalation record. */
export function buildStuckAckScenario(): { log: OrderLifecycleLog; outcome: StuckDetectionOutcome } {
  const submitted = buildSubmittedLog();
  const outcome = unwrap(
    detectStuckOrder({
      log: submitted,
      orderClock: FIXTURE_CLOCKS.stuckCheck,
      methodId: FIXTURE_STUCK_CITATION.methodId,
      methodVersion: FIXTURE_STUCK_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    }),
  );
  return { log: submitted, outcome };
}

/** THE PARTIAL-FILL RECONCILIATION (reconciled): the happy path's fills sum exactly to the acknowledged quantity. */
export function buildReconciledScenario(): { log: OrderLifecycleLog; outcome: FillReconciliationOutcome } {
  const log = buildHappyPathLog();
  const outcome = unwrap(
    reconcileFills({
      log,
      acknowledgedQuantity: FIXTURE_QUANTITY,
      orderClock: FIXTURE_CLOCKS.reconciliation,
      methodId: FIXTURE_RECONCILIATION_CITATION.methodId,
      methodVersion: FIXTURE_RECONCILIATION_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    }),
  );
  return { log, outcome };
}

/** THE RECONCILIATION-GAP PATH: fills sum to one grid step short of the acknowledged quantity. */
export function buildReconciliationGapScenario(): { log: OrderLifecycleLog; outcome: FillReconciliationOutcome } {
  const acknowledged = buildAcknowledgedLog();
  const partial = unwrap(
    appendOrderLifecycleEvent(acknowledged, {
      event: 'partial-fill',
      orderClock: FIXTURE_CLOCKS.fillOne,
      fills: [FIXTURE_GAP_FILLS[0] as FillEvidence],
      methodId: FIXTURE_RECONCILIATION_CITATION.methodId,
      methodVersion: FIXTURE_RECONCILIATION_CITATION.methodVersion,
    }, FIXTURE_REGISTRY),
  );
  const log = unwrap(
    appendOrderLifecycleEvent(partial, {
      event: 'fill-complete',
      orderClock: FIXTURE_CLOCKS.fillTwo,
      fills: [FIXTURE_GAP_FILLS[1] as FillEvidence],
      methodId: FIXTURE_RECONCILIATION_CITATION.methodId,
      methodVersion: FIXTURE_RECONCILIATION_CITATION.methodVersion,
    }, FIXTURE_REGISTRY),
  );
  const outcome = unwrap(
    reconcileFills({
      log,
      acknowledgedQuantity: FIXTURE_QUANTITY,
      orderClock: FIXTURE_CLOCKS.reconciliation,
      methodId: FIXTURE_RECONCILIATION_CITATION.methodId,
      methodVersion: FIXTURE_RECONCILIATION_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    }),
  );
  return { log, outcome };
}

/** THE KILL-SWITCH MID-FLIGHT PATH: the switch throws after acknowledgment — escalate + record, log UNCHANGED. */
export function buildKillSwitchMidFlightScenario(): { log: OrderLifecycleLog; outcome: KillSwitchResponseOutcome } {
  const log = buildAcknowledgedLog();
  const outcome = unwrap(
    respondToKillSwitch({
      log,
      killSwitch: FIXTURE_THROWN_SWITCH,
      orderClock: FIXTURE_CLOCKS.switchResponse,
      methodId: FIXTURE_SWITCH_CITATION.methodId,
      methodVersion: FIXTURE_SWITCH_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    }),
  );
  return { log, outcome };
}

/** THE CANCELLATION-RACE PATH: the final fill lands first; the cancel attempt is refused and RECORDED. */
export function buildCancellationRaceScenario(): { log: OrderLifecycleLog; outcome: CancellationOutcome } {
  const log = buildHappyPathLog(); // ... -> filled
  const outcome = unwrap(
    attemptCancellation({
      log,
      cancelConfirmationRef: FIXTURE_CANCEL_CONFIRMATION,
      orderClock: FIXTURE_CLOCKS.cancelAttempt,
      methodId: FIXTURE_CANCELLATION_CITATION.methodId,
      methodVersion: FIXTURE_CANCELLATION_CITATION.methodVersion,
      registry: FIXTURE_REGISTRY,
    }),
  );
  return { log, outcome };
}

// ---------------------------------------------------------------------------
// The golden scenario fixtures (built once, exported frozen)
// ---------------------------------------------------------------------------

/** THE golden happy path (prepared -> submitted -> acknowledged -> partially_filled -> filled). */
export const FIXTURE_HAPPY_PATH: OrderLifecycleLog = deepFreeze(buildHappyPathLog()) as OrderLifecycleLog;

/** THE golden gate-rejection log. */
export const FIXTURE_GATE_REJECTION: OrderLifecycleLog = deepFreeze(buildGateRejectionLog()) as OrderLifecycleLog;

/** THE golden expiry log. */
export const FIXTURE_EXPIRY: OrderLifecycleLog = deepFreeze(buildExpiryLog()) as OrderLifecycleLog;

/** THE golden stuck-ack scenario (the escalated log + the detection outcome). */
export const FIXTURE_STUCK_ACK: { readonly log: OrderLifecycleLog; readonly outcome: StuckDetectionOutcome } = deepFreeze(
  (() => {
    const scenario = buildStuckAckScenario();
    return { log: deepFreeze(scenario.outcome.kind === 'stuck' ? scenario.outcome.log : scenario.log), outcome: scenario.outcome };
  })(),
) as { readonly log: OrderLifecycleLog; readonly outcome: StuckDetectionOutcome };

/** THE golden stuck-ack escalation record. */
export const FIXTURE_STUCK_ACK_ESCALATION: EscalationRecord | null =
  FIXTURE_STUCK_ACK.outcome.kind === 'stuck' ? FIXTURE_STUCK_ACK.outcome.escalation : null;

/** THE golden reconciled scenario (exact equality: 0.5 + 0.25 = 0.75). */
export const FIXTURE_RECONCILED: { readonly log: OrderLifecycleLog; readonly outcome: FillReconciliationOutcome } = deepFreeze(
  buildReconciledScenario(),
) as { readonly log: OrderLifecycleLog; readonly outcome: FillReconciliationOutcome };

/** THE golden reconciliation-gap scenario (one grid step short: 0.5 + 0.24 = 0.74 = 0.75 - 0.01). */
export const FIXTURE_RECONCILIATION_GAP: { readonly log: OrderLifecycleLog; readonly outcome: FillReconciliationOutcome } = deepFreeze(
  buildReconciliationGapScenario(),
) as { readonly log: OrderLifecycleLog; readonly outcome: FillReconciliationOutcome };

/** THE golden kill-switch mid-flight scenario (log UNCHANGED + the escalation record). */
export const FIXTURE_KILL_SWITCH_MID_FLIGHT: { readonly log: OrderLifecycleLog; readonly outcome: KillSwitchResponseOutcome } = deepFreeze(
  buildKillSwitchMidFlightScenario(),
) as { readonly log: OrderLifecycleLog; readonly outcome: KillSwitchResponseOutcome };

/** THE golden mid-flight escalation record. */
export const FIXTURE_KILL_SWITCH_ESCALATION: EscalationRecord | null =
  FIXTURE_KILL_SWITCH_MID_FLIGHT.outcome.kind === 'escalated'
    ? FIXTURE_KILL_SWITCH_MID_FLIGHT.outcome.escalation
    : null;

/** THE golden cancellation-race scenario (refused + the race escalation record). */
export const FIXTURE_CANCELLATION_RACE: { readonly log: OrderLifecycleLog; readonly outcome: CancellationOutcome } = deepFreeze(
  buildCancellationRaceScenario(),
) as { readonly log: OrderLifecycleLog; readonly outcome: CancellationOutcome };

/** THE golden cancellation-race escalation record. */
export const FIXTURE_CANCELLATION_RACE_ESCALATION: EscalationRecord | null =
  FIXTURE_CANCELLATION_RACE.outcome.kind === 'refused' ? FIXTURE_CANCELLATION_RACE.outcome.escalation : null;

/** THE reference body spec (the authored record — the violation builders copy it). */
export const FIXTURE_BODY: ExecutionBodySpec = EXECUTION_BODY;

// ---------------------------------------------------------------------------
// The body-spec violation fixtures (the L8/L16/L16a negative scenarios)
// ---------------------------------------------------------------------------

/** Deep-copies the reference body spec (the violation base). */
function doctoredBody(): ExecutionBodySpec {
  return JSON.parse(JSON.stringify(EXECUTION_BODY)) as ExecutionBodySpec;
}

/** NEGATIVE: EXECUTE in allowedActions with executionAuthority 'none' (the un-paired claim — execution_authority_granted). */
export function executionGrantedBodySpec(): ExecutionBodySpec {
  const spec = doctoredBody();
  (spec.bodyVersion.composition.authorityBoundary as unknown as { executionAuthority: string }).executionAuthority = 'none';
  return spec;
}

/** NEGATIVE: a model-autonomous execution-authority claim (outside the closed mirror set — execution_authority_granted). */
export function modelAutonomousBodySpec(): ExecutionBodySpec {
  const spec = doctoredBody();
  (spec.bodyVersion.composition.authorityBoundary as unknown as { executionAuthority: string }).executionAuthority = 'model-autonomous';
  return spec;
}

/** NEGATIVE: the reference role declaring 'none' (a researcher-shaped spec in the order lane — execution_authority_granted). */
export function noneModeBodySpec(): ExecutionBodySpec {
  const spec = doctoredBody();
  const boundary = spec.bodyVersion.composition.authorityBoundary as unknown as {
    allowedActions: string[];
    executionAuthority: string;
  };
  boundary.allowedActions = boundary.allowedActions.filter((action) => action !== 'EXECUTE');
  boundary.executionAuthority = 'none';
  return spec;
}

/** NEGATIVE: EXECUTE in prohibitedActions (the gateway-request action prohibited — execute_prohibited). */
export function executeProhibitedBodySpec(): ExecutionBodySpec {
  const spec = doctoredBody();
  (spec.bodyVersion.composition.authorityBoundary.prohibitedActions as unknown as string[]).push('EXECUTE');
  return spec;
}

/** NEGATIVE: a consequential (venue-direct) tool in a procedure (consequential_tool_in_procedure). */
export function consequentialToolBodySpec(): ExecutionBodySpec {
  const spec = doctoredBody();
  const step = spec.bodyVersion.composition.procedures[0]?.steps[3] as unknown as { toolRefs: string[] };
  step.toolRefs = [...step.toolRefs, 'tools/venue-direct-order-entry'];
  return spec;
}

/** NEGATIVE: a strategic clock declaration (clock_confusion — the L16 separation). */
export function strategicClockBodySpec(): ExecutionBodySpec {
  const spec = doctoredBody();
  (spec.execution as { clock: string }).clock = 'strategic';
  return spec;
}

/** NEGATIVE: a strategic-level-control authority-scope claim (strategic_level_control — the L16 separation). */
export function strategicControlBodySpec(): ExecutionBodySpec {
  const spec = doctoredBody();
  (spec.execution.authorityScope as { strategicLevelControl: string }).strategicLevelControl = 'permitted';
  return spec;
}

/** NEGATIVE: a reserved kernel publication topic (reserved_publication_topic). */
export function reservedTopicBodySpec(): ExecutionBodySpec {
  const spec = doctoredBody();
  (spec.execution.topics as { escalations: string }).escalations = 'kernel.escalate';
  return spec;
}

/** NEGATIVE: a model identity as evaluation evidence (model_identity_as_evidence — L16a). */
export function modelIdentityEvidenceBodySpec(): ExecutionBodySpec {
  const spec = doctoredBody();
  (spec.execution.evaluationCriteriaRefs as unknown as string[]).push('acme-models/reasoner-2@2026.03');
  return spec;
}

/** NEGATIVE: a non-order-lifecycle capability category (non_execution_capability). */
export function nonExecutionCapabilityBodySpec(): ExecutionBodySpec {
  const spec = doctoredBody();
  (spec.bodyVersion.composition.capabilities[0] as { category: string }).category = 'research';
  return spec;
}

// ---------------------------------------------------------------------------
// The clock-violation fixtures (the L16 negative scenarios)
// ---------------------------------------------------------------------------

/** The preparation input with the strategic instant copied into the order clock (clock_confusion). */
export const FIXTURE_CLOCK_CONFUSED_PREPARATION = deepFreeze({
  ...FIXTURE_PREPARATION_INPUT,
  orderClock: FIXTURE_T0, // === decisionAsOf — the strategic instant stamped into the order-level clock
});

/** The preparation input with the order clock BEFORE the decision (timestamp_order — causality). */
export const FIXTURE_BACKWARD_PREPARATION = deepFreeze({
  ...FIXTURE_PREPARATION_INPUT,
  orderClock: FIXTURE_T0 - 1,
});

/** The happy-path record doctored with a strategic `asOf` field (clock_confusion — the field-name crime). */
export function strategicAsOfRecord(): Record<string, unknown> {
  const record = (FIXTURE_HAPPY_PATH.records[0] as unknown) as Record<string, unknown>;
  return { ...record, asOf: FIXTURE_T0 };
}
