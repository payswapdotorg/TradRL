# TradRL Project State

| Field | Value |
|---|---|
| Repository | payswapdotorg/TradRL |
| Architecture | locked |
| Program phase | wave-8 dispatch (T013 RL bridge, T016 organization compiler; T036 in flight from wave-7) |
| Current authorized Work Order | T022, T039 |
| Active workers | 3 |
| In-flight | T022 (regime research body), T039 (broker/OMS adapters) |
| Blocked | none |
| Maximum concurrent workers | 3 |
| Arena required for core | no |
| Default branch | main |

## Current implementation truth
Merged at main (28/50: ...T028, T020; T020 = risk + risk-engine, +164 tests, 3731/3732 green at merge).
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
| D-009 | 2026-09-29 | Wave-10 dispatch ratified: T014 (distributed episode generation) from base = this commit; deps T005+T011+T013 merged (T013 merged 844cd37 this session). Surface note: services/learning/src/index.ts (created by T013) may gain ONLY additive re-export lines for ./compute; packages/compute is a new package. T013's chat retired post-harvest (delivery + 1.56MB batch archived) to free the worker slot — the retire-after-merge loop is now standard. |
| D-010 | 2026-09-29 | Wave-11 dispatch ratified: T038 (equities/index/news/alternative-data adapters; dep T036) + T018 (portfolio strategy domain; deps T007+T010+T012+T013+T016 — T016 merged 71c41e5 this session) from base = this commit. Root tsconfig/vitest globs now cover adapters/* (T037 merge reconciliation) — T038's packages join the root gate directly. T016/T037 lanes retired after merge (batches archived 1.46MB/1.51MB, chats deleted) — retire-after-merge is the standing loop. |
| D-011 | 2026-09-29 | Wave-12 dispatch ratified: T015 (curriculum/self-play/adversarial populations) from base = this commit; deps T011+T012+T013+T014 merged (T014 at 97c5ad7 — five merges this session: T036, T013, T016, T037, T014 = 19/50). Surface: services/learning/src/curriculum + src/populations (same additive-index pattern as T014). T014 lane retired after merge (batch archived, chat deleted). |
| D-012 | 2026-09-29 | Wave-13 dispatch ratified: T019 (execution policy/simulation) from base = this commit; deps T010+T013+T018 merged (T018 at 0d4735e — six merges this session: T036, T013, T016, T037, T014, T018 = 20/50). T018 lane retired (batch 1.31MB archived, chat deleted). T019 consumes T018's StrategyIntent as its input record (mirrors per D-004). |
| D-013 | 2026-09-29 | Wave-14 dispatch ratified: T017 (skill extraction/body forge; deps T003+T011+T012+T015+T016) + T027 (reactive market simulation; deps T009+T010+T013+T015+T026) from base = this commit. T028 (generative population) DEFERRED to wave-15: T027 and T028 share the services/market-world package (src/index.ts additive re-exports) — shared-file lanes run SERIALLY per the Tech Lead's write-face discipline. Session merge tally at authorization: 14 -> 22 (T036, T013, T016, T037, T014, T018, T015, T038); suite 2901/2902. |
| D-014 | 2026-09-29 | Wave-15 dispatch ratified: T020 (risk policy engine; deps T007+T019 merged at 653043b — ninth merge this session, 23/50) from base = this commit. T020 refines the risk dimension T019's ExecutionPolicy exposes as limit-check records. T039 (brokers/OMS adapters) queued next (deps T037+T038 merged; waits for a lane). T028 remains serially deferred behind T027. |
| D-015 | 2026-09-29 | Wave-16 dispatch ratified at the HALFWAY mark (25/50, session 14 -> 25, eleven merges): T028 (generative/counterfactual population — serial constraint satisfied, T027 merged) + T021 (sentiment/event research body — research-body chain opener; deps T003+T008+T012+T017 merged). T022/T023 queue behind T021 (research bodies share bodies/ + services/research/ parent dirs but disjoint subdirs — pairwise disjoint, may parallel next wave). T039 waits for a lane. |
| D-016 | 2026-09-29 | Wave-17 dispatch ratified: T022 (market-regime research body; deps T003+T009+T012+T017) + T039 (brokers/OMS adapters; deps T037+T038) from base = this commit. T023 (fundamental/cross-market) DEFERRED behind T022 — both edit services/research/src/index.ts additively (shared-file serial law). T031 (search-integrity audit) queued. Session tally: 14 -> 27 (thirteen merges; suite 3567/3568; root globs cover bodies/* since T021's merge). |
