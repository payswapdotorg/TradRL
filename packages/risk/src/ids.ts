// @tradrl/risk — branded identity references.
//
// Id discipline (mirroring @tradrl/execution-policy and
// @tradrl/trading-strategy — D-003/D-004):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T020) are listed first: the risk-policy
//   identity space (content-addressed id + version), the opaque
//   risk-figure ref (L7 — risk-adjusted figures travel as refs, never
//   naked numbers), the exposure-record identity, the limit-evaluation
//   identity, the risk-measure identity and the risk-audit record
//   identity.
// - The remaining OPAQUE cross-lane references mirror their owners' EXACT
//   brand tags: GoalRef/ProjectId/TenantId/ConstraintSetRef mirror
//   @tradrl/control-domain (T007); StrategyVersionRef mirrors
//   @tradrl/trading-strategy (T018 — the lane whose intents carry
//   risk-policy refs THIS engine resolves); PortfolioStateId/
//   InstrumentId/VenueId mirror trading-strategy via execution-policy
//   (T018/T019); RiskPolicyRef IS the reservation trading-strategy and
//   execution-policy declare for THIS lane (the `riskPolicyRefs` an
//   intent carries resolve HERE — the interop test proves the shared
//   brand tags). This package never imports those packages — it only
//   reserves the reference types here (D-003/D-004; the interop test is
//   the drift trip wire).

import { Brand, isDigest, isNonEmptyString, isPositiveSafeInteger, isRecord } from './primitives';

// --- Ids owned by risk (T020) --------------------------------------------------

/** Mirror of execution-policy's KillSwitchId (the switch log's identity space — T019 owns the referent). */
export type KillSwitchId = Brand<string, 'KillSwitchId'>;

/** Guard: a kill-switch id (`ksw:`-prefixed — the mirrored law). */
export const isKillSwitchId = (v: unknown): v is KillSwitchId => isNonEmptyString(v) && v.startsWith('ksw:');

/** Mirror of execution-policy's KillSwitchRecordId (one append-only switch record's identity). */
export type KillSwitchRecordId = Brand<string, 'KillSwitchRecordId'>;

/** Mirror of exchange-sim's FillId (one execution report's identity — T010 owns the referent). */
export type FillId = Brand<string, 'FillId'>;

/** Mirror of exchange-sim's ExchangeOrderId (the venue-assigned order identity — T010 owns the referent). */
export type ExchangeOrderId = Brand<string, 'ExchangeOrderId'>;

/**
 * Identity of a risk policy record. Content-addressed: `rpol:` + the
 * digest of the canonical declaration content (identity is
 * `(policyId, version)`; a revision is a NEW VERSION under the L11
 * evolution trail).
 */
export type RiskPolicyId = Brand<string, 'RiskPolicyId'>;

/**
 * The OPAQUE reference a strategy intent carries in its
 * `riskPolicyRefs` array — the ref THIS engine resolves. Textual form:
 * `risk-policy:<policyId>@<version>` (parseable by
 * {@link parseRiskPolicyRef}; mintable from a policy by
 * {@link riskPolicyRefOf}). The brand tag matches trading-strategy's
 * and execution-policy's `RiskPolicyRef` reservation exactly — one
 * program-wide identity space, zero casts (the interop test proves it).
 */
export type RiskPolicyRef = Brand<string, 'RiskPolicyRef'>;

/**
 * The OPAQUE reference a risk-adjusted figure travels as (L7): `rfig:`
 * + the digest of `{ method, methodVersion, value }`. The VALUE lives
 * behind the ref and is resolvable only through the declared minting
 * inputs — a risk figure is never a naked number pretending to be an
 * acceptance verdict.
 */
export type RiskFigureRef = Brand<string, 'RiskFigureRef'>;

/** Identity of one exposure record (content-addressed from its measures). */
export type ExposureRecordId = Brand<string, 'ExposureRecordId'>;

/** Identity of one limit-evaluation record (content-addressed from its states). */
export type LimitEvaluationId = Brand<string, 'LimitEvaluationId'>;

