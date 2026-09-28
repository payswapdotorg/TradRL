# Suites and Splits

**Owning document:** T012 · **Package:** `@tradrl/evaluation` (`packages/evaluation`)
**Spec source:** spec/EVALUATION-PROTOCOL.md ("Generalization", "Selection integrity", "Stress"), spec/ARCHITECTURE.md "Evaluation", ARCHITECTURE-LOCK **L4, L9, L10, L11**.

Split policies are PURE functions over OPAQUE dataset refs: the same (axis,
policy) pair always produces the deeply-equal, deeply-frozen split. Suites
compose members over split policies into the protocol half of an evaluation
run; the compiled evaluator that scores trials under the suite is part of
the suite's identity (L9).

## DatasetSegment / DatasetAxis

| Field | Type | Required | Semantics |
|---|---|---|---|
| `ref` | `DataRef` | yes | Opaque dataset reference (unique on the axis; brand mirror of the T011 trajectory package). |
| `start` | `TimestampMs` | yes | Inclusive window start. |
| `end` | `TimestampMs` | yes | EXCLUSIVE window end (`end > start`). |
| `regime` | `string` | yes | Opaque non-empty regime label (e.g. "bull", "crisis"). |

An axis is a NON-EMPTY, ordered, non-overlapping segment list (each
segment's `start >= ` the previous segment's `end`; unique refs).

## Split policies (DATA; the functions in `splits.ts` are the interpreters)

| Policy | Fields | Semantics |
|---|---|---|
| `walk-forward` | `policyId`, `minTrainSegments >= 1`, `stepSegments >= 1` | Anchored EXPANDING windows: test indices `minTrainSegments, +stepSegments, ...` while a test segment exists; train set of window i is the axis PREFIX `[0, i)`. |
| `blind-holdout` | `policyId`, `holdoutCount >= 1` | The LAST `holdoutCount` segments are masked blind; the leading prefix stays visible. |
| `regime-partition` | `policyId`, `regime` | Selects every segment carrying the regime label. |

**Boundary laws (typed, fail-closed — never silent empty splits):**

1. `window_exhaustion` — walk-forward over an axis too short for one
   complete window (`minTrainSegments + 1 > segments`).
2. `degenerate_mask` — a blind holdout that would blind EVERYTHING
   (`holdoutCount >= segments`). (`holdoutCount < 1` is unrepresentable:
   the policy guard rejects it as `invalid_split_policy`.)
3. `empty_regime` — a regime that selects no segment (an empty regime
   cannot support a verdict).

## SuiteMember / EvaluationSuite

| Field | Type | Required | Semantics |
|---|---|---|---|
| `kind` | `SuiteMemberKind` | yes | `blind \| walk-forward \| regime \| cost \| latency \| adversarial \| organization-ablation \| model-substitution` — the evaluation layers of spec/EVALUATION-PROTOCOL.md. |
| `splitPolicy` | `SplitPolicyRef` | yes | The opaque split policy this member evaluates under. |
| `metricIds` | `readonly MetricId[]` | yes (**non-empty**) | Metrics this member reports (unique within the member). |

| Field | Type | Required | Semantics |
|---|---|---|---|
| `suiteId` | `SuiteId` | yes | Opaque suite identity. |
| `grade` | `'screening' \| 'release'` | yes | Declared grade: cheap in-search gate vs the acceptance machinery. |
| `evaluatorVersion` | `EvaluatorVersionRef` | yes | The compiled evaluator that scores trials under this suite (L9 — same suite under two evaluator versions is two protocols). |
| `members` | `readonly SuiteMember[]` | yes (**non-empty**) | Unique by (kind, splitPolicy). |
| `adversarialSuiteRefs` | `readonly SuiteId[]` | yes | Opaque ids of adversarial suites — **REQUIRED non-empty when grade is `release`** (L10). |

## Composition rules (machine-checked by `createEvaluationSuite`)

1. Non-empty member list; duplicate (kind, splitPolicy) pairs fail
   (`duplicate_member` path errors).
2. **L10**: a `release`-grade suite without an adversarial suite reference
   fails with the typed error `missing_adversarial_member`. The
   verification lane's ReleaseGate re-checks the same law (defense in
   depth).
3. Adversarial refs are unique.
4. Construction is deterministic and deeply frozen.

## JSON examples (machine-validated)

A release-grade suite covering the pinned protocol:

```json
{
  "suiteId": "suite.friction-2024q4",
  "grade": "release",
  "evaluatorVersion": "evaluator.friction-suite@3",
  "members": [
    { "kind": "blind", "splitPolicy": "split.blind-2024q4", "metricIds": ["metric.gate-ratio"] },
    { "kind": "walk-forward", "splitPolicy": "split.wf-anchored", "metricIds": ["metric.gate-ratio", "metric.blocking"] },
    { "kind": "regime", "splitPolicy": "split.regime-crisis", "metricIds": ["metric.gate-ratio"] }
  ],
  "adversarialSuiteRefs": ["suite.adversarial-pop-1"]
}
```

A blind-holdout split policy over a four-segment axis:

```json
{
  "kind": "blind-holdout",
  "policyId": "split.blind-2024q4",
  "holdoutCount": 1
}
```
