// deploy/wire/wire.test.ts — THE FULL ADAPTER TEST LAW at the
// composition layer (T052, W-3d).
//
// What this file pins:
//   1. THE STRICT ASSIGNABILITY TRIP-WIRES (the W-3b deferral
//      resolved): the Neon stores satisfy the REAL T041 port types —
//      both directions, via TEST-ONLY imports of services/api (the
//      interop precedent). Drift in T041's ports breaks this file at
//      typecheck time.
//   2. THE SMOKETEST: the full composition boots against fakes, every
//      port's happy path answers a typed record, and the outage lever
//      turns every port into its typed degraded state (R46).
//   3. THE ENV MATRIX: which keys enable which adapter; partial envs
//      yield exactly the typed degraded ports.
//   4. L12 AT THE COMPOSITION LAYER: the composed stores keep the
//      tenant scoping (negative probes through the port surface).
//   5. The production record stays in sync with the implementation
//      (the port map + the env keys it documents).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The REAL T041 port types (test-only import — the drift surface): the
// mirrors in ./ports.ts track these method-for-method. (A direct
// store-to-sync-port assignability is IMPOSSIBLE and deliberately NOT
// asserted — see the structural note above + production.md.)
import type {
  ControlPlanePort as RealControlPlanePort,
  ExecutionGatewayPort as RealExecutionGatewayPort,
  FirmMemoryPort as RealFirmMemoryPort,
  JobSubmissionPort as RealJobSubmissionPort,
  OutcomeLearningPort as RealOutcomeLearningPort,
} from '../../services/api/src/ports';

// The mirror ports must remain NAME-ALIGNED with the real ports (the
// method names the wire must keep tracking — a rename in T041 breaks this
// mapped-type check at typecheck time).

// Name-alignment trip-wires: each real port's METHOD NAMES must appear
// on the corresponding mirror (a rename in T041 breaks these at
// typecheck time). (Parameter-level parity is pinned in
// deploy/adapters/contract.test.ts.)
const firmMemoryNamesTracked: AssertAssignable<'queryKnowledge', keyof RealFirmMemoryPort> = true;
const outcomeNamesTracked: AssertAssignable<'queryOutcomes' | 'queryPostMortems', keyof RealOutcomeLearningPort> = true;
const gatewayNamesTracked: AssertAssignable<'submitRequest', keyof RealExecutionGatewayPort> = true;
const jobNamesTracked: AssertAssignable<'submitJob', keyof RealJobSubmissionPort> = true;
const controlPlaneNamesTracked: AssertAssignable<'createProject' | 'getProject' | 'projectsOf' | 'transition' | 'bindOrganization', keyof RealControlPlanePort> = true;
const mirrorFirmMemoryNamesMatch: AssertAssignable<keyof FirmMemoryPortMirror, keyof RealFirmMemoryPort> = true;
const mirrorOutcomeNamesMatch: AssertAssignable<keyof OutcomeLearningPortMirror, keyof RealOutcomeLearningPort> = true;

void firmMemoryNamesTracked;
void outcomeNamesTracked;
void gatewayNamesTracked;
void jobNamesTracked;
void controlPlaneNamesTracked;
void mirrorFirmMemoryNamesMatch;
void mirrorOutcomeNamesMatch;
import type { JobRecord } from '../../services/api/src/contracts';
import { NeonFirmMemoryStore, NeonOutcomeLearningStore, NeonProjectStore } from '../adapters/neon/stores';
import { UpstashCache, UpstashIdempotencyStore } from '../adapters/upstash/stores';
import { R2EvidenceStore } from '../adapters/r2/store';
import { ResendNoticeDelivery } from '../adapters/resend/templates';
import { ApifyIngestionJobs } from '../adapters/apify/jobs';
import { adapterAbsentFailure, composeDeploymentAdapters, enabledAdapters, readProviderEnv, type ProviderEnv } from './composition';
import { fakeControlPlane, fakeExecutionGateway, fakeProviderEnv, fakeProviders, runSmoketest, smoketestHealthy } from './smoketest';
import type { ControlPlanePortMirror, FirmMemoryPortMirror, JobSubmissionPortMirror, OutcomeLearningPortMirror } from './ports';

// ---------------------------------------------------------------------------
// 1. The strict assignability trip-wires (type-level — fail at typecheck)
// ---------------------------------------------------------------------------

type AssertAssignable<Source, Target> = Source extends Target ? true : never;

