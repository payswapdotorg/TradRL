// @tradrl/body-regime-researcher — the research publication contracts.
//
// Owning Work Order: T022, sections 3/5: "Publication discipline: outputs
// publish ONLY through the envelope mirror port (structured records — no
// free-text conclusions)"; "delegation boundaries (may SUBSCRIBE/PUBLISH
// via agent-os envelope mirrors — never EXECUTE)".
//
// STRUCTURAL MIRROR of @tradrl/agent-os's MessageEnvelope (law
// D-003/D-004 — never imported; trip-wired in src/interop.test.ts
// against the REAL package): { id, topic, tenantId, sender, payload,
// sequence, causalityId, publishedAt }. The envelope id is DERIVED with
// the kernel's exact formula (`msg:${opId}:${sender}:${sequence}` —
// never random); the topic must be an ORGANIZATION topic (kernel.* is
// reserved — code `reserved_publication_topic`).
//
// PAYLOAD DISCIPLINE (mirroring the kernel's ReportSummary.detailRef
// law — "opaque reference to the full report document"): the agent-os
// `MessagePayload` space is OPAQUE REFERENCES (bounded, no whitespace),
// never embedded documents. The publication envelope's payload is
// therefore the opaque report reference `report:<reportId>`, BOUND to
// the full structured RegimeResearchReport which travels alongside it
// through the port. The port is the ONLY seam research outputs leave
// through, and it refuses (typed, never silent):
//   - a free-text or malformed payload          (unstructured_publication)
//   - a payload not bound to the carried report (unstructured_publication)
//   - an invalid report                         (the report's own laws)
//   - a reserved kernel topic                   (reserved_publication_topic)

import {
  type TimestampMs,
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
} from './primitives';
import { type AgentInstanceId, type TenantId, type TopicName, isAgentInstanceId, isTenantId, isTopicName } from './ids';
import { type RegimeResearchReport, validateRegimeResearchReport } from './report';
import { type RegimeMethodRegistry } from './methods';
import { type RegimeError, type RegimeResult, invalidField, invalidType } from './errors';

// ---------------------------------------------------------------------------
// The kernel topic reservation (mirror of agent-os KERNEL_TOPICS)
// ---------------------------------------------------------------------------

/**
 * The reserved kernel-transport topics — mirror of @tradrl/agent-os
 * `KERNEL_TOPICS` (trip-wired kind-for-kind in the interop test).
 * Research publications NEVER address these.
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
 * `payload` carries the OPAQUE report reference `report:<reportId>` —
 * the kernel never interprets payloads, and the payload space is opaque
 * references (bounded, no whitespace), never embedded documents.
 */
export interface RegimeMessageEnvelope {
  /** Message identity — DERIVED: `msg:${opId}:${sender}:${sequence}`. */
  readonly id: string;
  /** Organization topic address (never a kernel.* topic). */
  readonly topic: TopicName;
  /** Tenant scope (L12). */
  readonly tenantId: TenantId;
  /** Sending agent instance. */
  readonly sender: AgentInstanceId;
  /** The opaque report reference this publication carries. */
  readonly payload: string;
  /** Per-sender sequence (strictly increasing, 1-based). */
  readonly sequence: number;
  /** The kernel operation id that produced this message, or null. */
  readonly causalityId: string | null;
  /** When the producing operation was accepted (an explicit instant). */
  readonly publishedAt: TimestampMs;
}

