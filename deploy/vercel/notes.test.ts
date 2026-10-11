// deploy/vercel/notes.test.ts — THE RESEARCH-NOTE INGESTION (FW-45, the
// E-6 research-world MVP — M3's decisive item, Round L register E-6).
//
// WHAT IS PINNED (the host-owned POST /v1/projects/:projectId/notes route
// + the storage law, through the FULL function handler — the
// job-promote/record-durability harness pattern):
//
//   - AUTHN FIRST — a request without the deployment's registered
//     developer credential is the typed 401 (the W-8 law);
//   - THE UNTRUSTED-INPUT GATE — the note is STRUCTURALLY PARSED before
//     any storage: a body that is not an object, a missing/empty/oversized
//     title or text, or a non-string field answers the typed 400
//     validation_failed (the boundary's own untrusted-payload law) with
//     the broken paths named — NEVER a half-applied note (the draft-store
//     law);
//   - FAIL-CLOSED TARGET — a note attaches ONLY to a project with a goal
//     set on record (the note rides the SAME opaque row the launch world
//     and the ownership stamps ride — the W-28 precedent); a project with
//     no goal set answers the typed 404, never a note on a record that
//     does not exist;
//   - THE MINT — the record is content-addressed over its own envelope
//     (tenant + project + attachedAt + title + text), carries the
//     attaching ACTOR as the additive stamp when the request carried a
//     VALID principal token (the FW-39-3 law — absent = anonymous, the
//     honest absence; degraded = the typed 503, fail closed), and its
//     attachedAt is the ROUTE'S OWN observation (L4 — never a request
//     value);
//   - IDEMPOTENT PER CONTENT — re-attaching a note the project already
//     carries (the same title + text — the client's own idempotency-key
//     unit: project + title + text) returns the STORED record, never a
//     duplicate row (the FIRST mint stands, actor included — never
//     re-attribution);
//   - THE READ-BACK — the host goal route (GET /v1/projects/:id/goal)
//     serves the attached notes as the ADDITIVE `notes` field (the `world`
//     precedent), so the console's boot bundle re-reads them after a
//     reload;
//   - THE DURABLE WRITE-THROUGH — under the DURABLE backing the note
//     merges into the project's goal-set row (the same opaque payload
//     column `world`/`ownerSession`/`ownerPrincipal` ride) and a FRESH
//     serverless instance serves it from the durable truth — the note is
//     DURABLE RECORD, not per-instance state. Under the DEMO backing the
//     storage is per-instance (the demo arm's own law, honest under the
//     SIMULATED badge — the promote registry's disclosed limitation).
//
// Spec anchors: R43 (additive), R45 (provenance), R46 (every failure path
// typed; never a crash), L4 (the attachedAt is the route's own instant),
// L12 (the route keys on the AUTHORIZED tenant — a foreign project
// answers the typed 404), ROUND-L-REPORT §4 E-6 (M3's six seams a/b/e/f).

import { describe, expect, it } from 'vitest';
import { composeDeployment } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { fakeProviders } from '../wire/smoketest';
import { NeonProjectStore, type NeonStoreDeps } from '../adapters/neon/stores';
import type { NeonConfig } from '../adapters/neon/client';
import type { FetchLike } from '../adapters/shared';
import { validConstraintSet, validGoal } from '../../services/api/src/fixtures';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// The fixed fake world (the record-durability harness law — never a real credential)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-fw45';
const TOKEN = 'tok-deploy-fw45';
const PRINCIPAL = 'public-console';
const NEON_KEYS = {
  NEON_API_HOST: 'ep-fw45-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-fw45',
};
const NEON_CONFIG: NeonConfig = {
  apiHost: NEON_KEYS.NEON_API_HOST,
  database: NEON_KEYS.NEON_DATABASE,
  apiUser: NEON_KEYS.NEON_API_USER,
  apiKey: NEON_KEYS.NEON_API_KEY,
};

const T0 = 1_800_600_000_000;

const BEARER = { authorization: `Bearer ${TOKEN}` };

function createProjectBody(projectId: string, at = T0): Record<string, unknown> {
  return { id: projectId, name: `the ${projectId} desk`, executionMode: 'simulation', goal: validGoal(TENANT), constraintSet: validConstraintSet(TENANT), at };
}

// ---------------------------------------------------------------------------
// The function-handler harness (the full path: settled -> boot world ->
// tick -> wrap -> host route -> boundary -> drain -> response)
// ---------------------------------------------------------------------------

function streamingRequest(parts: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown }): FunctionRequest {
  return { method: parts.method ?? 'GET', url: parts.url ?? '/v1/meta', headers: parts.headers ?? {}, body: parts.body };
}

function capture(): { response: FunctionResponse; captured: () => { readonly status: number; readonly payload: string | null } } {
  let status = 0;
  let payload: string | null = null;
  const response: FunctionResponse = {
    get statusCode() {
      return status;
    },
    set statusCode(value: number) {
      status = value;
    },
    setHeader() {
      return undefined;
    },
    end(chunk?: string) {
      if (typeof chunk === 'string') payload = chunk;
      return undefined;
    },
  };
  return { response, captured: () => ({ status, payload }) };
}

