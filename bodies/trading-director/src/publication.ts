// @tradrl/body-trading-director — the decision publication contracts.
//
// Owning Work Order: T024: "publication.ts: the agent-os envelope mirror
// + a DirectorPublicationPort (PUBLISH/SUBSCRIBE/REPORT only)."
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
// (`decision:<decisionId>` / `escalation:<escalationId>`), BOUND to the
// full structured record which travels alongside it through the port.
// The port is the ONLY seam director outputs leave through, and it
// refuses (typed, never silent):
//   - a free-text or malformed payload          (unstructured_publication)
//   - a payload not bound to the carried record (unstructured_publication)
//   - an invalid decision or escalation record  (the records' own laws)
//   - a reserved kernel topic                   (reserved_publication_topic)
//
// THE PORT LAW (L8 at the seam): the port's expressible operations are
// PUBLISH, SUBSCRIBE and REPORT — nothing else. A port object exposing
// an execute-shaped member fails the port-authority validation with the
// typed `execution_authority_granted` error (the director never touches
// order-level control — L16; execution authority lives outside the
// model — L8).

import {
  type TimestampMs,
  deepFreeze,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
} from './primitives';
import {
  type AgentInstanceId,
  type TenantId,
  type TopicName,
  isAgentInstanceId,
  isTenantId,
  isTopicName,
} from './ids';
import { type MethodRegistry } from './methods';
import {
  type DirectorDecision,
  type EscalationRecord,
  validateDirectorDecision,
  validateEscalationRecord,
} from './decision';
import { type DirectorError, type DirectorResult, invalidField, invalidType } from './errors';

// ---------------------------------------------------------------------------
// The kernel topic reservation (mirror of agent-os KERNEL_TOPICS)
// ---------------------------------------------------------------------------

/**
 * The reserved kernel-transport topics — mirror of @tradrl/agent-os
 * `KERNEL_TOPICS` (trip-wired kind-for-kind in the interop test).
 * Director publications and subscriptions NEVER address these.
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
 * a decision or an escalation record. No free-text conclusions exist
 * anywhere in this record.
 */
export type DirectorPublication =
  | { readonly envelope: MessageEnvelopeMirror; readonly decision: DirectorDecision }
  | { readonly envelope: MessageEnvelopeMirror; readonly escalation: EscalationRecord };

/** Guard: `DirectorPublication` (structure only — use the validators for the laws). */
export function isDirectorPublication(v: unknown): v is DirectorPublication {
  if (!isRecord(v)) return false;
  if (!isMessageEnvelopeMirror(v.envelope)) return false;
  return isRecord(v.decision) || isRecord(v.escalation);
}

/** Derives the opaque decision reference: `decision:<decisionId>`. */
export function decisionRefOf(decision: DirectorDecision): string {
  return `decision:${decision.decisionId}`;
}

/** Derives the opaque escalation reference: `escalation:<escalationId>`. */
export function escalationRefOf(escalation: EscalationRecord): string {
  return `escalation:${escalation.escalationId}`;
}

// ---------------------------------------------------------------------------
// Publication construction (derived identity — the kernel's exact formula)
// ---------------------------------------------------------------------------

/** The shared envelope material for both publication kinds. */
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

