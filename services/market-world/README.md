# @tradrl/market-world — the historical replay World (T009)

**Owning Work Order: T009** · Status: implemented (exact historical replay only) ·
Contract package: [`packages/market-world`](../../packages/market-world) ·
Depends on (merged): T004 (market-protocol, time-engine), T005 (environment-protocol, environment-runner)

The historical replay World is TradRL's ground-truth instrument: it reconstructs the
market **exactly as recorded**, event by event, under a `SimulationClock`, and exposes it
through the environment protocol so agent organizations experience history **without
future leakage**. It is bit-reproducible and forensically auditable.

```
ReplayEventSource (pure async iterator — the stream IN, untrusted records)
        │  batches
        ▼
ReplayWorldService ──► ingestWorld (pure transition: mirrored guards, quartet
        │              ordering, sequence discipline, duplicate ids, stream
        │              selection, as_of anchor, anti-poisoning origin rule)
        │              + per-batch FNV-1a ingest-chain digests
        ▼
WorldAdapter (structural Environment: start/observe/submit/advance/finish)
        │              observe ──► the inclusive L4 boundary: available_time <= at
        │              submit  ──► INTENT receipts, never fills (L6/L8)
        ▼
ReplayRunRecord (L9 lineage: config hash, chain head, event count, clock
                 timeline, complete ordered intent log, own digest)
```

## L5 — what this world is, and is not

The fidelity mode is a **first-class field** everywhere (`config.fidelity`,
`clock.fidelity`, `spec.profile.fidelity`) and it is `'exact_replay'` — enforced at
`initReplayWorld` and at `WorldAdapter.start` with `unsupported_fidelity`. The contract
TYPE admits all three L5 modes (`exact_replay | reactive_replay | generative`); this
implementation admits exactly one:

- **reactive replay** (endogenous participants reacting to history) → T027,
  `services/market-world/reactive/`.
- **generative / counterfactual worlds** → T028, `services/market-world/generative/`.

Anti-poisoning: `ingestWorld` rejects any event whose `provenance.origin !== 'historical'`
(`synthetic_event_rejected`). Synthetic origins are the reactive/generative lanes.

## L6 — the declared execution limitation

In exact replay, execution fidelity is **bounded by recorded history**: there are NO
synthetic fills in this mode. `submit()` records the action as an **intent** with a typed
receipt whose disposition union has exactly one member — `recorded_as_intent` — so a fill
is inexpressible in the type. Order matching is T010 (exchange simulation, joining
`services/market-world/src/exchange/`) and T027 (reactive participants). The intent log
is complete and ordered in every `ReplayRunRecord`.

## L4 — the world is the enforcement point

