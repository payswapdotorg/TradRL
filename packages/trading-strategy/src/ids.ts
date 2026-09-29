// @tradrl/trading-strategy — branded identity references.
//
// Id discipline (mirroring @tradrl/control-domain, @tradrl/organization
// and @tradrl/rl-protocol):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T018) are listed first: the strategy-spec
//   identity space (spec id + version), the compiled-run identity
//   (content-addressed from the run's input lineage), the portfolio-state
//   identity (content-addressed from the state's canonical content) and
//   the backtest-trail identities (run + candidate).
// - The remaining OPAQUE cross-lane references mirror their owners' EXACT
//   brand tags the same way the sibling contract packages do:
//   GoalRef/ConstraintSetRef/ProjectId/TenantId/OrganizationRef mirror
//   @tradrl/control-domain (T007 — the strategy serves the goal and its
//   constraint set; the brand tags also match @tradrl/organization's
//   declarations, so one program-wide identity space per lane);
//   InstrumentId/VenueId mirror @tradrl/domain-core via
//   @tradrl/exchange-sim; RiskPolicyRef/AttainmentEvidenceRef mirror
//   @tradrl/organization's reservations for the T020 risk engine and the
//   T012 evaluation lane; TrialId/ArmId/TrajectoryId mirror
//   @tradrl/rl-protocol (T013 — strategies can be LEARNED; backtest
//   candidates bind into its trial/lineage shapes); Seed mirrors
//   environment-protocol's opaque seed token. This package never imports
//   those packages — it only reserves the reference types here
//   (D-003/D-004; the interop test is the drift trip wire).

import { Brand, isDigest, isNonEmptyString, isPositiveInteger, isRecord } from './primitives';

// --- Ids owned by trading-strategy (T018) ------------------------------------

/** Identity of a strategy spec record: identity is `(id, version)`. */
export type StrategySpecId = Brand<string, 'StrategySpecId'>;

/** Identity of one compiled strategy run (content-addressed — see run.ts). */
export type StrategyRunId = Brand<string, 'StrategyRunId'>;

/** Identity of one portfolio-state snapshot (content-addressed — see portfolio.ts). */
export type PortfolioStateId = Brand<string, 'PortfolioStateId'>;

/** Identity of one backtest trail (append-only candidate log — see backtest.ts). */
export type BacktestRunId = Brand<string, 'BacktestRunId'>;

/** Identity of one candidate entry within a backtest trail. */
export type BacktestCandidateId = Brand<string, 'BacktestCandidateId'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

/** Opaque reference to a goal record (referent contract owned by T002/T007). */
export type GoalRef = Brand<string, 'GoalRef'>;

/** Opaque reference to a constraint-set record (referent contract owned by T002/T007). */
export type ConstraintSetRef = Brand<string, 'ConstraintSetRef'>;

/** Project continuity root (L15). Shared identity space with T002/T007. */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Tenant scope — the isolation root (L12). Shared program-wide identity space. */
export type TenantId = Brand<string, 'TenantId'>;

/** Opaque reference to a compiled organization (referent owned by T016). */
export type OrganizationRef = Brand<string, 'OrganizationRef'>;

/** Opaque reference to a blueprint assignment entry of that organization (T016). */
export type BlueprintAssignmentRef = Brand<string, 'BlueprintAssignmentRef'>;

/** Instrument reference (T002/T004 market lanes). Mirror of the domain-core brand. */
export type InstrumentId = Brand<string, 'InstrumentId'>;

/** Venue reference (T002/T004 market lanes). Mirror of the domain-core brand. */
export type VenueId = Brand<string, 'VenueId'>;

/** Opaque reference to a risk-policy record (T020 owns the engine). Mirror of organization's reservation. */
export type RiskPolicyRef = Brand<string, 'RiskPolicyRef'>;

/** Opaque reference to an attainment-evidence record (T012 owns scoring). Mirror of organization's reservation. */
export type AttainmentEvidenceRef = Brand<string, 'AttainmentEvidenceRef'>;

/** Trial identity — mirror of @tradrl/rl-protocol (T013; the learned-strategy binding). */
export type TrialId = Brand<string, 'TrialId'>;

/** Comparison-arm identity — mirror of @tradrl/rl-protocol (T013). */
export type ArmId = Brand<string, 'ArmId'>;

/** Trajectory identity — mirror of @tradrl/rl-protocol (T013). */
export type TrajectoryId = Brand<string, 'TrajectoryId'>;

/** The deterministic seed of a strategy run. Opaque token; mirrors environment-protocol's Seed tag. */
export type Seed = Brand<string, 'EnvironmentSeed'>;

