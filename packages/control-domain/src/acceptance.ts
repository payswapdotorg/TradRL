<persisted-output>
Output too large (29.6KB). Full output saved to: /home/z/my-project/tool-results/read_1790617434454_a7695d0a3c4f.txt

Preview (first 2KB):
// @tradrl/control-domain — AcceptanceCriteria: the COMPILED artifact, and the
// attainment decision over it.
//
// Spec anchors:
// - spec/ARCHITECTURE.md core flow: "User -> Goal/Constraint Compiler -> ..."
//   — `compileAcceptance` IS the compilation step.
// - spec/ARCHITECTURE-LOCK.md L5 ("User constraints are executable acceptance
//   criteria" — constraints compile to predicates, not prose), L7 (raw PnL is
//   insufficient: attainment is objective-and-constraint based BY CONSTRUCTION
//   — see the PnL-solicitude note below), L9/L15 (the compiled record carries
//   goal-version and constraint-set-version lineage; its id encodes both),
//   L10/L11 (the evaluation protocol is pinned at compile time so evaluation
//   cannot be shopped), L20 (compilation is fail-closed: every reason a goal
//   cannot compile is a typed, collected failure).
// - spec/ARCHITECTURE.md "Evaluation": blind/unseen, walk-forward and regime
//   tests are pinned as opaque references owned by the evaluation lane (T012).
//
// PnL-solicitude (L7), by construction: NO record in this module —
// AcceptanceCriteria, CriterionBinding, AttainmentEvidence,
// CriterionEvaluationSummary, AttainmentVerdict, CriterionVerdict — carries
// a field that can hold a profit-and-loss figure, a return, or some other
// raw performance number. Attainment inputs are constraint-satisfaction
// counts ONLY (satisfied / violated / errors / not-applicable / blocking
// violations — the aggregate fields of domain-core's
// ConstraintEvaluationReport, whose
// SEMANTICS are mirrored here without importing it). The structural test
// `acceptance.test.ts` ("PnL solicitude") asserts the absence over the full
// recursive key set of every record, and documents why.
//
...
</persisted-output>