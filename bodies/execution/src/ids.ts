// @tradrl/body-execution — identities and opaque references.
//
// Owning Work Order: T025.
//
// Identity discipline (mirroring @tradrl/skills/src/ids.ts and the body
// packages):
// - OWNED identity spaces use the compact identifier pattern
//   (`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/`): OrderLifecycleId,
//   EscalationRecordId, ReconciliationRecordId, GatewayRequestRef,
//   MethodId, MethodVersionRef, OrderRef. The derived ids are
//   content-addressed (`ol-`/`esc-`/`rcn-`/`gwr-` + digest) — never
//   random.
// - MIRRORED cross-lane identities (TenantId, ProjectId, BodyVersionRef,
//   SkillArtifactRef, ToolRef, KnowledgeSourceRef, EvidenceRef,
//   EnvironmentProfileRef, RiskPolicyRef, AgentInstanceId, TopicName,
//   EvaluationCriteriaRef) are opaque string references minted by their
//   OWNING lanes — this package only cites them (law D-003/D-004:
//   structural mirrors, never imports). Brand tags match the owning
//   lanes' string-keyed brands so the interop trip wires can prove
//   mutual assignability.
// - ORDER-LANE identities (the execution-policy / strategy-lane /
//   director-lane / venue-lane refs this body consumes) are cited as
//   OPAQUE PREFIX-GUARDED strings — the owning lanes' exact prefix laws
//   (`xd:` decisions, `si:` intents, `dd-` director decisions, `ksw:`
//   switches, `xsf-` fills), re-declared here as thin guards so this
//   body can cite them verbatim while never importing their packages.
//
// Spec anchors: L9 (reproducible lineage — outputs bind body version,
// method version, decision refs), L12 (tenant isolation — TenantId +
// ProjectId on every record), L15 (project continuity — decision,
// execution and outcome share lineage: the director decision ref is
// carried forward), L16a (no model identity as evidence).

import {
  type Brand,
  isNonEmptyString,
  isValidIdentifierString,
  isValidOpaqueRefString,
} from './primitives';

// ---------------------------------------------------------------------------
// Owned identity spaces
// ---------------------------------------------------------------------------

/** Identity of a `OrderLifecycleRecord` (`ol-<digest>` — derived, never random). */
export type OrderLifecycleId = Brand<string, 'OrderLifecycleId'>;

/** Identity of an `EscalationRecord` (`esc-<digest>` — derived, never random). */
export type EscalationRecordId = Brand<string, 'EscalationRecordId'>;

/** Identity of a `ReconciliationRecord` (`rcn-<digest>` — derived, never random). */
export type ReconciliationRecordId = Brand<string, 'ReconciliationRecordId'>;

/** Identity of a gateway request record (`gwr-<digest>` — derived, never random). */
export type GatewayRequestRef = Brand<string, 'GatewayRequestRef'>;

/** The order identity this package manages (the clientOrderId space — opaque to this lane). */
export type OrderRef = Brand<string, 'OrderRef'>;

/** Identity of a declared method record (e.g. `method/execution/order-preparation`). */
export type MethodId = Brand<string, 'MethodId'>;

/** Version tag of a declared method record (strict `X.Y.Z`). */
export type MethodVersionRef = Brand<string, 'MethodVersionRef'>;

/** Guard: `OrderLifecycleId`. */
export function isOrderLifecycleId(v: unknown): v is OrderLifecycleId {
  return isValidIdentifierString(v);
}

/** Guard: `EscalationRecordId`. */
export function isEscalationRecordId(v: unknown): v is EscalationRecordId {
  return isValidIdentifierString(v);
}

/** Guard: `ReconciliationRecordId`. */
export function isReconciliationRecordId(v: unknown): v is ReconciliationRecordId {
  return isValidIdentifierString(v);
}

/** Guard: `GatewayRequestRef`. */
export function isGatewayRequestRef(v: unknown): v is GatewayRequestRef {
  return isValidIdentifierString(v);
}

