#!/usr/bin/env node
// ops/tooling/smoke.mjs — the production smoke probe (Work Order T050).
//
// THE LAW (deploy/README.md §4 step 5, formalized): the seven-point
// smoke sequence every production deployment must pass, as a
// repeatable tool — the SAME checks the runbook's curl sequence
// performs, one deterministic PASS/FAIL line per check, one exit
// code. The Lead runs it after every `npx vercel --prod`, and the
// incident runbook (ops/runbooks/incident-response.md) runs it in the
// first five minutes of every incident.
//
// THE CHECKS (the seven points, in runbook order):
//   1. api-authn-first   GET  /v1/meta with NO credential     -> the typed 401 envelope
//   2. api-meta          GET  /v1/meta with the credential    -> 200 + data.apiVersion === 'v1'
//   3. same-origin       (the api-meta response)              -> NO access-control-* header anywhere
//   4. api-projects      GET  /v1/projects                    -> 200 + data.items is an array
//   5. api-knowledge     POST /v1/knowledge/query             -> 200 + the success envelope
//   6. loader-source     GET  /src/loader/strip-types.ts      -> 200 + a non-empty source body
//   7. console-shell     GET  /                               -> 200 + the shell carries the config block
//
// ZERO-DEP (the deploy/ law): platform APIs only — global `fetch`,
// `node:process`, `node:url`. NO npm dependencies, no package.json
// under ops/, the lockfile is never touched.
//
// SECRETS NEVER ECHOED (spec/SECURITY.md): the credential arrives
// via argv/env and is sent ONLY in the Authorization header; the
// report NEVER contains its value (the smoke-tool test byte-scans
// the report for the token and asserts absence).
//
// DETERMINISM: the report is a pure function of the responses — no
// clock, no randomness, no durations; identical responses produce
// byte-identical report text (the test pins this).

import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// The injectable fetch surface (the tests script it; the CLI uses the
// platform's global fetch)
// ---------------------------------------------------------------------------

/** One probe request's init shape (the subset of RequestInit the probe uses). */
/** One probe response's read surface (the subset the probe reads). */

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * The default fetch adapter: the platform's global fetch, with a
 * per-request timeout (a wedged origin must fail the probe loudly,
 * never hang it — the incident runbook's first-five-minutes law).
 */
function platformFetch(url, init) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS) });
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

/** Run one check, catching everything (a thrown check is a FAILED check, never a crash). */
async function attempt(name, run) {
  try {
    const detail = await run();
    return { name, ok: true, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, ok: false, detail: message };
  }
}

