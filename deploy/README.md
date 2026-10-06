# deploy/ — the public free-tier deployment runbook (T052)

Everything required to run the TradRL console (apps/web, T042+T051) and
the developer API boundary (services/api, T041) **publicly on free-tier
providers** (directive D-033: Vercel + Neon + Upstash + Cloudflare R2 +
Resend + Apify — the provider set is normative).

**Audience:** the Tech Lead executes this runbook verbatim. The worker
(T052) never performs the provider provisioning or the deploy; the
runbook must be complete enough to run step-by-step.

**The laws this tree obeys**

- **Zero-dep law** — every provider client is hand-authored on platform
  APIs only (`fetch`, `node:crypto`). NO npm dependencies anywhere in
  `deploy/`, no `package.json` under `deploy/`, no dependency is EVER
  added and `pnpm-lock.yaml` is NEVER modified: the Vercel
  `installCommand` is a **frozen-lockfile provision** of the workspace's
  OWN devDependencies — exactly the build toolchain (`typescript`) the
  prebuilt emit needs, nothing more (probe-proven live: a no-op echo
  install leaves the build image with NO node_modules at all — team
  tepa project `trrl-echo-probe`; the emitted `.func` itself ships with
  no `node_modules`).
- **Frozen siblings** — `services/api` is WRAPPED (its route table is
  invoked from `deploy/vercel/api/router.ts`; the service is never
  edited), `apps/web` is deployed AS-IS through a build step OWNED BY
  `deploy/` (the shell copy is substituted host-side; the package tree
  is never edited).
- **Same-origin /v1** — the console reaches the API through the
  EMITTED `.vercel/output/config.json` routes on ONE origin. NO CORS
  headers are ever emitted (pinned by `deploy/vercel/vercel.test.ts`).
- **L12 / L20 stay in code** — the deployment changes WHERE code runs,
  never WHAT enforces: the T041 pipeline (authn → authz →
  tenant-context injection → rate limit → validation → handler → audit
  → response) and tenant isolation run unchanged inside the function.
- **Secrets never hardcoded** — every secret comes from the
  environment; `deploy/.env.example` is the single inventory.

---

## 1. The architecture (what runs where)

```
https://<project>.vercel.app                       (ONE origin — no CORS anywhere)
├── /*              static: the console build      (.vercel/output/static)
│   ├── index.html     the T042/T051 shell with the PRODUCTION config block
│   └── src/**/*       the console's TypeScript sources, served as static
│                      files (DATA — the no-build loader fetches them as
│                      text and strips types IN THE BROWSER)
├── /v1/*           route → the serverless function  (config.json route dest =
│                   the exact function path /api/router; the platform hands
│                   the function req.url = the ORIGINAL public path — W-3k)
└── /internal/*     route → the same function      (the private plane)
```

The whole tree is the **prebuilt Build Output API v3 deployment**
(`.vercel/output/`), emitted by the build command
(`deploy/vercel/build-console.mjs`) — the platform accepts it AS-IS and
`@vercel/node` NEVER runs (there is no repo-root `api/` directory to
discover, W-3k). The emitted tree:

```
.vercel/output/
├── config.json            {"version":3,"routes":[{"src":"/v1/(?<path>.*)",
│                          "dest":"/api/router"},{"src":"/internal/(?<path>.*)",
│                          "dest":"/api/router"}]}   (NO images key — the
│                          platform rejects one without sizes, probe-proven)
├── static/                the console build (the copy + substitute output)
└── functions/api/router.func/
    ├── index.js           the seal: module.exports = require(
    │                      './deploy/vercel/api/router').default
    ├── .vc-config.json    {"runtime":"nodejs24.x","memory":1024,
    │                      "maxDuration":10,"handler":"index.js",
    │                      "launcherType":"Nodejs"}
    ├── package.json       {"name":"tradrl-function","private":true}
    │                      — NO "type" field (the sealed tree is CommonJS)
    ├── deploy/vercel/api/router.js        ┐
    ├── deploy/vercel/runtime/*.js          │ the tsc-emitted CommonJS tree
    └── services/api/src/*.js               ┘ (rootDir = the repo root)
       (NO other package.json anywhere in the .func — the W-3k law)
```

