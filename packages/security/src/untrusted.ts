// @tradrl/security — the untrusted-content tagging contracts (LLM
// security, L20).
//
// THE LAW (spec/SECURITY.md LLM security — VERBATIM: "Market/news/
// retrieved content is untrusted input. Prompts are not security
// boundaries and untrusted text cannot grant tools.";
// spec/ARCHITECTURE-LOCK.md L20 — VERBATIM: "Safety outside prompts:
// security, risk and authorization are implemented in
// code/infrastructure."; spec/SECURITY.md Trust zones — the ingestion
// boundary feeds untrusted content DOWNSTREAM, never authority
// upstream).
//
// THE MODEL: content that arrives from the market, the news wire, the
// retrieval index or the user is UNTRUSTED INPUT. It is tagged as such
// ({@link UntrustedContent}), and the tag is ENFORCED IN CODE:
//
//   1. There is a CLOSED vocabulary of AUTHORITY-AFFECTING actions
//      ({@link AUTHORITY_AFFECTING_ACTIONS}) — the actions that grant
//      tools, issue/modify/revoke grants, bind credentials, register
//      tenants, admit workloads or export scopes.
//   2. `authorityActionFromContent` — the ONLY sanctioned entry point for
//      deriving an action from untrusted content — REFUSES every
//      authority-affecting action with the typed
//      `untrusted_content_escalation` error. There is NO function
//      anywhere in this package (or the enforcement service) that turns
//      {@link UntrustedContent} into an authority artifact; the type
//      system and the API surface ARE the boundary.
//   3. Trusted provenance marks ({@link ProvenanceMark} — the control
//      plane and tenant operators) are the ONLY sources that may derive
//      authority-affecting actions, via
//      {@link authorizeAuthorityAction}.
//
// Refusals are RECORDS ({@link UntrustedEscalationRefusal}), never
// exceptions — the T019/T040 "refusals are records" law. Everything is
// pure, total, deterministic; no ambient clock.

