# @tradrl/environment-runner

**Owning Work Order: T005** (frozen write surface: `services/environment-runner`)

The deterministic reference EpisodeRunner: drives any `EnvironmentSpec`
through a complete episode under a pluggable PURE policy and records the
full JSON-serializable step trace. Ships the in-memory `StubEnvironment` —
the composition template for T009 (historical replay) and T010 (exchange
simulation) implementers.

Human-readable contract authority:
[`contracts/environment/02-episode-runner.md`](../../contracts/environment/02-episode-runner.md).

## Surface

- **Runner** — `runEpisode(environment, spec, policy, options)`:
  `start -> [observe -> policy -> submit -> advance]* -> finish`, with
  `completed` at asOf and `step_limit` under a tight budget; rejected
  submissions are recorded, not fatal.
- **Policy** — a pure function `observations -> proposals`
  (`PolicyInput`, `PolicyProposal`); the runner mints deterministic action
  envelopes (`payload = { kind, body }` convention).
- **Trace** — `EpisodeTrace` / `StepRecord` / `Rejection` (deeply frozen,
  JSON round-trips through their guards); `serializeTrace` for
  byte-comparison and transport.
- **Determinism (L9)** — same spec + seed + policy over fresh environment
  instances → byte-identical traces, twice (proven by tests, including the
  converses: different seed/policy → different trace).
- **StubEnvironment** — `createStubEnvironment()`: an `EpisodeStore` plus
  seeded world dynamics (ticks, derived means with computation delay,
  action-result observations with 1 ms latency, `stub-tick` reward
  signals).
- **Seeded randomness** — `createSeededRandom` (sequential) and
  `seededDraw` (stateless, order-independent).

## Dependencies

Zero runtime dependencies. The service consumes its own lane's contract
package `@tradrl/environment-protocol` via a relative source import — the
frozen workspace lockfile admits no new package dependency edges on this
branch; linking the workspace packages is a merge-time concern.
