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

// ---------------------------------------------------------------------------
// The goal-set surface (W-25D, D-5 — the W-3e seam's create-project records)
// ---------------------------------------------------------------------------

/**
 * The shape one goal-set row round-trips (the create-project input's own
 * goal + constraint set, verbatim; since W-28 (D-8) optionally the LAUNCH
 * WORLD SPECIFICATION the console's kickoff job carried — the payload
 * column is opaque TEXT, so the additive `world` field rides the SAME row
 * with no schema change: the goal-set write the launch's job-spec capture
 * merges into is the row this record describes, and pre-W-28 rows simply
 * carry no `world` (the console degrades to its teaching empty state)).
 */
export interface GoalSetRecord {
  readonly goal: unknown;
  readonly constraintSet: unknown;
  /** The launch world specification (markets/venues/data sources + the world-shaped launch fields), when the kickoff job's spec carried one (W-28, D-8). */
  readonly world?: unknown;
}

/**
 * The goal-set upsert (tenant = param 1 — L12). The payload is the
 * `{ goal, constraintSet, world? }` record as canonical JSON — the records
 * ride the create-project input, and the optional `world` (W-28, D-8) is
 * the launch world specification the kickoff job's spec carried (the
 * payload column is opaque TEXT; no schema change).
 */
export function goalSetPutStatement(scopeTenant: string, projectId: string, goalSet: GoalSetRecord): StoreResult<BuiltStatement> {
  if (!isNonEmptyString(projectId)) return malformed('the goal set lacks projectId');
  return {
    ok: true,
    value: {
      sql: 'INSERT INTO tradrl_project_goals (tenant, project_id, payload) VALUES ($1, $2, $3) ON CONFLICT (tenant, project_id) DO UPDATE SET payload = EXCLUDED.payload',
      params: [scopeTenant, projectId, canonicalJson(goalSet as unknown as JsonValue)],
    },
  };
}

/** The goal-set read (tenant = $1 ALWAYS — a foreign tenant finds nothing, indistinguishably). */
export function goalSetGetStatement(tenant: string, projectId: string): BuiltStatement {
  return { sql: 'SELECT payload FROM tradrl_project_goals WHERE tenant = $1 AND project_id = $2', params: [tenant, projectId] };
}

// ---------------------------------------------------------------------------
// The durable jobs lane (W-27, D-7 — the API-owned job store's persistence)
// ---------------------------------------------------------------------------

/**
 * The job-record upsert (W-27, D-7; tenant = param 1 — L12). The payload is
 * the boundary's own JobRecord (the async pattern's read model) as canonical
 * JSON; the upsert keys on (tenant, job_id) so every mutation — the
 * submission and each transition — replaces the row with the newest record.
 */
export function jobPutStatement(scopeTenant: string, job: unknown): StoreResult<BuiltStatement> {
  if (!isRecord(job)) return malformed('the job record is not an object');
  if (!isNonEmptyString(job.tenant) || job.tenant !== scopeTenant) {
    return { ok: false, error: crossTenantFailure(`the job record's tenant (${String(job.tenant)}) does not match the store's scope tenant — refusing the cross-tenant write`) };
  }
  if (!isNonEmptyString(job.jobId) || !isNonEmptyString(job.project)) return malformed('the job record lacks jobId/project');
  if (!isNonEmptyString(job.status)) return malformed('the job record lacks status');
  if (typeof job.submittedAt !== 'number') return malformed('the job record lacks submittedAt');
  return {
    ok: true,
    value: {
      sql: 'INSERT INTO tradrl_jobs (tenant, project, job_id, submitted_at, status, payload) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant, job_id) DO UPDATE SET project = EXCLUDED.project, submitted_at = EXCLUDED.submitted_at, status = EXCLUDED.status, payload = EXCLUDED.payload',
      params: [scopeTenant, job.project, job.jobId, String(job.submittedAt), job.status, canonicalJson(job as unknown as JsonValue)],
    },
  };
}

/**
 * The jobs-of-project select (W-27, D-7; tenant = $1 ALWAYS). The async
 * pattern's read model serves the record's CURRENT state — no point-in-time
 * predicate by design (the availability law governs the point-in-time reads
 * of the knowledge/outcome lanes; the job store is the machine's own
 * progress surface). Order: submission order.
 */
export function jobListStatement(tenant: string, project: string): BuiltStatement {
  return { sql: 'SELECT payload FROM tradrl_jobs WHERE tenant = $1 AND project = $2 ORDER BY submitted_at', params: [tenant, project] };
}