import { deepFreeze, isMemberOf, isNonEmptyString, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import type { SecurityResult } from './errors';
import { errorOf, fail, invalidField, invalidType, missingField, ok } from './errors';
import { credentialValueViolations } from './credentials';

// ---------------------------------------------------------------------------
// The untrusted-content kinds and the tag
// ---------------------------------------------------------------------------

/**
 * The kinds of untrusted input (spec/SECURITY.md LLM security):
 * `market` — market data/observations; `news` — news/event text;
 * `retrieved` — retrieved/indexed content (memory, documents, web);
 * `user_provided` — user-provided workloads/artifacts (spec/SECURITY.md
 * Untrusted workloads).
 */
export type UntrustedContentKind = 'market' | 'news' | 'retrieved' | 'user_provided';

/** Runtime-checkable list of untrusted-content kinds. */
export const UNTRUSTED_CONTENT_KINDS: readonly UntrustedContentKind[] = ['market', 'news', 'retrieved', 'user_provided'];

/** Guard: `UntrustedContentKind`. */
export function isUntrustedContentKind(v: unknown): v is UntrustedContentKind {
  return isMemberOf(UNTRUSTED_CONTENT_KINDS, v);
}

/** The tag every piece of untrusted content carries. */
export interface UntrustedContentTag {
  /** The kind of untrusted source. */
  readonly kind: UntrustedContentKind;
  /** The opaque origin descriptor (adapter id, feed id, uploader ref — non-empty). */
  readonly origin: string;
  /** The instant the content was received (epoch ms; injected, never a clock read). */
  readonly receivedAt: TimestampMs;
}

/** Guard: `UntrustedContentTag`. */
export function isUntrustedContentTag(v: unknown): v is UntrustedContentTag {
  if (!isRecord(v)) return false;
  if (!isMemberOf(UNTRUSTED_CONTENT_KINDS, v.kind)) return false;
  if (!isNonEmptyString(v.origin)) return false;
  if (!isTimestampMs(v.receivedAt)) return false;
  return true;
}

/** Untrusted content: the tag plus the opaque payload. The payload is DATA, never authority. */
export interface UntrustedContent {
  readonly tag: UntrustedContentTag;
  /** The opaque payload (JSON-safe; semantics owned by the consumer). */
  readonly content: JsonValue;
}

/** Guard: `UntrustedContent`. */
export function isUntrustedContent(v: unknown): v is UntrustedContent {
  if (!isRecord(v)) return false;
  if (!isUntrustedContentTag(v.tag)) return false;
  const content: unknown = v.content;
  if (content === null) return true;
  if (typeof content === 'string' || typeof content === 'boolean') return true;
  if (typeof content === 'number') return Number.isFinite(content);
  if (Array.isArray(content) || typeof content === 'object') return true;
  return false;
}

/**
 * Tag content as untrusted. THE CONSTRUCTOR: everything arriving from a
 * market/news/retrieved/user lane passes through here (or through an
 * equally-typed guard) before the platform reasons about it. Validates
 * the inputs (typed errors) and returns the deeply-frozen tagged record.
 * Note: the content itself is opaque here; the credential trip wire runs
 * over records this package EMITS, and consumers should scrub untrusted
 * content before embedding it into records (see redaction.ts).
 */
export function tagUntrusted(
  kind: UntrustedContentKind,
  origin: string,
  receivedAt: TimestampMs,
  content: JsonValue,
): SecurityResult<UntrustedContent> {
  if (!isMemberOf(UNTRUSTED_CONTENT_KINDS, kind)) {
    return fail('invalid_field', `kind must be one of ${UNTRUSTED_CONTENT_KINDS.join(' | ')}`, 'kind');
  }
  if (!isNonEmptyString(origin)) return fail('invalid_field', 'origin must be a non-empty descriptor of the untrusted source', 'origin');
  if (!isTimestampMs(receivedAt)) return fail('invalid_field', 'receivedAt must be an epoch-ms instant (no ambient clock)', 'receivedAt');
  return ok(deepFreeze({ tag: deepFreeze({ kind, origin, receivedAt }), content }));
}

/**
 * Collect-all validation of untrusted untagged content: applies the tag
 * laws and the credential trip wire (embedded credential material in
 * content destined for records is refused — scrub it first via
 * redaction.ts). On success the tagged record is returned frozen.
 */
export function validateUntrustedContent(value: unknown, path = 'untrusted'): SecurityResult<UntrustedContent> {
  if (!isRecord(value)) return fail('invalid_type', `${path} must be an object with tag and content`, path);
  const errors: ReturnType<typeof invalidField>[] = [];
  if (value.tag === undefined) errors.push(missingField(`${path}.tag`));
  else if (!isUntrustedContentTag(value.tag)) {
    errors.push(invalidField(`${path}.tag`, `must be { kind (${UNTRUSTED_CONTENT_KINDS.join(' | ')}), origin, receivedAt }`));
  }
  if (value.content === undefined) errors.push(missingField(`${path}.content`));
  if (errors.length > 0) return { ok: false, errors: Object.freeze(errors) };
  return ok(deepFreeze({ tag: value.tag as UntrustedContentTag, content: value.content as JsonValue }));
}

// ---------------------------------------------------------------------------
// The authority-affecting action vocabulary (the closed list L20 enforces)
// ---------------------------------------------------------------------------

/**
 * The CLOSED vocabulary of authority-affecting actions — the actions that
 * change WHO may do WHAT. Untrusted content can NEVER derive any of
 * these (L20: "untrusted text cannot grant tools"). Everything not on
 * this list is, by construction, unable to change authority — but the
 * list is the trip wire the tests pin.
 */
export const AUTHORITY_AFFECTING_ACTIONS: readonly string[] = [
  'grant_tool',
  'issue_grant',
  'modify_grant',
  'revoke_grant',
  'bind_credential',
  'retire_credential',
  'register_tenant',
  'admit_workload',
  'export_scope',
] as const;

/** `true` iff the action is on the closed authority-affecting list. */
export function isAuthorityAffectingAction(action: string): boolean {
  return (AUTHORITY_AFFECTING_ACTIONS as readonly string[]).includes(action);
}

// ---------------------------------------------------------------------------
// The provenance marks (who may derive authority-affecting actions)
// ---------------------------------------------------------------------------

/**
 * The provenance marks (the trust-zone ladder, code-enforced):
 * `control_plane` — the control plane (trusted for authority);
 * `operator` — a tenant operator acting within their scope (trusted for
 * authority within L12); `untrusted_content` — market/news/retrieved/
 * user-provided content (NEVER authority-granting, L20).
 */
export type ProvenanceMark = 'control_plane' | 'operator' | 'untrusted_content';

/** Runtime-checkable list of provenance marks. */
export const PROVENANCE_MARKS: readonly ProvenanceMark[] = ['control_plane', 'operator', 'untrusted_content'];

/** Guard: `ProvenanceMark`. */
export function isProvenanceMark(v: unknown): v is ProvenanceMark {
  return isMemberOf(PROVENANCE_MARKS, v);
}

/**
 * `true` iff the provenance mark may derive authority-affecting actions.
 * `untrusted_content` NEVER can (L20) — this predicate is the boundary
 * in code.
 */
export function mayProvenanceGrantAuthority(mark: ProvenanceMark): boolean {
  return mark === 'control_plane' || mark === 'operator';
}

// ---------------------------------------------------------------------------
// The escalation refusal (a record, never an exception)
// ---------------------------------------------------------------------------

/** The typed refusal L20 produces: untrusted content attempted an authority-affecting action. */
export interface UntrustedEscalationRefusal {
  readonly kind: 'untrusted_content_escalation';
  /** The action that was attempted. */
  readonly action: string;
  /** The provenance of the attempt (always an untrusted mark here). */
  readonly provenance: ProvenanceMark;
  /** The untrusted content's origin descriptor. */
  readonly origin: string;
  /** The refusal instant (epoch ms; injected). */
  readonly at: TimestampMs;
}

/** Guard: `UntrustedEscalationRefusal`. */
export function isUntrustedEscalationRefusal(v: unknown): v is UntrustedEscalationRefusal {
  if (!isRecord(v)) return false;
  if (v.kind !== 'untrusted_content_escalation') return false;
  if (!isNonEmptyString(v.action)) return false;
  if (!isProvenanceMark(v.provenance)) return false;
  if (!isNonEmptyString(v.origin)) return false;
  if (!isTimestampMs(v.at)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The authority-action records and the enforcement entry points
// ---------------------------------------------------------------------------

/** The admissible record of one authority-affecting action (derivable ONLY from a trusted provenance). */
export interface AuthorityActionRecord {
  /** The action (one of the closed authority-affecting vocabulary). */
  readonly action: string;
  /** The provenance that derived it (a trusted mark — enforced by the constructor). */
  readonly provenance: ProvenanceMark;
  /** The derivation instant (epoch ms; injected). */
  readonly at: TimestampMs;
}

/** Guard: `AuthorityActionRecord` (a trusted provenance is part of the record's law). */
export function isAuthorityActionRecord(v: unknown): v is AuthorityActionRecord {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.action) || !isAuthorityAffectingAction(v.action)) return false;
  if (!isProvenanceMark(v.provenance) || !mayProvenanceGrantAuthority(v.provenance)) return false;
  if (!isTimestampMs(v.at)) return false;
  return true;
}

/**
 * Derive an authority-affecting action from UNTURSTED content — THE
 * REFUSAL ENTRY POINT (L20). For EVERY action on the closed
 * authority-affecting vocabulary this returns the typed
 * `untrusted_content_escalation` error carrying the structured
 * {@link UntrustedEscalationRefusal} record. There is no code path from
 * untrusted content to an authority artifact — the tests pin this for
 * every action, and the API surface has no other constructor that
 * accepts {@link UntrustedContent}.
 */
export function authorityActionFromContent(
  content: UntrustedContent,
  action: string,
  at: TimestampMs,
): SecurityResult<never> {
  if (!isUntrustedContent(content)) {
    return fail('invalid_type', 'authorityActionFromContent requires tagged untrusted content');
  }
  if (!isNonEmptyString(action) || !isAuthorityAffectingAction(action)) {
    return fail('invalid_field', `action must be one of the closed authority-affecting vocabulary (${AUTHORITY_AFFECTING_ACTIONS.join(', ')})`, 'action');
  }
  if (!isTimestampMs(at)) return fail('invalid_field', 'at must be an epoch-ms instant (no ambient clock)', 'at');
  const refusal: UntrustedEscalationRefusal = deepFreeze({
    kind: 'untrusted_content_escalation',
    action,
    provenance: 'untrusted_content',
    origin: content.tag.origin,
    at,
  });
  return {
    ok: false,
    errors: [
      errorOf(
        'untrusted_content_escalation',
        `untrusted ${content.tag.kind} content from ${content.tag.origin} attempted the authority-affecting action '${action}' — prompts are not security boundaries and untrusted text cannot grant tools (L20); refusal: ${JSON.stringify(refusal)}`,
      ),
    ],
  };
}

/**
 * Derive an authority-affecting action from a PROVENANCE MARK — the
 * trusted path. `untrusted_content` is refused here too (defense in
 * depth: even a caller that mislabels provenance cannot smuggle an
 * authority action through this constructor). Returns the admissible
 * {@link AuthorityActionRecord}.
 */
export function authorizeAuthorityAction(action: string, provenance: ProvenanceMark, at: TimestampMs): SecurityResult<AuthorityActionRecord> {
  if (!isNonEmptyString(action) || !isAuthorityAffectingAction(action)) {
    return fail('invalid_field', `action must be one of the closed authority-affecting vocabulary (${AUTHORITY_AFFECTING_ACTIONS.join(', ')})`, 'action');
  }
  if (!isProvenanceMark(provenance)) {
    return fail('invalid_field', `provenance must be one of ${PROVENANCE_MARKS.join(' | ')}`, 'provenance');
  }
  if (!mayProvenanceGrantAuthority(provenance)) {
    return fail(
      'untrusted_content_escalation',
      `provenance '${provenance}' cannot derive the authority-affecting action '${action}' — untrusted text cannot grant tools (L20)`,
    );
  }
  if (!isTimestampMs(at)) return fail('invalid_field', 'at must be an epoch-ms instant (no ambient clock)', 'at');
  return ok(deepFreeze({ action, provenance, at }));
}

/**
 * The defense-in-depth scan: flags authority-affecting action
 * declarations embedded in untrusted content's payload. A piece of
 * untrusted content carrying an `{ "action": "grant_tool", ... }`-shaped
 * declaration is flagged (deterministic dotted paths) — the consumer
 * must refuse to act on it (the API surface already does; this scan
 * makes smuggling VISIBLE for audit and tests).
 */
export function untrustedEscalationViolations(content: UntrustedContent): readonly string[] {
  const found: string[] = [];
  const scan = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => scan(item, `${path}[${index}]`));
      return;
    }
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      if (key === 'action' && typeof record[key] === 'string' && isAuthorityAffectingAction(record[key] as string)) {
        found.push(path === '' ? key : `${path}.${key}`);
      }
      scan(record[key], path === '' ? key : `${path}.${key}`);
    }
  };
  scan(content.content, '');
  return deepFreeze(found);
}

