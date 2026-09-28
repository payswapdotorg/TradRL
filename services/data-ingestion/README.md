# @tradrl/data-ingestion

**Owning Work Order: T008** (frozen write surface: `services/data-ingestion`,
with `packages/provenance` and `services/event-store` — the data plane).

The ingestion pipeline reference implementation: the provider-neutral
adapter boundary, canonical-event validation, batched commits to the
event store, and the typed dead-letter queue.

## The plane in one paragraph

```
ProviderAdapter<Raw>          (vendor specifics live ONLY here — L13/L14)
   discover() / fetch(batch) / normalize(raw)
        |
        v
IngestionPipeline             (this service)
   validate: quartet + ids + taxonomy + provenance + within-batch sequence
   dead-letter: typed reasons, nothing silently dropped
        |
        v  (EventCommitPort — a STRUCTURAL port; no package dependency)
EventStore                     (@tradrl/event-store)
   atomic commit: custody stamped, ingestion_time stamped at commit
   queries: point-in-time windows on available_time, lineage, corrections
   commit log -> replayCommitLog -> identical state
```

The store satisfies `EventCommitPort` STRUCTURALLY (law D-004: the
services never import each other — the envelope/quartet/provenance shapes
are structurally identical mirrors, trip-wired by
`packages/provenance/src/interop.test.ts`). The behavioral suites live in
`packages/provenance/src/` (the frozen root vitest/tsconfig include
patterns cover `packages/**` only — see that package's README).

## Dead-letter discipline

Every record an adapter delivers ends up EITHER committed to the store OR
in the DLQ with a typed reason — `normalization_error` (adapter could not
translate the raw record), `validation_error` (quartet/ids/taxonomy/
provenance/sequence pre-check failed) or `store_rejection` (the store
rejected it at commit: duplicate id, sequence vs committed state, cyclic
lineage, derived-before-parents). `deadLetterReport()` is an exact,
order-preserving account of everything rejected.

## How the next Work Orders consume this plane

### T009 — Historical replay World

T009 builds the replay Market World on top of the event store's read
surface:

- **Point-in-time window queries** — `store.query({ instrument, venue,
  from, to })` (inclusive bounds on `available_time`, never
  `event_time`) is the exact feed a replay world advances over. The
  world's clock (`@tradrl/time-engine`) steps `from`/`to`; the store
  returns the events that became legitimately observable in that step.
- **Lineage** — `store.lineageOf(eventId)` / `getProvenanceRecord(id)`
  give the reproducible provenance of every replayed input (L9): origin,
  adapter id+version, derived_from chain, custody (adapter -> batch ->
  commit).
- **Replay determinism** — `replayCommitLog(log)` rebuilds a
  byte-identical store; a replay world pins its input store by commit-log
  content hash so runs are reproducible.

### T026 — Point-in-time knowledge firewall

T026 polices observations AND derived state identically (L4). This plane
is its substrate:

- **`available_time` is the boundary input** — the quartet preserved
  EXACTLY at ingest and at commit (the store NEVER rewrites availability;
  `ingestion_time` is stamped at commit and is deliberately unordered
  against `available_time`).
- **Embargoed data is ingested, not rejected** — future-dated
  `available_time` passes this plane (validation is timeless); the
  firewall withholds it until its clock reaches it.
- **Derived events obey parent availability** — the store already
  rejects derived events available before their in-store parents
  (mirroring `@tradrl/time-engine`'s `validateDerivedAvailability`); the
  firewall re-polices observations at query time (defense in depth).
- **Corrections** — `correctionStatus(eventId)` is the current-belief
  view; the firewall decides how a correction to an already-observed
  event is exposed (never by rewriting history).

### T036 — Provider-neutral adapter SDK

T036 turns this service's adapter boundary into the vendor SDK:

- **`ProviderAdapter<Raw>` is the contract** — `discover` / `fetch` /
  `normalize` with typed `NormalizationError`s. The synthetic tick and
  news adapters in `src/adapters/` are the reference implementations and
  the fixture streams for the SDK's own conformance suite.
- **`CanonicalEvent` is the SDK's output shape** — a structural mirror of
  market-protocol's `MarketEvent`: a validated `MarketEvent` is
  assignable to it (compile-time trip wire), and adapter output passes
  market-protocol's own `validateMarketEvent` (runtime trip wire).
- **The commit port** — the SDK's adapters plug into any store
  satisfying `EventCommitPort`; `@tradrl/event-store` is the reference
  target.
- **Vendor specifics stay in adapters** — provenance/entitlement
  constraints are carried in the event's provenance block (adapter id +
  version), so the SDK never widens the plane's contracts.

## Dependencies

Zero runtime dependencies. Contract shapes are structural mirrors
(law D-004); see `packages/provenance/README.md` for the mirror
discipline and the test-placement note.
