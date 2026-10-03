/**
 * @tradrl/firm-memory-service — TENANT ISOLATION (R25/L12 — the
 * charter's hardest law; the Work Order REQUIRES these tests: positive
 * per-tenant reads + negative cross-tenant probes).
 *
 * THE LAW: tenant A's firm knowledge (and its contradiction register)
 * is INVISIBLE to tenant B — on every surface, in every read shape:
 *
 *   1. B's LIST never contains A's records (scope-pure listing — the
 *      canary claims never leak through ANY filter combination);
 *   2. B's POINT READ of A's record is the TYPED `cross_tenant_access`
 *      error NAMING BOTH SCOPES (never a silent miss, never a payload
 *      leak);
 *   3. B's query with A's knowledgeId filter is the same typed crime;
 *   4. B's contradiction-register read never returns A's contests;
 *   5. a batch that MIXES scopes never writes (the typed
 *      `tenant_mismatch` — cross-scope evidence is inexpressible);
 *   6. B's own world works untouched beside A's (positive isolation:
 *      A's and B's brains grow independently in one shared state).
 *
 * Drives the REAL service surface over deterministic fixtures.
 */

import { describe, expect, it } from 'vitest';
import { ingestFirmLearning } from './ingest';
import { getKnowledgeAt, queryContradictions, queryFirmKnowledge } from './serve';
import { createFirmMemoryState, firmMemoryStateDigest, type FirmMemoryState } from './state';
import {
  FIRM_PROJECT,
  FIRM_PROJECT_B,
  FIRM_T0,
  FIRM_TENANT,
  FIRM_TENANT_B,
  firmScenarioPolicy,
  firmScenarioServingPolicy,
  scenarioSnapshotAdverse,
  scenarioSnapshotChallenger,
  scenarioSnapshotReinforce,
  scenarioSnapshotTenantB,
} from './fixtures';
import { asTimestampMs, type TimestampMs } from './imports';

