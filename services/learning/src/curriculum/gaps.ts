/**
 * @tradrl/learning (service) — typed capability gaps and gap-driven
 * planning (T015).
 *
 * Spec anchors: spec/LEARNING-LOOP.md, "Failure-driven learning", VERBATIM:
 * "Failures create typed CapabilityGaps such as regime, sentiment/event,
 * liquidity, execution, risk or coordination failure." And "Method
 * selection": "Per capability: RL, offline RL, supervised learning,
 * imitation, preference optimization, bandits, self-play, adversarial
 * training, population search or statistical/causal methods."
 *
 * MIRROR DISCIPLINE (D-003/D-004): {@link CapabilityGapMirror} re-declares
 * the organization lane's `CapabilityGap` (T016, packages/organization/
 * src/gap.ts) field-for-field with the SAME brand tags (`CapabilityGapId`,
 * `CapabilityKey`, `AttainmentEvidenceRef`), so a REAL organization gap
 * record IS a curriculum-lane gap record (mutually assignable — the
 * compile-time trip wire) and satisfies this guard (the runtime trip
 * wire). The curriculum lane never imports the organization package:
 * populations and gaps INTERLOCK with the organization lane via these
 * opaque refs (Work Order T015, section 2: "mirrors, never imports").
 *
 * The method taxonomy mirror re-declares @tradrl/rl-protocol's
 * `LearningMethod` (T013) — the LEARNING-LOOP method selection union; the
 * interop trip wire asserts the parity. The gap kinds are the closed
 * six-failure-class vocabulary of LEARNING-LOOP.md — the same six kinds
 * the organization lane declares; the interop test asserts the vocabulary
 * parity kind-for-kind.
 */

import {
  type CurriculumError,
  type CurriculumResult,
  type TimestampMs,
  deepFreeze,
  fail,
  isMemberOf,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
} from './primitives';
import type {
  AttainmentEvidenceRef,
  CapabilityGapId,
  CapabilityKey,
} from './ids';
import {
  isAttainmentEvidenceRef,
  isCapabilityGapId,
  isCapabilityKey,
} from './ids';
import { type CurriculumStageKind, isCurriculumStageKind } from './ladder';

// ---------------------------------------------------------------------------
// The six failure classes (LEARNING-LOOP.md, verbatim)
// ---------------------------------------------------------------------------

/**
 * The closed capability-gap kind vocabulary — the six failure classes of
 * spec/LEARNING-LOOP.md ("regime, sentiment/event, liquidity, execution,
 * risk or coordination failure"), spelled exactly as the organization lane
 * spells them (the interop test asserts the parity).
 */
export const CAPABILITY_GAP_KINDS = deepFreeze([
  'regime',
  'sentiment-event',
  'liquidity',
  'execution',
  'risk',
  'coordination',
] as const);

/** One failure class (LEARNING-LOOP: "regime, sentiment/event, liquidity, execution, risk or coordination failure"). */
export type CapabilityGapKind = (typeof CAPABILITY_GAP_KINDS)[number];

/** Guard: `CapabilityGapKind`. */
export function isCapabilityGapKind(v: unknown): v is CapabilityGapKind {
  return isMemberOf(CAPABILITY_GAP_KINDS, v);
}

/**
 * One typed capability gap — STRUCTURAL MIRROR of the organization lane's
 * `CapabilityGap` (T016): the failure class, the missing capability
 * CONTRACT, the opaque evidence reference that detected the deficit, and
 * the explicit detection instant (never a wall clock — the determinism
 * law). Tenant/project scope per L12; the curriculum plan refuses a gap
 * whose scope disagrees with its own (`tenant_scope_mismatch`).
 */
export interface CapabilityGapMirror {
  /** Gap identity (unique within the plan input's gap list). */
  readonly gapId: CapabilityGapId;
  /** The failure class (closed six-kind vocabulary above). */
  readonly kind: CapabilityGapKind;
  /** The capability contract whose absence the failure evidences (never a profession label — L16a). */
  readonly capabilityKey: CapabilityKey;
  /** Opaque reference to the failure evidence that detected the deficit. */
  readonly evidenceRef: AttainmentEvidenceRef;
  /** Explicit detection instant (epoch ms — carried, never read from a clock). */
  readonly detectedAt: TimestampMs;
  /** Owning tenant (L12 — plain string, mirroring the organization lane's exact field type). */
  readonly tenantId: string;
  /** Owning project (L12 — plain string, mirroring the organization lane's exact field type). */
  readonly projectId: string;
}

/** Guard: `CapabilityGapMirror` (total, hand-rolled; mirrors the organization guard). */
export function isCapabilityGapMirror(v: unknown): v is CapabilityGapMirror {
  if (!isRecord(v)) return false;
  return (
    isCapabilityGapId(v.gapId) &&
    isCapabilityGapKind(v.kind) &&
    isCapabilityKey(v.capabilityKey) &&
    isAttainmentEvidenceRef(v.evidenceRef) &&
    isTimestampMs(v.detectedAt) &&
    isNonEmptyString(v.tenantId) &&
    isNonEmptyString(v.projectId)
  );
}

// ---------------------------------------------------------------------------
// The method taxonomy mirror (LEARNING-LOOP.md "Method selection")
// ---------------------------------------------------------------------------

