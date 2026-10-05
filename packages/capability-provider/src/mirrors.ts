// @tradrl/capability-provider — the STRUCTURAL MIRRORS of the consumed
// lanes (D-003/D-004 law: this package NEVER imports them at runtime;
// src/interop.test.ts loads the REAL packages statically and pins every
// mirror member-for-member — drift is a loud test failure).
//
//   - T017 (packages/skills + services/body-forge) — THE CAPABILITY/
//     SKILL LANGUAGE this interface speaks: the MEASURED-evidence union
//     (benchmark | measurement-record | result-ref — a capability claim
//     is NEVER a profession label, L16a), the L16a label trip-wire
//     vocabulary, the typed capability-gap mirror (the request cites the
//     gaps that commissioned it), the skill applicability scope, the
//     skill origin vocabulary (`imported-artifact` is the L18
//     local-import path this lane feeds), and the extraction-version
//     reference space.
//   - T041 (packages/sdk + services/api) — THE API SURFACE this
//     interface integrates with: the async job pattern (submitted/
//     running/complete/failed — provider request envelopes ride the
//     public jobs routes as opaque specs), the page shape, the
//     idempotency-key derivation ('idem:' + FNV-1a of canonical parts —
//     the same derivation the SDK ships), and the SDK error-family
//     vocabulary (the boundary projection of this lane's typed errors).

import { canonicalJson, fnv1a32Hex, isMemberOf, isNonEmptyString, isRecord } from './primitives';
import type { JsonValue } from './primitives';
import type {
  CapabilityKey,
  CapabilityGapId,
  AttainmentEvidenceRef,
  EnvironmentProfileRef,
  InstrumentClassRef,
} from './ids';
import {
  isCapabilityGapId,
  isCapabilityKey,
  isAttainmentEvidenceRef,
  isEnvironmentProfileRef,
  isInstrumentClassRef,
} from './ids';

// ---------------------------------------------------------------------------
// T017 mirrors — the capability/skill language (packages/skills)
// ---------------------------------------------------------------------------

/**
 * The closed L16a trip-wire vocabulary: the field names that make a
 * record cite a PROFESSION/ROLE LABEL — STRUCTURAL MIRROR of
 * @tradrl/skills' `LABEL_EVIDENCE_KEYS` (same seven keys, same law). A
 * provider record (or any nested object within it) carrying one of
 * these keys fails validation with `label_as_evidence`:
 * `model -> mathematician` is not an evidence-backed architectural
 * rule, and neither is `provider -> quant` (spec/CAPABILITY-DISCOVERY.md
 * "Never equate model and profession"; L19 — no professional
 * qualification inference).
 */
export const LABEL_EVIDENCE_KEYS_MIRROR = [
  'label',
  'roleLabel',
  'profession',
  'role',
  'title',
  'jobTitle',
  'vocation',
] as const;

/** A label-suspect field name (mirror). */
export type LabelEvidenceKeyMirror = (typeof LABEL_EVIDENCE_KEYS_MIRROR)[number];

/** Guard: `LabelEvidenceKeyMirror`. */
export function isLabelEvidenceKeyMirror(v: unknown): v is LabelEvidenceKeyMirror {
  return isMemberOf(LABEL_EVIDENCE_KEYS_MIRROR, v);
}

/**
 * Walks a JSON value and returns the dotted paths of every object key
 * in {@link LABEL_EVIDENCE_KEYS_MIRROR} it finds (breadth-limited to
 * JSON data). Pure; used by every guard and validator in this lane to
 * make label smuggling a machine-detected typed violation.
 */
