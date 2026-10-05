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
// badge; see runtime/demo.ts). Under the DURABLE backing the ports
// stay the typed pending stubs until the W-3e hydration seam
// (deploy/wire/production.md) — those routes answer the typed 503.
//
// THE HOST-OWNED DEMO-SUBSTANCE READ ROUTES (W-8, additive): under the
// demo backing, two read-only routes are served from the seeded demo
// data BEFORE the boundary wrap (GET /v1/execution/submissions — the
// execution blotter, R2; GET /v1/projects/:id/goal — the seeded goal +
// constraint set, R5). The paths are declared nowhere in the frozen
// route table, so every other backing/shape keeps the exact pre-W-8
// behavior (the typed not-found). See runtime/routes.ts.
//
// NO CORS headers are ever emitted (the same-origin law — the console
// reaches this function through rewrites, never cross-origin).
//
// Zero-dep law: platform APIs only. Function config (region, memory,
// timeout) lives in deploy/vercel/vercel.json.

import { getDeploymentService, type DeploymentComposition } from '../runtime/compose';
import { toApiRequest, writeApiResponse, writeDegraded, type FunctionRequest, type FunctionResponse } from '../runtime/http';
import { serveDemoSubstanceRoute } from '../runtime/routes';

/** The demo-substance read routes' request serial (per instance — the minted request ids stay unique per invocation). */
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
  //    credential.
  if (deployment.demo !== null && deployment.demo.tick !== null) {
    deployment.demo.tick(Date.now());
  }

  // 3. Wrap the (req) into the ApiRequest contract.
  const wrapped = await toApiRequest(request);
  if (!wrapped.ok) {
    writeDegraded(response, 400, 'invalid_json', 'the request body is not valid JSON');
    return;
  }

  // 4. The host-owned demo-substance read routes (W-8, additive): served
  //    from the demo backing's seeded data when the request is one of
  //    them; every other request (and every other backing) falls through
  //    to the boundary unchanged.
  if (deployment.demo !== null) {
    const hostRoute = serveDemoSubstanceRoute(
      { ports: deployment.demo.ports, verifyDeveloperAuthorization: deployment.verifyDeveloperAuthorization },
      wrapped.request,
      demoSubstanceSerial++,
    );
    if (hostRoute !== null) {
      writeApiResponse(response, hostRoute);
      return;
    }
  }

  // 5. One request through the whole T041 pipeline.
  const apiResponse = deployment.service.handle(wrapped.request);

  // 6. Write the envelope out (no CORS — same-origin only).
  writeApiResponse(response, apiResponse);
}

export default async function handler(request: FunctionRequest, response: FunctionResponse): Promise<void> {
  await handleDeploymentRequest(getDeploymentService(), request, response);
}
