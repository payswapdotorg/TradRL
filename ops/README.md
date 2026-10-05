# ops/ — production operations (T050)

Everything needed to **operate TradRL in production** once it is
deployed: the runbooks an operator executes, and the tooling that
makes the recurring checks repeatable.

## The composition law (three trees, one chain — never duplicated)

| Tree | Owns | Question it answers |
|---|---|---|
| **`deploy/`** (T052) | provisioning + deploying: the provider accounts, the env inventory, the build, the deploy steps, the hosting laws | *"how does it get to production?"* — start at `deploy/README.md` |
| **`ops/`** (this tree, T050) | operating what is deployed: readiness review, incident response, observability, the smoke probe | *"how is it kept healthy?"* — start here |
| **`docs/release/`** (T050) | the release model, the release checklist, the release records | *"how is a release cut and recorded?"* — start at `docs/release/README.md` |

`ops/` never re-states `deploy/`'s provisioning steps or its
hosting laws — it links to them and operates the result.

## The operating model (honest)

- **What runs in production today:** ONE Vercel project (Hobby, one
  region `iad1`) serving the console statically and the developer API
  through one prebuilt serverless function
  (`.vercel/output/functions/api/router.func`), same-origin `/v1` +
  `/internal` planes, **demo backing by default** (no `NEON_*`/
  `UPSTASH_*` key configured): the data routes serve the seeded
  fixture demo data over the frozen service's own in-memory fake
  ports — **per-instance state**: a serverless cold start resets the
  demo world to its seed, honestly disclosed by the console's
  SIMULATED badge (UX-DESIGN §7). The durable adapters (Neon/
  Upstash/R2/Resend/Apify) are built and offline-tested in
  `deploy/adapters/` + `deploy/wire/` but compose the typed pending
  stubs until the W-3e async-to-sync hydration seam lands
  (`deploy/wire/production.md`) — the honest R46 pending state.
- **Who operates it:** the Tech Lead (the same role that executes
  `deploy/README.md`). Nothing in this tree requires new
  infrastructure or credentials beyond `deploy/.env.example`'s
  inventory.
- **The zero-dep law carries over:** everything under `ops/` runs on
  platform APIs only (`fetch`, `node:*`). No `package.json` under
  `ops/`, no dependency is ever added, `pnpm-lock.yaml` is never
  touched.

## The index

| Path | What it is |
|---|---|
| `ops/runbooks/production-readiness.md` | the go/no-go review before exposing (or re-exposing) a deployment: the full gate table with exact commands and expected outputs, the deployment verification sequence, the J1–J12 journey gate, the secrets/tenant checks, the rollback drill, the free-tier capacity review |
| `ops/runbooks/incident-response.md` | the incident procedure: severity model, the first five minutes, the symptom → diagnosis → remediation matrix (every row is a REAL failure this program diagnosed in production, W-3h…W-3k), the rollback decision tree, the incident record |
| `ops/runbooks/observability.md` | what the platform emits and how to inspect it: the usage ledger, the chain-verified audit trails, the telemetry log and its point-in-time queries, what the deployed demo backing exposes vs. the local services, and the opacity/tenant laws that bound what operations may ever see |
| `ops/tooling/smoke.mjs` (+ `smoke.d.mts`) | the seven-point production smoke probe — `deploy/README.md` §4 step 5's curl sequence as a repeatable tool (exit 0/1/2, byte-deterministic report, never echoes the credential); tested by `tests/performance/smoke-tool.test.ts` (every detector proven to bite) |

## The gates quick reference (the daily loop)

From a checkout of `main`:

```bash
corepack pnpm install --frozen-lockfile   # once per checkout
corepack pnpm typecheck                   # 0 errors
corepack pnpm vitest run                  # the FULL floor, zero regressions
node scripts/program/check.mjs            # "Program state valid."
node scripts/validate-governance.mjs      # "TradRL governance self-test passed."
node ops/tooling/smoke.mjs "$BASE" "$TOKEN"   # the deployed origin's 7-point smoke
```

The exact expected values (and the floor-accounting law: the full
suite's count = the merged floor + exactly the net-new tests, zero
regressions) live in `ops/runbooks/production-readiness.md`.

## Known gotcha (standing)

`pnpm-lock.yaml` shows a recurring self-normalization diff (empty
importer blocks) after some `pnpm` invocations — **restore it, never
commit it** (`git checkout -- pnpm-lock.yaml`). The lockfile is
frozen; any legitimate lockfile change is a Lead decision, never a
worker's.
