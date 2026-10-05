/**
 * @tradrl/autonomous-learning (service) — THE IMPROVEMENT STATE (Work
 * Order T035): the loop's whole state over the append-only,
 * chain-verified IMPROVEMENT LOG and the CONSUMED-HOOKS LEDGER (the
 * idempotence memory).
 *
 * THE IMPROVEMENT LOG (L11 — search integrity): one
 * {@link ImprovementCycleRecord} per cycle, hash-chained in append order
 * (the FNV-1a fold over each record's canonical content, seeded from the
 * program-wide `00000000` — the T030/T033/T015 fold discipline). The ONLY
 * way to grow the log is {@link appendImprovementCycle} (a NEW state; the
 * original is untouched); the chain is re-derived on every read — a
 * tampered, truncated, spliced or reordered log fails verification with
 * the typed `chain_mismatch` (a tampered improvement history never
 * drives the next cycle). History is NEVER deleted: the log retains every
 * cycle forever (retention is a query concern, never a mutation).
 *
 * THE CONSUMED-HOOKS LEDGER (the idempotence basis): every T033 learning
 * hook the loop has consumed, in consumption order with the consuming
 * cycle's ordinal. A re-supplied hook is the typed `duplicate_evidence`
 * — evidence contributes EXACTLY ONCE, the T033/T034 precedent. The
 * ledger transitively protects every product: the same outcomes cannot
 * re-feed the Firm Brain, re-mint the same gaps or re-commission the
 * forge through a second cycle.
 */

import { canonicalJson, deepFreeze, fnv1a32Hex, isNonEmptyString, isPositiveSafeInteger, isRecord, ok, type ImprovementResult, type TimestampMs } from './primitives';
import { fail } from './primitives';
import type { ImprovementCycleId } from './ids';
import { isImprovementCycleId } from './ids';

// ---------------------------------------------------------------------------
// The cycle record
// ---------------------------------------------------------------------------

/** The typed refusal vocabulary of the adoption gate (data, never an exception — L11). */
export type CommissionRefusalReason = 'selected_without_holdout' | 'evidence_missing' | 'evidence_insufficient';

/** Guard: a commission refusal reason. */
export function isCommissionRefusalReason(v: unknown): v is CommissionRefusalReason {
  return v === 'selected_without_holdout' || v === 'evidence_missing' || v === 'evidence_insufficient';
}

/** The commission's gate verdict: released to the forge, withheld with the typed refusal, or not applicable. */
export type CommissionStatus = 'commissioned' | 'withheld' | 'none';

/** Guard: a commission status. */
export function isCommissionStatus(v: unknown): v is CommissionStatus {
  return v === 'commissioned' || v === 'withheld' || v === 'none';
}

/**
 * One IMPROVEMENT CYCLE RECORD — the log entry one cycle appends: the
 * content-addressed identity, the ordinal, the scope, the injected
 * instant, the policy digest and the brain-state digest the cycle cites
 * (L9: the improvement binds the exact brain it improved upon), the
 * consumed hooks, the minted products (the gap ids, the revision, the
 * commission with its gate verdict, the memory feed) and the emitted
 * search trials.
 */
export interface ImprovementCycleRecord {
  /** Content-addressed identity: `alc:` + digest of the canonical content. */
  readonly cycleId: ImprovementCycleId;
  /** 1-based position in the improvement log's sequence (append-only). */
  readonly ordinal: number;
  readonly tenant: string;
  readonly project: string;
  /** The injected cycle instant (no ambient clock). */
  readonly at: TimestampMs;
  /** The policy digest (FNV-1a over the policy's canonical content — the decision table the cycle ran under). */
  readonly policyDigest: string;
  /** The Firm-Brain state digest at read time (opaque; the L9 binding — the improvement binds the exact brain it improved upon). */
  readonly knowledgeHead: string;
  /** The T033 hooks consumed this cycle, in input order (`olh:` ids). */
  readonly consumedHooks: readonly string[];
  /** The minted capability-gap ids, in derivation order (`alg:` ids). */
  readonly gaps: readonly string[];
  /** The curriculum revision id (`alv:`), or null when no gap grounded a revision. */
  readonly revision: string | null;
  /** The skill commission id (`als:`), or null when no focus commissioned. */
  readonly commission: string | null;
  /** The commission's gate verdict (released | withheld | not applicable). */
  readonly commissionStatus: CommissionStatus;
  /** The commission's typed refusal (present iff the status is withheld). */
  readonly commissionRefusal: CommissionRefusalReason | null;
  /** The memory feed id (`alm:`), or null when the cycle carried no records. */
  readonly memoryFeed: string | null;
  /** The curriculum revision's search-trial id (`alt:`), or null when no revision minted one. */
  readonly revisionTrial: string | null;
  /** The released skill commission's search-trial id (`alt:`), or null (a withheld commission never enters the search). */
  readonly commissionTrial: string | null;
}

