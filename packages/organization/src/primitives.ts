// @tradrl/organization — shared contract primitives.
//
// Owning Work Order: T016 (frozen write surface: packages/organization,
// services/organization-compiler; plus the absorbed agent-body capability
// registry and its contract doc per D-006/D-007).
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L9 (reproducible lineage —
// canonical serialization and stable digests make every derived record
// byte-deterministic), L11 (search integrity), L12 (tenant isolation —
// every record carries TenantId + ProjectId), L16a (labels alone never
// establish suitability); spec/ARCHITECTURE.md ("Organization compiler");
// spec/LEARNING-LOOP.md ("Organization learning": "Search over agent count,
// specializations, bodies, models, communication topology, training
// allocation, decision cadence and adversarial population.").
//
// Package laws (mirroring @tradrl/evaluation and @tradrl/control-domain):
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape has a hand-rolled total type guard.
// - All contract data is JSON-serializable (no Dates, Maps, Sets; brands
//   are compile-time only) so organization records are portable across
//   processes and byte-stable under canonical serialization.
// - No ambient clock anywhere (`Date.now()` never appears) — every instant
//   is an explicit parameter, so the search is replayable and
//   byte-deterministic (the determinism law).
// - Cross-lane entities (agent-os, control-domain, evaluation, agent-body)
//   are referenced ONLY through opaque branded string ids — STRUCTURAL
//   MIRRORS, never imports (program decisions D-003/D-004). The
//   cross-package trip wires live in src/interop.test.ts.
//
// Brand discipline: this package uses STRING-KEYED phantom brands
// (`__brand: B`), the same discipline as @tradrl/control-domain and
// @tradrl/evaluation, so mirrors whose tag strings match their canonical
// owners' tags are mutually assignable at compile time (the trip wire
// proves it). @tradrl/agent-body and @tradrl/agent-os id brands are
// declared with module-local `unique symbol`s, so THOSE mirrors are proven
// by runtime guard parity instead (interop.test.ts) — the same split the
// merged packages already practice.

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

/** Guard: a finite number in the closed interval [0, 1] (ratios, scores). */
export function isUnitInterval(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
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

/** Guard: an identifier-path string (`a.b.c`) — mirror of control-domain. */
const IDENTIFIER_PATH_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/;

/** Guard: an identifier path (`attainment.satisfiedRatio`) — the same address space as control-domain criterion metrics. */
export function isIdentifierPath(v: unknown): v is string {
  return typeof v === 'string' && IDENTIFIER_PATH_PATTERN.test(v);
}

/** Guard: a closed string-union member. */
export function isMemberOf<const V extends readonly string[]>(
  values: V,
  v: unknown,
): v is V[number] {
  return typeof v === 'string' && (values as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of the L9/L11 discipline)
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
 * Compiled organization records must pass this check: a record that can be
 * mutated after publication is not a contract record.
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

// ---------------------------------------------------------------------------
// Canonical JSON + stable digest (program-wide law — mirror of evaluation)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization of any JSON value: object keys recursively
 * sorted (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values always serialize
 * byte-identically — the determinism anchor for the search-run id, the
 * registry snapshot digest binding and the reproducibility serializer
 * (L9). Byte-identical to @tradrl/evaluation's `canonicalJson` and to
 * @tradrl/agent-body's `registryCanonicalJson` (the program-wide law); the
 * cross-package trip wire lives in interop.test.ts.
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
 * to @tradrl/evaluation's `stableDigest` and @tradrl/agent-body's
 * `registryStableDigest`; NOT cryptographic — it is the change-detection
 * digest L9 lineage binding needs.
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
// @tradrl/control-domain / @tradrl/evaluation (DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/**
 * A validated epoch-millisecond timestamp (brand is compile-time only).
 * Canonical definition: `@tradrl/time-engine`; re-declared identically by
 * the control plane (T007) and the evaluation lane (T012) — this package
 * mirrors the SAME tag so the three declarations are mutually assignable.
 * The organization search NEVER reads a wall clock; every instant it
 * records is derived from explicit input instants (the determinism law).
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

// ---------------------------------------------------------------------------
// Branded ids and opaque cross-lane references
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const OPAQUE_REF_PATTERN = /^[^\s](.{0,1022}[^\s])?$/u;

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

// --- Ids whose brand tags match @tradrl/control-domain (T007) — mutually
// assignable; the compile-time trip wire lives in interop.test.ts. --------

/** Opaque reference to a goal record — mirror of control-domain `GoalRef`. */
export type GoalRef = Brand<string, 'GoalRef'>;

/** Opaque reference to a constraint-set record — mirror of control-domain `ConstraintSetRef`. */
export type ConstraintSetRef = Brand<string, 'ConstraintSetRef'>;

/** Project identity — mirror of control-domain `ProjectId` (shared program-wide space, L12). */
export type ProjectId = Brand<string, 'ProjectId'>;

/**
 * Opaque reference to a compiled organization — mirror of control-domain
 * `OrganizationRef` (T016 owns the referent; the control plane binds
 * organizations to projects).
 */
export type OrganizationRef = Brand<string, 'OrganizationRef'>;

/** Tenant scope — mirror of control-domain `TenantId` (L12: one program-wide tenant identity space). */
export type TenantId = Brand<string, 'TenantId'>;

// --- Ids whose brand tags match @tradrl/evaluation (T012) — the
// search-integrity bridge's identity spaces. ------------------------------

/** Trial identity — mirror of evaluation `TrialId` (the bridge names candidates as trials). */
export type TrialId = Brand<string, 'TrialId'>;

/** Comparison-arm identity — mirror of evaluation `ArmId`. */
export type ArmId = Brand<string, 'ArmId'>;

/** Trajectory identity — mirror of evaluation `TrajectoryId`. */
export type TrajectoryId = Brand<string, 'TrajectoryId'>;

/** Experiment identity — mirror of evaluation `ExperimentId`. */
export type ExperimentId = Brand<string, 'ExperimentId'>;

// --- Ids whose brand tags match @tradrl/agent-body's capability registry
// (T016's own absorbed module — also string-keyed, so these mirrors are
// mutually assignable with the registry's declarations). -----------------

/** Capability-contract key — mirror of agent-body registry `CapabilityKey`. */
export type CapabilityKey = Brand<string, 'CapabilityKey'>;

/** Capability record identity — mirror of agent-body registry `CapabilityRecordId`. */
export type CapabilityRecordId = Brand<string, 'CapabilityRecordId'>;

/** Registry snapshot digest — mirror of agent-body registry `RegistryDigest`. */
export type RegistryDigest = Brand<string, 'RegistryDigest'>;

// --- Organization-lane OWNED identity spaces (this package). -------------

/** Identity of one organization candidate within a search log. */
export type CandidateId = Brand<string, 'CandidateId'>;

/** Identity of one organization search run (deterministic derived id). */
export type SearchRunId = Brand<string, 'SearchRunId'>;

/** The seed of a seeded search — the only randomness the search may use. */
export type SearchSeed = Brand<string, 'SearchSeed'>;

/** Versioned compiler identity (e.g. `reference-enumeration/1`). */
export type CompilerVersionRef = Brand<string, 'CompilerVersionRef'>;

/** Identity of one capability gap (failure-driven learning, LEARNING-LOOP). */
export type CapabilityGapId = Brand<string, 'CapabilityGapId'>;

// --- Opaque references into other lanes (runtime parity only — the
// canonical owners brand with module-local unique symbols). --------------

/** Opaque reference to an immutable BodyVersion — owner: @tradrl/agent-body (T003). */
export type BodyVersionRef = Brand<string, 'BodyVersionRef'>;

/** Opaque reference to a CognitiveSubstrate — owner: @tradrl/agent-body (T003). */
export type SubstrateRef = Brand<string, 'SubstrateRef'>;

/** Opaque topic name on the agent-os topic-addressed fabric — owner: @tradrl/agent-os (T006). */
export type TopicName = Brand<string, 'TopicName'>;

/** Opaque reference to attainment evidence — owner: the evaluation lane (T012). */
export type AttainmentEvidenceRef = Brand<string, 'AttainmentEvidenceRef'>;

/** Opaque reference to a risk policy gate — owner: the risk policy lane (T020). */
export type RiskPolicyRef = Brand<string, 'RiskPolicyRef'>;

/** Opaque reference to an adversary blueprint — owner: this lane (T016). */
export type AdversaryBlueprintRef = Brand<string, 'AdversaryBlueprintRef'>;

// --- Guards + factories ------------------------------------------------------

/** Guard: `GoalRef` (opaque). */
export const isGoalRef = (v: unknown): v is GoalRef => isNonEmptyString(v);
/** Guard: `ConstraintSetRef` (opaque). */
export const isConstraintSetRef = (v: unknown): v is ConstraintSetRef => isNonEmptyString(v);
/** Guard: `ProjectId` (opaque). */
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
/** Guard: `OrganizationRef` (opaque). */
export const isOrganizationRef = (v: unknown): v is OrganizationRef => isNonEmptyString(v);
/** Guard: `TenantId` (opaque). */
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
/** Guard: `TrialId` (opaque). */
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
/** Guard: `ArmId` (opaque). */
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
/** Guard: `TrajectoryId` (opaque). */
export const isTrajectoryId = (v: unknown): v is TrajectoryId => isNonEmptyString(v);
/** Guard: `ExperimentId` (opaque). */
export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
/** Guard: `CapabilityKey` (identifier pattern — mirror of the registry guard). */
export const isCapabilityKey = (v: unknown): v is CapabilityKey => isIdentifierString(v);
/** Guard: `CapabilityRecordId` (identifier pattern — mirror of the registry guard). */
export const isCapabilityRecordId = (v: unknown): v is CapabilityRecordId => isIdentifierString(v);
/** Guard: `RegistryDigest` (16 lowercase hex — mirror of the registry guard). */
export const isRegistryDigest = (v: unknown): v is RegistryDigest => isDigest(v);
/** Guard: `CandidateId` (identifier pattern). */
export const isCandidateId = (v: unknown): v is CandidateId => isIdentifierString(v);
/** Guard: `SearchRunId` (identifier pattern). */
export const isSearchRunId = (v: unknown): v is SearchRunId => isIdentifierString(v);
/** Guard: `SearchSeed` (non-empty opaque string). */
export const isSearchSeed = (v: unknown): v is SearchSeed => isNonEmptyString(v);
/** Guard: `CompilerVersionRef` (non-empty opaque string). */
export const isCompilerVersionRef = (v: unknown): v is CompilerVersionRef => isNonEmptyString(v);
/** Guard: `CapabilityGapId` (identifier pattern). */
export const isCapabilityGapId = (v: unknown): v is CapabilityGapId => isIdentifierString(v);
/** Guard: `BodyVersionRef` (opaque). */
export const isBodyVersionRef = (v: unknown): v is BodyVersionRef => isOpaqueRefString(v);
/** Guard: `SubstrateRef` (opaque). */
export const isSubstrateRef = (v: unknown): v is SubstrateRef => isOpaqueRefString(v);
/** Guard: `TopicName` (identifier pattern — runtime parity with agent-os). */
export const isTopicName = (v: unknown): v is TopicName => isIdentifierString(v);
/** Guard: `AttainmentEvidenceRef` (opaque). */
export const isAttainmentEvidenceRef = (v: unknown): v is AttainmentEvidenceRef => isOpaqueRefString(v);
/** Guard: `RiskPolicyRef` (opaque). */
export const isRiskPolicyRef = (v: unknown): v is RiskPolicyRef => isOpaqueRefString(v);
/** Guard: `AdversaryBlueprintRef` (opaque). */
export const isAdversaryBlueprintRef = (v: unknown): v is AdversaryBlueprintRef => isOpaqueRefString(v);

/** Constructs a `GoalRef`, throwing `TypeError` on invalid input. */
export function goalRef(value: string): GoalRef {
  if (!isGoalRef(value)) throw new TypeError(`goalRef: invalid opaque reference ${JSON.stringify(value)}`);
  return value as GoalRef;
}

/** Constructs a `ConstraintSetRef`, throwing `TypeError` on invalid input. */
export function constraintSetRef(value: string): ConstraintSetRef {
  if (!isConstraintSetRef(value)) throw new TypeError(`constraintSetRef: invalid opaque reference ${JSON.stringify(value)}`);
  return value as ConstraintSetRef;
}

/** Constructs a `ProjectId`, throwing `TypeError` on invalid input. */
export function projectId(value: string): ProjectId {
  if (!isProjectId(value)) throw new TypeError(`projectId: invalid opaque reference ${JSON.stringify(value)}`);
  return value as ProjectId;
}

/** Constructs an `OrganizationRef`, throwing `TypeError` on invalid input. */
export function organizationRef(value: string): OrganizationRef {
  if (!isOrganizationRef(value)) throw new TypeError(`organizationRef: invalid opaque reference ${JSON.stringify(value)}`);
  return value as OrganizationRef;
}

/** Constructs a `TenantId`, throwing `TypeError` on invalid input. */
export function tenantId(value: string): TenantId {
  if (!isTenantId(value)) throw new TypeError(`tenantId: invalid opaque reference ${JSON.stringify(value)}`);
  return value as TenantId;
}

/** Constructs a `CapabilityKey`, throwing `TypeError` on invalid input. */
export function capabilityKey(value: string): CapabilityKey {
  if (!isCapabilityKey(value)) throw new TypeError(`capabilityKey: invalid key ${JSON.stringify(value)} — must match ${ID_PATTERN.source}`);
  return value as CapabilityKey;
}

/** Constructs a `CapabilityRecordId`, throwing `TypeError` on invalid input. */
export function capabilityRecordId(value: string): CapabilityRecordId {
  if (!isCapabilityRecordId(value)) throw new TypeError(`capabilityRecordId: invalid id ${JSON.stringify(value)} — must match ${ID_PATTERN.source}`);
  return value as CapabilityRecordId;
}

/** Constructs a `CandidateId`, throwing `TypeError` on invalid input. */
export function candidateId(value: string): CandidateId {
  if (!isCandidateId(value)) throw new TypeError(`candidateId: invalid id ${JSON.stringify(value)} — must match ${ID_PATTERN.source}`);
  return value as CandidateId;
}

/** Constructs a `SearchSeed`, throwing `TypeError` on invalid input. */
export function searchSeed(value: string): SearchSeed {
  if (!isSearchSeed(value)) throw new TypeError(`searchSeed: the search must be seeded — seed ${JSON.stringify(value)} is not a non-empty string`);
  return value as SearchSeed;
}

/** Constructs a `CompilerVersionRef`, throwing `TypeError` on invalid input. */
export function compilerVersionRef(value: string): CompilerVersionRef {
  if (!isCompilerVersionRef(value)) throw new TypeError(`compilerVersionRef: invalid version reference ${JSON.stringify(value)}`);
  return value as CompilerVersionRef;
}

/** Constructs a `CapabilityGapId`, throwing `TypeError` on invalid input. */
export function capabilityGapId(value: string): CapabilityGapId {
  if (!isCapabilityGapId(value)) throw new TypeError(`capabilityGapId: invalid id ${JSON.stringify(value)} — must match ${ID_PATTERN.source}`);
  return value as CapabilityGapId;
}

/** Constructs a `BodyVersionRef`, throwing `TypeError` on invalid input. */
export function bodyVersionRef(value: string): BodyVersionRef {
  if (!isBodyVersionRef(value)) throw new TypeError(`bodyVersionRef: invalid opaque reference ${JSON.stringify(value)}`);
  return value as BodyVersionRef;
}

/** Constructs a `SubstrateRef`, throwing `TypeError` on invalid input. */
export function substrateRef(value: string): SubstrateRef {
  if (!isSubstrateRef(value)) throw new TypeError(`substrateRef: invalid opaque reference ${JSON.stringify(value)}`);
  return value as SubstrateRef;
}

/** Constructs a `TopicName`, throwing `TypeError` on invalid input. */
export function topicName(value: string): TopicName {
  if (!isTopicName(value)) throw new TypeError(`topicName: invalid topic ${JSON.stringify(value)} — must match ${ID_PATTERN.source}`);
  return value as TopicName;
}

/** Constructs an `AttainmentEvidenceRef`, throwing `TypeError` on invalid input. */
export function attainmentEvidenceRef(value: string): AttainmentEvidenceRef {
  if (!isAttainmentEvidenceRef(value)) throw new TypeError(`attainmentEvidenceRef: invalid opaque reference ${JSON.stringify(value)}`);
  return value as AttainmentEvidenceRef;
}

/** Constructs a `RiskPolicyRef`, throwing `TypeError` on invalid input. */
export function riskPolicyRef(value: string): RiskPolicyRef {
  if (!isRiskPolicyRef(value)) throw new TypeError(`riskPolicyRef: invalid opaque reference ${JSON.stringify(value)}`);
  return value as RiskPolicyRef;
}

/** Constructs an `AdversaryBlueprintRef`, throwing `TypeError` on invalid input. */
export function adversaryBlueprintRef(value: string): AdversaryBlueprintRef {
  if (!isAdversaryBlueprintRef(value)) throw new TypeError(`adversaryBlueprintRef: invalid opaque reference ${JSON.stringify(value)}`);
  return value as AdversaryBlueprintRef;
}

// ---------------------------------------------------------------------------
// Deterministic seeded draws (no ambient randomness — the determinism law)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash of a string, as an unsigned 32-bit integer. */
function fnv1a32(text: string): number {
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
 * @tradrl/environment-runner's `createSeededRandom`). The SAME seed always
 * yields the SAME sequence. This is the ONLY randomness the organization
 * search may touch: every draw is a pure function of the seed material,
 * so the search is deterministic and replayable (the seed participates in
 * lineage, L9).
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

/**
 * One stateless deterministic draw in [0, 1), keyed by (seed, scope, index).
 * Pure — no generator state is retained between calls.
 */
export function seededDraw(seed: string, scope: string, index: number): number {
  return createSeededRandom(`${seed}|${scope}|${index}`)();
}