`observeWorld` (and the adapter's `observe` over it) delivers an event **iff**
`available_time <= at` (INCLUSIVE) and `at <= clock.now` (Time-Machine queries at
`at < now` are legal; `at > now` is `observation_beyond_now`). Derived events (explicit
`derived_from` lineage) obey the same law — the boundary never consults provenance. The
world delegates nothing.

## The service protocol

```ts
const service = createReplayWorldService(config, createFixtureEventSource(opts));
await service.loadAll();            // phase 1: load the recorded stream (digest-chained)
const view = service.start(spec);   // phase 2: bind an episode (load-then-bind)
service.observe(view.episode_id, at);   // point-in-time delivery (L4)
service.submit(view.episode_id, action); // intent receipt — never a match (L6/L8)
service.advance(view.episode_id, to);    // monotonic, <= episode asOf
const finish = service.finish(view.episode_id, { code: 'completed', detail: '...' });
const record = service.runRecord(view.episode_id); // the L9 lineage record
```

**Load-then-bind discipline**: the recorded stream loads fully before an episode binds,
and ingestion closes at the first `start` (`ingestion_pending` / `ingestion_closed`).
This is safe BY DESIGN — the L4 boundary withholds every future-dated event, so holding
the full history leaks nothing — and it makes every episode a closed, fully-auditable run
over the complete recorded world. (Memory-bounded streaming ingestion is T008/T029.)

**Resume**: `exportRunState(episode?)` produces the serializable `ReplayRunState` (the
world state + ingest chain + run log). `resumeReplayRunState(state, source)` fast-forwards
a FRESH source past the consumed batches, **verifying each batch's digest against the
recorded ingest chain** (a mismatched stream fails with `resume_stream_mismatch`), then
continues — a resumed run provably consumed the same stream and finishes with the
identical `ReplayRunRecord`.

## The fixture discipline (acceptance criterion 10)

Fixture streams are deterministic synthetic histories (seeded xorshift32 — every choice
derives from the seed) whose payloads mirror market-protocol taxonomies (decimal-string
prices/sizes; trades, quotes, book snapshots, plus derived `other:vwap_1m` aggregates
with explicit lineage and transform). They declare **recorded-historical provenance
explicitly**: every fixture event carries `origin: 'historical'` with the adapter
reference `{ id: 'replay-fixture-adapter', version: '1.0.0' }`. The world cannot (and
need not) distinguish a fixture from a vendor feed — the discipline is that the fixture
generator only emits records that claim, honestly within the laboratory, "this is the
recorded history". Real recorded history enters through T008's ingestion adapters under
the same law.

## How downstream Work Orders consume this world

| Consumer | What it takes from here | How |
|---|---|---|
| **T010** — exchange/order-book simulation | the loaded world's recorded history and snapshot refs; the service seam under `src/exchange/` | T010 joins THIS package under `services/market-world/src/exchange/`: it consumes `ReplayWorldState.history` / `snapshot_refs` (recorded `book_snapshot` events — the world never synthesizes snapshots) to reconstruct books, and implements its own `Environment` surface for `reactive_replay` episodes where intents are MATCHED. The `IntentReceipt`/`IntentRecord` contract is the hand-off point: T010 turns recorded intents into fills in ITS mode; in this mode they stay intents. |
| **T026** — point-in-time knowledge firewall | the observation stream + the per-episode visibility law | T026 queries this world through `observeWorld` / `WorldAdapter.observe` (the inclusive boundary IS the firewall — one law, one enforcement point) and consumes `WorldObservation.provenance` (origin trichotomy + lineage) to police derived knowledge identically to primitive knowledge. The `snapshot_refs` give it point-in-time book anchors. |
| **T013** — RL interface / trainer bridge | the Environment surface + the run record | T013 drives episodes through the five operations (the `WorldAdapter` and the `ReplayWorldService` both satisfy `isEnvironment` structurally), attaches ITS OWN reward functions to the recorded trajectory (this world emits zero reward signals by design — L7), and binds `ReplayRunRecord` (config hash, chain head, spec hash, digest) into its experiment lineage (T011/T012 bind the same record). |

## Package layout

```
services/market-world/
  src/
    index.ts              the facade (re-exports src/replay/)
    replay/
      event-source.ts     ReplayEventSource — the pure async-iterator contract
      fixtures.ts         deterministic synthetic history (recorded-historical provenance)
      run-state.ts        ReplayRunRecord (L9), ReplayRunState, ingest-chain digests
      service.ts          ReplayWorldService: load, drive, record, resume
```

The LAWS live in the contract package `packages/market-world` (zero runtime
dependencies, hand-rolled total guards, deepFreeze, typed error taxonomy): the WorldEvent
mirror of market-protocol's MarketEvent (the stream IN), the ClockState mirror of
time-engine's SimulationClock, the environment-protocol shape mirrors (the WorldAdapter's
outputs are structurally `EpisodeState`/`Observation`/`EpisodeFinish` — proven by
`packages/market-world/src/interop.test.ts`, which runs the REAL environment-protocol
guards whenever that package is present on the tree).

## Import + test placement notes (for the Tech Lead)

- This service imports its contract package by **relative path**
  (`../../../../packages/market-world/src/index`) because this Work Order's frozen write
  surface permits only the prelude's `pnpm-lock.yaml` regeneration — a `workspace:*`
  edge would touch the lockfile beyond that. Convert at the next serialized lockfile
  change.
- The service's tests live in `packages/market-world/src/replay-service.test.ts` (and
  the interop trip wires in `interop.test.ts`) because the root vitest config — frozen
  for this Work Order — collects `packages/**` and `tests/**` only, and `tests/` is
  outside this surface. Relocate under `services/market-world/` when the root test
  config next changes.
