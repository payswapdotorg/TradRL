/**
 * @tradrl/time-machine — deterministic fixture scenarios (Work Order T029).
 *
 * Behavioral-suite fixtures following the lane discipline
 * (`services/knowledge-firewall/src/fixtures.ts`): canonical events in the
 * T008 ingestion shapes, deterministic machines over the reference firewall
 * port, and unwrapping helpers that fail loudly on construction errors.
 * Everything is deterministic — rebuilding produces identical values.
 */

import {
  createReferenceFirewallPort,
  createRollingTimeMachine,
  requireDatasetRef,
  requireTenantId,
  requireTimestampMs,
  type AsOfView,
  type CanonicalEvent,
  type CursorDrain,
  type CursorId,
  type CursorOptions,
  type EventOrigin,
  type EventType,
  type FirewallProjectionPort,
  type IngestClock,
  type IngestReceipt,
  type KnowledgeQueryFilter,
  type KnowledgeRecordId,
  type LateArrivalPolicy,
  type PointInTimeCursor,
  type RollingTimeMachine,
  type TimeMachineConfig,
  type TimeMachineResult,
} from './index';

/** The fixture tenant (L12 scope). */
export const TENANT = requireTenantId('acme');

/** The fixture dataset identity. */
export const DATASET = requireDatasetRef('acme-live-btcusdt');

/** Trusted-literal timestamp constructor for fixtures. */
export const T = (ms: number) => requireTimestampMs(ms);

/** Structural result shape accepted by the fixture unwrapper. */
type ResultLike<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } };

/** Unwrap a typed result or throw loudly (fixture construction only). */
export function unwrap<T>(value: ResultLike<T>): T {
  if (value.ok) return value.value;
  throw new Error(`fixture construction failed: ${value.error.message}`);
}

/** Overrides for the raw-event fixture. */
export interface EventOverrides {
  readonly event_time?: number;
  readonly source_time?: number | null;
  readonly ingestion_time?: number;
  readonly origin?: EventOrigin;
  readonly venue?: string;
  readonly instrument?: string;
  readonly event_type?: EventType;
  readonly sequence?: number;
  readonly payload?: Record<string, unknown>;
}

/**
 * A primitive canonical trade event, available at `available` (event_time
 * 50ms earlier; advisory ingestion 100ms later; historical origin with the
 * synthetic-tick adapter — the T008 example-adapter discipline).
 */
export function rawEvent(eventId: string, available: number, overrides: EventOverrides = {}): CanonicalEvent {
  return {
    event_id: eventId,
    venue: overrides.venue ?? 'binance',
    instrument: overrides.instrument ?? 'BTC-USDT',
    asset_class: 'crypto',
    event_type: overrides.event_type ?? 'trade',
    event_time: T(overrides.event_time ?? available - 50),
    source_time: overrides.source_time === undefined || overrides.source_time === null ? null : T(overrides.source_time),
    available_time: T(available),
    ingestion_time: T(overrides.ingestion_time ?? available + 100),
    sequence: overrides.sequence ?? 0,
    provider: 'synthetic-tick',
    provenance: {
      origin: overrides.origin ?? 'historical',
      adapter:
        (overrides.origin ?? 'historical') === 'historical'
          ? { id: 'synthetic-tick', version: '1.0.0' }
          : null,
      derived_from: [],
      transform: null,
    },
    payload: overrides.payload ?? { price: '43125.10', size: '0.017' },
  };
}

/** A derived canonical event over parent ids (the transform names the derivation). */
export function derivedEvent(
  eventId: string,
  parents: readonly string[],
  available: number,
  transform = 'vwap-1m-aggregator',
  overrides: EventOverrides = {},
): CanonicalEvent {
  return {
    ...rawEvent(eventId, available, { origin: 'simulated', ...overrides }),
    event_type: 'ohlcv',
    provenance: {
      origin: 'simulated',
      adapter: null,
      derived_from: [...parents],
      transform,
    },
  };
}

