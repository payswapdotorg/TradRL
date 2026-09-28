# Metrics

**Owning document:** T012 · **Package:** `@tradrl/evaluation` (`packages/evaluation`)
**Spec source:** spec/EVALUATION-PROTOCOL.md ("Acceptance", "Evaluation layers"), spec/ARCHITECTURE.md "Evaluation", ARCHITECTURE-LOCK **L7, L9, L20**.

Metrics are the DEFINITIONS the evaluation lane reports; verdicts (03) compile
from constraint-satisfaction aggregates only. The metric vocabulary is the
machine-checkable form of L7: **raw PnL is insufficient** — so the vocabulary
has exactly two kinds, and neither can carry a performance figure:

- `constraint-aggregate` — FIRST-CLASS aggregate constraint statistics (the
  closed vocabulary of domain-core's `ConstraintEvaluationReport` aggregates:
  `satisfied | violated | errors | notApplicable | blockingViolations |
  advisoryViolations | satisfiedRatio`). The only gateable kind.
- `risk-adjusted-ref` — an OPAQUE reference to a risk-adjusted figure (e.g.
  `figure:sharpe@2`). The figure's numeric value NEVER enters an evaluation
  record; a risk-adjusted ref can never be the sole criterion (structurally,
  verdict inputs are per-split constraint reports — a ref cannot even be
  stated there).

## MetricDefinition

| Field | Type | Required | Semantics |
|---|---|---|---|
| `kind` | `'constraint-aggregate' \| 'risk-adjusted-ref'` | yes | The discriminant. |
| `metricId` | `MetricId` | yes | Opaque non-empty metric identity (unique within a registry). |
| `aggregate` | `ConstraintAggregate` | kind = constraint-aggregate | Which aggregate constraint statistic this metric measures. |
| `figureRef` | `string` | kind = risk-adjusted-ref | Opaque reference to the risk-adjusted figure (never its value). |
| `description` | `string` | no | Human context. NEVER interpreted. |

## MetricResult

| Field | Type | Required | Semantics |
|---|---|---|---|
| `metricId` | `MetricId` | yes | The measured metric (must exist in the registry). |
| `value` | `MetricValue` | yes | Either `{ kind: 'constraint-aggregate', aggregate, value }` (count ≥ 0 integer; unit interval for `satisfiedRatio`) or `{ kind: 'risk-adjusted-ref', figureResultRef }` (opaque result reference — never a number). |

## MetricRegistry

An immutable list of definitions with unique metric ids. The ONLY authority
for interpreting a `MetricId`. `createMetricRegistry` is collect-all: every
violation is a typed error with an indexed path; duplicate ids fail with
`duplicate_metric`. `validateMetricResult` binds results to the registry
(`unknown_metric` / `invalid_metric` on kind mismatch).

## Invariants (machine-checked)

1. L7 solicitude: no recursive key of any metric record matches a
   performance-figure name (`pnl|profit|loss|return|gain|sharpe|sortino|
   calmar|drawdown|alpha|beta|benchmark|performance|money|earn`); a
   risk-adjusted metric result structurally cannot carry a numeric figure.
2. `satisfiedRatio` mirrors domain-core's semantics exactly:
   `satisfied / (satisfied + violated + errors)` — `not_applicable`
   excluded; a wholly inapplicable set satisfies NOTHING (fail-closed: no
   vacuous pass).
3. `metricRegistryId` is a deterministic digest over the canonical JSON of
   the definitions in registry order (L9 lineage).

## JSON examples (machine-validated)

```json
{
  "kind": "constraint-aggregate",
  "metricId": "metric.gate-ratio",
  "aggregate": "satisfiedRatio"
}
```

```json
{
  "kind": "risk-adjusted-ref",
  "metricId": "metric.figure.sharpe",
  "figureRef": "figure:sharpe@2",
  "description": "Risk-adjusted figure reference — reported, never gateable."
}
```
