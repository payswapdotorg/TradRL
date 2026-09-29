/**
 * @tradrl/learning (service) — the curriculum version record (T015).
 *
 * THE DECLARATION, NOT THE MOOD: every plan and every gap-driven
 * replanning consults a `CurriculumVersion` — the versioned record that
 * DECLARES, per ladder stage, the honest world mode (L6), the environment
 * config, the advancement criteria (the evidence gate's citation targets),
 * the evaluator/splits lineage (L9), the commission parameters (policy,
 * reward models, driver, batch shape — T013/T014 mirrors) and the LEARNING
 * method each stage trains under (spec/LEARNING-LOOP.md "Method
 * selection"); and, per failure class, the gap-driven remediation (the
 * failure-driven-learning table).
 *
 * Laws enforced by {@link validateCurriculumVersion}:
 *   - VERSIONING (L9): the version ref is a non-empty versioned reference
 *     and the version number a positive safe integer — a curriculum
 *     without identity is not a schedule.
 *   - LADDER TOTALITY: the per-stage table must cover EXACTLY the nine
 *     stages — no gaps, no extras (a version that cannot schedule the
 *     whole ladder is not a curriculum).
 *   - L6 FIDELITY HONESTY: every stage's declared world mode must satisfy
 *     the stage kind's frozen fidelity claim (ladder.ts) —
 *     `fidelity_claim_violation` (e.g. historical_replay + generative is
 *     the work order's named typed error).
 *   - GAP TOTALITY: the gap table must cover ALL SIX failure classes
 *     (gaps.ts `validateGapTable`).
 *   - METHOD: every declared method is a LEARNING-LOOP method
 *     (`method_unknown` otherwise).
 *   - L12: the version itself carries tenant + project (a curriculum
 *     belongs to a scope).
 *
 * Determinism: validation is pure; the validated record is deeply frozen;
 * the same untrusted input yields the same frozen record, twice.
 */

import {
  type CurriculumError,
  type CurriculumResult,
  deepFreeze,
  fail,
  isMemberOf,
  isRecord,
} from './primitives';
import type {
  CurriculumVersionRef,
  ProjectId,
  TenantId,
} from './ids';
import { isCurriculumVersionRef, isProjectId, isTenantId } from './ids';
import {
  CURRICULUM_STAGES,
  type CurriculumStageKind,
  isCurriculumStageKind,
  checkFidelityHonesty,
} from './ladder';
import {
  type GapRemediation,
  type LearningMethodMirror,
  isLearningMethodMirror,
  validateGapTable,
} from './gaps';
import {
  type StageCommissionConfig,
  isStageCommissionConfig,
} from './commission';

// ---------------------------------------------------------------------------
// The per-stage entry of a curriculum version
// ---------------------------------------------------------------------------

/**
 * One ladder rung as a curriculum version DECLARES it: the stage kind, the
 * honest world mode (L6), the commission parameters (environment config,
 * criteria, evaluator, splits, policy, reward models, driver, batch shape)
 * and the LEARNING-LOOP method the stage trains under.
 */
export interface StageRule {
  /** The ladder rung this rule schedules. */
  readonly stage: CurriculumStageKind;
  /** The declared method (spec/LEARNING-LOOP.md "Method selection"). */
  readonly method: LearningMethodMirror;
  /** The commission parameters (T011/T013/T014 mirrors). */
  readonly config: StageCommissionConfig;
}

/** Guard: `StageRule` (structural; the L6 check lives in the version validator). */
export function isStageRule(v: unknown): v is StageRule {
  if (!isRecord(v)) return false;
  if (!isCurriculumStageKind(v.stage)) return false;
  if (!isLearningMethodMirror(v.method)) return false;
  return isStageCommissionConfig(v.config);
}

// ---------------------------------------------------------------------------
// The curriculum version record
// ---------------------------------------------------------------------------

/**
 * A curriculum version: the versioned declaration of the whole ladder —
 * one {@link StageRule} per stage kind (all nine, exactly once), the
 * failure-driven-learning gap table (all six kinds), and the owning
 * tenant/project scope (L12). Immutable once validated; plans cite it in
 * their lineage (L9).
 */
export interface CurriculumVersion {
  /** The versioned identity plans cite (e.g. `curriculum@1.0.0`). */
  readonly version: CurriculumVersionRef;
  /** The version's sequence number (positive safe integer). */
  readonly sequence: number;
  /** The nine stage rules, keyed by stage kind. */
  readonly stages: Readonly<Record<CurriculumStageKind, StageRule>>;
  /** The failure-driven-learning table (all six gap kinds). */
  readonly gap_table: readonly GapRemediation[];
  /** Owning tenant (L12). */
  readonly tenant: TenantId;
  /** Owning project (L12/L15). */
  readonly project: ProjectId;
}

