# Decision

**Owning document:** T002 · **Package:** `@tradrl/domain-core` (`decision.ts`)
**Spec source:** `spec/DOMAIN-MODEL.md` (Decision, EvidenceCapsule reference), L15, R38, R45.

A Decision is the **point-in-time, immutable record** of a choice made by an
agent instance: what was decided, on what evidence, what alternatives were
considered, and with what calibrated confidence. Outcomes link realized
results back to decisions (L15 lineage). The evidence capsule itself is
owned by the evidence lane and is referenced by opaque id.

## Decision

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | `DecisionId` | yes | Opaque identity. |
| `projectId` | `ProjectId` | yes | Lineage root (L15). |
| `agentInstanceId` | `AgentInstanceId` | yes | Who decided. Opaque (T003). |
| `madeAt` | `Timestamp` | yes | Decision instant (point-in-time). |
| `summary` | `string` | yes | What was decided. Human-readable; interpretation, never execution. |
| `evidenceCapsuleId` | `EvidenceCapsuleId` | yes | The evidence capsule backing the decision. Opaque (evidence lane). |
| `alternatives` | `readonly DecisionAlternative[]` | yes | Alternatives considered. May be empty for forced actions. |
| `confidence` | `number` | yes | Calibrated confidence in the decision. Closed interval `[0,1]`, finite. |

### DecisionAlternative

| Field | Type | Required | Semantics |
|---|---|---|---|
| `summary` | `string` | yes | What the alternative was. |
| `rationale` | `string` | no | Why it was not chosen. |

## Invariants

1. `confidence ∈ [0,1]` (finite; `NaN`/`Infinity` invalid).
2. `evidenceCapsuleId` is required — decisions without evidence are not
   decisions in this domain.
3. Alternatives, when present, have non-empty summaries; the empty list is
   reserved for forced actions (no discretionary choice existed).
4. The record is immutable: revisions of a decision are new decisions; a
   superseding decision references its predecessor through the
   decision-store's lineage (owned by the control plane), not by mutation.

## Versioning rules

- Point-in-time records: once written, a Decision never changes. Audit
  trails (who/what/visible-state) live in the evidence capsule and
  observability lane (T043), both referenced, not embedded.
- Confidence semantics (calibration method) are the producing agent's
  responsibility; consumers treat the number as a stated calibration (R45),
  and evaluation (T012) is the place where calibration quality is measured.

## JSON example (machine-validated)

```json
{
  "id": "dec_1",
  "projectId": "prj_1",
  "agentInstanceId": "inst_director_1",
  "madeAt": "2027-01-15T09:29:59.900Z",
  "summary": "Scale into BTC long via limit orders on a momentum regime confirmation.",
  "evidenceCapsuleId": "ev_1",
  "alternatives": [
    {
      "summary": "Wait for pullback confirmation before scaling in.",
      "rationale": "Expected regime confirmation is already above threshold."
    },
    { "summary": "Enter immediately with market orders." }
  ],
  "confidence": 0.72
}
```
