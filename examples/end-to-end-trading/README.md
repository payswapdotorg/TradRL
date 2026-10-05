# T048 — the reference end-to-end trading slice

The complete, runnable reference wiring of the WHOLE trading loop: market data
in through the REAL adapter contracts, the reactive world, the strategy and
risk lane, the trading director, the execution body, the execution gateway's
policy-enforced chokepoint, shadow-trading observation, out to realized
outcomes. **This is the artifact to read to understand the platform**: every
station below is a merged, tested work item's REAL code, driven by one
deterministic fixture market day — no network, no wall clock, no ambient
randomness, zero npm dependencies.

## Run it

```bash
corepack pnpm vitest run tests/end-to-end-trading   # the colocated suite drives the slice
```

The whole loop is one call — `runReferenceSlice()` (`src/run.ts`): it assembles
every station in order and folds the day into ONE deterministic report (the
byte-stable `reportDigest` is the determinism anchor; the suite runs the slice
twice and pins the equality). Every station is also independently drivable
through the exports of `src/index.ts` — the suite's per-station tests and the
negative paths use exactly those.

## The scope (one market day, every instant a literal)

One tenant (`tenant-e2e-slice`), one project, the BINANCE venue with
BTC-USDT + ETH-USDT, and the NEWS-WIRE-A licensed news feed. The clock anchor
is `T0 = 2024-06-03T14:00:00.000Z`; every downstream instant is an explicit
epoch-ms offset from it (`src/scope.ts`). The whole slice is a pure function of
the literals in that one file plus the fixture timelines each station declares
— run it twice, get byte-identical evidence.

```
T0            the recorded history opens (the seeded BTC partial-depth book)
T0+15_000     the ADVERSARY's crossing buy — the market fights back
T0+20_000     the BTC trade print @ 50100 (the step-1 limit's anchor)
T0+20_000     the news wire RECEIVES the embargoed TEST-AAA headline
T0+20_500     the ETH trade print @ 3000
T0+25_000     the embargo LIFTS (the canonical available_time — never the receipt)
T0+26_000     the public TEST-AAA headline
T0+300_000    the DIRECTOR decision instant (the four research lanes' quorum)
T0+320_000    the STRATEGY step-1 decision (equal-weight allocation)
T0+320_500..  the gateway submission instants (one per submission)
T0+330_000    the BTC trade print @ 62000 (the rally — the step-2 trigger)
T0+340_000    the STRATEGY step-2 decision (the drift correction)
T0+400_000    the world's horizon (the resting orders expire)
```

## The stations (the data flow)

```
scripted transports ──► T037/T038 adapter sessions ──► canonical events
    (raw vendor frames)    (REAL guards + mappings)      (honest L4 quartets)
                                                                  │
            ┌─────────────────────────────────────────────────────┤
            ▼                                                     ▼
 THE REACTIVE WORLD (T027)                              the observation window
 REAL exchange-sim engine (physics)                     (L4-filtered, merged)
 adversary feed; fills with lineage                               │
            │                                                     ▼
            │                                    compileStrategyRun (T018)
            │                                    (the constraint gate FIRST)
            │                                                     │
            │                        ┌────────────────────────────┤
            │                        ▼                            ▼
            │          THE EXECUTION GATEWAY (T040)     THE SHADOW SESSION (T030)
            │          the 13-stage chokepoint over     the paper lane over the
            │          T019 gate + T020 risk + T040     reactive world; the same
            │          authority — routed or REFUSED    control stack; fills with
            │                        │                   physics lineage
            │                        ▼                            │
            │          THE EXECUTION BODY (T025)                   ▼
            │          order lifecycles + gateway        THE OUTCOME LOG
            │          requests + fill reconciliation   (chain-verified — T033's
            │                                           input surface): the
            └─────────────────────────────────────────  REALIZED OUTCOMES
```

