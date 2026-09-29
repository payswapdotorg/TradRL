/**
 * @tradrl/skills — the composable skill delta.
 *
 * THE LAW THIS MODULE SERVES: Work Order T017 — "`SkillDelta` — the
 * composable change a skill makes to a body: capability additions/
 * refinements/ removals (each removal = declared breaking change),
 * knowledge/tool policy amendments, procedure amendments — all as
 * structured patches against agent-body BodyVersion mirror shapes."
 *
 * And the breaking-change law: "a delta removing a capability without the
 * declared-breaking-change record is a typed error (negative test)" and
 * "A body forged for capability X that drops capability X vs its parent is
 * a DECLARED breaking change (structured record, not a surprise)."
 *
 * Spec anchors:
 * - spec/ARCHITECTURE-LOCK.md L3 (immutable versioned capability — a
 *   persistent capability change is a NEW BodyVersion; deltas are the
 *   structured patches that drive it), L9/L12 (lineage + tenant scope on
 *   every record), L16a (capability keys are CONTRACTS, never labels).
 * - spec/ARCHITECTURE.md "Agent Body" — VERBATIM: "A Body is persistent
 *   capability composition containing mission, capabilities, knowledge/tool
 *   policy, procedures, planning, delegation, authority/safety boundaries,
 *   evaluation/environment requirements and substrate compatibility. Body
 *   Versions are immutable."
 * - spec/LEARNING-LOOP.md ("skill extraction -> Body Version" — the delta
 *   is the bridge between the two).
 *
 * MIRROR DISCIPLINE (D-003/D-004): the patch vocabulary re-declares
 * @tradrl/agent-body's composition member shapes STRUCTURALLY —
 * `BodyCapability` (capability additions), `BodyProcedure`/
 * `ProcedureStep` (procedure amendments) — field-for-field, never by
 * import. The forge (services/body-forge) applies these patches onto its
 * BodyVersion mirror; the interop trip wires prove the mirror parity.
 * The delta deliberately does NOT patch mission, planning, delegation,
 * authority or compatibility: a SKILL changes capabilities, policy and
 * procedures; charter-level changes are charter work (flagged for the Tech
 * Lead; the forge's delta manifest records exactly what was applied).
 */

import {
  type CapabilityGapId,
  type KnowledgeSourceRef,
  type ProjectId,
  type SkillArtifactRef,
  type SkillDeltaId,
  type SkillRecordId,
  type TenantId,
  type ToolRef,
  deepCloneJson,
  deepFreeze,
  isArrayOf,
  isCapabilityGapId,
  isKnowledgeSourceRef,
  isMemberOf,
  isNonEmptyString,
  isNonNegativeInteger,
  isProjectId,
  isRecord,
  isSkillArtifactRef,
  isSkillDeltaId,
  isSkillRecordId,
  isTenantId,
  isToolRef,
} from './primitives';
import { type SkillError, type SkillResult, invalidField, invalidType, missingField, ok } from './errors';

// ---------------------------------------------------------------------------
// Closed vocabularies (mirrors of agent-body's composition enums)
// ---------------------------------------------------------------------------

/**
 * The closed procedure-trigger vocabulary — STRUCTURAL MIRROR of
 * @tradrl/agent-body's `PROCEDURE_TRIGGERS` (`scheduled | event |
 * on-demand | escalation`). DO NOT DIVERGE.
 */
export const PROCEDURE_TRIGGERS = ['scheduled', 'event', 'on-demand', 'escalation'] as const;

/** What can trigger a body procedure (mirror). */
export type ProcedureTrigger = (typeof PROCEDURE_TRIGGERS)[number];

/** Guard: `ProcedureTrigger`. */
export function isProcedureTrigger(v: unknown): v is ProcedureTrigger {
  return isMemberOf(PROCEDURE_TRIGGERS, v);
}

/** The closed change-kind vocabulary of the skill-delta patch union. */
export const SKILL_CHANGE_KINDS = [
  'add-capability',
  'refine-capability',
  'remove-capability',
  'amend-knowledge-tool-policy',
  'amend-procedures',
] as const;

/** One skill-delta change kind. */
export type SkillChangeKind = (typeof SKILL_CHANGE_KINDS)[number];

/** Guard: `SkillChangeKind`. */
export function isSkillChangeKind(v: unknown): v is SkillChangeKind {
  return isMemberOf(SKILL_CHANGE_KINDS, v);
}

// ---------------------------------------------------------------------------
// Declared breaking change (the structured record, not a surprise)
// ---------------------------------------------------------------------------

