# Production readiness — the go/no-go review (T050)

Run this review before **exposing or re-exposing** a deployment (a
first deploy, a redeploy after a merge, or a rollback-forward fix).
Every step carries its exact command and its expected output; a step
that does not match is a NO-GO — diagnose it in
`ops/runbooks/incident-response.md` before proceeding. The release
record this review feeds lives in `docs/release/`
(`docs/release/CHECKLIST.md` is this procedure in checklist form).

**Reviewer:** the Tech Lead. **Inputs:** a `main` checkout at the
release-candidate SHA; the deployment origin (e.g.
`https://tradrl-console.vercel.app`); the API credential
(`TRADRL_API_DEVELOPER_TOKEN`'s value).

---

## 1. The repository gates (the code is releasable)

Run from the repo root, on the release-candidate SHA:

| # | Gate | Command | Expected |
|---|---|---|---|
| 1 | Dependencies provision cleanly | `corepack pnpm install --frozen-lockfile` | completes; **`pnpm-lock.yaml` shows NO diff afterwards** (`git status --short` clean — the recurring importer-block self-normalization dirt is restored with `git checkout -- pnpm-lock.yaml`, never committed) |
| 2 | Types | `corepack pnpm typecheck` | 0 errors, exit 0 |
| 3 | The FULL suite | `corepack pnpm vitest run` | **the floor + exactly the net-new tests, ZERO regressions.** The floor-accounting law: the merged main's count (at the v0.1.0 release candidate, main @ the T049/T051 merges: **7667 passed + 1 skipped / 525 files**) plus exactly the new Work Order's tests. Record the numbers in the release record. |
| 4 | Program state | `node scripts/program/check.mjs` | ends with **`Program state valid.`** |
| 5 | Governance | `node scripts/validate-governance.mjs` | **`TradRL governance self-test passed.`** |
| 6 | The deploy tree's own suite | `corepack pnpm vitest run deploy` | all pass (the prebuilt-output laws: routes, the `.func` envelope, determinism, the secrets scan) |
| 7 | The performance surface | `corepack pnpm vitest run tests/performance` | all pass (the work laws: linear metering, retry dedup, bounded refusals, the chain laws at N=500, the payload budgets, the smoke tool's detectors) |

**The CI mirror:** the same four gates run on every PR
(`.github/workflows/ci.yml`: typecheck, test, program:check,
governance) — a green CI check on the release candidate's PR is the
same evidence as steps 2–5.

## 2. The deployment gates (what's live matches the code)

1. **Deploy per `deploy/README.md` §4** (the authoritative steps —
   this runbook never re-states them). Verify before deploying:
   the root `vercel.json` is byte-identical to
   `deploy/vercel/vercel.json` (test-pinned), and NO repo-root `api/`
   directory exists (the prebuilt law — a resurrected one re-enters
   the W-3k failure chain).
2. **The seven-point smoke** — the automated form of
   `deploy/README.md` §4 step 5:

   ```bash
   BASE=https://<project>.vercel.app
   TOKEN=<the TRADRL_API_DEVELOPER_TOKEN value>
   node ops/tooling/smoke.mjs "$BASE" "$TOKEN"
   ```

   Expected: **`smoke: 7/7 checks passed`**, exit 0 —
   api-authn-first (the typed 401 envelope), api-meta (200
   `apiVersion=v1`), same-origin-no-cors (no `access-control-*`
   header anywhere), api-projects (200 items array), api-knowledge
   (200 envelope), loader-source (the no-build loader's source
   serves), console-shell (the substituted `__TRADRL_CONSOLE__`
   block). Any `[fail]` line is a NO-GO → the incident matrix.
   The probe never prints the credential.
3. **The journey gate (J1–J12)** — the Lead's agent-browser catalog
   against `$BASE/` per `spec/UX-DESIGN.md` §6: J1 onboarding (first
   visit wizard, skip path, persisted), J2 shell orientation (every
   section one click away, H1 + subtitle + status badge above the
   fold), J3 the primary flow (Goal → guided spec → review → launch →
   submitted/running/complete — the J3 launch entry merged via PR
   #34), J4 watch mode (stream cards, no chain-of-thought anywhere),
   J5 Time Machine (T-x / explicit timestamp / playback, the
   availability projection), J6 notifications (all eight types),
   J7 evidence capsules (content-address badges, open from Evidence /
   Outcomes / Decisions — merged via PR #34), J8 command palette,
   J9 teaching states (fresh tenant empty states + the degraded
   banner + Try-again recovery), J10 settings (theme persistence,
   data export), J11 timeline grouping, J12 responsive + a11y at
   390px. **All twelve must pass on the live deployment before a
   release is cut** (the D-033/D-036 rule). Record per-journey
   verdicts in the release record.
   Under the demo backing expect: the data-backed journeys render the
   seeded demo data honestly labeled SIMULATED; a cold start resets
   per-instance state (acceptable and disclosed — UX-DESIGN §7).

## 3. The security gates (the exposure is safe)

| # | Check | How | Expected |
|---|---|---|---|
| 1 | No credential literals in the deployable tree | `corepack pnpm vitest run deploy/vercel` (the scan test) | pass — no `ghp_`/`github_pat`/`x-access-token:` signature anywhere under `deploy/` |
| 2 | The env inventory is complete | every key the deployment reads is documented in `deploy/.env.example` | pass (test-pinned) |
| 3 | The secrets surface never echoes values | the smoke probe's report byte-scan; the platform's opacity laws (`credentialValueViolations`) | the token never appears in any report, log line or audit record (test-pinned in `tests/security/`) |
| 4 | Tenant isolation | `corepack pnpm vitest run tests/security` + `services/api/src/isolation.test.ts` | pass — cross-tenant data is inexpressible (L12), including under interleaved load (`tests/performance/api-plane.test.ts`) |
| 5 | The private plane posture | `$BASE/internal/*` without the internal credential | 401/403 (the plane stays closed unless `TRADRL_API_INTERNAL_TOKEN` is set — R46) |
| 6 | The execution authority | no route executes anything itself | `/v1/execution/requests` only FORWARDS through the T040 gateway shapes (L8) — pinned by the gate-bypass tests |

## 4. The rollback readiness drill (do this BEFORE you need it)

```bash
npx vercel ls                      # the deployment list — note the CURRENT production URL
npx vercel rollback --help        # confirm the CLI is authenticated + the command shape
```

Then walk the decision tree in `ops/runbooks/incident-response.md`
§rollback **on paper** for the current deployment: which URL would
you roll back to? Which env-var fixes require a redeploy instead?
The rules of engagement (`deploy/README.md` §5): bad code/config →
`vercel rollback` (instant, no rebuild); bad env values → fix the
vars + `npx vercel --prod` (rollbacks do not change env); provider
outage → do NOT roll back (the R46 degradation model holds the
surface).

## 5. The free-tier capacity review (the bill stays $0)

Re-check each provider's free-tier limits at the documented usage
(the table in `deploy/README.md` §2 is the reference): Vercel Hobby
(100 GB-h serverless, 100 GB bandwidth, 1024 MB/function, ≤60 s —
the function envelope is pinned at 1024 MB / 10 s), Neon (0.5 GB,
autosuspend — cold starts are R46-covered), Upstash (500k
commands/mo), R2 (10 GB, 1M+10M ops, zero egress), Resend
(3,000 emails/mo), Apify ($5 credit/mo). At demo-public usage the
expected bill is $0; any provider whose dashboard shows approach to
a limit is a capacity finding for the release record, not a
blocker.

## 6. The go/no-go record

The review's output is a short record (append to the release record
in `docs/release/`):

```
readiness: <GO | NO-GO> at <BASE> (main @ <sha>)
gates: typecheck 0 | vitest <passed>+<skipped>/<files> (floor <floor> + <net-new> net-new) |
       program "Program state valid." | governance passed | deploy suite green |
       performance surface green
smoke: 7/7
journeys: J1..J12 <verdicts>
security: 6/6
rollback: drill walked — previous deployment <url-or-id>
capacity: $0 expected; <any findings>
findings: <none | list>
```

A NO-GO is honest: record the finding, fix forward, re-run the
review. Never expose a deployment with a red gate.
