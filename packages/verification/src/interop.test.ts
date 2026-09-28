/**
 * Cross-package interoperability for @tradrl/verification against
 * @tradrl/evaluation (the canonical owner of the gated records).
 *
 * The two packages are deliberately NOT package-dependencies (the frozen
 * workspace lockfile forbids it), so the gate consumes evaluation records
 * through STRUCTURAL MIRRORS (D-003/D-004). This test is the trip wire:
 *
 * 1. TYPE-LEVEL: the evaluation package's REAL `EvaluationSuite` and
 *    `AttainmentVerdict` records are assignable to this package's
 *    `EvaluationSuiteMirror` / `AttainmentVerdictMirror` unchanged — no
 *    adaptation, no re-validation shim. If either declaration drifts,
 *    `pnpm typecheck` fails.
 * 2. RUNTIME END-TO-END: a real verdict compiled by the evaluation package
 *    (from domain-core constraint reports) + a real verification report
 *    from this package compose into a real release gate — the full
 *    L7/L10/L9 chain in one flow.
 * 3. DIGEST PARITY: `stableDigest`/`canonicalJson` are byte-identical
 *    across the two packages — a lineage hash minted by the evaluation lane
 *    recomputes identically here (L9's cross-lane lineage law).
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  composeReleaseGate,
  verifyEvidenceChain,
  lineageHashOf,
  type AttainmentVerdictMirror,
  type EvaluationSuiteMirror,
  type VerificationReportMirror,
} from './index';
import type { SuiteId as VerificationSuiteId, VerdictId as VerificationVerdictId } from './ids';
import { canonicalJson as verificationCanonicalJson, stableDigest as verificationStableDigest } from './primitives';

import {
  compileAttainmentVerdict,
  createEvaluationSuite,
  splitConstraintReport,
  toAttainmentEvidence,
  canonicalJson as evaluationCanonicalJson,
  stableDigest as evaluationStableDigest,
  type AcceptanceCriteria,
  type AttainmentVerdict as EvaluationAttainmentVerdict,
  type EvaluationConfig,
  type EvaluationSuite as EvaluationEvaluationSuite,
  type SplitConstraintReport,
} from '../../evaluation/src/index';
import { requireTimestampMs } from '../../evaluation/src/primitives';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts).
// ---------------------------------------------------------------------------

/** Compiles iff the evaluation package's EvaluationSuite feeds the gate's mirror unchanged. */
function evaluationSuiteIsMirror(value: EvaluationEvaluationSuite): EvaluationSuiteMirror {
  return value;
}

/** Compiles iff the evaluation package's AttainmentVerdict feeds the gate's mirror unchanged. */
function evaluationVerdictIsMirror(value: EvaluationAttainmentVerdict): AttainmentVerdictMirror {
  return value;
}

/** Compiles iff the verification SuiteId brand coincides with evaluation's. */
function verificationSuiteIdIsEvaluation(value: VerificationSuiteId): EvaluationEvaluationSuite['suiteId'] {
  return value;
}

/** Compiles iff the verification VerdictId brand coincides with evaluation's. */
function verificationVerdictIdIsEvaluation(value: VerificationVerdictId): EvaluationAttainmentVerdict['verdictId'] {
  return value;
}

// ---------------------------------------------------------------------------
// Fixtures — a REAL evaluation-side compilation
// ---------------------------------------------------------------------------

function criteria(): AcceptanceCriteria {
  return {
    id: 'ac:6:goal-interop:1:9:csInterop:4' as never,
    goal: { goalId: 'goal-interop' as never, version: 1 },
    constraintSet: { id: 'csInterop' as never, version: 4 },
    criteria: [
      {
        criterionId: 'hard-limits',
        requiredSatisfaction: 1,
        gatingConstraintIds: ['max-exposure', 'asset-allowlist'],
        blockingConstraintIds: ['max-exposure', 'asset-allowlist'],
      },
    ],
    evaluationPolicy: {
      blindEvaluationRef: 'split.blind-interop',
      walkForwardRef: 'split.wf-interop',
      regimeRef: 'split.regime-interop',
    },
  };
}