| # | Station | The REAL code (merged work item) | What it proves here |
|---|---------|----------------------------------|---------------------|
| 1 | Market data in | `adapters/binance` + `adapters/news` sessions (T037/T038) over the slice's scripted transport ports | the guard pipelines, mapping tables, L4-honest availability quartets (the embargo lift), entitlements, provenance, the pass-through neutrality contract |
| 2 | The reactive world | `services/market-world/src/reactive` (T027) matched by the REAL `packages/exchange-sim` engine through the injected EngineDriver port | exogenous stream + endogenous matching with the declared physics (two-tier fees, uniform latency, book-walk slippage); the ADVERSARY's crossing buy moves the book before the slice's order arrives |
| 3 | Strategy/risk | `packages/trading-strategy` `compileStrategyRun` (T018) | the constraint gate BEFORE emission, equal-weight allocation, drift-band rebalancing, limit anchoring at the adapter prints, exact-decimal arithmetic |
| 4 | The trading director | `bodies/trading-director` `composeDirectorDecision` (T024) | the L4 research gate, the quorum, the conflict policy, the coverage accounting — and the escalation record when the quorum fails |
| 5 | The execution body | `bodies/execution` (T025) | order-lifecycle records for everything the gateway ROUTED (the authority traveling WITH the record), the gateway-request seam records, exact-equality fill reconciliation |
| 6 | The execution gateway | `services/execution-gateway` (T040) over the REAL T019 gate, T020 risk engine and T040 authority stack | `submitDecision` is the SINGLE entry point; the 13-stage pipeline runs first-failure-wins; ANY refusal is a typed record + an audit record + ZERO adapter calls; the chain-verified audit trail (1:1 with submissions) |
| 7 | Shadow trading + realized outcomes | `services/shadow-trading` (T030) | the paper lane paper-executes the same intents against the reactive world under the SAME hard controls; every decision lands in the chain-verified outcome log — T033's input surface |

## What is REAL and what is SIMULATED (the honest table)

**REAL — the platform code the slice drives, unchanged:**

- The T037 Binance spot adapter session and the T038 news-wire adapter session:
  everything between `recv()` and the canonical events is production code.
