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
  `deploy/`, no `package.json`, `pnpm-lock.yaml` NEVER touched (the
  Vercel `installCommand` is a no-op echo — nothing is installed even at
  deploy time).
- **Frozen siblings** — `services/api` is WRAPPED (its route table is
  invoked from `deploy/vercel/api/router.ts`; the service is never
  edited), `apps/web` is deployed AS-IS through a build step OWNED BY
  `deploy/` (the shell copy is substituted host-side; the package tree
  is never edited).
- **Same-origin /v1** — the console reaches the API through Vercel
  rewrites on ONE origin. NO CORS headers are ever emitted (pinned by
  `deploy/vercel/vercel.test.ts`).
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
├── /*              static: the console build      (deploy/vercel/dist/console)
│   ├── index.html     the T042/T051 shell with the PRODUCTION config block
│   └── src/**/*       the console's TypeScript sources, served as static
│                      files (DATA — the no-build loader fetches them as
│                      text and strips types IN THE BROWSER)
├── /v1/*           rewrite → serverless function  (destination = the exact
│                   function path /api/router; the platform hands the
│                   function req.url = the ORIGINAL public path — W-3j)
└── /internal/*     rewrite → the same function    (the private plane)
```

- **The console (static).** apps/web is a *no-build* application: the
  shell fetches `./src/...` TypeScript at runtime through the
  erasable-type loader. "Building" it therefore means exactly two
  things, performed by `deploy/vercel/build-console.mjs`
  (zero-dep: `node:fs`/`node:path`/`node:crypto` only):
  1. **Copy** `apps/web/index.html` + every non-test file under
     `apps/web/src/` into `deploy/vercel/dist/console` (the vercel.json
     `outputDirectory`). The `.ts` files are served as static data —
     the content-type is irrelevant, the loader reads `.text()`. Test
     sources (`*.test.ts`) are never published.
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
- **The API (serverless).** Vercel discovers the function through the
  repo-root `api/router.ts` discovery shim (W-3h: the platform builds
  Serverless Functions ONLY from the repo-root `api/` directory),
  which re-exports `deploy/vercel/api/router.ts` — a single
  Vercel Node function wrapping the T041 route table: it composes the
  service ONCE per instance (`runtime/compose.ts`, memoized — warm
  invocations reuse it), adapts each `(req, res)` into the
  `ApiRequest`/`ApiResponse` contracts (`runtime/http.ts` — the platform
  hands the function `req.url` = the ORIGINAL public path under the
  rewrites; the mount-strip is the guard for direct-mount invocations,
  so the route table sees the original `/v1/...` path either way), and lets `service.handle()` run the whole pipeline. **No route
  is re-implemented; no pipeline stage is skipped.** The host owns
  exactly what T041's composition root demands: the credential
  registry (env-sourced tokens, minted at this secure boundary), the
  instant source, and the five backing-service ports.
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
    (W-3b..W-3d), but T041's port methods are synchronous by design
    while those adapters are async — the async-to-sync **hydration
    seam is the documented W-3e/lead step** (`deploy/wire/production.md`
    §the sync/async bridge). Until it lands, the durable backing
    composes the typed degraded stubs (`deploy_adapter_pending` → the
    typed 503 `unavailable`) — the honest pending state, R46.
  - An **invalid** `TRADRL_DEPLOY_BACKING` value is a host
    misconfiguration: the typed `deploy_not_configured` 503 naming the
    key and its two legal values (fail-closed; never the value).
  Before first durable use, apply the Neon DDL records (below).

### The Neon schema (apply once — the runbook's §neon paste block)

`deploy/adapters/neon/schema.ts` carries the DDL records for the five
tenant-scoped tables (`tradrl_knowledge`, `tradrl_outcomes`,
`tradrl_post_mortems`, `tradrl_projects`, `tradrl_project_events` —
every PRIMARY KEY leads with `tenant`). To apply, paste
`NEON_DDL_RECORDS`' statements into the Neon SQL editor (or psql)
once per database — `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF
NOT EXISTS` keep it idempotent, no migration tooling (zero-dep law).

### Why vercel.json lives in deploy/vercel/ (and the root hosting copies)

The frozen write surface allows edits ONLY under `deploy/**` (+ the
granted root include lines). Vercel, however, reads `vercel.json` from
the project root, builds Serverless Functions only from the repo-root
`api/` directory, and typechecks each function with the tsconfig.json
NEAREST its entry (walking up from the file) — so the root carries the
hosting-exception files (the Lead's b4561b7 ruling, W-3h/W-3i
extension):

- **`./vercel.json`** — committed (b4561b7), byte-identical to
  `deploy/vercel/vercel.json` (test-pinned; git-based Vercel deploys
  read it from the root). The runbook's earlier host-side `cp` step is
  retired — the durable copy replaced it.
- **`./api/router.ts`** — the discovery shim (W-3h): a pure re-export
  of the deploy tree's real function. This is part of the same hosting
  exception — a platform DISCOVERY requirement, not a surface change
  to the product (the deploy tree stays the source of truth).
- **`./api/tsconfig.json`** — the nearest-tsconfig resolution pin
  (W-3i): @vercel/node resolves the function build's compiler options
  from the tsconfig.json nearest `api/router.ts`, and without this pin
  its default synthesis (`moduleResolution: nodenext`) rejects the
  repo's extensionless relative imports (TS2835 — the frozen
  `services/api` sources are written extensionless). The pin extends
  `tsconfig.base.json` and pins the SAME `Bundler` resolution the
  whole repo typechecks green under (test-pinned). NEVER add file
  extensions to the frozen `services/api` imports to satisfy a build
  tool — pin the resolution here instead.

All paths inside the config are repo-root-relative and verified by
`deploy/vercel/vercel.test.ts` (including the root-copy byte-identity).

### The hosting configuration (deploy/vercel/vercel.json)

| Setting | Value | Why |
| --- | --- | --- |
| `framework` | `null` | no framework — static output + functions |
| `installCommand` | `echo ...` | ZERO-DEP: nothing installed, lockfile untouched |
| `buildCommand` | `node deploy/vercel/build-console.mjs` | the console build (§ above) |
| `outputDirectory` | `deploy/vercel/dist/console` | the ONLY public static tree (gitignored `dist/`) |
| `functions` | `api/router.ts` (the root discovery shim → `deploy/vercel/api/router.ts`) — 1024 MB, 10 s | within the Hobby free tier (≤1024 MB, ≤60 s); the platform builds functions ONLY from the repo-root `api/` directory |
| `regions` | `iad1` (single) | Hobby = one region |
| `rewrites` | `/v1/:path*` and `/internal/:path*` → `/api/router` (the EXACT function path, both — W-3j) | same-origin API: Vercel functions match their EXACT path only — a subpath destination (`/api/router/v1/:path*`) can never resolve (probe-proven); the platform hands the function `req.url` = the original public path |

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
| `TRADRL_DEPLOY_BACKING` | **optional** — which backing the data routes compose over: `demo` (the in-memory fixture-backed demo; per-instance state, honest under SIMULATED) or `durable` (the deploy/wire adapters' path; typed pending 503s until the W-3e hydration seam). **UNSET = auto**: `demo` when no `NEON_*`/`UPSTASH_*` key is configured (the public free-tier default), `durable` the moment any is. An invalid value fails closed (the typed 503 naming the key) | unset (auto) |

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
3. **Verify the root hosting copies** (the hosting exception, b4561b7 +
   W-3h — both are COMMITTED, nothing to copy): the root `vercel.json`
   must be byte-identical to `deploy/vercel/vercel.json` and the root
   `api/router.ts` discovery shim must re-export the deploy tree's
   function (both pinned by `deploy/vercel/vercel.test.ts`).
4. **Deploy.**
   ```
   npx vercel --prod
   ```
   What happens: the install step is a no-op (zero-dep), the console
   build copies + substitutes apps/web into
   `deploy/vercel/dist/console`, Vercel builds the root
   `api/router.ts` discovery shim (which bundles
   `deploy/vercel/api/router.ts` + the services/api import graph —
   its TypeScript is bundled by Vercel's own toolchain, the repo has
   no runtime dependencies), and the two rewrites publish the
   same-origin `/v1` + `/internal`.
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
   Troubleshooting:
   - If `/v1/*` (or `/internal/*`) returns Vercel's NOT_FOUND page (not
     the API's JSON envelope), the rewrite destination must be the
     EXACT function path (`/api/router`), never a subpath — Vercel
     functions match their exact path only, and subpath destinations
     (`/api/router/v1/:path*`) can never resolve (probe-proven, W-3j).
     Also confirm the root `vercel.json` matches
     `deploy/vercel/vercel.json` (step 3) and that the function appears
     in the deployment's Functions tab as `api/router`.
   - If the exact function path answers FUNCTION_INVOCATION_FAILED
     (500) with ERR_MODULE_NOT_FOUND or "Cannot use import statement
     outside a module" in the logs, the function tsconfig emitted ESM —
     it must emit CommonJS (`api/tsconfig.json`: `module: "CommonJS"` +
     `moduleResolution: "node"`; the repo package.json has no
     `"type"` field, so the runtime loads CJS — W-3j). NEVER add file
     extensions to the frozen `services/api` imports — pin the emit
     instead.
   - If the function BUILD fails with TS2835 ("Relative import paths
     need explicit file extensions in ECMAScript imports" — the build
     typechecked under `nodenext`), the `api/tsconfig.json`
     nearest-tsconfig pin (W-3i) is missing or drifted — restore it
     (extends `tsconfig.base.json`, `moduleResolution: "node"` with
     `module: "CommonJS"` per W-3j); NEVER add extensions to the frozen
     `services/api` imports.
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
| **Durable backing** (any `NEON_*`/`UPSTASH_*` key, or `TRADRL_DEPLOY_BACKING=durable`) | The data routes answer the **typed 503 `unavailable`** (`deploy_adapter_pending` — the adapters are composed in deploy/wire; the async-to-sync hydration seam is the W-3e/lead step, `deploy/wire/production.md`); the pipeline, authn/authz, rate limits, metering and audit still run on every request | The affected sections render their **unavailable/degraded states** (availability model); the shell never blanks |
| A provider down/misconfigured (once the W-3e seam wires the durable adapters) | The affected routes answer the provider's typed degraded code (per `deploy/wire/production.md` §the degradation matrix) — never a crash | as above (the T042 graceful-degradation contract) |
| An INVALID `TRADRL_DEPLOY_BACKING` value | Every request answers the **typed 503 `deploy_not_configured`** naming the KEY and its two legal values (never the value) | The console's connection block shows the API reachable-but-degraded |
| `TRADRL_API_INTERNAL_TOKEN` unset | The `/internal/*` plane stays CLOSED (401/403 — the credentials registry simply has no internal registration) | — (the console never calls `/internal`) |
| API env keys missing at function start | Every request answers the **typed 503 `deploy_not_configured`** naming the missing KEY NAMES (never values) | The console's connection block shows the API unreachable |
| `TRADRL_CONSOLE_TOKEN`/`_TENANT_ID` unset at build | The shipped defaults stay; the console boots into its readable "no credential token / no tenant injected" message (the T042 graceful-degradation contract) | A readable message, never a blank page |
| The API function unreachable | — | The console degrades per its availability model (retry, readable message) — the T042 contract |
| Neon autosuspended (cold) (the durable path, post-W-3e) | First query pays the wake latency; a timeout/5xx becomes the typed degraded state (never a crash) | as above |

## 7. Testing this tree

```
corepack pnpm vitest run deploy     # 146 tests (runtime adaptation vectors,
                                    # the backing-resolution matrix + the demo
                                    # data routes + the machinery tick + L12
                                    # probes, config invariants incl. the
                                    # root-shim discovery law + the root-copy
                                    # byte-identity + the W-3i/W-3j
                                    # resolution-and-emit pin + the W-3j
                                    # exact-path rewrites pin, build
                                    # determinism, adapter + wire
                                    # suites)
corepack pnpm typecheck             # 0 errors (api/** + deploy/** are in the root tsconfig
                                    # include; the FUNCTION BUILD's own graph is pinned
                                    # by api/tsconfig.json — W-3i resolution +
                                    # W-3j CommonJS emit)
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
- **W-3j (this follow-up): the function EMIT + the exact-path
  rewrites.** The redeploy from main @ 976b12a
  (https://tradrl-console.vercel.app) served the static console but
  the API plane was dead, for two root-caused reasons. (1) The
  rewrites could never match: their destinations
  (`/api/router/v1/:path*`, `/api/router/internal/:path*`) carried
  subpath segments, and Vercel functions match their EXACT path only —
  probe-proven on the platform (tradrl-router-probe): destination =
  the mount (`/api/router`), and the function receives `req.url` =
  the ORIGINAL public path (`/v1/meta` stays `/v1/meta`; the matched
  segments arrive as a `path` query param). Both rewrites now target
  `/api/router`; the runtime's mount-strip stays as the direct-mount
  guard. (2) The exact function path itself answered
  FUNCTION_INVOCATION_FAILED: the emitted function was ESM
  (`module: "ESNext"` — W-3i fixed the typecheck, the emit stayed
  ESM) with extensionless specifiers Node cannot load
  (ERR_MODULE_NOT_FOUND / "Cannot use import statement"); the repo
  has no `"type": "module"`, so the runtime loads CJS. The pin is now
  `module: "CommonJS"` + `moduleResolution: "node"` (node10 —
  extensionless imports stay legal; the frozen sources untouched;
  "Bundler" is invalid with CommonJS, TS5095). Proven by the new
  EMIT+EXECUTE gate: the emitted function is `require()`d and serves
  the four smoke vectors (401 unauthenticated, 200 meta, 200
  direct-mount meta, 200 knowledge query). Both laws test-pinned.
- **W-3e (the Lead step, unchanged): the async-to-sync hydration
  seam.** T041's port methods are synchronous by design; the durable
  adapters are async. Until T041 widens its ports (a frozen-sibling
  change) or a Lead-owned projection layer lands, the DURABLE backing
  keeps the typed pending stubs (`deploy/wire/production.md` §the
  sync/async bridge). Everything durable is built and tested offline.
