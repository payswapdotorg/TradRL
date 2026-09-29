/**
 * @tradrl/learning (service) — the curriculum trail (T015).
 *
 * THE EVIDENCE GATE AND THE HISTORY. This module owns the two halves of
 * "when a stage is passed or failed":
 *
 *   - {@link evidencedAdvance} / {@link recordedRegression} /
 *     {@link recordedRefusal} — the transition-record builders.
 *     Advancement is EVIDENCE-GATED (Work Order T015): a transition into
 *     the next rung must cite the evaluation evidence — the T012
 *     attainment verdict ref AND the criteria refs it decided — and the
 *     cited verdict must be ATTAINED with criteria covering the target
 *     stage's declared advancement criteria. A missing citation is the
 *     typed `evidence_missing` refusal; a non-attained verdict or
 *     uncovered criteria is `evidence_insufficient`. REGRESSION IS LEGAL
 *     AND RECORDED (a failed stage sends the curriculum back — the trail
 *     is append-only, L11): {@link recordedRegression} moves to any
 *     EARLIER rung, evidence optional (the failure's verdict citation,
 *     when present, is retained with the record).
 *   - {@link CurriculumTrail} — the append-only trail itself: every
 *     entry, advance, regress and refusal is a retained record; the ONLY
 *     mutation is {@link appendTransition} (a NEW trail; the original is
 *     untouched); a tampered or truncated trail fails
 *     {@link verifyTrailChain} with the typed `trail_rewrite` error
 *     (L11 — "optimization history is retained to expose selection
 *     effects").
 *   - THE STAGE-9 GATE (again, structurally): an ADVANCE into
 *     `controlled_live` must carry the declared permission record
 *     (`live_permission_missing` otherwise) — live execution is
 *     permitted-only, never default, on the plan AND on the trail.
 *   - THE LADDER ORDER (structurally): an advance moves EXACTLY one rung
 *     (`ladder_violation` otherwise — a curriculum that skips rungs has
 *     not passed them); a regress moves strictly down; every record's
 *     `from` is the trail's current rung (a trail that forks or jumps is
 *     `ladder_violation`).
 *
 * L9 lineage: every record cites the goal, the curriculum version, the
 * tenant and the project. L12: the trail's scope is fixed at creation and
 * every appended record must match it (`tenant_scope_mismatch`).
 *
 * DETERMINISM: the record chain is the FNV-1a fold over the canonical
 * bytes of each record, seeded from the lineage block — the same fold
 * discipline as the compute runner's outcome chain (T014) and the T013
 * step chain. Same records -> same chain, byte-identically, twice. No
 * ambient clock: `recordedAt` is an explicit parameter of every builder.
 */

import {
  type CurriculumError,
  type CurriculumResult,
  type TimestampMs,
  canonicalJson,
  deepFreeze,
  fail,
  fnv1a32Hex,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
} from './primitives';
import type {
  AcceptanceCriteriaId,
  CriteriaRef,
  CurriculumVersionRef,
  GoalRef,
  LivePermissionRef,
  ProjectId,
  TenantId,
  VerdictId,
} from './ids';
import type { AttainmentEvidenceRef } from './ids';
import {
  isAcceptanceCriteriaId,
  isCriteriaRef,
  isGoalRef,
  isLivePermissionRef,
  isProjectId,
  isTenantId,
  isVerdictId,
} from './ids';
import {
  CURRICULUM_STAGES,
  ENTRY_STAGE,
  advanceTarget,
  type CurriculumStageKind,
  isCurriculumStageKind,
  isLiveGatedStage,
  stagePosition,
} from './ladder';
import type { CurriculumVersion } from './version';

// ---------------------------------------------------------------------------
// The evidence citation (what an advancement must cite — T012 references)
// ---------------------------------------------------------------------------

/**
 * The evaluation evidence an advancement cites: the T012 attainment
 * verdict (opaque id), the criteria record it decided, the criteria refs
 * it covered, the attainment flag (mirrored from the verdict — the trail
 * never re-decides attainment, it CITES it), and the opaque evidence
 * reference. An advance without one of these is the typed
 * `evidence_missing` refusal; an attained=false or under-covering
 * citation is `evidence_insufficient`.
 */
