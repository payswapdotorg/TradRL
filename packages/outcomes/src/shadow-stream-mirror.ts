/**
 * @tradrl/outcomes — the SHADOW OUTCOME STREAM MIRROR: the structural
 * mirror of T030's outcome-record surface (services/shadow-trading/
 * src/outcomes.ts) — THIS LANE'S INPUT, consumed mirror-only, never
 * imported (D-003/D-004).
 *
 * THE IMPORT LAW (the Work Order): "Cross-package shapes from
 * T011/T030 are consumed via STRUCTURAL MIRRORS + interop trip-wire
 * tests only — never imports of other workspace packages." The mirrors
 * below are field-for-field identical to T030's public shapes; the
 * service's interop test drives the REAL shadow session (T030's own
 * fixtures) through them and is the drift trip wire.
 *
 * THE BYTE-PRESERVING PHYSICS LINEAGE LAW: the mirrored lineage block
 * ({@link ShadowLineageMirror}) carries T030's block VERBATIM — the
 * mode-honesty fidelity pair, both policy versions, the three config
 * digests, the run binding, the cursor position, the seed, the tenant
 * and the project. Ingestion (services/outcome-learning) copies it
 * BYTE-FOR-BYTE into every learning record; no field is transformed,
 * dropped or re-derived. The interop test asserts deep-equality with
 * the REAL records' lineage blocks.
 *
 * THE CHAIN-VERIFICATION MIRROR: T030's outcome log is append-only and
 * chain-verified (the fold `fnv1a32(priorHead + canonical(content))`
 * over the seed `00000000`). This module re-derives the SAME fold
 * law-for-law ({@link verifyShadowOutcomeChainMirror}) so the learning
 * lane can REFUSE to learn from a tampered stream (the typed
 * `chain_mismatch`) without importing the verifying lane. The interop
 * test asserts the mirror's verdict agrees with T030's REAL
 * `verifyShadowOutcomeChain` over intact AND tampered logs.
 */

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isDigest,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  type JsonValue,
  type TimestampMs,
} from './primitives';

// ---------------------------------------------------------------------------
// The disposition (T030's closed four-member vocabulary, mirrored)
// ---------------------------------------------------------------------------

/** The disposition vocabulary (closed — one of the four outcomes of one decision). */
export type ShadowDispositionMirror = 'filled' | 'refused' | 'partial' | 'expired';

/** Guard: a disposition. */
export function isShadowDispositionMirror(v: unknown): v is ShadowDispositionMirror {
  return v === 'filled' || v === 'refused' || v === 'partial' || v === 'expired';
}

// ---------------------------------------------------------------------------
// The lineage block (T030's ShadowLineage, mirrored field for field)
// ---------------------------------------------------------------------------

/**
 * The shadow lane's L9 lineage block — T030's {@link
 * ShadowLineage} VERBATIM (byte-preserving law): the session ref, the
 * mode-honesty fidelity pair (L5/R23), the T019 execution-policy
 * version, the T020 risk-policy version, the three config digests, the
 * run binding, the time-machine cursor, the determinism seed, and the
 * tenant/project scopes (L12).
 */
export interface ShadowLineageMirror {
  readonly sessionId: string;
  readonly fidelity: { readonly mode: 'shadow'; readonly fill_origin: 'simulated' };
  readonly executionPolicy: { readonly policyId: string; readonly version: number };
  readonly riskPolicy: { readonly policyId: string; readonly version: number };
  readonly configDigests: { readonly worldConfigHash: string; readonly engineConfigHash: string; readonly dataset: string };
  readonly run: { readonly runId: string; readonly episodeId: string };
  readonly cursor: { readonly cursorId: string; readonly position: number };
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

/** Guard: the lineage block (every field present, non-empty and well-formed — T030's `isShadowLineage`, mirrored law-for-law). */
export function isShadowLineageMirror(v: unknown): v is ShadowLineageMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.sessionId) || !(v.sessionId as string).startsWith('shs:')) return false;
  const fidelity = v.fidelity;
  if (!isRecord(fidelity) || fidelity.mode !== 'shadow' || fidelity.fill_origin !== 'simulated') return false;
  const executionPolicy = v.executionPolicy;
  if (!isRecord(executionPolicy) || !isNonEmptyString(executionPolicy.policyId) || typeof executionPolicy.version !== 'number' || !Number.isSafeInteger(executionPolicy.version) || executionPolicy.version < 1) return false;
  const riskPolicy = v.riskPolicy;
  if (!isRecord(riskPolicy) || !isNonEmptyString(riskPolicy.policyId) || typeof riskPolicy.version !== 'number' || !Number.isSafeInteger(riskPolicy.version) || riskPolicy.version < 1) return false;
  const configDigests = v.configDigests;
  if (!isRecord(configDigests) || !isNonEmptyString(configDigests.worldConfigHash) || !isNonEmptyString(configDigests.engineConfigHash) || !isNonEmptyString(configDigests.dataset)) return false;
  const run = v.run;
  if (!isRecord(run) || !isNonEmptyString(run.runId) || !isNonEmptyString(run.episodeId)) return false;
  const cursor = v.cursor;
  if (!isRecord(cursor) || !isNonEmptyString(cursor.cursorId) || typeof cursor.position !== 'number' || !Number.isSafeInteger(cursor.position) || cursor.position < 0) return false;
  if (!isNonEmptyString(v.seed) || !isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The outcome record (T030's ShadowOutcomeRecord, mirrored field for field)
// ---------------------------------------------------------------------------

/** The per-decision cost block (exact decimals over the decision's fills). */
export interface ShadowCostsMirror {
  readonly feeTotal: string;
  readonly notionalTotal: string;
}

/** Guard: the costs block. */
export function isShadowCostsMirror(v: unknown): v is ShadowCostsMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.feeTotal) && isNonEmptyString(v.notionalTotal);
}

