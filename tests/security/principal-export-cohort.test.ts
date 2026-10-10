/**
 * FW-39-3 (the identity wave 3) — THE EXPORT COHORT UNDER PRINCIPALS
 * (the FW-37-B boundary pin, extended) + THE EXPORT DISCLOSURE (the
 * actorRule + the chain-equivalence pin).
 *
 * PART 1 (the cohort): a principal's export carries THEIR desks + the
 * shared demo ONLY — principal B's export cohort never contains
 * principal A's records. The host serves the tenant's registry with
 * the honest markers (the isolation battery's law); the console's
 * export composes the CURRENT scope's records; the census below proves
 * every composed record's project is the exporting principal's own
 * desk (or the shared demo), with A's desk present ONLY in the
 * directory block's honestly-marked tenant-available rows — never in
 * the record cohort, never as B's own.
 *
 * PART 2 (the disclosure): the export manifest publishes the actorRule
 * verbatim (EXPORT_ACTOR_RULE); a signed-in principal's export carries
 * the actor on EVERY record (events/capsules/watch/gateway); an
 * anonymous export carries NO actor field anywhere (the honest
 * absence); and THE CHAIN-EQUIVALENCE PIN — the same records verify
 * identically WITH and WITHOUT the actor fields (every digest and
 * chainHead byte-identical; the digest rule stays byte-identical;
 * formatVersion stays 2).
 */
import { describe, expect, it } from 'vitest';

import { composeDeployment } from '../../deploy/vercel/runtime/compose';
import { API_ENV_KEYS, readApiEnv } from '../../deploy/vercel/runtime/env';
import { handleDeploymentRequest } from '../../deploy/vercel/api/router';
import { fakeProviders } from '../../deploy/wire/smoketest';
import { validConstraintSet, validGoal } from '../../services/api/src/fixtures';
import { CONSOLE_SESSION_HEADER } from '../../deploy/vercel/runtime/session-routes';
import { PRINCIPAL_TOKEN_HEADER } from '../../deploy/vercel/runtime/auth-routes';
import { DEMO_PROJECT_ID } from '../../deploy/vercel/runtime/demo';
import type { FunctionRequest, FunctionResponse } from '../../deploy/vercel/runtime/http';
import { sessionOwnDesksOf } from '../../apps/web/src/core/tenant';
import {
  EXPORT_ACTOR_RULE,
  EXPORT_FORMAT_VERSION,
  composeWorkspaceExport,
  openWorkspace,
  reduceWorkspace,
  verifyWorkspaceExportReport,
} from '../../apps/web/src/core/workspace';
import type { GatewaySubmissionRecord, JobRecord, OutcomeRecord, ProjectRecord, ServedKnowledge } from '../../apps/web/src/api/contracts';

// ---------------------------------------------------------------------------
// The harness (the host half: the auth-routes.test.ts shape)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-principal-export';
const TOKEN = 'tok-deploy-principal-export';
const AUTH_KEY = 'test-principal-export-hmac-key';
const NEON_KEYS = {
  NEON_API_HOST: 'ep-demo-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-demo',
};
const T0 = 1_800_700_000_000;
const SESSION_ALICE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SESSION_BOB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function exportSource(): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: 'public-console',
    ...NEON_KEYS,
    [API_ENV_KEYS.authTokenKey]: AUTH_KEY,
  };
}

function composeInstance(fetchLike: import('../../deploy/adapters/shared').FetchLike) {
  return composeDeployment(readApiEnv(exportSource()), {}, { fetchLike, instants: { next: () => T0 } });
}

function streamingRequest(parts: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown }): FunctionRequest {
  return { method: parts.method ?? 'GET', url: parts.url ?? '/v1/meta', headers: parts.headers ?? {}, body: parts.body };
}

function capture(): { response: FunctionResponse; captured: () => { status: number; payload: string | null } } {
  const headers: Record<string, string> = {};
  let status = 0;
  let payload: string | null = null;
  const response: FunctionResponse = {
    get statusCode() { return status; },
    set statusCode(value: number) { status = value; },
    setHeader(key: string, value: string | number) { headers[key] = String(value); return undefined; },
    end(chunk?: string) { if (typeof chunk === 'string') payload = chunk; return undefined; },
  };
  return { response, captured: () => ({ status, headers, payload }) };
}

async function drive(deployment: ReturnType<typeof composeDeployment>, request: FunctionRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

const BEARER = { authorization: `Bearer ${TOKEN}` };

function sessionHeaders(session: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...BEARER, [CONSOLE_SESSION_HEADER]: session, ...extra };
}

