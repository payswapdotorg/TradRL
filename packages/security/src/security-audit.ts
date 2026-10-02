// @tradrl/security — the SecurityAuditRecord and the append-only,
// chain-verified security audit trail.
//
// THE LAW (spec/SECURITY.md Audit — VERBATIM: "Record who/what acted,
// BodyVersion, substrate, policy, visible market/data state, risk
// checks, order, execution and outcome for consequential actions.";
// spec/ARCHITECTURE-LOCK.md L20: "safety outside prompts"). Every
// security-consequential act in the T044 lane — tenant registration,
// scoped record writes, credential envelope registration, secret
// deposits and resolutions, episode admissions, cross-tenant denials,
// untrusted-escalation blocks, scope exports — emits EXACTLY ONE
// {@link SecurityAuditRecord} carrying the security sentence as typed
// data:
//
//   who/what acted  -> { tenant, project, actor { principal, kind } }
//   action class    -> the closed {@link SecurityAuditActionClass}
//   decision        -> 'allowed' | 'denied'
//   subject         -> the opaque { kind, ref } the act was about
//   detail          -> structured, JSON-safe, secret-free detail
//   scope           -> tenant+project on EVERY record (L12)
//   composition     -> an opaque { kind, auditId, tenant, project } ref
//                      to a REAL T040 GatewayAuditRecord when the
//                      security act joins the execution lane's chain
//                      (mirrors only — the T040 payload is never copied)
//
// THE CHAIN LAW (T040's audit.ts discipline, mirrored law-for-law): the
// trail is per tenant/project scope; the chain seed derives from the
// trail's identity skeleton `{ tenant, project, records: 0 }`
// (recoverable from the log itself so verification is total);
// `chainHead = fnv(prevHead + canonical(content))`; ids are
// content-addressed from the chain-bound content; sequences are
// contiguous and 1-based; appending out of order, splicing, editing,
// truncating, duplicating or re-auditing an already-audited action is
// the typed `audit_rewrite`. There is no removal or update API.
//
// THE OPACITY LAW: the guard runs the credential-value trip wire over
// every record — an audit trail carrying credential material is
// inexpressible. The audit is who/what/scope/decision — NEVER a secret
// (a committed/serialized secret is a typed error, and the audit trail
// is the most-serialized surface in the lane).

import { deepFreeze, isJsonObject, isMemberOf, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, fnv1a32Hex } from './primitives';
import { credentialValueViolations } from './credentials';
import type { GatewayAuditRecordId, ProjectId, SecurityAuditRecordId, TenantId } from './ids';
import { isGatewayAuditRecordId, isProjectId, isSecurityAuditRecordId, isTenantId, mintSecurityAuditRecordId } from './ids';
import type { SecurityResult } from './errors';
import { fail, invalidType, ok } from './errors';
import type { ScopedRecord } from './scope';

// ---------------------------------------------------------------------------
// The action vocabulary (closed)
// ---------------------------------------------------------------------------

/**
 * The closed vocabulary of security-consequential action classes (one
 * record per act; the vocabulary is the audit surface of the T044
 * charter).
 */
export type SecurityAuditActionClass =
  | 'tenant_registered'
  | 'project_registered'
  | 'record_written'
  | 'credential_envelope_registered'
  | 'credential_envelope_revised'
  | 'secret_deposited'
  | 'credential_resolved'
  | 'credential_resolution_refused'
  | 'episode_admitted'
  | 'episode_admission_refused'
  | 'cross_tenant_access_denied'
  | 'untrusted_escalation_blocked'
  | 'scope_exported';

/** Runtime-checkable list of security audit action classes. */
export const SECURITY_AUDIT_ACTION_CLASSES: readonly SecurityAuditActionClass[] = [
  'tenant_registered',
  'project_registered',
  'record_written',
  'credential_envelope_registered',
  'credential_envelope_revised',
  'secret_deposited',
  'credential_resolved',
  'credential_resolution_refused',
  'episode_admitted',
  'episode_admission_refused',
  'cross_tenant_access_denied',
  'untrusted_escalation_blocked',
  'scope_exported',
];