function envelopeProblems(input: PublicationEnvelopeInput): readonly DirectorError[] {
  const errors: DirectorError[] = [];
  if (!isNonEmptyString(input.opId)) errors.push(invalidField('opId', 'must be a non-empty kernel operation id'));
  if (!isTopicName(input.topic)) {
    errors.push(invalidField('topic', 'must be a valid topic name'));
  } else if (isKernelTopicMirror(input.topic)) {
    errors.push({
      code: 'reserved_publication_topic',
      path: 'topic',
      message: 'kernel.* topics are reserved for directed kernel mail — the director publishes to organization topics only',
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
 * Builds a DECISION publication: derived envelope id (the kernel's
 * formula, mirrored exactly), organization-topic validation, and the
 * payload bound to the decision's derived id. Pure and deterministic.
 */
export function buildDirectorDecisionPublication(
  input: PublicationEnvelopeInput & { readonly decision: DirectorDecision },
): DirectorResult<DirectorPublication> {
  const errors = [...envelopeProblems(input)];
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: deepFreeze({
      envelope: buildEnvelope(input, decisionRefOf(input.decision)),
      decision: input.decision,
    }),
  };
}

/**
 * Builds an ESCALATION publication: derived envelope id, organization
 * topic validation, and the payload bound to the escalation's derived
 * id. Pure and deterministic.
 */
export function buildDirectorEscalationPublication(
  input: PublicationEnvelopeInput & { readonly escalation: EscalationRecord },
): DirectorResult<DirectorPublication> {
  const errors = [...envelopeProblems(input)];
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: deepFreeze({
      envelope: buildEnvelope(input, escalationRefOf(input.escalation)),
      escalation: input.escalation,
    }),
  };
}

// ---------------------------------------------------------------------------
// The publication port (the ONLY seam director outputs leave through)
// ---------------------------------------------------------------------------

/** The receipt a publication port returns for an accepted publication. */
export interface PublicationReceipt {
  /** The envelope id that was accepted. */
  readonly envelopeId: string;
  /** The opaque record reference the payload carried. */
  readonly recordRef: string;
}

/** A research subscription request (the intake seam — SUBSCRIBE). */
export interface DirectorSubscription {
  /** The organization research topic being subscribed to. */
  readonly topic: TopicName;
  /** The subscribing agent instance. */
  readonly subscriber: AgentInstanceId;
  /** Tenant scope (L12). */
  readonly tenantId: TenantId;
}

/** Guard: `DirectorSubscription`. */
export function isDirectorSubscription(v: unknown): v is DirectorSubscription {
  if (!isRecord(v)) return false;
  return isTopicName(v.topic) && isAgentInstanceId(v.subscriber) && isTenantId(v.tenantId);
}

/** The receipt a subscription returns. */
export interface SubscriptionReceipt {
  readonly topic: TopicName;
  readonly subscriber: AgentInstanceId;
}

/** A decision REPORT request (the REPORT verb — the reporting seam). */
export interface DirectorReport {
  /** The kernel operation id this report is caused by. */
  readonly opId: string;
  /** The organization report topic. */
  readonly topic: TopicName;
  readonly tenantId: TenantId;
  readonly sender: AgentInstanceId;
  readonly sequence: number;
  readonly publishedAt: TimestampMs;
  /** The decision being reported. */
  readonly decision: DirectorDecision;
}

/** Guard: `DirectorReport` (structure only — use the validator for the laws). */
export function isDirectorReport(v: unknown): v is DirectorReport {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.opId) &&
    isTopicName(v.topic) &&
    isTenantId(v.tenantId) &&
    isAgentInstanceId(v.sender) &&
    isPositiveInteger(v.sequence) &&
    isTimestampMs(v.publishedAt) &&
    isRecord(v.decision)
  );
}

/** The receipt a report returns. */
export interface ReportReceipt {
  readonly envelopeId: string;
  readonly operation: 'REPORT';
  readonly decisionRef: string;
}

/**
 * THE publication port: the director's ONLY seam to the organization
 * fabric. Its expressible operations are PUBLISH, SUBSCRIBE and REPORT
 * — nothing else (L8/L16: no execute-shaped member may ever appear).
 */
export interface DirectorPublicationPort {
  /** PUBLISH a decision or escalation record to an organization topic. */
  publish(publication: DirectorPublication): DirectorResult<PublicationReceipt>;
  /** SUBSCRIBE to a research topic (the intake seam). */
  subscribe(subscription: DirectorSubscription): DirectorResult<SubscriptionReceipt>;
  /** REPORT a decision record to a report topic. */
  report(report: DirectorReport): DirectorResult<ReportReceipt>;
}

/** The port operations a director port may express (closed — L8/L16). */
export const PORT_OPERATIONS = ['PUBLISH', 'SUBSCRIBE', 'REPORT'] as const;

/** A director port operation. */
export type PortOperation = (typeof PORT_OPERATIONS)[number];

/** Guard: `DirectorPublicationPort` (structural — the three operations exist). */
export function isDirectorPublicationPort(value: unknown): value is DirectorPublicationPort {
  if (!isRecord(value)) return false;
  return (
    typeof value.publish === 'function' &&
    typeof value.subscribe === 'function' &&
    typeof value.report === 'function'
  );
}

