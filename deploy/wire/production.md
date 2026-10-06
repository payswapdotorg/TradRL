# deploy/wire/production.md — THE PRODUCTION WIRING RECORD (T052, W-3d)

The composition law in one place: which environment variables enable
which adapter, what degrades when one is absent or down, and the boot
order. Machine-readable sources: `composition.ts` (`readProviderEnv` +
`enabledAdapters` — the single implementation), `deploy/.env.example`
(the single key inventory).

## The sync/async bridge (the honest structural fact)

T041's port methods are **synchronous** (`PortResult` returned
directly — T041's own backing stores are in-memory by design), while
every durable provider adapter here is **async**
(`Promise<StoreResult>` — network I/O). A durable store is therefore
NOT directly assignable to the real sync port, and the wire does not
pretend otherwise (the trip-wires in `wire.test.ts` pin the TRUE
assertions). What the deployment does instead:

- **The adapter-side law (strict):** the stores satisfy the wire's
  ASYNC mirror ports (`deploy/wire/ports.ts`) — the mirrors carry
  T041's exact method names, parameter shapes and record envelopes,
  widened to async. Name-alignment and parameter-parity trip-wires
  fail at typecheck time if T041's ports drift.
- **The seam (LANDED — W-25D, `deploy/vercel/runtime/durable.ts`) + the activation (W-26B, `deploy/vercel/runtime/durable-world.ts`):** the
  T041 composition root (`createApiService`) is injected with SYNC
  in-memory ports whose state is a PROJECTION of the durable stores:
  at instance boot (the first request after a cold start) the seam
  reads the Neon stores — the project REGISTRY (creation order), each
  project's GOAL SET (the create-project input's goal + constraint
  set, persisted at createProject time) + EVENT LOG, the KNOWLEDGE and
  the OUTCOMES/POST-MORTEMS — and reconstructs every project through
  the REAL T007 control plane's own domain law (the seam orchestrates,
  never re-implements). Every mutation applies to the in-memory port
  AND write-throughs to the durable store in dependency order, and the
  HOST drains the durable writes BEFORE the response is served: a
  failed durable write is the typed 503 (`unavailable`, the durable
  failure's own code; the mutation is UNCONFIRMED) plus a full
  re-projection from the durable truth — never a crash, never a silent
  divergence (R46). The W-26B boot world (the demo world seed + the
  fixture substance + the org-status snapshots) rides the SAME law:
  once per DATABASE for the project (the hydrated registry guard skips
  the create on subsequent boots), once per instance for the
  jobs/snapshots (the frozen service's per-instance closures — the
  disclosed limitation), every durable write drained before the first
  serve, a failed write the typed 503 retried per request, and a
  post-seed re-projection so the serving projection IS the seeded
  world. If T041 ever widens its ports to async (a T041-side change;
  the deployment never edits it), the adapters drop in unchanged.
- **The host-owned lanes are async-native today:** idempotency
  (Upstash), cache, evidence (R2), notice delivery (Resend) and
  ingestion (Apify) are consumed by the HOST around the sync boundary
  — exactly the surfaces the smoketest drives.

## The port map (invariant-9: ports injected, never imported)

The RUNTIME composition (`deploy/vercel/runtime/compose.ts`, the backing
resolution) selects the ports; under DURABLE with the seam built, the
W-26B activation composes the SAME simulated engines the DEMO backing
composes for the two non-Neon surfaces (imported from the frozen
fixtures — zero new simulation logic; disclosed in the row notes).

| T041 port / surface | Adapter | Enabled by (all required) | Typed absence code |
| --- | --- | --- | --- |
| `FirmMemoryPort` | `NeonFirmMemoryStore` | `NEON_API_HOST` `NEON_DATABASE` `NEON_API_USER` `NEON_API_KEY` | `deploy_adapter_absent` |
| `OutcomeLearningPort` | `NeonOutcomeLearningStore` | (same Neon keys) | `deploy_adapter_absent` |
| `ControlPlanePort` | the REAL T007 control plane over `NeonProjectStore` (the persistence substrate — the domain law stays in the real service) | (same Neon keys, for persistence) | the real control plane's own typed refusals |
| `ExecutionGatewayPort` | DEMO + the seam-live DURABLE resolution (W-26B): the SAME `demoExecutionGateway` the demo backing composes (the frozen fixtures' simulated gateway — recording under demo only; honest under the SIMULATED badge). Seam-not-built durable: the `deploy_adapter_pending` stub (the real T040 delegate remains a later seam — never bypassed, never faked) | (durable: the four Neon keys) | `deploy_adapter_pending` |
| `JobSubmissionPort` | DEMO + the seam-live DURABLE resolution (W-26B): the SAME `fakeJobSubmission` the demo backing composes (the frozen fixtures' simulated async-pattern engine — the J3 launch journey must hold under durable; the fake's submission blotter stays a demo-only observable). Seam-not-built durable: the matrix for Apify (absent keys -> the typed absent; present keys -> the pending stub — the async Apify bridge remains a later seam) | (durable: the four Neon keys) | `deploy_adapter_absent` |
| idempotency keys (host-owned) | `UpstashIdempotencyStore` (`SET … EX <ttl> NX`) | `UPSTASH_REDIS_REST_URL` `UPSTASH_REDIS_REST_TOKEN` | `null` → the host falls back to T041's in-memory store |
| cache (host-owned) | `UpstashCache` (tenant-prefixed, TTL) | (same Upstash keys) | `null` → no cache layer |
| evidence blobs (host-owned) | `R2EvidenceStore` (content-addressed `tradrl/evidence/{tenant}/{sha256}.json`) | `R2_ACCOUNT_ID` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET` | `null` → evidence uploads degrade |
| notice delivery (host-owned) | `ResendNoticeDelivery` (the eight UX.md kinds) | `RESEND_API_KEY` `RESEND_FROM` | `null` → notices stay console-local |
| ingestion schedules (host-owned) | `buildSchedule` records (Apify actor + cron) | `APIFY_API_TOKEN` | `null` → no scheduled feeds |

## The degradation matrix (R46 — typed states, never crashes)

| What is absent/down | What the boundary does | What still works |
| --- | --- | --- |
| Neon (absent keys) | the control-plane (projects), firm-memory + outcome routes answer the typed `deploy_adapter_absent` 503; the execution gateway keeps the `deploy_adapter_pending` stub and jobs follow the matrix for Apify (the W-26B activation — the gateway/seed/tick — NEVER runs in this state; zero provider traffic) | everything else — authn/authz, rate limits, metering, audit, meta |
| Neon (down/unreachable) | the same routes answer the typed `neon_unreachable` 503 (per-request — no circuit state; the W-25D seam retries the projection on every request while it is failed, so a Neon that recovers mid-instance heals the surfaces without a cold start). The W-26B boot world rides the same law: a failed seed/fixture write degrades the triggering request typed (the seeded world is unconfirmed) and retries on the next request | as above |
| Upstash absent | the host uses T041's in-memory idempotency (per instance — warm-start scoped) | everything (idempotency semantics identical, durability reduced) |
| Upstash down | the idempotency check reports the typed `degraded` verdict; the host's fail-closed posture refuses the consequential call | non-consequential routes unaffected |
| R2 absent/down | evidence uploads answer the typed failure; reads answer the typed not-found/unreachable | everything else |
| Resend absent/down | notice delivery answers the typed failure; notices remain in the console's own fold/inbox | everything (delivery is a side lane) |
| Apify absent/down | seam-not-built durable: job submissions answer the typed `deploy_adapter_absent`/`apify_apify_unreachable` (the matrix). Seam-live durable (W-26B): the job routes answer the SAME simulated engine the demo backing composes (the J3 launch journey holds under durable — honest under the SIMULATED badge; the async Apify bridge remains a later seam); the host-owned ingestion lanes (feeds/schedules) degrade typed | everything else |
| The gateway delegate down | seam-not-built durable: execution requests answer the `deploy_adapter_pending` stub. Seam-live durable (W-26B): the simulated gateway routes (the same engine the demo backing composes — the real T040 delegate remains a later seam; L8: never bypassed, never faked) | everything else |

## The boot order (the Vercel function's cold start)

1. Read the provider env once (`readProviderEnv`) — the enabled matrix is computed, never re-read per request.
2. Compose the adapters (`composeDeploymentAdapters`) with the platform fetch + a monotonic instant source; absent adapters yield their typed degraded ports (no throw at boot — a half-configured deployment still serves its configured surface).
3. Compose the REAL control plane (T007) over the Neon persistence substrate and the REAL gateway (T040) — both carried verbatim.
4. Inject the five ports + credentials + instants into T041's `createApiService` at the `deploy/vercel/runtime/compose.ts` seam (fail-closed: a malformed injection is the typed not-configured 503, never a crash). Under the DURABLE backing the Neon-backed ports are the W-25D seam's sync in-memory ports (`runtime/durable.ts`), and since W-26B the seam-live composition also binds the activation — the machinery tick + the boot world (`runtime/durable-world.ts`) — over the composed service.
5. Memoize per instance; warm invocations reuse the composition. The first request after a cold start awaits the seam's BOOT PROJECTION (the router's `settled()`), runs the W-26B boot world (`ensureBootWorld()` — the demo world seed + the fixture substance + the org-status snapshots, every durable write drained before the first serve), then the machinery tick; every request drains its pending durable writes before the response is served (`drain()` — the write-through ordering law).

## The CI smoketest

`deploy/wire/smoketest.ts` boots the full composition against the fake
provider fleet (the real wire envelopes over one fake fetch — no
network, fixed fake credentials), drives each port's happy path, then
flips the outage lever and asserts every degraded path answers its
TYPED failure code. `wire.test.ts` gates on `smoketestHealthy`.
