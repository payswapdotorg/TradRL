import { describe, expect, it } from 'vitest';
import {
  COMPATIBILITY_CHECK_CODES,
  type CompatibilityVerdict,
  type SubstrateCompatibilityManifest,
  evaluateSubstrateCompatibility,
  findTestedSubstrate,
  hasPassingSubstitutionTest,
  isCompatibilityVerdict,
  isSubstrateCompatibilityManifest,
  substrateSatisfiesManifest,
} from './compatibility';
import { type CognitiveSubstrate, createSubstrate } from './substrate';
import { evidenceRef, iso8601, substitutionClass } from './primitives';
import {
  exampleCompatibilityManifest,
  exampleIncompatibleSubstrate,
  exampleSubstituteSubstrate,
  exampleSubstrate,
} from './examples';

function substrate(overrides: {
  context?: number;
  output?: number;
  toolUse?: boolean;
  structured?: boolean;
  inputModalities?: readonly ('text' | 'image' | 'audio' | 'video')[];
  class?: string;
  inputCost?: number;
  outputCost?: number;
  p95?: number;
}): CognitiveSubstrate {
  return createSubstrate({
    provider: 'test-provider',
    modelId: 'test-model',
    modelVersion: '1',
    capabilities: {
      contextWindowTokens: overrides.context ?? 256000,
      maxOutputTokens: overrides.output ?? 32768,
      inputModalities: overrides.inputModalities ?? ['text'],
      outputModalities: ['text'],
      toolUse: overrides.toolUse ?? true,
      structuredOutput: overrides.structured ?? true,
    },
    costLatency: {
      currency: 'USD',
      inputCostPerMTokens: overrides.inputCost ?? 10,
      outputCostPerMTokens: overrides.outputCost ?? 40,
      p50LatencyMs: 800,
      p95LatencyMs: overrides.p95 ?? 2400,
    },
    substitutionClass: substitutionClass(overrides.class ?? 'frontier-reasoner'),
  });
}

function manifest(mutate?: (m: SubstrateCompatibilityManifest) => SubstrateCompatibilityManifest): SubstrateCompatibilityManifest {
  const base: SubstrateCompatibilityManifest = {
    requirements: {
      minContextWindowTokens: 128000,
      minMaxOutputTokens: 4096,
      requiredInputModalities: ['text'],
      requiredOutputModalities: ['text'],
      toolUse: 'required',
      structuredOutput: 'required',
    },
    constraints: {
      allowedSubstitutionClasses: null,
      maxInputCostPerMTokens: null,
      maxOutputCostPerMTokens: null,
      maxP95LatencyMs: null,
    },
    testedSubstrates: [],
  };
  return mutate === undefined ? base : mutate(base);
}

describe('evaluateSubstrateCompatibility — satisfied verdicts', () => {
  it('returns satisfied with all ten checks passing', () => {
    const verdict = evaluateSubstrateCompatibility(manifest(), substrate({}));
    expect(verdict.satisfied).toBe(true);
    expect(verdict.violations).toEqual([]);
    expect(verdict.checks).toHaveLength(COMPATIBILITY_CHECK_CODES.length);
    expect(verdict.checks.map((c) => c.code)).toEqual([...COMPATIBILITY_CHECK_CODES]);
    expect(verdict.checks.every((c) => c.satisfied)).toBe(true);
  });

  it('accepts the canonical example substrate against the example manifest', () => {
    const verdict = evaluateSubstrateCompatibility(exampleCompatibilityManifest, exampleSubstrate);
    expect(verdict.satisfied).toBe(true);
  });

  it('accepts the substitute substrate (model substitution — L2 body/model separation)', () => {
    const verdict = evaluateSubstrateCompatibility(exampleCompatibilityManifest, exampleSubstituteSubstrate);
    expect(verdict.satisfied).toBe(true);
  });

  it('null constraints are unconstrained', () => {
    const verdict = evaluateSubstrateCompatibility(
      manifest(),
      substrate({ class: 'any-other-class', inputCost: 9999, p95: 999999 }),
    );
    expect(verdict.satisfied).toBe(true);
  });

  it('optional requirements impose no constraint when the substrate lacks them', () => {
    const optional = manifest((m) => ({
      ...m,
      requirements: { ...m.requirements, toolUse: 'optional', structuredOutput: 'optional' },
    }));
    const verdict = evaluateSubstrateCompatibility(optional, substrate({ toolUse: false, structured: false }));
    expect(verdict.satisfied).toBe(true);
  });
});

