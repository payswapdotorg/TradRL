// @tradrl/body-sentiment-researcher — identities and opaque references.
//
// Owning Work Order: T021.
//
// Identity discipline (mirroring @tradrl/skills/src/ids.ts):
// - OWNED identity spaces use the compact identifier pattern
//   (`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/`): SentimentReadingId,
//   EventDigestId, ResearchReportId, MethodId, MethodVersionRef.
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

/** Identity of a `SentimentReading` (`sr-<digest>` — derived, never random). */
export type SentimentReadingId = Brand<string, 'SentimentReadingId'>;

/** Identity of an `EventDigest` (`ed-<digest>` — derived, never random). */
export type EventDigestId = Brand<string, 'EventDigestId'>;

/** Identity of a `ResearchReport` (`rr-<digest>` — derived, never random). */
export type ResearchReportId = Brand<string, 'ResearchReportId'>;

/** Identity of a declared method record (e.g. `method/sentiment/aggregation`). */
export type MethodId = Brand<string, 'MethodId'>;

/** Version tag of a declared method record (strict `X.Y.Z`). */
export type MethodVersionRef = Brand<string, 'MethodVersionRef'>;

/** Guard: `SentimentReadingId`. */
export function isSentimentReadingId(v: unknown): v is SentimentReadingId {
  return isValidIdentifierString(v);
}

/** Guard: `EventDigestId`. */
export function isEventDigestId(v: unknown): v is EventDigestId {
  return isValidIdentifierString(v);
}

/** Guard: `ResearchReportId`. */
export function isResearchReportId(v: unknown): v is ResearchReportId {
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
export type ObservationId = string;

/** Guard: `ObservationId` (a canonical event id — non-empty string). */
export const isObservationId = (v: unknown): v is ObservationId => isNonEmptyString(v);

// ---------------------------------------------------------------------------
// Throwing constructors (owned spaces only)
// ---------------------------------------------------------------------------

/** Constructs a `SentimentReadingId`, throwing on invalid input. */
export function sentimentReadingId(value: string): SentimentReadingId {
  if (!isSentimentReadingId(value)) {
    throw new TypeError(
      `sentimentReadingId: invalid id ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as SentimentReadingId;
}

/** Constructs an `EventDigestId`, throwing on invalid input. */
export function eventDigestId(value: string): EventDigestId {
  if (!isEventDigestId(value)) {
    throw new TypeError(
      `eventDigestId: invalid id ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as EventDigestId;
}

/** Constructs a `ResearchReportId`, throwing on invalid input. */
export function researchReportId(value: string): ResearchReportId {
  if (!isResearchReportId(value)) {
    throw new TypeError(
      `researchReportId: invalid id ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as ResearchReportId;
}

/** Constructs a `MethodId`, throwing on invalid input. */
export function methodId(value: string): MethodId {
  if (!isMethodId(value)) {
    throw new TypeError(
      `methodId: invalid id ${JSON.stringify(value)} — must be a non-empty opaque reference`,
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