/** `true` iff the value is on the closed action-class list. */
export function isSecurityAuditActionClass(v: unknown): v is SecurityAuditActionClass {
  return isNonEmptyString(v) && (SECURITY_AUDIT_ACTION_CLASSES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The actor and the T040 composition ref
// ---------------------------------------------------------------------------

/** The WHO of a security act: the acting principal and its kind. */
export interface SecurityAuditActor {
  /** The opaque principal ref (operator identity, service label, workload ref). */
  readonly principal: string;
  /** The actor's kind (closed vocabulary). */
  readonly kind: 'operator' | 'service' | 'workload' | 'system';
}

/** Runtime-checkable list of actor kinds. */
export const SECURITY_AUDIT_ACTOR_KINDS: readonly SecurityAuditActor['kind'][] = ['operator', 'service', 'workload', 'system'];

/** Guard: `SecurityAuditActor`. */
export function isSecurityAuditActor(v: unknown): v is SecurityAuditActor {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.principal)) return false;
  if (!isMemberOf(SECURITY_AUDIT_ACTOR_KINDS, v.kind)) return false;
  return true;
}

/**
 * The opaque composition ref to a REAL T040 GatewayAuditRecord —
 * `{ kind: 'gateway_audit', auditId ('xga:'), tenant, project }`. The
 * COMPLEMENT law (T043's precedent): the join key IS present; the T040
 * payload is NEVER copied in — only the opaque ref.
 */
