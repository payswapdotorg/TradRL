// @tradrl/web-console — the primary flow (UX.md, verbatim): "User
// specifies goal, constraints, capital/risk budget, markets/venues,
// horizon, data, execution mode and optional preferences, then
// launches."
//
// THE LAW (Work Order T042): "The launch composes the API's
// project/goal/job submission routes (async submitted->running->
// complete pattern with progress rendering)." The draft is validated
// LOCALLY (typed InvalidLaunchDraftError, dotted paths) BEFORE any
// API call; the budgets are EXACT DECIMAL STRINGS (never floats);
// and the composed submission is: POST /v1/projects (the goal +
// constraint set, budgets as blocking outcome constraints) followed
// by POST /v1/jobs/research (the kickoff job whose spec carries the
// full launch context — the job machinery owns its semantics).
//
// Spec anchors: R1 (goals and structured constraints), R36, R39
// (async jobs/progress), the exact-decimal law.

import type {
  ConstraintSetStatement,
  ConstraintStatement,
  ExecutionMode,
  GoalStatement,
  JobStatus,
  ProjectGoalWorldSpec,
  SuccessCriterion,
} from '../api/contracts';
import { InvalidLaunchDraftError } from './errors';
import { isNonNegativeDecimal } from './decimals';

/** The launch wizard's steps (the primary flow's own order). */
export const LAUNCH_STEPS = ['goal', 'budget', 'markets', 'world', 'review'] as const;

/** One launch wizard step. */
export type LaunchStep = (typeof LAUNCH_STEPS)[number];

/** The launch phases. */
export type LaunchPhase = 'idle' | 'draft' | 'launching' | 'launched' | 'failed';

/** One progress point of a tracked job (the async pattern's observed states, at the observed instants). */
export interface JobProgressPoint {
  readonly status: JobStatus;
  readonly at: number;
}

/** The launch flow's state (a slice of the workspace state). */
export interface LaunchState {
  readonly phase: LaunchPhase;
  readonly draft: LaunchDraft | null;
  readonly step: LaunchStep;
  readonly projectId: string | null;
  readonly jobId: string | null;
  readonly progress: readonly JobProgressPoint[];
  readonly error: string | null;
}

/** The initial launch state. */
export function initialLaunchState(): LaunchState {
  return { phase: 'idle', draft: null, step: 'goal', projectId: null, jobId: null, progress: [], error: null };
}

/** One optional preference (a closed key/value pair — the UX charter's "optional preferences"). */
export interface LaunchPreference {
  readonly key: string;
  readonly value: string;
}

/** THE LAUNCH DRAFT — UX.md's primary-flow inputs, typed end to end. */
export interface LaunchDraft {
  /** The project's display name. */
  readonly name: string;
  /** The objective statement. */
  readonly objective: string;
  /** The horizon (epoch ms bounds + optional label). */
  readonly horizon: { readonly startsAt: number; readonly endsAt: number; readonly label?: string };
  /** The structured success criteria (the goal's acceptance discipline). */
  readonly successCriteria: readonly SuccessCriterion[];
  /** The evaluation discipline (blind/walk-forward/regime refs + the adversarial requirement). */
  readonly evaluation: { readonly blindRef: string; readonly walkForwardRef: string; readonly regimeRef: string; readonly adversarialRequired: boolean };
  /** The executable constraints (UX.md's "constraints"). */
  readonly constraints: readonly ConstraintStatement[];
  /** The capital budget — an EXACT decimal string. */
  readonly capitalBudget: string;
  /** The risk budget — an EXACT decimal string. */
  readonly riskBudget: string;
  /** The markets (e.g. instrument ids). */
  readonly markets: readonly string[];
  /** The venues. */
  readonly venues: readonly string[];
  /** The data sources. */
  readonly dataSources: readonly string[];
  /** The execution mode. */
  readonly executionMode: ExecutionMode;
  /** The optional preferences. */
  readonly preferences: readonly LaunchPreference[];
}

/** The program-wide metric/subject address space (the boundary's identifier-path grammar, mirrored). */
const IDENTIFIER_PATH_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/;

/** Guard: a dot-separated identifier path. */
export function isIdentifierPath(value: string): boolean {
  return IDENTIFIER_PATH_PATTERN.test(value);
}

/**
 * Validate a launch draft — the typed gate before any API call.
 * Every violation throws InvalidLaunchDraftError with the dotted
 * path (the render layer surfaces them inline, never as a wrong
 * submission).
 */
