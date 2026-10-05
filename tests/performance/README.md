# tests/performance/ — the deterministic performance surface (T050)

The platform's **performance laws**, pinned the way this repo pins
everything: **deterministically** — no wall clock, no ambient
randomness, no flaky timing assertions. A performance law here is one
of four shapes:

| Shape | The law it pins | Where |
|---|---|---|
| **Operation counts** | the work a production surface performs is counted exactly (N requests → exactly N usage records; one execution under a retry storm; exactly-once sink delivery) | `api-plane.test.ts`, `observability-plane.test.ts` |
| **Complexity laws** | work grows EXACTLY linearly (never superlinearly, never lossily) as the scale doubles — the linearity itself is the assertion, not a timing | `api-plane.test.ts`, `observability-plane.test.ts` |
| **Byte budgets** | production payloads stay under a recorded budget (the console's boot payload; every telemetry record's serialized size) — a budget breach fails the gate, exactly like a type error | `console-payload.test.ts`, `observability-plane.test.ts` |
| **Byte-determinism at scale** | the same scripted drive produces byte-identical serialized state — reproducibility IS the reliability property (L9) | `api-plane.test.ts`, `observability-plane.test.ts`, `smoke-tool.test.ts` |

Plus the ops tooling's own suite: `smoke-tool.test.ts` pins the
seven-point production smoke probe (`ops/tooling/smoke.mjs`) — its
happy path, its byte-deterministic report, EVERY one of its seven
failure detectors (a broken deployment is caught — each check is
proven to bite), the token-opacity law (the credential never appears
in the report), and the CLI's typed usage errors.

## Why no wall clock

A wall-clock assertion flakes (CI runners, cold JIT, machine load) —
and the repo's own law is stronger anyway: these surfaces are
DETERMINISTIC (injected instants, content-addressed records, byte-
identical serializations — L4/L9). If work is deterministic, its
**count** is the honest measure of its cost; the byte budget is the
honest measure of its payload. Timing would measure the MACHINE, not
the platform. The measured-and-recorded baselines (the payload
budgets) carry the production consequence: the loader fetches every
console source at boot, so the boot transfer is the byte total —
pinned where a regression can fail the gate.

## The suites

```bash
corepack pnpm vitest run tests/performance   # the whole surface
```

- **`api-plane.test.ts`** — the deployed API plane's per-request work
  laws: metering linearity (one record per request, successes and
  failures alike, at 32/64 scale), the rate-limit exhaustion law
  (bounded refusal work + the deterministic retry signal), the
  retry-storm law (50 idempotent replays → ONE gateway execution, one
  audit record, byte-identical responses), the refusal law (a
  kill-switch refusal costs exactly one bounded port call and its
  replays dedupe too), the exact audit-count law (audit records ===
  the authenticated consequential requests — no more, no less), L12
  tenant isolation at interleaved scale, and whole-plane
  byte-determinism over a 64-request mixed sequence.
- **`observability-plane.test.ts`** — the telemetry plane's chain
  laws: append linearity at N=500 (exactly one instant per record),
  total chain verification, the per-record canonical byte budget, the
  point-in-time prefix law (an asOf query returns exactly its prefix —
  bounded by the prefix, never the whole log), filter-proportional
  queries, exactly-once ordered sink fan-out, byte-determinism at
  scale, and the total replay law (the log rebuilds byte-identically).
- **`console-payload.test.ts`** — the console's boot payload budgets:
  the no-build loader fetches `index.html` + every non-test source
  under `apps/web/src` at boot; the payload's file count, total bytes,
  and largest file are each pinned under a recorded budget (a
  regression fails the release gate instead of silently fattening
  every boot).
- **`smoke-tool.test.ts`** — the ops tooling (see above).

## What this surface deliberately does NOT do

- No wall-clock benchmarks, no throughput/latency percentiles — those
  measure the machine, flake in CI, and are already honestly covered
  elsewhere: the benchmark platform (`benchmarks/platform`, T049)
  measures **trading** performance (PnL, attainment) deterministically;
  this surface measures **operational** work.
- No live-network tests: the smoke probe is tested against a scripted
  fake fetch; the live run is the Lead's operator step
  (`ops/runbooks/production-readiness.md`).
- No duplication of the per-surface suites: the single-request laws
  (one 429, one replay, one refusal) live in `services/api/src/*.test.ts`;
  this surface pins the same laws **at scale and as laws** (the exact
  linear growth, the bounded totals, the budgets).
