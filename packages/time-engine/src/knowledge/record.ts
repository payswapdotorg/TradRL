/**
 * @tradrl/time-engine/knowledge — the KnowledgeRecord contract (Work Order
 * T026).
 *
 * ARCHITECTURE-LOCK L4 polices observations AND derived state identically;
 * this subtree EXTENDS the observable boundary (src/boundary.ts, T004) from
 * raw events to ALL knowledge: raw observations, derived features,
 * aggregates, labels, cached data and research artifacts. Every one of those
 * shapes is ONE record type here — the payload is opaque; what the firewall
 * polices is the availability quartet, the knowledge-graph lineage and the
 * tenant scoping.
 *
 * The record carries:
 *
 *   THE AVAILABILITY QUARTET (mirrors the market-protocol envelope contract):
 *   - `event_time`      — when the knowledge came to be in the world.
 *   - `source_time`     — when the source says it happened (null when the
 *                         source does not say). ADVISORY: no ordering enforced.
 *   - `available_time`  — the earliest an agent may legitimately observe it.
 *                         THE information-boundary input (L4). Enforced:
 *                         `available_time >= event_time` — D-003 quartet
 *                         ordering (the ONLY enforced ordering; ingestion_time
 *                         is deliberately unordered: embargo before, backfill
 *                         after are both legitimate).
 *   - `ingestion_time`  — when TradRL actually received it. INFORMATIONAL.
 *                         The visibility predicate never consults it.
 *
 *   THE KNOWLEDGE GRAPH:
 *   - `inputs`          — parent RECORD ids (multi-input knowledge graphs).
 *                         Empty for primitive knowledge.
 *   - `computation`     — how derived knowledge was computed and at what
 *                         latency (the DerivedAvailability contract from
 *                         src/derived.ts, extended to the graph). Null iff
 *                         `inputs` is empty.
 *
 *   THE ISOLATION + LINEAGE:
 *   - `tenant`          — the owning tenant (L12).
 *   - `provenance`      — T008-shaped provenance reference (mirrored; see
 *                         provenance.ts).
 *
 * Records are immutable: {@link createKnowledgeRecord} validates and deeply
 * freezes. The visibility law (inclusive, origin-blind) lives in base.ts.
 */

import { isTimestampMs, type TimestampMs } from '../timestamp';
import { isComputationPolicy, type ComputationPolicy } from '../derived';
import { deepFreeze } from './freeze';
import { fail, ok, type KnowledgeResult } from './errors';
import { isKnowledgeRecordId, isTenantId, type KnowledgeRecordId, type TenantId } from './ids';
import { isKnowledgeProvenance, validateKnowledgeProvenance, type KnowledgeProvenance } from './provenance';

/**
 * One unit of knowledge policed by the firewall. The payload is opaque and
 * JSON-representable (carried verbatim; never interpreted here); the firewall
 * polices the quartet, the lineage, the policy and the tenant.
 */
export interface KnowledgeRecord {
  /** Opaque identity within a KnowledgeBase (append-only identity). */
  readonly record_id: KnowledgeRecordId;
  /** Owning tenant (L12 — cross-tenant reads and derivations are rejected). */
  readonly tenant: TenantId;
  /** Opaque JSON-representable payload. Never interpreted by the firewall. */
  readonly payload: unknown;
  /** When the knowledge came to be in the world. */
  readonly event_time: TimestampMs;
  /** When the source says it happened, when the source says. Advisory. */
  readonly source_time: TimestampMs | null;
  /** Earliest legitimate observation — THE L4 boundary input. */
  readonly available_time: TimestampMs;
  /** When TradRL received it. Informational; deliberately unordered. */
  readonly ingestion_time: TimestampMs;
  /** Knowledge-graph parents. Empty for primitive knowledge. */
  readonly inputs: readonly KnowledgeRecordId[];
  /** Computation policy. REQUIRED non-null iff `inputs` is non-empty. */
  readonly computation: ComputationPolicy | null;
  /** T008-shaped provenance reference (mirrored; see provenance.ts). */
  readonly provenance: KnowledgeProvenance;
}

/** A payload is opaque but must be JSON-representable (records are serializable). */
function isOpaquePayload(value: unknown): boolean {
  if (value === null) return true;
  const kind = typeof value;
  return kind === 'object' || kind === 'boolean' || kind === 'number' || kind === 'string';
}

/**
 * Structural runtime guard for a single KnowledgeRecord (quartet ordering,
 * lineage self-consistency, computation-iff-inputs, provenance shape).
 * Cross-record invariants (parent resolution, propagation floor, tenant
 * consistency of derivations) are enforced at append time —
 * see propagation.ts and base.ts.
 */
export function isKnowledgeRecord(value: unknown): value is KnowledgeRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  if (!isKnowledgeRecordId(candidate.record_id)) return false;
  if (!isTenantId(candidate.tenant)) return false;
  if (!isOpaquePayload(candidate.payload)) return false;

  if (!isTimestampMs(candidate.event_time)) return false;
  if (candidate.source_time !== null && !isTimestampMs(candidate.source_time)) return false;
  if (!isTimestampMs(candidate.available_time)) return false;
  if (!isTimestampMs(candidate.ingestion_time)) return false;
  // D-003 quartet ordering: the one enforced ordering.
  if ((candidate.available_time as number) < (candidate.event_time as number)) return false;

  if (!Array.isArray(candidate.inputs)) return false;
  const seen = new Set<string>();
  for (const input of candidate.inputs) {
    if (!isKnowledgeRecordId(input)) return false;
    if (input === candidate.record_id) return false; // no self-reference
    if (seen.has(input)) return false; // no duplicate parents
    seen.add(input);
  }

  const derived = candidate.inputs.length > 0;
  if (derived && !isComputationPolicy(candidate.computation)) return false;
  if (!derived && candidate.computation !== null) return false;

  if (!isKnowledgeProvenance(candidate.provenance)) return false;

  return true;
}

