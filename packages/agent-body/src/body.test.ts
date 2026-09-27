import { describe, expect, it } from 'vitest';
import {
  type BodyVersion,
  type BodyVersionDraft,
  type CertificationEvidence,
  type CertifiedBodyVersion,
  adoptCertifiedBodyVersion,
  certifyBodyVersion,
  createAgentBody,
  createBodyVersion,
  isAgentBody,
  isBodyVersion,
  isCertifiedBodyVersion,
} from './body';
import { deepFreeze, isDeeplyFrozen, iso8601, parseSemVer } from './primitives';
import {
  exampleBody,
  exampleBodyVersion,
  exampleCertificationEvidence,
  exampleCertifiedBodyVersion,
} from './examples';

function validDraft(): BodyVersionDraft {
  // Structurally identical to the canonical example, but rebuilt so tests can
  // mutate copies freely.
  return JSON.parse(JSON.stringify(exampleBodyVersion)) as BodyVersionDraft;
}

function evidence(overrides?: Partial<CertificationEvidence>): CertificationEvidence {
  return { ...exampleCertificationEvidence, ...overrides };
}

describe('createBodyVersion', () => {
  it('derives the canonical id from bodyId + version', () => {
    const version = createBodyVersion(validDraft());
    expect(version.id).toBe('regime-researcher@1.0.0');
    expect(version.certified).toBe(false);
    expect(version.certificationEvidence).toBeNull();
  });

  it('returns a deeply frozen record (L3 discipline from birth)', () => {
    const version = createBodyVersion(validDraft());
    expect(isDeeplyFrozen(version)).toBe(true);
  });

  it('rejects invalid canonical ids, bodies, versions and timestamps', () => {
    const cases: Array<[string, (d: BodyVersionDraft) => BodyVersionDraft]> = [
      ['bodyId', (d) => ({ ...d, bodyId: 'bad body id' as BodyVersionDraft['bodyId'] })],
      ['version', (d) => ({ ...d, version: { major: -1, minor: 0, patch: 0, prerelease: [], build: [] } })],
      ['parentId', (d) => ({ ...d, parentId: 'not-canonical' as BodyVersionDraft['parentId'] })],
      ['createdAt', (d) => ({ ...d, createdAt: 'yesterday' as BodyVersionDraft['createdAt'] })],
      ['composition', (d) => ({ ...d, composition: { ...d.composition, mission: undefined as never } })],
    ];
    for (const [field, mutate] of cases) {
      try {
        createBodyVersion(mutate(validDraft()));
        throw new Error(`expected createBodyVersion to reject invalid ${field}`);
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
        expect((error as TypeError).message).toContain(field.split('.')[0]);
      }
    }
  });

  it('rejects a parent from a different body', () => {
    const draft = { ...validDraft(), parentId: 'other-body@1.0.0' as BodyVersionDraft['parentId'] };
    expect(() => createBodyVersion(draft)).toThrow(/parentId/);
  });

  it('rejects composition invariant violations', () => {
    const cases: Array<[RegExp, (d: BodyVersionDraft) => BodyVersionDraft]> = [
      [/capabilities: a body composes at least one capability/, (d) => ({ ...d, composition: { ...d.composition, capabilities: [] } })],
      [/duplicate capability ids/, (d) => ({ ...d, composition: { ...d.composition, capabilities: [...d.composition.capabilities, { ...d.composition.capabilities[0] }] } })],
      [/both allowed and forbidden/, (d) => ({ ...d, composition: { ...d.composition, knowledgeToolPolicy: { ...d.composition.knowledgeToolPolicy, allowedTools: [...d.composition.knowledgeToolPolicy.allowedTools, d.composition.knowledgeToolPolicy.forbiddenTools[0]] } } })],
      [/at least one step/, (d) => ({ ...d, composition: { ...d.composition, procedures: [{ ...d.composition.procedures[0], steps: [] }] } })],
      [/maxDelegationDepth must be 0/, (d) => ({ ...d, composition: { ...d.composition, delegationPolicy: { ...d.composition.delegationPolicy, canDelegate: false, maxDelegationDepth: 2 } } })],
      [/both allowed and prohibited/, (d) => ({ ...d, composition: { ...d.composition, authorityBoundary: { ...d.composition.authorityBoundary, prohibitedActions: [...d.composition.authorityBoundary.prohibitedActions, 'OBSERVE'] } } })],
      [/approval-required actions not in allowedActions/, (d) => ({ ...d, composition: { ...d.composition, authorityBoundary: { ...d.composition.authorityBoundary, approvalRequiredActions: ['APPROVE'] } } })],
    ];
    for (const [pattern, mutate] of cases) {
      expect(() => createBodyVersion(mutate(validDraft())), String(pattern)).toThrow(pattern);
    }
  });

  it('rejects EXECUTE authority without the external gateway (L8/L20)', () => {
    const base = validDraft();
    const draft: BodyVersionDraft = {
      ...base,
      composition: {
        ...base.composition,
        authorityBoundary: {
          ...base.composition.authorityBoundary,
          allowedActions: ['OBSERVE', 'EXECUTE'] as const,
          executionAuthority: 'none' as const,
        },
      },
    };
    expect(() => createBodyVersion(draft)).toThrow(/external-gateway-only/);
  });

  it('rejects gateway-only authority without EXECUTE (vacuous declaration)', () => {
    const base = validDraft();
    const draft: BodyVersionDraft = {
      ...base,
      composition: {
        ...base.composition,
        authorityBoundary: {
          ...base.composition.authorityBoundary,
          executionAuthority: 'external-gateway-only' as const,
        },
      },
    };
    expect(() => createBodyVersion(draft)).toThrow(/only meaningful/);
  });

  it('accepts a body that declares EXECUTE through the external gateway only', () => {
    const base = validDraft();
    const draft: BodyVersionDraft = {
      ...base,
      composition: {
        ...base.composition,
        authorityBoundary: {
          ...base.composition.authorityBoundary,
          allowedActions: ['OBSERVE', 'EXECUTE'] as const,
          prohibitedActions: ['SPAWN'] as const,
          approvalRequiredActions: ['EXECUTE'] as const,
          executionAuthority: 'external-gateway-only' as const,
        },
      },
    };
    const version = createBodyVersion(draft);
    expect(version.composition.authorityBoundary.executionAuthority).toBe('external-gateway-only');
  });
});

