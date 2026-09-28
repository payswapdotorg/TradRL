# Search Integrity

**Owning document:** T012 · **Package:** `@tradrl/evaluation` (`packages/evaluation`)
**Spec source:** spec/EVALUATION-PROTOCOL.md ("Selection integrity"), spec/ARCHITECTURE.md "Evaluation" ("Preserve search history"), ARCHITECTURE-LOCK **L11, L20**.

Search-integrity reporting reads the FULL experiment trial log — including
failures and rejections — and quantifies the best-of-N selection effect.
"Never accept the best backtest found during search as sufficient evidence.
Preserve search history" is implemented structurally:

- the input is the RAW append-only log (every entry, progressions included)
  mirrored from T011 experiments' `TrialRecord`;
- HIDING TRIALS IS A TYPED ERROR: the per-trial statistics must cover EVERY
  distinct trial id of the log (`hidden_trials`) and may name no trial
  outside it (`unknown_statistic`);
- the best-of-N effect is QUANTIFIED, never hidden.

## Inputs

| Input | Type | Semantics |
|---|---|---|
| `experiment` | `{ experiment_id: ExperimentId, trials: readonly TrialLogEntry[] }` | The FULL raw trial log (T011 mirror; progressions retained). |
| `statistics` | `readonly TrialStatistic[]` | One `{ trial_id, statistic: number \| null }` per DISTINCT trial id (null when the trial produced none — failures legitimately carry null). |
| `selection` | `{ selectedTrialId: TrialId }` | The search's declared best trial. |

`TrialLogEntry` mirrors T011's `TrialRecord` field-for-field
(`trial_id`, `arm`, `status: planned|running|succeeded|failed|rejected`,
`trajectory`, `outcome`, `started_at`, `ended_at`, `failure_reason`) with
the full status-invariant law (success without evidence is inexpressible;
unexplained failure is not auditable; rejected trials never ran).

## SearchIntegrityReport

| Field | Type | Required | Semantics |
|---|---|---|---|
| `reportId` | `string` | yes | Deterministic derived id (`sir:` + digest over experiment + log + statistics + selection). |
| `experiment` | `ExperimentId` | yes | The audited experiment. |
| `trialsCounted` | `number` | yes | Distinct trial ids (latest-record projection size). |
| `logEntries` | `number` | yes | Raw appended entries (>= trialsCounted when progressions were recorded). |
| `progressions` | `number` | yes | `logEntries - trialsCounted` — retained lifecycle history. |
| `succeeded` | `number` | yes | Latest-status succeeded trials. |
| `failuresRetained` | `number` | yes | Latest-status failed trials — RETAINED and counted (L11). |
| `rejectionsRetained` | `number` | yes | Latest-status rejected trials — RETAINED and counted (L11). |
| `nonTerminal` | `number` | yes | Latest-status planned/running trials (honesty, not error). |
| `bestOfN` | `BestOfNEffect \| null` | yes | The quantified selection effect (null only via the typed `no_candidates` refusal — the report never invents one). |

`BestOfNEffect` = `{ selectedTrialId, reportedStatistic,
blindSelectionExpectation, candidates, selectionInflation,
selectedIsBest }`:

- `reportedStatistic` — the selected (best) trial's statistic: the number
  the search reported;
- `blindSelectionExpectation` — the mean statistic over ALL candidate
  trials: what a BLIND pick would expect (the honest baseline);
- `selectionInflation = reportedStatistic - blindSelectionExpectation` —
  the quantified best-of-N selection effect;
- `selectedIsBest` — whether the selection is even the argmax of the
  candidates (a "selection" that is not the best is itself an integrity
  signal).

## Typed error laws (fail-closed, L11)

1. `invalid_trial` — a log entry fails the mirrored structural law;
2. `hidden_trials` — statistics do not cover every distinct trial id;
3. `unknown_statistic` — a statistic names a trial outside the log (or a
   duplicate statistic);
4. `selection_not_in_log` / `selected_without_statistic` — the selection
   claim is unbacked;
5. `no_candidates` — no trial carried a statistic; the effect is undefined
   and REFUSED, not invented.

## JSON example (machine-validated)

A trial-statistics array covering a full log (one entry per distinct
trial — failures carry null):

```json
[
  { "trial_id": "trial-1", "statistic": 0.62 },
  { "trial_id": "trial-2", "statistic": null },
  { "trial_id": "trial-3", "statistic": null },
  { "trial_id": "trial-4", "statistic": 0.10 }
]
```
