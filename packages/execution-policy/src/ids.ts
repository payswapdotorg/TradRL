// @tradrl/execution-policy — branded identity references.
//
// Id discipline (mirroring @tradrl/trading-strategy and
// @tradrl/rl-protocol):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T019) are listed first: the
//   execution-policy identity space (policy id + version), the decision
//   identity (content-addressed from the decision's canonical content),
//   the kill-switch identity spaces (switch id + record id), the audit
//   record identity, the simulated-fill identity and the simulation-spec
//   identity.
// - The remaining OPAQUE cross-lane references mirror their owners' EXACT
//   brand tags the same way the sibling contract packages do:
//   GoalRef/ProjectId/TenantId mirror @tradrl/control-domain (T007);
//   StrategySpecId/StrategyVersionRef mirror @tradrl/trading-strategy
//   (T018 — the strategy lane whose intents this gate consumes);
//   InstrumentId/VenueId mirror @tradrl/domain-core via
//   @tradrl/exchange-sim (T002/T010); RiskPolicyRef mirrors
//   trading-strategy's reservation for the T020 risk engine (the intent
//   arrives carrying refs the T020 lane refines — this lane records
//   them, never resolves them);
//   TrialId/ArmId/TrajectoryId mirror @tradrl/rl-protocol (T013 —
//   execution policies can be LEARNED; a policy may bind its learning
//   lineage); Seed mirrors environment-protocol's opaque seed token;
//   CredentialRef and AuthorityScopeRef are THIS lane's opaque
//   references into the control-plane's grant registry and the secrets
//   lane (T044 owns values; T040 binds venues). This package never
//   imports those packages — it only reserves the reference types here
//   (D-003/D-004; the interop test is the drift trip wire).

import { Brand, isDigest, isNonEmptyString, isPositiveSafeInteger, isRecord } from './primitives';

// --- Ids owned by execution-policy (T019) ------------------------------------

/** Identity of an execution policy record: identity is `(policyId, version)`. */
export type ExecutionPolicyId = Brand<string, 'ExecutionPolicyId'>;

/** Identity of one gate decision (content-addressed — see check-machine.ts minting). */
export type DecisionId = Brand<string, 'DecisionId'>;

/** Identity of the standing kill-switch log a policy enforces (one per tenant/project scope). */
export type KillSwitchId = Brand<string, 'KillSwitchId'>;

/** Identity of one append-only kill-switch record. */
export type KillSwitchRecordId = Brand<string, 'KillSwitchRecordId'>;

/** Identity of one audit record in the append-only trail. */
export type AuditRecordId = Brand<string, 'AuditRecordId'>;

/** Identity of one simulated fill (ordinal-minted — see simulation.ts). */
export type SimulatedFillId = Brand<string, 'SimulatedFillId'>;

/** Identity of one execution simulation spec record. */
export type SimulationSpecId = Brand<string, 'SimulationSpecId'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

/** Opaque reference to a goal record (referent contract owned by T002/T007). */
export type GoalRef = Brand<string, 'GoalRef'>;

/** Project continuity root (L15). Shared identity space with T002/T007. */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Tenant scope — the isolation root (L12). Shared program-wide identity space. */
export type TenantId = Brand<string, 'TenantId'>;

/** Strategy spec identity (T018 owns the referent). Mirror of trading-strategy's brand. */
export type StrategySpecId = Brand<string, 'StrategySpecId'>;

/** Portfolio-state identity (T018 owns the content-addressed referent). Mirror of trading-strategy's brand. */
export type PortfolioStateId = Brand<string, 'PortfolioStateId'>;

/** Instrument reference (T002/T004 market lanes). Mirror of the domain-core brand. */
export type InstrumentId = Brand<string, 'InstrumentId'>;

/** Venue reference (T002/T004 market lanes). Mirror of the domain-core brand. */
export type VenueId = Brand<string, 'VenueId'>;

/** Opaque reference to a constraint-set record (referent contract owned by T002/T007). Mirror of trading-strategy's brand. */
export type ConstraintSetRef = Brand<string, 'ConstraintSetRef'>;