export function labelKeyPaths(value: unknown, prefix = ''): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const path of labelKeyPaths(item, `${prefix}[${index}]`)) found.push(path);
    });
    return found;
  }
  if (!isRecord(value)) return found;
  for (const key of Object.keys(value)) {
    if (isLabelEvidenceKeyMirror(key)) found.push(prefix === '' ? key : `${prefix}.${key}`);
    for (const path of labelKeyPaths(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return found;
}

/** The closed measured-evidence kind vocabulary — mirror of the skills lane's `CAPABILITY_EVIDENCE_KINDS`. */
export const CAPABILITY_EVIDENCE_KINDS_MIRROR = [
  'benchmark',
  'measurement-record',
  'result-ref',
] as const;

/** One kind of measured evidence (mirror). */
export type CapabilityEvidenceKindMirror = (typeof CAPABILITY_EVIDENCE_KINDS_MIRROR)[number];

/** Guard: `CapabilityEvidenceKindMirror`. */
export function isCapabilityEvidenceKindMirror(v: unknown): v is CapabilityEvidenceKindMirror {
  return isMemberOf(CAPABILITY_EVIDENCE_KINDS_MIRROR, v);
}

/** The closed structured-metric vocabulary — mirror of the skills lane's `MEASUREMENT_METRICS`. */
export const MEASUREMENT_METRICS_MIRROR = [
  'benchmark-score',
  'p50-latency-ms',
  'p95-latency-ms',
  'compute-units',
] as const;

/** One structured measurement metric (mirror). */
export type MeasurementMetricMirror = (typeof MEASUREMENT_METRICS_MIRROR)[number];

/** Guard: `MeasurementMetricMirror`. */
export function isMeasurementMetricMirror(v: unknown): v is MeasurementMetricMirror {
  return isMemberOf(MEASUREMENT_METRICS_MIRROR, v);
}

/**
 * Benchmark evidence: a named benchmark run plus its opaque result
 * reference — STRUCTURAL MIRROR of @tradrl/skills' `BenchmarkEvidence`
 * (field-for-field, no import).
 */
export interface BenchmarkEvidenceMirror {
  readonly kind: 'benchmark';
  /** Opaque benchmark-suite identity (the benchmark lane owns the referent). */
  readonly benchmarkId: string;
  /** Opaque reference to the recorded result of running the benchmark. */
  readonly resultRef: string;
}

/**
 * A structured measurement record reference with its metric and value —
 * STRUCTURAL MIRROR of the skills lane's `MeasurementRecordEvidence`.
 */
export interface MeasurementRecordEvidenceMirror {
  readonly kind: 'measurement-record';
  /** Opaque reference to the full measurement record (environment, config). */
  readonly recordRef: string;
  /** Which structured metric the value carries. */
  readonly metric: MeasurementMetricMirror;
  /** The measured value (finite; interpretation is the reader's). */
  readonly value: number;
}

/**
 * An opaque result reference (raw evidence capsule, no structured
 * metric) — STRUCTURAL MIRROR of the skills lane's `ResultRefEvidence`.
 */
export interface ResultRefEvidenceMirror {
  readonly kind: 'result-ref';
  /** Opaque reference to the result capsule. */
  readonly resultRef: string;
}

/**
 * One piece of MEASURED evidence backing a capability claim — mirror of
 * the skills lane's `MeasuredEvidence` closed union. There is
 * deliberately NO label/profession member: L16a makes the illegal state
 * unrepresentable in valid records.
 */
export type MeasuredEvidenceMirror =
  | BenchmarkEvidenceMirror
  | MeasurementRecordEvidenceMirror
  | ResultRefEvidenceMirror;

/** Guard: `MeasuredEvidenceMirror` — total over the closed union (mirror). */
export function isMeasuredEvidenceMirror(v: unknown): v is MeasuredEvidenceMirror {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'benchmark':
      return isNonEmptyString(v.benchmarkId) && isNonEmptyString(v.resultRef);
    case 'measurement-record':
      return (
        isNonEmptyString(v.recordRef) &&
        isMeasurementMetricMirror(v.metric) &&
        typeof v.value === 'number' &&
        Number.isFinite(v.value)
      );
    case 'result-ref':
      return isNonEmptyString(v.resultRef);
    default:
      return false;
  }
}

/**
 * The skill origin vocabulary — mirror of the skills lane's
 * `SKILL_ORIGINS`. `imported-artifact` is the L18 local-import path
 * THIS lane feeds: a verified provider capability artifact becomes an
 * ordinary validated SkillRecord with that origin (spec/LEARNING-LOOP.md
 * "Human augmentation": artifact -> local import -> local evaluation).
 */
export const SKILL_ORIGINS_MIRROR = ['recorded-experience', 'imported-artifact'] as const;

/** One skill origin (mirror). */
export type SkillOriginMirror = (typeof SKILL_ORIGINS_MIRROR)[number];

/** Guard: `SkillOriginMirror`. */
export function isSkillOriginMirror(v: unknown): v is SkillOriginMirror {
  return isMemberOf(SKILL_ORIGINS_MIRROR, v);
}

/**
 * Where a skill applies: environments and instrument classes, as OPAQUE
 * references — STRUCTURAL MIRROR of the skills lane's
 * `SkillApplicability`. Both may be empty — an empty applicability
 * block means "no declared scope restriction", never "invented scope".
 */
export interface SkillApplicabilityMirror {
  /** Opaque environment-profile references the capability was validated under. */
  readonly environmentProfileRefs: readonly EnvironmentProfileRef[];
  /** Opaque instrument-class references the capability applies to. */
  readonly instrumentClassRefs: readonly InstrumentClassRef[];
}

/** Guard: `SkillApplicabilityMirror`. */
export function isSkillApplicabilityMirror(v: unknown): v is SkillApplicabilityMirror {
  if (!isRecord(v)) return false;
  return (
    Array.isArray(v.environmentProfileRefs) &&
    v.environmentProfileRefs.every(isEnvironmentProfileRef) &&
    Array.isArray(v.instrumentClassRefs) &&
    v.instrumentClassRefs.every(isInstrumentClassRef)
  );
}

/**
 * One typed capability gap — STRUCTURAL MIRROR of @tradrl/skills'
 * `CapabilityGapMirror` (which itself mirrors the organization lane's
 * `CapabilityGap`): field-for-field with the same brand tags, so a REAL
 * T017 gap record IS this lane's gap record (mutually assignable — the
 * compile-time trip wire) and satisfies this guard (the runtime trip
 * wire). The gap is the commissioning evidence of a capability request:
 * "persistent gap -> optional expertise request" (spec/LEARNING-LOOP.md
 * "Human augmentation").
 */
export interface CapabilityGapMirror {
  /** Gap identity (unique within the commissioning gap list). */
  readonly gapId: CapabilityGapId;
  /** The failure class (closed six-kind vocabulary). */
  readonly kind: CapabilityGapKindMirror;
  /** The capability contract whose absence the failure evidences (never a profession label — L16a). */
  readonly capabilityKey: CapabilityKey;
  /** Opaque reference to the failure evidence that detected the deficit. */
  readonly evidenceRef: AttainmentEvidenceRef;
  /** Explicit detection instant (epoch ms — carried, never read from a clock). */
  readonly detectedAt: number;
  /** Owning tenant (L12 — plain string, mirroring the organization lane's exact field type). */
  readonly tenantId: string;
  /** Owning project (L12 — plain string, mirroring the organization lane's exact field type). */
  readonly projectId: string;
}

/** The closed failure-class vocabulary — mirror of the skills lane's `CAPABILITY_GAP_KINDS`. */
export const CAPABILITY_GAP_KINDS_MIRROR = [
  'regime',
  'sentiment-event',
  'liquidity',
  'execution',
  'risk',
  'coordination',
] as const;

/** One failure class (LEARNING-LOOP, verbatim — mirror). */
export type CapabilityGapKindMirror = (typeof CAPABILITY_GAP_KINDS_MIRROR)[number];

/** Guard: `CapabilityGapKindMirror`. */
export function isCapabilityGapKindMirror(v: unknown): v is CapabilityGapKindMirror {
  return isMemberOf(CAPABILITY_GAP_KINDS_MIRROR, v);
}

/** Guard: `CapabilityGapMirror` (total, hand-rolled; mirrors the skills guard). */
export function isCapabilityGapMirror(v: unknown): v is CapabilityGapMirror {
  if (!isRecord(v)) return false;
  return (
    isCapabilityGapId(v.gapId) &&
    isCapabilityGapKindMirror(v.kind) &&
    isCapabilityKey(v.capabilityKey) &&
    isAttainmentEvidenceRef(v.evidenceRef) &&
    typeof v.detectedAt === 'number' &&
    Number.isInteger(v.detectedAt) &&
    isNonEmptyString(v.tenantId) &&
    isNonEmptyString(v.projectId)
  );
}

// ---------------------------------------------------------------------------
// T041 mirrors — the API/SDK surface (packages/sdk + services/api)
// ---------------------------------------------------------------------------

/** The job kinds — mirror of the SDK's `JobKind` (`'research' | 'learning'`). */
export const JOB_KINDS_MIRROR = ['research', 'learning'] as const;

/** One job kind (mirror). */
export type JobKindMirror = (typeof JOB_KINDS_MIRROR)[number];

/** Guard: `JobKindMirror`. */
export function isJobKindMirror(v: unknown): v is JobKindMirror {
  return isMemberOf(JOB_KINDS_MIRROR, v);
}

/** The job statuses (the async pattern's states) — mirror of the SDK's `JobStatus`. */
export const JOB_STATUSES_MIRROR = ['submitted', 'running', 'complete', 'failed'] as const;

/** One job status (mirror). */
export type JobStatusMirror = (typeof JOB_STATUSES_MIRROR)[number];

/** Guard: `JobStatusMirror`. */
export function isJobStatusMirror(v: unknown): v is JobStatusMirror {
  return isMemberOf(JOB_STATUSES_MIRROR, v);
}

/**
 * The job record as the API serves it — STRUCTURAL MIRROR of the SDK's
 * `JobRecord` (field-for-field). Provider request envelopes ride the
 * public `POST /v1/jobs/research` route as the job's OPAQUE `spec`
 * (the jobs machinery owns execution semantics; this lane owns the
 * spec's contract — see localize.ts).
 */
export interface JobRecordMirror {
  readonly jobId: string;
  readonly kind: JobKindMirror;
  readonly tenant: string;
  readonly project: string;
  readonly status: JobStatusMirror;
  readonly submittedAt: number;
  readonly result?: unknown;
  readonly completedAt?: number;
}

/** Guard: `JobRecordMirror` (structural). */
export function isJobRecordMirror(v: unknown): v is JobRecordMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.jobId) || !isJobKindMirror(v.kind)) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  if (!isJobStatusMirror(v.status)) return false;
  if (typeof v.submittedAt !== 'number' || !Number.isInteger(v.submittedAt)) return false;
  if (v.completedAt !== undefined && (typeof v.completedAt !== 'number' || !Number.isInteger(v.completedAt))) return false;
  return true;
}

