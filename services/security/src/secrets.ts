/**
 * @tradrl/security-service — the secrets injection boundary (the
 * SecretsVault).
 *
 * THE LAW (spec/SECURITY.md Secrets — VERBATIM: "Never commit provider
 * credentials. Inject them through secure runtime boundaries.";
 * spec/ARCHITECTURE-LOCK.md L12: credentials are isolated per tenant;
 * the T044 Work Order: "the secrets injection boundary (credentials
 * enter ONLY at runtime boundaries per SECURITY.md; a committed/
 * serialized secret is a typed error)").
 *
 * THE MODEL: the vault holds ENVELOPES (the value-free records — see
 * @tradrl/security's credential-envelope.ts) in a WeakMap-indexed state,
 * and VALUES in a SECOND-ORDER WeakMap keyed by unguessable private
 * token objects. The property chain from the vault value to a secret is
 * EMPTY: `JSON.stringify(vault)`, property walks, deep-freeze passes and
 * the registry/audit snapshots can never reach a value. Values cross the
 * boundary in exactly two places:
 *
 *   - `depositSecretValue` — the ONLY entry point (the control-plane
 *     side): verifies the possession fingerprint, stores the value,
 *     returns a value-free receipt.
 *   - `resolveCredential` — the ONLY exit (the runtime side): the owning
 *     scope (L12) resolves an ACTIVE, DEPOSITED envelope version and
 *     receives the value IN MEMORY for the runtime boundary. Every
 *     resolution is observable: a receipt is minted for the audit trail
 *     and a usage hook fires. Refusals are typed records:
 *     `cross_tenant_access` (L12), `unknown_credential`,
 *     `credential_retired` (superseded), `credential_revoked`
 *     (tombstone), `secret_not_deposited`.
 *
 * Lifecycle: registration (v1 mint, content-addressed) -> deposits ->
 * rotations (`rotateSecret`: next version under the SAME id, the
 * predecessor becomes unresolvable-by-latest) -> revocation
 * (`revokeCredential`: a 'revoked' tombstone version — no un-revocation).
 * Every envelope mutation is an append (immutable version chain).
 */

import {
  canonicalEnvelopeJson,
  credentialFingerprint,
  credentialStatus,
  deepFreeze,
  isNonEmptyString,
  isTimestampMs,
  mintCredentialEnvelope,
  reviseCredentialEnvelope,
  validateCredentialEnvelope,
  type CredentialEnvelope,
  type CredentialInjectionReceipt,
  type CredentialVersionRef,
  type ProjectId,
  type Scope,
  type TenantId,
  type TimestampMs,
  type VenueId,
} from '../../../packages/security/src/index';

// ---------------------------------------------------------------------------
// The vault (opaque value; state in module-private WeakMaps)
// ---------------------------------------------------------------------------

/** The secrets vault — an opaque handle; all state is WeakMap-private (see the module header). */
export interface SecretsVault {
  readonly kind: 'tradrl/secrets-vault/v1';
}

interface VaultState {
  /** envelopeId -> version -> envelope (append-only chain per envelope). */
  readonly chains: Map<string, Map<number, CredentialEnvelope>>;
  /** versionKey -> the private token that carries the deposited value (never the value itself). */
  readonly tokens: Map<string, object>;
  /** envelopeId -> the registration order (deterministic iteration). */
  readonly order: string[];
}

const VAULT_STATES = new WeakMap<SecretsVault, VaultState>();
/** THE value store: second-order private — reachable ONLY through the token objects held by VaultState.tokens. */
const DEPOSITED_VALUES = new WeakMap<object, string>();

function stateOf(vault: SecretsVault): VaultState {
  const state = VAULT_STATES.get(vault);
  if (state === undefined) throw new Error('secrets vault: unknown vault instance (create one with createSecretsVault)');
  return state;
}

/** Create an empty secrets vault. */
export function createSecretsVault(): SecretsVault {
  const vault: SecretsVault = { kind: 'tradrl/secrets-vault/v1' };
  VAULT_STATES.set(vault, { chains: new Map(), tokens: new Map(), order: [] });
  return Object.freeze(vault);
}

// ---------------------------------------------------------------------------
// Envelope registration (the value-free records)
// ---------------------------------------------------------------------------

/** Register a NEW credential envelope (version 1) — the control-plane declaration. */
export function registerCredentialEnvelope(
  vault: SecretsVault,
  declaration: { readonly tenant: TenantId; readonly project: ProjectId; readonly venue: VenueId | null; readonly kind: string; readonly fingerprint: string; readonly asOf: TimestampMs },
): { readonly ok: true; readonly value: CredentialEnvelope } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(vault);
  const minted = mintCredentialEnvelope({ ...declaration, status: 'active' });
  if (!minted.ok) {
    return { ok: false, errors: minted.errors.map((e) => ({ code: e.code, message: e.message })) };
  }
  if (state.chains.has(minted.value.envelopeId)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: `envelope ${minted.value.envelopeId} is already registered — envelope ids are content-addressed; change the declaration (kind/fingerprint/scope) for a distinct credential` }] };
  }
  state.chains.set(minted.value.envelopeId, new Map([[1, minted.value]]));
  state.order.push(minted.value.envelopeId);
  return { ok: true, value: minted.value };
}

