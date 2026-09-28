/**
 * @tradrl/evaluation — the evaluation suite and its composition rules.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md (the evaluation LAYERS: blind
 * generalization, execution stress, adversarial stress, organization
 * ablation, model substitution), spec/ARCHITECTURE.md "Evaluation" ("Use
 * blind/unseen, walk-forward, regime, cost, latency, adversarial,
 * organization-ablation and model-substitution tests as appropriate.
 * Preserve search history."), ARCHITECTURE-LOCK L10 ("Adversarial
 * evaluation: friendly replay alone does not release a strategy"), L9
 * (reproducible lineage — the suite binds the evaluator version), L11.
 *
 * The suite is the protocol half of an evaluation run:
 * - {@link SuiteMember}s pair a member KIND (the layer under test) with the
 *   opaque SPLIT POLICY ref it evaluates under and the metrics it reports.
 *   Blind/walk-forward/regime members carry the generalization layers; cost
 *   and latency members carry execution stress (spec/EVALUATION-PROTOCOL.md
 *   "Stress: Perturb fees, slippage, latency, fill probability, impact,
 *   spread and liquidity" — the perturbation parameters live with the
 *   evaluator service, referenced through the evaluator version);
 *   organization-ablation and model-substitution members carry layers 6/7.
 * - ADVERSARIAL suites are first-class protocol members referenced BY
 *   OPAQUE ID (`adversarialSuiteRefs`): the suite composition rule makes
 *   them MANDATORY for a release-grade suite — {@link createEvaluationSuite}
 *   refuses a `release` grade without at least one adversarial suite
 *   reference (`missing_adversarial_member`, L10), and the verification
 *   lane's ReleaseGate independently re-checks the law (defense in depth).
 * - `grade` separates SCREENING suites (cheap in-search gates) from RELEASE
 *   suites (the acceptance machinery). The grade is declared, not inferred.
 * - Every suite carries its `evaluatorVersion` (L9 lineage): the compiled
 *   evaluator that scores trials under this suite is part of the suite's
 *   identity, so the same suite under two evaluator versions is two
 *   protocols, never silently the same one.
 */

import { deepFreeze, isNonEmptyString, isPositiveInteger, isRecord } from './primitives';
import {
  isEvaluatorVersionRef,
  isMetricId,
  isSuiteId,
  type EvaluatorVersionRef,
  type MetricId,
  type SplitPolicyRef,
  type SuiteId,
} from './ids';
import { isSplitPolicyRef } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type EvalError, type EvalResult } from './errors';

// ---------------------------------------------------------------------------
// Member kinds (the evaluation layers this lane composes)
// ---------------------------------------------------------------------------

/**
 * The closed suite-member vocabulary — the evaluation layers of
 * spec/EVALUATION-PROTOCOL.md this lane composes into suites:
 * - `blind` — blind/unseen generalization (layer 3);
 * - `walk-forward` — walk-forward generalization (layer 2/selection integrity);
 * - `regime` — regime coverage (layer 3);
 * - `cost` / `latency` — execution stress under perturbed fees/slippage and
 *   latency (layer 4);
 * - `adversarial` — adversarial stress (layer 5, L10);
 * - `organization-ablation` — organization ablation (layer 6);
 * - `model-substitution` — model substitution (layer 7).
 */
export type SuiteMemberKind =
  | 'blind'
  | 'walk-forward'
  | 'regime'
  | 'cost'
  | 'latency'
  | 'adversarial'
  | 'organization-ablation'
  | 'model-substitution';

/** Runtime-checkable list of suite-member kinds. */
export const SUITE_MEMBER_KINDS: readonly SuiteMemberKind[] = [
  'blind',
  'walk-forward',
  'regime',
  'cost',
  'latency',
  'adversarial',
  'organization-ablation',
  'model-substitution',
] as const;

/** Guard: a suite-member kind. */
export function isSuiteMemberKind(v: unknown): v is SuiteMemberKind {
  return typeof v === 'string' && (SUITE_MEMBER_KINDS as readonly string[]).includes(v);
}

/** The grade of a suite: cheap in-search screening vs the release machinery. */
export type SuiteGrade = 'screening' | 'release';

/** Runtime-checkable list of suite grades. */
export const SUITE_GRADES: readonly SuiteGrade[] = ['screening', 'release'] as const;

