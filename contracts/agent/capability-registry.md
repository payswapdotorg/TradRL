# Substrate Capability Registry — measured evidence for Body/Substrate assignments

Owner: **T016** (absorbed per program decisions D-006/D-007 — the T003 registry gap) · Package: `packages/agent-body/src/capability-registry.ts` · Spec: spec/CAPABILITY-DISCOVERY.md, spec/ARCHITECTURE-LOCK.md L16a/L9/L2/L3

The registry is the **evidence base organization search runs over**
(`@tradrl/organization`, T016): it records what a BodyVersion or a Cognitive
Substrate **DEMONSTRABLY offers**, as **measured evidence** — never as a
profession/role label. This document is the human-readable authority for the
registry module; the test suite machine-validates every JSON example below
against the module's guards (a documented example that fails its guard fails
`pnpm verify`).

## The measured-evidence law (L16a)

> L16a — "Autonomous capability discovery: organization search may discover
> missing capabilities and candidate Body/Substrate assignments from
> **evidence**; **labels alone never establish suitability**."

And from spec/CAPABILITY-DISCOVERY.md:

> **Never equate model and profession.**
> `model -> measured mathematical reasoning capability -> candidate possession` is valid.
> `model -> mathematician` is not an evidence-backed architectural rule.

Concretely, in this contract:

| Claim | Legal? | Why |
|---|---|---|
| `{ capability: "mathematical-reasoning", evidence: [ { kind: "benchmark", benchmarkId: ..., resultRef: ... } ] }` | ✅ | measured evidence |
| `{ capability: "mathematical-reasoning", evidence: [ { kind: "measurement-record", recordRef: ..., metric: "benchmark-score", value: 0.87 } ] }` | ✅ | measured evidence |
| `{ capability: "mathematical-reasoning", evidence: [ { kind: "result-ref", resultRef: ... } ] }` | ✅ | measured evidence (opaque capsule) |
| `{ kind: "label", label: "mathematician" }` as evidence | ❌ `label-as-evidence` | a label is not a measurement |
| any record/descriptor field named `label`, `role`, `profession`, `title`, `roleLabel`, `jobTitle`, `vocation` | ❌ `label-as-evidence` | label smuggled as a field |
| a descriptor with an **empty** `evidence` list | ❌ `no-measured-evidence` | a bare claim is a label in disguise |

The closed label-key vocabulary is `LABEL_EVIDENCE_KEYS`; the guard
`isCapabilityRecord` and the validator `validateCapabilityRecord` both scan
the whole JSON tree of a record for those keys, so a label smuggled anywhere
fails the law on every code path — not only the validator path.

## Safety

> "Discovery does not grant consequential execution authority. Risk,
> authorization and execution policy remain independent gates."
> — spec/CAPABILITY-DISCOVERY.md

A `CapabilityRecord` carries **no execution authority of any kind** and no
field that could encode one (the organization compiler's blueprints hold the
same law — see `@tradrl/organization`). Compatibility constraints are
referenced **opaquely** (`compatibilityRefs`); their semantics are owned by
[compatibility.md](compatibility.md).

## Fields

### CapabilityRecord

| Field | Type | Constraints | Description |
|---|---|---|---|
| `recordId` | `CapabilityRecordId` | identifier pattern, unique within a snapshot | Record identity |
| `subject` | `RegistrySubject` | closed union below | What the record is about |
| `descriptors` | `readonly CapabilityDescriptor[]` | non-empty; capability keys unique | The measured capability claims |
| `compatibilityRefs` | `readonly string[]` | opaque refs, may be empty | Compatibility-constraint references |

### RegistrySubject (closed union)

| Kind | Field | Canonical shape |
|---|---|---|
| `body-version` | `bodyVersionRef` | `${bodyId}@${semver}` (e.g. `math-researcher@1.0.0`) |
| `cognitive-substrate` | `substrateRef` | `provider/modelId@modelVersion` (e.g. `limite-labs/limite-math@2026.01`) |

