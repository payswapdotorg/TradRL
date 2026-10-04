// deploy/adapters/neon/stores.ts — the durable Postgres-backed stores
// over the Neon SQL-over-HTTP client (T052, W-3b).
//
// THE L12 LAW IN SHARED INFRASTRUCTURE: every SELECT/INSERT these
// stores issue carries `tenant = $1` as the FIRST bind parameter — the
// tenant predicate is STRUCTURAL (the exported statement builders are
// pure and test-scanned; a store statement without the tenant scope is
// inexpressible). A write whose record tenant disagrees with the
// caller's scope tenant is the typed `cross_tenant_access` failure; a
// read under a foreign tenant finds NOTHING (the indistinguishable
// not-found — fail-closed). No value is ever SQL-interpolated — every
// dynamic value is a $n bind parameter.
//
// R46 DEGRADATION: every provider failure (unreachable / HTTP / SQL /
// malformed) is the typed StoreFailure — the stores NEVER throw; the
// T041 pipeline maps them to the typed 503 `unavailable`.
//
// Records round-trip as CANONICAL JSON TEXT (L9: identical inputs ->
// identical bytes — the payload digests are stable); the extracted
// columns exist only for scoping, filtering and ordering. Instants are
// INJECTED (no ambient clock); provenance is recorded per operation
// (observable, never secret).

import { executeNeonStatement, type NeonConfig, type NeonQueryOutcome } from './client';
import type {
  FirmMemoryStoreMirror,
  KnowledgeQueryMirror,
  KnowledgeQueryOptionsMirror,
  OutcomeLearningStoreMirror,
  OutcomeQueryMirror,
  OutcomeQueryOptionsMirror,
  PostMortemQueryMirror,
  ProjectStoreMirror,
  ServedKnowledgeMirror,
} from './mirrors';
import {
  canonicalJson,
  crossTenantFailure,
  fnv1a32Hex,
  isNonEmptyString,
  isRecord,
  type AdapterProvenance,
  type FetchLike,
  type InstantSourceMirror,
  type JsonValue,
  type StoreFailure,
  type StoreResult,
} from '../shared';

// ---------------------------------------------------------------------------
// The shared store core (config + injected fetch/instants + provenance)
// ---------------------------------------------------------------------------

/** The dependencies every Neon store consumes (all injected, never ambient). */
export interface NeonStoreDeps {
  readonly config: NeonConfig;
  readonly fetchLike?: FetchLike;
  /** The injected instant source (bookkeeping instants; the records carry their own asOf). */
  readonly instants: InstantSourceMirror;
}

/** The default injected fetch (platform fetch, resolved lazily so tests never hit the network). */
function defaultFetch(): FetchLike {
  const fetchGlobal = (globalThis as { fetch?: unknown }).fetch;
  if (typeof fetchGlobal !== 'function') {
    return async () => {
      throw new Error('no fetch implementation is available in this runtime');
    };
  }
  return fetchGlobal as FetchLike;
}

/** One built statement (pure output — the determinism-vector surface). */
export interface BuiltStatement {
  readonly sql: string;
  readonly params: readonly string[];
}

// ---------------------------------------------------------------------------
// The statement builders (PURE — pinned vectors + the L12 tenant scan)
// ---------------------------------------------------------------------------

/** The knowledge upsert (envelope fields extracted from the record; the tenant is param 1). */
export function knowledgePutStatement(scopeTenant: string, envelope: ServedKnowledgeMirror & { readonly record: unknown }): StoreResult<BuiltStatement> {
  const record = envelope.record;
  if (!isRecord(record)) return malformed('the knowledge record is not an object');
  if (!isNonEmptyString(record.tenant) || record.tenant !== scopeTenant) {
    return { ok: false, error: crossTenantFailure(`the knowledge record's tenant (${String(record.tenant)}) does not match the store's scope tenant — refusing the cross-tenant write`) };
  }
  if (!isNonEmptyString(record.knowledgeId) || !isNonEmptyString(record.project)) return malformed('the knowledge record lacks knowledgeId/project');
  if (typeof record.ordinal !== 'number' || typeof record.asOf !== 'number') return malformed('the knowledge record lacks ordinal/asOf');
  return {
    ok: true,
    value: {
      sql: 'INSERT INTO tradrl_knowledge (tenant, project, knowledge_id, ordinal, status, as_of, payload) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant, knowledge_id) DO UPDATE SET project = EXCLUDED.project, ordinal = EXCLUDED.ordinal, status = EXCLUDED.status, as_of = EXCLUDED.as_of, payload = EXCLUDED.payload',
      params: [
        scopeTenant,
        record.project,
        record.knowledgeId,
        String(record.ordinal),
        envelope.status,
        String(record.asOf),
        canonicalJson(envelope as unknown as JsonValue),
      ],
    },
  };
}

