/**
 * @tradrl/verification — the release gate.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md ("Acceptance: Every release
 * candidate defines objective success criteria ... stress suite and rollback
 * triggers"), spec/ARCHITECTURE-LOCK.md L10 ("Adversarial evaluation:
 * friendly replay alone does not release a strategy"), L7 (attainment is
 * constraint-satisfaction based), L9 (lineage agreement), spec/ARCHITECTURE.md
 * "Evaluation".
 *
 * WHAT THE GATE DOES: composes an evaluation-suite result (an attainment
 * verdict under a suite) and a verification report into a RELEASE
 * RECOMMENDATION RECORD — id-referenced, NO FREE TEXT:
 *
 *   { suite: SuiteId, verdict: VerdictId, verification: VerificationReportId,
 *     recommendation: 'release' | 'hold', reasons: ReleaseReasonCode[] }
 *
 * - `reasons` are machine-checkable CODES (both positive and negative), so
 *   the recommendation is replayable from its reasons alone.
 * - recommendation === 'release' iff ALL of: the verdict attained, the
 *   verification passed, the verdict carries NO limitations, and the suite
 *   is release-grade with adversarial coverage. Anything else is 'hold'
 *   with the codes saying exactly why.
 * - THE L10 REFUSAL IS A TYPED ERROR, not a hold: composing a gate whose
 *   suite carries no adversarial suite reference fails with
 *   `missing_adversarial_member` — the gate REFUSES to exist without
 *   adversarial coverage (friendly replay alone does not even get evaluated;
 *   it gets rejected at the door). The evaluation lane enforces the same
 *   law at suite construction (defense in depth).
 * - Lineage agreement (L9): the verdict must name the suite
 *   (`suite_mismatch` otherwise). The gate never invents references.
 *
 * INPUTS ARE STRUCTURAL MIRRORS of the evaluation lane's records (the
 * fields the gate reads — suite id/grade/adversarial refs; verdict
 * id/attained/suite/evaluator version/limitations). interop.test.ts proves
 * the evaluation package's real records satisfy these shapes unchanged.
 */

import { deepFreeze, isNonEmptyString, isRecord, stableDigestJson, type JsonValue } from './primitives';
import {
  isAdversarialSuiteRef,
  isEvaluatorVersionRef,
  isReleaseGateId,
  isSuiteId,
  isVerdictId,
  type AdversarialSuiteRef,
  type EvaluatorVersionRef,
  type ReleaseGateId,
  type SuiteId,
  type VerdictId,
} from './ids';
import {
  isVerificationReportId,
  type VerificationReportId,
} from './ids';
import { fail, invalidField, invalidType, missingField, ok, type VerificationError, type VerificationResult } from './errors';

// ---------------------------------------------------------------------------
// Gate inputs — structural mirrors of the evaluation lane's records
// ---------------------------------------------------------------------------

/** Suite grade — mirror of the evaluation lane's `SuiteGrade`. */
export type SuiteGradeMirror = 'screening' | 'release';

/** Runtime-checkable list of suite grades (mirror). */
export const SUITE_GRADES_MIRROR: readonly SuiteGradeMirror[] = ['screening', 'release'] as const;

/** Guard: a suite grade (mirror). */
export function isSuiteGradeMirror(v: unknown): v is SuiteGradeMirror {
  return typeof v === 'string' && (SUITE_GRADES_MIRROR as readonly string[]).includes(v);
}

/**
 * The suite result the gate consumes — STRUCTURAL MIRROR of
 * @tradrl/evaluation's `EvaluationSuite`, restricted to the fields the gate
 * reads. The evaluation package's real records satisfy this unchanged.
 */
export interface EvaluationSuiteMirror {
  readonly suiteId: SuiteId;
  readonly grade: SuiteGradeMirror;
  /** The compiled evaluator that scored the suite (L9 lineage agreement). */
  readonly evaluatorVersion: EvaluatorVersionRef;
  /** Opaque ids of adversarial suites — MANDATORY non-empty for the gate (L10). */
  readonly adversarialSuiteRefs: readonly AdversarialSuiteRef[];
}

/** Guard: `EvaluationSuiteMirror`. */
export function isEvaluationSuiteMirror(v: unknown): v is EvaluationSuiteMirror {
  if (!isRecord(v)) return false;
  if (!isSuiteId(v.suiteId)) return false;
  if (!isSuiteGradeMirror(v.grade)) return false;
  if (!isEvaluatorVersionRef(v.evaluatorVersion)) return false;
  if (!Array.isArray(v.adversarialSuiteRefs)) return false;
  if (!v.adversarialSuiteRefs.every((ref) => isAdversarialSuiteRef(ref))) return false;
  return new Set(v.adversarialSuiteRefs).size === v.adversarialSuiteRefs.length;
}

