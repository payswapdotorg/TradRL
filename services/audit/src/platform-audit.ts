// @tradrl/audit — the PlatformAuditRecord and the append-only,
// chain-verified platform audit trail: the platform-wide WHO-DID-
// WHAT-WHEN chain.
//
// THE COMPLEMENT LAW (the Work Order): T040 owns CONSEQUENTIAL
// SUBMISSIONS (its chain-verified GatewayAuditTrail is the record of
// every gateway submission — routed or refused); THIS service owns
// PLATFORM-LEVEL ACTOR ACTIONS (access, configuration, credentials,
// operations: who did what, to which object, when). The two trails
// COMPLEMENT each other and never duplicate: a platform record
// references a T040 audit record ONLY as the opaque
// `{ kind: 'gateway-audit', auditId, tenant, project }` ref — the
// T040 payload is NEVER copied in (the complement test byte-scans
// serialized platform records to prove it).
//
// THE CHAIN (T040's `audit.ts` law-for-law): the trail is created
// empty per tenant/project scope from the identity skeleton
// `{ tenant, project, records: 0 }`; records carry 1-based CONTIGUOUS
// sequences; each record's `chainHead` folds
// `fnv(prevHead + canonical(content))`; each record's id is
// content-addressed (`pau:` + digest over the chain-bound content);
// appending a record whose OBJECT REF is already audited fails with
// the typed `audit_rewrite` (one object, one record — re-auditing is
// rewriting); a tampered, truncated or reordered trail fails
// verification with `audit_rewrite`. There is NO removal, update or
// reordering entry point anywhere in this module.
//
// THE OPACITY LAW: the guard runs the credential-value trip wire over
// every record — an audit trail carrying credential material is
// inexpressible ('cred:' refs are fine; values are not).
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L12 (tenant isolation), L15
// (project continuity — the lineage block on every record), L20
// (safety outside prompts); spec/SECURITY.md Audit + Secrets.

import {
  canonicalJson,
  credentialValueViolations,
  deepFreeze,
  fail,
  fnv1a32Hex,
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
  isTimestampMs,
  mintPlatformAuditRecordId,
  ok,
  type JsonValue,
  type ObservabilityError,
  type ObservabilityResult,
  type PlatformAuditRecordId,
  type ProjectId,
  type TenantId,
  type TimestampMs,
} from '../../../packages/observability/src/index';
import { isGatewayAuditRecordId, isProjectId, isTenantId } from '../../../packages/observability/src/index';

// ---------------------------------------------------------------------------
// The actor (WHO)
// ---------------------------------------------------------------------------

/** The closed vocabulary of platform actor kinds. */
export const PLATFORM_AUDIT_ACTOR_KINDS: readonly string[] = [
  'principal',
  'agent-instance',
  'service',
  'operator',
] as const;

/** A platform actor kind. */
export type PlatformAuditActorKind = (typeof PLATFORM_AUDIT_ACTOR_KINDS)[number];

/** Mirror guard: a platform actor kind. */
export function isPlatformAuditActorKind(v: unknown): v is PlatformAuditActorKind {
  return typeof v === 'string' && PLATFORM_AUDIT_ACTOR_KINDS.includes(v);
}

/**
 * The actor reference: WHO performed the audited action — a strategy
 * principal, a live agent instance (T006), a platform service, or a
 * human operator. The ref is OPAQUE (non-empty string; the referent
 * is owned by the actor's own lane).
 */
export interface PlatformAuditActor {
  readonly kind: PlatformAuditActorKind;
  readonly ref: string;
}

/** Guard: `PlatformAuditActor`. */
export function isPlatformAuditActor(v: unknown): v is PlatformAuditActor {
  if (!isRecord(v)) return false;
  return isPlatformAuditActorKind(v.kind) && isNonEmptyString(v.ref);
}

// ---------------------------------------------------------------------------
// The action (WHAT — a closed enumerable vocabulary)
// ---------------------------------------------------------------------------

