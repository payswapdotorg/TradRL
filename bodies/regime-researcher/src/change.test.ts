// @tradrl/body-regime-researcher — the regime change tests.

import { describe, expect, it } from 'vitest';

import {
  createRegimeChange,
  deriveRegimeChangeId,
  isRegimeChange,
  serializeRegimeChange,
  validateRegimeChange,
} from './change';
import {
  FIXTURE_CHANGE,
  FIXTURE_REGISTRY,
  futureDetectionChangeDraft,
  identicalLabelsChangeDraft,
  misorderedWindowsChangeDraft,
} from './fixtures';
import { REGIME_METHOD_REGISTRY } from './methods';
import { isDeeplyFrozen } from './primitives';

const codesOf = (errors: readonly { code: string }[]): readonly string[] => errors.map((e) => e.code);

describe('the golden change (ranging -> trending-up)', () => {
  it('validates cleanly and is deeply frozen', () => {
    expect(validateRegimeChange(FIXTURE_CHANGE, REGIME_METHOD_REGISTRY)).toEqual([]);
    expect(isRegimeChange(FIXTURE_CHANGE)).toBe(true);
    expect(isDeeplyFrozen(FIXTURE_CHANGE)).toBe(true);
  });

  it('survives a JSON round trip', () => {
    const round = JSON.parse(JSON.stringify(FIXTURE_CHANGE));
    expect(validateRegimeChange(round, REGIME_METHOD_REGISTRY)).toEqual([]);
  });

  it('carries both windows and the full evidence of both', () => {
    expect(FIXTURE_CHANGE.fromLabel).toBe('ranging');
    expect(FIXTURE_CHANGE.toLabel).toBe('trending-up');
    expect(FIXTURE_CHANGE.evidence.length).toBe(8);
    expect(FIXTURE_CHANGE.fromWindow.to).toBeLessThan(FIXTURE_CHANGE.toWindow.from);
    expect(FIXTURE_CHANGE.detectionInstant).toBe(FIXTURE_CHANGE.toWindow.to);
    expect(FIXTURE_CHANGE.changeId).toMatch(/^rx-[0-9a-f]{16}$/);
  });
});

describe('THE NEGATIVE LAWS (each violation is a typed error)', () => {
  it('an evidence-less change fails (evidence_missing)', () => {
    const errors = validateRegimeChange({ ...FIXTURE_CHANGE, evidence: [], changeId: 'rx-x' }, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('evidence_missing');
  });

  it('a future citation fails (future_evidence — L4)', () => {
    const draft = {
      ...FIXTURE_CHANGE,
      evidence: [
        ...FIXTURE_CHANGE.evidence,
        { observationId: 'obs-future-999', availableTime: FIXTURE_CHANGE.asOf + 5_000, provenance: FIXTURE_CHANGE.evidence[0]!.provenance },
      ],
      changeId: 'rx-x',
    };
    const errors = validateRegimeChange(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('future_evidence');
  });

  it('a detection instant after the as-of fails (future_evidence)', () => {
    const errors = validateRegimeChange({ ...futureDetectionChangeDraft(), changeId: 'rx-x' }, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('future_evidence');
  });

  it('a detection instant before the to-window closes fails (timestamp_order)', () => {
    const draft = { ...FIXTURE_CHANGE, detectionInstant: FIXTURE_CHANGE.toWindow.from, changeId: 'rx-x' };
    const errors = validateRegimeChange(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('timestamp_order');
  });

  it('identical labels are not a transition (regime_label_mismatch)', () => {
    const errors = validateRegimeChange({ ...identicalLabelsChangeDraft(), changeId: 'rx-x' }, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('regime_label_mismatch');
  });

  it('a label outside the linked taxonomy fails (regime_label_mismatch)', () => {
    const draft = { ...FIXTURE_CHANGE, toLabel: 'bull-mode', changeId: 'rx-x' };
    const errors = validateRegimeChange(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('regime_label_mismatch');
  });

  it('a to-window that precedes the from-window fails (timestamp_order)', () => {
    const errors = validateRegimeChange({ ...misorderedWindowsChangeDraft(), changeId: 'rx-x' }, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('timestamp_order');
  });

  it('an undeclared change-detection method fails', () => {
    const draft = { ...FIXTURE_CHANGE, methodId: 'method/regime/magic-change', changeId: 'rx-x' };
    const errors = validateRegimeChange(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('undeclared_method');
  });

  it('missing tenant/project fail (tenant_missing/project_missing)', () => {
    const draft = { ...FIXTURE_CHANGE, tenantId: '', projectId: '', changeId: 'rx-x' };
    const errors = validateRegimeChange(draft, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('tenant_missing');
    expect(codesOf(errors)).toContain('project_missing');
  });

  it('a tampered change id fails (digest_mismatch)', () => {
    const tampered = { ...FIXTURE_CHANGE, seed: 'seed/tampered' };
    const errors = validateRegimeChange(tampered, FIXTURE_REGISTRY);
    expect(codesOf(errors)).toContain('digest_mismatch');
  });
});

describe('construction + determinism', () => {
  it('refuses to construct a law-violating draft', () => {
    const result = createRegimeChange(identicalLabelsChangeDraft(), FIXTURE_REGISTRY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codesOf(result.errors)).toContain('regime_label_mismatch');
  });

  it('the same draft constructs a byte-identical change twice', () => {
    const { changeId: _a, ...draftA } = FIXTURE_CHANGE;
    const { changeId: _b, ...draftB } = JSON.parse(JSON.stringify(FIXTURE_CHANGE));
    void _a; void _b;
    const once = createRegimeChange(draftA, FIXTURE_REGISTRY);
    const twice = createRegimeChange(draftB, FIXTURE_REGISTRY);
    expect(once.ok).toBe(true);
    expect(twice.ok).toBe(true);
    if (once.ok && twice.ok) {
      expect(once.value).toEqual(twice.value);
      expect(serializeRegimeChange(once.value)).toBe(serializeRegimeChange(twice.value));
    }
  });

  it('the derived id is a pure function of the canonical material', () => {
    const { changeId: _ignored, ...material } = FIXTURE_CHANGE;
    void _ignored;
    expect(deriveRegimeChangeId(material)).toBe(FIXTURE_CHANGE.changeId);
  });

  it('garbage input is typed refusal, never a throw', () => {
    for (const bad of [null, 7, [], {}]) {
      expect(validateRegimeChange(bad, FIXTURE_REGISTRY).length).toBeGreaterThan(0);
    }
  });
});
