// @tradrl/api-service — the API audit trail (T043's discipline, emitted).
//
// THE LAW (Work Order): "audit emission (who/what/when/tenant/route/
// consequence per consequential request, T043 shapes)". T043 OWNS
// the platform audit/observability contracts — this boundary EMITS,
// never defines: the record's WHO block ({ kind, ref } over T043's
// closed actor vocabulary), its L15 lineage block (goal version +
// project, T043's shape) and its platform-object ref pattern are
// STRUCTURAL MIRRORS of T043's shapes (mutually assignable — the
// interop trip wire proves it); the trail discipline is the
// program-wide chain law (T040/T044/T043 precedent, law-for-law):
//
//   - one trail per tenant/project scope, created empty from the
//     identity skeleton `{ tenant, project, records: 0 }`;
//   - 1-based CONTIGUOUS sequences; each record's `chainHead` folds
//     `fnv(prevHead + canonical(content))`;
//   - each record's id is content-addressed (`aau:` + digest over
//     the chain-bound content);
//   - append-only: there is NO removal, update or reordering entry
//     point; a tampered, truncated or reordered trail fails
//     verification with the typed `audit_rewrite` error.
//
// The ROUTE/CONSEQUENCE half is this boundary's own audit content
// (who/what/when/tenant are T043-shaped; route + consequence are the
// API's sentence): the route the request took and what happened —
// allowed/denied, the status, the affected object ref, the
// idempotency replay marker.
//
// Spec anchors: SECURITY.md Audit (who/what acted... for consequential
// actions), ARCHITECTURE-LOCK.md L9/L12/L15/L20, R43.

import { canonicalJson, deepFreeze, fnv1a32Hex, isNonEmptyString, isPositiveSafeInteger, isRecord } from './primitives';
import type { JsonValue, TimestampMs } from './primitives';
import { isTimestampMs } from './primitives';
import { mintApiAuditRecordId, type ApiAuditRecordId } from './ids';
import { isProjectId, isTenantId, type ProjectId, type TenantId } from './ids';
import { apiError, type ApiError } from './errors';
import type { AuditActor, AuditLineage } from './mirrors';
import { isAuditActor, isAuditLineage } from './mirrors';

// ---------------------------------------------------------------------------
// The action vocabulary (this boundary's own — closed)
// ---------------------------------------------------------------------------

/**
 * The API's audit action vocabulary: what KIND of boundary event a
 * record describes. Closed: adding a word is a contract change (the
// SDK surfaces these verbatim).
 */
export const API_AUDIT_ACTION_KINDS = [
  'request.allowed',
  'request.denied',
  'request.replayed',
] as const;

/** One audit action kind. */
export type ApiAuditActionKind = (typeof API_AUDIT_ACTION_KINDS)[number];

