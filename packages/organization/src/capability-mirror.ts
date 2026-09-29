/**
 * @tradrl/organization — substrate capability registry mirrors.
 *
 * STRUCTURAL MIRRORS of @tradrl/agent-body's capability-registry module
 * (T016's own absorbed module, per program decisions D-006/D-007) — DO NOT
 * DIVERGE IN SHAPE. The frozen workspace lockfile forbids a package
 * dependency between contract packages, so this module re-declares the
 * registry contracts by STRUCTURE (never by import). The brand tags
 * (`CapabilityKey`, `CapabilityRecordId`, `RegistryDigest`) match the
 * registry module's string-keyed declarations, so these mirrors are
 * mutually assignable at compile time; the runtime trip wires in
 * interop.test.ts feed REAL registry records through these guards and
 * prove the digest parity (`registrySnapshotDigestMirror` === the
 * registry's `registryDigestOf`).
 *
 * This is the evidence base the organization search runs over. Every law of
 * the registry module applies here unchanged, above all L16a — VERBATIM:
 * "organization search may discover missing capabilities and candidate
 * Body/Substrate assignments from evidence; labels alone never establish
 * suitability." The organization-side validation
 * (`validateRegistrySnapshotMirror`) re-enforces the label trip-wire with
 * this package's TYPED error taxonomy (`label_as_evidence`).
 *
 * Spec anchors: spec/CAPABILITY-DISCOVERY.md (the discovery loop, "Never
 * equate model and profession", Reproducibility); spec/ARCHITECTURE-LOCK.md
 * L16a, L9 (snapshot digest binds lineage), L2 (body != model).
 */

import {
  type CapabilityKey,
  type CapabilityRecordId,
  type JsonValue,
  type RegistryDigest,
  canonicalJson,
  deepFreeze,
  isArrayOf,
  isCapabilityKey,
  isCapabilityRecordId,
  isDigest,
  isFiniteNumber,
  isNonEmptyString,
  isRecord,
  stableDigest,
} from './primitives';
import { type OrgError, type OrgResult, fail, invalidField, invalidType } from './errors';

// ---------------------------------------------------------------------------
// Closed vocabularies (mirrors of the registry module's)
// ---------------------------------------------------------------------------

/** The closed measured-evidence kind vocabulary (mirror). */
export const CAPABILITY_EVIDENCE_KINDS_MIRROR: readonly string[] = [
  'benchmark',
  'measurement-record',
  'result-ref',
] as const;

/** One measured-evidence kind (mirror). */
export type CapabilityEvidenceKindMirror = (typeof CAPABILITY_EVIDENCE_KINDS_MIRROR)[number];

/** Guard: `CapabilityEvidenceKindMirror`. */
export function isCapabilityEvidenceKindMirror(v: unknown): v is CapabilityEvidenceKindMirror {
  return (
    typeof v === 'string' &&
    (CAPABILITY_EVIDENCE_KINDS_MIRROR as readonly string[]).includes(v)
  );
}

/** The closed structured-metric vocabulary (mirror). */
export const MEASUREMENT_METRICS_MIRROR: readonly string[] = [
  'benchmark-score',
  'p50-latency-ms',
  'p95-latency-ms',
  'compute-units',
] as const;

/** One structured measurement metric (mirror). */
export type MeasurementMetricMirror = (typeof MEASUREMENT_METRICS_MIRROR)[number];

/** Guard: `MeasurementMetricMirror`. */
export function isMeasurementMetricMirror(v: unknown): v is MeasurementMetricMirror {
  return (
    typeof v === 'string' && (MEASUREMENT_METRICS_MIRROR as readonly string[]).includes(v)
  );
}

/**
 * The closed label-key vocabulary (mirror of the registry's
 * `LABEL_EVIDENCE_KEYS`): a record carrying any of these field names cites
 * a profession/role LABEL — `label_as_evidence` (L16a).
 */
export const LABEL_EVIDENCE_KEYS_MIRROR: readonly string[] = [
  'label',
  'roleLabel',
  'profession',
  'role',
  'title',
  'jobTitle',
  'vocation',
] as const;