export function validateLaunchDraft(draft: LaunchDraft): void {
  if (typeof draft.name !== 'string' || draft.name.trim().length === 0) throw new InvalidLaunchDraftError('name', 'the project name is required');
  if (typeof draft.objective !== 'string' || draft.objective.trim().length === 0) throw new InvalidLaunchDraftError('objective', 'the objective statement is required');
  if (!Number.isInteger(draft.horizon.startsAt) || !Number.isInteger(draft.horizon.endsAt) || draft.horizon.startsAt >= draft.horizon.endsAt) {
    throw new InvalidLaunchDraftError('horizon', 'the horizon must be integer epoch-ms bounds with startsAt before endsAt');
  }
  if (draft.successCriteria.length === 0) throw new InvalidLaunchDraftError('successCriteria', 'at least one success criterion is required');
  for (const criterion of draft.successCriteria) {
    if (typeof criterion.id !== 'string' || criterion.id.length === 0) throw new InvalidLaunchDraftError('successCriteria', 'every criterion needs an id');
    if (!isIdentifierPath(criterion.metric)) throw new InvalidLaunchDraftError(`successCriteria.${criterion.id}.metric`, `the metric must be a dot-separated identifier path (got ${JSON.stringify(criterion.metric)})`);
    if (typeof criterion.predicate !== 'object' || criterion.predicate === null || typeof criterion.predicate.kind !== 'string') {
      throw new InvalidLaunchDraftError(`successCriteria.${criterion.id}.predicate`, 'every criterion needs a typed predicate');
    }
  }
  for (const constraint of draft.constraints) {
    if (typeof constraint.id !== 'string' || constraint.id.length === 0) throw new InvalidLaunchDraftError('constraints', 'every constraint needs an id');
    if (!isIdentifierPath(constraint.subject)) throw new InvalidLaunchDraftError(`constraints.${constraint.id}.subject`, `the subject must be a dot-separated identifier path (got ${JSON.stringify(constraint.subject)})`);
  }
  if (!isNonNegativeDecimal(draft.capitalBudget)) throw new InvalidLaunchDraftError('capitalBudget', `the capital budget must be an exact non-negative decimal string (got ${JSON.stringify(draft.capitalBudget)})`);
  if (!isNonNegativeDecimal(draft.riskBudget)) throw new InvalidLaunchDraftError('riskBudget', `the risk budget must be an exact non-negative decimal string (got ${JSON.stringify(draft.riskBudget)})`);
  if (draft.markets.length === 0) throw new InvalidLaunchDraftError('markets', 'at least one market is required');
  if (draft.venues.length === 0) throw new InvalidLaunchDraftError('venues', 'at least one venue is required');
  if (draft.dataSources.length === 0) throw new InvalidLaunchDraftError('dataSources', 'at least one data source is required');
  if (draft.executionMode !== 'simulation' && draft.executionMode !== 'shadow' && draft.executionMode !== 'live') {
    throw new InvalidLaunchDraftError('executionMode', `the execution mode must be simulation | shadow | live (got ${JSON.stringify(draft.executionMode)})`);
  }
  for (const preference of draft.preferences) {
    if (typeof preference.key !== 'string' || preference.key.length === 0) throw new InvalidLaunchDraftError('preferences', 'every preference needs a key');
  }
}

/** The ids the composition mints for the boundary's create route (deterministic derivations over the draft). */
export interface LaunchIds {
  readonly projectId: string;
  readonly goalId: string;
  readonly constraintSetId: string;
}

/**
 * Build the POST /v1/projects body from a validated draft (the goal +
 * the constraint set, budgets as blocking outcome constraints). The
 * goal's and the constraint set's declared tenants MUST be the
 * workspace's tenant — the boundary enforces it (L12 at the routing
 * layer) and so does the console before the call.
 */
export function toCreateProjectInput(draft: LaunchDraft, ids: LaunchIds, tenantId: string, at: number): {
  readonly id: string;
  readonly name: string;
  readonly executionMode: string;
  readonly goal: GoalStatement;
  readonly constraintSet: ConstraintSetStatement;
  readonly at: number;
} {
  validateLaunchDraft(draft);
  if (tenantId.length === 0) throw new InvalidLaunchDraftError('tenantId', 'the workspace tenant is required to compose the create-project request');
  const goal: GoalStatement = {
    id: ids.goalId,
    version: 1,
    tenantId,
    objective: draft.objective,
    horizon: draft.horizon,
    successCriteria: { criteria: draft.successCriteria, requiredSatisfaction: draft.successCriteria.length === 1 ? 1 : (draft.successCriteria.length - 1) / draft.successCriteria.length },
    evaluation: draft.evaluation,
    createdAt: at,
  };
  const budgetConstraints: readonly ConstraintStatement[] = [
    { id: 'k-capital-budget', domain: 'outcome', subject: 'capital.budget', predicate: { kind: 'equals', value: draft.capitalBudget }, severity: 'blocking' },
    { id: 'k-risk-budget', domain: 'outcome', subject: 'risk.budget', predicate: { kind: 'equals', value: draft.riskBudget }, severity: 'blocking' },
  ];
  const constraintSet: ConstraintSetStatement = {
    id: ids.constraintSetId,
    version: 1,
    tenantId,
    constraints: [...draft.constraints, ...budgetConstraints],
    createdAt: at,
  };
  return { id: ids.projectId, name: draft.name, executionMode: draft.executionMode, goal, constraintSet, at };
}

