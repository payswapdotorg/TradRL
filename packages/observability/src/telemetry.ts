// @tradrl/observability — the TelemetryRecord contract: metrics,
// trace spans and logs as TYPED, tenant-scoped records over the
// platform's EXISTING event seams.
//
// THE LAW (the Work Order): every variant carries tenant + project
// scope (L12 — tenant isolation is inexpressible to violate: the scope
// is part of the record, guarded on construction AND append), an actor
// ref (WHO emitted the observation), the observed-seam ref (WHICH
// merged seam record the observation is about — by identity, never by
// payload), an explicit `recordedAt: TimestampMs` (an INJECTED
// instant — no ambient clock anywhere in this lane), and a
// content-addressed id derived from the canonical form (`tel:` +
// digest over the chain-bound content — the T040 minting law).
//
// DETERMINISM (L9): the record's canonical JSON tree is total —
// optionality is resolved EXPLICITLY (unit is `string | null`,
// attributes is always a JSON object, `{}` when absent) so the same
// inputs always serialize byte-identically. The `chainHead` field
// folds the record onto everything before it in its log
// (`fnv(prevHead + canonical(content))`, seeded from the log's
// identity skeleton — the T040 trail law, mirrored; the log itself
// lives in services/observability).
//
// THE OPACITY LAW: the guard runs the credential-value trip wire over
// the whole record — a credential VALUE under a credential-shaped key
// anywhere (including inside `attributes`) makes the record
// INEXPRESSIBLE. A 'cred:'-prefixed REFERENCE is fine; a value is not.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L4 (explicit recordedAt),
// L9 (byte-determinism), L12 (tenant + project on every record),
// spec/SECURITY.md Secrets (the opacity trip wire).

import {
  canonicalJson,
  deepFreeze,
  isFiniteNumber,
  isJsonObject,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isRecord,
  isTimestampMs,
  type JsonObject,
  type JsonValue,
  type TimestampMs,
} from './primitives';
import { credentialValueViolations } from './credentials';
import { invalidField, invalidType, missingField, type ObservabilityError } from './errors';
import type { ProjectId, TelemetryRecordId, TenantId } from './ids';
import { isProjectId, isTenantId } from './ids';
import { isObservedSeamRef, type ObservedSeamRef } from './seams';

// ---------------------------------------------------------------------------
// The actor reference (WHO emitted the observation)
// ---------------------------------------------------------------------------

/** The closed vocabulary of actor kinds (the platform's emission sources). Frozen: the vocabulary is law, not configuration. */
export const TELEMETRY_ACTOR_KINDS: readonly string[] = deepFreeze([
  'principal',
  'agent-instance',
  'service',
  'operator',
] as const);

/** An actor kind. */
export type TelemetryActorKind = (typeof TELEMETRY_ACTOR_KINDS)[number];

/** Mirror guard: an actor kind. */
export function isTelemetryActorKind(v: unknown): v is TelemetryActorKind {
  return typeof v === 'string' && TELEMETRY_ACTOR_KINDS.includes(v);
}

/**
 * The actor reference: WHO/WHAT emitted the observation — a strategy
 * principal (specId), a live agent instance (T006), a platform service
 * (the gateway, the store, the control plane…) or a human operator.
 * The ref is OPAQUE (non-empty string; the referent is owned by the
 * actor's own lane).
 */
export interface TelemetryActor {
  readonly kind: TelemetryActorKind;
  readonly ref: string;
}

/** Guard: `TelemetryActor`. */
export function isTelemetryActor(v: unknown): v is TelemetryActor {
  if (!isRecord(v)) return false;
  return isTelemetryActorKind(v.kind) && isNonEmptyString(v.ref);
}

// ---------------------------------------------------------------------------
// The variant vocabularies
// ---------------------------------------------------------------------------

/** The telemetry record kinds (the Work Order's discriminated union). Frozen: the vocabulary is law, not configuration. */
export const TELEMETRY_KINDS: readonly string[] = deepFreeze(['metric', 'trace-span', 'log'] as const);

/** A telemetry record kind. */
export type TelemetryKind = (typeof TELEMETRY_KINDS)[number];