describe('immutability of created versions (L3)', () => {
  it('rejects direct field mutation with TypeError', () => {
    const version = createBodyVersion(validDraft());
    expect(() => {
      (version as { certified: boolean }).certified = true;
    }).toThrow(TypeError);
    expect(() => {
      (version.composition.mission as { summary: string }).summary = 'hacked';
    }).toThrow(TypeError);
    expect(() => {
      (version.composition.capabilities as unknown as { push: (x: never) => void }).push('x' as never);
    }).toThrow(TypeError);
  });

  it('a persistent capability change requires a NEW version (copy, not edit)', () => {
    const v1 = createBodyVersion(validDraft());
    const v2Draft = {
      ...validDraft(),
      version: parseSemVer('1.1.0')!,
      parentId: v1.id,
    };
    const v2 = createBodyVersion(v2Draft);
    expect(v2.id).toBe('regime-researcher@1.1.0');
    expect(v2.parentId).toBe(v1.id);
    expect(v1.id).toBe('regime-researcher@1.0.0');
    expect(v2).not.toBe(v1);
  });
});

describe('certifyBodyVersion', () => {
  it('certifies a valid version into a new deeply frozen CertifiedBodyVersion', () => {
    const result = certifyBodyVersion(exampleBodyVersion, exampleCertificationEvidence);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const certified = result.certified;
    expect(certified.certified).toBe(true);
    expect(certified.certificationEvidence).toEqual(exampleCertificationEvidence);
    expect(isDeeplyFrozen(certified)).toBe(true);
    expect(isCertifiedBodyVersion(certified)).toBe(true);
  });

  it('never mutates the source version (certification produces a new record)', () => {
    const source = exampleBodyVersion;
    certifyBodyVersion(source, exampleCertificationEvidence);
    expect(source.certified).toBe(false);
    expect(source.certificationEvidence).toBeNull();
    expect(isCertifiedBodyVersion(source)).toBe(false);
  });

  it('refuses an already certified version', () => {
    const result = certifyBodyVersion(exampleCertifiedBodyVersion, exampleCertificationEvidence);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.map((v) => v.code)).toContain('already-certified');
  });

  it('refuses evidence without references', () => {
    const noEvidence = certifyBodyVersion(exampleBodyVersion, evidence({ evidenceRefs: [] }));
    expect(noEvidence.ok).toBe(false);
    if (noEvidence.ok) throw new Error('unreachable');
    expect(noEvidence.violations.map((v) => v.code)).toContain('missing-evidence');

    const noEvaluation = certifyBodyVersion(exampleBodyVersion, evidence({ evaluationRefs: [] }));
    expect(noEvaluation.ok).toBe(false);
    if (noEvaluation.ok) throw new Error('unreachable');
    expect(noEvaluation.violations.map((v) => v.code)).toContain('missing-evaluation-evidence');
  });

  it('refuses a manifest without tested substrates or without a passing test', () => {
    const untestedBase = validDraft();
    const untested = createBodyVersion({
      ...untestedBase,
      composition: {
        ...untestedBase.composition,
        substrateCompatibility: {
          ...untestedBase.composition.substrateCompatibility,
          testedSubstrates: [],
        },
      },
    });
    const resultA = certifyBodyVersion(untested, evidence());
    expect(resultA.ok).toBe(false);
    if (resultA.ok) throw new Error('unreachable');
    expect(resultA.violations.map((v) => v.code)).toContain('no-tested-substrates');

    const failingBase = validDraft();
    const failing = createBodyVersion({
      ...failingBase,
      composition: {
        ...failingBase.composition,
        substrateCompatibility: {
          ...failingBase.composition.substrateCompatibility,
          testedSubstrates: failingBase.composition.substrateCompatibility.testedSubstrates.map((r) => ({
            ...r,
            result: 'fail' as const,
          })),
        },
      },
    });
    const resultB = certifyBodyVersion(failing, evidence());
    expect(resultB.ok).toBe(false);
    if (resultB.ok) throw new Error('unreachable');
    expect(resultB.violations.map((v) => v.code)).toContain('no-passing-substrate-test');
  });

  it('refuses structurally invalid evidence', () => {
    const result = certifyBodyVersion(exampleBodyVersion, evidence({ certifiedBy: '' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.map((v) => v.code)).toContain('invalid-evidence');
  });
});

describe('certified-version freezing (L3 runtime guard)', () => {
  it('mutation attempts on the certified record throw TypeError', () => {
    const certified = exampleCertifiedBodyVersion;
    expect(() => {
      (certified as { certified: boolean }).certified = false;
    }).toThrow(TypeError);
    expect(() => {
      (certified as { certificationEvidence: unknown }).certificationEvidence = null;
    }).toThrow(TypeError);
    expect(() => {
      (certified.certificationEvidence as { certifiedBy: string }).certifiedBy = 'attacker';
    }).toThrow(TypeError);
    expect(() => {
      (certified.composition.capabilities as unknown as { push: (x: never) => void }).push('x' as never);
    }).toThrow(TypeError);
    expect(() => {
      (
        certified.composition.substrateCompatibility.testedSubstrates as unknown as {
          push: (x: never) => void;
        }
      ).push('x' as never);
    }).toThrow(TypeError);
  });

  it('the record is unchanged after every attempted mutation', () => {
    const certified = exampleCertifiedBodyVersion;
    expect(certified.certified).toBe(true);
    expect(certified.certificationEvidence.certifiedBy).toBe('tradrl-verification-service');
    expect(certified.composition.substrateCompatibility.testedSubstrates).toHaveLength(2);
    expect(isCertifiedBodyVersion(certified)).toBe(true);
  });

  it('isCertifiedBodyVersion rejects an unfrozen certified-shaped record', () => {
    const unfrozen = JSON.parse(JSON.stringify(exampleCertifiedBodyVersion)) as {
      certified: boolean;
    };
    expect(unfrozen.certified).toBe(true);
    expect(isCertifiedBodyVersion(unfrozen)).toBe(false); // not frozen
    const frozen = deepFreeze(unfrozen);
    expect(isCertifiedBodyVersion(frozen)).toBe(true);
  });
});

describe('adoptCertifiedBodyVersion (trusted ingestion)', () => {
  it('round-trips a certified version through JSON', () => {
    const parsed = JSON.parse(JSON.stringify(exampleCertifiedBodyVersion)) as unknown;
    const adopted = adoptCertifiedBodyVersion(parsed);
    expect(adopted.id).toBe(exampleCertifiedBodyVersion.id);
    expect(isCertifiedBodyVersion(adopted)).toBe(true);
    expect(adopted).toEqual(exampleCertifiedBodyVersion);
  });

  it('rejects uncertified shapes and invalid records', () => {
    expect(() => adoptCertifiedBodyVersion(JSON.parse(JSON.stringify(exampleBodyVersion)))).toThrow(TypeError);
    expect(() => adoptCertifiedBodyVersion({ certified: true })).toThrow(TypeError);
    expect(() => adoptCertifiedBodyVersion(null)).toThrow(TypeError);
  });
});

describe('guards and AgentBody', () => {
  it('isBodyVersion accepts certified and uncertified records', () => {
    expect(isBodyVersion(exampleBodyVersion)).toBe(true);
    expect(isBodyVersion(exampleCertifiedBodyVersion)).toBe(true);
    expect(isBodyVersion(null)).toBe(false);
    expect(isBodyVersion({ ...exampleBodyVersion, certified: 'yes' as unknown as boolean })).toBe(false);
    // certified flag and evidence must agree
    expect(
      isBodyVersion({ ...exampleBodyVersion, certified: true }),
    ).toBe(false);
  });

  it('createAgentBody builds and freezes the stable body identity', () => {
    const body = createAgentBody({
      id: exampleBody.id,
      name: 'Regime Researcher',
      description: 'desc',
      domain: 'research',
      createdAt: iso8601('2026-01-15T09:00:00Z'),
    });
    expect(isAgentBody(body)).toBe(true);
    expect(Object.isFrozen(body)).toBe(true);
    expect(() => createAgentBody({ ...body, name: '' })).toThrow(TypeError);
  });
});