function createProjectBody(projectId: string): Record<string, unknown> {
  return { id: projectId, name: `the ${projectId} desk`, executionMode: 'simulation', goal: validGoal(TENANT), constraintSet: validConstraintSet(TENANT), at: T0 };
}

async function registerPrincipal(instance: ReturnType<typeof composeDeployment>, name: string): Promise<string> {
  const registered = await drive(instance, streamingRequest({
    method: 'POST', url: '/v1/auth/register', headers: { ...BEARER, 'content-type': 'application/json' },
    body: { name, passphrase: `passphrase-of-${name}-long-enough` },
  }));
  expect(registered.status).toBe(201);
  return ((registered.body.data as { token: string }).token);
}

// ---------------------------------------------------------------------------
// The client half (the workspace state fixtures — the workspace.test.ts shapes)
// ---------------------------------------------------------------------------

const BOB_SCOPE = { tenantId: TENANT, projectId: 'prj-bob-desk' };

function bobProjectRecord(): ProjectRecord {
  return {
    id: 'prj-bob-desk', tenantId: TENANT, name: 'Bob Desk', executionMode: 'simulation',
    lifecycle: { projectId: 'prj-bob-desk', status: 'active', acceptanceCriteriaId: null, organizationRef: null },
    lineage: { projectId: 'prj-bob-desk', createdAt: T0, createdBy: 'worker', priorVersion: null, version: 1 },
    createdAt: T0, updatedAt: T0,
  } as unknown as ProjectRecord;
}

function bobOutcomeRecord(): OutcomeRecord {
  return {
    outcomeId: 'out-bob-1', ordinal: 1, tenant: TENANT, project: 'prj-bob-desk',
    decision: { decisionRef: 'xd-bob-1', intentRef: 'si-bob-1', disposition: 'filled' },
    outcomeClass: 'realized-profit',
    expectation: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25', declaredBy: 'body-1' },
    realization: { filledQuantity: '10', realizedOutcome: '1.5', feeTotal: '0.01', notionalTotal: '100', unrealizedAtDecision: '0' },
    deviation: { quantityShortfall: '0', realizedGap: '0', withinTolerance: true },
    evidence: [{ kind: 'decision', ref: 'xd-bob-1' }],
    lineage: {
      shadow: {
        sessionId: 'shs-bob-1', fidelity: { mode: 'shadow', fill_origin: 'simulated' },
        executionPolicy: { policyId: 'xp-1', version: 1 }, riskPolicy: { policyId: 'rp-1', version: 1 },
        configDigests: { worldConfigHash: 'w', engineConfigHash: 'e', dataset: 'd' },
        run: { runId: 'r', episodeId: 'ep' }, cursor: { cursorId: 'c', position: 1 },
        seed: 's', tenant: TENANT, project: 'prj-bob-desk',
      },
      shadowOutcomeRef: 'swo-bob-1', shadowOutcomeOrdinal: 1, shadowAsOf: T0 + 30,
      decisionStreamPosition: 1, trajectoryRef: null, experiment: null,
    },
    asOf: T0 + 30, priorChainHead: '00000000',
  } as unknown as OutcomeRecord;
}

function bobKnowledgeRecord(): ServedKnowledge {
  return {
    record: {
      knowledgeId: 'knl-bob-1', ordinal: 1, tenant: TENANT, project: 'prj-bob-desk',
      claim: { kind: 'causal', polarity: 'positive', dimension: 'momentum', lagBand: null },
      confidence: '0.80', evidenceCount: 3,
      provenance: { postMortemRefs: [], outcomeRefs: [], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: [] },
      validity: { from: T0, to: T0 + 1000 }, asOf: T0 + 31, priorChainHead: '00000000',
    },
    status: 'active', supersededBy: null,
  } as unknown as ServedKnowledge;
}

function bobJobRecord(): JobRecord {
  return { jobId: 'job-bob-1', kind: 'research', tenant: TENANT, project: 'prj-bob-desk', status: 'complete', submittedAt: T0 + 20, result: { kind: 'release-candidate', specId: 'spec-1', version: 1 } } as unknown as JobRecord;
}

function bobSubmissionRecord(): GatewaySubmissionRecord {
  return { kind: 'refused', submissionId: 'sub-bob-1', decisionId: null, auditId: 'aud-bob-1', refusal: { stage: 'risk' }, refusedAt: T0 + 50 } as unknown as GatewaySubmissionRecord;
}