/**
 * One shadow outcome record — T033's INPUT, mirrored field for field:
 * the content-addressed id, the append-only ordinal, the intent and
 * decision refs, the refusal ref, the disposition, the fill refs, the
 * exact-decimal costs, the signed realized outcome, the signed
 * unrealized mark context, the chain-continuity witness, the full
 * lineage and the evidence instant.
 */
export interface ShadowOutcomeRecordMirror {
  readonly outcomeId: string;
  readonly ordinal: number;
  readonly intentRef: string;
  readonly decisionRef: string;
  readonly refusalRef: string | null;
  readonly disposition: ShadowDispositionMirror;
  readonly fills: readonly string[];
  readonly costs: ShadowCostsMirror;
  readonly realizedOutcome: string;
  readonly unrealizedAtDecision: string;
  readonly priorChainHead: string;
  readonly lineage: ShadowLineageMirror;
  readonly asOf: TimestampMs;
}

/** Guard: a shadow outcome record (T030's `isShadowOutcomeRecord`, mirrored law-for-law). */
export function isShadowOutcomeRecordMirror(v: unknown): v is ShadowOutcomeRecordMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.outcomeId) || !(v.outcomeId as string).startsWith('swo:')) return false;
  if (typeof v.ordinal !== 'number' || !Number.isSafeInteger(v.ordinal) || v.ordinal < 1) return false;
  if (!isNonEmptyString(v.intentRef) || !isNonEmptyString(v.decisionRef)) return false;
  if (v.refusalRef !== null && !(isNonEmptyString(v.refusalRef) && (v.refusalRef as string).startsWith('swr:'))) return false;
  if (!isShadowDispositionMirror(v.disposition)) return false;
  if (!Array.isArray(v.fills) || !v.fills.every((x) => typeof x === 'string' && x.startsWith('swf-'))) return false;
  if (!isShadowCostsMirror(v.costs)) return false;
  if (!isNonEmptyString(v.realizedOutcome) || !isNonEmptyString(v.unrealizedAtDecision)) return false;
  if (!isNonEmptyString(v.priorChainHead)) return false;
  if (!isShadowLineageMirror(v.lineage)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The outcome log (T030's ShadowOutcomeLog, mirrored) + the chain law
// ---------------------------------------------------------------------------

/** The chain seed of a fresh log (T030's `OUTCOME_CHAIN_SEED`, mirrored). */
export const SHADOW_OUTCOME_CHAIN_SEED_MIRROR = '00000000';

/** The append-only, chain-verified shadow outcome log (T030's `ShadowOutcomeLog`, mirrored). */
export interface ShadowOutcomeLogMirror {
  readonly records: readonly ShadowOutcomeRecordMirror[];
  readonly head: string;
}

/** Guard: a shadow outcome log (structural; the chain law is {@link verifyShadowOutcomeChainMirror}). */
export function isShadowOutcomeLogMirror(v: unknown): v is ShadowOutcomeLogMirror {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.records) || !v.records.every((x) => isShadowOutcomeRecordMirror(x))) return false;
  if (typeof v.head !== 'string' || !isDigest(v.head)) return false;
  return true;
}

/**
 * The canonical content tree of a mirrored shadow outcome record —
 * T030's private `outcomeContentTree`, mirrored field-for-field (the
 * EXACT field set the real fold folds; canonicalJson's key sorting
 * makes the order immaterial). Any drift here breaks the interop
 * chain-parity trip wire loudly.
 */
function shadowOutcomeContentTreeMirror(record: ShadowOutcomeRecordMirror): JsonValue {
  return {
    ordinal: record.ordinal,
    intentRef: record.intentRef,
    decisionRef: record.decisionRef,
    refusalRef: record.refusalRef,
    disposition: record.disposition,
    fills: [...record.fills],
    costs: { feeTotal: record.costs.feeTotal, notionalTotal: record.costs.notionalTotal },
    realizedOutcome: record.realizedOutcome,
    unrealizedAtDecision: record.unrealizedAtDecision,
    priorChainHead: record.priorChainHead,
    lineage: record.lineage as unknown as JsonValue,
    asOf: record.asOf,
  };
}

