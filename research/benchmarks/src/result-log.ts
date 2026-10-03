/**
 * @tradrl/research-benchmarks — the BENCHMARK RESULT LOG (Work Order T032):
 * the append-only, chain-verified history of compiled benchmark results.
 *
 * Spec anchors: ARCHITECTURE-LOCK L11 ("Search integrity: optimization
 * history is retained to expose selection effects" — the benchmark results
 * a search produced are part of that history), L9 ("Reproducible lineage"
 * — the chain binds every appended result in order), L12 ("Tenant
 * isolation" — the log is tenant/project scoped and every appended result
 * must agree), L4 (injected instants — results carry their run instant;
 * appends stay ordered).
 *
 * THE APPEND-ONLY LAW: the log's entry list grows ONLY through
 * {@link appendBenchmarkResult}. A result id is ONE entry (`duplicate_result`).
 *
 * THE CHAIN LAW (L9/L11): h(-1) = digest(canonical(binding));
 * h(i) = digest("h(i-1)" + ":" + digest(canonical(result)));
 * head = h(n-1). {@link verifyResultLog} recomputes the whole chain; ANY
 * tamper — mutation, reordering or HIDING a result — breaks the head
 * (`chain_mismatch`).
 */

import { canonicalJson, deepFreeze, isRecord, isTimestampMs, stableDigest, stableDigestJson } from './primitives';
import type { JsonObject, TimestampMs } from './primitives';
import { isProjectId, isResultLogId, isTenantId } from './ids';
import type { ProjectId, ResultLogId, TenantId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type BenchmarkError, type BenchmarkResult } from './errors';
import { verifyBenchmarkResult } from './driver';
import type { BenchmarkResultRecord } from './driver';

// ---------------------------------------------------------------------------
// The log shapes
// ---------------------------------------------------------------------------

/** The log binding block: the scope every appended result runs under (L12). */
export interface ResultLogBinding {
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** The append-only, chain-verified benchmark result log. */
export interface BenchmarkResultLog {
  /** Derived identity: `brlog:<digest over the canonical binding>`. */
  readonly log_id: ResultLogId;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly entries: readonly BenchmarkResultRecord[];
  readonly chain_head: string;
}

/** Guard: `BenchmarkResultLog` (structural; the chain law is enforced by {@link verifyResultLog}). */
export function isBenchmarkResultLog(value: unknown): value is BenchmarkResultLog {
  if (!isRecord(value)) return false;
  if (typeof value.log_id !== 'string' || !isResultLogId(value.log_id)) return false;
  if (!isTenantId(value.tenant) || !isProjectId(value.project)) return false;
  if (!Array.isArray(value.entries)) return false;
  return typeof value.chain_head === 'string' && /^[0-9a-f]{16}$/.test(value.chain_head);
}

// ---------------------------------------------------------------------------
// The chain law
// ---------------------------------------------------------------------------

function bindingJson(binding: ResultLogBinding): JsonObject {
  return { tenant: binding.tenant, project: binding.project };
}

/** The log's derived identity: `brlog:<digest over tenant/project>`. */
export function resultLogId(binding: ResultLogBinding): ResultLogId {
  return `brlog:${stableDigestJson(bindingJson(binding))}` as ResultLogId;
}

/** The chain genesis: digest(canonical(binding)). */
export function resultChainGenesis(binding: ResultLogBinding): string {
  return stableDigestJson(bindingJson(binding));
}

/** The chain fold: digest(prev + ":" + digest(result)). */
export function resultChainFold(previousHead: string, result: BenchmarkResultRecord): string {
  return stableDigest(`${previousHead}:${stableDigestJson(result as unknown as JsonObject)}`);
}

/** The chain head recomputation over a binding and a result sequence. */
export function computeResultChainHead(binding: ResultLogBinding, results: readonly BenchmarkResultRecord[]): string {
  let head = resultChainGenesis(binding);
  for (const result of results) head = resultChainFold(head, result);
  return head;
}

// ---------------------------------------------------------------------------
// Construction + append (the only mutation API — append-only)
// ---------------------------------------------------------------------------

/** Construct an open result log (no appended results). */
export function createResultLog(value: unknown): BenchmarkResult<BenchmarkResultLog> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('log input must be an object')] };
  }
  const errors: BenchmarkError[] = [];
  if (value.tenant === undefined) errors.push(missingField('tenant'));
  else if (!isTenantId(value.tenant)) errors.push(invalidField('tenant', 'must be a non-empty tenant id (L12)'));
  if (value.project === undefined) errors.push(missingField('project'));
  else if (!isProjectId(value.project)) errors.push(invalidField('project', 'must be a non-empty project id (L15)'));
  if (Array.isArray(value.entries) && value.entries.length > 0) {
    errors.push(invalidField('entries', 'createResultLog builds an OPEN log; use appendBenchmarkResult to grow it'));
  }
  if (errors.length > 0) return { ok: false, errors };
  const binding: ResultLogBinding = {
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  return ok(
    deepFreeze({
      log_id: resultLogId(binding),
      tenant: binding.tenant,
      project: binding.project,
      entries: [],
      chain_head: resultChainGenesis(binding),
    } satisfies BenchmarkResultLog),
  );
}

/**
 * Append one compiled benchmark result (the ONLY mutation API — the log is
 * append-only). The result is VERIFIED first (structural laws + the
 * content address, `result_mismatch`); its scope must agree with the log's
 * (`tenant_mismatch`, L12); its injected instant must not rewind the log;
 * a result id already appended fails `duplicate_result`. Returns a NEW log;
 * the original is untouched.
 */
