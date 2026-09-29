// @tradrl/body-sentiment-researcher — the event digest tests.

import { describe, expect, it } from 'vitest';

import { createEventDigest, deriveEventDigestId, isEventDigest, serializeEventDigest, validateEventDigest } from './digest';
import { canonicalJson, deepFreeze, isDeeplyFrozen } from './primitives';
import { FIXTURE_DIGEST, FIXTURE_REGISTRY, FIXTURE_SENTIMENT_CITATIONS } from './fixtures';

const codesOf = (v: unknown): readonly string[] =>
  validateEventDigest(v, FIXTURE_REGISTRY).map((e) => e.code);

describe('the golden digest', () => {
  it('validates cleanly and is deeply frozen', () => {
    expect(validateEventDigest(FIXTURE_DIGEST, FIXTURE_REGISTRY)).toEqual([]);
    expect(isEventDigest(FIXTURE_DIGEST)).toBe(true);
    expect(isDeeplyFrozen(FIXTURE_DIGEST)).toBe(true);
    expect(FIXTURE_DIGEST.digestId).toMatch(/^ed-[0-9a-f]{16}$/);
    expect(FIXTURE_DIGEST.kind).toBe('earnings-announcement');
    expect(FIXTURE_DIGEST.observationCount).toBe(FIXTURE_DIGEST.evidence.length);
  });

  it('survives a JSON round trip', () => {
    const round = JSON.parse(JSON.stringify(FIXTURE_DIGEST));
    expect(validateEventDigest(round, FIXTURE_REGISTRY)).toEqual([]);
    expect(serializeEventDigest(FIXTURE_DIGEST)).toBe(canonicalJson(round));
  });
});

describe('the digest laws', () => {
  it('an evidence-less digest fails (evidence_missing)', () => {
    const draft = { ...FIXTURE_DIGEST, evidence: [], observationCount: 0 };
    expect(codesOf({ ...draft, digestId: 'ed-pending' })).toContain('evidence_missing');
    expect(createEventDigest(draft as never, FIXTURE_REGISTRY).ok).toBe(false);
  });

  it('a future citation fails (future_evidence)', () => {
    const draft = {
      ...FIXTURE_DIGEST,
      evidence: [
        ...FIXTURE_DIGEST.evidence,
        { observationId: 'obs-future-2', availableTime: (FIXTURE_DIGEST.asOf as number) + 5_000, provenance: FIXTURE_SENTIMENT_CITATIONS[0]!.provenance },
      ],
      observationCount: 5,
    };
    expect(codesOf({ ...draft, digestId: 'ed-pending' })).toContain('future_evidence');
  });

  it('an unsorted instruments array fails', () => {
    const draft = { ...FIXTURE_DIGEST, instruments: ['TEST-ZZZ', 'TEST-AAA'] };
    expect(codesOf({ ...draft, digestId: 'ed-pending' }).length).toBeGreaterThan(0);
  });

  it('a duplicate instrument fails', () => {
    const draft = { ...FIXTURE_DIGEST, instruments: ['TEST-AAA', 'TEST-AAA'] };
    expect(codesOf({ ...draft, digestId: 'ed-pending' }).length).toBeGreaterThan(0);
  });

  it('an observation count that disagrees with evidence fails (report_composition_mismatch)', () => {
    const draft = { ...FIXTURE_DIGEST, observationCount: 99 };
    expect(codesOf({ ...draft, digestId: 'ed-pending' })).toContain('report_composition_mismatch');
  });

  it('a kind outside the declared taxonomy fails', () => {
    const draft = { ...FIXTURE_DIGEST, kind: 'big-news' };
    expect(codesOf({ ...draft, digestId: 'ed-pending' }).length).toBeGreaterThan(0);
  });

  it('an undeclared event-detection method fails', () => {
    const draft = { ...FIXTURE_DIGEST, methodId: 'method/sentiment/magic' };
    expect(codesOf({ ...draft, digestId: 'ed-pending' })).toContain('undeclared_method');
  });

  it('missing tenant/project fail (tenant_missing/project_missing)', () => {
    const draft = { ...FIXTURE_DIGEST, tenantId: '', projectId: '' };
    const codes = codesOf({ ...draft, digestId: 'ed-pending' });
    expect(codes).toContain('tenant_missing');
    expect(codes).toContain('project_missing');
  });

  it('a tampered digest id fails (digest_mismatch)', () => {
    const tampered = JSON.parse(JSON.stringify(FIXTURE_DIGEST));
    (tampered as unknown as { seed: string }).seed = 'seed/tampered';
    expect(codesOf(tampered)).toContain('digest_mismatch');
  });

  it('a window with from > to fails', () => {
    const draft = { ...FIXTURE_DIGEST, window: { from: FIXTURE_DIGEST.window.to, to: FIXTURE_DIGEST.window.from } };
    expect(codesOf({ ...draft, digestId: 'ed-pending' }).length).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('the same draft constructs a byte-identical digest twice', () => {
    const draft = JSON.parse(JSON.stringify(FIXTURE_DIGEST));
    delete (draft as Record<string, unknown>).digestId;
    const once = createEventDigest(draft, FIXTURE_REGISTRY);
    const twice = createEventDigest(draft, FIXTURE_REGISTRY);
    expect(once.ok).toBe(true);
    expect(twice.ok).toBe(true);
    if (!once.ok || !twice.ok) throw new Error('unreachable');
    expect(once.value).toEqual(twice.value);
    expect(serializeEventDigest(once.value)).toBe(serializeEventDigest(twice.value));
    expect(deriveEventDigestId(draft)).toBe(FIXTURE_DIGEST.digestId);
  });
});