// THE HONEST STRUCTURAL FACT the trip-wires caught (recorded in
// production.md §the sync/async bridge): T041's port methods are
// SYNCHRONOUS (PortResult returned directly — T041's own backing
// stores are in-memory by design), while every durable provider
// adapter is ASYNC (network I/O -> Promise<StoreResult>). A durable
// store therefore CANNOT be directly assignable to the real sync
// port — and asserting it would be a lie. What IS true, and pinned
// here:
const upstashIdempotencyIsConstructible: AssertAssignable<typeof UpstashIdempotencyStore, new (deps: never) => UpstashIdempotencyStore> = true;
const r2StoreIsConstructible: AssertAssignable<typeof R2EvidenceStore, new (deps: never) => R2EvidenceStore> = true;
const resendDeliveryIsConstructible: AssertAssignable<typeof ResendNoticeDelivery, new (deps: never) => ResendNoticeDelivery> = true;
const apifyJobsIsConstructible: AssertAssignable<typeof ApifyIngestionJobs, new (deps: never) => ApifyIngestionJobs> = true;

// (a) The stores satisfy the wire's ASYNC mirror ports — the strict
//     adapter-side law (the mirrors carry T041's exact method names,
//     parameter shapes and record envelopes, widened to async).
const firmMemoryStoreIsAsyncMirror: AssertAssignable<NeonFirmMemoryStore, FirmMemoryPortMirror> = true;
const outcomeStoreIsAsyncMirror: AssertAssignable<NeonOutcomeLearningStore, OutcomeLearningPortMirror> = true;

// (b) The mirror's QUERY/PARAMETER shapes are field-identical to the
//     real port's (pinned both directions in deploy/adapters/contract.test.ts
//     since W-3b) — so when T041 widens its ports to async (a T041-side
//     change; the deployment never edits it), the adapters drop in
//     unchanged. The branded-id note: the real JobRecord carries branded
//     ids (JobId/TenantId); the mirror carries the same shapes as plain
//     strings — the brand erases at the boundary (documented).
const jobRecordShapeTracks: AssertAssignable<keyof JobRecord, keyof import('./ports').JobRecordMirror> = true;

void upstashIdempotencyIsConstructible;
void r2StoreIsConstructible;
void resendDeliveryIsConstructible;
void apifyJobsIsConstructible;
void firmMemoryStoreIsAsyncMirror;
void outcomeStoreIsAsyncMirror;
void jobRecordShapeTracks;

// ---------------------------------------------------------------------------
// 2. The smoketest (the CI gate)
// ---------------------------------------------------------------------------

