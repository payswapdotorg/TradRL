/**
 * @tradrl/organization — the CompilerContract and the deterministic
 * search entry point.
 *
 * Spec anchors: spec/ARCHITECTURE.md, "Organization compiler", VERBATIM:
 * "Given goals, constraints, market/data universe and resource budgets,
 * discover agent count, specializations, body/model assignments,
 * communication topology, training allocation, cadence and adversarial
 * population." And spec/LEARNING-LOOP.md, "Organization learning":
 * "Search over agent count, specializations, bodies, models,
 * communication topology, training allocation, decision cadence and
 * adversarial population."
 *
 * THE CONTRACT (CompilerContract): a compiler implementation declares its
 * version and its aggregation strategy and exposes ONE pure function
 * `compile(input) -> OrgResult<SearchLog>`. The package-level
 * {@link compileOrganization} is the ENFORCEMENT POINT: it validates the
 * compile input against the typed laws (tenant coherence, seeded search,
 * registry snapshot full law, budget sanity), dispatches to the compiler,
 * and validates the produced log against the FULL search-integrity law
 * (L11 append-only, L9 lineage, selection, discovery ordering) — ANY
 * implementation, including the reference compiler in
 * services/organization-compiler, gets its output checked here.
 *
 * Determinism law: same (goal, constraints, budgets, registry snapshot,
 * seed, compiler version) -> byte-identical candidate log. The search is
 * a pure function; there is NO ambient randomness (seeded generators
 * only) and NO ambient clock (`Date.now()` never appears — every instant
 * is an explicit parameter, and the search itself is timeless).
 */

import {
  type CapabilityKey,
  type CompilerVersionRef,
  type ProjectId,
  type SearchSeed,
  type TenantId,
  isArrayOf,
  isCapabilityKey,
  isProjectId,
  isRecord,
  isTenantId,
} from './primitives';
import { type OrgError, type OrgResult, invalidField, invalidType } from './errors';
import type { CompileBudgets } from './budgets';
import { isCompileBudgets, validateCompileBudgets } from './budgets';
import type { GoalStatementMirror, ConstraintSetStatementMirror } from './control-mirror';
import { isConstraintSetStatementMirror, isGoalStatementMirror } from './control-mirror';
import type { RegistrySnapshotMirror } from './capability-mirror';
import { validateRegistrySnapshotMirror } from './capability-mirror';
import type { CapabilityGap } from './gap';
import { isCapabilityGap } from './gap';
import type { AggregationStrategy } from './objective';
import { isAggregationStrategy } from './objective';
import type { SearchLog } from './candidate';
import { validateSearchLog } from './candidate';

// ---------------------------------------------------------------------------
// The compile input
// ---------------------------------------------------------------------------

/**
 * The compile input — everything the deterministic search consumes
 * (goal mirror, constraint-set mirror, budgets, registry snapshot, seed,
 * compiler version) plus the DECLARED demand side: the required
 * capability contracts (characterized upstream per CAPABILITY-DISCOVERY
 * step 2 — "Characterize the required capability contract") and the
 * typed capability gaps that make the search failure-driven when present
 * (step 1 — "Detect capability deficit from task/project evidence").
 * Tenant and project scope per L12.
 */
export interface CompileInput {
  /** The goal the organization is compiled for (control-plane mirror). */
  readonly goal: GoalStatementMirror;
  /** The constraint set the organization is compiled under (control-plane mirror). */
  readonly constraints: ConstraintSetStatementMirror;
  /** The resource budgets and search bounds. */
  readonly budgets: CompileBudgets;
  /** The registry snapshot the search runs over (the measured-evidence base, L16a). */
  readonly registrySnapshot: RegistrySnapshotMirror;
  /** The required capability contracts (the demand; characterized upstream). */
  readonly requiredCapabilities: readonly CapabilityKey[];
  /** Typed capability gaps (failure-driven input; may be empty). */
  readonly gaps: readonly CapabilityGap[];
  /** The search seed — the ONLY randomness input (the determinism law). */
  readonly seed: SearchSeed;
  /** The compiler version that will run (must equal the compiler's own version). */
  readonly compilerVersion: CompilerVersionRef;
  /** The compile tenant scope (L12) — must match goal and constraints. */
  readonly tenantId: TenantId;
  /** The compile project scope (L12). */
  readonly projectId: ProjectId;
}

