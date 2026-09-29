// @tradrl/body-execution — the order-lane publication contracts.
//
// Owning Work Order: T025: "publication.ts: the agent-os envelope
// mirror + an `ExecutionPublicationPort` —
// PUBLISH/SUBSCRIBE/REQUEST/REPORT/ESCALATE only. The body reports
// lifecycle facts upstream; it never publishes order authority."
//
// STRUCTURAL MIRROR of @tradrl/agent-os's MessageEnvelope (law
// D-003/D-004 — never imported; trip-wired in src/interop.test.ts
// against the REAL package): { id, topic, tenantId, sender, payload,
// sequence, causalityId, publishedAt }. The envelope id is DERIVED with
// the kernel's exact formula (`msg:${opId}:${sender}:${sequence}` —
// never random); kernel.* topics are reserved (code
// `reserved_publication_topic`).
//
// PAYLOAD DISCIPLINE (mirroring the kernel's opaque-payload law): the
// envelope's payload is the OPAQUE record reference
// (`lifecycle:<lifecycleId>` / `escalation:<escalationId>` /
// `reconciliation:<reconciliationId>`), BOUND to the full structured
// record which travels alongside it through the port. The port is the
// ONLY seam order-lifecycle outputs leave through, and it refuses
// (typed, never silent):
//   - a free-text or malformed payload          (unstructured_publication)
//   - a payload not bound to the carried record (unstructured_publication)
//   - an invalid record                         (the records' own laws)
//   - a reserved kernel topic                   (reserved_publication_topic)
//
// THE PORT LAW (L8 at the seam): the port's expressible operations are
// PUBLISH, SUBSCRIBE, REQUEST, REPORT and ESCALATE — nothing else. The
// REQUEST is the submission seam: it carries the prepared lifecycle
// record and the approving decision ref to the external execution
// gateway (the gateway executes; the body requests — invariant 6;
// L20). A port object exposing an execute-shaped member (direct order
// placement, routing, venue transmission) fails the port-authority
// validation with the typed `execution_authority_granted` error.
//
// THE REPORT LAW (L16 upstream): what the body publishes upstream is
// LIFECYCLE FACTS — transitions, escalations, reconciliations. It
// never publishes order authority: the approval stays with the
// gateway's verdict record, cited as an opaque ref.

import {
  type TimestampMs,
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  stableDigestJson,
} from './primitives';
import {
  type AgentInstanceId,
  type TenantId,
  type TopicName,
  type DecisionRef,
  type GatewayRequestRef,
  isAgentInstanceId,
  isTenantId,
  isTopicName,
  isDecisionRef,
  isOrderRef,
} from './ids';
import {
  type EscalationRecord,
  type ReconciliationRecord,
  validateEscalationRecord,
  validateReconciliationRecord,
} from './monitoring';
import {
  type OrderLifecycleLog,
  type OrderLifecycleRecord,
  validateOrderLifecycleLog,
  validateOrderLifecycleRecord,
} from './lifecycle';
import { type MethodRegistry, resolveMethodCitation } from './methods';
import { type ExecutionBodyError, type ExecutionBodyResult, invalidField, invalidType } from './errors';

// ---------------------------------------------------------------------------
// The kernel topic reservation (mirror of agent-os KERNEL_TOPICS)
// ---------------------------------------------------------------------------

/**
 * The reserved kernel-transport topics — mirror of @tradrl/agent-os
 * `KERNEL_TOPICS` (trip-wired kind-for-kind in the interop test).
 * Order-lane publications and subscriptions NEVER address these.
 */
export const KERNEL_TOPICS_MIRROR = [
  'kernel.request',
  'kernel.delegate',
  'kernel.challenge',
  'kernel.propose',
  'kernel.approve',
  'kernel.escalate',
  'kernel.cascade-escalate',
] as const;

/** A reserved kernel topic name. */
export type KernelTopicMirror = (typeof KERNEL_TOPICS_MIRROR)[number];

/** Guard: a reserved kernel topic. */
export const isKernelTopicMirror = (topic: string): boolean =>
  (KERNEL_TOPICS_MIRROR as readonly string[]).includes(topic);

// ---------------------------------------------------------------------------
// The message envelope mirror
// ---------------------------------------------------------------------------

