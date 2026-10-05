# Release record — v0.1.0 (the first production release)

The worked example of `docs/release/README.md` §the release record
format. **Status: pre-record** — the repository-side evidence below is
measured on the v0.1.0 release candidate (main @ 14357ae + T050, the
final Work Order); the deployment-side fields (marked `<at cut>`) are
completed by the operator when the release is cut, each with its exact
command. Nothing in this record may be edited after the cut except
appending to "Known issues".

## Identity

| Field | Value |
|---|---|
| Version | **0.1.0** (root `package.json`; the only version number — the console + the API are one deployable) |
| Release SHA | `<at cut>` — the merged main after T050's PR is merged (the candidate content = main @ 14357ae + the T050 delivery; `git rev-parse HEAD` on the release checkout) |
| Date (UTC) | `<at cut>` |
| Deployment origin | `https://tradrl-console.vercel.app` (the Vercel project `tradrl-console`, one origin, same-origin `/v1` + `/internal`) |
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
| `corepack pnpm vitest run` (the FULL suite) | **7706 passed + 1 skipped / 529 files** = the merged floor at main @ 14357ae (**7667 passed + 1 skipped / 525 files**, empirically re-derived) + exactly T050's **39 net-new tests / 4 files** (`tests/performance/`: api-plane 11, observability-plane 9, console-payload 5, smoke-tool 14), **zero regressions** (per-file counts compared: no file's count dropped, no previously-green file failed; the single skip is the pre-existing `packages/time-engine/src/knowledge/interop.test.ts` platform-conditional) |
| `corepack pnpm vitest run deploy` | **155 / 155** across 10 files (the prebuilt-output laws: routes === `FUNCTION_MOUNT_PATH`, the `.func` envelope, build determinism, the credential-literal scan) |
| `corepack pnpm vitest run tests/security` | green (tenant isolation, secrets, export, untrusted-input escalation) |
| `node scripts/program/check.mjs` | **`Program state valid.`** (51/52 at the candidate's base, frontier [T050]; the merge completes the program 52/52) |
| `node scripts/validate-governance.mjs` | **`TradRL governance self-test passed.`** |
| The console boot payload (T050's budget law) | 38 files / 501,755 bytes (490.0 KiB) / largest `src/loader/strip-types.ts` at 61,327 bytes — under the recorded budgets (64 files / 768 KiB / 128 KiB) |

Deployment gates (the operator's, per `docs/release/CHECKLIST.md`
Phases B–C; the record is complete only when both are green):

| Gate | Result |
|---|---|
| The seven-point smoke — `node ops/tooling/smoke.mjs "$BASE" "$TOKEN"` | `<at cut>` — expected **`smoke: 7/7 checks passed`**, exit 0 (the probe is offline-verified: every detector proven to bite; the live verdict is recorded here) |
| The J1–J12 journey catalog (the agent browser, `spec/UX-DESIGN.md` §6) | `<at cut>` — record per-journey verdicts: J1 onboarding · J2 shell · J3 primary flow · J4 watch · J5 Time Machine · J6 notifications · J7 evidence · J8 palette · J9 teaching states · J10 settings · J11 timeline · J12 responsive/a11y |
| The security posture (CHECKLIST C2) | `<at cut>` — `/internal/*` closed without the internal credential; no CORS headers on `$BASE`; `tests/security` green |

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