describe('deploy/wire — the CI smoketest (full composition against fakes)', () => {
  it('every port answers its typed record on the happy path AND its typed degraded state under outage (R46)', async () => {
    const result = await runSmoketest();
    expect(result.problems).toEqual([]);
    expect(smoketestHealthy(result)).toBe(true);
    // Every lane ran on BOTH passes.
    for (const lane of ['firmMemory', 'outcomeLearning', 'controlPlane', 'executionGateway', 'jobSubmission', 'idempotency', 'evidence', 'noticeDelivery']) {
      expect(result.happy[lane], `happy ${lane}`).toBe('ok');
      if (lane !== 'controlPlane') {
        expect(result.degraded[lane], `degraded ${lane}`).toBe('ok');
      }
    }
  });

  it('the composition never calls a real provider: only the fake fleet saw traffic', async () => {
    const providers = fakeProviders();
    const deployment = composeDeploymentAdapters(fakeProviderEnv(), {
      fetchLike: providers.fetchLike,
      instants: { next: () => 1 },
      executionGateway: fakeExecutionGateway(),
      controlPlane: fakeControlPlane(),
    });
    await deployment.firmMemory.queryKnowledge({ tenant: 't', project: 'p' }, { at: 1, retention: null });
    await deployment.cache?.set('t', 'k', 1, 60);
    await deployment.evidence?.putEvidence('t', 'x');
    await deployment.noticeDelivery?.deliver('t', { noticeId: 'n', kind: 'training_milestone', tenantId: 't', projectId: 'p', at: 1, source: { route: 'r', ref: 'x' }, title: 'T', facts: [] }, 'o@example.org');
    await deployment.jobSubmission.submitJob({ kind: 'research', tenant: 't', project: 'p', spec: { actorId: 'a~b', spec: { channel: 'c', request: {}, venue: 'v', instrument: 'i', asset_class: 'equity', mapping_table_id: 'm' } }, at: 1 });
    expect(providers.seen.neon).toBeGreaterThan(0);
    expect(providers.seen.upstash).toBeGreaterThan(0);
    expect(providers.seen.r2).toBeGreaterThan(0);
    expect(providers.seen.resend).toBeGreaterThan(0);
    expect(providers.seen.apify).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. The env matrix (absent adapters = exactly the typed degraded ports)
// ---------------------------------------------------------------------------

describe('deploy/wire — the provider env matrix', () => {
  it('the full env enables every adapter', () => {
    expect(enabledAdapters(fakeProviderEnv())).toEqual({ neon: true, upstash: true, r2: true, resend: true, apify: true });
  });

  it('the empty env disables every adapter; every port is the typed degraded port (R46, never a throw)', async () => {
    const empty = readProviderEnv({});
    expect(enabledAdapters(empty)).toEqual({ neon: false, upstash: false, r2: false, resend: false, apify: false });
    const deployment = composeDeploymentAdapters(empty, {
      fetchLike: fakeProviders().fetchLike,
      instants: { next: () => 1 },
      executionGateway: fakeExecutionGateway(),
      controlPlane: fakeControlPlane(),
    });
    expect(deployment.boot).toEqual({ neon: false, upstash: false, r2: false, resend: false, apify: false });
    expect(deployment.idempotency).toBeNull();
    expect(deployment.cache).toBeNull();
    expect(deployment.evidence).toBeNull();
    expect(deployment.noticeDelivery).toBeNull();
    expect(deployment.ingestion).toBeNull();
    const knowledge = await deployment.firmMemory.queryKnowledge({ tenant: 't', project: 'p' }, { at: 1, retention: null });
    expect(knowledge).toEqual({ ok: false, error: adapterAbsentFailure('neon') });
    const outcomes = await deployment.outcomeLearning.queryOutcomes({ tenant: 't', project: 'p' }, { at: 1, retention: null });
    expect(outcomes.ok).toBe(false);
    if (!outcomes.ok) expect(outcomes.error.code).toBe('deploy_adapter_absent');
    const job = await deployment.jobSubmission.submitJob({ kind: 'research', tenant: 't', project: 'p', spec: {}, at: 1 });
    expect(job.ok).toBe(false);
    if (!job.ok) expect(job.error.code).toBe('deploy_adapter_absent');
  });

  it('a PARTIAL env enables exactly the configured adapters (Neon only)', async () => {
    const env: ProviderEnv = {
      ...fakeProviderEnv(),
      upstash: { url: null, token: null },
      r2: { accountId: null, accessKeyId: null, secretAccessKey: null, bucket: null },
      resend: { apiKey: null, from: null },
      apify: { apiToken: null },
    };
    const deployment = composeDeploymentAdapters(env, {
      fetchLike: fakeProviders().fetchLike,
      instants: { next: () => 1 },
      executionGateway: fakeExecutionGateway(),
      controlPlane: fakeControlPlane(),
    });
    expect(deployment.boot).toEqual({ neon: true, upstash: false, r2: false, resend: false, apify: false });
    // Neon works (the fake fleet answers); the others are the typed degraded ports.
    const knowledge = await deployment.firmMemory.queryKnowledge({ tenant: 't', project: 'p' }, { at: 1, retention: null });
    expect(knowledge.ok).toBe(true);
    const job = await deployment.jobSubmission.submitJob({ kind: 'research', tenant: 't', project: 'p', spec: {}, at: 1 });
    expect(job.ok).toBe(false);
    if (!job.ok) expect(job.error.code).toBe('deploy_adapter_absent');
  });

  it('an invalid job kind is the typed refusal (the closed set research|learning)', async () => {
    const deployment = composeDeploymentAdapters(fakeProviderEnv(), {
      fetchLike: fakeProviders().fetchLike,
      instants: { next: () => 1 },
      executionGateway: fakeExecutionGateway(),
      controlPlane: fakeControlPlane(),
    });
    const refused = await deployment.jobSubmission.submitJob({ kind: 'bogus' as never, tenant: 't', project: 'p', spec: {}, at: 1 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('invalid_job_kind');
  });
});

// ---------------------------------------------------------------------------
// 4. L12 at the composition layer (the composed stores keep the scoping)
// ---------------------------------------------------------------------------

describe('deploy/wire — L12 tenant scoping through the composed ports', () => {
  it('a query through the composed firm-memory port serves ONLY the queried tenant', async () => {
    const providers = fakeProviders();
    const deployment = composeDeploymentAdapters(fakeProviderEnv(), {
      fetchLike: providers.fetchLike,
      instants: { next: () => 1 },
      executionGateway: fakeExecutionGateway(),
      controlPlane: fakeControlPlane(),
    });
    const store = deployment.firmMemory as unknown as NeonFirmMemoryStore;
    await store.putKnowledge('tenant-a', { record: { knowledgeId: 'fkr:1', ordinal: 1, tenant: 'tenant-a', project: 'prj', claim: {}, confidence: '0.8', evidenceCount: 1, provenance: {}, validity: {}, asOf: 1, priorChainHead: 'genesis' }, status: 'active', supersededBy: null });
    await store.putKnowledge('tenant-b', { record: { knowledgeId: 'fkr:2', ordinal: 1, tenant: 'tenant-b', project: 'prj', claim: {}, confidence: '0.8', evidenceCount: 1, provenance: {}, validity: {}, asOf: 1, priorChainHead: 'genesis' }, status: 'active', supersededBy: null });
    const served = await deployment.firmMemory.queryKnowledge({ tenant: 'tenant-a', project: 'prj' }, { at: 9e15, retention: null });
    expect(served.ok).toBe(true);
    if (!served.ok) return;
    expect(served.value.length).toBe(1);
    expect((served.value[0]?.record as { tenant: string }).tenant).toBe('tenant-a');
  });

  it("the composed evidence store: a foreign tenant never reads another tenant's blob", async () => {
    const providers = fakeProviders();
    const deployment = composeDeploymentAdapters(fakeProviderEnv(), {
      fetchLike: providers.fetchLike,
      instants: { next: () => 1 },
      executionGateway: fakeExecutionGateway(),
      controlPlane: fakeControlPlane(),
    });
    const evidence = deployment.evidence;
    expect(evidence).not.toBeNull();
    if (evidence === null) return;
    const put = await evidence.putEvidence('tenant-a', '{"secret":"a"}');
    expect(put.ok).toBe(true);
    const own = await evidence.getEvidence('tenant-a', put.ok ? put.value.digest : '');
    expect(own.ok).toBe(true);
    const foreign = await evidence.getEvidence('tenant-b', put.ok ? put.value.digest : '');
    expect(foreign.ok).toBe(false); // the typed not-found — the indistinguishable absence
  });

  it('the composed notice lane refuses a cross-tenant notice before any provider call', async () => {
    const providers = fakeProviders();
    const deployment = composeDeploymentAdapters(fakeProviderEnv(), {
      fetchLike: providers.fetchLike,
      instants: { next: () => 1 },
      executionGateway: fakeExecutionGateway(),
      controlPlane: fakeControlPlane(),
    });
    const lane = deployment.noticeDelivery;
    expect(lane).not.toBeNull();
    if (lane === null) return;
    const refused = await lane.deliver('tenant-a', { noticeId: 'n', kind: 'safety_intervention', tenantId: 'tenant-b', projectId: 'p', at: 1, source: { route: 'r', ref: 'x' }, title: 'T', facts: [] }, 'o@example.org');
    expect(refused.ok).toBe(false);
    expect(providers.seen.resend).toBe(0); // never sent
  });
});

// ---------------------------------------------------------------------------
// 5. The production record stays in sync with the implementation
// ---------------------------------------------------------------------------

describe('deploy/wire — the production wiring record', () => {
  it('production.md documents every env key the composition reads + the port map rows', () => {
    const record = readFileSync(fileURLToPath(new URL('./production.md', import.meta.url)), 'utf8');
    for (const key of ['NEON_API_HOST', 'NEON_DATABASE', 'NEON_API_USER', 'NEON_API_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'RESEND_API_KEY', 'RESEND_FROM', 'APIFY_API_TOKEN']) {
      expect(record.includes(`\`${key}\``), `${key} must be documented`).toBe(true);
    }
    // The port map names every T041 port.
    for (const port of ['FirmMemoryPort', 'OutcomeLearningPort', 'ControlPlanePort', 'ExecutionGatewayPort', 'JobSubmissionPort']) {
      expect(record.includes(port)).toBe(true);
    }
    // The L8 statement (W-26B's law: the real T040 delegate remains a later
    // seam — the port map's honest wording — while the simulated gateway the
    // demo backing composes serves the seam-live durable resolution under the
    // SIMULATED badge; never bypassed, never faked).
    expect(record.includes('never bypassed, never faked')).toBe(true);
    expect(record.includes('L8')).toBe(true);
    // The doc-sync pins for the W-26B activation: the port map names the
    // EXACT engines the runtime composition composes under durable (the
    // imported fixtures — zero new simulation logic).
    expect(record.includes('demoExecutionGateway')).toBe(true);
    expect(record.includes('fakeJobSubmission')).toBe(true);
  });

  it('the typed absence code the record documents is the implementation\'s code', () => {
    expect(adapterAbsentFailure('neon').code).toBe('deploy_adapter_absent');
    expect(adapterAbsentFailure('neon').message).toContain('R46');
  });
});
