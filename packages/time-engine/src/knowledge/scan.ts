/**
 * @tradrl/time-engine/knowledge — the knowledge leakage scan (Work Order
 * T026).
 *
 * The forensic instrument behind L4 at the knowledge layer: an audit pass
 * over a WHOLE base that re-derives every record's propagation floor from
 * the base's own knowledge graph and reports every violation:
 *
 *   - `leaky_record`     — a record whose `available_time` precedes the
 *                          latest `available_time` among its resolvable
 *                          same-tenant inputs (a past-dated artifact built
 *                          from future-available inputs — the leak). The
 *                          finding names the offending chain (the record
 *                          followed by its input ids) and the offending
 *                          inputs.
 *   - `missing_input`    — an input id that does not resolve in the base
 *                          (possible only in bases built through the
 *                          forensic loading path or delivered from outside
 *                          the guarded append path).
 *   - `tenant_boundary_crossing` — a derivation edge crossing tenants (L12).
 *
 * Pure and deterministic: findings are emitted in append order, edges in
 * input-list order — a scan of the same base always produces the same
 * report. The append path makes all three findings inexpressible; the scan
 * exists because bases can be loaded, delivered or corrupted from outside
 * the guarded path (a clean scan is positive evidence that a knowledge
 * graph never leaked the future).
 */

import { deepFreeze } from './freeze';
import { fail, ok, type KnowledgeResult } from './errors';
import type { KnowledgeRecordId, TenantId } from './ids';
import type { KnowledgeRecord } from './record';
import type { KnowledgeBase } from './base';

/**
 * A record whose `available_time` precedes its propagation floor — the
 * actual leak. `leadMs` is how far the record is dated into the past
 * relative to its latest input (always > 0).
 */
export interface LeakyRecordFinding {
  readonly kind: 'leaky_record';
  readonly record_id: KnowledgeRecordId;
  readonly tenant: TenantId;
  readonly available_time: number;
  /** The propagation floor: max(available_time of the resolvable same-tenant inputs). */
  readonly floor: number;
  /** How far the record precedes its floor, in milliseconds (always > 0). */
  readonly leadMs: number;
  /** The inputs whose available_time exceeds the record's (the leaking parents). */
  readonly offending_inputs: readonly KnowledgeRecordId[];
  /** The offending chain: the record id followed by its input ids. */
  readonly chain: readonly KnowledgeRecordId[];
}

/** An input id that does not resolve in the base. */
export interface MissingInputFinding {
  readonly kind: 'missing_input';
  readonly record_id: KnowledgeRecordId;
  readonly tenant: TenantId;
  readonly input_id: KnowledgeRecordId;
}

/** A derivation edge crossing a tenant boundary (L12). */
export interface TenantBoundaryCrossingFinding {
  readonly kind: 'tenant_boundary_crossing';
  readonly record_id: KnowledgeRecordId;
  readonly tenant: TenantId;
  readonly input_id: KnowledgeRecordId;
  readonly input_tenant: TenantId;
}

export type KnowledgeLeakageFinding = LeakyRecordFinding | MissingInputFinding | TenantBoundaryCrossingFinding;

export interface KnowledgeLeakageReport {
  /** True iff no findings — the knowledge graph never leaked the future. */
  readonly clean: boolean;
  readonly findings: readonly KnowledgeLeakageFinding[];
  readonly recordsChecked: number;
  readonly edgesChecked: number;
}

/**
 * Scan a knowledge base for L4/L12 violations. When `tenant` is provided the
 * scan is scoped to that tenant's records (the subgraph audit); findings on
 * other tenants' records are not reported. The scan re-resolves every input
 * edge from the base itself — it trusts nothing but the base's own content.
 */
export function knowledgeLeakageScan(base: KnowledgeBase, tenant?: TenantId): KnowledgeLeakageReport {
  const findings: KnowledgeLeakageFinding[] = [];
  const byId = new Map<KnowledgeRecordId, KnowledgeRecord>();
  for (const record of base.records) {
    byId.set(record.record_id, record);
  }

  let recordsChecked = 0;
  let edgesChecked = 0;

  for (const record of base.records) {
    if (tenant !== undefined && record.tenant !== tenant) continue;
    recordsChecked += 1;

    if (record.inputs.length === 0) continue; // primitive knowledge: no edges to audit

    // The propagation floor over the resolvable, same-tenant inputs. Missing
    // and crossing edges produce their own findings and do not suppress a
    // leak that is independently demonstrable on the resolvable edges.
    let floor: number | undefined = undefined;
    const offendingInputs: KnowledgeRecordId[] = [];

    for (const inputId of record.inputs) {
      edgesChecked += 1;
      const parent = byId.get(inputId);
      if (parent === undefined) {
        findings.push({
          kind: 'missing_input',
          record_id: record.record_id,
          tenant: record.tenant,
          input_id: inputId,
        });
        continue;
      }
      if (parent.tenant !== record.tenant) {
        findings.push({
          kind: 'tenant_boundary_crossing',
          record_id: record.record_id,
          tenant: record.tenant,
          input_id: inputId,
          input_tenant: parent.tenant,
        });
        continue;
      }
      if (floor === undefined || parent.available_time > floor) floor = parent.available_time;
      if (parent.available_time > record.available_time) offendingInputs.push(inputId);
    }

    if (floor !== undefined && record.available_time < floor) {
      findings.push({
        kind: 'leaky_record',
        record_id: record.record_id,
        tenant: record.tenant,
        available_time: record.available_time,
        floor,
        leadMs: floor - record.available_time,
        offending_inputs: offendingInputs,
        chain: [record.record_id, ...record.inputs],
      });
    }
  }

  // One deep freeze over the whole report (findings, nested arrays, objects).
  return deepFreeze({
    clean: findings.length === 0,
    findings,
    recordsChecked,
    edgesChecked,
  });
}

/**
 * Convenience gate: run the scan and surface a TYPED error when the base
 * leaks (first violation described precisely). Useful for ingestion-time
 * acceptance of externally delivered bases.
 */
export function requireCleanKnowledgeBase(base: KnowledgeBase, tenant?: TenantId): KnowledgeResult<true> {
  const report = knowledgeLeakageScan(base, tenant);
  if (!report.clean) {
    const first = report.findings[0];
    if (first === undefined) {
      return fail('derived_before_inputs', 'knowledge base leaks the future: unknown violation');
    }
    if (first.kind === 'leaky_record') {
      return fail(
        'derived_before_inputs',
        `record "${first.record_id}" is available at ${first.available_time} before its propagation floor ${first.floor} (chain: ${first.chain.join(' -> ')})`,
      );
    }
    if (first.kind === 'missing_input') {
      return fail('unknown_input', `record "${first.record_id}" has unresolved input "${first.input_id}"`);
    }
    return fail(
      'tenant_isolation',
      `record "${first.record_id}" derives across the tenant boundary from "${first.input_id}" (tenant "${first.input_tenant}") — L12`,
    );
  }
  return ok(true);
}