/**
 * Walks a JSON value and returns the dotted paths of every object key in
 * {@link LABEL_EVIDENCE_KEYS_MIRROR} (mirror of the registry's
 * `labelKeyPaths`; used by this package's typed validators).
 */
export function labelKeyPathsMirror(value: unknown, prefix = ''): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const path of labelKeyPathsMirror(item, `${prefix}[${index}]`)) found.push(path);
    });
    return found;
  }
  if (!isRecord(value)) return found;
  for (const key of Object.keys(value)) {
    if ((LABEL_EVIDENCE_KEYS_MIRROR as readonly string[]).includes(key)) {
      found.push(prefix === '' ? key : `${prefix}.${key}`);
    }
    for (const path of labelKeyPathsMirror(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Evidence, descriptors, subjects, records (mirrors)
// ---------------------------------------------------------------------------

/** Benchmark evidence — mirror of the registry's `BenchmarkEvidence`. */
export interface BenchmarkEvidenceMirror {
  readonly kind: 'benchmark';
  readonly benchmarkId: string;
  readonly resultRef: string;
}

/** Structured measurement evidence — mirror of `MeasurementRecordEvidence`. */
export interface MeasurementRecordEvidenceMirror {
  readonly kind: 'measurement-record';
  readonly recordRef: string;
  readonly metric: MeasurementMetricMirror;
  readonly value: number;
}

/** Opaque result-reference evidence — mirror of `ResultRefEvidence`. */
export interface ResultRefEvidenceMirror {
  readonly kind: 'result-ref';
  readonly resultRef: string;
}

/**
 * One piece of MEASURED evidence — mirror of the registry's
 * `MeasuredEvidence` closed union. There is no label member: L16a makes
 * the illegal state unrepresentable.
 */
export type MeasuredEvidenceMirror =
  | BenchmarkEvidenceMirror
  | MeasurementRecordEvidenceMirror
  | ResultRefEvidenceMirror;

/** Guard: `MeasuredEvidenceMirror` (total over the closed union). */
export function isMeasuredEvidenceMirror(v: unknown): v is MeasuredEvidenceMirror {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'benchmark':
      return isNonEmptyString(v.benchmarkId) && isNonEmptyString(v.resultRef);
    case 'measurement-record':
      return (
        isNonEmptyString(v.recordRef) &&
        isMeasurementMetricMirror(v.metric) &&
        isFiniteNumber(v.value)
      );
    case 'result-ref':
      return isNonEmptyString(v.resultRef);
    default:
      return false;
  }
}

/**
 * One capability claim with its measured evidence — mirror of the
 * registry's `CapabilityDescriptor`. Evidence is NON-EMPTY: a bare claim
 * is a label in disguise (L16a).
 */
export interface CapabilityDescriptorMirror {
  readonly capability: CapabilityKey;
  readonly evidence: readonly MeasuredEvidenceMirror[];
}

/** Guard: `CapabilityDescriptorMirror`. */
export function isCapabilityDescriptorMirror(v: unknown): v is CapabilityDescriptorMirror {
  if (!isRecord(v)) return false;
  if (!isCapabilityKey(v.capability)) return false;
  if (!Array.isArray(v.evidence) || v.evidence.length === 0) return false;
  return isArrayOf(v.evidence, isMeasuredEvidenceMirror);
}

/** The closed registry-subject-kind vocabulary (mirror). */
export const REGISTRY_SUBJECT_KINDS_MIRROR: readonly string[] = [
  'body-version',
  'cognitive-substrate',
] as const;

/** One registry subject kind (mirror). */
export type RegistrySubjectKindMirror = (typeof REGISTRY_SUBJECT_KINDS_MIRROR)[number];

/** Guard: `RegistrySubjectKindMirror`. */
export function isRegistrySubjectKindMirror(v: unknown): v is RegistrySubjectKindMirror {
  return (
    typeof v === 'string' &&
    (REGISTRY_SUBJECT_KINDS_MIRROR as readonly string[]).includes(v)
  );
}

const BODY_VERSION_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SUBSTRATE_REF_PATTERN = /^[^\s/@]{1,128}\/[^\s/@]{1,128}@[^\s/@]{1,128}$/;

/** `true` when `v` is a structurally canonical `${bodyId}@${semver}` reference (mirror). */
export function isCanonicalBodyVersionRefMirror(v: unknown): v is string {
  return typeof v === 'string' && BODY_VERSION_REF_PATTERN.test(v);
}

/** `true` when `v` is a structurally canonical `provider/modelId@modelVersion` reference (mirror). */
export function isCanonicalSubstrateRefMirror(v: unknown): v is string {
  return typeof v === 'string' && SUBSTRATE_REF_PATTERN.test(v);
}

/**
 * The subject of a capability record — mirror of the registry's
 * `RegistrySubject` closed union (L2: a record is about a BodyVersion OR a
 * CognitiveSubstrate, never a fused role/model pairing).
 */
export type RegistrySubjectMirror =
  | { readonly kind: 'body-version'; readonly bodyVersionRef: string }
  | { readonly kind: 'cognitive-substrate'; readonly substrateRef: string };

/** Guard: `RegistrySubjectMirror`. */
export function isRegistrySubjectMirror(v: unknown): v is RegistrySubjectMirror {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'body-version':
      return isCanonicalBodyVersionRefMirror(v.bodyVersionRef);
    case 'cognitive-substrate':
      return isCanonicalSubstrateRefMirror(v.substrateRef);
    default:
      return false;
  }
}

/**
 * One capability record — mirror of the registry's `CapabilityRecord`.
 * NO execution authority of any kind is representable here
 * (spec/CAPABILITY-DISCOVERY.md Safety).
 */
export interface CapabilityRecordMirror {
  readonly recordId: CapabilityRecordId;
  readonly subject: RegistrySubjectMirror;
  readonly descriptors: readonly CapabilityDescriptorMirror[];
  readonly compatibilityRefs: readonly string[];
}

/**
 * Guard: `CapabilityRecordMirror` — structural totality INCLUDING the L16a
 * label scan (a record carrying any label key anywhere in its JSON tree
 * fails the guard).
 */
export function isCapabilityRecordMirror(v: unknown): v is CapabilityRecordMirror {
  if (!isRecord(v)) return false;
  if (!isCapabilityRecordId(v.recordId)) return false;
  if (!isRegistrySubjectMirror(v.subject)) return false;
  if (!Array.isArray(v.descriptors) || v.descriptors.length === 0) return false;
  if (!isArrayOf(v.descriptors, isCapabilityDescriptorMirror)) return false;
  const seen = new Set<string>();
  for (const descriptor of v.descriptors) {
    if (seen.has(descriptor.capability)) return false; // unique capability keys
    seen.add(descriptor.capability);
  }
  if (!isArrayOf(v.compatibilityRefs, isNonEmptyString)) return false;
  if (labelKeyPathsMirror(v).length > 0) return false; // L16a: no label keys
  return true;
}

// ---------------------------------------------------------------------------
// Registry snapshot (immutable set + canonical digest — L9)
// ---------------------------------------------------------------------------

/**
 * A registry snapshot — mirror of the registry module's `RegistrySnapshot`.
 * `records` is the canonically ordered record set; `digest` is the L9
 * lineage anchor every organization candidate cites.
 */
export interface RegistrySnapshotMirror {
  readonly records: readonly CapabilityRecordMirror[];
  readonly digest: RegistryDigest;
}

/** Guard: `RegistrySnapshotMirror` (structural). */
export function isRegistrySnapshotMirror(v: unknown): v is RegistrySnapshotMirror {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.records)) return false;
  if (!v.records.every((record) => isCapabilityRecordMirror(record))) return false;
  return isDigest(v.digest);
}

