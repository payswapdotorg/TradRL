// @tradrl/capability-provider — the provider declaration's laws
// (positive + negative).
//
// L16a is the headline: a declaration is a MEASURED capability
// catalogue, never a profession label — all seven label keys are typed
// violations anywhere in the tree, and an offer without measured
// evidence is exactly the label-shaped claim the law forbids.

import { describe, expect, it } from 'vitest';
import {
  createProviderDeclaration,
  isProviderCapabilityOffer,
  isProviderDeclaration,
  labelKeyPaths,
  supersedeProviderDeclaration,
  validateProviderDeclaration,
} from './index';
import { FIXTURE_TENANT, T0, validDeclarationDraft } from './fixtures';

describe('the positive law', () => {
  it('a valid declaration validates, mints a pvd: id, and satisfies its own guard', () => {
    const result = validateProviderDeclaration(validDeclarationDraft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.declarationId).toMatch(/^pvd:[0-9a-f]{16}$/);
    expect(isProviderDeclaration(result.value)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('the content-addressed id is stable (the same draft mints the same id, twice)', () => {
    const first = validateProviderDeclaration(validDeclarationDraft());
    const second = validateProviderDeclaration(validDeclarationDraft());
    expect(first.ok && second.ok && first.value.declarationId === second.value.declarationId).toBe(true);
  });

  it('createProviderDeclaration throws TypeError with located problems on invalid input', () => {
    expect(() => createProviderDeclaration({ bad: true })).toThrow(TypeError);
    expect(() => createProviderDeclaration({ bad: true })).toThrow(/missing_field/);
  });

  it('isProviderCapabilityOffer scans for label keys structurally', () => {
    const offer = (validDeclarationDraft().offers as { offerRef: string }[])[0];
    expect(isProviderCapabilityOffer(offer)).toBe(true);
    expect(isProviderCapabilityOffer({ ...offer, title: 'Senior Quant' })).toBe(false);
  });
});

describe('the L16a label trip-wire (labels never establish suitability)', () => {
  it('every one of the seven label keys is a typed violation anywhere in the tree', () => {
    for (const key of ['label', 'roleLabel', 'profession', 'role', 'title', 'jobTitle', 'vocation']) {
      const draft = validDeclarationDraft() as { offers: Record<string, unknown>[] };
      draft.offers[0][key] = 'Senior Quantitative Analyst';
      const result = validateProviderDeclaration(draft);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
      }
      expect(isProviderDeclaration(draft)).toBe(false);
    }
  });

  it('labelKeyPaths walks nested arrays and objects with dotted paths', () => {
    const paths = labelKeyPaths({ a: [{ profession: 'x' }], b: { c: { role: 'y' } } });
    expect(paths).toContain('a[0].profession');
    expect(paths).toContain('b.c.role');
  });

  it('an offer with EMPTY measured evidence is the label-shaped claim (label_as_evidence)', () => {
    const draft = validDeclarationDraft() as { offers: { measuredEvidence: unknown[] }[] };
    draft.offers[0].measuredEvidence = [];
    const result = validateProviderDeclaration(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'label_as_evidence')).toBe(true);
    }
  });

  it('a measured-evidence entry of kind "label" fails the closed union', () => {
    const draft = validDeclarationDraft() as { offers: { measuredEvidence: unknown[] }[] };
    draft.offers[0].measuredEvidence = [{ kind: 'label', label: 'mathematician' }];
    const result = validateProviderDeclaration(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'invalid_field' && e.path.includes('measuredEvidence'))).toBe(true);
    }
  });
});