- **The console (static).** apps/web is a *no-build* application: the
  shell fetches `./src/...` TypeScript at runtime through the
  erasable-type loader. "Building" it therefore means exactly two
  things, performed by `deploy/vercel/build-console.mjs`
  (zero-dep: `node:fs`/`node:path`/`node:crypto`/`node:url` +
  `node:child_process` for the tsc invoke — platform APIs only):
  1. **Copy** `apps/web/index.html` + every non-test file under
     `apps/web/src/` into `.vercel/output/static` (the prebuilt
     deployment's static tree). The `.ts` files are served as static
     data — the content-type is irrelevant, the loader reads `.text()`.
     Test sources (`*.test.ts`) are never published.
  2. **Substitute** the shell's `window.__TRADRL_CONSOLE__` block ON THE
     COPY (apps/web is frozen — never edited):
     - `apiOrigin: 'http://localhost:8787'` → `apiOrigin: ''` — the
       EMPTY origin is the shell's own same-origin default
       (`apps/web/src/index.ts` `apiBaseUrl` returns the page's own
       origin when no origin is configured), so the console talks to
       `/v1` on the SAME origin the page was served from.
     - `token` / `tenantId` / `projectId` / `simulated` ← the
       `TRADRL_CONSOLE_*` build env (see §3). Absent values leave the
       shipped defaults — the console then degrades honestly (its
       readable no-token/no-tenant boot message), never a blank page.
     The substitution anchors are pinned against the frozen shell and
     fail the build LOUDLY if apps/web ever drifts. The build is
     deterministic: identical inputs → identical bytes (pinned by a
     test; the build manifest carries file names + SHA-256 digests
     only — never the substituted values).
- **The API (serverless, prebuilt — W-3k).** The build itself emits the
  function as `.vercel/output/functions/api/router.func/`: it runs the
  workspace's own `tsc` (a devDependency, provisioned by the install
  step; NEVER an npm addition to `deploy/`) with
  `deploy/vercel/function.tsconfig.json` (`module: CommonJS` +
  `moduleResolution: node` — the W-3i/W-3j laws, now owned by the
  build) over the true entry `deploy/vercel/api/router.ts`, then seals
  the tree with the `.func` envelope (index.js + `.vc-config.json` + a
  root `package.json` with NO `"type"` field). Because the platform
  accepts the prebuilt tree as-is, `@vercel/node` never typechecks,
  bundles, or copies anything — the whole chain of platform-builder
  failures (W-3h discovery, W-3i nodenext typecheck, W-3j ESM emit,
  W-3k `type:module` copy-poison) is eliminated by construction. The
  emitted function wraps the T041 route table: it composes the
  service ONCE per instance (`runtime/compose.ts`, memoized — warm
  invocations reuse it), adapts each `(req, res)` into the
  `ApiRequest`/`ApiResponse` contracts (`runtime/http.ts` — the
  platform hands the function `req.url` = the ORIGINAL public path
  under the config.json routes; the mount-strip is the guard for
  direct-mount invocations, so the route table sees the original
  `/v1/...` path either way), and lets `service.handle()` run the whole pipeline. **No route
  is re-implemented; no pipeline stage is skipped.** The host owns
  exactly what T041's composition root demands: the credential
  registry (env-sourced tokens, minted at this secure boundary), the
  instant source, and the five backing-service ports.
  The build CLEANS `.vercel/output` first (stale artifacts never leak
  into a deployment) and is deterministic end-to-end (byte-identical
  outputs for identical inputs — test-pinned across the whole prebuilt
  tree; the build manifest carries names + SHA-256 digests only, never
  values).
