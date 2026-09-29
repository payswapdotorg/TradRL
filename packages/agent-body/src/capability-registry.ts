// @tradrl/agent-body — Substrate Capability Registry contracts.
//
// Owning Work Order: T016 (absorbed per program decisions D-006/D-007 — the
// T003 registry gap; frozen write surface for this module:
// packages/agent-body/src/capability-registry.ts, additive ONLY).
//
// Spec anchors: spec/CAPABILITY-DISCOVERY.md — VERBATIM:
//   "Never equate model and profession" — `model -> measured mathematical
//   reasoning capability -> candidate possession` is valid; `model ->
//   mathematician` is not an evidence-backed architectural rule.
//   Safety: "Discovery does not grant consequential execution authority.
//   Risk, authorization and execution policy remain independent gates."
//   Reproducibility: "Record candidate roles, bodies, models, benchmarks,
//   datasets, configuration, cost, latency, environment, outcomes and
//   rejected candidates."
// spec/ARCHITECTURE-LOCK.md L16a — VERBATIM: "Autonomous capability
//   discovery: organization search may discover missing capabilities and
//   candidate Body/Substrate assignments from evidence; labels alone never
//   establish suitability."
//   L9 (reproducible lineage — the snapshot digest binds every organization
//   candidate's lineage to the exact evidence base it searched over).
//
// THE LAW THIS MODULE ENFORCES (L16a): every capability claim in the
// registry is MEASURED EVIDENCE — benchmark references, structured
// measurement records, opaque result references. A profession/role LABEL as
// suitability evidence is a typed violation (`label-as-evidence`), detected
// both by the structural guard and by `validateCapabilityRecord`. Candidate
// body/substrate assignments (the T016 organization compiler) cite
// capability RECORDS, never labels.
//
// SELF-CONTAINMENT (additivity law, D-006/D-007): this module imports
// NOTHING — not even from sibling modules of this package. It re-declares
// the guard/digest vocabulary it needs (the D-003/D-004 structural-mirror
// discipline, inverted inward). The additivity trip-wire lives in
// capability-registry.test.ts (a source scan asserting the absence of
// import statements); packages/agent-body/src/index.ts gains ONLY the
// re-export of this module.
//
// Laws honored here:
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape has a hand-rolled total type guard.
// - All contract data is JSON-serializable (no Dates, Maps, Sets; brands
//   are compile-time only — string-keyed phantom properties so downstream
//   structural mirrors (the T016 organization package) stay mutually
//   assignable).
// - No ambient clock: `Date.now()` never appears; the registry records
//   measurements, never "when it looked".
// - Canonical serialization is byte-deterministic (recursively sorted keys —
//   the program-wide canonical-JSON law first declared by
//   @tradrl/trajectory and mirrored byte-identically in
//   @tradrl/evaluation/@tradrl/verification primitives; the same algorithm
//   is re-declared here so snapshot digests agree across lanes without an
//   import edge).

// ---------------------------------------------------------------------------
// Structural type-check helpers (hand-rolled, `any`-free, module-local)
// ---------------------------------------------------------------------------

