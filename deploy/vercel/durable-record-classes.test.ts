// deploy/vercel/durable-record-classes.test.ts — THE FW-47-A TESTS (Round M
// register items M-1 + M-2 + M-4 — the durable note/alert record family,
// every Round M seat's #1 friction, the unanimous 9/9 top finding).
//
// WHAT IS PINNED (the whole defect class, through the FULL function handler
// — runtime/compose.ts + api/router.ts, the REAL Neon adapters over the
// fake provider fleet, no network — the record-durability.test.ts harness
// law):
//
//   (a) THE PAGE-RELOAD SHAPE (M-1): a note attached + an alert declared on
//       the warm instance are DURABLE RECORD, and the console's OWN read
//       path must serve them — every console request carries
//       x-tradrl-console-session, so its goal read is the session-scoped
//       route's DURABLE arm (runtime/session-routes.ts), which pre-fix
//       served goal + constraintSet + world ONLY. The durable WRITE lane
//       was honest all along (attachNote/declareAlert merge into the
//       goal-set row and drain to the store; the HEADERLESS goal route
//       serves the rows — pinned inside as the root-cause evidence), but
//       the console's fold law is "a notes-less read CLEARS" (the world
//       law), so every boot re-read wiped state.notes/state.alerts: the
//       cards read "No ... on record yet" and every post-reload export
//       derived ZERO record-prefix events for the classes on the same
//       reload the core records survived. THE PIN: the session-scoped goal
//       read serves the verbatim envelopes at their OWN instants
//       (attachedAt/declaredAt — L4, never the serve clock).
//
//   (b) THE BACKEND-DROP SHAPE (M-1): the same law over a FRESH serverless
//       instance composed over the same durable truth — the classes
//       survive the instance recreation, not just the page reload.
//
//   (c) THE L2-CONT DRIFT SHAPE (M-2): a note attached on instance A, ON
//       RECORD before the composition, must land on warm instance B's
//       serving projection through the staleness heal's CONTENT PROBE (the
//       FW-42-A unseenWorld seam, extended to the record classes) so B's
//       research-job completion NAMES it — never "no research notes
//       attached to this project on record" while the row sits one drawer
//       away (L2-cont's provenance drift: a deliverable citing evidence
//       the composing instance could not see). The cross-instance
//       staleness window is bounded by the heal's own 10s interval (the
//       same bound the world probe carries — disclosed as a bound, never
//       an instant guarantee).
//
//   (d) THE CITATION-RESOLVES SHAPE (M-2): the fresh instance serves the
//       PERSISTED deliverable's cited refs (the durable job row's
//       notes/alerts provenance blocks) AND the cited rows on the
//       console's own read path — every ref the deliverable names resolves
//       to the record the console's export derives its note-attached/
//       alert-declared entries from (L3's "citation to evidence that no
//       longer exists" — the examiner finds the evidence in the same
//       truth, never a residue).
//
//   (e) THE ADDITIVE-ABSENCE LAW (keep-green): a project with no notes and
//       no alerts serves NEITHER field — never a fabricated empty array
//       (an absent record class never fabricates; the `world` precedent).
//
// Spec anchors: R43 (additive), R46 (every failure path typed), L4 (the
// records' own instants, never the serve clock), L12 (the authorized
// tenant's own rows), ROUND-M-REPORT §4 M-1/M-2/M-4, the FW-45/FW-46
// record-class laws, the FW-42-A write-then-read law's probe family.

import { describe, expect, it, vi } from 'vitest';
import { composeDeployment } from './runtime/compose';
import { API_ENV_KEYS, readApiEnv } from './runtime/env';
import { handleDeploymentRequest } from './api/router';
import { CONSOLE_SESSION_HEADER } from './runtime/session-routes';
import { fakeProviders } from '../wire/smoketest';
import type { FetchLike } from '../adapters/shared';
import { validConstraintSet, validGoal } from '../../services/api/src/fixtures';
import type { FunctionRequest, FunctionResponse } from './runtime/http';

// ---------------------------------------------------------------------------
// The fixed fake world (the record-durability harness law — never a real credential)
// ---------------------------------------------------------------------------

const TENANT = 'tenant-fw47a';
const TOKEN = 'tok-deploy-fw47a';
const PRINCIPAL = 'public-console';
const NEON_KEYS = {
  NEON_API_HOST: 'ep-fw47a-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-fw47a',
};

