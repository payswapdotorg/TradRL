# Observability (T050)

What the TradRL platform emits, how to inspect it, and the laws that
bound what operations may ever see. The platform's observability
surfaces are all **deterministic, chain-verified and tenant-scoped** —
there is no metric aggregator or log shipper in the free-tier
deployment; the truth lives in the records the platform itself mints
plus the host's function logs.

---

## 1. The surfaces (what exists, where it lives)

| Surface | Identity space | What it records | Where it lives |
|---|---|---|---|
| **The usage ledger** (R41) | `usu:` usage records | ONE record per request — successes AND failures (401/403/404/400/429 included): tenant, route family, method, status, instant; content-addressed ids; per-tenant per-route aggregate | `services/api`'s metering stage; read through the private plane `GET /internal/usage/:tenantId` (the `svc:` namespace meters internal reads separately — they never pollute a tenant's consumption facts) |
| **The API audit trails** (R40) | `aau:` audit records | every CONSEQUENTIAL request (mutations, execution, job submissions, internal writes — denials included): who/what/when/tenant/route/consequence; chain-verified per (tenant, project) scope; verified on read | `services/api`'s audit stage; `service.auditTrails()` / `auditTrail(tenant, project)` on the operator surface |
| **The telemetry log** (T043) | `tel:` records | metric / trace-span / log observations over the platform's merged seams (agent-os, execution-authority, control-plane, event-store), referenced BY IDENTITY never by payload; append-only, chain-verified; point-in-time queries | `packages/observability` + `services/observability` (collector with injected instants + sinks; `queryTelemetry` with the INCLUSIVE `asOf` bound) |
| **The platform audit chain** (T043) | `pau:` records | platform-level actions (who/what acted, lineage, consequence) — chain-verified, complement to the T040 gateway audit | `services/audit` (`platform-audit.ts`) |
| **The gateway audit records** (T040) | `xga:` records | every consequential execution decision at the 13-stage chokepoint | `services/execution-gateway`; the join key the telemetry plane references |
| **The benchmark measurement log** (T049) | `cbml:` / `cbmm:` / `pev:` records | capability measurements + published evidence — the evaluation truth | `benchmarks/platform` + `research/public-evaluation` |

**The laws that make these safe to operate on** (all test-pinned):

- **L4 (no ambient clock)** — every record carries an explicit
  `recordedAt`; queries are point-in-time (`asOf` is INCLUSIVE: a
  record recorded at exactly `asOf` IS returned; 1 ms past is not).
- **L9 (byte-determinism)** — identical scripted drives produce
  byte-identical serialized state; the whole plane reproduces
  (`tests/performance/api-plane.test.ts` pins a 64-request
  reproduction; the telemetry log's canonical JSON is byte-stable at
  N=500 and rebuilds byte-identically through the total replay).
- **L12 (tenant isolation)** — every surface is tenant/project-scoped;
  a cross-scope query is the typed `tenant_missing` error; telemetry
  logs are per-scope and cross-tenant telemetry is inexpressible.
- **The opacity trip wire** — a credential VALUE anywhere in any
  serialized record is the typed `credential_value_present` error;
  the audit and telemetry records may carry credential IDENTITIES,
  never values (`credentialValueViolations`, `scrubForLog`).
- **No chain-of-thought** — the watch surface renders
  who/what/evidence/proposal/challenge/risk/decision; hidden
  reasoning is never exposed anywhere (spec/UX.md; J4).

## 2. The work guarantees (what operations can rely on)

Pinned as deterministic laws by `tests/performance/` — these are the
contract, not best-effort:

- **Metering is exactly linear**: N requests → exactly N usage
  records (successes and failures alike); the per-route aggregate
  always sums to the total.
- **Retries are honest and bounded**: 50 idempotent replays of one
  execution → ONE gateway port call, byte-identical responses; the
  audit trail records every attempt (`request.allowed` once,
  `request.replayed` for each retry, all naming the SAME submission).
- **Refusals are bounded work**: an exhausted rate budget refuses
  with the typed 429 + the deterministic `retry-after-ms` signal; a
  kill-switch refusal costs one bounded port call; every refusal
  still meters and audits.
