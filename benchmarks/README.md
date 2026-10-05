# benchmarks/ — the platform benchmark machinery (T049)

The benchmark/measurement **runners** — the platform machinery that T045's
verification seam explicitly does not own. T045's `verifyDeliverable` folds
"the outcomes the platform's verification machinery supplies"; this lane is
that machinery for the **benchmark** requirement kind, and the platform's own
self-benchmark surface besides.

## What lives here

One package: `benchmarks/platform/` (the Work Order's write surface
`benchmarks/`). It ships **no `package.json`** (the `examples/` precedent:
zero workspace edges — the `benchmarks/*` workspace glob stays inert, the
frozen lockfile is untouched).

| Module | The law it owns |
|---|---|
| `src/slice-mirror.ts` | the T048 **SliceReport/lineage mirror** — the natural live input — plus the pipeline-coherence invariants (embargo law, audit law, L15 goal binding, L16 clock separation) |
| `src/split-mirror.ts` | the **T032 split discipline** — the split-plan structural mirror + the mirrored `splan:` content-address verifier |
| `src/search-mirror.ts` | the **T031 search-record mirror** + the mirrored chain verifier (in-search vs holdout runs THROUGH the record) |
| `src/material.ts` | the **T028 counterfactual populations** + replay/live sources; the evidence-class law (`live_claim_on_simulation`, `evidence_conflated`, `synthetic_holdout`) |
| `src/metrics.ts` | the closed **measurable vocabulary** (what a suite may honestly extract; the book money is FLEXIBLE-SCALE — the report's own arithmetic decides, each suite's axis declares the exact scale) + the L16a structured-metric mirror |
| `src/suite.ts` | the **capability-suite definition** (content-addressed `cbms:`; axis laws; the L9 subject binding) |
| `src/measurement.ts` | **`runSuiteMeasurement`** — the runner: suite/subject/evidence/class/phase laws, per-axis extraction, attainment fold, the content-addressed `cbmm:` record |
| `src/log.ts` | the append-only, **chain-verified measurement log** (`cbml:`, L11) |
| `src/adoption.ts` | the **T035 improvement loop's evidence gates** over measured evidence (`selected_without_holdout` / `evidence_missing` / `evidence_insufficient` / `hidden_trials`) |
| `src/discharge.ts` | the **T045 discharge seam**: benchmark requirements → verification outcomes (the supplier side of the seam) |

## Mirrors only (D-003/D-004)

`src/` imports **nothing** outside this package. Every cross-lane shape
(T009/T011/T012/T028/T031/T032/T035/T045/T048) is a structural mirror; the
interop trip-wire tests (in `research/public-evaluation/src/`, the only
vitest-collected surface of this Work Order) import the REAL lanes and prove
every mirror: the REAL T048 report verifies under the mirror, the REAL T032
plan verifies with the identical `splan:` id, the REAL T031 record verifies
through the mirrored chain, the REAL T045 exchange folds this lane's
outcomes, the REAL T035 vocabulary agrees.

## Running the machinery

```bash
corepack pnpm vitest run research/public-evaluation   # the lane's whole suite (machinery + publication)
```

The suites are deterministic: no wall clock, no ambient randomness, exact
decimals, content-addressed records — the same inputs always produce the
same bytes (the publication layer's re-verification depends on exactly
this).
