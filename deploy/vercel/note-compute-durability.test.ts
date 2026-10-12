// deploy/vercel/note-compute-durability.test.ts — THE FW-48 DECISIVE
// END-TO-END PIN (the E-6 compute layer, M3's second YES-flip condition):
// the compute's own output — the INPUT SET (which notes, at which instants,
// what each contributed), the parsed parameters with their per-parameter
// provenance ("from note:<id>"), and the note-derived analysis — rides the
// research job's OWN record durably, and EVERYTHING survives a fresh
// serverless instance field-for-field (FW-47-A's durable classes as the
// base, verified at the same seam: the console's own goal read still serves
// the notes the compute read).
//
// THE SHAPE (the record-durability harness law — the FULL function handler
// over the fake Neon fleet, no network): create the project under the
// console session, attach ONE MARKER NOTE carrying a typed declaration in
// the constraint grammar (the wizard's own grammar — the note's free-text
// digest rides alongside it, evidence only) + ONE CONTROL NOTE (no typed
// declaration — evidence only, never fabricated into parameters), submit
// the research job, let the machinery tick complete it, then read the job
// record's result through a FRESH INSTANCE.
//
// WHAT IS PINNED:
//   (a) the job record's result carries the compute's INPUT SET — both
//       notes at their OWN attachedAt (L4 — never the composition clock),
//       the marker note named with its parameter, the control note named as
//       evidence only, the parsed parameter with "from note:<id>";
//   (b) the result carries the note-derived ANALYSIS — the note-declared
//       bound tested against the desk's own records, with the honest cause
//       named where the records allow no test (a direct-submit research job
//       books no fills — M2's own Round M finding; the row teaches 'no fill
//       records on file', never a fabricated observation);
//   (c) a FRESH serverless instance over the same durable truth serves the
//       SAME job record field-for-field (the DEEP comparison — the durable
//       store's JSON round-trip normalizes key order, so byte-identity is
//       not the law; FW-47-A's precedent compares fields);
//   (d) FW-47-A's base under the new compute: the console's own read path
//       still serves the verbatim note records the compute's input set
//       cites (the examiner finds the evidence in the same truth).
//
// Spec anchors: R43 (additive), R45 (provenance), R46 (typed degradation),
// L4 (the notes' own instants), L12 (the authorized tenant's own rows),
// L20 (analysis, never enforcement), ROUND-M-REPORT §2 + §4 (the E-6 seam),
// the FW-45/FW-47-A record-class laws this wave builds on.

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

const TENANT = 'tenant-fw48';
const TOKEN = 'tok-deploy-fw48';
const PRINCIPAL = 'public-console';
const NEON_KEYS = {
  NEON_API_HOST: 'ep-fw48-pooler.us-east-2.aws.neon.tech',
  NEON_DATABASE: 'neondb',
  NEON_API_USER: 'neondb_owner',
  NEON_API_KEY: 'fake-neon-key-fw48',
};

/** The env source of a durable deployment with the internal credential (the machinery tick + the heal ride it). */
function durableSourceWithMachinery(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [API_ENV_KEYS.apiDeveloperToken]: TOKEN,
    [API_ENV_KEYS.apiDeveloperTenant]: TENANT,
    [API_ENV_KEYS.apiDeveloperPrincipal]: PRINCIPAL,
    ...NEON_KEYS,
    [API_ENV_KEYS.apiInternalToken]: 'tok-internal-fw48',
    [API_ENV_KEYS.apiInternalPrincipal]: 'fw48-machinery',
    ...overrides,
  };
}

/** The fixed instant base of the scenario (deterministic durable rows + deterministic machinery ticks). */
const T0 = 1_800_800_000_000;

/** Compose one durable instance over the injected fetch (a fresh "serverless instance"). */
function composeInstance(source: Record<string, string | undefined>, fetchLike: FetchLike) {
  return composeDeployment(readApiEnv(source), {}, { fetchLike, instants: { next: () => T0 } });
}

/** The bearer headers of the deployment's developer credential. */
const BEARER = { authorization: `Bearer ${TOKEN}` };

/** The console's own headers: the bearer credential + the console session (the console carries it on EVERY request). */
function consoleHeaders(session: string): Record<string, string> {
  return { ...BEARER, [CONSOLE_SESSION_HEADER]: session };
}

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

// ---------------------------------------------------------------------------
// The decisive end-to-end pin
// ---------------------------------------------------------------------------

