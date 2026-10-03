/**
 * @tradrl/firm-memory-service — THE SERVING SURFACE: the point-in-time
 * knowledge reads T035's autonomous improvement and the research
 * bodies' lookups consume (Work Order T034: "the serving surface
 * downstream consumers read: T035's autonomous improvement and the
 * research bodies' knowledge lookups (point-in-time by instant)").
 *
 * THE CHAIN GATE: every serving call verifies BOTH chains first — a
 * tampered brain (an edited/removed/reordered knowledge entry or
 * contradiction) NEVER serves (the typed `chain_mismatch`).
 *
 * THE L12 LAW (R25 tenant isolation): every query DECLARES its
 * tenant/project scope:
 *   - foreign-scope records are NEVER returned by list queries;
 *   - a point read (knowledgeId) of a foreign-TENANT record is the
 *     typed `cross_tenant_access` naming both scopes (never a silent
 *     miss, never a payload leak);
 *   - a point read of a same-tenant/foreign-PROJECT record is the
 *     typed `tenant_mismatch` (the project scope is L15 continuity —
 *     the read is scoped, and the mismatch is visible).
 *
 * THE L4 LAW (point-in-time truth — no lookahead in serving):
 *   - a knowledge entry stamped after the query instant is INVISIBLE
 *     in list queries (the future is never returned);
 *   - a point read of a future-stamped entry is the typed
 *     `l4_boundary_violation` (defense in depth: you asked for
 *     knowledge that did not exist at T).
 *
 * THE PROJECTION (deterministic): among the visible entries of each
 * family, the WINNER is the highest evidenceCount, then the latest
 * asOf, then the highest ordinal; the served envelope carries the
 * status (`active` — the validity window covers T and the entry wins
 * its family; `superseded` — a later winner exists; `decayed` — the
 * validity window has passed) and the `supersededBy` pointer.
 * `activeOnly` (default true) serves only active knowledge; false
 * serves the visible history within the serving policy's retention
 * window (retention NEVER deletes — the logs are append-only).
 */

import {
  claimFamilyKey,
  deepFreeze,
  fail,
  familyWinnerId,
  isClaimPolarity,
  isDecisionDimensionMirror,
  isFirmKnowledgeId,
  isKnowledgeKind,
  isLagBand,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  isUnitIntervalDecimal,
  knowledgeStatusAt,
  ok,
  servingVisibilityWindow,
  unitIntervalCompare,
  validateServingPolicy,
  verifyContradictionChain,
  verifyFirmKnowledgeChain,
  withinServingWindow,
  type ContradictionQuery,
  type ContradictionRecord,
  type FirmMemoryResult,
  type FirmKnowledgeRecord,
  type KnowledgeQuery,
  type KnowledgeQueryOptions,
  type ServedKnowledge,
  type ServingPolicy,
  type TimestampMs,
} from './imports';
import { isFirmMemoryState } from './state';
import type { FirmMemoryState } from './state';

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

/** Validate a declared scope (a query without a scope is inexpressible — L12). */
function requireScope(query: unknown): FirmMemoryResult<never> | null {
  if (!isRecord(query)) return fail('invalid_type', 'the query must be an object');
  if (!isNonEmptyString(query.tenant)) return fail('invalid_field', 'the query declares its tenant scope (L12/R25 — unscoped reads are inexpressible)', 'tenant');
  if (!isNonEmptyString(query.project)) return fail('invalid_field', 'the query declares its project scope (L15 — unscoped reads are inexpressible)', 'project');
  return null;
}

/** The parsed query options (requireOptions' success product). */
interface ParsedOptions {
  readonly ok: true;
  readonly at: TimestampMs;
  readonly retention: ServingPolicy;
  readonly activeOnly: boolean;
}

