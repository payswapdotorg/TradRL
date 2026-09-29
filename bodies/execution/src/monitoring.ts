// @tradrl/body-execution — the declared monitoring and escalation
// procedures.
//
// Owning Work Order: T025, "Monitoring and escalation": "declared
// monitoring procedures — stuck-order detection (ack deadline exceeded
// -> an `EscalationRecord`, never an exception, never a silent
// timeout); fill reconciliation (cumulative fills vs the acknowledged
// quantity — a mismatch of one smallest-grid step is a typed
// `reconciliation_gap`); cancellation policy; kill-switch mid-flight
// (a thrown switch after submission -> the body escalates and records,
// NEVER fabricates a fill or a cancel)."
//
// THE MONITORING LAW: every monitoring procedure produces RECORDS —
// escalation records, reconciliation records, transition records —
// never an exception, never a silent timeout, never a fabricated
// terminal state. Each procedure cites its declared, versioned method
// (resolved against the registry — an order-management procedure
// without one is the typed `undeclared_method` error).
//
// THE KILL-SWITCH LAW (L8/L24 at the order level): a thrown switch
// observed mid-flight produces an ESCALATION RECORD and the lifecycle
// log stays EXACTLY as it is — the response function structurally
// CANNOT produce a fill or a cancel record (it returns only an
// escalation; the fabrication would have to go through the lifecycle
// lane's evidence laws, which refuse it with `fill_fabricated` /
// `cancel_fabricated`).

import {
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  stableDigestJson,
  type TimestampMs,
} from './primitives';
import {
  type EscalationRecordId,
  type MethodId,
  type MethodVersionRef,
  type OrderRef,
  type DecisionRef,
  type ProjectId,
  type TenantId,
  type KillSwitchRef,
  isEscalationRecordId,
  isMethodId,
  isMethodVersionRef,
  isOrderRef,
  isDecisionRef,
  isTenantId,
  isProjectId,
  isKillSwitchRef,
} from './ids';
import {
  type ExecutionBodyError,
  type ExecutionBodyResult,
  invalidField,
  invalidType,
} from './errors';
import {
  type FillEvidence,
  type OrderLifecycleLog,
  type OrderLifecycleRecord,
  type OrderState,
  currentOrderState,
  cumulativeFills,
  genesisRecord,
  validateOrderLifecycleLog,
  appendOrderLifecycleEvent,
} from './lifecycle'; // the lifecycle lane's own discipline
import {
  type MethodRegistry,
  EXECUTION_STUCK_ORDER_DETECTION_METHOD,
  EXECUTION_FILL_RECONCILIATION_METHOD,
  EXECUTION_CANCELLATION_POLICY_METHOD,
  EXECUTION_KILL_SWITCH_RESPONSE_METHOD,
  resolveMethodCitation,
  type StuckOrderDetectionParameters,
  type FillReconciliationParameters,
  type CancellationPolicyParameters,
} from './methods';
import { compareDecimal, decimalAbs, decimalSubtract, decimalSum } from './decimals';
import { type KillSwitchStandingStateMirror, isKillSwitchStandingStateMirror } from './intake';

// ---------------------------------------------------------------------------
// The escalation records (typed data, never an exception)
// ---------------------------------------------------------------------------

/** The closed escalation-reason vocabulary (enumerated, never prose). */
export const ESCALATION_REASONS = [
  'ack-deadline-exceeded',
  'fill-deadline-exceeded',
  'reconciliation-gap',
  'kill-switch-mid-flight',
  'cancellation-race',
] as const;

/** A typed escalation reason. */
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

/** Guard: an escalation reason. */
export const isEscalationReason = (v: unknown): v is EscalationReason =>
  typeof v === 'string' && (ESCALATION_REASONS as readonly string[]).includes(v);

/**
 * THE structured escalation detail — enumerated data per reason, never
 * free text: the exceeded deadline (stuck detections), the exact gap
 * (reconciliation), the switch evidence (kill-switch), the race's
 * terminal state (cancellation race).
 */
export type EscalationDetail =
  | { readonly kind: 'deadline'; readonly event: 'ack-deadline-exceeded' | 'fill-deadline-exceeded'; readonly deadlineMs: number; readonly waitedMs: number }
  | { readonly kind: 'gap'; readonly acknowledgedQuantity: string; readonly cumulativeFillQuantity: string; readonly gap: string; readonly quantityGridStep: string }
  | { readonly kind: 'kill-switch'; readonly switchId: string; readonly thrownAt: TimestampMs; readonly reason: string }
  | { readonly kind: 'race'; readonly terminalState: OrderState; readonly note: 'fill-landed-first' };

/** Guard: `EscalationDetail`. */
export function isEscalationDetail(v: unknown): v is EscalationDetail {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'deadline':
      return (
        (v.event === 'ack-deadline-exceeded' || v.event === 'fill-deadline-exceeded') &&
        typeof v.deadlineMs === 'number' && Number.isSafeInteger(v.deadlineMs) && v.deadlineMs >= 1 &&
        typeof v.waitedMs === 'number' && Number.isSafeInteger(v.waitedMs) && v.waitedMs >= 0
      );
    case 'gap':
      return (
        typeof v.acknowledgedQuantity === 'string' && v.acknowledgedQuantity !== '' &&
        typeof v.cumulativeFillQuantity === 'string' && v.cumulativeFillQuantity !== '' &&
        typeof v.gap === 'string' && v.gap !== '' &&
        typeof v.quantityGridStep === 'string' && v.quantityGridStep !== ''
      );
    case 'kill-switch':
      return (
        typeof v.switchId === 'string' && v.switchId !== '' &&
        isTimestampMs(v.thrownAt) &&
        typeof v.reason === 'string' && v.reason !== ''
      );
    case 'race':
      return (
        typeof v.terminalState === 'string' &&
        (['filled', 'cancelled', 'rejected', 'expired'] as readonly string[]).includes(v.terminalState) &&
        v.note === 'fill-landed-first'
      );
    default:
      return false;
  }
}