/** The knowledge select (tenant = $1 ALWAYS; point-in-time: as_of <= the query instant; L4). */
export function knowledgeSelectStatement(query: KnowledgeQueryMirror, options: KnowledgeQueryOptionsMirror): BuiltStatement {
  const params: string[] = [query.tenant, query.project];
  let sql = 'SELECT payload FROM tradrl_knowledge WHERE tenant = $1 AND project = $2';
  if (options.activeOnly === true) {
    sql += ' AND status = $3';
    params.push('active');
  }
  if (query.knowledgeId !== undefined) {
    sql += ` AND knowledge_id = $${params.length + 1}`;
    params.push(query.knowledgeId);
  }
  sql += ` AND as_of <= $${params.length + 1}`;
  params.push(String(options.at));
  sql += ' ORDER BY ordinal';
  return { sql, params };
}

/** The outcome upsert. */
export function outcomePutStatement(scopeTenant: string, table: 'tradrl_outcomes' | 'tradrl_post_mortems', record: unknown, idOf: (record: Record<string, unknown>) => StoreResult<{ id: string; ordinal: number; project: string; classRef: string; decisionRef: string }>): StoreResult<BuiltStatement> {
  if (!isRecord(record)) return malformed('the record is not an object');
  if (!isNonEmptyString(record.tenant) || record.tenant !== scopeTenant) {
    return { ok: false, error: crossTenantFailure(`the record's tenant (${String(record.tenant)}) does not match the store's scope tenant — refusing the cross-tenant write`) };
  }
  const extracted = idOf(record);
  if (!extracted.ok) return extracted;
  const idColumn = table === 'tradrl_outcomes' ? 'outcome_id' : 'post_mortem_id';
  const classColumn = table === 'tradrl_outcomes' ? 'outcome_class' : 'attribution_class';
  return {
    ok: true,
    value: {
      sql: `INSERT INTO ${table} (tenant, project, ${idColumn}, ordinal, ${classColumn}, decision_ref, as_of, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (tenant, ${idColumn}) DO UPDATE SET project = EXCLUDED.project, ordinal = EXCLUDED.ordinal, ${classColumn} = EXCLUDED.${classColumn}, decision_ref = EXCLUDED.decision_ref, as_of = EXCLUDED.as_of, payload = EXCLUDED.payload`,
      params: [scopeTenant, extracted.value.project, extracted.value.id, String(extracted.value.ordinal), extracted.value.classRef, extracted.value.decisionRef, String(record.asOf ?? 0), canonicalJson(record as unknown as JsonValue)],
    },
  };
}

/** The outcome/post-mortem select (tenant = $1 ALWAYS). */
export function outcomeSelectStatement(table: 'tradrl_outcomes' | 'tradrl_post_mortems', query: OutcomeQueryMirror | PostMortemQueryMirror): BuiltStatement {
  const params: string[] = [query.tenant, query.project];
  let sql = `SELECT payload FROM ${table} WHERE tenant = $1 AND project = $2`;
  if (query.decisionRef !== undefined) {
    sql += ` AND decision_ref = $${params.length + 1}`;
    params.push(query.decisionRef);
  }
  if (table === 'tradrl_outcomes') {
    const outcomeClass = (query as OutcomeQueryMirror).outcomeClass;
    if (outcomeClass !== undefined) {
      sql += ` AND outcome_class = $${params.length + 1}`;
      params.push(outcomeClass);
    }
  }
  const attributionClass = (query as PostMortemQueryMirror).attributionClass;
  if (table === 'tradrl_post_mortems' && attributionClass !== undefined) {
    sql += ` AND attribution_class = $${params.length + 1}`;
    params.push(attributionClass);
  }
  sql += ' ORDER BY ordinal';
  return { sql, params };
}

