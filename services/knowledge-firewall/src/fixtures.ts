/**
 * @tradrl/knowledge-firewall — fixture scenarios (Work Order T026).
 *
 * The scenarios demonstrate the whole firewall end-to-end on the REAL
 * knowledge contracts from `@tradrl/time-engine/knowledge` (the append-only
 * base, the propagation law, the leakage scan) driven by the REAL
 * `SimulationClock` from `@tradrl/time-engine`:
 *
 *   1. {@link cleanKnowledgeGraph} — raw observations -> derived features ->
 *      an aggregate, built through the GUARDED append path so every
 *      available_time is propagation-validated (raw t1..t3 at 1_000/2_000/
 *      3_000; feature f1 at 3_250 = max(inputs) + 250ms policy delay;
 *      aggregate a1 beyond its floor).
 *   2. {@link leakyKnowledgeGraph} — the same shapes but dated BEFORE the
 *      latest input, constructible only through the FORENSIC loading path;
 *      the leakage scan reports the violation naming the offending chain.
 *   3. {@link tenantIsolationScenario} — a mixed-tenant base where
 *      cross-tenant derivations are rejected at append and cross-tenant
 *      reads are rejected with typed errors.
 *
 * WIRING NOTE (integration): the service core (mirrors.ts + service.ts) is
 * zero-dependency by D-004 (structural mirrors + trip-wire tests; the frozen
 * lockfile forbids a workspace edge). The fixtures wire the reference
 * implementation to the real time-engine knowledge module through a
 * monorepo-relative source import — the same reach pattern as
 * packages/market-protocol/src/interop.test.ts. At the integration station
 * the Lead formalizes this edge as a proper workspace dependency
 * (`"@tradrl/time-engine": "workspace:*"`), exactly as T029/T027/T034 will.
 */

import {
  appendKnowledgeRecord,
  createKnowledgeBase,
  createKnowledgeRecord,
  derivedKnowledgeAvailableTime,
  knowledgeLeakageScan,
  loadKnowledgeRecords,
  requireKnowledgeRecordId,
  requireTenantId,
  type KnowledgeBase,
  type KnowledgeLeakageReport,
  type KnowledgeRecord,
  type KnowledgeResult,
} from '../../../packages/time-engine/src/knowledge/index';
import {
  createSimulationClock,
  requireTimestampMs,
  type SimulationClock,
  type TimestampMs,
} from '../../../packages/time-engine/src/index';

const T = (ms: number) => requireTimestampMs(ms);

/**
 * Realistic T008-shaped custody: every append into the knowledge base is a
 * store commit (commit sequences are positive and monotonic; the ingestion
 * timestamp is stamped at commit — mirrored from the T008 custody contract).
 */
let commitCounter = 0;
function nextCustody(adapterId: string, adapterVersion: string, at: number): Record<string, unknown> {
  commitCounter += 1;
  const seq = String(commitCounter).padStart(8, '0');
  return {
    adapter: { id: adapterId, version: adapterVersion },
    batch: { batch_id: `kb-batch-${seq}` },
    commit: { commit_id: `kb-cmt-${seq}`, commit_sequence: commitCounter, ingestion_time: T(at) },
  };
}

/** A real SimulationClock standing at `at` (exact replay, real speed). */
export function firewallClockAt(at: number): SimulationClock {
  const result = createSimulationClock({ asOf: T(at), fidelity: 'exact_replay' });
  if (result.ok) return result.value;
  throw new Error(`firewallClockAt: ${result.error.message}`);
}

/** Structural result shape accepted by the fixture unwrapper (both KnowledgeResult and TimeResult satisfy it). */
type ResultLike<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } };

function unwrap<T>(value: ResultLike<T>): T {
  if (value.ok) return value.value;
  throw new Error(`fixture construction failed: ${value.error.message}`);
}