/** Identity of one risk-measure record (content-addressed from its content). */
export type RiskMeasureId = Brand<string, 'RiskMeasureId'>;

/** Identity of one append-only risk-audit record. */
export type RiskAuditRecordId = Brand<string, 'RiskAuditRecordId'>;

/** Identity of the market-state record the engine measures against. */
export type MarketStateId = Brand<string, 'MarketStateId'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

/** Opaque reference to a goal record (referent contract owned by T002/T007). */
export type GoalRef = Brand<string, 'GoalRef'>;

/** Project continuity root (L15). Shared identity space with T002/T007. */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Tenant scope — the isolation root (L12). Shared program-wide identity space. */
export type TenantId = Brand<string, 'TenantId'>;

/** Opaque reference to a constraint-set record (referent contract owned by T002/T007). Mirror of trading-strategy's brand. */
export type ConstraintSetRef = Brand<string, 'ConstraintSetRef'>;

/** Strategy spec identity (T018 owns the referent). Mirror of trading-strategy's brand. */
export type StrategySpecId = Brand<string, 'StrategySpecId'>;

/** Portfolio-state identity (T018 owns the content-addressed referent). Mirror of trading-strategy's brand. */
export type PortfolioStateId = Brand<string, 'PortfolioStateId'>;

/** Instrument reference (T002/T003/T004 market lanes). Mirror of the domain-core brand. */
export type InstrumentId = Brand<string, 'InstrumentId'>;

/** Venue reference (T002/T003/T004 market lanes). Mirror of the domain-core brand. */
export type VenueId = Brand<string, 'VenueId'>;

/** The deterministic seed of the run the risk records belong to. Mirrors environment-protocol's Seed tag. */
export type Seed = Brand<string, 'EnvironmentSeed'>;

// --- Versioned pointers (lineage carriers, L9/L15) ---------------------------

/**
 * Versioned pointer to a risk policy: identity is `(policyId, version)`.
 * Policies are immutable; a revision is a NEW VERSION (the L11 trail
 * retains the superseded ones).
 */
export interface RiskPolicyVersionRef {
  readonly policyId: RiskPolicyId;
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

export const isRiskPolicyId = (v: unknown): v is RiskPolicyId => isNonEmptyString(v) && v.startsWith('rpol:');
export const isRiskPolicyRef = (v: unknown): v is RiskPolicyRef => isNonEmptyString(v) && v.startsWith('risk-policy:');
export const isRiskFigureRef = (v: unknown): v is RiskFigureRef => isNonEmptyString(v) && v.startsWith('rfig:');
export const isExposureRecordId = (v: unknown): v is ExposureRecordId => isNonEmptyString(v) && v.startsWith('exp:');
export const isLimitEvaluationId = (v: unknown): v is LimitEvaluationId => isNonEmptyString(v) && v.startsWith('rls:');
export const isRiskMeasureId = (v: unknown): v is RiskMeasureId => isNonEmptyString(v) && v.startsWith('rmr:');
export const isRiskAuditRecordId = (v: unknown): v is RiskAuditRecordId => isNonEmptyString(v) && v.startsWith('xra:');
export const isMarketStateId = (v: unknown): v is MarketStateId => isNonEmptyString(v) && v.startsWith('rms:');

export const isGoalRef = (v: unknown): v is GoalRef => isNonEmptyString(v);
export const isConstraintSetRef = (v: unknown): v is ConstraintSetRef => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isStrategySpecId = (v: unknown): v is StrategySpecId => isNonEmptyString(v);
export const isPortfolioStateId = (v: unknown): v is PortfolioStateId => isNonEmptyString(v) && v.startsWith('ps:');
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);

