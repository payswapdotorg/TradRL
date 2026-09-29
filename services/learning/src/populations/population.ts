/**
 * @tradrl/learning (service) — the adversarial population record (T015).
 *
 * THE ARSENAL: stage 5 of the curriculum ladder ("Adversarial population",
 * spec/LEARNING-LOOP.md) and every "adversarial" evaluation law
 * (ARCHITECTURE-LOCK L10 — "friendly replay alone does not release a
 * strategy") need ADVERSARIES TO FIELD. A {@link PopulationRecord} is the
 * arsenal: the adversary descriptors (strategy/policy refs and adversary
 * BLUEPRINT refs — OPAQUE, the organization lane T016 owns the blueprint
 * records; the populations and gaps INTERLOCK with the organization lane
 * via these refs, never via imports), the member/retired split (L11 —
 * retired adversaries are RETAINED records; hiding one is the typed
 * `hidden_adversary` error, enforced by integrity.ts), and the full L9
 * lineage (goal, seed, tenant, project, generation).
 *
 * Laws honored here:
 *   - IMMUTABLE + VERSIONED: a population record is a frozen value; a
 *     generation SUCCEEDS another (evolution.ts) — it never edits one.
 *   - L9: every adversary carries its own lineage block (population,
 *     generation, parent adversary or null for founders, the mutation
 *     operator that produced it or null for founders).
 *   - L11: `retired` is part of the record, not a dustbin — the retired
 *     set only ever GROWS across generations (integrity.ts's succession
 *     law).
 *   - L12: the population's tenant/project scope is fixed at creation;
 *     every adversary shares it (guard-enforced).
 *
 * Determinism: the guards and validators are pure; validated records are
 * deeply frozen; founder/adversary ids are caller-declared opaque refs
 * (the fixtures derive them deterministically).
 */

import {
  type CurriculumError,
  type CurriculumResult,
  deepFreeze,
  isMemberOf,
  isNonEmptyString,
  isRecord,
} from '../curriculum/primitives';
import type {
  AdversaryBlueprintRef,
  GoalRef,
  ProjectId,
  Seed,
  StrategyRef,
  TenantId,
} from './ids';
import type {
  AdversaryId,
  MutationOperatorId,
  PopulationId,
} from './ids';
import {
  isAdversaryBlueprintRef,
  isGoalRef,
  isProjectId,
  isSeed,
  isStrategyRef,
  isTenantId,
} from './ids';
import { isAdversaryId, isMutationOperatorId, isPopulationId } from './ids';

// ---------------------------------------------------------------------------
// The adversary descriptor
// ---------------------------------------------------------------------------

/**
 * The L9 lineage block of one adversary: the population it belongs to,
 * the generation it was born in, its parent adversary (null for
 * founders), and the DECLARED mutation operator that produced it (null
 * for founders). An adversary without provenance is not a record.
 */
export interface AdversaryLineage {
  /** The population this adversary belongs to (fixed at birth). */
  readonly population: PopulationId;
  /** The generation the adversary was born in (0 = founder). */
  readonly generation: number;
  /** The parent adversary (null for founders). */
  readonly parent: AdversaryId | null;
  /** The declared mutation operator that produced it (null for founders). */
  readonly operator: MutationOperatorId | null;
}

/** Guard: `AdversaryLineage`. */
export function isAdversaryLineage(v: unknown): v is AdversaryLineage {
  if (!isRecord(v)) return false;
  if (!isPopulationId(v.population)) return false;
  if (typeof v.generation !== 'number' || !Number.isSafeInteger(v.generation) || v.generation < 0) return false;
  if (v.parent !== null && !isAdversaryId(v.parent)) return false;
  if (v.operator !== null && !isMutationOperatorId(v.operator)) return false;
  return true;
}

/**
 * One adversary: the opaque strategy/policy ref (WHAT it plays), the
 * opaque adversary-blueprint ref (the organization-lane record of its
 * role/structure — T016 interlock), its L9 lineage block, and the
 * tenant/project scope it shares with its population (L12).
 */
export interface AdversaryDescriptor {
  /** Adversary identity (unique across the population's whole history). */
  readonly adversary: AdversaryId;
  /** Opaque versioned strategy/policy ref (what the adversary executes). */
  readonly strategy: StrategyRef;
  /** Opaque adversary-blueprint ref (the organization lane, T016 — mirrors, never imports). */
  readonly blueprint: AdversaryBlueprintRef;
  readonly lineage: AdversaryLineage;
  /** Owning tenant (L12 — must equal the population's). */
  readonly tenantId: TenantId;
  /** Owning project (L12 — must equal the population's). */
  readonly projectId: ProjectId;
}

