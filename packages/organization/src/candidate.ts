/**
 * @tradrl/organization — candidates, lineage and the append-only search
 * log.
 *
 * THE LAWS THIS MODULE ENFORCES:
 *
 * - L9 (reproducible lineage) — every candidate carries its FULL lineage
 *   block: goal ref, constraint-set ref, registry snapshot digest, seed,
 *   compiler version, parent candidate ref (the search is a TREE, not
 *   just a list), tenant and project. A candidate whose lineage disagrees
 *   with its log, or whose parent is unresolvable/non-earlier, is a typed
 *   `lineage_gap`.
 *
 * - L11 (search integrity — "optimization history is retained to expose
 *   selection effects") — the candidate sequence is an APPEND-ONLY log:
 *   rejected candidates are RETAINED records with STRUCTURED reasons
 *   (never free text); hiding or rewriting a candidate is a typed
 *   `candidate_rewrite`. There is NO remove/update/rewrite function on
 *   the log — appending is the only mutation, and appending requires the
 *   next contiguous sequence number and a fresh candidate id. The log's
 *   derived run id is a digest over the canonical compile input, so the
 *   log is byte-deterministic given its inputs (the determinism law).
 *
 * - Determinism — same (goal, constraints, budgets, registry snapshot,
 *   seed, compiler version) -> byte-identical candidate sequence. The
 *   search is a pure function; there is NO ambient randomness (seeded
 *   generators only) and NO ambient clock (`Date.now()` never appears).
 *
 * - L12 (tenant isolation) — every record carries TenantId + ProjectId.
 *
 * - Dispositions are a closed union (proposed | retained | rejected) and
 *   rejection reasons are a closed discriminated union of STRUCTURED
 *   records (axis, measurement, budget, constraint id, retained count) —
 *   "reasons as structured data, never free text".
 */

import {
  type CapabilityKey,
  type CandidateId,
  type CompilerVersionRef,
  type ConstraintSetRef,
  type GoalRef,
  type JsonValue,
  type ProjectId,
  type RegistryDigest,
  type SearchRunId,
  type SearchSeed,
  type TenantId,
  canonicalJson,
  deepFreeze,
  isArrayOf,
  isCandidateId,
  isCompilerVersionRef,
  isCapabilityKey,
  isDigest,
  isMemberOf,
  isNonEmptyString,
  isPositiveInteger,
  isProjectId,
  isRecord,
  isRegistryDigest,
  isSearchRunId,
  isSearchSeed,
  isTenantId,
  isUnitInterval,
  stableDigest,
} from './primitives';
import { type OrgError, type OrgResult, fail, invalidField, invalidType } from './errors';
import type { CompileBudgets } from './budgets';
import { isCompileBudgets } from './budgets';
import type { OrganizationBlueprint } from './blueprint';
import { isOrganizationBlueprint } from './blueprint';
import type {
  AggregationStrategy,
  ObjectiveAggregate,
  ObjectiveMeasurements,
} from './objective';
import { isAggregationStrategy, isObjectiveAggregate, isObjectiveMeasurements } from './objective';
import type { GoalStatementMirror, ConstraintSetStatementMirror } from './control-mirror';
import { isConstraintSetStatementMirror, isGoalStatementMirror } from './control-mirror';
import type { RegistrySnapshotMirror } from './capability-mirror';
import { isRegistrySnapshotMirror, validateRegistrySnapshotMirror } from './capability-mirror';
import type { CapabilityGap } from './gap';
import { isCapabilityGap } from './gap';
import type { DiscoveryStep } from './discovery';
import { isDiscoveryStepArray, validateDiscoverySequence } from './discovery';

// ---------------------------------------------------------------------------
// Dispositions and structured rejection reasons
// ---------------------------------------------------------------------------

/** The closed candidate-disposition vocabulary. */
export const CANDIDATE_DISPOSITIONS = ['proposed', 'retained', 'rejected'] as const;

/** One candidate disposition: proposed (the selection), retained (in the window), rejected (record retained). */
export type CandidateDisposition = (typeof CANDIDATE_DISPOSITIONS)[number];

/** Guard: `CandidateDisposition`. */
export function isCandidateDisposition(v: unknown): v is CandidateDisposition {
  return isMemberOf(CANDIDATE_DISPOSITIONS, v);
}

