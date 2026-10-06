// deploy/wire/smoketest.ts — THE CI-RUNNABLE SMOKESTEST (T052, W-3d).
//
// Boots the deployment composition (deploy/wire/composition.ts) with
// the FULL provider environment against FAKE fetches (no real provider
// calls, no real credentials — FIXED FAKE values), then drives one
// request through each port's HAPPY PATH and one DEGRADED PATH,
// asserting the typed records at every step. Runs under plain vitest
// (wire.test.ts imports and runs it — a PASS here means the whole
// composition boots and behaves).
//
// The five fake providers speak the real wire formats (the same
// envelopes the adapters' clients parse): Neon SQL-over-HTTP, Upstash
// REST, R2 S3+SigV4, Resend JSON, Apify REST v2 — all over one shared
// fake fetch with an injectable failure switch (the R46 lever).
//
// Spec anchors: R46 (degradation is typed, never a crash), L12, L20,
// D-033.

import { NeonFirmMemoryStore, NeonOutcomeLearningStore } from '../adapters/neon/stores';
import { composeDeploymentAdapters, enabledAdapters, type ProviderEnv } from './composition';
import type { ComposedDeployment } from './composition';
import type { FetchLike, InstantSourceMirror, StoreResult } from '../adapters/shared';
import type { ControlPlanePortMirror, ExecutionGatewayPortMirror } from './ports';

// ---------------------------------------------------------------------------
// The full fake environment (every adapter enabled; FIXED FAKE values)
// ---------------------------------------------------------------------------

/** The full provider env (fake — the happy-path boot). */
export function fakeProviderEnv(): ProviderEnv {
  return {
    neon: { host: 'ep-demo-pooler.us-east-2.aws.neon.tech', database: 'neondb', user: 'neondb_owner', apiKey: 'fake-neon-key-demo' },
    upstash: { url: 'https://tradrl-demo.upstash.io', token: 'fake-upstash-token-demo' },
    r2: { accountId: 'demo-account-id', accessKeyId: 'AKIDFAKEFAKEFAKEFAKE', secretAccessKey: 'fake-secret-access-key-demo', bucket: 'demo-bucket' },
    resend: { apiKey: 're_fake_api_key_demo', from: 'TradRL Console <console@demo.tradrl.example>' },
    apify: { apiToken: 'apify_api_token_fake_demo' },
  };
}

// ---------------------------------------------------------------------------
// The fake multi-provider fetch (the real wire envelopes, one switch)
// ---------------------------------------------------------------------------

/** The fake providers' state + the failure lever (the R46 lever). */
export interface FakeProviders {
  readonly fetchLike: FetchLike;
  /** Flip to degrade every provider (the R46 probe). */
  failAll(): void;
  /** The observed requests (per provider — the determinism surface). */
  readonly seen: { neon: number; upstash: number; r2: number; resend: number; apify: number };
}

