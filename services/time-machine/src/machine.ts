/**
 * @tradrl/time-machine — the RollingTimeMachine (Work Order T029,
 * reference implementation).
 *
 * The rolling near-real-time Time Machine: as live canonical events stream
 * in (T008 ingestion shapes, mirrored), it maintains a ROLLING WINDOW — a
 * configurable availability horizon with memory-bounded eviction — and
 * continuously answers "what was knowable at time T?" (spec/ARCHITECTURE.md
 * "Time Machine"; ARCHITECTURE-LOCK L4/L9/L12).
 *
 * THE LAWS THIS SERVICE ENFORCES:
 *
 *   L4 — POINT-IN-TIME TRUTH: an AsOf view at query time T exposes ONLY
 *   records whose `available_time <= T` (INCLUSIVE — visible exactly at the
 *   availability instant, never one millisecond earlier). The firewall is
 *   the AUTHORITY: every projection routes through the injected
 *   {@link FirewallProjectionPort} (the T026 projection contract, mirrored);
 *   there is NO bypass path — a machine without a port returns typed
 *   `firewall_required` on every projection, by construction and by test.
 *   `event_time`/`source_time`/`ingestion_time` are carried on every
 *   emitted record, never used as the gate; `ingestion_time` is NEVER
 *   consulted for visibility (embargo before, backfill after are both
 *   legitimate — D-003).
 *
 *   L9 — REPRODUCIBLE LINEAGE: no wall-clock anywhere. Time advances by
 *   injected events only; the admission stamp comes from an injected
 *   deterministic clock; replaying the same event sequence (same ingestion
 *   order) produces byte-identical as-of states, cursor positions and view
 *   hashes (deep-equal, proven by the behavioral suite). Snapshots carry a
 *   lineage hash; restores reproduce identical subsequent behavior.
 *
 *   LATE/REORDERED ARRIVALS — T008 RECONCILIATION, DECLARED: an event is
 *   LATE iff its `available_time` is strictly below the running
 *   availability frontier at its admission moment (out-of-order arrival,
 *   within-batch reordering included). Under the declared
 *   {@link LateArrivalPolicy}: `recompute` admits it — the as-of state
 *   updates from its available_time onward because every view is computed
 *   fresh from the window through the firewall — or `quarantine` holds it
 *   in the declared exception queue with its lateness. Nothing is silently
 *   dropped: invalid events and reconciliation rejections carry typed
 *   reasons (T008 store-code mirrors); quarantined events carry declared
 *   lateness. Events are never applied out-of-order: views are
 *   availability-ordered and firewall-gated.
 *
 *   ROLLING WINDOW: the horizon bounds the RETAINED availability span
 *   [frontier - horizon, frontier] (inclusive floor); `max_records` is the
 *   hard memory bound (deterministic (available_time, record_id)
 *   tie-break). Eviction is declared per ingest (notices with reasons).
 *   Consumers must drain cursors within the horizon — an evicted record is
 *   gone by contract (near-real-time, not an archive: T009 owns historical
 *   batch replay).
 */

import { isTimestampMs, type TimestampMs } from './timestamp';
import { durationToMillis, isDuration, type Duration } from './duration';
import { deepFreeze } from './freeze';
import { fail, ok, type TimeMachineResult } from './errors';
import {
  isCursorId,
  isDatasetRef,
  isTenantId,
  type CursorId,
  type DatasetRef,
  type TenantId,
} from './ids';
import {
  isCanonicalEvent,
  isNonNegativeSafeInteger,
  isRecord,
  validateCanonicalEvent,
  type CanonicalEvent,
  type ValidationFailure,
} from './canonical-event';
import { admitCanonicalEvent, isTimeMachineRecord, type TimeMachineRecord } from './record';
import {
  isFirewallProjectionPort,
  validateProjectionSelector,
  type FirewallProjectionPort,
  type KnowledgeBaseView,
  type KnowledgeQueryFilter,
} from './firewall';
import { createDeterministicIngestClock, nextIngestStamp, type IngestClock } from './clock';
import {
  computeViewHash,
  sortByAvailability,
  type AsOfQuery,
  type AsOfView,
} from './view';
import {
  sealSnapshot,
  validateTimeMachineSnapshot,
  type CursorSnapshotEntry,
  type TimeMachineSnapshot,
} from './snapshot';

// ---------------------------------------------------------------------------
// Configuration and policy.
// ---------------------------------------------------------------------------

/**
 * The declared reconciliation for late (out-of-order) arrivals — the T008
 * rules mirrored: `recompute` (admit; the as-of state updates from the
 * event's available_time onward — views are computed fresh from the
 * window) or `quarantine` (hold in the declared exception queue with its
 * lateness). Silent drop is UNREPRESENTABLE — there is no third path.
 */