/**
 * The closed vocabulary of platform-level action kinds (namespaced
 * like the control plane's operation kinds). T040's consequential
 * submissions are deliberately ABSENT — they are T040's lane; this
 * vocabulary covers the platform-level actor actions around them:
 * access control, observability reads, configuration/policy
 * publication, credential lifecycle (refs only), incident
 * management, the kill switch, and releases.
 */
export const PLATFORM_AUDIT_ACTION_KINDS: readonly string[] = [
  'access.granted',
  'access.revoked',
  'actor.authenticated',
  'audit.exported',
  'config.published',
  'credential.bound',
  'credential.revoked',
  'incident.opened',
  'incident.resolved',
  'kill_switch.thrown',
  'kill_switch.cleared',
  'policy.published',
  'release.deployed',
  'telemetry.queried',
] as const;

/** A platform action kind. */
export type PlatformAuditActionKind = (typeof PLATFORM_AUDIT_ACTION_KINDS)[number];

/** Mirror guard: a platform action kind. */
export function isPlatformAuditActionKind(v: unknown): v is PlatformAuditActionKind {
  return typeof v === 'string' && PLATFORM_AUDIT_ACTION_KINDS.includes(v);
}

// ---------------------------------------------------------------------------
// The object (WHICH — the acted-upon referent)
// ---------------------------------------------------------------------------

/**
 * The T040 complement reference — EXACTLY the Work Order's opaque
 * shape: `{ kind, auditId, tenant, project }` and NOTHING else. The
 * T040 record's payload is never copied in; the scope fields must
 * equal the platform record's own scope (a platform record of one
 * scope cannot even POINT at another scope's execution audit — the
 * L12 read-across default-deny).
 */
export interface GatewayAuditObjectRef {
  readonly kind: 'gateway-audit';
  /** The T040 record's 'xga:'-prefixed id (opaque join key). */
  readonly auditId: string;
  readonly tenant: string;
  readonly project: string;
}

/**
 * A platform object reference: the acted-upon object of one of the
 * platform's own lanes (an incident, a credential binding, a policy,
 * a release, a config record…). `objectType` is an OPEN vocabulary
 * (the object types are owned by their lanes); `ref` is opaque.
 */
export interface PlatformObjectRef {
  readonly kind: 'platform-object';
  readonly objectType: string;
  readonly ref: string;
}

/** The acted-upon object reference (the T040 complement ref or a platform object). */
export type PlatformAuditObjectRef = GatewayAuditObjectRef | PlatformObjectRef;

/** Guard: `PlatformAuditObjectRef` (per-kind field laws). */
export function isPlatformAuditObjectRef(v: unknown): v is PlatformAuditObjectRef {
  if (!isRecord(v)) return false;
  if (v.kind === 'gateway-audit') {
    return isGatewayAuditRecordId(v.auditId) && isNonEmptyString(v.tenant) && isNonEmptyString(v.project);
  }
  if (v.kind === 'platform-object') {
    return isNonEmptyString(v.objectType) && isNonEmptyString(v.ref);
  }
  return false;
}

// ---------------------------------------------------------------------------
// The L15 lineage block (project continuity)
// ---------------------------------------------------------------------------

/**
 * The L15 lineage block of a platform audit record: the goal version
 * the audited action serves (the control-plane mirror — `{ goalId,
 * version }`; null when the action is not goal-scoped, e.g. an
 * operator rotating a credential outside any goal), and the project
 * continuity root (identity-consistent with the record's own
 * project, guard-enforced — the control plane's lineage law,
 * mirrored).
 */
export interface PlatformAuditLineage {
  readonly goal: { readonly goalId: string; readonly version: number } | null;
  readonly project: ProjectId;
}

