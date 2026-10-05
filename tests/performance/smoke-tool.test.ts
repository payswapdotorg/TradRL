/**
 * T050 — the smoke probe tool's own suite (the deterministic
 * performance surface's tooling half).
 *
 * THE LAW (ops/tooling/smoke.mjs — the seven-point production smoke
 * sequence of deploy/README.md §4 step 5, formalized): the probe must
 * (a) pass 7/7 against a correctly-responding origin, (b) FAIL each
 * individual check when exactly that check's response is broken
 * (every detector is proven to bite — the probe is the incident
 * runbook's FIRST instrument, a silent detector is worse than none),
 * (c) produce a byte-DETERMINISTIC report (identical responses ->
 * identical bytes), (d) NEVER echo the credential value (the opacity
 * law, spec/SECURITY.md), (e) never crash — a wedged origin fails
 * all seven checks with readable details, and (f) answer typed usage
 * errors (exit 2) before any network attempt.
 *
 * THE METHOD: the probe takes an INJECTED fetch — every scenario is a
 * scripted fake returning the REAL deployment's response shapes (the
 * envelope { requestId, data } / { requestId, error }, the projects
 * items array, the loader source text, the shell HTML). No network
 * anywhere in this suite; the live run is the operator's step
 * (ops/runbooks/production-readiness.md).
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  SmokeFetchLike,
  SmokeFetchLikeInit,
  SmokeFetchLikeResponse,
  SmokeProbeResult,
} from '../../ops/tooling/smoke.mjs';

const SMOKE_TOOL = fileURLToPath(new URL('../../ops/tooling/smoke.mjs', import.meta.url));
const BASE = 'https://tradrl-console.vercel.app';
const TOKEN = 'tok-smoke-probe-canary-0001';

/** Build one scripted response (Headers-like access, lowercased names — the platform's semantics). */
function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): SmokeFetchLikeResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const map = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    status,
    headers: {
      get: (name: string): string | null => map.get(name.toLowerCase()) ?? null,
      entries: (): IterableIterator<[string, string]> => map.entries(),
    },
    text: async (): Promise<string> => text,
  };
}

/** The healthy deployment's scripted responses (the runbook §4 step 5 shapes). */
function healthyOrigin(): SmokeFetchLike {
  return (url: string, init?: SmokeFetchLikeInit): Promise<SmokeFetchLikeResponse> => {
    const authenticated = (init?.headers?.authorization ?? '') === `Bearer ${TOKEN}`;
    if (url === `${BASE}/v1/meta`) {
      return Promise.resolve(authenticated
        ? fakeResponse(200, { requestId: 'req:1', data: { apiVersion: 'v1', supportedVersions: ['v1'] } }, { 'content-type': 'application/json' })
        : fakeResponse(401, { requestId: 'req:0', error: { code: 'unauthenticated', message: 'a credential token is required' } }));
    }
    if (url === `${BASE}/v1/projects`) {
      return Promise.resolve(authenticated
        ? fakeResponse(200, { requestId: 'req:2', data: { items: [{ id: 'prj-demo-console' }] } })
        : fakeResponse(401, { requestId: 'req:0', error: { code: 'unauthenticated', message: 'a credential token is required' } }));
    }
    if (url === `${BASE}/v1/knowledge/query`) {
      return Promise.resolve(fakeResponse(200, { requestId: 'req:3', data: { items: [{ record: { tenant: 'tenant-demo' } }] } }));
    }
    if (url === `${BASE}/src/loader/strip-types.ts`) {
      return Promise.resolve(fakeResponse(200, '// the loader source\nexport function stripTypes(source: string): string { return source; }\n', { 'content-type': 'text/plain' }));
    }
    if (url === `${BASE}/`) {
      return Promise.resolve(fakeResponse(200, '<!DOCTYPE html>\n<html><head><script>window.__TRADRL_CONSOLE__ = {};</script></head><body>the console shell</body></html>', { 'content-type': 'text/html' }));
    }
    return Promise.reject(new Error(`unexpected probe url: ${url}`));
  };
}

