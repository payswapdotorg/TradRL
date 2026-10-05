/**
 * @tradrl/adapter-arena — the capability-provider LANGUAGE layer.
 *
 * STRUCTURAL MIRROR of @tradrl/capability-provider's language modules
 * (errors.ts + primitives.ts + ids.ts + mirrors.ts — Work Order T045,
 * law D-003/D-004: structural mirrors, NEVER imports — the frozen
 * workspace lockfile forbids package dependencies). THIS is the
 * consumption surface the Arena adapter speaks: the typed error
 * vocabulary, the canonical-JSON/stable-digest primitives (the
 * program-wide fold — byte-identical to the REAL lanes; the interop
 * test pins the parity), the content-addressed id spaces, and the T017
 * capability language mirrors (measured evidence, the L16a label
 * trip-wire, applicability scopes, typed capability gaps).
 *
 * The interop test (../interop.test.ts) loads the REAL
 * @tradrl/capability-provider statically and pins every mirror
 * member-for-member — drift is a loud test failure.
 */

// ---------------------------------------------------------------------------
// The typed error vocabulary (mirror of T045's errors.ts)
// ---------------------------------------------------------------------------

/** The capability-provider lane's typed error codes — the machine-checkable form of its laws. */
export type ProviderErrorCode =
  // --- generic envelope validation -----------------------------------------
  | 'invalid_type'
  | 'missing_field'
  | 'invalid_field'
  | 'invalid_id'
  | 'invalid_timestamp'
  // --- L12 tenant isolation ---------------------------------------------------
  | 'tenant_missing'
  | 'tenant_scope_mismatch'
  | 'cross_tenant_access'
  // --- L16a labels never establish suitability ---------------------------------
  | 'label_as_evidence'
  // --- the evidence-citation law --------------------------------------------------
  | 'evidence_missing'
  // --- the chain law -----------------------------------------------------------------
  | 'chain_mismatch'
  // --- the registry laws ----------------------------------------------------------------
  | 'provider_unknown'
  | 'request_unknown'
  | 'quote_unknown'
  | 'engagement_unknown'
  | 'deliverable_unknown'
  // --- the negotiation laws ----------------------------------------------------------------
  | 'quote_mismatch'
  | 'engagement_exists'
  // --- the lifecycle laws --------------------------------------------------------------------
  | 'invalid_transition'
  | 'deliverable_missing'
  | 'deliverable_mismatch'
  | 'deadline_exceeded'
  // --- the verification laws --------------------------------------------------------------------
  | 'verification_required'
  | 'verification_contract_breach'
  | 'verification_missing'
  | 'deliverable_not_importable'
  // --- the payload law ----------------------------------------------------------------------------
  | 'payload_digest_mismatch'
  // --- L4 instant ordering --------------------------------------------------------------------------
  | 'l4_boundary_violation';

/** The closed code list (the vocabulary — pinned by tests). */
export const PROVIDER_ERROR_CODES: readonly ProviderErrorCode[] = Object.freeze([
  'invalid_type',
  'missing_field',
  'invalid_field',
  'invalid_id',
  'invalid_timestamp',
  'tenant_missing',
  'tenant_scope_mismatch',
  'cross_tenant_access',
  'label_as_evidence',
  'evidence_missing',
  'chain_mismatch',
  'provider_unknown',
  'request_unknown',
  'quote_unknown',
  'engagement_unknown',
  'deliverable_unknown',
  'quote_mismatch',
  'engagement_exists',
  'invalid_transition',
  'deliverable_missing',
  'deliverable_mismatch',
  'deadline_exceeded',
  'verification_required',
  'verification_contract_breach',
  'verification_missing',
  'deliverable_not_importable',
  'payload_digest_mismatch',
  'l4_boundary_violation',
] as const satisfies readonly ProviderErrorCode[]);