describe('evaluateSubstrateCompatibility — violated verdicts with reasons', () => {
  it('flags an insufficient context window', () => {
    const verdict = evaluateSubstrateCompatibility(manifest(), substrate({ context: 64000 }));
    expect(verdict.satisfied).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toEqual(['context-window']);
    expect(verdict.violations[0]?.message).toContain('context window');
  });

  it('flags an insufficient output budget', () => {
    const verdict = evaluateSubstrateCompatibility(manifest(), substrate({ output: 2048 }));
    expect(verdict.violations.map((v) => v.code)).toEqual(['output-tokens']);
  });

  it('flags missing input modality', () => {
    const multimodal = manifest((m) => ({
      ...m,
      requirements: { ...m.requirements, requiredInputModalities: ['text', 'image'] },
    }));
    const verdict = evaluateSubstrateCompatibility(multimodal, substrate({}));
    expect(verdict.violations.map((v) => v.code)).toEqual(['input-modalities']);
    expect(verdict.violations[0]?.message).toContain('image');
  });

  it('flags missing output modality', () => {
    const needsStructured = manifest((m) => ({
      ...m,
      requirements: { ...m.requirements, requiredOutputModalities: ['text', 'image'] },
    }));
    const verdict = evaluateSubstrateCompatibility(needsStructured, substrate({}));
    expect(verdict.violations.map((v) => v.code)).toEqual(['output-modalities']);
  });

  it('flags tool use required but unsupported', () => {
    const verdict = evaluateSubstrateCompatibility(manifest(), substrate({ toolUse: false }));
    expect(verdict.violations.map((v) => v.code)).toEqual(['tool-use']);
  });

  it('flags structured output required but unsupported', () => {
    const verdict = evaluateSubstrateCompatibility(manifest(), substrate({ structured: false }));
    expect(verdict.violations.map((v) => v.code)).toEqual(['structured-output']);
  });

  it('flags a substitution class outside the allow-list', () => {
    const constrained = manifest((m) => ({
      ...m,
      constraints: { ...m.constraints, allowedSubstitutionClasses: [substitutionClass('frontier-reasoner')] },
    }));
    const verdict = evaluateSubstrateCompatibility(constrained, substrate({ class: 'edge-small' }));
    expect(verdict.violations.map((v) => v.code)).toEqual(['substitution-class']);
    expect(verdict.violations[0]?.expected).toContain('frontier-reasoner');
  });

  it('flags input cost above the ceiling', () => {
    const constrained = manifest((m) => ({
      ...m,
      constraints: { ...m.constraints, maxInputCostPerMTokens: 5 },
    }));
    const verdict = evaluateSubstrateCompatibility(constrained, substrate({ inputCost: 10 }));
    expect(verdict.violations.map((v) => v.code)).toEqual(['input-cost']);
  });

  it('flags output cost above the ceiling', () => {
    const constrained = manifest((m) => ({
      ...m,
      constraints: { ...m.constraints, maxOutputCostPerMTokens: 20 },
    }));
    const verdict = evaluateSubstrateCompatibility(constrained, substrate({ outputCost: 40 }));
    expect(verdict.violations.map((v) => v.code)).toEqual(['output-cost']);
  });

  it('flags p95 latency above the ceiling', () => {
    const constrained = manifest((m) => ({
      ...m,
      constraints: { ...m.constraints, maxP95LatencyMs: 1000 },
    }));
    const verdict = evaluateSubstrateCompatibility(constrained, substrate({ p95: 2400 }));
    expect(verdict.violations.map((v) => v.code)).toEqual(['p95-latency']);
  });

  it('accumulates multiple violations in the fixed check order', () => {
    const verdict = evaluateSubstrateCompatibility(manifest(), exampleIncompatibleSubstrate);
    expect(verdict.satisfied).toBe(false);
    expect(verdict.violations.map((v) => v.code)).toEqual([
      'context-window',
      'output-tokens',
      'tool-use',
      'structured-output',
    ]);
  });

  it('every violation carries expected, actual and a human message', () => {
    const verdict = evaluateSubstrateCompatibility(manifest(), substrate({ context: 1 }));
    const violation = verdict.violations[0];
    expect(violation).toBeDefined();
    expect(violation?.expected).toContain('128000');
    expect(violation?.actual).toContain('1');
    expect(violation?.message.length).toBeGreaterThan(10);
  });

  it('checks array always reports all ten dimensions, pass and fail', () => {
    const verdict = evaluateSubstrateCompatibility(manifest(), exampleIncompatibleSubstrate);
    expect(verdict.checks).toHaveLength(10);
    const failed = new Set(verdict.violations.map((v) => v.code));
    for (const check of verdict.checks) {
      expect(check.satisfied).toBe(!failed.has(check.code));
    }
  });
});