/** Load the tool (the dynamic import resolves the hand-authored smoke.d.mts — the deploy build-console precedent). */
async function loadSmoke(): Promise<{ runSmokeProbe: (options: { baseUrl: string; token: string; fetchImpl?: SmokeFetchLike }) => Promise<SmokeProbeResult>; SMOKE_CHECK_COUNT: number }> {
  return import('../../ops/tooling/smoke.mjs');
}

describe('the smoke probe — the healthy origin', () => {
  it('passes 7/7 with the deterministic report', async () => {
    const { runSmokeProbe, SMOKE_CHECK_COUNT } = await loadSmoke();
    expect(SMOKE_CHECK_COUNT).toBe(7);
    const result = await runSmokeProbe({ baseUrl: BASE, token: TOKEN, fetchImpl: healthyOrigin() });
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(7);
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(result.reportText).toContain('smoke: 7/7 checks passed');
    expect(result.reportText.split('\n').length).toBe(9); // header + 7 checks + the verdict line
  });

  it('the report is byte-DETERMINISTIC: identical responses produce identical bytes (no clock, no durations)', async () => {
    const { runSmokeProbe } = await loadSmoke();
    const first = await runSmokeProbe({ baseUrl: BASE, token: TOKEN, fetchImpl: healthyOrigin() });
    const second = await runSmokeProbe({ baseUrl: BASE, token: TOKEN, fetchImpl: healthyOrigin() });
    expect(second.reportText).toBe(first.reportText);
  });

  it('the credential NEVER appears in the report (the opacity law — byte-scan every line)', async () => {
    const { runSmokeProbe } = await loadSmoke();
    const result = await runSmokeProbe({ baseUrl: BASE, token: TOKEN, fetchImpl: healthyOrigin() });
    expect(result.reportText.includes(TOKEN)).toBe(false);
    for (const check of result.checks) {
      expect(`${check.name}${check.detail}`.includes(TOKEN)).toBe(false);
    }
  });
});

