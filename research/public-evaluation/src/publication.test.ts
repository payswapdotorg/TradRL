/**
 * T049 — the PUBLICATION LAYER's laws (research/public-evaluation): the
 * published record (content-addressed, provenance-carrying, point-in-time,
 * tenant-scoped), the publication gate (the never-publish scans + the
 * projection law), the compiler, the append-only chain-verified publication
 * log, and the deterministic re-verification (the byte law).
 */

import { describe, expect, it } from 'vitest';

import {
  CHAIN_OF_THOUGHT_ATTACHMENT,
  CHAIN_OF_THOUGHT_KEYS,
  DAY,
  PUBLISHED_AT,
  TENANT,
  PROJECT,
  TENANT_DATA_ATTACHMENT,
  TENANT_DATA_KEYS,
  canonicalPublication,
  checkPolicyAxes,
  compilePublishedRecord,
  createPublicationLog,
  fixtureHoldoutMeasurement,
  fixtureMeasurement,
  fixtureMinimalPolicy,
  fixturePolicy,
  isPublishedClaimShape,
  neverPublishPaths,
  projectClaims,
  publicationClaimKey,
  publicationLogId,
  publishedRecordId,
  publishRecord,
  reverifyPublishedRecord,
  scanNeverPublish,
  stableDigest,
  verifyPublicationLog,
  verifyPublishedRecord,
  type PublishedEvaluationRecord,
  type PublicationLog,
  type PublicationPolicy,
} from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function thaw<T>(value: T): T {
  return structuredClone(value);
}

function firstError(result: { ok: false; errors: readonly { readonly code: string; readonly message?: string }[] }): string {
  return result.errors[0]?.code ?? '';
}

function compiledFixture(): PublishedEvaluationRecord {
  const result = compilePublishedRecord({ measurement: fixtureMeasurement(), policy: fixturePolicy(), publishedAt: PUBLISHED_AT });
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result.value;
}

function compiledMinimal(): PublishedEvaluationRecord {
  const result = compilePublishedRecord({ measurement: fixtureMeasurement(), policy: fixtureMinimalPolicy(), publishedAt: PUBLISHED_AT });
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result.value;
}

// ---------------------------------------------------------------------------
// The published record (the public evidence format)
// ---------------------------------------------------------------------------