/** Guard: `ProviderErrorCode`. */
export function isProviderErrorCode(v: unknown): v is ProviderErrorCode {
  return typeof v === 'string' && (PROVIDER_ERROR_CODES as readonly string[]).includes(v);
}

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface ProviderError {
  readonly code: ProviderErrorCode;
  /** Dotted path from the validated root, e.g. `deliverable.claims[1].measuredEvidence`. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ProviderError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: ProviderErrorCode, message: string, path = ''): ProviderResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly ProviderError[]): ProviderResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors: [...errors] };
}

/** Construct a success. */
export function ok<T>(value: T): ProviderResult<T> {
  return { ok: true, value };
}

/** Helper: a missing required field. */
export function missingField(path: string): ProviderError {
  return { code: 'missing_field', path, message: `"${path}" is required` };
}

/** Helper: a present-but-invalid field. */
export function invalidField(path: string, detail: string): ProviderError {
  return { code: 'invalid_field', path, message: detail };
}

/** Helper: a wrong-shaped root value. */
export function invalidType(path: string, detail: string): ProviderError {
  return { code: 'invalid_type', path, message: detail };
}

// ---------------------------------------------------------------------------
// Structural primitives (mirror of T045's primitives.ts)
// ---------------------------------------------------------------------------

/** Nominal tag for otherwise-primitive values (compile-time only). */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** `true` when `v` is a plain object (not an array, not a class instance). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** `true` when `v` is a non-empty string. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** `true` when `v` is a finite number (never NaN/Infinity). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** `true` when `v` is a non-negative integer (0 included). */
export function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** `true` when `v` is a positive integer (0 excluded). */
export function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** `true` when `v` is a member of the closed string vocabulary `vocab`. */
export function isMemberOf<V extends readonly string[]>(vocab: V, v: unknown): v is V[number] {
  return typeof v === 'string' && (vocab as readonly string[]).includes(v);
}

/** `true` when `v` is an array whose every member satisfies `guard`. */
export function isArrayOf<T>(v: unknown, guard: (member: unknown) => member is T): v is readonly T[] {
  return Array.isArray(v) && v.every((member) => guard(member));
}

/** A JSON value (the only payload model this lane accepts). */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** A JSON object. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** `true` when `v` is a total JSON value (no undefined/functions/symbols anywhere). */
export function isJsonValue(v: unknown): v is JsonValue {
  if (v === null) return true;
  if (typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (isRecord(v)) return Object.values(v).every(isJsonValue);
  return false;
}

/** `true` when `v` is a JSON object (a record of JSON values). */
export function isJsonObject(v: unknown): v is JsonObject {
  return isRecord(v) && Object.values(v).every(isJsonValue);
}

/** Recursively freezes a JSON-compatible value (the returned record is immutable). */
export function deepFreeze<T>(value: T): T {
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    value.forEach((member) => deepFreeze(member));
    Object.freeze(value);
    return value;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

/** Deep-clones a JSON value through the JSON model. */
export function deepCloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Canonical JSON serialization: object keys recursively sorted, no
 * whitespace — the same value always yields the same bytes, so digests
 * are stable across processes and key-order differences (the
 * byte-determinism anchor of every content-addressed id in this lane).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return 'null';
}

/** The FNV-1a 32-bit hash of a string, as zero-padded lowercase hex. */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/**
 * One 32-bit FNV-1a round over a UTF-16 code unit, UTF-8 DENORMALIZED
 * (the program-wide round — byte-identical to @tradrl/skills,
 * @tradrl/evaluation, @tradrl/organization, @tradrl/agent-body
 * capability-registry's and @tradrl/capability-provider's).
 */
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
 * The DUAL-LANE stable digest over canonical text: 16 lowercase hex
 * chars — the program-wide fold (the interop test pins byte-parity
 * against the REAL @tradrl/skills and @tradrl/capability-provider).
 */
export function stableDigest(canonical: string): string {
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

/** The stable digest of a JSON value (canonical JSON first — key order can never leak into the digest). */
export function stableDigestJson(value: unknown): string {
  return stableDigest(canonicalJson(value));
}

/** Guard: a 16-hex-char stable digest. */
export function isDigest(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
}

// ---------------------------------------------------------------------------
// The id spaces (mirror of T045's ids.ts — same brand tags, same grammar)
// ---------------------------------------------------------------------------

/** A provider's stable identity (the expert/firm/arena handle — an identifier, never a qualification). */
export type ProviderRef = Brand<string, 'ProviderRef'>;

/** Identity of one provider declaration (the versioned capability catalogue). */
export type ProviderDeclarationId = Brand<string, 'ProviderDeclarationId'>;

/** Identity of one capability request (the platform's engagement request envelope). */
export type CapabilityRequestId = Brand<string, 'CapabilityRequestId'>;

/** Identity of one provider quote (the provider's answer to a request). */
export type ProviderQuoteId = Brand<string, 'ProviderQuoteId'>;

/** Identity of one engagement (the negotiated, verification-bound contract). */
export type EngagementId = Brand<string, 'EngagementId'>;

/** Identity of one deliverable (the provider's submitted work). */
export type DeliverableId = Brand<string, 'DeliverableId'>;

/** Identity of one provider-verification report (the platform's typed verdict). */
export type ProviderVerificationReportId = Brand<string, 'ProviderVerificationReportId'>;

/** Capability-contract key — mirror of the T017 language (a capability CONTRACT, never a profession label — L16a). */
export type CapabilityKey = Brand<string, 'CapabilityKey'>;

/** Tenant id — mirror of the T017 language (opaque non-empty). */
export type TenantId = Brand<string, 'TenantId'>;

/** Project id — mirror of the T017 language (opaque non-empty). */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Capability-gap id — mirror of the T017 language (identifier pattern). */
export type CapabilityGapId = Brand<string, 'CapabilityGapId'>;

/** Attainment-evidence ref — mirror of the T017 language (opaque-ref pattern). */
export type AttainmentEvidenceRef = Brand<string, 'AttainmentEvidenceRef'>;

/** Evidence-capsule ref — mirror of the T017 language (opaque-ref pattern). */
export type EvidenceRef = Brand<string, 'EvidenceRef'>;

/** Skill-record id — mirror of the T017 language (identifier pattern). */
export type SkillRecordId = Brand<string, 'SkillRecordId'>;

/** Skill-artifact ref — mirror of the T017 language (opaque-ref pattern). */
export type SkillArtifactRef = Brand<string, 'SkillArtifactRef'>;

/** Environment-profile ref — mirror of the T017 language (opaque). */
export type EnvironmentProfileRef = Brand<string, 'EnvironmentProfileRef'>;

/** Instrument-class ref — mirror of the T017 language (opaque). */
export type InstrumentClassRef = Brand<string, 'InstrumentClassRef'>;

/** Extraction-version ref — mirror of the T017 language (non-empty opaque). */
export type ExtractionVersionRef = Brand<string, 'ExtractionVersionRef'>;

/** Identifier pattern — mirror of the skills/organization lane guard (`[A-Za-z0-9][A-Za-z0-9._:-]{0,255}`). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function isIdentifierString(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

/** Opaque-ref pattern — mirror of the skills lane (non-space bounded, <= 1024 chars). */
const OPAQUE_REF_PATTERN = /^[^\s](.{0,1022}[^\s])?$/u;

/**
 * The opaque-ref law — mirror of the skills lane's `isOpaqueRefString`
 * EXACTLY: non-space bounded shape, at most 1024 chars, and NO control
 * characters (the real lane excludes `[\u0000-\u001f]`; this mirror
 * accepts nothing the real lane would reject).
 */
function isOpaqueRefString(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= 1024 &&
    OPAQUE_REF_PATTERN.test(v) &&
    !/[\u0000-\u001f]/.test(v)
  );
}

export const isProviderRef = (v: unknown): v is ProviderRef => isIdentifierString(v);
export const isProviderDeclarationId = (v: unknown): v is ProviderDeclarationId => isExchangeIdWithPrefix('pvd', v);
export const isCapabilityRequestId = (v: unknown): v is CapabilityRequestId => isExchangeIdWithPrefix('cpr', v);
export const isProviderQuoteId = (v: unknown): v is ProviderQuoteId => isExchangeIdWithPrefix('qte', v);
export const isEngagementId = (v: unknown): v is EngagementId => isExchangeIdWithPrefix('eng', v);
export const isDeliverableId = (v: unknown): v is DeliverableId => isExchangeIdWithPrefix('dlv', v);
export const isProviderVerificationReportId = (v: unknown): v is ProviderVerificationReportId => isExchangeIdWithPrefix('vrf', v);

/**
 * The owned id grammar of the capability-provider exchange:
 * `<prefix>:<16-hex stable digest>` — a content-addressed identity. The
 * colon is inside the skills lane's identifier alphabet, so these ids
 * flow into T017-shaped records without translation.
 */
export const EXCHANGE_ID_PATTERN = /^(pvd|cpr|qte|eng|dlv|vrf):[0-9a-f]{16}$/;

function isExchangeIdWithPrefix(prefix: string, v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(`${prefix}:`) && isDigest(v.slice(prefix.length + 1));
}

export const isCapabilityKey = (v: unknown): v is CapabilityKey => isIdentifierString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isCapabilityGapId = (v: unknown): v is CapabilityGapId => isIdentifierString(v);
export const isAttainmentEvidenceRef = (v: unknown): v is AttainmentEvidenceRef => isOpaqueRefString(v);
export const isEvidenceRef = (v: unknown): v is EvidenceRef => isOpaqueRefString(v);
export const isSkillRecordId = (v: unknown): v is SkillRecordId => isIdentifierString(v);
export const isSkillArtifactRef = (v: unknown): v is SkillArtifactRef => isOpaqueRefString(v);
export const isEnvironmentProfileRef = (v: unknown): v is EnvironmentProfileRef => isOpaqueRefString(v);
export const isInstrumentClassRef = (v: unknown): v is InstrumentClassRef => isOpaqueRefString(v);
export const isExtractionVersionRef = (v: unknown): v is ExtractionVersionRef => isNonEmptyString(v);

/** Mints `pvd:<digest>` — the provider-declaration id over its canonical identifying content. */
export function deriveProviderDeclarationId(content: unknown): ProviderDeclarationId {
  return `pvd:${stableDigestJson(content)}` as ProviderDeclarationId;
}

/** Mints `cpr:<digest>` — the capability-request id over its canonical identifying content (replay-stable). */
export function deriveCapabilityRequestId(content: unknown): CapabilityRequestId {
  return `cpr:${stableDigestJson(content)}` as CapabilityRequestId;
}

/** Mints `qte:<digest>` — the provider-quote id over its canonical identifying content. */
export function deriveProviderQuoteId(content: unknown): ProviderQuoteId {
  return `qte:${stableDigestJson(content)}` as ProviderQuoteId;
}

/** Mints `eng:<digest>` — the engagement id over its canonical identifying content (request + quote pair). */
export function deriveEngagementId(content: unknown): EngagementId {
  return `eng:${stableDigestJson(content)}` as EngagementId;
}

/** Mints `dlv:<digest>` — the deliverable id over its canonical identifying content. */
export function deriveDeliverableId(content: unknown): DeliverableId {
  return `dlv:${stableDigestJson(content)}` as DeliverableId;
}

/** Mints `vrf:<digest>` — the verification-report id over its canonical identifying content. */
export function deriveProviderVerificationReportId(content: unknown): ProviderVerificationReportId {
  return `vrf:${stableDigestJson(content)}` as ProviderVerificationReportId;
}

// ---------------------------------------------------------------------------
// The T017 capability-language mirrors (mirror of T045's mirrors.ts)
// ---------------------------------------------------------------------------

/**
 * The closed L16a trip-wire vocabulary: the field names that make a
 * record cite a PROFESSION/ROLE LABEL (spec/CAPABILITY-DISCOVERY.md
 * "Never equate model and profession"; L19 — no professional
 * qualification inference). A provider record (or any nested object
 * within it) carrying one of these keys fails validation with
 * `label_as_evidence`.
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

/** The closed measured-evidence kind vocabulary. */
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

/** The closed structured-metric vocabulary. */
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

/** Benchmark evidence: a named benchmark run plus its opaque result reference. */
export interface BenchmarkEvidenceMirror {
  readonly kind: 'benchmark';
  /** Opaque benchmark-suite identity (the benchmark lane owns the referent). */
  readonly benchmarkId: string;
  /** Opaque reference to the recorded result of running the benchmark. */
  readonly resultRef: string;
}

/** A structured measurement record reference with its metric and value. */
export interface MeasurementRecordEvidenceMirror {
  readonly kind: 'measurement-record';
  /** Opaque reference to the full measurement record (environment, config). */
  readonly recordRef: string;
  /** Which structured metric the value carries. */
  readonly metric: MeasurementMetricMirror;
  /** The measured value (finite; interpretation is the reader's). */
  readonly value: number;
}

/** An opaque result reference (raw evidence capsule, no structured metric). */
export interface ResultRefEvidenceMirror {
  readonly kind: 'result-ref';
  /** Opaque reference to the result capsule. */
  readonly resultRef: string;
}

/**
 * One piece of MEASURED evidence backing a capability claim. There is
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

/** The skill origin vocabulary — `imported-artifact` is the L18 local-import path this lane feeds. */
export const SKILL_ORIGINS_MIRROR = ['recorded-experience', 'imported-artifact'] as const;

/** One skill origin (mirror). */
export type SkillOriginMirror = (typeof SKILL_ORIGINS_MIRROR)[number];

/** Guard: `SkillOriginMirror`. */
export function isSkillOriginMirror(v: unknown): v is SkillOriginMirror {
  return isMemberOf(SKILL_ORIGINS_MIRROR, v);
}

/**
 * Where a skill applies: environments and instrument classes, as OPAQUE
 * references. Both may be empty — an empty applicability block means
 * "no declared scope restriction", never "invented scope".
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

/** The closed failure-class vocabulary of the typed capability gap. */
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

/**
 * One typed capability gap — the commissioning evidence of a capability
 * request: "persistent gap -> optional expertise request"
 * (spec/LEARNING-LOOP.md "Human augmentation").
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
// The TimestampMs mirror (T045's own brand — canonical owner:
// @tradrl/time-engine; the capability-provider lane brands its instants
// exactly this way, so the envelope shapes stay mutually assignable)
// ---------------------------------------------------------------------------

/** An epoch-millisecond instant — STRUCTURAL MIRROR of T045's primitives.ts TimestampMs. */
export type TimestampMs = Brand<number, 'TimestampMs'>;

/** The representable instant floor (1970-01-01T00:00:00Z). */
export const MIN_TIMESTAMP_MS = 0 as TimestampMs;

/** The representable instant ceiling (the program-wide mirror constant, ~year 275760). */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999 as TimestampMs;

/** Guard: `TimestampMs` (integer epoch ms within the representable window). */
export function isTimestampMs(v: unknown): v is TimestampMs {
  return typeof v === 'number' && Number.isInteger(v) && v >= (MIN_TIMESTAMP_MS as number) && v <= (MAX_TIMESTAMP_MS as number);
}

/** Constructs a `TimestampMs`, throwing on invalid input (the explicit-instant discipline). */
export function timestampMs(value: number): TimestampMs {
  if (!isTimestampMs(value)) {
    throw new TypeError(`timestampMs: invalid epoch-millisecond instant ${JSON.stringify(value)}`);
  }
  return value;
}