export interface GatewayAuditObjectRef {
  readonly kind: 'gateway_audit';
  readonly auditId: GatewayAuditRecordId;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: `GatewayAuditObjectRef`. */
export function isGatewayAuditObjectRef(v: unknown): v is GatewayAuditObjectRef {
  if (!isRecord(v)) return false;
  if (v.kind !== 'gateway_audit') return false;
  if (!isGatewayAuditRecordId(v.auditId)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  return true;
}

/** Mint the opaque composition ref over a T040 audit record identity. */
export function gatewayAuditObjectRef(auditId: GatewayAuditRecordId, tenant: TenantId, project: ProjectId): GatewayAuditObjectRef {
  return deepFreeze({ kind: 'gateway_audit' as const, auditId, tenant, project });
}

// ---------------------------------------------------------------------------
// The audit record
// ---------------------------------------------------------------------------

/** The subject of a security act: the opaque { kind, ref } it was about. */
export interface SecurityAuditSubject {
  /** The subject's kind (an opaque, lane-owned descriptor — e.g. 'record', 'envelope', 'episode'). */
  readonly kind: string;
  /** The subject's opaque ref. */
  readonly ref: string;
}

/** Guard: `SecurityAuditSubject`. */
export function isSecurityAuditSubject(v: unknown): v is SecurityAuditSubject {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.kind) && isNonEmptyString(v.ref);
}

/**
 * One security audit record — the security sentence as typed data (see
 * the module header), scope-carrying (L12), append-only and
 * chain-verified.
 */
export interface SecurityAuditRecord extends ScopedRecord {
  /** Content-addressed identity: `xsa:` + digest of the chain-bound content. */
  readonly auditId: SecurityAuditRecordId;
  /** 1-based position in the trail (contiguous — append-only). */
  readonly sequence: number;
  /** WHO/WHAT acted. */
  readonly actor: SecurityAuditActor;
  /** The action class (closed vocabulary). */
  readonly action: SecurityAuditActionClass;
  /** The decision. */
  readonly decision: 'allowed' | 'denied';
  /** The subject the act was about (null when the act is scope-level, e.g. a tenant registration). */
  readonly subject: SecurityAuditSubject | null;
  /** Structured, JSON-safe, secret-free detail (the opacity trip wire enforces secret-freedom). */
  readonly detail: JsonValue | null;
  /** The opaque T040 composition ref when the security act joins the execution lane's chain. */
  readonly gatewayAudit: GatewayAuditObjectRef | null;
  /** The act instant (epoch ms; the injected instant — no ambient clock). */
  readonly asOf: TimestampMs;
  /** The chain head binding this record to everything before it: `fnv(prev + canonical(content))`. */
  readonly chainHead: string;
}

/** Guard: `SecurityAuditRecord` (structural; the opacity trip wire included). */
export function isSecurityAuditRecord(value: unknown): value is SecurityAuditRecord {
  if (!isRecord(value)) return false;
  if (!isSecurityAuditRecordId(value.auditId)) return false;
  if (!isPositiveSafeInteger(value.sequence)) return false;
  if (!isSecurityAuditActor(value.actor)) return false;
  if (!isSecurityAuditActionClass(value.action)) return false;
  if (value.decision !== 'allowed' && value.decision !== 'denied') return false;
  if (value.subject !== null && !isSecurityAuditSubject(value.subject)) return false;
  if (value.detail !== null && !isJsonValueShape(value.detail)) return false;
  if (value.gatewayAudit !== null && !isGatewayAuditObjectRef(value.gatewayAudit)) return false;
  if (!isTimestampMs(value.asOf)) return false;
  if (typeof value.chainHead !== 'string' || !/^[0-9a-f]{8}$/.test(value.chainHead)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  // The opacity trip wire (the guard half).
  if (credentialValueViolations(value).length > 0) return false;
  return true;
}

/** JSON-shape check for the detail field (self-contained: no cross-module import cycle). */
function isJsonValueShape(v: unknown): boolean {
  if (v === null) return true;
  if (typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((element) => isJsonValueShape(element));
  if (typeof v === 'object') return Object.values(v).every((element) => isJsonValueShape(element));
  return false;
}

// ---------------------------------------------------------------------------
// The chain (append-only history verification — the T040 discipline, mirrored)
// ---------------------------------------------------------------------------

/** The actor block's canonical JSON tree. */
function actorTree(actor: SecurityAuditActor): JsonValue {
  return { principal: actor.principal, kind: actor.kind };
}

/** The subject block's canonical JSON tree. */
function subjectTree(subject: SecurityAuditSubject): JsonValue {
  return { kind: subject.kind, ref: subject.ref };
}

/** The composition ref's canonical JSON tree. */
function gatewayAuditTree(ref: GatewayAuditObjectRef): JsonValue {
  return { kind: ref.kind, auditId: ref.auditId, tenant: ref.tenant, project: ref.project };
}

/** The canonical JSON tree of a record's CONTENT (everything except `auditId` and `chainHead`). */
function auditContentTree(record: Omit<SecurityAuditRecord, 'auditId' | 'chainHead'>): JsonValue {
  return {
    sequence: record.sequence,
    actor: actorTree(record.actor),
    action: record.action,
    decision: record.decision,
    subject: record.subject === null ? null : subjectTree(record.subject),
    detail: record.detail,
    gatewayAudit: record.gatewayAudit === null ? null : gatewayAuditTree(record.gatewayAudit),
    tenant: record.tenant,
    project: record.project,
    asOf: record.asOf,
  };
}

/** The expected chain head of a record: `fnv(prevHead + canonical(content))`. */
function expectedAuditChainHead(previousHead: string, record: Omit<SecurityAuditRecord, 'auditId' | 'chainHead'>): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(auditContentTree(record))}`);
}

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

/**
 * The append-only security audit trail. Created empty per tenant/project
 * scope; grown ONLY through {@link appendSecurityAuditRecord}; verified
 * through {@link verifySecurityAuditChain}. The chain seed derives from
 * the trail's identity skeleton `{ tenant, project, records: 0 }` —
 * recoverable from the log itself so verification is total (T040's law,
 * mirrored).
 */
export interface SecurityAuditTrail {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly records: readonly SecurityAuditRecord[];
}

/** Guard: `SecurityAuditTrail` (structural). */
export function isSecurityAuditTrail(value: unknown): value is SecurityAuditTrail {
  if (!isRecord(value)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!Array.isArray(value.records) || !value.records.every((record) => isSecurityAuditRecord(record))) return false;
  return true;
}

/** The chain seed of a trail: `fnv(canonical({ tenant, project, records: 0 }))` (recoverable from the log — T040's law, mirrored). */
function auditChainSeed(trail: SecurityAuditTrail): string {
  return fnv1a32Hex(canonicalJson({ tenant: trail.tenant, project: trail.project, records: 0 }));
}

/** Create an empty security audit trail for one tenant/project scope. */
export function startSecurityAuditTrail(tenant: TenantId, project: ProjectId): SecurityResult<SecurityAuditTrail> {
  if (!isTenantId(tenant)) return fail('invalid_type', 'startSecurityAuditTrail requires a tenant scope (L12)');
  if (!isProjectId(project)) return fail('invalid_type', 'startSecurityAuditTrail requires a project scope (L12/L15)');
  return ok(deepFreeze({ tenant, project, records: [] }));
}

/**
 * Append one pre-built audit record — the trail's ONLY growth path.
 * Rules (the append-only law, T040's discipline mirrored):
 *   1. the record is guard-valid (the opacity trip wire included);
 *   2. the record's scope matches the trail's tenant/project (L12 —
 *      cross-tenant auditing is inexpressible);
 *   3. the record's sequence is the next contiguous position;
 *   4. the record's chain head folds onto the trail;
 *   5. one (action, subject-ref, asOf) triple is audited once (a
 *      duplicate act is a rewrite — one act, one audit record).
 * Returns a NEW trail; the original is untouched. There is no removal,
 * update or reordering entry point anywhere in this module.
 */
export function appendSecurityAuditRecord(trail: SecurityAuditTrail, record: SecurityAuditRecord): SecurityResult<SecurityAuditTrail> {
  if (!isSecurityAuditTrail(trail)) {
    return fail('invalid_type', 'appendSecurityAuditRecord requires a valid security audit trail');
  }
  if (!isSecurityAuditRecord(record)) {
    return fail('invalid_type', 'appendSecurityAuditRecord requires a structurally valid security audit record');
  }
  if (record.tenant !== trail.tenant || record.project !== trail.project) {
    return fail('invalid_type', `the record's scope (${record.tenant}/${record.project}) does not match the trail's (${trail.tenant}/${trail.project}) — trails are tenant-isolated (L12)`);
  }
  if (record.sequence !== trail.records.length + 1) {
    return fail(
      'audit_rewrite',
      `record ${record.auditId} claims sequence ${record.sequence} but the trail's next position is ${trail.records.length + 1} — the trail is append-only with contiguous sequences`,
      'sequence',
    );
  }
  const actKey = (r: SecurityAuditRecord): string => `${r.action}|${r.subject === null ? '' : r.subject.ref}|${r.asOf}`;
  if (trail.records.some((existing) => actKey(existing) === actKey(record))) {
    return fail('audit_rewrite', `the act ${actKey(record)} is already audited — one act, one audit record (re-auditing is rewriting)`, 'action');
  }
  const previousHead = trail.records.length === 0 ? auditChainSeed(trail) : (trail.records[trail.records.length - 1] as SecurityAuditRecord).chainHead;
  const expectedHead = expectedAuditChainHead(previousHead, record);
  if (record.chainHead !== expectedHead) {
    return fail('audit_rewrite', `record ${record.auditId}'s chain head does not fold onto the trail — the record was forged or belongs to another trail`, 'chainHead');
  }
  return ok(deepFreeze({ tenant: trail.tenant, project: trail.project, records: [...trail.records, record] }));
}