/** Guard: `OrderRef` (the order identity — a compact identifier). */
export function isOrderRef(v: unknown): v is OrderRef {
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

/** Project scope (L12/L15) — canonical owner: @tradrl/domain-core. */
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

/** Evidence reference — minted by the verification lane; cited here. */
export type EvidenceRef = Brand<string, 'EvidenceRef'>;

/** Environment profile reference — minted by the environment lane; cited here. */
export type EnvironmentProfileRef = Brand<string, 'EnvironmentProfileRef'>;

/** Risk policy reference — minted by the risk lane (T020); cited here. */
export type RiskPolicyRef = Brand<string, 'RiskPolicyRef'>;

/** Goal reference — minted by @tradrl/domain-core; cited here. */
export type GoalRef = Brand<string, 'GoalRef'>;

/** Guard: `GoalRef` (opaque ref). */
export const isGoalRef = (v: unknown): v is GoalRef => isValidOpaqueRefString(v);

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
// Order-lane identity mirrors (prefix-guarded opaque refs — thin, thin, thin)
// ---------------------------------------------------------------------------

/**
 * The execution-policy gate's decision identity — T019's `DecisionId`
 * space (`xd:`-prefixed content-addressed ids). THE AUTHORITY REF: only
 * an APPROVE decision bearing this identity may drive order preparation
 * (L8). Thin mirror: this package cites the id; it never imports the
 * minting lane.
 */
export type DecisionRef = Brand<string, 'DecisionRef'>;

/** Guard: a gate decision ref (`xd:`-prefixed opaque string). */
export const isDecisionRef = (v: unknown): v is DecisionRef =>
  isNonEmptyString(v) && (v as string).startsWith('xd:');

/**
 * The strategy lane's gated intent identity — T018's `si:`-prefixed
 * `StrategyIntent` ids, mirrored by T019's `intentRef`. Thin mirror.
 */
export type IntentRef = Brand<string, 'IntentRef'>;

/** Guard: a strategy intent ref (`si:`-prefixed opaque string). */
export const isIntentRef = (v: unknown): v is IntentRef =>
  isNonEmptyString(v) && (v as string).startsWith('si:');

/**
 * The Trading Director's decision identity — T024's `DirectorDecisionId`
 * space (`dd-`-prefixed derived ids). Consumed as an OPAQUE ref only
 * (L16: this body consumes the DECISION, never the strategic reasoning;
 * L15: goal, research, decision, execution and outcome share lineage).
 */
export type DirectorDecisionRef = Brand<string, 'DirectorDecisionRef'>;

/** Guard: a director decision ref (`dd`-prefixed opaque string). */
export const isDirectorDecisionRef = (v: unknown): v is DirectorDecisionRef =>
  isNonEmptyString(v) && (v as string).startsWith('dd-');

/**
 * The kill-switch identity — T019's `KillSwitchId` space (`ksw:`-prefixed
 * digest ids). The standing switch STATE is injected fact; the id is
 * cited in escalation evidence. Thin mirror.
 */
export type KillSwitchRef = Brand<string, 'KillSwitchRef'>;

/** Guard: a kill-switch ref (`ksw:`-prefixed opaque string). */
export const isKillSwitchRef = (v: unknown): v is KillSwitchRef =>
  isNonEmptyString(v) && (v as string).startsWith('ksw:');

/**
 * The simulated-fill identity — T019's `SimulatedFillId` space
 * (`xsf-`-prefixed ordinal ids, mirrored from exchange-sim's minting
 * law). Fill EVIDENCE on lifecycle records cites these. Thin mirror.
 */
export type FillRef = Brand<string, 'FillRef'>;

/** Guard: a simulated-fill ref (`xsf-`-prefixed opaque string). */
export const isFillRef = (v: unknown): v is FillRef =>
  isNonEmptyString(v) && (v as string).startsWith('xsf-');

/**
 * The venue-side order confirmation identity — the gateway/venue lane's
 * opaque confirmation refs for cancels (`confirm:`-prefixed here; the
 * venue binding is T040's). Cancel evidence on lifecycle records cites
 * these. This lane never MINTS a confirmation — it records the one the
 * gateway returns.
 */
export type CancelConfirmationRef = Brand<string, 'CancelConfirmationRef'>;

/** Guard: a cancel confirmation ref (`confirm:`-prefixed opaque string). */
export const isCancelConfirmationRef = (v: unknown): v is CancelConfirmationRef =>
  isNonEmptyString(v) && (v as string).startsWith('confirm:');

// ---------------------------------------------------------------------------
// Throwing constructors (owned spaces only)
// ---------------------------------------------------------------------------

/** Constructs an `OrderLifecycleId`, throwing on invalid input. */
export function orderLifecycleId(value: string): OrderLifecycleId {
  if (!isOrderLifecycleId(value)) {
    throw new TypeError(
      `orderLifecycleId: invalid id ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as OrderLifecycleId;
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

/** Constructs a `ReconciliationRecordId`, throwing on invalid input. */
export function reconciliationRecordId(value: string): ReconciliationRecordId {
  if (!isReconciliationRecordId(value)) {
    throw new TypeError(
      `reconciliationRecordId: invalid id ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as ReconciliationRecordId;
}

/** Constructs a `GatewayRequestRef`, throwing on invalid input. */
export function gatewayRequestRef(value: string): GatewayRequestRef {
  if (!isGatewayRequestRef(value)) {
    throw new TypeError(
      `gatewayRequestRef: invalid id ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as GatewayRequestRef;
}

/** Constructs an `OrderRef`, throwing on invalid input. */
export function orderRef(value: string): OrderRef {
  if (!isOrderRef(value)) {
    throw new TypeError(
      `orderRef: invalid order identity ${JSON.stringify(value)} — must match the compact identifier pattern`,
    );
  }
  return value as OrderRef;
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

/** Constructs a `DecisionRef`, throwing on invalid input. */
export function decisionRef(value: string): DecisionRef {
  if (!isDecisionRef(value)) {
    throw new TypeError(
      `decisionRef: invalid gate decision ref ${JSON.stringify(value)} — expected an 'xd:'-prefixed identity`,
    );
  }
  return value as DecisionRef;
}

/** Constructs an `IntentRef`, throwing on invalid input. */
export function intentRef(value: string): IntentRef {
  if (!isIntentRef(value)) {
    throw new TypeError(
      `intentRef: invalid strategy intent ref ${JSON.stringify(value)} — expected an 'si:'-prefixed identity`,
    );
  }
  return value as IntentRef;
}

/** Constructs a `DirectorDecisionRef`, throwing on invalid input. */
export function directorDecisionRef(value: string): DirectorDecisionRef {
  if (!isDirectorDecisionRef(value)) {
    throw new TypeError(
      `directorDecisionRef: invalid director decision ref ${JSON.stringify(value)} — expected a 'dd'-prefixed identity`,
    );
  }
  return value as DirectorDecisionRef;
}

/** Constructs a `KillSwitchRef`, throwing on invalid input. */
export function killSwitchRef(value: string): KillSwitchRef {
  if (!isKillSwitchRef(value)) {
    throw new TypeError(
      `killSwitchRef: invalid kill-switch ref ${JSON.stringify(value)} — expected a 'ksw:'-prefixed identity`,
    );
  }
  return value as KillSwitchRef;
}

/** Constructs a `FillRef`, throwing on invalid input. */
export function fillRef(value: string): FillRef {
  if (!isFillRef(value)) {
    throw new TypeError(
      `fillRef: invalid fill ref ${JSON.stringify(value)} — expected an 'xsf-'-prefixed identity`,
    );
  }
  return value as FillRef;
}

/** Constructs a `CancelConfirmationRef`, throwing on invalid input. */
export function cancelConfirmationRef(value: string): CancelConfirmationRef {
  if (!isCancelConfirmationRef(value)) {
    throw new TypeError(
      `cancelConfirmationRef: invalid cancel confirmation ref ${JSON.stringify(value)} — expected a 'confirm:'-prefixed identity`,
    );
  }
  return value as CancelConfirmationRef;
}