function suite(): EvaluationEvaluationSuite {
  const result = createEvaluationSuite({
    suiteId: 'suite.interop-gate',
    grade: 'release',
    evaluatorVersion: 'evaluator.interop@1',
    members: [
      { kind: 'blind', splitPolicy: 'split.blind-interop', metricIds: ['metric.gate-ratio'] },
      { kind: 'walk-forward', splitPolicy: 'split.wf-interop', metricIds: ['metric.gate-ratio'] },
      { kind: 'regime', splitPolicy: 'split.regime-interop', metricIds: ['metric.gate-ratio'] },
    ],
    adversarialSuiteRefs: ['suite.adversarial-interop'],
  });
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function config(): EvaluationConfig {
  return {
    evaluatorVersion: 'evaluator.interop@1' as never,
    suite: 'suite.interop-gate' as never,
    criteria: criteria().id,
    confidence: { highEvidenceVolume: 4, moderateEvidenceVolume: 2, maxVacuousShareForHigh: 0, maxVacuousShareForModerate: 0.25 },
  };
}

function reports(): readonly SplitConstraintReport[] {
  const good = splitConstraintReport('split.blind-interop' as never, [
    { constraintId: 'max-exposure', severity: 'blocking', status: 'satisfied' },
    { constraintId: 'asset-allowlist', severity: 'blocking', status: 'satisfied' },
  ]);
  const wf = splitConstraintReport('split.wf-interop' as never, [
    { constraintId: 'max-exposure', severity: 'blocking', status: 'satisfied' },
    { constraintId: 'asset-allowlist', severity: 'blocking', status: 'satisfied' },
  ]);
  const regime = splitConstraintReport('split.regime-interop' as never, [
    { constraintId: 'max-exposure', severity: 'blocking', status: 'satisfied' },
    { constraintId: 'asset-allowlist', severity: 'blocking', status: 'satisfied' },
  ]);
  if (!good.ok || !wf.ok || !regime.ok) throw new Error('fixtures must be valid');
  return [good.value, wf.value, regime.value];
}

function compiledVerdict(): EvaluationAttainmentVerdict {
  const result = compileAttainmentVerdict({ criteria: criteria(), config: config(), suite: suite(), reports: reports() });
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluation -> verification structural mirrors (D-003/D-004 trip wire)', () => {
  it('the evaluation package\'s real EvaluationSuite is assignable to the gate mirror unchanged', () => {
    const realSuite = suite();
    const asMirror: EvaluationSuiteMirror = evaluationSuiteIsMirror(realSuite);
    expect(asMirror.suiteId).toBe('suite.interop-gate');
    expect(asMirror.grade).toBe('release');
    expect(asMirror.adversarialSuiteRefs).toEqual(['suite.adversarial-interop']);
    expectTypeOf<EvaluationEvaluationSuite['suiteId']>().toEqualTypeOf<VerificationSuiteId>();
    expectTypeOf<EvaluationAttainmentVerdict['verdictId']>().toEqualTypeOf<VerificationVerdictId>();
    expect(verificationSuiteIdIsEvaluation('suite.interop-gate' as never)).toBe('suite.interop-gate');
    expect(verificationVerdictIdIsEvaluation('vd:x' as never)).toBe('vd:x');
  });

  it('the evaluation package\'s real AttainmentVerdict is assignable to the gate mirror unchanged', () => {
    const verdict = compiledVerdict();
    const asMirror: AttainmentVerdictMirror = evaluationVerdictIsMirror(verdict);
    expect(asMirror.attained).toBe(true);
    expect(asMirror.limitations).toEqual([]);
    expect(asMirror.suite).toBe('suite.interop-gate');
  });
});

describe('digest parity (L9 cross-lane lineage law)', () => {
  it('canonicalJson and stableDigest are byte-identical across the two packages', () => {
    const samples: readonly unknown[] = [
      { verdictId: 'vd:0011223344556677', attained: true, suite: 'suite.interop-gate' },
      { nested: { b: [1, 2, { c: null }], a: 'x' } },
      [3, 1, 2],
      'plain-string',
      42,
      true,
      null,
      { unicode: '𝒜𝒝 ümlaut' },
    ];
    for (const sample of samples) {
      expect(evaluationCanonicalJson(sample as never)).toBe(verificationCanonicalJson(sample as never));
      expect(evaluationStableDigest(evaluationCanonicalJson(sample as never))).toBe(
        verificationStableDigest(verificationCanonicalJson(sample as never)),
      );
    }
  });

  it('a lineage hash minted by the evaluation lane recomputes identically here', () => {
    const verdict = compiledVerdict();
    // The evaluation-side digest of the verdict's lineage triple.
    const payload = { verdictId: verdict.verdictId, suite: verdict.suite, evaluator: verdict.evaluatorVersion } as const;
    const mintedHere = lineageHashOf(payload as never);
    // Recomputed with the evaluation lane's own algorithm — identical bytes.
    expect(mintedHere).toBe(evaluationStableDigest(evaluationCanonicalJson(payload as never)));
  });
});

