# TradRL Architecture

TradRL is an AI trading operating layer built around adaptive Agent Organizations and a high-fidelity Market World.

## Core flow
User -> Goal/Constraint Compiler -> Organization Compiler -> Agent Bodies/Possessions -> Agent OS -> Market World -> Research/Learning -> Strategy/Portfolio/Risk -> Execution -> Outcome -> Firm Brain -> Capability Improvement.

## Planes
Experience: Project UX, watch mode, Time Machine, evidence and notifications.
Control/organization: Goals, Constraints, Projects, Bodies, Possessions, Instances, Teams and Agent OS.
Data/research: provider adapters, canonical events, point-in-time knowledge and firm knowledge.
Market World: exchange, order book, market population, replay, reactive and generative simulation, latency, fees, slippage and impact.
Learning: RL/offline RL, imitation, supervised learning, preference optimization, bandits, self-play, adversarial training, population search and curriculum.
Execution: risk/authorization gateway, broker/OMS/EMS adapters, audit and shadow/live separation.
Memory/evaluation: trajectories, experiments, evaluation, verification, outcomes, post-mortems, Firm Brain and Body Versions.

## Agent Body
A Body is persistent capability composition containing mission, capabilities, knowledge/tool policy, procedures, planning, delegation, authority/safety boundaries, evaluation/environment requirements and substrate compatibility. Body Versions are immutable.

## Agent OS
Stable kernel: SPAWN, TERMINATE, DELEGATE, REQUEST, PUBLISH, SUBSCRIBE, CHALLENGE, PROPOSE, APPROVE, EXECUTE, ESCALATE, OBSERVE, LEARN, REPORT. Higher-level organization is adaptive.

## Organization compiler
Given goals, constraints, market/data universe and resource budgets, discover agent count, specializations, body/model assignments, communication topology, training allocation, cadence and adversarial population. Optimize objective attainment, risk, compute, coordination cost, latency, robustness and redundancy.

## Market World
Three explicit modes: exact historical replay, reactive replay with endogenous participants, and counterfactual/generative simulation. Synthetic worlds are stress/exploration instruments, not historical truth.

## Time Machine
Track event time, source time when known, availability time and ingestion time. The observation/feature firewall must enforce the simulated information set.

## Evaluation
Acceptance is objective-and-constraint based. Use blind/unseen, walk-forward, regime, cost, latency, adversarial, organization-ablation and model-substitution tests as appropriate. Preserve search history.

## Execution
Consequential actions require hard controls outside prompts: identity, authorization, limits, venue permissions, rate limits, kill switch, credentials and audit.

## Arena
Arena is optional human expertise. The native learning loop must work when Arena is unavailable. Imported expertise is locally versioned and validated.