/** Guard: `PlatformAuditLineage`. */
export function isPlatformAuditLineage(v: unknown): v is PlatformAuditLineage {
  if (!isRecord(v)) return false;
  if (v.goal !== null) {
    const goal = v.goal;
    if (!isRecord(goal) || !isNonEmptyString(goal.goalId) || !isPositiveSafeInteger(goal.version)) return false;
  }
  return isProjectId(v.project);
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * One platform audit record — the WHO-DID-WHAT-WHEN-TO-WHICH
 * sentence as typed data:
 *   WHO    -> {@link actor} (the acting principal/instance/service/operator)
 *   WHAT   -> {@link action} (the closed action vocabulary)
 *   WHICH  -> {@link object} (the acted-upon referent; a T040 record
 *             only ever as the opaque complement ref)
 *   WHEN   -> {@link at} (the injected instant — no ambient clock)
 * plus the tenant/project scope (L12), the L15 lineage block and the
 * chain head binding the record to everything before it.
 */
export interface PlatformAuditRecord {
  /** Content-addressed identity: `pau:` + digest over (chainHead + canonical content). */
  readonly auditId: PlatformAuditRecordId;
  /** 1-based position in the trail (contiguous — append-only). */
  readonly sequence: number;
  readonly actor: PlatformAuditActor;
  readonly action: PlatformAuditActionKind;
  readonly object: PlatformAuditObjectRef;
  /** The action instant (epoch ms; injected — the kernel has no clock, neither does this trail). */
  readonly at: TimestampMs;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The L15 lineage block (goal version + the project continuity root). */
  readonly lineage: PlatformAuditLineage;
  /** The chain head binding this record to everything before it: `fnv(prev + canonical(content))`. */
  readonly chainHead: string;
}

/** The record's CONTENT (everything except the minted `auditId` and `chainHead` — the position IS part of the content, T040's law). */
export type PlatformAuditRecordContent = Omit<PlatformAuditRecord, 'auditId' | 'chainHead'>;

/** The caller-supplied half (the trail mints `sequence` onto it). */
export type PlatformAuditRecordDraft = Omit<PlatformAuditRecordContent, 'sequence'>;

// ---------------------------------------------------------------------------
// Canonical serialization (byte-determinism law, L9)
// ---------------------------------------------------------------------------

/** The actor's canonical JSON tree. */
function actorTree(actor: PlatformAuditActor): JsonValue {
  return { kind: actor.kind, ref: actor.ref };
}

/** The object ref's canonical JSON tree. */
function objectTree(object: PlatformAuditObjectRef): JsonValue {
  if (object.kind === 'gateway-audit') {
    return { kind: object.kind, auditId: object.auditId, tenant: object.tenant, project: object.project };
  }
  return { kind: object.kind, objectType: object.objectType, ref: object.ref };
}

/** The lineage block's canonical JSON tree. */
function lineageTree(lineage: PlatformAuditLineage): JsonValue {
  return {
    goal: lineage.goal === null ? null : { goalId: lineage.goal.goalId, version: lineage.goal.version },
    project: lineage.project,
  };
}

/** The canonical JSON tree of a record's CONTENT (everything except `auditId` and `chainHead`). */
export function platformAuditContentTree(record: PlatformAuditRecordContent): JsonValue {
  return {
    sequence: record.sequence,
    actor: actorTree(record.actor),
    action: record.action,
    object: objectTree(record.object),
    at: record.at,
    tenant: record.tenant,
    project: record.project,
    lineage: lineageTree(record.lineage),
  };
}

/** The canonical JSON of a record's content (byte-deterministic). */
export function canonicalPlatformAuditContentJson(content: PlatformAuditRecordContent): string {
  return canonicalJson(platformAuditContentTree(content));
}

// ---------------------------------------------------------------------------
// Collect-all validation (the untrusted-input gate)
// ---------------------------------------------------------------------------

/**
 * Collect-ALL validation of an untrusted platform audit record: every
 * structural violation is reported (typed errors, dotted paths, in
 * deterministic field order), the credential-opacity trip wire
 * included. Never throws.
 */
export function validatePlatformAuditRecord(value: unknown, path = 'platformAuditRecord'): { readonly ok: boolean; readonly errors: readonly ObservabilityError[] } {
  const errors: ObservabilityError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'invalid_type', message: `${path} must be an object`, path }] };
  }

  if (value.auditId === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.auditId` });
  else if (typeof value.auditId !== 'string' || !value.auditId.startsWith('pau:')) {
    errors.push({ code: 'invalid_field', message: 'must be a `pau:`-prefixed platform audit record id', path: `${path}.auditId` });
  }
  if (value.sequence === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.sequence` });
  else if (!isPositiveSafeInteger(value.sequence)) {
    errors.push({ code: 'invalid_field', message: 'must be a safe integer >= 1 (the 1-based trail position)', path: `${path}.sequence` });
  }
  if (value.actor === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.actor` });
  else if (!isPlatformAuditActor(value.actor)) {
    errors.push({ code: 'invalid_field', message: `must be { kind: ${PLATFORM_AUDIT_ACTOR_KINDS.join(' | ')}, ref: non-empty string }`, path: `${path}.actor` });
  }
  if (value.action === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.action` });
  else if (!isPlatformAuditActionKind(value.action)) {
    errors.push({ code: 'invalid_field', message: `must be one of the closed platform action vocabulary (${PLATFORM_AUDIT_ACTION_KINDS.length} kinds)`, path: `${path}.action` });
  }
  if (value.object === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.object` });
  else if (!isPlatformAuditObjectRef(value.object)) {
    errors.push({ code: 'invalid_field', message: 'must be a gateway-audit complement ref { kind, auditId, tenant, project } or a platform-object ref { kind, objectType, ref }', path: `${path}.object` });
  }
  if (value.at === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.at` });
  else if (!isTimestampMs(value.at)) {
    errors.push({ code: 'invalid_field', message: 'must be a valid epoch-millisecond instant (the injected action instant)', path: `${path}.at` });
  }
  if (value.tenant === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.tenant` });
  else if (!isTenantId(value.tenant)) errors.push({ code: 'invalid_field', message: 'must be a non-empty tenant id (L12)', path: `${path}.tenant` });
  if (value.project === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.project` });
  else if (!isProjectId(value.project)) errors.push({ code: 'invalid_field', message: 'must be a non-empty project id (L15)', path: `${path}.project` });
  if (value.lineage === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.lineage` });
  else if (!isPlatformAuditLineage(value.lineage)) {
    errors.push({ code: 'invalid_field', message: 'must be { goal: { goalId, version } | null, project }', path: `${path}.lineage` });
  }
  if (value.chainHead === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.chainHead` });
  else if (typeof value.chainHead !== 'string' || !/^[0-9a-f]{8}$/.test(value.chainHead)) {
    errors.push({ code: 'invalid_field', message: 'must be a lowercase 8-hex chain head', path: `${path}.chainHead` });
  }

  // The coherence laws (cross-field).
  if (isPlatformAuditLineage(value.lineage) && isProjectId(value.project) && value.lineage.project !== value.project) {
    errors.push({ code: 'invalid_field', message: 'lineage.project must equal the record\u2019s project (identity consistency, the control-plane law mirrored)', path: `${path}.lineage.project` });
  }
  if (isRecord(value.object) && value.object.kind === 'gateway-audit' && isTenantId(value.tenant) && isProjectId(value.project)) {
    const objectRef = value.object as unknown as GatewayAuditObjectRef;
    if (objectRef.tenant !== value.tenant || objectRef.project !== value.project) {
      errors.push({ code: 'invalid_field', message: `the referenced gateway-audit belongs to scope "${objectRef.tenant}/${objectRef.project}" but the record's scope is "${value.tenant}/${value.project}" — cross-scope audit references are inexpressible (L12)`, path: `${path}.object` });
    }
  }

  // The opacity trip wire (one typed error per violation path — SECURITY.md's boundary).
  for (const violation of credentialValueViolations(value)) {
    errors.push({
      code: 'credential_value_present',
      message: `credential material under credential-shaped key "${violation}" — platform audit records carry references, never values (SECURITY.md Secrets)`,
      path: violation === '' ? path : `${path}.${violation}`,
    });
  }

  return { ok: errors.length === 0, errors: Object.freeze(errors) };
}

