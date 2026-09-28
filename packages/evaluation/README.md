# @tradrl/evaluation

**Owning Work Order: T012** (frozen write surface: `packages/evaluation`, `packages/verification`, `contracts/evaluation`)

The acceptance machinery of TradRL: metric definitions, evaluation suites,
split policies, attainment verdict compilation and search-integrity
reporting (spec/EVALUATION-PROTOCOL.md; spec/ARCHITECTURE.md "Evaluation").
Human-readable contract documents live in `contracts/evaluation/` — they
are the authority downstream Work Orders (T013 RL, T015 curriculum, T016
organization compiler, T031 search-integrity audits) code against, and
their JSON examples are machine-validated against this package's guards by
`src/contract-docs.test.ts`.

## Package laws

- Zero runtime dependencies: types, guards and pure functions only. No
  build step; the package is consumed as TypeScript sources.
- No `any`; every exported record ships a hand-rolled, total type guard
  `isX(v: unknown): v is X` that never throws.
- **L7 by construction**: attainment verdicts are constraint-satisfaction
  based, never raw-PnL based — no record on the compilation path carries a
  field that can hold a performance figure (machine-checked by the "PnL
  solicitude" structural test). Aggregate constraint statistics are
  first-class metrics; risk-adjusted figures exist ONLY as opaque
  references and can never be the sole criterion.
- **L10**: adversarial suites are first-class protocol members referenced
  by opaque ids; a release-grade suite without adversarial coverage is a
  typed construction error, and the verification lane's ReleaseGate
  re-checks the law (defense in depth).
- **L11**: search-integrity reports read the FULL experiment trial log
  (failures and rejections retained and counted); hiding trials is a typed
  error; the best-of-N selection effect is quantified (reported statistic
  vs blind-selection expectation), never hidden.
- Determinism: verdict computation is a pure function of
  (criteria, reports, suite, config) — same inputs produce byte-identical
  verdicts (canonical JSON + stable digests); no ambient clock anywhere.
- Cross-lane law: domain-core (T002), control-domain (T007), experiments/
  trajectory (T011) and time-engine shapes are referenced through opaque
  branded ids and STRUCTURAL MIRRORS only — this package never imports
  those lanes (D-003/D-004); `src/interop.test.ts` is the drift trip wire.

## Layout

| Module | Contents |
|---|---|
| `src/primitives.ts` | Contract vocabulary: branding, guards, deep-freeze, JSON model, canonical JSON, stable digests, `TimestampMs` mirror of time-engine |
| `src/errors.ts` | `EvalErrorCode` taxonomy + `EvalResult<T>` (collect-all, typed, never throws) |
| `src/ids.ts` | Owned ids (`MetricId`, `SuiteId`, `EvaluationRunId`, `VerdictId`, `SearchIntegrityReportId`, `CriteriaRef`) + cross-lane brand mirrors |
| `src/metrics.ts` | `MetricDefinition`/`MetricResult`/`MetricRegistry`; constraint-aggregate vocabulary; `ConstraintSatisfactionCounts` (domain-core mirror) |
| `src/splits.ts` | `DatasetAxis`, walk-forward / blind-holdout / regime-partition policies and their pure interpreters with typed boundary laws |
| `src/suite.ts` | `EvaluationSuite` composition; the mandatory-adversarial law for release grade; evaluator-version lineage |
| `src/verdict.ts` | `compileAttainmentVerdict` (worst-split law, computed limitations, confidence blocks); `AcceptanceCriteria` mirror (T007); `toAttainmentEvidence` bridge |
| `src/integrity.ts` | `computeSearchIntegrityReport` over the T011-mirrored trial log; best-of-N effect |
| `src/interop.test.ts` | Cross-package trip wires (time-engine, domain-core) + vendored T007/T011 reference mirrors |

## Consumers

- **T007 (control-domain)**: `decideAttainment` consumes the
  `AttainmentEvidence` this package projects via `toAttainmentEvidence`.
- **T011 (experiments)**: designs reference this lane's `SplitPolicyRef`,
  `EvaluatorVersionRef` and `CriteriaRef` spaces; evaluation reads the full
  trial log through the `TrialLogEntry` mirror.
- **T013/T015/T016/T031**: consume suites, verdicts and search-integrity
  reports by id; nothing else leaks.
- **@tradrl/verification**: mirrors the verdict/suite shapes it gates
  (never imports — interop test proves assignability).
