// @tradrl/entitlements — the ENTITLEMENT LEDGER: the append-only,
// chain-verified state machine that records what a tenant was granted,
// what it consumed, and when (Work Order T047).
//
// THE LAWS THIS MODULE SERVES:
// - L12 (tenant isolation): the ledger is scoped to ONE tenant at
//   creation; every record entering it must carry that tenant — a
//   foreign record is the typed `cross_tenant_access` refusal at the
//   gate (nothing foreign is ever stored, so nothing foreign can leak).
// - The chain law (L9/L11): every operation APPENDS one log entry
//   (seq, kind, recordId, recordDigest, at, priorHead, head) — the
//   entries are linked by their digests, and
//   `verifyEntitlementChain` recomputes the whole chain plus every
//   record digest; a tampered log entry, a rewritten record, or a
//   hidden operation is the typed `chain_mismatch`. History is
//   retained — EXHAUSTED and EXPIRED grants included (the accounting
//   truth of what was allowed and when).
// - The idempotence law: every minted record is CONTENT-ADDRESSED, so
//   replaying an identical draft returns the EXISTING record
//   (`replayed: true`, no new log entry) — a retry after a timeout can
//   never double-charge.
// - The exhaustion law: the sum of a chain's consumption records never
//   exceeds the chain's CURRENT version's amount (exact decimal
//   arithmetic; a charge that would cross the line is the typed
//   `entitlement_exhausted` — L20: enforcement is code).
// - The lifecycle law: a grant chain is issued (version 1) -> amended
//   (version + 1, supersede-chained) -> revoked (terminal); a revoked
//   chain never amends (`invalid_transition`); revocation is a LEDGER
//   EVENT, never a record mutation (L3).
// - L4 (point-in-time): `entitlementSnapshot` answers "what was this
//   tenant allowed at instant T" from retained history alone — the
//   version current at T, the window status at T, the revocation state
//   at T, the consumption accumulated by T.
// - Determinism: no ambient clock, no ambient randomness — every id and
//   every chain head is a pure function of the operation content; the
//   same op sequence mints byte-identical serializations.

import { canonicalJson, deepCloneJson, deepFreeze, isNonEmptyString, isPositiveDecimal, isRecord, isTimestampMs, signedAdd, signedCompare, stableDigestJson, unsignedSubtract } from './primitives';
import type { JsonValue, TimestampMs } from './primitives';
import type { EntitlementError, EntitlementResult } from './errors';
import { fail, invalidField, invalidType, missingField, ok } from './errors';
import type { ConsumptionRecordId, EntitlementGrantId, EntitlementRevocationId, ProjectId, TenantId } from './ids';
import { isEntitlementGrantId, isProjectId, isTenantId } from './ids';
import { deriveConsumptionRecordId, deriveEntitlementRevocationId } from './ids';
import type { EntitlementGrant, GrantWindowStatus } from './entitlement';
import { grantWindowStatus, validateEntitlementGrant } from './entitlement';
import type { QuotaGrantView } from './usage';

// ---------------------------------------------------------------------------
// The consumption cause vocabulary (who may draw a spend allowance)
// ---------------------------------------------------------------------------

/**
 * The closed consumption-cause vocabulary — the typed reasons a spend
 * allowance is drawn down. Today exactly one lane consumes spend:
 * the marketplace's verified-engagement settlement (T047's service
 * half). A second member would be a new consuming lane, an
 * architecture change — not a data point.
 */
export const CONSUMPTION_CAUSES = ['marketplace-charge'] as const;

/** One consumption cause. */
export type ConsumptionCause = (typeof CONSUMPTION_CAUSES)[number];

/** Guard: `ConsumptionCause`. */
export function isConsumptionCause(v: unknown): v is ConsumptionCause {
  return v === 'marketplace-charge';
}

// ---------------------------------------------------------------------------
// The append-only log (the chain)
// ---------------------------------------------------------------------------

/** The log-entry kinds — one per ledger operation. */
export const ENTITLEMENT_LOG_KINDS = [
  'grant-issued',
  'grant-amended',
  'grant-revoked',
  'consumed',
] as const;

/** One log-entry kind. */
export type EntitlementLogKind = (typeof ENTITLEMENT_LOG_KINDS)[number];

/** The chain's zero state (the linked list's genesis head). */
export const GENESIS_CHAIN_HEAD = 'elog:0000000000000000';

/**
 * ONE append-only log entry: the operation kind, the record it minted
 * (id + digest), the operation's explicit instant, and the chain link
 * (`priorHead` -> `head`, where `head` is the stable digest of the
 * entry's own content minus `head`). Tamper-evident: rewriting any
 * entry breaks every later head; rewriting a RECORD breaks its entry's
 * digest match.
 */
export interface EntitlementLogEntry {
  readonly seq: number;
  readonly kind: EntitlementLogKind;
  readonly recordId: string;
  readonly recordDigest: string;
  readonly at: number;
  readonly priorHead: string;
  readonly head: string;
}

// ---------------------------------------------------------------------------
// The consumption record (the draw-down)
// ---------------------------------------------------------------------------

/**
 * ONE draw-down on a spend-allowance chain: the exact decimal amount,
 * the currency, the commercial cause, the lineage refs (the
 * marketplace records this charge settles), and the explicit instant.
 * Content-addressed (`cns:` ids); immutable; append-only.
 */
