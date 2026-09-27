# 04 — The Time Machine and the Visibility Contract

Implementation: `@tradrl/time-engine`. This document is the authority for the
point-in-time information boundary (ARCHITECTURE-LOCK **L4**) and the fidelity
separation (**L5**).

## The SimulationClock

An immutable value object (spec/DOMAIN-MODEL.md: "Now, asOf, playback speed,
information policy and fidelity mode"). Transitions return new clocks; the
package has NO wall-clock coupling (`Date.now()` never appears in contract
code) — runtime services drive progression, so runs are reproducible.

| Field | Type | Semantics |
|---|---|---|
| `now` | `TimestampMs` | The current simulated instant. Monotonic within a run — transitions may only move it forward. |
| `asOf` | `TimestampMs` | The historical anchor: the latest instant this run's information set covers ("the world as of T"). **Invariant: `now <= asOf`** — a simulation may never run past its information anchor. |
| `playbackSpeed` | positive finite number | Multiplier; 1 = real time. Wall-clock meaning is owned by the runtime, not the contract. |
| `paused` | boolean | Automatic progression suspended. Explicit transitions (`advanceClockTo`/`advanceClockBy`) still work — pause governs the runtime driver, not deliberate stepping. |
| `fidelity` | `exact_replay` \| `reactive_replay` \| `generative` | The world fidelity mode — three DISTINCT values (L5), never aliased: exact replay of history; history + endogenous simulated participants; counterfactual/synthetic worlds (exploration instruments, never historical truth). |
| `informationPolicy` | `point-in-time` | The policy in force. There is deliberately exactly ONE policy today: the inclusive boundary below. The field makes the policy explicit and auditable on every clock. |

Transitions (all return typed errors, never throw on bad input):

| Operation | Rule |
|---|---|
| `createSimulationClock(spec)` | validates all invariants; `now` defaults to `asOf`, speed to 1, paused to false |
| `advanceClockTo(clock, t)` | `t >= now` (else `clock_regression`) and `t <= asOf` (else `beyond_as_of`) |
| `advanceClockBy(clock, duration)` | non-negative `Duration`; same bounds; `out_of_range` on overflow |
| `withPlaybackSpeed(clock, s)` | `s` positive finite (else `invalid_playback_speed`) |
| `pauseClock` / `resumeClock` | idempotent; never move `now` |

## The information firewall (L4)

> At simulation time `t`, an agent may observe an event **iff**
> `event.available_time <= t` — **inclusive**.

- **Inclusive** means an observation becomes visible at EXACTLY its
  `available_time`, never one millisecond earlier.
- **No exceptions and no origin-awareness**: simulated and generated
  observations are withheld exactly like historical ones. The firewall sees
  only `available_time`.
- **`ingestion_time` is never consulted** (see the embargo/backfill rationale
  in doc 01).
- Everything that carries an `available_time` satisfies the structural
  `Observable` contract and is policed by the SAME predicate: raw events,
  derived features, aggregates, labels, cached data.

API:

| Export | Purpose |
|---|---|
| `isVisibleAt(observation, at)` | the boundary predicate |
| `observableAt(observations, at)` | the observable subset at an instant |
| `createVisibilityFilter(clock)` | bound filter: `isVisible`, `filter`, `withheld` (complement), over the clock's `now` |

## The derived-state rule

Derived features, aggregates, labels and cached data must carry their own
availability contract — `DerivedAvailability`:

| Field | Semantics |
|---|---|
| `available_time` | = **latest input availability + computation delay** (`derivedAvailableTime(inputs, policy)` computes it) |
| `derived_from` | ids of the input events/artifacts (lineage; non-empty required) |
| `computation` | `{ transform_id, delay }` — the transform identity and its non-negative publication/computation latency |

Examples:

- A 1-minute VWAP feature over trades with last input available at 12:01:00.250
  and a 250 ms aggregation delay is available at 12:01:00.500.
- A forward-return label over an event at T with horizon 5m is available at
  T + 5m — labels about the future are themselves future observations, and the
  firewall polices them identically.

`validateDerivedAvailability(inputs, artifact)` rejects any derived artifact
whose `available_time` precedes its latest input (`derived_before_inputs`) —
this is the firewall's uniform policing of derived state. A clean
`leakageCheck` (below) plus per-artifact validation closes the loop.

## The leakage contract

`leakageCheck(trajectory)` audits a RECORDED trajectory — a list of samples
`{ clock, observed, label? }` — and reports:

| Finding | Meaning |
|---|---|
| `future_observation` | an observation with `available_time > clock.now` was in a sample's observed set; carries `leadMs` (how far into the future), indices and label |
| `clock_regression` | the trajectory recording itself moved backwards (invalidates any exoneration) |

The report is `{ clean, findings, samplesChecked, observationsChecked }`.
This is the forensic instrument for L4: agent trajectories, feature-pipeline
audits and cache audits all reduce to "run the trajectory through
`leakageCheck` and demand `clean === true`".

## Time arithmetic discipline

- Timestamps are epoch milliseconds, integers, `[0, 8_639_999_999_999_999]`.
- The only way to obtain a `TimestampMs` is a validating constructor
  (`timestampMs`, `fromIso`, `requireTimestampMs` for trusted literals) —
  unvalidated numbers cannot enter the time domain.
- **All comparisons go through the engine** (`compareTimestamps`, `isBefore`,
  `isAfter`, `isBeforeOrEqual`, `isAfterOrEqual`) — consumer code never
  sprinkles raw relational operators over timestamps.
- Offsets use `Duration` objects (`{ minutes: 5 }`, `{ hours: 1, minutes: 30 }`;
  fractional components allowed; components non-negative) via
  `advanceClockBy` / `derivedAvailableTime`.
- Historical anchoring: `anchorAt(epochMs)` / `anchorFromIso(strictIso)`; a
  clock's `asOf` IS the historical anchor of a run.
- ISO parsing is STRICT: zoned date-times require `Z` or `±HH:MM` (naive
  date-times are rejected as ambiguous instants); date-only forms are UTC
  midnight.
- Sub-millisecond ordering is NOT representable in timestamps — it is the
  `sequence` field's job (doc 02).