/**
 * A topic-addressed, tenant-scoped message envelope — STRUCTURAL MIRROR
 * of @tradrl/agent-os's `MessageEnvelope` (field-for-field; ids are plain
 * strings here so the record JSON-round-trips into the real factory).
 * `payload` carries the OPAQUE record reference — the kernel never
 * interprets payloads, and the payload space is opaque references
 * (bounded, no whitespace), never embedded documents.
 */
export interface MessageEnvelopeMirror {
  /** Message identity — DERIVED: `msg:${opId}:${sender}:${sequence}`. */
  readonly id: string;
  /** Organization topic address (never a kernel.* topic). */
  readonly topic: TopicName;
  /** Tenant scope (L12). */
  readonly tenantId: TenantId;
  /** Sending agent instance. */
  readonly sender: AgentInstanceId;
  /** The opaque record reference this publication carries. */
  readonly payload: string;
  /** Per-sender sequence (strictly increasing, 1-based). */
  readonly sequence: number;
  /** The kernel operation id that produced this message, or null. */
  readonly causalityId: string | null;
  /** When the producing operation was accepted (an explicit instant). */
  readonly publishedAt: TimestampMs;
}

/** Guard: `MessageEnvelopeMirror`. */
export function isMessageEnvelopeMirror(v: unknown): v is MessageEnvelopeMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    isTopicName(v.topic) &&
    isTenantId(v.tenantId) &&
    isAgentInstanceId(v.sender) &&
    isNonEmptyString(v.payload) &&
    !/\s/.test(v.payload as string) &&
    (v.payload as string).length <= 1024 &&
    isPositiveInteger(v.sequence) &&
    (v.causalityId === null || isNonEmptyString(v.causalityId)) &&
    isTimestampMs(v.publishedAt)
  );
}

// ---------------------------------------------------------------------------
// The publication record (envelope + the full structured record)
// ---------------------------------------------------------------------------

/**
 * THE publication: the envelope (agent-os mirror, carrying the opaque
 * record reference) BOUND to the full structured record it publishes —
 * a lifecycle record, an escalation record or a reconciliation record.
 * No free-text conclusions exist anywhere in this record — the records
 * are enumerated fields, the payload is a bound reference. The body
 * reports LIFECYCLE FACTS upstream; it never publishes order
 * authority (the approval stays with the gateway's verdict, cited).
 */
export type ExecutionPublication =
  | { readonly envelope: MessageEnvelopeMirror; readonly lifecycle: OrderLifecycleRecord }
  | { readonly envelope: MessageEnvelopeMirror; readonly escalation: EscalationRecord }
  | { readonly envelope: MessageEnvelopeMirror; readonly reconciliation: ReconciliationRecord };

/** Guard: `ExecutionPublication` (structure only — use the validator for the laws). */
export function isExecutionPublication(v: unknown): v is ExecutionPublication {
  if (!isRecord(v)) return false;
  if (!isMessageEnvelopeMirror(v.envelope)) return false;
  return isRecord(v.lifecycle) || isRecord(v.escalation) || isRecord(v.reconciliation);
}

/** Derives the opaque lifecycle reference: `lifecycle:<lifecycleId>`. */
export function lifecycleRefOf(record: OrderLifecycleRecord): string {
  return `lifecycle:${record.lifecycleId}`;
}

/** Derives the opaque escalation reference: `escalation:<escalationId>`. */
export function escalationRefOf(record: EscalationRecord): string {
  return `escalation:${record.escalationId}`;
}

/** Derives the opaque reconciliation reference: `reconciliation:<reconciliationId>`. */
export function reconciliationRefOf(record: ReconciliationRecord): string {
  return `reconciliation:${record.reconciliationId}`;
}

// ---------------------------------------------------------------------------
// Publication construction (derived identity — the kernel's exact formula)
// ---------------------------------------------------------------------------

/** The shared envelope material for all publication kinds. */
export interface PublicationEnvelopeInput {
  /** The kernel operation id this publication is caused by. */
  readonly opId: string;
  readonly topic: TopicName;
  readonly tenantId: TenantId;
  readonly sender: AgentInstanceId;
  /** The per-sender sequence of this publication (>= 1). */
  readonly sequence: number;
  /** The kernel op id carrying causality (defaults to `opId`). */
  readonly causalityId?: string;
  /** The explicit publication instant (no ambient clock). */
  readonly publishedAt: TimestampMs;
}

