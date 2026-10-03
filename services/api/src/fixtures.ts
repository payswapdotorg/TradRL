/**
 * @tradrl/api-service — the deterministic test fixtures: the fake
 * backing-service ports, the two-plane credential set and the valid
 * request-body builders (T007 goal/constraint/project shapes, the
 * T018/T019 strategy-intent shape).
 *
 * Every fake is a RECORDING fake: the tests assert not just the
 * responses but WHAT reached the backing services (the L8 law's
 * positive half — the gateway port receives exactly the forwarded
 * intents, nothing else, from exactly one route).
 */

import { canonicalJson, deepFreeze, fnv1a32Hex } from './primitives';
import type { ApiResponse } from './contracts';
import { isApiSuccessBody } from './test-helpers';
import type { JobRecord, OrgStatusSnapshot } from './contracts';
import type { ControlPlanePort, ExecutionGatewayPort, FirmMemoryPort, JobSubmissionPort, OutcomeLearningPort, PortResult } from './ports';
import type { GatewaySubmissionRecord, ProjectRecord, Scope, StrategyIntent, ServedKnowledge } from './mirrors';
import { isProjectRecord } from './mirrors';
import type { OutcomeQuery, OutcomeQueryOptions, OutcomeRecordMirror, PostMortemQuery, PostMortemRecordMirror } from './mirrors-outcomes';
import { mintJobId } from './ids';
import { createApiService } from './service';
import { scriptedInstants } from './instants';

// ---------------------------------------------------------------------------
// The scenario clock and scopes
// ---------------------------------------------------------------------------

export const T0 = 1_720_000_000_000;
export const TENANT_A = 'tenant-alpha';
export const TENANT_B = 'tenant-beta';
export const PROJECT_A = 'project-alpha-1';
export const PROJECT_B = 'project-beta-1';
export const TOKEN_A = 'tok-dev-alpha-0001';
export const TOKEN_B = 'tok-dev-beta-0002';
export const TOKEN_A_READONLY = 'tok-dev-alpha-0003';
export const TOKEN_INTERNAL_RUNTIME = 'tok-int-agent-runtime-0004';
export const TOKEN_INTERNAL_JOBS = 'tok-int-job-machinery-0005';
export const TOKEN_INTERNAL_USAGE = 'tok-int-usage-reader-0006';
export const PRINCIPAL_A = 'developer-alpha';
export const PRINCIPAL_B = 'developer-beta';

/** The default rate budget of the fixture service (generous; the rate tests construct their own). */
export const FIXTURE_RATE_LIMIT = { windowMs: 60_000, maxRequests: 1000 };

// ---------------------------------------------------------------------------
// The T007 request-body builders (valid, tenant-scoped)
// ---------------------------------------------------------------------------

export function validGoal(tenant: string, version = 1): Record<string, unknown> {
  return deepFreeze({
    id: `goal-${tenant}`,
    version,
    tenantId: tenant,
    objective: `Beat the risk-adjusted benchmark for ${tenant} with bounded drawdown`,
    horizon: { startsAt: T0, endsAt: T0 + 90 * 24 * 3_600_000, label: 'Q3 evaluation window' },
    successCriteria: {
      criteria: [
        { id: 'c-return', metric: 'returns.sharpe', predicate: { kind: 'limit.min', bound: 1.0 }, description: 'risk-adjusted return' },
        { id: 'c-drawdown', metric: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.15 } },
        { id: 'c-costs', metric: 'costs.bps', predicate: { kind: 'limit.max', bound: 25 } },
      ],
      requiredSatisfaction: 2 / 3,
    },
    evaluation: { blindRef: 'blind:v1', walkForwardRef: 'wf:v1', regimeRef: 'regime:v1', adversarialRequired: true },
    createdAt: T0 - 1000,
    description: 'the reference goal of the API fixtures',
  });
}