/** Guard: `AdversaryDescriptor`. */
export function isAdversaryDescriptor(v: unknown): v is AdversaryDescriptor {
  if (!isRecord(v)) return false;
  if (!isAdversaryId(v.adversary)) return false;
  if (!isStrategyRef(v.strategy)) return false;
  if (!isAdversaryBlueprintRef(v.blueprint)) return false;
  if (!isAdversaryLineage(v.lineage)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isProjectId(v.projectId)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The population record
// ---------------------------------------------------------------------------

/** The L9/L12 lineage block of a population: goal, seed, scope. */
export interface PopulationLineage {
  /** The goal the population serves (L15 — adversarial stress is goal-directed). */
  readonly goal: GoalRef;
  /** The population's master seed (every evolution derives from it). */
  readonly seed: Seed;
  /** Owning tenant (L12). */
  readonly tenant: TenantId;
  /** Owning project (L12/L15). */
  readonly project: ProjectId;
}

/** Guard: `PopulationLineage`. */
export function isPopulationLineage(v: unknown): v is PopulationLineage {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.goal)) return false;
  if (!isSeed(v.seed)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  return true;
}

/**
 * One generation of an adversarial population: the population identity,
 * the generation number (0 = the founder generation), the FIELDABLE
 * members, and the RETIRED adversaries (L11 — retained records; the
 * retired set only grows; hiding one is a typed error). Immutable,
 * versioned by generation: evolution SUCCEEDS records, it never edits
 * them.
 */
export interface PopulationRecord {
  /** The population identity (stable across generations). */
  readonly population: PopulationId;
  /** The generation number (0 = founders; successors increment). */
  readonly generation: number;
  /** The fieldable adversaries (non-empty — a population of nothing fields nothing). */
  readonly members: readonly AdversaryDescriptor[];
  /** The retired adversaries — RETAINED records, append-only across generations (L11). */
  readonly retired: readonly AdversaryDescriptor[];
  readonly lineage: PopulationLineage;
}

/** Guard: `PopulationRecord` (structural; scope coherence and uniqueness in the validator). */
export function isPopulationRecord(v: unknown): v is PopulationRecord {
  if (!isRecord(v)) return false;
  if (!isPopulationId(v.population)) return false;
  if (typeof v.generation !== 'number' || !Number.isSafeInteger(v.generation) || v.generation < 0) return false;
  if (!Array.isArray(v.members) || v.members.length === 0) return false;
  if (!(v.members as readonly unknown[]).every((member) => isAdversaryDescriptor(member))) return false;
  if (!Array.isArray(v.retired)) return false;
  if (!(v.retired as readonly unknown[]).every((member) => isAdversaryDescriptor(member))) return false;
  if (!isPopulationLineage(v.lineage)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Validation (collect-all; the scope and uniqueness laws)
// ---------------------------------------------------------------------------

/**
 * Deep validation of an untrusted population record: every adversary
 * guard-valid, adversary ids UNIQUE across members AND retired together
 * (one identity, one adversary, forever), every adversary's lineage names
 * THIS population, every adversary's birth generation is at most the
 * record's generation, and every adversary shares the population's
 * tenant/project scope (L12). On success the value is returned narrowed,
 * deeply frozen.
 */
export function validatePopulationRecord(v: unknown, path = 'population'): CurriculumResult<PopulationRecord> {
  if (!isRecord(v)) {
    return { ok: false, errors: [{ code: 'invalid_type', path, message: `${path} must be an object` }] };
  }
  const errors: CurriculumError[] = [];

  if (v.population === undefined) {
    errors.push({ code: 'missing_field', path: `${path}.population`, message: 'the population id is missing' });
  } else if (!isPopulationId(v.population)) {
    errors.push({ code: 'invalid_id', path: `${path}.population`, message: 'must be a non-empty population id' });
  }

  if (v.generation === undefined) {
    errors.push({ code: 'missing_field', path: `${path}.generation`, message: 'the generation number is missing' });
  } else if (typeof v.generation !== 'number' || !Number.isSafeInteger(v.generation) || v.generation < 0) {
    errors.push({ code: 'invalid_field', path: `${path}.generation`, message: 'must be a non-negative safe integer' });
  }

  if (v.lineage === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.lineage`, message: 'the population lineage block is missing (goal, seed, tenant, project — L9/L12)' });
  } else if (!isPopulationLineage(v.lineage)) {
    errors.push({ code: 'lineage_gap', path: `${path}.lineage`, message: 'must be { goal, seed, tenant, project }' });
  }

  if (v.members === undefined) {
    errors.push({ code: 'missing_field', path: `${path}.members`, message: 'the member list is missing' });
  } else if (!Array.isArray(v.members) || v.members.length === 0) {
    errors.push({ code: 'invalid_field', path: `${path}.members`, message: 'must be a non-empty array — a population of nothing fields nothing (L10)' });
  } else if (!(v.members as readonly unknown[]).every((member) => isAdversaryDescriptor(member))) {
    errors.push({ code: 'invalid_field', path: `${path}.members`, message: 'every member must be a valid adversary descriptor' });
  }

  if (v.retired === undefined) {
    errors.push({ code: 'missing_field', path: `${path}.retired`, message: 'the retired list is missing (L11 — retired adversaries are retained records; use [] when none)' });
  } else if (!Array.isArray(v.retired)) {
    errors.push({ code: 'invalid_field', path: `${path}.retired`, message: 'must be an array of adversary descriptors (may be empty)' });
  } else if (!(v.retired as readonly unknown[]).every((member) => isAdversaryDescriptor(member))) {
    errors.push({ code: 'invalid_field', path: `${path}.retired`, message: 'every retired entry must be a valid adversary descriptor' });
  }

  if (errors.length > 0) return { ok: false, errors };

  // Cross-record laws (all inputs guard-valid past this point).
  const members = v.members as readonly AdversaryDescriptor[];
  const retired = (v.retired ?? []) as readonly AdversaryDescriptor[];
  const generation = v.generation as number;
  const lineage = v.lineage as PopulationLineage;

  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.adversary)) {
      errors.push({ code: 'invalid_field', path: `${path}.members`, message: `duplicate adversary id "${member.adversary}" — one identity, one adversary, forever` });
    }
    seen.add(member.adversary);
  }
  for (const member of retired) {
    if (seen.has(member.adversary)) {
      errors.push({ code: 'invalid_field', path: `${path}.retired`, message: `adversary "${member.adversary}" appears twice (or in both lists) — retired records are retained, not duplicated` });
    }
    seen.add(member.adversary);
  }
  for (const member of [...members, ...retired]) {
    if (member.lineage.population !== v.population) {
      errors.push({
        code: 'lineage_mismatch',
        path: `${path}.members`,
        message: `adversary "${member.adversary}" names population "${member.lineage.population}" but lives in "${String(v.population)}"`,
      });
    }
    if (member.lineage.generation > generation) {
      errors.push({
        code: 'lineage_mismatch',
        path: `${path}.members`,
        message: `adversary "${member.adversary}" was born in generation ${member.lineage.generation} which is after this record's generation ${generation}`,
      });
    }
    if (member.tenantId !== lineage.tenant || member.projectId !== lineage.project) {
      errors.push({
        code: 'tenant_scope_mismatch',
        path: `${path}.members`,
        message: `adversary "${member.adversary}" carries scope "${member.tenantId}"/"${member.projectId}" but the population's is "${lineage.tenant}"/"${lineage.project}" (L12)`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: deepFreeze({
      population: v.population as PopulationId,
      generation,
      members: members.slice(),
      retired: retired.slice(),
      lineage,
    }),
  };
}

// ---------------------------------------------------------------------------
// Projections (pure)
// ---------------------------------------------------------------------------

/** The adversary ids of a record's FIELDABLE members (in record order). */
export function fieldableAdversaries(population: PopulationRecord): readonly AdversaryId[] {
  return population.members.map((member) => member.adversary);
}

/** The adversary ids of a record's RETAINED retired records (in record order — L11). */
export function retiredAdversaries(population: PopulationRecord): readonly AdversaryId[] {
  return population.retired.map((member) => member.adversary);
}

/**
 * `true` when `adversary` is FIELDABLE from `population` (a member — not
 * retired, not unknown). The matchup's fieldability law cites this;
 * retired adversaries are historical records, never fieldable opponents.
 */
export function isFieldable(population: PopulationRecord, adversary: AdversaryId): boolean {
  return population.members.some((member) => member.adversary === adversary);
}

/** Guard helper re-exported for consumers building population literals. */
export function isMutationOperatorRef(v: unknown): v is MutationOperatorId {
  return isMutationOperatorId(v);
}

/** Closed generation-kind vocabulary witness (founders vs evolved). */
export const POPULATION_GENERATION_KINDS = deepFreeze(['founders', 'evolved'] as const);

/** One generation kind. */
export type PopulationGenerationKind = (typeof POPULATION_GENERATION_KINDS)[number];

/** Guard: `PopulationGenerationKind`. */
export function isPopulationGenerationKind(v: unknown): v is PopulationGenerationKind {
  return isMemberOf(POPULATION_GENERATION_KINDS, v);
}

/** The generation-kind projection: founders at generation 0, evolved after. */
export function generationKind(population: PopulationRecord): PopulationGenerationKind {
  return population.generation === 0 ? 'founders' : 'evolved';
}
