/**
 * @tradrl/outcomes — THE LEARNING LOGS: the two append-only,
 * chain-verified logs of the learning lane (Work Order T033: the
 * post-mortem history is "append-only, chain-verified like T030's
 * logs").
 *
 * THE FOLD LAW (T030's, mirrored exactly): every append folds the
 * record's canonical content onto the chain head —
 * `fnv1a32(priorHead + canonicalJson(contentTree))` — from the seed
 * `00000000`. A rewrite (an out-of-order ordinal, a re-decision, a
 * spliced record, a foreign chain head, a non-monotonic supersession)
 * is the TYPED crime — `outcome_log_rewrite` for the outcome log,
 * `postmortem_log_rewrite` for the post-mortem log — never a silent
 * edit. Verification ({@link verifyOutcomeLearningChain} /
 * {@link verifyPostMortemChain}) re-derives the whole fold: a tampered
 * record, a removed record or a reordered log fails.
 *
 * THE APPEND LAWS (the outcome log — one decision, one learned
 * outcome, mirroring T030's "one decision, one outcome record"):
 *   1. the record's ordinal is exactly the next position (a splice, a
 *      reorder or a truncation is the crime);
 *   2. the decision is not already recorded — the log never
 *      re-decides;
 *   3. the intent is not already recorded;
 *   4. the record's `priorChainHead` is the log's head (the record was
 *      minted against THIS history).
 *
 * THE APPEND LAWS (the post-mortem log — supersession by append, the
 * T011 trial-progression precedent):
 *   1. the ordinal is exactly the next position;
 *   2. the `priorChainHead` is the log's head;
 *   3. the subject's outcome record EXISTS in the accompanying
 *      outcome log (a post-mortem about an unlearned outcome is the
 *      typed `lineage_gap`);
 *   4. the subject's refs agree with the outcome record's own
 *      decision/intent/class and the lineage's scope agrees (`tenant_mismatch`
 *      on a scope disagreement — L12);
 *   5. the post-mortem's instant is NOT BEFORE the subject outcome's
 *      instant (L4 — `l4_boundary_violation`); and when it SUPERSEDES
 *      an earlier post-mortem for the same outcome, its instant is
 *      STRICTLY later (`postmortem_log_rewrite` — same-instant
 *      re-drafting is the rewrite crime).
 */

import { fail, ok, type OutcomesResult } from './errors';
import { canonicalJson, deepFreeze, fnv1a32Hex, isDigest, isRecord } from './primitives';
import { isPostMortemRecord, postMortemContentTree, type PostMortemRecord } from './postmortem';
import { isOutcomeRecord, outcomeRecordContentTree, type OutcomeRecord } from './outcome-record';

// ---------------------------------------------------------------------------
// The outcome-learning log
// ---------------------------------------------------------------------------

/** The chain seed of a fresh outcome-learning log (T030's seed, mirrored). */
export const OUTCOME_LEARNING_CHAIN_SEED = '00000000';

/** The append-only, chain-verified outcome-learning log. */
export interface OutcomeLearningLog {
  readonly records: readonly OutcomeRecord[];
  /** The chain head (the fold over every record's canonical content; the seed before any record). */
  readonly head: string;
}

/** Start a fresh outcome-learning log (no records; head = the seed). */
export function startOutcomeLearningLog(): OutcomeLearningLog {
  return deepFreeze({ records: [], head: OUTCOME_LEARNING_CHAIN_SEED });
}