/** Narrowing guard: a structurally valid platform audit record (the opacity trip wire and coherence laws included). */
export function isPlatformAuditRecord(value: unknown): value is PlatformAuditRecord {
  return validatePlatformAuditRecord(value).ok;
}

// ---------------------------------------------------------------------------
// The trail (append-only, chain-verified — T040's audit.ts law-for-law)
// ---------------------------------------------------------------------------

/**
 * The append-only platform audit trail. Created empty per
 * tenant/project scope; grown ONLY through
 * {@link appendPlatformAuditRecord}; verified through
 * {@link verifyPlatformAuditChain}. The chain seed derives from the
 * trail's identity skeleton `{ tenant, project, records: 0 }` —
 * recoverable from the trail itself so verification is total.
 */
export interface PlatformAuditTrail {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly records: readonly PlatformAuditRecord[];
}

/** Guard: `PlatformAuditTrail` (structural). */
export function isPlatformAuditTrail(value: unknown): value is PlatformAuditTrail {
  if (!isRecord(value)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!Array.isArray(value.records) || !value.records.every((record) => isPlatformAuditRecord(record))) return false;
  return true;
}

/** The chain seed of a trail: `fnv(canonical({ tenant, project, records: 0 }))` (the identity skeleton). */
function platformAuditChainSeed(trail: PlatformAuditTrail): string {
  return fnv1a32Hex(canonicalJson({ tenant: trail.tenant, project: trail.project, records: 0 }));
}