/**
 * The verdict the gate consumes — STRUCTURAL MIRROR of
 * @tradrl/evaluation's `AttainmentVerdict`, restricted to the fields the
 * gate reads (attainment outcome, lineage, computed limitations).
 */
export interface AttainmentVerdictMirror {
  readonly verdictId: VerdictId;
  readonly attained: boolean;
  readonly suite: SuiteId;
  readonly evaluatorVersion: EvaluatorVersionRef;
  /** COMPUTED limitation codes (machine-derived by the evaluation lane). */
  readonly limitations: readonly string[];
}

/** Guard: `AttainmentVerdictMirror`. */
export function isAttainmentVerdictMirror(v: unknown): v is AttainmentVerdictMirror {
  if (!isRecord(v)) return false;
  if (!isVerdictId(v.verdictId)) return false;
  if (typeof v.attained !== 'boolean') return false;
  if (!isSuiteId(v.suite)) return false;
  if (!isEvaluatorVersionRef(v.evaluatorVersion)) return false;
  if (!Array.isArray(v.limitations)) return false;
  return v.limitations.every((code) => isNonEmptyString(code));
}

/**
 * The verification report the gate consumes — STRUCTURAL MIRROR of this
 * package's `VerificationReport`, restricted to the fields the gate reads.
 */
export interface VerificationReportMirror {
  readonly reportId: VerificationReportId;
  readonly passed: boolean;
}

/** Guard: `VerificationReportMirror`. */
export function isVerificationReportMirror(v: unknown): v is VerificationReportMirror {
  if (!isRecord(v)) return false;
  if (!isVerificationReportId(v.reportId)) return false;
  return typeof v.passed === 'boolean';
}

// ---------------------------------------------------------------------------
// The release recommendation record (id-referenced, no free text)
// ---------------------------------------------------------------------------

/** The recommendation: release or hold. Never a score. */
export type ReleaseRecommendation = 'release' | 'hold';

/** Runtime-checkable list of recommendations. */
export const RELEASE_RECOMMENDATIONS: readonly ReleaseRecommendation[] = ['release', 'hold'] as const;

/** Guard: a release recommendation. */
export function isReleaseRecommendation(v: unknown): v is ReleaseRecommendation {
  return typeof v === 'string' && (RELEASE_RECOMMENDATIONS as readonly string[]).includes(v);
}

/**
 * Machine-checkable release reason codes — the gate's entire vocabulary.
 * A 'release' recommendation implies the four positive codes and none of
 * the negative ones; every other combination is a hold whose reasons say
 * exactly why. NO FREE TEXT anywhere on the record.
 */
export const RELEASE_REASON_CODES = [
  /** The verdict attained every criterion in every split. */
  'attainment-met',
  /** The verdict did not attain (or the chain cannot release on it). */
  'attainment-not-met',
  /** The evidence chain verified. */
  'verification-passed',
  /** The evidence chain failed verification. */
  'verification-failed',
  /** Adversarial suite coverage is present (L10). */
  'adversarial-coverage-present',
  /** The suite is release-grade. */
  'suite-grade-release',
  /** The suite is screening-grade — screening never releases. */
  'suite-grade-screening',
  /** The verdict carries computed limitations (holes are holes). */
  'verdict-limitations-present',
] as const;

/** Machine-checkable release reason code. */
export type ReleaseReasonCode = (typeof RELEASE_REASON_CODES)[number];

/** Guard: a release reason code. */
export function isReleaseReasonCode(v: unknown): v is ReleaseReasonCode {
  return typeof v === 'string' && (RELEASE_REASON_CODES as readonly string[]).includes(v);
}

/** The composed release recommendation record (id-referenced, no free text). */
export interface ReleaseGateRecord {
  /** Deterministic derived id (digest over the composed lineage). */
  readonly gateId: ReleaseGateId;
  readonly suite: SuiteId;
  readonly verdict: VerdictId;
  readonly verificationReport: VerificationReportId;
  readonly recommendation: ReleaseRecommendation;
  /** Deterministic fact set — the recommendation is replayable from these codes alone. */
  readonly reasons: readonly ReleaseReasonCode[];
}