// --- Versioned pointers (lineage carriers, L9/L15) ---------------------------

/**
 * Versioned pointer to a strategy spec: identity is `(specId, version)`.
 * Specs are immutable; a revision is a NEW VERSION under the same id
 * (mirroring the goal/constraint-set versioning discipline).
 */
export interface StrategyVersionRef {
  readonly specId: StrategySpecId;
  /** Integer >= 1; monotonically increasing per specId. */
  readonly version: number;
}

/** Versioned pointer to a goal statement (mirror of control-domain's shape). */
export interface GoalVersionRef {
  readonly goalId: GoalRef;
  /** Integer >= 1; monotonically increasing per goalId. */
  readonly version: number;
}

/** Versioned pointer to a constraint set (mirror of control-domain's shape). */
export interface ConstraintSetVersionRef {
  readonly id: ConstraintSetRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
}

// --- Guards -------------------------------------------------------------------

// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (see interop.test.ts for the shared-space tags).

export const isStrategySpecId = (v: unknown): v is StrategySpecId => isNonEmptyString(v);
export const isStrategyRunId = (v: unknown): v is StrategyRunId =>
  isNonEmptyString(v) && v.startsWith('strat:');
export const isPortfolioStateId = (v: unknown): v is PortfolioStateId =>
  isNonEmptyString(v) && v.startsWith('ps:');
export const isBacktestRunId = (v: unknown): v is BacktestRunId =>
  isNonEmptyString(v) && v.startsWith('bt:');
export const isBacktestCandidateId = (v: unknown): v is BacktestCandidateId =>
  isNonEmptyString(v) && v.startsWith('btc:');

export const isGoalRef = (v: unknown): v is GoalRef => isNonEmptyString(v);
export const isConstraintSetRef = (v: unknown): v is ConstraintSetRef => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isOrganizationRef = (v: unknown): v is OrganizationRef => isNonEmptyString(v);
export const isBlueprintAssignmentRef = (v: unknown): v is BlueprintAssignmentRef => isNonEmptyString(v);
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
export const isRiskPolicyRef = (v: unknown): v is RiskPolicyRef => isNonEmptyString(v);
export const isAttainmentEvidenceRef = (v: unknown): v is AttainmentEvidenceRef => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
export const isTrajectoryId = (v: unknown): v is TrajectoryId => isNonEmptyString(v);
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);

export function isStrategyVersionRef(v: unknown): v is StrategyVersionRef {
  if (!isRecord(v)) return false;
  return isStrategySpecId(v.specId) && isPositiveInteger(v.version);
}

export function isGoalVersionRef(v: unknown): v is GoalVersionRef {
  if (!isRecord(v)) return false;
  return isGoalRef(v.goalId) && isPositiveInteger(v.version);
}

export function isConstraintSetVersionRef(v: unknown): v is ConstraintSetVersionRef {
  if (!isRecord(v)) return false;
  return isConstraintSetRef(v.id) && isPositiveInteger(v.version);
}

// --- Deterministic id minting (content-addressed derived identities) ----------

/**
 * Mint the compiled-run id from the run's input digest:
 * `strat:` + the 8-hex digest. Pure and deterministic — the same input
 * lineage always yields the same id (L9), and equal digests mean equal
 * inputs (canonical-JSON injectivity over the run's declared inputs).
 */
export function mintStrategyRunId(digest: string): StrategyRunId {
  if (!isDigest(digest)) throw new Error(`mintStrategyRunId: invalid digest ${JSON.stringify(digest)}`);
  return `strat:${digest}` as StrategyRunId;
}

/** Mint the portfolio-state id from the state's content digest: `ps:` + digest. Pure and deterministic (L9). */
export function mintPortfolioStateId(digest: string): PortfolioStateId {
  if (!isDigest(digest)) throw new Error(`mintPortfolioStateId: invalid digest ${JSON.stringify(digest)}`);
  return `ps:${digest}` as PortfolioStateId;
}

/** Mint the backtest-run id from the trail's input digest: `bt:` + digest. Pure and deterministic (L9). */
export function mintBacktestRunId(digest: string): BacktestRunId {
  if (!isDigest(digest)) throw new Error(`mintBacktestRunId: invalid digest ${JSON.stringify(digest)}`);
  return `bt:${digest}` as BacktestRunId;
}

/** Mint a backtest-candidate id: `btc:` + digest. Pure and deterministic (L9). */
export function mintBacktestCandidateId(digest: string): BacktestCandidateId {
  if (!isDigest(digest)) throw new Error(`mintBacktestCandidateId: invalid digest ${JSON.stringify(digest)}`);
  return `btc:${digest}` as BacktestCandidateId;
}
