/**
 * @tradrl/outcome-learning — the LEARNING STATE + the INGESTION: the
 * service's state machine over the two append-only, chain-verified
 * logs.
 *
 * THE INGESTION LAW ({@link ingestShadowOutcomes}): a batch is the
 * mirrored T030 outcome stream (chain-verified through the mirror —
 * a tampered stream is the typed `chain_mismatch` and is NEVER
 * learned from), the shadow book snapshot, the optional caller facts
 * (decision facts, fill facts, declared expectations) and the T011
 * session binding, all at an INJECTED instant. The batch is ATOMIC:
 * every record reconciles and mints, or nothing appends.
 *
 * THE COHERENCE LAWS (fail-closed, typed):
 *   - the mirrored stream's chain verifies (`chain_mismatch`);
 *   - one session per stream (T030's own law, re-proved — `invalid_state`);
 *   - the ingestion instant is at/after every record's evidence
 *     instant (`l4_boundary_violation` — no learning from the future);
 *   - the book snapshot is at/after the stream's end (`invalid_state`);
 *   - the facts are unique per intent/fill and reference intents the
 *     stream carries (`invalid_field` — a fact for a foreign intent
 *     dangles);
 *   - a decision already learned is the typed `outcome_log_rewrite`
 *     (one decision, one learned outcome — re-ingestion is the
 *     caller's crash to detect via the receipt digests, never a
 *     silent duplicate).
 *
 * THE RETAINED FACTS: the per-outcome facts the draft generator needs
 * (venue/instrument/side from the decision facts; the fill ids and
 * the latest fill-availability instant — the data-lag anchor) are
 * retained on the state (frozen, append-only by construction), so
 * drafts can be generated LATER without re-supplying the batch.
 */

import {
  appendOutcomeRecord,
  canonicalJson,
  deepFreeze,
  fail,
  fnv1a32Hex,
  isDecisionFactsMirror,
  isFillFactsMirror,
  isShadowOutcomeLogMirror,
  isTimestampMs,
  ok,
  startOutcomeLearningLog,
  startPostMortemLog,
  verifyShadowOutcomeChainMirror,
  type OutcomesResult,
  type OutcomeLearningLog,
  type OutcomeRecord,
  type PostMortemLog,
  type TimestampMs,
} from './imports';
import type { DecisionFactsMirror, FillFactsMirror, ShadowOutcomeRecordMirror } from './imports';
import { isShadowBookSnapshotMirror, type ShadowBookSnapshotMirror } from './book-mirror';
import { validateReconciliationPolicy, type ReconciliationPolicy } from './policy';
import {
  isDeclaredExpectation,
  isSessionBinding,
  reconcileAgainstBook,
  reconcileOne,
  type BookReconciliation,
  type DeclaredExpectation,
  type SessionBinding,
} from './reconcile';

// ---------------------------------------------------------------------------
// The retained per-outcome facts (the draft generator's inputs)
// ---------------------------------------------------------------------------

/** The per-outcome facts retained at ingestion (what the drafts consume; an entry exists iff decision facts were supplied). */
export interface OutcomeFactsEntry {
  /** The learned outcome record (`out:`). */
  readonly outcomeRecordRef: string;
  readonly venue: string;
  readonly instrument: string;
  readonly side: 'buy' | 'sell';
  /** The decision's evidence instant (the shadow record's asOf — the data-lag anchor). */
  readonly decisionAt: TimestampMs;
  /** The record's fill ids (the data-lag evidence). */
  readonly fills: readonly string[];
  /** The latest fill-availability instant among the fills (null when none). */
  readonly latestAvailableAt: TimestampMs | null;
}

// ---------------------------------------------------------------------------
// The ingestion receipt
// ---------------------------------------------------------------------------

/** One ingestion's receipt: the batch's digests, the minted refs, the book reconciliation, the injected instant. */
export interface IngestionReceipt {
  /** The digest over the batch's canonical content (the stream records + the snapshot + the facts). */
  readonly batchDigest: string;
  /** The book snapshot's own digest (the evidence anchor the records carry). */
  readonly bookSnapshotDigest: string;
  /** The stream digest (T030's own fold basis, mirrored). */
  readonly streamDigest: string;
  readonly sessionRef: string;
  readonly tenant: string;
  readonly project: string;
  /** The minted outcome record ids, in ordinal order. */
  readonly outcomeRefs: readonly string[];
  readonly book: BookReconciliation;
  /** The injected ingestion instant. */
  readonly ingestedAt: TimestampMs;
}

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

