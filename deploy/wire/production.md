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
- **The seam:** the T041 composition root (`createApiService`) is
  injected with SYNC adapters — at checkpoint 4 these are the typed
  degraded stubs (`deploy_adapter_pending`); hydrating them from the
  durable stores per instance (boot-time or read-through projection)
  is the W-3e/lead step, and if T041 ever widens its ports to async
  (a T041-side change; the deployment never edits it), the adapters
  drop in unchanged.
- **The host-owned lanes are async-native today:** idempotency
  (Upstash), cache, evidence (R2), notice delivery (Resend) and
  ingestion (Apify) are consumed by the HOST around the sync boundary
  — exactly the surfaces the smoketest drives.

## The port map (invariant-9: ports injected, never imported)

| T041 port / surface | Adapter | Enabled by (all required) | Typed absence code |
| --- | --- | --- | --- |
| `FirmMemoryPort` | `NeonFirmMemoryStore` | `NEON_API_HOST` `NEON_DATABASE` `NEON_API_USER` `NEON_API_KEY` | `deploy_adapter_absent` |
| `OutcomeLearningPort` | `NeonOutcomeLearningStore` | (same Neon keys) | `deploy_adapter_absent` |
| `ControlPlanePort` | the REAL T007 control plane over `NeonProjectStore` (the persistence substrate — the domain law stays in the real service) | (same Neon keys, for persistence) | the real control plane's own typed refusals |
| `ExecutionGatewayPort` | the REAL T040 gateway — **carried verbatim, never wrapped** (L8: the only execution path) | the gateway's own env (not this tree's) | the gateway's own typed refusals |
| `JobSubmissionPort` | `ApifyIngestionJobs` (actor runs; job kinds research/learning → feeds news/alternative) | `APIFY_API_TOKEN` | `deploy_adapter_absent` |
| idempotency keys (host-owned) | `UpstashIdempotencyStore` (`SET … EX <ttl> NX`) | `UPSTASH_REDIS_REST_URL` `UPSTASH_REDIS_REST_TOKEN` | `null` → the host falls back to T041's in-memory store |
| cache (host-owned) | `UpstashCache` (tenant-prefixed, TTL) | (same Upstash keys) | `null` → no cache layer |
| evidence blobs (host-owned) | `R2EvidenceStore` (content-addressed `tradrl/evidence/{tenant}/{sha256}.json`) | `R2_ACCOUNT_ID` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET` | `null` → evidence uploads degrade |
| notice delivery (host-owned) | `ResendNoticeDelivery` (the eight UX.md kinds) | `RESEND_API_KEY` `RESEND_FROM` | `null` → notices stay console-local |
| ingestion schedules (host-owned) | `buildSchedule` records (Apify actor + cron) | `APIFY_API_TOKEN` | `null` → no scheduled feeds |

## The degradation matrix (R46 — typed states, never crashes)

| What is absent/down | What the boundary does | What still works |
| --- | --- | --- |
| Neon (absent keys) | firm-memory + outcome routes answer the typed `deploy_adapter_absent` 503 | everything else — authn/authz, rate limits, metering, audit, meta, gateway, jobs |
| Neon (down/unreachable) | the same routes answer the typed `neon_unreachable` 503 (per-request — no circuit state) | as above |
| Upstash absent | the host uses T041's in-memory idempotency (per instance — warm-start scoped) | everything (idempotency semantics identical, durability reduced) |
| Upstash down | the idempotency check reports the typed `degraded` verdict; the host's fail-closed posture refuses the consequential call | non-consequential routes unaffected |
| R2 absent/down | evidence uploads answer the typed failure; reads answer the typed not-found/unreachable | everything else |
| Resend absent/down | notice delivery answers the typed failure; notices remain in the console's own fold/inbox | everything (delivery is a side lane) |
| Apify absent/down | job submissions answer the typed `deploy_adapter_absent`/`apify_apify_unreachable` | everything else |
| The gateway delegate down | execution requests answer the gateway's own typed refusal (L8: never bypassed, never wrapped) | everything else |

## The boot order (the Vercel function's cold start)

1. Read the provider env once (`readProviderEnv`) — the enabled matrix is computed, never re-read per request.
2. Compose the adapters (`composeDeploymentAdapters`) with the platform fetch + a monotonic instant source; absent adapters yield their typed degraded ports (no throw at boot — a half-configured deployment still serves its configured surface).
3. Compose the REAL control plane (T007) over the Neon persistence substrate and the REAL gateway (T040) — both carried verbatim.
4. Inject the five ports + credentials + instants into T041's `createApiService` at the `deploy/vercel/runtime/compose.ts` seam (fail-closed: a malformed injection is the typed not-configured 503, never a crash).
5. Memoize per instance; warm invocations reuse the composition.

## The CI smoketest

`deploy/wire/smoketest.ts` boots the full composition against the fake
provider fleet (the real wire envelopes over one fake fetch — no
network, fixed fake credentials), drives each port's happy path, then
flips the outage lever and asserts every degraded path answers its
TYPED failure code. `wire.test.ts` gates on `smoketestHealthy`.
