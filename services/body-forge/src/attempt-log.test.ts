/**
 * @tradrl/body-forge — the attempt-log tests (L11).
 *
 * Behavioral, law-driven:
 * - APPEND-ONLY: `appendAttempt` returns a NEW log; the input is never
 *   mutated; ordinals are strictly increasing 1..N.
 * - RETAINED REJECTIONS: rejected attempts are appended exactly like
 *   minted ones, with their structured reasons — never dropped.
 * - THE HIDING TRIP WIRE: a log whose recorded count exceeds its retained
 *   entries fails with `attempt_hidden`; a gap in the ordinals fails too.
 * - THE REWRITE TRIP WIRE: the digest chain — tampering with any byte of
 *   a retained attempt, reordering, or forging a chain link fails with
 *   `attempt_rewrite`.
 * - Determinism: same (forgeVersion, seed, ordinal, previous head, result)
 *   -> byte-identical attempt, twice.
 */

import { describe, expect, it } from 'vitest';

import { type SkillError, type SkillResult, type TimestampMs } from '../../../packages/skills/src/index';
import {
  type AttemptLog,
  type ForgeAttempt,
  ATTEMPT_CHAIN_GENESIS,
  appendAttempt,
  createAttemptLog,
  deriveAttemptId,
  forgeAttemptOf,
  parseAttemptLog,
  serializeAttemptLog,
  validateAttemptLog,
} from './attempt-log';

/** Unwraps an ok result (the happy-path test helper; throws otherwise). */
function unwrapLog(result: SkillResult<AttemptLog>): AttemptLog {
  if (!result.ok) throw new Error('expected an ok attempt log');
  return result.value;
}

const ATTEMPTED_AT = 1_712_000_000_000 as TimestampMs;

/** A branded instant offset from the base (explicit instants, never a clock). */
const at = (offset: number): TimestampMs => (ATTEMPTED_AT + offset) as TimestampMs;

function mintedResult(candidateRef: string): {
  readonly minted: boolean;
  readonly candidateRef: string | null;
  readonly reasons: readonly SkillError[];
  readonly inputDigest: string;
} {
  return { minted: true, candidateRef, reasons: [], inputDigest: 'a'.repeat(16) };
}

function rejectedResult(reasons: readonly SkillError[]): {
  readonly minted: boolean;
  readonly candidateRef: string | null;
  readonly reasons: readonly SkillError[];
  readonly inputDigest: string;
} {
  return { minted: false, candidateRef: null, reasons, inputDigest: 'b'.repeat(16) };
}

function mintedAttempt(ordinal: number, previous: string): ForgeAttempt {
  return forgeAttemptOf('reference-forge/1', 'seed-1', ordinal, previous, mintedResult(`regime-researcher@1.${ordinal + 2}.0`), at(ordinal));
}

function rejectedAttempt(ordinal: number, previous: string): ForgeAttempt {
  return forgeAttemptOf(
    'reference-forge/1',
    'seed-1',
    ordinal,
    previous,
    rejectedResult([
      {
        code: 'compatibility_fail',
        path: 'substrateCompatibility.requirements.minContextWindowTokens',
        message: 'must be a non-negative integer token count',
      },
    ]),
    at(ordinal),
  );
}

describe('append-only growth', () => {
  it('appending returns a NEW log; the input is never mutated', () => {
    const empty = createAttemptLog();
    const first = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    const appended = appendAttempt(empty, first);
    expect(appended.ok).toBe(true);
    if (appended.ok) {
      expect(appended.value).not.toBe(empty);
      expect(appended.value.attempts.length).toBe(1);
      expect(appended.value.attemptCount).toBe(1);
      expect(appended.value.chainHead).toBe(first.chainDigest);
    }
    expect(empty.attempts.length).toBe(0); // untouched
    expect(empty.chainHead).toBe(ATTEMPT_CHAIN_GENESIS);
  });

  it('ordinals are strictly increasing; an out-of-order append is attempt_rewrite', () => {
    const log = unwrapLog(appendAttempt(createAttemptLog(), mintedAttempt(1, ATTEMPT_CHAIN_GENESIS)));
    const replayed = appendAttempt(log, mintedAttempt(1, ATTEMPT_CHAIN_GENESIS));
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) {
      expect(replayed.errors[0]?.code).toBe('attempt_rewrite');
      expect(replayed.errors[0]?.message.includes('ordinal')).toBe(true);
    }
    const skipped = appendAttempt(log, mintedAttempt(3, log.chainHead));
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) {
      expect(skipped.errors[0]?.code).toBe('attempt_rewrite');
    }
  });

  it('a chain link that does not bind the head is refused (replayed attempt)', () => {
    const log = unwrapLog(appendAttempt(createAttemptLog(), mintedAttempt(1, ATTEMPT_CHAIN_GENESIS)));
    // A VALID ordinal-2 attempt built against the WRONG previous head.
    const forgedLink = forgeAttemptOf('reference-forge/1', 'seed-1', 2, 'deadbeefdeadbeef', mintedResult('x@2.0.0'), at(0));
    const appended = appendAttempt(log, forgedLink);
    expect(appended.ok).toBe(false);
    if (!appended.ok) {
      expect(appended.errors[0]?.code).toBe('attempt_rewrite');
      expect(appended.errors[0]?.path).toBe('attempt.chainDigest');
    }
  });
});

