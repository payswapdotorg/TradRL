# Experiment

**Owning document:** T011 · **Package:** `@tradrl/experiments` (`packages/experiments`)
**Spec source:** `spec/DOMAIN-MODEL.md` (Experiment), `spec/EVALUATION-PROTOCOL.md` (Selection integrity, Acceptance), `spec/LEARNING-LOOP.md` (native loop), ARCHITECTURE-LOCK **L9, L11, L12, L15**, R18, R20.

The Experiment is the **canonical research-intervention record**: the full
design of an intervention PLUS the complete search history of its execution.
Design alone is not an experiment — the trials that ran, failed and were
rejected are as much a part of the record as the hypothesis, because
selection effects live in the history (L11). Everything downstream builds on
this record: evaluation (T012) scores trials by arm, the RL bridge (T013)
consumes trial trajectories, curriculum (T015) spawns follow-up experiments,
search-integrity audits (T031) replay the log, and firm memory (T034)
persists the whole thing.

## ExperimentRecord

| Field | Type | Required | Semantics |
|---|---|---|---|
| `experiment_id` | `ExperimentId` | yes | Opaque identity. Brand mirrors domain-core's reserved `ExperimentId` reference. |
| `tenant` | `TenantId` | yes | Isolation scope (L12). |
| `project` | `ProjectId` | yes | Continuity root (L15). |
| `goal` | `GoalId` | yes | The goal this experiment serves (L15). |
| `criteria` | `readonly CriteriaRef[]` | yes (**non-empty**) | The experiment's success criteria (opaque; evaluation lane). |
| `design` | `ExperimentDesign` | yes | The fixed half (below). |
| `trials` | `readonly TrialRecord[]` | yes | The append-only search history (below). |
| `finalization` | `{ finalized_at, outcome } \| null` | yes | `null` while open; set once by `finalizeExperimentRecord`, then the log is frozen. |

## ExperimentDesign — the DOMAIN-MODEL sentence, field for field

"Hypothesis, intervention, comparison, splits, candidate organization,
bodies/substrates, datasets, environment configuration and evaluator
version":