- **The backing services (the W-3f backing resolution).** Which ports
  back the five data-route families is resolved from the environment
  once per composition (`runtime/env.ts` → `resolveDeployBacking`):
  - **DEMO — the default when NO durable-provider key (`NEON_*`,
    `UPSTASH_*`) is configured** (overridable: `TRADRL_DEPLOY_BACKING=demo`).
    The five ports are the REAL in-memory fakes from the frozen
    service's own fixtures (`runtime/demo.ts` imports
    `services/api/src/fixtures.ts` exactly the way the seam already
    imports `createApiService` — wrapped, never edited), seeded with
    the fixture demo data for the deployment's credential tenant: one
    demo project (`prj-demo-console`, created + bound THROUGH the real
    routes), the fixture knowledge records, one demo outcome +
    post-mortem pair, a routed-submission gateway, and the recording
    job port. `/v1/projects`, `/v1/jobs`, `/v1/knowledge`,
    `/v1/outcomes`, `/v1/execution` all really serve data —
    **per-instance in-memory state**: serverless cold starts reset it,
    which is acceptable and honest under the SIMULATED badge
    (UX-DESIGN §7). With the internal credential configured, the demo
    also plays the machinery role through the REAL private plane: an
    org-status snapshot is reported at boot (the watch surface serves
    `org:tradrl-demo`), and a per-request tick advances non-terminal
    jobs `submitted -> running -> complete` (~3 s / ~8 s after
    submission) so the launch journey's async progress renders.
  - **DURABLE — the moment any durable-provider key is configured**
    (overridable: `TRADRL_DEPLOY_BACKING=durable`). The durable
    adapters are built and tested in `deploy/adapters/` + `deploy/wire/`
    (W-3b..W-3d), and the async-to-sync **hydration seam LANDED as
    W-25D** (`deploy/vercel/runtime/durable.ts`;
    `deploy/wire/production.md` §the sync/async bridge): the Neon-backed
    surfaces (the control plane, firm memory, outcome learning) are SYNC
    in-memory ports hydrated from the durable stores at every cold
    start, with write-through on every mutation — a launched project +
    its goal set, organization bindings and lifecycle events persist in
    Neon and REHYDRATE on every instance (D-5). Since **W-26B** the
    seam-live durable resolution is a **SUPERSET of demo** — everything
    the demo backing serves, PLUS the Neon persistence
    (`deploy/vercel/runtime/durable-world.ts`): the SAME simulated
    execution gateway + job-submission engines the demo backing composes
    (imported from the frozen fixtures — `POST /v1/execution/requests`
    routes, `POST /v1/jobs/*` answer 202, the launch journey J3 works),
    the SAME per-request machinery tick over the hydrated control plane
    (org compile + job advancement through the real private plane), the
    SAME demo world seed (once per DATABASE — the hydrated registry
    guard skips the create on subsequent boots; the per-instance job
    store re-seeds its two demo jobs each boot), and the fixture
    substance (the demo knowledge capsule, outcome + post-mortem)
    boot-written into the Neon stores through the STORE layer (guarded,
    idempotent — the read-only ports then serve it like any durable
    row). Every boot-world durable write drains before the first serve
    (the W-25D ordering law); a failed write is the typed 503, retried
    per request (never a crash, never a silent partial world). The
    org-status snapshots re-report per instance after each cold start
    (R7 — the frozen service's watch store is per-instance; disclosed).
    With the Neon keys INCOMPLETE (or Neon down) the Neon-backed routes
    answer the typed degraded 503s (R46) while everything else keeps
    serving; in that seam-not-built state the execution gateway keeps
    its honest `deploy_adapter_pending` stub and the job port follows
    the matrix for Apify (absent keys -> the typed absent) — the
    gateway/seed/tick NEVER run there. The async Apify bridge remains a
    later seam (the host-owned ingestion lanes keep their own matrix).
    The DEMO path stays byte-identical (the seam activates only on the
    durable resolution).
  - An **invalid** `TRADRL_DEPLOY_BACKING` value is a host
    misconfiguration: the typed `deploy_not_configured` 503 naming the
    key and its two legal values (fail-closed; never the value).
  Before first durable use, apply the Neon DDL records (below).

### The Neon schema (apply once — the runbook's §neon paste block)

`deploy/adapters/neon/schema.ts` carries the DDL records for the six
tenant-scoped tables (`tradrl_knowledge`, `tradrl_outcomes`,
`tradrl_post_mortems`, `tradrl_projects`, `tradrl_project_events`,
`tradrl_project_goals` — the W-25D seam's create-project goal sets;
every PRIMARY KEY leads with `tenant`). To apply, paste
`NEON_DDL_RECORDS`' statements into the Neon SQL editor (or psql)
once per database — `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF
NOT EXISTS` keep it idempotent, no migration tooling (zero-dep law).

### Why vercel.json lives in deploy/vercel/ (and the root hosting copy)

The frozen write surface allows edits ONLY under `deploy/**` (+ the
granted root include lines). Vercel, however, reads `vercel.json` from
the project root — so the root carries exactly ONE hosting-exception
file (the Lead's b4561b7 ruling):

- **`./vercel.json`** — committed (b4561b7), byte-identical to
  `deploy/vercel/vercel.json` (test-pinned; git-based Vercel deploys
  read it from the root). The runbook's earlier host-side `cp` step is
  retired — the durable copy replaced it.

The W-3h/W-3i root `api/` hosting-exception files (the discovery shim
`api/router.ts` + the nearest-tsconfig pin `api/tsconfig.json`) are
**RETIRED** by W-3k: they existed only because the platform's
`@vercel/node` builder had to discover, typecheck, and emit the
function itself. The prebuilt path builds the function in
`deploy/vercel/build-console.mjs`, so NO repo-root `api/` directory may
exist — a resurrected one would make `@vercel/node` discover a function
again and re-enter the exact failure chain W-3k eliminates
(test-pinned: the repo-root `api/` must not exist).

All paths inside the config are repo-root-relative and verified by
`deploy/vercel/vercel.test.ts` (including the root-copy byte-identity).

### The hosting configuration (deploy/vercel/vercel.json)

| Setting | Value | Why |
| --- | --- | --- |
| `framework` | `null` | no framework — the build emits the whole prebuilt deployment |
| `installCommand` | `corepack pnpm install --frozen-lockfile --prefer-offline` | the BUILD TOOLCHAIN provision: the workspace's own devDependencies (typescript + @types/node) for the tsc emit — frozen (the lockfile is never modified, nothing added). Probe-proven live (trrl-echo-probe): a no-op echo install leaves the build image with NO node_modules — the build would die at its own loud no-tsc failure |
| `buildCommand` | `node deploy/vercel/build-console.mjs` | emits the COMPLETE prebuilt `.vercel/output` (config.json + static/ + the .func) |
| `regions` | `iad1` (single) | Hobby = one region |

Deliberately ABSENT keys (the prebuilt law, test-pinned): `functions`,
`rewrites`, `outputDirectory` — all routing and outputs live in the
EMITTED `.vercel/output/config.json` + tree. `@vercel/node` is never
invoked (no repo-root `api/` directory exists).

---

## 2. Provider account setup (free tiers — D-033 set)

Every provider below has a free tier that covers the demo/public
deployment. **Cost surface:** at the documented usage (a public demo
console + a handful of agent journeys J1–J12), the expected bill is
**$0**. The table names each provider's free-tier limits at the time of
writing — re-check on signup; none of the clients depend on
beyond-free-tier features.

| Provider | Role | Free tier (covers) | Signup |
| --- | --- | --- | --- |
| **Vercel** | hosting: static console + serverless API functions | Hobby plan (personal, non-commercial): 100 GB-h serverless execution/mo, 100 GB bandwidth/mo, 1024 MB/function, ≤60 s (we use 10 s), 1 region | vercel.com → Sign up (GitHub SSO) |
| **Neon** (W-3b) | durable Postgres: the control-plane / firm-memory / outcome-learning stores (table-per-port, tenant-scoped rows) | Free plan: 0.5 GB storage, one project, autosuspend (cold starts are fine — R46 degradation covers them) | neon.tech → Sign up → create project (region `aws-us-east-1` to co-locate with `iad1`) |
| **Upstash** (W-3b) | Redis: rate-limit cache + idempotency-key store (REST API) | Free plan: 500k commands/mo, 1 database, max 256 MB | upstash.com → Sign up → create a Redis (Regional, free) database |
| **Cloudflare R2** (W-3c) | evidence/blob store (S3-compatible API, SigV4) | Free tier: 10 GB storage, 1M Class-A + 10M Class-B ops/mo, ZERO egress fee | dash.cloudflare.com → sign up → R2 (needs a payment card on file for verification; the free tier is not charged at demo usage) |
| **Resend** (W-3c) | email notice delivery (the eight UX.md notification types) | Free plan: 3,000 emails/mo, 100/day, one custom domain (or the onboarding sender) | resend.com → Sign up → API Keys |
| **Apify** (W-3c) | data-ingestion job runs + schedules (market/news/alt-data feeds through the T037/T038 adapter contracts) | Free plan: $5 platform credit/mo | apify.com → Sign up → Settings → API tokens |

Keep every credential in a password manager; only the env vars below
ever cross into the deployment.

---

## 3. Environment variables (the complete inventory)

The single machine-readable inventory is **`deploy/.env.example`** —
every key the deployment reads, with its purpose. Summary:

### API plane (Vercel function runtime env)

| Key | Purpose | Where it comes from |
| --- | --- | --- |
| `TRADRL_API_DEVELOPER_TOKEN` | the public-plane credential token (Bearer) — registered in the function's credential registry | **you mint it**: `openssl rand -hex 24`; the SAME value is the console's `TRADRL_CONSOLE_TOKEN` |
| `TRADRL_API_DEVELOPER_TENANT` | the credential's L12 tenant id — the isolation root injected into every request it makes | you choose (e.g. `tenant-demo`) |
| `TRADRL_API_DEVELOPER_PRINCIPAL` | the credential's principal name (audit WHO) | you choose (e.g. `public-console`) |
| `TRADRL_API_INTERNAL_TOKEN` | the private-plane (`/internal/*`) credential token — **optional**: absent = the internal plane stays closed (R46) | `openssl rand -hex 24` |
| `TRADRL_API_INTERNAL_PRINCIPAL` | the internal service principal (required when the internal token is set) | you choose (e.g. `job-runner`) |
| `TRADRL_DEPLOY_BACKING` | **optional** — which backing the data routes compose over: `demo` (the in-memory fixture-backed demo; per-instance state, honest under SIMULATED; byte-identical whether or not Neon keys are present) or `durable` (the W-25D hydration seam + the W-26B activation: the Neon-backed surfaces rehydrate per instance with write-through, and the durable resolution is a SUPERSET of demo — the same simulated gateway/jobs engines, the same machinery tick, the same demo world seed + fixture substance, every boot-world write drained before the first serve; incomplete Neon keys keep the typed `deploy_adapter_absent` 503s and the gateway/seed/tick never run). **UNSET = auto**: `demo` when no `NEON_*`/`UPSTASH_*` key is configured (the public free-tier default), `durable` the moment any is. An invalid value fails closed (the typed 503 naming the key) | unset (auto) |

### Console shell substitution (Vercel BUILD-time env — consumed by build-console.mjs)

| Key | Purpose |
| --- | --- |
| `TRADRL_CONSOLE_TOKEN` | substituted into the shell's config block — must equal `TRADRL_API_DEVELOPER_TOKEN` |
| `TRADRL_CONSOLE_TENANT_ID` | the tenant scope the console boots with (must equal `TRADRL_API_DEVELOPER_TENANT`) |
| `TRADRL_CONSOLE_PROJECT_ID` | optional initial project (`''` = the launchpad) |
| `TRADRL_CONSOLE_SIMULATED` | the SIMULATED environment badge (UX-DESIGN §7 anti-deception). Default `true`; flip to `false` ONLY when the durable adapters (W-3b..W-3d) are wired |

### Reserved for the adapter checkpoints (documented, not yet wired)

`NEON_API_HOST` / `NEON_DATABASE` / `NEON_API_KEY` (W-3b);
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (W-3b);
`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_ENDPOINT` (W-3c);
`RESEND_API_KEY` / `RESEND_FROM` (W-3c);
`APIFY_API_TOKEN` / `APIFY_DEFAULT_RUNS_ENDPOINT` (W-3c).

**Secrets are never hardcoded** — no key value lives in git (a test
scans `deploy/` for credential literals). The console token is, by the
console's own design, a browser-visible demo credential (the host
injects it into the shell at the secure boundary — anything the browser
carries is public); the API's registry decides what it may do.

---

## 4. Deploy steps (end-to-end)

Prereqs: a GitHub checkout of this branch, Node ≥ 20, the Vercel CLI
logged in (`npx vercel login` — the CLI is a host-side convenience, not
a dependency of the repo).

1. **Create the Vercel project.**
   ```
   npx vercel link           # in the repo root; create new project, e.g. tradrl-console
   ```
2. **Set the environment variables** (Production + Preview):
   - Runtime: `TRADRL_API_DEVELOPER_TOKEN`, `TRADRL_API_DEVELOPER_TENANT`,
     `TRADRL_API_DEVELOPER_PRINCIPAL`, plus the optional internal pair
     `TRADRL_API_INTERNAL_TOKEN` + `TRADRL_API_INTERNAL_PRINCIPAL`
     (**set the internal pair for the full demo**: it enables the
     org-status watch snapshot + the job-animation machinery — without
     it org-status stays honestly empty and jobs stay `submitted`).
     Leave `TRADRL_DEPLOY_BACKING` unset (auto: the demo backing while
     no `NEON_*`/`UPSTASH_*` key is configured).
   - Build: `TRADRL_CONSOLE_TOKEN` (same value as the developer token),
     `TRADRL_CONSOLE_TENANT_ID` (same tenant), optionally
     `TRADRL_CONSOLE_PROJECT_ID=prj-demo-console` to boot straight into
     the seeded demo view; leave `TRADRL_CONSOLE_SIMULATED` unset
     (`true`) — the demo backing is exactly what the badge discloses.
   Via dashboard → Settings → Environment Variables, or:
   ```
   npx vercel env add TRADRL_API_DEVELOPER_TOKEN production
   # ... repeat per key; values are read from stdin, never logged by this repo
   ```
3. **Verify the root hosting copy** (the hosting exception, b4561b7 —
   COMMITTED, nothing to copy): the root `vercel.json` must be
   byte-identical to `deploy/vercel/vercel.json` (test-pinned), and
   there must be NO repo-root `api/` directory (the prebuilt law — a
   resurrected one would re-trigger `@vercel/node`; test-pinned).
4. **Deploy.**
   ```
   npx vercel --prod
   ```
   What happens: the install step provisions the frozen lockfile state
   (the build toolchain only), then the build command emits the
   COMPLETE prebuilt Build Output API v3 deployment — it CLEANs
   `.vercel/output`, copies + substitutes apps/web into
   `.vercel/output/static`, runs the workspace's own `tsc` over the
   function entry graph (`deploy/vercel/function.tsconfig.json`:
   CommonJS + node resolution) into
   `.vercel/output/functions/api/router.func`, and seals it (index.js +
   `.vc-config.json` + the no-`type` root package.json) — and writes
   `.vercel/output/config.json` with the two routes (`/v1/*`,
   `/internal/*` → `/api/router`). The platform accepts the prebuilt
   tree as-is (`@vercel/node` never runs) and publishes the same-origin
   `/v1` + `/internal` planes.
5. **First verification (the smoke sequence — backing=demo expectations).**
   ```
   BASE=https://<project>.vercel.app
   TOKEN=<the TRADRL_API_DEVELOPER_TOKEN value>
   curl -s $BASE/v1/meta                                    # → 401 envelope (pipeline: authn first)
   curl -s -H "Authorization: Bearer $TOKEN" $BASE/v1/meta
                                                           # → 200 {"requestId":...,"data":{"apiVersion":"v1",...}}
   curl -si -H "Authorization: Bearer $TOKEN" $BASE/v1/meta | grep -i access-control
                                                           # → NO OUTPUT (the same-origin law: no CORS headers)
   curl -s -H "Authorization: Bearer $TOKEN" $BASE/v1/projects
                                                           # → 200 {"data":{"items":[{"id":"prj-demo-console",...}]}}
                                                           #   (the demo backing: the seeded fixture data — NOT a 503)
   curl -s -H "Authorization: Bearer $TOKEN" -X POST -H 'content-type: application/json' \
        -d '{"project":"prj-demo-console","at":1730000000000}' $BASE/v1/knowledge/query
                                                           # → 200 with the fixture knowledge record
   curl -s $BASE/src/loader/strip-types.ts | head -1        # → the loader source (the no-build loader's fetch works)
   ```
   Then open `$BASE/` in a browser: the console boots (theme pre-paint,
   the SIMULATED badge, the twelve sections) with the substituted
   token/tenant; the connection block shows the API reachable. With
   `TRADRL_CONSOLE_PROJECT_ID=prj-demo-console` the sections land on
   the seeded demo data (project + knowledge + outcome/post-mortem +
   the watch snapshot when the internal pair is set); run the launch
   flow and watch the kickoff job animate submitted → running →
   complete (~3 s / ~8 s) when the internal pair is set.
   Troubleshooting (the full W-3h→W-3k history — every row below was a
   LIVE production failure, root-caused and fixed):
   - **`/v1/*` (or `/internal/*`) returns Vercel's NOT_FOUND page** (not
     the API's JSON envelope): the route destination must be the EXACT
     function path (`/api/router`), never a subpath — Vercel functions
     match their exact path only, and subpath destinations
     (`/api/router/v1/:path*`) can never resolve (W-3j, probe-proven
     on tradrl-router-probe). In the prebuilt deployment the routes
     live in the EMITTED `.vercel/output/config.json` — check the
     emitted `dest` values against `FUNCTION_MOUNT_PATH`
     (`deploy/vercel/runtime/http.ts`; test-pinned equal). Also confirm
     the root `vercel.json` matches `deploy/vercel/vercel.json` (step
     3) and the function appears in the deployment's Functions tab as
     `api/router`.
   - **The exact function path answers FUNCTION_INVOCATION_FAILED
     (500)** — the module-load crash class, three known causes:
     - `ERR_MODULE_NOT_FOUND` or "Cannot use import statement outside a
       module" in the logs → the function emit is ESM (W-3j): the
       emit must be CommonJS (`deploy/vercel/function.tsconfig.json`:
       `module: "CommonJS"`; the repo package.json has no `"type"`
       field, so the runtime loads CJS). NEVER add file extensions to
       the frozen `services/api` imports — pin the emit instead.
     - `ReferenceError: exports is not defined in ES module scope` →
       the W-3k type:module poison: some `package.json` with
       `"type": "module"` ended up INSIDE the `.func` (the
       `@vercel/node` emit copied `services/api/package.json` next to
       the emitted CJS graph, so Node treated the CommonJS text as
       ESM). The prebuilt emit produces `.js` files ONLY and seals the
       `.func` with a root `package.json` carrying NO `"type"` field —
       test-pinned: NO other `package.json` may exist anywhere in the
       `.func`.
     - The build log itself says the deployment is prebuilt ("Build
       Completed in /vercel/output") — if instead you see
       `@vercel/node` running, a repo-root `api/` directory exists and
       the prebuilt path is OFF (test-pinned: it must not exist).
   - **The function BUILD fails with TS2835** ("Relative import paths
     need explicit file extensions in ECMAScript imports" — a
     nodenext typecheck, W-3i): the emit config
     `deploy/vercel/function.tsconfig.json` drifted — restore `module:
     "CommonJS"` + `moduleResolution: "node"` (node10 keeps the
     frozen extensionless imports legal); NEVER add extensions to the
     frozen `services/api` imports.
   - **The build fails with `build-console: the TypeScript compiler is
     missing`** (the loud no-tsc failure): the install step no longer
     provisions the workspace devDependencies — restore the
     frozen-lockfile `installCommand` (probe-proven live on
     trrl-echo-probe: an echo install leaves the build image with NO
     node_modules). NEVER add an npm dependency to `deploy/` to work
     around this — the provision comes from the workspace's own
     lockfile.
   - **The build fails on the config.json validation** (an `images`
     key demanding `sizes`): the emitted `config.json` must carry
     exactly `version` + `routes` and NO `images` key (probe-proven —
     the platform rejects the images key without sizes).
   - If the data routes answer 503 `deploy_adapter_pending`, a
     `NEON_*`/`UPSTASH_*` key is configured (the durable backing was
     auto-selected) — unset those keys or set
     `TRADRL_DEPLOY_BACKING=demo` for the demo.
6. **The J1–J12 journey catalog (the Lead's acceptance gate).** Run
   the UX-DESIGN.md J1–J12 journeys with an agent browser against
   `$BASE/` — every journey must pass on the live deployment before
   the PR opens (per the D-036 Lead ruling). W-3f expectation under
   the demo backing (the default): the data-backed journeys work —
   J3's launch flow creates + submits + (with the internal pair)
   animates to complete, J4's watch feed folds the seeded snapshot /
   outcome / job / submission events, J5's Time Machine projects the
   seeded records, J6's notices derive from the seeded data, J7's
   evidence capsules render from the seeded outcome/knowledge — all
   honestly labeled SIMULATED (per-instance state: a cold start resets
   the demo world to its seed).

## 5. Rollback

Vercel keeps every production deployment immutable:

```
npx vercel ls                 # list deployments
npx vercel rollback <url-or-id>   # repoint the production alias at the previous deployment
```

Rules of engagement:
- **Bad code/config** → `vercel rollback` to the previous deployment
  (instant, no rebuild). The git branch `work/T052-public-deployment`
  is the audit trail; fix forward on the branch.
- **Bad environment values** (e.g. a rotated token pair mismatch) →
  fix the env vars and `npx vercel --prod` again; rollbacks do not
  change env vars.
- **Provider outage** → do NOT roll back: the R46 degradation model
  (§6) is designed to hold the surface while a provider is down.
- The console and the API deploy together (one project) — there is no
  partial-state risk between them.

## 6. The degradation model (R46 — provider absent/down is a typed state, never a crash)

| What is absent / which backing | What the API does | What the console does |
| --- | --- | --- |
| **Demo backing** (the default: no `NEON_*`/`UPSTASH_*` key; the SIMULATED badge is the disclosure) | The data routes serve the seeded fixture demo data over the REAL in-memory fake ports (`runtime/demo.ts`) — per-instance state: a serverless cold start resets the demo world to its seed (projects/jobs created in the session drop; the seed itself re-lands at the next boot) | The data-backed journeys render real (if simulated) data; the SIMULATED badge stays on (UX-DESIGN §7 — do NOT set `TRADRL_CONSOLE_SIMULATED=false` under the demo backing) |
| Demo backing + internal pair ABSENT | The org-status store stays empty (the honest typed `not_found` — only the private plane can write it) and the job machinery never ticks (submissions stay `submitted`) | The watch section folds the job/outcome/knowledge events; no org-snapshot events; the launch progress shows `submitted` |
| **Durable backing** (any `NEON_*`/`UPSTASH_*` key, or `TRADRL_DEPLOY_BACKING=durable`; with the Neon keys complete the W-25D hydration seam serves the Neon-backed surfaces from the per-instance projection — a launched project + its world rehydrates on every cold start, D-5) | With the Neon keys INCOMPLETE the Neon-backed routes answer the **typed 503 `unavailable`** (`deploy_adapter_absent`); with them complete but Neon DOWN they answer the typed `neon_unreachable` per request (a failed durable write is the typed 503 and the mutation is unconfirmed). The pipeline, authn/authz, rate limits, metering and audit still run on every request | The affected sections render their **unavailable/degraded states** (availability model); the shell never blanks |
| A provider down/misconfigured (the W-25D seam wires the Neon-backed surfaces; the Upstash/R2/Resend/Apify lanes follow the matrix) | The affected routes answer the provider's typed degraded code (per `deploy/wire/production.md` §the degradation matrix) — never a crash | as above (the T042 graceful-degradation contract) |
| An INVALID `TRADRL_DEPLOY_BACKING` value | Every request answers the **typed 503 `deploy_not_configured`** naming the KEY and its two legal values (never the value) | The console's connection block shows the API reachable-but-degraded |
| `TRADRL_API_INTERNAL_TOKEN` unset | The `/internal/*` plane stays CLOSED (401/403 — the credentials registry simply has no internal registration) | — (the console never calls `/internal`) |
| API env keys missing at function start | Every request answers the **typed 503 `deploy_not_configured`** naming the missing KEY NAMES (never values) | The console's connection block shows the API unreachable |
| `TRADRL_CONSOLE_TOKEN`/`_TENANT_ID` unset at build | The shipped defaults stay; the console boots into its readable "no credential token / no tenant injected" message (the T042 graceful-degradation contract) | A readable message, never a blank page |
| The API function unreachable | — | The console degrades per its availability model (retry, readable message) — the T042 contract |
| Neon autosuspended (cold) (the durable path, post-W-3e) | First query pays the wake latency; a timeout/5xx becomes the typed degraded state (never a crash) | as above |

## 7. Testing this tree

```
corepack pnpm vitest run deploy     # 201 tests (runtime adaptation vectors,
                                    # the backing-resolution matrix + the demo
                                    # data routes + the machinery tick + L12
                                    # probes, the W-25D durable seam
                                    # (cold-start survival, write-through,
                                    # the ordering law, the degradation
                                    # matrix, demo byte-identity) + the
                                    # W-26B activation (the J3 launch
                                    # journey end-to-end, the demo world's
                                    # two-boot law, the fixture boot-write
                                    # idempotency, the org compile + the
                                    # R7 snapshot re-report, the boot-world
                                    # failure law, the Neon-absent row —
                                    # deploy/vercel/durable.test.ts),
                                    # the prebuilt-output laws —
                                    # config.json routes === FUNCTION_MOUNT_PATH,
                                    # vercel.json carries NO routing keys,
                                    # the .func law (root package.json no-type,
                                    # NO inner package.json, index.js seal,
                                    # .vc-config envelope, require()-loadable),
                                    # function.tsconfig.json emit pin, the
                                    # toolchain provision pin, root-copy
                                    # byte-identity, NO repo-root api/, build
                                    # determinism + the stale-artifact law,
                                    # adapter + wire suites)
corepack pnpm typecheck             # 0 errors (deploy/** is in the root tsconfig
                                    # include; the FUNCTION EMIT's own graph is
                                    # owned by deploy/vercel/function.tsconfig.json
                                    # — W-3i resolution + W-3j CommonJS emit,
                                    # exercised for real by every build test)
```

No live provider calls anywhere in CI — every provider interaction is
pinned as a construction/determinism vector or runs against fakes
(the W-3d smoketest boots the API with deployment adapters against
fakes).

## 8. Status + what lands next (honest)

- **Checkpoints 1–4 (merged, T052):** runbook + hosting config + the
  function wrap + the console build; the five zero-dep provider
  adapters (Neon/Upstash/R2/Resend/Apify) + the composition wire +
  the CI smoketest — all offline-tested with pinned vectors.
- **W-3f (this follow-up, merged): the honest demo backing.** With no
  durable-provider keys configured (the public free-tier default), the
  deployed API serves the data routes over the frozen service's own
  fixture ports, seeded through the real routes for the credential
  tenant, with the internal-plane demo machinery (the org-status boot
  report + the per-request job tick). The public console's data-backed
  journeys (J3–J8) render real — if simulated — data; per-instance
  in-memory state, honestly disclosed by the SIMULATED badge.
- **W-3g (merged): the build-console CLI root fix** and **W-3h (merged):
  the Vercel function-mount fix.** The platform builds Serverless
  Functions ONLY from the repo-root `api/` directory — the first
  production deploy attempt (dpl_EDheNMGU3zN9pfsscQuSD9JMHYfT)
  failed on the `deploy/vercel/api/router.ts` functions key. The root
  `api/router.ts` discovery shim now re-exports the deploy tree's
  function (`FUNCTION_MOUNT_PATH` → `/api/router`); the root
  `vercel.json` byte-identity and the discovery law are test-pinned.
- **W-3i (merged): the @vercel/node typecheck resolution pin.**
  The redeploy from main @ 96ac873 (dpl_Ajr2KCQmT9axQGwDEcvpBkLFc4aV)
  served the static console but dropped the function (/v1/* →
  Vercel's NOT_FOUND): @vercel/node's build-time typecheck ran
  `moduleResolution: nodenext` (its default synthesis when no tsconfig
  is nearer the entry) and rejected the repo's extensionless imports
  (TS2835 — the TS2339/TS2322 errors were type-collapse cascades). The
  root `api/tsconfig.json` pin — the nearest tsconfig on the entry's
  walk-up — pinned the resolution the whole repo proves green
  (reproduced locally: 193 errors under nodenext — 58× TS2835 +
  135 type-collapse cascades; proven: 0 errors under the pin, on the
  exact entry + import-closure graph). Law
  test-pinned: never add extensions to the frozen `services/api`
  imports to satisfy a build tool.
- **W-3j (merged): the function EMIT + the exact-path
  rewrites.** The redeploy from main @ 976b12a
  (https://tradrl-console.vercel.app) served the static console but
  the API plane was dead, for two root-caused reasons. (1) The
  rewrites could never match: their destinations
  (`/api/router/v1/:path*`, `/api/router/internal/:path*`) carried
  subpath segments, and Vercel functions match their EXACT path only —
  probe-proven on the platform (tradrl-router-probe): destination =
  the mount (`/api/router`), and the function receives `req.url` =
  the ORIGINAL public path (`/v1/meta` stays `/v1/meta`; the matched
  segments arrive as a `path` query param). Both rewrites were
  repointed to `/api/router`; the runtime's mount-strip stays as the
  direct-mount guard. (2) The exact function path itself answered
  FUNCTION_INVOCATION_FAILED: the emitted function was ESM
  (`module: "ESNext"` — W-3i fixed the typecheck, the emit stayed
  ESM) with extensionless specifiers Node cannot load
  (ERR_MODULE_NOT_FOUND / "Cannot use import statement"); the repo
  has no `"type": "module"`, so the runtime loads CJS. The pin became
  `module: "CommonJS"` + `moduleResolution: "node"` (node10 —
  extensionless imports stay legal; the frozen sources untouched;
  "Bundler" is invalid with CommonJS, TS5095). Proven by the
  EMIT+EXECUTE gate: the emitted function is `require()`d and serves
  the four smoke vectors (401 unauthenticated, 200 meta, 200
  direct-mount meta, 200 knowledge query). Both laws test-pinned.
- **W-3k (this follow-up): the prebuilt function hosting (Build
  Output API v3).** The W-3j redeploy STILL died on the exact
  function path — the API plane answered FUNCTION_INVOCATION_FAILED
  while the static console served, TWO stacked root causes, both
  understood and platform-proven by the Lead's live probes. (1) The
  `type:module` poison: `@vercel/node`'s tsc-emit-and-copy put the
  emitted CJS graph under `services/api/package.json`'s
  `"type":"module"` — Node treated the CommonJS-emitted text as ESM
  and every invocation died at module load
  (`ReferenceError: exports is not defined in ES module scope`).
  (2) The rewrites: vercel.json rewrites with subpath destinations
  can never match (functions match exact paths only — the W-3j
  lesson, but vercel.json rewrites could not express the working
  shape). THE FIX (validated LIVE by the Lead, probe projects
  trrl-probe-tepa + trrl-echo-probe on the tepa team, still live):
  the build command now emits a PREBUILT Build Output API v3
  deployment (`.vercel/output`: `config.json` `{"version":3,"routes":
  [{"src":"/v1/(?<path>.*)","dest":"/api/router"}, {"src":"/internal/(?<path>.*)","dest":"/api/router"}]}`
  with NO `images` key; `static/` = the console build;
  `functions/api/router.func/` = the tsc CommonJS emit
  (`deploy/vercel/function.tsconfig.json`, rootDir = the repo root)
  sealed by `index.js`
  (`module.exports = require('./deploy/vercel/api/router').default;`),
  `.vc-config.json` (`nodejs24.x`, 1024 MB, 10 s, `index.js`,
  `Nodejs`) and a root `package.json` with NO `"type"` field and NO
  inner `package.json` anywhere) — and `vercel build` accepts it
  as-is: `@vercel/node` NEVER runs (the repo-root `api/` exception
  files are RETIRED — a resurrected `api/` would re-trigger it,
  test-pinned). The install step became the frozen-lockfile toolchain
  provision (probe-proven: an echo install leaves the build image
  with NO node_modules). The function still receives `req.url` = the
  ORIGINAL public path verbatim (probe-proven: `/v1/meta?q=1` →
  `req.url` `/v1/meta?q=1`); direct `/api/router` also invokes it
  (the mount-strip guard covers both shapes). Proven by the
  EMIT+EXECUTE gate (all four vectors green through the sealed
  `.func`) + a LIVE staging deployment (the seven-point smoke,
  runbook §4 step 5). All laws test-pinned
  (deploy/vercel/vercel.test.ts + the build tests).
- **W-3e → LANDED as W-25D: the async-to-sync hydration seam.** T041's
  port methods are synchronous by design; the durable adapters are
  async. The seam (`deploy/vercel/runtime/durable.ts`) bridges the two
  without editing either frozen tree: the composition root is injected
  with sync in-memory ports whose state is a projection of the durable
  stores — hydrated at every cold start (the REAL T007 control plane
  reconstructs each project through its own domain law) and
  write-through'd on every mutation (the host drains the durable
  writes before the response is served; a failed write is the typed
  503 + a re-projection — never a silent divergence). If T041 ever
  widens its ports to async (a frozen-sibling change), the adapters
  drop in unchanged. Everything durable is built and tested offline.