export interface EvidenceCitation {
  /** The attainment verdict's id (T012 mirror brand). */
  readonly verdict: VerdictId;
  /** The compiled acceptance-criteria record the verdict decided. */
  readonly criteria: AcceptanceCriteriaId;
  /** The criteria refs the citation covers (must cover the stage's declared advancement criteria). */
  readonly criteria_refs: readonly CriteriaRef[];
  /** Mirrored from the verdict: every criterion attained in every split. */
  readonly attained: boolean;
  /** Opaque reference to the evaluation run's evidence record. */
  readonly evidence_ref: AttainmentEvidenceRef;
}

/** Guard: `EvidenceCitation`. */
export function isEvidenceCitation(v: unknown): v is EvidenceCitation {
  if (!isRecord(v)) return false;
  if (!isVerdictId(v.verdict)) return false;
  if (!isAcceptanceCriteriaId(v.criteria)) return false;
  if (!Array.isArray(v.criteria_refs) || v.criteria_refs.length === 0) return false;
  if (!(v.criteria_refs as readonly unknown[]).every((ref) => isCriteriaRef(ref))) return false;
  if (typeof v.attained !== 'boolean') return false;
  return isNonEmptyString(v.evidence_ref);
}

// ---------------------------------------------------------------------------
// The transition record
// ---------------------------------------------------------------------------

/** The closed transition-kind vocabulary: entering, advancing, regressing, refusing. */
export const STAGE_TRANSITION_KINDS = deepFreeze(['entry', 'advance', 'regress', 'refusal'] as const);

/** One transition kind. */
export type StageTransitionKind = (typeof STAGE_TRANSITION_KINDS)[number];

/** Guard: `StageTransitionKind`. */
export function isStageTransitionKind(v: unknown): v is StageTransitionKind {
  return typeof v === 'string' && (STAGE_TRANSITION_KINDS as readonly string[]).includes(v);
}

/** The closed transition-reason vocabulary (machine-checkable, never free text). */
export const TRANSITION_REASONS = deepFreeze([
  'ladder_entry',
  'evidenced_advance',
  'evidenced_regression',
  'evidence_missing',
  'evidence_insufficient',
  'live_permission_missing',
] as const);

/** One transition reason. */
export type TransitionReason = (typeof TRANSITION_REASONS)[number];

/** Guard: `TransitionReason`. */
export function isTransitionReason(v: unknown): v is TransitionReason {
  return typeof v === 'string' && (TRANSITION_REASONS as readonly string[]).includes(v);
}

/**
 * The L9/L12 lineage block every transition record carries: the goal, the
 * curriculum version, the scope — and (only on an advance into stage 9)
 * the live-execution permission record.
 */
export interface TransitionLineage {
  readonly goal: GoalRef;
  readonly curriculum_version: CurriculumVersionRef;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: `TransitionLineage`. */
export function isTransitionLineage(v: unknown): v is TransitionLineage {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.goal)) return false;
  if (!isNonEmptyString(v.curriculum_version)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  return true;
}

/**
 * One stage transition: the kind, the rungs (`from` null on entry, `to`
 * null on refusal), the evidence citation (REQUIRED on advance, optional
 * on regress, absent on entry/refusal), the machine-checkable reason, the
 * explicit recorded instant (never a wall clock), the lineage block (L9/
 * L12), and — only when moving INTO `controlled_live` — the permission
 * record (the stage-9 trail gate).
 */
export interface StageTransition {
  readonly kind: StageTransitionKind;
  /** The rung moved from (null on `entry`). */
  readonly from: CurriculumStageKind | null;
  /** The rung moved to (null on `refusal`). */
  readonly to: CurriculumStageKind | null;
  /** The evaluation evidence (required on `advance`; optional on `regress`). */
  readonly evidence: EvidenceCitation | null;
  readonly reason: TransitionReason;
  /** Explicit recorded instant (epoch ms — carried, never read from a clock). */
  readonly recordedAt: TimestampMs;
  readonly lineage: TransitionLineage;
  /** The stage-9 permission record (REQUIRED when `to` is `controlled_live`). */
  readonly live_permission: LivePermissionRef | null;
}

