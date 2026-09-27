# Substrate compatibility & substitution testing

Owner: T003 · Spec: spec/ARCHITECTURE-LOCK.md L2, spec/LEARNING-LOOP.md ("Body Version → compatibility → shadow"), spec/EVALUATION-PROTOCOL.md (layer 7: model substitution), spec/REQUIREMENTS.md R28

A **model upgrade triggers compatibility testing, NOT body redevelopment**
(L2). This contract defines how a body declares its substrate requirements
and how a deterministic verdict decides whether a substrate may possess it.

## SubstrateCompatibilityManifest

Carried by every `BodyVersion` inside `composition.substrateCompatibility`.

### SubstrateRequirements

| Field | Type | Constraints | Description |
|---|---|---|---|
| `minContextWindowTokens` | `number` | integer ≥ 0 | Minimum acceptable total context window |
| `minMaxOutputTokens` | `number` | integer ≥ 0 | Minimum acceptable single-response output budget |
| `requiredInputModalities` | `readonly Modality[]` | — | Input modalities the body needs (subset of substrate's) |
| `requiredOutputModalities` | `readonly Modality[]` | — | Output modalities the body needs |
| `toolUse` | `'required' \| 'optional'` | — | Whether tool calling is required of the substrate |
| `structuredOutput` | `'required' \| 'optional'` | — | Whether schema-constrained output is required |

Matching is **capability-based and provider-neutral** (L13/L14): there is
deliberately no provider allow-list. Tool *prohibition* is a body's
knowledge/tool policy concern, not a substrate requirement — a substrate
that supports tools can still possess a body that never uses them.

### SubstrateConstraints

| Field | Type | Constraints | Description |
|---|---|---|---|
| `allowedSubstitutionClasses` | `readonly SubstitutionClass[] \| null` | `null` = any class | Substitution classes allowed to possess the body. **Empty array is meaningful**: no class approved yet |
| `maxInputCostPerMTokens` | `number \| null` | `null` = unconstrained | Ceiling on estimated input cost per 1M tokens |
| `maxOutputCostPerMTokens` | `number \| null` | `null` = unconstrained | Ceiling on estimated output cost per 1M tokens |
| `maxP95LatencyMs` | `number \| null` | `null` = unconstrained | Ceiling on estimated p95 time-to-first-token |

### TestedSubstrateRecord

Records are **frozen into the version** (L3): because certified versions
never mutate, adding or changing a test result requires a NEW BodyVersion.
Possession validity (see [possession.md](possession.md)) requires capability
satisfaction; the tested list is substitution-test evidence that informs
certification and operator trust.

| Field | Type | Constraints | Description |
|---|---|---|---|
| `substrate` | `SubstrateRef` | canonical | The substrate that was tested |
| `result` | `'pass' \| 'fail' \| 'conditional'` | — | Outcome (`conditional` = passed with caveats) |
| `testedAt` | `ISO8601` | timezone-qualified | When the test was recorded |
| `evidence` | `EvidenceRef` | opaque | Evidence capsule for the test run |
| `notes` | `string \| null` | non-empty when present | Caveats, e.g. for `conditional` results |

## CompatibilityVerdict

`evaluateSubstrateCompatibility(manifest, substrate)` is **pure and
deterministic**: checks run in the fixed order below and the verdict reports
every violated dimension with an explicit reason.

| Check code | Satisfied when |
|---|---|
| `context-window` | `substrate.capabilities.contextWindowTokens ≥ minContextWindowTokens` |
| `output-tokens` | `maxOutputTokens ≥ minMaxOutputTokens` |
| `input-modalities` | required input modalities ⊆ substrate's input modalities |
| `output-modalities` | required output modalities ⊆ substrate's output modalities |
| `tool-use` | requirement is `optional` OR substrate supports tool use |
| `structured-output` | requirement is `optional` OR substrate supports structured output |
| `substitution-class` | constraint is `null` OR substrate's class ∈ allowed classes |
| `input-cost` | ceiling is `null` OR input cost ≤ ceiling |
| `output-cost` | ceiling is `null` OR output cost ≤ ceiling |
| `p95-latency` | ceiling is `null` OR p95 latency ≤ ceiling |

```ts
interface CompatibilityVerdict {
  readonly satisfied: boolean;                       // true iff violations is empty
  readonly checks: readonly CompatibilityCheck[];    // all 10, in fixed order
  readonly violations: readonly CompatibilityViolation[]; // violated-with-reasons
}
```

Each `CompatibilityViolation` carries `code`, `expected`, `actual` and a
human-readable `message`.

**Possession law (binding):** a substrate that does not produce a satisfied
verdict cannot possess the body — `validatePossession` (possession.md)
returns `substrate-incompatible` with this verdict attached.

## API

| Export | Purpose |
|---|---|
| `evaluateSubstrateCompatibility(manifest, substrate)` | The deterministic verdict |
| `substrateSatisfiesManifest(manifest, substrate)` | Boolean convenience wrapper |
| `findTestedSubstrate(manifest, ref)` | Most recent (last) record for a substrate, or `null` |
| `hasPassingSubstitutionTest(manifest, substrate)` | ≥ 1 recorded `pass` for the substrate (strict: `conditional` does not count) |
| `isSubstrateCompatibilityManifest` and component guards | Hand-rolled guards |

## Certification interaction

`certifyBodyVersion` requires (a) ≥ 1 tested-substrate record and (b) ≥ 1
record with result `pass` — a certified body must be possessable, and because
records are frozen into the version, the evidence must exist before
certification. See [body-version.md](body-version.md).

## JSON example

Manifest of `regime-researcher@1.0.0`:

```json
{
  "requirements": {
    "minContextWindowTokens": 128000,
    "minMaxOutputTokens": 4096,
    "requiredInputModalities": ["text"],
    "requiredOutputModalities": ["text"],
    "toolUse": "required",
    "structuredOutput": "required"
  },
  "constraints": {
    "allowedSubstitutionClasses": ["frontier-reasoner"],
    "maxInputCostPerMTokens": 20,
    "maxOutputCostPerMTokens": 80,
    "maxP95LatencyMs": 5000
  },
  "testedSubstrates": [
    {
      "substrate": "acme-models/reasoner-2@2026.03",
      "result": "pass",
      "testedAt": "2026-03-02T14:30:00Z",
      "evidence": "evidence/regime-researcher@1.0.0/substitution/acme-reasoner-2",
      "notes": null
    },
    {
      "substrate": "delta-labs/swift-1@2026.02",
      "result": "conditional",
      "testedAt": "2026-03-04T10:15:00Z",
      "evidence": "evidence/regime-researcher@1.0.0/substitution/delta-swift-1",
      "notes": "Passed with degraded calibration in high-volatility regimes; see evaluation report."
    }
  ]
}
```

Resulting verdict for the incompatible substrate `local-lab/small-7b@2026.01`
(violated-with-reasons; `checks` abbreviated):

```json
{
  "satisfied": false,
  "checks": [
    { "code": "context-window", "satisfied": false, "expected": "context window >= 128000 tokens", "actual": "context window 8192 tokens" },
    { "code": "output-tokens", "satisfied": false, "expected": "max output >= 4096 tokens", "actual": "max output 1024 tokens" },
    { "code": "tool-use", "satisfied": false, "expected": "tool use required", "actual": "tool use unsupported" },
    { "code": "structured-output", "satisfied": false, "expected": "structured output required", "actual": "structured output unsupported" },
    { "code": "substitution-class", "satisfied": false, "expected": "substitution class ∈ {frontier-reasoner}", "actual": "substitution class edge-small" }
  ],
  "violations": [
    {
      "code": "context-window",
      "expected": "context window >= 128000 tokens",
      "actual": "context window 8192 tokens",
      "message": "context-window: body requires context window >= 128000 tokens, substrate provides context window 8192 tokens"
    }
  ]
}
```
