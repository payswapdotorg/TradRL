# Incident response (T050)

The production incident procedure for the TradRL public deployment.
**Every row in the matrix below is a real failure this program
diagnosed and fixed on the live platform** (the W-3h → W-3k history,
recorded in `deploy/README.md` §the W-3h..W-3k history and
`spec/PROJECT-STATE.md`'s decisions log) — plus the typed-degradation
states the platform is DESIGNED to answer with (R46).

---

## 1. Severity model

| Level | Meaning | Response |
|---|---|---|
| **SEV1** | the console or the API plane is DOWN (blank page, `FUNCTION_INVOCATION_FAILED`, every smoke check red) | run §2 now; roll back per §4 if not diagnosed in 15 minutes |
| **SEV2** | DEGRADED but honest: typed 503s on data routes, one journey broken, the watch/org surface empty, jobs never tick | run §2; matrix §3; usually an env/backing misconfiguration — NO rollback |
| **SEV3** | cosmetic/teaching-state issues (copy, layout at one width, a notice type's copy) | file the finding; fix forward in the next release; never an incident bridge |

The anti-deception rule (UX-DESIGN §7) decides borderline cases: a
surface that is SLOW or degraded but LABELED honestly is SEV2/3; a
surface that LIES (simulated data rendered as live, a blank region
with no message) is SEV1-adjacent — treat as SEV2 minimum.

## 2. The first five minutes

```bash
BASE=https://<project>.vercel.app
TOKEN=<the TRADRL_API_DEVELOPER_TOKEN value>

# 1. The seven-point smoke — one command triages the whole surface.
node ops/tooling/smoke.mjs "$BASE" "$TOKEN"

# 2. What is actually deployed?
npx vercel ls                          # the production alias target + history

# 3. The deployment's own logs (dashboard → the deployment → Functions/Logs)
#    read the LAST module-load or invocation errors there.
```

Read the smoke's `[fail]` lines against §3's matrix — the failing
check names the failing layer:

| The failing smoke check | The layer it indicts |
|---|---|
| `api-authn-first` / `api-meta` | the API function (pipeline, composition, module load) |
| `same-origin-no-cors` | the routing/hosting layer (an injected proxy or a config drift) |
| `api-projects` / `api-knowledge` | the backing resolution (env keys, the demo/durable selection) |
| `loader-source` | the static tree (the build's copy step) |
| `console-shell` | the shell substitution (build-time env) |

## 3. The symptom → diagnosis → remediation matrix

### 3a. The build/deploy failure class

| Symptom | Diagnosis | Remediation |
|---|---|---|
| `/v1/*` (or `/internal/*`) returns **Vercel's NOT_FOUND page**, not the API's JSON envelope | the route destination is not the EXACT function path (functions match exact paths only — the W-3j lesson) | check the EMITTED `.vercel/output/config.json` `dest` values against `FUNCTION_MOUNT_PATH` (`deploy/vercel/runtime/http.ts`; test-pinned equal — they cannot drift silently, so a mismatch means a non-prebuilt path built the deployment); confirm the function appears as `api/router`; confirm the root `vercel.json` byte-matches `deploy/vercel/vercel.json` |
| The exact function path answers **FUNCTION_INVOCATION_FAILED (500)** with `ERR_MODULE_NOT_FOUND` or "Cannot use import statement outside a module" in the logs | the function emit is ESM (the W-3j class) | the emit config `deploy/vercel/function.tsconfig.json` must pin `module: "CommonJS"` + `moduleResolution: "node"` — restore the pin; NEVER add file extensions to the frozen `services/api` imports |
| FUNCTION_INVOCATION_FAILED with `ReferenceError: exports is not defined in ES module scope` | the W-3k `type:module` poison: a `package.json` with `"type": "module"` ended up INSIDE the `.func` | the prebuilt emit seals the `.func` with a root `package.json` carrying NO `"type"` field and NO inner `package.json` anywhere — test-pinned; if it reproduces, the prebuilt build did not run (see the next row) |
| The build log shows `@vercel/node` running (instead of "Build Completed in /vercel/output") | a repo-root `api/` directory exists — the platform's builder discovered a function and re-entered the W-3h/W-3i failure chain | remove the repo-root `api/` directory (the prebuilt law — test-pinned that it must not exist) |
| The function build fails **TS2835** ("Relative import paths need explicit file extensions") | a nodenext typecheck ran (the W-3i class) | restore `deploy/vercel/function.tsconfig.json` (`module: "CommonJS"` + `moduleResolution: "node"`) |
| The build fails `build-console: the TypeScript compiler is missing` | the install step no longer provisions the workspace devDependencies (probe-proven: an echo install leaves NO node_modules) | restore the frozen-lockfile `installCommand` in `vercel.json` (`corepack pnpm install --frozen-lockfile --prefer-offline`); NEVER add an npm dependency to `deploy/` to work around it |
| The build fails on a **config.json validation** (an `images` key demanding `sizes`) | the emitted `config.json` grew an `images` key | the emitted config must carry exactly `version` + `routes` and NO `images` key (probe-proven — the platform rejects it) |

### 3b. The runtime degradation class (the TYPED states — R46)

| Symptom | Diagnosis | Remediation |
|---|---|---|
| The data routes answer **503 `deploy_adapter_pending`** | a `NEON_*`/`UPSTASH_*` key IS configured → the durable backing was auto-selected (the adapters compose the typed pending stubs until the W-3e hydration seam) | for the demo deployment: unset those keys or set `TRADRL_DEPLOY_BACKING=demo`, then redeploy; for the durable path: this is the honest pending state — see `deploy/wire/production.md` |
| Every request answers **503 `deploy_not_configured` naming KEY NAMES** (never values) | API env keys missing at function start (or an INVALID `TRADRL_DEPLOY_BACKING` value — the message names the key and its two legal values) | set the named keys in the Vercel project env (Production + Preview), then redeploy (rollbacks do not change env) |
| The console boots into its readable "no credential token / no tenant injected" message | the BUILD-time `TRADRL_CONSOLE_TOKEN`/`TRADRL_CONSOLE_TENANT_ID` were unset when the shell copy was substituted | set the build env vars (the token must equal `TRADRL_API_DEVELOPER_TOKEN`, the tenant `TRADRL_API_DEVELOPER_TENANT`) and redeploy — the substitution only happens at build time |
| The watch section shows NO org snapshot; launch progress sticks at `submitted` | the internal credential pair (`TRADRL_API_INTERNAL_TOKEN` + `TRADRL_API_INTERNAL_PRINCIPAL`) is unset — the private plane is closed (only it can write org-status / tick jobs) | set the internal pair for the full demo (the runbook §4 step 2 documents this); otherwise this is the honest closed state |
| First query after idle is slow, then works (durable path, post-W-3e) | Neon autosuspend woke (the cold start) | R46 covers it — the typed degraded state renders; no action |
| A section renders its unavailable/degraded state while others work | one provider is down/misconfigured (the durable path) | the affected routes answer the provider's typed degraded code — never a crash; fix the provider config; do NOT roll back the deployment |

### 3c. The console failure class

| Symptom | Diagnosis | Remediation |
|---|---|---|
| The page loads but a section is blank (no skeleton, no message) | a T042/T051 availability-model regression — blank regions are contract violations (J9) | file as SEV2+ with the browser console's errors; the console's own degradation model should have rendered a readable state |
| The console could not start (a loader/stripper syntax error) | the loader's erasable-type stripping met a source file it cannot strip (the L-02 J1 class) | reproduce locally with the same browser; the loader and every published source are pinned by `apps/web`'s suites + the deploy copy tests — a regression means a source that passed tests but not the browser path; fix forward on `apps/web` and redeploy |

## 4. The rollback decision tree

```
Is the deployment serving at all (smoke has ≥1 pass)?
├─ NO  → SEV1. `npx vercel rollback <previous-url-or-id>` NOW (instant, no rebuild),
│        then diagnose on the branch — the git history is the audit trail.
├─ YES but wrong (bad code/config: a regression, a broken journey)
│        → `npx vercel rollback <previous>` — fix forward on the branch after.
├─ Wrong env VALUES (a rotated token pair, a missing key)
│        → fix the env vars in the Vercel project, then `npx vercel --prod`.
│        (Rollbacks do NOT change env vars — a rollback here changes nothing.)
└─ A provider is down/misconfigured
         → do NOT roll back. The R46 degradation model holds the surface
           (typed 503s, honest degraded sections); wait out the provider or
           flip the backing (`TRADRL_DEPLOY_BACKING=demo`) and redeploy.
```

The console and the API deploy together (one project) — there is no
partial-state risk between them.

## 5. The incident record (the post-incident loop)

Within 24h of a SEV1/SEV2 closure, record the incident where the
program keeps its decisions — the worklog entry +
`spec/PROJECT-STATE.md`'s decisions log (the same loop the W-3h…W-3k
history used):

```
incident: <SEV?> <one line> at <BASE> (deployment <url-or-id>, main @ <sha>)
window: <start>–<end> UTC
symptom: <what the smoke/users saw>
diagnosis: <the root cause — cite the matrix row or a new row>
remediation: <what changed (rollback | env fix | code fix @ sha)>
detection: <how it was found — smoke probe | journey gate | user report>
gap: <what would have caught it earlier — feed the next readiness review>
```

If the incident reveals a NEW failure mode, add its row to §3 (this
runbook is append-only history — the W-3h…W-3k rows were each a live
production failure once). If it reveals a code defect, it becomes a
work order on the owning surface (`apps/web`, `services/api`,
`deploy/`, …) — never an out-of-surface hotfix.
