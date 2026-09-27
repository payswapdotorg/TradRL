# ConstraintSet

**Owning document:** T002 · **Package:** `@tradrl/domain-core` (`constraints.ts`)
**Spec source:** `spec/DOMAIN-MODEL.md` (ConstraintSet), R1, L7, L8, L20.

A ConstraintSet is the **versioned, executable** expression of what must
hold over observations, state, actions and outcomes. A constraint is DATA +
a predicate kind — never a prompt string. Constraint sets are the acceptance
fabric of the platform: goals reference them as success criteria, evaluation
counts them, and risk/authorization logic composes with them. Natural
language constraints (R1) are an *input* that a compiler turns into this
executable form; `provenance` records that origin and is never executed.

## ConstraintSet

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | `ConstraintSetId` | yes | Opaque identity. Identity of a set is `(id, version)`. |
| `version` | `number` | yes | Integer ≥ 1, monotonically increasing per id. |
| `name` | `string` | no | Human label. |
| `constraints` | `readonly Constraint[]` | yes | May be empty (vacuous set — see semantics below). Constraint ids unique within the set. |
| `supersedes` | `ConstraintSetRef` | no | Predecessor this set replaces. Same `id` requires strictly lower predecessor `version`; a different id encodes succession/merge lineage. |
| `provenance` | `ConstraintSetProvenance` | no | Origin of the set. |
| `createdAt` | `Timestamp` | yes | Publication instant. |

### ConstraintSetProvenance

| Field | Type | Required | Semantics |
|---|---|---|---|
| `origin` | `'authored' \| 'compiled'` | yes | `authored` = structured authoring; `compiled` = produced from another form (typically natural language). |
| `sourceText` | `string` | no | Original source text when compiled. For audit only — never executed. |
| `compilerRef` | `string` | no | Opaque reference to the compiler artifact/version. |

### Constraint

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | `string` | yes | Unique within the set. |
| `domain` | `ConstraintDomain` | yes | Phase the constraint applies to: `observation`, `state`, `action`, `outcome`. |
| `subject` | `string` | yes | Key into the selected domain map of the evaluation context. Identifier-path form: dot-separated segments starting with a letter (`portfolio.grossExposure`). |
| `predicate` | `Predicate` | yes | Executable check (below). |
| `severity` | `'advisory' \| 'blocking'` | yes | `blocking` violations fail the report; `advisory` violations are recorded but do not fail. |
| `description` | `string` | no | Human explanation. NEVER interpreted. |

### Predicate kinds

| `kind` | Extra fields | Semantics (subject value `x`) |
|---|---|---|
| `limit.max` | `bound: number` | Satisfied iff `x ≤ bound` (numeric). |
| `limit.min` | `bound: number` | Satisfied iff `x ≥ bound` (numeric). |
| `limit.range` | `min: number`, `max: number` | Satisfied iff `min ≤ x ≤ max` (numeric); `min ≤ max` enforced. |
| `equals` | `value: ConstraintValue` | Satisfied iff `x` equals `value` **with identical runtime type** (`1` ≠ `"1"`). |
| `notEquals` | `value: ConstraintValue` | Satisfied iff `x ≠ value`, identical-type requirement as `equals`. |
| `oneOf` | `values: readonly string[]` | Satisfied iff `x` (a string) is a member of `values`; the set must be non-empty. |
| `flag` | `expected: boolean` | Satisfied iff `x` (a boolean) equals `expected`. |

`ConstraintValue = number | string | boolean` (numbers finite, strings
non-empty). All bounds are finite numbers.

## Evaluation

`evaluateConstraintSet(set, context, evaluatedAt)` is **pure and
deterministic** — `evaluatedAt` is a required argument (no ambient clock),
so an evaluation is replayable from its arguments alone.

### ConstraintEvaluationContext

| Field | Type | Required | Semantics |
|---|---|---|---|
| `observations` | `Record<string, ConstraintValue>` | yes | What was seen (features, signals) at evaluation time. |
| `state` | `state` map | yes | Current world/account state (exposure, positions counts, ...). |
| `actions` | `actions` map | yes | What is about to be / was done (order attributes, decision confidence). |
| `outcomes` | `outcomes` map | yes | Realized results (PnL, verdict codes). |

Keys are identifier paths; values are `ConstraintValue`. A phase with no
data yet is an empty map — **not** a missing map.

### Statuses per check

| Status | Meaning |
|---|---|
| `satisfied` | Subject present, predicate holds. |
| `violated` | Subject present, predicate does not hold. |
| `not_applicable` | Subject key absent from the phase map at this instant (point-in-time evaluation, L4). Never fails the report. |
| `error` | Runtime type conflict (e.g. numeric predicate on a string subject, type-mismatched `equals`). **Always fails the report** — fail closed (L8/L20). |

