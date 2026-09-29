// @tradrl/trading-strategy — the backtest trail (L11 search integrity).
//
// spec/ARCHITECTURE.md Evaluation: "Preserve search history."
// spec/ARCHITECTURE-LOCK.md L11: "Search integrity: optimization history
// is retained to expose selection effects."
//
// A {@link BacktestRecord} is the APPEND-ONLY candidate trail of one
// strategy-selection run: every candidate strategy version evaluated
// over a declared window is RETAINED with its disposition and a
// STRUCTURED reason (never free text) — rejected candidates are records
// too, because hiding them is how selection effects smuggle themselves
// into "the winning strategy". There is NO remove/update/rewrite API on
// the trail: appending is the only mutation, appending requires the
// next contiguous sequence and a fresh candidate id, and a duplicate id
// — the shape a disposition rewrite must take — is the typed
// `backtest_rewrite` error.
//
// ATTAINMENT IS EVIDENCE-BOUND, NEVER SCORED HERE (L7: "raw PnL is
// insufficient"; the Work Order: "evaluation lane owns scoring, you
// emit the evidence bindings"): each candidate carries per-criterion
// {@link AttainmentEvidence} bindings — the criterion identity, its
// required satisfaction, the gating/blocking constraint ids (the
// control-plane mirror's gating rule outputs) and an OPAQUE
// AttainmentEvidenceRef to the evaluation lane's (T012) evidence
// record. The binding is a STRUCTURAL MIRROR of @tradrl/evaluation's
// `CriterionBinding` (T012) plus the evidence ref, so the trail's
// bindings feed the REAL evaluation compiler unmodified (the trip wire
// in src/interop.test.ts).
//
// LEARNED STRATEGIES (T013): a candidate may carry its learning
// lineage — the trial, arm and trajectory refs of the training run
// that produced the spec — as OPAQUE refs (mirroring @tradrl/rl-
// protocol's brands), so a backtest candidate binds into the RL
// bridge's trial/lineage shapes without this lane ever importing them.
//
// L12: every candidate carries TenantId + ProjectId.
//
// Spec anchors: spec/EVALUATION-PROTOCOL.md (Selection integrity),
// spec/ARCHITECTURE-LOCK.md L7, L9, L11, L12.

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  isUnitInterval,
  type JsonValue,
  type TimestampMs,
} from './primitives';
import {
  type ArmId,
  type BacktestCandidateId,
  type BacktestRunId,
  type GoalVersionRef,
  type ProjectId,
  type StrategyVersionRef,
  type TenantId,
  type TrajectoryId,
  type TrialId,
  isArmId,
  isBacktestCandidateId,
  isBacktestRunId,
  isProjectId,
  isStrategyVersionRef,
  isTenantId,
  isTrajectoryId,
  isTrialId,
  mintBacktestRunId,
} from './ids';
import { authorityViolations } from './authority';
import {
  type StrategyError,
  type StrategyResult,
  fail,
  failures,
  invalidField,
  invalidType,
  missingField,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// Attainment evidence bindings (evaluation-lane mirror + opaque ref)
// ---------------------------------------------------------------------------

/**
 * One per-criterion attainment binding: the STRUCTURAL MIRROR of
 * @tradrl/evaluation's `CriterionBinding` (T012 — criterionId,
 * requiredSatisfaction, gatingConstraintIds, blockingConstraintIds)
 * PLUS the opaque {@link AttainmentEvidenceRef} to the evaluation
 * lane's evidence record. The evaluation lane owns scoring; this lane
 * emits the bindings that feed it (the interop trip wire proves the
 * mirror against the REAL package).
 */
export interface AttainmentEvidence {
  readonly criterionId: string;
  /** Required share of applicable gating constraints satisfied, [0,1]. */
  readonly requiredSatisfaction: number;
  /** Gating constraint ids (non-empty, unique, canonical order). */
  readonly gatingConstraintIds: readonly string[];
  /** Blocking subset of the gating ids. */
  readonly blockingConstraintIds: readonly string[];
  /** Opaque reference to the evaluation lane's evidence record (T012). */
  readonly evidenceRef: string;
}

/** Guard: `AttainmentEvidence`. */
export function isAttainmentEvidence(v: unknown): v is AttainmentEvidence {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.criterionId)) return false;
  if (!isUnitInterval(v.requiredSatisfaction)) return false;
  if (!Array.isArray(v.gatingConstraintIds) || v.gatingConstraintIds.length === 0) return false;
  if (!v.gatingConstraintIds.every((x) => isNonEmptyString(x))) return false;
  if (new Set(v.gatingConstraintIds).size !== v.gatingConstraintIds.length) return false;
  if (!Array.isArray(v.blockingConstraintIds)) return false;
  if (!v.blockingConstraintIds.every((x) => isNonEmptyString(x))) return false;
  if (new Set(v.blockingConstraintIds).size !== v.blockingConstraintIds.length) return false;
  const gating = new Set<string>(v.gatingConstraintIds);
  if (!v.blockingConstraintIds.every((id) => gating.has(id))) return false; // blocking ⊆ gating
  if (!isNonEmptyString(v.evidenceRef)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Dispositions and structured reasons
// ---------------------------------------------------------------------------

/** The closed disposition vocabulary (a candidate's terminal status in the trail). */
export type CandidateDisposition = 'proposed' | 'retained' | 'rejected';

export const CANDIDATE_DISPOSITIONS: readonly CandidateDisposition[] = ['proposed', 'retained', 'rejected'] as const;

/**
 * The structured disposition reason — a closed discriminated union,
 * never free text ("reasons as structured data"). Mirrors the
 * organization lane's rejection-reason discipline.
 */
export type DispositionReason =
  /** The candidate attained (per its evidence bindings) and was proposed. */
  | { readonly kind: 'attained'; readonly attainedCriteria: number; readonly totalCriteria: number }
  /** The candidate failed at least one criterion's evidence binding. */
  | { readonly kind: 'not_attained'; readonly failedCriteria: readonly string[] }
  /** The candidate was refused by the constraint gate over its window. */
  | { readonly kind: 'constraint_refused'; readonly violatedConstraintIds: readonly string[] }
  /** The candidate violated the universe discipline over its window. */
  | { readonly kind: 'universe_violation'; readonly instrumentId: string }
  /** The candidate was dominated by a better candidate under the declared objective. */
  | { readonly kind: 'dominated'; readonly dominatedBy: BacktestCandidateId }
  /** The search budget ended before the candidate was evaluated. */
  | { readonly kind: 'budget_exhausted'; readonly evaluated: number; readonly budget: number };

export const DISPOSITION_REASON_KINDS: readonly DispositionReason['kind'][] = [
  'attained',
  'not_attained',
  'constraint_refused',
  'universe_violation',
  'dominated',
  'budget_exhausted',
] as const;

/** Guard: `DispositionReason`. */
export function isDispositionReason(v: unknown): v is DispositionReason {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'attained':
      return Number.isInteger(v.attainedCriteria) && (v.attainedCriteria as number) >= 0 && Number.isInteger(v.totalCriteria) && (v.totalCriteria as number) >= 0;
    case 'not_attained':
      return Array.isArray(v.failedCriteria) && v.failedCriteria.length > 0 && v.failedCriteria.every((x) => isNonEmptyString(x));
    case 'constraint_refused':
      return Array.isArray(v.violatedConstraintIds) && v.violatedConstraintIds.length > 0 && v.violatedConstraintIds.every((x) => isNonEmptyString(x));
    case 'universe_violation':
      return isNonEmptyString(v.instrumentId);
    case 'dominated':
      return isBacktestCandidateId(v.dominatedBy);
    case 'budget_exhausted':
      return Number.isInteger(v.evaluated) && (v.evaluated as number) >= 0 && Number.isInteger(v.budget) && (v.budget as number) >= 0;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// The learning lineage (T013 binding — opaque refs)
// ---------------------------------------------------------------------------

/**
 * The learning lineage of a LEARNED strategy candidate: the trial, arm
 * and trajectory refs of the training run that produced the spec —
 * opaque refs into @tradrl/rl-protocol's (T013) identity spaces, so
 * the candidate binds into the bridge's trial/lineage shapes. `null`
 * for hand-authored strategies.
 */
export interface LearningLineage {
  readonly trialId: TrialId;
  readonly armId: ArmId;
  readonly trajectoryId: TrajectoryId;
}

/** Guard: `LearningLineage`. */
export function isLearningLineage(v: unknown): v is LearningLineage {
  if (!isRecord(v)) return false;
  return isTrialId(v.trialId) && isArmId(v.armId) && isTrajectoryId(v.trajectoryId);
}

// ---------------------------------------------------------------------------
// The backtest candidate
// ---------------------------------------------------------------------------

/**
 * One candidate entry of the trail: the strategy version, the
 * evaluation window, the per-criterion attainment evidence bindings,
 * the disposition + structured reason, the learning lineage (when
 * learned), and the full L9/L12 scope.
 */
export interface BacktestCandidate {
  readonly candidateId: BacktestCandidateId;
  /** 1-based position in the append-only trail. */
  readonly sequence: number;
  readonly strategy: StrategyVersionRef;
  /** The evaluation window the candidate ran over. */
  readonly window: { readonly windowId: string; readonly startsAt: TimestampMs; readonly endsAt: TimestampMs };
  readonly attainment: readonly AttainmentEvidence[];
  readonly disposition: CandidateDisposition;
  readonly reason: DispositionReason;
  readonly learning: LearningLineage | null;
  readonly goal: GoalVersionRef;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** Record instant (explicit — no ambient clock). */
  readonly recordedAt: TimestampMs;
}

/** Guard: `BacktestCandidate`. */
export function isBacktestCandidate(v: unknown): v is BacktestCandidate {
  if (!isRecord(v)) return false;
  if (!isBacktestCandidateId(v.candidateId)) return false;
  if (!Number.isSafeInteger(v.sequence) || (v.sequence as number) < 1) return false;
  if (!isStrategyVersionRef(v.strategy)) return false;
  if (!isRecord(v.window) || !isNonEmptyString(v.window.windowId) || !isTimestampMs(v.window.startsAt) || !isTimestampMs(v.window.endsAt)) return false;
  if (!Array.isArray(v.attainment) || !v.attainment.every((x) => isAttainmentEvidence(x))) return false;
  if (!isNonEmptyString(v.disposition) || !(CANDIDATE_DISPOSITIONS as readonly string[]).includes(v.disposition)) return false;
  if (!isDispositionReason(v.reason)) return false;
  if (v.learning !== null && !isLearningLineage(v.learning)) return false;
  if (!isRecord(v.goal) || !isNonEmptyString(v.goal.goalId) || !Number.isInteger(v.goal.version) || (v.goal.version as number) < 1) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!isTimestampMs(v.recordedAt)) return false;
  // The L8 trip wire (the guard half).
  if (authorityViolations(v).length > 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The backtest record (the append-only trail)
// ---------------------------------------------------------------------------

/**
 * The append-only candidate trail (L11 — see the module header). The
 * derived run id is content-addressed from the trail's declared basis
 * (goal version + tenant + project), so the same basis always derives
 * the same trail identity. Hiding candidates is IMPOSSIBLE: there is
 * no removal API, and validation requires sequences 1..N contiguous.
 */
export interface BacktestRecord {
  /** Content-addressed: `bt:` + digest of the trail basis. */
  readonly runId: BacktestRunId;
  readonly goal: GoalVersionRef;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** Candidates in append order; sequences 1..N. */
  readonly candidates: readonly BacktestCandidate[];
}

/** Guard: `BacktestRecord` (structural; the append-only law in `validateBacktestRecord`). */
export function isBacktestRecord(v: unknown): v is BacktestRecord {
  if (!isRecord(v)) return false;
  if (!isBacktestRunId(v.runId)) return false;
  if (!isRecord(v.goal) || !isNonEmptyString(v.goal.goalId) || !Number.isInteger(v.goal.version) || (v.goal.version as number) < 1) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!Array.isArray(v.candidates)) return false;
  if (!v.candidates.every((x) => isBacktestCandidate(x))) return false;
  for (let index = 0; index < v.candidates.length; index += 1) {
    if ((v.candidates[index] as BacktestCandidate).sequence !== index + 1) return false;
  }
  if (authorityViolations(v).length > 0) return false;
  return true;
}

/** Derive the content-addressed trail id from the basis. Pure (L9). */
export function backtestRunIdOf(goal: GoalVersionRef, tenant: TenantId, project: ProjectId): BacktestRunId {
  return mintBacktestRunId(
    fnv1a32Hex(
      canonicalJson({
        goal: { goalId: goal.goalId, version: goal.version },
        tenant,
        project,
        candidates: 0,
      } as unknown as JsonValue),
    ),
  );
}

/** Start an empty trail for a basis. Pure. */
export function startBacktestRecord(
  goal: GoalVersionRef,
  tenant: TenantId,
  project: ProjectId,
): BacktestRecord {
  return deepFreeze({
    runId: backtestRunIdOf(goal, tenant, project),
    goal,
    tenant,
    project,
    candidates: [],
  });
}

/**
 * Append one candidate to the trail — the ONLY mutation,
 * copy-on-write. Laws:
 *   - the sequence must be exactly `candidates.length + 1` (a gap
 *     rewrites history — L11);
 *   - the candidate id must be FRESH (a duplicate id is the shape a
 *     disposition rewrite must take — the typed `backtest_rewrite`);
 *   - the candidate's goal/tenant/project must agree with the trail's
 *     basis (L9/L12 — a candidate from another scope is a lineage
 *     forgery);
 *   - at most ONE `proposed` candidate may exist (the selection); a
 *     second proposal is a rewrite of the selection (L11).
 */
export function appendBacktestCandidate(
  record: BacktestRecord,
  candidate: BacktestCandidate,
): StrategyResult<BacktestRecord> {
  if (!isBacktestRecord(record)) {
    return fail('invalid_backtest', 'appendBacktestCandidate requires a valid backtest record');
  }
  if (!isBacktestCandidate(candidate)) {
    return fail('invalid_backtest', 'the appended value is not a valid backtest candidate');
  }
  const expectedSequence = record.candidates.length + 1;
  if (candidate.sequence !== expectedSequence) {
    return fail('backtest_rewrite', `appended candidate sequence ${String(candidate.sequence)} is not the next contiguous sequence ${String(expectedSequence)} — the trail is append-only and gaps rewrite history (L11)`);
  }
  const existing = record.candidates.find((entry) => entry.candidateId === candidate.candidateId);
  if (existing !== undefined) {
    const sameContent = canonicalJson(existing as unknown as JsonValue) === canonicalJson(candidate as unknown as JsonValue);
    return fail(
      'backtest_rewrite',
      sameContent
        ? `candidate ${candidate.candidateId} is already recorded at sequence ${String(existing.sequence)} — re-appending is a rewrite (L11)`
        : `candidate ${candidate.candidateId} is already recorded at sequence ${String(existing.sequence)} with a different disposition (${existing.disposition} -> ${candidate.disposition}) — rewriting a recorded disposition is the typed crime (L11)`,
    );
  }
  if (candidate.goal.goalId !== record.goal.goalId || candidate.goal.version !== record.goal.version) {
    return fail('lineage_gap', `the candidate's goal lineage (${candidate.goal.goalId}@${String(candidate.goal.version)}) disagrees with the trail's (${record.goal.goalId}@${String(record.goal.version)}) (L9)`);
  }
  if (candidate.tenant !== record.tenant || candidate.project !== record.project) {
    return fail('tenant_missing', `the candidate's scope (${candidate.tenant}/${candidate.project}) disagrees with the trail's (${record.tenant}/${record.project}) (L12)`);
  }
  if (candidate.disposition === 'proposed' && record.candidates.some((entry) => entry.disposition === 'proposed')) {
    return fail('backtest_rewrite', 'the trail already carries a proposed candidate — the selection is append-once; a second proposal rewrites it (L11)');
  }
  return ok(
    deepFreeze({
      ...record,
      candidates: [...record.candidates, candidate],
    } as BacktestRecord),
  );
}

// ---------------------------------------------------------------------------
// Validation (collect-all)
// ---------------------------------------------------------------------------

/**
 * Collect-all validation of an untrusted backtest candidate. Enforces
 * the L8/L12 laws beyond the structural guard. On success the value is
 * returned narrowed, deeply frozen.
 */
export function validateBacktestCandidate(value: unknown, path = 'candidate'): StrategyResult<BacktestCandidate> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: StrategyError[] = [];

  if (value.candidateId === undefined) errors.push(missingField(`${path}.candidateId`));
  else if (!isBacktestCandidateId(value.candidateId)) errors.push(invalidField(`${path}.candidateId`, 'must be a `btc:`-prefixed id'));

  if (value.sequence === undefined) errors.push(missingField(`${path}.sequence`));
  else if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) errors.push(invalidField(`${path}.sequence`, 'must be a positive safe integer'));

  if (value.strategy === undefined) errors.push({ code: 'lineage_gap', path: `${path}.strategy`, message: 'the candidate carries no strategy version ref (L9)' });
  else if (!isStrategyVersionRef(value.strategy)) errors.push({ code: 'lineage_gap', path: `${path}.strategy`, message: 'the strategy version ref is malformed (L9)' });

  if (value.goal === undefined) errors.push({ code: 'lineage_gap', path: `${path}.goal`, message: 'the candidate carries no goal version ref (L9)' });

  if (value.tenant === undefined) errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the candidate carries no tenant scope (L12)' });
  if (value.project === undefined) errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the candidate carries no project scope (L12/L15)' });

  if (value.disposition === undefined) errors.push(missingField(`${path}.disposition`));
  else if (!isNonEmptyString(value.disposition) || !(CANDIDATE_DISPOSITIONS as readonly string[]).includes(value.disposition)) {
    errors.push(invalidField(`${path}.disposition`, `must be one of ${CANDIDATE_DISPOSITIONS.join(' | ')}`));
  }

  if (value.reason === undefined) errors.push(missingField(`${path}.reason`));
  else if (!isDispositionReason(value.reason)) {
    errors.push(invalidField(`${path}.reason`, `must be a structured disposition reason (${DISPOSITION_REASON_KINDS.join(' | ')}) — never free text`));
  }

  if (value.attainment === undefined) errors.push(missingField(`${path}.attainment`));
  else if (!Array.isArray(value.attainment) || !value.attainment.every((x) => isAttainmentEvidence(x))) {
    errors.push(invalidField(`${path}.attainment`, 'must be an array of attainment evidence bindings (evaluation-lane mirror + opaque ref)'));
  }

  for (const crimePath of authorityViolations(value)) {
    errors.push({
      code: 'authority_in_strategy',
      path: `${path}.${crimePath}`,
      message: `backtest candidates embed no execution authority ("${crimePath}") (L8)`,
    });
  }

  if (errors.length > 0) return failures(errors);
  if (!isBacktestCandidate(value)) {
    return fail('invalid_backtest', `${path} failed the structural candidate guard`);
  }
  return ok(deepFreeze(value) as BacktestCandidate);
}