/** The env source of a durable deployment with the internal credential (the machinery tick + the heal ride it). */
function durableSourceWithMachinery(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...NEON_KEYS,
    [API_ENV_KEYS.apiInternalToken]: 'tok-internal-fw47a',
    [API_ENV_KEYS.apiInternalPrincipal]: 'fw47a-machinery',
    ...overrides,
  };
}

/** The fixed instant base of the scenario (deterministic durable rows + deterministic machinery ticks). */
const T0 = 1_800_700_000_000;

/** Compose one durable instance over the injected fetch (a fresh "serverless instance"). */
function composeInstance(source: Record<string, string | undefined>, fetchLike: FetchLike) {
  return composeDeployment(readApiEnv(source), {}, { fetchLike, instants: { next: () => T0 } });
}

/** The bearer headers of the deployment's developer credential. */
const BEARER = { authorization: `Bearer ${TOKEN}` };

/** The console's own headers: the bearer credential + the console session (the console carries it on EVERY request — apps/web/src/core/session.ts). */
function consoleHeaders(session: string): Record<string, string> {
  return { ...BEARER, [CONSOLE_SESSION_HEADER]: session };
}

/** The page-reload shape's two sessions: the booting session that created the desk, and the FRESH page session a browser restart minted. */
const SESSION_BOOT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SESSION_RELOADED = 'cccccccccccccccccccccccccccccccc';

/** One create-project body (the REAL T007 goal/constraint shapes, tenant-scoped). */
function createProjectBody(projectId: string, at = T0): Record<string, unknown> {
  return { id: projectId, name: `the ${projectId} desk`, executionMode: 'simulation', goal: validGoal(TENANT), constraintSet: validConstraintSet(TENANT), at };
}

/** The minted note record's shape as the host note route serves it. */
interface ServedNote {
  readonly noteId: string;
  readonly tenant: string;
  readonly project: string;
  readonly attachedAt: number;
  readonly title: string;
  readonly text: string;
}

/** The minted alert record's shape as the host alert route serves it. */
interface ServedAlert {
  readonly alertId: string;
  readonly tenant: string;
  readonly project: string;
  readonly declaredAt: number;
  readonly market: string;
  readonly direction: 'above' | 'below';
  readonly level: string;
}

/** The composed deliverable's record-class provenance blocks (runtime/deliverable.ts's own shapes). */
interface DeliverableNoteRef { readonly noteId: string; readonly title: string }
interface DeliverableAlertRef { readonly alertId: string; readonly market: string; readonly direction: string; readonly level: string }

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

type Deployment = ReturnType<typeof composeInstance>;

/** Drive one request through the FULL function handler; returns the parsed JSON body. */
async function drive(deployment: Deployment, request: FunctionRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const { response, captured } = capture();
  await handleDeploymentRequest(deployment, request, response);
  const written = captured();
  return { status: written.status, body: JSON.parse(written.payload ?? 'null') as Record<string, unknown> };
}

/** Flush the fire-and-forget heal's microtask chain (the fake fleet's fetch resolves on microtasks; the heal + a quiet refresh ride ~12 awaited fetches). */
async function flushAsyncWork(): Promise<void> {
  for (let settle = 0; settle < 400; settle += 1) await Promise.resolve();
}

/** The session-scoped goal read the console's boot bundle drives (the console's OWN read path). */
async function consoleGoalRead(deployment: Deployment, projectId: string, session: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const read = await drive(deployment, streamingRequest({ method: 'GET', url: `/v1/projects/${projectId}/goal?project=${encodeURIComponent(projectId)}`, headers: consoleHeaders(session) }));
  return { status: read.status, data: (read.body.data ?? {}) as Record<string, unknown> };
}

/**
 * THE DURABLE RECORD SEED (the console's flow, every step through the FULL
 * handler): create the project under the booting console session, attach
 * one research note, declare one price alert, and drain — the durable
 * goal-set row carries both record classes from here on. Returns the two
 * minted records verbatim.
 */