/** Guard: an audit action kind. */
export function isApiAuditActionKind(v: unknown): v is ApiAuditActionKind {
  return typeof v === 'string' && (API_AUDIT_ACTION_KINDS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** The acted-upon object reference: this boundary's object type is `api-request`; the ref is the request id. */
export interface ApiAuditObjectRef {
  readonly kind: 'platform-object';
  /** The API's own object type (T043's open object-type vocabulary — this lane owns `api-request`). */
  readonly objectType: 'api-request';
  /** The request's `req:` id. */
  readonly ref: string;
}

/** Guard: an API audit object ref. */
export function isApiAuditObjectRef(v: unknown): v is ApiAuditObjectRef {
  return (
    isRecord(v) &&
    v.kind === 'platform-object' &&
    v.objectType === 'api-request' &&
    isNonEmptyString(v.ref)
  );
}

/**
 * One API audit record — the WHO-DID-WHAT-WHEN-TO-WHICH-ROUTE-WITH-
 * WHAT-CONSEQUENCE sentence as typed data:
 *   WHO    -> {@link actor} (T043's actor shape: principal | agent-instance | service | operator + opaque ref)
 *   WHAT   -> {@link action} (allowed | denied | replayed)
 *   WHICH  -> {@link object} (the request's own `req:` id — T043's platform-object ref pattern)
 *   ROUTE  -> {@link route} (the method + path pattern + family)
 *   CONSEQUENCE -> {@link consequence} (the response status + the affected object + the replay marker)
 *   WHEN   -> {@link at} (the injected instant — no ambient clock)
 * plus the tenant/project scope (L12), the L15 lineage block (T043's
 * shape) and the chain head binding the record to everything before
 * it.
 */
export interface ApiAuditRecord {
  /** Content-addressed identity: `aau:` + digest over (chainHead + canonical content). */
  readonly auditId: ApiAuditRecordId;
  /** 1-based position in the trail (contiguous — append-only). */
  readonly sequence: number;
  readonly actor: AuditActor;
  readonly action: ApiAuditActionKind;
  readonly object: ApiAuditObjectRef;
  /** The route the request took: method, path pattern, family. */
  readonly route: { readonly method: string; readonly pattern: string; readonly family: string };
  /** The consequence: the response status, the affected object ref (when one was created/acted on), the replay marker. */
  readonly consequence: {
    readonly status: number;
    readonly affected: { readonly objectType: string; readonly ref: string } | null;
    readonly idempotentReplay: boolean;
  };
  readonly at: TimestampMs;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The L15 lineage block (T043's shape — goal version + the project continuity root). */
  readonly lineage: AuditLineage;
  /** The chain head binding this record to everything before it: `fnv(prev + canonical(content))`. */
  readonly chainHead: string;
}

/** The record's CONTENT (everything except the minted `auditId` and `chainHead`). */
export type ApiAuditRecordContent = Omit<ApiAuditRecord, 'auditId' | 'chainHead'>;

/** The caller-supplied half (the trail mints `sequence` onto it). */
export type ApiAuditRecordDraft = Omit<ApiAuditRecordContent, 'sequence'>;

/** Guard: an audit record (structural). */
export function isApiAuditRecord(v: unknown): v is ApiAuditRecord {
  if (!isRecord(v)) return false;
  if (typeof v.auditId !== 'string' || !/^aau:[0-9a-f]{8}$/.test(v.auditId)) return false;
  if (!isPositiveSafeInteger(v.sequence)) return false;
  if (!isAuditActor(v.actor)) return false;
  if (!isApiAuditActionKind(v.action)) return false;
  if (!isApiAuditObjectRef(v.object)) return false;
  const route = v.route;
  if (!isRecord(route) || !isNonEmptyString(route.method) || !isNonEmptyString(route.pattern) || !isNonEmptyString(route.family)) return false;
  const consequence = v.consequence;
  if (!isRecord(consequence) || typeof consequence.status !== 'number' || typeof consequence.idempotentReplay !== 'boolean') return false;
  if (consequence.affected !== null) {
    const affected = consequence.affected;
    if (!isRecord(affected) || !isNonEmptyString(affected.objectType) || !isNonEmptyString(affected.ref)) return false;
  }
  if (!isTimestampMs(v.at)) return false;
  if (!isTenantId(v.tenant) || !isProjectId(v.project)) return false;
  if (!isAuditLineage(v.lineage)) return false;
  if (v.lineage.project !== v.project) return false; // identity consistency
  if (typeof v.chainHead !== 'string' || !/^[0-9a-f]{8}$/.test(v.chainHead)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Canonical serialization (byte-determinism law, L9)
// ---------------------------------------------------------------------------

/** The canonical JSON tree of a record's CONTENT. */
export function apiAuditContentTree(record: ApiAuditRecordContent): JsonValue {
  return {
    sequence: record.sequence,
    actor: { kind: record.actor.kind, ref: record.actor.ref },
    action: record.action,
    object: { kind: record.object.kind, objectType: record.object.objectType, ref: record.object.ref },
    route: { method: record.route.method, pattern: record.route.pattern, family: record.route.family },
    consequence: {
      status: record.consequence.status,
      affected: record.consequence.affected === null ? null : { objectType: record.consequence.affected.objectType, ref: record.consequence.affected.ref },
      idempotentReplay: record.consequence.idempotentReplay,
    },
    at: record.at,
    tenant: record.tenant,
    project: record.project,
    lineage: {
      goal: record.lineage.goal === null ? null : { goalId: record.lineage.goal.goalId, version: record.lineage.goal.version },
      project: record.lineage.project,
    },
  };
}

/** The canonical JSON of a record's content (byte-deterministic). */
export function canonicalApiAuditContentJson(content: ApiAuditRecordContent): string {
  return canonicalJson(apiAuditContentTree(content));
}

// ---------------------------------------------------------------------------
// The trail (append-only, chain-verified — the program-wide chain law)
// ---------------------------------------------------------------------------

/** The append-only API audit trail: one per tenant/project scope. */
export interface ApiAuditTrail {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly records: readonly ApiAuditRecord[];
}

/** Guard: an audit trail (structural). */
export function isApiAuditTrail(v: unknown): v is ApiAuditTrail {
  return (
    isRecord(v) &&
    isTenantId(v.tenant) &&
    isProjectId(v.project) &&
    Array.isArray(v.records) &&
    v.records.every((record) => isApiAuditRecord(record))
  );
}

/** The chain seed of a trail: `fnv(canonical({ tenant, project, records: 0 }))` (the identity skeleton — recoverable). */
function apiAuditChainSeed(trail: ApiAuditTrail): string {
  return fnv1a32Hex(canonicalJson({ tenant: trail.tenant, project: trail.project, records: 0 }));
}

/** The expected chain head: `fnv(prevHead + canonical(content))`. */
function expectedApiAuditChainHead(previousHead: string, content: ApiAuditRecordContent): string {
  return fnv1a32Hex(`${previousHead}${canonicalApiAuditContentJson(content)}`);
}

/** The expected record id: `aau:` + digest over (chainHead + canonical content). */
function expectedApiAuditRecordId(chainHead: string, content: ApiAuditRecordContent): ApiAuditRecordId {
  return mintApiAuditRecordId(fnv1a32Hex(`${chainHead}${canonicalApiAuditContentJson(content)}`));
}

/** Strip the minted fields off a full record (the fold's content view). */
function contentOf(record: ApiAuditRecord): ApiAuditRecordContent {
  const { auditId, chainHead, ...content } = record;
  void auditId;
  void chainHead;
  return content;
}

/** Create an empty API audit trail for one tenant/project scope. */
export function startApiAuditTrail(tenant: TenantId, project: ProjectId): { readonly ok: true; readonly value: ApiAuditTrail } | { readonly ok: false; readonly error: ApiError } {
  if (!isTenantId(tenant)) return { ok: false, error: apiError('validation_failed', 'an audit trail requires a tenant scope (L12)') };
  if (!isProjectId(project)) return { ok: false, error: apiError('validation_failed', 'an audit trail requires a project scope (L12/L15)') };
  return { ok: true, value: deepFreeze({ tenant, project, records: [] }) };
}

/**
 * Mint one audit record at the trail's next position (the emission
 * site): the record is built from the content, its chain head folds
 * the previous head, and its id is content-addressed from the
 * chain-bound content. Pure; does NOT append.
 */
export function apiAuditRecordAt(trail: ApiAuditTrail, draft: ApiAuditRecordDraft): { readonly ok: true; readonly value: ApiAuditRecord } | { readonly ok: false; readonly error: ApiError } {
  if (!isApiAuditTrail(trail)) {
    return { ok: false, error: apiError('validation_failed', 'apiAuditRecordAt requires a valid API audit trail') };
  }
  const sequence = trail.records.length + 1;
  const content: ApiAuditRecordContent = { ...draft, sequence };
  if (content.lineage.project !== trail.project || content.tenant !== trail.tenant) {
    return { ok: false, error: apiError('cross_tenant_access', 'an audit record may only be appended to its own scope\'s trail (L12)') };
  }
  const previousHead = trail.records.length === 0 ? apiAuditChainSeed(trail) : trail.records[trail.records.length - 1]!.chainHead;
  const chainHead = expectedApiAuditChainHead(previousHead, content);
  const auditId = expectedApiAuditRecordId(chainHead, content);
  return { ok: true, value: deepFreeze({ ...content, auditId, chainHead }) };
}

/** Append one minted record (the ONLY growth path; returns the NEXT trail). */
export function appendApiAuditRecord(trail: ApiAuditTrail, record: ApiAuditRecord): { readonly ok: true; readonly value: ApiAuditTrail } | { readonly ok: false; readonly error: ApiError } {
  if (!isApiAuditRecord(record)) {
    return { ok: false, error: apiError('validation_failed', 'appendApiAuditRecord requires a valid API audit record') };
  }
  if (!isApiAuditTrail(trail)) {
    return { ok: false, error: apiError('validation_failed', 'appendApiAuditRecord requires a valid API audit trail') };
  }
  if (record.sequence !== trail.records.length + 1) {
    return { ok: false, error: apiError('conflict', `the record's sequence ${record.sequence} is not the trail's next position ${trail.records.length + 1} (append-only, contiguous)`) };
  }
  if (record.tenant !== trail.tenant || record.project !== trail.project) {
    return { ok: false, error: apiError('cross_tenant_access', 'an audit record of one scope cannot be appended to another scope\'s trail (L12)') };
  }
  const previousHead = trail.records.length === 0 ? apiAuditChainSeed(trail) : trail.records[trail.records.length - 1]!.chainHead;
  const expected = expectedApiAuditChainHead(previousHead, contentOf(record));
  if (record.chainHead !== expected) {
    return { ok: false, error: apiError('conflict', 'the record\'s chain head does not fold the trail\'s previous head (chain continuity)') };
  }
  return { ok: true, value: deepFreeze({ tenant: trail.tenant, project: trail.project, records: Object.freeze([...trail.records, record]) }) };
}

/**
 * Verify a whole trail: contiguous 1-based sequences, every chain
 * head folding its predecessor, every id content-addressed from the
 * chain-bound content. A tampered, truncated or reordered trail is
 * the typed `conflict` error (the program's `audit_rewrite` law —
 * rewriting or hiding history is detectable, always).
 */
export function verifyApiAuditChain(trail: ApiAuditTrail): { readonly ok: true } | { readonly ok: false; readonly error: ApiError } {
  if (!isApiAuditTrail(trail)) {
    return { ok: false, error: apiError('validation_failed', 'verifyApiAuditChain requires a valid API audit trail') };
  }
  let previousHead = apiAuditChainSeed(trail);
  for (let index = 0; index < trail.records.length; index++) {
    const record = trail.records[index]!;
    if (record.sequence !== index + 1) {
      return { ok: false, error: apiError('conflict', `the trail's sequence is not contiguous at position ${index + 1} (append-only law)`) };
    }
    const content = contentOf(record);
    const expectedHead = expectedApiAuditChainHead(previousHead, content);
    if (record.chainHead !== expectedHead) {
      return { ok: false, error: apiError('conflict', `the chain head at sequence ${record.sequence} does not fold its predecessor — the trail was rewritten, truncated or reordered`) };
    }
    const expectedId = expectedApiAuditRecordId(record.chainHead, content);
    if (record.auditId !== expectedId) {
      return { ok: false, error: apiError('conflict', `the record id at sequence ${record.sequence} does not match its chain-bound content — a forged audit record`) };
    }
    previousHead = record.chainHead;
  }
  return { ok: true };
}