export function validConstraintSet(tenant: string, version = 1): Record<string, unknown> {
  return deepFreeze({
    id: `cs-${tenant}`,
    version,
    tenantId: tenant,
    name: 'the fixture constraint set',
    constraints: [
      { id: 'k-position', domain: 'state', subject: 'position.grossExposure', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' },
      { id: 'k-turnover', domain: 'action', subject: 'costs.dailyTurnover', predicate: { kind: 'limit.max', bound: 500 }, severity: 'advisory' },
    ],
    createdAt: T0 - 1000,
  });
}

export function validCreateProjectRequest(tenant: string, projectId: string, name = 'the fixture project'): Record<string, unknown> {
  return deepFreeze({
    id: projectId,
    name,
    executionMode: 'simulation',
    goal: validGoal(tenant),
    constraintSet: validConstraintSet(tenant),
    at: T0,
  });
}

// ---------------------------------------------------------------------------
// The T018/T019 strategy-intent builder (valid, scope-carried)
// ---------------------------------------------------------------------------

export function validStrategyIntent(tenant: string, project: string, sequence = 1): Record<string, unknown> {
  const content = {
    sequence,
    order: {
      clientOrderId: `ord-${tenant}-${sequence}`,
      instrumentId: 'BTC-USD',
      venueId: 'BROKER-FIX',
      side: 'buy',
      kind: 'limit',
      quantity: '0.75',
      price: '61000.50',
      timeInForce: 'gtc',
      createdAt: new Date(T0 + sequence * 1000).toISOString(),
      notes: 'the fixture intent',
    },
    constraintProof: {
      constraintSet: { id: `cs-${tenant}`, version: 1 },
      satisfied: [
        { constraintId: 'k-position', domain: 'state', subject: 'position.grossExposure', severity: 'blocking', predicate: { kind: 'limit.max', bound: 2 }, observed: '1.5' },
      ],
      advisoryViolations: [],
    },
    goal: { goalId: `goal-${tenant}`, version: 1 },
    strategy: { specId: 'spec-fixture-director', version: 3 },
    windowRefs: ['win:fixture-1', 'win:fixture-2'],
    seed: 'fixture-seed-0001',
    tenant,
    project,
    riskPolicyRefs: ['rp-fixture@2'],
    rationale: { kind: 'rebalance_drift', instrumentId: 'BTC-USD', targetWeight: '0.25', currentWeight: '0.18', drift: '0.07' },
    asOf: T0 + sequence * 1000,
  };
  return deepFreeze({ ...content, intentId: `si:${fnv1a32Hex(canonicalJson(content as never))}` });
}

// ---------------------------------------------------------------------------
// The fake control-plane port (in-memory, tenant-scoped)
// ---------------------------------------------------------------------------

interface FakeProjectEntry {
  readonly record: ProjectRecord;
}

/** The fake control plane: create/get/list/transition/bind over an in-memory map (mirrors T007's semantics). */
export function fakeControlPlane(): ControlPlanePort & { readonly store: ReadonlyMap<string, FakeProjectEntry> } {
  const store = new Map<string, FakeProjectEntry>();
  const key = (tenant: string, project: string) => `${tenant}/${project}`;
  return {
    store,
    createProject(input): PortResult<ProjectRecord> {
      const k = key(input.tenantId as string, input.id as string);
      if (store.has(k)) {
        return { ok: false, error: { code: 'conflict', message: 'a project with this id already exists in the tenant scope' } };
      }
      const record: ProjectRecord = deepFreeze({
        id: input.id,
        tenantId: input.tenantId,
        name: input.name,
        executionMode: input.executionMode as ProjectRecord['executionMode'],
        lifecycle: deepFreeze({ projectId: input.id, status: 'draft', acceptanceCriteriaId: `ac:${fnv1a32Hex(canonicalJson([input.goal] as never))}` as ProjectRecord['lifecycle']['acceptanceCriteriaId'], organizationRef: null }),
        lineage: deepFreeze({
          projectId: input.id,
          goal: { goalId: (input.goal as { id: string }).id as ProjectRecord['lineage']['goal']['goalId'], version: (input.goal as { version: number }).version },
          constraintSet: { id: (input.constraintSet as { id: string }).id as ProjectRecord['lineage']['constraintSet']['id'], version: (input.constraintSet as { version: number }).version },
        }),
        createdAt: input.at as ProjectRecord['createdAt'],
        updatedAt: input.at as ProjectRecord['updatedAt'],
      });
      store.set(k, { record });
      return { ok: true, value: record };
    },
    getProject(tenantId, projectId): PortResult<ProjectRecord> {
      const entry = store.get(key(tenantId as string, projectId as string));
      if (entry === undefined) {
        // T007's law mirrored: unknown and cross-tenant are indistinguishable.
        return { ok: false, error: { code: 'project-not-found', message: 'project not found for the requesting tenant' } };
      }
      return { ok: true, value: entry.record };
    },
    projectsOf(tenantId): PortResult<readonly ProjectRecord[]> {
      const records = [...store.values()].filter((e) => e.record.tenantId === tenantId).map((e) => e.record);
      return { ok: true, value: Object.freeze(records) };
    },
    transition(input): PortResult<{ record: ProjectRecord; effects: readonly unknown[] }> {
      const entry = store.get(key(input.tenantId as string, input.projectId as string));
      if (entry === undefined) {
        return { ok: false, error: { code: 'project-not-found', message: 'project not found for the requesting tenant' } };
      }
      const legal: Record<string, Record<string, string>> = {
        activate: { draft: 'active' },
        pause: { active: 'paused' },
        resume: { paused: 'active' },
        complete: { active: 'completed', paused: 'completed' },
        abandon: { draft: 'abandoned', active: 'abandoned', paused: 'abandoned' },
        archive: { draft: 'archived', paused: 'archived' },
      };
      const target = legal[input.event]?.[entry.record.lifecycle.status];
      if (target === undefined) {
        return { ok: false, error: { code: 'illegal-transition', message: `the transition ${entry.record.lifecycle.status} --${input.event}--> is illegal` } };
      }
      if ((target === 'active' || input.event === 'complete') && entry.record.lifecycle.acceptanceCriteriaId === null) {
        return { ok: false, error: { code: 'missing-acceptance-criteria', message: 'compile the goal first' } };
      }
      const next: ProjectRecord = deepFreeze({
        ...entry.record,
        lifecycle: deepFreeze({ ...entry.record.lifecycle, status: target as ProjectRecord['lifecycle']['status'] }),
        updatedAt: input.at as ProjectRecord['updatedAt'],
      });
      store.set(key(input.tenantId as string, input.projectId as string), { record: next });
      return { ok: true, value: { record: next, effects: [] } };
    },
    bindOrganization(input): PortResult<ProjectRecord> {
      const entry = store.get(key(input.tenantId as string, input.projectId as string));
      if (entry === undefined) {
        return { ok: false, error: { code: 'project-not-found', message: 'project not found for the requesting tenant' } };
      }
      if (entry.record.lifecycle.status !== 'draft' && entry.record.lifecycle.status !== 'paused') {
        return { ok: false, error: { code: 'invalid-binding-state', message: `cannot bind while ${entry.record.lifecycle.status}` } };
      }
      const next: ProjectRecord = deepFreeze({
        ...entry.record,
        lifecycle: deepFreeze({ ...entry.record.lifecycle, organizationRef: input.organizationRef as ProjectRecord['lifecycle']['organizationRef'] }),
        updatedAt: input.at as ProjectRecord['updatedAt'],
      });
      store.set(key(input.tenantId as string, input.projectId as string), { record: next });
      return { ok: true, value: next };
    },
  };
}

// ---------------------------------------------------------------------------
// The fake firm-memory port (READ only; serves a fixed record set)
// ---------------------------------------------------------------------------

export function fakeFirmMemory(records: readonly ServedKnowledge[]): FirmMemoryPort {
  return {
    queryKnowledge(query, options): PortResult<readonly ServedKnowledge[]> {
      const served = records.filter((entry) => {
        if (entry.record.tenant !== query.tenant) return false;
        if (entry.record.project !== query.project) return false;
        if (query.kinds !== undefined && !query.kinds.includes(entry.record.claim.kind)) return false;
        if (query.knowledgeId !== undefined && entry.record.knowledgeId !== query.knowledgeId) return false;
        if (options.activeOnly === true && entry.status !== 'active') return false;
        return true;
      });
      return { ok: true, value: Object.freeze(served) };
    },
  };
}

// ---------------------------------------------------------------------------
// The fake outcome-learning port (READ only)
// ---------------------------------------------------------------------------

export function fakeOutcomeLearning(outcomes: readonly OutcomeRecordMirror[], postMortems: readonly PostMortemRecordMirror[]): OutcomeLearningPort {
  return {
    queryOutcomes(query: OutcomeQuery, _options: OutcomeQueryOptions): PortResult<readonly OutcomeRecordMirror[]> {
      void _options;
      const served = outcomes.filter((record) => record.tenant === query.tenant && record.project === query.project);
      return { ok: true, value: Object.freeze(served) };
    },
    queryPostMortems(query: PostMortemQuery, _options: OutcomeQueryOptions): PortResult<readonly PostMortemRecordMirror[]> {
      void _options;
      const served = postMortems.filter((record) => record.lineage.tenant === query.tenant && record.lineage.project === query.project);
      return { ok: true, value: Object.freeze(served) };
    },
  };
}

// ---------------------------------------------------------------------------
// The RECORDING execution-gateway port (the L8 tests' witness)
// ---------------------------------------------------------------------------

/** A scripted gateway submission outcome (what the fake returns per call). */
export type GatewayScript = (intent: StrategyIntent, call: number) => GatewaySubmissionRecord;

/** The recording fake: captures EVERY submitted intent; serves the scripted outcome. */
export function recordingGateway(script: GatewayScript): ExecutionGatewayPort & { readonly submitted: readonly StrategyIntent[] } {
  const submitted: StrategyIntent[] = [];
  return {
    get submitted(): readonly StrategyIntent[] {
      return Object.freeze([...submitted]);
    },
    submitRequest(intent: StrategyIntent): PortResult<GatewaySubmissionRecord> {
      submitted.push(intent);
      return { ok: true, value: script(intent, submitted.length) };
    },
  };
}

/** A scripted ROUTED submission (the happy path). */
export function routedSubmission(intent: StrategyIntent, at: number): GatewaySubmissionRecord {
  return deepFreeze({
    kind: 'routed',
    submissionId: `xgs:${fnv1a32Hex(canonicalJson(['routed', intent.intentId, at] as never))}`,
    decisionId: `xd:${fnv1a32Hex(canonicalJson(['decision', intent.intentId] as never))}`,
    auditId: `xga:${fnv1a32Hex(canonicalJson(['audit', intent.intentId] as never))}`,
    requestRef: `gor:${fnv1a32Hex(canonicalJson(['gor', intent.intentId] as never))}`,
    venue: intent.order.venueId,
    adapterRef: 'adapter:fixture-broker',
    channelRef: 'chan:fixture-main',
    routedAt: at as GatewaySubmissionRecord extends { routedAt: infer R } ? R : never,
  });
}

// ---------------------------------------------------------------------------
// The fake job-submission port (the async pattern's engine)
// ---------------------------------------------------------------------------

export function fakeJobSubmission(): JobSubmissionPort & { readonly submissions: readonly { readonly kind: string; readonly tenant: string; readonly project: string; readonly spec: unknown; readonly at: number }[] } {
  const submissions: { kind: string; tenant: string; project: string; spec: unknown; at: number }[] = [];
  return {
    get submissions() {
      return Object.freeze([...submissions]);
    },
    submitJob(input): PortResult<JobRecord> {
      submissions.push({ kind: input.kind, tenant: input.tenant as string, project: input.project as string, spec: input.spec, at: input.at });
      const record: JobRecord = deepFreeze({
        jobId: mintJobId(fnv1a32Hex(canonicalJson([input.kind, input.tenant, input.project, input.spec, input.at, submissions.length] as never))),
        kind: input.kind,
        tenant: input.tenant,
        project: input.project,
        status: 'submitted',
        submittedAt: input.at,
      });
      return { ok: true, value: record };
    },
  };
}

// ---------------------------------------------------------------------------
// The two-plane credential set
// ---------------------------------------------------------------------------

/** The fixture credential registrations: two tenants (one full, one read-mostly) + three internal services. */
export function fixtureCredentials(): readonly { credential: Record<string, unknown>; token: string }[] {
  return deepFreeze([
    {
      credential: {
        kind: 'developer',
        credentialId: `dev:${fnv1a32Hex(canonicalJson(['dev', TENANT_A, PRINCIPAL_A]))}`,
        tenant: TENANT_A,
        principal: PRINCIPAL_A,
        permissions: ['meta:read', 'projects:read', 'projects:write', 'knowledge:read', 'outcomes:read', 'jobs:read', 'jobs:write', 'execution:write', 'organizations:read'],
      },
      token: TOKEN_A,
    },
    {
      credential: {
        kind: 'developer',
        credentialId: `dev:${fnv1a32Hex(canonicalJson(['dev', TENANT_B, PRINCIPAL_B]))}`,
        tenant: TENANT_B,
        principal: PRINCIPAL_B,
        permissions: ['meta:read', 'projects:read', 'projects:write', 'knowledge:read', 'outcomes:read', 'jobs:read', 'jobs:write', 'execution:write', 'organizations:read'],
      },
      token: TOKEN_B,
    },
    {
      credential: {
        kind: 'developer',
        credentialId: `dev:${fnv1a32Hex(canonicalJson(['dev', TENANT_A, 'reader']))}`,
        tenant: TENANT_A,
        principal: 'reader-alpha',
        permissions: ['meta:read', 'projects:read', 'knowledge:read', 'outcomes:read', 'jobs:read', 'organizations:read'],
      },
      token: TOKEN_A_READONLY,
    },
    {
      credential: {
        kind: 'internal',
        credentialId: `int:${fnv1a32Hex(canonicalJson(['int', 'agent-runtime']))}`,
        principal: 'agent-runtime',
        permissions: ['internal:organizations:write'],
      },
      token: TOKEN_INTERNAL_RUNTIME,
    },
    {
      credential: {
        kind: 'internal',
        credentialId: `int:${fnv1a32Hex(canonicalJson(['int', 'job-machinery']))}`,
        principal: 'job-machinery',
        permissions: ['internal:jobs:write'],
      },
      token: TOKEN_INTERNAL_JOBS,
    },
    {
      credential: {
        kind: 'internal',
        credentialId: `int:${fnv1a32Hex(canonicalJson(['int', 'usage-reader']))}`,
        principal: 'usage-reader',
        permissions: ['internal:usage:read'],
      },
      token: TOKEN_INTERNAL_USAGE,
    },
  ]);
}

// ---------------------------------------------------------------------------
// The org-status snapshot builder
// ---------------------------------------------------------------------------

export function validOrgStatusSnapshot(tenant: string, project: string, organizationRef = 'org:fixture-organization'): OrgStatusSnapshot {
  return deepFreeze({
    organizationRef: organizationRef as OrgStatusSnapshot['organizationRef'],
    tenant: tenant as OrgStatusSnapshot['tenant'],
    project: project as OrgStatusSnapshot['project'],
    status: 'active',
    at: T0 + 5000 as OrgStatusSnapshot['at'],
    instanceRefs: ['ai:director-1', 'ai:researcher-2'],
  });
}

// ---------------------------------------------------------------------------
// The request builders
// ---------------------------------------------------------------------------

export function request(method: string, path: string, token: string | undefined, body?: unknown, query?: Record<string, string>): Record<string, unknown> {
  return {
    method,
    path,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body }),
    ...(query === undefined ? {} : { query }),
  };
}

