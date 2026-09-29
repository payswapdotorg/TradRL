/**
 * @tradrl/shadow_trading — the TIME-MACHINE PORT: the structural
 * mirror of T029's public cursor/as-of surface that the shadow session
 * consumes as an INJECTED dependency.
 *
 * THE IMPORT LAW: the rolling Time Machine is READ-ONLY to this lane
 * and arrives ONLY through this port; `interop.test.ts` drives the
 * REAL `createRollingTimeMachine` through it (the drift trip wire).
 *
 * THE CONSUMPTION CONTRACT (services/time-machine/README.md, "How T030
 * (shadow trading) consumes the machine" — implemented verbatim):
 *
 *   1. ONE cursor per shadow consumer against its dataset:
 *      `openCursor({ from: 'tip' })` when the shadow trader goes live
 *      (only new arrivals from the live edge), or `from: 'start'` to
 *      replay the retained window first.
 *   2. On every simulation tick (the shadow clock's `now` advances):
 *      `drainCursor(cursorId, now)` -> the records that BECAME newly
 *      visible — arrivals since the last drain PLUS records that
 *      crossed the inclusive boundary since the last drain instant
 *      (late arrivals included, in `(available_time, record_id)`
 *      order). This IS the shadow trader's point-in-time information
 *      set delta — fed to the session exactly as live data would
 *      arrive; the L4 law guarantees zero future leakage.
 *   3. The drain's `audit` (firewall decision log) is the per-tick
 *      evidence for the shadow audit trail; `position` is the
 *      resumable offset — persist the cursor (or the whole machine
 *      snapshot) to resume after a restart, and `forkCursor` re-runs
 *      the same delta stream for a second shadow book without
 *      re-winding the first.
 *   4. For state initialization (book warm-up): `asOf({ dataset, at:
 *      now })` gives the full point-in-time state; a selector narrows
 *      to the instruments the shadow strategy tracks.
 *
 * THE DEFENSE-IN-DEPTH L4 GATE: {@link admitDrainedRecords} re-proves
 * the inclusive boundary (`available_time <= at`) over every drained
 * record — the machine's firewall is the authority, this gate is the
 * shadow lane's independent second layer (a leak fails the typed
 * `l4_boundary_violation`, never a silent filter).
 */

import { isNonEmptyString, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import { type ShadowResult, fail, ok } from './errors';

// ---------------------------------------------------------------------------
// The port result shape (the structural seam the REAL machine satisfies)
// ---------------------------------------------------------------------------

/**
 * The time-machine port's result shape — T029's `TimeMachineResult`
 * law-for-law (the REAL machine satisfies this structurally; failures
 * carry the machine's single typed error, lifted by the session as
 * `machine_error`).
 */
export type MachinePortResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

// ---------------------------------------------------------------------------
// The record + audit mirrors (T029's shapes, mirrored)
// ---------------------------------------------------------------------------

/** One machine record (the knowledge-firewall record + the arrival axis — mirrored; computation/provenance stay OPAQUE). */
export interface MachineRecordMirror {
  readonly record_id: string;
  readonly tenant: string;
  readonly payload: unknown;
  readonly event_time: TimestampMs;
  readonly source_time: TimestampMs | null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
  readonly inputs: readonly string[];
  /** The computation policy — opaque to this lane (never interpreted). */
  readonly computation: unknown;
  /** The stored provenance — opaque to this lane (carried, never interpreted). */
  readonly provenance: unknown;
  readonly arrival_sequence: number;
}

/** Guard: a machine record (the availability quartet carried; the payload opaque). */
export function isMachineRecordMirror(v: unknown): v is MachineRecordMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.record_id) || !isNonEmptyString(v.tenant)) return false;
  if (!isTimestampMs(v.event_time) || !isTimestampMs(v.available_time) || !isTimestampMs(v.ingestion_time)) return false;
  if (v.source_time !== null && !isTimestampMs(v.source_time)) return false;
  if (!Array.isArray(v.inputs) || !v.inputs.every((x) => isNonEmptyString(x))) return false;
  if (typeof v.arrival_sequence !== 'number' || !Number.isSafeInteger(v.arrival_sequence) || v.arrival_sequence < 0) return false;
  return true;
}

/** One firewall decision from a drain's audit log. */
export interface FirewallDecisionMirror {
  readonly record_id: string;
  readonly decision: 'included' | 'excluded';
  readonly reason: string;
  readonly available_time: TimestampMs | null;
  readonly now: TimestampMs;
}

/** The drain's firewall audit log (the per-tick delegation evidence — mirrored). */
export interface FirewallAuditMirror {
  readonly tenant: string;
  readonly at: TimestampMs;
  readonly scanned: number;
  readonly decisions: readonly FirewallDecisionMirror[];
}