/**
 * The closed learning-method set of spec/LEARNING-LOOP.md ("Method
 * selection") — STRUCTURAL MIRROR of @tradrl/rl-protocol's `LearningMethod`
 * (T013): rl, offline_rl, supervised, imitation,
 * preference_optimization, bandits, self_play, adversarial,
 * population_search. ("statistical/causal methods" remain an
 * evaluation-side concern and are deliberately NOT members — the same
 * deliberate exclusion the protocol package documents.)
 */
export type LearningMethodMirror =
  | 'rl'
  | 'offline_rl'
  | 'supervised'
  | 'imitation'
  | 'preference_optimization'
  | 'bandits'
  | 'self_play'
  | 'adversarial'
  | 'population_search';

/** Runtime-checkable list of learning methods (mirror of the protocol's taxonomy). */
export const LEARNING_METHODS_MIRROR: readonly LearningMethodMirror[] = deepFreeze([
  'rl',
  'offline_rl',
  'supervised',
  'imitation',
  'preference_optimization',
  'bandits',
  'self_play',
  'adversarial',
  'population_search',
] as const);

/** Guard: `LearningMethodMirror`. */
export function isLearningMethodMirror(v: unknown): v is LearningMethodMirror {
  return isMemberOf(LEARNING_METHODS_MIRROR, v);
}

// ---------------------------------------------------------------------------
// Gap-driven selection (failure-driven learning)
// ---------------------------------------------------------------------------

/**
 * The remediation a curriculum version DECLARES for one gap kind: the
 * ladder stage whose world remediates the failure class, and the
 * LEARNING-LOOP method the stage trains under. A version whose table does
 * not cover ALL SIX kinds is invalid (see validateGapTable — the
 * table-driven acceptance test walks every kind).
 */
export interface GapRemediation {
  /** The failure class this rule remediates. */
  readonly kind: CapabilityGapKind;
  /** The ladder stage whose world remediates the failure class. */
  readonly stage: CurriculumStageKind;
  /** The LEARNING-LOOP method the stage trains under (method-selection mirror). */
  readonly method: LearningMethodMirror;
}

/** Guard: `GapRemediation`. */
export function isGapRemediation(v: unknown): v is GapRemediation {
  if (!isRecord(v)) return false;
  if (!isCapabilityGapKind(v.kind)) return false;
  if (!isCurriculumStageKind(v.stage)) return false;
  return isLearningMethodMirror(v.method);
}

/**
 * Select the declared remediation for one gap kind from a curriculum
 * version's gap table — the pure lookup of failure-driven learning: "a gap
 * of kind X selects the stage + method declared for X in the curriculum
 * version record" (Work Order T015). An unmapped kind fails typed
 * (`gap_unmapped`), never silently — a curriculum that cannot answer a
 * failure class is not a curriculum.
 */
export function selectRemediation(
  table: readonly GapRemediation[],
  kind: CapabilityGapKind,
): CurriculumResult<GapRemediation> {
  for (const rule of table) {
    if (rule.kind === kind) return { ok: true, value: rule };
  }
  return fail(
    'gap_unmapped',
    `gap kind "${kind}" has no declared remediation in this curriculum version — failure-driven learning cannot select a stage for a failure class the version does not map (the version validator requires all ${CAPABILITY_GAP_KINDS.length} kinds)`,
    'gap_table',
  );
}

/**
 * Validate a whole gap table: every entry guard-valid, kinds unique, and
 * the TOTALITY law — the table must cover ALL SIX failure classes (a
 * version that cannot answer any failure class is not a curriculum).
 * On success the rules are returned deeply frozen.
 */
export function validateGapTable(v: unknown, path = 'gap_table'): CurriculumResult<readonly GapRemediation[]> {
  if (!Array.isArray(v)) {
    return fail('invalid_field', 'the gap table must be an array of remediation rules', path);
  }
  const errors: CurriculumError[] = [];
  const rules: GapRemediation[] = [];
  const seen = new Set<CapabilityGapKind>();
  (v as readonly unknown[]).forEach((entry, index) => {
    if (!isGapRemediation(entry)) {
      errors.push({
        code: 'version_invalid',
        path: `${path}[${index}]`,
        message: 'must be { kind, stage, method } with a closed-vocabulary kind, a ladder stage and a LEARNING-LOOP method',
      });
      return;
    }
    if (seen.has(entry.kind)) {
      errors.push({
        code: 'version_invalid',
        path: `${path}[${index}]`,
        message: `duplicate remediation for gap kind "${entry.kind}" — one kind, one declared remediation`,
      });
      return;
    }
    seen.add(entry.kind);
    rules.push(entry);
  });
  for (const kind of CAPABILITY_GAP_KINDS) {
    if (!seen.has(kind)) {
      errors.push({
        code: 'version_invalid',
        path,
        message: `gap kind "${kind}" has no declared remediation — the table must cover all six failure classes of spec/LEARNING-LOOP.md`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: rules };
}

/**
 * Guard for an untrusted gap-record list: every entry a valid mirror, gap
 * ids unique (a plan input that names one gap twice is not a bigger
 * failure — it is a malformed input).
 */
export function isGapList(v: unknown): v is readonly CapabilityGapMirror[] {
  if (!Array.isArray(v)) return false;
  const seen = new Set<string>();
  for (const entry of v as readonly unknown[]) {
    if (!isCapabilityGapMirror(entry)) return false;
    const gap = entry as CapabilityGapMirror;
    if (seen.has(gap.gapId)) return false; // ids unique within the input
    seen.add(gap.gapId);
  }
  return true;
}
