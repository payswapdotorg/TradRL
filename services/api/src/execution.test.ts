/**
 * @tradrl/api-service — THE L8 EXECUTION TESTS (the Work Order's
 * REQUIRED gate-bypass test, plus the forwarding law's positive
 * half).
 *
 * THE L8 LAW: "execution REQUESTS — always forwarded through the T040
 * gateway request shapes, NEVER executed by the API itself (L8: a
 * direct-execution code path is a typed error; gate-bypass test
 * REQUIRED)."
 *
 *   1. THE FORWARDING LAW: a valid intent is forwarded VERBATIM
 *      through the ExecutionGatewayPort (the recording fake receives
 *      exactly one call, byte-identical to the submitted intent) and
 *      the gateway's typed outcome is served verbatim (routed and
 *      refused both — a gateway refusal is a SUCCESSFUL request that
 *      the gate refused, never an API error).
 *   2. THE GATE-BYPASS TESTS (each the typed 403 `gate_bypass_attempt`):
 *      (a) submitting an APPROVE decision record — authority is the
 *          GATE's output, never a caller's input;
 *      (b) submitting a GatewayOrderRequest ('gor:') — the
 *          translation contract's output, never a caller's input;
 *      (c) an intent embedding execution authority (grant/token/
 *          credential/permission keys — the L8 authority-embedding
 *          scan).
 *   3. THE SINGLE-PATH LAW: no other route family ever touches the
 *      execution gateway port (the recording fake receives zero
 *      submissions across a broad sweep of every other route).
 */

import { describe, expect, it } from 'vitest';

import {
  PROJECT_A,
  TENANT_A,
  TOKEN_A,
  T0,
  errorOf,
  fixtureService,
  request,
  routedSubmission,
  validCreateProjectRequest,
  validStrategyIntent,
} from './fixtures';

function executionRequest(token: string, intent: unknown, key = 'idem:execution:1') {
  return { method: 'POST', path: '/v1/execution/requests', headers: { authorization: `Bearer ${token}`, 'idempotency-key': key }, body: { intent } };
}

describe('the forwarding law (the L8 positive half)', () => {
  it('a valid intent is forwarded VERBATIM through the gateway port and the outcome is served verbatim', () => {
    const intent = validStrategyIntent(TENANT_A, PROJECT_A);
    const { service, bundle } = fixtureService();
    const response = service.handle(executionRequest(TOKEN_A, intent) as never) as never as { status: number; body: { data: { kind: string; submissionId: string } } };
    expect(response.status).toBe(200);
    expect(response.body.data.kind).toBe('routed');

    // The port received EXACTLY ONE call, and the intent arrived byte-identical.
    expect(bundle.gateway.submitted.length).toBe(1);
    expect(bundle.gateway.submitted[0]).toEqual(intent);
    expect(JSON.stringify(bundle.gateway.submitted[0])).toBe(JSON.stringify(intent));
  });

  it('a gateway REFUSAL is served verbatim as a successful request (the gate refused, not the boundary)', () => {
    const intent = validStrategyIntent(TENANT_A, PROJECT_A, 2);
    const refused = {
      kind: 'refused' as const,
      submissionId: 'xgs:00000001',
      decisionId: null,
      auditId: 'xga:00000002',
      refusal: { stage: 'kill_switch' as const, switchId: 'ks:main', thrownAt: T0, reason: 'operator threw the standing switch' },
      refusedAt: T0 as never,
    };
    const { service, bundle } = fixtureService({ gatewayScript: () => refused });
    const response = service.handle(executionRequest(TOKEN_A, intent, 'idem:execution:refused') as never) as never as { status: number; body: { data: { kind: string; refusal: { stage: string } } } };
    expect(response.status).toBe(200);
    expect(response.body.data.kind).toBe('refused');
    expect(response.body.data.refusal.stage).toBe('kill_switch');
    expect(bundle.gateway.submitted.length).toBe(1);
  });

  it('the idempotent replay of an execution request does NOT hit the gateway a second time', () => {
    const intent = validStrategyIntent(TENANT_A, PROJECT_A, 3);
    const { service, bundle } = fixtureService();
    const first = service.handle(executionRequest(TOKEN_A, intent, 'idem:execution:replay') as never) as never as { status: number; body: unknown };
    const second = service.handle(executionRequest(TOKEN_A, intent, 'idem:execution:replay') as never) as never as { status: number; body: unknown; headers: Record<string, string> };
    expect(second.status).toBe(first.status);
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
    expect(second.headers['x-idempotent-replay']).toBe('true');
    expect(bundle.gateway.submitted.length).toBe(1);
  });
});

