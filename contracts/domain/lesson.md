# Lesson

**Owning document:** T002 · **Package:** `@tradrl/domain-core` (`lesson.ts`)
**Spec source:** `spec/DOMAIN-MODEL.md` (FirmMemory/Learning), L12, R26, R48.

A Lesson is the **durable, provenance-bound** unit of institutional
learning: a statement learned from a specific provenance (outcome,
experiment, evidence capsule or post-mortem), tenant-scoped so Firm Brain
reuse never crosses tenants by default (L12), and validated before reuse.
Lessons accumulate across projects (R48) and may address a CapabilityGap by
opaque reference.

## Lesson

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | `LessonId` | yes | Opaque identity. |
| `tenantId` | `TenantId` | yes | Owning tenant. Cross-tenant reuse is prohibited by default (L12); sharing is an explicit, authorized operation. |
| `projectId` | `ProjectId` | yes | The project the lesson was learned in. Provenance-bound: no project-free lessons. |
| `learnedAt` | `Timestamp` | yes | Learning instant. |
| `statement` | `string` | yes | The lesson, stated in one sentence. |
| `detail` | `string` | no | Extended context, conditions and evidence summary. |
| `status` | `LessonStatus` | yes | `candidate` · `validated` · `retired` (closed). `validated` is required before a lesson may influence capability decisions (learning-loop discipline). |
| `provenance` | `LessonProvenance` | yes | At least one reference (below). |
| `capabilityGapId` | `CapabilityGapId` | no | Capability gap this lesson addresses. Opaque (learning lanes). |
| `tags` | `readonly string[]` | no | Free-form retrieval tags (non-empty strings). |

### LessonProvenance (at least ONE reference required)

| Field | Type | Semantics |
|---|---|---|
| `outcomeId` | `OutcomeId?` | The outcome the lesson was drawn from. |
| `experimentId` | `ExperimentId?` | The experiment (T011) that produced it. |
| `evidenceCapsuleId` | `EvidenceCapsuleId?` | The evidence capsule backing it. |
| `postMortemId` | `PostMortemId?` | The post-mortem (T033) it distills. |

## Invariants

1. `provenance` carries at least one reference — a lesson without provenance
   is unfalsifiable and is rejected by the guard.
2. `tenantId` and `projectId` are mandatory: lessons are learned somewhere,
   by someone, and isolated per tenant.
3. Status progression `candidate → validated → retired` is owned by the
   Firm Brain / outcome-learning lanes (T033/T034); the guard only validates
   the vocabulary.
4. Tags are non-empty strings; tag taxonomies are producer discipline.

## Versioning rules

- Lessons are immutable once recorded; retiring is a status transition
  performed by the owning lane (recorded through its own lifecycle), or a
  superseding lesson with new provenance.
- A lesson that is refined into a different statement is a **new lesson**
  with its own provenance — statements are never silently rewritten
  (institutional memory must be auditable).

## JSON example (machine-validated)

```json
{
  "id": "lesson_1",
  "tenantId": "tenant_1",
  "projectId": "prj_1",
  "learnedAt": "2027-02-01T12:00:00Z",
  "statement": "Momentum regime confidence degrades sharply when depth thins before session rollover.",
  "detail": "Observed on 3 projects: signals fired into thin books and slippage erased the edge; gate scale-ins on depth percentiles.",
  "status": "validated",
  "provenance": { "outcomeId": "out_1", "postMortemId": "pm_1" },
  "capabilityGapId": "gap_execution_2",
  "tags": ["execution", "regime", "liquidity"]
}
```
