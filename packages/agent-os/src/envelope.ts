// @tradrl/agent-os — topic-addressed message envelopes.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L12 (tenant isolation — every
// envelope is tenant-scoped and cross-tenant delivery is not expressible);
// spec/DOMAIN-MODEL.md ("Team/TeamPolicy: topology, communication,
// delegation…"); spec/ARCHITECTURE.md ("Agent OS" — PUBLISH/SUBSCRIBE are
// kernel operations, so the message fabric is part of the stable kernel).
//
// An envelope is a TRANSPORT record: topic address, tenant scope, sender,
// opaque payload, per-sender sequence and a causality id linking it to the
// kernel operation that produced it. The payload is an opaque string — the
// kernel never interprets, validates or routes on payload content. Consumers
// (T016 organization compiler, T011 trajectory protocol) own payload
// semantics.
//
// Per-sender sequence discipline (mirrors the market-protocol event
// envelope's per-stream sequence law): for each sender, sequence values are
// strictly increasing starting at 1; the kernel assigns them, so sub-order
// within a sender is total and replayable.

import {
  type AgentInstanceId,
  type KernelOpId,
  type MessageId,
  type MessagePayload,
  type TenantId,
  type TopicName,
  deepFreeze,
  isAgentInstanceId,
  isKernelOpId,
  isMessageId,
  isMessagePayload,
  isRecord,
  isTenantId,
  isTopicName,
} from './primitives';
import { type TimestampMs, isTimestampMs } from './timestamp';

/**
 * Canonical kernel topics for DIRECTED deliveries (REQUEST, DELEGATE,
 * CHALLENGE, PROPOSE, APPROVE, ESCALATE). These are reserved names on the
 * topic fabric: consumers MUST NOT use them as organization topics. They
 * exist so a runtime can distinguish kernel-transported mail from
 organization publishes without inspecting payload content.
 */
export const KERNEL_TOPICS = [
  'kernel.request',
  'kernel.delegate',
  'kernel.challenge',
  'kernel.propose',
  'kernel.approve',
  'kernel.escalate',
  'kernel.cascade-escalate',
] as const;

/** A reserved kernel-transport topic name. */
export type KernelTopic = (typeof KERNEL_TOPICS)[number];

/**
 * A topic-addressed, tenant-scoped message envelope. Immutable and deeply
 * frozen when produced by the kernel. `causalityId` is the id of the kernel
 * operation that produced this message (`null` never occurs for
 * kernel-produced envelopes; the field is nullable only so external tooling
 * can construct forensic copies — the kernel always sets it).
 */
export interface MessageEnvelope {
  /** Message identity (globally unique; derived from the producing op). */
  readonly id: MessageId;
  /** Topic address. Kernel topics for directed mail; organization topics for PUBLISH. */
  readonly topic: TopicName;
  /** Tenant scope (L12). Delivery is confined to this tenant. */
  readonly tenantId: TenantId;
  /** Sending instance. */
  readonly sender: AgentInstanceId;
  /** Opaque payload — the kernel never interprets this. */
  readonly payload: MessagePayload;
  /** Per-sender sequence (strictly increasing per sender, 1-based). */
  readonly sequence: number;
  /** The kernel operation that produced this message. */
  readonly causalityId: KernelOpId | null;
  /** When the producing operation was accepted (op timestamp, not a wall clock). */
  readonly publishedAt: TimestampMs;
}

/** Guard: `MessageEnvelope`. */
export function isMessageEnvelope(v: unknown): v is MessageEnvelope {
  if (!isRecord(v)) return false;
  return (
    isMessageId(v.id) &&
    isTopicName(v.topic) &&
    isTenantId(v.tenantId) &&
    isAgentInstanceId(v.sender) &&
    isMessagePayload(v.payload) &&
    typeof v.sequence === 'number' &&
    Number.isInteger(v.sequence) &&
    v.sequence >= 1 &&
    (v.causalityId === null || isKernelOpId(v.causalityId)) &&
    isTimestampMs(v.publishedAt)
  );
}

/**
 * Constructs a deeply frozen `MessageEnvelope`, throwing `TypeError`
 * (field-prefixed) on invalid input. Sequence/causality are caller-supplied
 * so forensic tooling can rebuild envelopes; the KERNEL reducer always
 * derives them itself (sequence from the per-sender counter, causality from
 * the accepted op id).
 */
export function createMessageEnvelope(draft: MessageEnvelope): MessageEnvelope {
  const problems: string[] = [];
  if (!isMessageId(draft.id)) problems.push('id: invalid MessageId');
  if (!isTopicName(draft.topic)) problems.push('topic: invalid TopicName');
  if (!isTenantId(draft.tenantId)) problems.push('tenantId: invalid TenantId');
  if (!isAgentInstanceId(draft.sender)) problems.push('sender: invalid AgentInstanceId');
  if (!isMessagePayload(draft.payload)) problems.push('payload: invalid MessagePayload');
  if (typeof draft.sequence !== 'number' || !Number.isInteger(draft.sequence) || draft.sequence < 1) {
    problems.push('sequence: must be an integer >= 1');
  }
  if (draft.causalityId !== null && !isKernelOpId(draft.causalityId)) {
    problems.push('causalityId: invalid KernelOpId');
  }
  if (!isTimestampMs(draft.publishedAt)) problems.push('publishedAt: invalid TimestampMs');
  if (problems.length > 0) throw new TypeError(`createMessageEnvelope: ${problems.join('; ')}`);
  return deepFreeze({
    id: draft.id,
    topic: draft.topic,
    tenantId: draft.tenantId,
    sender: draft.sender,
    payload: draft.payload,
    sequence: draft.sequence,
    causalityId: draft.causalityId,
    publishedAt: draft.publishedAt,
  });
}

/**
 * `true` when `topic` is one of the reserved kernel-transport topics.
 * Organization topics (chosen by consumers/T016) must not collide with
 * these; SUBSCRIBE to a kernel topic is rejected by the reducer.
 */
export function isKernelTopic(topic: string): boolean {
  return (KERNEL_TOPICS as readonly string[]).includes(topic);
}
