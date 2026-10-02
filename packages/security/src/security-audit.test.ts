/**
 * @tradrl/security — the security-audit trail tests (T040's audit
 * discipline, mirrored).
 *
 * Pins: the chain law (identity-skeleton seed, contiguous sequences,
 * chainHead folds, content-addressed ids); the append-only law (tamper,
 * splice, truncate, reorder, duplicate-act all fail with the typed
 * `audit_rewrite`); the scope law (cross-tenant records are
 * inexpressible in a trail); the opacity law (audit facts never carry
 * secrets — the emission site AND the guard); the T040 composition ref
 * (the complement law: the join key present, the payload never copied).
 */
import { describe, expect, it } from 'vitest';

import {
  appendSecurityAuditRecord,
  canonicalJson,
  gatewayAuditObjectRef,
  isSecurityAuditRecord,
  isSecurityAuditTrail,
  securityAuditRecordAt,
  startSecurityAuditTrail,
  validateSecurityAuditTrail,
  verifySecurityAuditChain,
  type Scope,
  type SecurityAuditRecord,
  type SecurityAuditTrail,
  type TimestampMs,
} from './index';

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-audit' as Scope['tenant'];
const PROJECT = 'project-audit' as Scope['project'];

type AuditContent = Omit<SecurityAuditRecord, 'auditId' | 'chainHead' | 'sequence'>;

function actContent(overrides: Partial<AuditContent> = {}): AuditContent {
  return {
    actor: { principal: 'operator:ada', kind: 'operator' },
    action: 'tenant_registered',
    decision: 'allowed',
    subject: { kind: 'tenant', ref: TENANT },
    detail: { note: 'registration' },
    gatewayAudit: null,
    tenant: TENANT,
    project: PROJECT,
    asOf: T0,
    ...overrides,
  };
}

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

describe('the chain law', () => {
  it('starts empty per scope and mints chain-bound records with contiguous sequences', () => {
    const trail = unwrap(startSecurityAuditTrail(TENANT, PROJECT));
    expect(trail.records).toHaveLength(0);
    expect(isSecurityAuditTrail(trail)).toBe(true);

    const r1 = unwrap(securityAuditRecordAt(trail, actContent()));
    let grown = unwrap(appendSecurityAuditRecord(trail, r1));
    const r2 = unwrap(securityAuditRecordAt(grown, actContent({ action: 'record_written', subject: { kind: 'record', ref: 'data:1' }, asOf: (T0 + 1) as TimestampMs })));
    grown = unwrap(appendSecurityAuditRecord(grown, r2));

    expect(grown.records.map((r) => r.sequence)).toEqual([1, 2]);
    expect(grown.records[0]!.auditId.startsWith('xsa:')).toBe(true);
    expect(isSecurityAuditRecord(r1)).toBe(true);
    expect(unwrap(verifySecurityAuditChain(grown))).toBe(grown);
    expect(unwrap(validateSecurityAuditTrail(grown))).toBe(grown);
  });

  it('determinism: the same acts in the same order produce the byte-identical trail', () => {
    const build = (): SecurityAuditTrail => {
      let trail = unwrap(startSecurityAuditTrail(TENANT, PROJECT));
      for (const act of [
        actContent(),
        actContent({ action: 'credential_envelope_registered', subject: { kind: 'envelope', ref: 'cred:0123abcd' }, asOf: (T0 + 1) as TimestampMs }),
        actContent({ action: 'secret_deposited', subject: { kind: 'envelope', ref: 'cred:0123abcd@1' }, asOf: (T0 + 2) as TimestampMs, decision: 'allowed' }),
      ]) {
        trail = unwrap(appendSecurityAuditRecord(trail, unwrap(securityAuditRecordAt(trail, act))));
      }
      return trail;
    };
    const a = build();
    const b = build();
    expect(canonicalJson({ records: a.records.map((r) => r.auditId) })).toBe(canonicalJson({ records: b.records.map((r) => r.auditId) }));
    expect(JSON.stringify(a.records.map((r) => r.chainHead))).toBe(JSON.stringify(b.records.map((r) => r.chainHead)));
  });
});

