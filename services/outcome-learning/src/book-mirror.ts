/**
 * @tradrl/outcome-learning — the SHADOW BOOK SNAPSHOT MIRROR: the
 * structural mirror of T030's paper account (services/shadow-trading/
 * src/book.ts `ShadowBook`) — the reconciliation's ACCOUNT TRUTH —
 * plus the mark facts the market-move attribution consumes.
 *
 * THE IMPORT LAW: T030's book is READ-ONLY to this lane and arrives
 * ONLY through this mirror — the outcome-learning service never
 * imports services/shadow-trading; interop.test.ts drives the REAL
 * golden session's book through this mirror (the type-level witness +
 * the runtime guard agreement) and is the drift trip wire.
 *
 * THE RECONCILIATION SEMANTICS (declared): the book snapshot's
 * `realizedPnl` is the ACCOUNT truth; the outcome stream's per-record
 * `realizedOutcome` sum is the LEARNING view. They differ by the
 * GENESIS balance plus the LATE-FILL accruals (T030's declared
 * interpretation: later fills from still-resting orders accrue to the
 * BOOK and the run record, not retroactively to the outcome record).
 * The reconciliation QUANTIFIES the delta exactly (`accrualDelta`) —
 * it never assumes it away and never invents a decomposition.
 */

import { isCanonicalSignedDecimal, isCanonicalUnsignedDecimal, isNonEmptyString, isRecord, isTimestampMs, type TimestampMs } from './imports';

// ---------------------------------------------------------------------------
// The book snapshot mirror (T030's ShadowBook, mirrored field for field)
// ---------------------------------------------------------------------------

/** One held position in the shadow book (the netting key is (venue, instrument)). */
export interface ShadowPositionMirror {
  readonly venue: string;
  readonly instrument: string;
  /** Held quantity, non-negative canonical decimal. */
  readonly quantity: string;
  /** Total cost basis of the held quantity, non-negative canonical decimal. */
  readonly costBasis: string;
  /** The instant the position was opened (epoch ms). */
  readonly openedAt: TimestampMs;
}

/** The shadow book snapshot: the paper account's whole state at an instant (T030's ShadowBook, mirrored). */
export interface ShadowBookSnapshotMirror {
  readonly positions: readonly ShadowPositionMirror[];
  /** Quote-currency cash, non-negative canonical decimal. */
  readonly cash: string;
  /** Realized PnL accumulated over fills, SIGNED canonical decimal. */
  readonly realizedPnl: string;
  /** The snapshot's instant (epoch ms — no ambient clock). */
  readonly asOf: TimestampMs;
}

/** Guard: a position. */
export function isShadowPositionMirror(v: unknown): v is ShadowPositionMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.venue) || !isNonEmptyString(v.instrument)) return false;
  if (typeof v.quantity === 'number' || typeof v.costBasis === 'number') return false;
  if (typeof v.quantity !== 'string' || !isCanonicalUnsignedDecimal(v.quantity)) return false;
  if (typeof v.costBasis !== 'string' || !isCanonicalUnsignedDecimal(v.costBasis)) return false;
  if (!isTimestampMs(v.openedAt)) return false;
  return true;
}

/** Guard: a book snapshot (T030's isShadowBook law-for-law; the netting discipline included). */
export function isShadowBookSnapshotMirror(v: unknown): v is ShadowBookSnapshotMirror {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.positions) || !v.positions.every((x) => isShadowPositionMirror(x))) return false;
  const seen = new Set<string>();
  for (const position of v.positions) {
    const key = `${position.venue}|${position.instrument}`;
    if (seen.has(key)) return false; // the netting discipline (T030's law, mirrored)
    seen.add(key);
  }
  if (typeof v.cash === 'number') return false;
  if (typeof v.cash !== 'string' || !isCanonicalUnsignedDecimal(v.cash)) return false;
  if (typeof v.realizedPnl === 'number') return false;
  if (typeof v.realizedPnl !== 'string' || !isCanonicalSignedDecimal(v.realizedPnl)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The mark facts (the market-move attribution's typed evidence)
// ---------------------------------------------------------------------------

/**
 * One instrument's mark facts: the reference price at the decision
 * instant and at the outcome window's close (canonical unsigned
 * decimals — prices, never adjectives). Keyed by (venue, instrument);
 * the draft generator pairs them with the decision's side to derive
 * the position-relative direction.
 */
export interface MarkFactsMirror {
  readonly venue: string;
  readonly instrument: string;
  readonly markAtDecision: string;
  readonly markAtWindow: string;
}

/** Guard: mark facts. */
export function isMarkFactsMirror(v: unknown): v is MarkFactsMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.venue) || !isNonEmptyString(v.instrument)) return false;
  if (typeof v.markAtDecision === 'number' || typeof v.markAtWindow === 'number') return false;
  if (typeof v.markAtDecision !== 'string' || !isCanonicalUnsignedDecimal(v.markAtDecision)) return false;
  if (typeof v.markAtWindow !== 'string' || !isCanonicalUnsignedDecimal(v.markAtWindow)) return false;
  return true;
}