/** Guard: `StageTransition`. */
export function isStageTransition(v: unknown): v is StageTransition {
  if (!isRecord(v)) return false;
  if (!isStageTransitionKind(v.kind)) return false;
  if (v.from !== null && !isCurriculumStageKind(v.from)) return false;
  if (v.to !== null && !isCurriculumStageKind(v.to)) return false;
  if (v.evidence !== null && !isEvidenceCitation(v.evidence)) return false;
  if (!isTransitionReason(v.reason)) return false;
  if (!isTimestampMs(v.recordedAt)) return false;
  if (!isTransitionLineage(v.lineage)) return false;
  if (v.live_permission !== null && !isLivePermissionRef(v.live_permission)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The transition builders (pure; the evidence gate's constructors)
// ---------------------------------------------------------------------------

/**
 * The entry record: the trail's FIRST record, entering the ladder at the
 * bottom rung (spec/LEARNING-LOOP.md's ladder is ordered; entry needs no
 * evidence — nothing has been attempted yet, and the entry says so).
 */
export function enterCurriculum(lineage: unknown, recordedAt: TimestampMs): CurriculumResult<StageTransition> {
  const errors: CurriculumError[] = [];
  let validLineage: TransitionLineage | null = null;
  if (!isTransitionLineage(lineage)) {
    errors.push({ code: 'lineage_gap', path: 'lineage', message: 'the entry record must carry goal, curriculum version, tenant and project (L9/L12)' });
  } else {
    validLineage = lineage;
  }
  if (!isTimestampMs(recordedAt)) {
    errors.push({ code: 'invalid_timestamp', path: 'recordedAt', message: 'recordedAt must be a valid TimestampMs (no ambient clock)' });
  }
  if (validLineage === null || errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: deepFreeze({
      kind: 'entry',
      from: null,
      to: ENTRY_STAGE,
      evidence: null,
      reason: 'ladder_entry',
      recordedAt,
      lineage: validLineage,
      live_permission: null,
    }),
  };
}

/**
 * THE EVIDENCE GATE: build the advance record from `from` to its NEXT
 * rung. The citation is REQUIRED (`evidence_missing` without one — the
 * work order's named negative test), must be ATTAINED and must COVER the
 * target stage's declared advancement criteria refs (`evidence_insufficient`
 * otherwise — an attained verdict on OTHER criteria does not justify this
 * stage). When the target is `controlled_live`, the permission record is
 * REQUIRED (`live_permission_missing` — the trail half of the stage-9
 * gate).
 */
export function evidencedAdvance(
  from: CurriculumStageKind,
  evidence: unknown,
  requiredCriteria: readonly CriteriaRef[],
  recordedAt: TimestampMs,
  lineage: unknown,
  livePermission: LivePermissionRef | null,
): CurriculumResult<StageTransition> {
  if (!isCurriculumStageKind(from)) {
    return fail('stage_unknown', `cannot advance from ${JSON.stringify(from)} — not a ladder stage`, 'from');
  }
  const target = advanceTarget(from);
  if (target === null) {
    return fail('ladder_violation', `stage "${from}" is the top of the ladder — there is nothing to advance to`, 'from');
  }
  if (evidence === null) {
    // The typed refusal: the caller MUST record it (recordedRefusal) — an
    // advancement without an attainment-verdict citation is refused, never
    // silently defaulted (the work order's evidence-gate law).
    return fail(
      'evidence_missing',
      `cannot advance from "${from}" to "${target}" without an attainment-verdict citation — stage advancement is evidence-gated (cite the T012 verdict ref + criteria)`,
      'evidence',
    );
  }
  if (!isEvidenceCitation(evidence)) {
    return fail('invalid_field', 'the advancement citation failed the EvidenceCitation guard (verdict, criteria, covered refs, attained flag, evidence ref)', 'evidence');
  }
  if (!isTimestampMs(recordedAt)) {
    return fail('invalid_timestamp', 'recordedAt must be a valid TimestampMs (no ambient clock)', 'recordedAt');
  }
  if (!isTransitionLineage(lineage)) {
    return fail('lineage_gap', 'the advance record must carry goal, curriculum version, tenant and project (L9/L12)', 'lineage');
  }
  if (!evidence.attained) {
    return fail(
      'evidence_insufficient',
      `the cited verdict "${evidence.verdict}" did not attain — a non-attained verdict cannot justify advancing from "${from}" to "${target}"`,
      'evidence.attained',
    );
  }
  const covered = new Set<string>(evidence.criteria_refs);
  const uncovered = requiredCriteria.filter((ref) => !covered.has(ref));
  if (uncovered.length > 0) {
    return fail(
      'evidence_insufficient',
      `the cited verdict "${evidence.verdict}" covers [${evidence.criteria_refs.join(', ')}] but the stage "${target}" requires the advancement criteria [${requiredCriteria.join(', ')}] — uncovered: ${uncovered.join(', ')}`,
      'evidence.criteria_refs',
    );
  }
  if (isLiveGatedStage(target) && livePermission === null) {
    return fail(
      'live_permission_missing',
      `advancing into "${target}" requires the declared permission record — live execution is permitted-only, never default`,
      'live_permission',
    );
  }
  return {
    ok: true,
    value: deepFreeze({
      kind: 'advance',
      from,
      to: target,
      evidence,
      reason: 'evidenced_advance',
      recordedAt,
      lineage,
      live_permission: livePermission,
    }),
  };
}

/**
 * Build the regression record: a FAILED stage sends the curriculum BACK —
 * to any EARLIER rung (`ladder_violation` otherwise). The evidence
 * citation is OPTIONAL (a failed verdict motivates the move when present;
 * a regression without a verdict is still an auditable record — the
 * reason is the regression itself). The record is RETAINED, never
 * dropped: append it, and the trail keeps it forever (L11).
 */
export function recordedRegression(
  from: CurriculumStageKind,
  to: CurriculumStageKind,
  recordedAt: TimestampMs,
  lineage: unknown,
  evidence: unknown = null,
): CurriculumResult<StageTransition> {
  if (!isCurriculumStageKind(from)) {
    return fail('stage_unknown', `cannot regress from ${JSON.stringify(from)} — not a ladder stage`, 'from');
  }
  if (!isCurriculumStageKind(to)) {
    return fail('stage_unknown', `cannot regress to ${JSON.stringify(to)} — not a ladder stage`, 'to');
  }
  if (stagePosition(to) >= stagePosition(from)) {
    return fail(
      'ladder_violation',
      `a regression moves DOWN the ladder — "${to}" (rung ${stagePosition(to) + 1}) is not below "${from}" (rung ${stagePosition(from) + 1})`,
      'to',
    );
  }
  if (evidence !== null && !isEvidenceCitation(evidence)) {
    return fail('invalid_field', 'the regression citation failed the EvidenceCitation guard', 'evidence');
  }
  if (!isTimestampMs(recordedAt)) {
    return fail('invalid_timestamp', 'recordedAt must be a valid TimestampMs (no ambient clock)', 'recordedAt');
  }
  if (!isTransitionLineage(lineage)) {
    return fail('lineage_gap', 'the regression record must carry goal, curriculum version, tenant and project (L9/L12)', 'lineage');
  }
  return {
    ok: true,
    value: deepFreeze({
      kind: 'regress',
      from,
      to,
      evidence,
      reason: 'evidenced_regression',
      recordedAt,
      lineage,
      live_permission: null,
    }),
  };
}

/**
 * Build the typed REFUSAL record: an advancement was attempted WITHOUT
 * evidence and is refused — the refusal itself is RETAINED DATA (L11),
 * never an exception. The trail records that the move was withheld and
 * why (`evidence_missing` or `evidence_insufficient`).
 */
export function recordedRefusal(
  from: CurriculumStageKind,
  reason: 'evidence_missing' | 'evidence_insufficient' | 'live_permission_missing',
  recordedAt: TimestampMs,
  lineage: unknown,
): CurriculumResult<StageTransition> {
  if (!isCurriculumStageKind(from)) {
    return fail('stage_unknown', `cannot refuse a move from ${JSON.stringify(from)} — not a ladder stage`, 'from');
  }
  if (!isTimestampMs(recordedAt)) {
    return fail('invalid_timestamp', 'recordedAt must be a valid TimestampMs (no ambient clock)', 'recordedAt');
  }
  if (!isTransitionLineage(lineage)) {
    return fail('lineage_gap', 'the refusal record must carry goal, curriculum version, tenant and project (L9/L12)', 'lineage');
  }
  return {
    ok: true,
    value: deepFreeze({
      kind: 'refusal',
      from,
      to: null,
      evidence: null,
      reason,
      recordedAt,
      lineage,
      live_permission: null,
    }),
  };
}

// ---------------------------------------------------------------------------
// The trail (append-only, L11)
// ---------------------------------------------------------------------------

/**
 * The curriculum trail: the lineage block (goal, curriculum version,
 * scope — L9/L12), the append-only transition records, and the RECORD
 * CHAIN — one FNV-1a digest head per appended record, seeded from the
 * canonical bytes of the lineage block and folded over each record's
 * canonical bytes in append order (the T013/T014 chain discipline). A
 * tampered or truncated trail fails {@link verifyTrailChain} with the
 * typed `trail_rewrite` error: the history is retained, and provably so.
 */
export interface CurriculumTrail {
  readonly lineage: TransitionLineage;
  /** The transition records in append order (entry first). */
  readonly records: readonly StageTransition[];
  /** Digest head after each appended record, in append order. */
  readonly record_chain: readonly string[];
}

/** The trail serialization schema marker (versioned with the lane). */
export const CURRICULUM_TRAIL_SCHEMA = 'tradrl/curriculum-trail@1';

/** The chain seed: FNV-1a over the canonical bytes of the lineage block. */
function trailChainSeed(lineage: TransitionLineage): string {
  return `trail-${fnv1a32Hex(canonicalJson({
    goal: lineage.goal,
    curriculum_version: lineage.curriculum_version,
    tenant: lineage.tenant,
    project: lineage.project,
  }))}`;
}

/** One chain fold step (the T013 `fnv1a32(prev + ':' + digest)` discipline). */
function chainStep(previous: string, record: StageTransition): string {
  return fnv1a32Hex(`${previous}:${recordDigest(record)}`);
}

/** The canonical bytes of one transition record (the fold input). */
function recordDigest(record: StageTransition): string {
  return fnv1a32Hex(
    canonicalJson({
      kind: record.kind,
      from: record.from,
      to: record.to,
      evidence: record.evidence === null ? null : {
        verdict: record.evidence.verdict,
        criteria: record.evidence.criteria,
        criteria_refs: [...record.evidence.criteria_refs],
        attained: record.evidence.attained,
        evidence_ref: record.evidence.evidence_ref,
      },
      reason: record.reason,
      recordedAt: record.recordedAt,
      lineage: {
        goal: record.lineage.goal,
        curriculum_version: record.lineage.curriculum_version,
        tenant: record.lineage.tenant,
        project: record.lineage.project,
      },
      live_permission: record.live_permission,
    }),
  );
}

/** The trail's current rung: the last non-refusal record's `to` (or null before entry). */
export function trailPosition(trail: CurriculumTrail): CurriculumStageKind | null {
  for (let index = trail.records.length - 1; index >= 0; index--) {
    const record = trail.records[index];
    if (record.kind !== 'refusal') return record.to;
  }
  return null;
}

/** Runtime guard for a structurally coherent trail (shape + chain length + scope coherence). */
export function isCurriculumTrail(v: unknown): v is CurriculumTrail {
  if (!isRecord(v)) return false;
  if (!isTransitionLineage(v.lineage)) return false;
  if (!Array.isArray(v.records)) return false;
  if (!(v.records as readonly unknown[]).every((record) => isStageTransition(record))) return false;
  if (!Array.isArray(v.record_chain)) return false;
  if ((v.record_chain as readonly unknown[]).length !== (v.records as readonly unknown[]).length) return false;
  // Every record shares the trail's lineage (scope coherence, L12).
  const records = v.records as readonly StageTransition[];
  const lineage = v.lineage as TransitionLineage;
  return records.every(
    (record) =>
      record.lineage.goal === lineage.goal &&
      record.lineage.curriculum_version === lineage.curriculum_version &&
      record.lineage.tenant === lineage.tenant &&
      record.lineage.project === lineage.project,
  );
}

/**
 * Open a trail with its entry record: the lineage block is validated, the
 * entry must be the bottom rung, and the trail starts its chain. The ONLY
 * way to grow it is {@link appendTransition} (L11).
 */
export function openCurriculumTrail(entry: unknown): CurriculumResult<CurriculumTrail> {
  if (!isStageTransition(entry)) {
    return fail('invalid_field', 'the trail must open with a guard-valid entry record');
  }
  if (entry.kind !== 'entry') {
    return fail('invalid_field', `the trail's first record must be the entry (got "${entry.kind}") — a trail opens at the bottom of the ladder`, 'kind');
  }
  if (entry.to !== ENTRY_STAGE) {
    return fail('ladder_violation', `the entry record must enter at "${ENTRY_STAGE}" (got "${String(entry.to)}") — the ladder is climbed from the bottom`, 'to');
  }
  const chain = [chainStep(trailChainSeed(entry.lineage), entry)];
  return {
    ok: true,
    value: deepFreeze({ lineage: entry.lineage, records: [entry], record_chain: chain }),
  };
}

/**
 * Append one transition (the ONLY mutation — L11). The record is
 * guard-validated, its lineage must match the trail's (`tenant_scope_mismatch`
 * — L12), and the MOVE laws are enforced against the trail's current
 * position:
 *   - `entry` — only as the first record (a re-entry into an open trail
 *     is `trail_rewrite`);
 *   - `advance` — `from` is the current rung, `to` is exactly one rung up
 *     (`ladder_violation`), the citation covers the target's declared
 *     advancement criteria (checked against `version` when supplied —
 *     `evidence_insufficient`);
 *   - `regress` — `from` is the current rung, `to` strictly below;
 *   - `refusal` — `from` is the current rung, `to` null.
 * Returns a NEW trail with the record appended and the chain folded; the
 * original is untouched.
 */
export function appendTransition(
  trail: CurriculumTrail,
  record: unknown,
  version?: CurriculumVersion,
): CurriculumResult<CurriculumTrail> {
  if (!isCurriculumTrail(trail)) {
    return fail('invalid_field', 'appendTransition requires a valid curriculum trail');
  }
  const check = isStageTransition(record) ? record : null;
  if (check === null) {
    return fail('invalid_field', 'the appended record must be a guard-valid stage transition');
  }
  // L12: the record's lineage IS the trail's lineage.
  if (
    check.lineage.goal !== trail.lineage.goal ||
    check.lineage.curriculum_version !== trail.lineage.curriculum_version ||
    check.lineage.tenant !== trail.lineage.tenant ||
    check.lineage.project !== trail.lineage.project
  ) {
    return fail(
      'tenant_scope_mismatch',
      `the record's lineage (goal "${check.lineage.goal}", version "${check.lineage.curriculum_version}", tenant "${check.lineage.tenant}", project "${check.lineage.project}") does not match the trail's — one trail, one scope (L12)`,
      'lineage',
    );
  }
  // Monotonic time: a record recorded BEFORE its predecessor is a rewrite
  // attempt (history never rewinds, L11).
  const last = trail.records[trail.records.length - 1];
  if (last !== undefined && check.recordedAt < last.recordedAt) {
    return fail(
      'trail_rewrite',
      `the record's instant (${check.recordedAt}) precedes its predecessor's (${last.recordedAt}) — the trail never rewinds (L11)`,
      'recordedAt',
    );
  }

  const position = trailPosition(trail);
  if (check.kind === 'entry') {
    return fail('trail_rewrite', 'an open trail cannot re-enter — the entry is the first record and history never rewinds (L11)', 'kind');
  }
  if (position === null) {
    return fail('ladder_violation', 'the trail has no current rung — open it with the entry record first', 'from');
  }
  if (check.from !== position) {
    return fail(
      'ladder_violation',
      `the record moves from "${check.from}" but the trail's current rung is "${position}" — a trail has one position, it does not fork`,
      'from',
    );
  }

  // The one-rung law (structural, independent of the builder): an ADVANCE
  // moves EXACTLY one rung up — a hand-built record naming a two-rung jump
  // is refused here even though the builder could never produce it
  // (defense in depth: the ladder is ordered, and a curriculum that skips
  // rungs has not passed them).
  if (check.kind === 'advance') {
    if (check.to === null || check.to !== advanceTarget(position)) {
      return fail(
        'ladder_violation',
        `an advance from "${position}" must move to exactly one rung up ("${String(advanceTarget(position))}"), not "${String(check.to)}" — the ladder is ordered and rungs are not skipped`,
        'to',
      );
    }
    // The advance's citation is required HERE too (a hand-built advance
    // with no evidence is the evidence gate's negative, at trail level).
    if (check.evidence === null) {
      return fail(
        'evidence_missing',
        `an advance from "${position}" to "${check.to}" without an attainment-verdict citation is refused — stage advancement is evidence-gated`,
        'evidence',
      );
    }
  }
  // A REGRESS moves strictly down (the builder's law, restated here for
  // hand-built records).
  if (check.kind === 'regress' && (check.to === null || stagePosition(check.to) >= stagePosition(position))) {
    return fail(
      'ladder_violation',
      `a regression from "${position}" must move DOWN the ladder, not to "${String(check.to)}"`,
      'to',
    );
  }
  // A REFUSAL moves nowhere.
  if (check.kind === 'refusal' && check.to !== null) {
    return fail('invalid_field', 'a refusal withholds the move — its `to` is null', 'to');
  }

  // The advance's criteria-coverage law, checked against the version's
  // declaration for the target stage (defense in depth: the builder
  // checked the caller-supplied criteria; the trail checks the VERSION's).
  if (check.kind === 'advance' && version !== undefined && check.to !== null) {
    const rule: unknown = (version.stages as Record<string, unknown>)[check.to];
    if (rule === undefined) {
      return fail('stage_unknown', `the curriculum version has no rule for stage "${check.to}"`, 'to');
    }
    const config: unknown = (rule as { config?: unknown }).config;
    const required: readonly CriteriaRef[] =
      isRecord(config) && Array.isArray(config.advancement_criteria) ? (config.advancement_criteria as readonly CriteriaRef[]) : [];
    const covered = new Set<string>(check.evidence === null ? [] : check.evidence.criteria_refs);
    const uncovered = required.filter((ref: CriteriaRef) => !covered.has(ref));
    if (uncovered.length > 0) {
      return fail(
        'evidence_insufficient',
        `the advance into "${check.to}" cites evidence that does not cover the version's declared advancement criteria — uncovered: ${uncovered.join(', ')}`,
        'evidence.criteria_refs',
      );
    }
  }

  const chain = [...trail.record_chain, chainStep(trail.record_chain[trail.record_chain.length - 1] ?? trailChainSeed(trail.lineage), check)];
  return {
    ok: true,
    value: deepFreeze({
      lineage: trail.lineage,
      records: [...trail.records, check],
      record_chain: chain,
    }),
  };
}

/**
 * Verify the trail's record chain: recompute the lineage seed and fold
 * every record in append order, comparing heads. A tampered or partial
 * trail fails with the typed `trail_rewrite` error — hiding or editing
 * history is a typed crime, never a silent success (L11).
 */
export function verifyTrailChain(trail: CurriculumTrail): CurriculumResult<true> {
  if (!isCurriculumTrail(trail)) {
    return fail('invalid_field', 'verifyTrailChain requires a valid curriculum trail');
  }
  let head = trailChainSeed(trail.lineage);
  let count = 0;
  for (const record of trail.records) {
    head = chainStep(head, record);
    const expected = trail.record_chain[count];
    if (expected !== head) {
      return fail(
        'trail_rewrite',
        `trail record ${count} chains to "${String(expected)}" but the records fold to "${head}" — the trail was tampered with or truncated (L11)`,
      );
    }
    count += 1;
  }
  if (count !== trail.record_chain.length) {
    return fail(
      'trail_rewrite',
      `the chain records ${trail.record_chain.length} heads but the trail carries ${count} records`,
    );
  }
  return { ok: true, value: true };
}

// ---------------------------------------------------------------------------
// Serialization / resume (the byte-determinism artifact)
// ---------------------------------------------------------------------------

/**
 * Serialize a trail to canonical JSON bytes: the schema envelope
 * (`tradrl/curriculum-trail@1`) over the lineage, records and chain.
 * Deterministic: equal trails produce identical bytes. The trail is
 * JSON-shaped by construction (every field is a JSON value — the record
 * shapes forbid anything else), so the canonical form is well-defined.
 */
export function serializeCurriculumTrail(trail: CurriculumTrail): CurriculumResult<string> {
  if (!isCurriculumTrail(trail)) {
    return fail('invalid_field', 'serializeCurriculumTrail requires a valid curriculum trail');
  }
  return { ok: true, value: canonicalTrailBytes(trail) };
}

/** The canonical bytes of a trail (the shared serialization core). */
function canonicalTrailBytes(trail: CurriculumTrail): string {
  const envelope = {
    schema: CURRICULUM_TRAIL_SCHEMA,
    trail: {
      lineage: {
        goal: trail.lineage.goal,
        curriculum_version: trail.lineage.curriculum_version,
        tenant: trail.lineage.tenant,
        project: trail.lineage.project,
      },
      records: trail.records.map((record) => ({
        kind: record.kind,
        from: record.from,
        to: record.to,
        evidence:
          record.evidence === null
            ? null
            : {
                verdict: record.evidence.verdict,
                criteria: record.evidence.criteria,
                criteria_refs: [...record.evidence.criteria_refs],
                attained: record.evidence.attained,
                evidence_ref: record.evidence.evidence_ref,
              },
        reason: record.reason,
        recordedAt: record.recordedAt,
        lineage: {
          goal: record.lineage.goal,
          curriculum_version: record.lineage.curriculum_version,
          tenant: record.lineage.tenant,
          project: record.lineage.project,
        },
        live_permission: record.live_permission,
      })),
    record_chain: [...trail.record_chain],
    },
  };
  return canonicalJson(envelope);
}

/**
 * Resume a trail from serialized bytes: parse, enforce the schema,
 * structurally re-validate, re-freeze, and VERIFY THE RECORD CHAIN
 * (`trail_rewrite` on mismatch — the resume gate's whole point).
 */
export function resumeCurriculumTrail(bytes: string): CurriculumResult<CurriculumTrail> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse failure';
    return fail('invalid_payload', `the trail bytes are not valid JSON: ${message}`);
  }
  if (!isRecord(parsed)) {
    return fail('invalid_payload', 'the trail envelope must be an object');
  }
  if (parsed.schema !== CURRICULUM_TRAIL_SCHEMA) {
    return fail('invalid_payload', `expected schema "${CURRICULUM_TRAIL_SCHEMA}", got ${JSON.stringify(parsed.schema)}`);
  }
  const trail: unknown = parsed.trail;
  if (!isCurriculumTrail(trail)) {
    return fail('invalid_payload', 'the parsed value fails the curriculum trail guard (lineage, records, chain shape or scope coherence)');
  }
  const verified = verifyTrailChain(trail);
  if (!verified.ok) return verified;
  return { ok: true, value: deepFreeze(trail) };
}

// ---------------------------------------------------------------------------
// The trail's stage-experiment ledger projection (L9 — what ran, per rung)
// ---------------------------------------------------------------------------

/** The experiments a trail's stages commissioned, in append order (opaque refs, never run here). */
export function trailExperiments(plan: { readonly stages: readonly { readonly motivation: { readonly experiment: string } }[] }): readonly string[] {
  return plan.stages.map((stage) => stage.motivation.experiment);
}

/** The ladder closure witness: every stage kind, once (re-exported for tests). */
export const LADDER_STAGES = CURRICULUM_STAGES;