/** The project upsert. */
export function projectPutStatement(scopeTenant: string, record: unknown): StoreResult<BuiltStatement> {
  if (!isRecord(record)) return malformed('the project record is not an object');
  if (!isNonEmptyString(record.tenantId) || record.tenantId !== scopeTenant) {
    return { ok: false, error: crossTenantFailure(`the project record's tenant (${String(record.tenantId)}) does not match the store's scope tenant — refusing the cross-tenant write`) };
  }
  if (!isNonEmptyString(record.id) || !isNonEmptyString(record.name)) return malformed('the project record lacks id/name');
  const lifecycle = isRecord(record.lifecycle) && isNonEmptyString(record.lifecycle.status) ? record.lifecycle.status : 'unknown';
  if (typeof record.createdAt !== 'number' || typeof record.updatedAt !== 'number') return malformed('the project record lacks createdAt/updatedAt');
  return {
    ok: true,
    value: {
      sql: 'INSERT INTO tradrl_projects (tenant, project_id, name, lifecycle_status, created_at, updated_at, payload) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant, project_id) DO UPDATE SET name = EXCLUDED.name, lifecycle_status = EXCLUDED.lifecycle_status, updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload',
      params: [scopeTenant, record.id, record.name, lifecycle, String(record.createdAt), String(record.updatedAt), canonicalJson(record as unknown as JsonValue)],
    },
  };
}

/** The project select (tenant = $1 ALWAYS — a foreign tenant finds nothing, indistinguishably). */
export function projectGetStatement(tenant: string, projectId: string): BuiltStatement {
  return { sql: 'SELECT payload FROM tradrl_projects WHERE tenant = $1 AND project_id = $2', params: [tenant, projectId] };
}

/** The tenant's whole project list, in creation order. */
export function projectListStatement(tenant: string): BuiltStatement {
  return { sql: 'SELECT payload FROM tradrl_projects WHERE tenant = $1 ORDER BY created_at', params: [tenant] };
}

/** The next event ordinal for one project's append-only log. */
export function projectNextOrdinalStatement(tenant: string, projectId: string): BuiltStatement {
  return { sql: 'SELECT COALESCE(MAX(ordinal), 0) FROM tradrl_project_events WHERE tenant = $1 AND project_id = $2', params: [tenant, projectId] };
}

/** The event append (ordinal assigned by the store from the MAX scan — append-only). */
export function projectEventAppendStatement(input: { readonly tenant: string; readonly projectId: string; readonly event: string; readonly at: number; readonly detail?: unknown }, ordinal: number): BuiltStatement {
  return {
    sql: 'INSERT INTO tradrl_project_events (tenant, project_id, ordinal, event, at, payload) VALUES ($1, $2, $3, $4, $5, $6)',
    params: [input.tenant, input.projectId, String(ordinal), input.event, String(input.at), canonicalJson({ event: input.event, at: input.at, detail: input.detail ?? null } as unknown as JsonValue)],
  };
}

/** The event log read. */
export function projectEventsStatement(tenant: string, projectId: string): BuiltStatement {
  return { sql: 'SELECT payload FROM tradrl_project_events WHERE tenant = $1 AND project_id = $2 ORDER BY ordinal', params: [tenant, projectId] };
}

function malformed(message: string): StoreResult<never> {
  return { ok: false, error: { code: 'malformed_record', message } };
}

// ---------------------------------------------------------------------------
// The firm-memory store (FirmMemoryPort persistence — T034's serving surface)
// ---------------------------------------------------------------------------

/** The durable knowledge store. */
export class NeonFirmMemoryStore implements FirmMemoryStoreMirror {
  private readonly deps: NeonStoreDeps;
  private readonly fetchLike: FetchLike;
  private provenance: AdapterProvenance | null = null;

  constructor(deps: NeonStoreDeps) {
    this.deps = deps;
    this.fetchLike = deps.fetchLike ?? defaultFetch();
  }

  /** The last operation's provenance record (observable, never secret). */
  lastProvenance(): AdapterProvenance | null {
    return this.provenance;
  }