/** The expected chain head of a record: `fnv(prevHead + canonical(content))`. */
function expectedPlatformAuditChainHead(previousHead: string, content: PlatformAuditRecordContent): string {
  return fnv1a32Hex(`${previousHead}${canonicalPlatformAuditContentJson(content)}`);
}

/** The expected record id: `pau:` + digest over (chainHead + canonical content). */
function expectedPlatformAuditRecordId(chainHead: string, content: PlatformAuditRecordContent): PlatformAuditRecordId {
  return mintPlatformAuditRecordId(fnv1a32Hex(`${chainHead}${canonicalPlatformAuditContentJson(content)}`));
}

/** Strip the minted fields off a full record (the fold's content view). */
function contentOf(record: PlatformAuditRecord): PlatformAuditRecordContent {
  const { auditId, chainHead, ...content } = record;
  void auditId;
  void chainHead;
  return content;
}

/** Create an empty platform audit trail for one tenant/project scope. */
export function startPlatformAuditTrail(tenant: TenantId, project: ProjectId): ObservabilityResult<PlatformAuditTrail> {
  if (!isTenantId(tenant)) return fail('tenant_missing', 'startPlatformAuditTrail requires a tenant scope (L12)');
  if (!isProjectId(project)) return fail('tenant_missing', 'startPlatformAuditTrail requires a project scope (L12/L15)');
  return ok(deepFreeze({ tenant, project, records: [] }));
}

/**
 * Mint one platform audit record at the trail's next position (the
 * emission site): the record is built from the content, its chain
 * head folds the previous head, and its id is content-addressed from
 * the chain-bound content. Pure; does NOT append (the caller appends
 * through {@link appendPlatformAuditRecord}).
 */
export function platformAuditRecordAt(trail: PlatformAuditTrail, draft: PlatformAuditRecordDraft): ObservabilityResult<PlatformAuditRecord> {
  if (!isPlatformAuditTrail(trail)) {
    return fail('invalid_type', 'platformAuditRecordAt requires a valid platform audit trail');
  }
  const sequence = trail.records.length + 1;
  const previousHead = trail.records.length === 0 ? platformAuditChainSeed(trail) : (trail.records[trail.records.length - 1] as PlatformAuditRecord).chainHead;
  const atPosition: PlatformAuditRecordContent = { ...draft, sequence };
  const chainHead = expectedPlatformAuditChainHead(previousHead, atPosition);
  const auditId = expectedPlatformAuditRecordId(chainHead, atPosition);
  const record: PlatformAuditRecord = deepFreeze({ ...atPosition, auditId, chainHead });
  if (!isPlatformAuditRecord(record)) {
    // Surface the COLLECTED typed errors (opacity + coherence included).
    const collected = validatePlatformAuditRecord(record);
    if (!collected.ok) {
      return { ok: false, errors: collected.errors };
    }
    return fail('invalid_type', 'the minted platform audit record fails its own guard — the action facts are malformed');
  }
  return ok(record);
}