describe('T049 publication — the published record', () => {
  it('compiles: content-addressed (pev:), provenance-carrying, point-in-time, tenant-scoped', () => {
    const record = compiledFixture();
    expect(record.record_id).toMatch(/^pev:[0-9a-f]{16}$/);
    expect(record.suite.name).toBe('reference-slice-platform-v1');
    expect(record.suite.evidence_class).toBe('simulation');
    expect(record.as_of).toBe(fixtureMeasurement().recorded_at); // BOUND to the evidence instant
    expect(record.published_at).toBe(PUBLISHED_AT);
    expect(record.tenant).toBe(TENANT);
    expect(record.project).toBe(PROJECT);
    expect(record.provenance.measurement_id).toBe(fixtureMeasurement().measurement_id);
    expect(record.provenance.material.source_id).toMatch(/^rsrc:/);
    expect(record.claim.axes).toHaveLength(20); // the full policy: every axis public
    expect(record.claim.attained).toBe(true);
    expect(record.verification.expected_measurement_id).toBe(record.provenance.measurement_id);
    expect(record.verification.measured_at).toBe(record.as_of);
  });

  it('verifies through the content-address law and round-trips its id', () => {
    const record = compiledFixture();
    const verified = verifyPublishedRecord(record);
    expect(verified.ok).toBe(true);
    const { record_id: drop, ...content } = record;
    void drop;
    expect(publishedRecordId(content)).toBe(record.record_id);
    expect(canonicalPublication(record).length).toBeGreaterThan(0);
  });

  it('refuses any mutated field (publication_mismatch — L9)', () => {
    const record = compiledFixture();
    const tampered = thaw(record);
    (tampered as { claim: { attained: boolean } }).claim.attained = false;
    const verified = verifyPublishedRecord(tampered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(firstError(verified)).toBe('publication_mismatch');
  });

  it('refuses a future-dated publication (future_dated — L4)', () => {
    const result = compilePublishedRecord({ measurement: fixtureMeasurement(), policy: fixturePolicy(), publishedAt: PUBLISHED_AT - DAY });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(firstError(result)).toBe('future_dated');
      expect(result.errors[0]?.message).toContain('publish today what was measured tomorrow');
    }
  });

  it('refuses an as-of that is not the cited measurement\'s evidence instant (as_of_mismatch — L4)', () => {
    const record = thaw(compiledFixture()) as unknown as Record<string, unknown>;
    record.as_of = (record.as_of as number) + 1;
    // Re-mint the id over the tampered content so ONLY the binding law can catch it.
    const { record_id: drop, ...content } = record as never as PublishedEvaluationRecord;
    void drop;
    record.record_id = publishedRecordId(content);
    const verified = verifyPublishedRecord(record);
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(firstError(verified)).toBe('as_of_mismatch');
      expect(verified.errors[0]?.message).toContain('point-in-time claim');
    }
  });

  it('enforces the claim block\'s structural law (axis-unique, closed kinds, primitive values)', () => {
    expect(isPublishedClaimShape(compiledFixture().claim)).toBe(true);
    expect(isPublishedClaimShape({ axes: [], attained: true })).toBe(false);
    expect(isPublishedClaimShape({ axes: [{ axis: 'a', kind: 'count', value: 1, attained: true }, { axis: 'a', kind: 'count', value: 2, attained: true }], attained: true })).toBe(false);
    expect(isPublishedClaimShape({ axes: [{ axis: 'a', kind: 'mood', value: 1, attained: true }], attained: true })).toBe(false);
    expect(isPublishedClaimShape({ axes: [{ axis: 'a', kind: 'count', value: Number.NaN, attained: true }], attained: true })).toBe(false);
    expect(isPublishedClaimShape({ axes: [{ axis: 'a', kind: 'flag', value: true, attained: 'yes' }], attained: true })).toBe(false);
    expect(isPublishedClaimShape({ axes: [{ axis: 'a', kind: 'count', value: 1, attained: null }], attained: true })).toBe(true);
  });

  it('derives the claim key from (suite name, subject artifact, as-of) — the L11 immutability key', () => {
    const record = compiledFixture();
    expect(publicationClaimKey(record)).toBe(`reference-slice-platform-v1:${record.subject.artifacts[0]?.digest}:${record.as_of}`);
    const other = compiledMinimal(); // same measurement, different policy: SAME claim key
    expect(publicationClaimKey(other)).toBe(publicationClaimKey(record));
  });
});

// ---------------------------------------------------------------------------
// The publication gate (what gets published, what NEVER does)
// ---------------------------------------------------------------------------

describe('T049 publication — the gate (the never-publish laws)', () => {
  it('carries the closed, versioned vocabularies as data', () => {
    expect(CHAIN_OF_THOUGHT_KEYS).toContain('reasoning');
    expect(CHAIN_OF_THOUGHT_KEYS).toContain('chainOfThought');
    expect(CHAIN_OF_THOUGHT_KEYS).toContain('prompt');
    expect(TENANT_DATA_KEYS).toContain('trajectory');
    expect(TENANT_DATA_KEYS).toContain('positions');
    expect(TENANT_DATA_KEYS).toContain('credentials');
    expect(TENANT_DATA_KEYS).toContain('apiKey');
  });

  it('walks nested attachments and names the dotted banned path', () => {
    const paths = neverPublishPaths(CHAIN_OF_THOUGHT_ATTACHMENT);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.path).toBe('context.reasoning');
    expect(paths[0]?.banned).toBe('chain_of_thought');

    const tenantPaths = neverPublishPaths(TENANT_DATA_ATTACHMENT);
    expect(tenantPaths.map((found) => found.path)).toEqual(['context.orders', 'context.positions']);
    expect(tenantPaths.every((found) => found.banned === 'tenant_data')).toBe(true);
  });

  it('scans arrays and deep nesting (the scan is total over JSON)', () => {
    const nested = { level1: [{ level2: { scratchpad: 'private deliberation' } }], fine: { value: 1 } };
    const paths = neverPublishPaths(nested);
    expect(paths.map((found) => found.path)).toEqual(['level1[0].level2.scratchpad']);
    const scan = scanNeverPublish(nested, 'the attachment');
    expect(scan.ok).toBe(false);
    if (!scan.ok) expect(firstError(scan)).toBe('chain_of_thought');
  });

  it('passes clean attachments', () => {
    expect(scanNeverPublish({ context: { summary: 'the measured evidence speaks for itself' } }, 'the attachment').ok).toBe(true);
  });

  it('projects ONLY the policy-allowed axes (claims are derived, never supplied)', () => {
    const measurement = fixtureMeasurement();
    const minimal = projectClaims(measurement, fixtureMinimalPolicy());
    expect(minimal.map((claim) => claim.axis)).toEqual(['crypto-events', 'routed', 'refusals', 'audit-coherent']);
    const full = projectClaims(measurement, fixturePolicy());
    expect(full).toHaveLength(20);
    // The projection never editorializes: values + judgments ride verbatim.
    const routed = minimal.find((claim) => claim.axis === 'routed');
    expect(routed?.value).toBe(measurement.axes.find((axis) => axis.axis === 'routed')?.value);
    expect(routed?.attained).toBe(measurement.axes.find((axis) => axis.axis === 'routed')?.attained);
  });

  it('refuses a policy allowing axes the measurement never recorded (unpublishable_class)', () => {
    const policy: PublicationPolicy = { publicAxes: ['crypto-events', 'axis-never-measured'] };
    const check = checkPolicyAxes(fixtureMeasurement(), policy);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(firstError(check)).toBe('unpublishable_class');
      expect(check.errors[0]?.message).toContain('axis-never-measured');
    }
  });
});

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