/** `true` when `v` is a plain JSON object (not an array, not a class instance). */
function isPlainRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** `true` when `v` is a finite number (never NaN, never ±Infinity). */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** `true` when `v` is a non-empty string after trimming. */
function isNonEmptyStringValue(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** `true` when `v` is an integer `>= 0`. */
function isNonNegativeIntegerValue(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0;
}

/** `true` when `v` is an array whose every element satisfies `guard`. */
function isArrayOfValues<T>(
  v: unknown,
  guard: (item: unknown) => item is T,
): v is readonly T[] {
  return Array.isArray(v) && v.every((item) => guard(item));
}

/** `true` when `v` is a member of the closed string vocabulary `values`. */
function isMemberOf<const V extends readonly string[]>(
  values: V,
  v: unknown,
): v is V[number] {
  return typeof v === 'string' && (values as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Deep immutability (module-local mirror of the package discipline)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze`s every reachable plain object and array.
 * Already-frozen branches are skipped, so cycles terminate. Returns the same
 * reference, now deeply frozen.
 */
function deepFreezeValue<T>(value: T): T {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) continue;
    Object.freeze(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        if (item !== null && typeof item === 'object') stack.push(item);
      }
    } else {
      for (const key of Object.keys(current)) {
        const child: unknown = (current as Record<string, unknown>)[key];
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Canonical JSON + stable digest (program-wide law, re-declared; see header)
// ---------------------------------------------------------------------------

/** Recursive JSON value model (module-local). */
export type RegistryJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly RegistryJsonValue[]
  | { readonly [key: string]: RegistryJsonValue };

/**
 * Canonical JSON serialization: object keys recursively sorted (code-unit
 * order), arrays in order, strings via `JSON.stringify`, finite numbers via
 * `String`. Equal JSON values always serialize byte-identically — the
 * determinism anchor for the registry snapshot digest (L9).
 */
export function registryCanonicalJson(value: RegistryJsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value); // finite by the JSON model
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => registryCanonicalJson(element)).join(',')}]`;
  const object = value as { readonly [key: string]: RegistryJsonValue };
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${registryCanonicalJson(object[key])}`).join(',')}}`;
}

/** Fixed 32-bit FNV-1a offset basis and prime (hand-rolled digest, L9). */
const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/** One 32-bit FNV-1a round over a UTF-16 code unit (UTF-8 denormalized). */
function fnv1aRound(hash: number, unit: number): number {
  const bytes: number[] = [];
  if (unit < 0x80) {
    bytes.push(unit);
  } else if (unit < 0x800) {
    bytes.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f));
  } else {
    bytes.push(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f));
  }
  let h = hash;
  for (const byte of bytes) {
    h ^= byte;
    h = Math.imul(h, FNV_PRIME_32) >>> 0;
  }
  return h;
}

/**
 * Stable 64-bit-lane digest of a canonical JSON string: two independent
 * 32-bit FNV-1a lanes (even/odd code units, both folding the length),
 * rendered as 16 lowercase hex characters. Pure, deterministic,
 * hand-rolled — identical inputs ALWAYS digest identically. NOT
 * cryptographic; it is the change-detection digest L9 lineage binding
 * needs. Byte-identical to @tradrl/evaluation's `stableDigest` (the
 * program-wide law) — the cross-lane trip wire lives in the T016
 * organization package's interop test.
 */
export function registryStableDigest(canonical: string): string {
  let even = FNV_OFFSET_32;
  let odd = FNV_OFFSET_32 ^ 0x2f6e2e1; // second lane seed (arbitrary, fixed forever)
  const units = Array.from(canonical);
  for (let index = 0; index < units.length; index++) {
    const unit = units[index].codePointAt(0) as number;
    if (index % 2 === 0) even = fnv1aRound(even, unit);
    else odd = fnv1aRound(odd, unit);
  }
  // Fold the length into both lanes so prefix-extension collisions cannot survive.
  even = Math.imul(even ^ units.length, FNV_PRIME_32) >>> 0;
  odd = Math.imul(odd ^ (units.length * 31), FNV_PRIME_32) >>> 0;
  const hex = (value: number): string => value.toString(16).padStart(8, '0');
  return `${hex(even)}${hex(odd)}`;
}

// ---------------------------------------------------------------------------
// Branded identifiers (string-keyed phantom brands — see header)
// ---------------------------------------------------------------------------

/**
 * A capability-contract key: the address-space shared by registry
 * descriptors and capability queries (e.g. `mathematical-reasoning`).
 * OPEN vocabulary (identifier pattern) — capability contracts are
 * characterized dynamically (spec/CAPABILITY-DISCOVERY.md step 2); freezing
 * the vocabulary would freeze the discovery space.
 */
export type CapabilityKey = string & { readonly __brand: 'CapabilityKey' };

/** Identity of one registry capability record (content-neutral, opaque). */
export type CapabilityRecordId = string & { readonly __brand: 'CapabilityRecordId' };

/** A registry snapshot digest (16 lowercase hex characters). */
export type RegistryDigest = string & { readonly __brand: 'RegistryDigest' };

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const OPAQUE_REF_PATTERN = /^[^\s](.{0,1022}[^\s])?$/u;

function isIdentifierString(v: unknown): v is string {
  return typeof v === 'string' && IDENTIFIER_PATTERN.test(v);
}

function isOpaqueRefString(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= 1024 &&
    OPAQUE_REF_PATTERN.test(v) &&
    !/[\u0000-\u001f]/.test(v)
  );
}

/** Guard: `CapabilityKey` (identifier pattern). */
export function isCapabilityKey(v: unknown): v is CapabilityKey {
  return isIdentifierString(v);
}