/**
 * The DECLARED breaking change a capability removal must carry: why the
 * capability is dropped and which typed capability gaps (if any) the
 * removal addresses. "A body forged for capability X that drops capability
 * X vs its parent is a DECLARED breaking change (structured record, not a
 * surprise)" — an undeclared removal is the typed error
 * `undeclared_breaking_change`.
 */
export interface BreakingChangeDeclaration {
  /** Why the capability is being removed (human-readable, non-empty). */
  readonly rationale: string;
  /** The typed capability gaps this removal addresses (may be empty). */
  readonly addressesGapIds: readonly CapabilityGapId[];
}

/** Guard: `BreakingChangeDeclaration`. */
export function isBreakingChangeDeclaration(v: unknown): v is BreakingChangeDeclaration {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.rationale) && isArrayOf(v.addressesGapIds, isCapabilityGapId);
}

// ---------------------------------------------------------------------------
// The patch union (structured patches against agent-body mirror shapes)
// ---------------------------------------------------------------------------

/**
 * Add one capability to the body — STRUCTURAL MIRROR of agent-body's
 * `BodyCapability`: the addition carries the full capability shape, and
 * its `skillArtifactRefs` are NON-EMPTY (an added capability with no
 * backing skill artifact is an invented capability — the evidence law).
 */
export interface CapabilityAddition {
  readonly change: 'add-capability';
  /** Capability identifier, unique within the resulting composition. */
  readonly capabilityId: string;
  /** Human-readable name (mirror of BodyCapability.name). */
  readonly name: string;
  /** What this capability provides (mirror of BodyCapability.description). */
  readonly description: string;
  /** Coarse category, e.g. `research`, `execution`, `risk` (mirror). */
  readonly category: string;
  /** Whether absence of this capability blocks meaningful operation (mirror). */
  readonly critical: boolean;
  /** Opaque skill-artifact references (T017 lane) backing this capability; NON-EMPTY. */
  readonly skillArtifactRefs: readonly SkillArtifactRef[];
}

/**
 * Refine one EXISTING capability of the parent body: replace its
 * description and append skill artifacts (deduplicated on apply). The
 * refined capability keeps its identity — refinement is not removal.
 */
export interface CapabilityRefinement {
  readonly change: 'refine-capability';
  /** Capability identifier, MUST exist in the parent composition (the forge checks). */
  readonly capabilityId: string;
  /** The refined description (replaces the parent's). */
  readonly description: string;
  /** Skill artifacts appended to the capability's backing evidence (deduplicated on apply). */
  readonly additionalSkillArtifactRefs: readonly SkillArtifactRef[];
}

/**
 * Remove one capability from the body. EVERY removal carries a
 * {@link BreakingChangeDeclaration} — the typed-error law
 * (`undeclared_breaking_change`) is enforced here at the guard, by the
 * validator, and again by the forge's declared-vs-actual drop check.
 */
export interface CapabilityRemoval {
  readonly change: 'remove-capability';
  /** Capability identifier, MUST exist in the parent composition (the forge checks). */
  readonly capabilityId: string;
  /** REQUIRED: the declared breaking change (structured record, not a surprise). */
  readonly declaredBreakingChange: BreakingChangeDeclaration;
}

/**
 * Amend the body's knowledge/tool policy — mirror of agent-body's
 * `KnowledgeToolPolicy` as an ADDITIVE patch: tools/sources are moved into
 * the allowed or forbidden sets; the tool-call budget may be overridden
 * (absent field = leave unchanged; `null` = declare no cap — the mirror's
 * exact optional/null discipline).
 */
export interface KnowledgeToolPolicyAmendment {
  readonly change: 'amend-knowledge-tool-policy';
  /** Tools added to the allowed set. */
  readonly allowTools: readonly ToolRef[];
  /** Tools added to the forbidden set. */
  readonly forbidTools: readonly ToolRef[];
  /** Knowledge sources added to the allowed set. */
  readonly allowKnowledgeSources: readonly KnowledgeSourceRef[];
  /** Knowledge sources added to the forbidden set. */
  readonly forbidKnowledgeSources: readonly KnowledgeSourceRef[];
  /** When present, overrides `toolCallBudgetPerDecision` (a non-negative integer or `null` = no cap). */
  readonly toolCallBudgetPerDecision?: number | null;
}

/** One step of an added procedure — STRUCTURAL MIRROR of agent-body's `ProcedureStep`. */
export interface ProcedureStepPatch {
  /** Step identifier, unique within its procedure (mirror). */
  readonly id: string;
  /** What to do in this step (natural language; mirror). */
  readonly description: string;
  /** Opaque tool refs this step may invoke (mirror). */
  readonly toolRefs: readonly ToolRef[];
  /** Whether executing this step requires out-of-model approval (mirror). */
  readonly approvalRequired: boolean;
}