/** Opaque reference to a risk-policy record (T020 owns the engine). Mirror of trading-strategy's reservation. */
export type RiskPolicyRef = Brand<string, 'RiskPolicyRef'>;

/** Trial identity — mirror of @tradrl/rl-protocol (T013; the learned-policy binding). */
export type TrialId = Brand<string, 'TrialId'>;

/** Comparison-arm identity — mirror of @tradrl/rl-protocol (T013). */
export type ArmId = Brand<string, 'ArmId'>;

/** Trajectory identity — mirror of @tradrl/rl-protocol (T013). */
export type TrajectoryId = Brand<string, 'TrajectoryId'>;

/**
 * Opaque reference to a credential record. The referent VALUE lives in
 * the secrets lane (T044) and venue binding is T040 — this lane carries
 * ONLY the reference (the credential-opacity law; see credentials.ts).
 */
export type CredentialRef = Brand<string, 'CredentialRef'>;

/**
 * Opaque reference to a control-plane authority-grant record (T007 owns
 * the grant registry). The policy declares which grants it acts under;
 * the referent is never resolved here.
 */
export type AuthorityScopeRef = Brand<string, 'AuthorityScopeRef'>;

/** The deterministic seed of an execution simulation. Opaque token; mirrors environment-protocol's Seed tag. */
export type Seed = Brand<string, 'EnvironmentSeed'>;

// --- Versioned pointers (lineage carriers, L9/L15) ---------------------------

/**
 * Versioned pointer to an execution policy: identity is
 * `(policyId, version)`. Policies are immutable; a revision is a NEW
 * VERSION under the same id (mirroring the goal/constraint-set/strategy
 * versioning discipline).
 */
export interface PolicyVersionRef {
  readonly policyId: ExecutionPolicyId;
  /** Integer >= 1; monotonically increasing per policyId. */
  readonly version: number;
}

/** Versioned pointer to a goal statement (mirror of control-domain's shape). */
export interface GoalVersionRef {
  readonly goalId: GoalRef;
  /** Integer >= 1; monotonically increasing per goalId. */
  readonly version: number;
}

/** Versioned pointer to a constraint set (mirror of control-domain's / trading-strategy's shape). */
export interface ConstraintSetVersionRef {
  readonly id: ConstraintSetRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
}

/** Versioned pointer to a strategy spec (mirror of trading-strategy's shape). */
export interface StrategyVersionRef {
  readonly specId: StrategySpecId;
  /** Integer >= 1; monotonically increasing per specId. */
  readonly version: number;
}

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time (see interop.test.ts for the shared-space tags).

export const isExecutionPolicyId = (v: unknown): v is ExecutionPolicyId => isNonEmptyString(v);
export const isDecisionId = (v: unknown): v is DecisionId => isNonEmptyString(v) && v.startsWith('xd:');
export const isKillSwitchId = (v: unknown): v is KillSwitchId => isNonEmptyString(v) && v.startsWith('ksw:');
export const isKillSwitchRecordId = (v: unknown): v is KillSwitchRecordId => isNonEmptyString(v) && v.startsWith('ksr:');
export const isAuditRecordId = (v: unknown): v is AuditRecordId => isNonEmptyString(v) && v.startsWith('xa:');
export const isSimulatedFillId = (v: unknown): v is SimulatedFillId => isNonEmptyString(v) && v.startsWith('xsf-');
export const isSimulationSpecId = (v: unknown): v is SimulationSpecId => isNonEmptyString(v) && v.startsWith('xsim:');

export const isGoalRef = (v: unknown): v is GoalRef => isNonEmptyString(v);
export const isConstraintSetRef = (v: unknown): v is ConstraintSetRef => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isStrategySpecId = (v: unknown): v is StrategySpecId => isNonEmptyString(v);
export const isPortfolioStateId = (v: unknown): v is PortfolioStateId => isNonEmptyString(v) && v.startsWith('ps:');
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
export const isRiskPolicyRef = (v: unknown): v is RiskPolicyRef => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
export const isTrajectoryId = (v: unknown): v is TrajectoryId => isNonEmptyString(v);
export const isCredentialRef = (v: unknown): v is CredentialRef => isNonEmptyString(v) && v.startsWith('cred:');
export const isAuthorityScopeRef = (v: unknown): v is AuthorityScopeRef => isNonEmptyString(v) && v.startsWith('grant:');
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);