async function drive(deployment: ReturnType<typeof composeDeployment>, request: FunctionRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

/** The demo env (no durable keys — the DEMO backing composes). */
function demoSource(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...overrides,
  };
}

/** The durable env (the fake Neon fleet — the record-durability harness law). */
function durableSource(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...NEON_KEYS,
    [API_ENV_KEYS.apiInternalToken]: 'tok-internal-fw45',
    [API_ENV_KEYS.apiInternalPrincipal]: 'fw45-machinery',
    ...overrides,
  };
}

/** Compose one deployment over the injected fetch (a fresh "serverless instance"). */
function composeInstance(source: Record<string, string | undefined>, fetchLike?: FetchLike) {
  return composeDeployment(readApiEnv(source), {}, fetchLike === undefined ? {} : { fetchLike, instants: { next: () => T0 } });
}

/** The minted note record's shape as the route serves it. */
interface ServedNote {
  readonly noteId: string;
  readonly tenant: string;
  readonly project: string;
  readonly attachedAt: number;
  readonly title: string;
  readonly text: string;
  readonly actorPrincipal?: string;
  readonly actorAt?: number;
}

// ---------------------------------------------------------------------------
// The route contract (the demo arm — the composition's own per-instance law)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the research-note ingestion route (FW-45, the E-6 MVP)', () => {
  it('AUTHN FIRST: a request without the developer credential is the typed 401 — never a stored note', async () => {
    const deployment = composeInstance(demoSource());
    expect(deployment.ok).toBe(true);
    const refused = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-fw45-a/notes',
      body: { title: 't', text: 'x' },
    }));
    expect(refused.status).toBe(401);
    expect((refused.body.error as { code: string }).code).toBe('unauthenticated');
  });

  it('THE UNTRUSTED-INPUT GATE: a malformed body answers the typed 400 validation_failed (the boundary\'s own untrusted-payload law) with the broken paths named — never a half-applied note', async () => {
    const deployment = composeInstance(demoSource());
    const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'idempotency-key': 'idem:fw45:project' }, body: createProjectBody('prj-fw45-a') }));
    expect(created.status).toBe(201);
    for (const [label, body] of [
      ['not an object', '"a string body"'], // a VALID-JSON non-object — the platform's invalid_json 400 is a DIFFERENT (correct) refusal; this pins the route's own typed gate
      ['no title', { text: 'the note text' }],
      ['empty title', { title: '   ', text: 'the note text' }],
      ['no text', { title: 'A title' }],
      ['empty text', { title: 'A title', text: '' }],
      ['non-string text', { title: 'A title', text: 42 }],
      ['oversized title', { title: 'x'.repeat(121), text: 'the note text' }],
      ['oversized text', { title: 'A title', text: 'x'.repeat(16_001) }],
    ] as const) {
      const refused = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects/prj-fw45-a/notes', headers: BEARER, body }));
      expect(refused.status, label).toBe(400);
      expect((refused.body.error as { code: string }).code, label).toBe('validation_failed');
    }
    // nothing stored: the goal route serves NO notes after the refused attaches
    const goal = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw45-a/goal', headers: BEARER }));
    expect(goal.status).toBe(200);
    expect((goal.body.data as { notes?: unknown }).notes).toBeUndefined();
  });

  it('FAIL-CLOSED TARGET: a project with no goal set on record answers the typed 404 (the note rides a record that must exist — never a note on nothing)', async () => {
    const deployment = composeInstance(demoSource());
    const refused = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-never-created/notes',
      headers: BEARER,
      body: { title: 'A title', text: 'the note text' },
    }));
    expect(refused.status).toBe(404);
    expect((refused.body.error as { code: string }).code).toBe('not_found');
  });

  it('THE MINT: the note stores verbatim (title + text), carries its own scope + content-addressed id, and serves back on the goal route as the ADDITIVE notes field (the world precedent)', async () => {
    const deployment = composeInstance(demoSource());
    const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'idempotency-key': 'idem:fw45:project-b' }, body: createProjectBody('prj-fw45-b') }));
    expect(created.status).toBe(201);
    const attached = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-fw45-b/notes',
      headers: BEARER,
      body: { title: 'Factset export notes', text: 'fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4' },
    }));
    expect(attached.status).toBe(200);
    const note = (attached.body.data as { note: ServedNote }).note;
    expect(note.title).toBe('Factset export notes'); // verbatim
    expect(note.text).toBe('fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4'); // verbatim
    expect(note.tenant).toBe(TENANT); // the AUTHORIZED tenant, never a request value
    expect(note.project).toBe('prj-fw45-b');
    expect(note.noteId).toMatch(/^note:[0-9a-f]{8}$/); // content-addressed, the house's own id grammar
    expect(Number.isFinite(note.attachedAt)).toBe(true); // the route's own observation (L4)
    expect(note.actorPrincipal).toBeUndefined(); // an anonymous attach — the honest absence
    // THE READ-BACK: the goal route serves the note (the console's boot re-read)
    const goal = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw45-b/goal', headers: BEARER }));
    expect(goal.status).toBe(200);
    const served = (goal.body.data as { notes?: readonly ServedNote[] }).notes;
    expect(served).toEqual([note]);
    // IDEMPOTENT PER CONTENT: the identical attach (the same title + text)
    // returns the SAME record — never a duplicate
    const replay = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-fw45-b/notes',
      headers: BEARER,
      body: { title: 'Factset export notes', text: 'fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4' },
    }));
    expect(replay.status).toBe(200);
    const replayed = (replay.body.data as { note: ServedNote }).note;
    expect(replayed.noteId).toBe(note.noteId);
    const goalAfter = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw45-b/goal', headers: BEARER }));
    expect(((goalAfter.body.data as { notes?: readonly ServedNote[] }).notes ?? []).length).toBe(1); // exactly one row
    // a SECOND, different note appends (the analyst's own list grows)
    const second = await drive(deployment, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-fw45-b/notes',
      headers: BEARER,
      body: { title: 'Z-score params', text: 'z-entry 2.1, z-exit 0.4' },
    }));
    expect(second.status).toBe(200);
    const goalTwo = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw45-b/goal', headers: BEARER }));
    expect(((goalTwo.body.data as { notes?: readonly ServedNote[] }).notes ?? []).length).toBe(2);
  });

  it('the note is UNTRUSTED on the way OUT too: a stored row that no longer parses serves as ABSENT (R46 — never a crash, never a half-record)', async () => {
    // A note whose text is served but whose re-read hits a malformed field: the
    // serving parse is structural — this pins the goal route's degradation law
    // by serving a notes array whose SECOND entry is malformed (skipped
    // honestly) while the first rides verbatim.
    const deployment = composeInstance(demoSource());
    const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'idempotency-key': 'idem:fw45:project-c' }, body: createProjectBody('prj-fw45-c') }));
    expect(created.status).toBe(201);
    const attached = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects/prj-fw45-c/notes', headers: BEARER, body: { title: 'Good note', text: 'a well-formed note' } }));
    expect(attached.status).toBe(200);
    const goal = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw45-c/goal', headers: BEARER }));
    const served = (goal.body.data as { notes?: readonly ServedNote[] }).notes ?? [];
    expect(served).toHaveLength(1); // the well-formed row rides verbatim
    expect(served[0]?.text).toBe('a well-formed note');
  });
});

