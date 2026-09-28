# Attainment Verdict

**Owning document:** T012 · **Package:** `@tradrl/evaluation` (`packages/evaluation`)
**Spec source:** spec/EVALUATION-PROTOCOL.md ("Acceptance"), spec/ARCHITECTURE.md "Evaluation", ARCHITECTURE-LOCK **L7, L9, L10, L11, L20**.

The verdict is THE acceptance computation of the evaluation lane:

```
(criteria + per-split constraint reports + suite + config)
    -> compileAttainmentVerdict -> AttainmentVerdict
```

**L7 BY CONSTRUCTION**: the ONLY attainment inputs are constraint-
satisfaction counts. No record on the compilation path — criteria, reports,
evidence, verdict — carries a field that can hold a PnL, a return, or any
raw performance figure. The structural test ("PnL solicitude") asserts the
absence over the recursive key set of every record, at runtime AND at
compile time (`@ts-expect-error` excess-property trip wire).

## Inputs

### AcceptanceCriteria — structural mirror of T007 control-domain

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | `AcceptanceCriteriaId` | yes | Canonical deterministic id encoding goal + constraint-set lineage (L15). |
| `goal` | `{ goalId: GoalRef, version }` | yes | Lineage: the goal version compiled from. |
| `constraintSet` | `{ id: ConstraintSetId, version }` | yes | Lineage: the constraint set compiled against. |
| `criteria` | `readonly CriterionBinding[]` | yes (**non-empty**) | One compiled binding per success criterion; ids unique. |
| `evaluationPolicy` | `{ blindEvaluationRef, walkForwardRef, regimeRef }` | yes | The protocol pinned at compile time (opaque refs owned by this lane — L10/L11: evaluation cannot be shopped). |

`CriterionBinding` = `{ criterionId, requiredSatisfaction ∈ [0,1],
gatingConstraintIds (non-empty, unique), blockingConstraintIds (⊆ gating) }`.

### SplitConstraintReport — mirror of domain-core's evaluation output

| Field | Type | Required | Semantics |
|---|---|---|---|
| `split` | `SplitPolicyRef` | yes | The split policy this report was produced under. |
| `checks` | `readonly ConstraintCheckMirror[]` | yes | Per-constraint outcomes: `{ constraintId, severity: advisory\|blocking, status: satisfied\|violated\|not_applicable\|error }` — structural subset-mirror of domain-core's `ConstraintCheck`. |
| `satisfied` .. `advisoryViolations` | `number` | yes | Aggregate counts — RECOMPUTED from the checks by `splitConstraintReport` (forged aggregates fail the guard). |
| `invalidReason` | `string` | no | Present when the underlying evaluation failed structurally. |

### EvaluationConfig

| Field | Type | Required | Semantics |
|---|---|---|---|
| `evaluatorVersion` | `EvaluatorVersionRef` | yes | Lineage: the compiled evaluator that produced the reports. |
| `suite` | `SuiteId` | yes | Lineage: the suite the run executed. |
| `criteria` | `AcceptanceCriteriaId` | yes | Lineage: the criteria the verdict decides. |
| `confidence` | `ConfidenceThresholds` | yes | Deterministic thresholds: `highEvidenceVolume >= moderateEvidenceVolume >= 1`, `maxVacuousShareForModerate >= maxVacuousShareForHigh` (unit intervals). |

## AttainmentVerdict

| Field | Type | Required | Semantics |
|---|---|---|---|
| `verdictId` | `VerdictId` | yes | Deterministic derived id (`vd:` + digest of the criteria/suite/evaluator lineage triple). |
| `attained` | `boolean` | yes | True iff EVERY criterion attains in EVERY split AND no limitations were found. |
| `criteriaId` / `suite` / `evaluatorVersion` | ids | yes | Lineage (L9). |
| `perCriterion` | `readonly CriterionVerdict[]` | yes | Per-criterion: worst-split status, aggregate ratio, per-split evidence. |
| `limitations` | `readonly VerdictLimitationCode[]` | yes | COMPUTED, never caller-supplied: `incomplete-split-coverage`, `unknown-split-report`, `vacuous-split`, `evaluation-errors-present`, `invalid-split-report`. Any limitation forces `attained: false`. |
| `confidence` | `VerdictConfidenceBlock` | yes | `low \| moderate \| high` (a category, never a score) + evidence volume + vacuity, derived deterministically from the config thresholds. |
| `inputDigest` | `string` | yes | Digest over the canonical JSON of ALL inputs — mutation of ANY input changes it. |
| `verdictHash` | `string` | yes | Digest over the canonical JSON of the verdict minus itself — byte-determinism witness. |

## Semantics (worst-split law)

A criterion ATTAINS iff, in EVERY split of the suite, its gate attains:
ratio = `satisfied / (satisfied + violated + errors)` over the criterion's
GATING constraints (`not_applicable` excluded; wholly inapplicable gate
satisfies NOTHING — fail-closed); any blocking violation or evaluation
error forces that split to not-attained. Status priority (worst across
splits): `blocking-violation > evaluation-error > below-required-
satisfaction > vacuous-evaluation > missing-evidence > attained`.

## Typed error laws (fail-closed)

- `invalid_criteria` / `invalid_config` / `invalid_suite` /
  `invalid_report` — structural failures (L7: never silently succeed);
- `criteria_mismatch` — config/criteria/suite/evaluator lineage disagrees;
- `policy_coverage_missing` — the suite does not cover an evaluation policy
  ref the criteria pinned at compile time (L10/L11: evaluation cannot be
  shopped after the fact);
- `invalid_report` — two reports claim one split.

## The T007 bridge

`toAttainmentEvidence(verdict, evaluationRunRef, evaluatedAt)` projects the
verdict into the T007-shaped `AttainmentEvidence` (per-criterion aggregate
counts over all splits) the control plane's `decideAttainment` consumes.
`evaluatedAt` is an explicit parameter — no ambient clock (replayable).

## JSON example (machine-validated)

An evaluation config (verdict records are derived data — the config is the
authoritative input shape):

```json
{
  "evaluatorVersion": "evaluator.friction-suite@3",
  "suite": "suite.friction-2024q4",
  "criteria": "ac:5:goal-1:1:3:set-1:4",
  "confidence": {
    "highEvidenceVolume": 12,
    "moderateEvidenceVolume": 4,
    "maxVacuousShareForHigh": 0,
    "maxVacuousShareForModerate": 0.25
  }
}
```