/** Extract the success data of a response (fails the test loudly when the response is an error). */
export function dataOf(response: unknown): unknown {
  const body = (response as { body?: unknown }).body;
  if (body === null || typeof body !== 'object' || !('data' in (body as Record<string, unknown>))) {
    throw new Error(`expected a success envelope, got: ${JSON.stringify(response)}`);
  }
  return (body as { data: unknown }).data;
}

/** Extract the typed error of a response. */
export function errorOf(response: unknown): { code: string; message: string; status: number } {
  const body = (response as { body?: unknown }).body;
  if (body === null || typeof body !== 'object' || !('error' in (body as Record<string, unknown>))) {
    throw new Error(`expected an error envelope, got: ${JSON.stringify(response)}`);
  }
  return (body as { error: { code: string; message: string; status: number } }).error;
}

export { isApiSuccessBody };

/** The fixture serving policy forwarded to the knowledge port (T034's ServingPolicy shape, mirrored opaquely). */
export const FIXTURE_KNOWLEDGE_RETENTION = deepFreeze({ historyWindowMs: Number.MAX_SAFE_INTEGER });

/** The fixture retention forwarded to the outcome port (T033's shape, mirrored opaquely). */
export const FIXTURE_OUTCOME_RETENTION = deepFreeze({ outcomeWindowMs: Number.MAX_SAFE_INTEGER, postMortemWindowMs: Number.MAX_SAFE_INTEGER });