function envelopeProblems(input: PublicationEnvelopeInput): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isNonEmptyString(input.opId)) errors.push(invalidField('opId', 'must be a non-empty kernel operation id'));
  if (!isTopicName(input.topic)) {
    errors.push(invalidField('topic', 'must be a valid topic name'));
  } else if (isKernelTopicMirror(input.topic)) {
    errors.push({
      code: 'reserved_publication_topic',
      path: 'topic',
      message: 'kernel.* topics are reserved for directed kernel mail — the execution body publishes to organization topics only',
    });
  }
  if (!isTenantId(input.tenantId)) errors.push(invalidField('tenantId', 'must be a non-empty tenant id'));
  if (!isAgentInstanceId(input.sender)) errors.push(invalidField('sender', 'must be a valid agent instance id'));
  if (!isPositiveInteger(input.sequence)) errors.push(invalidField('sequence', 'must be an integer >= 1'));
  if (!isTimestampMs(input.publishedAt)) errors.push(invalidField('publishedAt', 'must be a valid epoch-millisecond instant'));
  return errors;
}

function buildEnvelope(
  input: PublicationEnvelopeInput,
  payload: string,
): MessageEnvelopeMirror {
  return deepFreeze({
    id: `msg:${input.opId}:${input.sender}:${input.sequence}`,
    topic: input.topic,
    tenantId: input.tenantId,
    sender: input.sender,
    payload,
    sequence: input.sequence,
    causalityId: input.causalityId ?? input.opId,
    publishedAt: input.publishedAt,
  });
}

/**
 * Builds a LIFECYCLE publication: derived envelope id (the kernel's
 * formula, mirrored exactly), organization-topic validation, and the
 * payload bound to the lifecycle record's derived id. Pure and
 * deterministic.
 */
export function buildLifecyclePublication(
  input: PublicationEnvelopeInput & { readonly record: OrderLifecycleRecord },
): ExecutionBodyResult<ExecutionPublication> {
  const errors = [...envelopeProblems(input)];
  errors.push(...validateOrderLifecycleRecord(input.record));
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: deepFreeze({
      envelope: buildEnvelope(input, lifecycleRefOf(input.record)),
      lifecycle: input.record,
    }),
  };
}

/**
 * Builds an ESCALATION publication: derived envelope id, organization
 * topic validation, and the payload bound to the escalation's derived
 * id. Pure and deterministic.
 */
export function buildEscalationPublication(
  input: PublicationEnvelopeInput & { readonly escalation: EscalationRecord },
): ExecutionBodyResult<ExecutionPublication> {
  const errors = [...envelopeProblems(input)];
  errors.push(...validateEscalationRecord(input.escalation));
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: deepFreeze({
      envelope: buildEnvelope(input, escalationRefOf(input.escalation)),
      escalation: input.escalation,
    }),
  };
}

/**
 * Builds a RECONCILIATION publication: derived envelope id,
 * organization topic validation, and the payload bound to the
 * reconciliation's derived id. Pure and deterministic.
 */
export function buildReconciliationPublication(
  input: PublicationEnvelopeInput & { readonly reconciliation: ReconciliationRecord },
): ExecutionBodyResult<ExecutionPublication> {
  const errors = [...envelopeProblems(input)];
  errors.push(...validateReconciliationRecord(input.reconciliation));
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: deepFreeze({
      envelope: buildEnvelope(input, reconciliationRefOf(input.reconciliation)),
      reconciliation: input.reconciliation,
    }),
  };
}

// ---------------------------------------------------------------------------
// The gateway REQUEST record (the submission seam — L8)
// ---------------------------------------------------------------------------

/** The declared request kinds: order submission or cancel submission. */
export const GATEWAY_REQUEST_KINDS = ['order-submission', 'cancel-submission'] as const;

/** A gateway request kind. */
export type GatewayRequestKind = (typeof GATEWAY_REQUEST_KINDS)[number];

/** Guard: a gateway request kind. */
export const isGatewayRequestKind = (v: unknown): v is GatewayRequestKind =>
  v === 'order-submission' || v === 'cancel-submission';