/** Fold one mirrored record onto a chain head — T030's `foldOutcomeRecord`, mirrored exactly. */
function foldShadowOutcomeMirror(previousHead: string, record: ShadowOutcomeRecordMirror): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(shadowOutcomeContentTreeMirror(record))}`);
}

/**
 * Re-derive the mirrored log's chain from its records — T030's
 * `verifyShadowOutcomeChain` law-for-law: `true` iff the recorded head
 * folds identically. A tampered record, a removed record or a
 * reordered log fails. The learning lane refuses to ingest a stream
 * whose mirror verification fails (the typed `chain_mismatch`).
 */
export function verifyShadowOutcomeChainMirror(log: unknown): boolean {
  if (!isRecord(log) || !Array.isArray(log.records) || typeof log.head !== 'string') return false;
  let head = SHADOW_OUTCOME_CHAIN_SEED_MIRROR;
  for (let index = 0; index < log.records.length; index++) {
    const record = log.records[index];
    if (!isShadowOutcomeRecordMirror(record)) return false;
    if (record.ordinal !== index + 1) return false;
    head = foldShadowOutcomeMirror(head, record);
  }
  return head === log.head;
}

/**
 * The digest of a mirrored log's records — T030's `shadowOutcomeDigest`,
 * mirrored field-for-field (the interop byte-parity anchor: the digest
 * of the REAL log computed by the REAL T030 function must equal this
 * mirror's digest over the same records).
 */
export function shadowOutcomeStreamDigestMirror(log: ShadowOutcomeLogMirror): string {
  return fnv1a32Hex(canonicalJson({
    records: log.records.map((record) => ({
      outcomeId: record.outcomeId,
      intentRef: record.intentRef,
      disposition: record.disposition,
      fills: [...record.fills],
      feeTotal: record.costs.feeTotal,
      realizedOutcome: record.realizedOutcome,
    })),
    head: log.head,
  }));
}

// ---------------------------------------------------------------------------
// The fill facts mirror (the caller-supplied per-fill quantity/latency facts)
// ---------------------------------------------------------------------------

/**
 * One decision's order facts — the caller-supplied mirror of what the
 * T018 decision stream carried for the decision (the shadow outcome
 * stream itself does NOT carry the order's quantity or instrument;
 * the caller, who fed the decision stream to the shadow session,
 * supplies them). Every field is exact-decimal or structural; the
 * guards enforce the canonical grammar.
 */
export interface DecisionFactsMirror {
  /** The intent the facts belong to (must match a shadow record's intentRef). */
  readonly intentRef: string;
  /** The T019 decision id (when known; null when the caller only knows the intent). */
  readonly decisionRef: string | null;
  /** The order's venue (opaque). */
  readonly venue: string;
  /** The order's instrument (opaque). */
  readonly instrument: string;
  /** The order's side — the direction of the position the decision built. */
  readonly side: 'buy' | 'sell';
  /** The submitted order quantity, canonical unsigned decimal. */
  readonly orderQuantity: string;
  /** The decision's 1-based position in the decision stream (the intent's sequence). */
  readonly streamPosition: number;
}

/** Guard: decision facts. */
export function isDecisionFactsMirror(v: unknown): v is DecisionFactsMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.intentRef)) return false;
  if (v.decisionRef !== null && !isNonEmptyString(v.decisionRef)) return false;
  if (!isNonEmptyString(v.venue) || !isNonEmptyString(v.instrument)) return false;
  if (v.side !== 'buy' && v.side !== 'sell') return false;
  if (typeof v.orderQuantity === 'number') return false;
  if (typeof v.orderQuantity !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(v.orderQuantity)) return false;
  if (typeof v.streamPosition !== 'number' || !Number.isSafeInteger(v.streamPosition) || v.streamPosition < 1) return false;
  return true;
}

/**
 * One fill's facts — the caller-supplied mirror of the session's public
 * fill record: the executed quantity (VERBATIM from the world fill) and
 * the fill's availability instant (the L4 latency evidence the data-lag
 * attribution consumes).
 */
export interface FillFactsMirror {
  /** The fill's id (`swf-`-prefixed; must match a shadow record's fills entry). */
  readonly fillId: string;
  /** The owning intent. */
  readonly intentRef: string;
  /** The executed quantity, canonical unsigned decimal (verbatim from the world fill). */
  readonly quantity: string;
  /** The fill's availability instant (the latency window's boundary). */
  readonly availableAt: TimestampMs;
}

/** Guard: fill facts. */
export function isFillFactsMirror(v: unknown): v is FillFactsMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.fillId) || !(v.fillId as string).startsWith('swf-')) return false;
  if (!isNonEmptyString(v.intentRef)) return false;
  if (typeof v.quantity === 'number') return false;
  if (typeof v.quantity !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(v.quantity)) return false;
  if (!isTimestampMs(v.availableAt)) return false;
  return true;
}

/** A convenience re-export (the mirror modules share the timestamp brand). */
export type { TimestampMs };

/** Deep-freeze helper re-export for mirror assembly sites. */
export { deepFreeze };
