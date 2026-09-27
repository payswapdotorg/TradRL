# Goal

**Owning document:** T002 · **Package:** `@tradrl/domain-core` (`goal.ts`, `market-scope.ts`)
**Spec source:** `spec/DOMAIN-MODEL.md` (Goal), `spec/REQUIREMENTS.md` R1.

A Goal is the immutable, point-in-time statement of WHAT the organization
must achieve and WHAT it may do in pursuit: the objective, the horizon, the
executable success criteria, the allowed markets/data/actions, and the risk
policy that governs pursuit. The Goal/Constraint Compiler (T007) consumes
goals; the execution authority (T040) treats `allowedActions` as the
project-level permission baseline.

## Goal

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | `GoalId` | yes | Opaque identity. Created by the control plane (T007). |
| `createdAt` | `Timestamp` | yes | Authoring instant. |
| `objective` | `string` | yes | Human-readable objective statement. Interpreted by agents and compilers; NEVER executed as instructions. |
| `horizon` | `GoalHorizon` | yes | Evaluation window. |
| `successCriteria` | `GoalSuccessCriteria` | yes | The executable definition of attainment. |
| `marketScope` | `MarketScope` | yes | Markets the goal may operate on (allowed universe). Must be non-empty and explicit. |
| `dataScope` | `DataScope` | yes | External data categories/feeds the goal may consume. Empty categories = no external data. |
| `allowedActions` | `readonly PermittedAction[]` | yes | Closed permission vocabulary. At least one permission required — a goal that permits nothing is degenerate. |
| `riskPolicyId` | `RiskPolicyId` | yes | Opaque reference to the risk policy record owned by the risk lane (T020). Hard risk enforcement is code, never prompts (L8/L20). |
| `description` | `string` | no | Free-form context for humans. |

### GoalHorizon

| Field | Type | Required | Semantics |
|---|---|---|---|
| `startsAt` | `Timestamp` | yes | Inclusive start of the horizon. |
| `endsAt` | `Timestamp` | yes | **Exclusive** end (the horizon covers `[startsAt, endsAt)`), matching evaluation split conventions. |
| `label` | `string` | no | Human label, e.g. "Q1 2027". |

### GoalSuccessCriteria

| Field | Type | Required | Semantics |
|---|---|---|---|
| `constraintSet` | `ConstraintSetRef` (`{id, version}`) | yes | The versioned constraint set defining success. Version is pinned at authoring. |
| `requiredSatisfaction` | `number` | yes | Required share of applicable constraints satisfied, closed interval `[0,1]`. Compared against `ConstraintEvaluationReport.satisfiedRatio`. |

### PermittedAction (closed vocabulary)

`order.market` · `order.limit` · `order.stop` · `order.stop-limit` ·
`order.cancel` · `order.modify` · `data.request` · `report.publish`

Research-only goals express themselves as `data.request` + `report.publish`
without order permissions. Adding a value to this list is a **contract
version bump** and requires an execution-authority update in the same
release — the vocabulary is closed precisely so hard gates can reason about
it exhaustively.

### MarketScope / DataScope

| Field | Type | Required | Semantics |
|---|---|---|---|
| `MarketScope.venues` | `readonly VenueId[]` | yes (array; may be empty) | Explicit venue universe. |
| `MarketScope.instruments` | `readonly InstrumentId[]` | yes (array; may be empty) | Explicit instrument universe. |
| `MarketScope.assetClasses` | `readonly AssetClass[]` | yes (array; may be empty) | Class-level selector. |
| `DataScope.categories` | `readonly DataCategory[]` | yes (may be empty) | Closed category vocabulary: `market-data`, `macro`, `news`, `social`, `alternative`, `corporate-actions`, `reference-data`. |
| `DataScope.feeds` | `readonly string[]` | no | Opaque feed ids (format owned by the ingestion lane, T008). |

## Invariants

1. `horizon.startsAt < horizon.endsAt` **by instant** (guards reject empty or
   inverted horizons; `10:00Z`/`11:00+01:00` is an empty horizon).
2. `allowedActions` is non-empty and every entry is in the closed vocabulary.
3. `marketScope` has at least one non-empty selector — "everything by
   default" is forbidden; the universe is always explicit.
4. `successCriteria.requiredSatisfaction ∈ [0,1]` (finite).
5. `successCriteria.constraintSet.version ≥ 1` (integer).
6. **Documented obligation (not guard-checkable):** the materialized
   `Project.marketScope`/`dataScope` must satisfy the goal's scopes; the
   compiler (T007) must verify this when materializing a Project.

## Versioning rules

- A Goal record is **immutable**. Revising an objective is a new Goal record
  with a new id; the owning Project references the goal it was launched
  with. There is no in-record `version`: identity is the version.
- Constraint-set evolution does NOT mutate the goal: the referenced
  `(constraintSetId, version)` is pinned at goal creation; new set versions
  require an explicit new goal/project decision.

## JSON example (machine-validated)

```json
{
  "id": "goal_1",
  "createdAt": "2027-01-02T08:00:00Z",
  "objective": "Grow risk-adjusted returns on crypto majors while staying within hard risk limits.",
  "horizon": {
    "startsAt": "2027-01-04T00:00:00Z",
    "endsAt": "2027-04-04T00:00:00Z",
    "label": "Q1 2027"
  },
  "successCriteria": {
    "constraintSet": { "id": "cs_goal_1", "version": 1 },
    "requiredSatisfaction": 1
  },
  "marketScope": {
    "venues": ["venue_binance", "venue_coinbase"],
    "instruments": ["instr_btc_usdt"],
    "assetClasses": ["crypto"]
  },
  "dataScope": { "categories": ["market-data", "news"], "feeds": ["feed_agg_trades"] },
  "allowedActions": ["order.market", "order.limit", "order.cancel", "data.request"],
  "riskPolicyId": "risk_policy_1",
  "description": "Primary capital preservation goal."
}
```