export function appendBenchmarkResult(log: BenchmarkResultLog, input: unknown): BenchmarkResult<BenchmarkResultLog> {
  if (!isBenchmarkResultLog(log)) {
    return { ok: false, errors: [invalidType('log must be a benchmark result log')] };
  }
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('append input must be an object')] };
  }
  if (input.result === undefined) {
    return { ok: false, errors: [missingField('result')] };
  }
  const resultVerification = verifyBenchmarkResult(input.result);
  if (!resultVerification.ok) return resultVerification;
  const result = resultVerification.value;

  if (result.tenant !== log.tenant || result.project !== log.project) {
    return fail(
      'tenant_mismatch',
      `result "${result.result_id}" is scoped to tenant "${result.tenant}"/project "${result.project}" but the log is scoped to "${log.tenant}"/"${log.project}" — results never cross tenants or projects (L12)`,
      'result.tenant',
    );
  }
  for (const entry of log.entries) {
    if (entry.result_id === result.result_id) {
      return fail(
        'duplicate_result',
        `result "${result.result_id}" is already appended — one id, one entry; the log is append-only and never rewrites (L11)`,
        'result.result_id',
      );
    }
  }
  const lastEntry = log.entries[log.entries.length - 1];
  if (lastEntry !== undefined && result.recorded_at < lastEntry.recorded_at) {
    return fail(
      'invalid_field',
      `result instant ${result.recorded_at} precedes the previous append's ${lastEntry.recorded_at} — the log is ordered (L4)`,
      'result.recorded_at',
    );
  }

  const binding: ResultLogBinding = { tenant: log.tenant, project: log.project };
  const entries = [...log.entries, result];
  return ok(
    deepFreeze({
      log_id: log.log_id,
      tenant: log.tenant,
      project: log.project,
      entries,
      chain_head: computeResultChainHead(binding, entries),
    } satisfies BenchmarkResultLog),
  );
}

/**
 * Verify a result log end-to-end: the binding's derived identity, every
 * entry's record law (`result_mismatch` propagation), the log-level laws
 * (unique result ids, scope agreement, monotone instants) and the CHAIN —
 * the recomputed head over the results AS STORED must equal the recorded
 * head (`chain_mismatch` on mutation, reordering or hiding). On success
 * the log is returned narrowed, deeply frozen.
 */
export function verifyResultLog(value: unknown): BenchmarkResult<BenchmarkResultLog> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('log must be an object')] };
  }
  const errors: BenchmarkError[] = [];
  for (const field of ['tenant', 'project'] as const) {
    if (value[field] === undefined) errors.push(missingField(field));
  }
  if (value.log_id === undefined) errors.push(missingField('log_id'));
  else if (!isResultLogId(value.log_id)) errors.push(invalidField('log_id', 'must be a log id ("brlog:<digest>")'));
  if (value.chain_head === undefined) errors.push(missingField('chain_head'));
  else if (typeof value.chain_head !== 'string' || !/^[0-9a-f]{16}$/.test(value.chain_head)) {
    errors.push(invalidField('chain_head', 'must be a 16-hex digest'));
  }
  if (value.entries === undefined) errors.push(missingField('entries'));
  else if (!Array.isArray(value.entries)) errors.push(invalidField('entries', 'must be an array of result records'));
  if (errors.length > 0) return { ok: false, errors };

  const binding: ResultLogBinding = {
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  if (value.log_id !== resultLogId(binding)) {
    return fail('chain_mismatch', `log_id "${value.log_id}" does not match the binding's derived identity (L9)`, 'log_id');
  }

  const seenIds = new Set<string>();
  let previousInstant: TimestampMs | undefined;
  const results: BenchmarkResultRecord[] = [];
  for (let index = 0; index < (value.entries as unknown[]).length; index++) {
    const candidate = (value.entries as unknown[])[index];
    const verification = verifyBenchmarkResult(candidate, `entries[${index}]`);
    if (!verification.ok) return verification;
    const result = verification.value;
    if (result.tenant !== binding.tenant || result.project !== binding.project) {
      return fail('tenant_mismatch', `entry ${index} crosses the log's scope (L12)`, `entries[${index}].tenant`);
    }
    if (seenIds.has(result.result_id)) {
      return fail('duplicate_result', `result "${result.result_id}" appears twice in the log (L11)`, `entries[${index}].result_id`);
    }
    seenIds.add(result.result_id);
    if (previousInstant !== undefined && result.recorded_at < previousInstant) {
      return fail('invalid_field', `entry ${index} rewinds the log's instants (L4)`, `entries[${index}].recorded_at`);
    }
    previousInstant = result.recorded_at;
    results.push(result);
  }

  const expectedHead = computeResultChainHead(binding, results);
  if (value.chain_head !== expectedHead) {
    return fail(
      'chain_mismatch',
      `chain head "${value.chain_head}" does not match the recomputed head "${expectedHead}" — the stored history was mutated, reordered or truncated (L9/L11)`,
      'chain_head',
    );
  }

  return ok(
    deepFreeze({
      log_id: value.log_id as ResultLogId,
      tenant: binding.tenant,
      project: binding.project,
      entries: results,
      chain_head: expectedHead,
    } satisfies BenchmarkResultLog),
  );
}

/** The canonical JSON bytes of a result log (determinism anchor). */
export function canonicalResultLog(log: BenchmarkResultLog): string {
  return canonicalJson(log as unknown as JsonObject);
}
