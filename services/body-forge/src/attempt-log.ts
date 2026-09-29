/**
 * @tradrl/body-forge (service) — the append-only attempt log.
 *
 * THE LAW THIS MODULE SERVES: Work Order T017, Law L11 — VERBATIM: "the
 * forge's attempt log is append-only — rejected candidates are RETAINED
 * with structured reasons; hiding one is a typed error." And
 * spec/ARCHITECTURE-LOCK.md L11 — "Search integrity: optimization history
 * is retained to expose selection effects"; spec/CAPABILITY-DISCOVERY.md
 * Reproducibility — "Record ... outcomes and rejected candidates."
 *
 * ENFORCEMENT (three trip wires, all typed errors):
 * - `attempt_hidden`: the log's recorded `attemptCount` must EQUAL the
 *   number of retained entries — a log that records more attempts than
 *   it retains has HIDDEN attempts. Ordinals are strictly increasing
 *   1..N; any gap or disorder is also a hidden attempt.
 * - `attempt_rewrite`: the digest CHAIN — each attempt carries the digest
 *   of its predecessor plus its own canonical bytes — makes rewriting or
 *   reordering history detectable: the recomputed chain must match the
 *   recorded chain head exactly.
 * - `duplicate_record`: attempt ids are unique; one attempt per ordinal.
 *
 * `appendAttempt` is the ONLY sanctioned way a log grows: it returns a
 * NEW frozen log (the input log is never mutated) with the chain
 * extended. Rejected attempts (minted: false) are appended exactly like
 * successful ones — with their structured reasons retained.
 */

import {
  type SkillError,
  type SkillResult,
  type TimestampMs,
  canonicalJson,
  deepCloneJson,
  deepFreeze,
  fnv1a32,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  stableDigest,
} from '../../../packages/skills/src/index';

// ---------------------------------------------------------------------------
// The attempt record
// ---------------------------------------------------------------------------

/** The closed attempt-outcome vocabulary. */
export const FORGE_ATTEMPT_OUTCOMES = ['minted', 'rejected'] as const;

/** One attempt outcome: a minted candidate, or a rejected (retained) attempt. */
export type ForgeAttemptOutcome = (typeof FORGE_ATTEMPT_OUTCOMES)[number];

/** Guard: `ForgeAttemptOutcome`. */
export function isForgeAttemptOutcome(v: unknown): v is ForgeAttemptOutcome {
  return typeof v === 'string' && (FORGE_ATTEMPT_OUTCOMES as readonly string[]).includes(v);
}

/**
 * One forge attempt: the ordinal (strictly increasing, 1-based), the
 * candidate ref (canonical body-version id — `null` when the forge
 * REFUSED to mint), the outcome, the RETAINED structured reasons (never
 * dropped — L11), the input digest (L9 — the attempt binds its input),
 * the explicit instant, and the CHAIN digest (the digest of the previous
 * chain link + this attempt's canonical bytes — the rewrite trip wire).
 */
export interface ForgeAttempt {
  /** Deterministic derived id: pure FNV-1a of (forgeVersion, seed, ordinal). */
  readonly attemptId: string;
  /** 1-based, strictly increasing across the log. */
  readonly ordinal: number;
  /** The minted candidate's canonical id, or `null` on refusal. */
  readonly candidateRef: string | null;
  /** `minted` or `rejected` (the refusal is an outcome, never a hole). */
  readonly outcome: ForgeAttemptOutcome;
  /** The RETAINED structured reasons (typed errors from the forge gates). */
  readonly reasons: readonly SkillError[];
  /** Digest over the canonical JSON of the attempt's forge input (L9). */
  readonly inputDigest: string;
  /** Explicit attempt instant (epoch ms — carried, never read from a clock). */
  readonly attemptedAt: TimestampMs;
  /** The chain link digest: stableDigest(prevChain + canonicalJson(attempt)). */
  readonly chainDigest: string;
}

