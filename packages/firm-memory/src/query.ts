/**
 * @tradrl/firm-memory — THE POINT-IN-TIME QUERY CONTRACTS: the shapes
 * downstream consumers read the brain through (Work Order T034: "the
 * point-in-time QUERY contracts (ask the brain only what was knowable
 * at instant T — L4)"), plus the pure serving-projection derivations.
 *
 * THE CONSUMERS: T035's autonomous improvement (which knowledge holds
 * NOW, to decide what to improve) and the research bodies' knowledge
 * lookups (point-in-time by instant — what did the firm know at T, for
 * leakage-free evaluation).
 *
 * THE L4 LAW (serving): a query carries its INJECTED instant `at`; a
 * knowledge entry stamped after `at` is INVISIBLE in list queries and
 * is the typed `l4_boundary_violation` on a point read (defense in
 * depth — you asked for knowledge that did not exist at T; the future
 * is never returned, not even by id).
 *
 * THE L12 LAW (isolation): every query DECLARES its tenant/project
 * scope; a foreign-scope record is never returned, and a point read of
 * a foreign record is the typed `cross_tenant_access` naming both
 * scopes (never a silent miss).
 *
 * THE PROJECTION (pure, deterministic — the service executes it):
 *   - `status` per entry at the query instant: `active` (the validity
 *     window covers T and the entry wins its family), `superseded` (a
 *     later same-family entry won), `decayed` (the validity window has
 *     passed);
 *   - the family WINNER among the visible entries: the highest
 *     evidenceCount, then the latest asOf, then the highest ordinal
 *     (the deterministic tie-breaks);
 *   - `activeOnly` (default true) serves only `active` entries; false
 *     serves the visible history within the serving policy's retention
 *     window (retention NEVER deletes — the logs are append-only).
 */

import { windowCovers, type FirmKnowledgeRecord, type ValidityWindow } from './record';
import type { ContradictionRecord } from './contradiction';
import type { TimestampMs } from './primitives';

// ---------------------------------------------------------------------------
// The query shapes
// ---------------------------------------------------------------------------

/** The knowledge query: the declared scope + the optional filters. */
export interface KnowledgeQuery {
  /** The tenant scope (L12 — a query without a scope is inexpressible). */
  readonly tenant: string;
  /** The project scope (L12/L15). */
  readonly project: string;
  /** Filter by knowledge kind (members of the closed vocabulary). */
  readonly kinds?: readonly string[];
  /** Filter by polarity (the claim's opposing value). */
  readonly polarity?: string;
  /** Filter by decision dimension (decision_pattern claims). */
  readonly dimension?: string;
  /** Filter by lag band (data_latency claims). */
  readonly lagBand?: string;
  /** Filter: only entries with at least this distinct-outcome count. */
  readonly minEvidenceCount?: number;
  /** Filter: only entries with at least this aggregate confidence (canonical unit-interval decimal). */
  readonly minConfidence?: string;
  /** Point read: the exact `fkr:` id (a foreign-scope or future-stamped id is a typed error, never a silent miss). */
  readonly knowledgeId?: string;
}

/** The contradiction-register query: the declared scope + the optional filters. */
export interface ContradictionQuery {
  readonly tenant: string;
  readonly project: string;
  /** Filter by the contested family key (claim.ts claimFamilyKey). */
  readonly claimKey?: string;
  /** Filter: only contests where one side carries this polarity. */
  readonly polarity?: string;
}

/** The query options: the injected instant + the serving policy + the projection switches. */
export interface KnowledgeQueryOptions {
  /** The injected instant (L4 — the future is never returned). */
  readonly at: TimestampMs;
  /** The serving policy (the retention/decay horizon; NEVER a deletion). */
  readonly retention: unknown;
  /** Serve only ACTIVE knowledge (default true — the window-covers-T family winners); false serves the visible history. */
  readonly activeOnly?: boolean;
}

// ---------------------------------------------------------------------------
// The served shapes
// ---------------------------------------------------------------------------

/** One knowledge entry as served at an instant: the record + the projection's verdict. */
export interface ServedKnowledge {
  readonly record: FirmKnowledgeRecord;
  /** The entry's status at the query instant (see module header). */
  readonly status: 'active' | 'superseded' | 'decayed';
  /** The family winner's `fkr:` id when this entry is superseded (null otherwise). */
  readonly supersededBy: string | null;
}

// ---------------------------------------------------------------------------
// The pure serving derivations (the service executes these)
// ---------------------------------------------------------------------------

/**
 * The family winner's id among the VISIBLE entries of one family at
 * the query instant (deterministic: highest evidenceCount, then
 * latest asOf, then highest ordinal). `null` when no entries are
 * visible.
 */
export function familyWinnerId(visibleFamilyEntries: readonly FirmKnowledgeRecord[]): string | null {
  let winner: FirmKnowledgeRecord | null = null;
  for (const entry of visibleFamilyEntries) {
    if (winner === null) {
      winner = entry;
      continue;
    }
    if (entry.evidenceCount > winner.evidenceCount) {
      winner = entry;
      continue;
    }
    if (entry.evidenceCount < winner.evidenceCount) continue;
    if ((entry.asOf as number) > (winner.asOf as number)) {
      winner = entry;
      continue;
    }
    if ((entry.asOf as number) < (winner.asOf as number)) continue;
    if (entry.ordinal > winner.ordinal) winner = entry;
  }
  return winner === null ? null : winner.knowledgeId;
}

/**
 * Derive one entry's serving status at the query instant (pure):
 * `decayed` when the validity window has passed; `superseded` when the
 * family winner (among the VISIBLE entries) is another entry;
 * `active` otherwise (the window covers T AND the entry wins).
 */
export function knowledgeStatusAt(record: FirmKnowledgeRecord, winnerId: string | null, at: TimestampMs): { readonly status: 'active' | 'superseded' | 'decayed'; readonly supersededBy: string | null } {
  if (!windowCovers(record.validity, at)) {
    return { status: 'decayed', supersededBy: winnerId !== null && winnerId !== record.knowledgeId ? winnerId : null };
  }
  if (winnerId !== null && winnerId !== record.knowledgeId) {
    return { status: 'superseded', supersededBy: winnerId };
  }
  return { status: 'active', supersededBy: null };
}

/** `true` iff the contradiction record is visible at the injected instant (L4: the future is never returned). */
export function contradictionVisibleAt(record: ContradictionRecord, at: TimestampMs): boolean {
  return (record.asOf as number) <= (at as number);
}

/** The validity window accessor (the decay check's basis — re-exported convenience). */
export { windowCovers };
export type { ValidityWindow };