/** Build the fake provider fleet over the real wire formats. */
export function fakeProviders(): FakeProviders {
  const seen = { neon: 0, upstash: 0, r2: 0, resend: 0, apify: 0 };
  const redis = new Map<string, string>();
  const objects = new Map<string, string>();
  const tables = new Map<string, { params: readonly string[] }[]>();
  let failing = false;
  const responder = (text: string, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  });
  const fetchLike: FetchLike = async (url, init) => {
    if (failing) throw new Error('connection refused (simulated provider outage)');
    // Neon: POST {host}/sql
    if (url.endsWith('/sql')) {
      seen.neon += 1;
      const parsed = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { query: string; params: string[] };
      const insert = /^INSERT INTO (tradrl_\w+) \(([^)]+)\)/.exec(parsed.query);
      if (insert !== null) {
        const table = insert[1] as string;
        const columns = (insert[2] ?? '').split(',').map((column) => column.trim());
        const rows = tables.get(table) ?? [];
        // Upsert fidelity (W-25D): an `ON CONFLICT (…) DO UPDATE` replaces the
        // row with the same conflict-key tuple — the same semantics the real
        // SQL has (the durable seam upserts project records + goal sets).
        const conflict = /ON CONFLICT \(([^)]+)\) DO UPDATE/.exec(parsed.query);
        if (conflict !== null) {
          const keyColumns = (conflict[1] ?? '').split(',').map((column) => column.trim());
          const keyIndexes = keyColumns.map((column) => columns.indexOf(column));
          const keyOf = (row: { params: readonly string[] }): string => keyIndexes.map((index) => row.params[index === -1 ? row.params.length : index]).join('\u0000');
          const incomingKey = keyIndexes.map((index) => parsed.params[index === -1 ? parsed.params.length : index]).join('\u0000');
          const existing = rows.findIndex((row) => keyOf(row) === incomingKey);
          if (existing >= 0) rows.splice(existing, 1);
        } else if (table === 'tradrl_project_events'
          && rows.some((row) => row.params[0] === parsed.params[0] && row.params[1] === parsed.params[1] && row.params[2] === parsed.params[2])) {
          // W-26C (R3, live-wire fidelity): the append-only event log's
          // PRIMARY KEY (tenant, project_id, ordinal) — the live Postgres
          // answers a colliding append with HTTP 400 carrying exactly this
          // message (the production incident's wire error, proven by the
          // Lead's live probes). The fake models the live PK so the
          // concurrent cold-boot race (two instances seeding simultaneously,
          // the loser's event colliding) is OBSERVABLE — the fakes match
          // the live wire, never the adapter's expectations.
          return responder(JSON.stringify({ message: 'duplicate key value violates unique constraint "tradrl_project_events_pkey"' }), 400);
        }
        rows.push({ params: parsed.params });
        tables.set(table, rows);
        return responder(JSON.stringify({ command: 'INSERT 0 1', rowCount: 1 }));
      }
      const select = /^SELECT payload FROM (tradrl_\w+)/.exec(parsed.query);
      if (select !== null) {
        const orderIndex = select[1] === 'tradrl_projects' ? 5 : select[1] === 'tradrl_project_goals' ? 1 : 3;
        const payloadIndex = select[1] === 'tradrl_projects' ? 6 : select[1] === 'tradrl_project_events' ? 5 : select[1] === 'tradrl_knowledge' ? 6 : select[1] === 'tradrl_project_goals' ? 2 : 7;
        let rows = (tables.get(select[1] as string) ?? []).filter((row) => row.params[0] === parsed.params[0]);
        if (parsed.query.includes('AND project = $2') || parsed.query.includes('AND project_id = $2')) {
          rows = rows.filter((row) => row.params[1] === parsed.params[1]);
        }
        rows = [...rows].sort((a, b) => Number(a.params[orderIndex]) - Number(b.params[orderIndex]));
        return responder(JSON.stringify({ fields: [{ name: 'payload', typeOID: 25 }], rows: rows.map((row) => [row.params[payloadIndex]]) }));
      }
      if (parsed.query.startsWith('SELECT COALESCE(MAX(ordinal)')) {
        const rows = (tables.get('tradrl_project_events') ?? []).filter((row) => row.params[0] === parsed.params[0] && row.params[1] === parsed.params[1]);
        const max = rows.reduce((accumulator, row) => Math.max(accumulator, Number(row.params[2])), 0);
        // W-26C (R3): the fake models the LIVE wire — int8 (BIGINT) columns
        // return as STRINGS even in array mode (the live proxy's JSON
        // precision guard: the Lead's live probes answered [["1"]] for
        // COALESCE(MAX(ordinal),0); the number form is exactly the
        // regression that shipped the production incident). The fakes
        // match the live wire, never the adapter's expectations.
        return responder(JSON.stringify({ fields: [{ name: 'coalesce', typeOID: 20 }], rows: [[String(max)]] }));
      }
      return responder(JSON.stringify({ message: 'unhandled' }), 500);
    }
    // Upstash: GET {url}/{command}/{args} or POST /pipeline
    if (url.includes('.upstash.io')) {
      seen.upstash += 1;
      const run = (command: readonly string[]): { result?: unknown; error?: string } => {
        const [name, ...args] = command;
        if (name === 'get') return { result: redis.get(args[0] ?? '') ?? null };
        if (name === 'del') return { result: redis.delete(args[0] ?? '') ? 1 : 0 };
        if (name === 'set') {
          const key = args[0] ?? '';
          const value = args[1] ?? '';
          if (args.includes('NX') && redis.has(key)) return { result: null };
          redis.set(key, value);
          return { result: 'OK' };
        }
        return { error: 'ERR unknown' };
      };
      if ((init?.method ?? 'GET') === 'POST') {
        const commands = JSON.parse(typeof init?.body === 'string' ? init.body : '[]') as string[][];
        return responder(JSON.stringify(commands.map((command) => run(command))));
      }
      const parts = url.slice('https://tradrl-demo.upstash.io/'.length).split('/').map((part) => decodeURIComponent(part));
      return responder(JSON.stringify(run(parts)));
    }
    // R2: the S3-compatible endpoint
    if (url.includes('.r2.cloudflarestorage.com')) {
      seen.r2 += 1;
      const path = url.split('.cloudflarestorage.com')[1]?.split('?')[0] ?? '';
      if ((init?.method ?? 'GET') === 'PUT') {
        objects.set(path, init?.body ?? '');
        return responder('');
      }
      if (objects.has(path)) {
        return (init?.method ?? 'GET') === 'HEAD' ? responder('') : responder(objects.get(path) ?? '');
      }
      return responder('<Error><Code>NoSuchKey</Code></Error>', 404);
    }
    // Resend: POST /emails
    if (url === 'https://api.resend.com/emails') {
      seen.resend += 1;
      return responder(JSON.stringify({ id: 'email_fake_1' }));
    }
    // Apify: the REST v2 surface
    if (url.includes('api.apify.com')) {
      seen.apify += 1;
      if (url.endsWith('/runs') && (init?.method ?? 'GET') === 'POST') {
        return responder(JSON.stringify({ data: { id: 'run_fake_1', status: 'RUNNING', defaultDatasetId: 'ds_fake_1' } }), 201);
      }
      if (url.includes('/actor-runs/')) {
        return responder(JSON.stringify({ data: { id: 'run_fake_1', status: 'RUNNING' } }));
      }
      if (url.includes('/datasets/')) {
        return responder(JSON.stringify([{ headline: 'demo' }]));
      }
    }
    return responder('unmatched', 404);
  };
  return { fetchLike, failAll: () => { failing = true; }, seen };
}

