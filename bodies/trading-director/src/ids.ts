// @tradrl/body-trading-director — identities and opaque references.
//
// Owning Work Order: T024.
//
// Identity discipline (mirroring @tradrl/skills and every research body):
// - OWNED identity spaces use the compact identifier pattern
//   (`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/`): DirectorDecisionId
//   (`dd-<digest>`), EscalationRecordId (`esc-<digest>`), MethodId,
//   MethodVersionRef.
// - MIRRORED cross-lane identities (TenantId, ProjectId, BodyVersionRef,
//   the four research report ids, AgentInstanceId, TopicName,
//   EvaluationCriteriaRef, EvidenceRef, SkillArtifactRef, ToolRef,
//   KnowledgeSourceRef, RiskPolicyRef) are opaque references minted by
//   their OWNING lanes (domain-core, the four research bodies T021-T023,
//   agent-body, skills, agent-os, evaluation, risk) — this package only
//   cites them (law D-003/D-004: structural mirrors, never imports).
// - GoalVersionRef and ConstraintSetVersionRef are STRUCTURAL MIRRORS of
//   @tradrl/trading-strategy's versioned pointers (T018, merged 0d4735e):
//   `{ goalId, version }` and `{ id, version }`. The director's decision
//   binds the SAME goal and constraint-set refs the strategy lane binds;
//   the interop trip wire in src/interop.test.ts proves mutual guard
//   acceptance against the REAL trading-strategy guards.
// - Research report ids are deliberately PLAIN citation strings: they are
//   the derived-id spaces owned by the research lanes (`rr-`/`frr-`/`cmrr-`
//   digests minted by THEIR factories); a director citation must carry any
//   of them verbatim, so only non-emptiness is enforced here.
//
// Spec anchors: L9 (reproducible lineage — decisions bind body version,
// synthesis method version, the four input report refs, goal and
// constraint-set refs), L12 (tenant isolation — TenantId + ProjectId on
// every record), L15 (project continuity — goal, research, decision,
// execution and outcome share lineage), L16a (no model identity as
// evidence).

import {
  type Brand,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isValidIdentifierString,
  isValidOpaqueRefString,
} from './primitives';

// ---------------------------------------------------------------------------
// Owned identity spaces
// ---------------------------------------------------------------------------

/** Identity of a `DirectorDecision` (`dd-<digest>` — derived, never random). */
export type DirectorDecisionId = Brand<string, 'DirectorDecisionId'>;

/** Identity of an `EscalationRecord` (`esc-<digest>` — derived, never random). */
export type EscalationRecordId = Brand<string, 'EscalationRecordId'>;

/** Identity of a declared method record (e.g. `method/director/synthesis`). */
export type MethodId = Brand<string, 'MethodId'>;

/** Version tag of a declared method record (strict `X.Y.Z`). */
export type MethodVersionRef = Brand<string, 'MethodVersionRef'>;

/** Guard: `DirectorDecisionId`. */
export function isDirectorDecisionId(v: unknown): v is DirectorDecisionId {
  return isValidIdentifierString(v);
}

/** Guard: `EscalationRecordId`. */
export function isEscalationRecordId(v: unknown): v is EscalationRecordId {
  return isValidIdentifierString(v);
}

/** Guard: `MethodId` (an opaque method reference — slashes allowed). */
export function isMethodId(v: unknown): v is MethodId {
  return isValidOpaqueRefString(v);
}

const METHOD_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Guard: `MethodVersionRef` (strict `X.Y.Z`, no prerelease/build). */
export function isMethodVersionRef(v: unknown): v is MethodVersionRef {
  return typeof v === 'string' && METHOD_VERSION_PATTERN.test(v);
}

// ---------------------------------------------------------------------------
// Mirrored cross-lane identities (opaque references — minted elsewhere)
// ---------------------------------------------------------------------------

/** Tenant scope (L12) — canonical owner: @tradrl/domain-core. */
export type TenantId = Brand<string, 'TenantId'>;

/** Project scope (L12) — canonical owner: @tradrl/domain-core. */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Guard: `TenantId`. */
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);

/** Guard: `ProjectId`. */
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);

/** Canonical body-version reference `${bodyId}@${semver}` — owner: @tradrl/agent-body. */
export type BodyVersionRef = Brand<string, 'BodyVersionRef'>;

