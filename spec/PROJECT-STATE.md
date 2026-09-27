# TradRL Project State

| Field | Value |
|---|---|
| Repository | payswapdotorg/TradRL |
| Architecture | locked |
| Program phase | environment/control plane (T005-T007 wave) |
| Current authorized Work Order | T005, T006, T007 |
| Active workers | 3 |
| In-flight | T005 (work/T005-environment-protocol), T006 (work/T006-agent-os), T007 (work/T007-control-plane) |
| Blocked | none |
| Maximum concurrent workers | 3 |
| Arena required for core | no |
| Default branch | main |

## Current implementation truth
Merged (all CI-verified, Tech Lead verified in isolated worktrees, 430/430 tests on main):
- T001 c0e4e47 — repository foundation, CI, test harness, package boundaries, program state
- T002 4b6bd25 — canonical trading domain contracts (domain-core, 133 tests)
- T003 866a4ac — agent body/substrate/possession contracts (agent-body, 172 tests)
- T004 257aff2 — market event/data/time protocol + point-in-time firewall (163 tests)
Wave 3 (T005 environment protocol/runner, T006 Agent OS kernel, T007 control plane)
dispatched from base 257aff2; surfaces pairwise disjoint. T008 ready for wave 4.

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
| D-003 | 2026-09-27 | T004 spec-interpretation ratifications (all five, each test-backed): (1) TimestampMs structural mirror between market-protocol and time-engine instead of a workspace dep (frozen lockfile forbids the edge; interop test is the drift trip-wire); (2) syntheticity = provenance.origin !== 'historical'; (3) quartet ordering — only available_time >= event_time enforced, ingestion_time deliberately unordered (embargo vs backfill both legitimate); (4) SimulationClock invariant now <= asOf; (5) informationPolicy: 'point-in-time' single-variant. |
| D-004 | 2026-09-27 | Cross-lane type-sharing pattern ratified: contract packages stay zero-dependency; shared shapes use structural mirrors + interop trip-wire tests. A shared kernel package may be proposed later if mirrors proliferate. |
| D-005 | 2026-09-27 | Wave 3 = T005/T006/T007 (T008 also ready but deferred to wave 4 to hold the 3-worker limit; T005 unblocks the T008/T009/T011 chains). |
| D-006 | 2026-09-27 | Operator governance update (main 171ad39..366bda3) ratified: spec/CAPABILITY-DISCOVERY.md adopted; L16a + R49/R50 added; WORK-ITEMS T003 title extended with 'substrate capability registry contracts' and program/graph.json title synced. T003 merged WITHOUT the registry contracts — tracked open gap on the packages/agent-body/ + contracts/agent/ surface. Absorption: the registry contracts join T016's scope and write surface when T016 is dispatched (operator traceability maps R49-R50 to T016); T016's packet will cite spec/CAPABILITY-DISCOVERY.md verbatim. No earlier work order is blocked by the gap. |