describe('T049 publication — compilePublishedRecord', () => {
  it('refuses a measurement that fails its content-address gate (measurement_mismatch)', () => {
    const tampered = thaw(fixtureMeasurement()) as unknown as Record<string, unknown>;
    tampered.attained = false;
    const result = compilePublishedRecord({ measurement: tampered, policy: fixturePolicy(), publishedAt: PUBLISHED_AT });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('measurement_mismatch');
  });

  it('refuses chain-of-thought attachments (chain_of_thought — NEVER published)', () => {
    const result = compilePublishedRecord({
      measurement: fixtureMeasurement(),
      policy: { ...fixturePolicy(), attachments: CHAIN_OF_THOUGHT_ATTACHMENT },
      publishedAt: PUBLISHED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(firstError(result)).toBe('chain_of_thought');
      expect(result.errors[0]?.message).toContain('NEVER published');
    }
  });

  it('refuses tenant-data attachments (tenant_data — NEVER published)', () => {
    const result = compilePublishedRecord({
      measurement: fixtureMeasurement(),
      policy: { ...fixturePolicy(), attachments: TENANT_DATA_ATTACHMENT },
      publishedAt: PUBLISHED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(firstError(result)).toBe('tenant_data');
      expect(result.errors[0]?.message).toContain('content addresses only');
    }
  });

  it('refuses a policy naming unmeasured axes at compile time (unpublishable_class)', () => {
    const result = compilePublishedRecord({
      measurement: fixtureMeasurement(),
      policy: { publicAxes: ['not-a-measured-axis'] },
      publishedAt: PUBLISHED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('unpublishable_class');
  });

  it('rejects a malformed policy shape (invalid_field)', () => {
    const result = compilePublishedRecord({ measurement: fixtureMeasurement(), policy: { publicAxes: [] }, publishedAt: PUBLISHED_AT });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result)).toBe('invalid_field');
  });

  it('compiles the holdout measurement with its search binding riding the provenance', () => {
    const result = compilePublishedRecord({ measurement: fixtureHoldoutMeasurement(), policy: fixtureMinimalPolicy(), publishedAt: PUBLISHED_AT });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
    expect(result.value.phase).toBe('holdout');
    expect(result.value.provenance.search?.trial).toBe('trial-fixture-holdout-0001');
    expect(result.value.verification.search_record_id).toMatch(/^srch:/);
  });
});

// ---------------------------------------------------------------------------
// The publication log (append-only, chain-verified, claim-key immutable)
// ---------------------------------------------------------------------------

describe('T049 publication — the publication log', () => {
  it('opens with the derived identity and verifies empty', () => {
    const open = createPublicationLog({ tenant: TENANT, project: PROJECT });
    expect(open.ok).toBe(true);
    if (!open.ok) throw new Error('unreachable');
    expect(open.value.log_id).toBe(publicationLogId({ tenant: TENANT, project: PROJECT }));
    expect(open.value.log_id).toMatch(/^pevl:[0-9a-f]{16}$/);
    expect(verifyPublicationLog(open.value).ok).toBe(true);
  });

  it('appends the compiled record and verifies end-to-end', () => {
    const open = createPublicationLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const append = publishRecord(open.value, { record: compiledFixture() });
    expect(append.ok).toBe(true);
    if (!append.ok) throw new Error(append.errors.map((error) => error.message).join('; '));
    expect(append.value.replayed).toBe(false);
    expect(append.value.log.entries).toHaveLength(1);
    expect(append.value.log.entries[0]?.record_digest).toMatch(/^[0-9a-f]{16}$/);
    expect(verifyPublicationLog(append.value.log).ok).toBe(true);
  });

  it('replays identical bytes idempotently (replayed: true; the log is untouched)', () => {
    const open = createPublicationLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const once = publishRecord(open.value, { record: compiledFixture() });
    if (!once.ok) throw new Error('unreachable');
    const twice = publishRecord(once.value.log, { record: compiledFixture() });
    expect(twice.ok).toBe(true);
    if (!twice.ok) throw new Error('unreachable');
    expect(twice.value.replayed).toBe(true);
    expect(twice.value.log).toBe(once.value.log); // untouched — the same reference
  });

  it('refuses DIFFERENT bytes for the same point-in-time claim key (duplicate_publication — L11)', () => {
    // Same measurement + same instant, DIFFERENT policy -> different bytes,
    // same claim key (suite name, subject artifact, as-of).
    const open = createPublicationLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const once = publishRecord(open.value, { record: compiledFixture() });
    if (!once.ok) throw new Error('unreachable');
    const divergent = publishRecord(once.value.log, { record: compiledMinimal() });
    expect(divergent.ok).toBe(false);
    if (!divergent.ok) {
      expect(firstError(divergent)).toBe('duplicate_publication');
      expect(divergent.errors[0]?.message).toContain('immutable');
    }
  });

  it('accepts a corrected claim at a NEW as-of instant (the L4-honest correction path)', () => {
    const open = createPublicationLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const once = publishRecord(open.value, { record: compiledFixture() });
    if (!once.ok) throw new Error('unreachable');
    // A different measurement instant -> a different subject digest is needed for a real second claim;
    // the holdout fixture measures at a different instant but the same subject digest pin.
    const holdoutPublication = compilePublishedRecord({
      measurement: fixtureHoldoutMeasurement(),
      policy: fixtureMinimalPolicy(),
      publishedAt: PUBLISHED_AT + 1_000,
    });
    if (!holdoutPublication.ok) throw new Error('unreachable');
    const again = publishRecord(once.value.log, { record: holdoutPublication.value });
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error('unreachable');
    expect(again.value.log.entries).toHaveLength(2);
    expect(verifyPublicationLog(again.value.log).ok).toBe(true);
  });

  it('refuses a foreign-tenant record (tenant_mismatch — L12)', () => {
    const open = createPublicationLog({ tenant: 'tenant-somebody-else' as never, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const append = publishRecord(open.value, { record: compiledFixture() });
    expect(append.ok).toBe(false);
    if (!append.ok) expect(firstError(append)).toBe('tenant_mismatch');
  });

  it('detects a MUTATED record in the stored log (publication_mismatch)', () => {
    const open = createPublicationLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const grown = publishRecord(open.value, { record: compiledFixture() });
    if (!grown.ok) throw new Error('unreachable');
    const tampered = thaw(grown.value.log) as unknown as PublicationLog;
    (tampered.entries[0]!.record as unknown as { claim: { attained: boolean } }).claim.attained = false;
    const verified = verifyPublicationLog(tampered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(firstError(verified)).toBe('publication_mismatch');
  });

  it('detects a MUTATED stored record_digest (chain_mismatch — the stored digest is protected)', () => {
    const open = createPublicationLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const grown = publishRecord(open.value, { record: compiledFixture() });
    if (!grown.ok) throw new Error('unreachable');
    const tampered = thaw(grown.value.log) as unknown as PublicationLog;
    const mutableEntries = tampered.entries as unknown as { record: unknown; record_digest: string }[];
    mutableEntries[0] = { ...mutableEntries[0]!, record_digest: '0000000000000000' };
    const verified = verifyPublicationLog(tampered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(firstError(verified)).toBe('chain_mismatch');
      expect(verified.errors[0]?.message).toContain('stored digest was mutated');
    }
  });

  it('detects a MEMORY-HOLED publication (chain_mismatch)', () => {
    const open = createPublicationLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const first = publishRecord(open.value, { record: compiledFixture() });
    if (!first.ok) throw new Error('unreachable');
    const holdoutPublication = compilePublishedRecord({ measurement: fixtureHoldoutMeasurement(), policy: fixtureMinimalPolicy(), publishedAt: PUBLISHED_AT + 1_000 });
    if (!holdoutPublication.ok) throw new Error(holdoutPublication.errors.map((error) => error.message).join('; '));
    const second = publishRecord(first.value.log, { record: holdoutPublication.value });
    if (!second.ok) throw new Error('unreachable');
    const holed = { ...second.value.log, entries: second.value.log.entries.slice(0, 1) };
    const verified = verifyPublicationLog(holed);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(firstError(verified)).toBe('chain_mismatch');
  });

  it('folds the chain over the record digests (the fold binds the full canonical bytes)', () => {
    const open = createPublicationLog({ tenant: TENANT, project: PROJECT });
    if (!open.ok) throw new Error('unreachable');
    const grown = publishRecord(open.value, { record: compiledFixture() });
    if (!grown.ok) throw new Error('unreachable');
    const entry = grown.value.log.entries[0]!;
    expect(entry.record_digest).toBe(stableDigest(canonicalPublication(entry.record)));
  });
});

// ---------------------------------------------------------------------------
// The deterministic re-verification (the byte law)
// ---------------------------------------------------------------------------

describe('T049 publication — reverifyPublishedRecord (a published result is re-runnable to the same bytes)', () => {
  it('re-runs the machinery over the retained sources and reproduces the published bytes exactly', () => {
    const record = compiledFixture();
    const outcome = reverifyPublishedRecord(record, {
      suite: fixtureSuiteOf(record),
      evidence: fixtureEvidenceOf(),
      material: fixtureMaterialOf(),
      plan: fixturePlanOf(record),
      search: null,
      policy: fixturePolicy(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.errors.map((error) => error.message).join('; '));
    expect(outcome.value.remeasurement.measurement_id).toBe(record.verification.expected_measurement_id);
    expect(outcome.value.bytes.length).toBeGreaterThan(0);
    expect(stableDigest(outcome.value.bytes)).toBe(record.verification.expected_measurement_digest);
    expect(outcome.value.publication.record_id).toBe(record.record_id);
  });

  it('refuses a missing source (source_missing — the re-verifier never invents inputs)', () => {
    const record = compiledFixture();
    const noSuite = reverifyPublishedRecord(record, { evidence: fixtureEvidenceOf(), material: fixtureMaterialOf(), policy: fixturePolicy() });
    expect(noSuite.ok).toBe(false);
    if (!noSuite.ok) expect(firstError(noSuite)).toBe('source_missing');

    const noEvidence = reverifyPublishedRecord(record, { suite: fixtureSuiteOf(record), material: fixtureMaterialOf(), policy: fixturePolicy() });
    expect(noEvidence.ok).toBe(false);
    if (!noEvidence.ok) expect(firstError(noEvidence)).toBe('source_missing');

    const noMaterial = reverifyPublishedRecord(record, { suite: fixtureSuiteOf(record), evidence: fixtureEvidenceOf(), policy: fixturePolicy() });
    expect(noMaterial.ok).toBe(false);
    if (!noMaterial.ok) expect(firstError(noMaterial)).toBe('source_missing');

    const noPolicy = reverifyPublishedRecord(record, { suite: fixtureSuiteOf(record), evidence: fixtureEvidenceOf(), material: fixtureMaterialOf() });
    expect(noPolicy.ok).toBe(false);
    if (!noPolicy.ok) expect(firstError(noPolicy)).toBe('source_missing');
  });

  it('refuses a supplied suite that is not the recipe\'s pinned runner (digest_mismatch)', () => {
    const record = compiledFixture();
    const wrongSuite = { ...fixtureSuiteOf(record), name: 'reference-slice-platform-v2' };
    const outcome = reverifyPublishedRecord(record, { suite: wrongSuite, evidence: fixtureEvidenceOf(), material: fixtureMaterialOf(), policy: fixturePolicy() });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(firstError(outcome)).toBe('digest_mismatch');
  });

  it('refuses a supplied material that is not the recipe\'s pinned source (digest_mismatch)', () => {
    const record = compiledFixture();
    const foreignMaterial = { ...fixtureMaterialOf(), source_id: 'rsrc:0000000000000000' };
    const outcome = reverifyPublishedRecord(record, { suite: fixtureSuiteOf(record), evidence: fixtureEvidenceOf(), material: foreignMaterial, policy: fixturePolicy() });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(firstError(outcome)).toBe('digest_mismatch');
  });

  it('refuses when the re-run diverges from the published bytes (reverify_failed)', () => {
    const record = compiledFixture();
    const tamperedEvidence = thaw(fixtureEvidenceOf()) as unknown as Record<string, unknown>;
    const gateway = tamperedEvidence.gateway as Record<string, unknown>;
    gateway.routed = (gateway.routed as number) + 1; // different evidence -> different measurement
    const outcome = reverifyPublishedRecord(record, {
      suite: fixtureSuiteOf(record),
      evidence: tamperedEvidence,
      material: fixtureMaterialOf(),
      plan: fixturePlanOf(record),
      policy: fixturePolicy(),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(firstError(outcome)).toBe('reverify_failed');
      expect(outcome.errors[0]?.message).toContain('the subject pins'); // the subject pin catches the forged evidence first
    }
  });

  it('refuses a published claim that no longer follows from its own recipe (claim_unverified)', () => {
    const record = thaw(compiledFixture()) as unknown as Record<string, unknown>;
    const claim = record.claim as { axes: { axis: string; value: string | number | boolean }[] };
    claim.axes = claim.axes.map((axis) => (axis.axis === 'routed' ? { ...axis, value: (axis.value as number) + 1 } : axis));
    const { record_id: drop, ...content } = record as never as PublishedEvaluationRecord;
    void drop;
    record.record_id = publishedRecordId(content); // re-mint so only the CLAIM law can catch it
    const outcome = reverifyPublishedRecord(record as never, {
      suite: fixtureSuiteOf(record as never as PublishedEvaluationRecord),
      evidence: fixtureEvidenceOf(),
      material: fixtureMaterialOf(),
      plan: fixturePlanOf(record as never as PublishedEvaluationRecord),
      policy: fixturePolicy(),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(firstError(outcome)).toBe('claim_unverified');
      expect(outcome.errors[0]?.message).toContain('no longer follows');
    }
  });

  it('re-verifies the HOLDOUT publication end-to-end (plan + search sources ride the recipe)', () => {
    const compiled = compilePublishedRecord({ measurement: fixtureHoldoutMeasurement(), policy: fixtureMinimalPolicy(), publishedAt: PUBLISHED_AT + 1_000 });
    if (!compiled.ok) throw new Error(compiled.errors.map((error) => error.message).join('; '));
    const outcome = reverifyPublishedRecord(compiled.value, {
      suite: holdoutSuiteOf(),
      evidence: holdoutEvidenceOf(),
      material: holdoutMaterialOf(),
      plan: holdoutPlanOf(),
      search: holdoutSearchOf(),
      policy: fixtureMinimalPolicy(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.errors.map((error) => error.message).join('; '));
    expect(outcome.value.remeasurement.phase).toBe('holdout');
  });
});

// ---------------------------------------------------------------------------
// Re-verification source fixtures (the retained inputs of the compiled fixtures)
// ---------------------------------------------------------------------------

import {
  fixtureHoldoutReplaySource,
  fixturePlatformSuiteRecord,
  fixtureReplaySource,
  fixtureSearchRecord,
  fixtureSliceReport,
  fixtureSplitPlan,
} from './fixtures';

function fixtureSuiteOf(record: PublishedEvaluationRecord): ReturnType<typeof fixturePlatformSuiteRecord> {
  void record;
  return fixturePlatformSuiteRecord();
}

function fixtureEvidenceOf(): ReturnType<typeof fixtureSliceReport> {
  return fixtureSliceReport();
}

function fixtureMaterialOf(): ReturnType<typeof fixtureReplaySource> {
  return fixtureReplaySource();
}

function fixturePlanOf(record: PublishedEvaluationRecord): ReturnType<typeof fixtureSplitPlan> | null {
  return record.verification.plan_id === null ? null : fixtureSplitPlan();
}

function holdoutSuiteOf(): ReturnType<typeof fixturePlatformSuiteRecord> {
  return fixturePlatformSuiteRecord();
}

function holdoutEvidenceOf(): ReturnType<typeof fixtureSliceReport> {
  return fixtureSliceReport();
}

function holdoutMaterialOf(): ReturnType<typeof fixtureHoldoutReplaySource> {
  return fixtureHoldoutReplaySource();
}

function holdoutPlanOf(): ReturnType<typeof fixtureSplitPlan> {
  return fixtureSplitPlan();
}

function holdoutSearchOf(): ReturnType<typeof fixtureSearchRecord> {
  return fixtureSearchRecord();
}