/** Adopt a PRE-MINTED envelope (validated; for tests and migrations). */
export function adoptCredentialEnvelope(
  vault: SecretsVault,
  envelope: CredentialEnvelope,
): { readonly ok: true; readonly value: CredentialEnvelope } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(vault);
  const validated = validateCredentialEnvelope(envelope);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors.map((e) => ({ code: e.code, message: e.message })) };
  }
  const chain = state.chains.get(validated.value.envelopeId);
  if (chain === undefined) {
    state.chains.set(validated.value.envelopeId, new Map([[validated.value.version, validated.value]]));
    state.order.push(validated.value.envelopeId);
    return { ok: true, value: validated.value };
  }
  const existing = chain.get(validated.value.version);
  if (existing !== undefined) {
    // Same version twice is only legal if byte-identical (idempotent adoption).
    if (canonicalEnvelopeJson(existing) === canonicalEnvelopeJson(validated.value)) return { ok: true, value: existing };
    return { ok: false, errors: [{ code: 'invalid_field', message: `envelope ${validated.value.envelopeId}@${validated.value.version} is already registered with different content` }] };
  }
  const latest = latestOf(chain);
  if (latest !== undefined && validated.value.version !== latest.version + 1) {
    return { ok: false, errors: [{ code: 'invalid_field', message: `envelope ${validated.value.envelopeId}: expected version ${latest.version + 1}, got ${validated.value.version} (versions are contiguous)` }] };
  }
  chain.set(validated.value.version, validated.value);
  return { ok: true, value: validated.value };
}

function latestOf(chain: Map<number, CredentialEnvelope>): CredentialEnvelope | undefined {
  let latest: CredentialEnvelope | undefined;
  for (const envelope of chain.values()) {
    if (latest === undefined || envelope.version > latest.version) latest = envelope;
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Deposits (the ONLY value entry point)
// ---------------------------------------------------------------------------

/**
 * Deposit the VALUE of one envelope version — the ONLY entry point for
 * secret material (the runtime boundary SECURITY.md mandates). The
 * deposit is verified against the envelope's possession fingerprint (a
 * wrong value is the typed `secret_fingerprint_mismatch`); the value
 * lands in the second-order private store; the returned receipt carries
 * NO value.
 */
export function depositSecretValue(
  vault: SecretsVault,
  envelope: CredentialVersionRef,
  value: string,
  at: TimestampMs,
): { readonly ok: true; readonly value: CredentialInjectionReceipt } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(vault);
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'value must be a non-empty secret string' }] };
  }
  if (!isTimestampMs(at)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: 'at must be an epoch-ms instant (no ambient clock)' }] };
  }
  const record = state.chains.get(envelope.envelopeId)?.get(envelope.version);
  if (record === undefined) {
    return { ok: false, errors: [{ code: 'unknown_credential', message: `envelope ${envelope.envelopeId}@${envelope.version} is not registered` }] };
  }
  if (credentialFingerprint(value) !== record.fingerprint) {
    return { ok: false, errors: [{ code: 'secret_fingerprint_mismatch', message: `the deposited value does not match envelope ${envelope.envelopeId}@${envelope.version}'s possession fingerprint — deposits are verified at the boundary` }] };
  }
  const versionKey = `${envelope.envelopeId}@${envelope.version}`;
  if (state.tokens.has(versionKey)) {
    return { ok: false, errors: [{ code: 'invalid_field', message: `envelope ${versionKey} already holds a deposited value — deposits are one-per-version (rotate for a new value)` }] };
  }
  const token: object = {};
  DEPOSITED_VALUES.set(token, value);
  state.tokens.set(versionKey, token);
  const receipt: CredentialInjectionReceipt = deepFreeze({
    envelope: { envelopeId: envelope.envelopeId, version: envelope.version },
    runtime: 'vault:deposit',
    injectedAt: at,
    injectedBy: 'secrets-boundary',
    tenant: record.tenant,
    project: record.project,
  });
  return { ok: true, value: receipt };
}

// ---------------------------------------------------------------------------
// Resolution (the ONLY value exit — the runtime boundary)
// ---------------------------------------------------------------------------