const FORBIDDEN_PORT_MEMBERS = /^(execute|executeOrder|execute_order|placeOrder|place_order|routeOrder|route_order|cancelOrder|cancel_order|amendOrder|amend_order)$/i;

/**
 * THE PORT AUTHORITY LAW (L8/L16 at the seam): a port object exposing an
 * execute-shaped member (order execution, placement, routing, cancel,
 * amend) is a typed `execution_authority_granted` violation — the
 * director's port can EXPRESS only PUBLISH/SUBSCRIBE/REPORT.
 */
export function portAuthorityViolations(port: unknown): readonly DirectorError[] {
  if (!isRecord(port)) {
    return [invalidType('port', 'a director publication port object')];
  }
  const errors: DirectorError[] = [];
  for (const member of Object.keys(port)) {
    if (FORBIDDEN_PORT_MEMBERS.test(member)) {
      errors.push({
        code: 'execution_authority_granted',
        path: `port.${member}`,
        message: `a director publication port may express PUBLISH/SUBSCRIBE/REPORT only — member ${JSON.stringify(member)} is order-level control (L8/L16; the execution body T025 owns that lane)`,
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
 * well-formed, the topic must be an organization topic, the payload must
 * be the record's bound reference, the record must validate under its
 * own laws, and the envelope tenant must match the record tenant (L12).
 */
export function validateDirectorPublication(
  publication: unknown,
  registry: MethodRegistry,
): readonly DirectorError[] {
  const errors: DirectorError[] = [];
  if (!isDirectorPublication(publication)) {
    if (!isRecord(publication) || !isMessageEnvelopeMirror(publication.envelope)) {
      return [invalidType('publication', 'a director publication record (envelope + decision/escalation)')];
    }
    errors.push(invalidType('publication', 'must bind a decision or escalation record'));
    return errors;
  }
  const envelope = publication.envelope;
  if (isKernelTopicMirror(envelope.topic)) {
    errors.push({
      code: 'reserved_publication_topic',
      path: 'envelope.topic',
      message: 'kernel.* topics are reserved for directed kernel mail — the director publishes to organization topics only',
    });
  }
  if ('decision' in publication) {
    const decision = (publication as { decision: unknown }).decision;
    const decisionErrors = validateDirectorDecision(decision, registry);
    if (decisionErrors.length > 0) {
      errors.push({
        code: 'unstructured_publication',
        path: 'decision',
        message: `the publication must carry a valid director decision: ${decisionErrors[0]?.message ?? 'invalid decision'}`,
      });
      return errors;
    }
    const record = decision as DirectorDecision;
    if (envelope.payload !== decisionRefOf(record)) {
      errors.push({
        code: 'unstructured_publication',
        path: 'envelope.payload',
        message: 'the payload must be the opaque reference bound to the carried decision (decision:<decisionId>)',
      });
    }
    if (record.tenantId !== envelope.tenantId) {
      errors.push({
        code: 'tenant_missing',
        path: 'envelope.tenantId',
        message: 'the envelope tenant must match the decision tenant (L12)',
      });
    }
  } else {
    const escalation = (publication as { escalation: unknown }).escalation;
    const escalationErrors = validateEscalationRecord(escalation, registry);
    if (escalationErrors.length > 0) {
      errors.push({
        code: 'unstructured_publication',
        path: 'escalation',
        message: `the publication must carry a valid escalation record: ${escalationErrors[0]?.message ?? 'invalid escalation'}`,
      });
      return errors;
    }
    const record = escalation as EscalationRecord;
    if (envelope.payload !== escalationRefOf(record)) {
      errors.push({
        code: 'unstructured_publication',
        path: 'envelope.payload',
        message: 'the payload must be the opaque reference bound to the carried escalation (escalation:<escalationId>)',
      });
    }
    if (record.tenantId !== envelope.tenantId) {
      errors.push({
        code: 'tenant_missing',
        path: 'envelope.tenantId',
        message: 'the envelope tenant must match the escalation tenant (L12)',
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
export function validateDirectorSubscription(subscription: unknown): readonly DirectorError[] {
  const errors: DirectorError[] = [];
  if (!isDirectorSubscription(subscription)) {
    return [invalidType('subscription', 'a director subscription record { topic, subscriber, tenantId }')];
  }
  if (isKernelTopicMirror(subscription.topic)) {
    errors.push({
      code: 'reserved_publication_topic',
      path: 'topic',
      message: 'kernel.* topics are reserved for directed kernel mail — research is consumed from organization topics only',
    });
  }
  return errors;
}

/**
 * Port-side discipline check for REPORT: valid envelope material, an
 * organization report topic, and a decision that validates under its
 * own laws.
 */
export function validateDirectorReport(report: unknown, registry: MethodRegistry): readonly DirectorError[] {
  const errors: DirectorError[] = [];
  if (!isDirectorReport(report)) {
    return [invalidType('report', 'a director report record')];
  }
  if (isKernelTopicMirror(report.topic)) {
    errors.push({
      code: 'reserved_publication_topic',
      path: 'topic',
      message: 'kernel.* topics are reserved for directed kernel mail — reports go to organization topics only',
    });
  }
  const decisionErrors = validateDirectorDecision(report.decision, registry);
  if (decisionErrors.length > 0) {
    errors.push({
      code: 'unstructured_publication',
      path: 'decision',
      message: `the report must carry a valid director decision: ${decisionErrors[0]?.message ?? 'invalid decision'}`,
    });
  }
  if (report.decision.tenantId !== report.tenantId) {
    errors.push({
      code: 'tenant_missing',
      path: 'tenantId',
      message: 'the report tenant must match the decision tenant (L12)',
    });
  }
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
export function createRecordingDirectorPort(): DirectorPublicationPort & {
  /** Every publication accepted so far, in order. */
  readonly published: readonly DirectorPublication[];
  /** Every subscription accepted so far, in order. */
  readonly subscribed: readonly DirectorSubscription[];
  /** Every report accepted so far, in order. */
  readonly reported: readonly DirectorReport[];
} {
  const acceptedPublications: DirectorPublication[] = [];
  const acceptedSubscriptions: DirectorSubscription[] = [];
  const acceptedReports: DirectorReport[] = [];
  const port: DirectorPublicationPort = {
    publish(publication: DirectorPublication): DirectorResult<PublicationReceipt> {
      if (!isDirectorPublication(publication)) {
        return { ok: false, errors: [invalidType('publication', 'a director publication record (envelope + decision/escalation)')] };
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
    subscribe(subscription: DirectorSubscription): DirectorResult<SubscriptionReceipt> {
      const errors = validateDirectorSubscription(subscription);
      if (errors.length > 0) return { ok: false, errors };
      acceptedSubscriptions.push(subscription);
      return {
        ok: true,
        value: deepFreeze({ topic: subscription.topic, subscriber: subscription.subscriber }),
      };
    },
    report(report: DirectorReport): DirectorResult<ReportReceipt> {
      if (!isDirectorReport(report)) {
        return { ok: false, errors: [invalidType('report', 'a director report record')] };
      }
      acceptedReports.push(report);
      return {
        ok: true,
        value: deepFreeze({
          envelopeId: `msg:${report.opId}:${report.sender}:${report.sequence}`,
          operation: 'REPORT' as const,
          decisionRef: decisionRefOf(report.decision),
        }),
      };
    },
  };
  // Object.assign would INVOKE the getters and snapshot empty arrays —
  // defineProperty keeps the live accessors (the recording-port trap).
  Object.defineProperty(port, 'published', {
    get: (): readonly DirectorPublication[] => deepFreeze(acceptedPublications.slice()),
    enumerable: true,
  });
  Object.defineProperty(port, 'subscribed', {
    get: (): readonly DirectorSubscription[] => deepFreeze(acceptedSubscriptions.slice()),
    enumerable: true,
  });
  Object.defineProperty(port, 'reported', {
    get: (): readonly DirectorReport[] => deepFreeze(acceptedReports.slice()),
    enumerable: true,
  });
  return Object.freeze(port) as DirectorPublicationPort & {
    readonly published: readonly DirectorPublication[];
    readonly subscribed: readonly DirectorSubscription[];
    readonly reported: readonly DirectorReport[];
  };
}