/** Guard: `ForgeAttempt` (structural; chain + ordinal laws live in the log validator). */
export function isForgeAttempt(v: unknown): v is ForgeAttempt {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.attemptId)) return false;
  if (!isPositiveInteger(v.ordinal)) return false;
  if (v.candidateRef !== null && !isNonEmptyString(v.candidateRef)) return false;
  if (!isForgeAttemptOutcome(v.outcome)) return false;
  if (!Array.isArray(v.reasons)) return false;
  if (!v.reasons.every((r) => isRecord(r) && isNonEmptyString((r as { code?: unknown }).code))) {
    return false;
  }
  if (!isNonEmptyString(v.inputDigest)) return false;
  if (!isTimestampMs(v.attemptedAt)) return false;
  return isNonEmptyString(v.chainDigest);
}

// ---------------------------------------------------------------------------
// The attempt log
// ---------------------------------------------------------------------------

/** The genesis chain seed (fixed forever). */
export const ATTEMPT_CHAIN_GENESIS = 'genesis';

/**
 * The append-only attempt log: the retained attempts (ordinals 1..N), the
 * RECORDED attempt count (the hiding trip wire: `attemptCount` must equal
 * the retained length), and the chain head (the rewrite trip wire:
 * recomputing the chain must land exactly here).
 */
export interface AttemptLog {
  readonly attempts: readonly ForgeAttempt[];
  /** The recorded number of attempts made — MUST equal `attempts.length`. */
  readonly attemptCount: number;
  /** The digest chain head over all retained attempts. */
  readonly chainHead: string;
}

/** Guard: `AttemptLog` (structural). */
export function isAttemptLog(v: unknown): v is AttemptLog {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.attempts)) return false;
  if (!v.attempts.every((a) => isForgeAttempt(a))) return false;
  if (!isPositiveInteger(v.attemptCount) && v.attemptCount !== 0) return false;
  return isNonEmptyString(v.chainHead);
}

/** Derives an attempt id: pure FNV-1a of (forgeVersion, seed, ordinal). */
export function deriveAttemptId(forgeVersion: string, seed: string, ordinal: number): string {
  return `attempt-${fnv1a32(`${forgeVersion}|${seed}|${ordinal}`).toString(16).padStart(8, '0')}`;
}

/** One chain link: the digest of (previous chain digest, canonical attempt bytes). */
function chainLinkOf(previous: string, attempt: unknown): string {
  const canonical = canonicalJson(JSON.parse(JSON.stringify(attempt)) as never);
  return stableDigest(`${previous}|${canonical}`);
}

/**
 * The attempt WITHOUT its chain-digest field — the exact canonical shape
 * the chain link is computed over (both at construction and at
 * verification, so the two can never disagree).
 */
function attemptWithoutChain(attempt: ForgeAttempt): Record<string, unknown> {
  return {
    attemptId: attempt.attemptId,
    ordinal: attempt.ordinal,
    candidateRef: attempt.candidateRef,
    outcome: attempt.outcome,
    reasons: attempt.reasons,
    inputDigest: attempt.inputDigest,
    attemptedAt: attempt.attemptedAt,
  };
}

/**
 * Constructs a fresh, empty attempt log (the genesis state of a forge
 * run). Deeply frozen.
 */
export function createAttemptLog(): AttemptLog {
  return deepFreeze({ attempts: [], attemptCount: 0, chainHead: ATTEMPT_CHAIN_GENESIS });
}

/**
 * Builds ONE attempt from a forge result (pure): the attempt id is
 * derived from (forgeVersion, seed, ordinal), the outcome follows the
 * mint flag, the reasons are RETAINED verbatim, and the chain link is
 * computed over the previous head. The attempt is deeply frozen.
 */
export function forgeAttemptOf(
  forgeVersion: string,
  seed: string,
  ordinal: number,
  previousChainHead: string,
  result: { readonly minted: boolean; readonly candidateRef: string | null; readonly reasons: readonly SkillError[]; readonly inputDigest: string },
  attemptedAt: TimestampMs,
): ForgeAttempt {
  const base: Omit<ForgeAttempt, 'chainDigest'> = {
    attemptId: deriveAttemptId(forgeVersion, seed, ordinal),
    ordinal,
    candidateRef: result.candidateRef,
    outcome: (result.minted ? 'minted' : 'rejected') as ForgeAttemptOutcome,
    reasons: deepFreeze([...result.reasons]),
    inputDigest: result.inputDigest,
    attemptedAt,
  };
  return deepFreeze({ ...base, chainDigest: chainLinkOf(previousChainHead, base) });
}

