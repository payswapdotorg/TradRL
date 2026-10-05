// @tradrl/marketplace-service — the MARKETPLACE STATE + the chain: the
// append-only, chain-verified per-tenant commercial ledger (the
// catalog + the purchases + the settlements).
//
// THE LAWS THIS MODULE SERVES:
// - L12 (tenant isolation): the marketplace is scoped to ONE tenant at
//   creation; every record entering it must carry that tenant.
// - The chain law (L9/L11): every operation APPENDS one log entry
//   (seq, kind, recordId, recordDigest, at, priorHead, head) — the
//   entries are linked by their digests, and `verifyMarketplaceChain`
//   recomputes the whole chain plus every record digest; a tampered
//   log entry, a rewritten record, or a hidden operation is the typed
//   `chain_mismatch`. History is retained — retired listings, voided
//   purchases and no-charge settlements included (the commercial
//   accounting truth).
// - Determinism: no ambient clock, no ambient randomness — every id
//   and every chain head is a pure function of the operation content;
//   the same op sequence mints byte-identical serializations.

import { canonicalJson, deepFreeze, isNonEmptyString, isTimestampMs, stableDigestJson } from './imports';
import type { MarketplaceResult } from './errors';
import { fail, ok } from './errors';
import type { MarketplaceListing, ListingRetirement } from './listing';
import type { PurchaseOrder, Settlement } from './purchase';

// ---------------------------------------------------------------------------
// The append-only log (the chain)
// ---------------------------------------------------------------------------

/** The log-entry kinds — one per marketplace operation. */
export const MARKETPLACE_LOG_KINDS = [
  'listing-published',
  'listing-revised',
  'listing-retired',
  'purchase-opened',
  'purchase-bound',
  'purchase-settled',
  'purchase-voided',
] as const;

/** One log-entry kind. */
export type MarketplaceLogKind = (typeof MARKETPLACE_LOG_KINDS)[number];

/** The chain's zero state (the linked list's genesis head). */
export const GENESIS_CHAIN_HEAD = 'mlog:0000000000000000';

/**
 * ONE append-only log entry: the operation kind, the record it minted
 * (id + digest), the operation's explicit instant, and the chain link
 * (`priorHead` -> `head`, where `head` is the stable digest of the
 * entry's own content minus `head`). Tamper-evident: rewriting any
 * entry breaks every later head; rewriting a RECORD breaks its entry's
 * digest match.
 */
export interface MarketplaceLogEntry {
  readonly seq: number;
  readonly kind: MarketplaceLogKind;
  readonly recordId: string;
  readonly recordDigest: string;
  readonly at: number;
  readonly priorHead: string;
  readonly head: string;
}

// ---------------------------------------------------------------------------
// The marketplace state (immutable; one tenant; append-only histories)
// ---------------------------------------------------------------------------

/**
 * The marketplace for ONE tenant: the listing catalog (each slot's
 * CURRENT revision + the append-only revision history + the terminal
 * retirements), the purchases (each one's CURRENT record + the version
 * history), the settlements, and the chain-verified log of every
 * operation.
 */
export interface MarketplaceState {
  /** The marketplace's ONE tenant (L12 — the gate every record must pass). */
  readonly tenantId: string;
  /** Each listing slot's CURRENT revision, listingRef -> revision. */
  readonly listingsBySlot: ReadonlyMap<string, MarketplaceListing>;
  /** EVERY listing revision ever minted, by listingId (the chain's record-digest leg). */
  readonly listingsById: ReadonlyMap<string, MarketplaceListing>;
  /** The append-only revision history (publish order). */
  readonly listingHistory: readonly MarketplaceListing[];
  /** Terminal retirements, listingRef -> the retirement. */
  readonly retirements: ReadonlyMap<string, ListingRetirement>;
  /** Each purchase's CURRENT record, purchaseId -> current. */
  readonly purchases: ReadonlyMap<string, PurchaseOrder>;
  /** Every purchase's version history, append-only (the chain's record-digest leg). */
  readonly purchaseVersions: ReadonlyMap<string, readonly PurchaseOrder[]>;
  /** Every settlement, by settlementId. */
  readonly settlements: ReadonlyMap<string, Settlement>;
  /** The append-only, chain-verified operation log. */
  readonly log: readonly MarketplaceLogEntry[];
}

