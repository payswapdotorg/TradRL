/**
 * @tradrl/research-public-evaluation — the PUBLISHED EVALUATION RECORD
 * (Work Order T049): the platform's public evidence format.
 *
 * THE RECORD'S LAWS:
 * - CONTENT-ADDRESSED (`pev:<digest>` over the canonical publication
 *   content — L9): identical publications address identically; a mutated
 *   field breaks the address (verifyPublishedRecord recomputes it).
 * - PROVENANCE-CARRYING (L9): the provenance block binds the suite (id +
 *   digest + evaluator), the split plan (id + digest, when phase-bound),
 *   the material source (id + digest + kind + origin), the search
 *   binding (record + trial, when holdout) and the subject's artifact
 *   ADDRESSES — never the artifacts themselves.
 * - POINT-IN-TIME (L4): `as_of` is BOUND to the cited measurement's
 *   evidence instant (the claim speaks of exactly that instant), and
 *   `published_at` never precedes it (you cannot publish today what was
 *   measured tomorrow — `future_dated`).
 * - TENANT-SCOPED (L12): the record carries its scope; the publication
 *   log refuses foreign records.
 * - CLAIMS ARE DERIVED, NEVER SUPPLIED: the claim block is compiled FROM
 *   the measurement record's axes (the projection law — see gate.ts);
 *   a caller-supplied claim that disagrees is `claim_unverified`.
 * - RE-RUNNABLE (the Work Order's law): the verification block carries
 *   the complete RE-RUN RECIPE — the runner identity, every input's
 *   content address, the expected measurement id and the expected
 *   canonical-bytes digest. reverifyPublishedRecord (reverify.ts)
 *   re-runs the machinery and refuses on ANY byte divergence.
 */

import { canonicalJson, deepFreeze, isRecord, isTimestampMs, stableDigestJson } from './primitives';
import type { JsonObject, JsonValue, TimestampMs } from './primitives';
import { isProjectId, isPublishedRecordId, isTenantId } from './ids';
import type { ProjectId, TenantId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type PublicationError, type PublicationResult } from './errors';
import type { AxisKind, AxisMeasurement, EvidenceClass, MeasurementPhase, MeasurementRecord, SubjectBinding } from './imports';
import { isAxisKind } from './imports';

// ---------------------------------------------------------------------------
// The public claim block
// ---------------------------------------------------------------------------

/** One published claim: a measured axis's value and its attainment judgment (as recorded — never editorialized). */
export interface PublishedClaim {
  readonly axis: string;
  readonly kind: AxisKind;
  /** count: number; decimal: exact string; digest: hex string; flag: boolean. */
  readonly value: string | number | boolean;
  /** The recorded attainment judgment (null = the suite declared no criterion for this axis). */
  readonly attained: boolean | null;
}

/** The claim block's structural shape. */
export type ClaimBlock = { readonly axes: readonly PublishedClaim[]; readonly attained: boolean };

/** Guard: one published claim (the closed kind vocabulary; a primitive value; a judgment or null). */
export function isPublishedClaim(v: unknown): v is PublishedClaim {
  if (!isRecord(v)) return false;
  if (typeof v.axis !== 'string' || (v.axis as string).length === 0) return false;
  if (!isAxisKind(v.kind)) return false;
  if (typeof v.value !== 'string' && typeof v.value !== 'number' && typeof v.value !== 'boolean') return false;
  if (typeof v.value === 'number' && !Number.isFinite(v.value)) return false;
  return v.attained === null || typeof v.attained === 'boolean';
}

/**
 * Guard: the CLAIM BLOCK's structural law — a non-empty, axis-unique list of
 * well-formed published claims plus the attainment fold. The claim is the
 * PUBLIC FACE of the record: a malformed block is `invalid_publication`,
 * never a best-effort read.
 */
export function isPublishedClaimShape(v: unknown): v is ClaimBlock {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.axes) || (v.axes as readonly unknown[]).length === 0) return false;
  const names = new Set<string>();
  for (const claim of v.axes as readonly unknown[]) {
    if (!isPublishedClaim(claim)) return false;
    const name = (claim as PublishedClaim).axis;
    if (names.has(name)) return false;
    names.add(name);
  }
  return typeof v.attained === 'boolean';
}

