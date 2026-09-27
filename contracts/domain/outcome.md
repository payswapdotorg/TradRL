# Outcome

**Owning document:** T002 · **Package:** `@tradrl/domain-core` (`outcome.ts`)
**Spec source:** `spec/DOMAIN-MODEL.md` (Outcome), L7, L15, R26.

An Outcome closes the loop: it links a Decision (and, when the decision
reached the execution plane, the Execution record) to the **realized
result** at an instant — with a verdict against the decision's intent,
metrics recorded as data, and an optional post-mortem reference (T033).
Raw PnL is never the sole content (L7): the verdict and constraint-aware
metrics are the record; PnL is one field among them.

## Outcome

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | `OutcomeId` | yes | Opaque identity. |
| `projectId` | `ProjectId` | yes | Lineage root (L15). |
| `decisionId` | `DecisionId` | yes | The decision this outcome realizes. Required — outcome without a decision is a category error here. |
| `executionId` | `ExecutionId` | no | Execution record when the decision reached the execution plane. Opaque (T019/T040). Absent = not executed. |
| `realizedAt` | `Timestamp` | yes | Realization instant. |
| `verdict` | `OutcomeVerdict` | yes | `met` · `partially-met` · `missed` · `inconclusive` (closed) — verdict against the decision's intent/goal criteria. |
| `realizedPnl` | `DecimalString` | no | Realized PnL attributable to the decision, when measurable. Signed canonical decimal. |
| `metrics` | `Record<string, OutcomeMetricValue>` | yes | Realized-result metrics as data. Keys are identifier paths (`pnl.realized`, `constraints.satisfied`). Values: finite numbers or non-empty strings. May be empty. |
| `postMortemId` | `PostMortemId` | no | Post-mortem analyzing this outcome. Opaque (T033). |
| `summary` | `string` | no | Human summary. |

## Invariants

1. `decisionId` is mandatory (L15: decision → outcome lineage is the spine
   of outcome learning, R26).
2. `metrics` keys are identifier paths; values are finite numbers or
   non-empty strings — never `null`, never empty strings, never `NaN`.
3. Metric **definitions** are owned by producers (evaluation T012,
   outcome-learning T033); consumers must treat recorded metrics as opaque
   named data.
4. `verdict` is a closed vocabulary — extending it is a contract version
   bump.
5. An outcome is recorded once realization is known; partial realizations
   are either `partially-met` verdicts or separate outcome records per
   decision, per producer discipline.

## Versioning rules

- Outcomes are immutable point-in-time records. Corrections (vendor data
  restatements, metric recomputation) produce a **new Outcome record** with
  a store-managed correction lineage; historical records are never
  rewritten (evaluation integrity depends on this, L11).
- Post-mortems attach by reference: `postMortemId` may be added only
  through the outcome-learning lane's own record lifecycle, not by mutating
  this record.

## JSON example (machine-validated)

```json
{
  "id": "out_1",
  "projectId": "prj_1",
  "decisionId": "dec_1",
  "executionId": "exec_1",
  "realizedAt": "2027-01-20T16:45:00Z",
  "verdict": "met",
  "realizedPnl": "186.40",
  "metrics": {
    "pnl.realized": 186.4,
    "constraints.satisfied": 9,
    "constraints.violated": 0,
    "slippage.bps": 1.7,
    "comment": "Scale-in completed within risk limits."
  },
  "postMortemId": "pm_1",
  "summary": "Scale-in achieved objective with 9/9 constraints satisfied."
}
```
