# @tradrl/time-machine

**Owning Work Order: T029** (frozen write surface: `services/time-machine/`)

The rolling near-real-time Time Machine: as live canonical events stream in,
it maintains a **rolling window** (configurable availability horizon,
memory-bounded eviction) and continuously answers **"what was knowable at
time T?"** — point-in-time as-of views through the knowledge firewall,
resumable point-in-time cursors, and snapshot/restore of as-of states
(spec/ARCHITECTURE.md "Time Machine"; spec/ARCHITECTURE-LOCK.md **L4**
point-in-time truth, **L9** reproducible lineage, **L12** tenant isolation).

## The laws

- **L4 — the point-in-time law.** An as-of view at query time T exposes
  ONLY records whose `available_time <= T` — INCLUSIVE (visible exactly at
  the availability instant, never one millisecond earlier). The
  availability quartet (`event_time` / `source_time` / `available_time` /
  `ingestion_time`) is carried unmodified on every emitted record;
  `event_time`, `source_time` and `ingestion_time` are NEVER the gate
  (ingestion is deliberately unordered: embargo before, backfill after are
  both legitimate — decision D-003).
- **The firewall is the authority.** Every projection — every route by
  which a record reaches a consumer — passes through the
  **knowledge-firewall projection contract** (T026, mirrored as
  `FirewallProjectionPort`; `@tradrl/knowledge-firewall`'s exported
  `firewallQuery` satisfies it structurally). A machine without a port
  returns typed `firewall_required` on every projection; there is no
  direct-store-read fallback, by construction and by adversarial test.
- **Rolling determinism (L9).** No wall-clock anywhere: time advances by
  injected events only; the admission stamp comes from an injected
  deterministic clock. Replaying the same event sequence (same ingestion
  order) produces byte-identical as-of states, cursor positions and view
  hashes (deep-equal, test-proven).
- **Late/reordered arrivals follow the T008 reconciliation rules —
  declared.** An event is LATE iff its `available_time` is strictly below
  the running availability frontier at its admission moment (within-batch
  reordering included). The declared `LateArrivalPolicy` is either
  `recompute` (admit — the as-of state updates from its available_time
  onward, because every view is computed fresh from the window) or
  `quarantine` (declared exception queue with its lateness). **Silent drop
  is unrepresentable**: rejections carry typed reasons (T008 store-code
  mirrors: `invalid_event`, `duplicate_event_id`, `derived_before_inputs`);
  quarantines carry declared lateness.
- **L12 — tenant isolation.** Every projection is tenant-scoped through
  the firewall; records are stamped with the owning tenant at admission.

## Surface

| Export | Purpose |
|---|---|
| `createRollingTimeMachine(config)` | the service; config: dataset ref, tenant, `horizon` (Duration), `maxRecords`, `lateArrival`, optional `firewall` port, optional `ingestClock` |
| `machine.ingestBatch(events, {batch_id})` | ingest candidate canonical events; one typed disposition per candidate (`admitted` / `rejected` / `quarantined_late`) + declared eviction notices |
| `machine.asOf(query)` | `AsOfQuery` (opaque dataset ref + time T + projection selector) → `AsOfView` (firewall-passed records, quartet carried, replayable audit, lineage-recomputable `hash`) |
| `machine.openCursor(opts)` / `drainCursor(id, T)` / `forkCursor(id)` | resumable consumer positions; monotone advance; replay-from-cursor determinism |
| `machine.snapshot()` / `restoreTimeMachine(snap, deps)` | as-of state snapshot with lineage hash; tamper detection; identical post-restore behavior |
| `createReferenceFirewallPort()` | the T026 decision-rule mirror used by behavioral suites (production wires the real firewall) |
| `createDeterministicIngestClock(base, step)` | the L9 injectable deterministic admission clock |

## Rolling window semantics

The window retains the availability span **[frontier − horizon, frontier]**
(INCLUSIVE floor — a record at exactly the floor is retained; one
millisecond earlier is evicted), where the frontier is the maximum
`available_time` ever admitted (monotone). `maxRecords` is the hard memory
bound (victim = smallest `(available_time, record_id)` — deterministic).
Eviction is declared per ingest with reasons (`horizon` / `capacity`).
**Consumers must drain cursors within the horizon** — an evicted record is
gone by contract: this is near-real-time, not an archive (T009 owns
historical batch replay). Append-only IDENTITY outlives the window:
re-ingesting an evicted id is a typed `duplicate_event_id`, so replays stay
deterministic.

## How T030 (shadow trading) consumes the machine

T030 wires ONE cursor per shadow consumer against its dataset:

1. `openCursor({ from: 'tip' })` when the shadow trader goes live (only
   new arrivals from the live edge), or `from: 'start'` to replay the
   retained window first.
2. On every simulation tick (the shadow clock's `now` advances):
   `drainCursor(cursorId, now)` → the records that BECAME newly visible —
   arrivals since the last drain PLUS records that crossed the inclusive
   boundary since the last drain instant (late arrivals included, in
   `(available_time, record_id)` order). This IS the shadow trader's
   point-in-time information set delta: feed it to the strategy exactly as
   live data would arrive, and the L4 law guarantees zero future leakage.
3. The drain's `audit` (firewall decision log) is the per-tick evidence for
   the shadow audit trail; `position` is the resumable offset — persist the
   cursor (or the whole machine `snapshot()`) to resume after a restart,
   and `forkCursor` to re-run the same delta stream for a second shadow
   book without re-winding the first.
4. For state initialization (book warm-up), `asOf({ dataset, at: now })`
   gives the full point-in-time state; `asOf` with a selector
   (`ids` / `availableFrom` / `availableTo`) narrows to the instruments the
   shadow strategy tracks.

## How T027 (reactive world) consumes the machine

The reactive replay world drives its endogenous participants from the
rolling stream:

1. The world's exogenous feed = `openCursor()` (default `start`) with a
   selector scoped to the world's venue/instrument universe; the reactive
   loop drains at each world-step instant T — the world's participants may
   only react to what the firewall releases at T (the same inclusive L4
   boundary the exchange-sim enforces; ingestion order never leaks as
   visibility).
2. Endogenous (simulated) events generated by the world's participants are
   ingested back through `ingestBatch` with `provenance.origin:
   'simulated'` — they carry their own availability quartet, are policed by
   the SAME firewall boundary (origin-blind), and stay distinguishable in
   provenance (L5 fidelity separation).
3. Deterministic world runs: same event sequence + same deterministic
   ingest clock ⇒ byte-identical cursor streams and as-of views — the
   reproducibility the reactive-world evaluation protocol requires; the
   machine `snapshot()`/`restore` pair checkpoints long world runs.

## Mirrors and trip wires (law D-004)

Zero runtime dependencies. Every shared shape is a structural mirror:
`TimestampMs` (time-engine), the canonical event + provenance + custody
(T008 data-ingestion/event-store), `KnowledgeRecord`/filters/audit
(T026 knowledge-firewall). The vendored verbatim copy under
`src/t026-reference/` (mirroring the pattern of
`packages/time-engine/src/knowledge/t008-reference/`) plus
`src/interop.test.ts` are the drift trip wires: type-level assignability
and runtime guard parity against the real T026 contract shapes.

## Dependencies

Zero runtime dependencies — types, guards and pure functions only. The
frozen lockfile forbids workspace edges between the lanes; the Lead
formalizes the `@tradrl/knowledge-firewall` wiring at the integration
station (`firewallQuery` satisfies `FirewallProjectionPort` structurally).
