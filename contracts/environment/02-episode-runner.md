# 02 — The Episode Runner and the StubEnvironment

Implementation: `@tradrl/environment-runner` (`services/environment-runner`).
This document is the authority for the reference episode runner, the
pluggable policy contract, the step trace, the determinism contract, and
the in-memory stub world that serves as the composition template for T009
(historical replay) and T010 (exchange simulation).

## The Policy

A Policy is a PURE function from the agent's information set to action
proposals — the work order's `observations -> actions`:

```ts
type Policy = (input: PolicyInput) => readonly PolicyProposal[];

interface PolicyInput {
  readonly episode_id: EpisodeId;   // the episode being driven
  readonly step: number;            // 1-based step number
  readonly now: TimestampMs;        // the instant the step observes at
  readonly observations: readonly Observation[];  // FULL visible set at `now`
}

interface PolicyProposal {
  readonly kind: string;    // opaque label, e.g. 'adjust'
  readonly payload: JsonValue;  // opaque request payload
}
```

Guards: `isPolicyInput`, `isPolicyProposal`, `isPolicy`. The policy
receives the FULL visible observation set (the agent's whole point-in-time
information set); policies that want a window or projection filter
themselves — filtering IS a policy decision. The runner mints the action
envelopes; the environment decides. Nothing here grants authority (L8).

**Action payload convention:** the reference runner mints
`payload = { kind, body }` from each proposal. World implementers decode
action requests against this convention (or define their own and drive
with their own runner — the protocol does not care).

## The runner

```ts
function runEpisode(
  environment: Environment,
  spec: EnvironmentSpec,
  policy: Policy,
  options: RunOptions,
): EnvResult<EpisodeTrace>;

interface RunOptions {
  readonly actor: AgentInstanceId;  // the agent the runner submits as
  readonly step_ms: number;         // clock advance per step (clamped to asOf)
  readonly max_steps: number;       // step budget (safety limit)
}
```

`isRunOptions` is the guard; invalid options fail with typed
`invalid_field` errors before anything starts. The drive loop:

```
start -> [ observe(at=now) -> policy -> submit each -> advance ]* -> finish
```

1. **observe** at the step's `now` — the environment polices the inclusive
   L4 boundary.
2. **policy** over the full visible set; malformed proposals abort the run
   (`invalid_action`) — a broken policy is a caller bug, not an episode event.
3. **submit** each minted action. Rejected submissions are RECORDED and the
   episode continues (a rejected request is a legitimate episode event, not
   a runner error). Action ids are minted deterministically:
   `<episode_id>-a<n>` with a monotonic counter; `submitted_at` is the
   step's `now`; `client_sequence` is the actor's next ordinal.
4. **advance** to `min(now + step_ms, asOf)` — monotonic, `<= asOf` by
   protocol.
5. **finish** with `completed` when the clock reaches `asOf` (a zero-length
   episode finishes immediately with zero steps), or `step_limit` when the
   budget is exhausted first. If the environment itself finished the
   episode `terminal`, the runner surfaces that result.

Environment failures (start/observe/advance failures) abort the run and
return the typed errors unchanged.

## The step trace

The `EpisodeTrace` is the durable, JSON-serializable record (the shape T011
persists, T013 consumes, T014 ships across processes):

```ts
interface EpisodeTrace {
  readonly spec: EnvironmentSpec;        // L9 lineage binding
  readonly episode_id: EpisodeId;        // deterministically derived
  readonly steps: readonly StepRecord[];
  readonly result: EpisodeResult;        // termination + counts + rewards
}

interface StepRecord {
  readonly step: number;                 // 1-based
  readonly at: TimestampMs;              // clock now at step start
  readonly observations: readonly Observation[];  // DELIVERED this step (delta by id)
  readonly actions: readonly Action[];   // accepted this step, in order
  readonly rejections: readonly Rejection[];      // rejected requests + typed errors
  readonly advanced_to: TimestampMs;     // clock now after the advance
  readonly rewards: readonly RewardSignal[];      // emitted during this step
}

interface Rejection {
  readonly action: Action;               // the minted request that was rejected
  readonly errors: readonly EnvError[];  // the environment's typed errors
}
```