describe('convenience wrappers and guards', () => {
  it('substrateSatisfiesManifest is a boolean projection of the verdict', () => {
    expect(substrateSatisfiesManifest(manifest(), substrate({}))).toBe(true);
    expect(substrateSatisfiesManifest(manifest(), substrate({ toolUse: false }))).toBe(false);
  });

  it('isCompatibilityVerdict validates verdict shape and the satisfied⟹empty invariant', () => {
    const good = evaluateSubstrateCompatibility(manifest(), substrate({}));
    expect(isCompatibilityVerdict(good)).toBe(true);
    expect(isCompatibilityVerdict({ ...good, violations: [] })).toBe(true);
    const bad = evaluateSubstrateCompatibility(manifest(), substrate({ toolUse: false }));
    expect(isCompatibilityVerdict(bad)).toBe(true);
    expect(isCompatibilityVerdict(null)).toBe(false);
    expect(isCompatibilityVerdict('satisfied')).toBe(false);
  });

  it('isSubstrateCompatibilityManifest guards manifests', () => {
    expect(isSubstrateCompatibilityManifest(exampleCompatibilityManifest)).toBe(true);
    expect(isSubstrateCompatibilityManifest({ ...exampleCompatibilityManifest, requirements: null })).toBe(false);
    expect(isSubstrateCompatibilityManifest({ ...exampleCompatibilityManifest, testedSubstrates: 'none' })).toBe(false);
  });
});

describe('tested-substrate records', () => {
  it('findTestedSubstrate returns the latest record for a substrate', () => {
    const withHistory: SubstrateCompatibilityManifest = {
      ...exampleCompatibilityManifest,
      testedSubstrates: [
        {
          substrate: exampleSubstrate.id,
          result: 'conditional',
          testedAt: iso8601('2026-02-01T00:00:00Z'),
          evidence: evidenceRef('evidence/old'),
          notes: 'earlier conditional result',
        },
        ...exampleCompatibilityManifest.testedSubstrates,
      ],
    };
    const found = findTestedSubstrate(withHistory, exampleSubstrate.id);
    expect(found?.result).toBe('pass');
    expect(found?.evidence).toBe('evidence/regime-researcher@1.0.0/substitution/acme-reasoner-2');
  });

  it('findTestedSubstrate returns null for untested substrates', () => {
    expect(findTestedSubstrate(exampleCompatibilityManifest, exampleIncompatibleSubstrate.id)).toBeNull();
  });

  it('hasPassingSubstitutionTest is strict about pass results', () => {
    expect(hasPassingSubstitutionTest(exampleCompatibilityManifest, exampleSubstrate)).toBe(true);
    expect(hasPassingSubstitutionTest(exampleCompatibilityManifest, exampleSubstituteSubstrate)).toBe(false); // conditional, not pass
    expect(hasPassingSubstitutionTest(exampleCompatibilityManifest, exampleIncompatibleSubstrate)).toBe(false);
  });
});