/** A procedure to add — STRUCTURAL MIRROR of agent-body's `BodyProcedure`. */
export interface ProcedurePatch {
  /** Procedure identifier, unique within the resulting composition (mirror). */
  readonly id: string;
  /** Human-readable name (mirror). */
  readonly name: string;
  /** When this procedure runs (mirror of ProcedureTrigger). */
  readonly trigger: ProcedureTrigger;
  /** Ordered steps; at least one (mirror law). */
  readonly steps: readonly ProcedureStepPatch[];
}

/**
 * Amend the body's procedures: add named playbooks (full
 * agent-body-shaped procedures) and remove procedures by id. Procedure
 * removal is NOT a capability removal — it carries no breaking-change
 * burden (the work order's declared-breaking-change law is scoped to
 * capability removals), but the forge's delta manifest records it.
 */
export interface ProcedureAmendment {
  readonly change: 'amend-procedures';
  /** Procedures added to the composition (ids must not collide with kept procedures — the forge checks). */
  readonly addProcedures: readonly ProcedurePatch[];
  /** Procedure ids removed from the parent composition (the forge checks existence). */
  readonly removeProcedureIds: readonly string[];
}

/**
 * One structured patch a skill applies to a body — the closed union.
 * MEMBER LAWS: every `remove-capability` carries its declared breaking
 * change; every `add-capability` carries non-empty skill artifacts; every
 * `amend-procedures` addition has at least one step.
 */
export type SkillChange =
  | CapabilityAddition
  | CapabilityRefinement
  | CapabilityRemoval
  | KnowledgeToolPolicyAmendment
  | ProcedureAmendment;

/** Guard: `SkillChange` — total over the closed union, member laws included. */
export function isSkillChange(v: unknown): v is SkillChange {
  if (!isRecord(v)) return false;
  switch (v.change) {
    case 'add-capability':
      return (
        isNonEmptyString(v.capabilityId) &&
        isNonEmptyString(v.name) &&
        isNonEmptyString(v.description) &&
        isNonEmptyString(v.category) &&
        typeof v.critical === 'boolean' &&
        Array.isArray(v.skillArtifactRefs) &&
        v.skillArtifactRefs.length > 0 &&
        isArrayOf(v.skillArtifactRefs, isSkillArtifactRef)
      );
    case 'refine-capability':
      return (
        isNonEmptyString(v.capabilityId) &&
        isNonEmptyString(v.description) &&
        isArrayOf(v.additionalSkillArtifactRefs, isSkillArtifactRef)
      );
    case 'remove-capability':
      return isNonEmptyString(v.capabilityId) && isBreakingChangeDeclaration(v.declaredBreakingChange);
    case 'amend-knowledge-tool-policy':
      return (
        isArrayOf(v.allowTools, isToolRef) &&
        isArrayOf(v.forbidTools, isToolRef) &&
        isArrayOf(v.allowKnowledgeSources, isKnowledgeSourceRef) &&
        isArrayOf(v.forbidKnowledgeSources, isKnowledgeSourceRef) &&
        (v.toolCallBudgetPerDecision === undefined ||
          v.toolCallBudgetPerDecision === null ||
          isNonNegativeInteger(v.toolCallBudgetPerDecision))
      );
    case 'amend-procedures':
      return (
        isArrayOf(v.addProcedures, isProcedurePatch) &&
        isArrayOf(v.removeProcedureIds, isNonEmptyString)
      );
    default:
      return false;
  }
}

/** Guard: `ProcedureStepPatch`. */
export function isProcedureStepPatch(v: unknown): v is ProcedureStepPatch {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.description) &&
    isArrayOf(v.toolRefs, isToolRef) &&
    typeof v.approvalRequired === 'boolean'
  );
}

/** Guard: `ProcedurePatch` (at least one step; unique step ids). */
export function isProcedurePatch(v: unknown): v is ProcedurePatch {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.name)) return false;
  if (!isProcedureTrigger(v.trigger)) return false;
  if (!Array.isArray(v.steps) || v.steps.length === 0) return false;
  if (!isArrayOf(v.steps, isProcedureStepPatch)) return false;
  const stepIds = (v.steps as readonly ProcedureStepPatch[]).map((step) => step.id);
  return new Set(stepIds).size === stepIds.length;
}

// ---------------------------------------------------------------------------
// SkillDelta
// ---------------------------------------------------------------------------