/**
 * APPENDS one attempt — the ONLY sanctioned way a log grows. Returns a
 * NEW frozen log (the input is never mutated), with the count incremented
 * and the chain extended. Refuses (typed errors) when the ordinal is not
 * exactly `attemptCount + 1` (an out-of-order or replayed append) or the
 * previous chain head disagrees with the attempt's recorded link.
 */
export function appendAttempt(log: AttemptLog, attempt: ForgeAttempt): SkillResult<AttemptLog> {
  if (!isForgeAttempt(attempt)) {
    return { ok: false, errors: [{ code: 'invalid_field', path: 'attempt', message: 'the attempt failed the ForgeAttempt guard' }] };
  }
  const logResult = validateAttemptLog(log);
  if (!logResult.ok) return logResult;
  const validated = logResult.value;
  const expectedOrdinal = validated.attemptCount + 1;
  if (attempt.ordinal !== expectedOrdinal) {
    return {
      ok: false,
      errors: [
        {
          code: 'attempt_rewrite',
          path: 'attempt.ordinal',
          message: `the log holds ${validated.attemptCount} attempt(s); the next append MUST carry ordinal ${expectedOrdinal}, got ${attempt.ordinal} — out-of-order or replayed appends rewrite history (L11)`,
        },
      ],
    };
  }
  const recomputedLink = chainLinkOf(validated.chainHead, attemptWithoutChain(attempt));
  if (recomputedLink !== attempt.chainDigest) {
    return {
      ok: false,
      errors: [
        {
          code: 'attempt_rewrite',
          path: 'attempt.chainDigest',
          message: `the attempt's chain link does not bind to the log head ("${validated.chainHead}") — a forged or replayed chain link rewrites history (L11)`,
        },
      ],
    };
  }
  return {
    ok: true,
    value: deepFreeze({
      attempts: deepFreeze([...validated.attempts, attempt]),
      attemptCount: expectedOrdinal,
      chainHead: attempt.chainDigest,
    }),
  };
}

/**
 * Validates an attempt log against the FULL L11 law (collect-all):
 * - every attempt passes the structural guard;
 * - ordinals are EXACTLY 1..N, strictly increasing (no gaps, no replays);
 * - attempt ids are unique;
 * - `attemptCount` equals the retained length — a count above the length
 *   is a HIDDEN attempt (`attempt_hidden`); below it is an inflated count
 *   (also `attempt_hidden`: the count is part of the record's truth);
 * - the digest chain recomputes EXACTLY to the recorded chain head
 *   (`attempt_rewrite` on any divergence);
 * - rejected attempts RETAIN non-empty structured reasons (a rejection
 *   without reasons is not an auditable record).
 */