// ---------------------------------------------------------------------------
// The provenance + recipe blocks
// ---------------------------------------------------------------------------

/** The L9 provenance block: everything the claim binds, by content address. */
export interface PublicationProvenance {
  readonly measurement_id: string;
  readonly suite_id: string;
  readonly suite_name: string;
  readonly suite_digest: string;
  readonly evaluator: string;
  readonly plan: { readonly plan_id: string; readonly plan_digest: string } | null;
  readonly material: { readonly source_id: string; readonly source_digest: string; readonly kind: string; readonly origin: string };
  readonly search: { readonly record_id: string; readonly trial: string } | null;
}

/** The re-verification recipe: the complete input manifest for re-running the measurement. */
export interface ReverificationRecipe {
  /** The runner identity: the exact suite (content-addressed) + its evaluator. */
  readonly runner: { readonly suite_id: string; readonly suite_digest: string; readonly evaluator: string };
  /** The subject binding (artifact addresses + the L9 lineage refs). */
  readonly subject: SubjectBinding;
  /** The material source's id (the source object itself is supplied at re-run). */
  readonly material_source_id: string;
  /** The split plan's id, when the measurement was phase-bound. */
  readonly plan_id: string | null;
  /** The search record's id, when the measurement bound a search. */
  readonly search_record_id: string | null;
  readonly trial: string | null;
  /** The phase the measurement ran under. */
  readonly phase: MeasurementPhase;
  /** The measurement's injected instant — the re-run MUST reuse it (L4 + determinism). */
  readonly measured_at: TimestampMs;
  /** The expected content-addressed measurement id. */
  readonly expected_measurement_id: string;
  /** The expected digest of the measurement record's canonical bytes. */
  readonly expected_measurement_digest: string;
}

// ---------------------------------------------------------------------------
// The published record
// ---------------------------------------------------------------------------

/** The published evaluation record — the public evidence format. */
export interface PublishedEvaluationRecord {
  /** Derived identity: `pev:<digest over the canonical publication content>`. */
  readonly record_id: string;
  readonly suite: { readonly name: string; readonly suite_id: string; readonly subject_kind: string; readonly evidence_class: EvidenceClass };
  /** The public subject: kind + artifact ADDRESSES + the L9 lineage refs (never the artifacts). */
  readonly subject: SubjectBinding;
  /** The derived claims (the measurement's public axes — see gate.ts for the visibility law). */
  readonly claim: { readonly axes: readonly PublishedClaim[]; readonly attained: boolean };
  readonly phase: MeasurementPhase;
  readonly provenance: PublicationProvenance;
  readonly as_of: TimestampMs;
  readonly published_at: TimestampMs;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly verification: ReverificationRecipe;
}

/** The canonical publication JSON (the content-addressing input; no `record_id`). */
export function publicationContentJson(record: Omit<PublishedEvaluationRecord, 'record_id'>): JsonObject {
  return {
    suite: record.suite as unknown as JsonObject,
    subject: record.subject as unknown as JsonObject,
    claim: record.claim as unknown as JsonObject,
    phase: record.phase,
    provenance: record.provenance as unknown as JsonObject,
    as_of: record.as_of,
    published_at: record.published_at,
    tenant: record.tenant,
    project: record.project,
    verification: record.verification as unknown as JsonObject,
  };
}

/** Compute the content address of a publication: `pev:<digest>`. */
export function publishedRecordId(content: Omit<PublishedEvaluationRecord, 'record_id'>): string {
  return `pev:${stableDigestJson(publicationContentJson(content))}`;
}

/** The canonical JSON bytes of a published record (the determinism anchor — program-wide canonical form). */
export function canonicalPublication(record: PublishedEvaluationRecord): string {
  return canonicalJson(record as unknown as JsonValue);
}

// ---------------------------------------------------------------------------
// The record verifier (the L9 content-address law)
// ---------------------------------------------------------------------------

/**
 * VERIFY a published evaluation record: the structural law plus the L9
 * content-address law (the recorded `record_id` must equal the digest of
 * the canonical content AS STORED) plus the L4 binding law (as_of ===
 * the cited measurement's recorded instant). The never-publish scans run
 * in gate.ts; re-running the measurement runs in reverify.ts.
 */