/** Guard: `ImprovementCycleRecord`. */
export function isImprovementCycleRecord(v: unknown): v is ImprovementCycleRecord {
  if (!isRecord(v)) return false;
  if (!isImprovementCycleId(v.cycleId)) return false;
  if (!isPositiveSafeInteger(v.ordinal)) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  if (typeof v.at !== 'number') return false;
  if (!isNonEmptyString(v.policyDigest) || !isNonEmptyString(v.knowledgeHead)) return false;
  if (!Array.isArray(v.consumedHooks)) return false;
  if (!(v.consumedHooks as readonly unknown[]).every((hook) => isNonEmptyString(hook))) return false;
  if (!Array.isArray(v.gaps)) return false;
  if (!(v.gaps as readonly unknown[]).every((gap) => isNonEmptyString(gap))) return false;
  if (v.revision !== null && !isNonEmptyString(v.revision)) return false;
  if (v.commission !== null && !isNonEmptyString(v.commission)) return false;
  if (!isCommissionStatus(v.commissionStatus)) return false;
  if (v.commissionRefusal !== null && !isCommissionRefusalReason(v.commissionRefusal)) return false;
  if (v.memoryFeed !== null && !isNonEmptyString(v.memoryFeed)) return false;
  if (v.revisionTrial !== null && !isNonEmptyString(v.revisionTrial)) return false;
  if (v.commissionTrial !== null && !isNonEmptyString(v.commissionTrial)) return false;
  // The refusal coherence law: withheld iff a refusal is present.
  if (v.commissionStatus === 'withheld' && v.commissionRefusal === null) return false;
  if (v.commissionStatus !== 'withheld' && v.commissionRefusal !== null) return false;
  // The commission coherence law: a commission id iff a focus commissioned.
  if ((v.commission !== null) !== (v.commissionStatus !== 'none')) return false;
  return true;
}

/** The canonical content tree of a cycle record (everything except the content-addressed id). */
function cycleRecordContent(record: Omit<ImprovementCycleRecord, 'cycleId'>): Record<string, unknown> {
  return {
    ordinal: record.ordinal,
    tenant: record.tenant,
    project: record.project,
    at: record.at,
    policyDigest: record.policyDigest,
    knowledgeHead: record.knowledgeHead,
    consumedHooks: [...record.consumedHooks],
    gaps: [...record.gaps],
    revision: record.revision,
    commission: record.commission,
    commissionStatus: record.commissionStatus,
    commissionRefusal: record.commissionRefusal,
    memoryFeed: record.memoryFeed,
    revisionTrial: record.revisionTrial,
    commissionTrial: record.commissionTrial,
  };
}

/** The content digest of a cycle record (FNV-1a over the canonical content — the address). */
export function cycleRecordContentDigest(record: Omit<ImprovementCycleRecord, 'cycleId'>): string {
  return fnv1a32Hex(canonicalJson(cycleRecordContent(record) as never));
}

// ---------------------------------------------------------------------------
// The improvement log (append-only, chain-verified)
// ---------------------------------------------------------------------------

/**
 * The improvement log: the cycle records in append order plus the chain —
 * the head after each appended record, in order. The fold law:
 * `fnv1a32(prev + ':' + fnv1a32(canonical(record)))`, seeded from the
 * program-wide `00000000` (the T030/T033/T015 fold discipline).
 */
export interface ImprovementLog {
  readonly cycles: readonly ImprovementCycleRecord[];
  readonly chain: readonly string[];
}

/** The chain seed (the program-wide fold precedent). */
export const IMPROVEMENT_CHAIN_SEED = '00000000';

/** One chain fold step (the T013/T015 `fnv1a32(prev + ':' + digest)` discipline). */
export function improvementChainStep(previous: string, record: ImprovementCycleRecord): string {
  return fnv1a32Hex(`${previous}:${cycleRecordContentDigest(record)}`);
}

/** The log's chain head (the seed when empty). */
export function improvementLogHead(log: ImprovementLog): string {
  return log.chain.length === 0 ? IMPROVEMENT_CHAIN_SEED : (log.chain[log.chain.length - 1] as string);
}