/**
 * THE ESCALATION RECORD: the stuck/anomaly verdict as structured data.
 * Carries the order ref, the decision ref (the authority that drove
 * the order), the typed reason + detail, the observed state at
 * escalation, the ORDER-LEVEL clock marker (L16 — escalations are
 * order-level events), the opaque evidence refs, the method citation,
 * and the tenant/project scope. The id is DERIVED (`esc-<digest>`),
 * never random.
 */
export interface EscalationRecord {
  readonly escalationId: EscalationRecordId;
  readonly orderRef: OrderRef;
  readonly decisionRef: DecisionRef;
  readonly reason: EscalationReason;
  readonly detail: EscalationDetail;
  /** The order state observed at escalation time. */
  readonly observedState: OrderState;
  /** THE L16 CLOCK MARKER: the escalation's order-level instant. */
  readonly orderClock: TimestampMs;
  /** Opaque evidence refs (the records this escalation cites). */
  readonly evidence: readonly string[];
  readonly methodId: MethodId;
  readonly methodVersion: MethodVersionRef;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** The escalation record's content tree (everything except the derived id). */
function escalationContentTree(record: Omit<EscalationRecord, 'escalationId'>): Parameters<typeof stableDigestJson>[0] {
  return {
    orderRef: record.orderRef,
    decisionRef: record.decisionRef,
    reason: record.reason,
    detail: record.detail,
    observedState: record.observedState,
    orderClock: record.orderClock,
    evidence: [...record.evidence],
    methodId: record.methodId,
    methodVersion: record.methodVersion,
    tenant: record.tenant,
    project: record.project,
  };
}

/** Derives the escalation id: `esc-` + 16-hex digest of the canonical content. */
export function expectedEscalationId(record: Omit<EscalationRecord, 'escalationId'>): EscalationRecordId {
  return `esc-${stableDigestJson(escalationContentTree(record) as never)}` as EscalationRecordId;
}

/** COLLECT-ALL validation of an escalation record. */
export function validateEscalationRecord(v: unknown, path = ''): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(v)) return [invalidType(path || 'escalation', 'an escalation record')];
  if (!isEscalationRecordId(v.escalationId)) errors.push(invalidField(`${path}escalationId`, 'must be a derived `esc-<digest>` identity'));
  if (!isOrderRef(v.orderRef)) errors.push(invalidField(`${path}orderRef`, 'must be a compact order identity'));
  if (!isDecisionRef(v.decisionRef)) errors.push(invalidField(`${path}decisionRef`, 'must be the gateway decision ref (\'xd:\'-prefixed)'));
  if (!isEscalationReason(v.reason)) errors.push(invalidField(`${path}reason`, `must be one of ${ESCALATION_REASONS.join('|')}`));
  if (!isEscalationDetail(v.detail)) errors.push(invalidField(`${path}detail`, 'must be the typed escalation detail for the declared reason'));
  if (typeof v.observedState !== 'string' || !['prepared', 'submitted', 'acknowledged', 'partially_filled', 'filled', 'cancelled', 'rejected', 'expired', 'stuck'].includes(v.observedState)) {
    errors.push(invalidField(`${path}observedState`, 'must be a declared order state'));
  }
  if (!isTimestampMs(v.orderClock)) errors.push(invalidField(`${path}orderClock`, 'must be a valid epoch-millisecond ORDER-LEVEL instant (the L16 clock marker)'));
  if (!Array.isArray(v.evidence) || !v.evidence.every((ref) => typeof ref === 'string' && (ref as string) !== '')) {
    errors.push(invalidField(`${path}evidence`, 'must be an array of opaque evidence refs'));
  }
  if (!isMethodId(v.methodId)) errors.push(invalidField(`${path}methodId`, 'must be a non-empty method reference'));
  if (!isMethodVersionRef(v.methodVersion)) errors.push(invalidField(`${path}methodVersion`, 'must be a strict X.Y.Z version'));
  if (!isTenantId(v.tenant)) errors.push({ code: 'tenant_missing', path: `${path}tenant`, message: 'the escalation must carry a tenant scope (L12)' });
  if (!isProjectId(v.project)) errors.push({ code: 'project_missing', path: `${path}project`, message: 'the escalation must carry a project scope (L12/L15)' });
  // The detail/reason coherence law.
  if (isEscalationDetail(v.detail) && isEscalationReason(v.reason)) {
    const detail = v.detail;
    const reason = v.reason;
    const coherent =
      (reason === 'ack-deadline-exceeded' || reason === 'fill-deadline-exceeded')
        ? detail.kind === 'deadline' && detail.event === reason
        : reason === 'reconciliation-gap'
          ? detail.kind === 'gap'
          : reason === 'kill-switch-mid-flight'
            ? detail.kind === 'kill-switch'
            : detail.kind === 'race';
    if (!coherent) {
      errors.push(invalidField(`${path}detail`, `the detail kind must match the reason ${JSON.stringify(reason)}`));
    }
  }
  // The derived-identity law.
  if (isEscalationRecordId(v.escalationId) && isOrderRef(v.orderRef) && isDecisionRef(v.decisionRef) && isEscalationReason(v.reason) && isEscalationDetail(v.detail)) {
    const candidate = v as unknown as EscalationRecord;
    if (expectedEscalationId(candidate) !== v.escalationId) {
      errors.push({ code: 'digest_mismatch', path: `${path}escalationId`, message: 'the derived escalation id does not bind the record content (L9)' });
    }
  }
  return errors;
}

