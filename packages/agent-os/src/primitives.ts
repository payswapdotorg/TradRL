// @tradrl/agent-os — shared contract primitives.
//
// Spec anchors: spec/ARCHITECTURE.md ("Agent OS" — the kernel is exactly the
// fourteen operations; stable kernel, adaptive organization above it);
// spec/ARCHITECTURE-LOCK.md L2 (body/model separation — the kernel references
// bodies/substrates ONLY through opaque ids), L8 (execution authority outside
// prompts — authority tokens are opaque strings here, never evaluated),
// L12 (tenant isolation — every kernel record is tenant-scoped), L20 (safety
// outside prompts); spec/DOMAIN-MODEL.md (AgentInstance, Team/TeamPolicy).
//
// Laws honored here:
// - Zero runtime dependencies; pure data and pure functions only.
// - All contract data is JSON-serializable (no Dates, Maps, Sets, symbols in
//   serialized shapes; symbol keys are type-level brands only).
// - No `any`; every exported shape has a hand-rolled type guard.
// - Cross-lane entities (T003 agent-body, T002 trading domain, T004 time,
//   T005 environment, T011 trajectories, T016 organization compiler,
//   T019/T020/T034 execution/risk) are referenced ONLY through opaque
//   branded string ids — never imported.
//
// This module STRUCTURALLY MIRRORS packages/agent-body/src/primitives.ts
// (program decision D-004): the two packages never import each other, but
// their shared vocabularies (identifier discipline, opaque-reference
// discipline, deep-freeze discipline) must not diverge. The cross-package
// trip wire lives in packages/agent-os/src/interop.test.ts.

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
// Deep immutability (runtime half of the "stable kernel" discipline)
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
 * The runtime guard behind kernel purity: a state (or operation, envelope,
 * effect) produced by this package that is not deeply frozen fails this check.
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
 * contract data.
 */
export function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

// --- Kernel-owned identifiers -------------------------------------------------

/** Identity of one kernel operation (globally unique across tenants). */
export type KernelOpId = Brand<string, 'KernelOpId'>;
/** Tenant scope — every kernel record and message is tenant-scoped (L12). */
export type TenantId = Brand<string, 'TenantId'>;
/** Identity of a topic on the kernel's topic-addressed message fabric. */
export type TopicName = Brand<string, 'TopicName'>;
/**
 * Identity of one message envelope. Kernel-derived ids have the deterministic
 * form `msg:${opId}:${sender}:${sequence}` and can exceed the identifier
 * pattern's 256-char budget, so this uses the opaque-reference discipline.
 */
export type MessageId = Brand<string, 'MessageId'>;

// --- Structural mirrors of cross-lane ids (opaque — never imported) -----------

/**
 * AgentInstance identity — structural mirror of `AgentInstanceId` from
 * `@tradrl/agent-body` (T003). The kernel treats it as an opaque handle to a
 * possession operating at runtime; the instance RECORD owned by T003 and the
 * runtime registry owned here reference each other only through this id.
 */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;

/** Opaque reference to an immutable BodyVersion — owned by T003 (agent-body). */
export type BodyVersionRef = Brand<string, 'BodyVersionRef'>;

/** Opaque reference to a CognitiveSubstrate — owned by T003 (agent-body). */
export type SubstrateRef = Brand<string, 'SubstrateRef'>;

/** Opaque reference to a delegated task — owned by the organization lane (T016). */
export type TaskRef = Brand<string, 'TaskRef'>;

/** Opaque reference to a proposal — owned by the organization/decision lanes (T016/T002). */
export type ProposalRef = Brand<string, 'ProposalRef'>;

/** Opaque reference to an execution intent — owned by the execution lane (T019/T040). */
export type IntentRef = Brand<string, 'IntentRef'>;

/**
 * Opaque reference to an authority token — owned by the authorization gate
 * lane (T019/T020/T034). The kernel CARRIES this reference and never
 * EVALUATES it (L8: the kernel transports an intent to an execution gate; it
 * never grants authority).
 */
export type AuthorityTokenRef = Brand<string, 'AuthorityTokenRef'>;

/** Opaque reference to an observation query — owned by the observation lanes (T005/T008). */
export type QueryRef = Brand<string, 'QueryRef'>;

/** Opaque reference to a lesson — owned by the learning lanes (T002/T011). */
export type LessonRef = Brand<string, 'LessonRef'>;

/** Opaque reference to a full report document — owned by the reporting lane (T043). */
export type ReportDetailRef = Brand<string, 'ReportDetailRef'>;

/** Opaque message payload — the kernel never interprets payload content. */
export type MessagePayload = Brand<string, 'MessagePayload'>;

// --- Identifier factories ------------------------------------------------------

/** Constructs a `KernelOpId`, throwing on invalid identifiers. */
export function kernelOpId(value: string): KernelOpId {
  if (!isValidIdentifierString(value)) throw identifierError('KernelOpId', value);
  return value as KernelOpId;
}