const BODY_VERSION_REF_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Guard: a canonical `BodyVersionRef`. */
export const isBodyVersionRef = (v: unknown): v is BodyVersionRef =>
  typeof v === 'string' && BODY_VERSION_REF_PATTERN.test(v);

// --- The four research report citation spaces (owned by T021/T022/T023) ------

/** A sentiment-lane research report id (`rr-<digest>`) — minted by T021; cited here. */
export type SentimentReportId = Brand<string, 'SentimentReportId'>;

/** A regime-lane research report id (`rr-<digest>`) — minted by T022; cited here. */
export type RegimeReportId = Brand<string, 'RegimeReportId'>;

/** A fundamental-lane research report id (`frr-<digest>`) — minted by T023; cited here. */
export type FundamentalReportId = Brand<string, 'FundamentalReportId'>;

/** A cross-market-lane research report id (`cmrr-<digest>`) — minted by T023; cited here. */
export type CrossMarketReportId = Brand<string, 'CrossMarketReportId'>;

/** Guard: `SentimentReportId` (a derived research report id, cited verbatim). */
export const isSentimentReportId = (v: unknown): v is SentimentReportId =>
  isNonEmptyString(v);

/** Guard: `RegimeReportId` (a derived research report id, cited verbatim). */
export const isRegimeReportId = (v: unknown): v is RegimeReportId => isNonEmptyString(v);

/** Guard: `FundamentalReportId` (a derived research report id, cited verbatim). */
export const isFundamentalReportId = (v: unknown): v is FundamentalReportId =>
  isNonEmptyString(v);

/** Guard: `CrossMarketReportId` (a derived research report id, cited verbatim). */
export const isCrossMarketReportId = (v: unknown): v is CrossMarketReportId =>
  isNonEmptyString(v);

// --- The trading-strategy versioned pointers (mirrors of T018) --------------

/** A goal reference (opaque) — the goalId space of the goal version pointers. */
export type GoalRef = Brand<string, 'GoalRef'>;

/** Guard: `GoalRef` (opaque). */
export const isGoalRef = (v: unknown): v is GoalRef => isNonEmptyString(v);

/** Versioned pointer to a goal statement — mirror of @tradrl/trading-strategy's shape. */
export interface GoalVersionRef {
  readonly goalId: string;
  /** Integer >= 1; monotonically increasing per goalId. */
  readonly version: number;
}

/** Versioned pointer to a constraint set — mirror of @tradrl/trading-strategy's shape. */
export interface ConstraintSetVersionRef {
  readonly id: string;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
}

/** Guard: `GoalVersionRef` (structurally identical to the real T018 guard). */
export function isGoalVersionRef(v: unknown): v is GoalVersionRef {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.goalId) && isPositiveInteger(v.version);
}

/** Guard: `ConstraintSetVersionRef` (structurally identical to the real T018 guard). */
export function isConstraintSetVersionRef(v: unknown): v is ConstraintSetVersionRef {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.id) && isPositiveInteger(v.version);
}

// --- Other mirrored opaque references ----------------------------------------

/** Skill artifact reference — minted by @tradrl/skills (T017); cited here. */
export type SkillArtifactRef = Brand<string, 'SkillArtifactRef'>;

/** Tool reference — minted by the agent runtime lane; cited here. */
export type ToolRef = Brand<string, 'ToolRef'>;

/** Knowledge source reference — minted by the knowledge lane; cited here. */
export type KnowledgeSourceRef = Brand<string, 'KnowledgeSourceRef'>;

/** Evidence reference — minted by the verification lane; cited here. */
export type EvidenceRef = Brand<string, 'EvidenceRef'>;

/** Environment profile reference — minted by the environment lane; cited here. */
export type EnvironmentProfileRef = Brand<string, 'EnvironmentProfileRef'>;

/** Risk policy reference — minted by the risk lane (T020); cited here. */
export type RiskPolicyRef = Brand<string, 'RiskPolicyRef'>;

/** Agent instance identity — minted by @tradrl/agent-os (T006); cited here. */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;

/** Organization topic name — minted by @tradrl/agent-os (T006); cited here. */
export type TopicName = Brand<string, 'TopicName'>;