/**
 * Mint one audit record at the trail's next position (the service's
 * emission site): the record is built from the act's facts, its chain
 * head folds the previous head, and its id is content-addressed from the
 * chain-bound content. Pure; does NOT append (the caller appends through
 * {@link appendSecurityAuditRecord}).
 */
export function securityAuditRecordAt(
  trail: SecurityAuditTrail,
  content: Omit<SecurityAuditRecord, 'auditId' | 'chainHead' | 'sequence'>,
): SecurityResult<SecurityAuditRecord> {
  if (!isSecurityAuditTrail(trail)) {
    return fail('invalid_type', 'securityAuditRecordAt requires a valid security audit trail');
  }
  // The emission-site trip wire: the FACTS of the act must be secret-free
  // BEFORE they enter the chain (defense in depth — the guard re-checks).
  const violations = credentialValueViolations(content);
  if (violations.length > 0) {
    return fail('credential_value_present', `the audit facts embed credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — an audit trail is the most-serialized surface in this lane; who/what/scope/decision only, never a secret`);
  }
  if (content.tenant !== trail.tenant || content.project !== trail.project) {
    return fail('invalid_type', `the record's scope (${content.tenant}/${content.project}) does not match the trail's (${trail.tenant}/${trail.project}) — trails are tenant-isolated (L12)`);
  }
  const sequence = trail.records.length + 1;
  const previousHead = trail.records.length === 0 ? auditChainSeed(trail) : (trail.records[trail.records.length - 1] as SecurityAuditRecord).chainHead;
  const atPosition: Omit<SecurityAuditRecord, 'auditId' | 'chainHead'> = { ...content, sequence };
  const chainHead = expectedAuditChainHead(previousHead, atPosition);
  const auditId = mintSecurityAuditRecordId(fnv1a32Hex(`${chainHead}${canonicalJson(auditContentTree(atPosition))}`));
  const record: SecurityAuditRecord = deepFreeze({ ...atPosition, auditId, chainHead });
  if (!isSecurityAuditRecord(record)) {
    return fail('invalid_type', 'the minted audit record fails its own guard — the act facts are malformed');
  }
  return ok(record);
}