/**
 * The composable change one evidence-backed skill makes to a body: a
 * NON-EMPTY set of structured patches, cited to the skill record that
 * produced them (the delta never floats free of its evidence), under the
 * skill's tenant/project scope (L12). The body forge applies deltas to a
 * parent BodyVersion mirror and MINTS a new candidate version (L3).
 */
export interface SkillDelta {
  /** Delta identity. */
  readonly deltaId: SkillDeltaId;
  /** The evidence-backed skill record this delta comes from (the evidence law travels with the delta). */
  readonly skillRecordRef: SkillRecordId;
  /** The structured patches; NON-EMPTY (a delta that changes nothing is not a delta). */
  readonly changes: readonly SkillChange[];
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
}

/** Guard: `SkillDelta` (structural; within-delta coherence is enforced by the validator). */
export function isSkillDelta(v: unknown): v is SkillDelta {
  if (!isRecord(v)) return false;
  if (!isSkillDeltaId(v.deltaId)) return false;
  if (!isSkillRecordId(v.skillRecordRef)) return false;
  if (!Array.isArray(v.changes) || v.changes.length === 0) return false;
  if (!isArrayOf(v.changes, isSkillChange)) return false;
  if (!isTenantId(v.tenantId) || !isProjectId(v.projectId)) return false;
  return deltaCoherenceProblems(v as unknown as SkillDelta).length === 0;
}

/**
 * Within-delta coherence laws (pure):
 * - capability additions have unique ids;
 * - no capability is both added and refined/removed in one delta (the
 *   addition defines it — patching it in the same breath is a
 *   contradiction);
 * - no capability is refined and removed in one delta (choose one);
 * - at most one refinement per capability per delta;
 * - at most one removal per capability per delta;
 * - procedure additions have unique ids and do not collide with the
 *   removal list of the same delta.
 */
export function deltaCoherenceProblems(delta: SkillDelta): readonly string[] {
  const problems: string[] = [];
  const additions = new Set<string>();
  const refinements = new Map<string, number>();
  const removals = new Map<string, number>();
  const addedProcedures = new Set<string>();
  const removedProcedures = new Set<string>();
  delta.changes.forEach((change, index) => {
    switch (change.change) {
      case 'add-capability':
        if (additions.has(change.capabilityId)) {
          problems.push(`changes[${index}]: duplicate add-capability for "${change.capabilityId}"`);
        } else {
          additions.add(change.capabilityId);
        }
        break;
      case 'refine-capability':
        if (additions.has(change.capabilityId)) {
          problems.push(`changes[${index}]: capability "${change.capabilityId}" is added and refined in the same delta`);
        }
        refinements.set(change.capabilityId, (refinements.get(change.capabilityId) ?? 0) + 1);
        break;
      case 'remove-capability':
        if (additions.has(change.capabilityId)) {
          problems.push(`changes[${index}]: capability "${change.capabilityId}" is added and removed in the same delta`);
        }
        removals.set(change.capabilityId, (removals.get(change.capabilityId) ?? 0) + 1);
        break;
      case 'amend-procedures':
        for (const procedure of change.addProcedures) {
          if (addedProcedures.has(procedure.id)) {
            problems.push(`changes[${index}].addProcedures: duplicate procedure id "${procedure.id}"`);
          } else {
            addedProcedures.add(procedure.id);
          }
        }
        for (const procedureId of change.removeProcedureIds) {
          if (addedProcedures.has(procedureId)) {
            problems.push(`changes[${index}]: procedure "${procedureId}" is added and removed in the same delta`);
          }
          removedProcedures.add(procedureId);
        }
        break;
      case 'amend-knowledge-tool-policy':
        break;
    }
  });
  for (const [capabilityId, count] of refinements) {
    if (removals.has(capabilityId)) {
      problems.push(`refine-capability + remove-capability for "${capabilityId}" in one delta — choose one`);
    }
    if (count > 1) {
      problems.push(`multiple refine-capability entries for "${capabilityId}" in one delta`);
    }
  }
  for (const [capabilityId, count] of removals) {
    if (count > 1) {
      problems.push(`multiple remove-capability entries for "${capabilityId}" in one delta`);
    }
  }
  return problems;
}

/**
 * Collect-all validation of an untrusted skill delta: structural shape of
 * every patch (including the declared-breaking-change law on every
 * removal), within-delta coherence, and the L12 scope. On success the
 * value is returned narrowed and deeply frozen.
 */