/** Acceptance-criteria reference — minted by @tradrl/evaluation (T012); cited here. */
export type EvaluationCriteriaRef = Brand<string, 'EvaluationCriteriaRef'>;

/** Guard: `SkillArtifactRef` (opaque ref). */
export const isSkillArtifactRef = (v: unknown): v is SkillArtifactRef => isValidOpaqueRefString(v);

/** Guard: `ToolRef` (opaque ref). */
export const isToolRef = (v: unknown): v is ToolRef => isValidOpaqueRefString(v);

/** Guard: `KnowledgeSourceRef` (opaque ref). */
export const isKnowledgeSourceRef = (v: unknown): v is KnowledgeSourceRef =>
  isValidOpaqueRefString(v);

/** Guard: `EvidenceRef` (opaque ref). */
export const isEvidenceRef = (v: unknown): v is EvidenceRef => isValidOpaqueRefString(v);

/** Guard: `EnvironmentProfileRef` (opaque ref). */
export const isEnvironmentProfileRef = (v: unknown): v is EnvironmentProfileRef =>
  isValidOpaqueRefString(v);

/** Guard: `RiskPolicyRef` (opaque ref). */
export const isRiskPolicyRef = (v: unknown): v is RiskPolicyRef => isValidOpaqueRefString(v);

/** Guard: `AgentInstanceId` (identifier pattern — agent-os mints these). */
export const isAgentInstanceId = (v: unknown): v is AgentInstanceId => isValidIdentifierString(v);

/** Guard: `TopicName` (identifier pattern — agent-os mints these). */
export const isTopicName = (v: unknown): v is TopicName => isValidIdentifierString(v);

/** Guard: `EvaluationCriteriaRef` (opaque ref). */
export const isEvaluationCriteriaRef = (v: unknown): v is EvaluationCriteriaRef =>
  isValidOpaqueRefString(v);

// ---------------------------------------------------------------------------
// Throwing constructors (owned spaces only)
// ---------------------------------------------------------------------------

/** Constructs a `DirectorDecisionId`, throwing on invalid input. */
export function directorDecisionId(value: string): DirectorDecisionId {
  if (!isDirectorDecisionId(value)) {
    throw new TypeError(
      `directorDecisionId: invalid id ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as DirectorDecisionId;
}

/** Constructs an `EscalationRecordId`, throwing on invalid input. */
export function escalationRecordId(value: string): EscalationRecordId {
  if (!isEscalationRecordId(value)) {
    throw new TypeError(
      `escalationRecordId: invalid id ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as EscalationRecordId;
}

/** Constructs a `MethodId`, throwing on invalid input. */
export function methodId(value: string): MethodId {
  if (!isMethodId(value)) {
    throw new TypeError(
      `methodId: invalid id ${JSON.stringify(value)} — must be a non-empty opaque method reference`,
    );
  }
  return value as MethodId;
}

/** Constructs a `MethodVersionRef`, throwing on invalid input. */
export function methodVersionRef(value: string): MethodVersionRef {
  if (!isMethodVersionRef(value)) {
    throw new TypeError(
      `methodVersionRef: invalid version ${JSON.stringify(value)} — expected strict X.Y.Z`,
    );
  }
  return value as MethodVersionRef;
}

/** Constructs a `TenantId`, throwing on invalid input. */
export function tenantId(value: string): TenantId {
  if (!isTenantId(value)) {
    throw new TypeError(`tenantId: invalid tenant identity ${JSON.stringify(value)}`);
  }
  return value as TenantId;
}

/** Constructs a `ProjectId`, throwing on invalid input. */
export function projectId(value: string): ProjectId {
  if (!isProjectId(value)) {
    throw new TypeError(`projectId: invalid project identity ${JSON.stringify(value)}`);
  }
  return value as ProjectId;
}

/** Constructs a canonical `BodyVersionRef`, throwing on invalid input. */
export function bodyVersionRef(value: string): BodyVersionRef {
  if (!isBodyVersionRef(value)) {
    throw new TypeError(
      `bodyVersionRef: invalid canonical body-version reference ${JSON.stringify(value)} — expected ${'${bodyId}@${semver}'}`,
    );
  }
  return value as BodyVersionRef;
}
