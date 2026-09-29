// @tradrl/body-regime-researcher — identities and opaque references.
//
// Owning Work Order: T022.
//
// Identity discipline (mirroring @tradrl/skills/src/ids.ts and the
// sentiment-researcher body package — the established research-body
// pattern):
// - OWNED identity spaces use the compact identifier pattern
//   (`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/`): RegimeClassificationId,
//   RegimeChangeId, RegimeResearchReportId, RegimeMethodId,
//   RegimeMethodVersionRef.
// - MIRRORED cross-lane identities (TenantId, ProjectId, BodyVersionRef,
//   SkillArtifactRef, ToolRef, KnowledgeSourceRef, GoalRef, EvidenceRef,
//   EnvironmentProfileRef, RiskPolicyRef, AgentInstanceId, TopicName,
//   EvaluationCriteriaRef) are opaque string references minted by their
//   OWNING lanes (domain-core, agent-body, skills, agent-os, evaluation) —
//   this package only cites them (law D-003/D-004: structural mirrors,
//   never imports). Brand tags match the owning lanes' string-keyed brands
//   so the interop trip wires can prove mutual assignability.
// - Observation ids are deliberately PLAIN strings: they are the
//   `event_id` space owned by the market-protocol/provenance lanes
//   (plain unbranded non-empty strings there), and a research citation
//   must be able to carry any canonical event id verbatim.
//
// Spec anchors: L9 (reproducible lineage — outputs bind body version,
// method version, evidence refs), L12 (tenant isolation — TenantId +
// ProjectId on every record), L16a (no model identity as evidence).

import {
  type Brand,
  isNonEmptyString,
  isValidIdentifierString,
  isValidOpaqueRefString,
} from './primitives';

// ---------------------------------------------------------------------------
// Owned identity spaces
// ---------------------------------------------------------------------------

/** Identity of a `RegimeClassification` (`rc-<digest>` — derived, never random). */
export type RegimeClassificationId = Brand<string, 'RegimeClassificationId'>;

/** Identity of a `RegimeChange` (`rx-<digest>` — derived, never random). */
export type RegimeChangeId = Brand<string, 'RegimeChangeId'>;

/** Identity of a `RegimeResearchReport` (`rr-<digest>` — derived, never random). */
export type RegimeResearchReportId = Brand<string, 'RegimeResearchReportId'>;

/** Identity of a declared method record (e.g. `method/regime/classification`). */
export type RegimeMethodId = Brand<string, 'RegimeMethodId'>;

/** Version tag of a declared method record (strict `X.Y.Z`). */
export type RegimeMethodVersionRef = Brand<string, 'RegimeMethodVersionRef'>;

/** Guard: `RegimeClassificationId`. */
export function isRegimeClassificationId(v: unknown): v is RegimeClassificationId {
  return isValidIdentifierString(v);
}

/** Guard: `RegimeChangeId`. */
export function isRegimeChangeId(v: unknown): v is RegimeChangeId {
  return isValidIdentifierString(v);
}

/** Guard: `RegimeResearchReportId`. */
export function isRegimeResearchReportId(v: unknown): v is RegimeResearchReportId {
  return isValidIdentifierString(v);
}

/** Guard: `RegimeMethodId` (an opaque method reference — slashes allowed). */
export function isRegimeMethodId(v: unknown): v is RegimeMethodId {
  return isValidOpaqueRefString(v);
}

const METHOD_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Guard: `RegimeMethodVersionRef` (strict `X.Y.Z`, no prerelease/build). */
export function isRegimeMethodVersionRef(v: unknown): v is RegimeMethodVersionRef {
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

/** Skill artifact reference — minted by @tradrl/skills (T017); cited here. */
export type SkillArtifactRef = Brand<string, 'SkillArtifactRef'>;

/** Tool reference — minted by the agent runtime lane; cited here. */
export type ToolRef = Brand<string, 'ToolRef'>;

/** Knowledge source reference — minted by the knowledge lane; cited here. */
export type KnowledgeSourceRef = Brand<string, 'KnowledgeSourceRef'>;

/** Goal reference — minted by @tradrl/domain-core; cited here. */
export type GoalRef = Brand<string, 'GoalRef'>;

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

/** Guard: `GoalRef` (opaque ref). */
export const isGoalRef = (v: unknown): v is GoalRef => isValidOpaqueRefString(v);

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
// Observation identity (canonical event id space — plain strings)
// ---------------------------------------------------------------------------

/**
 * The identity of an ingested observation: the canonical `event_id` space
 * owned by the market-protocol/provenance lanes (deliberately PLAIN
 * unbranded non-empty strings there — `EventId = string`). Research
 * citations carry these verbatim so any canonical event id resolves.
 */
export type MarketObservationId = string;

/** Guard: `MarketObservationId` (a canonical event id — non-empty string). */
export const isMarketObservationId = (v: unknown): v is MarketObservationId => isNonEmptyString(v);

// ---------------------------------------------------------------------------
// Throwing constructors (owned spaces only)
// ---------------------------------------------------------------------------

/** Constructs a `RegimeClassificationId`, throwing on invalid input. */
export function regimeClassificationId(value: string): RegimeClassificationId {
  if (!isRegimeClassificationId(value)) {
    throw new TypeError(
      `regimeClassificationId: invalid id ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as RegimeClassificationId;
}

/** Constructs a `RegimeChangeId`, throwing on invalid input. */
export function regimeChangeId(value: string): RegimeChangeId {
  if (!isRegimeChangeId(value)) {
    throw new TypeError(
      `regimeChangeId: invalid id ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as RegimeChangeId;
}

/** Constructs a `RegimeResearchReportId`, throwing on invalid input. */
export function regimeResearchReportId(value: string): RegimeResearchReportId {
  if (!isRegimeResearchReportId(value)) {
    throw new TypeError(
      `regimeResearchReportId: invalid id ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as RegimeResearchReportId;
}

/** Constructs a `RegimeMethodId`, throwing on invalid input. */
export function regimeMethodId(value: string): RegimeMethodId {
  if (!isRegimeMethodId(value)) {
    throw new TypeError(
      `regimeMethodId: invalid id ${JSON.stringify(value)} — must be a non-empty opaque method reference`,
    );
  }
  return value as RegimeMethodId;
}

/** Constructs a `RegimeMethodVersionRef`, throwing on invalid input. */
export function regimeMethodVersionRef(value: string): RegimeMethodVersionRef {
  if (!isRegimeMethodVersionRef(value)) {
    throw new TypeError(
      `regimeMethodVersionRef: invalid version ${JSON.stringify(value)} — expected strict X.Y.Z`,
    );
  }
  return value as RegimeMethodVersionRef;
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