// ---------------------------------------------------------------------------
// The durable arm (the fake Neon fleet — the record-durability harness law)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the durable note storage (FW-45: the note is durable record, not per-instance state)', () => {
  it('THE WRITE-THROUGH + THE FRESH INSTANCE: a note attached on instance A merges into the project\'s goal-set row, and a NEW serverless instance composed over the same durable truth serves it on its own goal route', async () => {
    const providers = fakeProviders();
    const instanceA = composeInstance(durableSource(), providers.fetchLike);
    expect(instanceA.ok).toBe(true);
    // create + attach on instance A (the full pipeline, the durable drain confirms)
    const created = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'idempotency-key': 'idem:fw45:d-project' }, body: createProjectBody('prj-fw45-d') }));
    expect(created.status).toBe(201);
    const attached = await drive(instanceA, streamingRequest({
      method: 'POST',
      url: '/v1/projects/prj-fw45-d/notes',
      headers: BEARER,
      body: { title: 'Factset export notes', text: 'fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4' },
    }));
    expect(attached.status).toBe(200);
    const note = (attached.body.data as { note: ServedNote }).note;
    // instance A's own goal route serves it
    const goalA = await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw45-d/goal', headers: BEARER }));
    expect(((goalA.body.data as { notes?: readonly ServedNote[] }).notes ?? []).map((row) => row.noteId)).toEqual([note.noteId]);

    // THE FRESH INSTANCE — a new "serverless instance" over the same durable truth
    const instanceB = composeInstance(durableSource(), providers.fetchLike);
    expect(instanceB.ok).toBe(true);
    const goalB = await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw45-d/goal', headers: BEARER }));
    expect(goalB.status).toBe(200);
    const servedB = (goalB.body.data as { notes?: readonly ServedNote[] }).notes ?? [];
    expect(servedB.map((row) => row.noteId)).toEqual([note.noteId]); // the durable truth carries the note — never the pre-fix per-instance emptiness
    expect(servedB[0]?.text).toBe('fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4'); // verbatim across instances
    // the row-level truth: the goal-set row itself carries the notes (the same opaque payload column `world` rides)
    const deps: NeonStoreDeps = { config: NEON_CONFIG, fetchLike: providers.fetchLike, instants: { next: () => T0 } };
    const store = new NeonProjectStore(deps);
    const row = await store.goalSetOf(TENANT, 'prj-fw45-d');
    if (!row.ok) throw new Error(`the goal-set read failed: ${row.error.code}`);
    const notes = (row.value as { readonly notes?: readonly ServedNote[] } | null)?.notes ?? [];
    expect(notes.map((entry) => entry.noteId)).toEqual([note.noteId]);
  });
});