/** The gateway request record (with its derived ref). */
export interface GatewayRequest {
  readonly kind: GatewayRequestKind;
  readonly orderRef: string;
  /** The approving decision ref ('xd:'-prefixed) — the authority carried with the request. */
  readonly decisionRef: DecisionRef;
  /** The lifecycle record being submitted (the prepared record for a submission; the current record for a cancel). */
  readonly record: OrderLifecycleRecord;
  /** THE L16 CLOCK MARKER: the request's order-level instant. */
  readonly orderClock: TimestampMs;
  readonly tenant: TenantId;
  readonly project: string;
  /** Derived identity: `gwr-<digest>` — never random. */
  readonly requestRef: GatewayRequestRef;
}

/** Derives the gateway request ref: `gwr-` + 16-hex digest of the canonical content (L9). */
export function expectedGatewayRequestRef(request: Omit<GatewayRequest, 'requestRef'>): GatewayRequestRef {
  return `gwr-${stableDigestJson({
    kind: request.kind,
    orderRef: request.orderRef,
    decisionRef: request.decisionRef,
    record: request.record,
    orderClock: request.orderClock,
    tenant: request.tenant,
    project: request.project,
  } as never)}` as GatewayRequestRef;
}

/** COLLECT-ALL validation of a gateway request. */
export function validateGatewayRequest(v: unknown, path = ''): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(v)) return [invalidType(path || 'request', 'a gateway request record')];
  if (!isGatewayRequestKind(v.kind)) errors.push(invalidField(`${path}kind`, `must be one of ${GATEWAY_REQUEST_KINDS.join('|')}`));
  if (!isOrderRef(v.orderRef)) errors.push(invalidField(`${path}orderRef`, 'must be a compact order identity'));
  if (!isDecisionRef(v.decisionRef)) {
    errors.push({
      code: 'decision_not_approved',
      path: `${path}decisionRef`,
      message: 'the gateway request must carry the approving decision ref (\'xd:\'-prefixed) — the authority travels with the request (L8)',
    });
  }
  errors.push(...validateOrderLifecycleRecord(v.record, `${path}record.`));
  if (!isTimestampMs(v.orderClock)) errors.push(invalidField(`${path}orderClock`, 'must be a valid epoch-millisecond ORDER-LEVEL instant (the L16 clock marker)'));
  if (!isTenantId(v.tenant)) errors.push({ code: 'tenant_missing', path: `${path}tenant`, message: 'the request must carry a tenant scope (L12)' });
  if (!isNonEmptyString(v.project)) errors.push({ code: 'project_missing', path: `${path}project`, message: 'the request must carry a project scope (L12/L15)' });
  return errors;
}

/** Guard: `GatewayRequest`. */
export function isGatewayRequest(v: unknown): v is GatewayRequest {
  return validateGatewayRequest(v).length === 0;
}

/**
 * Builds a validated, deeply-frozen gateway request (the submission
 * seam — the derived `gwr-` ref included; refusal is typed data).
 */
export function createGatewayRequest(draft: unknown): ExecutionBodyResult<GatewayRequest> {
  const errors = validateGatewayRequest(draft);
  if (errors.length > 0) return { ok: false, errors };
  const record = draft as Omit<GatewayRequest, 'requestRef'>;
  return {
    ok: true,
    value: deepFreeze({ ...record, requestRef: expectedGatewayRequestRef(record) }) as GatewayRequest,
  };
}

// ---------------------------------------------------------------------------
// The publication port (the ONLY seam order-lifecycle outputs leave
// through — PUBLISH/SUBSCRIBE/REQUEST/REPORT/ESCALATE only)
// ---------------------------------------------------------------------------

/** The receipt a publication port returns for an accepted publication. */
export interface PublicationReceipt {
  /** The envelope id that was accepted. */
  readonly envelopeId: string;
  /** The opaque record reference the payload carried. */
  readonly recordRef: string;
}

/** An order-lane subscription request (the intake seam — SUBSCRIBE). */
export interface ExecutionSubscription {
  /** The organization topic being subscribed to. */
  readonly topic: TopicName;
  /** The subscribing agent instance. */
  readonly subscriber: AgentInstanceId;
  /** Tenant scope (L12). */
  readonly tenantId: TenantId;
}

/** Guard: `ExecutionSubscription`. */
export function isExecutionSubscription(v: unknown): v is ExecutionSubscription {
  if (!isRecord(v)) return false;
  return isTopicName(v.topic) && isAgentInstanceId(v.subscriber) && isTenantId(v.tenantId);
}