/**
 * Append one pre-built platform audit record — the trail's ONLY
 * growth path. Rules (the append-only law, T040's discipline
 * law-for-law):
 *   1. the record is guard-valid (the opacity trip wire and the
 *      coherence laws included);
 *   2. the record's scope matches the trail's tenant/project (L12 —
 *      cross-tenant auditing is inexpressible);
 *   3. the record's sequence is the next contiguous position;
 *   4. the record's OBJECT was not already audited (a duplicate
 *      object ref is the typed `audit_rewrite` — one object, one
 *      record; re-auditing is rewriting);
 *   5. the record's chain head folds onto the trail, and its id is
 *      the content-addressed derivation of that fold.
 * Returns a NEW trail; the original is untouched. There is no
 * removal, update or reordering entry point anywhere in this module.
 */
export function appendPlatformAuditRecord(trail: PlatformAuditTrail, record: PlatformAuditRecord): ObservabilityResult<PlatformAuditTrail> {
  if (!isPlatformAuditTrail(trail)) {
    return fail('invalid_type', 'appendPlatformAuditRecord requires a valid platform audit trail');
  }
  if (!isPlatformAuditRecord(record)) {
    return fail('invalid_type', 'appendPlatformAuditRecord requires a structurally valid platform audit record');
  }
  if (record.tenant !== trail.tenant || record.project !== trail.project) {
    return fail('tenant_missing', `the record's scope (${record.tenant}/${record.project}) does not match the trail's (${trail.tenant}/${trail.project}) — audit trails are tenant-isolated (L12)`);
  }
  if (record.sequence !== trail.records.length + 1) {
    return fail(
      'audit_rewrite',
      `record ${record.auditId} claims sequence ${record.sequence} but the trail's next position is ${trail.records.length + 1} — the trail is append-only with contiguous sequences`,
      'sequence',
    );
  }
  if (trail.records.some((existing) => canonicalJson(objectTree(existing.object)) === canonicalJson(objectTree(record.object)))) {
    return fail(
      'audit_rewrite',
      `the object ${canonicalJson(objectTree(record.object))} is already audited — one object, one record (re-auditing is rewriting)`,
      'object',
    );
  }
  const previousHead = trail.records.length === 0 ? platformAuditChainSeed(trail) : (trail.records[trail.records.length - 1] as PlatformAuditRecord).chainHead;
  const content = contentOf(record);
  const expectedHead = expectedPlatformAuditChainHead(previousHead, content);
  if (record.chainHead !== expectedHead) {
    return fail('audit_rewrite', `record ${record.auditId}'s chain head does not fold onto the trail — the record was forged or belongs to another trail`, 'chainHead');
  }
  if (record.auditId !== expectedPlatformAuditRecordId(record.chainHead, content)) {
    return fail('audit_rewrite', `record ${record.auditId}'s id does not match its chain-bound content — the record was edited after recording`, 'auditId');
  }
  return ok(deepFreeze({ tenant: trail.tenant, project: trail.project, records: [...trail.records, record] }));
}

/**
 * Verify the platform audit trail's chain: recompute every record's
 * chain head and id from the records themselves and check the
 * sequences, the scope continuity and the one-object-one-record law.
 * A trail whose history was spliced, edited, truncated, reordered or
 * duplicated fails with the typed `audit_rewrite`.
 */
