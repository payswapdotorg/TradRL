# TradRL Agent Contract

## Repository authority
The repository is the only durable source of truth. Never rely on conversation history when repository artifacts provide authoritative state.

## Mandatory recovery order
1. README.md
2. AI_CONTINUATION.md
3. docs/LLM-ARCHITECT-HANDOFF.md
4. spec/PROJECT-STATE.md
5. spec/ARCHITECTURE.md
6. spec/ARCHITECTURE-LOCK.md
7. spec/REQUIREMENTS.md
8. spec/DOMAIN-MODEL.md
9. spec/LEARNING-LOOP.md
10. spec/EVALUATION-PROTOCOL.md
11. spec/ADAPTERS.md
12. spec/SECURITY.md
13. spec/UX.md
14. spec/COMPETITIVE-ADOPTION.md
15. spec/WORK-ITEMS.md
16. spec/DEPENDENCY-GRAPH.md
17. spec/WORKER-RUNBOOK.md
18. assigned Work Order
19. live GitHub state
20. exact dispatch base SHA

## Tech Lead
The Tech Lead owns architecture, orchestration, Work Orders, review, merge decisions and state reconciliation.
Derive readiness from merged repository state. Dispatch at most 3 workers. Freeze write surfaces. Reconcile claims against GitHub and SHAs. Serialize shared/root manifest and lockfile changes.

## Worker
One Work Order, one branch, one PR, one frozen write surface. No silent scope growth. No self-merge. Report exact base/head SHA and reproducible evidence.

## Concurrency
Concurrent Work Orders must have pairwise-disjoint write surfaces. Do not share generated contracts, manifests, lockfiles or governance state. Workers should not routinely rebase onto sibling work.

## Non-negotiable architecture
- TradRL core works without Arena.
- Agent Body is independent of Cognitive Substrate.
- Versioned bodies are immutable.
- Simulation respects point-in-time availability.
- Replay/reactive/generative modes are distinct.
- Raw PnL is never the sole acceptance criterion.
- Execution authority is outside model prompts.
- Experiments retain reproducible lineage.
- Tenant memory is isolated.
- Providers are adapters.
- Organization topology is learnable.