async function seedDurableRecordClasses(
  deployment: Deployment,
  projectId: string,
): Promise<{ readonly note: ServedNote; readonly alert: ServedAlert }> {
  const created = await drive(deployment, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...consoleHeaders(SESSION_BOOT), 'content-type': 'application/json' }, body: createProjectBody(projectId) }));
  expect(created.status).toBe(201);
  const attached = await drive(deployment, streamingRequest({
    method: 'POST',
    url: `/v1/projects/${projectId}/notes`,
    headers: consoleHeaders(SESSION_BOOT),
    body: { title: 'Factset export notes', text: 'fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4' },
  }));
  expect(attached.status).toBe(200);
  const note = (attached.body.data as { note: ServedNote }).note;
  const declared = await drive(deployment, streamingRequest({
    method: 'POST',
    url: `/v1/projects/${projectId}/alerts`,
    headers: consoleHeaders(SESSION_BOOT),
    body: { market: 'BTC-USD', direction: 'above', level: '61500' },
  }));
  expect(declared.status).toBe(200);
  const alert = (declared.body.data as { alert: ServedAlert }).alert;
  // THE DRAIN (the ordering law): the host note/alert routes are
  // sync-hosted, so the merges confirm on the NEXT request's drain — the
  // console's own beat cadence drains them within a beat.
  const drained = await drive(deployment, streamingRequest({ method: 'GET', url: '/v1/meta', headers: consoleHeaders(SESSION_BOOT) }));
  expect(drained.status).toBe(200);
  return { note, alert };
}