- The T027 reactive world service and the exchange-sim matching engine (bound
  through T027's documented injected EngineDriver seam).
- The T018 strategy compiler, the T024 director synthesis, the T025 execution
  body's lifecycle machine, the T040 gateway's whole pipeline over the REAL
  T019 execution policy/gate, the REAL T020 risk engine and the REAL T040
  authority package (grants minted through the authority's own minter).
- The T030 shadow session (tick machine, latency windows, exact-decimal paper
  book, chain-verified outcome log).

**SIMULATED — the fixtures a production host replaces:**

- **The raw vendor timelines** (`src/scripted-transport.ts`): hand-scripted
  Binance depth/trade frames and news-wire records over an injected transport
  port. A production host swaps in a real websocket client; everything
  downstream of `recv()` is unchanged.
- **The venue seam**: the gateway is bound to T040's own exported RECORDING
  port (the deterministic fake the gateway suite ships for downstream lanes).
  No real broker/OMS-EMS session runs here — T040's interop tests drive the
  REAL T039 sessions through the same port shape.
- **The time machine**: T030 consumes a rolling time machine through an
  injected port; this slice ships a compact scripted implementation of that
  port over the same canonical events (the point-in-time view with the
  INCLUSIVE availability boundary). The REAL rolling machine (T029) is not a
  direct dependency of this slice; T030's own interop test drives it through
  the identical port shape.
- **The director's research intake**: the research bodies (T021 sentiment,
  T022 regime, T023 fundamental/cross-market) are OUTSIDE this slice's
  dependency set. Their product arrives as the T024 package's own published
  fixture reports (in the director lane's fixture scope). The news station's
  canonical events ARE the sentiment lane's observation surface — but the
  transformation news -> report is the research lanes' lane.
- **The adversary**: one scripted crossing buy through T027's participant
  action feed (a production adversary is a T027 policy, not a script).
- **The step-1 declared fills** (`sliceStep1Fills`): the T018 discipline —
  declared fills are INPUTS to the step-2 state (the harness assumption that
  the venue filled the step-1 requests); the shadow lane below MEASURES that
  assumption against the engine (and the measured outcome — a PARTIAL fill,
  because the adversary consumed the book — is what the outcome log records).

## The two decisions

1. **Step 1 — the equal-weight allocation** (asOf `T0+320_000`): the genesis
   100,000 cash splits 50/50 over BTC-USDT and ETH-USDT; the compiler emits
   two LIMIT buy intents anchored at the last adapter prints (0.998 BTC @
   50100; 16.66 ETH @ 3000), each with its full constraint-proof block.
2. **Step 2 — the drift correction** (asOf `T0+340_000`, after the rally print
   at 62000): the held BTC weight drifted to 55.3% — outside the 5% band — so
   the compiler emits the LIMIT sell (0.095 BTC @ 62000). The step-1 window
   provably does NOT see the rally print (L4); the step-2 window does.

Both decisions' intents flow through BOTH outbound lanes: the LIVE lane (the
gateway — routed to the venue seam, or REFUSED) and the PAPER lane (the shadow
session against the reactive world — where the fills and expiries actually
happen in this slice, with full physics lineage).

## The negative paths (typed records, never exceptions, never silent)

- **Strategy — constraint primacy**: the same window + spec under a REVISED
  constraint set (a blocking universe ceiling of one against the spec's two
  instruments): every candidate is a typed `constraint_refused` refusal
  RECORD — never a constrained-down intent.
- **Director — quorum unmet**: two of the four research lanes absent: the
  composition produces the ESCALATION record (an operational handoff, not a
  degraded decision).
- **Director — research from the future**: the sentiment report's asOf moved
  past the decision instant: the typed `research_from_the_future` refusal
  (the L4 gate — the director never consumes future research).
- **Gateway — duplicate decision**: the same decision submitted twice: the
  typed `duplicate_decision` refusal (the first stands).
- **Gateway — policy gate (limits)**: an oversized notional (30 BTC, ~1.5M):
  the REAL T019 gate's `policy_gate` refusal.
- **Gateway — mode separation**: a shadow-mode intent reaching the LIVE
  gateway: the `shadow_mode` refusal (L5/R23).
- **Gateway — thrown kill switch**: the fail-closed `policy_gate` refusal
  (the risk desk's circuit breaker).
- **Gateway — expired authority grant**: the Default-Deny `authority_grant`
  refusal.
- **Gateway — the no-bypass law**: EVERY refusal above costs ZERO adapter
  calls (the recording port's log proves it: exactly one call per ROUTED
  order, nothing else).
- **Shadow — cross-tenant**: a foreign tenant's intent in the decision source
  fails the WHOLE run closed with the typed `tenant_mismatch` (L12: a
  cross-tenant decision is an operational crime, inexpressible — never
  evidence), with ZERO world submissions.
- **Shadow — mode honesty**: creating a session that claims `'live'` fidelity
  is the typed `fidelity_claim_dishonest` refusal.

## Limitations (honest)

- The research bodies (T021–T023) are not wired end-to-end: the director
  consumes the T024 package's published fixture reports (their own fixture
  scope, `tenant-director/project-portfolio`), and the slice's execution
  records cite the resulting decision id as directive provenance.
- The reactive world executes the BTC-USDT stream only: the ETH mark informs
  the strategy (the window's print) but carries no book in this world; the
  ETH intent's live-lane routing is acknowledged at the seam, and no fill
  evidence exists for it (the recording port carries no fill stream).
- The exchange engine declares NO endogenous impact beyond the book walk (the
  engine matches the visible book only); richer endogenous reaction is a T027
  policy composition, outside this slice.
- The BTC buy's unfilled remainder (0.098 of 0.998) RESTS at the venue at the
  session's close — the lifecycle stays `partially_filled`; no close-out is
  invented.
- The gateway's venue seam is the recording port (above); real venue
  round-trips are T039/T040 interop territory.
- The director's fixture decision (an `allocation-adjustment` directive) is
  upstream evidence the execution lane cites; the slice does not close the
  loop from the directive's allocation numbers into the strategy spec's
  parameters (the strategy runs its OWN declared spec — the wiring of
  director directives into strategy revisions is T035's improvement loop).

## The file map

| File | Role |
|------|------|
| `src/scope.ts` | THE scope: every literal of the day (ids, instants, helpers) |
| `src/scripted-transport.ts` | the injected transport ports (the vendor-timeline fixtures) |
| `src/market-data.ts` | STATION 1 — the REAL adapter sessions over the timelines |
| `src/reactive-world.ts` | STATION 2 — the REAL reactive world + engine + adversary + the scripted time machine |
| `src/strategy.ts` | STATION 3 — the REAL strategy compiler: spec, goal, constraint sets, windows, both runs |
| `src/director.ts` | STATION 4 — the REAL director synthesis: the decision, the escalation, the L4 probe |
| `src/control-stack.ts` | the shared hard controls (the REAL T019 policy + T020 risk policy + kill switches) both outbound lanes consume |
| `src/gateway.ts` | STATION 6 — the REAL chokepoint: authority stack, gate/risk facts, the submission plan (positives + negatives) |
| `src/execution-body.ts` | STATION 5 — the REAL order lifecycles + gateway requests + fill reconciliation |
| `src/shadow.ts` | STATION 7 — the REAL shadow session + the realized-outcome fold + the negatives |
| `src/run.ts` | THE WHOLE LOOP — `runReferenceSlice()` and the `SliceReport` |
| `src/index.ts` | the public surface (typed exports) |
| `../../tests/end-to-end-trading/` | the colocated suite: the full loop, per-station positives, every negative path |
