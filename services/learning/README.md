# @tradrl/learning — the RL interface/trainer bridge service (T013)

**Owning Work Order: T013** · Status: implemented (reference trainer only) ·
Contract package: [`packages/rl-protocol`](../../packages/rl-protocol) ·
Depends on (merged): T005 (environment-protocol), T009 (market-world replay),
T010 (exchange-sim), T011 (trajectory/experiments), T012 (evaluation/verification)

The bridge is the LEARNING-LOOP's missing protocol layer (spec/LEARNING-LOOP.md:
"training -> trajectory -> evaluation -> verification"): learning methods consume
TradRL environments and produce evidence **without any method-specific coupling
leaking into the environment lane, and without reward fabrication corrupting
acceptance**. This service is the reference implementation over the contract
package — pure data + pure functions over injected ports; **no ML libraries, no
network, no I/O; NO concrete RL algorithms** (external engines own those; T014
distributes episode generation and T015 adds curriculum/self-play/populations on
top of the same contract).

```
TrainingRunDeclaration (method, spec mirror, reward-model refs, budget, seed,
        tenant/project — L12)                 packages/rl-protocol
        │ prepareRun
        ▼
ReferenceTrainer ── driveEpisode ──► EpisodeDriver ── five operations ──► EnvironmentPort
        │                                (L4 gate, L8 intents,         (INJECTED: replay world,
        │                                 budget law, determinism)      exchange sim, fixtures,
        │                                                              external engines)
        │ record: append-only run state + FNV-1a digest step chain
        ▼
episodeTrajectory ──► canonical Trajectory (T011 mirror) ──► annotateEpisode
        │                                                     (RewardModels, post-hoc — L7:
        │                                                      every signal carries its ref)
        ▼
collectTrial ──► TrainerTrial (experiments-lane TrialRecord mirror + the full
        │          L9 lineage: run, method, tenant/project, trajectory, env
        │          config, reward-model refs, WORLD record: config hash,
        │          chain head, spec hash, digest)
        ▼
TrialLog (append-only — L11: duplicate/rewrite = typed trial_rewrite)
```

## The laws this service demonstrates

- **L4 (point-in-time)** — the scripted policy conditions ONLY on observation
  refs + availability; the driver refuses future-dated deliveries
  (`l4_boundary_violation`) and queries beyond `now` (`observation_beyond_now`).
- **L7 (rewards are data, never sole criterion)** — the world channel is
  untouched; the bridge's own rewards are explicit RewardModel declarations
  applied POST-HOC to the RECORDED trajectory, every signal carrying its
  `RewardModelRef`, acceptance owned by evaluation (T012).
- **L8 (requests, never authority)** — actions are intents through the port;
  rejections are records.
- **L9 (reproducible lineage)** — same (world script, seed, policy) →
  byte-identical run states (tested); the run binds the digest step chain; the
  trial binds the world's run record fields T011/T012 bind too.
- **L11 (search integrity)** — the trial log is append-only with unique ids;
  failures are records (`failure_reason`), never exceptions.
- **L12 (tenant isolation)** — the declaration and lineage carry tenant +
  project; missing values fail the guards.
- **No ambient clock** — `Date.now()` never appears; every instant is an
  explicit parameter (byte-determinism of serialization).

## The replay consumption contract (services/market-world/README.md, T013 row)

`src/rl/replay-adapter.ts` mirrors the `ReplayWorldService` STRUCTURALLY (no
import) and `driveReplayEpisodeWithTrainer` runs the whole flow:

```ts
const bridged = await driveReplayEpisodeWithTrainer({
  service,                        // the REAL ReplayWorldService (untrusted port)
  trainer,                        // createReferenceTrainer({...})
  run,                            // trainer.prepareRun(declaration)
  policy,                         // createScriptedPolicy(seed)
});
// bridged.run           — the run with the episode recorded (chain folded)
// bridged.world_lineage — { config_hash, chain_head, spec_hash, digest } (L9)
// then: trainer.annotateEpisode(run, episode, [rewardModels])  — L7 post-hoc
//       finishTrainingRun(run, reason)
//       trainer.collectTrial(run, { ..., world_record: bridged.world_record })
```

The replay world emits ZERO reward signals by design — the bridge attaches ITS
OWN reward functions to the recorded trajectory. `replay-adapter.test.ts` runs
this against the REAL `createReplayWorldService` + fixture stream.

## The fixtures (no world implementation imported)

`src/rl/fixtures.ts` ships a scripted world satisfying
environment-protocol's `Environment` surface STRUCTURALLY (proven by the REAL
`isEnvironment` guard in trainer.test.ts), a scripted policy port
(`src/rl/policy.ts`), deterministic reward models + the rogue undeclared-input
instrument (`src/rl/reward-models.ts`) — enough to drive full episodes
end-to-end in tests WITHOUT importing any world lane.

## Run-state resume

`serializeTrainingRunState` / `resumeTrainingRunState` (`src/rl/run-state.ts`):
canonical JSON bytes, schema-marked; resume re-validates the state through the
protocol guard and VERIFIES THE STEP CHAIN — tampered content fails
`chain_mismatch`, never silently. A resumed run provably consumed the same
experience and continues appending onto the verified log.

## Package layout

```
services/learning/
  src/
    index.ts              the facade (re-exports src/rl/)
    rl/
      trainer.ts          the reference deterministic trainer (TrainerContract)
      policy.ts           the scripted policy port
      fixtures.ts         the scripted fixture world (structurally an Environment)
      reward-models.ts    deterministic reward models + the rogue instrument
      run-state.ts        serialize / resumeTrainingRunState (chain verification)
      replay-adapter.ts   the thin ReplayWorldService structural adapter
```

The LAWS live in the contract package `packages/rl-protocol` (zero runtime
dependencies, hand-rolled total guards, deepFreeze, typed error taxonomy,
mirrors + trip-wire interop tests against the REAL trajectory/experiments/
environment-protocol packages present on the branch).

## Import note (for the Tech Lead)

This service imports its contract package by RELATIVE path
(`../../../../packages/rl-protocol/src/index`) — the frozen write surface
permits no lockfile-touching workspace edge. Convert to `workspace:*` at the
next serialized lockfile change (the market-world service documents the same
discipline).