/** Guard: `ReleaseGateRecord`. */
export function isReleaseGateRecord(v: unknown): v is ReleaseGateRecord {
  if (!isRecord(v)) return false;
  if (!isReleaseGateId(v.gateId)) return false;
  if (!isSuiteId(v.suite)) return false;
  if (!isVerdictId(v.verdict)) return false;
  if (!isVerificationReportId(v.verificationReport)) return false;
  if (!isReleaseRecommendation(v.recommendation)) return false;
  if (!Array.isArray(v.reasons)) return false;
  const reasons = v.reasons as readonly unknown[];
  if (!reasons.every((code) => isReleaseReasonCode(code))) return false;
  // Consistency law: release iff the four positive codes are present and no negative code is.
  const positive: readonly ReleaseReasonCode[] = ['attainment-met', 'verification-passed', 'adversarial-coverage-present', 'suite-grade-release'];
  const negative: readonly ReleaseReasonCode[] = ['attainment-not-met', 'verification-failed', 'suite-grade-screening', 'verdict-limitations-present'];
  const narrowed = reasons as readonly ReleaseReasonCode[];
  const impliesRelease = positive.every((code) => narrowed.includes(code)) && !negative.some((code) => narrowed.includes(code));
  return v.recommendation === (impliesRelease ? 'release' : 'hold');
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** The complete, pure input set of one gate composition. */
export interface ReleaseGateInput {
  readonly suite: EvaluationSuiteMirror;
  readonly verdict: AttainmentVerdictMirror;
  readonly verification: VerificationReportMirror;
}

/**
 * Compose the release gate: an evaluation-suite result (its attainment
 * verdict) + a verification report -> the release recommendation record.
 *
 * Typed error laws (fail-closed):
 * - `invalid_gate_input` — a structurally invalid input record;
 * - `missing_adversarial_member` — the suite carries NO adversarial suite
 *   reference: the gate REFUSES to compose (L10 — friendly replay alone
 *   does not release a strategy, and does not even get a hold reason);
 * - `suite_mismatch` — the verdict does not name the suite, or the
 *   evaluator versions disagree (L9 lineage agreement).
 *
 * Determinism: a pure function of the inputs; the derived `gateId` is a
 * digest over the composed lineage (suite, verdict, verification ids).
 */
export function composeReleaseGate(input: ReleaseGateInput): VerificationResult<ReleaseGateRecord> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('composeReleaseGate expects an object')] };
  }
  const structural: VerificationError[] = [];
  if (input.suite === undefined) structural.push(missingField('suite'));
  else if (!isEvaluationSuiteMirror(input.suite)) structural.push(invalidField('suite', 'suite result failed structural validation (mirror of the evaluation lane)'));

  if (input.verdict === undefined) structural.push(missingField('verdict'));
  else if (!isAttainmentVerdictMirror(input.verdict)) structural.push(invalidField('verdict', 'attainment verdict failed structural validation (mirror of the evaluation lane)'));

  if (input.verification === undefined) structural.push(missingField('verification'));
  else if (!isVerificationReportMirror(input.verification)) structural.push(invalidField('verification', 'verification report failed structural validation (mirror)'));

  if (structural.length > 0) return { ok: false, errors: structural };

  const suite = input.suite;
  const verdict = input.verdict;
  const verification = input.verification;

  // L10: the gate REFUSES to exist without adversarial coverage.
  if (suite.adversarialSuiteRefs.length === 0) {
    return fail(
      'missing_adversarial_member',
      `suite "${suite.suiteId}" references no adversarial suite — the release gate refuses to compose without adversarial coverage (L10: friendly replay alone does not release a strategy)`,
    );
  }

  // L9: lineage agreement — the verdict must name the suite and evaluator.
  if (verdict.suite !== suite.suiteId) {
    return fail('suite_mismatch', `verdict "${verdict.verdictId}" was produced under suite "${verdict.suite}" but the gate composes suite "${suite.suiteId}"`);
  }
  if (verdict.evaluatorVersion !== suite.evaluatorVersion) {
    return fail(
      'suite_mismatch',
      `verdict "${verdict.verdictId}" was scored by evaluator "${verdict.evaluatorVersion}" but the suite binds "${suite.evaluatorVersion}"`,
    );
  }

  const reasons: ReleaseReasonCode[] = [];
  reasons.push(verdict.attained ? 'attainment-met' : 'attainment-not-met');
  reasons.push(verification.passed ? 'verification-passed' : 'verification-failed');
  reasons.push('adversarial-coverage-present');
  reasons.push(suite.grade === 'release' ? 'suite-grade-release' : 'suite-grade-screening');
  if (verdict.limitations.length > 0) reasons.push('verdict-limitations-present');

  const positive: readonly ReleaseReasonCode[] = ['attainment-met', 'verification-passed', 'adversarial-coverage-present', 'suite-grade-release'];
  const negative: readonly ReleaseReasonCode[] = ['attainment-not-met', 'verification-failed', 'suite-grade-screening', 'verdict-limitations-present'];
  const impliesRelease = positive.every((code) => reasons.includes(code)) && !negative.some((code) => reasons.includes(code));
  const recommendation: ReleaseRecommendation = impliesRelease ? 'release' : 'hold';

  const gateId = `rg:${stableDigestJson({
    suite: suite.suiteId,
    verdict: verdict.verdictId,
    verification: verification.reportId,
    recommendation,
  } satisfies JsonValue)}` as ReleaseGateId;

  return ok(
    deepFreeze({
      gateId,
      suite: suite.suiteId,
      verdict: verdict.verdictId,
      verificationReport: verification.reportId,
      recommendation,
      reasons,
    } satisfies ReleaseGateRecord),
  );
}
