/**
 * @tradrl/learning (service) — the population evolution engine (T015).
 *
 * THE PURE SEEDED ENGINE: `(population, selection function record, seed)`
 * -> next generation, as a PURE function — no ambient randomness, no
 * ambient clock, and NO HIDDEN FITNESS: the selection function is a
 * DECLARED, VERSIONED RECORD ({@link SelectionFunction}) whose fitness
 * derivation is a NAMED, VERSIONED derivation (`seeded-digest-v1` — the
 * deterministic reference derivation that stands in for measured
 * adversarial performance; real fitness arrives as evaluation citations,
 * and swapping derivations is a version change, never a closure), whose
 * retain/mutate counts are declared numbers, and whose mutation operator
 * is itself a DECLARED, VERSIONED RECORD ({@link MutationOperator} — the
 * operator kind names the deterministic derivation of a mutant's strategy
 * and blueprint refs).
 *
 * THE ALGORITHM (declared, versioned, deterministic):
 *   1. SCORE every member: fitness = FNV-1a over (adversary id, seed) —
 *      the `seeded-digest-v1` derivation (a pure digest; equal inputs
 *      equal scores, forever).
 *   2. RANK members by (fitness descending, adversary id ascending — the
 *      declared tie-break; ranking is never arrival order).
 *   3. RETAIN the top `retain_count` members (unchanged — they stay
 *      fieldable).
 *   4. MUTATE: `mutate_count` mutants derived from the retained set
 *      (cycling retained order): each mutant's adversary id, strategy ref
 *      and (for recombination) blueprint ref are FNV-1a derivations over
 *      (parent refs, operator id, generation, index, seed) — the
 *      operator-kind-specific derivations below.
 *   5. RETIRE every non-retained member: they move to the successor's
 *      `retired` list — RETAINED RECORDS, never dropped (L11; integrity.ts
 *      enforces the succession law).
 *   6. The successor record: same population id, generation + 1, members
 *      = retained + mutants, retired = parent retired + newly retired
 *      (canonical order), lineage inherited.
 *
 * DETERMINISM LAW: same (population, selection function, seed) ->
 * byte-identical next generation, twice, forever (tested).
 *
 * Spec anchors: spec/LEARNING-LOOP.md ("Method selection": population
 * search, adversarial training, self-play; "Organization learning": the
 * search axes — the adversarial population axis feeds T016's compiler);
 * spec/ARCHITECTURE.md Learning plane ("population search");
 * ARCHITECTURE-LOCK L10 (adversarial evaluation), L11 (search integrity).
 */

import {
  type CurriculumError,
  type CurriculumResult,
  deepFreeze,
  fail,
  fnv1a32Hex,
  isMemberOf,
  isRecord,
} from '../curriculum/primitives';
import type {
  AdversaryId,
  MutationOperatorId,
  PopulationId,
  SelectionFunctionId,
  StrategyRef,
} from './ids';
import { isMutationOperatorId, isSelectionFunctionId } from './ids';
import type {
  AdversaryDescriptor,
  PopulationRecord,
} from './population';
import { isAdversaryDescriptor, isPopulationRecord, validatePopulationRecord } from './population';
import type { AdversaryBlueprintRef } from '../curriculum/ids';

// ---------------------------------------------------------------------------
// The declared selection function (versioned; NO hidden fitness)
// ---------------------------------------------------------------------------

/**
 * The closed fitness-derivation vocabulary: the NAMED, VERSIONED ways a
 * selection function may derive a member's fitness score. `seeded-digest-v1`
 * is the deterministic reference derivation (FNV-1a over adversary id +
 * seed) — adding a derivation (e.g. an evaluation-citation derivation) is
 * an explicit version change, never a closure smuggled in.
 */
export const FITNESS_DERIVATIONS = deepFreeze(['seeded-digest-v1'] as const);

/** One declared fitness derivation. */
export type FitnessDerivation = (typeof FITNESS_DERIVATIONS)[number];

/** Guard: `FitnessDerivation`. */
export function isFitnessDerivation(v: unknown): v is FitnessDerivation {
  return isMemberOf(FITNESS_DERIVATIONS, v);
}

/**
 * The DECLARED selection function: a versioned record — the fitness
 * derivation BY NAME (no closure), the retain/mutate counts, and the
 * mutation operator id (the operator record itself is declared and
 * versioned below). "The selection function is a declared, versioned
 * record" — this interface IS that law.
 */