/** The receipt a subscription returns. */
export interface SubscriptionReceipt {
  readonly topic: TopicName;
  readonly subscriber: AgentInstanceId;
}

/** A lifecycle REPORT request (the REPORT verb — the upstream reporting seam). */
export interface ExecutionReport {
  /** The kernel operation id this report is caused by. */
  readonly opId: string;
  /** The organization report topic. */
  readonly topic: TopicName;
  readonly tenantId: TenantId;
  readonly sender: AgentInstanceId;
  readonly sequence: number;
  readonly publishedAt: TimestampMs;
  /** The lifecycle log being reported upstream (LIFECYCLE FACTS — never order authority). */
  readonly log: OrderLifecycleLog;
}

/** Guard: `ExecutionReport` (structure only — use the validator for the laws). */
export function isExecutionReport(v: unknown): v is ExecutionReport {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.opId) &&
    isTopicName(v.topic) &&
    isTenantId(v.tenantId) &&
    isAgentInstanceId(v.sender) &&
    isPositiveInteger(v.sequence) &&
    isTimestampMs(v.publishedAt) &&
    isRecord(v.log)
  );
}

/** The receipt a report returns. */
export interface ReportReceipt {
  readonly envelopeId: string;
  readonly operation: 'REPORT';
  /** The opaque order reference the report covered. */
  readonly orderRef: string;
}

/** The receipt a gateway REQUEST returns (the gateway's acceptance — its decision, not this body's). */
export interface GatewayRequestReceipt {
  readonly operation: 'REQUEST';
  readonly kind: GatewayRequestKind;
  readonly orderRef: string;
  readonly decisionRef: DecisionRef;
}

/** The receipt an ESCALATE returns. */
export interface EscalationReceipt {
  readonly operation: 'ESCALATE';
  readonly envelopeId: string;
  readonly escalationRef: string;
}

/**
 * THE PUBLICATION PORT: the execution body's ONLY seam to the
 * organization fabric and the external gateway. Its expressible
 * operations are PUBLISH, SUBSCRIBE, REQUEST, REPORT and ESCALATE —
 * nothing else (L8/L16: no execute-shaped member may ever appear; the
 * REQUEST is the submission seam and the gateway — never this port —
 * executes).
 */
export interface ExecutionPublicationPort {
  /** PUBLISH a lifecycle/escalation/reconciliation record to an organization topic. */
  publish(publication: ExecutionPublication): ExecutionBodyResult<PublicationReceipt>;
  /** SUBSCRIBE to an order-lane topic (the intake seam). */
  subscribe(subscription: ExecutionSubscription): ExecutionBodyResult<SubscriptionReceipt>;
  /** REQUEST the external execution gateway (the submission seam — order or cancel submissions). */
  request(request: GatewayRequest): ExecutionBodyResult<GatewayRequestReceipt>;
  /** REPORT lifecycle facts upstream (a lifecycle log — never order authority). */
  report(report: ExecutionReport): ExecutionBodyResult<ReportReceipt>;
  /** ESCALATE an escalation record to the escalation topic. */
  escalate(input: PublicationEnvelopeInput & { readonly escalation: EscalationRecord }): ExecutionBodyResult<EscalationReceipt>;
}

/** The port operations an execution port may express (closed — L8/L16). */
export const PORT_OPERATIONS = ['PUBLISH', 'SUBSCRIBE', 'REQUEST', 'REPORT', 'ESCALATE'] as const;

/** An execution port operation. */
export type PortOperation = (typeof PORT_OPERATIONS)[number];

/** Guard: `ExecutionPublicationPort` (structural — the five operations exist). */
export function isExecutionPublicationPort(value: unknown): value is ExecutionPublicationPort {
  if (!isRecord(value)) return false;
  return (
    typeof value.publish === 'function' &&
    typeof value.subscribe === 'function' &&
    typeof value.request === 'function' &&
    typeof value.report === 'function' &&
    typeof value.escalate === 'function'
  );
}

const FORBIDDEN_PORT_MEMBERS = /^(execute|executeOrder|execute_order|placeOrder|place_order|routeOrder|route_order|transmitOrder|transmit_order|amendOrder|amend_order|cancelOrder|cancel_order|venueDirect|venue_direct)$/i;

