/**
 * @tradrl/firm-memory — the memory chains' laws: the T030/T031 fold
 * law (append-only, hash-chained from the seed `00000000`), the
 * append crimes (`firm_log_rewrite` on ordinal splice / foreign chain
 * head / non-monotonic per-family append), the domination law
 * (`contradiction_detected` on a polarity flip without strictly more
 * evidence), the tamper anchors (`chain_mismatch`-style verification
 * failures on edit / removal / reorder — HIDING a knowledge entry or a
 * contradiction), and the chain digests' determinism.
 */

import { describe, expect, it } from 'vitest';
import {
  appendContradiction,
  appendFirmKnowledge,
  CONTRADICTION_CHAIN_SEED,
  contradictionLogDigest,
  firmKnowledgeLogDigest,
  FIRM_MEMORY_CHAIN_SEED,
  startContradictionLog,
  startFirmKnowledgeLog,
  verifyContradictionChain,
  verifyFirmKnowledgeChain,
} from './log';
import { mintFirmKnowledgeRecord, type FirmKnowledgeRecord } from './record';
import { mintContradictionRecord, type ContradictionRecord, type ContradictionSide } from './contradiction';
import { asTimestampMs, deepFreeze, type TimestampMs } from './primitives';

const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// Fixtures (hand-minted valid records; the service mints these through the pipeline)
// ---------------------------------------------------------------------------

/** Mint one valid knowledge record positioned against a given chain state. */
function knowledgeRecord(ordinal: number, priorHead: string, asOf: number, overrides: Record<string, unknown> = {}): FirmKnowledgeRecord {
  const minted = mintFirmKnowledgeRecord(deepFreeze({
    ordinal,
    tenant: 'tenant-alpha',
    project: 'project-alpha',
    claim: { kind: 'market_behavior', polarity: 'adverse', dimension: null, lagBand: null },
    confidence: '0.5',
    evidenceCount: 3,
    provenance: {
      postMortemRefs: ['pmr:00000001', 'pmr:00000002', 'pmr:00000003'].slice(0, 3),
      outcomeRefs: ['out:00000001', 'out:00000002', 'out:00000003'].slice(0, 3),
      experimentRefs: [],
      trialRefs: [],
      trajectoryRefs: [],
      sessionRefs: ['shs:aaaa0001'],
    },
    validity: { from: asOf, to: asOf + 2_592_000_000 },
    asOf: asTimestampMs(asOf),
    priorChainHead: priorHead,
    ...overrides,
  } as unknown as Omit<FirmKnowledgeRecord, 'knowledgeId'>));
  if (!minted.ok) throw new Error(minted.errors.map((error) => `${error.code}@${error.path}: ${error.message}`).join('; '));
  return minted.value;
}

/** Mint one valid contradiction record positioned against a given register state. */
function contradictionRecord(ordinal: number, priorHead: string, asOf: number): ContradictionRecord {
  const side = (polarity: string): ContradictionSide => deepFreeze({
    knowledgeRef: null,
    polarity,
    confidence: '0.5',
    evidenceCount: 2,
    outcomeRefs: ['out:00000001', 'out:00000002'],
  } as ContradictionSide);
  const minted = mintContradictionRecord(deepFreeze({
    ordinal,
    tenant: 'tenant-alpha',
    project: 'project-alpha',
    claimKey: '{"kind":"market_behavior","lagBand":null,"project":"project-alpha","tenant":"tenant-alpha","dimension":null}',
    sides: [side('adverse'), side('favorable')],
    asOf: asTimestampMs(asOf),
    priorChainHead: priorHead,
  } as unknown as Omit<ContradictionRecord, 'contradictionId'>));
  if (!minted.ok) throw new Error(minted.errors.map((error) => `${error.code}: ${error.message}`).join('; '));
  return minted.value;
}

// ---------------------------------------------------------------------------
// The knowledge chain
// ---------------------------------------------------------------------------

describe('the fold law (T030/T031, mirrored)', () => {
  it('a fresh chain starts at the seed with no records', () => {
    const log = startFirmKnowledgeLog();
    expect(log.records).toHaveLength(0);
    expect(log.head).toBe(FIRM_MEMORY_CHAIN_SEED);
    expect(FIRM_MEMORY_CHAIN_SEED).toBe('00000000');
    expect(verifyFirmKnowledgeChain(log)).toBe(true);
  });

  it('appends fold deterministically — identical append sequences produce identical heads', () => {
    const run = () => {
      let log = startFirmKnowledgeLog();
      for (let index = 1; index <= 3; index++) {
        const appended = appendFirmKnowledge(log, knowledgeRecord(index, log.head, T0 + index * 1000));
        if (!appended.ok) throw new Error(appended.errors.map((error) => error.message).join('; '));
        log = appended.value;
      }
      return log;
    };
    const first = run();
    const second = run();
    expect(first.head).toBe(second.head);
    expect(first.records.map((record) => record.knowledgeId)).toEqual(second.records.map((record) => record.knowledgeId));
    expect(verifyFirmKnowledgeChain(first)).toBe(true);
    expect(firmKnowledgeLogDigest(first)).toBe(firmKnowledgeLogDigest(second));
  });
});

