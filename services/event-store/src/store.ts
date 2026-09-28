/**
 * @tradrl/event-store — the append-only event store (reference implementation).
 *
 * APPEND-ONLY CONTRACT (structural + documented): the store exposes NO API
 * that can mutate committed history — `commit` and `appendCorrections`
 * append, every other method is a pure read. Stored events and corrections
 * are deep-frozen; the commit log is the single source of truth and
 * `replayCommitLog` rebuilds identical state from it.
 *
 * L4 POINT-IN-TIME TRUTH: `event_time`/`source_time`/`available_time` are
 * preserved EXACTLY as received; `ingestion_time` is STAMPED at commit from
 * the configured commit clock — never earlier. Window queries filter on
 * `available_time` (inclusive boundaries), NEVER on `event_time`.
 *
 * DETERMINISM: commits are a pure fold over (events, batchMeta) sequences
 * and the configured clock — same input in the same order with the same
 * config yields identical state (snapshot deep-equal, provable). Commit ids
 * derive from the monotonic commit sequence (`cmt-00000001`, ...).
 *
 * L9 LINEAGE: every stored event keeps provenance (origin, adapter,
 * derived_from, transform) plus a stamped custody chain (adapter ->
 * ingestion batch -> store commit); the store answers lineage queries
 * (ancestors/roots/depth) and latest-correction status.
 *
 * L13/L14 PROVIDER NEUTRALITY: the store knows envelopes, quartets,
 * sequences and provenance — nothing vendor-specific.
 */

import {
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isRecord,
  type BatchId,
  type CommitId,
  type CorrectionId,
  type EventId,
  type InstrumentId,
  type VenueId,
} from './fields';
import type { StoreError } from './fields';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { EventType } from './taxonomy';
import { createStreamSequencer, sequenceKeyOf, type SequenceKey, type StreamSequencer } from './sequence';
import { validateCustodyChain, type CustodyChain, type CorrectionRef, type EventProvenanceRecord } from './provenance';
import { checkDerivedAvailability, validateStorableEvent, type StorableEvent, type StoredEvent } from './event';
import { validateStorableCorrection, type StorableCorrection, type StoredCorrection } from './correction';
import { deepFreezeJson } from './json';

// ---------------------------------------------------------------------------
// Batch metadata, receipts, rejections.
// ---------------------------------------------------------------------------

/** Metadata of the ingestion batch being committed. */
export interface BatchMeta {
  readonly batch_id: BatchId;
  /** Optional human-readable provenance of the batch (e.g. adapter descriptor). */
  readonly source?: string;
}

/** A successful commit receipt. */
export interface CommitReceipt {
  /** Deterministic commit id derived from the monotonic sequence. */
  readonly commit_id: CommitId;
  /** Monotonic commit ordinal (first commit = 1). */
  readonly commit_sequence: number;
  readonly batch_id: BatchId;
  /** Committed event ids, position-aligned with {@link CommitReceipt.ingestion_times}. */
  readonly committed_event_ids: readonly EventId[];
  /** Ingestion timestamps STAMPED at commit, position-aligned with the ids. */
  readonly ingestion_times: readonly TimestampMs[];
}

/** A successful correction-append receipt. */
export interface CorrectionCommitReceipt {
  readonly commit_id: CommitId;
  readonly commit_sequence: number;
  readonly batch_id: BatchId;
  readonly correction_ids: readonly CorrectionId[];
}

/** Machine-readable codes for commit rejections. */
export type StoreRejectionCode =
  /** The batch meta itself is malformed (empty batch id). */
  | 'invalid_batch_meta'
  /** A commit of zero events (or zero corrections). */
  | 'empty_commit'
  /** An event failed envelope validation (details carry the field errors). */
  | 'invalid_event'
  /** An event id was already committed, or is duplicated within the batch. */
  | 'duplicate_event_id'
  /** A per-stream sequence duplicate/regression. */
  | 'sequence_violation'
  /** The derived_from chain would be cyclic. */
  | 'lineage_cycle'
  /** A derived event is available before one of its in-store parents. */
  | 'derived_before_inputs'
  /** A correction failed validation. */
  | 'invalid_correction'
  /** A correction id was already appended, or is duplicated within the batch. */
  | 'duplicate_correction_id'
  /** A correction references an event that is not in the store. */
  | 'correction_target_not_found';

/** A single typed commit rejection, naming the offending record. */
export interface StoreCommitError {
  readonly code: StoreRejectionCode;
  /** The offending event/correction id when known. */
  readonly event_id: EventId | null;
  /** Position in the submitted batch (-1 when not positional). */
  readonly index: number;
  readonly message: string;
  /** Field-level errors (for invalid_event / derived_before_inputs). */
  readonly details: readonly StoreError[];
}

/** Outcome of an events commit: the receipt, or every typed rejection. */
export type CommitResult =
  | { readonly ok: true; readonly receipt: CommitReceipt }
  | { readonly ok: false; readonly rejection: { readonly errors: readonly StoreCommitError[] } };

/** Outcome of a corrections append. */
export type CorrectionCommitResult =
  | { readonly ok: true; readonly receipt: CorrectionCommitReceipt }
  | { readonly ok: false; readonly rejection: { readonly errors: readonly StoreCommitError[] } };

// ---------------------------------------------------------------------------
// Commit clock (deterministic by default).
// ---------------------------------------------------------------------------

/** Supplies ingestion timestamps, one per committed record, in commit order. */
export interface CommitClock {
  next(): TimestampMs;
}