/** Read + parse a JSON body, or throw a readable check failure. */
async function readJson(response, what) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${what}: the body is not a JSON object`);
    }
    return { text, body: parsed };
  } catch (error) {
    if (error instanceof Error && error.message.includes(': the body is not a JSON object')) throw error;
    throw new Error(`${what}: the body is not JSON (${text.slice(0, 80)})`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** Normalize a base URL (strip the trailing slash; keep the scheme + host as given). */
function normalizeBase(baseUrl) {
  const trimmed = baseUrl.trim();
  expect(trimmed.length > 0, 'the base URL is empty');
  expect(/^https?:\/\//.test(trimmed), `the base URL must be http(s): ${trimmed}`);
  return trimmed.replace(/\/+$/, '');
}

/**
 * THE SMOKE PROBE — the seven-point sequence against one deployment
 * origin. Pure over the injected fetch: identical responses produce
 * an identical `reportText` and identical check verdicts.
 *
 * @param {object} options
 * @param {string} options.baseUrl the deployment origin (e.g. https://tradrl-console.vercel.app)
 * @param {string} options.token the API credential (TRADRL_API_DEVELOPER_TOKEN's value)
 * @param {(url: string, init?: object) => Promise<object>} [options.fetchImpl] the fetch adapter (tests inject a scripted fake; the default is the platform fetch with a timeout)
 * @param {string} [options.knowledgeProject] the project the knowledge query probes (default: the seeded demo project)
 * @param {number} [options.knowledgeAt] the point-in-time instant the knowledge query probes (default: the runbook's documented instant)
 * @returns {Promise<object>} the probe result: { baseUrl, passed, failed, checks, reportText }
 */
export async function runSmokeProbe(options) {
  const baseUrl = normalizeBase(options.baseUrl);
  const token = options.token;
  expect(typeof token === 'string' && token.length > 0, 'the credential token is required — the authenticated checks (2-5) cannot run without it');
  const fetchImpl = options.fetchImpl ?? platformFetch;
  const knowledgeProject = options.knowledgeProject ?? 'prj-demo-console';
  const knowledgeAt = options.knowledgeAt ?? 1_730_000_000_000;
  const bearer = { authorization: `Bearer ${token}` };

  const checks = [];

  // 1. The pipeline is authn-first: NO credential -> the typed 401 envelope.
  checks.push(await attempt('api-authn-first', async () => {
    const response = await fetchImpl(`${baseUrl}/v1/meta`, { method: 'GET' });
    const { body } = await readJson(response, 'unauthenticated /v1/meta');
    expect(response.status === 401, `expected the typed 401, got ${response.status}`);
    expect(typeof body.error === 'object' && body.error !== null && typeof body.error.code === 'string' && body.error.code.length > 0, 'the 401 body carries no typed error code');
    return `401 ${body.error.code} (the pipeline is authn-first)`;
  }));

  // 2 + 3. The authenticated meta + the same-origin law (one response, two checks).
  let metaResponse = null;
  checks.push(await attempt('api-meta', async () => {
    metaResponse = await fetchImpl(`${baseUrl}/v1/meta`, { method: 'GET', headers: bearer });
    const { body } = await readJson(metaResponse, 'GET /v1/meta');
    expect(metaResponse.status === 200, `expected 200, got ${metaResponse.status}`);
    expect(body.data !== null && typeof body.data === 'object' && body.data.apiVersion === 'v1', 'the 200 body carries no data.apiVersion === "v1"');
    return `200 apiVersion=${body.data.apiVersion}`;
  }));
  checks.push(await attempt('same-origin-no-cors', async () => {
    expect(metaResponse !== null, 'the api-meta check did not run (its request failed)');
    const offenders = [];
    for (const [name] of metaResponse.headers.entries()) {
      if (name.toLowerCase().startsWith('access-control')) offenders.push(name);
    }
    expect(offenders.length === 0, `access-control headers present: ${offenders.join(', ')}`);
    return 'no access-control header anywhere (the same-origin law)';
  }));

  // 4. The data routes really serve: the projects list.
  checks.push(await attempt('api-projects', async () => {
    const response = await fetchImpl(`${baseUrl}/v1/projects`, { method: 'GET', headers: bearer });
    const { body } = await readJson(response, 'GET /v1/projects');
    expect(response.status === 200, `expected 200, got ${response.status}`);
    expect(body.data !== null && typeof body.data === 'object' && Array.isArray(body.data.items), 'the 200 body carries no data.items array');
    return `200 items=${body.data.items.length}`;
  }));

  // 5. The knowledge query (the point-in-time read path).
  checks.push(await attempt('api-knowledge', async () => {
    const response = await fetchImpl(`${baseUrl}/v1/knowledge/query`, {
      method: 'POST',
      headers: { ...bearer, 'content-type': 'application/json' },
      body: JSON.stringify({ project: knowledgeProject, at: knowledgeAt }),
    });
    const { body } = await readJson(response, 'POST /v1/knowledge/query');
    expect(response.status === 200, `expected 200, got ${response.status}`);
    expect(body.data !== null && (typeof body.data === 'object' || Array.isArray(body.data)), 'the 200 body carries no data envelope');
    return '200 (the knowledge read path serves)';
  }));

  // 6. The no-build loader's source really serves (the console boots from these bytes).
  checks.push(await attempt('loader-source', async () => {
    const response = await fetchImpl(`${baseUrl}/src/loader/strip-types.ts`, { method: 'GET' });
    expect(response.status === 200, `expected 200, got ${response.status}`);
    const text = await response.text();
    expect(text.length > 0, 'the loader source body is empty');
    return `200 bytes=${text.length}`;
  }));

  // 7. The console shell serves with its config block (the substituted __TRADRL_CONSOLE__).
  checks.push(await attempt('console-shell', async () => {
    const response = await fetchImpl(`${baseUrl}/`, { method: 'GET' });
    expect(response.status === 200, `expected 200, got ${response.status}`);
    const text = await response.text();
    expect(text.includes('__TRADRL_CONSOLE__'), 'the shell HTML carries no __TRADRL_CONSOLE__ config block');
    return `200 shell-bytes=${text.length}`;
  }));

  const passed = checks.filter((check) => check.ok).length;
  const failed = checks.length - passed;

  const lines = [`tradrl smoke — ${baseUrl}`];
  for (const check of checks) lines.push(`[${check.ok ? 'ok' : 'fail'}] ${check.name} — ${check.detail}`);
  lines.push(failed === 0 ? `smoke: ${passed}/${checks.length} checks passed` : `smoke: FAILED — ${passed}/${checks.length} checks passed`);

  return { baseUrl, passed, failed, checks, reportText: lines.join('\n') };
}

/** The number of checks the probe performs (the report's denominator). */
export const SMOKE_CHECK_COUNT = 7;

// ---------------------------------------------------------------------------
// The CLI (the operator entry: node ops/tooling/smoke.mjs <BASE> <TOKEN>)
// ---------------------------------------------------------------------------

const USAGE = [
  'tradrl smoke probe (ops/tooling/smoke.mjs) — the seven-point production smoke sequence',
  '',
  'usage:',
  '  node ops/tooling/smoke.mjs <BASE> <TOKEN>',
  '  TRADRL_SMOKE_BASE=<BASE> TRADRL_SMOKE_TOKEN=<TOKEN> node ops/tooling/smoke.mjs',
  '',
  '  <BASE>   the deployment origin (e.g. https://tradrl-console.vercel.app)',
  '  <TOKEN>  the TRADRL_API_DEVELOPER_TOKEN credential value (never echoed)',
  '',
  'exit codes: 0 = all checks passed; 1 = one or more checks failed; 2 = usage error',
].join('\n');

async function main(argv, env) {
  const baseUrl = argv[0] ?? env.TRADRL_SMOKE_BASE;
  const token = argv[1] ?? env.TRADRL_SMOKE_TOKEN;
  if (baseUrl === undefined || token === undefined || baseUrl === '' || token === '') {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  try {
    const result = await runSmokeProbe({ baseUrl, token });
    process.stdout.write(`${result.reportText}\n`);
    return result.failed === 0 ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`smoke: FAILED before the first check — ${message}\n`);
    return 2;
  }
}

// Run as a script (not when imported by the tests).
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code;
  });
}