/** Guard: a suite grade. */
export function isSuiteGrade(v: unknown): v is SuiteGrade {
  return typeof v === 'string' && (SUITE_GRADES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Suite members and the suite
// ---------------------------------------------------------------------------

/**
 * One suite member: a member kind paired with the opaque split policy it
 * evaluates under and the non-empty metric set it reports. Members are
 * unique by (kind, splitPolicy) — the same layer under the same split twice
 * is a duplicate (`duplicate_member`).
 */
export interface SuiteMember {
  readonly kind: SuiteMemberKind;
  /** The split policy this member evaluates under (opaque ref, owned by this lane). */
  readonly splitPolicy: SplitPolicyRef;
  /** Metrics this member reports (non-empty; ids unique within the member). */
  readonly metricIds: readonly MetricId[];
}

/** Guard: `SuiteMember`. */
export function isSuiteMember(v: unknown): v is SuiteMember {
  if (!isRecord(v)) return false;
  if (!isSuiteMemberKind(v.kind)) return false;
  if (!isSplitPolicyRef(v.splitPolicy)) return false;
  if (!Array.isArray(v.metricIds) || v.metricIds.length === 0) return false;
  if (!v.metricIds.every((id) => isMetricId(id))) return false;
  return new Set(v.metricIds).size === v.metricIds.length;
}

/**
 * The evaluation suite: the composed protocol. Composition laws (all
 * machine-checked by {@link createEvaluationSuite}):
 * - non-empty member list with unique (kind, splitPolicy) pairs;
 * - `adversarialSuiteRefs` are opaque ids of adversarial suites — REQUIRED
 *   non-empty when `grade` is `release` (L10: friendly replay alone does
 *   not release a strategy);
 * - the suite binds its evaluator version (L9 lineage).
 */
export interface EvaluationSuite {
  readonly suiteId: SuiteId;
  readonly grade: SuiteGrade;
  /** The compiled evaluator that scores trials under this suite (L9). */
  readonly evaluatorVersion: EvaluatorVersionRef;
  readonly members: readonly SuiteMember[];
  /** Opaque ids of adversarial suites (L10 first-class; mandatory for release grade). */
  readonly adversarialSuiteRefs: readonly SuiteId[];
}

/** Guard: `EvaluationSuite` (composition laws included). */
export function isEvaluationSuite(v: unknown): v is EvaluationSuite {
  if (!isRecord(v)) return false;
  if (!isSuiteId(v.suiteId)) return false;
  if (!isSuiteGrade(v.grade)) return false;
  if (!isEvaluatorVersionRef(v.evaluatorVersion)) return false;
  if (!Array.isArray(v.members) || v.members.length === 0) return false;
  if (!v.members.every((member) => isSuiteMember(member))) return false;
  const seen = new Set<string>();
  for (const member of v.members) {
    if (!isSuiteMember(member)) return false;
    const key = `${member.kind}\u0000${member.splitPolicy}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  if (!Array.isArray(v.adversarialSuiteRefs)) return false;
  if (!v.adversarialSuiteRefs.every((ref) => isSuiteId(ref))) return false;
  if (new Set(v.adversarialSuiteRefs).size !== v.adversarialSuiteRefs.length) return false;
  if (v.grade === 'release' && v.adversarialSuiteRefs.length === 0) return false; // L10
  return true;
}

/**
 * Collect-all validation and construction of an evaluation suite. Enforces
 * every composition law of {@link EvaluationSuite}; on success returns the
 * deeply frozen suite. The L10 law is enforced HERE for the composition
 * (release grade without an adversarial suite reference fails with
 * `missing_adversarial_member`) and AGAIN by the verification lane's
 * ReleaseGate (defense in depth).
 */
export function createEvaluationSuite(value: unknown): EvalResult<EvaluationSuite> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('createEvaluationSuite expects an object')] };
  }
  const errors: EvalError[] = [];

  if (value.suiteId === undefined) {
    errors.push(missingField('suiteId'));
  } else if (!isSuiteId(value.suiteId)) {
    errors.push(invalidField('suiteId', 'must be a non-empty suite id'));
  }

  if (value.grade === undefined) {
    errors.push(missingField('grade'));
  } else if (!isSuiteGrade(value.grade)) {
    errors.push(invalidField('grade', `must be one of ${SUITE_GRADES.join(' | ')}`));
  }

  if (value.evaluatorVersion === undefined) {
    errors.push(missingField('evaluatorVersion'));
  } else if (!isEvaluatorVersionRef(value.evaluatorVersion)) {
    errors.push(invalidField('evaluatorVersion', 'must be a non-empty versioned evaluator ref (L9)'));
  }

  const members: SuiteMember[] = [];
  if (value.members === undefined) {
    errors.push(missingField('members'));
  } else if (!Array.isArray(value.members)) {
    errors.push(invalidField('members', 'must be an array of suite members'));
  } else if (value.members.length === 0) {
    errors.push(invalidField('members', 'must be non-empty — a suite composes at least one member'));
  } else {
    const seen = new Set<string>();
    value.members.forEach((candidate, index) => {
      const memberPath = `members[${index}]`;
      if (!isSuiteMember(candidate)) {
        if (!isRecord(candidate)) {
          errors.push(invalidType(`${memberPath} must be an object`));
          return;
        }
        if (candidate.kind === undefined) errors.push(missingField(`${memberPath}.kind`));
        else if (!isSuiteMemberKind(candidate.kind)) errors.push(invalidField(`${memberPath}.kind`, `must be one of ${SUITE_MEMBER_KINDS.join(' | ')}`));
        if (candidate.splitPolicy === undefined) errors.push(missingField(`${memberPath}.splitPolicy`));
        else if (!isSplitPolicyRef(candidate.splitPolicy)) errors.push(invalidField(`${memberPath}.splitPolicy`, 'must be a non-empty split policy ref'));
        if (candidate.metricIds === undefined) errors.push(missingField(`${memberPath}.metricIds`));
        else if (!Array.isArray(candidate.metricIds) || candidate.metricIds.length === 0) {
          errors.push(invalidField(`${memberPath}.metricIds`, 'must be a non-empty array of metric ids'));
        } else if (!candidate.metricIds.every((id) => isMetricId(id))) {
          errors.push(invalidField(`${memberPath}.metricIds`, 'every entry must be a non-empty metric id'));
        } else if (new Set(candidate.metricIds).size !== candidate.metricIds.length) {
          errors.push(invalidField(`${memberPath}.metricIds`, 'metric ids are unique within a member'));
        }
        return;
      }
      const key = `${candidate.kind}\u0000${candidate.splitPolicy}`;
      if (seen.has(key)) {
        errors.push(
          invalidField(
            `${memberPath}.splitPolicy`,
            `duplicate member: kind "${candidate.kind}" under split policy "${candidate.splitPolicy}" is already composed`,
          ),
        );
        return;
      }
      seen.add(key);
      members.push(candidate);
    });
  }

  const adversarialRefs: SuiteId[] = [];
  if (value.adversarialSuiteRefs === undefined) {
    errors.push(missingField('adversarialSuiteRefs'));
  } else if (!Array.isArray(value.adversarialSuiteRefs)) {
    errors.push(invalidField('adversarialSuiteRefs', 'must be an array of adversarial suite refs'));
  } else {
    const seen = new Set<string>();
    value.adversarialSuiteRefs.forEach((ref, index) => {
      if (!isSuiteId(ref)) {
        errors.push(invalidField(`adversarialSuiteRefs[${index}]`, 'must be a non-empty adversarial suite ref'));
        return;
      }
      if (seen.has(ref)) {
        errors.push(invalidField(`adversarialSuiteRefs[${index}]`, `duplicate adversarial suite ref "${ref}"`));
        return;
      }
      seen.add(ref);
      adversarialRefs.push(ref);
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  if (value.grade === 'release' && adversarialRefs.length === 0) {
    return fail(
      'missing_adversarial_member',
      'a release-grade suite must reference at least one adversarial suite (L10: friendly replay alone does not release a strategy)',
    );
  }

  return ok(
    deepFreeze({
      suiteId: value.suiteId as SuiteId,
      grade: value.grade as SuiteGrade,
      evaluatorVersion: value.evaluatorVersion as EvaluatorVersionRef,
      members,
      adversarialSuiteRefs: adversarialRefs,
    } satisfies EvaluationSuite),
  );
}

/** `true` iff the suite satisfies the L10 release-grade law (adversarial coverage present). */
export function isReleaseGradeSuite(suite: EvaluationSuite): boolean {
  return suite.grade === 'release' && suite.adversarialSuiteRefs.length > 0;
}

/** All split-policy refs composed into the suite's members (member order). */
export function suiteSplitPolicyRefs(suite: EvaluationSuite): readonly SplitPolicyRef[] {
  return suite.members.map((member) => member.splitPolicy);
}

/** Guard re-export for doc tests (evidence-volume thresholds are positive integers). */
export { isPositiveInteger };