describe('the structural negative law', () => {
  it('rejects a non-object root', () => {
    const result = validateProviderDeclaration('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid_type');
  });

  it('rejects an EMPTY offer list (a provider offering nothing is not a provider)', () => {
    const draft = validDeclarationDraft() as { offers: unknown[] };
    draft.offers = [];
    const result = validateProviderDeclaration(draft);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate offerRefs within one declaration', () => {
    const draft = validDeclarationDraft() as { offers: Record<string, unknown>[] };
    draft.offers = [draft.offers[0], { ...draft.offers[0] }];
    const result = validateProviderDeclaration(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'invalid_field' && e.message.includes('duplicate offer reference'))).toBe(true);
    }
  });

  it('rejects empty or duplicated deliverableKinds / verificationKinds', () => {
    const emptyKinds = validDeclarationDraft() as { offers: { deliverableKinds: string[] }[] };
    emptyKinds.offers[0].deliverableKinds = [];
    expect(validateProviderDeclaration(emptyKinds).ok).toBe(false);

    const dupKinds = validDeclarationDraft() as { offers: { deliverableKinds: string[] }[] };
    dupKinds.offers[0].deliverableKinds = ['expert-evidence', 'expert-evidence'];
    expect(validateProviderDeclaration(dupKinds).ok).toBe(false);

    const emptyVerification = validDeclarationDraft() as { offers: { verificationKinds: string[] }[] };
    emptyVerification.offers[0].verificationKinds = [];
    expect(validateProviderDeclaration(emptyVerification).ok).toBe(false);
  });

  it('rejects a bad capability key grammar', () => {
    const draft = validDeclarationDraft() as { offers: { capabilityKey: string }[] };
    draft.offers[0].capabilityKey = 'not a valid key!';
    expect(validateProviderDeclaration(draft).ok).toBe(false);
  });

  it('rejects version 0 and a non-id supersedes', () => {
    const zeroVersion = validDeclarationDraft() as { version: number };
    zeroVersion.version = 0;
    const result = validateProviderDeclaration(zeroVersion);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.path === 'declaration.version')).toBe(true);

    const badSupersedes = validDeclarationDraft() as { supersedes: unknown };
    badSupersedes.supersedes = 'not-an-id';
    expect(validateProviderDeclaration(badSupersedes).ok).toBe(false);
  });

  it('rejects a missing tenant (L12) and a bad instant', () => {
    const noTenant = validDeclarationDraft() as { tenantId?: string };
    delete noTenant.tenantId;
    const result = validateProviderDeclaration(noTenant);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'tenant_missing')).toBe(true);

    const badInstant = validDeclarationDraft() as { declaredAt: number };
    badInstant.declaredAt = -5;
    expect(validateProviderDeclaration(badInstant).ok).toBe(false);
  });

  it('collects EVERY violation, not just the first', () => {
    const draft = validDeclarationDraft() as Record<string, unknown>;
    delete draft.providerRef;
    delete draft.displayName;
    const result = validateProviderDeclaration(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the supersede law (L3 discipline — supersede MINTS, never mutates)', () => {
  it('supersedeProviderDeclaration mints version+1 chained to the prior id', () => {
    const first = createProviderDeclaration(validDeclarationDraft());
    const second = supersedeProviderDeclaration(first, {
      displayName: 'Alpha Microstructure Research (v2)',
      offers: first.offers,
      declaredAt: T0 + 1000,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.version).toBe(2);
    expect(second.value.supersedes).toBe(first.declarationId);
    expect(second.value.declarationId).not.toBe(first.declarationId);
    expect(first.version).toBe(1); // the prior record is untouched
  });

  it('rejects a superseding declaration that predates the prior (L4)', () => {
    const first = createProviderDeclaration(validDeclarationDraft());
    const result = supersedeProviderDeclaration(first, {
      displayName: 'Backwards',
      offers: first.offers,
      declaredAt: T0 - 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('l4_boundary_violation');
  });

  it('rejects a non-declaration prior', () => {
    const result = supersedeProviderDeclaration({ not: 'a declaration' } as never, {
      displayName: 'x',
      offers: [],
      declaredAt: T0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid_type');
  });

  it('the declaration keeps the L12 scope across supersedes', () => {
    const first = createProviderDeclaration(validDeclarationDraft());
    const second = supersedeProviderDeclaration(first, { displayName: 'v2', offers: first.offers, declaredAt: T0 + 1 });
    expect(second.ok && second.value.tenantId === FIXTURE_TENANT).toBe(true);
  });
});