/** Mirror guard: a telemetry record kind. */
export function isTelemetryKind(v: unknown): v is TelemetryKind {
  return typeof v === 'string' && TELEMETRY_KINDS.includes(v);
}

/** The log-level vocabulary (ordered severity, RFC-ish). Frozen: the vocabulary is law, not configuration. */
export const TELEMETRY_LOG_LEVELS: readonly string[] = deepFreeze(['debug', 'info', 'warn', 'error'] as const);

/** A log level. */
export type TelemetryLogLevel = (typeof TELEMETRY_LOG_LEVELS)[number];

/** Mirror guard: a log level. */
export function isTelemetryLogLevel(v: unknown): v is TelemetryLogLevel {
  return typeof v === 'string' && TELEMETRY_LOG_LEVELS.includes(v);
}

/** The trace-span status vocabulary. Frozen: the vocabulary is law, not configuration. */
export const TELEMETRY_SPAN_STATUSES: readonly string[] = deepFreeze(['ok', 'error'] as const);

/** A trace-span status. */
export type TelemetrySpanStatus = (typeof TELEMETRY_SPAN_STATUSES)[number];

/** Mirror guard: a trace-span status. */
export function isTelemetrySpanStatus(v: unknown): v is TelemetrySpanStatus {
  return typeof v === 'string' && TELEMETRY_SPAN_STATUSES.includes(v);
}

/** Metric and span names are bounded (1..256, trimmed, control-free). */
const NAME_MAX_LENGTH = 256;

/** Guard: a metric/span name. */
export function isTelemetryName(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.trim().length > 0 &&
    v.length <= NAME_MAX_LENGTH &&
    !/[\u0000-\u001f]/.test(v)
  );
}

/** Log messages are bounded (1..2048, trimmed, control-free). */
const MESSAGE_MAX_LENGTH = 2048;

/** Guard: a log message. */
export function isTelemetryMessage(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.trim().length > 0 &&
    v.length <= MESSAGE_MAX_LENGTH &&
    !/[\u0000-\u001f]/.test(v)
  );
}

/** Guard: a metric unit (a non-empty string, or null when unitless). */
export function isTelemetryUnit(v: unknown): v is string | null {
  return v === null || isNonEmptyString(v);
}

// ---------------------------------------------------------------------------
// The seam-scope default-deny law (L12 — ONE law, every consumer)
// ---------------------------------------------------------------------------

/**
 * The seam-scope DEFAULT-DENY law (L12, the branch's fourth checkpoint):
 * a telemetry record may only observe seam records of its OWN scope.
 * The seam kinds that carry scope fields (agent-envelope/kernel-
 * operation: tenant; gateway-audit/control-plane-audit: tenant +
 * project) are checked against the record's scope; the event-store seam
 * carries no scope fields (venue-scoped identity — the data plane is
 * explicitly tenant-uniform by design, mirrored from the store's own
 * law). Pure; returns the violation message or null. This ONE helper
 * backs BOTH the collect-all validator (post-mint, defense in depth)
 * and the collector's pre-instant emission gate (a cross-scope
 * observation never burns the clock).
 */
export function seamScopeViolation(seam: ObservedSeamRef, tenant: TenantId, project: ProjectId): string | null {
  if (seam.kind === 'agent-envelope' || seam.kind === 'kernel-operation') {
    if (seam.tenant !== tenant) {
      return `the observed ${seam.kind} belongs to tenant "${seam.tenant}" but the record's scope is "${tenant}" — cross-scope observation is inexpressible (L12)`;
    }
    return null;
  }
  if (seam.kind === 'gateway-audit' || seam.kind === 'control-plane-audit') {
    if (seam.tenant !== tenant || seam.project !== project) {
      return `the observed ${seam.kind} belongs to scope "${seam.tenant}/${seam.project}" but the record's scope is "${tenant}/${project}" — cross-scope observation is inexpressible (L12)`;
    }
    return null;
  }
  return null; // event-store: venue-scoped identity, no scope fields to deny
}

// ---------------------------------------------------------------------------
// The record union
// ---------------------------------------------------------------------------