/**
 * A deterministic commit clock: base, base+step, base+2*step, ...
 * Same config -> same stamps -> same store state (the determinism law).
 */
export function createDeterministicCommitClock(base: TimestampMs, stepMs = 1): CommitClock {
  let tick = 0;
  return {
    next(): TimestampMs {
      const stamp = base + tick * stepMs;
      tick += 1;
      if (!isTimestampMs(stamp)) {
        throw new RangeError(`deterministic commit clock produced an out-of-range timestamp: ${stamp}`);
      }
      return stamp;
    },
  };
}

/** Store configuration: the commit clock is the only source of nondeterminism, and it is injectable. */
export interface EventStoreConfig {
  readonly clock: CommitClock;
}

// ---------------------------------------------------------------------------
// Queries and snapshots.
// ---------------------------------------------------------------------------

/**
 * The point-in-time query filter. `from`/`to` bound `available_time`
 * INCLUSIVELY — the L4 information-boundary surface. `event_time` is never
 * a query key here.
 */
export interface EventQueryFilter {
  readonly venue?: VenueId;
  readonly instrument?: InstrumentId;
  readonly event_type?: EventType;
  /** Inclusive lower bound on available_time. */
  readonly from?: TimestampMs;
  /** Inclusive upper bound on available_time. */
  readonly to?: TimestampMs;
}

/** The lineage view of one stored event (the store's answer to a lineage query). */
export interface LineageView {
  readonly event_id: EventId;
  /** Transitive in-store ancestors, sorted. */
  readonly ancestors: readonly EventId[];
  /** Root ids (in-store parentless ancestors, external/dangling parent ids, and the event itself when primitive), sorted. */
  readonly roots: readonly EventId[];
  /** Longest derivation-edge path to a root (primitive = 0). */
  readonly depth: number;
  /** Parent ids referenced but not held in the store (external lineage), sorted. */
  readonly external_parents: readonly EventId[];
}

/** The latest correction status of one event (a VIEW over the append-only log). */
export interface CorrectionStatusView {
  readonly event_id: EventId;
  readonly status: 'uncorrected' | 'corrected';
  readonly count: number;
  readonly latest: StoredCorrection | null;
  /** Every amendment in append order, oldest first. */
  readonly history: readonly StoredCorrection[];
}

/** Deterministic whole-store state for deep-equality / determinism proofs. */
export interface StoreSnapshot {
  /** The next commit ordinal the store would assign (last + 1). */
  readonly next_commit_sequence: number;
  /** Every stored event in commit order. */
  readonly events: readonly StoredEvent[];
  /** Every stored correction in append order. */
  readonly corrections: readonly StoredCorrection[];
}

/** One entry of the commit log — the replayable source of truth. */
export interface CommitLogEntry {
  readonly kind: 'events' | 'corrections';
  readonly commit_id: CommitId;
  readonly commit_sequence: number;
  readonly batch_id: BatchId;
  /** Stored events (kind 'events' only), in commit order, with custody. */
  readonly events?: readonly StoredEvent[];
  /** Stored corrections (kind 'corrections' only), with custody. */
  readonly corrections?: readonly StoredCorrection[];
}

/** Replay outcome. */
export type ReplayResult =
  | { readonly ok: true; readonly store: EventStore }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: 'replay_log_malformed' | 'replay_inconsistent';
        readonly message: string;
      };
    };

/** Store statistics. */
export interface StoreStats {
  readonly events: number;
  readonly commits: number;
  readonly corrections: number;
  readonly streams: number;
}

/** The append-only event store. Pure reads + appends; no history-mutation surface. */
export interface EventStore {
  /** Atomically commit a batch of events. All-or-nothing: any rejection means nothing is appended. */
  commit(events: readonly StorableEvent[], batch: BatchMeta): CommitResult;
  /** Atomically append corrections. Targets must already be committed. */
  appendCorrections(corrections: readonly StorableCorrection[], batch: BatchMeta): CorrectionCommitResult;

  /** A stored event by id (null when unknown). Frozen. */
  getEvent(eventId: EventId): StoredEvent | null;
  /** The full provenance record of an event: stored provenance + materialized correction refs. */
  getProvenanceRecord(eventId: EventId): EventProvenanceRecord | null;
  /** All stored events in commit order (defensive copy, frozen). */
  events(): readonly StoredEvent[];
  /** All stored corrections in append order (defensive copy, frozen). */
  corrections(): readonly StoredCorrection[];

  /**
   * The point-in-time query: events filtered by venue/instrument/type and
   * an INCLUSIVE [from, to] window on `available_time`. Sorted by
   * (available_time, event_id) — deterministic.
   */
  query(filter: EventQueryFilter): readonly StoredEvent[];

  /** Lineage of an event: ancestors, roots, depth, external parents (null when the id is unknown). */
  lineageOf(eventId: EventId): LineageView | null;

  /** The latest correction status of an event (view over the correction log). */
  correctionStatus(eventId: EventId): CorrectionStatusView;

  /** The commit log — the replayable source of truth (defensive copy, frozen). */
  commitLog(): readonly CommitLogEntry[];
  /** Deterministic whole-store state (for determinism proofs). */
  snapshot(): StoreSnapshot;
  /** Store statistics. */
  stats(): StoreStats;
}

