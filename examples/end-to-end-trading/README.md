# @tradrl/example-e2e-trading — the reference end-to-end trading slice (T048)

One deterministic, fully-wired demonstration of the whole TradRL pipeline
(spec/ARCHITECTURE.md lines 5-6, made runnable):

```
User goal -> organization -> bodies -> Agent OS -> market world -> research
          -> strategy -> risk -> execution -> outcome
```

## The law this package obeys

- **Structural mirrors only (D-003/D-004).** This package imports NOTHING
  outside its own tree. Every cross-package shape it consumes — the
  BodyVersion family, the four research report shapes, the director decision,
  the strategy spec/intent/run, the risk/limit records, the seven-check gate
  machine, the gateway order-request translation contract, the order
  lifecycle, the exchange config/fills, the reactive world records, the time
  machine records, the shadow outcome records — is re-declared field-for-field
  in `src/mirrors/`. The interop trip-wire tests under
  `tests/end-to-end-trading/` import the REAL merged packages and make mirror
  drift loud.
- **Zero runtime dependencies.** `package.json` carries no dependencies; the
  new importer passes `pnpm install --frozen-lockfile` (the 36-merge
  precedent).
- **Exact decimals everywhere.** Every quantity, price, weight, fee, tilt and
  PnL is an exact decimal string; floats never mediate money paths.
- **Injected instants only.** No wall clock, no randomness: the whole run is
  byte-reproducible from `src/scenario.ts`.
- **Tenant/project scoping on every record (L12)** and an append-only,
  chain-verified L15 lineage ledger (`src/lineage.ts`) whose outcome entries
  trace back to the goal by a pure graph walk (`traceToGoal`).

## Running

```bash
npx tsx examples/end-to-end-trading/src/index.ts
```

prints the compact evidence report (run id, stream digest, ledger stage
counts, intent/approval/fill/outcome counts, lineage verification) plus the
first and last lines of the byte stream.

## What the reference run demonstrates

| Stage | Records | Reference outcome |
|---|---|---|
| scenario | goal + constraint set + budget + universe + stream | the frozen scenario `e2e-reference/1` |
| organization | blueprint + organization (7 agents, 6 topic wires) | compiled within the declared budget |
| bodies | 7 BodyVersions + possessions + instances + kernel ops | L8: director has NO execution authority; execution body is `external-gateway-only` |
| market world | time-machine records + as-of view (L4 firewall) + 3 seeded engines + reactive observations | 12 canonical events admitted point-in-time |
| research | 4 research reports (sentiment/regime/fundamental/cross-market) with typed data gaps | BTC positive / trending-up / positive / co-movement |
| director | one DirectorDecision (`dd-`) via the declared synthesis method | allocation-adjustment: BTC-USD `+0.0300` |
| strategy | spec + genesis portfolio state + StrategyRun with 3 constraint-proved intents | BTC 0.715, ETH 11, SOL 332.9 (lot-fenced, limit-priced) |
| risk + gateway | limit evaluations + 7-check gate decisions + gateway audit + submissions | 2 approvals (`xd:`), 1 TYPED limits refusal — zero adapter calls on the refusal |
| execution | order lifecycle logs (L16 order-level clock) + reconciliations + engine/reactive fills | 2 orders filled; exact-equality reconciliation |
| outcomes | shadow book + shadow fills + outcome records (chain-verified log) | 2 `filled` + 1 `refused` dispositions; every outcome traces to the goal |

## The typed errors the tests enforce

- `decision_not_approved` — execution without gateway authorization (L8):
  a non-approve record, a refusal decision, or a FORGED `xd:` id can never
  become an order request or reach a venue (the paper adapter re-checks).
- `kill_switch_thrown` — fail-closed submission under a thrown switch.
- `research_from_the_future` / `tenant_mismatch` — the director's L4/L12 gates.
- `observation_gap` — the strategy fails closed without a mark (L4).
- `constraint_refused` — blocking constraint violations refuse intents
  BEFORE emission (never after).
- `lifecycle_violation` / `fill_fabricated` / `clock_confusion` — the order
  lifecycle's declared machine.
- `lineage_unknown_parent` / `lineage_chain` / `lineage_rewrite` — the L15
  ledger's append-only chain.

## See also

- `tests/end-to-end-trading/` — the integration gate: run-green, interop
  drift trip-wires, broken-link, gate-bypass, lineage (L15) and determinism
  suites.
- `src/stream.ts` — the byte-deterministic record stream + digest.