/** Validate the query options: the injected instant + the serving policy + the projection switch. */
function requireOptions(options: unknown): FirmMemoryResult<never> | ParsedOptions {
  if (!isRecord(options)) return fail('invalid_type', 'the query options must be an object { at, retention, activeOnly? }');
  if (!isTimestampMs(options.at)) return fail('invalid_field', 'the query carries its injected instant (at) — no ambient clock', 'at');
  const retention = validateServingPolicy(options.retention);
  if (!retention.ok) return retention as FirmMemoryResult<never>;
  const activeOnly = options.activeOnly === undefined ? true : options.activeOnly;
  if (typeof activeOnly !== 'boolean') return fail('invalid_field', 'activeOnly is a boolean (default true — only active knowledge serves)', 'activeOnly');
  return { ok: true, at: options.at, retention: retention.value, activeOnly };
}

/** The chain gate: verify BOTH chains — a tampered brain never serves. */
function requireVerifiedBrain(brain: FirmMemoryState): FirmMemoryResult<never> | null {
  if (!verifyFirmKnowledgeChain(brain.knowledgeLog)) {
    return fail('chain_mismatch', 'the knowledge chain fails verification — a knowledge entry was edited, removed (hidden), spliced or reordered; a tampered brain never serves');
  }
  if (!verifyContradictionChain(brain.contradictionLog)) {
    return fail('chain_mismatch', 'the contradiction register fails verification — a contradiction was edited, removed (hidden) or reordered; a tampered brain never serves');
  }
  return null;
}

// ---------------------------------------------------------------------------
// The knowledge query (the list surface)
// ---------------------------------------------------------------------------

/**
 * Query the firm knowledge at an injected instant (L4: future entries
 * are invisible; L12: foreign-scope records are never returned).
 * The result is deterministic: the served entries in chain-ordinal
 * order, each with its projection verdict. When `knowledgeId` is set
 * the query becomes a point read with the defense-in-depth typed
 * errors (cross_tenant_access / tenant_mismatch / l4_boundary_violation
 * — never a silent miss) and the activeOnly filter is bypassed (the
 * caller asked for the exact entry; its status is reported).
 */