/** Guard: `EscalationRecord`. */
export function isEscalationRecord(v: unknown): v is EscalationRecord {
  return validateEscalationRecord(v).length === 0;
}

/** Canonical serialization of an escalation record (byte-deterministic, L9). */
export function canonicalEscalationJson(record: EscalationRecord): string {
  return canonicalJson(record as never);
}

/** Builds a validated, deeply-frozen escalation record (refusal is typed data). */
export function createEscalationRecord(draft: unknown): ExecutionBodyResult<EscalationRecord> {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(draft)) return { ok: false, errors: [invalidType('escalation', 'an escalation record draft')] };
  // The content fields must be PRESENT before the derived id can be
  // computed (the digest runs over canonical JSON — undefined fields
  // refuse here, never crash the digest).
  const fields: readonly string[] = ['orderRef', 'decisionRef', 'reason', 'detail', 'observedState', 'orderClock', 'methodId', 'methodVersion', 'tenant', 'project'];
  for (const field of fields) {
    if (draft[field] === undefined) {
      errors.push(invalidField(field, 'the field is required (the derived id binds the full content)'));
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const content: Omit<EscalationRecord, 'escalationId'> = {
    orderRef: draft.orderRef as OrderRef,
    decisionRef: draft.decisionRef as DecisionRef,
    reason: draft.reason as EscalationReason,
    detail: draft.detail as EscalationDetail,
    observedState: draft.observedState as OrderState,
    orderClock: draft.orderClock as TimestampMs,
    evidence: Array.isArray(draft.evidence) ? [...(draft.evidence as readonly string[])] : [],
    methodId: draft.methodId as MethodId,
    methodVersion: draft.methodVersion as MethodVersionRef,
    tenant: draft.tenant as TenantId,
    project: draft.project as ProjectId,
  };
  const escalated = validateEscalationRecord({ ...content, escalationId: expectedEscalationId(content) });
  if (escalated.length > 0) return { ok: false, errors: escalated };
  return {
    ok: true,
    value: deepFreeze({ ...content, escalationId: expectedEscalationId(content) }) as EscalationRecord,
  };
}

// ---------------------------------------------------------------------------
// The reconciliation records (exact equality — the typed gap)
// ---------------------------------------------------------------------------

/** One reconciliation's status: exactly reconciled, or a typed gap. */
export const RECONCILIATION_STATUSES = ['reconciled', 'gap'] as const;

/** A reconciliation status. */
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

/** Guard: a reconciliation status. */
export const isReconciliationStatus = (v: unknown): v is ReconciliationStatus =>
  v === 'reconciled' || v === 'gap';

/**
 * THE RECONCILIATION RECORD: the exact-equality verdict of cumulative
 * fills vs the acknowledged quantity, as structured data — the gap
 * carries the EXACT decimal difference (one smallest-grid-step off is
 * the named minimum; the record states the precise amount). `gap` is
 * null iff reconciled. The id is DERIVED (`rcn-<digest>`).
 */
export interface ReconciliationRecord {
  /** Derived identity: `rcn-` + 16-hex digest. */
  readonly reconciliationId: string;
  readonly orderRef: OrderRef;
  readonly decisionRef: DecisionRef;
  /** The quantity the venue acknowledged (canonical positive decimal). */
  readonly acknowledgedQuantity: string;
  /** The cumulative fill quantity at the declared scale (exact sum). */
  readonly cumulativeFillQuantity: string;
  /** The EXACT difference (acknowledged - cumulative); null iff reconciled. */
  readonly gap: string | null;
  readonly status: ReconciliationStatus;
  /** The cumulative fill evidence set (the exact inputs). */
  readonly fills: readonly FillEvidence[];
  /** THE L16 CLOCK MARKER: the reconciliation's order-level instant. */
  readonly orderClock: TimestampMs;
  readonly methodId: MethodId;
  readonly methodVersion: MethodVersionRef;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Derives the reconciliation id: `rcn-` + 16-hex digest of the canonical content. */
export function expectedReconciliationId(record: Omit<ReconciliationRecord, 'reconciliationId'>): string {
  return `rcn-${stableDigestJson({
    orderRef: record.orderRef,
    decisionRef: record.decisionRef,
    acknowledgedQuantity: record.acknowledgedQuantity,
    cumulativeFillQuantity: record.cumulativeFillQuantity,
    gap: record.gap,
    status: record.status,
    fills: record.fills.map((fill) => ({ fillRef: fill.fillRef, quantity: fill.quantity, orderClock: fill.orderClock })),
    orderClock: record.orderClock,
    methodId: record.methodId,
    methodVersion: record.methodVersion,
    tenant: record.tenant,
    project: record.project,
  } as never)}`;
}

/** COLLECT-ALL validation of a reconciliation record. */
export function validateReconciliationRecord(v: unknown, path = ''): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(v)) return [invalidType(path || 'reconciliation', 'a reconciliation record')];
  if (typeof v.reconciliationId !== 'string' || !v.reconciliationId.startsWith('rcn-')) {
    errors.push(invalidField(`${path}reconciliationId`, 'must be a derived `rcn-<digest>` identity'));
  }
  if (!isOrderRef(v.orderRef)) errors.push(invalidField(`${path}orderRef`, 'must be a compact order identity'));
  if (!isDecisionRef(v.decisionRef)) errors.push(invalidField(`${path}decisionRef`, 'must be the gateway decision ref (\'xd:\'-prefixed)'));
  if (typeof v.acknowledgedQuantity !== 'string' || v.acknowledgedQuantity === '') {
    errors.push(invalidField(`${path}acknowledgedQuantity`, 'must be the acknowledged quantity (canonical positive decimal)'));
  }
  if (typeof v.cumulativeFillQuantity !== 'string' || v.cumulativeFillQuantity === '') {
    errors.push(invalidField(`${path}cumulativeFillQuantity`, 'must be the cumulative fill quantity at the declared scale'));
  }
  if (!isReconciliationStatus(v.status)) errors.push(invalidField(`${path}status`, 'must be \'reconciled\' or \'gap\''));
  if (!isTimestampMs(v.orderClock)) errors.push(invalidField(`${path}orderClock`, 'must be a valid epoch-millisecond ORDER-LEVEL instant (the L16 clock marker)'));
  if (!Array.isArray(v.fills) || !v.fills.every((fill) => isRecord(fill) && typeof (fill as Record<string, unknown>).fillRef === 'string' && (fill as Record<string, unknown>).fillRef !== '')) {
    errors.push(invalidField(`${path}fills`, 'must be an array of fill evidence records'));
  }
  if (!isMethodId(v.methodId)) errors.push(invalidField(`${path}methodId`, 'must be a non-empty method reference'));
  if (!isMethodVersionRef(v.methodVersion)) errors.push(invalidField(`${path}methodVersion`, 'must be a strict X.Y.Z version'));
  if (!isTenantId(v.tenant)) errors.push({ code: 'tenant_missing', path: `${path}tenant`, message: 'the reconciliation must carry a tenant scope (L12)' });
  if (!isProjectId(v.project)) errors.push({ code: 'project_missing', path: `${path}project`, message: 'the reconciliation must carry a project scope (L12/L15)' });
  // The status/gap coherence law.
  if (isReconciliationStatus(v.status)) {
    if (v.status === 'reconciled' && v.gap !== null) {
      errors.push(invalidField(`${path}gap`, 'a reconciled record carries gap null (exact equality)'));
    }
    if (v.status === 'gap' && typeof v.gap !== 'string') {
      errors.push(invalidField(`${path}gap`, 'a gap record carries the EXACT decimal difference'));
    }
  }
  // The derived-identity law.
  if (typeof v.reconciliationId === 'string' && v.reconciliationId.startsWith('rcn-') && isOrderRef(v.orderRef) && isDecisionRef(v.decisionRef) && isReconciliationStatus(v.status)) {
    const candidate = v as unknown as ReconciliationRecord;
    if (expectedReconciliationId(candidate) !== v.reconciliationId) {
      errors.push({ code: 'digest_mismatch', path: `${path}reconciliationId`, message: 'the derived reconciliation id does not bind the record content (L9)' });
    }
  }
  return errors;
}

