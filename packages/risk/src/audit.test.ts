/**
 * @tradrl/risk — the RiskAuditTrail tests: the append-only trail of
 * every evaluation, the one-evaluation-one-record law, the chain
 * verification trip wires and the resume path.
 */

import { describe, expect, it } from 'vitest';

import { appendEvaluation, appendAuditRecord, riskAuditRecordOf, startRiskAuditTrail, validateRiskAuditTrail, verifyRiskAuditTrail } from './audit';
import { evaluateLimits } from './limits';
import { computeExposure } from './exposure';
import { deriveMarketState } from './market-mirror';
import { canonicalJson, isDeeplyFrozen } from './primitives';
import { PROJECT, SEED, T0, TENANT, fixtureFill, fixtureMarketEvents, fixturePolicy, fixturePortfolio, fixtureStandingSwitch, unwrap } from './test-fixtures';

/** The golden evaluation. */
function goldenEvaluation() {
  const market = unwrap(deriveMarketState(fixtureMarketEvents(), T0 as never, 8));
  const exposure = unwrap(computeExposure({ portfolio: fixturePortfolio(), marketState: market, fills: [fixtureFill()], priorPeakEquity: null, seed: SEED }));
  return unwrap(evaluateLimits({ exposure, policy: fixturePolicy(), killSwitch: fixtureStandingSwitch() }));
}

/** A second, distinct evaluation (a drifted fill). */
function secondEvaluation() {
  const market = unwrap(deriveMarketState(fixtureMarketEvents(), T0 as never, 8));
  const exposure = unwrap(computeExposure({ portfolio: fixturePortfolio(), marketState: market, fills: [fixtureFill({ quantity: '0.21' })], priorPeakEquity: null, seed: SEED }));
  return unwrap(evaluateLimits({ exposure, policy: fixturePolicy(), killSwitch: fixtureStandingSwitch() }));
}

describe('startRiskAuditTrail / appendEvaluation — the audit law', () => {
  it('starts empty for the scope and appends one record per evaluation', () => {
    const trail = unwrap(startRiskAuditTrail(TENANT as never, PROJECT as never));
    expect(trail.records).toHaveLength(0);
    const audited = unwrap(appendEvaluation(trail, goldenEvaluation()));
    expect(audited.records).toHaveLength(1);
    const record = audited.records[0];
    expect(record?.sequence).toBe(1);
    expect(record?.evaluationRef).toBe(goldenEvaluation().evaluationId);
    expect(record?.policy.policyId).toBe(fixturePolicy().policyId);
    expect(record?.withinCount).toBe(10); // 2 order + 4 position + 2 concentration + 1 drawdown + 1 leverage
    expect(record?.breachingCount).toBe(0);
    expect(record?.blockedCount).toBe(0);
    expect(record?.breaches).toEqual([]);
    expect(record?.auditId.startsWith('xra:')).toBe(true);
    expect(record?.tenant).toBe(TENANT);
    expect(record?.project).toBe(PROJECT);
    expect(verifyRiskAuditTrail(audited).ok).toBe(true);
    expect(isDeeplyFrozen(audited)).toBe(true);
    // The original trail is untouched (append-only: a NEW trail).
    expect(trail.records).toHaveLength(0);
  });

  it('the breaches ride the record with the exact evidence (which limit, bound, observed, excess)', () => {
    const market = unwrap(deriveMarketState(fixtureMarketEvents(), T0 as never, 8));
    const exposure = unwrap(computeExposure({ portfolio: fixturePortfolio(), marketState: market, fills: [fixtureFill({ quantity: '2.5', aggressor_price: '50000.00', taker_fee: '0' })], priorPeakEquity: null, seed: SEED }));
    const evaluation = unwrap(evaluateLimits({ exposure, policy: fixturePolicy(), killSwitch: fixtureStandingSwitch() }));
    const trail = unwrap(appendEvaluation(unwrap(startRiskAuditTrail(TENANT as never, PROJECT as never)), evaluation));
    const breaches = trail.records[0]?.breaches ?? [];
    expect(breaches).toContainEqual({ kind: 'order_size', venue: 'REFSIM', instrument: 'BTC-USD', instrumentClass: 'crypto', bound: '2', observed: '2.5', excess: '0.5' });
    expect(trail.records[0]?.breachingCount).toBe(breaches.length);
  });

  it('a duplicate evaluation fails with risk_audit_rewrite (one evaluation, one record)', () => {
    const trail = unwrap(appendEvaluation(unwrap(startRiskAuditTrail(TENANT as never, PROJECT as never)), goldenEvaluation()));
    const result = appendEvaluation(trail, goldenEvaluation());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('risk_audit_rewrite');
  });

  it('an evaluation from another scope fails (L12 — trails are tenant-isolated)', () => {
    const market = unwrap(deriveMarketState(fixtureMarketEvents(), T0 as never, 8));
    const foreignPortfolio = fixturePortfolio({
      lineage: {
        strategy: { specId: 'spec-fixture', version: 1 },
        goal: { goalId: 'goal-fixture', version: 1 },
        constraintSet: { id: 'cs-risk-fixture', version: 1 },
        windowId: 'win-fixture-1',
        seed: SEED,
        tenant: 'tenant-beta',
        project: PROJECT,
      },
    });
    const exposure = unwrap(computeExposure({ portfolio: foreignPortfolio, marketState: market, fills: [], priorPeakEquity: null, seed: SEED }));
    const evaluation = unwrap(evaluateLimits({ exposure, policy: { ...fixturePolicy(), tenant: 'tenant-beta' as never } as never, killSwitch: fixtureStandingSwitch() }));
    const trail = unwrap(startRiskAuditTrail(TENANT as never, PROJECT as never));
    const result = appendEvaluation(trail, evaluation);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('tenant_missing');
  });
});

