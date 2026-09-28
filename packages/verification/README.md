# @tradrl/verification

**Owning Work Order: T012** (frozen write surface: `packages/evaluation`, `packages/verification`, `contracts/evaluation`)

Evidence-chain verification and the release gate (spec/EVALUATION-PROTOCOL.md
"Integrity"/"Acceptance"; ARCHITECTURE-LOCK L4/L9/L10). Verification
verdicts are **boolean + reasons, never scores**; release recommendations
are **id-referenced records with machine-checkable reason codes — no free
text**. Human-readable contract documents live in
`contracts/evaluation/05-verification-and-release-gate.md`.

## Package laws

- Zero runtime dependencies: types, guards and pure functions only.
- No `any`; every exported record ships a hand-rolled, total type guard.
- **Verdicts are boolean + reasons**: a `VerificationReport` carries
  `passed` and located typed failures `(caseId, code, index)` — there is no
  partial credit on an evidence chain and no score anywhere.
- **L9**: lineage hashes are present and RECOMPUTABLE — the digest
  algorithm is a byte-identical mirror of `@tradrl/evaluation`'s
  (`src/interop.test.ts` trip-wires the parity); a hash minted by either
  lane recomputes in the other.
- **L4**: quartet-monotone and no-future-leakage cases enforce the
  point-in-time boundary over the availability-quartet mirror of
  `@tradrl/market-protocol` (canonical owner of the quartet contract).
- **L10**: the release gate REFUSES to compose without adversarial suite
  coverage — a typed error (`missing_adversarial_member`), not a hold.
- Cross-lane law: the evaluation lane's records are consumed through
  STRUCTURAL MIRRORS only — this package never imports `@tradrl/evaluation`
  (D-003/D-004); `src/interop.test.ts` proves the real records satisfy the
  mirrors unchanged.

## Layout

| Module | Contents |
|---|---|
| `src/primitives.ts` | Contract vocabulary + the canonical-JSON/stable-digest mirror of `@tradrl/evaluation` |
| `src/errors.ts` | `VerificationErrorCode` taxonomy + `VerificationResult<T>` |
| `src/ids.ts` | Owned ids (`VerificationCaseId`, `VerificationReportId`, `ReleaseGateId`) + evaluation-lane brand mirrors |
| `src/evidence.ts` | `VerificationCase` (lineage-hash / quartet-monotone / no-future-leakage) and `verifyEvidenceChain` -> `VerificationReport` |
| `src/release.ts` | `composeReleaseGate`: suite result + verification report -> `ReleaseGateRecord` (id-referenced, no free text) |
| `src/interop.test.ts` | Evaluation-lane mirror trip wires (real records satisfy the gate inputs; digest parity) |