/** Fold one outcome record onto the chain head. */
function foldOutcomeLearningRecord(previousHead: string, record: OutcomeRecord): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(outcomeRecordContentTree(record))}`);
}

/**
 * Append ONE outcome record — the append-only law's enforcement site.
 * Fails with the typed `outcome_log_rewrite` when: the ordinal is not
 * the next position; the decision or the intent is already recorded
 * (one decision, one learned outcome); or the record was minted
 * against a different history (priorChainHead mismatch).
 */
export function appendOutcomeRecord(log: OutcomeLearningLog, record: unknown): OutcomesResult<OutcomeLearningLog> {
  if (!isRecord(log) || !Array.isArray(log.records) || typeof log.head !== 'string' || !isDigest(log.head)) {
    return fail('invalid_type', 'appendOutcomeRecord requires a valid outcome-learning log');
  }
  if (!isOutcomeRecord(record)) {
    return fail('invalid_type', 'appendOutcomeRecord requires a structurally valid outcome record');
  }
  const expectedOrdinal = log.records.length + 1;
  if (record.ordinal !== expectedOrdinal) {
    return fail(
      'outcome_log_rewrite',
      `outcome record ${record.outcomeId} claims ordinal ${record.ordinal}, but the log's next position is ${expectedOrdinal} — the outcome log is append-only; splicing, reordering and truncation are the typed rewrite crime`,
    );
  }
  const existingDecision = log.records.find((existing) => existing.decision.decisionRef === record.decision.decisionRef);
  if (existingDecision !== undefined) {
    return fail(
      'outcome_log_rewrite',
      `decision ${record.decision.decisionRef} is already recorded at ordinal ${existingDecision.ordinal} — one decision, one learned outcome (the log never re-decides)`,
    );
  }
  const existingIntent = log.records.find((existing) => existing.decision.intentRef === record.decision.intentRef);
  if (existingIntent !== undefined) {
    return fail(
      'outcome_log_rewrite',
      `intent ${record.decision.intentRef} is already recorded at ordinal ${existingIntent.ordinal} — one intent, one learned outcome`,
    );
  }
  if (record.priorChainHead !== log.head) {
    return fail(
      'outcome_log_rewrite',
      `outcome record ${record.outcomeId} was minted against chain head ${record.priorChainHead}, but the log's head is ${log.head} — the record belongs to a different history (rewrite)`,
    );
  }
  const head = foldOutcomeLearningRecord(log.head, record);
  return ok(deepFreeze({ records: [...log.records, record], head }));
}

/**
 * Re-derive the outcome log's chain from its records. `true` iff the
 * recorded head folds identically — a tampered record, a removed
 * record or a reordered log fails (the verification gate's tamper
 * anchor).
 */
export function verifyOutcomeLearningChain(log: unknown): boolean {
  if (!isRecord(log) || !Array.isArray(log.records) || typeof log.head !== 'string') return false;
  let head = OUTCOME_LEARNING_CHAIN_SEED;
  for (let index = 0; index < log.records.length; index++) {
    const record = log.records[index];
    if (!isOutcomeRecord(record)) return false;
    if (record.ordinal !== index + 1) return false;
    head = foldOutcomeLearningRecord(head, record);
  }
  return head === log.head;
}

