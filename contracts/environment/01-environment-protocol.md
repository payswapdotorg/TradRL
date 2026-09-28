# 01 — The Environment Protocol

Implementation: `@tradrl/environment-protocol` (`packages/environment-protocol`).
This document is the authority for the mediating contract between an
AgentInstance runtime and a MarketWorld under a SimulationClock
(spec/ARCHITECTURE.md "Market World", spec/DOMAIN-MODEL.md: Possession's
"environment profile", AgentInstance, SimulationClock, MarketWorld,
Trajectory).

## The mirror discipline (cross-lane law D-003/D-004)

The canonical time domain lives in `@tradrl/time-engine`. The frozen
workspace lockfile forbids package dependencies between contract packages,
so this package re-declares the shared shapes as STRUCTURAL MIRRORS:

| Mirror | Canonical owner | Trip wire |
|---|---|---|
| `TimestampMs` (`number & brand`), `MIN_TIMESTAMP_MS`, `MAX_TIMESTAMP_MS`, `isTimestampMs`, `timestampMs`, `requireTimestampMs` | time-engine `timestamp.ts` | `packages/environment-protocol/src/interop.test.ts`: constants parity, guard behavioral parity (in-range accepted, out-of-range rejected), two-way type-level assignability |
| `FidelityMode`, `FIDELITY_MODES`, `isFidelityMode` | time-engine `clock.ts` | same test: union parity, no aliasing |
| `InformationPolicy` (`'point-in-time'`), `isInformationPolicy` | time-engine `clock.ts` | same test |
| `ClockConfig` | time-engine `SimulationClock` | same test: an engine-constructed clock passes `isClockConfig` and `validateClockConfig`; a protocol config is assignable to `SimulationClock` |