/**
 * Computes the canonical registry-snapshot digest — BYTE-IDENTICAL to the
 * registry module's `registryDigestOf` (records sorted by canonical JSON,
 * canonical JSON of the sorted array, stable digest). The cross-package
 * trip wire in interop.test.ts asserts the parity; any divergence is a
 * lineage break (L9).
 */
export function registrySnapshotDigestMirror(
  records: readonly CapabilityRecordMirror[],
): RegistryDigest {
  const canonical = records.map((record) => canonicalJson(record as unknown as JsonValue));
  canonical.sort(); // code-unit order — the canonical set order
  return stableDigest(`[${canonical.join(',')}]`) as RegistryDigest;
}

/**
 * Validates a registry snapshot against the FULL law with this package's
 * typed error taxonomy: structural shape, per-record validation (including
 * the L16a `label_as_evidence` trip-wire), unique record ids, and digest
 * binding — a declared digest that does not bind its record set is a
 * lineage forgery (`registry_digest_mismatch`).
 */
export function validateRegistrySnapshotMirror(v: unknown): OrgResult<RegistrySnapshotMirror> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType('registry snapshot must be an object')] };
  }
  const errors: OrgError[] = [];
  if (!isDigest(v.digest)) {
    errors.push(invalidField('digest', 'must be a 16-character lowercase hex registry digest'));
  }
  if (!Array.isArray(v.records)) {
    errors.push(invalidField('records', 'must be an array of capability records'));
    return { ok: false, errors };
  }
  const seenIds = new Set<string>();
  const records: CapabilityRecordMirror[] = [];
  v.records.forEach((record, index) => {
    const path = `records[${index}]`;
    if (!isRecord(record)) {
      errors.push(invalidField(path, 'must be a plain JSON object'));
      return;
    }
    // L16a trip-wire FIRST: label keys anywhere, or `kind: 'label'` evidence.
    for (const labelPath of labelKeyPathsMirror(record)) {
      errors.push({
        code: 'label_as_evidence',
        path: `${path}.${labelPath}`,
        message: `field "${labelPath}" cites a profession/role label — labels alone never establish suitability (L16a; spec/CAPABILITY-DISCOVERY.md "Never equate model and profession")`,
      });
    }
    if (Array.isArray(record.descriptors)) {
      record.descriptors.forEach((descriptor: unknown, descriptorIndex: number) => {
        if (!isRecord(descriptor) || !Array.isArray(descriptor.evidence)) return;
        descriptor.evidence.forEach((entry: unknown, evidenceIndex: number) => {
          if (isRecord(entry) && entry.kind === 'label') {
            errors.push({
              code: 'label_as_evidence',
              path: `${path}.descriptors[${descriptorIndex}].evidence[${evidenceIndex}]`,
              message: 'evidence kind "label" is not a measured-evidence kind (L16a)',
            });
          }
        });
      });
    }
    if (!isCapabilityRecordMirror(record)) {
      if (!isCapabilityRecordId(record.recordId)) {
        errors.push(invalidField(`${path}.recordId`, 'invalid CapabilityRecordId'));
      }
      if (!isRegistrySubjectMirror(record.subject)) {
        errors.push(invalidField(`${path}.subject`, 'invalid RegistrySubject'));
      }
      if (!Array.isArray(record.descriptors) || record.descriptors.length === 0) {
        errors.push(invalidField(`${path}.descriptors`, 'must be a non-empty array'));
      } else {
        const seen = new Set<string>();
        record.descriptors.forEach((descriptor: unknown, descriptorIndex: number) => {
          const descriptorPath = `${path}.descriptors[${descriptorIndex}]`;
          if (!isRecord(descriptor)) {
            errors.push(invalidField(descriptorPath, 'must be a plain JSON object'));
            return;
          }
          if (!isCapabilityKey(descriptor.capability)) {
            errors.push(invalidField(`${descriptorPath}.capability`, 'invalid CapabilityKey'));
          } else if (seen.has(descriptor.capability)) {
            errors.push(
              invalidField(
                `${descriptorPath}.capability`,
                `duplicate capability key "${descriptor.capability}"`,
              ),
            );
          } else {
            seen.add(descriptor.capability);
          }
          if (!Array.isArray(descriptor.evidence)) {
            errors.push(invalidField(`${descriptorPath}.evidence`, 'must be an array'));
          } else if (descriptor.evidence.length === 0) {
            errors.push({
              code: 'label_as_evidence',
              path: `${descriptorPath}.evidence`,
              message: 'a capability claim must carry at least one measured-evidence entry (L16a: labels alone never establish suitability)',
            });
          } else {
            descriptor.evidence.forEach((entry: unknown, evidenceIndex: number) => {
              if (!isMeasuredEvidenceMirror(entry)) {
                errors.push(
                  invalidField(
                    `${descriptorPath}.evidence[${evidenceIndex}]`,
                    'failed the closed MeasuredEvidence union (benchmark | measurement-record | result-ref)',
                  ),
                );
              }
            });
          }
        });
      }
      if (!isArrayOf(record.compatibilityRefs, isNonEmptyString)) {
        errors.push(invalidField(`${path}.compatibilityRefs`, 'must be an array of opaque references'));
      }
      return;
    }
    if (seenIds.has(record.recordId)) {
      errors.push(invalidField(`${path}.recordId`, `duplicate record id "${record.recordId}"`));
    } else {
      seenIds.add(record.recordId);
      records.push(record);
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  if (!isDigest(v.digest)) {
    return { ok: false, errors: [invalidField('digest', 'invalid registry digest')] };
  }
  const recomputed = registrySnapshotDigestMirror(records);
  if (recomputed !== v.digest) {
    return fail(
      'registry_digest_mismatch',
      `declared digest "${v.digest}" does not bind the record set (recomputed "${recomputed}") — a snapshot digest that does not match its records is a lineage forgery (L9)`,
      'digest',
    );
  }
  return {
    ok: true,
    value: deepFreeze({ records: [...records], digest: v.digest } as unknown as RegistrySnapshotMirror),
  };
}

// ---------------------------------------------------------------------------
// Query-by-capability-contract (pure filtering — mirror)
// ---------------------------------------------------------------------------

/**
 * A capability-contract query — mirror of the registry's
 * `CapabilityQuery`. Non-empty; keys unique; no labels (the query is pure
 * demand-side data).
 */
export interface CapabilityQueryMirror {
  readonly requires: readonly CapabilityKey[];
}

/** Guard: `CapabilityQueryMirror`. */
export function isCapabilityQueryMirror(v: unknown): v is CapabilityQueryMirror {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.requires) || v.requires.length === 0) return false;
  if (!isArrayOf(v.requires, isCapabilityKey)) return false;
  return new Set(v.requires).size === v.requires.length;
}

