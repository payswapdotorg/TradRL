// @tradrl/security — the credential ENVELOPE: the secrets contract.
//
// THE LAW (the T044 Work Order: "credential ENVELOPE types (a secret is
// referenced by id+version, NEVER carried in plaintext in any record, log
// or audit line)"; spec/SECURITY.md Secrets — VERBATIM: "Never commit
// provider credentials. Inject them through secure runtime boundaries.";
// spec/ARCHITECTURE-LOCK.md L12: "customer data, memory, trajectories
// and credentials are isolated").
//
// THE MODEL: a credential is a VERSIONED ENVELOPE plus an injected VALUE.
//   - The {@link CredentialEnvelope} is the record the platform carries:
//     WHO owns it (tenant+project scope — L12), WHERE it applies (venue),
//     WHAT kind it is, a POSSESSION FINGERPRINT (a stable digest of the
//     value that proves possession without revealing it), its lifecycle
//     status, and the supersedes chain. It carries NO value — the opacity
//     trip wire runs over every guard and validator here, so an envelope
//     (or any other record) embedding credential MATERIAL is the typed
//     `credential_value_present` error.
//   - The VALUE enters ONLY at the runtime boundary
//     (services/security's SecretsVault: `depositSecretValue` /
//     `resolveCredential`) and is NEVER serialized — the vault keeps
//     values in module-private WeakMaps unreachable from any JSON walk.
//   - {@link CredentialInjectionReceipt} records the FACT of an injection
//     (which envelope version, which scope, which runtime, when) — again
//     no value. Composing runtimes log receipts, never payloads.
//
// LIFECYCLE (the T040 grant discipline, mirrored):
//   - Identity is `(envelopeId, version)`; the id is content-addressed
//     from the v1 declaration at registration and STAYS STABLE across
//     versions (T019/T040's 'cred:' refs bind envelope ids — a rotation
//     must not orphan a binding).
//   - Versions are immutable and append-only: a rotation mints the next
//     version with `supersedes` pointing at its predecessor; a revocation
//     mints a 'revoked' TOMBSTONE version (there is no un-revocation — a
//     restored credential gets a NEW envelope id; mirror of T040's
//     append-only revocation law).
//   - `credentialStatus` derives the resolution verdict from the version
//     chain WITHOUT mutating immutable records: 'active' iff the version
//     is the envelope's LATEST version AND its own status is 'active'.
//
// Determinism: content addressing is over canonical JSON (byte-identical
// for identical declarations); no ambient clock (`asOf` is injected); no
// ambient randomness.

import { deepFreeze, isDigest, isMemberOf, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, canonicalJson, fnv1a32Hex, type JsonValue, type TimestampMs } from './primitives';
import type { CredentialEnvelopeId, CredentialRef, CredentialVersionRef, ProjectId, TenantId, VenueId } from './ids';
import { isCredentialEnvelopeId, isCredentialRef, isCredentialVersionRef, isProjectId, isTenantId, isVenueId, mintCredentialEnvelopeId } from './ids';
import type { SecurityResult, SecurityError } from './errors';
import { fail, invalidField, invalidType, missingField, ok } from './errors';
import { credentialValueViolations } from './credentials';
import { scopeOf, type Scope, type ScopedRecord } from './scope';

// ---------------------------------------------------------------------------
// The fingerprint (possession without disclosure)
// ---------------------------------------------------------------------------

/** The fingerprint domain separator (the value never appears in any record — only this digest does). */
const FINGERPRINT_DOMAIN = 'tradrl.credential.v1';

/**
 * The possession fingerprint of a credential value: the FNV-1a 32-bit
 * digest of the domain-separated value. Pure and deterministic — the
 * same value always yields the same fingerprint; the fingerprint does
 * not reveal the value. Deposits are verified against the envelope's
 * fingerprint (a wrong value is the typed `secret_fingerprint_mismatch`).
 */
export function credentialFingerprint(value: string): string {
  return fnv1a32Hex(`${FINGERPRINT_DOMAIN}:${value}`);
}

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

/** The lifecycle status of ONE envelope version (immutable per version; the tombstone law below). */
export type CredentialEnvelopeStatus = 'active' | 'retired' | 'revoked';

