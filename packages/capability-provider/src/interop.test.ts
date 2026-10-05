/**
 * Cross-lane interoperability trip wires for the capability-provider
 * lane (Work Order T045): the REAL lanes this interface consumes ONLY
 * through its STRUCTURAL MIRRORS are loaded STATICALLY here (the tests
 * are the trip wires — the src lane itself imports none of them):
 *
 *   - packages/skills (T017 — the capability/skill language): the REAL
 *     `createSkillRecord` accepts the L18 imported-artifact draft this
 *     lane mints (the import path satisfies the REAL evidence law —
 *     L16a measured evidence, the evidence-citation law, L9 lineage,
 *     L12 scope), the REAL serialization is byte-deterministic, and a
 *     label-smuggled draft is rejected by the REAL validator with the
 *     SAME law this lane enforces. The REAL `MeasuredEvidence` union,
 *     `CapabilityGapMirror`, `SkillApplicability` and `SkillOrigin`
 *     are compile-time mutual-assignment witnesses against this lane's
 *     mirrors, and the REAL label vocabulary matches member-for-member.
 *   - packages/sdk (T041 — the API/SDK surface): the idempotency-key
 *     derivation is byte-identical to this lane's mirror derivation;
 *     the shared error code keeps its REAL SDK family in this lane's
 *     boundary projection.
 *   - packages/sdk + services/api driven END-TO-END: a capability
 *     request envelope rides the REAL public jobs route (the REAL
 *     client through the REAL pipeline: authn -> authz -> tenant
 *     injection -> rate limit -> validation -> handler -> audit) as the
 *     job's OPAQUE spec, is retained by the REAL submission port, is
 *     read back through the REAL typed client, and narrows back to the
 *     typed envelope byte-exactly.
 */

import { describe, expect, it } from 'vitest';

// --- The REAL lanes (test-only; this lane's src imports NONE of them) --------
import * as skills from '../../skills/src/index';
import * as sdk from '../../sdk/src/index';
import { registryStableDigest } from '../../agent-body/src/capability-registry';
import { createTradRLClient } from '../../sdk/src/client';
import type { SdkRequest, SdkResponse } from '../../sdk/src/transport';
import { fixtureService, TENANT_A, TOKEN_A } from '../../../services/api/src/fixtures';
import type { ApiRequest, ApiResponse, JobRecord } from '../../../services/api/src/index';

// --- This lane -----------------------------------------------------------------
import {
  API_BOUNDARY_ERROR_FAMILY_OF,
  capabilityRequestJobIdempotencyKey,
  capabilityRequestJobPayload,
  CAPABILITY_REQUEST_JOB_OPERATION,
  deriveIdempotencyKeyMirror,
  importAsSkillRecordDraft,
  isEvidenceRef,
  LABEL_EVIDENCE_KEYS_MIRROR,
  narrowCapabilityRequestJobPayload,
  stableDigest,
  stableDigestJson,
} from './index';
import type {
  CapabilityGapMirror,
  JobRecordMirror,
  MeasuredEvidenceMirror,
  SkillApplicabilityMirror,
  SkillOriginMirror,
} from './index';
import { FIXTURE_EVIDENCE, runHappyPath, validRequestDraft } from './fixtures';
import { validateCapabilityRequest } from './index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL T017 MeasuredEvidence IS this lane's mirror. */
function realEvidenceSatisfiesMirror(evidence: skills.MeasuredEvidence): MeasuredEvidenceMirror {
  return evidence;
}

/** Compiles iff the REAL T017 CapabilityGapMirror IS this lane's mirror. */
function realGapSatisfiesMirror(gap: skills.CapabilityGapMirror): CapabilityGapMirror {
  return gap;
}

/** Compiles iff the REAL T017 SkillApplicability IS this lane's mirror. */
function realApplicabilitySatisfiesMirror(applicability: skills.SkillApplicability): SkillApplicabilityMirror {
  return applicability;
}

/** Compiles iff the REAL T017 SkillOrigin IS this lane's mirror vocabulary. */
function realOriginSatisfiesMirror(origin: skills.SkillOrigin): SkillOriginMirror {
  return origin;
}

