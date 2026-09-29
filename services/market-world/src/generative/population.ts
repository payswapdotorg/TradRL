/**
 * @tradrl/market-world (generative service) — the POPULATION SPEC (work
 * order T028): the declared market population a generative world
 * generates.
 *
 * THE LAW THIS MODULE SERVES: the Work Order's scope — "population spec
 * (participant cohorts + behavior-policy refs + initial state seeds)".
 * A generative world's market is a POPULATION, not a recording:
 *
 *   - {@link InitialBook} — the DECLARED opening book state (the initial
 *     state seed of the venue's liquidity). The REAL engine validates it
 *     against the venue grids at `createEngine` — this lane validates the
 *     shape and the grid coherence up front (the probe at construction
 *     fail-closes on anything the engine would reject).
 *   - {@link CohortDeclaration} — one cohort: an opaque id, an honest
 *     label, the REFERENCE to a declared behavior-policy process (the
 *     versioned, seeded stochastic process of process.ts — market
 *     makers, momentum takers, mean-reverters, noise traders), and the
 *     cohort's size (the participant count). Participant instance ids
 *     derive deterministically (`pop-<cohort>-<ordinal>`) — the roster is
 *     a pure function of the config (L9: the config hash covers every
 *     participant the world can ever contain).
 *   - {@link CandidateDeclaration} — the candidate organization: the ONE
 *     participant whose actions arrive through the DRIVER-FACING submit
 *     port (the "candidate-organization action feed port" of the Work
 *     Order's scope). Population participants act ONLY through their
 *     declared processes — a driver submission in their name is a typed
 *     error (`actor_not_candidate`): it would inject ambient, unlineaged
 *     randomness into a world whose existential law forbids it.
 */

import { deepFreeze, isNonEmptyString, isPositiveSafeInteger, isRecord, isAlignedToGridLocal } from './primitives';
import { invalidField, invalidType, missingField, ok, type GenerativeError, type GenerativeResult } from './errors';
import type { ExchangePhysicsMirror } from './exchange-mirror';
import { isCanonicalPositiveDecimal } from './exchange-mirror';
import type { AgentInstanceId, CohortId, ProcessRef } from './ids';
import { isAgentInstanceId, isCohortId, isProcessRef } from './ids';

// ---------------------------------------------------------------------------
// The declared initial book (the venue liquidity's initial state seed)
// ---------------------------------------------------------------------------

/** One declared resting level: a grid-aligned price and a lot-aligned size. */
export interface InitialBookLevel {
  readonly price: string;
  readonly size: string;
}

/**
 * The declared opening book state — the initial-state seed of the
 * venue's liquidity. This is CONFIGURATION, not future information: a
 * generative world has no recorded history to leak (the L4 boundary
 * still governs every OBSERVATION the world emits from instant one).
 */
export interface InitialBook {
  readonly bids: readonly InitialBookLevel[];
  readonly asks: readonly InitialBookLevel[];
}