/** Runtime-checkable list of envelope statuses. */
export const CREDENTIAL_ENVELOPE_STATUSES: readonly CredentialEnvelopeStatus[] = ['active', 'retired', 'revoked'];

/** The kind of credential (opaque to this contract — vendor specifics stay in adapters, L13/L14). */
export type CredentialKind = string;

/**
 * The credential envelope — the versioned, scoped, value-free record of a
 * secret. Referenced by id+version; NEVER carries the value (the opacity
 * trip wire enforces this over the WHOLE record).
 */
export interface CredentialEnvelope extends ScopedRecord {
  /** Content-addressed identity (stable across versions): `cred:` + digest of the v1 content. */
  readonly envelopeId: CredentialEnvelopeId;
  /** Integer >= 1; the version of THIS envelope record. Rotations are NEW versions under the same id. */
  readonly version: number;
  /** The version this one supersedes (null iff version 1 — the version chain). */
  readonly supersedes: CredentialVersionRef | null;
  /** WHERE the credential applies (null = not venue-bound, e.g. a data-vendor key). */
  readonly venue: VenueId | null;
  /** WHAT kind of credential (opaque; adapter-owned vocabulary). */
  readonly kind: CredentialKind;
  /** The possession fingerprint of the value — proves possession, never reveals (see {@link credentialFingerprint}). */
  readonly fingerprint: string;
  /** The lifecycle status of THIS version (immutable; a 'revoked' tombstone version kills the envelope). */
  readonly status: CredentialEnvelopeStatus;
  /** The declaration instant (epoch ms; injected, never a clock read). */
  readonly asOf: TimestampMs;
}