describe('END-TO-END: evaluation verdict + verification report -> release gate', () => {
  it('the full L7/L10/L9 chain composes and releases on clean evidence', () => {
    const verdict = compiledVerdict();
    const suiteRecord = suite();

    // The evidence chain: the verdict's lineage hash + a clean quartet/leakage set.
    const chainPayload = { verdictId: verdict.verdictId, criteriaId: verdict.criteriaId, suite: verdict.suite } as const;
    const verification = verifyEvidenceChain([
      {
        kind: 'lineage-hash',
        caseId: 'case.lineage.verdict',
        recordRef: 'record.verdict.interop',
        payload: chainPayload as never,
        claimedHash: lineageHashOf(chainPayload as never),
      },
      {
        kind: 'quartet-monotone',
        caseId: 'case.quartet.chain',
        asOf: requireTimestampMs(1_800_000_000_000),
        quartets: [
          {
            event_time: requireTimestampMs(1_800_000_000_000 - 5_000),
            source_time: null,
            available_time: requireTimestampMs(1_800_000_000_000 - 4_000),
            ingestion_time: requireTimestampMs(1_800_000_000_000 - 3_000),
          },
        ],
      },
      {
        kind: 'no-future-leakage',
        caseId: 'case.leakage.run',
        asOf: requireTimestampMs(1_800_000_000_000),
        samples: [{ clockNow: requireTimestampMs(1_800_000_000_000 - 1_000), available_time: requireTimestampMs(1_800_000_000_000 - 2_000) }],
      },
    ]);
    if (!verification.ok) throw new Error(`verification must succeed: ${JSON.stringify(verification.errors)}`);
    expect(verification.value.passed).toBe(true);

    // The gate: REAL evaluation records + REAL verification report.
    const gate = composeReleaseGate({
      suite: evaluationSuiteIsMirror(suiteRecord),
      verdict: evaluationVerdictIsMirror(verdict),
      verification: { reportId: verification.value.reportId, passed: verification.value.passed } satisfies VerificationReportMirror,
    });
    expect(gate.ok).toBe(true);
    if (!gate.ok) throw new Error('must succeed');
    expect(gate.value.recommendation).toBe('release');
    expect(gate.value.reasons).toEqual(['attainment-met', 'verification-passed', 'adversarial-coverage-present', 'suite-grade-release']);
    expect(gate.value.verdict).toBe(verdict.verdictId);
    expect(gate.value.suite).toBe(suiteRecord.suiteId);
  });

  it('a TAMPERED evidence chain holds the gate even when attainment is perfect', () => {
    const verdict = compiledVerdict();
    const suiteRecord = suite();
    const chainPayload = { verdictId: verdict.verdictId, suite: verdict.suite } as const;
    const tampered = { verdictId: verdict.verdictId, suite: 'suite.TAMPERED' } as const;
    const verification = verifyEvidenceChain([
      {
        kind: 'lineage-hash',
        caseId: 'case.lineage.tamper',
        recordRef: 'record.verdict.interop',
        payload: tampered as never,
        claimedHash: lineageHashOf(chainPayload as never), // minted over the ORIGINAL
      },
    ]);
    if (!verification.ok) throw new Error('verification must succeed structurally');
    expect(verification.value.passed).toBe(false);

    const gate = composeReleaseGate({
      suite: evaluationSuiteIsMirror(suiteRecord),
      verdict: evaluationVerdictIsMirror(verdict),
      verification: { reportId: verification.value.reportId, passed: verification.value.passed } satisfies VerificationReportMirror,
    });
    expect(gate.ok).toBe(true);
    if (!gate.ok) throw new Error('must succeed');
    expect(gate.value.recommendation).toBe('hold');
    expect(gate.value.reasons).toContain('verification-failed');
  });

  it('the T007 bridge composes too: projected evidence remains guard-valid through the chain', () => {
    const verdict = compiledVerdict();
    const evidence = toAttainmentEvidence(verdict, 'run.interop-gate', requireTimestampMs(1_800_000_000_000));
    if (!evidence.ok) throw new Error('bridge must succeed');
    // The evidence's own lineage hash is part of the verifiable chain.
    const evidencePayload = { criteriaId: evidence.value.criteriaId, evaluations: evidence.value.evaluations.length } as const;
    const verification = verifyEvidenceChain([
      {
        kind: 'lineage-hash',
        caseId: 'case.lineage.evidence',
        recordRef: `record.evidence.${evidence.value.evaluationRunRef}`,
        payload: evidencePayload as never,
        claimedHash: lineageHashOf(evidencePayload as never),
      },
    ]);
    if (!verification.ok) throw new Error('verification must succeed');
    expect(verification.value.passed).toBe(true);
  });
});