export function isPolicyVersionRef(v: unknown): v is PolicyVersionRef {
  if (!isRecord(v)) return false;
  return isExecutionPolicyId(v.policyId) && isPositiveSafeInteger(v.version);
}

export function isGoalVersionRef(v: unknown): v is GoalVersionRef {
  if (!isRecord(v)) return false;
  return isGoalRef(v.goalId) && isPositiveSafeInteger(v.version);
}

export function isConstraintSetVersionRef(v: unknown): v is ConstraintSetVersionRef {
  if (!isRecord(v)) return false;
  return isConstraintSetRef(v.id) && isPositiveSafeInteger(v.version);
}

export function isStrategyVersionRef(v: unknown): v is StrategyVersionRef {
  if (!isRecord(v)) return false;
  return isStrategySpecId(v.specId) && isPositiveSafeInteger(v.version);
}

// --- Deterministic id minting (content-addressed derived identities) ----------

/**
 * Mint the policy id from the policy's content digest: `xpol:` + the
 * 8-hex digest. Pure and deterministic — the same declared content
 * always yields the same id (L9).
 */
export function mintExecutionPolicyId(digest: string): ExecutionPolicyId {
  if (!isDigest(digest)) throw new Error(`mintExecutionPolicyId: invalid digest ${JSON.stringify(digest)}`);
  return `xpol:${digest}` as ExecutionPolicyId;
}

/** Mint a decision id from the decision's content digest: `xd:` + digest. Pure and deterministic (L9). */
export function mintDecisionId(digest: string): DecisionId {
  if (!isDigest(digest)) throw new Error(`mintDecisionId: invalid digest ${JSON.stringify(digest)}`);
  return `xd:${digest}` as DecisionId;
}

/** Mint a kill-switch id from the genesis content digest: `ksw:` + digest. Pure and deterministic (L9). */
export function mintKillSwitchId(digest: string): KillSwitchId {
  if (!isDigest(digest)) throw new Error(`mintKillSwitchId: invalid digest ${JSON.stringify(digest)}`);
  return `ksw:${digest}` as KillSwitchId;
}

/** Mint a kill-switch record id from the record's content digest: `ksr:` + digest. Pure and deterministic (L9). */
export function mintKillSwitchRecordId(digest: string): KillSwitchRecordId {
  if (!isDigest(digest)) throw new Error(`mintKillSwitchRecordId: invalid digest ${JSON.stringify(digest)}`);
  return `ksr:${digest}` as KillSwitchRecordId;
}

/** Mint an audit record id from the record's content digest: `xa:` + digest. Pure and deterministic (L9). */
export function mintAuditRecordId(digest: string): AuditRecordId {
  if (!isDigest(digest)) throw new Error(`mintAuditRecordId: invalid digest ${JSON.stringify(digest)}`);
  return `xa:${digest}` as AuditRecordId;
}

/** Mint a simulated-fill id from a fill ordinal: `xsf-` + zero-padded 8-digit ordinal (the exchange-sim minting law, mirrored). */
export function mintSimulatedFillId(ordinal: number): SimulatedFillId {
  if (!isPositiveSafeInteger(ordinal)) throw new Error(`mintSimulatedFillId: invalid ordinal ${String(ordinal)}`);
  return `xsf-${String(ordinal).padStart(8, '0')}` as SimulatedFillId;
}

/** Mint a simulation-spec id from the spec's content digest: `xsim:` + digest. Pure and deterministic (L9). */
export function mintSimulationSpecId(digest: string): SimulationSpecId {
  if (!isDigest(digest)) throw new Error(`mintSimulationSpecId: invalid digest ${JSON.stringify(digest)}`);
  return `xsim:${digest}` as SimulationSpecId;
}