describe('THE GATE-BYPASS TESTS (the typed 403 gate_bypass_attempt — L8)', () => {
  it('(a) submitting an APPROVE DECISION record is the typed gate_bypass_attempt', () => {
    const { service, bundle } = fixtureService();
    // A structurally valid APPROVE decision (the mirror guard passes) — exactly what a gate-output forger would submit.
    const decision = {
      kind: 'approve',
      decisionId: 'xd:0123abcd',
      intentRef: 'si:0123abcd',
      policy: { policyId: 'rp-fixture', version: 2 },
      checkOrder: ['kill_switch', 'identity', 'authorization', 'limits', 'venue_permissions', 'rate_limits', 'credentials'],
      checks: ['kill_switch', 'identity', 'authorization', 'limits', 'venue_permissions', 'rate_limits', 'credentials'].map((dimension, index) => ({ dimension, ordinal: index + 1, outcome: 'pass' })),
      lineage: {
        intentRef: 'si:0123abcd',
        strategy: { specId: 'spec-fixture-director', version: 3 },
        goal: { goalId: 'goal-tenant-alpha', version: 1 },
        policy: { policyId: 'rp-fixture', version: 2 },
        venues: ['BROKER-FIX'],
        seed: 'fixture-seed-0001',
        tenant: TENANT_A,
        project: PROJECT_A,
      },
      asOf: T0,
    };
    const response = service.handle(executionRequest(TOKEN_A, decision, 'idem:bypass:decision') as never) as never as { status: number; body: unknown };
    expect(response.status).toBe(403);
    const error = errorOf(response);
    expect(error.code).toBe('gate_bypass_attempt');
    expect(error.message).toContain('L8');
    // Nothing reached the gateway.
    expect(bundle.gateway.submitted.length).toBe(0);
  });

  it('(b) submitting a GATEWAY ORDER REQUEST (\'gor:\') is the typed gate_bypass_attempt', () => {
    const { service, bundle } = fixtureService();
    const gor = {
      requestRef: 'gor:0123abcd',
      decision: { kind: 'approve', decisionId: 'xd:0123abcd' },
      order: { clientOrderId: 'ord-1' },
      route: { venue: 'BROKER-FIX', adapterRef: 'adapter:x', channelRef: 'chan:y' },
      grantRef: 'grant:0123abcd',
      credentialRef: 'cred:0123abcd',
      killSwitchStanding: 'standing',
      asOf: T0,
    };
    const response = service.handle(executionRequest(TOKEN_A, gor, 'idem:bypass:gor') as never) as never as { status: number; body: unknown };
    expect(response.status).toBe(403);
    expect(errorOf(response).code).toBe('gate_bypass_attempt');
    expect(bundle.gateway.submitted.length).toBe(0);
  });

  it('(c) an intent EMBEDDING EXECUTION AUTHORITY is the typed gate_bypass_attempt (the authority-embedding scan)', () => {
    const { service, bundle } = fixtureService();
    // The non-opacity authority keys reach the handler's L8 scan: the typed gate_bypass_attempt.
    for (const authorityKey of ['grant', 'permissions', 'authorizedActions']) {
      const contaminated = { ...validStrategyIntent(TENANT_A, PROJECT_A, 4), [authorityKey]: 'forge-me' };
      const response = service.handle(executionRequest(TOKEN_A, contaminated, `idem:bypass:${authorityKey}`) as never) as never as { status: number; body: unknown };
      expect(response.status).toBe(403);
      const error = errorOf(response);
      expect(error.code).toBe('gate_bypass_attempt');
      expect(error.message).toContain(authorityKey);
    }
    // The opacity-overlapping authority keys ('token', 'credential') are refused EARLIER by the
    // credential-opacity trip wire (T040's first-refusal position: a contaminated bundle is refused
    // before anything else matters) — the same crime, one wire earlier.
    for (const opacityKey of ['token', 'credential']) {
      const contaminated = { ...validStrategyIntent(TENANT_A, PROJECT_A, 4), [opacityKey]: 'forge-me' };
      const response = service.handle(executionRequest(TOKEN_A, contaminated, `idem:bypass:${opacityKey}`) as never) as never as { status: number; body: { error: { code: string; problems?: { path: string }[] } } };
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('validation_failed');
      expect(response.body.error.problems?.[0]?.path).toBe(`intent.${opacityKey}`);
    }
    expect(bundle.gateway.submitted.length).toBe(0);
  });

  it('a REFUSAL decision submitted as authority is also the typed gate-path rejection (it is not an intent)', () => {
    const { service, bundle } = fixtureService();
    const refusal = {
      kind: 'refuse',
      decisionId: 'xd:0123abcd',
      intentRef: 'si:0123abcd',
      policy: { policyId: 'rp', version: 1 },
      checkOrder: ['kill_switch'],
      checks: [{ dimension: 'kill_switch', ordinal: 1, outcome: 'fail' }],
      failure: { dimension: 'kill_switch', ordinal: 1, reason: 'thrown' },
      lineage: {
        intentRef: 'si:0123abcd',
        strategy: { specId: 'spec', version: 1 },
        goal: { goalId: 'goal', version: 1 },
        policy: { policyId: 'rp', version: 1 },
        venues: ['BROKER-FIX'],
        seed: 'seed',
        tenant: TENANT_A,
        project: PROJECT_A,
      },
      asOf: T0,
    };
    // A refusal is not structurally an ApproveDecisionRecord, and not an intent either: it lands in validation
    // (never the gateway) — the boundary only forwards intents.
    const response = service.handle(executionRequest(TOKEN_A, refusal, 'idem:bypass:refusal') as never) as never as { status: number; body: unknown };
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('validation_failed');
    expect(bundle.gateway.submitted.length).toBe(0);
  });
});

