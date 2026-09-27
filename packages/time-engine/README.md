# @tradrl/time-engine

**Owning Work Order: T004** (frozen write surface: `packages/time-engine`)

Time protocol and point-in-time availability contracts: the canonical
`TimestampMs` domain, `SimulationClock`, and the information-boundary firewall
(spec/ARCHITECTURE.md "Time Machine", spec/ARCHITECTURE-LOCK.md **L4**/**L5**).

Human-readable contract authority:
[`contracts/market/04-time-machine-visibility.md`](../../contracts/market/04-time-machine-visibility.md).

## Surface

- **Timestamps** — `TimestampMs` (branded epoch ms, validating constructors,
  strict ISO parsing, monotonic comparisons, min/max). ALL time comparisons in
  consumer code go through the engine.
- **Durations** — non-negative fractional-friendly components
  (`{ minutes: 5 }`, `{ hours: 1, minutes: 30 }`), validated normalization.
- **SimulationClock** — immutable value object: `now`, `asOf` (historical
  anchor; invariant `now <= asOf`), `playbackSpeed`, `paused`, `fidelity`
  (`exact_replay | reactive_replay | generative` — three DISTINCT L5 modes),
  `informationPolicy`. Pure transitions (`advanceClockTo`, `advanceClockBy`,
  `withPlaybackSpeed`, `pauseClock`, `resumeClock`) with typed errors; no
  wall-clock coupling — runs are reproducible.
- **Information firewall** — the L4 predicate: an observation is visible iff
  `available_time <= now` (INCLUSIVE). `Observable` is the minimal structural
  contract; `createVisibilityFilter` yields the observable/withheld subsets.
  `@tradrl/market-protocol`'s `MarketEvent` satisfies it structurally without
  a package dependency.
- **Leakage forensics** — `leakageCheck` scans recorded
  (clock, observed) trajectories and reports every `future_observation`
  (with lead time) and `clock_regression`.
- **Derived-state rule** — `DerivedAvailability` (the timestamp contract for
  features/aggregates/labels/caches), `derivedAvailableTime`
  (= latest input availability + computation delay) and
  `validateDerivedAvailability` (rejects artifacts available before their
  inputs).

## Dependencies

Zero runtime dependencies — types, schemas and pure functions only. This
package is the CANONICAL owner of `TimestampMs`;
`@tradrl/market-protocol` carries a structural mirror with a cross-package
trip-wire test (`packages/market-protocol/src/interop.test.ts`).