describe('the audit chain — determinism and the trip wires', () => {
  it('the same appends fold the same chain (L9 determinism)', () => {
    const run = () => {
      let trail = unwrap(startRiskAuditTrail(TENANT as never, PROJECT as never));
      trail = unwrap(appendEvaluation(trail, goldenEvaluation()));
      trail = unwrap(appendEvaluation(trail, secondEvaluation()));
      return trail;
    };
    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(canonicalJson({ records: first.records.map((record) => record.auditId) })).toBe(
      canonicalJson({ records: second.records.map((record) => record.auditId) }),
    );
  });

  it('a spliced trail fails chain verification', () => {
    let trail = unwrap(startRiskAuditTrail(TENANT as never, PROJECT as never));
    trail = unwrap(appendEvaluation(trail, goldenEvaluation()));
    trail = unwrap(appendEvaluation(trail, secondEvaluation()));
    const spliced = { ...trail, records: [trail.records[1] as never] };
    const result = verifyRiskAuditTrail(spliced);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('risk_audit_rewrite');
  });

  it('an edited record fails chain verification (the chain head no longer folds)', () => {
    let trail = unwrap(startRiskAuditTrail(TENANT as never, PROJECT as never));
    trail = unwrap(appendEvaluation(trail, goldenEvaluation()));
    const edited = { ...trail, records: [{ ...(trail.records[0] as unknown as Record<string, unknown>), breachingCount: 42 } as never] };
    const result = verifyRiskAuditTrail(edited);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('risk_audit_rewrite');
  });
});

describe('the resume path (serialize -> parse -> append)', () => {
  it('a serialized trail\'s records re-enter through validation, not through evaluations', () => {
    let trail = unwrap(startRiskAuditTrail(TENANT as never, PROJECT as never));
    trail = unwrap(appendEvaluation(trail, goldenEvaluation()));
    // Serialize (canonical bytes) and parse — the transport round-trip.
    const bytes = canonicalJson(trail as never);
    const parsed: unknown = JSON.parse(bytes);
    const validated = unwrap(validateRiskAuditTrail(parsed));
    expect(validated.records).toHaveLength(1);
    // Resume: append the next evaluation onto the REVALIDATED trail.
    const resumed = unwrap(appendEvaluation(validated, secondEvaluation()));
    expect(resumed.records).toHaveLength(2);
    expect(verifyRiskAuditTrail(resumed).ok).toBe(true);
  });

  it('appendAuditRecord enforces the chain-head derivation (a forged record fails)', () => {
    const trail = unwrap(appendEvaluation(unwrap(startRiskAuditTrail(TENANT as never, PROJECT as never)), goldenEvaluation()));
    const recordResult = riskAuditRecordOf(secondEvaluation(), 2, (trail.records[0] as { chainHead: string }).chainHead);
    expect(recordResult.ok).toBe(true);
    if (!recordResult.ok) return;
    const honest = unwrap(appendAuditRecord(trail, recordResult.value));
    expect(honest.records).toHaveLength(2);
    // The same record appended twice is the rewrite crime (duplicate evaluation).
    const duplicate = appendAuditRecord(honest, recordResult.value);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.errors[0]?.code).toBe('risk_audit_rewrite');
    // A forged sequence is the rewrite crime.
    const forged = { ...recordResult.value, sequence: 7 } as typeof recordResult.value;
    const missequenced = appendAuditRecord(trail, forged);
    expect(missequenced.ok).toBe(false);
    if (!missequenced.ok) expect(missequenced.errors[0]?.code).toBe('risk_audit_rewrite');
  });

  it('a tampered serialized payload fails validation (never trusted on re-entry)', () => {
    let trail = unwrap(startRiskAuditTrail(TENANT as never, PROJECT as never));
    trail = unwrap(appendEvaluation(trail, goldenEvaluation()));
    const bytes = canonicalJson(trail as never);
    const parsed = JSON.parse(bytes) as Record<string, unknown>;
    const records = parsed.records as Record<string, unknown>[];
    (records[0] as Record<string, unknown>).withinCount = 0;
    const result = validateRiskAuditTrail(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('risk_audit_rewrite');
  });
});