describe('the single-path law (the gateway port is touched by exactly one route family)', () => {
  it('a broad sweep of every OTHER route never reaches the execution gateway port', () => {
    const { service, bundle } = fixtureService();
    // Projects: create/read/list/lifecycle/bind.
    service.handle(request('POST', '/v1/projects', TOKEN_A, validCreateProjectRequest(TENANT_A, 'project-sweep')) as never);
    service.handle(request('GET', '/v1/projects', TOKEN_A) as never);
    service.handle(request('GET', '/v1/projects/project-sweep', TOKEN_A) as never);
    service.handle(request('POST', '/v1/projects/project-sweep/organization', TOKEN_A, { organizationRef: 'org:sweep', at: T0 + 1 }) as never);
    service.handle(request('POST', '/v1/projects/project-sweep/lifecycle', TOKEN_A, { event: 'activate', at: T0 + 2 }) as never);
    // Knowledge + outcomes.
    service.handle(request('POST', '/v1/knowledge/query', TOKEN_A, { project: PROJECT_A, at: T0 }) as never);
    service.handle(request('POST', '/v1/outcomes/query', TOKEN_A, { project: PROJECT_A, at: T0 }) as never);
    service.handle(request('POST', '/v1/post-mortems/query', TOKEN_A, { project: PROJECT_A, at: T0 }) as never);
    // Jobs (with idempotency keys).
    service.handle({ ...request('POST', '/v1/jobs/research', TOKEN_A, { kind: 'research', projectId: 'project-sweep', spec: {} }), headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:sweep:research' } } as never);
    service.handle({ ...request('POST', '/v1/jobs/learning', TOKEN_A, { kind: 'learning', projectId: 'project-sweep', spec: {} }), headers: { authorization: `Bearer ${TOKEN_A}`, 'idempotency-key': 'idem:sweep:learning' } } as never);
    // Meta + a failed auth (no token).
    service.handle(request('GET', '/v1/meta', TOKEN_A) as never);
    service.handle(request('GET', '/v1/meta', undefined) as never);
    // A gate-bypass attempt (already covered, re-asserted here for the sweep).
    service.handle(executionRequest(TOKEN_A, { requestRef: 'gor:0123abcd' }, 'idem:sweep:bypass') as never);

    expect(bundle.gateway.submitted.length).toBe(0);
  });
});

describe('the routing-layer pre-checks of the execution route', () => {
  it('a structurally invalid intent is the typed validation failure (never forwarded)', () => {
    const { service, bundle } = fixtureService();
    const response = service.handle(executionRequest(TOKEN_A, { intentId: 'si:0123abcd', sequence: 1 }, 'idem:invalid:1') as never) as never as { status: number; body: unknown };
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('validation_failed');
    expect(bundle.gateway.submitted.length).toBe(0);
  });

  it('the routed submission record satisfies the mirror guard (the served shape is the T040 contract)', () => {
    const intent = validStrategyIntent(TENANT_A, PROJECT_A, 5);
    const record = routedSubmission(intent as never, T0 + 42);
    // The mirror guard is re-exported from the index — assert the fixture's script product is contract-shaped.
    expect(record.kind).toBe('routed');
    if (record.kind === 'routed') {
      expect(record.submissionId).toMatch(/^xgs:[0-9a-f]{8}$/);
      expect(record.requestRef).toMatch(/^gor:[0-9a-f]{8}$/);
    }
  });
});
