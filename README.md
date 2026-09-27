# TradRL

Autonomous trading research, simulation, learning and operations platform.

## Core thesis
A trading agent is a persistent Agent Body possessed by a Cognitive Substrate and operating inside a Market World.

Agent Instance = Body Version + Cognitive Substrate + Possession + Environment + Runtime State.

## Product loop
Goal + Constraints -> Organization Compiler -> Agent Bodies/Team -> Market World -> Research/RL/Search -> Strategy/Portfolio/Risk -> Execution -> Outcome -> Firm Brain -> Capability Improvement.

## Market World
1. Exact historical replay.
2. Reactive replay with endogenous participants.
3. Counterfactual/generative simulation.

The first-class Time Machine reconstructs the state and information actually available at the selected simulation time.

## Standalone learning
TradRL must learn, evaluate and improve without Arena.
Arena is an optional human-expertise provider. Human-derived artifacts are locally versioned and validated; core runtime must not depend on Arena.

## Adoption strategy
TradRL should become the main human interface before demanding replacement of incumbent data, research, OMS/EMS or broker infrastructure.

## Source of truth
Repository documents are authoritative. Start at AGENTS.md and follow the recovery order.
## Development

Toolchain: pnpm@10.34.5 workspaces, TypeScript (strict), vitest, Node 22.

```bash
pnpm install            # install dev toolchain (root only; contract packages are dependency-free)
pnpm verify             # typecheck + tests + program-state check + governance self-test
pnpm typecheck          # tsc --noEmit across the workspace
pnpm test               # vitest across the workspace
pnpm program:check      # validate program/graph.json against spec/WORK-ITEMS.md + spec/DEPENDENCY-GRAPH.md
pnpm program:frontier   # print work orders eligible for dispatch right now
```

### Repository layout

| Path | Purpose |
|---|---|
| `spec/` | Authoritative specifications and governance (markdown). `DEPENDENCY-GRAPH.md` is the readiness authority. |
| `program/graph.json` | Machine-checkable program state: per-Work-Order status, branch, PR, merged SHA, evidence. Validated in CI. |
| `scripts/` | Governance and program-state tooling (zero-dependency Node). |
| `packages/` | Contract and library packages (`domain-core`, `agent-body`, `market-protocol`, `time-engine`, …). |
| `services/`, `adapters/`, `apps/`, `bodies/` | Runtime services, provider adapters, console app and agent bodies (created by their Work Orders). |
| `docs/` | Handoff, quickstart, ADRs. |

### Work Orders

Work happens as Work Orders `T001`–`T050` (see `spec/WORK-ITEMS.md`): one branch
(`work/TNNN-slug`), one PR, one worker, one frozen write surface. The Tech Lead
dispatches at most 3 concurrent Work Orders with pairwise-disjoint surfaces,
verifies evidence against the actual diff, merges, and records the merged SHA in
`program/graph.json` and `spec/PROJECT-STATE.md`.
