# CognitiveSubstrate

Owner: T003 · Spec: spec/DOMAIN-MODEL.md ("CognitiveSubstrate"), spec/ARCHITECTURE-LOCK.md L2/L13/L14/L20, spec/ADAPTERS.md ("Models")

A **CognitiveSubstrate** is the model-side runtime that can *possess* Agent
Bodies (see [possession.md](possession.md)). It is pure descriptive data:
identity, capability manifest, cost/latency profile and substitution class.
Vendor specifics are produced by **provider adapters** (T036 lane) and never
leak into bodies. A model provider never owns an Agent Body.

## Fields

| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | `SubstrateRef` | canonical `provider/modelId@modelVersion`; derived at construction | Substrate identity |
| `provider` | `string` | non-empty; no whitespace, `/`, `@` | Provider identity as exposed by the adapter layer |
| `modelId` | `string` | non-empty; no whitespace, `/`, `@` | Provider's model identifier |
| `modelVersion` | `string` | non-empty; no whitespace, `/`, `@` | Provider's model version/revision |
| `capabilities` | `SubstrateCapabilityManifest` | see below | What the substrate can do |
| `costLatency` | `SubstrateCostLatencyProfile` | see below | What the substrate costs and how fast it answers |
| `substitutionClass` | `SubstitutionClass` | non-empty identifier | Substrates that are candidates to possess the same bodies |

### SubstrateCapabilityManifest

| Field | Type | Constraints | Description |
|---|---|---|---|
| `contextWindowTokens` | `number` | integer ≥ 1 | Maximum total context (input + output) in tokens |
| `maxOutputTokens` | `number` | integer ≥ 1 | Maximum single-response output in tokens |
| `inputModalities` | `readonly Modality[]` | non-empty, no duplicates | `text` \| `image` \| `audio` \| `video` |
| `outputModalities` | `readonly Modality[]` | non-empty, no duplicates | Modalities the substrate can emit |
| `toolUse` | `boolean` | — | Supports tool/function calling |
| `structuredOutput` | `boolean` | — | Supports schema-constrained output |

### SubstrateCostLatencyProfile

| Field | Type | Constraints | Description |
|---|---|---|---|
| `currency` | `string` | non-empty | Cost currency symbol (e.g. `USD`) |
| `inputCostPerMTokens` | `number` | integer ≥ 0 | Estimated input cost per 1,000,000 tokens |
| `outputCostPerMTokens` | `number` | integer ≥ 0 | Estimated output cost per 1,000,000 tokens |
| `p50LatencyMs` | `number` | integer ≥ 0 | Median time-to-first-token estimate (ms) |
| `p95LatencyMs` | `number` | integer ≥ 0, ≥ `p50LatencyMs` | 95th percentile time-to-first-token estimate (ms) |

All cost/latency numbers are **declarative estimates** reported by the
adapter for planning and budgeting (they feed the compatibility cost/latency
ceilings in [compatibility.md](compatibility.md)) — they are not guarantees.

## Substitution classes

`substitutionClass` is a TradRL-internal class, **not a vendor name**: two
substrates in the same class are candidates to possess the same bodies. A
body's compatibility manifest may constrain possession to specific classes
(see [compatibility.md](compatibility.md)). Class taxonomy is operational
data owned by the control plane; this contract only requires the identifier
to be well-formed.

## Invariants

- **INV-S.1 (derived identity)** — `id` is always the canonical
  `provider/modelId@modelVersion` triple; `createSubstrate` derives it, so
  identity and components can never disagree.
- **INV-S.2 (immutability)** — constructed substrates are deeply frozen;
  mutation attempts throw `TypeError`.
- **INV-S.3 (adapters produce substrates)** — substrates enter the system
  only through provider adapters (L13/L14). This package never queries a
  vendor.
- **INV-S.4 (no body knowledge)** — a substrate record contains no reference
  to any body, possession or instance. Direction of reference is
  possession → substrate, never the reverse.

## API

| Export | Purpose |
|---|---|
| `createSubstrate(draft)` | Validates and freezes; derives `id` |
| `isCognitiveSubstrate(v)` | Hand-rolled guard (also for parsed JSON) |
| `makeSubstrateRef(provider, modelId, modelVersion)` / `parseSubstrateRefString(ref)` | Canonical id construction/parsing |
| `isModality`, `isSubstrateCapabilityManifest`, `isSubstrateCostLatencyProfile` | Component guards |

## JSON example

```json
{
  "id": "acme-models/reasoner-2@2026.03",
  "provider": "acme-models",
  "modelId": "reasoner-2",
  "modelVersion": "2026.03",
  "capabilities": {
    "contextWindowTokens": 256000,
    "maxOutputTokens": 32768,
    "inputModalities": ["text"],
    "outputModalities": ["text"],
    "toolUse": true,
    "structuredOutput": true
  },
  "costLatency": {
    "currency": "USD",
    "inputCostPerMTokens": 12,
    "outputCostPerMTokens": 48,
    "p50LatencyMs": 800,
    "p95LatencyMs": 2400
  },
  "substitutionClass": "frontier-reasoner"
}
```

A substitution candidate in the same class (`delta-labs/swift-1@2026.02`,
cheaper, larger context) and an incompatible substrate (`local-lab/small-7b@2026.01`,
8192-token window, no tool use, no structured output, class `edge-small`) are
exported alongside this example in `src/examples.ts`.
