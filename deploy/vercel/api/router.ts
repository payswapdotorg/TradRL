// deploy/vercel/api/router.ts — THE VERCEL SERVERLESS FUNCTION (T052).
//
// The PUBLIC API plane's single entry point on Vercel: every /v1/* and
// /internal/* request (routed same-origin by the rewrites in
// deploy/vercel/vercel.json) lands here and is WRAPPED into the T041
// route table (services/api is frozen — this function invokes
// `service.handle`, it never re-implements a route).
//
// What runs per request: the full T041 pipeline (authn -> authz ->
// tenant-context injection -> rate limit -> validation -> handler ->
// audit -> response — L20) with L12 tenant isolation intact and R41
// metering on every request. What is host-owned here: the credential
// registry (env-injected at the secure boundary), the instant source,
// and — under the DEMO backing (W-3f, the default without durable
// provider keys) — the per-request demo machinery tick, which advances
// non-terminal jobs through the REAL private plane so the async
// pattern renders on the public console (honest under the SIMULATED
// badge; see runtime/demo.ts). Under the DURABLE backing the W-3e
// hydration seam (W-25D, runtime/durable.ts) serves the Neon-backed
// surfaces from the per-instance projection: this handler awaits the
// boot-time projection before serving (settled), drives the W-26B
// durable activation — the idempotent boot world (the demo world seed +
// the fixture substance + the org-status snapshots, every durable write
// drained before the first serve; a failure is the typed 503, retried
// per request) and the SAME machinery tick over the hydrated control
// plane (the org-compile pass + the job advancement) — and drains every
// request's pending durable writes before the response leaves (a
// failed write is the typed 503 — the ordering law, runtime/durable.ts).
//
// THE HOST-OWNED DEMO-SUBSTANCE READ ROUTES (W-8, additive; W-26C R4 the
// durable arm): read-only routes served from the backing's seeded data
// BEFORE the boundary wrap (GET /v1/execution/submissions — the execution
// blotter, R2; GET /v1/projects/:id/goal — the seeded goal + constraint
// set, R5; GET /v1/jobs?project=<id> — the jobs list, D-3 the W-25A seam:
// the backing's API-owned job store, the same store the per-id GET
// reads). Under the DEMO backing they serve from the seeded demo data;
// under the DURABLE backing (W-26C, R4) the goal read serves the seam's
// hydrated goal sets (W-25D, D-5) and the jobs list + blotter serve
// through the SAME folds over the composed service's per-instance
// stores (the boot world re-seeds the demo jobs per instance; the
// seam-live recording gateway carries the live submissions). The paths
// are declared nowhere in the frozen route table, so every other
// backing/shape keeps the exact pre-W-8 behavior (the typed not-found).
// See runtime/routes.ts.
//
// NO CORS headers are ever emitted (the same-origin law — the console
// reaches this function through rewrites, never cross-origin).
//
// Zero-dep law: platform APIs only. Function config (region, memory,
// timeout) lives in deploy/vercel/vercel.json.

import { getDeploymentService, type DeploymentComposition } from '../runtime/compose';
import { demoJobsOf } from '../runtime/demo';
import { toApiRequest, writeApiResponse, writeDegraded, type FunctionRequest, type FunctionResponse } from '../runtime/http';
import { drainedFailureResponse, serveDemoSubstanceRoute, serveDurableSubstanceRoute, serveRunbookRoute } from '../runtime/routes';

/** The demo-substance/durable-goal read routes' request serial (per instance — the minted request ids stay unique per invocation). */
let demoSubstanceSerial = 0;

/**
 * Serve ONE request over an ALREADY-COMPOSED deployment (the test seam:
 * the runtime harness drives the full function path — tick, wrap,
 * host-route, boundary — without env games; the default `handler` below
 * composes from the process environment exactly as before).
 */
