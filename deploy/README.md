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
├── /v1/*           rewrite → serverless function  (deploy/vercel/api/router.ts)
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
- **The API (serverless).** `deploy/vercel/api/router.ts` is a single
  Vercel Node function wrapping the T041 route table: it composes the
  service ONCE per instance (`runtime/compose.ts`, memoized — warm
  invocations reuse it), adapts each `(req, res)` into the
  `ApiRequest`/`ApiResponse` contracts (`runtime/http.ts` — strips the
  function mount prefix so the route table sees the original `/v1/...`
  path), and lets `service.handle()` run the whole pipeline. **No route
  is re-implemented; no pipeline stage is skipped.** The host owns
  exactly what T041's composition root demands: the credential
  registry (env-sourced tokens, minted at this secure boundary), the
  instant source, and the five backing-service ports.
- **The backing services (checkpoint status).** The five ports
  (`ControlPlanePort`, `FirmMemoryPort`, `OutcomeLearningPort`,
  `ExecutionGatewayPort`, `JobSubmissionPort`) are currently **typed
  degraded stubs** (`deploy_adapter_pending`) — see §6. The durable
  adapters (Neon/Upstash/R2/Resend/Apify) land in checkpoints
  W-3b..W-3d under `deploy/adapters/` + `deploy/wire/`; the composition
  seam in `runtime/compose.ts` is where they will be injected (the
  function code does not change shape when they arrive).
  **Checkpoint 2 (W-3b) status:** the durable STORE layer is built and
  tested offline — `deploy/adapters/neon/` (the zero-dep SQL-over-HTTP
  client + the firm-memory / outcome-learning / project stores,
  table-per-port, tenant-scoped rows — every statement binds the tenant
  as parameter 1; cross-tenant writes are the typed
  `cross_tenant_access`, foreign reads find nothing) and
  `deploy/adapters/upstash/` (the zero-dep REST client with Bearer
  token auth + the TTL-scoped idempotency-key store mirroring T041's
  fresh/replay/conflict semantics over `SET ... EX <ttl> NX` + the
  tenant-prefixed cache). They are NOT yet wired into the Vercel
  function — `deploy/wire/` (W-3d) composes them at the
  `runtime/compose.ts` seam. Before first use, apply the Neon DDL
  records (below).

  **Checkpoint 3 (W-3c) status:** `deploy/adapters/r2/` (the zero-dep
  SigV4 signing + the content-addressed, tenant-prefixed evidence/blob
  store — PUT/GET/HEAD over the S3-compatible endpoint), 
  `deploy/adapters/resend/` (the zero-dep REST client + the eight
  UX.md notice types as typed template records + the tenant-scoped
  delivery lane), and `deploy/adapters/apify/` (the zero-dep REST
  client for actor runs + schedules as typed records + the jobs'
  push through the T037/T038 subscription-spec shapes) are built and
  tested offline with pinned vectors. Same as above: W-3d wires them.

### The Neon schema (apply once — the runbook's §neon paste block)

`deploy/adapters/neon/schema.ts` carries the DDL records for the five
tenant-scoped tables (`tradrl_knowledge`, `tradrl_outcomes`,
`tradrl_post_mortems`, `tradrl_projects`, `tradrl_project_events` —
every PRIMARY KEY leads with `tenant`). To apply, paste
`NEON_DDL_RECORDS`' statements into the Neon SQL editor (or psql)
once per database — `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF
NOT EXISTS` keep it idempotent, no migration tooling (zero-dep law).

### Why vercel.json lives in deploy/vercel/ (and the one copy step)

The frozen write surface allows edits ONLY under `deploy/**` (+ two
granted root include lines). Vercel reads `vercel.json` from the
project root, so the runbook's deploy step **copies** it host-side
(never committed):

```
cp deploy/vercel/vercel.json ./vercel.json    # untracked; root is frozen in git
```

All paths inside are repo-root-relative and verified by
`deploy/vercel/vercel.test.ts`.

### The hosting configuration (deploy/vercel/vercel.json)

| Setting | Value | Why |
| --- | --- | --- |
| `framework` | `null` | no framework — static output + functions |
| `installCommand` | `echo ...` | ZERO-DEP: nothing installed, lockfile untouched |
| `buildCommand` | `node deploy/vercel/build-console.mjs` | the console build (§ above) |
| `outputDirectory` | `deploy/vercel/dist/console` | the ONLY public static tree (gitignored `dist/`) |
| `functions` | `deploy/vercel/api/router.ts` — 1024 MB, 10 s | within the Hobby free tier (≤1024 MB, ≤60 s) |
| `regions` | `iad1` (single) | Hobby = one region |
| `rewrites` | `/v1/:path*` and `/internal/:path*` → `/deploy/vercel/api/router/v1/:path*` / `.../internal/:path*` | same-origin API: the path is passed through verbatim after the function mount; the runtime strips exactly that mount |

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
     `TRADRL_API_DEVELOPER_PRINCIPAL` (+ the optional internal pair).
   - Build: `TRADRL_CONSOLE_TOKEN` (same value as the developer token),
     `TRADRL_CONSOLE_TENANT_ID` (same tenant), optionally
     `TRADRL_CONSOLE_PROJECT_ID`; leave `TRADRL_CONSOLE_SIMULATED`
     unset (`true`) until the durable adapters are wired.
   Via dashboard → Settings → Environment Variables, or:
   ```
   npx vercel env add TRADRL_API_DEVELOPER_TOKEN production
   # ... repeat per key; values are read from stdin, never logged by this repo
   ```
3. **Copy the hosting config host-side** (the root is a frozen surface;
   the copy stays untracked — `vercel.json` is not in `.gitignore`, so
   do NOT commit it; delete it after deploying if you prefer):
   ```
   cp deploy/vercel/vercel.json ./vercel.json
   ```
4. **Deploy.**
   ```
   npx vercel --prod
   ```
   What happens: the install step is a no-op (zero-dep), the console
   build copies + substitutes apps/web into
   `deploy/vercel/dist/console`, Vercel builds
   `deploy/vercel/api/router.ts` as a Node function (its TypeScript +
   the services/api import graph are bundled by Vercel's own
   toolchain — the repo has no runtime dependencies), and the two
   rewrites publish the same-origin `/v1` + `/internal`.
5. **First verification (the smoke sequence).**
   ```
   BASE=https://<project>.vercel.app
   curl -s $BASE/v1/meta                                    # → 401 envelope (pipeline: authn first)
   curl -s -H "Authorization: Bearer $TRADRL_API_DEVELOPER_TOKEN" $BASE/v1/meta
                                                           # → 200 {"requestId":...,"data":{"apiVersion":"v1",...}}
   curl -si -H "Authorization: Bearer $TRADRL_API_DEVELOPER_TOKEN" $BASE/v1/meta | grep -i access-control
                                                           # → NO OUTPUT (the same-origin law: no CORS headers)
   curl -s -H "Authorization: Bearer $TRADRL_API_DEVELOPER_TOKEN" $BASE/v1/projects
                                                           # → 503 {"error":{"code":"unavailable",...deploy_adapter_pending...}}
                                                           #   (checkpoint 1: the typed degraded state, R46 — expected until W-3b..W-3d)
   curl -s $BASE/src/loader/strip-types.ts | head -1        # → the loader source (the no-build loader's fetch works)
   ```
   Then open `$BASE/` in a browser: the console boots (theme pre-paint,
   the SIMULATED badge, the twelve sections) with the substituted
   token/tenant; the connection block shows the API reachable.
   Troubleshooting: if `/v1/meta` returns Vercel's 404 (not the API's
   JSON envelope), the rewrite destination did not resolve the
   function mount — confirm `vercel.json` was copied to the root
   (step 3) and that the function appears in the deployment's
   Functions tab as `deploy/vercel/api/router`.
6. **The J1–J12 journey catalog (the Lead's acceptance gate).** Run
   the UX-DESIGN.md J1–J12 journeys with an agent browser against
   `$BASE/` — every journey must pass on the live deployment before
   the PR opens (per the D-036 Lead ruling). Checkpoint 1 expectation:
   journeys that need only the console + `/v1/meta` + graceful
   unavailability states pass; data-backed journeys complete when the
   durable adapters land.

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

| What is absent | What the API does | What the console does |
| --- | --- | --- |
| A backing-service adapter (checkpoint 1: all five; later: any one provider down) | The affected routes answer the **typed 503 `unavailable`** envelope (the port's `deploy_adapter_pending`/provider failure code is carried in the message); the pipeline, authn/authz, rate limits, metering and audit still run on every request | The affected sections render their **unavailable/degraded states** (availability model); the shell never blanks |
| `TRADRL_API_INTERNAL_TOKEN` unset | The `/internal/*` plane stays CLOSED (401/403 — the credentials registry simply has no internal registration) | — (the console never calls `/internal`) |
| API env keys missing at function start | Every request answers the **typed 503 `deploy_not_configured`** naming the missing KEY NAMES (never values) | The console's connection block shows the API unreachable |
| `TRADRL_CONSOLE_TOKEN`/`_TENANT_ID` unset at build | The shipped defaults stay; the console boots into its readable "no credential token / no tenant injected" message (the T042 graceful-degradation contract) | A readable message, never a blank page |
| The API function unreachable | — | The console degrades per its availability model (retry, readable message) — the T042 contract |
| Neon autosuspended (cold) (W-3b) | First query pays the wake latency; a timeout/5xx becomes the typed degraded state (never a crash) | as above |

## 7. Testing this tree

```
corepack pnpm vitest run deploy     # 37 tests (runtime adaptation vectors,
                                    # composition incl. the L12 tenant-injection
                                    # probe, config invariants, build determinism)
corepack pnpm typecheck             # 0 errors (deploy/** is in the root tsconfig include)
```

No live provider calls anywhere in CI — every provider interaction is
pinned as a construction/determinism vector or runs against fakes
(the W-3d smoketest boots the API with deployment adapters against
fakes).

## 8. Status + what lands next (honest)

- **Checkpoint 1 (this commit):** runbook + hosting config + the
  function wrap + the console build — the console and the API are
  publicly deployable NOW with the typed-degraded backing services.
- **W-3b:** `deploy/adapters/neon/` + `deploy/adapters/upstash/`
  (durable stores; tenant-scoped rows, L12; pinned request vectors).
- **W-3c:** `deploy/adapters/r2/` + `resend/` + `apify/`.
- **W-3d:** `deploy/wire/` (the production composition — the real
  adapters injected at the `runtime/compose.ts` seam) + the port-shape
  trip-wires + the CI smoketest.
