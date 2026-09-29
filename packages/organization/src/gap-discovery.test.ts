// @tradrl/organization — capability-gap + discovery-loop behavioral tests.
//
// Laws under test:
// - LEARNING-LOOP "Failure-driven learning": "Failures create typed
//   CapabilityGaps such as regime, sentiment/event, liquidity, execution,
//   risk or coordination failure" — the six failure classes, structured
//   records, no free text.
// - CAPABILITY-DISCOVERY "Discovery loop": the ten steps as a closed
//   discriminated union with sequence-ordering laws (deficit first;
//   generate before benchmark; benchmark before disposition; one
//   disposition per subject; new-body-spec-required only after
//   characterization).

import { describe, expect, it } from 'vitest';
import {
  type CapabilityGap,
  type DiscoveryStep,
  type TimestampMs,
  CAPABILITY_GAP_KINDS,
  DISCOVERY_STEP_KINDS,
  attainmentEvidenceRef,
  capabilityGapId,
  capabilityKey,
  capabilityRecordId,
  createCapabilityGap,
  createDiscoveryStep,
  isCapabilityGap,
  isDiscoveryStep,
  validateDiscoverySequence,
} from './index';

const gap: CapabilityGap = createCapabilityGap({
  gapId: capabilityGapId('gap.regime-alpha.math-reasoning'),
  kind: 'regime',
  capabilityKey: capabilityKey('mathematical-reasoning'),
  evidenceRef: attainmentEvidenceRef('evidence/failure/atlas-run-41'),
  detectedAt: 1_772_500_000_000 as TimestampMs,
  tenantId: 'tenant-atlas',
  projectId: 'project/atlas/regime-alpha',
});

