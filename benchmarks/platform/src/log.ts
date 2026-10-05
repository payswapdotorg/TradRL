/**
 * @tradrl/benchmarks-platform — the MEASUREMENT LOG (Work Order T049): the
 * append-only, chain-verified history of the platform's measurements.
 *
 * THE APPEND-ONLY LAW (L11): the log's `entries` grow ONLY through
 * {@link appendMeasurement}. There is no update, removal or reordering
 * API anywhere in this lane. One measurement id, one entry
 * (`duplicate_measurement`); the log is ordered by the injected recording
 * instants (L4).
 *
 * THE CHAIN LAW (L9/L11): every log carries a `chain_head` binding the
 * scope and EVERY entry, in append order:
 *
 *     h(-1)  = digest(canonical(binding))
 *     h(i)   = digest("h(i-1)" + ":" + digest(canonical(entries[i])))
 *     head   = h(entries.length - 1)
 *
 * {@link verifyMeasurementLog} recomputes the whole chain; ANY tamper — a
 * mutated field, a REORDERED log, or a REMOVED (hidden) measurement —
 * breaks the head and fails `chain_mismatch`. Hiding a failed measurement
 * is therefore not merely a typed error at the projection layer: it is
 * impossible to do silently against a log whose head was published.
 *
 * The log id is content-addressed (`cbml:<digest>` over the canonical
 * scope binding) — the research/benchmarks result-log discipline (T032),
 * re-declared for this lane's identity space.
 */

import { deepFreeze, isRecord, stableDigest, stableDigestJson } from './primitives';
import type { JsonObject } from './primitives';
import { isMeasurementLogId, isProjectId, isTenantId } from './ids';
import type { MeasurementLogId, ProjectId, TenantId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type PlatformError, type PlatformResult } from './errors';
import { verifyMeasurementRecord } from './measurement';
import type { MeasurementRecord } from './measurement';

/** The log's scope binding (L12/L15). */
export interface MeasurementLogBinding {
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** The append-only, chain-verified measurement log. */
export interface MeasurementLog {
  /** Derived identity: `cbml:<digest over the canonical binding>`. */
  readonly log_id: MeasurementLogId;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly entries: readonly MeasurementRecord[];
  readonly chain_head: string;
}

/** The canonical binding JSON (the identity + chain-genesis input). */
function bindingJson(binding: MeasurementLogBinding): JsonObject {
  return { tenant: binding.tenant, project: binding.project };
}

/** The log's derived identity: `cbml:<digest over the canonical binding>`. */
export function measurementLogId(binding: MeasurementLogBinding): MeasurementLogId {
  return `cbml:${stableDigestJson(bindingJson(binding))}` as MeasurementLogId;
}

/** The chain genesis: digest(canonical(binding)). */
export function measurementChainGenesis(binding: MeasurementLogBinding): string {
  return stableDigestJson(bindingJson(binding));
}

/** The chain fold: digest(prev + ":" + digest(entry)). */
export function measurementChainFold(previousHead: string, record: MeasurementRecord): string {
  return stableDigest(`${previousHead}:${stableDigestJson(record as unknown as JsonObject)}`);
}

/** The head recomputation over a binding and an entry sequence. */
export function computeMeasurementChainHead(binding: MeasurementLogBinding, records: readonly MeasurementRecord[]): string {
  let head = measurementChainGenesis(binding);
  for (const record of records) head = measurementChainFold(head, record);
  return head;
}

/** Guard: `MeasurementLog` (structural). */
export function isMeasurementLog(value: unknown): value is MeasurementLog {
  if (!isRecord(value)) return false;
  if (!isMeasurementLogId(value.log_id)) return false;
  if (!isTenantId(value.tenant) || !isProjectId(value.project)) return false;
  if (!Array.isArray(value.entries)) return false;
  return typeof value.chain_head === 'string' && /^[0-9a-f]{16}$/.test(value.chain_head);
}

/** Open a new measurement log for one tenant/project scope (L12). */
export function createMeasurementLog(value: unknown): PlatformResult<MeasurementLog> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('log input must be an object')] };
  }
  const errors: PlatformError[] = [];
  if (value.tenant === undefined) errors.push(missingField('tenant'));
  else if (!isTenantId(value.tenant)) errors.push(invalidField('tenant', 'must be a non-empty tenant id (L12)'));
  if (value.project === undefined) errors.push(missingField('project'));
  else if (!isProjectId(value.project)) errors.push(invalidField('project', 'must be a non-empty project id (L15)'));
  if (Array.isArray(value.entries) && (value.entries as readonly unknown[]).length > 0) {
    errors.push(invalidField('entries', 'createMeasurementLog builds an OPEN log; use appendMeasurement to grow it'));
  }
  if (errors.length > 0) return { ok: false, errors };
  const binding: MeasurementLogBinding = {
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  return ok(
    deepFreeze({
      log_id: measurementLogId(binding),
      tenant: binding.tenant,
      project: binding.project,
      entries: [],
      chain_head: measurementChainGenesis(binding),
    } satisfies MeasurementLog),
  );
}

/**
 * Append one verified measurement to the log. The record verifies through
 * the content-address law (`measurement_mismatch`), the scope agrees
 * (`tenant_mismatch`), the id is new (`duplicate_measurement`) and the
 * instant does not rewind the log (L4).
 */
