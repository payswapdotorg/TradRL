// @tradrl/agent-body — shared contract primitives.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L2 (body/model separation), L3
// (immutable versioned capability), L13/L14 (provider neutrality / external
// substrates are replaceable), L18/L19; spec/DOMAIN-MODEL.md (AgentBody /
// BodyVersion, CognitiveSubstrate, Possession, AgentInstance).
//
// Laws honored here:
// - Zero runtime dependencies; pure data and pure functions only.
// - All contract data is JSON-serializable (no Dates, Maps, Sets, symbols in
//   serialized shapes; symbol keys are type-level brands only).
// - No `any`; every exported shape has a hand-rolled type guard.
// - Cross-lane entities (T002 trading domain, T004 market/time, T005
//   environment, T006 runtime state, T017 skills, T020 risk) are referenced
//   ONLY through opaque branded string ids — never imported.

// ---------------------------------------------------------------------------
// Structural type-check helpers (hand-rolled, `any`-free)
// ---------------------------------------------------------------------------

/** `true` when `v` is a plain JSON object (not an array, not a class instance). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** `true` when `v` is a finite number (never NaN, never ±Infinity). */
export function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** `true` when `v` is a string. */
export function isString(v: unknown): v is string {
  return typeof v === 'string';
}

/** `true` when `v` is a boolean. */
export function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

/** `true` when `v` is exactly `null`. */
export function isNull(v: unknown): v is null {
  return v === null;
}

/** `true` when `v` is a non-empty string after trimming. */
export function isNonEmptyString(v: unknown): v is string {
  return isString(v) && v.trim().length > 0;
}

/** `true` when `v` is an integer `>= 0`. */
export function isNonNegativeInteger(v: unknown): v is number {
  return isNumber(v) && Number.isInteger(v) && v >= 0;
}

/** `true` when `v` is an integer `>= 1`. */
export function isPositiveInteger(v: unknown): v is number {
  return isNumber(v) && Number.isInteger(v) && v >= 1;
}

/** `true` when `v` is an array whose every element satisfies `guard`. */
export function isArrayOf<T>(
  v: unknown,
  guard: (item: unknown) => item is T,
): v is readonly T[] {
  return Array.isArray(v) && v.every((item) => guard(item));
}

/** Builds a guard for a closed string-union type. */
export function isEnum<const V extends readonly string[]>(
  values: V,
): (v: unknown) => v is V[number] {
  const allowed = new Set<string>(values);
  return (v: unknown): v is V[number] => typeof v === 'string' && allowed.has(v);
}

/** Returns the values that occur more than once in `items` (order preserved). */
export function duplicatesOf<T>(items: readonly T[]): readonly T[] {
  const seen = new Set<T>();
  const duplicated = new Set<T>();
  for (const item of items) {
    if (seen.has(item)) duplicated.add(item);
    else seen.add(item);
  }
  return [...duplicated];
}

/** Strips `readonly` modifiers — used by tests to attempt mutations. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Deep immutability (runtime half of ARCHITECTURE-LOCK L3)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze`s every reachable plain object and array.
 * Already-frozen branches are skipped, so cycles terminate and shared frozen
 * substructures cost nothing. Returns the same reference, now deeply frozen.
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
 * This is the runtime guard behind "certified versions never mutate" (L3):
 * a certified record that is not deeply frozen fails this check.
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

/**
 * Deep-clones JSON-serializable contract data (round-trips through JSON).
 * The result is fresh and unfrozen — ready to be validated and re-frozen.
 * Cyclic or non-JSON input throws, which is the correct rejection for
 * contract data (the JSON examples in `contracts/agent/` are the canon).
 */