/** Derive the deterministic commit id from a commit sequence. */
export function commitIdFor(sequence: number): CommitId {
  return `cmt-${String(sequence).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// Internal state and core.
// ---------------------------------------------------------------------------

interface StoreState {
  readonly events: StoredEvent[];
  readonly byId: Map<EventId, StoredEvent>;
  readonly corrections: StoredCorrection[];
  readonly correctionById: Map<CorrectionId, StoredCorrection>;
  readonly correctionsByEvent: Map<EventId, StoredCorrection[]>;
  readonly sequencer: StreamSequencer;
  /** Streams that have at least one committed event (distinguishes "seen with sequence 0" from "unseen"). */
  readonly seenStreams: Set<SequenceKey>;
  /** id -> derived_from for every committed event (the lineage graph; a DAG by construction). */
  readonly lineageParents: Map<EventId, readonly string[]>;
  readonly log: CommitLogEntry[];
  nextCommitSequence: number;
  lastStamp: number;
}

/**
 * Walk the ancestry of `targetId` (via `parents`) and report whether the
 * target is reachable — i.e. the chain would be cyclic. Shared by commit
 * and restore.
 */
function findLineageCycle(
  targetId: string,
  parents: readonly string[],
  lookup: (id: string) => readonly string[] | undefined,
): string | null {
  const visited = new Set<string>();
  const stack: string[] = [...parents];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    if (current === targetId) return targetId;
    if (visited.has(current)) continue;
    visited.add(current);
    const currentParents = lookup(current);
    if (currentParents === undefined) continue;
    for (const parent of currentParents) stack.push(parent);
  }
  return null;
}

/**
 * Longest-path depth to a root over a parent graph (mirror of
 * @tradrl/provenance's `chainDepth` algorithm — law D-004 structural
 * mirror). External parents (no entry in `parentsOf`) are roots at depth 0.
 */
function longestDepth(id: string, parentsOf: (id: string) => readonly string[] | undefined): number {
  const reachable = new Set<string>([id]);
  const stack: string[] = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const parent of parentsOf(current) ?? []) {
      if (parentsOf(parent) !== undefined && !reachable.has(parent)) {
        reachable.add(parent);
        stack.push(parent);
      }
    }
  }
  const depth = new Map<string, number>();
  const pending = new Set<string>(reachable);
  let progress = true;
  while (pending.size > 0 && progress) {
    progress = false;
    for (const node of pending) {
      const parents = parentsOf(node) ?? [];
      let resolved = true;
      let maxParent = -1;
      for (const parent of parents) {
        if (parentsOf(parent) === undefined) {
          if (maxParent < 0) maxParent = 0;
          continue;
        }
        const parentDepth = depth.get(parent);
        if (parentDepth === undefined) {
          resolved = false;
          break;
        }
        if (parentDepth > maxParent) maxParent = parentDepth;
      }
      if (resolved) {
        depth.set(node, parents.length === 0 ? 0 : maxParent + 1);
        pending.delete(node);
        progress = true;
      }
    }
  }
  return depth.get(id) ?? 0;
}

interface StoreCore {
  commit(events: readonly StorableEvent[], batch: BatchMeta): CommitResult;
  appendCorrections(corrections: readonly StorableCorrection[], batch: BatchMeta): CorrectionCommitResult;
  getEvent(eventId: EventId): StoredEvent | null;
  getProvenanceRecord(eventId: EventId): EventProvenanceRecord | null;
  eventsList(): readonly StoredEvent[];
  correctionsList(): readonly StoredCorrection[];
  query(filter: EventQueryFilter): readonly StoredEvent[];
  lineageOf(eventId: EventId): LineageView | null;
  correctionStatus(eventId: EventId): CorrectionStatusView;
  commitLogList(): readonly CommitLogEntry[];
  snapshotOf(): StoreSnapshot;
  statsOf(): StoreStats;
  /** Replay: restore a stored-events commit entry verbatim. Null on success, else an inconsistency message. */
  restoreEvents(entry: CommitLogEntry): string | null;
  /** Replay: restore a stored-corrections commit entry verbatim. Null on success, else an inconsistency message. */
  restoreCorrections(entry: CommitLogEntry): string | null;
}

function createStoreCore(clock: CommitClock): StoreCore {
  const state: StoreState = {
    events: [],
    byId: new Map(),
    corrections: [],
    correctionById: new Map(),
    correctionsByEvent: new Map(),
    sequencer: createStreamSequencer(),
    seenStreams: new Set(),
    lineageParents: new Map(),
    log: [],
    nextCommitSequence: 1,
    lastStamp: Number.NaN,
  };

  /** Pull the next ingestion stamp, enforcing non-decreasing stamps. */
  const nextStamp = (): TimestampMs => {
    const stamp = clock.next();
    if (!isTimestampMs(stamp)) {
      throw new RangeError(`commit clock produced an invalid timestamp: ${stamp}`);
    }
    if (!Number.isNaN(state.lastStamp) && stamp < state.lastStamp) {
      throw new RangeError(`commit clock regression: ${stamp} precedes the previous stamp ${state.lastStamp}`);
    }
    state.lastStamp = stamp;
    return stamp;
  };

  /** Fold a stored event into the indexes (append-only). */
  const foldEvent = (stored: StoredEvent): void => {
    state.events.push(stored);
    state.byId.set(stored.event_id, stored);
    const key = sequenceKeyOf(stored);
    state.seenStreams.add(key);
    state.sequencer.observe(key, stored.sequence);
    state.lineageParents.set(stored.event_id, stored.provenance.derived_from);
  };

  /** Fold a stored correction into the indexes (append-only). */
  const foldCorrection = (stored: StoredCorrection): void => {
    state.corrections.push(stored);
    state.correctionById.set(stored.correction_id, stored);
    const list = state.correctionsByEvent.get(stored.corrected_event_id) ?? [];
    list.push(stored);
    state.correctionsByEvent.set(stored.corrected_event_id, list);
  };

  const commit = (events: readonly StorableEvent[], batch: BatchMeta): CommitResult => {
    if (!isRecord(batch) || !isNonEmptyString(batch.batch_id)) {
      return {
        ok: false,
        rejection: {
          errors: [
            {
              code: 'invalid_batch_meta',
              event_id: null,
              index: -1,
              message: 'batch metadata requires a non-empty batch_id string',
              details: [],
            },
          ],
        },
      };
    }
    const batchId = batch.batch_id;

    if (events.length === 0) {
      return {
        ok: false,
        rejection: {
          errors: [
            { code: 'empty_commit', event_id: null, index: -1, message: 'a commit requires at least one event', details: [] },
          ],
        },
      };
    }

    const errors: StoreCommitError[] = [];

    // 1. Envelope validation (collect-all per event). Only structurally
    //    valid events participate in the cross-record checks below — the
    //    store never throws on untrusted input.
    const valid: Array<{ event: StorableEvent; index: number }> = [];
    events.forEach((event, index) => {
      const validation = validateStorableEvent(event);
      if (validation.ok) {
        valid.push({ event, index });
      } else {
        errors.push({
          code: 'invalid_event',
          event_id: isRecord(event) && isNonEmptyString(event.event_id) ? event.event_id : null,
          index,
          message: `event at batch index ${index} failed envelope validation`,
          details: validation.errors,
        });
      }
    });

    // 2. Duplicate event ids: within the batch and against the store.
    const batchIds = new Map<EventId, number>();
    for (const { event, index } of valid) {
      const id = event.event_id;
      const seenAt = batchIds.get(id);
      if (seenAt !== undefined) {
        errors.push({
          code: 'duplicate_event_id',
          event_id: id,
          index,
          message: `event id "${id}" is duplicated within the batch (first at index ${seenAt})`,
          details: [],
        });
      } else {
        batchIds.set(id, index);
      }
      if (state.byId.has(id)) {
        errors.push({
          code: 'duplicate_event_id',
          event_id: id,
          index,
          message: `event id "${id}" is already committed`,
          details: [],
        });
      }
    }

    // 3. Sequence discipline: strictly increasing per stream against the
    //    store high-water AND the batch-internal high-water (batch order is
    //    arrival order). `seenStreams` distinguishes a stream seen at
    //    sequence 0 from an unseen stream.
    const batchHigh = new Map<SequenceKey, number>();
    const batchSeen = new Set<SequenceKey>();
    for (const { event, index } of valid) {
      const key = sequenceKeyOf(event);
      const storeHigh = state.sequencer.peek(key);
      const localHigh = batchHigh.get(key) ?? 0;
      const seen = state.seenStreams.has(key) || batchSeen.has(key);
      const effectiveHigh = Math.max(storeHigh, localHigh);
      if (seen && event.sequence <= effectiveHigh) {
        const kind = event.sequence === effectiveHigh ? 'duplicate_sequence' : 'regressed_sequence';
        errors.push({
          code: 'sequence_violation',
          event_id: event.event_id,
          index,
          message: `${kind} on stream "${key}": sequence ${event.sequence} ${kind === 'duplicate_sequence' ? 'duplicates' : 'regresses below'} the committed/arrival high-water ${effectiveHigh}`,
          details: [],
        });
      }
      batchSeen.add(key);
      if (event.sequence > localHigh) batchHigh.set(key, event.sequence);
    }

    // 4. Lineage: cycles over (store graph + batch graph). Self-reference
    //    and duplicate parents are rejected by envelope validation.
    const batchLineage = new Map<EventId, readonly string[]>();
    for (const { event } of valid) batchLineage.set(event.event_id, event.provenance.derived_from);
    const lookup = (id: string): readonly string[] | undefined =>
      batchLineage.get(id) ?? state.lineageParents.get(id);
    for (const { event, index } of valid) {
      if (event.provenance.derived_from.length === 0) continue;
      const cycleAt = findLineageCycle(event.event_id, event.provenance.derived_from, lookup);
      if (cycleAt !== null) {
        errors.push({
          code: 'lineage_cycle',
          event_id: event.event_id,
          index,
          message: `derived_from chain of "${event.event_id}" is cyclic — the event is reachable from its own parent chain (through "${cycleAt}")`,
          details: [],
        });
      }
    }

    // 5. Derived availability (mirror of @tradrl/time-engine's derived
    //    rule): a derived event may not be available before its latest
    //    in-store/batch parent.
    const batchAvailability = new Map<EventId, TimestampMs>();
    for (const { event } of valid) batchAvailability.set(event.event_id, event.available_time);
    for (const { event, index } of valid) {
      if (event.provenance.derived_from.length === 0) continue;
      const parentTimes: TimestampMs[] = [];
      for (const parentId of event.provenance.derived_from) {
        const parent = state.byId.get(parentId);
        if (parent !== undefined) {
          parentTimes.push(parent.available_time);
          continue;
        }
        const batchParentTime = batchAvailability.get(parentId);
        if (batchParentTime !== undefined) parentTimes.push(batchParentTime);
      }
      const violation = checkDerivedAvailability(event, parentTimes);
      if (violation !== null) {
        errors.push({
          code: 'derived_before_inputs',
          event_id: event.event_id,
          index,
          message: violation.message,
          details: [violation],
        });
      }
    }

    if (errors.length > 0) {
      return { ok: false, rejection: { errors } };
    }

    // --- ACCEPT: stamp custody + ingestion time, then append (atomic). ---
    const commitSequence = state.nextCommitSequence;
    const commitId = commitIdFor(commitSequence);
    const committed: StoredEvent[] = [];
    const committedIds: EventId[] = [];
    const ingestionTimes: TimestampMs[] = [];

    for (const { event } of valid) {
      const stamp = nextStamp();
      const stored: StoredEvent = deepFreezeJson({
        ...event,
        ingestion_time: stamp,
        provenance: {
          ...event.provenance,
          custody: {
            adapter: event.provenance.adapter,
            batch: { batch_id: batchId },
            commit: { commit_id: commitId, commit_sequence: commitSequence, ingestion_time: stamp },
          },
        },
      });
      committed.push(stored);
      committedIds.push(event.event_id);
      ingestionTimes.push(stamp);
    }

    for (const stored of committed) foldEvent(stored);

    state.log.push(
      deepFreezeJson({
        kind: 'events',
        commit_id: commitId,
        commit_sequence: commitSequence,
        batch_id: batchId,
        events: [...committed],
      }),
    );
    state.nextCommitSequence += 1;

    return {
      ok: true,
      receipt: deepFreezeJson({
        commit_id: commitId,
        commit_sequence: commitSequence,
        batch_id: batchId,
        committed_event_ids: Object.freeze(committedIds),
        ingestion_times: Object.freeze(ingestionTimes),
      }),
    };
  };

  const appendCorrections = (
    corrections: readonly StorableCorrection[],
    batch: BatchMeta,
  ): CorrectionCommitResult => {
    if (!isRecord(batch) || !isNonEmptyString(batch.batch_id)) {
      return {
        ok: false,
        rejection: {
          errors: [
            {
              code: 'invalid_batch_meta',
              event_id: null,
              index: -1,
              message: 'batch metadata requires a non-empty batch_id string',
              details: [],
            },
          ],
        },
      };
    }
    const batchId = batch.batch_id;

    if (corrections.length === 0) {
      return {
        ok: false,
        rejection: {
          errors: [
            {
              code: 'empty_commit',
              event_id: null,
              index: -1,
              message: 'a corrections append requires at least one correction',
              details: [],
            },
          ],
        },
      };
    }

    const errors: StoreCommitError[] = [];
    const valid: Array<{ correction: StorableCorrection; index: number }> = [];
    const batchIds = new Map<CorrectionId, number>();

    corrections.forEach((correction, index) => {
      const validation = validateStorableCorrection(correction);
      if (!validation.ok) {
        errors.push({
          code: 'invalid_correction',
          event_id: isRecord(correction) && isNonEmptyString(correction.correction_id) ? correction.correction_id : null,
          index,
          message: `correction at batch index ${index} failed validation`,
          details: validation.errors,
        });
        return;
      }
      valid.push({ correction, index });
      const id = correction.correction_id;
      const seenAt = batchIds.get(id);
      if (seenAt !== undefined) {
        errors.push({
          code: 'duplicate_correction_id',
          event_id: id,
          index,
          message: `correction id "${id}" is duplicated within the batch (first at index ${seenAt})`,
          details: [],
        });
      } else {
        batchIds.set(id, index);
      }
      if (state.correctionById.has(id)) {
        errors.push({
          code: 'duplicate_correction_id',
          event_id: id,
          index,
          message: `correction id "${id}" is already appended`,
          details: [],
        });
      }
      if (!state.byId.has(correction.corrected_event_id)) {
        errors.push({
          code: 'correction_target_not_found',
          event_id: correction.corrected_event_id,
          index,
          message: `correction "${id}" targets event "${correction.corrected_event_id}" which is not in the store`,
          details: [],
        });
      }
    });

    if (errors.length > 0) {
      return { ok: false, rejection: { errors } };
    }

    // --- ACCEPT: stamp custody, append (atomic). Corrections enter through
    // the data plane, not a provider adapter — custody attributes them to
    // the batch and the commit.
    const commitSequence = state.nextCommitSequence;
    const commitId = commitIdFor(commitSequence);
    const storedCorrections: StoredCorrection[] = [];
    const correctionIds: CorrectionId[] = [];

    for (const { correction } of valid) {
      const stamp = nextStamp();
      const stored: StoredCorrection = deepFreezeJson({
        ...correction,
        custody: {
          adapter: null,
          batch: { batch_id: batchId },
          commit: { commit_id: commitId, commit_sequence: commitSequence, ingestion_time: stamp },
        },
      });
      storedCorrections.push(stored);
      correctionIds.push(correction.correction_id);
    }

    for (const stored of storedCorrections) foldCorrection(stored);

    state.log.push(
      deepFreezeJson({
        kind: 'corrections',
        commit_id: commitId,
        commit_sequence: commitSequence,
        batch_id: batchId,
        corrections: [...storedCorrections],
      }),
    );
    state.nextCommitSequence += 1;

    return {
      ok: true,
      receipt: deepFreezeJson({
        commit_id: commitId,
        commit_sequence: commitSequence,
        batch_id: batchId,
        correction_ids: Object.freeze(correctionIds),
      }),
    };
  };

  // --- Pure reads -----------------------------------------------------------

  const getEvent = (eventId: EventId): StoredEvent | null => state.byId.get(eventId) ?? null;

  const getProvenanceRecord = (eventId: EventId): EventProvenanceRecord | null => {
    const event = state.byId.get(eventId);
    if (event === undefined) return null;
    const correctionRefs: CorrectionRef[] = (state.correctionsByEvent.get(eventId) ?? []).map((correction) => ({
      correction_id: correction.correction_id,
      reason: correction.reason,
    }));
    return deepFreezeJson({ ...event.provenance, corrections: Object.freeze(correctionRefs) });
  };

  const query = (filter: EventQueryFilter): readonly StoredEvent[] => {
    const matched = state.events.filter((event) => {
      if (filter.venue !== undefined && event.venue !== filter.venue) return false;
      if (filter.instrument !== undefined && event.instrument !== filter.instrument) return false;
      if (filter.event_type !== undefined && event.event_type !== filter.event_type) return false;
      if (filter.from !== undefined && event.available_time < filter.from) return false;
      if (filter.to !== undefined && event.available_time > filter.to) return false;
      return true;
    });
    matched.sort((a, b) => {
      if (a.available_time !== b.available_time) return a.available_time - b.available_time;
      return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
    });
    return Object.freeze(matched);
  };

  const lineageOf = (eventId: EventId): LineageView | null => {
    if (!state.byId.has(eventId)) return null;
    const ancestors = new Set<EventId>();
    const external = new Set<EventId>();
    const visited = new Set<string>();
    const stack: string[] = [...(state.lineageParents.get(eventId) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      if (state.byId.has(current)) {
        ancestors.add(current);
        for (const parent of state.lineageParents.get(current) ?? []) stack.push(parent);
      } else {
        external.add(current);
      }
    }
    const roots = new Set<EventId>();
    for (const ancestor of ancestors) {
      if ((state.lineageParents.get(ancestor) ?? []).length === 0) roots.add(ancestor);
    }
    for (const dangling of external) roots.add(dangling);
    if ((state.lineageParents.get(eventId) ?? []).length === 0) roots.add(eventId);

    const depth = longestDepth(eventId, (id) => state.lineageParents.get(id));

    return {
      event_id: eventId,
      ancestors: Object.freeze([...ancestors].sort()),
      roots: Object.freeze([...roots].sort()),
      depth,
      external_parents: Object.freeze([...external].sort()),
    };
  };

  const correctionStatus = (eventId: EventId): CorrectionStatusView => {
    const history = state.correctionsByEvent.get(eventId) ?? [];
    if (history.length === 0) {
      return { event_id: eventId, status: 'uncorrected', count: 0, latest: null, history: [] };
    }
    return {
      event_id: eventId,
      status: 'corrected',
      count: history.length,
      latest: history[history.length - 1] ?? null,
      history: Object.freeze([...history]),
    };
  };

  const snapshotOf = (): StoreSnapshot =>
    deepFreezeJson({
      next_commit_sequence: state.nextCommitSequence,
      events: [...state.events],
      corrections: [...state.corrections],
    });

  const statsOf = (): StoreStats => ({
    events: state.events.length,
    commits: state.log.length,
    corrections: state.corrections.length,
    streams: state.seenStreams.size,
  });

  // --- Replay restore paths ---------------------------------------------------

  const restoreEvents = (entry: CommitLogEntry): string | null => {
    if (entry.commit_sequence !== state.nextCommitSequence) {
      return `log entry commit_sequence ${entry.commit_sequence} does not match the fold position ${state.nextCommitSequence}`;
    }
    if (entry.commit_id !== commitIdFor(entry.commit_sequence)) {
      return `log entry commit_id "${entry.commit_id}" does not match its sequence ${entry.commit_sequence}`;
    }
    if (!isNonEmptyString(entry.batch_id)) {
      return `log entry ${entry.commit_sequence}: batch_id must be a non-empty string`;
    }
    if (!Array.isArray(entry.events) || entry.events.length === 0) {
      return `log entry ${entry.commit_sequence} (events): carries no events`;
    }

    const events = entry.events as readonly unknown[];
    const validated: StoredEvent[] = [];
    let prevStamp = state.lastStamp;

    const entryLineage = new Map<EventId, readonly string[]>();
    const entryAvailability = new Map<EventId, TimestampMs>();

    for (let i = 0; i < events.length; i++) {
      const candidate = events[i];
      const validation = validateStorableEvent(candidate);
      if (!validation.ok) {
        return `log entry ${entry.commit_sequence}: event at position ${i} failed envelope validation: ${validation.errors
          .map((error) => error.message)
          .join('; ')}`;
      }
      const event = candidate as StoredEvent;
      const provenance = event.provenance;
      if (!isRecord(provenance) || !isRecord(provenance.custody)) {
        return `log entry ${entry.commit_sequence}: event "${event.event_id}" lacks a custody chain`;
      }
      const custody = provenance.custody as unknown as CustodyChain;
      const custodyErrors = validateCustodyChain(custody);
      if (custodyErrors.length > 0) {
        return `log entry ${entry.commit_sequence}: event "${event.event_id}" has invalid custody: ${custodyErrors
          .map((error) => error.message)
          .join('; ')}`;
      }
      if (custody.commit.commit_id !== entry.commit_id || custody.commit.commit_sequence !== entry.commit_sequence) {
        return `log entry ${entry.commit_sequence}: event "${event.event_id}" custody does not reference this commit`;
      }
      if (custody.batch.batch_id !== entry.batch_id) {
        return `log entry ${entry.commit_sequence}: event "${event.event_id}" custody batch "${custody.batch.batch_id}" does not match the entry batch "${entry.batch_id}"`;
      }
      if (event.ingestion_time !== custody.commit.ingestion_time) {
        return `log entry ${entry.commit_sequence}: event "${event.event_id}" ingestion_time (${event.ingestion_time}) does not match its custody stamp (${custody.commit.ingestion_time})`;
      }
      if (!Number.isNaN(prevStamp) && event.ingestion_time < prevStamp) {
        return `log entry ${entry.commit_sequence}: event "${event.event_id}" ingestion stamp regresses (${event.ingestion_time} < ${prevStamp})`;
      }
      prevStamp = event.ingestion_time;

      if (state.byId.has(event.event_id)) {
        return `log entry ${entry.commit_sequence}: duplicate event id "${event.event_id}"`;
      }
      // Sequence: strictly increasing per stream over the restored history.
      const key = sequenceKeyOf(event);
      if (state.seenStreams.has(key) && event.sequence <= state.sequencer.peek(key)) {
        return `log entry ${entry.commit_sequence}: event "${event.event_id}" sequence ${event.sequence} is not strictly increasing for stream "${key}"`;
      }
      const duplicateInEntry = validated.some(
        (other) => other.event_id === event.event_id,
      );
      if (duplicateInEntry) {
        return `log entry ${entry.commit_sequence}: duplicate event id "${event.event_id}" within the entry`;
      }
      validated.push(event);
      entryLineage.set(event.event_id, event.provenance.derived_from);
      entryAvailability.set(event.event_id, event.available_time);
    }

    // Defensive re-validation of the lineage and derived-availability
    // invariants over the candidate state (a tampered log is rejected).
    const lookup = (id: string): readonly string[] | undefined =>
      entryLineage.get(id) ?? state.lineageParents.get(id);
    for (const event of validated) {
      if (event.provenance.derived_from.length === 0) continue;
      const cycleAt = findLineageCycle(event.event_id, event.provenance.derived_from, lookup);
      if (cycleAt !== null) {
        return `log entry ${entry.commit_sequence}: derived_from chain of "${event.event_id}" is cyclic`;
      }
      const parentTimes: TimestampMs[] = [];
      for (const parentId of event.provenance.derived_from) {
        const parent = state.byId.get(parentId);
        if (parent !== undefined) {
          parentTimes.push(parent.available_time);
          continue;
        }
        const entryParentTime = entryAvailability.get(parentId);
        if (entryParentTime !== undefined) parentTimes.push(entryParentTime);
      }
      const violation = checkDerivedAvailability(event, parentTimes);
      if (violation !== null) {
        return `log entry ${entry.commit_sequence}: ${violation.message}`;
      }
    }

    // Restore verbatim: freeze, fold, log.
    const restored = validated.map((event) => deepFreezeJson({ ...event }) as StoredEvent);
    for (const stored of restored) foldEvent(stored);
    state.lastStamp = prevStamp;
    state.log.push(
      deepFreezeJson({
        kind: 'events',
        commit_id: entry.commit_id,
        commit_sequence: entry.commit_sequence,
        batch_id: entry.batch_id,
        events: [...restored],
      }),
    );
    state.nextCommitSequence += 1;
    return null;
  };

  const restoreCorrections = (entry: CommitLogEntry): string | null => {
    if (entry.commit_sequence !== state.nextCommitSequence) {
      return `log entry commit_sequence ${entry.commit_sequence} does not match the fold position ${state.nextCommitSequence}`;
    }
    if (entry.commit_id !== commitIdFor(entry.commit_sequence)) {
      return `log entry commit_id "${entry.commit_id}" does not match its sequence ${entry.commit_sequence}`;
    }
    if (!isNonEmptyString(entry.batch_id)) {
      return `log entry ${entry.commit_sequence}: batch_id must be a non-empty string`;
    }
    if (!Array.isArray(entry.corrections) || entry.corrections.length === 0) {
      return `log entry ${entry.commit_sequence} (corrections): carries no corrections`;
    }

    const corrections = entry.corrections as readonly unknown[];
    const validated: StoredCorrection[] = [];
    let prevStamp = state.lastStamp;

    for (let i = 0; i < corrections.length; i++) {
      const candidate = corrections[i];
      const validation = validateStorableCorrection(candidate);
      if (!validation.ok) {
        return `log entry ${entry.commit_sequence}: correction at position ${i} failed validation: ${validation.errors
          .map((error) => error.message)
          .join('; ')}`;
      }
      const correction = candidate as StoredCorrection;
      const record = correction as unknown as Record<string, unknown>;
      if (!isRecord(record.custody)) {
        return `log entry ${entry.commit_sequence}: correction "${correction.correction_id}" lacks a custody chain`;
      }
      const custody = record.custody as unknown as CustodyChain;
      const custodyErrors = validateCustodyChain(custody);
      if (custodyErrors.length > 0) {
        return `log entry ${entry.commit_sequence}: correction "${correction.correction_id}" has invalid custody: ${custodyErrors
          .map((error) => error.message)
          .join('; ')}`;
      }
      if (custody.commit.commit_id !== entry.commit_id || custody.commit.commit_sequence !== entry.commit_sequence) {
        return `log entry ${entry.commit_sequence}: correction "${correction.correction_id}" custody does not reference this commit`;
      }
      if (custody.batch.batch_id !== entry.batch_id) {
        return `log entry ${entry.commit_sequence}: correction "${correction.correction_id}" custody batch does not match the entry batch`;
      }
      if (!Number.isNaN(prevStamp) && custody.commit.ingestion_time < prevStamp) {
        return `log entry ${entry.commit_sequence}: correction "${correction.correction_id}" ingestion stamp regresses`;
      }
      prevStamp = custody.commit.ingestion_time;

      if (state.correctionById.has(correction.correction_id)) {
        return `log entry ${entry.commit_sequence}: duplicate correction id "${correction.correction_id}"`;
      }
      if (validated.some((other) => other.correction_id === correction.correction_id)) {
        return `log entry ${entry.commit_sequence}: duplicate correction id "${correction.correction_id}" within the entry`;
      }
      if (!state.byId.has(correction.corrected_event_id)) {
        return `log entry ${entry.commit_sequence}: correction "${correction.correction_id}" targets unknown event "${correction.corrected_event_id}"`;
      }
      validated.push(correction);
    }

    const restored = validated.map((correction) => deepFreezeJson({ ...correction }) as StoredCorrection);
    for (const stored of restored) foldCorrection(stored);
    state.lastStamp = prevStamp;
    state.log.push(
      deepFreezeJson({
        kind: 'corrections',
        commit_id: entry.commit_id,
        commit_sequence: entry.commit_sequence,
        batch_id: entry.batch_id,
        corrections: [...restored],
      }),
    );
    state.nextCommitSequence += 1;
    return null;
  };

  return {
    commit,
    appendCorrections,
    getEvent,
    getProvenanceRecord,
    eventsList: () => Object.freeze([...state.events]),
    correctionsList: () => Object.freeze([...state.corrections]),
    query,
    lineageOf,
    correctionStatus,
    commitLogList: () => Object.freeze([...state.log]),
    snapshotOf,
    statsOf,
    restoreEvents,
    restoreCorrections,
  };
}

// ---------------------------------------------------------------------------
// Factories.
// ---------------------------------------------------------------------------

/** Create an empty append-only event store. Default clock: deterministic (base 0, step 1). */
export function createEventStore(config?: Partial<EventStoreConfig>): EventStore {
  const clock: CommitClock = config?.clock ?? createDeterministicCommitClock(0, 1);
  const core = createStoreCore(clock);
  return {
    commit: core.commit,
    appendCorrections: core.appendCorrections,
    getEvent: core.getEvent,
    getProvenanceRecord: core.getProvenanceRecord,
    events: core.eventsList,
    corrections: core.correctionsList,
    query: core.query,
    lineageOf: core.lineageOf,
    correctionStatus: core.correctionStatus,
    commitLog: core.commitLogList,
    snapshot: core.snapshotOf,
    stats: core.statsOf,
  };
}

/**
 * Rebuild a store from a commit log. The rebuilt state is IDENTICAL to the
 * store that produced the log (determinism law): events and corrections
 * are restored VERBATIM — ingestion timestamps and custody come from the
 * log, never re-stamped. The log is validated while it folds: malformed
 * entries, ordering inconsistencies, duplicate ids, sequence regressions,
 * lineage cycles and derived-availability violations in a tampered log are
 * rejected with typed errors.
 *
 * The rebuilt store's clock (from `config`) serves FUTURE commits and must
 * continue past the restored ingestion stamps (monotonicity is enforced).
 */
export function replayCommitLog(log: readonly CommitLogEntry[], config?: Partial<EventStoreConfig>): ReplayResult {
  const clock: CommitClock = config?.clock ?? createDeterministicCommitClock(0, 1);
  const core = createStoreCore(clock);

  if (!Array.isArray(log)) {
    return { ok: false, error: { code: 'replay_log_malformed', message: 'commit log must be an array of entries' } };
  }

  for (let index = 0; index < log.length; index++) {
    const entry = log[index];
    if (!isRecord(entry)) {
      return { ok: false, error: { code: 'replay_log_malformed', message: `log entry ${index} is not an object` } };
    }
    if (entry.kind !== 'events' && entry.kind !== 'corrections') {
      return {
        ok: false,
        error: { code: 'replay_log_malformed', message: `log entry ${index} has unknown kind "${String(entry.kind)}"` },
      };
    }
    if (!isNonEmptyString(entry.commit_id) || !isNonNegativeSafeInteger(entry.commit_sequence)) {
      return {
        ok: false,
        error: { code: 'replay_log_malformed', message: `log entry ${index} is malformed (commit_id/commit_sequence)` },
      };
    }
    const typedEntry = entry as unknown as CommitLogEntry;
    const outcome =
      typedEntry.kind === 'events' ? core.restoreEvents(typedEntry) : core.restoreCorrections(typedEntry);
    if (outcome !== null) {
      return { ok: false, error: { code: 'replay_inconsistent', message: outcome } };
    }
  }

  return {
    ok: true,
    store: {
      commit: core.commit,
      appendCorrections: core.appendCorrections,
      getEvent: core.getEvent,
      getProvenanceRecord: core.getProvenanceRecord,
      events: core.eventsList,
      corrections: core.correctionsList,
      query: core.query,
      lineageOf: core.lineageOf,
      correctionStatus: core.correctionStatus,
      commitLog: core.commitLogList,
      snapshot: core.snapshotOf,
      stats: core.statsOf,
    },
  };
}