/** Guard: `CredentialEnvelope` (structural; the opacity trip wire included). */
export function isCredentialEnvelope(v: unknown): v is CredentialEnvelope {
  if (!isRecord(v)) return false;
  if (!isCredentialEnvelopeId(v.envelopeId)) return false;
  if (!isPositiveSafeInteger(v.version)) return false;
  if (v.supersedes !== null && !isCredentialVersionRef(v.supersedes)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (v.venue !== null && !isVenueId(v.venue)) return false;
  if (!isNonEmptyString(v.kind)) return false;
  if (!isDigest(v.fingerprint)) return false;
  if (!isMemberOf(CREDENTIAL_ENVELOPE_STATUSES, v.status)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  // The opacity trip wire (the guard half — a value ANYWHERE kills the record).
  if (credentialValueViolations(v).length > 0) return false;
  return true;
}

/** The envelope's canonical JSON tree (everything except the content-addressed `envelopeId`). */
export function envelopeContentTree(envelope: Omit<CredentialEnvelope, 'envelopeId'>): JsonValue {
  return {
    version: envelope.version,
    supersedes: envelope.supersedes === null ? null : { envelopeId: envelope.supersedes.envelopeId, version: envelope.supersedes.version },
    tenant: envelope.tenant,
    project: envelope.project,
    venue: envelope.venue,
    kind: envelope.kind,
    fingerprint: envelope.fingerprint,
    status: envelope.status,
    asOf: envelope.asOf,
  };
}

/** The canonical JSON of a validated envelope's content (byte-deterministic, L9). */
export function canonicalEnvelopeJson(envelope: CredentialEnvelope): string {
  return canonicalJson(envelopeContentTree(envelope));
}

/**
 * Collect-all validation of an untrusted credential envelope. Enforces:
 *   - the structural guard fields (scope, kind, fingerprint digest form,
 *     status vocabulary, injected instant);
 *   - the opacity trip wire (reported FIRST — a value anywhere is the
 *     typed `credential_value_present`);
 *   - the version-chain law (supersedes, when present, must name the
 *     immediately preceding version and the SAME envelope id);
 *   - the content-address law for version 1 (the id must match the v1
 *     content digest — a forged id is a malformed envelope).
 * On success the envelope is returned narrowed, deeply frozen.
 */
export function validateCredentialEnvelope(value: unknown, path = 'envelope'): SecurityResult<CredentialEnvelope> {
  if (!isRecord(value)) {
    return fail('invalid_type', `${path} must be an object`, path);
  }

  // THE OPACITY TRIP WIRE — first, always: a value anywhere is the typed error.
  const violations = credentialValueViolations(value);
  if (violations.length > 0) {
    return fail(
      'credential_value_present',
      `${path} embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — a secret is referenced by id+version and NEVER carried in plaintext in any record, log or audit line (spec/SECURITY.md: "Never commit provider credentials. Inject them through secure runtime boundaries.")`,
    );
  }

  const errors: SecurityError[] = [];
  if (value.envelopeId === undefined) errors.push(missingField(`${path}.envelopeId`));
  else if (!isCredentialEnvelopeId(value.envelopeId)) errors.push(invalidField(`${path}.envelopeId`, "must be an opaque 'cred:'-prefixed envelope id"));
  if (value.version === undefined) errors.push(missingField(`${path}.version`));
  else if (!isPositiveSafeInteger(value.version)) errors.push(invalidField(`${path}.version`, 'must be an integer >= 1'));
  if (value.supersedes !== null && value.supersedes !== undefined && !isCredentialVersionRef(value.supersedes)) {
    errors.push(invalidField(`${path}.supersedes`, 'must be null or { envelopeId, version } with version >= 1'));
  }
  if (value.tenant === undefined) errors.push(missingField(`${path}.tenant`));
  else if (!isTenantId(value.tenant)) errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant scope (L12)'));
  if (value.project === undefined) errors.push(missingField(`${path}.project`));
  else if (!isProjectId(value.project)) errors.push(invalidField(`${path}.project`, 'must be a non-empty project scope (L12/L15)'));
  if (value.venue !== null && value.venue !== undefined && !isVenueId(value.venue)) {
    errors.push(invalidField(`${path}.venue`, 'must be null or a non-empty venue ref'));
  }
  if (value.kind === undefined) errors.push(missingField(`${path}.kind`));
  else if (!isNonEmptyString(value.kind)) errors.push(invalidField(`${path}.kind`, 'must be a non-empty credential kind (adapter-owned vocabulary)'));
  if (value.fingerprint === undefined) errors.push(missingField(`${path}.fingerprint`));
  else if (!isDigest(value.fingerprint)) errors.push(invalidField(`${path}.fingerprint`, 'must be a lowercase 8-hex possession fingerprint (see credentialFingerprint)'));
  if (value.status === undefined) errors.push(missingField(`${path}.status`));
  else if (!isMemberOf(CREDENTIAL_ENVELOPE_STATUSES, value.status)) {
    errors.push(invalidField(`${path}.status`, `must be one of ${CREDENTIAL_ENVELOPE_STATUSES.join(' | ')}`));
  }
  if (value.asOf === undefined) errors.push(missingField(`${path}.asOf`));
  else if (!isTimestampMs(value.asOf)) errors.push(invalidField(`${path}.asOf`, 'must be an epoch-ms instant (no ambient clock)'));
  if (errors.length > 0) return { ok: false, errors: Object.freeze(errors) };

  const envelope = value as unknown as CredentialEnvelope;

  // The version-chain law: supersedes must name the immediately preceding
  // version of the SAME envelope.
  if (envelope.supersedes !== null) {
    if (envelope.supersedes.envelopeId !== envelope.envelopeId) {
      return fail('invalid_field', `${path}.supersedes.envelopeId must equal ${path}.envelopeId (the version chain stays under one id)`, `${path}.supersedes.envelopeId`);
    }
    if (envelope.supersedes.version !== envelope.version - 1) {
      return fail('invalid_field', `${path}.supersedes.version must be exactly ${envelope.version - 1} (versions are contiguous)`, `${path}.supersedes.version`);
    }
  } else if (envelope.version !== 1) {
    return fail('invalid_field', `${path}.supersedes must be non-null when version > 1 (the version chain is contiguous)`, `${path}.supersedes`);
  }

  // The content-address law (version 1 only — the id anchors the chain).
  if (envelope.version === 1) {
    const expectedId = mintCredentialEnvelopeId(fnv1a32Hex(canonicalJson(envelopeContentTree(envelope))));
    if (envelope.envelopeId !== expectedId) {
      return fail('invalid_field', `${path}.envelopeId does not match the v1 content (expected ${expectedId}) — the id is content-addressed, a mismatch is a forged id`, `${path}.envelopeId`);
    }
  }
  return ok(deepFreeze(envelope));
}

/**
 * Mint a NEW credential envelope (version 1) from untrusted declaration
 * content: the envelopeId is content-addressed from the canonical content
 * (the caller does not supply it). Pure and deterministic — the same
 * declared content always yields the byte-identical envelope (L9).
 */
export function mintCredentialEnvelope(
  declaration: Omit<CredentialEnvelope, 'envelopeId' | 'version' | 'supersedes'>,
): SecurityResult<CredentialEnvelope> {
  const violations = credentialValueViolations(declaration);
  if (violations.length > 0) {
    return fail(
      'credential_value_present',
      `the envelope declaration embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — this lane carries id+version references only, never values`,
    );
  }
  const version1: Omit<CredentialEnvelope, 'envelopeId'> = { ...declaration, version: 1, supersedes: null };
  const envelopeId = mintCredentialEnvelopeId(fnv1a32Hex(canonicalJson(envelopeContentTree(version1))));
  return validateCredentialEnvelope({ ...version1, envelopeId });
}

/**
 * Mint the NEXT version of an existing envelope (rotation or revocation
 * tombstone). The id STAYS STABLE (T019/T040's 'cred:' refs keep binding);
 * `supersedes` carries the chain. Deterministic given (predecessor, next
 * status, asOf).
 */
export function reviseCredentialEnvelope(
  predecessor: CredentialEnvelope,
  next: { readonly status: CredentialEnvelopeStatus; readonly asOf: TimestampMs; readonly fingerprint?: string },
): SecurityResult<CredentialEnvelope> {
  if (!isCredentialEnvelope(predecessor)) {
    return fail('invalid_type', 'reviseCredentialEnvelope requires a valid predecessor envelope');
  }
  const revision: Omit<CredentialEnvelope, 'envelopeId'> = {
    version: predecessor.version + 1,
    supersedes: { envelopeId: predecessor.envelopeId, version: predecessor.version },
    tenant: predecessor.tenant,
    project: predecessor.project,
    venue: predecessor.venue,
    kind: predecessor.kind,
    fingerprint: next.fingerprint ?? predecessor.fingerprint,
    status: next.status,
    asOf: next.asOf,
  };
  return validateCredentialEnvelope({ ...revision, envelopeId: predecessor.envelopeId });
}

// ---------------------------------------------------------------------------
// The resolution verdict (derived, never mutated)
// ---------------------------------------------------------------------------

/** The resolution verdict of one envelope version against a chain's latest version. */
export type CredentialResolutionVerdict =
  | { readonly kind: 'active'; readonly envelopeId: CredentialEnvelopeId; readonly version: number }
  | { readonly kind: 'retired'; readonly envelopeId: CredentialEnvelopeId; readonly version: number; readonly latestVersion: number }
  | { readonly kind: 'revoked'; readonly envelopeId: CredentialEnvelopeId; readonly version: number; readonly revokedAt: TimestampMs };

/**
 * Derive the resolution verdict of `candidate` given the envelope's
 * `latest` version record — WITHOUT mutating anything (immutable records;
 * derived state):
 *   - 'active'  iff candidate IS the latest version and its status is 'active';
 *   - 'retired' iff a NEWER version exists (rotation superseded it) or the
 *     version's own status is 'retired';
 *   - 'revoked' iff the version's (or the chain's latest) status is
 *     'revoked' — the tombstone law: there is no un-revocation.
 * PURE and TOTAL.
 */
export function credentialStatus(candidate: CredentialEnvelope, latest: CredentialEnvelope): CredentialResolutionVerdict {
  if (candidate.status === 'revoked' || latest.status === 'revoked') {
    return { kind: 'revoked', envelopeId: candidate.envelopeId, version: candidate.version, revokedAt: latest.asOf };
  }
  if (candidate.version < latest.version || candidate.status === 'retired') {
    return { kind: 'retired', envelopeId: candidate.envelopeId, version: candidate.version, latestVersion: latest.version };
  }
  return { kind: 'active', envelopeId: candidate.envelopeId, version: candidate.version };
}

// ---------------------------------------------------------------------------
// The injection receipt (the runtime-boundary fact — no value)
// ---------------------------------------------------------------------------

/** The runtime a credential was injected into (opaque ref — e.g. an 'ep-'-prefixed episode id or a service label). */
export type CredentialRuntimeRef = string;

/**
 * The receipt that a credential WAS injected at a runtime boundary: which
 * envelope version, whose scope, which runtime, when, by whom. Carries NO
 * value (the opacity trip wire enforces it) — the receipt is the auditable
 * fact, the value stays behind the boundary.
 */
export interface CredentialInjectionReceipt extends ScopedRecord {
  /** The injected envelope version. */
  readonly envelope: CredentialVersionRef;
  /** The runtime the value was injected into (opaque ref). */
  readonly runtime: CredentialRuntimeRef;
  /** The injection instant (epoch ms; injected, never a clock read). */
  readonly injectedAt: TimestampMs;
  /** The injecting principal (the operator/service identity that authorized the boundary crossing). */
  readonly injectedBy: string;
}

/** Guard: `CredentialInjectionReceipt` (the opacity trip wire included). */
export function isCredentialInjectionReceipt(v: unknown): v is CredentialInjectionReceipt {
  if (!isRecord(v)) return false;
  if (!isCredentialVersionRef(v.envelope)) return false;
  if (!isNonEmptyString(v.runtime)) return false;
  if (!isTimestampMs(v.injectedAt)) return false;
  if (!isNonEmptyString(v.injectedBy)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (credentialValueViolations(v).length > 0) return false;
  return true;
}

/** Validate an untrusted injection receipt; on success narrowed and deeply frozen. */
export function validateCredentialInjectionReceipt(value: unknown, path = 'receipt'): SecurityResult<CredentialInjectionReceipt> {
  const violations = credentialValueViolations(value);
  if (violations.length > 0) {
    return fail(
      'credential_value_present',
      `${path} embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — receipts record the FACT of injection, never the payload`,
    );
  }
  if (!isRecord(value)) return fail('invalid_type', `${path} must be an object`, path);
  const errors: SecurityError[] = [];
  if (value.envelope === undefined) errors.push(missingField(`${path}.envelope`));
  else if (!isCredentialVersionRef(value.envelope)) errors.push(invalidField(`${path}.envelope`, 'must be { envelopeId, version }'));
  if (value.runtime === undefined) errors.push(missingField(`${path}.runtime`));
  else if (!isNonEmptyString(value.runtime)) errors.push(invalidField(`${path}.runtime`, 'must be a non-empty runtime ref'));
  if (value.injectedAt === undefined) errors.push(missingField(`${path}.injectedAt`));
  else if (!isTimestampMs(value.injectedAt)) errors.push(invalidField(`${path}.injectedAt`, 'must be an epoch-ms instant'));
  if (value.injectedBy === undefined) errors.push(missingField(`${path}.injectedBy`));
  else if (!isNonEmptyString(value.injectedBy)) errors.push(invalidField(`${path}.injectedBy`, 'must be a non-empty principal ref'));
  if (value.tenant === undefined) errors.push(missingField(`${path}.tenant`));
  else if (!isTenantId(value.tenant)) errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant scope (L12)'));
  if (value.project === undefined) errors.push(missingField(`${path}.project`));
  else if (!isProjectId(value.project)) errors.push(invalidField(`${path}.project`, 'must be a non-empty project scope (L12/L15)'));
  if (errors.length > 0) return { ok: false, errors: Object.freeze(errors) };
  return ok(deepFreeze(value as unknown as CredentialInjectionReceipt));
}

/** Mint an injection receipt (validated; the caller supplies every field — there is no ambient clock). */
export function credentialInjectionReceipt(receipt: CredentialInjectionReceipt): SecurityResult<CredentialInjectionReceipt> {
  return validateCredentialInjectionReceipt(receipt);
}

/** The scope of a receipt (the L12 projection). */
export function receiptScope(receipt: CredentialInjectionReceipt): Scope {
  return scopeOf(receipt);
}

/** Interpret an opaque 'cred:'-prefixed CredentialRef as an envelope id (the T019/T040 join — prefix laws are identical). */
export function envelopeIdOfRef(ref: CredentialRef): CredentialEnvelopeId {
  if (!isCredentialRef(ref)) throw new Error(`envelopeIdOfRef: invalid credential ref ${JSON.stringify(ref)}`);
  return ref as unknown as CredentialEnvelopeId;
}
