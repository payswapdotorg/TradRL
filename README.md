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