/**
 * Validates a compile input against the typed laws (collect-all):
 * - structural validity of every member;
 * - `tenant_mismatch` — goal, constraint set and compile scope must share
 *   one tenant (L12);
 * - `unseeded_search` — the seed must be present (no ambient randomness);
 * - the registry snapshot's FULL law (L16a `label_as_evidence`,
 *   `registry_digest_mismatch`);
 * - budget sanity: `maxAgents` must admit the demand (at least one agent
 *   per required capability), and `maxEnumeratedCandidates` must be >= 1.
 */
export function validateCompileInput(v: unknown): OrgResult<CompileInput> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType('compile input must be an object')] };
  }
  const errors: OrgError[] = [];
  if (!isGoalStatementMirror(v.goal)) {
    errors.push(invalidField('goal', 'invalid GoalStatementMirror (control-plane mirror)'));
  }
  if (!isConstraintSetStatementMirror(v.constraints)) {
    errors.push(invalidField('constraints', 'invalid ConstraintSetStatementMirror'));
  }
  if (!isCompileBudgets(v.budgets)) {
    errors.push(invalidField('budgets', 'invalid CompileBudgets'));
  } else {
    const budgetResult = validateCompileBudgets(v.budgets);
    if (!budgetResult.ok) errors.push(...budgetResult.errors);
  }
  if (typeof v.seed !== 'string' || v.seed.trim().length === 0) {
    errors.push({
      code: 'unseeded_search',
      path: 'seed',
      message: 'the search must be seeded — there is no ambient randomness; a search without a seed cannot run (the determinism law)',
    });
  }
  if (typeof v.compilerVersion !== 'string' || v.compilerVersion.trim().length === 0) {
    errors.push(invalidField('compilerVersion', 'invalid CompilerVersionRef'));
  }
  if (!isTenantId(v.tenantId)) errors.push(invalidField('tenantId', 'invalid TenantId (L12)'));
  if (!isProjectId(v.projectId)) errors.push(invalidField('projectId', 'invalid ProjectId (L12)'));
  if (!Array.isArray(v.requiredCapabilities) || v.requiredCapabilities.length === 0) {
    errors.push(invalidField('requiredCapabilities', 'must be a non-empty array of capability contracts (the demand)'));
  } else if (!isArrayOf(v.requiredCapabilities, isCapabilityKey)) {
    errors.push(invalidField('requiredCapabilities', 'every entry must be a valid CapabilityKey'));
  } else if (new Set(v.requiredCapabilities).size !== v.requiredCapabilities.length) {
    errors.push(invalidField('requiredCapabilities', 'capability keys must be unique'));
  }
  if (!Array.isArray(v.gaps)) {
    errors.push(invalidField('gaps', 'must be an array of typed CapabilityGaps (may be empty)'));
  } else if (!v.gaps.every((gap) => isCapabilityGap(gap))) {
    errors.push(invalidField('gaps', 'every entry must be a valid CapabilityGap'));
  }
  if (errors.length > 0) return { ok: false, errors };

  const input = v as unknown as CompileInput;
  if (input.goal.tenantId !== input.constraints.tenantId || input.goal.tenantId !== input.tenantId) {
    return {
      ok: false,
      errors: [
        {
          code: 'tenant_mismatch',
          path: 'tenantId',
          message: `goal tenant "${input.goal.tenantId}", constraint-set tenant "${input.constraints.tenantId}" and compile tenant "${input.tenantId}" must be ONE tenant (L12)`,
        },
      ],
    };
  }
  const snapshotResult = validateRegistrySnapshotMirror(input.registrySnapshot);
  if (!snapshotResult.ok) {
    return {
      ok: false,
      errors: snapshotResult.errors.map((e) => ({ ...e, path: `registrySnapshot.${e.path}` })),
    };
  }
  if (input.budgets.maxAgents < input.requiredCapabilities.length) {
    return {
      ok: false,
      errors: [
        invalidField(
          'budgets.maxAgents',
          `the demand requires at least ${input.requiredCapabilities.length} agent slot(s) (one per required capability) but maxAgents is ${input.budgets.maxAgents}`,
        ),
      ],
    };
  }
  return { ok: true, value: deepFreezeInput(input) };
}

