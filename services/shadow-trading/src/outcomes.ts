/**
 * @tradrl/shadow_trading — the OUTCOME RECORDS: T033's input surface.
 *
 * THE WORK ORDER'S LAW: "ShadowOutcomeRecord (T033's input): per
 * decision — decision ref, disposition (filled | refused | partial |
 * expired), fills, costs, realized outcome, full L9 lineage (session
 * ref, config digests, chain heads, seed), tenant/project. Append-only
 * outcome log; rewrite/reorder = typed `shadow_log_rewrite`."
 *
 * THE DISPOSITION SEMANTICS (declared):
 *   - `refused` — the control stack (T019 gate or T020 risk) refused
 *     the decision BEFORE any submission: zero world submissions,
 *     zero fill records.
 *   - `filled` — the approved order's submitted quantity was fully
 *     filled within the decision's outcome window (the tick).
 *   - `partial` — strictly part of the submitted quantity filled.
 *   - `expired` — the approved order produced zero fills within the
 *     decision's outcome window (a venue reject is dead-on-arrival;
 *     a resting-but-unfilled order at window close is declared
 *     expired — the closed vocabulary's honest member; later fills
 *     from a still-resting order accrue to the BOOK and the run
 *     record, not retroactively to this record).
 *
 * THE APPEND-ONLY LAW: the outcome log is a chain-verified append-only
 * structure. Every append folds the record's canonical content onto
 * the chain head; the resume gate re-derives the fold. A rewrite
 * (re-appending a recorded decision, an out-of-order ordinal, a
 * spliced record, a truncated or padded log) is the typed
 * `shadow_log_rewrite` — never a silent edit.
 *
 * L5/R23: every outcome record carries the mode-honesty block
 * (`mode: 'shadow'`, `fill_origin: 'simulated'`) — shadow evidence is
 * never conflated with live evidence downstream.
 */

