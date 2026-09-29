// @tradrl/execution-authority — the RoutingTable: WHERE an approved
// order goes — venue/instrument -> adapter descriptor ref + channel
// ref (opaque ids over the T039 descriptors, mirrored).
//
// THE LAW (the Work Order: "RoutingTable: venue/instrument -> adapter
// descriptor ref + channel ref (opaque ids over the T039 descriptors,
// mirrored)."): the table is DECLARED DATA — the gateway resolves the
// routed order's (venue, instrument) pair against it and finds the
// adapter session + channel that carry the translation. An absent pair
// is the typed `unroutable_pair` fact (a null from `routeFor` — the
// gateway converts it into its routing-stage refusal; nothing routes
// by default, the Default-Deny law).
//
// THE MIRROR LAW: the refs are opaque `adapter:`/`chan:`-prefixed ids
// minted over the REAL T039 descriptor identities
// (`BROKER_ADAPTER`/`OMS_EMS_ADAPTER` and `BROKER_ORDER_CHANNEL`/
// `OMS_EMS_ORDER_CHANNEL`). src/interop.test.ts proves the
// decomposition: `adapterDescriptorOf(ref)` equals the REAL descriptor
// identity and `channelOf(ref)` equals the REAL channel name — the
// routing table's refs are true interop, not shape claims.
//
// The table is tenant/project-scoped (L12), unique per (venue,
// instrument) pair, and carries the opacity trip wire like every
// record this package emits.

import { deepFreeze, isNonEmptyString, isRecord } from './primitives';
import { credentialValueViolations } from './credentials';
import type { AdapterDescriptorRef, ChannelRef, InstrumentId, ProjectId, TenantId, VenueId } from './ids';
import { isAdapterDescriptorRef, isChannelRef, isInstrumentId, isProjectId, isTenantId, isVenueId } from './ids';
import type { ExecutionAuthorityResult } from './errors';
import { fail, invalidField, invalidType, ok } from './errors';

// ---------------------------------------------------------------------------
// The route entry
// ---------------------------------------------------------------------------

/** One routing entry: where the (venue, instrument) pair's approved orders go. */
export interface RouteEntry {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  /** The opaque adapter descriptor ref ('adapter:<id>@<version>' — the T039 descriptor identity, mirrored). */
  readonly adapterRef: AdapterDescriptorRef;
  /** The opaque channel ref ('chan:<channel>' — the T039 outbound order-entry channel, mirrored). */
  readonly channelRef: ChannelRef;
}

/** Guard: `RouteEntry`. */
export function isRouteEntry(v: unknown): v is RouteEntry {
  if (!isRecord(v)) return false;
  if (!isVenueId(v.venue)) return false;
  if (!isInstrumentId(v.instrument)) return false;
  if (!isAdapterDescriptorRef(v.adapterRef)) return false;
  if (!isChannelRef(v.channelRef)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The routing table
// ---------------------------------------------------------------------------

/**
 * The tenant-scoped routing table: the declared (venue, instrument) ->
 * (adapter, channel) map. Pairs are unique; an absent pair is
 * unroutable (Default-Deny — `routeFor` returns null, never a
 * best-effort default route).
 */
export interface RoutingTable {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly entries: readonly RouteEntry[];
}

/** Guard: `RoutingTable` (structural). */
export function isRoutingTable(v: unknown): v is RoutingTable {
  if (!isRecord(v)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!Array.isArray(v.entries) || !v.entries.every((x) => isRouteEntry(x))) return false;
  const keys = v.entries.map((x) => `${x.venue}|${x.instrument}`);
  if (new Set(keys).size !== keys.length) return false;
  // The opacity trip wire (the guard half).
  if (credentialValueViolations(v).length > 0) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted routing table: the structural
 * guard, the uniqueness law and the opacity trip wire. On success the
 * table is returned narrowed, deeply frozen.
 */
export function validateRoutingTable(value: unknown, path = 'routingTable'): ExecutionAuthorityResult<RoutingTable> {
  if (!isRecord(value)) {
    return fail('invalid_type', `${path} must be an object`);
  }
  const violations = credentialValueViolations(value);
  if (violations.length > 0) {
    return fail(
      'credential_value_present',
      `${path} embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — this lane carries opaque refs only, never values`,
    );
  }
  if (!isTenantId(value.tenant)) return fail('invalid_field', `${path}.tenant must be a non-empty tenant scope (L12)`, `${path}.tenant`);
  if (!isProjectId(value.project)) return fail('invalid_field', `${path}.project must be a non-empty project scope (L12/L15)`, `${path}.project`);
  if (!Array.isArray(value.entries)) return fail('invalid_field', `${path}.entries must be a list of route entries`, `${path}.entries`);
  const keys = new Set<string>();
  for (let index = 0; index < value.entries.length; index++) {
    const entry: unknown = value.entries[index];
    if (!isRouteEntry(entry)) {
      return fail('invalid_field', `${path}.entries[${index}] must be { venue, instrument, adapterRef, channelRef } with opaque adapter:/chan: refs`, `${path}.entries[${index}]`);
    }
    const key = `${entry.venue}|${entry.instrument}`;
    if (keys.has(key)) {
      return fail('invalid_field', `${path}.entries[${index}] repeats the (${entry.venue}, ${entry.instrument}) pair — one route per pair`, `${path}.entries[${index}]`);
    }
    keys.add(key);
  }
  return ok(deepFreeze({ tenant: value.tenant, project: value.project, entries: value.entries } as unknown as RoutingTable));
}

// ---------------------------------------------------------------------------
// The lookup (Default-Deny)
// ---------------------------------------------------------------------------

/**
 * Resolve the route for one (venue, instrument) pair — the entry, or
 * null when UNROUTABLE (no declared route; the caller converts the
 * null into its typed routing refusal — nothing routes by default).
 * Pure; the FIRST matching entry wins (entries are unique per pair).
 */
export function routeFor(table: RoutingTable, venue: VenueId, instrument: InstrumentId): RouteEntry | null {
  return table.entries.find((entry) => entry.venue === venue && entry.instrument === instrument) ?? null;
}