describe('the append crimes (firm_log_rewrite)', () => {
  it('an out-of-order ordinal is the typed rewrite crime', () => {
    const log = startFirmKnowledgeLog();
    const first = appendFirmKnowledge(log, knowledgeRecord(1, log.head, T0));
    if (!first.ok) throw new Error('the first append must succeed');
    const spliced = appendFirmKnowledge(first.value, knowledgeRecord(3, first.value.head, T0 + 1000));
    if (spliced.ok) throw new Error('must fail');
    expect(spliced.errors[0]?.code).toBe('firm_log_rewrite');
  });

  it('a foreign chain head is the typed rewrite crime', () => {
    const log = startFirmKnowledgeLog();
    const foreign = appendFirmKnowledge(log, knowledgeRecord(1, 'deadbeef', T0));
    if (foreign.ok) throw new Error('must fail');
    expect(foreign.errors[0]?.code).toBe('firm_log_rewrite');
  });

  it('a same-family append at a non-later instant is the typed rewrite crime (per-family monotonicity)', () => {
    let log = startFirmKnowledgeLog();
    const first = appendFirmKnowledge(log, knowledgeRecord(1, log.head, T0 + 5000));
    if (!first.ok) throw new Error('must append');
    log = first.value;
    const sameInstant = appendFirmKnowledge(log, knowledgeRecord(2, log.head, T0 + 5000, { evidenceCount: 4, provenance: { postMortemRefs: ['pmr:1', 'pmr:2', 'pmr:3', 'pmr:4'], outcomeRefs: ['out:1', 'out:2', 'out:3', 'out:4'], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: ['shs:1'] } }));
    if (sameInstant.ok) throw new Error('must fail');
    expect(sameInstant.errors[0]?.code).toBe('firm_log_rewrite');
    const earlier = appendFirmKnowledge(log, knowledgeRecord(2, log.head, T0 + 4000, { evidenceCount: 4, provenance: { postMortemRefs: ['pmr:1', 'pmr:2', 'pmr:3', 'pmr:4'], outcomeRefs: ['out:1', 'out:2', 'out:3', 'out:4'], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: ['shs:1'] } }));
    if (earlier.ok) throw new Error('must fail');
    expect(earlier.errors[0]?.code).toBe('firm_log_rewrite');
  });

  it('a DIFFERENT family at the same instant is legal (families are independent)', () => {
    let log = startFirmKnowledgeLog();
    const first = appendFirmKnowledge(log, knowledgeRecord(1, log.head, T0 + 5000));
    if (!first.ok) throw new Error('must append');
    log = first.value;
    const other = appendFirmKnowledge(log, knowledgeRecord(2, log.head, T0 + 5000, { claim: { kind: 'decision_pattern', polarity: 'harmful', dimension: 'timing', lagBand: null } }));
    expect(other.ok).toBe(true);
  });
});

describe('the domination law (contradiction_detected)', () => {
  it('a same-family polarity flip WITHOUT strictly more evidence is the typed contradiction_detected', () => {
    let log = startFirmKnowledgeLog();
    const first = appendFirmKnowledge(log, knowledgeRecord(1, log.head, T0 + 5000));
    if (!first.ok) throw new Error('must append');
    log = first.value;
    // Same evidence count, opposite polarity — the flip must fail.
    const flip = appendFirmKnowledge(log, knowledgeRecord(2, log.head, T0 + 6000, { claim: { kind: 'market_behavior', polarity: 'favorable', dimension: null, lagBand: null } }));
    if (flip.ok) throw new Error('must fail');
    expect(flip.errors[0]?.code).toBe('contradiction_detected');
    expect(flip.errors[0]?.message).toContain('DOMINATE');
  });

  it('a same-family polarity flip WITH strictly more evidence is legal (the domination path)', () => {
    let log = startFirmKnowledgeLog();
    const first = appendFirmKnowledge(log, knowledgeRecord(1, log.head, T0 + 5000, { evidenceCount: 2, provenance: { postMortemRefs: ['pmr:1', 'pmr:2'], outcomeRefs: ['out:1', 'out:2'], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: ['shs:1'] } }));
    if (!first.ok) throw new Error('must append');
    log = first.value;
    const dominating = appendFirmKnowledge(log, knowledgeRecord(2, log.head, T0 + 6000, { claim: { kind: 'market_behavior', polarity: 'favorable', dimension: null, lagBand: null } }));
    expect(dominating.ok).toBe(true);
  });

  it('a same-family REVISION (same polarity, later instant) is always legal — the dedupe fold', () => {
    let log = startFirmKnowledgeLog();
    const first = appendFirmKnowledge(log, knowledgeRecord(1, log.head, T0 + 5000, { evidenceCount: 2, provenance: { postMortemRefs: ['pmr:1', 'pmr:2'], outcomeRefs: ['out:1', 'out:2'], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: ['shs:1'] } }));
    if (!first.ok) throw new Error('must append');
    log = first.value;
    const revision = appendFirmKnowledge(log, knowledgeRecord(2, log.head, T0 + 6000, { evidenceCount: 3, provenance: { postMortemRefs: ['pmr:1', 'pmr:2', 'pmr:3'], outcomeRefs: ['out:1', 'out:2', 'out:3'], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: ['shs:1'] } }));
    expect(revision.ok).toBe(true);
  });
});