/** The closed rejection-reason code vocabulary (structured reasons, never free text). */
export const CANDIDATE_REJECTION_CODES = [
  'below-required-satisfaction',
  'budget-exceeded',
  'blocking-constraint',
  'retain-limit',
] as const;

/** One rejection-reason code. */
export type CandidateRejectionCode = (typeof CANDIDATE_REJECTION_CODES)[number];

/** Guard: `CandidateRejectionCode`. */
export function isCandidateRejectionCode(v: unknown): v is CandidateRejectionCode {
  return isMemberOf(CANDIDATE_REJECTION_CODES, v);
}

/** The budget axes a rejection can name (the measurable search axes). */
export const REJECTION_BUDGET_AXES = ['agentCount', 'compute', 'coordinationCost', 'latency'] as const;

/** One budget axis. */
export type RejectionBudgetAxis = (typeof REJECTION_BUDGET_AXES)[number];

/** Guard: `RejectionBudgetAxis`. */
export function isRejectionBudgetAxis(v: unknown): v is RejectionBudgetAxis {
  return isMemberOf(REJECTION_BUDGET_AXES, v);
}

/**
 * One structured rejection reason — a closed discriminated union. A
 * rejected candidate carries a NON-EMPTY list; every reason names its
 * cause as data (threshold, axis/measurement/budget, constraint id, or
 * retention window), never as free text.
 */
export type CandidateRejectionReason =
  | {
      readonly code: 'below-required-satisfaction';
      /** The goal's required satisfaction share the candidate failed. */
      readonly requiredSatisfaction: number;
      /** The candidate's measured attainment score. */
      readonly attainmentScore: number;
    }
  | {
      readonly code: 'budget-exceeded';
      /** Which budget axis was exceeded. */
      readonly axis: RejectionBudgetAxis;
      /** The measured value that exceeded the budget. */
      readonly measured: number;
      /** The budget that was exceeded. */
      readonly budget: number;
    }
  | {
      readonly code: 'blocking-constraint';
      /** The blocking constraint (by id) whose predicate the candidate failed. */
      readonly constraintId: string;
    }
  | {
      readonly code: 'retain-limit';
      /** How many candidates the retention window kept. */
      readonly retainedCount: number;
    };

/** Guard: `CandidateRejectionReason` (total over the closed union). */
export function isCandidateRejectionReason(v: unknown): v is CandidateRejectionReason {
  if (!isRecord(v)) return false;
  switch (v.code) {
    case 'below-required-satisfaction':
      return isUnitInterval(v.requiredSatisfaction) && isUnitInterval(v.attainmentScore);
    case 'budget-exceeded':
      return (
        isRejectionBudgetAxis(v.axis) &&
        typeof v.measured === 'number' && Number.isFinite(v.measured) &&
        typeof v.budget === 'number' && Number.isFinite(v.budget)
      );
    case 'blocking-constraint':
      return isNonEmptyString(v.constraintId);
    case 'retain-limit':
      return Number.isInteger(v.retainedCount) && (v.retainedCount as number) >= 0;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Lineage (L9 — the full block, on every candidate)
// ---------------------------------------------------------------------------

/**
 * The full lineage block every candidate carries (L9): the goal and
 * constraint-set refs (versioned pointers), the registry snapshot digest
 * (the exact evidence base searched over), the seed and compiler version
 * (the determinism inputs), the parent candidate ref (the search is a
 * TREE), and the tenant/project scope (L12).
 */
export interface CandidateLineage {
  /** The goal the search compiled for (versioned pointer). */
  readonly goalRef: GoalRef;
  /** The goal's version. */
  readonly goalVersion: number;
  /** The constraint set the search compiled under (versioned pointer). */
  readonly constraintSetRef: ConstraintSetRef;
  /** The constraint set's version. */
  readonly constraintSetVersion: number;
  /** The registry snapshot digest the search ran over (L9 evidence binding). */
  readonly registrySnapshotDigest: RegistryDigest;
  /** The search seed (the ONLY randomness input — the determinism law). */
  readonly seed: SearchSeed;
  /** The compiler version that produced the candidate. */
  readonly compilerVersion: CompilerVersionRef;
  /** The parent candidate (null for roots); MUST reference an EARLIER candidate. */
  readonly parentCandidateId: CandidateId | null;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
}

/** Guard: `CandidateLineage`. */
export function isCandidateLineage(v: unknown): v is CandidateLineage {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.goalRef) &&
    isPositiveInteger(v.goalVersion) &&
    isNonEmptyString(v.constraintSetRef) &&
    isPositiveInteger(v.constraintSetVersion) &&
    isRegistryDigest(v.registrySnapshotDigest) &&
    isSearchSeed(v.seed) &&
    isCompilerVersionRef(v.compilerVersion) &&
    (v.parentCandidateId === null || isCandidateId(v.parentCandidateId)) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId)
  );
}

