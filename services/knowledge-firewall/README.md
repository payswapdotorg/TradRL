# @tradrl/knowledge-firewall

The **point-in-time knowledge firewall** — the L4 enforcement plane at the
knowledge layer (Work Order **T026**). Reference implementation, zero runtime
dependencies.

Every piece of knowledge — raw observations, derived features, aggregates,
labels, cached data, research artifacts, firm-memory refs — is one
`KnowledgeRecord` carrying the **availability quartet** (event/source/
available/ingestion), the knowledge-graph lineage, the computation policy,
the tenant id and a T008-shaped provenance reference. Every read is policed:

```
visible(record, now)  <=>  record.available_time <= now      (INCLUSIVE — L4)
tenant(record, query)  =>  cross-tenant reads REJECTED        (L12)
derived(inputs, policy) =>  available_time >= max(inputs)     (propagation)
```

## Layers

| Layer | Location | Owns |
| --- | --- | --- |
| Contracts | `packages/time-engine/src/knowledge/` (NEW subtree, T026) | `KnowledgeRecord`, the append-only `KnowledgeBase` (`appendKnowledgeRecord` / `loadKnowledgeRecords`), `visible` / `visibleSlice` / `getKnowledgeRecord`, `derivedKnowledgeAvailableTime` / `validateKnowledgeRecord`, `knowledgeLeakageScan` |
| Service | `services/knowledge-firewall/` (this package) | `firewallQuery` with the **replayable decision audit log**, `firewallGetRecord` (typed single reads), `replayFirewallAudit` / `verifyFirewallAudit`, `createFirewallService`, fixtures |

### Mirror discipline (D-003/D-004)

The service core (`src/mirrors.ts` + `src/service.ts`) is **zero-dependency**:
it re-declares the knowledge contracts field-for-field with identical brand
strings (`TradRL.TimestampMs`, `TradRL.KnowledgeRecordId`, `TenantId`), and
`src/interop.test.ts` is the drift trip-wire — a real `KnowledgeBase` flows
through the mirror types both directions, domain-core `TenantId` mirrors
exactly, the **T008 `ProvenanceRecord`** (vendored verbatim — see below)
mirrors both directions, the service guard agrees with the real knowledge
guard and the vendored T008 guard on every fixture shape, and the real
`SimulationClock` satisfies `FirewallClock`.

`src/fixtures.ts` wires the reference implementation to the real
time-engine knowledge module via a monorepo-relative source import (the same
reach pattern as `packages/market-protocol/src/interop.test.ts`) because the
frozen lockfile forbids a workspace edge. **At the integration station the
Lead formalizes this edge as `"@tradrl/time-engine": "workspace:*"`** —
exactly as the consumers below will.

## API tour

```ts
import {
  cleanKnowledgeGraph, firewallClockAt, ids,          // fixtures (real module wiring)
  firewallQuery, firewallGetRecord, replayFirewallAudit, verifyFirewallAudit,
} from '@tradrl/knowledge-firewall';

const fixture = cleanKnowledgeGraph();                  // raw -> feature -> aggregate
const clock = firewallClockAt(3_250);                   // a real SimulationClock standing at the feature release

const result = firewallQuery(fixture.base, clock, ids.acme(), {});
// result.records           -> the visible, tenant-scoped records (inclusive boundary:
//                             the feature with available_time == 3_250 IS included)
// result.audit.decisions   -> one entry per scanned record: included/visible,
//                             excluded/not_yet_available, excluded/tenant_boundary
//                             (available_time NULL — another tenant's timing is
//                             never disclosed), excluded/filtered_out

replayFirewallAudit(result.audit);                      // re-derives every decision from the log — clean
verifyFirewallAudit(fixture.base, clock, ids.acme(), {}, result.audit);  // re-query + compare — clean

firewallGetRecord(fixture.base, clock, ids.globex(), ids.record('kr-trade-1'));
// { ok: false, error: { code: 'tenant_isolation', ... } }   (L12, typed)
```

