# Project

**Owning document:** T002 · **Package:** `@tradrl/domain-core` (`project.ts`)
**Spec source:** `spec/DOMAIN-MODEL.md` (Project), ADR-0002, L15, L12, R23.

The Project is the **durable unit of continuity** (ADR-0002): the one record
connecting goal, constraints, market/data universe, organization,
experiments, decisions, execution, outcomes and lessons. It is the lineage
root — downstream records (Decision, Outcome, Lesson, experiments) carry
`projectId` and link back; the Project carries the references that exist at
creation/compile time.

## Project

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | `ProjectId` | yes | Opaque identity. |
| `tenantId` | `TenantId` | yes | Owning tenant. Every persisted descendant inherits this scope (L12). |
| `name` | `string` | yes | Non-empty human name. |
| `description` | `string` | no | Human context. |
| `status` | `ProjectStatus` | yes | Lifecycle (below). |
| `createdAt` | `Timestamp` | yes | Creation instant. |
| `updatedAt` | `Timestamp` | no | Last materialization/status change; must be ≥ `createdAt` when present. |
| `goalId` | `GoalId` | yes | The goal this project pursues (immutable reference). |
| `constraintSet` | `ConstraintSetRef` | yes | The goal's constraint set **pinned to a specific version** for this project. |
| `marketScope` | `MarketScope` | yes | Materialized market universe (see goal.md for shape). |
| `dataScope` | `DataScope` | yes | Materialized data universe. |
| `organizationId` | `OrganizationId` | no | Present once the organization compiler has produced a team for this project. |
| `executionMode` | `ExecutionMode` | yes | Consequentiality of execution for this project. |
| `parentProjectId` | `ProjectId` | no | Lineage: the project this one was forked/derived from. |

### ProjectStatus (closed vocabulary)

`draft` (being specified) → `compiling` (organization being compiled) →
`active` (running) → `paused` → `completed` (horizon reached / criteria
evaluated) | `terminated` (stopped early, e.g. kill switch) → `archived`.
Status values are labels, not a state machine: transitions are enforced by
the control plane (T007), not by this contract.

### ExecutionMode (closed vocabulary)

`simulation` | `shadow` | `live` — the hard separation of simulated vs
consequential execution (R23). Mode is a project-level property from
creation; escalation to `live` is a control-plane decision with its own
authorization path (T040), never a data patch.

## Invariants

1. `tenantId`, `goalId`, `constraintSet.id` present and guard-valid.
2. `updatedAt ≥ createdAt` when present.
3. `marketScope` non-empty (explicit universe).
4. Lineage: `parentProjectId` references an existing Project when present;
   fork lineage forms a DAG (no cycles) — enforced by the store, not the guard.
5. **Documented obligations (not guard-checkable):** materialized
   `marketScope`/`dataScope` satisfy the goal's scopes; the referenced
   constraint set version exists; the referenced organization belongs to the
   same project and tenant.

## Versioning rules

- The Project record is the durable root; it is **not** re-created per
  change — status/materialization changes update `status`/`updatedAt`/
  `organizationId` through the control plane (T007), which owns the
  transition rules and audit trail.
- Derivative research (new hypothesis, re-compiled team, different risk
  posture) is a **new Project** with `parentProjectId` lineage — continuity
  comes from the lineage graph and the shared Firm Brain (T034), not from
  mutating a project into something else.

## JSON example (machine-validated)

```json
{
  "id": "prj_1",
  "tenantId": "tenant_1",
  "name": "Crypto Majors Alpha",
  "description": "Q1 crypto majors research and execution project.",
  "status": "active",
  "createdAt": "2027-01-02T08:00:00Z",
  "updatedAt": "2027-01-10T08:00:00Z",
  "goalId": "goal_1",
  "constraintSet": { "id": "cs_goal_1", "version": 3 },
  "marketScope": {
    "venues": ["venue_binance"],
    "instruments": ["instr_btc_usdt", "instr_eth_usdt"],
    "assetClasses": []
  },
  "dataScope": { "categories": ["market-data"] },
  "organizationId": "org_1",
  "executionMode": "simulation",
  "parentProjectId": "prj_0"
}
```