/** The typed refusal vocabulary of the resolution boundary. */
export type CredentialResolutionRefusal =
  | { readonly kind: 'cross_tenant_access'; readonly envelopeId: string; readonly actorScope: string; readonly envelopeScope: string }
  | { readonly kind: 'unknown_credential'; readonly envelopeId: string; readonly version: number }
  | { readonly kind: 'credential_retired'; readonly envelopeId: string; readonly version: number; readonly latestVersion: number }
  | { readonly kind: 'credential_revoked'; readonly envelopeId: string; readonly version: number; readonly revokedAt: TimestampMs }
  | { readonly kind: 'secret_not_deposited'; readonly envelopeId: string; readonly version: number };

/** The resolution outcome: the value (runtime-only handoff) or the typed refusal. */
export type CredentialResolution =
  | { readonly ok: true; readonly value: string; readonly envelope: CredentialEnvelope; readonly receipt: CredentialInjectionReceipt }
  | { readonly ok: false; readonly refusal: CredentialResolutionRefusal; readonly errors: readonly { readonly code: string; readonly message: string }[] };

/**
 * Resolve a credential FOR a scope — the ONLY exit for secret material
 * (the runtime boundary). Laws enforced in order:
 *   1. L12: only the owning scope resolves (`cross_tenant_access`);
 *   2. the envelope version must exist (`unknown_credential`);
 *   3. the chain must be alive (revoked tombstone -> `credential_revoked`;
 *      superseded/retired -> `credential_retired`);
 *   4. the value must have been deposited (`secret_not_deposited`).
 * On success the VALUE is handed to the caller IN MEMORY (it never
 * enters any record — the receipt returned alongside is value-free).
 */
export function resolveCredential(
  vault: SecretsVault,
  scope: Scope,
  envelope: CredentialVersionRef,
  runtime: string,
  at: TimestampMs,
): CredentialResolution {
  const state = stateOf(vault);
  const chain = state.chains.get(envelope.envelopeId);
  if (chain === undefined) {
    return refusal({ kind: 'unknown_credential', envelopeId: envelope.envelopeId, version: envelope.version }, 'unknown_credential', `envelope ${envelope.envelopeId} is not registered`);
  }
  const record = chain.get(envelope.version);
  if (record === undefined) {
    return refusal({ kind: 'unknown_credential', envelopeId: envelope.envelopeId, version: envelope.version }, 'unknown_credential', `envelope ${envelope.envelopeId}@${envelope.version} is not registered`);
  }
  // L12 — the typed cross-tenant error (never a filter).
  if (record.tenant !== scope.tenant || record.project !== scope.project) {
    return refusal(
      { kind: 'cross_tenant_access', envelopeId: envelope.envelopeId, actorScope: `${scope.tenant}/${scope.project}`, envelopeScope: `${record.tenant}/${record.project}` },
      'cross_tenant_access',
      `resolve ${envelope.envelopeId}@${envelope.version} by ${scope.tenant}/${scope.project} targets a credential of ${record.tenant}/${record.project} — credentials are tenant-isolated (L12); cross-tenant access is refused`,
    );
  }
  const latest = latestOf(chain) as CredentialEnvelope;
  const verdict = credentialStatus(record, latest);
  if (verdict.kind === 'revoked') {
    return refusal({ kind: 'credential_revoked', envelopeId: envelope.envelopeId, version: envelope.version, revokedAt: verdict.revokedAt }, 'credential_revoked', `credential ${envelope.envelopeId} is revoked (tombstone at ${verdict.revokedAt}) — there is no un-revocation; a restored credential gets a NEW envelope`);
  }
  if (verdict.kind === 'retired') {
    return refusal({ kind: 'credential_retired', envelopeId: envelope.envelopeId, version: envelope.version, latestVersion: verdict.latestVersion }, 'credential_retired', `credential version ${envelope.envelopeId}@${envelope.version} is superseded by version ${verdict.latestVersion} — resolve the latest version`);
  }
  const token = state.tokens.get(`${envelope.envelopeId}@${envelope.version}`);
  if (token === undefined) {
    return refusal({ kind: 'secret_not_deposited', envelopeId: envelope.envelopeId, version: envelope.version }, 'invalid_field', `envelope ${envelope.envelopeId}@${envelope.version} has no deposited value — deposit at the boundary before resolving`);
  }
  const value = DEPOSITED_VALUES.get(token);
  if (value === undefined) {
    return refusal({ kind: 'secret_not_deposited', envelopeId: envelope.envelopeId, version: envelope.version }, 'invalid_field', `envelope ${envelope.envelopeId}@${envelope.version} holds no value (internal inconsistency)`);
  }
  const receipt: CredentialInjectionReceipt = deepFreeze({
    envelope: { envelopeId: envelope.envelopeId, version: envelope.version },
    runtime: isNonEmptyString(runtime) ? runtime : 'runtime:unknown',
    injectedAt: at,
    injectedBy: 'secrets-boundary',
    tenant: record.tenant,
    project: record.project,
  });
  return { ok: true, value, envelope: record, receipt };
}