Subject kinds mirror the L2 body/model separation: a record is about a
**BodyVersion**, about a **CognitiveSubstrate**, or about nothing — never a
fused "role/model pairing" (spec/CAPABILITY-DISCOVERY.md: "No human must
predefine every role/model pairing").

### CapabilityDescriptor

| Field | Type | Constraints | Description |
|---|---|---|---|
| `capability` | `CapabilityKey` | identifier pattern (open vocabulary) | The capability contract this descriptor speaks about |
| `evidence` | `readonly MeasuredEvidence[]` | **non-empty** | The measured evidence backing the claim |

`CapabilityKey` is deliberately an **open** vocabulary (identifier-pattern
strings such as `mathematical-reasoning`, `regime-analysis`): capability
contracts are characterized dynamically in discovery step 2
("Characterize the required capability contract"); freezing the vocabulary
would freeze the discovery space.

### MeasuredEvidence (closed union)

| Kind | Fields | Constraints |
|---|---|---|
| `benchmark` | `benchmarkId`, `resultRef` | opaque refs (non-empty, no control chars) |
| `measurement-record` | `recordRef`, `metric`, `value` | `metric` from the closed list below; `value` finite |
| `result-ref` | `resultRef` | opaque ref |

The structured metric vocabulary (`MEASUREMENT_METRICS`):

| Metric | Meaning |
|---|---|
| `benchmark-score` | normalized benchmark outcome |
| `p50-latency-ms` | median observed latency, milliseconds |
| `p95-latency-ms` | 95th-percentile observed latency, milliseconds |
| `compute-units` | measured compute cost per unit of work |

Cost and latency measurements are what make the registry the evidence base
the organization compiler scores against (spec/CAPABILITY-DISCOVERY.md,
Reproducibility: "Record candidate roles, bodies, models, benchmarks,
datasets, configuration, **cost, latency**, environment, outcomes and
rejected candidates").

## Registry snapshots (immutable set + canonical digest — L9)

| Field | Type | Constraints | Description |
|---|---|---|---|
| `records` | `readonly CapabilityRecord[]` | every record valid; ids unique | Canonically **sorted** by each record's canonical JSON |
| `digest` | `RegistryDigest` | 16 lowercase hex | Digest over the canonical JSON of the sorted record set |

`createRegistrySnapshot(records)` validates every record against the full
law (label trip-wire included), rejects duplicate ids, stores the records in
canonical order and derives the digest — **set semantics**: equal record
sets produce byte-identical snapshots regardless of input order. The digest
is the L9 lineage anchor: every organization candidate's lineage block cites
`registrySnapshotDigest`, binding the candidate to the exact evidence base
it was compiled against. `validateRegistrySnapshot` recomputes the digest
and fails (`digest-mismatch`) when a declared digest does not bind its
records — a snapshot digest that does not match its records is a lineage
forgery.

Canonical serialization follows the program-wide law (recursively sorted
object keys, arrays in order — the same canonical JSON and stable digest
declared by `@tradrl/trajectory` and mirrored byte-identically by
`@tradrl/evaluation`/`@tradrl/verification`).

## Query-by-capability-contract

| Field | Type | Constraints |
|---|---|---|
| `requires` | `readonly CapabilityKey[]` | non-empty; keys unique |

`queryByCapability(snapshot, query)` is **pure filtering**: it returns the
records that demonstrate **every** required capability key, in the
snapshot's canonical order. A record demonstrates a key when one of its
descriptors claims that capability with non-empty measured evidence
(guaranteed by record validity).

## Invariants

- **INV-R.1 (measured evidence only — L16a)** — every capability claim
  carries non-empty `MeasuredEvidence`; label fields and label evidence are
  typed violations (`label-as-evidence`), detected by guard and validator.
- **INV-R.2 (no authority)** — records carry no execution authority and no
  field that could encode one; risk/authorization/execution policy remain
  independent gates (spec/CAPABILITY-DISCOVERY.md Safety).
- **INV-R.3 (immutability)** — records and snapshots produced by the
  factories are deeply frozen.
- **INV-R.4 (JSON data)** — every serialized record is JSON-serializable;
  no dates, maps, sets or class instances.
- **INV-R.5 (zero dependencies / self-containment)** — the registry module
  imports nothing (not even sibling modules of this package); it
  re-declares the guard/digest vocabulary it needs. The additivity
  trip-wire is a source scan in `capability-registry.test.ts`.
- **INV-R.6 (determinism)** — no ambient clock (`Date.now()` never
  appears); digests are pure functions of the record set.
- **INV-R.7 (closed unions, total guards)** — evidence kinds, metrics,
  subject kinds, label keys and violation codes are closed vocabularies
  with hand-rolled total guards.

## JSON examples

Example 1 — a BodyVersion capability record (benchmark + measurement
evidence):

```json
{
  "recordId": "capreg-body-mathresearcher-0001",
  "subject": { "kind": "body-version", "bodyVersionRef": "math-researcher@1.0.0" },
  "descriptors": [
    {
      "capability": "mathematical-reasoning",
      "evidence": [
        { "kind": "benchmark", "benchmarkId": "bench/olympiad-mix-v3", "resultRef": "result/bench/olympiad-mix-v3/math-researcher@1.0.0" },
        { "kind": "measurement-record", "recordRef": "meas/math-researcher/proof-depth-2026-02", "metric": "benchmark-score", "value": 0.87 }
      ]
    },
    {
      "capability": "stochastic-process-analysis",
      "evidence": [
        { "kind": "measurement-record", "recordRef": "meas/math-researcher/stochastic-2026-02", "metric": "benchmark-score", "value": 0.79 }
      ]
    }
  ],
  "compatibilityRefs": ["compat/math-researcher@1.0.0/frontier-reasoner"]
}
```

Example 2 — a CognitiveSubstrate capability record (a specialized
mathematics model as a candidate substrate **based on measured capability,
not a hard-coded rule**):

```json
{
  "recordId": "capreg-substrate-limite-0001",
  "subject": { "kind": "cognitive-substrate", "substrateRef": "limite-labs/limite-math@2026.01" },
  "descriptors": [
    {
      "capability": "mathematical-reasoning",
      "evidence": [
        { "kind": "benchmark", "benchmarkId": "bench/olympiad-mix-v3", "resultRef": "result/bench/olympiad-mix-v3/limite-math@2026.01" },
        { "kind": "measurement-record", "recordRef": "meas/limite-math/latency-2026-02", "metric": "p95-latency-ms", "value": 1850 }
      ]
    }
  ],
  "compatibilityRefs": []
}
```

Example 3 — a capability-contract query (pure demand-side data):

```json
{
  "requires": ["mathematical-reasoning"]
}
```

### The rejected shape (documentation only — never a valid block)

The following record cites a profession label as suitability evidence and is
REJECTED with the typed violation `label-as-evidence` (path
`descriptors[0].profession`). It is shown as text, not as a `json` block,
because it must never validate:

```text
{
  "recordId": "capreg-substrate-bad-0001",
  "subject": { "kind": "cognitive-substrate", "substrateRef": "acme-models/reasoner-2@2026.03" },
  "descriptors": [
    { "capability": "mathematical-reasoning",
      "evidence": [ { "kind": "result-ref", "resultRef": "result/x" } ],
      "profession": "mathematician" }
  ],
  "compatibilityRefs": []
}
```