// ---------------------------------------------------------------------------
// The candidate
// ---------------------------------------------------------------------------

/**
 * One organization candidate: the blueprint (all seven axes), the
 * objective measurements (the seven components), the aggregated objective
 * (score + contributions), the full lineage block (L9), the disposition,
 * and — for rejected candidates ONLY — the structured rejection reasons.
 */
export interface OrganizationCandidate {
  /** Candidate identity (unique within the log). */
  readonly candidateId: CandidateId;
  /** 1-based position in the append-only candidate sequence (the search history order). */
  readonly sequence: number;
  /** The seven-axis blueprint. */
  readonly blueprint: OrganizationBlueprint;
  /** The seven measured objective components. */
  readonly measurements: ObjectiveMeasurements;
  /** The aggregated objective (score + contributions + input digest). */
  readonly objective: ObjectiveAggregate;
  /** The full lineage block (L9). */
  readonly lineage: CandidateLineage;
  /** The disposition (proposed | retained | rejected). */
  readonly disposition: CandidateDisposition;
  /** Structured rejection reasons; NON-EMPTY iff disposition is `rejected`, EMPTY otherwise. */
  readonly reasons: readonly CandidateRejectionReason[];
}

/** Guard: `OrganizationCandidate` (structural; the log laws live in validateSearchLog). */
export function isOrganizationCandidate(v: unknown): v is OrganizationCandidate {
  if (!isRecord(v)) return false;
  if (!isCandidateId(v.candidateId)) return false;
  if (!isPositiveInteger(v.sequence)) return false;
  if (!isOrganizationBlueprint(v.blueprint)) return false;
  if (!isObjectiveMeasurements(v.measurements)) return false;
  if (!isObjectiveAggregate(v.objective)) return false;
  if (!isCandidateLineage(v.lineage)) return false;
  if (!isCandidateDisposition(v.disposition)) return false;
  if (!Array.isArray(v.reasons)) return false;
  if (!v.reasons.every((reason) => isCandidateRejectionReason(reason))) return false;
  const rejected = v.disposition === 'rejected';
  const reasonsLength = (v.reasons as readonly CandidateRejectionReason[]).length;
  if (rejected && reasonsLength === 0) return false; // rejected => structured reasons
  if (!rejected && reasonsLength > 0) return false; // proposed/retained => no reasons
  return true;
}

// ---------------------------------------------------------------------------
// The search log (append-only — L11)
// ---------------------------------------------------------------------------

/**
 * The deterministic derived search-run id: a digest over the canonical
 * JSON of the FULL compile context (goal, constraints, budgets, registry
 * snapshot, seed, compiler version, required capabilities, gaps). Equal
 * inputs ALWAYS derive the equal run id — the reproducibility anchor
 * (L9) and the determinism law's checksum. The demand (required
 * capabilities and gaps) participates: two searches with different
 * demands never share a run id, and the log alone identifies its own
 * demand.
 */
