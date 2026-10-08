// deploy/adapters/neon/neon.test.ts — the Neon adapter tests (T052, W-3b).
//
// ALL OFFLINE: a fake Neon SQL-over-HTTP responder behind an injected
// fetch — NO live calls, NO real credentials (the vectors use FIXED
// FAKE values). What is pinned:
//   1. request-construction determinism (URL, headers, body bytes);
//   2. the L12 law: every built statement scopes by `tenant = $1`
//      (param 1), hostile tenants stay bind-parameters, cross-tenant
//      writes are the typed error, foreign reads find nothing;
//   3. R46 degradation: unreachable / HTTP error / malformed body are
//      typed failures — never a throw;
//   4. round-trips: records persist and serve back faithfully;
//   5. the DDL records exist for every table the stores touch.

import { describe, expect, it } from 'vitest';
import { buildNeonRequest, executeNeonStatement, NEON_QUERY_TIMEOUT_MS, neonConnectionString, type NeonConfig } from './client';
import { NEON_DDL_RECORDS } from './schema';
import {
  NeonFirmMemoryStore,
  NeonJobStore,
  NeonOutcomeLearningStore,
  NeonProjectStore,
  goalSetGetStatement,
  goalSetPutStatement,
  jobListStatement,
  jobPutStatement,
  jobsOfTenantStatement,
  knowledgeOfTenantStatement,
  knowledgePutStatement,
  knowledgeSelectStatement,
  outcomePutStatement,
  outcomeRowsOfTenantStatement,
  outcomeSelectStatement,
  projectEventAppendStatement,
  projectEventsOfTenantStatement,
  projectEventsStatement,
  projectGetStatement,
  projectListStatement,
  projectNextOrdinalStatement,
  projectPutStatement,
  projectSessionListStatement,
  statementDigest,
  type BuiltStatement,
} from './stores';
import type { FetchLike, StoreResult } from '../shared';

// ---------------------------------------------------------------------------
// The fixed FAKE configuration (never a real credential)
// ---------------------------------------------------------------------------

const FAKE_CONFIG: NeonConfig = {
  apiHost: 'ep-demo-pooler.us-east-2.aws.neon.tech',
  database: 'neondb',
  apiUser: 'neondb_owner',
  apiKey: 'fake-neon-key-demo',
};

const instants = { next: () => 1_800_300_000_000 };

// ---------------------------------------------------------------------------
// The fake Neon (an in-memory responder over the wire protocol)
// ---------------------------------------------------------------------------

/** One seeded/appended row: the INSERT's bind tuple, per table. */
interface FakeRow {
  readonly table: string;
  readonly params: readonly string[];
}

/** The per-table column map (payload index + ordering index) — mirrors schema.ts. */
const TABLE_SPEC: Readonly<Record<string, { readonly payload: number; readonly order: number }>> = {
  tradrl_knowledge: { payload: 6, order: 3 },
  tradrl_outcomes: { payload: 7, order: 3 },
  tradrl_post_mortems: { payload: 7, order: 3 },
  tradrl_projects: { payload: 6, order: 5 },
  tradrl_project_events: { payload: 5, order: 2 },
  tradrl_project_goals: { payload: 2, order: 1 },
  tradrl_jobs: { payload: 5, order: 3 },
};

interface FakeCall {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly query: string;
  readonly params: readonly string[];
}

function fakeNeon(seed: readonly FakeRow[] = []): { fetchLike: FetchLike; calls: FakeCall[] } {
  const rows: FakeRow[] = [...seed];
  const calls: FakeCall[] = [];
  const responder = (text: string, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  });
  const fetchLike: FetchLike = async (url, init) => {
    const body = typeof init?.body === 'string' ? init.body : '{}';
    const parsed = JSON.parse(body) as { query: string; params: string[] };
    calls.push({ url, headers: init?.headers ?? {}, body, query: parsed.query, params: parsed.params });
    const query = parsed.query;
    const params = parsed.params;
    const insertMatch = /^INSERT INTO (tradrl_\w+)/.exec(query);
    if (insertMatch !== null) {
      // Upsert fidelity (the W-27 note, mirroring the wire smoketest's own
      // W-25D law): an `ON CONFLICT (…) DO UPDATE` replaces the row with the
      // same conflict-key tuple — the same semantics the real SQL has (the
      // durable seam upserts project records, goal sets and, since W-27, job
      // records — a transition replaces the job's row with the newest record).
      const columns = (query.match(/^INSERT INTO \w+ \(([^)]+)\)/)?.[1] ?? '').split(',').map((column) => column.trim());
      const conflict = /ON CONFLICT \(([^)]+)\) DO UPDATE/.exec(query);
      if (conflict !== null) {
        const keyColumns = (conflict[1] ?? '').split(',').map((column) => column.trim());
        const keyOf = (row: FakeRow): string => keyColumns.map((column) => row.params[columns.indexOf(column) === -1 ? row.params.length : columns.indexOf(column)]).join('\u0000');
        const incomingKey = keyColumns.map((column) => params[columns.indexOf(column) === -1 ? params.length : columns.indexOf(column)]).join('\u0000');
        const existing = rows.findIndex((row) => row.table === insertMatch[1] && keyOf(row) === incomingKey);
        if (existing >= 0) rows.splice(existing, 1);
      }
      rows.push({ table: insertMatch[1] as string, params });
      return responder(JSON.stringify({ command: 'INSERT 0 1', rowCount: 1 }));
    }
    // FW-MI-A (MI-D1): the session-listing JOIN — the projects LEFT JOINed
    // with their goal-set rows (one row per project, the goal cell NULL on
    // the LEFT JOIN miss), ordered by created_at (tradrl_projects INSERT
    // param 5 — see TABLE_SPEC's order note; the JOIN reads param 4, the
    // created_at column itself).
    if (/^SELECT p\.payload AS project_payload, g\.payload AS goal_payload FROM tradrl_projects p LEFT JOIN tradrl_project_goals g/.test(query)) {
      const projects = rows.filter((row) => row.table === 'tradrl_projects' && row.params[0] === params[0]);
      const goals = rows.filter((row) => row.table === 'tradrl_project_goals');
      const ordered = [...projects].sort((a, b) => Number(a.params[4]) - Number(b.params[4]));
      const joined = ordered.map((row) => {
        const goal = goals.find((entry) => entry.params[0] === row.params[0] && entry.params[1] === row.params[1]);
        return [row.params[6] ?? null, goal === undefined ? null : goal.params[2] ?? null];
      });
      return responder(JSON.stringify({ fields: [{ name: 'project_payload', typeOID: 25 }, { name: 'goal_payload', typeOID: 25 }], rows: joined }));
    }
    const selectMatch = /^SELECT payload FROM (tradrl_\w+)/.exec(query);
    if (selectMatch !== null) {
      const table = selectMatch[1] as string;
      const spec = TABLE_SPEC[table];
      if (spec === undefined) return responder(JSON.stringify({ message: `fake Neon: unknown table ${table}` }), 500);
      let selected = rows.filter((row) => row.table === table && row.params[0] === params[0]);
      // The scope predicate: `AND project = $2` (knowledge/outcomes/post-mortems) or `AND project_id = $2` (projects/events).
      if (query.includes('AND project = $2') || query.includes('AND project_id = $2')) {
        selected = selected.filter((row) => row.params[1] === params[1]);
      }
      // The knowledge status filter (activeOnly): `AND status = $3` — the row's status is INSERT param 4 (knowledge).
      if (query.includes('AND status = $3')) {
        selected = selected.filter((row) => row.params[4] === params[2]);
      }
      selected = [...selected].sort((a, b) => Number(a.params[spec.order]) - Number(b.params[spec.order]));
      return responder(JSON.stringify({ fields: [{ name: 'payload', typeOID: 25 }], rows: selected.map((row) => [row.params[spec.payload]]) }));
    }
    // W-30 (PROD-504): the tenant-wide batched reads — `SELECT
    // project_id|project, payload FROM <table> WHERE tenant = $1
    // [AND as_of <= $2] ORDER BY project, ordinal|submitted_at`. TWO-cell
    // rows (the owning project + the payload), (project, order) sorted —
    // the live wire's answer to the two-column select, modeled over the
    // same in-memory rows (mirrors the wire smoketest's own branch).
    const tenantWideMatch = /^SELECT (?:project_id|project), payload FROM (tradrl_\w+)/.exec(query);
    if (tenantWideMatch !== null) {
      const table = tenantWideMatch[1] as string;
      const spec = TABLE_SPEC[table];
      if (spec === undefined) return responder(JSON.stringify({ message: `fake Neon: unknown table ${table}` }), 500);
      let scoped = rows.filter((row) => row.table === table && row.params[0] === params[0]);
      if (query.includes('AND as_of <= $2')) {
        scoped = scoped.filter((row) => Number(row.params[5]) <= Number(params[1])); // the knowledge INSERT's as_of column (param 5)
      }
      const sorted = [...scoped].sort((a, b) => (a.params[1] === b.params[1] ? Number(a.params[spec.order]) - Number(b.params[spec.order]) : a.params[1] < b.params[1] ? -1 : 1));
      return responder(JSON.stringify({ fields: [{ name: 'project', typeOID: 25 }, { name: 'payload', typeOID: 25 }], rows: sorted.map((row) => [row.params[1], row.params[spec.payload]]) }));
    }
    if (query.startsWith('SELECT COALESCE(MAX(ordinal)')) {
      const table = 'tradrl_project_events';
      const matching = rows.filter((row) => row.table === table && row.params[0] === params[0] && row.params[1] === params[1]);
      const max = matching.reduce((accumulator, row) => Math.max(accumulator, Number(row.params[2])), 0);
      // W-26C (R3): the fake models the LIVE wire — int8 (BIGINT) columns
      // return as STRINGS even in array mode (the live proxy's JSON
      // precision guard: the Lead's probes answered [["1"]] for
      // COALESCE(MAX(ordinal),0)). The fakes match the live wire, never
      // the adapter's expectations — the number form is exactly the
      // regression that shipped the production incident.
      return responder(JSON.stringify({ fields: [{ name: 'coalesce', typeOID: 20 }], rows: [[String(max)]] }));
    }
    return responder(JSON.stringify({ message: `fake Neon: unhandled statement ${query.slice(0, 40)}` }), 500);
  };
  return { fetchLike, calls };
}

