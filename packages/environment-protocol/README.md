# @tradrl/environment-protocol

**Owning Work Order: T005** (frozen write surface: `packages/environment-protocol`)

The mediating contract between an AgentInstance runtime and a MarketWorld
under a SimulationClock: `EnvironmentProfile` / `EnvironmentSpec`, the
observation and action envelopes, the point-in-time episode step protocol,
the id-keyed `EpisodeStore`, and the `Environment` interface T009/T010
implement (spec/DOMAIN-MODEL.md: Possession's "environment profile",
AgentInstance, SimulationClock, MarketWorld, Trajectory).

Human-readable contract authority:
[`contracts/environment/`](../../contracts/environment/) — especially the
[protocol](../../contracts/environment/01-environment-protocol.md) and the
[runner](../../contracts/environment/02-episode-runner.md) documents.

## Surface

- **Specs** — `EnvironmentProfile` (fidelity mode, `ClockConfig` mirror,
  opaque `Seed`, venue/instrument scope by opaque ids, latency/fee policy
  refs) and `EnvironmentSpec` (profile + `WorldRef` + information policy)
  with collect-all validators and total guards; `canonicalSpecJson` and
  `deriveEpisodeId` make lineage reproducible (L9).
- **Observation envelope** — opaque JSON payload + `available_time`
  (the L4 input) + venue/instrument refs + provenance summary
  (`historical | simulated | generated`). The inclusive boundary
  (`isObservationVisible`, `visibleObservationsAt`,
  `withheldObservationsAt`) polices ALL delivery; validation is timeless
  (embargo is representable).
- **Action envelope** — requests, never authority (L8): actor, `submitted_at`
  (causal law `submitted_at <= now` at accept time), strictly-increasing
  per-actor `client_sequence`, opaque payload.
- **RewardSignal** — optional, explicit, never fabricated; `available_time
  >= at` enforced; same inclusive boundary.
- **Step protocol** — `startEpisode`, `emitObservations`,
  `emitRewardSignals`, `observeEpisode` (pure Time-Machine query),
  `submitAction` (validation only), `advanceEpisode` (monotonic, `<= asOf`),
  `finishEpisode` (terminal state + immutable `EpisodeResult`). Pure,
  deeply frozen, JSON-serializable value objects; transitions return new
  state.
- **Mediation** — `createEpisodeStore` (id-keyed shell, `unknown_episode`)
  and the `Environment` interface with `isEnvironment`.
- **Errors** — `EnvResult` with a closed `EnvErrorCode` taxonomy; validators
  collect ALL violations with dotted paths.

## Dependencies

Zero runtime dependencies — types, schemas and pure functions only.
`TimestampMs`, `FidelityMode`, `InformationPolicy` and `ClockConfig` are
STRUCTURAL MIRRORS of `@tradrl/time-engine` (the canonical owner);
`src/interop.test.ts` is the trip wire that fails if the declarations drift.
See `src/timestamp.ts` and `src/clock.ts` for the mirror discipline.