export type LateArrivalPolicy = 'recompute' | 'quarantine';

/** Configuration of one rolling time machine. All fields total-guarded at construction. */
export interface TimeMachineConfig {
  /** The opaque dataset identity this machine serves (AsOfQuery.dataset must match). */
  readonly dataset: DatasetRef;
  /** The owning tenant stamped on every admitted record (L12). */
  readonly tenant: TenantId;
  /** The rolling availability horizon (retained span [frontier - horizon, frontier], inclusive floor). */
  readonly horizon: Duration;
  /** The hard memory bound on retained records (deterministic (available_time, record_id) eviction). */
  readonly maxRecords: number;
  /** The declared late-arrival reconciliation. */
  readonly lateArrival: LateArrivalPolicy;
  /**
   * The knowledge-firewall projection port (T026 contract, mirrored). OPTIONAL:
   * a machine without it can ingest but every projection is a typed
   * `firewall_required` error — there is no direct-read fallback.
   */
  readonly firewall?: FirewallProjectionPort;
  /**
   * The ingest clock stamping admission ingestion_times (L9 — injected,
   * never a wall clock). Defaults to the built-in deterministic stepping
   * clock (base 0, step 1) — snapshot/restore transfers its state.
   */
  readonly ingestClock?: IngestClock;
}