/** Guard: an outcome-learning log (structural; the chain law is {@link verifyOutcomeLearningChain}). */
export function isOutcomeLearningLog(v: unknown): v is OutcomeLearningLog {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.records) || !v.records.every((x) => isOutcomeRecord(x))) return false;
  if (typeof v.head !== 'string' || !isDigest(v.head)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The post-mortem log
// ---------------------------------------------------------------------------

/** The chain seed of a fresh post-mortem log (T030's seed, mirrored). */
export const POSTMORTEM_CHAIN_SEED = '00000000';

/** The append-only, chain-verified post-mortem log. */
export interface PostMortemLog {
  readonly records: readonly PostMortemRecord[];
  readonly head: string;
}

/** Start a fresh post-mortem log (no records; head = the seed). */
export function startPostMortemLog(): PostMortemLog {
  return deepFreeze({ records: [], head: POSTMORTEM_CHAIN_SEED });
}

/** Fold one post-mortem record onto the chain head. */
function foldPostMortemRecord(previousHead: string, record: PostMortemRecord): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(postMortemContentTree(record))}`);
}

/**
 * Append ONE post-mortem record — the append-only law's enforcement
 * site (supersession by append; see the module header for the five
 * laws). The accompanying OUTCOME log binds the subject: a post-mortem
 * whose subject outcome is absent is the typed `lineage_gap`; a scope
 * disagreement with the subject is the typed `tenant_mismatch` (L12);
 * a post-mortem stamped before its outcome is the typed
 * `l4_boundary_violation`; a same-instant re-draft is the typed
 * `postmortem_log_rewrite`.
 */
export function appendPostMortem(outcomeLog: OutcomeLearningLog, log: PostMortemLog, record: unknown): OutcomesResult<PostMortemLog> {
  if (!isRecord(outcomeLog) || !Array.isArray(outcomeLog.records)) {
    return fail('invalid_type', 'appendPostMortem requires the accompanying outcome-learning log (the subject binding)');
  }
  if (!isRecord(log) || !Array.isArray(log.records) || typeof log.head !== 'string' || !isDigest(log.head)) {
    return fail('invalid_type', 'appendPostMortem requires a valid post-mortem log');
  }
  if (!isPostMortemRecord(record)) {
    return fail('invalid_type', 'appendPostMortem requires a structurally valid post-mortem record');
  }
  const expectedOrdinal = log.records.length + 1;
  if (record.ordinal !== expectedOrdinal) {
    return fail(
      'postmortem_log_rewrite',
      `post-mortem ${record.postMortemId} claims ordinal ${record.ordinal}, but the log's next position is ${expectedOrdinal} — the post-mortem log is append-only; splicing, reordering and truncation are the typed rewrite crime`,
    );
  }
  if (record.priorChainHead !== log.head) {
    return fail(
      'postmortem_log_rewrite',
      `post-mortem ${record.postMortemId} was minted against chain head ${record.priorChainHead}, but the log's head is ${log.head} — the record belongs to a different history (rewrite)`,
    );
  }
  const subject = outcomeLog.records.find((existing) => existing.outcomeId === record.subject.outcomeRecordRef);
  if (subject === undefined) {
    return fail(
      'lineage_gap',
      `post-mortem ${record.postMortemId} subjects outcome ${record.subject.outcomeRecordRef}, which the outcome-learning log does not carry — a post-mortem about an unlearned outcome dangles`,
    );
  }
  if (subject.decision.decisionRef !== record.subject.decisionRef || subject.decision.intentRef !== record.subject.intentRef || subject.outcomeClass !== record.subject.outcomeClass) {
    return fail(
      'lineage_gap',
      `post-mortem ${record.postMortemId}'s subject disagrees with outcome ${subject.outcomeId}'s own decision/intent/class — the subject binding is exact`,
    );
  }
  if (subject.tenant !== record.lineage.tenant || subject.project !== record.lineage.project) {
    return fail(
      'tenant_mismatch',
      `post-mortem ${record.postMortemId} declares ${record.lineage.tenant}/${record.lineage.project} but its subject outcome carries ${subject.tenant}/${subject.project} — a cross-scope post-mortem is inexpressible (L12)`,
    );
  }
  if ((record.asOf as number) < (subject.asOf as number)) {
    return fail(
      'l4_boundary_violation',
      `post-mortem ${record.postMortemId} is stamped ${String(record.asOf)} but its subject outcome was learned at ${String(subject.asOf)} — a post-mortem cannot predate the outcome it explains (L4)`,
    );
  }
  const priorForSameSubject = log.records.filter((existing) => existing.subject.outcomeRecordRef === record.subject.outcomeRecordRef);
  if (priorForSameSubject.some((existing) => (record.asOf as number) <= (existing.asOf as number))) {
    const latest = priorForSameSubject[priorForSameSubject.length - 1] as PostMortemRecord;
    return fail(
      'postmortem_log_rewrite',
      `post-mortem ${record.postMortemId} supersedes ${latest.postMortemId} for outcome ${record.subject.outcomeRecordRef} at a non-later instant (${String(record.asOf)} <= ${String(latest.asOf)}) — supersession is by STRICTLY forward append only (the raw history is retained, never rewritten)`,
    );
  }
  const head = foldPostMortemRecord(log.head, record);
  return ok(deepFreeze({ records: [...log.records, record], head }));
}

/**
 * Re-derive the post-mortem log's chain from its records. `true` iff
 * the recorded head folds identically (tamper anchor).
 */
export function verifyPostMortemChain(log: unknown): boolean {
  if (!isRecord(log) || !Array.isArray(log.records) || typeof log.head !== 'string') return false;
  let head = POSTMORTEM_CHAIN_SEED;
  for (let index = 0; index < log.records.length; index++) {
    const record = log.records[index];
    if (!isPostMortemRecord(record)) return false;
    if (record.ordinal !== index + 1) return false;
    head = foldPostMortemRecord(head, record);
  }
  return head === log.head;
}

/** Guard: a post-mortem log (structural; the chain law is {@link verifyPostMortemChain}). */
export function isPostMortemLog(v: unknown): v is PostMortemLog {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.records) || !v.records.every((x) => isPostMortemRecord(x))) return false;
  if (typeof v.head !== 'string' || !isDigest(v.head)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The digests (determinism comparators)
// ---------------------------------------------------------------------------

/** The digest of an outcome-learning log's records (the determinism comparator's basis). */
export function outcomeLearningLogDigest(log: OutcomeLearningLog): string {
  return fnv1a32Hex(canonicalJson({
    records: log.records.map((record) => ({
      outcomeId: record.outcomeId,
      decisionRef: record.decision.decisionRef,
      outcomeClass: record.outcomeClass,
      realizedOutcome: record.realization.realizedOutcome,
    })),
    head: log.head,
  }));
}

/** The digest of a post-mortem log's records (the determinism comparator's basis). */
export function postMortemLogDigest(log: PostMortemLog): string {
  return fnv1a32Hex(canonicalJson({
    records: log.records.map((record) => ({
      postMortemId: record.postMortemId,
      subject: record.subject.outcomeRecordRef,
      hypotheses: record.hypotheses.map((hypothesis) => ({ class: hypothesis.class, confidence: hypothesis.confidence })),
    })),
    head: log.head,
  }));
}
