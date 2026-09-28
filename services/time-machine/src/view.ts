/**
 * @tradrl/time-machine — the AsOfView (Work Order T029).
 *
 * The point-in-time answer to "what was knowable at T?": an opaque dataset
 * reference, the instant T, the projection selector, the firewall-passed
 * records (each carrying its availability quartet UNMODIFIED), the firewall
 * decision audit log (delegation evidence) and the LINEAGE-RECOMPUTABLE
 * view hash.
 *
 * RECORD ORDER: (available_time, record_id) ascending — the deterministic
 * point-in-time discipline mirrored from the T008 store's window query
 * (`sorted by (available_time, event_id) — deterministic`), independent of
 * arrival order.
 *
 * THE VIEW HASH ({@link computeViewHash} / {@link recomputeViewHash}): a
 * deterministic dual-lane FNV-1a checksum over the view's LINEAGE SKELETON —
 * dataset, instant, selector, and per record: identity, the availability
 * quartet, the knowledge-graph edges and the provenance lineage (origin,
 * derived_from, transform, custody commit). Opaque payloads are content,
 * not lineage: they are bound by deep-equality of views, not by the hash.
 * Recomputing from the view's own fields reproduces the hash bit-for-bit —
 * "lineage-recomputable" — and two runs over the same event sequence
 * produce identical hashes (the L9 determinism law).
 */

import { hashOf } from './hash';
import type { FirewallAuditLog, KnowledgeQueryFilter } from './firewall';
import type { DatasetRef, ViewHash } from './ids';
import type { TimestampMs } from './timestamp';
import type { TimeMachineRecord } from './record';

/** The point-in-time query: opaque dataset ref + instant T + projection selector. */
export interface AsOfQuery {
  /** The rolling dataset this query addresses (must match the machine's dataset). */
  readonly dataset: DatasetRef;
  /** The instant T: the view exposes ONLY records with available_time <= T (L4, inclusive). */
  readonly at: TimestampMs;
  /** The projection selector narrowing the visible slice (firewall filter mirror). */
  readonly selector?: KnowledgeQueryFilter;
}

/** The point-in-time view: firewall-passed records + audit + lineage hash. */
export interface AsOfView {
  readonly dataset: DatasetRef;
  readonly at: TimestampMs;
  /** The EFFECTIVE selector (a frozen copy; `{}` when the query omitted one). */
  readonly selector: KnowledgeQueryFilter;
  /** Firewall-passed records, (available_time, record_id) ascending; quartet carried unmodified. */
  readonly records: readonly TimeMachineRecord[];
  /** The firewall's replayable decision log — the delegation evidence. */
  readonly audit: FirewallAuditLog;
  /** Deterministic lineage checksum, recomputable via {@link recomputeViewHash}. */
  readonly hash: ViewHash;
}

/** Deterministic record order: (available_time, record_id) ascending — the T008 window-query discipline. */
export function compareByAvailability(a: TimeMachineRecord, b: TimeMachineRecord): number {
  if (a.available_time !== b.available_time) return a.available_time - b.available_time;
  return a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0;
}

/** Sort a list of records into the deterministic point-in-time order (new array). */
export function sortByAvailability(records: readonly TimeMachineRecord[]): TimeMachineRecord[] {
  return [...records].sort(compareByAvailability);
}

/** The lineage-bearing skeleton of one record (payload deliberately excluded). */
function recordSkeleton(record: TimeMachineRecord): unknown {
  return {
    record_id: record.record_id,
    event_time: record.event_time,
    source_time: record.source_time,
    available_time: record.available_time,
    ingestion_time: record.ingestion_time,
    arrival_sequence: record.arrival_sequence,
    inputs: record.inputs,
    provenance: {
      origin: record.provenance.origin,
      derived_from: record.provenance.derived_from,
      transform: record.provenance.transform,
      custody: {
        commit_id: record.provenance.custody.commit.commit_id,
        commit_sequence: record.provenance.custody.commit.commit_sequence,
        ingestion_time: record.provenance.custody.commit.ingestion_time,
      },
    },
  };
}

/** The hashable lineage content of a view (everything except the hash itself). */
export function viewHashContent(view: Omit<AsOfView, 'hash'>): unknown {
  return {
    dataset: view.dataset,
    at: view.at,
    selector: view.selector,
    records: view.records.map((record) => recordSkeleton(record)),
  };
}

/** Compute the deterministic lineage hash of a view's content. */
export function computeViewHash(view: Omit<AsOfView, 'hash'>): ViewHash {
  return hashOf(viewHashContent(view)) as ViewHash;
}

/**
 * Recompute the lineage hash from a view's OWN fields — the
 * "lineage-recomputable" contract: for every view the machine emits,
 * `recomputeViewHash(view) === view.hash`.
 */
export function recomputeViewHash(view: AsOfView): ViewHash {
  return computeViewHash({ dataset: view.dataset, at: view.at, selector: view.selector, records: view.records });
}
