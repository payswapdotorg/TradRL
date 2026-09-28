# Evaluation Contracts

Numbered, human-readable contract documents for the evaluation/verification
substrate of TradRL. Each document is owned by Work Order T012 and is the
authority downstream work orders code against.

| Document | Owning WO | Package | Validates |
|---|---|---|---|
| `01-metrics.md` | T012 | `@tradrl/evaluation` | `packages/evaluation/src/contract-docs.test.ts` |
| `02-suites-and-splits.md` | T012 | `@tradrl/evaluation` | `packages/evaluation/src/contract-docs.test.ts` |
| `03-attainment-verdict.md` | T012 | `@tradrl/evaluation` | `packages/evaluation/src/contract-docs.test.ts` |
| `04-search-integrity.md` | T012 | `@tradrl/evaluation` | `packages/evaluation/src/contract-docs.test.ts` |
| `05-verification-and-release-gate.md` | T012 | `@tradrl/verification` | `packages/verification/src/contract-docs.test.ts` |

## Conventions

- Documents are numbered in dependency order within the lane.
- Every exported record carries a field table (type, required, semantics),
  an invariants section, and at least one machine-validated JSON example.
- JSON examples are extracted, parsed and guard-checked by the owning
  package's `contract-docs.test.ts` — a documented example that fails its
  guard fails `pnpm verify`. Adding an example means extending that test's
  validator registry in the same change.
- This README carries conventions only and must stay free of JSON examples.
- Laws cited: `spec/ARCHITECTURE-LOCK.md` — L4 (point-in-time truth), L7
  (constraint-aware evaluation: raw PnL is insufficient), L9 (reproducible
  lineage), L10 (adversarial evaluation), L11 (search integrity), L20
  (safety outside prompts). Protocol source: `spec/EVALUATION-PROTOCOL.md`.