/** Guard: `ReconciliationRecord`. */
export function isReconciliationRecord(v: unknown): v is ReconciliationRecord {
  return validateReconciliationRecord(v).length === 0;
}

/**
 * THE TYPED reconciliation_gap VIOLATIONS of a reconciliation record:
 * empty iff the record is reconciled; otherwise the typed error
 * carrying the exact difference (one smallest-grid-step off is the
 * named minimum — the record states the precise amount).
 */
export function reconciliationViolations(record: ReconciliationRecord): readonly ExecutionBodyError[] {
  if (record.status === 'reconciled') return [];
  return [
    {
      code: 'reconciliation_gap',
      path: 'cumulativeFillQuantity',
      message: `the cumulative fill quantity ${JSON.stringify(record.cumulativeFillQuantity)} does NOT equal the acknowledged quantity ${JSON.stringify(record.acknowledgedQuantity)} at exact equality — the EXACT gap is ${JSON.stringify(record.gap)} (reconciliation demands exact equality; one smallest-grid-step off is the typed reconciliation_gap)`,
    },
  ];
}

/** Canonical serialization of a reconciliation record (byte-deterministic, L9). */
export function canonicalReconciliationJson(record: ReconciliationRecord): string {
  return canonicalJson(record as never);
}

// ---------------------------------------------------------------------------
// Procedure 1: stuck-order detection (never an exception, never silent)
// ---------------------------------------------------------------------------

/** The stuck-detection procedure input. */
export interface StuckDetectionInput {
  /** The lifecycle log under watch. */
  readonly log: OrderLifecycleLog;
  /** THE L16 CLOCK MARKER: the order-level instant the check runs at. */
  readonly orderClock: TimestampMs;
  /** The method citation (resolved against the registry — the declared deadlines). */
  readonly methodId: string;
  readonly methodVersion: string;
  /** The registry carrying the declared method. */
  readonly registry: MethodRegistry;
}