/**
 * Query a snapshot by capability contract — PURE filtering (mirror of the
 * registry's `queryByCapability`): records demonstrating EVERY required
 * key, in snapshot order.
 */
export function queryByCapabilityMirror(
  snapshot: RegistrySnapshotMirror,
  query: CapabilityQueryMirror,
): readonly CapabilityRecordMirror[] {
  const required = [...query.requires];
  return snapshot.records.filter((record) => {
    const offered = new Set(record.descriptors.map((descriptor) => descriptor.capability));
    return required.every((key) => offered.has(key));
  });
}

/**
 * Extracts the measurement value for one structured metric from a record's
 * evidence, for measurement aggregation in the reference compiler's
 * DECLARED measurement derivations. When the record carries multiple
 * measurement records for one metric, the LAST in canonical record order
 * wins (declared; deterministic). Returns `null` when the record carries
 * no measurement for the metric.
 */
export function measuredValueOf(
  record: CapabilityRecordMirror,
  metric: MeasurementMetricMirror,
): number | null {
  let found: number | null = null;
  for (const descriptor of record.descriptors) {
    for (const evidence of descriptor.evidence) {
      if (evidence.kind === 'measurement-record' && evidence.metric === metric) {
        found = evidence.value;
      }
    }
  }
  return found;
}
