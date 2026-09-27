# Organization

**Owning document:** T002 · **Package:** `@tradrl/domain-core` (`organization.ts`)
**Spec source:** `spec/DOMAIN-MODEL.md` (Team/TeamPolicy, structural part), AGENTS.md.

The Organization is the **structural** team record: who is on the team, how
it communicates, and at what cadence it decides. It is deliberately minimal
and structural-only: agent bodies, cognitive substrates, possessions and
agent instances are the agent-body lane (T003) and are referenced **only by
opaque ids**. The learnable/adaptive part of organizations — search over
topology, specializations, budgets — is the organization compiler (T016);
this record is the compiled snapshot it produces.

## Organization

| Field | Type | Required | Semantics |
|---|---|---|---|
| `id` | `OrganizationId` | yes | Opaque identity. |
| `tenantId` | `TenantId` | yes | Owning tenant (L12). |
| `projectId` | `ProjectId` | yes | The project this organization was compiled for. |
| `name` | `string` | no | Human label. |
| `status` | `OrganizationStatus` | yes | `forming` · `active` · `paused` · `dissolved` (closed). |
| `createdAt` | `Timestamp` | yes | Compile instant. |
| `memberships` | `readonly OrganizationMembership[]` | yes | Members. May be empty while `forming`. Each agent instance at most once. |
| `communicationTopologyId` | `TopologyId` | yes | Opaque reference to the topology record (T006/T016). The topology itself is learnable and versioned elsewhere. |
| `decisionCadence` | `DecisionCadence` | yes | Structural decision cadence (below). |

### OrganizationMembership

| Field | Type | Required | Semantics |
|---|---|---|---|
| `agentInstanceId` | `AgentInstanceId` | yes | Opaque reference (T003). |
| `role` | `string` | yes | Role label, e.g. `regime-researcher`, `trading-director`. Free-form; role taxonomies belong to the compiler/bodies. |
| `bodyVersionId` | `BodyVersionId` | no | Immutable body version the instance was running when recorded. Opaque (T003). Denormalized for watch-mode/audit; the authoritative binding lives in the agent lane. |
| `managerId` | `AgentInstanceId` | no | Manager within this organization, when hierarchical. |

### DecisionCadence

| Field | Type | Required | Semantics |
|---|---|---|---|
| `mode` | `'event-driven' \| 'scheduled' \| 'continuous'` | yes | Closed vocabulary. |
| `intervalSeconds` | `number` | no | Required (finite, > 0) when `mode = scheduled`. For other modes, when present, it is the minimum spacing between decisions (advisory). |

## Invariants

1. Each `agentInstanceId` appears at most once in `memberships`.
2. `scheduled` cadence requires a strictly positive finite `intervalSeconds`.
3. Cross-lane law: this record contains **no body/substrate structure** —
   only opaque references. A `managerId` must reference a member of the same
   organization (store-enforced).
4. **Documented obligation:** the organization's project and tenant match
   the project it was compiled for; membership ids resolve in the agent
   lane's registry.

## Versioning rules

- An Organization record is a compiled **snapshot**: evolution (membership
  change, cadence change, topology search result) produces a new
  Organization record; experiments (T011) reference organizations by opaque
  id, so search history remains reproducible (L9 lineage).
- Topology evolution is entirely referenced (`communicationTopologyId`):
  new topology versions do not mutate this record.

## JSON example (machine-validated)

```json
{
  "id": "org_1",
  "tenantId": "tenant_1",
  "projectId": "prj_1",
  "name": "Crypto Majors desk",
  "status": "active",
  "createdAt": "2027-01-03T10:00:00Z",
  "memberships": [
    {
      "agentInstanceId": "inst_director_1",
      "role": "trading-director",
      "bodyVersionId": "body_director_v4"
    },
    {
      "agentInstanceId": "inst_research_1",
      "role": "regime-researcher",
      "bodyVersionId": "body_research_v2",
      "managerId": "inst_director_1"
    }
  ],
  "communicationTopologyId": "topo_star_1",
  "decisionCadence": { "mode": "scheduled", "intervalSeconds": 900 }
}
```