/** The stuck-detection outcome: within deadline, or stuck (transition + escalation). */
export type StuckDetectionOutcome =
  | { readonly kind: 'within-deadline'; readonly checkedAt: TimestampMs; readonly state: OrderState }
  | { readonly kind: 'stuck'; readonly log: OrderLifecycleLog; readonly record: OrderLifecycleRecord; readonly escalation: EscalationRecord };

/**
 * THE STUCK-ORDER DETECTION PROCEDURE: watches the declared deadlines.
 * `submitted` without acknowledgment past the declared ack deadline,
 * or `acknowledged` without fill progress past the declared fill
 * deadline, enters `stuck` via the declared transition AND produces an
 * EscalationRecord — never an exception, never a silent timeout, never
 * a fabricated terminal state. Within deadline: the outcome is data
 * (`within-deadline`), not an error.
 */
export function detectStuckOrder(input: unknown): ExecutionBodyResult<StuckDetectionOutcome> {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(input)) return { ok: false, errors: [invalidType('detection', 'a stuck detection input record')] };
  const logErrors = validateOrderLifecycleLog(input.log);
  if (logErrors.length > 0) return { ok: false, errors: logErrors };
  const log = input.log as OrderLifecycleLog;
  if (!isTimestampMs(input.orderClock)) {
    return { ok: false, errors: [invalidField('orderClock', 'must be a valid epoch-millisecond ORDER-LEVEL instant (the L16 clock marker)')] };
  }
  errors.push(...resolveMethodCitation(input.registry as MethodRegistry, input.methodId, input.methodVersion, 'stuck-order-detection'));
  if (errors.length > 0) return { ok: false, errors };

  const registry = input.registry as MethodRegistry;
  const method = registry.methods.find(
    (m) => m.methodId === (input.methodId as string),
  ) as (typeof registry.methods)[number] | undefined;
  const parameters = method?.parameters as StuckOrderDetectionParameters | undefined;
  if (parameters === undefined) {
    return { ok: false, errors: [invalidField('methodId', 'the stuck-order-detection method must be declared in the registry')] };
  }

  const state = currentOrderState(log);
  const orderClock = input.orderClock as TimestampMs;
  const last = log.records[log.records.length - 1] as OrderLifecycleRecord;
  const waitedMs = orderClock - last.orderClock;

  // The declared deadline for the observed state.
  let event: 'ack-deadline-exceeded' | 'fill-deadline-exceeded' | null = null;
  if (state === 'submitted' && waitedMs > parameters.ackDeadlineMs) {
    event = 'ack-deadline-exceeded';
  } else if (state === 'acknowledged' && waitedMs > parameters.fillDeadlineMs) {
    event = 'fill-deadline-exceeded';
  }

  if (event === null) {
    // Within deadline — data, not an error; the clock marker is the
    // order-level instant the check ran at (L16).
    return { ok: true, value: { kind: 'within-deadline', checkedAt: orderClock, state } };
  }

  // THE ESCALATION FIRST (the record binds the stuck transition).
  const genesis = genesisRecord(log) as OrderLifecycleRecord;
  const escalationDraft: Omit<EscalationRecord, 'escalationId'> = {
    orderRef: log.orderRef,
    decisionRef: genesis.decisionRef,
    reason: event,
    detail: {
      kind: 'deadline',
      event,
      deadlineMs: event === 'ack-deadline-exceeded' ? parameters.ackDeadlineMs : parameters.fillDeadlineMs,
      waitedMs,
    },
    observedState: state,
    orderClock,
    evidence: [genesis.decisionRef, last.lifecycleId],
    methodId: input.methodId as MethodId,
    methodVersion: input.methodVersion as MethodVersionRef,
    tenant: genesis.tenant,
    project: genesis.project,
  };
  const escalation: EscalationRecord = deepFreeze({
    ...escalationDraft,
    escalationId: expectedEscalationId(escalationDraft),
  }) as EscalationRecord;

  // THE STUCK TRANSITION (the declared motion, citing the escalation).
  const transition = appendOrderLifecycleEvent(
    log,
    {
      event,
      orderClock,
      escalationRef: escalation.escalationId,
      methodId: input.methodId,
      methodVersion: input.methodVersion,
    },
    registry,
  );
  if (!transition.ok) return transition;
  const transitioned = transition.value;
  const record = transitioned.records[transitioned.records.length - 1] as OrderLifecycleRecord;
  return { ok: true, value: { kind: 'stuck', log: transitioned, record, escalation } };
}

// ---------------------------------------------------------------------------
// Procedure 2: fill reconciliation (exact equality — the typed gap)
// ---------------------------------------------------------------------------

/** The fill-reconciliation procedure input. */
export interface FillReconciliationInput {
  /** The lifecycle log whose cumulative fills are reconciled. */
  readonly log: OrderLifecycleLog;
  /** The quantity the venue acknowledged (canonical positive decimal). */
  readonly acknowledgedQuantity: string;
  /** THE L16 CLOCK MARKER: the order-level instant the reconciliation runs at. */
  readonly orderClock: TimestampMs;
  /** The method citation (resolved against the registry — the declared scale/rounding). */
  readonly methodId: string;
  readonly methodVersion: string;
  readonly registry: MethodRegistry;
}