`ClockConfig` is the INITIAL clock state recorded in a profile — the only
deliberate semantic difference from a live `SimulationClock`. Episode
progression is explicit (`advanceEpisode`); `paused` governs any runtime
auto-driver exactly as in time-engine. Constructors: `createClockConfig`
(defaults: `now = asOf`, speed 1, unpaused — the engine's defaults) and
`validateClockConfig` (collect-all over untrusted values, deep-freezes). Constructors: `createClockConfig`
(defaults: `now = asOf`, speed 1, unpaused — the engine's defaults) and
`validateClockConfig` (collect-all over untrusted values, deep-freezes).

## Identifiers

Owned by this package (branded, compile-time nominal; opaque non-empty
strings at runtime; obtained via the guards):

| Id | Meaning |
|---|---|
| `EnvironmentId` | identity of an environment profile — the opaque id a Possession references |
| `EpisodeId` | identity of one episode (one run of one spec); derived deterministically (below) |
| `ObservationId` | identity of one observation within an episode (unique per episode) |
| `ActionId` | identity of one action request within an episode |
| `RewardId` | identity of one reward signal within an episode |
| `Seed` | the opaque deterministic seed token of a profile |

Opaque cross-lane references (referents owned by other lanes; never
imported): `AgentInstanceId` (T003 agent lane; brand tag mirrors
domain-core), `VenueId` and `InstrumentId` (T002/T004 market lanes; brand
tags mirror domain-core), `WorldId` (T009/T010 worlds), `LatencyPolicyId`
and `FeePolicyId` (T010 exchange simulation). Each has a total guard
(`isEnvironmentId`, `isEpisodeId`, `isObservationId`, `isActionId`,
`isRewardId`, `isSeed`, `isAgentInstanceId`, `isVenueId`,
`isInstrumentId`, `isWorldId`, `isLatencyPolicyId`, `isFeePolicyId`).

## The EnvironmentProfile

The shape a Possession references by opaque id (spec/DOMAIN-MODEL.md).

| Field | Type | Semantics |
|---|---|---|
| `environment_id` | `EnvironmentId` | profile identity |
| `fidelity` | `FidelityMode` | one of the three DISTINCT L5 modes; MUST equal `clock.fidelity` (validator code `fidelity_mismatch`) |
| `clock` | `ClockConfig` | initial clock state: `now`/`asOf` (invariant `now <= asOf`), positive finite `playbackSpeed`, `paused`, `fidelity`, `informationPolicy` |
| `seed` | `Seed` | opaque non-empty string; interpretation owned by the world; captured for lineage (L9) |
| `venue_scope` | `readonly VenueId[]` | the observation universe by opaque id; may be empty (news/macro-only worlds); ids unique (`invalid_field` on duplicates) |
| `instrument_scope` | `readonly InstrumentId[]` | same discipline as `venue_scope` |
| `latency_policy` | `LatencyPolicyId \| null` | opaque T010 policy ref; `null` = none declared (e.g. pure replay) |
| `fee_policy` | `FeePolicyId \| null` | same |

`validateEnvironmentProfile(value, path?)` collects ALL violations
(`missing_field`, `invalid_field`, `fidelity_mismatch`, `beyond_as_of` from
the nested clock check) and returns the profile deeply frozen;
`isEnvironmentProfile` is the total guard.

## The EnvironmentSpec

Fully determines an environment instance (L9):

| Field | Type | Semantics |
|---|---|---|
| `profile` | `EnvironmentProfile` | as above |
| `world` | `WorldRef` = `{ world_id: WorldId; kind: string }` | opaque world binding; `kind` is an implementation hint owned by world lanes — this package declares NO world taxonomy; guard `isWorldRef` |
| `information_policy` | `InformationPolicy` | `'point-in-time'`; MUST equal `profile.clock.informationPolicy` (validator code `policy_mismatch`) |

`validateEnvironmentSpec` (collect-all, deep-freezes) and `isEnvironmentSpec`
(total guard) are the entry points. A complete, guard-valid example:

```json
{
  "profile": {
    "environment_id": "env-stub-1",
    "fidelity": "reactive_replay",
    "clock": {
      "now": 1000,
      "asOf": 6000,
      "playbackSpeed": 1,
      "paused": false,
      "fidelity": "reactive_replay",
      "informationPolicy": "point-in-time"
    },
    "seed": "seed-alpha-1",
    "venue_scope": ["STUB"],
    "instrument_scope": ["STUB-1"],
    "latency_policy": null,
    "fee_policy": null
  },
  "world": { "world_id": "world-stub", "kind": "stub" },
  "information_policy": "point-in-time"
}
``` A complete, guard-valid example:

```json
{
  "profile": {
    "environment_id": "env-stub-1",
    "fidelity": "reactive_replay",
    "clock": {
      "now": 1000,
      "asOf": 6000,
      "playbackSpeed": 1,
      "paused": false,
      "fidelity": "reactive_replay",
      "informationPolicy": "point-in-time"
    },
    "seed": "seed-alpha-1",
    "venue_scope": ["STUB"],
    "instrument_scope": ["STUB-1"],
    "latency_policy": null,
    "fee_policy": null
  },
  "world": { "world_id": "world-stub", "kind": "stub" },
  "information_policy": "point-in-time"
}
```

### Canonical form and deterministic episode ids

`canonicalJson(value: JsonValue): string` serializes any JSON value with
recursively sorted object keys — equal values produce identical bytes.
`canonicalSpecJson(spec)` builds the canonical tree field-by-field (the
compiler proves JSON-safety; no casts over untrusted shapes).
`deriveEpisodeId(spec)` folds the canonical form with FNV-1a 32-bit into
`ep-<hex8>`: the same spec always yields the same episode id; any field
change (including the seed) yields a different one. 32 bits are
reference-grade; consumers needing stronger collision guarantees mint their
own ids — and then own the determinism argument themselves.

## The Observation envelope

The ONLY thing an environment hands an agent (spec/DOMAIN-MODEL.md:
Trajectory's "ordered observations"):

| Field | Type | Required | Semantics |
|---|---|---|---|
| `observation_id` | `ObservationId` | yes | opaque unique per episode |
| `available_time` | `TimestampMs` | yes | **the earliest an agent may legitimately observe it** — the ONLY timestamp the boundary consults (L4). Future-dating is legal (embargo) |
| `venue` | `VenueId \| null` | yes (nullable) | the venue the observation is about; `null` for non-venue observations |
| `instrument` | `InstrumentId \| null` | yes (nullable) | same discipline |
| `payload` | `JsonValue` | yes | opaque JSON-safe payload; semantics owned by the world and consumers |
| `provenance` | `ObservationProvenance` | yes | summary mirror of market-protocol's provenance (below) |

Unknown/extra fields are TOLERATED (forward-compatible floor).
`validateObservation` collects ALL violations with dotted paths;
`isObservation` is the total guard. Validation is TIMELESS.

### Provenance summary

`ObservationProvenance` mirrors market-protocol's origin trichotomy (L5):
`origin: ObservationOrigin` = `'historical' | 'simulated' | 'generated'`
(`OBSERVATION_ORIGINS`, guard `isObservationOrigin`), a `source`
(`string | null`, REQUIRED for `historical` — no orphan history), and
`derived_from` (lineage ids; non-empty marks a DERIVED observation).
Derived predicates: `observationOrigin`, `isSyntheticObservation`
(`origin !== 'historical'`), `isDerivedObservation` (non-empty lineage).
`validateObservationProvenance(value, observationId, path?)` enforces
no-self-reference and no-duplicate-parents; `isObservationProvenance` is
the structural guard. This is deliberately a SUMMARY:
the full market-event provenance (adapter version, transform) belongs to
the market lane; here `source` names the producer/transformer.

### The L4 boundary (inclusive)

| Export | Purpose |
|---|---|
| `isObservationVisible(observation, at)` | the boundary predicate: `available_time <= at` — visible EXACTLY at the availability instant, never one millisecond earlier |
| `visibleObservationsAt(observations, at)` | the visible subset (order-preserving) |
| `withheldObservationsAt(observations, at)` | the complement — the anti-leakage assertion helper |
| `Available` | the minimal structural contract (any `available_time` carrier) — twin of time-engine's `Observable` |

The boundary has NO origin-awareness and NO derivation-awareness: simulated
and generated observations are withheld exactly like historical ones;
derived observations obey the same law as primitive ones. `observeEpisode`
(see the step protocol) is the only sanctioned delivery path.

## The Action envelope

A REQUEST, never a command (L8 — execution authority is outside model
prompts AND outside this envelope):

| Field | Type | Required | Semantics |
|---|---|---|---|
| `action_id` | `ActionId` | yes | opaque unique per episode |
| `actor` | `AgentInstanceId` | yes | the acting agent instance (opaque; the environment never models actor internals) |
| `submitted_at` | `TimestampMs` | yes | the claimed submission instant; MUST be `<= episode.now` at accept time (causal law, inclusive) |
| `client_sequence` | non-negative safe integer | yes | per-actor, per-episode request ordinal; strictly increasing across the actor's ACCEPTED actions |
| `payload` | `JsonValue` | yes | opaque request payload; results return later as observations |

`validateAction` (collect-all, deep-freezes) and `isAction` (total guard).
Envelope validation is timeless; the causal and sequence rules are enforced
by `submitAction` with codes `action_from_future` and `stale_sequence`.

## The RewardSignal

Optional, explicit, never fabricated:

| Field | Type | Semantics |
|---|---|---|
| `reward_id` | `RewardId` | opaque unique per episode |
| `episode_id` | `EpisodeId` | must match the episode it is emitted into (`reward_episode_mismatch`) |
| `at` | `TimestampMs` | the instant the reward pertains to |
| `available_time` | `TimestampMs` | earliest legitimate observation; MUST be `>= at` (`reward_time_order`); policed by the same inclusive boundary |
| `value` | finite number | may be negative/zero; NEVER interpreted as PnL by this protocol |
| `metric` | string | opaque metric label (e.g. `stub-tick`); consumers attach semantics |
| `source` | string | producing component — no orphan rewards |
| `detail` | `JsonObject \| null` | optional structured detail |

`validateRewardSignal` (collect-all), `isRewardSignal` (guard),
`isRewardVisible(signal, at)` (the inclusive predicate). The protocol
computes NO rewards; RL consumers (T013) attach their own functions to the
recorded trace.

## The episode state and the step protocol

`EpisodeState` is an immutable, deeply frozen, JSON-serializable value:

| Field | Semantics |
|---|---|
| `episode_id` | deterministically derived from the spec (L9) |
| `spec` | the fully-determining spec, bound for lineage |
| `clock` | the current `ClockConfig` (`now` monotonic, `<= asOf`) |
| `status` | `EpisodeStatus` = `'running' \| 'finished'` (`EPISODE_STATUSES`, `isEpisodeStatus`) |
| `termination` | `TerminationReason \| null` — non-null iff finished |
| `pending` | the world's currently-offered observations (future-dated = embargoed) |
| `accepted_actions` | the accepted action log, in acceptance order |
| `rewards` | the emitted reward signals |

`TerminationReason` = `{ code, detail }` with `code: TerminationCode` one of
`TERMINATION_CODES` = `completed | terminal | step_limit | aborted`
(natural end; world terminal state; runtime step budget; external abort)
and a REQUIRED non-empty `detail` — a bare code is not auditable
(`isTerminationReason`, `isTerminationCode`).

The step protocol — pure transitions, every failure a typed `EnvResult`:

| Operation | Rule | Failure codes |
|---|---|---|
| `startEpisode(spec)` | validates the spec; derives the episode id; initial state (empty pending/actions/rewards, clock as configured) | the spec validator's codes |
| `emitObservations(episode, observations)` | world offers data; every envelope validated; ids unique across pending + batch; future-dating legal (embargo), past-dating legal (backfill) | `episode_finished`, `invalid_*` envelope codes, `duplicate_observation` |
| `emitRewardSignals(episode, signals)` | world emits rewards; ids unique; episode must match | `episode_finished`, `invalid_reward`, `reward_episode_mismatch`, `duplicate_reward` |
| `observeEpisode(episode, at)` | PURE query: pending observations visible at `at` (inclusive). `at <= now` required; queries at past instants (Time Machine) and on finished episodes (audit) are legal | `invalid_timestamp`, `observation_beyond_now` |
| `submitAction(episode, action)` | REQUEST intake — validation only: envelope validity, `submitted_at <= now` (inclusive), strictly greater `client_sequence` for the actor. NEVER authority (L8) | `episode_finished`, `invalid_*` envelope codes, `action_from_future`, `stale_sequence` |
| `advanceEpisode(episode, to)` | clock move: `to >= now`, `to <= asOf`; `to == now` is a legal no-op | `episode_finished`, `invalid_timestamp`, `clock_regression`, `beyond_as_of` |
| `finishEpisode(episode, reason)` | terminal transition: returns `EpisodeFinish` = `{ episode, result }` — the finished state (so runtimes police post-finish mutations) plus the immutable `EpisodeResult` | `episode_finished`, `invalid_termination` |

Derived helpers: `actorHighestSequence(episode, actor)` (the actor's last
accepted sequence or `null`) and `visibleRewardsAt(episode, at)` (rewards
visible under the inclusive boundary).

`EpisodeResult` binds lineage for attribution (L9): `episode_id`,
`environment_id`, the full `spec`, `termination`, `final_now`,
`accepted_action_count`, `pending_observation_count`, and the `rewards`
list. Guards: `isEpisodeState`, `isEpisodeResult`, `isEpisodeFinish`.

### The EpisodeStore (id-keyed mediation)

`createEpisodeStore(): EpisodeStore` keys episodes by id and forwards every
step operation — `start`, `emit`, `emitRewards`, `observe`, `submit`,
`advance`, `finish`, plus `get` and the `episodes` registration list. It
adds exactly ONE failure mode: `unknown_episode`. The store owns no world
dynamics — worlds compose it (see the StubEnvironment template in
doc 02). Its registry is runtime state (a Map), never serialized.

### The Environment interface

```ts
interface Environment {
  start(spec: EnvironmentSpec): EnvResult<EpisodeState>;
  observe(episode: EpisodeId, at: TimestampMs): EnvResult<readonly Observation[]>;
  submit(episode: EpisodeId, action: Action): EnvResult<EpisodeState>;
  advance(episode: EpisodeId, to: TimestampMs): EnvResult<EpisodeState>;
  finish(episode: EpisodeId, reason: unknown): EnvResult<EpisodeFinish>;
}
```

This is what T009/T010 implement and the reference runner drives.
`isEnvironment` checks the operation surface. Implementations MUST police
observation delivery with the inclusive boundary, reject clock regressions
and beyond-asOf advances, never grant authority through `submit`, and keep
episode state deterministic given the same spec and inputs (L9).

## Errors, results and the shared primitives

`EnvResult<T>` = `{ ok: true; value: T } | { ok: false; errors:
readonly EnvError[] }` — validators collect ALL violations; transitions
fail with a precise cause. `EnvError` = `{ code, path, message }` with
dotted paths (`profile.clock.asOf`). Constructors: `fail`, `failures`,
`ok`, `missingField`, `invalidField`, `invalidType`. `EnvErrorCode` is the
closed machine-readable taxonomy (see `src/errors.ts` — every code is
documented inline and exercised by a test).

Shared primitives (mirroring the sibling packages' discipline, re-declared
because contract packages never import each other): `isRecord`,
`isNonEmptyString`, `isFiniteNumber`, `isNonNegativeSafeInteger`,
`isPositiveSafeInteger`, `deepFreeze`, `isDeeplyFrozen`, `Brand`, and the
JSON value model `JsonValue`/`JsonObject` with `isJsonValue`/`isJsonObject`
(the standard JSON model — a mirror of market-protocol's that cannot
diverge in semantics). Every constructed value the package returns is
deeply frozen; the `packageInfo` record names the owning Work Order.
