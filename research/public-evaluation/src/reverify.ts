/**
 * @tradrl/research-public-evaluation — the DETERMINISTIC RE-VERIFICATION
 * (Work Order T049): "a published benchmark result must be re-runnable to
 * the same bytes."
 *
 * HOW IT WORKS: every published record carries its RE-VERIFICATION
 * RECIPE — the runner identity (the exact content-addressed suite), the
 * complete input manifest (the subject binding with its artifact
 * addresses, the material source id, the plan id, the search binding),
 * the phase, the INJECTED instant, and the EXPECTED measurement id +
 * canonical-bytes digest. {@link reverifyPublishedRecord}:
 *
 * 1. verifies the published record itself (the L9 content-address law +
 *    the L4 laws — a tampered publication fails before any re-run);
 * 2. checks the recipe against the SUPPLIED SOURCES (a recipe ref with
 *    no supplied source is `source_missing` — the re-verifier never
 *    invents inputs);
 * 3. verifies the supplied suite against the recipe's pinned suite
 *    digest (`digest_mismatch` — the runner identity cannot drift);
 * 4. RE-RUNS the benchmark machinery (the own-lane import — the REAL
 *    `runSuiteMeasurement`, not a mirror of it) over the retained
 *    sources at the recipe's injected instant;
 * 5. compares the re-measurement's id AND canonical bytes against the
 *    recipe's expectations (`reverify_failed` on ANY divergence);
 * 6. re-derives the public claim block from the re-measurement and
 *    compares it against the published claim (`claim_unverified` — a
 *    claim that no longer follows from its own recipe is not a claim).
 *
 * THE DETERMINISM CHAIN this law stands on: the machinery is pure and
 * total (no wall clock, no ambient randomness — L4/L9), so identical
 * inputs yield identical bytes; the publication binds the inputs by
 * content address; the re-verification recomputes everything. A published
 * benchmark result that cannot be reproduced to the same bytes is
 * REFUSED — that is the whole point of publishing evidence.
 */

import { deepFreeze, isRecord } from './primitives';
import { fail, invalidType, ok, type PublicationResult } from './errors';
import { canonicalMeasurement, runSuiteMeasurement, suiteDigest, verifyMeasurementRecord } from './imports';
import type { MaterialSource, MeasurementRecord, SliceReportMirror, SplitPlanMirror, SearchRecordMirror, SuiteDefinition } from './imports';
import { verifyPublishedRecord } from './record';
import { projectClaims } from './gate';
import type { PublishedEvaluationRecord } from './record';

// ---------------------------------------------------------------------------
// The re-verification sources
// ---------------------------------------------------------------------------

/** The retained sources a re-verification re-runs over (every recipe ref must be supplied). */
export interface ReverificationSources {
  /** The exact suite the recipe pins (verified against the pinned digest). */
  readonly suite: SuiteDefinition;
  /** The measured subject's evidence artifact (the reference-slice report). */
  readonly evidence: SliceReportMirror;
  /** The material source the measurement ran over. */
  readonly material: MaterialSource;
  /** The split plan, when the recipe pins one. */
  readonly plan?: SplitPlanMirror | null;
  /** The search record, when the recipe pins one. */
  readonly search?: SearchRecordMirror | null;
  /** The publication policy (the claim projection must reproduce the published claims). */
  readonly policy: { readonly publicAxes: readonly string[] };
}

/** The re-verification outcome: the re-run measurement plus the comparison verdict. */
export interface ReverificationOutcome {
  /** The freshly re-run measurement (byte-compared against the recipe's expectation). */
  readonly remeasurement: MeasurementRecord;
  /** The published record the re-verification was run against (verified). */
  readonly publication: PublishedEvaluationRecord;
  /** The canonical bytes of the re-run (equal to the recipe's expected digest on success). */
  readonly bytes: string;
}

// ---------------------------------------------------------------------------
// The re-verification
// ---------------------------------------------------------------------------

/**
 * RE-VERIFY one published evaluation record: verify the publication,
 * check the sources against the recipe, re-run the benchmark machinery at
 * the recipe's injected instant, and refuse on ANY byte divergence. Pure
 * and deterministic — re-running the re-verification itself yields the
 * same verdict.
 */