export function validateSkillDelta(v: unknown, path = 'delta'): SkillResult<SkillDelta> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: SkillError[] = [];
  if (v.deltaId === undefined) {
    errors.push(missingField(`${path}.deltaId`));
  } else if (!isSkillDeltaId(v.deltaId)) {
    errors.push(invalidField(`${path}.deltaId`, 'invalid SkillDeltaId'));
  }
  if (v.skillRecordRef === undefined) {
    errors.push(missingField(`${path}.skillRecordRef`));
  } else if (!isSkillRecordId(v.skillRecordRef)) {
    errors.push(invalidField(`${path}.skillRecordRef`, 'invalid SkillRecordId — a delta cites the skill record it comes from (the evidence law travels with the delta)'));
  }
  if (v.changes === undefined) {
    errors.push(missingField(`${path}.changes`));
  } else if (!Array.isArray(v.changes)) {
    errors.push(invalidField(`${path}.changes`, 'must be an array of structured patches'));
  } else if (v.changes.length === 0) {
    errors.push(invalidField(`${path}.changes`, 'must be NON-EMPTY — a delta that changes nothing is not a delta'));
  } else {
    v.changes.forEach((change: unknown, index: number) => {
      const changePath = `${path}.changes[${index}]`;
      if (!isSkillChange(change)) {
        if (isRecord(change) && change.change === 'remove-capability' && !isBreakingChangeDeclaration(change.declaredBreakingChange)) {
          // The existential law, named precisely.
          errors.push({
            code: 'undeclared_breaking_change',
            path: `${changePath}.declaredBreakingChange`,
            message: 'a capability removal without the declared-breaking-change record is a typed error — a body that drops a capability vs its parent is a DECLARED breaking change (Work Order T017, breaking-change law)',
          });
          return;
        }
        if (isRecord(change) && change.change === 'add-capability' && Array.isArray(change.skillArtifactRefs) && change.skillArtifactRefs.length === 0) {
          errors.push({
            code: 'evidence_missing',
            path: `${changePath}.skillArtifactRefs`,
            message: 'an added capability must cite at least one skill artifact — capabilities are extracted from skills, never invented (evidence law)',
          });
          return;
        }
        errors.push(invalidField(changePath, 'failed the closed SkillChange union (add-capability | refine-capability | remove-capability | amend-knowledge-tool-policy | amend-procedures)'));
        return;
      }
      if (change.change === 'amend-knowledge-tool-policy') {
        const allowedTools = new Set<string>(change.allowTools);
        const forbiddenOverlap = change.forbidTools.filter((tool) => allowedTools.has(tool));
        if (forbiddenOverlap.length > 0) {
          errors.push(
            invalidField(
              `${changePath}.forbidTools`,
              `tools both allowed and forbidden by the same amendment: ${forbiddenOverlap.join(', ')} (agent-body KnowledgeToolPolicy invariant)`,
            ),
          );
        }
        const allowedSources = new Set<string>(change.allowKnowledgeSources);
        const sourceOverlap = change.forbidKnowledgeSources.filter((source) => allowedSources.has(source));
        if (sourceOverlap.length > 0) {
          errors.push(
            invalidField(
              `${changePath}.forbidKnowledgeSources`,
              `knowledge sources both allowed and forbidden by the same amendment: ${sourceOverlap.join(', ')} (agent-body KnowledgeToolPolicy invariant)`,
            ),
          );
        }
      }
    });
    if (errors.length === 0) {
      for (const problem of deltaCoherenceProblems(v as unknown as SkillDelta)) {
        errors.push(invalidField(`${path}.changes`, problem));
      }
    }
  }
  if (v.tenantId === undefined || !isTenantId(v.tenantId)) {
    errors.push({
      code: 'tenant_missing',
      path: `${path}.tenantId`,
      message: 'every skill delta carries its owning tenant (L12)',
    });
  }
  if (v.projectId === undefined || !isProjectId(v.projectId)) {
    errors.push({
      code: 'tenant_missing',
      path: `${path}.projectId`,
      message: 'every skill delta carries its owning project (L12)',
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(deepCloneJson(v) as unknown as SkillDelta) };
}

/**
 * Constructs a deeply frozen `SkillDelta`, running the FULL validation law
 * first (collect-all). Throws `TypeError` (field-prefixed) on invalid
 * input.
 */
export function createSkillDelta(draft: unknown): SkillDelta {
  const result = validateSkillDelta(draft);
  if (!result.ok) {
    const problems = result.errors.map((e) => `(${e.code}) ${e.path}: ${e.message}`);
    throw new TypeError(`createSkillDelta: ${problems.join('; ')}`);
  }
  return result.value;
}
