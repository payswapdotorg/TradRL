# TradRL Project State

| Field | Value |
|---|---|
| Repository | payswapdotorg/TradRL |
| Architecture | locked |
| Program phase | foundation |
| Current authorized Work Order | T001 |
| Active workers | 0 |
| In-flight | none |
| Blocked | none |
| Maximum concurrent workers | 3 |
| Arena required for core | no |
| Default branch | main |

## Current implementation truth
The repository is intentionally governance-first. No production capability is assumed complete.

## State transition
A Work Order becomes complete only after implementation, verification, evidence, ownership compliance, Tech Lead acceptance and merge. Record exact merged SHA.

## Explicit invariants
1. Native learning works without Arena.
2. Agent Body != model.
3. Point-in-time information boundaries are enforced.
4. Exact replay != reactive replay != generative simulation.
5. User constraints are executable acceptance criteria.
6. Execution authority is outside the model.
7. Search history is preserved against overfitting.
8. Tenant data is isolated.
9. Provider semantics remain in adapters.
10. Firm learning persists across projects but remains tenant-scoped.