describe('the smoke probe — every detector bites (a broken origin is caught, check by check)', () => {
  /** Break exactly one aspect of the healthy origin; return the probe result. */
  async function probeWith(broken: SmokeFetchLike): Promise<SmokeProbeResult> {
    const { runSmokeProbe } = await loadSmoke();
    return runSmokeProbe({ baseUrl: BASE, token: TOKEN, fetchImpl: broken });
  }

  it('check 1 bites: an unauthenticated /v1/meta that answers 200 fails api-authn-first (and only that check)', async () => {
    const result = await probeWith((url, init) => {
      if (url === `${BASE}/v1/meta` && (init?.headers?.authorization ?? '') !== `Bearer ${TOKEN}`) {
        return Promise.resolve(fakeResponse(200, { requestId: 'req:0', data: { apiVersion: 'v1' } })); // BROKEN: authn is not first
      }
      return healthyOrigin()(url, init);
    });
    const failed = result.checks.filter((check) => !check.ok).map((check) => check.name);
    expect(failed).toEqual(['api-authn-first']);
    expect(result.failed).toBe(1);
  });

  it('check 2 bites: an authenticated /v1/meta that answers 500 fails api-meta', async () => {
    const result = await probeWith((url, init) => {
      if (url === `${BASE}/v1/meta` && (init?.headers?.authorization ?? '') === `Bearer ${TOKEN}`) {
        return Promise.resolve(fakeResponse(500, { requestId: 'req:1', error: { code: 'internal', message: 'boom' } }));
      }
      return healthyOrigin()(url, init);
    });
    expect(result.checks.filter((check) => !check.ok).map((check) => check.name)).toEqual(['api-meta']);
    expect(result.failed).toBe(1); // the 500's own headers carry no access-control header — check 3 still passes
  });

  it('check 3 bites: an access-control-allow-origin header fails same-origin-no-cors', async () => {
    const result = await probeWith((url, init) => {
      if (url === `${BASE}/v1/meta` && (init?.headers?.authorization ?? '') === `Bearer ${TOKEN}`) {
        return Promise.resolve(fakeResponse(200, { requestId: 'req:1', data: { apiVersion: 'v1' } }, { 'Access-Control-Allow-Origin': '*' }));
      }
      return healthyOrigin()(url, init);
    });
    expect(result.checks.filter((check) => !check.ok).map((check) => check.name)).toEqual(['same-origin-no-cors']);
  });

  it('check 4 bites: a /v1/projects that answers 503 fails api-projects (the typed degraded state is a deployment problem to investigate)', async () => {
    const result = await probeWith((url, init) => {
      if (url === `${BASE}/v1/projects`) {
        return Promise.resolve(fakeResponse(503, { requestId: 'req:2', error: { code: 'unavailable', message: 'deploy_adapter_pending' } }));
      }
      return healthyOrigin()(url, init);
    });
    expect(result.checks.filter((check) => !check.ok).map((check) => check.name)).toEqual(['api-projects']);
  });

  it('check 5 bites: a knowledge query that answers 404 fails api-knowledge', async () => {
    const result = await probeWith((url, init) => {
      if (url === `${BASE}/v1/knowledge/query`) {
        return Promise.resolve(fakeResponse(404, { requestId: 'req:3', error: { code: 'not_found', message: 'no knowledge' } }));
      }
      return healthyOrigin()(url, init);
    });
    expect(result.checks.filter((check) => !check.ok).map((check) => check.name)).toEqual(['api-knowledge']);
  });

  it('check 6 bites: an empty loader source fails loader-source', async () => {
    const result = await probeWith((url, init) => {
      if (url === `${BASE}/src/loader/strip-types.ts`) {
        return Promise.resolve(fakeResponse(200, ''));
      }
      return healthyOrigin()(url, init);
    });
    expect(result.checks.filter((check) => !check.ok).map((check) => check.name)).toEqual(['loader-source']);
  });

  it('check 7 bites: a shell without the __TRADRL_CONSOLE__ config block fails console-shell', async () => {
    const result = await probeWith((url, init) => {
      if (url === `${BASE}/`) {
        return Promise.resolve(fakeResponse(200, '<!DOCTYPE html><html><body>a blank page</body></html>'));
      }
      return healthyOrigin()(url, init);
    });
    expect(result.checks.filter((check) => !check.ok).map((check) => check.name)).toEqual(['console-shell']);
  });

  it('a WEDGED origin (every fetch throws) fails all seven checks with readable details — the probe never crashes', async () => {
    const wedged: SmokeFetchLike = () => Promise.reject(new Error('fetch failed: the origin is unreachable'));
    const result = await probeWith(wedged);
    expect(result.failed).toBe(7);
    expect(result.passed).toBe(0);
    expect(result.checks.every((check) => !check.ok && check.detail.length > 0)).toBe(true); // every failure is a readable detail, never a crash
    // The six fetch-attempting checks carry the origin's own error; the same-origin check reports its dependency honestly.
    const fetchErrors = result.checks.filter((check) => check.name !== 'same-origin-no-cors');
    expect(fetchErrors.every((check) => check.detail.includes('unreachable'))).toBe(true);
    expect(result.checks.find((check) => check.name === 'same-origin-no-cors')?.detail).toContain('the api-meta check did not run');
    expect(result.reportText).toContain('smoke: FAILED — 0/7 checks passed');
  });
});

describe('the smoke probe — the CLI (typed usage errors, offline)', () => {
  it('no arguments: exit 2 with the usage text on stderr, no network attempt', () => {
    const run = spawnSync(process.execPath, [SMOKE_TOOL], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('usage:');
    expect(run.stderr).toContain('TRADRL_SMOKE_BASE');
    expect(run.stdout).toBe('');
  });

  it('a base with no token: exit 2 (the authenticated checks cannot run without a credential)', () => {
    const run = spawnSync(process.execPath, [SMOKE_TOOL, BASE], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('usage:');
  });

  it('a non-http base: exit 2 BEFORE any fetch (the typed fail-closed usage error)', () => {
    const run = spawnSync(process.execPath, [SMOKE_TOOL, 'ftp://not-a-deployment', TOKEN], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('the base URL must be http(s)');
    expect(run.stdout).toBe('');
  });
});