### Report aggregation

| Field | Semantics |
|---|---|
| `satisfied`, `violated`, `notApplicable`, `errors` | Counts of the four statuses. |
| `blockingViolations`, `advisoryViolations` | Violations split by severity. |
| `satisfiedRatio` | `satisfied / (satisfied + violated + errors)`; **0 when nothing is applicable** — an empty or wholly inapplicable set satisfies nothing (no vacuous pass). `not_applicable` never counts against the ratio. |
| `pass` | True iff `blockingViolations = 0` AND `errors = 0`. Advisory violations never fail; errors always fail. |
| `invalidReason` | Set when the set/context/`evaluatedAt` failed structural validation (report is then `pass: false`, no checks). The evaluator NEVER throws — garbage input degrades to a fail-closed report. |

Goal acceptance compares `satisfiedRatio ≥ requiredSatisfaction` — this is
the mechanism behind "raw PnL is never the sole acceptance criterion" (L7)
and the "allowed constraint violation rate" of `spec/EVALUATION-PROTOCOL.md`.

## Invariants

1. `version ≥ 1`, integer; if `supersedes.id = id` then `supersedes.version < version`.
2. Constraint ids are unique within a set.
3. Predicate parameters are structurally valid per kind (finite bounds,
   non-empty `oneOf`, `min ≤ max`).
4. Subjects and context keys are identifier paths.
5. Records are immutable: a change is a new version (with lineage), never an
   in-place edit.

## Versioning rules

1. Publish version *n*, then evolve → publish version *n+1* with
   `supersedes: {id, version: n}`. Never mutate a published version.
2. Referencing lanes pin the version they mean (`ConstraintSetRef`); a
   Project re-pinning to a new set version is an explicit decision.
3. Adding a predicate kind is a **contract version bump**; removing or
   changing the meaning of an existing kind requires a new kind name, never
   a silent redefinition.
4. Subject registries (the meaning of specific subject paths per domain)
   are owned by the consuming lanes (T007 control plane, T012 evaluation,
   T020 risk); this contract fixes the key grammar and evaluation semantics.

## JSON examples (machine-validated)

A versioned set with lineage and compiled provenance:

```json
{
  "id": "cs_risk_1",
  "version": 2,
  "name": "project guardrails",
  "constraints": [
    {
      "id": "max-gross-exposure",
      "domain": "state",
      "subject": "portfolio.grossExposure",
      "predicate": { "kind": "limit.max", "bound": 1000000 },
      "severity": "blocking",
      "description": "Gross exposure must stay under 1,000,000 USD."
    },
    {
      "id": "min-confidence",
      "domain": "action",
      "subject": "decision.confidence",
      "predicate": { "kind": "limit.min", "bound": 0.6 },
      "severity": "advisory"
    },
    {
      "id": "allowed-side",
      "domain": "action",
      "subject": "order.side",
      "predicate": { "kind": "oneOf", "values": ["buy", "hold"] },
      "severity": "blocking"
    }
  ],
  "supersedes": { "id": "cs_risk_1", "version": 1 },
  "provenance": { "origin": "compiled", "sourceText": "never risk more than a million" },
  "createdAt": "2027-01-03T08:00:00Z"
}
```

An evaluation context at the moment of an action:

```json
{
  "observations": {},
  "state": { "portfolio.grossExposure": 1000000 },
  "actions": { "decision.confidence": 0.55, "order.side": "sell" },
  "outcomes": {}
}
```

The exact report produced by evaluating the set above against the context
above at `2027-02-01T12:00:00Z` (this example is regenerated and
deep-compared by the doc test, so it can never drift from the evaluator):

```json
{
  "constraintSet": { "id": "cs_risk_1", "version": 2 },
  "evaluatedAt": "2027-02-01T12:00:00Z",
  "checks": [
    {
      "constraintId": "max-gross-exposure",
      "domain": "state",
      "subject": "portfolio.grossExposure",
      "severity": "blocking",
      "status": "satisfied",
      "observed": 1000000
    },
    {
      "constraintId": "min-confidence",
      "domain": "action",
      "subject": "decision.confidence",
      "severity": "advisory",
      "status": "violated",
      "observed": 0.55
    },
    {
      "constraintId": "allowed-side",
      "domain": "action",
      "subject": "order.side",
      "severity": "blocking",
      "status": "violated",
      "observed": "sell"
    }
  ],
  "satisfied": 1,
  "violated": 2,
  "notApplicable": 0,
  "errors": 0,
  "blockingViolations": 1,
  "advisoryViolations": 1,
  "satisfiedRatio": 0.3333333333333333,
  "pass": false
}
```