`observations` is the DELTA — the visible set at `at` minus everything
already delivered by earlier steps (by `observation_id`), so backfilled
data appears in the step where it first became visible and no observation
is recorded twice. `rewards` are the signals the world emitted during the
step; each carries its own `available_time`, and consumers apply the same
inclusive boundary to them (L4 polices rewards identically).

Guards and constructors: `isRejection`, `isStepRecord`, `isEpisodeTrace`,
`makeStepRecord`, `makeEpisodeTrace`, and `serializeTrace` (JSON; equal
traces serialize to identical bytes — the determinism proof compares
these).

## The determinism contract (L9)

> Same `EnvironmentSpec` (including the seed) + same policy + same options,
> over fresh environment instances → **byte-identical** step traces
> (`JSON.stringify` equality), twice.

The runner contributes only deterministic values (minted ids, `submitted_at`
= step `now`, termination details derived from the recorded run). All
nondeterminism belongs to the environment — and the environment is seeded
by the spec. The acceptance test also proves the converses: a different
seed produces a different trace; a different policy produces a different
trace (actions feed back into reactive worlds).

## The StubEnvironment (composition template)

`createStubEnvironment(): Environment` — a tiny in-memory world over an
`EpisodeStore`, and the READ-ME-FIRST recipe for T009/T010:

1. **Keep an `EpisodeStore`** — it owns ALL protocol bookkeeping: episode
   lifecycle, the inclusive visibility boundary, action validation, clock
   monotonicity, unknown-episode policing.
2. **Add world dynamics around the store's transitions**, derived from the
   spec's SEED — never from wall clocks, RNG globals or unordered state.
   The stub's synthetic stream per advance to `to`:
   - one `tick-<n>` observation available exactly at `to`, value drawn
     statelessly from `(seed, episode, tick-index)` — order-independent
     determinism;
   - every second tick, a DERIVED `mean-<n>` observation over the last two
     ticks (`derived_from: [tick-(n-1), tick-n]`), available at `to + 1 ms`
     — a computation delay, so derived visibility demonstrably lags its
     inputs;
   - one `stub-tick` reward signal per tick (metric named, value seeded,
     available at `to`).
3. **Turn accepted actions into RESULT observations**: per accepted action
   the stub emits `<action_id>:result` — a derived observation
   (`derived_from: [action_id]`) with payload `{ accepted: true, kind }`,
   available at `submitted_at + STUB_RESULT_LATENCY_MS` (1 ms). Results are
   REPORTS riding the observation channel; the environment never executes
   or authorizes (L8).

Per-episode state (tick counters) is keyed by episode id; one stub instance
may mediate many episodes without interference. Seeded randomness:
`createSeededRandom(seed)` (sequential mulberry32 keyed by an FNV-1a hash)
and `seededDraw(seed, scope, index)` (stateless single draw) — both
deterministic, zero-dependency, no wall clock. The service's `packageInfo`
record names the owning Work Order; `SeededRandom` is the generator type.

## What downstream work orders take from here

| Consumer | Takes |
|---|---|
| T009 | implement `Environment` over the replay dataset: the store pattern + deterministic emission of historical observations (available_time from the dataset's distribution semantics) |
| T010 | implement `Environment` with exchange dynamics: action payload decoding, latency/fee policy application (the opaque policy refs resolve here), fills as derived result observations |
| T013 | consume `EpisodeTrace` (JSON round-trips through `isEpisodeTrace`); attach reward functions to observations/actions/rewards — the protocol imposes no reward semantics |
| T014 | shard by `deriveEpisodeId`/`canonicalSpecJson`; ship traces across processes (everything is JSON-safe and deeply frozen) |