/** Creates the GENESIS marketplace state for one tenant (empty, chain at its zero state). */
export function createMarketplace(tenantId: string): MarketplaceResult<MarketplaceState> {
  if (!isNonEmptyString(tenantId)) {
    return fail('tenant_missing', 'the marketplace is created within exactly one tenant scope (L12)', 'tenantId');
  }
  return ok(deepFreeze({
    tenantId,
    listingsBySlot: new Map<string, MarketplaceListing>(),
    listingsById: new Map<string, MarketplaceListing>(),
    listingHistory: [] as readonly MarketplaceListing[],
    retirements: new Map<string, ListingRetirement>(),
    purchases: new Map<string, PurchaseOrder>(),
    purchaseVersions: new Map<string, readonly PurchaseOrder[]>(),
    settlements: new Map<string, Settlement>(),
    log: [] as readonly MarketplaceLogEntry[],
  }) as unknown as MarketplaceState);
}

/** The result of a marketplace operation: the NEXT state + the minted record + the replay marker. */
export interface MarketplaceOperationResult<T> {
  readonly state: MarketplaceState;
  readonly record: T;
  /** `true` when the identical operation was already appended (content-addressed idempotence — no new log entry). */
  readonly replayed: boolean;
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

/** The digest of one log entry's own content (everything except `head`). */
function entryHead(entry: Omit<MarketplaceLogEntry, 'head'>): string {
  return `mlog:${stableDigestJson(entry)}`;
}

/** Appends one entry to the log, linking it to the current head. */
function appendEntry(
  state: MarketplaceState,
  kind: MarketplaceLogKind,
  recordId: string,
  record: unknown,
  at: number,
): { readonly log: readonly MarketplaceLogEntry[] } {
  const prior = state.log.length === 0 ? [] : state.log;
  const priorHead = state.log.length === 0 ? GENESIS_CHAIN_HEAD : state.log[state.log.length - 1].head;
  const content = { seq: state.log.length, kind, recordId, recordDigest: stableDigestJson(record), at, priorHead };
  const head = entryHead(content);
  const sealed: MarketplaceLogEntry = Object.freeze({ ...content, head });
  return { log: Object.freeze([...prior, sealed]) };
}

/**
 * Verifies the FULL chain: every entry's head recomputes, every
 * prior-head link is intact, seq is contiguous from 0, and every
 * record digest matches a retained record (the current record for
 * map-held kinds; the matching VERSION for purchase kinds). Any tamper
 * is the typed `chain_mismatch`.
 */
export function verifyMarketplaceChain(state: MarketplaceState): MarketplaceResult<void> {
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
      return fail('chain_mismatch', `log entry ${index} (${entry.kind}) references record ${entry.recordId} which is absent from the marketplace — history was hidden`, `log[${index}].recordId`);
    }
    if (stableDigestJson(record) !== entry.recordDigest) {
      return fail('chain_mismatch', `log entry ${index} pins record ${entry.recordId} at digest ${entry.recordDigest} but the retained record digests to ${stableDigestJson(record)} — the record was rewritten`, `log[${index}].recordDigest`);
    }
  }
  return ok(undefined);
}