  /** Persist one served-knowledge envelope (tenant-scoped upsert; the record's tenant MUST match the scope — L12). */
  async putKnowledge(scopeTenant: string, envelope: ServedKnowledgeMirror & { readonly record: unknown }): Promise<StoreResult<{ readonly stored: true }>> {
    const built = knowledgePutStatement(scopeTenant, envelope);
    if (!built.ok) return built;
    const executed = await executeNeonStatement(this.deps.config, built.value.sql, built.value.params, this.fetchLike);
    this.recordProvenance('putKnowledge', scopeTenant, executed.ok);
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    return { ok: true, value: { stored: true } };
  }

  /** The point-in-time knowledge query (tenant = param 1; the future is never returned — L4). */
  async queryKnowledge(query: KnowledgeQueryMirror, options: KnowledgeQueryOptionsMirror): Promise<StoreResult<readonly ServedKnowledgeMirror[]>> {
    const built = knowledgeSelectStatement(query, options);
    const executed = await executeNeonStatement(this.deps.config, built.sql, built.params, this.fetchLike);
    this.recordProvenance('queryKnowledge', query.tenant, executed.ok);
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    return { ok: true, value: decodeKnowledgeEnvelopes(executed.value) };
  }
  private recordProvenance(operation: string, tenant: string, ok: boolean): void {
    this.provenance = { adapter: 'neon', store: 'firm-memory', operation, tenant, at: this.deps.instants.next(), outcome: ok ? 'ok' : 'degraded' };
  }
}

// ---------------------------------------------------------------------------
// The outcome-learning store (OutcomeLearningPort persistence)
// ---------------------------------------------------------------------------

/** The durable outcome + post-mortem store. */
export class NeonOutcomeLearningStore implements OutcomeLearningStoreMirror {
  private readonly deps: NeonStoreDeps;
  private readonly fetchLike: FetchLike;
  private provenance: AdapterProvenance | null = null;

  constructor(deps: NeonStoreDeps) {
    this.deps = deps;
    this.fetchLike = deps.fetchLike ?? defaultFetch();
  }

  lastProvenance(): AdapterProvenance | null {
    return this.provenance;
  }

  /** Persist one outcome record (tenant-scoped upsert). */
  async putOutcome(scopeTenant: string, record: unknown): Promise<StoreResult<{ readonly stored: true }>> {
    const built = outcomePutStatement(scopeTenant, 'tradrl_outcomes', record, (candidate) => {
      if (!isNonEmptyString(candidate.outcomeId) || !isNonEmptyString(candidate.project)) return malformed('the outcome record lacks outcomeId/project');
      if (typeof candidate.ordinal !== 'number') return malformed('the outcome record lacks ordinal');
      return { ok: true, value: { id: candidate.outcomeId, ordinal: candidate.ordinal, project: candidate.project, classRef: typeof candidate.outcomeClass === 'string' ? candidate.outcomeClass : 'unknown', decisionRef: isNonEmptyString(candidate.decisionRef) ? candidate.decisionRef : 'unknown' } };
    });
    return this.append(built, 'putOutcome', scopeTenant);
  }

  /** Persist one post-mortem record (tenant-scoped upsert). */
  async putPostMortem(scopeTenant: string, record: unknown): Promise<StoreResult<{ readonly stored: true }>> {
    const built = outcomePutStatement(scopeTenant, 'tradrl_post_mortems', record, (candidate) => {
      if (!isNonEmptyString(candidate.postMortemId) || !isNonEmptyString(candidate.project)) return malformed('the post-mortem record lacks postMortemId/project');
      if (typeof candidate.ordinal !== 'number') return malformed('the post-mortem record lacks ordinal');
      return { ok: true, value: { id: candidate.postMortemId, ordinal: candidate.ordinal, project: candidate.project, classRef: 'unknown', decisionRef: isNonEmptyString(candidate.decisionRef) ? candidate.decisionRef : 'unknown' } };
    });
    return this.append(built, 'putPostMortem', scopeTenant);
  }

  private async append(built: StoreResult<BuiltStatement>, operation: string, tenant: string): Promise<StoreResult<{ readonly stored: true }>> {
    if (!built.ok) return built;
    const executed = await executeNeonStatement(this.deps.config, built.value.sql, built.value.params, this.fetchLike);
    this.provenance = { adapter: 'neon', store: 'outcome-learning', operation, tenant, at: this.deps.instants.next(), outcome: executed.ok ? 'ok' : 'degraded' };
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    return { ok: true, value: { stored: true } };
  }