/** Fields common to every telemetry record (the Work Order's mandatory carriers). */
export interface TelemetryRecordBase {
  /** Content-addressed identity: `tel:` + digest over (chainHead + canonical content). */
  readonly recordId: TelemetryRecordId;
  /** 1-based position in the log (contiguous — append-only). */
  readonly sequence: number;
  readonly kind: TelemetryKind;
  /** Tenant scope (L12 — guarded on construction AND append). */
  readonly tenant: TenantId;
  /** Project scope (L15). */
  readonly project: ProjectId;
  /** WHO/WHAT emitted the observation. */
  readonly actor: TelemetryActor;
  /** WHICH merged seam record the observation is about (by identity, never payload). */
  readonly seam: ObservedSeamRef;
  /** The injected recording instant (epoch ms; no ambient clock). */
  readonly recordedAt: TimestampMs;
  /** The chain head binding this record to everything before it: `fnv(prev + canonical(content))`. */
  readonly chainHead: string;
}

/** One metric observation: a named numeric value with an optional unit. */
export interface MetricTelemetryRecord extends TelemetryRecordBase {
  readonly kind: 'metric';
  readonly name: string;
  /** A finite number (never NaN, never ±Infinity). */
  readonly value: number;
  /** The metric's unit, or null when unitless (explicit — the canonical form is total). */
  readonly unit: string | null;
  /** Structured attributes (always an object; `{}` when none — byte-stable canonical form). */
  readonly attributes: JsonObject;
}

/** One trace-span observation: a named operation span with a duration and a status. */
export interface TraceSpanTelemetryRecord extends TelemetryRecordBase {
  readonly kind: 'trace-span';
  readonly name: string;
  /** The span's duration in milliseconds (a non-negative safe integer). */
  readonly durationMs: number;
  readonly status: TelemetrySpanStatus;
  readonly attributes: JsonObject;
}

/** One log observation: a leveled message. */
export interface LogTelemetryRecord extends TelemetryRecordBase {
  readonly kind: 'log';
  readonly level: TelemetryLogLevel;
  readonly message: string;
  readonly attributes: JsonObject;
}

/** The telemetry record union — EXACTLY the three kinds (the vocabulary is closed). */
export type TelemetryRecord = MetricTelemetryRecord | TraceSpanTelemetryRecord | LogTelemetryRecord;

/** Distributive `Omit` (plain `Omit` over a union collapses to the common keys — the variant fields must survive). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** The record's CONTENT (everything the log mints position and chain onto — variant fields included). */
export type TelemetryRecordContent = DistributiveOmit<TelemetryRecord, 'recordId' | 'chainHead'>;

// ---------------------------------------------------------------------------
// Canonical serialization (byte-determinism law, L9)
// ---------------------------------------------------------------------------

/** The actor's canonical JSON tree. */
function actorTree(actor: TelemetryActor): JsonValue {
  return { kind: actor.kind, ref: actor.ref };
}

/** The seam ref's canonical JSON tree (the identity projection — kind + identity fields, key-sorted by canonicalJson). */
function seamTree(seam: ObservedSeamRef): JsonValue {
  if (seam.kind === 'agent-envelope') return { kind: seam.kind, messageId: seam.messageId, topic: seam.topic, tenant: seam.tenant };
  if (seam.kind === 'kernel-operation') return { kind: seam.kind, opId: seam.opId, type: seam.type, tenant: seam.tenant };
  if (seam.kind === 'gateway-audit') return { kind: seam.kind, auditId: seam.auditId, tenant: seam.tenant, project: seam.project };
  if (seam.kind === 'control-plane-audit') return { kind: seam.kind, sequence: seam.sequence, tenant: seam.tenant, project: seam.project };
  return { kind: seam.kind, eventId: seam.eventId, venue: seam.venue };
}

/**
 * The canonical JSON tree of a telemetry record's CONTENT (everything
 * except `recordId` and `chainHead`). Total and explicit — equal
 * contents always serialize byte-identically (the determinism golden
 * law).
 */