export function verifyPlatformAuditChain(trail: PlatformAuditTrail): ObservabilityResult<PlatformAuditTrail> {
  if (!isPlatformAuditTrail(trail)) {
    return fail('invalid_type', 'verifyPlatformAuditChain requires a structurally valid platform audit trail');
  }
  let previousHead = platformAuditChainSeed(trail);
  const seenObjects = new Set<string>();
  for (let index = 0; index < trail.records.length; index++) {
    const record = trail.records[index] as PlatformAuditRecord;
    if (record.sequence !== index + 1) {
      return fail('audit_rewrite', `record ${index} carries sequence ${record.sequence} — the trail is append-only with contiguous sequences (a splice is a rewrite)`, `records[${index}].sequence`);
    }
    const content = contentOf(record);
    const expectedHead = expectedPlatformAuditChainHead(previousHead, content);
    if (record.chainHead !== expectedHead) {
      return fail('audit_rewrite', `record ${index}'s chain head does not fold onto its content — the record (or something before it) was edited, removed or reordered`, `records[${index}].chainHead`);
    }
    if (record.auditId !== expectedPlatformAuditRecordId(record.chainHead, content)) {
      return fail('audit_rewrite', `record ${index}'s id does not match its chain-bound content — the record was edited after recording`, `records[${index}].auditId`);
    }
    if (record.tenant !== trail.tenant || record.project !== trail.project) {
      return fail('audit_rewrite', `record ${index} changes the trail's tenant/project scope — scope continuity is part of the chain`, `records[${index}]`);
    }
    const objectKey = canonicalJson(objectTree(record.object));
    if (seenObjects.has(objectKey)) {
      return fail('audit_rewrite', `the object ${objectKey} is audited twice — one object, one record`, `records[${index}].object`);
    }
    seenObjects.add(objectKey);
    previousHead = record.chainHead;
  }
  return ok(trail);
}

/**
 * Collect-all validation of an untrusted platform audit trail: every
 * structural violation of the trail shape and of EACH record is
 * reported (typed errors, dotted paths), then the full chain
 * verification runs. On success the trail is returned narrowed,
 * deeply frozen.
 */
export function validatePlatformAuditTrail(value: unknown, path = 'platformAuditTrail'): ObservabilityResult<PlatformAuditTrail> {
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'invalid_type', message: `${path} must be an object`, path }] };
  }
  const errors: ObservabilityError[] = [];
  if (value.tenant === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.tenant` });
  else if (!isTenantId(value.tenant)) errors.push({ code: 'invalid_field', message: 'must be a non-empty tenant id (L12)', path: `${path}.tenant` });
  if (value.project === undefined) errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.project` });
  else if (!isProjectId(value.project)) errors.push({ code: 'invalid_field', message: 'must be a non-empty project id (L15)', path: `${path}.project` });
  if (value.records === undefined) {
    errors.push({ code: 'missing_field', message: 'this field is required', path: `${path}.records` });
  } else if (!Array.isArray(value.records)) {
    errors.push({ code: 'invalid_field', message: 'must be an array of platform audit records', path: `${path}.records` });
  } else {
    for (let index = 0; index < value.records.length; index++) {
      errors.push(...validatePlatformAuditRecord(value.records[index], `${path}.records[${index}]`).errors);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors: Object.freeze(errors) };
  }
  const trail = value as unknown as PlatformAuditTrail;
  const verified = verifyPlatformAuditChain(trail);
  if (!verified.ok) return verified;
  return ok(deepFreeze(trail));
}

/** The canonical JSON of one full platform audit record (id + content + chain head — the byte-scan unit). */
export function platformAuditRecordTree(record: PlatformAuditRecord): JsonValue {
  const tree = platformAuditContentTree(contentOf(record)) as Record<string, JsonValue>;
  return { ...tree, auditId: record.auditId, chainHead: record.chainHead };
}

/** The canonical JSON of a whole trail (byte-deterministic). */
export function canonicalPlatformAuditTrailJson(trail: PlatformAuditTrail): string {
  return canonicalJson({
    tenant: trail.tenant,
    project: trail.project,
    records: trail.records.map((record) => platformAuditRecordTree(record)),
  });
}