/** Guard: `CurriculumVersion` (structural totality; full laws in the validator). */
export function isCurriculumVersion(v: unknown): v is CurriculumVersion {
  if (!isRecord(v)) return false;
  if (!isCurriculumVersionRef(v.version)) return false;
  if (typeof v.sequence !== 'number' || !Number.isSafeInteger(v.sequence) || v.sequence < 1) return false;
  if (!isRecord(v.stages)) return false;
  for (const stage of CURRICULUM_STAGES) {
    const rule = (v.stages as Record<string, unknown>)[stage];
    if (!isStageRule(rule)) return false;
  }
  if (!Array.isArray(v.gap_table)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Validation (collect-all; the declaration laws)
// ---------------------------------------------------------------------------

/**
 * Deep validation of an untrusted curriculum version. Collects ALL
 * violations: version identity, sequence, the nine-stage totality (each
 * stage exactly once, guard-valid), the per-stage L6 fidelity honesty
 * (`fidelity_claim_violation` — the named negative test), the per-stage
 * method (`method_unknown`), the six-kind gap table totality, and the
 * L12 scope. On success returns the narrowed, deeply frozen record.
 */
export function validateCurriculumVersion(v: unknown, path = 'version'): CurriculumResult<CurriculumVersion> {
  if (!isRecord(v)) {
    return fail('invalid_type', `${path} must be an object`, path);
  }
  const errors: CurriculumError[] = [];

  if (v.version === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.version`, message: 'the curriculum version ref is missing (L9 — plans cite it)' });
  } else if (!isCurriculumVersionRef(v.version)) {
    errors.push({ code: 'version_invalid', path: `${path}.version`, message: 'must be a non-empty versioned curriculum reference' });
  }

  if (v.sequence === undefined) {
    errors.push({ code: 'missing_field', path: `${path}.sequence`, message: 'the version sequence number is missing' });
  } else if (typeof v.sequence !== 'number' || !Number.isSafeInteger(v.sequence) || v.sequence < 1) {
    errors.push({ code: 'version_invalid', path: `${path}.sequence`, message: 'must be a positive safe integer' });
  }

  if (v.tenant === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the curriculum version tenant is missing (L12)' });
  } else if (!isTenantId(v.tenant)) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'must be a non-empty tenant id (L12)' });
  }

  if (v.project === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the curriculum version project is missing (L15)' });
  } else if (!isProjectId(v.project)) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'must be a non-empty project id (L15)' });
  }

  if (v.stages === undefined) {
    errors.push({ code: 'version_invalid', path: `${path}.stages`, message: 'the per-stage rule table is missing' });
  } else if (!isRecord(v.stages)) {
    errors.push({ code: 'version_invalid', path: `${path}.stages`, message: 'must be an object keyed by the nine ladder stages' });
  } else {
    const stages = v.stages as Record<string, unknown>;
    // Totality: every ladder stage present, guard-valid, L6-honest, method-valid.
    for (const stage of CURRICULUM_STAGES) {
      const rule = stages[stage];
      if (rule === undefined) {
        errors.push({
          code: 'version_invalid',
          path: `${path}.stages.${stage}`,
          message: `ladder stage "${stage}" has no declared rule — a curriculum version schedules the WHOLE ladder`,
        });
        continue;
      }
      if (!isStageRule(rule)) {
        errors.push({
          code: 'version_invalid',
          path: `${path}.stages.${stage}`,
          message: 'must be { stage, method, config } with a LEARNING-LOOP method and a valid commission configuration',
        });
        continue;
      }
      if (rule.stage !== stage) {
        errors.push({
          code: 'version_invalid',
          path: `${path}.stages.${stage}.stage`,
          message: `rule keyed "${stage}" names stage "${rule.stage}" — the key and the named stage must agree`,
        });
        continue;
      }
      // L6: the declared world mode must satisfy the stage's fidelity claim.
      const honesty = checkFidelityHonesty(stage, rule.config.world_mode, `${path}.stages.${stage}.config.world_mode`);
      if (!honesty.ok) errors.push(...honesty.errors);
    }
    // Closure: no foreign stage keys.
    for (const key of Object.keys(stages)) {
      if (!isCurriculumStageKind(key)) {
        errors.push({
          code: 'stage_unknown',
          path: `${path}.stages.${key}`,
          message: `key ${JSON.stringify(key)} is not a ladder stage — the ladder is the closed nine-stage union`,
        });
      }
    }
  }

  if (v.gap_table === undefined) {
    errors.push({ code: 'version_invalid', path: `${path}.gap_table`, message: 'the failure-driven-learning gap table is missing' });
  } else {
    const table = validateGapTable(v.gap_table, `${path}.gap_table`);
    if (!table.ok) errors.push(...table.errors);
  }

  if (errors.length > 0) return { ok: false, errors };

  // The stages record is nine keys exactly (verified above); freeze it whole.
  const stages = v.stages as Record<CurriculumStageKind, StageRule>;
  return {
    ok: true,
    value: deepFreeze({
      version: v.version as CurriculumVersionRef,
      sequence: v.sequence as number,
      stages: deepFreeze({ ...stages }),
      gap_table: (v.gap_table as readonly GapRemediation[]).slice(),
      tenant: v.tenant as TenantId,
      project: v.project as ProjectId,
    }),
  };
}

/**
 * The stage rule of `stage` from a validated version — the pure lookup the
 * planner and the gap-driven replanning share. An absent rule is
 * impossible in a validated version but typed anyway (`stage_unknown`):
 * guards stay total even where construction already guarantees them.
 */
export function stageRuleOf(version: CurriculumVersion, stage: CurriculumStageKind): CurriculumResult<StageRule> {
  const rule = version.stages[stage];
  if (rule === undefined || !isStageRule(rule)) {
    return fail('stage_unknown', `curriculum version "${version.version}" has no rule for stage "${stage}"`, 'stages');
  }
  return { ok: true, value: rule };
}

/** Guard helper re-exported for consumers of stage-keyed untrusted records. */
export function isStageKey(v: unknown): v is CurriculumStageKind {
  return isMemberOf(CURRICULUM_STAGES, v);
}