export function verifyPublishedRecord(value: unknown, path = 'publication'): PublicationResult<PublishedEvaluationRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: PublicationError[] = [];
  if (value.record_id === undefined) errors.push(missingField(`${path}.record_id`));
  else if (!isPublishedRecordId(value.record_id)) errors.push(invalidField(`${path}.record_id`, 'must be a published record id ("pev:<digest>")'));
  if (!isRecord(value.suite) || typeof value.suite?.name !== 'string' || typeof value.suite?.suite_id !== 'string') {
    errors.push(invalidField(`${path}.suite`, 'must carry name and suite_id'));
  }
  if (!isRecord(value.subject)) {
    errors.push(invalidField(`${path}.subject`, 'must be the public subject binding'));
  }
  if (!isPublishedClaimShape(value.claim)) {
    errors.push(invalidField(`${path}.claim`, 'must be the claim block: a non-empty, axis-unique list of well-formed published claims plus the attainment fold'));
  }
  if (value.phase !== 'in-search' && value.phase !== 'holdout') {
    errors.push(invalidField(`${path}.phase`, "must be 'in-search' or 'holdout'"));
  }
  if (!isRecord(value.provenance) || typeof value.provenance?.measurement_id !== 'string') {
    errors.push(invalidField(`${path}.provenance`, 'must carry measurement_id'));
  }
  if (value.as_of === undefined || !isTimestampMs(value.as_of)) {
    errors.push(invalidField(`${path}.as_of`, 'must be a valid TimestampMs (L4)'));
  }
  if (value.published_at === undefined || !isTimestampMs(value.published_at)) {
    errors.push(invalidField(`${path}.published_at`, 'must be a valid TimestampMs (L4)'));
  }
  if (value.tenant === undefined || !isTenantId(value.tenant)) {
    errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));
  }
  if (value.project === undefined || !isProjectId(value.project)) {
    errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));
  }
  if (!isRecord(value.verification) || typeof value.verification?.expected_measurement_id !== 'string') {
    errors.push(invalidField(`${path}.verification`, 'must be the re-verification recipe'));
  }
  if (errors.length > 0) return { ok: false, errors };

  const record = value as unknown as PublishedEvaluationRecord;
  // The L4 binding law: the claim's as-of instant IS the cited measurement's
  // evidence instant — the recipe pins the same instant, so the two can never
  // disagree in a lawful record (a divergent pair is `as_of_mismatch`).
  if (record.as_of !== record.verification.measured_at) {
    return fail(
      'as_of_mismatch',
      `the claim's as-of instant ${record.as_of} is not the cited measurement's evidence instant ${record.verification.measured_at} — a point-in-time claim speaks of exactly the instant its evidence was measured (L4)`,
      `${path}.as_of`,
    );
  }
  if (record.published_at < record.as_of) {
    return fail(
      'future_dated',
      `publication instant ${record.published_at} precedes the claim's as-of instant ${record.as_of} — you cannot publish today what was measured tomorrow (L4)`,
      `${path}.published_at`,
    );
  }
  const { record_id: _drop, ...content } = record;
  const derivedId = publishedRecordId(content as Omit<PublishedEvaluationRecord, 'record_id'>);
  if (record.record_id !== derivedId) {
    return fail(
      'publication_mismatch',
      `record id "${record.record_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`,
      `${path}.record_id`,
    );
  }
  return ok(deepFreeze({ ...record } satisfies PublishedEvaluationRecord));
}

/** Derive the public claim block from a measurement record's axes (the projection helper — gate.ts owns the laws). */
export function claimsFromMeasurement(measurement: MeasurementRecord, publicAxes: readonly string[]): readonly PublishedClaim[] {
  const allowed = new Set(publicAxes);
  return measurement.axes
    .filter((axis) => allowed.has(axis.axis))
    .map((axis) => ({ axis: axis.axis, kind: axis.kind, value: axis.value, attained: axis.attained }));
}

/** The claim key of a publication: (suite name, subject artifact digest, as_of) — the L11 immutability key. */
export function publicationClaimKey(record: Pick<PublishedEvaluationRecord, 'suite' | 'subject' | 'as_of'>): string {
  const artifact = record.subject.artifacts[0]?.digest ?? '';
  return `${record.suite.name}:${artifact}:${record.as_of}`;
}