describe('RETAINED REJECTIONS (L11)', () => {
  it('a rejected attempt is appended exactly like a minted one, reasons retained', () => {
    const first = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    let log = unwrapLog(appendAttempt(createAttemptLog(), first));
    const rejection = rejectedAttempt(2, log.chainHead);
    log = unwrapLog(appendAttempt(log, rejection));
    expect(log.attempts.length).toBe(2);
    expect(log.attemptCount).toBe(2);
    const retained = log.attempts[1] as ForgeAttempt;
    expect(retained.outcome).toBe('rejected');
    expect(retained.candidateRef).toBeNull();
    expect(retained.reasons.length).toBe(1);
    expect(retained.reasons[0]?.code).toBe('compatibility_fail');
  });

  it('a rejection without reasons is not an auditable record (evidence_missing)', () => {
    const silent: ForgeAttempt = {
      attemptId: deriveAttemptId('reference-forge/1', 'seed-1', 1),
      ordinal: 1,
      candidateRef: null,
      outcome: 'rejected',
      reasons: [],
      inputDigest: 'c'.repeat(16),
      attemptedAt: at(0),
      chainDigest: 'd'.repeat(16),
    };
    const result = validateAttemptLog({ attempts: [silent], attemptCount: 1, chainHead: silent.chainDigest });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'evidence_missing')).toBe(true);
    }
  });
});

describe('THE HIDING TRIP WIRE (attempt_hidden)', () => {
  it('a recorded count above the retained length is a hidden attempt', () => {
    const first = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    const second = mintedAttempt(2, first.chainDigest);
    const honest = unwrapLog(appendAttempt(unwrapLog(appendAttempt(createAttemptLog(), first)), second));
    // The HIDING: drop the second attempt but keep the count.
    const hidden = { attempts: honest.attempts.slice(0, 1), attemptCount: 2, chainHead: honest.chainHead };
    const result = validateAttemptLog(hidden);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const violation = result.errors.find((e) => e.code === 'attempt_hidden');
      expect(violation).toBeDefined();
      expect(violation?.message.includes('hiding')).toBe(true);
    }
  });

  it('an inflated count (below the retained length) is also a hiding error', () => {
    const first = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    const second = mintedAttempt(2, first.chainDigest);
    const honest = unwrapLog(appendAttempt(unwrapLog(appendAttempt(createAttemptLog(), first)), second));
    const inflated = { ...honest, attemptCount: 3 };
    const result = validateAttemptLog(inflated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'attempt_hidden')).toBeDefined();
    }
  });

  it('a gap in the ordinals is a hidden attempt', () => {
    const first = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    const third = forgeAttemptOf('reference-forge/1', 'seed-1', 3, first.chainDigest, mintedResult('x@3.0.0'), at(0));
    const gapped = { attempts: [first, third], attemptCount: 2, chainHead: third.chainDigest };
    const result = validateAttemptLog(gapped);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'attempt_hidden' && e.path.includes('ordinal'))).toBe(true);
    }
  });
});

describe('THE REWRITE TRIP WIRE (attempt_rewrite — the digest chain)', () => {
  it('tampering with a retained attempt\'s reasons breaks the chain', () => {
    const first = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    const rejection = rejectedAttempt(2, first.chainDigest);
    const log = unwrapLog(appendAttempt(unwrapLog(appendAttempt(createAttemptLog(), first)), rejection));
    // Tamper: erase the retained rejection reasons (rewriting history).
    const tampered = {
      ...log,
      attempts: [
        log.attempts[0] as ForgeAttempt,
        { ...(log.attempts[1] as ForgeAttempt), reasons: [] as SkillError[] },
      ],
    };
    const result = validateAttemptLog(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'attempt_rewrite')).toBe(true);
    }
  });

  it('reordering attempts breaks the chain', () => {
    const first = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    const second = mintedAttempt(2, first.chainDigest);
    const log = unwrapLog(appendAttempt(unwrapLog(appendAttempt(createAttemptLog(), first)), second));
    const reordered = { ...log, attempts: [...log.attempts].reverse() };
    const result = validateAttemptLog(reordered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'attempt_rewrite' || e.code === 'attempt_hidden')).toBe(true);
    }
  });

  it('a forged chain head is refused', () => {
    const first = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    const log = unwrapLog(appendAttempt(createAttemptLog(), first));
    const forgedHead = { ...log, chainHead: '0123456789abcdef' };
    const result = validateAttemptLog(forgedHead);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'attempt_rewrite')).toBe(true);
    }
  });
});

describe('determinism + serialization round trip', () => {
  it('the same inputs produce byte-identical attempts, twice', () => {
    const a = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    const b = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.attemptId).toBe(b.attemptId);
  });

  it('serialize -> parse round-trips a valid log (chain-verified)', () => {
    const first = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    const rejection = rejectedAttempt(2, first.chainDigest);
    const log = unwrapLog(appendAttempt(unwrapLog(appendAttempt(createAttemptLog(), first)), rejection));
    const bytes = serializeAttemptLog(log);
    const parsed = parseAttemptLog(bytes);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeAttemptLog(parsed.value)).toBe(bytes);
      expect(parsed.value.attemptCount).toBe(2);
    }
  });

  it('parsing tampered bytes refuses (the chain is verified on parse)', () => {
    const first = mintedAttempt(1, ATTEMPT_CHAIN_GENESIS);
    const log = unwrapLog(appendAttempt(createAttemptLog(), first));
    const bytes = serializeAttemptLog(log);
    const tampered = bytes.replace('"attemptCount":1', '"attemptCount":2');
    const parsed = parseAttemptLog(tampered);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.some((e) => e.code === 'attempt_hidden')).toBe(true);
    }
  });

  it('non-JSON bytes are refused', () => {
    const parsed = parseAttemptLog('not-json{');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors[0]?.code).toBe('invalid_type');
    }
  });
});