export function validateAttemptLog(v: unknown, path = 'attemptLog'): SkillResult<AttemptLog> {
  if (!isRecord(v)) {
    return { ok: false, errors: [{ code: 'invalid_type', path, message: `${path} must be an object` }] };
  }
  const errors: SkillError[] = [];
  if (!Array.isArray(v.attempts)) {
    return { ok: false, errors: [{ code: 'invalid_field', path: `${path}.attempts`, message: 'must be an array of forge attempts' }] };
  }
  if (typeof v.attemptCount !== 'number' || !Number.isInteger(v.attemptCount) || v.attemptCount < 0) {
    errors.push({ code: 'invalid_field', path: `${path}.attemptCount`, message: 'must be a non-negative integer count' });
  }
  if (typeof v.chainHead !== 'string' || v.chainHead.length === 0) {
    errors.push({ code: 'invalid_field', path: `${path}.chainHead`, message: 'must be a non-empty chain digest' });
  }

  const seenIds = new Set<string>();
  let allAttemptsStructural = true;
  v.attempts.forEach((attempt: unknown, index: number) => {
    const attemptPath = `${path}.attempts[${index}]`;
    if (!isForgeAttempt(attempt)) {
      allAttemptsStructural = false;
      errors.push({ code: 'invalid_field', path: attemptPath, message: 'failed the ForgeAttempt guard' });
      return;
    }
    if (seenIds.has(attempt.attemptId)) {
      errors.push({ code: 'duplicate_record', path: `${attemptPath}.attemptId`, message: `duplicate attempt id "${attempt.attemptId}"` });
    } else {
      seenIds.add(attempt.attemptId);
    }
    if (attempt.ordinal !== index + 1) {
      errors.push({
        code: 'attempt_hidden',
        path: `${attemptPath}.ordinal`,
        message: `attempt at index ${index} carries ordinal ${attempt.ordinal} — ordinals are strictly increasing 1..N; a gap or disorder means an attempt was hidden or reordered (L11)`,
      });
    }
    if (attempt.outcome === 'rejected' && attempt.reasons.length === 0) {
      errors.push({
        code: 'evidence_missing',
        path: `${attemptPath}.reasons`,
        message: 'a rejected attempt RETAINS its structured reasons — a rejection without reasons is not an auditable record (L11)',
      });
    }
    if (attempt.outcome === 'rejected' && attempt.candidateRef !== null) {
      errors.push({
        code: 'invalid_field',
        path: `${attemptPath}.candidateRef`,
        message: 'a rejected attempt carries no candidate ref (the forge refused to mint)',
      });
    }
    if (attempt.outcome === 'minted' && attempt.candidateRef === null) {
      errors.push({
        code: 'invalid_field',
        path: `${attemptPath}.candidateRef`,
        message: 'a minted attempt names its candidate',
      });
    }
  });

  // THE HIDING TRIP WIRE: the recorded count must equal the retained length.
  if (typeof v.attemptCount === 'number' && Number.isInteger(v.attemptCount)) {
    const retained = v.attempts.length;
    if (v.attemptCount !== retained) {
      errors.push({
        code: 'attempt_hidden',
        path: `${path}.attemptCount`,
        message: `the log records ${v.attemptCount} attempt(s) but retains ${retained} — hiding an attempt from the append-only log is a typed error (L11; spec/CAPABILITY-DISCOVERY.md Reproducibility: rejected candidates are recorded)`,
      });
    }
  }

  // THE REWRITE TRIP WIRE: recompute the digest chain. Runs whenever the
  // attempts are structurally valid — tampering must ALWAYS trip the
  // chain, independently of any semantic violation found above.
  if (allAttemptsStructural && typeof v.chainHead === 'string') {
    let chain = ATTEMPT_CHAIN_GENESIS;
    for (const attempt of v.attempts as readonly ForgeAttempt[]) {
      chain = chainLinkOf(chain, attemptWithoutChain(attempt));
      if (chain !== attempt.chainDigest) {
        errors.push({
          code: 'attempt_rewrite',
          path: `${path}.attempts[${attempt.ordinal - 1}].chainDigest`,
          message: `the chain link at ordinal ${attempt.ordinal} does not bind its predecessor — rewriting or reordering append-only history is a typed error (L11)`,
        });
        break;
      }
    }
    if (errors.length === 0 && chain !== v.chainHead) {
      errors.push({
        code: 'attempt_rewrite',
        path: `${path}.chainHead`,
        message: `the recorded chain head "${v.chainHead}" does not match the recomputed chain "${chain}" — the log's history was rewritten (L11)`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(deepCloneJson(v) as unknown as AttemptLog) };
}

/** Serializes an attempt log to canonical JSON bytes (byte-determinism, L9). */
export function serializeAttemptLog(log: AttemptLog): string {
  return canonicalJson(JSON.parse(JSON.stringify(log)) as never);
}

/** Parses + validates canonical bytes back into an attempt log (chain-verified). */
export function parseAttemptLog(bytes: string): SkillResult<AttemptLog> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    return { ok: false, errors: [{ code: 'invalid_type', path: 'attemptLog', message: 'the bytes are not JSON' }] };
  }
  return validateAttemptLog(parsed);
}