/** Guard: a firewall audit log. */
export function isFirewallAuditMirror(v: unknown): v is FirewallAuditMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.tenant)) return false;
  if (!isTimestampMs(v.at)) return false;
  if (typeof v.scanned !== 'number' || !Number.isSafeInteger(v.scanned) || v.scanned < 0) return false;
  if (!Array.isArray(v.decisions)) return false;
  for (const decision of v.decisions) {
    if (!isRecord(decision)) return false;
    if (!isNonEmptyString(decision.record_id) || typeof decision.reason !== 'string') return false;
    if (decision.decision !== 'included' && decision.decision !== 'excluded') return false;
    if (decision.available_time !== null && !isTimestampMs(decision.available_time)) return false;
    if (!isTimestampMs(decision.now)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The cursor + drain + as-of view mirrors
// ---------------------------------------------------------------------------

/** The resumable consumer position (mirrored). */
export interface MachineCursorMirror {
  readonly cursor_id: string;
  readonly dataset: string;
  readonly position: number;
  readonly last_drain_at: TimestampMs | null;
  readonly drains: number;
  readonly delivered: number;
}

/** Guard: a cursor. */
export function isMachineCursorMirror(v: unknown): v is MachineCursorMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.cursor_id) || !isNonEmptyString(v.dataset)) return false;
  if (typeof v.position !== 'number' || !Number.isSafeInteger(v.position) || v.position < 0) return false;
  if (v.last_drain_at !== null && !isTimestampMs(v.last_drain_at)) return false;
  if (typeof v.drains !== 'number' || !Number.isSafeInteger(v.drains) || v.drains < 0) return false;
  if (typeof v.delivered !== 'number' || !Number.isSafeInteger(v.delivered) || v.delivered < 0) return false;
  return true;
}

/** The outcome of one cursor drain (mirrored). */
export interface MachineDrainMirror {
  readonly cursor_id: string;
  readonly at: TimestampMs;
  /** The newly delivered records, (available_time, record_id) ascending. */
  readonly records: readonly MachineRecordMirror[];
  readonly position: number;
  readonly advanced: boolean;
  /** The firewall decision log for this drain — the delegation evidence (feeds the shadow audit trail). */
  readonly audit: FirewallAuditMirror;
}

/** Guard: a drain. */
export function isMachineDrainMirror(v: unknown): v is MachineDrainMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.cursor_id)) return false;
  if (!isTimestampMs(v.at)) return false;
  if (!Array.isArray(v.records) || !v.records.every((x) => isMachineRecordMirror(x))) return false;
  if (typeof v.position !== 'number' || !Number.isSafeInteger(v.position) || v.position < 0) return false;
  if (typeof v.advanced !== 'boolean') return false;
  if (!isFirewallAuditMirror(v.audit)) return false;
  return true;
}

/** The point-in-time view (mirrored). */
export interface MachineAsOfViewMirror {
  readonly dataset: string;
  readonly at: TimestampMs;
  /** Firewall-passed records, (available_time, record_id) ascending. */
  readonly records: readonly MachineRecordMirror[];
  readonly audit: FirewallAuditMirror;
  readonly hash: string;
}

/** Guard: an as-of view. */
export function isMachineAsOfViewMirror(v: unknown): v is MachineAsOfViewMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.dataset)) return false;
  if (!isTimestampMs(v.at)) return false;
  if (!Array.isArray(v.records) || !v.records.every((x) => isMachineRecordMirror(x))) return false;
  if (!isFirewallAuditMirror(v.audit)) return false;
  if (!isNonEmptyString(v.hash)) return false;
  return true;
}

/** The cursor-opening options (mirrored: `from: 'start'` replays, `'tip'` goes live; the selector stays the machine's own concern). */
export interface MachineCursorOptions {
  readonly from?: 'start' | 'tip';
}

// ---------------------------------------------------------------------------
// The L4 defense-in-depth gate
// ---------------------------------------------------------------------------

/**
 * Re-prove the inclusive L4 boundary over drained records: every
 * record's `available_time <= at` (INCLUSIVE — a record available
 * exactly AT the drain instant IS delivered; one millisecond later is
 * NOT). A leak fails the typed `l4_boundary_violation`.
 */
export function admitDrainedRecords(drain: MachineDrainMirror): ShadowResult<readonly MachineRecordMirror[]> {
  for (const record of drain.records) {
    if ((record.available_time as number) > (drain.at as number)) {
      return fail(
        'l4_boundary_violation',
        `drained record ${record.record_id} carries available_time ${String(record.available_time)}, after the drain instant ${String(drain.at)} — the inclusive boundary (available_time <= at) is the law (L4)`,
      );
    }
  }
  return ok(drain.records);
}

// ---------------------------------------------------------------------------
// The injected port (the structural seam)
// ---------------------------------------------------------------------------

/**
 * The time-machine port: the structural mirror of T029's
 * `RollingTimeMachine` cursor/as-of surface. The REAL machine
 * satisfies this port field-for-field (interop-proven).
 */
export interface TimeMachinePort {
  readonly dataset: string;
  readonly tenant: string;

  /** Open a consumer cursor (`start` replays the retained window; `tip` starts at the live edge). */
  openCursor(options?: MachineCursorOptions): MachinePortResult<MachineCursorMirror>;
  /** Drain a cursor at instant T: everything newly visible to the consumer (firewall-passed). */
  drainCursor(cursorId: string, at: TimestampMs): MachinePortResult<MachineDrainMirror>;
  /** Fork a cursor: a new consumer at the identical delta anchors (no rewinding). */
  forkCursor(cursorId: string): MachinePortResult<MachineCursorMirror>;
  /** One cursor's live position. */
  getCursor(cursorId: string): MachinePortResult<MachineCursorMirror>;
  /** The point-in-time query (book warm-up; the dataset + the instant — the firewall's selector stays the machine's own concern). */
  asOf(query: { readonly dataset: string; readonly at: TimestampMs }): MachinePortResult<MachineAsOfViewMirror>;
}

/** Guard: a time-machine port (the structural seam). */
export function isTimeMachinePort(v: unknown): v is TimeMachinePort {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.dataset) || !isNonEmptyString(v.tenant)) return false;
  for (const field of ['openCursor', 'drainCursor', 'forkCursor', 'getCursor', 'asOf'] as const) {
    if (typeof (v as Record<string, unknown>)[field] !== 'function') return false;
  }
  return true;
}