/** Constructs a `TenantId`, throwing on invalid identifiers. */
export function tenantId(value: string): TenantId {
  if (!isValidIdentifierString(value)) throw identifierError('TenantId', value);
  return value as TenantId;
}

/** Constructs a `TopicName`, throwing on invalid identifiers. */
export function topicName(value: string): TopicName {
  if (!isValidIdentifierString(value)) throw identifierError('TopicName', value);
  return value as TopicName;
}

/** Constructs a `MessageId`, throwing on invalid input. */
export function messageId(value: string): MessageId {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('MessageId', value);
  return value as MessageId;
}

/** Constructs an `AgentInstanceId` (mirror discipline of agent-body), throwing on invalid input. */
export function agentInstanceId(value: string): AgentInstanceId {
  if (!isValidIdentifierString(value)) throw identifierError('AgentInstanceId', value);
  return value as AgentInstanceId;
}

// --- Opaque reference factories -------------------------------------------------

/** Constructs a `BodyVersionRef` (opaque; owned by T003). */
export function bodyVersionRef(value: string): BodyVersionRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('BodyVersionRef', value);
  return value as BodyVersionRef;
}

/** Constructs a `SubstrateRef` (opaque; owned by T003). */
export function substrateRef(value: string): SubstrateRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('SubstrateRef', value);
  return value as SubstrateRef;
}

/** Constructs a `TaskRef` (opaque; owned by the organization lane). */
export function taskRef(value: string): TaskRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('TaskRef', value);
  return value as TaskRef;
}

/** Constructs a `ProposalRef` (opaque; owned by the organization/decision lanes). */
export function proposalRef(value: string): ProposalRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('ProposalRef', value);
  return value as ProposalRef;
}

/** Constructs an `IntentRef` (opaque; owned by the execution lane). */
export function intentRef(value: string): IntentRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('IntentRef', value);
  return value as IntentRef;
}

/** Constructs an `AuthorityTokenRef` (opaque; owned by the authorization gate lane). */
export function authorityTokenRef(value: string): AuthorityTokenRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('AuthorityTokenRef', value);
  return value as AuthorityTokenRef;
}

/** Constructs a `QueryRef` (opaque; owned by the observation lanes). */
export function queryRef(value: string): QueryRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('QueryRef', value);
  return value as QueryRef;
}

/** Constructs a `LessonRef` (opaque; owned by the learning lanes). */
export function lessonRef(value: string): LessonRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('LessonRef', value);
  return value as LessonRef;
}

/** Constructs a `ReportDetailRef` (opaque; owned by the reporting lane). */
export function reportDetailRef(value: string): ReportDetailRef {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('ReportDetailRef', value);
  return value as ReportDetailRef;
}

/** Constructs an opaque `MessagePayload`. */
export function messagePayload(value: string): MessagePayload {
  if (!isValidOpaqueRefString(value)) throw opaqueRefError('MessagePayload', value);
  return value as MessagePayload;
}

// --- Guards ----------------------------------------------------------------------

/** Guard: `KernelOpId`. */
export function isKernelOpId(v: unknown): v is KernelOpId {
  return isValidIdentifierString(v);
}

/** Guard: `TenantId`. */
export function isTenantId(v: unknown): v is TenantId {
  return isValidIdentifierString(v);
}

/** Guard: `TopicName`. */
export function isTopicName(v: unknown): v is TopicName {
  return isValidIdentifierString(v);
}

/** Guard: `MessageId`. */
export function isMessageId(v: unknown): v is MessageId {
  return isValidOpaqueRefString(v);
}

/** Guard: `AgentInstanceId` (identifier discipline mirrored from agent-body). */
export function isAgentInstanceId(v: unknown): v is AgentInstanceId {
  return isValidIdentifierString(v);
}

/** Guard: `BodyVersionRef`. */
export function isBodyVersionRef(v: unknown): v is BodyVersionRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `SubstrateRef`. */
export function isSubstrateRef(v: unknown): v is SubstrateRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `TaskRef`. */
export function isTaskRef(v: unknown): v is TaskRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `ProposalRef`. */
export function isProposalRef(v: unknown): v is ProposalRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `IntentRef`. */
export function isIntentRef(v: unknown): v is IntentRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `AuthorityTokenRef`. */
export function isAuthorityTokenRef(v: unknown): v is AuthorityTokenRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `QueryRef`. */
export function isQueryRef(v: unknown): v is QueryRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `LessonRef`. */
export function isLessonRef(v: unknown): v is LessonRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `ReportDetailRef`. */
export function isReportDetailRef(v: unknown): v is ReportDetailRef {
  return isValidOpaqueRefString(v);
}

/** Guard: `MessagePayload`. */
export function isMessagePayload(v: unknown): v is MessagePayload {
  return isValidOpaqueRefString(v);
}