const failingFetch: FetchLike = async () => {
  throw new Error('connection refused (simulated)');
};

// ---------------------------------------------------------------------------
// 1. Request-construction determinism (pinned vectors — FAKE credentials)
// ---------------------------------------------------------------------------

describe('deploy/adapters/neon — the client request determinism', () => {
  it('the connection string is the postgres URL with the percent-encoded secret (pinned vector)', () => {
    expect(neonConnectionString(FAKE_CONFIG)).toBe('postgresql://neondb_owner:fake-neon-key-demo@ep-demo-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require');
    expect(neonConnectionString({ ...FAKE_CONFIG, apiKey: 'p@ss:word/' })).toBe('postgresql://neondb_owner:p%40ss%3Aword%2F@ep-demo-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require');
  });

  it('the SQL-over-HTTP request is byte-pinned: POST {host}/sql, the RAW connection-string header, the driver\'s array-mode + raw-text headers, the JSON body', () => {
    const request = buildNeonRequest(FAKE_CONFIG, 'SELECT payload FROM tradrl_knowledge WHERE tenant = $1', ['tenant-a']);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://ep-demo-pooler.us-east-2.aws.neon.tech/sql');
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers.accept).toBe('application/json');
    // RAW (W-26A): the live proxy parses the header value as a URL and
    // REJECTS the whole-string-encoded form (HTTP 400 "invalid connection
    // string: relative URL without a base"); the reference driver sends
    // the serialized URL verbatim — scheme, ://, @, /, ? all literal.
    expect(request.headers['neon-connection-string']).toBe('postgresql://neondb_owner:fake-neon-key-demo@ep-demo-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require');
    // ARRAY MODE + RAW TEXT OUTPUT (W-26C): the reference driver's other
    // two headers — WITHOUT array-mode the live proxy answers OBJECT-mode
    // rows ("rows":[{"payload":..}]) and every decoder here reads
    // row[0] -> undefined -> EVERY read yields zero values (the direct
    // cause of the 2026-10-06 production incident under durable).
    expect(request.headers['neon-array-mode']).toBe('true');
    expect(request.headers['neon-raw-text-output']).toBe('true');
    expect(request.body).toBe('{"query":"SELECT payload FROM tradrl_knowledge WHERE tenant = $1","params":["tenant-a"]}');
  });

  it('the Neon header set is the reference driver\'s EXACT three — no more, no fewer (W-26C)', () => {
    const request = buildNeonRequest(FAKE_CONFIG, 'SELECT 1', ['x']);
    const neonHeaders = Object.keys(request.headers).filter((name) => name.startsWith('neon-')).sort();
    expect(neonHeaders).toEqual(['neon-array-mode', 'neon-connection-string', 'neon-raw-text-output']);
    // The two mode headers are the driver's literal booleans ('true',
    // lowercase names — HTTP headers are case-insensitive; the live proxy
    // accepts the lowercase forms, probe-proven).
    expect(request.headers['neon-array-mode']).toBe('true');
    expect(request.headers['neon-raw-text-output']).toBe('true');
  });

  it('the RAW header percent-encodes a special-char password WITHIN the string while the structure stays literal (W-26A)', () => {
    // A FAKE password carrying @ : / ? — the URL-structure characters.
    // They MUST appear percent-encoded inside the header value; the
    // postgresql://…@…/…?sslmode=require structure MUST stay literal
    // (WHATWG URL serializer semantics — the live proxy's requirement).
    const request = buildNeonRequest({ ...FAKE_CONFIG, apiKey: 'p@ss:word/?' }, 'SELECT 1', ['x']);
    expect(request.headers['neon-connection-string']).toBe('postgresql://neondb_owner:p%40ss%3Aword%2F%3F@ep-demo-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require');
    // The structure is never outer-encoded (the live 400 repro is pinned
    // by absence): the scheme and separators appear LITERALLY.
    const header = request.headers['neon-connection-string'];
    expect(header.startsWith('postgresql://')).toBe(true);
    expect(header).toContain('@ep-demo-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require');
    expect(header).not.toContain('postgresql%3A');
  });

  it('identical inputs -> identical bytes (L9)', () => {
    const a = buildNeonRequest(FAKE_CONFIG, 'SELECT 1', ['x']);
    const b = buildNeonRequest(FAKE_CONFIG, 'SELECT 1', ['x']);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// 2. The L12 law (tenant = $1 everywhere; typed cross-tenant refusals)
// ---------------------------------------------------------------------------

describe('deploy/adapters/neon — L12 tenant scoping', () => {
  const hostileTenant = "tenant'; DROP TABLE tradrl_knowledge; --";

  it('EVERY built statement scopes by tenant as bind parameter 1 (the battery)', () => {
    const statements: readonly { readonly label: string; readonly statement: BuiltStatement }[] = [
      { label: 'knowledge.put', statement: requireOk(knowledgePutStatement('tenant-a', knowledgeEnvelope('tenant-a', 'fkr:1', 1, 'prj_a'))) },
      { label: 'knowledge.select', statement: knowledgeSelectStatement({ tenant: 'tenant-a', project: 'prj_a' }, { at: 1, retention: null }) },
      { label: 'outcome.put', statement: requireOk(outcomePutStatement('tenant-a', 'tradrl_outcomes', outcomeRecord('tenant-a', 'ocm:1', 1), extractOutcome)) },
      { label: 'outcome.select', statement: outcomeSelectStatement('tradrl_outcomes', { tenant: 'tenant-a', project: 'prj_a' }) },
      { label: 'post-mortem.select', statement: outcomeSelectStatement('tradrl_post_mortems', { tenant: 'tenant-a', project: 'prj_a', attributionClass: 'model-error' }) },
      { label: 'project.put', statement: requireOk(projectPutStatement('tenant-a', projectRecord('tenant-a', 'prj_a'))) },
      { label: 'project.get', statement: projectGetStatement('tenant-a', 'prj_a') },
      { label: 'project.list', statement: projectListStatement('tenant-a') },
      { label: 'event.scan', statement: projectNextOrdinalStatement('tenant-a', 'prj_a') },
      { label: 'event.append', statement: projectEventAppendStatement({ tenant: 'tenant-a', projectId: 'prj_a', event: 'activate', at: 1 }, 1) },
      { label: 'events.read', statement: projectEventsStatement('tenant-a', 'prj_a') },
      { label: 'events.read.tenant-wide', statement: projectEventsOfTenantStatement('tenant-a') },
      { label: 'knowledge.read.tenant-wide', statement: knowledgeOfTenantStatement('tenant-a', Number.MAX_SAFE_INTEGER) },
      { label: 'outcome.read.tenant-wide', statement: outcomeRowsOfTenantStatement('tradrl_outcomes', 'tenant-a') },
      { label: 'post-mortem.read.tenant-wide', statement: outcomeRowsOfTenantStatement('tradrl_post_mortems', 'tenant-a') },
      { label: 'jobs.read.tenant-wide', statement: jobsOfTenantStatement('tenant-a') },
      { label: 'goalset.put', statement: requireOk(goalSetPutStatement('tenant-a', 'prj_a', { goal: { id: 'goal-1' }, constraintSet: { id: 'cs-1' } })) },
      { label: 'goalset.get', statement: goalSetGetStatement('tenant-a', 'prj_a') },
    ];
    expect(statements.length).toBe(18);
    for (const { label, statement } of statements) {
      // The L12 law: the tenant is bind parameter 1 in EVERY statement —
      // `tenant = $1` in reads/scans, `VALUES ($1, ...)` in writes.
      const isInsert = statement.sql.startsWith('INSERT INTO');
      if (isInsert) {
        expect(statement.sql, `${label} must bind the tenant as VALUES param 1`).toMatch(/VALUES \(\$1, /);
      } else {
        expect(statement.sql, `${label} must scope by tenant`).toMatch(/tenant = \$1\b/);
      }
      expect(statement.params[0], `${label} must bind the tenant as param 1`).toBeDefined();
    }
  });

  it('the knowledge select is point-in-time: the as_of predicate is present (L4 — the future is never returned)', () => {
    const statement = knowledgeSelectStatement({ tenant: 'tenant-a', project: 'prj_a' }, { at: 5_000, retention: null });
    expect(statement.sql).toMatch(/AND as_of <= \$\d+/);
    expect(statement.params[statement.params.length - 1]).toBe('5000');
  });

  it('a hostile tenant string is a BIND PARAMETER, never SQL text (no injection surface)', () => {
    const statement = knowledgeSelectStatement({ tenant: hostileTenant, project: 'prj_a' }, { at: 5, retention: null });
    expect(statement.params[0]).toBe(hostileTenant);
    expect(statement.sql.includes(hostileTenant)).toBe(false);
    expect(statement.sql).not.toMatch(/DROP TABLE/);
  });

  it('a write whose record tenant disagrees with the scope is the TYPED cross_tenant_access (L12)', () => {
    const hostile = knowledgePutStatement('tenant-a', knowledgeEnvelope('tenant-b', 'fkr:x', 1, 'prj_b'));
    expect(hostile.ok).toBe(false);
    if (hostile.ok) return;
    expect(hostile.error.code).toBe('cross_tenant_access');
    const project = projectPutStatement('tenant-a', projectRecord('tenant-b', 'prj_b'));
    expect(project.ok).toBe(false);
    if (project.ok) return;
    expect(project.error.code).toBe('cross_tenant_access');
  });

  it('a foreign read finds NOTHING (the indistinguishable not-found — fail-closed)', async () => {
    const fake = fakeNeon([
      { table: 'tradrl_projects', params: ['tenant-a', 'prj_a', 'Own', 'active', '1', '1', JSON.stringify(projectRecord('tenant-a', 'prj_a'))] },
      { table: 'tradrl_projects', params: ['tenant-b', 'prj_b', 'Other', 'active', '1', '1', JSON.stringify(projectRecord('tenant-b', 'prj_b'))] },
    ]);
    const store = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const own = await store.getProjectRecord('tenant-a', 'prj_a');
    expect(own.ok).toBe(true);
    const foreign = await store.getProjectRecord('tenant-a', 'prj_b');
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error.code).toBe('project_not_found');
  });

  it('the tenant filter is enforced end-to-end: a query as tenant-a never serves tenant-b rows', async () => {
    const fake = fakeNeon([
      knowledgeRow('tenant-a', 'fkr:a1', 1),
      knowledgeRow('tenant-a', 'fkr:a2', 2),
      knowledgeRow('tenant-b', 'fkr:b1', 1),
    ]);
    const store = new NeonFirmMemoryStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const served = await store.queryKnowledge({ tenant: 'tenant-a', project: 'prj_a' }, { at: 9_000_000_000_000, retention: null });
    expect(served.ok).toBe(true);
    if (!served.ok) return;
    expect(served.value.length).toBe(2);
    for (const envelope of served.value) {
      expect((envelope.record as { tenant: string }).tenant).toBe('tenant-a');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. R46 degradation (typed failures — never a throw)
// ---------------------------------------------------------------------------

describe('deploy/adapters/neon — R46 graceful degradation', () => {
  it('an unreachable provider is the typed neon_unreachable (never a throw)', async () => {
    const result = await executeNeonStatement(FAKE_CONFIG, 'SELECT 1', [], failingFetch);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('neon_unreachable');
    expect(result.error.message).toContain('could not be reached');
    const store = new NeonFirmMemoryStore({ config: FAKE_CONFIG, fetchLike: failingFetch, instants });
    const served = await store.queryKnowledge({ tenant: 'tenant-a', project: 'prj_a' }, { at: 1, retention: null });
    expect(served.ok).toBe(false);
    if (served.ok) return;
    expect(served.error.code).toBe('neon_unreachable');
    expect(store.lastProvenance()?.outcome).toBe('degraded');
  });

  it('an HTTP 500 with a SQL error body is the typed neon_http_error carrying the server message', async () => {
    const fetchLike: FetchLike = async () => ({ ok: false, status: 500, text: async () => '{"message":"relation \\"tradrl_knowledge\\" does not exist"}' });
    const result = await executeNeonStatement(FAKE_CONFIG, 'SELECT payload FROM tradrl_knowledge', [], fetchLike);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('neon_http_error');
    expect(result.error.message).toContain('relation "tradrl_knowledge" does not exist');
  });

  it('a malformed 200 body is the typed neon_malformed_response', async () => {
    const fetchLike: FetchLike = async () => ({ ok: true, status: 200, text: async () => 'not json at all' });
    const result = await executeNeonStatement(FAKE_CONFIG, 'SELECT 1', [], fetchLike);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('neon_malformed_response');
  });
});

// ---------------------------------------------------------------------------
// 4. Round-trips + semantics
// ---------------------------------------------------------------------------

describe('deploy/adapters/neon — the stores', () => {
  it('knowledge: put -> query round-trips faithfully; activeOnly filters superseded', async () => {
    const fake = fakeNeon();
    const store = new NeonFirmMemoryStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const envelope = knowledgeEnvelope('tenant-a', 'fkr:1', 1, 'prj_a');
    expect((await store.putKnowledge('tenant-a', envelope)).ok).toBe(true);
    const served = await store.queryKnowledge({ tenant: 'tenant-a', project: 'prj_a' }, { at: 9_000_000_000_000, retention: null });
    expect(served.ok).toBe(true);
    if (!served.ok) return;
    expect(served.value.length).toBe(1);
    expect(served.value[0]).toEqual(envelope);
    expect((await store.putKnowledge('tenant-a', { ...knowledgeEnvelope('tenant-a', 'fkr:2', 2, 'prj_a'), status: 'superseded' })).ok).toBe(true);
    const activeOnly = await store.queryKnowledge({ tenant: 'tenant-a', project: 'prj_a' }, { at: 9_000_000_000_000, retention: null, activeOnly: true });
    expect(activeOnly.ok).toBe(true);
    if (activeOnly.ok) expect(activeOnly.value.every((entry) => entry.status === 'active')).toBe(true);
    expect(store.lastProvenance()?.adapter).toBe('neon');
    expect(store.lastProvenance()?.tenant).toBe('tenant-a');
  });

  it('outcomes + post-mortems: put -> query round-trips (both tables route correctly)', async () => {
    const fake = fakeNeon();
    const store = new NeonOutcomeLearningStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    expect((await store.putOutcome('tenant-a', outcomeRecord('tenant-a', 'ocm:1', 1, 'dec:1'))).ok).toBe(true);
    expect((await store.putOutcome('tenant-a', outcomeRecord('tenant-a', 'ocm:2', 2, 'dec:2'))).ok).toBe(true);
    const queried = await store.queryOutcomes({ tenant: 'tenant-a', project: 'prj_a' }, { at: 1, retention: null });
    expect(queried.ok).toBe(true);
    if (queried.ok) expect(queried.value.length).toBe(2);
    expect((await store.putPostMortem('tenant-a', postMortemRecord('tenant-a', 'pmm:1'))).ok).toBe(true);
    const mortems = await store.queryPostMortems({ tenant: 'tenant-a', project: 'prj_a' }, { at: 1, retention: null });
    expect(mortems.ok).toBe(true);
    if (mortems.ok) expect(mortems.value.length).toBe(1);
  });

  it('durable jobs (W-27, D-7): put/list round-trips faithfully in submission order; the newest record wins per job id; foreign tenants find nothing; the statements scope tenant = $1 (L12)', async () => {
    const fake = fakeNeon();
    const store = new NeonJobStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const job = (jobId: string, status: string, submittedAt: number): Record<string, unknown> => ({ jobId, kind: 'research', tenant: 'tenant-a', project: 'prj_a', status, submittedAt, ...(status === 'complete' ? { result: { kind: 'release-candidate' }, completedAt: submittedAt + 1000 } : {}) });
    expect((await store.putJobRecord('tenant-a', job('job:1', 'submitted', 1))).ok).toBe(true);
    expect((await store.putJobRecord('tenant-a', job('job:2', 'running', 2))).ok).toBe(true);
    // The transition upsert: the SAME job id's newest record replaces the row.
    expect((await store.putJobRecord('tenant-a', job('job:1', 'complete', 1))).ok).toBe(true);
    const listed = await store.jobRecordsOf('tenant-a', 'prj_a');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toEqual([job('job:1', 'complete', 1), job('job:2', 'running', 2)]); // submission order, newest payload per id
    // L12: a foreign tenant's read finds NOTHING (the indistinguishable absence).
    const foreign = await store.jobRecordsOf('tenant-b', 'prj_a');
    expect(foreign.ok).toBe(true);
    if (foreign.ok) expect(foreign.value).toEqual([]);
    // L12: a cross-tenant WRITE is the typed refusal (never a queued row).
    const hostile = await store.putJobRecord('tenant-a', job('job:3', 'submitted', 3) as { tenant: string } & Record<string, unknown>);
    expect(hostile.ok).toBe(true); // same-tenant sanity: the write lands
    const cross = await store.putJobRecord('tenant-a', { ...job('job:4', 'submitted', 4), tenant: 'tenant-b' });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.error.code).toBe('cross_tenant_access');
    // Malformed records are the typed malformed_record (fail-closed, never a throw).
    const malformed = await store.putJobRecord('tenant-a', { jobId: 'job:5', tenant: 'tenant-a' });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe('malformed_record');
    // The statement vectors: tenant = $1 ALWAYS, the scope param second.
    const put = jobPutStatement('tenant-a', job('job:v', 'submitted', 9));
    expect(put.ok).toBe(true);
    if (put.ok) {
      expect(put.value.sql).toContain('INSERT INTO tradrl_jobs');
      expect(put.value.sql).toContain('ON CONFLICT (tenant, job_id) DO UPDATE');
      expect(put.value.params[0]).toBe('tenant-a');
      expect(put.value.params[2]).toBe('job:v');
    }
    const select = jobListStatement('tenant-a', 'prj_a');
    expect(select.sql).toBe('SELECT payload FROM tradrl_jobs WHERE tenant = $1 AND project = $2 ORDER BY submitted_at');
    expect(select.params).toEqual(['tenant-a', 'prj_a']);
    expect(store.lastProvenance()?.adapter).toBe('neon');
    expect(store.lastProvenance()?.store).toBe('job-store');
  });

  it('goal sets: put/get round-trip faithfully; absent reads answer null; foreign tenants find nothing (W-25D)', async () => {
    const fake = fakeNeon();
    const store = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const goalSet = { goal: { id: 'goal-tenant-a', version: 1, tenantId: 'tenant-a' }, constraintSet: { id: 'cs-tenant-a', version: 1, tenantId: 'tenant-a' } };
    expect((await store.putGoalSet('tenant-a', 'prj_a', goalSet)).ok).toBe(true);
    const got = await store.goalSetOf('tenant-a', 'prj_a');
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value).toEqual(goalSet);
    const absent = await store.goalSetOf('tenant-a', 'prj_none');
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.value).toBeNull();
    // L12: a foreign tenant's read finds NOTHING (the indistinguishable absence).
    const foreign = await store.goalSetOf('tenant-b', 'prj_a');
    expect(foreign.ok).toBe(true);
    if (foreign.ok) expect(foreign.value).toBeNull();
    // An empty project id is the typed malformed refusal (never a statement without scope).
    const malformed = goalSetPutStatement('tenant-a', '', goalSet);
    expect(malformed.ok).toBe(false);
  });

  it('goal sets with the ADDITIVE launch world (D-8, W-28): the world rides the same opaque payload, round-trips verbatim, and a pre-W-28 row (no world) still decodes', async () => {
    const fake = fakeNeon();
    const store = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const goal = { id: 'goal-tenant-a', version: 1, tenantId: 'tenant-a' };
    const constraintSet = { id: 'cs-tenant-a', version: 1, tenantId: 'tenant-a' };
    const world = {
      markets: ['BTC-USD', 'ETH-USD'], venues: ['binance', 'kraken'], dataSources: ['candle-v1', 'depth-v1'],
      executionMode: 'simulation', capitalBudget: '500000.00', riskBudget: '40000.00',
      horizon: { startsAt: 1, endsAt: 2 },
    };
    // The launch-time write (the create, no world yet) followed by the world-merge write (the kickoff job's capture).
    expect((await store.putGoalSet('tenant-a', 'prj_world', { goal, constraintSet })).ok).toBe(true);
    expect((await store.putGoalSet('tenant-a', 'prj_world', { goal, constraintSet, world })).ok).toBe(true);
    const got = await store.goalSetOf('tenant-a', 'prj_world');
    expect(got.ok).toBe(true);
    if (got.ok && got.value !== null) {
      expect(got.value.goal).toEqual(goal);
      expect(got.value.constraintSet).toEqual(constraintSet);
      expect(got.value.world).toEqual(world); // the additive field round-trips verbatim (the opaque payload law)
    }
    // A pre-W-28 row (written without a world) decodes exactly as before — no fabricated world.
    expect((await store.putGoalSet('tenant-a', 'prj_legacy', { goal, constraintSet })).ok).toBe(true);
    const legacy = await store.goalSetOf('tenant-a', 'prj_legacy');
    expect(legacy.ok).toBe(true);
    if (legacy.ok && legacy.value !== null) expect(legacy.value.world).toBeUndefined();
  });

  it('projects: put/get/list round-trip; the event log appends and reads back in order', async () => {
    const fake = fakeNeon();
    const store = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    expect((await store.putProjectRecord('tenant-a', projectRecord('tenant-a', 'prj_a'))).ok).toBe(true);
    const got = await store.getProjectRecord('tenant-a', 'prj_a');
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value).toEqual(projectRecord('tenant-a', 'prj_a'));
    const listed = await store.projectRecordsOf('tenant-a');
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value.length).toBe(1);
    const first = await store.appendProjectEvent({ tenant: 'tenant-a', projectId: 'prj_a', event: 'activate', at: 5 });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.ordinal).toBe(1);
    const second = await store.appendProjectEvent({ tenant: 'tenant-a', projectId: 'prj_a', event: 'suspend', at: 6 });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.ordinal).toBe(2);
    const events = await store.projectEventsOf('tenant-a', 'prj_a');
    expect(events.ok).toBe(true);
    if (events.ok) expect(events.value.map((event) => event.event)).toEqual(['activate', 'suspend']);
  });

  it('the event log\'s MAX-ordinal scan accepts the int8-as-string live truth (W-26C): "1" -> ordinal 2; a number still decodes; garbage stays 0 (fail-open, never a throw)', async () => {
    // The scan\'s live byte shape: fields + one row carrying the int8
    // value — a STRING on the live proxy (the byte shape [["1"]] for a
    // one-event log), a number on wire models that decode int8, garbage never.
    const scanShapedFetch = (coalesce: unknown): FetchLike => async (_url, init) => {
      const parsed = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { query: string };
      if (parsed.query.startsWith('SELECT COALESCE(MAX(ordinal)')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ fields: [{ name: 'coalesce', typeOID: 20 }], rows: [[coalesce]] }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ command: 'INSERT 0 1', rowCount: 1 }) };
    };
    // THE LIVE PIN: the scan answers "1" (the production probe\'s exact
    // byte shape) -> maxOrdinal 1 -> ordinal 2 (the pre-W-26C typeof-check
    // read 0 here and collided on the append-only PRIMARY KEY — the
    // production 503\'s direct mechanism).
    const liveShaped = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: scanShapedFetch('1'), instants });
    const appended = await liveShaped.appendProjectEvent({ tenant: 'tenant-a', projectId: 'prj_a', event: 'activate', at: 5 });
    expect(appended.ok).toBe(true);
    if (appended.ok) expect(appended.value.ordinal).toBe(2);
    // A number still decodes (the wire-model form the old law accepted).
    const numberShaped = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: scanShapedFetch(1), instants });
    const appendedNumber = await numberShaped.appendProjectEvent({ tenant: 'tenant-a', projectId: 'prj_a', event: 'activate', at: 5 });
    expect(appendedNumber.ok).toBe(true);
    if (appendedNumber.ok) expect(appendedNumber.value.ordinal).toBe(2);
    // Garbage, empty, non-integer and hostile shapes stay 0 -> ordinal 1
    // (fail-open to the existing law — never a throw).
    for (const garbage of ['not-a-number', '', '   ', '1.5', '-1', '0x1', 'NaN', null, undefined, {}, true, []]) {
      const store = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: scanShapedFetch(garbage), instants });
      const appended = await store.appendProjectEvent({ tenant: 'tenant-a', projectId: 'prj_a', event: 'activate', at: 5 });
      expect(appended.ok, `garbage ${JSON.stringify(garbage)} must fail open (never a throw)`).toBe(true);
      if (appended.ok) expect(appended.value.ordinal, `garbage ${JSON.stringify(garbage)} stays 0 -> ordinal 1`).toBe(1);
    }
    // An empty row set stays 0 too (the absent-log shape).
    const emptyRowsFetch: FetchLike = async (_url, init) => {
      const parsed = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { query: string };
      if (parsed.query.startsWith('SELECT COALESCE(MAX(ordinal)')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ fields: [{ name: 'coalesce', typeOID: 20 }], rows: [] }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ command: 'INSERT 0 1', rowCount: 1 }) };
    };
    const emptyLog = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: emptyRowsFetch, instants });
    const appendedEmpty = await emptyLog.appendProjectEvent({ tenant: 'tenant-a', projectId: 'prj_a', event: 'activate', at: 5 });
    expect(appendedEmpty.ok).toBe(true);
    if (appendedEmpty.ok) expect(appendedEmpty.value.ordinal).toBe(1);
  });

  it('a malformed record is the typed malformed_record (fail-closed, never a throw)', () => {
    const result = knowledgePutStatement('tenant-a', { record: { tenant: 'tenant-a' }, status: 'active', supersededBy: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('malformed_record');
  });
});