  /** The outcome query (tenant = param 1). */
  async queryOutcomes(query: OutcomeQueryMirror, options: OutcomeQueryOptionsMirror): Promise<StoreResult<readonly unknown[]>> {
    return this.query('tradrl_outcomes', 'queryOutcomes', outcomeSelectStatement('tradrl_outcomes', query), query, options);
  }

  /** The post-mortem query (tenant = param 1). */
  async queryPostMortems(query: PostMortemQueryMirror, options: OutcomeQueryOptionsMirror): Promise<StoreResult<readonly unknown[]>> {
    return this.query('tradrl_post_mortems', 'queryPostMortems', outcomeSelectStatement('tradrl_post_mortems', query), query, options);
  }

  private async query(table: string, operation: string, built: BuiltStatement, query: OutcomeQueryMirror | PostMortemQueryMirror, options: OutcomeQueryOptionsMirror): Promise<StoreResult<readonly unknown[]>> {
    const executed = await executeNeonStatement(this.deps.config, built.sql, built.params, this.fetchLike);
    this.provenance = { adapter: 'neon', store: 'outcome-learning', operation, tenant: query.tenant, at: this.deps.instants.next(), outcome: executed.ok ? 'ok' : 'degraded' };
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    const records = decodeEnvelopes(executed.value);
    // latestPerOutcome: the newest version per outcome id (the lane's fold — done here, over the tenant-scoped rows only).
    if (table === 'tradrl_outcomes' && options.latestPerOutcome === true) {
      const latest = new Map<string, unknown>();
      for (const record of records) {
        if (isRecord(record) && isNonEmptyString(record.outcomeId)) latest.set(record.outcomeId, record);
      }
      return { ok: true, value: [...latest.values()] };
    }
    return { ok: true, value: records };
  }
}

// ---------------------------------------------------------------------------
// The control-plane project store (the persistence substrate — T007's
// domain law stays in the real control plane; deploy/wire composes)
// ---------------------------------------------------------------------------

/** The durable project-record + lifecycle-event store. */
export class NeonProjectStore implements ProjectStoreMirror {
  private readonly deps: NeonStoreDeps;
  private readonly fetchLike: FetchLike;
  private provenance: AdapterProvenance | null = null;

  constructor(deps: NeonStoreDeps) {
    this.deps = deps;
    this.fetchLike = deps.fetchLike ?? defaultFetch();
  }

  lastProvenance(): AdapterProvenance | null {
    return this.provenance;
  }

  async putProjectRecord(scopeTenant: string, record: unknown): Promise<StoreResult<{ readonly stored: true }>> {
    const built = projectPutStatement(scopeTenant, record);
    if (!built.ok) return built;
    const executed = await executeNeonStatement(this.deps.config, built.value.sql, built.value.params, this.fetchLike);
    this.note('putProjectRecord', scopeTenant, executed.ok);
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    return { ok: true, value: { stored: true } };
  }

  async getProjectRecord(tenant: string, projectId: string): Promise<StoreResult<unknown>> {
    const built = projectGetStatement(tenant, projectId);
    const executed = await executeNeonStatement(this.deps.config, built.sql, built.params, this.fetchLike);
    this.note('getProjectRecord', tenant, executed.ok);
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    const rows = selectRows(executed.value);
    if (rows.length === 0) return { ok: false, error: { code: 'project_not_found', message: `no project ${projectId} is visible to this tenant` } };
    return decodeOne(rows[0] ?? []);
  }

  async projectRecordsOf(tenant: string): Promise<StoreResult<readonly unknown[]>> {
    const built = projectListStatement(tenant);
    const executed = await executeNeonStatement(this.deps.config, built.sql, built.params, this.fetchLike);
    this.note('projectRecordsOf', tenant, executed.ok);
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    return { ok: true, value: decodeEnvelopes(executed.value) };
  }