export function searchRunIdOf(input: {
  readonly goal: GoalStatementMirror;
  readonly constraints: ConstraintSetStatementMirror;
  readonly budgets: CompileBudgets;
  readonly registrySnapshot: RegistrySnapshotMirror;
  readonly seed: SearchSeed;
  readonly compilerVersion: CompilerVersionRef;
  readonly requiredCapabilities: readonly CapabilityKey[];
  readonly gaps: readonly CapabilityGap[];
}): SearchRunId {
  const digest = stableDigest(
    canonicalJson({
      goal: input.goal as unknown as JsonValue,
      constraints: input.constraints as unknown as JsonValue,
      budgets: input.budgets as unknown as JsonValue,
      registrySnapshot: input.registrySnapshot as unknown as JsonValue,
      seed: input.seed,
      compilerVersion: input.compilerVersion,
      requiredCapabilities: [...input.requiredCapabilities],
      gaps: [...input.gaps] as unknown as JsonValue,
    } satisfies Record<string, JsonValue>),
  );
  return `orgsearch:${digest}` as SearchRunId;
}

/**
 * The append-only candidate log (L11). The candidate SEQUENCE is the
 * search history — enumeration order, not score order — so the
 * best-of-N selection effect stays quantifiable downstream
 * (search-integrity.ts). The log carries the FULL compile context (goal,
 * constraints, budgets, registry snapshot, seed, compiler version,
 * strategy, required capabilities, discovery steps) so the search is
 * replayable from the log alone. There is NO mutation function except
 * {@link appendOrganizationCandidate} (append-only, copy-on-write):
 * hiding or rewriting a candidate is UNREPRESENTABLE in the API, and the
 * validator turns sequence gaps, duplicate ids and selection mismatch
 * into the typed error `candidate_rewrite`.
 */
export interface SearchLog {
  /** Deterministic derived id (see {@link searchRunIdOf}). */
  readonly searchRunId: SearchRunId;
  /** The compile tenant scope (L12) — must match goal, constraints and every lineage block. */
  readonly tenantId: TenantId;
  /** The compile project scope (L12) — must match every lineage block. */
  readonly projectId: ProjectId;
  /** The goal the search compiled for (control-plane mirror). */
  readonly goal: GoalStatementMirror;
  /** The constraint set the search compiled under (control-plane mirror). */
  readonly constraints: ConstraintSetStatementMirror;
  /** The resource budgets (search bounds + candidate limits). */
  readonly budgets: CompileBudgets;
  /** The registry snapshot the search ran over (the evidence base, L16a). */
  readonly registrySnapshot: RegistrySnapshotMirror;
  /** The search seed — the only randomness input. */
  readonly seed: SearchSeed;
  /** The compiler version that produced this log. */
  readonly compilerVersion: CompilerVersionRef;
  /** The declared, versioned aggregation strategy (objective model). */
  readonly strategy: AggregationStrategy;
  /** The demand: the required capability contracts the search fulfilled (replay input). */
  readonly requiredCapabilities: readonly CapabilityKey[];
  /** The candidates, in append order (the search history); sequences 1..N. */
  readonly candidates: readonly OrganizationCandidate[];
  /** The discovery-loop protocol trace (CAPABILITY-DISCOVERY steps as typed records). */
  readonly discovery: readonly DiscoveryStep[];
  /** The search's declared selection: exactly the one `proposed` candidate. */
  readonly selection: { readonly selectedCandidateId: CandidateId };
}

