# Learning Contracts

Numbered, human-readable contract documents for the learning substrate of
TradRL. Each document is owned by the Work Order that implemented its package
and is the authority downstream work orders code against.

| Document | Owning WO | Package | Validates |
|---|---|---|---|
| `01-trajectory.md` | T011 | `@tradrl/trajectory` | `packages/trajectory/src/contract-docs.test.ts` |
| `02-experiment.md` | T011 | `@tradrl/experiments` | `packages/experiments/src/contract-docs.test.ts` |

## Conventions

- Documents are numbered in dependency order within the plane.
- Every exported record carries a field table (type, required, semantics),
  an invariants section, and at least one machine-validated JSON example.
- JSON examples are extracted, parsed and guard-checked by the owning
  package's `contract-docs.test.ts` — a documented example that fails its
  guard fails `pnpm verify`. Adding an example means extending that test's
  validator registry in the same change.
- This README carries conventions only and must stay free of JSON examples.
- Laws cited: `spec/ARCHITECTURE-LOCK.md` — L4 (point-in-time truth), L9
  (reproducible lineage), L11 (search integrity), L12 (tenant isolation),
  L15 (project continuity).