describe('deploy/vercel — FW-48: the compute\'s own output rides the job record durably (the E-6 compute layer, end to end)', () => {
  it('the marker note\'s typed declaration + the control note compose the input set + the note-derived analysis on the job record, and a FRESH serverless instance serves the same record field-for-field (FW-47-A\'s base verified under the new compute)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const providers = fakeProviders();
      const instanceA = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceA.ok).toBe(true);
      if (!instanceA.ok) return;
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // the boot world settles

      // THE SEED (the console's flow, every step through the FULL handler):
      // the project exists, then the marker note (a typed declaration line +
      // the desk-head digest — evidence only) and the control note attach,
      // then the drain lands both on the durable goal-set row.
      vi.setSystemTime(T0 + 1_000);
      const created = await drive(instanceA, streamingRequest({ method: 'POST', url: '/v1/projects', headers: { ...consoleHeaders(SESSION_BOOT), 'content-type': 'application/json' }, body: createProjectBody('prj-fw48-compute') }));
      expect(created.status).toBe(201);

      vi.setSystemTime(T0 + 2_000);
      const attachedMarker = await drive(instanceA, streamingRequest({
        method: 'POST',
        url: '/v1/projects/prj-fw48-compute/notes',
        headers: consoleHeaders(SESSION_BOOT),
        body: {
          title: 'M2 Round M desk research priors',
          text: 'P2M desk research priors — the sizing discipline the analysts run.\n'
            + 'c-1:outcome:order.notional:limit.max:30000\n'
            + 'half-life 6.4d, z-entry 1.8/z-exit 0.4, overlay correlation 0.62, turnover 8.3x/month, fee budget 2.5 bps',
        },
      }));
      expect(attachedMarker.status).toBe(200);
      const markerNote = (attachedMarker.body.data as { note: ServedNote }).note;
      vi.setSystemTime(T0 + 3_000);
      const attachedControl = await drive(instanceA, streamingRequest({
        method: 'POST',
        url: '/v1/projects/prj-fw48-compute/notes',
        headers: consoleHeaders(SESSION_BOOT),
        body: { title: 'Factset export notes', text: 'fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4' },
      }));
      expect(attachedControl.status).toBe(200);
      const controlNote = (attachedControl.body.data as { note: ServedNote }).note;

      // THE RESEARCH JOB (a direct-submit kickoff — the L2-cont shape): both
      // notes are ON RECORD before the completion, so the composition's input
      // set carries them (the point-in-time record law — a note attached
      // after completion never retro-enters the input set).
      vi.setSystemTime(T0 + 4_000);
      const kickoff = await drive(instanceA, streamingRequest({
        method: 'POST',
        url: '/v1/jobs/research',
        headers: { ...BEARER, 'idempotency-key': 'idem:fw48:compute:kickoff' },
        body: { kind: 'research', projectId: 'prj-fw48-compute', spec: { source: 'fw48-compute-evidence', objective: 'measure whether the desk\'s own booked orders hold the note-declared sizing bound' } },
      }));
      expect(kickoff.status).toBe(202);
      const jobId = (kickoff.body as { data: { jobId: string } }).data.jobId;

      // THE DRAIN + THE COMPLETION (T0+10s/T0+11s): the tick composes the
      // release candidate over the durable goal-set row — the notes are in
      // the input set, the typed declaration is parsed with provenance, and
      // the note-declared bound is tested against the desk's own records.
      vi.setSystemTime(T0 + 5_000);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: consoleHeaders(SESSION_BOOT) })); // the drain lands both notes on the durable row
      vi.setSystemTime(T0 + 10_000);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      vi.setSystemTime(T0 + 11_000);
      await drive(instanceA, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER })); // the drain lands the completed row

      // (a) + (b) THE JOB RECORD'S RESULT — the compute's own output.
      const completed = await drive(instanceA, streamingRequest({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: BEARER }));
      expect(completed.status).toBe(200);
      const record = (completed.body as {
        data: {
          status: string;
          result: {
            inputs: { notes: readonly { noteId: string; attachedAt: number; title: string; contributed: string }[]; parameters: readonly { subject: string; kind: string; bound: string; fromNote: string }[]; disclosure: string };
            noteAnalysis: { evaluations: readonly { subject: string; status: string; observed: string | null; note: string }[]; statement: string } | null;
            summary: string;
          };
        };
      }).data;
      expect(record.status).toBe('complete');
      // The input set: both notes at their OWN attachedAt (L4 — the record's
      // instants, never the composition clock), each named with what it
      // contributed; the control note rides as evidence only.
      expect(record.result.inputs.notes).toEqual([
        { noteId: markerNote.noteId, attachedAt: markerNote.attachedAt, title: 'M2 Round M desk research priors', contributed: '1 typed parameter' },
        { noteId: controlNote.noteId, attachedAt: controlNote.attachedAt, title: 'Factset export notes', contributed: 'evidence only' },
      ]);
      expect(record.result.inputs.notes[0]!.attachedAt).toBe(T0 + 2_000); // the record's OWN instant, byte-stable
      expect(record.result.inputs.notes[1]!.attachedAt).toBe(T0 + 3_000);
      // The parsed parameter with its per-parameter provenance.
      expect(record.result.inputs.parameters).toEqual([
        { id: 'c-1', domain: 'outcome', subject: 'order.notional', kind: 'limit.max', bound: '30000', severity: 'blocking', fromNote: markerNote.noteId },
      ]);
      // The note-derived analysis: the bound is tested against the desk's own
      // records — a direct-submit job books no fills (M2's Round M finding),
      // so the row teaches the honest cause, never a fabricated observation.
      expect(record.result.noteAnalysis).not.toBeNull();
      expect(record.result.noteAnalysis!.evaluations).toHaveLength(1);
      expect(record.result.noteAnalysis!.evaluations[0]!.subject).toBe('order.notional');
      expect(record.result.noteAnalysis!.evaluations[0]!.status).toBe('not_computable');
      expect(record.result.noteAnalysis!.evaluations[0]!.observed).toBeNull();
      expect(record.result.noteAnalysis!.evaluations[0]!.note).toContain('no fill records on file');
      expect(record.result.noteAnalysis!.statement).toContain('analysis, never enforcement'); // L20 on the block itself
      // The summary discloses the compute's ACTUAL input set and cites the
      // note-derived bound — the pre-FW-48 false tail never renders.
      expect(record.result.summary).toContain('the compute layer read them: 1 typed parameter(s) parsed with per-parameter provenance');
      expect(record.result.summary).toContain(`order.notional limit.max 30000 from ${markerNote.noteId}`);
      expect(record.result.summary).toContain('no fill records on file'); // the honest cause, in the sentence
      expect(record.result.summary).not.toContain('nothing computes over it here'); // the seam this wave closes — the false tail is DEAD

      // (c) THE FRESH SERVERLESS INSTANCE (the examiner's seat): the same
      // durable truth serves the SAME job record field-for-field (the DEEP
      // comparison — the JSON round-trip normalizes key order; FW-47-A's
      // precedent compares fields, never serialized bytes).
      vi.setSystemTime(T0 + 20_000);
      const instanceB = composeInstance(durableSourceWithMachinery(), providers.fetchLike);
      expect(instanceB.ok).toBe(true);
      if (!instanceB.ok) return;
      await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/meta', headers: BEARER }));
      const reServed = await drive(instanceB, streamingRequest({ method: 'GET', url: `/v1/jobs/${jobId}`, headers: BEARER }));
      expect(reServed.status).toBe(200);
      expect((reServed.body as { data: unknown }).data).toEqual(record); // field-for-field — the compute's output is durable record

      // (d) FW-47-A'S BASE UNDER THE NEW COMPUTE: the console's own read path
      // still serves the verbatim note records the input set cites — every
      // noteId in the compute's input set resolves to a served row (the
      // examiner finds the evidence in the same truth, never a residue).
      const goalRead = await drive(instanceB, streamingRequest({ method: 'GET', url: '/v1/projects/prj-fw48-compute/goal?project=prj-fw48-compute', headers: consoleHeaders(SESSION_RELOADED) }));
      expect(goalRead.status).toBe(200);
      const servedNotes = ((goalRead.body.data as { notes?: readonly ServedNote[] }).notes ?? []) as readonly ServedNote[];
      expect(servedNotes.map((row) => row.noteId)).toEqual([markerNote.noteId, controlNote.noteId]);
      expect(servedNotes[0]!.text).toContain('c-1:outcome:order.notional:limit.max:30000'); // the verbatim text — the evidence itself
      for (const entry of record.result.inputs.notes) {
        const resolved = servedNotes.find((row) => row.noteId === entry.noteId);
        expect(resolved, `the input set's cited note ${entry.noteId} must resolve on the console's own read path`).toBeDefined();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