export function isRiskPolicyVersionRef(v: unknown): v is RiskPolicyVersionRef {
  if (!isRecord(v)) return false;
  return isRiskPolicyId(v.policyId) && isPositiveSafeInteger(v.version);
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

/** Mint the risk-policy id from the policy's content digest: `rpol:` + the 8-hex digest. Pure and deterministic (L9). */
export function mintRiskPolicyId(digest: string): RiskPolicyId {
  if (!isDigest(digest)) throw new Error(`mintRiskPolicyId: invalid digest ${JSON.stringify(digest)}`);
  return `rpol:${digest}` as RiskPolicyId;
}

/** Mint the risk-figure ref from the figure's identity inputs: `rfig:` + digest. Pure and deterministic (L9). */
export function mintRiskFigureRef(digest: string): RiskFigureRef {
  if (!isDigest(digest)) throw new Error(`mintRiskFigureRef: invalid digest ${JSON.stringify(digest)}`);
  return `rfig:${digest}` as RiskFigureRef;
}

/** Mint an exposure-record id from the record's content digest: `exp:` + digest. Pure and deterministic (L9). */
export function mintExposureRecordId(digest: string): ExposureRecordId {
  if (!isDigest(digest)) throw new Error(`mintExposureRecordId: invalid digest ${JSON.stringify(digest)}`);
  return `exp:${digest}` as ExposureRecordId;
}

/** Mint a limit-evaluation id from the evaluation's content digest: `rls:` + digest. Pure and deterministic (L9). */
export function mintLimitEvaluationId(digest: string): LimitEvaluationId {
  if (!isDigest(digest)) throw new Error(`mintLimitEvaluationId: invalid digest ${JSON.stringify(digest)}`);
  return `rls:${digest}` as LimitEvaluationId;
}

/** Mint a risk-measure id from the measure's content digest: `rmr:` + digest. Pure and deterministic (L9). */
export function mintRiskMeasureId(digest: string): RiskMeasureId {
  if (!isDigest(digest)) throw new Error(`mintRiskMeasureId: invalid digest ${JSON.stringify(digest)}`);
  return `rmr:${digest}` as RiskMeasureId;
}

/** Mint a risk-audit record id from the record's content digest: `xra:` + digest. Pure and deterministic (L9). */
export function mintRiskAuditRecordId(digest: string): RiskAuditRecordId {
  if (!isDigest(digest)) throw new Error(`mintRiskAuditRecordId: invalid digest ${JSON.stringify(digest)}`);
  return `xra:${digest}` as RiskAuditRecordId;
}

/** Mint a market-state id from the state's content digest: `rms:` + digest. Pure and deterministic (L9). */
export function mintMarketStateId(digest: string): MarketStateId {
  if (!isDigest(digest)) throw new Error(`mintMarketStateId: invalid digest ${JSON.stringify(digest)}`);
  return `rms:${digest}` as MarketStateId;
}

// --- The intent-ref resolution (what the strategy lane's refs RESOLVE to) ------

/**
 * Mint the OPAQUE ref a strategy intent carries for one risk policy
 * version: `risk-policy:<policyId>@<version>`. Pure and deterministic —
 * the same policy version always yields the same ref (L9). This is the
 * `RiskPolicyRef` identity space trading-strategy declares on its
 * intents; THIS lane owns the referent.
 */
export function riskPolicyRefOf(policy: RiskPolicyVersionRef): RiskPolicyRef {
  if (!isRiskPolicyVersionRef(policy)) throw new Error(`riskPolicyRefOf: invalid policy version ref ${JSON.stringify(policy)}`);
  return `risk-policy:${policy.policyId}@${policy.version}` as RiskPolicyRef;
}

/**
 * Parse an opaque risk-policy ref back into its `(policyId, version)`
 * referent; `null` when the value does not carry the canonical
 * `risk-policy:<rpol:...>@<version>` form. Total: never throws, rejects
 * any malformed input.
 */
export function parseRiskPolicyRef(v: unknown): RiskPolicyVersionRef | null {
  if (!isNonEmptyString(v)) return null;
  const match = /^risk-policy:(rpol:[0-9a-f]{8})@([1-9]\d*)$/.exec(v);
  if (match === null) return null;
  const version = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(version) || version < 1) return null;
  return { policyId: match[1] as RiskPolicyId, version };
}
