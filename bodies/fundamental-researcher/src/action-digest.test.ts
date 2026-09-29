// @tradrl/body-fundamental-researcher — the CorporateActionDigest tests.
//
// Behavioral: the golden digests validate under every law; creation
// derives ids and deep-freezes. Negative paths: implication off the
// declared action table, unknown action kinds, unsorted/duplicate
// instruments, count/evidence drift, evidence-less, future citations,
// tenant-less, tampered ids.

import { describe, expect, it } from 'vitest';
import {
  type CorporateActionDigest,
  createCorporateActionDigest,
  deriveCorporateActionDigestId,
  isActionWindow,
  isCorporateActionDigest,
  serializeCorporateActionDigest,
  validateCorporateActionDigest,
} from './action-digest';
import {
  FIXTURE_ACTION_DIGESTS,
  FIXTURE_REGISTRY,
  wrongImplicationActionDigestDraft,
} from './fixtures';
import { isDeeplyFrozen } from './primitives';
import { type TimestampMs } from './primitives';

const ms = (value: number): TimestampMs => value as TimestampMs;
const codesOf = (draft: unknown): readonly string[] =>
  validateCorporateActionDigest(draft, FIXTURE_REGISTRY).map((e) => e.code);

describe('the golden action digests', () => {
  it('validate cleanly under every law', () => {
    for (const digest of FIXTURE_ACTION_DIGESTS) {
      expect(validateCorporateActionDigest(digest, FIXTURE_REGISTRY)).toEqual([]);
      expect(isCorporateActionDigest(digest)).toBe(true);
    }
  });

  it('carry the declared implications from the action table (split neutral, dividend positive)', () => {
    const [split, dividend] = FIXTURE_ACTION_DIGESTS;
    expect(split?.action).toBe('split');
    expect(split?.implication).toBe('neutral');
    expect(dividend?.action).toBe('cash_dividend');
    expect(dividend?.implication).toBe('positive');
  });

  it('are deeply frozen with derived cad- ids', () => {
    for (const digest of FIXTURE_ACTION_DIGESTS) {
      expect(digest.digestId.startsWith('cad-')).toBe(true);
      expect(isDeeplyFrozen(digest)).toBe(true);
    }
  });

  it('serialize byte-deterministically', () => {
    expect(serializeCorporateActionDigest(FIXTURE_ACTION_DIGESTS[0] as never)).toBe(
      serializeCorporateActionDigest(FIXTURE_ACTION_DIGESTS[0] as never),
    );
  });
});

describe('guards', () => {
  it('isActionWindow accepts ordered bounds and rejects inverted ones', () => {
    expect(isActionWindow({ from: ms(1), to: ms(2) })).toBe(true);
    expect(isActionWindow({ from: ms(1), to: ms(1) })).toBe(true);
    expect(isActionWindow({ from: ms(2), to: ms(1) })).toBe(false);
    expect(isActionWindow({ from: 'x', to: ms(1) })).toBe(false);
  });
});

describe('creation', () => {
  it('creates a validated digest with a derived id', () => {
    const first = FIXTURE_ACTION_DIGESTS[0] as CorporateActionDigest;
    const { digestId: _ignored, ...material } = first;
    void _ignored;
    const created = createCorporateActionDigest(material, FIXTURE_REGISTRY);
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.digestId).toBe(first.digestId);
      expect(isDeeplyFrozen(created.value)).toBe(true);
    }
  });

  it('the derived id is a pure function of the canonical content', () => {
    const second = FIXTURE_ACTION_DIGESTS[1] as CorporateActionDigest;
    const { digestId: _ignored, ...material } = second;
    void _ignored;
    expect(deriveCorporateActionDigestId(material)).toBe(second.digestId);
  });
});

describe('THE NEGATIVE PATHS (every law, every typed error)', () => {
  it('an implication off the declared action table fails (implication_mismatch)', () => {
    expect(codesOf(wrongImplicationActionDigestDraft())).toContain('implication_mismatch');
  });

  it('an unknown action kind fails (unknown_action_kind)', () => {
    expect(codesOf({ ...FIXTURE_ACTION_DIGESTS[0], action: 'buyback' })).toContain('unknown_action_kind');
  });

  it('an unknown implication stance fails (unknown_stance_direction)', () => {
    expect(codesOf({ ...FIXTURE_ACTION_DIGESTS[0], implication: 'bullish' })).toContain('unknown_stance_direction');
  });

  it('unsorted or duplicate instruments fail', () => {
    const unsorted = { ...FIXTURE_ACTION_DIGESTS[0], instruments: ['TEST-ZZZ', 'TEST-AAA'] };
    expect(codesOf(unsorted).length).toBeGreaterThan(0);
    const duplicated = { ...FIXTURE_ACTION_DIGESTS[0], instruments: ['TEST-AAA', 'TEST-AAA'] };
    expect(codesOf(duplicated).length).toBeGreaterThan(0);
  });

  it('a count that disagrees with the evidence length fails (report_composition_mismatch)', () => {
    expect(codesOf({ ...FIXTURE_ACTION_DIGESTS[0], observationCount: 2 })).toContain('report_composition_mismatch');
  });

  it('an evidence-less digest fails (evidence_missing)', () => {
    expect(codesOf({ ...FIXTURE_ACTION_DIGESTS[0], evidence: [] })).toContain('evidence_missing');
  });

  it('a future citation fails (future_evidence)', () => {
    const draft = {
      ...FIXTURE_ACTION_DIGESTS[0],
      evidence: [
        ...(FIXTURE_ACTION_DIGESTS[0] as { evidence: readonly unknown[] }).evidence,
        { observationId: 'obs-future-999', availableTime: ms(1_717_423_200_000 + 70_000), provenance: (FIXTURE_ACTION_DIGESTS[0] as { evidence: readonly { provenance: unknown }[] }).evidence[0]!.provenance },
      ],
    };
    expect(codesOf(draft)).toContain('future_evidence');
  });

  it('missing tenant/project fails (tenant_missing, project_missing)', () => {
    const codes = codesOf({ ...FIXTURE_ACTION_DIGESTS[0], tenantId: '', projectId: '' });
    expect(codes).toContain('tenant_missing');
    expect(codes).toContain('project_missing');
  });

  it('a tampered id fails (digest_mismatch)', () => {
    const tampered = { ...FIXTURE_ACTION_DIGESTS[0], digestId: `cad-${'f'.repeat(16)}` };
    expect(codesOf(tampered)).toContain('digest_mismatch');
  });

  it('an inverted window fails', () => {
    const inverted = { ...FIXTURE_ACTION_DIGESTS[0], window: { from: ms(2_000_000_000_000), to: ms(1_000_000_000_000) } };
    expect(codesOf(inverted).length).toBeGreaterThan(0);
  });

  it('an undeclared digestion method fails (undeclared_method)', () => {
    expect(codesOf({ ...FIXTURE_ACTION_DIGESTS[0], methodId: 'method/fundamental/magic' })).toContain('undeclared_method');
  });
});