/** Guard: `SearchLog` (structural; the full law in {@link validateSearchLog}). */
export function isSearchLog(v: unknown): v is SearchLog {
  if (!isRecord(v)) return false;
  if (!isSearchRunId(v.searchRunId)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (!isGoalStatementMirror(v.goal)) return false;
  if (!isConstraintSetStatementMirror(v.constraints)) return false;
  if (!isCompileBudgets(v.budgets)) return false;
  if (!isRegistrySnapshotMirror(v.registrySnapshot)) return false;
  if (!isSearchSeed(v.seed)) return false;
  if (!isCompilerVersionRef(v.compilerVersion)) return false;
  if (!isAggregationStrategy(v.strategy)) return false;
  if (!Array.isArray(v.requiredCapabilities) || v.requiredCapabilities.length === 0) return false;
  if (!isArrayOf(v.requiredCapabilities, isCapabilityKey)) return false;
  if (new Set(v.requiredCapabilities).size !== v.requiredCapabilities.length) return false;
  if (!Array.isArray(v.candidates)) return false;
  if (!v.candidates.every((candidate) => isOrganizationCandidate(candidate))) return false;
  if (!isDiscoveryStepArray(v.discovery)) return false;
  if (!isRecord(v.selection)) return false;
  if (!isCandidateId(v.selection.selectedCandidateId)) return false;
  return true;
}

/**
 * Validates a search log against the FULL law (collect-all where
 * possible, precise single causes for the integrity crimes):
 *
 * - `registry_digest_mismatch` — the embedded registry snapshot fails its
 *   own validation (label trip-wire, digest binding).
 * - `candidate_rewrite` — duplicate candidate ids; a sequence that is not
 *   exactly 1..N contiguous (a GAP is a HIDDEN candidate — L11); more
 *   than one `proposed` disposition; a selection that does not name the
 *   one proposed candidate.
 * - `lineage_gap` — a candidate's lineage disagrees with the log's
 *   goal/constraints/registry digest/seed/compiler version/tenant/project,
 *   or its parent does not reference an EARLIER candidate.
 * - `invalid_field` — structural violations anywhere.
 * - The discovery trace must satisfy the loop's ordering laws
 *   (validateDiscoverySequence).
 */
export function validateSearchLog(v: unknown): OrgResult<SearchLog> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType('search log must be an object')] };
  }
  const errors: OrgError[] = [];
  if (!isSearchRunId(v.searchRunId)) {
    errors.push(invalidField('searchRunId', 'invalid SearchRunId'));
  }
  if (!isTenantId(v.tenantId)) errors.push(invalidField('tenantId', 'invalid TenantId (L12)'));
  if (!isProjectId(v.projectId)) errors.push(invalidField('projectId', 'invalid ProjectId (L12)'));
  if (!isGoalStatementMirror(v.goal)) {
    errors.push(invalidField('goal', 'invalid GoalStatementMirror (control-plane mirror)'));
  }
  if (!isConstraintSetStatementMirror(v.constraints)) {
    errors.push(invalidField('constraints', 'invalid ConstraintSetStatementMirror'));
  }
  if (!isCompileBudgets(v.budgets)) errors.push(invalidField('budgets', 'invalid CompileBudgets'));
  if (!isSearchSeed(v.seed)) {
    errors.push({
      code: 'unseeded_search',
      path: 'seed',
      message: 'the search log must carry its seed — there is no ambient randomness (the determinism law)',
    });
  }
  if (!isCompilerVersionRef(v.compilerVersion)) {
    errors.push(invalidField('compilerVersion', 'invalid CompilerVersionRef'));
  }
  if (!isAggregationStrategy(v.strategy)) {
    errors.push(invalidField('strategy', 'invalid AggregationStrategy (declared, versioned)'));
  }
  if (errors.length > 0) return { ok: false, errors };

  // The registry snapshot's own full law (label trip-wire + digest binding).
  const snapshotResult = validateRegistrySnapshotMirror(v.registrySnapshot);
  if (!snapshotResult.ok) {
    return { ok: false, errors: snapshotResult.errors.map((e) => ({ ...e, path: `registrySnapshot.${e.path}` })) };
  }

  if (!Array.isArray(v.candidates)) {
    return { ok: false, errors: [invalidField('candidates', 'must be an array')] };
  }
  const log = v as unknown as SearchLog;
  const seenIds = new Set<string>();
  let proposedCount = 0;
  let proposedId: string | null = null;
  log.candidates.forEach((candidate, index) => {
    const path = `candidates[${index}]`;
    if (!isOrganizationCandidate(candidate)) {
      errors.push(
        invalidField(path, 'failed the OrganizationCandidate guard (seven-axis blueprint, measurements, objective, lineage, disposition, structured reasons)'),
      );
      return;
    }
    if (seenIds.has(candidate.candidateId)) {
      errors.push({
        code: 'candidate_rewrite',
        path: `${path}.candidateId`,
        message: `duplicate candidate id "${candidate.candidateId}" — rewriting a candidate is a typed error (L11)`,
      });
    } else {
      seenIds.add(candidate.candidateId);
    }
    if (candidate.sequence !== index + 1) {
      errors.push({
        code: 'candidate_rewrite',
        path: `${path}.sequence`,
        message: `sequence ${candidate.sequence} at position ${index + 1} — the sequence must be exactly 1..N contiguous; a gap is a HIDDEN candidate and hiding candidates is a typed error (L11)`,
      });
    }
    if (candidate.disposition === 'proposed') {
      proposedCount += 1;
      proposedId = candidate.candidateId;
    }
    // Lineage agreement with the log (L9).
    const lineage = candidate.lineage;
    if (
      lineage.goalRef !== log.goal.id ||
      lineage.goalVersion !== log.goal.version ||
      lineage.constraintSetRef !== log.constraints.id ||
      lineage.constraintSetVersion !== log.constraints.version ||
      lineage.registrySnapshotDigest !== log.registrySnapshot.digest ||
      lineage.seed !== log.seed ||
      lineage.compilerVersion !== log.compilerVersion ||
      lineage.tenantId !== log.tenantId ||
      lineage.projectId !== log.projectId
    ) {
      errors.push({
        code: 'lineage_gap',
        path: `${path}.lineage`,
        message: `candidate "${candidate.candidateId}" lineage disagrees with the log (goal/constraints/registry digest/seed/compiler version/tenant/project) — every candidate carries its full lineage block (L9)`,
      });
    }
    // Parent must reference an EARLIER candidate (the search is a tree; acyclic by construction).
    if (lineage.parentCandidateId !== null) {
      const parentIndex = log.candidates.findIndex(
        (other) => other.candidateId === lineage.parentCandidateId,
      );
      if (parentIndex < 0) {
        errors.push({
          code: 'lineage_gap',
          path: `${path}.lineage.parentCandidateId`,
          message: `parent candidate "${lineage.parentCandidateId}" does not exist in the log (L9)`,
        });
      } else if (parentIndex >= index) {
        errors.push({
          code: 'lineage_gap',
          path: `${path}.lineage.parentCandidateId`,
          message: `parent candidate "${lineage.parentCandidateId}" is not EARLIER than the candidate — the search tree grows forward only (L9)`,
        });
      }
    }
  });
  if (proposedCount !== 1) {
    errors.push({
      code: 'selection_mismatch',
      path: 'candidates',
      message: `a search log declares exactly ONE proposed candidate; found ${proposedCount}`,
    });
  }
  // The declared retention window (L11): the `retained` disposition count
  // may not exceed the budgets' retainLimitK — a log that launders
  // rejections into retentions (or inflates the window after the fact) is
  // a rewritten history.
  const retainedCount = log.candidates.filter((candidate) => candidate.disposition === 'retained').length;
  if (retainedCount > log.budgets.retainLimitK) {
    errors.push({
      code: 'selection_mismatch',
      path: 'candidates',
      message: `the declared retention window is retainLimitK=${log.budgets.retainLimitK} but ${retainedCount} candidate(s) are dispositioned retained — a retention window that grew after the search is a rewritten history (L11)`,
    });
  }
  if (!isRecord(v.selection) || !isCandidateId(v.selection.selectedCandidateId)) {
    errors.push(invalidField('selection', 'must be { selectedCandidateId }'));
  } else if (proposedId !== null && v.selection.selectedCandidateId !== proposedId) {
    errors.push({
      code: 'selection_mismatch',
      path: 'selection.selectedCandidateId',
      message: `selection names "${v.selection.selectedCandidateId}" but the proposed candidate is "${proposedId}" — the selection IS the proposed candidate`,
    });
  }
  const discoveryResult = validateDiscoverySequence(v.discovery as readonly unknown[]);
  if (!discoveryResult.ok) {
    errors.push(...discoveryResult.errors.map((e) => ({ ...e, path: `discovery.${e.path}` })));
  }
  // The derived run id must bind the compile context (reproducibility, L9).
  const derivedRunId = searchRunIdOf({
    goal: log.goal,
    constraints: log.constraints,
    budgets: log.budgets,
    registrySnapshot: log.registrySnapshot,
    seed: log.seed,
    compilerVersion: log.compilerVersion,
    requiredCapabilities: log.requiredCapabilities,
    gaps: log.discovery.flatMap((step) => (step.step === 'deficit-detected' ? [step.gap] : [])),
  });
  if (log.searchRunId !== derivedRunId) {
    errors.push({
      code: 'lineage_gap',
      path: 'searchRunId',
      message: `searchRunId "${log.searchRunId}" is not the derived id of the logged compile context ("${derivedRunId}") — the run id binds the inputs (L9)`,
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze({ ...log }) as SearchLog };
}

/**
 * Constructs a deeply frozen `OrganizationCandidate` from a draft,
 * validating structure first. Throws `TypeError` on invalid input.
 */
export function createOrganizationCandidate(draft: OrganizationCandidate): OrganizationCandidate {
  if (!isOrganizationCandidate(draft)) {
    throw new TypeError(
      'createOrganizationCandidate: draft failed the OrganizationCandidate guard (blueprint, measurements, objective, lineage, disposition, structured reasons)',
    );
  }
  return deepFreeze({ ...draft });
}

/**
 * APPEND — the only mutation the search log admits (L11: the candidate
 * sequence is append-only). Copy-on-write: returns a NEW deeply frozen
 * log; the input log is untouched. Typed rejections:
 * - `candidate_rewrite` — the candidate id already exists, or the
 *   sequence is not exactly `candidates.length + 1` (a gap would rewrite
 *   history);
 * - `lineage_gap` — the candidate's lineage disagrees with the log;
 * - `selection_mismatch` — appending a second `proposed` candidate.
 * Hiding or rewriting candidates has NO function — it is unrepresentable.
 */
export function appendOrganizationCandidate(
  log: SearchLog,
  candidate: OrganizationCandidate,
): OrgResult<SearchLog> {
  if (!isOrganizationCandidate(candidate)) {
    return { ok: false, errors: [invalidField('candidate', 'failed the OrganizationCandidate guard')] };
  }
  const expectedSequence = log.candidates.length + 1;
  if (candidate.sequence !== expectedSequence) {
    return fail(
      'candidate_rewrite',
      `appended candidate sequence ${candidate.sequence} is not the next contiguous sequence ${expectedSequence} — the candidate sequence is append-only; gaps rewrite history (L11)`,
      'candidate.sequence',
    );
  }
  if (log.candidates.some((existing) => existing.candidateId === candidate.candidateId)) {
    return fail(
      'candidate_rewrite',
      `candidate id "${candidate.candidateId}" already exists in the log — rewriting a candidate is a typed error (L11)`,
      'candidate.candidateId',
    );
  }
  if (
    candidate.lineage.goalRef !== log.goal.id ||
    candidate.lineage.goalVersion !== log.goal.version ||
    candidate.lineage.constraintSetRef !== log.constraints.id ||
    candidate.lineage.constraintSetVersion !== log.constraints.version ||
    candidate.lineage.registrySnapshotDigest !== log.registrySnapshot.digest ||
    candidate.lineage.seed !== log.seed ||
    candidate.lineage.compilerVersion !== log.compilerVersion ||
    candidate.lineage.tenantId !== log.tenantId ||
    candidate.lineage.projectId !== log.projectId
  ) {
    return fail(
      'lineage_gap',
      'appended candidate lineage disagrees with the log (goal/constraints/registry digest/seed/compiler version/tenant/project) (L9)',
      'candidate.lineage',
    );
  }
  if (candidate.lineage.parentCandidateId !== null) {
    const parentIndex = log.candidates.findIndex(
      (existing) => existing.candidateId === candidate.lineage.parentCandidateId,
    );
    if (parentIndex < 0) {
      return fail(
        'lineage_gap',
        `parent candidate "${candidate.lineage.parentCandidateId}" does not exist in the log (L9)`,
        'candidate.lineage.parentCandidateId',
      );
    }
  }
  const hasProposed = log.candidates.some((existing) => existing.disposition === 'proposed');
  if (hasProposed && candidate.disposition === 'proposed') {
    return fail(
      'selection_mismatch',
      'the log already declares a proposed candidate — a search proposes exactly one organization',
      'candidate.disposition',
    );
  }
  const selection =
    candidate.disposition === 'proposed'
      ? { selectedCandidateId: candidate.candidateId }
      : log.selection;
  return {
    ok: true,
    value: deepFreeze({
      ...log,
      candidates: [...log.candidates, candidate],
      selection,
    } satisfies SearchLog),
  };
}

/** Digest-of-digest helper: `true` when `d` is a well-formed 16-hex digest. */
export const isLogDigest = isDigest;
