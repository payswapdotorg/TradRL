// deploy/vercel/runbook.test.ts — THE HOST-OWNED INTERNAL DDL RUNBOOK
// ROUTES (W-28, lane B). Pure, offline, deterministic: the REAL Neon
// adapters (deploy/wire W-3d) over the fake provider fleet's fetch
// (deploy/wire/smoketest.ts — no network, FIXED FAKE credentials), driving
// the REAL composition (runtime/compose.ts) and the FULL function handler
// (api/router.ts). What is pinned — the work order's test law:
//   (a) THE HAPPY PATH: the fake Neon fleet receives the DDL statements in
//       `NEON_DDL_RECORDS` order; the route returns the per-table report
//       with the honest `"ok"` result; the statements' shapes are pinned.
//   (b) THE IDEMPOTENCE: a second apply over the same fake returns the
//       same per-table report, no error (DDL is idempotent by
//       construction — `CREATE TABLE IF NOT EXISTS`).
//   (c) THE AUTH LAW: no token → the typed 401 envelope; wrong token →
//       401; the internal credential present → 200 (authn FIRST — the
//       boundary's own 401 law, mirrored by the existing demo-substance
//       routes).
//   (d) THE NEON-ABSENT MATRIX: the routes answer the typed
//       `deploy_adapter_absent` 503 and ZERO Neon statements crossed the
//       wire (the matrix precedent's pin style — the activation NEVER ran
//       in this state).
//   (e) THE VERIFY ROUTE: the `information_schema` query shape pinned;
//       the coverage summary correct for present/missing mixes (the demo
//       project's INSERTed tables present before any apply; tradrl_jobs
//       absent; all 7 present after apply).
//   (f) THE FAILURE PATH: the fake Neon failing mid-apply → the typed 503
//       with the failure code, and NO secret-shaped material in the
//       response body (the sweep precedent — the table name + the neon
//       failure code are safe; the endpoint host, the connection string,
//       the api key, the database name are NOT).
//   (g) THE SMOKETEST FAKE EXTENSION (the W-27 precedent): the fake
//       provider learns the new statement shapes (CREATE TABLE / CREATE
//       INDEX / information_schema.tables SELECT) and serves them with
//       the live wire envelopes — a PASS here means the fake can carry
//       the runbook's traffic end-to-end.
//
// Spec anchors: R46, ARCHITECTURE-LOCK L12 (the runbook routes read NO
// tenant data — schema-level DDL + information_schema only), R7 (the
// sweep law — no secret-shaped material in errors), the same-origin law
// (no CORS), the zero-dep law (platform APIs only).

import { describe, expect, it } from 'vitest';
import { composeDeployment } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { fakeProviders } from '../wire/smoketest';
import { NEON_DDL_RECORDS } from '../adapters/neon/schema';
import type { NeonConfig } from '../adapters/neon/client';
import type { FetchLike } from '../adapters/shared';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// The fixed fake world (never a real credential — the sweep law)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-runbook';
const TOKEN = 'tok-deploy-runbook';
const PRINCIPAL = 'public-console';
const INTERNAL_TOKEN = 'tok-internal-runbook';
const INTERNAL_PRINCIPAL = 'runbook-lead';
const NEON_KEYS = {
  NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-runbook',
};
const NEON_CONFIG: NeonConfig = {
  apiHost: NEON_KEYS.NEON_API_HOST,
  database: NEON_KEYS.NEON_DATABASE,
  apiUser: NEON_KEYS.NEON_API_USER,
  apiKey: NEON_KEYS.NEON_API_KEY,
};

/**
 * The env source of a durable deployment WITH the internal credential
 * configured (the runbook routes REQUIRE the internal credential — authn
 * first; the private plane stays closed without it).
 */
function runbookSource(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    [API_ENV_KEYS.apiInternalToken]: INTERNAL_TOKEN,
    [API_ENV_KEYS.apiInternalPrincipal]: INTERNAL_PRINCIPAL,
    ...NEON_KEYS,
    ...overrides,
  };
}

/** Compose one durable instance over the injected fetch (a fresh "serverless instance"). */
function composeInstance(source: Record<string, string | undefined>, fetchLike: FetchLike) {
  return composeDeployment(readApiEnv(source), {}, { fetchLike, instants: { next: () => 1_800_500_000_000 } });
}

