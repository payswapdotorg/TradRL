/**
 * @tradrl/learning (service) — selection integrity for populations (T015).
 *
 * THE LAW THIS MODULE ENFORCES: ARCHITECTURE-LOCK L11 — "Search
 * integrity: optimization history is retained to expose selection
 * effects" — applied to the adversarial-population search. Population
 * evolution is a SEARCH (retain/mutate/retire over adversary records);
 * selection effects (the mutants that looked good, the adversaries that
 * got dropped) are only auditable if the history is RETAINED.
 *
 * The concrete laws, all typed:
 *   - RETENTION: a successor population must RETAIN every record its
 *     parent ever retained — `child.retired` is a SUPERSET of
 *     `parent.retired` (plus the newly retired). Dropping a retired
 *     adversary from the history is the typed `hidden_adversary` error
 *     (the work order's named negative test: "retired adversaries are
 *     retained records; hiding one is a typed error").
 *   - NO VANISHING: every parent MEMBER is either fieldable in the child
 *     (retained by selection) or in the child's retired list. A member
 *     that appears in NEITHER was hidden — `hidden_adversary`.
 *   - NO RESURRECTION: a retired adversary never returns to the field —
 *     a child member that is retired in its own history (in the child's
 *     retired list) is `hidden_adversary`'s sibling: an incoherent
 *     record (a member of both lists is already refused by the record
 *     guard; the succession check re-asserts it across generations).
 *   - SUCCESSION: the child's generation is exactly the parent's + 1,
 *     the population id and scope are inherited, mutant lineage names
 *     the declared operator and a fieldable parent.
 *
 * The digest ({@link populationHistoryDigest}) binds a whole history —
 * members + retired + lineage — into one FNV-1a digest over canonical
 * JSON: equal histories digest equally, so a successor's retention claim
 * is checkable from bytes (L9's spirit).
 */

import {
  type CurriculumResult,
  canonicalJson,
  deepFreeze,
  fail,
  fnv1a32Hex,
  isRecord,
} from '../curriculum/primitives';
import type { AdversaryId } from './ids';
import {
  type PopulationRecord,
  retiredAdversaries,
  validatePopulationRecord,
} from './population';

// ---------------------------------------------------------------------------
// The succession law
// ---------------------------------------------------------------------------

/**
 * Validate the succession `parent -> child` against the L11 population
 * laws (the typed retention checks — see module header). Both records
 * are deep-validated first (an invalid record cannot succeed anything);
 * then:
 *   - generation: child.generation === parent.generation + 1;
 *   - identity + scope: same population id, same lineage block;
 *   - retention: every parent-retired adversary is still retired in the
 *     child (`hidden_adversary` otherwise);
 *   - no vanishing: every parent member is a child member or a child
 *     retired record (`hidden_adversary` otherwise);
 *   - no resurrection: no child member is in the child's own retired
 *     list (the record guard refuses it within one record; the succession
 *     check restates it as law across generations);
 *   - mutant lineage: every child member born in the child's generation
 *     names a parent MEMBER as its parent (a mutant of a retired
 *     adversary is incoherent — retired adversaries do not breed) and
 *     carries an operator (`lineage_mismatch` otherwise).
 */