export function telemetryRecordContentTree(content: TelemetryRecordContent): JsonValue {
  const base: Record<string, JsonValue> = {
    sequence: content.sequence,
    kind: content.kind,
    tenant: content.tenant,
    project: content.project,
    actor: actorTree(content.actor),
    seam: seamTree(content.seam),
    recordedAt: content.recordedAt,
  };
  if (content.kind === 'metric') {
    base.name = content.name;
    base.value = content.value;
    base.unit = content.unit;
    base.attributes = content.attributes;
  } else if (content.kind === 'trace-span') {
    base.name = content.name;
    base.durationMs = content.durationMs;
    base.status = content.status;
    base.attributes = content.attributes;
  } else {
    base.level = content.level;
    base.message = content.message;
    base.attributes = content.attributes;
  }
  return base;
}

/** The canonical JSON of a telemetry record's content (byte-deterministic). */
export function canonicalTelemetryContentJson(content: TelemetryRecordContent): string {
  return canonicalJson(telemetryRecordContentTree(content));
}

// ---------------------------------------------------------------------------
// Collect-all validation (the untrusted-input gate)
// ---------------------------------------------------------------------------

/**
 * Collect-ALL validation of an untrusted telemetry record: every
 * structural violation is reported (typed errors, dotted paths, in
 * deterministic field order), the credential-opacity trip wire
 * included (one error per violation path). Never throws.
 */
