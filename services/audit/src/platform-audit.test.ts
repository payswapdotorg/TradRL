/**
 * @tradrl/audit — the PlatformAuditRecord chain tests.
 *
 * T040's `audit.ts` law-for-law, verified: the three DISTINCT chain
 * negatives (flip one byte in a record's content, drop the middle
 * record, swap two adjacent records — each the typed
 * `audit_rewrite`); the duplicate object ref law; cross-scope
 * appends (both directions, typed `tenant_missing`); the opacity
 * trip wire over every record; the lineage and gateway-audit-ref
 * coherence laws; collect-all validation; the deepFreeze totality;
 * and the determinism goldens (two independent constructions,
 * byte-identical, asserted twice).
 */

import { describe, expect, it } from 'vitest';

import {
  deepFreeze,
  isDeeplyFrozen,
  type ProjectId,
  type TimestampMs,
  type TenantId,
} from '../../../packages/observability/src/index';
import {
  appendPlatformAuditRecord,
  canonicalPlatformAuditTrailJson,
  platformAuditRecordAt,
  startPlatformAuditTrail,
  validatePlatformAuditTrail,
  verifyPlatformAuditChain,
  type PlatformAuditRecord,
  type PlatformAuditRecordDraft,
  type PlatformAuditTrail,
} from './platform-audit';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-platform' as TenantId;
const PROJECT = 'project-platform' as ProjectId;
const OTHER_TENANT = 'tenant-other' as TenantId;
const OTHER_PROJECT = 'project-other' as ProjectId;

/** Unwrap a fixture result or fail loudly. */
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

/** The draft of one platform audit record (overridable per test). */
function draft(overrides: Partial<PlatformAuditRecordDraft> = {}): PlatformAuditRecordDraft {
  return {
    actor: { kind: 'operator', ref: 'ops-oncall-primary' },
    action: 'kill_switch.thrown',
    object: { kind: 'platform-object', objectType: 'kill-switch', ref: 'ksw:platform-main' },
    at: T0,
    tenant: TENANT,
    project: PROJECT,
    lineage: { goal: { goalId: 'goal-platform-0001', version: 2 }, project: PROJECT },
    ...overrides,
  };
}

/** A grown three-record trail (three distinct actions and objects). */
function grownTrail(): PlatformAuditTrail {
  let trail = unwrap(startPlatformAuditTrail(TENANT, PROJECT));
  const drafts: PlatformAuditRecordDraft[] = [
    draft({ at: T0, action: 'access.granted', object: { kind: 'platform-object', objectType: 'access-grant', ref: 'grant:ops-console@1' } }),
    draft({ at: (T0 + 1_000) as TimestampMs, action: 'kill_switch.thrown', object: { kind: 'platform-object', objectType: 'kill-switch', ref: 'ksw:platform-main' }, actor: { kind: 'service', ref: 'risk-engine' } }),
    draft({ at: (T0 + 2_000) as TimestampMs, action: 'incident.opened', object: { kind: 'platform-object', objectType: 'incident', ref: 'inc-2024-0007' }, actor: { kind: 'operator', ref: 'ops-oncall-primary' }, lineage: { goal: null, project: PROJECT } }),
  ];
  for (const oneDraft of drafts) {
    const minted = unwrap(platformAuditRecordAt(trail, oneDraft));
    trail = unwrap(appendPlatformAuditRecord(trail, minted));
  }
  return trail;
}

/** A mutable deep copy of a trail's records (the tampering substrate). */
function mutableRecords(trail: PlatformAuditTrail): PlatformAuditRecord[] {
  return trail.records.map((record) => JSON.parse(JSON.stringify(record)) as PlatformAuditRecord);
}

/** Rebuild a trail shell over (possibly tampered) records. */
function shellOver(records: readonly PlatformAuditRecord[]): PlatformAuditTrail {
  return deepFreeze({ tenant: TENANT, project: PROJECT, records: [...records] }) as PlatformAuditTrail;
}