export async function handleDeploymentRequest(deployment: DeploymentComposition, request: FunctionRequest, response: FunctionResponse): Promise<void> {
  // 1. Compose (memoized per instance — warm starts reuse the service).
  if (!deployment.ok) {
    // The typed degraded state (R46): the deployment is not configured —
    // MISSING KEY NAMES ONLY, never values (secrets never cross the wire).
    writeDegraded(response, 503, 'deploy_not_configured', `the API deployment is not configured: ${deployment.missing.join(', ')} (see deploy/.env.example)`);
    return;
  }

  // 2. The demo machinery tick (W-3f): under the demo backing, advance
  //    non-terminal jobs through the real private plane BEFORE the
  //    request is served, so the console's job polling observes the
  //    async pattern (submitted -> running -> complete) — and compile
  //    any user-launched project's organization (W-8's R4 pass, same
  //    tick). A no-op under every other backing / without the internal
  //    credential. THE DEMO PATH STAYS BYTE-IDENTICAL (W-26B's R5).
  if (deployment.demo !== null && deployment.demo.tick !== null) {
    deployment.demo.tick(Date.now());
  }

  // 2b. THE DURABLE SEAM (W-25D) + THE DURABLE ACTIVATION (W-26B): await
  //     the boot-time projection (or any in-flight re-projection — a
  //     failed projection retries per request, no circuit state, so a
  //     Neon that recovers mid-instance heals the surfaces). The first
  //     request after a cold start pays the hydration; warm requests
  //     reuse the per-instance projection. THEN the boot world (W-26B):
  //     the demo world seed + the fixture substance + the org-status
  //     snapshots, once per instance, every durable write DRAINED before
  //     the first serve (the ordering law) — a failure is the typed 503
  //     (the seeded world is unconfirmed; never a crash, never a silent
  //     partial world) and the next request retries. THEN the machinery
  //     tick (W-26B, R2): the SAME demoMachineryTick law (org compile +
  //     job advancement through the real private plane) over the seam's
  //     HYDRATED control plane — driven AFTER the projection + boot world
  //     so the first request already sees the seeded world compiled.
  if (deployment.durable !== null) {
    await deployment.durable.settled();
    try {
      await deployment.durable.ensureBootWorld();
    } catch (cause) {
      const failure = cause as { readonly code: string; readonly message: string };
      writeDegraded(response, 503, 'unavailable', `the durable boot world failed (${failure.code}): ${failure.message} — the seeded world is unconfirmed; the boundary degrades this request and retries on the next (R46)`);
      return;
    }
    if (deployment.durable.tick !== null) {
      deployment.durable.tick(Date.now());
    }
  }

  // 3. Wrap the (req) into the ApiRequest contract.
  const wrapped = await toApiRequest(request);
  if (!wrapped.ok) {
    writeDegraded(response, 400, 'invalid_json', 'the request body is not valid JSON');
    return;
  }

  // 3b. THE HOST-OWNED INTERNAL DDL RUNBOOK ROUTES (W-28, lane B):
  //     POST /internal/deploy/ddl/apply + GET /internal/deploy/ddl/verify —
  //     the Lead's governed API surface to heal production (and any future
  //     database) with a single authenticated call. Internal-credential
  //     auth FIRST (the typed 401 envelope the boundary uses — authn
  //     before any work), then the durable-presence check (the typed
  //     `deploy_adapter_absent` 503 when the seam was not built — the
  //     matrix's Neon-absent row), then the operation. The EXACT host-owned
  //     pattern the W-8/W-25A demo-substance routes use (the runbook
  //     routes are served BEFORE the boundary wrap, declared nowhere in
  //     the frozen route table; without this section they would answer the
  //     typed not-found). The runbook rides the SAME Neon SQL-over-HTTP
  //     client the durable stores compose over (no new dependency, no
  //     re-implementation of the wire format). L12 — the routes read NO
  //     tenant data (the DDL is schema-level; the verify query is
  //     information_schema only). See runtime/routes.ts.
  const runbookRoute = await serveRunbookRoute(
    {
      durable: deployment.durable,
      verifyInternalAuthorization: deployment.verifyInternalAuthorization,
    },
    wrapped.request,
    demoSubstanceSerial++,
  );
  if (runbookRoute !== null) {
    writeApiResponse(response, runbookRoute);
    return;
  }

  // 4. The host-owned demo-substance read routes (W-8, additive): served
  //    from the demo backing's seeded data when the request is one of
  //    them; every other request (and every other backing) falls through
  //    to the boundary unchanged. Under the DURABLE backing the same
  //    substance paths serve (W-26C, R4 — D-3 + the blotter preserved
  //    under durable): the goal read from the seam's hydrated goal sets
  //    (W-25D, D-5) and, since W-26C, the jobs list + the execution
  //    blotter through the DEMO arm's own handlers — the SAME folds
  //    (demoJobsOf + demoSubmissionsOf, imported from runtime/demo.ts)
  //    over the composed service's per-instance stores, with the same
  //    auth + envelope discipline. Under port overrides (the injection
  //    seam owns its own world) the jobs + submissions routes fall
  //    through to the boundary (the pre-W-8 law).
  if (deployment.demo !== null) {
    const hostRoute = serveDemoSubstanceRoute(
      {
        ports: deployment.demo.ports,
        verifyDeveloperAuthorization: deployment.verifyDeveloperAuthorization,
        jobsOf: (tenant, project) => demoJobsOf(deployment.service, tenant, project),
      },
      wrapped.request,
      demoSubstanceSerial++,
    );
    if (hostRoute !== null) {
      writeApiResponse(response, hostRoute);
      return;
    }
  } else if (deployment.durable !== null) {
    const hostRoute = serveDurableSubstanceRoute(
      {
        durable: deployment.durable,
        verifyDeveloperAuthorization: deployment.verifyDeveloperAuthorization,
        demoSubstance: deployment.durable.demoSubstance,
      },
      wrapped.request,
      demoSubstanceSerial++,
    );
    if (hostRoute !== null) {
      // THE WRITE-THROUGH DRAIN ON THE HOST-ROUTE PATH (W-27, D-7): the
      // per-request machinery tick (step 2b) may have queued durable writes
      // — a job transition of the W-27 write-through lane included — and a
      // host-route-served response leaves HERE, before the boundary path's
      // own drain (step 5b). The ordering law (the host awaits the
      // request's pending durable writes BEFORE the response is served)
      // therefore runs on THIS path too: a failed write replaces the host
      // route's answer with the typed 503 (the mutation is unconfirmed;
      // the seam re-projects — the caller learns, never a silent
      // divergence). Before W-27 the tick's writes could sit pending on
      // this path until some later boundary request drained them.
      const drained = await deployment.durable.drain();
      if (!drained.ok) {
        writeApiResponse(response, drainedFailureResponse(hostRoute, drained.error));
        return;
      }
      writeApiResponse(response, hostRoute);
      return;
    }
  }

  // 5. One request through the whole T041 pipeline.
  const apiResponse = deployment.service.handle(wrapped.request);

  // 5b. THE WRITE-THROUGH DRAIN (W-25D — the ordering law's second half):
  //     the host awaits the request's pending durable writes BEFORE the
  //     response is served. A failed write replaces the response with the
  //     typed 503 (the caller learns the mutation is unconfirmed; the seam
  //     re-projects from the durable truth — the unconfirmed mutation is
  //     never served, never a silent divergence).
  if (deployment.durable !== null) {
    const drained = await deployment.durable.drain();
    if (!drained.ok) {
      writeApiResponse(response, drainedFailureResponse(apiResponse, drained.error));
      return;
    }
  }

  // 6. Write the envelope out (no CORS — same-origin only).
  writeApiResponse(response, apiResponse);
}

export default async function handler(request: FunctionRequest, response: FunctionResponse): Promise<void> {
  await handleDeploymentRequest(getDeploymentService(), request, response);
}
