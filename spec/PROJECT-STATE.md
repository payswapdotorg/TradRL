# TradRL Project State

| Field | Value |
|---|---|
| Repository | payswapdotorg/TradRL |
| Architecture | locked |
| Program phase | foundation |
| Current authorized Work Order | T001 |
| Active workers | 0 |
| In-flight | none |
| Blocked | none |
| Maximum concurrent workers | 3 |
| Arena required for core | no |
| Default branch | main |

## Current implementation truth
The repository is intentionally governance-first. No production capability is assumed complete.

## State transition
A Work Order becomes complete only after implementation, verification, evidence, ownership compliance, Tech Lead acceptance and merge. Record exact merged SHA.

## Explicit invariants
1. Native learning works without Arena.
2. Agent Body != model.
3. Point-in-time information boundaries are enforced.
4. Exact replay != reactive replay != generative simulation.
5. User constraints are executable acceptance criteria.
6. Execution authority is outside the model.
7. Search history is preserved against overfitting.
8. Tenant data is isolated.
9. Provider semantics remain in adapters.
10. Firm learning persists across projects but remains tenant-scoped.

## Decisions log
| ID | Date (UTC) | Decision |
|---|---|---|
| D-001 | 2026-09-27 | Dependency reconciliation: `spec/DEPENDENCY-GRAPH.md` is the single canonical edge set for readiness (per its own declaration). `spec/WORK-ITEMS.md` Depends column realigned to it — 26 cells corrected, 45 cross-document edge discrepancies resolved (14 graph-only edges adopted; 31 work-items-only edges dropped as transitively implied or non-blocking). Markdown table separators repaired in all 8 tables. Machine enforcement lands with T001 (`program/graph.json` + `scripts/program/check.mjs` must agree with both documents or CI fails). |
| D-002 | 2026-09-27 | Technology foundation for T001: pnpm@10.34.5 workspaces + TypeScript strict (`tsconfig.base.json`) + vitest + Node 22 CI. Zero runtime dependencies in contract packages (T002–T004); dev dependencies only at root. `governance.yml` (malformed trigger `branches: ain]`) replaced by consolidated `ci.yml`. |