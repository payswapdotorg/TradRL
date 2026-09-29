// @tradrl/skills — shared contract primitives.
//
// Owning Work Order: T017 (frozen write surface: packages/skills,
// services/body-forge).
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L9 (reproducible lineage —
// canonical serialization and stable digests make every derived record
// byte-deterministic), L11 (search integrity — optimization history is
// retained), L12 (tenant isolation — every record carries TenantId +
// ProjectId), L16a (labels alone never establish suitability); spec/
// LEARNING-LOOP.md ("skill extraction -> Body Version -> compatibility ->
// shadow"); spec/CAPABILITY-DISCOVERY.md (Reproducibility, "Never equate
// model and profession").
//
// Package laws (mirroring @tradrl/organization and @tradrl/evaluation):
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape has a hand-rolled total type guard.
// - All contract data is JSON-serializable (no Dates, Maps, Sets; brands
//   are compile-time only) so skill records are portable across processes
//   and byte-stable under canonical serialization.
// - No ambient clock anywhere (`Date.now()` never appears) — every instant
//   is an explicit parameter, so extraction and forging are replayable and
//   byte-deterministic (the determinism law).
// - Cross-lane entities (agent-body, trajectory, experiments, evaluation,
//   organization) are referenced ONLY through opaque branded string ids —
//   STRUCTURAL MIRRORS, never imports (program decisions D-003/D-004). The
//   cross-package trip wires live in src/interop.test.ts.
//
// Brand discipline: this package uses STRING-KEYED phantom brands
// (`__brand: B`), the same discipline as @tradrl/control-domain,
// @tradrl/evaluation and @tradrl/organization, so mirrors whose tag strings
// match their canonical owners' tags are mutually assignable at compile
// time (the trip wire proves it). @tradrl/agent-body id brands are declared
// with module-local `unique symbol`s, so THOSE mirrors are proven by runtime
// guard parity instead (interop.test.ts) — the same split the merged
// packages already practice.

// ---------------------------------------------------------------------------
// Compile-time branding
// ---------------------------------------------------------------------------

/**
 * Nominal tag for otherwise-primitive values. The brand exists only at
 * compile time; at runtime this is the underlying primitive. Obtain branded
 * values ONLY through the validating constructors/guards of this package.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Strips `readonly` modifiers — used by tests to attempt mutations. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Structural type-check helpers (hand-rolled, `any`-free)
// ---------------------------------------------------------------------------

/** Guard: a plain object (not an array, not a class instance). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Guard: a string with at least one non-whitespace character. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Guard: a finite JS number (NaN, +/-Infinity rejected). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Guard: an integer >= 0 (counts). */
export function isNonNegativeInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0;
}

/** Guard: an integer >= 1. */
export function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 1;
}

/** Guard: an array whose every element satisfies `guard`. */
export function isArrayOf<T>(
  v: unknown,
  guard: (item: unknown) => item is T,
): v is readonly T[] {
  return Array.isArray(v) && v.every((item) => guard(item));
}