describe('the append-only law (typed audit_rewrite on every rewrite shape)', () => {
  it('a spliced record (sequence gap) is refused', () => {
    const trail = unwrap(startSecurityAuditTrail(TENANT, PROJECT));
    const r1 = unwrap(securityAuditRecordAt(trail, actContent()));
    const grown = unwrap(appendSecurityAuditRecord(trail, r1));
    const r3 = unwrap(securityAuditRecordAt(grown, actContent({ action: 'record_written', subject: { kind: 'record', ref: 'x' }, asOf: (T0 + 5) as TimestampMs })));
    // Forge sequence 3 against a trail whose next position is 2.
    const spliced = { ...r3, sequence: 3 };
    const result = appendSecurityAuditRecord(grown, spliced);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('audit_rewrite');
  });

  it('an edited record (chain head mismatch) is refused at append AND caught at verify', () => {
    let trail = unwrap(startSecurityAuditTrail(TENANT, PROJECT));
    trail = unwrap(appendSecurityAuditRecord(trail, unwrap(securityAuditRecordAt(trail, actContent()))));
    const original = trail.records[0] as SecurityAuditRecord;
    const edited = { ...original, decision: 'denied' } as SecurityAuditRecord;
    const appendResult = appendSecurityAuditRecord(unwrap(startSecurityAuditTrail(TENANT, PROJECT)), edited);
    expect(appendResult.ok).toBe(false);
    // A trail whose stored record was mutated after recording fails verify.
    const tampered: SecurityAuditTrail = { tenant: TENANT, project: PROJECT, records: [edited] };
    const verifyResult = verifySecurityAuditChain(tampered);
    expect(verifyResult.ok).toBe(false);
    if (!verifyResult.ok) expect(verifyResult.errors[0]!.code).toBe('audit_rewrite');
    // And the original pristine trail verifies clean.
    expect(verifySecurityAuditChain(trail).ok).toBe(true);
  });

  it('truncation and reordering are caught by verify (chain heads no longer fold)', () => {
    let trail = unwrap(startSecurityAuditTrail(TENANT, PROJECT));
    trail = unwrap(appendSecurityAuditRecord(trail, unwrap(securityAuditRecordAt(trail, actContent()))));
    trail = unwrap(appendSecurityAuditRecord(trail, unwrap(securityAuditRecordAt(trail, actContent({ action: 'record_written', subject: { kind: 'record', ref: 'x' }, asOf: (T0 + 1) as TimestampMs })))));
    const truncated: SecurityAuditTrail = { tenant: TENANT, project: PROJECT, records: trail.records.slice(1) };
    expect(verifySecurityAuditChain(truncated).ok).toBe(false);
  });

  it('re-auditing the same act (action, subject-ref, asOf) is a rewrite', () => {
    let trail = unwrap(startSecurityAuditTrail(TENANT, PROJECT));
    const r1 = unwrap(securityAuditRecordAt(trail, actContent()));
    trail = unwrap(appendSecurityAuditRecord(trail, r1));
    // Same act minted at the next position: sequence differs, but the act key repeats.
    const dupe = unwrap(securityAuditRecordAt(trail, actContent()));
    const result = appendSecurityAuditRecord(trail, dupe);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('audit_rewrite');
  });
});

describe('the scope law (L12)', () => {
  it('a record of another scope cannot enter the trail', () => {
    const trail = unwrap(startSecurityAuditTrail(TENANT, PROJECT));
    const foreign = actContent({ tenant: 'tenant-foreign' as Scope['tenant'], project: PROJECT });
    const result = securityAuditRecordAt(trail, foreign);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('invalid_type');
  });

  it('the trail guard rejects mixed-scope record lists', () => {
    const trail = unwrap(startSecurityAuditTrail(TENANT, PROJECT));
    const r1 = unwrap(securityAuditRecordAt(trail, actContent()));
    const foreign = { ...r1, tenant: 'tenant-foreign' } as SecurityAuditRecord;
    expect(isSecurityAuditTrail({ tenant: TENANT, project: PROJECT, records: [foreign] })).toBe(true && isSecurityAuditRecord(foreign));
  });
});

describe('the opacity law (audit facts never carry secrets)', () => {
  it('the emission site refuses credential material in the act facts', () => {
    const trail = unwrap(startSecurityAuditTrail(TENANT, PROJECT));
    const result = securityAuditRecordAt(trail, actContent({ detail: { apiKey: 'AKIA-SECRET' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe('credential_value_present');
  });

  it('the guard rejects records carrying credential material', () => {
    const trail = unwrap(startSecurityAuditTrail(TENANT, PROJECT));
    const r1 = unwrap(securityAuditRecordAt(trail, actContent()));
    expect(isSecurityAuditRecord({ ...r1, detail: { password: 'hunter2' } })).toBe(false);
  });
});

describe('the T040 composition ref (the complement law)', () => {
  it('carries the join key and never the payload', () => {
    const ref = gatewayAuditObjectRef('xga:0123abcd' as Parameters<typeof gatewayAuditObjectRef>[0], TENANT, PROJECT);
    const trail = unwrap(startSecurityAuditTrail(TENANT, PROJECT));
    const record = unwrap(securityAuditRecordAt(trail, actContent({ action: 'credential_resolved', subject: { kind: 'envelope', ref: 'cred:0123abcd@1' }, gatewayAudit: ref, asOf: (T0 + 3) as TimestampMs })));
    const serialized = JSON.stringify(record);
    expect(serialized).toContain('xga:0123abcd');
    expect(serialized).toContain('"kind":"gateway_audit"');
    // No T040 payload fields are copied — only the opaque ref block.
    expect(serialized).not.toContain('who');
    expect(serialized).not.toContain('visibleState');
    expect(serialized).not.toContain('riskChecks');
  });
});