/** Build the kickoff research job's spec from a validated draft (the job machinery owns its semantics; the console passes the launch context through). */
export function toLaunchJobSpec(draft: LaunchDraft): Record<string, unknown> {
  validateLaunchDraft(draft);
  return {
    kind: 'console-launch',
    objective: draft.objective,
    horizon: draft.horizon,
    capitalBudget: draft.capitalBudget,
    riskBudget: draft.riskBudget,
    markets: [...draft.markets],
    venues: [...draft.venues],
    dataSources: [...draft.dataSources],
    executionMode: draft.executionMode,
    preferences: draft.preferences.map((preference) => ({ key: preference.key, value: preference.value })),
  };
}

/**
 * Build the launch's WORLD SPECIFICATION from a validated draft (D-8,
 * W-28): the market-world fields the wizard's markets/world steps
 * collected, in the host goal route's additive `world` shape. This is
 * what the kickoff job's spec carries to the backing (the world rides
 * `toLaunchJobSpec` — the opaque spec is the only console->host carrier
 * the frozen contracts leave room for), what the backing persists into
 * the goal-set record's payload, and what the host goal route serves
 * back so the Market World section renders the PERSISTED world after a
 * reload, a scope switch or a cold start — the in-session draft was the
 * section's ONLY source before (D-8's defect).
 */
export function toLaunchWorldSpec(draft: LaunchDraft): ProjectGoalWorldSpec {
  validateLaunchDraft(draft);
  return {
    markets: [...draft.markets],
    venues: [...draft.venues],
    dataSources: [...draft.dataSources],
    executionMode: draft.executionMode,
    capitalBudget: draft.capitalBudget,
    riskBudget: draft.riskBudget,
    horizon: draft.horizon.label === undefined
      ? { startsAt: draft.horizon.startsAt, endsAt: draft.horizon.endsAt }
      : { startsAt: draft.horizon.startsAt, endsAt: draft.horizon.endsAt, label: draft.horizon.label },
  };
}

/** The typed progress view of a tracked job (pure arithmetic over the observed instants — never a wall clock). */
export interface JobProgressView {
  readonly phase: JobStatus;
  readonly lastObservedAt: number;
  readonly submittedAt: number | null;
  readonly completedAt: number | null;
  /** The elapsed ms between submission and completion (null while pending) — exact integer arithmetic. */
  readonly elapsedMs: number | null;
  readonly observations: readonly JobProgressPoint[];
}

/** Render the progress of a tracked job from its observed progress points (the async pattern's rendering law). */
export function renderJobProgress(points: readonly JobProgressPoint[]): JobProgressView | null {
  if (points.length === 0) return null;
  const ordered = [...points].sort((a, b) => a.at - b.at);
  const first = ordered[0] as JobProgressPoint;
  const last = ordered[ordered.length - 1] as JobProgressPoint;
  const submitted = ordered.find((point) => point.status === 'submitted');
  const completed = ordered.find((point) => point.status === 'complete' || point.status === 'failed');
  const submittedAt = submitted === undefined ? null : submitted.at;
  const completedAt = completed === undefined ? null : completed.at;
  return {
    phase: last.status,
    lastObservedAt: last.at,
    submittedAt,
    completedAt,
    elapsedMs: submittedAt !== null && completedAt !== null ? completedAt - submittedAt : null,
    observations: Object.freeze(ordered),
  };
}

/**
 * D-17 (W-29): the elapsed of a job RECORD — completedAt minus submittedAt,
 * exact integer arithmetic, derived from the record's OWN timestamps and
 * NOTHING else. This is the root-cause fix for the "elapsed: pending" the
 * personas and the Lead kept meeting on COMPLETE jobs with BOTH timestamps
 * present (L2's seed job:57d1815d; the Lead's fresh kickoff job:1f7a71dc):
 * the job dialog's elapsed came from renderJobProgress over the SESSION's
 * observation points, which (a) exist only for the CURRENT launch's own
 * tracked job, and (b) die at every reload — so every other job (and every
 * reloaded session) rendered 'pending' while its record carried the truth.
 * The record is the boundary's own stamp — it outranks any observation
 * collection. Null while genuinely incomplete (no completedAt on the
 * record); a corrupt completedAt BEFORE the submittedAt renders null too
 * (never a fabricated negative elapsed).
 */
export function elapsedMsOfJobRecord(job: { readonly submittedAt: number; readonly completedAt?: number }): number | null {
  if (typeof job.completedAt !== 'number' || !Number.isInteger(job.completedAt)) return null;
  if (job.completedAt < job.submittedAt) return null; // a corrupt record renders pending, never a negative duration
  return job.completedAt - job.submittedAt;
}