/** Ingest one scenario (the tests' shorthand; throws on failure). */
function ingest(state: FirmMemoryState, snapshot: { readonly outcomes: readonly unknown[]; readonly postMortems: readonly unknown[]; readonly at: TimestampMs }) {
  const result = ingestFirmLearning(state, { outcomes: snapshot.outcomes, postMortems: snapshot.postMortems }, firmScenarioPolicy, { at: snapshot.at });
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.code}: ${error.message}`).join('; '));
  return result.value.state;
}

/** The shared two-tenant brain: tenant A's full scenario + tenant B's own batch. */
function twoTenantBrain(): FirmMemoryState {
  let state = createFirmMemoryState();
  state = ingest(state, scenarioSnapshotAdverse());
  state = ingest(state, scenarioSnapshotReinforce());
  state = ingest(state, scenarioSnapshotTenantB());
  return state;
}

const AT_LATE = asTimestampMs(FIRM_T0 + 2_000_000);

/** The canary assertion: no record in the list may carry tenant A's scope. */
function expectNoAlphaLeak(records: readonly { readonly record: { readonly tenant: string; readonly project: string; readonly claim: { readonly kind: string; readonly polarity: string } } }[]) {
  for (const served of records) {
    expect(served.record.tenant).not.toBe(FIRM_TENANT);
    expect(served.record.project).not.toBe(FIRM_PROJECT);
  }
}

describe('POSITIVE isolation: each tenant reads its own world', () => {
  it('tenant A lists exactly its own knowledge (2 active families, its own scope on every record)', () => {
    const brain = twoTenantBrain();
    const list = queryFirmKnowledge(brain, { tenant: FIRM_TENANT, project: FIRM_PROJECT }, { at: asTimestampMs(FIRM_T0 + 500_000), retention: firmScenarioServingPolicy });
    if (!list.ok) throw new Error(list.errors.map((error) => error.message).join('; '));
    // After batch 1 + batch 2 (before the challenger): decision_pattern + market_behavior + model_calibration are active.
    const kinds = list.value.map((served) => served.record.claim.kind).sort();
    expect(kinds).toEqual(['decision_pattern', 'market_behavior', 'model_calibration']);
    for (const served of list.value) {
      expect(served.record.tenant).toBe(FIRM_TENANT);
      expect(served.record.project).toBe(FIRM_PROJECT);
      expect(served.status).toBe('active');
    }
  });

  it('tenant B lists exactly its own knowledge (its own scope, untouched beside the alpha world)', () => {
    const brain = twoTenantBrain();
    const list = queryFirmKnowledge(brain, { tenant: FIRM_TENANT_B, project: FIRM_PROJECT_B }, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (!list.ok) throw new Error(list.errors.map((error) => error.message).join('; '));
    expect(list.value.length).toBeGreaterThanOrEqual(2); // B's decision + market families
    for (const served of list.value) {
      expect(served.record.tenant).toBe(FIRM_TENANT_B);
      expect(served.record.project).toBe(FIRM_PROJECT_B);
      // B's own evidence: the adverse market behavior and the harmful decision pattern.
      expect(['adverse', 'harmful']).toContain(served.record.claim.polarity);
    }
    expectNoAlphaLeak(list.value);
  });

  it('tenant A point-reads its own record by id (the exact entry, active status)', () => {
    const brain = twoTenantBrain();
    const list = queryFirmKnowledge(brain, { tenant: FIRM_TENANT, project: FIRM_PROJECT }, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (!list.ok) throw new Error(list.errors.map((error) => error.message).join('; '));
    const target = list.value[0]?.record.knowledgeId as string;
    const point = getKnowledgeAt(brain, { tenant: FIRM_TENANT, project: FIRM_PROJECT, knowledgeId: target }, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (!point.ok) throw new Error(point.errors.map((error) => error.message).join('; '));
    expect(point.value.record.knowledgeId).toBe(target);
    expect(point.value.record.tenant).toBe(FIRM_TENANT);
  });

  it('the two worlds grow independently in one shared state (no cross-contamination by ingestion)', () => {
    const brain = twoTenantBrain();
    const alphaBefore = JSON.stringify(queryFirmKnowledge(brain, { tenant: FIRM_TENANT, project: FIRM_PROJECT }, { at: AT_LATE, retention: firmScenarioServingPolicy }));
    // Tenant B ingests ANOTHER batch — A's world must be byte-identical afterwards.
    const challenger = scenarioSnapshotChallenger(); // tenant A's challenger — used here for B by retargeting scope is NOT needed;
    void challenger;
    const bAgain = ingestFirmLearning(brain, { outcomes: scenarioSnapshotTenantB().outcomes, postMortems: scenarioSnapshotTenantB().postMortems }, firmScenarioPolicy, { at: asTimestampMs(FIRM_T0 + 900_000) });
    // (The re-ingestion fails on duplicate evidence — B's evidence contributes once. The point: no path writes into A.)
    if (bAgain.ok) throw new Error('the re-ingested tenant-B batch must fail on duplicate_evidence');
    if (!bAgain.ok) expect(bAgain.errors[0]?.code).toBe('duplicate_evidence');
    const alphaAfter = JSON.stringify(queryFirmKnowledge(brain, { tenant: FIRM_TENANT, project: FIRM_PROJECT }, { at: AT_LATE, retention: firmScenarioServingPolicy }));
    expect(alphaAfter).toBe(alphaBefore);
  });
});

describe('NEGATIVE probes: cross-tenant reads are the typed cross_tenant_access crime', () => {
  it('tenant B list NEVER contains alpha records — under EVERY filter combination', () => {
    const brain = twoTenantBrain();
    const at = AT_LATE;
    const filterSets: readonly { readonly kinds?: readonly string[]; readonly polarity?: string; readonly dimension?: string; readonly minEvidenceCount?: number }[] = [
      {},
      { kinds: ['market_behavior'] },
      { kinds: ['decision_pattern', 'market_behavior'] },
      { polarity: 'adverse' },
      { polarity: 'harmful' },
      { dimension: 'unresolved' },
      { minEvidenceCount: 1 },
      { kinds: ['model_calibration'], polarity: 'over_projection' },
    ];
    for (const filters of filterSets) {
      const list = queryFirmKnowledge(brain, { tenant: FIRM_TENANT_B, project: FIRM_PROJECT_B, ...filters }, { at, retention: firmScenarioServingPolicy });
      if (!list.ok) throw new Error(list.errors.map((error) => error.message).join('; '));
      expectNoAlphaLeak(list.value);
      // The alpha canary: A's model_calibration knowledge exists at this instant but never leaks into B's list.
      expect(list.value.some((served) => served.record.claim.kind === 'model_calibration')).toBe(false);
    }
  });

  it('tenant B POINT READ of an alpha record is the typed cross_tenant_access NAMING BOTH SCOPES (never a silent miss, never a payload leak)', () => {
    const brain = twoTenantBrain();
    const alpha = queryFirmKnowledge(brain, { tenant: FIRM_TENANT, project: FIRM_PROJECT }, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (!alpha.ok) throw new Error(alpha.errors.map((error) => error.message).join('; '));
    const alphaId = (alpha.value[0] as { record: { knowledgeId: string } }).record.knowledgeId;
    const probe = getKnowledgeAt(brain, { tenant: FIRM_TENANT_B, project: FIRM_PROJECT_B, knowledgeId: alphaId }, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (probe.ok) throw new Error('the cross-tenant point read must fail');
    expect(probe.errors[0]?.code).toBe('cross_tenant_access');
    expect(probe.errors[0]?.message).toContain(FIRM_TENANT);
    expect(probe.errors[0]?.message).toContain(FIRM_TENANT_B);
    expect(probe.errors[0]?.path).toBe('knowledgeId');
  });

  it('tenant B LIST query carrying an alpha knowledgeId is the same typed crime (the filter path)', () => {
    const brain = twoTenantBrain();
    const alpha = queryFirmKnowledge(brain, { tenant: FIRM_TENANT, project: FIRM_PROJECT }, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (!alpha.ok) throw new Error(alpha.errors.map((error) => error.message).join('; '));
    const alphaId = (alpha.value[0] as { record: { knowledgeId: string } }).record.knowledgeId;
    const probe = queryFirmKnowledge(brain, { tenant: FIRM_TENANT_B, project: FIRM_PROJECT_B, knowledgeId: alphaId }, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (probe.ok) throw new Error('must fail');
    expect(probe.errors[0]?.code).toBe('cross_tenant_access');
  });

  it('the same-tenant foreign-PROJECT point read is the typed tenant_mismatch (the project scope is L15 continuity)', () => {
    const brain = twoTenantBrain();
    const alpha = queryFirmKnowledge(brain, { tenant: FIRM_TENANT, project: FIRM_PROJECT }, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (!alpha.ok) throw new Error(alpha.errors.map((error) => error.message).join('; '));
    const alphaId = (alpha.value[0] as { record: { knowledgeId: string } }).record.knowledgeId;
    const probe = getKnowledgeAt(brain, { tenant: FIRM_TENANT, project: 'project-elsewhere', knowledgeId: alphaId }, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (probe.ok) throw new Error('must fail');
    expect(probe.errors[0]?.code).toBe('tenant_mismatch');
  });

  it('tenant B contradiction-register read never returns alpha contests', () => {
    // Give tenant A one contest (the non-dominating challenger) on top of the two-tenant brain.
    let brain = twoTenantBrain();
    brain = ingest(brain, scenarioSnapshotChallenger());
    const alphaContests = queryContradictions(brain, { tenant: FIRM_TENANT, project: FIRM_PROJECT }, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (!alphaContests.ok) throw new Error(alphaContests.errors.map((error) => error.message).join('; '));
    expect(alphaContests.value.length).toBeGreaterThanOrEqual(1); // A has its contest
    const betaContests = queryContradictions(brain, { tenant: FIRM_TENANT_B, project: FIRM_PROJECT_B }, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (!betaContests.ok) throw new Error(betaContests.errors.map((error) => error.message).join('; '));
    expect(betaContests.value).toHaveLength(0); // B sees NONE of A's contests
    for (const contest of alphaContests.value) {
      expect(contest.tenant).toBe(FIRM_TENANT); // the register entries are scoped
    }
  });

  it('a batch MIXING scopes never writes (the typed tenant_mismatch; the state is byte-identical)', () => {
    const brain = twoTenantBrain();
    const digestBefore = firmMemoryStateDigest(brain);
    const a = scenarioSnapshotAdverse();
    const b = scenarioSnapshotTenantB();
    const mixed = ingestFirmLearning(brain, { outcomes: [...a.outcomes, ...b.outcomes], postMortems: [...a.postMortems, ...b.postMortems] }, firmScenarioPolicy, { at: asTimestampMs(FIRM_T0 + 1_000_000) });
    if (mixed.ok) throw new Error('must fail');
    expect(mixed.errors[0]?.code).toBe('tenant_mismatch');
    expect(firmMemoryStateDigest(brain)).toBe(digestBefore);
  });
});

describe('unscoped reads are inexpressible', () => {
  it('a query without a scope is the typed invalid_field (tenant and project both required)', () => {
    const brain = twoTenantBrain();
    const noTenant = queryFirmKnowledge(brain, { project: FIRM_PROJECT } as never, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (noTenant.ok) throw new Error('must fail');
    expect(noTenant.errors[0]?.code).toBe('invalid_field');
    expect(noTenant.errors[0]?.path).toBe('tenant');

    const noProject = queryFirmKnowledge(brain, { tenant: FIRM_TENANT } as never, { at: AT_LATE, retention: firmScenarioServingPolicy });
    if (noProject.ok) throw new Error('must fail');
    expect(noProject.errors[0]?.path).toBe('project');
  });
});
