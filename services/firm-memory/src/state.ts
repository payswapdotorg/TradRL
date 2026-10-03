/**
 * @tradrl/firm-memory-service — THE FIRM-MEMORY STATE + THE RECEIPTS:
 * the service's whole state over the two append-only, chain-verified
 * logs, the consumed-evidence ledgers (the idempotence + subject-
 * binding memory) and the ingestion receipts.
 *
 * THE CONSUMED-EVIDENCE LEDGERS (the dedupe basis):
 *   - `consumedPostMortems` — every T033 post-mortem the brain has
 *     consumed, in consumption order (a re-supplied post-mortem is the
 *     typed `duplicate_evidence` — evidence contributes EXACTLY ONCE);
 *   - `consumedOutcomes` — every subject outcome record the brain has
 *     seen (the post-mortem subject-binding ledger: a later batch's
 *     post-mortem may bind to an outcome consumed by an earlier batch —
 *     query windows shift; the binding memory does not).
 *
 * THE RECEIPT ({@link FirmIngestionReceipt}): every ingestion's
 * content-addressed record — the batch digest (idempotence detection:
 * re-ingesting the same batch surfaces the typed `duplicate_evidence`,
 * never a silent double-count), the minted knowledge ids (fresh /
 * revisions / supersessions), the appended contradiction ids, and the
 * injected instant. Receipts are append-only by construction.
 */

import { canonicalJson, deepFreeze, fail, fnv1a32Hex, isRecord, ok, type FirmMemoryResult } from './imports';
import type { OutcomeRecordMirror, TimestampMs } from './imports';
import { startContradictionLog, startFirmKnowledgeLog } from './imports';
import type { ContradictionLog, FirmKnowledgeLog } from './imports';

// ---------------------------------------------------------------------------
// The consumed-evidence ledgers
// ---------------------------------------------------------------------------

/** One consumed post-mortem: the ref + the instant it was consumed. */
export interface ConsumedEvidenceEntry {
  readonly postMortemRef: string;
  readonly consumedAt: TimestampMs;
}

// ---------------------------------------------------------------------------
// The ingestion receipt
// ---------------------------------------------------------------------------

/** One ingestion's receipt: the digests, the minted refs, the injected instant. */
export interface FirmIngestionReceipt {
  /** Content-addressed identity: `fmr:` + digest of the receipt's canonical content. */
  readonly receiptId: string;
  /** The digest over the snapshot's canonical content (the outcome + post-mortem ids + the instant — idempotence detection). */
  readonly batchDigest: string;
  readonly tenant: string;
  readonly project: string;
  /** The knowledge entries minted for NEW families this batch (`fkr:` ids). */
  readonly fresh: readonly string[];
  /** The knowledge entries that ACCUMULATED into existing families (`fkr:` ids — the dedupe fold). */
  readonly revisions: readonly string[];
  /** The knowledge entries that FLIPPED a family through dominating evidence (`fkr:` ids). */
  readonly supersessions: readonly string[];
  /** The contradictions appended to the register this batch (`fkc:` ids). */
  readonly contradictions: readonly string[];
  /** The injected ingestion instant. */
  readonly ingestedAt: TimestampMs;
}

/** Mint a receipt id over the receipt's canonical content (content-addressed, L9). */
export function mintReceipt(receipt: Omit<FirmIngestionReceipt, 'receiptId'>): FirmMemoryReceiptMint {
  const content = {
    batchDigest: receipt.batchDigest,
    tenant: receipt.tenant,
    project: receipt.project,
    fresh: [...receipt.fresh],
    revisions: [...receipt.revisions],
    supersessions: [...receipt.supersessions],
    contradictions: [...receipt.contradictions],
    ingestedAt: receipt.ingestedAt,
  };
  const receiptId = `fmr:${fnv1a32Hex(canonicalJson(content))}`;
  return deepFreeze({ ...receipt, receiptId }) as FirmIngestionReceipt;
}

/** The mint's product (the receipt with its content-addressed id). */
export type FirmMemoryReceiptMint = FirmIngestionReceipt;

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

/** The firm-memory service's whole state (all append-only, all frozen). */
export interface FirmMemoryState {
  readonly knowledgeLog: FirmKnowledgeLog;
  readonly contradictionLog: ContradictionLog;
  readonly ingestions: readonly FirmIngestionReceipt[];
  readonly consumedPostMortems: readonly ConsumedEvidenceEntry[];
  readonly consumedOutcomes: readonly OutcomeRecordMirror[];
}

/** Start a fresh firm-memory state (empty logs, no receipts, no consumed evidence). */
export function createFirmMemoryState(): FirmMemoryState {
  return deepFreeze({
    knowledgeLog: startFirmKnowledgeLog(),
    contradictionLog: startContradictionLog(),
    ingestions: [],
    consumedPostMortems: [],
    consumedOutcomes: [],
  });
}

/** Guard: a firm-memory state (structural). */
export function isFirmMemoryState(v: unknown): v is FirmMemoryState {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.ingestions) || !Array.isArray(v.consumedPostMortems) || !Array.isArray(v.consumedOutcomes)) return false;
  if (!isRecord(v.knowledgeLog) || !Array.isArray(v.knowledgeLog.records)) return false;
  if (!isRecord(v.contradictionLog) || !Array.isArray(v.contradictionLog.records)) return false;
  return true;
}

/** Fail-fast state validation (the ingestion/serving gates' first check). */
export function requireFirmMemoryState(v: unknown): FirmMemoryResult<FirmMemoryState> {
  if (!isFirmMemoryState(v)) return fail('invalid_type', 'the operation requires a valid firm-memory state');
  return ok(v);
}

// ---------------------------------------------------------------------------
// The state digest (the determinism comparator)
// ---------------------------------------------------------------------------

/** The digest of the whole firm-memory state (the golden determinism tests' basis). */
export function firmMemoryStateDigest(state: FirmMemoryState): string {
  return fnv1a32Hex(canonicalJson({
    knowledgeLog: { count: state.knowledgeLog.records.length, head: state.knowledgeLog.head },
    contradictionLog: { count: state.contradictionLog.records.length, head: state.contradictionLog.head },
    ingestions: state.ingestions.map((receipt) => ({ receiptId: receipt.receiptId, batchDigest: receipt.batchDigest })),
    consumedPostMortems: state.consumedPostMortems.map((entry) => entry.postMortemRef),
    consumedOutcomes: state.consumedOutcomes.map((record) => record.outcomeId),
  }));
}
