# @tradrl/event-store

**Owning Work Order: T008** (frozen write surface: `services/event-store`,
with `packages/provenance` and `services/data-ingestion` — the data plane).

The append-only event store reference implementation: the durable
point-of-record between external providers and the Market World.

## APPEND-ONLY CONTRACT (doc statement)

**No API of this store can mutate committed history.** The only writes are
`commit(events, batch)` and `appendCorrections(corrections, batch)` — both
append. There is no update, delete, patch, replace, amend or rewrite
surface, in the interface (a compile-time trip wire asserts no such method
name exists on `EventStore`) or in the implementation. Stored events and
corrections are deep-frozen, so accidental mutation of a returned record
throws in strict mode. Corrections NEVER rewrite the corrected event — they
are appended to a correction log and the current belief is computed as a
query-time view (`correctionStatus`). A commit is ATOMIC: any typed
rejection means nothing from that batch was appended.

## Surface

- **Commit** — `commit(events, batch)` → `CommitReceipt` (deterministic
  commit id from the monotonic sequence, per-event ingestion timestamps
  stamped at commit) or a typed rejection (collect-all `StoreCommitError`s):
  invalid envelope (quartet/ids/taxonomy/provenance — details carry
  field-level errors), duplicate event ids (store or batch), per-stream
  sequence violations (duplicate/regression, mirroring T004's
  SequenceTracker semantics), lineage cycles, derived events available
  before their in-store parents (mirror of time-engine's derived rule).
- **Quartet** — `event_time`/`source_time`/`available_time` preserved
  EXACTLY as received; the ONLY enforced ordering is
  `available_time >= event_time` (T004's ratified D-003); `ingestion_time`
  is ADVISORY on input and STAMPED at commit from the configured clock.
- **Point-in-time queries** — `query({venue?, instrument?, event_type?,
  from?, to?})` filters on `available_time` with INCLUSIVE bounds — never
  on `event_time`. Sorted by `(available_time, event_id)` (deterministic).
- **Lineage** — `lineageOf(id)`: ancestors, roots, depth (longest path to
  a root), external/dangling parents. `getProvenanceRecord(id)`: the full
  store-level record (origin, adapter, derived_from, transform,
  corrections, custody — a structural mirror of `@tradrl/provenance`'s
  `ProvenanceRecord`).
- **Corrections** — `appendCorrections` (targets must exist; ids unique)
  and `correctionStatus(id)` (latest amendment wins; full history kept).
- **Determinism & replay** — commits are a pure fold over the event stream
  and config: two stores fed the same batches (same order, same clock)
  have deeply-equal `snapshot()`s. `commitLog()` is the replayable source
  of truth; `replayCommitLog` rebuilds identical state (verbatim restore,
  tampered logs rejected with typed errors).
- **Clock** — injectable `CommitClock`; `createDeterministicCommitClock`
  is the default. Same config → same state, provable.

## Dependencies

Zero runtime dependencies. The envelope, provenance, sequence and
taxonomy shapes are STRUCTURAL MIRRORS of `@tradrl/market-protocol` /
`@tradrl/provenance` (law D-004: never imports) — a validated
`MarketEvent` is assignable to `StorableEvent` (compile-time trip wire),
and the behavioral suites + trip wires live in
`packages/provenance/src/` (the frozen root vitest/tsconfig include
patterns cover `packages/**` only — see that package's README).

**Consumers:** T009 (replay world) reads the log/query surface; T026
(firewall) consumes point-in-time window queries; T036 (adapter SDK)
commits through `commit(events, batch)`. See
`services/data-ingestion/README.md` for the plane's consumption contract.
