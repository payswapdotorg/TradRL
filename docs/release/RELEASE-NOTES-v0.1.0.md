# Release record — v0.1.0 (the first production release)

The worked example of `docs/release/README.md` §the release record
format. **Status: CUT 2026-10-05T11:15Z** — the release-candidate evidence below was measured on main @ 14357ae + T050 and re-verified at the cut SHA; the deployment-side fields are completed at the cut (the operator's measured values inline). Nothing is edited after the cut except appending to "Known issues".

## Identity

| Field | Value |
|---|---|
| Version | **0.1.0** (root `package.json`; the only version number — the console + the API are one deployable) |
| Release SHA | **6419c0a06c72ae72eae44307304bf6ac40659eda** (main @ 6419c0a: 14357ae + T050 (PR #35) + the v0.1.0 acceptance fix wave — PRs #36/#37/#38 (J03 adoption / J05+J06 scheduler seam / J08+J09 palette+offline), PR #39 (the J03 view-instant seam), PR #40 (J12 touch targets + main landmark)) |
| Date (UTC) | **2026-10-05T11:15Z** (the cut) |
| Deployment origin | **Verified at cut: `https://trrl-console-staging.vercel.app`** (Vercel project `trrl-console-staging`, team `tepa`, deployment `trrl-console-staging-qwbodb9sk` from the cut SHA; same-origin `/v1` + `/internal`; smoke 7/7). The production-name origin `https://tradrl-console.vercel.app` (project `tradrl-console`, team `ekonplacidegmailcoms-projects`) serves the pre-fix deployment `dpl_FUJEcMRetRb3ad4KS2gK4NHnaQya` (main @ 14357ae) — its team's Vercel free-tier daily deployment quota (>100 deploys in the trailing 24h window, exhausted by the D-038→D-041 platform-debugging era + git-integration preview deploys) blocked the redeploy at cut time; an automatic retry daemon redeploys the cut SHA to the production name the moment the window frees (all project env vars identical — both origins serve the same artifact + demo backing) |
| Deployed backing | **demo** (the default: no `NEON_*`/`UPSTASH_*` key configured — the data routes serve the seeded fixture demo data per-instance; the console's SIMULATED badge is the contractual disclosure) |
| Program | 52/52 Work Orders merged at this release (T001–T052); `program/graph.json` + `spec/PROJECT-STATE.md` are the machine-checked record |

## Verification (the measured numbers)

Repository gates, measured on the release-candidate tree (main @
14357ae + T050; re-run at the cut SHA with the commands in §How to
verify):

| Gate | Result |
|---|---|
| `corepack pnpm install --frozen-lockfile` | completes; `pnpm-lock.yaml` shows no committed diff |
| `corepack pnpm typecheck` | **0 errors** |
| `corepack pnpm vitest run` (the FULL suite) | **Re-run at the cut SHA 6419c0a: 7742 passed + 1 skipped / 531 files** (= the a3e2f90 floor 7731+1skip/530 + 3 net-new (PR #39) + 8 net-new (PR #40), zero regressions per-file). Candidate-tree measurement: **7706 passed + 1 skipped / 529 files** = the merged floor at main @ 14357ae (**7667 passed + 1 skipped / 525 files**, empirically re-derived) + exactly T050's **39 net-new tests / 4 files** (`tests/performance/`: api-plane 11, observability-plane 9, console-payload 5, smoke-tool 14), **zero regressions** (per-file counts compared: no file's count dropped, no previously-green file failed; the single skip is the pre-existing `packages/time-engine/src/knowledge/interop.test.ts` platform-conditional) |
| `corepack pnpm vitest run deploy` | **155 / 155** across 10 files (the prebuilt-output laws: routes === `FUNCTION_MOUNT_PATH`, the `.func` envelope, build determinism, the credential-literal scan) |
| `corepack pnpm vitest run tests/security` | green (tenant isolation, secrets, export, untrusted-input escalation) |
| `node scripts/program/check.mjs` | **`Program state valid.`** (51/52 at the candidate's base, frontier [T050]; the merge completes the program 52/52) |
| `node scripts/validate-governance.mjs` | **`TradRL governance self-test passed.`** |
| The console boot payload (T050's budget law) | 38 files / 501,755 bytes (490.0 KiB) / largest `src/loader/strip-types.ts` at 61,327 bytes — under the recorded budgets (64 files / 768 KiB / 128 KiB) |

Deployment gates (the operator's, per `docs/release/CHECKLIST.md`
Phases B–C; the record is complete only when both are green):

| Gate | Result |
|---|---|
| The seven-point smoke — `node ops/tooling/smoke.mjs "$BASE" "$TOKEN"` | **`smoke: 7/7 checks passed`**, exit 0 — measured live at the cut on `https://trrl-console-staging.vercel.app` (deployment qwbodb9sk, cut SHA 6419c0a): api-authn-first 401 · api-meta 200 apiVersion=v1 · same-origin-no-cors · api-projects 200 · api-knowledge 200 · loader-source 200 · console-shell 200 |
| The J1–J12 journey catalog (the agent browser, `spec/UX-DESIGN.md` §6) | **ALL TWELVE PASS** at the cut (the acceptance rounds on the public origin; full evidence: `/home/z/my-project/phase1-jcatalog-results.md`, screenshots `/tmp/w16-*` + `/tmp/w19-*`): J1 onboarding PASS (wizard 1→3 → Home; skip; reload skips) · J2 shell PASS (14 sections one-click, SIMULATED badges, CONNECTION LIVE) · J3 primary flow PASS (after a 92s boot-pin window: POST /v1/projects 201 → POST /v1/jobs/research 202 → submitted→running→complete at the 500ms beat → "Launch (launched)"; PR #39's re-sample live) · J4 watch PASS (org snapshot + 4 stream cards, zero chain-of-thought) · J5 Time Machine PASS (4 modes; playback +500ms/s; scrubber wired) · J6 notifications PASS (badge, accordions, per-notice Mark read, toast auto-dismiss ~5s + close) · J7 evidence PASS (3 evc capsules + inline from Outcomes/Decisions) · J8 palette PASS (fuzzy query live, empty-match state, palette-alone nav) · J9 teaching states PASS (empty states; UNREACHABLE at boot-block + ErrorState + Try-again recovery; DEGRADED amber mid-session with last-known) · J10 settings PASS (theme persists, real 15.6KB export) · J11 timeline PASS (period buckets, expandable typed rows) · J12 responsive/a11y PASS (measured 390×844: every interactive element ≥44×44 — wizard 35/35, shell 33/33, drawer 34/34, palette 53/53; no horizontal scroll; exactly one `<main>`; drawer keyboard-operable; focus-visible; reduced-motion; desktop 1280 unchanged) |
| The security posture (CHECKLIST C2) | GREEN at cut: `/internal/usage/tenant-demo` → **401** unauthenticated (the private plane closed); no `access-control-*` header anywhere on the origin (the same-origin law, smoke-verified); `corepack pnpm vitest run tests/security` → **5 files / 40 tests passed** |

## What shipped (by plane, real component names)

- **The canonical contracts** — `packages/domain-core`, `agent-body`
  (+ the capability registry), `market-protocol`, `time-engine`,
  `environment-protocol`, `control-domain`, `trajectory`,
  `experiments`, `evaluation`, `verification`, `organization`,
  `skills`, `trading-strategy`, `execution-policy`, `risk`,
  `execution-authority`, `observability`, `security`, `provider-sdk`,
  `sdk`, `entitlements`, `firm-memory`, `outcomes`, `search-lineage`,
  `evaluation-splits`, `compute`, `rl-protocol`, `provenance`,
  `capability-provider` — zero-runtime-dependency contract packages
  (the T001 law), all under `pnpm` workspaces with a frozen lockfile.
- **The runtime services** — agent OS runtime, environment runner,
  control plane, data ingestion + event store, the three market worlds
  (replay / reactive / generative, `services/market-world/*`),
  knowledge firewall, time machine, shadow trading, execution
  simulation + the execution gateway (the L8 authority chokepoint),
  strategy/risk services, the research bodies (`bodies/*`: sentiment,
  regime, fundamental, cross-market, trading-director, execution),
  learning compute/curriculum/populations, autonomous learning
  (`services/autonomous-learning`), outcome learning, firm memory,
  the API boundary (`services/api`, T041's
  authn→authz→tenant→rate-limit→validation→handler→audit→metering
  pipeline), observability + platform audit, the security service, and
  the marketplace.
- **The console** — `apps/web` (T042 + the T051 conformance overhaul):
  the no-build loader console, twelve sections, onboarding, launch
  flow, watch mode, Time Machine, evidence capsules, command palette,
  teaching states, settings, timeline — the full `spec/UX-DESIGN.md`
  design language.
- **The deployment** — `deploy/` (T052): the free-tier provider set
  (Vercel + Neon + Upstash + R2 + Resend + Apify), five zero-dep
  provider adapters, the composition wire, and the **prebuilt Build
  Output API v3** pipeline (`deploy/vercel/build-console.mjs`) — the
  battle-tested W-3h→W-3k chain, every row a live production failure
  once, every fix test-pinned.
- **The evidence plane** — `examples/end-to-end-trading` + 
  `tests/end-to-end-trading` (the T048 reference slice: the whole
  ARCHITECTURE pipeline as one byte-reproducible runnable),
  `benchmarks/platform` + `research/public-evaluation` (the T049
  benchmark machinery + the `pev:` publication layer with the
  never-publish gate), `research/evaluation-integrity` +
  `research/benchmarks` (the overfitting/walk-forward controls).
- **The operations plane (this release's own delivery, T050)** —
  `ops/` (the production-readiness, incident-response and
  observability runbooks + the seven-point smoke probe
  `ops/tooling/smoke.mjs`), `tests/performance/` (39 deterministic
  work laws: metering linearity, retry-storm dedupe, bounded
  refusals, the exact audit count, L12 at interleaved scale, the
  telemetry chain laws at N=500, the console boot-payload budgets),
  and this `docs/release/` tree.

## Requirement coverage (spec/TRACEABILITY.md's duty — verified, not merged)

Citations point at where the behavior is VERIFIED (suite / journey /
smoke), per the completion rule:

| Requirement group | Verified by |
|---|---|
| R1–R3 goals/constraints, canonical events, provenance | `packages/domain-core`, `control-domain`, `market-protocol`, `provenance` suites; the T048 reference slice re-runs the pipeline byte-identically |
| R4–R7 replay/reactive/generative/Time Machine | `services/market-world/*` + `time-engine` + `knowledge-firewall` + `time-machine` suites; the T048 slice; J5 (the availability projection, no post-view-time datum) |
| R8–R10 body/model/possession/Agent OS | `agent-body`, `agent-os` suites; the organization compiler's body/substrate search |
| R11–R12 adaptive organization | `organization` + `organization-compiler` suites (team-size/topology search) |
| R13–R14 learning methods/distributed generation | `rl-protocol`, `compute`, `learning/*` suites |
| R15–R17 strategic/execution separation, microstructure | `trading-strategy`, `execution-policy`, `exchange-sim`, `risk` suites; the T048 cost model (the 1bp taker fee in the book) |
| R18–R21 lineage/evaluation/overfitting/unseen | `trajectory`, `experiments`, `evaluation`, `verification`, `search-lineage` + `evaluation-integrity` + `evaluation-splits` suites; the T049 benchmark platform attains against the REAL T048 report |
| R22–R24 shadow/live/risk/authorization | `shadow-trading`, `risk`, `execution-authority` + the gateway's 13-stage chokepoint suites; the L8 bypass tests (a model cannot reach an execution consequence) |
| R25–R28 Firm Brain/outcomes/body versions | `firm-memory`, `outcomes`, `skills`/`body-forge` suites; the T035 autonomous-learning cycle's 8 fail-closed gates |
| R29–R32 provider APIs + adapters | `provider-sdk` + `adapters/*` suites (Binance/Coinbase/equities/news/alternative/brokers/OMS-EMS); the Arena adapter (T046) consumes T045's interface |
| R33–R35 optional Arena/localized expertise | `capability-provider` + `adapters/arena` suites; the Arena-unavailable mode is in CI (ADR-0001) |
| R36–R38 project UX/watch/evidence | `apps/web` suites (the executed-boot harness); the J1–J12 catalog at cut time; the seven-point smoke's console checks |
| R39–R40 jobs/audit/observability | `services/api` job routes + audit chain suites; `services/observability` + `services/audit` chain laws; the usage ledger through `/internal/usage/:tenantId` |
| R41–R43 entitlements/export/API | `marketplace` + `entitlements` suites; the metering laws (`tests/performance/api-plane.test.ts` — exact linearity); `export-r42` (export without customer leakage) |
| R44–R50 reference bodies, uncertainty, degradation, provider neutrality, firm learning, capability discovery | the T048 reference slice end-to-end; `deploy/README.md` §6's R46 degradation matrix + the typed-503 tests; the T035 discovery gates; the T049 platform's capability suites + the `pev:` publication gate |

## Honest limitations

- **The public deployment runs the DEMO backing** — per-instance
  in-memory state over the frozen service's own fixture ports. A
  serverless cold start resets the demo world to its seed. The
  SIMULATED badge is the contractual disclosure (UX-DESIGN §7); a
  release under the demo backing is a SIMULATED release, recorded as
  such here.
- **The durable backing is built but not yet wired** — the five
  provider adapters + the wire are offline-tested (`deploy/adapters/`,
  `deploy/wire/`), but T041's synchronous ports and the async adapters
  need the W-3e hydration seam (a frozen-sibling change); until it
  lands the durable path composes the typed 503 `deploy_adapter_pending`
  stubs — the honest R46 pending state.
- **The live J-catalog verdicts are recorded at cut time, not here** —
  J1 (onboarding) and J3/J7 (launch entry, evidence capsules) were
  browser-proven on their delivery branches (PRs #32/#34); the release
  acceptance is the catalog re-run on the public origin (CHECKLIST C1),
  whose verdicts fill the table above.
- **A recorded latent defect** (W-9c's finding, harmless today): the
  three `compareMagnitude` implementations (`packages/evaluation-splits`,
  `research/evaluation-integrity`, `research/benchmarks`) miscompare
  decimals across differing integer-digit counts; all current call
  sites are same-digit-count. The T049 interop suite pins the
  divergence record and flips red when it is fixed.

## Known issues

- The lockfile's recurring importer-block self-normalization diff
  after some `pnpm` invocations (`git checkout -- pnpm-lock.yaml`;
  never committed — `ops/README.md`'s standing gotcha).
- The durable-backing hydration seam (W-3e) is the largest open
  follow-up; everything durable is built and offline-tested.

## How to verify this release

```bash
git checkout <the release SHA> && git status --short   # clean
corepack pnpm install --frozen-lockfile                # no lockfile diff
corepack pnpm typecheck                                # 0 errors
corepack pnpm vitest run                               # 7706 passed + 1 skipped / 529 files
node scripts/program/check.mjs                         # "Program state valid."
node scripts/validate-governance.mjs                   # "TradRL governance self-test passed."
node ops/tooling/smoke.mjs "$BASE" "$TOKEN"            # "smoke: 7/7 checks passed", exit 0
```

The deployment itself is re-derivable from the SHA: `npx vercel
--prod` emits the byte-deterministic prebuilt `.vercel/output` (the
build determinism is test-pinned) — the release artifact IS the
deployment at the recorded SHA.

## Known issues (appended at cut, 2026-10-05T11:15Z)

- **The vdom renderer landmine (non-fatal, observed live at cut)** — `removeChild` NotFoundError inside `mountVTree` during beat renders (a renderer/DOM race, likely focus/blur DOM movement during form interaction); every affected journey still completed exactly (the renderer re-syncs on the next beat). Follow-up Work Order candidate (renderer hardening); PR #39's per-beat re-sample makes every beat a real render diff, which exposes it.
- **The production-name origin lag (quota, not code)** — `tradrl-console.vercel.app` serves the pre-fix `dpl_FUJEcMRetRb3ad4KS2gK4NHnaQya` (main @ 14357ae) until the team's Vercel free-tier daily-deploy window frees; an automatic retry daemon (20-minute cadence, Lead-operated) redeploys the cut SHA to the production name on the first successful window. The verified cut origin is `trrl-console-staging.vercel.app` (identical artifact + backing).
- **The production-name origin caught up (resolved 2026-10-05, Lead-verified)** — the retry daemon's deploy `dpl_56gT1kNCq9zo` (cut SHA, CLI deploy 11:26Z) freed with the quota window and now serves `https://tradrl-console.vercel.app`; Lead post-reset verification (14:05-14:10Z): shell + all real modules byte-identical to the verified staging origin, unauth 401 authn-first, no-CORS law, and the J1 wizard / J2 shell (LIVE + SIMULATED badges, demo data routes 200) / J3 primary flow (POST /v1/projects 201 -> POST /v1/jobs/research 202 -> submitted->running->complete -> 'Launch (launched)') all PASS live on the production origin. The two-step launch confirm and beat-render form commit verified through the real UI.
- **Rollback readiness (CHECKLIST D3, walked on paper)** — previous deployments: production name `dpl_FUJEcMRetRb3ad4KS2gK4NHnaQya` (main @ 14357ae); cut origin `trrl-console-staging-lo5e7r84u` (main @ a3e2f90). Rollback = `npx vercel rollback <deployment>` per `ops/runbooks/incident-response.md` §4 (or redeploy the prior SHA from the linked worktree); the demo backing is per-instance in-memory (a cold start re-seeds — no data migration on rollback).
- **Phase 2 competitive simulation findings (2026-10-05, appended post-cut)** — 15 simulated professionals (small/mid/large companies) executed 300 projects through the production origin's UI only (agent-browser; 3 minor self-reported harness-class protocol notes, zero API bypasses). Results: 79.0% project success; TradRL 3.51 vs QuantConnect 2.54 on the 10-dimension rubric; switch rate 1/15 (12 undecided, 15/15 would pilot). Universal blockers (defect register with root-cause hypotheses in `/home/z/my-project/phase2-competitive-report.md`): research release-candidate result renders nowhere in the UI (0/15 — the payload exists in exports); Execution surface has zero submissions in the demo world (0/15); decision records lack deciding-body/rationale/risk-checks (2/15); launched orgs never compile (demo machinery compiles only the seeded project); Risk section renders predicate labels without numeric bounds; workspace scope silently resets to the demo project on reload with no switcher (highest friction count: 69 rows); notice `<details>` accordions collapse within ~500ms defeating per-notice mark-read (the vdom landmine class, now interaction-breaking); nav hit-area occlusion by badge/connection tiles; export hash chain not actually linked (0/19+ digest linkages; capsules/decisions absent from the export); Time Machine Pause restarts playback. The evidence/lineage/disclosure architecture was rated best-in-class by every persona (agent-org 3.1 vs 1.0; audit trail 3.4 vs 2.3); the four UI/seed-layer blockers are the gap between the 12 undecided professionals and adoption.