/** The fixture knowledge records (served by the fake firm memory). */
export function fixtureKnowledge(tenant: string, project: string): readonly ServedKnowledge[] {
  const base = {
    ordinal: 1,
    tenant,
    project,
    claim: { kind: 'decision_pattern' as const, polarity: 'harmful' as const, dimension: 'timing' as const, lagBand: null },
    confidence: '0.8',
    evidenceCount: 2,
    provenance: {
      postMortemRefs: ['pmr:aaaa0001', 'pmr:aaaa0002'],
      outcomeRefs: ['out:bbbb0001', 'out:bbbb0002'],
      experimentRefs: [],
      trialRefs: [],
      trajectoryRefs: [],
      sessionRefs: ['shs:cccc0001'],
    },
    validity: { from: T0 - 10_000, to: T0 + 10 * 24 * 3_600_000 },
    asOf: T0 - 10_000,
    priorChainHead: '00000000',
  };
  const knowledgeId = `fkr:${fnv1a32Hex(canonicalJson(base as never))}`;
  return deepFreeze([{ record: deepFreeze({ ...base, knowledgeId }) as unknown as ServedKnowledge['record'], status: 'active' as const, supersededBy: null }]);
}

// ---------------------------------------------------------------------------
// The fixture service builder (the whole composition, ready to drive)
// ---------------------------------------------------------------------------

