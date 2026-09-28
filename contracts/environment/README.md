# Environment Contracts

**Owning Work Order: T005** · Status: authoritative · Implementation: `packages/environment-protocol`, `services/environment-runner`

These documents are the human-readable AUTHORITY for the environment
protocol — the mediating contract between an AgentInstance runtime and a
MarketWorld under a SimulationClock. They bind four downstream consumers:

| Consumer | What it takes from here |
|---|---|
| **T009** — historical replay World | the `Environment` interface, the observation envelope, the step protocol, the StubEnvironment composition template |
| **T010** — exchange/order-book simulation | the action intake rules (validation only, no authority), latency/fee policy references, the `Environment` interface |
| **T013** — RL interface/trainer bridge | the step trace shape, the RewardSignal contract (attach reward functions without hardcoded PnL), the deterministic episode id |
| **T014** — distributed episode generation | the canonical spec form, the JSON-serializable trace, the determinism law (spec + seed + policy → identical trace) |

Reading order:

1. [01-environment-protocol.md](01-environment-protocol.md) — ids, profile,
   spec, observation/action/reward envelopes, the episode state, the step
   protocol, the store and the `Environment` interface.
2. [02-episode-runner.md](02-episode-runner.md) — the reference runner, the
   pluggable policy, the step trace, the determinism contract, and the
   StubEnvironment template.

## Normative summary (the ten laws of this contract)

1. The environment mediates ALL observation delivery; an agent sees nothing
   except `Observation` envelopes handed through the boundary.
2. An observation is visible at `at` iff `available_time <= at` —
   **inclusive**, no exceptions, same rule for primitive and derived
   observations, historical, simulated and generated alike (L4).
3. Observation validation is timeless: future-dated availability is VALID
   (embargo); withholding is the boundary's job, never the validator's.
4. Actions are REQUESTS, never commands: `submit` performs envelope,
   causality and sequence validation only — execution authority lives
   outside the environment and outside prompts (L8).
5. `submitted_at <= now` at accept time — the causal mirror of the
   inclusive boundary; `client_sequence` is strictly increasing per actor.
6. The three fidelity modes (`exact_replay`, `reactive_replay`,
   `generative`) are DISTINCT and never aliased (L5); a profile's fidelity
   MUST equal its clock's fidelity.
7. An `EnvironmentSpec` (profile + world ref + policy) plus the seed fully
   determines the observation/action stream given the same inputs; equal
   specs derive equal episode ids (L9).
8. Reward signals are optional, explicit and never fabricated; the protocol
   computes no rewards and never interprets a metric as PnL (L7).
9. Episode states are immutable, deeply frozen, JSON-serializable values;
   every transition returns a new state (L3 discipline).
10. Cross-lane entities (agents, venues, instruments, worlds) are referenced
    only through opaque branded string ids; `TimestampMs` and the clock
    shape are structural mirrors of `@tradrl/time-engine`, policed by an
    interop trip-wire test (D-003/D-004 mirror discipline).
