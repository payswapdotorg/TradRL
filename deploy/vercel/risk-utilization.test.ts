// deploy/vercel/risk-utilization.test.ts — THE STANDING RISK-UTILIZATION
// READ (FW-31-A, Round A blocker 1 — risk_tooling, the only losing
// dimension).
//
// Pure, offline, deterministic: NO live provider calls, NO network, NO
// real Vercel (the durable arm rides the fake provider fleet's fetch,
// exactly like deploy/vercel/durable.test.ts). What is pinned:
//   - THE ONE-GLANCE CONTRACT: GET /v1/risk/utilization?project=<id>
//     serves, per constraint in the project's own goal set, the declared
//     bound + the STANDING CURRENT UTILIZATION + the status — and the
//     ACTIVE-BREACH aggregation (every refusal on file, bound-vs-observed,
//     audit refs, instants);
//   - THE HONESTY LAW: `current` is a number ONLY when the records on file
//     can produce a defensible one (each source string names exactly which
//     records); where they cannot — a drawdown with no equity curve, an
//     exposure with no position store, an unreadable outcome fold — the
//     row serves current null with status "unknown", NEVER a fabricated
//     value;
//   - the route's own laws: developer-credential authn first (the typed
//     401), the project param law (the typed 400), the typed not-found for
//     a project with no goal set on record, and the fall-through laws
//     (non-GET methods, port overrides, the durable backing without a
//     built seam — the pre-FW-31-A behavior, byte-identical);
//   - BOTH ARMS: the DEMO backing (the W-25B capture + the demoSubmissionsOf
//     fold + the backing's own outcome port) and the DURABLE backing (the
//     W-25D hydrated goal set + the same blotter fold + the seam's hydrated
//     outcome port — the disclosure names the arm).
//
// Spec anchors: R43 (additive), R46, L12, UX-DESIGN §7 (the anti-deception
// law), ROUND-A-REPORT §4 blocker 1 + §6 (FW-31-A).

import { describe, expect, it, vi } from 'vitest';
import { composeDeployment, degradedPorts } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { fakeProviders } from '../wire/smoketest';
import { DEMO_PROJECT_ID, demoSubmissionBlotter } from './runtime/demo';
import { buildRiskUtilizationRead, serveRiskUtilizationRoute, type RiskUtilizationGoalSet, type RiskUtilizationRead } from './runtime/risk-utilization';
import type { GatewaySubmissionRecord, GoalStatement, ConstraintSetStatement, OutcomeRecordMirror, TimestampMs } from '../../services/api/src/index';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// Helpers (the runtime.test.ts harness pattern)
// ---------------------------------------------------------------------------

const VALID_ENV = {
  [API_ENV_KEYS.apiDeveloperToken]: 'tok-deploy-demo',
  [API_ENV_KEYS.apiDeveloperTenant]: 'tenant-demo',
  [API_ENV_KEYS.apiDeveloperPrincipal]: 'public-console',
};

function apiEnv(overrides: Record<string, string> = {}) {
  return readApiEnv({ ...VALID_ENV, ...overrides });
}

const BEARER = { authorization: `Bearer ${VALID_ENV[API_ENV_KEYS.apiDeveloperToken]}` };

function streamingRequest(parts: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown }): FunctionRequest {
  return { method: parts.method ?? 'GET', url: parts.url ?? '/v1/meta', headers: parts.headers ?? {}, body: parts.body };
}

interface CapturedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly payload: string | null;
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

/** Drive one request through the FULL function handler; returns status/headers + the parsed body. */
async function drive(deployment: ReturnType<typeof composeDeployment>, request: FunctionRequest): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, headers: written.headers, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