/** Guard: a closed string-union member. */
export function isMemberOf<const V extends readonly string[]>(
  values: V,
  v: unknown,
): v is V[number] {
  return typeof v === 'string' && (values as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of the L3/L11 discipline)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze`s every reachable plain object and array.
 * Already-frozen branches are skipped, so cycles terminate. Returns the
 * same reference, now deeply frozen.
 */
export function deepFreeze<T>(value: T): T {
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

/**
 * `true` when every reachable plain object and array is `Object.isFrozen`.
 * Compiled skill records must pass this check: a record that can be mutated
 * after publication is not a contract record.
 */
export function isDeeplyFrozen(value: unknown): boolean {
  const visited = new Set<unknown>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (!Object.isFrozen(current)) return false;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else {
      for (const key of Object.keys(current)) {
        stack.push((current as Record<string, unknown>)[key]);
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// JSON value model
// ---------------------------------------------------------------------------

/** Recursive JSON value model. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

/** A JSON object (record of JSON values). */
export type JsonObject = { readonly [key: string]: JsonValue };

/** Runtime guard for a JSON value (deep). */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((element) => isJsonValue(element));
  if (typeof value === 'object') {
    return Object.values(value).every((element) => isJsonValue(element));
  }
  return false;
}

/** Runtime guard for a JSON object. */
export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((element) => isJsonValue(element));
}

/** Deep-clones JSON-serializable contract data (round-trips through JSON). */
export function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Canonical JSON + stable digest (program-wide law — mirror of evaluation)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization of any JSON value: object keys recursively
 * sorted (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values always serialize
 * byte-identically — the determinism anchor for every derived identity in
 * this package (L9). Byte-identical to @tradrl/evaluation's `canonicalJson`,
 * @tradrl/organization's `canonicalJson` and @tradrl/agent-body's
 * `registryCanonicalJson` (the program-wide law); the cross-package trip
 * wire lives in interop.test.ts.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value); // finite by the JSON model
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const object = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
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
 * hand-rolled — identical inputs ALWAYS digest identically. Byte-identical
 * to @tradrl/evaluation's `stableDigest`, @tradrl/organization's
 * `stableDigest` and @tradrl/agent-body's `registryStableDigest`; NOT
 * cryptographic — it is the change-detection digest L9 lineage binding
 * needs.
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

/**
 * Stable digest of any JSON value through the canonical form:
 * `stableDigestJson(v) === stableDigest(canonicalJson(v))`.
 */
export function stableDigestJson(value: JsonValue): string {
  return stableDigest(canonicalJson(value));
}

/** Guard: a well-formed 16-character lowercase hex digest. */
export function isDigest(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
}

// ---------------------------------------------------------------------------
// TimestampMs — structural mirror of @tradrl/time-engine via
// @tradrl/control-domain / @tradrl/evaluation / @tradrl/organization
// (DO NOT DIVERGE — program-wide tag 'TradRL.TimestampMs')
// ---------------------------------------------------------------------------

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * Canonical definition: `@tradrl/time-engine`; re-declared identically by
 * the control plane, the evaluation lane, the organization lane and the
 * trajectory lane. This package NEVER reads a wall clock; every instant it
 * records is an explicit input (the determinism law).
 */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** Lower bound of the representable range (the Unix epoch). Mirror. */
export const MIN_TIMESTAMP_MS = 0;

/** Upper bound of the representable range (last ECMAScript Date instant). Mirror. */
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Runtime guard — mirrors `isTimestampMs` from the canonical owners. */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_TIMESTAMP_MS &&
    value <= MAX_TIMESTAMP_MS
  );
}

/** Constructs a `TimestampMs`, throwing `TypeError` on invalid input. */
export function timestampMs(value: number): TimestampMs {
  if (!isTimestampMs(value)) {
    throw new TypeError(
      `timestampMs: invalid epoch-millisecond instant ${JSON.stringify(value)}`,
    );
  }
  return value as TimestampMs;
}

// ---------------------------------------------------------------------------
// Branded ids and opaque cross-lane references
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const OPAQUE_REF_PATTERN = /^[^\s](.{0,1022}[^\s])?$/u;
const BODY_VERSION_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isIdentifierString(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

function isOpaqueRefString(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= 1024 &&
    OPAQUE_REF_PATTERN.test(v) &&
    !/[\u0000-\u001f]/.test(v)
  );
}

// --- Ids whose brand tags match @tradrl/domain-core (T002) / control-
// domain (T007) / evaluation (T012) / organization (T016) — mutually
// assignable; the compile-time trip wire lives in interop.test.ts. -------

/** Tenant scope — mirror of domain-core `TenantId` (L12: one program-wide tenant identity space). */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root — mirror of domain-core `ProjectId` (L15/L12). */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Trajectory identity — mirror of evaluation/trajectory `TrajectoryId` (T011/T012). */
export type TrajectoryId = Brand<string, 'TrajectoryId'>;

/** Experiment identity — mirror of evaluation `ExperimentId` (T011/T012). */
export type ExperimentId = Brand<string, 'ExperimentId'>;

/** Trial identity — mirror of evaluation `TrialId` (T011/T012). */
export type TrialId = Brand<string, 'TrialId'>;

/** Comparison-arm identity — mirror of evaluation/experiments `ArmId` (T011/T012). */
export type ArmId = Brand<string, 'ArmId'>;

/** Attainment-verdict identity — mirror of evaluation `VerdictId` (T012). */
export type VerdictId = Brand<string, 'VerdictId'>;

// --- Ids whose brand tags match @tradrl/agent-body's capability registry
// (T016's absorbed module — string-keyed, so these mirrors are mutually
// assignable with the registry's declarations). --------------------------

/** Capability-contract key — mirror of agent-body registry `CapabilityKey`. */
export type CapabilityKey = Brand<string, 'CapabilityKey'>;

/** Capability record identity — mirror of agent-body registry `CapabilityRecordId`. */
export type CapabilityRecordId = Brand<string, 'CapabilityRecordId'>;

// --- Ids whose brand tags match @tradrl/organization (T016) — the gap
// and evidence spaces the forge's commission inputs live in. -------------

/** Identity of one capability gap — mirror of organization `CapabilityGapId`. */
export type CapabilityGapId = Brand<string, 'CapabilityGapId'>;

/** Opaque attainment-evidence reference — mirror of organization `AttainmentEvidenceRef` (evaluation lane owns the referents). */
export type AttainmentEvidenceRef = Brand<string, 'AttainmentEvidenceRef'>;

// --- Skills-lane OWNED identity spaces (this package, T017). -------------

/** Identity of one evidence-backed skill record. */
export type SkillRecordId = Brand<string, 'SkillRecordId'>;

/**
 * The opaque skill-artifact reference `@tradrl/agent-body`'s
 * `BodyCapability.skillArtifactRefs` cite (T003 declares the space; T017
 * owns and mints the referents). Runtime parity with agent-body's
 * `isSkillArtifactRef` (opaque-ref pattern) is asserted in interop.test.ts.
 */
export type SkillArtifactRef = Brand<string, 'SkillArtifactRef'>;

/** Identity of one composable skill delta. */
export type SkillDeltaId = Brand<string, 'SkillDeltaId'>;

/** Identity of one certification record (certified-or-rejected decision). */
export type CertificationRecordId = Brand<string, 'CertificationRecordId'>;

/** Versioned extraction-protocol identity (e.g. `reference-extraction/1`). */
export type ExtractionVersionRef = Brand<string, 'ExtractionVersionRef'>;

/** Versioned body-forge identity (the reference forge lives in services/body-forge). */
export type ForgeVersionRef = Brand<string, 'ForgeVersionRef'>;

// --- Opaque references into other lanes (runtime parity only — the
// canonical owners brand with module-local unique symbols). --------------

/**
 * Canonical immutable BodyVersion reference (`${bodyId}@${semver}`) —
 * owner: @tradrl/agent-body (T003). Guard enforces the canonical shape at
 * runtime parity with agent-body's `isBodyVersionId`.
 */
export type BodyVersionRef = Brand<string, 'BodyVersionRef'>;

/** Opaque reference to a CognitiveSubstrate — owner: @tradrl/agent-body (T003). */
export type SubstrateRef = Brand<string, 'SubstrateRef'>;

/** Opaque reference to an environment profile — owner: @tradrl/agent-body (T003, evaluationEnvironment). */
export type EnvironmentProfileRef = Brand<string, 'EnvironmentProfileRef'>;

/** Opaque tool reference — owner: the tooling/environment lanes (T005/T006). */
export type ToolRef = Brand<string, 'ToolRef'>;

/** Opaque knowledge-source reference — owner: the knowledge/data lanes (T008/T026/T034). */
export type KnowledgeSourceRef = Brand<string, 'KnowledgeSourceRef'>;

/** Opaque evidence-capsule reference — owner: the evidence subsystem (T012). */
export type EvidenceRef = Brand<string, 'EvidenceRef'>;

/** Opaque instrument-class reference — owner: the market/data lanes (T004/T008). */
export type InstrumentClassRef = Brand<string, 'InstrumentClassRef'>;

/** Opaque compatibility-verdict reference — owner: the compatibility testing run records (T003/T012). */
export type CompatibilityVerdictRef = Brand<string, 'CompatibilityVerdictRef'>;

// --- Guards -------------------------------------------------------------------

/** Guard: `TenantId` (opaque). */
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
/** Guard: `ProjectId` (opaque). */
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
/** Guard: `TrajectoryId` (opaque). */
export const isTrajectoryId = (v: unknown): v is TrajectoryId => isNonEmptyString(v);
/** Guard: `ExperimentId` (opaque). */
export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
/** Guard: `TrialId` (opaque). */
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
/** Guard: `ArmId` (opaque — mirror of the experiments/evaluation guards). */
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
/** Guard: `VerdictId` (opaque). */
export const isVerdictId = (v: unknown): v is VerdictId => isNonEmptyString(v);
/** Guard: `CapabilityKey` (identifier pattern — mirror of the registry guard). */
export const isCapabilityKey = (v: unknown): v is CapabilityKey => isIdentifierString(v);
/** Guard: `CapabilityRecordId` (identifier pattern — mirror of the registry guard). */
export const isCapabilityRecordId = (v: unknown): v is CapabilityRecordId => isIdentifierString(v);
/** Guard: `CapabilityGapId` (identifier pattern — mirror of the organization guard). */
export const isCapabilityGapId = (v: unknown): v is CapabilityGapId => isIdentifierString(v);
/** Guard: `AttainmentEvidenceRef` (opaque — mirror of the organization guard). */
export const isAttainmentEvidenceRef = (v: unknown): v is AttainmentEvidenceRef => isOpaqueRefString(v);
/** Guard: `SkillRecordId` (identifier pattern). */
export const isSkillRecordId = (v: unknown): v is SkillRecordId => isIdentifierString(v);
/** Guard: `SkillArtifactRef` (opaque-ref pattern — runtime parity with agent-body). */
export const isSkillArtifactRef = (v: unknown): v is SkillArtifactRef => isOpaqueRefString(v);
/** Guard: `SkillDeltaId` (identifier pattern). */
export const isSkillDeltaId = (v: unknown): v is SkillDeltaId => isIdentifierString(v);
/** Guard: `CertificationRecordId` (identifier pattern). */
export const isCertificationRecordId = (v: unknown): v is CertificationRecordId => isIdentifierString(v);
/** Guard: `ExtractionVersionRef` (non-empty opaque string). */
export const isExtractionVersionRef = (v: unknown): v is ExtractionVersionRef => isNonEmptyString(v);
/** Guard: `ForgeVersionRef` (non-empty opaque string). */
export const isForgeVersionRef = (v: unknown): v is ForgeVersionRef => isNonEmptyString(v);
/** Guard: `BodyVersionRef` (canonical `${bodyId}@${semver}` — runtime parity with agent-body's `isBodyVersionId`). */
export const isBodyVersionRef = (v: unknown): v is BodyVersionRef =>
  typeof v === 'string' && BODY_VERSION_REF_PATTERN.test(v);
/** Guard: `SubstrateRef` (opaque — runtime parity with agent-body's opaque-ref shape). */
export const isSubstrateRef = (v: unknown): v is SubstrateRef => isOpaqueRefString(v);
/** Guard: `EnvironmentProfileRef` (opaque). */
export const isEnvironmentProfileRef = (v: unknown): v is EnvironmentProfileRef => isOpaqueRefString(v);
/** Guard: `ToolRef` (opaque — runtime parity with agent-body). */
export const isToolRef = (v: unknown): v is ToolRef => isOpaqueRefString(v);
/** Guard: `KnowledgeSourceRef` (opaque — runtime parity with agent-body). */
export const isKnowledgeSourceRef = (v: unknown): v is KnowledgeSourceRef => isOpaqueRefString(v);
/** Guard: `EvidenceRef` (opaque — runtime parity with agent-body). */
export const isEvidenceRef = (v: unknown): v is EvidenceRef => isOpaqueRefString(v);
/** Guard: `InstrumentClassRef` (opaque). */
export const isInstrumentClassRef = (v: unknown): v is InstrumentClassRef => isOpaqueRefString(v);
/** Guard: `CompatibilityVerdictRef` (opaque). */
export const isCompatibilityVerdictRef = (v: unknown): v is CompatibilityVerdictRef => isOpaqueRefString(v);

// --- Factories (throwing `TypeError` on invalid input) ----------------------

/** Constructs a `TenantId`, throwing on invalid input. */
export function tenantId(value: string): TenantId {
  if (!isTenantId(value)) throw new TypeError(`tenantId: invalid tenant id ${JSON.stringify(value)}`);
  return value as TenantId;
}

/** Constructs a `ProjectId`, throwing on invalid input. */
export function projectId(value: string): ProjectId {
  if (!isProjectId(value)) throw new TypeError(`projectId: invalid project id ${JSON.stringify(value)}`);
  return value as ProjectId;
}

/** Constructs a `CapabilityKey`, throwing on invalid input. */
export function capabilityKey(value: string): CapabilityKey {
  if (!isCapabilityKey(value)) {
    throw new TypeError(`capabilityKey: invalid key ${JSON.stringify(value)} — must match ${ID_PATTERN.source}`);
  }
  return value as CapabilityKey;
}

/** Constructs a `CapabilityGapId`, throwing on invalid input. */
export function capabilityGapId(value: string): CapabilityGapId {
  if (!isCapabilityGapId(value)) {
    throw new TypeError(`capabilityGapId: invalid id ${JSON.stringify(value)} — must match ${ID_PATTERN.source}`);
  }
  return value as CapabilityGapId;
}

/** Constructs a `SkillRecordId`, throwing on invalid input. */
export function skillRecordId(value: string): SkillRecordId {
  if (!isSkillRecordId(value)) {
    throw new TypeError(`skillRecordId: invalid id ${JSON.stringify(value)} — must match ${ID_PATTERN.source}`);
  }
  return value as SkillRecordId;
}

/** Constructs a `SkillArtifactRef`, throwing on invalid input. */
export function skillArtifactRef(value: string): SkillArtifactRef {
  if (!isSkillArtifactRef(value)) {
    throw new TypeError(`skillArtifactRef: invalid opaque reference ${JSON.stringify(value)}`);
  }
  return value as SkillArtifactRef;
}

/** Constructs a `SkillDeltaId`, throwing on invalid input. */
export function skillDeltaId(value: string): SkillDeltaId {
  if (!isSkillDeltaId(value)) {
    throw new TypeError(`skillDeltaId: invalid id ${JSON.stringify(value)} — must match ${ID_PATTERN.source}`);
  }
  return value as SkillDeltaId;
}

/** Constructs a `CertificationRecordId`, throwing on invalid input. */
export function certificationRecordId(value: string): CertificationRecordId {
  if (!isCertificationRecordId(value)) {
    throw new TypeError(`certificationRecordId: invalid id ${JSON.stringify(value)} — must match ${ID_PATTERN.source}`);
  }
  return value as CertificationRecordId;
}

/** Constructs an `ExtractionVersionRef`, throwing on invalid input. */
export function extractionVersionRef(value: string): ExtractionVersionRef {
  if (!isExtractionVersionRef(value)) {
    throw new TypeError(`extractionVersionRef: invalid version reference ${JSON.stringify(value)}`);
  }
  return value as ExtractionVersionRef;
}

/** Constructs a `ForgeVersionRef`, throwing on invalid input. */
export function forgeVersionRef(value: string): ForgeVersionRef {
  if (!isForgeVersionRef(value)) {
    throw new TypeError(`forgeVersionRef: invalid version reference ${JSON.stringify(value)}`);
  }
  return value as ForgeVersionRef;
}

/** Constructs a canonical `BodyVersionRef`, throwing on invalid input. */
export function bodyVersionRef(value: string): BodyVersionRef {
  if (!isBodyVersionRef(value)) {
    throw new TypeError(
      `bodyVersionRef: invalid canonical body-version reference ${JSON.stringify(value)} — expected \${bodyId}@\{semver\}`,
    );
  }
  return value as BodyVersionRef;
}

// ---------------------------------------------------------------------------
// Deterministic seeded draws (no ambient randomness — the determinism law)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash of a string, as an unsigned 32-bit integer. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Create a sequential deterministic generator from a seed string
 * (mulberry32 keyed by the FNV-1a hash of the seed — the same algorithm as
 * @tradrl/organization's `createSeededRandom`). The SAME seed always yields
 * the SAME sequence. This is the ONLY randomness extraction or forging may
 * touch: every draw is a pure function of the seed material, so the output
 * is deterministic and replayable (the seed participates in lineage, L9).
 */
export function createSeededRandom(seed: string): () => number {
  let state = fnv1a32(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