/** Guard: `RegimeMessageEnvelope`. */
export function isRegimeMessageEnvelope(v: unknown): v is RegimeMessageEnvelope {
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
// The publication record (envelope + the full structured report)
// ---------------------------------------------------------------------------

/**
 * THE publication: the envelope (agent-os mirror, carrying the opaque
 * report reference) BOUND to the full structured regime research report
 * it publishes. No free-text conclusions exist anywhere in this record —
 * the report is enumerated fields, the payload is a bound reference.
 */
export interface RegimePublication {
  readonly envelope: RegimeMessageEnvelope;
  readonly report: RegimeResearchReport;
}

/** Guard: `RegimePublication` (structure only — use `validateRegimePublication` for the laws). */
export function isRegimePublication(v: unknown): v is RegimePublication {
  if (!isRecord(v)) return false;
  return isRegimeMessageEnvelope(v.envelope) && isRecord(v.report);
}

/** Derives the opaque report reference: `report:<reportId>`. */
export function regimeReportRefOf(report: RegimeResearchReport): string {
  return `report:${report.reportId}`;
}

// ---------------------------------------------------------------------------
// Envelope construction (derived identity — the kernel's exact formula)
// ---------------------------------------------------------------------------

/** The input record for building a regime research publication. */
export interface RegimePublicationInput {
  /** The kernel operation id this publication is caused by. */
  readonly opId: string;
  readonly topic: TopicName;
  readonly tenantId: TenantId;
  readonly sender: AgentInstanceId;
  /** The research report being published. */
  readonly report: RegimeResearchReport;
  /** The per-sender sequence of this publication (>= 1). */
  readonly sequence: number;
  /** The kernel op id carrying causality (defaults to `opId`). */
  readonly causalityId?: string;
  /** The explicit publication instant (no ambient clock). */
  readonly publishedAt: TimestampMs;
}

/**
 * Builds the publication (envelope + report): derived envelope id
 * (`msg:${opId}:${sender}:${sequence}` — the kernel's formula, mirrored
 * exactly), organization-topic validation (kernel.* refused with
 * `reserved_publication_topic`), and the payload bound to the report's
 * derived id. Pure and deterministic.
 */
export function buildRegimePublication(
  input: RegimePublicationInput,
): RegimeResult<RegimePublication> {
  const errors: RegimeError[] = [];
  if (!isNonEmptyString(input.opId)) errors.push(invalidField('opId', 'must be a non-empty kernel operation id'));
  if (!isTopicName(input.topic)) errors.push(invalidField('topic', 'must be a valid topic name'));
  else if (isKernelTopicMirror(input.topic)) {
    errors.push({
      code: 'reserved_publication_topic',
      path: 'topic',
      message: 'kernel.* topics are reserved for directed kernel mail — research publishes to organization topics only',
    });
  }
  if (!isTenantId(input.tenantId)) errors.push(invalidField('tenantId', 'must be a non-empty tenant id'));
  if (!isAgentInstanceId(input.sender)) errors.push(invalidField('sender', 'must be a valid agent instance id'));
  if (!isPositiveInteger(input.sequence)) errors.push(invalidField('sequence', 'must be an integer >= 1'));
  if (!isTimestampMs(input.publishedAt)) errors.push(invalidField('publishedAt', 'must be a valid epoch-millisecond instant'));
  if (errors.length > 0) return { ok: false, errors };
  const id = `msg:${input.opId}:${input.sender}:${input.sequence}`;
  return {
    ok: true,
    value: deepFreeze({
      envelope: deepFreeze({
        id,
        topic: input.topic,
        tenantId: input.tenantId,
        sender: input.sender,
        payload: regimeReportRefOf(input.report),
        sequence: input.sequence,
        causalityId: input.causalityId ?? input.opId,
        publishedAt: input.publishedAt,
      }),
      report: input.report,
    }),
  };
}

// ---------------------------------------------------------------------------
// The publication port (the ONLY seam research outputs leave through)
// ---------------------------------------------------------------------------

/** The receipt a publication port returns for an accepted publication. */
export interface RegimePublicationReceipt {
  /** The envelope id that was accepted. */
  readonly envelopeId: string;
  /** The opaque report reference the payload carried. */
  readonly reportRef: string;
}

/**
 * THE publication port: research outputs publish ONLY through this seam.
 * Implementations transport the envelope (an agent-os kernel mirror at
 * runtime); this contract guarantees the discipline — every accepted
 * publication carries a VALID structured research report, an organization
 * topic, and a payload bound to the report's derived id.
 */
export interface RegimePublicationPort {
  publish(publication: RegimePublication): RegimeResult<RegimePublicationReceipt>;
}

/** Guard: `RegimePublicationPort` (structural — the seam is honest). */
export function isRegimePublicationPort(value: unknown): value is RegimePublicationPort {
  if (!isRecord(value)) return false;
  return typeof value.publish === 'function';
}

/**
 * Port-side discipline check: the envelope must be well-formed, the
 * payload must be the report's bound reference, and the report must
 * validate under its own laws (a free-text, unbound, or tampered payload
 * is the `unstructured_publication` typed error — never a silent
 * pass-through).
 */
export function validateRegimePublication(
  publication: unknown,
  registry: RegimeMethodRegistry,
): readonly RegimeError[] {
  const errors: RegimeError[] = [];
  if (!isRecord(publication)) {
    return [invalidType('publication', 'a research publication record')];
  }
  const envelope: unknown = publication.envelope;
  const report: unknown = publication.report;
  if (!isRegimeMessageEnvelope(envelope)) {
    errors.push(invalidType('envelope', 'a message envelope mirror record'));
    return errors;
  }
  if (isKernelTopicMirror(envelope.topic)) {
    errors.push({
      code: 'reserved_publication_topic',
      path: 'envelope.topic',
      message: 'kernel.* topics are reserved for directed kernel mail — research publishes to organization topics only',
    });
  }
  const reportErrors = validateRegimeResearchReport(report, registry);
  if (reportErrors.length > 0) {
    errors.push({
      code: 'unstructured_publication',
      path: 'report',
      message: `the publication must carry a valid research report: ${reportErrors[0]?.message ?? 'invalid report'}`,
    });
    return errors;
  }
  if (envelope.payload !== regimeReportRefOf(report as RegimeResearchReport)) {
    errors.push({
      code: 'unstructured_publication',
      path: 'envelope.payload',
      message: 'the payload must be the opaque reference bound to the carried report (report:<reportId>)',
    });
  }
  if ((report as RegimeResearchReport).tenantId !== envelope.tenantId) {
    errors.push({
      code: 'tenant_missing',
      path: 'envelope.tenantId',
      message: 'the envelope tenant must match the report tenant (L12)',
    });
  }
  return errors;
}

/** An in-memory recording port for tests and fixtures (deterministic). */
export function createRegimeRecordingPort(): RegimePublicationPort & {
  /** Every publication accepted so far, in publication order. */
  readonly published: readonly RegimePublication[];
} {
  const accepted: RegimePublication[] = [];
  const port: RegimePublicationPort = {
    publish(publication: RegimePublication): RegimeResult<RegimePublicationReceipt> {
      if (!isRecord(publication) || !isRecord(publication.envelope)) {
        return { ok: false, errors: [invalidType('publication', 'a research publication record')] };
      }
      accepted.push(publication as RegimePublication);
      return {
        ok: true,
        value: deepFreeze({
          envelopeId: (publication.envelope as RegimeMessageEnvelope).id,
          reportRef: (publication.envelope as RegimeMessageEnvelope).payload,
        }),
      };
    },
  };
  // Object.assign would INVOKE the getter and snapshot an empty array —
  // defineProperty keeps the live accessor (the recording-port trap).
  Object.defineProperty(port, 'published', {
    get: (): readonly RegimePublication[] => deepFreeze(accepted.slice()),
    enumerable: true,
  });
  return Object.freeze(port) as RegimePublicationPort & {
    readonly published: readonly RegimePublication[];
  };
}

/** Canonical serialization of a publication (byte-deterministic, L9). */
export function serializeRegimePublication(publication: RegimePublication): string {
  return canonicalJson(publication as never);
}
