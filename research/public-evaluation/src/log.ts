/**
 * @tradrl/research-public-evaluation — the PUBLICATION LOG (Work Order
 * T049): the append-only, chain-verified history of published
 * evaluation records.
 *
 * THE APPEND-ONLY LAW (L11): the log's `entries` grow ONLY through
 * {@link publishRecord}. One published id, one entry; IDENTICAL bytes
 * replay idempotently ({@link publishRecord} returns `replayed: true`
 * and the log is untouched — republication of the same content-addressed
 * record is legitimate); DIFFERENT bytes for the same POINT-IN-TIME
 * CLAIM KEY (suite name, subject artifact digest, as-of instant) are
 * refused (`duplicate_publication` — the point-in-time claim is
 * immutable; corrections publish at a new as-of, which is the L4-honest
 * way: you publish what you knew WHEN).
 *
 * THE CHAIN LAW (L9/L11): every log carries a `chain_head` binding the
 * scope and EVERY entry, in append order:
 *
 *     h(-1)  = digest(canonical(binding))
 *     h(i)   = digest("h(i-1)" + ":" + digest(canonical(entries[i])))
 *     head   = h(entries.length - 1)
 *
 * {@link verifyPublicationLog} recomputes the whole chain; ANY tamper —
 * a mutated field, a REORDERED log, a REMOVED (memory-holed) publication
 * — breaks the head and fails `chain_mismatch`.
 */

import { deepFreeze, isRecord, stableDigest, stableDigestJson } from './primitives';
import type { JsonObject } from './primitives';
import { isProjectId, isPublicationLogId, isTenantId } from './ids';
import type { ProjectId, PublicationLogId, TenantId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type PublicationError, type PublicationResult } from './errors';
import { verifyPublishedRecord, publicationClaimKey, canonicalPublication } from './record';
import type { PublishedEvaluationRecord } from './record';

/** The log's scope binding (L12/L15). */
export interface PublicationLogBinding {
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** One log entry: the published record verbatim + the digest of its canonical bytes (the chain's fold input). */
export interface PublicationLogEntry {
  readonly record: PublishedEvaluationRecord;
  /** The digest of the record's canonical bytes (the chain folds this). */
  readonly record_digest: string;
}

/** The append-only, chain-verified publication log. */
export interface PublicationLog {
  /** Derived identity: `pevl:<digest over the canonical binding>`. */
  readonly log_id: PublicationLogId;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly entries: readonly PublicationLogEntry[];
  readonly chain_head: string;
}

/** The canonical binding JSON (the identity + chain-genesis input). */
function bindingJson(binding: PublicationLogBinding): JsonObject {
  return { tenant: binding.tenant, project: binding.project };
}

/** The log's derived identity: `pevl:<digest over the canonical binding>`. */
export function publicationLogId(binding: PublicationLogBinding): PublicationLogId {
  return `pevl:${stableDigestJson(bindingJson(binding))}` as PublicationLogId;
}

/** The chain genesis: digest(canonical(binding)). */
export function publicationChainGenesis(binding: PublicationLogBinding): string {
  return stableDigestJson(bindingJson(binding));
}

/** The chain fold: digest(prev + ":" + entry.record_digest) — the record digest is itself the digest of the record's canonical bytes, so the chain binds the full record. */
export function publicationChainFold(previousHead: string, entry: PublicationLogEntry): string {
  return stableDigest(`${previousHead}:${entry.record_digest}`);
}

/** The head recomputation over a binding and an entry sequence. */
export function computePublicationChainHead(binding: PublicationLogBinding, entries: readonly PublicationLogEntry[]): string {
  let head = publicationChainGenesis(binding);
  for (const entry of entries) head = publicationChainFold(head, entry);
  return head;
}

/** Guard: `PublicationLog` (structural). */
export function isPublicationLog(value: unknown): value is PublicationLog {
  if (!isRecord(value)) return false;
  if (!isPublicationLogId(value.log_id)) return false;
  if (!isTenantId(value.tenant) || !isProjectId(value.project)) return false;
  if (!Array.isArray(value.entries)) return false;
  return typeof value.chain_head === 'string' && /^[0-9a-f]{16}$/.test(value.chain_head);
}

/** Open a new publication log for one tenant/project scope (L12). */
export function createPublicationLog(value: unknown): PublicationResult<PublicationLog> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('log input must be an object')] };
  }
  const errors: PublicationError[] = [];
  if (value.tenant === undefined) errors.push(missingField('tenant'));
  else if (!isTenantId(value.tenant)) errors.push(invalidField('tenant', 'must be a non-empty tenant id (L12)'));
  if (value.project === undefined) errors.push(missingField('project'));
  else if (!isProjectId(value.project)) errors.push(invalidField('project', 'must be a non-empty project id (L15)'));
  if (Array.isArray(value.entries) && (value.entries as readonly unknown[]).length > 0) {
    errors.push(invalidField('entries', 'createPublicationLog builds an OPEN log; use publishRecord to grow it'));
  }
  if (errors.length > 0) return { ok: false, errors };
  const binding: PublicationLogBinding = {
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  return ok(
    deepFreeze({
      log_id: publicationLogId(binding),
      tenant: binding.tenant,
      project: binding.project,
      entries: [],
      chain_head: publicationChainGenesis(binding),
    } satisfies PublicationLog),
  );
}