export function validateTelemetryRecord(value: unknown, path = 'telemetryRecord'): { readonly ok: boolean; readonly errors: readonly ObservabilityError[] } {
  const errors: ObservabilityError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }

  // Identity and position.
  if (value.recordId === undefined) errors.push(missingField(`${path}.recordId`));
  else if (typeof value.recordId !== 'string' || !value.recordId.startsWith('tel:')) {
    errors.push(invalidField(`${path}.recordId`, 'must be a `tel:`-prefixed telemetry record id'));
  }
  if (value.sequence === undefined) errors.push(missingField(`${path}.sequence`));
  else if (!isPositiveSafeInteger(value.sequence)) {
    errors.push(invalidField(`${path}.sequence`, 'must be a safe integer >= 1 (the 1-based log position)'));
  }

  // The kind discriminator (reported first so the rest stays diagnosable).
  if (value.kind === undefined) errors.push(missingField(`${path}.kind`));
  else if (!isTelemetryKind(value.kind)) {
    errors.push(invalidField(`${path}.kind`, `must be one of ${TELEMETRY_KINDS.join(' | ')}`));
  }

  // The L12/L15 scope.
  if (value.tenant === undefined) errors.push(missingField(`${path}.tenant`));
  else if (!isTenantId(value.tenant)) errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));
  if (value.project === undefined) errors.push(missingField(`${path}.project`));
  else if (!isProjectId(value.project)) errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));

  // The actor and the seam.
  if (value.actor === undefined) errors.push(missingField(`${path}.actor`));
  else if (!isTelemetryActor(value.actor)) {
    errors.push(invalidField(`${path}.actor`, `must be { kind: ${TELEMETRY_ACTOR_KINDS.join(' | ')}, ref: non-empty string }`));
  }
  if (value.seam === undefined) errors.push(missingField(`${path}.seam`));
  else if (!isObservedSeamRef(value.seam)) {
    errors.push(invalidField(`${path}.seam`, 'must be a valid observed-seam reference (one of the four merged seams, by identity)'));
  }

  // The injected instant.
  if (value.recordedAt === undefined) errors.push(missingField(`${path}.recordedAt`));
  else if (!isTimestampMs(value.recordedAt)) {
    errors.push(invalidField(`${path}.recordedAt`, 'must be a valid epoch-millisecond instant (the injected recording instant)'));
  }

  // The chain head.
  if (value.chainHead === undefined) errors.push(missingField(`${path}.chainHead`));
  else if (typeof value.chainHead !== 'string' || !/^[0-9a-f]{8}$/.test(value.chainHead)) {
    errors.push(invalidField(`${path}.chainHead`, 'must be a lowercase 8-hex chain head'));
  }

  // The variant payload.
  if (value.kind === 'metric') {
    if (value.name === undefined) errors.push(missingField(`${path}.name`));
    else if (!isTelemetryName(value.name)) errors.push(invalidField(`${path}.name`, `must be 1..${NAME_MAX_LENGTH} chars, trimmed, control-free`));
    if (value.value === undefined) errors.push(missingField(`${path}.value`));
    else if (!isFiniteNumber(value.value)) errors.push(invalidField(`${path}.value`, 'must be a finite number'));
    if (value.unit === undefined) errors.push(missingField(`${path}.unit`));
    else if (!isTelemetryUnit(value.unit)) errors.push(invalidField(`${path}.unit`, 'must be a non-empty string or null'));
    if (value.attributes === undefined) errors.push(missingField(`${path}.attributes`));
    else if (!isJsonObject(value.attributes)) errors.push(invalidField(`${path}.attributes`, 'must be a JSON object'));
  } else if (value.kind === 'trace-span') {
    if (value.name === undefined) errors.push(missingField(`${path}.name`));
    else if (!isTelemetryName(value.name)) errors.push(invalidField(`${path}.name`, `must be 1..${NAME_MAX_LENGTH} chars, trimmed, control-free`));
    if (value.durationMs === undefined) errors.push(missingField(`${path}.durationMs`));
    else if (!isNonNegativeSafeInteger(value.durationMs)) errors.push(invalidField(`${path}.durationMs`, 'must be a non-negative safe integer (milliseconds)'));
    if (value.status === undefined) errors.push(missingField(`${path}.status`));
    else if (!isTelemetrySpanStatus(value.status)) errors.push(invalidField(`${path}.status`, `must be ${TELEMETRY_SPAN_STATUSES.join(' | ')}`));
    if (value.attributes === undefined) errors.push(missingField(`${path}.attributes`));
    else if (!isJsonObject(value.attributes)) errors.push(invalidField(`${path}.attributes`, 'must be a JSON object'));
  } else if (value.kind === 'log') {
    if (value.level === undefined) errors.push(missingField(`${path}.level`));
    else if (!isTelemetryLogLevel(value.level)) errors.push(invalidField(`${path}.level`, `must be ${TELEMETRY_LOG_LEVELS.join(' | ')}`));
    if (value.message === undefined) errors.push(missingField(`${path}.message`));
    else if (!isTelemetryMessage(value.message)) errors.push(invalidField(`${path}.message`, `must be 1..${MESSAGE_MAX_LENGTH} chars, trimmed, control-free`));
    if (value.attributes === undefined) errors.push(missingField(`${path}.attributes`));
    else if (!isJsonObject(value.attributes)) errors.push(invalidField(`${path}.attributes`, 'must be a JSON object'));
  }

  // The seam-scope default-deny law (L12): a telemetry record may only
  // observe seam records of its OWN scope. The ONE law lives in
  // {@link seamScopeViolation}; the minted-record path re-derives it here
  // (defense in depth — the collector ALSO runs it BEFORE consuming an
  // injected instant).
  if (isObservedSeamRef(value.seam) && isTenantId(value.tenant) && isProjectId(value.project)) {
    const scopeViolation = seamScopeViolation(value.seam, value.tenant, value.project);
    if (scopeViolation !== null) {
      errors.push(invalidField(`${path}.seam`, scopeViolation));
    }
  }

  // The opacity trip wire (one typed error per violation path — SECURITY.md's boundary).
  for (const violation of credentialValueViolations(value)) {
    errors.push({
      code: 'credential_value_present',
      message: `credential material under credential-shaped key "${violation}" — telemetry records carry references, never values (SECURITY.md Secrets)`,
      path: violation === '' ? path : `${path}.${violation}`,
    });
  }

  return { ok: errors.length === 0, errors: Object.freeze(errors) };
}

/** Narrowing guard: a structurally valid telemetry record (the opacity trip wire included). */
export function isTelemetryRecord(value: unknown): value is TelemetryRecord {
  return validateTelemetryRecord(value).ok;
}

/** The record content tree of a FULL record (the chain/id derivation input — the log's verification uses this). */
export function telemetryRecordTreeOf(record: TelemetryRecord): JsonValue {
  const { recordId, chainHead, ...content } = record;
  void recordId;
  void chainHead;
  return telemetryRecordContentTree(content);
}

/** Deep-freeze a telemetry record (the runtime half of the append-only discipline). */
export function freezeTelemetryRecord(record: TelemetryRecord): TelemetryRecord {
  return deepFreeze(record);
}