// ---------------------------------------------------------------------------
// 5. The DDL records (every table the statements touch is covered)
// ---------------------------------------------------------------------------

describe('deploy/adapters/neon — the DDL records', () => {
  it('every table referenced by the statement builders has a DDL record with a tenant-leading PRIMARY KEY', () => {
    const tables = new Set(NEON_DDL_RECORDS.map((record) => record.table));
    expect([...tables].sort()).toEqual(['tradrl_jobs', 'tradrl_knowledge', 'tradrl_outcomes', 'tradrl_post_mortems', 'tradrl_project_events', 'tradrl_project_goals', 'tradrl_projects']);
    for (const record of NEON_DDL_RECORDS) {
      expect(record.ddl).toContain(`CREATE TABLE IF NOT EXISTS ${record.table}`);
      expect(record.ddl).toContain('PRIMARY KEY (tenant');
      expect(record.ddl).toMatch(/tenant\s+TEXT\s+NOT NULL/);
    }
    // Every table the statements reference is covered by a DDL record.
    const referenced = new Set(['tradrl_knowledge', 'tradrl_outcomes', 'tradrl_post_mortems', 'tradrl_projects', 'tradrl_project_events', 'tradrl_project_goals', 'tradrl_jobs']);
    for (const table of referenced) expect(tables.has(table)).toBe(true);
  });

  it('statement digests are stable (L9 — identical SQL -> identical digest)', () => {
    expect(statementDigest(knowledgeSelectStatement({ tenant: 't', project: 'p' }, { at: 1, retention: null }))).toBe(
      statementDigest(knowledgeSelectStatement({ tenant: 't', project: 'p' }, { at: 2, retention: null })),
    );
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function requireOk<T>(result: StoreResult<T>): T {
  if (!result.ok) throw new Error(`fixture statement failed: ${result.error.code}`);
  return result.value;
}

function extractOutcome(record: Record<string, unknown>): { readonly ok: true; readonly value: { id: string; ordinal: number; project: string; classRef: string; decisionRef: string } } {
  return {
    ok: true,
    value: {
      id: String(record.outcomeId),
      ordinal: Number(record.ordinal),
      project: String(record.project),
      classRef: String(record.outcomeClass ?? 'unknown'),
      decisionRef: String(record.decisionRef ?? 'unknown'),
    },
  };
}

function knowledgeEnvelope(tenant: string, knowledgeId: string, ordinal: number, project: string): { record: unknown; status: 'active' | 'superseded' | 'decayed'; supersededBy: string | null } {
  return {
    record: { knowledgeId, ordinal, tenant, project, claim: { kind: 'claim' }, confidence: '0.800', evidenceCount: 2, provenance: { source: 'demo' }, validity: { from: 1, to: null }, asOf: 1, priorChainHead: 'genesis' },
    status: 'active',
    supersededBy: null,
  };
}

function knowledgeRow(tenant: string, knowledgeId: string, ordinal: number): FakeRow {
  return { table: 'tradrl_knowledge', params: [tenant, 'prj_a', knowledgeId, String(ordinal), 'active', '1', JSON.stringify(knowledgeEnvelope(tenant, knowledgeId, ordinal, 'prj_a'))] };
}

function outcomeRecord(tenant: string, outcomeId: string, ordinal: number, decisionRef = 'dec:1'): Record<string, unknown> {
  return { outcomeId, ordinal, tenant, project: 'prj_a', decisionRef, outcomeClass: 'profit', expectation: {}, realization: {}, deviation: {}, evidence: [], lineage: {}, asOf: 1, priorChainHead: 'genesis' };
}

function postMortemRecord(tenant: string, postMortemId: string): Record<string, unknown> {
  return { postMortemId, ordinal: 1, tenant, project: 'prj_a', subject: {}, expected: {}, happened: {}, gap: {}, hypotheses: [], evidence: [], lineage: {}, asOf: 1, priorChainHead: 'genesis' };
}

function projectRecord(tenant: string, projectId: string): Record<string, unknown> {
  return { id: projectId, tenantId: tenant, name: `Project ${projectId}`, executionMode: 'simulation', lifecycle: { status: 'active' }, lineage: {}, createdAt: 1, updatedAt: 1 };
}

// ---------------------------------------------------------------------------
// FW-MI-A (MI-D1): the session-listing JOIN — the statement + the store
// round-trip (the fresh, one-round-trip read the session routes serve)
// ---------------------------------------------------------------------------

describe('deploy/adapters/neon — FW-MI-A: the session-listing JOIN (the fresh session read)', () => {
  it('the statement is tenant-scoped (L12: param 1 binds the tenant), LEFT JOINed with the goal sets, in creation order', () => {
    const built = projectSessionListStatement('tenant-demo');
    expect(built.sql).toBe('SELECT p.payload AS project_payload, g.payload AS goal_payload FROM tradrl_projects p LEFT JOIN tradrl_project_goals g ON g.tenant = p.tenant AND g.project_id = p.project_id WHERE p.tenant = $1 ORDER BY p.created_at');
    expect(built.params).toEqual(['tenant-demo']); // the tenant is a bind parameter, never interpolated
  });

  it('the store round-trip: one row per project, the goal payload decoded beside it, the ownership + the LEFT JOIN miss both legible', async () => {
    const project = (id: string, name: string, createdAt: number) => JSON.stringify({ id, tenantId: 'tenant-demo', name, executionMode: 'simulation', lifecycle: { projectId: id, status: 'active' }, lineage: { projectId: id, goal: { goalId: `goal-${id}`, version: 1 }, constraintSet: { id: `cs-${id}`, version: 1 } }, createdAt, updatedAt: createdAt });
    const goalSet = (ownerSession?: string) => JSON.stringify({ goal: { goalId: 'goal-1' }, constraintSet: { id: 'cs-1' }, ...(ownerSession === undefined ? {} : { ownerSession }) });
    const seeded: readonly FakeRow[] = [
      // created LATER but created_at EARLIER — the JOIN orders by created_at, not insert order
      { table: 'tradrl_projects', params: ['tenant-demo', 'prj-b', 'desk b', 'active', '100', '100', project('prj-b', 'desk b', 100)] },
      { table: 'tradrl_projects', params: ['tenant-demo', 'prj-a', 'desk a', 'active', '200', '200', project('prj-a', 'desk a', 200)] },
      { table: 'tradrl_project_goals', params: ['tenant-demo', 'prj-a', goalSet('session-a')] },
      // a FOREIGN tenant's rows never cross (the JOIN's WHERE p.tenant = $1)
      { table: 'tradrl_projects', params: ['tenant-other', 'prj-x', 'foreign', 'active', '50', '50', project('prj-x', 'foreign', 50)] },
      { table: 'tradrl_project_goals', params: ['tenant-other', 'prj-x', goalSet('session-x')] },
      // a malformed project payload row is skipped fail-closed, never a throw
      { table: 'tradrl_projects', params: ['tenant-demo', 'prj-bad', 'bad', 'active', '10', '10', 'not json {'] },
    ];
    const fake = fakeNeon(seeded);
    const store = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const rows = await store.projectSessionRowsOf('tenant-demo');
    expect(rows.ok).toBe(true);
    if (!rows.ok) return;
    expect(rows.value.length).toBe(2); // prj-b (created_at 100) then prj-a (200) — the malformed row skipped, the foreign tenant's never read
    const first = rows.value[0] as { project: { id: string }; ownerSession: string | null; goalSet: { ownerSession?: unknown } | null };
    expect(first.project.id).toBe('prj-b');
    expect(first.ownerSession).toBe(null); // the LEFT JOIN miss — prj-b has NO goal set (unowned)
    expect(first.goalSet).toBe(null);
    const second = rows.value[1] as { project: { id: string }; ownerSession: string | null; goalSet: { ownerSession?: unknown } | null };
    expect(second.project.id).toBe('prj-a');
    expect(second.ownerSession).toBe('session-a'); // the ownership stamps legibly beside the record
    expect(second.goalSet?.ownerSession).toBe('session-a');
  });

  it('R46: a degraded Neon read is the typed failure — never a throw, never a partial session view', async () => {
    const store = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: failingFetch, instants });
    const rows = await store.projectSessionRowsOf('tenant-demo');
    expect(rows.ok).toBe(false);
    if (rows.ok) return;
    expect(rows.error.code).toBeTruthy();
    expect(rows.error.message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// W-30 (PROD-504): the tenant-wide batched reads + the per-query abort budget
// ---------------------------------------------------------------------------

describe('deploy/adapters/neon — W-30: the tenant-wide batched reads (PROD-504)', () => {
  it('the statements are pinned verbatim: two-cell rows, (project, ordinal) ordering, tenant = $1 (L12), no per-project predicate', () => {
    expect(projectEventsOfTenantStatement('tenant-a')).toEqual({
      sql: 'SELECT project_id, payload FROM tradrl_project_events WHERE tenant = $1 ORDER BY project_id, ordinal',
      params: ['tenant-a'],
    });
    expect(knowledgeOfTenantStatement('tenant-a', Number.MAX_SAFE_INTEGER)).toEqual({
      sql: 'SELECT project, payload FROM tradrl_knowledge WHERE tenant = $1 AND as_of <= $2 ORDER BY project, ordinal',
      params: ['tenant-a', String(Number.MAX_SAFE_INTEGER)],
    });
    expect(outcomeRowsOfTenantStatement('tradrl_outcomes', 'tenant-a')).toEqual({
      sql: 'SELECT project, payload FROM tradrl_outcomes WHERE tenant = $1 ORDER BY project, ordinal',
      params: ['tenant-a'],
    });
    expect(outcomeRowsOfTenantStatement('tradrl_post_mortems', 'tenant-a')).toEqual({
      sql: 'SELECT project, payload FROM tradrl_post_mortems WHERE tenant = $1 ORDER BY project, ordinal',
      params: ['tenant-a'],
    });
    expect(jobsOfTenantStatement('tenant-a')).toEqual({
      sql: 'SELECT project, payload FROM tradrl_jobs WHERE tenant = $1 ORDER BY project, submitted_at',
      params: ['tenant-a'],
    });
  });

  it('the events read: ONE round trip returns every project\'s log tagged + grouped in (project, ordinal) order; foreign tenants find NOTHING; malformed rows skip fail-closed', async () => {
    const fake = fakeNeon([
      // Insertion order deliberately interleaved — the read answers (project, ordinal).
      { table: 'tradrl_project_events', params: ['tenant-a', 'prj_b', '2', 'activate', '12', JSON.stringify({ event: 'activate', at: 12, detail: null })] },
      { table: 'tradrl_project_events', params: ['tenant-a', 'prj_a', '2', 'activate', '11', JSON.stringify({ event: 'activate', at: 11, detail: null })] },
      { table: 'tradrl_project_events', params: ['tenant-a', 'prj_a', '1', 'organization-bound', '10', JSON.stringify({ event: 'organization-bound', at: 10, detail: { organizationRef: 'org:a' } })] },
      { table: 'tradrl_project_events', params: ['tenant-b', 'prj_x', '1', 'activate', '99', JSON.stringify({ event: 'activate', at: 99, detail: null })] }, // foreign tenant — never read
      { table: 'tradrl_project_events', params: ['tenant-a', 'prj_a', '3', 'pause', '13', 'not json {'] }, // malformed payload — skipped fail-closed
    ]);
    const store = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const read = await store.projectEventsOfTenant('tenant-a');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toEqual([
      { project: 'prj_a', event: 'organization-bound', at: 10, detail: { organizationRef: 'org:a' } },
      { project: 'prj_a', event: 'activate', at: 11, detail: null },
      { project: 'prj_b', event: 'activate', at: 12, detail: null },
    ]);
    expect(fake.calls.length).toBe(1); // ONE round trip for the WHOLE tenant — the W-30 law
    expect(fake.calls[0]!.query).toBe('SELECT project_id, payload FROM tradrl_project_events WHERE tenant = $1 ORDER BY project_id, ordinal');
  });

  it('the knowledge boot read: boot options pass, the envelopes return tagged per project; a NON-BOOT options shape FAILS LOUDLY (the typed refusal — semantics can never silently diverge)', async () => {
    const fake = fakeNeon([
      knowledgeRow('tenant-a', 'fkr:a1', 1), // prj_a, asOf 1 (the fake's knowledgeRow seeds project 'prj_a')
      knowledgeRow('tenant-a', 'fkr:b1', 1), // the fixture rows carry project prj_a — verify by the seeded shape below instead
    ]);
    const store = new NeonFirmMemoryStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    // The EXACT boot shape (at = the hydration ceiling, retention = null) passes.
    const boot = await store.queryKnowledgeOfTenant({ tenant: 'tenant-a' }, { at: Number.MAX_SAFE_INTEGER, retention: null });
    expect(boot.ok).toBe(true);
    // Any other options shape refuses LOUDLY — never a silently divergent read.
    for (const options of [
      { at: 5_000, retention: null }, // a non-ceiling instant
      { at: Number.MAX_SAFE_INTEGER, retention: { historyWindowMs: 1 } }, // a retention object
      { at: Number.MAX_SAFE_INTEGER, retention: null, activeOnly: true }, // an active-only filter
    ] as const) {
      const refused = await store.queryKnowledgeOfTenant({ tenant: 'tenant-a' }, options);
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.error.code).toBe('tenant_wide_read_options_refused');
    }
    // A knowledge-id filter (inexpressible in the type — a JS caller) refuses loudly too.
    const idRefused = await store.queryKnowledgeOfTenant({ tenant: 'tenant-a', knowledgeId: 'fkr:a1' } as never, { at: Number.MAX_SAFE_INTEGER, retention: null });
    expect(idRefused.ok).toBe(false);
    if (idRefused.ok) return;
    expect(idRefused.error.code).toBe('tenant_wide_read_options_refused');
  });

  it('the knowledge boot read round-trips envelopes tagged per project (the per-project decode law: malformed rows skip fail-closed)', async () => {
    const envelopeA = knowledgeEnvelope('tenant-a', 'fkr:a1', 1, 'prj_a');
    const envelopeB = knowledgeEnvelope('tenant-a', 'fkr:b1', 2, 'prj_b');
    const fake = fakeNeon([
      { table: 'tradrl_knowledge', params: ['tenant-a', 'prj_b', 'fkr:b1', '2', 'active', '1', JSON.stringify(envelopeB)] },
      { table: 'tradrl_knowledge', params: ['tenant-a', 'prj_a', 'fkr:a1', '1', 'active', '1', JSON.stringify(envelopeA)] },
      { table: 'tradrl_knowledge', params: ['tenant-a', 'prj_a', 'fkr:bad', '3', 'weird-status', '1', JSON.stringify({ record: {}, status: 'weird-status' })] }, // not a served status — skipped
      { table: 'tradrl_knowledge', params: ['tenant-b', 'fkr:x1', '1', 'active', '1', JSON.stringify(knowledgeEnvelope('tenant-b', 'fkr:x1', 1, 'prj_x'))] }, // foreign tenant — never read
    ]);
    const store = new NeonFirmMemoryStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const read = await store.queryKnowledgeOfTenant({ tenant: 'tenant-a' }, { at: Number.MAX_SAFE_INTEGER, retention: null });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.length).toBe(2); // the malformed + the foreign rows never cross
    expect(read.value[0]).toEqual({ project: 'prj_a', envelope: envelopeA }); // (project, ordinal) order
    expect(read.value[1]).toEqual({ project: 'prj_b', envelope: envelopeB });
  });

  it('the outcomes + post-mortems + jobs reads: ONE round trip each, rows tagged per project in order, foreign tenants find NOTHING', async () => {
    const outcomeB = { ...outcomeRecord('tenant-a', 'ocm:b1', 2), project: 'prj_b' };
    const outcomeA = { ...outcomeRecord('tenant-a', 'ocm:a1', 1), project: 'prj_a' };
    const postMortemB = { ...postMortemRecord('tenant-a', 'pmr:b1'), project: 'prj_b' };
    const postMortemA = { ...postMortemRecord('tenant-a', 'pmr:a1'), project: 'prj_a' };
    const jobB = { jobId: 'job:aaaa0002', kind: 'research', tenant: 'tenant-a', project: 'prj_b', status: 'complete', submittedAt: 2 };
    const jobA = { jobId: 'job:aaaa0001', kind: 'research', tenant: 'tenant-a', project: 'prj_a', status: 'submitted', submittedAt: 1 };
    const fake = fakeNeon([
      { table: 'tradrl_outcomes', params: ['tenant-a', 'prj_b', 'ocm:b1', '2', 'profit', 'dec:1', '1', JSON.stringify(outcomeB)] },
      { table: 'tradrl_outcomes', params: ['tenant-a', 'prj_a', 'ocm:a1', '1', 'profit', 'dec:1', '1', JSON.stringify(outcomeA)] },
      { table: 'tradrl_outcomes', params: ['tenant-b', 'prj_x', 'ocm:x1', '1', 'profit', 'dec:1', '1', JSON.stringify({ ...outcomeRecord('tenant-b', 'ocm:x1', 1), project: 'prj_x' })] },
      { table: 'tradrl_post_mortems', params: ['tenant-a', 'prj_b', 'pmr:b1', '1', 'unknown', 'dec:1', '1', JSON.stringify(postMortemB)] },
      { table: 'tradrl_post_mortems', params: ['tenant-a', 'prj_a', 'pmr:a1', '1', 'unknown', 'dec:1', '1', JSON.stringify(postMortemA)] },
      { table: 'tradrl_jobs', params: ['tenant-a', 'prj_b', 'job:aaaa0002', '2', 'complete', JSON.stringify(jobB)] },
      { table: 'tradrl_jobs', params: ['tenant-a', 'prj_a', 'job:aaaa0001', '1', 'submitted', JSON.stringify(jobA)] },
      { table: 'tradrl_jobs', params: ['tenant-b', 'prj_x', 'job:bbbb0001', '1', 'submitted', JSON.stringify({ ...jobA, tenant: 'tenant-b', project: 'prj_x', jobId: 'job:bbbb0001' })] },
    ]);
    const outcomeStore = new NeonOutcomeLearningStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const jobStore = new NeonJobStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const outcomes = await outcomeStore.queryOutcomesOfTenant('tenant-a');
    expect(outcomes.ok).toBe(true);
    if (!outcomes.ok) return;
    expect(outcomes.value).toEqual([{ project: 'prj_a', record: outcomeA }, { project: 'prj_b', record: outcomeB }]);
    const postMortems = await outcomeStore.queryPostMortemsOfTenant('tenant-a');
    expect(postMortems.ok).toBe(true);
    if (!postMortems.ok) return;
    expect(postMortems.value).toEqual([{ project: 'prj_a', record: postMortemA }, { project: 'prj_b', record: postMortemB }]);
    const jobs = await jobStore.jobRecordsOfTenant('tenant-a');
    expect(jobs.ok).toBe(true);
    if (!jobs.ok) return;
    expect(jobs.value).toEqual([{ project: 'prj_a', record: jobA }, { project: 'prj_b', record: jobB }]);
  });

  it('R46: a degraded Neon read is the typed failure on every tenant-wide lane — never a throw, never a partial read', async () => {
    const projectStore = new NeonProjectStore({ config: FAKE_CONFIG, fetchLike: failingFetch, instants });
    const firmMemory = new NeonFirmMemoryStore({ config: FAKE_CONFIG, fetchLike: failingFetch, instants });
    const outcomeStore = new NeonOutcomeLearningStore({ config: FAKE_CONFIG, fetchLike: failingFetch, instants });
    const jobStore = new NeonJobStore({ config: FAKE_CONFIG, fetchLike: failingFetch, instants });
    for (const read of [
      await projectStore.projectEventsOfTenant('tenant-a'),
      await firmMemory.queryKnowledgeOfTenant({ tenant: 'tenant-a' }, { at: Number.MAX_SAFE_INTEGER, retention: null }),
      await outcomeStore.queryOutcomesOfTenant('tenant-a'),
      await outcomeStore.queryPostMortemsOfTenant('tenant-a'),
      await jobStore.jobRecordsOfTenant('tenant-a'),
    ]) {
      expect(read.ok).toBe(false);
      if (read.ok) return;
      expect(read.error.code).toBeTruthy();
      expect(read.error.message.length).toBeGreaterThan(0);
    }
  });
});

describe('deploy/adapters/neon — W-30: the per-query abort budget (PROD-504)', () => {
  it('the budget is 8s, DISCLOSED and PINNED (deploy/README.md §function-duration + deploy/wire/production.md carry the same number)', () => {
    expect(NEON_QUERY_TIMEOUT_MS).toBe(8_000);
  });

  it('every executed statement carries an AbortSignal on the fetch init (the platform fetch honors it; the test fakes ignore it)', async () => {
    let observed: unknown = null;
    const probing: FetchLike = async (url, init) => {
      observed = (init as { signal?: unknown } | undefined)?.signal;
      return { ok: true, status: 200, text: async () => JSON.stringify({ command: 'SELECT 0', rowCount: 0 }) };
    };
    const result = await executeNeonStatement(FAKE_CONFIG, 'SELECT 1', [], probing, 60_000);
    expect(result.ok).toBe(true);
    expect(observed).not.toBeNull();
    expect(typeof (observed as { aborted: boolean }).aborted).toBe('boolean');
  });

  it('a black-holed connection (never answered) degrades to the typed neon_unreachable WITHIN the query\'s own budget — never a hang past it (R46)', async () => {
    // A signal-abiding hanging fetch: never resolves on its own; rejects the
    // moment the abort signal fires (exactly what the platform fetch does).
    const hanging: FetchLike = (url, init) => new Promise((_resolve, reject) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      if (signal === undefined) throw new Error('the per-query abort signal is missing from the fetch init');
      if (signal.aborted) {
        reject(new Error('The operation was aborted'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
    });
    const startedAt = Date.now();
    const result = await executeNeonStatement(FAKE_CONFIG, 'SELECT payload FROM tradrl_knowledge WHERE tenant = $1', ['tenant-a'], hanging, 25);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('neon_unreachable');
    expect(result.error.message).toContain('25ms per-query abort budget');
    expect(Date.now() - startedAt).toBeLessThan(5_000); // degraded within the query's own budget, never the function's
  });
});
