/**
 * @tradrl/shadow_trading — the RESUMABLE RUN STATE: canonical bytes,
 * chain-verified resume.
 *
 * THE WORK ORDER'S LAW: "serializeShadowRunState / resumeShadowRunState:
 * canonical bytes, chain-verified resume (serialize -> parse -> resume
 * proven; tamper = `chain_mismatch`)."
 *
 * THE SEPARATION: the session's DATA (policies, switch, book, logs,
 * chains, lineage) is JSON-serializable canonical bytes; the session's
 * DEPENDENCIES (the injected world port, the time-machine port, the
 * decision source) are NOT serialized — the resumer re-supplies them
 * (the caller restores the world from ITS run state and the machine
 * from ITS snapshot, per their own lanes' disciplines).
 *
 * THE RESUME GATE re-verifies, before the session may continue:
 *   - the schema marker and the structural guards (invalid_json /
 *     invalid_state);
 *   - the kill-switch chain (lifted as `chain_mismatch` — the T019
 *     log was tampered);
 *   - the T019 audit trail's chain + coherence (one record per
 *     decision, in order — lifted as `chain_mismatch`);
 *   - the outcome log's chain (`chain_mismatch` — a spliced, edited,
 *     truncated or reordered outcome record);
 *   - the tick audit chain (`chain_mismatch`);
 *   - the coherence laws (every fill belongs to a recorded decision;
 *     every submission belongs to a recorded decision; the outcome
 *     ordinals are contiguous);
 *   - the deps: the world port must know the episode; the machine port
 *     must still carry the session's cursor (restored from ITS
 *     snapshot) and its dataset must match the serialized binding.
 */

