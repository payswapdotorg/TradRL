// @tradrl/observability_service — the collector.
//
// THE LAW (the Work Order): `createObservabilityCollector({ instants
// })` — instants INJECTED (the `scriptedInstants` pattern; no ambient
// clock anywhere); no network/real I/O — consumers arrive as INJECTED
// PORTS ({@link TelemetrySink}); the collector owns one growing
// {@link TelemetryLog} for its tenant/project scope and mints every
// record at the log's next position (sequence, chain head,
// content-addressed id — the T040 trail law, mirrored).
//
// Each recording call consumes EXACTLY ONE instant (the record's
// `recordedAt`); input validation happens BEFORE the instant is
// consumed (a malformed observation never burns the clock). Every
// successfully-appended record is dispatched to every sink, in append
// order.
//
// THE OBSERVE PATH (records over the platform's EXISTING seams): the
// mirror guards of the contract package validate a REAL seam record
// (agent-os envelope/operation, T040 gateway audit record,
// control-plane journal entry, event-store event), the seam ref and
// actor are DERIVED from it (the identity projection), and a log-kind
// telemetry record is emitted referencing it — by identity, never by
// payload (the complement law).
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L4 (injected instants),
// L12 (one scope per collector), L20 (the opacity trip wire in code).

import {
  credentialValueViolations,
  deepFreeze,
  fail,
  isGatewayAuditRecordMirror,
  isKernelOperationMirror,
  isMessageEnvelopeMirror,
  isProjectAuditEntryMirror,
  isStorableEventMirror,
  isTelemetryActor,
  isTelemetryLogLevel,
  isTelemetryMessage,
  isTelemetryName,
  isTelemetrySpanStatus,
  isTelemetryUnit,
  isTimestampMs,
  isObservedSeamRef,
  isJsonObject,
  ok,
  seamRefOfEnvelope,
  seamRefOfOperation,
  seamRefOfGatewayAudit,
  seamRefOfProjectAuditEntry,
  seamRefOfStorableEvent,
  seamScopeViolation,
  type JsonObject,
  type ObservabilityResult,
  type ObservedSeamRef,
  type ProjectId,
  type TelemetryActor,
  type TelemetryLogLevel,
  type TelemetryRecord,
  type TenantId,
  type TimestampMs,
} from '../../../packages/observability/src/index';
import { isProjectId, isTenantId } from '../../../packages/observability/src/index';
import { isTelemetrySink, type InstantSource, type TelemetrySink } from './ports';
import { appendTelemetryRecord, startTelemetryLog, telemetryRecordAt, type TelemetryLog, type TelemetryObservationDraft, type TelemetryRecordDraft } from './log';

// ---------------------------------------------------------------------------
// The collector configuration
// ---------------------------------------------------------------------------

/** The collector's injected configuration: scope + instants + optional consumer sinks. */
export interface ObservabilityCollectorConfig {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The host-injected instant source (each recording consumes exactly ONE instant). */
  readonly instants: InstantSource;
  /** Optional injected consumer ports (exporters, indexers, alerters). */
  readonly sinks?: readonly TelemetrySink[];
}

/** The scope-carrier half of every recording input. */
export interface TelemetryScopeInput {
  /** WHO/WHAT emits the observation. */
  readonly actor: TelemetryActor;
  /** WHICH merged seam record the observation is about. */
  readonly seam: ObservedSeamRef;
}

/** One metric observation input. */
export interface MetricInput extends TelemetryScopeInput {
  readonly name: string;
  readonly value: number;
  readonly unit?: string;
  readonly attributes?: JsonObject;
}

/** One trace-span observation input. */
export interface TraceSpanInput extends TelemetryScopeInput {
  readonly name: string;
  readonly durationMs: number;
  readonly status: 'ok' | 'error';
  readonly attributes?: JsonObject;
}

/** One log observation input. */
export interface LogInput extends TelemetryScopeInput {
  readonly level: TelemetryLogLevel;
  readonly message: string;
  readonly attributes?: JsonObject;
}

/** The options of the seam-observation path. */
export interface ObserveOptions {
  /** The log level of the observation record (default 'info'). */
  readonly level?: TelemetryLogLevel;
  /** The human-readable observation message (REQUIRED — no ambient prose). */
  readonly message: string;
  readonly attributes?: JsonObject;
}

