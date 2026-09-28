# Verification and the Release Gate

**Owning document:** T012 · **Package:** `@tradrl/verification` (`packages/verification`)
**Spec source:** spec/EVALUATION-PROTOCOL.md ("Integrity", "Acceptance"), contracts/market/01-market-event-envelope.md (the availability quartet), ARCHITECTURE-LOCK **L4, L9, L10, L20**.

Verification is the evidence-chain auditor and the release gate.
**Verdicts are boolean + reasons, never scores**: a `VerificationReport`
carries `passed` (boolean) and located typed failures
`(caseId, code, index)` — there is no partial credit on an evidence chain.
The release gate composes an evaluation-suite result (its attainment
verdict) + a verification report into an **id-referenced record with
machine-checkable reason codes — no free text**.

## VerificationCase (DATA — checkable claims about an evidence chain)

| Kind | Fields | Semantics |
|---|---|---|
| `lineage-hash` | `caseId`, `recordRef`, `payload` (canonical JSON), `claimedHash` | The record's lineage hash is present and RECOMPUTABLE: the verifier recomputes the program-wide digest over the canonical payload and compares. |
| `quartet-monotone` | `caseId`, `asOf`, `quartets` (non-empty) | Every availability quartet is monotone (`available_time >= event_time` — the one ENFORCED ordering of the quartet contract) and NOT future-dated (`available_time <= asOf`). |
| `no-future-leakage` | `caseId`, `asOf`, `samples` (non-empty) | Every delivered observation respected its availability instant: `available_time <= clockNow` per sample (L4) and `available_time <= asOf`. |

`AvailabilityQuartet` mirrors the four timestamp fields of
`@tradrl/market-protocol`'s envelope (canonical owner): `event_time`,
`source_time` (null when the source does not say; advisory, unordered),
`available_time` (THE information-boundary input), `ingestion_time`
(informational, deliberately unordered against availability).

## VerificationReport

| Field | Type | Required | Semantics |
|---|---|---|---|
| `reportId` | `VerificationReportId` | yes | Deterministic derived id (`vr:` + digest over the verified cases). |
| `passed` | `boolean` | yes | True iff NO failure was found (consistency law: `passed === (failures.length === 0)`). |
| `casesChecked` | `number` | yes | Number of structurally valid cases verified. |
| `failures` | `readonly VerificationFailure[]` | yes | Located failures: `{ caseId, code, index }`. |

Reason codes (closed vocabulary): `lineage-hash-mismatch`,
`lineage-hash-malformed`, `quartet-ordering-violation`,
`quartet-future-dated`, `future-leakage`, `sample-future-dated`.

## ReleaseGate

Inputs (structural mirrors of `@tradrl/evaluation`'s records — never
imports; `packages/verification/src/interop.test.ts` is the trip wire):

- `suite: { suiteId, grade, evaluatorVersion, adversarialSuiteRefs }`
- `verdict: { verdictId, attained, suite, evaluatorVersion, limitations }`
- `verification: { reportId, passed }`

| Field | Type | Required | Semantics |
|---|---|---|---|
| `gateId` | `ReleaseGateId` | yes | Deterministic derived id (`rg:` + digest over the composed lineage). |
| `suite` / `verdict` / `verificationReport` | ids | yes | The composed lineage — id-referenced, never inlined records. |
| `recommendation` | `'release' \| 'hold'` | yes | Never a score. |
| `reasons` | `readonly ReleaseReasonCode[]` | yes | The deterministic fact set — the recommendation is replayable from the codes alone. |

Reason codes: positive `attainment-met`, `verification-passed`,
`adversarial-coverage-present`, `suite-grade-release`; negative
`attainment-not-met`, `verification-failed`, `suite-grade-screening`,
`verdict-limitations-present`. `recommendation === 'release'` iff all four
positive codes hold and no negative code does.

## Typed error laws (fail-closed)

1. **L10 REFUSAL (a typed ERROR, not a hold):** composing a gate whose
   suite carries NO adversarial suite reference fails with
   `missing_adversarial_member` — friendly replay alone does not even get
   evaluated; it gets rejected at the door. The evaluation lane enforces
   the same law at suite construction (defense in depth).
2. `suite_mismatch` — the verdict does not name the suite, or the
   evaluator versions disagree (L9 lineage agreement).
3. `invalid_gate_input` — structurally invalid input records.

## Digest law (L9 cross-lane lineage)

`canonicalJson` and `stableDigest` are byte-identical mirrors across
`@tradrl/evaluation` and `@tradrl/verification` (interop-tested): a
lineage hash minted by the evaluation lane recomputes identically here,
and vice versa.

## JSON examples (machine-validated)

A lineage-hash case:

```json
{
  "kind": "lineage-hash",
  "caseId": "case.lineage.verdict-1",
  "recordRef": "record.verdict-1",
  "payload": { "attained": true, "suite": "suite.friction-2024q4", "verdictId": "vd:0011223344556677" },
  "claimedHash": "0011223344556677"
}
```

A quartet-monotone case:

```json
{
  "kind": "quartet-monotone",
  "caseId": "case.quartet.chain-1",
  "asOf": 1800000000000,
  "quartets": [
    { "event_time": 1799999995000, "source_time": null, "available_time": 1799999996000, "ingestion_time": 1799999997000 }
  ]
}
```
