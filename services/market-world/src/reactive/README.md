# Reactive market simulation (T027)

`services/market-world/src/reactive/` is the REACTIVE REPLAY WORLD with
ENDOGENOUS PARTICIPANTS — the second of the three explicit Market World
modes (spec/ARCHITECTURE.md: "exact historical replay, reactive replay with
endogenous participants, and counterfactual/generative simulation").

> Reactive replay with endogenous participants — **agent orders move the
> book; the world reacts.** Synthetic worlds are stress/exploration
> instruments, not historical truth.

It lives BESIDE the historical replay lane (`src/replay/`, T009 — frozen to
this Work Order) and the exchange lane (`src/exchange/`, T010) inside the
market-world service.

```
RecordedEventSource (pure async iterator — the EXOGENOUS stream IN)
        │  batches (validated, anti-poisoned, digest-chained)
        ▼
load-then-bind (T009's discipline — safe by design via L4)
        ▼
ReactiveWorldService
  startEpisode ──► engine SEEDED (latest recorded book_snapshot available
  (start)            at the start instant), stream ARMED (opening settlement)
  submitAction ──► EngineDriver.submitOrder/cancelOrder (THE MATCH — the
  (submit)          reactive difference: fills with fees, latency, slippage)
  advanceEpisode ─► the BOUNDARY STEP MACHINE: clock + ONE stream step +
  (advance)         engine advance per the DECLARED interleaving policy
  emitObservations ► the inclusive L4 boundary over recorded events AND
  (observe)         engine outcomes (admitObservations gates — typed)
  finishEpisode ─► final state + ReactiveRunRecord (L9: config hash, chain
  (finish)          head, spec hash, ENGINE STATE HASH, digest) + resume
```

## The reactive difference (the existential law)

In exact replay an order drifts past the book without consequence — a typed
receipt whose disposition union has exactly one member (`recorded_as_intent`).
HERE the candidate organization and its adversaries submit real intents to a
real matching engine: orders cross, books move, fees accrue, latency embargoes
fills, slippage prices the aggressor. The engine is
`@tradrl/exchange-sim`'s MatchingEngine — **driven, never reimplemented**:
the reactive lane imports nothing across lanes (zero-dep, mirrors only), so
the engine arrives through the injected `EngineDriver` port (the structural
mirror of `createEngine`/`submitOrder`/`cancelOrder`/`advanceEngine`),
bound to the real package by consumers and by the interop trip-wire tests.

Every engine-driven fill carries its **full physics lineage**: the engine's
own fill record verbatim, the engine config hash, the fee/latency/slippage/
impact policy refs, the run ref, and the tenant/project scope. A fill
without physics lineage is a typed error (`physics_lineage_missing`).

## The five laws this lane owns

- **L5 (mode honesty)**: `ReactiveWorldConfig.mode` is the literal
  `'reactive_replay'`; any other claim — most importantly `'exact_replay'` —
  fails `fidelity_claim_dishonest` at config validation, at `start`, and at
  the run-record guard.
- **L4 (point-in-time)**: participants observe only what the boundary
  admits — `available_time <= at` (inclusive), `at <= now`. The delivery
  gate `admitObservations` fails `l4_boundary_violation` (defense in depth:
  the filter AND the gate are independent layers). A fill is never visible
  before its latency window elapses.
- **L6 (synthetic ≠ historical)**: engine outcomes are `simulated`-origin
  observations; the recorded stream is `historical`-origin only
  (anti-poisoning: `synthetic_event_rejected`). This world NEVER asserts
  its fills are historical truth.
- **L9/L12 (lineage + tenancy)**: every run carries the `ReactiveRunRecord`
  (config hash, ingest-chain head, spec hash, engine state hash, its own
  digest); every fill/receipt/observation carries the run ref and the
  tenant/project scope.
- **Determinism**: same (recorded stream, seed, participant action script,
  physics configs, clock config, interleaving policy) → byte-identical
  world evolution — engine state, fills, observations — proven by the
  golden fixture tests, run twice, deep-equal and byte-equal.

## The interleaving policy (the deterministic order law)

The world advances through **boundaries** — the next recorded event's
availability instant, the next scripted action's instant, or the advance
target. Each `advance` call moves the clock and processes exactly ONE
boundary (loop until the view reports `settled` to absorb a window; the
T013 adapter does this for the bridge). The declared policy orders the
stream step against the scripted actions within a boundary:

| Policy | Same-instant order | Driver submits |
|---|---|---|
| `stream_first` | stream applies, then actions fire | require settled (`interleaving_violation` otherwise) |
| `actions_first` | actions fire, then stream applies | require settled |
| `unrestricted` | stream applies, then actions fire | legal at any rest point (pending counts reported) |

Strict policies make "acting mid-stream-step" a typed error — the driver
must absorb the market's recorded moves at its instant before acting.

## Resumability (the T009 discipline, extended)

`exportRunState(episode)` serializes the whole run line (config, ingest
chain, loaded stream, engine state, cursor, logs, observations). Resume
fast-forwards a FRESH source past the consumed batches **verifying each
digest against the recorded chain**, and fresh feeds past the consumed
actions **verifying each action id against the scripted log** (tamper =
`chain_mismatch`), then continues — a resumed run finishes with the
IDENTICAL run record.

## How downstream Work Orders consume this world

| Consumer | What it takes from here | How |
|---|---|---|
| **T013** — RL bridge | the Environment surface + the run record | The service satisfies the five-operation `Environment` surface structurally (`isEnvironment`-shaped); `asTrainerEnvironment(service)` adds the bridge's view narrowing and `{ kind, body }` payload vocabulary. The trainer drives episodes; `ReactiveRunRecord` binds into experiment lineage. |
| **T015** — curriculum stage 4 | the commissioned reactive worlds | Stage 4's episode batches run on the compute layer (T014) driving THIS world through the T013 bridge: the commission's environment config refs name the `ReactiveWorldConfig` (config hash = the L9 anchor), the roster names the participants, the declared interleaving is part of the commissioned configuration. |
| **T028** — generative worlds | the driver pattern + the mirror discipline | The generative lane follows this lane's composition pattern serially (same package, `src/generative/`), replacing the recorded stream with generative population output. |
| **T026** — knowledge firewall | the observation stream | The firewall queries this world through `observe` (the inclusive boundary IS the firewall); `ReactiveObservation.provenance` polices derived knowledge identically to primitive knowledge — `simulated` outcomes are never mistaken for `historical` records. |

## Module layout

```
services/market-world/src/reactive/
  index.ts             the facade (re-exported additively by src/index.ts)
  primitives.ts        zero-dep foundation (deepFreeze, guards, canonical JSON, FNV-1a)
  ids.ts               branded ids (brand tags mirror the canonical owners)
  errors.ts            the typed error taxonomy
  env-mirror.ts        T005/time-engine structural mirrors
  exchange-mirror.ts   T010 physics/engine mirrors + the injected EngineDriver port
  stream.ts            the recorded-event mirror (anti-poisoning) + source port + chain
  action-feed.ts       the scripted participant action feed ports
  config.ts            ReactiveWorldConfig (mode-honest) + validation + hash
  records.ts           fills w/ physics lineage, observations, receipts, run record/state
  service.ts           the five operations + the boundary step machine + resume
  adapter.ts           the T013 EnvironmentPort bridge adapter
  fixtures.ts          the deterministic golden scenario (stream + scripts + runner)
```

## Import discipline

This lane is **zero-dependency** (no package imports, mirrors only — the
frozen write surface forbids imports across lanes). Cross-lane shapes
(exchange-sim, environment-protocol, market-world contract, time-engine)
are structural mirrors (D-003/D-004); `interop.test.ts` is the trip wire
against the REAL packages on this branch: the real engine satisfies the
`EngineDriver` port and drives a full byte-identical episode, the service
passes the real `isEnvironment`, its outputs pass the real observation and
episode guards, the canonical spec JSON and episode-id derivations match,
and the SAME order intent that produces only a receipt in T009's replay
world produces fills with full physics lineage here — the reactive
difference, asserted as a contrast.