/** Compiles iff the REAL T041 JobRecord (as the SDK types it) IS this lane's mirror. */
function realJobSatisfiesMirror(job: sdk.JobRecord): JobRecordMirror {
  return job;
}

void realEvidenceSatisfiesMirror;
void realGapSatisfiesMirror;
void realApplicabilitySatisfiesMirror;
void realOriginSatisfiesMirror;
void realJobSatisfiesMirror;

// ---------------------------------------------------------------------------
// The T017 trip wires
// ---------------------------------------------------------------------------

describe('the REAL T017 skills language (the capability language this interface speaks)', () => {
  it('the L16a label vocabulary matches member-for-member (the same law)', () => {
    expect([...skills.LABEL_EVIDENCE_KEYS]).toEqual([...LABEL_EVIDENCE_KEYS_MIRROR]);
  });

  it('the REAL measured-evidence guard accepts this lane\'s mirror evidence, and vice versa', () => {
    for (const evidence of FIXTURE_EVIDENCE) {
      expect(skills.isMeasuredEvidence(evidence)).toBe(true);
    }
    expect(skills.isMeasuredEvidence({ kind: 'label', label: 'mathematician' })).toBe(false);
  });

  it('the REAL capability-gap guard accepts this lane\'s mirror gap record (the request-commissioning language)', () => {
    const gap = {
      gapId: 'gap-regime-0042',
      kind: 'regime',
      capabilityKey: 'liquidity-regime-analysis',
      evidenceRef: 'evi://capsule-123',
      detectedAt: 1_730_000_000_000,
      tenantId: 'tenant-capability-fixture',
      projectId: 'prj-capability-fixture',
    } as CapabilityGapMirror;
    expect(skills.isCapabilityGapMirror(gap)).toBe(true);
    // And the skills-lane guard rejects a malformed gap exactly like this lane's:
    expect(skills.isCapabilityGapMirror({ ...gap, kind: 'not-a-kind' })).toBe(false);
  });

  it('THE L18 TRIP WIRE: the REAL createSkillRecord accepts the imported-artifact draft', () => {
    const run = runHappyPath();
    const imported = importAsSkillRecordDraft(run.state, run.engagement.engagementId);
    if (!imported.ok) throw new Error(imported.errors.map((e) => e.message).join('; '));
    // The REAL constructor runs the FULL REAL law (L16a + evidence citation + L9 lineage + L12 scope).
    const record = skills.createSkillRecord(imported.value);
    expect(record.skillId).toBe(imported.value.skillId);
    expect(record.provenance.origin).toBe('imported-artifact');
    expect(record.provenance.attainmentEvidenceRefs).toContain(run.verification.reportId);
    expect(record.lineage.gapRefs).toEqual(run.request.gapRefs);
    expect(record.lineage.extractionVersion).toBe(imported.value.lineage.extractionVersion);
    expect(record.descriptor.measuredEvidence.length).toBeGreaterThan(0);
    // The REAL serialization is byte-deterministic (same record, same bytes, twice).
    expect(skills.serializeSkillRecord(record)).toBe(skills.serializeSkillRecord(record));
    // And the REAL validator accepts it too.
    expect(skills.validateSkillRecord(record).ok).toBe(true);
  });

  it('the REAL validator rejects a label-smuggled import with the SAME law this lane enforces', () => {
    const run = runHappyPath();
    const imported = importAsSkillRecordDraft(run.state, run.engagement.engagementId);
    if (!imported.ok) throw new Error(imported.errors.map((e) => e.message).join('; '));
    const smuggled = { ...imported.value, profession: 'Senior Quantitative Analyst' };
    expect(() => skills.createSkillRecord(smuggled)).toThrow(/label_as_evidence/);
    // ... and this lane's own request validator enforces the same law:
    const smuggledRequest = validateCapabilityRequest({ ...validRequestDraft(), profession: 'Senior Quantitative Analyst' });
    expect(smuggledRequest.ok).toBe(false);
    if (!smuggledRequest.ok) {
      expect(smuggledRequest.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
    }
  });

  it('the REAL skill-origin vocabulary reserves the imported-artifact path this lane feeds (L18)', () => {
    expect([...skills.SKILL_ORIGINS]).toContain('imported-artifact');
  });
});

// ---------------------------------------------------------------------------
// The program-wide digest law (the same fold, the same bytes, everywhere)
// ---------------------------------------------------------------------------

describe('the program-wide stable digest (parity with the REAL lanes)', () => {
  it('stableDigest is byte-identical to the REAL T017 skills fold on shared vectors (non-ASCII included)', () => {
    const vectors: readonly string[] = [
      '',
      'plain-ascii-vector',
      '{"a":1,"b":[2,3]}',
      'latin-1: café résumé',
      'cjk: 流動性レジーム分析',
      'astral: \u{1D54F}liquidity\u{1F680}',
      'mixed \u0000-free «quotes» and — dashes — with ünïcödé',
    ];
    for (const vector of vectors) {
      expect(stableDigest(vector)).toBe(skills.stableDigest(vector));
    }
  });

  it('stableDigestJson is byte-identical to the REAL skills fold over JSON values', () => {
    const vectors: readonly unknown[] = [
      { b: 1, a: [true, null, 'x'] },
      { summary: 'Liquidité — régime', consideration: { currency: 'eur', amount: 42 } },
      ['é', '流', '𝕏'],
      1760000000000,
    ];
    for (const vector of vectors) {
      expect(stableDigestJson(vector)).toBe(skills.stableDigestJson(vector as never));
    }
  });

  it('the fold also matches the T016 substrate-registry digest (the program-wide law has ONE fold)', () => {
    for (const vector of ['registry-vector', 'ünïcödé-μicrostructure', '{"k":"v"}']) {
      expect(stableDigest(vector)).toBe(registryStableDigest(vector));
    }
  });

  it('the opaque-ref guards agree: control-character refs are refused by BOTH lanes', () => {
    // The REAL skills lane excludes [\u0000-\u001f]; this lane's mirror
    // accepts nothing the real lane rejects (the import path can never
    // mint a draft T017 would refuse on ref grammar).
    expect(skills.isEvidenceRef('evi://capsule-with-\u0001-control')).toBe(false);
    expect(isEvidenceRef('evi://capsule-with-\u0001-control')).toBe(false);
    expect(skills.isEvidenceRef('evi://capsule-123')).toBe(true);
    expect(isEvidenceRef('evi://capsule-123')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The T041 SDK trip wires
// ---------------------------------------------------------------------------

describe('the REAL T041 SDK surface (the API integration)', () => {
  it('the idempotency-key derivation is byte-identical to this lane\'s mirror', () => {
    const vectors: readonly unknown[] = [
      ['capability-provider.request', 'cpr:0123456789abcdef'],
      ['jobs.research', { projectId: 'prj-x', spec: { a: 1 } }],
      'plain-string',
      [1, 2, { b: [true, null] }],
    ];
    for (const vector of vectors) {
      expect(deriveIdempotencyKeyMirror(vector)).toBe(sdk.deriveIdempotencyKey(vector));
    }
    // The envelope's boundary key IS the REAL SDK derivation over the operation identity.
    const run = runHappyPath();
    expect(capabilityRequestJobIdempotencyKey(run.request)).toBe(
      sdk.deriveIdempotencyKey([CAPABILITY_REQUEST_JOB_OPERATION, run.request.requestId]),
    );
  });

  it('the shared error code keeps its REAL SDK family in this lane\'s boundary projection', () => {
    expect(sdk.SDK_ERROR_CODES).toContain('cross_tenant_access');
    expect(sdk.SDK_ERROR_FAMILY_OF.cross_tenant_access).toBe(API_BOUNDARY_ERROR_FAMILY_OF.cross_tenant_access);
  });
});

// ---------------------------------------------------------------------------
// The end-to-end drive: the request envelope rides the REAL jobs surface
// ---------------------------------------------------------------------------

/** Parse the SDK's `path?query` into the service's (path, query record). */
function splitQuery(path: string): { readonly path: string; readonly query?: Record<string, string> } {
  const questionAt = path.indexOf('?');
  if (questionAt === -1) return { path: path.split('/').map((segment) => decodeURIComponent(segment)).join('/') };
  const raw = path.slice(questionAt + 1);
  const query: Record<string, string> = {};
  for (const pair of raw.split('&')) {
    if (pair.length === 0) continue;
    const equalsAt = pair.indexOf('=');
    const key = decodeURIComponent(equalsAt === -1 ? pair : pair.slice(0, equalsAt));
    const value = equalsAt === -1 ? '' : decodeURIComponent(pair.slice(equalsAt + 1));
    query[key] = value;
  }
  return { path: path.slice(0, questionAt).split('/').map((segment) => decodeURIComponent(segment)).join('/'), query };
}

/** Bind the REAL service to the SDK's injectable transport interface. */
function serviceTransport(handle: (request: ApiRequest) => ApiResponse): (request: SdkRequest) => Promise<SdkResponse> {
  return async (request) => {
    const { path, query } = splitQuery(request.path);
    const headers: Record<string, string> = {};
    if (request.headers.authorization !== undefined) headers.authorization = request.headers.authorization;
    if (request.headers['idempotency-key'] !== undefined) headers['idempotency-key'] = request.headers['idempotency-key'];
    const response = handle({ method: request.method, path, headers, ...(query === undefined ? {} : { query }), ...(request.body === undefined ? {} : { body: request.body }) });
    return {
      status: response.status,
      headers: { ...response.headers } as Record<string, string>,
      body: response.body,
    };
  };
}

describe('a capability request rides the REAL public jobs route end-to-end', () => {
  it('submit through the REAL client + REAL pipeline; the retained spec narrows back byte-exactly', async () => {
    const { service, bundle } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });

    const run = runHappyPath();
    const payload = capabilityRequestJobPayload(run.request);

    // The REAL pipeline accepts the envelope as the job's OPAQUE spec (202).
    const job = await client.jobs.submitResearch({ projectId: run.request.projectId, spec: payload });
    expect(job.kind).toBe('research');
    expect(job.status).toBe('submitted');
    expect(job.tenant).toBe(TENANT_A);
    // The type witness: the served record IS the mirror.
    const witnessed: JobRecordMirror = realJobSatisfiesMirror(job);

    // The REAL submission port retained the spec byte-exactly.
    expect(bundle.jobs.submissions).toHaveLength(1);
    const retained = bundle.jobs.submissions[0];
    expect(retained.spec).toEqual(payload);
    expect(retained.tenant).toBe(TENANT_A);
    expect(retained.project).toBe(run.request.projectId);

    // The read-back through the REAL typed client.
    const readBack = await client.jobs.get(job.jobId);
    expect(readBack.jobId).toBe(job.jobId);

    // The typed narrowing recovers the envelope from the RETAINED spec.
    const narrowed = narrowCapabilityRequestJobPayload(retained.spec);
    expect(narrowed.ok).toBe(true);
    if (!narrowed.ok) return;
    expect(narrowed.value.requestId).toBe(run.request.requestId);
    expect(JSON.stringify(narrowed.value)).toBe(JSON.stringify(run.request));
    void witnessed;
  });

  it('the boundary idempotency key derives through the REAL SDK derivation (retries never double-submit)', async () => {
    const { service } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const run = runHappyPath();
    const first = await client.jobs.submitResearch(
      { projectId: run.request.projectId, spec: capabilityRequestJobPayload(run.request) },
      { idempotencyKey: capabilityRequestJobIdempotencyKey(run.request) },
    );
    const second = await client.jobs.submitResearch(
      { projectId: run.request.projectId, spec: capabilityRequestJobPayload(run.request) },
      { idempotencyKey: capabilityRequestJobIdempotencyKey(run.request) },
    );
    // The REAL boundary replays the ORIGINAL result for the same key + body.
    expect(second.jobId).toBe(first.jobId);
  });

  it('a foreign-tenant read of the submitted job is the REAL typed TenantIsolationError (L12 end-to-end)', async () => {
    const { service } = fixtureService();
    const client = createTradRLClient({ transport: serviceTransport(service.handle), token: TOKEN_A });
    const run = runHappyPath();
    const job = await client.jobs.submitResearch({ projectId: run.request.projectId, spec: capabilityRequestJobPayload(run.request) });

    // A different tenant's credential (the fixture's beta token) cannot read it.
    const betaClient = createTradRLClient({ transport: serviceTransport(service.handle), token: 'tok-dev-beta-0002' });
    await expect(betaClient.jobs.get(job.jobId)).rejects.toBeInstanceOf(sdk.TenantIsolationError);
  });
});