import { canonicalJson, deepFreeze, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { type ShadowResult, fail, ok } from './errors';
import { isShadowSessionId } from './ids';
import {
  isAuditLog,
  isExecutionPolicy,
  isExecutionVenueState,
  isKillSwitchLog,
  validateAuditLog,
  verifyAuditChain,
  verifyKillSwitchChain,
} from '../../../packages/execution-policy/src/index';
import { isRiskPolicy, isLimitEvaluationRecord, isExposureRecord } from '../../../packages/risk/src/index';
import {
  isShadowOutcomeLog,
  verifyShadowOutcomeChain,
} from './outcomes';
import { isShadowSession, verifyShadowAuditChain, type ShadowSession } from './session';
import { isReactiveWorldPort, type ReactiveWorldPort } from './world-mirror';
import { isTimeMachinePort, type TimeMachinePort } from './time-machine-mirror';

/** The run-state serialization schema marker (versioned with the lane). */
export const SHADOW_RUN_STATE_SCHEMA = 'tradrl/shadow-run-state@1';

/** The resume dependencies (the re-supplied, non-serializable seams). */
export interface ResumeShadowDependencies {
  /** The injected reactive world port (restored from its own run state by the caller). */
  readonly world: unknown;
  /** The injected time-machine port (restored from its own snapshot by the caller). */
  readonly timeMachine: unknown;
  /** The decision source positioned at the resumption point (the caller's iterator). */
  readonly decisionSource: unknown;
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/**
 * Serialize a session to canonical JSON bytes (the resume artifact —
 * portable across processes). The injected ports and the decision
 * source are EXCLUDED (they are dependencies, not state).
 * Deterministic: equal sessions produce identical bytes.
 */
export function serializeShadowRunState(session: unknown): ShadowResult<string> {
  if (!isShadowSession(session)) {
    return fail('invalid_type', 'serializeShadowRunState requires a valid shadow session');
  }
  const roundTrip: unknown = JSON.parse(JSON.stringify(sessionDataOf(session)));
  return ok(canonicalJson({ schema: SHADOW_RUN_STATE_SCHEMA, session: roundTrip as JsonValue }));
}

/** The session's serializable data (everything except the injected seams). */
function sessionDataOf(session: ShadowSession): Record<string, unknown> {
  return {
    sessionId: session.sessionId,
    mode: session.mode,
    tenant: session.tenant,
    project: session.project,
    seed: session.seed,
    participant: session.participant,
    executionPolicy: session.executionPolicy,
    riskPolicy: session.riskPolicy,
    killSwitch: session.killSwitch,
    auditLog: session.auditLog,
    marketEvents: session.marketEvents,
    quotePrecision: session.quotePrecision,
    episodeId: session.episodeId,
    cursorId: session.cursorId,
    cursorFrom: session.cursorFrom,
    warmUp: session.warmUp,
    book: session.book,
    peakEquity: session.peakEquity,
    venueState: session.venueState,
    decisions: session.decisions,
    evaluations: session.evaluations,
    exposures: session.exposures,
    refusals: session.refusals,
    fills: session.fills,
    submissions: session.submissions,
    ticks: session.ticks,
    outcomeLog: session.outcomeLog,
    auditChainHead: session.auditChainHead,
    processedIntentIds: session.processedIntentIds,
    now: session.now,
    finished: session.finished,
    lineage: session.lineage,
    bookLineage: session.bookLineage,
  };
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

/**
 * Resume a session from serialized bytes: parse, enforce the schema
 * marker, re-validate every constituent through its guard, re-verify
 * the kill-switch chain, the audit trail's chain, the outcome log's
 * chain and the tick audit chain, re-prove the coherence laws, verify
 * the re-supplied dependencies (the world knows the episode; the
 * machine still carries the cursor; the datasets match), and refuse a
 * tampered payload with the typed errors (`invalid_json` /
 * `invalid_state` / `chain_mismatch`). A resumed session provably
 * consumed the same history and continues appending onto the verified
 * logs.
 */
export function resumeShadowRunState(bytes: string, deps: ResumeShadowDependencies): ShadowResult<ShadowSession> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse failure';
    return fail('invalid_json', `the run state bytes are not valid JSON: ${message}`);
  }
  if (!isRecord(parsed)) return fail('invalid_state', 'the run state envelope must be an object');
  if (parsed.schema !== SHADOW_RUN_STATE_SCHEMA) {
    return fail('invalid_state', `expected schema "${SHADOW_RUN_STATE_SCHEMA}", got ${JSON.stringify(parsed.schema)}`);
  }
  if (!isRecord(parsed.session)) return fail('invalid_state', 'the run state envelope must carry the session object');

  const data = parsed.session as Record<string, unknown>;

  // --- The structural guards ------------------------------------------------------
  if (!isShadowSessionId(data.sessionId)) return fail('invalid_state', 'the parsed session lacks a valid session id');
  if (data.mode !== 'shadow') return fail('fidelity_claim_dishonest', `the parsed session's mode is ${JSON.stringify(data.mode)} — 'shadow' is the only honest mode here (L5/R23)`);
  if (typeof data.tenant !== 'string' || data.tenant === '') return fail('invalid_state', 'the parsed session lacks its tenant scope');
  if (typeof data.project !== 'string' || data.project === '') return fail('invalid_state', 'the parsed session lacks its project scope');
  if (typeof data.seed !== 'string' || data.seed === '') return fail('invalid_state', 'the parsed session lacks its seed');
  if (!isExecutionPolicy(data.executionPolicy)) return fail('invalid_state', 'the parsed session\u2019s execution policy fails its guard');
  if (!isRiskPolicy(data.riskPolicy)) return fail('invalid_state', 'the parsed session\u2019s risk policy fails its guard');
  if (!isKillSwitchLog(data.killSwitch)) return fail('chain_mismatch', 'the parsed kill-switch log fails its structural guard (tampered)');
  if (!isAuditLog(data.auditLog)) return fail('chain_mismatch', 'the parsed audit trail fails its structural guard (tampered)');
  if (!isExecutionVenueState(data.venueState)) return fail('invalid_state', 'the parsed venue state fails its guard');
  if (!isShadowOutcomeLog(data.outcomeLog)) return fail('chain_mismatch', 'the parsed outcome log fails its structural guard (tampered)');
  if (!Array.isArray(data.decisions) || !data.decisions.every((x) => isRecord(x) && (x.kind === 'approve' || x.kind === 'refuse'))) return fail('invalid_state', 'the parsed decisions log is malformed');
  if (!Array.isArray(data.evaluations) || !data.evaluations.every((x) => isLimitEvaluationRecord(x))) return fail('invalid_state', 'the parsed evaluations log is malformed');
  if (!Array.isArray(data.exposures) || !data.exposures.every((x) => isExposureRecord(x))) return fail('invalid_state', 'the parsed exposures log is malformed');
  if (!Array.isArray(data.fills) || !data.fills.every((x) => isRecord(x) && typeof x.fillId === 'string' && x.fillId.startsWith('swf-'))) return fail('invalid_state', 'the parsed fills log is malformed');
  if (!Array.isArray(data.submissions) || !data.submissions.every((x) => isRecord(x) && typeof x.actionId === 'string' && x.actionId !== '')) return fail('invalid_state', 'the parsed submissions log is malformed');
  if (!Array.isArray(data.ticks) || !data.ticks.every((x) => isRecord(x) && typeof x.tickId === 'string' && x.tickId !== '')) return fail('invalid_state', 'the parsed tick log is malformed');
  if (!Array.isArray(data.processedIntentIds) || !data.processedIntentIds.every((x) => typeof x === 'string')) return fail('invalid_state', 'the parsed processed-intent ids are malformed');
  if (!isTimestampMs(data.now)) return fail('invalid_state', 'the parsed session clock is malformed');
  if (typeof data.finished !== 'boolean') return fail('invalid_state', 'the parsed session\u2019s finished flag is malformed');
  if (typeof data.auditChainHead !== 'string' || data.auditChainHead === '') return fail('invalid_state', 'the parsed audit chain head is malformed');

  // --- The chain verifications (the tamper anchors) ------------------------------------
  const switchVerified = verifyKillSwitchChain(data.killSwitch as never);
  if (!switchVerified.ok) return fail('chain_mismatch', `the kill-switch log fails chain verification — the run state was tampered: ${switchVerified.errors.map((error) => error.message).join('; ')}`);
  const auditValidated = validateAuditLog(data.auditLog as never);
  if (!auditValidated.ok) return fail('chain_mismatch', `the audit trail fails validation: ${auditValidated.errors.map((error) => error.message).join('; ')}`);
  const auditVerified = verifyAuditChain(data.auditLog as never);
  if (!auditVerified.ok) return fail('chain_mismatch', `the audit trail fails chain verification — the run state was tampered: ${auditVerified.errors.map((error) => error.message).join('; ')}`);
  if (!verifyShadowOutcomeChain(data.outcomeLog)) {
    return fail('chain_mismatch', 'the outcome log fails chain verification — an outcome record was edited, removed, spliced or reordered (the run state was tampered)');
  }

  // --- The dependencies --------------------------------------------------------------------
  if (!isReactiveWorldPort(deps.world)) return fail('invalid_type', 'resumeShadowRunState requires a reactive world port (the T027 service, re-injected)');
  const world = deps.world as ReactiveWorldPort;
  if (!world.episodes.includes((data.episodeId as string) ?? '')) {
    return fail('world_error', `the world does not know the episode ${JSON.stringify(data.episodeId)} — restore the world from its own run state before resuming the shadow session`);
  }
  if (!isTimeMachinePort(deps.timeMachine)) return fail('invalid_type', 'resumeShadowRunState requires a time-machine port (the T029 service, re-injected)');
  const timeMachine = deps.timeMachine as TimeMachinePort;
  if (timeMachine.dataset !== (data.lineage as { configDigests: { dataset: string } } | undefined)?.configDigests?.dataset) {
    return fail('machine_error', `the time machine's dataset (${timeMachine.dataset}) is not the session's (${String((data.lineage as { configDigests: { dataset: string } } | undefined)?.configDigests?.dataset)}) — restore the machine from its own snapshot before resuming`);
  }
  const cursor = timeMachine.getCursor(data.cursorId as string);
  if (!cursor.ok) {
    return fail('machine_error', `the time machine does not carry the session's cursor ${JSON.stringify(data.cursorId)} — restore the machine from its snapshot (the cursor position is the resumable offset): ${cursor.error.code}: ${cursor.error.message}`);
  }
  if (typeof deps.decisionSource !== 'object' || deps.decisionSource === null || typeof (deps.decisionSource as Record<string, unknown>).next !== 'function') {
    return fail('invalid_source', 'resumeShadowRunState requires the decision source positioned at the resumption point');
  }

  // --- The coherence laws -------------------------------------------------------------------
  const decisions = data.decisions as { decisionId: string }[];
  const auditRecords = (data.auditLog as unknown as { records: { decisionId: string }[] }).records;
  if (auditRecords.length !== decisions.length) {
    return fail('chain_mismatch', `the audit trail carries ${auditRecords.length} records for ${decisions.length} decisions — one decision, one audit record (tampered)`);
  }
  for (let index = 0; index < decisions.length; index++) {
    if (auditRecords[index]?.decisionId !== decisions[index]?.decisionId) {
      return fail('chain_mismatch', `the audit trail's record ${index + 1} disagrees with the decisions log — the run state was tampered`);
    }
  }
  const decisionIds = new Set(decisions.map((decision) => decision.decisionId));
  for (const submission of data.submissions as { decisionId: string }[]) {
    if (!decisionIds.has(submission.decisionId)) {
      return fail('chain_mismatch', `a submission references decision ${submission.decisionId}, which the decisions log does not carry (tampered)`);
    }
  }
  for (const fill of data.fills as { decisionId: string }[]) {
    if (!decisionIds.has(fill.decisionId)) {
      return fail('chain_mismatch', `a fill references decision ${fill.decisionId}, which the decisions log does not carry (tampered)`);
    }
  }

  const session = deepFreeze({
    sessionId: data.sessionId,
    mode: 'shadow' as const,
    tenant: data.tenant,
    project: data.project,
    seed: data.seed,
    participant: data.participant,
    world,
    timeMachine,
    decisionSource: deps.decisionSource,
    executionPolicy: data.executionPolicy,
    riskPolicy: data.riskPolicy,
    killSwitch: data.killSwitch,
    auditLog: data.auditLog,
    marketEvents: data.marketEvents,
    quotePrecision: data.quotePrecision,
    episodeId: data.episodeId,
    cursorId: data.cursorId,
    cursorFrom: data.cursorFrom,
    warmUp: data.warmUp,
    book: data.book,
    peakEquity: data.peakEquity,
    venueState: data.venueState,
    decisions: data.decisions,
    evaluations: data.evaluations,
    exposures: data.exposures,
    refusals: data.refusals,
    fills: data.fills,
    submissions: data.submissions,
    ticks: data.ticks,
    outcomeLog: data.outcomeLog,
    auditChainHead: data.auditChainHead,
    processedIntentIds: data.processedIntentIds,
    now: data.now,
    finished: data.finished,
    lineage: data.lineage,
    bookLineage: data.bookLineage,
  }) as ShadowSession;

  // --- The tick audit chain (needs the assembled session) --------------------------------------
  if (!verifyShadowAuditChain(session)) {
    return fail('chain_mismatch', 'the tick audit chain does not fold onto the recorded head — a tick record was edited, removed or reordered (the run state was tampered)');
  }
  if (!isShadowSession(session)) {
    return fail('invalid_state', 'the resumed session fails the session guard (the run state was tampered)');
  }
  return ok(session);
}

/** The digest of a session's whole evidence (the resume-equivalence comparator). */
export function shadowSessionDigest(session: ShadowSession): string {
  return fnvOf(canonicalJson({
    sessionId: session.sessionId,
    decisions: session.decisions.map((decision) => ({ decisionId: decision.decisionId, kind: decision.kind })),
    refusals: session.refusals.map((refusal) => refusal.refusalId),
    fills: session.fills.map((fill) => ({ fillId: fill.fillId, appliedAt: fill.appliedAt })),
    submissions: session.submissions.map((submission) => submission.actionId),
    outcomeLog: { records: session.outcomeLog.records.length, head: session.outcomeLog.head },
    ticks: session.ticks.length,
    book: { cash: session.book.cash, realizedPnl: session.book.realizedPnl, positions: session.book.positions.map((position) => [position.venue, position.instrument, position.quantity, position.costBasis]) },
    auditChainHead: session.auditChainHead,
    now: session.now,
  }));
}

/** FNV-1a 32-bit hex (the local derivation — primitives re-export site). */
function fnvOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The instant type re-export (fixture convenience). */
export type { TimestampMs };