/** One page of a listing — mirror of the SDK's `Page`. */
export interface PageMirror<T> {
  readonly items: readonly T[];
  /** The next page's cursor; absent on the last page. */
  readonly nextCursor?: string;
}

/** The SDK error families — mirror of the SDK's `SDK_ERROR_FAMILIES` (the boundary projection vocabulary). */
export const SDK_ERROR_FAMILIES_MIRROR = [
  'auth',
  'permission',
  'tenant',
  'rate-limit',
  'validation',
  'conflict',
  'unavailable',
  'not-found',
  'version',
] as const;

/** One SDK error family (mirror). */
export type SdkErrorFamilyMirror = (typeof SDK_ERROR_FAMILIES_MIRROR)[number];

/** Guard: `SdkErrorFamilyMirror`. */
export function isSdkErrorFamilyMirror(v: unknown): v is SdkErrorFamilyMirror {
  return isMemberOf(SDK_ERROR_FAMILIES_MIRROR, v);
}

/** The idempotency-key grammar — mirror of the SDK's `IDEMPOTENCY_KEY_PATTERN` (`idem:` + 8-hex digest). */
export const IDEMPOTENCY_KEY_PATTERN_MIRROR = /^idem:[0-9a-f]{8}$/;

/** The wire-header law — mirror of the SDK's `isValidIdempotencyKey` (opaque non-empty, <= 256 chars). */
export function isValidIdempotencyKeyMirror(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 256;
}

/**
 * The DETERMINISTIC idempotency-key derivation — STRUCTURAL MIRROR of
 * the SDK's `deriveIdempotencyKey`: 'idem:' + FNV-1a of the canonical
 * JSON of the parts. Identical parts derive identical keys (L9); the
 * caller chooses operation-unique parts. Provider exchanges derive
 * their API-boundary idempotency keys with THIS function so a provider
 * request submitted through the jobs route retries safely (the same
 * envelope, the same key — never a double submission). The interop
 * test pins byte-parity with the REAL SDK derivation.
 */
export function deriveIdempotencyKeyMirror(parts: unknown): string {
  return `idem:${fnv1a32Hex(canonicalJson(parts))}`;
}

/** JSON-value alias for mirror consumers. */
export type MirrorJsonValue = JsonValue;