export interface SelectionFunction {
  /** The selection function's identity (versioned). */
  readonly function_id: SelectionFunctionId;
  /** The record's version (positive safe integer). */
  readonly version: number;
  /** The NAMED fitness derivation (never a closure). */
  readonly fitness_derivation: FitnessDerivation;
  /** How many top-ranked members are retained (>= 1). */
  readonly retain_count: number;
  /** How many mutants are derived from the retained set (>= 1). */
  readonly mutate_count: number;
  /** The declared mutation operator this function evolves with. */
  readonly operator: MutationOperatorId;
}

/** Guard: `SelectionFunction`. */
export function isSelectionFunction(v: unknown): v is SelectionFunction {
  if (!isRecord(v)) return false;
  if (!isSelectionFunctionId(v.function_id)) return false;
  if (typeof v.version !== 'number' || !Number.isSafeInteger(v.version) || v.version < 1) return false;
  if (!isFitnessDerivation(v.fitness_derivation)) return false;
  if (typeof v.retain_count !== 'number' || !Number.isSafeInteger(v.retain_count) || v.retain_count < 1) return false;
  if (typeof v.mutate_count !== 'number' || !Number.isSafeInteger(v.mutate_count) || v.mutate_count < 1) return false;
  if (!isMutationOperatorId(v.operator)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The declared mutation operator (versioned)
// ---------------------------------------------------------------------------

/**
 * The closed mutation-operator-kind vocabulary: the DECLARED ways a
 * mutant's refs derive from its parent(s). Every kind's derivation is a
 * deterministic FNV-1a function of the declared inputs (see
 * {@link evolvePopulation}); adding a kind is an explicit operator-version
 * change.
 */
export const MUTATION_OPERATOR_KINDS = deepFreeze(['parameter-jitter', 'strategy-swap', 'blueprint-recombination'] as const);

/** One declared mutation-operator kind. */
export type MutationOperatorKind = (typeof MUTATION_OPERATOR_KINDS)[number];

/** Guard: `MutationOperatorKind`. */
export function isMutationOperatorKind(v: unknown): v is MutationOperatorKind {
  return isMemberOf(MUTATION_OPERATOR_KINDS, v);
}

/**
 * The DECLARED mutation operator: a versioned record naming its kind and
 * (for `strategy-swap`) the declared strategy pool the mutants draw from.
 * The operator is DATA: how a mutant's strategy and blueprint refs derive
 * is declared by the kind, versioned by the record — never hidden in a
 * closure.
 */
export interface MutationOperator {
  /** The operator's identity (versioned). */
  readonly operator_id: MutationOperatorId;
  /** The record's version (positive safe integer). */
  readonly version: number;
  /** The declared kind (the derivation family). */
  readonly kind: MutationOperatorKind;
  /** The declared strategy pool (`strategy-swap` only; may be empty otherwise). */
  readonly strategy_pool: readonly StrategyRef[];
}

/** Guard: `MutationOperator`. */
export function isMutationOperator(v: unknown): v is MutationOperator {
  if (!isRecord(v)) return false;
  if (!isMutationOperatorId(v.operator_id)) return false;
  if (typeof v.version !== 'number' || !Number.isSafeInteger(v.version) || v.version < 1) return false;
  if (!isMutationOperatorKind(v.kind)) return false;
  if (!Array.isArray(v.strategy_pool)) return false;
  if (v.kind === 'strategy-swap' && v.strategy_pool.length === 0) {
    return false; // a swap operator with no pool cannot derive a strategy
  }
  return (v.strategy_pool as readonly unknown[]).every((ref) => typeof ref === 'string' && (ref as string).length > 0);
}

// ---------------------------------------------------------------------------
// The declared derivations (pure FNV-1a functions)
// ---------------------------------------------------------------------------

/**
 * The `seeded-digest-v1` fitness derivation: FNV-1a over
 * `(adversary id | seed)` — the DECLARED reference derivation. A pure
 * digest of declared inputs; the same adversary under the same seed
 * scores the same, forever.
 */
export function seededDigestFitness(adversary: AdversaryId, seed: string): number {
  return parseInt(fnv1a32Hex(`${adversary}|${seed}`), 16);
}

/**
 * The declared derivation of a mutant's adversary id:
 * `adv-mut-<fnv1a32(parent|operator|generation|index|seed)>` — unique per
 * (parent, operator, generation, index, seed) by construction.
 */
export function deriveMutantAdversaryId(parent: AdversaryId, operator: string, generation: number, index: number, seed: string): AdversaryId {
  return `adv-mut-${fnv1a32Hex(`${parent}|${operator}|${generation}|${index}|${seed}`)}` as AdversaryId;
}

/**
 * The declared derivation of a mutant's strategy ref (parameter-jitter and
 * the recombination default):
 * `strat-mut-<fnv1a32(parent-strategy|operator|generation|index|seed)>`.
 */
export function deriveMutantStrategyRef(parentStrategy: StrategyRef, operator: string, generation: number, index: number, seed: string): StrategyRef {
  return `strat-mut-${fnv1a32Hex(`${parentStrategy}|${operator}|${generation}|${index}|${seed}`)}` as StrategyRef;
}

/**
 * The declared derivation of a recombined blueprint ref
 * (blueprint-recombination):
 * `bp-mut-<fnv1a32(parent-a|parent-b|operator|generation|index|seed)>`.
 */
export function deriveRecombinedBlueprintRef(parentA: AdversaryBlueprintRef, parentB: AdversaryBlueprintRef, operator: string, generation: number, index: number, seed: string): AdversaryBlueprintRef {
  return `bp-mut-${fnv1a32Hex(`${parentA}|${parentB}|${operator}|${generation}|${index}|${seed}`)}` as AdversaryBlueprintRef;
}

// ---------------------------------------------------------------------------
// The evolution outcome record
// ---------------------------------------------------------------------------

/**
 * One evolution's structured outcome: the successor population plus the
 * per-decision ledger — which adversaries were retained, which were
 * retired, and which mutants were born (with their parent + operator
 * lineage). The ledger is DATA: the evolution's every decision is
 * reconstructible from the record (L11's spirit — selection effects stay
 * exposed).
 */
export interface EvolutionOutcome {
  /** The successor population (generation + 1). */
  readonly successor: PopulationRecord;
  /** The retained adversary ids (top-ranked, unchanged). */
  readonly retained: readonly AdversaryId[];
  /** The retired adversary ids (moved to the successor's retired list — retained records, L11). */
  readonly retired: readonly AdversaryId[];
  /** The born mutant descriptors (with parent + operator lineage). */
  readonly born: readonly AdversaryDescriptor[];
}

/** Guard: `EvolutionOutcome` (structural). */
export function isEvolutionOutcome(v: unknown): v is EvolutionOutcome {
  if (!isRecord(v)) return false;
  if (!isPopulationRecord(v.successor)) return false;
  if (!Array.isArray(v.retained)) return false;
  if (!Array.isArray(v.retired)) return false;
  if (!Array.isArray(v.born)) return false;
  if (!(v.born as readonly unknown[]).every((mutant) => isAdversaryDescriptor(mutant))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The engine (pure, seeded)
// ---------------------------------------------------------------------------

/**
 * Evolve a population one generation — the pure seeded engine.
 *
 * Laws enforced (typed failures):
 *   - the population is a valid record (`invalid_field` — the untrusted
 *     form is deep-validated first);
 *   - the selection function and operator are declared, guard-valid
 *     records (`selection_infeasible` / `invalid_field`);
 *   - the operator the function names IS the operator record supplied
 *     (`lineage_mismatch` — a selection function cannot name one operator
 *     and run under another);
 *   - `retain_count` is feasible: at most the member count
 *     (`selection_infeasible` — retaining more than exists is not a
 *     selection, it is a no-op pretending to be one);
 *   - the scope is carried (the successor inherits the parent's lineage
 *     block verbatim — L9/L12).
 *
 * Same (population, selection function, operator, seed) -> byte-identical
 * successor + ledger (the determinism law).
 */
export function evolvePopulation(
  population: unknown,
  selection: unknown,
  operator: unknown,
  seed: string,
): CurriculumResult<EvolutionOutcome> {
  // --- validation ------------------------------------------------------------
  if (typeof seed !== 'string' || seed.length === 0) {
    return fail('invalid_field', 'the evolution seed must be a non-empty string (no ambient randomness)', 'seed');
  }
  const parentResult = isPopulationRecord(population) ? validatePopulationRecord(population) : null;
  if (parentResult === null || !parentResult.ok) {
    const errors: readonly CurriculumError[] = parentResult === null
      ? [{ code: 'invalid_field', path: 'population', message: 'evolvePopulation requires a structurally valid population record' }]
      : parentResult.errors;
    return { ok: false, errors };
  }
  const parent = parentResult.value;

  if (!isSelectionFunction(selection)) {
    return fail('invalid_field', 'the selection function must be a declared, versioned record { function_id, version, fitness_derivation, retain_count, mutate_count, operator } — no hidden fitness in closures', 'selection');
  }
  if (!isMutationOperator(operator)) {
    return fail('invalid_field', 'the mutation operator must be a declared, versioned record { operator_id, version, kind, strategy_pool }', 'operator');
  }
  if (selection.operator !== operator.operator_id) {
    return fail(
      'lineage_mismatch',
      `the selection function "${selection.function_id}" names operator "${selection.operator}" but the supplied operator record is "${operator.operator_id}" — a selection function runs under its declared operator`,
      'operator',
    );
  }
  if (selection.retain_count > parent.members.length) {
    return fail(
      'selection_infeasible',
      `the selection function retains ${selection.retain_count} adversaries but the population has ${parent.members.length} members — retaining more than exists is not a selection`,
      'selection.retain_count',
    );
  }

  // --- score + rank (the declared derivation + the declared tie-break) ------
  const ranked = [...parent.members].sort((left, right) => {
    const leftFitness = seededDigestFitness(left.adversary, seed);
    const rightFitness = seededDigestFitness(right.adversary, seed);
    if (leftFitness !== rightFitness) return rightFitness - leftFitness; // fitness descending
    return left.adversary < right.adversary ? -1 : left.adversary > right.adversary ? 1 : 0; // id ascending
  });

  // --- retain -----------------------------------------------------------------
  const retained = ranked.slice(0, selection.retain_count);
  const retiredNow = ranked.slice(selection.retain_count);

  // --- mutate (the operator-kind-specific derivations) -------------------------
  const generation = parent.generation + 1;
  const born: AdversaryDescriptor[] = [];
  for (let index = 0; index < selection.mutate_count; index++) {
    const proto = retained[index % retained.length]; // cycle retained order (declared)
    const mutantId = deriveMutantAdversaryId(proto.adversary, operator.operator_id, generation, index, seed);
    let strategy: StrategyRef;
    let blueprint: AdversaryBlueprintRef;
    switch (operator.kind) {
      case 'parameter-jitter': {
        // Same strategy family, jittered parameters: strategy ref mutated,
        // blueprint inherited.
        strategy = deriveMutantStrategyRef(proto.strategy, operator.operator_id, generation, index, seed);
        blueprint = proto.blueprint;
        break;
      }
      case 'strategy-swap': {
        // A strategy drawn from the operator's declared pool (deterministic
        // pick: pool[(generation + index) mod pool size]); blueprint inherited.
        const pool = operator.strategy_pool;
        strategy = pool[(generation + index) % pool.length];
        blueprint = proto.blueprint;
        break;
      }
      case 'blueprint-recombination': {
        // Strategy inherited; the blueprint is recombined from the proto and
        // its declared partner (the next retained adversary, cycling).
        strategy = proto.strategy;
        const partner = retained[(index + 1) % retained.length];
        blueprint = deriveRecombinedBlueprintRef(proto.blueprint, partner.blueprint, operator.operator_id, generation, index, seed);
        break;
      }
    }
    born.push(
      deepFreeze({
        adversary: mutantId,
        strategy,
        blueprint,
        lineage: deepFreeze({
          population: parent.population,
          generation,
          parent: proto.adversary,
          operator: operator.operator_id,
        }),
        tenantId: parent.lineage.tenant,
        projectId: parent.lineage.project,
      }),
    );
  }

  // --- the successor record ------------------------------------------------------
  const retiredAll = [...parent.retired, ...retiredNow];
  const successorResult = validatePopulationRecord({
    population: parent.population,
    generation,
    members: [...retained, ...born],
    retired: retiredAll,
    lineage: parent.lineage,
  });
  if (!successorResult.ok) return successorResult;

  const outcome: EvolutionOutcome = deepFreeze({
    successor: successorResult.value,
    retained: deepFreeze(retained.map((member) => member.adversary)),
    retired: deepFreeze(retiredAll.map((member) => member.adversary)),
    born: deepFreeze(born),
  });
  return { ok: true, value: outcome };
}

/** The population-id witness (re-exported for tests that assert lineage stability). */
export function populationIdOf(record: PopulationRecord): PopulationId {
  return record.population;
}