describe('capability gaps (failure-driven learning)', () => {
  it('the kind vocabulary is the six LEARNING-LOOP failure classes, verbatim', () => {
    expect([...CAPABILITY_GAP_KINDS]).toEqual([
      'regime',
      'sentiment-event',
      'liquidity',
      'execution',
      'risk',
      'coordination',
    ]);
  });

  it('the fixture gap passes its guard and is deeply frozen', () => {
    expect(isCapabilityGap(gap)).toBe(true);
    expect(Object.isFrozen(gap)).toBe(true);
    expect(() => {
      (gap as unknown as { kind: string }).kind = 'vibes';
    }).toThrow();
  });

  it('gaps survive a JSON round-trip', () => {
    expect(isCapabilityGap(JSON.parse(JSON.stringify(gap)))).toBe(true);
  });

  it('invalid kinds, keys and scopes are rejected (collect-all TypeError)', () => {
    expect(() =>
      createCapabilityGap({ ...gap, kind: 'existential' as never }),
    ).toThrow(/kind: must be one of/);
    expect(() => createCapabilityGap({ ...gap, gapId: 'not a valid id!' as never })).toThrow(/gapId/);
    expect(() => createCapabilityGap({ ...gap, capabilityKey: 'not a valid key!' as never })).toThrow(/capabilityKey.*L16a/);
    expect(() => createCapabilityGap({ ...gap, tenantId: '' })).toThrow(/tenantId/);
    expect(() => createCapabilityGap({ ...gap, projectId: '' })).toThrow(/projectId/);
    expect(() => createCapabilityGap({ ...gap, detectedAt: -1 as TimestampMs })).toThrow(/detectedAt/);
  });

  it('gap guards reject non-records', () => {
    expect(isCapabilityGap(null)).toBe(false);
    expect(isCapabilityGap('gap')).toBe(false);
    expect(isCapabilityGap(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Discovery sequence fixtures
// ---------------------------------------------------------------------------

const characterized: DiscoveryStep = createDiscoveryStep({
  step: 'capability-contract-characterized',
  capabilityKeys: [capabilityKey('mathematical-reasoning')],
  benchmarkRefs: ['bench/olympiad-mix-v3'],
});

const generated: DiscoveryStep = createDiscoveryStep({
  step: 'candidates-generated',
  subjectRefs: [
    { kind: 'body-version', bodyVersionRef: 'math-researcher@1.0.0' },
    { kind: 'cognitive-substrate', substrateRef: 'limite-labs/limite-math@2026.01' },
  ],
});

const benchmarked: DiscoveryStep = createDiscoveryStep({
  step: 'candidates-benchmarked',
  benchmarkRefs: ['bench/olympiad-mix-v3'],
  resultRefs: ['result/bench/olympiad-mix-v3/math-researcher@1.0.0', 'result/bench/olympiad-mix-v3/limite-math@2026.01'],
});

const retained: DiscoveryStep = createDiscoveryStep({
  step: 'candidate-retained',
  subject: { kind: 'body-version', bodyVersionRef: 'math-researcher@1.0.0' },
  capabilityRecordRefs: [capabilityRecordId('capreg-body-mathresearcher-0001')],
});

const rejected: DiscoveryStep = createDiscoveryStep({
  step: 'candidate-rejected',
  subject: { kind: 'cognitive-substrate', substrateRef: 'limite-labs/limite-math@2026.01' },
  reason: 'not-selected',
});

const validSequence: readonly DiscoveryStep[] = [
  { step: 'deficit-detected', gap },
  characterized,
  generated,
  benchmarked,
  retained,
  rejected,
];

describe('discovery steps (the ten-step loop as typed records)', () => {
  it('the step vocabulary covers the loop (deficit -> characterize -> generate -> benchmark -> disposition + level-3)', () => {
    expect([...DISCOVERY_STEP_KINDS]).toEqual([
      'deficit-detected',
      'capability-contract-characterized',
      'candidates-generated',
      'candidates-benchmarked',
      'candidate-retained',
      'candidate-rejected',
      'new-body-spec-required',
    ]);
  });

  it('the fixture steps pass the closed-union guard', () => {
    for (const step of validSequence) expect(isDiscoveryStep(step)).toBe(true);
  });

  it('the valid sequence validates (deficit-first, ordered, single disposition per subject)', () => {
    const result = validateDiscoverySequence(validSequence);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('steps are deeply frozen by the factory', () => {
    expect(Object.isFrozen(retained)).toBe(true);
  });

  it('an empty sequence is valid (a search with no discovery emission)', () => {
    expect(validateDiscoverySequence([]).ok).toBe(true);
  });
});

describe('discovery ordering laws (negative paths)', () => {
  it('a sequence not starting with deficit-detected is invalid (deficit-driven loop)', () => {
    const result = validateDiscoverySequence([characterized, generated, benchmarked, retained]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toContain('deficit-detected');
    }
  });

  it('dispositions before generation are invalid', () => {
    const result = validateDiscoverySequence([
      { step: 'deficit-detected', gap },
      retained,
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('candidates-generated'))).toBe(true);
    }
  });

  it('dispositions before benchmarking are invalid (benchmark precedes retention)', () => {
    const result = validateDiscoverySequence([
      { step: 'deficit-detected', gap },
      characterized,
      generated,
      retained,
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('candidates-benchmarked'))).toBe(true);
    }
  });

  it('double-dispositioning one subject is invalid (retained XOR rejected)', () => {
    const result = validateDiscoverySequence([
      { step: 'deficit-detected', gap },
      characterized,
      generated,
      benchmarked,
      retained,
      {
        step: 'candidate-rejected',
        subject: { kind: 'body-version', bodyVersionRef: 'math-researcher@1.0.0' },
        reason: 'not-selected',
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('dispositioned more than once'))).toBe(true);
    }
  });

  it('new-body-spec-required before characterization is invalid (level 3 characterizes first)', () => {
    const result = validateDiscoverySequence([
      { step: 'deficit-detected', gap },
      { step: 'new-body-spec-required', capabilityKeys: ['mathematical-reasoning'], benchmarkRefs: [] },
    ]);
    expect(result.ok).toBe(false);
  });

  it('new-body-spec-required naming an uncharacterized capability is invalid', () => {
    const result = validateDiscoverySequence([
      { step: 'deficit-detected', gap },
      characterized,
      { step: 'new-body-spec-required', capabilityKeys: [capabilityKey('sentiment-event-analysis')], benchmarkRefs: [] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('never characterized'))).toBe(true);
    }
  });

  it('structural failures inside steps are collected, not thrown', () => {
    const result = validateDiscoverySequence([{ step: 'deficit-detected', gap: 'not a gap' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('invalid_field');
    }
    expect(validateDiscoverySequence('nope' as never).ok).toBe(false);
  });

  it('retained candidates must cite capability records (measured evidence, L16a)', () => {
    expect(
      isDiscoveryStep({
        step: 'candidate-retained',
        subject: { kind: 'body-version', bodyVersionRef: 'math-researcher@1.0.0' },
        capabilityRecordRefs: [],
      }),
    ).toBe(false);
    expect(
      isDiscoveryStep({
        step: 'candidate-retained',
        subject: { kind: 'body-version', bodyVersionRef: 'math-researcher@1.0.0' },
        capabilityRecordRefs: [capabilityRecordId('capreg-body-mathresearcher-0001')],
      }),
    ).toBe(true);
  });
});