/** Guard: an initial book (levels well-formed; sides non-empty — a market needs two sides to open). */
export function isInitialBook(value: unknown): value is InitialBook {
  if (!isRecord(value)) return false;
  for (const side of ['bids', 'asks'] as const) {
    const levels = value[side];
    if (!Array.isArray(levels) || levels.length === 0) return false;
    for (const level of levels as readonly unknown[]) {
      if (!isRecord(level)) return false;
      if (!isCanonicalPositiveDecimal(level.price) || !isCanonicalPositiveDecimal(level.size)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The candidate organization (the driver-facing action port)
// ---------------------------------------------------------------------------

/**
 * The candidate organization declaration: the ONE participant whose
 * actions arrive through the world's `submit` operation (the T013
 * trainer bridge and the environment-protocol surface drive it). The
 * candidate's actions are INPUTS (declared, ordered, sequenced) — the
 * market fights back through the engine, never through the population's
 * processes.
 */
export interface CandidateDeclaration {
  readonly instance: AgentInstanceId;
}

/** Guard: a candidate declaration. */
export function isCandidateDeclaration(value: unknown): value is CandidateDeclaration {
  if (!isRecord(value)) return false;
  return isAgentInstanceId(value.instance);
}

// ---------------------------------------------------------------------------
// The cohort declaration (participant cohorts + behavior-policy refs)
// ---------------------------------------------------------------------------

/**
 * One declared cohort of the market population: an opaque id, an honest
 * label, the reference to a declared behavior-policy process, and the
 * cohort's size. Each of the `size` participants derives its instance id
 * `pop-<cohort_id>-<ordinal>` (1-based) and its OWN deterministic draw
 * sequence (the process seed namespaced by the instance — process.ts's
 * arming law), so a cohort of N is N independent lineaged traders, not N
 * copies of one.
 */
export interface CohortDeclaration {
  readonly cohort_id: CohortId;
  readonly label: string;
  readonly policy: ProcessRef;
  readonly size: number;
}

/** Guard: a cohort declaration. */
export function isCohortDeclaration(value: unknown): value is CohortDeclaration {
  if (!isRecord(value)) return false;
  if (!isCohortId(value.cohort_id)) return false;
  if (!isNonEmptyString(value.label)) return false;
  if (!isProcessRef(value.policy)) return false;
  if (!isPositiveSafeInteger(value.size)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The population spec
// ---------------------------------------------------------------------------

/**
 * The full population declaration: the initial book, the candidate
 * organization, and the cohorts. With the process declarations (owned by
 * the world config), this fully determines every participant the world
 * can ever contain and every action they can ever take (given the seeds)
 * — the generative lane's analog of the recorded stream: a DECLARATION
 * of the whole market, not a recording of it.
 */
export interface PopulationSpec {
  readonly initial_book: InitialBook;
  readonly candidate: CandidateDeclaration;
  readonly cohorts: readonly CohortDeclaration[];
}

/** Derive participant instance ids of a cohort (deterministic, 1-based ordinals). */
export function cohortInstances(cohort: CohortDeclaration): readonly AgentInstanceId[] {
  const instances: AgentInstanceId[] = [];
  for (let ordinal = 1; ordinal <= cohort.size; ordinal++) {
    instances.push(`pop-${cohort.cohort_id}-${String(ordinal)}` as AgentInstanceId);
  }
  return instances;
}

/**
 * Collect-all validation of an untrusted population spec. Structural
 * laws: a two-sided non-empty initial book with grid-coherent levels
 * (the engine re-validates at createEngine; the probe fail-closes
 * early), a candidate instance disjoint from every cohort participant
 * id, unique cohort ids, and unique policy refs (one cohort per declared
 * behavior process — a policy bound twice would double-draw one
 * declaration, muddying the lineage).
 */
export function validatePopulationSpec(value: unknown, path = 'config.population', physics?: ExchangePhysicsMirror): GenerativeResult<PopulationSpec> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path}`, `${path} must be an object`)] };
  }
  const errors: GenerativeError[] = [];

  let initialBook: InitialBook | undefined;
  if (value.initial_book === undefined) {
    errors.push(missingField(`${path}.initial_book`));
  } else if (!isInitialBook(value.initial_book)) {
    errors.push(invalidField(`${path}.initial_book`, 'must be { bids: [{price,size}], asks: [{price,size}] } with non-empty canonical positive decimal levels on both sides — a market needs two sides to open'));
  } else {
    const book = value.initial_book as InitialBook;
    if (physics !== undefined) {
      for (const [side, levels] of [['bids', book.bids], ['asks', book.asks]] as const) {
        for (let index = 0; index < levels.length; index++) {
          const level = levels[index] as InitialBookLevel;
          if (!isAlignedToGridLocal(level.price, physics.tick_size)) {
            errors.push(invalidField(`${path}.initial_book.${side}[${index}].price`, `"${level.price}" is not aligned to the venue tick grid ${physics.tick_size} (grid coherence — the engine would reject the seed)`));
          }
          if (!isAlignedToGridLocal(level.size, physics.lot_size)) {
            errors.push(invalidField(`${path}.initial_book.${side}[${index}].size`, `"${level.size}" is not aligned to the venue lot grid ${physics.lot_size} (grid coherence — the engine would reject the seed)`));
          }
        }
      }
    }
    initialBook = book;
  }

  let candidate: CandidateDeclaration | undefined;
  if (value.candidate === undefined) {
    errors.push(missingField(`${path}.candidate`));
  } else if (!isCandidateDeclaration(value.candidate)) {
    errors.push(invalidField(`${path}.candidate`, 'must be { instance: non-empty id } — the candidate organization acts through the driver-facing submit port'));
  } else {
    candidate = value.candidate;
  }

  let cohorts: readonly CohortDeclaration[] | undefined;
  if (value.cohorts === undefined) {
    errors.push(missingField(`${path}.cohorts`));
  } else if (!Array.isArray(value.cohorts)) {
    errors.push(invalidField(`${path}.cohorts`, 'must be an array of cohort declarations'));
  } else if ((value.cohorts as readonly unknown[]).length === 0) {
    errors.push(invalidField(`${path}.cohorts`, 'must declare at least one cohort — a generative world without a generated population is an empty room (the reactive/replay lanes cover the other modes)'));
  } else {
    const seenCohorts = new Set<string>();
    const seenPolicies = new Set<string>();
    let valid = true;
    for (let index = 0; index < (value.cohorts as readonly unknown[]).length; index++) {
      const cohort = (value.cohorts as readonly unknown[])[index];
      if (!isCohortDeclaration(cohort)) {
        errors.push(invalidField(`${path}.cohorts[${index}]`, 'must be { cohort_id, label, policy, size } with a positive integer size'));
        valid = false;
        continue;
      }
      if (seenCohorts.has(cohort.cohort_id)) {
        errors.push(invalidField(`${path}.cohorts[${index}].cohort_id`, `duplicate cohort id "${cohort.cohort_id}"`));
      }
      seenCohorts.add(cohort.cohort_id);
      if (seenPolicies.has(cohort.policy)) {
        errors.push(invalidField(`${path}.cohorts[${index}].policy`, `policy ref "${cohort.policy}" is already bound by another cohort — one cohort per declared behavior process (lineage clarity)`));
      }
      seenPolicies.add(cohort.policy);
    }
    if (valid) {
      cohorts = (value.cohorts as readonly unknown[]).filter(isCohortDeclaration);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const validatedCohorts = cohorts as readonly CohortDeclaration[];
  const validatedCandidate = candidate as CandidateDeclaration;

  // The candidate must be disjoint from every generated participant id.
  for (const cohort of validatedCohorts) {
    for (const instance of cohortInstances(cohort)) {
      if (instance === validatedCandidate.instance) {
        errors.push(invalidField(`${path}.candidate.instance`, `"${validatedCandidate.instance}" collides with a generated participant id of cohort "${cohort.cohort_id}" — the candidate is driver-driven, population participants are process-driven (never both)`));
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      initial_book: deepFreeze({
        bids: (initialBook as InitialBook).bids.map((level) => deepFreeze({ price: level.price, size: level.size })),
        asks: (initialBook as InitialBook).asks.map((level) => deepFreeze({ price: level.price, size: level.size })),
      }),
      candidate: deepFreeze({ instance: validatedCandidate.instance }),
      cohorts: validatedCohorts.map((cohort) => deepFreeze({ cohort_id: cohort.cohort_id, label: cohort.label, policy: cohort.policy, size: cohort.size })),
    }),
  );
}

// ---------------------------------------------------------------------------
// The roster derivation (deterministic — a pure function of the spec)
// ---------------------------------------------------------------------------

/** The total participant count of a validated population spec (the generated roster's size). */
export function populationSize(spec: PopulationSpec): number {
  let total = 0;
  for (const cohort of spec.cohorts) total += cohort.size;
  return total;
}