export function queryFirmKnowledge(state: unknown, query: KnowledgeQuery, options: KnowledgeQueryOptions): FirmMemoryResult<readonly ServedKnowledge[]> {
  if (!isFirmMemoryState(state)) return fail('invalid_type', 'queryFirmKnowledge requires a valid firm-memory state');
  const brain = state as FirmMemoryState;
  const scopeError = requireScope(query);
  if (scopeError !== null) return scopeError;
  const optionsResult = requireOptions(options);
  if (!optionsResult.ok) return optionsResult;
  const { at, retention, activeOnly } = optionsResult as ParsedOptions;

  // --- The chain gate (a tampered brain never serves) ------------------------------------
  const chainError = requireVerifiedBrain(brain);
  if (chainError !== null) return chainError;

  // --- The optional filters' closed-vocabulary gates ---------------------------------------
  if (query.kinds !== undefined) {
    if (!Array.isArray(query.kinds) || !query.kinds.every((kind) => isKnowledgeKind(kind))) {
      return fail('unknown_knowledge_kind', 'query.kinds carries a foreign kind — the vocabulary is closed: decision_pattern | market_behavior | model_calibration | data_latency', 'kinds');
    }
  }
  if (query.polarity !== undefined && !isClaimPolarity(query.polarity)) {
    return fail('unknown_polarity', `query.polarity ${JSON.stringify(query.polarity)} is not a claim polarity — the vocabulary is closed`, 'polarity');
  }
  if (query.dimension !== undefined && !isDecisionDimensionMirror(query.dimension)) {
    return fail('invalid_field', `query.dimension ${JSON.stringify(query.dimension)} is not a decision dimension — the vocabulary is closed (timing, sizing, selection, price, risk_calibration, unresolved)`, 'dimension');
  }
  if (query.lagBand !== undefined && !isLagBand(query.lagBand)) {
    return fail('unknown_lag_band', `query.lagBand ${JSON.stringify(query.lagBand)} is not a lag band — the vocabulary is closed (sub_second, seconds, minutes, hours_plus)`, 'lagBand');
  }
  if (query.minConfidence !== undefined) {
    if (typeof query.minConfidence === 'number' || typeof query.minConfidence !== 'string' || !isUnitIntervalDecimal(query.minConfidence)) {
      return fail('confidence_incoherent', `query.minConfidence ${JSON.stringify(query.minConfidence)} is not a canonical unit-interval decimal`, 'minConfidence');
    }
  }
  if (query.minEvidenceCount !== undefined && (typeof query.minEvidenceCount !== 'number' || !Number.isSafeInteger(query.minEvidenceCount) || query.minEvidenceCount < 1)) {
    return fail('invalid_field', 'query.minEvidenceCount must be a positive safe integer', 'minEvidenceCount');
  }
  if (query.knowledgeId !== undefined && !isFirmKnowledgeId(query.knowledgeId)) {
    return fail('invalid_field', `query.knowledgeId ${JSON.stringify(query.knowledgeId)} must be an fkr:-prefixed knowledge id`, 'knowledgeId');
  }

  // --- The point read's defense-in-depth laws (L12 + L4 — never a silent miss) ------------------
  if (query.knowledgeId !== undefined) {
    const target = brain.knowledgeLog.records.find((record) => record.knowledgeId === query.knowledgeId);
    if (target === undefined) {
      return fail('invalid_field', `no firm-knowledge record carries id ${query.knowledgeId} — the chain holds ${brain.knowledgeLog.records.length} entries`, 'knowledgeId');
    }
    if (target.tenant !== (query as { tenant: string }).tenant) {
      return fail(
        'cross_tenant_access',
        `knowledge entry ${target.knowledgeId} belongs to tenant ${JSON.stringify(target.tenant)} but the query declares tenant ${JSON.stringify((query as { tenant: string }).tenant)} — a read that would cross a tenant boundary is the typed isolation crime (R25/L12); the record is never returned`,
        'knowledgeId',
      );
    }
    if (target.project !== (query as { project: string }).project) {
      return fail(
        'tenant_mismatch',
        `knowledge entry ${target.knowledgeId} belongs to project ${JSON.stringify(target.project)} but the query declares project ${JSON.stringify((query as { project: string }).project)} — the project scope is L15 continuity; the mismatch is visible, the record is not returned`,
        'knowledgeId',
      );
    }
    if ((target.asOf as number) > (at as number)) {
      return fail(
        'l4_boundary_violation',
        `knowledge entry ${target.knowledgeId} was promoted at ${String(target.asOf)}, AFTER the query instant ${String(at)} — you asked for knowledge that did not exist at T (the future is never returned, not even by id — L4)`,
        'knowledgeId',
      );
    }
  }

  // --- The visibility laws (L4 + retention) ------------------------------------------------------
  const window = servingVisibilityWindow(retention, at);
  const visible = brain.knowledgeLog.records.filter((record) =>
    record.tenant === (query as { tenant: string }).tenant
    && record.project === (query as { project: string }).project // L12: foreign-scope records never return
    && (record.asOf as number) <= (at as number) // L4: the future is invisible
    && withinServingWindow(record.asOf, window), // the retention horizon (NEVER a deletion)
  );

  // --- The family projection (deterministic: evidenceCount, then asOf, then ordinal) ---------------
  const winners = new Map<string, string>();
  {
    const families = new Map<string, FirmKnowledgeRecord[]>();
    for (const record of visible) {
      const family = claimFamilyKey(record.claim, { tenant: record.tenant, project: record.project });
      const list = families.get(family) ?? [];
      list.push(record);
      families.set(family, list);
    }
    for (const [family, records] of families) {
      const winner = familyWinnerId(records);
      if (winner !== null) winners.set(family, winner);
    }
  }

  // --- The serving envelopes (the point read bypasses activeOnly — the status is reported) ----------
  const served: ServedKnowledge[] = [];
  for (const record of visible) {
    if (query.knowledgeId !== undefined && record.knowledgeId !== query.knowledgeId) continue;
    if (query.kinds !== undefined && !query.kinds.includes(record.claim.kind)) continue;
    if (query.polarity !== undefined && record.claim.polarity !== query.polarity) continue;
    if (query.dimension !== undefined && record.claim.dimension !== query.dimension) continue;
    if (query.lagBand !== undefined && record.claim.lagBand !== query.lagBand) continue;
    if (query.minEvidenceCount !== undefined && record.evidenceCount < query.minEvidenceCount) continue;
    if (query.minConfidence !== undefined && unitIntervalCompare(record.confidence, query.minConfidence) < 0) continue;
    const family = claimFamilyKey(record.claim, { tenant: record.tenant, project: record.project });
    const verdict = knowledgeStatusAt(record, winners.get(family) ?? null, at);
    const isPointRead = query.knowledgeId !== undefined;
    if (activeOnly && !isPointRead && verdict.status !== 'active') continue;
    served.push(deepFreeze({ record, status: verdict.status, supersededBy: verdict.supersededBy }));
  }
  return ok(served);
}