| Field | Type | Required | Semantics |
|---|---|---|---|
| `hypothesis` | `string` | yes | The falsifiable statement under test. |
| `intervention` | `InterventionDescriptor` | yes | `{ kind, description, parameters }` — what is being manipulated; taxonomy owned by the learning/organization lanes. |
| `comparison` | `readonly ArmDescriptor[]` | yes (**non-empty**) | The arms: `{ arm, role: control\|treatment, description }`. At least one treatment arm; unique arm ids. |
| `splits` | `readonly SplitPolicyRef[]` | yes (**non-empty**) | Split policy refs — arm assignment, walk-forward, holdout. Non-empty because in-search vs holdout must always be decidable (L11 / EVALUATION-PROTOCOL "Selection integrity"). |
| `candidate_organization` | `OrganizationId` | yes | The organization under study (opaque). |
| `body_versions` | `readonly BodyVersionRef[]` | yes (**non-empty**) | Bodies in play (agent-os brand mirror). |
| `substrates` | `readonly SubstrateRef[]` | yes (**non-empty**) | Substrates those bodies run on. |
| `datasets` | `readonly DataRef[]` | yes (may be empty) | Datasets the design consumes (trajectory package's brand mirror). |
| `environment_config` | `EnvironmentConfigRef` | yes | Versioned environment configuration (same identity space as the trajectory package's ref). |
| `evaluator_version` | `EvaluatorVersionRef` | yes | Versioned evaluator that scores the trials (L9 — evaluation is part of lineage). |

## TrialRecord — one trial

| Field | Type | Required | Semantics |
|---|---|---|---|
| `trial_id` | `TrialId` | yes | Opaque identity (unique per experiment; may repeat across the log ONLY as a strict lifecycle progression). |
| `arm` | `ArmId` | yes | The arm this trial executes; must exist in the design. |
| `status` | `TrialStatus` | yes | `planned \| running \| succeeded \| failed \| rejected`. |
| `trajectory` | `TrajectoryId \| null` | yes | The experience stream this trial produced (**REQUIRED for `succeeded`**). |
| `outcome` | `JsonObject \| null` | yes | Opaque evaluator summary (**REQUIRED for `succeeded`**). |
| `started_at` | `TimestampMs \| null` | yes | Start instant. |
| `ended_at` | `TimestampMs \| null` | yes | End instant (`>= started_at` when both present). |
| `failure_reason` | `string \| null` | yes | **REQUIRED for `failed` and `rejected`** — an unexplained failure is not auditable. |

**Status invariants (total):** `planned` carries no start/end/failure;
`running` has `started_at` and nothing terminal; `succeeded` has start, end,
trajectory AND outcome (success without evidence is inexpressible); `failed`
has end + reason (start may be null — failed to launch; partial trajectory
legal); `rejected` never ran (start and trajectory null) but carries end +
reason.

## The append-only discipline (L11)

- The ONLY mutation API is `appendTrial`; there is no update, removal or
  reordering entry point anywhere in the package (structurally tested).
- A NEW trial id appends freely (any status — a consumer may record a
  terminal trial in one shot).
- An EXISTING trial id may be appended again ONLY as a strict forward
  progression — `planned → running → succeeded|failed`,
  `planned → succeeded|failed|rejected` — with the same arm, and a recorded
  trajectory can never be changed or un-recorded. The earlier records STAY
  in the log: the search history is the point.
- A trajectory is one trial's evidence: two trials cannot reference the same
  trajectory (`duplicate_trajectory`).
- **Appending to a FINALIZED experiment is rejected** (`experiment_finalized`).
- Every record is deeply frozen; mutation attempts throw.

## Finalization — honest limitations

`finalizeExperimentRecord(record, { finalized_at, outcome })` is once-only,
requires at least one trial (`no_trials`), and produces an `ExperimentResult`
whose `limitations` are **computed from the record state, never
caller-supplied**:

1. non-terminal trials at finalization surface explicitly ("N trial(s) were
   still non-terminal; their outcomes are absent");
2. every arm without a succeeded trial surfaces ("arm X produced no
   succeeded trial; its comparison is incomplete");
3. zero succeeded trials ⇒ "the experiment is inconclusive on its own
   evidence".

Failures and rejections are RESULTS, not limitations — they are the search
history doing its job, and they never appear as limitations.

## Invariants (machine-checked)

1. Lineage completeness: tenant/project/goal/criteria + the design's full L9
   reference set; producer sets and criteria non-empty (negative-tested).
2. Ordering/uniqueness: trial ids repeat only as strict progressions;
   trajectories unique across trials; arms exist in the design.
3. Search integrity: the raw log retains EVERY appended record; summaries
   collapse to the latest record per trial id while reporting every status —
   nothing is dropped (acceptance-tested).
4. Finality: finalized records accept no trials; finalization is once-only;
   limitations are machine-derived.

## Consumer expectations

- **T012 (evaluation/verification):** group trials by `arm` over the latest
  projection; treat `splits` as the in-search/holdout discriminator; read
  `evaluator_version` before scoring.
- **T013 (RL bridge):** the trial's `trajectory` ref resolves through the
  trajectory package's records; a `failed` trial may still carry a partial
  trajectory worth learning from.
- **T015 (curriculum/populations):** spawn follow-up experiments as NEW
  records (continuity through the project lineage, L15 — never by editing a
  finalized one).
- **T031 (search-integrity audits):** replay `trials` (the raw log) to
  reconstruct in-search performance; `log_entries >= total_trials` is the
  signature of recorded progressions.
- **T034 (firm memory):** persist the record; the design's reference set is
  the attribution block for everything the experiment concluded.

## JSON examples (machine-validated)

An open experiment after one planned trial:

```json
{
  "experiment_id": "exp-1",
  "tenant": "tenant-1",
  "project": "prj-1",
  "goal": "goal-1",
  "criteria": ["criteria-sharpe-floor", "criteria-max-drawdown"],
  "design": {
    "hypothesis": "A researcher body with the v8 microstructure capability outperforms the v7 baseline on the friction suite.",
    "intervention": {
      "kind": "body-swap",
      "description": "Swap the researcher body from body-researcher@7 to body-researcher@8 in the treatment arm.",
      "parameters": { "slot": "researcher", "from": "body-researcher@7", "to": "body-researcher@8" }
    },
    "comparison": [
      { "arm": "arm-control", "role": "control", "description": "Baseline organization with body-researcher@7." },
      { "arm": "arm-treatment", "role": "treatment", "description": "Organization with body-researcher@8." }
    ],
    "splits": ["split-walkforward-2024"],
    "candidate_organization": "org-candidate-1",
    "body_versions": ["body-researcher@7", "body-researcher@8"],
    "substrates": ["substrate-gpt-mirror@2"],
    "datasets": ["dataset-binance-trades-2024q1"],
    "environment_config": "envcfg-5d3e8f21",
    "evaluator_version": "evaluator-friction-suite@3"
  },
  "trials": [
    {
      "trial_id": "trial-1",
      "arm": "arm-treatment",
      "status": "planned",
      "trajectory": null,
      "outcome": null,
      "started_at": null,
      "ended_at": null,
      "failure_reason": null
    }
  ],
  "finalization": null
}
```

The same experiment after the trial progressed `planned → running →
succeeded` (BOTH earlier records retained — the append-only search history):

```json
{
  "experiment_id": "exp-1",
  "tenant": "tenant-1",
  "project": "prj-1",
  "goal": "goal-1",
  "criteria": ["criteria-sharpe-floor", "criteria-max-drawdown"],
  "design": {
    "hypothesis": "A researcher body with the v8 microstructure capability outperforms the v7 baseline on the friction suite.",
    "intervention": {
      "kind": "body-swap",
      "description": "Swap the researcher body from body-researcher@7 to body-researcher@8 in the treatment arm.",
      "parameters": { "slot": "researcher", "from": "body-researcher@7", "to": "body-researcher@8" }
    },
    "comparison": [
      { "arm": "arm-control", "role": "control", "description": "Baseline organization with body-researcher@7." },
      { "arm": "arm-treatment", "role": "treatment", "description": "Organization with body-researcher@8." }
    ],
    "splits": ["split-walkforward-2024"],
    "candidate_organization": "org-candidate-1",
    "body_versions": ["body-researcher@7", "body-researcher@8"],
    "substrates": ["substrate-gpt-mirror@2"],
    "datasets": ["dataset-binance-trades-2024q1"],
    "environment_config": "envcfg-5d3e8f21",
    "evaluator_version": "evaluator-friction-suite@3"
  },
  "trials": [
    {
      "trial_id": "trial-1",
      "arm": "arm-treatment",
      "status": "planned",
      "trajectory": null,
      "outcome": null,
      "started_at": null,
      "ended_at": null,
      "failure_reason": null
    },
    {
      "trial_id": "trial-1",
      "arm": "arm-treatment",
      "status": "running",
      "trajectory": null,
      "outcome": null,
      "started_at": 1700000000000,
      "ended_at": null,
      "failure_reason": null
    },
    {
      "trial_id": "trial-1",
      "arm": "arm-treatment",
      "status": "succeeded",
      "trajectory": "traj-3f2a9c1b",
      "outcome": { "score": 0.62, "suite": "friction" },
      "started_at": 1700000000000,
      "ended_at": 1700000060000,
      "failure_reason": null
    }
  ],
  "finalization": null
}
```