describe('the tamper anchors (verification)', () => {
  it('a tampered (edited) record fails verification — never serve from a tampered brain', () => {
    let log = startFirmKnowledgeLog();
    for (let index = 1; index <= 3; index++) {
      const appended = appendFirmKnowledge(log, knowledgeRecord(index, log.head, T0 + index * 1000));
      if (!appended.ok) throw new Error('must append');
      log = appended.value;
    }
    expect(verifyFirmKnowledgeChain(log)).toBe(true);
    const records = [...log.records];
    const tampered = { ...log, records: [{ ...records[0]!, confidence: '0.9' }, ...records.slice(1)] };
    expect(verifyFirmKnowledgeChain(tampered)).toBe(false);
  });

  it('a REMOVED record (hiding a knowledge entry) fails verification', () => {
    let log = startFirmKnowledgeLog();
    for (let index = 1; index <= 3; index++) {
      const appended = appendFirmKnowledge(log, knowledgeRecord(index, log.head, T0 + index * 1000));
      if (!appended.ok) throw new Error('must append');
      log = appended.value;
    }
    const truncated = { ...log, records: log.records.slice(0, 2) };
    expect(verifyFirmKnowledgeChain(truncated)).toBe(false);
  });

  it('a reordered chain fails verification', () => {
    let log = startFirmKnowledgeLog();
    for (let index = 1; index <= 3; index++) {
      const appended = appendFirmKnowledge(log, knowledgeRecord(index, log.head, T0 + index * 1000));
      if (!appended.ok) throw new Error('must append');
      log = appended.value;
    }
    const records = [...log.records];
    const reordered = { ...log, records: [records[1]!, records[0]!, ...records.slice(2)] };
    expect(verifyFirmKnowledgeChain(reordered)).toBe(false);
  });

  it('a malformed log shape fails the guards', () => {
    expect(verifyFirmKnowledgeChain(null)).toBe(false);
    expect(verifyFirmKnowledgeChain({ records: 'nope', head: '00000000' })).toBe(false);
    expect(verifyFirmKnowledgeChain({ records: [], head: 'not-a-head' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The contradiction register
// ---------------------------------------------------------------------------

describe('the contradiction register (the second chain)', () => {
  it('starts at the seed; appends fold; the register digest is deterministic', () => {
    const log = startContradictionLog();
    expect(log.head).toBe(CONTRADICTION_CHAIN_SEED);
    expect(CONTRADICTION_CHAIN_SEED).toBe('00000000');
    const run = () => {
      let register = startContradictionLog();
      for (let index = 1; index <= 2; index++) {
        const appended = appendContradiction(register, contradictionRecord(index, register.head, T0 + index * 1000));
        if (!appended.ok) throw new Error(appended.errors.map((error) => error.message).join('; '));
        register = appended.value;
      }
      return register;
    };
    const first = run();
    const second = run();
    expect(first.head).toBe(second.head);
    expect(contradictionLogDigest(first)).toBe(contradictionLogDigest(second));
    expect(verifyContradictionChain(first)).toBe(true);
  });

  it('an out-of-order ordinal and a foreign head are the typed contradiction_log_rewrite', () => {
    const register = startContradictionLog();
    const first = appendContradiction(register, contradictionRecord(1, register.head, T0));
    if (!first.ok) throw new Error('must append');
    const spliced = appendContradiction(first.value, contradictionRecord(3, first.value.head, T0 + 1000));
    if (spliced.ok) throw new Error('must fail');
    expect(spliced.errors[0]?.code).toBe('contradiction_log_rewrite');
    const foreign = appendContradiction(register, contradictionRecord(1, 'deadbeef', T0));
    if (foreign.ok) throw new Error('must fail');
    expect(foreign.errors[0]?.code).toBe('contradiction_log_rewrite');
  });

  it('HIDING a contradiction (truncation) fails verification; editing one fails too', () => {
    let register = startContradictionLog();
    for (let index = 1; index <= 2; index++) {
      const appended = appendContradiction(register, contradictionRecord(index, register.head, T0 + index * 1000));
      if (!appended.ok) throw new Error('must append');
      register = appended.value;
    }
    expect(verifyContradictionChain(register)).toBe(true);
    const truncated = { ...register, records: register.records.slice(0, 1) };
    expect(verifyContradictionChain(truncated)).toBe(false);
    const records = [...register.records];
    const edited = { ...register, records: [{ ...records[0]!, asOf: asTimestampMs(T0 + 999_999) as TimestampMs }, ...records.slice(1)] };
    expect(verifyContradictionChain(edited)).toBe(false);
  });
});
