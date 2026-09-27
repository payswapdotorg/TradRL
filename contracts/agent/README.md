# Agent Contracts — `@tradrl/agent-body`

Owner: **T003** · Package: `packages/agent-body` · Docs: `contracts/agent/`

These documents are the human-readable authority for the Agent Body lane. They
are binding for the **Agent OS** (T006) and the **body forge** (T017); where a
document and an implementation disagree, file a defect against both.

## The core law (spec/ARCHITECTURE-LOCK.md L2)

```
Agent Instance = Agent Body Version
               + Cognitive Substrate
               + Possession Configuration
               + Environment
               + Runtime State
```

- A **model is a cognitive substrate**. A model never owns a body; a substrate
  *possesses* a body (spec/ADAPTERS.md).
- An **Agent Body** is the persistent, versioned trading capability
  composition. Bodies and models are separate: a model upgrade triggers
  **compatibility testing**, NOT body redevelopment (L2).
- A persistent capability change creates a **NEW BodyVersion**; certified
  versions never mutate (L3).

## How the law maps onto these contracts

| Core-law component | Contract | Field |
|---|---|---|
| Agent Body Version | [`BodyVersion`](body-version.md) | `Possession.bodyVersionId` → the bound version |
| Cognitive Substrate | [`CognitiveSubstrate`](cognitive-substrate.md) | `Possession.substrateId` → the possessing substrate |
| Possession Configuration | [`Possession`](possession.md) | adapter + runtime profile + policy bundle |
| Environment | [`Possession`](possession.md) | `environmentProfile` (opaque ref + fidelity mode) |
| Runtime State | [`AgentInstance`](agent-instance.md) | `runtimeStateRef` — opaque handle; the state itself lives in the Agent OS lane (T006) |

## Document map

| Document | Concept |
|---|---|
| [cognitive-substrate.md](cognitive-substrate.md) | `CognitiveSubstrate` — model identity, capability manifest, cost/latency profile, substitution class |
| [body-version.md](body-version.md) | `AgentBody`, `BodyVersion`, `CertifiedBodyVersion`, capability composition, certification |
| [compatibility.md](compatibility.md) | `SubstrateCompatibilityManifest`, `CompatibilityVerdict`, tested-substrate records, substitution testing |
| [possession.md](possession.md) | `Possession`, the possession law, the possession state machine |
| [agent-instance.md](agent-instance.md) | `AgentInstance`, authority scopes, management chains, lifecycle |

## Cross-lane boundary rules (frozen)

Entities owned by other Work Orders are referenced **only** through opaque
branded string ids (`packages/agent-body/src/primitives.ts`). Nothing from
those packages may be imported here — they do not exist yet and must not be
added as dependencies.

| Opaque reference | Owning lane |
|---|---|
| `ProjectRef`, `GoalRef` | T002 (trading domain) |
| `SkillArtifactRef` | T017 (skill extraction / body forge) |
| `ToolRef` | tooling/environment lane (T005/T006) |
| `KnowledgeSourceRef` | knowledge/data lanes (T008/T026/T034) |
| `EvidenceRef` | evidence subsystem (evidence capsules; T002 contract / T012 evaluation) |
| `EnvironmentProfileRef` | T005 (environment protocol) |
| `PolicyBundleRef` | control-plane policy lanes (T007/T020) |
| `RiskPolicyRef` | T020 (risk policy engine) |
| `RuntimeStateRef` | T006 (Agent OS runtime state) |

## Global invariants (apply to every record in this package)

- **INV-0.1 (JSON data)** — every serialized record is JSON-serializable. No
  dates, maps, sets or class instances in serialized shapes.
- **INV-0.2 (immutability)** — all records are deeply `readonly` at type level
  and deeply frozen at runtime when produced by the package factories.
  Mutation attempts throw `TypeError`.
- **INV-0.3 (validity by construction)** — factories (`createSubstrate`,
  `createBodyVersion`, `createPossession`, `createAgentInstance`) validate
  structure and semantics and throw `TypeError` on invalid input. Hand-rolled
  guards (`isXxx`) validate unknown values (e.g. parsed JSON).
- **INV-0.4 (zero dependencies)** — the package has zero runtime dependencies
  and no build step; it exports types, guards and pure functions only.
- **INV-0.5 (provider neutrality)** — no contract field encodes a vendor
  name except the substrate's own `provider`/`modelId`/`modelVersion`
  identity triple, which is produced by adapters (L13/L14).

## Canonical examples

Every JSON example in these documents is a rendering of the canonical records
exported from `packages/agent-body/src/examples.ts`, which the test suite
validates through the guards and factories (`examples.test.ts`). Provider
names in examples are fictional.