/**
 * THE PORT AUTHORITY LAW (L8/L16 at the seam): a port object exposing
 * an execute-shaped member (direct order placement, routing, venue
 * transmission, direct cancel, amend) is a typed
 * `execution_authority_granted` violation — the execution port can
 * EXPRESS only PUBLISH/SUBSCRIBE/REQUEST/REPORT/ESCALATE, and the
 * REQUEST goes to the external gateway, which executes.
 */
export function portAuthorityViolations(port: unknown): readonly ExecutionBodyError[] {
  if (!isRecord(port)) {
    return [invalidType('port', 'an execution publication port object')];
  }
  const errors: ExecutionBodyError[] = [];
  for (const member of Object.keys(port)) {
    if (FORBIDDEN_PORT_MEMBERS.test(member)) {
      errors.push({
        code: 'execution_authority_granted',
        path: `port.${member}`,
        message: `an execution publication port may express PUBLISH/SUBSCRIBE/REQUEST/REPORT/ESCALATE only — member ${JSON.stringify(member)} is direct venue-side order control (L8/L20: the gateway executes, never this port)`,
      });
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Port-side discipline checks (typed, never silent)
// ---------------------------------------------------------------------------

/**
 * Port-side discipline check for PUBLISH: the envelope must be
 * well-formed, the topic must be an organization topic, the payload
 * must be the record's bound reference, the record must validate under
 * its own laws, and the envelope tenant must match the record tenant
 * (L12).
 */
export function validateExecutionPublication(
  publication: unknown,
  registry: MethodRegistry,
): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isExecutionPublication(publication)) {
    if (!isRecord(publication) || !isMessageEnvelopeMirror(publication.envelope)) {
      return [invalidType('publication', 'an execution publication record (envelope + lifecycle/escalation/reconciliation)')];
    }
    errors.push(invalidType('publication', 'must bind a lifecycle, escalation or reconciliation record'));
    return errors;
  }
  const envelope = publication.envelope;
  if (isKernelTopicMirror(envelope.topic)) {
    errors.push({
      code: 'reserved_publication_topic',
      path: 'envelope.topic',
      message: 'kernel.* topics are reserved for directed kernel mail — the execution body publishes to organization topics only',
    });
  }
  if ('lifecycle' in publication) {
    const record = (publication as { lifecycle: unknown }).lifecycle;
    const recordErrors = validateOrderLifecycleRecord(record);
    if (recordErrors.length > 0) {
      errors.push({
        code: 'unstructured_publication',
        path: 'lifecycle',
        message: `the publication must carry a valid lifecycle record: ${recordErrors[0]?.message ?? 'invalid record'}`,
      });
      return errors;
    }
    const lifecycle = record as OrderLifecycleRecord;
    if (envelope.payload !== lifecycleRefOf(lifecycle)) {
      errors.push({
        code: 'unstructured_publication',
        path: 'envelope.payload',
        message: 'the payload must be the opaque reference bound to the carried lifecycle record (lifecycle:<lifecycleId>)',
      });
    }
    if (lifecycle.tenant !== envelope.tenantId) {
      errors.push({
        code: 'tenant_missing',
        path: 'envelope.tenantId',
        message: 'the envelope tenant must match the lifecycle record tenant (L12)',
      });
    }
    errors.push(...resolveMethodCitation(registry, lifecycle.methodId, lifecycle.methodVersion, 'order-preparation'));
  } else if ('escalation' in publication) {
    const escalationErrors = validateEscalationRecord((publication as { escalation: unknown }).escalation);
    if (escalationErrors.length > 0) {
      errors.push({
        code: 'unstructured_publication',
        path: 'escalation',
        message: `the publication must carry a valid escalation record: ${escalationErrors[0]?.message ?? 'invalid escalation'}`,
      });
      return errors;
    }
    const escalation = (publication as { escalation: EscalationRecord }).escalation;
    if (envelope.payload !== escalationRefOf(escalation)) {
      errors.push({
        code: 'unstructured_publication',
        path: 'envelope.payload',
        message: 'the payload must be the opaque reference bound to the carried escalation record (escalation:<escalationId>)',
      });
    }
    if (escalation.tenant !== envelope.tenantId) {
      errors.push({
        code: 'tenant_missing',
        path: 'envelope.tenantId',
        message: 'the envelope tenant must match the escalation record tenant (L12)',
      });
    }
  } else {
    const reconciliationErrors = validateReconciliationRecord((publication as { reconciliation: unknown }).reconciliation);
    if (reconciliationErrors.length > 0) {
      errors.push({
        code: 'unstructured_publication',
        path: 'reconciliation',
        message: `the publication must carry a valid reconciliation record: ${reconciliationErrors[0]?.message ?? 'invalid reconciliation'}`,
      });
      return errors;
    }
    const reconciliation = (publication as { reconciliation: ReconciliationRecord }).reconciliation;
    if (envelope.payload !== reconciliationRefOf(reconciliation)) {
      errors.push({
        code: 'unstructured_publication',
        path: 'envelope.payload',
        message: 'the payload must be the opaque reference bound to the carried reconciliation record (reconciliation:<reconciliationId>)',
      });
    }
    if (reconciliation.tenant !== envelope.tenantId) {
      errors.push({
        code: 'tenant_missing',
        path: 'envelope.tenantId',
        message: 'the envelope tenant must match the reconciliation record tenant (L12)',
      });
    }
  }
  return errors;
}

/**
 * Port-side discipline check for SUBSCRIBE: a valid subscription
 * addresses an organization topic (kernel.* reserved) with a valid
 * subscriber and tenant.
 */
export function validateExecutionSubscription(subscription: unknown): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isExecutionSubscription(subscription)) {
    return [invalidType('subscription', 'an execution subscription record { topic, subscriber, tenantId }')];
  }
  if (isKernelTopicMirror(subscription.topic)) {
    errors.push({
      code: 'reserved_publication_topic',
      path: 'topic',
      message: 'kernel.* topics are reserved for directed kernel mail — order-lane records are consumed from organization topics only',
    });
  }
  return errors;
}