export function reverifyPublishedRecord(publication: unknown, sources: unknown): PublicationResult<ReverificationOutcome> {
  const publicationVerification = verifyPublishedRecord(publication);
  if (!publicationVerification.ok) return publicationVerification;
  const record = publicationVerification.value;

  if (!isRecord(sources)) {
    return { ok: false, errors: [invalidType('re-verification sources must be an object')] };
  }
  const source = sources as unknown as ReverificationSources;
  const recipe = record.verification;

  // --- The recipe-vs-sources law ---------------------------------------------
  if (source.suite === undefined) {
    return fail('source_missing', `the recipe pins suite "${recipe.runner.suite_id}" but no suite was supplied`, 'sources.suite');
  }
  if (source.suite.suite_id !== recipe.runner.suite_id || suiteDigest(source.suite) !== recipe.runner.suite_digest) {
    return fail(
      'digest_mismatch',
      `the supplied suite "${source.suite.suite_id}" does not match the recipe's pinned runner "${recipe.runner.suite_id}" (digest ${recipe.runner.suite_digest}) — the runner identity cannot drift (L9)`,
      'sources.suite',
    );
  }
  if (source.evidence === undefined) {
    return fail('source_missing', `the recipe pins subject artifact "${recipe.subject.artifacts[0]?.ref ?? '<none>'}" but no evidence artifact was supplied`, 'sources.evidence');
  }
  if (source.material === undefined) {
    return fail('source_missing', `the recipe pins material source "${recipe.material_source_id}" but no material source was supplied`, 'sources.material');
  }
  if (source.material.source_id !== recipe.material_source_id) {
    return fail(
      'digest_mismatch',
      `the supplied material source "${source.material.source_id}" does not match the recipe's pinned source "${recipe.material_source_id}"`,
      'sources.material',
    );
  }
  if (recipe.plan_id !== null) {
    if (source.plan === undefined || source.plan === null) {
      return fail('source_missing', `the recipe pins split plan "${recipe.plan_id}" but no plan was supplied`, 'sources.plan');
    }
    if (source.plan.plan_id !== recipe.plan_id) {
      return fail('digest_mismatch', `the supplied plan "${source.plan.plan_id}" does not match the recipe's pinned plan "${recipe.plan_id}"`, 'sources.plan');
    }
  }
  if (recipe.search_record_id !== null) {
    if (source.search === undefined || source.search === null) {
      return fail('source_missing', `the recipe pins search record "${recipe.search_record_id}" but no search record was supplied`, 'sources.search');
    }
    if (source.search.search_id !== recipe.search_record_id) {
      return fail('digest_mismatch', `the supplied search record "${source.search.search_id}" does not match the recipe's pinned record "${recipe.search_record_id}"`, 'sources.search');
    }
  }
  if (source.policy === undefined || !Array.isArray(source.policy.publicAxes)) {
    return fail('source_missing', 'the claim projection needs the publication policy (the public-axes allowlist)', 'sources.policy');
  }

  // --- The re-run ----------------------------------------------------------------
  const rerun = runSuiteMeasurement({
    suite: source.suite,
    subject: recipe.subject,
    evidence: source.evidence,
    material: source.material,
    phase: recipe.phase,
    search: recipe.search_record_id === null ? null : { record: source.search as SearchRecordMirror, trial: recipe.trial as string },
    plan: recipe.plan_id === null ? null : (source.plan as SplitPlanMirror),
    measured_at: recipe.measured_at,
  });
  if (!rerun.ok) {
    return fail(
      'reverify_failed',
      `the re-run refused: ${rerun.errors.map((error) => error.message).join('; ')} — the published claim's own inputs no longer support a lawful measurement`,
      'remeasurement',
    );
  }
  const remeasurement = rerun.value;

  // --- The byte comparison (THE law) ----------------------------------------------
  const bytes = canonicalMeasurement(remeasurement);
  if (remeasurement.measurement_id !== recipe.expected_measurement_id) {
    return fail(
      'reverify_failed',
      `the re-run measurement "${remeasurement.measurement_id}" does not reproduce the published measurement "${recipe.expected_measurement_id}" — the published benchmark result is NOT re-runnable to the same bytes`,
      'verification.expected_measurement_id',
    );
  }
  const remeasurementVerification = verifyMeasurementRecord(remeasurement);
  if (!remeasurementVerification.ok) {
    return fail('reverify_failed', 'the re-run measurement failed its own content-address verification (an internal invariant broke)', 'remeasurement');
  }

  // --- The claim comparison ----------------------------------------------------------
  const expectedClaims = projectClaims(remeasurement, source.policy);
  const publishedClaims = record.claim.axes;
  if (expectedClaims.length !== publishedClaims.length) {
    return fail(
      'claim_unverified',
      `the published claim carries ${publishedClaims.length} axes but the re-run projects ${expectedClaims.length} — the claim no longer follows from its own recipe`,
      'claim.axes',
    );
  }
  for (let index = 0; index < publishedClaims.length; index++) {
    const published = publishedClaims[index] as { axis: string; kind: string; value: string | number | boolean; attained: boolean | null };
    const expected = expectedClaims[index] as { axis: string; kind: string; value: string | number | boolean; attained: boolean | null };
    if (published.axis !== expected.axis || published.kind !== expected.kind || published.value !== expected.value || published.attained !== expected.attained) {
      return fail(
        'claim_unverified',
        `the published claim axis "${published.axis}" (${published.kind} ${JSON.stringify(published.value)}, attained ${JSON.stringify(published.attained)}) disagrees with the re-derived claim (${expected.kind} ${JSON.stringify(expected.value)}, attained ${JSON.stringify(expected.attained)}) — a claim that no longer follows from its recipe is not a claim`,
        `claim.axes[${index}]`,
      );
    }
  }

  return ok(deepFreeze({ remeasurement, publication: record, bytes } satisfies ReverificationOutcome));
}