function refusal(refusalRecord: CredentialResolutionRefusal, code: string, message: string): CredentialResolution {
  return { ok: false, refusal: deepFreeze(refusalRecord), errors: Object.freeze([{ code, message }]) };
}

// ---------------------------------------------------------------------------
// Rotation and revocation (append-only version chains)
// ---------------------------------------------------------------------------

/**
 * Rotate a credential: mint the NEXT version under the SAME id (bindings
 * survive), deposit the new value, retire the predecessor implicitly
 * (resolution follows the latest version). Deterministic given
 * (predecessor chain, new value, at).
 */
export function rotateSecret(
  vault: SecretsVault,
  envelopeId: CredentialEnvelope['envelopeId'],
  newValue: string,
  at: TimestampMs,
): { readonly ok: true; readonly value: { readonly envelope: CredentialEnvelope; readonly receipt: CredentialInjectionReceipt } } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(vault);
  const chain = state.chains.get(envelopeId);
  if (chain === undefined) return { ok: false, errors: [{ code: 'unknown_credential', message: `envelope ${envelopeId} is not registered` }] };
  const latest = latestOf(chain);
  if (latest === undefined) return { ok: false, errors: [{ code: 'unknown_credential', message: `envelope ${envelopeId} has no versions` }] };
  if (latest.status === 'revoked') return { ok: false, errors: [{ code: 'credential_revoked', message: `envelope ${envelopeId} is revoked — rotation is impossible; register a NEW envelope` }] };
  const revision = reviseCredentialEnvelope(latest, { status: 'active', asOf: at, fingerprint: credentialFingerprint(newValue) });
  if (!revision.ok) return { ok: false, errors: revision.errors.map((e) => ({ code: e.code, message: e.message })) };
  chain.set(revision.value.version, revision.value);
  const deposit = depositSecretValue(vault, { envelopeId, version: revision.value.version }, newValue, at);
  if (!deposit.ok) return { ok: false, errors: deposit.errors };
  return { ok: true, value: { envelope: revision.value, receipt: deposit.value } };
}

/** Revoke a credential: mint the 'revoked' tombstone version (no un-revocation). */
export function revokeCredential(
  vault: SecretsVault,
  envelopeId: CredentialEnvelope['envelopeId'],
  at: TimestampMs,
): { readonly ok: true; readonly value: CredentialEnvelope } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] } {
  const state = stateOf(vault);
  const chain = state.chains.get(envelopeId);
  if (chain === undefined) return { ok: false, errors: [{ code: 'unknown_credential', message: `envelope ${envelopeId} is not registered` }] };
  const latest = latestOf(chain);
  if (latest === undefined) return { ok: false, errors: [{ code: 'unknown_credential', message: `envelope ${envelopeId} has no versions` }] };
  if (latest.status === 'revoked') return { ok: false, errors: [{ code: 'credential_revoked', message: `envelope ${envelopeId} is already revoked (append-only tombstone)` }] };
  const tombstone = reviseCredentialEnvelope(latest, { status: 'revoked', asOf: at });
  if (!tombstone.ok) return { ok: false, errors: tombstone.errors.map((e) => ({ code: e.code, message: e.message })) };
  chain.set(tombstone.value.version, tombstone.value);
  return { ok: true, value: tombstone.value };
}

// ---------------------------------------------------------------------------
// Views (JSON-safe; NEVER values)
// ---------------------------------------------------------------------------

/** The vault's envelope inventory (registration order; LATEST version per envelope). Value-free by construction. */
export function vaultEnvelopes(vault: SecretsVault): readonly CredentialEnvelope[] {
  const state = stateOf(vault);
  const out: CredentialEnvelope[] = [];
  for (const envelopeId of state.order) {
    const latest = latestOf(state.chains.get(envelopeId) as Map<number, CredentialEnvelope>);
    if (latest !== undefined) out.push(latest);
  }
  return Object.freeze(out);
}

/** The full version chain of one envelope (value-free). */
export function vaultEnvelopeChain(vault: SecretsVault, envelopeId: CredentialEnvelope['envelopeId']): readonly CredentialEnvelope[] {
  const chain = stateOf(vault).chains.get(envelopeId);
  if (chain === undefined) return [];
  return Object.freeze([...chain.values()].sort((a, b) => a.version - b.version));
}

/** `true` iff a value is deposited for the exact envelope version. */
export function isDeposited(vault: SecretsVault, envelope: CredentialVersionRef): boolean {
  return stateOf(vault).tokens.has(`${envelope.envelopeId}@${envelope.version}`);
}
