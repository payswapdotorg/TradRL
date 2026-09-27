# AgentInstance — a possession operating at runtime

Owner: T003 · Spec: spec/DOMAIN-MODEL.md ("AgentInstance"), spec/ARCHITECTURE-LOCK.md L2/L12/L16/L20, spec/SECURITY.md (audit)

An **AgentInstance** is a possession operating for a project: authority
scope, parent/manager reference, runtime-state handle and lifecycle status.
Validity composes along the chain **instance → possession → body version**:
validate each link with its own validator.

## Fields

| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | `AgentInstanceId` | identifier pattern | Instance identity |
| `possessionId` | `PossessionId` | — | The possession this instance operates |
| `projectId` | `ProjectRef` | opaque, non-empty | Tenant-scoped project (T002/T007; L12) |
| `managerId` | `AgentInstanceId \| null` | ≠ `id` (no self-management) | Managing instance, `null` for a root agent |
| `authority` | `AuthorityScope` | see below | Runtime-granted authority (subset of the body's boundary) |
| `runtimeStateRef` | `RuntimeStateRef` | opaque handle | Runtime state — the state itself lives in the Agent OS lane (T006) |
| `status` | `AgentInstanceStatus` | state machine below | Lifecycle state |
| `spawnedAt` | `ISO8601` | timezone-qualified | When the instance was spawned |

Transition timestamps and audit trails live in the observability lane
(T043); per spec/SECURITY.md, audit records must include BodyVersion,
substrate, policy and outcome for consequential actions — this record
provides the references.

### AuthorityScope

| Field | Type | Constraints | Description |
|---|---|---|---|
| `allowedActions` | `readonly AgentActionName[]` | subset of the body's `allowedActions` | Actions this instance may perform |
| `deniedActions` | `readonly AgentActionName[]` | disjoint from `allowedActions` | Explicitly denied actions |
| `maxDelegationDepth` | `number` | integer ≥ 0; ≤ the body's delegation depth (0 if the body cannot delegate) | Delegation chain limit below this instance |

**Runtime authority can narrow, never widen, the body's declared boundary**
(L16). Authority enforcement is out-of-model (L20): the Agent OS (T006) and
execution gateway (T040) enforce these declarations in code.

## Instance validity

`validateAgentInstance(instance, possession, bodyVersion)` checks:

| Code | Condition |
|---|---|
| `possession-mismatch` | `instance.possessionId !== possession.id`, or the possession binds a different body version than the one given |
| `authority-exceeds-body` | instance `allowedActions` ⊄ body `authorityBoundary.allowedActions` |
| `authority-contradiction` | `allowedActions ∩ deniedActions ≠ ∅` |
| `self-management` | `managerId === id` |
| `delegation-depth-exceeds-body` | `maxDelegationDepth` exceeds the body's delegation policy |

## Lifecycle state machine

```text
  spawning ──► ready ──► running ◄──► paused
      │          │          │           │
      ▼          ▼          ▼           ▼
    failed    terminated  failed    terminated
      │                      │
      └────► terminated ◄────┘
```

| From | To |
|---|---|
| `spawning` | `ready`, `failed` |
| `ready` | `running`, `terminated`, `failed` |
| `running` | `paused`, `terminated`, `failed` |
| `paused` | `running`, `terminated`, `failed` |
| `failed` | `terminated` |
| `terminated` | — (terminal) |

Rules: `createAgentInstance` always produces state `spawning` (single entry
point); `transitionAgentInstance` is copy-on-write (returns a new deeply
frozen record), throws `IllegalTransitionError` on illegal edges and
`TypeError` on unknown states.

## Management chains

`detectManagementCycle(instances)` walks the `managerId` chain of every
instance and returns the first cycle found (e.g. `[a, b, c, a]`), or `null`.
Dangling manager references (manager not in the list) are not cycles.
Self-management is rejected at construction and also detected by the cycle
walker (defense in depth: hand-crafted records are caught too).

## Invariants

- **INV-I.1 (authority subset, L16)** — instance authority ⊆ body authority;
  the body's prohibitions therefore hold for every instance of the body.
- **INV-I.2 (opaque runtime state)** — this record carries only a handle;
  runtime state is owned by T006. Nothing in this package reads or writes it.
- **INV-I.3 (immutability)** — instance records are deeply frozen;
  transitions are copy-on-write.
- **INV-I.4 (single possession)** — an instance operates exactly one
  possession; one possession may back multiple instances over its life
  (respawn after failure) but an instance never changes possessions.
- **INV-I.5 (acyclic management)** — management chains must be acyclic;
  `detectManagementCycle` is the pre-spawn check for the Agent OS (T006).

## JSON example

```json
{
  "id": "agent-instance-atlas-0001",
  "possessionId": "possession-regime-atlas-0001",
  "projectId": "project/atlas",
  "managerId": null,
  "authority": {
    "allowedActions": ["OBSERVE", "SUBSCRIBE", "PUBLISH", "LEARN", "REPORT"],
    "deniedActions": ["EXECUTE", "SPAWN", "TERMINATE", "APPROVE", "DELEGATE"],
    "maxDelegationDepth": 0
  },
  "runtimeStateRef": "agent-state/agent-instance-atlas-0001",
  "status": "spawning",
  "spawnedAt": "2026-03-06T09:31:00Z"
}
```