/**
 * Verify the improvement log's chain: recompute the seed and fold every
 * record in order. A tampered, truncated, spliced or reordered log fails
 * (the typed `chain_mismatch` at the caller) — a tampered improvement
 * history never drives the next cycle.
 */
export function verifyImprovementLog(log: ImprovementLog): boolean {
  let head = IMPROVEMENT_CHAIN_SEED;
  const cycles = log.cycles as readonly ImprovementCycleRecord[];
  if (cycles.length !== log.chain.length) return false;
  for (let index = 0; index < cycles.length; index++) {
    head = improvementChainStep(head, cycles[index] as ImprovementCycleRecord);
    if (head !== log.chain[index]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The consumed-hooks ledger
// ---------------------------------------------------------------------------

/** One consumed hook: the ref, the instant it was consumed, the consuming cycle's ordinal. */
export interface ConsumedHookEntry {
  readonly hookId: string;
  readonly consumedAt: TimestampMs;
  readonly cycleOrdinal: number;
}

/** Guard: `ConsumedHookEntry`. */
export function isConsumedHookEntry(v: unknown): v is ConsumedHookEntry {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.hookId)) return false;
  if (typeof v.consumedAt !== 'number') return false;
  return isPositiveSafeInteger(v.cycleOrdinal);
}

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

/** The autonomous-learning service's whole state (all append-only, all frozen). */
export interface AutonomousLearningState {
  readonly log: ImprovementLog;
  readonly consumedHooks: readonly ConsumedHookEntry[];
}

/** Start a fresh autonomous-learning state (empty log, no consumed hooks). */
export function createAutonomousLearningState(): AutonomousLearningState {
  return deepFreeze({ log: deepFreeze({ cycles: [], chain: [] }), consumedHooks: [] });
}

/** Guard: `AutonomousLearningState`. */
export function isAutonomousLearningState(v: unknown): v is AutonomousLearningState {
  if (!isRecord(v)) return false;
  if (!isRecord(v.log) || !Array.isArray(v.log.cycles) || !Array.isArray(v.log.chain)) return false;
  if (!(v.log.cycles as readonly unknown[]).every((record) => isImprovementCycleRecord(record))) return false;
  if (!Array.isArray(v.consumedHooks)) return false;
  if (!(v.consumedHooks as readonly unknown[]).every((entry) => isConsumedHookEntry(entry))) return false;
  return true;
}

/**
 * Append one cycle record onto the log (the ONLY way to grow it — a NEW
 * state; the original is untouched). The record's ordinal must be exactly
 * the next position (a spliced, skipped or replayed ordinal is the typed
 * `chain_mismatch` — the append law), and the record's identity must be
 * the content address (a forged id is the typed `invalid_id`).
 */
export function appendImprovementCycle(state: AutonomousLearningState, record: ImprovementCycleRecord): ImprovementResult<AutonomousLearningState> {
  if (!isImprovementCycleRecord(record)) {
    return fail('invalid_type', 'appendImprovementCycle requires a guard-valid improvement cycle record');
  }
  const nextOrdinal = state.log.cycles.length + 1;
  if (record.ordinal !== nextOrdinal) {
    return fail(
      'chain_mismatch',
      `the record's ordinal ${record.ordinal} is not the log's next position ${nextOrdinal} — the improvement log is strictly append-only (a spliced, skipped or replayed ordinal is a rewrite)`,
      'ordinal',
    );
  }
  const expectedAddress = `alc:${cycleRecordContentDigest(record)}`;
  if (record.cycleId !== expectedAddress) {
    return fail('invalid_id', `the record's id must be its content address ${expectedAddress} — a forged id is never appended`, 'cycleId');
  }
  const head = improvementChainStep(improvementLogHead(state.log), record);
  return ok(
    deepFreeze({
      log: deepFreeze({
        cycles: [...state.log.cycles, record],
        chain: [...state.log.chain, head],
      }),
      consumedHooks: [
        ...state.consumedHooks,
        ...record.consumedHooks.map((hookId) => deepFreeze({ hookId, consumedAt: record.at, cycleOrdinal: record.ordinal })),
      ],
    } satisfies AutonomousLearningState),
  );
}

/** The digest of the whole autonomous-learning state (the golden determinism tests' basis). */
export function autonomousLearningStateDigest(state: AutonomousLearningState): string {
  return fnv1a32Hex(
    canonicalJson({
      log: { count: state.log.cycles.length, head: improvementLogHead(state.log) },
      cycles: state.log.cycles.map((record) => record.cycleId),
      consumedHooks: state.consumedHooks.map((entry) => entry.hookId),
    } as never),
  );
}