function rawRecord(id: string, available: number, tenant: string, payload: Record<string, unknown> = {}): KnowledgeRecord {
  return unwrap(
    createKnowledgeRecord({
      record_id: id,
      tenant,
      payload,
      event_time: T(available - 50),
      source_time: null,
      available_time: T(available),
      ingestion_time: T(available + 100),
      inputs: [],
      computation: null,
      provenance: {
        origin: 'historical',
        adapter: { id: 'binance-adapter', version: '1.4.0' },
        derived_from: [],
        transform: null,
        corrections: [],
        custody: nextCustody('binance-adapter', '1.4.0', available + 100),
      },
    }),
  );
}

function derivedRecord(
  id: string,
  inputs: readonly string[],
  available: number,
  transformId: string,
  tenant: string,
  payload: Record<string, unknown> = {},
): KnowledgeRecord {
  return unwrap(
    createKnowledgeRecord({
      record_id: id,
      tenant,
      payload,
      event_time: T(available - 25),
      source_time: null,
      available_time: T(available),
      ingestion_time: T(available + 10),
      inputs,
      computation: { transform_id: transformId, delay: { milliseconds: 250 } },
      provenance: {
        origin: 'simulated',
        adapter: null,
        derived_from: inputs.map((input) => `evt-${input}`),
        transform: transformId,
        corrections: [],
        custody: nextCustody('knowledge-factory', '0.1.0', available + 10),
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Scenario 1: the clean knowledge graph (guarded append, correct propagation).
// ---------------------------------------------------------------------------

/** The clean scenario: a propagation-validated acme knowledge graph. */
export interface CleanKnowledgeGraphFixture {
  readonly base: KnowledgeBase;
  readonly tenant: string;
  readonly rawIds: readonly string[];
  readonly featureId: string;
  readonly aggregateId: string;
  /** The feature's canonical availability: max(raw inputs) + 250ms policy delay. */
  readonly featureAvailable: TimestampMs;
  /** The aggregate's availability (beyond its floor — a legitimate embargo). */
  readonly aggregateAvailable: TimestampMs;
  /** The leakage scan over the clean base: clean by construction. */
  readonly scan: KnowledgeLeakageReport;
}

/**
 * The clean fixture: raw trade observations (1_000/2_000/3_000) -> a
 * multi-input VWAP feature (canonical availability 3_250 via
 * derivedKnowledgeAvailableTime) -> a daily aggregate (4_250, beyond its
 * floor). Every record is appended through the guarded path, so the
 * propagation law and tenant isolation were ENFORCED at write time, and the
 * leakage scan over the result is clean.
 */
export function cleanKnowledgeGraph(): CleanKnowledgeGraphFixture {
  commitCounter = 0; // determinism: every rebuild produces the identical graph
  const tenant = 'acme';
  const rawIds = ['kr-trade-1', 'kr-trade-2', 'kr-trade-3'];

  let base = createKnowledgeBase();
  base = unwrap(appendKnowledgeRecord(base, rawRecord('kr-trade-1', 1_000, tenant, { price: '43125.10', size: '0.017' })));
  base = unwrap(appendKnowledgeRecord(base, rawRecord('kr-trade-2', 2_000, tenant, { price: '43126.40', size: '0.012' })));
  base = unwrap(appendKnowledgeRecord(base, rawRecord('kr-trade-3', 3_000, tenant, { price: '43124.80', size: '0.021' })));

  // The canonical feature availability, computed by the propagation contract
  // itself: max(1_000, 2_000, 3_000) + 250ms.
  const featureAvailable = unwrap(
    derivedKnowledgeAvailableTime(base.records, 'vwap-1m-aggregator', { milliseconds: 250 }),
  );
  const feature = derivedRecord('kr-feature-vwap', rawIds, featureAvailable, 'vwap-1m-aggregator', tenant, { vwap: '43125.43' });
  base = unwrap(appendKnowledgeRecord(base, feature));

  const aggregateAvailable = T(4_250); // beyond the floor max(3_250, 3_000) — a legitimate embargo
  const aggregate = derivedRecord('kr-aggregate-daily', ['kr-feature-vwap', 'kr-trade-3'], aggregateAvailable, 'daily-rollup', tenant, {
    bars: 3,
    vwap_mean: '43125.43',
  });
  base = unwrap(appendKnowledgeRecord(base, aggregate));

  return {
    base,
    tenant,
    rawIds,
    featureId: 'kr-feature-vwap',
    aggregateId: 'kr-aggregate-daily',
    featureAvailable,
    aggregateAvailable,
    scan: knowledgeLeakageScan(base),
  };
}

// ---------------------------------------------------------------------------
// Scenario 2: the deliberately-leaky fixture (forensic loading + the scan).
// ---------------------------------------------------------------------------

/** The leaky scenario: a past-dated derived record over a future input. */
export interface LeakyKnowledgeGraphFixture {
  readonly base: KnowledgeBase;
  readonly tenant: string;
  readonly parentId: string;
  readonly leakyId: string;
  /** The scan report: one leaky_record finding naming the offending chain. */
  readonly scan: KnowledgeLeakageReport;
}

/**
 * The deliberately-leaky fixture: a raw observation available at 10_000 and
 * a derived record claiming availability at 9_000 — a past-dated artifact
 * built from a future-available input. The append path REJECTS this shape;
 * it exists here through the forensic loading path, and the leakage scan
 * detects it, naming the offending chain [leaky, parent].
 */
export function leakyKnowledgeGraph(): LeakyKnowledgeGraphFixture {
  commitCounter = 0; // determinism: every rebuild produces the identical graph
  const tenant = 'acme';
  const parent = rawRecord('kr-raw-late', 10_000, tenant, { news: 'embargoed-release' });
  const leaky = derivedRecord('kr-derived-eager', ['kr-raw-late'], 9_000, 'eager-transform', tenant, { signal: 'too-early' });
  const base = unwrap(loadKnowledgeRecords([parent, leaky]));
  return {
    base,
    tenant,
    parentId: 'kr-raw-late',
    leakyId: 'kr-derived-eager',
    scan: knowledgeLeakageScan(base),
  };
}

// ---------------------------------------------------------------------------
// Scenario 3: cross-tenant isolation (L12).
// ---------------------------------------------------------------------------

/** The tenant-isolation scenario: a mixed-tenant base with typed rejections. */
export interface TenantIsolationFixture {
  readonly base: KnowledgeBase;
  readonly acme: string;
  readonly globex: string;
  readonly acmeRecordId: string;
  readonly globexRecordId: string;
}

/**
 * The tenant-isolation fixture: acme and globex records in one base (a
 * mixed-tenant store is legitimate — isolation governs READS and
 * DERIVATIONS, not coexistence). Cross-tenant reads and cross-tenant
 * derivations are rejected with typed errors (see the tests).
 */
export function tenantIsolationScenario(): TenantIsolationFixture {
  commitCounter = 0; // determinism: every rebuild produces the identical base
  const acme = 'acme';
  const globex = 'globex';
  let base = createKnowledgeBase();
  base = unwrap(appendKnowledgeRecord(base, rawRecord('kr-acme-1', 1_500, acme, { book: 'acme-alpha' })));
  base = unwrap(appendKnowledgeRecord(base, rawRecord('kr-globex-1', 1_800, globex, { book: 'globex-beta' })));
  // A globex-derived record over the ACME parent: rejected at append
  // (tenant_isolation) — asserted in the tests, not built here.
  return {
    base,
    acme,
    globex,
    acmeRecordId: 'kr-acme-1',
    globexRecordId: 'kr-globex-1',
  };
}

/** Convenience: the cross-tenant derivation the append path must reject. */
export function crossTenantDerivation(foreignParentId: string, tenant: string): KnowledgeRecord {
  return derivedRecord('kr-cross-tenant-derived', [foreignParentId], 5_000, 'copycat-transform', tenant, { stolen: true });
}

/** Tenant/record ids for tests (throwing constructors, trusted literals). */
export const ids = {
  acme: () => requireTenantId('acme'),
  globex: () => requireTenantId('globex'),
  record: (value: string) => requireKnowledgeRecordId(value),
};