/** Bob's workspace state over HIS desk (the console's real reducer — the export's composing world). */
function bobWorkspaceState(): ReturnType<typeof openWorkspace> {
  let state = openWorkspace(BOB_SCOPE, T0);
  state = reduceWorkspace(state, { kind: 'connection-changed', at: T0 + 1, status: 'connected' });
  state = reduceWorkspace(state, { kind: 'project-loaded', at: T0 + 2, project: bobProjectRecord() });
  state = reduceWorkspace(state, { kind: 'outcomes-loaded', at: T0 + 30, records: [bobOutcomeRecord()] });
  state = reduceWorkspace(state, { kind: 'knowledge-loaded', at: T0 + 31, records: [bobKnowledgeRecord()] });
  state = reduceWorkspace(state, { kind: 'job-updated', at: T0 + 20, job: bobJobRecord() });
  state = reduceWorkspace(state, { kind: 'submission-recorded', at: T0 + 50, submission: bobSubmissionRecord() });
  return state;
}

// ---------------------------------------------------------------------------
// The battery
// ---------------------------------------------------------------------------

describe('FW-39-3 security: the export cohort under principals (the FW-37-B boundary pin, extended)', () => {
  it('a principal\'s export cohort carries THEIR desks + the shared demo ONLY — the other principal\'s desk never enters the record cohort, and appears in the directory only as an honestly-marked tenant-available row', async () => {
    const providers = fakeProviders();
    const instance = composeInstance(providers.fetchLike);
    expect(instance.ok).toBe(true);
    if (!instance.ok) return;
    const alice = await registerPrincipal(instance, 'alice');
    const bob = await registerPrincipal(instance, 'bob');
    for (const [session, token, project] of [[SESSION_ALICE, alice, 'prj-alice-desk'], [SESSION_BOB, bob, 'prj-bob-desk']] as const) {
      const created = await drive(instance, streamingRequest({
        method: 'POST', url: '/v1/projects', headers: { ...sessionHeaders(session, { [PRINCIPAL_TOKEN_HEADER]: token }), 'content-type': 'application/json' },
        body: createProjectBody(project),
      }));
      expect(created.status).toBe(201);
    }

    // Bob's console read: the served directory (the host's honest markers).
    const listed = await drive(instance, streamingRequest({ url: '/v1/projects', headers: sessionHeaders(SESSION_BOB, { [PRINCIPAL_TOKEN_HEADER]: bob }) }));
    const directory = ((listed.body.data as { items: readonly ProjectRecord[] }).items);
    // The wall census over the SERVED directory: bob's own = his desk + the demo ONLY (the FW-37-B law under principals).
    const own = sessionOwnDesksOf(directory, DEMO_PROJECT_ID).map((project) => project.id).sort();
    expect(own).toEqual([DEMO_PROJECT_ID, 'prj-bob-desk'].sort());
    expect(own).not.toContain('prj-alice-desk');

    // The export composition over BOB's workspace (his scope's records — the real reducer's world).
    const state = { ...bobWorkspaceState(), projectDirectory: Object.freeze([...directory]) };
    const doc = composeWorkspaceExport(state, false, 'bob');
    // THE COHORT CENSUS: every composed record's project is bob's desk or the shared demo — NEVER alice's.
    const cohortProjects = new Set<string>();
    for (const entry of doc.events) cohortProjects.add(entry.projectId);
    for (const capsule of doc.capsules) cohortProjects.add(capsule.projectId);
    for (const watch of doc.decisions.watch) cohortProjects.add((watch as { projectId?: string }).projectId ?? BOB_SCOPE.projectId);
    for (const gateway of doc.decisions.gateway) cohortProjects.add((gateway as { project?: string }).project ?? BOB_SCOPE.projectId);
    for (const project of cohortProjects) {
      expect(project === 'prj-bob-desk' || project === DEMO_PROJECT_ID, `the cohort carries a foreign project ${project}`).toBe(true);
    }
    // The RECORD cohort never names alice's desk: no event payload, capsule, watch or gateway record carries it.
    expect(JSON.stringify(doc.events)).not.toContain('prj-alice-desk');
    expect(JSON.stringify(doc.capsules)).not.toContain('prj-alice-desk');
    expect(JSON.stringify(doc.decisions)).not.toContain('prj-alice-desk');
    // The honest disclosure: the DIRECTORY block carries the tenant registry with the MARKERS (the FW-31-B law — pinned, not hidden).
    expect((doc.workspace.projectDirectory as readonly ProjectRecord[]).some((project) => project.id === 'prj-alice-desk')).toBe(true);
    const aliceRow = (doc.workspace.projectDirectory as readonly { id: string; consoleSessionScope?: string }[]).find((project) => project.id === 'prj-alice-desk');
    expect(aliceRow?.consoleSessionScope).toBe('tenant-available'); // honestly marked — never bob's own
  });

  it('THE EXPORT DISCLOSURE: the manifest publishes the actorRule verbatim; a signed-in principal\'s export carries the actor on EVERY record; an anonymous export carries NO actor field anywhere', () => {
    const state = bobWorkspaceState();
    // Anonymous: no actor field anywhere (the honest absence — pre-account documents keep it).
    const anonymous = composeWorkspaceExport(state, false, null);
    expect(anonymous.manifest.actorRule).toBe(EXPORT_ACTOR_RULE); // the RULE still publishes (the reader learns the semantics)
    expect(anonymous.events.every((entry) => entry.actor === undefined)).toBe(true);
    expect(anonymous.capsules.every((capsule) => capsule.actor === undefined)).toBe(true);
    expect(anonymous.decisions.watch.every((event) => (event as { actor?: string }).actor === undefined)).toBe(true);
    expect(anonymous.decisions.gateway.every((record) => (record as { actor?: string }).actor === undefined)).toBe(true);

    // Signed in as bob: the actor on EVERY record, identical for the whole export.
    const attributed = composeWorkspaceExport(state, false, 'bob');
    expect(attributed.events.every((entry) => entry.actor === 'bob')).toBe(true);
    expect(attributed.capsules.every((capsule) => capsule.actor === 'bob')).toBe(true);
    expect(attributed.decisions.watch.every((event) => (event as { actor?: string }).actor === 'bob')).toBe(true);
    expect(attributed.decisions.gateway.every((record) => (record as { actor?: string }).actor === 'bob')).toBe(true);
    // The rule names what the field means and its placement — the work order's own words.
    expect(EXPORT_ACTOR_RULE).toContain('NON-DIGESTED');
    expect(EXPORT_ACTOR_RULE).toContain('NOT a per-record write attribution');
    expect(EXPORT_ACTOR_RULE).toContain('the honest absence');
    expect(EXPORT_ACTOR_RULE).toContain('the format version stays 2');
    expect(attributed.formatVersion).toBe(2); // NO format bump — the additive rule ride-along
  });

  it('THE CHAIN-EQUIVALENCE PIN: the same records verify identically WITH and WITHOUT actor fields — every digest and chainHead byte-identical, the digest rule unchanged', () => {
    const state = bobWorkspaceState();
    const withActor = composeWorkspaceExport(state, true, 'bob');
    const withoutActor = composeWorkspaceExport(state, true, null);

    // Both verify end-to-end.
    expect(verifyWorkspaceExportReport(withActor).ok).toBe(true);
    expect(verifyWorkspaceExportReport(withoutActor).ok).toBe(true);

    // THE DIGEST RULE STAYS BYTE-IDENTICAL: every entry's digest + chainHead + head match across the two.
    expect(withActor.events.map((entry) => entry.digest)).toEqual(withoutActor.events.map((entry) => entry.digest));
    expect(withActor.events.map((entry) => entry.chainHead)).toEqual(withoutActor.events.map((entry) => entry.chainHead));
    expect(withActor.chain.head).toBe(withoutActor.chain.head);
    expect(withActor.chain.digestRule).toBe(withoutActor.chain.digestRule);
    expect(withActor.chain.entryCount).toBe(withoutActor.chain.entryCount);

    // The STRIPPED form verifies too: delete the actor fields from the attributed document — verification still passes (the actor sits OUTSIDE every digest).
    const stripped = JSON.parse(JSON.stringify(withActor)) as typeof withActor;
    for (const entry of stripped.events) delete (entry as { actor?: string }).actor;
    for (const capsule of stripped.capsules) delete (capsule as { actor?: string }).actor;
    for (const event of stripped.decisions.watch) delete (event as { actor?: string }).actor;
    for (const record of stripped.decisions.gateway) delete (record as { actor?: string }).actor;
    expect(verifyWorkspaceExportReport(stripped).ok).toBe(true);
    // ...and the chain is UNCHANGED by the strip (byte-identical digests).
    expect(stripped.events.map((entry) => entry.digest)).toEqual(withActor.events.map((entry) => entry.digest));
    expect(stripped.chain.head).toBe(withActor.chain.head);
    expect(stripped.formatVersion).toBe(EXPORT_FORMAT_VERSION);
  });
});