export interface ConsumptionRecord {
  /** Consumption identity (`cns:<digest>` — content-addressed over the full content). */
  readonly consumptionId: ConsumptionRecordId;
  /** The grant VERSION drawn (the chain's current version at consumption time). */
  readonly grantId: EntitlementGrantId;
  /** The drawn chain's root (version 1's id — the accounting key). */
  readonly rootId: EntitlementGrantId;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** The consumption's project scope (the commercial record's project — L12). */
  readonly projectId: ProjectId;
  /** The charge's currency (must equal the grant's). */
  readonly currency: string;
  /** The drawn amount (POSITIVE canonical decimal — a zero charge is not a consumption). */
  readonly amount: string;
  /** The typed cause (the closed vocabulary). */
  readonly cause: ConsumptionCause;
  /** Opaque refs to the commercial records this consumption settles (L9 lineage). */
  readonly refs: readonly string[];
  /** Explicit consumption instant (epoch ms — never a wall clock). */
  readonly at: TimestampMs;
}

/** Guard: `ConsumptionRecord`. */
export function isConsumptionRecord(v: unknown): v is ConsumptionRecord {
  if (!isRecord(v)) return false;
  if (typeof v.consumptionId !== 'string' || !/^cns:[0-9a-f]{16}$/.test(v.consumptionId)) return false;
  if (!isEntitlementGrantId(v.grantId)) return false;
  if (!isEntitlementGrantId(v.rootId)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (typeof v.currency !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(v.currency)) return false;
  if (!isPositiveDecimal(v.amount)) return false;
  if (!isConsumptionCause(v.cause)) return false;
  if (!Array.isArray(v.refs) || !v.refs.every(isNonEmptyString)) return false;
  if (!isTimestampMs(v.at)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The revocation record (the terminal ledger event)
// ---------------------------------------------------------------------------

/**
 * ONE grant-chain revocation: the terminal ledger event. The grant
 * records are NEVER mutated (L3) — revocation is a retained, pinned
 * record the point-in-time snapshot folds over.
 */
export interface GrantRevocation {
  /** Revocation identity (`rev:<digest>` — content-addressed). */
  readonly revocationId: EntitlementRevocationId;
  /** The revoked grant VERSION (the chain's current version at revocation time). */
  readonly grantId: EntitlementGrantId;
  /** The revoked chain's root. */
  readonly rootId: EntitlementGrantId;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Explicit revocation instant (epoch ms — never a wall clock). */
  readonly revokedAt: TimestampMs;
}

/** Guard: `GrantRevocation`. */
export function isGrantRevocation(v: unknown): v is GrantRevocation {
  if (!isRecord(v)) return false;
  if (typeof v.revocationId !== 'string' || !/^rev:[0-9a-f]{16}$/.test(v.revocationId)) return false;
  if (!isEntitlementGrantId(v.grantId)) return false;
  if (!isEntitlementGrantId(v.rootId)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isTimestampMs(v.revokedAt)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The ledger state (immutable; one tenant; append-only histories)
// ---------------------------------------------------------------------------

/**
 * The entitlement ledger for ONE tenant: every grant version ever
 * minted (by id), each chain's version history (append order) and
 * current version, the terminal revocations, every consumption record,
 * and the chain-verified log of every operation.
 */
export interface EntitlementLedgerState {
  /** The ledger's ONE tenant (L12 — the gate every record must pass). */
  readonly tenantId: TenantId;
  /** EVERY grant version, by its content-addressed id. */
  readonly grants: ReadonlyMap<EntitlementGrantId, EntitlementGrant>;
  /** Each chain's version history, root id -> versions in amendment order. */
  readonly history: ReadonlyMap<EntitlementGrantId, readonly EntitlementGrant[]>;
  /** Each chain's CURRENT version, root id -> current. */
  readonly current: ReadonlyMap<EntitlementGrantId, EntitlementGrant>;
  /** Version id -> chain root id (lookup of any version's chain). */
  readonly versionRoot: ReadonlyMap<EntitlementGrantId, EntitlementGrantId>;
  /** Terminal revocations, root id -> the revocation. */
  readonly revocations: ReadonlyMap<EntitlementGrantId, GrantRevocation>;
  /** Every consumption record, by id. */
  readonly consumptions: ReadonlyMap<ConsumptionRecordId, ConsumptionRecord>;
  /** The append-only, chain-verified operation log. */
  readonly log: readonly EntitlementLogEntry[];
}

/** Creates the GENESIS ledger state for one tenant (empty, chain at its zero state). */
export function createEntitlementLedger(tenantId: string): EntitlementResult<EntitlementLedgerState> {
  if (!isTenantId(tenantId)) {
    return fail('tenant_missing', 'the entitlement ledger is created within exactly one tenant scope (L12)', 'tenantId');
  }
  return ok(deepFreeze({
    tenantId,
    grants: new Map<EntitlementGrantId, EntitlementGrant>(),
    history: new Map<EntitlementGrantId, readonly EntitlementGrant[]>(),
    current: new Map<EntitlementGrantId, EntitlementGrant>(),
    versionRoot: new Map<EntitlementGrantId, EntitlementGrantId>(),
    revocations: new Map<EntitlementGrantId, GrantRevocation>(),
    consumptions: new Map<ConsumptionRecordId, ConsumptionRecord>(),
    log: [],
  }) as unknown as EntitlementLedgerState);
}

/** The result of a ledger operation: the NEXT state + the minted record + the replay marker. */
export interface LedgerOperationResult<T> {
  readonly state: EntitlementLedgerState;
  readonly record: T;
  /** `true` when the identical operation was already appended (content-addressed idempotence — no new log entry). */
  readonly replayed: boolean;
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

/** The digest of one log entry's own content (everything except `head`). */
function entryHead(entry: Omit<EntitlementLogEntry, 'head'>): string {
  return `elog:${stableDigestJson(entry)}`;
}

/** Appends one entry to the log, linking it to the current head. */
function appendEntry(
  state: EntitlementLedgerState,
  kind: EntitlementLogKind,
  recordId: string,
  record: unknown,
  at: number,
): { readonly log: readonly EntitlementLogEntry[] } {
  const prior = state.log.length === 0 ? [] : state.log;
  const priorHead = state.log.length === 0 ? GENESIS_CHAIN_HEAD : state.log[state.log.length - 1].head;
  const content = { seq: state.log.length, kind, recordId, recordDigest: stableDigestJson(record), at, priorHead };
  const head = entryHead(content);
  const sealed: EntitlementLogEntry = Object.freeze({ ...content, head });
  return { log: Object.freeze([...prior, sealed]) };
}

/**
 * Verifies the FULL chain: every entry's head recomputes, every
 * prior-head link is intact, seq is contiguous from 0, and every
 * record digest matches a retained record. Any tamper is the typed
 * `chain_mismatch`.
 */
export function verifyEntitlementChain(state: EntitlementLedgerState): EntitlementResult<void> {
  let expectedPrior = GENESIS_CHAIN_HEAD;
  for (let index = 0; index < state.log.length; index++) {
    const entry = state.log[index];
    if (typeof entry !== 'object' || entry === null) {
      return fail('chain_mismatch', `log entry ${index} is not an object`, `log[${index}]`);
    }
    if (entry.seq !== index) {
      return fail('chain_mismatch', `log entry ${index} carries seq ${entry.seq} — the sequence is contiguous from 0 (an entry was inserted or removed)`, `log[${index}].seq`);
    }
    if (entry.priorHead !== expectedPrior) {
      return fail('chain_mismatch', `log entry ${index} links to ${entry.priorHead} but the chain's prior head is ${expectedPrior} — the log was rewritten`, `log[${index}].priorHead`);
    }
    const recomputed = entryHead({ seq: entry.seq, kind: entry.kind, recordId: entry.recordId, recordDigest: entry.recordDigest, at: entry.at, priorHead: entry.priorHead });
    if (recomputed !== entry.head) {
      return fail('chain_mismatch', `log entry ${index} head is ${entry.head} but its content digests to ${recomputed} — the entry was tampered with`, `log[${index}].head`);
    }
    expectedPrior = entry.head;

    // The record-digest leg: the entry's record must still exist, unchanged.
    const record = recordOf(state, entry);
    if (record === undefined) {
      return fail('chain_mismatch', `log entry ${index} (${entry.kind}) references record ${entry.recordId} which is absent from the ledger — history was hidden`, `log[${index}].recordId`);
    }
    if (stableDigestJson(record) !== entry.recordDigest) {
      return fail('chain_mismatch', `log entry ${index} pins record ${entry.recordId} at digest ${entry.recordDigest} but the retained record digests to ${stableDigestJson(record)} — the record was rewritten`, `log[${index}].recordDigest`);
    }
  }
  return ok(undefined);
}

/** Resolves the retained record a log entry references. */
function recordOf(state: EntitlementLedgerState, entry: EntitlementLogEntry): unknown {
  switch (entry.kind) {
    case 'grant-issued':
    case 'grant-amended':
      return state.grants.get(entry.recordId as EntitlementGrantId);
    case 'grant-revoked': {
      for (const revocation of state.revocations.values()) {
        if (revocation.revocationId === (entry.recordId as unknown as EntitlementRevocationId)) return revocation;
      }
      return undefined;
    }
    case 'consumed':
      return state.consumptions.get(entry.recordId as ConsumptionRecordId);
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Serialization (byte-deterministic)
// ---------------------------------------------------------------------------

/** The plain serializable view of a ledger (canonical-JSON-ready; insertion order — deterministic for the same op sequence). */
export interface EntitlementLedgerView {
  readonly tenantId: string;
  readonly grants: readonly EntitlementGrant[];
  readonly history: readonly { readonly rootId: string; readonly versions: readonly EntitlementGrant[] }[];
  readonly revocations: readonly GrantRevocation[];
  readonly consumptions: readonly ConsumptionRecord[];
  readonly log: readonly EntitlementLogEntry[];
}

/** The plain serializable view. */
export function entitlementLedgerView(state: EntitlementLedgerState): EntitlementLedgerView {
  const history: { rootId: string; versions: readonly EntitlementGrant[] }[] = [];
  for (const [rootId, versions] of state.history.entries()) {
    history.push({ rootId, versions });
  }
  return {
    tenantId: state.tenantId,
    grants: [...state.grants.values()],
    history,
    revocations: [...state.revocations.values()],
    consumptions: [...state.consumptions.values()],
    log: state.log,
  };
}

/** Serializes the ledger to canonical JSON bytes (the determinism anchor, L9). */
export function serializeEntitlementLedger(state: EntitlementLedgerState): string {
  return canonicalJson(entitlementLedgerView(state));
}

/** The ledger's stable digest (over the canonical serialization). */
export function entitlementLedgerDigest(state: EntitlementLedgerState): string {
  return stableDigestJson(entitlementLedgerView(state));
}

// ---------------------------------------------------------------------------
// Internal helpers (chain resolution, the L12 gate)
// ---------------------------------------------------------------------------

/** The L12 gate: every record entering the ledger carries the ledger's tenant. */
function tenantGate(state: EntitlementLedgerState, record: { readonly tenantId: string }, path: string): EntitlementResult<void> {
  if (record.tenantId !== state.tenantId) {
    return fail('cross_tenant_access', `the record's tenant "${record.tenantId}" is not the ledger's tenant "${state.tenantId}" — a foreign record never crosses the ledger boundary (L12)`, path);
  }
  return ok(undefined);
}

/** The next state with one log entry appended and `mutate` applied to the maps. */
function withEntry(
  state: EntitlementLedgerState,
  kind: EntitlementLogKind,
  recordId: string,
  record: unknown,
  at: number,
  mutate: (maps: {
    grants: Map<EntitlementGrantId, EntitlementGrant>;
    history: Map<EntitlementGrantId, readonly EntitlementGrant[]>;
    current: Map<EntitlementGrantId, EntitlementGrant>;
    versionRoot: Map<EntitlementGrantId, EntitlementGrantId>;
    revocations: Map<EntitlementGrantId, GrantRevocation>;
    consumptions: Map<ConsumptionRecordId, ConsumptionRecord>;
  }) => void,
): EntitlementLedgerState {
  const appended = appendEntry(state, kind, recordId, record, at);
  const maps = {
    grants: new Map(state.grants),
    history: new Map(state.history),
    current: new Map(state.current),
    versionRoot: new Map(state.versionRoot),
    revocations: new Map(state.revocations),
    consumptions: new Map(state.consumptions),
  };
  mutate(maps);
  return deepFreeze({
    tenantId: state.tenantId,
    grants: maps.grants,
    history: maps.history,
    current: maps.current,
    versionRoot: maps.versionRoot,
    revocations: maps.revocations,
    consumptions: maps.consumptions,
    log: appended.log,
  }) as unknown as EntitlementLedgerState;
}

/** The chain's current version grant, looked up from ANY version id of the chain. */
export function currentGrantOf(state: EntitlementLedgerState, grantId: EntitlementGrantId): EntitlementGrant | undefined {
  const rootId = state.versionRoot.get(grantId) ?? (state.history.has(grantId) ? grantId : undefined);
  if (rootId === undefined) return undefined;
  return state.current.get(rootId);
}

/** The chain's root id, looked up from any version id. */
export function rootIdOf(state: EntitlementLedgerState, grantId: EntitlementGrantId): EntitlementGrantId | undefined {
  return state.versionRoot.get(grantId) ?? (state.history.has(grantId) ? grantId : undefined);
}

/** The chain's total consumption at or before `at` (exact decimal fold over the chain's records). */
function chainConsumedAt(state: EntitlementLedgerState, rootId: EntitlementGrantId, at: TimestampMs): string {
  let total = '0';
  for (const record of state.consumptions.values()) {
    if (record.rootId === rootId && record.at <= at) {
      total = signedAdd(total, record.amount);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Operation: issue a grant (a chain's root — version 1)
// ---------------------------------------------------------------------------

/**
 * Issues a NEW entitlement grant (a chain's root). The draft MUST be
 * version 1 with `supersedes: null` (an amendment goes through
 * {@link amendEntitlementGrantOn}); the FULL validation law runs
 * first. Content-addressed idempotence: replaying a byte-identical
 * draft returns the existing record.
 */
export function issueEntitlementGrant(
  state: EntitlementLedgerState,
  draft: unknown,
): EntitlementResult<LedgerOperationResult<EntitlementGrant>> {
  const validated = validateEntitlementGrant(draft);
  if (!validated.ok) return validated;
  const grant = validated.value;
  const gate = tenantGate(state, grant, 'grant');
  if (!gate.ok) return gate;
  if (grant.version !== 1 || grant.supersedes !== null) {
    return fail('invalid_transition', `issuing mints a chain ROOT (version 1, supersedes null — got version ${grant.version}, supersedes ${JSON.stringify(grant.supersedes)}); an amendment goes through amendEntitlementGrantOn`, 'grant');
  }
  const existing = state.grants.get(grant.grantId);
  if (existing !== undefined) {
    return ok({ state, record: existing, replayed: true });
  }
  const next = withEntry(state, 'grant-issued', grant.grantId, grant, grant.issuedAt, (maps) => {
    maps.grants.set(grant.grantId, grant);
    maps.history.set(grant.grantId, [grant]);
    maps.current.set(grant.grantId, grant);
    maps.versionRoot.set(grant.grantId, grant.grantId);
  });
  return ok({ state: next, record: grant, replayed: false });
}

// ---------------------------------------------------------------------------
// Operation: amend a grant (mint the next version of a chain)
// ---------------------------------------------------------------------------

/**
 * Amends a chain: mints version + 1 over the ledger's CURRENT version
 * (`priorGrantId` must name it — a stale version id is the typed
 * `grant_mismatch`). The amendment keeps the chain's tenant and kind
 * (a changed kind is a NEW grant — `kind_change_forbidden`); a
 * revoked chain never amends (`invalid_transition`). Idempotent
 * replay: re-submitting the identical amendment returns the existing
 * version.
 */
export function amendEntitlementGrantOn(
  state: EntitlementLedgerState,
  input: {
    readonly priorGrantId: string;
    readonly projectId: string | null;
    readonly terms: unknown;
    readonly sourceRef: string;
    readonly issuedAt: number;
    readonly effectiveFrom: number;
    readonly effectiveUntil: number | null;
  },
): EntitlementResult<LedgerOperationResult<EntitlementGrant>> {
  if (!isEntitlementGrantId(input.priorGrantId)) {
    return fail('invalid_id', 'invalid prior EntitlementGrantId (eg:<16-hex>)', 'priorGrantId');
  }
  const prior = currentGrantOf(state, input.priorGrantId as EntitlementGrantId);
  if (prior === undefined) {
    return fail('entitlement_unknown', `the grant ${input.priorGrantId} is not in this ledger`, 'priorGrantId');
  }
  const rootId = rootIdOf(state, input.priorGrantId as EntitlementGrantId) as EntitlementGrantId;
  if (prior.grantId !== input.priorGrantId) {
    return fail('grant_mismatch', `the named version ${input.priorGrantId} is not the chain's CURRENT version (${prior.grantId}) — amend the current version`, 'priorGrantId');
  }
  if (state.revocations.has(rootId)) {
    return fail('invalid_transition', `the chain ${rootId} is REVOKED (terminal) — a revoked entitlement never amends`, 'priorGrantId');
  }
  if (input.terms === undefined || input.terms === null || !isRecord(input.terms)) {
    return { ok: false, errors: [invalidType('terms', 'the amendment terms must be an object (the closed union, one member per kind)')] };
  }
  if ((input.terms as { kind?: unknown }).kind !== prior.kind) {
    return fail('kind_change_forbidden', `an amendment keeps the grant's kind (${prior.kind}) — a changed kind is a NEW grant, not an amendment (the kind is the allowance's identity)`, 'terms.kind');
  }
  const amended = validateEntitlementGrant({
    tenantId: prior.tenantId,
    projectId: input.projectId,
    kind: prior.kind,
    terms: input.terms,
    version: prior.version + 1,
    supersedes: prior.grantId,
    sourceRef: input.sourceRef,
    issuedAt: input.issuedAt,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
  });
  if (!amended.ok) return amended;
  // THE AMENDMENT EXHAUSTION LAW: a spend-allowance amendment never
  // reduces the allowance below the chain's accumulated consumption at
  // the amendment instant (the remaining balance never goes negative —
  // the accounting invariant the snapshot's exact arithmetic relies on).
  if (amended.value.kind === 'spend-allowance') {
    const consumed = chainConsumedAt(state, rootId, input.issuedAt as TimestampMs);
    const nextAmount = (amended.value.terms as { amount: string }).amount;
    if (signedCompare(consumed, nextAmount) > 0) {
      return fail('entitlement_exhausted', `the amendment would reduce the chain ${rootId}'s allowance to ${nextAmount} below its accumulated consumption ${consumed} — the remaining balance never goes negative`, 'terms.amount');
    }
  }
  const grant = amended.value;
  const existing = state.grants.get(grant.grantId);
  if (existing !== undefined) {
    return ok({ state, record: existing, replayed: true });
  }
  const next = withEntry(state, 'grant-amended', grant.grantId, grant, grant.issuedAt, (maps) => {
    maps.grants.set(grant.grantId, grant);
    maps.history.set(rootId, [...(maps.history.get(rootId) ?? []), grant]);
    maps.current.set(rootId, grant);
    maps.versionRoot.set(grant.grantId, rootId);
  });
  return ok({ state: next, record: grant, replayed: false });
}

// ---------------------------------------------------------------------------
// Operation: revoke a chain (the terminal event)
// ---------------------------------------------------------------------------

/**
 * Revokes a chain: the terminal ledger event. `grantId` must name the
 * chain's CURRENT version; a revoked chain never amends and never
 * consumes again. The grant records are never mutated (L3) — the
 * revocation is a retained, chain-pinned record. Content-addressed
 * idempotence: revoking the same version at the same instant replays.
 */
export function revokeEntitlementGrant(
  state: EntitlementLedgerState,
  input: { readonly grantId: string; readonly revokedAt: number },
): EntitlementResult<LedgerOperationResult<GrantRevocation>> {
  if (!isEntitlementGrantId(input.grantId)) {
    return fail('invalid_id', 'invalid EntitlementGrantId (eg:<16-hex>)', 'grantId');
  }
  if (!isTimestampMs(input.revokedAt)) {
    return fail('invalid_timestamp', 'the revocation instant must be a TimestampMs (explicit — never a wall clock)', 'revokedAt');
  }
  const current = currentGrantOf(state, input.grantId as EntitlementGrantId);
  if (current === undefined) {
    return fail('entitlement_unknown', `the grant ${input.grantId} is not in this ledger`, 'grantId');
  }
  const rootId = rootIdOf(state, input.grantId as EntitlementGrantId) as EntitlementGrantId;
  const existing = state.revocations.get(rootId);
  if (existing !== undefined) {
    if (existing.grantId === current.grantId && existing.revokedAt === input.revokedAt) {
      return ok({ state, record: existing, replayed: true });
    }
    return fail('invalid_transition', `the chain ${rootId} is already revoked (at ${existing.revokedAt}) — revocation is terminal`, 'grantId');
  }
  if (current.grantId !== input.grantId) {
    return fail('grant_mismatch', `the named version ${input.grantId} is not the chain's CURRENT version (${current.grantId}) — revoke the current version`, 'grantId');
  }
  const identityContent = { grantId: current.grantId, rootId, tenantId: state.tenantId, revokedAt: input.revokedAt };
  const revocation: GrantRevocation = deepFreeze(deepCloneJson({
    revocationId: deriveEntitlementRevocationId(identityContent),
    ...identityContent,
  } as unknown as JsonValue) as unknown as GrantRevocation);
  const next = withEntry(state, 'grant-revoked', revocation.revocationId, revocation, input.revokedAt, (maps) => {
    maps.revocations.set(rootId, revocation);
  });
  return ok({ state: next, record: revocation, replayed: false });
}

// ---------------------------------------------------------------------------
// Operation: consume (the draw-down — the exhaustion law)
// ---------------------------------------------------------------------------

/** The untrusted consumption draft (everything except the derived identity and chain resolution). */
export interface ConsumptionDraft {
  /** The grant to draw: the chain's current version id, or `null` to auto-select the first covering active spend allowance. */
  readonly grantId: string | null;
  /** The charge's project scope (the commercial record's project — L12). */
  readonly projectId: string;
  /** The charge's currency (must equal the drawn grant's). */
  readonly currency: string;
  /** The POSITIVE canonical decimal amount to draw. */
  readonly amount: string;
  /** The typed cause (the closed vocabulary). */
  readonly cause: ConsumptionCause;
  /** Opaque refs to the commercial records this consumption settles (L9 lineage). */
  readonly refs: readonly string[];
  /** Explicit consumption instant (epoch ms — never a wall clock). */
  readonly at: number;
}

/**
 * Draws `amount` from a spend-allowance chain — the ONLY way an
 * allowance goes down. The exhaustion law (exact decimals): the
 * chain's accumulated consumption plus this charge never exceeds the
 * CURRENT version's amount (`entitlement_exhausted`); the window law
 * (L4): the chain's current version must be `active` at the charge
 * instant and not revoked by then; the coverage law: the grant's
 * project scope covers the charge's (`null` covers everything); the
 * currency law: the charge's currency equals the grant's. With
 * `grantId: null` the ledger auto-selects the FIRST covering chain in
 * canonical order (issuedAt asc, then grantId asc) with sufficient
 * remaining allowance — deterministic. Content-addressed idempotence:
 * an identical charge replays.
 */
export function consumeEntitlement(
  state: EntitlementLedgerState,
  draft: unknown,
): EntitlementResult<LedgerOperationResult<ConsumptionRecord>> {
  if (!isRecord(draft)) {
    return { ok: false, errors: [invalidType('consumption', 'the consumption must be an object')] };
  }
  const errors: EntitlementError[] = [];
  if (draft.grantId === undefined) errors.push(missingField('consumption.grantId'));
  else if (draft.grantId !== null && !isEntitlementGrantId(draft.grantId)) {
    errors.push(invalidField('consumption.grantId', 'invalid EntitlementGrantId (eg:<16-hex>) or null for auto-selection'));
  }
  if (draft.projectId === undefined) errors.push({ code: 'tenant_missing', path: 'consumption.projectId', message: 'every consumption carries its commercial record\'s project (L12)' });
  else if (!isProjectId(draft.projectId)) errors.push(invalidField('consumption.projectId', 'invalid ProjectId'));
  if (draft.currency === undefined) errors.push(missingField('consumption.currency'));
  else if (typeof draft.currency !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(draft.currency)) errors.push(invalidField('consumption.currency', 'invalid currency (identifier pattern)'));
  if (draft.amount === undefined) errors.push({ code: 'invalid_decimal', path: 'consumption.amount', message: '"consumption.amount" is required' });
  else if (!isPositiveDecimal(draft.amount)) errors.push({ code: 'invalid_decimal', path: 'consumption.amount', message: `the amount must be a POSITIVE canonical decimal string (got ${JSON.stringify(draft.amount)}) — a zero or negative draw is not a consumption` });
  if (draft.cause === undefined) errors.push(missingField('consumption.cause'));
  else if (!isConsumptionCause(draft.cause)) errors.push(invalidField('consumption.cause', `must be one of ${CONSUMPTION_CAUSES.join(' | ')} (the closed vocabulary)`));
  if (draft.refs === undefined) errors.push(missingField('consumption.refs'));
  else if (!Array.isArray(draft.refs) || !draft.refs.every(isNonEmptyString)) errors.push(invalidField('consumption.refs', 'must be an array of opaque non-empty lineage refs'));
  if (draft.at === undefined) errors.push(missingField('consumption.at'));
  else if (!isTimestampMs(draft.at)) errors.push(invalidField('consumption.at', 'invalid TimestampMs (explicit instant — never a wall clock)'));
  if (errors.length > 0) return { ok: false, errors };

  // Resolve the drawn grant (explicit or auto-selected — deterministic).
  const input = draft as unknown as ConsumptionDraft;
  const resolution = resolveDrawGrant(state, input);
  if (!resolution.ok) return resolution;
  const grant = resolution.value;

  // THE CURRENCY LAW.
  const grantCurrency = (grant.terms as { currency: string }).currency;
  if (grantCurrency !== input.currency) {
    return fail('grant_mismatch', `the charge's currency (${input.currency}) does not match the allowance's (${grantCurrency})`, 'consumption.currency');
  }
  const rootId = rootIdOf(state, grant.grantId) as EntitlementGrantId;

  // Content-addressed replay FIRST (an identical charge never double-draws).
  const identityContent = { grantId: grant.grantId, rootId, tenantId: state.tenantId, projectId: input.projectId, currency: input.currency, amount: input.amount, cause: input.cause, refs: input.refs, at: input.at };
  const consumptionId = deriveConsumptionRecordId(identityContent);
  const existingConsumption = state.consumptions.get(consumptionId);
  if (existingConsumption !== undefined) {
    return ok({ state, record: existingConsumption, replayed: true });
  }

  // THE WINDOW LAW (L4) + the revocation law.
  const window = grantWindowStatus(grant, input.at as TimestampMs);
  if (window === 'not-yet-effective') {
    return fail('entitlement_inactive', `the allowance ${grant.grantId} is not yet effective at ${input.at} (effective from ${grant.effectiveFrom})`, 'consumption.at');
  }
  if (window === 'expired') {
    return fail('entitlement_expired', `the allowance ${grant.grantId} expired at ${grant.effectiveUntil} (the charge instant is ${input.at})`, 'consumption.at');
  }
  const revocation = state.revocations.get(rootId);
  if (revocation !== undefined && revocation.revokedAt <= input.at) {
    return fail('entitlement_revoked', `the allowance chain ${rootId} was revoked at ${revocation.revokedAt} (the charge instant is ${input.at})`, 'consumption.at');
  }

  // THE EXHAUSTION LAW (exact decimals — L20 enforcement is code).
  const consumed = chainConsumedAt(state, rootId, input.at as TimestampMs);
  const nextTotal = signedAdd(consumed, input.amount);
  if (signedCompare(nextTotal, (grant.terms as { amount: string }).amount) > 0) {
    return fail('entitlement_exhausted', `drawing ${input.amount} would take the chain ${rootId} to ${nextTotal} of its ${(grant.terms as { amount: string }).amount} allowance (already consumed ${consumed}) — the draw-down never goes negative`, 'consumption.amount');
  }

  const consumption: ConsumptionRecord = deepFreeze(deepCloneJson({
    consumptionId,
    ...identityContent,
  } as unknown as JsonValue) as unknown as ConsumptionRecord);
  if (!isConsumptionRecord(consumption)) {
    return fail('invalid_field', 'the minted consumption failed its own structural guard', 'consumption');
  }
  const next = withEntry(state, 'consumed', consumption.consumptionId, consumption, consumption.at, (maps) => {
    maps.consumptions.set(consumption.consumptionId, consumption);
  });
  return ok({ state: next, record: consumption, replayed: false });
}



/**
 * Resolves the grant a charge draws: the named chain's CURRENT version
 * (explicit) or the first covering active spend chain in canonical
 * order (auto). Enforces the kind + coverage laws on the way.
 */
function resolveDrawGrant(state: EntitlementLedgerState, draft: ConsumptionDraft): EntitlementResult<EntitlementGrant> {
  if (draft.grantId !== null && draft.grantId !== undefined) {
    const grant = currentGrantOf(state, draft.grantId as EntitlementGrantId);
    if (grant === undefined) {
      return fail('entitlement_unknown', `the grant ${draft.grantId} is not in this ledger`, 'consumption.grantId');
    }
    if (grant.grantId !== draft.grantId) {
      return fail('grant_mismatch', `the named version ${draft.grantId} is not the chain's CURRENT version (${grant.grantId}) — draw the current version`, 'consumption.grantId');
    }
    if (grant.kind !== 'spend-allowance') {
      return fail('grant_mismatch', `the grant ${grant.grantId} is a ${grant.kind}, not a spend-allowance — only spend allowances are drawn down (api quotas enforce usage; licenses grant rights)`, 'consumption.grantId');
    }
    if (!coversProject(grant, draft.projectId)) {
      return fail('grant_mismatch', `the allowance ${grant.grantId} is scoped to project ${JSON.stringify(grant.projectId)} and does not cover the charge's project "${draft.projectId}"`, 'consumption.projectId');
    }
    return ok(grant);
  }
  // AUTO-SELECT: the first covering, active, unrevoked spend chain with
  // sufficient remaining allowance, in canonical order (issuedAt asc,
  // then grantId asc) over the chain's current versions. Deterministic.
  const candidates: { readonly grant: EntitlementGrant; readonly rootId: EntitlementGrantId }[] = [];
  for (const [rootId, grant] of state.current.entries()) {
    if (grant.kind !== 'spend-allowance') continue;
    if ((grant.terms as { currency: string }).currency !== draft.currency) continue;
    if (!coversProject(grant, draft.projectId)) continue;
    if (grantWindowStatus(grant, draft.at as TimestampMs) !== 'active') continue;
    const revocation = state.revocations.get(rootId);
    if (revocation !== undefined && revocation.revokedAt <= draft.at) continue;
    candidates.push({ grant, rootId });
  }
  candidates.sort((left, right) => {
    if (left.grant.issuedAt !== right.grant.issuedAt) return left.grant.issuedAt - right.grant.issuedAt;
    return left.grant.grantId < right.grant.grantId ? -1 : 1;
  });
  for (const candidate of candidates) {
    const consumed = chainConsumedAt(state, candidate.rootId, draft.at as TimestampMs);
    const nextTotal = signedAdd(consumed, draft.amount);
    if (signedCompare(nextTotal, (candidate.grant.terms as { amount: string }).amount) <= 0) {
      return ok(candidate.grant);
    }
  }
  if (candidates.length === 0) {
    return fail('entitlement_exhausted', `no active spend-allowance in this ledger covers currency "${draft.currency}" for project "${draft.projectId}" at ${draft.at} — nothing is consumable without an entitlement (L20)`, 'consumption.grantId');
  }
  return fail('entitlement_exhausted', `every covering spend-allowance for currency "${draft.currency}" is exhausted at ${draft.at} (charge ${draft.amount}) — the draw-down never goes negative`, 'consumption.amount');
}

/** The coverage law: a tenant-wide grant covers every project; a project grant covers exactly its own. */
function coversProject(grant: EntitlementGrant, projectId: string): boolean {
  return grant.projectId === null || grant.projectId === projectId;
}

// ---------------------------------------------------------------------------
// The point-in-time snapshot (L4)
// ---------------------------------------------------------------------------

/** One chain's entitlement state at instant `at`. */
export interface EntitlementSnapshotEntry {
  /** The chain's root (version 1's id — the accounting key). */
  readonly rootId: string;
  /** The chain's version that was CURRENT at `at` (the latest version issued at or before `at`). */
  readonly grant: EntitlementGrant;
  /** The chain's terminal status at `at` (revocation wins over the window). */
  readonly status: 'active' | 'not-yet-effective' | 'expired' | 'revoked';
  /** The revocation instant, when the chain was revoked at or before `at` (else null). */
  readonly revokedAt: number | null;
  /** The window status at `at` (informational — `status` is the verdict). */
  readonly window: GrantWindowStatus;
  /** The chain's accumulated consumption at or before `at` (canonical decimal; `0` for non-spend kinds). */
  readonly consumed: string;
  /** The remaining spend allowance at `at` (spend chains only; null otherwise). */
  readonly remaining: string | null;
}

/** The tenant's entitlement state at instant `at` (L4 — derived from retained history alone). */
export interface EntitlementSnapshot {
  readonly tenantId: string;
  readonly at: number;
  /** The chain entries in canonical order (rootId asc) — deterministic. */
  readonly entries: readonly EntitlementSnapshotEntry[];
}

/**
 * THE POINT-IN-TIME ENTITLEMENT SNAPSHOT: what was this tenant allowed
 * at instant `at`? For every chain: the version current at `at`, the
 * terminal status (revocation first, then the L4 window), and the
 * exact consumption accumulated by `at`. Chains whose first version
 * was issued after `at` did not exist yet and are absent. Pure —
 * derived from the retained ledger alone.
 */
export function entitlementSnapshot(state: EntitlementLedgerState, at: number): EntitlementResult<EntitlementSnapshot> {
  if (!isTimestampMs(at)) {
    return fail('invalid_timestamp', 'the snapshot instant must be a TimestampMs (explicit — never a wall clock)', 'at');
  }
  const entries: EntitlementSnapshotEntry[] = [];
  for (const [rootId, versions] of state.history.entries()) {
    // The version current at `at`: the latest issued at or before `at`.
    let currentAt: EntitlementGrant | undefined = undefined;
    for (const version of versions) {
      if (version.issuedAt <= at) currentAt = version;
    }
    if (currentAt === undefined) continue; // the chain did not exist at `at`
    const revocation = state.revocations.get(rootId);
    const revoked = revocation !== undefined && revocation.revokedAt <= at;
    const window = grantWindowStatus(currentAt, at as TimestampMs);
    const status: EntitlementSnapshotEntry['status'] = revoked ? 'revoked' : window;
    const consumed = chainConsumedAt(state, rootId, at as TimestampMs);
    const remaining = currentAt.kind === 'spend-allowance' ? unsignedSubtract((currentAt.terms as { amount: string }).amount, consumed) : null;
    entries.push({ rootId, grant: currentAt, status, revokedAt: revoked ? (revocation as GrantRevocation).revokedAt : null, window, consumed, remaining });
  }
  entries.sort((left, right) => (left.rootId < right.rootId ? -1 : 1));
  return ok(deepFreeze({ tenantId: state.tenantId, at, entries }) as unknown as EntitlementSnapshot);
}

/**
 * The ACTIVE api-quota grants of a snapshot, projected onto the usage
 * enforcement fold's grant view (the R41 decision input). Deterministic
 * (snapshot order).
 */
export function activeQuotaGrants(snapshot: EntitlementSnapshot): readonly QuotaGrantView[] {
  const views: QuotaGrantView[] = [];
  for (const entry of snapshot.entries) {
    if (entry.status !== 'active' || entry.grant.kind !== 'api-quota') continue;
    const terms = entry.grant.terms as { routeFamilies: readonly string[]; maxRequests: number; windowMs: number };
    views.push({ grantId: entry.grant.grantId, routeFamilies: terms.routeFamilies, maxRequests: terms.maxRequests, windowMs: terms.windowMs });
  }
  return Object.freeze(views);
}

/**
 * The ACTIVE spend-allowance chains of a snapshot covering
 * (currency, project), in canonical order (issuedAt asc, then grantId
 * asc), with their exact remaining amounts at the snapshot instant.
 * The marketplace settlement's allowance lookup.
 */
export function coveringSpendGrants(
  snapshot: EntitlementSnapshot,
  scope: { readonly currency: string; readonly projectId: string },
): readonly { readonly grant: EntitlementGrant; readonly remaining: string }[] {
  const covering: { grant: EntitlementGrant; remaining: string }[] = [];
  for (const entry of snapshot.entries) {
    if (entry.status !== 'active' || entry.grant.kind !== 'spend-allowance') continue;
    if ((entry.grant.terms as { currency: string }).currency !== scope.currency) continue;
    if (entry.grant.projectId !== null && entry.grant.projectId !== scope.projectId) continue;
    covering.push({ grant: entry.grant, remaining: entry.remaining as string });
  }
  covering.sort((left, right) => {
    if (left.grant.issuedAt !== right.grant.issuedAt) return left.grant.issuedAt - right.grant.issuedAt;
    return left.grant.grantId < right.grant.grantId ? -1 : 1;
  });
  return Object.freeze(covering);
}