/** Everything the fixture service is built from (the tests reach the fakes for assertions). */
export interface FixtureBundle {
  readonly controlPlane: ReturnType<typeof fakeControlPlane>;
  readonly gateway: ReturnType<typeof recordingGateway>;
  readonly jobs: ReturnType<typeof fakeJobSubmission>;
  readonly clock: { next(): number; remaining(): number };
  readonly knowledge: FirmMemoryPort;
  readonly outcomes: OutcomeLearningPort;
}

/** The fixture service + the fakes it was built from. */
export interface FixtureService {
  readonly service: import('./service').ApiService;
  readonly bundle: FixtureBundle;
}

/**
 * Build the fixture service: both planes' credentials, all five fake
 * ports, a scripted clock (default: 500 instants at T0 + i ms), and
 * the deterministic serving policies.
 */
export function fixtureService(options: { readonly instants?: readonly number[]; readonly rateLimit?: { windowMs: number; maxRequests: number }; readonly gatewayScript?: GatewayScript; readonly knowledge?: FirmMemoryPort; readonly outcomes?: OutcomeLearningPort } = {}): FixtureService {
  const instants = options.instants ?? Array.from({ length: 500 }, (_, index) => T0 + index);
  const clock = scriptedInstants(instants);
  const controlPlane = fakeControlPlane();
  const gateway = recordingGateway(options.gatewayScript ?? ((intent, call) => routedSubmission(intent, instants[call - 1] ?? T0)));
  const jobs = fakeJobSubmission();
  const knowledge = options.knowledge ?? fakeFirmMemory([...fixtureKnowledge(TENANT_A, PROJECT_A), ...fixtureKnowledge(TENANT_B, PROJECT_B)]);
  const outcomes = options.outcomes ?? fakeOutcomeLearning([], []);
  const construction = createApiService({
    credentials: fixtureCredentials(),
    controlPlane,
    firmMemory: knowledge,
    outcomeLearning: outcomes,
    executionGateway: gateway,
    jobSubmission: jobs,
    instants: clock,
    ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
    knowledgeRetention: FIXTURE_KNOWLEDGE_RETENTION,
    outcomeRetention: FIXTURE_OUTCOME_RETENTION,
  });
  if (!construction.ok) {
    throw new Error(`fixtureService construction failed: ${construction.errors.map((e) => e.message).join('; ')}`);
  }
  return { service: construction.service, bundle: { controlPlane, gateway, jobs, clock, knowledge, outcomes } };
}
