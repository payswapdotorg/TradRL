import { describe, expect, it } from 'vitest';
import {
  type SubstrateDraft,
  createSubstrate,
  isCognitiveSubstrate,
  isModality,
  isSubstrateCapabilityManifest,
  isSubstrateCostLatencyProfile,
} from './substrate';
import { deepFreeze, substitutionClass } from './primitives';
import { exampleIncompatibleSubstrate, exampleSubstituteSubstrate, exampleSubstrate } from './examples';

function validDraft(): SubstrateDraft {
  return {
    provider: 'acme-models',
    modelId: 'reasoner-2',
    modelVersion: '2026.03',
    capabilities: {
      contextWindowTokens: 256000,
      maxOutputTokens: 32768,
      inputModalities: ['text'],
      outputModalities: ['text'],
      toolUse: true,
      structuredOutput: true,
    },
    costLatency: {
      currency: 'USD',
      inputCostPerMTokens: 12,
      outputCostPerMTokens: 48,
      p50LatencyMs: 800,
      p95LatencyMs: 2400,
    },
    substitutionClass: substitutionClass('frontier-reasoner'),
  };
}

describe('createSubstrate', () => {
  it('derives the canonical id from provider/modelId/modelVersion', () => {
    const substrate = createSubstrate(validDraft());
    expect(substrate.id).toBe('acme-models/reasoner-2@2026.03');
    expect(substrate.provider).toBe('acme-models');
    expect(substrate.modelId).toBe('reasoner-2');
    expect(substrate.modelVersion).toBe('2026.03');
  });

  it('returns a deeply frozen record', () => {
    const substrate = createSubstrate(validDraft());
    expect(Object.isFrozen(substrate)).toBe(true);
    expect(Object.isFrozen(substrate.capabilities)).toBe(true);
  });

  it('rejects invalid inputs with field-prefixed TypeErrors', () => {
    const cases: Array<[string, (draft: SubstrateDraft) => SubstrateDraft]> = [
      ['provider', (d) => ({ ...d, provider: '' })],
      ['modelId', (d) => ({ ...d, modelId: 'has space' })],
      ['modelVersion', (d) => ({ ...d, modelVersion: 'a/b' })],
      ['capabilities', (d) => ({ ...d, capabilities: { ...d.capabilities, contextWindowTokens: 0 } })],
      ['capabilities', (d) => ({ ...d, capabilities: { ...d.capabilities, maxOutputTokens: -1 } })],
      ['capabilities', (d) => ({ ...d, capabilities: { ...d.capabilities, inputModalities: [] } })],
      ['capabilities', (d) => ({ ...d, capabilities: { ...d.capabilities, toolUse: 'yes' as unknown as boolean } })],
      ['costLatency', (d) => ({ ...d, costLatency: { ...d.costLatency, inputCostPerMTokens: -5 } })],
      ['costLatency', (d) => ({ ...d, costLatency: { ...d.costLatency, p95LatencyMs: 100 } })],
    ];
    for (const [field, mutate] of cases) {
      try {
        createSubstrate(mutate(validDraft()));
        throw new Error(`expected createSubstrate to reject invalid ${field}`);
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
        expect((error as TypeError).message).toContain(field);
      }
    }
  });

  it('rejects an invalid substitution class', () => {
    const draft = { ...validDraft(), substitutionClass: '' as unknown as ReturnType<typeof substitutionClass> };
    expect(() => createSubstrate(draft)).toThrow(/substitutionClass/);
  });

  it('rejects duplicate modalities', () => {
    const draft = {
      ...validDraft(),
      capabilities: { ...validDraft().capabilities, inputModalities: ['text', 'text'] as readonly ('text')[] },
    };
    expect(() => createSubstrate(draft)).toThrow(/inputModalities/);
  });

  it('rejects non-finite numbers', () => {
    const draft = {
      ...validDraft(),
      capabilities: { ...validDraft().capabilities, contextWindowTokens: Number.NaN },
    };
    expect(() => createSubstrate(draft)).toThrow(TypeError);
  });
});

describe('guards', () => {
  it('isCognitiveSubstrate accepts constructed substrates and rejects noise', () => {
    expect(isCognitiveSubstrate(exampleSubstrate)).toBe(true);
    expect(isCognitiveSubstrate(exampleSubstituteSubstrate)).toBe(true);
    expect(isCognitiveSubstrate(exampleIncompatibleSubstrate)).toBe(true);
    expect(isCognitiveSubstrate(null)).toBe(false);
    expect(isCognitiveSubstrate({})).toBe(false);
    expect(isCognitiveSubstrate('substrate')).toBe(false);
    expect(isCognitiveSubstrate({ ...exampleSubstrate, costLatency: undefined })).toBe(false);
    expect(
      isCognitiveSubstrate({
        ...exampleSubstrate,
        capabilities: { ...exampleSubstrate.capabilities, structuredOutput: 'no' as unknown as boolean },
      }),
    ).toBe(false);
  });

  it('isModality rejects unknown modalities', () => {
    expect(isModality('text')).toBe(true);
    expect(isModality('image')).toBe(true);
    expect(isModality('audio')).toBe(true);
    expect(isModality('video')).toBe(true);
    expect(isModality('smell')).toBe(false);
    expect(isModality(7)).toBe(false);
  });

  it('isSubstrateCapabilityManifest / isSubstrateCostLatencyProfile', () => {
    expect(isSubstrateCapabilityManifest(exampleSubstrate.capabilities)).toBe(true);
    expect(
      isSubstrateCapabilityManifest({ ...exampleSubstrate.capabilities, contextWindowTokens: 1.5 }),
    ).toBe(false);
    expect(isSubstrateCostLatencyProfile(exampleSubstrate.costLatency)).toBe(true);
    expect(isSubstrateCostLatencyProfile({ ...exampleSubstrate.costLatency, currency: '' })).toBe(false);
    expect(isSubstrateCostLatencyProfile({ ...exampleSubstrate.costLatency, p95LatencyMs: Number.NaN })).toBe(false);
  });
});

describe('immutability', () => {
  it('constructed substrates reject mutation', () => {
    const substrate = createSubstrate(validDraft());
    expect(() => {
      (substrate as { provider: string }).provider = 'other';
    }).toThrow(TypeError);
    expect(() => {
      (substrate.capabilities as { contextWindowTokens: number }).contextWindowTokens = 1;
    }).toThrow(TypeError);
  });

  it('guards survive JSON round-trips (frozen or not)', () => {
    const roundTripped = JSON.parse(JSON.stringify(exampleSubstrate)) as unknown;
    expect(isCognitiveSubstrate(roundTripped)).toBe(true);
    expect(isCognitiveSubstrate(deepFreeze(roundTripped))).toBe(true);
  });
});
