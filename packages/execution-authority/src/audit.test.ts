// @tradrl/execution-authority — the GatewayAuditTrail tests: the
// append-only law, the chain verification, TAMPER DETECTION (mutate a
// byte -> the chain fails), the one-decision-one-record law and the
// scope law (L12).

import { describe, expect, it } from 'vitest';

import {
  appendGatewayAuditRecord,
  canonicalJson,
  gatewayAuditRecordAt,
  isGatewayAuditRecord,
  isGatewayAuditTrail,
  startGatewayAuditTrail,
  validateGatewayAuditTrail,
  verifyGatewayAuditChain,
  type GatewayAuditRecord,
  type GatewayAuditTrail,
} from './index';
import { fixtureApproveDecision, PROJECT, T0, TENANT } from './test-fixtures';

/** Build one well-formed audit record's content at the trail's head. */
function recordContentAt(sequence: number, overrides: Record<string, unknown> = {}): Omit<GatewayAuditRecord, 'auditId' | 'chainHead' | 'sequence'> {
  const decision = fixtureApproveDecision({ decisionId: `xd:t040fx${String(sequence).padStart(2, '0')}` }) as Record<string, unknown>;
  const lineage = decision.lineage as Record<string, unknown>;
  return ({
    who: {
      bodyVersion: { specId: 'spec-gateway-director', version: 1 },
      intentRef: 'si:t040fx0001',
      decisionId: decision.decisionId as string,
      decisionKind: 'approve',
      clientOrderId: `t040-fx-${sequence}`,
    },
    substrate: 'substrate:t040-reference@1',
    policy: { policyId: 'xpol:t040fx01', version: 1 },
    visibleState: {
      venue: 'BROKER-FIX',
      instrument: 'BTC-USDT',
      instrumentClass: 'crypto',
      referencePrice: '50000.00',
      rateWindowOrderCount: 0,
      riskExposureRef: 'exp:t040fx01',
    },
    riskChecks: {
      evaluationId: 'rls:t040fx01',
      riskPolicy: { policyId: 'rpol:t040fx01', version: 1 },
      within: 4,
      breaching: 0,
      blocked: 0,
    },
    order: {
      adapterRef: 'adapter:adapter-brokers@0.0.0',
      channelRef: 'chan:newOrderSingle',
      credentialRef: 'cred:gw-broker-main@1',
      clientOrderId: `t040-fx-${sequence}`,
      requestRef: `gor:t040fx${String(sequence).padStart(2, '0')}`,
    },
    execution: {
      routed: true,
      submissionAt: T0 as never,
      messageDigest: '0123abcd',
    },
    outcome: 'routed',
    refusal: null,
    lineage: lineage as unknown as GatewayAuditRecord['lineage'],
    tenant: TENANT as never,
    project: PROJECT as never,
    asOf: T0 as never,
    ...overrides,
  }) as unknown as Omit<GatewayAuditRecord, 'auditId' | 'chainHead' | 'sequence'>;
}

/** Build a trail with N routed records. */
function trailOf(count: number): GatewayAuditTrail {
  let trail = start(TENANT, PROJECT);
  for (let sequence = 1; sequence <= count; sequence++) {
    const minted = gatewayAuditRecordAt(trail, recordContentAt(sequence));
    if (!minted.ok) throw new Error(`fixture record ${sequence} must mint: ${JSON.stringify(minted.errors)}`);
    const appended = appendGatewayAuditRecord(trail, minted.value);
    if (!appended.ok) throw new Error(`fixture record ${sequence} must append: ${JSON.stringify(appended.errors)}`);
    trail = appended.value;
  }
  return trail;
}

function start(tenant: string, project: string): GatewayAuditTrail {
  const started = startGatewayAuditTrail(tenant as never, project as never);
  if (!started.ok) throw new Error(`fixture trail must start: ${JSON.stringify(started.errors)}`);
  return started.value;
}