/**
 * Verify the security audit trail's chain: recompute every record's
 * chain head from the records themselves and check the sequences, the id
 * derivations, the scope continuity and the one-act-one-record law. A
 * trail whose history was spliced, edited, truncated or duplicated fails
 * with the typed `audit_rewrite`.
 */
export function verifySecurityAuditChain(trail: SecurityAuditTrail): SecurityResult<SecurityAuditTrail> {
  if (!isSecurityAuditTrail(trail)) {
    return fail('invalid_type', 'verifySecurityAuditChain requires a structurally valid security audit trail');
  }
  let previousHead = auditChainSeed(trail);
  const seenActs = new Set<string>();
  const actKey = (r: SecurityAuditRecord): string => `${r.action}|${r.subject === null ? '' : r.subject.ref}|${r.asOf}`;
  for (let index = 0; index < trail.records.length; index++) {
    const record = trail.records[index] as SecurityAuditRecord;
    if (record.sequence !== index + 1) {
      return fail('audit_rewrite', `record ${index} carries sequence ${record.sequence} — the trail is append-only with contiguous sequences (a splice is a rewrite)`, `records[${index}].sequence`);
    }
    const expectedHead = expectedAuditChainHead(previousHead, record);
    if (record.chainHead !== expectedHead) {
      return fail('audit_rewrite', `record ${index}'s chain head does not fold onto its content — the record (or something before it) was edited, removed or reordered`, `records[${index}].chainHead`);
    }
    const expectedId = mintSecurityAuditRecordId(fnv1a32Hex(`${record.chainHead}${canonicalJson(auditContentTree(record))}`));
    if (record.auditId !== expectedId) {
      return fail('audit_rewrite', `record ${index}'s id does not match its content — the record was edited after recording`, `records[${index}].auditId`);
    }
    if (record.tenant !== trail.tenant || record.project !== trail.project) {
      return fail('audit_rewrite', `record ${index} changes the trail's tenant/project scope — scope continuity is part of the chain`, `records[${index}]`);
    }
    const key = actKey(record);
    if (seenActs.has(key)) {
      return fail('audit_rewrite', `the act ${key} is audited twice — one act, one audit record`, `records[${index}].action`);
    }
    seenActs.add(key);
    previousHead = record.chainHead;
  }
  return ok(trail);
}

/**
 * Collect-all validation of an untrusted security audit trail: the
 * structural guard (the opacity trip wire included), then the full chain
 * verification. On success the trail is returned narrowed, deeply
 * frozen.
 */
export function validateSecurityAuditTrail(value: unknown, path = 'securityAuditTrail'): SecurityResult<SecurityAuditTrail> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  if (!isSecurityAuditTrail(value)) {
    return fail('invalid_type', `${path} fails the audit-trail guard (tenant/project scope + a record list of valid security audit records)`);
  }
  const verified = verifySecurityAuditChain(value);
  if (!verified.ok) return verified;
  return ok(deepFreeze(value));
}

/** Detail-object convenience guard (for service-side detail construction). */
export function isDetailObject(v: unknown): v is JsonValue {
  return v === null || isJsonObject(v);
}