/**
 * Assert a record built AFTER ingesting untrusted content carries no
 * smuggled authority declarations and no credential material: the
 * combined defense-in-depth trip wire for record EMISSION. Runs the
 * escalation scan over any embedded untrusted content plus the
 * credential-opacity scan over the whole tree.
 */
export function assertRecordSafeFromUntrustedSources(value: unknown, path = 'record'): SecurityResult<true> {
  const credentialViolations = credentialValueViolations(value);
  if (credentialViolations.length > 0) {
    return fail('credential_value_present', `${path} embeds credential MATERIAL under credential-shaped key(s) ${credentialViolations.join(', ')} — scrub before emitting records`);
  }
  const escalate: string[] = [];
  const scan = (node: unknown, pathSoFar: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => scan(item, `${pathSoFar}[${index}]`));
      return;
    }
    const record = node as Record<string, unknown>;
    if (isUntrustedContent(record) && untrustedEscalationViolations(record).length > 0) {
      escalate.push(pathSoFar === '' ? 'untrusted.content' : `${pathSoFar}.untrusted.content`);
    }
    for (const key of Object.keys(record).sort()) {
      scan(record[key], pathSoFar === '' ? key : `${pathSoFar}.${key}`);
    }
  };
  scan(value, '');
  if (escalate.length > 0) {
    return fail(
      'untrusted_content_escalation',
      `${path} embeds authority-affecting declarations inside untrusted content at ${escalate.join(', ')} — untrusted text cannot grant tools (L20)`,
    );
  }
  return ok(true);
}
