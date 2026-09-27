# BodyVersion — the immutable, versioned capability composition

Owner: T003 · Spec: spec/ARCHITECTURE.md ("Agent Body"), spec/ARCHITECTURE-LOCK.md L2/L3/L8/L20/L9, spec/DOMAIN-MODEL.md ("AgentBody / BodyVersion"), spec/LEARNING-LOOP.md

An **AgentBody** is the stable identity behind a lineage of versions. A
**BodyVersion** is one immutable composition of trading capability — the
persistent "what the body is", independent of any substrate (L2). Body
Versions are produced by the learning loop (spec/LEARNING-LOOP.md:
"training → trajectory → evaluation → … → Body Version → compatibility →
shadow") and by the body forge (T017).

## AgentBody (stable identity)

| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | `BodyId` | identifier pattern | Stable identifier, e.g. `regime-researcher` |
| `name` | `string` | non-empty | Human-readable name |
| `description` | `string` | non-empty | What this body is for |
| `domain` | `string` | non-empty | Coarse category: `research`, `execution`, `risk`, `coordination`, … |
| `createdAt` | `ISO8601` | timezone-qualified | When the body identity was created |

## BodyVersion

| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | `BodyVersionId` | canonical `${bodyId}@${semver}`; derived | Version identity, e.g. `regime-researcher@1.2.0` |
| `bodyId` | `BodyId` | must match `id`'s body part | Which body this version belongs to |
| `version` | `SemVer` | strict semver.org | Semantic version of this version |
| `parentId` | `BodyVersionId \| null` | same body; resolves in the registry; strictly lower semver precedence | Direct predecessor, `null` for the root version |
| `composition` | `BodyComposition` | see below | The capability composition |
| `createdAt` | `ISO8601` | timezone-qualified | When this version was created |
| `certified` | `boolean` | `false` on working versions; `true` only via `certifyBodyVersion` | Certification flag |
| `certificationEvidence` | `CertificationEvidence \| null` | non-null iff `certified` | Certification evidence reference |

## BodyComposition

The substrate-independent capability composition. **A change to any field is
a persistent capability change and therefore requires a NEW BodyVersion (L3).**

| Field | Type | Description |
|---|---|---|
| `mission` | `Mission` | `summary` (non-empty), `goalRefs` (opaque Goal refs, T002), `standingDirectives` |
| `capabilities` | `readonly BodyCapability[]` | ≥ 1 capability; unique ids; each has `skillArtifactRefs` (opaque, T017) and a `critical` flag |
| `knowledgeToolPolicy` | `KnowledgeToolPolicy` | allowed/forbidden tools and knowledge sources (opaque refs), `toolCallBudgetPerDecision` |
| `procedures` | `readonly BodyProcedure[]` | named playbooks; unique ids; ≥ 1 step each; steps may require out-of-model approval |
| `planningPolicy` | `PlanningPolicy` | `style` (`reactive` \| `deliberative` \| `hybrid`), `maxPlanDepth` ≥ 1, `replanTriggers` |
| `delegationPolicy` | `DelegationPolicy` | `canDelegate`, `maxDelegationDepth` (0 when delegation is off), delegatee/escalation categories |
| `authorityBoundary` | `AuthorityBoundary` | see below — DECLARATIVE policy data |
| `evaluationEnvironment` | `EvaluationEnvironmentRequirements` | required evaluation layers, environment features (opaque), data categories (opaque), fidelity modes |
| `substrateCompatibility` | `SubstrateCompatibilityManifest` | see [compatibility.md](compatibility.md) |

### AuthorityBoundary (declarative; enforcement is external — L8/L20)

| Field | Type | Constraints | Description |
|---|---|---|---|
| `allowedActions` | `readonly AgentActionName[]` | kernel verb set | The superset grant of Agent OS actions |
| `prohibitedActions` | `readonly AgentActionName[]` | disjoint from `allowedActions` | Actions the body must never perform |
| `approvalRequiredActions` | `readonly AgentActionName[]` | subset of `allowedActions` | Actions that additionally require out-of-model approval |
| `executionAuthority` | `'none' \| 'external-gateway-only'` | `model-autonomous` **does not exist** | How the body relates to consequential execution |
| `riskPolicyRef` | `RiskPolicyRef \| null` | opaque | Risk policy the body declares (T020) |

`AgentActionName` mirrors the stable Agent OS kernel verbs (spec/
ARCHITECTURE.md): `SPAWN, TERMINATE, DELEGATE, REQUEST, PUBLISH, SUBSCRIBE,
CHALLENGE, PROPOSE, APPROVE, EXECUTE, ESCALATE, OBSERVE, LEARN, REPORT`.
Semantics are owned by T006.

**These boundaries are declarative policy data.** Enforcement — identity,
authorization, limits, venue permissions, rate limits, kill switch, audit —
lives in code/infrastructure outside model prompts (L20), implemented by the
Agent OS (T006), risk engine (T020) and execution gateway (T040) lanes.

## Certification

`CertificationEvidence` binds the certification decision to evidence:

| Field | Type | Constraints |
|---|---|---|
| `evidenceRefs` | `readonly EvidenceRef[]` | ≥ 1 (certification evidence) |
| `evaluationRefs` | `readonly EvidenceRef[]` | ≥ 1 (evaluation reports) |
| `certifiedBy` | `string` | non-empty (person, service or pipeline) |
| `certifiedAt` | `ISO8601` | timezone-qualified |
| `summary` | `string` | non-empty |

`certifyBodyVersion(version, evidence)` returns a **new**
`CertifiedBodyVersion` (never mutates the source) or a refusal with codes:

| Code | Meaning |
|---|---|
| `invalid-version` | version failed structural/semantic validation |
| `invalid-evidence` | evidence failed validation |
| `missing-evidence` | `evidenceRefs` empty |
| `missing-evaluation-evidence` | `evaluationRefs` empty |
| `no-tested-substrates` | compatibility manifest records no substitution test |
| `no-passing-substrate-test` | no tested substrate has result `pass` |
| `already-certified` | certification is terminal; produce a new version |

The last three preconditions encode the learning-loop order (compatibility
testing precedes certification) and follow from L3: because certified
versions never mutate, a tested-substrate list can only grow by producing a
**new** version — so a certified version must already carry a passing
substitution test. *(Design decision by T003; flagged for Tech Lead
ratification.)*

`adoptCertifiedBodyVersion(v)` is the trusted-ingestion constructor: it
validates parsed JSON, deep-freezes it and returns a `CertifiedBodyVersion`.

## Invariants

- **INV-B.1 (immutability, L3)** — every BodyVersion is deeply frozen at
  construction; mutation attempts throw `TypeError`. A persistent capability
  change produces a NEW version.
- **INV-B.2 (canonical identity)** — `id === ${bodyId}@${semver}`; enforced
  at construction and by the lineage index.
- **INV-B.3 (same-body lineage)** — `parentId` must belong to the same body;
  enforced at construction (`createBodyVersion`) and by `buildLineageIndex`.
- **INV-B.4 (monotonic lineage)** — a child's semver precedence must be
  strictly greater than its parent's; enforced by `buildLineageIndex`
  (`version-regression` violation).
- **INV-B.5 (certified freeze)** — a `CertifiedBodyVersion` is deeply
  readonly at type level, deeply frozen at runtime, and `isCertifiedBodyVersion`
  **fails** for any certified-shaped record that is not deeply frozen.
  Certification is terminal: re-certification is refused (`already-certified`).
- **INV-B.6 (execution authority, L8/L20)** — if `allowedActions` contains
  `EXECUTE`, `executionAuthority` must be `external-gateway-only`; the value
  `model-autonomous` is unrepresentable in the type system.
- **INV-B.7 (policy disjointness)** — allowed ∩ prohibited actions = ∅;
  approval-required ⊆ allowed; allowed ∩ forbidden tools/sources = ∅;
  `maxDelegationDepth = 0` when `canDelegate` is false.

## JSON example

`regime-researcher@1.0.0` (uncertified root; canonical example from
`src/examples.ts`, abridged — the full record is validated by tests):

```json
{
  "id": "regime-researcher@1.0.0",
  "bodyId": "regime-researcher",
  "version": { "major": 1, "minor": 0, "patch": 0, "prerelease": [], "build": [] },
  "parentId": null,
  "composition": {
    "mission": {
      "summary": "Continuously classify the current market regime and publish calibrated regime probabilities to subscribed decision-makers.",
      "goalRefs": ["goal/project-atlas/regime-awareness"],
      "standingDirectives": [
        "Prefer recall of regime transitions over precision of the dominant label.",
        "Never use post-availability information (point-in-time compliance is systemic)."
      ]
    },
    "capabilities": [
      {
        "id": "regime-classification",
        "name": "Regime Classification",
        "description": "Classify the market into trend/range/volatility-expansion/crisis regimes with probabilities.",
        "category": "research",
        "skillArtifactRefs": ["skills/regime/classifier-v3"],
        "critical": true
      }
    ],
    "authorityBoundary": {
      "allowedActions": ["OBSERVE", "SUBSCRIBE", "PUBLISH", "REQUEST", "PROPOSE", "LEARN", "REPORT", "ESCALATE"],
      "prohibitedActions": ["EXECUTE", "SPAWN", "TERMINATE", "APPROVE"],
      "approvalRequiredActions": ["ESCALATE"],
      "executionAuthority": "none",
      "riskPolicyRef": "risk/regime-researcher/default"
    },
    "substrateCompatibility": { "…": "see compatibility.md" }
  },
  "createdAt": "2026-03-01T08:00:00Z",
  "certified": false,
  "certificationEvidence": null
}
```

After certification, the same version carries `"certified": true` and the
embedded evidence:

```json
{
  "certified": true,
  "certificationEvidence": {
    "evidenceRefs": ["evidence/regime-researcher@1.0.0/certification"],
    "evaluationRefs": [
      "evaluation/regime-researcher@1.0.0/walk-forward-2026-03",
      "evaluation/regime-researcher@1.0.0/model-substitution-2026-03"
    ],
    "certifiedBy": "tradrl-verification-service",
    "certifiedAt": "2026-03-05T16:45:00Z",
    "summary": "Certified after functional, historical, blind-generalization and model-substitution evaluation layers passed with the required confidence targets."
  }
}
```