// ---------------------------------------------------------------------------
// Construction and growth
// ---------------------------------------------------------------------------

describe('startPlatformAuditTrail', () => {
  it('creates an empty trail for a valid scope', () => {
    const trail = unwrap(startPlatformAuditTrail(TENANT, PROJECT));
    expect(trail.records).toEqual([]);
    expect(verifyPlatformAuditChain(trail).ok).toBe(true);
  });

  it('rejects an invalid scope with the typed tenant_missing error', () => {
    const badTenant = startPlatformAuditTrail('' as TenantId, PROJECT);
    expect(badTenant.ok).toBe(false);
    if (!badTenant.ok) expect(badTenant.errors[0]?.code).toBe('tenant_missing');
  });
});

describe('appendPlatformAuditRecord (the only growth path)', () => {
  it('mints and appends records with contiguous sequences and verifies green', () => {
    const trail = grownTrail();
    expect(trail.records.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(verifyPlatformAuditChain(trail).ok).toBe(true);
  });

  it('returns a NEW trail; the original is untouched', () => {
    const before = grownTrail();
    const minted = unwrap(platformAuditRecordAt(before, draft({ at: (T0 + 3_000) as TimestampMs, action: 'policy.published', object: { kind: 'platform-object', objectType: 'policy', ref: 'rpol:v3' } })));
    const after = unwrap(appendPlatformAuditRecord(before, minted));
    expect(before.records).toHaveLength(3);
    expect(after.records).toHaveLength(4);
  });

  it('rejects a duplicate OBJECT REF with the typed audit_rewrite — one object, one record (the literal Work Order law)', () => {
    const trail = grownTrail();
    // A DIFFERENT action on the SAME object — still the typed duplicate
    // (the Work Order's literal law: duplicate object ref -> audit_rewrite;
    // see the module header's interpretation note).
    const minted = unwrap(platformAuditRecordAt(trail, draft({
      at: (T0 + 3_000) as TimestampMs,
      action: 'kill_switch.cleared',
      object: { kind: 'platform-object', objectType: 'kill-switch', ref: 'ksw:platform-main' },
    })));
    const appended = appendPlatformAuditRecord(trail, minted);
    expect(appended.ok).toBe(false);
    if (!appended.ok) {
      expect(appended.errors[0]?.code).toBe('audit_rewrite');
      expect(appended.errors[0]?.path).toBe('object');
    }
  });

  it('rejects a duplicate gateway-audit object ref identically (the complement join key is an object ref too)', () => {
    let trail = unwrap(startPlatformAuditTrail(TENANT, PROJECT));
    const ref = { kind: 'gateway-audit' as const, auditId: 'xga:0f1e2d3c', tenant: TENANT, project: PROJECT };
    const first = unwrap(platformAuditRecordAt(trail, draft({ action: 'audit.exported', object: ref, at: T0 })));
    trail = unwrap(appendPlatformAuditRecord(trail, first));
    const second = unwrap(platformAuditRecordAt(trail, draft({ action: 'telemetry.queried', object: ref, at: (T0 + 1) as TimestampMs })));
    const appended = appendPlatformAuditRecord(trail, second);
    expect(appended.ok).toBe(false);
    if (!appended.ok) expect(appended.errors[0]?.code).toBe('audit_rewrite');
  });

  it('rejects a cross-scope append in BOTH directions with the typed tenant_missing error (L12)', () => {
    const ownTrail = grownTrail();
    // Direction 1: an other-tenant record into this trail.
    const foreignTrail = unwrap(startPlatformAuditTrail(OTHER_TENANT, OTHER_PROJECT));
    const foreignRecord = unwrap(platformAuditRecordAt(foreignTrail, draft({
      tenant: OTHER_TENANT,
      project: OTHER_PROJECT,
      lineage: { goal: null, project: OTHER_PROJECT },
      object: { kind: 'platform-object', objectType: 'incident', ref: 'inc-other-1' },
    })));
    const appendForeign = appendPlatformAuditRecord(ownTrail, foreignRecord);
    expect(appendForeign.ok).toBe(false);
    if (!appendForeign.ok) expect(appendForeign.errors[0]?.code).toBe('tenant_missing');

    // Direction 2: this tenant's record into an other-tenant trail.
    const own = ownTrail.records[0] as PlatformAuditRecord;
    const appendOwn = appendPlatformAuditRecord(foreignTrail, own);
    expect(appendOwn.ok).toBe(false);
    if (!appendOwn.ok) expect(appendOwn.errors[0]?.code).toBe('tenant_missing');
  });
});

// ---------------------------------------------------------------------------
// The three DISTINCT chain negatives (tamper / truncate / reorder)
// ---------------------------------------------------------------------------

describe('verifyPlatformAuditChain: the chain negatives (each typed audit_rewrite)', () => {
  it('NEGATIVE 1 — flipping one byte in a record\u2019s content breaks the chain (audit_rewrite)', () => {
    const trail = grownTrail();
    const records = mutableRecords(trail);
    const victim = records[1] as PlatformAuditRecord;
    // Flip one byte of the actor ref: 'risk-engine' -> 'risk-enginf'.
    records[1] = { ...victim, actor: { ...victim.actor, ref: 'risk-enginf' } };
    const verified = verifyPlatformAuditChain(shellOver(records));
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.errors[0]?.code).toBe('audit_rewrite');
      expect(verified.errors[0]?.path).toContain('chainHead');
    }
  });

  it('NEGATIVE 2 — dropping the middle record breaks the chain (audit_rewrite)', () => {
    const trail = grownTrail();
    const records = mutableRecords(trail);
    records.splice(1, 1);
    const verified = verifyPlatformAuditChain(shellOver(records));
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.errors[0]?.code).toBe('audit_rewrite');
      expect(verified.errors[0]?.path).toContain('sequence');
    }
  });

  it('NEGATIVE 3 — swapping two adjacent records breaks the chain (audit_rewrite)', () => {
    const trail = grownTrail();
    const records = mutableRecords(trail);
    const first = records[0] as PlatformAuditRecord;
    records[0] = records[1] as PlatformAuditRecord;
    records[1] = first;
    const verified = verifyPlatformAuditChain(shellOver(records));
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.errors[0]?.code).toBe('audit_rewrite');
      expect(verified.errors[0]?.path).toContain('sequence');
    }
  });
});