/** The collector: the emission surface of one tenant/project scope. */
export interface ObservabilityCollector {
  /** The collector's tenant scope (L12). */
  readonly tenant: TenantId;
  /** The collector's project scope (L15). */
  readonly project: ProjectId;
  /** The current log (frozen snapshot — grows only through the recording calls). */
  currentLog(): TelemetryLog;
  /** Record one metric observation. */
  metric(input: MetricInput): ObservabilityResult<TelemetryRecord>;
  /** Record one trace-span observation. */
  traceSpan(input: TraceSpanInput): ObservabilityResult<TelemetryRecord>;
  /** Record one log observation. */
  logEntry(input: LogInput): ObservabilityResult<TelemetryRecord>;
  /** Observe a REAL seam record (validated through the mirror guards; ref + actor derived). */
  observe(seamRecord: unknown, options: ObserveOptions): ObservabilityResult<TelemetryRecord>;
}

// ---------------------------------------------------------------------------
// Input validation (BEFORE the instant is consumed)
// ---------------------------------------------------------------------------

function validateScopeInput(input: TelemetryScopeInput, path: string): string | null {
  if (!isTelemetryActor(input.actor)) return `${path}.actor: must be { kind: principal | agent-instance | service | operator, ref: non-empty string }`;
  if (!isObservedSeamRef(input.seam)) return `${path}.seam: must be a valid observed-seam reference`;
  return null;
}

function validateAttributes(attributes: JsonObject | undefined, path: string): string | null {
  if (attributes !== undefined && !isJsonObject(attributes)) return `${path}.attributes: must be a JSON object`;
  return null;
}

// ---------------------------------------------------------------------------
// The collector factory
// ---------------------------------------------------------------------------

/**
 * Create the observability collector for one tenant/project scope.
 * The instant source is INJECTED (no ambient clock); consumer sinks
 * are INJECTED ports (no I/O); every recording consumes exactly ONE
 * instant and appends exactly ONE record to the scope's log.
 */