/** The reconciliation outcome: the record (always), plus the typed gap errors (iff gap). */
export type FillReconciliationOutcome = {
  readonly record: ReconciliationRecord;
  readonly violations: readonly ExecutionBodyError[];
};

/**
 * THE FILL-RECONCILIATION PROCEDURE: cumulative fills vs the
 * acknowledged quantity at EXACT equality. The outcome ALWAYS carries
 * the durable record (the reconciliation is evidence, never an
 * exception); when the quantities differ — by one smallest-grid step
 * or any other amount — the record's status is `gap` and the typed
 * `reconciliation_gap` violations ride along. The arithmetic is exact
 * (BigInt fixed-point at the declared scale — never a float sum).
 */
export function reconcileFills(input: unknown): ExecutionBodyResult<FillReconciliationOutcome> {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(input)) return { ok: false, errors: [invalidType('reconciliation', 'a fill reconciliation input record')] };
  const logErrors = validateOrderLifecycleLog(input.log);
  if (logErrors.length > 0) return { ok: false, errors: logErrors };
  const log = input.log as OrderLifecycleLog;
  if (typeof input.acknowledgedQuantity !== 'string' || input.acknowledgedQuantity === '') {
    return { ok: false, errors: [invalidField('acknowledgedQuantity', 'must be the acknowledged quantity (canonical positive decimal)')] };
  }
  if (!isTimestampMs(input.orderClock)) {
    return { ok: false, errors: [invalidField('orderClock', 'must be a valid epoch-millisecond ORDER-LEVEL instant (the L16 clock marker)')] };
  }
  errors.push(...resolveMethodCitation(input.registry as MethodRegistry, input.methodId, input.methodVersion, 'fill-reconciliation'));
  if (errors.length > 0) return { ok: false, errors };

  const registry = input.registry as MethodRegistry;
  const method = registry.methods.find((m) => m.methodId === (input.methodId as string));
  const parameters = method?.parameters as FillReconciliationParameters | undefined;
  if (parameters === undefined) {
    return { ok: false, errors: [invalidField('methodId', 'the fill-reconciliation method must be declared in the registry')] };
  }

  const genesis = genesisRecord(log) as OrderLifecycleRecord;
  const fills = cumulativeFills(log);
  const cumulative = decimalSum(
    fills.map((fill) => fill.quantity),
    parameters.scale,
    parameters.rounding,
  );
  const difference = decimalSubtract(
    input.acknowledgedQuantity as string,
    cumulative,
    parameters.scale,
    parameters.rounding,
  );
  const gap = compareDecimal(difference, '0') === 0 ? null : decimalAbs(difference, parameters.scale, parameters.rounding);
  const status: ReconciliationStatus = gap === null ? 'reconciled' : 'gap';

  const content: Omit<ReconciliationRecord, 'reconciliationId'> = {
    orderRef: log.orderRef,
    decisionRef: genesis.decisionRef,
    acknowledgedQuantity: input.acknowledgedQuantity as string,
    cumulativeFillQuantity: cumulative,
    gap,
    status,
    fills,
    orderClock: input.orderClock as TimestampMs,
    methodId: input.methodId as MethodId,
    methodVersion: input.methodVersion as MethodVersionRef,
    tenant: genesis.tenant,
    project: genesis.project,
  };
  const record: ReconciliationRecord = deepFreeze({
    ...content,
    reconciliationId: expectedReconciliationId(content),
  }) as ReconciliationRecord;
  const recordErrors = validateReconciliationRecord(record);
  if (recordErrors.length > 0) return { ok: false, errors: recordErrors };
  return { ok: true, value: { record, violations: reconciliationViolations(record) } };
}

// ---------------------------------------------------------------------------
// Procedure 3: the cancellation policy (race recording included)
// ---------------------------------------------------------------------------

/** The cancellation-attempt input. */
export interface CancellationInput {
  /** The lifecycle log to cancel within. */
  readonly log: OrderLifecycleLog;
  /** The gateway's cancel confirmation ref (required — never fabricated). */
  readonly cancelConfirmationRef: string;
  /** THE L16 CLOCK MARKER: the order-level instant of the cancellation attempt. */
  readonly orderClock: TimestampMs;
  /** The method citation. */
  readonly methodId: string;
  readonly methodVersion: string;
  readonly registry: MethodRegistry;
}

/** The cancellation outcome: the cancel transition, or the refusal (+ the race record). */
export type CancellationOutcome =
  | { readonly kind: 'cancelled'; readonly log: OrderLifecycleLog; readonly record: OrderLifecycleRecord }
  | { readonly kind: 'refused'; readonly errors: readonly ExecutionBodyError[]; readonly escalation: EscalationRecord | null };

/**
 * THE CANCELLATION POLICY PROCEDURE: applies the declared cancellation
 * rules. The lawful states are declared by the method (prepared,
 * acknowledged, partially_filled, stuck); the transition requires the
 * gateway's confirmation ref (never fabricated). A cancel attempt
 * against a FILLED order is the cancellation RACE — the fill landed
 * first — and is RECORDED as a cancellation-race escalation (the
 * refusal error rides along). Refusals against other terminal states
 * are plain `lifecycle_violation` (no race, no record).
 */
