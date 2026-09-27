# ADR-0001 — Standalone Learning, Optional Arena

## Decision
TradRL core learns from its own environment and market outcomes. Arena is an optional human-expertise provider.

## Why
The product must remain capable even when qualified human experts or Arena are unavailable. Human expertise is used to unlock or accelerate persistent capability gaps.

## Consequences
- no core package depends on Arena;
- Arena integration sits behind a provider-neutral interface;
- imported expert artifacts become locally versioned and validated;
- CI and end-to-end tests must include Arena-unavailable mode.