Decision order is the law and is deterministic: **tenant boundary first**
(disclosing nothing), then the **inclusive point-in-time boundary**, then
the data-shaped filter. Decisions are pure functions of
`(record, clock, tenant, filter)`; identical queries produce deep-equal,
deeply frozen audit logs.

### Fixtures

- `cleanKnowledgeGraph()` — raw trades (1_000/2_000/3_000) → multi-input VWAP
  feature (canonical availability 3_250 = `max(inputs) + 250ms`, computed by
  `derivedKnowledgeAvailableTime`) → daily aggregate (4_250, beyond its
  floor). Built through the **guarded append path**, so propagation and
  tenant isolation were enforced at write time; its scan is clean.
- `leakyKnowledgeGraph()` — a derived record dated 9_000 over an input
  available at 10_000. The append path **rejects** this shape; it exists via
  the **forensic loading path** and `knowledgeLeakageScan` reports the
  violation naming the offending chain `[kr-derived-eager, kr-raw-late]`.
- `tenantIsolationScenario()` — a mixed acme/globex base: coexistence is
  legitimate; cross-tenant **reads and derivations** are rejected with typed
  errors.

## How consumers use the firewall

### T029 — Rolling near-real-time Time Machine

T029 feeds freshly ingested observations into the knowledge base with their
`available_time` (the ingestion lane's quartet). Every read goes through
`firewallQuery` with the rolling clock, so near-real-time consumers see
exactly the simulated information set — embargoed and backfilled data
included, future-dated data withheld. The **audit log is the evidence
trail** for "what was knowable when" (`replayFirewallAudit`/`verifyFirewallAudit`
make it tamper-evident), and `knowledgeLeakageScan` runs as a scheduled
forensic pass over the rolling base to catch pipeline regressions.

### T027 — Reactive market simulation

Reactive-replay participants compute features and aggregates from
observations. Every derived artifact they produce is appended with
`derivedKnowledgeAvailableTime(parents, transform, delay)` — so a
participant reacting at `now` can only consume artifacts whose inputs were
all available at or before `now`. A reactive world that attempted to build a
feature from future-available inputs would fail the append (or, if smuggled
through loading, be caught by the scan). The firewall is origin-blind: the
reactive world's simulated knowledge is withheld exactly like historical.

### T034 — Firm Brain

Firm memory (lessons, research notes, distilled strategy knowledge) is
stored as knowledge records with provenance and availability. The firewall
guarantees that agents deciding or training at time T only consume memory
formed from information available at or before T — **no hindsight
contamination of lessons** — and L12 keeps one tenant's firm memory
invisible to another (the audit log's boundary entries disclose nothing).

## Deviations & integration notes

- **T008 reference deviation — RESOLVED.** At dispatch the reference bundle
  was expired (`REFERENCE NEEDED` reported; the dispatcher directed
  continuation against repo-authoritative contracts). The Lead has since
  re-provisioned the bundle (tmpfiles.org, SHA256
  `cb5bd0c149fed0d825debc6704ea5c446e88ee2fd5850550c8ada1c2c7d08f59`);
  it is vendored **byte-identically** at
  `packages/time-engine/src/knowledge/t008-reference/` (the five provenance
  sources: `errors/fields/timestamp/custody/provenance.ts`). The knowledge
  provenance mirror now targets the ACTUAL T008 `ProvenanceRecord` — the
  market-protocol block **plus** the store-layer extension (`corrections` +
  `custody`) — and the trip-wires assert guard/validator parity with the
  vendored (= reference) implementations plus type-level mutual
  assignability; when `/tmp/reference` is present, the vendored files are
  asserted byte-identical to the bundle (a live genuineness proof). By width
  subtyping the full record remains a valid market-protocol `Provenance`,
  exactly as in T008's own discipline.
- The service core is zero-dep per D-004; fixtures use the relative source
  import described above.
- No persistence, no wall clocks: the firewall is pure; runtime services
  drive clocks and own storage.

## Verification

```bash
pnpm typecheck && pnpm test && pnpm program:check && pnpm governance:test
```