// ---------------------------------------------------------------------------
// The point read (the T035/research surface's by-id lookup)
// ---------------------------------------------------------------------------

/**
 * Read ONE knowledge entry at an injected instant — the point-read
 * surface with the full defense-in-depth: `cross_tenant_access` on a
 * foreign tenant (naming both scopes); `tenant_mismatch` on a foreign
 * project; `l4_boundary_violation` on a future-stamped entry;
 * `invalid_field` on an unknown id. The status is always reported
 * (active/superseded/decayed).
 */
export function getKnowledgeAt(state: unknown, query: KnowledgeQuery, options: KnowledgeQueryOptions): FirmMemoryResult<ServedKnowledge> {
  if (!isFirmMemoryState(state)) return fail('invalid_type', 'getKnowledgeAt requires a valid firm-memory state');
  if (query.knowledgeId === undefined || !isFirmKnowledgeId(query.knowledgeId)) {
    return fail('invalid_field', 'getKnowledgeAt requires the exact fkr: knowledge id (the point read)', 'knowledgeId');
  }
  const list = queryFirmKnowledge(state, query, options);
  if (!list.ok) return list;
  const first = list.value[0];
  if (first === undefined) {
    return fail('invalid_field', `no firm-knowledge record carries id ${query.knowledgeId} — the point read is exact`, 'knowledgeId');
  }
  return ok(first);
}

// ---------------------------------------------------------------------------
// The contradiction query (the contested-knowledge surface)
// ---------------------------------------------------------------------------

/**
 * Query the contradiction register at an injected instant (L12:
 * scope-pure; L4: future contests are invisible; the chain gate: a
 * tampered register never serves). Deterministic: the contests in
 * register-ordinal order.
 */
export function queryContradictions(state: unknown, query: ContradictionQuery, options: KnowledgeQueryOptions): FirmMemoryResult<readonly ContradictionRecord[]> {
  if (!isFirmMemoryState(state)) return fail('invalid_type', 'queryContradictions requires a valid firm-memory state');
  const brain = state as FirmMemoryState;
  const scopeError = requireScope(query);
  if (scopeError !== null) return scopeError;
  const optionsResult = requireOptions(options);
  if (!optionsResult.ok) return optionsResult;
  const { at, retention } = optionsResult as ParsedOptions;
  const chainError = requireVerifiedBrain(brain);
  if (chainError !== null) return chainError;
  if (query.claimKey !== undefined && !isNonEmptyString(query.claimKey)) {
    return fail('invalid_field', 'query.claimKey must be a non-empty family key (claimFamilyKey)', 'claimKey');
  }
  if (query.polarity !== undefined && !isClaimPolarity(query.polarity)) {
    return fail('unknown_polarity', `query.polarity ${JSON.stringify(query.polarity)} is not a claim polarity — the vocabulary is closed`, 'polarity');
  }
  const window = servingVisibilityWindow(retention, at);
  const results = brain.contradictionLog.records.filter((record) =>
    record.tenant === (query as { tenant: string }).tenant
    && record.project === (query as { project: string }).project // L12
    && (record.asOf as number) <= (at as number) // L4
    && withinServingWindow(record.asOf, window),
  );
  return ok(results
    .filter((record) => query.claimKey === undefined || record.claimKey === query.claimKey)
    .filter((record) => query.polarity === undefined || record.sides.some((side) => side.polarity === query.polarity)));
}