export function validatePopulationSuccession(parent: unknown, child: unknown): CurriculumResult<true> {
  const parentResult = isRecord(parent) ? validatePopulationRecord(parent, 'parent') : null;
  if (parentResult === null || !parentResult.ok) {
    const errors = parentResult === null
      ? [{ code: 'invalid_field' as const, path: 'parent', message: 'validatePopulationSuccession requires a structurally valid parent population record' }]
      : parentResult.errors;
    return { ok: false, errors };
  }
  const childResult = isRecord(child) ? validatePopulationRecord(child, 'child') : null;
  if (childResult === null || !childResult.ok) {
    const errors = childResult === null
      ? [{ code: 'invalid_field' as const, path: 'child', message: 'validatePopulationSuccession requires a structurally valid child population record' }]
      : childResult.errors;
    return { ok: false, errors };
  }
  const from = parentResult.value;
  const to = childResult.value;

  if (to.generation !== from.generation + 1) {
    return fail(
      'lineage_mismatch',
      `the child's generation is ${to.generation} but succession from generation ${from.generation} requires ${from.generation + 1} — generations increment by exactly one`,
      'child.generation',
    );
  }
  if (to.population !== from.population) {
    return fail(
      'lineage_mismatch',
      `the child names population "${to.population}" but succeeds "${from.population}" — a successor belongs to the same population`,
      'child.population',
    );
  }
  if (
    to.lineage.goal !== from.lineage.goal ||
    to.lineage.seed !== from.lineage.seed ||
    to.lineage.tenant !== from.lineage.tenant ||
    to.lineage.project !== from.lineage.project
  ) {
    return fail(
      'lineage_mismatch',
      "the child's lineage block (goal, seed, tenant, project) differs from the parent's — the lineage is inherited, not redeclared (L9/L12)",
      'child.lineage',
    );
  }

  // RETENTION: every parent-retired adversary stays retired.
  const childRetired = new Set<string>(retiredAdversaries(to));
  for (const retired of retiredAdversaries(from)) {
    if (!childRetired.has(retired)) {
      return fail(
        'hidden_adversary',
        `retired adversary "${retired}" is missing from generation ${to.generation}'s retained history — retired adversaries are retained records; hiding one is a typed error (L11)`,
        'child.retired',
      );
    }
  }

  // NO VANISHING: every parent member is a child member or retired.
  const childMembers = new Set<string>(to.members.map((member) => member.adversary));
  for (const member of from.members) {
    if (!childMembers.has(member.adversary) && !childRetired.has(member.adversary)) {
      return fail(
        'hidden_adversary',
        `adversary "${member.adversary}" of generation ${from.generation} neither fields nor retires in generation ${to.generation} — it vanished; every adversary is either fieldable or a retained retired record (L11)`,
        'child.members',
      );
    }
  }

  // NO RESURRECTION (cross-generation): an adversary retired by the parent
  // never returns to the field — a child member that the PARENT had
  // retired is a resurrection, whatever the child's own lists say (and a
  // member both fielded and retired within the child is already refused
  // by the record guard; the succession law restates it across
  // generations).
  const parentRetired = new Set<string>(retiredAdversaries(from));
  for (const member of to.members) {
    if (parentRetired.has(member.adversary)) {
      return fail(
        'hidden_adversary',
        `adversary "${member.adversary}" was retired by generation ${from.generation} but fields again in generation ${to.generation} — a retired adversary never returns to the field (L11)`,
        'child.members',
      );
    }
  }

  // MUTANT LINEAGE: mutants are born of fieldable parents under the operator.
  for (const member of to.members) {
    if (member.lineage.generation === to.generation) {
      if (member.lineage.operator === null) {
        return fail(
          'lineage_mismatch',
          `mutant "${member.adversary}" carries no mutation operator — mutants are born under a declared, versioned operator`,
          'child.members',
        );
      }
      if (member.lineage.parent === null) {
        return fail(
          'lineage_mismatch',
          `mutant "${member.adversary}" carries no parent — mutants are born of a parent adversary`,
          'child.members',
        );
      }
      const parentIsFieldable = from.members.some((candidate) => candidate.adversary === member.lineage.parent);
      if (!parentIsFieldable) {
        return fail(
          'lineage_mismatch',
          `mutant "${member.adversary}" names parent "${member.lineage.parent}" which was not fieldable in generation ${from.generation} — retired adversaries do not breed`,
          'child.members',
        );
      }
    }
  }

  return { ok: true, value: true };
}

// ---------------------------------------------------------------------------
// The history digest (L9 — byte-bound history)
// ---------------------------------------------------------------------------

/**
 * The canonical population-history digest: FNV-1a over the canonical JSON
 * of the WHOLE record — members and retired in record order, plus the
 * lineage block. Equal records digest equally; a successor's retention
 * claim is checkable from bytes. (The members and retired lists are in
 * the record's own order — the digest binds the record as it stands, and
 * the succession law, not the digest, owns the cross-generation checks.)
 */
export function populationHistoryDigest(record: PopulationRecord): string {
  const canonical = canonicalJson({
    population: record.population,
    generation: record.generation,
    lineage: {
      goal: record.lineage.goal,
      seed: record.lineage.seed,
      tenant: record.lineage.tenant,
      project: record.lineage.project,
    },
    members: record.members.map((member) => ({
      adversary: member.adversary,
      strategy: member.strategy,
      blueprint: member.blueprint,
      lineage: {
        population: member.lineage.population,
        generation: member.lineage.generation,
        parent: member.lineage.parent,
        operator: member.lineage.operator,
      },
      tenantId: member.tenantId,
      projectId: member.projectId,
    })),
    retired: record.retired.map((member) => member.adversary),
  });
  return fnv1a32Hex(canonical);
}

// ---------------------------------------------------------------------------
// The history projection (the whole retained truth)
// ---------------------------------------------------------------------------

/**
 * The FULL adversary history of a record: every adversary the population
 * ever fielded (members + retired, in record order) — the projection
 * evaluation-side consumers read so selection effects stay exposed (L11).
 */
export function fullHistory(record: PopulationRecord): readonly AdversaryId[] {
  return deepFreeze([...record.members.map((member) => member.adversary), ...retiredAdversaries(record)]);
}