/** The append outcome: the grown log plus the replay flag. */
export interface PublicationAppend {
  readonly log: PublicationLog;
  /** true when the identical record was already published (idempotent replay — the log is untouched). */
  readonly replayed: boolean;
}

/**
 * Publish one record onto the log. The record verifies through the
 * content-address + L4 laws; the scope agrees (`tenant_mismatch`);
 * identical bytes replay idempotently; DIFFERENT bytes for the same
 * point-in-time claim key are refused (`duplicate_publication` — the
 * claim is immutable at its as-of instant).
 */
export function publishRecord(log: PublicationLog, input: unknown): PublicationResult<PublicationAppend> {
  if (!isPublicationLog(log)) {
    return { ok: false, errors: [invalidType('log must be a publication log')] };
  }
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('publish input must be an object')] };
  }
  if (input.record === undefined) {
    return { ok: false, errors: [missingField('record')] };
  }
  const verification = verifyPublishedRecord(input.record);
  if (!verification.ok) return verification;
  const record = verification.value;

  if (record.tenant !== log.tenant || record.project !== log.project) {
    return fail(
      'tenant_mismatch',
      `publication "${record.record_id}" is scoped to tenant "${record.tenant}"/project "${record.project}" but the log is scoped to "${log.tenant}"/"${log.project}" — publications never cross tenants or projects (L12)`,
      'record.tenant',
    );
  }

  const claimKey = publicationClaimKey(record);
  for (const entry of log.entries) {
    if (entry.record.record_id === record.record_id) {
      return ok(deepFreeze({ log, replayed: true } satisfies PublicationAppend));
    }
    if (publicationClaimKey(entry.record) === claimKey) {
      return fail(
        'duplicate_publication',
        `the point-in-time claim "${claimKey}" is already published as "${entry.record.record_id}" — a published claim at its as-of instant is immutable (L11); corrections publish at a NEW as-of instant (the L4-honest way)`,
        'record',
      );
    }
  }

  const binding: PublicationLogBinding = { tenant: log.tenant, project: log.project };
  const entry = deepFreeze({ record, record_digest: stableDigest(canonicalPublication(record)) } satisfies PublicationLogEntry);
  const entries = [...log.entries, entry];
  return ok(
    deepFreeze({
      log: deepFreeze({
        log_id: log.log_id,
        tenant: log.tenant,
        project: log.project,
        entries,
        chain_head: computePublicationChainHead(binding, entries),
      } satisfies PublicationLog),
      replayed: false,
    } satisfies PublicationAppend),
  );
}

/**
 * VERIFY a publication log end-to-end: the derived identity, every
 * entry's record verification, the scope/claim-key laws, and the CHAIN —
 * the recomputed head over the entries AS STORED must equal the recorded
 * head (`chain_mismatch` on mutation, reordering or memory-holing).
 */
