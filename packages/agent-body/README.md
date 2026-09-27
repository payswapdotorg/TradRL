# @tradrl/agent-body

**Owning Work Order: T003** (frozen write surface: `packages/agent-body`, `contracts/agent`)

Contracts for the system's core abstraction (spec/ARCHITECTURE-LOCK.md L2/L3):

```
Agent Instance = Agent Body Version
               + Cognitive Substrate
               + Possession Configuration
               + Environment
               + Runtime State
```

A model is a cognitive substrate. An Agent Body is the persistent, versioned
trading capability composition possessed by that substrate. Bodies and models
are separate: a model upgrade triggers compatibility testing, NOT body
redevelopment. A persistent capability change creates a NEW BodyVersion;
certified versions never mutate.

## Status: implemented

Zero runtime dependencies, no build step, TypeScript strict, no `any`,
hand-rolled type guards. Human-readable contracts live in
[`contracts/agent/`](../../contracts/agent/) — they are the authority for the
Agent OS (T006) and the body forge (T017).

## Module map

| Module | Contents |
|---|---|
| `src/primitives.ts` | Branded ids (`BodyId`, `BodyVersionId`, `SubstrateRef`, `PossessionId`, `AgentInstanceId`), opaque cross-lane refs (`ProjectRef`, `GoalRef`, `EvidenceRef`, `RuntimeStateRef`, …), strict SemVer, ISO 8601 timestamps, deep-freeze/deep-clone helpers, structural type-check helpers |
| `src/substrate.ts` | `CognitiveSubstrate` — model identity, capability manifest, cost/latency profile, substitution class |
| `src/compatibility.ts` | `SubstrateCompatibilityManifest`, deterministic `CompatibilityVerdict` (satisfied / violated-with-reasons), tested-substrate records |
| `src/body.ts` | `AgentBody`, `BodyComposition` (mission, capabilities, knowledge/tool policy, procedures, planning, delegation, authority boundary, evaluation/environment requirements), `BodyVersion`, `CertifiedBodyVersion`, certification |
| `src/possession.ts` | `Possession` binding, possession law (`validatePossession`), possession state machine (copy-on-write) |
| `src/instance.ts` | `AgentInstance` (authority scope, manager chain, runtime-state handle), lifecycle, `detectManagementCycle` |
| `src/lineage.ts` | `buildLineageIndex` (duplicate/unresolved/cycle/regression/body-mismatch detection), chain walking, ancestors, LCA |
| `src/examples.ts` | Canonical records mirrored by the JSON examples in `contracts/agent/*.md` |
| `src/index.ts` | Public API barrel |

## Key laws enforced here

- **L2 (body/model separation)** — bodies reference substrates only through
  the compatibility manifest; possession requires a satisfied verdict.
- **L3 (immutable versioned capability)** — all records deeply frozen;
  certified versions additionally fail `isCertifiedBodyVersion` when unfrozen;
  certification is terminal and produces a new record.
- **L8/L20 (safety outside prompts)** — `ExecutionAuthorityMode` has no
  `model-autonomous` member; `EXECUTE` in `allowedActions` requires
  `external-gateway-only`. Authority boundaries are DECLARATIVE policy data —
  enforcement lives in the Agent OS / risk / execution-gateway lanes.
- **Cross-lane law** — trading domain entities (T002) and market events/time
  (T004) are referenced only via opaque branded string ids; never imported.

## Usage sketch

```ts
import {
  certifyBodyVersion, createBodyVersion, createPossession, createSubstrate,
  evaluateSubstrateCompatibility, validatePossession,
} from '@tradrl/agent-body';

const substrate = createSubstrate({ /* provider, modelId, modelVersion, capabilities, costLatency, substitutionClass */ });
const version = createBodyVersion({ bodyId, version, parentId: null, composition, createdAt });
const certified = certifyBodyVersion(version, evidence); // { ok: true, certified } | { ok: false, violations }

const possession = createPossession({ id, bodyVersionId: certified.ok ? certified.certified.id : version.id, substrateId: substrate.id, /* … */ });
const validation = validatePossession(possession, version, substrate); // valid: false if substrate incompatible
```

## Testing

`pnpm verify` runs typecheck + vitest across the workspace. This package's
suite covers: compatibility verdicts (satisfied/violated-with-reasons),
possession validity (incompatible substrate cannot possess the body), version
immutability (mutation attempts rejected), lineage acyclicity, certified-version
freezing (type-level `@ts-expect-error` checks + runtime freeze checks), state
machines, guards, and JSON round-trips of every canonical example.
