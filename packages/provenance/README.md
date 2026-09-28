# @tradrl/provenance

**Owning Work Order: T008** (frozen write surface: `packages/provenance`,
with `services/event-store` and `services/data-ingestion` — the data plane).

Store-level lineage contracts for the data plane: the provenance records
kept by the event store, derivation-chain validation and queries, and
append-only correction records.

## Surface

- **`ProvenanceRecord`** — the store-level provenance record: a structural
  MIRROR + EXTENSION of `@tradrl/market-protocol`'s `Provenance` block
  (origin `historical | simulated | generated`, adapter reference required
  for historical, `derived_from` lineage, `transform`), extended with
  `corrections` (amendment refs) and `custody`
  (adapter -> ingestion batch -> store commit). `validateProvenanceRecord`
  is collect-all validation with typed errors; `isProvenanceRecord` is the
  total structural guard.
- **Derivation chains** — `validateDerivationChain` enforces the DAG
  discipline (acyclic, no self-reference, no duplicate parents — mirroring
  market-protocol's validator discipline); `chainDepth`,
  `resolveRoots` and `ancestorsOf` answer lineage queries. Parent ids
  outside the node set are EXTERNAL roots — reported, not rejected.
- **Corrections** — `CorrectionRecord`/`CorrectionInput` amendments
  reference the corrected event; corrections NEVER mutate history;
  `latestCorrectionStatus` computes the current belief per event as a view
  over the append-only correction log.
- **Custody** — `CustodyChain` = `AdapterRef -> BatchRef -> CommitRef`
  (with the commit-stamped ingestion time): the L9 reproducible-lineage
  backbone for the data plane.
- **`deepFreeze`** — defensive immutability for records handed to consumers.
- **`TimestampMs`** — structural mirror of `@tradrl/time-engine` (canonical
  owner), the same mirror discipline `@tradrl/market-protocol` follows.

## Dependencies

Zero runtime dependencies — types, schemas and pure functions only.
`TimestampMs` and the provenance core are STRUCTURAL MIRRORS of
`@tradrl/time-engine` and `@tradrl/market-protocol` (law D-004: never
imports). `src/interop.test.ts` is the trip wire that fails if any
declaration drifts.

## Test placement note

`src/interop.test.ts` also imports `services/event-store` and
`services/data-ingestion` (via the repo's established cross-package
relative-import test pattern — see
`packages/market-protocol/src/interop.test.ts`) and hosts their behavioral
suites (`src/event-store.test.ts`, `src/data-ingestion.test.ts`). The root
`vitest.config.ts` and `tsconfig.json` include patterns cover `packages/**`
and `tests/**` only, and are FROZEN for this wave — placing the whole data
plane's tests with its contract package keeps every T008 test inside the
`pnpm verify` gate without touching root configs.