/** Guard: `CapabilityRecordId` (identifier pattern). */
export function isCapabilityRecordId(v: unknown): v is CapabilityRecordId {
  return isIdentifierString(v);
}

/** Guard: `RegistryDigest` (16 lowercase hex characters). */
export function isRegistryDigest(v: unknown): v is RegistryDigest {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
}

/** Constructs a `CapabilityKey`, throwing `TypeError` on invalid input. */
export function capabilityKey(value: string): CapabilityKey {
  if (!isCapabilityKey(value)) {
    throw new TypeError(
      `capabilityKey: invalid key ${JSON.stringify(value)} — must match ${IDENTIFIER_PATTERN.source}`,
    );
  }
  return value as CapabilityKey;
}

/** Constructs a `CapabilityRecordId`, throwing `TypeError` on invalid input. */
export function capabilityRecordId(value: string): CapabilityRecordId {
  if (!isCapabilityRecordId(value)) {
    throw new TypeError(
      `capabilityRecordId: invalid id ${JSON.stringify(value)} — must match ${IDENTIFIER_PATTERN.source}`,
    );
  }
  return value as CapabilityRecordId;
}

// ---------------------------------------------------------------------------
// L16a trip-wire vocabulary: label keys NEVER establish suitability
// ---------------------------------------------------------------------------

/**
 * The closed set of field names that make a capability record cite a
 * PROFESSION/ROLE LABEL — the L16a / "Never equate model and profession"
 * trip-wire. A record (or any nested object within it) carrying one of
 * these keys fails validation with `label-as-evidence` and fails the
 * structural guard outright: `model -> mathematician` is not an
 * evidence-backed architectural rule (spec/CAPABILITY-DISCOVERY.md).
 */
export const LABEL_EVIDENCE_KEYS = [
  'label',
  'roleLabel',
  'profession',
  'role',
  'title',
  'jobTitle',
  'vocation',
] as const;

/** A label-suspect field name. */
export type LabelEvidenceKey = (typeof LABEL_EVIDENCE_KEYS)[number];

/** Guard: `LabelEvidenceKey`. */
export function isLabelEvidenceKey(v: unknown): v is LabelEvidenceKey {
  return isMemberOf(LABEL_EVIDENCE_KEYS, v);
}

/**
 * Walks a JSON value and returns the dotted paths of every object key in
 * {@link LABEL_EVIDENCE_KEYS} it finds (breadth-limited to JSON data).
 * Pure; used by the guard and the validator to make label smuggling a
 * machine-detected, typed violation.
 */