// ---------------------------------------------------------------------------
// The opacity trip wire + coherence laws
// ---------------------------------------------------------------------------

describe('the opacity trip wire over every platform audit record', () => {
  it('rejects a credential VALUE anywhere in the record (typed credential_value_present)', () => {
    const trail = unwrap(startPlatformAuditTrail(TENANT, PROJECT));
    const minted = platformAuditRecordAt(trail, draft({
      action: 'credential.bound',
      object: { kind: 'platform-object', objectType: 'credential-binding', ref: 'cred:broker-main@1' },
    }));
    // The object ref itself is a cred: REFERENCE — fine. Contaminate via... the
    // record has no free-form payload field, so contaminate the actor ref? No —
    // opacity flags KEYS, and the actor ref is a value under 'ref'. The scan
    // runs over the whole record: a credential-shaped KEY anywhere. There is
    // none in a valid draft — so build one through the untrusted-input gate.
    const contaminated = {
      auditId: 'pau:1a2b3c4d',
      sequence: 1,
      actor: { kind: 'operator', ref: 'ops' },
      action: 'credential.bound',
      object: { kind: 'platform-object', objectType: 'credential-binding', ref: 'cred:x@1', secret: 'SUPER-SECRET' },
      at: T0,
      tenant: TENANT,
      project: PROJECT,
      lineage: { goal: null, project: PROJECT },
      chainHead: '0a1b2c3d',
    };
    const validation = validatePlatformAuditTrail({ tenant: TENANT, project: PROJECT, records: [contaminated] });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      const opacity = validation.errors.filter((error) => error.code === 'credential_value_present');
      expect(opacity.length).toBeGreaterThanOrEqual(1);
      expect(opacity[0]?.path).toContain('secret');
    }
    expect(minted.ok).toBe(true); // the cred: REF is fine
  });

  it('rejects an incoherent lineage (lineage.project !== record.project)', () => {
    const trail = unwrap(startPlatformAuditTrail(TENANT, PROJECT));
    const minted = platformAuditRecordAt(trail, draft({ lineage: { goal: null, project: OTHER_PROJECT } }));
    expect(minted.ok).toBe(false);
    if (!minted.ok) {
      expect(minted.errors.map((error) => error.code)).toContain('invalid_field');
    }
  });

  it('rejects a cross-scope gateway-audit object ref (the L12 read-across default-deny)', () => {
    const trail = unwrap(startPlatformAuditTrail(TENANT, PROJECT));
    const minted = platformAuditRecordAt(trail, draft({
      action: 'audit.exported',
      object: { kind: 'gateway-audit', auditId: 'xga:0f1e2d3c', tenant: OTHER_TENANT, project: PROJECT },
    }));
    expect(minted.ok).toBe(false);
    if (!minted.ok) {
      expect(minted.errors[0]?.code).toBe('invalid_field');
      expect(minted.errors[0]?.message).toContain('cross-scope audit references are inexpressible');
    }
  });

  it('rejects an action outside the closed vocabulary', () => {
    const trail = unwrap(startPlatformAuditTrail(TENANT, PROJECT));
    const minted = platformAuditRecordAt(trail, draft({ action: 'order.submitted' as never }));
    expect(minted.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Collect-all validation + deepFreeze + determinism
// ---------------------------------------------------------------------------

describe('collect-all validation', () => {
  it('collects every simultaneous violation across the trail shape and EACH record', () => {
    const broken = {
      tenant: '',
      project: '',
      records: [
        { actor: { kind: 'robot', ref: '' }, action: 'nope', object: { kind: 'wormhole' }, at: -1, lineage: { goal: 5 } },
        { sequence: 0, auditId: 'xga:oops' },
      ],
    };
    const validation = validatePlatformAuditTrail(broken);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors.length).toBeGreaterThanOrEqual(14);
      const codes = new Set(validation.errors.map((error) => error.code));
      expect(codes.has('missing_field')).toBe(true);
      expect(codes.has('invalid_field')).toBe(true);
    }
  });

  it('accepts a valid trail through the untrusted-input gate', () => {
    const trail = grownTrail();
    const json = JSON.parse(JSON.stringify(trail)) as unknown;
    const validation = validatePlatformAuditTrail(json);
    expect(validation.ok).toBe(true);
  });
});

describe('the deepFreeze totality', () => {
  it('the grown trail and every record are deeply frozen; mutation attempts throw', () => {
    const trail = grownTrail();
    expect(isDeeplyFrozen(trail)).toBe(true);
    expect(() => {
      (trail.records as unknown as PlatformAuditRecord[]).pop();
    }).toThrow();
    const record = trail.records[0] as PlatformAuditRecord;
    expect(() => {
      (record as unknown as Record<string, unknown>).action = 'access.revoked';
    }).toThrow();
  });
});

describe('determinism goldens (asserted twice — two independent constructions)', () => {
  it('builds byte-identical trails from identical inputs (construction A vs construction B)', () => {
    const build = (): string => {
      const trail = grownTrail();
      return canonicalPlatformAuditTrailJson(trail);
    };
    const first = build();
    const second = build();
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('mints identical ids and chain heads for identical content at identical positions', () => {
    const trailA = grownTrail();
    const trailB = grownTrail();
    for (let index = 0; index < trailA.records.length; index++) {
      const a = trailA.records[index] as PlatformAuditRecord;
      const b = trailB.records[index] as PlatformAuditRecord;
      expect(a.auditId).toBe(b.auditId);
      expect(a.chainHead).toBe(b.chainHead);
    }
  });
});