export function attemptCancellation(input: unknown): ExecutionBodyResult<CancellationOutcome> {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(input)) return { ok: false, errors: [invalidType('cancellation', 'a cancellation input record')] };
  const logErrors = validateOrderLifecycleLog(input.log);
  if (logErrors.length > 0) return { ok: false, errors: logErrors };
  const log = input.log as OrderLifecycleLog;
  if (typeof input.cancelConfirmationRef !== 'string' || !(input.cancelConfirmationRef as string).startsWith('confirm:')) {
    return {
      ok: false,
      errors: [
        {
          code: 'cancel_fabricated',
          path: 'cancelConfirmationRef',
          message: 'the cancellation requires the gateway\'s \'confirm:\'-prefixed confirmation ref — a cancel without its confirmation is fabricated (never fabricate a cancel)',
        },
      ],
    };
  }
  if (!isTimestampMs(input.orderClock)) {
    return { ok: false, errors: [invalidField('orderClock', 'must be a valid epoch-millisecond ORDER-LEVEL instant (the L16 clock marker)')] };
  }
  errors.push(...resolveMethodCitation(input.registry as MethodRegistry, input.methodId, input.methodVersion, 'cancellation-policy'));
  if (errors.length > 0) return { ok: false, errors };

  const registry = input.registry as MethodRegistry;
  const method = registry.methods.find((m) => m.methodId === (input.methodId as string));
  const parameters = method?.parameters as CancellationPolicyParameters | undefined;
  if (parameters === undefined) {
    return { ok: false, errors: [invalidField('methodId', 'the cancellation-policy method must be declared in the registry')] };
  }

  const state = currentOrderState(log);
  const genesis = genesisRecord(log) as OrderLifecycleRecord;

  // The declared lawful states.
  if ((parameters.lawfulCancellationStates as readonly string[]).includes(state)) {
    // The declared transition for the lawful state.
    const event = state === 'prepared'
      ? 'cancel-before-submit'
      : state === 'acknowledged'
        ? 'cancel-unfilled'
        : state === 'partially_filled'
          ? 'cancel-remaining'
          : 'cancel-after-escalation';
    const transition = appendOrderLifecycleEvent(
      log,
      {
        event,
        orderClock: input.orderClock as TimestampMs,
        cancelConfirmationRef: input.cancelConfirmationRef as string,
        methodId: input.methodId,
        methodVersion: input.methodVersion,
      },
      registry,
    );
    if (!transition.ok) return transition;
    const transitioned = transition.value;
    const record = transitioned.records[transitioned.records.length - 1] as OrderLifecycleRecord;
    return { ok: true, value: { kind: 'cancelled', log: transitioned, record } };
  }

  // The refusal — a RACE iff the order filled first; a plain violation otherwise.
  const refusal: ExecutionBodyError = {
    code: 'lifecycle_violation',
    path: 'event',
    message: `the cancellation was refused: the order is in state ${JSON.stringify(state)} — the declared lawful cancellation states are ${parameters.lawfulCancellationStates.join(', ')}`,
  };
  if (state === 'filled') {
    const escalationDraft: Omit<EscalationRecord, 'escalationId'> = {
      orderRef: log.orderRef,
      decisionRef: genesis.decisionRef,
      reason: 'cancellation-race',
      detail: { kind: 'race', terminalState: 'filled', note: 'fill-landed-first' },
      observedState: state,
      orderClock: input.orderClock as TimestampMs,
      evidence: [genesis.decisionRef, (log.records[log.records.length - 1] as OrderLifecycleRecord).lifecycleId],
      methodId: input.methodId as MethodId,
      methodVersion: input.methodVersion as MethodVersionRef,
      tenant: genesis.tenant,
      project: genesis.project,
    };
    const escalation: EscalationRecord = deepFreeze({
      ...escalationDraft,
      escalationId: expectedEscalationId(escalationDraft),
    }) as EscalationRecord;
    return { ok: true, value: { kind: 'refused', errors: [refusal], escalation } };
  }
  return { ok: true, value: { kind: 'refused', errors: [refusal], escalation: null } };
}

// ---------------------------------------------------------------------------
// Procedure 4: kill-switch mid-flight (escalate + record — NEVER fabricate)
// ---------------------------------------------------------------------------

/** The kill-switch response procedure input. */
export interface KillSwitchResponseInput {
  /** The lifecycle log under watch. */
  readonly log: OrderLifecycleLog;
  /** The injected standing switch state (honored as fact, never re-derived). */
  readonly killSwitch: KillSwitchStandingStateMirror;
  /** THE L16 CLOCK MARKER: the order-level instant the response runs at. */
  readonly orderClock: TimestampMs;
  /** The method citation. */
  readonly methodId: string;
  readonly methodVersion: string;
  readonly registry: MethodRegistry;
}

/** The kill-switch response outcome: standing (nothing to do) or escalated (the record; the log UNCHANGED). */
export type KillSwitchResponseOutcome =
  | { readonly kind: 'standing'; readonly state: 'standing' }
  | { readonly kind: 'escalated'; readonly escalation: EscalationRecord; readonly log: OrderLifecycleLog };