/**
 * Port-side discipline check for REPORT: valid envelope material, an
 * organization report topic, and a lifecycle LOG (facts only — never
 * order authority) that validates under its own laws.
 */
export function validateExecutionReport(
  report: unknown,
  registry: MethodRegistry,
): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isExecutionReport(report)) {
    return [invalidType('report', 'an execution report record')];
  }
  if (isKernelTopicMirror(report.topic)) {
    errors.push({
      code: 'reserved_publication_topic',
      path: 'topic',
      message: 'kernel.* topics are reserved for directed kernel mail — reports go to organization topics only',
    });
  }
  const logErrors = validateOrderLifecycleLog(report.log);
  if (logErrors.length > 0) {
    errors.push({
      code: 'unstructured_publication',
      path: 'log',
      message: `the report must carry a valid lifecycle log (facts, never order authority): ${logErrors[0]?.message ?? 'invalid log'}`,
    });
    return errors;
  }
  if ((report.log as OrderLifecycleLog).records[0] !== undefined && ((report.log as OrderLifecycleLog).records[0] as OrderLifecycleRecord).tenant !== report.tenantId) {
    errors.push({
      code: 'tenant_missing',
      path: 'tenantId',
      message: 'the report tenant must match the lifecycle tenant (L12)',
    });
  }
  void registry;
  return errors;
}

// ---------------------------------------------------------------------------
// An in-memory recording port for tests and fixtures (deterministic)
// ---------------------------------------------------------------------------

/**
 * An in-memory recording port: accepts every structurally valid
 * operation and records it (deterministic — no clock, no randomness).
 * The port authority law is enforced on every member access surface:
 * `portAuthorityViolations(recordingPort)` is empty by construction.
 */