export function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when a lifecycle state-machine transition is illegal. */
export class IllegalTransitionError extends Error {
  constructor(
    public readonly kind: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`illegal ${kind} transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

// ---------------------------------------------------------------------------
// Branded identifiers (compile-time identity, runtime validation)
// ---------------------------------------------------------------------------

declare const brand: unique symbol;

/** Branded primitive: `T` carrying a phantom kind tag `B` at compile time. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const OPAQUE_REF_PATTERN = /^[^\s](.{0,1022}[^\s])?$/u;

function isValidIdentifierString(v: unknown): v is string {
  return isString(v) && ID_PATTERN.test(v);
}

function identifierError(kind: string, value: string): TypeError {
  return new TypeError(
    `${kind}: invalid identifier ${JSON.stringify(value)} — must match ${ID_PATTERN.source}`,
  );
}

function isValidOpaqueRefString(v: unknown): v is string {
  return isString(v) && v.length <= 1024 && OPAQUE_REF_PATTERN.test(v) && !/[\u0000-\u001f]/.test(v);
}

function opaqueRefError(kind: string, value: string): TypeError {
  return new TypeError(
    `${kind}: invalid opaque reference ${JSON.stringify(value)} — must be 1..1024 chars, trimmed, no control characters`,
  );
}

/** Identity of a persistent Agent Body (stable across versions). */
export type BodyId = Brand<string, 'BodyId'>;
/** Identity of one immutable BodyVersion; canonical form `${bodyId}@${semver}`. */
export type BodyVersionId = Brand<string, 'BodyVersionId'>;
/** Identity of a CognitiveSubstrate; canonical form `${provider}/${modelId}@${modelVersion}`. */
export type SubstrateRef = Brand<string, 'SubstrateRef'>;
/** Identity of a Possession (body×substrate binding). */
export type PossessionId = Brand<string, 'PossessionId'>;
/** Identity of an AgentInstance running at runtime. */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;
/** TradRL-internal substitution class of a substrate (not a vendor name). */
export type SubstitutionClass = Brand<string, 'SubstitutionClass'>;
/** Identity of a provider adapter (L13: vendor specifics stay in adapters). */
export type AdapterId = Brand<string, 'AdapterId'>;

/** Opaque reference — owned by T002 (trading domain). */
export type ProjectRef = Brand<string, 'ProjectRef'>;
/** Opaque reference — owned by T002 (trading domain). */
export type GoalRef = Brand<string, 'GoalRef'>;
/** Opaque reference — owned by T017 (skill extraction / body forge). */
export type SkillArtifactRef = Brand<string, 'SkillArtifactRef'>;
/** Opaque reference — owned by the tooling/environment lane (T005/T006). */
export type ToolRef = Brand<string, 'ToolRef'>;
/** Opaque reference — owned by the knowledge/data lanes (T008/T026/T034). */
export type KnowledgeSourceRef = Brand<string, 'KnowledgeSourceRef'>;
/** Opaque reference — owned by the evidence subsystem (T012/evidence capsules). */
export type EvidenceRef = Brand<string, 'EvidenceRef'>;
/** Opaque reference — owned by T005 (environment protocol). */
export type EnvironmentProfileRef = Brand<string, 'EnvironmentProfileRef'>;
/** Opaque reference — owned by the control-plane policy lanes (T007/T020). */
export type PolicyBundleRef = Brand<string, 'PolicyBundleRef'>;
/** Opaque reference — owned by T020 (risk policy engine). */
export type RiskPolicyRef = Brand<string, 'RiskPolicyRef'>;
/** Opaque handle — the runtime state itself lives in T006's lane. */
export type RuntimeStateRef = Brand<string, 'RuntimeStateRef'>;

// --- Identifier factories ---------------------------------------------------

/** Constructs a `BodyId`, throwing on invalid identifiers. */
export function bodyId(value: string): BodyId {
  if (!isValidIdentifierString(value)) throw identifierError('BodyId', value);
  return value as BodyId;
}

/** Constructs a `BodyVersionId` from its canonical `${bodyId}@${semver}` form. */
export function bodyVersionId(value: string): BodyVersionId {
  const parsed = parseBodyVersionIdString(value);
  if (parsed === null) {
    throw new TypeError(
      `BodyVersionId: invalid ${JSON.stringify(value)} — expected canonical form \${bodyId}@\{semver\}`,
    );
  }
  return value as BodyVersionId;
}

/** Constructs a `SubstrateRef` from its canonical `${provider}/${modelId}@${modelVersion}` form. */
export function substrateRef(value: string): SubstrateRef {
  if (parseSubstrateRefString(value) === null) {
    throw new TypeError(
      `SubstrateRef: invalid ${JSON.stringify(value)} — expected canonical form \${provider}/\{modelId\}@\{modelVersion\}`,
    );
  }
  return value as SubstrateRef;
}

/** Constructs a `PossessionId`, throwing on invalid identifiers. */
export function possessionId(value: string): PossessionId {
  if (!isValidIdentifierString(value)) throw identifierError('PossessionId', value);
  return value as PossessionId;
}

/** Constructs an `AgentInstanceId`, throwing on invalid identifiers. */
export function agentInstanceId(value: string): AgentInstanceId {
  if (!isValidIdentifierString(value)) throw identifierError('AgentInstanceId', value);
  return value as AgentInstanceId;
}

/** Constructs a `SubstitutionClass` (e.g. `frontier-reasoner`), throwing on invalid input. */
export function substitutionClass(value: string): SubstitutionClass {
  if (!isValidIdentifierString(value)) throw identifierError('SubstitutionClass', value);
  return value as SubstitutionClass;
}

/** Constructs an `AdapterId`, throwing on invalid identifiers. */
export function adapterId(value: string): AdapterId {
  if (!isValidIdentifierString(value)) throw identifierError('AdapterId', value);
  return value as AdapterId;
}

// --- Opaque reference factories ---------------------------------------------

/** Constructs a `ProjectRef` (opaque; owned by T002). */
export function projectRef(value: string): ProjectRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('ProjectRef', value);
  return value as ProjectRef;
}

/** Constructs a `GoalRef` (opaque; owned by T002). */
export function goalRef(value: string): GoalRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('GoalRef', value);
  return value as GoalRef;
}

/** Constructs a `SkillArtifactRef` (opaque; owned by T017). */
export function skillArtifactRef(value: string): SkillArtifactRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('SkillArtifactRef', value);
  return value as SkillArtifactRef;
}

/** Constructs a `ToolRef` (opaque; owned by the tooling/environment lane). */
export function toolRef(value: string): ToolRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('ToolRef', value);
  return value as ToolRef;
}

/** Constructs a `KnowledgeSourceRef` (opaque; owned by the knowledge lanes). */
export function knowledgeSourceRef(value: string): KnowledgeSourceRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('KnowledgeSourceRef', value);
  return value as KnowledgeSourceRef;
}

/** Constructs an `EvidenceRef` (opaque; owned by the evidence subsystem). */
export function evidenceRef(value: string): EvidenceRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('EvidenceRef', value);
  return value as EvidenceRef;
}

/** Constructs an `EnvironmentProfileRef` (opaque; owned by T005). */
export function environmentProfileRef(value: string): EnvironmentProfileRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('EnvironmentProfileRef', value);
  return value as EnvironmentProfileRef;
}

/** Constructs a `PolicyBundleRef` (opaque; owned by T007/T020). */
export function policyBundleRef(value: string): PolicyBundleRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('PolicyBundleRef', value);
  return value as PolicyBundleRef;
}

/** Constructs a `RiskPolicyRef` (opaque; owned by T020). */
export function riskPolicyRef(value: string): RiskPolicyRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('RiskPolicyRef', value);
  return value as RiskPolicyRef;
}

/** Constructs a `RuntimeStateRef` (opaque handle; state lives in T006's lane). */
export function runtimeStateRef(value: string): RuntimeStateRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('RuntimeStateRef', value);
  return value as RuntimeStateRef;
}

// --- Guards ------------------------------------------------------------------

/** Guard: `BodyId`. */
export function isBodyId(v: unknown): v is BodyId {
  return isValidIdentifierString(v);
}

/** Guard: `BodyVersionId` (canonical `${bodyId}@${semver}`). */
export function isBodyVersionId(v: unknown): v is BodyVersionId {
  return isString(v) && parseBodyVersionIdString(v) !== null;
}

/** Guard: `SubstrateRef` (canonical `${provider}/${modelId}@${modelVersion}`). */
export function isSubstrateRef(v: unknown): v is SubstrateRef {
  return isString(v) && parseSubstrateRefString(v) !== null;
}

/** Guard: `PossessionId`. */
export function isPossessionId(v: unknown): v is PossessionId {
  return isValidIdentifierString(v);
}

/** Guard: `AgentInstanceId`. */
export function isAgentInstanceId(v: unknown): v is AgentInstanceId {
  return isValidIdentifierString(v);
}

/** Guard: `SubstitutionClass`. */
export function isSubstitutionClass(v: unknown): v is SubstitutionClass {
  return isValidIdentifierString(v);
}

/** Guard: `AdapterId`. */
export function isAdapterId(v: unknown): v is AdapterId {
  return isValidIdentifierString(v);
}

/** Guard: `ProjectRef`. */
export function isProjectRef(v: unknown): v is ProjectRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `GoalRef`. */
export function isGoalRef(v: unknown): v is GoalRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `SkillArtifactRef`. */
export function isSkillArtifactRef(v: unknown): v is SkillArtifactRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `ToolRef`. */
export function isToolRef(v: unknown): v is ToolRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `KnowledgeSourceRef`. */
export function isKnowledgeSourceRef(v: unknown): v is KnowledgeSourceRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `EvidenceRef`. */
export function isEvidenceRef(v: unknown): v is EvidenceRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `EnvironmentProfileRef`. */
export function isEnvironmentProfileRef(v: unknown): v is EnvironmentProfileRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `PolicyBundleRef`. */
export function isPolicyBundleRef(v: unknown): v is PolicyBundleRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `RiskPolicyRef`. */
export function isRiskPolicyRef(v: unknown): v is RiskPolicyRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `RuntimeStateRef`. */
export function isRuntimeStateRef(v: unknown): v is RuntimeStateRef {
  return isValidOpaqueRefString(v);
}

// --- Canonical id parsing ------------------------------------------------------

/** Parses a canonical `${bodyId}@${semver}` string; `null` when malformed. */
export function parseBodyVersionIdString(
  value: string,
): { bodyId: BodyId; version: SemVer } | null {
  const at = value.indexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  const bodyPart = value.slice(0, at);
  const versionPart = value.slice(at + 1);
  if (!isValidIdentifierString(bodyPart)) return null;
  const version = parseSemVer(versionPart);
  if (version === null) return null;
  return { bodyId: bodyPart as BodyId, version };
}

const SUBSTRATE_COMPONENT_PATTERN = /^[^\s/@]{1,128}$/;

/** Parses a canonical `${provider}/${modelId}@${modelVersion}` string; `null` when malformed. */
export function parseSubstrateRefString(
  value: string,
): { provider: string; modelId: string; modelVersion: string } | null {
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  const head = value.slice(0, at);
  const modelVersion = value.slice(at + 1);
  const slash = head.indexOf('/');
  if (slash <= 0 || slash === head.length - 1) return null;
  const provider = head.slice(0, slash);
  const modelId = head.slice(slash + 1);
  if (!SUBSTRATE_COMPONENT_PATTERN.test(provider)) return null;
  if (!SUBSTRATE_COMPONENT_PATTERN.test(modelId)) return null;
  if (!SUBSTRATE_COMPONENT_PATTERN.test(modelVersion)) return null;
  return { provider, modelId, modelVersion };
}

/** Builds the canonical substrate reference from its components (throws on invalid parts). */
export function makeSubstrateRef(
  provider: string,
  modelId: string,
  modelVersion: string,
): SubstrateRef {
  const ref = `${provider}/${modelId}@${modelVersion}`;
  if (parseSubstrateRefString(ref) === null) {
    throw new TypeError(
      `SubstrateRef: invalid components provider=${JSON.stringify(provider)}, modelId=${JSON.stringify(modelId)}, modelVersion=${JSON.stringify(modelVersion)}`,
    );
  }
  return ref as SubstrateRef;
}

/** Builds the canonical body-version identifier from its components (throws on invalid parts). */
export function makeBodyVersionId(body: BodyId | string, version: SemVer | string): BodyVersionId {
  const versionString = typeof version === 'string' ? version : semverToString(version);
  const id = `${body}@${versionString}`;
  if (parseBodyVersionIdString(id) === null) {
    throw new TypeError(
      `BodyVersionId: invalid components body=${JSON.stringify(body)}, version=${JSON.stringify(versionString)}`,
    );
  }
  return id as BodyVersionId;
}

// ---------------------------------------------------------------------------
// ISO 8601 timestamps (strings, always timezone-qualified)
// ---------------------------------------------------------------------------

/** ISO 8601 date-time string with mandatory timezone (e.g. `2026-09-27T06:00:00Z`). */
export type ISO8601 = Brand<string, 'ISO8601'>;

const ISO8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Constructs an `ISO8601` timestamp, throwing on invalid input. */
export function iso8601(value: string): ISO8601 {
  if (!isISO8601(value)) {
    throw new TypeError(
      `ISO8601: invalid timestamp ${JSON.stringify(value)} — must be a timezone-qualified date-time like 2026-09-27T06:00:00Z`,
    );
  }
  return value as ISO8601;
}

/** Guard: timezone-qualified ISO 8601 date-time string (also rejects impossible dates). */
export function isISO8601(v: unknown): v is ISO8601 {
  if (!isString(v) || !ISO8601_PATTERN.test(v)) return false;
  return !Number.isNaN(Date.parse(v));
}

// ---------------------------------------------------------------------------
// Semantic versioning (semver.org)
// ---------------------------------------------------------------------------

/** Immutable semantic version (semver.org). `prerelease`/`build` are identifier lists. */
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function isNumericIdentifier(identifier: string): boolean {
  return /^(0|[1-9]\d*)$/.test(identifier);
}

/** Semver identifier: non-empty `[0-9A-Za-z-]`; all-digit identifiers carry no leading zeros. */
function isValidSemVerIdentifier(identifier: string): boolean {
  if (!/^[0-9A-Za-z-]+$/.test(identifier)) return false;
  if (/^\d+$/.test(identifier)) return isNumericIdentifier(identifier);
  return true;
}

function isSemVerIdentifierList(v: unknown): v is readonly string[] {
  return (
    isArrayOf(v, isNonEmptyString) && v.every((identifier) => isValidSemVerIdentifier(identifier))
  );
}

/** Parses a strict semver string (`1.2.3`, `2.0.0-rc.1+build.5`); `null` when malformed. */
export function parseSemVer(input: string): SemVer | null {
  const match = SEMVER_PATTERN.exec(input);
  if (match === null) return null;
  const [, major, minor, patch, prerelease, build] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
    build: build === undefined ? [] : build.split('.'),
  };
}

/** Renders a `SemVer` back to its canonical string form. */
export function semverToString(v: SemVer): string {
  const base = `${v.major}.${v.minor}.${v.patch}`;
  const prerelease = v.prerelease.length > 0 ? `-${v.prerelease.join('.')}` : '';
  const build = v.build.length > 0 ? `+${v.build.join('.')}` : '';
  return `${base}${prerelease}${build}`;
}

function comparePrereleaseIdentifiers(a: string, b: string): -1 | 0 | 1 {
  const aNumeric = isNumericIdentifier(a);
  const bNumeric = isNumericIdentifier(b);
  if (aNumeric && bNumeric) {
    const ai = Number(a);
    const bi = Number(b);
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  }
  if (aNumeric) return -1; // numeric identifiers sort lower than alphanumeric
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePrerelease(a: readonly string[], b: readonly string[]): -1 | 0 | 1 {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // no prerelease > any prerelease
  if (b.length === 0) return -1;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const result = comparePrereleaseIdentifiers(a[i] as string, b[i] as string);
    if (result !== 0) return result;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

/**
 * Compares two versions by semver.org precedence (build metadata ignored).
 * Returns `-1` when `a < b`, `0` when equal, `1` when `a > b`.
 */
export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/** Guard: structural `SemVer` (non-negative integer core, valid identifier lists). */
export function isSemVer(v: unknown): v is SemVer {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.major) &&
    isNonNegativeInteger(v.minor) &&
    isNonNegativeInteger(v.patch) &&
    isSemVerIdentifierList(v.prerelease) &&
    isSemVerIdentifierList(v.build)
  );
}
