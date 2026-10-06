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
import { buildNeonRequest, executeNeonStatement, neonConnectionString, type NeonConfig } from './client';
import { NEON_DDL_RECORDS } from './schema';
import {
  NeonFirmMemoryStore,
  NeonOutcomeLearningStore,
  NeonProjectStore,
  goalSetGetStatement,
  goalSetPutStatement,
  knowledgePutStatement,
  knowledgeSelectStatement,
  outcomePutStatement,
  outcomeSelectStatement,
  projectEventAppendStatement,
  projectEventsStatement,
  projectGetStatement,
  projectListStatement,
  projectNextOrdinalStatement,
  projectPutStatement,
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
      rows.push({ table: insertMatch[1] as string, params });
      return responder(JSON.stringify({ command: 'INSERT 0 1', rowCount: 1 }));
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
      { label: 'goalset.put', statement: requireOk(goalSetPutStatement('tenant-a', 'prj_a', { goal: { id: 'goal-1' }, constraintSet: { id: 'cs-1' } })) },
      { label: 'goalset.get', statement: goalSetGetStatement('tenant-a', 'prj_a') },
    ];
    expect(statements.length).toBe(13);
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
    expect([...tables].sort()).toEqual(['tradrl_knowledge', 'tradrl_outcomes', 'tradrl_post_mortems', 'tradrl_project_events', 'tradrl_project_goals', 'tradrl_projects']);
    for (const record of NEON_DDL_RECORDS) {
      expect(record.ddl).toContain(`CREATE TABLE IF NOT EXISTS ${record.table}`);
      expect(record.ddl).toContain('PRIMARY KEY (tenant');
      expect(record.ddl).toMatch(/tenant\s+TEXT\s+NOT NULL/);
    }
    // Every table the statements reference is covered by a DDL record.
    const referenced = new Set(['tradrl_knowledge', 'tradrl_outcomes', 'tradrl_post_mortems', 'tradrl_projects', 'tradrl_project_events', 'tradrl_project_goals']);
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