/**
 * Validating constructor for untrusted input. Enforces every single-record
 * invariant (guard + provenance rules) and returns a DEEPLY FROZEN record.
 * Cross-record invariants are enforced by `appendKnowledgeRecord`; this
 * constructor is the trusted-literals path for callers that build records
 * for a base.
 */
export function createKnowledgeRecord(input: unknown): KnowledgeResult<KnowledgeRecord> {
  if (typeof input !== 'object' || input === null) {
    return fail('invalid_record', 'a knowledge record must be an object');
  }
  const candidate = input as Record<string, unknown>;

  if (candidate.record_id === undefined) {
    return fail('invalid_record', 'record_id is required');
  }
  if (!isKnowledgeRecordId(candidate.record_id)) {
    return fail('invalid_record', 'record_id must be a non-empty string');
  }
  const recordId = candidate.record_id;

  if (candidate.tenant === undefined) {
    return fail('invalid_record', 'tenant is required');
  }
  if (!isTenantId(candidate.tenant)) {
    return fail('invalid_record', 'tenant must be a non-empty string');
  }

  if (candidate.payload === undefined) {
    return fail('invalid_record', 'payload is required (opaque, JSON-representable)');
  }
  if (!isOpaquePayload(candidate.payload)) {
    return fail('invalid_record', 'payload must be JSON-representable (null, boolean, number, string, array or object)');
  }

  // The availability quartet.
  if (candidate.event_time === undefined) {
    return fail('invalid_record', 'event_time is required');
  }
  if (!isTimestampMs(candidate.event_time)) {
    return fail('invalid_record', 'event_time must be a valid epoch-millisecond timestamp');
  }
  if (candidate.source_time === undefined) {
    return fail('invalid_record', 'source_time is required (null when the source does not say)');
  }
  if (candidate.source_time !== null && !isTimestampMs(candidate.source_time)) {
    return fail('invalid_record', 'source_time must be a valid epoch-millisecond timestamp or null');
  }
  if (candidate.available_time === undefined) {
    return fail('invalid_record', 'available_time is required');
  }
  if (!isTimestampMs(candidate.available_time)) {
    return fail('invalid_record', 'available_time must be a valid epoch-millisecond timestamp');
  }
  if (candidate.ingestion_time === undefined) {
    return fail('invalid_record', 'ingestion_time is required');
  }
  if (!isTimestampMs(candidate.ingestion_time)) {
    return fail('invalid_record', 'ingestion_time must be a valid epoch-millisecond timestamp');
  }
  if ((candidate.available_time as number) < (candidate.event_time as number)) {
    return fail(
      'timestamp_order',
      `available_time (${String(candidate.available_time)}) precedes event_time (${String(candidate.event_time)}) — knowledge about an event cannot be observable before the event occurred (D-003 quartet ordering)`,
    );
  }

  // The knowledge graph edge list.
  if (candidate.inputs === undefined) {
    return fail('invalid_record', 'inputs is required (empty for primitive knowledge)');
  }
  if (!Array.isArray(candidate.inputs)) {
    return fail('invalid_record', 'inputs must be an array of parent record ids');
  }
  const inputs: KnowledgeRecordId[] = [];
  const seen = new Set<string>();
  for (const parent of candidate.inputs) {
    if (!isKnowledgeRecordId(parent)) {
      return fail('invalid_record', 'every input must be a non-empty parent record id');
    }
    if (parent === recordId) {
      return fail('invalid_record', 'a knowledge record may not list itself among its inputs');
    }
    if (seen.has(parent)) {
      return fail('invalid_record', `duplicate input id "${parent}" in the knowledge lineage`);
    }
    seen.add(parent);
    inputs.push(parent);
  }
  const derived = inputs.length > 0;

  // Computation policy iff lineage.
  if (candidate.computation === undefined) {
    return fail('invalid_record', 'computation is required (null for primitive knowledge)');
  }
  if (derived) {
    if (!isComputationPolicy(candidate.computation)) {
      return fail('derived_without_policy', 'derived knowledge (non-empty inputs) must carry a computation policy');
    }
  } else if (candidate.computation !== null) {
    return fail('policy_without_lineage', 'a computation policy is only meaningful for derived knowledge (non-empty inputs)');
  }

  // Provenance (T008 shapes, mirrored).
  if (candidate.provenance === undefined) {
    return fail('invalid_record', 'provenance is required');
  }
  const provenanceResult = validateKnowledgeProvenance(candidate.provenance, recordId);
  if (!provenanceResult.ok) return provenanceResult;

  const record: KnowledgeRecord = {
    record_id: recordId,
    tenant: candidate.tenant,
    payload: candidate.payload,
    event_time: candidate.event_time,
    source_time: candidate.source_time,
    available_time: candidate.available_time,
    ingestion_time: candidate.ingestion_time,
    inputs: Object.freeze(inputs),
    computation: candidate.computation,
    provenance: deepFreeze(candidate.provenance) as KnowledgeProvenance,
  };
  return ok(deepFreeze(record));
}