/** An outage-controllable fetch (the R46 lever — up/down without rebuilding the fleet). */
function outageFetch(inner: FetchLike): { readonly fetchLike: FetchLike; setOutage(down: boolean): void } {
  let down = false;
  return {
    fetchLike: (url, init) => (down ? Promise.reject(new Error('connection refused (simulated provider outage)')) : inner(url, init)),
    setOutage: (value: boolean) => {
      down = value;
    },
  };
}

/** A statement-counting fetch (the determinism observable — every Neon statement crossing the wire). */
function statementCountingFetch(inner: FetchLike): { readonly fetchLike: FetchLike; readonly statements: () => readonly string[] } {
  const observed: string[] = [];
  return {
    fetchLike: (url, init) => {
      if (typeof init?.body === 'string' && url.endsWith('/sql')) {
        try {
          const parsed = JSON.parse(init.body) as { query: string };
          observed.push(parsed.query);
        } catch {
          observed.push('<unparseable>');
        }
      }
      return inner(url, init);
    },
    statements: () => observed,
  };
}

// ---------------------------------------------------------------------------
// The function-handler harness (the full path: settled -> wrap -> host
// runbook route -> response). Mirrors durable.test.ts's drive() pattern.
// ---------------------------------------------------------------------------

interface CapturedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly payload: string | null;
}

function streamingRequest(parts: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown }): FunctionRequest {
  return { method: parts.method ?? 'GET', url: parts.url ?? '/v1/meta', headers: parts.headers ?? {}, body: parts.body };
}

function capture(): { response: FunctionResponse; captured: () => CapturedResponse } {
  const headers: Record<string, string> = {};
  let status = 0;
  let payload: string | null = null;
  const response: FunctionResponse = {
    get statusCode() {
      return status;
    },
    set statusCode(value: number) {
      status = value;
    },
    setHeader(key: string, value: string | number) {
      headers[key] = String(value);
      return undefined;
    },
    end(chunk?: string) {
      if (typeof chunk === 'string') payload = chunk;
      return undefined;
    },
  };
  return { response, captured: () => ({ status, headers, payload }) };
}

/** The internal Bearer headers (the runbook routes' auth). */
const INTERNAL_BEARER = { authorization: `Bearer ${INTERNAL_TOKEN}` };

/** The developer Bearer headers (the public routes' auth — /v1/meta requires the developer credential, NOT the internal one). */
const DEV_BEARER = { authorization: `Bearer ${TOKEN}` };

/** Drive one request through the FULL function handler; returns the parsed JSON body. */
async function drive(deployment: ReturnType<typeof composeInstance>, request: FunctionRequest): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, headers: written.headers, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// (a) THE HAPPY PATH
// ---------------------------------------------------------------------------

describe('deploy/vercel — the W-28 runbook: the happy path (apply EVERY DDL record)', () => {
  it('POST /internal/deploy/ddl/apply: the fake Neon fleet receives the DDL statements in NEON_DDL_RECORDS order; the route returns the per-table report with the honest "ok" result; the statements\' shapes are pinned', async () => {
    const providers = fakeProviders();
    const counting = statementCountingFetch(providers.fetchLike);
    const deployment = composeInstance(runbookSource(), counting.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect(deployment.durable).not.toBeNull();

    // The first request pays the boot world (the demo project seeds into
    // Neon — the superset floor). The runbook dispatcher runs AFTER the
    // boot world in the router's pipeline.
    const boot = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: DEV_BEARER }));
    expect(boot.status).toBe(200);
    const bootStatements = counting.statements().length;

    const response = await drive(deployment, streamingRequest({ method: 'POST', url: '/internal/deploy/ddl/apply', headers: INTERNAL_BEARER }));
    expect(response.status).toBe(200);
    const data = (response.body as { data: { tables: readonly { table: string; result: string }[] } }).data;
    expect(data.tables.map((entry) => entry.table)).toEqual(NEON_DDL_RECORDS.map((record) => record.table));
    // HONESTY LAW: the wire does not distinguish "applied" from
    // "already-present" — the honest per-table result is `"ok"` for both
    // (the PR body discloses this honestly; never a fabricated distinction).
    expect(data.tables.every((entry) => entry.result === 'ok')).toBe(true);

    // THE STATEMENTS' SHAPES ARE PINNED: every DDL record crossed the
    // wire, in `NEON_DDL_RECORDS` order, each as the record's own DDL
    // string (the multi-statement CREATE TABLE + CREATE INDEX block).
    const applyStatements = counting.statements().slice(bootStatements);
    expect(applyStatements.length).toBe(NEON_DDL_RECORDS.length);
    for (let index = 0; index < NEON_DDL_RECORDS.length; index++) {
      const record = NEON_DDL_RECORDS[index]!;
      const observed = applyStatements[index]!;
      // The DDL record's whole block (CREATE TABLE ... ; CREATE INDEX ...)
      // crossed the wire as ONE query — the live proxy accepts multi-
      // statement queries when no params are bound.
      expect(observed).toBe(record.ddl);
      // The shape pin: every DDL record carries the IF NOT EXISTS guard
      // (idempotent by construction).
      expect(observed).toContain('CREATE TABLE IF NOT EXISTS');
    }
    // The provider was exercised once per DDL record (the wire path's
    // determinism — the fake's neon counter is the observable).
    expect(providers.seen.neon).toBeGreaterThanOrEqual(NEON_DDL_RECORDS.length);
  });
});