/** Decode one goal-set row (`{ goal, constraintSet, world? }`); a malformed row is the typed malformed failure. */
function decodeGoalSet(row: readonly unknown[]): StoreResult<GoalSetRecord> {
  const payload = row[0];
  if (typeof payload !== 'string') return malformed('the stored goal set is not text');
  try {
    const value = JSON.parse(payload) as unknown;
    if (!isRecord(value) || !('goal' in value) || !('constraintSet' in value)) return malformed('the stored goal set lacks goal/constraintSet');
    // W-28 (D-8): the optional launch world specification rides the same
    // opaque payload — carried through verbatim when present (the host
    // goal route re-validates it structurally before serving; a malformed
    // world is dropped there, never a decode failure here — pre-W-28 rows
    // never carry the field).
    return { ok: true, value: { goal: value.goal, constraintSet: value.constraintSet, ...('world' in value ? { world: value.world } : {}) } };
  } catch {
    return malformed('the stored goal set is not valid JSON');
  }
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
    // THE INT8-AS-STRING WIRE TRUTH (W-26C, live-proxy proof 2026-10-06):
    // COALESCE(MAX(ordinal),0) over a BIGINT column arrives as a STRING
    // even in array mode ([["1"]] — the proxy's JSON precision guard for
    // int8), or as a number on wire models that decode int8. Both decode;
    // anything else (garbage, empty, non-integer) stays 0 — the fail-open
    // law, never a throw (the append-only log's real collision guard is
    // the PRIMARY KEY, whose violation surfaces as the typed unique-key
    // write failure below, never as a scan throw).
    const maxOrdinal = decodeMaxOrdinal(rows.length > 0 ? (rows[0] ?? [])[0] : undefined);
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

  /**
   * Persist one project's goal set (the create-project input's goal +
   * constraint set — the W-25D seam's create-time records; the REAL control
   * plane reconstructs the project from them at every cold start).
   */
  async putGoalSet(scopeTenant: string, projectId: string, goalSet: GoalSetRecord): Promise<StoreResult<{ readonly stored: true }>> {
    const built = goalSetPutStatement(scopeTenant, projectId, goalSet);
    if (!built.ok) return built;
    const executed = await executeNeonStatement(this.deps.config, built.value.sql, built.value.params, this.fetchLike);
    this.note('putGoalSet', scopeTenant, executed.ok);
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    return { ok: true, value: { stored: true } };
  }

  /** Read one project's goal set; `null` when none is stored (the typed not-found — a foreign tenant finds nothing, indistinguishably). */
  async goalSetOf(tenant: string, projectId: string): Promise<StoreResult<GoalSetRecord | null>> {
    const built = goalSetGetStatement(tenant, projectId);
    const executed = await executeNeonStatement(this.deps.config, built.sql, built.params, this.fetchLike);
    this.note('goalSetOf', tenant, executed.ok);
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    const rows = selectRows(executed.value);
    if (rows.length === 0) return { ok: true, value: null };
    return decodeGoalSet(rows[0] ?? []);
  }

  private note(operation: string, tenant: string, ok: boolean): void {
    this.provenance = { adapter: 'neon', store: 'project-store', operation, tenant, at: this.deps.instants.next(), outcome: ok ? 'ok' : 'degraded' };
  }
}

// ---------------------------------------------------------------------------
// The durable job store (W-27, D-7 — the API-owned job store's persistence
// lane; the seam's write-through + hydration ride these two operations)
// ---------------------------------------------------------------------------

/** The durable job-record store (the async pattern's read model, persisted). */
export class NeonJobStore {
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

  /** Persist one job record (tenant-scoped upsert — the newest record wins). */
  async putJobRecord(scopeTenant: string, job: unknown): Promise<StoreResult<{ readonly stored: true }>> {
    const built = jobPutStatement(scopeTenant, job);
    if (!built.ok) return built;
    const executed = await executeNeonStatement(this.deps.config, built.value.sql, built.value.params, this.fetchLike);
    this.note('putJobRecord', scopeTenant, executed.ok);
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    return { ok: true, value: { stored: true } };
  }

  /** One project's job records, submission order; a malformed payload row is skipped fail-closed (the store never throws). */
  async jobRecordsOf(tenant: string, project: string): Promise<StoreResult<readonly unknown[]>> {
    const built = jobListStatement(tenant, project);
    const executed = await executeNeonStatement(this.deps.config, built.sql, built.params, this.fetchLike);
    this.note('jobRecordsOf', tenant, executed.ok);
    if (!executed.ok) return degraded(executed.error.code, executed.error.message);
    return { ok: true, value: decodeEnvelopes(executed.value) };
  }

  private note(operation: string, tenant: string, ok: boolean): void {
    this.provenance = { adapter: 'neon', store: 'job-store', operation, tenant, at: this.deps.instants.next(), outcome: ok ? 'ok' : 'degraded' };
  }
}

// ---------------------------------------------------------------------------
// The decode helpers (rows of [payload] -> parsed values; typed failure)
// ---------------------------------------------------------------------------

function selectRows(outcome: NeonQueryOutcome): readonly (readonly unknown[])[] {
  return outcome.kind === 'select' ? outcome.rows : [];
}

/**
 * Decode the MAX-ordinal scan's value (W-26C): a NUMBER (wire models that
 * decode int8) or a numeric STRING (the live proxy's int8-as-string truth
 * — `"1"`); a finite non-integer, a non-numeric/empty string, or any other
 * shape stays 0 (fail-open to the existing law — never a throw).
 */
function decodeMaxOrdinal(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0 && /^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return Number.isSafeInteger(parsed) ? parsed : 0;
    }
  }
  return 0;
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