/** Resolves the retained record a log entry references (purchase kinds resolve to their matching VERSION). */
function recordOf(state: MarketplaceState, entry: MarketplaceLogEntry): unknown {
  switch (entry.kind) {
    case 'listing-published':
    case 'listing-revised':
      return state.listingsById.get(entry.recordId);
    case 'listing-retired': {
      // The retirements map is keyed by SLOT; the log cites the
      // retirement's OWN content-addressed id — resolve by scan (the
      // chain's record-digest leg must find the retained record).
      for (const retirement of state.retirements.values()) {
        if (retirement.retirementId === entry.recordId) return retirement;
      }
      return undefined;
    }
    case 'purchase-opened':
    case 'purchase-bound':
    case 'purchase-voided': {
      const versions = state.purchaseVersions.get(entry.recordId);
      if (versions === undefined) return undefined;
      // The log pins the exact bytes: the version whose digest equals the entry's is the record.
      return versions.find((version) => stableDigestJson(version) === entry.recordDigest) ?? versions[0];
    }
    case 'purchase-settled':
      return state.settlements.get(entry.recordId);
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Serialization (byte-deterministic)
// ---------------------------------------------------------------------------

/** The plain serializable view of a marketplace (canonical-JSON-ready; insertion order — deterministic for the same op sequence). */
export interface MarketplaceView {
  readonly tenantId: string;
  readonly listingHistory: readonly MarketplaceListing[];
  readonly retirements: readonly ListingRetirement[];
  readonly purchases: readonly PurchaseOrder[];
  readonly settlements: readonly Settlement[];
  readonly log: readonly MarketplaceLogEntry[];
}

/** The plain serializable view. */
export function marketplaceView(state: MarketplaceState): MarketplaceView {
  return {
    tenantId: state.tenantId,
    listingHistory: state.listingHistory,
    retirements: [...state.retirements.values()],
    purchases: [...state.purchases.values()],
    settlements: [...state.settlements.values()],
    log: state.log,
  };
}

/** Serializes the marketplace to canonical JSON bytes (the determinism anchor, L9). */
export function serializeMarketplace(state: MarketplaceState): string {
  return canonicalJson(marketplaceView(state));
}

/** The marketplace's stable digest (over the canonical serialization). */
export function marketplaceDigest(state: MarketplaceState): string {
  return stableDigestJson(marketplaceView(state));
}

// ---------------------------------------------------------------------------
// Internal helpers (the L12 gate + the next-state builder)
// ---------------------------------------------------------------------------

/** The L12 gate: every record entering the marketplace carries the marketplace's tenant. */
export function tenantGate(state: MarketplaceState, record: { readonly tenantId: string }, path: string): MarketplaceResult<void> {
  if (record.tenantId !== state.tenantId) {
    return fail('cross_tenant_access', `the record's tenant "${record.tenantId}" is not the marketplace's tenant "${state.tenantId}" — a foreign record never crosses the marketplace boundary (L12)`, path);
  }
  return ok(undefined);
}

/** The next state with one log entry appended and `mutate` applied to the maps. */
export function withEntry(
  state: MarketplaceState,
  kind: MarketplaceLogKind,
  recordId: string,
  record: unknown,
  at: number,
  mutate: (maps: {
    listingsBySlot: Map<string, MarketplaceListing>;
    listingsById: Map<string, MarketplaceListing>;
    listingHistory: MarketplaceListing[];
    retirements: Map<string, ListingRetirement>;
    purchases: Map<string, PurchaseOrder>;
    purchaseVersions: Map<string, readonly PurchaseOrder[]>;
    settlements: Map<string, Settlement>;
  }) => void,
): MarketplaceState {
  const appended = appendEntry(state, kind, recordId, record, at);
  const maps = {
    listingsBySlot: new Map(state.listingsBySlot),
    listingsById: new Map(state.listingsById),
    listingHistory: [...state.listingHistory],
    retirements: new Map(state.retirements),
    purchases: new Map(state.purchases),
    purchaseVersions: new Map(state.purchaseVersions),
    settlements: new Map(state.settlements),
  };
  mutate(maps);
  return deepFreeze({
    tenantId: state.tenantId,
    listingsBySlot: maps.listingsBySlot,
    listingsById: maps.listingsById,
    listingHistory: maps.listingHistory,
    retirements: maps.retirements,
    purchases: maps.purchases,
    purchaseVersions: maps.purchaseVersions,
    settlements: maps.settlements,
    log: appended.log,
  }) as unknown as MarketplaceState;
}

/** Guard: an explicit operation instant (the L4 discipline — every op names its instant). */
export function requireInstant(at: unknown, field: string): MarketplaceResult<number> {
  if (!isTimestampMs(at)) {
    return fail('invalid_timestamp', `the ${field} must be a TimestampMs (explicit — never a wall clock)`, field);
  }
  return ok(at);
}