/** Machine-fixture options. */
export interface MachineOptions {
  readonly horizonMs?: number;
  readonly maxRecords?: number;
  readonly lateArrival?: LateArrivalPolicy;
  /** `null` constructs the NO-PASSAGE machine (projections must fail `firewall_required`). */
  readonly firewall?: FirewallProjectionPort | null;
  /** An injected ingest clock (deterministic by contract, L9). */
  readonly ingestClock?: IngestClock;
}

/**
 * A deterministic machine over the reference firewall port (the T026
 * decision-rule mirror). `firewall: null` constructs the NO-PASSAGE machine.
 */
export function machineOf(options: MachineOptions = {}): RollingTimeMachine {
  const config: TimeMachineConfig = {
    dataset: DATASET,
    tenant: TENANT,
    horizon: { milliseconds: options.horizonMs ?? 10_000_000 },
    maxRecords: options.maxRecords ?? 1_000,
    lateArrival: options.lateArrival ?? 'recompute',
    ...(options.firewall === null ? {} : { firewall: options.firewall ?? createReferenceFirewallPort() }),
    ...(options.ingestClock === undefined ? {} : { ingestClock: options.ingestClock }),
  };
  return unwrap(createRollingTimeMachine(config));
}

/** Ingest events as one batch, unwrapping the receipt (fails loudly on rejection results). */
export function feed(machine: RollingTimeMachine, events: readonly unknown[], batchId: string): IngestReceipt {
  return unwrap(machine.ingestBatch(events, { batch_id: batchId }));
}

/** A test-shaped projection selector (trusted literals; branded internally). */
export interface SelectorSpec {
  readonly ids?: readonly string[];
  readonly from?: number;
  readonly to?: number;
}

/** Build a KnowledgeQueryFilter from a test-shaped spec. */
export function buildSelector(spec: SelectorSpec | undefined): KnowledgeQueryFilter {
  if (spec === undefined) return {};
  return {
    ...(spec.ids === undefined ? {} : { ids: spec.ids.map((id) => id as KnowledgeRecordId) }),
    ...(spec.from === undefined ? {} : { availableFrom: T(spec.from) }),
    ...(spec.to === undefined ? {} : { availableTo: T(spec.to) }),
  };
}

/** Query the as-of view, unwrapping the result. */
export function viewAt(machine: RollingTimeMachine, at: number, spec?: SelectorSpec): AsOfView {
  return unwrap(
    machine.asOf({ dataset: DATASET, at: T(at), ...(spec === undefined ? {} : { selector: buildSelector(spec) }) }),
  );
}

/** Open a cursor, unwrapping the result. */
export function openCursor(machine: RollingTimeMachine, spec?: SelectorSpec, from?: 'start' | 'tip'): PointInTimeCursor {
  const options: CursorOptions = {
    ...(from === undefined ? {} : { from }),
    ...(spec === undefined ? {} : { selector: buildSelector(spec) }),
  };
  return unwrap(machine.openCursor(options));
}

/** Fork a cursor, unwrapping the result. */
export function forkCursor(machine: RollingTimeMachine, cursorId: string): PointInTimeCursor {
  return unwrap(machine.forkCursor(cursorId as CursorId));
}

/** Drain a cursor, unwrapping the result. */
export function drainAt(machine: RollingTimeMachine, cursorId: string, at: number): CursorDrain {
  return unwrap(machine.drainCursor(cursorId as CursorId, T(at)));
}

/** The record ids of a list of records, in order. */
export function idsOf(records: readonly { readonly record_id: string }[]): string[] {
  return records.map((record) => record.record_id);
}

/** One admitted record through the real admission path (interop/port suites). */
export function admittedRecord(): TimeMachineRecord {
  const admission = admitCanonicalEvent(rawEvent('kr-admitted', 2_000), TENANT, {
    batch_ordinal: 1,
    batch_id: 'fixture-batch',
    ingestion_time: T(2_100),
    arrival_sequence: 0,
  });
  return unwrap(admission);
}
}

/** Silence the unused-type warning for the re-exported result type. */
export type { TimeMachineResult };