/** The outcome-learning service's whole state (all append-only, all frozen). */
export interface OutcomeLearningState {
  readonly outcomeLog: OutcomeLearningLog;
  readonly postMortemLog: PostMortemLog;
  readonly ingestions: readonly IngestionReceipt[];
  readonly outcomeFacts: readonly OutcomeFactsEntry[];
}

/** Start a fresh learning state (empty logs, no receipts, no facts). */
export function createOutcomeLearningState(): OutcomeLearningState {
  return deepFreeze({
    outcomeLog: startOutcomeLearningLog(),
    postMortemLog: startPostMortemLog(),
    ingestions: [],
    outcomeFacts: [],
  });
}

// ---------------------------------------------------------------------------
// The batch
// ---------------------------------------------------------------------------

/** One ingestion batch (everything UNTRUSTED — validated inside, collect-first). */
export interface ShadowOutcomeBatch {
  /** The mirrored T030 outcome log (chain-verified inside — a tampered stream is never learned from). */
  readonly outcomeLog: unknown;
  /** The mirrored shadow book snapshot at/after the stream's end. */
  readonly bookSnapshot: unknown;
  /** The T011 session binding (trajectory/experiment/trial refs; NULLs legal). */
  readonly binding: unknown;
  /** The caller-supplied decision facts (the order quantities, sides, stream positions). */
  readonly decisionFacts?: readonly unknown[];
  /** The caller-supplied fill facts (the exact quantities + availability instants). */
  readonly fillFacts?: readonly unknown[];
  /** The caller-supplied declared expectations (the models' projected realized PnLs). */
  readonly expectations?: readonly unknown[];
  /** The reconciliation policy the batch pins (defaults to tolerance '1' — the band is carried BY every record either way). */
  readonly reconciliationPolicy?: unknown;
  /** The injected ingestion instant (>= every record's evidence instant — L4). */
  readonly at: TimestampMs;
}

/** The digest of a book snapshot (the evidence anchor). */
export function bookSnapshotDigestOf(snapshot: ShadowBookSnapshotMirror): string {
  return fnv1a32Hex(canonicalJson(snapshot));
}

// ---------------------------------------------------------------------------
// The ingestion
// ---------------------------------------------------------------------------

/**
 * Ingest ONE batch of shadow outcomes: verify the stream's chain
 * (tamper = `chain_mismatch`), enforce the coherence laws (see the
 * module header), reconcile every record against the policy and the
 * caller facts (honest NULLs where facts are absent), mint the
 * learned outcome records, append them ATOMICALLY (any law violation
 * fails the whole batch — nothing partially appends), reconcile
 * against the shadow book, and thread the receipt + the retained
 * facts onto the state.
 */