export function createObservabilityCollector(config: ObservabilityCollectorConfig): ObservabilityResult<ObservabilityCollector> {
  if (typeof config !== 'object' || config === null) {
    return fail('invalid_type', 'createObservabilityCollector requires a configuration object');
  }
  if (!isTenantId(config.tenant)) return fail('tenant_missing', 'createObservabilityCollector requires a tenant scope (L12)');
  if (!isProjectId(config.project)) return fail('tenant_missing', 'createObservabilityCollector requires a project scope (L12/L15)');
  if (typeof config.instants !== 'object' || config.instants === null || typeof config.instants.next !== 'function') {
    return fail('invalid_type', 'createObservabilityCollector requires an injected instant source ({ next(): number })');
  }
  if (config.sinks !== undefined) {
    if (!Array.isArray(config.sinks) || !config.sinks.every((sink) => isTelemetrySink(sink))) {
      return fail('invalid_type', 'createObservabilityCollector requires sinks to be injected ports ({ ingest(record) })');
    }
  }
  const started = startTelemetryLog(config.tenant, config.project);
  if (!started.ok) return started;
  const sinks = config.sinks === undefined ? [] : [...config.sinks];
  let log: TelemetryLog = started.value;

  /** Consume the next injected instant; validate it as a TimestampMs (L4). */
  function nextInstant(path: string): ObservabilityResult<TimestampMs> {
    const raw = config.instants.next();
    if (!isTimestampMs(raw)) {
      return fail('invalid_field', `the injected instant source produced a non-instant value (${JSON.stringify(raw)}) — ${path}`, 'recordedAt');
    }
    return ok(raw);
  }

  /** Validate + normalize + mint + append + dispatch one record. */
  function emit(content: TelemetryObservationDraft, problems: readonly string[]): ObservabilityResult<TelemetryRecord> {
    if (problems.length > 0) {
      return fail('invalid_field', problems.join('; '));
    }
    // The seam-scope default-deny law (L12) runs BEFORE the instant is
    // consumed — a cross-scope observation is an inexpressible
    // observation and NEVER burns the clock. The ONE law lives in the
    // contract package (`seamScopeViolation`); the minted-record guard
    // re-checks it after minting (defense in depth).
    const scopeViolation = seamScopeViolation(content.seam, config.tenant, config.project);
    if (scopeViolation !== null) {
      return fail('invalid_field', `seam: ${scopeViolation}`, 'seam');
    }
    // The opacity trip wire runs BEFORE the instant is consumed — a
    // credential VALUE anywhere in the observation never burns the clock.
    const opacity = credentialValueViolations(content);
    if (opacity.length > 0) {
      return {
        ok: false,
        errors: Object.freeze(
          opacity.map((violation) => ({
            code: 'credential_value_present' as const,
            message: `credential material under credential-shaped key "${violation}" — telemetry records carry references, never values (SECURITY.md Secrets)`,
            path: violation,
          })),
        ),
      };
    }
    const recordedAt = nextInstant('each recording consumes exactly one injected instant');
    if (!recordedAt.ok) return recordedAt;
    const contentWithInstant: TelemetryRecordDraft = { ...content, recordedAt: recordedAt.value };
    const minted = telemetryRecordAt(log, contentWithInstant);
    if (!minted.ok) return minted;
    const appended = appendTelemetryRecord(log, minted.value);
    if (!appended.ok) return appended;
    log = appended.value;
    for (const sink of sinks) {
      sink.ingest(minted.value);
    }
    return ok(minted.value);
  }

  const collector: ObservabilityCollector = deepFreeze({
    tenant: config.tenant,
    project: config.project,
    currentLog: () => log,
    metric(input: MetricInput) {
      const problems: string[] = [];
      const scopeProblem = validateScopeInput(input, 'metric');
      if (scopeProblem !== null) problems.push(scopeProblem);
      if (input.name === undefined) problems.push('metric.name: this field is required');
      else if (!isTelemetryName(input.name)) problems.push('metric.name: must be 1..256 chars, trimmed, control-free');
      if (input.value === undefined) problems.push('metric.value: this field is required');
      else if (typeof input.value !== 'number' || !Number.isFinite(input.value)) problems.push('metric.value: must be a finite number');
      if (input.unit !== undefined && !isTelemetryUnit(input.unit)) problems.push('metric.unit: must be a non-empty string');
      const attributesProblem = validateAttributes(input.attributes, 'metric');
      if (attributesProblem !== null) problems.push(attributesProblem);
      return emit(
        {
          kind: 'metric',
          tenant: config.tenant,
          project: config.project,
          actor: input.actor,
          seam: input.seam,
          name: input.name,
          value: input.value,
          unit: input.unit ?? null,
          attributes: input.attributes ?? {},
        },
        problems,
      );
    },
    traceSpan(input: TraceSpanInput) {
      const problems: string[] = [];
      const scopeProblem = validateScopeInput(input, 'traceSpan');
      if (scopeProblem !== null) problems.push(scopeProblem);
      if (input.name === undefined) problems.push('traceSpan.name: this field is required');
      else if (!isTelemetryName(input.name)) problems.push('traceSpan.name: must be 1..256 chars, trimmed, control-free');
      if (input.durationMs === undefined) problems.push('traceSpan.durationMs: this field is required');
      else if (typeof input.durationMs !== 'number' || !Number.isSafeInteger(input.durationMs) || input.durationMs < 0) {
        problems.push('traceSpan.durationMs: must be a non-negative safe integer (milliseconds)');
      }
      if (input.status === undefined) problems.push('traceSpan.status: this field is required');
      else if (!isTelemetrySpanStatus(input.status)) problems.push('traceSpan.status: must be ok | error');
      const attributesProblem = validateAttributes(input.attributes, 'traceSpan');
      if (attributesProblem !== null) problems.push(attributesProblem);
      return emit(
        {
          kind: 'trace-span',
          tenant: config.tenant,
          project: config.project,
          actor: input.actor,
          seam: input.seam,
          name: input.name,
          durationMs: input.durationMs,
          status: input.status,
          attributes: input.attributes ?? {},
        },
        problems,
      );
    },
    logEntry(input: LogInput) {
      const problems: string[] = [];
      const scopeProblem = validateScopeInput(input, 'logEntry');
      if (scopeProblem !== null) problems.push(scopeProblem);
      if (input.level === undefined) problems.push('logEntry.level: this field is required');
      else if (!isTelemetryLogLevel(input.level)) problems.push('logEntry.level: must be debug | info | warn | error');
      if (input.message === undefined) problems.push('logEntry.message: this field is required');
      else if (!isTelemetryMessage(input.message)) problems.push('logEntry.message: must be 1..2048 chars, trimmed, control-free');
      const attributesProblem = validateAttributes(input.attributes, 'logEntry');
      if (attributesProblem !== null) problems.push(attributesProblem);
      return emit(
        {
          kind: 'log',
          tenant: config.tenant,
          project: config.project,
          actor: input.actor,
          seam: input.seam,
          level: input.level,
          message: input.message,
          attributes: input.attributes ?? {},
        },
        problems,
      );
    },
    observe(seamRecord: unknown, options: ObserveOptions) {
      const problems: string[] = [];
      if (options === undefined || options === null || typeof options !== 'object') {
        return fail('invalid_type', 'observe requires an options object { message, level?, attributes? }');
      }
      if (options.message === undefined) problems.push('observe.message: this field is required');
      else if (!isTelemetryMessage(options.message)) problems.push('observe.message: must be 1..2048 chars, trimmed, control-free');
      if (options.level !== undefined && !isTelemetryLogLevel(options.level)) problems.push('observe.level: must be debug | info | warn | error');
      const attributesProblem = validateAttributes(options.attributes, 'observe');
      if (attributesProblem !== null) problems.push(attributesProblem);
      if (problems.length > 0) return fail('invalid_field', problems.join('; '));

      // The mirror-guard chain: the seam record must be a REAL record of one
      // of the four merged seams (validated by structure). The guards are
      // mutually exclusive over the merged record shapes (disjoint field
      // sets); the chain order is fixed and deterministic.
      if (isMessageEnvelopeMirror(seamRecord)) {
        return emit(
          {
            kind: 'log',
            tenant: config.tenant,
            project: config.project,
            actor: { kind: 'agent-instance', ref: seamRecord.sender },
            seam: seamRefOfEnvelope(seamRecord),
            level: options.level ?? 'info',
            message: options.message,
            attributes: options.attributes ?? {},
          },
          [],
        );
      }
      if (isKernelOperationMirror(seamRecord)) {
        return emit(
          {
            kind: 'log',
            tenant: config.tenant,
            project: config.project,
            actor: { kind: 'agent-instance', ref: seamRecord.actor },
            seam: seamRefOfOperation(seamRecord),
            level: options.level ?? 'info',
            message: options.message,
            attributes: options.attributes ?? {},
          },
          [],
        );
      }
      if (isGatewayAuditRecordMirror(seamRecord)) {
        return emit(
          {
            kind: 'log',
            tenant: config.tenant,
            project: config.project,
            actor: { kind: 'principal', ref: `${seamRecord.who.bodyVersion.specId}@${seamRecord.who.bodyVersion.version}` },
            seam: seamRefOfGatewayAudit(seamRecord),
            level: options.level ?? 'info',
            message: options.message,
            attributes: options.attributes ?? {},
          },
          [],
        );
      }
      if (isProjectAuditEntryMirror(seamRecord)) {
        return emit(
          {
            kind: 'log',
            tenant: config.tenant,
            project: config.project,
            actor: { kind: 'service', ref: 'control-plane' },
            seam: seamRefOfProjectAuditEntry(seamRecord),
            level: options.level ?? 'info',
            message: options.message,
            attributes: options.attributes ?? {},
          },
          [],
        );
      }
      if (isStorableEventMirror(seamRecord)) {
        return emit(
          {
            kind: 'log',
            tenant: config.tenant,
            project: config.project,
            actor: { kind: 'service', ref: 'event-store' },
            seam: seamRefOfStorableEvent(seamRecord),
            level: options.level ?? 'info',
            message: options.message,
            attributes: options.attributes ?? {},
          },
          [],
        );
      }
      return fail('invalid_type', 'observe requires a REAL record of one of the four merged seams (validated through the mirror guards: agent-os MessageEnvelope/KernelOperation, execution-authority GatewayAuditRecord, control-plane ProjectAuditEntry, event-store StorableEvent)');
    },
  });

  // The collector's frozen surface over the growing internal log.
  return ok(collector);
}
