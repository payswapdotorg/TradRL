# Possession — binding a BodyVersion to a CognitiveSubstrate

Owner: T003 · Spec: spec/DOMAIN-MODEL.md ("Possession"), spec/ARCHITECTURE-LOCK.md L2/L13/L14, spec/ADAPTERS.md ("A model provider never owns an Agent Body")

A **Possession** is the binding: BodyVersion + CognitiveSubstrate + adapter
+ runtime profile + environment profile + policy bundle. The substrate
possesses the body — never the reverse.

## Fields

| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | `PossessionId` | identifier pattern | Possession identity |
| `bodyVersionId` | `BodyVersionId` | canonical | The bound BodyVersion (`${bodyId}@${semver}`) |
| `substrateId` | `SubstrateRef` | canonical | The possessing substrate (`provider/modelId@modelVersion`) |
| `adapter` | `AdapterBinding` | `adapterId` + `configRef`, both non-empty | The adapter mediating the substrate (T036; L13 vendor specifics stay in adapters) |
| `runtimeProfile` | `RuntimeProfile` | see below | Invocation parameters |
| `environmentProfile` | `EnvironmentProfile` | see below | The environment the possessed agent operates in |
| `policyBundleRef` | `PolicyBundleRef` | opaque, non-empty | Policy bundle (control-plane lanes T007/T020) |
| `status` | `PossessionStatus` | state machine below | Lifecycle state |
| `createdAt` | `ISO8601` | timezone-qualified | When the possession was created |

### RuntimeProfile

| Field | Type | Constraints |
|---|---|---|
| `timeoutMs` | `number` | integer ≥ 1 |
| `maxRetries` | `number` | integer ≥ 0 |
| `maxConcurrentInvocations` | `number` | integer ≥ 1 |
| `costBudgetRef` | `string \| null` | opaque budget reference |

### EnvironmentProfile

| Field | Type | Constraints |
|---|---|---|
| `environmentRef` | `EnvironmentProfileRef` | opaque (T005 lane) |
| `fidelityMode` | `'exact-replay' \| 'reactive-replay' \| 'counterfactual-generative'` | L5: the three Market World modes are distinct |

`fidelityMode` mirrors spec/ARCHITECTURE-LOCK.md L5. The canonical enum is
owned by the market lanes (T004/T009); if those lanes rename the values, this
mirror must be reconciled (flagged for Tech Lead).

## The possession law

**A possession is valid only when the substrate satisfies the bound
BodyVersion's substrate compatibility manifest.**

`validatePossession(possession, bodyVersion, substrate)` checks:

| Code | Condition |
|---|---|
| `body-version-mismatch` | `possession.bodyVersionId !== bodyVersion.id` |
| `substrate-mismatch` | `possession.substrateId !== substrate.id` |
| `substrate-incompatible` | the compatibility verdict is not satisfied (full verdict attached — see [compatibility.md](compatibility.md)) |

Requiring a **certified** BodyVersion for possession is a runtime policy
decision owned by the Agent OS lane (T006) — e.g. shadow/live gates may
demand certification while training possessions may not. This contract
enforces the structural law above.

## Possession state machine

```text
            (compatibility verdict satisfied)
  draft ─────────────────► validated ─────────────► active ◄─────────┐
    │                          │                        │            │
    │ retire                   │ retire            suspend│       resume
    ▼                          ▼                        ▼            │
  retired ◄──────────────── retired ◄───────────── suspended ────────┘
```

| From | To |
|---|---|
| `draft` | `validated`, `retired` |
| `validated` | `active`, `retired` |
| `active` | `suspended`, `retired` |
| `suspended` | `active`, `retired` |
| `retired` | — (terminal) |

Rules:

- **Single entry point** — `createPossession` always produces state `draft`.
- **`draft → validated`** is legal only after `validatePossession` returned a
  satisfied verdict; the contract declares the edge, the Agent OS (T006)
  sequences it and retains the evidence.
- **Copy-on-write** — `transitionPossession` returns a NEW deeply frozen
  record; the source record is never mutated. Identity (`id`) and `createdAt`
  are preserved across transitions. Throwing behavior: `IllegalTransitionError`
  for illegal edges, `TypeError` for unknown states.

## Invariants

- **INV-P.1 (binding law)** — see the possession law above; an incompatible
  substrate cannot possess the body.
- **INV-P.2 (immutability)** — possession records are deeply frozen;
  transitions are copy-on-write.
- **INV-P.3 (no model ownership)** — a possession references exactly one
  body version and one substrate; adapters carry vendor specifics, never the
  body itself (L13/L14).
- **INV-P.4 (secrets outside contract data)** — adapter configuration is an
  opaque `configRef`; credentials never live in possession records
  (spec/SECURITY.md).

## JSON example

```json
{
  "id": "possession-regime-atlas-0001",
  "bodyVersionId": "regime-researcher@1.0.0",
  "substrateId": "acme-models/reasoner-2@2026.03",
  "adapter": {
    "adapterId": "adapter/substrate/acme-models",
    "configRef": "config/adapter/acme-reasoner-2/atlas"
  },
  "runtimeProfile": {
    "timeoutMs": 60000,
    "maxRetries": 2,
    "maxConcurrentInvocations": 4,
    "costBudgetRef": "budget/project-atlas/research-substrates"
  },
  "environmentProfile": {
    "environmentRef": "environment/project-atlas/research-sim-v2",
    "fidelityMode": "exact-replay"
  },
  "policyBundleRef": "policy/project-atlas/researcher-default",
  "status": "draft",
  "createdAt": "2026-03-06T09:30:00Z"
}
```