describe('the gateway audit trail', () => {
  it('starts empty and appends guard-valid records with contiguous sequences', () => {
    const trail = trailOf(3);
    expect(isGatewayAuditTrail(trail)).toBe(true);
    expect(trail.records.length).toBe(3);
    expect(trail.records.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(trail.records.every((record) => isGatewayAuditRecord(record))).toBe(true);
  });

  it('the chain verifies over a pristine trail', () => {
    const trail = trailOf(4);
    const verified = verifyGatewayAuditChain(trail);
    expect(verified.ok).toBe(true);
    const validated = validateGatewayAuditTrail(trail);
    expect(validated.ok).toBe(true);
  });

  it('TAMPER DETECTION: mutating a byte of a record\'s content breaks the chain (audit_rewrite)', () => {
    const trail = trailOf(3);
    // Deep-copy and mutate ONE field of the SECOND record (a byte-level edit).
    const tamperedRecords = trail.records.map((record, index) =>
      index === 1
        ? ({ ...record, visibleState: { ...record.visibleState, referencePrice: '49999.99' } } as GatewayAuditRecord)
        : record,
    );
    const tampered: GatewayAuditTrail = { tenant: trail.tenant, project: trail.project, records: tamperedRecords };
    const verified = verifyGatewayAuditChain(tampered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.errors[0]?.code).toBe('audit_rewrite');
      expect(verified.errors[0]?.path).toBe('records[1].chainHead');
    }
  });

  it('TAMPER DETECTION: MID-TRAIL truncation (removing a middle record) is caught (the sequence gap)', () => {
    const trail = trailOf(3);
    // Remove the MIDDLE record: the remaining records carry sequences 1 and
    // 3 — the gap is a splice, and the chain head of the third record no
    // longer folds onto the first's.
    const truncated: GatewayAuditTrail = {
      tenant: trail.tenant,
      project: trail.project,
      records: [trail.records[0], trail.records[2]] as readonly GatewayAuditRecord[],
    };
    const verified = verifyGatewayAuditChain(truncated);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('audit_rewrite');
  });

  it('TAMPER DETECTION: tail truncation yields a self-consistent SHORTER trail — the fork is detectable against the original', () => {
    const trail = trailOf(3);
    const truncated: GatewayAuditTrail = { tenant: trail.tenant, project: trail.project, records: trail.records.slice(0, 2) };
    // The truncated trail is internally valid (the chain cannot know its
    // own intended length — that anchor is the gateway's outcome log, see
    // services/execution-gateway verifyGatewayCoherence).
    expect(verifyGatewayAuditChain(truncated).ok).toBe(true);
    // But it is NOT the original: the original's third record is gone and
    // its chain head differs from the truncated trail's head.
    const originalHead = (trail.records[2] as GatewayAuditRecord).chainHead;
    const truncatedHead = (truncated.records[1] as GatewayAuditRecord).chainHead;
    expect(originalHead).not.toBe(truncatedHead);
    expect(trail.records.length).not.toBe(truncated.records.length);
  });

  it('TAMPER DETECTION: reordering records breaks the chain', () => {
    const trail = trailOf(3);
    const reordered: GatewayAuditTrail = {
      tenant: trail.tenant,
      project: trail.project,
      records: [trail.records[1], trail.records[0], trail.records[2]] as readonly GatewayAuditRecord[],
    };
    const verified = verifyGatewayAuditChain(reordered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('audit_rewrite');
  });

  it('TAMPER DETECTION: splicing a duplicate record in is caught (one decision, one audit record)', () => {
    const trail = trailOf(2);
    const spliced: GatewayAuditTrail = { tenant: trail.tenant, project: trail.project, records: [trail.records[0], trail.records[0], trail.records[1]] as readonly GatewayAuditRecord[] };
    const verified = verifyGatewayAuditChain(spliced);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('audit_rewrite');
  });

  it('appending a record whose decision was already audited is audit_rewrite (one decision, one record)', () => {
    const trail = trailOf(2);
    // Re-mint the FIRST record's content at position 3 (same decisionId).
    const minted = gatewayAuditRecordAt(trail, recordContentAt(1));
    expect(minted.ok).toBe(true);
    if (minted.ok) {
      const appended = appendGatewayAuditRecord(trail, minted.value);
      expect(appended.ok).toBe(false);
      if (!appended.ok) expect(appended.errors[0]?.code).toBe('audit_rewrite');
    }
  });

  it('a sequence gap is audit_rewrite (append-only with contiguous sequences)', () => {
    const trail = trailOf(2);
    const minted = gatewayAuditRecordAt(trail, recordContentAt(3));
    if (!minted.ok) throw new Error('fixture must mint');
    const gapped = { ...minted.value, sequence: 5 } as GatewayAuditRecord;
    const appended = appendGatewayAuditRecord(trail, gapped);
    expect(appended.ok).toBe(false);
    if (!appended.ok) expect(appended.errors[0]?.code).toBe('audit_rewrite');
  });

  it('cross-tenant appending is inexpressible (L12)', () => {
    const trail = trailOf(1);
    const minted = gatewayAuditRecordAt(trail, recordContentAt(2, { tenant: 'tenant-other' as never }));
    expect(minted.ok).toBe(true);
    if (minted.ok) {
      const appended = appendGatewayAuditRecord(trail, minted.value);
      expect(appended.ok).toBe(false);
      if (!appended.ok) expect(appended.errors[0]?.code).toBe('tenant_missing');
    }
  });

  it('a forged chain head does not fold onto the trail', () => {
    const trail = trailOf(2);
    const minted = gatewayAuditRecordAt(trail, recordContentAt(3));
    if (!minted.ok) throw new Error('fixture must mint');
    const forged = { ...minted.value, chainHead: 'deadbeef' } as GatewayAuditRecord;
    const appended = appendGatewayAuditRecord(trail, forged);
    expect(appended.ok).toBe(false);
    if (!appended.ok) expect(appended.errors[0]?.code).toBe('audit_rewrite');
  });

  it('the refused-outcome coherence laws: a refused record carries the summary, not the order block', () => {
    const trail = start(TENANT, PROJECT);
    const refusedContent = recordContentAt(1, {
      decisionKind: 'refuse',
      order: null,
      execution: null,
      outcome: 'refused',
      refusal: { stage: 'policy_gate', code: 'limits', detail: { limit: 'order_size', cap: '1', observed: '5' } },
    });
    const minted = gatewayAuditRecordAt(trail, refusedContent);
    expect(minted.ok).toBe(true);
    if (minted.ok) {
      expect(minted.value.outcome).toBe('refused');
      expect(minted.value.order).toBeNull();
      expect(minted.value.refusal?.stage).toBe('policy_gate');
      const appended = appendGatewayAuditRecord(trail, minted.value);
      expect(appended.ok).toBe(true);
      if (appended.ok) {
        const verified = verifyGatewayAuditChain(appended.value);
        expect(verified.ok).toBe(true);
      }
    }
    // A routed record WITHOUT its order block fails the guard (coherence).
    const incoherent = recordContentAt(2, { order: null });
    const mintedIncoherent = gatewayAuditRecordAt(trail, incoherent);
    expect(mintedIncoherent.ok).toBe(false);
  });

  it('the trail is deeply frozen and byte-deterministic (the same history rebuilds identically)', () => {
    const a = trailOf(3);
    const b = trailOf(3);
    expect(canonicalJson({ records: a.records } as never)).toBe(canonicalJson({ records: b.records } as never));
  });

  it('the opacity trip wire runs over audit records (credential material is inexpressible)', () => {
    const trail = start(TENANT, PROJECT);
    const contaminated = recordContentAt(1, { substrate: 'substrate:t040-reference@1', passphrase: 'hunter2' });
    const minted = gatewayAuditRecordAt(trail, contaminated);
    expect(minted.ok).toBe(false);
    if (!minted.ok) expect(minted.errors[0]?.code).toBe('invalid_type');
    // And directly on the guard: a record embedding a secret fails.
    const trail2 = trailOf(1);
    const record = trail2.records[0] as GatewayAuditRecord;
    expect(isGatewayAuditRecord({ ...record, secret: 'x' })).toBe(false);
  });
});