// ---------------------------------------------------------------------------
// The fake real-services delegates (the gateway + the control plane)
// ---------------------------------------------------------------------------

/** A fake REAL gateway (the L8 delegate — carried verbatim by the composition). */
export function fakeExecutionGateway(): ExecutionGatewayPortMirror {
  return {
    async submitRequest(intent) {
      const intentRecord = intent as { tenant?: unknown };
      if (typeof intentRecord?.tenant === 'string' && intentRecord.tenant.length > 0) {
        return { ok: true, value: { submissionId: 'gwys:fake-1', status: 'routed', intent } };
      }
      return { ok: false, error: { code: 'unavailable', message: 'the fake gateway refuses a tenant-less intent' } };
    },
  };
}

/** A fake REAL control plane (T007's law — the composition carries it verbatim). */
export function fakeControlPlane(): ControlPlanePortMirror {
  const projects = new Map<string, unknown>();
  return {
    async createProject(input) {
      const key = `${input.tenantId}/${input.id}`;
      const record = { id: input.id, tenantId: input.tenantId, name: input.name, executionMode: input.executionMode, lifecycle: { status: 'active' }, lineage: {}, createdAt: input.at, updatedAt: input.at };
      projects.set(key, record);
      return { ok: true, value: record };
    },
    async getProject(tenantId, projectId) {
      const record = projects.get(`${tenantId}/${projectId}`);
      return record === undefined
        ? { ok: false, error: { code: 'project_not_found', message: 'not found' } }
        : { ok: true, value: record };
    },
    async projectsOf(tenantId) {
      return { ok: true, value: [...projects.entries()].filter(([key]) => key.startsWith(`${tenantId}/`)).map(([, record]) => record) };
    },
    async transition(input) {
      const record = projects.get(`${input.tenantId}/${input.projectId}`) as { lifecycle?: { status?: string }; updatedAt?: number } | undefined;
      if (record === undefined) return { ok: false, error: { code: 'project_not_found', message: 'not found' } };
      record.lifecycle = { status: input.event };
      record.updatedAt = input.at;
      return { ok: true, value: { record, event: input.event, at: input.at } };
    },
    async bindOrganization(input) {
      const record = projects.get(`${input.tenantId}/${input.projectId}`);
      if (record === undefined) return { ok: false, error: { code: 'project_not_found', message: 'not found' } };
      return { ok: true, value: { ...(record as object), organizationRef: input.organizationRef } };
    },
  };
}

