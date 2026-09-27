# TradRL Domain Model

## Goal
Objective, horizon, success criteria, constraints, allowed markets/data/actions and risk policy.

## ConstraintSet
Versioned executable predicates and limits over observations, state, actions and outcomes.

## Project
Durable unit connecting goal, constraints, market/data universe, organization, experiments, decisions, execution, outcomes and lessons.

## AgentBody / BodyVersion
Persistent capability composition; immutable version; independent of model.

## CognitiveSubstrate
Provider/model runtime used to possess a body.

## Possession
BodyVersion + CognitiveSubstrate + adapter + runtime profile + environment profile + policy bundle.

## AgentInstance
A possession operating for a project with authority scope, parent/manager and runtime state.

## Team / TeamPolicy
Agent instances plus topology, communication, delegation, resource budgets and decision cadence.

## MarketEvent
Event id, venue, instrument, asset class, event type, event time, source time where known, available time, ingestion time, sequence, provider, provenance and payload.

## SimulationClock
Now, asOf, playback speed, information policy and fidelity mode.

## MarketWorld
Market state, exchanges, books, market population, external flow, internal agents, latency, fees, slippage, impact and seed.

## Experiment
Hypothesis, intervention, comparison, splits, candidate organization, bodies/substrates, datasets, environment configuration and evaluator version.

## Trajectory
Ordered observations, actions, events, rewards and tool outcomes with lineage.

## Evaluation
Metric definitions, population, period, universe, costs, market model, versions, result distribution and limitations.

## Outcome
Prediction/decision/execution linked to realized result and post-mortem.

## CapabilityGap
Persistent failure or missing capability with evidence, attempted resolutions and status.

## FirmMemory
Tenant-scoped durable institutional knowledge with provenance and retention policy.

## EvidenceCapsule
Point-in-time evidence, provenance, role summaries, alternatives, simulation evidence, failures, risk checks, decision, confidence and artifact ids.