/**
 * THE KILL-SWITCH MID-FLIGHT RESPONSE PROCEDURE: a THROWN switch
 * observed while an order is in flight (submitted, acknowledged,
 * partially_filled or stuck — the pre-terminal states) produces an
 * EscalationRecord and the lifecycle log stays EXACTLY as it is. This
 * function structurally CANNOT fabricate a fill or a cancel: it
 * returns only the escalation record and the UNCHANGED log — there is
 * no code path from a thrown switch to a terminal transition. A
 * STANDING switch is data (`standing`) — nothing to do. Terminal
 * orders need no mid-flight response (the lifecycle already ended;
 * the switch cannot un-fill a filled order).
 */
export function respondToKillSwitch(input: unknown): ExecutionBodyResult<KillSwitchResponseOutcome> {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(input)) return { ok: false, errors: [invalidType('response', 'a kill-switch response input record')] };
  const logErrors = validateOrderLifecycleLog(input.log);
  if (logErrors.length > 0) return { ok: false, errors: logErrors };
  const log = input.log as OrderLifecycleLog;
  if (!isKillSwitchStandingStateMirror(input.killSwitch)) {
    return {
      ok: false,
      errors: [invalidField('killSwitch', 'must be the injected kill-switch standing state { state: standing | thrown, switchId, thrownAt, reason }')],
    };
  }
  if (!isTimestampMs(input.orderClock)) {
    return { ok: false, errors: [invalidField('orderClock', 'must be a valid epoch-millisecond ORDER-LEVEL instant (the L16 clock marker)')] };
  }
  errors.push(...resolveMethodCitation(input.registry as MethodRegistry, input.methodId, input.methodVersion, 'kill-switch-response'));
  if (errors.length > 0) return { ok: false, errors };

  const killSwitch = input.killSwitch as KillSwitchStandingStateMirror;
  if (killSwitch.state === 'standing') {
    return { ok: true, value: { kind: 'standing', state: 'standing' } };
  }

  // A THROWN switch: the switch evidence is mandatory (the escalation
  // cites it — opaque refs, never values).
  if (!isKillSwitchRef(killSwitch.switchId)) {
    return { ok: false, errors: [invalidField('killSwitch.switchId', 'a thrown switch\'s evidence requires its \'ksw:\'-prefixed identity')] };
  }

  const state = currentOrderState(log);
  const genesis = genesisRecord(log) as OrderLifecycleRecord;
  const IN_FLIGHT: readonly OrderState[] = ['submitted', 'acknowledged', 'partially_filled', 'stuck'];

  if (!IN_FLIGHT.includes(state)) {
    // Terminal (or still merely prepared — nothing submitted): the
    // switch cannot un-end a terminal lifecycle and nothing is
    // mid-flight. The outcome is data, not an error.
    return { ok: true, value: { kind: 'standing', state: 'standing' } };
  }

  // THE ESCALATION RECORD (and NOTHING else — the log is returned
  // UNCHANGED; never a fabricated fill, never a fabricated cancel).
  const escalationDraft: Omit<EscalationRecord, 'escalationId'> = {
    orderRef: log.orderRef,
    decisionRef: genesis.decisionRef,
    reason: 'kill-switch-mid-flight',
    detail: {
      kind: 'kill-switch',
      switchId: killSwitch.switchId as string,
      thrownAt: killSwitch.thrownAt as TimestampMs,
      reason: killSwitch.reason as string,
    },
    observedState: state,
    orderClock: input.orderClock as TimestampMs,
    evidence: [genesis.decisionRef, (log.records[log.records.length - 1] as OrderLifecycleRecord).lifecycleId, killSwitch.switchId as string],
    methodId: input.methodId as MethodId,
    methodVersion: input.methodVersion as MethodVersionRef,
    tenant: genesis.tenant,
    project: genesis.project,
  };
  const escalation: EscalationRecord = deepFreeze({
    ...escalationDraft,
    escalationId: expectedEscalationId(escalationDraft),
  }) as EscalationRecord;
  return { ok: true, value: { kind: 'escalated', escalation, log } };
}

// ---------------------------------------------------------------------------
// The canonical method citations for the monitoring procedures
// (convenience bindings — the fixtures and tests cite these)
// ---------------------------------------------------------------------------

/** The canonical stuck-order-detection citation. */
export const STUCK_DETECTION_CITATION = deepFreeze({
  methodId: EXECUTION_STUCK_ORDER_DETECTION_METHOD.methodId,
  methodVersion: EXECUTION_STUCK_ORDER_DETECTION_METHOD.version,
}) as { readonly methodId: string; readonly methodVersion: string };

/** The canonical fill-reconciliation citation. */
export const FILL_RECONCILIATION_CITATION = deepFreeze({
  methodId: EXECUTION_FILL_RECONCILIATION_METHOD.methodId,
  methodVersion: EXECUTION_FILL_RECONCILIATION_METHOD.version,
}) as { readonly methodId: string; readonly methodVersion: string };

/** The canonical cancellation-policy citation. */
export const CANCELLATION_POLICY_CITATION = deepFreeze({
  methodId: EXECUTION_CANCELLATION_POLICY_METHOD.methodId,
  methodVersion: EXECUTION_CANCELLATION_POLICY_METHOD.version,
}) as { readonly methodId: string; readonly methodVersion: string };

/** The canonical kill-switch-response citation. */
export const KILL_SWITCH_RESPONSE_CITATION = deepFreeze({
  methodId: EXECUTION_KILL_SWITCH_RESPONSE_METHOD.methodId,
  methodVersion: EXECUTION_KILL_SWITCH_RESPONSE_METHOD.version,
}) as { readonly methodId: string; readonly methodVersion: string };