export function verifyPublicationLog(value: unknown): PublicationResult<PublicationLog> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('log must be an object')] };
  }
  const errors: PublicationError[] = [];
  for (const field of ['tenant', 'project'] as const) {
    if (value[field] === undefined) errors.push(missingField(field));
  }
  if (value.log_id === undefined) errors.push(missingField('log_id'));
  else if (!isPublicationLogId(value.log_id)) errors.push(invalidField('log_id', 'must be a log id ("pevl:<digest>")'));
  if (value.chain_head === undefined) errors.push(missingField('chain_head'));
  else if (typeof value.chain_head !== 'string' || !/^[0-9a-f]{16}$/.test(value.chain_head)) {
    errors.push(invalidField('chain_head', 'must be a 16-hex digest'));
  }
  if (value.entries === undefined) errors.push(missingField('entries'));
  else if (!Array.isArray(value.entries)) errors.push(invalidField('entries', 'must be an array of publication entries'));
  if (errors.length > 0) return { ok: false, errors };

  const binding: PublicationLogBinding = {
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  if (value.log_id !== publicationLogId(binding)) {
    return fail('chain_mismatch', `log_id "${value.log_id}" does not match the binding's derived identity (L9)`, 'log_id');
  }

  const seenIds = new Set<string>();
  const seenClaimKeys = new Set<string>();
  const entries: PublicationLogEntry[] = [];
  for (let index = 0; index < (value.entries as unknown[]).length; index++) {
    const candidate = (value.entries as unknown[])[index];
    if (!isRecord(candidate) || !isRecord(candidate.record)) {
      return { ok: false, errors: [invalidField(`entries[${index}]`, 'must carry a published record')] };
    }
    const verification = verifyPublishedRecord(candidate.record, `entries[${index}].record`);
    if (!verification.ok) return verification;
    const record = verification.value;
    // The stored record_digest must equal the digest of the record's own
    // canonical bytes — a tampered digest field is a tampered log (the chain
    // folds this value, so the stored copy is checked against the recomputed
    // one; `chain_mismatch` on divergence).
    const recomputedDigest = stableDigest(canonicalPublication(record));
    if (candidate.record_digest !== recomputedDigest) {
      return fail(
        'chain_mismatch',
        `entry ${index} stores record digest "${typeof candidate.record_digest === 'string' ? candidate.record_digest : '<non-string>'}" but the record's canonical bytes address to "${recomputedDigest}" — the stored digest was mutated (L9/L11)`,
        `entries[${index}].record_digest`,
      );
    }
    if (record.tenant !== binding.tenant || record.project !== binding.project) {
      return fail('tenant_mismatch', `entry ${index} crosses the log's scope (L12)`, `entries[${index}].record.tenant`);
    }
    if (seenIds.has(record.record_id)) {
      return fail('duplicate_publication', `record "${record.record_id}" appears twice in the log (L11)`, `entries[${index}].record.record_id`);
    }
    seenIds.add(record.record_id);
    const claimKey = publicationClaimKey(record);
    if (seenClaimKeys.has(claimKey)) {
      return fail('duplicate_publication', `the point-in-time claim "${claimKey}" appears twice in the log (L11)`, `entries[${index}].record`);
    }
    seenClaimKeys.add(claimKey);
    entries.push(deepFreeze({ record, record_digest: recomputedDigest } satisfies PublicationLogEntry));
  }

  const expectedHead = computePublicationChainHead(binding, entries);
  if (value.chain_head !== expectedHead) {
    return fail(
      'chain_mismatch',
      `chain head "${value.chain_head as string}" does not match the recomputed head "${expectedHead}" — the stored history was mutated, reordered or memory-holed (L9/L11)`,
      'chain_head',
    );
  }

  return ok(
    deepFreeze({
      log_id: publicationLogId(binding),
      tenant: binding.tenant,
      project: binding.project,
      entries,
      chain_head: expectedHead,
    } satisfies PublicationLog),
  );
}