// ---------------------------------------------------------------------------
// The smoketest scenario (one happy + one degraded pass per port)
// ---------------------------------------------------------------------------

export interface SmoketestResult {
  readonly happy: Readonly<Record<string, 'ok' | 'degraded'>>;
  readonly degraded: Readonly<Record<string, 'ok' | 'degraded'>>;
  readonly problems: readonly string[];
}

const instants: InstantSourceMirror = (() => {
  let cursor = 0;
  return { next: () => 1_800_300_000_000 + cursor++ };
})();

/**
 * Run the smoketest: boot the full composition against the fake
 * providers, drive each port's happy path, then flip the outage lever
 * and drive the degraded path — asserting the typed records on both.
 */
export async function runSmoketest(): Promise<SmoketestResult> {
  const providers = fakeProviders();
  const deployment = composeDeploymentAdapters(fakeProviderEnv(), {
    fetchLike: providers.fetchLike,
    instants,
    executionGateway: fakeExecutionGateway(),
    controlPlane: fakeControlPlane(),
  });
  const happy: Record<string, 'ok' | 'degraded'> = {};
  const degraded: Record<string, 'ok' | 'degraded'> = {};
  const problems: string[] = [];

  // The boot record: every adapter enabled under the full fake env.
  for (const [adapter, on] of Object.entries(enabledAdapters(fakeProviderEnv()))) {
    if (!on) problems.push(`boot: ${adapter} should be enabled under the full env`);
  }

  // --- FirmMemory (Neon) ---
  const knowledgeEnvelope = { record: { knowledgeId: 'fkr:smoke-1', ordinal: 1, tenant: 'tenant-smoke', project: 'prj_smoke', claim: {}, confidence: '0.800', evidenceCount: 1, provenance: {}, validity: {}, asOf: 1, priorChainHead: 'genesis' }, status: 'active' as const, supersededBy: null };
  const firmStore = deployment.firmMemory as unknown as NeonFirmMemoryStore;
  happy.firmMemory = (await firmStore.putKnowledge('tenant-smoke', knowledgeEnvelope)).ok && (await deployment.firmMemory.queryKnowledge({ tenant: 'tenant-smoke', project: 'prj_smoke' }, { at: 9e15, retention: null })).ok ? 'ok' : 'degraded';

  // --- OutcomeLearning (Neon) ---
  const outcomeStore = deployment.outcomeLearning as unknown as NeonOutcomeLearningStore;
  happy.outcomeLearning = (await outcomeStore.putOutcome('tenant-smoke', { outcomeId: 'ocm:smoke-1', ordinal: 1, tenant: 'tenant-smoke', project: 'prj_smoke', decisionRef: 'dec:1', outcomeClass: 'profit', expectation: {}, realization: {}, deviation: {}, evidence: [], lineage: {}, asOf: 1, priorChainHead: 'genesis' })).ok
    && (await deployment.outcomeLearning.queryOutcomes({ tenant: 'tenant-smoke', project: 'prj_smoke' }, { at: 1, retention: null })).ok ? 'ok' : 'degraded';

  // --- ControlPlane (the REAL delegate over the Neon substrate — carried verbatim) ---
  happy.controlPlane = (await deployment.controlPlane.createProject({ id: 'prj_smoke', tenantId: 'tenant-smoke', name: 'Smoke', executionMode: 'simulation', goal: {}, constraintSet: {}, at: 1 })).ok ? 'ok' : 'degraded';

  // --- ExecutionGateway (the REAL delegate — L8, carried verbatim) ---
  const submission = await deployment.executionGateway.submitRequest({ tenant: 'tenant-smoke', intent: 'demo' } as never);
  happy.executionGateway = submission.ok ? 'ok' : 'degraded';

  // --- JobSubmission (Apify) ---
  const job = await deployment.jobSubmission.submitJob({ kind: 'research', tenant: 'tenant-smoke', project: 'prj_smoke', spec: { actorId: 'news-wire~demo', spec: { channel: 'publicHeadlines', request: { action: 'SUBSCRIBE', stream: 'publicHeadlines', symbol: 'TEST-AAA' }, venue: 'venue:test', instrument: 'TEST-AAA', asset_class: 'equity', mapping_table_id: 'mt:news-v1' } }, at: 1 });
  happy.jobSubmission = job.ok ? 'ok' : 'degraded';
  if (job.ok) {
    if (job.value.status !== 'running') problems.push(`jobSubmission: expected the running status, got ${job.value.status}`);
    if (job.value.kind !== 'research') problems.push('jobSubmission: the kind did not round-trip');
  }

  // --- Idempotency + cache (Upstash) ---
  if (deployment.idempotency === null || deployment.cache === null) {
    happy.idempotency = 'degraded';
    problems.push('upstash: the stores should be built under the full env');
  } else {
    const begin = await deployment.idempotency.begin('tenant-smoke', 'dev:smoke', '/v1/execution/requests', 'idem-smoke', { a: 1 });
    const committed = await deployment.idempotency.complete('tenant-smoke', 'dev:smoke', '/v1/execution/requests', 'idem-smoke', { a: 1 }, 200, { ok: true });
    const replay = await deployment.idempotency.begin('tenant-smoke', 'dev:smoke', '/v1/execution/requests', 'idem-smoke', { a: 1 });
    const cached = await deployment.cache.set('tenant-smoke', 'smoke', { cursor: 1 }, 60);
    happy.idempotency = begin.kind === 'fresh' && committed.ok && replay.kind === 'replay' && cached.ok ? 'ok' : 'degraded';
  }

  // --- Evidence (R2) ---
  if (deployment.evidence === null) {
    happy.evidence = 'degraded';
    problems.push('r2: the store should be built under the full env');
  } else {
    const put = await deployment.evidence.putEvidence('tenant-smoke', '{"evidence":"smoke"}');
    const got = put.ok ? await deployment.evidence.getEvidence('tenant-smoke', put.value.digest) : null;
    happy.evidence = put.ok && got !== null && got.ok ? 'ok' : 'degraded';
  }

  // --- NoticeDelivery (Resend) ---
  if (deployment.noticeDelivery === null) {
    happy.noticeDelivery = 'degraded';
    problems.push('resend: the lane should be built under the full env');
  } else {
    const delivered = await deployment.noticeDelivery.deliver('tenant-smoke', { noticeId: 'ntc:smoke', kind: 'training_milestone', tenantId: 'tenant-smoke', projectId: 'prj_smoke', at: 1, source: { route: '/v1/jobs/research', ref: 'job:1' }, title: 'Training milestone', facts: [{ label: 'job', value: 'job:1' }] }, 'operator@example.org');
    happy.noticeDelivery = delivered.ok ? 'ok' : 'degraded';
  }

  // --- The degraded pass: flip the outage lever; every port answers the typed failure (R46) ---
  providers.failAll();
  const knowledgeDegraded = await deployment.firmMemory.queryKnowledge({ tenant: 'tenant-smoke', project: 'prj_smoke' }, { at: 1, retention: null });
  degraded.firmMemory = !knowledgeDegraded.ok && knowledgeDegraded.error.code === 'neon_unreachable' ? 'ok' : 'degraded';
  const outcomeDegraded = await deployment.outcomeLearning.queryOutcomes({ tenant: 'tenant-smoke', project: 'prj_smoke' }, { at: 1, retention: null });
  degraded.outcomeLearning = !outcomeDegraded.ok && outcomeDegraded.error.code === 'neon_unreachable' ? 'ok' : 'degraded';
  const gatewayDegraded = await deployment.executionGateway.submitRequest({} as never);
  degraded.executionGateway = !gatewayDegraded.ok ? 'ok' : 'degraded'; // the fake delegate's own typed refusal
  const jobDegraded = await deployment.jobSubmission.submitJob({ kind: 'research', tenant: 'tenant-smoke', project: 'prj_smoke', spec: { actorId: 'a', spec: { channel: 'c', request: {}, venue: 'v', instrument: 'i', asset_class: 'equity', mapping_table_id: 'm' } }, at: 1 });
  degraded.jobSubmission = !jobDegraded.ok && jobDegraded.error.code === 'apify_apify_unreachable' ? 'ok' : 'degraded';
  if (deployment.idempotency !== null) {
    const idemDegraded = await deployment.idempotency.begin('tenant-smoke', 'dev:smoke', '/v1/execution/requests', 'idem-x', {});
    degraded.idempotency = idemDegraded.kind === 'degraded' ? 'ok' : 'degraded';
  }
  if (deployment.evidence !== null) {
    const evidenceDegraded = await deployment.evidence.putEvidence('tenant-smoke', 'x');
    degraded.evidence = !evidenceDegraded.ok && evidenceDegraded.error.code === 'r2_unreachable' ? 'ok' : 'degraded';
  }
  if (deployment.noticeDelivery !== null) {
    const noticeDegraded = await deployment.noticeDelivery.deliver('tenant-smoke', { noticeId: 'ntc:x', kind: 'training_milestone', tenantId: 'tenant-smoke', projectId: 'prj_smoke', at: 1, source: { route: 'r', ref: 'x' }, title: 'T', facts: [] }, 'operator@example.org');
    degraded.noticeDelivery = !noticeDegraded.ok && noticeDegraded.error.code === 'resend_unreachable' ? 'ok' : 'degraded';
  }

  // No provider was called with a real credential anywhere (the fleet counts prove traffic happened only against the fakes).
  const traffic = providers.seen;
  if (traffic.neon === 0 || traffic.upstash === 0 || traffic.r2 === 0 || traffic.resend === 0 || traffic.apify === 0) {
    problems.push(`traffic: a provider was never exercised (${JSON.stringify(traffic)})`);
  }
  return { happy, degraded, problems };
}

/** One-line health check (the CI gate): every lane ok on both passes + no problems. */
export function smoketestHealthy(result: SmoketestResult): boolean {
  const lanes = [...Object.keys(result.happy), ...Object.keys(result.degraded)];
  return result.problems.length === 0 && lanes.every((lane) => (result.happy as Record<string, string>)[lane] !== 'degraded' && (result.degraded as Record<string, string>)[lane] !== 'degraded');
}

export type { ComposedDeployment, StoreResult };