- **The audit trail is exact**: exactly the authenticated
  consequential requests with resolvable scopes — no more, no less.
- **Telemetry volume is predictable**: every record serializes under
  the 2 KiB budget; point-in-time queries return exactly their
  prefix; sink delivery is exactly-once in append order.

## 3. What the DEPLOYED demo backing exposes (honest scope)

Under the default demo backing (no `NEON_*`/`UPSTASH_*` key), the
public deployment composes the frozen service's own in-memory ports:

- **What exists live:** the full pipeline on every request (authn →
  authz → tenant injection → rate limit → validation → handler →
  audit → metering → response) — so the usage ledger and the audit
  trails really accumulate per instance; the seeded demo data
  (project `prj-demo-console`, the fixture knowledge records, one
  demo outcome + post-mortem pair); with the internal credential
  pair set, the org-status watch snapshot + the job tick.
- **What does NOT exist live:** anything durable — **a serverless
  cold start resets the per-instance state** (projects created in a
  session drop; the seed re-lands at the next boot). The usage and
  audit surfaces on the public deployment are therefore SESSION
  evidence, not history. Durable observability arrives with the
  durable backing (the W-3e hydration seam,
  `deploy/wire/production.md`).
- **The host layer:** Vercel's deployment logs (dashboard → the
  deployment → Functions/Logs) carry the function's stdout/stderr —
  module-load errors, invocation failures. This is where the
  incident matrix's build/deploy class is read
  (`ops/runbooks/incident-response.md` §3a).
- **The SIMULATED badge** is the contractual disclosure of all of the
  above (UX-DESIGN §7) — if it is ever off under the demo backing,
  that is an anti-deception violation (treat as SEV2).

## 4. How to inspect (the real queries)

**The usage aggregate of one tenant** (private plane; needs the
internal usage-reader credential):

```bash
curl -s -H "Authorization: Bearer $TRADRL_API_INTERNAL_TOKEN" \
     "$BASE/internal/usage/tenant-demo"
# → {"requestId":...,"data":{"totalRequests":N,"byRoute":{"meta:read":n,...}}}
```

**The API surface's own truth** (from a checkout, on the operator
surface — the same surface the test suites drive):

```ts
// services/api (the operator view; deterministic key order)
service.usageOf(tenant);          // one tenant's records, append order
service.auditTrails();            // every (tenant, project) trail, verified on read
service.auditTrail(tenant, project); // one scope's chain-verified trail
```

**The telemetry log, at a point in time** (T043's query surface):

```ts
// services/observability — L4's INCLUSIVE asOf bound, scope-gated (L12)
queryTelemetry(log, { tenant, project, asOf, kinds?, actorKinds?, actors?, seamKinds? });
verifyTelemetryLog(log);          // the chain fold — tamper/truncate/reorder detection
canonicalTelemetryLogJson(log);   // the byte-deterministic serialization
```

**A failed chain is a finding, never noise:** every `audit_rewrite`
/ `chain_mismatch` verdict from any verifier (telemetry, platform
audit, gateway audit, the benchmark log) means a record was edited,
spliced, truncated, reordered or duplicated after recording — treat
as a security finding (SEV2 minimum), diagnose on the owning surface.

## 5. The health signals (the daily/weekly loop)

| Cadence | Signal | Where |
|---|---|---|
| per deploy | the seven-point smoke (7/7) | `node ops/tooling/smoke.mjs "$BASE" "$TOKEN"` |
| per release | the J1–J12 journey catalog (all twelve) | the agent browser, `spec/UX-DESIGN.md` §6 |
| per release | the readiness review's gate table | `ops/runbooks/production-readiness.md` |
| per provider outage | the typed degradation states render honestly (no crash, no blank) | the console's availability model + R46 |
| continuous | the CI gates on every PR (typecheck, tests, program state, governance) | `.github/workflows/ci.yml` |

There is no background daemon to monitor in the free-tier
deployment — the platform is serverless; "monitoring" is the smoke
probe after every deploy, the journey gate before every release, and
the typed degraded states holding the surface during provider
incidents.