  async appendProjectEvent(input: { readonly tenant: string; readonly projectId: string; readonly event: string; readonly at: number; readonly detail?: unknown }): Promise<StoreResult<{ readonly ordinal: number }>> {
    if (!isNonEmptyString(input.tenant) || !isNonEmptyString(input.projectId) || !isNonEmptyString(input.event)) {
      return malformed('the lifecycle event lacks tenant/projectId/event');
    }
    // Two-step append: the MAX scan + the INSERT (both tenant-scoped — param 1).
    const scan = projectNextOrdinalStatement(input.tenant, input.projectId);
    const scanned = await executeNeonStatement(this.deps.config, scan.sql, scan.params, this.fetchLike);
    if (!scanned.ok) {
      this.note('appendProjectEvent', input.tenant, false);
      return degraded(scanned.error.code, scanned.error.message);
    }
    const rows = selectRows(scanned.value);
    const maxOrdinal = rows.length > 0 && typeof (rows[0] ?? [])[0] === 'number' ? ((rows[0] ?? [])[0] as number) : 0;
    const ordinal = maxOrdinal + 1;
    const append = projectEventAppendStatement(input, ordinal);
    const executed = await executeNeonStatement(this.deps.config, append.sql, append.params, this.fetchLike);
    this.note('appendProjectEvent', input.tenant, executed.ok);
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    return { ok: true, value: { ordinal } };
  }

  async projectEventsOf(tenant: string, projectId: string): Promise<StoreResult<readonly { readonly event: string; readonly at: number; readonly detail: unknown }[]>> {
    const built = projectEventsStatement(tenant, projectId);
    const executed = await executeNeonStatement(this.deps.config, built.sql, built.params, this.fetchLike);
    this.note('projectEventsOf', tenant, executed.ok);
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    const decoded = decodeEnvelopes(executed.value);
    const events: { event: string; at: number; detail: unknown }[] = [];
    for (const entry of decoded) {
      if (!isRecord(entry) || !isNonEmptyString(entry.event)) continue;
      events.push({ event: entry.event, at: typeof entry.at === 'number' ? entry.at : 0, detail: entry.detail ?? null });
    }
    return { ok: true, value: events };
  }

  private note(operation: string, tenant: string, ok: boolean): void {
    this.provenance = { adapter: 'neon', store: 'project-store', operation, tenant, at: this.deps.instants.next(), outcome: ok ? 'ok' : 'degraded' };
  }
}

// ---------------------------------------------------------------------------
// The decode helpers (rows of [payload] -> parsed values; typed failure)
// ---------------------------------------------------------------------------

function selectRows(outcome: NeonQueryOutcome): readonly (readonly unknown[])[] {
  return outcome.kind === 'select' ? outcome.rows : [];
}

function decodeEnvelopes(outcome: NeonQueryOutcome): readonly unknown[] {
  const values: unknown[] = [];
  for (const row of selectRows(outcome)) {
    const payload = row[0];
    if (typeof payload !== 'string') continue;
    try {
      values.push(JSON.parse(payload) as unknown);
    } catch {
      // A malformed payload row is skipped fail-closed — the store never throws.
    }
  }
  return values;
}

/** Decode served-knowledge envelopes (validated: record + a served status — malformed rows are skipped fail-closed). */
function decodeKnowledgeEnvelopes(outcome: NeonQueryOutcome): readonly ServedKnowledgeMirror[] {
  const envelopes: ServedKnowledgeMirror[] = [];
  for (const value of decodeEnvelopes(outcome)) {
    if (!isRecord(value)) continue;
    if (value.status !== 'active' && value.status !== 'superseded' && value.status !== 'decayed') continue;
    envelopes.push({ record: value.record, status: value.status, supersededBy: typeof value.supersededBy === 'string' ? value.supersededBy : null });
  }
  return envelopes;
}

function decodeOne(row: readonly unknown[]): StoreResult<unknown> {
  const payload = row[0];
  if (typeof payload !== 'string') return malformed('the stored payload is not text');
  try {
    return { ok: true, value: JSON.parse(payload) as unknown };
  } catch {
    return malformed('the stored payload is not valid JSON');
  }
}

function degraded(code: string, message: string): StoreResult<never> {
  // The client's codes are already `neon_*` — passed through verbatim (R46).
  return { ok: false, error: { code, message: `${message} (the store degrades — R46)` } };
}

/** The digest of one statement's SQL (stable — used in tests + provenance tooling). */
export function statementDigest(statement: BuiltStatement): string {
  return fnv1a32Hex(statement.sql);
}

/** Re-export the store-failure type for consumers (the stores' typed surface). */
export type { StoreFailure, StoreResult };