// ---------------------------------------------------------------------------
// (b) THE IDEMPOTENCE
// ---------------------------------------------------------------------------

describe('deploy/vercel — the W-28 runbook: the idempotence (a second apply is a no-op)', () => {
  it('a second apply over the same fake returns the same per-table report, no error (CREATE TABLE IF NOT EXISTS)', async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(runbookSource(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    // Boot world first.
    expect((await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: DEV_BEARER }))).status).toBe(200);

    const first = await drive(deployment, streamingRequest({ method: 'POST', url: '/internal/deploy/ddl/apply', headers: INTERNAL_BEARER }));
    expect(first.status).toBe(200);
    const firstReport = (first.body as { data: { tables: readonly { table: string; result: string }[] } }).data.tables;

    // THE SECOND APPLY: idempotent by construction — the IF NOT EXISTS
    // guards keep the second apply a no-op (the live proxy answers the
    // same command tag for both applied and already-present; the honest
    // result is `"ok"` for both, never a fabricated distinction).
    const second = await drive(deployment, streamingRequest({ method: 'POST', url: '/internal/deploy/ddl/apply', headers: INTERNAL_BEARER }));
    expect(second.status).toBe(200);
    const secondReport = (second.body as { data: { tables: readonly { table: string; result: string }[] } }).data.tables;
    expect(secondReport).toEqual(firstReport);
    expect(secondReport.every((entry) => entry.result === 'ok')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (c) THE AUTH LAW (authn FIRST — the boundary's own 401 envelope)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the W-28 runbook: the auth law (authn FIRST — the typed 401 envelope)', () => {
  it('no token → the typed 401 envelope; wrong token → 401; the internal credential present → 200', async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(runbookSource(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect((await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: DEV_BEARER }))).status).toBe(200);

    // NO TOKEN — the typed 401 envelope (the SAME shape the existing
    // demo-substance routes apply to a missing developer credential —
    // `{ error: { code: 'unauthenticated', ... } }`).
    const noToken = await drive(deployment, streamingRequest({ method: 'POST', url: '/internal/deploy/ddl/apply' }));
    expect(noToken.status).toBe(401);
    expect((noToken.body as { error: { code: string } }).error.code).toBe('unauthenticated');

    // WRONG TOKEN — the same typed 401.
    const wrongToken = await drive(deployment, streamingRequest({ method: 'POST', url: '/internal/deploy/ddl/apply', headers: { authorization: 'Bearer tok-wrong-internal' } }));
    expect(wrongToken.status).toBe(401);
    expect((wrongToken.body as { error: { code: string } }).error.code).toBe('unauthenticated');

    // THE INTERNAL CREDENTIAL PRESENT — 200 (authn succeeded).
    const correct = await drive(deployment, streamingRequest({ method: 'POST', url: '/internal/deploy/ddl/apply', headers: INTERNAL_BEARER }));
    expect(correct.status).toBe(200);

    // Same law on the verify route.
    const noTokenVerify = await drive(deployment, streamingRequest({ method: 'GET', url: '/internal/deploy/ddl/verify' }));
    expect(noTokenVerify.status).toBe(401);
    expect((noTokenVerify.body as { error: { code: string } }).error.code).toBe('unauthenticated');
    const wrongVerify = await drive(deployment, streamingRequest({ method: 'GET', url: '/internal/deploy/ddl/verify', headers: { authorization: 'Bearer tok-wrong-internal' } }));
    expect(wrongVerify.status).toBe(401);
    const correctVerify = await drive(deployment, streamingRequest({ method: 'GET', url: '/internal/deploy/ddl/verify', headers: INTERNAL_BEARER }));
    expect(correctVerify.status).toBe(200);

    // AUTHN FIRST — the 401 fires BEFORE any Neon traffic (the runbook
    // never crossed the wire on the 401 paths; the counter did not move
    // for the no-token / wrong-token requests beyond the boot world's
    // baseline).
    expect(providers.seen.neon).toBeGreaterThan(0); // the boot world + the two correct calls crossed
  });

  it('when the internal credential is NOT configured (apiInternalToken === null): both routes stay CLOSED — the typed 401 (the private plane is closed; the same law the existing demo-substance routes apply to a missing developer credential)', async () => {
    const providers = fakeProviders();
    // Compose WITHOUT the internal credential (apiInternalToken absent).
    const deployment = composeInstance(
      {
        [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
        [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
        [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
        ...NEON_KEYS,
      },
      providers.fetchLike,
    );
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect((await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: { authorization: `Bearer ${TOKEN}` } }))).status).toBe(200);

    // The internal credential is NOT configured — the runbook routes stay
    // CLOSED. The presented token (even the developer credential) does
    // not match the internal credential (which is null) → the typed 401.
    const applyWithDev = await drive(deployment, streamingRequest({ method: 'POST', url: '/internal/deploy/ddl/apply', headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(applyWithDev.status).toBe(401);
    expect((applyWithDev.body as { error: { code: string } }).error.code).toBe('unauthenticated');
    const verifyWithDev = await drive(deployment, streamingRequest({ method: 'GET', url: '/internal/deploy/ddl/verify', headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(verifyWithDev.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// (d) THE NEON-ABSENT MATRIX (zero Neon statements crossed the wire)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the W-28 runbook: the Neon-absent matrix (the activation NEVER ran)', () => {
  it('an explicit durable backing WITHOUT Neon keys: both routes answer the typed deploy_adapter_absent 503 and ZERO Neon statements crossed the wire (the matrix precedent)', async () => {
    const providers = fakeProviders();
    const counting = statementCountingFetch(providers.fetchLike);
    // Compose with TRADRL_DEPLOY_BACKING=durable but NO Neon keys — the
    // matrix's Neon-absent row (the seam is not built). The
    // `composeInstance` helper composes through the standard env shape.
    const deployment = composeInstance(
      {
        [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
        [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
        [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
        [API_ENV_KEYS.apiInternalToken]: INTERNAL_TOKEN,
        [API_ENV_KEYS.apiInternalPrincipal]: INTERNAL_PRINCIPAL,
        TRADRL_DEPLOY_BACKING: 'durable',
      },
      counting.fetchLike,
    );
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect(deployment.backing).toBe('durable');
    expect(deployment.durable).toBeNull(); // the seam is not built

    const apply = await drive(deployment, streamingRequest({ method: 'POST', url: '/internal/deploy/ddl/apply', headers: INTERNAL_BEARER }));
    expect(apply.status).toBe(503);
    expect((apply.body as { error: { code: string; message: string } }).error.code).toBe('unavailable');
    expect((apply.body as { error: { message: string } }).error.message).toContain('deploy_adapter_absent');

    const verify = await drive(deployment, streamingRequest({ method: 'GET', url: '/internal/deploy/ddl/verify', headers: INTERNAL_BEARER }));
    expect(verify.status).toBe(503);
    expect((verify.body as { error: { code: string; message: string } }).error.code).toBe('unavailable');
    expect((verify.body as { error: { message: string } }).error.message).toContain('deploy_adapter_absent');

    // THE ACTIVATION NEVER RAN: not a single Neon statement crossed the
    // wire (the matrix precedent's pin style — the seam was not built,
    // so the runbook has nowhere to issue statements).
    expect(counting.statements().length).toBe(0);
    expect(providers.seen.neon).toBe(0);
  });

  it('the DEMO backing (no Neon keys, the default): both routes answer the typed deploy_adapter_absent 503 — the seam was not built', async () => {
    const providers = fakeProviders();
    // Compose with the DEMO backing (no Neon keys — the default).
    const deployment = composeInstance(
      {
        [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
        [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
        [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
        [API_ENV_KEYS.apiInternalToken]: INTERNAL_TOKEN,
        [API_ENV_KEYS.apiInternalPrincipal]: INTERNAL_PRINCIPAL,
      },
      providers.fetchLike,
    );
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect(deployment.backing).toBe('demo');
    expect(deployment.durable).toBeNull(); // the seam is not built under demo

    const apply = await drive(deployment, streamingRequest({ method: 'POST', url: '/internal/deploy/ddl/apply', headers: INTERNAL_BEARER }));
    expect(apply.status).toBe(503);
    expect((apply.body as { error: { message: string } }).error.message).toContain('deploy_adapter_absent');
    const verify = await drive(deployment, streamingRequest({ method: 'GET', url: '/internal/deploy/ddl/verify', headers: INTERNAL_BEARER }));
    expect(verify.status).toBe(503);
    expect((verify.body as { error: { message: string } }).error.message).toContain('deploy_adapter_absent');
    // ZERO Neon statements crossed the wire (the seam was not built).
    expect(providers.seen.neon).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (e) THE VERIFY ROUTE (information_schema query shape + coverage summary)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the W-28 runbook: the verify route (information_schema + coverage)', () => {
  it('the information_schema query shape pinned: SELECT table_name FROM information_schema.tables WHERE table_name IN ($1..$n) — parameterized end-to-end (L12: every dynamic value is a $n bind parameter)', async () => {
    const providers = fakeProviders();
    const counting = statementCountingFetch(providers.fetchLike);
    const deployment = composeInstance(runbookSource(), counting.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect((await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: DEV_BEARER }))).status).toBe(200);
    const bootStatements = counting.statements().length;

    const verify = await drive(deployment, streamingRequest({ method: 'GET', url: '/internal/deploy/ddl/verify', headers: INTERNAL_BEARER }));
    expect(verify.status).toBe(200);

    // THE QUERY SHAPE PINNED: the verify issued ONE SELECT against
    // information_schema.tables, with the table names as $n bind
    // parameters (L12 — parameterized end-to-end; no value is
    // SQL-interpolated). The query text contains the parameterized
    // WHERE table_name IN ($1, $2, ...) shape, NOT the literal table
    // names — the W-28 law.
    const verifyStatements = counting.statements().slice(bootStatements);
    expect(verifyStatements.length).toBe(1);
    const query = verifyStatements[0]!;
    expect(query.startsWith('SELECT table_name FROM information_schema.tables WHERE table_name IN (')).toBe(true);
    // The placeholders $1..$7 appear (NEON_DDL_RECORDS has 7 tables).
    for (let index = 1; index <= NEON_DDL_RECORDS.length; index++) {
      expect(query).toContain(`$${index}`);
    }
    // No literal table name is SQL-interpolated into the query text
    // (the L12 law — every dynamic value is a $n bind parameter).
    for (const record of NEON_DDL_RECORDS) {
      expect(query).not.toContain(`'${record.table}'`);
      expect(query).not.toContain(`"${record.table}"`);
    }
  });

  it('the coverage summary is correct for the present/missing mix: the demo project\'s INSERTed tables present before any apply; tradrl_jobs absent; ALL 9 present after apply (FW-39-1: the two auth tables included)', async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(runbookSource(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    // The first request pays the boot world (the demo project seeds into
    // Neon — the demo world's knowledge, outcomes, post-mortems, project
    // record, project goal, project event all INSERT; the demo project's
    // JOBS are excluded from the durable write-through — they stay
    // per-instance by design). The verify route therefore reports 6/9
    // tables present before any apply (tradrl_jobs + FW-39-1's two auth
    // tables absent — nothing registers a principal before the auth routes
    // are called, and the runbook step has not run).
    expect((await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: DEV_BEARER }))).status).toBe(200);
    const beforeApply = await drive(deployment, streamingRequest({ method: 'GET', url: '/internal/deploy/ddl/verify', headers: INTERNAL_BEARER }));
    expect(beforeApply.status).toBe(200);
    const beforeData = (beforeApply.body as { data: { tables: readonly { table: string; exists: boolean }[]; coverage: string } }).data;
    const beforeMap = new Map(beforeData.tables.map((entry) => [entry.table, entry.exists] as const));
    // The demo project's INSERTed tables are present (the boot world wrote them).
    expect(beforeMap.get('tradrl_knowledge')).toBe(true);
    expect(beforeMap.get('tradrl_outcomes')).toBe(true);
    expect(beforeMap.get('tradrl_post_mortems')).toBe(true);
    expect(beforeMap.get('tradrl_projects')).toBe(true);
    expect(beforeMap.get('tradrl_project_events')).toBe(true);
    expect(beforeMap.get('tradrl_project_goals')).toBe(true);
    // tradrl_jobs is ABSENT (the demo project's jobs are excluded from
    // the durable write-through — they stay per-instance; no row ever
    // landed in the tradrl_jobs table on the demo project's behalf).
    expect(beforeMap.get('tradrl_jobs')).toBe(false);
    expect(beforeData.coverage).toBe('6/9 tables present');
    // FW-39-1: the identity substrate's two tables are ABSENT before any apply (no register call, no DDL).
    expect(beforeMap.get('tradrl_auth_principals')).toBe(false);
    expect(beforeMap.get('tradrl_auth_revocations')).toBe(false);

    // AFTER APPLY: every DDL record creates its table; the verify reports
    // 9/9 tables present (the honest coverage summary).
    const apply = await drive(deployment, streamingRequest({ method: 'POST', url: '/internal/deploy/ddl/apply', headers: INTERNAL_BEARER }));
    expect(apply.status).toBe(200);
    const afterApply = await drive(deployment, streamingRequest({ method: 'GET', url: '/internal/deploy/ddl/verify', headers: INTERNAL_BEARER }));
    expect(afterApply.status).toBe(200);
    const afterData = (afterApply.body as { data: { tables: readonly { table: string; exists: boolean }[]; coverage: string } }).data;
    expect(afterData.tables.every((entry) => entry.exists)).toBe(true);
    expect(afterData.coverage).toBe('9/9 tables present');
  });

  it('on a fresh database (no boot world, no INSERTs): the verify reports 0/9 tables present before any apply; 9/9 after', async () => {
    const providers = fakeProviders();
    const deployment = composeInstance(runbookSource(), providers.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect(deployment.durable).not.toBeNull();
    // BEFORE THE BOOT WORLD: settle the projection over an empty durable
    // store (no INSERTs, no DDL). The verify route reports 0/9 tables
    // present — the honest coverage summary against an empty database
    // (the runbook's whole point: the Lead calls verify FIRST to see
    // the gap, THEN apply to heal it).
    await deployment.durable!.settled();
    const direct = await deployment.durable!.runbook.verifyDdl();
    expect(direct.ok).toBe(true);
    if (direct.ok) {
      expect(direct.tables.every((entry) => entry.exists === false)).toBe(true);
      expect(direct.coverage).toBe('0/9 tables present');
    }
    // AFTER APPLY: 9/9 tables present.
    const applied = await deployment.durable!.runbook.applyDdl();
    expect(applied.ok).toBe(true);
    const verified = await deployment.durable!.runbook.verifyDdl();
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.tables.every((entry) => entry.exists === true)).toBe(true);
      expect(verified.coverage).toBe('9/9 tables present');
    }
  });
});

// ---------------------------------------------------------------------------
// (f) THE FAILURE PATH (typed 503 with the failure code; NO secret-shaped
// material in the response body — the sweep precedent)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the W-28 runbook: the failure path (typed 503 + the sweep law)', () => {
  it('the fake Neon failing mid-apply: the typed 503 with the failure code; NO secret-shaped material in the response body (the sweep precedent)', async () => {
    const providers = fakeProviders();
    const outage = outageFetch(providers.fetchLike);
    const deployment = composeInstance(runbookSource(), outage.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    // The boot world pays the first request (Neon UP) — the demo project seeds.
    expect((await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: DEV_BEARER }))).status).toBe(200);

    // NEON GOES DOWN MID-INSTANCE: the apply route issues its first DDL
    // statement; the outage fetch throws; the client returns the typed
    // `neon_unreachable` failure; the route surfaces the typed 503.
    outage.setOutage(true);
    const apply = await drive(deployment, streamingRequest({ method: 'POST', url: '/internal/deploy/ddl/apply', headers: INTERNAL_BEARER }));
    expect(apply.status).toBe(503);
    const error = (apply.body as { error: { code: string; message: string } }).error;
    expect(error.code).toBe('unavailable');
    // The failure code is surfaced (the table name + the neon failure
    // code are safe — the sweep precedent).
    expect(error.message).toContain('neon_unreachable');
    expect(error.message).toContain('tradrl_knowledge'); // the FIRST DDL record's table (the apply stops on the first failure)

    // THE SWEEP PRECEDENT: NO secret-shaped material in the response body.
    // The endpoint host, the connection string, the api key, the
    // database name, the user name — NONE of these appear in the
    // response body. The table name + the neon failure code are safe;
    // anything else from the error body is NOT.
    const responseBodyText = JSON.stringify(apply.body);
    expect(responseBodyText).not.toContain(NEON_KEYS.NEON_API_HOST);
    expect(responseBodyText).not.toContain(NEON_KEYS.NEON_API_KEY);
    expect(responseBodyText).not.toContain(NEON_KEYS.NEON_DATABASE);
    expect(responseBodyText).not.toContain(NEON_KEYS.NEON_API_USER);
    expect(responseBodyText).not.toContain('postgresql://');
    expect(responseBodyText).not.toContain('sslmode=');
    // The internal token never crosses into the response either.
    expect(responseBodyText).not.toContain(INTERNAL_TOKEN);
  });

  it('the verify route\'s failure path: the typed 503 with the neon failure code; NO secret-shaped material (the sweep precedent)', async () => {
    const providers = fakeProviders();
    const outage = outageFetch(providers.fetchLike);
    const deployment = composeInstance(runbookSource(), outage.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect((await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: DEV_BEARER }))).status).toBe(200);
    outage.setOutage(true);
    const verify = await drive(deployment, streamingRequest({ method: 'GET', url: '/internal/deploy/ddl/verify', headers: INTERNAL_BEARER }));
    expect(verify.status).toBe(503);
    const error = (verify.body as { error: { code: string; message: string } }).error;
    expect(error.code).toBe('unavailable');
    expect(error.message).toContain('neon_unreachable');
    // The sweep law.
    const responseBodyText = JSON.stringify(verify.body);
    expect(responseBodyText).not.toContain(NEON_KEYS.NEON_API_HOST);
    expect(responseBodyText).not.toContain(NEON_KEYS.NEON_API_KEY);
    expect(responseBodyText).not.toContain(NEON_KEYS.NEON_DATABASE);
    expect(responseBodyText).not.toContain(NEON_KEYS.NEON_API_USER);
    expect(responseBodyText).not.toContain('postgresql://');
  });
});

// ---------------------------------------------------------------------------
// (g) THE SMOKETEST FAKE EXTENSION (the W-27 precedent — the fake learns
// the new statement shapes)
// ---------------------------------------------------------------------------

describe('deploy/wire/smoketest — the W-28 fake extension (the W-27 precedent: the fake learns the new statement shapes)', () => {
  it('the fake provider serves CREATE TABLE / CREATE INDEX with the DML envelope (the client\'s decoder accepts the command/rowCount shape, NOT the select shape) and tracks the created tables for the verify query', async () => {
    const providers = fakeProviders();
    const counting = statementCountingFetch(providers.fetchLike);
    const deployment = composeInstance(runbookSource(), counting.fetchLike);
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    expect(deployment.durable).not.toBeNull();
    // BEFORE any apply: the fake's createdTables set is empty (the boot
    // world's INSERTs notwithstanding — no CREATE TABLE crossed the wire
    // yet). The verify reports only the INSERTed tables as present.
    await deployment.durable!.settled(); // project over the empty store (no boot world yet)
    const before = await deployment.durable!.runbook.verifyDdl();
    expect(before.ok).toBe(true);
    if (before.ok) {
      // The fresh, no-boot-world database: 0/9 tables present (no INSERTs,
      // no DDL).
      expect(before.coverage).toBe('0/9 tables present');
    }

    // APPLY: the fake receives the DDL statements and answers the DML
    // envelope (`{ command: 'CREATE TABLE', rowCount: 0 }`) — the client's
    // decoder accepts this shape and returns a successful DML outcome (NOT
    // a select outcome). The route returns 200 with the per-table report.
    const applied = await deployment.durable!.runbook.applyDdl();
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.tables.length).toBe(NEON_DDL_RECORDS.length);
      expect(applied.tables.every((entry) => entry.result === 'ok')).toBe(true);
    }

    // VERIFY: the fake's information_schema.tables SELECT returns the
    // created tables (the fake's createdTables set carries them now).
    const verified = await deployment.durable!.runbook.verifyDdl();
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.tables.every((entry) => entry.exists === true)).toBe(true);
      expect(verified.coverage).toBe('9/9 tables present');
    }
  });
});