/** Runtime guard for the config. */
export function isTimeMachineConfig(value: unknown): value is TimeMachineConfig {
  if (!isRecord(value)) return false;
  if (!isDatasetRef(value.dataset)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isDuration(value.horizon)) return false;
  if (typeof value.maxRecords !== 'number' || !Number.isSafeInteger(value.maxRecords) || value.maxRecords < 1) {
    return false;
  }
  if (value.lateArrival !== 'recompute' && value.lateArrival !== 'quarantine') return false;
  if (value.firewall !== undefined && !isFirewallProjectionPort(value.firewall)) return false;
  if (value.ingestClock !== undefined) {
    if (typeof value.ingestClock !== 'object' || value.ingestClock === null) return false;
    if (typeof (value.ingestClock as Record<string, unknown>).next !== 'function') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ingest outcomes.
// ---------------------------------------------------------------------------

/** The disposition of one submitted event. */
export type IngestDispositionKind = 'admitted' | 'rejected' | 'quarantined_late';

/** The declared disposition of one submitted event (position-aligned with the submission). */
export interface IngestDisposition {
  /** The event's id when readable (null when the candidate was not even event-shaped). */
  readonly event_id: string | null;
  readonly disposition: IngestDispositionKind;
  /** The 0-based admission ordinal when admitted; null otherwise. */
  readonly arrival_sequence: number | null;
  /** The typed rejection code when rejected; null otherwise. */
  readonly rejection_code: TimeMachineErrorCode | null;
  /** Field-level errors when the envelope failed validation; empty otherwise. */
  readonly errors: readonly ValidationFailure[];
  /** How many milliseconds behind the running frontier the event was (quarantined_late only). */
  readonly late_by: number | null;
}

/** Why a record left the rolling window. */
export type EvictionReason = 'horizon' | 'capacity';

/** The declared eviction of one retained record. */
export interface EvictionNotice {
  readonly record_id: string;
  readonly available_time: TimestampMs;
  readonly reason: EvictionReason;
}

/** Retained-window statistics. */
export interface WindowStats {
  readonly size: number;
  readonly oldest_available: TimestampMs | null;
  readonly newest_available: TimestampMs | null;
}

/** The outcome of one ingest batch (deeply frozen evidence). */
export interface IngestReceipt {
  readonly batch_id: string;
  readonly batch_ordinal: number;
  /** One disposition per submitted event, position-aligned. */
  readonly dispositions: readonly IngestDisposition[];
  readonly admitted: number;
  readonly rejected: number;
  readonly quarantined: number;
  /** Records evicted by this batch's eviction pass, in eviction order. */
  readonly evicted: readonly EvictionNotice[];
  /** The availability frontier after this ingest (max admitted available_time ever). */
  readonly frontier: TimestampMs | null;
  readonly window: WindowStats;
}

/** A quarantined late arrival — the declared exception (never silently dropped). */
export interface QuarantinedEvent {
  /** The event, carried verbatim (frozen). */
  readonly event: CanonicalEvent;
  readonly reason: 'late_arrival';
  /** frontier - available_time at quarantine: how late, in milliseconds. */
  readonly late_by: number;
  readonly frontier_at_quarantine: TimestampMs;
  readonly batch_id: string;
  readonly batch_ordinal: number;
}

/** A typed ingest rejection — the declared failure (never silently dropped). */
export interface RejectionRecord {
  readonly event_id: string | null;
  readonly batch_id: string;
  readonly batch_ordinal: number;
  readonly code: TimeMachineErrorCode;
  readonly message: string;
  readonly errors: readonly ValidationFailure[];
}

// ---------------------------------------------------------------------------
// Cursors.
// ---------------------------------------------------------------------------

/** Options for opening a cursor. */
export interface CursorOptions {
  /** The consumer's bound projection selector (firewall filter mirror); `{}` when omitted. */
  readonly selector?: KnowledgeQueryFilter;
  /** `start` replays the retained window from the oldest arrival; `tip` starts at the live edge. Default `start`. */
  readonly from?: 'start' | 'tip';
}

/** The resumable consumer position (a live view of one cursor). */
export interface PointInTimeCursor {
  readonly cursor_id: CursorId;
  readonly dataset: DatasetRef;
  /** The arrival scan boundary — MONOTONE: it never moves backward. */
  readonly position: number;
  /** The instant of the last drain (null before the first drain). */
  readonly last_drain_at: TimestampMs | null;
  /** The consumer's bound selector. */
  readonly selector: KnowledgeQueryFilter;
  /** Diagnostics: drains performed / records delivered. */
  readonly drains: number;
  readonly delivered: number;
}

/** The outcome of one cursor drain. */
export interface CursorDrain {
  readonly cursor_id: CursorId;
  readonly at: TimestampMs;
  /** The newly delivered records, (available_time, record_id) ascending — firewall-passed at `at`. */
  readonly records: readonly TimeMachineRecord[];
  /** The cursor's new position (>= the old one, always). */
  readonly position: number;
  /** Whether the position advanced. */
  readonly advanced: boolean;
  /** The firewall decision log for this drain — the delegation evidence. */
  readonly audit: import('./firewall').FirewallAuditLog;
}

/** Internal mutable cursor state. */
interface CursorState {
  readonly cursor_id: CursorId;
  position: number;
  last_drain_at: TimestampMs | null;
  readonly selector: KnowledgeQueryFilter;
  drains: number;
  delivered: number;
}

// ---------------------------------------------------------------------------
// Machine statistics.
// ---------------------------------------------------------------------------

/** Whole-machine statistics (no records — stats are not a projection surface). */
export interface MachineStats {
  readonly dataset: DatasetRef;
  readonly tenant: TenantId;
  readonly horizon_ms: number;
  readonly max_records: number;
  readonly late_arrival: LateArrivalPolicy;
  readonly window_size: number;
  readonly admitted_total: number;
  readonly quarantined_total: number;
  readonly rejected_total: number;
  readonly batches_total: number;
  readonly frontier: TimestampMs | null;
  readonly oldest_available: TimestampMs | null;
  readonly newest_available: TimestampMs | null;
  readonly cursors: number;
  /** Whether a firewall passage is bound (projections work only when true). */
  readonly firewall_bound: boolean;
}

// ---------------------------------------------------------------------------
// The machine.
// ---------------------------------------------------------------------------

/** The rolling near-real-time Time Machine. */
export interface RollingTimeMachine {
  readonly dataset: DatasetRef;
  readonly tenant: TenantId;

  /** Ingest one batch of canonical events (untrusted input; typed dispositions for every candidate). */
  ingestBatch(events: readonly unknown[], batch: { readonly batch_id: string }): TimeMachineResult<IngestReceipt>;

  /** The point-in-time query — ALWAYS through the firewall passage. */
  asOf(query: AsOfQuery): TimeMachineResult<AsOfView>;

  /** Open a consumer cursor (`start` replays the retained window; `tip` starts at the live edge). */
  openCursor(options?: CursorOptions): TimeMachineResult<PointInTimeCursor>;

  /** Drain a cursor at instant T: everything newly visible to the consumer (firewall-passed). */
  drainCursor(cursorId: CursorId, at: TimestampMs): TimeMachineResult<CursorDrain>;

  /** Fork a cursor: a new consumer at the identical delta anchors (replay-from-cursor). */
  forkCursor(cursorId: CursorId): TimeMachineResult<PointInTimeCursor>;

  /** One cursor's live position (typed `unknown_cursor`). */
  getCursor(cursorId: CursorId): TimeMachineResult<PointInTimeCursor>;

  /** Every cursor's live position (defensive copy, frozen). */
  cursors(): readonly PointInTimeCursor[];

  /** The declared quarantine queue (operator evidence; never as-of state). */
  quarantine(): readonly QuarantinedEvent[];

  /** The declared rejection audit trail (operator evidence; never as-of state). */
  rejections(): readonly RejectionRecord[];

  /** Whole-machine statistics. */
  stats(): MachineStats;

  /** The serializable as-of state with lineage hash (for restore; not a consumer projection). */
  snapshot(): TimeMachineSnapshot;
}

/** Deterministic cursor id from the creation ordinal. */
function cursorIdFor(ordinal: number): CursorId {
  return `cur-${String(ordinal).padStart(8, '0')}` as CursorId;
}

/** Read an event_id off an untrusted candidate (null when unreadable). */
function eventIdOf(candidate: unknown): string | null {
  return isRecord(candidate) && typeof candidate.event_id === 'string' && candidate.event_id.length > 0
    ? candidate.event_id
    : null;
}

/** The effective, frozen selector of a query/cursor (copy; `{}` when absent). */
function effectiveSelector(selector: KnowledgeQueryFilter | undefined): KnowledgeQueryFilter {
  if (selector === undefined) return Object.freeze({});
  return selector.ids === undefined ? Object.freeze({ ...selector }) : Object.freeze({ ...selector, ids: Object.freeze([...selector.ids]) });
}

/** Compute retained-window stats. */
function windowStatsOf(window: readonly TimeMachineRecord[]): WindowStats {
  let oldest: TimestampMs | null = null;
  let newest: TimestampMs | null = null;
  for (const record of window) {
    if (oldest === null || record.available_time < oldest) oldest = record.available_time;
    if (newest === null || record.available_time > newest) newest = record.available_time;
  }
  return deepFreeze({ size: window.length, oldest_available: oldest, newest_available: newest }) as WindowStats;
}

/** Internal mutable machine core. */
interface MachineCore {
  window: TimeMachineRecord[];
  byId: Map<string, TimeMachineRecord>;
  /** Every record id ever admitted (append-only identity outlives the window). */
  admittedEver: Set<string>;
  frontier: TimestampMs | null;
  ingestCount: number;
  batchOrdinal: number;
  cursorOrdinal: number;
  quarantine: QuarantinedEvent[];
  rejections: RejectionRecord[];
  cursors: Map<string, CursorState>;
}

/** Build the machine object over a prepared core + resolved config. */
function buildMachine(
  core: MachineCore,
  dataset: DatasetRef,
  tenant: TenantId,
  horizonMs: number,
  maxRecords: number,
  lateArrival: LateArrivalPolicy,
  firewall: FirewallProjectionPort | undefined,
  ingestClock: IngestClock,
): RollingTimeMachine {
  /** The current window as a firewall base view (frozen defensive copy). */
  const baseView = (): KnowledgeBaseView =>
    Object.freeze({ records: Object.freeze([...core.window]), size: core.window.length }) as KnowledgeBaseView;

  /** Route one projection through the firewall port — the ONLY record egress for consumers. */
  const project = (at: TimestampMs, selector: KnowledgeQueryFilter) => {
    if (firewall === undefined) {
      return fail<import('./firewall').FirewallQueryResult>(
        'firewall_required',
        'every as-of projection must pass through the knowledge firewall — construct the machine with a firewall projection port (the T026 contract)',
      );
    }
    const projected = firewall.project(baseView(), Object.freeze({ now: at }), tenant, selector);
    if (!projected.ok) {
      return fail<import('./firewall').FirewallQueryResult>(
        'firewall_rejected',
        `the firewall projection port rejected the passage: ${projected.error.code} — ${projected.error.message}`,
      );
    }
    return ok(projected.value);
  };

  /** Eviction pass: horizon floor (inclusive) then hard capacity bound. Returns notices. */
  const evict = (): EvictionNotice[] => {
    const notices: EvictionNotice[] = [];
    if (core.frontier !== null) {
      const rawFloor = core.frontier - horizonMs;
      const floor = rawFloor < 0 ? 0 : rawFloor;
      const retained: TimeMachineRecord[] = [];
      for (const record of core.window) {
        if (record.available_time < floor) {
          notices.push({ record_id: record.record_id, available_time: record.available_time, reason: 'horizon' });
          core.byId.delete(record.record_id);
        } else {
          retained.push(record);
        }
      }
      core.window = retained;
    }
    while (core.window.length > maxRecords) {
      // Deterministic victim: smallest (available_time, record_id).
      let victimIndex = 0;
      for (let index = 1; index < core.window.length; index++) {
        const current = core.window[index] as TimeMachineRecord;
        const victim = core.window[victimIndex] as TimeMachineRecord;
        if (current.available_time < victim.available_time || (current.available_time === victim.available_time && current.record_id < victim.record_id)) {
          victimIndex = index;
        }
      }
      const victim = core.window[victimIndex] as TimeMachineRecord;
      notices.push({ record_id: victim.record_id, available_time: victim.available_time, reason: 'capacity' });
      core.byId.delete(victim.record_id);
      core.window.splice(victimIndex, 1);
    }
    return notices;
  };

  const machine: RollingTimeMachine = {
    dataset,
    tenant,

    ingestBatch(events, batch) {
      if (!isRecord(batch) || typeof batch.batch_id !== 'string' || batch.batch_id.length === 0) {
        return fail('invalid_batch', 'the ingest batch must carry a non-empty batch_id');
      }
      if (!Array.isArray(events)) {
        return fail('invalid_event', 'ingestBatch requires an array of candidate canonical events');
      }
      if (events.length === 0) {
        return fail('empty_ingest', 'an ingest batch must contain at least one candidate event (mirror of T008 empty_commit)');
      }
      const batchId = batch.batch_id;
      const batchOrdinal = core.batchOrdinal + 1;
      core.batchOrdinal = batchOrdinal;

      const dispositions: IngestDisposition[] = [];
      const pendingRecords: TimeMachineRecord[] = [];
      const pendingById = new Map<string, TimeMachineRecord>();
      const quarantinedThisBatch: QuarantinedEvent[] = [];
      const rejectionsThisBatch: RejectionRecord[] = [];

      const reject = (candidate: unknown, code: TimeMachineErrorCode, message: string, errors: readonly ValidationFailure[]): void => {
        const eventId = eventIdOf(candidate);
        const disposition: IngestDisposition = deepFreeze({
          event_id: eventId,
          disposition: 'rejected',
          arrival_sequence: null,
          rejection_code: code,
          errors: Object.freeze([...errors]),
          late_by: null,
        });
        dispositions.push(disposition);
        rejectionsThisBatch.push(
          deepFreeze({
            event_id: eventId,
            batch_id: batchId,
            batch_ordinal: batchOrdinal,
            code,
            message,
            errors: Object.freeze([...errors]),
          }) as RejectionRecord,
        );
      };

      for (const candidate of events) {
        // 1. Envelope validation (collect-all; typed field errors).
        const validation = validateCanonicalEvent(candidate);
        if (!validation.ok) {
          reject(candidate, 'invalid_event', 'the candidate failed canonical envelope validation', validation.errors);
          continue;
        }
        const event = candidate as CanonicalEvent;

        // 2. Append-only identity: the window, the batch-so-far and history.
        if (core.byId.has(event.event_id) || core.admittedEver.has(event.event_id) || pendingById.has(event.event_id)) {
          reject(
            event,
            'duplicate_event_id',
            `event "${event.event_id}" was already admitted — record identity is append-only`,
            [],
          );
          continue;
        }

        // 3. T008 derived-availability reconciliation: an in-window (or
        //    in-batch) parent must not be available after the child.
        //    Dangling parents are external lineage — tolerated (T008 store
        //    discipline); evicted parents are external from then on.
        let derivedFailure: string | null = null;
        for (const parentId of event.provenance.derived_from) {
          const parent: TimeMachineRecord | undefined = core.byId.get(parentId) ?? pendingById.get(parentId);
          if (parent === undefined) continue;
          if (parent.available_time > event.available_time) {
            derivedFailure = `event "${event.event_id}" is available at ${event.available_time} before its in-window parent "${parentId}" at ${parent.available_time}`;
            break;
          }
        }
        if (derivedFailure !== null) {
          reject(
            event,
            'derived_before_inputs',
            derivedFailure,
            [
              {
                code: 'derived_before_inputs',
                path: 'available_time',
                message: derivedFailure,
              },
            ],
          );
          continue;
        }

        // 4. Late-arrival policy (declared; T008 reconciliation mirrored).
        //    LATE = strictly below the RUNNING frontier (within-batch
        //    reordering included — the frontier includes batch-so-far).
        if (core.frontier !== null && event.available_time < core.frontier) {
          if (lateArrival === 'quarantine') {
            const lateBy = core.frontier - event.available_time;
            const quarantined: QuarantinedEvent = deepFreeze({
              event: deepFreeze(event) as CanonicalEvent,
              reason: 'late_arrival',
              late_by: lateBy,
              frontier_at_quarantine: core.frontier,
              batch_id: batchId,
              batch_ordinal: batchOrdinal,
            });
            quarantinedThisBatch.push(quarantined);
            dispositions.push(
              deepFreeze({
                event_id: event.event_id,
                disposition: 'quarantined_late',
                arrival_sequence: null,
                rejection_code: null,
                errors: Object.freeze([]),
                late_by: lateBy,
              }) as IngestDisposition,
            );
            continue;
          }
          // 'recompute': fall through to admission — the as-of state
          // updates from the event's available_time onward because every
          // view is computed fresh from the window through the firewall.
        }

        // 5. Admission: pull the definitive ingestion stamp from the
        //    injected clock (L9; never a wall clock; never rewrites
        //    available_time).
        const stampResult = nextIngestStamp(ingestClock);
        if (!stampResult.ok) {
          reject(event, stampResult.error.code, stampResult.error.message, []);
          continue;
        }
        const arrival = core.ingestCount + pendingRecords.length;
        const admission = admitCanonicalEvent(event, tenant, {
          batch_ordinal: batchOrdinal,
          batch_id: batchId,
          ingestion_time: stampResult.value,
          arrival_sequence: arrival,
        });
        if (!admission.ok) {
          reject(event, admission.error.code, admission.error.message, []);
          continue;
        }
        pendingRecords.push(admission.value);
        pendingById.set(admission.value.record_id, admission.value);
        // The running frontier includes batch-so-far (within-batch lateness).
        if (core.frontier === null || admission.value.available_time > core.frontier) {
          core.frontier = admission.value.available_time;
        }
        dispositions.push(
          deepFreeze({
            event_id: event.event_id,
            disposition: 'admitted',
            arrival_sequence: arrival,
            rejection_code: null,
            errors: Object.freeze([]),
            late_by: null,
          }) as IngestDisposition,
        );
      }

      // Commit the batch: window append (arrival order), indices, counters.
      for (const record of pendingRecords) {
        core.window.push(record);
        core.byId.set(record.record_id, record);
        core.admittedEver.add(record.record_id);
      }
      core.ingestCount += pendingRecords.length;
      core.quarantine.push(...quarantinedThisBatch);
      core.rejections.push(...rejectionsThisBatch);

      // Eviction pass (declared; horizon floor inclusive, then capacity).
      const evicted = evict();

      const receipt: IngestReceipt = deepFreeze({
        batch_id: batchId,
        batch_ordinal: batchOrdinal,
        dispositions: Object.freeze(dispositions),
        admitted: pendingRecords.length,
        rejected: dispositions.length - pendingRecords.length - quarantinedThisBatch.length,
        quarantined: quarantinedThisBatch.length,
        evicted: Object.freeze(evicted),
        frontier: core.frontier,
        window: windowStatsOf(core.window),
      }) as IngestReceipt;
      return ok(receipt);
    },

    asOf(query) {
      if (!isRecord(query)) {
        return fail('invalid_query', 'an as-of query must be an object');
      }
      if (!isDatasetRef(query.dataset)) {
        return fail('invalid_query', 'the as-of query must carry a non-empty dataset reference');
      }
      if (query.dataset !== dataset) {
        return fail(
          'unknown_dataset',
          `the as-of query addresses dataset "${query.dataset}" but this machine serves "${dataset}"`,
        );
      }
      if (!isTimestampMs(query.at)) {
        return fail('invalid_query', 'the as-of query instant `at` must be a valid epoch-millisecond timestamp');
      }
      const selectorResult = validateProjectionSelector(query.selector ?? {});
      if (!selectorResult.ok) return selectorResult;
      const selector = effectiveSelector(selectorResult.value);

      const projection = project(query.at, selector);
      if (!projection.ok) return projection;

      const records = sortByAvailability([...projection.value.records]);
      const view: AsOfView = deepFreeze({
        dataset,
        at: query.at,
        selector,
        records: Object.freeze(records),
        audit: projection.value.audit,
        hash: computeViewHash({ dataset, at: query.at, selector, records }),
      }) as AsOfView;
      return ok(view);
    },

    openCursor(options) {
      const from = options?.from ?? 'start';
      if (from !== 'start' && from !== 'tip') {
        return fail('invalid_cursor', 'cursor origin must be "start" or "tip"');
      }
      const selectorResult = validateProjectionSelector(options?.selector ?? {});
      if (!selectorResult.ok) return selectorResult;
      const selector = effectiveSelector(selectorResult.value);

      const cursorOrdinal = core.cursorOrdinal + 1;
      core.cursorOrdinal = cursorOrdinal;
      const cursorId = cursorIdFor(cursorOrdinal);
      const position = from === 'tip' ? core.ingestCount : 0;
      const state: CursorState = {
        cursor_id: cursorId,
        position,
        last_drain_at: null,
        selector,
        drains: 0,
        delivered: 0,
      };
      core.cursors.set(cursorId, state);
      return ok(
        deepFreeze({
          cursor_id: cursorId,
          dataset,
          position: state.position,
          last_drain_at: null,
          selector,
          drains: 0,
          delivered: 0,
        }) as PointInTimeCursor,
      );
    },

    drainCursor(cursorId, at) {
      const state = core.cursors.get(cursorId);
      if (state === undefined) {
        return fail('unknown_cursor', `cursor "${cursorId}" does not resolve on this machine`);
      }
      if (!isTimestampMs(at)) {
        return fail('invalid_query', 'the drain instant `at` must be a valid epoch-millisecond timestamp');
      }

      // The firewall decides WHAT IS VISIBLE at `at`; the cursor decides
      // WHAT IS NEW: arrivals since the last scan boundary, plus records
      // that became visible since the last drain instant (late arrivals
      // included). Pure delta bookkeeping over the port's decision.
      const projection = project(at, state.selector);
      if (!projection.ok) return projection;

      const delta = projection.value.records.filter((record) => {
        if (record.arrival_sequence >= state.position) return true;
        return state.last_drain_at !== null && record.available_time > state.last_drain_at;
      });
      const records = sortByAvailability(delta);

      const newPosition = core.ingestCount; // the scan boundary (monotone)
      const advanced = newPosition > state.position;
      state.position = newPosition;
      state.last_drain_at = at;
      state.drains += 1;
      state.delivered += records.length;

      const drain: CursorDrain = deepFreeze({
        cursor_id: cursorId,
        at,
        records: Object.freeze(records),
        position: newPosition,
        advanced,
        audit: projection.value.audit,
      }) as CursorDrain;
      return ok(drain);
    },

    forkCursor(cursorId) {
      const state = core.cursors.get(cursorId);
      if (state === undefined) {
        return fail('unknown_cursor', `cursor "${cursorId}" does not resolve on this machine`);
      }
      const cursorOrdinal = core.cursorOrdinal + 1;
      core.cursorOrdinal = cursorOrdinal;
      const forkId = cursorIdFor(cursorOrdinal);
      const fork: CursorState = {
        cursor_id: forkId,
        position: state.position,
        last_drain_at: state.last_drain_at, // inherited: the delta anchors must match for stream-identical replay
        selector: state.selector,
        drains: 0,
        delivered: 0,
      };
      core.cursors.set(forkId, fork);
      return ok(
        deepFreeze({
          cursor_id: forkId,
          dataset,
          position: fork.position,
          last_drain_at: fork.last_drain_at,
          selector: fork.selector,
          drains: 0,
          delivered: 0,
        }) as PointInTimeCursor,
      );
    },

    getCursor(cursorId) {
      const state = core.cursors.get(cursorId);
      if (state === undefined) {
        return fail('unknown_cursor', `cursor "${cursorId}" does not resolve on this machine`);
      }
      return ok(
        deepFreeze({
          cursor_id: state.cursor_id,
          dataset,
          position: state.position,
          last_drain_at: state.last_drain_at,
          selector: state.selector,
          drains: state.drains,
          delivered: state.delivered,
        }) as PointInTimeCursor,
      );
    },

    cursors() {
      return Object.freeze(
        [...core.cursors.values()].map(
          (state) =>
            deepFreeze({
              cursor_id: state.cursor_id,
              dataset,
              position: state.position,
              last_drain_at: state.last_drain_at,
              selector: state.selector,
              drains: state.drains,
              delivered: state.delivered,
            }) as PointInTimeCursor,
        ),
      );
    },

    quarantine() {
      return Object.freeze([...core.quarantine]);
    },

    rejections() {
      return Object.freeze([...core.rejections]);
    },

    stats() {
      return deepFreeze({
        dataset,
        tenant,
        horizon_ms: horizonMs,
        max_records: maxRecords,
        late_arrival: lateArrival,
        window_size: core.window.length,
        admitted_total: core.ingestCount,
        quarantined_total: core.quarantine.length,
        rejected_total: core.rejections.length,
        batches_total: core.batchOrdinal,
        frontier: core.frontier,
        oldest_available: windowStatsOf(core.window).oldest_available,
        newest_available: windowStatsOf(core.window).newest_available,
        cursors: core.cursors.size,
        firewall_bound: firewall !== undefined,
      }) as MachineStats;
    },

    snapshot() {
      const clockDescriptor =
        ingestClock && typeof (ingestClock as Record<string, unknown>).state === 'function'
          ? ((ingestClock as unknown as { state(): import('./clock').DeterministicClockState }).state() satisfies import('./clock').DeterministicClockState)
          : { kind: 'injected' as const };
      const descriptor =
        clockDescriptor.kind === 'builtin-stepping'
          ? { kind: 'builtin-stepping' as const, base: clockDescriptor.base, step_ms: clockDescriptor.step_ms }
          : clockDescriptor;
      return sealSnapshot({
        kind: 'tradrl.time-machine.snapshot/v1',
        dataset,
        tenant,
        horizon_ms: horizonMs,
        max_records: maxRecords,
        late_arrival: lateArrival,
        ingest_clock: descriptor,
        window: Object.freeze([...core.window]),
        frontier: core.frontier,
        ingest_count: core.ingestCount,
        batch_ordinal: core.batchOrdinal,
        cursor_ordinal: core.cursorOrdinal,
        quarantine: Object.freeze([...core.quarantine]),
        rejections: Object.freeze([...core.rejections]),
        cursors: Object.freeze(
          [...core.cursors.values()].map(
            (state) =>
              Object.freeze({
                cursor_id: state.cursor_id,
                position: state.position,
                last_drain_at: state.last_drain_at,
                selector: state.selector,
              }) as CursorSnapshotEntry,
          ),
        ),
      });
    },
  };

  return machine;
}

// ---------------------------------------------------------------------------
// Construction and restore.
// ---------------------------------------------------------------------------

/**
 * Create a rolling time machine. Total guards over the configuration; the
 * default ingest clock is the built-in deterministic stepping clock
 * (base 0, step 1 — snapshot/restore transfers its state; L9).
 */
export function createRollingTimeMachine(config: unknown): TimeMachineResult<RollingTimeMachine> {
  if (!isTimeMachineConfig(config)) {
    return fail(
      'invalid_config',
      'the time-machine configuration is invalid (dataset, tenant, horizon, maxRecords >= 1, lateArrival policy, optional firewall port and ingest clock)',
    );
  }
  const horizonMs = durationToMillis(config.horizon);
  if (horizonMs === null || !Number.isSafeInteger(horizonMs) || horizonMs < 0) {
    return fail('invalid_config', 'the rolling horizon must resolve to a non-negative safe-integer millisecond span');
  }
  const clock =
    config.ingestClock ??
    (() => {
      const built = createDeterministicIngestClock(0, 1);
      if (built.ok) return built.value;
      throw new TypeError(`createRollingTimeMachine: ${built.error.message}`);
    })();

  const core: MachineCore = {
    window: [],
    byId: new Map<string, TimeMachineRecord>(),
    admittedEver: new Set<string>(),
    frontier: null,
    ingestCount: 0,
    batchOrdinal: 0,
    cursorOrdinal: 0,
    quarantine: [],
    rejections: [],
    cursors: new Map<string, CursorState>(),
  };
  return ok(
    buildMachine(
      core,
      config.dataset,
      config.tenant,
      horizonMs,
      config.maxRecords,
      config.lateArrival,
      config.firewall,
      clock,
    ),
  );
}

/** Dependencies supplied when restoring a snapshot taken with an injected clock. */
export interface RestoreDependencies {
  /** The re-supplied ingest clock — must be positioned as the original (operator contract, L9). */
  readonly ingestClock?: IngestClock;
}

/**
 * Restore a rolling time machine from a snapshot: full structural
 * validation, lineage-hash verification (tamper detection), invariant
 * re-checks, deterministic clock reconstruction. Restoring and feeding the
 * identical subsequent event sequence reproduces identical views, cursor
 * positions and hashes (proven by the behavioral suite).
 */
export function restoreTimeMachine(
  snapshot: unknown,
  deps?: RestoreDependencies,
): TimeMachineResult<RollingTimeMachine> {
  const validated = validateTimeMachineSnapshot(snapshot);
  if (!validated.ok) return validated;
  const { content, builtinClock } = validated.value;

  let clock: IngestClock;
  if (builtinClock !== null) {
    if (builtinClock.consumed !== content.ingest_count) {
      return fail('invalid_snapshot', 'the builtin clock consumption does not match ingest_count');
    }
    const rebuilt = createDeterministicIngestClock(builtinClock.base, builtinClock.step_ms, builtinClock.consumed);
    if (!rebuilt.ok) return fail('invalid_snapshot', rebuilt.error.message);
    clock = rebuilt.value;
  } else {
    if (deps === undefined || deps.ingestClock === undefined) {
      return fail(
        'clock_required',
        'the snapshot was taken with an injected ingest clock — re-supply it via the restore dependencies (L9: the runtime owns clocks)',
      );
    }
    clock = deps.ingestClock;
  }

  const core: MachineCore = {
    window: [...content.window],
    byId: new Map<string, TimeMachineRecord>(content.window.map((record) => [record.record_id, record])),
    admittedEver: new Set<string>(content.window.map((record) => record.record_id)),
    frontier: content.frontier,
    ingestCount: content.ingest_count,
    batchOrdinal: content.batch_ordinal,
    cursorOrdinal: content.cursor_ordinal,
    quarantine: [...(content.quarantine as readonly QuarantinedEvent[])],
    rejections: [...(content.rejections as readonly RejectionRecord[])],
    cursors: new Map<string, CursorState>(
      (content.cursors as readonly CursorSnapshotEntry[]).map((entry) => [
        entry.cursor_id,
        {
          cursor_id: entry.cursor_id as CursorId,
          position: entry.position,
          last_drain_at: entry.last_drain_at,
          selector: effectiveSelector(entry.selector),
          drains: 0,
          delivered: 0,
        },
      ]),
    ),
  };
  return ok(
    buildMachine(
      core,
      content.dataset,
      content.tenant,
      content.horizon_ms,
      content.max_records,
      content.late_arrival,
      undefined,
      clock,
    ),
  );
}

/** Re-export the snapshot-time helper used by restore (parity for tests). */
export { isTimeMachineRecord, isNonNegativeSafeInteger };