// ---------------------------------------------------------------------------
// (a) + (b) THE SERVE SEAM — the console's own read path serves the durable rows
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-47-A (M-1): the note/alert record classes are durable on the console\'s own read path', () => {
  it('THE PAGE-RELOAD SHAPE: attach + declare on the warm instance, then a FRESH page session\'s session-scoped goal read carries the verbatim envelopes at their OWN instants (the write lane was honest all along — the headerless route serves the rows; the console\'s own route must too)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // the boot world settles

      // THE SEED: create + attach + declare + drain (the console's flow).
      vi.setSystemTime(T0 + 1_000);
      const { note, alert } = await seedDurableRecordClasses(instanceA, 'prj-fw47a-page');

      // THE ROOT-CAUSE EVIDENCE (the honest write lane — pinned green at
      // RED): the HEADERLESS goal route (the SDK caller's path — the
      // durable-substance arm of runtime/routes.ts) serves both record
      // classes off the SAME durable truth. The rows are on record; the
      // defect is exclusively the console's own serve path.
      const headerless = await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw47a-page/goal?project=prj-fw47a-page', headers: BEARER }));
      expect(headerless.status).toBe(200);
      expect(((headerless.body.data as { notes?: readonly ServedNote[] }).notes ?? []).map((row) => row.noteId)).toEqual([note.noteId]);
      expect(((headerless.body.data as { alerts?: readonly ServedAlert[] }).alerts ?? []).map((row) => row.alertId)).toEqual([alert.alertId]);

      // THE PIN (the console's own read path): a FRESH page session — a
      // browser restart minted a new console session id; under DURABLE the
      // registry row serves every session (FW-31-B) — reads the goal
      // bundle through the session-scoped route. The verbatim envelopes
      // serve, each stamped at ITS OWN record instant (L4: attachedAt/
      // declaredAt, never the serve clock), exactly like the headerless
      // caller's serve.
      vi.setSystemTime(T0 + 5_000);
      const reloaded = await consoleGoalRead(instanceA, 'prj-fw47a-page', SESSION_RELOADED);
      expect(reloaded.status).toBe(200);
      const servedNotes = (reloaded.data.notes ?? []) as readonly ServedNote[];
      const servedAlerts = (reloaded.data.alerts ?? []) as readonly ServedAlert[];
      expect(servedNotes).toEqual([note]); // the verbatim envelope — noteId, title, text, attachedAt
      expect(servedNotes[0]?.text).toBe('fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4');
      expect(servedNotes[0]?.attachedAt).toBe(note.attachedAt); // the record's OWN instant — never this read's
      expect(servedAlerts).toEqual([alert]); // the verbatim envelope — alertId, market, direction, level, declaredAt
      expect(servedAlerts[0]?.level).toBe('61500');
      expect(servedAlerts[0]?.declaredAt).toBe(alert.declaredAt); // the record's OWN instant
    } finally {
      vi.useRealTimers();
    }
  });

  it('THE BACKEND-DROP SHAPE: a FRESH serverless instance over the same durable truth serves the verbatim envelopes on the console\'s own read path — the classes survive the instance recreation, never the pre-fix notes-less read that cleared them', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      vi.setSystemTime(T0 + 1_000);
      const { note, alert } = await seedDurableRecordClasses(instanceA, 'prj-fw47a-drop');

      // THE BACKEND DROP (the reload-equivalent's harder half): a NEW
      // serverless instance boots from the durable truth alone — its
      // projection, its overlay, its session routes all reconstruct from
      // the rows. The console session that lands on it (fresh or rebooted)
      // reads the goal bundle through its own serve path.
      vi.setSystemTime(T0 + 5_000);
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // the boot world settles + hydrates

      const reloaded = await consoleGoalRead(instanceB, 'prj-fw47a-drop', SESSION_RELOADED);
      expect(reloaded.status).toBe(200);
      const servedNotes = (reloaded.data.notes ?? []) as readonly ServedNote[];
      const servedAlerts = (reloaded.data.alerts ?? []) as readonly ServedAlert[];
      expect(servedNotes).toEqual([note]); // verbatim across the instance boundary
      expect(servedNotes[0]?.attachedAt).toBe(note.attachedAt); // the record's OWN instant, byte-stable across instances
      expect(servedAlerts).toEqual([alert]);
      expect(servedAlerts[0]?.declaredAt).toBe(alert.declaredAt);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// (c) THE L2-CONT DRIFT SHAPE — the heal's content probe lands a
//     cross-instance attach on the composing instance's projection
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-47-A (M-2): the heal\'s content probe lands a cross-instance attach on the composing instance\'s projection', () => {
  it('a note attached on instance A, ON RECORD before the composition, lands on warm instance B\'s serving projection within the heal\'s 10s bound — B\'s research-job completion NAMES it (never the pre-fix "no research notes attached" while the row sits one drawer away)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();

      // INSTANCE A (the attaching instance): boots, pays the boot world,
      // then carries the CREATE at T0+1s.
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      vi.setSystemTime(T0 + 1_000);
      const created = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...BEARER, 'content-type': 'application/json' }, body: createProjectBody('prj-fw47a-l2c') }));
      expect(created.status).toBe(201);

      // INSTANCE B boots at T0+2s — AFTER the create, BEFORE the kickoff:
      // its boot projection holds the goal set NOTE-LESS (this is the warm
      // instance the balancer keeps routing the console's polls to), and
      // its job store predates the kickoff (the job can only ever reach B
      // through the heal's jobs half — the G-6-gated import). Its first
      // tick ARMS the staleness-heal interval.
      vi.setSystemTime(T0 + 2_000);
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

      // THE KICKOFF ON A (T0+3s) — WORLD-LESS by design (a direct-submit
      // research spec: no launch world ever exists, so no world divergence
      // can trigger the FW-42-A probe — this test isolates the RECORD-
      // CLASSES probe the wave adds).
      vi.setSystemTime(T0 + 3_000);
      const kickoff = await drive(instanceA, streamingRequest({
        method: 'POST',
        url: '/v1/jobs/research',
        headers: { ...BEARER, 'idempotency-key': 'idem:fw47a:l2c:kickoff' },
        body: { kind: 'research', projectId: 'prj-fw47a-l2c', spec: { source: 'fw47a-l2c-evidence', objective: 'measure the venue-lag gap between executed and modeled fills over the trailing window' } },
      }));
      expect(kickoff.status).toBe(202);
      const jobId = (kickoff.body as { data: { jobId: string } }).data.jobId;

      // THE ATTACH ON A (T0+4s) — ON RECORD (drained at T0+5s) BEFORE any
      // composition: A's overlay merges it and the durable goal-set row
      // carries it. B's serving projection — booted at T0+2s — does NOT:
      // no new registry id appears, no outcome/post-mortem/knowledge id
      // appears, and the row's additive `notes` array is exactly the
      // content the pre-fix probes never compared (L2-cont's drift: the
      // note was attached 22s before the completion in the measured
      // evidence; the same shape, paced tighter here — the law is the
      // bound, not the gap's length).
      vi.setSystemTime(T0 + 4_000);
      const attached = await drive(instanceA, streamingRequest({
        method: 'POST',
        url: '/v1/projects/prj-fw47a-l2c/notes',
        headers: consoleHeaders(SESSION_BOOT),
        body: { title: 'Venue-lag calibration', text: 'the kraken fill trail lags the modeled print by 340ms at the 75th percentile; calibrate the gap before reading the completion' },
      }));
      expect(attached.status).toBe(200);
      const note = (attached.body.data as { note: ServedNote }).note;
      vi.setSystemTime(T0 + 5_000);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // A's drain lands the note on the durable row

      // B's poll at T0+13s (11s since the interval armed): the tick has no
      // kickoff job in B's store yet (nothing advances), and the heal
      // FIRES — the content probe compares the fresh session-JOIN row's
      // structurally-validated record classes against the serving
      // projection's: a note the projection does not carry is a
      // DIVERGENCE, the quiet re-projection lands it, and the jobs half
      // (G-6-gated on the refresh) imports the kickoff job onto the FRESH
      // projection. Fire-and-forget: flush.
      vi.setSystemTime(T0 + 13_000);
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      await flushAsyncWork();

      // THE COMPLETION ON B (T0+14s): the tick advances the imported
      // kickoff job and composes the release candidate from the projection
      // the heal just landed — the deliverable NAMES the note on record
      // (the count + the citable ref), never the pre-fix omission
      // (measured RED: result.notes.count 0 — L2-cont's drift).
      vi.setSystemTime(T0 + 14_000);
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const completed = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: BEARER }));
      expect(completed.status).toBe(200);
      const record = (completed.body as { data: { status: string; result: { notes: { count: number; refs: readonly DeliverableNoteRef[] }; summary: string } } }).data;
      expect(record.status).toBe('complete');
      expect(record.result.notes.count).toBe(1); // the note ON RECORD — never the pre-fix 0
      expect(record.result.notes.refs).toEqual([{ noteId: note.noteId, title: 'Venue-lag calibration' }]); // the citable ref, verbatim
      expect(record.result.summary).toContain('Venue-lag calibration'); // the provenance statement names it
      expect(record.result.summary).not.toContain('no research notes attached'); // never the drift's omission sentence
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// (d) THE CITATION-RESOLVES SHAPE — every ref the persisted deliverable
//     cites resolves against the rows the console's own read path serves
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-47-A (M-2 + M-4): the citation residue is closed at the console\'s own read path', () => {
  it('the fresh instance serves the persisted deliverable\'s cited refs AND the cited rows on the session-scoped goal read — every note/alert ref the deliverable\'s provenance names resolves to the verbatim record the console\'s export derives its events from (the examiner finds the evidence, never the residue)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

      // THE SEED, ORDERED SO THE COMPOSITION CITES BOTH CLASSES: the note
      // and the alert are on record (A's overlay) BEFORE the completing
      // tick, so the composed deliverable's provenance blocks name them.
      vi.setSystemTime(T0 + 1_000);
      const created = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...consoleHeaders(SESSION_BOOT), 'content-type': 'application/json' }, body: createProjectBody('prj-fw47a-cite') }));
      expect(created.status).toBe(201);
      const kickoff = await drive(instanceA, streamingRequest({
        method: 'POST',
        url: '/v1/jobs/research',
        headers: { ...BEARER, 'idempotency-key': 'idem:fw47a:cite:kickoff' },
        body: { kind: 'research', projectId: 'prj-fw47a-cite', spec: { source: 'fw47a-cite-evidence', objective: 'reconcile the modeled fill trail against the recorded one' } },
      }));
      expect(kickoff.status).toBe(202);
      const jobId = (kickoff.body as { data: { jobId: string } }).data.jobId;
      vi.setSystemTime(T0 + 2_000);
      // THE ATTACH + THE DECLARE (before the completing tick, so the
      // composition's provenance blocks cite both classes).
      const attached = await drive(instanceA, streamingRequest({
        method: 'POST',
        url: '/v1/projects/prj-fw47a-cite/notes',
        headers: consoleHeaders(SESSION_BOOT),
        body: { title: 'Factset export notes', text: 'fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4' },
      }));
      expect(attached.status).toBe(200);
      const note = (attached.body.data as { note: ServedNote }).note;
      vi.setSystemTime(T0 + 3_000);
      const declared = await drive(instanceA, streamingRequest({
        method: 'POST',
        url: '/v1/projects/prj-fw47a-cite/alerts',
        headers: consoleHeaders(SESSION_BOOT),
        body: { market: 'BTC-USD', direction: 'above', level: '61500' },
      }));
      expect(declared.status).toBe(200);
      const alert = (declared.body.data as { alert: ServedAlert }).alert;

      // THE COMPLETION ON A (T0+10s): the tick composes the release
      // candidate with BOTH classes on record — the durable job row (and
      // every instance that serves it) carries the cited refs verbatim.
      vi.setSystemTime(T0 + 10_000);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      vi.setSystemTime(T0 + 11_000);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // the drain lands the completed row

      // THE FRESH INSTANCE (the examiner's seat: a browser that never saw
      // the live session, reading only what the durable truth serves).
      vi.setSystemTime(T0 + 12_000);
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));

      // THE PERSISTED DELIVERABLE'S CITED REFS (the durable job row — the
      // per-id read serves them on every instance, pre-fix and post-fix):
      // the provenance blocks name the note + the alert.
      const deliverable = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: BEARER }));
      expect(deliverable.status).toBe(200);
      const cited = (deliverable.body as { data: { status: string; result: { notes: { count: number; refs: readonly DeliverableNoteRef[] }; alerts: { count: number; refs: readonly DeliverableAlertRef[] } } } }).data;
      expect(cited.status).toBe('complete');
      expect(cited.result.notes.count).toBe(1);
      expect(cited.result.notes.refs).toEqual([{ noteId: note.noteId, title: 'Factset export notes' }]);
      expect(cited.result.alerts.count).toBe(1);
      expect(cited.result.alerts.refs).toEqual([{ alertId: alert.alertId, market: 'BTC-USD', direction: 'above', level: '61500' }]);

      // THE CONSOLE'S OWN READ PATH — THE RESIDUE'S HOME (pre-fix: this
      // read served NEITHER class, so the export the console composed
      // carried the deliverable's citations with ZERO note-attached/
      // alert-declared rows behind them — L3's "citation to evidence that
      // no longer exists", the examiner finds nothing). THE PIN: the
      // session-scoped goal read serves the cited rows verbatim.
      const read = await consoleGoalRead(instanceB, 'prj-fw47a-cite', SESSION_RELOADED);
      expect(read.status).toBe(200);
      const servedNotes = (read.data.notes ?? []) as readonly ServedNote[];
      const servedAlerts = (read.data.alerts ?? []) as readonly ServedAlert[];
      expect(servedNotes.map((row) => row.noteId)).toEqual([note.noteId]);
      expect(servedNotes[0]?.text).toBe(note.text); // the verbatim text — the evidence itself, not just the ref
      expect(servedAlerts.map((row) => row.alertId)).toEqual([alert.alertId]);
      expect(servedAlerts[0]?.market).toBe(alert.market);
      expect(servedAlerts[0]?.level).toBe(alert.level);

      // THE EXAMINER'S FOLD (both halves in ONE truth): every cited ref
      // resolves to a served row — noteId→note (title + text verbatim),
      // alertId→alert (envelope verbatim). With the rows served on the
      // console's own read path, the export's note-attached/alert-declared
      // entries derive from exactly these records: the citation resolves
      // IN THE SAME FILE the deliverable rides.
      for (const ref of cited.result.notes.refs) {
        const resolved = servedNotes.find((row) => row.noteId === ref.noteId);
        expect(resolved, `the cited note ${ref.noteId} must resolve on the console's own read path`).toBeDefined();
        expect(resolved?.title).toBe(ref.title);
      }
      for (const ref of cited.result.alerts.refs) {
        const resolved = servedAlerts.find((row) => row.alertId === ref.alertId);
        expect(resolved, `the cited alert ${ref.alertId} must resolve on the console's own read path`).toBeDefined();
        expect(resolved?.market).toBe(ref.market);
        expect(resolved?.direction).toBe(ref.direction);
        expect(resolved?.level).toBe(ref.level);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// (e) THE ADDITIVE-ABSENCE LAW (keep-green) — an absent record class never fabricates
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-47-A: the additive-absence law (an absent record class never fabricates)', () => {
  it('a project with no notes and no alerts serves NEITHER field on the console\'s own read path — never a fabricated empty array (the `world` precedent: absent means absent)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      vi.setSystemTime(T0 + 1_000);
      const created = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...consoleHeaders(SESSION_BOOT), 'content-type': 'application/json' }, body: createProjectBody('prj-fw47a-absent') }));
      expect(created.status).toBe(201);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // the drain

      const read = await consoleGoalRead(instanceA, 'prj-fw47a-absent', SESSION_RELOADED);
      expect(read.status).toBe(200);
      expect(read.data.goal).toBeDefined(); // the bundle itself serves (the create's own goal set)
      expect('notes' in read.data).toBe(false); // NEITHER field — the honest absence, never []
      expect('alerts' in read.data).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
