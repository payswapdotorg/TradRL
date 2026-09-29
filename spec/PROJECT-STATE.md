# TradRL Project State

| Field | Value |
|---|---|
| Repository | payswapdotorg/TradRL |
| Architecture | locked |
| Program phase | wave-8 dispatch (T013 RL bridge, T016 organization compiler; T036 in flight from wave-7) |
| Current authorized Work Order | T016, T037 |
| Active workers | 3 |
| In-flight | T016 (organization-compiler, kicked after slow attach), T037 (exchange adapters, kicked after slow attach) |
| Blocked | none |
| Maximum concurrent workers | 3 |
| Arena required for core | no |
| Default branch | main |

## Current implementation truth
Merged at main (16/50: T001-T012, T026, T029, T036, T013; T013 = rl-protocol + services/learning/rl, +89 tests, 1782/1783 green at merge).
Earlier waves (CI-verified at the time, superseded counts):
- T001 c0e4e47 — repository foundation, CI, test harness, package boundaries, program state
- T002 4b6bd25 — canonical trading domain contracts (domain-core, 133 tests)
- T003 866a4ac — agent body/substrate/possession contracts (agent-body, 172 tests)
- T004 257aff2 — market event/data/time protocol + point-in-time firewall (163 tests)
Wave 3 (T005 environment protocol/runner, T006 Agent OS kernel, T007 control plane)
dispatched from base 257aff2; surfaces pairwise disjoint. T008 ready for wave 4.


## Recovery note (2026-09-28, batch-replay recovery)
Sandbox reset at ~18:32 UTC destroyed the local repository state including nine
merged work orders (T005-T011, T026, T029). The branch `recover/13-50` was
reconstructed from preserved batch stores (Write args + post-Write Edit/MultiEdit
deltas) and oracle candidate versions; each ticket re-merged on the recovery
branch with a `merge: TXXX (recovered...)` commit. Local verification at 987b1e3:
`pnpm typecheck` clean (0 errors); vitest 1319 passed / 74 failed / 1 skipped —
the failures are cross-version behavioral mismatches between sibling verbatim
writes (engine/session/scan suites) and remain under triage. `program/graph.json`
marks the nine tickets merged with recovery evidence; frontier is T012, T036.

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

| D-007 | 2026-09-29 | Wave-8 dispatch ratified: T013 (RL interface/trainer bridge; base = this commit) and T016 (organization compiler/team search; base = this commit). Per D-006, T016's write surface is EXTENDED to absorb the substrate capability registry gap: additive files only — `contracts/agent/capability-registry.md` (new doc), `packages/agent-body/src/capability-registry.ts` + `capability-registry.test.ts` (new modules; existing T003 modules untouched), plus one additive row in `contracts/agent/README.md`'s document map. T016's packet cites spec/CAPABILITY-DISCOVERY.md verbatim. T036 remains in flight on its own base (39db424 + wave-6 prelude); the Lead reconciles placeholders at merge. Registry consumption by the compiler is via structural mirrors (D-003/D-004), never imports. |
| D-008 | 2026-09-29 | Wave-9 dispatch ratified: T037 (Binance/Coinbase adapters) from base = this commit; dep T036 merged at 367bcad (provider-sdk on main — no ref bundle needed; adapters consume it via structural mirrors per D-004). T016 re-dispatched fresh (first vehicle's queued turn never spawned in 65 min and the site rolled the session — queued-turn lesson reaffirmed: never-spawned sends are inert; re-dispatch, do not wait). Worker limit held at 3: T013, T016, T037. |