export function appendMeasurement(log: MeasurementLog, input: unknown): PlatformResult<MeasurementLog> {
  if (!isMeasurementLog(log)) {
    return { ok: false, errors: [invalidType('log must be a measurement log')] };
  }
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('append input must be an object')] };
  }
  if (input.measurement === undefined) {
    return { ok: false, errors: [missingField('measurement')] };
  }
  const verification = verifyMeasurementRecord(input.measurement);
  if (!verification.ok) return verification;
  const record = verification.value;

  if (record.tenant !== log.tenant || record.project !== log.project) {
    return fail(
      'tenant_mismatch',
      `measurement "${record.measurement_id}" is scoped to tenant "${record.tenant}"/project "${record.project}" but the log is scoped to "${log.tenant}"/"${log.project}" — measurements never cross tenants or projects (L12)`,
      'measurement.tenant',
    );
  }
  for (const entry of log.entries) {
    if (entry.measurement_id === record.measurement_id) {
      return fail(
        'duplicate_measurement',
        `measurement "${record.measurement_id}" is already appended — one id, one entry; the log is append-only and never rewrites (L11)`,
        'measurement.measurement_id',
      );
    }
  }
  const lastEntry = log.entries[log.entries.length - 1];
  if (lastEntry !== undefined && record.recorded_at < lastEntry.recorded_at) {
    return fail(
      'invalid_field',
      `measurement instant ${record.recorded_at} precedes the previous append's ${lastEntry.recorded_at} — the log is ordered (L4)`,
      'measurement.recorded_at',
    );
  }

  const binding: MeasurementLogBinding = { tenant: log.tenant, project: log.project };
  const entries = [...log.entries, record];
  return ok(
    deepFreeze({
      log_id: log.log_id,
      tenant: log.tenant,
      project: log.project,
      entries,
      chain_head: computeMeasurementChainHead(binding, entries),
    } satisfies MeasurementLog),
  );
}

/**
 * VERIFY a measurement log end-to-end: the derived identity, every
 * entry's content address, the scope/duplicate/order laws, and the CHAIN
 * — the recomputed head over the entries AS STORED must equal the
 * recorded head (`chain_mismatch` on mutation, reordering or hiding).
 */
export function verifyMeasurementLog(value: unknown): PlatformResult<MeasurementLog> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('log must be an object')] };
  }
  const errors: PlatformError[] = [];
  for (const field of ['tenant', 'project'] as const) {
    if (value[field] === undefined) errors.push(missingField(field));
  }
  if (value.log_id === undefined) errors.push(missingField('log_id'));
  else if (!isMeasurementLogId(value.log_id)) errors.push(invalidField('log_id', 'must be a log id ("cbml:<digest>")'));
  if (value.chain_head === undefined) errors.push(missingField('chain_head'));
  else if (typeof value.chain_head !== 'string' || !/^[0-9a-f]{16}$/.test(value.chain_head)) {
    errors.push(invalidField('chain_head', 'must be a 16-hex digest'));
  }
  if (value.entries === undefined) errors.push(missingField('entries'));
  else if (!Array.isArray(value.entries)) errors.push(invalidField('entries', 'must be an array of measurement records'));
  if (errors.length > 0) return { ok: false, errors };

  const binding: MeasurementLogBinding = {
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  if (value.log_id !== measurementLogId(binding)) {
    return fail('chain_mismatch', `log_id "${value.log_id}" does not match the binding's derived identity (L9)`, 'log_id');
  }

  const seenIds = new Set<string>();
  let previousInstant: number | undefined;
  const records: MeasurementRecord[] = [];
  for (let index = 0; index < (value.entries as unknown[]).length; index++) {
    const verification = verifyMeasurementRecord((value.entries as unknown[])[index], `entries[${index}]`);
    if (!verification.ok) return verification;
    const record = verification.value;
    if (record.tenant !== binding.tenant || record.project !== binding.project) {
      return fail('tenant_mismatch', `entry ${index} crosses the log's scope (L12)`, `entries[${index}].tenant`);
    }
    if (seenIds.has(record.measurement_id)) {
      return fail('duplicate_measurement', `measurement "${record.measurement_id}" appears twice in the log (L11)`, `entries[${index}].measurement_id`);
    }
    seenIds.add(record.measurement_id);
    if (previousInstant !== undefined && record.recorded_at < previousInstant) {
      return fail('invalid_field', `entry ${index} rewinds the log's instants (L4)`, `entries[${index}].recorded_at`);
    }
    previousInstant = record.recorded_at;
    records.push(record);
  }

  const expectedHead = computeMeasurementChainHead(binding, records);
  if (value.chain_head !== expectedHead) {
    return fail(
      'chain_mismatch',
      `chain head "${value.chain_head as string}" does not match the recomputed head "${expectedHead}" — the stored history was mutated, reordered or truncated (L9/L11)`,
      'chain_head',
    );
  }

  return ok(
    deepFreeze({
      log_id: measurementLogId(binding),
      tenant: binding.tenant,
      project: binding.project,
      entries: records,
      chain_head: expectedHead,
    } satisfies MeasurementLog),
  );
}