export function labelKeyPaths(value: unknown, prefix = ''): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const path of labelKeyPaths(item, `${prefix}[${index}]`)) found.push(path);
    });
    return found;
  }
  if (!isPlainRecord(value)) return found;
  for (const key of Object.keys(value)) {
    if (isLabelEvidenceKey(key)) found.push(prefix === '' ? key : `${prefix}.${key}`);
    for (const path of labelKeyPaths(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Measured evidence (the only legal form of a capability claim — L16a)
// ---------------------------------------------------------------------------

/** The closed vocabulary of measured-evidence kinds. */
export const CAPABILITY_EVIDENCE_KINDS = [
  'benchmark',
  'measurement-record',
  'result-ref',
] as const;

/** One kind of measured evidence. */
export type CapabilityEvidenceKind = (typeof CAPABILITY_EVIDENCE_KINDS)[number];

/** Guard: `CapabilityEvidenceKind`. */
export function isCapabilityEvidenceKind(v: unknown): v is CapabilityEvidenceKind {
  return isMemberOf(CAPABILITY_EVIDENCE_KINDS, v);
}

/**
 * The closed vocabulary of structured measurement metrics a registry
 * measurement record may carry. Cost/latency/compute measurements make the
 * registry the evidence base organization search scores against
 * (spec/CAPABILITY-DISCOVERY.md Reproducibility: "Record ... cost, latency
 * ..."); `benchmark-score` carries normalized benchmark outcomes.
 */
export const MEASUREMENT_METRICS = [
  'benchmark-score',
  'p50-latency-ms',
  'p95-latency-ms',
  'compute-units',
] as const;

/** One structured measurement metric. */
export type MeasurementMetric = (typeof MEASUREMENT_METRICS)[number];

/** Guard: `MeasurementMetric`. */
export function isMeasurementMetric(v: unknown): v is MeasurementMetric {
  return isMemberOf(MEASUREMENT_METRICS, v);
}

/** Benchmark evidence: a named benchmark run plus its opaque result reference. */
export interface BenchmarkEvidence {
  readonly kind: 'benchmark';
  /** Opaque benchmark-suite identity (the benchmark lane owns the referent). */
  readonly benchmarkId: string;
  /** Opaque reference to the recorded result of running the benchmark. */
  readonly resultRef: string;
}

/** A structured measurement record reference with its metric and value. */
export interface MeasurementRecordEvidence {
  readonly kind: 'measurement-record';
  /** Opaque reference to the full measurement record (environment, config). */
  readonly recordRef: string;
  /** Which structured metric the value carries. */
  readonly metric: MeasurementMetric;
  /** The measured value (finite; interpretation is the reader's). */
  readonly value: number;
}

/** An opaque result reference (raw evidence capsule, no structured metric). */
export interface ResultRefEvidence {
  readonly kind: 'result-ref';
  /** Opaque reference to the result capsule. */
  readonly resultRef: string;
}

/**
 * One piece of MEASURED evidence backing a capability claim. The union is
 * CLOSED: there is deliberately no label/profession member — L16a ("labels
 * alone never establish suitability") makes the illegal state
 * unrepresentable in valid records, and `validateCapabilityRecord` turns
 * smuggled labels into the typed `label-as-evidence` violation.
 */
export type MeasuredEvidence =
  | BenchmarkEvidence
  | MeasurementRecordEvidence
  | ResultRefEvidence;

/**
 * Guard: `MeasuredEvidence` — total over the closed union. A `kind: 'label'`
 * entry (or any other unknown kind) fails here by construction.
 */
export function isMeasuredEvidence(v: unknown): v is MeasuredEvidence {
  if (!isPlainRecord(v)) return false;
  switch (v.kind) {
    case 'benchmark':
      return isOpaqueRefString(v.benchmarkId) && isOpaqueRefString(v.resultRef);
    case 'measurement-record':
      return (
        isOpaqueRefString(v.recordRef) &&
        isMeasurementMetric(v.metric) &&
        isFiniteNumber(v.value)
      );
    case 'result-ref':
      return isOpaqueRefString(v.resultRef);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Capability descriptors and records
// ---------------------------------------------------------------------------

/**
 * What a subject DEMONSTRABLY offers for one capability contract: the
 * capability key plus a NON-EMPTY list of measured evidence. No suitability
 * label, no role, no profession — L16a.
 */
export interface CapabilityDescriptor {
  /** The capability contract this descriptor speaks about. */
  readonly capability: CapabilityKey;
  /** Measured evidence backing the claim; non-empty (a bare claim is a label). */
  readonly evidence: readonly MeasuredEvidence[];
}

/**
 * Guard: `CapabilityDescriptor`. Note: an empty evidence list fails — a
 * capability claim without measured evidence is exactly the label-shaped
 * claim L16a forbids.
 */
export function isCapabilityDescriptor(v: unknown): v is CapabilityDescriptor {
  if (!isPlainRecord(v)) return false;
  if (!isCapabilityKey(v.capability)) return false;
  if (!Array.isArray(v.evidence) || v.evidence.length === 0) return false;
  return isArrayOfValues(v.evidence, isMeasuredEvidence);
}

/** The closed vocabulary of registry subject kinds. */
export const REGISTRY_SUBJECT_KINDS = ['body-version', 'cognitive-substrate'] as const;

/** What a registry record is about: an immutable BodyVersion, or a substrate. */
export type RegistrySubjectKind = (typeof REGISTRY_SUBJECT_KINDS)[number];

/** Guard: `RegistrySubjectKind`. */
export function isRegistrySubjectKind(v: unknown): v is RegistrySubjectKind {
  return isMemberOf(REGISTRY_SUBJECT_KINDS, v);
}

/**
 * The subject of a capability record — a BodyVersion (canonical
 * `${bodyId}@${semver}`) or a CognitiveSubstrate (canonical
 * `provider/modelId@modelVersion`). Opaque strings here: the canonical
 * parsing discipline is owned by this package's primitives module; the
 * registry only requires the canonical shapes (see
 * `parseRegistrySubjectComponent` below for the structural check).
 */
export type RegistrySubject =
  | { readonly kind: 'body-version'; readonly bodyVersionRef: string }
  | { readonly kind: 'cognitive-substrate'; readonly substrateRef: string };

const BODY_VERSION_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SUBSTRATE_REF_PATTERN = /^[^\s/@]{1,128}\/[^\s/@]{1,128}@[^\s/@]{1,128}$/;

/** `true` when `v` is a structurally canonical `${bodyId}@${semver}` reference. */
export function isCanonicalBodyVersionRef(v: unknown): v is string {
  return typeof v === 'string' && BODY_VERSION_REF_PATTERN.test(v);
}

/** `true` when `v` is a structurally canonical `provider/modelId@modelVersion` reference. */
export function isCanonicalSubstrateRef(v: unknown): v is string {
  return typeof v === 'string' && SUBSTRATE_REF_PATTERN.test(v);
}

/**
 * Guard: `RegistrySubject` — the closed subject union with canonical
 * reference shapes.
 */
export function isRegistrySubject(v: unknown): v is RegistrySubject {
  if (!isPlainRecord(v)) return false;
  switch (v.kind) {
    case 'body-version':
      return isCanonicalBodyVersionRef(v.bodyVersionRef);
    case 'cognitive-substrate':
      return isCanonicalSubstrateRef(v.substrateRef);
    default:
      return false;
  }
}

/**
 * One capability record: what ONE subject (a BodyVersion or a Cognitive
 * Substrate) DEMONSTRABLY offers, as measured evidence. Compatibility
 * constraints are carried as OPAQUE references to the compatibility
 * contracts owned by this package's compatibility module (the registry
 * never re-encodes them). The record carries NO execution authority of any
 * kind (spec/CAPABILITY-DISCOVERY.md Safety — "Discovery does not grant
 * consequential execution authority").
 */
export interface CapabilityRecord {
  /** Registry-unique record identity. */
  readonly recordId: CapabilityRecordId;
  /** What the record is about. */
  readonly subject: RegistrySubject;
  /** Non-empty; capability keys unique within the record. */
  readonly descriptors: readonly CapabilityDescriptor[];
  /** Opaque compatibility-constraint references (may be empty). */
  readonly compatibilityRefs: readonly string[];
}

/**
 * Guard: `CapabilityRecord` — structural totality INCLUDING the L16a label
 * scan: a record carrying any {@link LABEL_EVIDENCE_KEYS} key anywhere in
 * its JSON tree fails the guard outright (labels never establish
 * suitability — the law is enforced on every code path that uses the
 * guard, not only on the validator path).
 */
export function isCapabilityRecord(v: unknown): v is CapabilityRecord {
  if (!isPlainRecord(v)) return false;
  if (!isCapabilityRecordId(v.recordId)) return false;
  if (!isRegistrySubject(v.subject)) return false;
  if (!Array.isArray(v.descriptors) || v.descriptors.length === 0) return false;
  if (!isArrayOfValues(v.descriptors, isCapabilityDescriptor)) return false;
  const seen = new Set<string>();
  for (const descriptor of v.descriptors) {
    if (seen.has(descriptor.capability)) return false; // unique capability keys
    seen.add(descriptor.capability);
  }
  if (!isArrayOfValues(v.compatibilityRefs, isOpaqueRefString)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a: no label keys, anywhere
  return true;
}

// ---------------------------------------------------------------------------
// Typed validation (violations as pure data)
// ---------------------------------------------------------------------------

/** The closed violation-code vocabulary for registry validation. */
export const CAPABILITY_RECORD_VIOLATION_CODES = [
  /** A profession/role label was cited as suitability evidence (L16a). */
  'label-as-evidence',
  /** A descriptor claims a capability with no measured evidence. */
  'no-measured-evidence',
  /** Two descriptors in one record claim the same capability key. */
  'duplicate-capability',
  /** A record is not structurally a `CapabilityRecord`. */
  'invalid-field',
] as const;

/** One registry validation violation. */
export type CapabilityRecordViolationCode =
  (typeof CAPABILITY_RECORD_VIOLATION_CODES)[number];

/** Guard: `CapabilityRecordViolationCode`. */
export function isCapabilityRecordViolationCode(
  v: unknown,
): v is CapabilityRecordViolationCode {
  return isMemberOf(CAPABILITY_RECORD_VIOLATION_CODES, v);
}

/** One typed registry-validation violation, located by a dotted path. */
export interface CapabilityRecordViolation {
  readonly code: CapabilityRecordViolationCode;
  /** Dotted path from the validated root (empty for whole-record errors). */
  readonly path: string;
  readonly message: string;
}

/** Result of `validateCapabilityRecord` / `validateRegistrySnapshot`. */
export interface CapabilityRecordValidation {
  readonly valid: boolean;
  readonly violations: readonly CapabilityRecordViolation[];
}

function violation(
  code: CapabilityRecordViolationCode,
  path: string,
  message: string,
): CapabilityRecordViolation {
  return { code, path, message };
}

/**
 * Validates one capability record against the FULL law: structural shape,
 * measured-evidence presence, capability uniqueness, and the L16a
 * label-as-evidence trip-wire (both label FIELD keys and `kind: 'label'`
 * evidence entries). Collects every violation — never throws, never
 * interprets.
 */
export function validateCapabilityRecord(v: unknown): CapabilityRecordValidation {
  const violations: CapabilityRecordViolation[] = [];
  if (!isPlainRecord(v)) {
    violations.push(violation('invalid-field', '', 'record must be a plain JSON object'));
    return { valid: false, violations };
  }
  // L16a trip-wire #1: label FIELD keys anywhere in the record's JSON tree.
  for (const path of labelKeyPaths(v)) {
    violations.push(
      violation(
        'label-as-evidence',
        path,
        `field "${path}" cites a profession/role label — labels alone never establish suitability (L16a; spec/CAPABILITY-DISCOVERY.md "Never equate model and profession")`,
      ),
    );
  }
  // L16a trip-wire #2: a `kind: 'label'` evidence entry (the classic
  // `model -> mathematician` smuggle) is named precisely, not just
  // generically invalid.
  const descriptors: readonly unknown[] = Array.isArray(v.descriptors) ? v.descriptors : [];
  descriptors.forEach((descriptor, descriptorIndex) => {
    if (!isPlainRecord(descriptor)) return;
    const evidence: readonly unknown[] = Array.isArray(descriptor.evidence)
      ? descriptor.evidence
      : [];
    evidence.forEach((entry, evidenceIndex) => {
      if (isPlainRecord(entry) && entry.kind === 'label') {
        violations.push(
          violation(
            'label-as-evidence',
            `descriptors[${descriptorIndex}].evidence[${evidenceIndex}]`,
            'evidence kind "label" is not a measured-evidence kind — `model -> measured capability -> candidate possession` is valid, `model -> mathematician` is not (spec/CAPABILITY-DISCOVERY.md)',
          ),
        );
      }
    });
  });
  if (!isCapabilityRecordId(v.recordId)) {
    violations.push(violation('invalid-field', 'recordId', 'invalid CapabilityRecordId'));
  }
  if (!isRegistrySubject(v.subject)) {
    violations.push(violation('invalid-field', 'subject', 'invalid RegistrySubject (canonical ref required)'));
  }
  if (!Array.isArray(v.descriptors) || v.descriptors.length === 0) {
    violations.push(violation('invalid-field', 'descriptors', 'must be a non-empty array'));
  } else {
    const seen = new Set<string>();
    v.descriptors.forEach((descriptor, index) => {
      const path = `descriptors[${index}]`;
      if (!isPlainRecord(descriptor)) {
        violations.push(violation('invalid-field', path, 'descriptor must be a plain JSON object'));
        return;
      }
      if (!isCapabilityKey(descriptor.capability)) {
        violations.push(violation('invalid-field', `${path}.capability`, 'invalid CapabilityKey'));
      }
      if (!Array.isArray(descriptor.evidence)) {
        violations.push(violation('invalid-field', `${path}.evidence`, 'must be an array'));
      } else if (descriptor.evidence.length === 0) {
        // A capability claim without measured evidence is exactly the
        // label-shaped claim L16a forbids — typed precisely.
        violations.push(
          violation(
            'no-measured-evidence',
            `${path}.evidence`,
            'a capability claim must carry at least one measured-evidence entry (L16a: labels alone never establish suitability)',
          ),
        );
      } else {
        descriptor.evidence.forEach((entry, evidenceIndex) => {
          if (!isMeasuredEvidence(entry)) {
            violations.push(
              violation(
                'invalid-field',
                `${path}.evidence[${evidenceIndex}]`,
                'failed the closed MeasuredEvidence union (benchmark | measurement-record | result-ref)',
              ),
            );
          }
        });
      }
      if (typeof descriptor.capability === 'string' && seen.has(descriptor.capability)) {
        violations.push(
          violation('duplicate-capability', `${path}.capability`, `duplicate capability key "${descriptor.capability}"`),
        );
      } else if (typeof descriptor.capability === 'string') {
        seen.add(descriptor.capability);
      }
    });
  }
  if (!isArrayOfValues(v.compatibilityRefs, isOpaqueRefString)) {
    violations.push(violation('invalid-field', 'compatibilityRefs', 'must be an array of opaque references'));
  }
  return { valid: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Registry snapshot (immutable set + canonical digest — L9)
// ---------------------------------------------------------------------------

/**
 * An immutable, canonically ORDERED set of capability records plus its
 * canonical digest. Set semantics: the digest is computed over the records
 * sorted by their canonical JSON, so equal record sets always produce equal
 * snapshots byte-identically, independent of input order. The digest is the
 * L9 lineage anchor every organization candidate cites
 * (packages/organization CandidateLineage.registrySnapshotDigest).
 */
export interface RegistrySnapshot {
  /** Records, canonically sorted (by canonical JSON of each record). */
  readonly records: readonly CapabilityRecord[];
  /** Canonical digest over the sorted record set (16 lowercase hex). */
  readonly digest: RegistryDigest;
}

/** Guard: `RegistrySnapshot` (structural; full law via `validateRegistrySnapshot`). */
export function isRegistrySnapshot(v: unknown): v is RegistrySnapshot {
  if (!isPlainRecord(v)) return false;
  if (!Array.isArray(v.records)) return false;
  if (!v.records.every((record) => isCapabilityRecord(record))) return false;
  return isRegistryDigest(v.digest);
}

/**
 * Computes the canonical digest of a record set: records are validated
 * structurally, sorted by their canonical JSON (code-unit order), and the
 * canonical JSON of the sorted array is digested with
 * {@link registryStableDigest}. Pure and deterministic: equal record sets
 * (any input order) always digest identically.
 */
export function registryDigestOf(records: readonly CapabilityRecord[]): RegistryDigest {
  const canonical = records.map((record) => registryCanonicalJson(record as unknown as RegistryJsonValue));
  canonical.sort(); // code-unit order — the canonical set order
  const bytes = `[${canonical.join(',')}]`;
  return registryStableDigest(bytes) as RegistryDigest;
}

/**
 * Constructs a deeply frozen `RegistrySnapshot` from a record list. Every
 * record is validated against the FULL law (including the L16a
 * label-as-evidence trip-wire); record ids must be unique; the records are
 * stored in canonical order and the digest is derived. Throws `TypeError`
 * (collected problems) on invalid input.
 */
export function createRegistrySnapshot(records: readonly unknown[]): RegistrySnapshot {
  const problems: string[] = [];
  const validated: CapabilityRecord[] = [];
  const seenIds = new Set<string>();
  records.forEach((record, index) => {
    const validation = validateCapabilityRecord(record);
    if (!validation.valid) {
      for (const v of validation.violations) {
        problems.push(`records[${index}] (${v.code} at ${v.path === '' ? '<root>' : v.path}): ${v.message}`);
      }
      return;
    }
    const valid = record as CapabilityRecord;
    if (seenIds.has(valid.recordId)) {
      problems.push(`records[${index}].recordId: duplicate record id "${valid.recordId}"`);
    } else {
      seenIds.add(valid.recordId);
      validated.push(valid);
    }
  });
  if (problems.length > 0) {
    throw new TypeError(`createRegistrySnapshot: ${problems.join('; ')}`);
  }
  const sorted = [...validated].sort((a, b) =>
    registryCanonicalJson(a as unknown as RegistryJsonValue) <
    registryCanonicalJson(b as unknown as RegistryJsonValue)
      ? -1
      : 1,
  );
  const digest = registryDigestOf(sorted);
  return deepFreezeValue({ records: sorted, digest });
}

/**
 * Validates a registry snapshot against the FULL law: every record passes
 * `validateCapabilityRecord` (L16a included), record ids are unique, and
 * the declared digest equals the recomputed canonical digest of the record
 * set — a snapshot whose digest does not bind its records is a lineage
 * forgery and fails with `digest-mismatch`.
 */
export function validateRegistrySnapshot(v: unknown): CapabilityRecordValidation & {
  readonly digestMismatch: boolean;
} {
  const violations: CapabilityRecordViolation[] = [];
  if (!isPlainRecord(v)) {
    violations.push(violation('invalid-field', '', 'snapshot must be a plain JSON object'));
    return { valid: false, violations, digestMismatch: false };
  }
  if (!isRegistryDigest(v.digest)) {
    violations.push(violation('invalid-field', 'digest', 'invalid RegistryDigest (16 lowercase hex)'));
  }
  if (!Array.isArray(v.records)) {
    violations.push(violation('invalid-field', 'records', 'must be an array'));
    return { valid: false, violations, digestMismatch: false };
  }
  const seenIds = new Set<string>();
  const validRecords: CapabilityRecord[] = [];
  v.records.forEach((record, index) => {
    const validation = validateCapabilityRecord(record);
    for (const violationEntry of validation.violations) {
      violations.push(
        violation(
          violationEntry.code,
          `records[${index}].${violationEntry.path}`,
          violationEntry.message,
        ),
      );
    }
    if (isCapabilityRecord(record)) {
      if (seenIds.has(record.recordId)) {
        violations.push(
          violation('invalid-field', `records[${index}].recordId`, `duplicate record id "${record.recordId}"`),
        );
      } else {
        seenIds.add(record.recordId);
        validRecords.push(record);
      }
    }
  });
  let digestMismatch = false;
  if (isRegistryDigest(v.digest) && violations.length === 0) {
    const recomputed = registryDigestOf(validRecords);
    if (recomputed !== v.digest) {
      digestMismatch = true;
      violations.push(
        violation(
          'invalid-field',
          'digest',
          `declared digest "${v.digest}" does not bind the record set (recomputed "${recomputed}") — a snapshot digest that does not match its records is a lineage forgery (L9)`,
        ),
      );
    }
  }
  return { valid: violations.length === 0, violations, digestMismatch };
}

// ---------------------------------------------------------------------------
// Query-by-capability-contract (pure filtering)
// ---------------------------------------------------------------------------

/**
 * A capability-contract query: the set of capability keys a consumer (the
 * T016 organization compiler) requires. Non-empty; keys unique. The query
 * is pure demand-side data — it carries NO evidence and NO labels (the
 * same L16a scan applies).
 */
export interface CapabilityQuery {
  /** Required capability keys; non-empty, unique. */
  readonly requires: readonly CapabilityKey[];
}

/** Guard: `CapabilityQuery`. */
export function isCapabilityQuery(v: unknown): v is CapabilityQuery {
  if (!isPlainRecord(v)) return false;
  if (!Array.isArray(v.requires) || v.requires.length === 0) return false;
  if (!isArrayOfValues(v.requires, isCapabilityKey)) return false;
  return new Set(v.requires).size === v.requires.length;
}

/**
 * Query a snapshot by capability contract (PURE filtering): returns the
 * records that demonstrate EVERY required capability key — a record
 * demonstrates a key when one of its descriptors claims that capability
 * with non-empty measured evidence (guaranteed by record validity). A
 * record demonstrating MORE than the requirement still matches (contracts
 * are requirements, not exact-shape demands). Deterministic: output order
 * follows the snapshot's canonical record order.
 */
export function queryByCapability(
  snapshot: RegistrySnapshot,
  query: CapabilityQuery,
): readonly CapabilityRecord[] {
  const required = [...query.requires];
  return snapshot.records.filter((record) => {
    const offered = new Set(record.descriptors.map((descriptor) => descriptor.capability));
    return required.every((key) => offered.has(key));
  });
}

/**
 * Constructs a deeply frozen `CapabilityRecord`, running the FULL
 * validation law first (structural shape, measured-evidence presence,
 * unique capability keys, and the L16a label-as-evidence trip-wire).
 * Throws `TypeError` (field-prefixed, all problems collected) on invalid
 * input.
 */
export function createCapabilityRecord(draft: unknown): CapabilityRecord {
  const validation = validateCapabilityRecord(draft);
  if (!validation.valid) {
    const problems = validation.violations.map(
      (v) => `(${v.code}) ${v.path === '' ? '<root>' : v.path}: ${v.message}`,
    );
    throw new TypeError(`createCapabilityRecord: ${problems.join('; ')}`);
  }
  return deepFreezeValue(draft as CapabilityRecord);
}