/**
 * Collect-all validation of an untrusted backtest record: the
 * append-only sequence law (1..N contiguous, unique ids), the basis
 * coherence (every candidate carries the trail's goal/tenant/project)
 * and the single-proposal law. On success the value is returned
 * narrowed, deeply frozen.
 */
export function validateBacktestRecord(value: unknown, path = 'backtest'): StrategyResult<BacktestRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: StrategyError[] = [];

  if (value.runId === undefined) errors.push(missingField(`${path}.runId`));
  else if (!isBacktestRunId(value.runId)) errors.push(invalidField(`${path}.runId`, 'must be a `bt:`-prefixed id'));

  if (value.tenant === undefined) errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the trail carries no tenant scope (L12)' });
  if (value.project === undefined) errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the trail carries no project scope (L12/L15)' });
  if (value.goal === undefined) errors.push({ code: 'lineage_gap', path: `${path}.goal`, message: 'the trail carries no goal version ref (L9)' });

  if (value.candidates !== undefined && Array.isArray(value.candidates)) {
    const seenIds = new Set<string>();
    let proposals = 0;
    value.candidates.forEach((candidate: unknown, index: number) => {
      if (!isBacktestCandidate(candidate)) {
        errors.push(invalidField(`${path}.candidates[${index}]`, 'fails the candidate guard'));
        return;
      }
      const record = candidate as BacktestCandidate;
      if (record.sequence !== index + 1) {
        errors.push({
          code: 'backtest_rewrite',
          path: `${path}.candidates[${index}].sequence`,
          message: `candidate sequences are 1..N contiguous in append order (got ${String(record.sequence)} at index ${String(index)}) — a gap rewrites history (L11)`,
        });
      }
      if (seenIds.has(record.candidateId)) {
        errors.push({
          code: 'backtest_rewrite',
          path: `${path}.candidates[${index}].candidateId`,
          message: `duplicate candidate id ${record.candidateId} — the trail is append-only with unique ids (L11)`,
        });
      }
      seenIds.add(record.candidateId);
      if (record.disposition === 'proposed') proposals += 1;
      if (isRecord(value.goal) && isRecord(record.goal)) {
        const trailGoal = value.goal as Record<string, unknown>;
        const candidateGoal = record.goal as Record<string, unknown>;
        if (trailGoal.goalId !== candidateGoal.goalId || trailGoal.version !== candidateGoal.version) {
          errors.push({ code: 'lineage_gap', path: `${path}.candidates[${index}].goal`, message: 'the candidate\'s goal lineage disagrees with the trail\'s basis (L9)' });
        }
      }
      if (isNonEmptyString(value.tenant) && record.tenant !== value.tenant) {
        errors.push({ code: 'tenant_missing', path: `${path}.candidates[${index}].tenant`, message: 'the candidate\'s tenant disagrees with the trail\'s (L12)' });
      }
      if (isNonEmptyString(value.project) && record.project !== value.project) {
        errors.push({ code: 'tenant_missing', path: `${path}.candidates[${index}].project`, message: 'the candidate\'s project disagrees with the trail\'s (L12/L15)' });
      }
    });
    if (proposals > 1) {
      errors.push({
        code: 'backtest_rewrite',
        path: `${path}.candidates`,
        message: `the trail carries ${String(proposals)} proposed candidates — the selection is append-once (L11)`,
      });
    }
  }

  for (const crimePath of authorityViolations(value)) {
    errors.push({
      code: 'authority_in_strategy',
      path: `${path}.${crimePath}`,
      message: `backtest records embed no execution authority ("${crimePath}") (L8)`,
    });
  }

  if (errors.length > 0) return failures(errors);
  if (!isBacktestRecord(value)) {
    return fail('invalid_backtest', `${path} failed the structural record guard`);
  }
  const record = value as BacktestRecord;
  if (record.runId !== backtestRunIdOf(record.goal, record.tenant, record.project)) {
    return fail('invalid_backtest', `${path}.runId does not match the content-addressed id of the trail's basis`);
  }
  return ok(deepFreeze(record));
}