import { canonicalJson, deepFreeze, fnv1a32Hex, isDigest, isNonEmptyString, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { type ShadowResult, fail, ok } from './errors';
import { isShadowOutcomeRecordId, isShadowRefusalId, isShadowSessionId, mintShadowOutcomeRecordId, mintShadowRefusalId } from './ids';
import { isShadowFidelityBlock } from './mode';
import { isReactiveFillMirror, type ReactiveFillMirror } from './world-mirror';

// ---------------------------------------------------------------------------
// The dispositions
// ---------------------------------------------------------------------------

/** The disposition vocabulary (closed — one of the four outcomes of one decision). */
export type ShadowDisposition = 'filled' | 'refused' | 'partial' | 'expired';

/** Guard: a disposition. */
export function isShadowDisposition(v: unknown): v is ShadowDisposition {
  return v === 'filled' || v === 'refused' || v === 'partial' || v === 'expired';
}

// ---------------------------------------------------------------------------
// The shadow fill (a world fill carried into the shadow record space)
// ---------------------------------------------------------------------------

/** The shadow lane's L9 lineage block (every fill, refusal and outcome carries it). */
export interface ShadowLineage {
  /** The owning shadow session. */
  readonly sessionId: string;
  /** The mode-honesty block (L5/R23). */
  readonly fidelity: { readonly mode: 'shadow'; readonly fill_origin: 'simulated' };
  /** The T019 execution policy version that gated the decision. */
  readonly executionPolicy: { readonly policyId: string; readonly version: number };
  /** The T020 risk policy version that measured the exposure. */
  readonly riskPolicy: { readonly policyId: string; readonly version: number };
  /** The config digests (the world's config hash + the engine physics hash + the machine dataset). */
  readonly configDigests: { readonly worldConfigHash: string; readonly engineConfigHash: string; readonly dataset: string };
  /** The run binding (the world's run id + the episode). */
  readonly run: { readonly runId: string; readonly episodeId: string };
  /** The time-machine cursor the session consumes. */
  readonly cursor: { readonly cursorId: string; readonly position: number };
  /** The deterministic seed (the session's determinism contract anchor). */
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

/** Guard: the lineage block (every field present and non-empty). */
export function isShadowLineage(v: unknown): v is ShadowLineage {
  if (!isRecord(v)) return false;
  if (!isShadowSessionId(v.sessionId)) return false;
  if (!isShadowFidelityBlock(v.fidelity)) return false;
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

/**
 * One shadow fill: the WORLD fill VERBATIM (the engine fill + its full
 * physics lineage — preserved, never transformed) plus the shadow
 * lane's binding (the approving decision, the gated intent, the
 * emission ordinal, the visibility/applied instants).
 */
export interface ShadowFill {
  /** Ordinal-minted identity: `swf-` + zero-padded 8-digit ordinal. */
  readonly fillId: string;
  /** The fill ordinal within the session (strictly increasing in emission order). */
  readonly sequence: number;
  /** The world fill record VERBATIM (physics lineage preserved). */
  readonly worldFill: ReactiveFillMirror;
  /** The approving decision this fill derives from. */
  readonly decisionId: string;
  /** The gated strategy intent's identity. */
  readonly intentRef: string;
  /** The fill's availability instant (the latency window's boundary input). */
  readonly availableAt: TimestampMs;
  /** The instant the fill entered the shadow book's knowledge (null while latency-pending). */
  readonly appliedAt: TimestampMs | null;
  readonly lineage: ShadowLineage;
}

/** Guard: a shadow fill (the world fill's own guard included — physics lineage enforced). */
export function isShadowFill(v: unknown): v is ShadowFill {
  if (!isRecord(v)) return false;
  if (typeof v.fillId !== 'string' || !v.fillId.startsWith('swf-')) return false;
  if (typeof v.sequence !== 'number' || !Number.isSafeInteger(v.sequence) || v.sequence < 1) return false;
  if (!isReactiveFillMirror(v.worldFill)) return false;
  if (!isNonEmptyString(v.decisionId) || !isNonEmptyString(v.intentRef)) return false;
  if (!isTimestampMs(v.availableAt)) return false;
  if (v.appliedAt !== null && !isTimestampMs(v.appliedAt)) return false;
  if (!isShadowLineage(v.lineage)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The shadow refusal (a refusal is a RECORD, never an exception)
// ---------------------------------------------------------------------------

/** The refusal vocabulary: which stage of the control stack refused. */
export type ShadowRefusalStage = 'gate' | 'risk';

/** Guard: a refusal stage. */
export function isShadowRefusalStage(v: unknown): v is ShadowRefusalStage {
  return v === 'gate' || v === 'risk';
}

/**
 * One shadow refusal — the composite control-stack record: the T019
 * decision (approve or refuse — the gate stage's own outcome), the
 * T020 limit evaluation (every declared limit's state), the execution
 * limit refusals the risk stage produced (the T019-shaped mirrors,
 * non-empty iff the risk stage refused), and the full shadow lineage.
 * The world NEVER saw the intent (zero submissions, zero fills — the
 * tests assert it).
 */
export interface ShadowRefusal {
  /** Content-addressed identity: `swr:` + digest of the canonical content. */
  readonly refusalId: string;
  /** Which stage refused (the declared order: gate first, risk second). */
  readonly stage: ShadowRefusalStage;
  /** The T019 gate decision over the intent (refuse at stage 'gate'; approve at stage 'risk'). */
  readonly gate: Record<string, unknown>;
  /** The T020 limit evaluation over the measured exposure. */
  readonly risk: Record<string, unknown> | null;
  /** The risk stage's execution-limit refusals (T019's RefusalReason 'limits' mirror shapes). */
  readonly limitRefusals: readonly Record<string, unknown>[];
  /** The gated intent's identity. */
  readonly intentRef: string;
  readonly lineage: ShadowLineage;
  readonly asOf: TimestampMs;
}

/** Guard: a shadow refusal. */
export function isShadowRefusal(v: unknown): v is ShadowRefusal {
  if (!isRecord(v)) return false;
  if (!isShadowRefusalId(v.refusalId)) return false;
  if (!isShadowRefusalStage(v.stage)) return false;
  if (!isRecord(v.gate)) return false;
  if (v.risk !== null && !isRecord(v.risk)) return false;
  if (!Array.isArray(v.limitRefusals) || !v.limitRefusals.every((x) => isRecord(x))) return false;
  if (!isNonEmptyString(v.intentRef)) return false;
  if (!isShadowLineage(v.lineage)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  return true;
}

/** The canonical content tree of a refusal (everything except the content-addressed id). */
function refusalContentTree(refusal: Omit<ShadowRefusal, 'refusalId'>): JsonValue {
  return {
    stage: refusal.stage,
    gate: refusal.gate as unknown as JsonValue,
    risk: refusal.risk === null ? null : (refusal.risk as unknown as JsonValue),
    limitRefusals: refusal.limitRefusals as unknown as JsonValue,
    intentRef: refusal.intentRef,
    lineage: refusal.lineage as unknown as JsonValue,
    asOf: refusal.asOf,
  };
}

/** Mint a refusal (content-addressed id; deeply frozen). */
export function mintShadowRefusal(refusal: Omit<ShadowRefusal, 'refusalId'>): ShadowRefusal {
  const digest = fnv1a32Hex(canonicalJson(refusalContentTree(refusal)));
  return deepFreeze({ ...refusal, refusalId: mintShadowRefusalId(digest) });
}

// ---------------------------------------------------------------------------
// The outcome record (T033's input)
// ---------------------------------------------------------------------------

/** The per-decision cost block (exact decimals over the decision's fills). */
export interface ShadowCosts {
  /** The total taker fee over the decision's fills. */
  readonly feeTotal: string;
  /** The total executed notional at the aggressor price over the decision's fills. */
  readonly notionalTotal: string;
}

/** Guard: the costs block. */
export function isShadowCosts(v: unknown): v is ShadowCosts {
  if (!isRecord(v)) return false;
  return typeof v.feeTotal === 'string' && v.feeTotal !== '' && typeof v.notionalTotal === 'string' && v.notionalTotal !== '';
}

/**
 * One outcome record — THE T033 INPUT: per decision, the disposition,
 * the fills (shadow fill ids — the full records live on the session),
 * the costs, the realized outcome, and the full L9 lineage. JSON-
 * serializable, deeply frozen, lineage-complete; never carries an
 * acceptance verdict (L7 — the engine informs, evaluation decides).
 */
export interface ShadowOutcomeRecord {
  /** Content-addressed identity: `swo:` + digest of the canonical content. */
  readonly outcomeId: string;
  /** 1-based position in the session's outcome sequence (append-only). */
  readonly ordinal: number;
  /** The gated intent's identity (`si:`-prefixed). */
  readonly intentRef: string;
  /** The control stack's decision for this intent (the T019 decision id). */
  readonly decisionRef: string;
  /** The refusal record's id (null iff not refused). */
  readonly refusalRef: string | null;
  readonly disposition: ShadowDisposition;
  /** The decision's fills, in emission order. */
  readonly fills: readonly string[];
  /** The per-decision costs (exact decimals). */
  readonly costs: ShadowCosts;
  /** The realized PnL crystallized by this decision's fills (SIGNED exact decimal; '0' for refusals). */
  readonly realizedOutcome: string;
  /** The book's unrealized PnL at the decision instant (SIGNED exact decimal — the mark context T033 learns against). */
  readonly unrealizedAtDecision: string;
  /** The session's outcome-chain head BEFORE this record was folded (the chain-continuity witness). */
  readonly priorChainHead: string;
  readonly lineage: ShadowLineage;
  readonly asOf: TimestampMs;
}

/** Guard: an outcome record. */
export function isShadowOutcomeRecord(v: unknown): v is ShadowOutcomeRecord {
  if (!isRecord(v)) return false;
  if (!isShadowOutcomeRecordId(v.outcomeId)) return false;
  if (typeof v.ordinal !== 'number' || !Number.isSafeInteger(v.ordinal) || v.ordinal < 1) return false;
  if (!isNonEmptyString(v.intentRef) || !isNonEmptyString(v.decisionRef)) return false;
  if (v.refusalRef !== null && !isShadowRefusalId(v.refusalRef)) return false;
  if (!isShadowDisposition(v.disposition)) return false;
  if (!Array.isArray(v.fills) || !v.fills.every((x) => typeof x === 'string' && x.startsWith('swf-'))) return false;
  if (!isShadowCosts(v.costs)) return false;
  if (typeof v.realizedOutcome !== 'string' || v.realizedOutcome === '') return false;
  if (typeof v.unrealizedAtDecision !== 'string' || v.unrealizedAtDecision === '') return false;
  if (typeof v.priorChainHead !== 'string' || v.priorChainHead === '') return false;
  if (!isShadowLineage(v.lineage)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  return true;
}

/** The canonical content tree of an outcome record (everything except the content-addressed id). */
function outcomeContentTree(record: Omit<ShadowOutcomeRecord, 'outcomeId'>): JsonValue {
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

/** Mint an outcome record (content-addressed id; deeply frozen). */
export function mintShadowOutcomeRecord(record: Omit<ShadowOutcomeRecord, 'outcomeId'>): ShadowOutcomeRecord {
  const digest = fnv1a32Hex(canonicalJson(outcomeContentTree(record)));
  return deepFreeze({ ...record, outcomeId: mintShadowOutcomeRecordId(digest) });
}

// ---------------------------------------------------------------------------
// The append-only outcome log
// ---------------------------------------------------------------------------

/** The chain seed of a fresh log (the session's identity skeleton). */
export const OUTCOME_CHAIN_SEED = '00000000';

/** The append-only, chain-verified outcome log. */
export interface ShadowOutcomeLog {
  readonly records: readonly ShadowOutcomeRecord[];
  /** The chain head (the fold over every record's canonical content; the seed before any record). */
  readonly head: string;
}

/** Start a fresh log (no records; head = the seed). */
export function startShadowOutcomeLog(): ShadowOutcomeLog {
  return deepFreeze({ records: [], head: OUTCOME_CHAIN_SEED });
}

/** Fold one record onto the chain head. */
function foldOutcomeRecord(previousHead: string, record: ShadowOutcomeRecord): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(outcomeContentTree(record))}`);
}

/**
 * Append ONE outcome record — the append-only law's enforcement site.
 * Fails with the typed `shadow_log_rewrite` when:
 *   - the record's ordinal is not exactly the next position (a splice,
 *     a reorder or a truncation);
 *   - the decision was already recorded (one decision, one outcome);
 *   - the record's `priorChainHead` disagrees with the log's head (the
 *     record was minted against a different history);
 *   - the record's lineage's session differs from the log's session
 *     (a foreign record — L12/session scope).
 */
export function appendShadowOutcome(log: ShadowOutcomeLog, record: unknown): ShadowResult<ShadowOutcomeLog> {
  if (!isRecord(log) || !Array.isArray(log.records) || typeof log.head !== 'string' || !isDigest(log.head)) {
    return fail('invalid_type', 'appendShadowOutcome requires a valid outcome log');
  }
  if (!isShadowOutcomeRecord(record)) {
    return fail('invalid_type', 'appendShadowOutcome requires a structurally valid outcome record');
  }
  const expectedOrdinal = log.records.length + 1;
  if (record.ordinal !== expectedOrdinal) {
    return fail(
      'shadow_log_rewrite',
      `outcome record ${record.outcomeId} claims ordinal ${record.ordinal}, but the log's next position is ${expectedOrdinal} — the outcome log is append-only; splicing, reordering and truncation are the typed rewrite crime`,
    );
  }
  if (log.records.some((existing) => existing.decisionRef === record.decisionRef)) {
    return fail(
      'shadow_log_rewrite',
      `decision ${record.decisionRef} is already recorded at ordinal ${String(log.records.find((existing) => existing.decisionRef === record.decisionRef)?.ordinal)} — one decision, one outcome record (the log never re-decides)`,
    );
  }
  if (log.records.some((existing) => existing.intentRef === record.intentRef)) {
    return fail(
      'shadow_log_rewrite',
      `intent ${record.intentRef} is already recorded — one intent, one outcome record`,
    );
  }
  if (record.priorChainHead !== log.head) {
    return fail(
      'shadow_log_rewrite',
      `outcome record ${record.outcomeId} was minted against chain head ${record.priorChainHead}, but the log's head is ${log.head} — the record belongs to a different history (rewrite)`,
    );
  }
  const sessionIds = new Set(log.records.map((existing) => existing.lineage.sessionId));
  if (sessionIds.size > 0 && !sessionIds.has(record.lineage.sessionId)) {
    return fail(
      'shadow_log_rewrite',
      `outcome record ${record.outcomeId} belongs to session ${record.lineage.sessionId}, but the log carries ${[...sessionIds].join(', ')} — a log never mixes sessions`,
    );
  }
  const head = foldOutcomeRecord(log.head, record);
  return ok(deepFreeze({ records: [...log.records, record], head }));
}

/**
 * Re-derive the log's chain from its records. `true` iff the recorded
 * head folds identically — a tampered record, a removed record or a
 * reordered log fails (the resume gate's tamper anchor).
 */
export function verifyShadowOutcomeChain(log: unknown): boolean {
  if (!isRecord(log) || !Array.isArray(log.records) || typeof log.head !== 'string') return false;
  let head = OUTCOME_CHAIN_SEED;
  for (let index = 0; index < log.records.length; index++) {
    const record = log.records[index];
    if (!isShadowOutcomeRecord(record)) return false;
    if (record.ordinal !== index + 1) return false;
    head = foldOutcomeRecord(head, record);
  }
  return head === log.head;
}

/** Guard: an outcome log (structural; the chain law is `verifyShadowOutcomeChain`). */
export function isShadowOutcomeLog(v: unknown): v is ShadowOutcomeLog {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.records) || !v.records.every((x) => isShadowOutcomeRecord(x))) return false;
  if (typeof v.head !== 'string' || !isDigest(v.head)) return false;
  return true;
}

/** The digest of a log's records (the golden fixture's basis). */
export function shadowOutcomeDigest(log: ShadowOutcomeLog): string {
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
