/**
 * @tradrl/time-engine/knowledge — derived-knowledge availability propagation
 * (Work Order T026).
 *
 * This module EXTENDS the `DerivedAvailability` contract (src/derived.ts,
 * T004) from flat input lists to MULTI-INPUT KNOWLEDGE GRAPHS:
 *
 *     record.available_time >= max(input.available_time)
 *
 * is the LAW (mirrors `validateDerivedAvailability`), and
 *
 *     canonical available_time = max(input.available_time) + policy.delay
 *
 * is the construction rule (mirrors `derivedAvailableTime`). Because every
 * append is validated against parents that were themselves validated at
 * THEIR append, the floor propagates TRANSITIVELY over the graph: an
 * aggregate over features over raw observations can never be available
 * before its transitive ancestors.
 *
 * Cross-lane rule: a derived record dated before its latest input is a
 * boundary violation — rejected at append time by
 * {@link validateKnowledgeRecord} (which also enforces L12: a tenant may
 * not derive from another tenant's records) and detected forensically by
 * the leakage scan (scan.ts).
 */

import { MAX_TIMESTAMP_MS, isTimestampMs, maxTimestamps, timestampMs, type TimestampMs } from '../timestamp';
import { isDuration, durationToMs, type Duration } from '../duration';
import { fail, ok, type KnowledgeResult } from './errors';
import type { KnowledgeRecordId, TenantId } from './ids';
import { isKnowledgeRecord, type KnowledgeRecord } from './record';
import { validateKnowledgeProvenance } from './provenance';

/** Re-validate a computation policy: transform id first, then the delay. */
function validatePolicy(transformId: string, delay: Duration): KnowledgeResult<true> {
  if (typeof transformId !== 'string' || transformId.length === 0) {
    return fail('invalid_policy', 'computation policy requires a non-empty transform_id');
  }
  if (!isDuration(delay)) {
    return fail('invalid_duration', 'computation policy delay must be a valid Duration');
  }
  const delayMs = durationToMs(delay);
  if (!delayMs.ok) return delayMs; // surfaces 'invalid_duration' with the precise cause
  return ok(true);
}

/**
 * Compute the CANONICAL `available_time` for a derived knowledge record over
 * its multi-input graph: max(input available_time) + policy.delay. Inputs
 * must be non-empty. Callers may legitimately embargo beyond this value;
 * they may never date earlier than the floor (see
 * {@link knowledgePropagationFloor}).
 */
export function derivedKnowledgeAvailableTime(
  inputs: readonly KnowledgeRecord[],
  transformId: string,
  delay: Duration,
): KnowledgeResult<TimestampMs> {
  const policyResult = validatePolicy(transformId, delay);
  if (!policyResult.ok) return policyResult;
  if (inputs.length === 0) {
    return fail('no_inputs', 'derivedKnowledgeAvailableTime requires at least one input record');
  }
  for (const input of inputs) {
    if (!isKnowledgeRecord(input)) {
      return fail('invalid_record', 'every propagation input must be a structurally valid KnowledgeRecord');
    }
  }
  const latestInput = maxTimestamps(inputs.map((input) => input.available_time));
  if (!latestInput.ok) return latestInput;
  const delayMs = durationToMs(delay);
  if (!delayMs.ok) return delayMs;
  const target = latestInput.value + delayMs.value;
  if (target > MAX_TIMESTAMP_MS) {
    return fail('out_of_range', 'derived knowledge available_time overflows the representable timestamp range');
  }
  return timestampMs(target);
}

/**
 * The LEGAL floor for a derived record: the latest available_time among its
 * inputs. `record.available_time` must be >= this value (L4 propagation law).
 * Inputs must be non-empty.
 */
export function knowledgePropagationFloor(inputs: readonly KnowledgeRecord[]): KnowledgeResult<TimestampMs> {
  if (inputs.length === 0) {
    return fail('no_inputs', 'knowledgePropagationFloor requires at least one input record');
  }
  for (const input of inputs) {
    if (!isKnowledgeRecord(input)) {
      return fail('invalid_record', 'every propagation input must be a structurally valid KnowledgeRecord');
    }
  }
  const latestInput = maxTimestamps(inputs.map((input) => input.available_time));
  if (!latestInput.ok) return latestInput;
  return ok(latestInput.value);
}

/**
 * Append-time validation of a knowledge record against its resolved parents:
 * the firewall's propagation law (L4) plus derivation tenant isolation (L12).
 *
 * `parents` must map every id in `record.inputs` to the parent record as
 * resolved from the knowledge base. Checked, in order:
 *   1. `record` is structurally valid (quartet, lineage, policy, provenance).
 *   2. Every input id resolves in `parents` — otherwise `unknown_input`
 *      (append-only bases make cycles and self-reference inexpressible:
 *      a parent must already be present).
 *   3. Every parent is structurally valid.
 *   4. Derivation tenant isolation: every parent belongs to the record's
 *      tenant — a tenant may not derive from another tenant's records.
 *   5. Propagation: `available_time >= max(parent available_time)`.
 *
 * Success returns `true`.
 */
export function validateKnowledgeRecord(
  record: KnowledgeRecord,
  parents: ReadonlyMap<KnowledgeRecordId, KnowledgeRecord>,
): KnowledgeResult<true> {
  if (!isKnowledgeRecord(record)) {
    return fail('invalid_record', 'the knowledge record is structurally invalid');
  }
  // Full provenance rules (the structural guard checks shape only; the
  // append path must enforce field validity too — mirror discipline of the
  // event lane: validateMarketEvent runs validateProvenance, not isProvenance).
  const provenanceResult = validateKnowledgeProvenance(record.provenance, record.record_id);
  if (!provenanceResult.ok) return provenanceResult;
  if (record.inputs.length === 0) return ok(true); // primitive knowledge: no cross-record invariants

  const resolved: KnowledgeRecord[] = [];
  for (const inputId of record.inputs) {
    const parent = parents.get(inputId);
    if (parent === undefined) {
      return fail('unknown_input', `input "${inputId}" does not resolve in the knowledge base`);
    }
    if (!isKnowledgeRecord(parent)) {
      return fail('invalid_record', `input "${inputId}" resolves to a structurally invalid record`);
    }
    resolved.push(parent);
  }

  const tenant: TenantId = record.tenant;
  for (const parent of resolved) {
    if (parent.tenant !== tenant) {
      return fail(
        'tenant_isolation',
        `record "${record.record_id}" (tenant "${tenant}") may not derive from record "${parent.record_id}" (tenant "${parent.tenant}") — L12`,
      );
    }
  }

  const floor = knowledgePropagationFloor(resolved);
  if (!floor.ok) return floor;
  if (record.available_time < floor.value) {
    return fail(
      'derived_before_inputs',
      `derived knowledge available_time (${record.available_time}) precedes its latest input (${floor.value}) — record "${record.record_id}"`,
    );
  }
  return ok(true);
}
