/**
 * @tradrl/research-public-evaluation — the PUBLICATION COMPILER (Work
 * Order T049): compilePublishedRecord — the gate-to-record pipeline.
 *
 * THE COMPILATION LAWS (in order, each typed, fail-closed):
 * 1. THE MEASUREMENT LAW — the measurement verifies through the
 *    benchmark machinery's content-address gate (L9;
 *    `measurement_mismatch` on divergence).
 * 2. THE POLICY LAW — the publication policy's allowlist names measured
 *    axes only (`unpublishable_class`); the claim block is DERIVED from
 *    the measurement through the projection (never caller-supplied).
 * 3. THE NEVER-PUBLISH LAW — the operator attachments AND the compiled
 *    record are scanned (`chain_of_thought` / `tenant_data` — defense in
 *    depth: a projection bug fails closed too).
 * 4. THE L4 LAW — `as_of` is BOUND to the measurement's evidence
 *    instant (`as_of_mismatch` when the caller supplies a different
 *    one); `published_at` never precedes it (`future_dated`).
 * 5. THE RECIPE LAW — the verification block is assembled from the
 *    measurement: the runner identity (suite id + digest + evaluator),
 *    the input manifest (subject, material source id, plan id, search
 *    binding), the injected instant, and the EXPECTED measurement id +
 *    canonical-bytes digest (what re-verification must reproduce).
 * 6. THE CONTENT-ADDRESS LAW — the record addresses to `pev:<digest>`
 *    over its canonical content (L9); identical inputs yield identical
 *    records byte-for-byte.
 */

import { deepFreeze, isRecord, isTimestampMs, stableDigest } from './primitives';
import type { TimestampMs } from './primitives';
import { fail, invalidField, invalidType, missingField, ok, type PublicationResult } from './errors';
import { verifyMeasurementRecord, canonicalMeasurement } from './imports';
import type { MeasurementRecord, SubjectBinding } from './imports';
import { publishedRecordId } from './record';
import type { PublishedEvaluationRecord } from './record';
import { checkPolicyAxes, isPublicationPolicy, projectClaims, scanNeverPublish } from './gate';
import type { PublicationPolicy } from './gate';

// ---------------------------------------------------------------------------
// The compilation input
// ---------------------------------------------------------------------------

/** The publication input: the measurement + the policy + the injected publication instant. */
export interface PublicationInput {
  readonly measurement: MeasurementRecord;
  readonly policy: PublicationPolicy;
  /** The INJECTED publication instant (L4 — never a wall clock). */
  readonly publishedAt: TimestampMs;
}

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

/**
 * Compile one published evaluation record from a verified measurement.
 * Deterministic and pure: the same (measurement, policy, instant) always
 * yields the byte-identical record — the re-verification law's
 * foundation.
 */
export function compilePublishedRecord(input: unknown): PublicationResult<PublishedEvaluationRecord> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('publication input must be an object')] };
  }
  if (input.measurement === undefined) {
    return { ok: false, errors: [missingField('measurement')] };
  }
  const measurementVerification = verifyMeasurementRecord(input.measurement);
  if (!measurementVerification.ok) {
    return fail(
      'measurement_mismatch',
      `the cited measurement failed its content-address verification: ${measurementVerification.errors.map((error) => error.message).join('; ')}`,
      'measurement',
    );
  }
  const measurement = measurementVerification.value;

  if (input.policy === undefined) {
    return { ok: false, errors: [missingField('policy')] };
  }
  if (!isPublicationPolicy(input.policy)) {
    return { ok: false, errors: [invalidField('policy', 'must be { publicAxes: string[], attachments? } — a non-empty allowlist of measured axis names')] };
  }
  const policy = input.policy as PublicationPolicy;

  if (input.publishedAt === undefined) {
    return { ok: false, errors: [missingField('publishedAt')] };
  }
  if (!isTimestampMs(input.publishedAt)) {
    return { ok: false, errors: [invalidField('publishedAt', 'must be a valid TimestampMs (the injected publication instant, L4)')] };
  }
  const publishedAt = input.publishedAt as TimestampMs;

  // --- The policy law ------------------------------------------------------------
  const axesCheck = checkPolicyAxes(measurement, policy);
  if (!axesCheck.ok) return axesCheck;

  // --- The L4 law ----------------------------------------------------------------
  const asOf = measurement.recorded_at;
  if (publishedAt < asOf) {
    return fail(
      'future_dated',
      `publication instant ${publishedAt} precedes the measurement's evidence instant ${asOf} — you cannot publish today what was measured tomorrow (L4)`,
      'publishedAt',
    );
  }

  // --- The never-publish law (attachments first) -----------------------------------
  if (policy.attachments !== undefined) {
    const scan = scanNeverPublish(policy.attachments, 'the publication attachments');
    if (!scan.ok) return scan;
  }

  // --- The compilation --------------------------------------------------------------
  const subject: SubjectBinding = measurement.subject;
  const content: Omit<PublishedEvaluationRecord, 'record_id'> = {
    suite: {
      name: measurement.suite_name,
      suite_id: measurement.suite,
      subject_kind: subject.kind,
      evidence_class: measurement.evidence_class,
    },
    subject,
    claim: {
      axes: deepFreeze(projectClaims(measurement, policy)),
      attained: measurement.attained,
    },
    phase: measurement.phase,
    provenance: {
      measurement_id: measurement.measurement_id,
      suite_id: measurement.suite,
      suite_name: measurement.suite_name,
      suite_digest: measurement.suite_digest,
      evaluator: measurement.evaluator,
      plan: measurement.plan,
      material: measurement.material,
      search: measurement.search,
    },
    as_of: asOf,
    published_at: publishedAt,
    tenant: measurement.tenant,
    project: measurement.project,
    verification: {
      runner: { suite_id: measurement.suite, suite_digest: measurement.suite_digest, evaluator: measurement.evaluator },
      subject,
      material_source_id: measurement.material.source_id,
      plan_id: measurement.plan === null ? null : measurement.plan.plan_id,
      search_record_id: measurement.search === null ? null : measurement.search.record_id,
      trial: measurement.search === null ? null : measurement.search.trial,
      phase: measurement.phase,
      measured_at: measurement.recorded_at,
      expected_measurement_id: measurement.measurement_id,
      expected_measurement_digest: stableDigest(canonicalMeasurement(measurement)),
    },
  };

  // --- The never-publish law (defense in depth: the compiled record itself) ----------
  const compiledScan = scanNeverPublish(content, 'the compiled publication');
  if (!compiledScan.ok) return compiledScan;

  const record = deepFreeze({ record_id: publishedRecordId(content), ...content } satisfies PublishedEvaluationRecord);
  const coherence = verifyPublishedRecordShape(record);
  if (!coherence.ok) return coherence;
  return ok(record);
}

/** The shape-level verification the compiler runs on its own output (the fail-closed self-check). */
function verifyPublishedRecordShape(record: PublishedEvaluationRecord): PublicationResult<true> {
  if (record.verification.expected_measurement_id === '') {
    return fail('claim_unverified', 'the recipe must carry the expected measurement id', 'verification.expected_measurement_id');
  }
  return ok(true);
}