function deepFreezeInput(input: CompileInput): CompileInput {
  // Shallow-structured freeze: every member is already validated and the
  // nested records are frozen by their own validators/constructors; the
  // input itself is frozen here.
  return Object.freeze({ ...input }) as CompileInput;
}

// ---------------------------------------------------------------------------
// The compiler contract
// ---------------------------------------------------------------------------

/**
 * The organization compiler contract. An implementation (the reference
 * compiler lives in services/organization-compiler) declares:
 * - `compilerVersion` — the version string that enters every candidate's
 *   lineage (L9); it MUST equal the compile input's version;
 * - `strategy` — the declared, versioned aggregation strategy (the
 *   objective model — no hidden weights);
 * - `compile` — ONE pure function from validated compile input to
 *   `OrgResult<SearchLog>`. Purity is part of the contract: same input,
 *   byte-identical log; no ambient randomness (seeded generators only),
 *   no ambient clock, no I/O.
 */
export interface CompilerContract {
  /** The compiler's version identity (lineage participant, L9). */
  readonly compilerVersion: CompilerVersionRef;
  /** The declared objective model this compiler aggregates with. */
  readonly strategy: AggregationStrategy;
  /** The deterministic search: validated input -> append-only candidate log. */
  readonly compile: (input: CompileInput) => OrgResult<SearchLog>;
}

/**
 * Guard: `CompilerContract` (structural — the function member is checked
 * for callability only; the CONTRACT LAWS are enforced by
 * {@link compileOrganization} on every invocation).
 */
export function isCompilerContract(v: unknown): v is CompilerContract {
  if (!isRecord(v)) return false;
  if (typeof v.compilerVersion !== 'string' || v.compilerVersion.trim().length === 0) return false;
  if (!isAggregationStrategy(v.strategy)) return false;
  return typeof v.compile === 'function';
}

// ---------------------------------------------------------------------------
// compileOrganization — the package-level deterministic search entry
// ---------------------------------------------------------------------------

/**
 * Runs the deterministic organization search under the FULL contract law:
 *
 * 1. Validates the compile input (typed errors: `tenant_mismatch`,
 *    `unseeded_search`, `label_as_evidence`, `registry_digest_mismatch`,
 *    budget sanity, structural violations).
 * 2. Checks the compiler contract (version agreement with the input —
 *    lineage coherence; strategy validity).
 * 3. Dispatches to `compiler.compile` (the pure strategy).
 * 4. Validates the produced log against the FULL search-integrity law
 *    (`candidate_rewrite`, `lineage_gap`, `selection_mismatch`, discovery
 *    ordering, derived run id binding).
 *
 * Pure given a pure compiler: same (goal, constraints, budgets, registry
 * snapshot, seed, compiler version) -> byte-identical candidate log.
 */
export function compileOrganization(
  input: unknown,
  compiler: CompilerContract,
): OrgResult<SearchLog> {
  if (!isCompilerContract(compiler)) {
    return { ok: false, errors: [invalidType('compiler must satisfy the CompilerContract')] };
  }
  const inputResult = validateCompileInput(input);
  if (!inputResult.ok) return inputResult;
  const validated = inputResult.value;
  if (validated.compilerVersion !== compiler.compilerVersion) {
    return {
      ok: false,
      errors: [
        invalidField(
          'compilerVersion',
          `the compile input pins compiler version "${validated.compilerVersion}" but the compiler declares "${compiler.compilerVersion}" — lineage coherence (L9)`,
        ),
      ],
    };
  }
  const log = compiler.compile(validated);
  if (!isRecord(log) || (log as { ok?: unknown }).ok !== true) {
    // The contract's own typed failure flows through unchanged.
    if (
      isRecord(log) &&
      (log as { ok?: unknown }).ok === false &&
      Array.isArray((log as { errors?: unknown }).errors) &&
      ((log as { errors: readonly unknown[] }).errors as readonly unknown[]).length > 0
    ) {
      return log as OrgResult<SearchLog>;
    }
    return {
      ok: false,
      errors: [
        invalidType('compiler.compile must return an OrgResult<SearchLog> — a non-result is a contract violation'),
      ],
    };
  }
  const value = (log as { value: unknown }).value;
  const logResult = validateSearchLog(value);
  if (!logResult.ok) return logResult;
  return { ok: true, value: logResult.value };
}
