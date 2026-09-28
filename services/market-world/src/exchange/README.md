# Exchange simulation service (T010)

`services/market-world/src/exchange/` is the reference implementation of the
TradRL exchange/order-book simulation: a deterministic, authority-free
venue simulator that lives BESIDE the historical replay world
(`src/replay/`, T009 — untouched by this Work Order) inside the
market-world service.

The engine itself is the zero-dependency contract package
`packages/exchange-sim` (T010's other half). This service composes it into
the episode protocol and the lineage discipline:

```
consumers ──T005 action envelopes──▶ ExchangeService.submit()
                                       │ (L8: validation only, no authority)
                                       ▼
                              MatchingEngine (pure reducer)
                                       │ fills / acks / rejects / cancels / expirations
                                       ▼
                    event-shaped outputs with availability quartets (L4)
                                       │ observe(episode, at) — INCLUSIVE boundary
                                       ▼
                        consumers (T027 / T013 / T019)
```

## The five-operation surface

The service structurally implements `@tradrl/environment-protocol`'s
`Environment` interface (start / observe / submit / advance / finish) over
exchange engines. The shapes are re-declared as structural mirrors in
`env-mirror.ts` (the D-003/D-004 discipline — this branch's base does not
carry the T009/T005 packages; on the integration tree the trip-wire tests
load the REAL environment-protocol and prove the compatibility at runtime).

- `start(spec)` — validate the spec, bind it to this exchange
  (`world.world_id` must be `world-exchange-<configHash>`, `world.kind`
  must be `exchange-sim`, the spec's L5 fidelity must equal the config's),
  and create a FRESH engine over the shared config + book seed.
- `submit(episode, action)` — the action payload vocabulary:
  `{ type: 'submit_order', intent }`, `{ type: 'cancel_order', order_id }`
  or `{ type: 'cancel_client_order', client_order_id }`. The engine
  processes it mechanically (L8); every outcome is emitted as an event and
  becomes an observation.
- `observe(episode, at)` — the L4 firewall: only observations with
  `available_time <= at` (inclusive) are returned. A fill is NEVER visible
  before its latency window elapses.
- `advance(episode, to)` — monotonic, `<= asOf`; expires gtt orders.
- `finish(episode, reason)` — terminal state + the immutable result.

## Lineage (L9)

`sessionRecord(episode)` (finished episodes only) binds:

- `config_hash` — FNV-1a of the canonical config JSON,
- `book_seed_hash` — the initial book's canonical-JSON digest,
- the full `order_log` and `fill_log` (every intent, every fill, with
  per-order statuses, reject/cancel reasons and fill ids),
- `clock_timeline` — every advance, in order,
- `outcome_stream_hash` — FNV-1a over the canonical JSON of every emitted
  event, in emission order,
- the record's own `digest`.

Two identical runs produce identical records — proven by the fixtures
tests (byte-identical canonical outcome streams, twice).

## How the consumers compose this engine

### T027 — reactive world (endogenous participants)

T027 composes `@tradrl/exchange-sim`'s engine directly plus this service's
driver pattern:

1. Seed the book from replayed history (T009's `book_snapshot` events feed
   `createExchangeService(config, bookSeed)` — the seed mirror accepts
   market-protocol payload shapes verbatim).
2. Drive endogenous agents' order flow through `submit` at instants the
   T027 clock dictates (the engine's price-time priority makes queue
   positions deterministic).
3. For market REACTION beyond the visible book (quote fading, synthetic
   liquidity, impact), T027 implements its own `MarketImpactPolicy` kinds:
   the engine fail-closes on any `impact.kind` other than `'none'`
   (`unsupported_impact_policy`), so a T027 world must interpret its own
   policy kinds AROUND the engine — e.g. by injecting book deltas between
   submissions — never by smuggling semantics into the engine.
4. The reactive world's own outputs are `simulated`-origin events; this
   engine's outputs already carry that origin (anti-poisoning, L5).

### T013 — RL bridge

The RL bridge drives episodes through the five operations:

- `observe(episode, now)` is the observation step (book/quote/trade/
  outcome observations, all latency-honest),
- `submit(episode, action)` with `payload: { type: 'submit_order', intent }`
  is the action step — the OrderIntent shape is the domain-core `Order`
  mirror, so the bridge converts agent outputs without lossy mapping,
- `advance(episode, to)` is the time step,
- reward signals attach at the trajectory layer (T011/T013 — the exchange
  emits none, by L7 discipline),
- `sessionRecord(episode)` provides the lineage record an experiment
  (T011) binds for reproducibility.

The causal laws mirror T005 exactly: `submitted_at <= now` (inclusive),
per-actor `client_sequence` strictly increasing, and one engine-side law
of our own: submissions cannot claim an instant BEFORE the engine's clock
(`arrival_before_now`) — matching is arrival-ordered; a driver that wants
a later fill must submit at the current instant.

### T019 — execution policy

T019 is the risk/authorization gateway that sits BETWEEN agents and this
exchange in shadow/live execution. In simulation it can rehearse its
gating against this engine: the simulator is deliberately AUTHORITY-FREE
(L8 — no permission, balance, or kill-switch concepts anywhere in
`packages/exchange-sim`), so T019's policy engine composes in front of
`submit` exactly as it would in front of a live venue adapter, and the
exchange's fills/fees/latency give the rehearsal its cost model. The
`Fill` records (price, aggressor_price, per-side fees, latency) are the
execution-fidelity inputs T019's evaluation consumes.

## Fidelity declarations (L6)

Every model declares its fidelity class in a first-class record asserted
by tests: `FEE_FIDELITY`, `LATENCY_FIDELITY`, `SLIPPAGE_FIDELITY`,
`IMPACT_FIDELITY` (in `packages/exchange-sim`), and the engine's declared
limitations (no stop triggers, no hidden liquidity, no self-trade
prevention, instant matching, visible-book-only) live in the engine
module header and reject taxonomies. Nothing is silently approximated.