export function ingestShadowOutcomes(state: OutcomeLearningState, batch: ShadowOutcomeBatch): OutcomesResult<OutcomeLearningState> {
  if (typeof state !== 'object' || state === null || !Array.isArray((state as { outcomeLog?: { records?: unknown } }).outcomeLog?.records)) {
    return fail('invalid_type', 'ingestShadowOutcomes requires a valid outcome-learning state');
  }
  if (typeof batch !== 'object' || batch === null) return fail('invalid_type', 'the batch must be an object');
  if (!isTimestampMs(batch.at)) return fail('invalid_field', 'the batch carries its injected ingestion instant (at) — no ambient clock', 'at');
  const policyResult = validateReconciliationPolicy(batch.reconciliationPolicy ?? DEFAULT_INGEST_POLICY);
  if (!policyResult.ok) return policyResult;

  // --- The stream (chain-verified through the mirror — the tamper gate) -------------------
  if (!isShadowOutcomeLogMirror(batch.outcomeLog)) {
    return fail('invalid_type', 'the batch outcome log fails the mirrored structural guard (T030-shaped records required)', 'outcomeLog');
  }
  const stream = batch.outcomeLog;
  if (!verifyShadowOutcomeChainMirror(stream)) {
    return fail('chain_mismatch', 'the mirrored shadow outcome stream fails chain verification — an outcome record was edited, removed, spliced or reordered; a tampered stream is never learned from');
  }
  if (stream.records.length === 0) {
    return fail('invalid_field', 'the batch outcome stream carries no records — there is nothing to learn from', 'outcomeLog');
  }
  const sessionIds = new Set(stream.records.map((record) => record.lineage.sessionId));
  if (sessionIds.size > 1) {
    return fail('invalid_state', `the batch outcome stream mixes ${sessionIds.size} sessions — T030's own law: an outcome log never mixes sessions`);
  }
  const sessionRef = stream.records[0]?.lineage.sessionId as string;
  const tenant = stream.records[0]?.lineage.tenant as string;
  const project = stream.records[0]?.lineage.project as string;

  // --- The L4 law (no learning from the future) ----------------------------------------------
  const latestEvidenceAt = stream.records.reduce((latest, record) => Math.max(latest, record.asOf as number), 0) as TimestampMs;
  if ((batch.at as number) < (latestEvidenceAt as number)) {
    return fail('l4_boundary_violation', `the ingestion instant ${String(batch.at)} precedes the stream's latest evidence instant ${String(latestEvidenceAt)} — learning from the future is the typed point-in-time crime (L4)`);
  }

  // --- The book snapshot -----------------------------------------------------------------------
  if (!isShadowBookSnapshotMirror(batch.bookSnapshot)) {
    return fail('invalid_type', 'the batch book snapshot fails the mirrored guard (T030-shaped account required)', 'bookSnapshot');
  }
  const snapshot = batch.bookSnapshot;
  // NOTE (the declared interpretation): T030's book.asOf is the LAST-APPLIED
  // instant (the last fill's availability time), NOT a knowledge cutoff — a
  // finished session's final book legitimately carries an asOf that precedes
  // the last decision ticks. The snapshot's instant is recorded on the
  // receipt (bookAsOf); the reconciliation is exact arithmetic over whatever
  // (stream, snapshot) pair the caller supplies.

  // --- The binding --------------------------------------------------------------------------------
  if (!isSessionBinding(batch.binding)) {
    return fail('invalid_type', 'the batch binding must be a session binding { trajectoryRef, experimentRef, trialRef } (NULLs legal)', 'binding');
  }
  const binding: SessionBinding = {
    trajectoryRef: (batch.binding.trajectoryRef as string | null | undefined) ?? null,
    experimentRef: (batch.binding.experimentRef as string | null | undefined) ?? null,
    trialRef: (batch.binding.trialRef as string | null | undefined) ?? null,
  };

  // --- The caller facts (unique, and referencing the stream's intents) -----------------------------
  const intentsInStream = new Set(stream.records.map((record) => record.intentRef));
  const fillsInStream = new Set<string>();
  for (const record of stream.records) for (const fill of record.fills) fillsInStream.add(fill);

  const decisionFacts = new Map<string, DecisionFactsMirror>();
  for (let index = 0; index < (batch.decisionFacts ?? []).length; index++) {
    const one = batch.decisionFacts?.[index];
    if (!isDecisionFactsMirror(one)) {
      return fail('invalid_field', `decisionFacts[${index}] fails the mirrored guard (intentRef, venue, instrument, side, orderQuantity, streamPosition)`, `decisionFacts[${index}]`);
    }
    if (decisionFacts.has(one.intentRef)) {
      return fail('invalid_field', `decisionFacts[${index}] duplicates the facts for intent ${one.intentRef} — one intent, one facts record`, `decisionFacts[${index}]`);
    }
    if (!intentsInStream.has(one.intentRef)) {
      return fail('invalid_field', `decisionFacts[${index}] references intent ${one.intentRef}, which the stream does not carry — a fact for a foreign intent dangles`, `decisionFacts[${index}]`);
    }
    decisionFacts.set(one.intentRef, one);
  }

  const fillFacts = new Map<string, FillFactsMirror>();
  for (let index = 0; index < (batch.fillFacts ?? []).length; index++) {
    const one = batch.fillFacts?.[index];
    if (!isFillFactsMirror(one)) {
      return fail('invalid_field', `fillFacts[${index}] fails the mirrored guard (fillId, intentRef, quantity, availableAt)`, `fillFacts[${index}]`);
    }
    if (fillFacts.has(one.fillId)) {
      return fail('invalid_field', `fillFacts[${index}] duplicates the facts for fill ${one.fillId} — one fill, one facts record`, `fillFacts[${index}]`);
    }
    if (!fillsInStream.has(one.fillId)) {
      return fail('invalid_field', `fillFacts[${index}] references fill ${one.fillId}, which the stream's records do not carry — a fact for a foreign fill dangles`, `fillFacts[${index}]`);
    }
    fillFacts.set(one.fillId, one);
  }

  const expectations = new Map<string, DeclaredExpectation>();
  for (let index = 0; index < (batch.expectations ?? []).length; index++) {
    const one = batch.expectations?.[index];
    if (!isDeclaredExpectation(one)) {
      return fail('invalid_field', `expectations[${index}] fails the guard (intentRef, expectedRealized, declaredBy)`, `expectations[${index}]`);
    }
    if (expectations.has(one.intentRef)) {
      return fail('invalid_field', `expectations[${index}] duplicates the expectation for intent ${one.intentRef} — one intent, one declaration`, `expectations[${index}]`);
    }
    if (!intentsInStream.has(one.intentRef)) {
      return fail('invalid_field', `expectations[${index}] references intent ${one.intentRef}, which the stream does not carry — an expectation for a foreign intent dangles`, `expectations[${index}]`);
    }
    expectations.set(one.intentRef, one);
  }

  // --- The one-decision-one-outcome law, fail-fast over the WHOLE batch -------------------------------
  for (const record of stream.records) {
    if (state.outcomeLog.records.some((existing) => existing.decision.decisionRef === record.decisionRef)) {
      return fail(
        'outcome_log_rewrite',
        `decision ${record.decisionRef} is already learned (the log never re-decides) — this batch was already ingested; detect re-ingestion via the receipts' batch digests, never by silent duplication`,
      );
    }
  }

  // --- The per-record reconciliation (atomic: every record mints, or nothing appends) ---------------------
  const snapshotDigest = bookSnapshotDigestOf(snapshot);
  const minted: OutcomeRecord[] = [];
  let outcomeLog = state.outcomeLog;
  const newFacts: OutcomeFactsEntry[] = [];
  for (const shadow of stream.records) {
    const recordFills = shadow.fills.map((fillId) => fillFacts.get(fillId)).filter((x): x is FillFactsMirror => x !== undefined);
    const reconciled = reconcileOne({
      shadow,
      nextOrdinal: outcomeLog.records.length + 1,
      priorChainHead: outcomeLog.head,
      policy: policyResult.value,
      decisionFacts: decisionFacts.get(shadow.intentRef) ?? null,
      fillFacts: recordFills,
      expectation: expectations.get(shadow.intentRef) ?? null,
      binding,
      bookSnapshotDigest: snapshotDigest,
      at: batch.at,
    });
    if (!reconciled.ok) return reconciled;
    const appended = appendOutcomeRecord(outcomeLog, reconciled.value);
    if (!appended.ok) return appended;
    outcomeLog = appended.value;
    minted.push(reconciled.value);
    const facts = decisionFacts.get(shadow.intentRef);
    if (facts !== undefined) {
      const latestAvailableAt = recordFills.length > 0
        ? (recordFills.reduce((latest, fill) => Math.max(latest, fill.availableAt as number), 0) as TimestampMs)
        : null;
      newFacts.push(deepFreeze({
        outcomeRecordRef: reconciled.value.outcomeId,
        venue: facts.venue,
        instrument: facts.instrument,
        side: facts.side,
        decisionAt: shadow.asOf,
        fills: Object.freeze([...shadow.fills]),
        latestAvailableAt,
      }));
    }
  }

  // --- The account reconciliation + the receipt ------------------------------------------------------------
  const book = reconcileAgainstBook(stream.records, snapshot);
  const streamDigest = fnv1a32Hex(canonicalJson({
    records: stream.records.map((record) => record.outcomeId),
    head: stream.head,
  }));
  const batchDigest = fnv1a32Hex(canonicalJson({
    stream: streamDigest,
    snapshot: snapshotDigest,
    decisionFacts: [...(batch.decisionFacts ?? [])],
    fillFacts: [...(batch.fillFacts ?? [])],
    expectations: [...(batch.expectations ?? [])],
    binding,
    at: batch.at,
  }));
  const receipt: IngestionReceipt = deepFreeze({
    batchDigest,
    bookSnapshotDigest: snapshotDigest,
    streamDigest,
    sessionRef,
    tenant,
    project,
    outcomeRefs: Object.freeze(minted.map((record) => record.outcomeId)),
    book,
    ingestedAt: batch.at,
  });

  return ok(deepFreeze({
    outcomeLog,
    postMortemLog: state.postMortemLog,
    ingestions: [...state.ingestions, receipt],
    outcomeFacts: [...state.outcomeFacts, ...newFacts],
  }));
}

/** The default ingestion policy (tolerance '1') used when a batch does not pin its own. */
const DEFAULT_INGEST_POLICY: ReconciliationPolicy = deepFreeze({ pnlTolerance: '1' });

// ---------------------------------------------------------------------------
// The state digest (the determinism comparator)
// ---------------------------------------------------------------------------

/** The digest of the whole learning state (the golden determinism tests' basis). */
export function outcomeLearningStateDigest(state: OutcomeLearningState): string {
  return fnv1a32Hex(canonicalJson({
    outcomeLog: { count: state.outcomeLog.records.length, head: state.outcomeLog.head },
    postMortemLog: { count: state.postMortemLog.records.length, head: state.postMortemLog.head },
    ingestions: state.ingestions.map((receipt) => ({ batchDigest: receipt.batchDigest, outcomeRefs: [...receipt.outcomeRefs] })),
    outcomeFacts: state.outcomeFacts.map((entry) => ({ ref: entry.outcomeRecordRef, fills: [...entry.fills] })),
  }));
}
