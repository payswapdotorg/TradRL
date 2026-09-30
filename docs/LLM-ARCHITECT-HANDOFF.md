# TradRL — LLM Architect / Tech Lead Handoff

## Mission
You are the successor LLM Architect, Tech Lead, orchestration, review and verification authority for payswapdotorg/TradRL.
You must implement the complete product without relying on conversation history.

## Current repository state
- Default branch: main
- State: 34/50 Work Orders merged; wave-26 disaster-recovery re-dispatch in progress
- Main latest audited commit: b21c97f7a7d11a3c5034cd75ff67f2bc5b1f81d0
- Current authorized Work Orders: T030, T031, T043
- Active workers: 3
- In-flight: T030 (shadow trading), T031 (search integrity), T043 (observability/audit)
- Completed set: T001-T029 and T036-T040
- Blocked frontier: T032-T035 and T041-T050
- Blocked: none
- Maximum concurrent workers: 3
- Arena core dependency: forbidden

## Critical product law
TradRL is standalone. The native learning loop must work with Arena absent.
Arena is an optional capability provider for human expertise.

Native loop: Market experience -> trajectory -> evaluation -> failure analysis -> autonomous learning -> new Body Version.
Human augmentation: Capability Gap -> provider -> Arena/expert -> artifact -> local validation -> reusable local capability.

## Read first
AGENTS.md, AI_CONTINUATION.md, spec/PROJECT-STATE.md, spec/ARCHITECTURE.md, spec/ARCHITECTURE-LOCK.md, spec/REQUIREMENTS.md, spec/DOMAIN-MODEL.md, spec/LEARNING-LOOP.md, spec/EVALUATION-PROTOCOL.md, spec/ADAPTERS.md, spec/SECURITY.md, spec/UX.md, spec/COMPETITIVE-ADOPTION.md, spec/WORK-ITEMS.md, spec/DEPENDENCY-GRAPH.md, spec/WORKER-RUNBOOK.md.

## Architecture
Build around Goal, ConstraintSet, Project, AgentBody, BodyVersion, CognitiveSubstrate, Possession, AgentInstance, Team, MarketEvent, SimulationClock, MarketWorld, Experiment, Trajectory, Evaluation, Outcome, CapabilityGap and FirmMemory.

Agent Body is model-independent and immutable by version. Models possess bodies.

The Agent OS has a small stable kernel: SPAWN, TERMINATE, DELEGATE, REQUEST, PUBLISH, SUBSCRIBE, CHALLENGE, PROPOSE, APPROVE, EXECUTE, ESCALATE, OBSERVE, LEARN, REPORT.

The Organization Compiler discovers agent count, specializations, body/model assignments, communication topology, training allocation, cadence and adversarial population.

## Market World
Do not build a candle-only backtester. Implement exact replay, reactive replay and counterfactual/generative modes with explicit provenance.

Execution fidelity must model relevant order-book/exchange behavior, fees, latency, fills, slippage and market impact or declare limitations.

## Time Machine
Track event time, source time where known, availability time and ingestion time. An agent may only observe information available at its simulation time. Derived features are subject to the same firewall.

## Learning
Use RL where appropriate, but allow offline RL, supervised learning, imitation, preference optimization, bandits, self-play, adversarial training, population search and statistical/causal methods.

Separate strategic decisions from low-latency execution.

## Evaluation
Never accept the best backtest found during search as sufficient evidence. Preserve search history and use blind/unseen, walk-forward, regime, cost, latency, adversarial, organization-ablation and model-substitution evaluation where appropriate.

Release is based on objective and constraint attainment, not raw PnL alone.

## Safety
Risk, authorization, venue permissions, limits, kill switches, credential isolation and audit are enforced outside model prompts.

## Firm Brain
Each tenant accumulates project research, decisions, strategies, policies, trajectories, post-mortems, bodies, capability gaps and outcomes. Cross-tenant reuse is prohibited by default.

## Product strategy
The primary adoption target is main-interface usage. Users may keep Bloomberg/LSEG/FactSet/TradingView/QuantConnect/TT/IBKR/internal systems underneath TradRL while TradRL becomes their project/research/decision interface.

## Work program
T001-T050 in spec/WORK-ITEMS.md are authoritative. Readiness is derived from spec/DEPENDENCY-GRAPH.md and merged state.

## Current wave
T030, T031 and T043 are the active re-dispatch after two sandbox wipes. T030/T043 are re-entry from surviving GitHub branches; T031 is a fresh dispatch from b604e49. The dispatched packet is the contract of record.

The next frontier must be recomputed only after these lanes merge or are otherwise explicitly resolved.

## Orchestration
At most 3 workers. One Work Order per branch and PR. Freeze write surfaces. Record base SHA. Reconcile actual diffs and evidence. Merge only after acceptance. Update project state after every accepted wave.

## Final verification
Before v1 completion, prove standalone operation with Arena unavailable, point-in-time leakage resistance, replay determinism, realistic simulation boundaries, risk/execution gates, tenant isolation, search-lineage integrity, unseen/stress/adversarial evaluation, body/model compatibility, shadow/live separation and the end-to-end Project workflow.