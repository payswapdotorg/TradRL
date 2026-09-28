/**
 * @tradrl/time-machine — typed errors and results (Work Order T029).
 *
 * The service's own typed failure space. Like every TradRL contract module:
 * never throw for untrusted input; return an explicit typed result. Throwing
 * is reserved for programming errors internal to a caller.
 *
 * The codes deliberately EXTEND the shared vocabulary of the lanes this
 * service consumes (law D-004 — mirrors, never imports):
 *
 *   - T008 event-store commit rejections (`invalid_event`,
 *     `duplicate_event_id`, `derived_before_inputs`, `empty_commit`,
 *     `invalid_batch_meta`) keep their spelling for the same semantics at
 *     the rolling-window boundary.
 *   - T026 firewall failures surface as `firewall_rejected` (the port's own
 *     code/message is embedded — the firewall is the AUTHORITY, the machine
 *     only propagates), and a missing firewall passage is `firewall_required`.
 */

/** Machine-readable failure codes for time-machine operations. */
export type TimeMachineErrorCode =
  /** The machine configuration is invalid (bad horizon, tenant, dataset, bounds). */
  | 'invalid_config'
  /** The ingest batch metadata is malformed (empty/missing batch id). */
  | 'invalid_batch'
  /** An ingest of zero events (mirror of T008 `empty_commit`). */
  | 'empty_ingest'
  /** An event failed envelope validation (details carry the field errors). */
  | 'invalid_event'
  /** An event id was already admitted, or is duplicated within the batch (append-only identity). */
  | 'duplicate_event_id'
  /** A derived event is available before one of its in-window parents (T008 reconciliation rule). */
  | 'derived_before_inputs'
  /** The injected ingest clock produced an invalid ingestion stamp. */
  | 'invalid_ingest_clock'
  /** The as-of query is malformed (bad dataset ref, bad `at`, bad selector). */
  | 'invalid_query'
  /** The as-of query names a dataset this machine does not serve. */
  | 'unknown_dataset'
  /** A projection was attempted without a firewall passage — the firewall is the AUTHORITY (L4). */
  | 'firewall_required'
  /** The firewall projection port rejected the passage; the port's reason is embedded. */
  | 'firewall_rejected'
  /** The cursor id does not resolve on this machine. */
  | 'unknown_cursor'
  /** The cursor construction options are invalid. */
  | 'invalid_cursor'
  /** The snapshot is structurally malformed. */
  | 'invalid_snapshot'
  /** The snapshot's recomputed lineage hash does not match its recorded hash (tampered or corrupt). */
  | 'snapshot_mismatch'
  /** The snapshot was taken with an injected ingest clock, which must be re-supplied at restore. */
  | 'clock_required';

/** A single typed time-machine failure. */
export interface TimeMachineError {
  readonly code: TimeMachineErrorCode;
  readonly message: string;
}

/** Explicit success/failure result. No exceptions for data-driven failures. */
export type TimeMachineResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TimeMachineError };

/** Construct a time-machine failure result. */
export function fail<T = never>(code: TimeMachineErrorCode, message: string): TimeMachineResult<T> {
  return { ok: false, error: { code, message } };
}

/** Construct a time-machine success result. */
export function ok<T>(value: T): TimeMachineResult<T> {
  return { ok: true, value };
}
