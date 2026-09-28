// @tradrl/verification — branded identity references (T012 id discipline).
//
// Id discipline (mirroring @tradrl/evaluation and the other contract
// packages):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package: `VerificationCaseId`, `VerificationReportId`,
//   `ReleaseGateId` — the verification-lane identity spaces.
// - OPAQUE cross-lane mirrors: `SuiteId`, `VerdictId`, `EvaluationRunId`,
//   `AdversarialSuiteRef`, `EvaluatorVersionRef` re-declare the evaluation
//   lane's brand tags IDENTICALLY so the references stay mutually assignable
//   without a package dependency (D-003/D-004; the interop test is the trip
//   wire). The verification package never imports @tradrl/evaluation — it
//   only reserves the reference types here.

import { Brand, isNonEmptyString } from './primitives';

// --- Ids owned by the verification lane (T012) --------------------------------

/** Identity of one verification case (one checkable evidence-chain claim). */
export type VerificationCaseId = Brand<string, 'VerificationCaseId'>;

/** Identity of one verification report (the aggregate over a case set). */
export type VerificationReportId = Brand<string, 'VerificationReportId'>;

/** Identity of one release-gate record (the composed release recommendation). */
export type ReleaseGateId = Brand<string, 'ReleaseGateId'>;

// --- Opaque cross-lane references (evaluation lane, T012) --------------------

/** Evaluation suite identity — structural mirror of @tradrl/evaluation. */
export type SuiteId = Brand<string, 'SuiteId'>;

/** Adversarial suite reference — structural mirror of @tradrl/evaluation. */
export type AdversarialSuiteRef = SuiteId;

/** Attainment verdict identity — structural mirror of @tradrl/evaluation. */
export type VerdictId = Brand<string, 'VerdictId'>;

/** Evaluation run identity — structural mirror of @tradrl/evaluation. */
export type EvaluationRunId = Brand<string, 'EvaluationRunId'>;

/** Versioned evaluator reference — structural mirror of @tradrl/evaluation. */
export type EvaluatorVersionRef = Brand<string, 'EvaluatorVersionRef'>;

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (see ids.test.ts and interop.test.ts).

export const isVerificationCaseId = (v: unknown): v is VerificationCaseId => isNonEmptyString(v);
export const isVerificationReportId = (v: unknown): v is VerificationReportId => isNonEmptyString(v);
export const isReleaseGateId = (v: unknown): v is ReleaseGateId => isNonEmptyString(v);
export const isSuiteId = (v: unknown): v is SuiteId => isNonEmptyString(v);
export const isAdversarialSuiteRef = (v: unknown): v is AdversarialSuiteRef => isNonEmptyString(v);
export const isVerdictId = (v: unknown): v is VerdictId => isNonEmptyString(v);
export const isEvaluationRunId = (v: unknown): v is EvaluationRunId => isNonEmptyString(v);
export const isEvaluatorVersionRef = (v: unknown): v is EvaluatorVersionRef => isNonEmptyString(v);