/** Drive the risk read through the full handler; returns the data payload. */
async function driveRisk(deployment: ReturnType<typeof composeDeployment>, project: string, headers: Record<string, string> = BEARER): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown>; data: RiskUtilizationRead }> {
  const result = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/risk/utilization?project=${encodeURIComponent(project)}`, headers }));
  return { status: result.status, headers: result.headers, body: result.body, data: result.body.data as unknown as RiskUtilizationRead };
}

// ---------------------------------------------------------------------------
// The demo project's standing read (the golden — the risk manager's glance)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the standing risk-utilization read, the demo project (FW-31-A)', () => {
  it('serves the five declared bounds WITH their standing utilization + the one active breach — the seeded refusal visible in aggregate at last (the page envelope, no CORS)', async () => {
    const composed = composeDeployment(apiEnv());
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const { status, headers, data } = await driveRisk(composed, DEMO_PROJECT_ID);
    expect(status).toBe(200);
    expect(headers['content-type']).toBe('application/json; charset=utf-8');
    expect(headers['x-api-version']).toBe('v1');
    expect(headers['x-request-id']).toMatch(/^req:/);
    for (const key of Object.keys(headers)) expect(key.toLowerCase()).not.toContain('access-control');
    expect(data.projectId).toBe(DEMO_PROJECT_ID);
    expect(typeof data.asOf).toBe('string');
    expect(data.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // ONE ROW PER CONSTRAINT of the demo goal set, in the set's own order —
    // the declaration AND the standing utilization in one glance.
    expect(data.bounds.map((bound) => bound.constraintId)).toEqual(['k-capital-budget', 'k-risk-budget', 'k-position', 'k-turnover', 'k-drawdown']);
    const [capital, riskBudget, position, turnover, drawdown] = data.bounds;

    // The capital budget: the cumulative gross filled notional of the two
    // seeded fills (45750.375 + 20472.60), inside the declared 250000.
    expect(capital).toMatchObject({ metric: 'capital.budget', boundMax: '250000', severity: 'blocking', current: 66222.975, status: 'ok' });
    expect(capital!.source).toContain('2 routed fill(s)');
    expect(capital!.source).toContain('no position store');

    // The risk budget: the realized-loss consumption of the one outcome on
    // record (realized -12.5 -> consumption 12.5), inside the declared 25000.
    expect(riskBudget).toMatchObject({ metric: 'risk.budget', boundMax: '25000', severity: 'blocking', current: 12.5, status: 'ok' });
    expect(riskBudget!.source).toContain('1 outcome record(s)');
    expect(riskBudget!.source).toContain('-12.5');

    // THE SEEDED REFUSAL, VISIBLE IN AGGREGATE (Round A's exact complaint):
    // the k-position cap the gate enforced (observed 2.4 vs the declared 2)
    // is now the standing breach row.
    expect(position).toMatchObject({ metric: 'position.grossExposure', boundMax: '2', severity: 'blocking', current: 2.4, status: 'breach' });
    expect(position!.source).toContain('risk-limits refusal');
    expect(position!.source).toContain('audit xga:demo0003');
    expect(position!.source).toContain('point-in-time gate observation');

    // The advisory turnover ceiling: the same two fills' notional on the
    // latest trading day — an honest advisory breach by the data's own
    // arithmetic (the source says exactly what was summed).
    expect(turnover).toMatchObject({ metric: 'costs.dailyTurnover', boundMax: '500', severity: 'advisory', current: 66222.975, status: 'breach' });
    expect(turnover!.source).toContain('sum of filled notional');

    // THE HONESTY LAW'S SHOWCASE: the drawdown hard limit is declared and
    // enforced, but no equity curve exists on any backing — the standing
    // value is UNKNOWN, never fabricated.
    expect(drawdown).toMatchObject({ constraintId: 'k-drawdown', metric: 'risk.maxDrawdown', boundMax: '0.15', severity: 'blocking', current: null, status: 'unknown' });
    expect(drawdown!.source).toContain('no equity curve');

    // THE ACTIVE-BREACH AGGREGATION: the seeded refusal with its
    // bound-vs-observed, the audit ref, the instant — the enforcement that
    // was real but invisible.
    expect(data.activeBreaches).toHaveLength(1);
    const breach = data.activeBreaches[0]!;
    const seededRefusal = demoSubmissionBlotter()[2]!;
    expect(breach.kind).toBe('risk_limits_refusal');
    expect(breach.submissionId).toBe(seededRefusal.submissionId);
    expect(breach.auditId).toBe('xga:demo0003');
    expect(breach.stage).toBe('risk_limits');
    expect(breach.at).toBe(new Date(1_720_000_000_000 + 120_000).toISOString());
    expect(breach.decisionBody).toBe('gate:pre-trade-risk');
    expect(breach.violations).toEqual([
      { constraintId: 'k-position', domain: 'state', subject: 'position.grossExposure', severity: 'blocking', predicate: { kind: 'limit.max', bound: 2 }, observed: '2.4' },
    ]);
    expect(breach.rationale).toContain('projected gross exposure 2.4');

    // The disclosure names the honesty law + the backing.
    expect(data.disclosure).toContain('never a fabricated or placeholder value');
    expect(data.disclosure).toContain('DEMO backing');
  });

  it('the route\'s own laws: authn first (the typed 401), the project param law (the typed 400), no goal on record (the typed 404)', async () => {
    const composed = composeDeployment(apiEnv());
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const noToken = await drive(composed, streamingRequest({ method: 'GET', url: `/v1/risk/utilization?project=${DEMO_PROJECT_ID}` }));
    expect(noToken.status).toBe(401);
    expect((noToken.body as { error: { code: string } }).error.code).toBe('unauthenticated');
    const wrongToken = await drive(composed, streamingRequest({ method: 'GET', url: `/v1/risk/utilization?project=${DEMO_PROJECT_ID}`, headers: { authorization: 'Bearer tok-wrong' } }));
    expect(wrongToken.status).toBe(401);
    const noProject = await drive(composed, streamingRequest({ method: 'GET', url: '/v1/risk/utilization', headers: BEARER }));
    expect(noProject.status).toBe(400);
    expect((noProject.body as { error: { code: string } }).error.code).toBe('validation_failed');
    // An EMPTY project value is the same typed 400 (isProjectId is a
    // non-empty-string guard — any non-empty id is shape-valid, and the
    // read then answers the honest not-found below).
    const empty = await drive(composed, streamingRequest({ method: 'GET', url: '/v1/risk/utilization?project=', headers: BEARER }));
    expect(empty.status).toBe(400);
    const unknown = await drive(composed, streamingRequest({ method: 'GET', url: '/v1/risk/utilization?project=prj-never-created', headers: BEARER }));
    expect(unknown.status).toBe(404);
    expect((unknown.body as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('ADDITIVE / backward-compatible: non-GET methods, port overrides and the durable backing without a built seam fall through to the boundary (the typed not_found — the pre-FW-31-A behavior)', async () => {
    const cases: readonly [string, ReturnType<typeof composeDeployment>, string][] = [
      ['a non-GET method (the demo backing)', composeDeployment(apiEnv()), 'POST'],
      ['port overrides (the injection seam owns its own world)', composeDeployment(apiEnv(), { controlPlane: degradedPorts().controlPlane }), 'GET'],
      ['the durable backing without Neon keys (the seam was not built)', composeDeployment(apiEnv({ TRADRL_DEPLOY_BACKING: 'durable' })), 'GET'],
    ];
    for (const [label, composed, method] of cases) {
      expect(composed.ok, label).toBe(true);
      if (!composed.ok) continue;
      const result = await drive(composed, streamingRequest({
        method,
        url: `/v1/risk/utilization?project=${DEMO_PROJECT_ID}`,
        headers: { ...BEARER, 'idempotency-key': 'idem:fw31a:falloff' },
        body: {},
      }));
      expect(result.status, label).toBe(404);
      expect((result.body as { error: { code: string } }).error.code, label).toBe('not_found');
    }
  });
});

// ---------------------------------------------------------------------------
// The launched-desk story (the demo arm — every desk gets its OWN read)
// ---------------------------------------------------------------------------

/** The console's launch flow, driven through the FULL handler (the real routes; the durable arm's write-through drains on the same path). */
async function launchDesk(deployment: ReturnType<typeof composeDeployment>, projectId: string, at: number): Promise<void> {
  const tenant = VALID_ENV[API_ENV_KEYS.apiDeveloperTenant];
  const created = await drive(deployment, streamingRequest({
    method: 'POST',
    url: '/v1/projects',
    headers: BEARER,
    body: {
      id: projectId,
      name: `the ${projectId} desk`,
      executionMode: 'simulation',
      goal: {
        id: `goal-${projectId}`, version: 1, tenantId: tenant,
        objective: 'Find and keep an edge in momentum.',
        horizon: { startsAt: at, endsAt: at + 90 * 24 * 3_600_000, label: 'the launch window' },
        successCriteria: {
          criteria: [
            { id: 'sc-1', metric: 'pnl.net', predicate: { kind: 'limit.min', bound: 0 }, description: 'net profit is non-negative' },
          ],
          requiredSatisfaction: 0.5,
        },
        evaluation: { blindRef: 'eval:blind-1', walkForwardRef: 'eval:wf-1', regimeRef: 'eval:regime-1', adversarialRequired: true },
        createdAt: at,
      },
      constraintSet: {
        id: `cs-${projectId}`, version: 1, tenantId: tenant,
        constraints: [
          { id: 'c-1', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, severity: 'blocking', description: 'the drawdown ceiling' },
          { id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: '500000.00' }, severity: 'blocking' },
          { id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: '40000.00' }, severity: 'blocking' },
        ],
        createdAt: at,
      },
      at,
    },
  }));
  expect(created.status).toBe(201);
  const kickoff = await drive(deployment, streamingRequest({
    method: 'POST',
    url: '/v1/jobs/research',
    headers: { ...BEARER, 'idempotency-key': `idem:fw31a:kickoff:${projectId}` },
    body: {
      kind: 'research',
      projectId,
      spec: {
        kind: 'console-launch',
        objective: 'Find and keep an edge in momentum.',
        horizon: { startsAt: at, endsAt: at + 90 * 24 * 3_600_000, label: 'the launch window' },
        capitalBudget: '500000.00',
        riskBudget: '40000.00',
        markets: ['BTC-USD', 'ETH-USD'],
        venues: ['binance', 'kraken'],
        dataSources: ['candle-v1', 'depth-v1'],
        executionMode: 'simulation',
        preferences: [],
      },
    },
  }));
  expect(kickoff.status).toBe(202);
}

describe('deploy/vercel — the standing risk-utilization read, a launched desk (the demo arm)', () => {
  it('the full story: launch -> ONE machinery request (the org compile) -> the desk\'s OWN bounds with its OWN refusal, fills and realized loss — the derived stream visible in aggregate', async () => {
    const composed = composeDeployment(apiEnv({ [API_ENV_KEYS.apiInternalToken]: 'tok-internal-demo', [API_ENV_KEYS.apiInternalPrincipal]: 'demo-machinery' }));
    expect(composed.ok).toBe(true);
    if (!composed.ok || composed.demo === null) return;
    const launchAt = 1_700_500_000_000;
    await launchDesk(composed, 'prj-desk-risk', launchAt);

    // ONE request through the full handler compiles the organization (the
    // per-request machinery tick) — the derived evidence stream comes into
    // existence exactly like the organization does.
    const warm = await drive(composed, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
    expect(warm.status).toBe(200);

    const { status, data } = await driveRisk(composed, 'prj-desk-risk');
    expect(status).toBe(200);
    expect(data.projectId).toBe('prj-desk-risk');
    expect(data.bounds.map((bound) => bound.constraintId)).toEqual(['c-1', 'k-capital-budget', 'k-risk-budget']);

    // c-1 (the desk's OWN drawdown ceiling): the derived refusal QUOTED it
    // (observed 0.24 vs the declared 0.2) — an OBSERVED drawdown breach
    // beats the no-equity-curve unknown (the observation is data).
    const [drawdown, capital, riskBudget] = data.bounds;
    expect(drawdown).toMatchObject({ metric: 'risk.maxDrawdown', boundMax: '0.2', severity: 'blocking', current: 0.24, status: 'breach' });
    expect(drawdown!.source).toContain('risk-limits refusal');

    // The capital budget: the derived entry + trim fills (48000 + 12000
    // gross notional) against the desk's OWN declared 500000.00 (the
    // predicate's own decimal text, verbatim).
    expect(capital).toMatchObject({ metric: 'capital.budget', boundMax: '500000.00', severity: 'blocking', current: 60000, status: 'ok' });

    // The risk budget: the derived adverse-gap outcome's realized loss
    // (net -12 -> consumption 12) against the desk's OWN declared 40000.00.
    expect(riskBudget).toMatchObject({ metric: 'risk.budget', boundMax: '40000.00', severity: 'blocking', current: 12, status: 'ok' });
    expect(riskBudget!.source).toContain('1 outcome record(s)');

    // The desk's OWN active breach: the derived refusal, the named gate.
    expect(data.activeBreaches).toHaveLength(1);
    const breach = data.activeBreaches[0]!;
    expect(breach.kind).toBe('risk_limits_refusal');
    expect(breach.decisionBody).toBe('gate:pre-trade-risk');
    expect(breach.violations).toEqual([
      { constraintId: 'c-1', domain: 'outcome', subject: 'risk.maxDrawdown', severity: 'blocking', predicate: { kind: 'limit.max', bound: 0.2 }, observed: '0.24' },
    ]);
  });

  it('a DRAFT desk (created but not compiled) serves its declared bounds with the honest empties — no fabricated stream (the compile gate holds the derived evidence back)', async () => {
    const composed = composeDeployment(apiEnv());
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    await launchDesk(composed, 'prj-desk-draft', 1_700_600_000_000);
    const { status, data } = await driveRisk(composed, 'prj-desk-draft');
    expect(status).toBe(200);
    const [drawdown, capital, riskBudget] = data.bounds;
    // No refusal on file yet -> the drawdown ceiling is honestly unknown.
    expect(drawdown).toMatchObject({ current: null, status: 'unknown' });
    // No fills on record -> the empty sum is 0 (disclosed with its count), never fabricated.
    expect(capital).toMatchObject({ current: 0, status: 'ok' });
    expect(capital!.source).toContain('0 routed fill(s)');
    expect(riskBudget).toMatchObject({ current: 0, status: 'ok' });
    expect(riskBudget!.source).toContain('0 outcome record(s)');
    expect(data.activeBreaches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The honesty law (the pure read — every metric class, every edge)
// ---------------------------------------------------------------------------

/** A minimal goal set for the pure builder (the constraint set is the read's bounds source). */
function goalSetOf(constraints: readonly unknown[]): RiskUtilizationGoalSet {
  return {
    goal: { id: 'goal-pure', version: 1, tenantId: 'tenant-demo', createdAt: 1, successCriteria: { criteria: [], requiredSatisfaction: 0 }, evaluation: {} } as unknown as GoalStatement,
    constraintSet: { id: 'cs-pure', version: 1, tenantId: 'tenant-demo', constraints, createdAt: 1 } as unknown as ConstraintSetStatement,
  };
}

/** One routed row with fill economics (the additive demo-substance field). */
function routedFillRow(submissionId: string, notional: string, filledAt: number): GatewaySubmissionRecord {
  return {
    kind: 'routed',
    submissionId,
    decisionId: `xd:${submissionId}`,
    auditId: `xga:${submissionId}`,
    requestRef: `gor:${submissionId}`,
    venue: 'BROKER-FIX',
    adapterRef: 'adapter:demo-broker',
    channelRef: 'chan:demo-main',
    routedAt: filledAt as TimestampMs,
    fill: { state: 'filled', quantity: '1', price: '1', notional, fee: '0', filledAt },
  } as GatewaySubmissionRecord;
}

/** One routed row WITHOUT fill economics (the live recorded shape — no fill echo). */
function routedBareRow(submissionId: string, routedAt: number): GatewaySubmissionRecord {
  return { kind: 'routed', submissionId, decisionId: `xd:${submissionId}`, auditId: `xga:${submissionId}`, requestRef: `gor:${submissionId}`, venue: 'BROKER-FIX', adapterRef: 'adapter:demo-broker', channelRef: 'chan:demo-main', routedAt: routedAt as TimestampMs };
}

/** One risk-limits refusal citing a constraint (the typed record's own shape). */
function refusedRow(submissionId: string, at: number, violation: Record<string, unknown>): GatewaySubmissionRecord {
  return {
    kind: 'refused',
    submissionId,
    decisionId: null,
    auditId: `xga:${submissionId}`,
    refusal: { stage: 'risk_limits', evaluationId: `rev:${submissionId}`, refusals: [violation] },
    refusedAt: at as TimestampMs,
  };
}

/** One non-risk-limits refusal (another stage of the typed pipeline). */
function refusedStageRow(submissionId: string, at: number, refusal: Record<string, unknown>): GatewaySubmissionRecord {
  return { kind: 'refused', submissionId, decisionId: null, auditId: `xga:${submissionId}`, refusal, refusedAt: at as TimestampMs } as GatewaySubmissionRecord;
}

/** One outcome record with a realized outcome (the risk-budget source). */
function outcomeWith(realized: string): OutcomeRecordMirror {
  return { outcomeId: 'out:x', ordinal: 1, tenant: 'tenant-demo', project: 'prj-pure', realization: { realizedOutcome: realized } } as unknown as OutcomeRecordMirror;
}

describe('deploy/vercel — the honesty law (the pure read, FW-31-A)', () => {
  it('THE LAW: a drawdown bound stays unknown even with fills AND outcomes on file (no equity curve exists — never a fabricated mark-to-market)', () => {
    const read = buildRiskUtilizationRead({
      projectId: 'prj-pure',
      goalSet: goalSetOf([{ id: 'c-dd', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.15 }, severity: 'blocking' }]),
      submissions: [routedFillRow('xgs:00000001', '100', 1_700_000_000_000)],
      outcomes: [outcomeWith('-5')],
      outcomesReadable: true,
      asOf: '2026-10-08T00:00:00.000Z',
      backing: 'demo',
    });
    expect(read.bounds[0]).toMatchObject({ constraintId: 'c-dd', metric: 'risk.maxDrawdown', boundMax: '0.15', severity: 'blocking', current: null, status: 'unknown' });
    expect(read.bounds[0]!.source).toContain('no equity curve');
  });

  it('THE LAW: an exposure bound stays unknown without a refusal observation (no position store — a book cannot be derived from per-trade fills)', () => {
    const read = buildRiskUtilizationRead({
      projectId: 'prj-pure',
      goalSet: goalSetOf([{ id: 'c-gross', domain: 'state', subject: 'position.grossExposure', predicate: { kind: 'limit.max', bound: 1.5 }, severity: 'blocking' }]),
      submissions: [routedFillRow('xgs:00000001', '100', 1_700_000_000_000)],
      outcomes: null,
      outcomesReadable: false,
      asOf: '2026-10-08T00:00:00.000Z',
      backing: 'demo',
    });
    expect(read.bounds[0]).toMatchObject({ current: null, status: 'unknown' });
    expect(read.bounds[0]!.source).toContain('no position or equity store');
  });

  it('THE LAW: the unreadable outcome fold degrades the risk budget to null/unknown — an honest zero-record read is 0, a FAILED read is unknown (never conflated)', () => {
    const constraints = [{ id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: 25000 }, severity: 'blocking' }];
    const unreadable = buildRiskUtilizationRead({ projectId: 'prj-pure', goalSet: goalSetOf(constraints), submissions: [], outcomes: null, outcomesReadable: false, asOf: '2026-10-08T00:00:00.000Z', backing: 'durable' });
    expect(unreadable.bounds[0]).toMatchObject({ current: null, status: 'unknown' });
    expect(unreadable.bounds[0]!.source).toContain('not readable');
    const empty = buildRiskUtilizationRead({ projectId: 'prj-pure', goalSet: goalSetOf(constraints), submissions: [], outcomes: [], outcomesReadable: true, asOf: '2026-10-08T00:00:00.000Z', backing: 'demo' });
    expect(empty.bounds[0]).toMatchObject({ current: 0, status: 'ok' });
    expect(empty.bounds[0]!.source).toContain('0 outcome record(s)');
  });

  it('gains do not replenish a consumed risk budget: the consumption is the negative part of the net realized sum (exact decimals)', () => {
    const read = buildRiskUtilizationRead({
      projectId: 'prj-pure',
      goalSet: goalSetOf([{ id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: 100 }, severity: 'blocking' }]),
      submissions: [],
      outcomes: [outcomeWith('-30.5'), outcomeWith('10.25'), outcomeWith('-2.25')],
      outcomesReadable: true,
      asOf: '2026-10-08T00:00:00.000Z',
      backing: 'demo',
    });
    // net = -30.5 + 10.25 - 2.25 = -22.5 -> consumption 22.5 (the +10.25 gain does not replenish).
    expect(read.bounds[0]).toMatchObject({ current: 22.5, status: 'ok' });
    expect(read.bounds[0]!.source).toContain('net -22.5');
  });

  it('the most recent refusal observation wins (recency by the refusal instant, ties to the later row)', () => {
    const read = buildRiskUtilizationRead({
      projectId: 'prj-pure',
      goalSet: goalSetOf([{ id: 'c-gross', domain: 'state', subject: 'position.grossExposure', predicate: { kind: 'limit.max', bound: 1.5 }, severity: 'blocking' }]),
      submissions: [
        refusedRow('xgs:00000001', 1_700_000_000_000, { constraintId: 'c-gross', domain: 'state', subject: 'position.grossExposure', severity: 'blocking', predicate: { kind: 'limit.max', bound: 1.5 }, observed: '1.8' }),
        refusedRow('xgs:00000002', 1_700_000_060_000, { constraintId: 'c-gross', domain: 'state', subject: 'position.grossExposure', severity: 'blocking', predicate: { kind: 'limit.max', bound: 1.5 }, observed: '1.2' }),
      ],
      outcomes: null,
      outcomesReadable: false,
      asOf: '2026-10-08T00:00:00.000Z',
      backing: 'demo',
    });
    // The LATER observation (1.2, back inside the bound) supersedes the
    // earlier breach — the standing status is ok, exactly as the data says.
    expect(read.bounds[0]).toMatchObject({ current: 1.2, status: 'ok' });
    expect(read.bounds[0]!.source).toContain('xgs:00000002');
    // BOTH refusals remain in the active-breach aggregation (every refusal
    // on file is a standing record — nothing on file supersedes a record).
    expect(read.activeBreaches.map((breach) => breach.submissionId)).toEqual(['xgs:00000001', 'xgs:00000002']);
  });

  it('a non-numeric observed value: current stays null (never fabricated) while the refusal remains the standing breach record', () => {
    const read = buildRiskUtilizationRead({
      projectId: 'prj-pure',
      goalSet: goalSetOf([{ id: 'c-flag', domain: 'action', subject: 'action.haltFlag', predicate: { kind: 'flag', expected: false }, severity: 'blocking' }]),
      submissions: [refusedRow('xgs:00000001', 1_700_000_000_000, { constraintId: 'c-flag', domain: 'action', subject: 'action.haltFlag', severity: 'blocking', predicate: { kind: 'flag', expected: false }, observed: true })],
      outcomes: null,
      outcomesReadable: false,
      asOf: '2026-10-08T00:00:00.000Z',
      backing: 'demo',
    });
    expect(read.bounds[0]).toMatchObject({ boundMax: null, current: null, status: 'breach' });
    expect(read.bounds[0]!.source).toContain('non-numeric observed value');
    expect(read.activeBreaches[0]!.violations![0]!.observed).toBe('true');
  });

  it('a non-risk-limits refusal (another stage of the typed pipeline) is an active breach with NO fabricated bound-vs-observed — and it never becomes a bound observation', () => {
    const read = buildRiskUtilizationRead({
      projectId: 'prj-pure',
      goalSet: goalSetOf([{ id: 'c-gross', domain: 'state', subject: 'position.grossExposure', predicate: { kind: 'limit.max', bound: 1.5 }, severity: 'blocking' }]),
      submissions: [refusedStageRow('xgs:00000001', 1_700_000_000_000, { stage: 'kill_switch', switchId: 'sw-1', thrownAt: 1_700_000_000_000, reason: 'the kill switch was thrown' })],
      outcomes: null,
      outcomesReadable: false,
      asOf: '2026-10-08T00:00:00.000Z',
      backing: 'demo',
    });
    expect(read.bounds[0]).toMatchObject({ current: null, status: 'unknown' });
    expect(read.activeBreaches).toHaveLength(1);
    expect(read.activeBreaches[0]!.kind).toBe('gateway_refusal');
    expect(read.activeBreaches[0]!.stage).toBe('kill_switch');
    expect(read.activeBreaches[0]!.violations).toBeUndefined();
  });

  it('rows without fill economics are excluded from every sum (the live recorded shape carries no fill echo) and the source says so', () => {
    const read = buildRiskUtilizationRead({
      projectId: 'prj-pure',
      goalSet: goalSetOf([{ id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: 1000 }, severity: 'blocking' }]),
      submissions: [routedFillRow('xgs:00000001', '100.5', 1_700_000_000_000), routedBareRow('xgs:00000002', 1_700_000_000_001)],
      outcomes: null,
      outcomesReadable: false,
      asOf: '2026-10-08T00:00:00.000Z',
      backing: 'demo',
    });
    expect(read.bounds[0]).toMatchObject({ current: 100.5, status: 'ok' });
    expect(read.bounds[0]!.source).toContain('1 routed fill(s) on record');
    expect(read.bounds[0]!.source).toContain('1 routed row(s) without fill economics');
  });

  it('the turnover window: only the LATEST UTC trading day\'s fills sum (a prior day\'s notional never leaks into today\'s standing figure)', () => {
    const dayOne = Date.UTC(2026, 9, 7, 12, 0, 0); // 2026-10-07
    const dayTwo = Date.UTC(2026, 9, 8, 12, 0, 0); // 2026-10-08
    const read = buildRiskUtilizationRead({
      projectId: 'prj-pure',
      goalSet: goalSetOf([{ id: 'k-turnover', domain: 'action', subject: 'costs.dailyTurnover', predicate: { kind: 'limit.max', bound: 500 }, severity: 'advisory' }]),
      submissions: [routedFillRow('xgs:00000001', '400', dayOne), routedFillRow('xgs:00000002', '150.25', dayTwo)],
      outcomes: null,
      outcomesReadable: false,
      asOf: '2026-10-08T00:00:00.000Z',
      backing: 'demo',
    });
    expect(read.bounds[0]).toMatchObject({ current: 150.25, status: 'ok' });
    expect(read.bounds[0]!.source).toContain('2026-10-08');
    expect(read.bounds[0]!.source).toContain('1 routed fill(s)');
  });

  it('limit.min and limit.range predicates: boundMax serves the max side only; the floor comparison is honest (a below-floor observation breaches)', () => {
    const read = buildRiskUtilizationRead({
      projectId: 'prj-pure',
      goalSet: goalSetOf([
        { id: 'c-min', domain: 'outcome', subject: 'returns.sharpe', predicate: { kind: 'limit.min', bound: 1 }, severity: 'blocking' },
        { id: 'c-range', domain: 'outcome', subject: 'returns.sharpeBand', predicate: { kind: 'limit.range', min: 0.5, max: 2 }, severity: 'advisory' },
      ]),
      submissions: [refusedRow('xgs:00000001', 1_700_000_000_000, { constraintId: 'c-min', domain: 'outcome', subject: 'returns.sharpe', severity: 'blocking', predicate: { kind: 'limit.min', bound: 1 }, observed: '0.4' })],
      outcomes: null,
      outcomesReadable: false,
      asOf: '2026-10-08T00:00:00.000Z',
      backing: 'demo',
    });
    const [minimum, range] = read.bounds;
    expect(minimum).toMatchObject({ boundMax: null, current: 0.4, status: 'breach' });
    expect(range).toMatchObject({ boundMax: '2', current: null, status: 'unknown' });
  });

  it('a refusal citing a constraint NOT in the set leaves every bound untouched — the breach still aggregates (the record is never dropped)', () => {
    const read = buildRiskUtilizationRead({
      projectId: 'prj-pure',
      goalSet: goalSetOf([{ id: 'c-other', domain: 'state', subject: 'position.grossExposure', predicate: { kind: 'limit.max', bound: 9 }, severity: 'blocking' }]),
      submissions: [refusedRow('xgs:00000001', 1_700_000_000_000, { constraintId: 'k-foreign', domain: 'state', subject: 'position.grossExposure', severity: 'blocking', predicate: { kind: 'limit.max', bound: 1.5 }, observed: '1.8' })],
      outcomes: null,
      outcomesReadable: false,
      asOf: '2026-10-08T00:00:00.000Z',
      backing: 'demo',
    });
    expect(read.bounds[0]).toMatchObject({ current: null, status: 'unknown' });
    expect(read.activeBreaches[0]!.violations![0]!.constraintId).toBe('k-foreign');
  });

  it('the route module maps the degraded goal-set read to the typed 503 (R46 — the durable projection\'s own failure, never a crash)', () => {
    const response = serveRiskUtilizationRoute(
      {
        verifyDeveloperAuthorization: () => ({ tenant: 'tenant-demo', principal: 'public-console' }),
        goalSetOf: () => ({ ok: false, code: 'neon_unreachable', message: 'the projection is down' }),
        submissionsOf: () => [],
        outcomesOf: null,
        backing: 'durable',
      },
      { method: 'GET', path: '/v1/risk/utilization', query: { project: 'prj-pure' }, headers: { authorization: 'Bearer x' } },
      0,
    );
    expect(response.status).toBe(503);
    const body = response.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('unavailable');
    expect(body.error.message).toContain('neon_unreachable');
  });
});

// ---------------------------------------------------------------------------
// The durable arm (the fake provider fleet — the W-25D hydrated surfaces)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the standing risk-utilization read, the durable arm (FW-31-A)', () => {
  it('the demo project\'s read serves from the seam\'s HYDRATED surfaces (the boot world\'s goal set + fixture outcome) — the same one-glance numbers, the disclosure naming the DURABLE arm', async () => {
    const providers = fakeProviders();
    const deployment = composeDeployment(
      readApiEnv({ ...VALID_ENV, NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech', NEON_DATABASE: 'neondb', NEON_API_USER: 'neondb_owner', NEON_API_KEY: 'fake-neon-key-demo' }),
      {},
      { fetchLike: providers.fetchLike, instants: { next: () => 1_800_400_000_000 } },
    );
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    const { status, data } = await driveRisk(deployment, DEMO_PROJECT_ID);
    expect(status).toBe(200);
    // The same five bounds (the boot world seeded the demo project's own
    // goal set; the blotter fold serves the seeded rows; the seam's
    // hydrated outcome port holds the boot-written demo outcome).
    expect(data.bounds.map((bound) => bound.constraintId)).toEqual(['k-capital-budget', 'k-risk-budget', 'k-position', 'k-turnover', 'k-drawdown']);
    const byId = new Map(data.bounds.map((bound) => [bound.constraintId, bound]));
    expect(byId.get('k-capital-budget')).toMatchObject({ current: 66222.975, status: 'ok' });
    expect(byId.get('k-risk-budget')).toMatchObject({ current: 12.5, status: 'ok' });
    expect(byId.get('k-position')).toMatchObject({ current: 2.4, status: 'breach' });
    expect(byId.get('k-turnover')).toMatchObject({ current: 66222.975, status: 'breach' });
    expect(byId.get('k-drawdown')).toMatchObject({ current: null, status: 'unknown' });
    expect(data.activeBreaches).toHaveLength(1);
    expect(data.activeBreaches[0]!.violations![0]).toMatchObject({ constraintId: 'k-position', observed: '2.4' });
    // The disclosure names the DURABLE arm + its disclosed limitation.
    expect(data.disclosure).toContain('DURABLE');
    expect(data.disclosure).toContain('hydrated');
  });

  it('a launched desk under durable serves ITS OWN hydrated bounds (the create-project records persisted at createProject time)', async () => {
    const providers = fakeProviders();
    const deployment = composeDeployment(
      readApiEnv({ ...VALID_ENV, NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech', NEON_DATABASE: 'neondb', NEON_API_USER: 'neondb_owner', NEON_API_KEY: 'fake-neon-key-demo' }),
      {},
      { fetchLike: providers.fetchLike, instants: { next: () => 1_800_400_000_000 } },
    );
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    await launchDesk(deployment, 'prj-durable-risk', 1_700_500_000_000);
    const { status, data } = await driveRisk(deployment, 'prj-durable-risk');
    expect(status).toBe(200);
    expect(data.projectId).toBe('prj-durable-risk');
    expect(data.bounds.map((bound) => bound.constraintId)).toEqual(['c-1', 'k-capital-budget', 'k-risk-budget']);
    // No derived stream under durable for this desk (the world rides the
    // goal-set row only after a console-launch kickoff job's durable
    // write-through — this create carried none), so the bounds serve with
    // the honest empties: the declaration + unknown/zero utilization,
    // never a fabricated stream.
    const byId = new Map(data.bounds.map((bound) => [bound.constraintId, bound]));
    expect(byId.get('c-1')).toMatchObject({ boundMax: '0.2', current: null, status: 'unknown' });
    expect(byId.get('k-capital-budget')).toMatchObject({ boundMax: '500000.00', current: 0, status: 'ok' });
    expect(byId.get('k-risk-budget')).toMatchObject({ boundMax: '40000.00', current: 0, status: 'ok' });
    expect(data.activeBreaches).toEqual([]);
  });

  it('authn runs first under durable too (the typed 401 — the same law as every host route)', async () => {
    const providers = fakeProviders();
    const deployment = composeDeployment(
      readApiEnv({ ...VALID_ENV, NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech', NEON_DATABASE: 'neondb', NEON_API_USER: 'neondb_owner', NEON_API_KEY: 'fake-neon-key-demo' }),
      {},
      { fetchLike: providers.fetchLike, instants: { next: () => 1_800_400_000_000 } },
    );
    expect(deployment.ok).toBe(true);
    if (!deployment.ok) return;
    const unauthenticated = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/risk/utilization?project=${DEMO_PROJECT_ID}` }));
    expect(unauthenticated.status).toBe(401);
    expect((unauthenticated.body as { error: { code: string } }).error.code).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// FW-34-A — THE PER-REQUEST AS-OF (Round C register item 4, M5's evidence:
// "'Refresh Risk' button no-op (as-of unchanged across 3 activations incl.
// native click; reads do refresh on reload/scope-change)")
//
// THE RUNTIME-SIDE PIN: the route re-derives its standing read on EVERY
// request — `asOf` is the request's own instant, and the standing values
// re-fold from the serving stores each time. The pin proves the runtime
// half is NEVER the freeze: two consecutive reads a wall-clock interval
// apart serve two DIFFERENT as-of instants (the pre-fix symptom's freeze
// was the CONSOLE's click path not re-fetching — the beat-render race
// class, FW-34-B's apps/web surface, disclosed here for the register).
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-34-A: the risk read re-derives per request (the as-of is never frozen at the host)', () => {
  it('two consecutive reads a wall-clock interval apart serve TWO DIFFERENT as-of instants — the standing read is re-derived on every request (the runtime half of "Refresh Risk", pinned)', async () => {
    vi.useFakeTimers();
    const firstInstant = 1_800_600_000_000;
    vi.setSystemTime(firstInstant);
    try {
      const providers = fakeProviders();
      const deployment = composeDeployment(
        readApiEnv({ ...VALID_ENV, NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech', NEON_DATABASE: 'neondb', NEON_API_USER: 'neondb_owner', NEON_API_KEY: 'fake-neon-key-demo' }),
        {},
        { fetchLike: providers.fetchLike, instants: { next: () => firstInstant } },
      );
      expect(deployment.ok).toBe(true);
      if (!deployment.ok) return;

      const first = await driveRisk(deployment, DEMO_PROJECT_ID);
      expect(first.status).toBe(200);
      expect(first.data.asOf).toBe(new Date(firstInstant).toISOString());

      // A wall-clock interval passes (the "Refresh Risk" the persona
      // pressed); the next read serves the FRESH instant — the standing
      // values re-derive from the same stores (byte-stable records, the
      // honest re-observation), but the AS-OF always names the read's own
      // request instant.
      const secondInstant = firstInstant + 23_000;
      vi.setSystemTime(secondInstant);
      const second = await driveRisk(deployment, DEMO_PROJECT_ID);
      expect(second.status).toBe(200);
      expect(second.data.asOf).toBe(new Date(secondInstant).toISOString());
      expect(second.data.asOf).not.toBe(first.data.asOf);
      // The standing values themselves are unchanged (the records on file
      // did not move) — the refresh is honest about both halves.
      expect(second.data.bounds).toEqual(first.data.bounds);
      expect(second.data.activeBreaches).toEqual(first.data.activeBreaches);
    } finally {
      vi.useRealTimers();
    }
  });
});
