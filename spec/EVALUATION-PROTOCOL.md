# TradRL Evaluation Protocol

## Evaluation layers
0. Data integrity
1. Functional correctness
2. Historical performance
3. Blind generalization
4. Execution stress
5. Adversarial stress
6. Organization ablation
7. Model substitution
8. Shadow/live evidence

## Integrity
Validate schemas, timestamps, duplicates, provenance, corporate actions, vendor corrections and availability timing.

## Stress
Perturb fees, slippage, latency, fill probability, impact, spread and liquidity.

## Generalization
Use unseen periods, regimes, assets, venues or combinations not optimized against.

## Selection integrity
Retain search histories and distinguish in-search performance from holdout performance. Use walk-forward and purged/embargoed designs where appropriate.

## Acceptance
Every release candidate defines objective success criteria, confidence target, evidence volume, allowed constraint violation rate, blind policy, stress suite and rollback triggers.

Simulation evidence and live evidence are never conflated.