export function createRecordingExecutionPort(): ExecutionPublicationPort & {
  /** Every publication accepted so far, in order. */
  readonly published: readonly ExecutionPublication[];
  /** Every subscription accepted so far, in order. */
  readonly subscribed: readonly ExecutionSubscription[];
  /** Every gateway request accepted so far, in order. */
  readonly requested: readonly GatewayRequest[];
  /** Every report accepted so far, in order. */
  readonly reported: readonly ExecutionReport[];
  /** Every escalation accepted so far, in order. */
  readonly escalated: readonly ExecutionPublication[];
} {
  const acceptedPublications: ExecutionPublication[] = [];
  const acceptedSubscriptions: ExecutionSubscription[] = [];
  const acceptedRequests: GatewayRequest[] = [];
  const acceptedReports: ExecutionReport[] = [];
  const acceptedEscalations: ExecutionPublication[] = [];
  const port: ExecutionPublicationPort = {
    publish(publication: ExecutionPublication): ExecutionBodyResult<PublicationReceipt> {
      if (!isExecutionPublication(publication)) {
        return { ok: false, errors: [invalidType('publication', 'an execution publication record (envelope + lifecycle/escalation/reconciliation)')] };
      }
      acceptedPublications.push(publication);
      return {
        ok: true,
        value: deepFreeze({
          envelopeId: publication.envelope.id,
          recordRef: publication.envelope.payload,
        }),
      };
    },
    subscribe(subscription: ExecutionSubscription): ExecutionBodyResult<SubscriptionReceipt> {
      const errors = validateExecutionSubscription(subscription);
      if (errors.length > 0) return { ok: false, errors };
      acceptedSubscriptions.push(subscription);
      return {
        ok: true,
        value: deepFreeze({ topic: subscription.topic, subscriber: subscription.subscriber }),
      };
    },
    request(request: GatewayRequest): ExecutionBodyResult<GatewayRequestReceipt> {
      const errors = validateGatewayRequest(request);
      if (errors.length > 0) return { ok: false, errors };
      acceptedRequests.push(request);
      return {
        ok: true,
        value: deepFreeze({
          operation: 'REQUEST' as const,
          kind: request.kind,
          orderRef: request.orderRef,
          decisionRef: request.decisionRef,
        }),
      };
    },
    report(report: ExecutionReport): ExecutionBodyResult<ReportReceipt> {
      if (!isExecutionReport(report)) {
        return { ok: false, errors: [invalidType('report', 'an execution report record')] };
      }
      acceptedReports.push(report);
      return {
        ok: true,
        value: deepFreeze({
          envelopeId: `msg:${report.opId}:${report.sender}:${report.sequence}`,
          operation: 'REPORT' as const,
          orderRef: isRecord(report.log) && typeof (report.log as Record<string, unknown>).orderRef === 'string'
            ? ((report.log as Record<string, unknown>).orderRef as string)
            : '',
        }),
      };
    },
    escalate(input: PublicationEnvelopeInput & { readonly escalation: EscalationRecord }): ExecutionBodyResult<EscalationReceipt> {
      const built = buildEscalationPublication(input);
      if (!built.ok) return built;
      acceptedEscalations.push(built.value);
      return {
        ok: true,
        value: deepFreeze({
          operation: 'ESCALATE' as const,
          envelopeId: built.value.envelope.id,
          escalationRef: built.value.envelope.payload,
        }),
      };
    },
  };
  // Object.assign would INVOKE the getters and snapshot empty arrays —
  // defineProperty keeps the live accessors (the recording-port trap).
  Object.defineProperty(port, 'published', {
    get: (): readonly ExecutionPublication[] => deepFreeze(acceptedPublications.slice()),
    enumerable: true,
  });
  Object.defineProperty(port, 'subscribed', {
    get: (): readonly ExecutionSubscription[] => deepFreeze(acceptedSubscriptions.slice()),
    enumerable: true,
  });
  Object.defineProperty(port, 'requested', {
    get: (): readonly GatewayRequest[] => deepFreeze(acceptedRequests.slice()),
    enumerable: true,
  });
  Object.defineProperty(port, 'reported', {
    get: (): readonly ExecutionReport[] => deepFreeze(acceptedReports.slice()),
    enumerable: true,
  });
  Object.defineProperty(port, 'escalated', {
    get: (): readonly ExecutionPublication[] => deepFreeze(acceptedEscalations.slice()),
    enumerable: true,
  });
  return Object.freeze(port) as ExecutionPublicationPort & {
    readonly published: readonly ExecutionPublication[];
    readonly subscribed: readonly ExecutionSubscription[];
    readonly requested: readonly GatewayRequest[];
    readonly reported: readonly ExecutionReport[];
    readonly escalated: readonly ExecutionPublication[];
  };
}

/** Canonical serialization of a publication (byte-deterministic, L9). */
export function serializeExecutionPublication(publication: ExecutionPublication): string {
  return canonicalJson(publication as never);
}
